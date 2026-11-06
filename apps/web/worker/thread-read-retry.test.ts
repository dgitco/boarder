import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const board = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
const a = board.indexOf("const RETRY = "), b = board.search(/document\.addEventListener\(["']click["'], \(?e\)? => \{\s*if \(e\.target\.closest\(["']\[data-chretry\]["']\)\)/);
assert.ok(a > 0 && b > a, "readErr 조각을 찾음(이 시험의 전제)");
const part = board.slice(a, b);

function load(fail: () => boolean, slow = false) {
  const timers: { fn: () => void; ms: number }[] = [], toasts: string[] = [], pending: (() => void)[] = [];
  let inflight = 0, maxInflight = 0;
  const ctx: any = {
    LU: (n: string) => `<svg data-lu="${n}"></svg>`, LOADING: "<SPIN>", ERR: "일시적인 오류가 발생했어요",
    window: {}, document: { hidden: false }, CS: { thr: { "1.1": { messages: [{ ts: "1.1" }], err: "503" } }, ch: {}, th: { k: "primary", ts: "1.1" }, at: "primary" },
    toast: (m: string) => toasts.push(m), setTimeout: (fn: () => void, ms = 0) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {}, setInterval: () => 0,
    isIbCh: () => false, chatOn: () => true, viewChat: () => { ctx.readErr("th:1.1", true); }, render: () => {}, cur: null, ans: { hidden: true }, sending: false,
    loadTh: async (_k: string, ts: string) => { ctx.rtSweep(); inflight++; maxInflight = Math.max(maxInflight, inflight);
      if (slow) await new Promise<void>(r => pending.push(r));
      inflight--; ctx.CS.thr[ts] = fail() ? { ...ctx.CS.thr[ts], err: "503" } : { messages: ctx.CS.thr[ts].messages }; }, loadCh: async () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(part + "\nthis.readErr = readErr; this.rtc = rtc; this.rtSweep = rtSweep;", ctx);
  return { ctx, timers, toasts, pending, max: () => maxInflight };
}
const flush = () => new Promise(r => setImmediate(r));
const tick = async (timers: { fn: () => void; ms: number }[]) => { const t = timers.filter(x => x.ms > 0).pop()!; timers.length = 0; t.fn(); await flush(); return t.ms; };

test("글이 있는 스레드가 다시 읽기에 실패 → 단추 없이 그대로 · 토스트 한 번 · 2초 뒤 저절로 다시 읽음", async () => {
  let n = 0; const { ctx, timers, toasts } = load(() => ++n < 2);
  assert.equal(ctx.readErr("th:1.1", true, "새 답글을"), "", "처음엔 ↻ 를 안 그림");
  timers.filter(x => x.ms === 0).forEach(x => x.fn());
  assert.deepEqual(toasts, ["일시적인 오류가 발생했어요"]);
  assert.equal(await tick(timers), 2000);
  assert.equal(ctx.CS.thr["1.1"].err, "503", "첫 자동 다시 읽기도 실패");
  assert.equal(await tick(timers), 5000);
  assert.equal(ctx.CS.thr["1.1"].err, undefined, "두 번째에 읽힘");
  assert.equal(ctx.rtc().n.size, 0, "다 읽히면 처음부터");
});

test("세 번 다 실패할 때만 「…불러오지 못했어요」 + 다시 불러오기 단추(Lucide rotate-cw) · 그 뒤 1분마다", async () => {
  const { ctx, timers } = load(() => true);
  ctx.readErr("th:1.1", true);
  const gaps: number[] = [];
  for (let i = 0; i < 3; i++){ assert.doesNotMatch(ctx.readErr("th:1.1", true, "새 답글을"), /retry/); gaps.push(await tick(timers)); }
  assert.deepEqual(gaps, [2000, 5000, 12000]);
  const h = ctx.readErr("th:1.1", true, "새 답글을");
  assert.match(h, /새 답글을 불러오지 못했어요/);
  assert.match(h, /aria-label="다시 불러오기"/);
  assert.match(h, /data-lu="rotate-cw"/);
  assert.equal(await tick(timers), 60000);
});

test("자동 다시 읽기는 겹쳐 돌지 않고, 읽기가 끝나기 전엔 실패 줄을 안 띄움(리뷰)", async () => {
  const { ctx, timers, pending, max } = load(() => true, true);
  ctx.readErr("th:1.1", true);
  await tick(timers);                       // 첫 자동 읽기 시작 — 끝나지 않음
  for (let i = 0; i < 5; i++) ctx.readErr("th:1.1", true);   // 그동안 화면이 여러 번 다시 그려짐
  assert.equal(timers.filter(x => x.ms > 0).length, 0, "도는 동안 새 타이머 없음");
  assert.equal(max(), 1);
  assert.equal(ctx.rtc().n.get("th:1.1") || 0, 0, "끝나기 전엔 안 셈");
  pending.shift()!(); await flush(); await flush();
  assert.equal(ctx.rtc().n.get("th:1.1"), 1, "끝나고 실패해야 하나");
  assert.equal(timers.filter(x => x.ms > 0).at(-1)?.ms, 5000, "그 뒤에 다음 하나");
});

test("자동 읽기 도중 새로 실패한 다른 스레드는 그 회차에 안 셈(리뷰 둘째)", async () => {
  const { ctx, timers, pending } = load(() => true, true);
  ctx.readErr("th:1.1", true);
  await tick(timers);                                   // 1.1 다시 읽는 중
  ctx.CS.thr["2.2"] = { messages: [{ ts: "2.2" }], err: "503" };   // 그사이 다른 스레드를 열어 첫 읽기 실패
  pending.shift()!(); await flush(); await flush();
  assert.equal(ctx.rtc().n.get("th:1.1"), 1);
  assert.equal(ctx.rtc().n.get("th:2.2") || 0, 0, "시도하지 않은 대상은 0");
});

test("평소 갱신으로 읽히면 수가 지워져, 다음 실패는 처음부터 2초(리뷰)", async () => {
  let ok = false; const { ctx, timers } = load(() => !ok);
  ctx.readErr("th:1.1", true);
  for (let i = 0; i < 3; i++) await tick(timers);
  assert.ok(ctx.readErr("th:1.1", true).includes("불러오지 못했어요"));
  ok = true; timers.length = 0; await ctx.loadTh("primary", "1.1");   // 평소 갱신(openThread · chatLoad)이 읽음
  ok = false; await ctx.loadTh("primary", "1.1");                     // 다음 갱신에서 다시 실패
  assert.equal(ctx.readErr("th:1.1", true), "", "처음부터 조용히");
  assert.equal(timers.filter(x => x.ms > 0).at(-1)?.ms, 2000);
});

test("끊김(HB_NET)이 타이머 뒤에 와도 다시 읽지 않음(리뷰)", async () => {
  let calls = 0; const { ctx, timers } = load(() => { calls++; return true; });
  ctx.readErr("th:1.1", true); ctx.window.HB_NET = "net";
  await tick(timers);
  assert.equal(calls, 0);
});

test("글이 없는 채널 · 스레드는 다시 읽는 동안 스피너", () => {
  const { ctx } = load(() => true);
  assert.equal(ctx.readErr("ch:primary"), "<SPIN>");
});

test("loadTh · loadCh 첫머리에서 수를 정리함(평소 갱신 성공을 놓치지 않게)", () => {
  assert.match(board, /async function loadTh\(k, ts\) ?\{\n  rtSweep\(\);/);
  assert.match(board, /async function loadCh\(k[^)]*\) ?\{\n  rtSweep\(\);/);
});
