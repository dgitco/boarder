import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./test-hooks.mjs", import.meta.url);
const E = await import("./engine.ts");
const { TOOLS } = await import("./mcp/tools.ts");

test("메인 봇: 한 가지 부탁도 맞는 창으로 넘김(boarder split 한 몫 + 까닭) · 모르면 그 글 아래 한 줄로 되물음", () => {
  for (const sys of [E.mainSystem("a@example.com"), E.mainSystem("a@example.com", "모찌", false)]) {
    assert.match(sys, /one --part for a single ask/);
    assert.match(sys, /boarder split <id> --why "<one line[^"]*>" --part "<node>: /);
    assert.match(sys, /can't tell which node or role[^\n]*don't guess and don't split: ask them in one line under their message — `boarder chat --thread <id>/);
    assert.doesNotMatch(sys, /single ask is never split/);
  }
  assert.doesNotMatch(E.ONE_GOAL_MAIN, /writing in that role's channel/, "같은 목표 역할이 있으면 사람에게 채널로 가라고 하지 않고 넘김");
  assert.match(E.ONE_GOAL_MAIN, /hand the ask to that role with `boarder split`/);
  assert.match(E.PRIMARY_HINT, /boarder split <id> --why/);
  assert.match(E.PRIMARY_HINT, /can't tell which one, ask them in one line under their message/);
  const d = TOOLS.find(t => t.name === "chat_split")!.description;
  assert.match(d, /one part for a single ask/); assert.match(d, /can't tell which node, ask the person/);
  assert.doesNotMatch(d, /Don't use it for a single ask/);
});
