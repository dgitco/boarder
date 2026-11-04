import { cleanPins, savePins } from "../side-order";
import { deviceFeatures } from "./device-engine";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { group, pickUnit, notChat, type Item, type Unit } from "./group";
import { prefsOf, parkHOf } from "../node-prefs";
import { importedWindow, queueToImported } from "../member-imported";
import { engineOf, widPane } from "../engine";
import { paneOfId } from "../member-board";
import { proposalFrom, applyProposal, imported, PROPOSAL_CHOICES, IMPORT_WIN } from "./proposal";

type Env = { DB: D1Database; PUBLIC_URL: string; [k: string]: unknown };
type C = Context<{ Bindings: Env }>;
export type Hooks = {
  device: (c: C) => Promise<{ id: string; owner: string; name: string } | null>;   // 기기 토큰(full) — 회원 기기만
  member: (c: C) => Promise<string | null>;                                     // 로그인한 회원 메일(주인이면 null)
  sameSite: (c: C) => boolean;
};

const CTRL = /[\x00-\x08\x0b-\x1f\x7f]/g;
const s = (n: number) => z.string().max(4000).transform(v => v.replace(CTRL, "").trim().slice(0, n));
const ItemIn = z.object({
  key: z.string().min(3).max(200).regex(/^(window|session|thread|todo|task):[^\s]{1,190}$/),
  kind: z.enum(["window", "session", "thread", "todo", "task"]),
  engine: s(40).optional(), title: s(140).optional(), cwd: s(300).optional(), repo: s(200).optional(), branch: s(120).optional(),
  refs: z.array(s(160)).max(16).optional(),
  state: z.enum(["working", "idle", "question", "parked", "done", "open", "gone", ""]).optional(),
  state_at: z.number().int().nonnegative().optional(),
  win: s(120).optional(), session: s(200).optional(),
  handle: z.record(z.string(), z.union([z.string().max(400), z.number(), z.boolean(), z.null()])).optional(),
});
const ImportIn = z.object({
  host: s(80).optional(),
  kinds: z.array(z.enum(["window", "session", "thread", "todo", "task"])).max(5),   // 이번에 다 읽은 종류 — 여기 없는 이 기기 것은 사라진 것
  items: z.array(z.unknown()).max(2000),
  connectors: z.array(z.object({ name: s(60), from: s(40), transport: z.enum(["http", "sse", "stdio"]), url: s(300).optional(), command: s(80).optional(), secrets: z.boolean().optional() })).max(80).optional(),
  roles: z.array(z.object({ name: s(60), from: s(80), description: s(400).optional(), model: s(60).optional(), tools: s(200).optional(), path: s(300).optional() })).max(80).optional(),
  features: z.lazy(() => Features).optional(),   // 이 기기에서 그 사람이 켠 것
});
const Features = z.object({
  report: z.array(z.enum(["claude", "codex", "cursor", "gemini"])).max(4), engine: z.boolean(), view: z.boolean().optional(),
  reportDirs: z.array(z.object({ tool: z.enum(["claude", "codex", "cursor", "gemini"]), where: s(120), state: z.enum(["on", "off", "stale"]) })).max(16).optional(),
});

const now = () => Date.now();
const TASK_STATES = ["working", "blocked", "waiting", "done", "cancelled"] as const;
type Task = { state: typeof TASK_STATES[number]; line: string; body: string; issue: string; confirm?: true; fields?: Record<string, string> };
const TASK_NODE_STATE: Record<Task["state"], string> = { working: "working", blocked: "blocked", waiting: "idle", done: "done", cancelled: "done" };
const TOP = "top";   // 상위 칸의 「맨 위」(열 머리) 표지 — member-board TOP 과 같음
const TaskIn = z.object({
  key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/),
  name: s(140).optional(), area: s(60).optional(),
  parent: z.union([z.string().min(1).max(80), z.null()]).optional(),
  state: z.enum(TASK_STATES).optional(),
  line: s(200).optional(), body: s(4000).optional(),
  confirm: z.boolean().optional(),
  fields: z.record(z.string().min(1).max(40), s(500)).refine(o => Object.keys(o).length <= 20, "칸은 20개까지").optional(),   // 준 칸 묶음째 바꿈, 안 주면 그대로
  issue: z.union([z.number().int().positive().max(99_999_999), z.string().regex(/^(?:[\w.-]+\/[\w.-]+)?#?\d{1,8}$/), z.literal(""), z.null()]).optional(),
});
const TasksIn = z.object({ tasks: z.array(TaskIn).min(1).max(200) });
// 상위 노드 칸 고치기(node_setting.data.parent): patch 의 값이 null 이면 그 칸 지움(json_patch). nodes/parent · device/tasks 가 같이 씀
const parentStmt = (DB: D1Database, me: string, patch: Record<string, string | null>) =>
  DB.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?1, json_object('parent', json_patch('{}', json(?2))), ?3) ON CONFLICT(owner) DO UPDATE SET data = json_set(CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END, '$.parent', json_patch(CASE WHEN json_valid(data) AND json_type(json_extract(data, '$.parent')) = 'object' THEN json_extract(data, '$.parent') ELSE '{}' END, json(?2))), updated_at = ?3").bind(me, JSON.stringify(patch), now());
const UNIT_Q = "노드를 어떻게 묶을까요?";
const UNIT_CHOICE: Record<Unit, string> = { agent: "에이전트마다 채널 · 일은 스레드", goal: "일마다 채널" };
export async function setUnit(env: Env, owner: string, unit: Unit, by: "auto" | "me") {
  await env.DB.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?, json_object('unit', ?2, 'unit_by', ?3), ?4) ON CONFLICT(owner) DO UPDATE SET data = json_set(CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END, '$.unit', ?2, '$.unit_by', ?3), updated_at = excluded.updated_at")
    .bind(owner, unit, by, now()).run();
  // 사람이 정했으면 남은 질문을 닫음 — 나중에 옛 질문에 답해 뒤집히지 않게
  if (by === "me") await env.DB.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE owner = ? AND win = ? AND question = ? AND state = 'open'").bind(UNIT_CHOICE[unit], owner, IMPORT_WIN, UNIT_Q).run();
}
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const json = <T>(v: string | null | undefined, d: T): T => { try { return v ? JSON.parse(v) as T : d; } catch { return d; } };

export async function regroup(env: Env, owner: string) {
  const t = now();
  const [it, lg, cd, mp, nd, wn, ns, rl, em] = await env.DB.batch([
    env.DB.prepare("SELECT key, kind, engine, title, cwd, repo, branch, refs, state, state_at, win, session, seen_at, gone_at, CASE WHEN kind = 'window' THEN handle END handle, (SELECT d.revoked_at IS NOT NULL FROM device d WHERE d.id = imp_item.device_id) rv FROM imp_item WHERE owner = ?").bind(owner),
    env.DB.prepare(`SELECT win, kind, text, at FROM board_log WHERE owner = ? AND (thread IS NULL OR (thread != 'primary' AND thread NOT LIKE 'p:%')) AND kind != 'me' ${notChat("board_log")} ORDER BY at DESC LIMIT 400`).bind(owner),
    env.DB.prepare(`SELECT id, win, state, question, at FROM board_card WHERE owner = ? ${notChat("board_card")} ORDER BY at DESC LIMIT 200`).bind(owner),
    env.DB.prepare("SELECT item, node, how FROM mnode_item WHERE owner = ?").bind(owner),
    env.DB.prepare("SELECT id, name, pinned_name, area, state, why, counts, created_at, updated_at, archived_at FROM mnode WHERE owner = ? AND id NOT LIKE 'sl\\_%' ESCAPE '\\' AND id NOT LIKE 'tk\\_%' ESCAPE '\\'").bind(owner),
    env.DB.prepare("SELECT pane, win FROM agent_token WHERE owner = ? ORDER BY created_at").bind(owner),
    env.DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(owner),
    env.DB.prepare("SELECT name FROM role WHERE owner = ? UNION SELECT name FROM engine_window WHERE owner = ? AND kind = 'role' AND state NOT IN ('closed','failed','gone')").bind(owner, owner),
    env.DB.prepare("SELECT 1 FROM engine_window w JOIN device d ON d.id = w.device_id WHERE w.owner = ? AND w.kind = 'main' AND w.state NOT IN ('closed','failed','gone') AND d.revoked_at IS NULL LIMIT 1").bind(owner),   // 보더 메인 봇이 떠 있나(있으면 들여온 primary 는 노드)
  ]);
  const items = (it.results as (Item & { refs: string })[]).map(r => ({ ...r, refs: json<string[]>(r.refs as unknown as string, []) }));
  const winNames = Object.fromEntries((wn.results as { pane: string; win: string }[]).map(r => [r.pane, r.win]));
  const keyOf = paneOf(wn.results as { pane: string; win: string }[]);
  const own = (w: string) => w === IMPORT_WIN || /(^|:)boarder(-|:)import$/.test(w);
  const logs = (lg.results as { win: string }[]).filter(l => !own(l.win)).map(l => ({ ...l, win: keyOf(l.win) }));
  const cards = (cd.results as { win: string }[]).filter(c => !own(c.win)).map(c => ({ ...c, win: keyOf(c.win) }));
  const raw = (ns.results[0] as { data?: string } | undefined)?.data;
  const set = json<{ archive_h?: number; unit?: Unit }>(raw, {}), archiveH = set.archive_h ?? 6, pref = prefsOf(raw);
  const r = await group({ items, logs: logs as never, cards: cards as never, prev: mp.results as never, prevNodes: nd.results as never, winNames, now: t, archiveH, unit: set.unit, engineMain: em.results.length > 0, agents: (rl.results as { name: string }[]).map(x => x.name),
    primaryItem: pref.primary_item, parkH: parkHOf(pref) });
  const keep = new Set(r.nodes.map(n => n.id));
  const was = new Map((mp.results as { item: string; node: string; how: string }[]).map(m => [m.item, m]));
  const st: D1PreparedStatement[] = [];
  for (const m of r.map) { const o = was.get(m.item); if (!o || o.node !== m.node || o.how !== m.how) st.push(env.DB.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?) ON CONFLICT(owner, item) DO UPDATE SET node = excluded.node, how = excluded.how").bind(owner, m.item, m.node, m.how)); }
  const now_ = new Set(r.map.map(m => m.item)), gone = [...was.keys()].filter(k => !now_.has(k));
  for (let i = 0; i < gone.length; i += 80) st.push(env.DB.prepare(`DELETE FROM mnode_item WHERE owner = ? AND item IN (${gone.slice(i, i + 80).map(() => "?").join(",")})`).bind(owner, ...gone.slice(i, i + 80)));
  const old = new Map((nd.results as { id: string; name: string; area: string; state: string; why: string; counts: string; updated_at: number; archived_at: number | null }[]).map(n => [n.id, n]));
  for (const n of r.nodes) {
    if (n.id.startsWith("sl_") || n.id.startsWith("tk_")) continue;   // 사람이 Slack · 업무 노드로 옮겨 넣은 것(pin)이 있어도 그 노드 줄은 slack-import · /api/device/tasks 것
    const o = old.get(n.id), counts = JSON.stringify(n.counts), arch = n.archived ? (o?.archived_at || (set.unit ? Math.min(t, n.updated_at || t) : t)) : null;   // 고른 사람은 보관 시각 = 마지막 움직임 — 옛 세션 수십 개가 「끝난 노드」 목록에 하루 동안 쌓이지 않게
    if (o && o.name === n.name && o.area === n.area && o.state === n.state && o.why === n.why && o.counts === counts && o.updated_at === n.updated_at && (o.archived_at ?? null) === arch) continue;
    st.push(env.DB.prepare(
      "INSERT INTO mnode(owner, id, name, area, state, why, counts, created_at, updated_at, archived_at) VALUES (?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(owner, id) DO UPDATE SET name = excluded.name, area = excluded.area, state = excluded.state, why = excluded.why, counts = excluded.counts, updated_at = excluded.updated_at, archived_at = excluded.archived_at")
      .bind(owner, n.id, n.name, n.area, n.state, n.why, counts, n.created_at, n.updated_at, arch));
  }
  // 다 빠진 노드는 보관(지우지 않음 — 이름 · 기록이 남게)
  for (const o of old.values()) if (!keep.has(o.id) && !o.archived_at) st.push(env.DB.prepare("UPDATE mnode SET archived_at = ?, state = 'done' WHERE owner = ? AND id = ?").bind(set.unit ? Math.min(t, o.updated_at || t) : t, owner, o.id));
  st.push(env.DB.prepare("INSERT INTO imp_audit(owner, at, data) VALUES (?,?,?)").bind(owner, t, JSON.stringify(r.audit)));
  st.push(env.DB.prepare("DELETE FROM imp_audit WHERE owner = ? AND at < ?").bind(owner, t - 48 * 3600_000));
  for (let i = 0; i < st.length; i += 90) await env.DB.batch(st.slice(i, i + 90));   // D1 batch 한 번에 너무 많지 않게
  return r;
}

function paneOf(rows: { pane: string; win: string }[]) {
  const m = new Map<string, string>(); for (const r of rows) m.set(r.win, r.pane);
  return (w: string) => m.get(w) || w;
}

export async function onCardAnswered(env: Env, owner: string, cardId: string, head = "") {   // head = 보드 글 머리 줄(board-head.ts — 「[보드 · <채널> · 카드 <id>]」)
  const p = await env.DB.prepare("SELECT payload FROM imp_proposal WHERE card_id = ? AND owner = ? AND state = 'open'").bind(cardId, owner).first<{ payload: string }>();
  const card = await env.DB.prepare("SELECT id, win, question, answer FROM board_card WHERE id = ? AND owner = ?").bind(cardId, owner).first<{ id: string; win: string; question: string; answer: string }>();
  if (!card) return;
  if (card.win === IMPORT_WIN && card.question === UNIT_Q) {
    const u = (Object.keys(UNIT_CHOICE) as Unit[]).find(k => UNIT_CHOICE[k] === card.answer);
    if (u) { await setUnit(env, owner, u, "me"); await regroup(env, owner); }
    await env.DB.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE id = ? AND owner = ?").bind(card.answer, cardId, owner).run();
    return;
  }
  if (p) { await applyProposal(env, owner, cardId, json(p.payload, { connectors: [], roles: [] }), card.answer); return; }
  const w = await importedWindow(env.DB, owner, { wid: null, win: card.win });
  if (!w?.device_id) return;   // 들여오지 않은 창(보고만) — 창이 boarder wait 로 받음
  if (w.engine === "tmux") return;   // 우리 엔진 창(옮긴 것 포함)은 「Boarder tmux 엔진」 감독 규칙이 받음(engine_window · wid) — 두 번 넣지 않게
  const text = `${head ? head + " " : ""}[보더] 「${card.question.slice(0, 80)}」 답: ${card.answer} (카드 ${card.id}) — boarder close ${card.id} "<처리>" 로 닫아요`;
  await queueToImported(env.DB, owner, w, text, card.id);
}

async function queue(env: Env, owner: string, device: string, verb: string, args: unknown) {
  const id = rid();
  await env.DB.prepare("INSERT INTO engine_cmd(id, owner, device_id, verb, args, at) VALUES (?,?,?,?,?,?)").bind(id, owner, device, verb, JSON.stringify(args), now()).run();
  return id;
}

export function mountImport(app: Hono<{ Bindings: Env }>, h: Hooks) {
  app.post("/api/import", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    if (+(c.req.header("content-length") || 0) > 1_000_000) return c.json({ error: "너무 큼" }, 413);
    const p = ImportIn.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: p.error.issues.slice(0, 3).map(i => `${i.path.join(".")} ${i.message}`).join("; ") }, 400);
    const b = p.data, t = now(), owner = d.owner, DB = env(c).DB;
    if (b.features) { const f = JSON.stringify(b.features); await DB.prepare("UPDATE device SET features = ? WHERE id = ? AND (features IS NULL OR features != ?)").bind(f, d.id, f).run(); }
    const valid = b.items.map(x => ItemIn.safeParse(x)).filter(x => x.success).map(x => x.data!), items = valid.slice(0, 600), dropped = b.items.length - items.length;
    const have = new Map(((await DB.prepare("SELECT key, kind, engine, title, cwd, repo, branch, refs, state, state_at, win, session, handle, gone_at FROM imp_item WHERE owner = ? AND device_id = ?").bind(owner, d.id).all()).results as Record<string, unknown>[]).map(r => [String(r.key), r]));
    const sig = (r: Record<string, unknown>) => JSON.stringify([r.kind, r.engine || "", r.title || "", r.cwd || "", r.repo || "", r.branch || "", typeof r.refs === "string" ? r.refs : JSON.stringify(r.refs || []), r.state || "", r.state_at ?? null, r.win || "", r.session || ""]);
    const st: D1PreparedStatement[] = [];
    for (const i of items) {
      const o = have.get(i.key);
      if (o && !o.gone_at && sig(o) === sig(i) && (!i.handle || o.handle === JSON.stringify(i.handle))) continue;
      st.push(DB.prepare(
        "INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, repo, branch, refs, state, state_at, win, session, handle, seen_at, gone_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL) " +
        "ON CONFLICT(owner, key) DO UPDATE SET device_id = excluded.device_id, kind = excluded.kind, engine = excluded.engine, title = excluded.title, cwd = excluded.cwd, repo = excluded.repo, branch = excluded.branch, refs = excluded.refs, " +
        "state = excluded.state, state_at = excluded.state_at, win = excluded.win, session = excluded.session, handle = COALESCE(excluded.handle, imp_item.handle), seen_at = excluded.seen_at, gone_at = NULL")
        .bind(owner, i.key, d.id, i.kind, i.engine || "", i.title || "", i.cwd || "", i.repo || "", i.branch || "", JSON.stringify(i.refs || []), i.state || "", i.state_at ?? null, i.win || "", i.session || "", i.handle ? JSON.stringify(i.handle) : null, t));
    }
    const sent = new Set(valid.map(i => i.key)), kinds = new Set(b.kinds);
    const goneKeys = [...have.values()].filter(o => !o.gone_at && o.state !== "parked" && kinds.has(o.kind as never) && !sent.has(String(o.key))).map(o => String(o.key));
    for (let i = 0; i < goneKeys.length; i += 80) st.push(DB.prepare(`UPDATE imp_item SET gone_at = ?, state = 'gone' WHERE owner = ? AND device_id = ? AND key IN (${goneKeys.slice(i, i + 80).map(() => "?").join(",")})`).bind(t, owner, d.id, ...goneKeys.slice(i, i + 80)));
    const same = !st.length && !b.connectors?.length && !b.roles?.length && items.length > 0;
    st.push(DB.prepare("DELETE FROM imp_item WHERE owner = ? AND gone_at < ?").bind(owner, t - 7 * 86400_000));
    if (same) {
      const [au, ns] = await DB.batch([
        DB.prepare("SELECT at, data FROM imp_audit WHERE owner = ? ORDER BY at DESC LIMIT 1").bind(owner),
        DB.prepare("SELECT state, COUNT(*) n FROM mnode WHERE owner = ? AND archived_at IS NULL GROUP BY state").bind(owner),
      ]);
      const a = au.results[0] as { at: number; data: string } | undefined;
      if (a && t - a.at < 5 * 60_000) {
        const audit = json<{ nodes?: number }>(a.data, {}), states = Object.fromEntries((ns.results as { state: string; n: number }[]).map(r => [r.state, r.n]));
        return c.json({ ok: true, items: items.length, dropped, nodes: audit.nodes ?? Object.values(states).reduce((x, n) => x + n, 0), states, audit, proposal_card: null, url: `${env(c).PUBLIC_URL}/#nodes`, same: true });
      }
    }
    for (let i = 0; i < st.length; i += 90) await DB.batch(st.slice(i, i + 90));
    const set = await DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(owner).first<{ data: string }>();
    const cur = json<{ unit?: Unit; unit_by?: string }>(set?.data, {});
    const fresh = items.length && !cur.unit && !(await DB.prepare("SELECT 1 FROM mnode WHERE owner = ? AND id NOT LIKE 'sl\\_%' ESCAPE '\\' AND id NOT LIKE 'tk\\_%' ESCAPE '\\' LIMIT 1").bind(owner).first());   // 업무 노드(tk_)만 있는 사람도 처음 들여오기
    let picked = fresh ? pickUnit(items, (b.roles || []).map(x => x.name)) : null;
    if (picked) await setUnit(env(c), owner, picked, "auto");
    const r = await regroup(env(c), owner);
    // 고른 뒤 카드 전에 끊겼으면(묶기 중 D1 오류 · Worker 내려감) 다시 올린 들여오기에서 카드를 이어서 — 아직 사람이 안 정했고(auto) 그 카드가 한 번도 없을 때만
    if (!picked && items.length && cur.unit && cur.unit_by === "auto" && !(await DB.prepare("SELECT 1 FROM board_card WHERE owner = ? AND win = ? AND question = ? LIMIT 1").bind(owner, IMPORT_WIN, UNIT_Q).first())) picked = cur.unit;
    if (picked) {
      const other: Unit = picked === "agent" ? "goal" : "agent", id = `${Math.floor(t / 1000)}.${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`;
      const body = picked === "agent" ? "쓰던 에이전트가 여럿이라 에이전트마다 채널로 묶었어요. 일은 그 채널의 대화로 들어가요." : "일마다 채널로 묶었어요.";
      await DB.prepare("INSERT INTO board_card(id, owner, win, question, choices, recommend, body, at) VALUES (?,?,?,?,?,?,?,?)").bind(id, owner, IMPORT_WIN, UNIT_Q, JSON.stringify([UNIT_CHOICE[picked], UNIT_CHOICE[other]]), UNIT_CHOICE[picked], `${body} 설정 › 노드에서도 바꿀 수 있어요.`, t).run();
    }
    let proposal: string | null = null;
    if ((b.connectors?.length || b.roles?.length)) proposal = await proposalFrom(env(c), owner, d.name, b.connectors || [], b.roles || []);
    const by = r.nodes.filter(n => !n.archived).reduce((a, n) => ({ ...a, [n.state]: (a[n.state] || 0) + 1 }), {} as Record<string, number>);
    return c.json({ ok: true, items: items.length, dropped, nodes: r.audit.nodes, states: by, audit: r.audit, proposal_card: proposal, url: `${env(c).PUBLIC_URL}/#nodes` });
  });

  app.get("/api/me/nodes", async c => {
    const me = await h.member(c); if (!me) return c.json({ error: "로그인" }, 401);
    const DB = env(c).DB;
    const [la, lw] = await DB.batch([
      DB.prepare("SELECT MAX(at) at FROM imp_audit WHERE owner = ?").bind(me),
      DB.prepare("SELECT MAX(x) at FROM (SELECT MAX(at) x FROM board_log WHERE owner = ? UNION ALL SELECT MAX(COALESCE(answered_at, at)) FROM board_card WHERE owner = ?)").bind(me, me),
    ]);
    const lastA = (la.results[0] as { at: number | null })?.at || 0, lastW = (lw.results[0] as { at: number | null })?.at || 0;
    if (lastW > lastA || (lastA && now() - lastA > 10 * 60_000)) await regroup(env(c), me);
    const [nd, mi, it, au, dv] = await DB.batch([
      DB.prepare("SELECT id, name, pinned_name, area, state, why, counts, updated_at, archived_at FROM mnode WHERE owner = ? AND (archived_at IS NULL OR archived_at > ?) ORDER BY updated_at DESC").bind(me, now() - 24 * 3600_000),
      DB.prepare("SELECT item, node, how FROM mnode_item WHERE owner = ?").bind(me),
      DB.prepare("SELECT key, kind, engine, title, cwd, repo, branch, refs, state, state_at, win, session, handle IS NOT NULL has_handle, device_id, seen_at, gone_at FROM imp_item WHERE owner = ? AND (gone_at IS NULL OR gone_at > ?)").bind(me, now() - 24 * 3600_000),
      DB.prepare("SELECT at, data FROM imp_audit WHERE owner = ? ORDER BY at DESC LIMIT 1").bind(me),
      DB.prepare("SELECT id, name, features, engine, engine_at FROM device WHERE owner = ? AND revoked_at IS NULL").bind(me),
    ]);
    const items = new Map((it.results as { key: string }[]).map(r => [r.key, r]));
    const cmds = (await DB.prepare("SELECT id, device_id, verb, args, state, result, at FROM engine_cmd WHERE owner = ? AND at > ? ORDER BY at DESC LIMIT 40").bind(me, now() - 6 * 3600_000).all()).results as { args: string; state: string }[];
    const byNode = new Map<string, unknown[]>();
    for (const m of mi.results as { item: string; node: string; how: string }[]) {
      const i = items.get(m.item) as Record<string, unknown> | undefined;
      const row = i ? { ...i, refs: json(i.refs as string, []), how: m.how } : { key: m.item, kind: "window", engine: "report", title: m.item.replace(/^win:[^:]*:/, ""), win: m.item.slice(4), how: m.how };
      (byNode.get(m.node) || byNode.set(m.node, []).get(m.node)!).push(row);
    }
    const nodes = (nd.results as { id: string; counts: string; archived_at: number | null }[]).map(n => ({ ...n, counts: json(n.counts, {}), items: byNode.get(n.id) || [] }));
    const audit = au.results[0] ? { at: (au.results[0] as { at: number }).at, ...json((au.results[0] as { data: string }).data, {}) } : null;
    // 엔진: 보고(features)로 켠 기기 + 엔진 데몬이 최근 붙어 알려 준 기기(SDK 엔진은 features 를 안 올림) — 화면의 엔진 칸이 이 값으로 뜸(device-engine.ts)
    const devices = (dv.results as { id: string; name: string; features: string | null; engine: string | null; engine_at: number | null }[]).map(x => ({ id: x.id, name: x.name, features: deviceFeatures(x.features, x.engine, x.engine_at) }));
    return c.json({ nodes, audit, devices, cmds: cmds.map(x => ({ ...x, args: json(x.args, {}) })), imports: await imported(env(c), me) }, 200, { "cache-control": "no-store" });
  });

  const closer = async (c: C, write: boolean) => (!write || h.sameSite(c) ? await h.member(c) : null) || (await h.device(c))?.owner || null;
  const closedOf = async (DB: D1Database, me: string) => new Set(json<{ closed?: unknown }>((await DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me).first<{ data: string }>())?.data, {}).closed as string[] || []);
  app.get("/api/me/nodes/list", async c => {
    const me = await closer(c, false); if (!me) return c.json({ error: "로그인" }, 401);
    const DB = env(c).DB, closed = await closedOf(DB, me);
    const q = (cols: string) => DB.prepare(`SELECT id, name, pinned_name, area, state, archived_at${cols} FROM mnode WHERE owner = ? ORDER BY updated_at DESC LIMIT 1000`).bind(me).all();
    const rows = (await q(", task").catch(e => /no such column/i.test(String(e)) ? q("") : Promise.reject(e))).results as { id: string; name: string; pinned_name: string | null; area: string | null; state: string; archived_at: number | null; task?: string | null }[];
    const parent = json<{ parent?: Record<string, string> }>((await DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me).first<{ data: string }>())?.data, {}).parent || {};
    return c.json({ nodes: rows.map(r => ({ id: r.id, name: r.pinned_name || r.name, area: r.area || "", state: r.state, archived: !!r.archived_at, closed: closed.has(r.id), parent: parent[r.id] || null, ...(r.task ? { task: json(r.task, {}) } : {}) })) }, 200, { "cache-control": "no-store" });   // task = 업무 노드(tk_) 값
  });
  app.post("/api/me/nodes/parent", async c => {
    const me = await closer(c, true); if (!me) return c.json({ error: "로그인" }, 401);
    const b = await c.req.json<{ node?: unknown; parent?: unknown }>().catch(() => ({} as { node?: unknown; parent?: unknown }));
    let node = typeof b.node === "string" ? b.node : "", parent = b.parent === null ? null : typeof b.parent === "string" ? b.parent : undefined;
    if (!node || node.length > 80 || parent === undefined || (parent && (parent.length > 80 || parent === node))) return c.json({ error: "노드 · 상위" }, 400);
    const DB = env(c).DB;
    if (node.startsWith("%") || (parent && parent.startsWith("%"))) {
      const ids = ((await DB.prepare("SELECT id FROM mnode WHERE owner = ?").bind(me).all()).results as { id: string }[]).map(r => r.id);
      const byPane = (p: string) => ids.find(id => paneOfId(id) === p) || p;
      if (node.startsWith("%")) node = byPane(node);
      if (parent && parent.startsWith("%")) parent = parent === "%1" ? "top" : byPane(parent);
      if (parent === node) return c.json({ error: "노드 · 상위" }, 400);
    }
    const want = parent && parent !== "top" ? [node, parent] : [node];   // "top" = 맨 위(열 머리) 표지
    const mine = ((await DB.prepare("SELECT id FROM mnode WHERE owner = ? AND id IN (SELECT value FROM json_each(?))").bind(me, JSON.stringify(want)).all()).results as { id: string }[]).length;
    if (mine !== want.length) return c.json({ error: "없는 노드" }, 404);
    const cur = json<{ parent?: Record<string, string> }>((await DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me).first<{ data: string }>())?.data, {}).parent || {};
    for (let x: string | undefined = parent || undefined, i = 0; x && x !== "top" && i < 50; i++, x = cur[x]) if (cur[x] === node) return c.json({ error: "서로 상위가 될 수 없어요" }, 400);
    await parentStmt(DB, me, { [node]: parent }).run();
    return c.json({ ok: true, node, parent });
  });

  app.post("/api/device/pins", async c => {
    const me = await closer(c, true); if (!me) return c.json({ error: "기기 토큰" }, 401);
    const pins = cleanPins((Object(await c.req.json().catch(() => ({}))) as { pins?: unknown }).pins);
    if (!pins) return c.json({ error: "캔버스 주소가 틀렸거나 12개를 넘었어요" }, 400);
    await savePins(env(c).DB, me, pins);
    return c.json({ ok: true, pins });
  });
  app.post("/api/device/tasks", async c => {
    const me = await closer(c, true); if (!me) return c.json({ error: "기기 토큰" }, 401);
    if (+(c.req.header("content-length") || 0) > 1_000_000) return c.json({ error: "너무 큼" }, 413);
    const p = TasksIn.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: p.error.issues.slice(0, 3).map(i => `${i.path.join(".")} ${i.message}`).join("; ") }, 400);
    const tasks = p.data.tasks, ids = tasks.map(t => "tk_" + t.key);
    if (new Set(ids).size !== ids.length) return c.json({ error: "같은 key 가 두 번" }, 400);
    const DB = env(c).DB, t0 = now();
    const want = [...new Set([...ids, ...tasks.map(t => t.parent).filter((x): x is string => !!x && x !== TOP && !ids.includes(x))])];
    type Row = { id: string; name: string; pinned_name: string | null; area: string; state: string; why: string; task: string | null; archived_at: number | null };
    const have = new Map(((await DB.prepare("SELECT id, name, pinned_name, area, state, why, task, archived_at FROM mnode WHERE owner = ? AND id IN (SELECT value FROM json_each(?))").bind(me, JSON.stringify(want)).all()).results as Row[]).map(r => [r.id, r]));
    const nameless = tasks.filter((t, i) => !have.has(ids[i]) && !t.name).map(t => t.key);
    if (nameless.length) return c.json({ error: "새 업무엔 이름", keys: nameless }, 400);
    const missing = want.filter(id => !ids.includes(id) && !have.has(id));
    if (missing.length) return c.json({ error: "없는 노드", missing }, 404);   // 남의 노드 · 없는 id
    const cur = { ...json<{ parent?: Record<string, string> }>((await DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me).first<{ data: string }>())?.data, {}).parent || {} };
    const patch: Record<string, string | null> = {};
    tasks.forEach((t, i) => { if (t.parent !== undefined && (cur[ids[i]] ?? null) !== t.parent) patch[ids[i]] = t.parent; });   // 바뀐 상위만
    for (const [k, v] of Object.entries(patch)) if (v === null) delete cur[k]; else cur[k] = v;
    // 고리 막기: 바꾼 노드마다 위로 따라가 제가 다시 나오면 안 됨(이미 있는 사슬과 이번 묶음을 합친 것으로 — 저를 상위로 둔 것도 여기서 걸림)
    for (const id of Object.keys(patch)) for (let x: string | undefined = cur[id], i = 0; x && x !== TOP && i < 60; i++, x = cur[x]) if (x === id) return c.json({ error: "서로 상위가 될 수 없어요" }, 400);
    const wanted = [...new Set(tasks.flatMap(t => t.name ? [t.name] : []))], holders = new Map<string, Set<string>>();
    for (const r of (await DB.prepare("SELECT id, name FROM mnode WHERE owner = ? AND name IN (SELECT value FROM json_each(?))").bind(me, JSON.stringify(wanted)).all()).results as { id: string; name: string }[]) holders.set(r.name, (holders.get(r.name) || new Set()).add(r.id));
    const uniq = (want: string, id: string, key: string) => {
      const on = have.get(id)?.name, tagged = `${want} · ${key}`, h = holders.get(want) || new Set<string>(), others = [...h].filter(x => x !== id);
      if (on === tagged) return tagged;
      if (on === want ? others.some(x => x < id) : others.length) return tagged;
      holders.set(want, h.add(id));
      return want;
    };
    const st: D1PreparedStatement[] = [];
    let freed = false;
    const out = tasks.map((t, i) => {
      const id = ids[i], o = have.get(id), was = json<Task>(o?.task, { state: "working", line: "", body: "", issue: "" });
      const issue = t.issue === undefined ? was.issue : t.issue === null ? "" : typeof t.issue === "number" || /^\d+$/.test(t.issue) ? "#" + t.issue : t.issue;
      const fields = t.fields ?? was.fields, task: Task = { state: t.state ?? was.state, line: t.line ?? was.line, body: t.body ?? was.body, issue, ...((t.confirm ?? was.confirm) ? { confirm: true as const } : {}), ...(fields ? { fields } : {}) };
      const name = t.name ? uniq(t.name, id, t.key) : o?.name || "업무", pinned = t.name ? null : o?.pinned_name ?? null, area = t.area ?? o?.area ?? "", state = TASK_NODE_STATE[task.state], why = task.line.slice(0, 80), tj = JSON.stringify(task);
      const done = task.state === "done" || task.state === "cancelled", arch = done ? o?.archived_at ?? t0 : null;
      if (o && o.name === name && (o.pinned_name ?? null) === pinned && o.area === area && o.state === state && o.why === why && o.task === tj && (o.archived_at ?? null) === arch) return { key: t.key, id, created: false, changed: false };
      if (done && o && !o.archived_at) { freed = true; st.push(DB.prepare("DELETE FROM mnode_item WHERE owner = ? AND node = ? AND how = 'pin'").bind(me, id), DB.prepare("UPDATE mnode SET counts = json_remove(CASE WHEN json_valid(counts) THEN counts ELSE '{}' END, '$.main') WHERE owner = ? AND id = ?").bind(me, id)); }
      st.push(DB.prepare(
        "INSERT INTO mnode(owner, id, name, pinned_name, area, state, why, counts, task, created_at, updated_at, archived_at) VALUES (?,?,?,?,?,?,?,'{}',?,?,?,?) " +
        "ON CONFLICT(owner, id) DO UPDATE SET name = excluded.name, pinned_name = excluded.pinned_name, area = excluded.area, state = excluded.state, why = excluded.why, task = excluded.task, updated_at = excluded.updated_at, archived_at = excluded.archived_at")
        .bind(me, id, name, pinned, area, state, why, tj, t0, t0, arch));
      return { key: t.key, id, created: !o, changed: true };
    });
    if (Object.keys(patch).length) st.push(parentStmt(DB, me, patch));
    if (st.length) await DB.batch(st);   // 노드 · 상위를 한 번에(D1 batch = 한 트랜잭션) — 노드만 서고 상위가 빠진 채 남지 않게
    if (freed) await regroup(env(c), me);   // 놓아준 창을 제자리로
    return c.json({ ok: true, nodes: out, changed: out.filter(x => x.changed).length, parents: Object.keys(patch).length });
  });
  const taskNode = async (DB: D1Database, me: string, node: unknown) => typeof node === "string" && /^tk_/.test(node) ? await DB.prepare("SELECT id, counts, archived_at FROM mnode WHERE owner = ? AND id = ?").bind(me, node).first<{ id: string; counts: string; archived_at: number | null }>() : null;
  app.post("/api/device/tasks/attach", async c => {
    const me = await closer(c, true); if (!me) return c.json({ error: "기기 토큰" }, 401);
    const b = await c.req.json<{ node?: unknown; item?: unknown }>().catch(() => ({} as { node?: unknown; item?: unknown }));
    if (typeof b.node === "string" && b.node && !b.node.startsWith("tk_")) return c.json({ error: "업무 노드(tk_)만 — 보통 노드는 보드에서 옮겨요" }, 400);
    const DB = env(c).DB, n = await taskNode(DB, me, b.node);
    if (!n) return c.json({ error: "없는 업무 노드" }, 404);
    if (n.archived_at) return c.json({ error: "끝난 업무예요" }, 400);
    const item = typeof b.item === "string" ? b.item : "";
    // 글을 넣을 수 있는 창만: 보고만 하는 창(engine report) · 끊긴 기기 창은 안 됨
    const w = await DB.prepare("SELECT i.key, i.session FROM imp_item i JOIN device d ON d.id = i.device_id AND d.revoked_at IS NULL WHERE i.owner = ? AND i.key = ? AND i.kind = 'window' AND i.gone_at IS NULL AND i.engine != 'report'").bind(me, item).first<{ key: string; session: string }>();
    if (!w) return c.json({ error: "없는 창" }, 404);
    const keys = [w.key, ...(w.session ? ((await DB.prepare("SELECT key FROM imp_item WHERE owner = ? AND (key = ? OR session = ?)").bind(me, w.session, w.session).all()).results as { key: string }[]).map(r => r.key) : [])];
    await DB.batch([
      ...[...new Set(keys)].map(k => DB.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?, 'pin') ON CONFLICT(owner, item) DO UPDATE SET node = excluded.node, how = 'pin'").bind(me, k, n.id)),
      DB.prepare("UPDATE mnode SET counts = json_set(CASE WHEN json_valid(counts) THEN counts ELSE '{}' END, '$.main', ?), updated_at = ? WHERE owner = ? AND id = ?").bind(w.key, now(), me, n.id),
      DB.prepare("UPDATE mnode SET counts = json_remove(counts, '$.main') WHERE owner = ? AND id LIKE 'tk\\_%' ESCAPE '\\' AND id != ? AND json_valid(counts) AND json_extract(counts, '$.main') = ?").bind(me, n.id, w.key),   // 옮겨 온 창이 주 창이던 다른 업무 노드
    ]);
    await regroup(env(c), me);   // 창이 떠난 옛 노드를 다시 묶음(보드 옮기기와 같음)
    return c.json({ ok: true, node: n.id, items: [...new Set(keys)] });
  });
  app.post("/api/device/tasks/detach", async c => {
    const me = await closer(c, true); if (!me) return c.json({ error: "기기 토큰" }, 401);
    const b = await c.req.json<{ node?: unknown; item?: unknown }>().catch(() => ({} as { node?: unknown; item?: unknown }));
    const DB = env(c).DB, n = await taskNode(DB, me, b.node);
    if (!n) return c.json({ error: "없는 업무 노드" }, 404);
    // item 이 있으면 그 창과 같은 대화 항목만, 없으면 이 노드에 pin 된 것 전부
    let keys: string[];
    if (typeof b.item === "string" && b.item) {
      const w = await DB.prepare("SELECT key, session FROM imp_item WHERE owner = ? AND key = ?").bind(me, b.item).first<{ key: string; session: string }>();
      keys = w ? [w.key, ...(w.session ? ((await DB.prepare("SELECT key FROM imp_item WHERE owner = ? AND (key = ? OR session = ?)").bind(me, w.session, w.session).all()).results as { key: string }[]).map(r => r.key) : [])] : [b.item];
    } else keys = ((await DB.prepare("SELECT item FROM mnode_item WHERE owner = ? AND node = ?").bind(me, n.id).all()).results as { item: string }[]).map(r => r.item);
    const main = json<{ main?: string }>(n.counts, {}).main;
    await DB.batch([
      DB.prepare("DELETE FROM mnode_item WHERE owner = ? AND node = ? AND item IN (SELECT value FROM json_each(?))").bind(me, n.id, JSON.stringify([...new Set(keys)])),
      ...(main && (!b.item || keys.includes(main)) ? [DB.prepare("UPDATE mnode SET counts = json_remove(CASE WHEN json_valid(counts) THEN counts ELSE '{}' END, '$.main'), updated_at = ? WHERE owner = ? AND id = ?").bind(now(), me, n.id)] : []),
    ]);
    await regroup(env(c), me);   // 뗀 창은 다음 묶기가 정한 제자리로
    return c.json({ ok: true, node: n.id, items: [...new Set(keys)] });
  });
  app.post("/api/device/assigner", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const b = await c.req.json<{ on?: unknown }>().catch(() => ({} as { on?: unknown }));
    if (typeof b.on !== "boolean") return c.json({ error: "on" }, 400);
    const DB = env(c).DB;
    // 배정기를 바꾸거나 끄면 옛 기기 줄에 남은 assign 은 실패로(새 기기로 옮기지 않음 — 화면에 「못 넣음」, 사람이 다시 보냄)
    await DB.prepare(`UPDATE engine_cmd SET state = 'failed', result = '배정기가 바뀜', done_at = ?1 WHERE owner = ?2 AND verb = 'assign' AND state = 'queued' AND device_id ${b.on ? "!=" : "="} ?3`).bind(now(), d.owner, d.id).run();
    if (b.on) await DB.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?1, json_object('assigner', ?2), ?3) ON CONFLICT(owner) DO UPDATE SET data = json_set(CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END, '$.assigner', ?2), updated_at = ?3").bind(d.owner, d.id, now()).run();
    else await DB.prepare("UPDATE node_setting SET data = json_remove(data, '$.assigner'), updated_at = ?3 WHERE owner = ?1 AND json_valid(data) AND json_extract(data, '$.assigner') = ?2").bind(d.owner, d.id, now()).run();   // 남이 정한 배정기는 안 지움
    return c.json({ ok: true, assigner: b.on ? d.id : null });
  });
  app.post("/api/me/tasks/assign", async c => {
    if (!h.sameSite(c)) return c.json({ error: "no" }, 403);
    const me = await h.member(c); if (!me) return c.json({ error: "로그인" }, 401);
    const b = await c.req.json<{ node?: unknown; text?: unknown; thread?: unknown }>().catch(() => ({} as Record<string, unknown>));
    const text = String(b.text || "").replace(CTRL, " ").trim().slice(0, 2000), thread = typeof b.thread === "string" && /^\d{10}\.\d{6}$/.test(b.thread) ? b.thread : null;
    if (!text) return c.json({ error: "보낼 글" }, 400);
    const DB = env(c).DB;
    const n = typeof b.node === "string" && b.node.startsWith("tk_") ? await DB.prepare("SELECT id, COALESCE(pinned_name, name) name FROM mnode WHERE owner = ? AND id = ?").bind(me, b.node).first<{ id: string; name: string }>() : null;
    if (!n) return c.json({ error: "없는 업무 노드" }, 404);
    const dev = await DB.prepare("SELECT d.id FROM node_setting s JOIN device d ON d.id = json_extract(s.data, '$.assigner') AND d.owner = s.owner AND d.revoked_at IS NULL WHERE s.owner = ? AND json_valid(s.data)").bind(me).first<{ id: string }>();
    if (!dev) return c.json({ error: "이 업무 노드엔 글을 받을 기기가 없어요" }, 400);
    return c.json({ ok: true, cmds: [await queue(env(c), me, dev.id, "assign", { node: n.id, name: n.name, text, thread, post: true })] });
  });
  app.post("/api/me/nodes/close", async c => {
    const me = await closer(c, true); if (!me) return c.json({ error: "로그인" }, 401);
    const b = await c.req.json<{ nodes?: unknown; open?: boolean }>().catch(() => ({} as { nodes?: unknown; open?: boolean }));
    const ids = Array.isArray(b.nodes) ? [...new Set(b.nodes.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80))] : [];
    if (!ids.length || ids.length > 300) return c.json({ error: "노드 1~300개" }, 400);
    const DB = env(c).DB;
    const mine = new Set(((await DB.prepare("SELECT id FROM mnode WHERE owner = ? AND id IN (SELECT value FROM json_each(?))").bind(me, JSON.stringify(ids)).all()).results as { id: string }[]).map(r => r.id));
    const missing = ids.filter(id => !mine.has(id));
    if (missing.length) return c.json({ error: "없는 노드", missing }, 404);   // 남의 노드 · 없는 id — 하나라도 있으면 아무것도 안 바꿈
    const closed = await closedOf(DB, me);
    for (const id of ids) b.open ? closed.delete(id) : closed.add(id);
    const list = JSON.stringify([...closed].slice(-2000));
    await DB.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?1, json_object('closed', json(?2)), ?3) ON CONFLICT(owner) DO UPDATE SET data = json_set(CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END, '$.closed', json(?2)), updated_at = ?3").bind(me, list, now()).run();
    return c.json({ ok: true, closed: closed.size, changed: ids.length });
  });

  // 이름 짓기 · 옮기기 · 합치기 — 사람이 정한 것은 pin(다시 묶어도 이김)
  app.post("/api/me/nodes/edit", async c => {
    if (!h.sameSite(c)) return c.json({ error: "no" }, 403);
    const me = await h.member(c); if (!me) return c.json({ error: "로그인" }, 401);
    const b = await c.req.json<{ op?: string; node?: string; name?: string; item?: string; to?: string }>().catch(() => ({} as Record<string, string>));
    const DB = env(c).DB;
    const own = async (id?: string) => !!id && !!(await DB.prepare("SELECT 1 FROM mnode WHERE owner = ? AND id = ?").bind(me, id).first());
    if (b.op === "rename") {
      if (!(await own(b.node))) return c.json({ error: "없는 노드" }, 404);
      const name = String(b.name || "").replace(CTRL, "").trim().slice(0, 60);
      await DB.prepare("UPDATE mnode SET pinned_name = ?, name = COALESCE(?, name) WHERE owner = ? AND id = ?").bind(name || null, name || null, me, b.node).run();
      return c.json({ ok: true });
    }
    if (b.op === "move") {   // 항목(과 같은 세션을 쓰는 것) → 노드(to = 'new' 면 새 노드)
      const it = await DB.prepare("SELECT item FROM mnode_item WHERE owner = ? AND item = ?").bind(me, b.item || "").first<{ item: string }>();
      if (!it) return c.json({ error: "없는 항목" }, 404);
      let to = b.to || "";
      if (to === "new") { to = "n_" + rid().slice(0, 12); await DB.prepare("INSERT INTO mnode(owner, id, name, created_at, updated_at) VALUES (?,?,?,?,?)").bind(me, to, "새 노드", now(), now()).run(); }
      else if (!(await own(to))) return c.json({ error: "없는 노드" }, 404);
      const sess = await DB.prepare("SELECT session FROM imp_item WHERE owner = ? AND key = ?").bind(me, it.item).first<{ session: string }>();
      const keys = [it.item, ...(sess?.session ? ((await DB.prepare("SELECT key FROM imp_item WHERE owner = ? AND (key = ? OR session = ?)").bind(me, sess.session, sess.session).all()).results as { key: string }[]).map(r => r.key) : [])];
      await DB.batch([...new Set(keys)].map(k => DB.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?, 'pin') ON CONFLICT(owner, item) DO UPDATE SET node = excluded.node, how = 'pin'").bind(me, k, to)));
      await regroup(env(c), me);
      return c.json({ ok: true, node: to });
    }
    if (b.op === "merge") {   // node 를 to 에 합침
      if (!(await own(b.node)) || !(await own(b.to)) || b.node === b.to) return c.json({ error: "없는 노드" }, 404);
      await DB.prepare("UPDATE mnode_item SET node = ?, how = 'pin' WHERE owner = ? AND node = ?").bind(b.to, me, b.node).run();
      await regroup(env(c), me);
      return c.json({ ok: true, node: b.to });
    }
    if (b.op === "reopen") {   // 보관함 다시 열기 — 사람이 정한 것이라 다시 묶어도 안 내려감(pinned_name)
      const n = await DB.prepare("SELECT name FROM mnode WHERE owner = ? AND id = ?").bind(me, b.node || "").first<{ name: string }>();
      if (!n) return c.json({ error: "없는 노드" }, 404);
      const set = await DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me).first<{ data: string }>();
      if (!json<{ unit?: Unit }>(set?.data, {}).unit) return c.json({ error: "다시 열 수 없어요" }, 409);   // 고르기 전엔 보관함이 없음(예전 그대로)
      if (!(await DB.prepare("SELECT 1 FROM mnode_item m JOIN imp_item i ON i.owner = m.owner AND i.key = m.item WHERE m.owner = ? AND m.node = ? AND i.gone_at IS NULL LIMIT 1").bind(me, b.node).first())) return c.json({ error: "다시 열 수 없어요" }, 409);
      await DB.prepare("UPDATE mnode SET archived_at = NULL, pinned_name = COALESCE(pinned_name, ?), updated_at = ? WHERE owner = ? AND id = ?").bind(n.name, now(), me, b.node).run();
      await DB.prepare("UPDATE node_setting SET data = json_set(data, '$.closed', (SELECT json_group_array(value) FROM json_each(data, '$.closed') WHERE value != ?2)), updated_at = ?3 WHERE owner = ?1 AND json_valid(data) AND json_type(data, '$.closed') = 'array'").bind(me, b.node, now()).run();
      await regroup(env(c), me);
      return c.json({ ok: true, node: b.node });
    }
    return c.json({ error: "op" }, 400);
  });

  app.post("/api/me/nodes/cmd", async c => {
    if (!h.sameSite(c)) return c.json({ error: "no" }, 403);
    const me = await h.member(c); if (!me) return c.json({ error: "로그인" }, 401);
    const b = await c.req.json<{ verb?: string; item?: string; node?: string; text?: string }>().catch(() => ({} as Record<string, string>));
    if (!["move", "park", "reopen", "send", "focus"].includes(b.verb || "")) return c.json({ error: "verb" }, 400);
    const text = String(b.text || "").replace(CTRL, " ").trim().slice(0, 2000);
    if (b.verb === "send" && (!text || b.node)) return c.json({ error: "보낼 글" }, 400);
    if (b.verb === "focus" && b.node) return c.json({ error: "창 하나" }, 400);
    const DB = env(c).DB;
    const keys = b.node
      ? ((await DB.prepare("SELECT i.key FROM mnode_item m JOIN imp_item i ON i.owner = m.owner AND i.key = m.item WHERE m.owner = ? AND m.node = ? AND i.kind = 'window' AND i.gone_at IS NULL").bind(me, b.node).all()).results as { key: string }[]).map(r => r.key)
      : [b.item || ""];
    const out: string[] = [];
    for (const k of keys) {
      const w = await DB.prepare("SELECT i.key, i.device_id, i.engine, i.handle, i.state, i.title, d.features FROM imp_item i LEFT JOIN device d ON d.id = i.device_id WHERE i.owner = ? AND i.key = ? AND i.kind = 'window'").bind(me, k).first<{ key: string; device_id: string; engine: string; handle: string | null; state: string; title: string; features: string | null }>();
      if (!w?.device_id) continue;
      const f = json<{ engine?: boolean } | null>(w.features, null);
      if (f && !f.engine && ["move", "park", "reopen"].includes(b.verb!) && w.engine !== "tmux") continue;
      if (b.verb === "move" && w.engine === "tmux") continue;   // 이미 우리 엔진
      if (w.engine === "herdr-own" && !["send", "focus"].includes(b.verb!)) continue;
      if (b.verb === "send") {
        out.push(await queue(env(c), me, w.device_id, "send", { item: w.key, engine: w.engine, handle: json(w.handle, null), title: w.title, text, post: true }));
        c.executionCtx.waitUntil((engineOf(env(c) as never, w.device_id) as unknown as { drainCmds(): Promise<unknown> }).drainCmds().catch(() => null));
        continue;
      }
      const dup = await DB.prepare("SELECT 1 FROM engine_cmd WHERE owner = ? AND state IN ('queued','taken') AND verb = ? AND args LIKE ?").bind(me, b.verb, `%"item":${JSON.stringify(k)}%`).first();
      if (b.verb === "reopen" && text) { out.push(await queue(env(c), me, w.device_id, dup ? "send" : "reopen", { item: w.key, engine: w.engine, handle: json(w.handle, null), title: w.title, text, post: true })); continue; }
      if (dup) continue;   // 같은 명령이 이미 대기
      out.push(await queue(env(c), me, w.device_id, b.verb!, { item: w.key, engine: w.engine, handle: json(w.handle, null), title: w.title }));
    }
    if (!out.length) return c.json({ error: b.verb === "move" ? "옮길 창이 없어요" : "할 창이 없어요" }, 404);
    return c.json({ ok: true, cmds: out });
  });

  // 설정에서 켜고 끄기(보고 · 엔진) — 그 사람이 누른 것만 기기로 감
  app.post("/api/me/devices/:id/feature", async c => {
    if (!h.sameSite(c)) return c.json({ error: "no" }, 403);
    const me = await h.member(c); if (!me) return c.json({ error: "로그인" }, 401);
    const b = await c.req.json<{ what?: string; on?: boolean }>().catch(() => ({} as { what?: string; on?: boolean }));
    if (!["report", "engine"].includes(b.what || "") || typeof b.on !== "boolean") return c.json({ error: "what · on" }, 400);
    const DB = env(c).DB, dev = await DB.prepare("SELECT id FROM device WHERE id = ? AND owner = ? AND revoked_at IS NULL").bind(c.req.param("id"), me).first<{ id: string }>();
    if (!dev) return c.json({ error: "없는 기기" }, 404);
    await DB.prepare("UPDATE engine_cmd SET state = 'failed', result = '새 설정으로 바뀜' WHERE owner = ? AND device_id = ? AND verb = 'feature' AND state = 'queued' AND args LIKE ?").bind(me, dev.id, `%"what":"${b.what}"%`).run();
    return c.json({ ok: true, cmd: await queue(env(c), me, dev.id, "feature", { what: b.what, on: b.on }) });
  });
  // boarder uninstall — 기기가 스스로 폐기(그 뒤 그 토큰은 안 먹음)
  app.post("/api/device/revoke", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    await env(c).DB.prepare("UPDATE device SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now(), d.id).run();
    return c.json({ ok: true });
  });

  app.get("/api/device/cmds", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const DB = env(c).DB, t = now();
    // 가져가고 3분 넘게 결과가 없으면 다시 줌(기기가 중간에 죽은 것)
    await DB.prepare("UPDATE engine_cmd SET state = 'queued' WHERE device_id = ? AND state = 'taken' AND taken_at < ?").bind(d.id, t - 180_000).run();
    await DB.prepare("UPDATE engine_cmd SET state = 'failed', result = '오래돼 안 넣음', done_at = ? WHERE device_id = ? AND state = 'queued' AND verb IN ('send', 'reopen', 'assign') AND at < ? AND args LIKE '%\"post\":true%'").bind(t, d.id, t - 6 * 3600_000).run();
    const only = c.req.query("only") === "assign";
    const rs = ((await DB.prepare(`UPDATE engine_cmd SET state = 'taken', taken_at = ? WHERE id IN (SELECT id FROM engine_cmd WHERE device_id = ? AND state = 'queued' AND verb ${only ? "=" : "!="} 'assign' ORDER BY at LIMIT 10) AND state = 'queued' RETURNING id, verb, args, at`).bind(t, d.id).all()).results as { id: string; verb: string; args: string; at: number }[]).sort((a, b) => a.at - b.at);
    const cmds = await Promise.all(rs.map(async r => { const a = json<Record<string, unknown>>(r.args, {});
      if (r.verb === "send" && a.fresh && !a.handle && typeof a.item === "string") a.handle = json((await DB.prepare("SELECT handle FROM imp_item WHERE owner = ? AND key = ?").bind(d.owner, a.item).first<{ handle: string | null }>())?.handle, null);
      return { ...r, args: a }; }));
    return c.json({ cmds }, 200, { "cache-control": "no-store" });
  });

  const CmdOut = z.object({ ok: z.boolean(), error: s(300).optional(), note: s(300).optional(), item: z.record(z.string(), z.unknown()).optional() });
  app.post("/api/device/cmds/:id", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const p = CmdOut.safeParse(await c.req.json().catch(() => null)); if (!p.success) return c.json({ error: "몸" }, 400);
    const DB = env(c).DB, id = c.req.param("id"), t = now();
    const cmd = await DB.prepare("SELECT verb, args FROM engine_cmd WHERE id = ? AND device_id = ? AND state IN ('taken', 'waiting')").bind(id, d.id).first<{ verb: string; args: string }>();
    if (!cmd) return c.json({ error: "없는 명령" }, 404);
    const queued = p.data.ok && cmd.verb === "send" && p.data.item?.queued === true;
    await DB.prepare("UPDATE engine_cmd SET state = ?, result = ?, done_at = ? WHERE id = ?").bind(queued ? "waiting" : p.data.ok ? "done" : "failed", JSON.stringify(p.data).slice(0, 2000), queued ? null : t, id).run();
    const a = json<{ item?: string; title?: string; card?: string }>(cmd.args, {});
    const w = a.item ? await DB.prepare("SELECT win FROM imp_item WHERE owner = ? AND key = ?").bind(d.owner, a.item).first<{ win: string }>() : null;
    const say = (text: string, kind = "progress") => DB.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").bind(d.owner, w?.win || `${d.name}:boarder`, kind, text, t).run();
    if (p.data.ok && p.data.note) await say(p.data.note, "blocked");
    if (queued) return c.json({ ok: true });   // 창이 쉴 때 기기가 넣고 다시 알림 — 그때까지 화면엔 「넣음」 아님
    const what = { move: "보더 엔진으로 옮김", park: "주차", reopen: "다시 엶", send: "창에 글을 넣음", focus: "창을 엶", feature: "기기 설정 바꿈", assign: "업무 노드 글을 배정기에 넘김" }[cmd.verb] || cmd.verb;
    if (cmd.verb === "feature") {   // 켜고 끈 뒤 기기가 올린 지금 상태
      const f = (p.data.item as { features?: unknown } | undefined)?.features;
      // 꼴을 보고 그대로(예전엔 JSON 을 400자에서 잘라 폴더 목록이 길면 깨진 JSON 이 남았음)
      const ff = Features.safeParse(f);
      if (ff.success) await DB.prepare("UPDATE device SET features = ? WHERE id = ?").bind(JSON.stringify(ff.data), d.id).run();
      if (!p.data.ok) await say(`${d.name} — ${(a as { what?: string }).what === "engine" ? "보더 엔진" : "에이전트 보고"} 바꾸기 못 함: ${p.data.error || "오류"}`, "blocked");
      return c.json({ ok: true });
    }
    if (!p.data.ok) { await say(`${what} 못 함 — ${p.data.error || "오류"}`, "blocked"); return c.json({ ok: true }); }
    if (cmd.verb === "assign") return c.json({ ok: true });
    const ni = p.data.item as Partial<Record<string, string>> | undefined;
    if (a.item && cmd.verb === "move") await DB.prepare("UPDATE imp_item SET state = 'gone', gone_at = ?, state_at = ? WHERE owner = ? AND key = ?").bind(t, t, d.owner, a.item).run();
    else if (a.item && ni) await DB.prepare(`UPDATE imp_item SET state = COALESCE(?, state), state_at = ?, handle = COALESCE(?, handle)${cmd.verb === "reopen" ? ", gone_at = NULL" : ""} WHERE owner = ? AND key = ?`)
      .bind(ni.state ?? null, t, ni.handle ? JSON.stringify(ni.handle) : null, d.owner, a.item).run();
    if (cmd.verb === "move" && ni?.key) await DB.prepare(
      "INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, session, win, state, state_at, seen_at) VALUES (?,?,?, 'window', 'tmux', ?, ?, ?, ?, 'working', ?, ?) ON CONFLICT(owner, key) DO NOTHING")
      .bind(d.owner, String(ni.key).slice(0, 200), d.id, String(ni.title || a.title || "").slice(0, 140), String(ni.cwd || "").slice(0, 300), String(ni.session || "").slice(0, 200), String(ni.win || "").slice(0, 120), t, t).run();
    if (cmd.verb === "move" && ni?.key && a.item) {
      const pin = await DB.prepare("SELECT node FROM mnode_item WHERE owner = ? AND item = ? AND how = 'pin' AND node LIKE 'tk\\_%' ESCAPE '\\'").bind(d.owner, a.item).first<{ node: string }>();
      if (pin) await DB.batch([
        DB.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?, 'pin') ON CONFLICT(owner, item) DO UPDATE SET node = excluded.node, how = 'pin'").bind(d.owner, String(ni.key).slice(0, 200), pin.node),
        DB.prepare("UPDATE mnode SET counts = json_set(counts, '$.main', ?) WHERE owner = ? AND id = ? AND json_valid(counts) AND json_extract(counts, '$.main') = ?").bind(String(ni.key).slice(0, 200), d.owner, pin.node, a.item),
      ]);
    }
    if (cmd.verb === "move" && ni?.key && /^ew_[a-z0-9]{6,30}$/.test(String(ni.id || "")) && !widPane(String(ni.id))) {
      try {
        await DB.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, handle, created_at) VALUES (?,?,?, 'role', ?, 'busy', ?, ?, ?) ON CONFLICT(id) DO NOTHING")
          .bind(String(ni.id), d.owner, d.id, String(ni.title || a.title || "").slice(0, 80), t, JSON.stringify(ni.handle || { engine: "tmux", id: ni.id, session_id: String(ni.session || "").split(":").pop(), cwd: ni.cwd }), t).run();
      } catch (e) { console.log("engine_window 없음 — 옮긴 창은 들여오기만 봄", String(e).slice(0, 80)); }
    }
    if (cmd.verb !== "send" && cmd.verb !== "focus") await say(`${what}${a.title ? ` — ${a.title}` : ""}`);
    await regroup(env(c), d.owner);
    return c.json({ ok: true });
  });
}

const env = (c: C) => c.env;
export { PROPOSAL_CHOICES };
