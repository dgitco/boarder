import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dir, ensureDir, loadDevice, readJson } from '../config.mjs';
import * as tmux from './tmux.mjs';
import * as herdr from './herdr.mjs';
import { EngineError } from './tmux.mjs';

export { EngineError };
export const VERBS = tmux.VERBS;
const cfgPath = () => path.join(dir(), 'engine.json');
export const loadCfg = () => readJson(cfgPath(), {}) || {};
export function saveCfg(c) { ensureDir(dir()); const tmp = cfgPath() + '.tmp'; writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 }); renameSync(tmp, cfgPath()); }
export const which = cmd => { try { return execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0] || null; } catch { return null; } };

// ── 커스텀 엔진(규격: docs/engine-adapter.md) — 스크립트: `<파일> <동사>` stdin JSON → stdout JSON, 끝 코드 0 됨 · 1 실패 · 2 바쁨.
//    HTTP: POST <주소>/<동사> JSON, 머리 x-boarder-signature = t=<초>,v1=hex(HMAC-SHA256(기기 토큰의 sha256, "<초>.<몸>")) — 받는 쪽은 `boarder engine verify` 로 확인
function runExec(file, verb, input, ms = 60000) {
  return new Promise((resolve, reject) => {
    const ch = spawn(file, [verb], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => ch.kill('SIGKILL'), ms);
    ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { err += d; });
    ch.on('error', e => { clearTimeout(t); reject(new EngineError(1, `${file}: ${e.message}`)); });
    ch.on('close', code => {
      clearTimeout(t);
      if (code === 0) { try { return resolve(out.trim() ? JSON.parse(out) : {}); } catch { return reject(new EngineError(1, `${verb}: output is not JSON`)); } }
      reject(new EngineError(code === 2 ? 2 : code === 4 ? 4 : 1, (err || out).trim().split('\n')[0] || `${verb} failed (${code})`));
    });
    ch.stdin.on('error', () => {});   // 스크립트가 입력을 안 읽고 먼저 끝나면 EPIPE — 끝 코드 · 출력으로 판정하고 boarder 는 죽지 않음
    ch.stdin.end(JSON.stringify(input));
  });
}
export const signKey = () => createHash('sha256').update(String(loadDevice()?.token || '')).digest('hex');
export const sign = (body, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', signKey()).update(`${t}.${body}`).digest('hex')}`;
export function verify(sig, body, maxAge = 60) {
  if (!loadDevice()?.token) return false;
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig || ''); if (!m) return false;
  if (Math.abs(Date.now() / 1000 - +m[1]) > maxAge) return false;
  const want = Buffer.from(sign(body, +m[1])), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
async function runUrl(url, verb, input, ms = 60000) {
  const body = JSON.stringify(input);
  let r; try { r = await fetch(`${url.replace(/\/+$/, '')}/${verb}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-boarder-signature': sign(body) }, body, signal: AbortSignal.timeout(ms) }); }
  catch (e) { throw new EngineError(1, `${url}: ${e.message}`); }
  const j = await r.json().catch(() => ({}));
  if (r.ok) return j;
  throw new EngineError(r.status === 409 || r.status === 429 ? 2 : r.status === 404 ? 4 : 1, j.error || `${verb}: HTTP ${r.status}`);
}
function custom(def) {
  // timeout_ms(engine.json, 5초–10분): 넣기가 오래 걸리는 엔진은 늘림 — 서버(160초)보다 짧게, 엔진 안 시간 한도보다 길게(먼저 포기한 뒤 엔진이 넣으면 두 번 들어감)
  const ms = Math.min(600000, Math.max(5000, +def.timeout_ms || 60000));
  const call = (verb, input) => def.exec ? runExec(def.exec, verb, input, ms) : runUrl(def.url, verb, input, ms);
  return {
    open: (_c, s) => call('open', s), send: (_c, id, text, a = {}) => call('send', { id, text, ...(a.test ? { test: true } : {}) }), state: (_c, id) => call('state', { id }),   // test: 서버 시험 글(어댑터가 시험 창에만 넣게)
    park: (_c, id) => call('park', { id }), reopen: (_c, handle, text, id) => call('reopen', { handle, text, id }), close: (_c, id) => call('close', { id }),
    list: async () => { let r; try { r = await call('list', {}); } catch (e) { if (e.code === 4) return []; throw e; } return Array.isArray(r) ? r : r.windows || []; },   // 404 = list 없는 엔진(선택 동사).   // 실패는 던짐 — listAll 이 failed 로 표시(빈 목록 = 창이 다 닫힘으로 보이지 않게)
  };
}
const HERDR = { key: herdr.key, open: herdr.open, send: herdr.send, state: (c, id) => herdr.state(c, id), park: herdr.park, reopen: herdr.reopen, close: herdr.close, list: c => herdr.list(c) };
let herdrSeen = { at: 0, ok: false };   // Herdr 서버가 도는지(1분 캐시 — 데몬이 15초마다 부름)
const herdrUp = cfg => { if (Date.now() - herdrSeen.at > 60000) herdrSeen = { at: Date.now(), ok: !!(cfg.herdr || which('herdr')) && herdr.running(cfg) }; return herdrSeen.ok; };
const TMUX = { key: tmux.key, open: tmux.open, send: tmux.send, state: (c, id) => tmux.state(c, id), park: tmux.park, reopen: tmux.reopen, close: tmux.close, list: c => tmux.list(c) };

// 데몬이 고르는 법(16쪽 ②): 역할에 정해진 엔진 → 기기 기본 → tmux → (Herdr 는 자가 시험 통과 뒤) → 등록된 커스텀 → 없으면 보고만
export function adapters(cfg = loadCfg()) {
  const out = {};
  if (cfg.tmux || which('tmux')) out.tmux = TMUX;
  if (herdrUp(cfg)) out.herdr = HERDR;   // 공식 Herdr — 사람이 띄운 Herdr 서버가 있을 때만
  for (const [n, d] of Object.entries(cfg.custom || {})) out[n] = custom(d);
  return out;
}
export function pick(cfg, want) {
  const a = adapters(cfg);
  if (want && a[want]) return want;
  if (cfg.default && a[cfg.default]) return cfg.default;
  return a.tmux ? 'tmux' : Object.keys(a)[0] || null;
}
export async function run(verb, args = {}, cfg = loadCfg()) {
  const name = args.engine || (args.id && cfg.windows?.[args.id]) || (args.handle?.engine) || pick(cfg);
  const a = adapters(cfg)[name];
  if (!a) throw new EngineError(1, name ? `engine ${name} is not available here` : 'no engine on this machine — run `boarder engine setup`');
  const caps = cfg.caps?.[name];
  if (caps && !caps.includes(verb)) throw new EngineError(5, `engine ${name} cannot ${verb}`);   // caps 에 없는 동사(서버가 피해 감)
  let r;
  if (verb === 'open') r = await a.open(cfg, args.spec);
  else if (verb === 'send') r = await a.send(cfg, args.id, args.text, args);
  else if (verb === 'state') r = await a.state(cfg, args.id);
  else if (verb === 'park') r = await a.park(cfg, args.id);
  else if (verb === 'reopen') r = await a.reopen(cfg, args.handle, args.text, args.id);
  else if (verb === 'close') r = await a.close(cfg, args.id);
  else throw new EngineError(1, `unknown verb ${verb}`);
  if (verb === 'open' || verb === 'reopen') { const c = loadCfg(); (c.windows ||= {})[r.id || args.spec?.id || args.id] = name; saveCfg(c); }
  if (verb === 'park' && r?.handle) r.handle.engine = name;
  return r;
}
export async function listAll(cfg = loadCfg()) {
  const out = []; out.failed = [];   // 목록을 못 읽은 엔진(데몬은 그 회 전체 목록을 안 보냄)
  for (const [name, a] of Object.entries(adapters(cfg))) { try { for (const w of await a.list(cfg)) out.push({ ...w, engine: name }); } catch { out.failed.push(name); } }
  return out;
}

const ECHO = [process.execPath, '-e', 'process.stdin.setEncoding("utf8");process.stdout.write("ready\\n");process.stdin.on("data",d=>process.stdout.write("got:"+d.replace(/\\x1b\\[20[01]~/g,"")))'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function selfTest(name, { log = () => {} } = {}) {
  const cfg = loadCfg(), a = adapters(cfg)[name];
  if (!a) throw new Error(`engine ${name} is not set up`);
  const id = `ew_selftest${Date.now().toString(36)}`, ok = {}, why = {};
  const step = async (verb, fn) => { try { const r = await fn(); ok[verb] = true; log(`  ✓ ${verb}`); return r; } catch (e) { ok[verb] = false; why[verb] = e.message; log(`  ✗ ${verb}: ${e.message}`); return null; } };
  const spec = { id, name: 'boarder self-test', cwd: path.join(dir(), 'selftest'), argv: ECHO, test: true };
  await step('open', async () => { const r = await a.open(cfg, spec); if (!r) throw new Error('no result'); });
  await sleep(800);
  await step('send', () => a.send(cfg, id, 'ping'));
  await step('state', async () => { await sleep(500); const s = await a.state(cfg, id); if (!s || s.state === 'none') throw new Error(`state ${s?.state}`); const seen = name === 'tmux' ? tmux.state(cfg, id, { tail: 20 }).tail : name === 'herdr' ? herdr.tail(cfg, id) : null; if (seen !== null && !/got:ping/.test(seen || '')) throw new Error('text did not reach the window'); });
  const parked = await step('park', async () => { const r = await a.park(cfg, id); if (!r?.handle) throw new Error('no handle'); const s = await a.state(cfg, id); if (s.state !== 'none') throw new Error('window still open'); return r; });
  await step('reopen', async () => { if (!parked) throw new Error('needs park'); await a.reopen(cfg, parked.handle, '', id); await sleep(500); const s = await a.state(cfg, id); if (s.state === 'none') throw new Error('did not reopen'); });
  await step('close', async () => { await a.close(cfg, id); const s = await a.state(cfg, id); if (s.state !== 'none') throw new Error('still open'); });
  try { await a.close(cfg, id); } catch {}
  const caps = VERBS.filter(v => ok[v]);
  const c = loadCfg(); (c.caps ||= {})[name] = caps; c.tested_at = Date.now(); saveCfg(c);
  return { engine: name, caps, failed: Object.fromEntries(Object.entries(why)) };
}

const TMUX_VER = '3.7c';
const TMUX_SHA = {
  'linux-x64': ['tmux-3.7c-linux-x86_64.tar.gz', 'cc56bd1cc873eb6089c615f0496b072385bda8a6d944069f38564a5d49c128aa'],
  'linux-arm64': ['tmux-3.7c-linux-arm64.tar.gz', '29dcb978da2a4b0cf6790f9e004865dac239a3ba03bbf776dddacce23d03831b'],
  'darwin-arm64': ['tmux-3.7c-macos-arm64.tar.gz', '0a763dd0380aa980d239509654da1bc7455843706a3c050f6709c8cd2e13d12d'],
  'darwin-x64': ['tmux-3.7c-macos-x86_64.tar.gz', '1c21f9ade964e4a539be05ffe3a4e95854ab76a0a9c4c05d0ffbe7fc6c4d783f'],
};
export async function ensureTmux({ log = console.log, force = false } = {}) {
  const mine = path.join(dir(), 'bin', 'tmux');
  if (!force) {
    const sys = which('tmux');
    if (sys) return { path: sys, how: 'found' };
    if (existsSync(mine)) return { path: mine, how: 'found' };
  }
  const k = TMUX_SHA[`${process.platform}-${process.arch}`];
  if (!k) throw new Error(`no tmux build for ${process.platform}-${process.arch} — install tmux yourself (your package manager), then run this again`);
  const url = process.env.BOARDER_TMUX_URL || `https://github.com/tmux/tmux-builds/releases/download/v${TMUX_VER}/${k[0]}`;
  log(`tmux not found — downloading the official tmux ${TMUX_VER} build (no admin rights needed): ${url}`);
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (createHash('sha256').update(buf).digest('hex') !== k[1]) throw new Error('downloaded tmux does not match its checksum — not installed');
  const tmpd = ensureDir(path.join(dir(), 'bin', `.tmux-${process.pid}`)), tgz = path.join(tmpd, 'tmux.tgz');
  writeFileSync(tgz, buf);
  execFileSync('tar', ['-xzf', tgz, '-C', tmpd], { stdio: 'ignore' });
  if (!existsSync(path.join(tmpd, 'tmux'))) throw new Error('tmux archive has no tmux binary');
  chmodSync(path.join(tmpd, 'tmux'), 0o755); renameSync(path.join(tmpd, 'tmux'), mine);
  rmSync(tmpd, { recursive: true, force: true });
  const v = execFileSync(mine, ['-V'], { encoding: 'utf8' }).trim();
  return { path: mine, how: `downloaded ${v}` };
}
export const engineHome = () => path.join(os.homedir(), 'boarder');
export { mkdirSync };
