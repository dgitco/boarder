import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);
const { finalOf } = await import("./queue.ts");

const env = (seen: boolean | "err") => ({
  ALLOW_EMAILS: "owner@example.com",
  SNAP: { idFromName: () => { throw new Error("rid 칸은 안 부름"); }, get: () => { throw new Error("rid 칸은 안 부름"); } },
  DB: { prepare: () => ({ bind: () => ({ first: async () => { if (seen === "err") throw new Error("D1 오류"); return seen ? { 1: 1 } : null; } }) }) },
}) as never;

test("D1 에 rid 있음 = ok(final 표지)", async () => {
  assert.deepEqual(await finalOf(env(true), "rid-abc123"), { state: "ok", final: true });
});
test("D1 에 없음 = unknown — 「저장 안 됨」으로 말하지 않음(처리 중 · 재선점 · 옛 다리 rid)", async () => {
  assert.deepEqual(await finalOf(env(false), "rid-abc123"), { state: "unknown", final: true });
});
test("모양이 틀린 rid = unknown", async () => {
  assert.deepEqual(await finalOf(env(true), "x"), { state: "unknown", final: true });
});
test("D1 오류는 던짐(부른 쪽 503 = 모름)", async () => {
  await assert.rejects(finalOf(env("err"), "rid-abc123"));
});
