import { clean } from "./owner-read";

type R = Record<string, any>;
export const HS_KEY = "harness_state";
export const PROM_WID = "hp:";
const AREAS: [string, string][] = [["primary", "프라이머리"], ["company", "회사"], ["personal", "퍼스널"], ["dgit", "DGit"], ["shop", "가게"]];
const AREA_KO = new Set([...AREAS.map(a => a[0]), "shopco"]);
const DC_HOLD = "확인 필요(내 차례 그대로)";   // done_check.HOLD 머리(snapshot.py)
const PANE = /^%\d{1,7}$/;
const DIGITS_TS = /^[0-9].*\.[0-9]/;   // SQLite GLOB '[0-9]*.[0-9]*'
const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) as T : d; } catch { return d; } };
const str = (v: unknown, n: number) => Array.from(String(v ?? "")).slice(0, n).join("");
const isObj = (v: unknown): v is R => !!v && typeof v === "object" && !Array.isArray(v);
const bigint = (v: unknown) => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0;
const areaKey = (a: string) => a === "shop" || a === "shopco" ? "shop" : a;
const stripNo = (s: string) => s.replace(/^\d+\s+/, "");

const MAX = { panes: 400, topics: 400, topicEach: 20, parked: 200, archived: 300, snoozed: 500, agents: 50, chKeys: 100, promises: 200, attn: 150_000, all: 450_000 };
const PANE_KEYS = ["area", "kind", "acct", "dur", "stuck", "branch"] as const;
function topicList(v: unknown) {
  return (Array.isArray(v) ? v : []).slice(0, MAX.topicEach).filter(isObj).map(x => ({ ch: str(x.ch, 20), ts: str(x.ts, 20), last: bigint(x.last) })).filter(x => /^\d{10}\.\d{6}$/.test(x.ts));
}
/** 몸통 → 저장할 꼴(모르는 칸은 버리고 길이를 자름). 꼴이 틀리면 null */
export function shape(b: unknown): { state: R; promises: R[] | null } | null {
  if (!isObj(b) || Number(b.v) !== 1) return null;
  const panes: R = {}, topics: R = {};
  for (const [p, x] of Object.entries(isObj(b.panes) ? b.panes : {}).slice(0, MAX.panes)) {
    if (!PANE.test(p) || !isObj(x)) continue;
    panes[p] = { ...Object.fromEntries(PANE_KEYS.map(k => [k, str(x[k], k === "branch" ? 120 : 40)])), wait: Math.max(0, Math.min(999, bigint(x.wait))) };
  }
  for (const [p, x] of Object.entries(isObj(b.topics) ? b.topics : {}).slice(0, MAX.topics)) if (PANE.test(p)) topics[p] = topicList(x);
  const L = isObj(b.leads) ? b.leads : {};
  const leads = { primary: PANE.test(String(L.primary || "")) ? String(L.primary) : "",
    leads: Object.fromEntries(Object.entries(isObj(L.leads) ? L.leads : {}).filter(([k, v]) => /^[a-z]{2,20}$/.test(k) && PANE.test(String(v))).slice(0, 20)),
    windows: Object.fromEntries(Object.entries(isObj(L.windows) ? L.windows : {}).filter(([, v]) => typeof v === "string").slice(0, 500).map(([k, v]) => [str(k, 80), str(v, 20)])) };
  const agents = (Array.isArray(b.agents) ? b.agents : []).filter(isObj).slice(0, MAX.agents).map(x => ({ key: str(x.key, 32), name: str(x.name, 60), lead: PANE.test(String(x.lead || "")) ? String(x.lead) : null })).filter(x => x.key);
  const parked = (Array.isArray(b.parked) ? b.parked : []).filter(isObj).slice(0, MAX.parked).map(x => ({ id: str(x.id, 20), name: str(x.name, 80), area: str(x.area, 20), msg: str(x.msg, 230), owner: !!x.owner, at: bigint(x.at),
    stale: x.stale == null ? null : str(x.stale, 80), wait: str(x.wait, 60), topics: topicList(x.topics), pane: PANE.test(String(x.pane || "")) ? String(x.pane) : null, short: str(x.short, 40), title: str(x.title, 40), watch: str(x.watch, 80) })).filter(x => x.name);
  const archived = (Array.isArray(b.archived) ? b.archived : []).slice(0, MAX.archived).map(x => str(x, 80)).filter(Boolean);
  const snoozed = (Array.isArray(b.snoozed) ? b.snoozed : []).slice(0, MAX.snoozed).map(x => str(x, 80)).filter(Boolean);
  const ch_keys = Object.fromEntries(Object.entries(isObj(b.ch_keys) ? b.ch_keys : {}).filter(([, v]) => typeof v === "string").slice(0, MAX.chKeys).map(([k, v]) => [str(k, 30), str(v, 30)]));
  const attn = b.attn != null && JSON.stringify(b.attn).length <= MAX.attn ? b.attn : null;
  const promises = Array.isArray(b.promises) ? b.promises.filter(isObj).slice(0, MAX.promises).map(x => ({ n: bigint(x.n), due: str(x.due, 40), to: str(x.to, 60), what: str(x.what, 160), watch: str(x.watch, 100), pane: PANE.test(String(x.pane || "")) ? String(x.pane) : "" })).filter(x => x.n > 0 && x.what) : null;
  const state = { v: 1, at: bigint(b.at), panes, topics, leads, agents, parked, archived, snoozed, ch_keys, attn };
  if (JSON.stringify(state).length > MAX.all) return null;
  return { state, promises };
}
export async function ingest(db: D1Database, owner: string, body: unknown, now = Date.now()) {
  const s = shape(body); if (!s) return null;
  const stmts: D1PreparedStatement[] = [db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(owner, HS_KEY, JSON.stringify(s.state), now)];
  let opened = 0, changed = 0, closed = 0;
  if (s.promises) {
    const have = new Map(((await db.prepare("SELECT id, wid, win, who, what, check_by, due FROM member_promise WHERE owner = ? AND wid LIKE 'hp:%' AND state = 'open'").bind(owner).all<R>()).results).map(r => [String(r.wid), r]));
    const seen = new Set<string>();
    for (const p of s.promises) {
      const wid = PROM_WID + p.n, win = p.pane || "%15", h = have.get(wid); seen.add(wid);
      if (!h) { stmts.push(db.prepare("INSERT INTO member_promise(owner, win, wid, who, what, check_by, due, at) VALUES (?,?,?,?,?,?,?,?)").bind(owner, win, wid, p.to, p.what, p.watch, p.due, now)); opened++; }
      else if (h.win !== win || h.who !== p.to || h.what !== p.what || h.check_by !== p.watch || h.due !== p.due) { stmts.push(db.prepare("UPDATE member_promise SET win = ?, who = ?, what = ?, check_by = ?, due = ? WHERE id = ? AND owner = ?").bind(win, p.to, p.what, p.watch, p.due, h.id, owner)); changed++; }
    }
    for (const [wid, h] of have) if (!seen.has(wid)) { stmts.push(db.prepare("UPDATE member_promise SET state = 'kept', done = ?, done_at = ? WHERE id = ? AND owner = ? AND state = 'open'").bind("promises.md 에서 닫힘", now, h.id, owner)); closed++; }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { ok: true, panes: Object.keys(s.state.panes).length, parked: s.state.parked.length, promises: s.promises ? { opened, changed, closed } : null };
}

// ── (가) D1 사본 읽기 ──
export async function read(db: D1Database, me: string, panes: string[], now = Date.now()) {
  const s = now / 1000, ps = [...new Set(panes.filter(p => PANE.test(p)))].slice(0, 300);
  const fixed = [
    db.prepare("SELECT v, at FROM user_pref WHERE owner = ? AND k = ?").bind(me, HS_KEY),
    db.prepare("SELECT v FROM owner_state WHERE k = 'node_pri'"),
    db.prepare("SELECT pane, at, kind FROM wl_log WHERE pane IN (SELECT value FROM json_each(?)) AND at > ? AND kind != '감시' ORDER BY id").bind(JSON.stringify(ps), s - 86400),
    db.prepare("SELECT id, at, pane, win, kind, msg FROM wl_log WHERE kind != '감시' ORDER BY id DESC LIMIT 40"),
    db.prepare("SELECT pane, win, at, msg, cwd FROM wl_log WHERE id IN (SELECT max(id) FROM wl_log WHERE at > ? GROUP BY pane) AND kind = '끝' ORDER BY at DESC").bind(s - 12 * 3600),
    db.prepare("SELECT id, at, pane, win, kind, msg, handled FROM wl_log WHERE at > ? AND ((kind = '결정' AND handled IS NULL) OR msg LIKE '%창 이름 바꿈 「%' OR msg LIKE '합침 → 「%') ORDER BY at, id").bind(s - 7 * 86400),
    db.prepare("SELECT qid, area, kind, short, question, recommend, choices, source, due, card_ts, asked_at, updated_at FROM wl_questions WHERE state = 'open' ORDER BY area, pos"),
    db.prepare("SELECT item, why FROM wl_done_checks WHERE verdict = '모름' AND why NOT LIKE ?").bind(DC_HOLD + "%"),
    db.prepare("SELECT ts, ref, thread, channel, kind, area, state, title, posted_at FROM wl_cards WHERE state IN ('open','answered') ORDER BY posted_at"),
    db.prepare("SELECT ts, thread, channel, kind, area, state, title, posted_at, closed_at FROM wl_cards WHERE state IN ('done','closed','failed') AND kind NOT IN ('blocker','briefing') AND ts GLOB '[0-9]*.[0-9]*' ORDER BY closed_at DESC LIMIT 50"),
    db.prepare("SELECT c.ts, c.area, c.thread, q.qid, q.short, q.question, q.due FROM wl_cards c JOIN wl_questions q ON c.ref = q.area || ':' || q.qid WHERE c.kind = 'todo' AND c.state = 'open' AND q.state = 'open' ORDER BY q.qid"),
  ];
  // 판마다 마지막 줄(감시 포함) · 최근 다섯 줄(감시 빼고) — (pane, at) 색인을 거꾸로 타고 멈춤
  const per = ps.flatMap(p => [
    db.prepare("SELECT id, at, kind, msg, handled FROM wl_log WHERE pane = ? ORDER BY at DESC, id DESC LIMIT 1").bind(p),
    db.prepare("SELECT at, kind, msg FROM wl_log WHERE pane = ? AND kind != '감시' ORDER BY at DESC, id DESC LIMIT 5").bind(p),
  ]);
  const rs = await db.batch([...fixed, ...per]);
  const rows = (i: number) => (rs[i]?.results || []) as R[];
  const hsRow = rows(0)[0];
  const last = new Map<string, R>(), recent = new Map<string, R[]>(), hist = new Map<string, R[]>();
  ps.forEach((p, i) => { const l = rows(fixed.length + 2 * i)[0]; if (l) last.set(p, l); recent.set(p, rows(fixed.length + 2 * i + 1)); });
  for (const r of rows(2)) (hist.get(r.pane) || hist.set(r.pane, []).get(r.pane)!).push(r);
  return { hs: json<R>(hsRow?.v, {}), hsAt: Number(hsRow?.at || 0), pri: json<Record<string, { pri?: string }>>(rows(1)[0]?.v, {}), last, recent, hist,
    feed: rows(3), closed: rows(4), decRen: rows(5), questions: rows(6), checks: rows(7), cards: rows(8), done: rows(9), todoRows: rows(10) };
}

// ── snapshot.py 작은 함수 옮김 ──
export function splitChoice(msg: string): [string, string[]] {   // 「… — 추천: A / 대안: B」
  const m = /추천:\s*(.+?)\s*\/\s*대안:\s*(.+?)(?:\.\s|$| · 근거| 근거)/.exec(msg);
  if (!m) return [clean(msg, 200), []];
  return [clean(msg.slice(0, msg.indexOf("추천:")).replace(/[ —-]+$/, ""), 200), [clean(m[1], 90), clean(m[2], 90)]];
}
const SLACK_URL = /https:\/\/[\w.-]+\.slack\.com\/archives\/[\w/?=&.%-]+/;
const CH_TS = /(?<![\w-])#?(primary|company|dgit|personal|shop)[\s:](\d{10}\.\d{6})/;
export function originOf(text: string) { const u = SLACK_URL.exec(text); if (u) return { url: u[0] }; const m = CH_TS.exec(text); return m ? { ch: m[1], ts: m[2] } : null; }
const DUE = /(?:기한|마감|만료|까지|전까지)[^\d]{0,8}(?:(\d{4})[-./])?(\d{1,2})[/.-](\d{1,2})|(?:(\d{4})[-./])?(\d{1,2})[/.-](\d{1,2})\D{0,3}(?:\d{1,2}:\d{2}\D{0,3})?(?:까지|마감|기한|만료|전)/;
const kstDay = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
export function dueOf(r: R, now: number) {   // worklog_db.due_of: due 칸 먼저, 없으면 글 속 「기한 · 마감 · 까지」 옆 날짜
  if (r.due) return String(r.due);
  const m = DUE.exec(`${r.short || ""} ${r.question || ""}`); if (!m) return null;
  const [y, mo, d] = m[2] ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]];
  const Y = Number(y || kstDay(now).slice(0, 4)), M = Number(mo), D = Number(d), t = new Date(Date.UTC(Y, M - 1, D));
  return t.getUTCMonth() === M - 1 && t.getUTCDate() === D ? t.toISOString().slice(0, 10) : null;
}
const areaOfCwd = (cwd: string) => { for (const [k, a] of [["/work/infra", "primary"], ["/company", "company"], ["/shopco", "shop"], ["/personal", "personal"], ["/dgit", "dgit"]]) if (cwd.includes(k)) return a; return "primary"; };
const head = (msg: string) => Array.from(msg.split(/\s[—:-]\s|[:(]/)[0]);   // snapshot.shorten 앞 절(모델 요약이 없을 때와 같은 꼴)
const priOf = (m: Record<string, { pri?: string }>, name: string) => { const n = stripNo(String(name || "")).trim(); return String(m[n]?.pri || ""); };

export function apply(out: R, V: Awaited<ReturnType<typeof read>>, now = Date.now()) {
  const s = now / 1000, ago = (at: number) => Math.floor((s - Number(at)) / 60), hs = V.hs || {};
  const leads: R = isObj(hs.leads) ? hs.leads : { primary: "", leads: {}, windows: {} };
  const windows: R = isObj(leads.windows) ? leads.windows : {};
  const hp = (out.panes as R[]).filter(p => p.harness), live = new Set(hp.map(p => String(p.pane))), areaOfPane = new Map<string, string>();
  for (const p of hp) {
    const h = isObj(hs.panes) ? hs.panes[p.pane] : null;
    if (h) for (const k of ["acct", "dur", "stuck", "branch"]) p[k] = String(h[k] || "");
    if (h?.area) p.area = String(h.area);
    p.wait = Number(h?.wait || 0);
    const l = V.last.get(p.pane), rec = V.recent.get(p.pane) || [];
    const hd = l ? head(String(l.msg || "")) : [];
    p.last = l ? { id: Number(l.id), ago: ago(l.at), kind: String(l.kind), msg: clean(l.msg, 220), handled: !!l.handled, short: hd.slice(0, 18).join(""), short_ok: false, title: hd.slice(0, 16).join("") } : null;
    p.blocked = p.last && p.last.kind === "막힘" ? p.last : null;
    p.recent = rec.slice().reverse().map(x => ({ ago: ago(x.at), kind: String(x.kind), msg: clean(x.msg, 260) }));
    p.hist = (V.hist.get(p.pane) || []).map(x => ({ m: ago(x.at), k: String(x.kind) }));
    p.owner = !!(p.blocked && /Owner/.test(p.blocked.msg));
    p.topics = p.kind === "primary" || p.kind === "arealead" ? [] : isObj(hs.topics) && Array.isArray(hs.topics[p.pane]) ? hs.topics[p.pane] : [];
    p.pri = priOf(V.pri, p.win);
    p.watch = "";
    areaOfPane.set(p.pane, String(p.area || "primary"));
  }
  const cond = new Map<string, R>((Array.isArray(hs.parked) ? hs.parked as R[] : []).map(x => [String(x.name), x]));
  const parked = out.parked as R[], had = new Set<string>();
  for (const q of parked) {
    if (!q.harness) continue;
    const c = cond.get(stripNo(String(q.name))); if (!c) continue;
    had.add(String(c.name));
    Object.assign(q, { id: c.id || q.id, area: c.area || q.area, msg: c.msg, owner: !!c.owner, ago: ago(c.at), stale: c.stale ?? null, wait: c.wait || "", topics: c.topics || [], short: c.short || q.short, title: c.title || "", watch: c.watch || "", pri: priOf(V.pri, String(q.name)) });
  }
  for (const c of cond.values()) if (!had.has(String(c.name)))
    parked.push({ id: c.id, name: c.name, area: c.area || "primary", msg: c.msg, owner: !!c.owner, ago: ago(c.at), stale: c.stale ?? null, wait: c.wait || "", topics: c.topics || [], pri: priOf(V.pri, String(c.name)), pane: c.pane || null, short: c.short || "", title: c.title || "", watch: c.watch || "", harness: true });
  if (isObj(hs.leads)) {
    const prim = (out.areas as R[]).find(a => a.key === "primary") || {};
    out.areas = [...AREAS.map(([key, name]) => ({ ...(key === "primary" ? { avatar: prim.avatar } : {}), key, name, lead: key === "primary" ? leads.primary || null : (leads.leads || {})[key] ?? null })), ...(out.areas as R[]).filter(a => a.key !== "primary")];
  }
  out.agents = Array.isArray(hs.agents) ? hs.agents : [];
  const feed = V.feed.map(r => ({ id: Number(r.id), ago: ago(r.at), pane: String(r.pane), win: clean(r.win, 30), kind: String(r.kind), msg: clean(r.msg, 160), wl: true }));
  out.feed = [...feed, ...(out.feed as R[])].sort((a, b) => a.ago - b.ago).slice(0, 40);
  for (const r of V.closed) {
    if (live.has(String(r.pane))) continue;
    const w = String(r.win || "").replace(/^%\d+\(|\)$/g, ""), name = stripNo(w);
    (out.closed as R[]).push({ pane: String(r.pane), win: w, ago: ago(r.at), msg: clean(r.msg, 200), area: windows[name] || areaOfCwd(String(r.cwd || "")), wl: true });
  }
  out.archived = [...new Set([...(Array.isArray(hs.archived) ? hs.archived : []), ...(out.archived as string[])])];
  const renames: Record<string, string> = {};
  for (const r of V.decRen) {
    const msg = String(r.msg || ""), m = /창 이름 바꿈 「(.+?)」\s*→\s*「(.+?)」/.exec(msg);
    if (m) { renames[m[1].trim()] = m[2].trim(); continue; }
    const j = /^합침 → 「(.+?)」/.exec(msg), src = stripNo(String(r.win || "").replace(/^%\d+\(|\)$/g, "")).trim();
    if (j && src) renames[src] = j[1].trim();
  }
  for (const k of Object.keys(renames)) { const seen = new Set([k]); let v = renames[k]; while (v in renames && !seen.has(v)) { seen.add(v); v = renames[v]; } if (v === k || seen.has(v)) delete renames[k]; else renames[k] = v; }
  out.renames = renames;
  const later = new Set<string>(Array.isArray(hs.snoozed) ? hs.snoozed.map(String) : []);
  const decisions: R[] = [];
  for (const r of V.decRen.filter(r => r.kind === "결정" && r.handled == null).sort((a, b) => Number(b.id) - Number(a.id))) {
    const [q, ch] = splitChoice(String(r.msg || ""));
    decisions.push({ id: `w${r.id}`, src: "wlog", pane: String(r.pane), win: String(r.win || ""), area: areaOfPane.get(String(r.pane)) || "primary", title: q, body: clean(r.msg, 600), choices: ch, ago: ago(r.at), kind: "결정", wl: true });
  }
  for (const r of V.questions) {
    const ch = [r.recommend, r.choices].filter(Boolean).map(x => clean(x, 90));
    decisions.push({ id: String(r.qid), src: "queue", pane: "", win: "", area: AREA_KO.has(String(r.area)) ? areaKey(String(r.area)) : null, kind: r.kind || "할 일", title: clean(r.short || r.question, 80),
      srcpane: (/%\d+/.exec(String(r.source || "")) || [""])[0], body: clean(r.question, 600), choices: ch, due: r.due ?? null, source: String(r.source || ""), origin: originOf(`${r.question} ${r.source || ""}`), ago: ago(r.asked_at || r.updated_at || s), wl: true });
  }
  const check = new Map(V.checks.map(r => [String(r.item), String(r.why)]));
  const flagged = new Map<string, string>();
  for (const r of V.questions) { const why = check.get(String(r.card_ts || `q:${r.area}:${r.qid}`)); if (why) flagged.set(`${areaKey(String(r.area))}|${r.qid}`, why); }
  const fk = (d: R) => `${d.area}|${d.id}`, open = decisions.filter(d => !later.has(String(d.id)));
  (out.to_check as R[]).push(...open.filter(d => d.src === "queue" && flagged.has(fk(d))).map(d => ({ ...d, why: flagged.get(fk(d)) })));
  out.decisions = [...(out.decisions as R[]), ...open.filter(d => !(d.src === "queue" && flagged.has(fk(d))))];
  const keys: Record<string, string> = isObj(hs.ch_keys) ? hs.ch_keys : {}, vals = new Set(Object.values(keys));
  const chOf = (c: unknown) => keys[String(c || "")] || (vals.has(String(c)) ? String(c) : "primary");
  out.cards = [...(Array.isArray(out.cards) ? out.cards : []), ...V.cards.filter(r => r.state === "open" && DIGITS_TS.test(String(r.ts)) && r.kind !== "blocker").map(r => ({ ts: r.ts, thread: r.thread || r.ts, channel: chOf(r.channel), kind: r.kind, area: r.area, title: String(r.title || ""), wl: true }))];
  out.bthreads = [...(out.bthreads as R[]), ...V.cards.filter(r => r.kind === "blocker").map(r => ({ ref: r.ref, ch: chOf(r.channel), ts: r.ts }))];
  out.cardlist = [...(out.cardlist as R[]), ...V.cards.filter(r => r.kind !== "blocker").map(r => ({ ts: r.ts, ref: r.ref, thread: r.thread || (/^\d/.test(String(r.ts)) ? r.ts : null), channel: chOf(r.channel), kind: r.kind, area: r.area, state: r.state, title: String(r.title || ""), at: r.posted_at, wl: true }))].sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
  out.cardsdone = [...V.done.map(r => ({ ts: r.ts, thread: r.thread || r.ts, channel: chOf(r.channel), kind: r.kind, area: r.area, state: r.state, title: String(r.title || ""), at: r.closed_at || r.posted_at, wl: true })), ...(out.cardsdone as R[])];
  if (hs.attn != null) out.attn = hs.attn;
  // 할 일(카드 kind todo ⋈ 열린 큐 질문): 기한 3일 안(지난 것은 7일까지) · 확인 필요 · 「나중에」는 뺌
  const today = Date.parse(kstDay(now)), todos: R[] = [];
  for (const r of V.todoRows) {
    const due = dueOf(r, now); if (!due) continue;
    const ba = areaKey(String(r.area)), dd = Date.parse(due), late = Math.round((today - dd) / 86_400_000);
    if (!(late <= 7 && late >= -3) || flagged.has(`${ba}|${r.qid}`) || later.has(String(r.qid))) continue;
    const dq = decisions.find(d => d.src === "queue" && d.id === String(r.qid) && d.area === ba) || {};
    todos.push({ ts: r.ts, area: ba, qarea: r.area, id: String(r.qid), due, thread: r.thread, why: "", ai: false, origin: dq.origin ?? null, body: dq.body || "", late, title: clean(r.short || r.question, 80), wl: true });
  }
  todos.sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  out.todos = [...todos, ...(out.todos as R[])];
  out.harness_state_at = V.hsAt ? Math.floor(V.hsAt / 1000) : 0;
  return out;
}
