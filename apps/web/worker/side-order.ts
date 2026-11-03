export const SIDE_KEYS = ["ib", "nd", "ch", "rc", "ss", "xc"] as const;
const BASE = "CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END";

/** 받은 값 → 저장할 순서(틀리면 null) */
export function cleanSide(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > 20) return null;
  const out: string[] = [];
  for (const k of v) if (typeof k === "string" && (SIDE_KEYS as readonly string[]).includes(k) && !out.includes(k)) out.push(k);
  return out.length ? out : null;
}

export async function readSide(db: D1Database, owner: string): Promise<string[] | null> {
  const r = await db.prepare(`SELECT json_extract(${BASE}, '$.side') s FROM node_setting WHERE owner = ?`).bind(owner).first<{ s: string | null }>().catch(() => null);
  if (!r?.s) return null;
  try { return cleanSide(JSON.parse(r.s)); } catch { return null; }
}

export async function saveSide(db: D1Database, owner: string, side: string[]) {
  await db.prepare(`INSERT INTO node_setting (owner, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(owner) DO UPDATE SET data = json_set(${BASE}, '$.side', json(?4)), updated_at = ?3`)
    .bind(owner, JSON.stringify({ side }), Date.now(), JSON.stringify(side)).run();
}
