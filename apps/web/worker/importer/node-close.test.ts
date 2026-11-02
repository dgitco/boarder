import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

// engine.ts 의 cloudflare:workers 는 Workers 밖에 없음 — 빈 DurableObject 로 갈음(engine-sec.test.ts 와 같음)
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { mountImport } = await import("./routes.ts");
const { IMPORT_WIN } = await import("./proposal.ts");
const { Hono } = await import("hono");

const MIG = new URL("../../migrations/", import.meta.url);
// failOnce: 이 SQL 이 처음 한 번 실패(D1 일시 오류) — 그 묶음은 통째로 안 씀(D1 batch 는 한 트랜잭션)
function d1(failOnce?: RegExp) {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  let armed = !!failOnce;
  const trip = (sql: string) => { if (armed && failOnce!.test(sql)) { armed = false; throw new Error("D1_ERROR: Network connection lost."); } };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => { trip(sql); return { results: db.prepare(sql).all(...(args as never[])) }; },
    first: async () => { trip(sql); return db.prepare(sql).get(...(args as never[])) ?? null; },
    run: async () => { trip(sql); const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const batch = async (ss: any[]) => {
    for (const s of ss) trip(s.sql);
    db.exec("BEGIN");
    try { const out = []; for (const s of ss) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database };
}

const A = "member@example.com", B = "other@example.com";
function app(D1: D1Database, who: { device?: string | null; member?: string | null; same?: boolean } = { device: A }) {
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  mountImport(a, { device: async () => who.device ? { id: "dev1", owner: who.device, name: "laptop" } : null, member: async () => who.member ?? null, sameSite: () => who.same ?? false });
  return (method: string, path: string, body?: unknown) => a.request(path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: D1, PUBLIC_URL: "https://example.test" });
}
const T = Date.now() - 60_000;
const add = (db: DatabaseSync, who: string, id: string, name: string, area = "acme") =>
  db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)").run(who, id, name, area, "idle", "", T, T);
function seed() {
  const f = d1();
  add(f.db, A, "n_keep", "팀장"); add(f.db, A, "n_tmp", "tmp 2d", "tmp"); add(f.db, A, "sl_C01", "Slack · #공지", "slack"); add(f.db, B, "n_other", "남의 노드");
  return f;
}

test("닫기 → 목록에 closed, 보드 트리 · 채널 목록에서 빠짐, 다시 열기 → 돌아옴", async () => {
  const { D1 } = seed(), call = app(D1);
  const { data } = await import("../member-board.ts");
  const names = async () => ((await data(D1, A, null)) as any).panes.map((p: any) => p.win).sort();
  const before = await names();
  assert.ok(before.includes("tmp 2d") && before.includes("Slack · #공지"));
  const r = await call("POST", "/api/me/nodes/close", { nodes: ["n_tmp", "sl_C01"] });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, closed: 2, changed: 2 });
  const after = await names();
  assert.ok(!after.includes("tmp 2d") && !after.includes("Slack · #공지") && after.includes("팀장"), "닫은 둘만 빠짐");
  const l = await (await call("GET", "/api/me/nodes/list")).json() as any;
  assert.deepEqual(l.nodes.filter((n: any) => n.closed).map((n: any) => n.id).sort(), ["n_tmp", "sl_C01"]);
  assert.ok(!l.nodes.some((n: any) => n.id === "n_other"), "남의 노드는 목록에 없음");
  await call("POST", "/api/me/nodes/close", { nodes: ["n_tmp"], open: true });
  const again = await names();
  assert.ok(again.includes("tmp 2d") && !again.includes("Slack · #공지"));
});

test("남의 · 없는 노드가 하나라도 있으면 404 · 아무것도 안 바꿈, 빈 목록 400", async () => {
  const { db, D1 } = seed(), call = app(D1);
  const r = await call("POST", "/api/me/nodes/close", { nodes: ["n_tmp", "n_other"] });
  assert.equal(r.status, 404); assert.deepEqual((await r.json() as any).missing, ["n_other"]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM node_setting WHERE owner = ?").get(A)!.n, 0);
  assert.equal((await call("POST", "/api/me/nodes/close", { nodes: [] })).status, 400);
});

test("회원 쿠키는 같은 사이트일 때만 쓰기, 기기 토큰은 Bearer 라 사이트 검사 없음, 둘 다 없으면 401", async () => {
  const { D1 } = seed();
  assert.equal((await app(D1, { member: A, same: false })("POST", "/api/me/nodes/close", { nodes: ["n_tmp"] })).status, 401);
  assert.equal((await app(D1, { member: A, same: true })("POST", "/api/me/nodes/close", { nodes: ["n_tmp"] })).status, 200);
  assert.equal((await app(D1, { member: A, same: false })("GET", "/api/me/nodes/list")).status, 200);
  assert.equal((await app(D1, { device: null })("GET", "/api/me/nodes/list")).status, 401);
});

test("다시 묶어도(regroup) 닫힌 채 — 다른 설정 칸(pri)은 그대로", async () => {
  const { db, D1 } = seed(), call = app(D1);
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?, ?, ?)").run(A, JSON.stringify({ pri: { 팀장: { pri: "high" } } }), T);
  await call("POST", "/api/me/nodes/close", { nodes: ["n_tmp"] });
  const { regroup } = await import("./routes.ts");
  await regroup({ DB: D1 } as any, A);
  const data = JSON.parse(String(db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(A)!.data));
  assert.deepEqual(data.closed, ["n_tmp"]); assert.deepEqual(data.pri, { 팀장: { pri: "high" } });
});

test("닫고 보관된 노드를 보관함 「다시 열기」(edit reopen)로 열면 닫힘도 풀려 다시 보임(성공이라 답하고 안 보이던 것)", async () => {
  const { db, D1 } = seed(), call = app(D1);
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET data = excluded.data").run(A, JSON.stringify({ unit: "goal" }), Date.now());
  db.prepare("INSERT INTO imp_item(owner, key, kind, engine, title, cwd, state, seen_at) VALUES (?,?,?,?,?,?,?,?)").run(A, "k1", "window", "tmux-own", "tmp", "/tmp", "idle", Date.now());
  db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)").run(A, "k1", "n_tmp", "pin");
  assert.equal((await call("POST", "/api/me/nodes/close", { nodes: ["n_tmp", "sl_C01"] })).status, 200);
  db.prepare("UPDATE mnode SET archived_at = ? WHERE owner = ? AND id = ?").run(Date.now(), A, "n_tmp");
  const r = await app(D1, { member: A, same: true })("POST", "/api/me/nodes/edit", { op: "reopen", node: "n_tmp" });
  assert.equal(r.status, 200);
  const closed = JSON.parse(String((db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(A) as any).data)).closed;
  assert.deepEqual(closed, ["sl_C01"], "다시 연 것만 닫힘에서 빠짐");
  const { data } = await import("../member-board.ts");
  assert.ok(((await data(D1, A, null)) as any).panes.some((p: any) => p.win === "tmp 2d"), "다시 보임");
});

test("상위 정하기: 내 노드끼리만 · 자기 자신 · 서로 상위면 400 · null 이면 지움 · 목록에 parent", async () => {
  const { db, D1 } = seed(), call = app(D1);
  assert.equal((await call("POST", "/api/me/nodes/parent", { node: "n_tmp", parent: "n_keep" })).status, 200);
  assert.equal((await call("POST", "/api/me/nodes/parent", { node: "n_keep", parent: "n_tmp" })).status, 400, "서로 상위");
  assert.equal((await call("POST", "/api/me/nodes/parent", { node: "n_tmp", parent: "n_tmp" })).status, 400);
  assert.equal((await call("POST", "/api/me/nodes/parent", { node: "n_tmp", parent: "n_other" })).status, 404, "남의 노드");
  const l = await (await call("GET", "/api/me/nodes/list")).json() as any;
  assert.equal(l.nodes.find((n: any) => n.id === "n_tmp").parent, "n_keep");
  await call("POST", "/api/me/nodes/close", { nodes: ["sl_C01"] });
  const data = JSON.parse(String(db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(A)!.data));
  assert.deepEqual([data.parent, data.closed], [{ n_tmp: "n_keep" }, ["sl_C01"]], "닫기와 상위가 서로 안 지움");
  await call("POST", "/api/me/nodes/parent", { node: "n_tmp", parent: null });
  assert.deepEqual(JSON.parse(String(db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(A)!.data)).parent, {});
});
