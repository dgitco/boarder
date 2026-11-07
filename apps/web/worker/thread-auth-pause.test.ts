// 실제 board.html의 getJSON/loadTh/재조회 함수를 실행해 인증 만료 뒤 요청 수를 검증한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const board = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
function slice(start: string, end: string) {
  const a = board.indexOf(start), b = board.indexOf(end, a);
  assert.ok(a >= 0 && b > a); return board.slice(a, b);
}
const source = slice("let rfRun = ", "async function refresh0")
  + slice("const ETC = ", "async function loadTopics")
  + slice("async function loadTh(", "let homeBusy = ")
  + slice("const RETRY = ", 'document.addEventListener("click", (e) => {\n  if (e.target.closest("[data-chretry]"))');
const flush = () => new Promise(r => setImmediate(r));
function setup(status = 401, body?: string, wrapped = false) {
  const timers = new Map<number, { fn: () => unknown; ms: number }>(), events: Record<string, (() => unknown)[]> = {};
  const calls: { url: string; headers: unknown; probe?: boolean }[] = [], sleeps: number[] = [];
  let timer = 0, now = 100_000, nextStatus = status, nextBody = body, nextError: Error | null = null, textReads = 0, held: Promise<void> | null = null, release!: () => void;
  const event = (name: string, fn: () => unknown) => (events[name] ||= []).push(fn);
  const ctx: any = {
    AbortController, Headers, Response, navigator: { onLine: true }, addEventListener: event, dispatchEvent() {}, CustomEvent: class { constructor(..._args: unknown[]) {} },
    localStorage: { getItem: () => null },
    LIVE: true, D: {}, refresh0: async () => { calls.push({url: "api/data", headers: {}}); }, LU: () => "<svg/>", LOADING: "<SPIN>", ERR: "일시적인 오류가 발생했어요",
    CS: { T: { threads: [] }, thr: { "1.1": { messages: [{ ts: "1.1", text: "기존 글" }] } }, ch: {}, th: { k: "primary", ts: "1.1" }, at: "primary" },
    window: { AbortController, addEventListener: event }, document: { hidden: false, visibilityState: "visible", addEventListener: event },
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn: () => unknown, ms = 0) => { timers.set(++timer, { fn, ms }); return timer; },
    clearTimeout: (id: number) => timers.delete(id), setInterval: () => 0,
    sleep: async (ms: number) => { sleeps.push(ms); }, rxFix() {}, isNodeCh: () => false, homeGo() {},
    isIbCh: () => false, chatOn: () => true, viewChat() {}, render() {}, cur: null, ans: { hidden: true }, sending: false, toast() {}, loadCh: async () => {},
    fetch: async (url: string, opt: any) => {
      calls.push({ url, headers: opt.headers, probe: opt.hbAuthProbe }); const status = nextStatus, body = nextBody, error = nextError;
      if (held) await held;
      if (error) throw error;
      return { status, ok: status >= 200 && status < 300, headers: { get: (name: string) => name === "x-request-id" ? "synthetic-request" : null },
        text: async () => { textReads++; return body ?? JSON.stringify(status === 200 ? { messages: [{ ts: "2.2", text: "복구한 글" }] } : { error: "합성 오류" }); } };
    },
  };
  ctx.window.fetch = ctx.fetch;
  Object.defineProperty(ctx, "fetch", { get: () => ctx.window.fetch });
  vm.createContext(ctx);
  if (wrapped) vm.runInContext(slice("(() => {\n  const f0 = window.fetch.bind(window)", "})();\n</script>") + "})();", ctx);
  vm.runInContext(source + "\nthis.readErr = readErr;", ctx);
  return { ctx, calls, sleeps, timers, textReads: () => textReads,
    status: (s: number, body?: string) => { nextStatus = s; nextBody = body; },
    advance: () => { now += 1001; },
    networkError: () => { nextError = new Error("합성 망 오류"); },
    hold: () => { held = new Promise(r => release = r); }, release: () => { held = null; release(); },
    emit: async (name: string) => { events[name]?.forEach(fn => { fn(); }); await flush(); },
  };
}

test("HTML/빈 몸통401도 한 요청으로 멈추고 기존 글·오류 메타를 보존", async () => {
  for (const body of ["", "<html>로그인</html>", '{"error":"로그인"}']) {
    const s = setup(401, body); await s.ctx.loadTh("primary", "1.1");
    assert.equal(s.calls.length, 1); assert.deepEqual(s.sleeps, []); assert.equal(s.textReads(), 0);
    assert.equal(s.ctx.CS.thr["1.1"].messages[0].text, "기존 글"); assert.equal(s.ctx.CS.thr["1.1"].errStatus, 401);
    assert.equal(s.ctx.rtc().auth.ts, "1.1");
    const json = setup(401, body);
    await assert.rejects(json.ctx.getJSON("api/chat/primary/1.1"), (e: any) => e.status === 401 && e.rid === "synthetic-request");
  }
});

test("401 뒤 분당 재조회·평소 스레드 갱신을 반복해도 요청이 늘지 않음", async () => {
  const s = setup(); await s.ctx.loadTh("primary", "1.1");
  for (let minute = 0; minute < 60; minute++) {
    s.advance(); s.ctx.autoRetry(); await s.ctx.retryReads(true); await s.ctx.retryReads(); await s.ctx.refresh(); await s.ctx.loadTh("primary", "1.1");
    await assert.rejects(s.ctx.getJSON("api/topics"), (e: any) => e.status === 401);
  }
  assert.equal(s.calls.length, 1); assert.equal([...s.timers.values()].filter(t => t.ms > 0).length, 0);
  assert.match(s.ctx.readErr("th:1.1", true), /불러오지 못했어요/); assert.doesNotMatch(s.ctx.readErr("th:1.1", false), /SPIN/);
});

test("숨은 탭은 재시도하지 않고, 복귀·포커스 묶음은 진행 중 조회1회만", async () => {
  const s = setup(); await s.ctx.loadTh("primary", "1.1"); s.ctx.document.hidden = true;
  await s.emit("focus"); await s.emit("visibilitychange"); assert.equal(s.calls.length, 1);
  s.ctx.document.hidden = false; s.hold(); await s.emit("visibilitychange");
  for (let i = 0; i < 20; i++) await s.emit("focus");
  assert.equal(s.calls.length, 2); s.release(); await flush();
  await s.emit("focus"); assert.equal(s.calls.length, 2, "빠른401뒤 따라온 포커스도1초안에는 합침");
  s.advance(); await s.emit("focus"); assert.equal(s.calls.length, 3, "다음 복귀 기회에는 한 번 더 확인");
});

test("복귀 조회가200이면 최신 글을 적용하고 정상 조회를 재개", async () => {
  const s = setup(); await s.ctx.loadTh("primary", "1.1"); s.status(200);
  await s.emit("focus"); assert.equal(s.calls.length, 2); assert.equal(s.ctx.rtc().auth, null);
  assert.equal(s.ctx.CS.thr["1.1"].messages[0].text, "복구한 글");
  await s.emit("visibilitychange"); assert.equal(s.calls.length, 2);
  await s.ctx.loadTh("primary", "1.1"); assert.equal(s.calls.length, 3);
});

test("복귀 조회가503·빈 응답이어도 한 번만 시도하고 다시 주기 조회하지 않음", async () => {
  const s = setup(); await s.ctx.loadTh("primary", "1.1"); s.status(503, "");
  await s.emit("focus"); assert.equal(s.calls.length, 2); assert.deepEqual(s.sleeps, []);
  s.ctx.autoRetry(); await s.ctx.retryReads(true); assert.equal(s.calls.length, 2); assert.ok(s.ctx.rtc().auth);
});

test("401 전에 예약한 재조회 타이머도 취소하고 뒤늦게 실행돼도 요청0", async () => {
  const s = setup(); s.ctx.CS.thr["1.1"].err = "503"; s.ctx.autoRetry();
  const old = [...s.timers.values()].find(t => t.ms === 2000)!; assert.ok(old);
  await s.ctx.loadTh("primary", "1.1"); assert.equal(s.ctx.rtc().t, 0);
  await old.fn(); assert.equal(s.calls.length, 1);
});

test("기존 다시 불러오기 단추도 인증 확인을 한 번만 수행", async () => {
  const s = setup(); await s.ctx.loadTh("primary", "1.1");
  await s.ctx.retryReads(false); await s.ctx.retryReads(false); assert.equal(s.calls.length, 2);
});

test("정상 글·403·404·일시503은 기존 의미 유지", async () => {
  for (const status of [200, 403, 404]) {
    const s = setup(status); await s.ctx.loadTh("primary", "1.1");
    assert.equal(s.calls.length, 1); assert.equal(s.ctx.rtc().auth, null);
    if (status !== 200) assert.equal(s.ctx.CS.thr["1.1"].messages.length, 0);
  }
  const s = setup(503); await s.ctx.loadTh("primary", "1.1");
  assert.equal(s.calls.length, 3); assert.deepEqual(s.sleeps, [700, 1400]); assert.equal(s.ctx.rtc().auth, null);
  s.ctx.autoRetry(); assert.ok([...s.timers.values()].some(t => t.ms === 2000));
});


test("인증 복귀뒤403·404면 없는 스레드로 끝내고 다른 읽기 정지는 해제", async () => {
  for (const status of [403, 404]) {
    const s = setup(); await s.ctx.loadTh("primary", "1.1"); s.status(status); await s.emit("focus");
    assert.equal(s.calls.length, 2); assert.equal(s.ctx.rtc().auth, null); assert.equal(s.ctx.CS.thr["1.1"].messages.length, 0);
    s.status(200); await s.ctx.loadTh("primary", "2.2"); assert.equal(s.calls.length, 3);
  }
});


test("실제 fetch 래퍼:401→focus→503은 단발, 분당 갱신·ping도 요청0", async () => {
  const s = setup(401, "", true); await s.ctx.loadTh("primary", "1.1"); assert.equal(s.calls.length, 1);
  s.status(503); await s.emit("focus"); assert.equal(s.calls.length, 2); assert.ok(s.ctx.rtc().auth);
  assert.equal(s.ctx.window.HB_NET, "", "복귀 확인이 서버 장애 점검을 켜지 않음");
  assert.ok(s.calls.every(c => c.probe === undefined), "내부 표지는 native fetch 전에 제거됨");
  for (let i = 0; i < 10; i++) {
    s.advance(); await s.ctx.window.hbPing(); await s.ctx.retryReads(true); await s.ctx.refresh();
    const r = await s.ctx.fetch("api/chats"); assert.equal(r.status, 401);
  }
  assert.equal(s.calls.length, 2, "알림·다른 읽기·점검은 실제 네트워크 요청을 추가하지 않음");
  s.advance(); s.status(200); await s.emit("visibilitychange"); assert.equal(s.calls.length, 3); assert.equal(s.ctx.rtc().auth, null);
});

test("실제 fetch 래퍼:복귀 확인 망오류도 타이머 재시도·점검 없음", async () => {
  const s = setup(401, "", true); await s.ctx.loadTh("primary", "1.1");
  s.networkError(); await s.emit("focus");
  assert.equal(s.calls.length, 2); assert.ok(s.ctx.rtc().auth);
  assert.equal(s.ctx.window.HB_NET, "");
  await s.ctx.window.hbPing(); assert.equal(s.calls.length, 2);
});


test("실제 fetch 래퍼:로그인 정지 중에도 POST는 기존 길 그대로", async () => {
  const s = setup(401, "", true); await s.ctx.loadTh("primary", "1.1"); s.status(200);
  const response = await s.ctx.fetch("api/draft", { method: "POST", headers: {} });
  assert.equal(response.status, 200); assert.equal(s.calls.length, 2); assert.ok(s.ctx.rtc().auth);
});
