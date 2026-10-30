// node --test packages/cli/src/help.test.mjs
// --help · -h 는 어떤 명령에서도 실행 전에 끝나야 한다: 서버에 아무것도 안 보내고 기기에 아무것도 안 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));

async function withServer(fn) {
  const hits = [], ctl = { hold: null };   // ctl.hold: 다음 들여오기 POST 답을 이 약속까지 붙잡음
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', async () => {
      hits.push({ method: req.method, url: req.url, body: b });
      if (ctl.hold && req.url === '/api/import') { const h = ctl.hold; ctl.hold = null; await h; }
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true,"cmds":[],"nodes":0,"states":{},"audit":{"missing":0,"fixed":0,"moved":0},"url":"x"}'); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-help-')), B = path.join(H, 'boarder');
  fs.mkdirSync(B, { mode: 0o700 });
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 't', device_id: 'd', server: `http://127.0.0.1:${srv.address().port}` }));
  const env = { ...process.env, HOME: H, BOARDER_HOME: B, XDG_CONFIG_HOME: path.join(H, 'xdg'), CLAUDE_CONFIG_DIR: path.join(H, 'nope') };
  const cli = args => new Promise(res => {
    const c = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    const t = setTimeout(() => c.kill('SIGKILL'), 8000);
    c.on('close', code => { clearTimeout(t); res({ code, out, err }); });
  });
  try { await fn({ cli, hits, H, B, env, ctl }); } finally { srv.close(); fs.rmSync(H, { recursive: true, force: true }); }
}
const tree = d => fs.readdirSync(d, { recursive: true }).sort();

const COMMANDS = [
  ['setup', '--yes'], ['status'], ['restore'], ['enable', 'report'], ['enable', 'engine'], ['disable', 'report'], ['disable', 'engine'], ['uninstall'],
  ['engine', 'setup'], ['engine', 'stop'], ['engine', 'run'], ['watch'], ['watch', 'install'], ['watch', 'remove'], ['watch', '--once'],
  ['import'], ['import', '--setup'], ['import', '--follow'], ['import', '--stop'],
  ['connect', 'linear'], ['session', 'save'], ['profile', 'add', 'x'], ['profile', 'shims'], ['mcp'], ['headers'], ['hook', 'session-start'],
  ['log', 'progress', 'x'], ['ask', 'q'], ['wait', '1'], ['close', '1', 'x'], ['say', '1', 'x'], ['cards'], ['feedback', 'x'], ['chat', 'x'], ['role', 'list'],
];
for (const flag of ['--help', '-h']) test(`${flag}: 모든 명령이 도움말만 내고 끝남(서버 · 기기 그대로)`, () => withServer(async ({ cli, hits, H }) => {
  const before = tree(H);
  for (const c of COMMANDS) {
    const r = await cli([...c, flag]);
    assert.equal(r.code, 0, `${c.join(' ')} ${flag}: 끝 코드 ${r.code} ${r.err}`);
    assert.match(r.out, /boarder /, `${c.join(' ')} ${flag}: 도움말 없음`);
    assert.deepEqual(hits, [], `${c.join(' ')} ${flag}: 서버로 나감`);
    assert.deepEqual(tree(H), before, `${c.join(' ')} ${flag}: 기기에 씀`);
  }
}));
test('명령 도움말은 그 명령 칸만, help <명령> 도 같음', () => withServer(async ({ cli }) => {
  const a = await cli(['import', '--help']), b = await cli(['help', 'import']), all = await cli(['--help']);
  assert.match(a.out, /boarder import --stop/); assert.equal(a.out, b.out); assert.ok(a.out.length < all.out.length);
}));
test('profile run 뒤의 --help 는 감싼 명령 몫', () => withServer(async ({ cli }) => {
  const r = await cli(['profile', 'run', '--', process.execPath, '-e', 'console.log("real:" + process.argv.slice(1))', '--', '--help']);
  assert.match(r.out, /real:.*--help/);
  const s = await cli(['profile', 'run', '--shim', path.basename(process.execPath), '-e', 'console.log("real:" + process.argv.slice(1))', '--', '-h']);
  assert.match(s.out, /real:.*-h/);
  assert.match((await cli(['profile', 'run', '--help'])).out, /CLI accounts per repo/);
}));
test('「--」 뒤의 -h 도 실행하지 않음', () => withServer(async ({ cli, H }) => {
  const before = tree(H);
  const r = await cli(['uninstall', '--', '-h']);
  assert.equal(r.code, 0); assert.deepEqual(tree(H), before);
}));
for (const sig of ['--help', '-h', 'deadbeef']) test(`engine verify ${sig}: 서명 검사가 뚫리지 않음`, () => withServer(async ({ cli }) => {
  assert.notEqual((await cli(['engine', 'verify', sig])).code, 0);
}));
test('import --stop: 서비스 · 표시를 지우고 빈 목록을 보내 다음 들여오기를 멈춤', () => withServer(async ({ cli, hits, H, B }) => {
  fs.writeFileSync(path.join(B, 'import.json'), '{"at":1,"days":7,"nodes":3}');
  const unit = path.join(H, '.config/systemd/user/boarder-follow.service');
  fs.mkdirSync(path.dirname(unit), { recursive: true }); fs.writeFileSync(unit, '[Service]\n');
  const r = await cli(['import', '--stop']);
  assert.equal(r.code, 0, r.err); assert.equal(hits.length, 1);
  assert.equal(hits[0].url, '/api/import');
  const b = JSON.parse(hits[0].body);
  assert.deepEqual(b.items, []); assert.deepEqual([...b.kinds].sort(), ['session', 'task', 'thread', 'todo', 'window']);
  assert.ok(JSON.parse(fs.readFileSync(path.join(B, 'import.json'), 'utf8')).stopped); assert.ok(!fs.existsSync(unit), '서비스가 남음');
  assert.match(r.out, /reader on this machine is off/);
  hits.length = 0;
  assert.equal((await cli(['watch', '--once'])).code, 0);
  assert.ok(!hits.some(h => h.url === '/api/import'), '감시 타이머가 다시 들여옴');
}));
const stopMark = B => JSON.parse(fs.readFileSync(path.join(B, 'import.json'), 'utf8'));
const imports = hits => hits.filter(h => h.url === '/api/import');
test('import --stop: 올리는 중인 --follow 와 겹쳐도 멈춤이 이김', () => withServer(async ({ cli, hits, B, env, ctl }) => {
  let release; ctl.hold = new Promise(r => { release = r; });
  const f = spawn(process.execPath, [BIN, 'import', '--follow', '--no-gh'], { env, stdio: 'ignore' });
  const ended = new Promise(r => f.on('close', r));
  try {
    for (let i = 0; i < 100 && !imports(hits).length; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(imports(hits).length, 1, '들여오기가 안 나감');
    assert.equal((await cli(['import', '--stop'])).code, 0);
    release();
    assert.equal(await Promise.race([ended, new Promise(r => setTimeout(() => r('still running'), 9000))]), 0);
    assert.ok(stopMark(B).stopped, '돌던 들여오기가 멈춤을 덮어씀');
    assert.equal(imports(hits).length, 3, '멈춘 뒤 빈 목록으로 되돌리지 않음');
    assert.deepEqual(JSON.parse(imports(hits).at(-1).body).items, []);
  } finally { release(); f.kill('SIGKILL'); }
}));
test('멈춘 기기: --follow · 감시는 안 올리고, 손으로 부른 import 가 다시 켬', () => withServer(async ({ cli, hits, B }) => {
  assert.equal((await cli(['import', '--stop'])).code, 0);
  hits.length = 0;
  const r = await cli(['import', '--follow', '--no-gh']);
  assert.equal(r.code, 0); assert.match(r.out, /is stopped/); assert.equal(imports(hits).length, 0);
  assert.equal((await cli(['watch', '--once'])).code, 0); assert.equal(imports(hits).length, 0);
  assert.equal((await cli(['import', '--no-gh'])).code, 0); assert.equal(imports(hits).length, 1);
  assert.ok(!stopMark(B).stopped);
}));
