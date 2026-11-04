import { RULE_KEYS, type Rules } from "./install";
import { BUNDLE_KEYS, BUNDLE_DEF } from "./harness-bundles";
import { pickOf, PARK_H_LIM, PARK_QUIET_MS, type PrimaryPick } from "./importer/group";
import { frontDoorOf, type FrontDoor } from "./front-door";

export type NodePrefs = { park_on: boolean; park_h: number; primary_item: PrimaryPick; rules: Required<Rules>; bundles: Record<string, boolean>; task_dots: boolean; task_channels: boolean; task_repo: string; front_door: FrontDoor | null; tree_tidy: boolean | null };
export const PREF_DEF: NodePrefs = { park_on: true, park_h: PARK_QUIET_MS / 3600_000, primary_item: "auto", task_dots: false, task_channels: false, task_repo: "", front_door: null, tree_tidy: null, bundles: { ...BUNDLE_DEF }, rules: Object.fromEntries(RULE_KEYS.map(k => [k, true])) as Required<Rules> };
/** "owner/repo" 꼴만(github.com · .git · 대문자는 정리) — 틀리면 null */
export const repoOf = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const r = v.trim().replace(/\.git$/i, "").replace(/^(?:https?:\/\/)?(?:www\.)?github\.com[/:]/i, "").toLowerCase();
  return r === "" || /^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(r) ? r : null;
};

const obj = (v: unknown): Record<string, unknown> => {
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return {}; } }
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
};
const hours = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.min(PARK_H_LIM[1], Math.max(PARK_H_LIM[0], Math.trunc(v))) : null;

/** node_setting.data(문자열 · 객체 · 없음) → 칸마다 값, 없거나 틀린 칸은 기본값 */
export function prefsOf(data: unknown): NodePrefs {
  const d = obj(data), r = obj(d.rules), b = obj(d.bundles);
  return {
    park_on: d.park_on !== false,
    park_h: hours(d.park_h) ?? PREF_DEF.park_h,
    primary_item: pickOf(d.primary_item),
    task_dots: d.task_dots === true,
    task_channels: d.task_channels === true,
    task_repo: repoOf(d.task_repo) || "",
    front_door: frontDoorOf(d.front_door),
    tree_tidy: typeof d.tree_tidy === "boolean" ? d.tree_tidy : null,
    rules: Object.fromEntries(RULE_KEYS.map(k => [k, r[k] !== false])) as Required<Rules>,
    bundles: Object.fromEntries(BUNDLE_KEYS.map(k => [k, typeof b[k] === "boolean" ? b[k] : BUNDLE_DEF[k]])) as Record<string, boolean>,
  };
}
/** 트리 정리가 켜졌나: 자리표(부서장 자리)가 있는 사람만 — 손으로 끄면 끔, 값 없으면 켬 */
export const tidyOn = (p: Pick<NodePrefs, "tree_tidy">, seats: number) => seats > 0 && p.tree_tidy !== false;
export const parkHOf = (p: NodePrefs) => p.park_on ? p.park_h : 0;

/** 화면이 보낸 값 → 저장할 칸만(틀린 칸은 버림). 아무 칸도 없으면 null */
export function prefsPatch(raw: unknown): Partial<NodePrefs> | null {
  const b = obj(raw), out: Partial<NodePrefs> = {};
  if (typeof b.park_on === "boolean") out.park_on = b.park_on;
  if (typeof b.task_dots === "boolean") out.task_dots = b.task_dots;
  if (typeof b.task_channels === "boolean") out.task_channels = b.task_channels;
  if (typeof b.tree_tidy === "boolean") out.tree_tidy = b.tree_tidy;
  const repo = repoOf(b.task_repo); if (repo !== null) out.task_repo = repo;   // "" = 지우기
  if (b.front_door === null) out.front_door = null;   // null = 끄기
  else { const fd = frontDoorOf(b.front_door); if (fd) out.front_door = fd; }
  const h = hours(b.park_h); if (h !== null) out.park_h = h;
  if (typeof b.primary_item === "string" && b.primary_item.trim() && b.primary_item.length <= 300) out.primary_item = b.primary_item.trim();
  const r = obj(b.rules), rules: Rules = {};
  for (const k of RULE_KEYS) if (typeof r[k] === "boolean") rules[k] = r[k] as boolean;
  if (Object.keys(rules).length) out.rules = rules as Required<Rules>;
  const bn = obj(b.bundles), bundles: Record<string, boolean> = {};
  for (const k of BUNDLE_KEYS) if (typeof bn[k] === "boolean") bundles[k] = bn[k] as boolean;
  if (Object.keys(bundles).length) out.bundles = bundles;
  return Object.keys(out).length ? out : null;
}

/** 이 칸들만 D1 안에서 바꿈(json_set · rules 는 json_patch) — 읽고 통째로 쓰면 그 사이 저장한 다른 칸(unit · pri · faces)을 옛 값으로 덮음 */
export async function savePrefs(db: D1Database, owner: string, patch: Partial<NodePrefs>) {
  const base = "CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END";
  const sets: string[] = [], args: unknown[] = [];
  const put = (k: string, expr: string, v: unknown) => { sets.push(`'$.${k}', ${expr}`); args.push(v); };
  if (patch.park_on !== undefined) put("park_on", "json(?)", JSON.stringify(patch.park_on));
  if (patch.task_dots !== undefined) put("task_dots", "json(?)", JSON.stringify(patch.task_dots));
  if (patch.task_channels !== undefined) put("task_channels", "json(?)", JSON.stringify(patch.task_channels));
  if (patch.task_repo !== undefined) put("task_repo", "?", patch.task_repo);
  if (patch.tree_tidy !== undefined && patch.tree_tidy !== null) put("tree_tidy", "json(?)", JSON.stringify(patch.tree_tidy));
  if (patch.front_door !== undefined) put("front_door", "json(?)", JSON.stringify(patch.front_door));
  if (patch.park_h !== undefined) put("park_h", "?", patch.park_h);
  if (patch.primary_item !== undefined) put("primary_item", "?", patch.primary_item);
  if (patch.rules) put("rules", `json_patch(CASE WHEN json_valid(data) AND json_type(data, '$.rules') = 'object' THEN json_extract(data, '$.rules') ELSE '{}' END, json(?))`, JSON.stringify(patch.rules));
  if (patch.bundles) put("bundles", `json_patch(CASE WHEN json_valid(data) AND json_type(data, '$.bundles') = 'object' THEN json_extract(data, '$.bundles') ELSE '{}' END, json(?))`, JSON.stringify(patch.bundles));
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
