
export const REVOKED_SQL = "SELECT id FROM device WHERE owner = ? AND revoked_at IS NOT NULL";
export const REVOKED = (db: D1Database, owner: string) => db.prepare(REVOKED_SQL).bind(owner);

export function withRv<T extends object>(rows: T[], revoked: { id: unknown }[]): (T & { rv: number })[] {
  const off = new Set(revoked.map(r => String(r.id)));
  return rows.map(r => ({ ...r, rv: off.has(String((r as { device_id?: unknown }).device_id)) ? 1 : 0 }));
}
