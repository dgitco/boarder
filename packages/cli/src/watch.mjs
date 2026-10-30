import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dir, ensureDir, home, loadDevice, readJson, server } from './config.mjs';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const VERSION = readJson(fileURLToPath(new URL('../package.json', import.meta.url)))?.version;
export const INTERVAL_S = 300;
const MEM_MIN_MB = 6 * 1024;     // work · pane: 가용 6GB 밑이면 새 창을 안 엶
const AGENTS = ['claude', 'codex', 'cursor', 'gemini'];
const run = (cmd, args, timeout = 10000) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 메모리: Linux 는 MemAvailable 그대로, macOS 는 vm_stat 의 free + inactive + speculative + purgeable(Activity Monitor 의 쓸 수 있는 양에 가까움)
function memory() {
  if (process.platform === 'linux') {
    const kb = k => { const m = new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(readFileSync(process.env.BOARDER_MEMINFO || '/proc/meminfo', 'utf8')); return m ? +m[1] : null; };
    const t = kb('MemTotal'), a = kb('MemAvailable');
    return { total_mb: t && Math.round(t / 1024), avail_mb: a && Math.round(a / 1024), min_mb: MEM_MIN_MB };
  }
  let avail = os.freemem();
  if (process.platform === 'darwin') {
    const v = run('vm_stat', []), page = +(/page size of (\d+)/.exec(v)?.[1] || 4096);
    const p = k => +(new RegExp(`${k}:\\s+(\\d+)`).exec(v)?.[1] || 0);
    if (v) avail = (p('Pages free') + p('Pages inactive') + p('Pages speculative') + p('Pages purgeable')) * page;
  }
  return { total_mb: Math.round(os.totalmem() / 1048576), avail_mb: Math.round(avail / 1048576), min_mb: MEM_MIN_MB };
}

// ── CPU: 1초 동안 os.cpus() 시간 차(모든 코어 평균 %) + load
async function cpu() {
  const snap = () => os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); return { idle: a.idle + c.times.idle, total: a.total + t }; }, { idle: 0, total: 0 });
  const a = snap(); await sleep(1000); const b = snap();
  const dt = b.total - a.total, pct = dt > 0 ? (1 - (b.idle - a.idle) / dt) * 100 : null;
  const [l1, l5] = os.loadavg();
  return { pct: pct == null ? undefined : Math.max(0, Math.min(100, pct)), load1: l1, load5: l5, cores: os.cpus().length };
}

// ── 디스크: df -P 의 Use%(server-watchdog 과 같은 줄)
function df(mount) {
  const line = run('df', ['-Pk', mount]).trim().split('\n').pop() || '';
  const f = line.split(/\s+/), pct = /(\d+)%/.exec(line);
  if (!pct) return {};
  return { pct: +pct[1], total_gb: +(+f[1] / 1048576).toFixed(1), free_gb: +(+f[3] / 1048576).toFixed(1) };
}

// ── 도는 에이전트: 프로세스 이름(또는 node 로 도는 스크립트 이름)으로 세고, 같은 에이전트의 자식 프로세스는 빼서 「세션 수」에 맞춤
export function countAgents(psText) {
  const procs = new Map();
  for (const l of psText.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l); if (!m) continue;
    const argv = m[3].trim().split(/\s+/), base = s => path.basename(s || '').toLowerCase();
    let name = base(argv[0]);
    if (['node', 'bun', 'deno'].includes(name) || /^node\d*$/.test(name)) name = base(argv[1]);
    const kind = name === 'claude' ? 'claude' : name === 'codex' ? 'codex' : (name === 'cursor-agent' || name === 'cursor') ? 'cursor' : name === 'gemini' ? 'gemini' : null;
    procs.set(m[1], { ppid: m[2], kind });
  }
  const out = Object.fromEntries(AGENTS.map(k => [k, 0]));
  for (const [, p] of procs) {
    if (!p.kind) continue;
    let up = procs.get(p.ppid), nested = false;
    for (let i = 0; up && i < 50; i++) { if (up.kind === p.kind) { nested = true; break; } up = procs.get(up.ppid); }
    if (!nested) out[p.kind]++;
  }
  return out;
}
const agents = () => countAgents(run('ps', ['-A', '-o', 'pid=,ppid=,args=']));

// ── Claude 계정: 메일 표시만. 주인 기기 한도 읽기는 ee/owner-usage.mjs(호스팅 전용, 공개 판에 없음)
const ownerMod = await import('./ee/owner-usage.mjs').catch(e => { if (e?.code === 'ERR_MODULE_NOT_FOUND') return null; throw e; });
function claudeDirs(own) {
  const h = home(), out = [];
  if (!own || !ownerMod) { const d = process.env.CLAUDE_CONFIG_DIR || path.join(h, '.claude'); return existsSync(path.join(h, '.claude.json')) || existsSync(path.join(d, '.claude.json')) ? [d] : []; }   // 남의 기기: 로그인 표시(.claude.json 메일)만 — 자격 파일 있는지도 안 봄
  return ownerMod.ownerDirs();
}
function accountEmail(d) {
  const files = path.basename(d) === '.claude' ? [path.join(home(), '.claude.json'), path.join(d, '.claude.json')] : [path.join(d, '.claude.json')];
  for (const f of files) { const e = readJson(f)?.oauthAccount?.emailAddress; if (e) return e; }
  return undefined;
}
async function usage(d, interactive, own) {
  const r = { email: accountEmail(d) };
  if (!own || !ownerMod) return { ...r, status: 'unknown' };
  return ownerMod.ownerUsage(d, interactive, r);
}

export async function collect({ interactive = false, own = false } = {}) {
  const [c, accounts] = await Promise.all([cpu(), Promise.all(claudeDirs(own).map(d => usage(d, interactive, own)))]);
  return {
    host: { name: os.hostname().split('.')[0], os: process.platform, arch: process.arch, uptime_s: Math.round(os.uptime()), cli: VERSION },
    mem: memory(), cpu: c, disk: df('/'), tmp: process.platform === 'linux' ? { pct: df('/tmp').pct } : {}, agents: agents(),
    accounts: accounts.map(a => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined && v !== null))),
  };
}

/** 재고 보내기만(들여오기 서비스가 5분마다 부름 — 보기 전용 기본엔 따로 타이머가 없음) */
export async function sendMetrics({ print = false, interactive = false } = {}) {
  const d = loadDevice();
  if (!d?.token) { const e = new Error('not signed in — run `boarder setup` first'); e.code = 'NO_DEVICE'; throw e; }
  // 이 기기가 주인 기기(감시만)인지는 서버가 정함 — 모르면 남의 기기로(자격 안 읽음)
  let own = false;
  try { const me = await fetch(`${server()}/api/device/me`, { headers: { authorization: `Bearer ${d.token}` }, signal: AbortSignal.timeout(15000) }); if (me.ok) { const j = await me.json(); own = j.scope === 'watch' || j.owner === true; } } catch {}
  const m = await collect({ interactive, own });
  if (print) console.log(JSON.stringify(m, null, 2));
  const r = await fetch(`${server()}/api/device/metrics`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${d.token}` }, body: JSON.stringify(m), signal: AbortSignal.timeout(20000) });
  if (r.status === 401) { const e = new Error('this device was revoked — run `boarder setup` again'); e.code = 'REVOKED'; throw e; }
  if (!r.ok) throw new Error(`Boarder answered ${r.status}`);
  return m;
}
export async function watchOnce({ print = false, interactive = false } = {}) {
  const m = await sendMetrics({ print, interactive });
  const gb = v => v == null ? '?' : (v / 1024).toFixed(1);
  const ag = Object.entries(m.agents).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none';
  await (await import('./importer.mjs')).watchTick();   // 들여오기(경우 (가)) 켠 기기면 지금 일도 이어서
  console.log(`sent to ${server()}: memory ${gb(m.mem.avail_mb)}/${gb(m.mem.total_mb)} GB free · CPU ${m.cpu.pct?.toFixed(0) ?? '?'}% · disk ${m.disk.pct ?? '?'}% · agents ${ag} · Claude accounts ${m.accounts.length}`);
}

// ── 주기 실행 깔기 · 지우기
const UNIT = 'boarder-watch', LABEL = 'co.dgit.boarder.watch';
const unitDir = () => path.join(home(), '.config', 'systemd', 'user');
const plistPath = () => path.join(home(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const q = s => { const v = String(s); if (/[\r\n]/.test(v)) throw new Error('a path or setting has a line break'); return `"${v.replace(/(["\\])/g, '\\$1').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`; };
const xml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
// systemd · launchd 는 로그인한 사람의 진짜 HOME 만 봄 — 시험용 다른 HOME 이면 파일만 쓰고 서비스 관리자는 건드리지 않음(진짜 타이머를 끄거나 바꾸지 않게)
const realHome = () => { try { return path.resolve(home()) === path.resolve(os.userInfo().homedir); } catch { return true; } };
const envKeep = () => Object.fromEntries(['HOME', 'BOARDER_HOME', 'BOARDER_URL'].filter(k => process.env[k]).map(k => [k, process.env[k]]));

/** 깔기(다시 돌려도 같음). 실패하면 이유 한 줄을 돌려줌 — setup 은 그걸 보여 주고 계속 */
export function installTimer() {
  const node = process.execPath, env = envKeep();
  try {
    if (process.platform === 'linux') {
      const d = ensureDir(unitDir(), 0o755);
      writeFileSync(path.join(d, `${UNIT}.service`), `[Unit]\nDescription=Boarder device watcher (boarder watch --once)\n\n[Service]\nType=oneshot\n${Object.entries(env).map(([k, v]) => `Environment=${q(`${k}=${v}`)}\n`).join('')}ExecStart=${q(node)} ${q(BIN)} watch --once\nTimeoutStartSec=90\nNice=10\n`);
      writeFileSync(path.join(d, `${UNIT}.timer`), `[Unit]\nDescription=Boarder device watcher every ${INTERVAL_S / 60} minutes\n\n[Timer]\nOnBootSec=1min\nOnUnitActiveSec=${INTERVAL_S}s\nRandomizedDelaySec=20s\n\n[Install]\nWantedBy=timers.target\n`);
      if (!realHome()) return { ok: false, why: `HOME (${home()}) is not your login home, so systemd won't run it — \`boarder watch --once\` still works` };
      execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore', timeout: 20000 });
      execFileSync('systemctl', ['--user', 'enable', '--now', `${UNIT}.timer`], { stdio: 'ignore', timeout: 20000 });
      return { ok: true, how: `systemd --user ${UNIT}.timer (every ${INTERVAL_S / 60} min)` };
    }
    if (process.platform === 'darwin') {
      const p = plistPath(); mkdirSync(path.dirname(p), { recursive: true });
      const logs = ensureDir(path.join(dir(), 'logs'));
      writeFileSync(p, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${LABEL}</string>\n<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(BIN)}</string><string>watch</string><string>--once</string></array>\n<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>\n<key>StartInterval</key><integer>${INTERVAL_S}</integer>\n<key>RunAtLoad</key><true/>\n<key>ProcessType</key><string>Background</string>\n<key>StandardOutPath</key><string>${xml(path.join(logs, 'watch.log'))}</string>\n<key>StandardErrorPath</key><string>${xml(path.join(logs, 'watch.log'))}</string>\n</dict></plist>\n`);
      if (!realHome()) return { ok: false, why: `HOME (${home()}) is not your login home, so launchd won't run it — \`boarder watch --once\` still works` };
      const uid = String(process.getuid?.() ?? '');
      run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
      execFileSync('launchctl', ['bootstrap', `gui/${uid}`, p], { stdio: 'ignore', timeout: 20000 });
      return { ok: true, how: `launchd ${LABEL} (every ${INTERVAL_S / 60} min)` };
    }
    return { ok: false, why: `no timer for ${process.platform} — run \`boarder watch\` yourself` };
  } catch (e) {
    return { ok: false, why: `could not start the timer (${e?.message?.split('\n')[0] || e}) — \`boarder watch --once\` still works` };
  }
}

export function removeTimer() {
  const done = [];
  if (process.platform === 'linux') {
    const files = [`${UNIT}.timer`, `${UNIT}.service`].map(f => path.join(unitDir(), f));
    if (files.some(existsSync)) {
      if (realHome()) run('systemctl', ['--user', 'disable', '--now', `${UNIT}.timer`], 20000);
      for (const f of files) if (existsSync(f)) { rmSync(f, { force: true }); done.push(f); }
      if (realHome()) run('systemctl', ['--user', 'daemon-reload'], 20000);
    }
  }
  if (process.platform === 'darwin' && existsSync(plistPath())) {
    if (realHome()) run('launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}/${LABEL}`], 20000);
    rmSync(plistPath(), { force: true }); done.push(plistPath());
  }
  return done;
}

export const WATCH_HELP = `Device watcher (memory · CPU · disk · running agents · Claude limits → Settings › Devices)
  boarder watch --once [--print]    measure and send once (--print shows what is sent)
  boarder watch                     keep sending every ${INTERVAL_S / 60} minutes (setup installs a timer that runs --once)
  boarder watch install | remove    install or remove that timer`;

export async function watchCommand(sub, flags) {
  if (sub === 'install') { const r = installTimer(); console.log(r.ok ? `watcher: ${r.how}` : `watcher: ${r.why}`); if (!r.ok) process.exitCode = 1; return; }
  if (sub === 'remove') { const d = removeTimer(); console.log(d.length ? `watcher removed (${d.join(', ')})` : 'watcher was not installed'); return; }
  if (sub) { console.error(WATCH_HELP); process.exit(64); }
  const interactive = !!process.stdout.isTTY;
  if (flags.once) return watchOnce({ print: !!flags.print, interactive });
  for (;;) { try { await watchOnce({ print: !!flags.print, interactive }); } catch (e) { if (e.code === 'NO_DEVICE' || e.code === 'REVOKED') throw e; console.error(e.message); } await sleep(INTERVAL_S * 1000); }
}
