import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, rmdirSync, renameSync, realpathSync, statSync, chmodSync } from 'node:fs';
import { DEFAULT_SERVER, dir, ensureDir, home, loadDevice, readJson, saveDevice, sha, writeSecret } from './config.mjs';
import { installTimer, removeTimer, watchOnce } from './watch.mjs';
import { ensureEngine } from './engine/cmd.mjs';
import { removeService } from './engine/daemon.mjs';
import { installFollow, removeFollow, missingDirs, noteMade } from './view.mjs';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const NODE = process.execPath;
const which = cmd => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
const H = (...p) => path.join(home(), ...p);

export const TOOLS = {
  claude: { label: 'Claude Code', found: () => existsSync(H('.claude')) || which('claude') },
  codex: { label: 'Codex', found: () => existsSync(H('.codex')) || which('codex') },
  cursor: { label: 'Cursor', found: () => existsSync(H('.cursor')) || which('cursor') },
  gemini: { label: 'Gemini CLI', found: () => existsSync(H('.gemini')) || which('gemini') },
};
export const found = () => Object.keys(TOOLS).filter(t => TOOLS[t].found());

// ── 백업: 한 번 돌릴 때 백업 하나, 파일마다 원래 있었는지 · 사본
function backup() {
  const base = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  let id = base; for (let n = 2; existsSync(path.join(dir(), 'backups', id)); n++) id = `${base}-${n}`;   // 같은 초에 두 번 돌려도 앞 백업을 덮지 않게
  const root = ensureDir(path.join(dir(), 'backups', id)), files = [];
  return {
    id,
    save(p) {
      if (files.some(f => f.path === p)) return;
      const existed = existsSync(p), copy = existed ? path.join(root, `${files.length}`) : null;
      if (existed) copyFileSync(p, copy);
      // 우리가 새로 만들 폴더(끄면 비었을 때 지움 — 흔적 0)
      const made = []; for (let d = path.dirname(p); d.startsWith(home() + path.sep) && !existsSync(d); d = path.dirname(d)) made.push(d);
      files.push({ path: p, existed, copy, made });
      writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ id, at: Date.now(), files }, null, 2));
    },
    wrote(p, hash) { const f = files.find(x => x.path === p); if (!f) return; f.wrote = hash; writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ id, at: Date.now(), files }, null, 2)); },
    get count() { return files.length; },
    drop() { if (!files.length) rmSync(root, { recursive: true, force: true }); },
  };
}
/** Boarder 가 AI 도구에 넣은 칸(MCP · 시작 훅 · 스킬)만 뺌 — `boarder disable report` · restore · uninstall */
export function dropReport() {
  const done = [], exact = new Set(), made = new Set();
  // 1) 우리가 쓴 뒤 아무도 안 바꾼 파일은 쓰기 전 바이트 그대로(없던 파일은 지움). 두 번 켰으면(새 백업 사본 = 앞서 우리가 쓴 것) 더 옛 백업까지 이어서 — 끄면 흔적 0
  const bdir = path.join(dir(), 'backups'), byPath = new Map();
  for (const id of (existsSync(bdir) ? readdirSync(bdir) : []).sort().reverse()) {
    for (const f of readJson(path.join(bdir, id, 'manifest.json'))?.files || []) {
      for (const d of f.made || []) made.add(d);
      if (f.wrote) (byPath.get(f.path) || byPath.set(f.path, []).get(f.path)).push(f);   // 새것부터
    }
  }
  for (const [p, list] of byPath) {
    if (!existsSync(p)) continue;
    let cur = sha(readFileSync(p, 'utf8')), text, hit = false;
    for (const f of list) {
      if (cur !== f.wrote) break;
      text = f.existed && f.copy && existsSync(f.copy) ? readFileSync(f.copy, 'utf8') : null; hit = true;
      cur = text === null ? null : sha(text);
    }
    if (!hit) continue;
    if (text === null) rmSync(p, { force: true }); else atomic(p, text);
    exact.add(p); done.push(p);
  }
  const dropJson = (p, fn) => { if (!existsSync(p)) return; let j; try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { return; } const before = JSON.stringify(j); fn(j); if (JSON.stringify(j) !== before) { atomic(p, JSON.stringify(j, null, 2) + '\n'); done.push(p); } };
  dropJson(H('.claude.json'), j => { if (j.mcpServers) delete j.mcpServers.boarder; });
  dropJson(H('.claude', 'settings.json'), j => { const l = j.hooks?.SessionStart; if (Array.isArray(l)) { const k = l.filter(x => !(JSON.stringify(x).includes('hook session-start') && JSON.stringify(x).includes('boarder'))); if (k.length === l.length) return; if (k.length) j.hooks.SessionStart = k; else delete j.hooks.SessionStart; } });
  dropJson(H('.cursor', 'mcp.json'), j => { if (j.mcpServers) delete j.mcpServers.boarder; });
  dropJson(H('.gemini', 'settings.json'), j => { if (j.mcpServers) delete j.mcpServers.boarder; });
  const toml = H('.codex', 'config.toml');
  if (existsSync(toml)) { const old = readFileSync(toml, 'utf8'), t = old.replace(TOML_SEC_END, '').replace(TOML_SEC, ''); if (t !== old) { atomic(toml, t); done.push(toml); } }
  for (const t of Object.keys(TOOLS)) for (const f of skillFiles(t)) if (existsSync(f)) { rmSync(path.dirname(f), { recursive: true, force: true }); done.push(f); }
  for (const d of [...made].sort((a, b) => b.length - a.length)) { try { if (!readdirSync(d).length) rmdirSync(d); } catch {} }   // 우리가 만든 폴더 — 빈 것만(깊은 것부터)
  return [...new Set(done)];
}
export async function restore(id) {
  const done = dropReport();
  for (const p of removeTimer()) done.push(p);
  for (const p of await removeService()) done.push(p);   // 엔진 데몬(B-1)
  for (const p of removeFollow()) done.push(p);   // 읽어 올리기 서비스(보기 · 누르기 전용)
  for (const p of done) console.log(`removed Boarder from ${p}`);
  const b = path.join(dir(), 'backups');
  console.log(done.length ? 'Boarder is removed from your AI tools. Restart them.' : 'Boarder was not in your AI tools.');
  if (existsSync(b)) console.log(`Full copies from before setup are kept in ${b}${id ? '' : ' (pass nothing — restore only removes what Boarder added)'}.`);
}

// ── 도구마다 쓰기
// 그 칸 머리부터 다음 칸 머리(줄 첫 [) 앞까지 — args 의 [ 에서 멈추지 않게, \r\n 도
const TOML_SEC = /^\[mcp_servers\.boarder\][ \t]*\r?\n(?:(?![ \t]*\[).*(?:\r?\n|$))*/m;
const TOML_SEC_END = /(?<=\n)\r?\n\[mcp_servers\.boarder\][ \t]*\r?\n(?:(?![ \t]*\[).*(?:\r?\n|$))*$/;
const mcpEntry = { command: NODE, args: [BIN, 'mcp'] };
function atomic(p, text) {
  const real = existsSync(p) ? realpathSync(p) : p, mode = existsSync(real) ? statSync(real).mode & 0o777 : 0o644;
  mkdirSync(path.dirname(real), { recursive: true });
  const tmp = `${real}.boarder-${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode }); chmodSync(tmp, mode); renameSync(tmp, real);
}
function writeText(bk, p, text) { const old = existsSync(p) ? readFileSync(p, 'utf8') : null; if (old === text) return false; bk?.save(p); atomic(p, text); bk?.wrote(p, sha(text)); return true; }
function editJson(bk, p, fn) {
  const old = existsSync(p) ? readFileSync(p, 'utf8') : '';
  let j = {}; if (old.trim()) { try { j = JSON.parse(old); } catch { throw new Error(`${p} is not valid JSON — fix it or move it away, then run setup again`); } }
  fn(j);
  const text = JSON.stringify(j, null, 2) + '\n';
  return writeText(bk, p, text);
}
function skillFiles(t) {
  if (t === 'claude') return [H('.claude', 'skills', 'boarder', 'SKILL.md')];
  if (t === 'codex') return [H('.codex', 'skills', 'boarder', 'SKILL.md'), H('.agents', 'skills', 'boarder', 'SKILL.md')];
  return [];
}
function writeTool(bk, t, skill) {
  const done = [];
  if (t === 'claude') {
    if (editJson(bk, H('.claude.json'), j => { j.mcpServers = { ...(j.mcpServers || {}), boarder: { type: 'stdio', ...mcpEntry, env: {} } }; })) done.push('MCP');
    const sq = v => `'${v.replace(/'/g, `'\\''`)}'`;   // 경로에 " $ ` 가 있어도 셸이 안 풀게
    const hook = `${sq(NODE)} ${sq(BIN)} hook session-start`;
    if (editJson(bk, H('.claude', 'settings.json'), j => {
      j.hooks ||= {}; const list = (j.hooks.SessionStart ||= []);
      const mine = list.findIndex(x => JSON.stringify(x).includes('hook session-start') && JSON.stringify(x).includes('boarder'));
      const entry = { hooks: [{ type: 'command', command: hook, timeout: 10 }] };
      if (mine >= 0) list[mine] = entry; else list.push(entry);
    })) done.push('hook');
  }
  if (t === 'codex') {
    const p = H('.codex', 'config.toml'), old = existsSync(p) ? readFileSync(p, 'utf8') : '';
    const nl = old.includes('\r\n') ? '\r\n' : '\n';
    const sec = `[mcp_servers.boarder]${nl}command = ${JSON.stringify(NODE)}${nl}args = [${JSON.stringify(BIN)}, "mcp"]${nl}`;
    const re = TOML_SEC;
    // 뒤에 다른 칸이 있을 때만 빈 줄 — 다시 돌려도 같은 글
    const text = re.test(old) ? old.replace(re, (m, at) => sec + (at + m.length < old.length ? nl : '')) : (old && !old.endsWith('\n') ? old + nl : old) + (old ? nl : '') + sec;
    if (writeText(bk, p, text)) done.push('MCP');
  }
  if (t === 'cursor' && editJson(bk, H('.cursor', 'mcp.json'), j => { j.mcpServers = { ...(j.mcpServers || {}), boarder: mcpEntry }; })) done.push('MCP');
  if (t === 'gemini' && editJson(bk, H('.gemini', 'settings.json'), j => { j.mcpServers = { ...(j.mcpServers || {}), boarder: mcpEntry }; })) done.push('MCP');
  for (const f of skillFiles(t)) if (writeText(bk, f, skill)) { if (!done.includes('skill')) done.push('skill'); }
  return done;
}
export function configured(t) {
  try {
    if (t === 'claude') return !!readJson(H('.claude.json'))?.mcpServers?.boarder;
    if (t === 'codex') return /^\[mcp_servers\.boarder\][ \t]*\r?$/m.test(readFileSync(H('.codex', 'config.toml'), 'utf8'));
    if (t === 'cursor') return !!readJson(H('.cursor', 'mcp.json'))?.mcpServers?.boarder;
    if (t === 'gemini') return !!readJson(H('.gemini', 'settings.json'))?.mcpServers?.boarder;
  } catch {}
  return false;
}

// ── 로그인: 기기 코드
const sleep = ms => new Promise(r => setTimeout(r, ms));
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) ? ['xdg-open', [url]] : null;
  if (!cmd) return false;
  try { const ch = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }); ch.on('error', () => {}); ch.unref(); return true; } catch { return false; }   // 여는 명령이 없어도 setup 이 죽지 않게
}
async function signedIn(srv) {
  const d = loadDevice(); if (!d?.token || d.server !== srv) return null;
  try { const r = await fetch(`${srv}/api/device/me`, { headers: { authorization: `Bearer ${d.token}` }, signal: AbortSignal.timeout(15000) }); return r.ok ? await r.json() : null; } catch { return null; }
}
// 로그인: 기본은 Codex · Grok · Claude Code 처럼 브라우저가 열리고 「허용」 한 번 → 127.0.0.1 콜백(코드 입력 · 대조 없음).
// 브라우저 없는 기기(SSH · 화면 없음)나 --device-auth 면 코드 길(gh · `codex login --device-auth` 처럼)
const headless = () => !!(process.env.SSH_CONNECTION || process.env.SSH_TTY) || (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY);
const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const DONE_PAGE = (ok, msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Boarder</title><body style="font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#111113"><div style="text-align:center;max-width:420px;padding:24px"><h1 style="font-size:24px;margin:0 0 8px">${ok ? '허용했어요' : '거절했어요'}</h1><p style="color:#52525b;margin:0">${msg}</p></div>`;
async function listen(want) {
  const http = await import('node:http');
  let resolve; const got = new Promise(r => { resolve = r; });
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback' || u.searchParams.get('state') !== want) { r.writeHead(404); return r.end(); }
    const ok = !!u.searchParams.get('code');
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    r.end(DONE_PAGE(ok, ok ? '터미널로 돌아가요 — boarder setup 이 이어서 해요. 이 탭은 닫아도 돼요.' : '터미널의 boarder setup 은 멈춰요.'));
    resolve({ state: u.searchParams.get('state'), code: u.searchParams.get('code'), error: u.searchParams.get('error') });
  });
  await new Promise((ok, no) => { srv.once('error', no); srv.listen(0, '127.0.0.1', ok); });
  return { port: srv.address().port, got, close: () => srv.close() };
}
async function login(srv, tools, { browser, deviceAuth }) {
  const { randomBytes, createHash } = await import('node:crypto');
  const state = b64u(randomBytes(24));
  const local = browser && !deviceAuth && !headless() ? await listen(state).catch(() => null) : null;
  const verifier = b64u(randomBytes(32)), challenge = b64u(createHash('sha256').update(verifier).digest());
  const body = { name: `${os.hostname().split('.')[0]} (${process.platform})`, tools, ...(local ? { callback: `http://127.0.0.1:${local.port}/callback`, state, code_challenge: challenge } : {}) };
  const r = await fetch(`${srv}/api/device/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!r.ok) { local?.close(); throw new Error(`Boarder server answered ${r.status} — check the address (${srv})`); }
  const c = await r.json();
  const until = Date.now() + c.expires_in * 1000;
  const tokenOf = async extra => {
    const p = await fetch(`${srv}/api/device/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_code: c.device_code, ...extra }), signal: AbortSignal.timeout(20000) });
    return p.json().catch(() => ({}));
  };
  const save = j => { saveDevice({ server: srv, token: j.token, email: j.email, device_id: j.device_id, at: Date.now() }); return { email: j.email, scope: j.scope || 'full' }; };
  if (local && c.mode === 'local') {
    console.log(`\nOpening your browser to approve this machine: ${c.verify_url}`);
    console.log(`(Press 「허용」 there — nothing to type. If the browser didn't open, open that link. Waiting up to ${Math.round(c.expires_in / 60)} minutes…)\n`);
    if (!openBrowser(c.verify_url)) console.log('Could not open a browser here — open the link above yourself.');
    let tm; const timer = new Promise(res => { tm = setTimeout(() => res({ error: 'expired' }), Math.max(0, until - Date.now())); });
    const got = await Promise.race([local.got, timer]); clearTimeout(tm); local.close();
    if (got.error === 'denied') throw new Error('The sign-in was declined in the browser. Run `boarder setup --yes` again if that was a mistake.');
    if (got.error) throw new Error('The request expired before it was approved. Run `boarder setup --yes` again.');
    if (got.state !== state) throw new Error('The browser answered for a different request — run `boarder setup --yes` again.');
    const j = await tokenOf({ code: got.code, code_verifier: verifier });
    if (j.state === 'approved') return save(j);
    throw new Error(`Sign-in failed: ${j.error || j.state || 'unknown'}`);
  }
  local?.close();
  console.log(`\nOne-time code: ${c.user_code}`);
  console.log(`Approve this machine in a browser: ${c.verify_url.replace(/\?code=.*$/, '')}  (type the code there)`);
  console.log(`(Check the code matches, then press 「허용」. Waiting up to ${Math.round(c.expires_in / 60)} minutes…)\n`);
  if (browser) openBrowser(c.verify_url.replace(/\?code=.*$/, ''));
  while (Date.now() < until) {
    await sleep((c.interval || 3) * 1000);
    let j; try { j = await tokenOf({}); } catch { continue; }
    if (j.state === 'approved') return save(j);
    if (j.state === 'denied') throw new Error('The sign-in was declined in the browser. Run `boarder setup --yes` again if that was a mistake.');
    if (j.error === 'expired') break;
    if (j.error && j.error !== 'pending') throw new Error(`Sign-in failed: ${j.error}`);
  }
  throw new Error('The code expired before it was approved. Run `boarder setup --yes` again for a new code.');
}

async function watcher(opts) {
  if (opts.noWatch) return;
  const t = installTimer();
  console.log(`\nDevice watcher: ${t.ok ? t.how : t.why}`);
  try { await watchOnce({ interactive: !!process.stdout.isTTY }); } catch (e) { console.log(`Device watcher: first send failed (${e.message}) — it retries on the timer`); }
}

/** 켜기(report): AI 도구마다 MCP · 시작 훅 · 스킬(먼저 백업) — 옛 setup 기본, 지금은 `boarder enable report` · `setup --report` */
export async function writeReport({ srv = (loadDevice()?.server || DEFAULT_SERVER).replace(/\/+$/, ''), tools = found(), log = console.log } = {}) {
  let skill;
  try { const r = await fetch(`${srv}/api/install/skill`, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw 0; skill = await r.text(); }
  catch { throw new Error(`Could not get the Boarder skill from ${srv}`); }
  const bk = backup(), lines = [];
  for (const t of tools) { const d = writeTool(bk, t, skill); lines.push(`  ${TOOLS[t].label}: ${d.length ? d.join(', ') + ' added' : 'already set up'}`); }
  log('\n' + lines.join('\n'));
  if (bk.count) log(`\nBacked up first — undo with: boarder disable report`); else bk.drop();
  return { tools: tools.filter(t => configured(t)) };
}

export async function setup(opts) {
  const srv = (opts.server || process.env.BOARDER_URL || loadDevice()?.server || DEFAULT_SERVER).replace(/\/+$/, '');
  console.log('Boarder setup');
  const pre = missingDirs(dir());
  const tools = opts.only?.length ? opts.only.filter(t => TOOLS[t]) : found();
  if (!tools.length) { console.error('No AI tools found. Install Claude Code, Codex, Cursor or Gemini CLI, then run this again.'); process.exit(1); }
  console.log(`Tools: ${tools.map(t => TOOLS[t].label).join(', ')}`);
  const who = (await signedIn(srv)) || await login(srv, tools, { browser: !opts.noBrowser, deviceAuth: !!opts.deviceAuth }), email = who.email;
  noteMade(pre);
  console.log(`Signed in as ${email}${who.scope === 'watch' ? ' (watch only)' : ''}`);
  if (who.scope === 'watch') { await watcher(opts); return console.log('\nThis device only reports memory · CPU · disk · agents · Claude limits to Settings › Devices. Your AI tools were not changed.'); }
  if (opts.report) await writeReport({ srv, tools });
  else console.log(`\nView mode: Boarder reads your AI windows, sessions and to-dos and shows them as nodes on your board. Nothing in ${tools.map(t => TOOLS[t].label).join(', ')} (CLAUDE.md, AGENTS.md, hooks, settings, MCP, skills), your harness (Herdr, tmux) or your shell files was changed.`);
  if (!opts.noWatch) { const f = installFollow(); console.log(`\nReader: ${f.ok ? f.how : f.why}`); }
  if (opts.engine && !opts.noEngine && tools.includes('claude')) {
    console.log('\nEngine (lets Boarder open and manage Claude Code windows here):');
    try { await ensureEngine({ log: l => console.log('  ' + l) }); }
    catch (e) { console.log(`  engine not set up: ${e.message} — Boarder still works for reports; try \`boarder engine setup\` later`); }
  }
  console.log(`\nTurn more on only if you want it (each can be turned off again):\n  boarder enable report    your agents report to Boarder themselves (adds Boarder to your AI tools, backed up first)\n  boarder enable engine    Boarder opens, wakes, parks and closes AI windows here\n  boarder uninstall        remove Boarder from this machine`);
  console.log(`\nNext:\n  boarder status                          check this machine\n  boarder import --setup                  bring your current work in as nodes (${srv})\n\nDone.${opts.report ? ` Restart ${tools.map(t => TOOLS[t].label).join(', ')} (and open sessions) to load Boarder.` : ''}`);
}
