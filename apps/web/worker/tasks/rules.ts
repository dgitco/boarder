export const STATUSES = ["working", "blocked", "waiting", "done", "cancelled"] as const;
export type Status = typeof STATUSES[number];
export const STATUS_KO: Record<Status, string> = { working: "진행", blocked: "막힘", waiting: "기다림", done: "완료", cancelled: "취소" };
export const GROUPS = ["tree", "status", "none"] as const;
export const GROUP_KO: Record<typeof GROUPS[number], string> = { tree: "부서 트리", status: "상태별", none: "묶지 않음" };
export const SORTS = ["status", "updated", "name"] as const;
export const SORT_KO: Record<typeof SORTS[number], string> = { status: "막힌 것 먼저", updated: "최근 바뀐 순", name: "이름 순" };

export type View = {
  group: typeof GROUPS[number];   // 왼쪽 목록을 무엇으로 묶나
  sort: typeof SORTS[number];
  states: Status[];               // 거르개: 보일 상태
  mine: string[];                 // 「내 차례」 로 더 볼 낱말(기본 없음 — 확인 대기(confirm) 표시가 먼저)
  mineFields: string[];           // 이 칸 글에 그 낱말이 있으면 내 차례(모든 칸을 보면 지나가듯 적힌 이름까지 걸림)
  rowFields: string[];            // 목록 줄 밑에 더 보일 칸(열)
  mainFields: string[];           // 가운데 업무 화면에 보일 칸(순서 그대로)
  sideFields: string[];           // 오른쪽 칸에 보일 칸(순서 그대로)
  showBody: boolean;              // 업무 설명
};
export const DEFAULT_VIEW: View = {
  group: "tree", sort: "status", states: ["working", "blocked", "waiting"], mine: [], mineFields: ["막힌 것"],
  rowFields: [], mainFields: ["종류", "우선", "마지막 진전"], sideFields: ["맡은 창", "다음 할 일", "막힌 것"], showBody: true,
};

const words = (v: unknown, max: number, len: number) => Array.isArray(v) && v.length <= max && v.every(x => typeof x === "string" && x.trim() && x.length <= len) ? [...new Set(v.map(x => String(x).trim()))] : null;
/** 저장할 보기 검사 — 틀린 칸이 하나라도 있으면 null(저장하지 않음). 빠진 칸은 기본값. */
export function checkView(v: unknown): View | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>, d = DEFAULT_VIEW;
  const group = o.group ?? d.group, sort = o.sort ?? d.sort, showBody = o.showBody ?? d.showBody;
  if (!GROUPS.includes(group as never) || !SORTS.includes(sort as never) || typeof showBody !== "boolean") return null;
  const states = o.states ?? d.states;
  if (!Array.isArray(states) || !states.every(s => STATUSES.includes(s as never))) return null;
  const mine = words(o.mine ?? d.mine, 10, 40), mineFields = words(o.mineFields ?? d.mineFields, 20, 40), rowFields = words(o.rowFields ?? d.rowFields, 20, 40), mainFields = words(o.mainFields ?? d.mainFields, 20, 40), sideFields = words(o.sideFields ?? d.sideFields, 20, 40);
  if (!mine || !mineFields || !rowFields || !mainFields || !sideFields) return null;
  return { group: group as View["group"], sort: sort as View["sort"], states: [...new Set(states as Status[])], mine, mineFields, rowFields, mainFields, sideFields, showBody };
}
/** 저장된 값 읽기 — 옛 꼴 · 망가진 값이면 기본값(화면이 깨지지 않게). */
export const readView = (v: unknown): View => checkView(v ?? {}) || DEFAULT_VIEW;

export type TaskRow = { id: string; pane: string; name: string; status: Status; line: string; body: string; issue: string; fields: Record<string, string>; parent: string | null; main: string | null; updated_at: number; closed: boolean; confirm: boolean };
/** 내 차례: 끝나지 않았고, 확인 대기로 표시됐거나(노드는 사람마다라 그 사람 몫) 고른 칸에 내 낱말이 있는 업무 */
export const isMine = (t: TaskRow, v: Pick<View, "mine" | "mineFields">) => !t.closed && (t.confirm || v.mine.some(w => v.mineFields.some(f => (t.fields[f] || "").includes(w))));
const ORDER: Record<Status, number> = { blocked: 0, waiting: 1, working: 2, done: 3, cancelled: 4 };
export function sorted(ts: TaskRow[], sort: View["sort"]) {
  const c = [...ts];
  if (sort === "updated") return c.sort((a, b) => b.updated_at - a.updated_at);
  if (sort === "name") return c.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return c.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.updated_at - a.updated_at);
}
/** 트리: 상위가 업무 노드이면 그 밑, 아니면 맨 위. 고리 · 없는 상위는 맨 위로(어느 업무도 사라지지 않게). */
export function roots(ts: TaskRow[]) {
  const ids = new Set(ts.map(t => t.id)), up = new Map(ts.map(t => [t.id, t.parent]));
  const cyc = (id: string) => { let x = up.get(id) ?? null; for (let i = 0; x && ids.has(x) && i < 60; i++, x = up.get(x) ?? null) if (x === id) return true; return false; };
  return ts.filter(t => !t.parent || !ids.has(t.parent) || cyc(t.id));
}
/** 보일 업무 id: 거르개를 지난 업무와 그 위 사슬. 고리가 있어도 멈춤(위로만 따라가고 한 번 본 것은 안 봄). */
export function visibleIds(ts: TaskRow[], shown: Iterable<string>) {
  const up = new Map(ts.map(t => [t.id, t.parent])), out = new Set<string>();
  for (const id of shown) for (let x: string | null | undefined = id; x && up.has(x) && !out.has(x); x = up.get(x)) out.add(x);
  return out;
}
export const kidsOf = (ts: TaskRow[], id: string, rootIds: Set<string>) => ts.filter(t => t.parent === id && !rootIds.has(t.id));
