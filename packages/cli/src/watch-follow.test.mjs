// node --test packages/cli/src/watch-follow.test.mjs — 들여오기 서비스의 기기 상태 간격: 주인 여부는 서버 답으로(ee 모듈이 든 호스팅 꾸러미의 회원 기기도 1분) · 지어낸 값, 바깥 호출 없음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const T = mkdtempSync(path.join(os.tmpdir(), 'bx-follow-'));
process.env.BOARDER_HOME = T; process.env.HOME = T; delete process.env.CLAUDE_CONFIG_DIR;   // 이 기기의 진짜 계정 · 자격 파일을 안 읽게
writeFileSync(path.join(T, 'device.json'), JSON.stringify({ token: 'bxd_' + 'x'.repeat(40), server: 'https://board.test' }));
let me = { owner: false, scope: 'full' }; const calls = [];
globalThis.fetch = async (u, o = {}) => { calls.push(`${o.method || 'GET'} ${new URL(u).pathname}`); return new Response(JSON.stringify(String(u).endsWith('/api/device/me') ? me : { ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }); };
const W = await import('./watch.mjs');
test('묻기 전 · 회원 기기 = 1분, 서버가 주인이라 하면(ee 모듈 있을 때) 5분 — 꾸러미에 ee 가 들었는지로 정하지 않음', async () => {
  assert.equal(W.followMetricsMs(), 60_000, '아직 모름 = 1분');
  await W.sendMetrics(); assert.equal(W.followMetricsMs(), 60_000, '회원 기기(ee 모듈이 있어도) 1분');
  me = { owner: true, scope: 'full' }; await W.sendMetrics();
  assert.equal(W.followMetricsMs(), 60_000, '주인 기기도 ee 없으면 1분');
  me = { owner: false, scope: 'watch' }; await W.sendMetrics(); assert.equal(W.followMetricsMs(), 60_000, '감시 기기(scope watch)도 주인');
  assert.deepEqual(calls.filter(c => c.startsWith('POST')), Array(3).fill('POST /api/device/metrics'));
});
