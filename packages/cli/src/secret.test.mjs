// node --test packages/cli/src/secret.test.mjs (Node 22+ — 전역 WebSocket)
// boarder secret fill: 가짜 Boarder 서버 + 가짜 Chrome(CDP /json + WebSocket)에 대고 돌려, 값이 stdout · stderr 에 (숫자만 · 묶음 꼴로도) 안 나오고
// Chrome 의 격리 컨텍스트로만 가는지, 값은 기기 토큰으로만 받는지, 거절 · 다른 사이트 탭이면 넣지 않는지 봄. 값 · 토큰은 지어낸 것.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { writeMask } from './secret.mjs';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const VALUE = '4111-1111-1111-1111', FORMS = [VALUE, VALUE.replace(/\D/g, ''), '4111 1111 1111 1111', '41111111'];
const DEV = 'bxd_made-up-device-token-0123456789abcdef', WIN = 'bxa_made-up-window-token-0123456789abcdef';

// 아주 작은 WebSocket 서버(텍스트 틀만) — CDP 흉내
function wsServe(srv, onMsg) {
  srv.on('upgrade', (req, sock) => {
    const acc = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
    const send = s => { const b = Buffer.from(s); const h = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]); sock.write(Buffer.concat([h, b])); };
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 15; let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + 4 + len) return;
        const mask = buf.subarray(off, off + 4), p = Buffer.from(buf.subarray(off + 4, off + 4 + len)).map((x, i) => x ^ mask[i % 4]);
        buf = buf.subarray(off + 4 + len);
        if (op === 8) { sock.end(); return; }
        if (op === 1) onMsg(JSON.parse(p.toString()), send);
      }
    });
    sock.on('error', () => {});
  });
}

async function rig({ decision = 'approved', tabUrl = 'https://shop.example/checkout', policy = 'ask', wsUrl, navigateAfter, field = 'input', value = VALUE, kind = 'browser', tmuxTarget = 'demo:1.2', tmuxFail, tmuxPane = '123 %3 456\n', tmuxRecheck = '123 %3 456\n', tmuxMarker = true, tmuxBufferRemains = false, tmuxPaneDead = false, tmuxSignal, maskFailure = false, noPorts = false } = {}) {
  const hits = [], cdpLog = [];
  let polls = 0, origin = new URL(tabUrl).origin;
  const writes = [], events = [], styles = [];
  class Field {
    dispatchEvent(e) { events.push(e.type); }
    style = { setProperty: (...args) => styles.push(args) };
  }
  class Input extends Field {
    get value() { return this._value || ''; }
    set value(v) { this._value = v; writes.push({ origin, value: v }); }
  }
  class TextArea extends Field {}
  Object.defineProperty(TextArea.prototype, 'value', Object.getOwnPropertyDescriptor(Input.prototype, 'value'));
  const el = field === 'textarea' ? new TextArea() : new Input();
  // 프레임워크가 인스턴스 setter 를 덮어써도 native setter 를 써야 함.
  Object.defineProperty(el, 'value', { get() { return this._value || ''; }, set() { throw new Error('framework setter'); } });
  const api = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => {
      const auth = req.headers.authorization || '';
      hits.push({ method: req.method, url: req.url, auth, body: b, dev: req.headers['x-boarder-device'] });
      const j = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/api/device/window' && auth === `Bearer ${DEV}`) return j(200, { token: WIN });
      if (req.url === '/api/secrets/card/fill' && req.method === 'POST' && auth === `Bearer ${WIN}`) return j(200, { id: 'sr_1', state: policy === 'auto' ? 'approved' : 'pending' });
      if (req.url === '/api/secrets/requests/sr_1' && auth === `Bearer ${WIN}`) return j(200, { id: 'sr_1', state: ++polls < 2 ? 'pending' : decision, site: 'https://shop.example' });
      if (req.url === '/api/secrets/requests/sr_1/value') return auth === `Bearer ${DEV}` ? j(200, kind === 'tmux' ? { value, kind, site: `terminal:${tmuxTarget}`, tmux: tmuxTarget } : { value, kind, site: 'https://shop.example', selector: '#cc', tab: null }) : j(401, { error: '기기 토큰' });
      j(404, { error: 'no' });
    });
  });
  const chrome = http.createServer((req, res) => {
    const port = (chrome.address()?.port || 9222);
    if (req.url === '/json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify([{ id: 'T1', type: 'page', url: tabUrl, webSocketDebuggerUrl: wsUrl || `ws://127.0.0.1:${port}/devtools/page/T1` }])); }
    res.writeHead(404); res.end();
  });
  wsServe(chrome, (m, send) => {
    cdpLog.push(m);
    let v = {};
    if (m.method === 'Page.getFrameTree') v = { frameTree: { frame: { id: 'F1' } } };
    if (m.method === 'Page.createIsolatedWorld') {
      assert.equal(m.params.frameId, 'F1');
      v = { executionContextId: 7 };
    }
    if (m.method === 'Runtime.evaluate') {
      assert.equal(m.params.contextId, 7);
      assert.ok(fs.readdirSync(path.join(H, '.local', 'state', 'boarder', 'secret-masks.d')).some(name => /^[a-f0-9]{16}\.json$/.test(name)), '입력 전에 지문 저장');
      const value = runInNewContext(m.params.expression, {
        location: { origin }, document: { querySelector: q => { assert.equal(q, '#cc'); return el; } },
        HTMLInputElement: Input, HTMLTextAreaElement: TextArea, Event: class { constructor(type) { this.type = type; } },
      });
      assert.ok(['ok', 'origin', 'missing', 'notinput', 'empty'].includes(value), '값을 반환하지 않음');
      v = { result: { type: 'string', value } };
    }
    if (m.method === 'Input.insertText') writes.push({ origin, value: m.params.text });
    if (m.method === navigateAfter) origin = 'https://evil.example';
    send(JSON.stringify({ id: m.id, result: v }));
  });
  if (!noPorts) await Promise.all([new Promise(r => api.listen(0, '127.0.0.1', r)), new Promise(r => chrome.listen(0, '127.0.0.1', r))]);
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-secret-')), B = path.join(H, 'boarder');
  fs.mkdirSync(B, { mode: 0o700 });
  fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: DEV, device_id: 'd1', server: `http://127.0.0.1:${(api.address()?.port || 1)}` }));
  const fakeBin = path.join(H, 'bin'), tmuxLog = path.join(H, 'tmux.jsonl');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'tmux'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const input = fs.readFileSync(0, 'utf8');
{
  const args = process.argv.slice(2);
  const D = path.join(process.env.HOME, '.local/state/boarder/secret-masks.d');
  const masks = args[0] === 'load-buffer' && fs.existsSync(D) ? fs.readdirSync(D).map(n => fs.readFileSync(path.join(D, n), 'utf8')) : [];
  fs.appendFileSync(process.env.TMUX_LOG, JSON.stringify({ args, input, env: process.env, masks }) + '\\n');
  if (args[0] === process.env.TMUX_FAIL) {
    fs.writeSync(1, ${JSON.stringify(value)}); fs.writeSync(2, ${JSON.stringify(value)}); process.exit(1);
  }
  const bufferFile = process.env.TMUX_LOG + '.buffer', markerFile = process.env.TMUX_LOG + '.marker';
  if (args[0] === 'display-message') fs.writeSync(1, ${JSON.stringify(tmuxPane)});
  if (args[0] === 'load-buffer') {
    const event = name => fs.appendFileSync(process.env.TMUX_LOG + '.events', name + '\\n');
    if (${JSON.stringify(tmuxSignal)} !== undefined) {
      process.kill(process.ppid, ${JSON.stringify(tmuxSignal)});
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      fs.writeFileSync(bufferFile, input);
      event('created');
      event('child-exit');
      process.exit(0);
    }
    fs.writeFileSync(bufferFile, input);
    const matches = ${JSON.stringify(tmuxRecheck)} !== null && ${JSON.stringify(tmuxRecheck)}?.trim() === ${JSON.stringify(tmuxPane)}.trim();
    const live = !${JSON.stringify(tmuxPaneDead)} || !args[9].includes('#{==:#{pane_dead},0}');
    const commands = (matches && live ? args[10] : args[11]).split(' ; ');
    event(matches && live ? 'then' : 'else');
    for (const command of commands) {
      const words = command.split(' ');
      if (words[0] === process.env.TMUX_FAIL) process.exit(1);
      if (['paste-buffer', 'delete-buffer'].includes(words[0]) && !${JSON.stringify(tmuxBufferRemains)}) fs.unlinkSync(bufferFile);
      if (words[0] === 'set-option' && ${JSON.stringify(tmuxMarker)}) fs.writeFileSync(markerFile, ${JSON.stringify(tmuxMarker)} === 'stale' ? 'stale' : words.at(-1));
    }
  }
  if (args[0] === 'show-buffer') {
    if (!fs.existsSync(bufferFile)) process.exit(1);
    fs.writeSync(1, fs.readFileSync(bufferFile));
  }
  if (args[0] === 'show-options') {
    if (!fs.existsSync(markerFile)) process.exit(1);
    fs.writeSync(1, fs.readFileSync(markerFile));
  }
  if (args[0] === 'delete-buffer') {
    fs.appendFileSync(process.env.TMUX_LOG + '.events', 'delete-buffer\\n');
    if (fs.existsSync(bufferFile)) fs.unlinkSync(bufferFile);
  }
  if (args[0] === 'set-option' && fs.existsSync(markerFile)) fs.unlinkSync(markerFile);
}
`, { mode: 0o700 });
  const env = { ...process.env, HOME: H, BOARDER_HOME: B, BOARDER_WINDOW: 'w1', PATH: `${fakeBin}:${process.env.PATH}`, TMUX_LOG: tmuxLog, ...(tmuxFail ? { TMUX_FAIL: tmuxFail } : {}) };
  delete env.BOARDER_TOKEN;
  const cli = args => new Promise(res => {
    const script = `
      import fs from 'node:fs';
      console.log = (...args) => fs.writeSync(1, args.join(' ') + '\\n');
      console.error = (...args) => fs.writeSync(2, args.join(' ') + '\\n');
      if (${JSON.stringify(maskFailure)}) {
        const { syncBuiltinESMExports } = await import('node:module');
        const read = fs.readFileSync;
        fs.readFileSync = (file, ...args) => {
          const raw = read(file, ...args);
          if (String(file).includes('secret-masks.d/') && String(file).endsWith('.json')) {
            const saved = JSON.parse(raw); saved.entries[0].h = '00'.repeat(32);
            return JSON.stringify(saved);
          }
          return raw;
        };
        syncBuiltinESMExports();
      }
      globalThis.fetch = async (url, options = {}) => {
        const u = new URL(url), headers = options.headers || {};
        fs.appendFileSync(${JSON.stringify(path.join(H, 'hits.jsonl'))}, JSON.stringify({ method: options.method || 'GET', url: u.pathname, auth: headers.authorization, dev: headers['x-boarder-device'], body: options.body || '' }) + '\\n');
        if (u.pathname.endsWith('/fill')) return Response.json({ id: 'sr_1', state: ${JSON.stringify(policy === 'auto' ? 'approved' : 'pending')} });
        if (u.pathname.endsWith('/value')) return Response.json(${JSON.stringify(kind === 'tmux' ? { value, kind, site: `terminal:${tmuxTarget}`, tmux: tmuxTarget } : { value, kind, site: 'https://shop.example', selector: '#cc', tab: null })});
        return Response.json({ id: 'sr_1', state: ${JSON.stringify(decision)} });
      };
      const { main } = await import(${JSON.stringify(new URL('./main.mjs', import.meta.url).href)});
      await main(${JSON.stringify(args)});
    `;
    const c = spawn(process.execPath, noPorts ? ['--input-type=module', '-e', script] : [BIN, ...args], { env: noPorts ? { ...env, BOARDER_TOKEN: WIN } : env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    const t = setTimeout(() => c.kill('SIGKILL'), 20000);
    c.on('close', code => { clearTimeout(t); if (noPorts && fs.existsSync(path.join(H, 'hits.jsonl'))) hits.splice(0, hits.length, ...fs.readFileSync(path.join(H, 'hits.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)); res({ code, out, err }); });
  });
  const close = () => { api.close(); chrome.closeAllConnections?.(); chrome.close(); fs.rmSync(H, { recursive: true, force: true }); };
  return { cli, hits, cdpLog, tmuxCalls: () => fs.existsSync(tmuxLog) ? fs.readFileSync(tmuxLog, 'utf8').trim().split('\n').map(JSON.parse) : [], close, cdp: String((chrome.address()?.port || 9222)), H, B, writes, events, styles };
}
const noValue = (s, where) => { for (const f of FORMS) assert.ok(!s.includes(f), `${where} 에 값(${f.length}자 꼴)`); };

test('허용 → 기기 토큰으로 값 → CDP 격리 컨텍스트로만 · 가림 — 찍힌 글엔 요청 id · 상태 · filled 만', async () => {
  const r = await rig();
  try {
    const o = await r.cli(['secret', 'fill', 'card', '--site', 'https://shop.example/checkout', '--selector', '#cc', '--cdp', r.cdp]);
    assert.equal(o.code, 0, o.err);
    noValue(o.out, 'stdout'); noValue(o.err, 'stderr');
    assert.match(o.out, /^request sr_1: pending\nrequest sr_1: approved\nfilled\n$/);
    assert.deepEqual(r.writes, [{ origin: 'https://shop.example', value: VALUE }], '허용된 사이트에만 입력');
    assert.deepEqual(r.events, ['input', 'change']);
    assert.deepEqual(r.styles, [['-webkit-text-security', 'disc', 'important']]);
    assert.equal(r.cdpLog.filter(m => m.method === 'Runtime.evaluate').length, 1);
    assert.ok(!r.cdpLog.some(m => m.method === 'Input.insertText'));
    const vh = r.hits.filter(h => h.url.endsWith('/value'));
    assert.equal(vh.length, 1); assert.equal(vh[0].auth, `Bearer ${DEV}`, '값은 기기 토큰으로만');
    assert.equal(r.hits.find(h => h.url === '/api/secrets/card/fill').auth, `Bearer ${WIN}`, '요청은 창 토큰으로');
    assert.deepEqual(JSON.parse(r.hits.find(h => h.url === '/api/secrets/card/fill').body), { site: 'https://shop.example/checkout', selector: '#cc' });
  } finally { r.close(); }
});

test('넣기 전 독립 지문 파일: HMAC · 길이 · 1시간 기한 · 0600/0700 · 만료 파일 청소', async () => {
  const r = await rig({ policy: 'auto' });
  try {
    const D = path.join(r.H, '.local', 'state', 'boarder', 'secret-masks.d');
    fs.mkdirSync(D, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(D, 'aaaaaaaaaaaaaaaa.json'), JSON.stringify({ entries: [{ h: 'aa'.repeat(32), n: 4, exp: 1 }] }), { mode: 0o600 });
    fs.writeFileSync(path.join(D, 'bbbbbbbbbbbbbbbb.json'), JSON.stringify({ entries: [{ h: 'bb'.repeat(32), n: 6, exp: Math.floor(Date.now() / 1000) + 600 }] }), { mode: 0o600 });
    const t0 = Math.floor(Date.now() / 1000);
    const o = await r.cli(['secret', 'fill', 'card', '--site', 'https://shop.example', '--selector', '#cc', '--cdp', r.cdp]);
    assert.equal(o.code, 0, o.err); noValue(o.out + o.err, '출력');
    assert.equal(r.hits.find(h => h.url === '/api/secrets/card/fill').dev, DEV);
    const names = fs.readdirSync(D);
    assert.equal(names.length, 2);
    assert.ok(!names.includes('aaaaaaaaaaaaaaaa.json'));
    const name = names.find(n => n !== 'bbbbbbbbbbbbbbbb.json');
    assert.match(name, /^[a-f0-9]{16}\.json$/);
    const raw = fs.readFileSync(path.join(D, name), 'utf8'); noValue(raw, '지문 파일');
    assert.equal(fs.statSync(path.join(D, name)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(D).mode & 0o777, 0o700);
    const key = fs.readFileSync(path.join(r.B, 'secret-mask.key'));
    assert.equal(key.length, 32); assert.equal(fs.statSync(path.join(r.B, 'secret-mask.key')).mode & 0o777, 0o600);
    const { entries } = JSON.parse(raw);
    assert.equal(entries.length, 1);
    const e = entries[0];
    assert.equal(e.h, createHmac('sha256', key).update(VALUE.replace(/\D/g, '')).digest('hex'));
    assert.equal(e.n, 16); assert.ok(e.exp >= t0 + 3600 && e.exp <= t0 + 3605, String(e.exp));
    assert.deepEqual(Object.keys(e).sort(), ['exp', 'h', 'n']);
    assert.equal((await r.cli(['secret', 'fill', 'card', '--site', 'https://shop.example', '--selector', '#cc', '--cdp', r.cdp])).code, 0);
    assert.equal(fs.readdirSync(D).length, 3, '같은 값도 독립 파일');
    assert.deepEqual(fs.readdirSync(path.dirname(D)), ['secret-masks.d'], '공유 파일 · 잠금 없음');
  } finally { r.close(); }
});

test('두 동시 fill은 입력 전에 각자 검증 가능한 지문 파일을 남김', async () => {
  const r = await rig({ policy: 'auto' });
  try {
    const args = ['secret', 'fill', 'card', '--site', 'https://shop.example', '--selector', '#cc', '--cdp', r.cdp];
    const results = await Promise.all([r.cli(args), r.cli(args)]);
    for (const result of results) {
      assert.equal(result.code, 0, result.err);
      noValue(result.out + result.err, '출력');
    }
    assert.equal(r.writes.length, 2);
    const D = path.join(r.H, '.local', 'state', 'boarder', 'secret-masks.d');
    const names = fs.readdirSync(D);
    assert.equal(names.length, 2);
    const key = fs.readFileSync(path.join(r.B, 'secret-mask.key'));
    const h = createHmac('sha256', key).update(VALUE.replace(/\D/g, '')).digest('hex');
    for (const name of names) {
      assert.match(name, /^[a-f0-9]{16}\.json$/);
      const raw = fs.readFileSync(path.join(D, name), 'utf8'); noValue(raw, '지문 파일');
      const { entries } = JSON.parse(raw);
      assert.equal(entries.length, 1); assert.equal(entries[0].h, h);
      assert.equal(entries[0].n, 16); assert.ok(entries[0].exp > Date.now() / 1000);
    }
    assert.deepEqual(fs.readdirSync(path.dirname(D)), ['secret-masks.d']);
  } finally { r.close(); }
});

test('거절 → 값을 받지 않고 넣지 않음(끝 코드 1)', async () => {
  const r = await rig({ decision: 'denied' });
  try {
    const o = await r.cli(['secret', 'fill', 'card', '--site', 'https://shop.example', '--selector', '#cc', '--cdp', r.cdp]);
    assert.equal(o.code, 1); assert.match(o.err, /request sr_1: denied/);
    assert.ok(!r.hits.some(h => h.url.endsWith('/value'))); assert.equal(r.cdpLog.length, 0);
  } finally { r.close(); }
});

test('허용된 사이트가 아닌 탭 → 넣지 않음 · 오류 글에도 값 없음', async () => {
  const r = await rig({ policy: 'auto', tabUrl: 'https://evil.example/' });
  try {
    const o = await r.cli(['secret', 'fill', 'card', '--site', 'https://shop.example', '--selector', '#cc', '--cdp', r.cdp]);
    assert.equal(o.code, 1); assert.match(o.err, /not filled: no Chrome tab open on https:\/\/shop\.example/);
    noValue(o.out, 'stdout'); noValue(o.err, 'stderr');
    assert.ok(!r.cdpLog.some(m => m.method === 'Input.insertText'));
  } finally { r.close(); }
});

test('--cdp 는 이 기기만(원격 주소 거절) · 인자 모자라면 도움말', async () => {
  const r = await rig();
  try {
    const o = await r.cli(['secret', 'fill', 'card', '--site', 'https://shop.example', '--selector', '#cc', '--cdp', 'http://10.0.0.5:9222']);
    assert.equal(o.code, 1); assert.match(o.err, /local port/); assert.equal(r.hits.length, 0, '서버에 묻기 전에 거절');
    assert.equal((await r.cli(['secret', 'fill', 'card'])).code, 64);
  } finally { r.close(); }
});

for (const step of ['Page.getFrameTree', 'Page.createIsolatedWorld']) test(`명령 사이 이동(${step}) → 다른 사이트 필드에 입력하지 않음`, async () => {
  const r = await rig({ policy: 'auto', navigateAfter: step });
  try {
    const o = await r.cli(['secret', 'fill', 'card', '--site', 'https://shop.example', '--selector', '#cc', '--cdp', r.cdp]);
    assert.equal(o.code, 1); assert.match(o.err, /not filled: that tab is not on/);
    assert.deepEqual(r.writes, []); assert.deepEqual(r.events, []); assert.deepEqual(r.styles, []);
    noValue(o.out + o.err, '출력');
  } finally { r.close(); }
});

test('원격 webSocketDebuggerUrl → 연결 · 입력 거절', async () => {
  const r = await rig({ policy: 'auto', wsUrl: 'ws://remote.example:9222/devtools/page/T1' });
  try {
    const o = await r.cli(['secret', 'fill', 'card', '--site', 'https://shop.example', '--selector', '#cc', '--cdp', r.cdp]);
    assert.equal(o.code, 1); assert.match(o.err, /Chrome debugger must be local/);
    assert.deepEqual(r.cdpLog, []); assert.deepEqual(r.writes, []); noValue(o.out + o.err, '출력');
  } finally { r.close(); }
});

test('지문 저장 실패 → Chrome 에 값을 보내지 않고 오류', async () => {
  const r = await rig({ policy: 'auto' });
  try {
    const D = path.join(r.H, '.local', 'state', 'boarder');
    fs.mkdirSync(D, { recursive: true });
    fs.writeFileSync(path.join(D, 'secret-masks.d'), 'blocked');
    const o = await r.cli(['secret', 'fill', 'card', '--site', 'https://shop.example', '--selector', '#cc', '--cdp', r.cdp]);
    assert.equal(o.code, 1); assert.match(o.err, /not filled: could not record the redaction fingerprint/);
    assert.ok(!o.out.includes('filled')); assert.deepEqual(r.cdpLog, []); assert.deepEqual(r.writes, []);
    noValue(o.out + o.err, '출력');
  } finally { r.close(); }
});

test('textarea 도 native setter 로 입력 · 이벤트 · 가림', async () => {
  const r = await rig({ policy: 'auto', field: 'textarea' });
  try {
    const o = await r.cli(['secret', 'fill', 'card', '--site', 'https://shop.example', '--selector', '#cc', '--cdp', r.cdp]);
    assert.equal(o.code, 0, o.err); assert.equal(r.writes.length, 1);
    assert.deepEqual(r.events, ['input', 'change']); assert.equal(r.styles.length, 1); noValue(o.out + o.err, '출력');
  } finally { r.close(); }
});

test('writeMask 는 정규화 뒤 4자 미만을 고정 오류로 거절', () => {
  for (const value of ['', ' -./()+_ \t', 'a', 'a-b', 'A-b.C']) assert.throws(() => writeMask(value), { message: 'secret is too short to redact' });
});

for (const value of ['', ' -./()+_ \t', 'a', 'a-b', 'A-b.C']) test(`정규화 뒤 ${value.length}자 값이 너무 짧으면 입력하지 않음`, async () => {
  const r = await rig({ policy: 'auto', value });
  try {
    const o = await r.cli(['secret', 'fill', 'card', '--site', 'https://shop.example', '--selector', '#cc', '--cdp', r.cdp]);
    assert.equal(o.code, 1);
    assert.equal(o.err, 'not filled: could not record the redaction fingerprint\n');
    assert.deepEqual(r.cdpLog, []); assert.deepEqual(r.writes, []);
  } finally { r.close(); }
});

// 별도 프로세스로 동시에 저장해 독립 파일과 같은 키를 검증한다.
test('동시 fill 지문은 각자 파일에 남고 잠금 · 공유 파일 · 값이 없음', async () => {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-mask-')), B = path.join(H, 'boarder');
  const D = path.join(H, '.local', 'state', 'boarder', 'secret-masks.d');
  const module = new URL('./secret.mjs', import.meta.url).href;
  const values = [VALUE, '5555-4444-3333-2222'];
  const run = value => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', `import { writeMask } from ${JSON.stringify(module)}; writeMask(${JSON.stringify(value)});`], { env: { ...process.env, HOME: H, BOARDER_HOME: B }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    c.on('error', reject); c.on('close', code => { try { assert.equal(code, 0, err); assert.equal(out, ''); resolve(); } catch (e) { reject(e); } });
  });
  try {
    await Promise.all(values.map(run));
    const key = fs.readFileSync(path.join(B, 'secret-mask.key'));
    const names = fs.readdirSync(D), hashes = [];
    assert.equal(names.length, 2);
    assert.equal(fs.statSync(D).mode & 0o777, 0o700);
    for (const name of names) {
      assert.match(name, /^[a-f0-9]{16}\.json$/);
      const file = path.join(D, name), raw = fs.readFileSync(file, 'utf8');
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      for (const value of values) {
        assert.ok(!raw.includes(value)); assert.ok(!raw.includes(value.replace(/\D/g, '')));
      }
      const { entries } = JSON.parse(raw);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].n, 16);
      assert.ok(entries[0].exp > Date.now() / 1000);
      hashes.push(entries[0].h);
    }
    assert.deepEqual(hashes.sort(), values.map(v => createHmac('sha256', key).update(v.replace(/\D/g, '')).digest('hex')).sort());
    assert.deepEqual(fs.readdirSync(path.dirname(D)), ['secret-masks.d']);
  } finally { fs.rmSync(H, { recursive: true, force: true }); }
});


test('만료 파일만 청소하고 살아 있는 항목 · 잘못된 파일은 보존', () => {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-mask-clean-'));
  const D = path.join(H, '.local', 'state', 'boarder', 'secret-masks.d');
  try {
    fs.mkdirSync(D, { recursive: true, mode: 0o700 });
    const expired = { h: 'aa'.repeat(32), n: 4, exp: 1 };
    const live = { ...expired, exp: Math.floor(Date.now() / 1000) + 600 };
    const fixtures = { 'expired.json': { entries: [expired, expired] }, 'mixed.json': { entries: [expired, live] }, 'live.json': { entries: [live] }, 'empty.json': { entries: [] }, 'invalid.json': { entries: [null] } };
    for (const [name, body] of Object.entries(fixtures)) fs.writeFileSync(path.join(D, name), JSON.stringify(body));
    fs.utimesSync(path.join(D, 'live.json'), 1, 1);
    fs.writeFileSync(path.join(D, 'broken.json'), '{');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import { writeMask } from ${JSON.stringify(new URL('./secret.mjs', import.meta.url).href)}; writeMask('test-cleanup');`], { env: { ...process.env, HOME: H, BOARDER_HOME: path.join(H, 'boarder') }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(D, 'expired.json')), false);
    for (const name of ['mixed.json', 'live.json', 'empty.json', 'invalid.json', 'broken.json']) assert.ok(fs.existsSync(path.join(D, name)));
    assert.equal(fs.readdirSync(D).length, 6);
  } finally { fs.rmSync(H, { recursive: true, force: true }); }
});

for (const scenario of ['connect', 'Page.bringToFront', 'Page.getFrameTree', 'Page.createIsolatedWorld', 'Runtime.evaluate', 'deleted', 'near-expiry', 'hmac', 'missing-entry', 'valid']) test(`CDP 대기 · 입력 직전 지문 재검증: ${scenario} (포트 없이 검증)`, () => {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-mask-recheck-')), B = path.join(H, 'boarder');
  try {
    fs.mkdirSync(B, { mode: 0o700 });
    fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: DEV, server: 'https://boarder.example' }));
    const script = `
      import fs from 'node:fs';
      import path from 'node:path';
      import assert from 'node:assert/strict';
      import { secretCommand, masksPath } from ${JSON.stringify(new URL('./secret.mjs', import.meta.url).href)};
      const scenario = ${JSON.stringify(scenario)};
      const methods = [], delays = [];
      let closed = false, message;
      // Exercise production timeout paths without waiting 30 seconds or opening ports.
      const realTimeout = globalThis.setTimeout;
      globalThis.setTimeout = (fn, ms, ...args) => {
        delays.push(ms);
        assert.equal(ms, 30000);
        return realTimeout(fn, 5, ...args);
      };
      globalThis.fetch = async url => {
        if (url.endsWith('/fill')) return Response.json({ id: 'sr_1', state: 'approved' });
        if (url.endsWith('/value')) return Response.json({ value: ${JSON.stringify(VALUE)}, kind: 'browser', site: 'https://shop.example', selector: '#cc' });
        assert.equal(url, 'http://127.0.0.1:9222/json');
        return Response.json([{ type: 'page', url: 'https://shop.example', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page' }]);
      };
      globalThis.WebSocket = class {
        constructor() { if (scenario !== 'connect') queueMicrotask(() => this.onopen()); }
        close() { closed = true; this.onclose(); }
        send(raw) {
          const m = JSON.parse(raw);
          methods.push(m.method);
          if (scenario === m.method) return;
          let result = {};
          if (m.method === 'Page.getFrameTree') result = { frameTree: { frame: { id: 'F1' } } };
          if (m.method === 'Page.createIsolatedWorld') {
            result = { executionContextId: 7 };
            const file = path.join(masksPath(), fs.readdirSync(masksPath())[0]);
            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (scenario === 'deleted') {
              // A different fill's matching file must not substitute for this one's.
              fs.writeFileSync(path.join(masksPath(), 'other.json'), JSON.stringify(saved));
              fs.unlinkSync(file);
            }
            if (scenario === 'near-expiry') saved.entries[0].exp = Math.floor(Date.now() / 1000) + 299;
            if (scenario === 'hmac') saved.entries[0].h = '00'.repeat(32);
            if (scenario === 'missing-entry') saved.entries = [];
            if (['near-expiry', 'hmac', 'missing-entry'].includes(scenario)) fs.writeFileSync(file, JSON.stringify(saved));
          }
          if (m.method === 'Runtime.evaluate') result = { result: { value: 'ok' } };
          queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id: m.id, result }) }));
        }
      };
      const logs = [];
      console.log = m => logs.push(m);
      console.error = m => { message = m; };
      process.exit = code => { throw new Error('exit ' + code); };
      const fill = secretCommand('fill', ['card'], { site: 'https://shop.example', selector: '#cc' });
      if (scenario === 'valid') {
        await fill;
        assert.equal(methods.filter(m => m === 'Runtime.evaluate').length, 1);
        assert.equal(logs.at(-1), 'filled');
      } else {
        await assert.rejects(fill, { message: 'exit 1' });
        if (scenario === 'Runtime.evaluate') assert.equal(methods.filter(m => m === 'Runtime.evaluate').length, 1, 'no retry after timeout');
        else assert.ok(!methods.includes('Runtime.evaluate'), 'no typing command sent');
        assert.ok(!logs.includes('filled'));
        if (scenario === 'connect') { assert.deepEqual(methods, []); assert.equal(message, 'not filled: Chrome connection timed out'); }
        else if (scenario.startsWith('Page.') || scenario === 'Runtime.evaluate') { assert.equal(methods.at(-1), scenario); assert.equal(message, 'not filled: Chrome did not answer'); }
        else assert.equal(message, 'not filled: could not verify the redaction fingerprint');
      }
      assert.ok(closed);
      assert.equal(delays.length, 1 + methods.length);
      fs.writeSync(1, 'verified');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, HOME: H, BOARDER_HOME: B, BOARDER_WINDOW: 'test', BOARDER_TOKEN: WIN }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'verified');
    assert.equal(result.stderr, '');
  } finally { fs.rmSync(H, { recursive: true, force: true }); }
});

for (const failure of ['read', 'json', 'hmac', 'fsync']) test(`지문 ${failure} 실패는 입력 전에 중단 (포트 없이 검증)`, () => {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-mask-fail-')), B = path.join(H, 'boarder');
  try {
    fs.mkdirSync(B, { mode: 0o700 });
    fs.writeFileSync(path.join(B, 'device.json'), JSON.stringify({ token: DEV, server: 'https://boarder.example' }));
    const script = `
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      import { syncBuiltinESMExports } from 'node:module';
      import { secretCommand } from ${JSON.stringify(new URL('./secret.mjs', import.meta.url).href)};
      const read = fs.readFileSync;
      fs.readFileSync = (file, ...args) => {
        if (String(file).includes('secret-masks.d/') && String(file).endsWith('.json')) {
          if (${JSON.stringify(failure)} === 'read') throw new Error('read failed');
          if (${JSON.stringify(failure)} === 'json') return '{';
          if (${JSON.stringify(failure)} === 'hmac') {
            const saved = JSON.parse(read(file, ...args));
            saved.entries[0].h = '00'.repeat(32);
            return JSON.stringify(saved);
          }
        }
        return read(file, ...args);
      };
      if (${JSON.stringify(failure)} === 'fsync') fs.fsyncSync = () => { throw new Error('fsync failed'); };
      syncBuiltinESMExports();
      globalThis.fetch = async url => {
        if (url.endsWith('/fill')) return Response.json({ id: 'sr_1', state: 'approved' });
        if (url.endsWith('/value')) return Response.json({ value: ${JSON.stringify(VALUE)}, kind: 'browser', site: 'https://shop.example', selector: '#cc' });
        console.error('unexpected Chrome request'); process.exit(99);
      };
      let message;
      const logs = [];
      console.log = m => logs.push(m);
      console.error = m => { message = m; };
      process.exit = code => { throw new Error('exit ' + code); };
      await assert.rejects(secretCommand('fill', ['card'], { site: 'https://shop.example', selector: '#cc' }), { message: 'exit 1' });
      assert.equal(message, 'not filled: could not record the redaction fingerprint');
      assert.deepEqual(logs, ['request sr_1: approved', 'request sr_1: approved']);
      fs.writeSync(1, 'verified');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, HOME: H, BOARDER_HOME: B, BOARDER_WINDOW: 'test', BOARDER_TOKEN: WIN }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'verified');
    assert.equal(result.stderr, '');
    noValue(result.stdout + result.stderr, '출력');
    assert.ok(!fs.readdirSync(path.join(H, '.local', 'state', 'boarder', 'secret-masks.d')).some(name => name.endsWith('.tmp')));
  } finally { fs.rmSync(H, { recursive: true, force: true }); }
});

for (const noEnter of [false, true]) test(`type: stdin only, fingerprint first, paste deletes buffer, clear history (no-enter=${noEnter})`, async () => {
  const r = await rig({ noPorts: true, kind: 'tmux', tmuxPane: '  123 %3 456\n' });
  try {
    const o = await r.cli(['secret', 'type', 'card', ...(noEnter ? ['--no-enter'] : []), '--tmux', 'demo:1.2']);
    assert.equal(o.code, 0, o.err);
    assert.equal(o.out, 'request sr_1: pending\nrequest sr_1: approved\ntyped\n');
    assert.equal(o.err, ''); noValue(o.out + o.err, 'output');
    const request = r.hits.find(h => h.url === '/api/secrets/card/fill');
    assert.deepEqual(JSON.parse(request.body), { tmux: 'demo:1.2' });
    assert.equal(request.auth, `Bearer ${WIN}`); assert.equal(request.dev, DEV);
    assert.equal(r.hits.find(h => h.url.endsWith('/value')).auth, `Bearer ${DEV}`);
    const calls = r.tmuxCalls();
    assert.deepEqual(calls.map(c => c.args[0]), ['display-message', 'load-buffer', 'show-buffer', 'show-options', 'set-option']);
    assert.deepEqual(calls[0].args, ['display-message', '-p', '-t', 'demo:1.2', '#{pid} #{pane_id} #{pane_pid}']);
    const buffer = calls[1].args[2]; assert.match(buffer, /^boarder-[a-f0-9]{32}$/);
    const nonce = buffer.slice('boarder-'.length), marker = `@boarder_typed_${nonce}`;
    assert.deepEqual(calls[1].args, ['load-buffer', '-b', buffer, '-', ';', 'if-shell', '-F', '-t', '%3',
      '#{&&:#{==:#{pane_dead},0},#{&&:#{==:#{pid},123},#{&&:#{==:#{pane_id},%3},#{==:#{pane_pid},456}}}}',
      `paste-buffer -d -b ${buffer} -t %3 ; ${noEnter ? '' : 'send-keys -t %3 Enter ; '}clear-history -t %3 ; set-option -p -t %3 ${marker} ${nonce}`,
      `delete-buffer -b ${buffer}`]);
    assert.deepEqual(calls[2].args, ['show-buffer', '-b', buffer]);
    assert.deepEqual(calls[3].args, ['show-options', '-p', '-v', '-t', '%3', marker]);
    assert.deepEqual(calls[4].args, ['set-option', '-p', '-u', '-t', '%3', marker]);
    const key = fs.readFileSync(path.join(r.B, 'secret-mask.key'));
    const fingerprint = createHmac('sha256', key).update(VALUE.replace(/\D/g, '')).digest('hex');
    assert.ok(calls[1].masks.some(m => JSON.parse(m).entries.some(e => e.h === fingerprint && e.exp > Date.now() / 1000)));
    for (const c of calls) {
      noValue(JSON.stringify(c.args), 'argv'); noValue(JSON.stringify(c.env), 'env');
      assert.equal(c.input, c.args[0] === 'load-buffer' ? VALUE : '');
    }
    assert.deepEqual(r.cdpLog, []);
  } finally { r.close(); }
});

for (const tmuxRecheck of [null, '\n', '123 %99 456\n', '124 %3 456\n', '123 %3 457\n']) test(`type: missing or changed server/pane identity (${JSON.stringify(tmuxRecheck)}) prevents typing`, async () => {
  const r = await rig({ noPorts: true, kind: 'tmux', tmuxRecheck });
  try {
    const o = await r.cli(['secret', 'type', 'card', '--tmux', 'demo:1.2']);
    assert.equal(o.code, 1);
    assert.equal(o.err, 'not typed: terminal step failed\n');
    noValue(o.out + o.err, 'output');
    const calls = r.tmuxCalls();
    assert.deepEqual(calls.map(c => c.args[0]), ['display-message', 'load-buffer', 'show-buffer', 'show-options', 'delete-buffer', 'set-option']);
    assert.equal(fs.existsSync(path.join(r.H, 'tmux.jsonl.buffer')), false);
    assert.ok(!o.out.split('\n').includes('typed'));
  } finally { r.close(); }
});

for (const tmuxPane of ['\n', 'demo:1.2\n', '%3\n%4\n', '123 %3junk 456\n', 'abc %3 456\n', '123 %3 def\n', '123 %3\n', '123 %3 456 extra\n']) test(`type: invalid server/pane identity (${JSON.stringify(tmuxPane)}) refuses before any request`, async () => {
  const r = await rig({ noPorts: true, kind: 'tmux', tmuxPane });
  try {
    const o = await r.cli(['secret', 'type', 'card', '--tmux', 'demo:1.2']);
    assert.equal(o.code, 1);
    assert.equal(o.err, 'terminal pane is unavailable\n');
    assert.deepEqual(r.hits, []);
    assert.deepEqual(r.tmuxCalls().map(c => c.args[0]), ['display-message']);
  } finally { r.close(); }
});

for (const step of ['display-message', 'load-buffer', 'paste-buffer', 'send-keys', 'clear-history']) test(`type: ${step} failure is fixed and cleans buffer`, async () => {
  const r = await rig({ noPorts: true, kind: 'tmux', policy: 'auto', tmuxFail: step });
  try {
    const o = await r.cli(['secret', 'type', 'card', '--tmux', 'demo:1.2']);
    assert.equal(o.code, 1); noValue(o.out + o.err, 'output');
    const calls = r.tmuxCalls();
    if (step === 'display-message') {
      assert.equal(o.err, 'terminal pane is unavailable\n');
      assert.deepEqual(r.hits, [], 'missing pane must not request a secret');
    } else {
      assert.equal(o.err, 'not typed: terminal step failed\n');
      assert.deepEqual(calls.at(-2).args, ['delete-buffer', '-b', calls[1].args[2]]);
      assert.equal(calls.filter(c => c.args[0] === 'load-buffer').length, 1);
    }
  } finally { r.close(); }
});

for (const sub of ['type', 'fill']) test(`${sub}: refuses the other target kind`, async () => {
  const r = await rig({ noPorts: true, kind: sub === 'type' ? 'browser' : 'tmux', policy: 'auto' });
  try {
    const args = sub === 'type' ? ['--tmux', 'demo:1.2'] : ['--site', 'https://shop.example', '--selector', '#cc', '--cdp', r.cdp];
    const o = await r.cli(['secret', sub, 'card', ...args]);
    assert.equal(o.code, 1); assert.match(o.err, /secret target kind does not match/);
    noValue(o.out + o.err, 'output');
    assert.deepEqual(r.cdpLog, []);
    assert.ok(!r.tmuxCalls().some(c => c.args[0] === 'load-buffer'));
  } finally { r.close(); }
});

test('type: fingerprint write failure prevents typing', async () => {
  const r = await rig({ noPorts: true, kind: 'tmux', policy: 'auto' });
  try {
    const D = path.join(r.H, '.local/state/boarder');
    fs.mkdirSync(D, { recursive: true }); fs.writeFileSync(path.join(D, 'secret-masks.d'), 'blocked');
    const o = await r.cli(['secret', 'type', 'card', '--tmux', 'demo:1.2']);
    assert.equal(o.code, 1); assert.equal(o.err, 'not typed: could not record the redaction fingerprint\n');
    assert.deepEqual(r.tmuxCalls().map(c => c.args[0]), ['display-message']);
    noValue(o.out + o.err, 'output');
  } finally { r.close(); }
});

test('type: invalid tmux target fails before a request', async () => {
  const r = await rig({ noPorts: true });
  try {
    for (const target of ['demo:1.2;echo', 'demo:1\n', 'demo:10000', 'demo:1.1000', 'demo:1.2.3']) {
      const o = await r.cli(['secret', 'type', 'card', '--tmux', target]);
      assert.equal(o.code, 1, target);
    }
    assert.deepEqual(r.hits, []); assert.deepEqual(r.tmuxCalls(), []);
  } finally { r.close(); }
});


test('type: fingerprint read-back mismatch prevents loading a buffer', async () => {
  const r = await rig({ noPorts: true, kind: 'tmux', policy: 'auto', maskFailure: true });
  try {
    const o = await r.cli(['secret', 'type', 'card', '--tmux', 'demo:1.2']);
    assert.equal(o.code, 1); assert.equal(o.err, 'not typed: could not record the redaction fingerprint\n');
    assert.deepEqual(r.tmuxCalls().map(c => c.args[0]), ['display-message']);
    noValue(o.out + o.err, 'output');
  } finally { r.close(); }
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) test(`type: ${signal} before buffer creation waits for the child, then synchronously deletes buffer`, async () => {
  const r = await rig({ noPorts: true, kind: 'tmux', policy: 'auto', tmuxSignal: signal });
  try {
    const o = await r.cli(['secret', 'type', 'card', '--tmux', 'demo:1.2']);
    assert.equal(o.code, { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[signal]);
    const calls = r.tmuxCalls(), buffer = calls[1].args[2];
    assert.deepEqual(calls.at(-1).args, ['delete-buffer', '-b', buffer]);
    assert.deepEqual(fs.readFileSync(path.join(r.H, 'tmux.jsonl.events'), 'utf8').trim().split('\n'), ['created', 'child-exit', 'delete-buffer']);
    assert.equal(fs.existsSync(path.join(r.H, 'tmux.jsonl.buffer')), false);
    assert.ok(!o.out.split('\n').includes('typed'));
    noValue(o.out + o.err, 'output');
  } finally { r.close(); }
});

for (const scenario of ['missing marker', 'wrong marker', 'remaining buffer']) test(`type: ${scenario} must not report typed`, async () => {
  const r = await rig({ noPorts: true, kind: 'tmux', policy: 'auto', tmuxMarker: scenario === 'wrong marker' ? 'stale' : scenario !== 'missing marker', tmuxBufferRemains: scenario === 'remaining buffer' });
  try {
    const o = await r.cli(['secret', 'type', 'card', '--tmux', 'demo:1.2']);
    assert.equal(o.code, 1);
    assert.equal(o.err, 'not typed: terminal step failed\n');
    assert.ok(!o.out.split('\n').includes('typed'));
    const calls = r.tmuxCalls();
    assert.deepEqual(calls.at(-2).args, ['delete-buffer', '-b', calls[1].args[2]]);
    assert.equal(fs.existsSync(path.join(r.H, 'tmux.jsonl.buffer')), false);
    noValue(o.out + o.err, 'output');
  } finally { r.close(); }
});

test('type: dead pane with unchanged identity takes the delete-buffer else-branch', async () => {
  const r = await rig({ noPorts: true, kind: 'tmux', policy: 'auto', tmuxPaneDead: true });
  try {
    const o = await r.cli(['secret', 'type', 'card', '--tmux', 'demo:1.2']);
    assert.equal(o.code, 1);
    assert.equal(o.err, 'not typed: terminal step failed\n');
    assert.ok(!o.out.split('\n').includes('typed'));
    assert.equal(fs.readFileSync(path.join(r.H, 'tmux.jsonl.events'), 'utf8').split('\n')[0], 'else');
    assert.equal(fs.existsSync(path.join(r.H, 'tmux.jsonl.buffer')), false);
    noValue(o.out + o.err, 'output');
  } finally { r.close(); }
});
