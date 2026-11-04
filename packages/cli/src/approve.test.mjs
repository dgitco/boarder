// node --test packages/cli/src/approve.test.mjs
// boarder approve: 위험 변경을 일회용 승인 링크로 사람에게 청함. 가짜 서버 · 지어낸 값.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const json = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
async function run(args, create = 200) {
  const hits = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
    hits.push({ url: req.url, method: req.method, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
    if (req.url === '/api/device/approval-actions') return json(res, 200, { actions: { 'device.revoke': 'id=<기기 id>' } });
    if (req.url === '/api/device/approval-link') return create === 200 ? json(res, 200, { ok: true, url: 'https://example.test/a/ap_' + 'a'.repeat(48), summary: '기기 「x」 을 끊어요', expires_in: 600 }) : json(res, create, { error: '내 기기가 아니에요' });
    json(res, 404, {});
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-ap-')), B = path.join(H, 'boarder'); fs.mkdirSync(B, { mode: 0o700 });
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 'bxd_made_up_device', device_id: 'd1', server: `http://127.0.0.1:${srv.address().port}` }));
  try { return await new Promise(res => { const c = spawn(process.execPath, [BIN, ...args], { env: { HOME: H, BOARDER_HOME: B, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d); c.on('close', code => res({ code, out, err, hits })); });
  } finally { srv.closeAllConnections?.(); srv.close(); fs.rmSync(H, { recursive: true, force: true }); }
}
test('approve <행동> k=v: 링크와 하려는 일을 찍음 · 기기 토큰으로 보냄', async () => {
  const r = await run(['approve', 'device.revoke', 'id=abc123']);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /https:\/\/example\.test\/a\/ap_a{48}/); assert.match(r.out, /It will: 기기/);
  assert.equal(r.hits[0].auth, 'Bearer bxd_made_up_device'); assert.deepEqual(r.hits[0].body, { action: 'device.revoke', params: { id: 'abc123' } });
});
test('approve actions: 행동 목록 · 서버가 거절하면 이유를 찍고 실패 · 틀린 꼴은 사용법', async () => {
  assert.match((await run(['approve', 'actions'])).out, /device\.revoke/);
  const bad = await run(['approve', 'device.revoke', 'id=x'], 400); assert.equal(bad.code, 1); assert.match(bad.err, /내 기기가 아니에요/);
  assert.equal((await run(['approve', 'device.revoke', 'nonsense'])).code, 64);
});
