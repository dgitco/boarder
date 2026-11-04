import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const TOKEN = 'bxd_' + 'y'.repeat(40);
const overlays = [];
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d);
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.statusCode = 401; return res.end('{}'); }
    if (req.url === '/api/device/overlay' && req.method === 'POST') { overlays.push(JSON.parse(body)); return res.end('{"ok":true}'); }
    if (req.url === '/api/device/overlay') return res.end(JSON.stringify({ ok: true, cssBytes: 3, jsBytes: 0, wrapper: { css: 1, js: 0, jsSha: null, side: false } }));
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
after(() => srv.close());

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-ovscope-'));
process.on('exit', () => fs.rmSync(T, { recursive: true, force: true }));
const H = path.join(T, 'home'), B = path.join(H, '.config', 'boarder');
fs.mkdirSync(B, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: TOKEN, device_id: 'd', email: 'tester@example.com', server: `http://127.0.0.1:${srv.address().port}` }));
const CLAUDE_MD = path.join(H, '.claude', 'CLAUDE.md');
fs.mkdirSync(path.join(H, '.claude'), { recursive: true }); fs.mkdirSync(path.join(H, '.codex'), { recursive: true });
const env = { ...process.env, HOME: H, BOARDER_HOME: B, XDG_CONFIG_HOME: path.join(H, '.config'), CODEX_HOME: path.join(H, '.codex'), PATH: '/usr/bin:/bin' };
delete env.XDG_DATA_HOME; delete env.CLAUDE_CONFIG_DIR; delete env.BOARDER_CLAUDE_DIRS;
const cli = args => new Promise(res => {
  const c = spawn(process.execPath, [BIN, ...args], { env, cwd: H, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
  const t = setTimeout(() => c.kill('SIGKILL'), 60000);
  c.on('close', code => { clearTimeout(t); res({ code, out, err }); });
});
const read = f => fs.readFileSync(f, 'utf8');
// 이 프로세스 안에서 모듈을 직접 부르는 시험은 환경을 잠깐 가짜 HOME 으로(진짜 설정 폴더에 상태 파일을 안 남기게)
const keys = ['HOME', 'BOARDER_HOME', 'XDG_CONFIG_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'BOARDER_CLAUDE_DIRS'];
async function inFixtureEnv(fn) {
  const keep = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { HOME: H, BOARDER_HOME: B, XDG_CONFIG_HOME: path.join(H, '.config'), CODEX_HOME: path.join(H, '.codex') }); delete process.env.CLAUDE_CONFIG_DIR; delete process.env.BOARDER_CLAUDE_DIRS;
  try { return await fn(await import('./rules-block.mjs')); } finally { for (const [k, v] of Object.entries(keep)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

test('view overlay: css · js 올리기 · 보기 · 끄기는 내 칸(mine)으로', async () => {
  const f = path.join(H, 'a.css'); fs.writeFileSync(f, 'a{}');
  assert.equal((await cli(['view', 'overlay', 'css', f])).code, 0);
  assert.deepEqual(overlays.at(-1), { slot: 'mine', set: { css: 'a{}' } });
  const s = await cli(['view', 'overlay', 'show']); assert.match(s.out, /yours:\s+css 3 bytes/);
  assert.equal((await cli(['view', 'overlay', 'off'])).code, 0);
  assert.deepEqual(overlays.at(-1), { slot: 'mine', set: { css: null, js: null } });
  const big = path.join(H, 'big.js'); fs.writeFileSync(big, 'x'.repeat(200_001));
  assert.notEqual((await cli(['view', 'overlay', 'js', big])).code, 0);
});

test('표시 짝이 안 맞으면 쓰지 않고 멈춤 — END 줄을 지웠을 때 사용자 글이 안 지워짐', () => inFixtureEnv(m => {
  fs.writeFileSync(CLAUDE_MD, '# 내 글\n');
  assert.equal(m.putBlock(CLAUDE_MD, '규칙\n'), 'added');
  const broken = read(CLAUDE_MD).replace(m.END + '\n', '') + '내 글 B\n';   // END 삭제 + 뒤에 사용자 글
  fs.writeFileSync(CLAUDE_MD, broken);
  assert.throws(() => m.putBlock(CLAUDE_MD, '새 규칙\n'), /without its partner/);
  assert.equal(read(CLAUDE_MD), broken, '멈춤 — 파일 그대로');
  const d = m.dropBlock(CLAUDE_MD);
  assert.deepEqual([d.removed, d.leftover], [0, true]);
  assert.match(read(CLAUDE_MD), /내 글 B/, '끈 뒤에도 사용자 글 B 가 남음');
  fs.rmSync(CLAUDE_MD, { force: true }); m.dropBlock(CLAUDE_MD);
}));

test('BEGIN 줄을 지웠을 때: 온전한 짝만 빼고, 홀로 남은 표시는 그대로 두며 알림', () => inFixtureEnv(m => {
  fs.writeFileSync(CLAUDE_MD, '앞\n' + `${m.BEGIN}\n짝 없는 규칙\n${m.END}\n` + '뒤\n');
  assert.equal(m.findPairs(read(CLAUDE_MD)).pairs.length, 1);
  fs.writeFileSync(CLAUDE_MD, '앞\n짝 없는 규칙\n' + m.END + '\n뒤\n');
  assert.equal(m.findPairs(read(CLAUDE_MD)).broken, true);
  const d = m.dropBlock(CLAUDE_MD);
  assert.deepEqual([d.removed, d.leftover], [0, true]);
  assert.match(read(CLAUDE_MD), /앞\n짝 없는 규칙\n/, '글은 그대로');
  fs.rmSync(CLAUDE_MD, { force: true });
}));

test('상태 파일이 없어도 기존 짝을 바꿈(구역이 둘이 되지 않음) · 겹친 짝은 모두 빠짐', () => inFixtureEnv(m => {
  fs.writeFileSync(CLAUDE_MD, `# 내 글\n\n${m.BEGIN}\n옛 규칙\n${m.END}\n중간 글\n${m.BEGIN}\n또 옛 규칙\n${m.END}\n`);
  fs.rmSync(path.join(B, 'rules-block.json'), { force: true });
  assert.equal(m.putBlock(CLAUDE_MD, '새 규칙\n'), 'updated');
  const t = read(CLAUDE_MD);
  assert.equal(t.split(m.BEGIN).length - 1, 1, '구역은 하나'); assert.match(t, /새 규칙/); assert.doesNotMatch(t, /옛 규칙/); assert.match(t, /중간 글/);
  assert.equal(m.dropBlock(CLAUDE_MD).removed, 1);
  assert.doesNotMatch(read(CLAUDE_MD), /boarder:rules|새 규칙/); assert.match(read(CLAUDE_MD), /내 글[\s\S]*중간 글/);
  fs.rmSync(CLAUDE_MD, { force: true }); fs.rmSync(path.join(B, 'rules-block.json'), { force: true });
}));

test('원래 바이트로 돌아옴: 줄바꿈 없이 끝나는 파일에 넣었다 빼도 그대로, 우리가 만든 파일은 비면 지워짐', () => inFixtureEnv(m => {
  const mine = '# 내 글\n한 글자도 바뀌면 안 됨';
  fs.writeFileSync(CLAUDE_MD, mine);
  m.putBlock(CLAUDE_MD, '규칙\n'); assert.ok(read(CLAUDE_MD).startsWith(mine));
  assert.equal(m.dropBlock(CLAUDE_MD).removed, 1); assert.equal(read(CLAUDE_MD), mine);
  fs.rmSync(CLAUDE_MD, { force: true });
  assert.equal(m.putBlock(CLAUDE_MD, '규칙\n'), 'created'); m.dropBlock(CLAUDE_MD);
  assert.ok(!fs.existsSync(CLAUDE_MD)); assert.ok(!fs.existsSync(path.join(B, 'rules-block.json')), '상태 파일도 안 남음');
}));

test('disable harness: 경고(! …)는 지운 파일 목록과 따로 찍힘', async () => {
  const BEGIN = (await import('./rules-block.mjs')).BEGIN;
  fs.writeFileSync(CLAUDE_MD, `앞\n${BEGIN}\n끝 표시 없는 규칙\n`);   // 짝이 깨진 파일
  const r = await cli(['disable', 'harness']);
  const lines = r.out.split('\n');
  assert.ok(lines.some(l => /^! .*unmatched boarder:rules marker/.test(l)), r.out);
  assert.ok(!lines.some(l => /^removed !/.test(l)), '경고가 지운 파일 이름처럼 안 섞임');
  assert.match(read(CLAUDE_MD), /끝 표시 없는 규칙/, '글은 그대로');
  fs.rmSync(CLAUDE_MD, { force: true });
});
