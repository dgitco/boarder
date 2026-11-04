// node --test packages/cli/src/watch-extra.test.mjs — 기기 세션 현황 선택 칸: usage-extra.json 을 계정 줄에 붙이기(지어낸 값)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const T = mkdtempSync(path.join(os.tmpdir(), 'bx-extra-'));
process.env.BOARDER_HOME = T;
const { extraAccounts } = await import('./watch.mjs');
const put = v => { const f = path.join(T, 'usage-extra.json'); writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); return f; };
test('파일이 없거나 망가지면 계정 줄 그대로', () => {
  const a = [{ email: 'a@example.com', status: 'unknown' }];
  assert.deepEqual(extraAccounts(a, path.join(T, 'none.json')), a);
  assert.deepEqual(extraAccounts(a, put('{망가짐')), a);
  assert.deepEqual(extraAccounts(a, put({ email: 'a@example.com' })), a, '목록이 아니면 그대로');
});
test('메일이 같은 줄에 덮음(대소문자 무시) · 한도가 있으면 상태 ok · 정해 둔 칸만', () => {
  const r = extraAccounts([{ email: 'a@example.com', status: 'unknown' }], put([{ email: 'A@example.com', acct: 'a', name: '개인', p7: 48, p5: 12, rate: 0.9, token: 'x' }]));
  assert.deepEqual(r, [{ email: 'a@example.com', status: 'ok', acct: 'a', name: '개인', p7: 48, p5: 12, rate: 0.9 }]);
});
test('맞는 줄이 없으면 새 줄 · 8줄까지 · 원래 배열은 안 바꿈', () => {
  const a = [{ email: 'a@example.com', status: 'unknown' }];
  const r = extraAccounts(a, put(Array.from({ length: 10 }, (_, i) => ({ acct: 'k' + i, p7: i }))));
  assert.equal(r.length, 8); assert.deepEqual(r[1], { status: 'ok', acct: 'k0', p7: 0 });
  assert.deepEqual(a, [{ email: 'a@example.com', status: 'unknown' }]);
});
test('칸마다 잘라 긴 값이 와도 지표 몸 상한(16KB)을 안 넘음 · 숫자 · 글자 말고는 버림', () => {
  const long = 'x'.repeat(20_000);
  const r = extraAccounts([{ email: 'a@example.com', status: 'unknown' }], put(Array.from({ length: 8 }, (_, i) => ({ email: i ? `b${i}${long}@example.com` : 'a@example.com', acct: long, name: long, plan: long, r5: long, r7: long, out_at: long, p7: 1, p5: { x: long } }))));
  assert.ok(Buffer.byteLength(JSON.stringify({ accounts: r })) < 16_384, '몸 상한 밑');
  assert.equal(r[0].name.length, 20); assert.equal(r[0].acct.length, 30); assert.equal(r[0].plan.length, 40); assert.equal(r[0].p7, 1); assert.equal(r[0].p5, undefined);
});
