import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const src = readFileSync(new URL("./legacy/shell.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("    gone(ws, code){"), src.indexOf("    retry(){"));
const spread = Number(/SPREAD = (\d+)/.exec(src)?.[1]);

function run(code: string, rnd: number) {
  const timers: { fn: () => void; ms: number }[] = [];
  const calls: string[] = [];
  const ctx = {
    now: () => 100_000, note: () => {}, document: { hidden: false }, SPREAD: spread,
    Math: { ...Math, random: () => rnd, min: Math.min },
    clearInterval: () => {}, clearTimeout: () => {},
    setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; },
  };
  const o = runInNewContext(`({${body}})`, ctx);
  const ws = {};
  Object.assign(o, { ws, wsUp: true, openAt: 0, t: {}, back: 8000, closed: false,
    poll: (f: boolean) => calls.push("poll" + (f ? "!" : "")), retry: () => calls.push("retry") });
  o.gone(ws, code);
  return { o, timers, calls };
}

test("서버가 닫음(1006): 바로 안 붙고 0–60초 뒤 폴링 · 다시 붙기", () => {
  assert.equal(spread, 60000);
  const { timers, calls, o } = run("1006", 0.5);
  assert.deepEqual(calls, []);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 30000);
  assert.equal(o.back, 500);
  timers[0].fn();
  assert.deepEqual(calls, ["poll!", "retry"]);
});

test("흩는 동안 다른 길로 이미 붙었으면 아무것도 안 함", () => {
  const { timers, calls, o } = run("1001", 0.9);
  o.ws = {};
  timers[0].fn();
  assert.deepEqual(calls, []);
});

test("핑 무응답(pong): 지금처럼 바로 폴링 · 다시 붙기", () => {
  const { timers, calls } = run("pong", 0.5);
  assert.deepEqual(calls, ["poll!", "retry"]);
  assert.equal(timers.length, 0);
});
