export type Item = {
  key: string; kind: "window" | "session" | "thread" | "todo" | "task";
  engine?: string; title?: string; cwd?: string; repo?: string; branch?: string;
  refs?: string[]; state?: string; state_at?: number | null; win?: string; session?: string;
  seen_at: number; gone_at?: number | null;
  handle?: string | Record<string, unknown> | null;
};
export type Log = { win: string; kind: string; text: string; at: number };
export type Card = { id: string; win: string; state: string; question: string; at: number };
export type Prev = { item: string; node: string; how: string };
export type PrevNode = { id: string; name?: string | null; pinned_name?: string | null; counts?: string | null; created_at: number; updated_at?: number | null; archived_at?: number | null };
export type Node = {
  id: string; name: string; area: string; state: State; why: string; items: string[];
  counts: Record<string, number | string>; updated_at: number; created_at: number; archived: boolean;
};
export type TaskChannel = { id: string; name: string; issue: string; archived_at?: number | null };
export type Unit = "goal" | "agent";
export type State = "turn" | "blocked" | "working" | "idle" | "parked" | "done";
export type Audit = { items: number; nodes: number; missing: number; fixed: number; mixed: number; moved: number; empty: number; history: number; notes: string[] };

/** 회원 「세션」 칸 대화 창(engine_window kind 'chat')의 줄 · 카드는 노드 · 소식 · 찾기 밖(그 대화 화면에만) — board_log · board_card 둘 다 wid 로 가림.
 *  여기 둔 까닭: I/O 없는 이 파일은 member-board · importer/routes · member-search 가 다 읽음(서로 import 하면 돎) */
export const notChat = (t: "board_log" | "board_card") => `AND (${t}.wid IS NULL OR ${t}.wid NOT IN (SELECT id FROM engine_window WHERE owner = ${t}.owner AND kind = 'chat'))`;

const TRUNK = new Set(["", "main", "master", "develop", "dev", "trunk", "head", "staging", "production"]);
// 링크 하나가 너무 많은 곳에 나오면(채널 맨 위 글 · 공용 이슈) 묶는 이음으로 쓰지 않음
const REF_MAX = 6;
const ORDER: State[] = ["turn", "blocked", "working", "idle", "parked", "done"];
const LIVE_MS = 3 * 60_000;
const NOT_GOAL = [/\S@\S/, /^(?:(?:claude|codex|cursor|gemini)\s+)?[a-z]\s+\S+$/i, /^(?:claude|codex|cursor|gemini|터미널|terminal|agent)\s*·/i, /^(?:claude|codex|cursor|gemini)(?:-\w+)?$/i, /^\S+:\d+$/];
const TEST_NAME = /(?:^|[\s·_-])(?:시험|테스트|test|probe|smoke)(?:$|[\s·_:-])/i;

class DSU {
  p = new Map<string, string>();
  w = new Map<string, number>();
  find(a: string): string { let r = a; while (this.p.has(r) && this.p.get(r) !== r) r = this.p.get(r)!; let x = a; while (x !== r) { const n = this.p.get(x)!; this.p.set(x, r); x = n; } if (!this.p.has(r)) this.p.set(r, r); return r; }
  join(a: string, b: string, sameSession = false) {
    const x = this.find(a), y = this.find(b); if (x === y) return;
    const wx = this.w.get(x) || 0, wy = this.w.get(y) || 0; if (wx && wy && !sameSession) return;
    const [r, c] = x < y ? [x, y] : [y, x]; this.p.set(c, r); this.w.set(r, wx + wy);
  }
}

const short = (s: string, n = 60) => s.length > n ? s.slice(0, n - 1) + "…" : s;
const repoName = (r?: string) => (r || "").replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() || "";
const humanBranch = (b: string) => b.replace(/^(feat|fix|chore|claude|codex|cursor)[/-]/i, "").replace(/[-_/]+/g, " ").trim();
const base = (p?: string) => (p || "").split("/").filter(Boolean).pop() || "";
const goalName = (i: Item) => { const t = (i.title || "").trim(); return !!t && t !== base(i.cwd) && !NOT_GOAL.some(r => r.test(t)); };
const goalNo = (i: Item) => { const m = /#(\d{3,6})\b/.exec(i.title || ""); return m ? `${repoName(i.repo)}#${m[1]}` : ""; };
const openWindow = (i: Item) => i.kind === "window" && !i.gone_at && i.state !== "gone" && i.engine !== "report";

function keepsNode(its: Item[], logs: Log[], cards: Card[], pinned: boolean, now: number, archiveMs: number, tc = false) {
  const live = its.filter(i => !i.gone_at);
  if (cards.some(c => c.state === "open")) return true;
  if (pinned && live.length) return true;
  if (live.some(i => openWindow(i) && (!!i.session || goalName(i) || i.state === "working" || i.state === "question"))) return true;   // 세션도 일 이름도 없는 판(계정 이름만 있는 Herdr 판)은 노드가 아님
  if (live.some(i => i.kind === "task" && i.state !== "done")) return true;
  if (live.some(i => i.kind === "session" && (i.state === "working" || (!!i.state_at && now - i.state_at < LIVE_MS && i.state !== "idle")))) return true;
  if (its.some(i => i.kind === "window" && !!i.gone_at && now - i.gone_at < archiveMs)) return true;
  if (its.some(i => TEST_NAME.test(i.title || "") || TEST_NAME.test(i.win || ""))) return false;
  if (tc && live.some(i => i.engine === "report" && now - (i.seen_at || 0) < archiveMs)) return true;
  return !!logs[0] && now - logs[0].at < archiveMs;
}

const CLEVEL = "(?:CTO|CFO|CLO|COO|CISO|CMO|CPO|CIO|CSO|CDO)";
const ROLE = `(?:팀장|비서|담당|총괄|리드|supervisor|manager|assistant|lead|(?<![\\p{L}\\d])${CLEVEL}(?![\\p{L}\\d]))`;
const CLEVEL_TAIL = new RegExp(`(?<![\\p{L}\\d])${CLEVEL}$`, "iu");
const ROLE_AT_START = new RegExp(`^((?:[^\\s:,.?!]+\\s){0,2}[^\\s:,.?!]*${ROLE})(?=$|[\\s:,.?!]|세션|입니다)`, "iu");
const roleName = (t: string) => { const r = ROLE_AT_START.exec(t.trim())?.[1].replace(/^[a-z]\s+/i, "") || ""; return /^(새|다음)\s/.test(r) || (CLEVEL_TAIL.test(r) && !/[A-Z]{3,4}$/.test(r)) ? "" : r; };
/** strict: 세션 제목은 첫 질문이라 「CS 담당 찾아줘」도 역할처럼 보임 — 지시 머리([팀장 → …]) · 「… 세션입니다」 꼴 · 제목 전체일 때만 */
const cleanTitle = (title: string) => title.replace(/<[^>]*>/g, " ").replace(/\([^)]*\)/g, " ").replace(/#\d+/g, " ").replace(/^[#\s]+/, "").replace(/\s+/g, " ").trim();
const DISPATCH = /^\[([^\]→]+?)(?:\s+\d{1,2}:\d{2})?\s*(?:→\s*([^\]]*))?\]/;
const bySender = (title: string) => { const to = DISPATCH.exec(cleanTitle(title)); return !!to && !roleName(to[2] || "") && !!roleName(to[1]); };
export function roleOf(title: string, known: string[] = [], strict = false) {
  const t = cleanTitle(title);
  const fits = (r: string) => !strict || /^\s*(?:세션|입니다|[—:-]|$)/.test(t.slice(t.indexOf(r) + r.length));
  for (const k of known) if (k && t.includes(k) && fits(k)) return k;
  const to = DISPATCH.exec(t);   // [팀장 → 회의 녹음 담당] 지시 — 받는 쪽, 일반 말(새 담당)이면 시킨 쪽 일
  if (to) return roleName(to[2] || "") || roleName(to[1]);
  const r = roleName(t);
  return r && fits(r) ? r : "";
}
const homeDir = (c?: string) => !c || /^\/(?:Users|home)\/[^/]+\/?$/.test(c) || /^(?:\/private)?\/tmp(?:\/|$)/.test(c);
const toolFolder = (t = "") => /^(?:claude|codex|cursor|gemini)\s*·\s*(\S+)$/i.exec(t)?.[1] || "";
const folderOf = (i: Item) => repoName(i.repo) || (homeDir(i.cwd) ? "" : base(i.cwd)) || toolFolder(i.title);
const notWork = (i: Item) => TEST_NAME.test(i.title || "") || TEST_NAME.test(i.win || "") || (openWindow(i) && !i.session && !goalName(i) && i.state !== "working" && i.state !== "question");
/** 묶음(이어진 것들)마다 채널 이름. 역할 · 폴더가 없거나 시험 · 계정 판뿐이면 채널 없음 */
const FOLDER_MIN = 3;   // 역할 없는 폴더는 세션 셋 이상(열린 창은 셋으로 셈) 되풀이해 쓴 곳만 채널 — 한 번 들른 폴더 40개가 채널 40개가 되지 않게
const windowRole = (i: Item, known: string[]) => roleOf(i.title || "", known, i.kind === "session");
function agentChannels(items: Item[], root: (k: string) => string, known: string[], workLinks: string[][], recent: (i: Item) => boolean = openWindow, tc = false) {
  const comps = new Map<string, Item[]>();
  for (const i of items) if (i.kind !== "thread") { const r = root(i.key); (comps.get(r) || comps.set(r, []).get(r)!).push(i); }
  const roles = new Map<string, string>(), votes = new Map<string, Map<string, number>>(), weak = new Set<string>();
  const workWin = (i: Item) => recent(i) && !!goalNo(i) && !!goalName(i) && !TEST_NAME.test(i.title || "") && !/^\s*\[(?:시험|test)\]/i.test(i.title || "");
  const hasWork = (r: string) => (comps.get(r) || []).some(workWin);
  for (const [r, its] of comps) {
    const i = its.filter(i => i.kind === "window").concat(its).find(i => windowRole(i, known));
    if (!i) continue;
    if (bySender(i.title || "")) { if (hasWork(r)) continue; weak.add(r); }
    roles.set(r, windowRole(i, known));
  }
  for (const ks of workLinks) { const c = ks.map(root), own = c.find(r => roles.has(r) && !weak.has(r)) ?? c.find(r => roles.has(r)); if (own === undefined) continue;
    for (const r of c) if (!roles.has(r) && !(weak.has(own) && hasWork(r))) roles.set(r, roles.get(own)!); }
  const work = new Map<string, string>();
  for (const [r, its] of comps) {
    if (roles.has(r)) continue;
    const w = its.find(workWin);
    if (w) work.set(r, (w.title || "").replace(/\s+/g, " ").trim().slice(0, 60));
  }
  for (const [r, its] of comps) { const role = roles.get(r); if (role) for (const f of new Set(its.map(folderOf).filter(Boolean))) { const m = votes.get(f) || votes.set(f, new Map()).get(f)!; m.set(role, (m.get(role) || 0) + 1); } }
  const top = (m?: Map<string, number>) => [...(m || new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  const lead = (f: string) => top(votes.get(f));
  const all = new Map<string, number>(); for (const r of roles.values()) all.set(r, (all.get(r) || 0) + 1);
  const main = top(all);   // 폴더를 모르는 일 창(작업자 · 보고 창)은 가장 큰 에이전트의 일(채널 = 태스크를 켜지 않은 사람)
  const homes = new Set(items.map(i => /^\/(?:Users|home)\/([^/]+)/.exec(i.cwd || "")?.[1]).filter(Boolean));   // 「claude · alex」의 alex 는 폴더가 아니라 홈
  const out = new Map<string, string>(), reports = new Set<string>();
  for (const [r, its] of comps) {
    if (!roles.has(r) && its.every(notWork)) continue;
    // 채널 = 태스크(tc)만: 터미널 없는 보고자는 폴더의 주 에이전트에게 넘기지 않음. 업무 연결은 group의 taskOf, 그 밖에는 보낸 이름 그대로.
    const report = tc && its.every(i => i.engine === "report") ? its[0].title || "" : "";
    const f = its.map(folderOf).find(x => x && !homes.has(x)) || "";
    const ch = report || roles.get(r) || work.get(r) || (f && (lead(f) || f)) || (!tc && its.some(i => i.engine === "report") && main) || "";
    if (report) reports.add(report);
    if (ch) for (const i of its) out.set(i.key, ch);
  }
  const named = new Set([...roles.values(), ...work.values(), ...(tc ? items.filter(i => i.engine === "report").map(i => i.title || "") : [])]), weight = new Map<string, number>();
  for (const i of items) { const c = out.get(i.key); if (c && !named.has(c)) weight.set(c, (weight.get(c) || 0) + (openWindow(i) ? FOLDER_MIN : i.kind === "session" ? 1 : 0)); }
  for (const [k, c] of out) if (!named.has(c) && (weight.get(c) || 0) < FOLDER_MIN) out.delete(k);
  for (const c of [...roles.values(), ...work.values()]) reports.delete(c);   // 역할 · 일 번호 채널과 이름이 같으면 그 채널
  return { chan: out, roles: new Set(roles.values()), work: new Set(work.values()), reports };
}
function mainWindow(its: Item[], name: string, isRole: boolean, known: string[]) {
  const open = its.filter(openWindow).sort((a, b) => (a.key < b.key ? -1 : 1));
  if (!isRole) return open[0]?.key;
  const titles = new Map(its.filter(i => i.kind === "session").map(i => [i.key, i.title || ""]));
  return (open.find(i => roleOf(i.title || "", known) === name) || open.find(i => roleOf(titles.get(i.session || "") || "", known, true) === name))?.key;
}
/** 들여오기 때 고르기: 역할 이름이 셋 이상이면 에이전트마다 채널, 아니면 일마다 채널 */
export function pickUnit(items: Pick<Item, "title" | "kind">[], known: string[] = []): Unit {
  const named = items.filter(i => i.kind === "window" || i.kind === "task");   // 세션 제목은 첫 질문이라 고르는 근거로 안 씀
  return known.length >= 3 || new Set(named.map(i => roleOf(i.title || "", known)).filter(Boolean)).size >= 3 ? "agent" : "goal";
}

export const PRIMARY_NAME = /^(?:\d{1,3}[\s:.-]+)?(?:primary|main|메인(?:\s*봇)?|프라이머리)$/i;
const handleOf = (i: Pick<Item, "handle">): Record<string, unknown> => { const h = i.handle; if (!h) return {}; if (typeof h === "object") return h; try { const v = JSON.parse(h); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
export function canBePrimary(i: Pick<Item, "kind" | "gone_at" | "state" | "engine" | "handle">): boolean {
  if (i.kind !== "window" || i.gone_at || i.state === "gone" || i.engine === "report" || i.engine === "tmux") return false;
  return ["tmux-own", "herdr-own"].includes(String(i.engine || handleOf(i).engine || ""));
}
export function primaryScore(i: Item): number {
  if (!canBePrimary(i)) return 0;
  const h = handleOf(i);
  if (h.primary === true || h.primary === 1 || h.primary === "1") return 3;
  if ([i.title, h.name].some(v => typeof v === "string" && PRIMARY_NAME.test(v.trim()))) return 2;
  if (base(i.cwd) === "primary" || base(typeof h.cwd === "string" ? h.cwd : "") === "primary") return 1;
  return 0;
}
/** 들여온 것 중 메인 봇 자리인 창(없으면 null) */
export function primaryOf<T extends Item>(items: T[]): T | null {
  const c = items.map(i => ({ i, s: primaryScore(i) })).filter(x => x.s > 0);
  c.sort((a, b) => b.s - a.s || Number(b.i.state === "working") - Number(a.i.state === "working") || (b.i.state_at || b.i.seen_at || 0) - (a.i.state_at || a.i.seen_at || 0) || (a.i.key < b.i.key ? -1 : 1));
  return c[0]?.i || null;
}

export type PrimaryPick = "auto" | "none" | string;
export const pickOf = (v: unknown): PrimaryPick => typeof v === "string" && v.trim() && v.length <= 300 ? v.trim() : "auto";
export function primaryPick<T extends Item>(items: T[], pick: PrimaryPick | null | undefined, engineMain: boolean): { primary: T | null; explicit: boolean } {
  const p = pickOf(pick);
  if (p === "none") return { primary: null, explicit: false };
  if (p !== "auto") { const w = items.find(i => i.key === p && canBePrimary(i)) || null; return { primary: w, explicit: !!w }; }
  return { primary: engineMain ? null : primaryOf(items), explicit: false };
}

const nodeId = async (seed: string) => "n_" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)))].slice(0, 6).map(b => b.toString(16).padStart(2, "0")).join("");

export async function group(input: {
  items: Item[]; logs: Log[]; cards: Card[]; prev: Prev[]; prevNodes: PrevNode[];
  winNames?: Record<string, string>; now: number; archiveH?: number; unit?: Unit; agents?: string[]; engineMain?: boolean;
  primaryItem?: PrimaryPick | null;   // 설정 › 노드 「메인 봇 창」(primaryPick)
  taskChannels?: boolean;   // 설정 › 노드 「채널 = 태스크」(node_setting.data.task_channels) — 끄면(기본) 아래 tasks · reportRepo 는 안 씀, 묶기는 예전 그대로
  tasks?: TaskChannel[];
  reportRepo?: string;
  parkH?: number | null;
}): Promise<{ nodes: Node[]; map: Prev[]; audit: Audit; primary: string | null }> {
  const { now, unit } = input, agentUnit = unit === "agent", archiveMs = (input.archiveH ?? 6) * 3600_000, tc = input.taskChannels === true;
  // 이미 있는 업무(#번호)가 채널 — 켠 사람만
  const taskNodes = new Map(tc ? (input.tasks || []).filter(t => !t.archived_at).map(t => [t.id, t]) : []);
  const usedWins = new Set([...input.logs.map(l => l.win), ...input.cards.map(c => c.win)]);
  const onTask = new Set(tc ? input.prev.filter(p => taskNodes.has(p.node)).map(p => p.item) : []);
  const kept0 = input.items.filter(i => !i.gone_at || now - i.gone_at < archiveMs || (i.win && usedWins.has(i.win)) || onTask.has(i.key));
  const prim = primaryPick(kept0.filter(i => !(i as { rv?: unknown }).rv), input.primaryItem, !!input.engineMain).primary;   // 끊은 기기 창(rv)은 메인 봇이 될 수 없음   // 'auto' 면 보더 메인 봇 창이 이미 떠 있을 때 그게 메인 봇(들여온 primary 는 노드로 — 메인 봇이 둘이 되지 않게)
  const parkMs = parkMsOf(input.parkH);
  const primSess = prim?.session || "", primWins = new Set(prim?.win ? [prim.win] : []);
  const items = kept0.filter(i => !prim || !(i.key === prim.key || (primSess && (i.key === primSess || i.session === primSess)) || (i.win && primWins.has(i.win))));
  const byKey = new Map(items.map(i => [i.key, i]));
  const notes: string[] = [];

  const winOwner = new Map<string, string>();
  for (const i of items) if (i.win && (i.kind === "window" || !winOwner.has(i.win))) winOwner.set(i.win, i.key);
  let fixed = 0;
  const prevById = new Map(input.prevNodes.map(n => [n.id, n]));
  const oldReports = new Map<string, number>();
  if (tc) for (const p of input.prev) {
    if (!p.item.startsWith("win:")) continue;
    const n = prevById.get(p.node);
    if (n ? !n.archived_at && now - (n.updated_at || 0) < archiveMs : taskNodes.has(p.node)) oldReports.set(p.item.slice(4), n?.updated_at || 0);
  }
  for (const w of new Set([...input.logs.map(l => l.win), ...input.cards.map(c => c.win), ...oldReports.keys()].filter(Boolean))) {
    if (winOwner.has(w) || primWins.has(w)) continue;
    const key = `win:${w}`, last = Math.max(oldReports.get(w) || 0, ...input.logs.filter(l => l.win === w).map(l => l.at), ...input.cards.filter(c => c.win === w).map(c => c.at));
    const it: Item = { key, kind: "window", engine: "report", title: input.winNames?.[w] || w.split(":").slice(1).join(":") || w, win: w, state: "", seen_at: last };
    items.push(it); byKey.set(key, it); winOwner.set(w, key); fixed++;
  }

  const d = new DSU();
  for (const i of items) { d.find(i.key); if (i.kind === "window" && !i.gone_at && i.state !== "gone") d.w.set(i.key, 1); }
  // ① 이음
  const sessKeys = new Set(items.filter(i => i.kind === "session").map(i => i.key));
  for (const i of items) if (i.session && i.session !== i.key && (sessKeys.has(i.session) || byKey.has(i.session))) d.join(i.key, i.session);
  const bySession = new Map<string, string>();
  if (tc) for (const i of items) {
    const h = handleOf(i), sid = i.session || (h.tool === "claude" && typeof h.session_id === "string" && h.session_id ? `session:claude:${h.session_id}` : "");
    if (!sid) continue;
    const first = bySession.get(sid);
    if (first) d.join(first, i.key, true); else bySession.set(sid, i.key);
  }
  if (!tc) {
    const liveBy = new Map<string, string>();
    const sidOf = (i: Item) => i.session || "";
    for (const i of items) if (i.kind === "window" && d.w.has(i.key) && sidOf(i) && !liveBy.has(sidOf(i))) liveBy.set(sidOf(i), i.key);
    for (const i of items) if (i.kind === "window" && !d.w.has(i.key) && sidOf(i) && liveBy.has(sidOf(i))) d.join(liveBy.get(sidOf(i))!, i.key);
  }
  const byWin = new Map<string, string>();
  for (const i of items) if (i.win) { if (byWin.has(i.win)) d.join(byWin.get(i.win)!, i.key); else byWin.set(i.win, i.key); }
  // 같은 일 번호(같은 리포)
  const byNo = new Map<string, string>();
  const workLinks = new Map<string, string[]>();   // 에이전트마다 채널: 일 이음은 묶음을 잇지 않고 역할 없는 쪽을 맡은 역할로 보내는 데만 씀
  const link = (k: string, key: string) => (workLinks.get(k) || workLinks.set(k, []).get(k)!).push(key);
  if (unit) for (const i of items) { const n = goalNo(i); if (n) { if (agentUnit) link(`no:${n}`, i.key); else if (byNo.has(n)) d.join(byNo.get(n)!, i.key); else byNo.set(n, i.key); } }
  const refUse = new Map<string, string[]>();
  for (const i of items) for (const r of new Set(i.refs || [])) (refUse.get(r) || refUse.set(r, []).get(r)!).push(i.key);
  const refLinks: string[][] = [];
  for (const [r, ks] of refUse) {
    const thread = `thread:${r}`;
    const users = ks.filter(k => k !== thread);
    if (users.length > REF_MAX) { notes.push(`이음 「${short(r, 40)}」 은 ${users.length}곳에 나와 묶지 않음`); continue; }
    refLinks.push(ks);
  }
  const rb = new Map<string, string>();
  for (const i of items) {
    const b = (i.branch || "").trim();
    if (!i.repo || TRUNK.has(b.toLowerCase())) continue;
    const k = `${i.repo}\u0000${b}`;
    if (agentUnit) link(`br:${k}`, i.key); else if (rb.has(k)) d.join(rb.get(k)!, i.key); else rb.set(k, i.key);
  }
  const named = new Set(unit === "goal" ? items.filter(i => openWindow(i) && goalName(i)).map(i => d.find(i.key)) : []);
  if (!agentUnit) for (const ks of refLinks) for (const k of ks) {
    const x = d.find(ks[0]), y = d.find(k);
    if (x === y || (named.has(x) && named.has(y))) continue;
    d.join(x, y);
    if (named.has(x) || named.has(y)) named.add(d.find(x));
  }
  // 사람이 옮긴 것(pin)은 그 노드 자리에 붙음 — 다른 이음보다 이김: pin 된 것은 자기 묶음에서 떼어 노드 자리로
  const pins = new Map(input.prev.filter(p => p.how === "pin" && byKey.has(p.item)).map(p => [p.item, p.node]));
  const { chan, roles: roleChans, work: workChans, reports: reportChans } = agentUnit ? agentChannels(items, k => d.find(k), input.agents || [], [...workLinks.values()], i => openWindow(i) || (i.kind === "window" && i.engine !== "report" && !!i.gone_at && now - i.gone_at < archiveMs), tc) : { chan: new Map<string, string>(), roles: new Set<string>(), work: new Set<string>(), reports: new Set<string>() };
  if (agentUnit) for (const ks of refLinks) { const c = ks.map(k => chan.get(k)).find(Boolean); if (c) for (const k of ks) if (k.startsWith("thread:") && !chan.has(k)) chan.set(k, c); }
  const follow = new Map<string, string>();
  const comps = new Map<string, Item[]>();
  for (const i of items) { const r = d.find(i.key); (comps.get(r) || comps.set(r, []).get(r)!).push(i); }
  const taskOf = new Map<string, string>();
  const repoPath = (s = "") => s.replace(/\.git$/, "").replace(/^.*github\.com[:/]/i, "").replace(/^https?:\/\//, "").toLowerCase();
  const matchTask = (i: Item) => {
    if (TEST_NAME.test(i.title || "") || /^\s*\[(시험|test)\]/i.test(i.title || "")) return [];
    const no = /#(\d{1,8})\b/.exec(i.title || "")?.[1]; if (!no) return [];
    return [...taskNodes.values()].filter(t => {
      const m = /^(?:([\w.-]+\/[\w.-]+))?#?(\d{1,8})$/.exec(t.issue);
      const repo = repoPath(i.repo || (i.engine === "report" ? input.reportRepo : ""));
      return m && m[2] === no && (m[1] ? repo === m[1].toLowerCase() : i.engine === "report" && !repo);
    });
  };
  if (tc) for (const [r, its] of comps) {
    const pinnedWins = its.filter(i => i.kind === "window" && pins.has(i.key));
    if (pinnedWins.length) {
      for (const w of pinnedWins) if (w.session) for (const i of its) if (!pins.has(i.key) && (i.key === w.session || i.session === w.session)) follow.set(i.key, pins.get(w.key)!);   // 그 세션 · 같은 세션을 이어 연 창
      continue;
    }
    const rest = its.filter(i => !pins.has(i.key));
    const windows = rest.filter(i => i.kind === "window");
    const matches = new Set((windows.length ? windows : rest).flatMap(matchTask).map(t => t.id));
    // 제목에서 번호가 빠져도 이미 그 업무에 있던 같은 대화는 그대로. 완료 업무는 후보 밖.
    const previous = new Set(rest.flatMap(i => input.prev.filter(p => p.item === i.key && taskNodes.has(p.node)).map(p => p.node)));
    const ids = matches.size ? matches : previous;
    if (ids.size === 1) taskOf.set(r, [...ids][0]);
  }
  if (tc && agentUnit) for (const ks of refLinks) {
    const ids = new Set(ks.map(k => taskOf.get(d.find(k))).filter(Boolean));
    if (ids.size === 1) for (const k of ks) if (byKey.get(k)?.kind === "thread") taskOf.set(d.find(k), [...ids][0]!);
  }
  const groups = new Map<string, string[]>();
  for (const i of items) {
    const tid = taskOf.get(d.find(i.key));
    const g = pins.has(i.key) ? `pin:${pins.get(i.key)}` : follow.has(i.key) ? `pin:${follow.get(i.key)}` : tid ? `task:${tid}` : chan.has(i.key) ? `agent:${chan.get(i.key)}` : d.find(i.key);
    (groups.get(g) || groups.set(g, []).get(g)!).push(i.key);
  }
  const pinTargets = new Set(pins.values());

  // ② 노드 id 이어받기: 묶음 안 것들이 지난번 가장 많이 있던 노드(큰 묶음부터), 없으면 새 id
  const prevOf = new Map(input.prev.map(p => [p.item, p.node]));
  const prevNodes = new Map(input.prevNodes.map(n => [n.id, n]));
  const used = new Set<string>();
  const owned = new Map<string, string>();   // 묶음 키 → 이어받을 id
  {
    const fresh = [...input.prevNodes].sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at) || b.created_at - a.created_at);
    const mainOf = new Map<string, string>(); for (const n of fresh) { try { const m = JSON.parse(n.counts || "{}")?.main; if (typeof m === "string" && m && !mainOf.has(m)) mainOf.set(m, n.id); } catch {} }
    const byName = new Map<string, string>();
    for (const n of [...input.prevNodes].sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at) || a.created_at - b.created_at)) {
      for (const nm of [n.pinned_name, n.name].map(x => String(x || "").trim())) if (nm && !byName.has(nm)) byName.set(nm, n.id); }
    const cand: { g: string; id: string; s: number; role: number; size: number }[] = [];
    for (const [g, keys] of groups) {
      if (!g.startsWith("agent:")) continue;
      const nm = g.slice(6), its = keys.map(k => byKey.get(k)!).filter(Boolean), role = roleChans.has(nm) ? 1 : 0;
      for (const k of keys) { const id = mainOf.get(k); if (id) cand.push({ g, id, s: 3, role, size: keys.length }); }
      const byN = byName.get(nm); if (byN) cand.push({ g, id: byN, s: 2, role, size: keys.length });
      const mw = mainWindow(its, nm, !!role, input.agents || []), pv = mw && prevOf.get(mw); if (pv) cand.push({ g, id: pv, s: 1, role, size: keys.length });
    }
    cand.sort((a, b) => b.s - a.s || b.role - a.role || b.size - a.size || (a.g < b.g ? -1 : a.g > b.g ? 1 : a.id < b.id ? -1 : 1));
    const taken = new Set<string>();
    for (const c of cand) if (!(tc && c.id.startsWith("tk_") && !taskNodes.has(c.id)) && !owned.has(c.g) && !taken.has(c.id)) { owned.set(c.g, c.id); taken.add(c.id); }
  }
  const reserved = new Set(owned.values());
  const ordered = [...groups.entries()].sort((a, b) => Number(owned.has(b[0])) - Number(owned.has(a[0])) || b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const nodeOf = new Map<string, string[]>();
  const chanName = new Map<string, string>();
  let moved = 0;
  for (const [g, keys] of ordered) {
    let id = g.startsWith("task:") ? g.slice(5) : g.startsWith("pin:") ? g.slice(4) : owned.get(g) && !used.has(owned.get(g)!) ? owned.get(g)! : "";
    if (!id) {
      const votes = new Map<string, number>();
      for (const k of keys) { const n = prevOf.get(k); if (n) votes.set(n, (votes.get(n) || 0) + 1); }
      // 채널 하나 = 노드 하나: 사람이 옮겨 넣은 노드라도 다른 채널이 차지했으면 안 씀
      const best = [...votes.entries()].filter(([n]) => !(tc && n.startsWith("tk_") && !taskNodes.has(n)) && !reserved.has(n) && (!used.has(n) || (pinTargets.has(n) && !(g.startsWith("agent:") && chanName.has(n))))).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      id = best ? best[0] : await nodeId(keys.slice().sort()[0]);
      while (used.has(id) && (!pinTargets.has(id) || chanName.has(id))) id = await nodeId(id + "+");
    }
    used.add(id);
    if (g.startsWith("agent:")) chanName.set(id, g.slice(6));
    (nodeOf.get(id) || nodeOf.set(id, []).get(id)!).push(...keys);
    for (const k of keys) { const was = prevOf.get(k); if (was && was !== id) moved++; }
  }

  // ③ 상태 · 이름 · 영역
  const nodes: Node[] = [];
  const history: string[] = [];
  let mixed = 0;
  for (const [id, keys] of nodeOf) {
    const its = keys.map(k => byKey.get(k)!).filter(Boolean);
    const wins = new Set(its.map(i => i.win).filter(Boolean) as string[]);
    const logs = input.logs.filter(l => wins.has(l.win)).sort((a, b) => b.at - a.at);
    const cards = input.cards.filter(c => wins.has(c.win));
    const counts: Record<string, number | string> = { window: 0, session: 0, thread: 0, todo: 0, task: 0, log: logs.length, card: cards.filter(c => c.state === "open").length };
    for (const i of its) if (!i.gone_at) counts[i.kind] = Number(counts[i.kind] || 0) + 1;
    const live = its.filter(i => !i.gone_at);
    const repos = new Set(live.map(i => repoName(i.repo)).filter(Boolean));
    if (repos.size > 1) mixed++;
    const pn = prevNodes.get(id);
    const updated = Math.max(0, ...its.map(i => i.state_at || i.seen_at || 0), ...logs.map(l => l.at), ...cards.map(c => c.at));
    const pinned = !!pn?.pinned_name || keys.some(k => pins.get(k) === id);
    const keep = taskNodes.has(id) || (!unit ? !(!live.length && counts.card === 0 && now - updated > archiveMs) : (chanName.has(id) && !workChans.has(chanName.get(id)!) && !reportChans.has(chanName.get(id)!)) || keepsNode(its, logs, cards, pinned, now, archiveMs, tc));
    if (!keep && !pn && unit) { history.push(...keys); continue; }   // 노드가 된 적 없는 지난 세션 · 스레드는 기록으로만
    const st = keep || !unit ? stateOf(live, logs, cards, now, parkMs) : { state: "done" as State, why: logs[0] ? short(logs[0].text, 80) : "열린 창 없음" };
    // 다시 연 노드(pinned_name)는 마지막 줄이 「끝」이어도 트리에 있음
    const s = unit && keep && st.state === "done" && pn?.pinned_name ? { ...st, state: "idle" as State } : st;
    const name = taskNodes.get(id)?.name || pn?.pinned_name || chanName.get(id) || (unit ? nameOf(its) : oldNameOf(its));
    const area = [...repos][0] || (() => { const c = live.find(i => i.cwd)?.cwd || ""; return c.split("/").filter(Boolean).pop() || ""; })() || "기타";
    const archived = !keep;
    if (agentUnit) { const c = chanName.get(id), m = mainWindow(its, c || "", !!c && roleChans.has(c), input.agents || []); if (m) counts.main = m; }
    nodes.push({ id, name, area, state: s.state, why: s.why, items: keys, counts, updated_at: updated, created_at: pn?.created_at || now, archived });
  }
  nodes.sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || b.updated_at - a.updated_at);
  const map: Prev[] = [];
  for (const n of nodes) for (const k of n.items) map.push({ item: k, node: n.id, how: pins.get(k) === n.id ? "pin" : "auto" });
  const empty = input.prevNodes.filter(n => !nodeOf.has(n.id) && !n.archived_at).length;
  const assigned = new Set(map.map(m => m.item));
  const kept = new Set(history);
  const missing = items.filter(i => !assigned.has(i.key) && !kept.has(i.key)).length;
  return { nodes, map, primary: prim?.key ?? null, audit: { items: items.length, nodes: nodes.filter(n => !n.archived).length, missing, fixed, mixed, moved, empty, history: history.length, notes: notes.slice(0, 8) } };
}

/** 고르기 전(unit 없음) 이름 — 고른 적 없는 사람의 노드 이름이 배포만으로 바뀌지 않게 */
function oldNameOf(its: Item[]): string {
  const pick = (k: Item["kind"]) => its.filter(i => i.kind === k && i.title && !i.gone_at).sort((a, b) => (b.state_at || b.seen_at) - (a.state_at || a.seen_at))[0]?.title;
  const br = its.map(i => i.branch || "").find(b => b && !TRUNK.has(b.toLowerCase()));
  return short((pick("task") || its.find(i => i.kind === "window" && i.engine !== "report" && i.title)?.title || (br && humanBranch(br)) || pick("session") || pick("thread") || pick("window") || its[0]?.title || "이름 없는 일").replace(/^(\d+\s)/, "#$1"), 60);
}

function nameOf(its: Item[]): string {
  const pick = (k: Item["kind"]) => its.filter(i => i.kind === k && i.title && !i.gone_at).sort((a, b) => (b.state_at || b.seen_at) - (a.state_at || a.seen_at))[0]?.title;
  const br = its.map(i => i.branch || "").find(b => b && !TRUNK.has(b.toLowerCase()));
  const goal = its.filter(i => i.kind === "session" && !i.gone_at && goalName(i)).sort((a, b) => (b.state_at || b.seen_at) - (a.state_at || a.seen_at))[0]?.title;
  return short((pick("task") || its.find(i => i.kind === "window" && i.engine !== "report" && goalName(i))?.title || (br && humanBranch(br)) || goal || pick("thread") || its.find(i => i.kind === "window" && goalName(i))?.title || pick("session") || pick("window") || its[0]?.title || "이름 없는 일").replace(/^(\d+\s)/, "#$1"), 60);
}

export function stateOf(live: Item[], logs: Log[], cards: Card[], now: number, parkMs: number = PARK_QUIET_MS): { state: State; why: string } {
  const open = cards.filter(c => c.state === "open").sort((a, b) => b.at - a.at);
  if (open.length) return { state: "turn", why: short(open[0].question, 80) };
  const q = live.find(i => i.state === "question");
  if (q) return { state: "turn", why: `${short(q.title || "창", 40)} 이 묻고 있어요` };
  const last = logs[0];
  if (last && (last.kind === "blocked" || last.kind === "incident")) return { state: "blocked", why: short(last.text, 80) };
  const work = live.find(i => (i.kind === "window" || i.kind === "session") && (i.state === "working" || (i.kind === "session" && i.state_at && now - i.state_at < LIVE_MS && i.state !== "idle" && i.state !== "done" && i.state !== "gone")));   // 끝난 세션은 방금이어도 도는 중이 아님
  if (work) return { state: "working", why: last && last.kind !== "done" ? short(last.text, 80) : `${short(work.title || "창", 40)} 도는 중` };
  if (last && last.kind === "done") return { state: "done", why: short(last.text, 80) };
  const wins = live.filter(i => i.kind === "window");
  if (wins.length && wins.every(i => i.state === "parked")) return { state: "parked", why: "주차 — 답이나 조건이 오면 다시 열어요" };
  const moved = Math.max(last?.at || 0, ...live.filter(i => i.kind === "window" || i.kind === "session").map(i => i.state_at || i.seen_at || 0));
  if (parkMs > 0 && now - moved >= parkMs) return { state: "parked", why: `${Math.max(1, Math.floor(parkMs / 3600_000))}시간 넘게 조용해 주차 — 다시 일하면 살아나요` };
  if (!wins.length && !live.some(i => i.kind === "session" && i.state !== "done" && i.state !== "gone") && (live.some(i => i.kind === "session") || !live.length))
    return { state: "parked", why: last ? short(last.text, 80) : "창 · 세션이 끝나 주차 — 다시 일하면 살아나요" };
  if (wins.some(i => i.state && i.state !== "parked" && i.state !== "gone")) return { state: "idle", why: last ? short(last.text, 80) : "쉬는 중" };
  return { state: "idle", why: last ? short(last.text, 80) : "열린 창 없음" };
}
export const PARK_QUIET_MS = 6 * 3600_000;
export const PARK_H_LIM: [number, number] = [1, 168];
export function parkMsOf(parkH: number | null | undefined): number {
  if (parkH === undefined || parkH === null || !Number.isFinite(parkH)) return PARK_QUIET_MS;
  if (parkH <= 0) return 0;
  return Math.min(PARK_H_LIM[1], Math.max(PARK_H_LIM[0], Math.trunc(parkH))) * 3600_000;
}
