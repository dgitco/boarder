import { RAW } from "./agent-token-cache";
type Row = Record<string, unknown>;
export function verCache(name: string, verSql: string, rowsSql: string, maxRows = 40_000, ttl = 600_000) {
  const memo = new WeakMap<object, Map<string, { v: number; rows: Row[]; at: number }>>();
  const keyOf = (db: D1Database) => ((db as unknown as Record<symbol, object>)[RAW]) || db;
  const copy = (rs: Row[]) => rs.map(r => ({ ...r }));
  const vOf = (r: D1Result) => Number((r.results?.[0] as { v?: number } | undefined)?.v ?? 0);
  const put = (db: D1Database, owner: string, v: number, rows: Row[]) => {
    const k = keyOf(db); let m = memo.get(k); if (!m) { m = new Map(); memo.set(k, m); }
    const now = Date.now(); let n = 0;
    for (const [o, e] of m) { if (now - e.at >= ttl || o === owner) m.delete(o); else n += e.rows.length; }
    if (n + rows.length <= maxRows) m.set(owner, { v, rows, at: now });
  };
  const re = new RegExp(`no such table:?\\s*${name}`, "i");
  return {
    noTable: (e: unknown) => re.test(String((e as Error)?.message || e)),
    forget: (db: D1Database, owner?: string) => { const m = memo.get(keyOf(db)); if (m) owner === undefined ? m.clear() : m.delete(owner); },
    plain: (db: D1Database, owner: string) => ({ stmts: [db.prepare(rowsSql).bind(owner)], done: async (res: D1Result[]) => copy((res[0].results || []) as Row[]) }),
    stmts(db: D1Database, owner: string) {
      const m = memo.get(keyOf(db))?.get(owner), hit = !!m && Date.now() - m.at < ttl;
      const ver = () => db.prepare(verSql).bind(owner), rows = () => db.prepare(rowsSql).bind(owner);
      return {
        stmts: hit ? [ver()] : [ver(), rows()],
        done: async (res: D1Result[]): Promise<Row[]> => {
          const v = vOf(res[0]);
          if (hit && m!.v === v) return copy(m!.rows);
          let vv = v, rs: Row[];
          if (hit) { const [a, b] = await db.batch([ver(), rows()]); vv = vOf(a); rs = (b.results || []) as Row[]; }
          else rs = (res[1].results || []) as Row[];
          put(db, owner, vv, copy(rs)); return copy(rs);
        },
      };
    },
  };
}
