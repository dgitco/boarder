import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);   // 확장자 없는 import · .md 를 풀어 줌(msg-retry.test.ts 와 같음)
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
const A = "a@member.test", B = "b@member.test", T = Date.now() - 60_000;
const add = (db: DatabaseSync, who: string, id: string, name: string, area: string | null, state = "idle") =>
  db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)").run(who, id, name, area, state, "", T, T);

test("영역마다 한 열, 열 머리는 팀장 · 기타는 맨 뒤", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_1", "운영 담당", "acme", "working"); add(db, A, "n_2", "팀장", "acme", "turn"); add(db, A, "n_3", "영업 총괄", "acme");
  add(db, A, "n_4", "베타 팀장", "hbeta"); add(db, A, "n_5", "개인 비서", ".team-hq"); add(db, A, "n_6", "시험", "기타", "working");
  add(db, B, "n_9", "남의 노드", "zeta");
  const d = await data(d1, A, null) as { areas: { key: string; name: string; lead: string; lead_name?: string }[]; panes: { pane: string; win: string; area: string; kind: string }[] };
  assert.deepEqual(d.areas.map(a => a.name), ["Primary", "acme", ".team-hq", "hbeta"]);   // 「기타」엔 팀장 · 비서 노드가 없어 Primary 열에
  assert.equal(d.panes.find(p => p.win === "시험")!.area, "primary");
  const acme = d.areas[1]; assert.equal(acme.lead_name, "팀장");
  const inAcme = d.panes.filter(p => p.area === acme.key);
  assert.equal(inAcme.length, 3); assert.ok(inAcme.every(p => p.kind === "lead"), "머리도 보통 노드 — 제 채팅 · 채널 목록 그대로");
  assert.ok(d.areas.every(a => /^(primary|m\d+)$/.test(a.key)), "열 키는 m0 · m1 …");
  assert.ok(!d.panes.some(p => p.win === "남의 노드"));
  assert.ok(d.areas.slice(1).every(a => d.panes.some(p => p.pane === a.lead && p.area === a.key)), "열 머리 판이 그 열에 있음");
});

test("열 머리는 팀장 · 리드 · 총괄 · 비서 이름만 — 일하는 중인 시험 · 담당 노드가 머리가 되지 않고, 그런 영역은 Primary 열에", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_1", "[시험] 새 보드 기기", "acme", "working"); add(db, A, "n_2", "자료 정리", "acme"); add(db, A, "n_3", "운영 담당", "acme", "working");
  add(db, A, "n_4", "베타 팀장", "hbeta"); add(db, A, "n_5", "beta-main", "hbeta", "working");
  add(db, A, "n_6", "개인 비서", ".team-hq"); add(db, A, "n_7", "[시험] 팀장 흉내", ".team-hq", "working");
  const d = await data(d1, A, null) as { areas: { key: string; name: string; lead: string; lead_name?: string }[]; panes: { pane: string; win: string; area: string }[] };
  assert.deepEqual(d.areas.map(a => [a.name, a.lead_name ?? null]), [["Primary", null], [".team-hq", "개인 비서"], ["hbeta", "베타 팀장"]]);
  const areaOf = (w: string) => d.panes.find(p => p.win === w)!.area;
  assert.deepEqual(["[시험] 새 보드 기기", "자료 정리", "운영 담당"].map(areaOf), ["primary", "primary", "primary"], "머리 없는 acme 영역 노드는 Primary 열 — 시험 창이 그 위로 안 올라감");
  assert.equal(areaOf("[시험] 팀장 흉내"), d.areas[1].key, "[시험] 이름은 머리가 안 되고 그 열의 보통 노드");
});

test("팀장 이름 노드가 아무 데도 없으면 예전처럼 영역마다 열 — 머리는 일하는 노드, 단 「[시험]」 이름은 빼고", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_1", "[시험] 새 보드", "가 리포", "working"); add(db, A, "n_2", "정리", "가 리포"); add(db, A, "n_3", "보고서", "가 리포", "working");
  add(db, A, "n_4", "나 일", "나 리포");
  const d = await data(d1, A, null) as { areas: { name: string; lead_name?: string }[] };
  assert.deepEqual(d.areas.map(a => [a.name, a.lead_name ?? null]), [["Primary", null], ["가 리포", "보고서"], ["나 리포", "나 일"]]);
});

test("상위 노드(node_setting.data.parent): 그 노드는 상위 열 밑으로, 주차한 노드도 제 열(상위 열) 밑 — Primary 맨 위에 뜨지 않음", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_lead", "팀장", "acme"); add(db, A, "n_ops", "운영 담당", "acme", "working");
  add(db, A, "n_pa", "개인 비서", ".team-hq"); add(db, A, "n_p", "personal", "personal", "working");
  add(db, A, "n_sales", "영업 총괄", "", "parked"); add(db, A, "n_park2", "쉬는 담당", "acme", "parked");
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ parent: { n_p: "n_pa", n_sales: "n_lead" } }), T);
  const d = await data(d1, A, null) as any;
  const col = (name: string) => d.areas.find((a: any) => a.lead_name === name).key;
  assert.equal(d.panes.find((p: any) => p.win === "personal").area, col("개인 비서"), "personal → 개인 비서 열");
  assert.equal(d.panes.find((p: any) => p.win === "운영 담당").area, col("팀장"));
  assert.equal(d.parked.find((p: any) => p.name === "영업 총괄").area, col("팀장"), "주차 + 상위 → 상위 열");
  assert.equal(d.parked.find((p: any) => p.name === "쉬는 담당").area, col("팀장"), "주차 → 제 영역 열");
});

test("상위 없는 노드 · 주차 노드는 기본 창(primary_win)이 열 머리면 그 열로 — 메인 봇과 열 머리 사이에 안 뜸, 기본 창이 없으면 예전처럼 Primary", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_lead", "팀장", "acme"); add(db, A, "n_pa", "개인 비서", ".team-hq");
  add(db, A, "n_w", "작업자 · 정리", "", "working"); add(db, A, "n_cl", "클라우드 세션", "cloud", "working"); add(db, A, "n_pk", "작업자 · 쉼", "", "parked");
  const before = await data(d1, A, null) as any;
  assert.equal(before.panes.find((p: any) => p.win === "작업자 · 정리").area, "primary", "기본 창 없으면 예전 그대로");
  db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)").run(A, "win:팀장 창", "n_lead", "auto");
  db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(A, "primary_win", "win:팀장 창", T);
  for (const unit of [null, "goal"]) {
    db.prepare("DELETE FROM node_setting WHERE owner = ?").run(A);
    if (unit) db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ unit }), T);
    const g = await data(d1, A, null) as any;
    assert.equal(g.panes.find((p: any) => p.win === "작업자 · 정리").area, "primary", `unit ${unit} 는 그대로`);
    assert.equal(g.parked.find((p: any) => p.name === "작업자 · 쉼").area, "primary", `unit ${unit} 주차도 그대로`);
  }
  db.prepare("DELETE FROM node_setting WHERE owner = ?").run(A);
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ unit: "agent" }), T);
  const d = await data(d1, A, null) as any, lead = d.areas.find((a: any) => a.lead_name === "팀장").key;
  assert.deepEqual(["작업자 · 정리", "클라우드 세션"].map(w => d.panes.find((p: any) => p.win === w).area), [lead, lead]);
  assert.equal(d.parked.find((p: any) => p.name === "작업자 · 쉼").area, lead);
  assert.equal(d.panes.find((p: any) => p.win === "개인 비서").area, d.areas.find((a: any) => a.lead_name === "개인 비서").key, "다른 열 머리는 그대로");
});

test("영역이 하나뿐이면 예전처럼 Primary 한 열", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_1", "가", "acme"); add(db, A, "n_2", "나", "acme");
  const d = await data(d1, A, null) as { areas: { key: string }[]; panes: { area: string; kind: string }[] };
  assert.deepEqual(d.areas.map(a => a.key), ["primary"]);
  assert.ok(d.panes.every(p => p.area === "primary"));
});
