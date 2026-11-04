import type { Context, Hono } from "hono";
import { z } from "zod";
import { readCapped } from "./devices";
import { taskIssueFor } from "./importer/task-repo";
import { readPrefs } from "./node-prefs";
import { redact } from "./session/redact";

type Env = { DB: D1Database };
type C = Context<{ Bindings: Env }>;
export type ConvoHooks = {
  device: (c: C) => Promise<{ id: string; owner: string; name: string } | null>;
  member: (c: C) => Promise<string | null>;
  sameSite: (c: C) => boolean;
  sync?: (db: D1Database, me: string, nodeId: string) => Promise<unknown>;   // 읽기 전 보드 줄 맞춰 넣기(index.ts 가 member-board syncTaskConvo 를 넘김 — 고리 import 막기)
};
export const LAYERS = ["human", "agents"] as const;
export type Layer = typeof LAYERS[number];
export type ConvoRow = { layer: Layer; who: string; at: number; source: string; text: string; src_ref: string; log?: { id: number; win: string; text: string } };

const CTRL = /[\x00-\x08\x0b-\x1f\x7f]/g;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;   // importer TaskIn.key 와 같음
export const RESERVED = /^(?:board_log|card):/;   // 보드 줄 · 카드의 출처 키(member-board syncTaskConvo) — 기기가 쓰면 진짜 줄을 가림
export const LIMITS = { body: 2_000_000, day: 50_000, aheadMs: 86_400_000 };
export function taskKey(x: unknown): string | null {
  const s = String(x ?? "").trim().replace(/^tk_/, "").replace(/^(?:[\w.-]+\/[\w.-]+)?#(?=\d)/, "");
  return KEY.test(s) ? s : null;
}
// 내 업무 노드 하나(owner = 나). 키로 먼저, 없으면 이슈 번호가 같은 업무(올리는 쪽 task_id 가 이슈 번호일 때). 남의 것 · 없는 것은 null
const REPO = /^\s*(?:tk_)?([\w.-]+\/[\w.-]+)#\d/;
export async function ownTask(db: D1Database, me: string, raw: unknown) {
  const key = taskKey(raw); if (!key) return null;
  // 저장소#번호: 그 저장소의 이슈인 업무만(번호만 있는 업무는 사람 설정 task_repo 로 읽음 — 설정이 없으면 저장소를 모르므로 추정 안 함). 다른 저장소의 같은 번호가 내 업무로 들어오지 않게
  const repo = REPO.exec(String(raw ?? ""))?.[1].toLowerCase();
  if (repo) {
    if (!/^\d{1,8}$/.test(key)) return null;
    const home = (await readPrefs(db, me)).task_repo;
    const rows = (await db.prepare("SELECT id, name, json_extract(task, '$.issue') issue FROM mnode WHERE owner = ?1 AND id LIKE 'tk\\_%' ESCAPE '\\' AND json_valid(task) AND (json_extract(task, '$.issue') = ?2 OR json_extract(task, '$.issue') LIKE '%/%#' || ?3) ORDER BY archived_at IS NOT NULL, updated_at DESC").bind(me, "#" + key, key).all<{ id: string; name: string; issue: string }>()).results;
    const hit = rows.find(r => taskIssueFor(home, String(r.issue)).toLowerCase() === `${repo}#${key}`);
    return hit ? { key: hit.id.slice(3), id: hit.id, name: hit.name } : null;
  }
  const byKey = await db.prepare("SELECT id, name FROM mnode WHERE owner = ? AND id = ?").bind(me, "tk_" + key).first<{ id: string; name: string }>();
  if (byKey) return { key, id: byKey.id, name: byKey.name };
  if (!/^\d{1,8}$/.test(key)) return null;
  const byIssue = await db.prepare("SELECT id, name FROM mnode WHERE owner = ? AND id LIKE 'tk\\_%' ESCAPE '\\' AND json_valid(task) AND (json_extract(task, '$.issue') = ?2 OR json_extract(task, '$.issue') LIKE '%/%#' || ?3) ORDER BY archived_at IS NOT NULL, updated_at DESC LIMIT 1").bind(me, "#" + key, key).first<{ id: string; name: string }>();
  return byIssue ? { key: byIssue.id.slice(3), id: byIssue.id, name: byIssue.name } : null;
}

// 시각: ms 숫자 · 초 숫자(1e11 아래) · ISO 글 → ms. 못 읽으면 null. 1970 전 · 지금 + 하루 뒤도 null(쪽 나눔 표 · 접은 글 ts 는 10자리 초 — 먼 미래 값이 그 꼴을 깨고 늘 맨 끝에 붙음)
export function atMs(x: unknown, now = Date.now()): number | null {
  let t: number | null = null;
  if (typeof x === "number" && Number.isFinite(x) && x > 0) t = Math.round(x < 1e11 ? x * 1000 : x);
  else if (typeof x === "string" && x.trim()) { if (/^\d+(\.\d+)?$/.test(x.trim())) return atMs(Number(x), now); const p = Date.parse(x); t = Number.isFinite(p) ? p : null; }
  return t !== null && t > 0 && t <= now + LIMITS.aheadMs ? t : null;
}
const RowIn = z.object({
  layer: z.enum(LAYERS),
  who: z.string().trim().min(1).max(120),
  at: z.union([z.number(), z.string()]).optional(),
  source: z.string().trim().min(1).max(60),
  text: z.string().min(1).max(8000),
  src_ref: z.string().trim().min(1).max(200).refine(s => !RESERVED.test(s), "board_log: · card: 는 보드 줄 키"),
});
const WriteIn = z.object({ task: z.union([z.string(), z.number()]), rows: z.array(RowIn).min(1).max(500) });

// 줄 넣기: 같은 (owner, task_id, src_ref) 는 한 줄 — 두 번째는 넣지 않고 dup 으로 셈. 한 batch(D1 = 한 트랜잭션)
export async function addRows(db: D1Database, me: string, key: string, rows: ConvoRow[]) {
  if (!rows.length) return { added: 0, dup: 0 };
  const t0 = Date.now();
  const st = rows.map(r => {
    const vals = [me, key, r.layer, r.who.replace(CTRL, " ").slice(0, 120), Math.round(r.at), r.source.slice(0, 60), r.text.replace(/\r\n?/g, "\n").replace(CTRL, " ").slice(0, 8000), r.src_ref.slice(0, 200), t0];
    return r.log
      ? db.prepare("INSERT INTO task_convo(owner, task_id, layer, who, at, source, text, src_ref, created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM board_log WHERE owner = ? AND id = ? AND win = ? AND text = ?) ON CONFLICT(owner, task_id, src_ref) DO NOTHING").bind(...vals, me, r.log.id, r.log.win, r.log.text)
      : db.prepare("INSERT INTO task_convo(owner, task_id, layer, who, at, source, text, src_ref, created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner, task_id, src_ref) DO NOTHING").bind(...vals);
  });
  let added = 0;
  for (let i = 0; i < st.length; i += 100) for (const x of await db.batch(st.slice(i, i + 100)) as { meta?: { changes?: number } }[]) added += Number(x?.meta?.changes || 0);
  return { added, dup: rows.length - added };
}
// 기기 · 화면이 API 로 넣는 줄: 저장 전에 비밀 꼴을 가림(MCP 쓰기 maskDeep 과 같은 redact). src_ref 는 글이 아니라 겹침 막는 키라 안 가림(같은 까닭으로 MCP 도 id 칸은 안 가림)
export const maskRow = <T extends { who: string; source: string; text: string }>(r: T): T => ({ ...r, who: redact(r.who), source: redact(r.source), text: redact(r.text) });
// 출처 키로 지우기(사람이 보드에서 지운 내 글 — board_log:<id>)
export const dropRef = (db: D1Database, me: string, ref: string) => db.prepare("DELETE FROM task_convo WHERE owner = ? AND src_ref = ?").bind(me, ref).run();

// 내 글을 고치면 표의 그 줄도(addRows 와 같은 다듬기)
export const editRef = (db: D1Database, me: string, ref: string, text: string) => db.prepare("UPDATE task_convo SET text = ? WHERE owner = ? AND src_ref = ?").bind(text.replace(/\r\n?/g, "\n").replace(CTRL, " ").slice(0, 8000), me, ref).run();
async function overDay(db: D1Database, me: string, key: string, rows: { src_ref: string }[], now: number) {
  const refs = [...new Set(rows.map(r => r.src_ref))], have = new Set<string>();
  for (let i = 0; i < refs.length; i += 90) { const ks = refs.slice(i, i + 90); for (const r of (await db.prepare(`SELECT src_ref FROM task_convo WHERE owner = ? AND task_id = ? AND src_ref IN (${ks.map(() => "?").join(",")})`).bind(me, key, ...ks).all<{ src_ref: string }>()).results) have.add(r.src_ref); }
  const used = Number((await db.prepare("SELECT count(*) n FROM task_convo WHERE owner = ? AND created_at > ? AND src_ref NOT LIKE 'board\\_log:%' ESCAPE '\\' AND src_ref NOT LIKE 'card:%'").bind(me, now - 86_400_000).first<{ n: number }>())?.n || 0);
  return used + refs.filter(r => !have.has(r)).length > LIMITS.day ? { error: "하루 상한", max_per_day: LIMITS.day, left: Math.max(0, LIMITS.day - used) } : null;
}

// 쪽 나눔 표: 「<at>:<id>」(마지막 줄 다음부터)
const CUR = /^(\d{1,16}):(\d{1,16})$/;
export async function readRows(db: D1Database, me: string, key: string, o: { layer?: Layer | null; after?: string | null; limit?: number } = {}) {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(o.limit) || 100)));
  const c = o.after ? CUR.exec(o.after) : null;
  const rows = (await db.prepare(`SELECT id, layer, who, at, source, text, src_ref FROM task_convo WHERE owner = ?1 AND task_id = ?2 ${o.layer ? "AND layer = ?3" : "AND ?3 IS NULL"} ${c ? "AND (at > ?4 OR (at = ?4 AND id > ?5))" : "AND ?4 IS NULL AND ?5 IS NULL"} ORDER BY at, id LIMIT ?6`)
    .bind(me, key, o.layer || null, c ? Number(c[1]) : null, c ? Number(c[2]) : null, limit + 1).all<{ id: number; layer: Layer; who: string; at: number; source: string; text: string; src_ref: string }>()).results;
  const page = rows.slice(0, limit), last = page.at(-1);
  const cnt = (await db.prepare("SELECT layer, COUNT(*) n FROM task_convo WHERE owner = ? AND task_id = ? GROUP BY layer").bind(me, key).all<{ layer: Layer; n: number }>()).results;
  const counts = { human: 0, agents: 0 }; for (const r of cnt) counts[r.layer] = Number(r.n);
  return { rows: page, next: rows.length > limit && last ? `${last.at}:${last.id}` : null, counts };
}

export function mountTaskConvo(app: Hono<{ Bindings: Env }>, h: ConvoHooks) {
  // 회원(쓰기는 같은 사이트일 때만) 또는 기기 토큰 → 그 보드 주인 메일
  const who = async (c: C, write: boolean) => (!write || h.sameSite(c) ? await h.member(c) : null) || (await h.device(c))?.owner || null;
  const write = async (c: C) => {
    const me = await who(c, true); if (!me) return c.json({ error: "로그인 · 기기 토큰" }, 401);
    if (+(c.req.header("content-length") || 0) > LIMITS.body) return c.json({ error: "너무 큼", max_bytes: LIMITS.body }, 413);
    const buf = await readCapped(c.req.raw.body, LIMITS.body);   // 머리값 없는 몸통도 실제로 잼
    if (!buf) return c.json({ error: "너무 큼", max_bytes: LIMITS.body }, 413);
    let j: unknown = null; try { j = JSON.parse(new TextDecoder().decode(buf)); } catch { /* 아래 400 */ }
    const p = WriteIn.safeParse(j);
    if (!p.success) return c.json({ error: p.error.issues.slice(0, 3).map(i => `${i.path.join(".")} ${i.message}`).join("; ") }, 400);
    const t = await ownTask(env(c).DB, me, p.data.task);
    if (!t) return c.json({ error: "없는 태스크" }, 404);   // 남의 보드의 태스크 · 없는 키 — 있는지도 알리지 않음
    const now = Date.now(), bad: number[] = [];
    const rows = p.data.rows.map((r, i) => { const at = r.at === undefined ? now : atMs(r.at, now); if (at === null) bad.push(i); return maskRow({ ...r, at: at ?? now }); });
    if (bad.length) return c.json({ error: "at 을 못 읽음(ms · 초 · ISO, 지금 + 하루까지)", rows: bad.slice(0, 10) }, 400);
    const over = await overDay(env(c).DB, me, t.key, rows, now); if (over) return c.json(over, 429);
    const r = await addRows(env(c).DB, me, t.key, rows);
    return c.json({ ok: true, task: t.key, node: t.id, ...r });
  };
  const read = async (c: C) => {
    const me = await who(c, false); if (!me) return c.json({ error: "로그인 · 기기 토큰" }, 401);
    const q = new URL(c.req.url).searchParams, layer = q.get("layer");
    if (layer && !LAYERS.includes(layer as Layer)) return c.json({ error: "layer = human | agents" }, 400);
    const after = q.get("after"); if (after && !CUR.test(after)) return c.json({ error: "after = 앞 답의 next" }, 400);
    const DB = env(c).DB, t = await ownTask(DB, me, q.get("task"));
    if (!t) return c.json({ error: "없는 태스크" }, 404);
    if (h.sync && q.get("sync") !== "0") await h.sync(DB, me, t.id).catch(e => console.error("태스크 대화 맞추기", e));   // 못 맞춰도 표에 있는 것은 읽음
    const r = await readRows(DB, me, t.key, { layer: layer as Layer | null, after, limit: Number(q.get("limit")) || 100 });
    return c.json({ ok: true, task: t.key, node: t.id, ...r }, 200, { "cache-control": "no-store" });
  };
  for (const p of ["/api/device/tasks/convo", "/api/me/tasks/convo"]) { app.post(p, write); app.get(p, read); }
}
const env = (c: C) => c.env;
