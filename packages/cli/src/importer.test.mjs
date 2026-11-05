// node --test packages/cli/src/importer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { ownPaneKeep, agentInFront, refsOf, normRepo, tomlMcp, frontmatter, collectMcp, since, sameAsSent, markSent, SAME_MAX, codexSessions, apiFail } from './importer.mjs';

test('링크 뽑기: Slack 스레드 · GitHub 이슈/PR · Linear · 리포 안 #번호', () => {
  const r = refsOf('see https://acme.slack.com/archives/C0000000001/p1700000000000100 and https://github.com/Acme/Ledger/pull/88 and linear.app/acme/issue/ENG-12 fix #3720', 'github.com/acme/ledger');
  assert.deepEqual(r.sort(), ['gh:acme/ledger#3720', 'gh:acme/ledger#88', 'linear:ENG-12', 'slack:C0000000001/1700000000.000100'].sort());
});
test('리포 주소: 사용자:비번 · .git 떼고 같은 꼴', () => {
  assert.equal(normRepo('https://x:ghp_secret@github.com/Acme/Ledger.git'), 'github.com/acme/ledger');
  assert.equal(normRepo('git@github.com:acme/ledger.git'), 'github.com/acme/ledger');
});
test('Codex config.toml: MCP 이름 · 주소 · 명령만, env 값은 안 읽음', () => {
  const t = tomlMcp('model = "gpt-5"\n[mcp_servers.github]\ncommand = "gh-mcp"\nargs = ["serve"]\nenv = { GITHUB_TOKEN = "ghp_LEAK" }\n[mcp_servers.notion]\nurl = "https://mcp.notion.com/mcp"\n[mcp_servers.notion.http_headers]\nAuthorization = "Bearer LEAK2"\n[profiles.fast]\nmodel = "o4"\n');
  assert.equal(t.github.command, 'gh-mcp'); assert.ok(t.github.env); assert.equal(t.notion.url, 'https://mcp.notion.com/mcp'); assert.ok(t.notion.headers);
  assert.ok(!JSON.stringify(t).includes('LEAK'));
});
test('MCP 모으기: 비밀값(env · 머리 · 주소 쿼리)은 안 나가고 있었다는 표시만', () => {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-imp-')), old = process.env.HOME, oc = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.HOME = H;
    fs.writeFileSync(path.join(H, '.claude.json'), JSON.stringify({ mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp?key=LEAK3' }, zap: { type: 'sse', url: 'https://mcp.zapier.com/api/mcp/s/aB3dE5fG7hJ9kL1mN3pQ5LEAK6/sse' }, pw: { command: '/usr/bin/npx', args: ['@playwright/mcp', '--token', 'LEAK4'], env: { T: 'LEAK5' } }, boarder: { command: 'boarder', args: ['mcp'] } } }));
    const m = collectMcp([]);
    assert.ok(!JSON.stringify(m).includes('LEAK'));
    assert.deepEqual(m.map(x => [x.name, x.transport, x.url || x.command, x.secrets]), [['linear', 'http', 'https://mcp.linear.app/mcp', true], ['zap', 'sse', 'https://mcp.zapier.com/api/mcp/s/_/sse', true], ['pw', 'stdio', 'npx', true]]);
  } finally { process.env.HOME = old; if (oc) process.env.CLAUDE_CONFIG_DIR = oc; fs.rmSync(H, { recursive: true, force: true }); }
});
test('역할 문서 머리말', () => {
  const { meta, body } = frontmatter('---\nname: reviewer\ndescription: "PR 리뷰"\nmodel: opus\n---\n# 리뷰\n본문');
  assert.equal(meta.name, 'reviewer'); assert.equal(meta.description, 'PR 리뷰'); assert.match(body, /본문/);
});

test('장부 줄 없는 창의 state_at: 같은 상태면 처음 본 때 그대로, 상태가 바뀌면 그때로(1분마다 Date.now() 라 늘 「바뀜」)', () => {
  assert.equal(since('window:h:tmux:9', 'working', 1000), 1000);
  assert.equal(since('window:h:tmux:9', 'working', 61_000), 1000);
  assert.equal(since('window:h:tmux:9', 'idle', 121_000), 121_000);
  assert.equal(since('window:h:tmux:9', 'idle', 181_000), 121_000);
  assert.equal(since('window:h:tmux:8', 'idle', 181_000), 181_000, '창마다 따로');
});
test('--follow 같은 목록: 보낸 지 5분 안이면 안 보냄, 5분 넘거나 다르면 보냄', () => {
  assert.equal(sameAsSent('a', 0), false, '보낸 적 없으면 보냄');
  markSent('a', 1000);
  assert.equal(sameAsSent('a', 1000 + 60_000), true);
  assert.equal(sameAsSent('b', 1000 + 60_000), false);
  assert.equal(sameAsSent('a', 1000 + SAME_MAX), false);
});

test('Codex 세션: `codex exec` 로 돈 기록(originator codex_exec)은 세션 줄로 안 올림 — SDK 대화(source exec, 다른 originator)는 올림', () => {
  const C = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-cdx-')), old = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = C;
    const d = new Date(), dir = path.join(C, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    fs.mkdirSync(dir, { recursive: true });
    const roll = (name, id, meta) => fs.writeFileSync(path.join(dir, `rollout-${name}.jsonl`), [
      JSON.stringify({ type: 'session_meta', payload: { id, cwd: '/tmp/made-up', timestamp: d.toISOString(), ...meta } }),
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: `${name} 일 해 줘` }] } }),
    ].join('\n') + '\n');
    roll('cli', 'aaaaaaaa-0000-4000-8000-000000000001', { originator: 'codex_cli_rs', source: 'cli' });
    roll('exec1', 'aaaaaaaa-0000-4000-8000-000000000002', { originator: 'codex_exec', source: 'exec' });
    roll('sdk', 'aaaaaaaa-0000-4000-8000-000000000003', { originator: 'codex_sdk_ts', source: 'exec' });
    roll('exec3', 'aaaaaaaa-0000-4000-8000-000000000004', { originator: 'codex_exec' });
    roll('exec4', 'aaaaaaaa-0000-4000-8000-000000000005', { originator: 'codex_exec', source: { subagent: {} } });
    assert.deepEqual(codexSessions(1).map(s => s.key).sort(), ['session:codex:aaaaaaaa-0000-4000-8000-000000000001', 'session:codex:aaaaaaaa-0000-4000-8000-000000000003']);
  } finally { if (old === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = old; fs.rmSync(C, { recursive: true, force: true }); }
});

test('JSON 아닌 서버 실패 줄: 메서드 · 경로를 붙이고 쿼리 · 토큰은 안 남김', () => {
  assert.equal(apiFail('GET', '/api/topics', 500), 'Boarder 500 GET /api/topics');
  assert.equal(apiFail('POST', '/api/import?token=bxd_secret&x=1#h', 502), 'Boarder 502 POST /api/import');
  assert.ok(!apiFail('GET', '/api/x?token=bxd_secret', 500).includes('secret'));
});

const pane = (o) => ({ pane: '%1', wid: '@1', bx: '', cmd: 'claude', ...o });
test('판 거르기: 엔진 창(@bx_id) 안의 판은 나눈 판까지 모두 빠짐 → 엔진 창 항목 하나만 남음', () => {
  const four = [pane({ pane: '%188', wid: '@183', bx: 'ew_rw565d8c906d', cmd: 'claude' }), pane({ pane: '%358', wid: '@183', bx: 'ew_rw565d8c906d', cmd: 'codex' }), pane({ pane: '%360', wid: '@183', bx: 'ew_rw565d8c906d', cmd: 'codex' }), pane({ pane: '%362', wid: '@183', bx: 'ew_rw565d8c906d', cmd: 'zsh' })];
  const eng = new Set(['ew_rw565d8c906d']);
  assert.deepEqual(four.filter(p => ownPaneKeep(p, { live: true, engIds: eng })), []);
});
test('판 거르기: 앞에서 도는 것이 셸뿐인 판은 빠짐(예전 codex 표지가 남아도)', () => {
  assert.equal(ownPaneKeep(pane({ cmd: 'zsh' }), { live: false, fg: false }), false);
  assert.equal(ownPaneKeep(pane({ cmd: '-bash' }), { live: false, fg: false }), false);
  assert.equal(ownPaneKeep(pane({ cmd: 'fish' }), { live: false, fg: false }), false);
});
test('판 거르기: 한 창에 에이전트 판 둘(정말 두 대화)은 둘 다 남음 · 셸 앞이어도 살아 있는 Claude 면 남음', () => {
  const two = [pane({ pane: '%10', wid: '@50', cmd: 'claude' }), pane({ pane: '%11', wid: '@50', cmd: 'node' })];
  assert.equal(two.filter(p => ownPaneKeep(p, { live: false })).length, 2);
  assert.equal(ownPaneKeep(pane({ cmd: 'zsh' }), { live: true }), true);
});
test('판 거르기: 다른 tmux 서버와 창 번호(@N)가 같아도 @bx_id 가 없으면 남음', () => {
  assert.equal(ownPaneKeep(pane({ wid: '@183', cmd: 'claude' }), { live: false }), true);
});

test('판 거르기: zsh -c · sh -c 로 띄운 에이전트(판의 앞 그룹)는 상태 파일이 없어도 남음', () => {
  const pt = new Map([[100, { ppid: 1, pgid: 100, tpgid: 100, args: 'sh -c cd X && codex' }], [101, { ppid: 100, pgid: 100, tpgid: 100, args: 'node /opt/codex/bin/codex' }]]);
  assert.equal(agentInFront(100, 101, pt), true);
  assert.equal(ownPaneKeep(pane({ cmd: 'sh' }), { live: false, fg: agentInFront(100, 101, pt) }), true);
  assert.equal(ownPaneKeep(pane({ cmd: 'zsh' }), { live: false, fg: true }), true);
});
test('판 거르기: 대화형 셸로 돌아온 뒤 남은 자식(다른 그룹 · 상태 파일 없음)만 빈 판으로 빠짐', () => {
  const pt = new Map([[200, { ppid: 1, pgid: 200, tpgid: 200, args: '-zsh' }], [201, { ppid: 200, pgid: 201, tpgid: 200, args: 'node codex' }]]);
  assert.equal(agentInFront(200, 201, pt), false);
  assert.equal(ownPaneKeep(pane({ cmd: 'zsh' }), { live: false, fg: agentInFront(200, 201, pt) }), false);
  assert.equal(agentInFront(999, 201, pt), true);   // 표에 없으면 앞으로 봄(남기는 쪽)
});
test('판 거르기: 엔진 목록을 못 읽었거나 그 엔진 창이 목록에 없으면 @bx_id 판을 빼지 않음', () => {
  const p = pane({ pane: '%188', wid: '@183', bx: 'ew_rw565d8c906d', cmd: 'claude' });
  assert.equal(ownPaneKeep(p, { live: true, engIds: null }), true);
  assert.equal(ownPaneKeep(p, { live: true, engIds: new Set(['ew_other']) }), true);
  assert.equal(ownPaneKeep(p, { live: true, engIds: new Set(['ew_rw565d8c906d']) }), false);
});
