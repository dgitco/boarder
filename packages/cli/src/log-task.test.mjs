import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
async function run(args) {
  const hits = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
    hits.push({ url: req.url, body: b ? JSON.parse(b) : null });
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true }));
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-lt-')), B = path.join(H, 'boarder'); fs.mkdirSync(B, { mode: 0o700 });
  try { return await new Promise(res => { const c = spawn(process.execPath, [BIN, ...args], { env: { HOME: H, BOARDER_HOME: B, BOARDER_URL: `http://127.0.0.1:${srv.address().port}`, BOARDER_TOKEN: 'bxa_made_up_window_token_0123456789abcdef', BOARDER_WINDOW: 'test:%1', PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d); c.on('close', code => res({ code, out, err, hits })); });
  } finally { srv.closeAllConnections?.(); srv.close(); fs.rmSync(H, { recursive: true, force: true }); }
}
const sent = r => r.hits.filter(h => h.url.startsWith('/api/agent/')).map(h => [h.url, h.body]);

test('log 옛 꼴: --task 없으면 kind · text 만(옛 서버도 그대로 받음)', async () => {
  const r = await run(['log', 'progress', '진행 한 줄']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(sent(r), [['/api/agent/inbox_log', { kind: 'progress', text: '진행 한 줄' }]]);
});
test('log --task · --wait-for · 한국어 종류 이름(기다림) → task · wait_cond 칸, device 는 안 보냄', async () => {
  const r = await run(['log', '기다림', '리뷰 기다림', '--task', '#4321', '--wait-for', 'PR 리뷰 판정']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(sent(r), [['/api/agent/inbox_log', { kind: 'waiting', text: '리뷰 기다림', task: '#4321', wait_cond: 'PR 리뷰 판정' }]]);
});
test('status 글 + --kind · --task → inbox_status 칸, 글만 주면 옛 꼴', async () => {
  const a = await run(['status', '게이트 기다림', '--kind', 'waiting', '--task', '#4321', '--wait-for', '게이트 결과']);
  assert.equal(a.code, 0, a.err);
  assert.deepEqual(sent(a), [['/api/agent/inbox_status', { text: '게이트 기다림', kind: 'waiting', task: '#4321', wait_cond: '게이트 결과' }]]);
  const b = await run(['status', '일하는 중']);
  assert.deepEqual(sent(b), [['/api/agent/inbox_status', { text: '일하는 중' }]]);
});
