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
const T = Date.now() - 60_000;
const row = (db: DatabaseSync, id: string, who = A) => db.prepare("SELECT * FROM mnode WHERE owner = ? AND id = ?").get(who, id) as any;
const parents = (db: DatabaseSync, who = A) => JSON.parse(String((db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(who) as any)?.data || "{}")).parent || {};
const TREE = [
  { key: "sales", name: "Sales", area: "Sales", parent: "top", state: "working", line: "부서" },
  { key: "1969", name: "세일즈 덱 확정", parent: "tk_sales", state: "waiting", line: "확인 대기 — 새 판 전/후 한 장", body: "덱 · 계약 · 도입 준비(가상 예시)", issue: "#1969" },
  { key: "4528", name: "단계 정의", parent: "tk_1969", state: "blocked", line: "요금 숫자 결정 대기", issue: 4528 },
];

test("기기 토큰으로 부서 → 업무 → 하위 업무를 한 번에 — 창 없이 노드가 서고 상위 사슬 · 업무 값이 남음", async () => {
  const { db, D1 } = d1(), call = app(D1);
  const r = await call("POST", "/api/device/tasks", { tasks: TREE });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json() as any;
  assert.deepEqual(j.nodes.map((n: any) => [n.key, n.id, n.created]), [["sales", "tk_sales", true], ["1969", "tk_1969", true], ["4528", "tk_4528", true]]);
  assert.deepEqual(parents(db), { tk_sales: "top", tk_1969: "tk_sales", tk_4528: "tk_1969" });
  const t = row(db, "tk_1969");
  assert.equal(t.name, "세일즈 덱 확정"); assert.equal(t.state, "idle", "기다림 = 보드 노드 상태 idle"); assert.equal(t.why, "확인 대기 — 새 판 전/후 한 장");
  assert.deepEqual(JSON.parse(t.task), { state: "waiting", line: "확인 대기 — 새 판 전/후 한 장", body: "덱 · 계약 · 도입 준비(가상 예시)", issue: "#1969" });
  assert.equal(row(db, "tk_4528").state, "blocked"); assert.equal(JSON.parse(row(db, "tk_4528").task).issue, "#4528", "숫자 이슈 번호는 #N 으로");
  assert.equal(row(db, "tk_sales").area, "Sales");
  const l = await (await call("GET", "/api/me/nodes/list")).json() as any;
  const n = l.nodes.find((x: any) => x.id === "tk_4528");
  assert.equal(n.parent, "tk_1969"); assert.equal(n.task.state, "blocked"); assert.equal(n.task.line, "요금 숫자 결정 대기");
  assert.ok(!l.nodes.find((x: any) => x.id === "tk_sales").task.body, "설명 없는 업무는 빈 설명");
});

test("묶기(regroup)는 tk_ 노드를 보관함으로 내리지 않음 — 창 · 세션이 하나도 없어도(묶는 단위를 고른 사람 포함)", async () => {
  const { db, D1 } = d1(), call = app(D1);
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ unit: "goal" }), T);
  db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)").run(A, "n_old", "옛 창 노드", "ledger", "idle", "", T - 30 * 86400_000, T - 30 * 86400_000);
  assert.equal((await call("POST", "/api/device/tasks", { tasks: TREE })).status, 200);
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  for (const id of ["tk_sales", "tk_1969", "tk_4528"]) { const x = row(db, id); assert.equal(x.archived_at, null, id + " 보관 안 됨"); assert.notEqual(x.state, "done", id + " 끝으로 안 바뀜"); }
  assert.ok(row(db, "n_old").archived_at, "묶을 것이 없는 보통 노드는 예전처럼 보관(시험이 묶기를 실제로 돌렸다는 표)");
});

test("같은 key 로 다시 부르면 준 칸만 고침 — 안 준 칸은 그대로 · 보드에서 바꾼 이름은 이름을 줄 때만 장부 이름으로 · 완료 · 취소는 보관, 다시 열면 풂", async () => {
  const { db, D1 } = d1(), call = app(D1);
  await call("POST", "/api/device/tasks", { tasks: TREE });
  db.prepare("UPDATE mnode SET pinned_name = '손으로 바꾼 이름', name = '손으로 바꾼 이름' WHERE owner = ? AND id = 'tk_1969'").run(A);   // 보드 이름 바꾸기(/api/me/nodes/edit rename)와 같은 꼴
  const r = await call("POST", "/api/device/tasks", { tasks: [{ key: "1969", state: "done", line: "끝 — 확인 받음" }, { key: "4528", name: "단계 정의(고침)", parent: null }] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual((await r.json() as any).nodes.map((n: any) => n.created), [false, false]);
  let t = row(db, "tk_1969");
  assert.equal(t.state, "done"); assert.equal(t.name, "손으로 바꾼 이름"); assert.equal(t.pinned_name, "손으로 바꾼 이름", "이름을 안 주면 보이는 이름 그대로");
  assert.ok(t.archived_at, "완료 = 보관(끝난 노드 목록에 하루)");
  assert.deepEqual(JSON.parse(t.task), { state: "done", line: "끝 — 확인 받음", body: "덱 · 계약 · 도입 준비(가상 예시)", issue: "#1969" });
  assert.equal(row(db, "tk_4528").name, "단계 정의(고침)");
  assert.deepEqual(parents(db), { tk_sales: "top", tk_1969: "tk_sales" }, "parent: null = 상위 지움 · 안 준 상위는 그대로");
  await call("POST", "/api/device/tasks", { tasks: [{ key: "1969", name: "세일즈 덱 확정", state: "working" }] });
  t = row(db, "tk_1969");
  assert.equal(t.name, "세일즈 덱 확정"); assert.equal(t.pinned_name, null, "이름을 주면 장부 이름이 이김"); assert.equal(t.archived_at, null, "다시 진행 = 보관 풂");
  const c = await call("POST", "/api/device/tasks", { tasks: [{ key: "4528", state: "cancelled", issue: "4528" }] });
  assert.equal(c.status, 200); assert.equal(row(db, "tk_4528").state, "done", "취소도 보드 노드 상태는 끝(업무 값엔 cancelled)");
  assert.deepEqual([JSON.parse(row(db, "tk_4528").task).state, JSON.parse(row(db, "tk_4528").task).issue], ["cancelled", "#4528"], "숫자만인 이슈 글도 #N");
});

test("바뀐 것이 없으면 쓰지 않음 — 장부를 자주 맞춰도 updated_at · 상위 칸이 그대로", async () => {
  const { db, D1 } = d1(), call = app(D1);
  await call("POST", "/api/device/tasks", { tasks: TREE });
  db.prepare("UPDATE mnode SET updated_at = 1 WHERE owner = ?").run(A);
  db.prepare("UPDATE node_setting SET updated_at = 1 WHERE owner = ?").run(A);
  const r = await (await call("POST", "/api/device/tasks", { tasks: TREE })).json() as any;
  assert.equal(r.changed, 0); assert.equal(r.parents, 0);
  assert.deepEqual((db.prepare("SELECT DISTINCT updated_at u FROM mnode WHERE owner = ?").all(A) as any[]).map(x => x.u), [1]);
  assert.equal((db.prepare("SELECT updated_at u FROM node_setting WHERE owner = ?").get(A) as any).u, 1);
  const r2 = await (await call("POST", "/api/device/tasks", { tasks: [{ ...TREE[1], line: "새 한 줄" }] })).json() as any;
  assert.equal(r2.changed, 1); assert.equal(row(db, "tk_1969").why, "새 한 줄");
});

test("사람이 창을 업무 노드로 옮겨도(pin) 묶기가 그 업무 노드 줄을 덮지 않음 — 이름 · 영역 · 상태 그대로", async () => {
  const { db, D1 } = d1(), call = app(D1);
  await call("POST", "/api/device/tasks", { tasks: TREE });
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, repo, state, state_at, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(A, "window:w1", "dev1", "window", "tmux", "창 하나", "/x/ledger", "ledger", "working", T, "w1", Date.now());
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  const m = await app(D1, { device: null, member: A, same: true })("POST", "/api/me/nodes/edit", { op: "move", item: "window:w1", to: "tk_1969" });
  assert.equal(m.status, 200, await m.clone().text());
  assert.equal((db.prepare("SELECT node FROM mnode_item WHERE owner = ? AND item = 'window:w1'").get(A) as any).node, "tk_1969", "창이 업무 노드에 붙음");
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  const t = row(db, "tk_1969");
  assert.deepEqual([t.name, t.area, t.state, t.archived_at], ["세일즈 덱 확정", "", "idle", null]);
});

test("거절: 이름 없는 새 업무 · 모르는 · 남의 상위 · 고리 · 같은 key 두 번 · 이상한 상태 — 하나라도 있으면 아무것도 안 씀", async () => {
  const { db, D1 } = d1(), call = app(D1);
  db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)").run(B, "n_b", "남의 노드", "", "idle", "", T, T);
  const bad = async (tasks: unknown, status: number) => { const r = await call("POST", "/api/device/tasks", { tasks }); assert.equal(r.status, status, JSON.stringify(tasks) + " → " + await r.text()); };
  await bad([{ key: "a", name: "가" }, { key: "b" }], 400);
  await bad([{ key: "a", name: "가", parent: "n_nope" }], 404);
  await bad([{ key: "a", name: "가", parent: "n_b" }], 404);
  await bad([{ key: "a", name: "가", parent: "tk_b" }, { key: "b", name: "나", parent: "tk_a" }], 400);
  await bad([{ key: "a", name: "가" }, { key: "a", name: "가2" }], 400);
  await bad([{ key: "a", name: "가", state: "paused" }], 400);
  await bad([{ key: "../x", name: "가" }], 400);
  await bad([], 400);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM mnode WHERE owner = ?").get(A) as any).n, 0);
  assert.deepEqual(parents(db), {});
  // 이미 있는 사슬에 고리를 만드는 고침도 막음(sales → 1969 → 4528 일 때 sales 를 4528 밑으로)
  await call("POST", "/api/device/tasks", { tasks: TREE });
  await bad([{ key: "sales", parent: "tk_4528" }], 400);
  assert.equal(parents(db).tk_sales, "top");
});

test("권한: 토큰 없으면 401 · 회원 화면은 같은 사이트일 때만 · 남의 업무 노드는 안 건드림", async () => {
  const { db, D1 } = d1();
  assert.equal((await app(D1, { device: null })("POST", "/api/device/tasks", { tasks: TREE })).status, 401);
  assert.equal((await app(D1, { device: null, member: A, same: false })("POST", "/api/device/tasks", { tasks: TREE })).status, 401);
  assert.equal((await app(D1, { device: null, member: A, same: true })("POST", "/api/device/tasks", { tasks: TREE.slice(0, 1) })).status, 200);
  assert.equal((await app(D1, { device: B })("POST", "/api/device/tasks", { tasks: [{ key: "sales", name: "B 의 Sales" }] })).status, 200);
  assert.equal(row(db, "tk_sales").name, "Sales", "같은 key 라도 사람마다 따로");
  assert.equal(row(db, "tk_sales", B).name, "B 의 Sales");
});

test("task 칸(0054)이 아직 없는 D1 이어도 노드 목록은 예전처럼 — 코드가 마이그레이션보다 먼저 나간 경우", async () => {
  const { db, D1 } = d1(), call = app(D1);
  db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)").run(A, "n_keep", "팀장", "ledger", "idle", "", T, T);
  db.exec("ALTER TABLE mnode DROP COLUMN task");
  const r = await call("GET", "/api/me/nodes/list");
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual((await r.json() as any).nodes.map((n: any) => [n.id, "task" in n]), [["n_keep", false]]);
});

test("확인 대기(confirm): 주면 task 에 confirm, false 로 지움 · 안 주면 그대로", async () => {
  const { db, D1 } = d1(), call = app(D1);
  await call("POST", "/api/device/tasks", { tasks: [{ key: "x", name: "확인 받을 업무", state: "waiting", confirm: true }] });
  assert.equal(JSON.parse(row(db, "tk_x").task).confirm, true);
  await call("POST", "/api/device/tasks", { tasks: [{ key: "x", line: "한 줄만 고침" }] });
  assert.equal(JSON.parse(row(db, "tk_x").task).confirm, true, "안 주면 그대로");
  await call("POST", "/api/device/tasks", { tasks: [{ key: "x", confirm: false }] });
  assert.equal("confirm" in JSON.parse(row(db, "tk_x").task), false);
});

test("업무 칸(fields): 묶음째 저장 · 안 주면 그대로 · 칸 21개는 400 · 같은 값이면 안 씀", async () => {
  const { D1 } = d1(), call = app(D1), post = (tasks: unknown[]) => call("POST", "/api/device/tasks", { tasks });
  assert.equal((await post([{ key: "f1", name: "업무", fields: { "막힌 것": "팀장님 — 답", "다음 할 일": "x" } }])).status, 200);
  const read = async () => JSON.parse((await D1.prepare("SELECT task FROM mnode WHERE id = 'tk_f1'").first<{ task: string }>())!.task);
  assert.deepEqual((await read()).fields, { "막힌 것": "팀장님 — 답", "다음 할 일": "x" });
  assert.equal(((await (await post([{ key: "f1", line: "새 줄" }])).json()) as any).changed, 1);
  assert.deepEqual((await read()).fields, { "막힌 것": "팀장님 — 답", "다음 할 일": "x" });   // 안 준 칸은 그대로
  assert.equal(((await (await post([{ key: "f1", fields: { "막힌 것": "팀장님 — 답", "다음 할 일": "x" } }])).json()) as any).changed, 0);
  assert.equal((await post([{ key: "f1", fields: Object.fromEntries(Array.from({ length: 21 }, (_, i) => ["k" + i, "v"])) }])).status, 400);
});
