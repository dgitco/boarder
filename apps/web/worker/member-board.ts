
import { regroup } from "./importer/routes";
import { boardHead, withHead } from "./board-head";
import { primaryOf, type Item } from "./importer/group";
import { history, topics, promiseRows } from "./member-views";

type R = Record<string, any>;
const FREQ = ["white_check_mark", "eyes", "+1", "raised_hands", "pray", "heart", "tada", "fire", "joy", "thinking_face", "100", "bulb"];   // owner-read FREQ_DEFAULT
const PRIMARY = "%1";
export const ME = "나";        // 회원이 Primary 채팅에 쓴 줄의 win(/api/me/chat)
export const OWN = /^보더 들여오기$|(^|:)boarder(-|:)import$/;
const NODE_PRI = ["급함", "높음", "보통", "낮음"];
const priOf = (m: Record<string, { pri?: string }>, name: string) => String(m[name]?.pri || m[name.replace(/^\d+\s+/, "")]?.pri || "");
const PTH = /^p:\d{10}\.\d{6}$/;
export const primaryThread = (ts: string) => "p:" + ts;
export const inPrim = (r: { thread?: string | null }) => r.thread === "primary" || PTH.test(String(r.thread || ""));
export const KIND_KO: Record<string, string> = { start: "시작", progress: "진행", blocked: "막힘", done: "끝", decision: "결정", incident: "장애", deadline: "마감", chat: "진행", sys: "진행", reply: "답" };
export const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) as T : d; } catch { return d; } };
export const myName = (me: string, who?: string | null) => String(who || String(me).split("@")[0] || "나").slice(0, 40);
export const cut = (s: unknown, n: number) => { const a = Array.from(String(s ?? "")); return a.length <= n ? a.join("") : a.slice(0, n - 1).join("") + "…"; };

export function paneOfId(id: string) {
  let h = 2166136261; for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return "%" + (1_000_000 + h % 8_999_999);
}
// 글 id → Slack 꼴 ts(초.마이크로초 — 마이크로초 자리에 줄 id, 같은 초 안 순서도 id 순)
export const tsOf = (at: number, id: number) => `${Math.floor(at / 1000)}.${String(id % 1_000_000).padStart(6, "0")}`;
const kst = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ms);

type Node = { id: string; pane: string; name: string; area: string; state: string; why: string; updated_at: number; archived_at: number | null; wins: Set<string>; windows: R[]; convos: R[] };

export type Face = { seed: string; hue: number; photo?: string };
const FACE_SEEDS = ["mochi", "pebble", "nova", "tofu", "echo", "kiwi", "company lead", "DGit lead", "personal lead", "shop lead", "luma", "bean"];   // botpick.js SEEDS
const FACE_HUES = [18, 45, 140, 180, 215, 265, 320, 0];   // botpick.js HUES
const FACE_SEED = /^[A-Za-z0-9 _-]{1,40}$/, BLOB_ID = /^[0-9a-f]{32}$/;
export const meKey = (me: string) => "@me:" + String(me).toLowerCase();
export function faceOf(name: string): Face {
  let h = 2166136261; for (const ch of String(name || "").trim()) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619) >>> 0; }
  return { seed: FACE_SEEDS[h % FACE_SEEDS.length], hue: FACE_HUES[(h >>> 8) % FACE_HUES.length] };
}
// 저장된 값 → 얼굴(틀린 값은 버림). photo 는 R2 blobs/ id 만
export function cleanFace(v: unknown): Face | null {
  if (!v || typeof v !== "object") return null;
  const o = v as R, seed = String(o.seed ?? ""), hue = Number(o.hue), photo = String(o.photo ?? "");
  if (!FACE_SEED.test(seed) || !Number.isInteger(hue) || hue < 0 || hue > 359 || (photo && !BLOB_ID.test(photo))) return null;
  return { seed, hue, ...(photo ? { photo } : {}) };
}
const faceRow = (r: R | undefined | null) => r ? cleanFace(r) : null;
function facesOf(data: unknown): Record<string, Face> {
  const f = json<{ faces?: Record<string, unknown> }>(data, {}).faces, out: Record<string, Face> = {};
  if (f && typeof f === "object") for (const [k, v] of Object.entries(f)) { const c = cleanFace(v); if (c) out[k] = c; }
  return out;
}
export async function nodeIdOf(db: D1Database, me: string, ref: string): Promise<string | null> {
  const r = String(ref || "").trim(); if (!r || r.length > 80) return null;
  const rows = ((await db.prepare("SELECT id FROM mnode WHERE owner = ?1 UNION ALL SELECT id FROM engine_window WHERE owner = ?1 AND kind = 'role'").bind(me).all<R>()).results).map(x => String(x.id));
  return rows.find(id => id === r || paneOfId(id) === r) || null;
}
// 노드 얼굴 고르기 · 되돌리기(face = null). 다른 설정 칸(unit · pri · 정리 기준)은 그대로 — faces 칸만 json_patch
export async function setNodeFace(db: D1Database, me: string, ref: string, face: Face | null) {
  const id = await nodeIdOf(db, me, ref); if (!id) return { error: "없는 노드예요", status: 404 } as const;
  const patch = JSON.stringify({ [id]: face });
  await db.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?1, json_object('faces', json_patch('{}', json(?2))), ?3) ON CONFLICT(owner) DO UPDATE SET data = json_set(CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END, '$.faces', json_patch(CASE WHEN json_valid(data) AND json_type(data, '$.faces') = 'object' THEN json_extract(data, '$.faces') ELSE '{}' END, json(?2))), updated_at = ?3").bind(me, patch, Date.now()).run();
  return { ok: true, node: id, pane: paneOfId(id), avatar: face } as const;
}
export async function myAvatar(db: D1Database, me: string) { return faceRow(await db.prepare("SELECT seed, hue, photo FROM member_bot WHERE owner = ?").bind(meKey(me)).first<R>()) || faceOf(String(me).toLowerCase()); }
export async function setMyAvatar(db: D1Database, me: string, face: Face) {
  await db.prepare("INSERT INTO member_bot (owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,'',?,'','',?) ON CONFLICT(owner) DO UPDATE SET seed = excluded.seed, hue = excluded.hue, photo = excluded.photo, updated_at = excluded.updated_at")
    .bind(meKey(me), face.seed, face.hue, face.photo || "", Date.now()).run();
  return face;
}
// 설정 › 노드 「얼굴」 목록: 열 머리 먼저, 그다음 노드. avatar = 지금 보이는 얼굴, custom = 고른 것인지
export async function nodeFaceList(db: D1Database, me: string, bot: { name?: string } | null) {
  const d = await data(db, me, bot), L = await load(db, me);
  const idOf = new Map<string, string>([...L.nodes.map(n => [n.pane, n.id] as [string, string]), ...L.engineNodes.map(w => [paneOfId(String(w.id)), String(w.id)] as [string, string])]);
  const heads = new Map((d.areas as R[]).filter(a => a.key !== "primary").map(a => [String(a.lead), a]));
  return (d.panes as R[]).filter(p => p.kind === "lead").map(p => {
    const id = idOf.get(p.pane) || "", h = heads.get(p.pane), mine = id ? L.faces[id] : undefined;
    return { pane: p.pane, node: id, name: p.win, head: !!h, column: h ? h.name : "", avatar: mine || (h ? h.avatar : faceOf(String(p.win))), custom: !!mine };
  }).sort((a, b) => Number(b.head) - Number(a.head));
}

export async function fresh(env: { DB: D1Database; PUBLIC_URL: string }, me: string) {
  const [la, lw] = await env.DB.batch([
    env.DB.prepare("SELECT MAX(at) at FROM imp_audit WHERE owner = ?").bind(me),
    env.DB.prepare("SELECT MAX(x) at FROM (SELECT MAX(at) x FROM board_log WHERE owner = ? UNION ALL SELECT MAX(COALESCE(answered_at, at)) FROM board_card WHERE owner = ?)").bind(me, me),
  ]);
  const a = (la.results[0] as { at: number | null })?.at || 0, w = (lw.results[0] as { at: number | null })?.at || 0;
  if (w > a || (a && Date.now() - a > 10 * 60_000)) await regroup(env as never, me);
}

export async function load(db: D1Database, me: string) {
  const [nd, mi, it, tk, lg, cd, dr, ew, ns, pw, mb] = await db.batch([
    db.prepare("SELECT id, name, pinned_name, area, state, why, counts, updated_at, archived_at FROM mnode WHERE owner = ? AND (archived_at IS NULL OR archived_at > ?) ORDER BY updated_at DESC").bind(me, Date.now() - 24 * 3600_000),
    db.prepare("SELECT item, node FROM mnode_item WHERE owner = ?").bind(me),
    db.prepare("SELECT key, kind, engine, title, cwd, branch, refs, state, state_at, seen_at, win, session, device_id, gone_at, CASE WHEN kind = 'window' THEN handle END handle FROM imp_item WHERE owner = ? AND (gone_at IS NULL OR gone_at > ?)").bind(me, Date.now() - 24 * 3600_000),
    db.prepare("SELECT pane, win FROM agent_token WHERE owner = ? ORDER BY created_at").bind(me),
    db.prepare("SELECT id, win, kind, text, thread, at, wid FROM board_log WHERE owner = ? ORDER BY at DESC LIMIT 600").bind(me),
    db.prepare("SELECT rowid AS n, id, win, kind, snooze_until, question, choices, recommend, body, state, answer, answered_at, at FROM board_card WHERE owner = ? AND (state = 'open' OR (state = 'answered' AND answered_at > ?)) ORDER BY at DESC LIMIT 100").bind(me, Date.now() - 86_400_000),
    db.prepare("SELECT rowid AS n, id, name, brief, at FROM (SELECT rowid, id, name, brief, created_at AS at FROM role_draft WHERE owner = ? AND state = 'draft' ORDER BY created_at DESC LIMIT 30)").bind(me),
    db.prepare("SELECT id, kind, name, state, state_at, note, created_at, closed_at FROM engine_window WHERE owner = ? AND (state NOT IN ('closed','failed','gone') OR state_at > ?) ORDER BY created_at DESC LIMIT 60").bind(me, Date.now() - 12 * 3600_000),
    db.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me),
    db.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = 'primary_win'").bind(me),
    db.prepare("SELECT owner, seed, hue, photo FROM member_bot WHERE owner IN (?, ?)").bind(me, meKey(me)),   // 메인 봇 얼굴 · 내 아바타(@me:<메일>)
  ]);
  const items = new Map((it.results as R[]).map(r => [String(r.key), r]));
  const keyOfWin = new Map<string, string>(); for (const r of tk.results as R[]) keyOfWin.set(r.win, r.pane);
  const itemOfWin = new Map<string, string>(); for (const i of items.values()) if (i.win && (i.kind === "window" || !itemOfWin.has(i.win))) itemOfWin.set(i.win, i.key);
  const nodeOfItem = new Map((mi.results as R[]).map(r => [String(r.item), String(r.node)]));
  const primary = (ew.results as R[]).some(w => w.kind === "main" && !["closed", "failed", "gone"].includes(w.state)) ? null : primaryOf([...items.values()] as unknown as Item[]) as unknown as R | null;   // 보더 메인 봇 창이 떠 있으면 그게 메인 봇(engine.ts importedPrimary 와 같은 판정)
  const primKeys = new Set<string>(primary ? [String(primary.key), ...(primary.session ? [String(primary.session)] : [])] : []);
  const isPrimWin = (win: string) => !!primary?.win && (keyOfWin.get(win) || win) === primary.win;
  const nodes: Node[] = (nd.results as R[]).map(n => ({ id: n.id, pane: paneOfId(n.id), name: String(n.pinned_name || n.name || "노드"), area: String(n.area || "").trim(), state: n.state, why: n.why || "", updated_at: n.updated_at, archived_at: n.archived_at, wins: new Set<string>(), windows: [], convos: [] }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const [item, node] of nodeOfItem) {
    const n = byId.get(node); if (!n || primKeys.has(item)) continue;
    const i = items.get(item);
    if (i?.kind === "window" && !i.gone_at) n.windows.push(i);
    if (i && (i.kind === "session" || i.kind === "thread") && i.title) n.convos.push(i);   // 들여온 대화 — 노드 채팅에 글로(convoMsg)
    const w = i ? i.win : item.startsWith("win:") ? item.slice(4) : null; if (w) n.wins.add(w);
  }
  const mains = new Map((nd.results as R[]).map(n => [String(n.id), json<{ main?: string }>(n.counts, {}).main || ""]));
  for (const n of nodes) { const m = mains.get(n.id); if (m) n.windows.sort((a, b) => Number(b.key === m) - Number(a.key === m)); }
  const nodeOfWin = (win: string) => { if (isPrimWin(win)) return null; const k = keyOfWin.get(win) || win, item = itemOfWin.get(k) || `win:${k}`; return byId.get(nodeOfItem.get(item) || "") || null; };
  // 엔진 창(역할 · 메인): 노드에 안 묶인 역할 창은 제 이름으로 한 노드
  const mainWin = (ew.results as R[]).find(w => w.kind === "main" && !["closed", "failed", "gone"].includes(w.state)) || null;
  const engineNodes = (ew.results as R[]).filter(w => w.kind === "role" && !nodes.some(n => n.name === w.name || n.wins.has(w.name)));
  const onlyPrim = (id: string) => { let p = 0, o = 0; for (const [k, v] of nodeOfItem) if (v === id) primKeys.has(k) ? p++ : o++; return p > 0 && o === 0; };
  const shown = primary ? nodes.filter(n => !onlyPrim(n.id)) : nodes;
  const primaryWin = String((pw.results[0] as R | undefined)?.v || ""), defaultNode = primaryWin ? byId.get(nodeOfItem.get(primaryWin) || "") || nodes.find(n => n.windows.some(w => w.key === primaryWin)) || null : null;
  return { defaultNode, primaryWin, nodes: shown, byId, primary, isPrimWin, mains, agentUnit: /"unit":"agent"/.test(String((ns.results[0] as R | undefined)?.data || "")), pri: (json<{ pri?: Record<string, { pri?: string }> }>((ns.results[0] as R | undefined)?.data, {}).pri || {}) as Record<string, { pri?: string }>, nodeOfWin, logs: lg.results as R[], cards: cd.results as R[], drafts: dr.results as R[], mainWin, engineNodes,
    faces: facesOf((ns.results[0] as R | undefined)?.data), botFace: faceRow((mb.results as R[]).find(r => r.owner === me)), meFace: faceRow((mb.results as R[]).find(r => r.owner === meKey(me))) };
}

// 채널(pane)마다 에이전트 글 — 모아 보기 읽지 않음 · 저장(member-inbox.ts)이 씀. 채널 = 노드 + 노드에 안 묶인 역할 창(메인 봇은 따로), 이름은 틀 노드 채팅 열쇠(「n:<이름>」)와 같음.
// 글은 load 가 읽는 최근 600줄 안에서만. paneOfLog: 글 한 줄(win · thread) → 그 채널 pane(못 찾으면 null)
export async function paneLogs(db: D1Database, me: string) {
  const L = await load(db, me);
  const agent = (r: R) => r.kind !== "me" && r.win !== ME && !OWN.test(r.win);
  const chans = [
    ...L.nodes.map(n => ({ pane: n.pane, name: n.name, rows: L.logs.filter(r => !inPrim(r) && agent(r) && L.nodeOfWin(r.win) === n) })),
    ...L.engineNodes.map(w => ({ pane: paneOfId(w.id), name: String(w.name), rows: L.logs.filter(r => !inPrim(r) && agent(r) && r.win === w.name) })),
  ];
  const engineOf = new Map(L.engineNodes.map(w => [String(w.name), paneOfId(w.id)]));
  const paneOfLog = (r: { win: string; kind?: string; thread?: string | null }) => inPrim(r) || (r.kind !== "me" && L.isPrimWin(String(r.win))) ? PRIMARY   // 있던 primary 창의 보고 줄 = 메인 봇 판(data() %1 과 같게)
    : L.nodeOfWin(r.win)?.pane || engineOf.get(r.win) || (r.kind === "me" ? L.nodes.find(n => n.name === r.win)?.pane : null) || null;   // 내 글(kind me)은 win 이 노드 이름
  return { chans, paneOfLog };
}
// 글 반응(member_react): 그 글들에 단 이모지 — 회원 혼자 보는 보드라 「누가」는 늘 나. 틀 꼴 { name(Slack 이름), count, mine }
async function withReacts(db: D1Database, me: string, out: R[]) {
  const lids = out.map(m => m.lid).filter((x): x is number => !!x);
  if (!lids.length) return out;
  const rs = (await db.prepare("SELECT log_id, emoji FROM member_react WHERE owner = ? AND log_id IN (SELECT value FROM json_each(?))").bind(me, JSON.stringify(lids)).all<{ log_id: number; emoji: string }>().catch(() => ({ results: [] as { log_id: number; emoji: string }[] }))).results;
  const by = new Map<number, string[]>(); for (const r of rs) (by.get(r.log_id) || by.set(r.log_id, []).get(r.log_id)!).push(r.emoji);
  for (const m of out) if (m.lid && by.has(m.lid)) m.reactions = by.get(m.lid)!.map(name => ({ name, count: 1, mine: true }));
  return out;
}

const STATE: Record<string, string> = { working: "일하는 중", busy: "일하는 중", starting: "일하는 중", opening: "일하는 중", background: "뒤 작업 중" };

const PSTATE: Record<string, string> = { working: "일하는 중", question: "질문" };
export async function data(db: D1Database, me: string, bot: { name?: string } | null) {
  const L = await load(db, me), now = Date.now(), ago = (ms: number) => Math.max(0, Math.round((now - ms) / 60_000));
  const line = (r: R) => ({ id: r.id, ago: ago(r.at), kind: KIND_KO[r.kind] || r.kind, msg: cut(r.text, 220), handled: false, short: cut(r.text, 60), short_ok: true, title: cut(r.text, 30) });
  const logsOf = (n: Node | null, wins?: string[]) => L.logs.filter(r => !inPrim(r) && r.kind !== "me" && !OWN.test(r.win) && (n ? L.nodeOfWin(r.win) === n : wins!.includes(r.win)));
  const pane = (o: { pane: string; win: string; kind: string; state: string; cwd?: string; branch?: string; rows: R[]; blockedOwner?: boolean }) => {
    const last = o.rows[0] ? line(o.rows[0]) : null, blk = last && last.kind === "막힘" ? last : null;
    return { win: o.win, area: "primary", role: "리드", pane: o.pane, acct: "", state: o.state, dur: "", stuck: "", cwd: o.cwd || "", branch: o.branch || "", kind: o.kind, last, blocked: blk,
      recent: o.rows.slice(0, 5).reverse().map(r => ({ ago: ago(r.at), kind: KIND_KO[r.kind] || r.kind, msg: cut(r.text, 260) })),
      hist: o.rows.filter(r => now - r.at < 86_400_000).reverse().map(r => ({ m: ago(r.at), k: KIND_KO[r.kind] || r.kind })), topics: [], pri: priOf(L.pri, o.win), owner: !!blk, watch: "" };
  };
  const mainName = bot?.name || "Primary";
  // 메인 봇 판: 엔진 메인 창이 있으면 그 상태, 없으면 있던 primary 창(들여온 것)의 상태 · 폴더 — 그 창이 보드에 올린 보고 줄도 봇 줄로
  const P = L.primary;
  const panes: R[] = [pane({ pane: PRIMARY, win: mainName, kind: "primary", state: STATE[L.mainWin?.state] || (P && PSTATE[P.state]) || "쉼", cwd: L.mainWin ? "" : P?.cwd, branch: L.mainWin ? "" : P?.branch,
    rows: L.logs.filter(r => inPrim(r) ? r.win !== ME && r.win !== "보더" : r.kind !== "me" && L.isPrimWin(String(r.win))) })];
  const botFace = cleanFace(bot) || L.botFace || faceOf(mainName);
  panes[0].avatar = botFace;
  const nodeOfPane = new Map<string, string>();
  const parked: R[] = [], closed: R[] = [];
  for (const n of L.nodes) {
    const rows = logsOf(n), w0 = n.windows[0];
    if (n.archived_at || n.state === "done") { closed.push({ pane: n.pane, win: n.name, ago: ago(n.archived_at || n.updated_at), msg: rows[0] ? cut(rows[0].text, 200) : n.why, area: "primary" }); continue; }
    if (n.state === "parked") { parked.push({ id: "c" + n.pane.slice(1), name: n.name, area: "primary", msg: n.why || "주차", owner: false, ago: ago(n.updated_at), stale: null, wait: n.why || "주차", topics: [], pri: priOf(L.pri, n.name), pane: n.pane, short: n.why || "주차", watch: "" }); continue; }
    panes.push(pane({ pane: n.pane, win: n.name, kind: "lead", state: STATE[n.state] || (n.state === "turn" ? "질문" : "쉼"), cwd: w0?.cwd, branch: w0?.branch, rows }));
    nodeOfPane.set(n.pane, n.id);
  }
  for (const w of L.engineNodes) {
    const rows = logsOf(null, [w.name]), p = paneOfId(w.id);
    if (w.state === "parked") parked.push({ id: "c" + p.slice(1), name: w.name, area: "primary", msg: w.note || "주차", owner: false, ago: ago(w.state_at || w.created_at), stale: null, wait: "주차", topics: [], pri: priOf(L.pri, String(w.name)), pane: p, short: "주차", watch: "" });
    else if (["closed", "failed", "gone"].includes(w.state)) closed.push({ pane: p, win: w.name, ago: ago(w.closed_at || w.state_at || w.created_at), msg: w.note || "", area: "primary" });
    else { panes.push(pane({ pane: p, win: w.name, kind: "lead", state: STATE[w.state] || "쉼", rows })); nodeOfPane.set(p, String(w.id)); }
  }
  for (const p of panes) { const f = L.faces[nodeOfPane.get(p.pane) || ""]; if (f) p.avatar = f; }
  const areas: R[] = [{ key: "primary", name: "Primary", lead: PRIMARY, avatar: botFace }];
  {
    const areaOf = new Map(L.nodes.map(n => [n.pane, n.area && n.area !== "기타" ? n.area : ""]));
    const groups = new Map<string, R[]>();
    for (const p of panes) if (p.kind === "lead") { const a = areaOf.get(p.pane) ?? ""; (groups.get(a) || groups.set(a, []).get(a)!).push(p); }
    const named = [...groups.keys()].filter(a => a);
    if (named.length >= 2 || (named.length === 1 && groups.has(""))) {
      const order = named.sort((a, b) => groups.get(b)!.length - groups.get(a)!.length || a.localeCompare(b));
      if (groups.has("")) order.push("");
      const HEAD = /팀장|리드|총괄|lead/i, BUSY = new Set(["일하는 중", "질문", "뒤 작업 중"]);
      order.forEach((a, i) => {
        const ps = groups.get(a)!, key = "m" + i;
        const head = ps.find(p => HEAD.test(String(p.win))) || ps.find(p => BUSY.has(String(p.state))) || ps[0];
        for (const p of ps) p.area = key;
        // 열 머리 얼굴 = 머리 노드에 고른 얼굴, 없으면 열 이름에서 정한 얼굴(같은 이름 → 같은 얼굴) — 머리 판에도 같은 값
        const avatar = L.faces[nodeOfPane.get(head.pane) || ""] || faceOf(a || "기타");
        head.avatar = avatar;
        areas.push({ key, name: a || "기타", lead: head.pane, lead_name: head.win, avatar });
      });
    }
  }
  const known = new Set(panes.map(p => p.pane)), dp = L.defaultNode?.pane || (/^ew_/.test(L.primaryWin) ? paneOfId(L.primaryWin) : ""), dflt = dp && known.has(dp) ? dp : PRIMARY,
    toPane = (win: string) => { const n = L.nodeOfWin(win); return n && known.has(n.pane) ? n.pane : dflt; };
  const decisions: R[] = [], cardlist: R[] = [];
  const todos: R[] = [];
  for (const c of L.cards) {
    const id = "w" + c.n, ch = json<string[]>(c.choices, []).map(x => cut(x, 90));
    if (c.kind === "todo") { if (c.state === "open") todos.push({ ts: String(c.id), id: String(c.id), area: "primary", title: cut(c.question, 200), body: cut(c.body || "", 600), due: "", win: c.win, pane: toPane(c.win), ago: ago(c.at) }); continue; }
    const snoozed = Number(c.snooze_until || 0) > now;
    if (c.state === "open" && !snoozed) decisions.push({ id, src: "wlog", pane: toPane(c.win), win: c.win, area: "primary", title: cut(c.question, 200), body: cut(c.body || "", 600), choices: c.recommend && ch.includes(c.recommend) ? [c.recommend, ...ch.filter(x => x !== c.recommend)] : ch, ago: ago(c.at), kind: "결정" });
    cardlist.push({ ts: CARD_TS.test(String(c.id)) ? c.id : "w:" + c.n, ref: "w:" + c.n, thread: null, channel: "primary", kind: "decision", area: "primary", state: c.state === "open" ? "open" : "answered", title: cut(c.question, 80), at: c.at / 1000 });
  }
  for (const d of L.drafts) {
    const n = 1_000_000_000 + d.n;
    decisions.push({ id: "w" + n, src: "wlog", pane: PRIMARY, win: mainName, area: "primary", title: `「${cut(d.name, 40)}」 역할 창을 열까요?`, body: cut(d.brief || "", 600), choices: ["이대로 열기", "버리기"], ago: ago(d.at), kind: "결정" });
    cardlist.push({ ts: "w:" + n, ref: "w:" + n, thread: null, channel: "primary", kind: "decision", area: "primary", state: "open", title: `「${cut(d.name, 40)}」 역할 창`, at: d.at / 1000 });
  }
  cardlist.sort((a, b) => a.at - b.at);
  const feed = L.logs.filter(r => !OWN.test(r.win) && !inPrim(r) && r.kind !== "me").slice(0, 40).map(r => ({ id: r.id, ago: ago(r.at), pane: L.nodeOfWin(r.win)?.pane || PRIMARY, win: cut(r.win, 30), kind: KIND_KO[r.kind] || r.kind, msg: cut(r.text, 160) }));
  // 보관한 노드 이름(주인 D.archived 와 같은 꼴) — 찾기 · 타임라인 · 「보관」 띠가 씀
  const archived = ((await db.prepare("SELECT COALESCE(pinned_name, name) AS n FROM mnode WHERE owner = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT 300").bind(me).all<R>()).results).map(r => String(r.n || "노드"));
  // 약속(member_promise, 0047): 열린 것 = 주인 D.promises 꼴, 기한이 지난 것은 to_check(「지켰는지 확인」) — 표가 아직 없으면(이주 전) 빈 꼴
  const promPane = (w: string) => { const ew = L.engineNodes.find(x => x.name === w), p = ew ? paneOfId(ew.id) : ""; return p && known.has(p) ? p : toPane(w); };
  const { promises, to_check } = await promiseRows(db, me, promPane, now);
  return { generated: kst(now), areas, panes, closed, parked, archived, decisions, to_check, promises, feed,
    park_metrics: { at: Math.floor(now / 1000), open: panes.length, due: 0, overdue: 0, overdue_names: [], parked: parked.length, reopen_ok_24h: 0, reopen_fail_24h: 0, overdue_max_24h: 0 },
    cards: [], cardlist, attn: null, relinks: {}, todos, bthreads: [], me_avatar: L.meFace || faceOf(String(me).toLowerCase()) };
}

function msg(r: R, my: string, mainName: string) {
  const mine = r.win === ME || r.kind === "me";   // me = 노드 채팅에서 내가 그 창에 넣은 글
  return { ts: tsOf(r.at, r.id), lid: Number(r.id) || 0, thread: null, who: mine ? "owner" : "agent", name: mine ? my : r.win === "보더" ? "보더" : mainName, board: false, text: String(r.text || ""), buttons: [], files: [], replies: 0, latest: null, rnames: [], reactions: [], owner: null, ...(mine ? { src: String(r.text || "") } : {}) };
}
export const CARD_TS = /^\d{10}\.\d{6}$/;
export const TODO_DONE = "했어요";
export function nextMorning(now: number) {
  const k = now + 9 * 3600_000, day = Math.floor(k / 86_400_000) * 86_400_000, eight = day + 8 * 3600_000;
  return (k < eight ? eight : eight + 86_400_000) - 9 * 3600_000;
}
const replyTs = (c: R) => tsOf(Number(c.answered_at || c.at), Number(c.n));
function cardMsg(c: R, said: R[] = [], my = ME) {   // said = 에이전트가 그 카드 스레드에 쓴 줄(boarder say · log)
  const buttons = [...json<string[]>(c.choices, []).map(label => ({ label })), ...(OWN.test(String(c.win)) ? [] : [{ label: "기타", other: true }])];   // 들여오기 질문은 고르기만
  const last = said.reduce((a, r) => Math.max(a, Number(r.at)), 0), ans = c.answer ? Number(c.answered_at || c.at) : 0;
  const latest = !said.length && !ans ? null : ans >= last ? replyTs(c) : tsOf(last, Number(said.find(r => Number(r.at) === last)!.id));
  return { ts: String(c.id), thread: null, who: "agent", name: String(c.win), board: false, text: [c.question, c.body].filter(Boolean).join("\n\n"), buttons, files: [], replies: said.length + (c.answer ? 1 : 0), latest, rnames: c.answer ? [my] : [], reactions: [], owner: null, ...(c.state !== "open" ? { picked: String(c.answer || "·") } : {}) };
}
const cardReply = (c: R, my = ME) => ({ ts: replyTs(c), thread: String(c.id), who: "owner", name: my, board: false, text: String(c.answer || ""), src: String(c.answer || ""), buttons: [], files: [], replies: 0, latest: null, rnames: [], reactions: [], owner: null });
export async function pushLoc(db: D1Database, me: string, ts: string) {
  const w = /^w:(\d{1,12})$/.exec(ts);
  const r = await (w ? db.prepare("SELECT id, state FROM board_card WHERE rowid = ? AND owner = ?").bind(Number(w[1]), me) : db.prepare("SELECT id, state FROM board_card WHERE id = ? AND owner = ?").bind(ts, me)).first<{ id: string; state: string }>().catch(() => null);
  const id = r ? String(r.id) : ts;
  return { ts: id, loc: r ? { c: "primary", t: id, m: id, state: r.state } : null };
}
export async function channelOf(db: D1Database, me: string, win: string) {
  const L = await load(db, me);
  return L.nodeOfWin(win)?.name || L.engineNodes.find(w => w.name === win)?.name || L.nodes.find(n => n.name === win)?.name || win;
}
export async function nodeRoot(db: D1Database, me: string, ts: string) {
  const m = /^(\d{10})\.(\d{6})$/.exec(ts); if (!m) return null;
  const r = await db.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND id % 1000000 = ? AND at >= ? AND at < ? LIMIT 1").bind(me, Number(m[2]), Number(m[1]) * 1000, Number(m[1]) * 1000 + 1000).first<R>();
  return r && !r.thread && !OWN.test(String(r.win)) ? r : null;
}
/** Primary 채팅의 사람 글 하나(스레드 뿌리) — 내가 Primary 에 쓴 줄(win 나 · thread primary)만. 봇 · 보더 글 · 스레드 답 줄 · 남의 줄은 null */
export async function primaryRoot(db: D1Database, me: string, ts: string) {
  const m = /^(\d{10})\.(\d{6})$/.exec(String(ts || "")); if (!m) return null;
  return db.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND thread = 'primary' AND win = ? AND id % 1000000 = ? AND at >= ? AND at < ? LIMIT 1").bind(me, ME, Number(m[2]), Number(m[1]) * 1000, Number(m[1]) * 1000 + 1000).first<R>();
}
/** 방금 Primary(또는 그 글 스레드)에 쓴 내 글의 ts — /api/me/chat 이 창에 넘기는 머리 줄 「스레드 <ts>」에 씀(글 줄은 rid batch 로 들어가 id 를 못 받음) */
export async function myPrimaryTs(db: D1Database, me: string, text: string, thread?: string) {
  const r = await db.prepare("SELECT id, at FROM board_log WHERE owner = ? AND win = ? AND thread = ? AND text = ? ORDER BY at DESC, id DESC LIMIT 1").bind(me, ME, thread ? primaryThread(thread) : "primary", text).first<R>();
  return r ? tsOf(Number(r.at), Number(r.id)) : null;
}
async function primaryReplies(db: D1Database, me: string, roots: string[]) {
  const by = new Map<string, R[]>(); if (!roots.length) return by;
  const rs = (await db.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND thread IN (SELECT value FROM json_each(?)) ORDER BY at, id LIMIT 2000").bind(me, JSON.stringify(roots.map(primaryThread))).all<R>()).results;
  for (const r of rs) { const k = String(r.thread).slice(2); (by.get(k) || by.set(k, []).get(k)!).push(r); }
  return by;
}
function withPrimaryThread(m: R, said: R[] | undefined, mainName: string, my = ME) {
  if (!said?.length) return m;
  const last = said.at(-1)!;
  return { ...m, replies: said.length, latest: tsOf(Number(last.at), Number(last.id)), rnames: [...new Set(said.map(r => r.win === ME ? my : r.win === "보더" ? "보더" : mainName))] };
}
// 노드 스레드 답(사람 글 · boarder say): thread = 뿌리 글 ts. 뿌리 글에 답 수 · 마지막 답 ts 를 달고, 답 줄은 스레드로
const threadReplies = (logs: R[], ts: string) => logs.filter(r => r.thread === ts).sort((a, b) => Number(a.at) - Number(b.at) || Number(a.id) - Number(b.id));
function withThread(m: R, said: R[], my = ME) {
  if (!said.length) return m;
  const last = said.at(-1)!;
  return { ...m, replies: said.length, latest: tsOf(Number(last.at), Number(last.id)), rnames: [...new Set(said.map(r => r.kind === "me" ? my : String(r.win)))] };
}
const cardBy = (db: D1Database, me: string, ts: string) => db.prepare("SELECT rowid AS n, id, win, kind, question, choices, recommend, body, state, answer, answered_at, at FROM board_card WHERE id = ? AND owner = ?").bind(ts, me).first<R>();

// 들여온 대화 한 줄 → 노드 채팅 글. 세션 = 그 사람이 처음 물은 한 줄(들여오기가 보낸 것만 — 대화 내용은 안 옴), 스레드 · 이슈 = 제목.
// 어디서 왔는지는 노드 채널 옮긴 글과 같은 「↪ #… 에서 옮겨 옴」(moved) 줄로
const ORIGIN: Record<string, string> = { claude: "Claude Code", codex: "Codex", slack: "Slack", gh: "GitHub", linear: "Linear" };
const convoAt = (i: R) => Number(i.state_at || i.seen_at || 0);
export function convoMsg(i: R, mainName: string, my = ME) {
  const ref = String(json<string[]>(i.refs, [])[0] || ""), src = i.kind === "session" ? String(i.engine || "claude") : ref.split(":")[0];
  let h = 0; for (const ch of String(i.key)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const at = convoAt(i), mine = i.kind === "session";
  return { ...msg({ id: h, win: mine ? ME : "보더", kind: mine ? "me" : "chat", text: String(i.title), at }, my, mainName), lid: 0, ch: "primary", moved: { chan: ORIGIN[src] || src || "들여오기", at: at / 1000 } };
}
const FOLD_TS = /^\d{10}\.99\d{4}$/;
export function convoFold(n: Node, mainName: string, my = ME) {
  if (!n.convos.length) return null;
  const list = [...n.convos].sort((a, b) => convoAt(a) - convoAt(b));
  let h = 0; for (const ch of String(n.id)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const at0 = convoAt(list[0]) || Number(n.updated_at) || 0;   // 시각 없는 대화만이면 노드 시각
  const ts = `${String(Math.floor(at0 / 1000)).padStart(10, "0")}.${990000 + (h % 10000)}`;
  const sessions = list.filter(i => i.kind === "session").length, threads = list.length - sessions;
  const replies = list.map(i => ({ ...convoMsg(i, mainName, my), thread: ts }));
  const text = [sessions ? `지난 대화 ${sessions}` : "", threads ? `스레드 ${threads}` : ""].filter(Boolean).join(" · ") + " — 들여온 것이에요. 눌러서 펼쳐 봐요";
  const root = { ...msg({ id: 0, win: "보더", kind: "chat", text, at: at0 }, my, mainName), ts, lid: 0, ch: "primary", replies: replies.length, latest: replies.at(-1)!.ts, rnames: [], fold: { sessions, threads } };
  return { root, replies };
}
async function nodeThread(db: D1Database, me: string, raw: string, ts: string, my = ME) {
  const t = raw.replace(/^\d+\s+/, "").trim(), L = await load(db, me);
  const n = L.nodes.find(x => x.name === raw) || L.nodes.find(x => x.name === t), ew = L.engineNodes.find(x => x.name === raw || x.name === t);
  if (!n && !ew) return null;
  const home = n ? n.name : String(ew!.name), ch = "n:" + raw;
  const mineWin = (win: string, kind?: string) => n ? L.nodeOfWin(win) === n || (kind === "me" && win === n.name) : win === ew!.name;
  const card = await cardBy(db, me, ts);
  if (card) {
    if (!mineWin(String(card.win))) return null;
    const said = (await db.prepare("SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = ? ORDER BY at, id LIMIT 200").bind(me, ts).all<R>()).results;
    const replies = [...said.map(r => ({ at: Number(r.at), m: { ...msg(r, my, String(r.win)), thread: ts } })), ...(card.answer ? [{ at: Number(card.answered_at || card.at), m: cardReply(card, my) }] : [])].sort((a, b) => a.at - b.at).map(x => ({ ...x.m, ch }));
    return { channel: ch, root: ts, owner: null, home, messages: [{ ...cardMsg(card, said, my), ch }, ...replies] };
  }
  const [s, id] = ts.split(".");
  const r = await db.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND id % 1000000 = ? AND at >= ? AND at < ? LIMIT 1").bind(me, Number(id), Number(s) * 1000, Number(s) * 1000 + 1000).first<R>();
  if (!r || inPrim(r) || CARD_TS.test(String(r.thread || "")) || OWN.test(String(r.win)) || !mineWin(String(r.win), String(r.kind))) return null;
  const said = (await db.prepare("SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = ? ORDER BY at, id LIMIT 200").bind(me, ts).all<R>()).results;
  return { channel: ch, root: ts, owner: null, home, messages: [{ ...withThread(msg(r, my, String(r.win)), said, my), ch }, ...said.map(x => ({ ...msg(x, my, String(x.win)), thread: ts, ch }))] };
}
async function primaryRows(db: D1Database, me: string, before?: string) {
  const m = before ? /^(\d{10})\.(\d{6})$/.exec(before) : null, sec = m ? Number(m[1]) * 1000 : 0;
  return (await db.prepare(`SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = 'primary'${m ? " AND (at < ? OR (at < ? AND id % 1000000 < ?))" : ""} ORDER BY at DESC, id DESC LIMIT 101`)
    .bind(me, ...(m ? [sec, sec + 1000, Number(m[2])] : [])).all<R>()).results;
}

export async function paneRows(db: D1Database, me: string, pane: string) {
  const L = await load(db, me), mine = (r: R) => r.kind !== "me" && !OWN.test(r.win);
  const n = L.nodes.find(x => x.pane === pane), ew = n ? null : L.engineNodes.find(x => paneOfId(x.id) === pane);
  const rows = pane === PRIMARY ? L.logs.filter(r => inPrim(r) ? r.win !== ME && r.win !== "보더" : r.kind !== "me" && L.isPrimWin(String(r.win)))
    : n ? L.logs.filter(r => !inPrim(r) && mine(r) && L.nodeOfWin(r.win) === n)
    : ew ? L.logs.filter(r => !inPrim(r) && mine(r) && r.win === ew.name) : [];
  return rows.slice(0, 60).reverse().map(r => ({ id: r.id, at: Number(r.at) / 1000, kind: KIND_KO[r.kind] || r.kind, msg: cut(r.text, 400) }));
}

export async function sessTarget(db: D1Database, me: string, pane: string) {
  if (!/^%\d{1,12}$/.test(pane)) return null;
  const L = await load(db, me);
  if (pane === PRIMARY) return { L, pane, kind: "main" as const, name: L.mainWin ? String(L.mainWin.name) : "", state: L.mainWin ? String(L.mainWin.state) : "" };
  const n = L.nodes.find(x => x.pane === pane);
  if (n) return { L, pane, kind: "node" as const, name: n.name, state: String(n.state || ""), node: n };
  const ew = L.engineNodes.find(x => paneOfId(x.id) === pane);
  if (ew) return { L, pane, kind: "engine" as const, name: String(ew.name), state: String(ew.state || ""), ew };
  return null;
}
// 세션 로그(GET /api/sesslog?pane=) — 그 판의 글(사람 · 에이전트)을 오래된 것부터, 채팅 글 꼴(msg) 그대로. 최근 200줄
export async function sessLog(db: D1Database, me: string, pane: string, mainName: string, my = ME) {
  const s = await sessTarget(db, me, pane); if (!s) return null;
  const L = s.L, inCard = (r: R) => CARD_TS.test(String(r.thread || ""));
  const rows = s.kind === "main" ? (await primaryRows(db, me)).filter(r => r.win !== "보더")
    : L.logs.filter(r => !inPrim(r) && !inCard(r) && !OWN.test(r.win) && (s.kind === "node" ? L.nodeOfWin(r.win) === s.node || (r.kind === "me" && r.win === s.node!.name) : r.win === s.ew!.name));
  const messages = rows.slice(0, 200).map(r => msg(r, my, s.kind === "main" ? mainName : String(r.win))).reverse();
  return { pane, name: s.kind === "main" ? (s.name || mainName) : s.name, state: s.state, messages };
}
export async function sessFolders(db: D1Database, me: string) {
  const rs = (await db.prepare("SELECT cwd, MAX(COALESCE(state_at, seen_at, 0)) at FROM imp_item WHERE owner = ? AND cwd != '' AND (gone_at IS NULL OR gone_at > ?) GROUP BY cwd ORDER BY at DESC LIMIT 40").bind(me, Date.now() - 30 * 86_400_000).all<{ cwd: string }>()).results;
  return rs.map(r => String(r.cwd)).filter(c => c.length <= 200 && !/[\x00-\x1f\x7f]/.test(c) && !c.split("/").includes("..")).map(path => ({ path, title: path.replace(/\/+$/, "").split("/").pop() || path }));
}
export async function folderOk(db: D1Database, me: string, folder: string) {
  return (await sessFolders(db, me)).some(f => f.path === folder);
}

// 회원 GET — 보드 화면 길만. null = 이 길은 회원 보드 것이 아님(→ 403)
export async function etag(b: string) { return '"m' + [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(b)))].slice(0, 8).map(x => x.toString(16).padStart(2, "0")).join("") + '"'; }
export async function get(db: D1Database, me: string, bot: { name?: string } | null, url: URL, emoji: () => Promise<{ body: string; etag: string } | null>, inm?: string, who?: string | null | (() => Promise<string | null | undefined>)): Promise<Response | null> {
  // 내 이름(who): 글 이름이 나가는 채팅 길에서만 읽음 — 함수면 그때 한 번(index.ts 는 user 표를 읽는 함수로 넘김, /api/data 폴링엔 안 읽음)
  const p = url.pathname, mainName = bot?.name || "Primary", my = myName(me, typeof who === "function" ? (/^\/api\/(chat\/|nodechat$|sesslog$)/.test(p) ? await who().catch(() => null) : null) : who);
  const j = (o: unknown, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-boarder-src": "member" } });
  if (p === "/api/data") {   // 보드처럼 ETag — 안 바뀌면 빈 304(20초 폴링)
    const b = JSON.stringify(await data(db, me, bot)), t = await etag(b), h = { etag: t, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-boarder-src": "member" };
    return inm === t ? new Response(null, { status: 304, headers: h }) : new Response(b, { headers: { ...h, "content-type": "application/json; charset=utf-8" } });
  }
  if (p === "/api/topics") return j(await topics(db, me, bot));   // 노드 주제 칩 · 찾기 「노드」(member-views.ts — 주인 topics.py 꼴)
  if (p === "/api/history") return j(await history(db, me, url.searchParams.get("since")));   // 타임라인 지난 판(주인 history.py 꼴)
  if (p === "/api/inbox") return j({ unread: [], drafts: [], saved: [], saved_ids: [] });
  if (p === "/api/arts") return j({});
  if (/^\/api\/artnotes\/[A-Za-z0-9]{16,40}$/.test(p)) return j({ notes: [] });
  if (p === "/api/emoji/frequent") {   // 내가 자주 단 반응 먼저(주인 owner-read 와 같은 꼴), 모자라면 기본 순서로 채움
    const mine = ((await db.prepare("SELECT emoji, count(*) AS n FROM member_react WHERE owner = ? GROUP BY emoji ORDER BY n DESC, max(at) DESC LIMIT 18").bind(me).all<R>()).results).map(r => String(r.emoji));
    return j({ names: [...new Set([...mine, ...FREQ])].slice(0, Math.max(FREQ.length, mine.length)) });
  }
  if (p === "/api/drafts") return j({});
  if (p === "/api/push/key") return j({ key: "" });   // 빈 키 = 화면이 푸시를 조용히 끔(회원 푸시 길 없음)
  if (p === "/api/voice/modes") return j({});
  let pm = /^\/api\/pane\/(.{1,40})$/.exec(p);
  if (pm) {
    let pk = pm[1]; try { pk = decodeURIComponent(pk); } catch {}
    return j({ rows: await paneRows(db, me, pk) });
  }
  let dp = p; try { dp = decodeURIComponent(p); } catch {}
  pm = /^\/api\/push\/resolve\/([\w:.-]{1,80})$/.exec(dp);
  if (pm) return j(await pushLoc(db, me, pm[1]));   // 알림을 누른 카드 → 글 자리(회원 푸시가 꺼져 있어도 — 켜진 때는 index.ts memberPushRoute 가 먼저 받음)
  if (/^\/api\/artowner\/[A-Za-z0-9]{16,40}$/.test(p)) return j({});
  if (/^\/api\/file\/[\w.-]{1,80}$/.test(p)) return j({ error: "없는 파일" }, 404);   // 회원 글엔 아직 첨부가 없음 — 403 대신 「없음」
  if (/^\/api\/permalink\//.test(p)) return j({ error: "회원 글엔 바깥 주소가 없어요" }, 404);
  if (/^\/api\/answer\/[\w-]{1,64}$/.test(p)) return j({ ok: true, state: "ok" });   // 회원 쓰기는 바로 끝나서 기다릴 일 없음
  if (p === "/emoji.json") { const e = await emoji(); return e ? new Response(e.body, { headers: { "content-type": "application/json; charset=utf-8", etag: e.etag } }) : j({ cats: [], e: {} }); }
  const nm = /^\/api\/chat\/n:([^/]{1,120})\/(\d{10}\.\d{6})$/.exec(dp);
  if (nm) return j(await nodeThread(db, me, nm[1], nm[2], my) ?? { channel: "n:" + nm[1], root: nm[2], owner: null, messages: [] });
  let m = /^\/api\/chat\/(\w+)(?:\/(\d{10}\.\d{6}))?$/.exec(p);
  if (m) {
    if (m[1] !== "primary") return j({ channel: m[1], messages: [], more: false, cursor: null, read_at: Math.floor(Date.now() / 1000), stale_min: 0 });
    if (m[2]) {
      if (FOLD_TS.test(m[2])) {
        const L = await load(db, me), f = L.nodes.map(n => convoFold(n, mainName, my)).find(x => x?.root.ts === m![2]);
        if (f) return j({ channel: "primary", root: m[2], owner: null, messages: [f.root, ...f.replies] });
      }
      const card = await cardBy(db, me, m[2]);
      if (card) {
        const said = (await db.prepare("SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = ? ORDER BY at, id LIMIT 200").bind(me, m[2]).all<R>()).results;
        const replies = [...said.map(r => ({ at: Number(r.at), m: { ...msg(r, my, String(r.win)), thread: m![2] } })), ...(card.answer ? [{ at: Number(card.answered_at || card.at), m: cardReply(card, my) }] : [])].sort((a, b) => a.at - b.at).map(x => ({ ...x.m, ch: "primary" }));
        return j({ channel: "primary", root: m[2], owner: null, messages: [{ ...cardMsg(card, said, my), ch: "primary" }, ...replies] });
      }
      const pr = await primaryRoot(db, me, m[2]);
      if (pr) {
        const said = (await primaryReplies(db, me, [m[2]])).get(m[2]) || [];
        return j({ channel: "primary", root: m[2], owner: null, messages: [withPrimaryThread(msg(pr, my, mainName), said, mainName, my), ...said.map(r => ({ ...msg(r, my, mainName), thread: m![2] }))] });
      }
      const rows = await db.prepare("SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = 'primary' AND id % 1000000 = ? AND at >= ? AND at < ?").bind(me, Number(m[2].split(".")[1]), Number(m[2].split(".")[0]) * 1000, Number(m[2].split(".")[0]) * 1000 + 1000).all<R>();
      return j({ channel: "primary", root: m[2], owner: null, messages: rows.results.map(r => msg(r, my, mainName)) });
    }
    const rows = await primaryRows(db, me, url.searchParams.get("before") || undefined), page = rows.slice(0, 100);
    const th = await primaryReplies(db, me, page.filter(r => r.win === ME).map(r => tsOf(r.at, r.id)));   // 내 글마다 스레드 답 수 · 마지막 답
    const msgs = page.map(r => withPrimaryThread(msg(r, my, mainName), th.get(tsOf(r.at, r.id)), mainName, my)).reverse();
    await withReacts(db, me, msgs);
    return j({ channel: "primary", messages: msgs, more: rows.length > 100, cursor: msgs.length ? msgs[0].ts : null, read_at: Math.floor(Date.now() / 1000), stale_min: 0 });
  }
  if (p === "/api/nodechat") {
    const raw = String(url.searchParams.get("w") || "").trim(), t = raw.replace(/^\d+\s+/, "").trim();
    if (!t) return j({ error: "노드 이름" }, 400);
    const L = await load(db, me), n = L.nodes.find(x => x.name === raw) || L.nodes.find(x => x.name === t), ew = L.engineNodes.find(x => x.name === raw || x.name === t);
    const inCard = (r: R) => CARD_TS.test(String(r.thread || ""));
    const stuck = new Map(((await db.prepare("SELECT id, state, at FROM engine_cmd WHERE owner = ? AND verb IN ('send','reopen') AND state IN ('queued','taken','sending','failed')").bind(me).all<R>()).results).filter(c => c.state === "failed" || Date.now() - Number(c.at) > 60_000).map(c => ["cmd:" + c.id, true]));
    const rows = L.logs.filter(r => !inPrim(r) && !inCard(r) && !OWN.test(r.win) && (n ? L.nodeOfWin(r.win) === n || (r.kind === "me" && r.win === n.name) : ew ? r.win === ew.name : false)).slice(0, 300).reverse();
    // 카드 글은 답하거나 닫혀도 채널에 남음 — 할 일 목록(load)과 따로 읽음
    const cards = (await db.prepare("SELECT rowid AS n, id, win, question, choices, recommend, body, state, answer, answered_at, at FROM board_card WHERE owner = ? ORDER BY at DESC LIMIT 300").bind(me).all<R>()).results
      .filter(c => CARD_TS.test(String(c.id)) && (n ? L.nodeOfWin(String(c.win)) === n : ew ? c.win === ew.name : false));
    const out = [...rows.map(r => ({ at: Number(r.at), m: { ...withThread(msg(r, my, r.win), threadReplies(L.logs, tsOf(r.at, r.id)), my), ch: "primary", ...(stuck.has(String(r.wid)) ? { dlv: { ok: false, to: String(n?.windows.find(w => w.win === r.win)?.title || n?.name || ew?.name || r.win) } } : {}) } })),
      ...cards.map(c => ({ at: Number(c.at), m: { ...cardMsg(c, L.logs.filter(r => r.thread === c.id), my), ch: "primary" } }))]
      .sort((a, b) => a.at - b.at).slice(-300).map(x => x.m);
    const fold = n ? convoFold(n, mainName, my) : null;
    if (fold) out.unshift(fold.root);
    await withReacts(db, me, out as R[]);
    return j({ channel: "n:" + t, messages: out, stale_min: 0, more: false });
  }
  if (p === "/api/sesslog") { const s = await sessLog(db, me, url.searchParams.get("pane") || "", mainName, my); return s ? j(s) : j({ error: "없는 판" }, 404); }
  if (p === "/api/session/folders") return j({ folders: await sessFolders(db, me) });
  return null;
}

export type Hop = { path: string; body: unknown; log?: { win: string; text: string; thread?: string } } | { error: string; status: number } | { ok: R };
export async function post(db: D1Database, me: string, path: string, b: R): Promise<Hop> {
  if (path === "/api/sess/send") {
    const pane = String(b.pane || ""), text = String(b.text || "").trim();
    if (!text) return { error: "내용을 적어요", status: 400 };
    if (!(await sessTarget(db, me, pane))) return { error: "없는 판", status: 404 };
    return post(db, me, "/api/chat", { text, pane });
  }
  if (path === "/api/session/new") {
    const folder = String(b.folder || "");
    if (!(await folderOk(db, me, folder))) return { error: "없는 폴더", status: 404 };
    return { path: "/api/me/session/new", body: { folder, text: String(b.text || "").slice(0, 4000) } };
  }
  if (path === "/api/chat") {
    if (b.seen) return { ok: { ok: true, state: "ok", seen: false } };   // 읽음 표는 아직 없음(보드가 열 때마다 부름 — 오류로 띄우지 않음)
    // 카드 글의 단추 · 그 스레드에 쓴 글 = 카드 답
    const onCard = CARD_TS.test(String(b.thread || "")) ? await cardBy(db, me, String(b.thread)) : null;
    if (onCard && !b.react && b.edit === undefined && !b.delete && !(Array.isArray(b.files) && b.files.length)) {
      const said = String(b.label || b.text || "").trim();
      if (!said) return { error: "내용을 적어요", status: 400 };
      if (onCard.state !== "open" && String(onCard.answer || "") === said && (b.label || !b.rid)) return { ok: { ok: true, state: "ok" } };
      if (!b.label && (onCard.state !== "open" || onCard.kind === "todo")) return { path: `/api/me/cards/${onCard.id}/reply`, body: { text: said } };
      return onCard.state === "open" ? post(db, me, "/api/answer", { item: "w" + onCard.n, text: said }) : { error: onCard.state === "closed" ? "닫힌 결정이에요" : "이미 답한 결정이에요", status: 400 };   // 확정 실패 — 409 면 화면이 「올라갔나」를 확인하다 보낸 것으로 보고 글을 잃음
    }
    if (b.delete) {   // 내 글 지우기: 내가 쓴 줄만(ts = at 초 + id 뒤 여섯 자리)
      const [s, n] = String(b.ts || "").split(".");
      if (!/^\d{10}$/.test(s || "") || !/^\d{6}$/.test(n || "")) return { error: "요청 모양이 틀림", status: 400 };
      const r = await db.prepare("DELETE FROM board_log WHERE owner = ? AND id % 1000000 = ? AND at >= ? AND at < ? AND (kind = 'me' OR win = ?) RETURNING wid").bind(me, Number(n), Number(s) * 1000, (Number(s) + 1) * 1000, ME).all<R>();
      if (!r.results.length) return { error: "내 글이 아니에요", status: 404 };
      const cmd = /^cmd:(.+)$/.exec(String(r.results[0].wid || ""));
      if (cmd) await db.prepare("UPDATE engine_cmd SET state = 'failed', result = '글을 지움' WHERE id = ? AND owner = ? AND state = 'queued'").bind(cmd[1], me).run();   // 아직 안 넣은 글은 나중에 들어가지 않게
      return { ok: { ok: true, state: "ok" } };
    }
    if (b.react || b.edit !== undefined || b.label || (Array.isArray(b.files) && b.files.length)) return { error: "아직 안 돼요", status: 400 };
    const text = String(b.text || "").trim(); if (!text) return { error: "내용을 적어요", status: 400 };
    const bk = /^w:(\d+)$/.exec(String((b.blocker as R | undefined)?.ref || ""));
    if (bk) return post(db, me, "/api/answer", { item: "w" + bk[1], text });
    const pane = String(b.pane || "");
    if (pane && pane !== PRIMARY) {
      const L = await load(db, me), n = L.nodes.find(x => x.pane === pane);
      const root = CARD_TS.test(String(b.thread || "")) ? await nodeRoot(db, me, String(b.thread)) : null;
      const ew0 = n ? null : L.engineNodes.find(x => paneOfId(x.id) === pane);
      const chName = n ? n.name : ew0 ? String(ew0.name) : "";
      const inChan = (r: R) => n ? L.nodeOfWin(String(r.win)) === n || (r.kind === "me" && r.win === n.name) : ew0 ? r.win === ew0.name : false;
      const thread = root && inChan(root) ? String(b.thread) : undefined;
      if (b.thread && !thread && !FOLD_TS.test(String(b.thread))) return { error: "없는 스레드예요", status: 404 };   // 들여온 대화 접은 글 스레드는 예전처럼 채널로
      const head = boardHead({ channel: chName, thread });
      if (n) {
        // 에이전트마다 채널은 일 창이 여럿 — 주 창이 닫혔으면 아무 일 창에나 넣지 않음
        const w = L.agentUnit ? n.windows.find(x => x.key === L.mains.get(n.id)) : n.windows[0];
        if (!w) return { error: "이 노드엔 글을 넣을 창이 없어요", status: 404 };
        const log = { win: String(w.win || n.name), text, ...(thread ? { thread } : {}) };
        return { path: "/api/me/nodes/cmd", body: { verb: w.state === "parked" ? "reopen" : "send", item: w.key, text: withHead(head, text) }, log };
      }
      const ew = ew0;
      if (!ew) return { error: "없는 노드", status: 404 };
      return { path: `/api/me/windows/${ew.id}/say`, body: { text, head }, log: { win: String(ew.name), text, ...(thread ? { thread } : {}) } };
    }
    if (b.channel && b.channel !== "primary") return { error: "아직 안 돼요", status: 400 };
    if (b.thread && await primaryRoot(db, me, String(b.thread))) return { path: "/api/me/chat", body: { text, thread: String(b.thread) } };
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
    if (text === "(나중에)") {
      await db.prepare("UPDATE board_card SET snooze_until = ? WHERE rowid = ? AND owner = ? AND state = 'open'").bind(nextMorning(Date.now()), n, me).run();
      return { ok: { ok: true, state: "ok" } };
    }
    return { path: `/api/me/cards/${c.id}/answer`, body: { choice: text, free: true } };
  }
  if (path === "/api/clientlog") return { ok: { ok: true } };   // 화면 오류 기록(keepalive) — 회원은 PostHog 로만 남김(400 이 또 오류로 쌓이지 않게)
  if (path === "/api/todo") {   // 할 일 끝냄(틀 { area, id }) = 그 할 일 카드에 「했어요」로 답(카드를 낸 창에 넘어감 · 에이전트 wait 가 받음)
    const id = String(b.id || b.ts || "");
    const c = CARD_TS.test(id) ? await db.prepare("SELECT id, state FROM board_card WHERE id = ? AND owner = ? AND kind = 'todo'").bind(id, me).first<{ id: string; state: string }>() : null;
    if (!c) return { error: "없는 할 일이에요", status: 404 };
    if (c.state !== "open") return { ok: { ok: true, state: "ok" } };   // 이미 끝냄(다시 보낸 것)
    return { path: `/api/me/cards/${c.id}/answer`, body: { choice: TODO_DONE, free: true } };
  }
  if (path === "/api/nodepri") {
    const title = cut(String(b.title || "").replace(/^\d+\s+/, "").trim(), 80), pri = String(b.pri || "");
    if (!title || (pri && !NODE_PRI.includes(pri))) return { error: "노드 이름 · 단계", status: 400 };
    const patch = JSON.stringify({ [title]: pri ? { pri, at: Math.floor(Date.now() / 1000) } : null });   // json_patch: null 이면 그 칸 지움 — 이름에 따옴표가 있어도 안전
    await db.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?1, json_object('pri', json_patch('{}', json(?2))), ?3) ON CONFLICT(owner) DO UPDATE SET data = json_set(CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END, '$.pri', json_patch(CASE WHEN json_valid(data) AND json_type(data, '$.pri') = 'object' THEN json_extract(data, '$.pri') ELSE '{}' END, json(?2))), updated_at = ?3").bind(me, patch, Date.now()).run();
    return { ok: { ok: true, state: "ok", title, pri } };
  }
  if (path === "/api/nodereopen") {   // 닫힌 · 보관한 노드 「다시 열기」(틀 { name }) → 회원 보관함 다시 열기(/api/me/nodes/edit reopen)와 같은 길
    const t = String(b.name || "").replace(/^\d+\s+/, "").trim().slice(0, 80);
    const n = t ? await db.prepare("SELECT id FROM mnode WHERE owner = ? AND (pinned_name = ?2 OR (pinned_name IS NULL AND name = ?2)) AND (archived_at IS NOT NULL OR state = 'done') ORDER BY updated_at DESC LIMIT 1").bind(me, t).first<R>() : null;
    if (!n) return { error: "없는 노드예요", status: 404 };
    return { path: "/api/me/nodes/edit", body: { op: "reopen", node: String(n.id) } };
  }
  if (path === "/api/draft" || path === "/api/cardcheck") return { ok: { ok: true, state: "ok" } };   // 저장 표 없음 — 화면 쪽(이 기기)에만 남음
  return { error: "아직 안 돼요", status: 400 };
}
