import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./legacy/shell.js", import.meta.url), "utf8");
const board = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

const consts = shell.match(/^  const SBW = \[200, 480\], RAIL = 72, TO_A = 160, TO_HIDE = 40, isW = .*$/m)![0];
const clamp = shell.match(/clampW = w => [^;]*;/)![0].replace(/;$/, "");
const step = shell.match(/^  const stepOf = .*$/m)![0];
const fns = new Function(`${consts}\nconst ${clamp};\n${step}\nreturn {stepOf, isW};`)() as { stepOf: (x: number) => number; isW: (w: number) => boolean };

test("끈 자리 → 단계: 160 이상 = 목록(200~480), 40~160 = 아이콘 막대 72, 40 밑 = 숨김(0)", () => {
  assert.equal(fns.stepOf(700), 480);
  assert.equal(fns.stepOf(300), 300);
  assert.equal(fns.stepOf(200), 200);
  assert.equal(fns.stepOf(170), 200, "160~200 은 200 에 붙음");
  assert.equal(fns.stepOf(160), 200);
  assert.equal(fns.stepOf(159), 72);
  assert.equal(fns.stepOf(72), 72);
  assert.equal(fns.stepOf(40), 72);
  assert.equal(fns.stepOf(39), 0);
  assert.equal(fns.stepOf(0), 0);
});

test("저장 값: 막대 72 · 목록 200~480 만 받음(그 밖은 기본 264)", () => {
  for (const w of [72, 200, 264, 480]) assert.equal(fns.isW(w), true, String(w));
  for (const w of [0, 71, 73, 199, 481, NaN]) assert.equal(fns.isW(w), false, String(w));
});

test("놓을 때 숨김이면 끌기 전 폭으로 되돌리고 접음(펴면 앞 단계로)", () => {
  assert.match(shell, /if \(R\.classList\.contains\('bx-colpv'\)\)\{ R\.classList\.remove\('bx-colpv'\); sbwSet\(w0 === 264 \? 0 : w0\); return setCol\(true\); \}/);
});

test("PC 사이드바는 안 A 목록(섹션 머리 없음), 폰 서랍은 예전 목록 그대로", () => {
  assert.match(shell, /const sbH = `<div class="top">\$\{logo\}<span class="tr"><button type="button" class="bx-colb" data-sbcol[^`]*` \+ sbA \+ foot;/);
  assert.match(shell, /const drH = `<div class="top">\$\{logo\}<span class="tr">\$\{fb\}<\/span><\/div>` \+ body \+ foot;/);
  const sbA = shell.match(/const sbA = [\s\S]*?\+ '<\/div>';/)![0];
  assert.doesNotMatch(sbA, /sec\(/, "PC 목록에 섹션 머리 없음");
  const order = ["'피드'", "새 글", "'찾기'", "+ ib +", "'에이전트'", "'노드'", "'캔버스'"].map(s => sbA.indexOf(s));
  assert.ok(order.every(i => i >= 0), "줄이 다 있음");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "피드 → 새 글 → 찾기 → 모아 보기 → 에이전트 → 노드 → 캔버스");
});

test("에이전트 화면 주소: #agents ↔ /agents(/channels · /a2a), Worker 가 앱 경로로 받음", () => {
  assert.match(board, /if \(p\[0\] === ['"]agents['"] && \(p\.length === 1 \|\| \(?p\.length === 2 && \/\^\(channels\|a2a\)\$\/\.test\(p\[1\]\)\)?\)\) return ['"]\/['"] \+ p\.join\(['"]\/['"]\) \+ qs;/);
  assert.match(board, /if \(p\[0\] === ['"]agents['"]\) return ['"]#agents['"] \+/);
  const m = index.match(/export const APP_PATH = (\/.*\/);/)!;
  const re = new Function(`return ${m[1]}`)() as RegExp;
  for (const p of ["/agents", "/agents/", "/agents/channels", "/agents/a2a"]) assert.ok(re.test(p), p);
  for (const p of ["/agents/x", "/agentsx"]) assert.ok(!re.test(p), p);
  assert.match(shell, /const ROUTE = \/\^#\(chat\\\/\|art\\\/\|node\\\/\|w\\\/\|inbox\$\|agents\(\\\/\|\$\)\)\/;/);
});
