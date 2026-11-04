// node --test --no-warnings --experimental-transform-types apps/web/worker/tasks/routes.test.ts — API 계약 · 사람 경계 · 보기 설정 검사(가짜 D1 = 메모리 SQLite)
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
registerHooks({ resolve(spec, ctx, next) { try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(spec + ".ts", ctx); throw e; } } });
const { mountTasks } = await import("./routes.ts");
const { DEFAULT_VIEW, checkView, roots, isMine, visibleIds } = await import("./rules.ts");

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("create table mnode(owner text, id text, name text, pinned_name text, task text, counts text, updated_at int, archived_at int, primary key(owner,id)); create table node_setting(owner text primary key, data text, updated_at int)");
  const stmt = (sql: string, args: unknown[] = []): any => ({ bind: (...a: unknown[]) => stmt(sql, a), all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }), first: async () => db.prepare(sql).get(...(args as never[])) ?? null, run: async () => db.prepare(sql).run(...(args as never[])) });
  const app = new Hono(); mountTasks(app as never, async c => c.req.header("x-test-user") || null, id => "%" + id.length);
  const env = { DB: { prepare: (s: string) => stmt(s) } };
  const call = (who: string | null, method: string, path: string, body?: unknown, hb = true) => app.request(path, { method, headers: { ...(who ? { "x-test-user": who } : {}), ...(hb ? { "x-hb": "1" } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env as never);
  const node = (owner: string, id: string, task: object, extra: { name?: string; counts?: string; archived?: number } = {}) => db.prepare("insert into mnode values (?,?,?,?,?,?,?,?)").run(owner, id, extra.name || id, null, JSON.stringify(task), extra.counts || "{}", 1000, extra.archived ?? null);
  return { db, call, node };
}
const A = "a@example.com", B = "b@example.com";

test("로그인 없이는 읽기 · 저장 모두 401", async () => {
  const { call } = setup();
  assert.equal((await call(null, "GET", "/api/me/tasks")).status, 401);
  assert.equal((await call(null, "PUT", "/api/me/tasks/view", {})).status, 401);
});
test("저장은 같은 사이트 머리(x-hb)가 있어야 함 — 다른 사이트 요청은 403", async () => {
  const { call } = setup();
  assert.equal((await call(A, "PUT", "/api/me/tasks/view", {}, false)).status, 403);
});
test("내 업무 노드만 — 남의 노드 · tk_ 아닌 노드는 안 옴, 칸 · 상위 · 주 창을 돌려줌", async () => {
  const { call, node, db } = setup();
  node(A, "tk_1", { state: "blocked", line: "막힘 줄", body: "설명", issue: "#1", fields: { "막힌 것": "팀장님 — 답" } }, { counts: '{"main":"w1"}' });
  node(A, "tk_2", { state: "이상한값" }); node(A, "c123", {}); node(B, "tk_9", { state: "working" });
  db.prepare("insert into node_setting values (?,?,?)").run(A, JSON.stringify({ parent: { tk_2: "tk_1", tk_1: "top" } }), 1);
  const j = await (await call(A, "GET", "/api/me/tasks")).json() as any;
  assert.deepEqual(j.tasks.map((t: any) => t.id).sort(), ["tk_1", "tk_2"]);
  const t1 = j.tasks.find((t: any) => t.id === "tk_1"), t2 = j.tasks.find((t: any) => t.id === "tk_2");
  assert.equal(t1.pane, "%4");
  assert.equal(t1.status, "blocked"); assert.equal(t1.fields["막힌 것"], "팀장님 — 답"); assert.equal(t1.main, "w1"); assert.equal(t1.parent, null);
  assert.equal(t2.parent, "tk_1"); assert.equal(t2.status, "working");   // 모르는 상태 → 진행
  assert.deepEqual(j.view, DEFAULT_VIEW);
});
test("보기 저장: 내 것만 바뀌고 다른 설정 칸은 그대로 · 틀린 값은 400 이고 저장 안 됨", async () => {
  const { call, db } = setup();
  db.prepare("insert into node_setting values (?,?,?)").run(A, JSON.stringify({ parent: { tk_2: "tk_1" }, unit: "x" }), 1);
  const ok = await call(A, "PUT", "/api/me/tasks/view", { group: "status", rowFields: ["맡은 창"] });
  assert.equal(ok.status, 200);
  const d = JSON.parse((db.prepare("select data from node_setting where owner = ?").get(A) as any).data);
  assert.equal(d.taskview.group, "status"); assert.deepEqual(d.parent, { tk_2: "tk_1" }); assert.equal(d.unit, "x");
  assert.equal(((await (await call(A, "GET", "/api/me/tasks")).json()) as any).view.group, "status");
  assert.equal(((await (await call(B, "GET", "/api/me/tasks")).json()) as any).view.group, DEFAULT_VIEW.group);
  for (const bad of [{ group: "x" }, { states: ["없음"] }, { mine: "팀장" }, { rowFields: [1] }, { showBody: "y" }, [], null]) assert.equal((await call(A, "PUT", "/api/me/tasks/view", bad)).status, 400, JSON.stringify(bad));
  assert.equal(JSON.parse((db.prepare("select data from node_setting where owner = ?").get(A) as any).data).taskview.group, "status");
  assert.equal((await call(B, "PUT", "/api/me/tasks/view", { sort: "name" })).status, 200);   // 설정 줄이 없던 사람도 저장됨
});
test("저장값이 객체가 아니어도(깨진 JSON · null · 배열) 읽기 · 저장이 됨", async () => {
  const { call, db } = setup();
  for (const bad of ["{깨짐", "null", "[]", ""]) {
    db.prepare("delete from node_setting").run(); db.prepare("insert into node_setting values (?,?,?)").run(A, bad, 1);
    assert.equal((await call(A, "GET", "/api/me/tasks")).status, 200, bad);
    assert.equal((await call(A, "PUT", "/api/me/tasks/view", { sort: "name" })).status, 200, bad);
    assert.equal(((await (await call(A, "GET", "/api/me/tasks")).json()) as any).view.sort, "name", bad);
  }
});
test("/api/me/tasks/has: 내 끝나지 않은 업무 노드가 있을 때만", async () => {
  const { call, node } = setup();
  assert.equal((await call(null, "GET", "/api/me/tasks/has")).status, 401);
  const has = async () => ((await (await call(A, "GET", "/api/me/tasks/has")).json()) as any).has;
  node(B, "tk_b", {}); node(A, "n_1", {}); node(A, "tk_old", {}, { archived: 5 });
  assert.equal(await has(), false);
  node(A, "tk_1", {}); assert.equal(await has(), true);
});
test("망가진 저장값은 기본값으로 읽음", async () => {
  const { call, db } = setup();
  db.prepare("insert into node_setting values (?,?,?)").run(A, JSON.stringify({ taskview: { group: "없는값" } }), 1);
  assert.deepEqual(((await (await call(A, "GET", "/api/me/tasks")).json()) as any).view, DEFAULT_VIEW);
  assert.equal(checkView({ states: [] })?.states.length, 0);
  assert.deepEqual(DEFAULT_VIEW.mine, []);   // 기본값에 사람 이름을 박지 않음
});
test("트리: 없는 상위 · 고리는 맨 위로 — 어느 업무도 사라지지 않음", () => {
  const t = (id: string, parent: string | null) => ({ id, parent, name: id, status: "working", line: "", body: "", issue: "", fields: {}, main: null, updated_at: 0, closed: false }) as any;
  assert.deepEqual(roots([t("a", null), t("b", "a"), t("c", "없음"), t("x", "y"), t("y", "x")]).map((r: any) => r.id), ["a", "c", "x", "y"]);
  const v = { mine: ["팀장"], mineFields: ["막힌 것"] };
  assert.equal(isMine({ ...t("a", null), fields: { "막힌 것": "팀장님 — 답" } }, v), true);
  assert.equal(isMine({ ...t("a", null), fields: { "마지막 진전": "팀장님 승인 받음" } }, v), false);   // 지나가듯 적힌 이름은 내 차례가 아님
  assert.equal(isMine({ ...t("a", null), closed: true, fields: { "막힌 것": "팀장님" } }, v), false);
  assert.equal(isMine({ ...t("a", null), confirm: true }, { mine: [], mineFields: [] }), true);   // 확인 대기 표시는 낱말 없이도 내 차례
  // 거르개를 지난 업무의 위 사슬까지 보임 · 고리에서 멈춤(흰 화면 재현이던 것)
  assert.deepEqual([...visibleIds([t("a", null), t("b", "a"), t("c", null)], ["b"])].sort(), ["a", "b"]);
  assert.deepEqual([...visibleIds([t("x", "y"), t("y", "x")], ["x"])].sort(), ["x", "y"]);
  assert.equal(visibleIds([t("x", "y"), t("y", "x")], []).size, 0);
});
