export const RAW = Symbol.for("bx.rawdb");
type Row = { pane: string; win: string };
type St = { byId: Map<number, { pane: string; win: string; at: number }>; max: number; list: Row[] | null };
const OVERLAP_MS = 120_000, MAX_OWNERS = 100, MAX_ROWS = 60_000;
const all = new WeakMap<object, Map<string, St>>();

export async function tokenRows(db: D1Database, owner: string): Promise<Row[]> {
  const key = ((db as unknown as Record<symbol, object>)[RAW]) || db;
  let m = all.get(key); if (!m) { m = new Map(); all.set(key, m); }
  const st = m.get(owner);
  const q = st
    ? db.prepare("SELECT rowid AS rid, pane, win, created_at AS at FROM agent_token WHERE owner = ? AND created_at >= ? ORDER BY created_at").bind(owner, st.max - OVERLAP_MS)
    : db.prepare("SELECT rowid AS rid, pane, win, created_at AS at FROM agent_token WHERE owner = ? ORDER BY created_at").bind(owner);
  const rs = (await q.all<{ rid: number; pane: string; win: string; at: number }>()).results || [];
  const s: St = st || { byId: new Map(), max: 0, list: null };
  let changed = !st;
  for (const r of rs) {
    const at = Number(r.at) || 0;
    if (!s.byId.has(r.rid)) { s.byId.set(r.rid, { pane: r.pane, win: r.win, at }); changed = true; }
    if (at > s.max) s.max = Math.min(at, Date.now());
  }
  if (changed || !s.list) s.list = [...s.byId.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0]).map(([, v]) => ({ pane: v.pane, win: v.win }));   // 원래 질의와 같은 순서(created_at, 같으면 rowid)
  if (!st) m.set(owner, s);
  // 상한: 사람 수 · 전체 줄 수 — 들어온 순서대로 버림(버린 사람은 다음에 다시 전체 읽기, 결과는 같음)
  let rows = 0; for (const v of m.values()) rows += v.byId.size;
  for (const k of m.keys()) { if (m.size <= MAX_OWNERS && rows <= MAX_ROWS) break; if (k === owner && m.size > 1) continue; rows -= m.get(k)!.byId.size; m.delete(k); }
  return s.list;
}
