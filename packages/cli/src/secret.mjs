import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, closeSync, fsyncSync, readdirSync, unlinkSync } from 'node:fs';
import { loadDevice, server, dir, home, ensureDir } from './config.mjs';
import { windowToken } from './window.mjs';

export const SECRET_HELP = `Secrets (values the human typed on their phone — you never see them)
  boarder secret fill <name> --site <https url> --selector <css> [--tab <id>] [--cdp <port>] [--timeout <s>]
                                    asks the human to allow it (or their auto rule), then types the value into that field
                                    of the local Chrome (remote debugging port, default 9222) and masks it.
                                    Prints the request id/state and "filled" — never the value.
  boarder secret type <name> --tmux <session:window.pane> [--timeout <s>] [--no-enter]
                                    asks for approval, then types into that local terminal and clears its history.
                                    Prints the request id/state and "typed" — never the value.`;

export const normalize = v => String(v).replace(/[ \t\-./()+_]/g, '').toLowerCase();
export const masksPath = () => path.join(home(), '.local', 'state', 'boarder', 'secret-masks.d');
export const maskKeyPath = () => path.join(dir(), 'secret-mask.key');
function maskKey() {
  const p = maskKeyPath();
  if (!existsSync(p)) { ensureDir(path.dirname(p)); try { writeFileSync(p, randomBytes(32), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
  const k = readFileSync(p);
  if (k.length !== 32) throw new Error('secret-mask.key is not 32 bytes');
  return k;
}
export function writeMask(value) {
  const n = normalize(value); if (n.length < 4) throw new Error('secret is too short to redact');
  const d = masksPath();
  mkdirSync(d, { recursive: true, mode: 0o700 });
  const h = createHmac('sha256', maskKey()).update(n).digest('hex'), now = Math.floor(Date.now() / 1000);
  const p = path.join(d, `${randomBytes(8).toString('hex')}.json`), tmp = `${p}.tmp`;
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, JSON.stringify({ entries: [{ h, n: n.length, exp: now + 3600 }] }) + '\n');
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(tmp, p);
    const saved = JSON.parse(readFileSync(p, 'utf8'));
    if (!Array.isArray(saved?.entries) || !saved.entries.some(e => e?.h === h && e.n === n.length && e.exp === now + 3600)) throw new Error('could not verify the redaction fingerprint');
  } finally {
    try { unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  // Cleanup is best effort; never remove a file with a live or invalid entry.
  try {
    for (const name of readdirSync(d)) {
      if (!name.endsWith('.json')) continue;
      try {
        const file = path.join(d, name), saved = JSON.parse(readFileSync(file, 'utf8'));
        if (Array.isArray(saved?.entries) && saved.entries.length > 0 && saved.entries.every(e => e && Number.isFinite(e.exp) && e.exp <= now)) unlinkSync(file);
      } catch {}
    }
  } catch {}
  return p;
}

function verifyMask(file, value) {
  try {
    const n = normalize(value), h = createHmac('sha256', maskKey()).update(n).digest('hex');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    const minExpiry = Date.now() / 1000 + 300;
    if (Array.isArray(saved?.entries) && saved.entries.some(e => e?.h === h && e.n === n.length && Number.isFinite(e.exp) && e.exp >= minExpiry)) return;
  } catch {}
  throw new Error('could not verify the redaction fingerprint');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };

async function asAgent(method, p, body, extra = {}) {
  let w = await windowToken();
  const go = t => fetch(`${server()}${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...extra }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  let r = await go(w.token);
  if (r.status === 401) { w = await windowToken({ fresh: true }); r = await go(w.token); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(typeof j.error === 'string' ? j.error.slice(0, 200) : `Boarder ${r.status}`), { status: r.status });
  return j;
}

// 값 받기 — 답 몸은 여기서만 읽고, 오류 때 몸을 찍지 않음
async function fetchValue(id) {
  const d = loadDevice(); if (!d?.token) throw new Error('This machine is not set up for Boarder yet — run `boarder setup --yes`.');
  const r = await fetch(`${server()}/api/secrets/requests/${encodeURIComponent(id)}/value`, { headers: { authorization: `Bearer ${d.token}` }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`could not receive the secret (Boarder ${r.status})`);
  const j = await r.json().catch(() => null);
  if (!j || typeof j.value !== 'string' || typeof j.site !== 'string') throw new Error('could not receive the secret (bad answer)');
  return j;
}

function cdpBase(v) {
  const s = String(v ?? process.env.BOARDER_CDP ?? '9222');
  if (/^\d{2,5}$/.test(s)) return `http://127.0.0.1:${s}`;
  const u = new URL(s);   // 이 기기의 Chrome 만
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('--cdp must be a local port or http://127.0.0.1:<port>');
  return u.origin;
}
const originOf = u => { try { return new URL(u).origin; } catch { return ''; } };

// CDP 한 연결: 보내고 같은 id 답을 기다림. 오류 글은 고정 — Chrome 이 돌려준 글(혹시 인자를 담을 수 있는)은 안 찍음
function cdp(wsUrl) {
  if (typeof WebSocket !== 'function') throw new Error('boarder secret fill needs Node 22 or newer (WebSocket)');
  const ws = new WebSocket(wsUrl), wait = new Map();
  let n = 0;
  let rejectOpen;
  const open = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('Chrome connection timed out')), 30000);
    rejectOpen = error => { clearTimeout(timer); rej(error); };
    ws.onopen = () => { clearTimeout(timer); res(); };
    ws.onerror = () => rejectOpen(new Error('could not connect to Chrome'));
  });
  ws.onmessage = ev => { let m; try { m = JSON.parse(String(ev.data)); } catch { return; } const w = wait.get(m.id); if (w) { wait.delete(m.id); clearTimeout(w.timer); m.error ? w.rej(new Error('Chrome refused a step')) : w.res(m.result); } };
  ws.onclose = () => { rejectOpen(new Error('Chrome closed the connection')); for (const w of wait.values()) { clearTimeout(w.timer); w.rej(new Error('Chrome closed the connection')); } wait.clear(); };
  return {
    open,
    send: (method, params = {}) => new Promise((res, rej) => {
      const id = ++n;
      const timer = setTimeout(() => { if (wait.delete(id)) rej(new Error('Chrome did not answer')); }, 30000);
      wait.set(id, { res, rej, timer });
      try { ws.send(JSON.stringify({ id, method, params })); }
      catch { clearTimeout(timer); wait.delete(id); rej(new Error('could not send a step to Chrome')); }
    }),
    close: () => { try { ws.close(); } catch {} },
  };
}

async function typeInto(base, got, maskFile) {
  const list = await (await fetch(`${base}/json`, { signal: AbortSignal.timeout(5000) }).catch(() => { throw new Error(`no Chrome remote debugging at ${base} — start Chrome with --remote-debugging-port`); })).json();
  const pages = (Array.isArray(list) ? list : []).filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
  const t = got.tab ? pages.find(p => p.id === got.tab) : pages.find(p => originOf(p.url) === got.site);
  if (!t) throw new Error(got.tab ? `no Chrome tab ${got.tab}` : `no Chrome tab open on ${got.site}`);
  if (originOf(t.url) !== got.site) throw new Error(`that tab is not on ${got.site} — the human allowed only that site`);
  const ws = new URL(t.webSocketDebuggerUrl);
  if (!['ws:', 'wss:'].includes(ws.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(ws.hostname)) throw new Error('Chrome debugger must be local');
  const c = cdp(ws.href);
  try {
    await c.open;
    const S = JSON.stringify(got.site), Q = JSON.stringify(got.selector), V = JSON.stringify(got.value);
    await c.send('Page.bringToFront');
    const tree = await c.send('Page.getFrameTree');
    const world = await c.send('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'boarder-secret' });
    // 같은 renderer 의 동기 처리로 사이트 확인부터 입력까지. 이동으로 컨텍스트가 사라지면 실패함.
    verifyMask(maskFile, got.value);
    const done = await c.send('Runtime.evaluate', { contextId: world.executionContextId, returnByValue: true, expression: `(()=>{if(location.origin!==${S})return'origin';const el=document.querySelector(${Q});if(!el)return'missing';const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:null;const setter=proto&&Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!setter)return'notinput';el.style.setProperty('-webkit-text-security','disc','important');setter.call(el,${V});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value.length?'ok':'empty'})()` });
    const status = done?.result?.value;
    if (done?.exceptionDetails || status !== 'ok') throw new Error({ origin: `that tab is not on ${got.site}`, missing: 'no field matches --selector', notinput: 'that element is not a text field', empty: 'the field is empty after typing' }[status] || 'could not reach the field');
  } finally { c.close(); }
}

const TMUX = /^[A-Za-z0-9_.-]{1,40}:[0-9]{1,4}(\.[0-9]{1,3})?$/;
function tmux(args, value, onSpawn) {
  return new Promise((resolve, reject) => {
    const error = () => reject(new Error('terminal step failed'));
    const child = spawn('tmux', args, { stdio: ['pipe', 'pipe', 'ignore'] });
    onSpawn?.(child);
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', error);
    child.stdin.on('error', error);
    child.on('close', code => code === 0 ? resolve(output) : error());
    child.stdin.end(value);
  });
}

async function typeTerminal(got, maskFile, enter, paneIdentity) {
  const [serverPid, paneId, panePid] = paneIdentity.split(' ');
  const nonce = randomBytes(16).toString('hex');
  const buffer = `boarder-${nonce}`, marker = `@boarder_typed_${nonce}`;
  let typingChild;
  const signals = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  const handlers = Object.entries(signals).map(([signal, code]) => {
    const handler = () => {
      // JS exit events cannot run during this synchronous wait. A zombie has
      // already finished its command, so it is also safe to clean up after it.
      const until = Date.now() + 5000;
      const pause = new Int32Array(new SharedArrayBuffer(4));
      while (typingChild?.pid && typingChild.exitCode === null && typingChild.signalCode === null && Date.now() < until) {
        const status = spawnSync('ps', ['-o', 'stat=', '-p', String(typingChild.pid)], { encoding: 'utf8', timeout: Math.max(1, until - Date.now()) });
        if (status.status === 1 || /^\s*Z/.test(status.stdout || '')) break;
        Atomics.wait(pause, 0, 0, Math.min(20, Math.max(0, until - Date.now())));
      }
      spawnSync('tmux', ['delete-buffer', '-b', buffer], { stdio: 'ignore', timeout: 5000 });
      process.exit(code);
    };
    process.on(signal, handler);
    return [signal, handler];
  });
  try {
    verifyMask(maskFile, got.value);
    // The server checks the pinned identity and consumes the buffer in one command queue.
    const condition = `#{&&:#{==:#{pane_dead},0},#{&&:#{==:#{pid},${serverPid}},#{&&:#{==:#{pane_id},${paneId}},#{==:#{pane_pid},${panePid}}}}}`;
    const then = `paste-buffer -d -b ${buffer} -t ${paneId} ; ${enter ? `send-keys -t ${paneId} Enter ; ` : ''}clear-history -t ${paneId} ; set-option -p -t ${paneId} ${marker} ${nonce}`;
    await tmux(['load-buffer', '-b', buffer, '-', ';', 'if-shell', '-F', '-t', paneId, condition, then, `delete-buffer -b ${buffer}`], got.value, child => { typingChild = child; });
    let bufferExists = true;
    try { await tmux(['show-buffer', '-b', buffer]); } catch { bufferExists = false; }
    if (bufferExists || (await tmux(['show-options', '-p', '-v', '-t', paneId, marker])).trim() !== nonce) throw new Error('terminal step failed');
  } catch {
    try { await tmux(['delete-buffer', '-b', buffer]); } catch {}
    throw new Error('terminal step failed');
  } finally {
    try { await tmux(['set-option', '-p', '-u', '-t', paneId, marker]); } catch {}
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}

export async function secretCommand(sub, pos, flags) {
  const terminal = sub === 'type';
  if (!['fill', 'type'].includes(sub) || !pos[0] || (terminal ? !flags.tmux : !flags.site || !flags.selector)) fail(SECRET_HELP, 64);
  if (terminal && (typeof flags.tmux !== 'string' || !TMUX.test(flags.tmux))) fail('invalid --tmux target');
  const timeout = Math.max(5, Math.min(Number(flags.timeout) || 600, 600)), name = pos[0];
  let base, paneIdentity;
  try {
    if (terminal) {
      paneIdentity = (await tmux(['display-message', '-p', '-t', flags.tmux, '#{pid} #{pane_id} #{pane_pid}'])).trim();
      if (!/^[0-9]+ %[0-9]+ [0-9]+$/.test(paneIdentity)) throw new Error('terminal pane is unavailable');
    }
    else base = cdpBase(flags.cdp);
  } catch (e) { fail(terminal ? 'terminal pane is unavailable' : e.message); }
  let req;
  const dev = loadDevice()?.token;
  try { req = await asAgent('POST', `/api/secrets/${encodeURIComponent(name)}/fill`, terminal ? { tmux: flags.tmux } : { site: flags.site, selector: flags.selector, ...(flags.tab ? { tab: flags.tab } : {}) }, dev ? { 'x-boarder-device': dev } : {}); }
  catch (e) { fail(`secret request failed: ${e.message}`); }
  console.log(`request ${req.id}: ${req.state}`);
  let state = req.state;
  for (const until = Date.now() + timeout * 1000; state === 'pending';) {
    if (Date.now() > until) fail(`request ${req.id}: still waiting for the human`, 2);
    await sleep(2000);
    try { state = (await asAgent('GET', `/api/secrets/requests/${encodeURIComponent(req.id)}`)).state; } catch (e) { if (e.status && e.status < 500) fail(`request ${req.id}: ${e.message}`); }
  }
  if (state !== 'approved') fail(`request ${req.id}: ${state}`);
  console.log(`request ${req.id}: approved`);
  let got;
  try {
    got = await fetchValue(req.id);
    if (terminal ? got.kind !== 'tmux' || !TMUX.test(got.tmux) || got.tmux !== flags.tmux || got.site !== `terminal:${got.tmux}` : got.kind !== 'browser' || typeof got.selector !== 'string') throw new Error('secret target kind does not match this command');
    let maskFile;
    try { maskFile = writeMask(got.value); } catch { throw new Error('could not record the redaction fingerprint'); }
    if (terminal) await typeTerminal(got, maskFile, !flags['no-enter'], paneIdentity);
    else await typeInto(base, got, maskFile);
  }
  catch (e) { fail(`not ${terminal ? 'typed' : 'filled'}: ${e.message}`); }
  finally { if (got) got.value = null; got = null; }
  console.log(terminal ? 'typed' : 'filled');
}
