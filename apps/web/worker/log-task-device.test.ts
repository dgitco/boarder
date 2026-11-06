import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";

register("./test-hooks.mjs", import.meta.url);
const { SCHEMAS, run } = await import("./mcp/tools.ts");
const { localTools } = await import("./local.ts");

const MIG = new URL("../migrations/", import.meta.url);
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => (db.prepare(sql).get(...(args as never[])) as unknown) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { db, D1: { prepare: (s: string) => stmt(s), batch: async (ss: any[]) => ss.map(s => ({ results: db.prepare(s.sql).all(...(s.args as never[])) })) } as unknown as D1Database };
}
const A = "a@example.com";
const ok = (name: keyof typeof SCHEMAS, v: unknown) => SCHEMAS[name].safeParse(v).success;
const rows = (db: DatabaseSync) => db.prepare("SELECT kind, text, task, device, phase, wait_cond FROM board_log WHERE owner = ? ORDER BY id").all(A).map(r => ({ ...r })) as Record<string, unknown>[];

test("task 꼴: #숫자(1~6자리) · 짧은 장부 id 만 — 자유 글 · 빈 번호 · 큰 번호 · 대문자 · 띄어쓰기는 거절", () => {
  for (const t of ["#4321", "#1", "#999999", "lead", "merge", "ops-watch", "a1"]) assert.ok(ok("inbox_log", { kind: "progress", text: "글", task: t }), t);
  for (const t of ["4321", "#", "#1234567", "#12a", "Lead", "lead now", "x", "a".repeat(25), "#4321 ", "-lead", "토큰"]) assert.ok(!ok("inbox_log", { kind: "progress", text: "글", task: t }), t);
});

test("device 꼴: 기기 이름 글자만(60자) — 띄어쓰기 · 제어 문자 · 긴 값은 거절", () => {
  assert.ok(ok("inbox_log", { kind: "start", text: "글", device: "pc3" }));
  assert.ok(ok("inbox_log", { kind: "start", text: "글", device: "dev-laptop.local" }));
  for (const d of ["mbp 3", "pc3\n", "", "a".repeat(61), "기기"]) assert.ok(!ok("inbox_log", { kind: "start", text: "글", device: d }), JSON.stringify(d));
});

test("새 종류(waiting · session_start · session_end) · wait_cond 는 waiting · blocked 에만, 120자 한 줄", () => {
  for (const k of ["waiting", "session_start", "session_end"]) assert.ok(ok("inbox_log", { kind: k, text: "글" }), k);
  assert.ok(ok("inbox_log", { kind: "waiting", text: "리뷰 기다림", wait_cond: "PR #12 리뷰 판정" }));
  assert.ok(ok("inbox_log", { kind: "blocked", text: "막힘", wait_cond: "권한 카드 답" }));
  assert.ok(!ok("inbox_log", { kind: "progress", text: "글", wait_cond: "무언가" }), "progress 엔 wait_cond 안 됨");
  assert.ok(!ok("inbox_log", { kind: "waiting", text: "글", wait_cond: "가".repeat(121) }));
  assert.ok(!ok("inbox_log", { kind: "waiting", text: "글", wait_cond: "두\n줄" }));
  assert.ok(!ok("inbox_log", { kind: "bogus", text: "글" }));
});

test("모르는 칸은 거절 — inbox_log · inbox_status 둘 다", () => {
  assert.ok(!ok("inbox_log", { kind: "progress", text: "글", owner: "b@example.com" }));
  assert.ok(!ok("inbox_log", { kind: "progress", text: "글", tags: ["x"] }));
  assert.ok(!ok("inbox_status", { text: "일하는 중", win: "남의 창" }));
});

test("뒤 호환: 옛 CLI 가 보내던 꼴(kind · text · unblocks · evidence · thread · reply)은 그대로 통과", () => {
  assert.ok(ok("inbox_log", { kind: "progress", text: "진행 한 줄" }));
  assert.ok(ok("inbox_log", { kind: "blocked", text: "막힘", unblocks: "me" }));
  assert.ok(ok("inbox_log", { kind: "done", text: "끝", evidence: ["https://example.com/pr/1"] }));
  assert.ok(ok("inbox_log", { kind: "reply", text: "여러 줄\n답", thread: "1793000000.000001" }));
  assert.ok(ok("inbox_status", { text: "일하는 중" }));
  assert.ok(ok("inbox_status", { text: "기다리는 중", kind: "waiting", task: "#4321", wait_cond: "게이트 결과" }));
  assert.ok(!ok("inbox_status", { text: "일하는 중", wait_cond: "게이트" }), "kind 없이 wait_cond 안 됨");
  assert.ok(!ok("inbox_status", { text: "일하는 중", kind: "decision" }), "status kind 는 일 단계만");
});

test("회원 보드: task · wait_cond · status kind(phase) 저장, device 는 열쇠의 기기 이름으로 — 옛 줄은 칸이 비어 있음", async () => {
  const { db, D1 } = fakeD1();
  const t = localTools(D1, A, "일 창", "https://b.example", "pc3:%1", undefined, undefined, undefined, undefined, "dev_1", "pc3");
  await t("inbox_log", { kind: "progress", text: "옛 줄" });
  await t("inbox_log", { kind: "waiting", text: "리뷰 기다림", task: "#4321", wait_cond: "PR 리뷰" });
  await t("inbox_status", { text: "게이트 기다림", kind: "waiting", task: "#4321", wait_cond: "게이트" });
  await t("inbox_log", { kind: "done", text: "본문 기기 같음", task: "lead", device: "pc3" });
  assert.deepEqual(rows(db), [
    { kind: "progress", text: "옛 줄", task: null, device: "pc3", phase: null, wait_cond: null },
    { kind: "waiting", text: "리뷰 기다림", task: "#4321", device: "pc3", phase: null, wait_cond: "PR 리뷰" },
    { kind: "status", text: "게이트 기다림", task: "#4321", device: "pc3", phase: "waiting", wait_cond: "게이트" },
    { kind: "done", text: "본문 기기 같음", task: "lead", device: "pc3", phase: null, wait_cond: null },
  ]);
});

test("저장할 때 task 앞 0 정리(#04321 → #4321) · 장부 id · 16자리 넘는 번호는 그대로", async () => {
  const { db, D1 } = fakeD1();
  const t = localTools(D1, A, "일 창", "https://b.example", "pc3:%1", undefined, undefined, undefined, undefined, "dev_1", "pc3");
  await t("inbox_log", { kind: "progress", text: "앞 0", task: "#04321" });
  await t("inbox_status", { text: "상태 앞 0", kind: "progress", task: "#0001" });
  await t("inbox_log", { kind: "progress", text: "이미 정리", task: "#4321" });
  await t("inbox_log", { kind: "progress", text: "장부 id", task: "ops-watch" });
  await t("inbox_log", { kind: "progress", text: "0 만", task: "#000000" });
  await t("inbox_log", { kind: "progress", text: "긴 번호(정밀도 안 바꿈)", task: "#99999999999999999999" });
  assert.deepEqual(rows(db).map(r => r.task), ["#4321", "#1", "#4321", "ops-watch", "#0", "#99999999999999999999"]);
});

test("device 본문 값은 안 믿음: 열쇠의 기기와 다르면 거절 · 기기 없는 열쇠는 device 를 못 적음 · 거절된 줄은 안 남음", async () => {
  const { db, D1 } = fakeD1();
  const t = localTools(D1, A, "일 창", "https://b.example", "pc3:%1", undefined, undefined, undefined, undefined, "dev_1", "pc3");
  await assert.rejects(t("inbox_log", { kind: "progress", text: "남의 기기", device: "mac-mini" }), /기기와 다름/);
  await assert.rejects(t("inbox_status", { text: "남의 기기", device: "mac-mini" }), /기기와 다름/);
  const bare = localTools(D1, A, "컨테이너", "https://b.example", "box:%1");   // BOARDER_TOKEN 꼴 — 기기 없음
  await assert.rejects(bare("inbox_log", { kind: "progress", text: "기기 적음", device: "pc3" }), /기기와 다름/);
  await bare("inbox_log", { kind: "progress", text: "기기 없음", task: "#1" });
  assert.deepEqual(rows(db), [{ kind: "progress", text: "기기 없음", task: "#1", device: null, phase: null, wait_cond: null }]);
});

test("wait_cond 는 저장 전에 비밀 꼴을 가림, task · device 는 id 칸이라 안 가림(도구 입구 run)", async () => {
  const { db, D1 } = fakeD1();
  const FAKE = "bxa_" + "FAKEfake0123456789".repeat(3);
  const view = { visible: () => true, why: () => null, desc: () => "", mask: () => false };
  const ctx: any = { agent: "t", op: async () => { throw new Error("다리로 가면 안 됨"); }, get: async () => ({}), publicUrl: "https://b.example", view,
    local: localTools(D1, A, "일 창", "https://b.example", "pc3:%1", undefined, undefined, undefined, undefined, "dev_1", "pc3") };
  await run(ctx, "inbox_log", { kind: "waiting", text: "기다림", task: "#4321", wait_cond: `열쇠 ${FAKE}` });
  const r = rows(db)[0];
  assert.equal(r.task, "#4321");
  assert.ok(!String(r.wait_cond).includes(FAKE), "wait_cond 의 비밀 꼴이 그대로 남음");
  await assert.rejects(run(ctx, "inbox_log", { kind: "progress", text: "글", extra: 1 }), /입력이 맞지 않음/);
});

test("주인 보드(다리 · wlog): 새 종류는 거절, task · device · wait_cond · status kind 는 빼고 예전 꼴 그대로 보냄", async () => {
  const sent: [string, Record<string, unknown>][] = [];
  const view = { visible: () => true, why: () => null, desc: () => "", mask: () => false };
  const ctx: any = { agent: "t", op: async (n: string, a: Record<string, unknown>) => { sent.push([n, a]); return { ok: true }; }, get: async () => ({}), publicUrl: "https://b.example", view };
  await run(ctx, "inbox_log", { kind: "blocked", text: "막힘", unblocks: "me", task: "#4321", wait_cond: "권한" });
  await run(ctx, "inbox_status", { text: "일하는 중", kind: "progress", task: "#4321" });
  await assert.rejects(run(ctx, "inbox_log", { kind: "waiting", text: "기다림" }), /회원 보드 전용/);
  await assert.rejects(run(ctx, "inbox_log", { kind: "session_start", text: "세션" }), /회원 보드 전용/);
  assert.deepEqual(sent, [["inbox_log", { kind: "blocked", text: "막힘", unblocks: "me" }], ["inbox_status", { text: "일하는 중" }]]);
});
