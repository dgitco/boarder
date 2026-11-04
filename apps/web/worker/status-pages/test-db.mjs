// 시험 전용: 가짜 D1(메모리 SQLite, migrations/*.sql 을 다 돌린 표) — 상태 페이지 시험들이 같이 씀. 워커 빌드 · tsc 에 안 들어감(.mjs)
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
export function d1() {
  const db = new DatabaseSync(":memory:"), MIG = new URL("../../migrations/", import.meta.url);
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql, args = []) => ({
    sql, args, bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    raw: async () => db.prepare(sql).all(...args).map(r => Object.values(r)),
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const batch = async ss => {
    db.exec("BEGIN");
    try { const out = []; for (const s of ss) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { db, D1: { prepare: sql => stmt(sql), batch } };
}
