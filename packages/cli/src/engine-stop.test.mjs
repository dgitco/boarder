import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DAEMON = pathToFileURL(fileURLToPath(new URL('./engine/daemon.mjs', import.meta.url))).href;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-stop-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let n = 0;
const child = (host, opt) => {
  const bh = path.join(TMP, 'b' + (++n)); fs.mkdirSync(bh, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(bh, 'device.json'), JSON.stringify({ token: 'tok-made-up', server: 'http://127.0.0.1:9', device_id: 'd-test', scope: 'member' }), { mode: 0o600 });
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    let inflight = 1; setTimeout(() => { inflight = 0; }, 1500);
    if (${host}) process.once('SIGTERM', async () => { console.log('stopping', inflight); while (inflight > 0) await new Promise(r => setTimeout(r, 100)); console.log('drained'); process.exit(0); });
    const D = await import(${JSON.stringify(DAEMON)});
    D.runDaemon(${JSON.stringify(opt)}).catch(e => console.log('daemon error', e.message));
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 400);
  `], { env: { PATH: process.env.PATH, HOME: TMP, BOARDER_HOME: bh }, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL' });   // 멈추면 SIGKILL — 「다시 보낸 SIGTERM」과 헷갈리지 않게
};

test('runDaemon({ hostStops: true }): 데몬이 신호를 다시 보내지 않음 — 품은 프로세스가 넣던 글을 끝까지(drained) · 0 으로 끝남', () => {
  const r = child(1, { hostStops: true });
  assert.equal(r.signal, null, r.stdout + r.stderr); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /stopping 1/); assert.match(r.stdout, /drained/);
});

test('runDaemon()(회원 기기): 지금처럼 같은 신호로 다시 끝냄 — 다른 처리기가 걸려 있어도(옵션으로만 판정)', () => {
  for (const host of [0, 1]) {
    const r = child(host, {});
    assert.equal(r.signal, 'SIGTERM', `host=${host} ` + r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /drained/, `host=${host}`);
  }
});
