// node --test packages/cli/src/slack-import.test.mjs
// boarder import slack: 묶음 상한 · 끊기면 이어서(로컬 표) · --dry-run 은 안 보냄 · 하루 상한(429)이면 멈추고 표를 남김. 자료는 다 지어낸 것.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-slack-'));
process.env.BOARDER_HOME = path.join(tmp, 'home');   // 실제 기기 설정은 안 읽음
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const { slackImport, batches, channelMessages, readExport, BATCH } = await import('./slack-import.mjs');

function exportDir(n = 1200) {
  const d = fs.mkdtempSync(path.join(tmp, 'exp-'));
  fs.writeFileSync(path.join(d, 'channels.json'), JSON.stringify([{ id: 'C0TEST0001', name: 'general', workspace: 'Example HQ', is_private: false, topic: '' }, { id: 'C0TEST0002', name: 'empty-one' }]));
  fs.writeFileSync(path.join(d, 'users.json'), JSON.stringify([{ id: 'U0EXAMPLE1', name: '가상 직원' }]));
  const lines = [{ ts: '1699999999.000001', subtype: 'channel_join', user: 'U0EXAMPLE1', text: '<@U0EXAMPLE1> has joined' }];
  for (let i = 0; i < n; i++) lines.push({ ts: `${1700000000 + i}.000100`, user: 'U0EXAMPLE1', text: `글 ${i} <@U0EXAMPLE1>`, ...(i % 10 === 1 ? { thread_ts: `${1700000000 + i - 1}.000100` } : {}) });
  lines.push('not json');
  fs.writeFileSync(path.join(d, 'C0TEST0001.ndjson'), lines.map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n') + '\n');
  return d;
}
// 가짜 서버: (채널, ts) 한 번만 — 실제 서버처럼 겹친 글은 skipped
function fakeServer({ failAt = -1, limitAt = -1 } = {}) {
  const rows = new Set(), calls = [];
  const post = async body => {
    calls.push(body.messages.length);
    if (calls.length - 1 === failAt) throw new Error('fetch failed');
    if (calls.length - 1 === limitAt) return { status: 429, j: { error: '하루 상한', left: 0 } };
    assert.ok(body.messages.length <= BATCH && Buffer.byteLength(JSON.stringify(body)) <= 4_000_000);
    let inserted = 0; for (const m of body.messages) { const k = `${body.channel.id}|${m.ts}`; if (!rows.has(k)) { rows.add(k); inserted++; } }
    return { status: 200, j: { ok: true, node: 'sl_000000000001', name: `Slack · #${body.channel.name}`, inserted, skipped: body.messages.length - inserted, bad: 0 } };
  };
  return { rows, calls, post };
}
const quiet = () => {};

test('읽기: 들어옴 알림 · 꼴 틀린 줄은 건너뜀, <@U…> 는 @이름, 뿌리 ts 그대로', () => {
  const d = exportDir(12), { channels, users } = readExport(d);
  const { msgs, noise } = channelMessages(d, channels[0], users);
  assert.equal(msgs.length, 12); assert.equal(noise, 2);
  assert.equal(msgs[0].text, '글 0 @가상 직원'); assert.equal(msgs[0].user_name, '가상 직원');
  assert.equal(msgs[1].thread_ts, '1700000000.000100');
});

test('묶음: 글 500 · 몸통 상한을 넘지 않음', () => {
  const big = Array.from({ length: 30 }, (_, i) => ({ ts: `${1700000000 + i}.000100`, text: 'x'.repeat(200_000) }));
  for (const b of batches(big, { id: 'C0TEST0001', name: 'g' })) assert.ok(Buffer.byteLength(JSON.stringify({ messages: b })) <= 3_600_000);
  assert.deepEqual(batches(Array.from({ length: 1200 }, (_, i) => ({ ts: String(i) })), {}).map(b => b.length), [500, 500, 200]);
});

test('--dry-run 은 아무것도 안 보내고 표도 안 씀', async () => {
  const d = exportDir(30), s = fakeServer(), mark = path.join(tmp, 'mark-dry.json');
  const r = await slackImport(d, { 'dry-run': true }, { post: s.post, log: quiet, mark });
  assert.deepEqual([s.calls.length, r.sent, fs.existsSync(mark)], [0, 30, false]);
});

test('끊기면 이어서: 둘째 묶음에서 망이 끊겨도 다시 돌리면 남은 것만 — 겹침 0', async () => {
  const d = exportDir(1200), mark = path.join(tmp, 'mark-resume.json');
  const s = fakeServer({ failAt: 1 });
  // 둘째 묶음이 계속 실패(다시 보내기 셋까지 — 여기선 첫 실패 뒤 성공)하도록: failAt 은 한 번만 → 다시 보내기로 넘어감
  const r1 = await slackImport(d, {}, { post: s.post, log: quiet, mark, wait: async () => {} });
  assert.equal(r1.sent, 1200); assert.equal(s.rows.size, 1200);
  // 이번엔 표가 있는 채로 다시: 보낼 것 없음
  const before = s.calls.length;
  const r2 = await slackImport(d, {}, { post: s.post, log: quiet, mark, wait: async () => {} });
  assert.equal(s.calls.length, before); assert.equal(r2.sent, 0); assert.equal(r2.channels, 1);
});

test('하루 상한(429)이면 멈추고 표를 남김 → 다음에 그 묶음부터', async () => {
  const d = exportDir(1200), mark = path.join(tmp, 'mark-limit.json'), s = fakeServer({ limitAt: 1 });
  const r1 = await slackImport(d, {}, { post: s.post, log: quiet, mark, wait: async () => {} });
  assert.equal(r1.stopped, 'limit'); assert.equal(s.rows.size, 500);
  assert.equal(JSON.parse(fs.readFileSync(mark, 'utf8')).chans.C0TEST0001.last_ts, '1700000499.000100');
  const r2 = await slackImport(d, {}, { post: s.post, log: quiet, mark, wait: async () => {} });
  assert.equal(r2.sent, 700); assert.equal(s.rows.size, 1200);
  assert.deepEqual(s.calls.slice(-2), [500, 200]);   // 첫 묶음은 다시 안 보냄
});

test('표를 지우고 다시 돌려도 서버가 겹침을 막음(건너뜀으로 셈)', async () => {
  const d = exportDir(40), s = fakeServer();
  await slackImport(d, {}, { post: s.post, log: quiet, mark: path.join(tmp, 'm-a.json') });
  const r = await slackImport(d, {}, { post: s.post, log: quiet, mark: path.join(tmp, 'm-b.json') });
  assert.deepEqual([r.sent, s.rows.size], [0, 40]); assert.ok(r.skipped >= 40);
});

test('채널 수 상한(429 + max_channels)은 그 채널만 건너뛰고 다음 채널로', async () => {
  const d = exportDir(10);
  fs.writeFileSync(path.join(d, 'channels.json'), JSON.stringify([{ id: 'C0TEST0001', name: 'capped' }, { id: 'C0TEST0003', name: 'ok' }]));
  fs.copyFileSync(path.join(d, 'C0TEST0001.ndjson'), path.join(d, 'C0TEST0003.ndjson'));
  const s = fakeServer(), post = async b => b.channel.id === 'C0TEST0001' ? { status: 429, j: { error: '채널 수 상한', max_channels: 1 } } : s.post(b);
  const r = await slackImport(d, {}, { post, log: quiet, mark: path.join(tmp, 'm-cap.json'), wait: async () => {} });
  assert.deepEqual([r.stopped, r.capped, r.channels, r.sent], [undefined, 1, 1, 10]);
});
