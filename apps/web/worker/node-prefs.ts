import { RULE_KEYS, type Rules } from "./install";
import { pickOf, PARK_H_LIM, PARK_QUIET_MS, type PrimaryPick } from "./importer/group";

export type NodePrefs = { park_on: boolean; park_h: number; primary_item: PrimaryPick; rules: Required<Rules> };
export const PREF_DEF: NodePrefs = { park_on: true, park_h: PARK_QUIET_MS / 3600_000, primary_item: "auto", rules: Object.fromEntries(RULE_KEYS.map(k => [k, true])) as Required<Rules> };

const obj = (v: unknown): Record<string, unknown> => {
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return {}; } }
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
};
const hours = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.min(PARK_H_LIM[1], Math.max(PARK_H_LIM[0], Math.trunc(v))) : null;

/** node_setting.data(문자열 · 객체 · 없음) → 칸마다 값, 없거나 틀린 칸은 기본값 */
export function prefsOf(data: unknown): NodePrefs {
  const d = obj(data), r = obj(d.rules);
  return {
    park_on: d.park_on !== false,
    park_h: hours(d.park_h) ?? PREF_DEF.park_h,
    primary_item: pickOf(d.primary_item),
    rules: Object.fromEntries(RULE_KEYS.map(k => [k, r[k] !== false])) as Required<Rules>,
  };
}
export const parkHOf = (p: NodePrefs) => p.park_on ? p.park_h : 0;

/** 화면이 보낸 값 → 저장할 칸만(틀린 칸은 버림). 아무 칸도 없으면 null */
export function prefsPatch(raw: unknown): Partial<NodePrefs> | null {
  const b = obj(raw), out: Partial<NodePrefs> = {};
  if (typeof b.park_on === "boolean") out.park_on = b.park_on;
  const h = hours(b.park_h); if (h !== null) out.park_h = h;
  if (typeof b.primary_item === "string" && b.primary_item.trim() && b.primary_item.length <= 300) out.primary_item = b.primary_item.trim();
  const r = obj(b.rules), rules: Rules = {};
  for (const k of RULE_KEYS) if (typeof r[k] === "boolean") rules[k] = r[k] as boolean;
  if (Object.keys(rules).length) out.rules = rules as Required<Rules>;
  return Object.keys(out).length ? out : null;
}

/** 이 칸들만 D1 안에서 바꿈(json_set · rules 는 json_patch) — 읽고 통째로 쓰면 그 사이 저장한 다른 칸(unit · pri · faces)을 옛 값으로 덮음 */
export async function savePrefs(db: D1Database, owner: string, patch: Partial<NodePrefs>) {
  const base = "CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END";
  const sets: string[] = [], args: unknown[] = [];
  const put = (k: string, expr: string, v: unknown) => { sets.push(`'$.${k}', ${expr}`); args.push(v); };
  if (patch.park_on !== undefined) put("park_on", "json(?)", JSON.stringify(patch.park_on));
  if (patch.park_h !== undefined) put("park_h", "?", patch.park_h);
  if (patch.primary_item !== undefined) put("primary_item", "?", patch.primary_item);
  if (patch.rules) put("rules", `json_patch(CASE WHEN json_valid(data) AND json_type(data, '$.rules') = 'object' THEN json_extract(data, '$.rules') ELSE '{}' END, json(?))`, JSON.stringify(patch.rules));
  if (!sets.length) return;
  // 자리표: ?1 owner · ?2 처음 data(줄이 없을 때) · ?3 시각 · ?4… 칸 값
  const setSql = sets.map((x, i) => x.replace("?", `?${i + 4}`)).join(", ");
  await db.prepare(`INSERT INTO node_setting (owner, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(owner) DO UPDATE SET data = json_set(${base}, ${setSql}), updated_at = ?3`)
    .bind(owner, JSON.stringify(patch), Date.now(), ...args).run();
}
export async function readPrefs(db: D1Database, owner: string): Promise<NodePrefs> {
  const r = await db.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(owner).first<{ data: string }>().catch(() => null);
  return prefsOf(r?.data);
}
