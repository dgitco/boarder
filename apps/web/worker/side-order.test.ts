// 사이드바 칸 순서 값 거르기(side-order.ts) — 모르는 · 겹친 열쇠는 버리고, 비면 null
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanPins, cleanSide } from "./side-order.ts";

test("아는 열쇠만 · 처음 나온 자리 · 겹침 없음", () => {
  assert.deepEqual(cleanSide(["ch", "ib", "ch", "zz", 3, "rc"]), ["ch", "ib", "rc"]);
});
test("배열 아님 · 빈 배열 · 너무 긺 → null", () => {
  assert.equal(cleanSide("ib"), null);
  assert.equal(cleanSide([]), null);
  assert.equal(cleanSide(["zz"]), null);
  assert.equal(cleanSide(Array(21).fill("ib")), null);
});

test("고정 캔버스: 글자 좁힘 · 겹침 하나로 · 빈 목록은 다 뺌 · 틀린 값은 null", () => {
  assert.deepEqual(cleanPins([]), []);
  assert.deepEqual(cleanPins([{ id: "devicelive20261104", title: " 기기 판 " }, { id: "devicelive20261104", title: "또" }]), [{ id: "devicelive20261104", title: "기기 판" }]);
  assert.deepEqual(cleanPins([{ id: "abcd" }]), [{ id: "abcd", title: "abcd" }]);
  for (const bad of ["abcd", [{ id: "../x" }], [{ id: "a b c d" }], [{ id: "<img>" }], [{}], Array(13).fill({ id: "abcd" })]) assert.equal(cleanPins(bad), null);
});

test("왼쪽 칸 고정 캔버스 단추는 보드의 data-pin(타임라인 줄 고정)과 다른 이름 — 같으면 누를 때 보드가 없는 노드를 같이 엶", () => {
  const shell = readFileSync(new URL("./legacy/shell.js", import.meta.url), "utf8");
  const board = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
  assert.match(board, /closest\(['"]\[data-pin\]['"]\)/, "보드가 data-pin 클릭을 받음(이 시험의 전제)");
  assert.doesNotMatch(shell, /data-pin=|\[data-pin\]|dataset\.pin\b/, "왼쪽 칸이 data-pin 을 쓰지 않음");
  assert.match(shell, /data-sidepin=/);
});
