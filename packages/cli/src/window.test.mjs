import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WIN = fileURLToPath(new URL('./window.mjs', import.meta.url));

// 부모 셸을 고아로 띄움: Claude Code · Codex 안에서 시험을 돌려도 조상의 진짜 도구를 안 봄(Linux 는 /proc 라 가짜 ps 로 못 막음). 안쪽 셸이 부를 때마다 달라 부모 pid 도 다름
function keyIn(env, shellNote = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-wk-'));
  fs.writeFileSync(path.join(dir, 'ps'), '#!/bin/sh\necho "ps: Operation not permitted" >&2\nexit 1\n', { mode: 0o755 });   // 샌드박스처럼 ps 실패
  const base = { ...process.env }; for (const k of ['TMUX_PANE', 'BOARDER_WINDOW', 'BOARDER_WINDOW_NAME', 'CODEX_THREAD_ID']) delete base[k];
  fs.writeFileSync(path.join(dir, 'run.mjs'), `import { windowKey } from ${JSON.stringify(WIN)}; console.log(JSON.stringify(windowKey()))\n`);
  const inner = `${shellNote} sleep 0.2; "${process.execPath}" run.mjs; true`;   // 「; true」 — 셸이 exec 로 사라지지 않게
  const out = execFileSync('/bin/sh', ['-c', `(/bin/sh -c '${inner}' &)`], { encoding: 'utf8', cwd: dir, env: { ...base, PATH: `${dir}:${base.PATH || ''}`, ...env } });
  return JSON.parse(out.trim());
}

test('같은 Codex 대화면 명령마다 프로세스가 달라도 창 키가 같다', () => {
  const a = keyIn({ CODEX_THREAD_ID: '019a0000-made-up0-0000-000000000001' }), b = keyIn({ CODEX_THREAD_ID: '019a0000-made-up0-0000-000000000001' });
  assert.equal(a.key, b.key);
  assert.match(a.key, /:codex-sandbox:019a0000-made-up0-0000-000000000001$/);
  assert.match(a.name, /^터미널 · /, '샌드박스(도구를 못 찾음)면 이름은 예전 그대로 — 이름이 바뀌면 묶기가 달라짐');
});

test('다른 Codex 대화는 다른 창 키', () => {
  assert.notEqual(keyIn({ CODEX_THREAD_ID: '019a0000-made-up0-0000-00000000000a' }).key, keyIn({ CODEX_THREAD_ID: '019a0000-made-up0-0000-00000000000b' }).key);
});

test('보더 엔진 창(BOARDER_WINDOW)은 Codex 대화 id 보다 먼저', () => {
  const k = keyIn({ BOARDER_WINDOW: 'ew_madeup1', BOARDER_WINDOW_NAME: '팀장', CODEX_THREAD_ID: '019a0000-made-up0-0000-000000000001' });
  assert.match(k.key, /:ew_madeup1$/);
  assert.equal(k.name, '팀장');
});

test('Codex 대화 id 가 없으면(샌드박스 · ps 막힘) 예전처럼 부를 때마다 다른 키 — 시험이 무는지 보는 대조', () => {
  assert.notEqual(keyIn({}).key, keyIn({}).key);
});

test('대화 id 에 키에 못 쓰는 글자가 있으면 빼고 씀', () => {
  const k = keyIn({ CODEX_THREAD_ID: 'ab c;d$(x)' });
  assert.match(k.key, /:codex-sandbox:abcdx$/);
  assert.match(k.key, /^[\w@.:/+-]{2,120}$/);
});

test('셸 명령 글 안의 낱말(claude · cursor)이 Codex 대화 키를 이기지 않음', () => {
  const k = keyIn({ CODEX_THREAD_ID: '019a0000-made-up0-0000-000000000001' }, ': 이 claude 쪽 cursor 고침 ;');
  assert.match(k.key, /:codex-sandbox:019a0000-made-up0-0000-000000000001$/);
});

// ps 가 막힌 곳(맥 Codex 샌드박스)에서는 조상을 못 읽어 이 시험을 할 수 없음
const canReadParents = process.platform === 'linux' || (() => { try { execFileSync('ps', ['-p', String(process.pid)], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('Codex 셸 안에서 띄운 진짜 도구(claude)는 그 도구 키로', { skip: !canReadParents }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-wk-'));
  const shim = path.join(dir, 'claude');
  const child = `import(${JSON.stringify(WIN)}).then(m => console.log(JSON.stringify(m.windowKey())))`;
  fs.writeFileSync(shim, `#!${process.execPath}\nconst { execFileSync } = require('node:child_process'); process.stdout.write(execFileSync(process.execPath, ['-e', ${JSON.stringify(child)}], { encoding: 'utf8' }));\n`, { mode: 0o755 });
  const base = { ...process.env }; for (const k of ['TMUX_PANE', 'BOARDER_WINDOW', 'BOARDER_WINDOW_NAME']) delete base[k];
  const out = execFileSync('/bin/sh', ['-c', `("${shim}" &)`], { encoding: 'utf8', cwd: dir, env: { ...base, CODEX_THREAD_ID: '019a0000-made-up0-0000-000000000001' } });
  const k = JSON.parse(out.trim());
  assert.match(k.key, /:claude:\d+$/);
  assert.match(k.name, /^claude · /);
});

test('실행 파일 자리만 봄: python3 -c 글 · node -e 글의 낱말은 도구가 아님', { skip: process.platform !== 'linux' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-wk-'));
  const base = { ...process.env }; for (const k of ['TMUX_PANE', 'BOARDER_WINDOW', 'BOARDER_WINDOW_NAME']) delete base[k];
  const child = `import(${JSON.stringify(WIN)}).then(m => console.log(JSON.stringify(m.windowKey())))`;
  // 부모가 node -e '… claude …' — 그 글의 낱말을 도구로 치면 claude:<pid> 가 됨
  const parent = `/* 이 claude 쪽 고침 */ process.stdout.write(require('node:child_process').execFileSync(process.execPath, ['-e', ${JSON.stringify(child)}], { encoding: 'utf8' }))`;
  fs.writeFileSync(path.join(dir, 'p.sh'), `("${process.execPath}" -e ${JSON.stringify(parent).replace(/\$/g, '\\$')} &)\n`);
  const out = execFileSync('/bin/sh', [path.join(dir, 'p.sh')], { encoding: 'utf8', cwd: dir, env: { ...base, CODEX_THREAD_ID: '019a0000-made-up0-0000-000000000001' } });
  assert.match(JSON.parse(out.trim()).key, /:codex-sandbox:019a0000-made-up0-0000-000000000001$/);
});

test('대화 id 가 있어도 샌드박스 안과 밖은 키가 달라 이름이 첫 부름에 안 묶임', { skip: process.platform !== 'linux' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-wk-'));
  const shim = path.join(dir, 'codex');   // 샌드박스 밖 = 조상에 codex 가 보임
  const child = `import(${JSON.stringify(WIN)}).then(m => console.log(JSON.stringify(m.windowKey())))`;
  fs.writeFileSync(shim, `#!${process.execPath}\nprocess.stdout.write(require('node:child_process').execFileSync(process.execPath, ['-e', ${JSON.stringify(child)}], { encoding: 'utf8' }));\n`, { mode: 0o755 });
  const base = { ...process.env }; for (const k of ['TMUX_PANE', 'BOARDER_WINDOW', 'BOARDER_WINDOW_NAME']) delete base[k];
  const out = execFileSync('/bin/sh', ['-c', `("${shim}" &)`], { encoding: 'utf8', cwd: dir, env: { ...base, CODEX_THREAD_ID: '019a0000-made-up0-0000-000000000001' } });
  const outside = JSON.parse(out.trim()), inside = keyIn({ CODEX_THREAD_ID: '019a0000-made-up0-0000-000000000001' });
  assert.match(outside.key, /:codex:019a0000-made-up0-0000-000000000001$/); assert.match(outside.name, /^codex · /);
  assert.notEqual(outside.key, inside.key); assert.match(inside.name, /^터미널 · /);
});
