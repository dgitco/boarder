
type R = Record<string, any>;
const OWN = /^보더 들여오기$|(^|:)boarder(-|:)import$/;   // 보더 자신의 줄(member-board OWN 과 같음)
const ME = "나";                                          // 회원이 Primary 채팅에 쓴 줄(member-board ME)
const TURN: Record<string, string> = { turn: "내 차례", blocked: "막힘", working: "일하는 중", parked: "주차" };

export async function query(db: D1Database, me: string, q0: string) {
  const t0 = Date.now();
  const q = q0.normalize("NFC").trim().slice(0, 100);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!terms.length) return { q, nodes: [], cards: [], chats: [], arts: [], ms: { total: 0 } };
  const like = terms.map(t => "%" + t.replace(/[\\%_]/g, m => "\\" + m) + "%");
  const all = (col: string) => terms.map(() => `lower(${col}) LIKE ? ESCAPE '\\'`).join(" AND ");
  const CARD = "question || ' ' || COALESCE(body, '') || ' ' || COALESCE(answer, '')", NODE = "COALESCE(pinned_name, '') || ' ' || name || ' ' || why";
  const [lg, cd, td, nd, tk, it, mi, ns] = await db.batch([
    db.prepare(`SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND ${all("text")} ORDER BY at DESC LIMIT 200`).bind(me, ...like),
    db.prepare(`SELECT rowid AS n, id, win, question, body, answer, state, at, answered_at FROM board_card WHERE owner = ? AND ${all(CARD)} ORDER BY at DESC LIMIT 60`).bind(me, ...like),
    db.prepare(`SELECT key, title, state, state_at, seen_at FROM imp_item WHERE owner = ? AND kind = 'todo' AND gone_at IS NULL AND ${all("title")} ORDER BY seen_at DESC LIMIT 30`).bind(me, ...like),
    db.prepare(`SELECT id, name, pinned_name, state, why, updated_at, archived_at FROM mnode WHERE owner = ? AND ${all(NODE)} ORDER BY updated_at DESC LIMIT 30`).bind(me, ...like),
    db.prepare("SELECT pane, win FROM agent_token WHERE owner = ? ORDER BY created_at").bind(me),
    db.prepare("SELECT key, kind, win FROM imp_item WHERE owner = ?").bind(me),
    db.prepare("SELECT item, node FROM mnode_item WHERE owner = ?").bind(me),
    db.prepare("SELECT id, name, pinned_name, state, why, updated_at FROM mnode WHERE owner = ?").bind(me),
  ]);
  const keyOfWin = new Map<string, string>(); for (const r of tk.results as R[]) keyOfWin.set(r.win, r.pane);
  const itemOfWin = new Map<string, string>(); for (const i of it.results as R[]) if (i.win && (i.kind === "window" || !itemOfWin.has(i.win))) itemOfWin.set(i.win, i.key);
  const nodeOfItem = new Map((mi.results as R[]).map(r => [String(r.item), String(r.node)]));
  const nodeById = new Map((ns.results as R[]).map(n => [String(n.id), n]));
  const nameOf = (n: R) => String(n.pinned_name || n.name || "노드");
  const nodeOfWin = (win: string) => { const k = keyOfWin.get(win) || win, item = itemOfWin.get(k) || `win:${k}`; return nodeById.get(nodeOfItem.get(item) || "") || null; };

  const phrase = terms.join(" "), flat = (t: unknown) => String(t ?? "").toLowerCase().replace(/\s+/g, " ");
  const whole = (t: unknown) => terms.length < 2 || flat(t).includes(phrase);   // 낱말이 붙어 맞은 글이 먼저
  const rank = <T extends { at: number; w: boolean }>(a: T[]) => a.sort((x, y) => Number(y.w) - Number(x.w) || y.at - x.at);

  const nodeHit = new Map<string, { n: R; s: number; hit?: R }>();
  const via = (n: R | null, hit: R, s: number) => { if (!n) return; const x = nodeHit.get(n.id) || { n, s: 0 }; x.s += x.hit ? s / 5 : s; x.hit ??= hit; nodeHit.set(n.id, x); };
  const chats = rank((lg.results as R[]).filter(r => !OWN.test(r.win)).map(r => {
    const prim = r.thread === "primary", mine = r.win === ME || r.kind === "me", n = prim ? null : nodeOfWin(r.win);
    const at = Number(r.at) / 1000, text = snip(r.text, terms), title = prim ? (mine ? ME : r.win === "보더" ? "보더" : "Primary") : n ? nameOf(n) : String(r.win);
    via(n, { kind: "log", text, at }, 0.5);
    return { id: "m:" + r.id, kind: prim ? "chat" : "log", title, text, ch: "primary", node: n ? nameOf(n) : null, thread: null, at, w: whole(r.text) };
  })).slice(0, 8);
  const cards = rank([
    ...(cd.results as R[]).map(c => {
      const n = nodeOfWin(c.win), at = Number(c.answered_at || c.at) / 1000, text = snip([c.body, c.answer].filter(Boolean).join(" · ") || c.question, terms);
      via(n, { kind: "card", text: String(c.question), at }, 0.7);
      return { id: "c:" + c.id, kind: "card", title: String(c.question), text, ch: "primary", node: n ? nameOf(n) : null, ts: "w:" + c.n, thread: null, state: c.state === "open" ? "open" : "done", ckind: "decision", at, w: whole(c.question) };
    }),
    ...(td.results as R[]).map(i => {
      const n = nodeById.get(nodeOfItem.get(String(i.key)) || "") || null, at = Number(i.state_at || i.seen_at) / 1000;
      via(n, { kind: "card", text: String(i.title), at }, 0.7);
      return { id: "t:" + i.key, kind: "card", title: String(i.title), text: "", ch: "primary", node: n ? nameOf(n) : null, ts: "", thread: null, state: i.state === "done" ? "done" : "open", ckind: "todo", at, w: whole(i.title) };
    }),
  ]).slice(0, 6);
  // 노드: 이름 · 이유가 맞은 노드 + 맞은 글이 걸린 노드
  for (const n of nd.results as R[]) { const x = nodeHit.get(n.id) || { n, s: 0 }; x.s += whole(NODE_TEXT(n)) ? 3 : 2; nodeHit.set(n.id, x); }
  const nodes = [...nodeHit.values()].sort((a, b) => b.s - a.s || Number(b.n.updated_at) - Number(a.n.updated_at)).slice(0, 6).map(({ n, hit }) => ({
    id: "n:" + nameOf(n), title: nameOf(n), area: "primary", state: n.state, turn: TURN[n.state], line: hit ? undefined : String(n.why || "") || undefined, line_at: hit ? undefined : Number(n.updated_at) / 1000, hit: hit || null,
  }));
  const strip = <T extends { w: boolean }>(a: T[]) => a.map(({ w, ...x }) => x);
  return { q, nodes, cards: strip(cards), chats: strip(chats), arts: [], ms: { total: Date.now() - t0 }, member: 1 };
}
const NODE_TEXT = (n: R) => [n.pinned_name, n.name, n.why].filter(Boolean).join(" ");

// GET /api/search 갈래 — 주인은 주인 색인(owner, search.ts DO), 회원은 자기 D1 만. 회원 갈래에서 owner() 를 부르지 않는 것이 경계(시험)
// (ownerSearch 를 꼴 없이 받음 — DO 스텁 꼴을 추론하면 tsc 가 「너무 깊음」)
export async function route(o: { owner: boolean; me: string; q: string; db: D1Database; ownerSearch: () => Promise<unknown> }): Promise<{ ms?: Record<string, number> }> {
  return o.owner ? o.ownerSearch() as Promise<{ ms?: Record<string, number> }> : query(o.db, o.me.toLowerCase(), o.q);
}

// 찾은 낱말 둘레 ±45자(없으면 앞부분) — search.ts snip 과 같음(그 파일은 DO 라 시험에서 못 불러 따로 둠)
function snip(text: unknown, terms: string[]) {
  const t = String(text || "").replace(/\s+/g, " ").trim(), lo = t.toLowerCase();
  let at = -1; for (const w of terms) { const i = lo.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return t.slice(0, 110);
  const a = Math.max(0, at - 45), b = Math.min(t.length, at + 65);
  return (a > 0 ? "…" : "") + t.slice(a, b) + (b < t.length ? "…" : "");
}
