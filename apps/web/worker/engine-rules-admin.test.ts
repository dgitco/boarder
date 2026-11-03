import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", e); return new Response("{}", { status: 500 }); });

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => run1(sql, args),
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = ss.map(s => /^\s*select/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; } },
  } as unknown as D1Database;
  return { db, D1 };
}
const OWNER = "owner@example.test", A = "member@example.test", TOKEN = "admin-token-made-up";
test("engine-rules: default_roles 불리언은 저장돼 켜고 끌 수 있고, 숫자 · 문자는 걸러짐 · 다른 규칙과 함께 와도 됨", async () => {
  const { db, D1 } = d1();
  const env: any = { DB: D1, ADMIN_TOKEN: TOKEN, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test", SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const post = async (rules: unknown, auth = `Bearer ${TOKEN}`) => { const r = await app.fetch(new Request("https://example.test/api/admin/engine-rules", { method: "POST", headers: { "content-type": "application/json", authorization: auth }, body: JSON.stringify({ owner: A, rules }) }), env, ctx); return { status: r.status, j: await r.json() as any }; };
  assert.equal((await post({ default_roles: true }, "Bearer nope")).status, 403);
  let r = await post({ default_roles: true, one_goal: false, wake_min: 10 });
  assert.equal(r.status, 200); assert.equal(r.j.rules.default_roles, true); assert.equal(r.j.rules.one_goal, false); assert.equal(r.j.rules.wake_min, 10);
  r = await post({ default_roles: 5 as never }); assert.equal(r.j.rules.default_roles, false, "숫자는 걸러지고 기본(꺼짐)");
  r = await post({ default_roles: "true" as never }); assert.equal(r.j.rules.default_roles, false);
  r = await post({ default_roles: true }); assert.equal(r.j.rules.default_roles, true);
  r = await post({ default_roles: false }); assert.equal(r.j.rules.default_roles, false);
  const { RULES } = await import("./engine.ts"); assert.equal(RULES.default_roles, false, "기본 꺼짐");
});
