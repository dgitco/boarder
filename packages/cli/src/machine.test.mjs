// node --test packages/cli/src/machine.test.mjs — 컴퓨터 열쇠(x-boarder-machine): 지어낸 기계 id 로 열쇠 만들기 · 기기 토큰 요청에만 실림 ·
//   boarder watch --once(자식 node, 127.0.0.1 가짜 서버) · 엔진 데몬 WebSocket 머리. 바깥 호출 없음, 원문 기계 id 는 열쇠 밖으로 안 나감
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { machineKey, machineKeyOf, withMachine, installMachineHeader, MACHINE_HEADER } from './machine.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-machine-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const expect = id => createHash('sha256').update('boarder-machine:' + id).digest('hex').slice(0, 32);
const FAKE = '0123456789abcdef0123456789abcdef';   // 지어낸 /etc/machine-id
const DEV = 'bxd_' + 'x'.repeat(40);

test('열쇠 = sha256("boarder-machine:" + 기계 id) 앞 32자 — 리눅스 · 맥 · 윈도우 · hostname 순, 원문은 안 담김', () => {
  const none = () => { throw new Error('없음'); };
  const k = machineKey({ platform: 'linux', read: p => p === '/etc/machine-id' ? FAKE + '\n' : none(), exec: none, hostname: () => 'h' });
  assert.equal(k, expect(FAKE)); assert.match(k, /^[0-9a-f]{32}$/); assert.equal(k.includes(FAKE), false);
  assert.equal(machineKey({ platform: 'linux', read: p => p === '/var/lib/dbus/machine-id' ? 'dbus-id' : none(), hostname: () => 'h' }), expect('dbus-id'), '/etc/machine-id 가 없으면 dbus 것');
  assert.equal(machineKey({ platform: 'linux', read: () => '  \n', hostname: () => 'srv' }), expect('srv'), '빈 파일이면 hostname');
  const ioreg = '+-o J314sAP  <class IOPlatformExpertDevice>\n    "IOPlatformSerialNumber" = "X"\n    "IOPlatformUUID" = "11111111-2222-3333-4444-555555555555"\n';
  assert.equal(machineKey({ platform: 'darwin', exec: (c, a) => c === 'ioreg' && a.includes('IOPlatformExpertDevice') ? ioreg : '', hostname: () => 'h' }), expect('11111111-2222-3333-4444-555555555555'));
  const reg = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    aaaa-bbbb-cccc\r\n';
  assert.equal(machineKey({ platform: 'win32', exec: c => c === 'reg' ? reg : '', hostname: () => 'h' }), expect('aaaa-bbbb-cccc'));
  assert.equal(machineKey({ platform: 'darwin', exec: none, hostname: () => 'mac.local' }), expect('mac.local'), 'ioreg 가 없으면 hostname');
  assert.equal(machineKey({ platform: 'win32', exec: none, hostname: () => '' }), '', '다 없으면 빈 값(머리 안 실음)');
  assert.equal(machineKeyOf('a'), expect('a'));
  assert.equal(machineKey(), machineKey(), '이 컴퓨터 값은 늘 같음');
});

test('withMachine: 기기 토큰(Bearer bxd_) 요청에만 · 창 토큰 · 머리 없음 · 이미 있으면 그대로, 꼴(객체 · Headers · 배열) 유지', () => {
  const K = expect(FAKE);
  assert.deepEqual(withMachine({ authorization: `Bearer ${DEV}`, 'content-type': 'a' }, K), { authorization: `Bearer ${DEV}`, 'content-type': 'a', [MACHINE_HEADER]: K });
  const win = { authorization: 'Bearer bxa_' + 'y'.repeat(40) }; assert.equal(withMachine(win, K), win, '창 토큰은 안 실음');
  const other = { authorization: 'Bearer sk-ant-x' }; assert.equal(withMachine(other, K), other, '남의 서버 토큰은 안 실음');
  const has = { authorization: `Bearer ${DEV}`, [MACHINE_HEADER]: 'f'.repeat(32) }; assert.equal(withMachine(has, K), has);
  const H = withMachine(new Headers({ Authorization: `Bearer ${DEV}` }), K); assert.ok(H instanceof Headers); assert.equal(H.get(MACHINE_HEADER), K);
  const A = withMachine([['authorization', `Bearer ${DEV}`]], K); assert.ok(Array.isArray(A)); assert.equal(new Headers(A).get(MACHINE_HEADER), K);
  const bare = { authorization: `Bearer ${DEV}` }; assert.equal(withMachine(bare, ''), bare, '열쇠가 없으면 안 실음');
});

test('installMachineHeader: fetch 를 한 번만 감싸 기기 토큰 요청(init · Request 둘 다)에 열쇠 · 다른 요청은 그대로', async () => {
  const seen = [], g = { fetch: async (input, init) => { seen.push(new Headers(init?.headers ?? input.headers).get(MACHINE_HEADER)); return new Response('{}'); } };
  installMachineHeader(g); const once = g.fetch; installMachineHeader(g); assert.equal(g.fetch, once, '두 번 감싸지 않음');
  await g.fetch('http://x/api/device/me', { headers: { authorization: `Bearer ${DEV}` } });
  await g.fetch('http://x/api/agent/inbox_log', { method: 'POST', headers: { authorization: 'Bearer bxa_' + 'y'.repeat(40) } });
  await g.fetch(new Request('http://x/api/device/metrics', { method: 'POST', headers: { authorization: `Bearer ${DEV}` }, body: '{}' }));
  await g.fetch('http://x/', {});
  assert.deepEqual(seen, [machineKey(), null, machineKey(), null]);
});

test('열쇠는 bxd_ 확인을 지난 뒤에만 계산 — 창 토큰 · 머리 없는 요청에선 안 부름', async () => {
  let n = 0; const spy = () => { n++; return 'c'.repeat(32); };
  withMachine({ authorization: 'Bearer bxa_' + 'y'.repeat(40) }, spy); withMachine({ 'content-type': 'a' }, spy); withMachine({ authorization: `Bearer ${DEV}`, [MACHINE_HEADER]: 'f'.repeat(32) }, spy);
  assert.equal(n, 0, '기기 토큰 아님 · 이미 있음 = 안 부름');
  assert.equal(withMachine({ authorization: `Bearer ${DEV}` }, spy)[MACHINE_HEADER], 'c'.repeat(32)); assert.equal(n, 1);
  const g = { fetch: async () => new Response('{}') }; installMachineHeader(g, spy);
  await g.fetch('http://x/api/agent/inbox_log', { headers: { authorization: 'Bearer bxa_' + 'y'.repeat(40) } }); await g.fetch('http://x/');
  assert.equal(n, 1, '감싼 fetch 도 창 토큰 요청에선 안 부름');
});

test('맥(가짜 ioreg): 창 토큰 요청만 보내면 ioreg 가 안 돌고, 기기 토큰 요청 둘엔 한 번만 돎(프로세스에 기억)', () => {
  const bin = path.join(TMP, 'fakebin'), log = path.join(TMP, 'ioreg.log'); fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'ioreg'), `#!/bin/sh\necho run >> ${JSON.stringify(log)}\necho '    "IOPlatformUUID" = "FAKE-UUID-1"'\n`, { mode: 0o755 });
  const M = pathToFileURL(fileURLToPath(new URL('./machine.mjs', import.meta.url))).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const fs = await import('node:fs'); const M = await import(${JSON.stringify(M)});
    const seen = []; globalThis.fetch = async (u, o) => { seen.push(new Headers(o?.headers).get('x-boarder-machine')); return new Response('{}'); };
    M.installMachineHeader();
    for (let i = 0; i < 3; i++) await fetch('http://x/api/agent/inbox_log', { method: 'POST', headers: { authorization: 'Bearer bxa_${'y'.repeat(40)}' } });
    const before = fs.existsSync(${JSON.stringify(log)}) ? fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').length : 0;
    for (let i = 0; i < 2; i++) await fetch('http://x/api/device/me', { headers: { authorization: 'Bearer ${DEV}' } });
    const after = fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').length;
    console.log(JSON.stringify({ before, after, seen }));
  `], { env: { PATH: bin + ':' + process.env.PATH, HOME: TMP }, encoding: 'utf8', timeout: 15000 });
  const o = JSON.parse(r.stdout.trim().split('\n').pop() || '{}');
  assert.equal(o.before, 0, '창 토큰 요청 셋 — ioreg 안 돎 ' + r.stderr);
  assert.equal(o.after, 1, '기기 토큰 요청 둘 — ioreg 한 번');
  assert.deepEqual(o.seen, [null, null, null, expect('FAKE-UUID-1'), expect('FAKE-UUID-1')]);
});

// 가짜 서버(127.0.0.1): 받은 요청의 길 · 열쇠 머리만 남김(토큰 값은 안 남김)
async function fakeServer() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push({ path: req.url.split('?')[0], dev: /^Bearer bxd_/.test(req.headers.authorization || ''), machine: req.headers[MACHINE_HEADER] ?? null });
    req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(req.url.startsWith('/api/device/me') ? JSON.stringify({ owner: false, scope: 'full' }) : '{"ok":true}'); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { hits, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise(r => srv.close(r)) };
}
const home = (server, n) => { const bh = path.join(TMP, n); fs.mkdirSync(bh, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(bh, 'device.json'), JSON.stringify({ token: DEV, server, device_id: 'd-test' }), { mode: 0o600 }); return bh; };

test('boarder watch --once(자식 node): 상태 보내기 · 기기 확인 요청에 이 컴퓨터 열쇠가 실림', async () => {
  const s = await fakeServer();
  try {
    const bh = home(s.url, 'w');
    const bin = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
    const r = await new Promise(res => { const p = spawn(process.execPath, [bin, 'watch', '--once'], { env: { PATH: process.env.PATH, HOME: TMP, BOARDER_HOME: bh }, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d); const t = setTimeout(() => p.kill('SIGKILL'), 20000); p.on('close', code => { clearTimeout(t); res({ code, out }); }); });
    const dev = s.hits.filter(h => h.dev);
    assert.ok(dev.some(h => h.path === '/api/device/metrics'), r.out + JSON.stringify(s.hits));
    assert.deepEqual([...new Set(dev.map(h => h.machine))], [machineKey()], '기기 토큰 요청은 모두 같은 열쇠');
    assert.equal(r.out.includes(machineKey()), false, '열쇠도 출력에 안 나옴');
  } finally { await s.close(); }
});

test('엔진 데몬 WebSocket: 붙을 때 머리에 열쇠(서버 하네스 어댑터처럼 runDaemon 을 바로 부름)', () => {
  const bh = home('http://127.0.0.1:9', 'e');
  const DAEMON = pathToFileURL(fileURLToPath(new URL('./engine/daemon.mjs', import.meta.url))).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.WebSocket = class { constructor(u, o) { console.log('WS ' + JSON.stringify(o?.headers?.['x-boarder-machine'] ?? null)); setTimeout(() => this.onclose?.({ code: 4401 })); } close() {} send() {} };
    const D = await import(${JSON.stringify(DAEMON)});
    await D.runDaemon({ hostStops: true });
  `], { env: { PATH: process.env.PATH, HOME: TMP, BOARDER_HOME: bh }, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL' });
  assert.match(r.stdout, new RegExp(`WS "${machineKey()}"`), r.stdout + r.stderr);
});
