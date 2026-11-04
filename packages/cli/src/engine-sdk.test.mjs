// node --test packages/cli/src/engine-sdk.test.mjs
// SDK 엔진(BYOS): 가짜 Agent SDK · Codex SDK 를 넣어 여섯 동사 + 계정 둘 + 데몬 윈도우 작업 파일을 시험. 진짜 구독 로그인은 쓰지 않음.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-sdk-'));
process.env.BOARDER_HOME = path.join(home, 'cfg');
const S = await import('./engine/sdk.mjs');
const { winLauncher, winTaskArgs, installWindows } = await import('./engine/daemon.mjs');
const I = await import('./engine/index.mjs');
const cfg = { sdk: { accounts: {} } };
const wait = async (f, ms = 2000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

let calls;
function fakeClaude() {
  let n = 0;
  return { query({ prompt, options }) {
    calls.push({ p: 'claude', prompt, options });
    const sid = options.resume || `cs-${++n}`;
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: sid };
      await new Promise(r => setTimeout(r, 30));
      if (options.abortController.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok:' + prompt, session_id: sid };
    })();
  } };
}
function fakeCodex() {
  let n = 0;
  class Thread { constructor(id, o) { this.id = id; this.o = o; } async runStreamed(text) { const t = this; calls.push({ p: 'codex', text, id: t.id, opt: t.o, env: t.env }); return { events: (async function* () { if (!t.id) t.id = `th-${++n}`; yield { type: 'thread.started', thread_id: t.id }; await new Promise(r => setTimeout(r, 30)); yield { type: 'turn.completed' }; })() }; } }
  class Codex { constructor(o) { this.env = o?.env; calls.push({ p: 'codex-new', home: o?.env?.CODEX_HOME }); } startThread(o) { return new Thread(null, o); } resumeThread(id, o) { return new Thread(id, o); } }
  return { Codex };
}
beforeEach(() => { calls = []; S._reset(); S._inject.claude = fakeClaude(); S._inject.codex = fakeCodex(); S._inject.loggedIn = () => true; fs.rmSync(path.join(process.env.BOARDER_HOME, 'sdk-windows.json'), { force: true }); });

test('로그인: 계정을 안 고른 창은 기본 로그인 → 로그인된 이름 있는 계정 → 없으면 이유를 말하고 안 엶', async () => {
  const c = { sdk: { accounts: {} } };
  fs.mkdirSync(path.join(home, 'cfg', 'sdk-accounts', 'claude', 'me'), { recursive: true });
  S._inject.loggedIn = () => false;
  await assert.rejects(S.open(c, { id: 'ew_nl1', name: 'nl', cwd: path.join(home, 'wnl'), prompt: 'x' }), /로그인되지 않았어요/);
  assert.equal(S.state(c, 'ew_nl1').state, 'none', '안 열림');
  S._inject.loggedIn = (prov, folder) => folder.endsWith(path.join('claude', 'me'));
  const o = await S.open(c, { id: 'ew_nl2', name: 'nl2', cwd: path.join(home, 'wnl2'), prompt: 'x' });
  assert.equal(o.account, 'me');
  assert.equal(calls[0].options.env.CLAUDE_CONFIG_DIR, path.join(home, 'cfg', 'sdk-accounts', 'claude', 'me'));
  S._inject.loggedIn = () => true;
  const d = await S.open(c, { id: 'ew_nl3', name: 'nl3', cwd: path.join(home, 'wnl3'), prompt: 'x' });
  assert.ok(!d.account, '기본 로그인이 있으면 계정을 안 씌움');
});

test('되살린 창(계정 비어 있음)도 글마다 로그인된 계정을 고름 · 없으면 이유가 state.error 에', async () => {
  const c = { sdk: { accounts: {} } };
  fs.mkdirSync(path.join(home, 'cfg', 'sdk-accounts', 'claude', 'me'), { recursive: true });
  S._inject.loggedIn = (prov, folder) => folder.endsWith(path.join('claude', 'me'));
  const o = await S.open(c, { id: 'ew_ra1', name: 'ra', cwd: path.join(home, 'wra'), prompt: 'x', account: 'me' });
  assert.equal(o.account, 'me');
  const reg = path.join(process.env.BOARDER_HOME, 'sdk-windows.json');
  const j = JSON.parse(fs.readFileSync(reg, 'utf8')); j.ew_ra1.account = null; j.ew_ra1.config_dir = null; fs.writeFileSync(reg, JSON.stringify(j));   // 계정이 비어 있는 옛 파일
  S._reset();   // 데몬이 다시 뜸: 파일에서 되살림
  const w = S.list(c).find(x => x.id === 'ew_ra1'); assert.ok(w);
  calls = [];
  await S.send(c, 'ew_ra1', 'again');
  await wait(() => S.state(c, 'ew_ra1').state !== 'busy');
  assert.equal(calls[0].options.env.CLAUDE_CONFIG_DIR, path.join(home, 'cfg', 'sdk-accounts', 'claude', 'me'), '비어 있던 계정을 로그인된 것으로 채움');
  S._inject.loggedIn = () => false; S._reset();
  const j2 = JSON.parse(fs.readFileSync(reg, 'utf8')); j2.ew_ra1.account = null; j2.ew_ra1.config_dir = null; fs.writeFileSync(reg, JSON.stringify(j2)); S._reset();
  await S.send(c, 'ew_ra1', 'again2').catch(() => {});
  await wait(() => S.state(c, 'ew_ra1').state !== 'busy');
  assert.match(S.state(c, 'ew_ra1').error || '', /로그인되지 않았어요/);
});

test('claude: 권한 모드 — auto 는 permissionMode auto, ask 는 기본(허락 없는 도구는 막힘)', async () => {
  await S.open(cfg, { id: 'ew_pa', name: 'pa', cwd: path.join(home, 'wpa'), prompt: 'x', perm: 'auto' });
  assert.equal(calls[0].options.permissionMode, 'auto');
  assert.ok(!calls[0].options.allowDangerouslySkipPermissions);
  calls = [];
  await S.open(cfg, { id: 'ew_pk', name: 'pk', cwd: path.join(home, 'wpk'), prompt: 'x', perm: 'ask' });
  assert.equal(calls[0].options.permissionMode, undefined);
});

test('claude: open → state → send → park → reopen(같은 대화) → close', async () => {
  const o = await S.open(cfg, { id: 'ew_c1', name: 'one', cwd: path.join(home, 'w1'), prompt: 'hello', perm: 'bypass', system: 'sys' });
  assert.equal(o.session_id, 'cs-1');
  assert.equal(calls[0].options.permissionMode, 'bypassPermissions');
  assert.equal(calls[0].options.env.BOARDER_WINDOW, 'ew_c1');
  assert.equal(S.state(cfg, 'ew_c1').state, 'busy');
  await assert.rejects(S.send(cfg, 'ew_c1', 'x'), e => e.code === 2);   // 턴 중이면 바쁨
  await wait(() => S.state(cfg, 'ew_c1').state === 'idle');
  await S.send(cfg, 'ew_c1', 'second');
  assert.equal(calls[1].options.resume, 'cs-1');
  await wait(() => S.state(cfg, 'ew_c1').state === 'idle');
  const { handle } = await S.park(cfg, 'ew_c1');
  assert.equal(handle.session_id, 'cs-1'); assert.equal(handle.engine, 'sdk');
  assert.equal(S.state(cfg, 'ew_c1').state, 'none');
  const r = await S.reopen(cfg, handle, 'back', 'ew_c1');
  assert.equal(r.session_id, 'cs-1');
  assert.equal(calls.at(-1).options.resume, 'cs-1'); assert.equal(calls.at(-1).prompt, 'back');
  await wait(() => S.state(cfg, 'ew_c1').state === 'idle');
  assert.deepEqual(await S.close(cfg, 'ew_c1'), { ok: true });
  assert.equal(S.state(cfg, 'ew_c1').state, 'none');
  assert.deepEqual(await S.close(cfg, 'ew_c1'), { ok: true, gone: true });
  await assert.rejects(S.send(cfg, 'ew_nope', 'x'), e => e.code === 4);
});

test('claude 계정 둘: account 로 CLAUDE_CONFIG_DIR 가 갈리고, 이름만 상태에 나감(폴더 · 로그인 값 없음)', async () => {
  const a = await S.open(cfg, { id: 'ew_a', cwd: path.join(home, 'wa'), prompt: 'a', account: 'work' });
  const b = await S.open(cfg, { id: 'ew_b', cwd: path.join(home, 'wb'), prompt: 'b', account: 'personal' });
  assert.equal(a.account, 'work'); assert.equal(b.account, 'personal');
  const da = calls[0].options.env.CLAUDE_CONFIG_DIR, db = calls[1].options.env.CLAUDE_CONFIG_DIR;
  assert.notEqual(da, db); assert.match(da, /sdk-accounts[\\/]claude[\\/]work$/); assert.match(db, /sdk-accounts[\\/]claude[\\/]personal$/);
  assert.equal(S.state(cfg, 'ew_a').account, 'work');
  assert.ok(!JSON.stringify(S.state(cfg, 'ew_a')).includes(da));
  const c2 = { sdk: { accounts: { claude: { team: path.join(home, 'teamdir') } } } };
  await S.open(c2, { id: 'ew_t', cwd: path.join(home, 'wt'), prompt: 't', account: 'team' });
  assert.equal(calls.at(-1).options.env.CLAUDE_CONFIG_DIR, path.join(home, 'teamdir'));
  await assert.rejects(S.open(cfg, { id: 'ew_bad', cwd: home, account: '../x' }), e => e.code === 1);
});

test('codex: 계정 둘(CODEX_HOME) · 같은 thread 로 이어 열기', async () => {
  const a = await S.open(cfg, { id: 'ew_x1', cwd: path.join(home, 'x1'), prompt: 'hi', provider: 'codex', account: 'a1' });
  await S.open(cfg, { id: 'ew_x2', cwd: path.join(home, 'x2'), prompt: 'hi', provider: 'codex', account: 'a2' });
  const homes = calls.filter(c => c.p === 'codex-new').map(c => c.home);
  assert.equal(homes.length, 2); assert.notEqual(homes[0], homes[1]); assert.match(homes[0], /sdk-accounts[\\/]codex[\\/]a1$/);
  assert.equal(a.session_id, 'th-1');
  await wait(() => S.state(cfg, 'ew_x1').state === 'idle');
  const { handle } = await S.park(cfg, 'ew_x1');
  assert.equal(handle.provider, 'codex'); assert.equal(handle.session_id, 'th-1');
  const r = await S.reopen(cfg, handle, 'again', 'ew_x1');
  assert.equal(r.session_id, 'th-1');
  assert.equal(calls.filter(c => c.p === 'codex').at(-1).id, 'th-1');
  assert.equal(S.list(cfg).length, 2);
  assert.equal(S.list(cfg)[0].meta.provider, 'codex');
});

test('SDK 가 없으면 창을 만들기 전에 친절한 오류, 한도 글은 state.limit', async () => {
  S._inject.claude = null;
  await assert.rejects(S.open(cfg, { id: 'ew_n', cwd: home, prompt: 'x' }), e => e.code === 1 && /boarder engine setup.*npm install --prefix/.test(e.message));
  assert.equal(S.state(cfg, 'ew_n').state, 'none');
  S._inject.claude = { query() { return (async function* () { yield { type: 'system', session_id: 's9' }; yield { type: 'result', is_error: true, result: 'Claude usage limit reached', session_id: 's9' }; })(); } };
  await S.open(cfg, { id: 'ew_l', cwd: home, prompt: 'x' });
  await wait(() => S.state(cfg, 'ew_l').state === 'idle');
  assert.match(S.state(cfg, 'ew_l').limit, /usage limit/);
});

test('데몬이 다시 떠도 창 · 대화 id 를 디스크 사본에서 되찾음(로그인 값 없음)', async () => {
  await S.open(cfg, { id: 'ew_p', cwd: home, prompt: 'x', account: 'work' });
  await wait(() => S.state(cfg, 'ew_p').state === 'idle');
  const raw = fs.readFileSync(path.join(process.env.BOARDER_HOME, 'sdk-windows.json'), 'utf8');
  assert.ok(!/token|secret|key/i.test(raw.replace(/session_id/g, '')));
  S._reset();
  const st = S.state(cfg, 'ew_p');
  assert.equal(st.state, 'idle'); assert.equal(st.session_id, 'cs-1'); assert.equal(st.account, 'work');
});

test('자가 시험(argv)은 모델 없이 되받기만 — sdk 가 여섯 동사 모두 통과', async () => {
  const c = I.loadCfg(); c.sdk = { accounts: {} }; I.saveCfg(c);
  const r = await I.selfTest('sdk');
  assert.deepEqual(r.caps, I.VERBS);
  assert.equal(calls.length, 0);
});

test('엔진 고르기: tmux 가 없고 cfg.sdk 가 있으면 sdk, default 로 고르면 sdk', () => {
  const c = { sdk: { accounts: {} } };
  assert.ok(I.adapters(c).sdk);
  assert.ok(!I.adapters({}).sdk);
  assert.equal(I.pick({ ...c, default: 'sdk' }), 'sdk');
});

test('윈도우 작업 스케줄러: 로그온 때 시작, 런처는 끝 코드 3 이면 멈춤', () => {
  const a = winTaskArgs();
  assert.deepEqual(a.slice(0, 6), ['/create', '/tn', 'BoarderEngine', '/sc', 'onlogon', '/tr']);
  const l = winLauncher('C:\\n\\node.exe', 'C:\\b\\boarder.mjs', { BOARDER_HOME: 'D:\\cfg', PATH: 'x' });
  assert.match(l, /set "BOARDER_HOME=D:\\cfg"/); assert.ok(!/PATH/.test(l));
  assert.match(l, /engine run/); assert.match(l, /if %errorlevel%==3 exit \/b 3/);
  assert.throws(() => winLauncher('C:\\n"x', 'b', {}));
});

test('SDK 자동 설치: npm install --prefix 로 깔고, 깔린 곳에서 import, 실패는 한 줄 원인 + 손 명령', async () => {
  S._inject.claude = null; S._inject.codex = null;
  const fakeNpm = path.join(home, 'npm'); fs.writeFileSync(fakeNpm, '');
  let cmd;
  const exec = (f, a) => {
    cmd = [f, ...a];
    for (const [pkg, body] of [['@anthropic-ai/claude-agent-sdk', 'export const query = () => "L";'], ['@openai/codex-sdk', 'export class Codex {}']]) {
      if (!a.includes(`${pkg}@${S.PINNED[pkg.startsWith('@openai') ? 'codex' : 'claude']}`)) continue;
      const r = path.join(S.sdkDir(), 'node_modules', ...pkg.split('/')); fs.mkdirSync(r, { recursive: true });
      fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: pkg, type: 'module', exports: { '.': { import: './index.js' } } })); fs.writeFileSync(path.join(r, 'index.js'), body);
    }
  };
  const bad = await S.installSdks({ exec: () => { throw Object.assign(new Error('x'), { stderr: 'E404 not found' }); }, npm: fakeNpm });
  assert.equal(bad.ok, false); assert.match(bad.why, /E404.*run by hand: npm install --prefix/);
  assert.equal((await S.installSdks({ exec, npm: null })).ok, false);
  const ok = await S.installSdks({ exec, npm: fakeNpm });
  assert.equal(ok.ok, true); assert.ok(cmd.includes('--prefix') && cmd.includes(S.sdkDir()));
  assert.ok(cmd.includes('--ignore-scripts') && cmd.includes('@anthropic-ai/claude-agent-sdk@0.3.317') && cmd.includes('@openai/codex-sdk@0.166.0'));   // 버전 고정 · 설치 스크립트 안 돌림
  assert.deepEqual(S.PINNED, { claude: JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).optionalDependencies['@anthropic-ai/claude-agent-sdk'], codex: JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).optionalDependencies['@openai/codex-sdk'] });
  assert.equal((await S.loadSdk('claude')).query(), 'L');
  assert.equal(typeof (await S.loadSdk('codex')).Codex, 'function');
  assert.deepEqual((await S.installSdks({ exec: () => assert.fail('이미 있음'), npm: fakeNpm })).missing, []);
});

test('윈도우 상주: schtasks 가 거절하면(SYSTEM 계정) 시작 폴더 .cmd 로, 어느 길인지 how 에', async () => {
  process.env.APPDATA = path.join(home, 'AppData');
  const refuse = async () => { throw new Error('ERROR: No mapping between account names and security IDs was done.'); };
  let started = 0;
  const r = await installWindows('C:\\n\\node.exe', 'x', { runCmd: refuse, startNow: () => { started++; } });
  assert.equal(r.ok, true); assert.match(r.how, /^Startup folder .*BoarderEngine\.cmd .*No mapping/);
  const f = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'BoarderEngine.cmd');
  assert.match(fs.readFileSync(f, 'utf8'), /engine-run\.cmd/); assert.equal(started, 1);
  const ok = await installWindows('n', {}, { runCmd: async () => {}, startNow: () => assert.fail() });
  assert.match(ok.how, /^Task Scheduler/);
});
