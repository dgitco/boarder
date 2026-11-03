import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

// engine.ts 의 cloudflare:workers 는 Workers 밖에 없음 — 빈 DurableObject 로 갈음(node-close.test.ts 와 같음)
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { mountImport, regroup } = await import("./routes.ts");
const { Hono } = await import("hono");

const MIG = new URL("../../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const batch = async (ss: any[]) => {
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
const { post } = await import("../member-board.ts");
const { paneOfId } = await import("../member-board.ts");
const ENV = { DB: null as unknown as D1Database, PUBLIC_URL: "https://example.test" };
const T = Date.now() - 60_000;
const win = (db: DatabaseSync, who: string, key: string, title: string, session = "", state = "working") =>
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, session, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(who, key, "dev1", "window", "tmux", title, "/x/ledger", state, T, key.slice(7), session, Date.now());
const mapOf = (db: DatabaseSync, item: string) => { const r = db.prepare("SELECT node, how FROM mnode_item WHERE owner = ? AND item = ?").get(A, item) as any; return r ? { ...r } : r; };
async function seed() {
  const f = d1(), call = app(f.D1);
  f.db.prepare("INSERT INTO device(id, owner, name, token_hash, created_at) VALUES (?,?,?,?,?)").run("dev1", A, "mbp", "h1", Date.now());
  await call("POST", "/api/device/tasks", { tasks: [{ key: "sales", name: "Sales", parent: "top" }, { key: "1969", name: "세일즈 덱 확정", parent: "tk_sales" }] });
  win(f.db, A, "window:mbp:ew_a", "덱 작업 창", "session:claude:s1");
  f.db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, title, state, session, seen_at) VALUES (?,?,?,?,?,?,?,?)").run(A, "session:claude:s1", "dev1", "session", "덱 대화", "open", "session:claude:s1", Date.now());
  win(f.db, B, "window:mbp:ew_b", "남의 창");
  await regroup({ ...ENV, DB: f.D1 } as never, A);
  return { ...f, call };
}
const say = (D1: D1Database, text: string) => post(D1, A, "/api/chat", { pane: paneOfId("tk_1969"), channel: "n:세일즈 덱 확정", text });

test("붙이기: 창(과 같은 대화)이 업무 노드에 pin · 주 창 · 묶기 뒤에도 그대로 — 노드 채팅 글이 그 창으로", async () => {
  const { db, D1, call } = await seed();
  assert.equal(((await say(D1, "덱 새 판 보여 줘")) as any).path, "/api/me/tasks/assign", "붙이기 전 = 창이 없어 배정기로(④)");
  const r = await call("POST", "/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:ew_a" });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(mapOf(db, "window:mbp:ew_a"), { node: "tk_1969", how: "pin" });
  assert.deepEqual(mapOf(db, "session:claude:s1"), { node: "tk_1969", how: "pin" }, "같은 대화(세션)도 같이 — 보드 「옮기기」와 같음");
  assert.equal(JSON.parse((db.prepare("SELECT counts FROM mnode WHERE owner = ? AND id = 'tk_1969'").get(A) as any).counts).main, "window:mbp:ew_a");
  await regroup({ ...ENV, DB: D1 } as never, A);
  assert.deepEqual(mapOf(db, "window:mbp:ew_a"), { node: "tk_1969", how: "pin" }, "묶기 뒤에도 그대로");
  const hop = await say(D1, "덱 새 판 보여 줘") as any;
  assert.equal(hop.path, "/api/me/nodes/cmd"); assert.equal(hop.body.item, "window:mbp:ew_a"); assert.equal(hop.body.verb, "send");
  const row = db.prepare("SELECT name, area, state FROM mnode WHERE owner = ? AND id = 'tk_1969'").get(A) as any;
  assert.deepEqual({ ...row }, { name: "세일즈 덱 확정", area: "", state: "working" }, "업무 노드 줄은 장부 것 그대로");
});

test("떼기: 창이 묶기가 정한 제자리로 · 주 창 지움 · 노드 채팅은 다시 「창이 없어요」 · item 없이 떼면 그 노드 창 전부", async () => {
  const { db, D1, call } = await seed();
  await call("POST", "/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:ew_a" });
  const r = await call("POST", "/api/device/tasks/detach", { node: "tk_1969" });
  assert.equal(r.status, 200, await r.clone().text());
  const m = mapOf(db, "window:mbp:ew_a");
  assert.ok(m && m.node !== "tk_1969" && m.how === "auto", JSON.stringify(m));
  assert.notEqual(mapOf(db, "session:claude:s1")?.node, "tk_1969");
  assert.equal(JSON.parse((db.prepare("SELECT counts FROM mnode WHERE owner = ? AND id = 'tk_1969'").get(A) as any).counts).main, undefined);
  assert.equal(((await say(D1, "다시")) as any).path, "/api/me/tasks/assign", "뗀 뒤 = 다시 배정기로(④)");
});

test("거절: 업무 노드가 아님 · 없는 · 남의 창 · 닫힌 창 · 토큰 없음 — 아무것도 안 바꿈", async () => {
  const { db, D1, call } = await seed();
  db.prepare("UPDATE imp_item SET gone_at = ? WHERE owner = ? AND key = 'window:mbp:ew_a'").run(Date.now(), A);
  win(db, A, "window:mbp:ew_live", "산 창");
  await regroup({ ...ENV, DB: D1 } as never, A);
  const auto = (db.prepare("SELECT node FROM mnode_item WHERE owner = ? AND item = 'window:mbp:ew_live'").get(A) as any).node;
  const bad = async (path: string, body: unknown, status: number, c = call) => { const r = await c("POST", path, body); assert.equal(r.status, status, `${path} ${JSON.stringify(body)} → ${await r.text()}`); };
  await bad("/api/device/tasks/attach", { node: auto, item: "window:mbp:ew_live" }, 400);   // 보통 노드는 보드 「옮기기」
  await bad("/api/device/tasks/attach", { node: "tk_nope", item: "window:mbp:ew_live" }, 404);
  await bad("/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:ew_b" }, 404);
  await bad("/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:ew_a" }, 404);
  await bad("/api/device/tasks/attach", { node: "tk_1969", item: "session:claude:s1" }, 404);
  await bad("/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:ew_live" }, 401, app(D1, { device: null }));
  await bad("/api/device/tasks/detach", { node: "tk_nope" }, 404);
  assert.equal((db.prepare("SELECT node FROM mnode_item WHERE owner = ? AND item = 'window:mbp:ew_live'").get(A) as any).node, auto);
});

test("업무가 끝나면(완료 · 취소) 붙은 창을 놓아줌 — 보관된 노드와 같이 보드에서 사라지지 않게 · 끝난 업무엔 못 붙임", async () => {
  const { db, call } = await seed();
  await call("POST", "/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:ew_a" });
  assert.equal((await call("POST", "/api/device/tasks", { tasks: [{ key: "1969", state: "done" }] })).status, 200);
  assert.notEqual(mapOf(db, "window:mbp:ew_a")?.node, "tk_1969");
  assert.equal(JSON.parse((db.prepare("SELECT counts FROM mnode WHERE owner = ? AND id = 'tk_1969'").get(A) as any).counts).main, undefined);
  assert.equal((await call("POST", "/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:ew_a" })).status, 400);
});

test("에이전트마다 채널인 회원: 노드 채팅 글은 주 창(counts.main)으로 — 붙인 창이 둘째여도", async () => {
  const { db, D1, call } = await seed();
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET data = json_set(data, '$.unit', 'agent')").run(A, JSON.stringify({ unit: "agent" }), T);
  win(db, A, "window:mbp:ew_z", "다른 창");
  await call("POST", "/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:ew_z" });
  await call("POST", "/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:ew_a" });
  const hop = await say(D1, "덱") as any;
  assert.equal(hop.body?.item, "window:mbp:ew_a", JSON.stringify(hop));
});

test("붙은 창을 보더 엔진으로 옮겨 타면(move) 새 창도 그 업무 노드에 · 주 창도 새 창 · 보고만 하는 창 · 끊긴 기기 창은 못 붙임", async () => {
  const { db, call } = await seed();
  await call("POST", "/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:ew_a" });
  db.prepare("INSERT INTO engine_cmd(id, owner, device_id, verb, args, at, state, taken_at) VALUES (?,?,?,?,?,?,?,?)").run("c1", A, "dev1", "move", JSON.stringify({ item: "window:mbp:ew_a", title: "덱 작업 창" }), Date.now(), "taken", Date.now());
  const r = await call("POST", "/api/device/cmds/c1", { ok: true, item: { key: "window:mbp:ew_new", win: "mbp:ew_new", session: "session:claude:s1", title: "덱 작업 창" } });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(mapOf(db, "window:mbp:ew_new"), { node: "tk_1969", how: "pin" });
  assert.equal(JSON.parse((db.prepare("SELECT counts FROM mnode WHERE owner = ? AND id = 'tk_1969'").get(A) as any).counts).main, "window:mbp:ew_new");
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, state, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run(A, "window:mbp:rep", "dev1", "window", "report", "보고 창", "working", "mbp:rep", Date.now());
  assert.equal((await call("POST", "/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:rep" })).status, 404, "보고만 하는 창");
  db.prepare("UPDATE device SET revoked_at = ? WHERE id = 'dev1'").run(Date.now());
  assert.equal((await call("POST", "/api/device/tasks/attach", { node: "tk_1969", item: "window:mbp:ew_new" })).status, 404, "끊긴 기기 창");
});
