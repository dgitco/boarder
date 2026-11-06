import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dir, readJson } from '../config.mjs';
import { markTurn, parseHead, clip } from '../turn.mjs';
import { EngineError } from './tmux.mjs';
import { accountFolder, accountNames, findCli, isLoggedIn } from './login.mjs';

export const PROVIDERS = ['claude', 'codex'];
const PKG = { claude: '@anthropic-ai/claude-agent-sdk', codex: '@openai/codex-sdk' };
// 공급망: 버전 고정(윈도우 · 서버 시험에서 설치돼 동작한 판). 올릴 때는 시험을 다시 돌린 뒤 packages/cli/package.json 과 같이 바꿈
export const PINNED = { claude: '0.3.317', codex: '0.166.0' };
const SPEC = p => `${PKG[p]}@${PINNED[p]}`;
const NO_CONVO = /No conversation found with session ID/i;
const LIMIT = /(usage limit|limit reached|rate.?limit|quota|resets? (at|in) \d)/i;
const expand = p => (p || '').replace(/^~(?=$|[\\/])/, os.homedir());
export function agentEnv(base = process.env, { home = os.homedir(), exists = existsSync, sep = path.delimiter } = {}) {
  const bin = path.join(home, '.local', 'bin');
  const key = Object.keys(base).find(k => k.toLowerCase() === 'path') || 'PATH';
  const cur = String(base[key] || '');
  if (!exists(bin) || cur.split(sep).some(p => p.replace(/[\\/]+$/, '').toLowerCase() === bin.replace(/[\\/]+$/, '').toLowerCase())) return {};
  return { [key]: cur ? `${cur}${sep}${bin}` : bin };
}

// ── SDK 불러오기(없으면 어떻게 깔지 알려 줌)
export const _inject = { claude: null, codex: null, loggedIn: null };   // loggedIn: 시험이 (공급자, 폴더) → 참/거짓 으로 로그인 여부를 대신함
export async function loadSdk(provider) {
  if (_inject[provider]) return _inject[provider];
  if (!PKG[provider]) throw new EngineError(1, `unknown provider ${provider} (claude or codex)`);
  try { return await import(PKG[provider]); }
  catch (e) {
    const local = localEntry(PKG[provider]);
    if (local) { try { return await import(pathToFileURL(local).href); } catch (e2) { throw new EngineError(1, `${PKG[provider]}: ${e2.message}`); } }
    if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND') throw new EngineError(1, `${PKG[provider]} is not installed — run \`boarder engine setup\` (it installs the SDKs for you), or by hand: ${MANUAL}`);
    throw new EngineError(1, `${PKG[provider]}: ${e.message}`);
  }
}
export const sdkDir = () => path.join(dir(), 'sdk');
export function localEntry(pkg) {
  try {
    const root = path.join(sdkDir(), 'node_modules', ...pkg.split('/')), j = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const pick = x => typeof x === 'string' ? x : x && typeof x === 'object' ? pick(x.import ?? x.node ?? x.default) : null;
    const rel = pick(j.exports?.['.'] ?? j.exports) || j.module || j.main || 'index.js';
    const f = path.join(root, rel); return existsSync(f) ? f : null;
  } catch { return null; }
}
/** npm 위치: 지금 도는 node 옆(설치 스크립트가 받은 Node) → PATH → 흔한 자리 */
export function findNpm() {
  const win = process.platform === 'win32', nm = win ? 'npm.cmd' : 'npm', nd = path.dirname(process.execPath);
  for (const c of [path.join(nd, nm), path.join(nd, 'node_modules', 'npm', 'bin', 'npm-cli.js')]) if (existsSync(c)) return c;
  try { const r = execFileSync(win ? 'where' : 'which', ['npm'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0]; if (r) return r; } catch {}
  for (const c of win ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'npm.cmd')] : ['/usr/local/bin/npm', '/opt/homebrew/bin/npm']) if (existsSync(c)) return c;
  return null;
}
export const MANUAL = `npm install --prefix "${path.join('~', '.config', 'boarder', 'sdk')}" ${PROVIDERS.map(SPEC).join(' ')}`;
/** 없는 SDK 만 깔기. 끝나면 { ok, missing } — 실패는 한 줄 원인 + 손으로 하는 명령(why) */
export async function installSdks({ exec = execAsync, npm = findNpm(), log = () => {} } = {}) {
  const need = PROVIDERS.filter(p => !_inject[p] && !localEntry(PKG[p]) && !hasGlobal(PKG[p]));
  if (!need.length) return { ok: true, missing: [] };
  if (!npm) return { ok: false, missing: need, why: `npm not found next to this Node or on PATH - install Node.js, or run: ${MANUAL}` };
  const d = sdkDir(); mkdirSync(d, { recursive: true });
  const pj = path.join(d, 'package.json'); if (!existsSync(pj)) writeFileSync(pj, '{"name":"boarder-sdk","private":true}\n');
  log(`installing ${need.map(p => PKG[p]).join(' and ')} into ${d} (one time)`);
  try {
    const args = ['install', '--prefix', d, '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error', ...need.map(SPEC)];
    if (npm.endsWith('.js')) await exec(process.execPath, [npm, ...args], { stdio: 'pipe', timeout: 600000 });
    else if (process.platform === 'win32') await exec([`"${npm}"`, ...args.map(a => `"${a}"`)].join(' '), { stdio: 'pipe', timeout: 600000, shell: true });   // .cmd 는 셸로
    else await exec(npm, args, { stdio: 'pipe', timeout: 600000 });
  } catch (e) { return { ok: false, missing: need, why: `could not install the SDKs (${String(e.stderr || e.message).trim().split('\n')[0].slice(0, 160)}) - run by hand: ${MANUAL}` }; }
  const missing = need.filter(p => !localEntry(PKG[p]));
  return missing.length ? { ok: false, missing, why: `npm finished but ${missing.map(p => PKG[p]).join(', ')} is not there - run by hand: ${MANUAL}` } : { ok: true, missing: [] };
}
/** 비동기 실행(데몬 이벤트 루프를 막지 않음). 실패하면 stderr 를 단 오류로 reject */
function execAsync(cmd, args, opts = {}) {
  if (!Array.isArray(args)) { opts = args || {}; args = []; }   // 윈도우 .cmd: 한 줄 명령 + shell
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeout, shell: opts.shell, windowsHide: true, maxBuffer: 8 << 20 }, (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr: String(stderr || '') })) : resolve(String(stdout)));
  });
}
function hasGlobal(pkg) { try { import.meta.resolve(pkg); return true; } catch { return false; } }

/** 어느 SDK 가 깔려 있나 — setup 안내용 */
export async function available() {
  const out = {};
  for (const p of PROVIDERS) { try { await loadSdk(p); out[p] = true; } catch { out[p] = false; } }
  return out;
}

const defaultFolder = prov => prov === 'claude' ? (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')) : (process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
export async function pickAccount(cfg, provider, w) {
  if (w.config_dir || w.account) return;
  const cli = _inject.loggedIn ? null : findCli(provider);
  const isIn = (folder, bare = false) => _inject.loggedIn ? Promise.resolve(!!_inject.loggedIn(provider, folder)) : isLoggedIn(provider, folder, { cli, bare });
  if (await isIn(defaultFolder(provider), !process.env[provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'])) return;   // 환경변수로 폴더를 정한 사람은 그 폴더 그대로, 아니면 「기본」 그대로(맥 키체인)
  for (const n of accountNames(cfg, provider)) if (await isIn(accountFolder(cfg, provider, n))) { w.account = n; return; }
  throw new EngineError(1, `이 기기의 ${provider === 'claude' ? 'Claude' : 'ChatGPT(Codex)'} 계정이 아직 로그인되지 않았어요 — 설정 › 기기 › 엔진에서 「로그인」을 눌러 주세요`);
}

export function accountDir(cfg, provider, s) {
  if (s.config_dir) return expand(String(s.config_dir));
  if (!s.account) return null;
  if (!/^\w[\w.-]{0,39}$/.test(s.account)) throw new EngineError(1, 'bad account name (letters, digits, . _ -; must start with a letter, digit or _)');
  const set = cfg?.sdk?.accounts?.[provider]?.[s.account];
  const d = set ? expand(set) : path.join(dir(), 'sdk-accounts', provider, s.account);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

const wins = new Map();
let loaded = false;
const regPath = () => path.join(dir(), 'sdk-windows.json');
function ensureLoaded() {
  if (loaded) return; loaded = true;
  const j = readJson(regPath(), {}) || {};
  for (const [id, spec] of Object.entries(j)) if (!wins.has(id)) wins.set(id, mk(spec));
}
function persist() {
  try {
    mkdirSync(dir(), { recursive: true, mode: 0o700 });
    const o = {}; for (const [id, w] of wins) o[id] = w.spec();
    const tmp = regPath() + '.tmp'; writeFileSync(tmp, JSON.stringify(o, null, 2) + '\n', { mode: 0o600 }); renameSync(tmp, regPath());
  } catch {}
}
export function _reset() { wins.clear(); loaded = false; }   // 시험용

function mk(s) {
  const w = {
    id: s.id, name: s.name || s.id, cwd: s.cwd, provider: s.provider || 'claude', account: s.account || null, config_dir: s.config_dir || null,
    model: s.model || null, perm: s.perm || null, system: s.system || null, session_id: s.session_id || null,
    test: !!s.argv, busy: false, since: Date.now(), limit: null, error: null, abort: null, thread: null, turn: null, echo: [],
    spec() { return { id: this.id, name: this.name, cwd: this.cwd, provider: this.provider, account: this.account, config_dir: this.config_dir, model: this.model, perm: this.perm, system: this.system, session_id: this.session_id, ...(this.test ? { argv: ['echo'] } : {}) }; },
  };
  return w;
}
const find = id => { ensureLoaded(); return wins.get(id) || null; };

// ── 한 턴: 공급자 SDK 로 글 하나를 보내 끝까지 읽음. 끝나면 idle
async function claudeTurn(cfg, w, text, onSession) {
  const { query } = await loadSdk('claude');
  const ac = new AbortController(); w.abort = ac;
  const cdir = accountDir(cfg, 'claude', w);
  const options = {
    cwd: w.cwd, abortController: ac,
    env: { ...process.env, ...agentEnv(), BOARDER_WINDOW: w.id, BOARDER_WINDOW_NAME: w.name, ...(cdir ? { CLAUDE_CONFIG_DIR: cdir } : {}) },
    ...(w.model ? { model: w.model } : {}),
    ...(w.session_id ? { resume: w.session_id } : {}),
    ...(w.system ? { systemPrompt: { type: 'preset', preset: 'claude_code', append: w.system } } : {}),
    // 허용은 사람이 「묻지 않고 일하기」를 한 번 허용한 창만(perm bypass). 아니면 SDK 기본 — 허락 없는 도구는 막힘
    ...(w.perm === 'bypass' ? { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true } : w.perm === 'auto' ? { permissionMode: 'auto' } : {}),
  };
  for await (const m of query({ prompt: text, options })) {
    if (m?.session_id && m.session_id !== w.session_id) { w.session_id = m.session_id; onSession?.(); persist(); }
    if (m?.type === 'result' && m.is_error) w.error = String(m.result || m.subtype || 'error');
  }
}
async function codexTurn(cfg, w, text, onSession) {
  const { Codex } = await loadSdk('codex');
  const cdir = accountDir(cfg, 'codex', w);
  if (!w.thread) {
    const codex = new Codex({ env: { ...process.env, ...agentEnv(), BOARDER_WINDOW: w.id, BOARDER_WINDOW_NAME: w.name, ...(cdir ? { CODEX_HOME: cdir } : {}) } });
    const opt = { workingDirectory: w.cwd, skipGitRepoCheck: true, ...(w.model ? { model: w.model } : {}), ...(w.perm === 'bypass' ? { sandboxMode: 'danger-full-access', approvalPolicy: 'never' } : { sandboxMode: 'workspace-write', approvalPolicy: 'never' }) };
    w.thread = w.session_id ? codex.resumeThread(w.session_id, opt) : codex.startThread(opt);
  }
  const ac = new AbortController(); w.abort = ac;
  // SDK 에는 Claude 의 systemPrompt 와 CLI notify 설치가 없음. 역할 지시를 매 턴 전하고,
  // 도구가 망을 못 쓰는 샌드박스에서도 최종 답은 데몬이 기존 답 훅으로 돌려줌.
  const board = parseHead(text);
  if (board) markTurn([w.id, w.session_id], text);
  const prompt = w.system ? `${w.system}\n\n${text}` : text;
  const { events } = await w.thread.runStreamed(prompt, { signal: ac.signal });
  let reply = '', completed = false;
  for await (const ev of events) {
    if (ev?.type === 'thread.started' && ev.thread_id && ev.thread_id !== w.session_id) { w.session_id = ev.thread_id; onSession?.(); persist(); }
    if (ev?.type === 'turn.failed') w.error = String(ev.error?.message || 'turn failed');
    if (ev?.type === 'error') w.error = String(ev.message || 'error');
    if (ev?.type === 'item.completed' && ev.item?.type === 'agent_message') reply = ev.item.text || '';
    if (ev?.type === 'turn.completed') completed = true;
  }
  if (!w.session_id && w.thread.id) { w.session_id = w.thread.id; onSession?.(); persist(); }
  if (board && completed && !w.error && !ac.signal.aborted && reply.trim()) {
    const event = JSON.stringify({ type: 'agent-turn-complete', 'thread-id': w.session_id, 'input-messages': [text], 'last-assistant-message': clip(reply) });
    const bin = fileURLToPath(new URL('../../bin/boarder.mjs', import.meta.url));
    await new Promise((resolve, reject) => {
      const child = execFile(process.execPath, [bin, 'hook', 'sdk-turn'], {
      env: { ...process.env, BOARDER_WINDOW: w.id, BOARDER_WINDOW_NAME: w.name }, windowsHide: true, timeout: 20000,
      }, err => err ? reject(new Error('보더에 답을 게시하지 못했어요 — 연결 상태를 확인해 주세요')) : resolve());
      child.stdin.on('error', () => {});
      child.stdin.end(event);   // 긴 글 · 첨부는 Windows 명령행 길이 한도를 넘으므로 stdin 으로
    });
  }
}

/** 글 하나를 넣고 턴을 백그라운드로 돌림. session_id 가 알려지거나(첫 줄) 턴이 끝나면 돌려줌 */
function startTurn(cfg, w, text) {
  if (w.test) { w.echo.push(String(text)); return Promise.resolve(); }   // 자가 시험: 모델 없이 되받기만
  w.busy = true; w.since = Date.now(); w.error = null; w.limit = null;
  let early; const first = new Promise(r => { early = r; });
  const run = w.provider === 'codex' ? codexTurn : claudeTurn;
  const attempt = async () => {
    await run(cfg, w, text, () => early()).catch(e => { if (!NO_CONVO.test(String(e?.message || e))) throw e; w.error = String(e.message); });
    if (w.error && NO_CONVO.test(w.error) && w.session_id) { w.session_id = null; w.error = null; persist(); await run(cfg, w, text, () => early()); }
  };
  w.turn = (w.provider === 'claude' || w.provider === 'codex' ? pickAccount(cfg, w.provider, w) : Promise.resolve()).then(attempt)
    .catch(e => { if (e?.name !== 'AbortError' && !w.abort?.signal?.aborted) w.error = String(e?.message || e); })
    .finally(() => { w.busy = false; w.since = Date.now(); w.abort = null; if (w.error && LIMIT.test(w.error)) w.limit = w.error.slice(0, 200); early(); });
  return Promise.race([first, w.turn, new Promise(r => setTimeout(r, 20000))]);
}

// ── 여섯 동사
/** open: { id, name, cwd, prompt, model, perm, system, session_id?, resume?, provider?, account?, config_dir?, argv? } → { id, session_id, provider, account } */
export async function open(cfg, s) {
  ensureLoaded();
  if (!/^[\w-]{3,64}$/.test(s.id || '')) throw new EngineError(1, 'bad window id');
  if (wins.has(s.id)) throw new EngineError(1, 'window already open');
  const provider = s.provider || cfg?.sdk?.provider || 'claude';
  if (!PROVIDERS.includes(provider)) throw new EngineError(1, `unknown provider ${provider} (claude or codex)`);
  const cwd = expand(s.cwd) || os.homedir();
  mkdirSync(cwd, { recursive: true });
  const w = mk({ ...s, provider, cwd });
  if (!w.test) { await loadSdk(provider); await pickAccount(cfg, provider, w); accountDir(cfg, provider, w); }   // SDK 없음 · 로그인 없음 · 계정 이름 오류는 창을 만들기 전에
  wins.set(w.id, w); persist();
  try { if (s.prompt) await startTurn(cfg, w, s.prompt); }
  catch (e) { wins.delete(w.id); persist(); throw e; }
  return { id: w.id, session_id: w.session_id, provider, account: w.account };
}
export async function send(cfg, id, text) {
  const w = find(id); if (!w) throw new EngineError(4, 'no such window');
  if (w.busy) throw new EngineError(2, 'that window is in the middle of a turn');
  await startTurn(cfg, w, text);
  return { ok: true };
}
export function state(cfg, id) {
  const w = find(id); if (!w) return { id, state: 'none' };
  return { id, state: w.busy ? 'busy' : 'idle', since: w.since, session_id: w.session_id, provider: w.provider, ...(w.account ? { account: w.account } : {}), ...(w.limit ? { limit: w.limit } : {}), ...(w.error && !w.limit ? { error: w.error.slice(0, 200) } : {}) };
}
function stop(w) { try { w.abort?.abort(); } catch {} }
export async function park(cfg, id) {
  const w = find(id); if (!w) throw new EngineError(4, 'no such window');
  stop(w); try { await w.turn; } catch {}
  const handle = { engine: 'sdk', ...w.spec() };
  wins.delete(id); persist();
  return { handle };
}
export async function reopen(cfg, handle, text, id) {
  if (!handle || (!handle.session_id && !handle.argv)) throw new EngineError(1, 'handle has no session');
  return open(cfg, { ...handle, id: id || handle.id, prompt: text || undefined });
}
export async function close(cfg, id) {
  const w = find(id); if (!w) return { ok: true, gone: true };
  stop(w); try { await w.turn; } catch {}
  wins.delete(id); persist();
  return { ok: true };
}
/** list: 데몬이 다시 뜬 뒤와 15초마다. spec 의 config_dir 는 이 기기 폴더 경로(데몬이 세션 기록을 올릴 때 씀) */
export function list(cfg) {
  ensureLoaded();
  return [...wins.values()].map(w => {
    let cdir = null; try { cdir = w.provider === 'claude' ? accountDir(cfg, 'claude', w) : null; } catch {}
    return { id: w.id, name: w.name, cwd: w.cwd, session_id: w.session_id, state: w.busy ? 'busy' : 'idle', spec: { ...w.spec(), ...(cdir ? { config_dir: cdir } : {}) }, meta: { provider: w.provider, ...(w.account ? { account: w.account } : {}) } };
  });
}
export const VERBS = ['open', 'send', 'state', 'park', 'reopen', 'close'];
export const echoOf = id => find(id)?.echo || [];   // 시험용
