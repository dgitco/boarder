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
  counts: Record<string, number>; updated_at: number; created_at: number; archived: boolean;
};
export type State = "turn" | "blocked" | "working" | "idle" | "parked" | "done";
export type Audit = { items: number; nodes: number; missing: number; fixed: number; mixed: number; moved: number; empty: number; notes: string[] };

const TRUNK = new Set(["", "main", "master", "develop", "dev", "trunk", "head", "staging", "production"]);
// 링크 하나가 너무 많은 곳에 나오면(채널 맨 위 글 · 공용 이슈) 묶는 이음으로 쓰지 않음
const REF_MAX = 6;
const ORDER: State[] = ["turn", "blocked", "working", "idle", "parked", "done"];
const LIVE_MS = 3 * 60_000;

class DSU {
  p = new Map<string, string>();
  find(a: string): string { let r = a; while (this.p.has(r) && this.p.get(r) !== r) r = this.p.get(r)!; let x = a; while (x !== r) { const n = this.p.get(x)!; this.p.set(x, r); x = n; } if (!this.p.has(r)) this.p.set(r, r); return r; }
  join(a: string, b: string) { const x = this.find(a), y = this.find(b); if (x !== y) this.p.set(x < y ? y : x, x < y ? x : y); }
}

const short = (s: string, n = 60) => s.length > n ? s.slice(0, n - 1) + "…" : s;
const repoName = (r?: string) => (r || "").replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() || "";
const humanBranch = (b: string) => b.replace(/^(feat|fix|chore|claude|codex|cursor)[/-]/i, "").replace(/[-_/]+/g, " ").trim();
const nodeId = async (seed: string) => "n_" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)))].slice(0, 6).map(b => b.toString(16).padStart(2, "0")).join("");

export async function group(input: {
  items: Item[]; logs: Log[]; cards: Card[]; prev: Prev[]; prevNodes: PrevNode[];
  winNames?: Record<string, string>; now: number; archiveH?: number;
}): Promise<{ nodes: Node[]; map: Prev[]; audit: Audit }> {
  const { now } = input, archiveMs = (input.archiveH ?? 6) * 3600_000;
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
  const refUse = new Map<string, string[]>();
  for (const i of items) for (const r of new Set(i.refs || [])) (refUse.get(r) || refUse.set(r, []).get(r)!).push(i.key);
  for (const [r, ks] of refUse) {
    const thread = `thread:${r}`;
    const users = ks.filter(k => k !== thread);
    if (users.length > REF_MAX) { notes.push(`이음 「${short(r, 40)}」 은 ${users.length}곳에 나와 묶지 않음`); continue; }
    for (const k of ks) d.join(ks[0], k);
  }
  const rb = new Map<string, string>();
  for (const i of items) {
    const b = (i.branch || "").trim();
    if (!i.repo || TRUNK.has(b.toLowerCase())) continue;
    const k = `${i.repo}\u0000${b}`;
    if (rb.has(k)) d.join(rb.get(k)!, i.key); else rb.set(k, i.key);
  }
  // 사람이 옮긴 것(pin)은 그 노드 자리에 붙음 — 다른 이음보다 이김: pin 된 것은 자기 묶음에서 떼어 노드 자리로
  const pins = new Map(input.prev.filter(p => p.how === "pin" && byKey.has(p.item)).map(p => [p.item, p.node]));
  const groups = new Map<string, string[]>();
  for (const i of items) {
    const g = pins.has(i.key) ? `pin:${pins.get(i.key)}` : d.find(i.key);
    (groups.get(g) || groups.set(g, []).get(g)!).push(i.key);
  }
  const pinTargets = new Set(pins.values());

  // ② 노드 id 이어받기: 묶음 안 것들이 지난번 가장 많이 있던 노드(큰 묶음부터), 없으면 새 id
  const prevOf = new Map(input.prev.map(p => [p.item, p.node]));
  const prevNodes = new Map(input.prevNodes.map(n => [n.id, n]));
  const used = new Set<string>();
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const nodeOf = new Map<string, string[]>();
  let moved = 0;
  for (const [g, keys] of ordered) {
    let id = g.startsWith("pin:") ? g.slice(4) : "";
    if (!id) {
      const votes = new Map<string, number>();
      for (const k of keys) { const n = prevOf.get(k); if (n) votes.set(n, (votes.get(n) || 0) + 1); }
      const best = [...votes.entries()].filter(([n]) => !used.has(n) || pinTargets.has(n)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      id = best ? best[0] : await nodeId(keys.slice().sort()[0]);
      while (used.has(id) && !pinTargets.has(id)) id = await nodeId(id + "+");
    }
    used.add(id);
    (nodeOf.get(id) || nodeOf.set(id, []).get(id)!).push(...keys);
    for (const k of keys) { const was = prevOf.get(k); if (was && was !== id) moved++; }
  }

  // ③ 상태 · 이름 · 영역
  const nodes: Node[] = [];
  let mixed = 0;
  for (const [id, keys] of nodeOf) {
    const its = keys.map(k => byKey.get(k)!).filter(Boolean);
    const wins = new Set(its.map(i => i.win).filter(Boolean) as string[]);
    const logs = input.logs.filter(l => wins.has(l.win)).sort((a, b) => b.at - a.at);
    const cards = input.cards.filter(c => wins.has(c.win));
    const counts: Record<string, number> = { window: 0, session: 0, thread: 0, todo: 0, task: 0, log: logs.length, card: cards.filter(c => c.state === "open").length };
    for (const i of its) if (!i.gone_at) counts[i.kind] = (counts[i.kind] || 0) + 1;
    const live = its.filter(i => !i.gone_at);
    const repos = new Set(live.map(i => repoName(i.repo)).filter(Boolean));
    if (repos.size > 1) mixed++;
    const s = stateOf(live, logs, cards, now);
    const pn = prevNodes.get(id);
    const name = pn?.pinned_name || nameOf(its);
    const area = [...repos][0] || (() => { const c = live.find(i => i.cwd)?.cwd || ""; return c.split("/").filter(Boolean).pop() || ""; })() || "기타";
    const updated = Math.max(0, ...its.map(i => i.state_at || i.seen_at || 0), ...logs.map(l => l.at), ...cards.map(c => c.at));
    const archived = !live.length && counts.card === 0 && now - updated > archiveMs;
    nodes.push({ id, name, area, state: s.state, why: s.why, items: keys, counts, updated_at: updated, created_at: pn?.created_at || now, archived });
  }
  nodes.sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || b.updated_at - a.updated_at);
  const map: Prev[] = [];
  for (const n of nodes) for (const k of n.items) map.push({ item: k, node: n.id, how: pins.get(k) === n.id ? "pin" : "auto" });
  const empty = input.prevNodes.filter(n => !nodeOf.has(n.id) && !n.archived_at).length;
  const assigned = new Set(map.map(m => m.item));
  const missing = items.filter(i => !assigned.has(i.key)).length;
  return { nodes, map, audit: { items: items.length, nodes: nodes.filter(n => !n.archived).length, missing, fixed, mixed, moved, empty, notes: notes.slice(0, 8) } };
}

function nameOf(its: Item[]): string {
  const pick = (k: Item["kind"]) => its.filter(i => i.kind === k && i.title && !i.gone_at).sort((a, b) => (b.state_at || b.seen_at) - (a.state_at || a.seen_at))[0]?.title;
  const br = its.map(i => i.branch || "").find(b => b && !TRUNK.has(b.toLowerCase()));
  return short((pick("task") || its.find(i => i.kind === "window" && i.engine !== "report" && i.title)?.title || (br && humanBranch(br)) || pick("session") || pick("thread") || pick("window") || its[0]?.title || "이름 없는 일").replace(/^(\d+\s)/, "#$1"), 60);
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
