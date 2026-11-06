import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-queue-'));
const B = path.join(TMP, 'boarder'); fs.mkdirSync(B, { recursive: true, mode: 0o700 });
process.env.BOARDER_HOME = B;
const STATE = path.join(TMP, 'fake-engine.json');
process.env.FAKE_ENGINE_STATE = STATE;

const ENGINE = path.join(TMP, 'fake-engine.cjs');
fs.writeFileSync(ENGINE, `#!${process.execPath}
const fs = require('node:fs');
const f = process.env.FAKE_ENGINE_STATE, s = JSON.parse(fs.readFileSync(f, 'utf8'));
let inp = ''; process.stdin.on('data', d => inp += d); process.stdin.on('end', () => {
  const a = inp ? JSON.parse(inp) : {}, verb = process.argv[2], w = s.windows[a.id];
  const out = o => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
  if (verb === 'list') { if (s.nolist) { process.stderr.write('no list'); process.exit(4); } return out({ windows: Object.entries(s.windows).map(([id, x]) => ({ id, name: id, session_id: x.session_id })) }); }
  if (!w) { if (verb === 'state') return out({ id: a.id, state: 'none' }); process.stderr.write('no such window'); process.exit(4); }
  if (verb === 'state') { if (w.nostate) { process.stderr.write('no state'); process.exit(1); } return out({ id: a.id, state: w.state, session_id: w.session_id }); }
  if (verb === 'send') { if (w.state === 'typing') { process.stderr.write('someone is typing'); process.exit(2); } (w.sent ||= []).push({ text: a.text, test: !!a.test, ...(a.owner ? { owner: true } : {}) }); fs.writeFileSync(f, JSON.stringify(s)); return out({ ok: true }); }
  if (verb === 'log') return out({ messages: [{ who: 'agent', text: '기록 ' + a.id + ' ' + (a.name || '') }], kind: 'claude', live: true });
  process.exit(1);
});
`, { mode: 0o700 });
fs.writeFileSync(path.join(B, 'engine.json'), JSON.stringify({ default: 'fake', tmux: path.join(TMP, 'no-tmux'), herdr: path.join(TMP, 'no-herdr'), custom: { fake: { exec: ENGINE } }, windows: { ew_team01: 'fake', ew_other1: 'fake', ew_nostate1: 'fake', ew_gone01: 'fake' } }));

const OWN = path.join(TMP, 'fake-own.json'), BIN_DIR = path.join(TMP, 'bin'); fs.mkdirSync(BIN_DIR);
process.env.FAKE_OWN = OWN; process.env.PATH = `${BIN_DIR}:${process.env.PATH}`; process.env.HOME = TMP; process.env.CLAUDE_CONFIG_DIR = path.join(TMP, 'no-claude');
const fakeBin = (name, body) => fs.writeFileSync(path.join(BIN_DIR, name), `#!${process.execPath}\nconst fs = require('node:fs'), f = process.env.FAKE_OWN, s = JSON.parse(fs.readFileSync(f, 'utf8')), a = process.argv.slice(2), save = () => fs.writeFileSync(f, JSON.stringify(s));\n${body}\n`, { mode: 0o700 });
fakeBin('tmux', `const t = a[a.indexOf('-t') + 1], p = s.tmux[t];
if (a[0] === 'display') { if (p) process.stdout.write(String(p.pid)); process.exit(p ? 0 : 1); }
if (a[0] === 'capture-pane') { process.stdout.write(p.screen); process.exit(0); }
if (a[0] === 'send-keys') { if (a.includes('-l')) p.typed = (p.typed || '') + a[a.length - 1]; else if (a.includes('Enter')) { (p.sent ||= []).push(p.typed || ''); p.typed = ''; } save(); process.exit(0); }
process.exit(1);`);
fakeBin('ps', `process.stdout.write(Object.values(s.tmux).map(p => '  ' + p.pid + ' 1 claude --resume x').join('\\n') + '\\n');`);
fakeBin('herdr', `const j = o => { process.stdout.write(JSON.stringify({ result: o })); process.exit(0); };
if (a[0] === 'agent' && a[1] === 'list') { if (s.herdrDown) { process.stderr.write('{"error":{"code":"down","message":"down"}}'); process.exit(1); } return j({ agents: Object.entries(s.herdr).map(([pane_id, x]) => ({ pane_id, agent_status: x.status })) }); }
if (a[0] === 'pane' && a[1] === 'read') { process.stdout.write(s.herdr[a[2]]?.screen || '> '); process.exit(0); }
if (a[0] === 'agent' && a[1] === 'prompt') { const p = s.herdr[a[2]]; if (p.asking) { process.stderr.write(JSON.stringify({ error: { code: 'agent_blocked', message: 'asking something' } })); process.exit(1); } if (p.stopped) { process.stderr.write(JSON.stringify({ error: { code: 'agent_not_found', message: 'stopped' } })); process.exit(1); } (p.sent ||= []).push(a[3]); save(); return j({}); }
process.exit(1);`);
const own = o => fs.writeFileSync(OWN, JSON.stringify({ tmux: {}, herdr: {}, ...o }));
const ownGet = () => JSON.parse(fs.readFileSync(OWN, 'utf8'));
const BUSY = '✻ Working… (esc to interrupt)\n', IDLE_SCREEN = '> \n';

const SID = '11111111-2222-3333-4444-555555555555';
const world = (windows) => fs.writeFileSync(STATE, JSON.stringify({ windows }));
const setState = (id, state) => { const s = JSON.parse(fs.readFileSync(STATE, 'utf8')); s.windows[id].state = state; fs.writeFileSync(STATE, JSON.stringify(s)); };
const sent = id => JSON.parse(fs.readFileSync(STATE, 'utf8')).windows[id].sent || [];
const queueFile = () => path.join(B, 'send-queue.json');
const queued = id => (JSON.parse(fs.existsSync(queueFile()) ? fs.readFileSync(queueFile(), 'utf8') : '{}')[id] || []).map(x => x.text);

const D = await import('./engine/daemon.mjs');
const T = await import('./turn.mjs');
const send = (id, text, extra = {}) => D.handle({ verb: 'send', args: { id, text, ...extra } });
const drain = id => D.drainWindow({ id, engine: 'fake', session_id: SID }, { state: JSON.parse(fs.readFileSync(STATE, 'utf8')).windows[id].state, session_id: SID });

// 가짜 Boarder 서버(답이 어디로 가나) + boarder hook stop(진짜 Stop 훅 길)
const posts = [], cmdPosts = [], cmdsQ = [];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d);
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/device/cmds' && req.method === 'GET') return res.end(JSON.stringify({ cmds: cmdsQ.splice(0) }));
    if (req.url.startsWith('/api/device/cmds/')) { cmdPosts.push([decodeURIComponent(req.url.slice(17)), JSON.parse(b)]); return res.end('{"ok":true}'); }
    if (req.url === '/api/device/window') return res.end(JSON.stringify({ token: 'bxa_' + 'w'.repeat(40) }));
    if (/^\/api\/agent\/(inbox_log|inbox_say|chat_say)$/.test(req.url)) { posts.push([req.url.slice(11), JSON.parse(b)]); return res.end('{"ok":true}'); }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 'bxd_made_up', device_id: 'd1', server: `http://127.0.0.1:${srv.address().port}` }));
test.after(() => { srv.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

const line = o => JSON.stringify(o);
let turnNo = 0;
/** Claude Code 가 그 턴을 마침: 기록(그 턴을 연 글 = 창에 들어간 글) → Stop 훅 → 창은 쉼 */
async function finishTurn(id, prompt, reply) {
  const f = path.join(TMP, `t${++turnNo}.jsonl`);
  fs.writeFileSync(f, [line({ type: 'user', message: { role: 'user', content: prompt }, timestamp: new Date().toISOString() }), line({ type: 'assistant', message: { id: `m${turnNo}`, role: 'assistant', content: [{ type: 'text', text: reply }] } })].join('\n') + '\n');
  const r = await new Promise(res => { const c = spawn(process.execPath, [BIN, 'hook', 'stop'], { env: { HOME: TMP, BOARDER_HOME: B, BOARDER_WINDOW: id, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` }, stdio: ['pipe', 'pipe', 'pipe'] }); let err = ''; c.stderr.on('data', d => err += d); c.on('close', code => res({ code, err })); c.stdin.end(JSON.stringify({ session_id: SID, transcript_path: f })); });
  assert.equal(r.code, 0, r.err);
  setState(id, 'idle');
}
const reset = () => { posts.length = 0; cmdPosts.length = 0; reports.length = 0; fs.rmSync(queueFile(), { force: true }); fs.rmSync(path.join(B, 'import-queue.json'), { force: true }); fs.rmSync(path.join(B, 'turns.json'), { force: true }); };
const reports = []; D.setReporter(o => reports.push(o));
const E = await import('./engine/index.mjs');
const Q = await import('./engine/queue.mjs');
const I = await import('./importer.mjs');

const A = '[보드 · 예시 팀장 · 스레드 1793000000.000001] 첫째 스레드 글';
const Bt = '[보드 · Primary · 스레드 1793000000.000002] [Boarder chat] 둘째 스레드 글';
const C = '[보드 · 예시 팀장 · 카드 1793000000.000003] [Boarder] 셋째 카드 글';

test('① 스레드 셋에 글 셋 → 첫 글만 바로, 둘은 대기 → 턴이 끝날 때마다 하나씩 → 답 셋이 각자 제 스레드로 하나씩', async () => {
  reset(); world({ ew_team01: { state: 'idle', session_id: SID } });
  assert.equal((await send('ew_team01', A)).queued, undefined, '쉬는 창 — 바로');
  setState('ew_team01', 'busy');   // Claude 가 그 글로 턴을 돎
  assert.deepEqual(await send('ew_team01', Bt), { ok: true, queued: true });
  assert.deepEqual(await send('ew_team01', C), { ok: true, queued: true });
  assert.deepEqual(sent('ew_team01').map(x => x.text), [A], '턴 중에는 하나만 들어감');
  assert.deepEqual(queued('ew_team01'), [Bt, C]);
  assert.equal(fs.statSync(queueFile()).mode & 0o777, 0o600);

  assert.equal(await drain('ew_team01'), false, '턴 중에는 꺼내지 않음');
  await finishTurn('ew_team01', A, '첫째 답');
  assert.equal(await drain('ew_team01'), true); setState('ew_team01', 'busy');
  assert.deepEqual(sent('ew_team01').map(x => x.text), [A, Bt], '다음 턴에 다음 스레드 하나만');
  await finishTurn('ew_team01', Bt, '둘째 답');
  assert.equal(await drain('ew_team01'), true); setState('ew_team01', 'busy');
  await finishTurn('ew_team01', C, '셋째 답');
  assert.equal(await drain('ew_team01'), false, '줄이 비면 넣을 것 없음');

  assert.deepEqual(sent('ew_team01').map(x => x.text), [A, Bt, C]);
  assert.deepEqual(posts, [
    ['inbox_say', { thread_id: '1793000000.000001', text: '첫째 답' }],
    ['chat_say', { text: '둘째 답', thread: '1793000000.000002' }],
    ['inbox_say', { thread_id: '1793000000.000003', text: '셋째 답' }],
  ]);
  assert.equal(T.hasMark(['ew_team01', SID]), false, '표지는 턴마다 하나씩 다 쓰임');
});

test('② 같은 스레드 글 둘은 한 번에 묶여 들어가고 답 하나 · 다른 스레드 글은 그 다음 턴', async () => {
  reset(); world({ ew_team01: { state: 'busy', session_id: SID } });
  const s1 = '[보드 · 예시 팀장 · 스레드 1793000000.000010] 이것 봐 줘', s2 = '[보드 · 예시 팀장 · 스레드 1793000000.000010] 하나 더', o = '[보드 · 예시 팀장 · 스레드 1793000000.000011] 다른 이야기';
  for (const t of [s1, o, s2]) assert.equal((await send('ew_team01', t)).queued, true);
  setState('ew_team01', 'idle');
  assert.equal(await drain('ew_team01'), true); setState('ew_team01', 'busy');
  const first = sent('ew_team01').map(x => x.text);
  assert.deepEqual(first, [`${s1}\n\n${s2}`], '같은 스레드 둘이 한 글로');
  assert.deepEqual(queued('ew_team01'), [o]);
  await finishTurn('ew_team01', first[0], '두 글 다 봤어요');
  assert.equal(await drain('ew_team01'), true); setState('ew_team01', 'busy');
  await finishTurn('ew_team01', o, '다른 답');
  assert.deepEqual(posts, [
    ['inbox_say', { thread_id: '1793000000.000010', text: '두 글 다 봤어요' }],
    ['inbox_say', { thread_id: '1793000000.000011', text: '다른 답' }],
  ]);
});

test('③ 턴 중이 아니면 지금처럼 바로 들어감 — 다른 창의 줄 · 막 넣은 글의 틈은 따로', async () => {
  reset(); world({ ew_team01: { state: 'idle', session_id: SID }, ew_other1: { state: 'busy', session_id: 'sid-other' } });
  await send('ew_other1', '[보드 · 다른 창] 기다려');
  const r = await send('ew_team01', '[보드 · 예시 팀장] 바로');
  assert.notEqual(r.queued, true);
  assert.deepEqual(sent('ew_team01').map(x => x.text), ['[보드 · 예시 팀장] 바로']);
  assert.equal(T.hasMark(['ew_team01', SID]), true, '바로 넣은 글도 표지');
  // 넣은 직후 Claude 가 아직 그 글을 안 집어 상태가 idle 인 틈 — 다음 글은 기다림(같은 턴에 섞이지 않게)
  assert.equal((await send('ew_team01', '[보드 · 예시 팀장 · 스레드 1793000000.000020] 틈에 온 글')).queued, true);
  assert.equal(await drain('ew_team01'), false, '표지가 막 남은 동안은 꺼내지 않음');
  assert.deepEqual(queued('ew_other1'), ['[보드 · 다른 창] 기다려']);
});

test('④ 시험(test) send 는 대기열을 거치지 않음 — 턴 중이어도 바로, 표지도 없음', async () => {
  reset(); world({ ew_team01: { state: 'busy', session_id: SID } });
  const r = await send('ew_team01', 'boarder test ping', { test: true });
  assert.notEqual(r.queued, true);
  assert.deepEqual(sent('ew_team01'), [{ text: 'boarder test ping', test: true }]);
  assert.deepEqual(queued('ew_team01'), []);
  assert.equal(T.hasMark(['ew_team01', SID]), false);
});

test('바쁨(사람이 입력 중)이면 줄에 남겨 다음 회에 · 줄은 다시 읽어도(엔진 재시작) 남음', async () => {
  reset(); world({ ew_team01: { state: 'busy', session_id: SID } });
  await send('ew_team01', '[보드 · 예시 팀장] 남아라');
  setState('ew_team01', 'typing');
  assert.equal(await D.drainWindow({ id: 'ew_team01', engine: 'fake', session_id: SID }, { state: 'idle', session_id: SID }), false);
  assert.deepEqual(queued('ew_team01'), ['[보드 · 예시 팀장] 남아라'], '못 넣은 글은 버리지 않음');
  const Q = await import('./engine/queue.mjs');
  assert.equal(Q.pending('ew_team01'), 1, '파일에서 다시 읽어도 그대로');
});

test('쉬는 창에 바로 넣다 바쁨(입력칸에 글)이면 「못 넣음」 대신 줄에 둠 → 입력칸이 비면 다음 회에 들어감', async () => {
  reset(); world({ ew_team01: { state: 'typing', session_id: SID } });
  const r = await send('ew_team01', '[보드 · 예시 팀장 · 스레드 1793000000.000030] 사라지지 마');
  assert.equal(r.queued, true, '실패로 돌려주지 않고 줄에');
  assert.deepEqual(queued('ew_team01'), ['[보드 · 예시 팀장 · 스레드 1793000000.000030] 사라지지 마']);
  setState('ew_team01', 'idle');
  assert.equal(await drain('ew_team01'), true);
  assert.deepEqual(sent('ew_team01').map(x => x.text), ['[보드 · 예시 팀장 · 스레드 1793000000.000030] 사라지지 마']);
});

test('takeTurn: 한 창에 표지가 여럿이면 그 턴을 연 글의 표지만 쓰고 나머지는 남김', () => {
  reset();
  const now = Date.now();
  T.markTurn(['ew_multi1'], '[보드 · Primary] 앞 글', now - 1000);
  T.markTurn(['ew_multi1'], '[보드 · 예시 팀장 · 스레드 1793000000.000030] 뒤 글', now);
  assert.equal(T.takeTurn(['ew_multi1'], '[보드 · 예시 팀장 · 스레드 1793000000.000030] 뒤 글', now - 1000), true, '시각은 앞 글에 더 가까워도 글이 같은 표지를 씀');
  assert.equal(T.takeTurn(['ew_multi1'], '[보드 · 예시 팀장 · 스레드 1793000000.000030] 뒤 글', 0), false, '같은 표지 두 번 안 씀');
  assert.equal(T.takeTurn(['ew_multi1'], '[보드 · Primary] 앞 글', 0), true, '앞 글 표지는 남아 있었음');
});


test('상태를 모르는 창(state 동사 없음 · 오류)은 줄 세우지 않고 바로 넣음 — 막 넣은 표지가 있어도', async () => {
  reset(); world({ ew_nostate1: { state: 'busy', nostate: true, session_id: SID } });
  assert.notEqual((await send('ew_nostate1', '[보드 · 예시 팀장 · 스레드 1793000000.000040] 하나')).queued, true);
  assert.notEqual((await send('ew_nostate1', '[보드 · 예시 팀장 · 스레드 1793000000.000041] 둘')).queued, true, '표지가 막 남았어도 쉬는 때를 알 수 없으니 바로');
  assert.equal(sent('ew_nostate1').length, 2);
  assert.deepEqual(queued('ew_nostate1'), []);
});

test('list 동사가 없는 엔진: 폴링(tickQueues)이 state 로 보고 쉬면 넣음 · 넣은 명령 id 를 서버에 done 으로', async () => {
  reset(); world({ ew_team01: { state: 'busy', session_id: SID } });
  const s0 = JSON.parse(fs.readFileSync(STATE, 'utf8')); s0.nolist = true; fs.writeFileSync(STATE, JSON.stringify(s0));
  assert.equal((await send('ew_team01', '[보드 · 예시 팀장 · 스레드 1793000000.000050] 기다려', { cmd: 'cmd_q1' })).queued, true);
  const listed = await E.listAll();
  assert.equal(listed.some(w => w.id === 'ew_team01'), false, '목록에 안 나오는 엔진');
  await D.tickQueues(listed);
  assert.deepEqual(sent('ew_team01'), [], '턴 중엔 안 넣음');
  setState('ew_team01', 'idle');
  await D.tickQueues(listed);
  assert.deepEqual(sent('ew_team01').map(x => x.text), ['[보드 · 예시 팀장 · 스레드 1793000000.000050] 기다려']);
  assert.deepEqual(queued('ew_team01'), []);
  assert.deepEqual(reports.filter(r => r.done), [{ type: 'queue', id: 'ew_team01', done: ['cmd_q1'] }]);
});

test('10분 넘게 기다린 글 · 닫힌 창의 글은 보드에 한 줄씩(한 번만) 알리고 줄에는 남김', async () => {
  reset(); world({ ew_team01: { state: 'busy', session_id: SID }, ew_gone01: { state: 'busy', session_id: 'sid-gone' } });
  await send('ew_team01', '[보드 · 예시 팀장] 오래 기다림');
  await send('ew_gone01', '[보드 · 예시 팀장] 닫힌 창 글');
  const s0 = JSON.parse(fs.readFileSync(STATE, 'utf8')); delete s0.windows.ew_gone01; fs.writeFileSync(STATE, JSON.stringify(s0));   // 창이 닫힘
  const later = Date.now() + 11 * 60_000;
  for (let i = 0; i < 2; i++) await D.tickQueues(await E.listAll(), { now: later });
  const notes = reports.filter(r => r.note);
  assert.equal(notes.filter(r => r.id === 'ew_gone01' && /닫혀/.test(r.note)).length, 1, `닫힌 창 한 줄: ${JSON.stringify(notes)}`);
  assert.equal(notes.filter(r => r.id === 'ew_team01' && /10분/.test(r.note)).length, 1, '오래 기다림 한 줄(두 번째 폴링엔 다시 안 알림)');
  assert.deepEqual(queued('ew_team01'), ['[보드 · 예시 팀장] 오래 기다림']);
  assert.deepEqual(queued('ew_gone01'), ['[보드 · 예시 팀장] 닫힌 창 글'], '닫혀도 버리지 않음(다시 열리면 넣음)');
});

test('줄이 꽉 차면(100) 새 글은 버리지 않고 바쁨(2)으로 돌려 서버가 다시 보내게 + 보드에 한 줄', async () => {
  reset(); world({ ew_team01: { state: 'busy', session_id: SID } });
  for (let i = 0; i < Q.PER_WINDOW_MAX; i++) Q.push('ew_team01', `[보드 · 예시 팀장] 글 ${i}`);
  await assert.rejects(send('ew_team01', '[보드 · 예시 팀장] 넘친 글'), e => e.code === 2);
  assert.equal(Q.pending('ew_team01'), Q.PER_WINDOW_MAX, '앞 글을 버리지 않음');
  assert.ok(reports.some(r => r.id === 'ew_team01' && /100개/.test(r.note || '')));
});

test('넣는 도중 데몬이 죽었던 글은 다시 넣지 않음(두 번 들어가지 않게) — 들어갔는지 모름으로 보드에', async () => {
  reset(); world({ ew_team01: { state: 'idle', session_id: SID } });
  Q.push('ew_team01', '[보드 · 예시 팀장] 넣다 만 글', { cmd: 'cmd_dead' });
  const q = Q.load(); q.ew_team01[0].inflight = { pid: 2 ** 22 + 12345, at: Date.now() }; fs.writeFileSync(queueFile(), JSON.stringify(q));   // 죽은 pid
  assert.equal(await drain('ew_team01'), false);
  assert.deepEqual(sent('ew_team01'), []);
  assert.deepEqual(queued('ew_team01'), []);
  assert.ok(reports.some(r => /확인하지 못했어요/.test(r.note || '')));
  assert.ok(reports.some(r => r.done?.includes('cmd_dead')));
});

test('들여온 tmux 창(tmux-own): 턴 중이면 줄에 서고 서버엔 queued → 쉬면 넣고 그 명령 id 로 done', async () => {
  reset(); own({ tmux: { '%7': { pid: 4242, screen: BUSY } } });
  const h = { engine: 'tmux-own', pane: '%7', session_id: 'aaaaaaaa-0000-4000-8000-000000000007' };
  cmdsQ.push({ id: 'cmd_own1', verb: 'send', args: { item: 'window:host:tmux:7', engine: 'tmux-own', handle: h, text: '[보드 · 내 노드 · 스레드 1793000000.000060] 첫 글', post: true } });
  cmdsQ.push({ id: 'cmd_own2', verb: 'send', args: { item: 'window:host:tmux:7', engine: 'tmux-own', handle: h, text: '[보드 · 내 노드 · 카드 1793000000.000061] 카드 답' } });   // 카드 답(member-imported)도 같은 길
  await I.drainOnce({ quiet: true });
  assert.deepEqual(ownGet().tmux['%7'].sent || [], [], '턴 중엔 안 넣음');
  assert.deepEqual(cmdPosts, [['cmd_own1', { ok: true, item: { queued: true } }], ['cmd_own2', { ok: true, item: { queued: true } }]]);
  const o = ownGet(); o.tmux['%7'].screen = IDLE_SCREEN; fs.writeFileSync(OWN, JSON.stringify(o));
  cmdPosts.length = 0;
  await I.drainOnce({ quiet: true });
  assert.deepEqual(ownGet().tmux['%7'].sent, ['[보드 · 내 노드 · 스레드 1793000000.000060] 첫 글'], '한 턴에 한 스레드');
  assert.deepEqual(cmdPosts, [['cmd_own1', { ok: true }]]);
  assert.equal(T.hasMark([undefined, h.session_id]), true, '줄에서 넣은 글도 표지(Stop 훅 답 길)');
});

test('들여온 창: 오래 기다림 · AI 도구가 멈춘 창은 서버에 note(보드 한 줄), 줄에는 남김 · 상태를 못 읽는 Herdr 는 바로 넣음', async () => {
  reset(); own({ tmux: { '%8': { pid: 4343, screen: BUSY } }, herdr: { h9: { status: 'working' } }, herdrDown: true });
  const h = { engine: 'tmux-own', pane: '%8', session_id: 'aaaaaaaa-0000-4000-8000-000000000008' };
  cmdsQ.push({ id: 'cmd_old', verb: 'send', args: { item: 'w8', engine: 'tmux-own', handle: h, text: '[보드 · 내 노드] 오래' } });
  cmdsQ.push({ id: 'cmd_hd', verb: 'send', args: { item: 'w9', engine: 'herdr-own', handle: { engine: 'herdr-own', pane: 'h9' }, text: '[보드 · 내 노드] Herdr 글' } });
  await I.drainOnce({ quiet: true });
  assert.deepEqual(ownGet().herdr.h9.sent, ['[보드 · 내 노드] Herdr 글'], 'Herdr 상태를 못 읽음 → 줄 없이 바로');
  cmdPosts.length = 0;
  await I.flushOwn({ now: Date.now() + 11 * 60_000 });
  assert.equal(cmdPosts.length, 1); assert.equal(cmdPosts[0][0], 'cmd_old'); assert.match(cmdPosts[0][1].note, /10 minutes/); assert.deepEqual(cmdPosts[0][1].item, { queued: true });
  const o = ownGet(); delete o.tmux['%8']; fs.writeFileSync(OWN, JSON.stringify(o));   // 판이 닫힘
  cmdPosts.length = 0;
  await I.flushOwn(); await I.flushOwn();
  assert.equal(cmdPosts.length, 1, '닫힌 창 한 줄(한 번만)'); assert.match(cmdPosts[0][1].note, /stopped/);
  assert.equal(Q.makeQueue('import-queue.json').pending('tmux-own:%8'), 1, '버리지 않음');
});


test('ownSend: idle → typing/asking race queues the original command, then delivers once when clear', async () => {
  for (const blocked of [{ screen: '────────\n❯ unfinished human input\n────────\n' }, { asking: true }]) {
    reset(); own({ herdr: { h_typing: { status: 'idle', ...blocked } } });
    const h = { engine: 'herdr-own', pane: 'h_typing', session_id: SID };
    const text = '[보드 · 예시 팀장 · 스레드 1793000000.000070] race';
    cmdsQ.push({ id: 'cmd_typing', verb: 'send', args: { item: 'w_typing', handle: h, text, post: true } });
    await I.drainOnce({ quiet: true });
    assert.deepEqual(cmdPosts, [['cmd_typing', { ok: true, item: { queued: true } }]]);
    const q = Q.makeQueue('import-queue.json');
    assert.equal(q.pending('herdr-own:h_typing'), 1);
    assert.equal(q.load()['herdr-own:h_typing'][0].cmd, 'cmd_typing');
    assert.deepEqual(ownGet().herdr.h_typing.sent || [], []);
    own({ herdr: { h_typing: { status: 'idle' } } });
    cmdPosts.length = 0;
    await I.flushOwn(); await I.flushOwn();
    assert.deepEqual(ownGet().herdr.h_typing.sent, [text]);
    assert.deepEqual(cmdPosts, [['cmd_typing', { ok: true }]]);
    assert.equal(q.pending('herdr-own:h_typing'), 0);
    assert.equal(T.hasMark([h.session_id]), true);
  }
});

test('ownSend: stopped window errors are not queued as temporary typing', async () => {
  reset(); own({ herdr: { h_stopped: { status: 'idle', stopped: true } } });
  cmdsQ.push({ id: 'cmd_stopped', verb: 'send', args: { handle: { engine: 'herdr-own', pane: 'h_stopped' }, text: 'hello' } });
  await I.drainOnce({ quiet: true });
  assert.equal(cmdPosts[0][1].ok, false);
  assert.match(cmdPosts[0][1].error, /stopped/);
  assert.equal(Q.makeQueue('import-queue.json').pending('herdr-own:h_stopped'), 0);
});

test('⑤ 보드 세션 화면 글(owner): 턴 중이어도 줄 세우지 않고 바로 엔진에(owner 를 넘김) · 바쁨(입력 중)은 줄에 안 두고 2 로 돌려 서버가 다시 보냄', async () => {
  reset(); world({ ew_team01: { state: 'busy', session_id: SID } });
  const r = await send('ew_team01', '세션에 바로 쓴 글', { owner: true });
  assert.notEqual(r.queued, true);
  assert.deepEqual(sent('ew_team01'), [{ text: '세션에 바로 쓴 글', test: false, owner: true }], '어댑터가 owner 를 받음');
  assert.deepEqual(queued('ew_team01'), []);
  setState('ew_team01', 'typing');
  await assert.rejects(send('ew_team01', '입력 중일 때', { owner: true }), e => e.code === 2);
  assert.deepEqual(queued('ew_team01'), [], '데몬 줄엔 안 둠(서버 줄이 owner 를 들고 다시 보냄)');
  setState('ew_team01', 'busy');
  assert.equal((await send('ew_team01', '[보드 · 예시 팀장] 보통 글')).queued, true, '보통 보드 글은 예전처럼 줄');
});

test('log(선택 동사): 커스텀 엔진은 어댑터 log 로 { id, name } — caps 에 없으면 · 기록 동사가 없는 엔진(tmux)은 5', async () => {
  reset(); world({ ew_team01: { state: 'idle', session_id: SID } });
  const cfg = E.loadCfg();
  assert.deepEqual(await E.run('log', { id: 'ew_team01', name: '예시 팀장' }, cfg), { messages: [{ who: 'agent', text: '기록 ew_team01 예시 팀장' }], kind: 'claude', live: true });
  await assert.rejects(E.run('log', { id: 'ew_team01' }, { ...cfg, caps: { fake: ['send', 'state'] } }), e => e.code === 5);
  await assert.rejects(E.run('log', { id: 'ew_team01', engine: 'tmux' }, { ...cfg, tmux: process.execPath }), e => e.code === 5);
});
