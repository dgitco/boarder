// node --test apps/web/worker/session/redact.test.ts (Node 22.18+)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from './redact.ts';

const boarder = `bxa_${'a'.repeat(24)}`;
const bearer = 'Abcdef012345._~+/=-';

test('redact masks Boarder tokens, including quoted Authorization config', () => {
  assert.equal(redact(`Authorization = "Bearer ${boarder}"`), 'Authorization = "Bearer [secret]"');
  assert.equal(redact(`bxd_${'b'.repeat(20)} ${boarder}`), '[secret] [secret]');
});

test('redact masks Bearer values and preserves surrounding text', () => {
  assert.equal(redact(`Authorization: Bearer ${bearer}`), 'Authorization: Bearer [secret]');
  assert.equal(redact(`"Bearer ${bearer}" and Bearer ${bearer}`), '"Bearer [secret]" and Bearer [secret]');
  assert.equal(redact('Bearer short bxa_short'), 'Bearer short bxa_short');
});
