import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dir, ensureDir, readJson, server } from './config.mjs';
import { windowToken } from './window.mjs';

export const CLIS = {
  wrangler: { label: 'Cloudflare (wrangler)', dir: '.wrangler', login: ['wrangler', 'login'], whoami: ['wrangler', 'whoami'], install: 'npm install -g wrangler' },
  gh: { label: 'GitHub (gh)', dir: 'gh', login: ['gh', 'auth', 'login', '--web'], whoami: ['gh', 'auth', 'status'], install: 'https://cli.github.com' },
};
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const cfgPath = () => path.join(dir(), 'profiles.json');
const profDir = name => path.join(dir(), 'profiles', name);
const binDir = () => path.join(dir(), 'bin');
const load = () => readJson(cfgPath(), { profiles: {}, repos: [] });
function save(cfg) { ensureDir(dir()); writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2) + '\n'); }
const fail = msg => { console.error(msg); process.exit(1); };
const isInside = (parent, p) => { const r = path.relative(parent, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
const userConfig = () => process.env.XDG_CONFIG_HOME && !isInside(path.join(dir(), 'profiles'), process.env.XDG_CONFIG_HOME) ? process.env.XDG_CONFIG_HOME : path.join(os.homedir(), '.config');
const has = (cfg, name) => NAME.test(name || '') && Object.hasOwn(cfg.profiles, name);
const isLink = p => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

function overlay(name, owned) {
  const d = profDir(name); mkdirSync(d, { recursive: true, mode: 0o700 });
  const base = userConfig(), ownedDirs = new Set(owned.map(c => CLIS[c]?.dir).filter(Boolean));
  const wanted = new Set(existsSync(base) ? readdirSync(base).filter(e => !ownedDirs.has(e) && e !== 'boarder') : []);
  for (const e of readdirSync(d)) { const p = path.join(d, e); if (isLink(p) && (!wanted.has(e) || path.resolve(d, readlinkSync(p)) !== path.resolve(base, e))) rmSync(p); }
  for (const e of wanted) { const p = path.join(d, e); if (!existsSync(p) && !isLink(p)) symlinkSync(path.join(base, e), p, process.platform === 'win32' ? 'junction' : undefined); }
  return d;
}
const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };
const normRemote = u => u.trim().replace(/^[a-z+]+:\/\//, '').replace(/^[^@/]+@/, '').replace(/:(?!\d)/, '/').replace(/\/+$/, '').replace(/\.git$/, '').toLowerCase();
function repoOf(cwd) { const top = git(cwd, 'rev-parse', '--show-toplevel'), p = path.resolve(top || cwd), r = git(p, 'remote', 'get-url', 'origin'); return { path: p, remote: r ? normRemote(r) : undefined }; }
export function profileFor(cwd) {
  const cfg = load(), repo = repoOf(cwd);
  const hit = cfg.repos.find(r => r.path === repo.path) ?? (repo.remote ? cfg.repos.find(r => r.remote === repo.remote) : undefined);
  return hit && has(cfg, hit.profile) ? hit.profile : null;
}
export function profileEnv(cwd) {
  const name = profileFor(cwd); if (!name) return { profile: null, env: {} };
  const d = overlay(name, load().profiles[name].clis);
  return { profile: name, env: { XDG_CONFIG_HOME: d, GH_CONFIG_DIR: path.join(d, 'gh') } };   // gh 는 GH_CONFIG_DIR 를 먼저 봄
}
function which(cmd) { for (const d of (process.env.PATH || '').split(path.delimiter)) { if (path.resolve(d) === path.resolve(binDir())) continue; const p = path.join(d, cmd); if (existsSync(p)) return p; } return null; }

function whoami(name, cli) {
  const d = overlay(name, load().profiles[name]?.clis || []), a = CLIS[cli], bin = which(a.whoami[0]);
  if (!bin) return `${a.whoami[0]} not installed`;
  const r = spawnSync(bin, a.whoami.slice(1), { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: d, GH_CONFIG_DIR: path.join(d, 'gh') } });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`, email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(out)?.[0], gh = /account (\S+)/.exec(out)?.[1];
  return r.status !== 0 && !email && !gh ? 'not signed in' : email || gh || 'signed in';
}

function writeClaudeEnv(repoPath, env) {
  const file = path.join(repoPath, '.claude', 'settings.local.json');
  if (!env && !existsSync(file)) return file;
  const s = readJson(file, {}), next = { ...(s.env || {}) };
  for (const k of ['XDG_CONFIG_HOME', 'GH_CONFIG_DIR']) delete next[k];
  Object.assign(next, env || {});
  if (Object.keys(next).length) s.env = next; else delete s.env;
  mkdirSync(path.join(repoPath, '.claude'), { recursive: true });
  writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
  const ignored = spawnSync('git', ['check-ignore', '-q', file], { cwd: repoPath }).status === 0;
  const common = git(repoPath, 'rev-parse', '--git-common-dir');
  const info = common && path.join(path.resolve(repoPath, common), 'info');
  if (!ignored && info && existsSync(info)) appendFileSync(path.join(info, 'exclude'), '\n.claude/settings.local.json\n');   // 기기마다 다른 경로 — 커밋에 안 들어가게
  return file;
}

/** 표를 Boarder 에 올림(설정 › CLI 프로필 화면). 로그인 · 토큰은 안 올림 — 이름 · CLI · 리포 · 누구로 로그인했는지만. 실패해도 로컬은 그대로 */
async function sync() {
  try {
    const cfg = load(), w = await windowToken();
    const profiles = Object.entries(cfg.profiles).map(([name, p]) => ({ name, clis: p.clis.map(cli => ({ cli, account: whoami(name, cli).slice(0, 80) })) }));
    const repos = cfg.repos.map(r => ({ repo: r.remote || path.basename(r.path), profile: r.profile }));
    await fetch(`${server()}/api/profiles`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${w.token}` }, body: JSON.stringify({ host: os.hostname().slice(0, 60), profiles, repos }), signal: AbortSignal.timeout(15000) });
  } catch { /* 로그인 전이면 로컬만 */ }
}

async function login(name, cli) {
  const a = CLIS[cli] || fail(`unknown CLI "${cli}" (supported: ${Object.keys(CLIS).join(', ')})`);
  const bin = which(a.login[0]) || fail(`${a.login[0]} isn't installed. Install it: ${a.install}`);
  const cfg = load(), clis = [...new Set([...(cfg.profiles[name]?.clis || []), cli])];
  cfg.profiles[name] = { clis }; save(cfg);
  const d = overlay(name, clis);
  console.log(`${a.label} → sign in for profile ${name} (${a.login.join(' ')})`);
  const code = await new Promise(ok => spawn(bin, a.login.slice(1), { stdio: 'inherit', env: { ...process.env, XDG_CONFIG_HOME: d, GH_CONFIG_DIR: path.join(d, 'gh') } }).once('exit', ok).once('error', e => fail(e.message)));
  if (code !== 0) fail(`${a.login.join(' ')} failed`);
}

function use(name) {
  const cfg = load(), repo = repoOf(process.cwd());
  cfg.repos = cfg.repos.filter(r => r.path !== repo.path);
  if (name) { if (!has(cfg, name)) fail(`no profile "${name}" — create it: boarder profile add ${name} wrangler`); cfg.repos.push({ path: repo.path, remote: repo.remote, profile: name }); }
  save(cfg);
  const file = writeClaudeEnv(repo.path, name ? profileEnv(repo.path).env : null);
  if (name) console.log(`✓ ${repo.remote || repo.path} uses profile ${name} (${cfg.profiles[name].clis.join(', ')})\n  Claude Code: ${path.relative(repo.path, file)} (restart sessions)\n  Terminal:    boarder profile run -- wrangler …  or the shims (boarder profile shims)`);
  else console.log(`✓ ${repo.remote || repo.path} uses your default logins again.`);
}

function list() {
  const cfg = load(), names = Object.keys(cfg.profiles).sort();
  if (!names.length) return console.log('No profiles yet. `boarder profile add work wrangler` signs wrangler into a separate "work" profile.');
  const here = profileFor(process.cwd());
  for (const n of names) {
    console.log(`${n === here ? '●' : ' '} ${n}`);
    for (const cli of cfg.profiles[n].clis) console.log(`    ${cli.padEnd(10)} ${whoami(n, cli)}`);
    for (const r of cfg.repos.filter(r => r.profile === n)) console.log(`    ↳ ${r.remote || r.path}`);
  }
}

function shims() {
  if (process.platform === 'win32') fail('shims: use `boarder profile run -- <cmd>` on Windows');
  const d = binDir(); mkdirSync(d, { recursive: true });
  for (const cli of Object.keys(CLIS)) { const f = path.join(d, cli); writeFileSync(f, `#!/bin/sh\n# Boarder: run the real ${cli} with this repo's profile (boarder profile).\nexec boarder profile run --shim ${cli} -- "$@"\n`); chmodSync(f, 0o755); }
  console.log(`✓ shims for ${Object.keys(CLIS).join(', ')} in ${d}`);
  if (!(process.env.PATH || '').split(path.delimiter).some(x => path.resolve(x) === path.resolve(d))) console.log(`Add to ~/.zshrc (before other PATH changes):\n  export PATH="${d}:$PATH"`);
}

function run(argv) {
  let shim; if (argv[0] === '--shim') { shim = argv[1]; argv = argv.slice(2); }
  if (shim && process.env.BOARDER_SHIM_DEPTH) fail(`${shim}: the shim found itself — put the real ${shim} on PATH`);
  if (argv[0] === '--') argv = argv.slice(1);
  const [cmd, ...args] = shim ? [shim, ...argv] : argv;
  if (!cmd) fail('usage: boarder profile run -- <command> [args…]');
  const bin = shim ? which(cmd) || fail(`${cmd}: not found`) : cmd;   // 심은 자기 자신 말고 진짜를
  const PATH = (process.env.PATH || '').split(path.delimiter).filter(d => path.resolve(d) !== path.resolve(binDir())).join(path.delimiter);
  const child = spawn(bin, args, { stdio: 'inherit', env: { ...process.env, PATH, ...profileEnv(process.cwd()).env, ...(shim ? { BOARDER_SHIM_DEPTH: '1' } : {}) } });
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => child.kill(s));
  child.on('error', e => fail(`${cmd}: ${e.code === 'ENOENT' ? 'not found' : e.message}`));
  child.on('close', (code, sig) => process.exit(code ?? (sig ? 128 : 1)));
  return new Promise(() => {});
}

export const PROFILE_HELP = `CLI accounts per repo
  boarder profile add <name> <wrangler|gh>   sign that CLI into a separate profile
  boarder profile use <name>                 this repo (and its other clones) uses that profile
  boarder profile unuse                      back to your default logins here
  boarder profile ls                         profiles, who each CLI is signed in as, which repos
  boarder profile rm <name>                  remove a profile and its logins
  boarder profile env                        the environment for this repo (eval "$(boarder profile env)")
  boarder profile run -- <cmd> [args…]       run a command with this repo's profile
  boarder profile shims                      wrangler · gh shims that pick the profile by themselves`;

export async function profileCommand(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined: case 'ls': case 'list': return list();
    case 'add': case 'login': {
      const [name, cli] = rest;
      if (!name || !NAME.test(name)) fail('profile name: lowercase letters, digits, - or _ (up to 32)');
      if (!cli) fail('which CLI? boarder profile add <name> <wrangler|gh>');
      await login(name, cli); console.log(`✓ profile ${name} ready. Bind a repo: boarder profile use ${name}`); return sync();
    }
    case 'use': use(rest[0] || fail('which profile? boarder profile use <name>')); return sync();
    case 'unuse': use(null); return sync();
    case 'rm': case 'remove': {
      const name = rest[0], cfg = load(); if (!has(cfg, name)) fail(`no profile "${name}"`);
      if (!isInside(path.join(dir(), 'profiles'), profDir(name))) fail('refusing to remove outside the profiles folder');
      delete cfg.profiles[name]; cfg.repos = cfg.repos.filter(r => r.profile !== name); save(cfg);
      rmSync(profDir(name), { recursive: true, force: true }); console.log(`✓ removed ${name} and its logins`); return sync();
    }
    case 'env': { const { env } = profileEnv(process.cwd()); for (const [k, v] of Object.entries(env)) console.log(`export ${k}=${JSON.stringify(v)}`); return; }
    case 'run': return run(rest);
    case 'shims': return shims();
    case 'sync': return sync();
    default: console.log(PROFILE_HELP); process.exitCode = 1;
  }
}
