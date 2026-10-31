import type { Context, Hono } from "hono";
import { z } from "zod";
import { group, pickUnit, type Item, type Unit } from "./group";
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
  features: z.object({ report: z.array(z.enum(["claude", "codex", "cursor", "gemini"])).max(4), engine: z.boolean(), view: z.boolean().optional() }).optional(),   // 이 기기에서 그 사람이 켠 것
});

const now = () => Date.now();
const UNIT_Q = "노드를 어떻게 묶을까요?";
const UNIT_CHOICE: Record<Unit, string> = { agent: "에이전트마다 채널 · 일은 스레드", goal: "일마다 채널" };
export async function setUnit(env: Env, owner: string, unit: Unit, by: "auto" | "me") {
  const r = await env.DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(owner).first<{ data: string }>();
  const data = JSON.stringify({ ...json<Record<string, unknown>>(r?.data, {}), unit, unit_by: by });
  await env.DB.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(owner, data, now()).run();
  // 사람이 정했으면 남은 질문을 닫음 — 나중에 옛 질문에 답해 뒤집히지 않게
  if (by === "me") await env.DB.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE owner = ? AND win = ? AND question = ? AND state = 'open'").bind(UNIT_CHOICE[unit], owner, IMPORT_WIN, UNIT_Q).run();
}
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const json = <T>(v: string | null | undefined, d: T): T => { try { return v ? JSON.parse(v) as T : d; } catch { return d; } };

export async function regroup(env: Env, owner: string) {
  const t = now();
  const [it, lg, cd, mp, nd, wn, ns, rl] = await env.DB.batch([
    env.DB.prepare("SELECT key, kind, engine, title, cwd, repo, branch, refs, state, state_at, win, session, seen_at, gone_at FROM imp_item WHERE owner = ?").bind(owner),
    env.DB.prepare("SELECT win, kind, text, at FROM board_log WHERE owner = ? AND (thread IS NULL OR thread != 'primary') AND kind != 'me' ORDER BY at DESC LIMIT 400").bind(owner),
    env.DB.prepare("SELECT id, win, state, question, at FROM board_card WHERE owner = ? ORDER BY at DESC LIMIT 200").bind(owner),
    env.DB.prepare("SELECT item, node, how FROM mnode_item WHERE owner = ?").bind(owner),
    env.DB.prepare("SELECT id, name, pinned_name, area, state, why, counts, created_at, updated_at, archived_at FROM mnode WHERE owner = ?").bind(owner),
    env.DB.prepare("SELECT pane, win FROM agent_token WHERE owner = ? ORDER BY created_at").bind(owner),
    env.DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(owner),
    env.DB.prepare("SELECT name FROM role WHERE owner = ? UNION SELECT name FROM engine_window WHERE owner = ? AND kind = 'role' AND state NOT IN ('closed','failed','gone')").bind(owner, owner),
  ]);
  const items = (it.results as (Item & { refs: string })[]).map(r => ({ ...r, refs: json<string[]>(r.refs as unknown as string, []) }));
  const winNames = Object.fromEntries((wn.results as { pane: string; win: string }[]).map(r => [r.pane, r.win]));
  const keyOf = paneOf(wn.results as { pane: string; win: string }[]);
  const own = (w: string) => w === IMPORT_WIN || /(^|:)boarder(-|:)import$/.test(w);
  const logs = (lg.results as { win: string }[]).filter(l => !own(l.win)).map(l => ({ ...l, win: keyOf(l.win) }));
  const cards = (cd.results as { win: string }[]).filter(c => !own(c.win)).map(c => ({ ...c, win: keyOf(c.win) }));
  const set = json<{ archive_h?: number; unit?: Unit }>((ns.results[0] as { data?: string } | undefined)?.data, {}), archiveH = set.archive_h ?? 6;
  const r = await group({ items, logs: logs as never, cards: cards as never, prev: mp.results as never, prevNodes: nd.results as never, winNames, now: t, archiveH, unit: set.unit, agents: (rl.results as { name: string }[]).map(x => x.name) });
  const keep = new Set(r.nodes.map(n => n.id));
  const was = new Map((mp.results as { item: string; node: string; how: string }[]).map(m => [m.item, m]));
  const st: D1PreparedStatement[] = [];
  for (const m of r.map) { const o = was.get(m.item); if (!o || o.node !== m.node || o.how !== m.how) st.push(env.DB.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?) ON CONFLICT(owner, item) DO UPDATE SET node = excluded.node, how = excluded.how").bind(owner, m.item, m.node, m.how)); }
  const now_ = new Set(r.map.map(m => m.item)), gone = [...was.keys()].filter(k => !now_.has(k));
  for (let i = 0; i < gone.length; i += 80) st.push(env.DB.prepare(`DELETE FROM mnode_item WHERE owner = ? AND item IN (${gone.slice(i, i + 80).map(() => "?").join(",")})`).bind(owner, ...gone.slice(i, i + 80)));
  const old = new Map((nd.results as { id: string; name: string; area: string; state: string; why: string; counts: string; updated_at: number; archived_at: number | null }[]).map(n => [n.id, n]));
  for (const n of r.nodes) {
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

export async function onCardAnswered(env: Env, owner: string, cardId: string) {
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
  const tok = await env.DB.prepare("SELECT pane FROM agent_token WHERE owner = ? AND win = ? ORDER BY created_at DESC LIMIT 1").bind(owner, card.win).first<{ pane: string }>();
  const w = await env.DB.prepare("SELECT key, device_id, state, handle, engine FROM imp_item WHERE owner = ? AND win IN (?, ?) AND kind = 'window' AND gone_at IS NULL ORDER BY seen_at DESC LIMIT 1").bind(owner, tok?.pane || card.win, card.win).first<{ key: string; device_id: string; state: string; handle: string | null; engine: string }>();
  if (!w?.device_id) return;   // 들여오지 않은 창(보고만) — 창이 boarder wait 로 받음
  if (w.engine === "tmux") return;   // 우리 엔진 창(옮긴 것 포함)은 「Boarder tmux 엔진」 감독 규칙이 받음(engine_window · wid) — 두 번 넣지 않게
  const text = `[보더] 「${card.question.slice(0, 80)}」 답: ${card.answer} (카드 ${card.id}) — boarder close ${card.id} "<처리>" 로 닫아요`;
  await queue(env, owner, w.device_id, w.state === "parked" ? "reopen" : "send", { item: w.key, engine: w.engine, handle: json(w.handle, null), text, card: card.id });
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
    st.push(DB.prepare("DELETE FROM imp_item WHERE owner = ? AND gone_at < ?").bind(owner, t - 7 * 86400_000));
    for (let i = 0; i < st.length; i += 90) await DB.batch(st.slice(i, i + 90));
    const set = await DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(owner).first<{ data: string }>();
    const fresh = items.length && !json<{ unit?: Unit }>(set?.data, {}).unit && !(await DB.prepare("SELECT 1 FROM mnode WHERE owner = ? LIMIT 1").bind(owner).first());
    const picked = fresh ? pickUnit(items, (b.roles || []).map(x => x.name)) : null;
    if (picked) await setUnit(env(c), owner, picked, "auto");
    const r = await regroup(env(c), owner);
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
      DB.prepare("SELECT id, name, features FROM device WHERE owner = ? AND revoked_at IS NULL").bind(me),
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
    const devices = (dv.results as { id: string; name: string; features: string | null }[]).map(x => ({ id: x.id, name: x.name, features: json(x.features, null) }));
    return c.json({ nodes, audit, devices, cmds: cmds.map(x => ({ ...x, args: json(x.args, {}) })), imports: await imported(env(c), me) }, 200, { "cache-control": "no-store" });
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
      if (b.verb === "send") { out.push(await queue(env(c), me, w.device_id, "send", { item: w.key, engine: w.engine, handle: json(w.handle, null), title: w.title, text })); continue; }
      const dup = await DB.prepare("SELECT 1 FROM engine_cmd WHERE owner = ? AND state IN ('queued','taken') AND verb = ? AND args LIKE ?").bind(me, b.verb, `%"item":${JSON.stringify(k)}%`).first();
      if (b.verb === "reopen" && text) { out.push(await queue(env(c), me, w.device_id, dup ? "send" : "reopen", { item: w.key, engine: w.engine, handle: json(w.handle, null), title: w.title, text })); continue; }
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
    const rs = ((await DB.prepare("UPDATE engine_cmd SET state = 'taken', taken_at = ? WHERE id IN (SELECT id FROM engine_cmd WHERE device_id = ? AND state = 'queued' ORDER BY at LIMIT 10) AND state = 'queued' RETURNING id, verb, args, at").bind(t, d.id).all()).results as { id: string; verb: string; args: string; at: number }[]).sort((a, b) => a.at - b.at);
    return c.json({ cmds: rs.map(r => ({ ...r, args: json(r.args, {}) })) }, 200, { "cache-control": "no-store" });
  });

  const CmdOut = z.object({ ok: z.boolean(), error: s(300).optional(), item: z.record(z.string(), z.unknown()).optional() });
  app.post("/api/device/cmds/:id", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const p = CmdOut.safeParse(await c.req.json().catch(() => null)); if (!p.success) return c.json({ error: "몸" }, 400);
    const DB = env(c).DB, id = c.req.param("id"), t = now();
    const cmd = await DB.prepare("SELECT verb, args FROM engine_cmd WHERE id = ? AND device_id = ? AND state = 'taken'").bind(id, d.id).first<{ verb: string; args: string }>();
    if (!cmd) return c.json({ error: "없는 명령" }, 404);
    await DB.prepare("UPDATE engine_cmd SET state = ?, result = ?, done_at = ? WHERE id = ?").bind(p.data.ok ? "done" : "failed", JSON.stringify(p.data).slice(0, 2000), t, id).run();
    const a = json<{ item?: string; title?: string; card?: string }>(cmd.args, {});
    const w = a.item ? await DB.prepare("SELECT win FROM imp_item WHERE owner = ? AND key = ?").bind(d.owner, a.item).first<{ win: string }>() : null;
    const say = (text: string, kind = "progress") => DB.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").bind(d.owner, w?.win || `${d.name}:boarder`, kind, text, t).run();
    const what = { move: "보더 엔진으로 옮김", park: "주차", reopen: "다시 엶", send: "창에 글을 넣음", focus: "창을 엶", feature: "기기 설정 바꿈" }[cmd.verb] || cmd.verb;
    if (cmd.verb === "feature") {   // 켜고 끈 뒤 기기가 올린 지금 상태
      const f = (p.data.item as { features?: unknown } | undefined)?.features;
      if (f) await DB.prepare("UPDATE device SET features = ? WHERE id = ?").bind(JSON.stringify(f).slice(0, 400), d.id).run();
      if (!p.data.ok) await say(`${d.name} — ${(a as { what?: string }).what === "engine" ? "보더 엔진" : "에이전트 보고"} 바꾸기 못 함: ${p.data.error || "오류"}`, "blocked");
      return c.json({ ok: true });
    }
    if (!p.data.ok) { await say(`${what} 못 함 — ${p.data.error || "오류"}`, "blocked"); return c.json({ ok: true }); }
    const ni = p.data.item as Partial<Record<string, string>> | undefined;
    if (a.item && cmd.verb === "move") await DB.prepare("UPDATE imp_item SET state = 'gone', gone_at = ?, state_at = ? WHERE owner = ? AND key = ?").bind(t, t, d.owner, a.item).run();
    else if (a.item && ni) await DB.prepare("UPDATE imp_item SET state = COALESCE(?, state), state_at = ?, handle = COALESCE(?, handle) WHERE owner = ? AND key = ?")
      .bind(ni.state ?? null, t, ni.handle ? JSON.stringify(ni.handle) : null, d.owner, a.item).run();
    if (cmd.verb === "move" && ni?.key) await DB.prepare(
      "INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, session, win, state, state_at, seen_at) VALUES (?,?,?, 'window', 'tmux', ?, ?, ?, ?, 'working', ?, ?) ON CONFLICT(owner, key) DO NOTHING")
      .bind(d.owner, String(ni.key).slice(0, 200), d.id, String(ni.title || a.title || "").slice(0, 140), String(ni.cwd || "").slice(0, 300), String(ni.session || "").slice(0, 200), String(ni.win || "").slice(0, 120), t, t).run();
    if (cmd.verb === "move" && ni?.key && /^ew_[a-z0-9]{6,30}$/.test(String(ni.id || ""))) {
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
