export type FrontDoor = { name: string; pairs: { pane: string; name: string }[]; aliases: string[] };

const str = (v: unknown, max: number) => typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : "";
/** 저장된 값(또는 화면 · API 가 보낸 값) → 앞단, 틀리면 null. 이미 고른 꼴(pairs)도 받음 */
export function frontDoorOf(v: unknown): FrontDoor | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>, name = str(o.name, 40);
  if (!name) return null;
  const raw = Array.isArray(o.pairs) ? o.pairs.map(p => [(p as Record<string, unknown>)?.pane, (p as Record<string, unknown>)?.name])
    : Array.isArray(o.panes) && Array.isArray(o.names) && o.panes.length === o.names.length ? o.panes.map((p, i) => [p, (o.names as unknown[])[i]]) : null;
  if (!raw || !raw.length || raw.length > 8) return null;
  const pairs = raw.map(([p, n]) => ({ pane: str(p, 20), name: str(n, 80) }));
  if (pairs.some(p => !/^%\d{1,9}$/.test(p.pane) || !p.name)) return null;
  const aliases = Array.isArray(o.aliases) ? o.aliases.map(a => str(a, 80)).filter(Boolean).slice(0, 8) : [];
  return { name, pairs, aliases };
}
export function frontDoorNode(fd: FrontDoor | null | undefined, n: { pane: string; name: string }) {
  return !!fd && fd.pairs.some(p => p.pane === n.pane && p.name === n.name);
}
// 찾기는 전체 보드를 읽지 않으므로 같은 id → pane 대조만 빌림(member-board paneOfId와 같은 FNV).
export function frontDoorId(fd: FrontDoor | null | undefined, id: string, name: string) {
  if (!fd) return false;
  let h = 2166136261; for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return frontDoorNode(fd, { pane: "%" + (1_000_000 + h % 8_999_999), name });
}
/** node_setting.data 문자열 → 앞단(설정 없음 · 망가진 값이면 null) */
export function frontDoorFromData(data: unknown): FrontDoor | null {
  let d = data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return null; } }
  return d && typeof d === "object" ? frontDoorOf((d as Record<string, unknown>).front_door) : null;
}
/** 그 사람 앞단 설정만 읽기(작은 읽기 하나) */
export async function readFrontDoor(db: D1Database, owner: string) {
  const r = await db.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(owner).first<{ data: string }>().catch(() => null);
  return frontDoorFromData(r?.data);
}
