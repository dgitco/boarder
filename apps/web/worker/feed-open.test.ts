import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const tq = readFileSync(new URL("./legacy/tq.js", import.meta.url), "utf8");
const x = readFileSync(new URL("./legacy/x.js", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("tq.js = 브라우저에서 window.TQ(QueryClient …), process 를 안 씀, fetchQuery 가 같은 열쇠 요청을 하나로", async () => {
  assert.doesNotMatch(tq, /process\./, "브라우저엔 process 가 없음(묶을 때 NODE_ENV 를 박음)");
  const c: Record<string, any> = { setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, AbortController, Promise };   // 브라우저에 있는 것만
  c.window = c; c.self = c; vm.createContext(c); vm.runInContext(tq, c);
  for (const k of ["QueryClient", "QueryObserver", "InfiniteQueryObserver", "focusManager", "onlineManager"]) assert.ok(c.TQ?.[k], k);
  const qc = new c.TQ.QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });   // 시험이 끝나면 타이머 없이 닫히게
  let n = 0; const fn = () => new Promise(r => setTimeout(() => r(++n), 20));
  const [a, b] = await Promise.all([qc.fetchQuery({ queryKey: ["thr", "k", "1"], queryFn: fn }), qc.fetchQuery({ queryKey: ["thr", "k", "1"], queryFn: fn })]);
  assert.equal(n, 1, "겹친 요청은 하나"); assert.equal(a, b);
  await qc.fetchQuery({ queryKey: ["thr", "k", "1"], queryFn: fn, staleTime: 15000 }); assert.equal(n, 1, "15초 안엔 다시 안 받음");
  qc.clear();
});

test("워커가 피드 스크립트 앞에 tq.js 를 붙임", () => {
  assert.match(index, /import tqJs from "\.\/legacy\/tq\.js\?raw";/);
  assert.match(index, /const xJs = tqJs \+ "\\n;" \+ xJs0;/);
});

test("피드: 첫 그림 전엔 첫 쪽(10) + 5칸만, 안 받은 뿌리는 자리 칸(스피너 · 저절로 읽음 안 됨), 보이는 쪽만 · 쉬는 탭은 안 받음", () => {
  assert.match(x, /const jobs = \[\]; for \(const x of items\(\)\.slice\(0, X\.page \+ 5\)\) if \(x\.m\.ph \|\| \(x\.m\.replies && !thr\(x\.m\.ts\)\)\) jobs\.push/);
  assert.doesNotMatch(x, /const jobs = \[\.\.\.wantRoots\(\)\]/, "예전: 결정 · 안 읽음 뿌리 전부");
  assert.match(x, /else if \(!T \|\| \(T\.err && T\.errStatus !== 404 && T\.errStatus !== 403\)\)\{ out\.push\(\{k, m: \{ts: t, ph: true/, "받기 전 · 일시 오류 = 자리 칸, 404 · 403 만 뺌");
  assert.match(x, /if \(x\.m\.ph\) return `<div class="xu xph"/);
  assert.match(x, /querySelectorAll\('\.xu:not\(\.ask\):not\(\.xph\)'\)/, "자리 칸은 1초 보임 읽음에서 뺌");
  assert.match(x, /function fetchWanted\(\)\{ if \(document\.hidden \|\| !X\.shown\) return; const vis = new Set\(X\.shown\)/);
  assert.match(x, /setInterval\(\(\) => \{ if \(!document\.hidden\) refresh\(\); \}, 20000\)/);
});

test("피드: 같은 「마지막 답 시각」으로는 스레드를 한 번만(지운 답 등으로 되풀이 받던 것)", () => {
  assert.match(x, /X\.gotFor\.get\(x\.m\.ts\) !== lt\)\)\) loadThr\(x\.k, x\.m\.ts, true\)\.then\(ok => \{ if \(ok && lt\) X\.gotFor\.set\(x\.m\.ts, lt\); \}\)/, "받기에 성공한 뒤에만 「그 latest 로 받았음」");
  assert.match(x, /if \(!document\.hidden\) for \(const x of \[\.\.\.pg, \.\.\.next\]\)/, "숨긴 탭은 지금 쪽 · 다음 쪽도 안 받음");
  assert.match(x, /while \(i < jobs\.length && !document\.hidden\)/);
  assert.match(x, /const r0 = by\.get\(x\.thread \|\| x\.ts\) \|\| by\.get\(x\.ts\), r = r0\?\.m\.ph \? null : r0;/, "저장 화면은 자리 칸 대신 요약 줄");
  assert.match(x, /QC\.fetchQuery\(\{queryKey: key, queryFn: \(\) => thrGet\(k, ts\)\}\)/);
});

test("범위 탭 위에 얹음: 탭은 범위 탭 그대로, 옛 결정 · 읽지 않음 탭 받기 길은 없음, 완료 칸은 그 자리에", () => {
  assert.match(x, /const scTabs = \(\) =>/, "범위 탭 그대로");
  assert.doesNotMatch(x, /\['ask', '결정'\], \['un', '읽지 않음'\]/, "옛 탭 셋을 되살리지 않음");
  assert.doesNotMatch(x, /kickCand|X\.fl === 'ask'/, "결정 탭 후보 받기는 그 탭이 없어 뺌");
  assert.match(x, /const dAt = X\.done\.get\(m\.ts\); if \(dAt && lastAt \* 1000 > dAt\)\{ X\.done\.delete\(m\.ts\); keepDone\(\); \}/, "완료 칸은 건너뛰지 않음");
  assert.match(x, /all\.filter\(y => inSc\(X\.fl, y\.k\)\)/, "자리 칸도 범위 탭 거르기를 거침");
});
