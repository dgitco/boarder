// node --test packages/cli/src/redact.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { SECRET_PATTERNS, redactLine } from './redact.mjs';

const boarder = `bxa_${'a'.repeat(24)}`;
const bearer = 'Abcdef012345._~+/=-';

test('CLI patterns match worker sources and flags', () => {
  const worker = readFileSync(new URL('../../../apps/web/worker/session/redact.ts', import.meta.url), 'utf8');
  const list = /export const SECRET_PATTERNS: RegExp\[\] = (\[[\s\S]*?\n\]);/.exec(worker);
  assert.ok(list, 'worker pattern list');
  const patterns = runInNewContext(list[1]);
  assert.deepEqual(SECRET_PATTERNS.map(re => [re.source, re.flags]), Array.from(patterns, re => [re.source, re.flags]));
});

test('JSON masking walks string values, preserving keys, escapes and other values', () => {
  const input = {
    [boarder]: { nested: [`Authorization = "Bearer ${boarder}"`, { text: `Bearer ${bearer}`, count: 42, flag: true, empty: null }] },
    escaped: 'quote " backslash \\ newline\n tab\t',
    encoded: boarder,
  };
  const line = JSON.stringify(input).replace('"encoded":"bxa_', '"encoded":"\\u0062xa_');
  const output = redactLine(line);
  assert.deepEqual(JSON.parse(output), {
    [boarder]: { nested: ['Authorization = "Bearer [secret]"', { text: 'Bearer [secret]', count: 42, flag: true, empty: null }] },
    escaped: input.escaped,
    encoded: '[secret]',
  });
  assert.equal(output.split('\n').length, 1);
  assert.equal(redactLine(JSON.stringify(boarder)), '"[secret]"');
});

test('non-JSON and blank lines are masked without adding or dropping lines', () => {
  const lines = [`Authorization = "Bearer ${boarder}"`, '', `Bearer ${bearer}`, '{broken'];
  const output = lines.map(redactLine).join('\n');
  assert.equal(output.split('\n').length, lines.length);
  assert.deepEqual(output.split('\n'), ['Authorization = "Bearer [secret]"', '', 'Bearer [secret]', '{broken']);
});

test('session save uploads masked lines and keeps offsets across repeated saves', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'boarder-redact-'));
  const file = path.join(dir, 'session.jsonl');
  const lines = [JSON.stringify({ text: `quote " \\ Bearer ${boarder}`, nested: [bearer, `Bearer ${bearer}`] }), '', `Authorization = "Bearer ${boarder}"`];
  writeFileSync(file, lines.join('\n') + '\n' + `unfinished ${boarder}`);
  const uploads = [];
  let offset = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') return res.end(JSON.stringify({ lines: offset }));
      uploads.push({ body, from: req.headers['x-session-from'] });
      const added = body.split('\n').length - 1;
      offset += added;
      res.end(JSON.stringify({ lines: offset, added }));
    });
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const env = { ...process.env, BOARDER_HOME: dir, BOARDER_TOKEN: 'fake-test-token', BOARDER_URL: `http://127.0.0.1:${server.address().port}` };
    const save = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [new URL('../bin/boarder.mjs', import.meta.url).pathname, 'session', 'save', '--file', file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      child.stdout.resume();
      child.stderr.on('data', chunk => err += chunk);
      child.on('error', reject);
      child.on('close', code => { try { assert.equal(code, 0, err); resolve(); } catch (e) { reject(e); } });
    });
    await save();
    await save();
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].from, '0');
    assert.equal(offset, lines.length);
    const uploaded = uploads[0].body.split('\n');
    assert.equal(uploaded.length, lines.length + 1);
    assert.deepEqual(JSON.parse(uploaded[0]), { text: 'quote " \\ Bearer [secret]', nested: [bearer, 'Bearer [secret]'] });
    assert.deepEqual(uploaded.slice(1), ['', 'Authorization = "Bearer [secret]"', '']);
    assert.ok(!uploads[0].body.includes(boarder));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('env dump: names without TOKEN/SECRET (KEK, HMAC) are masked, plain and as JSON', () => {
  const v1 = 'Zk9Qw3Lr7TnXv2Hs8Bd5Pc1Mj6Ya4Ue0';
  const v2 = 'q8W3e5R7t9Y1u3I5o7P9a2S4d6F8g0H1';
  const dump = `BOARDER_DATA_KEK_1=${v1}\nBOARDER_RELAY_HMAC=${v2}\nPATH=/usr/bin`;
  const out = dump.split('\n').map(redactLine).join('\n');
  assert.ok(!out.includes(v1) && !out.includes(v2));
  assert.ok(out.includes('PATH=/usr/bin'));
  const j = redactLine(JSON.stringify({ output: dump, BOARDER_DATA_KEK_1: v1 }));
  assert.ok(!j.includes(v1) && !j.includes(v2));
});
