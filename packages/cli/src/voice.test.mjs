// node --test packages/cli/src/voice.test.mjs
// 회원 통화: 데몬 동사 rtc_start · rtc_poll · rtc_note · rtc_say · rtc_stop 이 그 기기 codex app-server 와 주인 쪽 통화와 같은 말(JSON-RPC 한 줄씩)로 주고받는지.
// codex 는 가짜 스크립트(받은 줄을 파일에 적고, 정해 둔 알림 · 도구 부름을 보냄) — 진짜 Codex · ChatGPT 로그인 · OpenAI 에는 안 닿음. 글 · id 는 다 지어낸 것
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import * as V from './engine/voice.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000) { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error('시간 넘음'); await sleep(20); } }

// mode: say(받아쓴 사람 말 뒤 넘기기) · nosay(사람 말 없이 넘기기)
function world(mode = 'say') {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-voice-')), LOG = path.join(H, 'codex.log'), CH = path.join(H, 'codexhome');
  fs.mkdirSync(CH); fs.writeFileSync(path.join(CH, 'auth.json'), '{"made":"up"}');
  const bin = path.join(H, 'codex');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('fs'), rl = require('readline').createInterface({ input: process.stdin });
const log = o => fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify(o) + '\\n');
const out = o => process.stdout.write(JSON.stringify(o) + '\\n');
log({ argv: process.argv.slice(2) });
rl.on('line', l => { const m = JSON.parse(l); log(m);
  if (m.method === 'initialize') out({ id: m.id, result: { userAgent: 'fake' } });
  if (m.method === 'thread/start') out({ id: m.id, result: { thread: { id: 'thr_fake' } } });
  if (m.method === 'thread/realtime/start') {
    out({ method: 'thread/realtime/sdp', params: { threadId: 'thr_fake', sdp: 'v=0\\r\\no=answer' } });
    out({ id: m.id, result: {} });
    setTimeout(() => {
      if (${JSON.stringify(mode)} !== 'nosay') out({ method: 'thread/realtime/transcript/done', params: { role: 'user', text: '메인 봇에 이번 주 보고서 정리 부탁해' } });
      out({ id: 7, method: 'item/tool/call', params: { tool: 'screen', arguments: JSON.stringify({ action: 'open_channel', channel: '#notes' }) } });
      out({ id: 8, method: 'item/tool/call', params: { tool: 'handoff', arguments: { to: 'primary', text: '이번 주 보고서 정리' } } });
      out({ id: 9, method: 'item/tool/call', params: { tool: 'screen', arguments: { action: 'focus', region: { x0: 50, y0: 0, x1: 10, y1: 5 } } } });
      out({ id: 10, method: 'item/commandExecution/requestApproval', params: {} });
      if (${JSON.stringify(mode)} === 'hook') setTimeout(() => {   // 기기 고리 시험: 위임 글 · 더한 도구(deck_item) · 덱 번호 물음 넘기기(고리가 원문으로 답)
        // 첫 넘김(id 8)이 끝난 뒤에 다음 말 — 같이 보내면 그 넘김 시각(at)이 다음 말보다 늦게 찍혀 「방금 말한 부탁이 없어」로 떨어짐(부하 높을 때 반쯤 실패하던 것)
        out({ method: 'item/started', params: { item: { type: 'userMessage', content: [{ type: 'text', text: '<input>에이 오 자세히</input>' }] } } });
        out({ id: 11, method: 'item/tool/call', params: { tool: 'deck_item', arguments: { id: 'A5' } } });
        out({ method: 'thread/realtime/transcript/done', params: { role: 'user', text: '에이 오 자세히' } });
        out({ id: 12, method: 'item/tool/call', params: { tool: 'handoff', arguments: { to: 'primary', text: '덱 질문' } } });
      }, 150);
    }, 30);
  }
  if (m.method === 'thread/realtime/appendText' || m.method === 'thread/realtime/stop') out({ id: m.id, result: {} });
});
`, { mode: 0o755 });
  const env = { ...process.env, BOARDER_CODEX: bin, CODEX_HOME: CH };
  const calls = [];
  const server = async (op, body) => {
    calls.push({ op, ...body });
    if (op === 'handoff') return { ok: true, text: 'Primary에 넣음 (id cid0-1)', handoff: { id: 'cid0-1', pane: '%1', name: 'Primary', at: Date.now(), state: 'in' } };
    if (op === 'status') return { ok: true, handoffs: [{ id: 'cid0-1', state: 'working', kind: '진행', line: '통화 넘김 cid0-1 보고서 쓰는 중' }] };
    return { ok: true };
  };
  // 가짜 codex 가 줄을 쓰는 도중에 읽으면 마지막 조각이 반쪽 JSON — 끝 줄바꿈 뒤 조각은 버림(서버가 바쁠 때 「Unterminated string」으로 깨지던 것)
  const lines = () => { if (!fs.existsSync(LOG)) return []; const p = fs.readFileSync(LOG, 'utf8').split('\n'); p.pop(); return p.filter(Boolean).map(l => JSON.parse(l)); };
  return { H, env, server, calls, lines, deps: { server, env, home: H } };
}
const OFFER = 'v=0\r\no=offer';
// 시험이 중간에 실패해도 열린 통화(가짜 app-server)를 닫음 — 남으면 다음 시험이 「동시 3개」에 걸리고 남은 자식 때문에 파일이 끝나지 않음
afterEach(() => V.stopAll());

test('available: codex 없음 · 로그인 없음 · 됨 — 이유는 사람이 할 일 한 줄', () => {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-voice-a-'));
  assert.match(V.available({ PATH: H, BOARDER_CODEX: path.join(H, 'nope') }).why, /codex 가 없어요/);
  fs.writeFileSync(path.join(H, 'codex'), '');
  assert.match(V.available({ PATH: H, CODEX_HOME: path.join(H, 'ch') }).why, /로그인이 없어요 — 기기에서 codex login/);
  fs.mkdirSync(path.join(H, 'ch')); fs.writeFileSync(path.join(H, 'ch', 'auth.json'), '{}');
  assert.deepEqual(V.available({ PATH: H, CODEX_HOME: path.join(H, 'ch') }), { ok: true });
});

test('rtc_start → app-server 말 차례(initialize · thread/start 읽기 전용 + 도구 · realtime webrtc v3) → SDP 답, 받아쓴 말 · 넘기기 · 화면 · poll · 첫인사 · 끊기', async () => {
  const w = world();
  const r = await V.handle('rtc_start', { cid: 'cid0abcdef', sdp: OFFER, pane: '%1234567', name: '매출 보고', instructions: '지시문 X' }, w.deps);
  assert.deepEqual(r, { cid: 'cid0abcdef', sdp: 'v=0\r\no=answer' });
  const L = w.lines();
  assert.deepEqual(L[0].argv, ['app-server', '--listen', 'stdio://']);
  const m = n => L.find(x => x.method === n);
  assert.equal(m('initialize').params.capabilities.experimentalApi, true);
  assert.ok(L.findIndex(x => x.method === 'initialized') > L.findIndex(x => x.method === 'initialize'));
  const ts = m('thread/start').params;
  assert.deepEqual({ ap: ts.approvalPolicy, sb: ts.sandbox, eph: ts.ephemeral, bi: ts.baseInstructions, cwd: ts.cwd }, { ap: 'never', sb: 'read-only', eph: true, bi: '지시문 X\n\n' + V.NO_SECRETS, cwd: w.H });
  assert.match(ts.baseInstructions, /auth\.json[\s\S]*\.env[\s\S]*handoff/);
  assert.deepEqual(ts.dynamicTools.map(t => t.name), ['handoff', 'handoff_status', 'screen']);
  const rs = m('thread/realtime/start').params;
  assert.deepEqual({ t: rs.threadId, v: rs.version, mod: rs.outputModality, tr: rs.transport }, { t: 'thr_fake', v: 'v3', mod: 'audio', tr: { type: 'webrtc', sdp: OFFER } });
  // 받아쓴 말 → 서버 turn, 도구 셋(화면 · 넘기기 · 틀린 화면) 답 · 모르는 요청은 오류로 답(턴이 멈추지 않게)
  const res = await until(() => { const x = w.lines().filter(l => [7, 8, 9, 10].includes(l.id) && !l.method); return x.length === 4 && x; });
  const by = id => res.find(x => x.id === id);
  assert.deepEqual(by(7).result, { contentItems: [{ type: 'inputText', text: '화면 옮김' }], success: true });
  assert.deepEqual(by(8).result, { contentItems: [{ type: 'inputText', text: 'Primary에 넣음 (id cid0-1)' }], success: true });
  assert.equal(by(9).result.success, false); assert.match(by(9).result.contentItems[0].text, /범위/);
  assert.equal(by(10).error.code, -32601);
  assert.deepEqual(w.calls.find(c => c.op === 'turn'), { op: 'turn', cid: 'cid0abcdef', pane: '%1234567', role: 'user', text: '메인 봇에 이번 주 보고서 정리 부탁해' });
  const h = w.calls.find(c => c.op === 'handoff');
  assert.deepEqual({ to: h.to, text: h.text, said: h.said, n: h.n, cid: h.cid, pane: h.pane }, { to: 'primary', text: '이번 주 보고서 정리', said: '메인 봇에 이번 주 보고서 정리 부탁해', n: 0, cid: 'cid0abcdef', pane: '%1234567' });
  // poll: 화면 줄은 한 번만, 넘긴 일 · 상태
  const p1 = await V.handle('rtc_poll', { cid: 'cid0abcdef' }, w.deps);
  assert.deepEqual(p1.screen, [{ action: 'open_channel', channel: 'notes' }]);
  assert.deepEqual(p1.handoffs, [{ id: 'cid0-1', name: 'Primary', state: 'in' }]);
  assert.equal(p1.state, 'open'); assert.equal(p1.turns, 1);
  await until(() => w.calls.some(c => c.op === 'status'));   // poll 이 뒤에서 상태를 물음(15초에 한 번)
  await sleep(20);
  const p2 = await V.handle('rtc_poll', { cid: 'cid0abcdef' }, w.deps);
  assert.deepEqual(p2.screen, []); assert.deepEqual(p2.handoffs, [{ id: 'cid0-1', name: 'Primary', state: 'working' }]);
  assert.equal(w.calls.filter(c => c.op === 'status').length, 1, '15초 안엔 다시 안 물음');
  // connected → 첫인사 한 번, rtc_say → appendText
  await V.handle('rtc_note', { cid: 'cid0abcdef', k: 'connected' }, w.deps);
  await V.handle('rtc_note', { cid: 'cid0abcdef', k: 'connected' }, w.deps);
  await V.handle('rtc_say', { cid: 'cid0abcdef', text: '(시스템: 판 글)' }, w.deps);
  const ap = await until(() => { const x = w.lines().filter(l => l.method === 'thread/realtime/appendText'); return x.length === 2 && x; });
  assert.equal(ap[0].params.text, V.GREET); assert.equal(ap[1].params.text, '(시스템: 판 글)');
  assert.equal(V._calls.get('cid0abcdef').meetOn, false, '판 글 꼴이 아닌 rtc_say 는 첫 판을 쓰지 않음(미팅 아닌 통화 그대로)');
  // 끊기 → realtime/stop · 프로세스 끝 · poll 은 closed
  assert.deepEqual(await V.handle('rtc_stop', { cid: 'cid0abcdef' }, w.deps), { ok: true, turns: 1 });
  assert.ok(w.lines().some(l => l.method === 'thread/realtime/stop'));
  assert.equal((await V.handle('rtc_poll', { cid: 'cid0abcdef' }, w.deps)).state, 'closed');
  assert.equal(V._calls.size, 0);
});

test('사람 말 없이 모델이 넘기려 하면 기기에서 거절(서버에 안 감) · 미팅은 첫인사 안 함', async () => {
  const w = world('nosay');
  await V.handle('rtc_start', { cid: 'cid1abcdef', sdp: OFFER, pane: '%1', meet: true }, w.deps);
  const r8 = await until(() => w.lines().find(l => l.id === 8 && !l.method));
  assert.equal(r8.result.success, false); assert.match(r8.result.contentItems[0].text, /방금 말한 부탁이 없어/);
  assert.equal(w.calls.filter(c => c.op === 'handoff').length, 0);
  await V.handle('rtc_note', { cid: 'cid1abcdef', k: 'connected' }, w.deps);
  await sleep(100);
  assert.equal(w.lines().filter(l => l.method === 'thread/realtime/appendText').length, 0);
  const SAY = { text: '판 글', first: '판 글 + 판 목록', firstSaid: '이어 가기' };
  await V.handle('rtc_say', { cid: 'cid1abcdef', ...SAY }, w.deps);
  await V.handle('rtc_say', { cid: 'cid1abcdef', ...SAY }, w.deps);
  const aps = await until(() => { const x = w.lines().filter(l => l.method === 'thread/realtime/appendText'); return x.length === 2 && x; });
  assert.deepEqual(aps.map(x => x.params.text), ['판 글 + 판 목록', '판 글']);
  await V.handle('rtc_stop', { cid: 'cid1abcdef' }, w.deps);
});

test('시작 실패: 로그인 없음 · SDP 꼴 · 같은 id · 동시 3개 넘음 · 화면이 끊긴 통화는 reap 이 닫음', async () => {
  const w = world();
  await assert.rejects(V.handle('rtc_start', { cid: 'cid2abcdef', sdp: OFFER }, { ...w.deps, env: { ...w.env, CODEX_HOME: path.join(w.H, 'none') } }), /로그인이 없어요/);
  await assert.rejects(V.handle('rtc_start', { cid: 'cid2abcdef', sdp: 'nope' }, w.deps), /SDP 꼴/);
  await assert.rejects(V.handle('rtc_poll', { cid: '../x' }, w.deps), /통화 id/);
  for (const c of ['cidAaaaaaa', 'cidBbbbbbb', 'cidCccccccc']) await V.handle('rtc_start', { cid: c, sdp: OFFER }, w.deps);
  await assert.rejects(V.handle('rtc_start', { cid: 'cidAaaaaaa', sdp: OFFER }, w.deps), e => e.code === 2 && /같은 통화 id/.test(e.message));
  await assert.rejects(V.handle('rtc_start', { cid: 'cidDdddddd', sdp: OFFER }, w.deps), e => e.code === 2 && /3개까지/.test(e.message));
  await V.stopAll();
  assert.equal(V._calls.size, 0);
  // 화면이 끊긴 통화는 reap 이 닫음
  await V.handle('rtc_start', { cid: 'cidEeeeeee', sdp: OFFER }, w.deps);
  V.reap(Date.now() + V.IDLE_KILL_MS + 1000);
  assert.equal(V._calls.size, 0);
  assert.deepEqual(await V.handle('rtc_say', { cid: 'cidEeeeeee', text: 'x' }, w.deps), { ok: false });
});

test('app-server 가 바로 끝나면 시작 실패 · 자리를 비움', async () => {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-voice-x-')), CH = path.join(H, 'ch');
  fs.mkdirSync(CH); fs.writeFileSync(path.join(CH, 'auth.json'), '{}');
  const bin = path.join(H, 'codex'); fs.writeFileSync(bin, `#!${process.execPath}\nprocess.exit(1)\n`, { mode: 0o755 });
  await assert.rejects(V.handle('rtc_start', { cid: 'cidFffffff', sdp: OFFER }, { server: async () => ({}), env: { ...process.env, BOARDER_CODEX: bin, CODEX_HOME: CH } }), /app-server 끝남|답 없음|끝났어요/);
  assert.equal(V._calls.size, 0);
});

test('screenCmd · statusText: 주인 tool_screen · tool_status 와 같은 규칙', () => {
  assert.deepEqual(V.screenCmd({ action: 'open_thread', thread: '1700000000.123456' }), [{ action: 'open_thread', thread: '1700000000.123456', channel: 'primary' }, true]);
  assert.deepEqual(V.screenCmd({ action: 'open_canvas', canvas: 'https://x/art/AbCdEfGhIjKlMnOp12/' }), [{ action: 'open_canvas', canvas: 'AbCdEfGhIjKlMnOp12' }, true]);
  assert.equal(V.screenCmd({ action: 'point', x: 120, y: 3 })[1], false);
  assert.equal(V.screenCmd({ action: 'rm -rf' })[1], false);
  const t = V.statusText([{ id: 'a-1', name: '매출 보고', at: 0, state: 'working', kind: '진행', line: '통화 넘김 a-1 하는 중', text: '보고서' }], '', 120_000);
  assert.equal(t, 'a-1 → 매출 보고 2분 전: 진행 중 · [진행] 통화 넘김 a-1 하는 중 · 넘긴 글: 보고서');
  assert.equal(V.statusText([], ''), '이 통화에서 넘긴 일이 아직 없어요');
});

function fakeHook(over = {}) {
  const got = [];
  const rec = n => async (...a) => { got.push([n, ...a]); return over[n]?.(...a); };
  const hook = { got };
  for (const n of ['start', 'started', 'turn', 'delegate', 'tool', 'handoff', 'handed', 'answered', 'ended']) hook[n] = rec(n);
  return hook;
}
test('기기 고리: 지시문 · cwd · 더한 도구 · thread/realtime 칸 · 미팅 첫인사 · 받아쓴 말 · 위임 글 · 더한 도구 답 · 덱 넘김 · 끝', async () => {
  const w = world('hook');
  const hook = fakeHook({
    start: () => ({ instructions: '주인 지시문 + 노드 맥락', cwd: w.H, tools: [{ type: 'function', name: 'deck_item', description: 'd', inputSchema: { type: 'object' } }],
      thread: { config: { model_reasoning_effort: 'low' } }, realtime: { delegationAckFiller: false }, greet: '(시스템: 싱크 첫 안건)' }),
    tool: (c, name, a) => [`덱 ${a.id} 원문`, true],
    handoff: (c, { text }) => text === '덱 질문' ? { answer: '(넘기지 않음 — 덱 원문으로 바로 답하세요) A5 원문' } : { deck: ' · 덱 A5: 첫 화면', refs: ['A5'] },
  });
  await V.handle('rtc_start', { cid: 'cidHook0001', sdp: OFFER, pane: '%42', name: '보더', meet: true, art: 'hbXzM4RUr6SrHKSUHVMHcRT7', instructions: '서버 지시문' }, { ...w.deps, hook });
  const L = w.lines(), m = n => L.find(x => x.method === n);
  const ts = m('thread/start').params, rs = m('thread/realtime/start').params;
  assert.equal(ts.baseInstructions, '주인 지시문 + 노드 맥락\n\n' + V.NO_SECRETS);
  assert.deepEqual(ts.dynamicTools.map(t => t.name), ['handoff', 'handoff_status', 'screen', 'deck_item']);
  assert.deepEqual([ts.config, ts.sandbox, ts.cwd, rs.delegationAckFiller, rs.prompt], [{ model_reasoning_effort: 'low' }, 'read-only', w.H, false, ts.baseInstructions]);
  assert.equal(hook.got[0][1].art, 'hbXzM4RUr6SrHKSUHVMHcRT7');
  const res = await until(() => { const x = w.lines().filter(l => [8, 11, 12].includes(l.id) && !l.method); return x.length === 3 && x; });
  const by = id => res.find(x => x.id === id).result;
  assert.deepEqual(by(11), { contentItems: [{ type: 'inputText', text: '덱 A5 원문' }], success: true });
  assert.deepEqual(by(12), { contentItems: [{ type: 'inputText', text: '(넘기지 않음 — 덱 원문으로 바로 답하세요) A5 원문' }], success: true });
  const hs = w.calls.filter(c => c.op === 'handoff');
  assert.equal(hs.length, 1, '덱 물음은 서버로 안 감');
  assert.equal(hs[0].deck, '· 덱 A5: 첫 화면');
  await until(() => hook.got.some(g => g[0] === 'handed') && hook.got.some(g => g[0] === 'delegate'));
  const handed = hook.got.find(g => g[0] === 'handed')[2];
  assert.deepEqual([handed.refs, handed.handoff.id, handed.ok, handed.text], [['A5'], 'cid0-1', true, '이번 주 보고서 정리']);
  assert.equal(hook.got.find(g => g[0] === 'delegate')[2], '<input>에이 오 자세히</input>');
  assert.equal(hook.got.find(g => g[0] === 'turn')[2].text, '메인 봇에 이번 주 보고서 정리 부탁해');
  assert.ok(hook.got.some(g => g[0] === 'started' && g[1].cid === 'cidHook0001'));
  // 미팅이어도 고리 첫인사 글이 있으면 connected 에 그 글(싱크 덱 미팅 — server.py SYNC_GREET)
  await V.handle('rtc_note', { cid: 'cidHook0001', k: 'connected' }, w.deps);
  const ap = await until(() => w.lines().find(l => l.method === 'thread/realtime/appendText'));
  assert.equal(ap.params.text, '(시스템: 싱크 첫 안건)');
  const SAY = { text: '(시스템: 판 글 — 지금 바로 말한다)', first: '(시스템: 판 글 — 지금 바로 말한다 판 목록 「A / B」.)', firstSaid: '(시스템: 판 글 — 이미 첫 안건을 말했으면 다시 말하지 말고 이어 간다 판 목록 「A / B」.)' };
  await V.handle('rtc_say', { cid: 'cidHook0001', ...SAY }, w.deps);
  await V.handle('rtc_say', { cid: 'cidHook0001', ...SAY }, w.deps);
  const aps = await until(() => { const x = w.lines().filter(l => l.method === 'thread/realtime/appendText'); return x.length === 3 && x; });
  assert.deepEqual(aps.slice(1).map(x => x.params.text), [SAY.firstSaid, SAY.text]);
  // 넘긴 일에 답이 오면 answered
  await V.handle('rtc_poll', { cid: 'cidHook0001' }, w.deps);
  await until(() => hook.got.some(g => g[0] === 'answered'));
  assert.equal(hook.got.find(g => g[0] === 'answered')[2].line, '통화 넘김 cid0-1 보고서 쓰는 중');
  await V.handle('rtc_stop', { cid: 'cidHook0001' }, w.deps);
  await until(() => hook.got.some(g => g[0] === 'ended'));
  assert.equal(hook.got.find(g => g[0] === 'ended')[2], '');
});

test('기기 고리 오류 · 늦음은 통화를 막지 않음: start 가 던지면 서버 지시문 그대로 · 도구 고리가 던지면 모르는 도구 · reap 은 까닭과 함께 ended', async () => {
  const w = world('hook');
  const hook = fakeHook({ start: () => { throw new Error('파이썬 없음'); }, tool: () => { throw new Error('x'); }, handoff: () => { throw new Error('y'); }, turn: () => { throw new Error('z'); } });
  await V.handle('rtc_start', { cid: 'cidHook0002', sdp: OFFER, pane: '%42', meet: true, instructions: '서버 지시문' }, { ...w.deps, hook });
  const ts = w.lines().find(x => x.method === 'thread/start').params;
  assert.equal(ts.baseInstructions, '서버 지시문\n\n' + V.NO_SECRETS);
  assert.deepEqual(ts.dynamicTools.map(t => t.name), ['handoff', 'handoff_status', 'screen']);
  assert.equal(ts.config, undefined);
  const res = await until(() => { const x = w.lines().filter(l => [8, 11, 12].includes(l.id) && !l.method); return x.length === 3 && x; });
  assert.match(res.find(x => x.id === 11).result.contentItems[0].text, /모르는 도구 deck_item/);
  await until(() => w.calls.filter(c => c.op === 'handoff').length === 2);   // 고리가 던지면 덱 판정 없이 그대로 넘김(덱 물음도)
  assert.ok(w.calls.filter(c => c.op === 'handoff').every(c => !('deck' in c)));
  // 미팅 · 고리 첫인사 없음 → 첫인사 안 함(회원 미팅과 같음)
  await V.handle('rtc_note', { cid: 'cidHook0002', k: 'connected' }, w.deps);
  await sleep(100);
  assert.equal(w.lines().filter(l => l.method === 'thread/realtime/appendText').length, 0);
  V.reap(Date.now() + V.IDLE_KILL_MS + 1000);
  await until(() => hook.got.some(g => g[0] === 'ended'));
  assert.equal(hook.got.find(g => g[0] === 'ended')[2], '화면이 끊겨 닫음');
});

// 넘김 판정은 한 시계(받아쓴 말 순번 + 기기 시계): Worker 가 찍은 handoff.at 과 견주지 않음 — 시계가 어긋나거나 넘김이 오가는 동안 말해도 정상 넘김은 통과,
// 사람 말 없이 맥락만이면 거절 그대로(한 말로 두 번 넘기지 않음)
async function clockCall(cid, skew, delay = 0) {
  const w = world('nosay');   // 가짜 codex 는 사람 말 없이 넘김 하나(id 8)만 — 아래는 runTool 을 바로 부름
  await V.handle('rtc_start', { cid, sdp: OFFER, pane: '%1' }, w.deps);
  await until(() => w.lines().find(l => l.id === 8 && !l.method));
  const c = V._calls.get(cid), sent = [];
  let gate = null;
  c.server = async (op, body) => {
    if (op !== 'handoff') return { ok: true };
    sent.push(body);
    if (delay) await new Promise(r => { gate = r; setTimeout(r, delay); });
    return { ok: true, text: '넣음', handoff: { id: `${cid.slice(0, 4)}-${sent.length}`, pane: '%1', name: 'Primary', at: Date.now() + skew, state: 'in' } };   // Worker 시계(skew 만큼 어긋남)
  };
  const say = text => c.line(JSON.stringify({ method: 'thread/realtime/transcript/done', params: { role: 'user', text } }));
  const hand = text => c.runTool('handoff', { to: 'primary', text });
  return { c, sent, say, hand, release: () => gate?.() };
}
for (const skew of [60_000, -60_000]) test(`넘김 판정 한 시계: Worker 시계가 ${skew > 0 ? '+' : ''}${skew / 1000}초 어긋나도 새 말 뒤 넘김은 통과 · 같은 말로 두 번은 거절`, async () => {
  const k = await clockCall(skew > 0 ? 'cidClkP001' : 'cidClkM001', skew);
  k.say('첫 부탁');
  assert.deepEqual(await k.hand('첫 일'), ['넣음', true]);
  const again = await k.hand('맥락만 보고 또');   // 새 사람 말 없음(Worker 시계가 늦어도 첫 말을 다시 쓰지 않음)
  assert.equal(again[1], false); assert.match(again[0], /방금 말한 부탁이 없어/);
  k.say('둘째 부탁');   // Worker 시계가 앞서도(옛: 넘김 at 이 이 말보다 늦게 찍혀 거절) 통과
  assert.deepEqual(await k.hand('둘째 일'), ['넣음', true]);
  assert.deepEqual(k.sent.map(b => b.said), ['첫 부탁', '둘째 부탁']);
});
test('넘김 판정 한 시계: 넘김이 오가는 동안 한 말은 다음 넘김에 씀 · 오래된 말(기기 시계 SAID_MS 넘음)은 거절', async () => {
  const k = await clockCall('cidClkF001', 0, 300);
  k.say('첫 부탁');
  const p1 = k.hand('첫 일');
  await until(() => k.sent.length === 1);
  k.say('가는 동안 둘째 부탁');   // 서버가 아직 답하기 전(그 뒤 Worker 가 at 을 찍음)
  assert.deepEqual(await p1, ['넣음', true]);
  assert.deepEqual(k.sent[0].said, '첫 부탁', '넘김을 보낸 뒤 한 말은 그 넘김에 안 붙음');
  const p2 = k.hand('둘째 일'); k.release();
  assert.deepEqual(await p2, ['넣음', true]);
  assert.equal(k.sent[1].said, '가는 동안 둘째 부탁');
  k.say('셋째 부탁'); k.c.turns.at(-1).at -= V.SAID_MS + 1000;   // 기기 시계로 90초 넘은 말
  const old = await k.hand('셋째 일');
  assert.equal(old[1], false); assert.equal(k.sent.length, 2);
});
