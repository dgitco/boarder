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
const { post, paneOfId } = await import("../member-board.ts");
const { withHead, boardHead } = await import("../board-head.ts");
function app2(D1: D1Database, dev: string, owner = A) {   // 기기 id 를 고를 수 있는 판(배정기 기기 · 다른 기기)
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  mountImport(a, { device: async () => ({ id: dev, owner, name: dev }), member: async () => owner, sameSite: () => true });
  return (method: string, path: string, body?: unknown) => a.request(path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: D1, PUBLIC_URL: "https://example.test" });
}
async function seed() {
  const f = d1();
  for (const [id, owner] of [["mini", A], ["mbp", A], ["bdev", B]]) f.db.prepare("INSERT INTO device(id, owner, name, token_hash, created_at) VALUES (?,?,?,?,?)").run(id, owner, id, "h_" + id, Date.now());
  await app(f.D1)("POST", "/api/device/tasks", { tasks: [{ key: "sales", name: "Sales", parent: "top" }, { key: "9002", name: "예시 문서 확정", parent: "tk_sales" }] });
  return f;
}
const say = (D1: D1Database, text: string, thread?: string) => post(D1, A, "/api/chat", { pane: paneOfId("tk_9002"), channel: "n:예시 문서 확정", text, ...(thread ? { thread } : {}) });

test("창 없는 업무 노드에 쓴 글 = 노드 채팅 길로 assign 에 넘김(머리 줄 그대로) — 예전 「창이 없어요」 404 가 아님", async () => {
  const { D1 } = await seed();
  const hop = await say(D1, "덱 새 판 보여 줘") as any;
  assert.equal(hop.status, undefined, JSON.stringify(hop));
  assert.equal(hop.path, "/api/me/tasks/assign");
  assert.equal(hop.body.node, "tk_9002");
  assert.equal(hop.body.text, withHead(boardHead({ channel: "예시 문서 확정" }), "덱 새 판 보여 줘"));
  assert.deepEqual(hop.log, { win: "예시 문서 확정", text: "덱 새 판 보여 줘", ch: "예시 문서 확정" }, "내 글 줄은 노드 이름으로(노드 채팅 맨 위 글과 같음)");
});

test("배정기 정하기 → assign 이 그 기기 줄에만 · 보통 가져가기엔 안 섞이고 ?only=assign 으로만 · 결과 보고는 기기 줄 글을 안 남김", async () => {
  const { db, D1 } = await seed();
  const mini = app2(D1, "mini"), mbp = app2(D1, "mbp");
  const none = await mini("POST", "/api/me/tasks/assign", { node: "tk_9002", text: "[보드 · 예시 문서 확정] 덱" });
  assert.equal(none.status, 400, "배정기가 없으면 400 — 글 줄은 index.ts 가 지움(확실히 안 들어감)");
  assert.equal((await mini("POST", "/api/device/assigner", { on: true })).status, 200);
  const r = await mbp("POST", "/api/me/tasks/assign", { node: "tk_9002", text: "[보드 · 예시 문서 확정 · 스레드 1793000000.000001] 덱", thread: "1793000000.000001" });
  assert.equal(r.status, 200, await r.clone().text());
  const id = (await r.json() as any).cmds[0];
  assert.deepEqual({ ...db.prepare("SELECT device_id, verb, state FROM engine_cmd WHERE id = ?").get(id) as any }, { device_id: "mini", verb: "assign", state: "queued" });
  assert.deepEqual((await (await mini("GET", "/api/device/cmds")).json() as any).cmds, [], "보통 가져가기(boarder import --follow)엔 assign 이 없음 — 모르는 명령으로 실패 처리되지 않게");
  assert.deepEqual((await (await mbp("GET", "/api/device/cmds?only=assign")).json() as any).cmds, [], "다른 기기는 못 가져감");
  const got = (await (await mini("GET", "/api/device/cmds?only=assign")).json() as any).cmds;
  assert.equal(got.length, 1); assert.equal(got[0].verb, "assign");
  assert.deepEqual(got[0].args, { node: "tk_9002", name: "예시 문서 확정", text: "[보드 · 예시 문서 확정 · 스레드 1793000000.000001] 덱", thread: "1793000000.000001", post: true });
  const logs = () => (db.prepare("SELECT COUNT(*) n FROM board_log WHERE owner = ?").get(A) as any).n;
  const before = logs();
  assert.equal((await mini("POST", `/api/device/cmds/${id}`, { ok: true })).status, 200);
  assert.equal(logs(), before, "넘김 성공은 보드에 줄을 안 남김(배정기 세션이 그 스레드에 답함)");
  assert.equal((db.prepare("SELECT state FROM engine_cmd WHERE id = ?").get(id) as any).state, "done");
});

test("배정기 끄기 · 끊긴 배정기 · 남의 기기 · 보통 노드 — assign 안 넣음", async () => {
  const { db, D1 } = await seed();
  const mini = app2(D1, "mini");
  await mini("POST", "/api/device/assigner", { on: true });
  db.prepare("UPDATE device SET revoked_at = ? WHERE id = 'mini'").run(Date.now());
  assert.equal((await mini("POST", "/api/me/tasks/assign", { node: "tk_9002", text: "덱" })).status, 400, "끊긴 기기는 배정기가 아님");
  db.prepare("UPDATE device SET revoked_at = NULL WHERE id = 'mini'").run();
  await mini("POST", "/api/device/assigner", { on: false });
  assert.equal((await mini("POST", "/api/me/tasks/assign", { node: "tk_9002", text: "덱" })).status, 400, "끈 뒤엔 없음");
  await mini("POST", "/api/device/assigner", { on: true });
  assert.equal((await app2(D1, "bdev", B)("POST", "/api/me/tasks/assign", { node: "tk_9002", text: "덱" })).status, 404, "남의 업무 노드");
  db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)").run(A, "n_x", "보통", "", "idle", "", Date.now(), Date.now());
  assert.equal((await mini("POST", "/api/me/tasks/assign", { node: "n_x", text: "덱" })).status, 404, "보통 노드는 창으로 — assign 아님");
  assert.equal((await mini("POST", "/api/me/tasks/assign", { node: "tk_9002", text: "" })).status, 400);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM engine_cmd WHERE verb = 'assign'").get() as any).n, 0);
});

test("배정기를 바꾸면 옛 기기 줄의 assign 은 실패 · 6시간 지난 assign 은 가져가지 않고 실패", async () => {
  const { db, D1 } = await seed();
  const mini = app2(D1, "mini"), mbp = app2(D1, "mbp");
  await mini("POST", "/api/device/assigner", { on: true });
  const id = (await (await mini("POST", "/api/me/tasks/assign", { node: "tk_9002", text: "덱" })).json() as any).cmds[0];
  await mbp("POST", "/api/device/assigner", { on: true });
  assert.deepEqual({ ...db.prepare("SELECT state, result FROM engine_cmd WHERE id = ?").get(id) as any }, { state: "failed", result: "배정기가 바뀜" });
  const old = (await (await mbp("POST", "/api/me/tasks/assign", { node: "tk_9002", text: "옛 글" })).json() as any).cmds[0];
  db.prepare("UPDATE engine_cmd SET at = ? WHERE id = ?").run(Date.now() - 7 * 3600_000, old);
  assert.deepEqual((await (await mbp("GET", "/api/device/cmds?only=assign")).json() as any).cmds, []);
  assert.equal((db.prepare("SELECT state FROM engine_cmd WHERE id = ?").get(old) as any).state, "failed");
});

test("에이전트마다 채널인 회원: 보드 「옮기기」로 창을 넣은 업무 노드(주 창 표시 없음)는 그 창으로 — 배정기로 안 감", async () => {
  const { db, D1 } = await seed();
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET data = json_set(data, '$.unit', 'agent')").run(A, JSON.stringify({ unit: "agent" }), Date.now());
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, state, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run(A, "window:mbp:ew_m", "mbp", "window", "tmux", "옮긴 창", "working", "mbp:ew_m", Date.now());
  db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?, 'pin')").run(A, "window:mbp:ew_m", "tk_9002");
  const hop = await say(D1, "덱") as any;
  assert.equal(hop.path, "/api/me/nodes/cmd", JSON.stringify(hop)); assert.equal(hop.body.item, "window:mbp:ew_m");
});
