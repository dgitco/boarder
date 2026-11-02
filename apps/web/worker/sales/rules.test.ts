// node --test apps/web/worker/sales/rules.test.ts (Node 24 타입 지우기)
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, diff, day, addBusinessDays, suggestDue, todayKst, csv, dueToday } from "./rules.ts";

const team = ["a@example.com", "b@example.com"];
const ok = { firm: "예시 세무회계", assignee: "a@example.com", next: "첫 통화 잡기", due: "2026-11-02" };

test("만들기: 사무소 · 담당 · 다음 할 일 · 기한이 있으면 통과, 기본은 문의 · 문의 길", () => {
  const r = check(null, ok, team);
  assert.ok(r.ok);
  assert.equal(r.card.stage, "inquiry"); assert.equal(r.card.source, "inquiry"); assert.deepEqual(r.card.links, []);
});

test("담당은 그 팀 사람만 — 대문자 메일은 소문자로", () => {
  assert.equal(check(null, { ...ok, assignee: "x@example.com" }, team).ok, false);
  const r = check(null, { ...ok, assignee: "B@Example.com" }, team);
  assert.ok(r.ok); assert.equal(r.card.assignee, "b@example.com");
});

test("단계별 꼭 있어야 하는 칸: 보류 = 다시 볼 날짜, 놓침 = 이유, 나머지 = 다음 할 일 · 기한", () => {
  assert.equal(check(null, { ...ok, next: "" }, team).ok, false);
  assert.equal(check(null, { ...ok, due: null }, team).ok, false);
  assert.equal(check(null, { firm: "예시", assignee: "a@example.com", stage: "hold" }, team).ok, false);
  assert.ok(check(null, { firm: "예시", assignee: "a@example.com", stage: "hold", hold_until: "2026-12-01" }, team).ok);
  assert.equal(check(null, { firm: "예시", assignee: "a@example.com", stage: "lost" }, team).ok, false);
  assert.ok(check(null, { firm: "예시", assignee: "a@example.com", stage: "lost", lost_reason: "가격" }, team).ok);
});

test("모르는 단계 · 길, 빈 사무소는 거절", () => {
  assert.equal(check(null, { ...ok, stage: "won" }, team).ok, false);
  assert.equal(check(null, { ...ok, source: "ad" }, team).ok, false);
  assert.equal(check(null, { ...ok, firm: "   " }, team).ok, false);
});

test("날짜: YYYY-MM-DD 만, 없는 날은 거절, 빈 값은 null", () => {
  assert.equal(day("2026-02-28"), "2026-02-28");
  assert.equal(day("2026-02-30"), undefined);
  assert.equal(day("2026-2-3"), undefined);
  assert.equal(day("2026-11-02T00:00:00Z"), undefined);
  assert.equal(day(""), null);
  assert.equal(check(null, { ...ok, due: "2026-13-01" }, team).ok, false);
});

test("원문 링크: http(s) 만, 10개까지, 겹치면 하나", () => {
  assert.equal(check(null, { ...ok, links: ["javascript:alert(1)"] }, team).ok, false);
  assert.equal(check(null, { ...ok, links: Array.from({ length: 11 }, (_, i) => `https://e.example/${i}`) }, team).ok, false);
  const r = check(null, { ...ok, links: ["https://e.example/1", "https://e.example/1"] }, team);
  assert.ok(r.ok); assert.deepEqual(r.card.links, ["https://e.example/1"]);
});

test("팀에서 빠진 담당: 담당을 안 바꾸면 고치기 통과, 다른 밖 사람으로 바꾸기는 거절", () => {
  const a = check(null, ok, team); assert.ok(a.ok);
  assert.ok(check(a.card, { stage: "contact" }, ["b@example.com"]).ok);
  assert.equal(check(a.card, { assignee: "x@example.com" }, ["b@example.com"]).ok, false);
});

test("보류 · 놓침에서 되돌리면 다시 볼 날짜 · 놓친 이유를 비움", () => {
  const l = check(null, { firm: "예시", assignee: "a@example.com", stage: "lost", lost_reason: "가격" }, team); assert.ok(l.ok);
  const back = check(l.card, { stage: "call", next: "다시 연락", due: "2026-11-02" }, team); assert.ok(back.ok);
  assert.equal(back.card.lost_reason, ""); assert.equal(back.card.hold_until, null);
});

test("고치기: 받은 칸만 덮고 나머지는 앞 판 그대로, 바뀐 칸만 기록", () => {
  const a = check(null, ok, team); assert.ok(a.ok);
  const b = check(a.card, { stage: "contact", due: "2026-11-03" }, team); assert.ok(b.ok);
  assert.equal(b.card.firm, "예시 세무회계"); assert.equal(b.card.next, "첫 통화 잡기");
  assert.deepEqual(diff(a.card, b.card), { stage: ["inquiry", "contact"], due: ["2026-11-02", "2026-11-03"] });
  assert.deepEqual(diff(b.card, b.card), {});
});

test("기본 기한: 영업일(토 · 일 건너뜀), 당일이 주말이면 월요일", () => {
  assert.equal(addBusinessDays("2026-10-30", 1), "2026-11-02");   // 금 → 월
  assert.equal(addBusinessDays("2026-10-30", 3), "2026-11-04");
  assert.equal(addBusinessDays("2026-10-31", 0), "2026-11-02");   // 토 당일 → 월
  assert.equal(addBusinessDays("2026-11-02", 0), "2026-11-02");
  assert.equal(suggestDue("proposal", "2026-11-02"), "2026-11-05");
  assert.equal(suggestDue("hold", "2026-11-02"), null);
});

test("한국 날짜: UTC 15시가 넘으면 다음 날", () => {
  assert.equal(todayKst(Date.UTC(2026, 9, 30, 14, 59)), "2026-10-30");
  assert.equal(todayKst(Date.UTC(2026, 9, 30, 15, 0)), "2026-10-31");
});

test("CSV 칸: 쉼표 · 따옴표 · 줄바꿈은 따옴표로 싸고, 빈 값은 빈 칸", () => {
  const r = check(null, ok, team); assert.ok(r.ok);   // 칸 검사는 줄바꿈을 지우므로 CSV 만 보려고 직접 넣음
  const lines = csv([{ ...r.card, next: '전화, "오후"\n다시' }], e => e === "a@example.com" ? "김영업" : e).split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], '예시 세무회계,문의,김영업,문의,,,"전화, ""오후""\n다시",2026-11-02,,,');
});

test("아침 알림 대상: 오늘까지 기한인 진행 카드 · 다시 볼 날이 된 보류, 놓침은 빼기", () => {
  const c = check(null, ok, team); assert.ok(c.ok);
  assert.equal(dueToday(c.card, "2026-11-01"), false);
  assert.equal(dueToday(c.card, "2026-11-02"), true);
  assert.equal(dueToday({ ...c.card, stage: "lost" }, "2026-12-01"), false);
  assert.equal(dueToday({ ...c.card, stage: "hold", hold_until: "2026-11-05" }, "2026-11-05"), true);
});
