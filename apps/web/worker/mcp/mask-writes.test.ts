// node --test --no-warnings --experimental-transform-types apps/web/worker/mcp/mask-writes.test.ts
// 에이전트가 보드에 쓰는 글은 저장 전에 비밀 꼴을 가림(도구 입구 run). 값은 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("../test-hooks.mjs", import.meta.url);
const { maskWrites } = await import("./tools.ts");
const FAKE = "bxa_" + "FAKEfake0123456789".repeat(3);

test("글 쓰는 도구: 글 · 물음 · 설명 · 깊은 칸의 비밀 꼴을 가림", () => {
  assert.equal(maskWrites("inbox_log", { kind: "progress", text: `토큰 ${FAKE} 끝` }).text, "토큰 [가림] 끝");
  assert.equal(maskWrites("inbox_say", { thread_id: "1793000000.000001", text: FAKE }).text, "[가림]");
  assert.equal(maskWrites("chat_say", { text: `Bearer ${FAKE}` }).text.includes(FAKE), false);
  const a = maskWrites("inbox_ask", { question: `물음 ${FAKE}`, body: `설명 ${FAKE}`, choices: [`안 ${FAKE}`, "아니요"] });
  assert.ok(!JSON.stringify(a).includes(FAKE));
  assert.deepEqual(a.choices[1], "아니요");
  const s = maskWrites("chat_split", { thread: "1793000000.000001", parts: [{ node: "노드", text: FAKE }] });
  assert.equal(s.parts[0].text, "[가림]");
});

test("보통 글 · id 는 그대로, 토큰 이야기 낱말도 그대로", () => {
  const t = { thread_id: "1793000000.000001", text: "bxa_ 로 시작하는 토큰 이야기 — 값은 없어요" };
  assert.deepEqual(maskWrites("inbox_say", t), t);
  assert.deepEqual(maskWrites("inbox_log", { kind: "blocked", text: "보통 글", unblocks: "me" }), { kind: "blocked", text: "보통 글", unblocks: "me" });
});

test("읽기 도구 입력은 건드리지 않음", () => {
  const q = { query: FAKE, limit: 5 };
  assert.deepEqual(maskWrites("inbox_cards", q), q);
  assert.deepEqual(maskWrites("session_search", q), q);
});

test("경로 · 노드 이름 · id 칸은 안 가림 — 글 칸만", () => {
  assert.equal(maskWrites("role_draft", { name: "역할", instructions: `값 ${FAKE}`, cwd: "~/work/rk-deploy-canary-rollback-watch" }).cwd, "~/work/rk-deploy-canary-rollback-watch");
  const s = maskWrites("chat_split", { thread: "1793000000.000001", parts: [{ node: "token:자동로그인담당자창", text: `글 ${FAKE}` }, { node: "pk_member_split_owner_index", text: "보통" }] });
  assert.equal(s.parts[0].node, "token:자동로그인담당자창");
  assert.equal(s.parts[1].node, "pk_member_split_owner_index");
  assert.ok(!s.parts[0].text.includes(FAKE));
});

