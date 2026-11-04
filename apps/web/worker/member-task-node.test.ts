import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);
const { data } = await import("./member-board.ts");

const MIG = new URL("../migrations/", import.meta.url);
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { db.prepare(sql).run(...(args as never[])); return { success: true }; },
  });
  return { db, d1: { prepare: (sql: string) => stmt(sql), batch: async (ss: ReturnType<typeof stmt>[]) => Promise.all(ss.map(s => s.all())) } as unknown as D1Database };
}
const A = "a@member.test", T = Date.now() - 60_000;
const node = (db: DatabaseSync, id: string, name: string, state: string, task: object | null) =>
  db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, task, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(A, id, name, "", state, "", task ? JSON.stringify(task) : null, T, T);

test("업무 노드 판에 task(상태 다섯 · 상태 한 줄 · 이슈 · 칩), 보통 노드 판엔 없음", async () => {
  const { db, d1 } = fakeD1();
  node(db, "tk_a", "덱 확정", "idle", { state: "waiting", line: "확인 대기 — 새 판 한 장", body: "설명", issue: "#1969", confirm: true });
  node(db, "tk_b", "단계 정의", "blocked", { state: "blocked", line: "요금 숫자 결정 대기", body: "", issue: "" });
  node(db, "tk_c", "영업 CRM", "working", { state: "working", line: "", body: "", issue: "" });
  node(db, "n_w", "보통 노드", "working", null);
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, state, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run(A, "window:w1", "d", "window", "tmux", "창", "parked", "w1", Date.now());
  db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?, 'pin')").run(A, "window:w1", "tk_c");
  node(db, "tk_dept", "Sales", "working", { state: "working", line: "부서", body: "", issue: "" });
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ task_dots: true, parent: { tk_dept: "top", tk_a: "tk_dept", tk_b: "tk_a" } }), T);
  const d = await data(d1, A, null) as any, p = (w: string) => d.panes.find((x: any) => x.win === w);
  assert.deepEqual(p("Sales").task.chips, [], "밑에 업무를 둔 노드(부서)는 창이 없어도 담당 없음 칩 없음");
  assert.deepEqual(p("덱 확정").task, { state: "waiting", line: "확인 대기 — 새 판 한 장", issue: "#1969", chips: ["confirm"] }, "하위 업무가 있으면 담당 없음 칩 없음");
  assert.deepEqual(p("단계 정의").task, { state: "blocked", line: "요금 숫자 결정 대기", issue: "", chips: ["unassigned"] });
  assert.deepEqual(p("영업 CRM").task, { state: "working", line: "", issue: "", chips: ["parked"] }, "붙은 창이 주차면 「쉬는 중」, 창이 있으니 담당 없음은 아님");
  assert.equal(p("보통 노드").task, undefined);
});

test("task 칸(0054)이 아직 없는 D1 이어도 보드는 예전처럼 그려짐", async () => {
  const { db, d1 } = fakeD1();
  node(db, "n_w", "보통 노드", "working", null);
  db.exec("ALTER TABLE mnode DROP COLUMN task");
  const d = await data(d1, A, null) as any;
  assert.ok(d.panes.some((x: any) => x.win === "보통 노드"));
});

test("칩 판정: 닫힌 하위만 있는 업무는 담당 없음 그대로 · 붙은 창이 하나라도 살아 있으면 쉬는 중 아님", async () => {
  const { db, d1 } = fakeD1();
  node(db, "tk_p", "상위 업무", "working", { state: "working", line: "", body: "", issue: "" });
  node(db, "tk_k", "닫힌 하위", "working", { state: "working", line: "", body: "", issue: "" });
  node(db, "tk_w", "창 둘", "working", { state: "working", line: "", body: "", issue: "" });
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ task_dots: true, parent: { tk_k: "tk_p" }, closed: ["tk_k"] }), T);
  for (const [k, st] of [["window:w1", "parked"], ["window:w2", "working"]]) {
    db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, state, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run(A, k, "d", "window", "tmux", k, st, k.slice(7), Date.now());
    db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?, 'pin')").run(A, k, "tk_w");
  }
  const d = await data(d1, A, null) as any, p = (w: string) => d.panes.find((x: any) => x.win === w);
  assert.deepEqual(p("상위 업무").task.chips, ["unassigned"]);
  assert.deepEqual(p("창 둘").task.chips, []);
});

test("업무 상태 다섯 꼴은 켠 사람만(설정 › 노드 task_dots, 기본 꺼짐 = 지금 점)", async () => {
  const { db, d1 } = fakeD1();
  node(db, "tk_a", "덱 확정", "idle", { state: "waiting", line: "확인 대기", body: "", issue: "#1969", confirm: true });
  const off = await data(d1, A, null) as any;
  assert.equal(off.panes.find((x: any) => x.win === "덱 확정").tk, true, "점 설정이 꺼져도 업무 노드 표시는 실음 — 왼쪽 칸에서 뺄 때 씀");
  assert.equal(off.panes.find((x: any) => x.win === "덱 확정").task, undefined, "설정이 없으면 task 를 안 실음 — 화면은 지금 점");
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ task_dots: false }), T);
  assert.equal((await data(d1, A, null) as any).panes.find((x: any) => x.win === "덱 확정").task, undefined, "끈 사람도 그대로");
  db.prepare("UPDATE node_setting SET data = ? WHERE owner = ?").run(JSON.stringify({ task_dots: true }), A);
  assert.equal((await data(d1, A, null) as any).panes.find((x: any) => x.win === "덱 확정").task.state, "waiting", "켠 사람만 다섯 꼴");
});

test("표지 셋(주차 · 담당 없음 · 확인 대기)은 점 설정이 꺼져도 모두에게", async () => {
  const { db, d1 } = fakeD1();
  node(db, "tk_c", "확인 받을 일", "idle", { state: "waiting", line: "", body: "", issue: "", confirm: true });
  node(db, "tk_u", "담당 없는 일", "working", { state: "working", line: "", body: "", issue: "" });
  node(db, "tk_p", "주차된 일", "working", { state: "working", line: "", body: "", issue: "" });
  node(db, "tk_w", "도는 일", "working", { state: "working", line: "", body: "", issue: "" });
  node(db, "n_w", "보통 노드", "working", null);
  for (const [k, st, n] of [["window:w1", "parked", "tk_p"], ["window:w2", "working", "tk_w"], ["window:w3", "parked", "tk_c"]]) {
    db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, state, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run(A, k, "d", "window", "tmux", k, st, k.slice(7), Date.now());
    db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?, 'pin')").run(A, k, n);
  }
  const d = await data(d1, A, null) as any, p = (w: string) => d.panes.find((x: any) => x.win === w);
  assert.deepEqual(p("확인 받을 일").tkChips, ["confirm", "parked"]);
  assert.deepEqual(p("담당 없는 일").tkChips, ["unassigned"]);
  assert.deepEqual(p("주차된 일").tkChips, ["parked"]);
  assert.equal(p("도는 일").tkChips, undefined, "표지 없으면 칸도 없음");
  assert.equal(p("보통 노드").tkChips, undefined, "보통 노드엔 표지 없음");
  for (const w of ["확인 받을 일", "담당 없는 일", "주차된 일"]) assert.equal(p(w).task, undefined, "점은 지금 그대로(다섯 꼴 안 실음)");
});

