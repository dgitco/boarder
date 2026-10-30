// node --test packages/cli/src/importer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { refsOf, normRepo, tomlMcp, frontmatter, collectMcp } from './importer.mjs';

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
