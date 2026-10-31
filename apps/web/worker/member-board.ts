
import { regroup } from "./importer/routes";

type R = Record<string, any>;
const FREQ = ["white_check_mark", "eyes", "+1", "raised_hands", "pray", "heart", "tada", "fire", "joy", "thinking_face", "100", "bulb"];   // owner-read FREQ_DEFAULT
const PRIMARY = "%1";
const ME = "나";        // 회원이 Primary 채팅에 쓴 줄의 win(/api/me/chat)
const OWN = /^보더 들여오기$|(^|:)boarder(-|:)import$/;   // 보더 자신의 줄(importer IMPORT_WIN 과 같음)
const KIND_KO: Record<string, string> = { start: "시작", progress: "진행", blocked: "막힘", done: "끝", decision: "결정", incident: "장애", deadline: "마감", chat: "진행", sys: "진행" };
const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) as T : d; } catch { return d; } };
const cut = (s: unknown, n: number) => { const a = Array.from(String(s ?? "")); return a.length <= n ? a.join("") : a.slice(0, n - 1).join("") + "…"; };

export function paneOfId(id: string) {
  let h = 2166136261; for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return "%" + (1_000_000 + h % 8_999_999);
}
// 글 id → Slack 꼴 ts(초.마이크로초 — 마이크로초 자리에 줄 id, 같은 초 안 순서도 id 순)
const tsOf = (at: number, id: number) => `${Math.floor(at / 1000)}.${String(id % 1_000_000).padStart(6, "0")}`;
const kst = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ms);

type Node = { id: string; pane: string; name: string; state: string; why: string; updated_at: number; archived_at: number | null; wins: Set<string>; windows: R[]; convos: R[] };

export async function fresh(env: { DB: D1Database; PUBLIC_URL: string }, me: string) {
  const [la, lw] = await env.DB.batch([
    env.DB.prepare("SELECT MAX(at) at FROM imp_audit WHERE owner = ?").bind(me),
    env.DB.prepare("SELECT MAX(x) at FROM (SELECT MAX(at) x FROM board_log WHERE owner = ? UNION ALL SELECT MAX(COALESCE(answered_at, at)) FROM board_card WHERE owner = ?)").bind(me, me),
  ]);
  const a = (la.results[0] as { at: number | null })?.at || 0, w = (lw.results[0] as { at: number | null })?.at || 0;
  if (w > a || (a && Date.now() - a > 10 * 60_000)) await regroup(env as never, me);
}

async function load(db: D1Database, me: string) {
  const [nd, mi, it, tk, lg, cd, dr, ew, ns] = await db.batch([
    db.prepare("SELECT id, name, pinned_name, state, why, counts, updated_at, archived_at FROM mnode WHERE owner = ? AND (archived_at IS NULL OR archived_at > ?) ORDER BY updated_at DESC").bind(me, Date.now() - 24 * 3600_000),
    db.prepare("SELECT item, node FROM mnode_item WHERE owner = ?").bind(me),
    db.prepare("SELECT key, kind, engine, title, cwd, branch, refs, state, state_at, seen_at, win, device_id, gone_at FROM imp_item WHERE owner = ? AND (gone_at IS NULL OR gone_at > ?)").bind(me, Date.now() - 24 * 3600_000),
    db.prepare("SELECT pane, win FROM agent_token WHERE owner = ? ORDER BY created_at").bind(me),
    db.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? ORDER BY at DESC LIMIT 600").bind(me),
    db.prepare("SELECT rowid AS n, id, win, question, choices, recommend, body, state, answer, at FROM board_card WHERE owner = ? AND (state = 'open' OR (state = 'answered' AND answered_at > ?)) ORDER BY at DESC LIMIT 100").bind(me, Date.now() - 86_400_000),
    db.prepare("SELECT rowid AS n, id, name, brief, at FROM (SELECT rowid, id, name, brief, created_at AS at FROM role_draft WHERE owner = ? AND state = 'draft' ORDER BY created_at DESC LIMIT 30)").bind(me),
    db.prepare("SELECT id, kind, name, state, state_at, note, created_at, closed_at FROM engine_window WHERE owner = ? AND (state NOT IN ('closed','failed','gone') OR state_at > ?) ORDER BY created_at DESC LIMIT 60").bind(me, Date.now() - 12 * 3600_000),
    db.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me),
  ]);
  const items = new Map((it.results as R[]).map(r => [String(r.key), r]));
  const keyOfWin = new Map<string, string>(); for (const r of tk.results as R[]) keyOfWin.set(r.win, r.pane);
  const itemOfWin = new Map<string, string>(); for (const i of items.values()) if (i.win && (i.kind === "window" || !itemOfWin.has(i.win))) itemOfWin.set(i.win, i.key);
  const nodeOfItem = new Map((mi.results as R[]).map(r => [String(r.item), String(r.node)]));
  const nodes: Node[] = (nd.results as R[]).map(n => ({ id: n.id, pane: paneOfId(n.id), name: String(n.pinned_name || n.name || "노드"), state: n.state, why: n.why || "", updated_at: n.updated_at, archived_at: n.archived_at, wins: new Set<string>(), windows: [], convos: [] }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const [item, node] of nodeOfItem) {
    const n = byId.get(node); if (!n) continue;
    const i = items.get(item);
    if (i?.kind === "window" && !i.gone_at) n.windows.push(i);
    if (i && (i.kind === "session" || i.kind === "thread") && i.title) n.convos.push(i);   // 들여온 대화 — 노드 채팅에 글로(convoMsg)
    const w = i ? i.win : item.startsWith("win:") ? item.slice(4) : null; if (w) n.wins.add(w);
  }
  const mains = new Map((nd.results as R[]).map(n => [String(n.id), json<{ main?: string }>(n.counts, {}).main || ""]));
  for (const n of nodes) { const m = mains.get(n.id); if (m) n.windows.sort((a, b) => Number(b.key === m) - Number(a.key === m)); }
  const nodeOfWin = (win: string) => { const k = keyOfWin.get(win) || win, item = itemOfWin.get(k) || `win:${k}`; return byId.get(nodeOfItem.get(item) || "") || null; };
  // 엔진 창(역할 · 메인): 노드에 안 묶인 역할 창은 제 이름으로 한 노드
  const mainWin = (ew.results as R[]).find(w => w.kind === "main" && !["closed", "failed", "gone"].includes(w.state)) || null;
  const engineNodes = (ew.results as R[]).filter(w => w.kind === "role" && !nodes.some(n => n.name === w.name || n.wins.has(w.name)));
  return { nodes, byId, mains, agentUnit: /"unit":"agent"/.test(String((ns.results[0] as R | undefined)?.data || "")), nodeOfWin, logs: lg.results as R[], cards: cd.results as R[], drafts: dr.results as R[], mainWin, engineNodes };
}

const STATE: Record<string, string> = { working: "일하는 중", busy: "일하는 중", starting: "일하는 중", opening: "일하는 중", background: "뒤 작업 중" };

export async function data(db: D1Database, me: string, bot: { name?: string } | null) {
  const L = await load(db, me), now = Date.now(), ago = (ms: number) => Math.max(0, Math.round((now - ms) / 60_000));
  const line = (r: R) => ({ id: r.id, ago: ago(r.at), kind: KIND_KO[r.kind] || r.kind, msg: cut(r.text, 220), handled: false, short: cut(r.text, 60), short_ok: true, title: cut(r.text, 30) });
  const logsOf = (n: Node | null, wins?: string[]) => L.logs.filter(r => r.thread !== "primary" && r.kind !== "me" && !OWN.test(r.win) && (n ? L.nodeOfWin(r.win) === n : wins!.includes(r.win)));
  const pane = (o: { pane: string; win: string; kind: string; state: string; cwd?: string; branch?: string; rows: R[]; blockedOwner?: boolean }) => {
    const last = o.rows[0] ? line(o.rows[0]) : null, blk = last && last.kind === "막힘" ? last : null;
    return { win: o.win, area: "primary", role: "리드", pane: o.pane, acct: "", state: o.state, dur: "", stuck: "", cwd: o.cwd || "", branch: o.branch || "", kind: o.kind, last, blocked: blk,
      recent: o.rows.slice(0, 5).reverse().map(r => ({ ago: ago(r.at), kind: KIND_KO[r.kind] || r.kind, msg: cut(r.text, 260) })),
      hist: o.rows.filter(r => now - r.at < 86_400_000).reverse().map(r => ({ m: ago(r.at), k: KIND_KO[r.kind] || r.kind })), topics: [], pri: "", owner: !!blk, watch: "" };
  };
  const mainName = bot?.name || "Primary";
  const panes: R[] = [pane({ pane: PRIMARY, win: mainName, kind: "primary", state: STATE[L.mainWin?.state] || "쉼", rows: L.logs.filter(r => r.thread === "primary" && r.win !== ME && r.win !== "보더") })];
  const parked: R[] = [], closed: R[] = [];
  for (const n of L.nodes) {
    const rows = logsOf(n), w0 = n.windows[0];
    if (n.archived_at || n.state === "done") { closed.push({ pane: n.pane, win: n.name, ago: ago(n.archived_at || n.updated_at), msg: rows[0] ? cut(rows[0].text, 200) : n.why, area: "primary" }); continue; }
    if (n.state === "parked") { parked.push({ id: "c" + n.pane.slice(1), name: n.name, area: "primary", msg: n.why || "주차", owner: false, ago: ago(n.updated_at), stale: null, wait: n.why || "주차", topics: [], pri: "", pane: n.pane, short: n.why || "주차", watch: "" }); continue; }
    panes.push(pane({ pane: n.pane, win: n.name, kind: "lead", state: STATE[n.state] || (n.state === "turn" ? "질문" : "쉼"), cwd: w0?.cwd, branch: w0?.branch, rows }));
  }
  for (const w of L.engineNodes) {
    const rows = logsOf(null, [w.name]), p = paneOfId(w.id);
    if (w.state === "parked") parked.push({ id: "c" + p.slice(1), name: w.name, area: "primary", msg: w.note || "주차", owner: false, ago: ago(w.state_at || w.created_at), stale: null, wait: "주차", topics: [], pri: "", pane: p, short: "주차", watch: "" });
    else if (["closed", "failed", "gone"].includes(w.state)) closed.push({ pane: p, win: w.name, ago: ago(w.closed_at || w.state_at || w.created_at), msg: w.note || "", area: "primary" });
    else panes.push(pane({ pane: p, win: w.name, kind: "lead", state: STATE[w.state] || "쉼", rows }));
  }
  const known = new Set(panes.map(p => p.pane)), toPane = (win: string) => { const n = L.nodeOfWin(win); return n && known.has(n.pane) ? n.pane : PRIMARY; };
  const decisions: R[] = [], cardlist: R[] = [];
  for (const c of L.cards) {
    const id = "w" + c.n, ch = json<string[]>(c.choices, []).map(x => cut(x, 90));
    if (c.state === "open") decisions.push({ id, src: "wlog", pane: toPane(c.win), win: c.win, area: "primary", title: cut(c.question, 200), body: cut(c.body || "", 600), choices: c.recommend && ch.includes(c.recommend) ? [c.recommend, ...ch.filter(x => x !== c.recommend)] : ch, ago: ago(c.at), kind: "결정" });
    cardlist.push({ ts: "w:" + c.n, ref: "w:" + c.n, thread: null, channel: "primary", kind: "decision", area: "primary", state: c.state === "open" ? "open" : "answered", title: cut(c.question, 80), at: c.at / 1000 });
  }
  for (const d of L.drafts) {
    const n = 1_000_000_000 + d.n;
    decisions.push({ id: "w" + n, src: "wlog", pane: PRIMARY, win: mainName, area: "primary", title: `「${cut(d.name, 40)}」 역할 창을 열까요?`, body: cut(d.brief || "", 600), choices: ["이대로 열기", "버리기"], ago: ago(d.at), kind: "결정" });
    cardlist.push({ ts: "w:" + n, ref: "w:" + n, thread: null, channel: "primary", kind: "decision", area: "primary", state: "open", title: `「${cut(d.name, 40)}」 역할 창`, at: d.at / 1000 });
  }
  cardlist.sort((a, b) => a.at - b.at);
  const feed = L.logs.filter(r => !OWN.test(r.win) && r.thread !== "primary" && r.kind !== "me").slice(0, 40).map(r => ({ id: r.id, ago: ago(r.at), pane: L.nodeOfWin(r.win)?.pane || PRIMARY, win: cut(r.win, 30), kind: KIND_KO[r.kind] || r.kind, msg: cut(r.text, 160) }));
  return { generated: kst(now), areas: [{ key: "primary", name: "Primary", lead: PRIMARY }], panes, closed, parked, archived: [], decisions, to_check: [], promises: [], feed,
    park_metrics: { at: Math.floor(now / 1000), open: panes.length, due: 0, overdue: 0, overdue_names: [], parked: parked.length, reopen_ok_24h: 0, reopen_fail_24h: 0, overdue_max_24h: 0 },
    cards: [], cardlist, attn: null, relinks: {}, todos: [], bthreads: [] };
}

// ── 채팅(chat.py norm 꼴) ──
function msg(r: R, me: string, mainName: string) {
  const mine = r.win === ME || r.kind === "me";   // me = 노드 채팅에서 내가 그 창에 넣은 글
  return { ts: tsOf(r.at, r.id), thread: null, who: mine ? "owner" : "agent", name: mine ? "Owner" : r.win === "보더" ? "보더" : mainName, board: false, text: String(r.text || ""), buttons: [], files: [], replies: 0, latest: null, rnames: [], reactions: [], owner: null, ...(mine ? { src: String(r.text || "") } : {}) };
}
// 들여온 대화 한 줄 → 노드 채팅 글. 세션 = 그 사람이 처음 물은 한 줄(들여오기가 보낸 것만 — 대화 내용은 안 옴), 스레드 · 이슈 = 제목.
// 어디서 왔는지는 노드 채널 옮긴 글과 같은 「↪ #… 에서 옮겨 옴」(moved) 줄로
const ORIGIN: Record<string, string> = { claude: "Claude Code", codex: "Codex", slack: "Slack", gh: "GitHub", linear: "Linear" };
const convoAt = (i: R) => Number(i.state_at || i.seen_at || 0);
export function convoMsg(i: R, mainName: string) {
  const ref = String(json<string[]>(i.refs, [])[0] || ""), src = i.kind === "session" ? String(i.engine || "claude") : ref.split(":")[0];
  let h = 0; for (const ch of String(i.key)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const at = convoAt(i), mine = i.kind === "session";
  return { ...msg({ id: h, win: mine ? ME : "보더", kind: mine ? "me" : "chat", text: String(i.title), at }, "", mainName), ch: "primary", moved: { chan: ORIGIN[src] || src || "들여오기", at: at / 1000 } };
}
async function primaryRows(db: D1Database, me: string, before?: string) {
  const m = before ? /^(\d{10})\.(\d{6})$/.exec(before) : null, sec = m ? Number(m[1]) * 1000 : 0;
  return (await db.prepare(`SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = 'primary'${m ? " AND (at < ? OR (at < ? AND id % 1000000 < ?))" : ""} ORDER BY at DESC, id DESC LIMIT 101`)
    .bind(me, ...(m ? [sec, sec + 1000, Number(m[2])] : [])).all<R>()).results;
}

// 회원 GET — 보드 화면 길만. null = 이 길은 회원 보드 것이 아님(→ 403)
export async function etag(b: string) { return '"m' + [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(b)))].slice(0, 8).map(x => x.toString(16).padStart(2, "0")).join("") + '"'; }
export async function get(db: D1Database, me: string, bot: { name?: string } | null, url: URL, emoji: () => Promise<{ body: string; etag: string } | null>, inm?: string): Promise<Response | null> {
  const p = url.pathname, mainName = bot?.name || "Primary";
  const j = (o: unknown, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-boarder-src": "member" } });
  if (p === "/api/data") {   // 보드처럼 ETag — 안 바뀌면 빈 304(20초 폴링)
    const b = JSON.stringify(await data(db, me, bot)), t = await etag(b), h = { etag: t, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-boarder-src": "member" };
    return inm === t ? new Response(null, { status: 304, headers: h }) : new Response(b, { headers: { ...h, "content-type": "application/json; charset=utf-8" } });
  }
  if (p === "/api/topics") return j({ topics: [], threads: [] });
  if (p === "/api/history") { const now = Math.floor(Date.now() / 1000); return j({ now, since: now - 72 * 3600, oldest: now, rows: [] }); }
  if (p === "/api/inbox") return j({ unread: [], drafts: [], saved: [], saved_ids: [] });
  if (p === "/api/arts") return j({});
  if (/^\/api\/artnotes\/[A-Za-z0-9]{16,40}$/.test(p)) return j({ notes: [] });
  if (p === "/api/emoji/frequent") return j({ names: FREQ });
  if (p === "/api/drafts") return j({});
  if (p === "/api/push/key") return j({ key: "" });   // 빈 키 = 화면이 푸시를 조용히 끔(회원 푸시 길 없음)
  if (p === "/api/voice/modes") return j({});
  if (/^\/api\/answer\/[\w-]{1,64}$/.test(p)) return j({ ok: true, state: "ok" });   // 회원 쓰기는 바로 끝나서 기다릴 일 없음
  if (p === "/emoji.json") { const e = await emoji(); return e ? new Response(e.body, { headers: { "content-type": "application/json; charset=utf-8", etag: e.etag } }) : j({ cats: [], e: {} }); }   // 이름 ↔ 글자 공용 표(사람 데이터 아님)
  let m = /^\/api\/chat\/(\w+)(?:\/(\d{10}\.\d{6}))?$/.exec(p);
  if (m) {
    if (m[1] !== "primary") return j({ channel: m[1], messages: [], more: false, cursor: null, read_at: Math.floor(Date.now() / 1000), stale_min: 0 });
    if (m[2]) {   // 회원 채팅엔 스레드가 없음 — 뿌리 글 하나
      const rows = await db.prepare("SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = 'primary' AND id % 1000000 = ? AND at >= ? AND at < ?").bind(me, Number(m[2].split(".")[1]), Number(m[2].split(".")[0]) * 1000, Number(m[2].split(".")[0]) * 1000 + 1000).all<R>();
      return j({ channel: "primary", root: m[2], owner: null, messages: rows.results.map(r => msg(r, me, mainName)) });
    }
    const rows = await primaryRows(db, me, url.searchParams.get("before") || undefined), page = rows.slice(0, 100), msgs = page.map(r => msg(r, me, mainName)).reverse();
    return j({ channel: "primary", messages: msgs, more: rows.length > 100, cursor: msgs.length ? msgs[0].ts : null, read_at: Math.floor(Date.now() / 1000), stale_min: 0 });
  }
  if (p === "/api/nodechat") {
    const raw = String(url.searchParams.get("w") || "").trim(), t = raw.replace(/^\d+\s+/, "").trim();
    if (!t) return j({ error: "노드 이름" }, 400);
    const L = await load(db, me), n = L.nodes.find(x => x.name === raw) || L.nodes.find(x => x.name === t), ew = L.engineNodes.find(x => x.name === raw || x.name === t);
    const rows = L.logs.filter(r => r.thread !== "primary" && !OWN.test(r.win) && (n ? L.nodeOfWin(r.win) === n || (r.kind === "me" && r.win === n.name) : ew ? r.win === ew.name : false)).slice(0, 300).reverse();
    const out = [...rows.map(r => ({ at: Number(r.at), m: { ...msg(r, me, r.win), ch: "primary" } })), ...(n ? n.convos.map(i => ({ at: convoAt(i), m: convoMsg(i, mainName) })) : [])]
      .sort((a, b) => a.at - b.at).slice(-300).map(x => x.m);
    return j({ channel: "n:" + t, messages: out, stale_min: 0, more: false });
  }
  return null;
}

export type Hop = { path: string; body: unknown; log?: { win: string; text: string } } | { error: string; status: number } | { ok: R };
export async function post(db: D1Database, me: string, path: string, b: R): Promise<Hop> {
  if (path === "/api/chat") {
    if (b.seen) return { ok: { ok: true, state: "ok", seen: false } };   // 읽음 표는 아직 없음(보드가 열 때마다 부름 — 오류로 띄우지 않음)
    if (b.react || b.edit !== undefined || b.delete || b.label || (Array.isArray(b.files) && b.files.length)) return { error: "아직 안 돼요", status: 400 };
    const text = String(b.text || "").trim(); if (!text) return { error: "내용을 적어요", status: 400 };
    const bk = /^w:(\d+)$/.exec(String((b.blocker as R | undefined)?.ref || ""));
    if (bk) return post(db, me, "/api/answer", { item: "w" + bk[1], text });
    const pane = String(b.pane || "");
    if (pane && pane !== PRIMARY) {
      const L = await load(db, me), n = L.nodes.find(x => x.pane === pane);
      if (n) {
        // 에이전트마다 채널은 일 창이 여럿 — 주 창이 닫혔으면 아무 일 창에나 넣지 않음
        const w = L.agentUnit ? n.windows.find(x => x.key === L.mains.get(n.id)) : n.windows[0];
        if (!w) return { error: "이 노드엔 글을 넣을 창이 없어요", status: 404 };
        const log = { win: String(w.win || n.name), text };
        return { path: "/api/me/nodes/cmd", body: { verb: w.state === "parked" ? "reopen" : "send", item: w.key, text }, log };
      }
      const ew = L.engineNodes.find(x => paneOfId(x.id) === pane);
      if (!ew) return { error: "없는 노드", status: 404 };
      return { path: `/api/me/windows/${ew.id}/say`, body: { text }, log: { win: String(ew.name), text } };
    }
    if (b.channel && b.channel !== "primary") return { error: "아직 안 돼요", status: 400 };
    return { path: "/api/me/chat", body: { text } };
  }
  if (path === "/api/answer") {
    const m = /^w(\d+)$/.exec(String(b.item || "")), text = String(b.text || "").trim();
    if (!m || !text) return { error: "요청 모양이 틀림", status: 400 };
    const n = Number(m[1]);
    if (n >= 1_000_000_000) {   // 역할 초안
      const d = await db.prepare("SELECT id FROM role_draft WHERE rowid = ? AND owner = ?").bind(n - 1_000_000_000, me).first<{ id: string }>();
      if (!d) return { error: "없는 초안", status: 404 };
      if (text === "이대로 열기") return { path: `/api/me/drafts/${d.id}/approve`, body: {} };
      if (text === "버리기") return { path: `/api/me/drafts/${d.id}/dismiss`, body: {} };
      return { error: "이대로 열기 · 버리기 중에 골라요", status: 400 };
    }
    const c = await db.prepare("SELECT id FROM board_card WHERE rowid = ? AND owner = ?").bind(n, me).first<{ id: string }>();
    if (!c) return { error: "없는 카드", status: 404 };
    if (text === "(나중에)") return { error: "아직 안 돼요", status: 400 };
    return { path: `/api/me/cards/${c.id}/answer`, body: { choice: text, free: true } };
  }
  if (path === "/api/draft" || path === "/api/cardcheck" || path === "/api/todo" || path === "/api/nodepri") return { ok: { ok: true, state: "ok" } };   // 저장 표 없음 — 화면 쪽(이 기기)에만 남음
  return { error: "아직 안 돼요", status: 400 };
}
