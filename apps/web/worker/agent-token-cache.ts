export const RAW = Symbol.for("bx.rawdb");
type Row = { pane: string; win: string };
type St = { byId: Map<number, { pane: string; win: string; at: number }>; max: number; list: Row[] | null; snapAt?: number; snapN?: number; fullAt?: number };
const OVERLAP_MS = 120_000, MAX_OWNERS = 100, MAX_ROWS = 60_000;
const all = new WeakMap<object, Map<string, St>>();

const SNAP_TTL = 3600, SNAP_FULL_MS = 3_600_000, SNAP_REFRESH_MS = 1_800_000, SNAP_REFRESH_ROWS = 500, SNAP_BASE = "https://boarder-cache.internal/agent-token/v1/";
type Snap = { max: number; at: number; full: number; rows: [number, string, string, number][] };
const edge = () => { try { return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default || null; } catch { return null; } };
async function snapKey(owner: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bx-tk:" + owner)));
  return SNAP_BASE + [...d.slice(0, 16)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function snapGet(owner: string): Promise<Snap | null> {
  const c = edge(); if (!c) return null;
  try { const r = await c.match(await snapKey(owner)); return r ? await r.json() as Snap : null; } catch { return null; }
}
async function snapPut(owner: string, st: St) {
  const c = edge(); if (!c) return;
  const rows = [...st.byId.entries()].map(([rid, v]) => [rid, v.pane, v.win, v.at] as [number, string, string, number]);
  try { await c.put(await snapKey(owner), new Response(JSON.stringify({ max: st.max, at: Date.now(), full: st.fullAt ?? 0, rows } satisfies Snap), { headers: { "content-type": "application/json", "cache-control": `max-age=${SNAP_TTL}` } })); st.snapAt = Date.now(); st.snapN = st.byId.size; } catch { /* 사본은 덤 — 실패해도 맞는 값 */ }
}

export async function tokenRows(db: D1Database, owner: string): Promise<Row[]> {
  const key = ((db as unknown as Record<symbol, object>)[RAW]) || db;
  let m = all.get(key); if (!m) { m = new Map(); all.set(key, m); }
  let st = m.get(owner), seeded = false;
  if (!st) {   // 이 isolate 처음 — 입구 캐시 사본에서 시작(있으면)
    const sn = await snapGet(owner);
    if (sn && Array.isArray(sn.rows) && Date.now() - (Number(sn.full) || 0) < SNAP_FULL_MS) {
      st = { byId: new Map(sn.rows.map(([rid, pane, win, at]) => [rid, { pane, win, at }])), max: Number(sn.max) || 0, list: null, snapAt: Number(sn.at) || 0, snapN: sn.rows.length, fullAt: Number(sn.full) };
      m.set(owner, st); seeded = true;
    }
  }
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
  if (!st) { s.fullAt = Date.now(); m.set(owner, s); }   // 통째로 읽음
  // 사본 올리기: 통째로 읽었을 때(사본이 없었음) · 사본 뒤 줄이 많아졌거나 오래됐을 때
  if (!st || (s.byId.size - (s.snapN ?? 0) > SNAP_REFRESH_ROWS) || (seeded === false && s.snapAt !== undefined && Date.now() - s.snapAt > SNAP_REFRESH_MS)) await snapPut(owner, s);
  // 상한: 사람 수 · 전체 줄 수 — 들어온 순서대로 버림(버린 사람은 다음에 다시 전체 읽기, 결과는 같음)
  let rows = 0; for (const v of m.values()) rows += v.byId.size;
  for (const k of m.keys()) { if (m.size <= MAX_OWNERS && rows <= MAX_ROWS) break; if (k === owner && m.size > 1) continue; rows -= m.get(k)!.byId.size; m.delete(k); }
  return s.list;
}
