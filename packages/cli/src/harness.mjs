import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dir, ensureDir, home, loadDevice, readJson, server } from './config.mjs';
import { targets } from './targets.mjs';
import { LABEL_PREFIX, unitName, unitToPlist } from './launchd.mjs';
import { dropAllRules } from './rules-block.mjs';

export const TOUCHES = ['phone-alert', 'external-send', 'account-autoswitch'];
const MARK = '# boarder harness — `boarder disable harness` removes this file';
const ENV_KEYS = ['HARNESS_HOME', 'HARNESS_INFRA', 'HARNESS_STATE', 'HARNESS_SESSION', 'HARNESS_CALL_NAME', 'HARNESS_LANG', 'HARNESS_PHONE_ALERT', 'HARNESS_EXTERNAL_SEND', 'HARNESS_ACCOUNT_AUTOSWITCH'];

export const shareRoot = () => path.join(process.env.XDG_DATA_HOME || path.join(home(), '.local', 'share'), 'boarder');
export const harnessDir = () => path.join(shareRoot(), 'harness');
const runDir = () => path.join(harnessDir(), 'run');
const binDir = () => path.join(home(), '.local', 'bin');
const unitDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(home(), '.config'), 'systemd', 'user');
export const envPath = () => path.join(process.env.XDG_CONFIG_HOME || path.join(home(), '.config'), 'harness', 'harness.env');
const statePath = () => path.join(dir(), 'harness.json');
const loadState = () => readJson(statePath());
const realHome = () => { try { return path.resolve(home()) === path.resolve(os.userInfo().homedir); } catch { return true; } };
const sh = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore', timeout: 20000 }); return true; } catch { return false; } };
const isLink = p => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
const present = p => { try { lstatSync(p); return true; } catch { return false; } };
const inside = (p, root) => { const r = path.resolve(root) + path.sep; return path.resolve(p).startsWith(r); };
const linkTarget = p => { try { return path.resolve(path.dirname(p), readlinkSync(p)); } catch { return null; } };
const ourLink = p => isLink(p) && inside(linkTarget(p) || '', harnessDir());
const sq = v => `'${String(v).replace(/'/g, `'\\''`)}'`;

// 우리가 만든 빈 폴더는 끌 때 같이 지움(흔적 0)
const made = new Set();
function mkdirp(d) { for (let x = path.resolve(d); inside(x, home()) && !existsSync(x); x = path.dirname(x)) made.add(x); mkdirSync(d, { recursive: true }); }

/** install.json + 켠 묶음 → 깔 것. needs 가 다 켜져야 하고, 꺼진 사람 몸 묶음에 걸린 이름은 어디서든 뺌 */
const SAFE = n => typeof n === 'string' && /^[\w.-]+$/.test(n) && n !== '.' && n !== '..';   // 경로에 붙는 이름은 이것만(../ 로 홈 밖에 못 나감)
export function planOf(spec, bundles) {
  const on = id => bundles?.[id] === true;
  const ok = needs => Array.isArray(needs) && needs.length > 0 && needs.every(on);
  const offTouch = needs => (needs || []).some(n => TOUCHES.includes(n) && !on(n));
  const blocked = new Set();
  for (const g of [...(spec.bin || []), ...(spec.skills || [])]) if (offTouch(g.needs)) for (const n of g.names || []) blocked.add(n);
  for (const h of spec.hooks || []) if (offTouch(h.needs)) blocked.add(h.bin);
  const bins = new Set();
  for (const g of spec.bin || []) if (ok(g.needs)) for (const n of g.names || []) if (SAFE(n) && !blocked.has(n)) bins.add(n);
  const hooks = (spec.hooks || []).filter(h => ok(h.needs) && SAFE(h.bin) && !blocked.has(h.bin));
  for (const h of hooks) bins.add(h.bin);
  const skills = new Set();
  for (const g of spec.skills || []) if (ok(g.needs)) for (const n of g.names || []) if (SAFE(n) && !blocked.has(n)) skills.add(n);
  const units = (spec.units || []).filter(u => ok(u.needs));
  return { bins: [...bins].sort(), hooks, skills: [...skills].sort(), units, blocked };
}

async function getJson(url, token) {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (r.status === 401) throw Object.assign(new Error('this machine was revoked or is not a member machine — sign in again with `boarder setup`'), { code: 'REVOKED' });
  if (r.status === 404) throw new Error('this Boarder server does not host the harness (hosted Boarder only)');
  if (r.status === 503) throw new Error('the harness is not published on this server yet');
  if (!r.ok) throw new Error(`server answered ${r.status}`);
  return r.json();
}
export async function fetchPlan() {
  const d = loadDevice(); if (!d?.token) throw Object.assign(new Error('not signed in — run `boarder setup --yes` first'), { code: 'NO_DEVICE' });
  const j = await getJson(`${server()}/api/device/harness`, d.token);
  if (!j || typeof j.bundles !== 'object' || !/^[0-9][0-9a-z.-]*$/.test(j.version || '') || !/^[0-9a-f]{64}$/.test(j.sha256 || '')) throw new Error('the server sent an unexpected harness answer');
  return { ...j, token: d.token };
}

async function download(p) {
  const file = `/cli/harness-${p.version}.tgz`;
  const r = await fetch(`${server()}${file}`, { headers: { authorization: `Bearer ${p.token}` }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`could not download the harness (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (createHash('sha256').update(buf).digest('hex') !== p.sha256) throw new Error('the harness download does not match its checksum — not installed');
  mkdirp(shareRoot());
  const tmp = path.join(shareRoot(), `harness.new-${process.pid}`); rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  try {
    const tgz = path.join(tmp, 'h.tgz'); writeFileSync(tgz, buf);
    execFileSync('tar', ['-xzf', tgz, '-C', tmp, '--no-same-owner'], { stdio: 'ignore', timeout: 120000 });
    const top = path.join(tmp, 'harness');
    if (!existsSync(path.join(top, 'defaults', 'install.json'))) throw new Error('the harness download has no defaults/install.json');
    for (const e of readdirSync(tmp)) if (e !== 'harness') rmSync(path.join(tmp, e), { recursive: true, force: true });
    rmSync(harnessDir(), { recursive: true, force: true });
    renameSync(top, harnessDir());
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  buildRun();
}

function buildRun() {
  // run/: bin 사본(진짜 파일 — 명령이 제 경로로 lib 를 찾게) + lib 링크
  const run = runDir(); mkdirSync(run, { recursive: true });
  const bin = path.join(harnessDir(), 'bin'), lib = path.join(harnessDir(), 'lib');
  for (const n of existsSync(bin) ? readdirSync(bin) : []) { copyFileSync(path.join(bin, n), path.join(run, n)); chmodSync(path.join(run, n), 0o755); }
  for (const n of existsSync(lib) ? readdirSync(lib) : []) if (!present(path.join(run, n))) symlinkSync(path.join(lib, n), path.join(run, n));
  if (process.platform === 'darwin') writeFileSync(path.join(run, '.built-by-harness'), 'boarder enable harness\n');
}

const PACK_SKIP = /(^|\/)(\.env[^/]*|\.dev\.vars|harness\.env|__pycache__|[^/]*\.pyc)$/;
const noLinks = a => { try { return !lstatSync(a).isSymbolicLink() && !PACK_SKIP.test(a); } catch { return false; } };
const harnessRoot = from => { const r = path.resolve(String(from).replace(/^~(?=\/|$)/, home())); return existsSync(path.join(r, 'engine')) ? r : existsSync(path.join(r, 'harness', 'engine')) ? path.join(r, 'harness') : null; };
/** 래퍼 bundles.json 의 켜기 값. 사람 몸에 닿는 묶음은 어떤 값이어도 꺼짐 */
export function localPlan(from, wrapper) {
  const H = harnessRoot(from); if (!H) throw new Error(`${from} has no engine/ (pass the harness folder or a Boarder checkout)`);
  const W = path.join(H, 'wrappers', wrapper), b = readJson(path.join(W, 'bundles.json'));
  if (!Array.isArray(b?.bundles)) throw new Error(`${W}/bundles.json is missing`);
  const bundles = Object.fromEntries(b.bundles.map(x => [x.id, x.enabled === true && !TOUCHES.includes(x.id)]));
  for (const t of TOUCHES) bundles[t] = false;
  return { H, W, bundles, version: String(readJson(path.join(W, 'wrapper.json'))?.version || 'local') };
}
function packFromFolder(plan) {
  const { H, W } = plan, E = path.join(H, 'engine');
  if (!existsSync(path.join(W, 'install.json'))) throw new Error(`${W}/install.json is missing`);
  mkdirp(shareRoot());
  const stage = path.join(shareRoot(), `harness.new-${process.pid}`); rmSync(stage, { recursive: true, force: true });
  try {
    mkdirSync(path.join(stage, 'defaults'), { recursive: true });
    for (const d of ['bin', 'lib', 'board', 'systemd', 'desktop', 'config.example']) if (existsSync(path.join(E, d)) && noLinks(path.join(E, d))) cpSync(path.join(E, d), path.join(stage, d), { recursive: true, filter: noLinks });
    for (const d of ['skills', 'hooks', 'rules', 'plan-abc']) for (const base of [E, W]) if (existsSync(path.join(base, d))) cpSync(path.join(base, d), path.join(stage, d), { recursive: true, filter: noLinks });
    for (const f of ['install.json', 'bundles.json']) copyFileSync(path.join(W, f), path.join(stage, 'defaults', f));
    if (existsSync(path.join(W, 'wrapper.json'))) copyFileSync(path.join(W, 'wrapper.json'), path.join(stage, 'wrapper.json'));
    rmSync(harnessDir(), { recursive: true, force: true });
    renameSync(stage, harnessDir());
  } finally { rmSync(stage, { recursive: true, force: true }); }
  buildRun();
}

// ── 묻기(호칭 · 언어 둘만)
async function askValues({ name, lang, log }) {
  const old = readEnv(), out = { name: name || old.HARNESS_CALL_NAME, lang: lang || old.HARNESS_LANG };
  if (out.name && out.lang) return out;
  const dflt = { name: String(loadDevice()?.email || process.env.USER || 'me').split('@')[0], lang: 'ko' };
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!out.name) out.name = (await rl.question(`What should your agents call you? [${dflt.name}] `)).trim() || dflt.name;
      if (!out.lang) out.lang = (await rl.question(`Which language should they answer in? (ko, en, …) [${dflt.lang}] `)).trim() || dflt.lang;
    } finally { rl.close(); }
  } else { out.name ||= dflt.name; out.lang ||= dflt.lang; log(`harness: name "${out.name}", language "${out.lang}" (change with --name / --lang or in ${envPath()})`); }
  return out;
}
const envLine = (k, v) => `${k}=${/^[\w@.,/:+-]*$/.test(v) ? v : sq(v)}`;
function readEnv() {
  const o = {}; try { for (const l of readFileSync(envPath(), 'utf8').split('\n')) { const m = l.match(/^(HARNESS_[A-Z_]+)=(.*?)\s*(?:#.*)?$/); if (m) o[m[1]] = m[2].replace(/^'(.*)'$/, '$1'); } } catch {}
  return o;
}
/** 없는 칸만 더함(그 사람이 고친 줄은 그대로) — 무엇을 더했는지 돌려줌 */
function writeEnv(values, bundles) {
  const p = envPath(), existed = existsSync(p), have = readEnv();
  const want = {
    HARNESS_HOME: home(), HARNESS_INFRA: harnessDir(), HARNESS_STATE: path.join(home(), '.local', 'state'), HARNESS_SESSION: 'work',
    HARNESS_CALL_NAME: values.name, HARNESS_LANG: values.lang,
    HARNESS_PHONE_ALERT: bundles['phone-alert'] === true ? 'on' : 'off', HARNESS_EXTERNAL_SEND: bundles['external-send'] === true ? 'on' : 'off', HARNESS_ACCOUNT_AUTOSWITCH: bundles['account-autoswitch'] === true ? 'on' : 'off',
  };
  const add = ENV_KEYS.filter(k => !(k in have));
  if (!add.length) return { path: p, made: false, keys: [] };
  mkdirp(path.dirname(p));
  const old = existed ? readFileSync(p, 'utf8') : '# 하네스 값(boarder enable harness 가 만듦). 비밀값은 여기 쓰지 않는다.\n';
  writeFileSync(p, (old && !old.endsWith('\n') ? old + '\n' : old) + add.map(k => `${envLine(k, want[k])}\n`).join(''), { mode: 0o600 });
  return { path: p, made: !existed, keys: add };
}
function dropEnv(e) {
  if (!e?.path || !existsSync(e.path)) return [];
  if (e.made) { rmSync(e.path, { force: true }); return [e.path]; }
  const keys = new Set(e.keys || []); if (!keys.size) return [];
  const t = readFileSync(e.path, 'utf8'), x = t.split('\n').filter(l => !keys.has((l.match(/^(HARNESS_[A-Z_]+)=/) || [])[1])).join('\n');
  if (x !== t) { writeFileSync(e.path, x); return [e.path]; }
  return [];
}

// ── Claude settings.json 훅: 우리 칸 = 명령이 <자리>/run/ 을 부르는 것
const ourCmd = c => typeof c === 'string' && c.includes(sq(runDir() + path.sep).slice(0, -1));
function stripOurs(j) {
  if (!j.hooks || typeof j.hooks !== 'object') return;
  for (const ev of Object.keys(j.hooks)) {
    const l = j.hooks[ev]; if (!Array.isArray(l)) continue;
    const k = [];
    for (const x of l) {
      if (!x || !Array.isArray(x.hooks)) { k.push(x); continue; }
      const hs = x.hooks.filter(h => !ourCmd(h?.command));
      if (hs.length === x.hooks.length) k.push(x); else if (hs.length) k.push({ ...x, hooks: hs });
    }
    if (k.length) j.hooks[ev] = k; else delete j.hooks[ev];
  }
  if (!Object.keys(j.hooks).length) delete j.hooks;
}
function editSettings(p, fn, log) {
  const existed = existsSync(p);
  let j = {};
  if (existed) { const t = readFileSync(p, 'utf8'); if (t.trim()) { try { j = JSON.parse(t); } catch { log(`skipped ${p} — it is not valid JSON`); return null; } } }
  const before = JSON.stringify(j); fn(j);
  if (JSON.stringify(j) === before) return false;
  if (!existed && !Object.keys(j).length) return false;
  const real = existed ? realpathSync(p) : p;   // 링크로 관리하는 닷파일이면 링크의 실제 파일에 씀(링크 유지)
  mkdirp(path.dirname(real));
  const tmp = `${real}.boarder-${process.pid}.tmp`, mode = existed ? statSync(real).mode & 0o777 : 0o644;
  writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n', { mode }); renameSync(tmp, real);
  return true;
}

function linkOne(dest, src, log, kind) {
  if (present(dest)) {
    if (ourLink(dest)) rmSync(dest, { force: true });
    else { log(`kept your ${dest} — not replaced by the harness ${kind}`); return false; }
  }
  mkdirp(path.dirname(dest)); symlinkSync(src, dest); return true;
}
const agentsDir = () => path.join(home(), 'Library', 'LaunchAgents');
const sha = t => createHash('sha256').update(t).digest('hex');
export function launchctlRunner({ log = () => {}, dry = process.env.BOARDER_HARNESS_LAUNCHCTL === 'dry' } = {}) {
  const dom = `gui/${os.userInfo().uid}`;
  const run = args => { if (dry) { log(`(dry) launchctl ${args.join(' ')}`); return true; } return sh('launchctl', args); };
  return { up: (label, file) => { run(['bootout', `${dom}/${label}`]); return run(['bootstrap', dom, file]); }, down: label => run(['bootout', `${dom}/${label}`]) };
}
/** 끄기(맥): 상태 파일에 적힌 우리 plist 만 — 라벨이 우리 접두사이고 내용이 우리가 쓴 그대로일 때만 지움(사람이 고쳤으면 남김) */
export function removeLaunchd(units, { lc, log = () => {}, load = true } = {}) {
  const done = [];
  for (const u of units || []) {
    if (!u?.plist || !u.label?.startsWith(LABEL_PREFIX) || path.basename(u.plist) !== `${u.label}.plist`) continue;
    let t; try { t = readFileSync(u.plist, 'utf8'); } catch { continue; }
    if (sha(t) !== u.sha256) { log(`kept ${u.plist} — it was changed after the harness wrote it`); continue; }
    if (load) lc.down(u.label);
    rmSync(u.plist, { force: true }); done.push(u.plist);
  }
  return done;
}
const unitBins = text => [...text.matchAll(/%h\/\.local\/bin\/([\w.-]+)/g)].map(m => m[1]);

/** 켜기 — 앞서 깐 것은 먼저 걷고 지금 값으로 다시(다시 돌려도 같음) */
export async function enableHarness({ log = console.log, name, lang, from, wrapper } = {}) {
  if (process.platform === 'win32') { log('Windows runs without the harness — Boarder uses your own subscription (SDK engine). 윈도우는 하네스 없이 내 구독(SDK)으로 써요.'); return { ok: true, skipped: 'win32' }; }
  let p, plan0 = null;
  if (from) {   // 서버 없이: 폴더에서 래퍼를 받아(직접 고른 것으로 적힘) 같은 꾸러미를 폄
    const id = wrapper || undefined;
    const WM = await import('./wrapper.mjs').catch(() => { throw new Error('--from needs the wrapper module, which this build does not include'); });
    const r = await WM.wrapperPull(id, { log, from }); plan0 = localPlan(from, r.id);
    p = { bundles: plan0.bundles, version: plan0.version };
  } else p = await fetchPlan();
  const values = await askValues({ name, lang, log });
  const prev = loadState(); if (prev) disableHarness({ log: () => {}, keepFiles: true });
  made.clear(); for (const d of prev?.made || []) made.add(d);
  if (plan0) packFromFolder(plan0); else await download(p);
  const spec = readJson(path.join(harnessDir(), 'defaults', 'install.json')) || {};
  const plan = planOf(spec, p.bundles);
  const st = { version: p.version, at: Date.now(), bundles: p.bundles, bins: [], skills: [], settings: [], settingsMade: [...(prev?.settingsMade || [])], units: [], env: null, made: [] };
  for (const n of plan.bins) { const src = path.join(runDir(), n); if (!existsSync(src)) continue; const dest = path.join(binDir(), n); if (linkOne(dest, src, log, 'command')) st.bins.push(dest); }
  const T = targets().filter(t => t.tool === 'claude' || t.tool === 'codex');
  for (const t of T) for (const n of plan.skills) {
    const src = path.join(harnessDir(), 'skills', n); if (!existsSync(src)) continue;
    const dest = path.join(t.dir, 'skills', n); if (linkOne(dest, src, log, 'skill')) st.skills.push(dest);
  }
  const hooks = plan.hooks.filter(h => existsSync(path.join(runDir(), h.bin)));
  if (hooks.length) for (const t of T.filter(t => t.tool === 'claude')) {
    if (!existsSync(t.files.settings) && !st.settingsMade.includes(t.files.settings)) st.settingsMade.push(t.files.settings);
    const r = editSettings(t.files.settings, j => {
      stripOurs(j); j.hooks ||= {};
      for (const h of hooks) {
        const cmd = [sq(path.join(runDir(), h.bin)), ...(h.args || [])].join(' ');
        const entry = { ...(h.matcher ? { matcher: h.matcher } : {}), hooks: [{ type: 'command', command: cmd, timeout: h.timeout || 10 }] };
        (j.hooks[h.event] ||= []).push(entry);
      }
    }, log);
    if (r !== null) st.settings.push(t.files.settings);
  }
  if (process.platform === 'linux') {
    const sys = path.join(harnessDir(), 'systemd');
    for (const u of plan.units) {
      const files = (u.files || []).filter(f => /^[\w.@-]+\.(service|timer)$/.test(f));
      if (!files.length || !files.every(f => existsSync(path.join(sys, f)))) continue;
      const texts = files.map(f => readFileSync(path.join(sys, f), 'utf8'));
      const bad = texts.flatMap(unitBins).filter(b => plan.blocked.has(b) || !plan.bins.includes(b));
      if (bad.length) { log(`skipped ${u.start} — it runs ${[...new Set(bad)].join(', ')}, which is off`); continue; }
      if (files.some(f => present(path.join(unitDir(), f)) && !readFileSync(path.join(unitDir(), f), 'utf8').startsWith(MARK))) { log(`kept your ${u.start} in ${unitDir()} — not replaced`); continue; }
      mkdirp(unitDir());
      files.forEach((f, i) => writeFileSync(path.join(unitDir(), f), `${MARK}\n${texts[i]}`));
      st.units.push({ start: u.start, files: files.map(f => path.join(unitDir(), f)) });
    }
    if (st.units.length && realHome()) {
      sh('systemctl', ['--user', 'daemon-reload']);
      for (const u of st.units) if (!sh('systemctl', ['--user', 'enable', '--now', u.start])) log(`systemd --user did not start ${u.start}`);
    } else if (st.units.length) log(`HOME (${home()}) is not your login home — wrote the units but did not start them`);
  } else if (process.platform === 'darwin') {
    const sys = path.join(harnessDir(), 'systemd'), load = realHome(), lc = launchctlRunner({ log });
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const u of plan.units) {
      const files = (u.files || []).filter(f => /^[\w.@-]+\.(service|timer)$/.test(f));
      if (!files.length || !files.every(f => existsSync(path.join(sys, f)))) continue;
      const texts = files.map(f => readFileSync(path.join(sys, f), 'utf8'));
      const bad = texts.flatMap(unitBins).filter(b => plan.blocked.has(b) || !plan.bins.includes(b));
      if (bad.length) { log(`skipped ${u.start} — it runs ${[...new Set(bad)].join(', ')}, which is off`); continue; }
      const name = unitName(u.start), svc = files.indexOf(`${name}.service`), tmr = files.indexOf(`${name}.timer`);
      if (svc < 0) { log(`skipped ${u.start} — no ${name}.service`); continue; }
      const r = unitToPlist({ name, service: texts[svc], timer: tmr < 0 ? null : texts[tmr], home: home(), nodeDir: path.dirname(process.execPath), localTz,
        runDir: runDir(), runHas: n => existsSync(path.join(runDir(), n)) });
      if (r.skip) { log(`skipped ${u.start} on macOS — ${r.skip}`); continue; }
      const file = path.join(agentsDir(), r.file);
      if (present(file)) { log(`kept your ${file} — not replaced`); continue; }
      mkdirp(agentsDir()); mkdirp(path.dirname(r.log));
      writeFileSync(file, r.plist, { mode: 0o644 });
      st.units.push({ start: u.start, label: r.label, plist: file, sha256: sha(r.plist), files: [] });
    }
    if (st.units.length && load) { for (const u of st.units) if (!lc.up(u.label, u.plist)) log(`launchd did not start ${u.label}`); }
    else if (st.units.length) log(`HOME (${home()}) is not your login home — wrote the launchd plists but did not load them`);
  } else if (plan.units.length) log('timers: systemd only — skipped on this OS');
  st.env = prev?.env?.made ? { ...writeEnv(values, p.bundles), made: true } : writeEnv(values, p.bundles);
  if (prev?.env?.keys?.length && !st.env.made) st.env.keys = [...new Set([...prev.env.keys, ...st.env.keys])];
  st.made = [...made];
  ensureDir(dir()); writeFileSync(statePath(), JSON.stringify(st, null, 2) + '\n');
  log(`harness ${p.version}: ${st.bins.length} commands in ${binDir()}, ${st.skills.length} skill links, hooks in ${st.settings.length} Claude settings, ${st.units.length} timers`);
  if (plan.blocked.size) log(`not installed (off in Settings › Nodes): ${[...plan.blocked].sort().join(', ')}`);
  return { ok: true, ...st };
}

/** 끄기 — 적어 둔 것만, 그리고 지금 Claude 설정 폴더에 남은 우리 훅도 */
export function disableHarness({ log = console.log, keepFiles = false } = {}) {
  const st = loadState() || {}, done = [];
  const mac = (st.units || []).filter(u => u?.plist);
  if (mac.length) done.push(...removeLaunchd(mac, { lc: launchctlRunner({ log }), log, load: realHome() }));
  if (st.units?.length && !mac.length) {
    if (realHome()) for (const u of st.units) sh('systemctl', ['--user', 'disable', '--now', u.start]);
    for (const u of st.units) for (const f of u.files) { try { if (readFileSync(f, 'utf8').startsWith(MARK)) { rmSync(f, { force: true }); done.push(f); } } catch {} }
    if (realHome()) sh('systemctl', ['--user', 'daemon-reload']);
  }
  const warn = [];
  if (!keepFiles) { try { for (const d of dropAllRules()) (d.startsWith('! ') ? warn : done).push(d.replace(/^removed /, '')); } catch {} }   // 규칙 파일에 넣은 구역만(그 사람 글은 그대로)
  for (const p of [...(st.bins || []), ...(st.skills || [])]) if (ourLink(p)) { rmSync(p, { force: true }); done.push(p); }
  const settings = new Set([...(st.settings || []), ...targets().filter(t => t.tool === 'claude').map(t => t.files.settings)]);
  for (const p of settings) if (existsSync(p) && editSettings(p, stripOurs, log)) {
    // 우리가 만든 빈 파일({})이면 지움
    try { if (!keepFiles && readFileSync(p, 'utf8').trim() === '{}' && (st.settingsMade || []).includes(p)) rmSync(p, { force: true }); } catch {}
    done.push(p);
  }
  if (!keepFiles) {
    done.push(...dropEnv(st.env));
    if (existsSync(harnessDir())) { rmSync(harnessDir(), { recursive: true, force: true }); done.push(harnessDir()); }
    rmSync(statePath(), { force: true });
    for (const d of [...(st.made || [])].sort((a, b) => b.length - a.length)) { try { if (!readdirSync(d).length) rmdirSync(d); } catch {} }
  }
  for (const p of done) log(`removed ${p}`);
  for (const w of warn) log(w);   // 경고는 지운 파일 목록과 따로
  return { ok: true, removed: done.length, warnings: warn };
}

/** 목록 — 서버 값(켠 묶음)과 이 기기에 깐 것 */
export async function listHarness({ log = console.log } = {}) {
  const st = loadState();
  let bundles = st?.bundles || null, from = 'this machine';
  try { bundles = (await fetchPlan()).bundles; from = 'Settings › Nodes'; } catch (e) { if (!st) throw e; }
  const titles = Object.fromEntries((readJson(path.join(harnessDir(), 'defaults', 'bundles.json'))?.bundles || []).map(b => [b.id, b.title]));
  log(`Harness bundles (${from}):`);
  for (const [k, v] of Object.entries(bundles || {})) log(`  ${v === true ? '✓' : '·'} ${k}${titles[k] ? ` — ${titles[k]}` : ''}${TOUCHES.includes(k) ? ' (reaches people; off unless you turn it on)' : ''}`);
  if (!st) { log('Not installed here — `boarder enable harness` installs the bundles that are on.'); return { installed: false, bundles }; }
  log(`Installed ${st.version}: ${st.bins.length} commands, ${st.skills.length} skill links, hooks in ${st.settings.length} Claude settings, ${st.units.length} timers`);
  for (const p of st.bins) log(`  command ${path.basename(p)}`);
  for (const u of st.units) log(`  timer ${u.start}`);
  return { installed: true, bundles, state: st };
}

export const HARNESS_HELP = `  boarder enable harness [--name <what agents call you>] [--lang ko|en|…] [--from <harness folder or Boarder checkout> [--wrapper <name>]]
                                    install the harness bundles you turned on in Settings › Nodes (hosted Boarder, member machines):
                                    work commands in ~/.local/bin, skills in each AI tool, guard hooks added to Claude settings.json
                                    (your own entries stay), the timers that are on (systemd --user; launchd LaunchAgents on macOS). Bundles that reach people
                                    (phone alerts, sending outside, account auto-switch) are never installed while they are off.
                                    --from takes everything from a folder instead of the server (needs access to the internal repo; works against any Boarder server)
  boarder disable harness           take all of it back out
  boarder harness list              which bundles are on and what is installed here`;
