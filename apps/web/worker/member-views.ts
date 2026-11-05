import { load, data, paneOfId, ME, OWN, inPrim, tsOf, cut, json, CARD_TS, myName, NOT_CHAT } from "./member-board";

type R = Record<string, any>;

const QUIET = 30 * 60;
const RANK: Record<string, number> = { ask: 4, wait: 3, work: 2, quiet: 1 };
const ACT: Record<string, string> = { start: "work", progress: "work", incident: "work", deadline: "work", status: "work", say: "work", reply: "work", chat: "work", sys: "work", done: "quiet", decision: "ask", blocked: "wait" };
const BUSY = new Set(["working", "busy", "starting", "opening", "background"]);
type Ev = { t: number; pane: string | null; k: string | ["resolve", number] };

function segments(ev: Ev[], now: number, isOpen: boolean, busyNow: boolean) {
  const panes = new Map<string, [string, number]>();
  let overlay: string | null = null;
  const cuts: [number, number, Map<string, [string, number]>, string | null][] = [], marks: [number, string][] = [];
  ev.forEach((e, i) => {
    const { t, pane, k } = e;
    if (k === "close" || k === "close-approx" || k === "park") {
      if (!(overlay === "park" && k !== "park")) { overlay = k === "park" ? "park" : "closed"; panes.clear(); marks.push([t, k === "park" ? "park" : "close"]); }
    } else if (k === "reopen") { overlay = null; marks.push([t, "reopen"]); }
    else if (Array.isArray(k)) { const p = pane ? panes.get(pane) : undefined; if (p && p[1] === k[1] && !overlay) panes.set(pane!, ["quiet", t]); }
    else if (pane) {
      if (overlay) marks.push([t, "reopen"]);
      overlay = null; panes.set(pane, [k, t]);
      if (k === "ask") marks.push([t, "ask"]);
    }
    cuts.push([t, i + 1 < ev.length ? ev[i + 1].t : now, new Map(panes), overlay]);
  });
  const state = (ps: Map<string, [string, number]>, ov: string | null, t: number) => {
    if (ov) return ov;
    let best: string | null = null;
    for (const [st, since] of ps.values()) { const s = st === "work" && t - since >= QUIET ? "quiet" : st; if (best === null || RANK[s] > RANK[best]) best = s; }
    return best || "quiet";
  };
  const segs: [number, number, string][] = [];
  for (const [t, nxt, ps, ov] of cuts) {
    if (nxt <= t) continue;
    const b = new Set([t, nxt]);
    for (const [st, since] of ps.values()) if (st === "work" && t < since + QUIET && since + QUIET < nxt) b.add(since + QUIET);
    const bounds = [...b].sort((x, y) => x - y);
    for (let i = 0; i + 1 < bounds.length; i++) {
      const a = bounds[i], z = bounds[i + 1], st = state(ps, ov, a), last = segs.at(-1);
      if (last && last[2] === st && Math.abs(last[1] - a) < 1) last[1] = z; else segs.push([a, z, st]);
    }
  }
  if (isOpen && segs.length) { const last = segs.at(-1)!; if (last[2] === "quiet" && busyNow) last[2] = "work"; }
  else if (!isOpen && segs.length && !["closed", "park"].includes(segs.at(-1)![2])) segs.push([segs.at(-1)![1], now, "closed"]);
  return { segs: segs.map(([a, b, s]) => [Math.round(a), Math.round(b), s] as [number, number, string]), marks: marks.map(([t, k]) => [Math.round(t), k] as [number, string]) };
}

export async function history(db: D1Database, me: string, q?: string | null) {
  const now = Date.now() / 1000, want = q && /^\d{9,11}$/.test(q) ? Number(q) : now - 72 * 3600;
  const from = Math.min(want, now - 72 * 3600) - 24 * 3600;   // 기간 앞 하루도 읽어 그때 상태가 이어지게
  const L = await load(db, me), D = await data(db, me, null, L);   // load 한 번
  const [nd, mi, it, tk, lg, cd, ew, first] = await db.batch([
    db.prepare("SELECT id, name, pinned_name, area, state, updated_at, archived_at FROM mnode WHERE owner = ? AND (archived_at IS NULL OR archived_at > ?)").bind(me, from * 1000),
    db.prepare("SELECT item, node FROM mnode_item WHERE owner = ?").bind(me),
    db.prepare("SELECT key, kind, win FROM imp_item WHERE owner = ?").bind(me),
    db.prepare("SELECT pane, win FROM agent_token WHERE owner = ? ORDER BY created_at").bind(me),
    db.prepare(`SELECT id, win, kind, thread, at FROM board_log WHERE owner = ? AND at >= ? ${NOT_CHAT} ORDER BY at DESC, id DESC LIMIT 5000`).bind(me, from * 1000),
    db.prepare("SELECT id, win, kind, state, answered_at, at FROM board_card WHERE owner = ? AND (at >= ? OR state = 'open') ORDER BY at DESC LIMIT 500").bind(me, from * 1000),
    db.prepare("SELECT id, kind, name, state, state_at, created_at, closed_at FROM engine_window WHERE owner = ? AND kind = 'role' AND (closed_at IS NULL OR closed_at > ?)").bind(me, from * 1000),
    db.prepare("SELECT MIN(at) at FROM board_log WHERE owner = ?").bind(me),
  ]);
  const keyOfWin = new Map<string, string>(); for (const r of tk.results as R[]) keyOfWin.set(String(r.win), String(r.pane));
  const itemOfWin = new Map<string, string>(); for (const i of it.results as R[]) if (i.win && (i.kind === "window" || !itemOfWin.has(i.win))) itemOfWin.set(String(i.win), String(i.key));
  const nodeOfItem = new Map((mi.results as R[]).map(r => [String(r.item), String(r.node)]));
  const nodes = new Map((nd.results as R[]).map(n => [String(n.id), n]));
  const nameOf = (n: R) => String(n.pinned_name || n.name || "노드").replace(/^\d+\s*/, "");
  const engines = (ew.results as R[]).filter(w => !(nd.results as R[]).some(n => nameOf(n) === String(w.name).replace(/^\d+\s*/, "")));
  const live = new Map(L.nodes.map(n => [n.id, n]));
  const areaKey = new Map<string, string>((D.areas as R[]).map(a => [String(a.name), String(a.key)]));
  const areaOf = (n: R | null) => { const a = String(n?.area || "").trim(); return areaKey.get(a && a !== "기타" ? a : "기타") || "primary"; };

  type Row = { key: string; name: string; area: string; ev: Ev[]; panes: string[]; open: boolean; busy: boolean; end: Ev | null };
  const rows = new Map<string, Row>();
  const row = (key: string, name: string, mk: () => Omit<Row, "key" | "name" | "ev" | "panes">) => rows.get(key) || rows.set(key, { key, name, ev: [], panes: [], ...mk() }).get(key)!;
  const primRow = () => row("primary", "Primary", () => ({ area: "primary", open: true, busy: L.mainWin ? BUSY.has(String(L.mainWin.state)) : false, end: null }));
  const nodeRow = (n: R) => row("w:" + nameOf(n), nameOf(n), () => {
    const ln = live.get(String(n.id)), open = !!ln && !ln.archived_at && !["done", "parked"].includes(String(n.state));
    const end: Ev | null = open ? null : n.state === "parked" && !n.archived_at ? { t: Number(n.updated_at) / 1000, pane: null, k: "park" } : { t: Number(n.archived_at || n.updated_at) / 1000, pane: null, k: "close" };
    return { area: areaOf(n), open, busy: BUSY.has(String(n.state)), end };
  });
  const engRow = (w: R) => row("w:" + String(w.name).replace(/^\d+\s*/, ""), String(w.name), () => {
    const st = String(w.state), open = !["parked", "closed", "failed", "gone"].includes(st);
    const end: Ev | null = open ? null : st === "parked" ? { t: Number(w.state_at || w.created_at) / 1000, pane: null, k: "park" } : { t: Number(w.closed_at || w.state_at || w.created_at) / 1000, pane: null, k: "close" };
    return { area: "primary", open, busy: BUSY.has(st), end };
  });
  const rowOfWin = (win: string, kind?: string): Row | null => {
    if (L.isPrimWin(win)) return primRow();
    const k = keyOfWin.get(win) || win, n = nodes.get(nodeOfItem.get(itemOfWin.get(k) || `win:${k}`) || "") || (kind === "me" ? [...nodes.values()].find(x => nameOf(x) === win.replace(/^\d+\s*/, "")) : null);
    if (n) return nodeRow(n);
    const w = engines.find(x => x.name === win); return w ? engRow(w) : null;
  };
  const push = (r: Row | null, t: number, pane: string, k: Ev["k"]) => { if (!r) return; r.ev.push({ t, pane, k }); if (!r.panes.includes(pane)) r.panes.push(pane); };
  for (const r of (lg.results as R[]).slice().reverse()) {
    if (OWN.test(String(r.win)) || r.kind === "me" || CARD_TS.test(String(r.thread || ""))) continue;
    const st = ACT[String(r.kind)]; if (!st) continue;
    if (inPrim(r)) { if (r.win !== ME && r.win !== "보더") push(primRow(), Number(r.at) / 1000, "%1", st); continue; }
    const rw = rowOfWin(String(r.win), String(r.kind)); push(rw, Number(r.at) / 1000, String(r.win), st);
  }
  for (const c of cd.results as R[]) {
    if (c.kind === "todo") continue;
    const rw = rowOfWin(String(c.win)); if (!rw) continue;
    const at = Number(c.at) / 1000;
    push(rw, at, String(c.win), "ask");
    if (c.state !== "open" && c.answered_at) rw.ev.push({ t: Number(c.answered_at) / 1000, pane: String(c.win), k: ["resolve", at] });
  }
  const out: R[] = [];
  for (const r of rows.values()) {
    if (!r.ev.length) continue;
    const ev = [...r.ev].sort((a, b) => a.t - b.t);
    const lastAct = ev.reduce((m, e) => typeof e.k === "string" ? Math.max(m, e.t) : m, 0) || now;
    if (!r.open) { const e = r.end; ev.push(e && e.t >= lastAct ? e : { t: lastAct + 60, pane: null, k: "close-approx" }); }
    const { segs, marks } = segments(ev, now, r.open, r.busy);
    if (segs.length) out.push({ key: r.key, name: r.name, area: r.area, open: r.open, panes: r.panes.slice(-6), first: segs[0][0], last: Math.round(lastAct), now: segs.at(-1)![2], segs, marks });
  }
  // history.py history() 와 같은 거르기: since 뒤에 걸친 막대 · 표시만, 닫힌 지 오래된 창의 닫힘 막대 하나는 뺌
  const oldest = Number((first.results[0] as R | undefined)?.at || 0) / 1000 || now, since = Math.max(want, oldest - 60);
  const rs = [];
  for (const r of out) {
    const segs = (r.segs as [number, number, string][]).filter(x => x[1] > since);
    if (!segs.length || (!r.open && segs.length === 1 && segs[0][2] === "closed" && segs[0][0] < since)) continue;
    rs.push({ ...r, segs, marks: (r.marks as [number, string][]).filter(m => m[0] > since) });
  }
  return { now: Math.round(now), since: Math.round(since), oldest: Math.round(oldest), rows: rs };
}

const slug = (t: string) => t.trim().toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `t${Math.floor(Date.now() / 1000)}`;
const winTitle = (w: unknown) => String(w || "").replace(/^\d+\s+/, "").trim();
export async function topics(db: D1Database, me: string, bot: { name?: string } | null, pre?: Awaited<ReturnType<typeof load>> | null) {   // pre = 읽기 길이 나눠 쓴 load(loadRead)
  const L = pre || await load(db, me), D = await data(db, me, bot, L);   // load 한 번(예전엔 data 안 · 밖 두 번)
  const out = new Map<string, R>();
  for (const p of D.panes as R[]) {
    if (p.kind !== "lead") continue;
    const name = winTitle(p.win), id = slug(name);
    out.set(id, { id, title: name, area: p.area, state: "open", folder: p.cwd || "", windows: [name], panes: [p.pane], live: true, reg: false, done_at: null });
  }
  for (const x of D.parked as R[]) {
    const name = winTitle(x.name), id = slug(name);
    (out.get(id) || out.set(id, { id, title: name, area: x.area, state: "open", folder: "", windows: [name], panes: [x.pane], live: false, reg: false, done_at: null }).get(id)!).parked = x.msg;
  }
  for (const x of D.closed as R[]) {
    const name = winTitle(x.win), id = slug(name);
    if (!out.has(id)) out.set(id, { id, title: name, area: x.area, state: "done", folder: "", windows: [name], panes: [x.pane], live: false, reg: false, done_at: `${x.ago}분 전`, last: x.msg });
  }
  const paneTopic = new Map<string, string>(); for (const t of out.values()) for (const p of t.panes) paneTopic.set(p, t.id);
  const mainName = bot?.name || "Primary", my = myName(me);
  const threads: R[] = [];
  const cards = (await db.prepare("SELECT rowid AS n, id, win, kind, question, choices, body, state, answer, answered_at, at FROM board_card WHERE owner = ? AND (state = 'open' OR at > ?) ORDER BY at DESC LIMIT 200").bind(me, Date.now() - 7 * 86_400_000).all<R>()).results;
  const said = cards.length ? (await db.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND thread IN (SELECT value FROM json_each(?)) ORDER BY at + 0, id LIMIT 2000").bind(me, JSON.stringify(cards.map(c => String(c.id)))).all<R>()).results : [];
  for (const c of cards) {
    if (!CARD_TS.test(String(c.id))) continue;
    const n = L.nodeOfWin(String(c.win)), ew = L.engineNodes.find(w => w.name === c.win), owner = n?.pane || (ew ? paneOfId(ew.id) : null);
    const rs = said.filter(r => r.thread === c.id), lastLog = rs.at(-1), ans = c.answer ? Number(c.answered_at || c.at) : 0;
    const last = ans && (!lastLog || ans >= Number(lastLog.at)) ? { who: "owner", name: my, text: cut(c.answer, 400), ts: tsOf(ans, Number(c.n)) }
      : lastLog ? { who: lastLog.kind === "me" ? "owner" : "agent", name: lastLog.kind === "me" ? my : String(lastLog.win), text: cut(lastLog.text, 400), ts: tsOf(Number(lastLog.at), Number(lastLog.id)) }
      : { who: "agent", name: String(c.win), text: cut(c.question, 400), ts: String(c.id) };
    const buttons = json<string[]>(c.choices, []).length;
    threads.push({ ts: String(c.id), channel: "primary", text: [c.question, c.body].filter(Boolean).join("\n\n"), name: String(c.win), who: "agent", replies: rs.length + (c.answer ? 1 : 0), owner,
      buttons, at: Math.max(Number(last.ts), Number(c.at) / 1000), needs: c.state === "open" && c.kind !== "todo" && !!buttons && last.who === "agent", last, topic: owner ? paneTopic.get(owner) || null : null });
  }
  // Primary 채팅의 뿌리 글(3일 안 · 최근 100): 내 글은 그 스레드 답(p:<ts>)까지 — 봇 · 보더 글은 답이 없음
  const roots = (await db.prepare("SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = 'primary' AND at > ? ORDER BY at DESC, id DESC LIMIT 100").bind(me, Date.now() - 3 * 86_400_000).all<R>()).results;
  const mineTs = roots.filter(r => r.win === ME).map(r => "p:" + tsOf(Number(r.at), Number(r.id)));
  const reps = mineTs.length ? (await db.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND thread IN (SELECT value FROM json_each(?)) ORDER BY at + 0, id LIMIT 2000").bind(me, JSON.stringify(mineTs)).all<R>()).results : [];
  for (const r of roots) {
    if (OWN.test(String(r.win))) continue;
    const ts = tsOf(Number(r.at), Number(r.id)), mine = r.win === ME, rs = reps.filter(x => x.thread === "p:" + ts), l = rs.at(-1) || r;
    const who = (x: R) => x.win === ME ? "owner" : "agent", nm = (x: R) => x.win === ME ? my : x.win === "보더" ? "보더" : mainName;
    threads.push({ ts, channel: "primary", text: String(r.text || ""), name: nm(r), who: mine ? "owner" : "agent", replies: rs.length, owner: null, buttons: 0, at: Number(l.at) / 1000, needs: false,
      last: { who: who(l), name: nm(l), text: cut(l.text, 400), ts: tsOf(Number(l.at), Number(l.id)) }, topic: null });
  }
  threads.sort((a, b) => b.at - a.at);
  return { topics: [...out.values()], threads };
}

export const PROMISE_STATES = ["kept", "dropped"] as const;
export function overdue(due: string, now: number) {
  const s = String(due || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return false;   // 날짜 꼴이 아니면(「다음 배포 뒤」 등) 판정 안 함
  const iso = /T|\s\d/.test(s) ? s.replace(" ", "T") : s + "T23:59";
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "+09:00");   // 시간대 없으면 한국 시각
  return Number.isFinite(t) && t < now;
}
export async function promiseRows(db: D1Database, me: string, paneOf: (win: string) => string, now: number) {
  const rs = (await db.prepare("SELECT id, win, who, what, check_by, due, at FROM member_promise WHERE owner = ? AND state = 'open' ORDER BY at DESC LIMIT 100").bind(me).all<R>().catch(() => ({ results: [] as R[] }))).results;
  const promises = rs.map(r => { const pane = paneOf(String(r.win)); return { n: Number(r.id), due: String(r.due), to: cut(r.who, 60), what: cut(r.what, 160), watch: cut(r.check_by, 100), pane, panes: [pane], short: cut(r.what, 18), title: cut(r.what, 30) }; });
  const to_check = rs.filter(r => overdue(String(r.due), now)).map(r => ({ id: "p" + r.id, src: "promise", pane: paneOf(String(r.win)), win: String(r.win), area: "primary", title: cut(`${r.who}에게 한 약속 — ${r.what}`, 200),
    body: cut(`기한 ${r.due} · 확인 장치: ${r.check_by}`, 600), choices: [], ago: Math.max(0, Math.round((now - Number(r.at)) / 60_000)), kind: "약속", why: `기한(${r.due})이 지났어요 — 지켰는지 확인` }));
  return { promises, to_check };
}
