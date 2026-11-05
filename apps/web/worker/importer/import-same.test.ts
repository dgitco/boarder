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
const quiets: string[] = [];   // 회원 화면 알림을 안 보내게 표시한 요청(index.ts quiet → bumpMember 건너뜀)
function app(D1: D1Database) {
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  mountImport(a, { device: async () => ({ id: "devMember01", owner: MEMBER, name: "member laptop" }), member: async () => null, sameSite: () => true, quiet: c => { quiets.push(c.req.path); } });
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

const { fresh, dataGate } = await import("../member-board.ts");
test("fresh: 같은 사람 묶기가 도는 중이면 겹쳐 돌리지 않고, 끝나면 다음 것은 다시 묶음", async () => {
  const { db, D1 } = d1(), post = app(D1), env = { DB: D1, PUBLIC_URL: "https://example.test" };
  await post(body());
  const log = () => db.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").run(MEMBER, "laptop:tmux:1", "progress", "새 줄", Date.now() + 1000);
  log();
  const n = audits(db);
  await Promise.all(Array.from({ length: 8 }, () => fresh(env as never, MEMBER)));
  assert.equal(audits(db), n + 1, "여덟 번 불러도 묶기 한 번");
  db.prepare("UPDATE imp_audit SET at = 0 WHERE owner = ?").run(MEMBER);   // 다시 낡음
  await fresh(env as never, MEMBER);
  assert.ok((db.prepare("SELECT MAX(at) m FROM imp_audit WHERE owner = ?").get(MEMBER) as { m: number }).m > 0, "끝난 뒤에는 다시 묶음");
});
test("dataGate: 한 사람 5초에 60번까지, 넘으면 거절, 창이 지나면 다시 · 사람마다 따로", () => {
  const t = 1_000_000, me = "gate@example.com";
  for (let i = 0; i < 60; i++) assert.equal(dataGate(me, t + i), true);
  assert.equal(dataGate(me, t + 61), false);
  assert.equal(dataGate("other@example.com", t + 61), true);
  assert.equal(dataGate(me, t + 5_000), true);
});

test("같은 목록(아무것도 안 바뀜)일 때만 화면 알림을 끔 — 처음 · 바뀐 목록은 알림 그대로", async () => {
  const { D1 } = d1(), post = app(D1);
  quiets.length = 0;
  await post(body());
  assert.equal(quiets.length, 0, "처음 들여오기는 알림");
  const r2 = await post(body());
  assert.equal(r2.same, true); assert.equal(quiets.length, 1, "같은 목록은 알림 끔");
  await post(body(3000));
  assert.equal(quiets.length, 1, "state_at 이 바뀐 목록은 알림");
});

test("같은 목록이어도 기기 기능(features)이 바뀌면 알림 그대로", async () => {
  const { db, D1 } = d1(), post = app(D1);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)").run("devMember01", MEMBER, "member laptop", "", "h1", 1, 1, "full");
  const withF = (engine: boolean) => ({ ...body(), features: { report: ["claude"], engine } });
  quiets.length = 0;
  await post(withF(false));
  await post(withF(false));
  assert.equal(quiets.length, 1, "기능도 같으면 알림 끔");
  const r = await post(withF(true));
  assert.equal(r.same, true, "목록은 같음");
  assert.equal(quiets.length, 1, "기능이 바뀌었으니 알림");
});
