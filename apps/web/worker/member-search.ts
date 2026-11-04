
import { frontDoorFromData, frontDoorId } from "./front-door";

type R = Record<string, any>;
const OWN = /^보더 들여오기$|(^|:)boarder(-|:)import$/;   // 보더 자신의 줄(member-board OWN 과 같음)
const tsOf = (at: number, id: number) => `${Math.floor(at / 1000)}.${String(id % 1_000_000).padStart(6, "0")}`;   // member-board 채팅 글 ts 와 같음 — 찾은 글로 바로 가는 자리
const ME = "나";
const notChat = (t: string) => `AND (${t}.wid IS NULL OR ${t}.wid NOT IN (SELECT id FROM engine_window WHERE owner = ${t}.owner AND kind = 'chat'))`;
const NC_LOG = notChat("board_log"), NC_CARD = notChat("board_card");
const TURN: Record<string, string> = { turn: "내 차례", blocked: "막힘", working: "일하는 중", parked: "주차" };

export type Ai = { run(model: string, input: { text: string[] }): Promise<unknown> };
const MODEL = "@cf/baai/bge-m3", SEM_MIN: Record<string, number> = { node: 0.42, card: 0.55, log: 0.58, chat: 0.62 }, VMAX = 4000, NEW_MAX = 200;
const vcache = new Map<string, Float32Array>();
const fnv = (t: string) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
const unit = (v: number[]) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, x => x / n); };
async function embed(ai: Ai, texts: string[]) {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const r = await ai.run(MODEL, { text: texts.slice(i, i + 100) }) as { data?: number[][] };
    if (!Array.isArray(r?.data) || r.data.length !== Math.min(100, texts.length - i)) throw new Error("임베딩 꼴이 틀림");
    out.push(...r.data.map(unit));
  }
  return out;
}
export const _vcache = vcache;   // 시험용

export async function query(db: D1Database, me: string, q0: string, o: { sem?: boolean; ai?: Ai } = {}) {
  const t0 = Date.now();
  const q = q0.normalize("NFC").trim().slice(0, 100);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!terms.length) return { q, nodes: [], cards: [], chats: [], arts: [], ms: { total: 0 } };
  const like = terms.map(t => "%" + t.replace(/[\\%_]/g, m => "\\" + m) + "%");
  const all = (col: string) => terms.map(() => `lower(${col}) LIKE ? ESCAPE '\\'`).join(" AND ");
  const CARD = "question || ' ' || COALESCE(body, '') || ' ' || COALESCE(answer, '')", NODE = "COALESCE(pinned_name, '') || ' ' || name || ' ' || why";
  const [lg, cd, td, nd, tk, it, mi, ns, fs] = await db.batch([
    db.prepare(`SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND ${all("text")} ${NC_LOG} ORDER BY at DESC LIMIT 200`).bind(me, ...like),
    db.prepare(`SELECT rowid AS n, id, win, question, body, answer, state, at, answered_at FROM board_card WHERE owner = ? AND ${all(CARD)} ${NC_CARD} ORDER BY at DESC LIMIT 60`).bind(me, ...like),
    db.prepare(`SELECT key, title, state, state_at, seen_at FROM imp_item WHERE owner = ? AND kind = 'todo' AND gone_at IS NULL AND ${all("title")} ORDER BY seen_at DESC LIMIT 30`).bind(me, ...like),
    db.prepare(`SELECT id, name, pinned_name, state, why, updated_at, archived_at FROM mnode WHERE owner = ? AND ${all(NODE)} ORDER BY updated_at DESC LIMIT 30`).bind(me, ...like),
    db.prepare("SELECT pane, win FROM agent_token WHERE owner = ? ORDER BY created_at").bind(me),
    db.prepare("SELECT key, kind, win FROM imp_item WHERE owner = ?").bind(me),
    db.prepare("SELECT item, node FROM mnode_item WHERE owner = ?").bind(me),
    db.prepare("SELECT id, name, pinned_name, state, why, updated_at FROM mnode WHERE owner = ?").bind(me),
    db.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me),   // 앞단(설정 front_door) — 없으면 아무 일도 안 함
  ]);
  const fd = frontDoorFromData((fs.results[0] as R | undefined)?.data);
  const keyOfWin = new Map<string, string>(); for (const r of tk.results as R[]) keyOfWin.set(r.win, r.pane);
  const itemOfWin = new Map<string, string>(); for (const i of it.results as R[]) if (i.win && (i.kind === "window" || !itemOfWin.has(i.win))) itemOfWin.set(i.win, i.key);
  const nodeOfItem = new Map((mi.results as R[]).map(r => [String(r.item), String(r.node)]));
  const nodeById = new Map((ns.results as R[]).map(n => [String(n.id), n]));
  const nameOf = (n: R) => String(n.pinned_name || n.name || "노드");
  const isFront = (n: R | null) => !!n && frontDoorId(fd, String(n.id), nameOf(n));
  const nodeOfWin = (win: string) => { const k = keyOfWin.get(win) || win, item = itemOfWin.get(k) || `win:${k}`; return nodeById.get(nodeOfItem.get(item) || "") || [...nodeById.values()].find(n => isFront(n) && nameOf(n) === win) || null; };

  const phrase = terms.join(" "), flat = (t: unknown) => String(t ?? "").toLowerCase().replace(/\s+/g, " ");
  const whole = (t: unknown) => terms.length < 2 || flat(t).includes(phrase);   // 낱말이 붙어 맞은 글이 먼저
  const rank = <T extends { at: number; w: boolean }>(a: T[]) => a.sort((x, y) => Number(y.w) - Number(x.w) || y.at - x.at);

  const nodeHit = new Map<string, { n: R; s: number; hit?: R }>();
  const via = (n: R | null, hit: R, s: number) => { if (!n) return; const x = nodeHit.get(n.id) || { n, s: 0 }; x.s += x.hit ? s / 5 : s; x.hit ??= hit; nodeHit.set(n.id, x); };
  const toChat = (r: R, w = 0.5) => {
    const home = nodeOfWin(r.win), alias = isFront(home), prim = alias || r.thread === "primary" || /^p:/.test(String(r.thread || "")), mine = r.win === ME || r.kind === "me", n = prim ? null : home;
    const at = Number(r.at) / 1000, text = snip(r.text, terms), title = alias ? fd!.name : prim ? (mine ? ME : r.win === "보더" ? "보더" : "Primary") : n ? nameOf(n) : String(r.win);
    const ts = tsOf(Number(r.at), Number(r.id)), th0 = String(r.thread || ""), thread = /^p:\d{10}\.\d{6}$/.test(th0) ? th0.slice(2) : /^\d{10}\.\d{6}$/.test(th0) ? th0 : null;
    via(n, { kind: "log", text, at, ts, thread }, w);
    return { id: "m:" + r.id, kind: prim ? "chat" : "log", title, text, ch: "primary", node: n ? nameOf(n) : null, ts, thread, at, w: whole(r.text) };
  };
  const toCard = (c: R, w = 0.7) => {
    const home = nodeOfWin(c.win), n = isFront(home) ? null : home, at = Number(c.answered_at || c.at) / 1000, text = snip([c.body, c.answer].filter(Boolean).join(" · ") || c.question, terms);
    via(n, { kind: "card", text: String(c.question), at }, w);
    return { id: "c:" + c.id, kind: "card", title: String(c.question), text, ch: "primary", node: n ? nameOf(n) : null, ts: "w:" + c.n, thread: null, state: c.state === "open" ? "open" : "done", ckind: "decision", at, w: whole(c.question) };
  };
  const lexChats = rank((lg.results as R[]).filter(r => !OWN.test(r.win)).map(r => toChat(r)));
  const lexCards = rank([
    ...(cd.results as R[]).map(c => toCard(c)),
    ...(td.results as R[]).map(i => {
      const n = nodeById.get(nodeOfItem.get(String(i.key)) || "") || null, at = Number(i.state_at || i.seen_at) / 1000;
      via(n, { kind: "card", text: String(i.title), at }, 0.7);
      return { id: "t:" + i.key, kind: "card", title: String(i.title), text: "", ch: "primary", node: n ? nameOf(n) : null, ts: "", thread: null, state: i.state === "done" ? "done" : "open", ckind: "todo", at, w: whole(i.title) };
    }),
  ]);
  // 노드: 이름 · 이유가 맞은 노드 + 맞은 글이 걸린 노드
  for (const n of nd.results as R[]) { const x = nodeHit.get(n.id) || { n, s: 0 }; x.s += whole(NODE_TEXT(n)) ? 3 : 2; nodeHit.set(n.id, x); }
  const ms: Record<string, number> = {};
  // ② 뜻(sem=1): 낱말로 안 걸린 최근 글 · 카드 · 노드 가운데 뜻이 가까운 것
  const semChats: R[] = [], semCards: R[] = [], semNodes = new Map<string, number>();
  if (o.sem && o.ai && [...q].length >= 2) {
    const t1 = Date.now();
    try {
      const [rl, rc, rn] = await db.batch([
        db.prepare(`SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND kind != 'role' ${NC_LOG} ORDER BY at DESC LIMIT 150`).bind(me),
        db.prepare(`SELECT rowid AS n, id, win, question, body, answer, state, at, answered_at FROM board_card WHERE owner = ? ${NC_CARD} ORDER BY at DESC LIMIT 60`).bind(me),
        db.prepare("SELECT id, name, pinned_name, state, why, updated_at, archived_at FROM mnode WHERE owner = ? ORDER BY updated_at DESC LIMIT 60").bind(me),
      ]);
      const lexIds = new Set([...lexChats.map(x => x.id), ...lexCards.map(x => x.id)]);
      const docs = [
        ...(rl.results as R[]).filter(r => !OWN.test(r.win) && String(r.text || "").trim() && !lexIds.has("m:" + r.id)).map(r => ({ kind: r.thread === "primary" || /^p:/.test(String(r.thread || "")) ? "chat" : "log", id: "m:" + r.id, text: String(r.text).slice(0, 600), r })),
        ...(rc.results as R[]).filter(c => !lexIds.has("c:" + c.id)).map(c => ({ kind: "card", id: "c:" + c.id, text: [c.question, c.body].filter(Boolean).join("\n").slice(0, 600), r: c })),
        ...(rn.results as R[]).filter(n => !nodeHit.has(n.id)).map(n => ({ kind: "node", id: "n:" + n.id, text: NODE_TEXT(n).slice(0, 600), r: n })),
      ];
      const key = (d: { id: string; text: string }) => `${me}|${d.id}|${fnv(d.text)}`;
      const todo = docs.filter(d => !vcache.has(key(d))).slice(0, NEW_MAX);
      const vs = await embed(o.ai, [q, ...todo.map(d => d.text)]);
      todo.forEach((d, i) => { vcache.set(key(d), vs[i + 1]); if (vcache.size > VMAX) vcache.delete(vcache.keys().next().value!); });
      ms.emb_new = todo.length;
      const qv = vs[0];
      for (const d of docs) {
        const v = vcache.get(key(d)); if (!v) continue;
        let s = 0; for (let j = 0; j < v.length; j++) s += qv[j] * v[j];
        if (s < SEM_MIN[d.kind]) continue;
        if (d.kind === "chat" || d.kind === "log") semChats.push({ ...toChat(d.r, 0.3), sem: 1, s });
        else if (d.kind === "card") semCards.push({ ...toCard(d.r, 0.4), sem: 1, s });
        else semNodes.set(String(d.r.id), s);
      }
      for (const [id, s] of semNodes) { const n = (rn.results as R[]).find(x => String(x.id) === id)!; const x = nodeHit.get(id) || { n, s: 0 }; x.s += 1 + s; nodeHit.set(id, x); }
    } catch (e) { ms.emb_err = 1; console.log("member search sem", String(e).slice(0, 200)); }
    ms.sem = Date.now() - t1;
  }
  const bySem = (a: R[]) => a.sort((x, y) => y.s - x.s).map(({ s, ...x }) => x);
  const mix = <T,>(lex: T[], sem: T[], n: number) => { const ss = sem.slice(0, Math.max(2, n - lex.length)); return [...lex.slice(0, n - ss.length), ...ss]; };
  const chats = mix<R>(lexChats, bySem(semChats), 8), cards = mix<R>(lexCards, bySem(semCards), 6);
  const nodeHits = [...nodeHit.values()].filter((x, i, all) => !isFront(x.n) || all.findIndex(y => isFront(y.n)) === i);
  const nodes = nodeHits.sort((a, b) => b.s - a.s || Number(b.n.updated_at) - Number(a.n.updated_at)).slice(0, 6).map(({ n, hit }) => ({
    id: "n:" + (isFront(n) ? fd!.name : nameOf(n)), title: isFront(n) ? fd!.name : nameOf(n), area: "primary", state: n.state, turn: TURN[n.state], line: hit ? undefined : String(n.why || "") || undefined, line_at: hit ? undefined : Number(n.updated_at) / 1000, hit: hit || null,
    ...(semNodes.has(String(n.id)) ? { sem: 1 } : {}),
  }));
  const strip = (a: R[]) => a.map(({ w, ...x }) => x);
  return { q, nodes, cards: strip(cards), chats: strip(chats), arts: [], ms: { ...ms, total: Date.now() - t0 }, member: 1 };
}
const NODE_TEXT = (n: R) => [n.pinned_name, n.name, n.why].filter(Boolean).join(" ");

// GET /api/search 갈래 — 주인은 주인 색인(owner, search.ts DO), 회원은 자기 D1 만. 회원 갈래에서 owner() 를 부르지 않는 것이 경계(시험)
// (ownerSearch 를 꼴 없이 받음 — DO 스텁 꼴을 추론하면 tsc 가 「너무 깊음」)
export async function route(o: { owner: boolean; me: string; q: string; db: D1Database; ownerSearch: () => Promise<unknown>; sem?: boolean; ai?: Ai }): Promise<{ ms?: Record<string, number> }> {
  return o.owner ? o.ownerSearch() as Promise<{ ms?: Record<string, number> }> : query(o.db, o.me.toLowerCase(), o.q, { sem: o.sem, ai: o.ai });
}

// 찾은 낱말 둘레 ±45자(없으면 앞부분) — search.ts snip 과 같음(그 파일은 DO 라 시험에서 못 불러 따로 둠)
function snip(text: unknown, terms: string[]) {
  const t = String(text || "").replace(/\s+/g, " ").trim(), lo = t.toLowerCase();
  let at = -1; for (const w of terms) { const i = lo.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return t.slice(0, 110);
  const a = Math.max(0, at - 45), b = Math.min(t.length, at + 65);
  return (a > 0 ? "…" : "") + t.slice(a, b) + (b < t.length ? "…" : "");
}
