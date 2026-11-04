import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const T = await import('./engine/tmux.mjs');
const said = (...texts) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: texts.map(text => ({ type: 'input_text', text })) } });
const CDX_ID = 'cccccccc-1111-4222-8333-444444444444', EXEC_ID = 'eeeeeeee-1111-4222-8333-444444444444', OTHER_ID = 'dddddddd-1111-4222-8333-444444444444';

function fakeTmux(tmux, ST, LOG) {
  fs.writeFileSync(tmux, `#!${process.execPath}
const fs = require('fs'), a = process.argv.slice(4), cmd = process.argv[4], f = ${JSON.stringify(ST)};
const s = JSON.parse(fs.readFileSync(f, 'utf8')), save = () => fs.writeFileSync(f, JSON.stringify(s));
fs.appendFileSync(${JSON.stringify(LOG)}, process.argv.slice(4).join(' ') + '\\n');
if (cmd === 'has-session') process.exit(s.wins.length ? 0 : 1);
if (cmd === 'list-panes') { process.stdout.write(s.wins.map(w => [w.id, w.win, w.pane, '1', w.cwd, w.sid, w.name, 'sh', w.spec].join('\\t')).join('\\n') + '\\n'); process.exit(0); }
if (cmd === 'set-option') { const t = a[a.indexOf('-t') + 1], w = s.wins.find(x => x.win === t) || s.wins.at(-1), k = a.at(-2), v = a.at(-1); if (k === '@bx_sid') w.sid = v; if (k === '@bx_spec') w.spec = v; if (k === '@bx_id') w.id = v; save(); process.exit(0); }
if (cmd === 'capture-pane') { process.stdout.write(s.cap); process.exit(0); }
if (cmd === 'send-keys') { if (s.clearOnEnter) { s.cap = '› \\n'; save(); } process.exit(0); }
if (cmd === 'load-buffer') { fs.readFileSync(0); process.exit(0); }
if (cmd === 'paste-buffer') process.exit(0);
if (cmd === 'kill-window') { s.wins = s.wins.filter(x => x.win !== a[a.indexOf('-t') + 1]); save(); process.exit(0); }
if (cmd === 'new-window' || cmd === 'new-session') { s.wins.push({ id: '', win: '@2', pane: '%2', cwd: '', sid: '', name: '', spec: '' }); save(); process.stdout.write('@2\\t%2\\n'); process.exit(0); }
process.stderr.write('unknown ' + cmd); process.exit(1);
`, { mode: 0o755 });
}

function world() {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-cdxw-')), work = path.join(H, 'work'), cdx = path.join(H, 'codex');
  const now = new Date(), day = path.join(cdx, 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
  fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(day, { recursive: true });
  const ST = path.join(H, 'tmux.json'), LOG = path.join(H, 'tmux.log'), tmux = path.join(H, 'tmux');
  const opened = Date.now() - 5000;
  const spec = { id: 'ew_cdx01', name: '코덱스 일꾼', tool: 'codex', cwd: work, config_dir: cdx, opened_at: opened, session_id: '00000000-0000-4000-8000-000000000000',
    argv: ['/bin/sh', '-c', 'cd "$0" && exec codex -- "$1"', work, '첫 지시'] };
  fs.writeFileSync(ST, JSON.stringify({ wins: [{ id: 'ew_cdx01', win: '@1', pane: '%1', cwd: work, sid: spec.session_id, name: spec.name, spec: Buffer.from(JSON.stringify(spec)).toString('base64url') }], cap: '› \n', clearOnEnter: true }));
  fakeTmux(tmux, ST, LOG);
  const roll = (name, meta, events = []) => { const p = path.join(day, `rollout-${name}.jsonl`); fs.writeFileSync(p, [JSON.stringify({ type: 'session_meta', payload: meta }), ...events.map(e => JSON.stringify(e))].join('\n') + '\n'); return p; };
  const at = new Date(opened + 1000).toISOString();
  roll('a-exec', { id: EXEC_ID, cwd: work, timestamp: at, originator: 'codex_exec', source: 'exec' });           // 같은 폴더의 codex exec — 묶지 않음
  roll('b-other', { id: OTHER_ID, cwd: path.join(H, 'elsewhere'), timestamp: at, originator: 'codex_cli_rs' });
  roll('c-old', { id: OTHER_ID, cwd: work, timestamp: new Date(opened - 60_000).toISOString(), originator: 'codex_cli_rs' });   // 창을 열기 전 대화
  const mine = roll('d-mine', { id: CDX_ID, cwd: work, timestamp: at, originator: 'codex_cli_rs', source: 'cli' }, [said('첫 지시'), { type: 'event_msg', timestamp: at, payload: { type: 'task_started' } }]);
  const st = () => JSON.parse(fs.readFileSync(ST, 'utf8')), put = o => fs.writeFileSync(ST, JSON.stringify({ ...st(), ...o }));
  return { cfg: { tmux }, H, mine, st, put, log: () => fs.readFileSync(LOG, 'utf8'), done: () => fs.rmSync(H, { recursive: true, force: true }) };
}

test('Codex 창 묶기: 같은 폴더 · 창을 연 뒤 · exec 아닌 대화(rollout)에만 묶고 창 옵션에 남김 — 한 번 묶으면 다시 안 찾음', () => {
  const w = world();
  try {
    const [win] = T.list(w.cfg);
    assert.equal(win.session_id, CDX_ID);
    assert.equal(win.spec.codex_rollout, w.mine);
    const saved = JSON.parse(Buffer.from(w.st().wins[0].spec, 'base64url').toString());
    assert.equal(saved.codex_rollout, w.mine); assert.equal(w.st().wins[0].sid, CDX_ID);
    const n = w.log().split('\n').filter(l => l.startsWith('set-option')).length;
    T.list(w.cfg);
    assert.equal(w.log().split('\n').filter(l => l.startsWith('set-option')).length, n, '묶인 창은 다시 안 씀');
  } finally { w.done(); }
});

test('Codex 창 상태 · 입력칸: 기록의 마지막 턴으로 busy/idle, 입력칸(›)에 사람 글이 있으면 box · send 는 바쁨(2)', async () => {
  const w = world();
  try {
    assert.equal(T.state(w.cfg, 'ew_cdx01').state, 'busy', 'task_started 뒤');
    fs.appendFileSync(w.mine, JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_complete' } }) + '\n');
    const s = T.state(w.cfg, 'ew_cdx01');
    assert.equal(s.state, 'idle'); assert.equal(s.session_id, CDX_ID); assert.equal(s.box, undefined);
    w.put({ cap: '지난 답\n› 사람이 쓰던 글\n', clearOnEnter: false });
    assert.equal(T.state(w.cfg, 'ew_cdx01').box, '사람이 쓰던 글');
    await assert.rejects(T.send(w.cfg, 'ew_cdx01', '보드 글'), e => e.code === 2);
    assert.ok(!w.log().includes('paste-buffer'), '사람 글 위에 붙여 넣지 않음');
    w.put({ cap: '지난 답\n› \n', clearOnEnter: true });
    assert.deepEqual(await T.send(w.cfg, 'ew_cdx01', '보드 글'), { ok: true, tries: 1 });
  } finally { w.done(); }
});

test('Codex 창 다시 열기: 묶인 대화 id 로 resume, 첫 지시는 다시 안 넣음 · 안 묶인 손잡이는 거절', async () => {
  const w = world();
  try {
    const [win] = T.list(w.cfg);
    await assert.rejects(T.reopen(w.cfg, { ...win.spec, codex_rollout: undefined }, '이어서'), /not bound/);
    await assert.rejects(T.reopen(w.cfg, { ...win.spec, argv: ['codex'] }, '이어서', 'ew_cdx02'), /unsupported Codex launch handle/);
    const r = await T.reopen(w.cfg, win.spec, '이어서 해 줘', 'ew_cdx02');
    assert.equal(r.id, 'ew_cdx02');
    const spec = JSON.parse(Buffer.from(w.st().wins.at(-1).spec, 'base64url').toString());
    assert.equal(spec.argv[2], `cd "$0" && exec codex resume ${CDX_ID} -- "$1"`);
    assert.equal(spec.argv[4], '이어서 해 줘');
  } finally { w.done(); }
});

const uid = c => `${c.repeat(8)}-1111-4222-8333-444444444444`;
const ZERO = '00000000-0000-4000-8000-000000000000', LAUNCH = 'cd "$0" && exec codex -- "$1"', DONE = { type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_complete' } };
const enc = s => Buffer.from(JSON.stringify(s)).toString('base64url');
function many(specs, cap = '› \n') {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-cdxm-')), cdx = path.join(H, 'codex'), now = new Date(), day = path.join(cdx, 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
  fs.mkdirSync(day, { recursive: true });
  const ST = path.join(H, 'tmux.json'), LOG = path.join(H, 'tmux.log'), tmux = path.join(H, 'tmux');
  fs.writeFileSync(ST, JSON.stringify({ wins: specs.map((s, i) => ({ id: s.id, win: `@${i + 1}`, pane: `%${i + 1}`, cwd: s.cwd, sid: s.session_id, name: s.id, spec: enc({ config_dir: cdx, ...s }) })), cap, clearOnEnter: true }));
  fakeTmux(tmux, ST, LOG);
  const roll = (name, meta, events = []) => { const p = path.join(day, `rollout-${name}.jsonl`); fs.writeFileSync(p, [JSON.stringify({ type: 'session_meta', payload: meta }), ...events.map(e => JSON.stringify(e))].join('\n') + '\n'); return p; };
  const st = () => JSON.parse(fs.readFileSync(ST, 'utf8'));
  return { cfg: { tmux }, H, cdx, day, roll, st, put: o => fs.writeFileSync(ST, JSON.stringify({ ...st(), ...o })), log: () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : ''), done: () => fs.rmSync(H, { recursive: true, force: true }) };
}
const mk = (id, cwd, opened, over = {}) => ({ id, tool: 'codex', cwd, opened_at: opened, session_id: ZERO, argv: ['/bin/sh', '-c', LAUNCH, cwd, `${id} 첫 지시`], ...over });
const noPrompt = (id, cwd, opened) => mk(id, cwd, opened, { argv: ['/bin/sh', '-c', 'cd "$0" && exec codex', cwd] });
const meta = (id, cwd, at, over = {}) => ({ id, cwd, timestamp: new Date(at).toISOString(), originator: 'codex-tui', source: 'cli', ...over });
const sids = w => T.list(w.cfg).map(x => x.spec.codex_rollout ? x.session_id : null);

test('묶기 리뷰 4: 같은 폴더 두 창은 첫 지시가 맞는 자기 대화에 — 파일 순서가 바뀌어도', () => {
  const t = Date.now() - 5000, w = many([mk('ew_a', '/w/same', t), mk('ew_b', '/w/same', t + 200)]);
  try {
    w.roll('1', meta(uid('b'), '/w/same', t + 1500), [said('ew_b 첫 지시')]);
    w.roll('2', meta(uid('a'), '/w/same', t + 1700), [said('ew_a 첫 지시')]);
    assert.deepEqual(sids(w), [uid('a'), uid('b')]);
  } finally { w.done(); }
});

test('묶기 리뷰 4: 첫 지시가 없는 창끼리는 같은 id 로 안 묶임 · 다른 창이 이미 묶은 id 도 안 집음', () => {
  const t = Date.now() - 5000, w = many([noPrompt('ew_a', '/w/same', t), noPrompt('ew_b', '/w/same', t + 200)]);
  try {
    w.roll('1', meta(uid('a'), '/w/same', t + 1500));
    assert.deepEqual(sids(w), [uid('a'), null], '대화 하나면 한 창만');
    w.roll('2', meta(uid('b'), '/w/same', t + 1700));
    assert.deepEqual(sids(w), [uid('a'), uid('b')], '먼저 묶인 창 id 를 빼고 다음 창이 묶임');
  } finally { w.done(); }
  const u = many([mk('ew_done', '/w/same', t, { codex_rollout: '/x/old.jsonl', session_id: uid('a') }), noPrompt('ew_new', '/w/same', t + 200)]);
  try {
    u.roll('1', meta(uid('a'), '/w/same', t + 1500));
    assert.deepEqual(sids(u), [uid('a'), null], '앞 판 목록에서 이미 묶인 id');
  } finally { u.done(); }
});

test('묶기 리뷰 4: 자기 파일이 아직 없는 창은 사람이 연 codex 에 안 묶임 — 첫 글이 없는 파일도 기다렸다 맞으면 묶음', () => {
  const t = Date.now() - 60000, w = many([mk('ew_a', '/w/same', t)]);
  try {
    w.roll('h', meta(uid('c'), '/w/same', t + 50000), [said('사람이 친 다른 글')]);
    assert.deepEqual(sids(w), [null], '사람 대화');
    w.roll('h2', meta(uid('d'), '/w/same', t + 50000), [said('# AGENTS.md instructions for /w/same\n\n<INSTRUCTIONS>x</INSTRUCTIONS>', '<environment_context>\n  <cwd>/w/same</cwd>\n</environment_context>')]);
    assert.deepEqual(sids(w), [null], 'Codex 머리 글뿐이면 아직 첫 글이 아님');
    const mine = w.roll('m', meta(uid('e'), '/w/same', t + 51000));
    assert.deepEqual(sids(w), [null], '첫 글이 아직 없는 파일');
    fs.appendFileSync(mine, [said('# AGENTS.md instructions for /w/same\n\nx', '<environment_context>\n</environment_context>'), said('  ew_a 첫 지시\n')].map(x => JSON.stringify(x)).join('\n') + '\n');
    assert.deepEqual(sids(w), [uid('e')], '머리 글을 건너뛴 첫 글이 맞음(앞뒤 빈칸은 안 봄)');
  } finally { w.done(); }
  const v = many([mk('ew_a', '/w/same', t)]);
  try {
    v.roll('m', meta(uid('f'), '/w/same', t + 1000), [{ type: 'event_msg', payload: { type: 'user_message', message: 'ew_a 첫 지시' } }]);
    assert.deepEqual(sids(v), [uid('f')], 'event_msg user_message 꼴도');
  } finally { v.done(); }
});

test('묶기 리뷰 4: 서브에이전트 기록 · opened_at 없는 옛 창 · 시각을 못 읽는 기록은 안 묶음', () => {
  const t = Date.now() - 5000, s = noPrompt('ew_a', '/w/same', t), w = many([s]);
  try {
    w.roll('s1', meta(uid('a'), '/w/same', t + 1000, { source: { subagent: { thread_spawn: { parent_thread_id: uid('b') } } } }));
    w.roll('s2', meta(uid('c'), '/w/same', t + 1000, { source: { subagent: 'review' } }));
    w.roll('s3', { ...meta(uid('d'), '/w/same', t + 1000), timestamp: 'not a date' });
    assert.deepEqual(sids(w), [null]);
  } finally { w.done(); }
  const old = noPrompt('ew_old', '/w/same', 0); delete old.opened_at;
  const o = many([old]);
  try {
    o.roll('1', meta(uid('e'), '/w/same', Date.now() - 7 * 3600e3));
    assert.deepEqual(sids(o), [null]);
    assert.equal(T.state(o.cfg, 'ew_old').state, 'idle', '묶지 않고 starting 에도 안 머묾');
  } finally { o.done(); }
});

test('묶기 리뷰 5: spec.cwd 가 ~/… · 끝 빗금이어도 묶이고 state 가 나아감 · 뿌리 폴더는 CODEX_HOME 도 봄', () => {
  const t = Date.now() - 5000;
  for (const [sc, mc] of [['~/bx-w', path.join(os.homedir(), 'bx-w')], ['/w/x/', '/w/x'], ['/w/./x', '/w/x']]) {
    const w = many([noPrompt('ew_a', sc, t)]);
    try {
      w.roll('1', meta(uid('a'), mc, t + 1000), [DONE]);
      assert.deepEqual(sids(w), [uid('a')], sc);
      assert.equal(T.state(w.cfg, 'ew_a').state, 'idle', sc);
    } finally { w.done(); }
  }
  const w = many([{ ...noPrompt('ew_a', '/w/h', t), config_dir: undefined }]), old = process.env.CODEX_HOME;
  try {
    w.roll('1', meta(uid('b'), '/w/h', t + 1000));
    process.env.CODEX_HOME = path.join(w.H, 'elsewhere');
    assert.deepEqual(sids(w), [null], '다른 뿌리');
    process.env.CODEX_HOME = w.cdx;
    assert.deepEqual(sids(w), [uid('b')]);
  } finally { if (old === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = old; w.done(); }
});

test('묶기 리뷰 5: 대화를 못 찾는 창은 뜨는 시간(2분)까지만 starting — 그 뒤 쉼으로 보아 줄의 글이 나감', async () => {
  const fresh = many([mk('ew_new', '/w/late', Date.now() - 5000)]), late = many([mk('ew_late', '/w/late', Date.now() - 180000)]);
  try {
    assert.equal(T.state(fresh.cfg, 'ew_new').state, 'starting');
    const s = T.state(late.cfg, 'ew_late');
    assert.equal(s.state, 'idle'); assert.equal(s.session_id, null, '가짜 id 를 내지 않음');
    late.put({ cap: '일하는 중 (esc to interrupt)\n› \n' });
    assert.equal(T.state(late.cfg, 'ew_late').state, 'busy', '화면이 일하는 중이면 일함');
    late.put({ cap: '› \n' });
    assert.deepEqual(await T.send(late.cfg, 'ew_late', '보드 글'), { ok: true, tries: 1 });
    assert.ok(late.log().includes('paste-buffer'));
  } finally { fresh.done(); late.done(); }
});

test('입력칸 리뷰 6: 38 · 48 · 58 색 인자 안의 2 는 흐림이 아님 — 사람 글을 읽고 send 는 바쁨(2), 흐린 자리표시만 뺌', async () => {
  const t = Date.now() - 5000, w = many([noPrompt('ew_a', '/w/box', t)]);
  try {
    w.roll('1', meta(uid('a'), '/w/box', t + 1000), [DONE]);
    for (const cap of ['\x1b[48;2;41;41;41m› 사람 글\x1b[0m\n', '\x1b[38;2;200;200;200m› 사람 글\x1b[0m\n', '\x1b[48;5;2m› 사람 글\x1b[0m\n', '\x1b[38;5;2m› 사람 글\x1b[0m\n', '\x1b[1;48;2;2;2;2m› 사람 글\x1b[0m\n', '\x1b[58;2;2;2;2m› 사람 글\x1b[0m\n',
      '\x1b[48;2;41;41;41m\x1b[1m› \x1b[22m사람 글\x1b[0m\n', '\x1b[2m흐림\x1b[22m\n› 사람 글\n', '\x1b[48;2;2;2;2m› \x1b[2m흐림\x1b[22m사람 글\x1b[0m\n']) {
      w.put({ cap, clearOnEnter: false });
      assert.equal(T.state(w.cfg, 'ew_a').box, '사람 글', JSON.stringify(cap));
      await assert.rejects(T.send(w.cfg, 'ew_a', '보드 글'), e => e.code === 2, JSON.stringify(cap));
    }
    assert.ok(!w.log().includes('paste-buffer'), '사람 글 위에 붙여 넣지 않음');
    for (const cap of ['\x1b[1m›\x1b[0m \x1b[2mAsk Codex to do anything\x1b[0m\n', '\x1b[48;2;41;41;41m› \x1b[2;38;2;99;99;99mAsk Codex\x1b[0m\n', '\x1b[48;2;41;41;41m› \x1b[2m\x1b[38;2;99;99;99mAsk Codex\x1b[0m\n', '› \n'])
      { w.put({ cap }); assert.equal(T.state(w.cfg, 'ew_a').box, undefined, JSON.stringify(cap)); }
  } finally { w.done(); }
});

test('입력칸 리뷰 6: › 뒤 첫 줄이 비고 둘째 줄에만 글이 있어도 사람 글 — 아래 빈 줄 · 흐린 안내는 글이 아님', async () => {
  const t = Date.now() - 5000, w = many([noPrompt('ew_a', '/w/box', t)]);
  try {
    w.roll('1', meta(uid('a'), '/w/box', t + 1000), [DONE]);
    for (const [cap, want] of [['› \n  둘째 줄\n', '둘째 줄'], ['\x1b[48;2;41;41;41m› \x1b[0m\n\x1b[48;2;41;41;41m  둘째 줄\x1b[0m\n', '둘째 줄'], ['› 첫째\n  둘째\n\n  100% context left\n', '첫째 둘째'],
      ['› \n\n  100% context left · ? for shortcuts\n', undefined], ['› \n      \n  ? for shortcuts\n', undefined], ['› \n\x1b[2m  100% context left\x1b[0m\n', undefined], ['\x1b[48;2;41;41;41m› \x1b[0m\n\x1b[48;2;41;41;41m                \x1b[0m\n\x1b[2m  ? for shortcuts\x1b[0m\n', undefined]]) {
      w.put({ cap, clearOnEnter: false });
      assert.equal(T.state(w.cfg, 'ew_a').box, want, JSON.stringify(cap));
    }
    w.put({ cap: '› \n  둘째 줄\n', clearOnEnter: false });
    await assert.rejects(T.send(w.cfg, 'ew_a', '보드 글'), e => e.code === 2);
    assert.ok(!w.log().includes('paste-buffer'));
  } finally { w.done(); }
});

test('Claude 창은 옛 길: spec.tool 없는 창은 묶기 · 손잡이 칸 없음, inputBox 는 흐린 글만 뺌', async () => {
  const w = many([{ id: 'ew_cl', cwd: '/w/c', session_id: uid('a') }], '──\n❯ 사람 글\n──\n');
  try {
    w.roll('1', meta(uid('b'), '/w/c', Date.now()));
    const [x] = T.list(w.cfg);
    assert.equal(x.session_id, uid('a')); assert.equal(x.spec.codex_rollout, undefined);
    assert.ok(!w.log().includes('set-option'));
    assert.equal(T.state(w.cfg, 'ew_cl').box, '사람 글');
    await assert.rejects(T.send(w.cfg, 'ew_cl', '보드 글'), e => e.code === 2);
    const { handle } = await T.park(w.cfg, 'ew_cl');
    assert.equal(handle.codex_rollout, undefined); assert.equal(handle.codex_argv, undefined);
  } finally { w.done(); }
  assert.equal(T.inputBox('──\n\x1b[39m❯\xa0\x1b[2m다음에 할 일 제안\x1b[0m\n──\n'), '');
  assert.equal(T.inputBox('──\n\x1b[39m❯\xa0사람 글\n──\n'), '사람 글');
  assert.equal(T.inputBox('──\n\x1b[38;2;200;200;200m❯ 사람 글\x1b[0m\n──\n'), '사람 글');
});

const okForServer = h => Object.values(h).every(v => v === null || ['number', 'boolean'].includes(typeof v) || (typeof v === 'string' && v.length <= 400));

test('다시 열기 리뷰 7: 들여오기 손잡이에 대화 파일 · 띄운 명령이 실려 사라진 창도 resume — 첫 지시는 안 올라가고 서버 칸 꼴을 지킴', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-cdxr-')), t = Date.now() - 5000, s = mk('ew_a', cwd, t, { argv: ['/bin/sh', '-c', LAUNCH, cwd, '비밀스러운 첫 지시'] }), w = many([s]);
  const envs = { HOME: process.env.HOME, PATH: process.env.PATH, BOARDER_HOME: process.env.BOARDER_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CODEX_HOME: process.env.CODEX_HOME };
  try {
    const rollout = w.roll('1', meta(uid('a'), cwd, t + 1000), [said('비밀스러운 첫 지시')]);
    const home = path.join(w.H, 'bh'); fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, 'engine.json'), JSON.stringify({ tmux: w.cfg.tmux, default: 'tmux' }));
    Object.assign(process.env, { HOME: w.H, PATH: '', BOARDER_HOME: home }); delete process.env.CLAUDE_CONFIG_DIR;
    const I = await import('./importer.mjs');
    const item = (await I.collectWindows()).find(x => x.key.endsWith(':ew_a'));
    assert.ok(item, '창 줄');
    const h = item.handle;
    assert.equal(h.tool, 'codex'); assert.equal(h.session_id, uid('a')); assert.equal(h.codex_rollout, rollout);
    assert.ok(okForServer(h), JSON.stringify(h));
    assert.ok(!JSON.stringify(h).includes('비밀스러운'), '대화 글은 안 올림');
    // 창이 사라진 뒤 서버가 돌려준 손잡이(JSON 왕복)로 다시 열기
    w.put({ wins: [] });
    const r = await T.reopen(w.cfg, JSON.parse(JSON.stringify(h)), '이어서 해 줘', 'ew_a2');
    assert.equal(r.session_id, uid('a'));
    const spec = JSON.parse(Buffer.from(w.st().wins.at(-1).spec, 'base64url').toString());
    assert.deepEqual(spec.argv, ['/bin/sh', '-c', `cd "$0" && exec codex resume ${uid('a')} -- "$1"`, cwd, '이어서 해 줘']);
    assert.equal(spec.codex_rollout, rollout);
  } finally {
    for (const [k, v] of Object.entries(envs)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    w.done(); fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('다시 열기 리뷰 7: 안 묶인 창 손잡이엔 안 실림 · 너무 긴 값 · 비밀이 든 명령은 안 실림 · 주차 손잡이는 서버가 argv 를 지워도 다시 열림', async () => {
  assert.deepEqual(T.codexHandle({ argv: ['/bin/sh', '-c', LAUNCH, '/w', '글'] }), {});
  assert.deepEqual(T.codexHandle({ codex_rollout: '/x.jsonl', argv: ['/bin/sh', '-c', LAUNCH, '/w', '글'] }), { codex_rollout: '/x.jsonl', codex_argv: JSON.stringify(['/bin/sh', '-c', LAUNCH, '/w']) });
  assert.deepEqual(T.codexHandle({ codex_rollout: '/x.jsonl', argv: ['/bin/sh', '-c', LAUNCH, `/${'w'.repeat(500)}`] }), {});
  assert.deepEqual(T.codexHandle({ codex_rollout: '/x.jsonl', argv: ['/bin/sh', '-c', `OPENAI_API_KEY=sk-${'a'.repeat(30)} ${LAUNCH}`, '/w'] }), {});
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-cdxr-')), t = Date.now() - 5000, w = many([mk('ew_a', cwd, t)]);
  try {
    w.roll('1', meta(uid('a'), cwd, t + 1000), [said('ew_a 첫 지시')]);
    T.list(w.cfg);
    const { handle } = await T.park(w.cfg, 'ew_a');
    assert.equal(handle.argv, undefined, '주차 손잡이에 argv 없음 — 서버(imp_item.handle)에 저장되므로');
    assert.ok(!JSON.stringify(handle).includes('ew_a 첫 지시'), '첫 지시 전문이 손잡이에 안 실림');
    const server = JSON.parse(JSON.stringify(handle));
    w.put({ wins: [] });
    await T.reopen(w.cfg, server, '이어서', 'ew_a2');
    const spec = JSON.parse(Buffer.from(w.st().wins.at(-1).spec, 'base64url').toString());
    assert.equal(spec.argv[2], `cd "$0" && exec codex resume ${uid('a')} -- "$1"`); assert.equal(spec.argv[4], '이어서');
    await assert.rejects(T.reopen(w.cfg, { ...server, codex_argv: 'not json' }, 'x', 'ew_a3'), /unsupported Codex launch handle/);
  } finally { w.done(); fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('주차 손잡이: 명령 속 비밀값이 서버로 안 실림 · 비밀 든 명령은 다시 열기를 거절', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-cdxs-')), t = Date.now() - 5000, w = many([mk('ew_s', cwd, t)]);
  const TOK = `sk-${'a'.repeat(30)}`;
  try {
    w.roll('1', meta(uid('s'), cwd, t + 1000), [said('ew_s 첫 지시')]);
    T.list(w.cfg);
    const st = w.st(), row = st.wins.find(x => /ew_s/.test(JSON.stringify(x))) || st.wins[0], spec = JSON.parse(Buffer.from(row.spec, 'base64url').toString());
    spec.argv = ['/bin/sh', '-c', `OPENAI_API_KEY=${TOK} ${spec.argv?.[2] || 'codex'}`, cwd, 'ew_s 첫 지시'];
    row.spec = Buffer.from(JSON.stringify(spec)).toString('base64url'); w.put(st);
    const { handle } = await T.park(w.cfg, 'ew_s');
    assert.ok(!JSON.stringify(handle).includes(TOK), '비밀값이 손잡이에 없음');
    assert.equal(handle.argv, undefined);
  } finally { w.done?.(); }
});
