export const SIDE_KEYS = ["ib", "nd", "ch", "rc", "ss", "xc"] as const;
const BASE = "CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END";

export type Pin = { id: string; title: string };
export function cleanPins(v: unknown): Pin[] | null {
  if (!Array.isArray(v) || v.length > 12) return null;   // 화면 안내: 주소가 틀리거나 12개를 넘음
  const out: Pin[] = [];
  for (const x of v) {
    const id = String((x as Pin)?.id ?? ""), title = String((x as Pin)?.title ?? "").trim().slice(0, 60);
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return null;
    if (!out.some(p => p.id === id)) out.push({ id, title: title || id });
  }
  return out;
}
/** 래퍼 값(person_custom.wside) — 그 사람 값이 없을 때만 씀. 표가 아직 없거나 깨졌으면 없는 것 */
async function wrapperSide(db: D1Database, owner: string): Promise<{ side?: unknown; pins?: unknown } | null> {
  const r = await db.prepare("SELECT wside s FROM person_custom WHERE owner = ?").bind(owner).first<{ s: string | null }>().catch(() => null);
  try { return r?.s ? JSON.parse(r.s) : null; } catch { return null; }
}
/** 그 사람이 한 번이라도 저장했으면(빈 목록 포함) 그 값, 아니면 래퍼 값 */
export async function readPins(db: D1Database, owner: string): Promise<Pin[]> {
  const r = await db.prepare(`SELECT json_extract(${BASE}, '$.pins') s FROM node_setting WHERE owner = ?`).bind(owner).first<{ s: string | null }>().catch(() => null);
  if (!r?.s) return (cleanPins((await wrapperSide(db, owner))?.pins) ?? []);
  try { return cleanPins(JSON.parse(r.s)) ?? []; } catch { return []; }
}
export async function savePins(db: D1Database, owner: string, pins: Pin[]) {
  await db.prepare(`INSERT INTO node_setting (owner, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(owner) DO UPDATE SET data = json_set(${BASE}, '$.pins', json(?4)), updated_at = ?3`)
    .bind(owner, JSON.stringify({ pins }), Date.now(), JSON.stringify(pins)).run();
}

/** 받은 값 → 저장할 순서(틀리면 null) */
export function cleanSide(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > 20) return null;
  const out: string[] = [];
  for (const k of v) if (typeof k === "string" && (SIDE_KEYS as readonly string[]).includes(k) && !out.includes(k)) out.push(k);
  return out.length ? out : null;
}

export async function readSide(db: D1Database, owner: string): Promise<string[] | null> {
  const r = await db.prepare(`SELECT json_extract(${BASE}, '$.side') s FROM node_setting WHERE owner = ?`).bind(owner).first<{ s: string | null }>().catch(() => null);
  if (!r?.s) return cleanSide((await wrapperSide(db, owner))?.side);
  try { return cleanSide(JSON.parse(r.s)); } catch { return null; }
}

export async function saveSide(db: D1Database, owner: string, side: string[]) {
  await db.prepare(`INSERT INTO node_setting (owner, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(owner) DO UPDATE SET data = json_set(${BASE}, '$.side', json(?4)), updated_at = ?3`)
    .bind(owner, JSON.stringify({ side }), Date.now(), JSON.stringify(side)).run();
}
