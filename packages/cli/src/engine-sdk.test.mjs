// node --test packages/cli/src/engine-sdk.test.mjs
// SDK 엔진(BYOS): 가짜 Agent SDK · Codex SDK 를 넣어 여섯 동사 + 계정 둘 + 데몬 윈도우 작업 파일을 시험. 진짜 구독 로그인은 쓰지 않음.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import http from 'node:http';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-sdk-'));
process.env.BOARDER_HOME = path.join(home, 'cfg');
const S = await import('./engine/sdk.mjs');
const { winLauncher, winTaskArgs, installWindows } = await import('./engine/daemon.mjs');
const I = await import('./engine/index.mjs');
const cfg = { sdk: { accounts: {} } };
const wait = async (f, ms = 2000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

let calls;
function fakeClaude() {
  let n = 0;
  return { query({ prompt, options }) {
    calls.push({ p: 'claude', prompt, options });
    const sid = options.resume || `cs-${++n}`;
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: sid };
      await new Promise(r => setTimeout(r, 30));
      if (options.abortController.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok:' + prompt, session_id: sid };
    })();
  } };
}
function fakeCodex() {
  let n = 0;
  class Thread { constructor(id, o) { this.id = id; this.o = o; } async runStreamed(text) { const t = this; calls.push({ p: 'codex', text, id: t.id, opt: t.o, env: t.env }); return { events: (async function* () { if (!t.id) t.id = `th-${++n}`; yield { type: 'thread.started', thread_id: t.id }; await new Promise(r => setTimeout(r, 30)); yield { type: 'turn.completed' }; })() }; } }
  class Codex { constructor(o) { this.env = o?.env; calls.push({ p: 'codex-new', home: o?.env?.CODEX_HOME }); } startThread(o) { return new Thread(null, o); } resumeThread(id, o) { return new Thread(id, o); } }
  return { Codex };
}
beforeEach(() => { calls = []; S._reset(); S._inject.claude = fakeClaude(); S._inject.codex = fakeCodex(); S._inject.loggedIn = () => true; fs.rmSync(path.join(process.env.BOARDER_HOME, 'sdk-windows.json'), { force: true }); });

test('로그인: 계정을 안 고른 창은 기본 로그인 → 로그인된 이름 있는 계정 → 없으면 이유를 말하고 안 엶', async () => {
  const c = { sdk: { accounts: {} } };
  fs.mkdirSync(path.join(home, 'cfg', 'sdk-accounts', 'claude', 'me'), { recursive: true });
  S._inject.loggedIn = () => false;
  await assert.rejects(S.open(c, { id: 'ew_nl1', name: 'nl', cwd: path.join(home, 'wnl'), prompt: 'x' }), /로그인되지 않았어요/);
  assert.equal(S.state(c, 'ew_nl1').state, 'none', '안 열림');
  S._inject.loggedIn = (prov, folder) => folder.endsWith(path.join('claude', 'me'));
  const o = await S.open(c, { id: 'ew_nl2', name: 'nl2', cwd: path.join(home, 'wnl2'), prompt: 'x' });
  assert.equal(o.account, 'me');
  assert.equal(calls[0].options.env.CLAUDE_CONFIG_DIR, path.join(home, 'cfg', 'sdk-accounts', 'claude', 'me'));
  S._inject.loggedIn = () => true;
  const d = await S.open(c, { id: 'ew_nl3', name: 'nl3', cwd: path.join(home, 'wnl3'), prompt: 'x' });
  assert.ok(!d.account, '기본 로그인이 있으면 계정을 안 씌움');
});

test('Codex 창(자동 허용)은 작업 폴더 샌드박스에서도 네트워크를 켬 — 답 명령(boarder chat)이 보더에 닿게', async () => {
  const c = { sdk: { accounts: {} } };
  await S.open(c, { id: 'ew_net1', name: 'net', cwd: path.join(home, 'wnet1'), prompt: 'hi', provider: 'codex', perm: 'auto' });
  await wait(() => calls.some(x => x.p === 'codex'));
  const t = calls.find(x => x.p === 'codex');
  assert.equal(t.opt.sandboxMode, 'workspace-write'); assert.equal(t.opt.networkAccessEnabled, true);
});

test('구독을 안 정한 창: Claude 로그인이 없고 ChatGPT 로그인이 있으면 Codex 로 엶(모델 · 대화 id 버림) · 정한 창은 그대로 오류', async () => {
  const c = { sdk: { accounts: {} } };
  S._inject.loggedIn = prov => prov === 'codex';
  const o = await S.open(c, { id: 'ew_fb1', name: 'fb', cwd: path.join(home, 'wfb1'), prompt: 'hi', model: 'claude-opus-5-5', session_id: '11111111-2222-3333-4444-555555555555' });
  assert.equal(o.provider, 'codex');
  await wait(() => calls.some(x => x.p === 'codex'));
  const t = calls.find(x => x.p === 'codex');
  assert.equal(t.id, null, '새 대화(startThread) — 가짜 id 로 resumeThread 안 함'); assert.equal(t.opt.model, undefined, 'Claude 모델 이름을 Codex 에 안 넘김');
  await assert.rejects(S.open(c, { id: 'ew_fb2', name: 'fb2', cwd: path.join(home, 'wfb2'), prompt: 'x', provider: 'claude' }), /Claude 계정이 아직 로그인되지 않았어요/, '서버가 claude 로 정한 창은 바꾸지 않음');
  S._inject.loggedIn = () => false;
  await assert.rejects(S.open(c, { id: 'ew_fb3', name: 'fb3', cwd: path.join(home, 'wfb3'), prompt: 'x' }), e => /구독 계정이 아직 로그인되지 않았어요/.test(e.message) && /ChatGPT 나 Claude/.test(e.message), '둘 다 없으면 어느 쪽이든 로그인하라고 안내');
});

test('Codex 가 모르는 대화 id(no rollout found)면 새 대화로 한 번 더 — 같은 가짜 id 로 되풀이하지 않음', async () => {
  const c = { sdk: { accounts: {} } };
  const ids = [];
  class Thread { constructor(id) { this.id = id; } async runStreamed() { const t = this; ids.push(t.id); if (t.id === 'fake-uuid') throw new Error('thread/resume failed: no rollout found for thread id fake-uuid'); return { events: (async function* () { if (!t.id) t.id = 'th-new'; yield { type: 'thread.started', thread_id: t.id }; yield { type: 'turn.completed' }; })() }; } }
  S._inject.codex = { Codex: class { startThread() { return new Thread(null); } resumeThread(id) { return new Thread(id); } } };
  await S.open(c, { id: 'ew_nr1', name: 'nr', cwd: path.join(home, 'wnr1'), prompt: 'hi', provider: 'codex', session_id: 'fake-uuid' });
  await wait(() => S.state(c, 'ew_nr1').state !== 'busy' && ids.length >= 2);
  assert.deepEqual(ids, ['fake-uuid', null], '두 번째는 새 대화(startThread)');
  assert.ok(!S.state(c, 'ew_nr1').error, '오류 없이 끝남');
  assert.equal(S.state(c, 'ew_nr1').session_id, 'th-new');
});

test('되살린 창(계정 비어 있음)도 글마다 로그인된 계정을 고름 · 없으면 이유가 state.error 에', async () => {
  const c = { sdk: { accounts: {} } };
  fs.mkdirSync(path.join(home, 'cfg', 'sdk-accounts', 'claude', 'me'), { recursive: true });
  S._inject.loggedIn = (prov, folder) => folder.endsWith(path.join('claude', 'me'));
  const o = await S.open(c, { id: 'ew_ra1', name: 'ra', cwd: path.join(home, 'wra'), prompt: 'x', account: 'me' });
  assert.equal(o.account, 'me');
  const reg = path.join(process.env.BOARDER_HOME, 'sdk-windows.json');
  const j = JSON.parse(fs.readFileSync(reg, 'utf8')); j.ew_ra1.account = null; j.ew_ra1.config_dir = null; fs.writeFileSync(reg, JSON.stringify(j));   // 계정이 비어 있는 옛 파일
  S._reset();   // 데몬이 다시 뜸: 파일에서 되살림
  const w = S.list(c).find(x => x.id === 'ew_ra1'); assert.ok(w);
  calls = [];
  await S.send(c, 'ew_ra1', 'again');
  await wait(() => S.state(c, 'ew_ra1').state !== 'busy');
  assert.equal(calls[0].options.env.CLAUDE_CONFIG_DIR, path.join(home, 'cfg', 'sdk-accounts', 'claude', 'me'), '비어 있던 계정을 로그인된 것으로 채움');
  S._inject.loggedIn = () => false; S._reset();
  const j2 = JSON.parse(fs.readFileSync(reg, 'utf8')); j2.ew_ra1.account = null; j2.ew_ra1.config_dir = null; fs.writeFileSync(reg, JSON.stringify(j2)); S._reset();
  await S.send(c, 'ew_ra1', 'again2').catch(() => {});
  await wait(() => S.state(c, 'ew_ra1').state !== 'busy');
  assert.match(S.state(c, 'ew_ra1').error || '', /로그인되지 않았어요/);
});

test('agentEnv: ~/.local/bin 이 PATH 에 없으면 뒤에 붙임, 있으면 그대로, 폴더가 없으면 안 건드림', () => {
  const bin = path.join('/h', '.local', 'bin');
  const yes = () => true, no = () => false;
  assert.deepEqual(S.agentEnv({ PATH: '/usr/bin' }, { home: '/h', exists: yes, sep: ':' }), { PATH: '/usr/bin:' + bin });
  assert.deepEqual(S.agentEnv({ PATH: '/x:' + bin + ':/usr/bin' }, { home: '/h', exists: yes, sep: ':' }), {});
  assert.deepEqual(S.agentEnv({ PATH: '/usr/bin' }, { home: '/h', exists: no, sep: ':' }), {});
  assert.deepEqual(S.agentEnv({ Path: 'C:\\X;' + bin.toUpperCase() + '/;C:\\Y' }, { home: '/h', exists: yes, sep: ';' }), {}, '대소문자 · 끝 슬래시를 무시하고 이미 있으면 안 붙임');
  assert.deepEqual(S.agentEnv({ Path: 'C:\\Windows' }, { home: '/h', exists: yes, sep: ';' }), { Path: 'C:\\Windows;' + bin }, '윈도우는 Path 대소문자 그대로');
});

test('이어 붙일 대화가 없는 창(로그인 전 실패 뒤)은 새 대화로 다시 시작', async () => {
  const seen = [];
  S._inject.claude = { query({ prompt, options }) {
    seen.push(options.resume || null);
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'real-1' };
      if (options.resume) { yield { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'No conversation found with session ID: ghost-1', session_id: 'x' }; return; }
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 'real-1' };
    })();
  } };
  const c = { sdk: { accounts: {} } };
  const o = await S.open(c, { id: 'ew_gh1', name: 'gh', cwd: path.join(home, 'wgh'), prompt: 'x', session_id: 'ghost-1' });
  await wait(() => S.state(c, 'ew_gh1').state !== 'busy');
  assert.deepEqual(seen, ['ghost-1', null], '처음엔 이어 붙이려다 실패 → 새 대화로 한 번 더');
  const st = S.state(c, 'ew_gh1');
  assert.ok(!st.error, '오류가 안 남음'); assert.equal(st.session_id, 'real-1');
});

test('claude: 권한 모드 — auto 는 permissionMode auto, ask 는 기본(허락 없는 도구는 막힘)', async () => {
  await S.open(cfg, { id: 'ew_pa', name: 'pa', cwd: path.join(home, 'wpa'), prompt: 'x', perm: 'auto' });
  assert.equal(calls[0].options.permissionMode, 'auto');
  assert.ok(!calls[0].options.allowDangerouslySkipPermissions);
  calls = [];
  await S.open(cfg, { id: 'ew_pk', name: 'pk', cwd: path.join(home, 'wpk'), prompt: 'x', perm: 'ask' });
  assert.equal(calls[0].options.permissionMode, undefined);
});

test('claude: open → state → send → park → reopen(같은 대화) → close', async () => {
  const o = await S.open(cfg, { id: 'ew_c1', name: 'one', cwd: path.join(home, 'w1'), prompt: 'hello', perm: 'bypass', system: 'sys' });
  assert.equal(o.session_id, 'cs-1');
  assert.equal(calls[0].options.permissionMode, 'bypassPermissions');
  assert.equal(calls[0].options.env.BOARDER_WINDOW, 'ew_c1');
  assert.equal(S.state(cfg, 'ew_c1').state, 'busy');
  await assert.rejects(S.send(cfg, 'ew_c1', 'x'), e => e.code === 2);   // 턴 중이면 바쁨
  await wait(() => S.state(cfg, 'ew_c1').state === 'idle');
  await S.send(cfg, 'ew_c1', 'second');
  assert.equal(calls[1].options.resume, 'cs-1');
  await wait(() => S.state(cfg, 'ew_c1').state === 'idle');
  const { handle } = await S.park(cfg, 'ew_c1');
  assert.equal(handle.session_id, 'cs-1'); assert.equal(handle.engine, 'sdk');
  assert.equal(S.state(cfg, 'ew_c1').state, 'none');
  const r = await S.reopen(cfg, handle, 'back', 'ew_c1');
  assert.equal(r.session_id, 'cs-1');
  assert.equal(calls.at(-1).options.resume, 'cs-1'); assert.equal(calls.at(-1).prompt, 'back');
  await wait(() => S.state(cfg, 'ew_c1').state === 'idle');
  assert.deepEqual(await S.close(cfg, 'ew_c1'), { ok: true });
  assert.equal(S.state(cfg, 'ew_c1').state, 'none');
  assert.deepEqual(await S.close(cfg, 'ew_c1'), { ok: true, gone: true });
  await assert.rejects(S.send(cfg, 'ew_nope', 'x'), e => e.code === 4);
});

test('claude 계정 둘: account 로 CLAUDE_CONFIG_DIR 가 갈리고, 이름만 상태에 나감(폴더 · 로그인 값 없음)', async () => {
  const a = await S.open(cfg, { id: 'ew_a', cwd: path.join(home, 'wa'), prompt: 'a', account: 'work' });
  const b = await S.open(cfg, { id: 'ew_b', cwd: path.join(home, 'wb'), prompt: 'b', account: 'personal' });
  assert.equal(a.account, 'work'); assert.equal(b.account, 'personal');
  const da = calls[0].options.env.CLAUDE_CONFIG_DIR, db = calls[1].options.env.CLAUDE_CONFIG_DIR;
  assert.notEqual(da, db); assert.match(da, /sdk-accounts[\\/]claude[\\/]work$/); assert.match(db, /sdk-accounts[\\/]claude[\\/]personal$/);
  assert.equal(S.state(cfg, 'ew_a').account, 'work');
  assert.ok(!JSON.stringify(S.state(cfg, 'ew_a')).includes(da));
  const c2 = { sdk: { accounts: { claude: { team: path.join(home, 'teamdir') } } } };
  await S.open(c2, { id: 'ew_t', cwd: path.join(home, 'wt'), prompt: 't', account: 'team' });
  assert.equal(calls.at(-1).options.env.CLAUDE_CONFIG_DIR, path.join(home, 'teamdir'));
  await assert.rejects(S.open(cfg, { id: 'ew_bad', cwd: home, account: '../x' }), e => e.code === 1);
});

test('codex: 계정 둘(CODEX_HOME) · 같은 thread 로 이어 열기', async () => {
  const a = await S.open(cfg, { id: 'ew_x1', cwd: path.join(home, 'x1'), prompt: 'hi', provider: 'codex', account: 'a1' });
  await S.open(cfg, { id: 'ew_x2', cwd: path.join(home, 'x2'), prompt: 'hi', provider: 'codex', account: 'a2' });
  const homes = calls.filter(c => c.p === 'codex-new').map(c => c.home);
  assert.equal(homes.length, 2); assert.notEqual(homes[0], homes[1]); assert.match(homes[0], /sdk-accounts[\\/]codex[\\/]a1$/);
  assert.equal(a.session_id, 'th-1');
  await wait(() => S.state(cfg, 'ew_x1').state === 'idle');
  const { handle } = await S.park(cfg, 'ew_x1');
  assert.equal(handle.provider, 'codex'); assert.equal(handle.session_id, 'th-1');
  const r = await S.reopen(cfg, handle, 'again', 'ew_x1');
  assert.equal(r.session_id, 'th-1');
  assert.equal(calls.filter(c => c.p === 'codex').at(-1).id, 'th-1');
  assert.equal(S.list(cfg).length, 2);
  assert.equal(S.list(cfg)[0].meta.provider, 'codex');
});

test('codex: 메인 봇 지시는 첫 턴과 이어 보낸 턴에도 전달', async () => {
  const system = '이 사람의 메인 봇입니다. boarder chat 으로 답하세요.';
  await S.open(cfg, { id: 'ew_sys', cwd: home, provider: 'codex', system, prompt: '첫 인사' });
  await wait(() => S.state(cfg, 'ew_sys').state === 'idle');
  await S.send(cfg, 'ew_sys', '안녕');
  await wait(() => S.state(cfg, 'ew_sys').state === 'idle');
  const turns = calls.filter(c => c.p === 'codex');
  assert.ok(turns.every(c => c.text.includes(system)));
  assert.ok(turns[0].text.endsWith('첫 인사'));
  assert.ok(turns[1].text.endsWith('안녕'));
  S._reset();
  S._inject.codex.Codex.prototype.resumeThread = function(id, o) { return this.startThread(o); };
  await S.send(cfg, 'ew_sys', '데몬 다시 시작 뒤');
  await wait(() => S.state(cfg, 'ew_sys').state === 'idle');
  assert.ok(calls.filter(c => c.p === 'codex').at(-1).text.includes(system));
});

test('codex: SDK 최종 답을 원 Primary 스레드로 게시하고 명시적 답은 중복하지 않음', async () => {
  const T = await import('./turn.mjs');
  const C = await import('./config.mjs');
  const posts = [];
  let fail = 0;
  const srv = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url === '/api/device/window') res.end(JSON.stringify({ token: 'test-window' }));
    else { posts.push({ url: req.url, body: JSON.parse(body) }); res.statusCode = fail; if (fail === 503) fail = 200; res.end('{"ok":true}'); }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  C.saveDevice({ token: 'test-device', device_id: 'test-sdk', server: `http://127.0.0.1:${srv.address().port}` });
  let explicit = false;
  let finalText = '안녕하세요!';
  S._inject.codex = { Codex: class { startThread() { return { runStreamed: async () => ({ events: (async function* () {
    yield { type: 'thread.started', thread_id: 'sdk-reply' };
    if (explicit) T.recordReply(['ew_reply'], 'chat_say', { thread: '1793940000.000001', text: '이미 답함' });
    yield { type: 'item.completed', item: { type: 'command_execution', aggregated_output: '도구의 비공개 출력은 답에 넣지 않음' } };
    yield { type: 'item.completed', item: { type: 'agent_message', text: finalText } };
    yield { type: 'turn.completed' };
  })() }) }; } } };
  const prompt = '[보드 · Primary · 스레드 1793940000.000001] [Boarder chat] 안녕\n첨부 본문: ' + '긴 첨부'.repeat(20000);
  try {
    fail = 200;
    await S.open(cfg, { id: 'ew_reply', cwd: home, provider: 'codex' });
    await S.send(cfg, 'ew_reply', prompt);
    await wait(() => S.state(cfg, 'ew_reply').state === 'idle', 6000);
    assert.deepEqual(posts, [{ url: '/api/agent/chat_say', body: { text: '안녕하세요!', thread: '1793940000.000001' } }]);
    explicit = true;
    await S.send(cfg, 'ew_reply', prompt);
    await wait(() => S.state(cfg, 'ew_reply').state === 'idle', 6000);
    assert.equal(posts.length, 1, 'boarder chat 으로 이미 답한 턴은 다시 게시하지 않음');
    explicit = false; fail = 503;
    finalText = 'Bearer sk-' + 'a'.repeat(40) + '\n' + '긴 답'.repeat(20000);
    await S.send(cfg, 'ew_reply', prompt);
    await wait(() => S.state(cfg, 'ew_reply').state === 'idle', 6000);
    assert.equal(posts.length, 3, '명시적 503 거절 뒤 같은 최종 답을 한 번 다시 게시');
    assert.ok(posts.at(-1).body.text.length <= 3000);
    assert.ok(!posts.at(-1).body.text.includes('a'.repeat(40)), '기존 비밀값 가림 재사용');
    assert.ok(!JSON.stringify(posts).includes('도구의 비공개 출력'));
    fail = 403;
    await S.send(cfg, 'ew_reply', prompt);
    await wait(() => S.state(cfg, 'ew_reply').state === 'idle', 6000);
    assert.match(S.state(cfg, 'ew_reply').error || '', /보더에 답을 게시하지 못했어요/);
    assert.equal(posts.length, 4, '영구 거절은 다시 보내지 않고 상태 오류로 남김');
  } finally { await new Promise(r => srv.close(r)); fs.rmSync(path.join(process.env.BOARDER_HOME, 'device.json'), { force: true }); }
});

test('SDK 가 없으면 창을 만들기 전에 친절한 오류, 한도 글은 state.limit', async () => {
  S._inject.claude = null;
  await assert.rejects(S.open(cfg, { id: 'ew_n', cwd: home, prompt: 'x' }), e => e.code === 1 && /boarder engine setup.*npm install --prefix/.test(e.message));
  assert.equal(S.state(cfg, 'ew_n').state, 'none');
  S._inject.claude = { query() { return (async function* () { yield { type: 'system', session_id: 's9' }; yield { type: 'result', is_error: true, result: 'Claude usage limit reached', session_id: 's9' }; })(); } };
  await S.open(cfg, { id: 'ew_l', cwd: home, prompt: 'x' });
  await wait(() => S.state(cfg, 'ew_l').state === 'idle');
  assert.match(S.state(cfg, 'ew_l').limit, /usage limit/);
});

test('데몬이 다시 떠도 창 · 대화 id 를 디스크 사본에서 되찾음(로그인 값 없음)', async () => {
  await S.open(cfg, { id: 'ew_p', cwd: home, prompt: 'x', account: 'work' });
  await wait(() => S.state(cfg, 'ew_p').state === 'idle');
  const raw = fs.readFileSync(path.join(process.env.BOARDER_HOME, 'sdk-windows.json'), 'utf8');
  assert.ok(!/token|secret|key/i.test(raw.replace(/session_id/g, '')));
  S._reset();
  const st = S.state(cfg, 'ew_p');
  assert.equal(st.state, 'idle'); assert.equal(st.session_id, 'cs-1'); assert.equal(st.account, 'work');
});

test('자가 시험(argv)은 모델 없이 되받기만 — sdk 가 여섯 동사 모두 통과', async () => {
  const c = I.loadCfg(); c.sdk = { accounts: {} }; I.saveCfg(c);
  const r = await I.selfTest('sdk');
  assert.deepEqual(r.caps, I.VERBS);
  assert.equal(calls.length, 0);
});

test('엔진 고르기: tmux 가 없고 cfg.sdk 가 있으면 sdk, default 로 고르면 sdk', () => {
  const c = { sdk: { accounts: {} } };
  assert.ok(I.adapters(c).sdk);
  assert.ok(!I.adapters({}).sdk);
  assert.equal(I.pick({ ...c, default: 'sdk' }), 'sdk');
});

test('윈도우 작업 스케줄러: 로그온 때 시작, 런처는 끝 코드 3 이면 멈춤', () => {
  const a = winTaskArgs();
  assert.deepEqual(a.slice(0, 6), ['/create', '/tn', 'BoarderEngine', '/sc', 'onlogon', '/tr']);
  const l = winLauncher('C:\\n\\node.exe', 'C:\\b\\boarder.mjs', { BOARDER_HOME: 'D:\\cfg', PATH: 'x' });
  assert.match(l, /set "BOARDER_HOME=D:\\cfg"/); assert.ok(!/PATH/.test(l));
  assert.match(l, /engine run/); assert.match(l, /if %errorlevel%==3 exit \/b 3/);
  assert.throws(() => winLauncher('C:\\n"x', 'b', {}));
});

test('SDK 자동 설치: npm install --prefix 로 깔고, 깔린 곳에서 import, 실패는 한 줄 원인 + 손 명령', async () => {
  S._inject.claude = null; S._inject.codex = null;
  const fakeNpm = path.join(home, 'npm'); fs.writeFileSync(fakeNpm, '');
  let cmd;
  let npmEnv;
  const exec = (f, a, o) => {
    cmd = [f, ...a]; npmEnv = o?.env;
    for (const [pkg, body] of [['@anthropic-ai/claude-agent-sdk', 'export const query = () => "L";'], ['@openai/codex-sdk', 'export class Codex {}']]) {
      if (!a.includes(`${pkg}@${S.PINNED[pkg.startsWith('@openai') ? 'codex' : 'claude']}`)) continue;
      const r = path.join(S.sdkDir(), 'node_modules', ...pkg.split('/')); fs.mkdirSync(r, { recursive: true });
      fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: pkg, type: 'module', exports: { '.': { import: './index.js' } } })); fs.writeFileSync(path.join(r, 'index.js'), body);
    }
  };
  const bad = await S.installSdks({ exec: () => { throw Object.assign(new Error('x'), { stderr: 'E404 not found' }); }, npm: fakeNpm });
  assert.equal(bad.ok, false); assert.match(bad.why, /E404.*run by hand: npm install --prefix/);
  assert.equal((await S.installSdks({ exec, npm: null })).ok, false);
  const ok = await S.installSdks({ exec, npm: fakeNpm });
  assert.equal(ok.ok, true); assert.ok(cmd.includes('--prefix') && cmd.includes(S.sdkDir()));
  if (process.platform !== 'win32') assert.equal(npmEnv.PATH.split(path.delimiter)[0], path.dirname(process.execPath), 'npm 의 env node 가 설치기의 Node 를 찾음(따로 깐 Node 없는 맥 · 리눅스)');
  assert.ok(cmd.includes('--ignore-scripts') && cmd.includes('@anthropic-ai/claude-agent-sdk@0.3.319') && cmd.includes('@openai/codex-sdk@0.167.0'));   // 버전 고정 · 설치 스크립트 안 돌림
  assert.deepEqual(S.PINNED, { claude: JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).optionalDependencies['@anthropic-ai/claude-agent-sdk'], codex: JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).optionalDependencies['@openai/codex-sdk'] });
  assert.equal((await S.loadSdk('claude')).query(), 'L');
  assert.equal(typeof (await S.loadSdk('codex')).Codex, 'function');
  assert.deepEqual((await S.installSdks({ exec: () => assert.fail('이미 있음'), npm: fakeNpm })).missing, []);
});

test('윈도우 상주: schtasks 가 거절하면(SYSTEM 계정) 시작 폴더 .cmd 로, 어느 길인지 how 에', async () => {
  process.env.APPDATA = path.join(home, 'AppData');
  const refuse = async () => { throw new Error('ERROR: No mapping between account names and security IDs was done.'); };
  let started = 0;
  const r = await installWindows('C:\\n\\node.exe', 'x', { runCmd: refuse, startNow: () => { started++; } });
  assert.equal(r.ok, true); assert.match(r.how, /^Startup folder .*BoarderEngine\.cmd .*No mapping/);
  const f = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'BoarderEngine.cmd');
  assert.match(fs.readFileSync(f, 'utf8'), /engine-run\.cmd/); assert.equal(started, 1);
  const ok = await installWindows('n', {}, { runCmd: async () => {}, startNow: () => assert.fail() });
  assert.match(ok.how, /^Task Scheduler/);
});

test('SDK 설치: 설치기 Node 만 있는 기기에서 실제 실행 함수로 npm 의 env node 를 찾음', { skip: process.platform === 'win32' }, async () => {
  S._inject.claude = null; S._inject.codex = null;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-')), npm = path.join(d, 'npm');
  fs.writeFileSync(npm, '#!/usr/bin/env node\nprocess.exit(0);\n', { mode: 0o700 });
  const prev = process.env.PATH; process.env.PATH = d;
  try { const r = await S.installSdks({ npm }); assert.doesNotMatch(String(r.why || ''), /env: .*node.*No such file/, 'npm 이 실행됨'); }
  finally { process.env.PATH = prev; }
});
