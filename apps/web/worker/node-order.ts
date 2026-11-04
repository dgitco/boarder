export const ORDER_MAX = 300, ORDER_SIBS = 60;
const ID = /^[\w.:-]{1,120}$/;

/** 저장된 node_setting.data(문자열 · 객체) → 순서 목록(없거나 망가졌으면 빈 목록) */
export function orderFromData(data: unknown): string[] {
  let d = data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return []; } }
  const o = d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>).order : null;
  return Array.isArray(o) ? [...new Set(o.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, ORDER_MAX) : [];
}
/** id → 순위(없으면 Infinity) */
export const rankOf = (order: string[]) => { const m = new Map(order.map((id, i) => [id, i])); return (id: string) => m.get(id) ?? Infinity; };
/** 형제 묶음 ids(새 순서)를 목록에 넣음: 그 묶음이 있던 첫 자리(없으면 맨 끝)에 통째로 */
export function placeOrder(cur: string[], ids: string[]): string[] {
  const set = new Set(ids), at = cur.findIndex(x => set.has(x)), rest = cur.filter(x => !set.has(x));
  const pos = at < 0 ? rest.length : cur.slice(0, at).filter(x => !set.has(x)).length;
  return [...rest.slice(0, pos), ...ids, ...rest.slice(pos)];
}
/** placeOrder + 한도: 넘치면 이제 없는 노드 id(live 밖)를 빼고 다시, 그래도 넘치면 null(부른 쪽이 오류 — 잘라 저장하면 새 묶음이 조용히 사라짐) */
export function placeWithin(cur: string[], ids: string[], live: Iterable<string>): string[] | null {
  const out = placeOrder(cur, ids); if (out.length <= ORDER_MAX) return out;
  const alive = new Set(live), kept = placeOrder(cur.filter(x => alive.has(x)), ids);
  return kept.length <= ORDER_MAX ? kept : null;
}
export function panesOk(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > ORDER_SIBS) return null;
  const out = v.filter((x): x is string => typeof x === "string" && /^%\d{1,9}$/.test(x));
  return out.length === v.length && new Set(out).size === out.length ? out : null;
}
/** 저장: order 칸만 고침(다른 칸 unit · pri · parent … 그대로) */
export const saveOrder = (db: D1Database, me: string, order: string[]) =>
  db.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?1, json_object('order', json(?2)), ?3) ON CONFLICT(owner) DO UPDATE SET data = json_set(CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END, '$.order', json(?2)), updated_at = ?3")
    .bind(me, JSON.stringify(order), Date.now()).run();

const DEPT_EN: Record<string, string> = { ops: "운영", operations: "운영", cs: "고객성공", support: "고객성공", tech: "기술", eng: "기술", engineering: "기술", sales: "영업", fin: "재무", finance: "재무", legal: "법무", product: "제품" };
export function deptMatch(v: unknown, seats: string[]): string {
  if (typeof v !== "string") return "";
  const raw = v.trim().replace(/^dept:/i, "").trim(); if (!raw) return "";
  const k = DEPT_EN[raw.toLowerCase()] || raw;
  return seats.find(s => s === k || s === k + "장" || s.replace(/장$/, "") === k.replace(/장$/, "")) || "";
}
export function deptOf(id: string, o: { parents: Record<string, string>; seatName: Map<string, string>; fields?: Record<string, unknown> | null; seats: string[] }): string {
  for (let x: string | undefined = id, i = 0; x && x !== "top" && i < 30; i++, x = o.parents[x]) { const s = o.seatName.get(x); if (s && x !== id) return s; }
  const f = o.fields || {};
  return deptMatch(f.dept, o.seats) || deptMatch(f["부서"], o.seats);
}
