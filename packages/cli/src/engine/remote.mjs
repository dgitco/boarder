// 보더 웹(설정 › 엔진)이 엔진 WebSocket 으로 내리는 기기 명령 셋: account_list · account_login · engine_choose.
// 로그인 값(토큰 · 자격 파일)은 읽지도 보내지도 않는다 — 서버로 나가는 것은 계정 이름 · 로그인 여부 · 로그인 주소(URL)뿐.
import { spawn } from 'node:child_process';
import * as E from './index.mjs';
import { accountFolder, accountList, accountNames, findCli, isLoggedIn, loginSpec } from './login.mjs';

const PROV = ['claude', 'codex'];
const NAME = /^\w[\w.-]{0,39}$/;
const URL_RE = /https:\/\/[^\s"'<>\x1b]+/;   // https 만 — Codex 는 첫 줄에 http://localhost:1455 (기기 안 로그인 서버)를 먼저 찍음
const URL_DONE = /https:\/\/[^\s"'<>\x1b]+(?=[\s"'<>\x1b])/;   // 주소 뒤에 공백 · 줄바꿈이 와야 잡음 — 파이프가 주소를 두 조각으로 줘도 잘린 채 잡지 않게
const clean = u => u.replace(/[).,;:]+$/, '');
const running = new Map();   // "공급자/이름" → { url, done, kill } — 같은 계정 로그인이 겹치면 지금 것을 돌려줌
const bad = (msg, code = 64) => Object.assign(new Error(msg), { code });

/** 지금 이 기기의 엔진 · 공급자별 계정(이름 · 로그인 여부) */
export async function accountsNow(cfg = E.loadCfg(), deps = {}) {
  const out = {};
  for (const prov of PROV) {
    const cli = (deps.find || findCli)(prov);
    out[prov] = await Promise.all((deps.names || accountNames)(cfg, prov).map(async name => ({ name, logged_in: await isLoggedIn(prov, accountFolder(cfg, prov, name), { cli, exists: deps.exists, run: deps.run }) })));
  }
  return { engine: E.pick(cfg) || null, engines: Object.keys(E.adapters(cfg)), accounts: out };
}

/** 브라우저 로그인을 띄우고 출력된 주소를 돌려줌(로그인은 뒤에서 계속 — 화면이 목록을 다시 읽어 확인) */
export function startLogin(cfg, prov, name, { find = findCli, launch = spawn, mkdir = E.mkdirSync, waitMs = 20000, ttlMs = 10 * 60_000 } = {}) {
  if (!PROV.includes(prov) || !NAME.test(name || '')) throw bad('공급자나 계정 이름이 맞지 않아요');
  const key = `${prov}/${name}`, cur = running.get(key);
  if (cur && !cur.done) return Promise.resolve({ url: cur.url, started: false });
  const folder = accountFolder(cfg, prov, name);
  mkdir(folder, { recursive: true, mode: 0o700 });
  const cli = find(prov);
  if (!cli) throw bad('이 기기에 로그인 도구가 없어요 — boarder engine setup --sdk 를 한 번 실행해 주세요', 1);
  const s = loginSpec(prov, cli, folder);
  return new Promise(resolve => {
    const st = { url: null, done: false };
    const ch = launch(s.cmd, s.args, { env: s.env, shell: s.shell, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    running.set(key, st);
    let buf = '', settled = false;
    const finish = v => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } };
    const feed = d => { if (st.url) return; buf = (buf + String(d)).slice(-4000); const m = URL_DONE.exec(buf); if (m) { st.url = clean(m[0]); finish({ url: st.url, started: true }); } };
    const last = () => { if (!st.url) { const m = URL_RE.exec(buf); if (m) st.url = clean(m[0]); } };   // 끝나거나 기다림이 다 되면 남은 것에서 마지막으로 한 번
    ch.stdout?.on('data', feed); ch.stderr?.on('data', feed);
    const end = () => { st.done = true; last(); finish({ url: st.url, started: true }); };
    ch.on('error', () => { end(); });
    ch.on('exit', end);
    const kill = setTimeout(() => { try { ch.kill(); } catch {} }, ttlMs); kill.unref?.();
    ch.on('exit', () => clearTimeout(kill));
    const t = setTimeout(() => { last(); finish({ url: st.url, started: true }); }, waitMs);
  });
}

/** 엔진 고르기: sdk(내 구독) · tmux(쓰던 Codex · Claude Code). 기기 설정(기본 엔진)만 바꿈 */
export async function chooseEngine(engine, { cfg = E.loadCfg(), save = E.saveCfg, sdkReady = async () => { const SD = await import('./sdk.mjs'); const a = await SD.available(); return a.claude && a.codex; }, install = async () => { const SD = await import('./sdk.mjs'); return SD.installSdks({ log: () => {} }); } } = {}) {
  if (!['sdk', 'tmux'].includes(engine)) throw bad('엔진은 sdk 나 tmux 예요');
  if (engine === 'sdk') {
    cfg.sdk ||= { accounts: {} };
    if (!(await sdkReady())) { const r = await install(); if (!r?.ok) throw bad(`내 구독 엔진을 아직 못 깔았어요 — ${String(r?.why || '').slice(0, 120) || 'boarder engine setup --sdk 를 실행해 주세요'}`, 1); }
  } else if (!E.adapters(cfg).tmux) throw bad('이 기기엔 tmux 가 없어요 — boarder engine setup 을 먼저 실행해 주세요', 1);
  cfg.default = engine; save(cfg);
  return { default: engine, engines: Object.keys(E.adapters(cfg)) };
}

/** 데몬 handle() 이 부름. 모르는 동사면 null */
export async function remoteVerb(verb, args = {}, deps = {}) {
  if (verb === 'account_list') return accountsNow(deps.cfg, deps);
  if (verb === 'account_login') { const r = await startLogin(deps.cfg || E.loadCfg(), args.provider, args.name, deps); return { url: r.url || null, started: r.started }; }
  if (verb === 'engine_choose') return chooseEngine(args.engine, deps);
  return null;
}
export const REMOTE_VERBS = ['account_list', 'account_login', 'engine_choose'];
