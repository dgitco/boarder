// node --test --no-warnings --experimental-transform-types apps/web/worker/importer/device-engine.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceFeatures } from "./device-engine.ts";

const NOW = 1_000_000_000;
test("SDK 엔진처럼 보고를 안 올려도, 엔진 데몬이 최근에 붙었으면 엔진 켜짐", () => {
  assert.deepEqual(deviceFeatures(null, '{"default":"sdk","engines":["sdk"]}', NOW - 30_000, NOW), { engine: true });
  assert.deepEqual(deviceFeatures('{"report":["claude"]}', '{"engines":["sdk"]}', NOW - 1000, NOW), { report: ["claude"], engine: true });
});
test("엔진을 끄고 데몬이 멈춰 낡은 기기는 켜짐으로 안 봄(컬럼이 남아 있어도)", () => {
  assert.equal(deviceFeatures(null, '{"engines":["sdk"]}', NOW - 300_000, NOW), null);
  assert.deepEqual(deviceFeatures('{"engine":false}', '{"engines":["sdk"]}', NOW - 300_000, NOW), { engine: false });
});
test("하네스 기기는 회원 엔진이 아니라 켜짐으로 안 봄", () => {
  assert.equal(deviceFeatures(null, '{"harness":true}', NOW - 1000, NOW), null);
});
test("보고로 켠 기기는 그대로 · 이상한 값은 안전", () => {
  assert.deepEqual(deviceFeatures('{"engine":true}', null, null, NOW), { engine: true });
  assert.equal(deviceFeatures("{", "{", NOW, NOW), null);
  assert.equal(deviceFeatures(null, null, null, NOW), null);
});
