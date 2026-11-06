import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync(new URL("./legacy/shell.js", import.meta.url), "utf8");
const code = source.slice(source.indexOf("  let chatsRun ="), source.indexOf("\n  setInterval(() => { if (on() && lists.sig"));
// 바꾸기 전 두 줄을 그대로 실행해 보이는 목록 결과를 대조한다.
const oldCode = `const loadChats = () => { fetch('api/chats', {credentials: 'include'}).then(r => r.ok ? r.json() : null).then(j => { if (j && Array.isArray(j.chats)){ window.HB_CHATS = j.chats; if (on()) lists(); } }).catch(() => {}); };
loadChats(); setInterval(loadChats, 20000); window.addEventListener('hb-chats', () => { if (on()) lists(); setTimeout(loadChats, 1500); });`;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(hidden = false, script = code) {
  const events: Record<string, () => void> = {}, waits = new Map<number, {f: () => void; ms: number}>();
  const pending: {reply: (j: unknown, ok?: boolean) => void; fail: () => void}[] = [];
  const document = { hidden, addEventListener: (k: string, f: () => void) => { events[k] = f; } };
  const window: any = { addEventListener: (k: string, f: () => void) => { events[k] = f; } };
  let count = 0, active = 0, max = 0, timer = 0, interval!: () => void;
  runInNewContext(script, { document, window, on: () => true, lists: () => {}, AbortController,
    fetch: (_url: string, opt: {signal: AbortSignal}) => {
      count++; active++; max = Math.max(max, active);
      return new Promise((resolve, reject) => {
        const remove = () => { active--; pending.splice(pending.indexOf(item), 1); opt.signal?.removeEventListener('abort', item.fail); };
        const item = { reply: (j: unknown, ok = true) => { remove(); resolve({ok, json: async () => j}); }, fail: () => { remove(); reject(new Error('network')); } };
        pending.push(item); opt.signal?.addEventListener('abort', item.fail);
      });
    },
    setInterval: (f: () => void) => { interval = f; },
    setTimeout: (f: () => void, ms: number) => { waits.set(++timer, {f, ms}); return timer; }, clearTimeout: (id: number) => waits.delete(id) });
  const due = (ms = 1500) => { for (const [id, job] of [...waits]) if (job.ms === ms){ waits.delete(id); job.f(); } };
  return { document, window, events, tick: () => interval(), due,
    reply: async (chats: unknown[] = [], ok = true) => { pending[0].reply({chats}, ok); await flush(); },
    fail: async () => { pending[0].fail(); await flush(); }, count: () => count, max: () => max };
}

test("보이는 탭은 초기·20초 주기 결과를 그대로 적용", async () => {
  const s = setup(); assert.equal(s.count(), 1); await s.reply([{sid: "first"}]);
  s.tick(); assert.equal(s.count(), 2); await s.reply([{sid: "new"}]);
  assert.equal(s.window.HB_CHATS[0].sid, "new");
});
test("숨긴 탭은 초기·주기·사건 요청0, 돌아오면 건너뛴 읽기 한 번", async () => {
  const s = setup(true); s.tick(); s.events['hb-chats'](); s.due(); assert.equal(s.count(), 0);
  s.document.hidden = false; s.events.visibilitychange(); assert.equal(s.count(), 1); await s.reply();
  s.events.visibilitychange(); assert.equal(s.count(), 1, "건너뛴 읽기가 없으면 복귀가 조회를 추가하지 않음");
});
test("hb-chats100개는 1.5초 타이머 하나, 느린 요청 중100개는 뒤 읽기 하나", async () => {
  const s = setup();
  for (let i = 0; i < 100; i++) s.events['hb-chats']();
  s.due(); assert.equal(s.count(), 1);
  for (let i = 0; i < 100; i++) s.tick();
  await s.reply([{sid:"old"}]); assert.equal(s.count(), 2); assert.equal(s.max(), 1);
  await s.reply([{sid:"latest"}]); assert.equal(s.window.HB_CHATS[0].sid, "latest"); assert.equal(s.count(), 2);
});
test("뒤 읽기를 기다리다 숨으면 멈추고, 보일 때 최신 값을 다시 받음", async () => {
  const s = setup(); s.tick(); s.document.hidden = true; await s.reply(); assert.equal(s.count(), 1);
  s.document.hidden = false; s.events.visibilitychange(); assert.equal(s.count(), 2); await s.reply([{sid:"latest"}]);
  assert.equal(s.window.HB_CHATS[0].sid, "latest");
});
test("잘못된 목록은 기존 화면을 보존하고 다음 주기에 회복", async () => {
  const s = setup(); await s.reply([{sid:"keep"}]); s.tick(); await s.reply(null as any);
  assert.equal(s.window.HB_CHATS[0].sid, "keep"); s.tick(); await s.reply([{sid:"next"}]);
  assert.equal(s.window.HB_CHATS[0].sid, "next");
});

test("요청 실패도 조용히 끝내고 대기 중 마지막 사건을 읽어 회복", async () => {
  const s = setup(); s.tick(); await s.fail(); assert.equal(s.count(), 2);
  await s.reply([{sid:"recovered"}]); assert.equal(s.window.HB_CHATS[0].sid, "recovered");
  s.tick(); await s.reply([{sid:"next"}]); assert.equal(s.window.HB_CHATS[0].sid, "next");
});

test("8초 무응답은 중단하고 기다리던 마지막 조회로 회복", async () => {
  const s = setup(); s.tick(); s.due(8000); await flush(); assert.equal(s.count(), 2); assert.equal(s.max(), 1);
  await s.reply([{sid:"after-timeout"}]); assert.equal(s.window.HB_CHATS[0].sid, "after-timeout");
});
test("HTTP 오류는 기존 목록을 보존하고 다음 주기에 회복", async () => {
  const s = setup(); await s.reply([{sid:"keep"}]); s.tick(); await s.reply([], false);
  assert.equal(s.window.HB_CHATS[0].sid, "keep"); s.tick(); await s.reply([{sid:"ok"}]);
  assert.equal(s.window.HB_CHATS[0].sid, "ok");
});

test("옛 길과 보이는 목록 결과 동일: 새 세션·이름 변경·빈 목록·HTTP 오류", async () => {
  const old = setup(false, oldCode), next = setup();
  for (const [rows, ok] of [ [[{sid:"a", title:"첫 대화"}], true], [[{sid:"a", title:"고친 이름"}, {sid:"b", title:"새 대화"}], true], [[], false], [[], true] ] as const) {
    await old.reply(rows as any, ok); await next.reply(rows as any, ok);
    assert.deepEqual(JSON.parse(JSON.stringify(next.window.HB_CHATS)), JSON.parse(JSON.stringify(old.window.HB_CHATS)));
    old.tick(); next.tick();
  }
  await old.reply(); await next.reply();
  assert.equal(old.count(), next.count(), "정상 보임의 요청 주기·개수는 그대로");
});

test("본문이 멈춰도 8초 뒤 잠금이 풀리고 다음 주기에 회복", async () => {
  let tick!: () => void, deadline!: () => void, count = 0;
  const window: any = {addEventListener() {}};
  runInNewContext(code, {window, document: {hidden:false, addEventListener() {}}, on: () => false, lists() {}, AbortController,
    setInterval: (f: () => void) => {tick = f;}, setTimeout: (f: () => void, ms: number) => {if (ms === 8000) deadline = f; return 1;}, clearTimeout() {},
    fetch: async (_url: string, opt: {signal: AbortSignal}) => ({ok:true, json: ++count === 1
      ? () => new Promise((_resolve, reject) => opt.signal.addEventListener('abort', () => reject(new Error('body timeout'))))
      : async () => ({chats:[{sid:"after-body-timeout"}]})})});
  await flush(); deadline(); await flush(); tick(); await flush();
  assert.equal(count, 2); assert.equal(window.HB_CHATS[0].sid, "after-body-timeout");
});
