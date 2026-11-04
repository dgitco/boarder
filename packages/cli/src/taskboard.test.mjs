// node --test packages/cli/src/taskboard.test.mjs — boarder taskboard push 나누기: 서버 상한 밑 · 요청이 대화 줄보다 먼저(지어낸 값)
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chunks } = await import('./taskboard.mjs');
test('요청 250 · 대화 900줄 · 900KB 밑으로 나눔, 순서는 요청 → 지우기 → 대화', () => {
  const tasks = Array.from({ length: 600 }, (_, i) => ({ id: 'R' + i })), convo = Array.from({ length: 1000 }, (_, i) => ({ task_id: 'R0', k: 'c' + i, text: 'x', at: 1 }));
  const c = chunks({ tasks, convo, remove: ['R9'] });
  assert.ok(c.every(p => p.tasks.length <= 250 && p.convo.length <= 900 && Buffer.byteLength(JSON.stringify(p)) < 1_000_000));
  assert.deepEqual(c.flatMap(p => p.tasks).map(t => t.id), tasks.map(t => t.id));
  assert.equal(c.flatMap(p => p.convo).length, 1000);
  const firstConvo = c.findIndex(p => p.convo.length), lastTask = c.map(p => p.tasks.length > 0).lastIndexOf(true);
  assert.ok(firstConvo >= lastTask, '대화 줄은 마지막 요청 묶음과 같거나 뒤');
});
test('큰 글은 바이트로 나눔 · 빈 몸은 보낼 것 없음', () => {
  const big = 'ㄱ'.repeat(100_000), convo = Array.from({ length: 12 }, (_, i) => ({ task_id: 'R1', k: 'k' + i, text: big, at: 1 }));
  const cs = chunks({ convo }); assert.ok(cs.length >= 4); assert.ok(cs.every(p => Buffer.byteLength(JSON.stringify(p)) < 1_000_000), '한글 글도 바이트로 1MB 밑');
  assert.deepEqual(chunks({}), []);
});
test('도움말: said 의 k 를 다시 올릴 때 그대로 쓰라는 안내', async () => {
  const { TASKBOARD_HELP } = await import('./taskboard.mjs');
  assert.match(TASKBOARD_HELP, /same k/);
});
