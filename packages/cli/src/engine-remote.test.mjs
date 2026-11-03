// node --test packages/cli/src/engine-remote.test.mjs
// 보더 웹 설정 › 엔진이 내리는 기기 명령(account_list · account_login · engine_choose): 가짜 login 으로. 진짜 로그인 · 설치는 쓰지 않음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { EventEmitter } from 'node:events';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-remote-'));
process.env.BOARDER_HOME = path.join(home, 'cfg');
const R = await import('./engine/remote.mjs');

const fakeLaunch = (lines, { exit = null } = {}) => (cmd, args, o) => {
  const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter(); ch.kill = () => ch.emit('exit', 1);
  ch.spec = { cmd, args, env: o.env };
  setTimeout(() => { for (const l of lines) ch.stderr.emit('data', l); if (exit !== null) ch.emit('exit', exit); }, 5);
  fakeLaunch.last = ch; return ch;
};
const cli = { cmd: '/x/claude', pre: [], shell: false };

test('account_login: 출력된 주소를 돌려주고, 계정 폴더 환경 변수로만 로그인(토큰은 안 읽음)', async () => {
  const cfg = { sdk: { accounts: { claude: { a: path.join(home, 'acc-a') } } } };
  const r = await R.remoteVerb('account_login', { provider: 'claude', name: 'a' }, { cfg, find: () => cli, launch: fakeLaunch(['Opening browser...\n', 'visit https://claude.ai/oauth/authorize?code=true&x=1).\n']), waitMs: 500 });
  assert.deepEqual(r, { url: 'https://claude.ai/oauth/authorize?code=true&x=1', started: true });
  assert.equal(fakeLaunch.last.spec.env.CLAUDE_CONFIG_DIR, path.join(home, 'acc-a'));
  assert.deepEqual(fakeLaunch.last.spec.args, ['auth', 'login']);
  assert.ok(fs.existsSync(path.join(home, 'acc-a')));
  // 같은 계정 로그인이 아직 돌면 새로 안 띄우고 같은 주소
  const again = await R.remoteVerb('account_login', { provider: 'claude', name: 'a' }, { cfg, find: () => { throw new Error('다시 안 띄워야 함'); } });
  assert.deepEqual(again, { url: 'https://claude.ai/oauth/authorize?code=true&x=1', started: false });
  fakeLaunch.last.emit('exit', 0);
});

test('account_login: 주소가 안 나오면 기다림 끝에 url null · 이상한 이름 · 도구 없음은 오류', async () => {
  const cfg = { sdk: { accounts: { codex: { b: path.join(home, 'acc-b') } } } };
  const r = await R.remoteVerb('account_login', { provider: 'codex', name: 'b' }, { cfg, find: () => cli, launch: fakeLaunch(['no url here\n']), waitMs: 60 });
  assert.deepEqual(r, { url: null, started: true }); fakeLaunch.last.emit('exit', 0);
  await assert.rejects(R.remoteVerb('account_login', { provider: 'gemini', name: 'x' }, {}), /맞지 않아요/);
  await assert.rejects(R.remoteVerb('account_login', { provider: 'claude', name: '../x' }, {}), /맞지 않아요/);
  await assert.rejects(R.remoteVerb('account_login', { provider: 'claude', name: 'nocli' }, { cfg: {}, find: () => null }), /로그인 도구/);
});

test('account_login: 로그인이 바로 끝나면(이미 로그인) 그대로 돌려줌', async () => {
  const r = await R.remoteVerb('account_login', { provider: 'claude', name: 'quick' }, { cfg: {}, find: () => cli, launch: fakeLaunch([], { exit: 0 }), waitMs: 500 });
  assert.deepEqual(r, { url: null, started: true });
});

test('account_list: 공급자별 이름 · 로그인 여부만(값 없음)', async () => {
  const cfg = { sdk: { accounts: { claude: { a: path.join(home, 'la'), b: path.join(home, 'lb') }, codex: { c: path.join(home, 'lc') } } } };
  fs.mkdirSync(path.join(home, 'la'), { recursive: true }); fs.writeFileSync(path.join(home, 'la', '.credentials.json'), 'SECRET-DO-NOT-LEAK');
  const r = await R.accountsNow(cfg, { find: () => null });
  assert.deepEqual(r.accounts.claude.filter(x => ['a', 'b'].includes(x.name)), [{ name: 'a', logged_in: true }, { name: 'b', logged_in: false }]);
  assert.deepEqual(r.accounts.codex, [{ name: 'c', logged_in: false }]);
  assert.ok(!JSON.stringify(r).includes('SECRET'));
});

test('engine_choose: sdk 는 준비돼 있어야 · 없으면 설치 시도 · tmux 는 tmux 있을 때만 · 이상한 값은 거절', async () => {
  let saved = null;
  const save = c => { saved = JSON.parse(JSON.stringify(c)); };
  const r = await R.remoteVerb('engine_choose', { engine: 'sdk' }, { cfg: {}, save, sdkReady: async () => true });
  assert.equal(r.default, 'sdk'); assert.equal(saved.default, 'sdk'); assert.ok(saved.sdk);
  saved = null;
  await assert.rejects(R.remoteVerb('engine_choose', { engine: 'sdk' }, { cfg: {}, save, sdkReady: async () => false, install: async () => ({ ok: false, why: 'offline' }) }), /못 깔았어요/);
  assert.equal(saved, null, '실패하면 설정을 안 바꿈');
  let inst = 0;
  await R.remoteVerb('engine_choose', { engine: 'sdk' }, { cfg: {}, save, sdkReady: async () => false, install: async () => { inst++; return { ok: true }; } });
  assert.equal(inst, 1);
  await assert.rejects(R.remoteVerb('engine_choose', { engine: 'herdr' }, { cfg: {}, save }), /sdk 나 tmux/);
  const t = await R.remoteVerb('engine_choose', { engine: 'tmux' }, { cfg: { tmux: process.execPath }, save });
  assert.equal(t.default, 'tmux');
  assert.equal(await R.remoteVerb('open', {}, {}), null);
});
