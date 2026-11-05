// node --test --no-warnings --experimental-transform-types apps/web/worker/ver-cache.test.ts (Node 22.18+ · node:sqlite)
// 회원 읽음 표시 맡김(ver-cache.ts · 이주 0084): 번호가 같으면 줄을 다시 안 읽고, 읽음을 올리면(값이 바뀔 때만) 다시 읽고, 요청마다 재기 감싸개여도 맞고, 표가 없으면 예전 질의. 자료는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { SEEN } = await import("./member-inbox.ts");
const { meterEnv, newMeter } = await import("./perf.ts");
const MIG = new URL("../migrations/", import.meta.url);
function d1(drop = false) {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  if (drop) db.exec("DROP TRIGGER member_seen_ver_ins; DROP TRIGGER member_seen_ver_upd; DROP TRIGGER member_seen_ver_del; DROP TABLE member_seen_ver;");
  let reads = 0;
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => { if (/FROM member_seen WHERE owner = \?$/.test(sql)) reads++; return { results: db.prepare(sql).all(...(args as never[])) }; },
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null, raw: async () => [],
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; } });
  const batch = async (ss: any[]) => { const out = []; for (const s of ss) out.push(await s.all()); return out; };
  return { db, reads: () => reads, D1: { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database };
}
const A = "seen@example.com";
const up = (db: DatabaseSync, pane: string, at: number) => db.prepare("INSERT INTO member_seen(owner, pane, at) VALUES (?,?,?) ON CONFLICT(owner, pane) DO UPDATE SET at = MAX(at, excluded.at)").run(A, pane, at);
async function read(D: D1Database) {   // member-inbox inbox 와 같은 꼴: 번호 첫 칸 · 줄은 끝, 표 없으면 예전 질의
  let s: any = SEEN.stmts(D, A), B: D1Result[];
  try { B = await D.batch(s.stmts); } catch (e) { if (!SEEN.noTable(e)) throw e; s = SEEN.plain(D, A); B = await D.batch(s.stmts); }
  return (await s.done(B)).map((r: any) => `${r.pane}:${r.at}`).sort();
}
test("읽음 표시 맡김: 번호가 같으면 다시 안 읽음 · 같은 값 올림은 번호 그대로 · 값이 바뀌면 다시 · 재기 감싸개여도 맞음", async () => {
  const f = d1(); SEEN.forget(f.D1);
  up(f.db, "%3", 1000); up(f.db, "%4", 2000);
  const wrap = () => meterEnv({ DB: f.D1 } as never, newMeter()).DB;
  assert.deepEqual(await read(wrap()), ["%3:1000", "%4:2000"]);
  assert.deepEqual(await read(wrap()), ["%3:1000", "%4:2000"]); assert.equal(f.reads(), 1, "두 번째는 맡긴 줄");
  up(f.db, "%3", 500); assert.deepEqual(await read(wrap()), ["%3:1000", "%4:2000"]); assert.equal(f.reads(), 1, "MAX 라 값이 안 바뀌면 번호 그대로");
  up(f.db, "%3", 3000); assert.deepEqual(await read(wrap()), ["%3:3000", "%4:2000"]); assert.equal(f.reads(), 2, "값이 바뀌면 다시 읽음");
  f.db.prepare("DELETE FROM member_seen WHERE owner = ? AND pane = '%4'").run(A); assert.deepEqual(await read(wrap()), ["%3:3000"]); assert.equal(f.reads(), 3, "지우기도");
});
test("읽음 표시: 번호 표가 없으면(이주 전 · 지운 뒤) 예전 질의로 한 번 더 — 맡기지 않음", async () => {
  const f = d1(true); SEEN.forget(f.D1);
  up(f.db, "%3", 1000);
  const real = (f.D1 as any).batch; (f.D1 as any).batch = (ss: any[]) => ss.some(s => /member_seen_ver/.test(s.sql)) ? Promise.reject(new Error("D1_ERROR: no such table: member_seen_ver: SQLITE_ERROR")) : real(ss);
  assert.deepEqual(await read(f.D1), ["%3:1000"]); assert.deepEqual(await read(f.D1), ["%3:1000"]);
  assert.equal(f.reads(), 2, "그때그때 읽음");
});
