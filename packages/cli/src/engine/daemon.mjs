import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, appendFileSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dir, loadDevice, server, readJson } from '../config.mjs';
import * as E from './index.mjs';
import { markTurn, hasMark, FRESH } from '../turn.mjs';
import * as Q from './queue.mjs';
import * as V from './voice.mjs';
import { remoteVerb, REMOTE_VERBS } from './remote.mjs';

const BIN = fileURLToPath(new URL('../../bin/boarder.mjs', import.meta.url));
const VERSION = readJson(fileURLToPath(new URL('../../package.json', import.meta.url)))?.version;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 폐기: systemd 는 끝 코드 3 이면 다시 안 띄움(RestartPreventExitStatus), launchd 는 0 이어야 안 띄움(KeepAlive SuccessfulExit false)
const REVOKED_EXIT = process.platform === 'darwin' ? 0 : 3;
function log(...a) { const l = `${new Date().toISOString()} ${a.join(' ')}`; console.log(l); }
export const eventsPath = () => path.join(dir(), 'engine-events.jsonl');

function saveSession(w) {
  if (!w?.session_id || !w?.cwd) return Promise.resolve();
  const cdir = (w.spec?.config_dir && String(w.spec.config_dir).replace(/^~(?=$|\/)/, os.homedir())) || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const f = path.join(cdir, 'projects', w.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${w.session_id}.jsonl`);
  if (!existsSync(f)) return Promise.resolve();
  return new Promise(res => {
    const ch = spawn(process.execPath, [BIN, 'session', 'save', '--file', f], { env: { ...process.env, BOARDER_WINDOW: w.id }, stdio: 'ignore' });
    const t = setTimeout(() => ch.kill(), 60000); ch.on('close', () => { clearTimeout(t); res(); }); ch.on('error', () => { clearTimeout(t); res(); });
  });
}

// 통화: 이 기기 사람의 codex 로그인으로 — 받아쓴 말 · 넘기기 · 넘긴 일 상태는 이 기기 토큰으로 서버에(서버가 기기 주인 것만 씀)
async function voiceServer(op, body) {
  const dev = loadDevice();
  const r = await fetch(`${server()}/api/device/voice`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${dev?.token || ''}` }, body: JSON.stringify({ op, ...body }), signal: AbortSignal.timeout(20000) });
  return r.json().catch(() => ({ ok: false, text: `서버 ${r.status}` }));
}
const voiceDeps = { server: voiceServer, listWindows: () => E.listAll() };

const TURNING = new Set(['busy', 'starting', 'waiting']);   // waiting = 질문 · 권한 창(턴 안)
const IDLE = new Set(['idle', 'background']);
const findWin = async id => (await E.listAll()).find(x => x.id === id);
// 보드에 보이는 한 줄 · 줄에서 넣은 명령 끝내기(서버 type 'queue'). 데몬이 서버에 붙어 있을 때만 — 옛 서버는 모르는 꼴이라 넘어감
let toServer = null;
export const setReporter = fn => { toServer = fn; };
function report(id, o) { try { toServer?.({ type: 'queue', id, ...o }); } catch {} }
function note(id, text) { log(`queue ${id}: ${text}`); report(id, { note: text }); }
const cmdsOf = items => items.map(x => x.cmd).filter(Boolean);
export async function boardSend(args) {
  return Q.withLock(args.id, async () => {
    const w = await findWin(args.id).catch(() => null), keys = [args.id, w?.session_id];
    let turning = Q.pending(args.id) > 0;   // 앞에 기다리는 글이 있으면 순서대로
    if (!turning) {
      let st = null; try { st = await E.run('state', { id: args.id, ...(args.engine ? { engine: args.engine } : {}) }); } catch {}
      const known = typeof st?.state === 'string' && st.state !== 'none';
      turning = known && (TURNING.has(st.state) || !!st.dialog || hasMark(keys, Date.now(), { within: FRESH }));   // 막 넣은 글을 Claude 가 아직 안 집은 틈도 턴 중
    }
    if (turning) {
      const r = Q.push(args.id, args.text, args.cmd ? { cmd: String(args.cmd) } : {});
      if (r.full) {   // 버리지 않음: 바쁨(2)으로 돌려 서버가 자기 줄에 두고 다시 보냄 + 보드에 한 줄
        note(args.id, `이 창에 기다리는 보드 글이 ${Q.PER_WINDOW_MAX}개라 새 글은 아직 넣지 못했어요 — 앞 글이 들어가면 다시 넣어요`);
        throw new E.EngineError(2, `${Q.PER_WINDOW_MAX} board messages are already waiting for this window`);
      }
      log(`queued send for ${args.id} (${r.size} waiting)`);
      return { ok: true, queued: true };
    }
    let r;
    try { r = await E.run('send', args); }
    catch (e) {
      if (e?.code !== 2) throw e;
      const q = Q.push(args.id, args.text, args.cmd ? { cmd: String(args.cmd) } : {});
      if (q.full) throw e;
      log(`queued send for ${args.id} after busy (${e.message}) (${q.size} waiting)`);
      return { ok: true, queued: true };
    }
    try { markTurn(keys, args.text); } catch {}   // 표지를 못 남겨도 넣기는 된 것
    return r;
  });
}
/** 폴링마다: 그 창이 쉬면(idle · background) 줄 맨 앞 글과 같은 스레드 글을 묶어 한 번에 넣음. 넣었으면 true.
 *  st.state 가 없으면(상태를 모르는 엔진) 쉬는 것으로 보고 넣어 봄 — 바쁘면 엔진이 바쁨(2)으로 거절 */
export async function drainWindow(w, st) {
  const known = typeof st?.state === 'string';
  if (!Q.pending(w.id) || (known && !IDLE.has(st.state)) || st?.dialog) return false;
  return Q.withLock(w.id, async () => {
    const keys = [w.id, st?.session_id || w.session_id];
    if (hasMark(keys, Date.now(), { within: FRESH })) return false;   // 바로 앞에 넣은 글이 아직 턴을 안 열었을 수 있음
    const { maybe, batch: b } = Q.claim(w.id);
    if (maybe.length) {   // 넣는 도중 데몬이 멈췄던 글 — 다시 넣으면 두 번 들어갈 수 있어 넣지 않고 보드에 남김
      note(w.id, `엔진이 넣는 도중 멈춰 보드 글 ${maybe.length}개가 창에 들어갔는지 확인하지 못했어요 — 다시 넣지 않았어요`);
      report(w.id, { done: cmdsOf(maybe) });
    }
    if (!b) return false;
    try { await E.run('send', { id: w.id, text: b.text, ...(w.engine ? { engine: w.engine } : {}) }); }
    catch (e) { Q.release(w.id, b, false); log(`queued send for ${w.id} not delivered yet: ${e.message}`); return false; }
    Q.release(w.id, b, true);
    try { markTurn(keys, b.text); } catch {}
    if (cmdsOf(b.items).length) report(w.id, { done: cmdsOf(b.items) });
    log(`sent ${b.items.length} queued message(s) to ${w.id} (${Q.pending(w.id)} still waiting)`);
    return true;
  });
}
const closedNoted = new Set();
export async function tickQueues(listed, { stateOf = id => E.run('state', { id }), now = Date.now() } = {}) {
  for (const id of Q.ids()) {
    const w = listed.find(x => x.id === id);
    if (!w) {
      let st = null; try { st = await stateOf(id); } catch {}
      if (st?.state === 'none') {
        if (!closedNoted.has(id)) { closedNoted.add(id); note(id, `창이 닫혀 있어 기다리는 보드 글 ${Q.pending(id)}개를 넣지 못하고 있어요 — 창이 다시 열리면 넣어요`); }
      } else { closedNoted.delete(id); try { await drainWindow({ id, engine: E.loadCfg().windows?.[id] }, st || {}); } catch (e) { log(`queue ${id}: ${e.message}`); } }
    } else closedNoted.delete(id);
    const old = Q.flag(id, 'stale', x => now - x.at > Q.STALE_MS, now);
    if (old.length) note(id, `보드 글 ${old.length}개가 10분 넘게 이 창이 쉬기를 기다려요 — 창이 쉬면 차례로 넣어요`);
  }
}

export async function handle(msg) {
  const { verb, args = {} } = msg;
  if (/^rtc_/.test(verb)) return V.handle(verb, args, voiceDeps);
  if (REMOTE_VERBS.includes(verb)) return remoteVerb(verb, args);   // 보더 웹 설정 › 엔진: 계정 목록 · 로그인 주소 · 엔진 고르기
  if (verb === 'send' && args.text && !args.test && args.id) return boardSend(args);
  if (verb === 'list') return { windows: await E.listAll() };
  if (verb === 'close') { const w = (await E.listAll()).find(x => x.id === args.id); if (w) await saveSession({ ...w, cwd: w.spec?.cwd ? w.spec.cwd.replace(/^~(?=$|\/)/, os.homedir()) : w.cwd }); }
  if (verb === 'open' && args.spec) args.spec = { ...args.spec, cwd: args.spec.cwd || path.join(E.engineHome(), 'work') };
  const r = await E.run(verb, args);
  // 보드가 넣은 글 표지(turn.mjs) — 그 턴이 끝나면 Stop 훅이 마지막 답을 노드 채팅으로. 표지를 못 남겨도 넣기는 된 것
  try {
    if (verb === 'reopen' && args.text) markTurn([args.id || args.handle?.id, args.handle?.session_id], args.text);
    if (verb === 'open' && args.spec?.prompt) markTurn([args.spec.id, r?.session_id], args.spec.prompt);
  } catch {}
  return r;
}

async function answerDialog(w, st) {
  const spec = w.spec || {}, home = E.engineHome();
  const cwd = (spec.cwd || w.cwd || '').replace(/^~(?=$|\/)/, os.homedir());
  const ours = cwd === home || cwd.startsWith(home + path.sep);
  const cfg = E.loadCfg(), a = E.adapters(cfg)[w.engine];
  if (!a?.key) return null;
  if (st.dialog === 'trust' && (ours || spec.perm === 'bypass')) { await a.key(cfg, w.id, 'Down'); await sleep(300); await a.key(cfg, w.id, 'Enter'); return 'trust'; }
  if (st.dialog === 'bypass' && spec.perm === 'bypass') { await a.key(cfg, w.id, 'Down'); await sleep(300); await a.key(cfg, w.id, 'Enter'); return 'bypass'; }
  return null;
}

export async function runDaemon() {
  if (typeof globalThis.WebSocket !== 'function') { console.error('boarder engine needs Node 22 or newer (built-in WebSocket).'); process.exit(1); }
  const dev = loadDevice();
  if (!dev?.token) { console.error('not signed in — run `boarder setup --yes` first'); process.exit(REVOKED_EXIT); }
  const pidf = path.join(dir(), 'engine.pid');
  // macOS 엔 /proc 가 없어 그 pid 의 명령을 ps 로 봄(재부팅 뒤 남은 pid 를 남의 프로세스가 쓰면 막지 않게)
  const cmdOf = pid => existsSync(`/proc/${pid}/cmdline`) ? readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ') : (() => { try { return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 3000 }); } catch { return ''; } })();
  try {
    const old = +readFileSync(pidf, 'utf8');
    if (old && old !== process.pid) { process.kill(old, 0); if (/engine\s+run/.test(cmdOf(old))) { console.error(`another engine daemon is running (pid ${old})`); process.exit(0); } }
  } catch {}
  writeFileSync(pidf, String(process.pid), { mode: 0o600 });
  setInterval(() => V.reap(), 15000).unref();   // 끊긴 통화 닫기
  // 데몬이 멈추면 통화 codex app-server 도 같이 닫고, 같은 신호로 다시 끝냄(서비스 관리자가 보는 끝남 꼴은 그대로)
  for (const s of ['SIGTERM', 'SIGINT']) process.once(s, () => { V.stopAll().finally(() => process.kill(process.pid, s)); });
  const url = `${server().replace(/^http/, 'ws')}/api/device/engine`;
  let backoff = 1000, revoked = false, fails = 0, takenOver = false;
  const last = new Map();
  for (;;) {
    let ws, lastFull = 0, alive = true;
    const opened = await new Promise(resolve => {
      ws = new WebSocket(url, { headers: { Authorization: `Bearer ${dev.token}`, 'User-Agent': `boarder-engine/${VERSION}` } });
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      ws.onclose = e => { alive = false; if (e.code === 4401) revoked = true; resolve(false); };
    });
    if (revoked) { console.error('this device was revoked — run `boarder setup --yes` again'); process.exit(REVOKED_EXIT); }
    if (!opened) {
      // 붙기 실패가 이어지면 기기가 폐기됐는지 봄(폐기면 끝 코드 3 — 서비스가 다시 띄우지 않음)
      if (++fails >= 3) { try { const r = await fetch(`${server()}/api/device/me`, { headers: { authorization: `Bearer ${dev.token}` }, signal: AbortSignal.timeout(15000) }); if (r.status === 401) revoked = true; } catch {} }
      if (revoked) { console.error('this device was revoked — run `boarder setup --yes` again'); process.exit(REVOKED_EXIT); }
      log(`connect failed — retry in ${backoff / 1000}s`); await sleep(backoff); backoff = Math.min(backoff * 2, 30000); continue;
    }
    fails = 0;
    backoff = 1000; last.clear();
    const send = o => { try { ws.send(JSON.stringify(o)); } catch {} };
    setReporter(send);
    const cfg = E.loadCfg();
    const hw = await E.listAll(cfg);
    send({ type: 'hello', v: 1, primary: !cfg.no_primary, cli: VERSION, host: os.hostname().split('.')[0], os: process.platform, default: E.pick(cfg), engines: Object.fromEntries(Object.keys(E.adapters(cfg)).map(n => [n, { caps: cfg.caps?.[n] || null }])), windows: hw, voice: V.available(), ...(hw.failed.length ? { partial: true } : {}) });
    log(`connected to ${url}`);
    ws.onmessage = async ev => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.type === 'pong') return;
      if (m.op !== 'cmd' || !m.id) return;
      try { const result = await handle(m); send({ id: m.id, ok: true, result }); log(`${m.verb} ok`); }
      catch (e) { send({ id: m.id, ok: false, code: e.code || 1, error: String(e.message || e).slice(0, 300) }); log(`${m.verb} failed: ${e.message}`); }
    };
    ws.onclose = e => { alive = false; if (e.code === 4401) revoked = true; if (e.code === 1012) takenOver = true; };
    let ping = 0;
    while (alive) {
      // 상태 훅(커스텀 엔진의 `boarder engine event`)이 남긴 줄 → 서버로
      const ev = eventsPath();
      if (existsSync(ev)) { const tmp = ev + '.send'; try { renameSync(ev, tmp); for (const l of readFileSync(tmp, 'utf8').split('\n').filter(Boolean)) { try { send({ type: 'event', ...JSON.parse(l) }); } catch {} } writeFileSync(tmp, ''); } catch {} }
      const cfgNow = E.loadCfg();
      const listed = await E.listAll(cfgNow);
      // 목록을 못 읽은 회: 전체 목록(서버가 없는 창을 닫음)을 보내지 않고 잊지도 않음 — 다음 회에 다시
      const now = Date.now(), full = !listed.failed.length && now - lastFull > 60000, changed = [];
      if (!listed.failed.length) for (const id of [...last.keys()]) if (!listed.some(w => w.id === id)) last.delete(id);
      for (const w of listed) {
        let st; try { st = await E.adapters(cfgNow)[w.engine].state(cfgNow, w.id); } catch { continue; }
        if (st.dialog) { const a = await answerDialog(w, st).catch(() => null); if (a) { log(`answered ${a} dialog in ${w.id}`); continue; } }
        const meta = w.meta && typeof w.meta === 'object' ? w.meta : undefined;
        const key = `${st.state}|${st.dialog || ''}|${st.limit || ''}|${w.name || ''}|${meta ? JSON.stringify(meta) : ''}`;
        try { await drainWindow(w, st); } catch (e) { log(`queue ${w.id}: ${e.message}`); }
        if (full || last.get(w.id) !== key) { changed.push({ id: w.id, engine: w.engine, name: w.name, ...(meta ? { meta } : {}), state: st.state, since: st.since, dialog: st.dialog, limit: st.limit, ...(st.error ? { error: String(st.error).slice(0, 200) } : {}), session_id: st.session_id || w.session_id }); last.set(w.id, key); }
      }
      try { await tickQueues(listed); } catch (e) { log(`queue: ${e.message}`); }
      if (full) { send({ type: 'state', full: true, windows: changed }); lastFull = now; }
      else if (changed.length) send({ type: 'state', windows: changed });
      if (++ping % 2 === 0) send({ type: 'ping' });
      for (let i = 0; i < 15 && alive; i++) await sleep(1000);
    }
    setReporter(null);
    if (revoked) { console.error('this device was revoked — run `boarder setup --yes` again'); process.exit(REVOKED_EXIT); }
    // 같은 기기 토큰의 다른 데몬이 자리를 가져감(1012) — 서로 밀어내지 않게 길게 쉼
    if (takenOver) { log('another engine daemon took over this device — waiting 60s'); takenOver = false; await sleep(60000); continue; }
    log('disconnected — reconnecting'); await sleep(1000);
  }
}

// ── 데몬 깔기(B-1b): Linux systemd --user(Restart=always), macOS launchd(KeepAlive). 시험용 다른 HOME 이면 파일만 쓰고 서비스 관리자는 안 건드림(watch.mjs 와 같은 까닭)
const UNIT = 'boarder-engine', LABEL = 'co.dgit.boarder.engine';
const unitPath = () => path.join(os.homedir(), '.config', 'systemd', 'user', `${UNIT}.service`);
const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const q = s => { const v = String(s); if (/[\r\n]/.test(v)) throw new Error('a path or setting has a line break'); return `"${v.replace(/(["\\])/g, '\\$1').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`; };
const xml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const realHome = () => { try { return path.resolve(os.homedir()) === path.resolve(os.userInfo().homedir); } catch { return true; } };
const envKeep = () => Object.fromEntries(['HOME', 'PATH', 'BOARDER_HOME', 'BOARDER_URL', 'CLAUDE_CONFIG_DIR', 'BOARDER_TMUX_SOCKET', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const run = async (cmd, args) => { const { execFileSync } = await import('node:child_process'); return execFileSync(cmd, args, { stdio: 'ignore', timeout: 20000 }); };

// 윈도우: 작업 스케줄러(로그온 때 시작). 작업은 dir()/engine-run.cmd 를 부르고, 그 파일이 환경 · 다시 띄우기(끝 코드 3 = 폐기면 멈춤)를 맡음
const TASK = 'BoarderEngine';
const winCmdPath = () => path.join(dir(), 'engine-run.cmd');
const cmdq = v => { if (/[\r\n"%]/.test(String(v))) throw new Error('a path or setting has a character the Windows launcher cannot hold'); return String(v); };
export function winLauncher(node, bin, env) {
  const sets = Object.entries(env).filter(([k]) => ['BOARDER_HOME', 'BOARDER_URL', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'].includes(k)).map(([k, v]) => `set "${k}=${cmdq(v)}"`);
  return ['@echo off', ...sets, ':loop', `"${cmdq(node)}" "${cmdq(bin)}" engine run`, 'if %errorlevel%==3 exit /b 3', 'ping -n 6 127.0.0.1 >nul', 'goto loop', ''].join('\r\n');
}
export const winTaskArgs = () => ['/create', '/tn', TASK, '/sc', 'onlogon', '/tr', `"${winCmdPath()}"`, '/rl', 'limited', '/f'];

const startupPath = () => path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', `${TASK}.cmd`);
/** 윈도우 깔기: 작업 스케줄러가 되면 그것, 로그인된 실사용자가 아니면(SYSTEM 등) 시작 폴더의 .cmd 로. 어느 길인지 how 에 */
export async function installWindows(node, env, { runCmd = run, startNow = defaultStartNow } = {}) {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dir(), { recursive: true });
  writeFileSync(winCmdPath(), winLauncher(node, BIN, env));
  try {
    await runCmd('schtasks', winTaskArgs());
    try { await runCmd('schtasks', ['/run', '/tn', TASK]); } catch {}
    return { ok: true, how: `Task Scheduler task ${TASK} (starts at every logon, restarts by itself)` };
  } catch (e) {
    const why = String(e.message || e).split('\n')[0];
    try {
      mkdirSync(path.dirname(startupPath()), { recursive: true });
      writeFileSync(startupPath(), `@echo off\r\nstart "" /min cmd /c "${cmdq(winCmdPath())}"\r\n`);
      try { startNow(); } catch {}
      return { ok: true, how: `Startup folder ${startupPath()} (Task Scheduler refused: ${why}; starts at your next logon, restarts by itself)` };
    } catch (e2) { return { ok: false, why: `Task Scheduler refused (${why}) and the Startup folder failed (${e2.message}) - run \`boarder engine run\` yourself` }; }
  }
}
function defaultStartNow() { const ch = spawn('cmd.exe', ['/d', '/c', winCmdPath()], { detached: true, stdio: 'ignore', windowsHide: true }); ch.on('error', () => {}); ch.unref(); }

export async function installService() {
  const env = envKeep(), node = process.execPath;
  const { mkdirSync } = await import('node:fs');
  try {
    if (process.platform === 'linux') {
      mkdirSync(path.dirname(unitPath()), { recursive: true });
      writeFileSync(unitPath(), `[Unit]\nDescription=Boarder engine (boarder engine run) — opens and watches AI windows for Boarder\nAfter=network-online.target\n\n[Service]\n${Object.entries(env).map(([k, v]) => `Environment=${q(`${k}=${v}`)}\n`).join('')}ExecStart=${q(node)} ${q(BIN)} engine run\nRestart=always\nRestartSec=5\nRestartPreventExitStatus=3\n# 리뷰 1: tmux 서버(그 안의 Claude 창들)는 데몬이 다시 떠도 살아 있게 — 데몬 프로세스만 멈춤\nKillMode=process\n\n[Install]\nWantedBy=default.target\n`);
      if (!realHome()) return { ok: false, file: unitPath(), why: `HOME (${os.homedir()}) is not your login home — run \`boarder engine run\` yourself` };
      await run('systemctl', ['--user', 'daemon-reload']);
      await run('systemctl', ['--user', 'enable', '--now', `${UNIT}.service`]);
      await run('systemctl', ['--user', 'restart', `${UNIT}.service`]);
      return { ok: true, how: `systemd --user ${UNIT}.service (restarts by itself)` };
    }
    if (process.platform === 'darwin') {
      const p = plistPath(); mkdirSync(path.dirname(p), { recursive: true });
      const logs = path.join(dir(), 'logs'); mkdirSync(logs, { recursive: true });
      writeFileSync(p, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${LABEL}</string>\n<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(BIN)}</string><string>engine</string><string>run</string></array>\n<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n<key>ThrottleInterval</key><integer>10</integer>\n<key>AbandonProcessGroup</key><true/>\n<key>StandardOutPath</key><string>${xml(path.join(logs, 'engine.log'))}</string>\n<key>StandardErrorPath</key><string>${xml(path.join(logs, 'engine.log'))}</string>\n</dict></plist>\n`);
      if (!realHome()) return { ok: false, file: p, why: `HOME (${os.homedir()}) is not your login home — run \`boarder engine run\` yourself` };
      const uid = String(process.getuid?.() ?? '');
      try { await run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]); } catch {}
      await run('launchctl', ['bootstrap', `gui/${uid}`, p]);
      return { ok: true, how: `launchd ${LABEL} (restarts by itself; stops while the Mac sleeps)` };
    }
    if (process.platform === 'win32') return installWindows(node, env);
    return { ok: false, why: `no service manager for ${process.platform} — run \`boarder engine run\` yourself` };
  } catch (e) { return { ok: false, why: `could not start the service (${String(e.message).split('\n')[0]}) — run \`boarder engine run\` yourself` }; }
}
export async function removeService() {
  const done = [], { rmSync } = await import('node:fs');
  try { const { execFileSync } = await import('node:child_process'); const c = E.loadCfg(); execFileSync(c.tmux || 'tmux', ['-L', process.env.BOARDER_TMUX_SOCKET || 'boarder', 'kill-server'], { stdio: 'ignore', timeout: 10000 }); done.push('tmux -L boarder (Boarder windows)'); } catch {}
  if (existsSync(unitPath())) { if (realHome()) { try { await run('systemctl', ['--user', 'disable', '--now', `${UNIT}.service`]); } catch {} } rmSync(unitPath(), { force: true }); done.push(unitPath()); if (realHome()) { try { await run('systemctl', ['--user', 'daemon-reload']); } catch {} } }
  if (existsSync(plistPath())) { if (realHome()) { try { await run('launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}/${LABEL}`]); } catch {} } rmSync(plistPath(), { force: true }); done.push(plistPath()); }
  if (process.platform === 'win32' || existsSync(winCmdPath()) || existsSync(startupPath())) {
    if (process.platform === 'win32' && realHome()) { try { await run('schtasks', ['/end', '/tn', TASK]); } catch {} try { await run('schtasks', ['/delete', '/tn', TASK, '/f']); done.push(`Task Scheduler task ${TASK}`); } catch {} }
    if (existsSync(startupPath())) { rmSync(startupPath(), { force: true }); done.push(startupPath()); }
    if (existsSync(winCmdPath())) { rmSync(winCmdPath(), { force: true }); done.push(winCmdPath()); }
  }
  return done;
}
export const writeEvent = o => appendFileSync(eventsPath(), JSON.stringify({ ...o, at: Date.now() }) + '\n', { mode: 0o600 });
