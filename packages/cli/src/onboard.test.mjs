import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const json = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };

// fail = 토큰 받기 첫 번째에 낼 장애: 'drop'(연결 끊김) · 503
async function setupWith(fail) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => {
      const body = b ? JSON.parse(b) : {}; hits.push({ url: req.url, body });
      if (req.url === '/api/device/code') {
        json(res, 200, { device_code: 'd'.repeat(43), user_code: 'ABCD-EFGH', verify_url: `http://127.0.0.1:${srv.address().port}/device?code=ABCD-EFGH`, expires_in: 60, interval: 1, mode: 'local' });
        // 사람이 브라우저에서 「허용」 → 브라우저가 그 기기의 127.0.0.1 콜백으로 grant 를 넘김
        setTimeout(() => http.get(`${body.callback}?state=${encodeURIComponent(body.state)}&code=${'g'.repeat(43)}`, r => r.resume()).on('error', () => {}), 200);
        return;
      }
      if (req.url === '/api/device/token') {
        const n = hits.filter(h => h.url === '/api/device/token').length;
        if (n === 1 && fail === 'drop') return req.socket.destroy();
        if (n === 1 && fail === 503) return json(res, 503, { error: 'busy' });
        return json(res, 200, { state: 'approved', token: 'bxd_made_up', email: 'member@example.test', device_id: 'dev1', server: 'x', scope: 'full' });
      }
      json(res, 404, { error: 'no' });
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-onb-')), B = path.join(H, 'boarder');
  const env = { ...process.env, HOME: H, BOARDER_HOME: B, XDG_CONFIG_HOME: path.join(H, 'xdg'), DISPLAY: ':99', PATH: path.dirname(process.execPath) };   // 화면 있는 기기(로컬 콜백 길) · 브라우저 여는 명령은 없음
  delete env.SSH_CONNECTION; delete env.SSH_TTY; delete env.BOARDER_URL; delete env.BOARDER_TOKEN;
  try {
    return await new Promise(res => {
      const c = spawn(process.execPath, [BIN, 'setup', '--yes', '--only', 'claude', '--no-watch', '--server', `http://127.0.0.1:${srv.address().port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
      const t = setTimeout(() => c.kill('SIGKILL'), 40000);
      c.on('close', code => { clearTimeout(t); res({ code, out, err, hits, device: (() => { try { return JSON.parse(fs.readFileSync(path.join(B, 'device.json'), 'utf8')); } catch { return null; } })() }); });
    });
  } finally { srv.closeAllConnections?.(); srv.close(); fs.rmSync(H, { recursive: true, force: true }); }
}

for (const fail of ['drop', 503]) {
  test(`setup 로그인: 허용 뒤 토큰 받기가 한 번 ${fail === 'drop' ? '끊겨도' : '503 이어도'} 다시 받아 로그인함(승인을 버리지 않음)`, async () => {
    const r = await setupWith(fail);
    const toks = r.hits.filter(h => h.url === '/api/device/token');
    assert.equal(r.code, 0, `setup 이 실패로 끝남 — 토큰 받기 ${toks.length}번\n${r.err}`);
    assert.equal(r.device?.token, 'bxd_made_up');
    assert.match(r.out, /Signed in as member@example\.test/);
    assert.ok(toks.length >= 2 && toks.every(h => h.body.code && h.body.code_verifier), '다시 보낼 때도 grant · verifier 를 같이 보냄');
  });
}

test('setup 로그인: 영구 실패(verifier 400)는 다시 보내지 않고 바로 멈춤', async () => {
  // 위 가짜 서버를 400 으로 — fail 값 대신 직접
  const hits = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => {
      const body = b ? JSON.parse(b) : {}; hits.push({ url: req.url });
      if (req.url === '/api/device/code') {
        json(res, 200, { device_code: 'd'.repeat(43), user_code: 'ABCD-EFGH', verify_url: 'http://127.0.0.1:1/device', expires_in: 60, interval: 1, mode: 'local' });
        setTimeout(() => http.get(`${body.callback}?state=${encodeURIComponent(body.state)}&code=${'g'.repeat(43)}`, r => r.resume()).on('error', () => {}), 200);
        return;
      }
      json(res, 400, { error: 'verifier' });
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-onb-'));
  const env = { ...process.env, HOME: H, BOARDER_HOME: path.join(H, 'b'), DISPLAY: ':99', PATH: path.dirname(process.execPath) };
  delete env.SSH_CONNECTION; delete env.SSH_TTY;
  try {
    const r = await new Promise(res => {
      const c = spawn(process.execPath, [BIN, 'setup', '--yes', '--only', 'claude', '--no-watch', '--server', `http://127.0.0.1:${srv.address().port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = ''; c.stderr.on('data', d => err += d);
      const t = setTimeout(() => c.kill('SIGKILL'), 40000);
      c.on('close', code => { clearTimeout(t); res({ code, err }); });
    });
    assert.notEqual(r.code, 0);
    assert.match(r.err, /verifier/);
    assert.equal(hits.filter(h => h.url === '/api/device/token').length, 1);
  } finally { srv.closeAllConnections?.(); srv.close(); fs.rmSync(H, { recursive: true, force: true }); }
});
