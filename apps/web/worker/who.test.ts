// node --test --no-warnings --experimental-transform-types apps/web/worker/who.test.ts
// 열쇠 모듈(who.ts)이 예전 함수(cliKey · botKey · todoOwner · dekOwner · flagOwner)와 같은 값을 내는지 — 동작 안 바뀜 확인
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./who.ts";
const env = { ALLOW_EMAILS: "Boss@Example.test, two@example.test" };
const old = {
  cli: (e: string) => env.ALLOW_EMAILS.split(",").map(s => s.trim().toLowerCase()).includes(e.trim().toLowerCase()) ? "" : e.toLowerCase(),
  bot: (e: string) => env.ALLOW_EMAILS.split(",").map(s => s.trim().toLowerCase()).includes(e.trim().toLowerCase()) ? "@owner" : e.toLowerCase(),
  todo: (e: string) => env.ALLOW_EMAILS.split(",").map(s => s.trim().toLowerCase()).includes(e.trim().toLowerCase()) ? env.ALLOW_EMAILS.split(",")[0].trim().toLowerCase() : e.trim().toLowerCase(),
};
test("주인 · 회원 열쇠가 예전과 같음", () => {
  for (const e of ["boss@example.test", "TWO@example.test", "m@example.test", "M@Example.test"]) {
    assert.equal(W.dataKey(env, e), old.cli(e), e); assert.equal(W.botKey(env, e), old.bot(e), e); assert.equal(W.canonKey(env, e), old.todo(e), e);
  }
  assert.equal(W.canon(env), "boss@example.test");
  assert.deepEqual(W.ownerKeys(env), ["boss@example.test", "", "@owner"]);
  assert.equal(W.isAdmin({}, "x@y.z"), false);
});
