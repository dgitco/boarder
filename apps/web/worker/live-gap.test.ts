import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { BoardSnap } = await import("./board.ts");
function cell() {
  const sent: string[] = [], ws = { send: (m: string) => sent.push(m), close() {} };
  const ctx = { storage: { sql: { exec: () => ({ toArray: () => [], one: () => ({}) }) } }, getWebSockets: () => [ws], setWebSocketAutoResponse() {}, blockConcurrencyWhile: (f: () => unknown) => f(), acceptWebSocket() {} };
  return { d: new (BoardSnap as any)(ctx, {}), sent };
}
const data = (m: string) => JSON.parse(m).t.data;

test("회원 알림(gap 1000): 첫 글은 25ms, 몰린 쓰기는 1초에 한 번, 마지막 값이 나감", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const { d, sent } = cell();
  d.bump({ data: "~1" }, undefined, 1000);
  t.mock.timers.tick(25);
  assert.equal(sent.length, 1, "첫 글은 바로");
  for (let i = 2; i <= 40; i++) { d.bump({ data: "~" + i }, undefined, 1000); t.mock.timers.tick(25); }   // 975ms 동안 39번
  assert.equal(sent.length, 1, "1초 안에는 더 안 나감");
  t.mock.timers.tick(100);
  assert.equal(sent.length, 2, "1초가 지나면 묶어 한 글");
  assert.equal(data(sent[1]), "~40", "마지막 값");
  t.mock.timers.tick(5000);
  assert.equal(sent.length, 2, "쓰기가 없으면 더 안 나감");
});
test("주인 길(gap 없음)은 전처럼 25ms 마다", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const { d, sent } = cell();
  for (let i = 0; i < 4; i++) { d.bump({ data: "x" + i }); t.mock.timers.tick(25); }
  assert.equal(sent.length, 4);
});
