// node --test packages/cli/src/settings.test.mjs — boarder 설정 명령의 인자 → 서버 값 · 되돌리는 명령(지어낸 값). 서버까지의 끝에서 끝 시험은 apps/web/worker/device-settings.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { valueOf, undoOf, SETTINGS_COMMANDS } = await import('./settings.mjs');

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
