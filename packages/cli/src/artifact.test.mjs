import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { artifactHook, publishTool, acctLabel, resultInfo, stage, hookNote } from './artifact.mjs';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-art-'));
const UUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', ID = UUID.replace(/-/g, '');
const result = o => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
const recorder = () => { const calls = []; return { calls, put: async (folder, flags) => { calls.push({ flags, files: fs.readdirSync(folder).sort(), index: fs.readFileSync(path.join(folder, 'index.html'), 'utf8'), folder }); } }; };

test('publishTool: 게시 도구 셋만, 서버 이름에 artifact 가 든 것만', () => {
  for (const n of ['publish_version', 'publish_files', 'edit_version']) assert.equal(publishTool(`mcp__claude-artifacts__${n}`), n);
  assert.equal(publishTool('mcp__claude-artifacts__list_artifacts'), null);
  assert.equal(publishTool('mcp__other__publish_version'), null);
  assert.equal(publishTool('Bash'), null);
});

test('publish_version: content 와 결과의 slug · title 로, id 는 UUID 에서 「-」 뗌 · acct 는 CLAUDE_CONFIG_DIR 폴더 이름', async () => {
  const r = recorder();
  const out = await artifactHook({ tool_name: 'mcp__claude-artifacts__publish_version', tool_input: { content: '<h1>안녕</h1>' }, tool_response: result({ slug: UUID, title: '월간 보고' }) },
    { put: r.put, env: { CLAUDE_CONFIG_DIR: '/x/.claude-accounts/acct-2/' }, home: TMP });
  assert.deepEqual(out, { ok: true, id: ID });
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.calls[0].flags, { id: ID, title: '월간 보고', acct: 'acct-2' });
  assert.equal(r.calls[0].index, '<h1>안녕</h1>');
  assert.equal(fs.existsSync(r.calls[0].folder), false, '임시 폴더는 지움');
});

test('publish_files: 실제 꼴 배열 [{as, path}] → 게시 경로(as) 대로 index.html · 하위 폴더 파일이 한 폴더로', async () => {
  const src = fs.mkdtempSync(path.join(TMP, 'src-'));
  fs.writeFileSync(path.join(src, 'page.html'), '<link href="css/site.css">'); fs.writeFileSync(path.join(src, 's.css'), 'a{}');
  const r = recorder();
  const out = await artifactHook({ tool_name: 'mcp__claude-artifacts__publish_files', cwd: src, tool_input: { files: [{ as: 'index.html', path: path.join(src, 'page.html') }, { as: 'css/site.css', path: path.join(src, 's.css') }] }, tool_response: result({ url: `https://claude.ai/artifact/${UUID}`, title: 'T' }) },
    { put: r.put, env: {}, home: TMP });
  assert.equal(out.ok, true);
  assert.deepEqual(r.calls[0].files, ['css', 'index.html']);
  assert.equal(r.calls[0].index, '<link href="css/site.css">');
  assert.equal(r.calls[0].flags.id, ID);
});

test('결과가 블록 배열 · 글(JSON 아님)이어도 id · 제목을 뽑음', () => {
  assert.equal(resultInfo([{ type: 'text', text: JSON.stringify({ slug: UUID, title: '배열' }) }]).id, ID);
  assert.equal(resultInfo([{ type: 'text', text: JSON.stringify({ slug: UUID, title: '배열' }) }]).title, '배열');
  const t = resultInfo([{ type: 'text', text: `Published "월간 표" https://claude.ai/code/artifact/${UUID}` }]);
  assert.equal(t.id, ID);
  assert.equal(resultInfo(`slug ${UUID} done`).id, ID, 'slug 꼴 UUID');
  assert.equal(resultInfo([{ type: 'text', text: 'nothing here' }]).id, null);
});

test('stage: 링크 · 비밀 꼴 이름(.env · id_rsa · *.pem · 점 파일)은 안 올라감 — 링크 → 폴더 밖 비밀 파일 포함', () => {
  const src = fs.mkdtempSync(path.join(TMP, 'sec-')), outside = fs.mkdtempSync(path.join(TMP, 'out-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP-SECRET');
  fs.writeFileSync(path.join(src, 'page.html'), 'ok'); fs.writeFileSync(path.join(src, '.env'), 'K=1'); fs.writeFileSync(path.join(src, 'id_rsa'), 'k'); fs.writeFileSync(path.join(src, 'a.pem'), 'k'); fs.writeFileSync(path.join(src, 'fine.js'), '1');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(src, 'link.txt'));
  const logs = [];
  const dir = stage('publish_files', { files: [{ as: 'index.html', path: path.join(src, 'page.html') }, { as: 'fine.js', path: path.join(src, 'fine.js') }, { as: 'x.txt', path: path.join(src, 'link.txt') }, { as: 'e.txt', path: path.join(src, '.env') }, { as: 'k.txt', path: path.join(src, 'id_rsa') }, { as: 'p.txt', path: path.join(src, 'a.pem') }, { as: '.env', path: path.join(src, 'fine.js') }] }, { cwd: src, log: m => logs.push(m) });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['fine.js', 'index.html']);
  assert.ok(!JSON.stringify(fs.readdirSync(dir)).includes('secret')); assert.ok(logs.length >= 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('올리기가 시간 상한을 넘으면 포기하고 던지지 않음 · 임시 폴더도 지움', async () => {
  let folder;
  const out = await artifactHook({ tool_name: 'mcp__claude-artifacts__publish_version', tool_input: { content: 'x' }, tool_response: result({ slug: UUID }) },
    { put: f => { folder = f; return new Promise(() => {}); }, timeoutMs: 50 });
  assert.match(out.error, /gave up/); assert.equal(fs.existsSync(folder), false);
});

test('edit_version: 올릴 HTML(content · file_path)이 없으면 건너뜀', async () => {
  const r = recorder();
  const out = await artifactHook({ tool_name: 'mcp__claude-artifacts__edit_version', tool_input: { edits: [] }, tool_response: result({ slug: UUID }) }, { put: r.put, env: {}, home: TMP });
  assert.ok(out.skipped); assert.equal(r.calls.length, 0);
  const logs = []; await artifactHook({ tool_name: 'mcp__claude-artifacts__edit_version', tool_input: { edits: [] }, tool_response: result({ slug: UUID }) }, { put: r.put, log: m => logs.push(m) });
  assert.match(logs[0], /nothing to upload/, '건너뛸 때 한 줄 로그');
});

test('게시 아닌 도구 · 실패한 게시 · id 없는 결과는 올리지 않음', async () => {
  const r = recorder(), base = { tool_input: { content: 'x' }, tool_response: result({ slug: UUID }) };
  assert.ok((await artifactHook({ ...base, tool_name: 'mcp__claude-artifacts__list_artifacts' }, { put: r.put })).skipped);
  assert.ok((await artifactHook({ ...base, tool_name: 'Bash' }, { put: r.put })).skipped);
  assert.ok((await artifactHook({ ...base, tool_name: 'mcp__claude-artifacts__publish_version', tool_response: { isError: true, content: [{ type: 'text', text: 'boom' }] } }, { put: r.put })).skipped);
  assert.ok((await artifactHook({ ...base, tool_name: 'mcp__claude-artifacts__publish_version', tool_response: result({ ok: true }) }, { put: r.put })).skipped);
  assert.equal(r.calls.length, 0);
});

test('올리기가 던져도 artifactHook 은 던지지 않고 임시 폴더도 지움', async () => {
  let folder; const logs = [];
  const out = await artifactHook({ tool_name: 'mcp__claude-artifacts__publish_version', tool_input: { content: 'x' }, tool_response: result({ slug: UUID }) },
    { put: async f => { folder = f; throw new Error('서버 502'); }, log: m => logs.push(m) });
  assert.equal(out.error, '서버 502'); assert.equal(fs.existsSync(folder), false); assert.match(logs[0], /서버 502/);
});

test('acctLabel: 폴더 이름 → 없으면 기본 .claude.json 의 계정 메일 → 없으면 undefined', () => {
  assert.equal(acctLabel({ CLAUDE_CONFIG_DIR: '/h/.claude-b' }, TMP), 'claude-b');
  assert.equal(acctLabel({}, TMP), undefined);
  fs.writeFileSync(path.join(TMP, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'a@b.co' } }));
  assert.equal(acctLabel({}, TMP), 'a@b.co');
});

// 진짜 훅 길: 깨진 입력 · 기기 없음 · 일회성 실행(sdk) 어디서든 출력 없이 끝 코드 0
const run = (stdin, env = {}) => new Promise(res => {
  const H = fs.mkdtempSync(path.join(TMP, 'h-'));
  const c = spawn(process.execPath, [BIN, 'hook', 'artifact'], { env: { ...process.env, HOME: H, BOARDER_HOME: path.join(H, 'b'), BOARDER_SERVER: 'http://127.0.0.1:9', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; c.stdout.on('data', d => out += d); c.on('close', code => res({ code, out })); c.stdin.end(stdin);
});
test('boarder hook artifact: 깨진 입력 · 기기 없음 · sdk 실행에서도 출력 없이 0', async () => {
  const good = JSON.stringify({ tool_name: 'mcp__claude-artifacts__publish_version', tool_input: { content: 'x' }, tool_response: result({ slug: UUID }) });
  for (const [stdin, env] of [['not json', {}], [good, {}], [good, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }]]) { const r = await run(stdin, env); assert.equal(r.code, 0); assert.equal(r.out, ''); }
});

test('hookNote: 실패면 「보더 주소 아직 없음」 + 다시 올리는 법(그 id), 성공이면 진짜 주소, 건너뜀이면 빈 글', () => {
  const e = hookNote({ error: '캔버스 수 상한', id: 'abcdef0123456789abcd' });
  assert.match(e, /올리기 실패: 캔버스 수 상한/); assert.match(e, /보더 주소\(\/art\/…\)는 아직 없어요/); assert.match(e, /--id abcdef0123456789abcd/);
  assert.equal(hookNote({ ok: true, id: 'x', url: 'https://example.test/art/x/' }), '보더 캔버스에도 올렸어요: https://example.test/art/x/');
  assert.equal(hookNote({ ok: true, id: 'x' }), ''); assert.equal(hookNote({ skipped: 'not a publish tool' }), ''); assert.equal(hookNote(undefined), '');
});
test('artifactHook: 성공이면 서버가 준 주소를 싣고, put 이 던지면 그 아티팩트 id 를 실음', async () => {
  const ok = await artifactHook({ tool_name: 'mcp__claude-artifacts__publish_version', tool_input: { content: 'x' }, tool_response: result({ slug: UUID }) },
    { put: async () => ({ ok: true, url: 'https://example.test/art/u/' }) });
  assert.equal(ok.url, 'https://example.test/art/u/');
  const bad = await artifactHook({ tool_name: 'mcp__claude-artifacts__publish_version', tool_input: { content: 'x' }, tool_response: result({ slug: UUID }) },
    { put: async () => { throw Object.assign(new Error('캔버스 수 상한'), { status: 429 }); } });
  assert.equal(bad.error, '캔버스 수 상한'); assert.equal(bad.id, UUID.replace(/-/g, ''));
});
test('boarder hook artifact: 기기는 있는데 서버가 안 닿으면 끝 코드 0 + 에이전트에게 실패 한 줄(PostToolUse additionalContext JSON)', async () => {
  const H = fs.mkdtempSync(path.join(TMP, 'hd-')), B = path.join(H, 'b'); fs.mkdirSync(B, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: 'bxd_' + 'z'.repeat(40), server: 'http://127.0.0.1:9', device_id: 'dev-test' }), { mode: 0o600 });
  const good = JSON.stringify({ tool_name: 'mcp__claude-artifacts__publish_version', tool_input: { content: '<!doctype html><title>t</title>x' }, tool_response: result({ slug: UUID }) });
  const r = await new Promise(res => {
    const c = spawn(process.execPath, [BIN, 'hook', 'artifact'], { env: { ...process.env, HOME: H, BOARDER_HOME: B, CLAUDE_CODE_ENTRYPOINT: 'cli' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', d => out += d); c.on('close', code => res({ code, out })); c.stdin.end(good);
  });
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out.trim());
  assert.equal(o.hookSpecificOutput.hookEventName, 'PostToolUse'); assert.match(o.hookSpecificOutput.additionalContext, /보더 캔버스로 올리기 실패/);
  assert.match(o.hookSpecificOutput.additionalContext, /아직 없어요/);
});
