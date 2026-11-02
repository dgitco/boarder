import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const OLD = '/usr/local/lib/node_modules/boarder-cli/bin/boarder.mjs';
const rd = p => JSON.parse(fs.readFileSync(p, 'utf8'));

async function world(fn) {
  const srv = http.createServer((req, res) => { if (req.url === '/api/install/skill') { res.end('---\nname: boarder\n---\nmade-up skill\n'); return; } res.statusCode = 404; res.end('{}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-tg-')), B = path.join(H, 'boarder'), url = `http://127.0.0.1:${srv.address().port}`;
  fs.mkdirSync(B, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 'bxd_made_up', device_id: 'd1', server: url }));
  fs.mkdirSync(path.join(H, '.claude')); fs.writeFileSync(path.join(H, '.claude.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } }, projects: { '/p': {} } }, null, 2) + '\n');
  for (const a of ['a', 'b']) fs.mkdirSync(path.join(H, '.claude-accounts', a), { recursive: true });
  fs.writeFileSync(path.join(H, '.claude-accounts', 'a', '.claude.json'), JSON.stringify({ mcpServers: { boarder: { command: '/old/node', args: [OLD, 'mcp'] } } }));
  fs.writeFileSync(path.join(H, '.claude-accounts', 'b', '.claude.json'), '{}\n');
  const env3 = path.join(H, 'work-claude'); fs.mkdirSync(env3);
  fs.mkdirSync(path.join(H, '.codex')); fs.writeFileSync(path.join(H, '.codex', 'config.toml'), '[mcp_servers.boarder]\ncommand = "/old/node"\nargs = ["' + OLD + '", "mcp"]\n\n[other]\nx = 1\n');
  // BOARDER_TMUX_SOCKET: 인자 없는 restore 는 Boarder tmux 서버를 닫음 — 이 기기의 진짜 보더 창이 아니라 없는 소켓을 가리키게
  const env = { HOME: H, BOARDER_HOME: B, CLAUDE_CONFIG_DIR: env3, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, XDG_CONFIG_HOME: path.join(H, 'xdg'), BOARDER_TMUX_SOCKET: `bx-test-${process.pid}-${Date.now()}` };
  const cli = (args, over = {}) => new Promise(res => { const e = { ...env, ...over }; for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k]; const c = spawn(process.execPath, [BIN, ...args], { env: e, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d); c.on('close', code => res({ code, out, err })); });
  try { await fn({ cli, H, env3 }); } finally { srv.close(); fs.rmSync(H, { recursive: true, force: true }); }
}

test('status: Claude 설정 폴더마다 한 줄 — 기본 · CLAUDE_CONFIG_DIR · ~/.claude-accounts/*, 옛 경로는 「old CLI path」', async () => {
  await world(async ({ cli }) => {
    const r = await cli(['status']);
    for (const w of ['~/.claude)', '~/.claude-accounts/a)', '~/.claude-accounts/b)', '~/work-claude)']) assert.ok(r.out.includes(w), `${w} 줄이 없음\n${r.out}`);
    assert.match(r.out, /~\/\.claude-accounts\/a\): Boarder points to an old CLI path/);
    assert.match(r.out, /Codex: Boarder points to an old CLI path/);
  });
});

test('enable report: 폴더 전부에 MCP · 훅 · 스킬, 옛 경로 칸은 지금 CLI 로, 다른 설정은 그대로', async () => {
  await world(async ({ cli, H, env3 }) => {
    const r = await cli(['enable', 'report', '--yes']);
    assert.equal(r.code, 0, r.err);
    for (const d of [path.join(H, '.claude-accounts', 'a'), path.join(H, '.claude-accounts', 'b'), env3]) {
      const e = rd(path.join(d, '.claude.json')).mcpServers.boarder;
      assert.deepEqual(e.args, [BIN, 'mcp'], `${d} MCP`);
      assert.match(JSON.stringify(rd(path.join(d, 'settings.json')).hooks.SessionStart), /hook session-start/);
      assert.match(JSON.stringify(rd(path.join(d, 'settings.json')).hooks.Stop), /boarder\.mjs' hook stop/, `${d} Stop 훅(보드 글의 답을 채널로)`);
      assert.ok(fs.existsSync(path.join(d, 'skills', 'boarder', 'SKILL.md')), `${d} skill`);
    }
    const base = rd(path.join(H, '.claude.json'));
    assert.deepEqual(base.mcpServers.boarder.args, [BIN, 'mcp']);
    assert.equal(base.mcpServers.other.command, 'x'); assert.ok(base.projects['/p']);
    assert.ok(fs.existsSync(path.join(H, '.claude', 'settings.json')));
    const toml = fs.readFileSync(path.join(H, '.codex', 'config.toml'), 'utf8');
    assert.ok(toml.includes(JSON.stringify(BIN)) && !toml.includes(OLD), toml);
    assert.equal(toml.match(/\[mcp_servers\.boarder\]/g).length, 1); assert.match(toml, /\[other\]\nx = 1/);
    assert.ok(toml.startsWith(`notify = ${JSON.stringify([process.execPath, BIN, 'hook', 'codex-turn'])}\n`), `Codex 턴 끝 알림은 맨 위 칸\n${toml}`);
    assert.match(r.out, /fixed old path/);
    const s = await cli(['status']);
    assert.doesNotMatch(s.out, /old CLI path|view only/, s.out);
  });
});

test('restore <폴더>: 그 폴더만 빼고 다른 계정 폴더는 그대로 · 처음 파일은 쓰기 전 그대로', async () => {
  await world(async ({ cli, H }) => {
    const b0 = fs.readFileSync(path.join(H, '.claude-accounts', 'b', '.claude.json'), 'utf8');
    assert.equal((await cli(['enable', 'report', '--yes'])).code, 0);
    const r = await cli(['restore', '~/.claude-accounts/b']);
    assert.equal(r.code, 0, r.err);
    assert.equal(fs.readFileSync(path.join(H, '.claude-accounts', 'b', '.claude.json'), 'utf8'), b0);
    assert.ok(!fs.existsSync(path.join(H, '.claude-accounts', 'b', 'skills', 'boarder')));
    assert.ok(rd(path.join(H, '.claude-accounts', 'a', '.claude.json')).mcpServers.boarder, '다른 계정은 그대로');
    assert.ok(rd(path.join(H, '.claude.json')).mcpServers.boarder);
  });
});

test('--only 로 고르기: 한 폴더만, 없는 폴더는 오류(아무것도 안 씀)', async () => {
  await world(async ({ cli, H }) => {
    const bad = await cli(['enable', 'report', '--yes', '--only', '~/.claude-accounts/zz']);
    assert.notEqual(bad.code, 0); assert.match(bad.err, /not found on this machine/);
    assert.equal(rd(path.join(H, '.claude-accounts', 'b', '.claude.json')).mcpServers, undefined);
    assert.equal((await cli(['enable', 'report', '--yes', '--only', 'claude:~/.claude-accounts/b'])).code, 0);
    assert.ok(rd(path.join(H, '.claude-accounts', 'b', '.claude.json')).mcpServers.boarder);
    assert.equal(rd(path.join(H, '.claude.json')).mcpServers.boarder, undefined, '고르지 않은 기본 자리는 안 씀');
  });
});

test('restore(인자 없음): setup 때 CLAUDE_CONFIG_DIR · BOARDER_CLAUDE_DIRS 로 쓴 폴더도 — 그 환경변수 없는 셸에서 되돌려도 흔적 0', async () => {
  await world(async ({ cli, H, env3 }) => {
    const env4 = path.join(H, 'other-claude'); fs.mkdirSync(env4);
    fs.writeFileSync(path.join(env4, '.claude.json'), '{"keep":1}\n');
    assert.equal((await cli(['enable', 'report', '--yes'], { BOARDER_CLAUDE_DIRS: env4 })).code, 0);
    assert.ok(rd(path.join(env4, '.claude.json')).mcpServers.boarder, 'setup 이 env4 에 씀');
    // 설치 뒤 그 사람이 바꾼 파일(통째 되돌리기 못 함 — Boarder 칸만 빠져야)
    const s4 = path.join(env4, 'settings.json'); fs.writeFileSync(s4, JSON.stringify({ ...rd(s4), theme: 'dark' }));
    const r = await cli(['restore'], { CLAUDE_CONFIG_DIR: undefined, BOARDER_CLAUDE_DIRS: undefined });
    assert.equal(r.code, 0, r.err);
    assert.ok(!fs.existsSync(path.join(env3, '.claude.json')) || !rd(path.join(env3, '.claude.json')).mcpServers?.boarder, 'CLAUDE_CONFIG_DIR 폴더 MCP 가 남음');
    assert.ok(!fs.existsSync(path.join(env3, 'settings.json')), 'CLAUDE_CONFIG_DIR 폴더 훅이 남음');
    assert.ok(!fs.existsSync(path.join(env3, 'skills', 'boarder')), 'CLAUDE_CONFIG_DIR 폴더 스킬이 남음');
    assert.equal(fs.readFileSync(path.join(env4, '.claude.json'), 'utf8'), '{"keep":1}\n', 'BOARDER_CLAUDE_DIRS 폴더 MCP 가 남음');
    const st = rd(s4); assert.equal(st.theme, 'dark'); assert.doesNotMatch(JSON.stringify(st), /hook (session-start|stop)/, 'BOARDER_CLAUDE_DIRS 폴더 훅이 남음');
    assert.ok(!fs.existsSync(path.join(env4, 'skills', 'boarder')));
  });
});

test('restore <폴더>: settings.json 이 다른 폴더 것과 링크로 같은 파일이면 그 파일은 안 건드리고 알림 — 다른 폴더 훅이 안 빠짐', async () => {
  await world(async ({ cli, H }) => {
    fs.writeFileSync(path.join(H, '.claude', 'settings.json'), '{}\n');
    fs.symlinkSync(path.join(H, '.claude', 'settings.json'), path.join(H, '.claude-accounts', 'b', 'settings.json'));
    assert.equal((await cli(['enable', 'report', '--yes'])).code, 0);
    const r = await cli(['restore', '~/.claude-accounts/b']);
    assert.equal(r.code, 0, r.err);
    assert.match(JSON.stringify(rd(path.join(H, '.claude', 'settings.json'))), /hook session-start/, '기본 폴더 훅이 같이 빠짐');
    assert.match(r.out, /shared/, r.out);
    assert.equal(rd(path.join(H, '.claude-accounts', 'b', '.claude.json')).mcpServers, undefined, '그 폴더 MCP 는 빠짐');
    assert.ok(fs.lstatSync(path.join(H, '.claude-accounts', 'b', 'settings.json')).isSymbolicLink(), '링크는 그대로');
  });
});

test('disable report: 그 뒤 사람이 설정을 바꿨어도 Boarder 훅 둘(시작 · Stop) · Codex notify 만 빠지고 나머지는 그대로', async () => {
  await world(async ({ cli, H }) => {
    assert.equal((await cli(['enable', 'report', '--yes'])).code, 0);
    const sp = path.join(H, '.claude-accounts', 'a', 'settings.json'), s = rd(sp);
    s.hooks.Stop.push({ hooks: [{ type: 'command', command: 'say done' }] }); s.theme = 'dark';
    fs.writeFileSync(sp, JSON.stringify(s, null, 2));
    const tp = path.join(H, '.codex', 'config.toml'); fs.appendFileSync(tp, '\n[mine]\ny = 2\n');
    const r = await cli(['disable', 'report', '--yes']);
    assert.equal(r.code, 0, r.err);
    const after = rd(sp);
    assert.deepEqual(after.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] });
    assert.equal(after.theme, 'dark');
    const toml = fs.readFileSync(tp, 'utf8');
    assert.doesNotMatch(toml, /codex-turn|mcp_servers\.boarder/); assert.match(toml, /\[mine\]\ny = 2/);
  });
});

test('Codex: 사람이 쓰던 notify 가 있으면 건드리지 않음(하나만 됨)', async () => {
  await world(async ({ cli, H }) => {
    const tp = path.join(H, '.codex', 'config.toml');
    fs.writeFileSync(tp, 'notify = ["my-notifier"]\nmodel = "x"\n');
    assert.equal((await cli(['enable', 'report', '--yes'])).code, 0);
    const toml = fs.readFileSync(tp, 'utf8');
    assert.ok(toml.startsWith('notify = ["my-notifier"]\nmodel = "x"\n'), toml);
    assert.doesNotMatch(toml, /codex-turn/);
  });
});
