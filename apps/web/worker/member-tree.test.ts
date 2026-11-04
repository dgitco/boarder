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

test("노드 상태 한 줄(watch): 창의 가장 새 줄이 status(boarder status)면 그 줄, 다른 줄이 더 새로우면 비움", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_1", "가동 점검", "acme"); add(db, A, "n_2", "분기 정산", "acme");
  const item = (node: string, win: string) => { db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)").run(A, "win:" + win, node, "auto"); };
  item("n_1", "가동 창"); item("n_2", "정산 창");
  const log = (win: string, kind: string, text: string, at: number) => db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, win, kind, text, null, at);
  log("가동 창", "progress", "시험 셋 끝", Date.now() - 3600_000); log("가동 창", "status", "쉼 · 깨움 21:30 · 팀장님 배포", Date.now() - 1800_000);
  log("정산 창", "status", "옛 상태", Date.now() - 3600_000); log("정산 창", "progress", "보고서 초안 고침", Date.now() - 600_000);
  const d = await data(d1, A, null) as any, w = (name: string) => d.panes.find((p: any) => p.win === name).watch;
  assert.equal(w("가동 점검"), "쉼 · 깨움 21:30 · 팀장님 배포");
  assert.equal(w("분기 정산"), "", "더 새 progress 가 있으면 상태 줄은 낡은 것");
});

test("맨 위 표지(parent = top): 이름이 머리 이름이 아니어도(「회사」 · 「베타랩」) 열 머리, 그 밑 상위 노드도 그 열", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_co", "회사", "acme"); add(db, A, "n_m", "머지 담당", "acme", "working"); add(db, A, "n_cs", "CS 담당", "acme");
  add(db, A, "n_hc", "베타랩", "hbeta"); add(db, A, "n_pa", "개인 비서", ".team-hq"); add(db, A, "n_p", "personal", "personal", "working");
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ parent: { n_co: "top", n_hc: "top", n_pa: "top", n_m: "n_co", n_cs: "n_co", n_p: "n_pa" } }), T);
  const d = await data(d1, A, null) as any;
  assert.deepEqual(d.areas.slice(1).map((a: any) => a.lead_name).sort(), ["개인 비서", "회사", "베타랩"].sort());
  const col = (name: string) => d.areas.find((a: any) => a.lead_name === name).key, areaOf = (w: string) => d.panes.find((p: any) => p.win === w).area;
  assert.deepEqual([areaOf("머지 담당"), areaOf("CS 담당"), areaOf("personal")], [col("회사"), col("회사"), col("개인 비서")]);
  assert.ok(!d.panes.some((p: any) => p.area === "primary" && p.kind === "lead"), "메인 봇 밑에 남은 노드 없음");
});

test("영역 열이 없는 회원도 맨 위(top) 노드가 열 머리, 상위 사슬로 그 열 — 끌어 놓기 뒤 트리가 바뀌어 보임, 상위 없는 노드는 Primary", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_l", "팀장", ""); add(db, A, "n_d", "개발 리드", ""); add(db, A, "n_ui", "화면 고치기", "", "working"); add(db, A, "n_fx", "글자 고치기", ""); add(db, A, "n_x", "혼자 노드", "");
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ parent: { n_l: "top", n_d: "top", n_ui: "n_d", n_fx: "n_ui" } }), T);
  const d = await data(d1, A, null) as any;
  assert.deepEqual(d.areas.slice(1).map((a: any) => a.lead_name).sort(), ["개발 리드", "팀장"].sort());
  const col = (name: string) => d.areas.find((a: any) => a.lead_name === name).key, areaOf = (w: string) => d.panes.find((p: any) => p.win === w).area;
  assert.deepEqual([areaOf("화면 고치기"), areaOf("글자 고치기"), areaOf("혼자 노드")], [col("개발 리드"), col("개발 리드"), "primary"]);
});

test("영역 열이 없는 회원의 첫 끌어 놓기(상위 없는 노드 밑에 놓음)도 보임 — 그 뿌리 노드가 열 머리, 상위가 하나도 없으면 예전 그대로 Primary 한 열", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_1", "가", ""); add(db, A, "n_2", "나", ""); add(db, A, "n_3", "다", "");
  let d = await data(d1, A, null) as any;
  assert.deepEqual(d.areas.map((a: any) => a.key), ["primary"]);
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ parent: { n_2: "n_1" } }), T);
  d = await data(d1, A, null);
  assert.deepEqual(d.areas.slice(1).map((a: any) => a.lead_name), ["가"]);
  const areaOf = (w: string) => d.panes.find((p: any) => p.win === w).area;
  assert.deepEqual([areaOf("나"), areaOf("다")], [d.areas[1].key, "primary"]);
});

test("영역이 하나뿐이면 예전처럼 Primary 한 열", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_1", "가", "acme"); add(db, A, "n_2", "나", "acme");
  const d = await data(d1, A, null) as { areas: { key: string }[]; panes: { area: string; kind: string }[] };
  assert.deepEqual(d.areas.map(a => a.key), ["primary"]);
  assert.ok(d.panes.every(p => p.area === "primary"));
});

test("막힘 뒤에 상태 줄(boarder status)이 와도 막힘 표시 · 내 차례는 그대로", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_1", "가동 점검", "acme"); db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)").run(A, "win:가동 창", "n_1", "auto");
  const log = (kind: string, text: string, at: number) => db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "가동 창", kind, text, null, at);
  log("blocked", "배포 승인 기다림", Date.now() - 1800_000); log("status", "쉼 · 깨움 21:30 · 배포 승인", Date.now() - 600_000);
  const p = ((await data(d1, A, null)) as any).panes.find((x: any) => x.win === "가동 점검");
  assert.ok(p.blocked, "막힘 표시 남음"); assert.equal(p.owner, true); assert.equal(p.last.kind, "막힘", "틀이 읽는 last 도 막힘"); assert.equal(p.watch, "", "막힘 동안 상태 줄은 숨김");
  log("progress", "승인 받아 배포함", Date.now() - 60_000);
  const q = ((await data(d1, A, null)) as any).panes.find((x: any) => x.win === "가동 점검");
  assert.equal(q.blocked, null, "더 새 진행 줄이 오면 막힘 풀림"); assert.notEqual(q.last.kind, "막힘");
});

test("여러 층: 부서(열 머리) → 업무 → 하위 업무 → 그 밑 — 다 부서 열에, up 은 바로 위 판, 사슬 순서가 뒤섞여 읽혀도", async () => {
  const { db, d1 } = fakeD1();
  const at = (id: string, name: string, area: string, ago: number) => db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)").run(A, id, name, area, "idle", "", T, Date.now() - ago);
  at("n_sales", "Sales", "Sales", 50_000); at("n_lead", "팀장", "acme", 50_000);
  // 묶기 순서 = updated_at 최근 먼저 — 가장 깊은 노드가 먼저 읽히게(위 노드가 아직 제 열로 안 옮겨졌을 때)
  at("n_deep", "하위의 하위", "", 1_000); at("n_sub", "단계 정의", "", 2_000); at("n_task", "예시 문서 확정", "", 3_000); at("n_t2", "영업 CRM", "", 4_000);
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ parent: { n_sales: "top", n_task: "n_sales", n_t2: "n_sales", n_sub: "n_task", n_deep: "n_sub" } }), T);
  const d = await data(d1, A, null) as any;
  const p = (w: string) => d.panes.find((x: any) => x.win === w), col = d.areas.find((a: any) => a.lead_name === "Sales").key;
  assert.deepEqual(["예시 문서 확정", "영업 CRM", "단계 정의", "하위의 하위"].map(w => p(w).area), [col, col, col, col], "사슬 끝까지 부서 열");
  assert.equal(p("예시 문서 확정").up, undefined, "열 머리 바로 밑은 up 없음(예전 그대로 한 층)");
  assert.equal(p("영업 CRM").up, undefined);
  assert.equal(p("단계 정의").up, p("예시 문서 확정").pane);
  assert.equal(p("하위의 하위").up, p("단계 정의").pane);
  assert.equal(p("Sales").up, undefined, "열 머리는 up 없음");
});

test("여러 층: 영역 열이 없는 회원도 같은 들여 쓰기 · 상위가 닫힌 노드는 그 열 맨 위(up 없음) · 상위 고리가 있어도 멈추지 않음", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_d", "개발 리드", ""); add(db, A, "n_ui", "화면 고치기", ""); add(db, A, "n_fx", "글자 고치기", ""); add(db, A, "n_gone", "닫은 노드", ""); add(db, A, "n_orph", "닫은 노드 밑", "");
  add(db, A, "n_a", "고리 가", ""); add(db, A, "n_b", "고리 나", "");
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ parent: { n_d: "top", n_ui: "n_d", n_fx: "n_ui", n_gone: "n_d", n_orph: "n_gone", n_a: "n_b", n_b: "n_a" }, closed: ["n_gone"] }), T);
  const d = await data(d1, A, null) as any;
  const p = (w: string) => d.panes.find((x: any) => x.win === w), col = d.areas.find((a: any) => a.lead_name === "개발 리드").key;
  assert.equal(p("글자 고치기").area, col); assert.equal(p("글자 고치기").up, p("화면 고치기").pane);
  assert.equal(p("화면 고치기").up, undefined);
  assert.equal(p("닫은 노드 밑").up, undefined, "닫힌 상위 밑은 들여 쓰지 않음");
  assert.ok(!p("고리 가").up || !p("고리 나").up, "서로 up 인 고리는 안 만듦");
});
