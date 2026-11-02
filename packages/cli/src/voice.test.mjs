// node --test packages/cli/src/voice.test.mjs
// 회원 통화: 데몬 동사 rtc_start · rtc_poll · rtc_note · rtc_say · rtc_stop 이 그 기기 codex app-server 와 주인 쪽 통화와 같은 말(JSON-RPC 한 줄씩)로 주고받는지.
// codex 는 가짜 스크립트(받은 줄을 파일에 적고, 정해 둔 알림 · 도구 부름을 보냄) — 진짜 Codex · ChatGPT 로그인 · OpenAI 에는 안 닿음. 글 · id 는 다 지어낸 것
import { test } from 'node:test';
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
      if (${JSON.stringify(mode)} === 'say') out({ method: 'thread/realtime/transcript/done', params: { role: 'user', text: '메인 봇에 이번 주 보고서 정리 부탁해' } });
      out({ id: 7, method: 'item/tool/call', params: { tool: 'screen', arguments: JSON.stringify({ action: 'open_channel', channel: '#notes' }) } });
      out({ id: 8, method: 'item/tool/call', params: { tool: 'handoff', arguments: { to: 'primary', text: '이번 주 보고서 정리' } } });
      out({ id: 9, method: 'item/tool/call', params: { tool: 'screen', arguments: { action: 'focus', region: { x0: 50, y0: 0, x1: 10, y1: 5 } } } });
      out({ id: 10, method: 'item/commandExecution/requestApproval', params: {} });
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
  const lines = () => fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  return { H, env, server, calls, lines, deps: { server, env, home: H } };
}
const OFFER = 'v=0\r\no=offer';

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
