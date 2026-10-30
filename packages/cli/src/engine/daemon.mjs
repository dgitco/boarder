import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, appendFileSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dir, loadDevice, server, readJson } from '../config.mjs';
import * as E from './index.mjs';

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

async function handle(msg) {
  const { verb, args = {} } = msg;
  if (verb === 'list') return { windows: await E.listAll() };
  if (verb === 'close') { const w = (await E.listAll()).find(x => x.id === args.id); if (w) await saveSession({ ...w, cwd: w.spec?.cwd ? w.spec.cwd.replace(/^~(?=$|\/)/, os.homedir()) : w.cwd }); }
  if (verb === 'open' && args.spec) args.spec = { ...args.spec, cwd: args.spec.cwd || path.join(E.engineHome(), 'work') };
  return E.run(verb, args);
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
    const cfg = E.loadCfg();
    const hw = await E.listAll(cfg);
    send({ type: 'hello', v: 1, primary: !cfg.no_primary, cli: VERSION, host: os.hostname().split('.')[0], os: process.platform, default: E.pick(cfg), engines: Object.fromEntries(Object.keys(E.adapters(cfg)).map(n => [n, { caps: cfg.caps?.[n] || null }])), windows: hw, ...(hw.failed.length ? { partial: true } : {}) });
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
        if (full || last.get(w.id) !== key) { changed.push({ id: w.id, engine: w.engine, name: w.name, ...(meta ? { meta } : {}), state: st.state, since: st.since, dialog: st.dialog, limit: st.limit, session_id: st.session_id || w.session_id }); last.set(w.id, key); }
      }
      if (full) { send({ type: 'state', full: true, windows: changed }); lastFull = now; }
      else if (changed.length) send({ type: 'state', windows: changed });
      if (++ping % 2 === 0) send({ type: 'ping' });
      for (let i = 0; i < 15 && alive; i++) await sleep(1000);
    }
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
    return { ok: false, why: `no service manager for ${process.platform} — run \`boarder engine run\` yourself` };
  } catch (e) { return { ok: false, why: `could not start the service (${String(e.message).split('\n')[0]}) — run \`boarder engine run\` yourself` }; }
}
export async function removeService() {
  const done = [], { rmSync } = await import('node:fs');
  try { const { execFileSync } = await import('node:child_process'); const c = E.loadCfg(); execFileSync(c.tmux || 'tmux', ['-L', process.env.BOARDER_TMUX_SOCKET || 'boarder', 'kill-server'], { stdio: 'ignore', timeout: 10000 }); done.push('tmux -L boarder (Boarder windows)'); } catch {}
  if (existsSync(unitPath())) { if (realHome()) { try { await run('systemctl', ['--user', 'disable', '--now', `${UNIT}.service`]); } catch {} } rmSync(unitPath(), { force: true }); done.push(unitPath()); if (realHome()) { try { await run('systemctl', ['--user', 'daemon-reload']); } catch {} } }
  if (existsSync(plistPath())) { if (realHome()) { try { await run('launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}/${LABEL}`]); } catch {} } rmSync(plistPath(), { force: true }); done.push(plistPath()); }
  return done;
}
export const writeEvent = o => appendFileSync(eventsPath(), JSON.stringify({ ...o, at: Date.now() }) + '\n', { mode: 0o600 });
