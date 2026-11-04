// node --test packages/cli/src/connect-link.test.mjs
// boarder connect <서비스> --link: 서버가 만든 일회용 링크를 찍고 연결될 때까지 기다림(--no-wait 면 링크만). 가짜 서버 · 지어낸 값.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const json = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
const LINK = 'https://example.test/c/cl_' + 'a'.repeat(48);

async function run(args, { create = 200, final = 'connected' } = {}) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => {
      hits.push({ url: req.url, method: req.method, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
      if (req.url === '/api/device/connect-link' && req.method === 'POST') return create === 200 ? json(res, 200, { ok: true, id: 'abcdef0123456789', url: LINK, service: 'linear', expires_in: 600 }) : json(res, create, { error: create === 401 ? '기기 토큰' : '키로 넣는 서비스예요' });
      if (req.url === '/api/device/connect-link/abcdef0123456789') { const n = hits.filter(h => h.url === req.url).length; return json(res, 200, { state: n < 2 ? 'opened' : final, service: 'linear' }); }
      json(res, 404, {});
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-cl-')), B = path.join(H, 'boarder');
  fs.mkdirSync(B, { mode: 0o700 });
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 'bxd_made_up_device', device_id: 'd1', server: `http://127.0.0.1:${srv.address().port}` }));
  const env = { HOME: H, BOARDER_HOME: B, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
  try {
    return await new Promise(res => {
      const c = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
      const t = setTimeout(() => c.kill('SIGKILL'), 30000);
      c.on('close', code => { clearTimeout(t); res({ code, out, err, hits }); });
    });
  } finally { srv.closeAllConnections?.(); srv.close(); fs.rmSync(H, { recursive: true, force: true }); }
}

test('--link --no-wait: 기기 토큰으로 링크를 만들어 찍고 끝 — 상태 확인 명령도 안내', async () => {
  const r = await run(['connect', 'linear', '--link', '--no-wait', '--label', 'work']);
  assert.equal(r.code, 0, r.err); assert.match(r.out, new RegExp(LINK.replace(/\./g, '\\.'))); assert.match(r.out, /--link-status abcdef0123456789/);
  const p = r.hits[0]; assert.equal(p.auth, 'Bearer bxd_made_up_device'); assert.deepEqual(p.body, { service: 'linear', label: 'work' });
  assert.equal(r.hits.length, 1, '기다리지 않음');
});

test('--link: 링크를 찍고 연결될 때까지 기다려 ✓ — 만료면 끝 코드 75', async () => {
  const ok = await run(['connect', 'linear', '--link']);
  assert.equal(ok.code, 0, ok.err); assert.match(ok.out, /✓ connected linear/);
  const ex = await run(['connect', 'linear', '--link'], { final: 'expired' });
  assert.equal(ex.code, 75); assert.match(ex.err, /expired/);
});

test('--link: 서버가 거절하면(키 서비스 · 401) 이유를 찍고 실패 · MCP 주소는 사용법', async () => {
  const k = await run(['connect', 'channeltalk', '--link'], { create: 422 });
  assert.equal(k.code, 1); assert.match(k.err, /키로 넣는/);
  const u = await run(['connect', 'linear', '--link'], { create: 401 });
  assert.equal(u.code, 3);
  const m = await run(['connect', 'https://mcp.example.test/sse', '--link']);
  assert.equal(m.code, 64);
});

test('--link-status: 상태를 그대로 찍음', async () => {
  const r = await run(['connect', 'linear', '--link-status', 'abcdef0123456789']);
  assert.equal(r.code, 0, r.err); assert.deepEqual(JSON.parse(r.out), { state: 'opened', service: 'linear' });
});
