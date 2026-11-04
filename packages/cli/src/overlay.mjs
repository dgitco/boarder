// boarder view overlay css|js <파일> · show · off — 내 계정 화면에만 얹는 css · js(서버 person_custom, 각 200KB).
// 값 우선순위: 내가 올린 값 > 래퍼 값 > 코드 기본값. 깨지면 주소 뒤에 ?no_overlay=1 로 열거나 `boarder view overlay off`.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { home, loadDevice, server } from './config.mjs';

const MAX = 200_000;
async function call(method, body) {
  const d = loadDevice(); if (!d?.token) throw Object.assign(new Error('not signed in — run `boarder setup --yes` first'), { code: 'NO_DEVICE' });
  const r = await fetch(`${server()}/api/device/overlay`, { method, headers: { authorization: `Bearer ${d.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('this machine cannot change the screen (it must be a full-access machine of an owner or current member)');
  if (r.status === 403 && j.error === 'not_allowed') throw new Error(`not allowed: ${j.hint || 'run `boarder settings allow` and press 「허용」 on your board'}`);   // js 는 내 로그인 화면에서 돌아 보드 허락 뒤만
  if (!r.ok || j.ok === false) throw new Error(j.error || `server answered ${r.status}`);
  return j;
}

export async function overlayCommand(sub, args, { log = console.log } = {}) {
  if (sub === 'css' || sub === 'js') {
    const f = args[0]; if (!f) throw Object.assign(new Error(OVERLAY_HELP), { code: 'USAGE' });
    const p = path.resolve(f.replace(/^~(?=\/|$)/, home()));
    let st; try { st = statSync(p); } catch { throw new Error(`${p} does not exist`); }
    if (!st.isFile()) throw new Error(`${p} is not a file`);
    if (st.size > MAX) throw new Error(`${sub} is limited to ${MAX} bytes`);
    await call('POST', { slot: 'mine', set: { [sub]: readFileSync(p, 'utf8') } });
    log(`${sub} set from ${p} — it applies to your board only (add ?no_overlay=1 to the address to open without it)`);
    return { ok: true };
  }
  if (sub === 'show' || !sub) {
    const j = await call('GET');
    log(`yours:   css ${j.cssBytes} bytes · js ${j.jsBytes} bytes`);
    log(`wrapper: css ${j.wrapper.css} bytes · js ${j.wrapper.js} bytes${j.wrapper.jsSha ? ` (approved sha256 ${j.wrapper.jsSha.slice(0, 12)}…)` : ''} · side ${j.wrapper.side ? 'yes' : 'no'}`);
    log('what applies: your value for each of css and js, else the wrapper\'s');
    return j;
  }
  if (sub === 'off') { await call('POST', { slot: 'mine', set: { css: null, js: null } }); log('your css and js are cleared (the wrapper\'s values, if any, apply again)'); return { ok: true }; }
  throw Object.assign(new Error(OVERLAY_HELP), { code: 'USAGE' });
}

export const OVERLAY_HELP = `  boarder view overlay css <file> | js <file>
                                    put your own CSS / JS on top of your board (your account only; 200KB each).
                                    JS runs with your login, so a member machine needs \`boarder settings allow\` first (CSS and clearing do not).
                                    Priority: yours > the wrapper's > the code default. A broken one: open the board with ?no_overlay=1
  boarder view overlay show         sizes of yours and the wrapper's, and which applies
  boarder view overlay off          clear yours`;
