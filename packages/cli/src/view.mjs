import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, rmdirSync } from 'node:fs';
import { dir, ensureDir, home, loadDevice, server } from './config.mjs';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const UNIT = 'boarder-follow', LABEL = 'co.dgit.boarder.follow';
const unitPath = () => path.join(home(), '.config', 'systemd', 'user', `${UNIT}.service`);
const plistPath = () => path.join(home(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const q = s => { const v = String(s); if (/[\r\n]/.test(v)) throw new Error('a path or setting has a line break'); return `"${v.replace(/(["\\])/g, '\\$1').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`; };
const xml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
// systemd · launchd 는 로그인한 사람의 진짜 HOME 만 봄 — 시험용 다른 HOME 이면 파일만 쓰고 서비스 관리자는 안 건드림(watch.mjs 와 같음)
const realHome = () => { try { return path.resolve(home()) === path.resolve(os.userInfo().homedir); } catch { return true; } };
const sh = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore', timeout: 20000 }); return true; } catch { return false; } };

const madePath = () => path.join(dir(), 'made-dirs.json');
export const missingDirs = d => { const out = []; for (let x = path.resolve(d); x.startsWith(path.resolve(home()) + path.sep) && !existsSync(x); x = path.dirname(x)) out.push(x); return out; };
export function noteMade(list) { if (!list.length) return; let old = []; try { old = JSON.parse(readFileSync(madePath(), 'utf8')); } catch {} ensureDir(dir()); writeFileSync(madePath(), JSON.stringify([...new Set([...old, ...list])])); }
const madeList = () => { try { return JSON.parse(readFileSync(madePath(), 'utf8')); } catch { return []; } };
const rmdirEmpty = l => { for (const d of [...l].sort((a, b) => b.length - a.length)) { try { if (!readdirSync(d).length) rmdirSync(d); } catch {} } };
function mkdirNoting(d) { const made = missingDirs(d); mkdirSync(d, { recursive: true }); noteMade(made); }
function rmdirMade() { rmdirEmpty(madeList().filter(d => !path.resolve(d).startsWith(path.resolve(dir())))); }

/** 읽어 올리기 · 누른 것 넣기(boarder import --follow)를 늘 돌리는 서비스 하나 */
export function installFollow() {
  const node = process.execPath, env = Object.fromEntries(['HOME', 'BOARDER_HOME', 'BOARDER_URL', 'PATH'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  try {
    if (process.platform === 'linux') {
      mkdirNoting(path.dirname(unitPath()));
      writeFileSync(unitPath(), `[Unit]\nDescription=Boarder (reads your AI windows for your board, carries out what you press there)\nAfter=network-online.target\n\n[Service]\n${Object.entries(env).map(([k, v]) => `Environment=${q(`${k}=${v}`)}\n`).join('')}ExecStart=${q(node)} ${q(BIN)} import --follow\nRestart=always\nRestartSec=30\nRestartPreventExitStatus=3\nNice=10\n\n[Install]\nWantedBy=default.target\n`);
      if (!realHome()) return { ok: false, file: unitPath(), why: `HOME (${home()}) is not your login home — run \`boarder import --follow\` yourself` };
      sh('systemctl', ['--user', 'daemon-reload']);
      noteMade(missingDirs(path.join(path.dirname(unitPath()), 'default.target.wants')));   // enable 이 만드는 폴더 — 끄면 비었을 때 지움
      if (!sh('systemctl', ['--user', 'enable', '--now', `${UNIT}.service`])) return { ok: false, why: 'systemd --user did not start it — run `boarder import --follow` yourself' };
      return { ok: true, how: `systemd --user ${UNIT}.service` };
    }
    if (process.platform === 'darwin') {
      const p = plistPath(); mkdirNoting(path.dirname(p));
      const logs = ensureDir(path.join(dir(), 'logs'));
      writeFileSync(p, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${LABEL}</string>\n<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(BIN)}</string><string>import</string><string>--follow</string></array>\n<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n<key>ThrottleInterval</key><integer>30</integer>\n<key>ProcessType</key><string>Background</string>\n<key>StandardOutPath</key><string>${xml(path.join(logs, 'follow.log'))}</string>\n<key>StandardErrorPath</key><string>${xml(path.join(logs, 'follow.log'))}</string>\n</dict></plist>\n`);
      if (!realHome()) return { ok: false, file: p, why: `HOME (${home()}) is not your login home — run \`boarder import --follow\` yourself` };
      const uid = String(process.getuid?.() ?? '');
      sh('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
      if (!sh('launchctl', ['bootstrap', `gui/${uid}`, p])) return { ok: false, why: 'launchd did not start it — run `boarder import --follow` yourself' };
      return { ok: true, how: `launchd ${LABEL}` };
    }
    return { ok: false, why: `no service manager for ${process.platform} — run \`boarder import --follow\` yourself` };
  } catch (e) { return { ok: false, why: `could not start it (${String(e?.message || e).split('\n')[0]}) — run \`boarder import --follow\` yourself` }; }
}
export function removeFollow() {
  const done = [];
  if (existsSync(unitPath())) { if (realHome()) sh('systemctl', ['--user', 'disable', '--now', `${UNIT}.service`]); rmSync(unitPath(), { force: true }); done.push(unitPath()); if (realHome()) sh('systemctl', ['--user', 'daemon-reload']); }
  if (existsSync(plistPath())) { if (realHome()) sh('launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}/${LABEL}`]); rmSync(plistPath(), { force: true }); done.push(plistPath()); }
  rmdirMade();
  return done;
}

const setupMod = () => import('./setup.mjs');
const engineMod = () => import('./engine/index.mjs').catch(() => null);
/** 이 기기에서 켠 것 — 들여오기가 보드로 올려 설정 칸에 보임 */
export async function features() {
  const S = await setupMod(), E = await engineMod();
  const cfg = E?.loadCfg?.() || {};
  return { report: S.found().filter(t => S.configured(t)), engine: !!cfg.tmux, view: true };
}

export async function enable(what, { log = console.log } = {}) {
  if (what === 'report') {
    const S = await setupMod(), r = await S.writeReport({ log });
    return { ok: true, report: r.tools };
  }
  if (what === 'engine') {
    const { ensureEngine } = await import('./engine/cmd.mjs');
    const r = await ensureEngine({ log });
    return { ok: !!r.caps.length, engine: true, caps: r.caps };
  }
  throw new Error('enable report | engine');
}
export async function disable(what, { log = console.log } = {}) {
  if (what === 'report') { const S = await setupMod(), d = S.dropReport(); for (const p of d) log(`removed Boarder from ${p}`); return { ok: true, removed: d.length }; }
  if (what === 'engine') {
    const { removeService } = await import('./engine/daemon.mjs');
    // engine.json 은 남김(그 사람이 붙인 커스텀 엔진 · 할 일 목록이 거기 있음) — 켰다는 표시(tmux 경로)만 뺌
    const d = await removeService(), E = await engineMod();
    if (E?.loadCfg) { const c = E.loadCfg(); delete c.tmux; delete c.claude; if (c.caps) delete c.caps.tmux; E.saveCfg(c); }
    for (const p of d) log(`removed ${p}`);
    return { ok: true, removed: d.length };
  }
  throw new Error('disable report | engine');
}

const RC_BLOCK = '\n# boarder\nexport PATH="$HOME/.local/bin:$PATH"\n';
export const shareDir = () => process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(home(), 'AppData', 'Local'), 'boarder') : path.join(process.env.XDG_DATA_HOME || path.join(home(), '.local', 'share'), 'boarder');

/** 지우기: 켠 것 끄기 → 서비스 · 타이머 → 이 기기 폐기 → 우리 파일 · 우리가 만든 빈 폴더. 그 사람 파일은 Boarder 가 넣은 칸만 빼고 그대로 */
export async function uninstall({ log = console.log } = {}) {
  const done = [];
  const S = await setupMod();
  done.push(...S.dropReport());
  const { removeTimer } = await import('./watch.mjs');
  done.push(...removeTimer(), ...removeFollow());
  try { const { removeService } = await import('./engine/daemon.mjs'); done.push(...await removeService()); } catch {}
  const d = loadDevice();
  if (d?.token) { try { await fetch(`${server()}/api/device/revoke`, { method: 'POST', headers: { authorization: `Bearer ${d.token}` }, signal: AbortSignal.timeout(15000) }); } catch {} }
  for (const n of ['.zshrc', '.bashrc', '.bash_profile', '.profile']) {
    const p = path.join(home(), n); if (!existsSync(p)) continue;
    const t = readFileSync(p, 'utf8'); if (t.includes(RC_BLOCK)) { writeFileSync(p, t.replace(RC_BLOCK, '')); done.push(p); }
  }
  // 설치기가 만든 폴더(.local/bin 등)는 적어 둔 것만, 비었을 때만 지움
  let made = madeList(); try { made = made.concat(readFileSync(path.join(shareDir(), 'created-dirs'), 'utf8').split(/\r?\n/).map(x => x.replace(/^\uFEFF/, '').trim()).filter(Boolean)); } catch {}
  const wrapper = path.join(home(), '.local', 'bin', 'boarder'), cmd = path.join(home(), '.local', 'bin', 'boarder.cmd');
  for (const f of [wrapper, cmd]) { try { if (/boarder[\\/]cli[\\/]bin[\\/]boarder\.mjs/.test(readFileSync(f, 'utf8'))) { rmSync(f, { force: true }); done.push(f); } } catch {} }
  const later = [];
  for (const p of [dir(), shareDir()]) if (existsSync(p)) { try { rmSync(p, { recursive: true, force: true }); done.push(p); } catch { later.push(p); } }
  const dirs = [...new Set(made)].filter(m => path.resolve(m).startsWith(path.resolve(home()) + path.sep)).sort((a, b) => b.length - a.length);
  for (const m of dirs) { try { if (!readdirSync(m).length) { rmdirSync(m); done.push(m); } } catch {} }
  if (later.length && process.platform === 'win32') {
    const qd = d => `"${d.replace(/"/g, '')}"`;
    // cmd 는 \" 를 모름 — 줄을 그대로(windowsVerbatimArguments) 넘기고, 기다리기는 ping(timeout 은 stdin 이 없으면 바로 끝남)
    const line = ['ping -n 4 127.0.0.1 >nul', ...later.map(d => `rmdir /s /q ${qd(d)}`), ...dirs.map(d => `rmdir ${qd(d)} 2>nul`)].join(' & ');
    try { const ch = spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }); ch.on('error', () => {}); ch.unref(); for (const p of later) done.push(`${p} (after this exits)`); } catch {}
  } else for (const p of later) log(`could not remove ${p} — remove it yourself`);
  for (const p of done) log(`removed ${p}`);
  log(done.length ? 'Boarder is removed from this machine.' : 'Boarder was not installed here.');
  return done;
}

export const VIEW_HELP = `What Boarder may change on this machine (all off after setup — setup only signs in and reads)
  boarder enable report             let your agents report to Boarder (adds its MCP server, a session-start hook and a skill to your AI tools, backed up first)
  boarder enable engine             let Boarder open, wake, park and close AI windows here (Boarder's own tmux and engine service)
  boarder disable report|engine     take that back out again
  boarder uninstall                 remove Boarder from this machine (leaves no trace)`;
