
import { tokenRows } from "./agent-token-cache";
import { regroup } from "./importer/routes";
import { parseConnectKind, titleOf, readsOf, oauthApi, CONNECT_TTL } from "./connectors/connect-card";
import { boardHead, withHead } from "./board-head";
import { primaryPick, notChat, type Item } from "./importer/group";
import { REVOKED, withRv } from "./importer/revoked";
import { prefsOf, tidyOn } from "./node-prefs";
import { history, topics, promiseRows } from "./member-views";
import { splitMarks, splitMove } from "./member-split";
import { seatsFromData } from "./role-seat";
import { chiefOf, type Seat } from "./inbox-rules";
import { orderFromData, rankOf, deptOf } from "./node-order";
import { frontDoorFromData, frontDoorNode, readFrontDoor } from "./front-door";
import { addRows, dropRef, RESERVED, type ConvoRow } from "./task-convo";
import { peerIds, peerKey, peerTail, peerTs, PEER_TS } from "./agents-fold";

type R = Record<string, any>;
const FREQ = ["white_check_mark", "eyes", "+1", "raised_hands", "pray", "heart", "tada", "fire", "joy", "thinking_face", "100", "bulb"];   // owner-read FREQ_DEFAULT
const PRIMARY = "%1";
export const UNSORTED = "unsorted";   // 트리 정리의 「분류 안 됨」 열 키(머리 없음)
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

type Node = { id: string; pane: string; name: string; area: string; state: string; why: string; updated_at: number; archived_at: number | null; wins: Set<string>; windows: R[]; convos: R[]; aliases?: { id: string; name: string }[]; goneWins?: number };

export type Face = { seed: string; hue: number; photo?: string };
const FACE_SEEDS = ["mochi", "pebble", "nova", "tofu", "echo", "kiwi", "company lead", "DGit lead", "personal lead", "shop lead", "luma", "bean"];   // botpick.js SEEDS
const FACE_HUES = [18, 45, 140, 180, 215, 265, 320, 0];   // botpick.js HUES
const FACE_SEED = /^[A-Za-z0-9 _-]{1,40}$/, BLOB_ID = /^[0-9a-f]{32}$/;
export const meKey = (me: string) => "@me:" + String(me).toLowerCase();
const AGENT_FACES: [string, number][] = [["mochi", 265], ["pebble", 215], ["nova", 185], ["tofu", 320], ["echo", 18], ["kiwi", 48], ["plum", 345], ["moss", 75], ["wave", 240], ["dune", 290]];
export const agentFaceAt = (i: number): Face => { const [seed, hue] = AGENT_FACES[i % AGENT_FACES.length]; return { seed, hue }; };
export function headFaces(names: string[]): Map<string, Face> {
  const out = new Map<string, Face>(), used = new Set<number>(), N = AGENT_FACES.length - 1;
  for (const n of [...new Set(names)].sort()) {
    let h = 2166136261; for (const ch of n.trim()) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619) >>> 0; }
    let k = h % N; for (let j = 0; j < N && used.has(k); j++) k = (k + 1) % N;
    used.add(k); if (used.size >= N) used.clear(); out.set(n, agentFaceAt(k + 1));
  }
  return out;
}
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
// 사람이 정한 상위 노드(node_setting.data.parent = { 노드 id: 상위 노드 id } — /api/me/nodes/parent, 노드 정의 꼴의 parent 칸): 트리에서 그 노드를 상위 노드의 열 밑으로
export const TOP = "top";   // parent 칸의 「맨 위」(열 머리 = 메인 봇 바로 밑 에이전트) 표지 — 노드 id 는 늘 n_ · sl_ … 로 시작해 안 겹침
export function parentsOf(data: unknown): Record<string, string> {
  const p = json<{ parent?: unknown }>(data as string, {}).parent;
  if (!p || typeof p !== "object" || Array.isArray(p)) return {};
  return Object.fromEntries(Object.entries(p as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== e[1]));
}
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
  const L = await load(db, me), d = await data(db, me, bot, L);   // load 한 번
  const idOf = new Map<string, string>([...L.nodes.map(n => [n.pane, n.id] as [string, string]), ...L.engineNodes.map(w => [paneOfId(String(w.id)), String(w.id)] as [string, string])]);
  const heads = new Map((d.areas as R[]).filter(a => a.key !== "primary").map(a => [String(a.lead), a]));
  return (d.panes as R[]).filter(p => p.kind === "lead").map(p => {
    const id = idOf.get(p.pane) || "", h = heads.get(p.pane), mine = id ? L.faces[id] : undefined;
    return { pane: p.pane, node: id, name: p.win, head: !!h, column: h ? h.name : "", avatar: mine || (h ? h.avatar : faceOf(String(p.win))), custom: !!mine };
  }).sort((a, b) => Number(b.head) - Number(a.head));
}

const FRESHING = new Map<string, number>();
export async function fresh(env: { DB: D1Database; PUBLIC_URL: string }, me: string) {
  const t0 = Date.now(); if (t0 - (FRESHING.get(me) || 0) < 10_000) return;
  FRESHING.set(me, t0);
  try { await fresh0(env, me); } finally { FRESHING.delete(me); }
}
const DATA_GATE = new Map<string, { at: number; n: number }>(), DATA_MAX = 60;
export function dataGate(me: string, now = Date.now()) {
  let g = DATA_GATE.get(me); if (!g || now - g.at >= 5_000) DATA_GATE.set(me, g = { at: now, n: 0 });
  return ++g.n <= DATA_MAX;
}
async function fresh0(env: { DB: D1Database; PUBLIC_URL: string }, me: string) {
  const [la, lw] = await env.DB.batch([
    env.DB.prepare("SELECT MAX(at) at FROM imp_audit WHERE owner = ?").bind(me),
    env.DB.prepare("SELECT MAX(x) at FROM (SELECT MAX(at) x FROM board_log WHERE owner = ? UNION ALL SELECT MAX(COALESCE(answered_at, at)) FROM board_card WHERE owner = ?)").bind(me, me),
  ]);
  const a = (la.results[0] as { at: number | null })?.at || 0, w = (lw.results[0] as { at: number | null })?.at || 0;
  if (w > a || (a && Date.now() - a > 10 * 60_000)) await regroup(env as never, me);
}

const closeStaleConnect = (db: D1Database, me: string) => db.prepare("UPDATE board_card SET state = 'closed', done = '만료' WHERE owner = ? AND state = 'open' AND kind LIKE 'connect:%' AND at < ?").bind(me, Date.now() - CONNECT_TTL).run().catch(() => {});   // 10분 지난 「연결하기」 카드(connect-card.ts)
// 앞단 설정(node_setting.data.front_door.pairs[].name — front-door.ts)의 노드 이름들. 설정 없음 · 망가진 값이면 빈 목록
// 내 설정 한 줄(node_setting.data) — readFrontDoor 와 같은 읽기 하나. 앞단(front_door)과 에이전트끼리 접기(agents_fold)를 같이 봄. 못 읽으면 null(앞단 없음)
const settingData = (db: D1Database, me: string) => db.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me).first<{ data: string }>().then(r => r?.data ?? null).catch(() => null);
const LOG_MAX = 600;
const FRONT_NAMES = "SELECT json_extract(p.value, '$.name') FROM node_setting s, json_each(CASE WHEN json_valid(s.data) THEN CASE WHEN json_type(s.data, '$.front_door.pairs') = 'array' THEN json_extract(s.data, '$.front_door.pairs') END END) p WHERE s.owner = ?";
type Ctx = { waitUntil(p: Promise<unknown>): void };
const READ_TTL = 400, readShare = new Map<string, { at: number; p: ReturnType<typeof load> }>();
export function loadRead(db: D1Database, me: string, ctx?: Ctx | null): ReturnType<typeof load> {
  if (!ctx) return load(db, me);
  const now = Date.now(), hit = readShare.get(me);
  if (hit && now - hit.at < READ_TTL) return hit.p;
  if (readShare.size > 500) readShare.clear();
  const p = load(db, me); readShare.set(me, { at: now, p });
  ctx.waitUntil(p.catch(() => { if (readShare.get(me)?.p === p) readShare.delete(me); }));   // 실패는 나눠 주지 않음(다음 요청이 새로)
  return p;
}
const TOPICS_TTL = 15_000, TOPICS_MAX = 100, topicsShare = new Map<string, { at: number; ver: string; v: unknown }>();
export function loadForget(me: string) { const k = me.toLowerCase(); readShare.delete(k); for (const t of [...topicsShare.keys()]) if (t.startsWith(k + "\n")) topicsShare.delete(t); }
export async function load(db: D1Database, me: string) {
  await closeStaleConnect(db, me);
  const tkP = tokenRows(db, me);   // 열쇠 표는 늘려 읽기(agent-token-cache.ts)
  const [nd, mi, it, lg, cd, dr, ew, ns, pw, mb, cx, rvd] = await db.batch([
    db.prepare(`SELECT id, name, pinned_name, area, state, why, counts, updated_at, archived_at FROM mnode WHERE owner = ? AND (archived_at IS NULL OR archived_at > ? OR COALESCE(NULLIF(pinned_name, ''), name) IN (${FRONT_NAMES})) ORDER BY updated_at DESC`).bind(me, Date.now() - 24 * 3600_000, me),   // 앞단(설정 front_door)으로 고른 노드는 보관돼도 읽음 — 설정 없으면 빈 목록
    db.prepare("SELECT item, node FROM mnode_item WHERE owner = ?").bind(me),
    db.prepare("SELECT key, kind, engine, title, cwd, branch, refs, state, state_at, seen_at, win, session, device_id, gone_at, CASE WHEN kind = 'window' THEN handle END handle FROM imp_item WHERE owner = ? AND gone_at IS NULL UNION ALL SELECT key, kind, engine, title, cwd, branch, refs, state, state_at, seen_at, win, session, device_id, gone_at, CASE WHEN kind = 'window' THEN handle END handle FROM imp_item WHERE owner = ? AND gone_at > ?").bind(me, me, Date.now() - 24 * 3600_000),
    db.prepare(`SELECT id, win, kind, text, thread, at, wid FROM board_log WHERE owner = ? ${NOT_CHAT} ORDER BY at DESC LIMIT ${LOG_MAX}`).bind(me),   // 「세션」 칸 대화 줄은 그 대화 화면에만(chatLog)
    db.prepare("SELECT rowid AS n, id, win, kind, snooze_until, question, choices, recommend, body, state, answer, answered_at, at FROM board_card WHERE owner = ? AND (state = 'open' OR (state = 'answered' AND answered_at > ?)) ORDER BY at DESC LIMIT 100").bind(me, Date.now() - 86_400_000),
    db.prepare("SELECT rowid AS n, id, name, brief, at FROM (SELECT rowid, id, name, brief, created_at AS at FROM role_draft WHERE owner = ? AND state = 'draft' ORDER BY created_at DESC LIMIT 30)").bind(me),
    db.prepare("SELECT id, kind, name, state, state_at, note, created_at, closed_at FROM engine_window WHERE owner = ? AND (state NOT IN ('closed','failed','gone') OR state_at > ?) ORDER BY created_at DESC LIMIT 60").bind(me, Date.now() - 12 * 3600_000),
    db.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me),
    db.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = 'primary_win'").bind(me),
    db.prepare("SELECT owner, seed, hue, photo FROM member_bot WHERE owner IN (?, ?)").bind(me, meKey(me)),
    db.prepare("SELECT id, win, kind, question, at, answered_at FROM board_card WHERE owner = ? AND state = 'closed' ORDER BY at DESC LIMIT 50").bind(me),
    REVOKED(db, me),
  ]);
  const tk = { results: await tkP };
  const items = new Map(withRv(it.results as R[], rvd.results as { id: string }[]).map(r => [String(r.key), r]));
  const keyOfWin = new Map<string, string>(), keysOfWin = new Map<string, string[]>();
  for (const r of tk.results as R[]) { keyOfWin.set(r.win, r.pane); (keysOfWin.get(r.win) || keysOfWin.set(r.win, []).get(r.win)!).unshift(r.pane); }
  const itemOfWin = new Map<string, string>(); for (const i of items.values()) if (i.win && (i.kind === "window" || !itemOfWin.has(i.win))) itemOfWin.set(i.win, i.key);
  const nodeOfItem = new Map((mi.results as R[]).map(r => [String(r.item), String(r.node)]));
  const engMain = (ew.results as R[]).some(w => w.kind === "main" && !["closed", "failed", "gone"].includes(w.state));
  const prefs = prefsOf((ns.results[0] as R | undefined)?.data), fd = prefs.front_door, tcOn = prefs.task_channels;
  const seatAll = seatsFromData((ns.results[0] as R | undefined)?.data), seatRows = seatAll.filter(x => !x.primary), roleNames = seatRows.map(x => x.name);   // 역할 자리표(role-seat.ts)의 부서장 이름 — 있으면 왼쪽 에이전트는 메인 봇 + 이 역할들만   // 앞단 · 채널 = 태스크는 켠 사람만(node-prefs.ts)
  const pp = primaryPick([...items.values()].filter(i => !i.rv) as unknown as Item[], prefs.primary_item, engMain);
  const primary = pp.primary as unknown as R | null;
  const primKeys = new Set<string>(primary ? [String(primary.key), ...(primary.session ? [String(primary.session)] : [])] : []);
  const isOriginalPrimWin = (win: string) => !!primary?.win && (keyOfWin.get(win) || win) === primary.win;
  const nodes: Node[] = (nd.results as R[]).map(n => ({ id: n.id, pane: paneOfId(n.id), name: String(n.pinned_name || n.name || "노드"), area: String(n.area || "").trim(), state: n.state, why: n.why || "", updated_at: n.updated_at, archived_at: n.archived_at, wins: new Set<string>(), windows: [], convos: [], aliases: (json<{ aliases?: { id: string; name: string }[] }>(n.counts, {}).aliases || []).filter(a => a && typeof a.id === "string" && typeof a.name === "string") })).filter(n => !n.archived_at || n.archived_at > Date.now() - 24 * 3600_000 || frontDoorNode(fd, n));
  const byId = new Map(nodes.map(n => [n.id, n]));
  // 옛 채널에 다른 창이 남거나 다시 열렸으면 그 채널의 주소·사람 글은 제자리를 지킴.
  for (const n of nodes) n.aliases = n.aliases?.filter(a => !nodes.some(other => !other.archived_at && (other.id === a.id || other.name === a.name)));
  for (const [item, node] of nodeOfItem) {
    const n = byId.get(node); if (!n || primKeys.has(item)) continue;
    const i = items.get(item);
    if (i?.kind === "window" && !i.gone_at) n.windows.push(i);
    else if (i?.kind === "window") n.goneWins = (n.goneWins || 0) + 1;   // 닫힌 창(하루 안) — 트리 정리(tidy)가 「창이 다 닫힌 노드」를 바로 뺌
    if (i && (i.kind === "session" || i.kind === "thread") && i.title) n.convos.push(i);   // 들여온 대화 — 노드 채팅에 글로(convoMsg)
    const w = i ? i.win : item.startsWith("win:") ? item.slice(4) : null; if (w) n.wins.add(w);
  }
  // 앞단으로 고른 노드(설정 front_door)는 Primary 의 별칭 — 트리 · 채널에는 따로 안 그림
  const frontNodes = nodes.filter(n => frontDoorNode(fd, n));
  const onlyPrim = (id: string) => { let p = 0, o = 0; for (const [k, v] of nodeOfItem) if (v === id) primKeys.has(k) ? p++ : o++; return p > 0 && o === 0; };
  const closedIds = new Set(json<{ closed?: string[] }>((ns.results[0] as R | undefined)?.data, {}).closed || []);
  const shown = (primary ? nodes.filter(n => !onlyPrim(n.id)) : nodes).filter(n => !closedIds.has(n.id) && !frontNodes.includes(n));
  // 업무 노드의 옛 채널 별칭(채널 = 태스크를 켠 사람만 생김 — importer/routes.ts)
  const aliasNode = (name: string, id = "") => nodes.find(n => !n.archived_at && n.id.startsWith("tk_") && n.aliases?.some(a => id ? a.id === id : a.name === name || paneOfId(a.id) === name || a.id === name));
  const resolveNode = (name: string, id = "") => aliasNode(name, id) || (id ? shown.find(n => n.id === id) : undefined) || shown.find(n => n.name === name || n.pane === name);
  const mains = new Map((nd.results as R[]).map(n => [String(n.id), json<{ main?: string }>(n.counts, {}).main || ""]));
  for (const n of nodes) { const m = mains.get(n.id); if (m) n.windows.sort((a, b) => Number(b.key === m) - Number(a.key === m)); }
  const pastOf = new Map<string, string>(); for (const r of nd.results as R[]) { const ps = json<{ past?: unknown }>(r.counts, {}).past; for (const w of Array.isArray(ps) ? ps : []) if (typeof w === "string") pastOf.set(w, String(r.id)); }
  const sessNode = new Map<string, string>();
  for (const [item, node] of nodeOfItem) { const s = items.get(item)?.session; if (s && !primKeys.has(item) && !primKeys.has(String(s))) sessNode.set(String(s), node); }
  const nodeOfKey = (k: string) => byId.get(nodeOfItem.get(itemOfWin.get(k) || `win:${k}`) || (tcOn ? nodeOfItem.get(`window:${k}`) : undefined) || pastOf.get(k) || "");
  const winNode = new Map<string, Node | null>();
  const nodeOfWin = (win: string) => {
    if (isOriginalPrimWin(win)) return null;
    if (winNode.has(win)) return winNode.get(win)!;
    const k = keyOfWin.get(win) || win;
    const item = itemOfWin.get(k) || `win:${k}`;
    let n = byId.get(nodeOfItem.get(item) || (tcOn ? nodeOfItem.get(`window:${k}`) : undefined) || pastOf.get(k) || pastOf.get(win) || "") || aliasNode(win) || frontNodes.find(n => n.name === win) || null;   // 예전 그대로
    if (!n) for (const o of keysOfWin.get(win) || []) if (o !== k && (n = nodeOfKey(o) || null)) break;
    if (!n && prefs.agents_fold) { const s = items.get(itemOfWin.get(k) || "")?.session || items.get(itemOfWin.get(win) || "")?.session; if (s) n = byId.get(sessNode.get(String(s)) || "") || null; }
    winNode.set(win, n); return n;
  };
  const winsOf = (n: Node) => [...new Set([...keysOfWin.keys(), ...[...keysOfWin.values()].flat(), ...[...items.values()].map(i => String(i.win || "")), ...[...nodeOfItem.keys()].filter(k => /^(?:window|win):/.test(k)).map(k => k.replace(/^(?:window|win):/, "")), ...pastOf.keys()])].filter(w => w && nodeOfWin(w) === n).concat(n.name, (n.aliases || []).map(a => a.name)).sort();
  // 앞단은 한 창이라고 추정하지 않음 — 고른 노드들을 Primary의 별칭으로 읽되 원본/전송 창은 보존.
  const frontWins = new Set<string>();
  const frontFrom = new Map<string, string>();
  for (const n of frontNodes) {
    const ws = new Set<string>([n.name, ...n.wins]);
    for (const [key, id] of nodeOfItem) if (id === n.id) {
      const item = items.get(key); if (item?.win) ws.add(String(item.win));
      else if (/^(?:window|win):/.test(key)) ws.add(key.replace(/^(?:window|win):/, ""));
    }
    for (const [name, win] of keyOfWin) if (ws.has(win)) ws.add(name);
    for (const w of ws) { frontWins.add(w); if (!frontFrom.has(w)) frontFrom.set(w, n.name); }
  }
  const front = fd && frontNodes.length ? { name: fd.name, pane: PRIMARY, aliases: [fd.name, ...fd.aliases, ...frontNodes.flatMap(n => [n.name, n.pane])], wins: frontWins, nodes: frontNodes, from: (win: string) => frontFrom.has(win) ? "옛 " + frontFrom.get(win) : null } : null;
  const isPrimWin = (win: string) => isOriginalPrimWin(win) || frontWins.has(win) || frontNodes.includes(nodeOfWin(win)!);
  const mainWin = pp.explicit ? null : (ew.results as R[]).find(w => w.kind === "main" && !["closed", "failed", "gone"].includes(w.state)) || null;
  const engineNodes = (ew.results as R[]).filter(w => w.kind === "role" && !nodes.some(n => n.name === w.name || n.wins.has(w.name)));
  const roleWins = new Set((ew.results as R[]).filter(w => w.kind === "role" && !["closed", "failed", "gone"].includes(w.state)).map(w => String(w.name)));
  const primaryWin = String((pw.results[0] as R | undefined)?.v || ""), defaultNode = primaryWin ? byId.get(nodeOfItem.get(primaryWin) || "") || nodes.find(n => n.windows.some(w => w.key === primaryWin)) || null : null;
  const tidy = tidyOn(prefs, roleNames.length), seatRole = new Map<string, string>();
  for (const n of nodes) { if (n.archived_at) continue; const x = seatRows.find(x => x.node ? x.node === n.id : n.id.startsWith("tk_") && n.name === x.name); if (x) seatRole.set(n.id, x.name); }
  const seatIds = new Set(seatRole.keys()), parents = parentsOf((ns.results[0] as R | undefined)?.data);
  // 에이전트 화면(에이전트끼리 접기가 걸리는 채널): 자리표 부서 노드 · 맨 위(top)로 둔 노드 · 엔진 역할 창이 묶인 노드. 업무 · 작업자 노드는 아님
  const agentScreen = (n: Node) => seatIds.has(n.id) || parents[n.id] === TOP || roleWins.has(n.name) || [...n.wins].some(w => roleWins.has(w));
  return { agentsFold: prefs.agents_fold, agentScreen, tidy, seatIds, seatRole, seatAll, order: orderFromData((ns.results[0] as R | undefined)?.data), keysOf: (win: string) => keysOfWin.get(win) || [], winsOf, resolveNode, front, frontDoor: fd, taskChannels: tcOn, roleNames, defaultNode, primaryWin, nodes: shown, byId, primary, isPrimWin, mains, taskDots: prefs.task_dots, agentUnit: /"unit":"agent"/.test(String((ns.results[0] as R | undefined)?.data || "")), pri: (json<{ pri?: Record<string, { pri?: string }> }>((ns.results[0] as R | undefined)?.data, {}).pri || {}) as Record<string, { pri?: string }>, nodeOfWin, logs: lg.results as R[], cards: cd.results as R[], closedCards: cx.results as R[], drafts: dr.results as R[], mainWin, engineNodes, roleWins,
    parents, faces: facesOf((ns.results[0] as R | undefined)?.data), botFace: faceRow((mb.results as R[]).find(r => r.owner === me)), meFace: faceRow((mb.results as R[]).find(r => r.owner === meKey(me))) };
}

// 채널(pane)마다 에이전트 글 — 모아 보기 읽지 않음 · 저장(member-inbox.ts)이 씀. 채널 = 노드 + 노드에 안 묶인 역할 창(메인 봇은 따로), 이름은 틀 노드 채팅 열쇠(「n:<이름>」)와 같음.
// 글은 load 가 읽는 최근 600줄 안에서만. paneOfLog: 글 한 줄(win · thread) → 그 채널 pane(못 찾으면 null)
export async function paneLogs(db: D1Database, me: string) {
  const L = await load(db, me);
  const agent = (r: R) => r.kind !== "me" && r.win !== ME && !OWN.test(r.win);
  const chans = [
    // 에이전트끼리 접기(켠 사람 · 에이전트 화면만): 접힌 칸 줄은 읽지 않음에 안 셈
    ...L.nodes.map(n => { const peer = foldScreen(L, n) ? peersOf(L, nodeRows(L, n)) : null;
      return { pane: n.pane, name: n.name, rows: L.logs.filter(r => !inPrim(r) && agent(r) && L.nodeOfWin(r.win) === n && !peer?.has(String(r.id))) }; }),
    ...L.engineNodes.map(w => { const peer = L.agentsFold ? peersOf(L, L.logs.filter(r => !inPrim(r) && r.win === w.name)) : null;
      return { pane: paneOfId(w.id), name: String(w.name), rows: L.logs.filter(r => !inPrim(r) && agent(r) && r.win === w.name && !peer?.has(String(r.id))) }; }),
  ];
  const engineOf = new Map(L.engineNodes.map(w => [String(w.name), paneOfId(w.id)]));
  const paneOfLog = (r: { win: string; kind?: string; thread?: string | null }) => inPrim(r) || (r.kind !== "me" && L.isPrimWin(String(r.win))) ? PRIMARY   // 있던 primary 창의 보고 줄 = 메인 봇 판(data() %1 과 같게)
    : L.nodeOfWin(r.win)?.pane || engineOf.get(r.win) || (r.kind === "me" ? L.nodes.find(n => n.name === r.win)?.pane : null) || null;
  const seatOf = (r: { win: string; kind?: string; thread?: string | null }): Seat => paneOfLog(r) === PRIMARY ? "chief" : L.seatIds.has(L.nodeOfWin(String(r.win))?.id || "") ? "dept" : null;
  // 메인 봇 판의 뿌리 글(Primary 채팅 새 글 · 있던 primary 창의 보고 줄 · 보더 시스템 줄) — 자리표 쓰는 사람의 읽지 않음(비서실장 채팅)이 씀. 내 글 · 스레드 답은 뺌
  const prim = L.logs.filter(r => r.kind !== "me" && r.win !== ME && !OWN.test(String(r.win)) && (r.thread === "primary" || (!r.thread && L.isPrimWin(String(r.win)))));
  const mineAt = Math.max(0, ...L.logs.filter(r => r.thread === "primary" && r.win === ME).map(r => Number(r.at)));   // 내가 Primary 에 마지막으로 쓴 때 — 그 앞 글은 읽은 것(스레드 「마지막이 내 글」과 같은 뜻)
  return { chans, paneOfLog, prim, mineAt, seatOf, rules: { on: L.seatAll.length > 0, chief: chiefOf(L.seatAll) } };
}
async function withReacts(db: D1Database, me: string, out: R[]) {
  const lids = out.map(m => m.lid).filter((x): x is number => !!x);
  if (!lids.length) return out;
  const rs = (await db.prepare("SELECT log_id, emoji FROM member_react WHERE owner = ? AND log_id IN (SELECT value FROM json_each(?))").bind(me, JSON.stringify(lids)).all<{ log_id: number; emoji: string }>().catch(() => ({ results: [] as { log_id: number; emoji: string }[] }))).results;
  const by = new Map<number, string[]>(); for (const r of rs) (by.get(r.log_id) || by.set(r.log_id, []).get(r.log_id)!).push(r.emoji);
  for (const m of out) if (m.lid && by.has(m.lid)) m.reactions = by.get(m.lid)!.map(name => ({ name, count: 1, mine: true }));
  return out;
}

const STATE: Record<string, string> = { working: "일하는 중", busy: "일하는 중", starting: "일하는 중", opening: "일하는 중", background: "뒤 작업 중" };

const TASK_KO: Record<string, string> = { working: "진행", blocked: "막힘", waiting: "기다림", done: "완료", cancelled: "취소" };
export function taskSide(nodes: Pick<Node, "id" | "pane" | "name" | "archived_at" | "state">[], tasks: Map<string, R>, lastAt: Map<string, number>, nowMin: number, dept?: (id: string) => string) {   // dept = 자리표 있는 사람만(부서 그룹) — chan = 그 태스크 채널 키(안 읽음 줄 · 번호까지 든 노드 이름)
  const out = nodes.flatMap(n => {
    const t = tasks.get(n.id); if (!t || !t.issue) return [];
    const done = t.state === "done" || t.state === "cancelled" || !!n.archived_at;
    const at = lastAt.get(n.id) || 0;
    const no = String(t.issue).replace(/^.*#/, ""), nm = String(n.name), pre = "#" + no;
    return [{ pane: n.pane, ...(dept ? { dept: dept(n.id), chan: "n:" + nm } : {}), issue: String(t.issue), name: nm.startsWith(pre) ? nm.slice(pre.length).replace(/^\s*[·:-]?\s*/, "") || nm : nm, state: String(t.state), state_ko: TASK_KO[String(t.state)] || "", done, at, ago: Math.max(0, Math.round((nowMin - at) / 60_000)) }];
  });
  return out.sort((a, b) => Number(a.done) - Number(b.done) || b.at - a.at || (a.pane < b.pane ? -1 : 1)).map(({ at: _at, ...x }) => x);
}

export function paneNow<T extends Record<string, any>>(rows: T[], nowMin: number) {
  const real = rows.find(r => r.kind !== "status"), blocked = real && (KIND_KO[real.kind] || real.kind) === "막힘" ? real : null;
  return { last: blocked || rows[0] || null, blocked, watch: !blocked && rows[0]?.kind === "status" && nowMin - Number(rows[0].at) < 86_400_000 ? rows[0] : null };
}
const PSTATE: Record<string, string> = { working: "일하는 중", question: "질문" };
export async function data(db: D1Database, me: string, bot: { name?: string } | null, pre?: Awaited<ReturnType<typeof load>> | null) {
  const L = pre || await load(db, me), now = Date.now(), nowMin = Math.floor(now / 60_000) * 60_000, ago = (ms: number) => Math.max(0, Math.round((nowMin - ms) / 60_000));
  const line = (r: R) => ({ id: r.id, ago: ago(r.at), kind: KIND_KO[r.kind] || r.kind, msg: cut(r.text, 220), handled: false, short: cut(r.text, 60), short_ok: true, title: cut(r.text, 30) });
  const logsOf = (n: Node | null, wins?: string[]) => L.logs.filter(r => !inPrim(r) && r.kind !== "me" && !OWN.test(r.win) && (n ? L.nodeOfWin(r.win) === n : wins!.includes(r.win)));
  const pane = (o: { pane: string; win: string; kind: string; state: string; cwd?: string; branch?: string; rows: R[]; blockedOwner?: boolean }) => {
    const pn = paneNow(o.rows, nowMin), last = o.rows[0] ? line(o.rows[0]) : null, blk = pn.blocked ? line(pn.blocked) : null;
    return { win: o.win, area: "primary", role: "리드", pane: o.pane, acct: "", state: o.state, dur: "", stuck: "", cwd: o.cwd || "", branch: o.branch || "", kind: o.kind, last: blk || last, blocked: blk,
      recent: o.rows.slice(0, 5).reverse().map(r => ({ ago: ago(r.at), kind: KIND_KO[r.kind] || r.kind, msg: cut(r.text, 260) })),
      hist: o.rows.filter(r => nowMin - r.at < 86_400_000).reverse().map(r => ({ m: ago(r.at), k: KIND_KO[r.kind] || r.kind })), topics: [], pri: priOf(L.pri, o.win), owner: !!blk,
      watch: pn.watch ? cut(pn.watch.text, 60) : "" };   // 막힘 동안은 막힘이 먼저
  };
  const mainName = L.frontDoor?.name || bot?.name || "Primary";   // 앞단 설정(front_door)이 있으면 그 이름
  // 메인 봇 판: 엔진 메인 창이 있으면 그 상태, 없으면 있던 primary 창(들여온 것)의 상태 · 폴더 — 그 창이 보드에 올린 보고 줄도 봇 줄로
  const P = L.primary;
  const panes: R[] = [pane({ pane: PRIMARY, win: mainName, kind: "primary", state: STATE[L.mainWin?.state] || (P && PSTATE[P.state]) || "쉼", cwd: L.mainWin ? "" : P?.cwd, branch: L.mainWin ? "" : P?.branch,
    rows: L.logs.filter(r => inPrim(r) ? r.win !== ME && r.win !== "보더" : r.kind !== "me" && L.isPrimWin(String(r.win))) })];
  const botFace = cleanFace(bot) || L.botFace || faceOf(mainName);
  panes[0].avatar = botFace;
  const nodeOfPane = new Map<string, string>();
  const parked: R[] = [], closed: R[] = [];
  // 업무 노드 값(mnode.task, 0054) — 따로 읽음: 칸이 아직 없는 D1 이면 빈 표(load 의 한 batch 에 넣으면 보드 전체가 깨짐)
  const TASK_ST = new Set(["working", "blocked", "waiting", "done", "cancelled"]);
  const tasks = new Map(((await db.prepare("SELECT id, task FROM mnode WHERE owner = ? AND id LIKE 'tk\\_%' ESCAPE '\\' AND task IS NOT NULL").bind(me).all<R>().catch(() => ({ results: [] as R[] }))).results)
    .map(r => [String(r.id), json<R>(r.task, {})] as [string, R]).filter(([, t]) => TASK_ST.has(String(t.state))));
  const hasKid = new Set(L.nodes.map(n => L.parents[n.id]).filter(Boolean));   // 보이는 노드의 상위만(닫힘 · 보관된 하위만 있으면 담당 없음 그대로)
  const cardNodes = new Set(L.tidy ? L.cards.filter(c => c.state === "open").map(c => L.nodeOfWin(c.win)?.id).filter(Boolean) : []);
  const lastAt = new Map<string, number>();   // 사이드 「태스크」 정렬(최근 글 순)
  for (const n of L.nodes) {
    const rows = logsOf(n), w0 = n.windows[0];
    lastAt.set(n.id, Math.max(Number(rows[0]?.at || 0), Number(n.updated_at || 0)));
    if (n.archived_at || n.state === "done") { closed.push({ pane: n.pane, win: n.name, ago: ago(n.archived_at || n.updated_at), msg: rows[0] ? cut(rows[0].text, 200) : n.why, area: "primary" }); continue; }
    if (L.tidy && n.goneWins && !n.windows.length && (n.state === "idle" || n.state === "parked") && !cardNodes.has(n.id) && !tasks.has(n.id) && !hasKid.has(n.id) && !L.seatIds.has(n.id)) { closed.push({ pane: n.pane, win: n.name, ago: ago(n.updated_at), msg: rows[0] ? cut(rows[0].text, 200) : n.why, area: "primary" }); continue; }
    if (n.state === "parked") { parked.push({ id: "c" + n.pane.slice(1), name: n.name, area: "primary", msg: n.why || "주차", owner: false, ago: ago(n.updated_at), stale: null, wait: n.why || "주차", topics: [], pri: priOf(L.pri, n.name), pane: n.pane, short: n.why || "주차", watch: "" }); continue; }
    const pn: R = pane({ pane: n.pane, win: n.name, kind: "lead", state: STATE[n.state] || (n.state === "turn" ? "질문" : "쉼"), cwd: w0?.cwd, branch: w0?.branch, rows });
    const tk = tasks.get(n.id);
    if (tk && !tk.issue && L.parents[n.id] === TOP) pn.tkdept = true;
    if (tk) pn.tk = true;   // 업무 노드는 왼쪽 채널, 부서는 에이전트 칸(점 설정과 무관)
    if (!tk && (L.roleWins.has(n.name) || [...n.wins].some(w => L.roleWins.has(w)))) pn.rolewin = true;
    if (tk) {
      const chips = [...(tk.confirm ? ["confirm"] : []), ...(!w0 ? (hasKid.has(n.id) ? [] : ["unassigned"]) : n.windows.every(w => w.state === "parked") ? ["parked"] : [])];
      if (chips.length) pn.tkChips = chips;
      if (L.taskDots) pn.task = { state: tk.state, line: tk.line || "", issue: tk.issue || "", chips };
    }
    panes.push(pn);
    nodeOfPane.set(n.pane, n.id);
  }
  for (const w of L.engineNodes) {
    const rows = logsOf(null, [w.name]), p = paneOfId(w.id);
    if (w.state === "parked") parked.push({ id: "c" + p.slice(1), name: w.name, area: "primary", msg: w.note || "주차", owner: false, ago: ago(w.state_at || w.created_at), stale: null, wait: "주차", topics: [], pri: priOf(L.pri, String(w.name)), pane: p, short: "주차", watch: "" });
    else if (["closed", "failed", "gone"].includes(w.state)) closed.push({ pane: p, win: w.name, ago: ago(w.closed_at || w.state_at || w.created_at), msg: w.note || "", area: "primary" });
    else { panes.push({ ...pane({ pane: p, win: w.name, kind: "lead", state: STATE[w.state] || "쉼", rows }), rolewin: true }); nodeOfPane.set(p, String(w.id)); }
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
      const HEAD = /팀장|리드|총괄|비서|lead/i, TEST = /^\s*\[(시험|test)\]/i, BUSY = new Set(["일하는 중", "질문", "뒤 작업 중"]);
      const ok = (p: R) => !TEST.test(String(p.win));
      const top = (p: R) => L.parents[nodeOfPane.get(p.pane) || ""] === TOP;
      const hn = new Map(order.map(a => [a, groups.get(a)!.find(p => p.tkdept && ok(p)) || groups.get(a)!.find(p => top(p) && ok(p)) || groups.get(a)!.find(p => HEAD.test(String(p.win)) && ok(p))]));
      const org = [...hn.values()].some(Boolean);
      const heads = new Map(order.map(a => { const ps = groups.get(a)!; return [a, hn.get(a) || (org ? undefined : ps.find(p => ok(p) && BUSY.has(String(p.state))) || ps.find(ok) || ps[0])]; }));
      const keyOfArea = new Map<string, string>();
      order.filter(a => heads.get(a)).forEach((a, i) => {
        const ps = groups.get(a)!, key = "m" + i;
        const head = heads.get(a)!;
        for (const p of ps) p.area = key;
        // 열 머리 얼굴 = 머리 노드에 고른 얼굴, 없으면 열 이름에서 정한 얼굴(같은 이름 → 같은 얼굴) — 머리 판에도 같은 값
        const mine = L.faces[nodeOfPane.get(head.pane) || ""], avatar = mine || faceOf(a || "기타");   // 기본은 아래 headFaces 가 이름으로 다시 정함
        head.avatar = avatar; head.avatar_custom = !!mine;
        areas.push({ key, name: a || "기타", lead: head.pane, lead_name: head.win, avatar, avatar_custom: !!mine });
        keyOfArea.set(a, key);
      });
      const paneOfNode = new Map([...nodeOfPane].map(([pn, id]) => [id, pn])), headPanes = new Set(areas.map(x => x.lead)), byPane = new Map(panes.map(x => [x.pane, x]));
      const colMemo = new Map<string, string>();
      const colFor = (p: R, depth = 0): string => {
        const m = colMemo.get(p.pane); if (m !== undefined) return m;
        let a = p.area;
        if (p.kind === "lead" && !headPanes.has(p.pane) && depth < 30) {   // 30 = 고리(서로 상위)일 때 멈춤
          const up = L.parents[nodeOfPane.get(p.pane) || ""], upPane = up ? paneOfNode.get(up) : undefined, target = upPane ? byPane.get(upPane) : undefined;
          if (target && target !== p) a = colFor(target, depth + 1);
        }
        colMemo.set(p.pane, a); return a;
      };
      for (const p of panes) if (p.kind === "lead" && !headPanes.has(p.pane)) p.area = colFor(p);
      const nodeById = new Map(L.nodes.map(n => [n.id, n]));
      for (const q of parked) {
        const n = L.nodes.find(x => x.pane === q.pane); if (!n) continue;
        const up = L.parents[n.id], upPane = up && nodeById.get(up)?.pane, target = upPane ? panes.find(x => x.pane === upPane) : undefined;
        const k = target ? target.area : keyOfArea.get(areaOf.get(n.pane) ?? "");
        if (k) q.area = k;
      }
      const home = areas.find(x => x.key !== "primary" && x.lead === L.defaultNode?.pane)?.key;
      if (home && L.agentUnit) {
        for (const p of panes) if (p.kind === "lead" && p.pane !== PRIMARY && p.area === "primary") p.area = home;
        for (const q of parked) if (q.area === "primary") q.area = home;
      }
    }
  }
  if (areas.length === 1 && Object.keys(L.parents).length) {
    const shown = new Set([...nodeOfPane.values()]), hasKid = new Set(Object.entries(L.parents).filter(([k]) => shown.has(k)).map(([, v]) => v));
    const tops = panes.filter(p => { const id = nodeOfPane.get(p.pane) || "", up = L.parents[id];
      return p.kind === "lead" && p.pane !== PRIMARY && (up === TOP || (hasKid.has(id) && (!up || !shown.has(up)))); });
    const colOfNode = new Map<string, string>();
    tops.forEach((h, i) => { const key = "t" + i, id = nodeOfPane.get(h.pane) || "", mine = L.faces[id], avatar = mine || faceOf(String(h.win));   // 기본은 아래 headFaces 가 이름으로 다시 정함
      h.area = key; h.avatar = avatar; h.avatar_custom = !!mine; colOfNode.set(id, key); areas.push({ key, name: String(h.win), lead: h.pane, lead_name: h.win, avatar, avatar_custom: !!mine }); });
    const colOf = (id: string) => { for (let i = 0, x: string | undefined = id; x && i < 20; i++) { if (colOfNode.has(x)) return colOfNode.get(x); x = L.parents[x]; } return undefined; };
    if (tops.length) {
      for (const p of panes) if (p.kind === "lead" && !tops.includes(p)) { const k = colOf(nodeOfPane.get(p.pane) || ""); if (k) p.area = k; }
      for (const q of parked) { const n = L.nodes.find(x => x.pane === q.pane), k = n ? colOf(n.id) : undefined; if (k) q.area = k; }
    }
  }
  if (L.tidy) {
    for (const a of areas) if (a.key !== "primary") a.seat = L.seatIds.has(nodeOfPane.get(a.lead) || "");
    let n = 0;
    for (const p of panes) if (p.kind === "lead" && p.pane !== PRIMARY && p.area === "primary") { p.area = UNSORTED; n++; }
    for (const q of parked) if (q.area === "primary") { q.area = UNSORTED; n++; }
    if (n) areas.push({ key: UNSORTED, name: "분류 안 됨", lead: "", seat: false });
  }
  // 열 머리가 자리표 부서인데 노드 이름이 역할 이름과 다르면 역할 이름도(사이드바가 부서 머리를 role_seats 이름으로 찾음)
  for (const a of areas) { const role = a.key !== "primary" ? L.seatRole.get(nodeOfPane.get(a.lead) || "") : undefined; if (role && role !== a.name) a.seat_name = role; }
  const rank = rankOf(L.order);
  if (L.order.length) {
    const mid = areas.filter(a => a.key !== "primary" && a.key !== UNSORTED), ra = (a: R) => rank(nodeOfPane.get(a.lead) || "");
    const sorted = mid.map((a, i) => ({ a, i })).sort((x, y) => ra(x.a) - ra(y.a) || x.i - y.i).map(x => x.a);
    areas.splice(0, areas.length, ...areas.filter(a => a.key === "primary"), ...sorted, ...areas.filter(a => a.key === UNSORTED));
    for (const p of panes) { const r = rank(nodeOfPane.get(p.pane) || ""); if (Number.isFinite(r)) p.ord = r; }
  }
  {
    const paneOf = new Map([...nodeOfPane].map(([pn, id]) => [id, pn])), heads = new Set(areas.map(x => x.lead)), byPane = new Map(panes.map(x => [x.pane, x]));
    for (const p of panes) {
      if (p.kind !== "lead" || heads.has(p.pane)) continue;
      const up = L.parents[nodeOfPane.get(p.pane) || ""], t = up && up !== TOP ? byPane.get(paneOf.get(up) || "") : undefined;
      if (t && t !== p && t.kind === "lead" && t.area === p.area && !heads.has(t.pane)) p.up = t.pane;
    }
    // 고리(서로 상위 — 상위 정하기가 막지만 옛 값)는 끊음: 위로 따라가 제가 다시 나오면 그 판의 up 을 지움
    for (const p of panes) for (let x = p.up ? byPane.get(p.up) : undefined, i = 0; x && i < 60; i++, x = x.up ? byPane.get(x.up) : undefined) if (x === p) { delete p.up; break; }
  }
  {
    const dfl = areas.filter(a => a.key !== "primary" && a.lead && !a.avatar_custom), hf = headFaces(dfl.map(a => String(a.name)));
    for (const a of dfl) { const f = hf.get(String(a.name))!; a.avatar = f; const hp = panes.find(p => p.pane === a.lead); if (hp) hp.avatar = f; }
  }
  const known = new Set(panes.map(p => p.pane)), dp = L.defaultNode?.pane || (/^ew_/.test(L.primaryWin) ? paneOfId(L.primaryWin) : ""), dflt = dp && known.has(dp) ? dp : PRIMARY,
    toPane = (win: string) => { if (L.front && L.isPrimWin(win)) return PRIMARY; const n = L.nodeOfWin(win); return n && known.has(n.pane) ? n.pane : dflt; };
  const nameN = new Map<string, number>(); for (const n of L.nodes) nameN.set(n.name, (nameN.get(n.name) || 0) + 1);
  const cardCh = (win: string) => { const n = L.nodeOfWin(win); return n && known.has(n.pane) && nameN.get(n.name) === 1 ? "n:" + n.name : "primary"; };
  const decisions: R[] = [], cardlist: R[] = [];
  const todos: R[] = [];
  for (const c of L.cards) {
    const id = "w" + c.n, ch = json<string[]>(c.choices, []).map(x => cut(x, 90));
    if (c.kind === "todo") {
      if (c.state === "open") todos.push({ ts: String(c.id), id: String(c.id), area: "primary", title: cut(c.question, 200), body: cut(c.body || "", 600), due: "", win: c.win, pane: toPane(c.win), ago: ago(c.at) });
      if (CARD_TS.test(String(c.id))) cardlist.push({ ts: c.id, ref: "w:" + c.n, thread: null, channel: cardCh(c.win), kind: "todo", area: "primary", state: c.state === "open" ? "open" : "answered", title: cut(c.question, 80), at: c.at / 1000 });
      continue;
    }
    const snoozed = Number(c.snooze_until || 0) > now;
    if (c.state === "open" && !snoozed) decisions.push({ id, src: "wlog", pane: toPane(c.win), win: c.win, area: "primary", title: cut(c.question, 200), body: cut(c.body || "", 600), choices: c.recommend && ch.includes(c.recommend) ? [c.recommend, ...ch.filter(x => x !== c.recommend)] : ch, ago: ago(c.at), kind: "결정" });
    cardlist.push({ ts: CARD_TS.test(String(c.id)) ? c.id : "w:" + c.n, ref: "w:" + c.n, thread: null, channel: CARD_TS.test(String(c.id)) ? cardCh(c.win) : "primary", kind: "decision", area: "primary", state: c.state === "open" ? "open" : "answered", title: cut(c.question, 80), at: c.at / 1000 });
  }
  for (const d of L.drafts) {
    const n = 1_000_000_000 + d.n;
    decisions.push({ id: "w" + n, src: "wlog", pane: PRIMARY, win: mainName, area: "primary", title: `「${cut(d.name, 40)}」 역할 창을 열까요?`, body: cut(d.brief || "", 600), choices: ["이대로 열기", "버리기"], ago: ago(d.at), kind: "결정" });
    cardlist.push({ ts: "w:" + n, ref: "w:" + n, thread: null, channel: "primary", kind: "decision", area: "primary", state: "open", title: `「${cut(d.name, 40)}」 역할 창`, at: d.at / 1000 });
  }
  cardlist.sort((a, b) => a.at - b.at);
  const cardsdone = L.closedCards.filter(c => CARD_TS.test(String(c.id))).map(c => ({ ts: String(c.id), thread: String(c.id), channel: cardCh(String(c.win)), kind: c.kind === "todo" ? "todo" : "decision", area: "primary", state: "done", title: cut(String(c.question || ""), 80), at: Number(c.answered_at || c.at) / 1000 }));
  const feed = L.logs.filter(r => !OWN.test(r.win) && !inPrim(r) && r.kind !== "me").slice(0, 40).map(r => ({ id: r.id, ago: ago(r.at), pane: L.nodeOfWin(r.win)?.pane || PRIMARY, win: cut(r.win, 30), kind: KIND_KO[r.kind] || r.kind, msg: cut(r.text, 160) }));
  // 보관한 노드 이름(주인 D.archived 와 같은 꼴) — 찾기 · 타임라인 · 「보관」 띠가 씀
  const archived = ((await db.prepare("SELECT COALESCE(pinned_name, name) AS n FROM mnode WHERE owner = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT 300").bind(me).all<R>()).results).map(r => String(r.n || "노드"));
  // 약속(member_promise, 0047): 열린 것 = 주인 D.promises 꼴, 기한이 지난 것은 to_check(「지켰는지 확인」) — 표가 아직 없으면(이주 전) 빈 꼴
  const promPane = (w: string) => { const ew = L.engineNodes.find(x => x.name === w), p = ew ? paneOfId(ew.id) : ""; return p && known.has(p) ? p : toPane(w); };
  const { promises, to_check } = await promiseRows(db, me, promPane, nowMin);
  const seatName = new Map(L.nodes.filter(n => L.seatIds.has(n.id)).map(n => [n.id, L.seatRole.get(n.id)!]));
  const seatId = new Map([...seatName].map(([id, nm]) => [nm, id]));
  const seatOrder = L.roleNames.map((nm, i) => ({ nm, i })).sort((a, b) => rank(seatId.get(a.nm) || "") - rank(seatId.get(b.nm) || "") || a.i - b.i).map(x => x.nm);
  const dept = (id: string) => deptOf(id, { parents: L.parents, seatName, fields: tasks.get(id)?.fields, seats: L.roleNames });
  return { generated: kst(now), areas, panes, closed, parked, archived, decisions, to_check, promises, feed,
    park_metrics: { at: Math.floor(now / 60_000) * 60, open: panes.length, due: 0, overdue: 0, overdue_names: [], parked: parked.length, reopen_ok_24h: 0, reopen_fail_24h: 0, overdue_max_24h: 0 },
    cards: [], cardlist, cardsdone, attn: null, relinks: {}, ...nodeAliases(L.nodes), ...(L.taskChannels ? { task_channels: true, task_side: taskSide(L.nodes, tasks, lastAt, nowMin, L.roleNames.length ? dept : undefined) } : {}), ...(L.roleNames.length ? { role_seats: seatOrder } : {}), ...(L.tidy ? { tree_tidy: true } : {}), ...(L.agentsFold ? { agents_fold: true } : {}), ...(L.front ? { front_door: { name: L.front.name, pane: L.front.pane, aliases: L.front.aliases } } : {}), todos, bthreads: [], me_avatar: L.meFace || faceOf(String(me).toLowerCase()) };
}

// 업무 노드의 옛 채널 별칭 → 그 업무 판(채널 = 태스크를 켠 사람만 생김). 없으면 칸도 안 넣음(꺼진 사람의 판이 예전과 같게)
function nodeAliases(nodes: Node[]) {
  const m = Object.fromEntries(nodes.filter(n => !n.archived_at).flatMap(n => (n.aliases || []).flatMap(a => [[a.id, n.pane], [a.name, n.pane], [paneOfId(a.id), n.pane]])));
  return Object.keys(m).length ? { node_aliases: m } : {};
}
export const QUIET = new Set(["status", "start", "progress", "done"]);
function msg(r: R, my: string, mainName: string) {
  const mine = r.win === ME || r.kind === "me";   // me = 노드 채팅에서 내가 그 창에 넣은 글
  return { ts: tsOf(r.at, r.id), lid: Number(r.id) || 0, thread: null, who: mine ? "owner" : "agent", name: mine ? my : r.win === "보더" ? "보더" : mainName, board: false, text: String(r.text || ""), buttons: [], files: [], replies: 0, latest: null, rnames: [], reactions: [], owner: null, ...(QUIET.has(String(r.kind)) ? { quiet: true } : {}), ...(mine ? { src: String(r.text || "") } : {}) };
}
export const CARD_TS = /^\d{10}\.\d{6}$/;
export const TODO_DONE = "했어요";
export const TODO_DROP = "없앴어요 — 필요 없어졌어요";
export function nextMorning(now: number) {
  const k = now + 9 * 3600_000, day = Math.floor(k / 86_400_000) * 86_400_000, eight = day + 8 * 3600_000;
  return (k < eight ? eight : eight + 86_400_000) - 9 * 3600_000;
}
const replyTs = (c: R) => tsOf(Number(c.answered_at || c.at), Number(c.n));
export function cardMsg(c: R, said: R[] = [], my = ME) {   // said = 에이전트가 그 카드 스레드에 쓴 줄(boarder say · log)
  const conn = parseConnectKind(c.kind);   // 「연결하기」 카드(connect-card.ts): 단추가 답이 아니라 동의 모달 → 로그인 길 · 직접 쓰기 없음
  const buttons = conn ? json<string[]>(c.choices, []).map(label => ({ label, connect: { service: conn.service, label: conn.label, reconnect: conn.reconnect, title: titleOf(conn.service), reads: readsOf(conn.service), ...(!conn.reconnect && oauthApi(conn.service) ? { apiPreset: conn.service } : {}) } }))
    : [...json<string[]>(c.choices, []).map(label => ({ label })), ...(OWN.test(String(c.win)) ? [] : [{ label: "기타", other: true }])];   // 들여오기 질문은 고르기만
  const last = said.reduce((a, r) => Math.max(a, Number(r.at)), 0), ans = c.answer ? Number(c.answered_at || c.at) : 0;
  const latest = !said.length && !ans ? null : ans >= last ? replyTs(c) : tsOf(last, Number(said.find(r => Number(r.at) === last)!.id));
  return { ts: String(c.id), ...(Number(c.n) > 0 ? { lid: -Number(c.n) } : {}), thread: null, who: "agent", name: String(c.win), board: false, text: [c.question, c.body].filter(Boolean).join("\n\n"), buttons, files: [], replies: said.length + (c.answer ? 1 : 0), latest, rnames: c.answer ? [my] : [], reactions: [], owner: null, ...(c.state !== "open" ? { picked: String(c.answer || "·") } : {}) };
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
  return L.front && L.isPrimWin(win) ? L.front.name : L.nodeOfWin(win)?.name || L.engineNodes.find(w => w.name === win)?.name || L.nodes.find(n => n.name === win)?.name || win;
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
  const rs = (await db.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND thread IN (SELECT value FROM json_each(?)) ORDER BY at + 0, id LIMIT 2000").bind(me, JSON.stringify(roots.map(primaryThread))).all<R>()).results;
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
type Loaded = Awaited<ReturnType<typeof load>>;
const deskOf = (L: Loaded, n: Node) => { const m = L.mains.get(n.id); if (m) return m.replace(/^window:/, ""); const w = n.windows[0]; return w ? String(w.win || "") : ""; };
const isDesk = (L: Loaded, win: string, desk: string) => !!desk && (win === desk || L.keysOf(win).includes(desk));
const isReply = (r: R) => CARD_TS.test(String(r.thread || ""));   // 스레드 답 줄(뿌리 = 노드 글 또는 카드)
const inNode = (L: Loaded, n: Node, r: R) => L.nodeOfWin(r.win) === n || (r.kind === "me" && (r.win === n.name || !!n.aliases?.some(a => a.name === r.win)));
const nodeRows = (L: Loaded, n: Node, logs: R[] = L.logs) => logs.filter(r => !inPrim(r) && !OWN.test(r.win) && inNode(L, n, r));
const rowAt = (db: D1Database, me: string, ts: string) => { const [s, id] = ts.split("."); return db.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND id % 1000000 = ? AND at >= ? AND at < ? LIMIT 1").bind(me, Number(id), Number(s) * 1000, Number(s) * 1000 + 1000).first<R>(); };
const SCANNED = new Map<string, { sig: string; upto: number }>(), SCAN_MAX = 2000;
async function olderRows(db: D1Database, me: string, L: Loaded, n: Node) {
  if (L.logs.length < LOG_MAX) return { rows: [] as R[], done: () => {} };
  const wins = L.winsOf(n), sig = wins.join("\n"), k = me + "|" + n.id, was = SCANNED.get(k), from = was?.sig === sig ? was.upto : 0, oldest = Number(L.logs.at(-1)!.at);
  if (from >= oldest) return { rows: [] as R[], done: () => {} };
  const rows = (await db.prepare(`SELECT id, win, kind, text, thread, at, wid FROM board_log WHERE owner = ? ${NOT_CHAT} AND win IN (SELECT value FROM json_each(?)) AND at >= ? AND at <= ? ORDER BY at DESC LIMIT ${SCAN_MAX}`).bind(me, JSON.stringify(wins), from, oldest).all<R>()).results;
  return { rows, done: () => { if (SCANNED.size > 2000) SCANNED.clear(); SCANNED.set(k, { sig, upto: Number(L.logs[0].at) }); } };
}
export async function syncTaskConvo(db: D1Database, me: string, nodeId: string, L0?: Loaded) {
  if (!nodeId.startsWith("tk_")) return { added: 0, dup: 0 };
  const L = L0 || await load(db, me), n = L.byId.get(nodeId); if (!n) return { added: 0, dup: 0 };
  const desk = deskOf(L, n), key = nodeId.slice(3), older = await olderRows(db, me, L, n);
  const allCards = (await db.prepare("SELECT id, win, question, body, at FROM board_card WHERE owner = ? ORDER BY at DESC LIMIT 300").bind(me).all<R>()).results, cardIds = new Set(allCards.map(c => String(c.id)));
  // 스레드 답 줄도 넣음(카드 스레드 줄은 그 카드 글 아래 — 예전처럼 뺌). 층은 누가 썼나로 — 뿌리 층과 따로
  const rows: ConvoRow[] = nodeRows(L, n, [...L.logs, ...older.rows]).filter(r => !cardIds.has(String(r.thread || ""))).map(r => {
    const mine = r.kind === "me" || r.win === ME;
    return { layer: mine || !desk || isDesk(L, String(r.win), desk) ? "human" : "agents", who: mine ? me : String(r.win), at: Number(r.at), source: "board", text: String(r.text || ""), src_ref: "board_log:" + r.id, log: { id: Number(r.id), win: String(r.win), text: String(r.text || "") } };
  });
  for (const c of allCards.filter(c => CARD_TS.test(String(c.id)) && L.nodeOfWin(String(c.win)) === n)) rows.push({ layer: "human", who: String(c.win), at: Number(c.at), source: "card", text: [c.question, c.body].filter(Boolean).join("\n\n") || "·", src_ref: "card:" + c.id });
  const want = rows.filter(r => r.text);
  const have = want.length ? new Set((await db.prepare("SELECT src_ref FROM task_convo WHERE owner = ? AND task_id = ?").bind(me, key).all<{ src_ref: string }>()).results.map(x => x.src_ref)) : new Set<string>();
  const fresh = want.filter(r => !have.has(r.src_ref));
  const r = fresh.length ? await addRows(db, me, key, fresh) : { added: 0, dup: 0 };
  older.done();
  return { added: r.added, dup: r.dup + (want.length - fresh.length) };
}
const AGENTS_TS = /^\d{10}\.98\d{4}$/;
const hashOf = (s: string) => { let h = 0; for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return h % 10000; };
const tsAt = (at: number, tail: string) => `${String(Math.floor(at / 1000)).padStart(10, "0")}.${tail}`;
// 화면이 읽는 최근 줄 + 그 앞에 더 있는 줄 수 · 가장 옛 agents 줄 시각(수 · 접은 글 ts 는 표 전체로 — 600 을 넘어도 수가 맞고 새 줄마다 ts 가 안 바뀜)
const CONVO_MAX = 600;
type Older = { human: number; agents: number; first: number };
async function convoOf(db: D1Database, me: string, key: string) {
  const rows = (await db.prepare(`SELECT id, layer, who, at, source, text, src_ref FROM (SELECT * FROM task_convo WHERE owner = ? AND task_id = ? ORDER BY at DESC, id DESC LIMIT ${CONVO_MAX}) ORDER BY at, id`).bind(me, key).all<R>().catch(() => ({ results: [] as R[] }))).results;
  const older: Older = { human: 0, agents: 0, first: 0 };
  if (rows.length >= CONVO_MAX) for (const c of (await db.prepare("SELECT layer, COUNT(*) n, MIN(at) first FROM task_convo WHERE owner = ? AND task_id = ? GROUP BY layer").bind(me, key).all<R>()).results) {
    const l = String(c.layer) as "human" | "agents"; older[l] = Math.max(0, Number(c.n) - rows.filter(r => r.layer === l).length);
    if (l === "agents") older.first = Number(c.first);
  }
  return { rows, older };
}
const convoRowMsg = (r: R, my: string) => { const b = /^board_log:(\d+)$/.exec(String(r.src_ref || "")); return { ...msg({ id: 0, win: String(r.who), kind: "chat", text: String(r.text), at: Number(r.at) }, my, String(r.who)), ts: b ? tsOf(Number(r.at), Number(b[1])) : tsAt(Number(r.at), String(970000 + Number(r.id) % 10000)), lid: b ? Number(b[1]) : 0, layer: String(r.layer) }; };
// ts 끝 97xxxx 인 표 줄 하나(기기 줄 — 채널 글로 나오면 스레드 · 답글이 이 줄을 찾음)
const deviceRowAt = async (db: D1Database, me: string, key: string, ts: string) => {
  const m = /^(\d{10})\.97(\d{4})$/.exec(ts); if (!m) return null;
  const rows = (await db.prepare("SELECT id, layer, who, at, source, text, src_ref FROM task_convo WHERE owner = ? AND task_id = ? AND at >= ? AND at < ? AND id % 10000 = ? LIMIT 5").bind(me, key, Number(m[1]) * 1000, Number(m[1]) * 1000 + 1000, Number(m[2])).all<R>().catch(() => ({ results: [] as R[] }))).results;
  return rows.find(r => !RESERVED.test(String(r.src_ref))) || null;
};
// 화면에 보일 표 줄: 같은 글이 보드 줄 · 기기 줄로 둘이면(기기가 옛 저장소를 밀어 넣을 때) 기기 줄을 뺌 — 같은 층 · 같은 글 · 5분 안. 표 · 읽기 API 는 그대로 둘 다
const ECHO_MS = 5 * 60_000;
function convoView(conv: R[]) {
  const board = new Map<string, number[]>(), id = (r: R) => r.layer + "\n" + String(r.text).trim();
  for (const r of conv) if (RESERVED.test(String(r.src_ref))) (board.get(id(r)) || board.set(id(r), []).get(id(r))!).push(Number(r.at));
  return conv.filter(r => RESERVED.test(String(r.src_ref)) || !board.get(id(r))?.some(at => Math.abs(at - Number(r.at)) <= ECHO_MS));
}
// 「에이전트끼리」 접은 글 하나(없으면 null): 그 태스크 agents 층 줄이 그 글 스레드. ts = 첫 줄 초 + 98xxxx(노드 해시).
//   단, 스레드가 있는 줄은 접지 않음 — 스레드 안 글엔 답글 단추가 없어(화면 msgHTML) 답이 묻힘. 뿌리는 채널에 답글 수와 남고, 그 답 줄도 그 스레드에서만
//   away = 뿌리가 옆 노드 글인 답(태스크 창이 옆 노드 글 스레드에 쓴 것): main 처럼 옆 스레드에만 — 내 채널 · 접은 글에 또 안 냄. 뿌리가 지워졌으면 away 아님(보여야 답이 안 묻힘)
async function threadsOf(db: D1Database, me: string, L: Loaded, n: Node) {
  const logs = new Map(nodeRows(L, n).map(r => ["board_log:" + r.id, r]));
  const said = new Set([...logs.values()].filter(isReply).map(r => String(r.thread))), roots = new Set([...logs.values()].filter(r => !isReply(r)).map(r => tsOf(r.at, r.id)));
  const out = [...said].filter(t => !roots.has(t)), away = new Set<string>();
  for (let i = 0; i < out.length; i += 100) {
    const part = out.slice(i, i + 100), got = await db.batch(part.map(t => { const [s, id] = t.split("."); return db.prepare("SELECT id, win, kind, thread, at FROM board_log WHERE owner = ? AND id % 1000000 = ? AND at >= ? AND at < ? LIMIT 1").bind(me, Number(id), Number(s) * 1000, Number(s) * 1000 + 1000); }));
    part.forEach((t, j) => { const r = (got[j] as { results?: R[] }).results?.[0]; if (r && (inPrim(r) || !inNode(L, n, r))) away.add(t); });
  }
  // 뿌리를 접을지는 이 노드 줄만 보지 않음: 옆 태스크 창이 단 답도 답 — 접으면 답글 수도 단추도 없어 답이 어느 화면에도 안 보임(main 처럼 채널에 답글 수와 남김)
  const replied = new Set(L.logs.filter(isReply).map(r => String(r.thread)));
  return { logs, said, replied, roots, away };
}
type Threads = Awaited<ReturnType<typeof threadsOf>>;
function agentsFold(n: Node, conv: R[], older: Older, { logs, replied, roots, away }: Threads, my: string, mainName: string) {
  const ag = conv.filter(r => { if (r.layer !== "agents") return false; const b = logs.get(String(r.src_ref)); return !b || (isReply(b) ? !roots.has(String(b.thread)) && !away.has(String(b.thread)) : !replied.has(tsOf(b.at, b.id))); });
  if (!ag.length && !older.agents) return null;
  const at0 = older.agents ? older.first : Number(ag[0].at), total = ag.length + older.agents;
  const ts = tsAt(at0, String(980000 + hashOf(n.id)));
  const replies = ag.map(r => { const b = logs.get(String(r.src_ref)); return { ...(b ? msg(b, my, String(b.win)) : convoRowMsg(r, my)), thread: ts, ch: "primary", layer: "agents" }; });
  const names = [...new Set(ag.map(r => String(r.who)))];
  const text = `에이전트끼리 ${total} — 접어 뒀어요. 눌러서 펼쳐 봐요`;
  const root = { ...msg({ id: 0, win: "보더", kind: "chat", text, at: at0 }, my, mainName), ts, lid: 0, ch: "primary", replies: total, latest: replies.at(-1)?.ts ?? null, rnames: names.slice(0, 5), fold: { agents: total }, layer: "agents" };
  return { root, replies, refs: new Set(ag.map(r => String(r.src_ref))) };
}
// 노드 채팅의 태스크 두 겹: 맞춰 넣은 뒤 표를 읽어 agents 층 보드 줄은 접은 글로 빼고, 표에만 있는 human 줄은 글로 더함
async function taskLayers(db: D1Database, me: string, L: Loaded, n: Node, my: string, mainName: string) {
  if (!L.taskChannels || !n.id.startsWith("tk_")) return null;
  await syncTaskConvo(db, me, n.id, L).catch(e => console.error("태스크 대화 맞추기", e));
  const { rows, older } = await convoOf(db, me, n.id.slice(3)), conv = convoView(rows); if (!conv.length) return null;
  const th = await threadsOf(db, me, L, n), fold = agentsFold(n, conv, older, th, my, mainName), agents = conv.filter(r => r.layer === "agents").length;
  const { logs, roots, away } = th, orphan = (r: R) => { const b = logs.get(String(r.src_ref)); return !!b && isReply(b) && !roots.has(String(b.thread)) && !away.has(String(b.thread)); };
  const extra = conv.filter(r => r.layer === "human" && (!RESERVED.test(String(r.src_ref)) || orphan(r))).map(r => { const b = logs.get(String(r.src_ref)); return { at: Number(r.at), m: { ...(b ? msg(b, my, String(b.win)) : convoRowMsg(r, my)), ch: "n:" + n.name } }; });
  return { agentRefs: fold?.refs || new Set<string>(), extra, fold, counts: { human: conv.length - agents + older.human, agents: agents + older.agents } };
}
async function foldOf(db: D1Database, me: string, L: Loaded, ts: string, my: string, mainName: string) {
  if (!L.taskChannels) return null;
  const tail = Number(ts.slice(-4)), sec = Number(ts.split(".")[0]) * 1000, cand = L.nodes.filter(n => n.id.startsWith("tk_") && hashOf(n.id) === tail);
  if (!cand.length || await primaryRoot(db, me, ts)) return null;
  for (const n of cand) {
    const { rows, older } = await convoOf(db, me, n.id.slice(3)), f = agentsFold(n, convoView(rows), older, await threadsOf(db, me, L, n), my, mainName);
    if (f?.root.ts === ts) return { n, f };
    if (rows.length && !(await rowAt(db, me, ts)) && !(await cardBy(db, me, ts)) && await db.prepare("SELECT 1 FROM task_convo WHERE owner = ? AND task_id = ? AND layer = 'agents' AND at >= ? AND at < ? LIMIT 1").bind(me, n.id.slice(3), sec, sec + 1000).first()) return { n, f };
  }
  return null;
}
async function agentsThread(db: D1Database, me: string, ts: string, my: string, mainName: string) {
  const f = (await foldOf(db, me, await load(db, me), ts, my, mainName))?.f; if (!f) return null;
  return { channel: "primary", root: ts, owner: null, messages: await withReacts(db, me, [{ ...f.root, ts }, ...f.replies.map(m => ({ ...m, thread: ts }))] as R[]) };   // 낡은 ts 로 열어도 칸이 그 ts 로 이어짐
}
function peersOf(L: Loaded, rows: R[]) {
  if (!L.agentsFold) return new Set<string>();
  const ids = peerIds(rows.filter(r => !OWN.test(String(r.win))).map(r => ({ id: r.id, win: String(r.win), kind: String(r.kind), thread: r.thread, at: Number(r.at) })), ME);
  if (ids.size) { const rep = new Set(L.logs.filter(r => r.thread).map(r => String(r.thread))); for (const r of rows) if (ids.has(String(r.id)) && rep.has(tsOf(r.at, r.id))) ids.delete(String(r.id)); }
  return ids;
}
function peerFold(rows: R[], ids: Set<string>, key: string, ch: string, my: string, mainName: string) {
  const ag = rows.filter(r => ids.has(String(r.id))).sort((a, b) => Number(a.at) - Number(b.at) || Number(a.id) - Number(b.id));
  if (!ag.length) return null;
  const ts = peerTs(Number(ag[0].at), key);
  const replies = ag.map(r => ({ ...msg(r, my, String(r.win)), thread: ts, ch, layer: "agents", quiet: true }));
  const text = `에이전트끼리 ${ag.length} — 다른 에이전트와 주고받은 글을 접어 뒀어요. 눌러서 펼쳐 봐요`;
  const root = { ...msg({ id: 0, win: "보더", kind: "chat", text, at: Number(ag[0].at) }, my, mainName), ts, lid: 0, ch, replies: ag.length, latest: replies.at(-1)!.ts, rnames: [...new Set(ag.map(r => String(r.win)))].slice(0, 5), fold: { agents: ag.length }, layer: "agents", quiet: true };
  return { root, replies };
}
const peerThreadOf = (f: ReturnType<typeof peerFold>, ts: string, ch: string, home?: string) => ({ channel: ch, root: ts, owner: null, ...(home ? { home } : {}), messages: f ? [{ ...f.root, ts }, ...f.replies.map(m => ({ ...m, thread: ts }))] : [] });   // 낡은 ts 로 열어도 그 ts 로 이어짐
// 메인 봇 채팅의 접은 줄 = 앞단(front_door)으로 접은 노드 창들의 뿌리 줄(내 글 포함)
const frontPeerRows = (L: Loaded) => L.front && L.agentsFold ? L.logs.filter(r => !inPrim(r) && !OWN.test(String(r.win)) && !CARD_TS.test(String(r.thread || "")) && L.front!.wins.has(String(r.win))) : [];
//   L = 부르는 쪽이 이미 읽은 판(설정 agents_fold · 앞단이 켜진 사람만 읽음 — 끈 사람은 이 길에서 load 를 안 부름)
async function primaryPeerThread(db: D1Database, me: string, L: Loaded, ts: string, my: string, mainName: string) {
  if (!L.front || !L.agentsFold || !PEER_TS.test(ts) || peerTail(ts) !== peerKey(PRIMARY)) return null;
  if (await primaryRoot(db, me, ts) || await cardBy(db, me, ts) || await rowAt(db, me, ts)) return null;
  const rows = frontPeerRows(L);
  return peerThreadOf(peerFold(rows, peersOf(L, rows), PRIMARY, "primary", my, mainName), ts, "primary");
}
// 부서장 에이전트 칸(노드 채널)의 접은 줄 — 노드 채팅(/api/nodechat)과 같은 줄(카드 스레드 줄 빼고 최근 300)
function screenRows(L: Loaded, n: Node | null, ew: R | undefined) {
  return L.logs.filter(r => !inPrim(r) && !CARD_TS.test(String(r.thread || "")) && !OWN.test(String(r.win)) && (n ? inNode(L, n, r) : r.win === ew!.name)).slice(0, 300);
}
export const foldScreen = (L: Pick<Loaded, "agentsFold" | "agentScreen" | "taskChannels" | "seatIds">, n: Node) =>
  !!L.agentsFold && L.agentScreen(n) && !(L.taskChannels && n.id.startsWith("tk_") && !L.seatIds.has(n.id));
const screenOn = (L: Loaded, n: Node | null, ew: R | undefined) => L.agentsFold && (n ? foldScreen(L, n) : !!ew);
async function nodePeerThread(db: D1Database, me: string, L: Loaded, raw: string, ts: string, my: string, mainName: string, nodeId = "") {
  if (!L.agentsFold || !PEER_TS.test(ts)) return null;
  const t = raw.replace(/^\d+\s+/, "").trim(), n = L.resolveNode(raw, nodeId) || L.resolveNode(t) || null, ew = n ? undefined : L.engineNodes.find(x => x.name === raw || x.name === t);
  if ((!n && !ew) || !screenOn(L, n, ew) || peerTail(ts) !== peerKey(n ? n.id : String(ew!.id))) return null;
  if (await rowAt(db, me, ts) || await cardBy(db, me, ts)) return null;
  const rows = screenRows(L, n, ew);
  return peerThreadOf(peerFold(rows, peersOf(L, rows), n ? n.id : String(ew!.id), "n:" + raw, my, mainName), ts, "n:" + raw, n ? n.name : String(ew!.name));
}
// 태스크 채널 글로 나왔지만 뿌리가 아닌 줄(표에만 있는 기기 줄 · 뿌리가 밀린 답 줄)에 쓴 답글이 갈 곳: root = 그 뿌리 스레드(뿌리 · 카드가 그 태스크 것), root 없음 = 그 태스크 채널 글(뿌리가 지워졌거나 기기 줄). null = 이 길 아님(예전대로)
async function taskReplyHome(db: D1Database, me: string, channel: string, ts: string) {
  if (await nodeRoot(db, me, ts)) return null;
  const L = await load(db, me); if (!L.taskChannels) return null;
  const raw = channel.slice(2), t = raw.replace(/^\d+\s+/, "").trim(), n = L.resolveNode(raw) || L.resolveNode(t) || L.nodes.find(x => x.name === raw || x.name === t);
  if (!n?.id.startsWith("tk_")) return null;
  const r = await rowAt(db, me, ts);
  if (!r) return await deviceRowAt(db, me, n.id.slice(3), ts) ? { n } : null;
  if (!isReply(r) || OWN.test(String(r.win)) || !inNode(L, n, r)) return null;
  const up = String(r.thread), card = await cardBy(db, me, up);
  if (card) return L.nodeOfWin(String(card.win)) === n ? { n, root: up } : null;
  const root = await rowAt(db, me, up);
  return !root ? { n } : !root.thread && !OWN.test(String(root.win)) && inNode(L, n, root) ? { n, root: up } : null;
}
async function nodeThread(db: D1Database, me: string, raw: string, ts: string, my = ME, nodeId = "", climb = true, pre?: Loaded | null): Promise<R | null> {   // nodeId = 노드 번호(업무 화면 — 같은 이름 노드가 있어도 그 노드로). 내 노드 안에서만 찾음. pre = 같은 요청에서 이미 읽은 판(없으면 읽음)
  const t = raw.replace(/^\d+\s+/, "").trim(), L = pre || await load(db, me);
  const allNodes = [...L.nodes, ...(L.front?.nodes || [])], n = L.resolveNode(raw, nodeId) || L.resolveNode(t) || (nodeId ? allNodes.find(x => x.id === nodeId) : undefined) || allNodes.find(x => x.name === raw) || allNodes.find(x => x.name === t), ew = L.engineNodes.find(x => x.name === raw || x.name === t);
  if (!n && !ew) return null;
  const aliased = !!n && !!L.front?.nodes.includes(n), home = aliased ? L.front!.name : n ? n.name : String(ew!.name), ch = aliased ? "primary" : "n:" + raw;
  const mineWin = (win: string, kind?: string) => n ? L.nodeOfWin(win) === n || (kind === "me" && (win === n.name || n.aliases?.some(a => a.name === win))) : win === ew!.name;
  const card = await cardBy(db, me, ts);
  if (card) {
    if (!mineWin(String(card.win))) return null;
    const said = (await db.prepare("SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = ? ORDER BY at, id LIMIT 200").bind(me, ts).all<R>()).results;
    const replies = [...said.map(r => ({ at: Number(r.at), m: { ...msg(r, my, String(r.win)), thread: ts } })), ...(card.answer ? [{ at: Number(card.answered_at || card.at), m: cardReply(card, my) }] : [])].sort((a, b) => a.at - b.at).map(x => ({ ...x.m, ch }));
    return { channel: ch, root: ts, owner: null, home, messages: await withReacts(db, me, [{ ...cardMsg(card, said, my), ch }, ...replies]) };
  }
  const r = await rowAt(db, me, ts);
  // 태스크 채널(켠 사람만)에 글로 나온 줄 — 뿌리가 아니어도 스레드가 열려야 답장 단추가 헛돌지 않음: 기기 줄 = 그 줄 하나, 뿌리가 밀린 답 줄 = 그 뿌리 스레드(뿌리가 없거나 옆 노드면 그 줄 하나)
  if (n && L.taskChannels && n.id.startsWith("tk_")) {
    const d = r ? null : await deviceRowAt(db, me, n.id.slice(3), ts);
    if (d) return { channel: ch, root: ts, owner: null, home, messages: [{ ...convoRowMsg(d, my), ch }] };
    if (r && isReply(r) && !OWN.test(String(r.win)) && mineWin(String(r.win), String(r.kind))) return (climb ? await nodeThread(db, me, raw, String(r.thread), my, nodeId, false, L) : null) || { channel: ch, root: ts, owner: null, home, messages: await withReacts(db, me, [{ ...msg(r, my, String(r.win)), ch }]) };
  }
  if (!r || inPrim(r) || CARD_TS.test(String(r.thread || "")) || OWN.test(String(r.win)) || !mineWin(String(r.win), String(r.kind))) return null;
  const said = (await db.prepare("SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = ? ORDER BY at, id LIMIT 200").bind(me, ts).all<R>()).results;
  return { channel: ch, root: ts, owner: null, home, messages: await splitMarks(db, me, [{ ...withThread(msg(r, my, String(r.win)), said, my), ch }, ...said.map(x => ({ ...msg(x, my, String(x.win)), thread: ts, ch }))], my, L) };   // 나눠 온 몫 글이면 split_from
}
async function primaryRows(db: D1Database, me: string, before?: string, pre?: Awaited<ReturnType<typeof load>> | null) {
  const m = before ? /^(\d{10})\.(\d{6})$/.exec(before) : null, sec = m ? Number(m[1]) * 1000 : 0;
  const wins = [...(pre?.front?.wins || [])];
  const aliases = wins.length ? " OR (win IN (SELECT value FROM json_each(?)) AND (thread IS NULL OR thread = ''))" : "";
  return (await db.prepare(`SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? ${wins.length ? NOT_CHAT : ""} AND (thread = 'primary'${aliases})${m ? " AND (at < ? OR (at < ? AND id % 1000000 < ?))" : ""} ORDER BY at DESC, id DESC LIMIT 101`)
    .bind(me, ...(wins.length ? [JSON.stringify(wins)] : []), ...(m ? [sec, sec + 1000, Number(m[2])] : [])).all<R>()).results;
}

export async function paneRows(db: D1Database, me: string, pane: string) {
  return rowsOfPane(await load(db, me), pane).slice(0, 60).reverse().map(r => ({ id: r.id, at: Number(r.at) / 1000, kind: KIND_KO[r.kind] || r.kind, msg: cut(r.text, 400) }));
}
export function rowsOfPane(L: Awaited<ReturnType<typeof load>>, pane: string): R[] {
  const mine = (r: R) => r.kind !== "me" && !OWN.test(r.win);
  const n = L.nodes.find(x => x.pane === pane), ew = n ? null : L.engineNodes.find(x => paneOfId(x.id) === pane);
  return pane === PRIMARY ? L.logs.filter(r => inPrim(r) ? r.win !== ME && r.win !== "보더" : r.kind !== "me" && L.isPrimWin(String(r.win)))
    : n ? L.logs.filter(r => !inPrim(r) && mine(r) && L.nodeOfWin(r.win) === n)
    : ew ? L.logs.filter(r => !inPrim(r) && mine(r) && r.win === ew.name) : [];
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
  const rows = s.kind === "main" ? (await primaryRows(db, me, undefined, L)).filter(r => r.win !== "보더")
    : L.logs.filter(r => !inPrim(r) && !inCard(r) && !OWN.test(r.win) && (s.kind === "node" ? L.nodeOfWin(r.win) === s.node || (r.kind === "me" && r.win === s.node!.name) : r.win === s.ew!.name));
  const messages = rows.slice(0, 200).map(r => msg(r, my, s.kind === "main" ? mainName : String(r.win))).reverse();
  const live = !["closed", "failed", "gone", "parked", "done"].includes(String(s.state || ""));
  return { pane, name: s.kind === "main" ? (s.name || mainName) : s.name, state: s.state, messages, channel: "s:" + pane, live, stale_min: 0, more: false };   // kind(엔진 claude · codex)는 회원 쪽에서 확실히 모르니 안 넣음
}
export async function sessFolders(db: D1Database, me: string) {
  const rs = (await db.prepare("SELECT cwd, MAX(COALESCE(state_at, seen_at, 0)) at FROM imp_item WHERE owner = ? AND cwd != '' AND (gone_at IS NULL OR gone_at > ?) GROUP BY cwd ORDER BY at DESC LIMIT 40").bind(me, Date.now() - 30 * 86_400_000).all<{ cwd: string }>()).results;
  return rs.map(r => String(r.cwd)).filter(c => c.length <= 200 && !/[\x00-\x1f\x7f]/.test(c) && !c.split("/").includes("..")).map(path => ({ path, title: path.replace(/\/+$/, "").split("/").pop() || path }));
}
export async function folderOk(db: D1Database, me: string, folder: string) {
  return (await sessFolders(db, me)).some(f => f.path === folder);
}

export const CHAT_DIR = "~/boarder/chat";
export const CHAT_ID = /^ew_[a-z0-9]{6,30}$/;
export const NOT_CHAT = notChat("board_log");
/** 주인 server.py _chat_title 과 같음 — 제어 글자 · 빈칸을 한 칸으로, 28자 넘으면 「…」 */
export function chatTitle(text: string) {
  const t = Array.from(String(text || "").replace(/[\x00-\x1f\x7f]/g, " ").split(/\s+/).filter(Boolean).join(" "));
  return t.length > 28 ? t.slice(0, 28).join("") + "…" : t.join("") || "새 대화";
}
export const chatText = (v: unknown) => String(v ?? "").replace(/\r/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").trim().slice(0, 4000);
export async function chatOf(db: D1Database, me: string, sid: string) {
  if (!CHAT_ID.test(sid)) return null;
  return db.prepare("SELECT id, name, state, created_at FROM engine_window WHERE id = ? AND owner = ? AND kind = 'chat' AND state NOT IN ('closed','failed')").bind(sid, me).first<R>();
}
export const CHAT_MAX = 20;
export async function chatCount(db: D1Database, me: string) {
  return Number((await db.prepare("SELECT count(*) n FROM engine_window WHERE owner = ? AND kind = 'chat' AND state NOT IN ('closed','failed')").bind(me).first<{ n: number }>())?.n || 0);
}
export const chatRidKey = (rid: string, wid: string) => `${rid}.w.${wid}`;
export async function chatOfRid(db: D1Database, me: string, rid: string) {
  const k = await db.prepare("SELECT rid FROM f7_rid WHERE rid > ? AND rid < ? LIMIT 1").bind(rid + ".w.", rid + ".w/").first<{ rid: string }>();   // 앞붙임 범위(PK 색인) — LIKE 는 rid 의 _ 가 와일드카드
  const wid = k ? String(k.rid).slice(rid.length + 3) : "";
  return CHAT_ID.test(wid) ? db.prepare("SELECT id, name FROM engine_window WHERE id = ? AND owner = ? AND kind = 'chat'").bind(wid, me).first<R>() : null;
}
/** rid 잡기 — 새로 잡았거나 잡은 지 2분 넘게 창이 없으면(그 요청이 죽음) true */
export async function chatClaim(db: D1Database, rid: string, now = Date.now()) {
  const r = await db.prepare("INSERT INTO f7_rid(rid, at) VALUES (?1, ?2) ON CONFLICT(rid) DO UPDATE SET at = ?2 WHERE f7_rid.at < ?3").bind(rid, now, now - 120_000).run();
  return Number(r.meta?.changes || 0) > 0;
}
// GET /api/chats — 최근에 말한 것 먼저(주인 chats_get: last · at 차례), at = 연 때(초)
export async function chatList(db: D1Database, me: string) {
  const rs = (await db.prepare("SELECT w.id, w.name, w.created_at, (SELECT MAX(l.at) FROM board_log l WHERE l.wid = w.id AND l.owner = w.owner) AS last FROM engine_window w WHERE w.owner = ? AND w.kind = 'chat' AND w.state NOT IN ('closed','failed') ORDER BY COALESCE(last, w.created_at) DESC LIMIT 100").bind(me).all<R>()).results;
  return rs.map(r => ({ sid: String(r.id), title: String(r.name || "새 대화"), at: Number(r.created_at) / 1000 }));
}
const CHAT_BUSY = new Set(["opening", "starting", "busy"]);
export async function chatLog(db: D1Database, me: string, sid: string, now = Date.now()) {
  const w = await chatOf(db, me, sid); if (!w) return null;
  const rows = ((await db.prepare("SELECT id, kind, text, at FROM board_log WHERE owner = ? AND wid = ? AND kind NOT IN ('sys','status','role') ORDER BY at DESC, id DESC LIMIT 200").bind(me, sid).all<R>()).results).reverse();
  const last = rows.at(-1);
  // 답을 쓰는 중: 창이 일하는 중이거나, 마지막 줄이 내 글(아직 답 없음) — 10분 넘게 답이 없으면 점 셋을 거둠(턴 훅이 못 올린 때 끝없이 돌지 않게)
  const working = CHAT_BUSY.has(String(w.state)) || (!!last && last.kind === "me" && now - Number(last.at) < 10 * 60_000);
  return { messages: rows.map(r => ({ ts: tsOf(Number(r.at), Number(r.id)), who: r.kind === "me" ? "owner" : "agent", text: String(r.text || "") })), working, title: String(w.name || "새 대화") };
}

// 회원 GET — 보드 화면 길만. null = 이 길은 회원 보드 것이 아님(→ 403)
export async function etag(b: string) { return '"m' + [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(b)))].slice(0, 8).map(x => x.toString(16).padStart(2, "0")).join("") + '"'; }
const ETAG_PATHS = /^\/api\/(chat\/|nodechat$|topics$|inbox$)/;
export async function get(db: D1Database, me: string, bot: { name?: string } | null, url: URL, emoji: () => Promise<{ body: string; etag: string } | null>, inm?: string, who?: string | null | (() => Promise<string | null | undefined>), ctx?: Ctx | null, tv?: (() => Promise<string | null>) | null): Promise<Response | null> {
  inm = inm?.replace(/^W\//, "");
  const r = await getInner(db, me, bot, url, emoji, inm, who, ctx, tv);
  if (!r || r.status !== 200 || r.headers.has("etag") || !ETAG_PATHS.test(url.pathname) || !(r.headers.get("content-type") || "").startsWith("application/json")) return r;
  const txt = await r.text(), t = await etag(txt.replace(/"read_at":\d+,?/g, ""));
  const h = new Headers(r.headers); h.set("etag", t);
  return inm === t ? new Response(null, { status: 304, headers: h }) : new Response(txt, { status: 200, headers: h });
}
async function getInner(db: D1Database, me: string, bot: { name?: string } | null, url: URL, emoji: () => Promise<{ body: string; etag: string } | null>, inm?: string, who?: string | null | (() => Promise<string | null | undefined>), ctx?: Ctx | null, tv?: (() => Promise<string | null>) | null): Promise<Response | null> {
  // 내 이름(who): 글 이름이 나가는 채팅 길에서만 읽음 — 함수면 그때 한 번(index.ts 는 user 표를 읽는 함수로 넘김, /api/data 폴링엔 안 읽음)
  // 앞단 설정(front_door)은 채팅 · 노드 채팅 · 세션 길에서만 읽음(작은 읽기 하나 — /api/data 는 load 가 읽음)
  //   같은 한 줄에서 에이전트끼리 접기(agents_fold)도 봄 — 끈 사람은 접은 글 길에서 load 를 더 부르지 않음(읽기 수 main 과 같음)
  const nsd = /^\/api\/(chat\/primary|nodechat$|sesslog$)/.test(url.pathname) ? await settingData(db, me) : undefined;
  const fd = nsd === undefined ? null : frontDoorFromData(nsd), foldOn = !!fd && prefsOf(nsd).agents_fold;
  const p = url.pathname, mainName = fd?.name || bot?.name || "Primary", my = myName(me, typeof who === "function" ? (/^\/api\/(chat\/|nodechat$|sesslog$)/.test(p) ? await who().catch(() => null) : null) : who);
  const j = (o: unknown, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-boarder-src": "member" } });
  if (p === "/api/data") {   // 보드처럼 ETag — 안 바뀌면 빈 304(20초 폴링)
    const b = JSON.stringify(await data(db, me, bot, await loadRead(db, me, ctx))), t = await etag(b), h = { etag: t, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-boarder-src": "member" };
    return inm === t ? new Response(null, { status: 304, headers: h }) : new Response(b, { headers: { ...h, "content-type": "application/json; charset=utf-8" } });
  }
  if (p === "/api/topics") {
    const k = me.toLowerCase() + "\n" + (bot?.name || ""), now = Date.now(), ver = tv ? await tv().catch(() => null) : null, hit = ver ? topicsShare.get(k) : undefined;
    if (hit && hit.ver === ver && now - hit.at < TOPICS_TTL) return j(hit.v);
    const v = await topics(db, me, bot, await loadRead(db, me, ctx));
    if (ver) { if (topicsShare.size >= TOPICS_MAX) topicsShare.clear(); topicsShare.set(k, { at: now, ver, v }); }
    return j(v);
  }   // 노드 주제 칩 · 찾기 「노드」(member-views.ts — 주인 topics.py 꼴)
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
    return j({ pane: pk, rows: await paneRows(db, me, pk) });   // 주인 server.py pane_rows 와 같은 꼴(회원 · 주인 같은 길 ④)
  }
  let dp = p; try { dp = decodeURIComponent(p); } catch {}
  pm = /^\/api\/push\/resolve\/([\w:.-]{1,80})$/.exec(dp);
  if (pm) return j(await pushLoc(db, me, pm[1]));   // 알림을 누른 카드 → 글 자리(회원 푸시가 꺼져 있어도 — 켜진 때는 index.ts memberPushRoute 가 먼저 받음)
  if (/^\/api\/artowner\/[A-Za-z0-9]{16,40}$/.test(p)) return j({});
  if (/^\/api\/file\/[\w.-]{1,80}$/.test(p)) return j({ error: "없는 파일" }, 404);   // 회원 글엔 아직 첨부가 없음 — 403 대신 「없음」
  if (/^\/api\/permalink\//.test(p)) return j({ error: "회원 글엔 바깥 주소가 없어요" }, 404);
  if (/^\/api\/answer\/[\w-]{1,64}$/.test(p)) return j({ ok: true, state: "ok" });   // 회원 쓰기는 바로 끝나서 기다릴 일 없음
  if (p === "/emoji.json") { const e = await emoji(); return e ? new Response(e.body, { headers: { "content-type": "application/json; charset=utf-8", etag: e.etag } }) : j({ cats: [], e: {} }); }
  const nm = /^\/api\/chat\/n:(.{1,200})\/(\d{10}\.\d{6})$/.exec(dp);
  const nL = nm && PEER_TS.test(nm[2]) ? await loadRead(db, me, ctx) : null;
  if (nm && nL) { const f = await nodePeerThread(db, me, nL, nm[1], nm[2], my, mainName, String(url.searchParams.get("id") || "")); if (f) return j(f); }
  if (nm) return j(await nodeThread(db, me, nm[1], nm[2], my, String(url.searchParams.get("id") || ""), true, nL) ?? { channel: "n:" + nm[1], root: nm[2], owner: null, messages: [] });
  let m = /^\/api\/chat\/(\w+)(?:\/(\d{10}\.\d{6}))?$/.exec(p);
  if (m) {
    if (m[1] !== "primary") return j({ channel: m[1], messages: [], more: false, cursor: null, read_at: Math.floor(Date.now() / 1000), stale_min: 0 });
    if (m[2]) {
      const pL = foldOn && PEER_TS.test(m[2]) ? await loadRead(db, me, ctx) : null;
      if (pL) { const a = await primaryPeerThread(db, me, pL, m[2], my, mainName); if (a) return j(a); }
      if (AGENTS_TS.test(m[2])) { const a = await agentsThread(db, me, m[2], my, mainName); if (a) return j(a); }   // 태스크 「에이전트끼리」 접은 글
      if (FOLD_TS.test(m[2])) {
        const L = pL || await load(db, me), f = [...L.nodes, ...(L.front?.nodes || [])].map(n => convoFold(n, mainName, my)).find(x => x?.root.ts === m![2]);
        if (f) return j({ channel: "primary", root: m[2], owner: null, messages: [f.root, ...f.replies] });
      }
      const card = await cardBy(db, me, m[2]);
      if (card) {
        const said = (await db.prepare("SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = ? ORDER BY at, id LIMIT 200").bind(me, m[2]).all<R>()).results;
        const replies = [...said.map(r => ({ at: Number(r.at), m: { ...msg(r, my, String(r.win)), thread: m![2] } })), ...(card.answer ? [{ at: Number(card.answered_at || card.at), m: cardReply(card, my) }] : [])].sort((a, b) => a.at - b.at).map(x => ({ ...x.m, ch: "primary" }));
        const cL = foldOn ? pL || await loadRead(db, me, ctx) : null;   // 접기를 켠 사람만 판을 읽음(끈 사람은 main 처럼 load 없음)
        const cn = cL?.front && cL.agentsFold && cL.isPrimWin(String(card.win)) ? { name: mainName } : {};
        return j({ channel: "primary", root: m[2], owner: null, messages: await withReacts(db, me, [{ ...cardMsg(card, said, my), ch: "primary", ...cn }, ...replies]) });
      }
      const L = fd ? pL || await load(db, me) : null;
      for (const n of L?.front?.nodes || []) {
        const old = await nodeThread(db, me, n.name, m[2], my, n.id, true, L);
        if (old) return j(old);
      }
      const pr = await primaryRoot(db, me, m[2]);
      if (pr) {
        const said = (await primaryReplies(db, me, [m[2]])).get(m[2]) || [];
        return j({ channel: "primary", root: m[2], owner: null, messages: await splitMarks(db, me, [withPrimaryThread(msg(pr, my, mainName), said, mainName, my), ...said.map(r => ({ ...msg(r, my, mainName), thread: m![2] }))], my) });   // 나눈 글이면 갈래 칩
      }
      const rows = await db.prepare("SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = 'primary' AND id % 1000000 = ? AND at >= ? AND at < ?").bind(me, Number(m[2].split(".")[1]), Number(m[2].split(".")[0]) * 1000, Number(m[2].split(".")[0]) * 1000 + 1000).all<R>();
      return j({ channel: "primary", root: m[2], owner: null, messages: rows.results.map(r => msg(r, my, mainName)) });
    }
    const L = fd ? await load(db, me) : null, rows = await primaryRows(db, me, url.searchParams.get("before") || undefined, L), page = rows.slice(0, 100);
    const th = await primaryReplies(db, me, page.filter(r => r.win === ME).map(r => tsOf(r.at, r.id)));
    // 에이전트끼리 접기(켠 사람): 앞단 노드 창의 에이전트끼리 줄은 섞지 않고 맨 위 접힌 글 하나로 — 더 옛 쪽(before)에서도 빼고, 접은 글은 첫 쪽에만
    const pfRows = L ? frontPeerRows(L) : [], seenId = new Set(pfRows.map(r => String(r.id)));
    const pIds = L && pfRows.length ? peersOf(L, [...pfRows, ...page.filter(r => r.thread !== "primary" && !seenId.has(String(r.id)))]) : L?.front && L.agentsFold ? peersOf(L, page.filter(r => r.thread !== "primary")) : new Set<string>();
    const tagOf = (win: unknown) => { const t = L?.front?.from(String(win)); return t ? { tag: t } : {}; };
    const msgs = page.filter(r => !pIds.has(String(r.id))).map(r => r.thread === "primary" ? withPrimaryThread(msg(r, my, mainName), th.get(tsOf(r.at, r.id)), mainName, my) : { ...withThread(msg(r, my, mainName), threadReplies(L?.logs || [], tsOf(r.at, r.id)), my), ...tagOf(r.win) }).reverse();
    if (!url.searchParams.get("before") && L?.front) {
      for (const n of L.front.nodes) { const fold = convoFold(n, mainName, my); if (fold) msgs.unshift({ ...fold.root, tag: "옛 " + n.name }); }
      // 닫힌 카드도 옛 노드 채팅처럼 계속 보임. Primary 카드 스레드의 답/승인은 기존 길.
      const cards = (await db.prepare("SELECT rowid AS n, id, win, kind, question, choices, recommend, body, state, answer, answered_at, at FROM board_card WHERE owner = ? ORDER BY at DESC LIMIT 300").bind(me).all<R>()).results;
      msgs.push(...cards.filter(c => CARD_TS.test(String(c.id)) && L.isPrimWin(String(c.win))).map(c => ({ ...cardMsg(c, L.logs.filter(r => r.thread === c.id), my), ch: "primary", ...(L.agentsFold ? { name: mainName } : tagOf(c.win)) })));
    }
    if (L?.front) msgs.sort((a, b) => a.ts.localeCompare(b.ts));
    if (!url.searchParams.get("before") && L && pfRows.length) { const pf = peerFold(pfRows, pIds, PRIMARY, "primary", my, mainName); if (pf) msgs.unshift(pf.root); }
    await withReacts(db, me, msgs);
    await splitMarks(db, me, msgs, my);   // 나눈 내 글 = 갈래 칩(splits, 주인 owner-read splitMarks 꼴)
    return j({ channel: "primary", messages: msgs, more: rows.length > 100, cursor: page.length ? tsOf(page.at(-1)!.at, page.at(-1)!.id) : null, read_at: Math.floor(Date.now() / 1000), stale_min: 0 });
  }
  if (p === "/api/nodechat") {
    const raw = String(url.searchParams.get("w") || "").trim(), t = raw.replace(/^\d+\s+/, "").trim();
    if (!t) return j({ error: "노드 이름" }, 400);
    const byId = String(url.searchParams.get("id") || "");   // 업무 화면: 같은 이름 노드가 있어도 그 노드로(내 노드 안에서만)
    const L = await load(db, me);
    if (L.front && (byId ? L.front.nodes.some(n => n.id === byId) : L.front.aliases.includes(raw))) return get(db, me, bot, new URL("/api/chat/primary", url), emoji, undefined, my);
    const n = L.resolveNode(raw, byId) || L.resolveNode(t), ew = L.engineNodes.find(x => x.name === raw || x.name === t);
    const inCard = (r: R) => CARD_TS.test(String(r.thread || ""));
    const stuck = new Map(((await db.prepare("SELECT id, state, at FROM engine_cmd WHERE owner = ? AND verb IN ('send','reopen','assign') AND state IN ('queued','taken','sending','failed','waiting')").bind(me).all<R>()).results).filter(c => c.state === "failed" || c.state === "waiting" || Date.now() - Number(c.at) > 60_000).map(c => ["cmd:" + c.id, c.state === "waiting"]));
    const rows = L.logs.filter(r => !inPrim(r) && !inCard(r) && !OWN.test(r.win) && (n ? L.nodeOfWin(r.win) === n || (r.kind === "me" && (r.win === n.name || n.aliases?.some(a => a.name === r.win))) : ew ? r.win === ew.name : false)).slice(0, 300).reverse();
    // 카드 글은 답하거나 닫혀도 채널에 남음 — 할 일 목록(load)과 따로 읽음
    await closeStaleConnect(db, me);
    const cards = (await db.prepare("SELECT rowid AS n, id, win, kind, question, choices, recommend, body, state, answer, answered_at, at FROM board_card WHERE owner = ? ORDER BY at DESC LIMIT 300").bind(me).all<R>()).results
      .filter(c => CARD_TS.test(String(c.id)) && (n ? L.nodeOfWin(String(c.win)) === n : ew ? c.win === ew.name : false));
    const tl = n ? await taskLayers(db, me, L, n, my, mainName) : null;   // 업무 노드(채널 = 태스크): 에이전트끼리 줄은 접은 글 하나로
    // 에이전트끼리 접기(켠 사람 · 에이전트 화면 — 태스크 두 겹이 없는 칸): 다른 에이전트와 주고받은 줄은 맨 위 접힌 글 하나로
    const pRows = !tl && screenOn(L, n || null, ew) ? screenRows(L, n || null, ew) : null, peer = pRows ? peersOf(L, pRows) : null;
    const pf = pRows && peer?.size ? peerFold(pRows, peer, n ? n.id : String(ew!.id), "n:" + t, my, mainName) : null;
    const out = [...rows.filter(r => !tl?.agentRefs.has("board_log:" + r.id) && !peer?.has(String(r.id))).map(r => ({ at: Number(r.at), m: { ...withThread(msg(r, my, r.win), threadReplies(L.logs, tsOf(r.at, r.id)), my), ch: "n:" + (n?.name ?? (ew ? String(ew.name) : t)), ...(stuck.has(String(r.wid)) ? { dlv: { ok: false, ...(stuck.get(String(r.wid)) ? { waiting: true } : {}), to: String(n?.windows.find(w => w.win === r.win)?.title || n?.name || ew?.name || r.win) } } : {}) } })),
      ...cards.map(c => ({ at: Number(c.at), m: { ...cardMsg(c, L.logs.filter(r => r.thread === c.id), my), ch: "primary", ...(pRows ? { name: n?.name ?? String(ew!.name) } : {}) } })), ...(tl?.extra || [])]   // 에이전트 화면(접기 켬): 카드 글쓴이 = 그 에이전트 이름
      .sort((a, b) => a.at - b.at).slice(-300).map(x => x.m);
    const fold = n ? convoFold(n, mainName, my) : null;
    if (fold) out.unshift(fold.root);
    if (tl?.fold) out.unshift(tl.fold.root);
    if (pf) out.unshift(pf.root);
    await withReacts(db, me, out as R[]);
    await splitMarks(db, me, out as R[], my, L);   // Primary 에서 나눠 온 몫 글 = split_from(인용 상자)
    return j({ channel: "n:" + t, messages: out, stale_min: 0, more: false, ...(tl ? { layers: tl.counts } : {}) });
  }
  if (p === "/api/chats") return j({ chats: await chatList(db, me) });
  if (p === "/api/chatlog") { const r = await chatLog(db, me, url.searchParams.get("sid") || ""); return r ? j(r) : j({ error: "없는 대화예요" }, 404); }
  if (p === "/api/sesslog") { const s = await sessLog(db, me, url.searchParams.get("pane") || "", mainName, my); return s ? j(s) : j({ error: "없는 판" }, 404); }
  if (p === "/api/session/folders") return j({ folders: await sessFolders(db, me) });
  return null;
}

export type Hop = { path: string; body: unknown; log?: { win: string; text: string; ch?: string; thread?: string } } | { error: string; status: number } | { ok: R };
export async function post(db: D1Database, me: string, path: string, b: R): Promise<Hop> {
  loadForget(me);
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
  if (path === "/api/chat/new") {
    const text = chatText(b.text);
    if (!text) return { error: "첫 글이 없어요", status: 400 };
    return { path: "/api/me/chats/new", body: { text } };
  }
  if (path === "/api/chat/send") {
    const sid = String(b.sid || ""), text = chatText(b.text);
    if (!text) return { error: "내용을 적어요", status: 400 };
    if (!(await chatOf(db, me, sid))) return { error: "없는 대화예요", status: 404 };
    return { path: `/api/me/chats/${sid}/send`, body: { text } };
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
      const r = await db.prepare("DELETE FROM board_log WHERE owner = ? AND id % 1000000 = ? AND at >= ? AND at < ? AND (kind = 'me' OR win = ?) RETURNING id, wid").bind(me, Number(n), Number(s) * 1000, (Number(s) + 1) * 1000, ME).all<R>();
      if (!r.results.length) return { error: "내 글이 아니에요", status: 404 };
      for (const x of r.results) await dropRef(db, me, "board_log:" + x.id).catch(e => console.error("태스크 대화 지우기", e));   // 태스크 대화 표에 맞춰 넣은 그 줄도
      const cmd = /^cmd:(.+)$/.exec(String(r.results[0].wid || ""));
      if (cmd) await db.prepare("UPDATE engine_cmd SET state = 'failed', result = '글을 지움' WHERE id = ? AND owner = ? AND state = 'queued'").bind(cmd[1], me).run();   // 아직 안 넣은 글은 나중에 들어가지 않게
      return { ok: { ok: true, state: "ok" } };
    }
    if (b.react || b.edit !== undefined || b.label || (Array.isArray(b.files) && b.files.length)) return { error: "아직 안 돼요", status: 400 };
    const text = String(b.text || "").trim(); if (!text) return { error: "내용을 적어요", status: 400 };
    // 태스크 「에이전트끼리」 접은 글 스레드에 쓴 글 = 그 태스크 채널 글(그 담당 창으로, 들여온 대화 접은 글과 같음) — 예전: 판이 있으면 없는 스레드 404, 없으면 Primary 새 글로 메인 봇에 감
    if (AGENTS_TS.test(String(b.thread || ""))) {
      const x = await foldOf(db, me, await load(db, me), String(b.thread), ME, ME);
      if (x) return post(db, me, path, { ...b, thread: undefined, channel: "n:" + x.n.name, pane: x.n.pane });
    }
    // 태스크 채널에 글로 나온 기기 줄 · 뿌리가 밀린 답 줄에 쓴 답글 = 그 뿌리 스레드(없으면 그 태스크 채널 글)로 담당 창에 — 예전: 답장 단추가 있는데 「없는 스레드」 404
    if (/^n:/.test(String(b.channel || "")) && CARD_TS.test(String(b.thread || ""))) {
      const g = await taskReplyHome(db, me, String(b.channel), String(b.thread));
      if (g) return post(db, me, path, { ...b, thread: g.root, channel: "n:" + g.n.name, pane: g.n.pane });
    }
    const bk = /^w:(\d+)$/.exec(String((b.blocker as R | undefined)?.ref || ""));
    if (bk) return post(db, me, "/api/answer", { item: "w" + bk[1], text });
    let pane = String(b.pane || "");
    const FL = await readFrontDoor(db, me) ? await load(db, me) : null, alias = FL?.front && (pane && pane !== PRIMARY ? FL.front.nodes.some(n => n.pane === pane) : FL.front.aliases.includes(String(b.channel || "").replace(/^n:/, "")));
    if (alias && !b.thread) return { path: "/api/me/chat", body: { text } };
    if (/^n:/.test(String(b.channel || "")) && CARD_TS.test(String(b.thread || ""))) {
      const raw = String(b.channel).slice(2), t = raw.replace(/^\d+\s+/, "").trim(), L0 = await load(db, me);
      const oldNodes = [...L0.nodes, ...(L0.front?.nodes || [])], n0 = L0.resolveNode(raw) || L0.resolveNode(t) || oldNodes.find(x => x.name === raw) || oldNodes.find(x => x.name === t), e0 = n0 ? null : L0.engineNodes.find(x => x.name === raw || x.name === t);
      pane = n0 ? n0.pane : e0 ? paneOfId(e0.id) : pane;
    }
    if ((!pane || pane === PRIMARY) && b.thread && FL?.front) {
      const root = await nodeRoot(db, me, String(b.thread));
      const n = root ? FL.nodeOfWin(String(root.win)) : null;
      if (n && FL.front.nodes.includes(n)) pane = n.pane;
    }
    if (pane && pane !== PRIMARY) {
      const L = await load(db, me), n = [...L.nodes, ...(L.front?.nodes || [])].find(x => x.pane === pane);
      const root = CARD_TS.test(String(b.thread || "")) ? await nodeRoot(db, me, String(b.thread)) : null;
      const ew0 = n ? null : L.engineNodes.find(x => paneOfId(x.id) === pane);
      const chName = n ? n.name : ew0 ? String(ew0.name) : "";
      const inChan = (r: R) => n ? L.nodeOfWin(String(r.win)) === n || (r.kind === "me" && (r.win === n.name || n.aliases?.some(a => a.name === r.win))) : ew0 ? r.win === ew0.name : false;
      const thread = root && inChan(root) ? String(b.thread) : undefined;
      if (b.thread && !thread && !FOLD_TS.test(String(b.thread))) return { error: "없는 스레드예요", status: 404 };   // 들여온 대화 접은 글 스레드는 예전처럼 채널로
      const head = boardHead({ channel: chName, thread });
      if (n) {
        const w = L.agentUnit ? n.windows.find(x => x.key === L.mains.get(n.id)) || (n.id.startsWith("tk_") && !L.mains.get(n.id) ? n.windows[0] : undefined) : n.windows[0];
        if (!w) {
          if (n.id.startsWith("tk_")) return { path: "/api/me/tasks/assign", body: { node: n.id, text: withHead(head, text), ...(thread ? { thread } : {}) }, log: { win: n.name, text, ch: chName, ...(thread ? { thread } : {}) } };
          return { error: "이 노드엔 글을 넣을 창이 없어요", status: 404 };
        }
        const log = { win: String(w.win || n.name), text, ch: chName, ...(thread ? { thread } : {}) };   // ch = 머리 줄 채널(맨 위 글은 index.ts 가 내 글 줄을 먼저 남기고 그 글 id 를 머리에 실음)
        return { path: "/api/me/nodes/cmd", body: { verb: w.state === "parked" ? "reopen" : "send", item: w.key, text: withHead(head, text) }, log };
      }
      const ew = ew0;
      if (!ew) return { error: "없는 노드", status: 404 };
      return { path: `/api/me/windows/${ew.id}/say`, body: { text, head }, log: { win: String(ew.name), text, ch: chName, ...(thread ? { thread } : {}) } };
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
  if (path === "/api/split/move") return splitMove(db, me, String(b.post || ""), String(b.pane || ""));   // 갈래 칩 끌어 옮기기(주인 split_move_post 와 같은 몸통 · 답 { ok, splits }) — 내 몫 글 · 내 노드만, 아니면 404
  if (path === "/api/clientlog") {
    const f = (k: string, n = 160) => b[k] == null ? null : String(b[k]).slice(0, n);
    console.log(JSON.stringify({ ev: "client_error", member: true, where: f("where", 120), path: f("path", 100), method: f("method", 10), status: f("status", 10), rid: f("rid", 64), kind: f("kind", 10), page: f("page", 80), err: f("err"), client_at: Number(b.at) || null, late: !!(b.late || b.queued), late_s: Number(b.delay) >= 60000 ? Math.round(Number(b.delay) / 1000) : null, mark: Number(b.delay) > 1800000 ? "늦게 보냄" : null, quiet: !!b.quiet }));
    return { ok: { ok: true } };
  }
  if (path === "/api/todo") {   // 할 일 끝냄(틀 { area, id }) = 그 할 일 카드에 「했어요」로 답(카드를 낸 창에 넘어감 · 에이전트 wait 가 받음). drop: true 면 「없앴어요」로
    const id = String(b.id || b.ts || "");
    const c = CARD_TS.test(id) ? await db.prepare("SELECT id, state FROM board_card WHERE id = ? AND owner = ? AND kind = 'todo'").bind(id, me).first<{ id: string; state: string }>() : null;
    if (!c) return { error: "없는 할 일이에요", status: 404 };
    if (c.state !== "open") return { ok: { ok: true, state: "ok" } };   // 이미 끝냄(다시 보낸 것)
    return { path: `/api/me/cards/${c.id}/answer`, body: { choice: b.drop === true ? TODO_DROP : TODO_DONE, free: true } };
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
