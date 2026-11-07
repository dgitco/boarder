import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const board = readFileSync(new URL('../board-template/page.html', import.meta.url), 'utf8');
const shell = readFileSync(new URL('./legacy/shell.js', import.meta.url), 'utf8');

test('메인 채널의 제목은 응답자 이름을 바꿔도 #메인', () => {
  const line = board.match(/^  const ttl = .*$/m)![0];
  for (const name of ['비서실장', '모찌']) {
    const ctx: any = {tab: 'chat', cur: {chan: 'primary'}, nameOf: () => name};
    vm.runInNewContext(line + '\n; this.title = ttl;', ctx);
    assert.equal(ctx.title, '#메인');
  }
});

test('채널 머리에서 이름 변경이 에이전트 이름을 바꾸지 않음', () => {
  const line = board.match(/^const hdrRenameKind = .*$/m)![0];
  const ctx: any = {cur: {chan: 'primary'}, nodeTree: () => true};
  vm.runInNewContext(line + '\n; this.kind = hdrRenameKind;', ctx);
  assert.equal(ctx.kind(), '');
  ctx.cur = {chan: 'n:작업'}; ctx.isNodeCh = () => true;
  assert.equal(ctx.kind(), 'node');
});

test('에이전트 채널 메뉴는 대화 대신 목록을 열고 에이전트 메뉴는 기본 탭으로 복귀', () => {
  const src = shell.slice(shell.indexOf('  function go(g){'), shell.indexOf('  function sideClick'));
  const fn = src.slice(0, src.indexOf("    if (g === 'find')")) + '\n}';
  const opened: string[] = [];
  const ctx = {closeDr() {}, S: {ag: 'x', ret: null}, agOpen: (t: string) => opened.push(t)};
  vm.runInNewContext(fn + '; this.go = go;', ctx);
  (ctx as any).go('agent-channels'); (ctx as any).go('agents');
  assert.deepEqual(opened, ['x', 'a']);
});
