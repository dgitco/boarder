export type RoleSeat = { name: string; win: string; node?: string; primary?: boolean; fold?: string[] };
export const ROLE_SEAT_MAX = 32;

const str = (v: unknown, max: number) => typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : "";
const WIN = /^[\w.@-]{1,60}:[\w%.@:-]{1,80}$/;
const NODE = /^tk_[\w.:-]{1,120}$/;

/** 한 줄 → 자리(틀리면 null) */
export function seatOf(v: unknown): RoleSeat | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>, name = str(o.name, 40), win = str(o.win, 140);
  if (!name || !win || !WIN.test(win)) return null;
  const node = o.node === undefined || o.node === null || o.node === "" ? "" : str(o.node, 124);
  if ((o.node !== undefined && o.node !== null && o.node !== "" && !node) || (node && !NODE.test(node))) return null;
  let fold: string[] | undefined;
  if (o.fold !== undefined) {
    if (o.primary !== true || !Array.isArray(o.fold) || o.fold.length > 8) return null;
    fold = o.fold.map(x => str(x, 80));
    if (fold.some(x => !x) || new Set(fold).size !== fold.length) return null;
  }
  return { name, win, ...(node ? { node } : {}), ...(o.primary === true ? { primary: true } : {}), ...(fold?.length ? { fold } : {}) };
}
/** 표 전체 → 자리들. 한 줄이라도 틀리거나 같은 역할 · 같은 노드가 두 번이면 null(API 는 400 — 반만 저장하지 않음). primary 는 하나까지 */
export function seatsOf(v: unknown): RoleSeat[] | null {
  if (!Array.isArray(v) || v.length > ROLE_SEAT_MAX) return null;
  const out: RoleSeat[] = [];
  for (const x of v) { const s = seatOf(x); if (!s) return null; out.push(s); }
  const names = new Set(out.map(s => s.name)), nodes = out.filter(s => s.node).map(s => s.node);
  if (names.size !== out.length || new Set(nodes).size !== nodes.length || out.filter(s => s.primary).length > 1) return null;
  return out;
}
/** 저장된 node_setting.data(문자열 · 객체) → 자리들(없거나 망가졌으면 빈 표) */
export function seatsFromData(data: unknown): RoleSeat[] {
  let d = data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return []; } }
  return d && typeof d === "object" && !Array.isArray(d) ? seatsOf((d as Record<string, unknown>).roles) || [] : [];
}

export type SeatItem = { key: string; kind: string; win?: string | null; session?: string | null; engine?: string | null; gone_at?: number | null; state?: string | null; state_at?: number | null; seen_at?: number | null; rv?: unknown };
export type SeatTask = { id: string; name: string; pinned_name?: string | null; archived_at?: number | null; counts?: string | null };
export type SeatMap = { item: string; node: string; how: string };
export type SeatPlan = {
  pins: { item: string; node: string }[];   // 새로 pin 할 항목(이미 그 노드에 pin 이면 빠짐)
  mains: { node: string; main: string; past: string }[];
  unmain: string[];
  primary: string | null;
  seats: { name: string; win: string; node: string | null; window: string | null; why: string }[];   // 자리마다 판정(설정 화면 · 시험 · 진단용)
};

const live = (i: SeatItem) => i.kind === "window" && !i.gone_at && i.state !== "gone" && i.engine !== "report" && !i.rv;
const pastOf = (counts?: string | null): string[] => { try { const p = JSON.parse(counts || "{}")?.past; return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
const mainOf = (counts?: string | null) => { try { const m = JSON.parse(counts || "{}")?.main; return typeof m === "string" ? m : ""; } catch { return ""; } };

/** 자리표 → 이번 묶기 전에 할 일. 창이 아직 안 들어왔으면(다른 기기에서 새로 연 창의 들여오기가 늦음) 아무것도 안 바꿈 — 다음 묶기에 다시 봄 */
export function seatPlan(input: { seats: RoleSeat[]; items: SeatItem[]; tasks: SeatTask[]; map: SeatMap[] }): SeatPlan {
  const out: SeatPlan = { pins: [], mains: [], unmain: [], primary: null, seats: [] };
  const openTasks = input.tasks.filter(t => !t.archived_at);
  const cur = new Map(input.map.map(m => [m.item, m]));
  const mainNow = new Map(input.tasks.map(t => [t.id, mainOf(t.counts)]));
  const taken = new Set<string>(), claimed = new Set<string>();
  const winOf = (name: string) => input.items.filter(i => live(i) && i.win === name).sort((a, b) => (b.state_at || b.seen_at || 0) - (a.state_at || a.seen_at || 0) || (a.key < b.key ? -1 : 1))[0];
  const pw0 = input.seats.find(s => s.primary), pk = pw0 ? winOf(pw0.win)?.key : undefined; if (pk) taken.add(pk);
  for (const s of input.seats) {
    const w = winOf(s.win);
    if (s.primary) {
      out.primary = w?.key || null;
      out.seats.push({ name: s.name, win: s.win, node: null, window: w?.key || null, why: w ? "메인 봇 창" : "창이 아직 안 들어옴" });
      continue;
    }
    const cands = s.node ? openTasks.filter(t => t.id === s.node) : openTasks.filter(t => (t.pinned_name || t.name) === s.name);
    const n = cands.length === 1 ? cands[0] : null;
    if (!n) { out.seats.push({ name: s.name, win: s.win, node: null, window: w?.key || null, why: cands.length ? "같은 이름 노드가 여럿 — node 로 골라요" : "역할 노드 없음" }); continue; }
    if (!w) { out.seats.push({ name: s.name, win: s.win, node: n.id, window: null, why: "창이 아직 안 들어옴" }); continue; }
    if (taken.has(w.key)) { out.seats.push({ name: s.name, win: s.win, node: n.id, window: null, why: "다른 역할이 이미 이 창" }); continue; }
    taken.add(w.key);
    const keys = [w.key, ...(w.session ? input.items.filter(i => i.key === w.session || i.session === w.session).map(i => i.key) : [])];
    for (const k of new Set(keys)) { const m = cur.get(k); if (!m || m.node !== n.id || m.how !== "pin") out.pins.push({ item: k, node: n.id }); }
    const was = mainNow.get(n.id) || "", past = was && was !== w.key ? input.items.find(i => i.key === was)?.win || was.replace(/^(?:window|win):/, "") : "";
    if (was !== w.key) out.mains.push({ node: n.id, main: w.key, past });
    for (const pw of new Set([...pastOf(n.counts), ...(past ? [past] : [])])) if (pw !== w.win && !input.items.some(i => live(i) && i.win === pw)) { const k = `win:${pw}`, m = cur.get(k); if (claimed.has(k)) continue; claimed.add(k); if (!m || m.node !== n.id || m.how !== "pin") out.pins.push({ item: k, node: n.id }); }
    for (const t of input.tasks) if (t.id !== n.id && mainNow.get(t.id) === w.key) out.unmain.push(t.id);
    out.seats.push({ name: s.name, win: s.win, node: n.id, window: w.key, why: "붙음" });
  }
  return out;
}
