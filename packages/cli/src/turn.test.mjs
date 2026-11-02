import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-turn-'));
process.env.BOARDER_HOME = path.join(TMP, 'boarder');
const T = await import('./turn.mjs');

const SID = '11111111-2222-3333-4444-555555555555';
const line = o => JSON.stringify(o);
// Claude Code 기록 꼴: 사람 입력 → 도구 호출 · 결과 → 같은 message.id 로 나뉜 마지막 답
function transcript(prompt, reply, at = new Date().toISOString()) {
  return [
    line({ type: 'user', message: { role: 'user', content: '앞 턴 글' }, timestamp: '2026-11-02T01:00:00.000Z' }),
    line({ type: 'assistant', message: { id: 'm0', role: 'assistant', content: [{ type: 'text', text: '앞 턴 답' }] } }),
    line({ type: 'user', message: { role: 'user', content: prompt }, timestamp: at }),
    line({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: '보는 중' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }, timestamp: at }),
    line({ type: 'assistant', message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: reply }] } }),
    line({ type: 'assistant', message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '— 끝' }] } }),
  ].join('\n') + '\n';
}

test('lastTurn: 그 턴을 연 사람 입력(도구 결과 줄은 입력 아님) · 마지막 답(같은 message.id 블록을 이음)', () => {
  const t = T.lastTurn(transcript('이슈 만들고 넘겨 줘', '이슈를 만들고 넘겼어요'));
  assert.equal(t.prompt, '이슈 만들고 넘겨 줘');
  assert.equal(t.reply, '이슈를 만들고 넘겼어요\n— 끝');
});

test('보드가 넣은 글로 연 턴만 답을 냄 — 표지는 한 번만 쓰이고, 사람이 친 턴 · 다른 창은 null', () => {
  T.markTurn(['ew_abc123', SID], '이슈 만들고\n  넘겨 줘');   // Herdr 처럼 줄바꿈이 빈칸으로 바뀌어 남아도 같은 글
  assert.equal(T.replyFor({ keys: ['ew_other', 'sid-other'], prompt: '이슈 만들고 넘겨 줘', at: Date.now(), reply: '답' }), null, '다른 창');
  assert.equal(T.replyFor({ keys: [null, SID], prompt: '사람이 터미널에 친 글', at: Date.now() + 10 * 60_000, reply: '답' }), null, '사람이 친 턴');
  assert.equal(T.replyFor({ keys: [null, SID], prompt: '이슈 만들고 넘겨 줘', at: Date.now(), reply: '했어요' }), '했어요');
  assert.equal(T.replyFor({ keys: ['ew_abc123', SID], prompt: '이슈 만들고 넘겨 줘', at: Date.now(), reply: '또' }), null, '같은 표지로 두 번 올리지 않음');
});

test('답의 비밀값은 가리고 3000자에서 자름', () => {
  T.markTurn(['ew_sec001'], '키 확인');
  const key = 'sk-ant-' + 'A'.repeat(40);
  const out = T.replyFor({ keys: ['ew_sec001'], prompt: '키 확인', at: Date.now(), reply: `키는 ${key} 이고 ` + '가'.repeat(5000) });
  assert.ok(!out.includes(key) && out.includes('[secret]'));
  assert.ok(out.length <= T.REPLY_MAX && out.endsWith('…(줄였어요)'));
});

// ── 끝에서 끝: boarder hook stop(가짜 서버)
async function hookWorld(fn) {
  const posts = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/device/window') return res.end(JSON.stringify({ token: 'bxa_' + 'w'.repeat(40) }));
      if (req.url === '/api/agent/inbox_log') { posts.push({ auth: req.headers.authorization, body: JSON.parse(b) }); return res.end('{"ok":true}'); }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const B = process.env.BOARDER_HOME; fs.mkdirSync(B, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 'bxd_made_up', device_id: 'd1', server: `http://127.0.0.1:${srv.address().port}` }));
  const env = { HOME: TMP, BOARDER_HOME: B, BOARDER_WINDOW: 'ew_team01', BOARDER_WINDOW_NAME: '팀장', PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
  const hook = (args, stdin) => new Promise(res => { const c = spawn(process.execPath, [BIN, 'hook', ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d); c.on('close', code => res({ code, out, err })); c.stdin.end(stdin || ''); });
  try { await fn({ hook, posts }); } finally { srv.close(); }
}

test('hook stop: 보드가 넣은 글로 연 턴 → 그 창 토큰으로 inbox_log reply 한 번, 출력 없음', async () => {
  await hookWorld(async ({ hook, posts }) => {
    T.markTurn(['ew_team01', SID], '팀장, 오늘 할 일 정리해 줘');
    const f = path.join(TMP, 's1.jsonl'); fs.writeFileSync(f, transcript('팀장, 오늘 할 일 정리해 줘', '세 가지예요: 하나, 둘, 셋'));
    const r = await hook(['stop'], JSON.stringify({ session_id: SID, transcript_path: f, hook_event_name: 'Stop', stop_hook_active: false }));
    assert.equal(r.code, 0, r.err); assert.equal(r.out, '');
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body, { kind: 'reply', text: '세 가지예요: 하나, 둘, 셋\n— 끝' });
    assert.equal(posts[0].auth, 'Bearer bxa_' + 'w'.repeat(40));
  });
});

test('hook stop: 사람이 터미널에 친 턴 · 깨진 입력이면 아무것도 안 올리고 조용히 0', async () => {
  await hookWorld(async ({ hook, posts }) => {
    const f = path.join(TMP, 's2.jsonl'); fs.writeFileSync(f, transcript('터미널에서 직접 친 글', '답', new Date(Date.now() + 3600_000).toISOString()));
    const a = await hook(['stop'], JSON.stringify({ session_id: SID, transcript_path: f }));
    const b = await hook(['stop'], 'not json');
    const c = await hook(['codex-turn', '{"type":"agent-turn-complete","thread-id":"th1","input-messages":["사람 글"],"last-assistant-message":"답"}']);
    for (const r of [a, b, c]) { assert.equal(r.code, 0, r.err); assert.equal(r.out, ''); }
    assert.equal(posts.length, 0);
  });
});

test('hook codex-turn: 보드가 넣은 글로 연 Codex 턴 → 마지막 답을 reply 로', async () => {
  await hookWorld(async ({ hook, posts }) => {
    T.markTurn([null, 'th-codex-1'], '배포 확인해 줘');
    const r = await hook(['codex-turn', JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'th-codex-1', 'turn-id': '1', 'input-messages': ['배포 확인해 줘'], 'last-assistant-message': '배포는 초록이에요' })]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(posts.map(p => p.body), [{ kind: 'reply', text: '배포는 초록이에요' }]);
  });
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('hook stop: 서버가 답하지 않는(매달린) 망에서도 훅 한도(setup 의 Stop 초) 안에 끝남', async () => {
  const src = fs.readFileSync(fileURLToPath(new URL('./setup.mjs', import.meta.url)), 'utf8');
  const limit = Number(/\['Stop', 'hook stop', (\d+)\]/.exec(src)[1]);
  const srv = http.createServer(() => { /* 답하지 않음 */ });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const B = path.join(TMP, 'hung'); fs.mkdirSync(B, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 'bxd_made_up', device_id: 'd1', server: `http://127.0.0.1:${srv.address().port}` }));
  process.env.BOARDER_HOME = B; T.markTurn(['ew_hung01'], '느린 망 글'); process.env.BOARDER_HOME = path.join(TMP, 'boarder');
  const f = path.join(TMP, 's3.jsonl'); fs.writeFileSync(f, transcript('느린 망 글', '답'));
  const t0 = Date.now();
  const r = await new Promise(res => { const c = spawn(process.execPath, [BIN, 'hook', 'stop'], { env: { HOME: TMP, BOARDER_HOME: B, BOARDER_WINDOW: 'ew_hung01', PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` }, stdio: ['pipe', 'pipe', 'pipe'] }); let out = ''; c.stdout.on('data', d => out += d); c.on('close', code => res({ code, out })); c.stdin.end(JSON.stringify({ session_id: 'sid-hung', transcript_path: f })); });
  srv.closeAllConnections(); srv.close();
  assert.equal(r.code, 0); assert.equal(r.out, '');
  assert.ok(Date.now() - t0 < limit * 1000, `took ${Date.now() - t0}ms, limit ${limit}s`);
});
