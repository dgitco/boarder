// 사이드바 칸 순서 값 거르기(side-order.ts) — 모르는 · 겹친 열쇠는 버리고, 비면 null
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSide } from "./side-order.ts";

test("아는 열쇠만 · 처음 나온 자리 · 겹침 없음", () => {
  assert.deepEqual(cleanSide(["ch", "ib", "ch", "zz", 3, "rc"]), ["ch", "ib", "rc"]);
});
test("배열 아님 · 빈 배열 · 너무 긺 → null", () => {
  assert.equal(cleanSide("ib"), null);
  assert.equal(cleanSide([]), null);
  assert.equal(cleanSide(["zz"]), null);
  assert.equal(cleanSide(Array(21).fill("ib")), null);
});
