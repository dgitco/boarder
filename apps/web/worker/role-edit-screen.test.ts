// node --test --no-warnings --experimental-transform-types apps/web/worker/role-edit-screen.test.ts
// 설정 › 노드 「역할」 카드(legacy/settings.js 의 역할 고치기 덩어리 ROLE_F ~ roleMount): 새 의존성 없이 그 덩어리만 node:vm 으로 돌려 그리기 · 바뀐 칸 · 막기 · 결과 줄을 봄.
// 실제 브라우저 그림(PC 1440 · 폰 390)과 누르기 흐름은 PR 의 화면 전후 칸.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("./legacy/settings.js", import.meta.url), "utf8");
const line = (re: RegExp) => { const m = SRC.match(re); assert.ok(m, String(re)); return m![0]; };
// 덩어리 찾기는 코드로(공개 판은 주석을 뺌): const ROLE_F ~ function roleMount 앞
const at = SRC.indexOf("  const ROLE_F = "), end = SRC.indexOf("  function roleMount(");
assert.ok(at > 0 && end > at);
const BLOCK = SRC.slice(at, end);
const ctx: any = {};
vm.runInNewContext(line(/^  const esc = .*$/m) + "\n" + line(/^  const btn = .*$/m) + "\n" + BLOCK
  + "\nthis.R = {roleWins, roleDiff, roleBad, roleDone, roleSave, roleHtml};", ctx);
const { roleWins, roleDiff, roleBad, roleDone, roleSave, roleHtml } = ctx.R;
const st = (o = {}) => ({ open: null, busy: null, msg: {}, vals: {}, ...o });
const role = (o = {}) => ({ id: "r1", name: "기술장", brief: "리포 · PR 담당", instructions: "PR 은 리뷰 뒤 머지", source: "bot", updated_at: 1, windows: [{ id: "ew_a", name: "기술장", state: "idle" }, { id: "ew_b", name: "기술장", state: "busy" }, { id: "ew_c", name: "기술장", state: "parked" }], ...o });

test("역할이 없으면 카드를 그리지 않음(빈 글) — 주인 · 역할 없는 회원 화면 그대로", () => {
  assert.equal(roleHtml([], st()), ""); assert.equal(roleHtml(null, st()), ""); assert.equal(roleHtml(undefined, st()), "");
});

test("역할마다 한 줄: 이름 · 설명 한 줄 · 붙은 창 수와 상태; 기존 카드 꼴; 접힌 채 고치기 칸 없음", () => {
  const h = roleHtml([role(), role({ id: "r2", name: "비서실장", brief: "", windows: [] })], st());
  assert.match(h, /^<div class="bxs-sech">역할<\/div><div class="bxs-card" data-rl>/);
  assert.ok(h.includes("<b>기술장</b>") && h.includes("리포 · PR 담당") && h.includes("창 3곳 · 쉼 1 · 일함 1 · 주차 1"));
  assert.ok(h.includes("<b>비서실장</b>") && h.includes("설명 없음") && h.includes("붙은 창 없음"));
  assert.ok(!h.includes("data-rlf") && !h.includes("data-rls"));
  assert.equal((h.match(/data-rlo="/g) || []).length, 2);
  assert.ok(!/…중|중<|[<]{2}|「|」/.test(h.replace(/<[^>]+>/g, "")));
});

test("모든 값 이스케이프(이름 · 설명 · 지시 · id · 창 상태)", () => {
  const x = '<img src=x onerror="alert(1)">&\'';
  const h = roleHtml([role({ id: 'r"><b>', name: x, brief: x, instructions: x, windows: [{ id: "w", name: x, state: x }] })], st({ open: 'r"><b>', msg: { 'r"><b>': { t: x, bad: true } } }));
  assert.ok(!h.includes("<img") && !h.includes('r"><b>') && h.includes('data-rli="r&quot;&gt;&lt;b&gt;"'));
  assert.ok(h.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;"));
});

test("펼치면 이름(40) · 설명(200) · 지시(3000, textarea) · 저장 한 단추; 고친 값 · 글자 수 · 넘침 표시", () => {
  const h = roleHtml([role()], st({ open: "r1", vals: { r1: { name: "a".repeat(41) } } }));
  assert.match(h, /<input class="bxs-in" data-rlf="name" value="a{41}"/);
  assert.match(h, /<input class="bxs-in" data-rlf="brief" value="리포 · PR 담당"/);
  assert.match(h, /<textarea class="bxs-in" rows="8" data-rlf="instructions"[^>]*>PR 은 리뷰 뒤 머지<\/textarea>/);
  assert.ok(h.includes('class="bxs-mut bad" data-rlc="name">41/40') && h.includes('data-rlc="brief">10/200') && h.includes('data-rlc="instructions">12/3000'));
  assert.equal((h.match(/data-rls="/g) || []).length, 1);
  assert.ok(h.includes('aria-expanded="true"'));
});

test("저장 중은 스피너(g-spin) · 단추 잠금, 글자 「…중」 없음; 실패는 붉은 한 줄, 결과는 보통 줄", () => {
  const busy = roleHtml([role()], st({ open: "r1", busy: "r1" }));
  assert.match(busy, /<button type="button" class="bxs-btn pri" data-rls="r1" disabled aria-busy="true" aria-label="저장"><i class="g g-spin" aria-hidden="true"><\/i><\/button>/);
  assert.ok(!/중</.test(busy));
  assert.ok(roleHtml([role()], st({ open: "r1", msg: { r1: { t: "없는 역할이에요", bad: true } } })).includes('<p class="bxs-mut bad" data-rlm role="status"'));
  assert.ok(roleHtml([role()], st({ open: "r1", msg: { r1: { t: "열린 창 1곳에 바로 넣었어요", bad: false } } })).includes('<p class="bxs-mut" data-rlm role="status" style="min-width:0;overflow-wrap:anywhere">열린 창 1곳에 바로 넣었어요</p>'));
});

test("바뀐 칸만 · 앞뒤 공백은 서버처럼 떼고 견줌", () => {
  const r = role();
  assert.deepEqual({ ...roleDiff(r, {}) }, {});
  assert.deepEqual({ ...roleDiff(r, { name: " 기술장 ", brief: "리포 · PR 담당" }) }, {});
  assert.deepEqual({ ...roleDiff(r, { name: "기술장", instructions: " 새 지시\n둘째 줄 " }) }, { instructions: "새 지시\n둘째 줄" });
  assert.deepEqual({ ...roleDiff(r, { brief: "" }) }, { brief: "" });
});

test("저장 전 막기: 빈 이름 · 빈 지시 · 글자 수 넘침(설명 비우기는 됨)", () => {
  assert.equal(roleBad({ name: "" }), "이름을 넣어 주세요");
  assert.equal(roleBad({ instructions: "" }), "지시를 넣어 주세요");
  assert.equal(roleBad({ name: "a".repeat(41) }), "이름은 40자까지예요(지금 41자)");
  assert.equal(roleBad({ brief: "a".repeat(201) }), "설명은 200자까지예요(지금 201자)");
  assert.equal(roleBad({ instructions: "a".repeat(3001) }), "지시는 3000자까지예요(지금 3001자)");
  assert.equal(roleBad({ name: "a".repeat(40), brief: "", instructions: "a".repeat(3000) }), "");
});

test("결과 한 줄: 바로 넣음 · 줄 섬 · 못 넣음, 창 없음", () => {
  const D = (...s: string[]) => s.map((state, i) => ({ window: "w" + i, state }));
  assert.equal(roleDone(D("sent", "sent", "queued", "failed")), "열린 창 2곳에 바로 넣었어요 · 1곳은 줄 서 있어요 · 1곳은 못 넣었어요(다음에 다시 열 때 새 지시로)");
  assert.equal(roleDone(D("sent")), "열린 창 1곳에 바로 넣었어요");
  assert.equal(roleDone(D("queued", "failed")), "열린 창 1곳은 줄 서 있어요 · 1곳은 못 넣었어요(다음에 다시 열 때 새 지시로)");
  assert.equal(roleDone([]), "저장했어요 · 열린 창이 없어 다음에 창을 열 때 새 지시로 시작해요");
});

test("저장: 바뀐 칸만 보냄 · 막힌 입력은 안 보냄 · 서버 400 글은 그대로 한 줄", async () => {
  const calls: any[] = [];
  const ok = async (m: string, p: string, b: unknown) => { calls.push([m, p, b]); return { ok: true, role_id: "r/1", delivery: [{ window: "w", state: "sent" }, { window: "x", state: "queued" }] }; };
  const r = role({ id: "r/1" });
  const a = await roleSave(ok, r, { name: "기술장", instructions: "새 지시" });
  assert.equal(a.ok, true); assert.equal(a.line, "열린 창 1곳에 바로 넣었어요 · 1곳은 줄 서 있어요");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["POST", "api/me/roles/r%2F1", { instructions: "새 지시" }]]);
  calls.length = 0;
  assert.deepEqual({ ...(await roleSave(ok, r, { name: "  " })) }, { ok: false, line: "이름을 넣어 주세요" });
  assert.deepEqual({ ...(await roleSave(ok, r, { brief: "a".repeat(201) })) }, { ok: false, line: "설명은 200자까지예요(지금 201자)" });
  assert.deepEqual({ ...(await roleSave(ok, r, { name: "기술장" })) }, { ok: null, line: "바뀐 칸이 없어요" });
  assert.equal(calls.length, 0);
  const bad = async () => { throw Object.assign(new Error("역할 입력이 맞지 않아요(이름 40자 · 설명 200자 · 지시 3000자)"), { status: 400 }); };
  assert.deepEqual({ ...(await roleSave(bad, r, { instructions: "-x" })) }, { ok: false, line: "역할 입력이 맞지 않아요(이름 40자 · 설명 200자 · 지시 3000자)" });
});
