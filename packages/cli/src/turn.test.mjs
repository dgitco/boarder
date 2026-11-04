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
      if (/^\/api\/agent\/(inbox_log|inbox_say|chat_say)$/.test(req.url)) { posts.push({ tool: req.url.slice(11), auth: req.headers.authorization, body: JSON.parse(b) }); return res.end('{"ok":true}'); }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const B = process.env.BOARDER_HOME; fs.mkdirSync(B, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 'bxd_made_up', device_id: 'd1', server: `http://127.0.0.1:${srv.address().port}` }));
  const env = { HOME: TMP, BOARDER_HOME: B, BOARDER_WINDOW: 'ew_team01', BOARDER_WINDOW_NAME: '팀장', PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
  const cli = (args, stdin) => new Promise(res => { const c = spawn(process.execPath, [BIN, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d); c.on('close', code => res({ code, out, err })); c.stdin.end(stdin || ''); });
  const hook = (args, stdin) => cli(['hook', ...args], stdin);
  try { await fn({ hook, cli, posts }); } finally { srv.close(); }
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

test('parseHead · replyCall: Primary → chat_say · 카드 → inbox_say 카드 · 노드 스레드 → inbox_say 스레드 · 노드 채널 · 머리 줄 없음 → inbox_log reply', () => {
  assert.deepEqual(T.parseHead('[보드 · Primary] [Boarder chat] 안녕'), { primary: true });
  assert.deepEqual(T.parseHead('[보드 · 예시 팀장 · 스레드 1793000000.000123] 다시 봐 줘'), { channel: '예시 팀장', thread: '1793000000.000123' });
  assert.deepEqual(T.parseHead('[보드 · 예시 팀장 · 카드 1793000000.000001] [Boarder] The person replied'), { channel: '예시 팀장', card: '1793000000.000001' });
  assert.deepEqual(T.parseHead('[보드 · 예시 팀장] 오늘 할 일?'), { channel: '예시 팀장' });
  assert.equal(T.parseHead('그냥 친 글 [보드 · Primary]'), null, '맨 앞만');
  assert.deepEqual(T.replyCall('[보드 · Primary] [Boarder chat] 안녕', '- 반가워요'), ['chat_say', { text: '‐ 반가워요' }]);
  assert.deepEqual(T.replyCall('[보드 · 예시 팀장 · 스레드 1793000000.000123] 다시', '봤어요'), ['inbox_say', { thread_id: '1793000000.000123', text: '봤어요' }]);
  assert.deepEqual(T.replyCall('[보드 · 예시 팀장 · 카드 1793000000.000001] x', '했어요'), ['inbox_say', { thread_id: '1793000000.000001', text: '했어요' }]);
  assert.deepEqual(T.replyCall('[보드 · 예시 팀장] 오늘?', '- 셋'), ['inbox_log', { kind: 'reply', text: '- 셋' }]);
  assert.deepEqual(T.replyCall('머리 줄 없는 글', '답'), ['inbox_log', { kind: 'reply', text: '답' }]);
});

test('parseHead · replyCall: Primary · 스레드 <id> → chat_say { text, thread } · Primary 카드는 예전처럼 inbox_say 카드', () => {
  assert.deepEqual(T.parseHead('[보드 · Primary · 스레드 1793000000.000042] [Boarder chat] 이거 봐 줘'), { primary: true, thread: '1793000000.000042' });
  assert.deepEqual(T.replyCall('[보드 · Primary · 스레드 1793000000.000042] [Boarder chat] 이거 봐 줘', '- 봤어요'), ['chat_say', { text: '‐ 봤어요', thread: '1793000000.000042' }]);
  assert.deepEqual(T.replyCall('[보드 · Primary · 카드 1793000000.000001] [Boarder] x', '했어요'), ['inbox_say', { thread_id: '1793000000.000001', text: '했어요' }]);
});

test('hook stop: 머리 줄을 보고 같은 자리로 — 노드 스레드 → inbox_say, Primary → chat_say, 창이 그 턴에 스스로 boarder chat 했으면 안 올림', async () => {
  await hookWorld(async ({ hook, posts }) => {
    const p1 = '[보드 · 예시 팀장 · 스레드 1793000000.000123] 이거 다시 봐 줘';
    T.markTurn(['ew_team01', SID], p1);
    const f1 = path.join(TMP, 'h1.jsonl'); fs.writeFileSync(f1, transcript(p1, '다시 봤어요'));
    assert.equal((await hook(['stop'], JSON.stringify({ session_id: SID, transcript_path: f1 }))).code, 0);
    const p2 = '[보드 · Primary] [Boarder chat] 오늘 뭐 했어?';
    T.markTurn(['ew_team01', SID], p2);
    const f2 = path.join(TMP, 'h2.jsonl'); fs.writeFileSync(f2, transcript(p2, '세 가지 했어요'));
    assert.equal((await hook(['stop'], JSON.stringify({ session_id: SID, transcript_path: f2 }))).code, 0);
    assert.deepEqual(posts.map(p => [p.tool, p.body]), [
      ['inbox_say', { thread_id: '1793000000.000123', text: '다시 봤어요\n— 끝' }],
      ['chat_say', { text: '세 가지 했어요\n— 끝' }],
    ]);
    // 창이 그 턴에 boarder chat 으로 이미 답함 → 훅은 또 올리지 않음(두 번 안 보이게)
    const p3 = '[보드 · Primary] [Boarder chat] 또 물어볼게';
    T.markTurn(['ew_team01', SID], p3);
    const f3 = path.join(TMP, 'h3.jsonl');
    fs.writeFileSync(f3, transcript(p3, '답했어요').replace('"name":"Bash","input":{}', '"name":"Bash","input":{"command":"boarder chat \\"네, 말씀하세요\\""}'));
    assert.equal((await hook(['stop'], JSON.stringify({ session_id: SID, transcript_path: f3 }))).code, 0);
    assert.equal(posts.length, 2);
  });
});

test('hook codex-turn: 카드 머리 줄로 연 턴 → 그 카드 스레드(inbox_say)', async () => {
  await hookWorld(async ({ hook, posts }) => {
    const p = '[보드 · 예시 팀장 · 카드 1793000000.000001] [Boarder] The person replied in the thread of your card';
    T.markTurn([null, 'th-codex-2'], p);
    assert.equal((await hook(['codex-turn', JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'th-codex-2', 'input-messages': [p], 'last-assistant-message': '고쳤어요' })])).code, 0);
    assert.deepEqual(posts.map(x => [x.tool, x.body]), [['inbox_say', { thread_id: '1793000000.000001', text: '고쳤어요' }]]);
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

test('lastTurnOfFile: 큰 기록도 끝부분만 읽어 마지막 턴을 찾음 — 앞부분이 아무리 커도 같은 답', () => {
  const f = path.join(TMP, 'big.jsonl');
  const filler = line({ type: 'assistant', message: { id: 'old', role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(4000) }] } }) + '\n';
  fs.writeFileSync(f, filler.repeat(3000) + transcript('끝 턴 글', '끝 턴 답'));   // 앞에 약 12MB
  const t = T.lastTurnOfFile(f, { first: 64 << 10, max: 1 << 20 });
  assert.equal(t.prompt, '끝 턴 글');
  assert.equal(t.reply, '끝 턴 답\n— 끝');
  // 끝부분(max) 안에 턴을 연 입력이 없으면 통째로 읽지 않고 null — 기록이 커도 상한 이상 안 읽음
  const g = path.join(TMP, 'noprompt.jsonl');
  fs.writeFileSync(g, transcript('맨 앞 글', '맨 앞 답') + filler.repeat(600));   // 입력은 2.4MB 앞
  assert.equal(T.lastTurnOfFile(g, { first: 64 << 10, max: 1 << 20 }), null);
});

test('hasMark: 이 창 표지가 없으면 false(기록을 읽지 않고 끝), 있으면 true', () => {
  assert.equal(T.hasMark(['ew_nomark', 'sid-nomark']), false);
  T.markTurn(['ew_withmark'], '글');
  assert.equal(T.hasMark([null, 'x', 'ew_withmark']), true);
});

test('promptLine: 맡긴 글 첫 줄 → 노드 상태 줄 — 머리 떼기 · 가림 · 60자, 보드 글 · 시스템 글 · 빗금 명령은 없음', () => {
  const { promptLine } = T;
  assert.equal(promptLine('이번 달 분기 자료 확인해 줘\n자세한 건 아래'), '요청: 이번 달 분기 자료 확인해 줘');
  assert.equal(promptLine('[팀장 → 새 담당 · #2736 예시 일 하나] 당신은 대표 태스크 #2736 을 맡아요'), '요청: 당신은 대표 태스크 #2736 을 맡아요');
  assert.equal(promptLine('[팀장 17:44]\n새 대표 태스크를 맡깁니다.'), '요청: 새 대표 태스크를 맡깁니다.', '머리 뒤가 비면 다음 줄');
  assert.equal(promptLine('[보드 · 영업 담당 · 스레드 1793000000.000001] 자료 받았어요'), null, '보드에서 넣은 글은 이미 채널에 보임');
  assert.equal(promptLine('<task-notification>끝남</task-notification>'), null);
  assert.equal(promptLine('/compact'), null);
  assert.equal(promptLine('   \n  '), null);
  const long = promptLine('가'.repeat(80)); assert.equal(Array.from(long).length, '요청: '.length + 60); assert.ok(long.endsWith('…'));
  assert.ok(!/sk-ant-[A-Za-z0-9]/.test(promptLine('키는 sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA 이걸로 해') || ''), '비밀값 꼴은 가림');
});

test('hook prompt: 사람이 맡긴 글 → 그 창 토큰으로 inbox_log progress 「요청: …」 한 번, 출력 없음 · 보드 글은 안 올림 · 끄면 안 올림', async () => {
  await hookWorld(async ({ hook, posts }) => {
    const r = await hook(['prompt'], JSON.stringify({ session_id: SID, prompt: '[팀장 → 새 담당 · #2736] 온보딩 셋째 단계 확인해 줘' }));
    assert.equal(r.code, 0); assert.equal(r.out, '', '훅은 출력 없음(글을 막거나 덧붙이지 않음)');
    assert.equal(posts.length, 1, JSON.stringify(posts));
    assert.equal(posts[0].tool, 'inbox_log'); assert.match(posts[0].auth, /^Bearer bxa_/);
    assert.deepEqual(posts[0].body, { kind: 'progress', text: '요청: 온보딩 셋째 단계 확인해 줘' });
    await hook(['prompt'], JSON.stringify({ session_id: SID, prompt: '[보드 · 팀장] 이건 보드에서 넣은 글' }));
    assert.equal(posts.length, 1, '보드에서 넣은 글은 이미 채널에 보여 안 올림');
    await hook(['prompt'], '{ 깨진 JSON');
    assert.equal(posts.length, 1);
  });
});

test('hook stop: bundled two threads replies to last thread', async () => {
  await hookWorld(async ({ hook, posts }) => {
    const a = '[보드 · 예시 팀장 · 스레드 1793000000.000701] 첫 부탁', b = '[보드 · 예시 팀장 · 스레드 1793000000.000702] 마지막 부탁', p = a + '\n\n' + b;
    T.markTurn(['ew_team01', SID], a); T.markTurn(['ew_team01', SID], b);
    const f = path.join(TMP, 'bundle.jsonl'); fs.writeFileSync(f, transcript(p, '마지막 부탁 답'));
    await hook(['stop'], JSON.stringify({ session_id: SID, transcript_path: f }));
    assert.deepEqual(posts.map(x => [x.tool, x.body]), [['inbox_say', { thread_id: '1793000000.000702', text: '마지막 부탁 답\n— 끝' }]]);
  });
});

test('hook stop: unrelated boarder say does not suppress target thread reply', async () => {
  await hookWorld(async ({ hook, posts }) => {
    const p = '[보드 · 예시 팀장 · 스레드 1793000000.000711] 확인';
    T.markTurn(['ew_team01', SID], p);
    const rows = transcript(p, '요청하신 답').trim().split('\n').map(JSON.parse);
    rows[3].message.content[1].input = { command: 'boarder say 1793000000.000712 "다른 일 알림"' };
    const f = path.join(TMP, 'unrelated-say.jsonl'); fs.writeFileSync(f, rows.map(line).join('\n'));
    await hook(['stop'], JSON.stringify({ session_id: SID, transcript_path: f }));
    assert.deepEqual(posts.map(x => x.body), [{ thread_id: '1793000000.000711', text: '요청하신 답\n— 끝' }]);
  });
});

test('hook codex-turn: successful say suppresses only same thread and consumes bundled marks', async () => {
  await hookWorld(async ({ hook, cli, posts }) => {
    const a = '[보드 · 예시 팀장 · 스레드 1793000000.000721] 첫째';
    const b = '[보드 · 예시 팀장 · 스레드 1793000000.000722] 둘째';
    T.markTurn(['ew_team01', 'th-dedupe'], a); T.markTurn(['ew_team01', 'th-dedupe'], b);
    assert.equal((await cli(['say', '1793000000.000721', '첫째 답'])).code, 0);
    const notify = JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'th-dedupe', 'input-messages': [a, b], 'last-assistant-message': '둘째 답' });
    await hook(['codex-turn', notify]);
    assert.deepEqual(posts.map(x => x.body), [{ thread_id: '1793000000.000721', text: '첫째 답' }, { thread_id: '1793000000.000722', text: '둘째 답' }]);
    await hook(['codex-turn', notify]);
    assert.equal(posts.length, 2, '한 턴의 앞 표지도 소비해 중복 notify 는 새 답을 내지 않음');
    T.markTurn(['ew_team01', 'th-dedupe'], b);
    assert.equal((await cli(['say', '1793000000.000722', '이미 답했어요'])).code, 0);
    await hook(['codex-turn', notify]);
    assert.equal(posts.length, 3, '같은 스레드의 성공한 say 는 터미널 답을 다시 올리지 않음');
  });
});

test('replyPlan: injection remembers thread even when transcript head was changed', () => {
  const at = Date.now();
  T.markTurn(['ew_remember'], '[보드 · 예시 팀장 · 카드 1793000000.000731] 부탁', at);
  assert.deepEqual(T.replyPlan({ keys: ['ew_remember'], prompt: '하네스가 글 머리를 잘랐어요', at, reply: '카드 답' }), ['inbox_say', { thread_id: '1793000000.000731', text: '카드 답' }]);
  assert.equal(T.replyPlan({ keys: ['ew_remember'], prompt: '자율 다음 턴', at: at + 1000, reply: '새 글' }), null);
});

test('hook stop: successful same-thread say suppresses terminal duplicate, failed say does not', async () => {
  await hookWorld(async ({ hook, posts }) => {
    const p = '[보드 · 예시 팀장 · 스레드 1793000000.000741] 확인';
    for (const failed of [false, true]) {
      T.markTurn(['ew_team01', SID], p);
      const rows = transcript(p, '최종 답').trim().split('\n').map(JSON.parse);
      rows[3].message.content[1].input = { command: 'boarder say 1793000000.000741 "답"' };
      rows[4].message.content[0].is_error = failed;
      const f = path.join(TMP, `same-say-${failed}.jsonl`); fs.writeFileSync(f, rows.map(line).join('\n'));
      await hook(['stop'], JSON.stringify({ session_id: SID, transcript_path: f }));
      assert.equal(posts.length, failed ? 1 : 0);
    }
  });
});


test('takeTurn: identical independent inputs consume one marker per occurrence', () => {
  const p = '[보드 · 예시 팀장 · 스레드 1793000000.000751] 같은 부탁';
  const now = Date.now();
  T.markTurn(['ew_identical'], p, now); T.markTurn(['ew_identical'], p, now + 1);
  assert.equal(T.takeTurn(['ew_identical'], p, 0), true);
  assert.equal(T.hasMark(['ew_identical']), true, '다음 독립 턴의 같은 글 표지는 남김');
  assert.equal(T.takeTurn(['ew_identical'], p, 0), true);
  assert.equal(T.takeTurn(['ew_identical'], p, 0), false);
  T.markTurn(['ew_identical'], p, now); T.markTurn(['ew_identical'], p, now + 1); T.markTurn(['ew_identical'], p, now + 2);
  assert.deepEqual(T.replyPlan({ keys: ['ew_identical'], prompt: p + '\n\n' + p, reply: '묶음 답' }), ['inbox_say', { thread_id: '1793000000.000751', text: '묶음 답' }]);
  assert.equal(T.hasMark(['ew_identical']), true, '묶음에 든 두 번만 소비하고 세 번째는 남김');
  assert.equal(T.takeTurn(['ew_identical'], p, 0), true);
  assert.equal(T.hasMark(['ew_identical']), false);
});

const TH = '1793000000.000801', QH = '[보드 · 예시 팀장 · 스레드 ' + TH + '] 이 글 봐 주세요';
const said = (name, input) => [{ type: 'tool_use', id: 'x', name, input }];
test('리뷰 1: 코드 모드(boarder_execute_write)로 같은 스레드에 답했으면 터미널 답을 또 올리지 않음 — 다른 스레드 · 모르는 스레드는 올림', () => {
  const K = ['ew_code1'], X = 'mcp__boarder__boarder_execute_write';
  const plan = s => { T.markTurn(K, QH); return T.replyPlan({ keys: K, prompt: QH, at: 0, reply: '답', said: s }); };
  for (const input of [
    { tool: 'inbox_say', arguments: { thread_id: TH, text: '답' } },
    { name: 'inbox_say', arguments: { thread_id: TH, text: '답' } },
    { calls: [{ tool: 'inbox_log', arguments: { kind: 'progress', text: 'x' } }, { tool: 'inbox_say', arguments: { thread_id: TH, text: '답' } }] },
    { code: `async () => { await tools.call("inbox_say", { thread_id: "${TH}", text: "답" }); }` },
    { code: 'async () => tools.call("inbox_say", { thread_id: input.t, text: "답" })', input: { t: TH } },
  ]) assert.equal(plan(said(X, input)), null, JSON.stringify(input));
  const other = ['inbox_say', { thread_id: TH, text: '답' }];
  assert.deepEqual(plan(said(X, { tool: 'inbox_say', arguments: { thread_id: '1793000000.000899', text: '다른 일' } })), other);
  assert.equal(plan(said(X, { code: 'async () => { for (const t of input.ts) await tools.call("inbox_say", { thread_id: t, text: "x" }); }' })), null, '스레드를 못 읽는 스크립트는 main 처럼 답한 것으로(두 번 안 나가게)');
  // MCP 프록시 · CLI 가 남기는 답 기록도 같은 꼴
  T.markTurn(K, QH); T.recordReply(K, 'boarder_execute_write', { tool: 'inbox_say', arguments: { thread_id: TH, text: '답' } });
  assert.equal(T.replyPlan({ keys: K, prompt: QH, at: 0, reply: '답' }), null);
  assert.deepEqual(T.sayCalls('boarder_execute_write', { calls: [{ tool: 'chat_say', arguments: { text: 'a' } }] }), [['chat_say', { text: 'a' }]]);
  assert.deepEqual(T.sayCalls('boarder_execute', { tool: 'inbox_say', arguments: { thread_id: TH, text: 'a' } }), [], '읽기 전용 실행은 답이 아님');
});

test('자리를 글자로 못 읽은 답은 main 처럼 답한 것으로 — 두 번 안 나감(main 은 낱말만 있어도 셌음)', () => {
  const K = ['ew_said_parity'];
  const plan = s => { T.markTurn(K, QH); return T.replyPlan({ keys: K, prompt: QH, at: 0, reply: '답', said: s }); };
  for (const command of [`cd ~/w && boarder say ${TH} "답"`, `npx boarder say ${TH} "답"`, 'T=' + TH + '; boarder say "$T" "답"', 'boarder say "$T" "답"']) assert.equal(plan(said('Bash', { command })), null, command);
  assert.equal(plan(said('mcp__boarder__boarder_execute_write', { code: `const t="${TH}"; await tools.call("inbox_say",{thread_id:t,text:"답"})` })), null, '변수 스레드 코드 모드');
  assert.deepEqual(plan(said('Bash', { command: 'boarder say 1793000000.000899 "다른 일"' })), ['inbox_say', { thread_id: TH, text: '답' }], '글자로 다른 스레드면 그대로 올림');
  assert.deepEqual(plan(said('Bash', { command: 'git status' })), ['inbox_say', { thread_id: TH, text: '답' }], '답과 상관없는 명령');
  T.markTurn(K, QH); T.recordReply(K, 'boarder_execute_write', { code: 'tools.call("inbox_say",{thread_id:t,text:"x"})' });
  assert.deepEqual(T.replyPlan({ keys: K, prompt: QH, at: 0, reply: '답' }), ['inbox_say', { thread_id: TH, text: '답' }], '자리를 모르는 답은 기록에 안 남김');
});

test('리뷰 2: 본문에 인용된 보드 머리는 답 자리 · 대기열 열쇠를 바꾸지 않음(첫 줄 머리만)', async () => {
  const { threadKey, JOIN } = await import('./engine/queue.mjs');
  const q1 = QH + '\n어제 받은 글 그대로:\n[보드 · 다른 팀 · 스레드 1793000000.000001] 지난주 답 어디 갔나요';
  const q2 = QH + '\n[보드 · Primary] 예전 글';
  const q3 = '[보드 · Primary · 스레드 ' + TH + '] 물음\n[보드 · 예시 팀장] 이 줄이 창에 찍혔어요';
  assert.deepEqual(T.parseHead(q1), { channel: '예시 팀장', thread: TH });
  assert.deepEqual(T.parseHead(q2), { channel: '예시 팀장', thread: TH });
  assert.deepEqual(T.parseHead(q3), { primary: true, thread: TH });
  assert.equal(threadKey(q1), 'thread:' + TH); assert.equal(threadKey(q2), 'thread:' + TH); assert.equal(threadKey(q3), 'primary:' + TH);
  for (const q of [q1, q2]) { T.markTurn(['ew_quote'], q); assert.deepEqual(T.replyPlan({ keys: ['ew_quote'], prompt: q, at: 0, reply: '답' }), ['inbox_say', { thread_id: TH, text: '답' }]); }
  T.markTurn(['ew_quote'], q3); assert.deepEqual(T.replyPlan({ keys: ['ew_quote'], prompt: q3, at: 0, reply: '답' }), ['chat_say', { text: '답', thread: TH }]);
  // 대기열 묶음(같은 열쇠 글만 JOIN): 첫 줄 머리 = 마지막 글 머리 → 같은 자리
  const b = [QH, '[보드 · 예시 팀장 · 스레드 ' + TH + '] 하나 더'].join(JOIN);
  assert.equal(threadKey(b), 'thread:' + TH);
  T.markTurn(['ew_quote'], b); assert.deepEqual(T.replyPlan({ keys: ['ew_quote'], prompt: b, at: 0, reply: '묶음 답' }), ['inbox_say', { thread_id: TH, text: '묶음 답' }]);
});

test('리뷰 7: 다른 창의 답 기록이 아무리 많아도 진행 중 턴의 표지를 밀어내지 않음', () => {
  const K = ['ew_cap_me'], O = ['ew_cap_other'], now = Date.now();
  T.markTurn(K, QH, now);
  for (let i = 0; i < 60; i++) T.recordReply(O, 'chat_say', { thread: '1793000000.00' + (1000 + i), text: 'x' }, now + i);   // 표지 없는 창의 say
  T.markTurn(O, '[보드 · 다른 창] 일', now);
  for (let i = 0; i < 60; i++) T.recordReply(O, 'chat_say', { thread: '1793000000.00' + (2000 + i), text: 'x' }, now + 100 + i);   // 표지 있는 창의 say 60번
  assert.equal(T.hasMark(K, now + 200), true);
  assert.deepEqual(T.replyPlan({ keys: K, prompt: QH, at: now + 1000, reply: '답' }), ['inbox_say', { thread_id: TH, text: '답' }]);
  T.replyPlan({ keys: O, prompt: '[보드 · 다른 창] 일', at: 0, reply: 'x' });
});

test('후속: Codex input-messages 가 [보드 글, 터미널 글] · [터미널 글, 보드 글] 이어도 보드 글 자리로 답 한 번', async () => {
  const K = ['ew_codex_mix'];
  for (const msgs of [[QH, '이것도 같이 봐 줘'], ['먼저 친 글', QH]]) {
    T.markTurn(K, QH);
    assert.deepEqual(T.replyPlan({ keys: K, prompt: msgs, at: 0, reply: '답' }), ['inbox_say', { thread_id: TH, text: '답' }], JSON.stringify(msgs));
    assert.equal(T.hasMark(K), false);
  }
  await hookWorld(async ({ hook, posts }) => {
    T.markTurn(['ew_team01', 'th-mix'], QH);
    await hook(['codex-turn', JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'th-mix', 'input-messages': [QH, '이것도 같이'], 'last-assistant-message': '둘 다 봤어요' })]);
    assert.deepEqual(posts.map(x => [x.tool, x.body]), [['inbox_say', { thread_id: TH, text: '둘 다 봤어요' }]]);
  });
});

test('후속: Primary 스레드 글에 스레드 없이 chat_say 로 답했으면 터미널 답을 또 올리지 않음', () => {
  const K = ['ew_prim'], P = '[보드 · Primary · 스레드 ' + TH + '] 물음';
  T.markTurn(K, P); T.recordReply(K, 'chat_say', { text: '맨 위 답' });
  assert.equal(T.replyPlan({ keys: K, prompt: P, at: 0, reply: '터미널 답' }), null);
  T.markTurn(K, P);
  assert.equal(T.replyPlan({ keys: K, prompt: P, at: 0, reply: '터미널 답', said: said('mcp__boarder__chat_say', { text: '맨 위 답' }) }), null);
  T.markTurn(K, '[보드 · 예시 팀장 · 스레드 ' + TH + '] 노드 글'); T.recordReply(K, 'chat_say', { text: 'Primary 맨 위' });
  assert.deepEqual(T.replyPlan({ keys: K, prompt: '[보드 · 예시 팀장 · 스레드 ' + TH + '] 노드 글', at: 0, reply: '노드 답' }), ['inbox_say', { thread_id: TH, text: '노드 답' }], '노드 스레드 글은 Primary 답으로 막지 않음');
});
