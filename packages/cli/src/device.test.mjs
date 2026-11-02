// node --test packages/cli/src/device.test.mjs
// 새 기기 허용 CLI(온보딩 2층): setup --email 은 브라우저 콜백 없이 코드 길로 메일을 보내고 다른 곳의 허용을 폴링으로 받음 ·
//   boarder device approve 는 터미널이 아니거나 AI 도구 셸이면 서버에 아무것도 안 보냄. 가짜 서버 · 지어낸 값.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const json = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };

async function run(args, { device, extraEnv = {}, onCode } = {}) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => {
      const body = b ? JSON.parse(b) : {}; hits.push({ url: req.url, body });
      if (req.url === '/api/device/code') return json(res, 200, { device_code: 'd'.repeat(43), user_code: 'ABCD-EFGH', verify_url: 'http://127.0.0.1:1/device?code=ABCD-EFGH', expires_in: 60, interval: 1, mode: body.callback ? 'local' : 'code', board: 'asked' });
      if (req.url === '/api/device/token') { const n = hits.filter(h => h.url === '/api/device/token').length; return json(res, 200, n < 2 ? { state: 'pending' } : { state: 'approved', token: 'bxd_made_up', email: 'member@example.test', device_id: 'dev9', scope: 'full' }); }
      json(res, 404, { error: 'no' });
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-dev-')), B = path.join(H, 'boarder');
  fs.mkdirSync(path.join(H, '.claude')); fs.mkdirSync(B, { mode: 0o700 });
  if (device) fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 'bxd_made_up_existing', device_id: 'd1', server: url }));
  const env = { HOME: H, BOARDER_HOME: B, XDG_CONFIG_HOME: path.join(H, 'xdg'), DISPLAY: ':99', PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, ...extraEnv };
  try {
    return await new Promise(res => {
      const c = spawn(process.execPath, [BIN, ...args.map(a => a === '$URL' ? url : a)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
      const t = setTimeout(() => c.kill('SIGKILL'), 30000);
      c.on('close', code => { clearTimeout(t); res({ code, out, err, hits, dev: (() => { try { return JSON.parse(fs.readFileSync(path.join(B, 'device.json'), 'utf8')); } catch { return null; } })() }); });
    });
  } finally { srv.closeAllConnections?.(); srv.close(); fs.rmSync(H, { recursive: true, force: true }); }
}

test('setup --email: 콜백 없이 메일을 보내고(코드 길) 다른 곳에서 허용되면 폴링으로 로그인', async () => {
  const r = await run(['setup', '--yes', '--only', 'claude', '--no-watch', '--email', 'member@example.test', '--server', '$URL']);
  assert.equal(r.code, 0, r.err);
  const c = r.hits.find(h => h.url === '/api/device/code').body;
  assert.equal(c.email, 'member@example.test'); assert.equal(c.callback, undefined, '브라우저 콜백 길이 아님');
  assert.match(r.out, /boarder device approve ABCD-EFGH/); assert.match(r.out, /on your board/);
  assert.equal(r.dev?.token, 'bxd_made_up');
});

test('device approve: 터미널이 아니면(에이전트 셸) 서버에 아무것도 안 보내고 77', async () => {
  const r = await run(['device', 'approve', 'ABCD-EFGH'], { device: true });
  assert.equal(r.code, 77); assert.match(r.err, /a person has to run this in a terminal/);
  assert.equal(r.hits.length, 0);
});

test('device approve: 코드 꼴이 아니면 64 · 로그인 안 한 기기면 3', async () => {
  assert.equal((await run(['device', 'approve', 'nope'], { device: true })).code, 64);
  assert.equal((await run(['device', 'approve', 'ABCD-EFGH'])).code, 3);
});
