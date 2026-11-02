import type { Context, Hono } from "hono";
import { z } from "zod";
import { openField, sealField, type VaultEnv } from "./vault/index";

type Env = VaultEnv & { DB: D1Database; [k: string]: unknown };
type C = Context<{ Bindings: Env }>;
type R = Record<string, any>;
export type SlackHooks = { device: (c: C) => Promise<{ id: string; owner: string } | null> };

export const LIMITS = { batch: 500, body: 4_000_000, text: 12_000, day: 50_000, chans: 500 };
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
// 비밀값 꼴(내보내기에서 이미 가렸어도 한 번 더 — CLI importer.mjs SECRET 과 같은 머리)
const SECRET = /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abeprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|bx[adsw]_[A-Za-z0-9_-]{20,})/g;
const clean = (s: unknown, n: number) => String(s ?? "").replace(CTRL, "").replace(SECRET, "[가림]").slice(0, n);
const TS = /^\d{10}\.\d{6}$/;

const Chan = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9]{5,20}$/),
  name: z.string().min(1).max(200),
  workspace: z.string().max(200).optional(),
  is_private: z.boolean().optional(),
  topic: z.string().max(2000).optional(),
});
const Msg = z.object({
  ts: z.string().regex(TS),
  thread_ts: z.string().regex(TS).nullish(),
  user: z.string().max(40).nullish(),
  user_name: z.string().max(200).nullish(),
  text: z.string().max(LIMITS.text * 4).nullish(),
  files: z.array(z.object({ name: z.string().max(400).nullish(), permalink: z.string().max(1000).nullish() })).max(50).nullish(),
  reactions: z.array(z.object({ name: z.string().max(100), count: z.number().int().nonnegative().max(100_000) })).max(50).nullish(),
  subtype: z.string().max(60).nullish(),
});
const Body = z.object({ channel: Chan, messages: z.array(z.unknown()).max(LIMITS.batch) });

const sha12 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].slice(0, 6).map(b => b.toString(16).padStart(2, "0")).join("");
export const nodeOf = async (owner: string, chan: string) => "sl_" + await sha12(`slack|${owner}|${chan}`);
const atOf = (ts: string) => Math.floor(Number(ts) * 1000);
const ref = (chan: string, ts: string, col: string) => ({ tbl: "slack_msg", pk: `${chan}/${ts}`, col });
const okUrl = (u: unknown) => typeof u === "string" && /^https:\/\/[\w.-]+\//.test(u) ? u : "";

/** 노드 이름: 「Slack · #채널」 — 그 사람의 다른 노드와 같으면 (워크스페이스), 그래도 같으면 뒤에 번호 */
async function pickName(db: D1Database, owner: string, node: string, ch: z.infer<typeof Chan>) {
  const taken = new Set(((await db.prepare("SELECT COALESCE(pinned_name, name) AS n FROM mnode WHERE owner = ? AND id != ?").bind(owner, node).all<R>()).results).map(r => String(r.n)));
  const base = `Slack · #${clean(ch.name, 80).replace(/^#/, "")}`, ws = clean(ch.workspace, 60);
  const tries = [base, ...(ws ? [`${base} (${ws})`] : [])];
  for (const t of tries) if (!taken.has(t)) return t;
  for (let i = 2; ; i++) if (!taken.has(`${tries[tries.length - 1]} ${i}`)) return `${tries[tries.length - 1]} ${i}`;
}

export function mountSlackImport(app: Hono<{ Bindings: Env }>, h: SlackHooks) {
  app.post("/api/me/import/slack", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    if (+(c.req.header("content-length") || 0) > LIMITS.body) return c.json({ error: "너무 큼", max_bytes: LIMITS.body }, 413);
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).length > LIMITS.body) return c.json({ error: "너무 큼", max_bytes: LIMITS.body }, 413);   // content-length 없이 온 몸통도
    let j: unknown; try { j = JSON.parse(raw); } catch { return c.json({ error: "JSON 아님" }, 400); }
    const p = Body.safeParse(j);
    if (!p.success) return c.json({ error: p.error.issues.slice(0, 3).map(i => `${i.path.join(".")} ${i.message}`).join("; ") }, 400);
    const owner = d.owner.toLowerCase(), DB = c.env.DB, t = Date.now(), ch = p.data.channel;
    // 하나씩 검사해 이상한 글만 버림(하나 때문에 묶음 전체가 400 이 나지 않게 — importer 와 같음). 같은 묶음 안 같은 ts 는 하나만
    const seen = new Set<string>(), msgs: z.infer<typeof Msg>[] = [];
    for (const x of p.data.messages) { const m = Msg.safeParse(x); if (m.success && !seen.has(m.data.ts)) { seen.add(m.data.ts); msgs.push(m.data); } }
    const bad = p.data.messages.length - msgs.length;
    const node = await nodeOf(owner, ch.id);
    const [day, have, nch] = await DB.batch([
      DB.prepare("SELECT count(*) AS n FROM slack_msg WHERE owner = ? AND imported_at > ?").bind(owner, t - 86_400_000),
      DB.prepare("SELECT node, name FROM slack_chan WHERE owner = ? AND chan = ?").bind(owner, ch.id),
      DB.prepare("SELECT count(*) AS n FROM slack_chan WHERE owner = ?").bind(owner),
    ]);
    const used = Number((day.results[0] as R)?.n || 0), old = have.results[0] as R | undefined;
    if (!old && Number((nch.results[0] as R)?.n || 0) >= LIMITS.chans) return c.json({ error: "채널 수 상한", max_channels: LIMITS.chans }, 429);
    // 하루 상한: 이미 들어 있는 글(겹침)은 새로 안 씀 — 세기 전에 빼서 다시 돌리기가 상한을 먹지 않게
    const dup = new Set<string>();
    for (let i = 0; i < msgs.length; i += 90) {
      const ks = msgs.slice(i, i + 90).map(m => m.ts);
      for (const r of (await DB.prepare(`SELECT ts FROM slack_msg WHERE owner = ? AND chan = ? AND ts IN (${ks.map(() => "?").join(",")})`).bind(owner, ch.id, ...ks).all<R>()).results) dup.add(String(r.ts));
    }
    const fresh = msgs.filter(m => !dup.has(m.ts));
    if (used + fresh.length > LIMITS.day) return c.json({ error: "하루 상한", max_per_day: LIMITS.day, left: Math.max(0, LIMITS.day - used) }, 429);
    // 채널 · 노드: 처음이면 이름을 정하고(그 뒤로 안 바꿈 — 화면이 이름으로 노드를 찾음), 노드가 보관됐으면 다시 꺼냄
    const name = old ? String(old.name) : await pickName(DB, owner, node, ch);
    if (!old) await DB.batch([
      DB.prepare("INSERT INTO slack_chan(owner, chan, node, name, workspace, is_private, topic, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner, chan) DO NOTHING")
        .bind(owner, ch.id, node, name, clean(ch.workspace, 200), ch.is_private ? 1 : 0, clean(ch.topic, 500), t, t),
      DB.prepare("INSERT INTO mnode(owner, id, name, area, state, why, counts, created_at, updated_at) VALUES (?,?,?,'slack','idle','Slack 옛 대화','{}',?,?) ON CONFLICT(owner, id) DO NOTHING").bind(owner, node, name, t, t),
    ]);
    const st: D1PreparedStatement[] = [];
    for (const m of fresh) {
      const thread = m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : null;
      const files = (m.files || []).map(f => ({ name: clean(f.name, 200) || "파일", permalink: okUrl(f.permalink) })).slice(0, 20);
      const text = await sealField(c.env, owner, ref(ch.id, m.ts, "text"), clean(m.text, LIMITS.text));
      const fj = await sealField(c.env, owner, ref(ch.id, m.ts, "files"), JSON.stringify(files));
      st.push(DB.prepare("INSERT INTO slack_msg(owner, chan, ts, thread_ts, at, user_id, user_name, text, files, reactions, subtype, imported_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner, chan, ts) DO NOTHING")
        .bind(owner, ch.id, m.ts, thread, atOf(m.ts), clean(m.user, 40), clean(m.user_name, 120), text, fj, JSON.stringify((m.reactions || []).map(r => ({ name: clean(r.name, 60), count: r.count }))), clean(m.subtype, 60), t));
    }
    let inserted = 0;
    for (let i = 0; i < st.length; i += 90) for (const r of await DB.batch(st.slice(i, i + 90))) inserted += Number(r.meta?.changes ?? 0);
    // 채널 글 수 · 처음 · 마지막 시각 → 노드 한 줄(state idle · why · counts) — 마지막 글 시각이 노드 시각(옛 채널은 아래로)
    const sum = await DB.prepare("SELECT count(*) AS n, min(at) AS a, max(at) AS b FROM slack_msg WHERE owner = ? AND chan = ?").bind(owner, ch.id).first<R>();
    const n = Number(sum?.n || 0), last = Number(sum?.b || t), day0 = sum?.b ? new Date(last + 9 * 3600_000).toISOString().slice(0, 10) : "";
    await DB.batch([
      DB.prepare("UPDATE slack_chan SET msgs = ?, first_at = ?, last_at = ?, topic = ?, updated_at = ? WHERE owner = ? AND chan = ?").bind(n, sum?.a ?? null, sum?.b ?? null, clean(ch.topic, 500), t, owner, ch.id),
      DB.prepare("UPDATE mnode SET why = ?, counts = ?, updated_at = ?, archived_at = NULL, state = CASE WHEN state = 'done' THEN 'idle' ELSE state END WHERE owner = ? AND id = ?")
        .bind(`Slack 옛 대화 · 글 ${n}개${day0 ? ` · 마지막 ${day0}` : ""}`, JSON.stringify({ slack: n }), last, owner, node),
    ]);
    return c.json({ ok: true, node, name, inserted, skipped: msgs.length - inserted, bad, channel_total: n, day_left: Math.max(0, LIMITS.day - used - inserted) });
  });
}

// ── 읽기(회원 보드 화면) ──
const kv = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) as T : d; } catch { return d; } };
async function view(env: Env, owner: string, node: string, r: R, extra: R = {}) {
  const text = String(await openField(env, owner, ref(r.chan, r.ts, "text"), r.text) ?? "");
  const files = kv<{ name: string; permalink: string }[]>(await openField(env, owner, ref(r.chan, r.ts, "files"), r.files), []);
  const gone = r.subtype === "tombstone";
  const body = gone ? "이 글은 삭제됐어요" : [text, ...files.map(f => `📎 ${f.name}${f.permalink ? ` ${f.permalink}` : ""}`)].filter(Boolean).join("\n");
  return { ts: String(r.ts), thread: r.thread_ts ?? null, who: "agent", name: String(r.user_name || r.user_id || "Slack"), board: false, text: body, buttons: [], files: [], replies: 0, latest: null, rnames: [],
    reactions: kv<R[]>(r.reactions, []).map(x => ({ name: x.name, count: x.count, mine: false })), owner: null, ch: node, ...(gone ? { deleted: true } : {}), ...extra };
}
const COLS = "chan, ts, thread_ts, at, user_id, user_name, text, files, reactions, subtype";
/** 뿌리 글들에 답글 수 · 마지막 답 · 답한 사람(뒤 셋) */
async function withReplies(env: Env, owner: string, chan: string, node: string, roots: R[]) {
  if (!roots.length) return [];
  const ks = JSON.stringify(roots.map(r => r.ts));
  const [st, nm] = await env.DB.batch([
    env.DB.prepare("SELECT thread_ts, count(*) AS n, max(ts) AS latest FROM slack_msg WHERE owner = ? AND chan = ? AND thread_ts IN (SELECT value FROM json_each(?)) GROUP BY thread_ts").bind(owner, chan, ks),
    env.DB.prepare("SELECT thread_ts, user_name, max(ts) AS t FROM slack_msg WHERE owner = ? AND chan = ? AND thread_ts IN (SELECT value FROM json_each(?)) GROUP BY thread_ts, user_name").bind(owner, chan, ks),
  ]);
  const stat = new Map((st.results as R[]).map(r => [String(r.thread_ts), r]));
  const names = new Map<string, R[]>(); for (const r of nm.results as R[]) (names.get(r.thread_ts) || names.set(r.thread_ts, []).get(r.thread_ts)!).push(r);
  return Promise.all(roots.map(r => { const s = stat.get(String(r.ts)); return view(env, owner, node, r, s ? { replies: Number(s.n), latest: String(s.latest), rnames: (names.get(String(r.ts)) || []).sort((a, b) => (a.t < b.t ? -1 : 1)).map(x => String(x.user_name || "Slack")).slice(-3) } : {}); }));
}

/** 회원 GET 중 Slack 노드 것만. null = 이 길이 아님(member-board 로) */
export async function get(env: Env, me: string, url: URL): Promise<Response | null> {
  const p = url.pathname, owner = me.toLowerCase();
  const j = (o: unknown, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-boarder-src": "member" } });
  if (p === "/api/nodechat") {
    const raw = String(url.searchParams.get("w") || "").trim(), t = raw.replace(/^\d+\s+/, "").trim();
    if (!t) return null;
    const ch = await env.DB.prepare("SELECT s.chan, s.node, COALESCE(m.pinned_name, m.name) AS n FROM slack_chan s JOIN mnode m ON m.owner = s.owner AND m.id = s.node WHERE s.owner = ?3 AND COALESCE(m.pinned_name, m.name) IN (?1, ?2) " +
      // 다른 노드(들여온 일)가 같은 이름이면 그 노드 채팅이 이김 — 사람이 노드 이름을 「Slack · #…」로 바꿔도 그 노드 글이 가려지지 않게
      "AND NOT EXISTS (SELECT 1 FROM mnode x WHERE x.owner = s.owner AND x.id NOT LIKE 'sl\\_%' ESCAPE '\\' AND x.archived_at IS NULL AND COALESCE(x.pinned_name, x.name) IN (?1, ?2)) LIMIT 1").bind(raw, t, owner).first<R>();
    if (!ch) return null;
    const roots = (await env.DB.prepare(`SELECT ${COLS} FROM slack_msg WHERE owner = ? AND chan = ? AND thread_ts IS NULL ORDER BY ts DESC LIMIT 300`).bind(owner, ch.chan).all<R>()).results.reverse();
    return j({ channel: "n:" + t, messages: await withReplies(env, owner, ch.chan, ch.node, roots), stale_min: 0, more: false });
  }
  const m = /^\/api\/chat\/(sl_[0-9a-f]{12})(?:\/(\d{10}\.\d{6}))?$/.exec(p);
  if (!m) return null;
  const ch = await env.DB.prepare("SELECT chan FROM slack_chan WHERE owner = ? AND node = ?").bind(owner, m[1]).first<R>();
  if (!ch) return j({ channel: m[1], messages: [], more: false, cursor: null, read_at: Math.floor(Date.now() / 1000), stale_min: 0 });   // 남의 노드 · 없는 노드 = 빈 꼴(있는지도 안 알림)
  if (m[2]) {
    const rows = (await env.DB.prepare(`SELECT ${COLS} FROM slack_msg WHERE owner = ? AND chan = ? AND (ts = ? OR thread_ts = ?) ORDER BY ts LIMIT 1000`).bind(owner, ch.chan, m[2], m[2]).all<R>()).results;
    const root = rows.find(r => r.ts === m[2]), reps = rows.filter(r => r.ts !== m[2]);
    const out = await Promise.all(rows.map(r => view(env, owner, m[1], r, r === root ? { replies: reps.length, latest: reps.length ? String(reps[reps.length - 1].ts) : null } : { thread: m[2] })));
    return j({ channel: m[1], root: m[2], owner: null, messages: out });
  }
  const before = url.searchParams.get("before") || "";
  const rows = (await env.DB.prepare(`SELECT ${COLS} FROM slack_msg WHERE owner = ? AND chan = ? AND thread_ts IS NULL${TS.test(before) ? " AND ts < ?" : ""} ORDER BY ts DESC LIMIT 101`).bind(owner, ch.chan, ...(TS.test(before) ? [before] : [])).all<R>()).results;
  const page = rows.slice(0, 100).reverse(), msgs = await withReplies(env, owner, ch.chan, m[1], page);
  return j({ channel: m[1], messages: msgs, more: rows.length > 100, cursor: msgs.length ? msgs[0].ts : null, read_at: Math.floor(Date.now() / 1000), stale_min: 0 });
}
