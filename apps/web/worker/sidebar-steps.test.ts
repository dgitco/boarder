import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./legacy/shell.js", import.meta.url), "utf8");
const board = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

const consts = shell.match(/^  const SBW = \[200, 480\], RAIL = 72, TO_A = 160, TO_HIDE = 40, isW = .*$/m)![0];
const clamp = shell.match(/clampW = w => [^;]*;/)![0].replace(/;$/, "");
const feed = [/^  const feedOn = .*$/m, /^  const NSK = .*$/m, /^  const newsbPref = .*$/m, /^  const newOn = .*$/m].map(r => shell.match(r)![0]).join("\n");
const step = shell.match(/^  const stepOf = .*$/m)![0];
const mk = (cls: string[], pref = false) => new Function("R", "localStorage", "window", `${consts}\nconst ${clamp};\n${feed}\n${step}\nreturn {stepOf, isW};`)({ classList: { contains: (k: string) => cls.includes(k) } }, { getItem: (k: string) => (k === "hb-newsb:owner" && pref ? "1" : null) }, {}) as { stepOf: (x: number) => number; isW: (w: number) => boolean };
const fns = mk(["bx", "bx-x"]), other = mk(["bx"]), nodesTab = mk(["bx", "bx-x", "xnodes"]), otherOn = mk(["bx"], true);

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

test("피드 밖(노드 · 채팅 · 캔버스, 피드의 노드 칸)은 예전처럼 200~480 만 — 막대 · 숨김 없음", () => {
  for (const f of [other, nodesTab]) { assert.equal(f.stepOf(120), 200); assert.equal(f.stepOf(10), 200); assert.equal(f.stepOf(300), 300); assert.equal(f.stepOf(700), 480); }
});

test("같은 브라우저의 다른 계정 「켬」은 안 보임(사본 열쇠가 계정마다)", () => {
  const f = new Function("R", "localStorage", "window", `${consts}\nconst ${clamp};\n${feed}\n${step}\nreturn {stepOf};`)({ classList: { contains: (k: string) => k === "bx" } }, { getItem: (k: string) => (k === "hb-newsb:a@x.com" ? "1" : null) }, { HB_MEMBER: { email: "B@x.com" } });
  assert.equal(f.stepOf(120), 200, "B 는 기본 꺼짐");
});

test("설정 「새 사이드바(모든 화면)」(newsb)를 켠 사람은 피드 밖에서도 세 단계", () => {
  assert.equal(otherOn.stepOf(120), 72); assert.equal(otherOn.stepOf(10), 0); assert.equal(otherOn.stepOf(300), 300);
  assert.match(shell, /const sbH = !newOn\(\) \?/, "사이드바 목록도 같은 판정");
  assert.match(shell, /R\.classList\.toggle\('bx-newsb', v\)/);
});

test("저장 값: 막대 72 · 목록 200~480 만 받음(그 밖은 기본 264)", () => {
  for (const w of [72, 200, 264, 480]) assert.equal(fns.isW(w), true, String(w));
  for (const w of [0, 71, 73, 199, 481, NaN]) assert.equal(fns.isW(w), false, String(w));
});

test("놓을 때 숨김이면 끌기 전 폭으로 되돌리고 접음(펴면 앞 단계로)", () => {
  assert.match(shell, /if \(R\.classList\.contains\('bx-colpv'\)\)\{ R\.classList\.remove\('bx-colpv'\); sbwSet\(w0 === 264 \? 0 : w0\); return setCol\(true\); \}/);
});

test("피드 화면 PC 사이드바만 안 A 목록(섹션 머리 없음), 다른 화면 · 폰 서랍은 예전 목록", () => {
  assert.match(shell, /const sbH = !newOn\(\) \? `<div class="top">\$\{logo\}<span class="tr">\$\{fb\}<button[^`]*` \+ body \+ foot\n\s*: `<div class="top">\$\{logo\}<span class="tr"><button type="button" class="bx-colb" data-sbcol[^`]*` \+ sbA \+ foot;/, "피드(또는 새 사이드바를 켠 사람)면 안 A(sbA), 아니면 예전 목록(body)");
  assert.match(shell, /const drH = `<div class="top">\$\{logo\}<span class="tr">\$\{fb\}<\/span><\/div>` \+ body \+ foot;/);
  const sbA = shell.match(/const sbA = [\s\S]*?\+ '<\/div>';/)![0];
  assert.doesNotMatch(sbA, /sec\(/, "PC 목록에 섹션 머리 없음");
  const order = ["'피드'", "새 글", "'찾기'", "+ ib +", "'에이전트'", "'조직도'", "'캔버스'"].map(s => sbA.indexOf(s));
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
  assert.match(shell, /const ROUTE = \/\^#\(chat\\\/\|m\\\/\|art\\\/\|node\\\/\|w\\\/\|inbox\$\|agents\(\\\/\|\$\)\)\/;/);
});
