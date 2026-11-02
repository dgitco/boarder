import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const SID = '11111111-2222-4333-8444-555555555555', SID2 = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const tmuxPath = (() => { try { return execFileSync('which', ['tmux'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();

function world(opts = {}) {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-mv-')), B = path.join(H, 'boarder'), BIND = path.join(H, 'bin'), CC = path.join(H, 'cc'), W = path.join(H, 'work'), FAKE = path.join(H, 'fake');
  for (const d of [B, BIND, path.join(CC, 'sessions'), W, path.join(H, 'tmux'), FAKE]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const LOG = path.join(H, 'herdr.log'), EXITED = path.join(H, 'exited');
  fs.writeFileSync(path.join(FAKE, 'claude'), 'setTimeout(() => {}, 120000);\n');
  const ai = spawn(process.execPath, [path.join(FAKE, 'claude')], { stdio: 'ignore' });
  const PID = ai.pid;
  const ourPanes = opts.ours ? `, { pane_id: 'p2', workspace_id: 'w2', agent_status: 'idle' }` : '';
  fs.writeFileSync(path.join(BIND, 'herdr'), `#!${process.execPath}
const fs = require('fs'), a = process.argv.slice(2), ex = fs.existsSync(${JSON.stringify(EXITED)});
fs.appendFileSync(${JSON.stringify(LOG)}, a.join(' ') + '\\n');
const out = r => { process.stdout.write(JSON.stringify({ result: r })); process.exit(0); };
const fail = () => { process.stderr.write(JSON.stringify({ error: { code: 'unknown', message: 'server busy' } })); process.exit(1); };
const k = a.slice(0, 2).join(' ');
if (${!!opts.blind} && ex && (k === 'agent list' || k === 'pane process-info')) fail();
if (k === 'workspace list') out({ workspaces: [{ workspace_id: 'w1', label: 'my work' }${opts.ours ? ", { workspace_id: 'w2', label: 'ew_ours1' }" : ''}] });
if (k === 'agent list') out({ agents: ex || ${!!opts.noAgents} ? [] : [{ pane_id: 'p1', workspace_id: 'w1', name: 'shop api', agent: 'claude', agent_status: 'idle', cwd: ${JSON.stringify(W)} }] });
if (k === 'pane process-info') out({ process_info: { foreground_processes: ex ? [] : [{ pid: ${PID} }] } });
if (k === 'pane list') out({ panes: [{ pane_id: 'p1', workspace_id: 'w1' }${ourPanes}] });
if (k === 'pane run' && a[3] === '/exit') { fs.writeFileSync(${JSON.stringify(EXITED)}, '1'); process.exit(0); }
if (k === 'pane send-keys' || k === 'pane run' || k === 'workspace close' || k === 'pane close') process.exit(0);
fail();
`, { mode: 0o755 });
  fs.writeFileSync(path.join(BIND, 'claude'), '#!/bin/sh\nsleep 60\n', { mode: 0o755 });
  const BADTMUX = path.join(BIND, 'bad-tmux'); fs.writeFileSync(BADTMUX, '#!/bin/sh\necho "tmux broke" >&2\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(CC, 'sessions', `${PID}.json`), JSON.stringify({ sessionId: SID, pid: PID, cwd: W, status: opts.status || 'idle', updatedAt: Date.now() }));
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 'bxd_made-up-device-token-0123456789abcdef', device_id: 'd', server: 'http://127.0.0.1:9' }));
  fs.writeFileSync(path.join(B, 'engine.json'), JSON.stringify({ tmux: opts.badTmux ? BADTMUX : tmuxPath, default: opts.engDefault || 'tmux' }));
  if (opts.ours) fs.writeFileSync(path.join(B, 'herdr-windows.json'), JSON.stringify({ ew_ours1: { pane: 'p2', workspace: 'w2', spec: { id: 'ew_ours1', name: 'our window', cwd: W, session_id: SID2 } } }), { mode: 0o600 });
  const SOCK = `bxmv${process.pid}`;
  const env = { ...process.env, HOME: H, BOARDER_HOME: B, CLAUDE_CONFIG_DIR: CC, BOARDER_TMUX_SOCKET: SOCK, TMUX_TMPDIR: path.join(H, 'tmux'), LANG: 'C.UTF-8', PATH: `${BIND}:${process.env.PATH}` };
  delete env.TMUX;
  const cli = args => new Promise(res => {
    const c = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    const t = setTimeout(() => c.kill('SIGKILL'), 60000);
    c.on('close', code => { clearTimeout(t); res({ code, out, err }); });
  });
  const herdrLog = () => fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
  const tmuxWins = () => { try { return execFileSync(tmuxPath, ['-L', SOCK, 'list-windows', '-a', '-F', '#{@bx_id}\t#{@bx_sid}\t#{window_name}'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
  const engineCfg = () => JSON.parse(fs.readFileSync(path.join(B, 'engine.json'), 'utf8'));
  const done = () => { try { ai.kill('SIGKILL'); } catch {} try { execFileSync(tmuxPath, ['-L', SOCK, 'kill-server'], { stdio: 'ignore', env }); } catch {} fs.rmSync(H, { recursive: true, force: true }); };
  return { H, B, BIND, CC, W, env, cli, herdrLog, tmuxWins, engineCfg, done };
}

test('기본 엔진: Herdr 서버가 돌아도 tmux, Herdr 는 default herdr 일 때만', async () => {
  const w = world();
  try {
    const old = { ...process.env };
    Object.assign(process.env, { BOARDER_HOME: w.B, PATH: w.env.PATH });
    try {
      const E = await import('./engine/index.mjs');
      const cfg = { tmux: tmuxPath || '/bin/true', herdr: path.join(w.BIND, 'herdr') };
      assert.ok(E.adapters(cfg).herdr, '가짜 Herdr 서버가 도는 것으로 보임');
      assert.equal(E.pick(cfg), 'tmux');
      assert.equal(E.pick(cfg, 'herdr'), 'tmux', '역할이 herdr 를 적어도 사람이 고르기 전엔 tmux');
      assert.equal(E.pick({ ...cfg, default: 'herdr' }), 'herdr');
      assert.equal(E.pick({ ...cfg, default: 'nope' }), 'tmux', '없는 기본은 tmux 로');
    } finally { process.env.BOARDER_HOME = old.BOARDER_HOME; process.env.PATH = old.PATH; if (!old.BOARDER_HOME) delete process.env.BOARDER_HOME; }
  } finally { w.done(); }
});

test('engine move-all herdr tmux: 먼저 목록만(아무것도 안 바꿈), --yes 면 Herdr 판을 닫고 tmux 에서 같은 대화로', { skip: !tmuxPath && 'tmux 없음' }, async () => {
  const w = world();
  try {
    const r0 = await w.cli(['engine', 'move-all', 'herdr', 'tmux']);
    assert.equal(r0.code, 0, r0.err);
    assert.match(r0.out, /Herdr windows on this machine \(1\)/); assert.match(r0.out, /shop api/); assert.match(r0.out, /--yes/);
    assert.ok(!/pane run|workspace close|pane close/.test(w.herdrLog()), '목록만 — Herdr 창을 건드리지 않음');
    assert.equal(w.tmuxWins(), '');
    const r1 = await w.cli(['engine', 'move-all', 'herdr', 'tmux', '--yes']);
    assert.equal(r1.code, 0, r1.out + r1.err);
    assert.match(r1.out, /✓ shop api/);
    const log = w.herdrLog();
    assert.match(log, /pane run p1 \/exit/); assert.match(log, /workspace close w1/, '작업공간의 판이 그것뿐 — 작업공간을 닫음');
    const wins = w.tmuxWins();
    assert.match(wins, new RegExp(`^ew_[a-z0-9]+\\t${SID}\\t`), `tmux 에서 같은 대화로: ${wins}`);
    assert.equal((await w.cli(['engine', 'move-all', 'herdr', 'mars'])).code, 64);
  } finally { w.done(); }
});

test('move-all: /exit 뒤 판 상태를 못 읽으면 「아직 돎」 — 판을 닫지 않고 tmux 도 안 엶', { skip: !tmuxPath && 'tmux 없음' }, async () => {
  const w = world({ blind: true });
  try {
    const r = await w.cli(['engine', 'move-all', 'herdr', 'tmux', '--yes']);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /✗ shop api: .*could not tell whether the AI tool ended/);
    const log = w.herdrLog();
    assert.match(log, /pane run p1 \/exit/);
    assert.ok(!/workspace close|pane close/.test(log), `판을 닫지 않음: ${log}`);
    assert.equal(w.tmuxWins(), '', 'tmux 에 열지 않음');
  } finally { w.done(); }
});

test('move-all: 목록만(--yes 없음)이면 Herdr 창이 없어도 기본 엔진을 안 바꿈, --yes 면 tmux 로', { skip: !tmuxPath && 'tmux 없음' }, async () => {
  const w = world({ noAgents: true, engDefault: 'herdr' });
  try {
    const r0 = await w.cli(['engine', 'move-all', 'herdr', 'tmux']);
    assert.equal(r0.code, 0, r0.err); assert.match(r0.out, /no Herdr windows/);
    assert.equal(w.engineCfg().default, 'herdr');
    const r1 = await w.cli(['engine', 'move-all', 'herdr', 'tmux', '--yes']);
    assert.equal(r1.code, 0, r1.err);
    assert.equal(w.engineCfg().default, 'tmux');
  } finally { w.done(); }
});

test('move-all: tmux 가 안 열리면 보더 창은 Herdr 에 다시 열기를 해 보고, 안 되면 손으로 이어 열 명령을 알려 줌(사람 창도)', async () => {
  const w = world({ ours: true, badTmux: true });
  try {
    const r = await w.cli(['engine', 'move-all', 'herdr', 'tmux', '--yes']);
    assert.equal(r.code, 1, r.out + r.err);
    const log = w.herdrLog();
    assert.match(log, /workspace close w2/, '보더 창은 주차(작업공간 닫기)');
    assert.match(log, /workspace create .*--label ew_ours1/, 'tmux 실패 뒤 Herdr 에 다시 열기를 해 봄');
    assert.match(r.err, /✗ our window: tmux did not open .*resume it by hand: cd \S+ && claude --resume 66666666-7777-4888-8999-aaaaaaaaaaaa/);
    assert.match(r.err, new RegExp(`✗ shop api: closed in Herdr but tmux did not open .*resume it by hand: cd \\S+ && env CLAUDE_CONFIG_DIR=\\S+ claude --resume ${SID}`));
  } finally { w.done(); }
});

test('move-all --yes: 일하는 중인 창은 건너뜀(목록에 상태), --force 면 옮김', { skip: !tmuxPath && 'tmux 없음' }, async () => {
  const w = world({ status: 'busy' });
  try {
    const r0 = await w.cli(['engine', 'move-all', 'herdr', 'tmux']);
    assert.match(r0.out, /shop api {2}\[working\].*will be skipped/);
    const r1 = await w.cli(['engine', 'move-all', 'herdr', 'tmux', '--yes']);
    assert.equal(r1.code, 0, r1.out + r1.err);
    assert.match(r1.out, /– shop api: skipped — working/); assert.match(r1.out, /skipped 1 busy/);
    assert.ok(!/pane run|workspace close|pane close/.test(w.herdrLog()), '건너뛴 창은 건드리지 않음');
    assert.equal(w.tmuxWins(), '');
    const r2 = await w.cli(['engine', 'move-all', 'herdr', 'tmux', '--yes', '--force']);
    assert.equal(r2.code, 0, r2.out + r2.err); assert.match(r2.out, /✓ shop api/);
    assert.match(w.tmuxWins(), new RegExp(`\\t${SID}\\t`));
  } finally { w.done(); }
});
