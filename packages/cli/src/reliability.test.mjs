import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));

async function withServer(handler, fn) {
  const hits = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { hits.push({ method: req.method, url: req.url, body: b }); handler(req, res, hits); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-rel-')), B = path.join(H, 'boarder');
  fs.mkdirSync(B, { mode: 0o700 });
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 't', device_id: 'd', server: `http://127.0.0.1:${srv.address().port}` }));
  const env = { ...process.env, HOME: H, BOARDER_HOME: B, BOARDER_WINDOW: 'rel-test', XDG_CONFIG_HOME: path.join(H, 'xdg'), CLAUDE_CONFIG_DIR: path.join(H, 'nope') };
  delete env.BOARDER_TOKEN; delete env.BOARDER_CHANNEL;
  const cli = (args, killAfter = 30000) => new Promise(res => {
    const t0 = Date.now(), c = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    const t = setTimeout(() => c.kill('SIGKILL'), killAfter);
    c.on('close', (code, sig) => { clearTimeout(t); res({ code, sig, out, err, ms: Date.now() - t0 }); });
  });
  try { await fn({ cli, hits, H, B }); } finally { srv.closeAllConnections?.(); srv.close(); fs.rmSync(H, { recursive: true, force: true }); }
}

// setup 이 Claude Code settings.json 에 넣는 시작 훅의 시간 한도(초) — Claude Code 는 이 시간이 지나면 훅을 죽이고 그 출력을 버림
function hookTimeoutS() {
  const src = fs.readFileSync(fileURLToPath(new URL('./setup.mjs', import.meta.url)), 'utf8');
  const m = /command: hook, timeout: (\d+)/.exec(src); assert.ok(m, 'hook timeout in setup.mjs'); return Number(m[1]);
}

test('시작 훅: 서버가 답하지 않는(매달린) 망에서도 훅 시간 한도 안에 안내 한 줄을 내고 끝남', async () => {
  const limit = hookTimeoutS();
  await withServer(() => { /* 답하지 않음 — 끊긴 줄 모르는 망(캡티브 포털 · 죽은 경로) */ }, async ({ cli }) => {
    const r = await cli(['hook', 'session-start'], (limit + 15) * 1000);
    assert.ok(r.ms < limit * 1000, `hook took ${r.ms}ms, Claude Code kills it at ${limit}s`);
    const j = JSON.parse(r.out);
    assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(j.hookSpecificOutput.additionalContext, /^Boarder:/);
  });
});

test('시작 훅: 서버가 답하면 창 토큰을 받아 두고 보고 안내를 냄', async () => {
  await withServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ token: 'wtok' })); }, async ({ cli, B }) => {
    const r = await cli(['hook', 'session-start']);
    assert.equal(r.code, 0);
    assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /boarder log start/);
    const saved = fs.readdirSync(path.join(B, 'windows')).map(f => JSON.parse(fs.readFileSync(path.join(B, 'windows', f), 'utf8')));
    assert.deepEqual(saved.map(w => w.token), ['wtok']);
  });
});

const json = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };

test('wait: 없는 카드(404) 같은 영구 실패는 시간 한도까지 되풀이하지 않고 바로 실패', async () => {
  await withServer((req, res) => {
    if (req.url === '/api/device/window') return json(res, 200, { token: 'w' });
    json(res, 404, { error: 'no such card' });
  }, async ({ cli, hits }) => {
    const r = await cli(['wait', 'c_nope', '--timeout', '120'], 25000);
    assert.notEqual(r.sig, 'SIGKILL', `wait kept retrying a 404 (${hits.filter(h => h.url === '/api/agent/inbox_wait').length} tries in ${r.ms}ms)`);
    assert.equal(r.code, 1);
    assert.match(r.err, /no such card/);
    assert.equal(hits.filter(h => h.url === '/api/agent/inbox_wait').length, 1);
  });
});

test('wait: 잠깐 끊김(503)은 다시 시도해 답을 받음', async () => {
  let n = 0;
  await withServer((req, res) => {
    if (req.url === '/api/device/window') return json(res, 200, { token: 'w' });
    if (n++ === 0) return json(res, 503, { error: 'busy' });
    json(res, 200, { state: 'answered', answer: 'A' });
  }, async ({ cli }) => {
    const r = await cli(['wait', 'c_1', '--timeout', '120'], 25000);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).state, 'answered');
  });
});
