// boarder engine account login|list — BYOS 사람이 claude/codex 를 직접 안 치고 브라우저 로그인만으로 계정을 붙임.
// 로그인 값(토큰 · 자격 파일)은 읽거나 출력하거나 서버로 보내지 않는다: 존재 여부와 상태 명령의 종료 코드만 본다.
import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { dir } from '../config.mjs';
import { sdkDir } from './sdk.mjs';

const ENV = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' };
const CRED = { claude: '.credentials.json', codex: 'auth.json' };   // 존재만 봄
const NAME = /^\w[\w.-]{0,39}$/;
const win = () => process.platform === 'win32';

/** 계정 폴더: 등록된 폴더 → 기본 sdk-accounts/<공급자>/<이름> */
export function accountFolder(cfg, prov, name) {
  const set = cfg?.sdk?.accounts?.[prov]?.[name];
  return path.resolve(set || path.join(dir(), 'sdk-accounts', prov, name));
}

const TRIPLE = { 'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc', 'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin', 'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl' };
/** 후보 경로(순서대로): 플랫폼 네이티브 실행 파일 → (Codex) bin/codex.js(node 로) */
export function cliCandidates(prov, { sdk = sdkDir(), platform = process.platform, arch = process.arch } = {}) {
  const nm = path.join(sdk, 'node_modules'), pa = `${platform}-${arch}`, exe = platform === 'win32' ? '.exe' : '';
  if (prov === 'claude') {
    const pk = ['', ...(platform === 'linux' ? ['-musl'] : [])].map(m => path.join(nm, '@anthropic-ai', `claude-agent-sdk-${pa}${m}`, `claude${exe}`));
    return pk.map(f => ({ file: f, native: true }));
  }
  const t = TRIPLE[pa];
  return [
    ...(t ? [{ file: path.join(nm, '@openai', `codex-${pa}`, 'vendor', t, 'bin', `codex${exe}`), native: true }, { file: path.join(nm, '@openai', 'codex', 'node_modules', '@openai', `codex-${pa}`, 'vendor', t, 'bin', `codex${exe}`), native: true }] : []),
    { file: path.join(nm, '@openai', 'codex', 'bin', 'codex.js'), native: false },
  ];
}
/** 실행할 공급자 CLI: SDK 가 딸려 온 네이티브 실행 파일 → codex.js(node) → PATH. { cmd, pre, shell } */
export function findCli(prov, { sdk = sdkDir(), exists = existsSync, which = whichBin, platform = process.platform, arch = process.arch } = {}) {
  for (const c of cliCandidates(prov, { sdk, platform, arch })) if (exists(c.file)) return c.native ? { cmd: c.file, pre: [], shell: false, from: 'sdk' } : { cmd: process.execPath, pre: [c.file], shell: false, from: 'sdk' };
  const w = which(prov);
  if (!w) return null;
  return { cmd: w, pre: [], shell: /\.(cmd|bat)$/i.test(w), from: 'path' };
}
function whichBin(n) {
  try { return execFileSync(win() ? 'where' : 'which', [n], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0] || null; } catch { return null; }
}
const q = s => /[\s"&()^]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

/** 로그인 명령 조립(시험 대상). 윈도우 .cmd 는 셸로 가므로 경로 · 인자를 따옴표 */
export function loginSpec(prov, cli, folder, { deviceAuth = false, baseEnv = process.env } = {}) {
  const args = [...cli.pre, ...(prov === 'claude' ? ['auth', 'login'] : ['login', ...(deviceAuth ? ['--device-auth'] : [])])];
  const env = { ...baseEnv, [ENV[prov]]: folder };
  return cli.shell ? { cmd: q(cli.cmd), args: args.map(q), env, shell: true } : { cmd: cli.cmd, args, env, shell: false };
}
export function statusSpec(prov, cli, folder, baseEnv = process.env, { bare = false } = {}) {
  const args = [...cli.pre, ...(prov === 'claude' ? ['auth', 'status'] : ['login', 'status'])];
  const env = { ...baseEnv, [ENV[prov]]: folder };
  if (bare) delete env[ENV[prov]];   // 기본 로그인(맥 키체인 · 이 PC 기본 폴더)은 실제 실행처럼 폴더 환경변수 없이 봄 — 있으면 키체인 항목 이름이 달라져 로그인을 못 찾을 수 있음
  return cli.shell ? { cmd: q(cli.cmd), args: args.map(q), env, shell: true } : { cmd: cli.cmd, args, env, shell: false };
}

/** 로그인 여부: 자격 파일 존재 → 아니면 상태 명령 종료 코드(출력은 버림). 값은 읽지 않음 */
const statusCache = new Map();   // "공급자/폴더" → { at, ok } — 상태 명령 결과만(자격 파일 있음은 캐시 안 함 → 로그인 직후 바로 잡힘)
export const STATUS_TTL_MS = 10_000;
export const _clearStatusCache = () => statusCache.clear();
export async function isLoggedIn(prov, folder, { exists = existsSync, run = runQuiet, cli = null, baseEnv = process.env, now = Date.now, ttl = STATUS_TTL_MS, bare = false } = {}) {
  if (exists(path.join(folder, CRED[prov]))) return true;
  if (!cli) return false;
  const key = `${prov}/${folder}${bare ? '/bare' : ''}`, hit = statusCache.get(key);
  if (hit && now() - hit.at < ttl) return hit.ok;
  const ok = (await run(statusSpec(prov, cli, folder, baseEnv, { bare }))) === 0;
  statusCache.set(key, { at: now(), ok });
  return ok;
}
function runQuiet(s) { return new Promise(res => { let c; try { c = spawn(s.cmd, s.args, { env: s.env, shell: s.shell, stdio: 'ignore', windowsHide: true }); } catch { return res(127); } const t = setTimeout(() => { try { c.kill(); } catch {} }, 15000); t.unref?.(); c.on('error', () => { clearTimeout(t); res(127); }); c.on('exit', code => { clearTimeout(t); res(code ?? 1); }); }); }
function runInherit(s) { return new Promise(res => { const c = spawn(s.cmd, s.args, { env: s.env, shell: s.shell, stdio: 'inherit' }); c.on('error', () => res(127)); c.on('exit', code => res(code ?? 1)); }); }

/** boarder engine account login <공급자> <이름> — 브라우저 로그인 → 확인 → 한 줄. 서버로는 아무것도 안 보냄 */
export async function accountLogin(cfg, prov, name, { deviceAuth = false, find = findCli, run = runInherit, quiet = runQuiet, mkdir = mkdirSync, exists = existsSync, log = console.log, baseEnv = process.env } = {}) {
  if (!['claude', 'codex'].includes(prov) || !NAME.test(name || '')) return { code: 64, msg: 'boarder engine account login <claude|codex> <name> [--device-auth]' };
  const folder = accountFolder(cfg, prov, name);
  mkdir(folder, { recursive: true, mode: 0o700 });
  const cli = find(prov);
  if (!cli) return { code: 1, msg: `${prov} CLI not found — run \`boarder engine setup\` (installs the SDKs), then try again` };
  log(`${prov} account ${name}: opening the browser login (folder ${folder})`);
  const code = await run(loginSpec(prov, cli, folder, { deviceAuth, baseEnv }));
  if (code !== 0) return { code: code || 1, msg: `${prov} login did not finish (exit ${code}) — run the same command again${prov === 'codex' && !deviceAuth ? ', or add --device-auth if no browser opens' : ''}` };
  if (!(await isLoggedIn(prov, folder, { exists, run: quiet, cli, baseEnv, ttl: 0 }))) return { code: 1, msg: `${prov} account ${name}: no login found in ${folder} — run the same command again` };
  return { code: 0, msg: `${prov} 계정 ${name} 로그인됨`, folder };
}

/** engine account list — 공급자별 계정 · 로그인 여부(이름과 예/아니오만) */
export function accountNames(cfg, prov) {
  const names = new Set(Object.keys(cfg?.sdk?.accounts?.[prov] || {}));
  try { for (const n of require_readdir(path.join(dir(), 'sdk-accounts', prov))) names.add(n); } catch {}
  return [...names].sort();
}
export async function accountList(cfg, { find = findCli, exists = existsSync, run = runQuiet, baseEnv = process.env } = {}) {
  const lines = [];
  for (const prov of ['claude', 'codex']) {
    const names = new Set(accountNames(cfg, prov));
    if (!names.size) { lines.push(`${prov}: (no accounts — boarder engine account ${prov} <name>)`); continue; }
    const cli = find(prov);
    for (const n of [...names].sort()) lines.push(`${prov} ${n}: ${await isLoggedIn(prov, accountFolder(cfg, prov, n), { exists, run, cli, baseEnv }) ? 'logged in' : 'not logged in — boarder engine account login ' + prov + ' ' + n}`);
  }
  return lines;
}
function require_readdir(root) { return readdirSync(root).filter(n => NAME.test(n) && statSync(path.join(root, n)).isDirectory()); }
