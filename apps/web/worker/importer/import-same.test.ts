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
const { mountImport } = await import("./routes.ts");
const { Hono } = await import("hono");

const MIG = new URL("../../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const batch = async (ss: any[]) => { db.exec("BEGIN"); try { const out = []; for (const s of ss) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database };
}
const MEMBER = "member@example.com";
function app(D1: D1Database) {
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  mountImport(a, { device: async () => ({ id: "devMember01", owner: MEMBER, name: "member laptop" }), member: async () => null, sameSite: () => true });
  return async (body: unknown) => { const r = await a.request("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { DB: D1, PUBLIC_URL: "https://example.test" }); assert.equal(r.status, 200); return r.json() as Promise<any>; };
}
const body = (stateAt = 1000) => ({ host: "laptop", kinds: ["window"], items: [
  { key: "window:laptop:tmux:1", kind: "window", title: "주간 보고 정리", win: "laptop:tmux:1", state: "working", state_at: stateAt, engine: "tmux-own" },
  { key: "window:laptop:tmux:2", kind: "window", title: "회의록", win: "laptop:tmux:2", state: "idle", state_at: stateAt, engine: "tmux-own" },
] });
const audits = (db: DatabaseSync) => (db.prepare("SELECT COUNT(*) n FROM imp_audit WHERE owner = ?").get(MEMBER) as { n: number }).n;

test("같은 목록을 다시 보내면 묶기를 건너뛰고(대조 줄 안 늘어남) 노드 수 · 상태는 같게 답함", async () => {
  const { db, D1 } = d1(), post = app(D1);
  const r1 = await post(body());
  assert.equal(audits(db), 1);
  const nodes = db.prepare("SELECT id, state, updated_at FROM mnode WHERE owner = ? ORDER BY id").all(MEMBER);
  const r2 = await post(body());
  assert.equal(r2.same, true);
  assert.equal(audits(db), 1, "묶기를 안 돌림");
  assert.equal(r2.nodes, r1.nodes);
  assert.deepEqual(r2.states, r1.states);
  assert.deepEqual(db.prepare("SELECT id, state, updated_at FROM mnode WHERE owner = ? ORDER BY id").all(MEMBER), nodes, "노드 줄 그대로");
});

test("한 줄이라도 바뀌면 · 사라지면 · 마지막 묶기가 5분 넘으면 전처럼 묶음", async () => {
  const { db, D1 } = d1(), post = app(D1);
  await post(body());
  const r = await post(body(2000));   // state_at 바뀜
  assert.notEqual(r.same, true); assert.equal(audits(db), 2);
  const one = body(2000); one.items.pop();
  assert.notEqual((await post(one)).same, true, "창 하나 사라짐"); assert.equal(audits(db), 3);
  db.prepare("UPDATE imp_audit SET at = at - 6 * 60000 WHERE owner = ?").run(MEMBER);
  assert.notEqual((await post(one)).same, true, "5분 넘음 — 시간 지난 보관 · 주차를 맞추려 묶음"); assert.equal(audits(db), 4);
  assert.equal((await post(one)).same, true);
});

test("빈 목록(--stop) · MCP · 역할을 같이 보낸 것은 건너뛰지 않음", async () => {
  const { db, D1 } = d1(), post = app(D1);
  await post(body());
  assert.notEqual((await post({ ...body(), roles: [{ name: "리뷰어", from: "하네스 x" }] })).same, true);
  const n = audits(db);
  assert.notEqual((await post({ host: "laptop", kinds: ["window"], items: [] })).same, true);
  assert.equal(audits(db), n + 1);
});
