export type Item = {
  key: string; kind: "window" | "session" | "thread" | "todo" | "task";
  engine?: string; title?: string; cwd?: string; repo?: string; branch?: string;
  refs?: string[]; state?: string; state_at?: number | null; win?: string; session?: string;
  seen_at: number; gone_at?: number | null;
};
export type Log = { win: string; kind: string; text: string; at: number };
export type Card = { id: string; win: string; state: string; question: string; at: number };
export type Prev = { item: string; node: string; how: string };
export type PrevNode = { id: string; pinned_name?: string | null; created_at: number; archived_at?: number | null };
export type Node = {
  id: string; name: string; area: string; state: State; why: string; items: string[];
  counts: Record<string, number | string>; updated_at: number; created_at: number; archived: boolean;
};
export type Unit = "goal" | "agent";
export type State = "turn" | "blocked" | "working" | "idle" | "parked" | "done";
export type Audit = { items: number; nodes: number; missing: number; fixed: number; mixed: number; moved: number; empty: number; history: number; notes: string[] };

const TRUNK = new Set(["", "main", "master", "develop", "dev", "trunk", "head", "staging", "production"]);
// 링크 하나가 너무 많은 곳에 나오면(채널 맨 위 글 · 공용 이슈) 묶는 이음으로 쓰지 않음
const REF_MAX = 6;
const ORDER: State[] = ["turn", "blocked", "working", "idle", "parked", "done"];
const LIVE_MS = 3 * 60_000;
const NOT_GOAL = [/\S@\S/, /^(?:(?:claude|codex|cursor|gemini)\s+)?[a-z]\s+\S+$/i, /^(?:claude|codex|cursor|gemini|터미널|terminal|agent)\s*·/i, /^(?:claude|codex|cursor|gemini)(?:-\w+)?$/i, /^\S+:\d+$/];
const TEST_NAME = /(?:^|[\s·_-])(?:시험|테스트|test|probe|smoke)(?:$|[\s·_:-])/i;

class DSU {
  p = new Map<string, string>();
  find(a: string): string { let r = a; while (this.p.has(r) && this.p.get(r) !== r) r = this.p.get(r)!; let x = a; while (x !== r) { const n = this.p.get(x)!; this.p.set(x, r); x = n; } if (!this.p.has(r)) this.p.set(r, r); return r; }
  join(a: string, b: string) { const x = this.find(a), y = this.find(b); if (x !== y) this.p.set(x < y ? y : x, x < y ? x : y); }
}

const short = (s: string, n = 60) => s.length > n ? s.slice(0, n - 1) + "…" : s;
const repoName = (r?: string) => (r || "").replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() || "";
const humanBranch = (b: string) => b.replace(/^(feat|fix|chore|claude|codex|cursor)[/-]/i, "").replace(/[-_/]+/g, " ").trim();
const base = (p?: string) => (p || "").split("/").filter(Boolean).pop() || "";
const goalName = (i: Item) => { const t = (i.title || "").trim(); return !!t && t !== base(i.cwd) && !NOT_GOAL.some(r => r.test(t)); };
const goalNo = (i: Item) => { const m = /#(\d{3,6})\b/.exec(i.title || ""); return m ? `${repoName(i.repo)}#${m[1]}` : ""; };
const openWindow = (i: Item) => i.kind === "window" && !i.gone_at && i.state !== "gone" && i.engine !== "report";

function keepsNode(its: Item[], logs: Log[], cards: Card[], pinned: boolean, now: number, archiveMs: number) {
  const live = its.filter(i => !i.gone_at);
  if (cards.some(c => c.state === "open")) return true;
  if (pinned && live.length) return true;
  if (live.some(i => openWindow(i) && (!!i.session || goalName(i) || i.state === "working" || i.state === "question"))) return true;   // 세션도 일 이름도 없는 판(계정 이름만 있는 Herdr 판)은 노드가 아님
  if (live.some(i => i.kind === "task" && i.state !== "done")) return true;
  if (live.some(i => i.kind === "session" && (i.state === "working" || (!!i.state_at && now - i.state_at < LIVE_MS && i.state !== "idle")))) return true;
  if (its.some(i => i.kind === "window" && !!i.gone_at && now - i.gone_at < archiveMs)) return true;
  if (its.some(i => TEST_NAME.test(i.title || "") || TEST_NAME.test(i.win || ""))) return false;
  return !!logs[0] && now - logs[0].at < archiveMs;
}

// ── 에이전트마다 채널: 이름의 역할(팀장 · 개인 비서 · 머지 담당) → 없으면 그 폴더의 주 에이전트 → 없으면 폴더
const ROLE = "(?:팀장|비서|담당|총괄|리드|supervisor|manager|assistant|lead)";
const ROLE_AT_START = new RegExp(`^((?:[^\\s:,.?!]+\\s){0,2}[^\\s:,.?!]*${ROLE})(?=$|[\\s:,.?!]|세션|입니다)`, "i");
const roleName = (t: string) => { const r = ROLE_AT_START.exec(t.trim())?.[1].replace(/^[a-z]\s+/i, "") || ""; return /^(새|다음)\s/.test(r) ? "" : r; };
/** strict: 세션 제목은 첫 질문이라 「CS 담당 찾아줘」도 역할처럼 보임 — 지시 머리([팀장 → …]) · 「… 세션입니다」 꼴 · 제목 전체일 때만 */
export function roleOf(title: string, known: string[] = [], strict = false) {
  const t = title.replace(/<[^>]*>/g, " ").replace(/\([^)]*\)/g, " ").replace(/#\d+/g, " ").replace(/^[#\s]+/, "").replace(/\s+/g, " ").trim();
  const fits = (r: string) => !strict || /^\s*(?:세션|입니다|[—:-]|$)/.test(t.slice(t.indexOf(r) + r.length));
  for (const k of known) if (k && t.includes(k) && fits(k)) return k;
  const to = /^\[([^\]→]+?)(?:\s+\d{1,2}:\d{2})?\s*(?:→\s*([^\]]*))?\]/.exec(t);   // [팀장 → 회의 녹음 담당] 지시 — 받는 쪽, 일반 말(새 담당)이면 시킨 쪽 일
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
function agentChannels(items: Item[], root: (k: string) => string, known: string[], workLinks: string[][]) {
  const comps = new Map<string, Item[]>();
  for (const i of items) if (i.kind !== "thread") { const r = root(i.key); (comps.get(r) || comps.set(r, []).get(r)!).push(i); }
  const roles = new Map<string, string>(), votes = new Map<string, Map<string, number>>();
  for (const [r, its] of comps) {
    const role = its.filter(i => i.kind === "window").concat(its).map(i => windowRole(i, known)).find(Boolean) || "";
    if (role) roles.set(r, role);
  }
  for (const ks of workLinks) { const c = ks.map(root), own = c.map(r => roles.get(r)).find(Boolean); if (own) for (const r of c) if (!roles.has(r)) roles.set(r, own); }
  for (const [r, its] of comps) { const role = roles.get(r); if (role) for (const f of new Set(its.map(folderOf).filter(Boolean))) { const m = votes.get(f) || votes.set(f, new Map()).get(f)!; m.set(role, (m.get(role) || 0) + 1); } }
  const top = (m?: Map<string, number>) => [...(m || new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  const lead = (f: string) => top(votes.get(f));
  const all = new Map<string, number>(); for (const r of roles.values()) all.set(r, (all.get(r) || 0) + 1);
  const main = top(all);   // 폴더를 모르는 일 창(작업자 · 보고 창)은 가장 큰 에이전트의 일
  const homes = new Set(items.map(i => /^\/(?:Users|home)\/([^/]+)/.exec(i.cwd || "")?.[1]).filter(Boolean));   // 「claude · alex」의 alex 는 폴더가 아니라 홈
  const out = new Map<string, string>();
  for (const [r, its] of comps) {
    if (!roles.has(r) && its.every(notWork)) continue;
    const f = its.map(folderOf).find(x => x && !homes.has(x)) || "";
    const ch = roles.get(r) || (f && (lead(f) || f)) || (its.some(i => i.engine === "report") && main) || "";
    if (ch) for (const i of its) out.set(i.key, ch);
  }
  const named = new Set(roles.values()), weight = new Map<string, number>();
  for (const i of items) { const c = out.get(i.key); if (c && !named.has(c)) weight.set(c, (weight.get(c) || 0) + (openWindow(i) ? FOLDER_MIN : i.kind === "session" ? 1 : 0)); }
  for (const [k, c] of out) if (!named.has(c) && (weight.get(c) || 0) < FOLDER_MIN) out.delete(k);
  return { chan: out, roles: named };
}
function mainWindow(its: Item[], name: string, isRole: boolean, known: string[]) {
  const open = its.filter(openWindow).sort((a, b) => (a.key < b.key ? -1 : 1));
  if (!isRole) return open[0]?.key;
  const titles = new Map(its.filter(i => i.kind === "session").map(i => [i.key, i.title || ""]));
  return open.find(i => roleOf(i.title || "", known) === name || roleOf(titles.get(i.session || "") || "", known, true) === name)?.key;
}
/** 들여오기 때 고르기: 역할 이름이 셋 이상이면 에이전트마다 채널, 아니면 일마다 채널 */
export function pickUnit(items: Pick<Item, "title" | "kind">[], known: string[] = []): Unit {
  const named = items.filter(i => i.kind === "window" || i.kind === "task");   // 세션 제목은 첫 질문이라 고르는 근거로 안 씀
  return known.length >= 3 || new Set(named.map(i => roleOf(i.title || "", known)).filter(Boolean)).size >= 3 ? "agent" : "goal";
}

const nodeId = async (seed: string) => "n_" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)))].slice(0, 6).map(b => b.toString(16).padStart(2, "0")).join("");

export async function group(input: {
  items: Item[]; logs: Log[]; cards: Card[]; prev: Prev[]; prevNodes: PrevNode[];
  winNames?: Record<string, string>; now: number; archiveH?: number; unit?: Unit; agents?: string[];
}): Promise<{ nodes: Node[]; map: Prev[]; audit: Audit }> {
  const { now, unit } = input, agentUnit = unit === "agent", archiveMs = (input.archiveH ?? 6) * 3600_000;
  const usedWins = new Set([...input.logs.map(l => l.win), ...input.cards.map(c => c.win)]);
  const items = input.items.filter(i => !i.gone_at || now - i.gone_at < archiveMs || (i.win && usedWins.has(i.win)));
  const byKey = new Map(items.map(i => [i.key, i]));
  const notes: string[] = [];

  const winOwner = new Map<string, string>();
  for (const i of items) if (i.win && (i.kind === "window" || !winOwner.has(i.win))) winOwner.set(i.win, i.key);
  let fixed = 0;
  for (const w of new Set([...input.logs.map(l => l.win), ...input.cards.map(c => c.win)].filter(Boolean))) {
    if (winOwner.has(w)) continue;
    const key = `win:${w}`, last = Math.max(0, ...input.logs.filter(l => l.win === w).map(l => l.at), ...input.cards.filter(c => c.win === w).map(c => c.at));
    const it: Item = { key, kind: "window", engine: "report", title: input.winNames?.[w] || w.split(":").slice(1).join(":") || w, win: w, state: "", seen_at: last };
    items.push(it); byKey.set(key, it); winOwner.set(w, key); fixed++;
  }

  const d = new DSU();
  for (const i of items) d.find(i.key);
  // ① 이음
  const sessKeys = new Set(items.filter(i => i.kind === "session").map(i => i.key));
  for (const i of items) if (i.session && i.session !== i.key && (sessKeys.has(i.session) || byKey.has(i.session))) d.join(i.key, i.session);
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
  const { chan, roles: roleChans } = agentUnit ? agentChannels(items, k => d.find(k), input.agents || [], [...workLinks.values()]) : { chan: new Map<string, string>(), roles: new Set<string>() };
  if (agentUnit) for (const ks of refLinks) { const c = ks.map(k => chan.get(k)).find(Boolean); if (c) for (const k of ks) if (k.startsWith("thread:") && !chan.has(k)) chan.set(k, c); }
  const groups = new Map<string, string[]>();
  for (const i of items) {
    const g = pins.has(i.key) ? `pin:${pins.get(i.key)}` : chan.has(i.key) ? `agent:${chan.get(i.key)}` : d.find(i.key);
    (groups.get(g) || groups.set(g, []).get(g)!).push(i.key);
  }
  const pinTargets = new Set(pins.values());

  // ② 노드 id 이어받기: 묶음 안 것들이 지난번 가장 많이 있던 노드(큰 묶음부터), 없으면 새 id
  const prevOf = new Map(input.prev.map(p => [p.item, p.node]));
  const prevNodes = new Map(input.prevNodes.map(n => [n.id, n]));
  const used = new Set<string>();
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const nodeOf = new Map<string, string[]>();
  const chanName = new Map<string, string>();
  let moved = 0;
  for (const [g, keys] of ordered) {
    let id = g.startsWith("pin:") ? g.slice(4) : "";
    if (!id) {
      const votes = new Map<string, number>();
      for (const k of keys) { const n = prevOf.get(k); if (n) votes.set(n, (votes.get(n) || 0) + 1); }
      // 채널 하나 = 노드 하나: 사람이 옮겨 넣은 노드라도 다른 채널이 차지했으면 안 씀
      const best = [...votes.entries()].filter(([n]) => !used.has(n) || (pinTargets.has(n) && !(g.startsWith("agent:") && chanName.has(n)))).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
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
    const keep = !unit ? !(!live.length && counts.card === 0 && now - updated > archiveMs) : chanName.has(id) || keepsNode(its, logs, cards, pinned, now, archiveMs);
    if (!keep && !pn && unit) { history.push(...keys); continue; }   // 노드가 된 적 없는 지난 세션 · 스레드는 기록으로만
    const st = keep || !unit ? stateOf(live, logs, cards, now) : { state: "done" as State, why: logs[0] ? short(logs[0].text, 80) : "열린 창 없음" };
    // 다시 연 노드(pinned_name)는 마지막 줄이 「끝」이어도 트리에 있음
    const s = unit && keep && st.state === "done" && pn?.pinned_name ? { ...st, state: "idle" as State } : st;
    const name = pn?.pinned_name || chanName.get(id) || (unit ? nameOf(its) : oldNameOf(its));
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
  return { nodes, map, audit: { items: items.length, nodes: nodes.filter(n => !n.archived).length, missing, fixed, mixed, moved, empty, history: history.length, notes: notes.slice(0, 8) } };
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

export function stateOf(live: Item[], logs: Log[], cards: Card[], now: number): { state: State; why: string } {
  const open = cards.filter(c => c.state === "open").sort((a, b) => b.at - a.at);
  if (open.length) return { state: "turn", why: short(open[0].question, 80) };
  const q = live.find(i => i.state === "question");
  if (q) return { state: "turn", why: `${short(q.title || "창", 40)} 이 묻고 있어요` };
  const last = logs[0];
  if (last && (last.kind === "blocked" || last.kind === "incident")) return { state: "blocked", why: short(last.text, 80) };
  const work = live.find(i => (i.kind === "window" || i.kind === "session") && (i.state === "working" || (i.kind === "session" && i.state_at && now - i.state_at < LIVE_MS && i.state !== "idle")));
  if (work) return { state: "working", why: last && last.kind !== "done" ? short(last.text, 80) : `${short(work.title || "창", 40)} 도는 중` };
  if (last && last.kind === "done") return { state: "done", why: short(last.text, 80) };
  const wins = live.filter(i => i.kind === "window");
  if (wins.length && wins.every(i => i.state === "parked")) return { state: "parked", why: "주차 — 답이나 조건이 오면 다시 열어요" };
  if (wins.some(i => i.state && i.state !== "parked" && i.state !== "gone")) return { state: "idle", why: last ? short(last.text, 80) : "쉬는 중" };
  if (!live.length) return { state: "done", why: last ? short(last.text, 80) : "열린 창 없음" };
  return { state: "idle", why: last ? short(last.text, 80) : "열린 창 없음" };
}
