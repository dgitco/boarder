import { RAW } from "./agent-token-cache";
export type MapRow = { item: string; node: string; how: string };
const TTL = 600_000, MAX_ROWS = 40_000, memo = new WeakMap<object, Map<string, { v: number; rows: MapRow[]; at: number }>>();
const keyOf = (db: D1Database) => ((db as unknown as Record<symbol, object>)[RAW]) || db;
const copy = (rs: MapRow[]) => rs.map(r => ({ item: r.item, node: r.node, how: r.how }));
export function mapForget(db: D1Database, owner?: string) { const m = memo.get(keyOf(db)); if (!m) return; if (owner === undefined) m.clear(); else m.delete(owner); }   // 시험용
function put(db: D1Database, owner: string, v: number, rows: MapRow[]) {
  const k = keyOf(db); let m = memo.get(k); if (!m) { m = new Map(); memo.set(k, m); }
  const now = Date.now(); let n = 0;
  for (const [o, e] of m) { if (now - e.at >= TTL || o === owner) m.delete(o); else n += e.rows.length; }
  if (n + rows.length <= MAX_ROWS) m.set(owner, { v, rows, at: now });   // 넘으면 맡기지 않음(isolate 128MB)
}
const VER = "SELECT v FROM mnode_item_ver WHERE owner = ?", ROWS = "SELECT item, node, how FROM mnode_item WHERE owner = ?";
/** batch 에 넣을 문장(첫 칸은 늘 번호, 맡김이 없으면 둘째 칸에 줄)과, batch 결과로 줄을 내는 done */
export function mapStmts(db: D1Database, owner: string) {
  const m = memo.get(keyOf(db))?.get(owner), hit = !!m && Date.now() - m.at < TTL;
  const ver = () => db.prepare(VER).bind(owner), rows = () => db.prepare(ROWS).bind(owner);
  return {
    stmts: hit ? [ver()] : [ver(), rows()],
    done: async (res: D1Result[]): Promise<MapRow[]> => {
      const v = Number((res[0].results?.[0] as { v?: number } | undefined)?.v ?? 0);
      if (hit && m!.v === v) return copy(m!.rows);
      let vv = v, rs: MapRow[];
      if (hit) { const [a, b] = await db.batch([ver(), rows()]); vv = Number((a.results?.[0] as { v?: number } | undefined)?.v ?? 0); rs = (b.results || []) as MapRow[]; }
      else rs = (res[1].results || []) as MapRow[];
      put(db, owner, vv, copy(rs)); return copy(rs);
    },
  };
}
/** 번호 없이 줄만(예전 질의) — 번호 표가 없을 때 */
export function mapPlain(db: D1Database, owner: string) {
  return { stmts: [db.prepare(ROWS).bind(owner)], done: async (res: D1Result[]) => copy((res[0].results || []) as MapRow[]) };
}
export const noVerTable = (e: unknown) => /no such table:?\s*mnode_item_ver/i.test(String((e as Error)?.message || e));
