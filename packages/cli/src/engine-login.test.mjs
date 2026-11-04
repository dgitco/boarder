// node --test packages/cli/src/engine-login.test.mjs
// engine account login · list: 가짜 실행기로 명령 조립 · 환경 변수 · 로그인 확인. 진짜 로그인은 쓰지 않음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-login-'));
process.env.BOARDER_HOME = path.join(home, 'cfg');
const L = await import('./engine/login.mjs');
const sdk = '/s';
const has = set => f => set.includes(f);

test('findCli: 네이티브 실행 파일 → codex.js(node) → PATH, 플랫폼별 이름', () => {
  const nm = (...p) => path.join(sdk, 'node_modules', ...p);
  const f = (prov, files, platform, arch, which = () => null) => L.findCli(prov, { sdk, exists: has(files), which, platform, arch });
  assert.deepEqual(f('claude', [nm('@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe')], 'win32', 'x64'), { cmd: nm('@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe'), pre: [], shell: false, from: 'sdk' });
  assert.equal(f('claude', [nm('@anthropic-ai', 'claude-agent-sdk-linux-x64', 'claude')], 'linux', 'x64').cmd, nm('@anthropic-ai', 'claude-agent-sdk-linux-x64', 'claude'));
  assert.equal(f('claude', [nm('@anthropic-ai', 'claude-agent-sdk-linux-x64-musl', 'claude')], 'linux', 'x64').from, 'sdk');
  assert.equal(f('claude', [nm('@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude')], 'darwin', 'arm64').from, 'sdk');
  // cli.js 는 더 이상 후보 아님
  assert.equal(f('claude', [nm('@anthropic-ai', 'claude-agent-sdk', 'cli.js')], 'linux', 'x64', () => '/x/claude').from, 'path');
  const cx = nm('@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  assert.equal(f('codex', [cx], 'win32', 'x64').cmd, cx);
  const cm = nm('@openai', 'codex-darwin-arm64', 'vendor', 'aarch64-apple-darwin', 'bin', 'codex');
  assert.equal(f('codex', [cm], 'darwin', 'arm64').cmd, cm);
  assert.equal(f('codex', [nm('@openai', 'codex-linux-x64', 'vendor', 'x86_64-unknown-linux-musl', 'bin', 'codex')], 'linux', 'x64').pre.length, 0);
  const js = nm('@openai', 'codex', 'bin', 'codex.js');
  assert.deepEqual(f('codex', [js], 'linux', 'x64'), { cmd: process.execPath, pre: [js], shell: false, from: 'sdk' });
  assert.equal(f('codex', [js, cm], 'darwin', 'arm64').cmd, cm);   // 네이티브가 우선
  assert.equal(f('codex', [], 'linux', 'x64', () => '/x/codex').from, 'path');
  assert.equal(f('codex', [], 'linux', 'x64'), null);
  assert.equal(f('codex', [], 'win32', 'x64', () => 'C:\\n\\codex.cmd').shell, true);
});

test('loginSpec: 명령 · 환경 변수 · 윈도우 .cmd 따옴표', () => {
  const c = { cmd: '/x/claude', pre: [], shell: false };
  const a = L.loginSpec('claude', c, '/h/a', { baseEnv: { P: 1 } });
  assert.deepEqual([a.cmd, a.args, a.env, a.shell], ['/x/claude', ['auth', 'login'], { P: 1, CLAUDE_CONFIG_DIR: '/h/a' }, false]);
  const b = L.loginSpec('codex', { cmd: process.execPath, pre: ['/c.js'], shell: false }, '/h/b', { deviceAuth: true, baseEnv: {} });
  assert.deepEqual(b.args, ['/c.js', 'login', '--device-auth']); assert.equal(b.env.CODEX_HOME, '/h/b');
  const w = L.loginSpec('codex', { cmd: 'C:\\Program Files\\n\\codex.cmd', pre: [], shell: true }, 'C:\\Users\\a b\\x', { baseEnv: {} });
  assert.equal(w.cmd, '"C:\\Program Files\\n\\codex.cmd"'); assert.equal(w.shell, true); assert.deepEqual(w.args, ['login']);
});

test('accountLogin: 폴더 만들고 → 로그인 → 확인 → 한 줄, 서버 호출 없음', async () => {
  const cfg = { sdk: { accounts: { claude: { work: path.join(home, 'w') } } } };
  let spec, made; const logs = [];
  const r = await L.accountLogin(cfg, 'claude', 'work', { find: () => ({ cmd: 'c', pre: [], shell: false }), run: async s => (spec = s, 0), mkdir: d => (made = d), exists: f => f.endsWith('.credentials.json'), log: m => logs.push(m), baseEnv: {} });
  assert.equal(r.msg, 'claude 계정 work 로그인됨'); assert.equal(r.code, 0);
  assert.equal(made, path.join(home, 'w')); assert.equal(spec.env.CLAUDE_CONFIG_DIR, made);
});

test('accountLogin: 기본 폴더 · 실패 · CLI 없음 · 확인 실패 · 이름 검사', async () => {
  const base = { find: () => ({ cmd: 'c', pre: [], shell: false }), mkdir() {}, log() {}, baseEnv: {}, quiet: () => 1 };
  let spec;
  const ok = await L.accountLogin({}, 'codex', 'p1', { ...base, run: async s => (spec = s, 0), exists: f => f.endsWith('auth.json') });
  assert.equal(spec.env.CODEX_HOME, path.join(home, 'cfg', 'sdk-accounts', 'codex', 'p1')); assert.equal(ok.code, 0);
  assert.equal((await L.accountLogin({}, 'codex', 'p1', { ...base, run: async () => 2, exists: () => false })).code, 2);
  assert.equal((await L.accountLogin({}, 'codex', 'p1', { ...base, run: async () => 0, exists: () => false })).code, 1);
  assert.equal((await L.accountLogin({}, 'codex', 'p1', { ...base, find: () => null })).code, 1);
  assert.equal((await L.accountLogin({}, 'gemini', 'p1', base)).code, 64);
  assert.equal((await L.accountLogin({}, 'claude', '../x', base)).code, 64);
  for (const bn of ['.', '..', '.x', '-x', '']) assert.equal((await L.accountLogin({}, 'claude', bn, base)).code, 64, bn);
  assert.equal((await L.accountLogin({}, 'claude', 'a.b-c_1', { ...base, run: async () => 0, exists: () => true })).code, 0);
});

test('isLoggedIn: 파일 없으면 상태 명령 종료 코드만, 출력 안 읽음', async () => {
  const cli = { cmd: 'c', pre: [], shell: false }; let spec;
  L._clearStatusCache();
  assert.equal(await L.isLoggedIn('claude', '/f', { exists: () => false, cli, run: async s => (spec = s, 0), baseEnv: {} }), true);
  assert.deepEqual(spec.args, ['auth', 'status']);
  assert.equal(await L.isLoggedIn('codex', '/f', { exists: () => false, cli, run: async () => 1, baseEnv: {} }), false);
  assert.equal(await L.isLoggedIn('codex', '/f', { exists: () => false, cli: null }), false);
});

test('isLoggedIn: 상태 명령 결과는 10초 캐시 · 자격 파일은 캐시 안 해서 로그인 직후 바로 잡힘', async () => {
  const cli = { cmd: 'c', pre: [], shell: false }; let n = 0, t = 1000, has = false;
  L._clearStatusCache();
  const o = { exists: () => has, cli, run: async () => (n++, 1), baseEnv: {}, now: () => t };
  assert.equal(await L.isLoggedIn('claude', '/cache', o), false); assert.equal(await L.isLoggedIn('claude', '/cache', o), false);
  assert.equal(n, 1);                                   // 두 번째는 캐시
  has = true; assert.equal(await L.isLoggedIn('claude', '/cache', o), true); assert.equal(n, 1);   // 파일이 생기면 캐시를 안 보고 바로 true
  has = false; t += L.STATUS_TTL_MS + 1; await L.isLoggedIn('claude', '/cache', o); assert.equal(n, 2);   // 만료 뒤엔 다시 실행
  assert.equal(await L.isLoggedIn('claude', '/other', o), false); assert.equal(n, 3);   // 폴더마다 따로
});

test('isLoggedIn: 기본 실행은 비동기 — 상태 명령이 도는 동안 이벤트 루프가 돎', async () => {
  L._clearStatusCache();
  const cli = { cmd: process.execPath, pre: ['-e', 'setTimeout(()=>process.exit(0),300)'], shell: false };
  let ticks = 0; const iv = setInterval(() => ticks++, 20);
  // statusSpec 이 pre 뒤에 auth status 를 붙이므로 -e 스크립트의 인자로 무시됨
  const ok = await L.isLoggedIn('claude', '/async-probe', { exists: () => false, cli, baseEnv: {} });
  clearInterval(iv); assert.equal(ok, true); assert.ok(ticks >= 5, `ticks ${ticks}`);
});

test('accountList: 공급자별 계정 · 로그인 여부', async () => {
  fs.mkdirSync(path.join(home, 'cfg', 'sdk-accounts', 'codex', 'dir1'), { recursive: true });
  const cfg = { sdk: { accounts: { claude: { a: '/nowhere/a', b: '/nowhere/b' } } } };
  const out = await L.accountList(cfg, { find: () => null, exists: f => f.startsWith('/nowhere/a') });
  assert.match(out[0], /^claude a: logged in/); assert.match(out[1], /^claude b: not logged in/);
  assert.match(out[2], /^codex dir1: not logged in/);
  assert.equal((await L.accountList({}, { find: () => null, exists: () => false })).length >= 1, true);
});

test('isLoggedIn bare: 기본 로그인 확인은 폴더 환경변수 없이 상태 명령을 부름(맥 키체인 대비)', async () => {
  const { isLoggedIn, _clearStatusCache } = await import('./engine/login.mjs');
  _clearStatusCache();
  let seen = null;
  const run = async s => { seen = s; return 0; };
  const cli = { cmd: 'x', pre: [], shell: false };
  assert.equal(await isLoggedIn('claude', path.join(home, 'nofile-a'), { exists: () => false, run, cli, baseEnv: { CLAUDE_CONFIG_DIR: 'zzz' }, bare: true, ttl: 0 }), true);
  assert.equal(seen.env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(await isLoggedIn('claude', path.join(home, 'nofile-b'), { exists: () => false, run, cli, baseEnv: {}, ttl: 0 }), true);
  assert.equal(seen.env.CLAUDE_CONFIG_DIR, path.join(home, 'nofile-b'), '이름 있는 계정은 폴더를 넣음');
});
