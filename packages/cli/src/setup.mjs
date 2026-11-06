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
import { targets, pick, label, state, LABELS } from './targets.mjs';

const BIN = fileURLToPath(new URL('../bin/boarder.mjs', import.meta.url));
const NODE = process.execPath;

// 도구 넷 — 설정을 쓰는 단위는 도구가 아니라 설정 폴더(targets.mjs: Claude 계정이 여럿이면 폴더마다)
export const TOOLS = Object.fromEntries(Object.entries(LABELS).map(([k, l]) => [k, { label: l }]));
export const found = () => [...new Set(targets().map(t => t.tool))];
export { targets };

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
export function dropReport({ only, skip, note = console.log } = {}) {
  const done = [], exact = new Set(), made = new Set();
  const all = targets(), whole = !only?.length && !skip?.length, list = pick(all, only, skip);
  const filesOf = t => [t.files.mcp, t.files.settings, t.files.toml, ...t.files.skills].filter(Boolean).map(p => path.resolve(p));
  const real = p => { try { return realpathSync(p); } catch { return path.resolve(p); } };
  const mine = new Set(list.flatMap(filesOf));
  const others = new Map(whole ? [] : all.filter(t => !list.includes(t)).flatMap(t => filesOf(t).filter(p => existsSync(p)).map(p => [real(p), t])));
  const shared = new Map();
  const isShared = p => { if (whole || !existsSync(p)) return false; const o = others.get(real(p)); if (o && !shared.has(p)) shared.set(p, o); return !!o; };
  // 1) 우리가 쓴 뒤 아무도 안 바꾼 파일은 쓰기 전 바이트 그대로(없던 파일은 지움). 두 번 켰으면(새 백업 사본 = 앞서 우리가 쓴 것) 더 옛 백업까지 이어서 — 끄면 흔적 0
  const bdir = path.join(dir(), 'backups'), byPath = new Map(), extra = new Set();
  for (const id of (existsSync(bdir) ? readdirSync(bdir) : []).sort().reverse()) {
    for (const f of readJson(path.join(bdir, id, 'manifest.json'))?.files || []) {
      for (const d of f.made || []) made.add(d);
      if (!f.wrote) continue;
      const p = path.resolve(f.path);
      if (!whole && !mine.has(p)) continue;   // 고른 폴더의 파일만
      if (!mine.has(p)) extra.add(p);   // 지금 targets() 가 못 찾는 폴더(setup 때만 보이던 것)
      (byPath.get(f.path) || byPath.set(f.path, []).get(f.path)).push(f);   // 새것부터
    }
  }
  for (const [p, list] of byPath) {
    if (!existsSync(p) || isShared(p)) continue;
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
  const dropJson = (p, fn) => { if (!existsSync(p) || isShared(p)) return; let j; try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { return; } const before = JSON.stringify(j); fn(j); if (JSON.stringify(j) !== before) { atomic(p, JSON.stringify(j, null, 2) + '\n'); done.push(p); } };
  const noMcp = j => { if (j.mcpServers) delete j.mcpServers.boarder; };
  const noHook = j => { for (const [ev, sub] of HOOKS) { const l = j.hooks?.[ev]; if (!Array.isArray(l)) continue; const k = l.filter(x => !ours(x, sub)); if (k.length === l.length) continue; if (k.length) j.hooks[ev] = k; else delete j.hooks[ev]; } if (j.hooks && !Object.keys(j.hooks).length) delete j.hooks; };
  const dropToml = toml => { if (!existsSync(toml) || isShared(toml)) return; const old = readFileSync(toml, 'utf8'), x = old.replace(TOML_SEC_END, '').replace(TOML_SEC, '').replace(TOML_NOTIFY, ''); if (x !== old) { atomic(toml, x); done.push(toml); } };
  const dropSkill = f => { if (!existsSync(f) || isShared(f)) return; rmSync(path.dirname(f), { recursive: true, force: true }); done.push(f); };
  for (const t of list) {
    if (t.tool === 'claude' || t.tool === 'cursor' || t.tool === 'gemini') dropJson(t.files.mcp, noMcp);
    if (t.tool === 'claude') dropJson(t.files.settings, noHook);
    if (t.tool === 'codex') dropToml(t.files.toml);
    for (const f of t.files.skills) dropSkill(f);
  }
  // 지금 못 찾는 폴더의 파일 — 도구를 모르니 파일 꼴로(.json 은 MCP 칸 · 훅 둘, .toml 은 MCP 칸 · notify, skills/boarder/SKILL.md 는 그 폴더)
  for (const p of extra) {
    if (p.endsWith('.json')) { dropJson(p, noMcp); dropJson(p, noHook); }
    else if (p.endsWith('.toml')) dropToml(p);
    else if (p.endsWith(path.join('skills', 'boarder', 'SKILL.md'))) dropSkill(p);
  }
  for (const d of [...made].sort((a, b) => b.length - a.length)) { try { if (!readdirSync(d).length) rmdirSync(d); } catch {} }   // 우리가 만든 폴더 — 빈 것만(깊은 것부터)
  for (const [p, o] of shared) note(`kept ${p} — it is the same file as ${label(o)} (shared by a link); \`boarder restore\` with no folder removes it from all`);
  return [...new Set(done)];
}
export async function restore(id, { only } = {}) {
  // 폴더 하나만: boarder restore <폴더|id> — 그 폴더의 Boarder 칸만 빼고 서비스 · 타이머는 그대로
  const one = only?.length ? only : id ? [id] : null;
  const done = dropReport({ only: one });
  if (!one) {
    for (const p of removeTimer()) done.push(p);
    for (const p of await removeService()) done.push(p);   // 엔진 데몬(B-1)
    for (const p of removeFollow()) done.push(p);   // 읽어 올리기 서비스(보기 · 누르기 전용)
  }
  for (const p of done) console.log(`removed Boarder from ${p}`);
  const b = path.join(dir(), 'backups');
  console.log(done.length ? `Boarder is removed from ${one ? one.join(', ') : 'your AI tools'}. Restart them.` : `Boarder was not in ${one ? one.join(', ') : 'your AI tools'}.`);
  if (existsSync(b)) console.log(`Full copies from before setup are kept in ${b} (restore only removes what Boarder added).`);
}

// ── 도구마다 쓰기
// 그 칸 머리부터 다음 칸 머리(줄 첫 [) 앞까지 — args 의 [ 에서 멈추지 않게, \r\n 도
const TOML_SEC = /^\[mcp_servers\.boarder\][ \t]*\r?\n(?:(?![ \t]*\[).*(?:\r?\n|$))*/m;
const TOML_SEC_END = /(?<=\n)\r?\n\[mcp_servers\.boarder\][ \t]*\r?\n(?:(?![ \t]*\[).*(?:\r?\n|$))*$/;
const mcpEntry = { command: NODE, args: [BIN, 'mcp'] };
const HOOKS = [['SessionStart', 'hook session-start', 10], ['UserPromptSubmit', 'hook prompt', 10], ['Stop', 'hook stop', 20], ['PostToolUse', 'hook artifact', 60, 'mcp__.*[Aa]rtifact.*']];
const ours = (x, sub) => JSON.stringify(x).includes(sub) && JSON.stringify(x).includes('boarder');
// Codex: 턴이 끝나면 부르는 notify(맨 위 칸, 하나뿐) — 사람이 이미 notify 를 쓰면 건드리지 않음. 우리가 넣은 줄 = boarder 의 hook codex-turn
const TOML_NOTIFY = /^notify[ \t]*=[ \t]*\[[^\n]*"hook",[ \t]*"codex-turn"\][ \t]*\r?\n/m;
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
function writeTool(bk, t, skill) {
  const done = [];
  if (t.tool === 'claude') {
    if (editJson(bk, t.files.mcp, j => { j.mcpServers = { ...(j.mcpServers || {}), boarder: { type: 'stdio', ...mcpEntry, env: {} } }; })) done.push('MCP');
    const sq = v => `'${v.replace(/'/g, `'\\''`)}'`;   // 경로에 " $ ` 가 있어도 셸이 안 풀게
    if (editJson(bk, t.files.settings, j => {
      j.hooks ||= {};
      for (const [ev, sub, timeout, matcher] of HOOKS) {
        const list = (j.hooks[ev] ||= []), mine = list.findIndex(x => ours(x, sub));
        const entry = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: `${sq(NODE)} ${sq(BIN)} ${sub}`, timeout }] };
        if (mine >= 0) list[mine] = entry; else list.push(entry);
      }
    })) done.push('hook');
  }
  if (t.tool === 'codex') {
    const p = t.files.toml, old = existsSync(p) ? readFileSync(p, 'utf8') : '';
    const nl = old.includes('\r\n') ? '\r\n' : '\n';
    const sec = `[mcp_servers.boarder]${nl}command = ${JSON.stringify(NODE)}${nl}args = [${JSON.stringify(BIN)}, "mcp"]${nl}`;
    const re = TOML_SEC;
    // 뒤에 다른 칸이 있을 때만 빈 줄 — 다시 돌려도 같은 글
    let text = re.test(old) ? old.replace(re, (m, at) => sec + (at + m.length < old.length ? nl : '')) : (old && !old.endsWith('\n') ? old + nl : old) + (old ? nl : '') + sec;
    // 턴 끝 알림(notify): 맨 위 칸이라 파일 맨 앞에. 사람이 쓰던 notify 가 있으면 그대로 둠(하나만 됨)
    const notify = `notify = ${JSON.stringify([NODE, BIN, 'hook', 'codex-turn'])}${nl}`;
    if (TOML_NOTIFY.test(text)) text = text.replace(TOML_NOTIFY, notify);
    else if (!/^notify[ \t]*=/m.test(text.split(/^[ \t]*\[/m)[0])) text = notify + text;
    if (writeText(bk, p, text)) {
      if ((old.match(re) || [''])[0] !== (text.match(re) || [''])[0]) done.push('MCP');
      if ((old.match(TOML_NOTIFY) || [''])[0] !== (text.match(TOML_NOTIFY) || [''])[0]) done.push('hook');
    }
  }
  if ((t.tool === 'cursor' || t.tool === 'gemini') && editJson(bk, t.files.mcp, j => { j.mcpServers = { ...(j.mcpServers || {}), boarder: mcpEntry }; })) done.push('MCP');
  for (const f of t.files.skills) if (writeText(bk, f, skill)) { if (!done.includes('skill')) done.push('skill'); }
  return done;
}
/** 그 자리(폴더)의 보고 상태: on · off · stale(옛 CLI 경로) */
export const reportState = t => state(t, BIN, NODE);
/** 도구 이름이면 그 도구 폴더 가운데 하나라도 켜졌는지(옛 호출 — features 등) */
export function configured(t) {
  const list = typeof t === 'string' ? targets().filter(x => x.tool === t) : [t];
  return list.some(x => reportState(x).state !== 'off');
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
// 확인 코드 입력(터미널일 때만): 맞으면 { approved: 토큰 답 }, 틀리면 남은 횟수와 함께 다시 물음. stop() 은 입력을 닫아 setup 을 붙잡지 않게
function confirmPrompt(srv, deviceCode, verifier, until) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return { got: new Promise(() => {}), stop: () => {} };
  let rl = null, stopped = false;
  const got = (async () => {
    rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
    rl.on('SIGINT', () => { rl.close(); process.exit(130); });
    console.log('Approving on another device (phone · other computer)? After 「허용」 it shows a code — type it here.');
    while (!stopped && Date.now() < until) {
      let line; try { line = await rl.question('Code from the approve page: '); } catch { break; }
      const cf = String(line || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!cf) continue;
      const p = await fetch(`${srv}/api/device/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_code: deviceCode, confirm: cf, code_verifier: verifier }), signal: AbortSignal.timeout(20000) }).catch(() => null);
      const j = p ? await p.json().catch(() => ({})) : {};
      if (j.state === 'approved') return { approved: j };
      if (j.state === 'denied') return { error: 'denied', state: null };
      console.log(j.error === 'confirm' ? (j.left ? `That code doesn't match — ${j.left} tries left.` : 'Too many wrong codes — open the link on this computer instead, or run `boarder setup --yes` again.') : `Not approved yet (${j.error || j.state || 'no answer'}) — press 「허용」 first, then type the code.`);
      if (j.error === 'confirm' && !j.left) break;
    }
    return new Promise(() => {});
  })();
  return { got, stop: () => { stopped = true; try { rl?.close(); } catch {} } };
}
async function login(srv, tools, { browser, deviceAuth, email }) {
  const { randomBytes, createHash } = await import('node:crypto');
  const state = b64u(randomBytes(24));
  // --email: 보드 카드 · 승인된 기기로 허용(온보딩 2층) — 코드 길(폴링)이라야 다른 곳에서 허용해도 이 기기가 토큰을 받음
  const local = browser && !deviceAuth && !email && !headless() ? await listen(state).catch(() => null) : null;
  const verifier = b64u(randomBytes(32)), challenge = b64u(createHash('sha256').update(verifier).digest());
  const body = { name: `${os.hostname().split('.')[0]} (${process.platform})`, tools, ...(email ? { email } : {}), ...(local ? { callback: `http://127.0.0.1:${local.port}/callback`, state, code_challenge: challenge } : {}) };
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
    const typed = confirmPrompt(srv, c.device_code, verifier, until);
    const got = await Promise.race([local.got, timer, typed.got]); clearTimeout(tm); local.close(); typed.stop();
    if (got.approved) return save(got.approved);
    if (got.error === 'denied') throw new Error('The sign-in was declined in the browser. Run `boarder setup --yes` again if that was a mistake.');
    if (got.error) throw new Error('The request expired before it was approved. Run `boarder setup --yes` again.');
    if (got.state !== state) throw new Error('The browser answered for a different request — run `boarder setup --yes` again.');
    let j;
    for (let wait = 1000; ; wait = Math.min(wait * 2, 8000)) {
      const p = await fetch(`${srv}/api/device/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_code: c.device_code, code: got.code, code_verifier: verifier }), signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (p && p.status < 500 && p.status !== 429) { j = await p.json().catch(() => ({})); break; }
      if (Date.now() + wait >= until) { j = { error: p ? `server answered ${p.status}` : 'could not reach the server' }; break; }
      await sleep(wait);
    }
    if (j.state === 'approved') return save(j);
    throw new Error(`Sign-in failed: ${j.error || j.state || 'unknown'}`);
  }
  local?.close();
  console.log(`\nOne-time code: ${c.user_code}`);
  if (email) {
    // 브라우저를 열지 않음 — 보드 카드(폰)나 승인된 기기에서 허용. 회원이 아니면 카드는 안 서지만 답은 같은 꼴(누가 회원인지 안 알려 줌)
    console.log(`Approve this machine — any one of these:`);
    console.log(`  • on your board (phone): the card 「새 기기 … 허용?」 for ${email} — type ${c.user_code} into 「기타」 (the card does not show the code)`);
    console.log(`  • on a machine that is already signed in: boarder device approve ${c.user_code} (opens the approve page there)`);
    console.log(`  • in a browser: ${c.verify_url.replace(/\?code=.*$/, '')}  (type the code there)`);
    console.log(`(No card? Check the email is the one you sign in to Boarder with. Waiting up to ${Math.round(c.expires_in / 60)} minutes…)\n`);
  } else {
    console.log(`Approve this machine in a browser: ${c.verify_url.replace(/\?code=.*$/, '')}  (type the code there)`);
    console.log(`(Check the code matches, then press 「허용」. Or on a machine that is already signed in: boarder device approve ${c.user_code}. Waiting up to ${Math.round(c.expires_in / 60)} minutes…)\n`);
    if (browser) openBrowser(c.verify_url.replace(/\?code=.*$/, ''));
  }
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

// 여럿이면 번호로 고르기(Enter = 전부). 터미널이 아니거나 --yes 면 묻지 않고 전부
async function choose(list, log) {
  if (list.length < 2 || !process.stdin.isTTY || !process.stdout.isTTY) return list;
  const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const a = (await rl.question(`Add Boarder to which? Enter = all ${list.length}, or numbers like 1,3: `)).trim();
      if (!a) return list;
      const n = a.split(/[\s,]+/).map(Number);
      if (n.every(x => Number.isInteger(x) && x >= 1 && x <= list.length)) return [...new Set(n)].map(x => list[x - 1]);
      log('  numbers from the list, separated by commas');
    }
  } finally { rl.close(); }
}

/** 켜기(report): 고른 설정 폴더마다 MCP · 시작 훅 · 스킬(먼저 백업). 옛 CLI 경로를 가리키던 boarder 칸은 지금 경로로 고쳐 씀 */
export async function writeReport({ srv = (loadDevice()?.server || DEFAULT_SERVER).replace(/\/+$/, ''), only, skip, yes = true, log = console.log } = {}) {
  let list = pick(targets(), only, skip);
  if (!list.length) throw new Error('No AI tool folders found. Install Claude Code, Codex, Cursor or Gemini CLI, then run this again.');
  log(`\nAI tool folders on this machine:\n${list.map((t, i) => `  ${i + 1}. ${label(t)}  ${t.where}  — ${({ on: 'reports to Boarder', off: 'not yet', stale: `old Boarder path (${reportState(t).was}) — will fix` })[reportState(t).state]}`).join('\n')}`);
  if (!yes) list = await choose(list, log);
  let skill;
  const dev = loadDevice(), auth = dev?.token && (dev.server || '').replace(/\/+$/, '') === srv ? { authorization: `Bearer ${dev.token}` } : {};
  try { const r = await fetch(`${srv}/api/install/skill`, { headers: auth, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw 0; skill = await r.text(); }
  catch { throw new Error(`Could not get the Boarder skill from ${srv}`); }
  const bk = backup(), lines = [];
  for (const t of list) { const was = reportState(t), d = writeTool(bk, t, skill); lines.push(`  ${label(t)}: ${!d.length ? 'already set up' : was.state === 'stale' ? `fixed old path (${d.join(', ')})` : d.join(', ') + ' added'}`); }
  log('\n' + lines.join('\n'));
  if (bk.count) log(`\nBacked up first — undo with: boarder disable report  (one folder: boarder restore <folder>)`); else bk.drop();
  return { tools: [...new Set(list.filter(t => reportState(t).state === 'on').map(t => t.tool))], targets: list.map(t => ({ id: t.id, state: reportState(t).state })) };
}

export const ENGINE_CHOICE = `\nPick how Boarder runs your AI windows here:
  1) Your own subscription through the SDKs (no terminal needed; Claude Agent SDK and Codex SDK, several accounts each):
       boarder enable engine           (Windows: this is the default when there is no tmux)
       boarder engine setup --sdk      (macOS / Linux: choose the SDK engine on purpose)
  2) The Codex or Claude Code you already use (tmux windows) - install Claude Code or Codex first, then:
       boarder enable engine`;

export async function setup(opts) {
  const srv = (opts.server || process.env.BOARDER_URL || loadDevice()?.server || DEFAULT_SERVER).replace(/\/+$/, '');
  console.log('Boarder setup');
  const pre = missingDirs(dir());
  const sel = pick(targets(), opts.only, opts.skip), tools = [...new Set(sel.map(t => t.tool))];
  // AI 도구가 하나도 없어도(윈도우 새 PC) 로그인까지는 감 — 끝에 엔진 고르기 안내(① 내 구독 SDK · ② 쓰던 Codex / Claude Code = tmux)
  console.log(tools.length ? `Tools: ${tools.map(t => TOOLS[t].label).join(', ')}` : 'Tools: none found on this machine (no Claude Code, Codex, Cursor or Gemini CLI) — signing in anyway');
  const who = (await signedIn(srv)) || await login(srv, tools, { browser: !opts.noBrowser, deviceAuth: !!opts.deviceAuth, email: opts.email || process.env.BOARDER_EMAIL || undefined }), email = who.email;
  noteMade(pre);
  console.log(`Signed in as ${email}${who.scope === 'watch' ? ' (watch only)' : ''}`);
  if (who.scope === 'watch') { await watcher(opts); return console.log('\nThis device only reports memory · CPU · disk · agents · Claude limits to Settings › Devices. Your AI tools were not changed.'); }
  if (sel.length > 1) console.log(`Folders: ${sel.map(t => t.where).join(', ')}`);
  if (opts.report && tools.length) await writeReport({ srv, only: opts.only, skip: opts.skip, yes: !!opts.yes });
  else if (tools.length) console.log(`\nView mode: Boarder reads your AI windows, sessions and to-dos and shows them as nodes on your board. Nothing in ${tools.map(t => TOOLS[t].label).join(', ')} (CLAUDE.md, AGENTS.md, hooks, settings, MCP, skills), your harness (Herdr, tmux) or your shell files was changed.`);
  if (!opts.noWatch) { const f = installFollow(); console.log(`\nReader: ${f.ok ? f.how : f.why}`); }
  if (opts.engine && !opts.noEngine && (tools.includes('claude') || !tools.length)) {
    console.log('\nEngine (lets Boarder open and manage Claude Code windows here):');
    try { await ensureEngine({ log: l => console.log('  ' + l) }); }
    catch (e) { console.log(`  engine not set up: ${e.message} — Boarder still works for reports; try \`boarder engine setup\` later`); }
  }
  if (!tools.length) console.log(ENGINE_CHOICE);
  console.log(`\nTurn more on only if you want it (each can be turned off again):\n  boarder enable report    your agents report to Boarder themselves (adds Boarder to your AI tools, backed up first)\n  boarder enable engine    Boarder opens, wakes, parks and closes AI windows here\n  boarder uninstall        remove Boarder from this machine`);
  console.log(`\nNext:\n  boarder status                          check this machine\n  boarder import --setup                  bring your current work in as nodes (${srv})\n\nDone.${opts.report ? ` Restart ${tools.map(t => TOOLS[t].label).join(', ')} (and open sessions) to load Boarder.` : ''}`);
}
