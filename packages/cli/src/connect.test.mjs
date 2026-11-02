// node --test packages/cli/src/connect.test.mjs
// boarder connect <이름> --key-file(온보딩 3층): 기기 토큰으로 보내고 보드 허용을 기다림 · 키는 출력 어디에도 없음 · 읽기 전용이 기본. 가짜 서버 · 지어낸 값.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const KEY = 'xoxb-made-up-0000-not-a-real-bot-token';
const json = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };

async function run(args, answer) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => {
      hits.push({ url: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
      if (req.url === '/api/device/connect') return answer === 401 ? json(res, 401, { error: '기기 토큰' }) : answer === 400 ? json(res, 400, { error: '서비스 이름' }) : json(res, 200, { id: 'cr_1', state: 'pending', card_id: 'c1', name: 'slack-team' });
      if (req.url === '/api/device/connect/cr_1') { const n = hits.filter(h => h.url === req.url).length; return json(res, 200, { state: n < 2 ? 'pending' : answer, read_only: 1 }); }
      json(res, 404, {});
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-con-')), B = path.join(H, 'boarder');
  fs.mkdirSync(B, { mode: 0o700 });
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 'bxd_made_up_device', device_id: 'd1', server: `http://127.0.0.1:${srv.address().port}` }));
  fs.writeFileSync(path.join(H, 'key.txt'), KEY + '\n', { mode: 0o600 });
  const env = { HOME: H, BOARDER_HOME: B, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
  try {
    return await new Promise(res => {
      const c = spawn(process.execPath, [BIN, ...args.map(a => a === '$KEY' ? path.join(H, 'key.txt') : a)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
      const t = setTimeout(() => c.kill('SIGKILL'), 30000);
      c.on('close', code => { clearTimeout(t); res({ code, out, err, hits }); });
    });
  } finally { srv.closeAllConnections?.(); srv.close(); fs.rmSync(H, { recursive: true, force: true }); }
}

test('--key-file: 기기 토큰으로 보내고(읽기 전용 기본) 보드 허용을 기다려 연결됨 — 키는 출력에 없음', async () => {
  const r = await run(['connect', 'slack-team', '--key-file', '$KEY', '--base-url', 'https://slack.com/api'], 'approved');
  assert.equal(r.code, 0, r.err);
  const p = r.hits.find(h => h.url === '/api/device/connect');
  assert.equal(p.auth, 'Bearer bxd_made_up_device');
  assert.deepEqual(p.body, { service: 'slack-team', api: { base_url: 'https://slack.com/api', auth: { type: 'bearer' } }, key: KEY, read_only: true });
  assert.match(r.out, /A card is on your board/); assert.match(r.out, /✓ connected slack-team \(read only\)/);
  assert.ok(!(r.out + r.err).includes(KEY));
});

test('--base-url 없으면 보더가 아는 API(preset) · --write 면 쓰기 · 거절되면 1', async () => {
  const r = await run(['connect', 'imap', '--key-file', '$KEY', '--write'], 'denied');
  assert.equal(r.code, 1); assert.match(r.err, /declined on the board/);
  const p = r.hits.find(h => h.url === '/api/device/connect').body;
  assert.deepEqual(p.api, { preset: 'imap' }); assert.equal(p.read_only, false);
  assert.ok(!(r.out + r.err).includes(KEY));
});

test('서버가 거절(401 · 400)해도 키는 출력에 없음', async () => {
  const a = await run(['connect', 'slack-team', '--key-file', '$KEY', '--base-url', 'https://slack.com/api'], 401);
  assert.equal(a.code, 3); assert.ok(!(a.out + a.err).includes(KEY));
  const b = await run(['connect', 'slack-team', '--key-file', '$KEY', '--base-url', 'https://slack.com/api'], 400);
  assert.equal(b.code, 1); assert.match(b.err, /not sent: 서비스 이름/); assert.ok(!(b.out + b.err).includes(KEY));
});
