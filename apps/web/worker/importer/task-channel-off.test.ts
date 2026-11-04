// node --test --no-warnings --experimental-transform-types apps/web/worker/importer/task-channel-off.test.ts
// 「채널 = 태스크」(node_setting.data.task_channels)가 꺼진 회원은 main 의 옛 묶기 결과와 한 글자도 같아야 함.
// 기대값 group-parity.fixture.json = 이 스택 전 main 의 group.ts 로 group-parity.cases.ts 를 돌린 결과.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { group } from "./group.ts";
import { cases } from "./group-parity.cases.ts";

const want = JSON.parse(readFileSync(new URL("./group-parity.fixture.json", import.meta.url), "utf8")) as Record<string, unknown>;

test("설정 꺼진 회원: 업무 목록 · 리포를 넘겨도 묶기 결과가 main 과 같음(사례 39개)", async () => {
  const list = cases();
  assert.equal(list.length, Object.keys(want).length);
  for (const c of list) assert.deepEqual(JSON.parse(JSON.stringify(await group(structuredClone(c.input) as never))), want[c.name], c.name);
});

test("설정 꺼진 회원: taskChannels: false 를 적어도 같음", async () => {
  for (const c of cases()) assert.deepEqual(JSON.parse(JSON.stringify(await group({ ...structuredClone(c.input), taskChannels: false } as never))), want[c.name], c.name);
});
