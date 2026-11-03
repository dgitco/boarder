import { load, primaryRoot, paneOfId, inPrim, OWN, CARD_TS } from "./member-board";

type R = Record<string, any>;
type L = Awaited<ReturnType<typeof load>>;
type Target = { id: string; name: string; pane: string };
export type Split = { node: string; pane: string; post: string; at: number; state: string };

const STATES: Record<string, string> = { start: "진행 중", progress: "진행 중", blocked: "막힘", decision: "내 차례", done: "끝" };
const DEAD = new Set(["closed", "failed", "gone"]);
const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export function liveTargets(L: L): Target[] {
  return [
    ...L.nodes.filter(n => !n.archived_at && n.state !== "done").map(n => ({ id: n.id, name: n.name, pane: n.pane })),
    ...L.engineNodes.filter(w => !DEAD.has(String(w.state))).map(w => ({ id: String(w.id), name: String(w.name), pane: paneOfId(String(w.id)) })),
  ];
}
export function targetOf(L: L, ref: string): Target | null {
  const r = String(ref || "").trim(), t = liveTargets(L);
  return t.find(x => x.id === r || x.pane === r) || t.find(x => norm(x.name) === norm(r)) || t.find(x => norm(x.name) === norm(r.replace(/^\d+\s+/, ""))) || null;
}
function stateOf(L: L, id: string) {
  const n = L.nodes.find(x => x.id === id), ew = n ? null : L.engineNodes.find(x => String(x.id) === id);
  if (!n && !ew) return "";
  const mine = (win: string) => n ? L.nodeOfWin(win) === n : win === ew!.name;
  if (L.cards.some(c => c.state === "open" && c.kind !== "todo" && mine(String(c.win)))) return "내 차례";
  const last = L.logs.find(r => !inPrim(r) && r.kind !== "me" && !OWN.test(String(r.win)) && !CARD_TS.test(String(r.thread || "")) && mine(String(r.win)));
  return last ? STATES[String(last.kind)] || "" : "";
}
// 이음 줄(몫 글이 지워졌으면 뺌 — 주인 deleted_at IS NULL 과 같음)
const ROWS = `SELECT s.root_ts, s.post_ts, s.node_id, s.at FROM member_split s JOIN board_log l ON l.id = s.log_id AND l.owner = s.owner WHERE s.owner = ?1`;
async function names(db: D1Database, me: string, ids: string[]) {
  const rs = (await db.prepare("SELECT id, COALESCE(pinned_name, name) AS n FROM mnode WHERE owner = ?1 AND id IN (SELECT value FROM json_each(?2)) UNION ALL SELECT id, name AS n FROM engine_window WHERE owner = ?1 AND id IN (SELECT value FROM json_each(?2))").bind(me, JSON.stringify(ids)).all<R>()).results;
  return new Map(rs.map(r => [String(r.id), String(r.n || "노드")]));
}
function chips(rows: R[], nm: Map<string, string>, L: L | null) {
  const by = new Map<string, Split[]>();
  for (const r of rows) {
    const id = String(r.node_id), a = by.get(String(r.root_ts)) || [];
    a.push({ node: nm.get(id) || "", pane: paneOfId(id), post: String(r.post_ts), at: Number(r.at) / 1000, state: L ? stateOf(L, id) : "" });
    by.set(String(r.root_ts), a);
  }
  for (const a of by.values()) a.sort((x, y) => x.at - y.at);
  return by;
}
/** 원글 하나의 칩 목록(chat_split · /api/split/move 답) */
export async function splitsOf(db: D1Database, me: string, root: string, L?: L): Promise<Split[]> {
  const rows = (await db.prepare(`${ROWS} AND s.root_ts = ?2`).bind(me, root).all<R>()).results;
  if (!rows.length) return [];
  return chips(rows, await names(db, me, [...new Set(rows.map(r => String(r.node_id)))]), L || await load(db, me)).get(root) || [];
}
/** 채팅 글 목록에 splits(원글) · split_from(몫 글)을 담(owner-read splitMarks 와 같은 칸). 표가 아직 없거나(이주 전) 못 읽으면 그대로 */
export async function splitMarks(db: D1Database, me: string, msgs: R[], my: string, L?: L) {
  const ts = [...new Set(msgs.map(m => m?.ts).filter((x): x is string => typeof x === "string" && CARD_TS.test(x)))];
  if (!ts.length) return msgs;
  try {
    const rows = (await db.prepare(`${ROWS} AND (s.root_ts IN (SELECT value FROM json_each(?2)) OR s.post_ts IN (SELECT value FROM json_each(?2)))`).bind(me, JSON.stringify(ts)).all<R>()).results;
    if (!rows.length) return msgs;
    // 몫 글만 보이면 같은 원글의 다른 칩도 있어야 split_from.at 을 찾음 — 원글마다 전부 다시
    const roots = [...new Set(rows.map(r => String(r.root_ts)))];
    const all = (await db.prepare(`${ROWS} AND s.root_ts IN (SELECT value FROM json_each(?2))`).bind(me, JSON.stringify(roots)).all<R>()).results;
    const by = chips(all, await names(db, me, [...new Set(all.map(r => String(r.node_id)))]), L || await load(db, me));
    const rootOf = new Map(all.map(r => [String(r.post_ts), String(r.root_ts)]));
    for (const m of msgs) {
      const sp = by.get(m.ts); if (sp) m.splits = sp;
      const root = rootOf.get(m.ts);
      if (root) m.split_from = { chan: "primary", ts: root, at: (by.get(root) || []).find(x => x.post === m.ts)?.at ?? 0, who: "owner", name: my };   // 원글은 늘 내 Primary 글
    }
  } catch (e) { console.error("나누기 칩", String(e).slice(0, 200)); }
  return msgs;
}

/** 메인 봇 chat_split: 내 Primary 글(thread) 하나를 노드마다 몫 글로. 같은 노드에 이미 몫이 있으면 건너뜀. → 그 원글의 칩 목록 */
export async function splitAdd(db: D1Database, me: string, root: string, parts: { node: string; text: string }[]) {
  if (!(await primaryRoot(db, me, root))) throw new Error("없는 글 — 이 사람 Primary 채팅의 사람 글 id 만(「[보드 · Primary · 스레드 <id>]」의 id)");
  const L = await load(db, me);
  const got = parts.map(p => ({ p, t: targetOf(L, p.node) }));
  const bad = got.filter(x => !x.t).map(x => x.p.node);
  if (bad.length) throw new Error(`없는 노드: ${bad.join(", ")} — 보드의 노드 · role_list 의 역할 창 이름만`);
  const have = new Set(((await db.prepare(`${ROWS} AND s.root_ts = ?2`).bind(me, root).all<R>()).results).map(r => String(r.node_id)));
  const skipped: string[] = [], added: { node: string; pane: string; text: string }[] = [], now = Date.now(), st: D1PreparedStatement[] = [];
  for (const { p, t } of got) {
    if (have.has(t!.id)) { skipped.push(t!.name); continue; }
    have.add(t!.id); added.push({ node: t!.name, pane: t!.pane, text: p.text });
    // 몫 글 줄과 이음을 한 batch 로(이음은 방금 넣은 줄의 id · ts — 줄만 남고 칩이 없는 일이 없게)
    st.push(db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").bind(me, t!.name.slice(0, 120), "me", p.text, null, now, null),
      db.prepare("INSERT INTO member_split(owner, root_ts, log_id, post_ts, node_id, at) SELECT owner, ?, id, CAST(at / 1000 AS INTEGER) || '.' || printf('%06d', id % 1000000), ?, ? FROM board_log WHERE rowid = last_insert_rowid() AND owner = ?").bind(root, t!.id, now, me));
  }
  if (st.length) await db.batch(st);
  return { ok: true, splits: await splitsOf(db, me, root), ...(skipped.length ? { skipped } : {}), added };   // added = 이번에 새로 남긴 몫(그 창에 넣을 것 — local.ts 가 쓰고 도구 답에선 뺌)
}

export async function splitMove(db: D1Database, me: string, post: string, pane: string) {
  if (!CARD_TS.test(post) || !/^%\d{1,12}$/.test(pane)) return { error: "몫 글 · 노드가 틀림", status: 400 } as const;
  const s = await db.prepare(`SELECT s.id, s.root_ts, s.log_id, s.node_id FROM member_split s JOIN board_log l ON l.id = s.log_id AND l.owner = s.owner WHERE s.owner = ? AND s.post_ts = ?`).bind(me, post).first<R>();
  if (!s) return { error: "나눈 글이 아님", status: 404 } as const;
  const L = await load(db, me), t = liveTargets(L).find(x => x.pane === pane);
  if (!t) return { error: "없는 노드예요", status: 404 } as const;
  if (t.id !== String(s.node_id)) {
    await db.batch([
      db.prepare("UPDATE member_split SET node_id = ?, at = ? WHERE id = ? AND owner = ?").bind(t.id, Date.now(), s.id, me),
      db.prepare("UPDATE board_log SET win = ? WHERE id = ? AND owner = ?").bind(t.name.slice(0, 120), s.log_id, me),
    ]);
  }
  return { ok: { ok: true, state: "ok", splits: await splitsOf(db, me, String(s.root_ts), L) } } as const;
}
