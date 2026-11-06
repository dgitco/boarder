// node --test packages/cli/src/settings.test.mjs — boarder 설정 명령의 인자 → 서버 값 · 되돌리는 명령(지어낸 값). 서버까지의 끝에서 끝 시험은 apps/web/worker/device-settings.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { valueOf, undoOf, SETTINGS_COMMANDS, COMMAND_KEYS, windowsPath, settingsCommand } = await import('./settings.mjs');
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('인자 → 값: on/off · off 는 지움 · 빠지면 사용법(undefined · null)', () => {
  assert.equal(valueOf('task-channels', ['on'], {}), true);
  assert.equal(valueOf('task-channels', ['off'], {}), false);
  assert.equal(valueOf('task-channels', ['yes'], {}), null);
  assert.equal(valueOf('task-repo', ['off'], {}), '');
  assert.equal(valueOf('task-repo', [], {}), null);
  assert.equal(valueOf('primary-window', ['off'], {}), null);
  assert.equal(valueOf('primary-window', [], {}), undefined);
  assert.deepEqual(valueOf('pins', [], { none: true }), []);
  assert.equal(valueOf('pins', [], {}), null);
  assert.deepEqual(valueOf('front-door', [], { name: '비서실장', fold: ['가', '나'] }), { name: '비서실장', fold: ['가', '나'] });
  assert.equal(valueOf('front-door', [], { name: '비서실장' }), undefined, '접을 노드 없이는 사용법');
  assert.equal(valueOf('front-door', ['off'], {}), null);
  assert.equal(valueOf('bot', [], {}), null);
  assert.deepEqual(valueOf('pins', ['a1b2=내 제목', 'c3d4', 'https://x.test/canvas/e5f6'], {}), [{ id: 'a1b2', title: '내 제목' }, 'c3d4', 'https://x.test/canvas/e5f6'], 'id=제목');
  assert.deepEqual(valueOf('front-door', [], { name: '앞', fold: ['가'], alias: ['가', '옛 이름'] }), { name: '앞', fold: ['가'], aliases: ['가', '옛 이름'] });
});
test('되돌리는 명령: 전 값으로 다시 set — 따옴표 · 빈 값', () => {
  assert.equal(undoOf('task-channels', true), 'boarder task-channels set on');
  assert.equal(undoOf('task-repo', ''), 'boarder task-repo set off');
  assert.equal(undoOf('primary-window', 'window:host1:tmux:3'), "boarder primary-window set 'window:host1:tmux:3'");
  assert.equal(undoOf('pins', []), 'boarder pins set --none');
  assert.equal(undoOf('pins', [{ id: 'a1b2', title: 'x' }, { id: 'c3d4', title: "y'z" }]), "boarder pins set 'a1b2=x' 'c3d4=y'\\''z'", '제목까지');
  assert.equal(undoOf('pins', [{ id: 'a1b2', title: 'a1b2' }]), "boarder pins set 'a1b2'", '제목이 id 그대로면 안 붙임');
  assert.equal(undoOf('bot', "O'Neil"), "boarder bot set --name 'O'\\''Neil'");
  assert.equal(undoOf('bot', null), null);
  assert.equal(undoOf('front-door', null), 'boarder front-door set off');
  assert.equal(undoOf('front-door', { name: '앞', pairs: [{ pane: '%1', name: '가' }], aliases: [] }), "boarder front-door set --name '앞' --fold '가'");
  assert.equal(undoOf('front-door', { name: '앞', pairs: [{ pane: '%1', name: '나' }, { pane: '%2', name: '가' }], aliases: ['가', '나'] }), "boarder front-door set --name '앞' --fold '가' --fold '나'", 'aliases 순서를 따르되 짝 이름만');
  assert.equal(undoOf('front-door', { name: '앞', pairs: [{ pane: '%1', name: '가' }, { pane: '%2', name: '가' }], aliases: ['없는 이름'] }), "boarder front-door set --name '앞' --fold '가' --alias '없는 이름'", '없는 이름은 --fold 로 안 씀(404)');
});
test('명령 이름이 기존 명령과 안 겹침', () => {
  for (const c of ['log', 'ask', 'role', 'status', 'canvas', 'device', 'taskboard']) assert.ok(!SETTINGS_COMMANDS.includes(c), c);
});

test('pairsOf: k=v 쌍 · 점 한 단계 · --json — 칸마다 값 꼴이 다름', async () => {
  const { pairsOf, undoOf, valueOf } = await import('./settings.mjs');
  assert.deepEqual(pairsOf('node-values', ['move_h=5', 'check_min=60'], {}), { move_h: 5, check_min: 60 });
  assert.deepEqual(pairsOf('prefs', ['park_on=false', 'park_h=12', 'rules.report=false', 'bundles.priority-file=false', 'primary_item=auto'], {}), { park_on: false, park_h: 12, rules: { report: false }, bundles: { 'priority-file': false }, primary_item: 'auto' });
  assert.deepEqual(pairsOf('ui', ['theme=dark', 'still=1'], {}), { theme: 'dark', still: '1' }, 'ui 값은 글 그대로');
  assert.deepEqual(pairsOf('features', ['taskboard=on', 'devboard=off'], {}), { taskboard: true, devboard: false });
  assert.equal(pairsOf('features', ['taskboard=maybe'], {}), undefined);
  assert.equal(pairsOf('prefs', ['nonsense'], {}), undefined); assert.equal(pairsOf('prefs', [], {}), undefined);
  assert.equal(valueOf('unit', ['goal'], {}), 'goal'); assert.equal(valueOf('unit', ['x'], {}), undefined);
  assert.equal(valueOf('session-sync', ['off'], {}), false);
  assert.deepEqual(valueOf('side-hide', [], { none: true }), []); assert.deepEqual(valueOf('side-hide', ['feed'], {}), ['feed']);
  assert.match(undoOf('unit', 'goal'), /boarder unit set goal/); assert.equal(undoOf('session-sync', true), null, '켜기는 사람 몫'); assert.equal(undoOf('session-sync', false), 'boarder session-sync set off');
  assert.equal(undoOf('node-values', { move_h: 24, check_min: 30 }), 'boarder node-values set move_h=24 check_min=30'); assert.equal(undoOf('ui', { accent: '#ff8800', font: "Noto 'Sans'" }), `boarder ui set accent='#ff8800' font='Noto '\\''Sans'\\'''`, 'ui 값은 셸 인용');
  assert.equal(undoOf('ui', {}), null, '전 값이 없던 칸은 되돌릴 값 없음');
  assert.equal(undoOf('avatar', { seed: 'fox', hue: 20, photo: 'a'.repeat(32) }), `boarder avatar set --seed 'fox' --hue 20 --photo-id ${'a'.repeat(32)}`); assert.match(undoOf('avatar', { seed: 'fox', hue: 20 }), /--no-photo/);
  assert.equal(undoOf('features', { taskboard: false }), 'boarder features set taskboard=off'); assert.match(undoOf('prefs', { park_h: 6 }), /prefs set --json -/); assert.match(undoOf('side-hide', []), /--none/);
});

test('화면 칸 ↔ 명령 대조: 서버 설정 KEYS 마다 CLI 명령이 하나씩 있고 그 반대도 — 칸을 더하고 명령을 빼먹으면 여기서 걸림', () => {
  const src = readFileSync(new URL('../../../apps/web/worker/device-settings.ts', import.meta.url), 'utf8');
  const keys = JSON.parse(/export const KEYS = (\[[^\]]+\]) as const/.exec(src)[1]);
  assert.deepEqual([...keys].sort(), [...COMMAND_KEYS].sort());
  assert.ok(SETTINGS_COMMANDS.includes('devices'));
});

test('boarder windows 질의: --since 30m · 2h · 1d 는 지금부터 거꾸로 밀리초 · 그 밖은 그대로 · 빈 플래그는 안 보냄', () => {
  const now = 1_762_340_000_000;
  assert.equal(windowsPath({}, now), '/api/device/windows');
  assert.equal(windowsPath({ since: '2h', task: '4321' }, now), `/api/device/windows?since=${now - 7_200_000}&task=4321`);
  assert.equal(windowsPath({ since: '30m' }, now), `/api/device/windows?since=${now - 1_800_000}`);
  assert.equal(windowsPath({ since: '1d', limit: '50', cursor: 'abc_-' }, now), `/api/device/windows?since=${now - 86_400_000}&limit=50&cursor=abc_-`);
  assert.equal(windowsPath({ since: '2026-11-05T21:00:00+09:00', task: true }, now), '/api/device/windows?since=2026-11-05T21%3A00%3A00%2B09%3A00', 'ISO 는 그대로 · 값 없는 --task 는 안 보냄');
  assert.equal(windowsPath({ since: '30d', closed: '1' }, now), `/api/device/windows?since=${now - 30 * 86_400_000}&closed=1`, '30일 창에서 닫힌 창을 다시 넣기');
  assert.ok(SETTINGS_COMMANDS.includes('windows') && SETTINGS_COMMANDS.includes('window'), '창 하나(window) 와 모든 창(windows) 둘 다');
});

async function avatarUpload({ status, code, stage = 'init', network = false }, check) {
  const root = mkdtempSync(path.join(tmpdir(), 'boarder-avatar-')), beforeHome = process.env.BOARDER_HOME;
  const previousFetch = globalThis.fetch, previousLog = console.log, calls = [], output = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]), id = 'a'.repeat(32);
  process.env.BOARDER_HOME = root;
  writeFileSync(path.join(root, 'device.json'), JSON.stringify({ token: 'bxd_fake-test-token', server: 'https://example.test' }));
  const photo = path.join(root, 'avatar.png'); writeFileSync(photo, png);
  console.log = s => output.push(String(s));
  const response = (body, httpStatus = 200) => new Response(JSON.stringify(body), { status: httpStatus, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, options) => {
    const endpoint = new URL(url).pathname; calls.push(endpoint);
    if (endpoint === '/api/device/avatar-image/init' && stage === 'part') return response({ id: 'b'.repeat(32), size: png.length, partSize: png.length, parts: 1 });
    if (endpoint === '/api/device/avatar-image/' + stage) {
      if (network) throw new Error('network failure');
      return response({ error: code === 'direct_upload_unavailable' ? '직접 올리기 설정이 아직 준비되지 않았어요' : 'test failure', ...(code ? { code } : {}) }, status);
    }
    if (endpoint === '/api/device/avatar-image') {
      assert.deepEqual(options.body, png, '구형 경로에는 원래 작은 사진 바이트');
      assert.equal(options.headers['content-type'], 'application/octet-stream');
      return response({ ok: true, id });
    }
    if (endpoint === '/api/device/settings') {
      assert.deepEqual(JSON.parse(options.body), { key: 'avatar', value: { photo: id } });
      return response({ ok: true, before: { seed: 'nova', hue: 20 }, after: { seed: 'nova', hue: 20, photo: id } });
    }
    throw new Error('unexpected endpoint');
  };
  try { await check({ run: () => settingsCommand('avatar', 'set', [], { photo }), calls, output, id }); }
  finally {
    globalThis.fetch = previousFetch; console.log = previousLog;
    if (beforeHome === undefined) delete process.env.BOARDER_HOME; else process.env.BOARDER_HOME = beforeHome;
    rmSync(root, { recursive: true, force: true });
  }
}

test('아바타 CLI는 초기화 지원 없음·설정 누락에만 구형 사진 업로드 후 기존 설정을 저장한다', async t => {
  for (const scenario of [{ status: 404 }, { status: 405 }, { status: 415 }, { status: 501 }, { status: 503, code: 'direct_upload_unavailable' }]) {
    await t.test(String(scenario.status), () => avatarUpload(scenario, async ({ run, calls, output, id }) => {
      await run();
      assert.deepEqual(calls, ['/api/device/avatar-image/init', '/api/device/avatar-image', '/api/device/settings']);
      assert.equal(JSON.parse(output[0]).after.photo, id);
    }));
  }
});

test('아바타 CLI는 인증·권한·크기·일반503·네트워크·조각 실패에 구형 업로드를 하지 않는다', async t => {
  for (const scenario of [{ status: 401 }, { status: 403 }, { status: 413 }, { status: 503 }, { network: true }, { status: 404, stage: 'part' }]) {
    await t.test(JSON.stringify(scenario), () => avatarUpload(scenario, async ({ run, calls }) => {
      await assert.rejects(run());
      assert.equal(calls.includes('/api/device/avatar-image'), false);
      assert.equal(calls.includes('/api/device/settings'), false);
    }));
  }
});
