import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dir, readJson, writeSecret } from '../config.mjs';
import { EngineError, agentArgv, claudeSession, dialogOf, inputBox } from './tmux.mjs';

const store = () => path.join(dir(), 'herdr-windows.json');
const load = () => readJson(store(), {}) || {};
const save = m => writeSecret(store(), m);
function hd(cfg, args) {
  let out;
  try { out = execFileSync(cfg.herdr || 'herdr', args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = String(e.stdout || ''); if (!out.trim()) throw new EngineError(1, `herdr ${args.slice(0, 2).join(' ')}: ${String(e.stderr || e.message).trim().split('\n')[0]}`); }
  if (!out.trim()) return {};   // pane run · send 는 성공하면 아무것도 안 찍음
  let j; try { j = JSON.parse(out); } catch { throw new EngineError(1, `herdr ${args.slice(0, 2).join(' ')}: not JSON`); }
  if (j.error) throw new EngineError(j.error.code === 'not_found' ? 4 : 1, `herdr: ${j.error.message || j.error.code}`);
  return j.result || {};
}
export const running = cfg => { try { hd(cfg, ['workspace', 'list']); return true; } catch { return false; } };
const sq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;   // `pane run` 은 셸 줄을 받음 — 인자마다 홑따옴표
const panes = cfg => hd(cfg, ['pane', 'list']).panes || [];

export function list(cfg) {
  const m = load(), live = new Set(panes(cfg).map(p => p.pane_id));
  return Object.entries(m).filter(([, w]) => live.has(w.pane)).map(([id, w]) => ({ id, name: w.spec?.name || id, pane: w.pane, workspace: w.workspace, session_id: w.spec?.session_id, cwd: w.spec?.cwd, spec: w.spec }));
}
export async function open(cfg, s) {
  if (!/^[\w-]{3,64}$/.test(s.id || '')) throw new EngineError(1, 'bad window id');
  const m = load(); if (m[s.id] && panes(cfg).some(p => p.pane_id === m[s.id].pane)) throw new EngineError(1, 'window already open');
  const cwd = (s.cwd || '~').replace(/^~(?=$|\/)/, os.homedir()); mkdirSync(cwd, { recursive: true });
  const spec = { ...s, session_id: s.session_id || randomUUID(), prompt: undefined, resume: undefined };
  const name = String(s.name || s.id).replace(/[\x00-\x1f]/g, ' ').slice(0, 40);
  const r = hd(cfg, ['workspace', 'create', '--cwd', cwd, '--label', s.id, '--env', `BOARDER_WINDOW=${s.id}`, '--env', `BOARDER_WINDOW_NAME=${name}`, '--no-focus']);
  const pane = r.root_pane?.pane_id, workspace = r.workspace?.workspace_id;
  if (!pane) throw new EngineError(1, 'herdr did not return a pane');
  // 새 셸이 입력을 받을 때까지(첫 글자가 먹히지 않게) — 프롬프트 끝 글자가 보이면
  try { hd(cfg, ['pane', 'wait-output', pane, '--regex', '[$%#>❯] ?$', '--timeout', '8000']); } catch {}
  const ld = path.join(dir(), 'herdr-launch'); mkdirSync(ld, { recursive: true, mode: 0o700 });
  const f = path.join(ld, `${s.id}.sh`);
  writeFileSync(f, `#!/bin/sh\nrm -f -- "$0"\nexec ${agentArgv(cfg, { ...s, session_id: spec.session_id }).map(sq).join(' ')}\n`, { mode: 0o600 });
  hd(cfg, ['pane', 'run', pane, `sh ${sq(f)}`]);
  m[s.id] = { pane, workspace, spec }; save(m);
  return { id: s.id, pane, session_id: spec.session_id };
}
const find = (cfg, id) => { const w = load()[id]; return w && panes(cfg).find(p => p.pane_id === w.pane) ? w : null; };
export async function send(cfg, id, text) {
  const w = find(cfg, id); if (!w) throw new EngineError(4, 'no such window');
  const raw = screen(cfg, w.pane, true, true);
  if (inputBox(raw)) throw new EngineError(2, 'someone is typing in that window');
  const dlg = dialogOf(raw.replace(ESC, '')); if (dlg) throw new EngineError(2, `a ${dlg} dialog is open in that window`);
  hd(cfg, ['pane', 'run', w.pane, String(text).replace(/\r?\n/g, ' ')]);   // 글 + Enter 를 한 번에(Herdr 권장). 줄바꿈은 줄마다 보내지므로 한 줄로
  return { ok: true };
}
export async function key(cfg, id, k) { const w = find(cfg, id); if (!w) throw new EngineError(4, 'no such window'); hd(cfg, ['pane', 'send-keys', w.pane, k]); return { ok: true }; }
const ESC = /\x1b\[[0-9;]*m|\x1b\][^\x07]*\x07|\x1b[^[\]]/g;
function screen(cfg, pane, ansi, strict = false) {
  try { return execFileSync(cfg.herdr || 'herdr', ['pane', 'read', pane, '--source', 'visible', ...(ansi ? ['--format', 'ansi'] : [])], { encoding: 'utf8', timeout: 10000 }); } catch (e) { if (strict) throw new EngineError(2, 'could not read the window'); return ''; }
}
const MAP = { working: 'busy', blocked: 'waiting', idle: 'idle', done: 'idle' };
export const tail = (cfg, id) => { const w = find(cfg, id); if (!w) return ''; try { return execFileSync(cfg.herdr || 'herdr', ['pane', 'read', w.pane, '--lines', '20'], { encoding: 'utf8', timeout: 10000 }); } catch { return ''; } };
export function state(cfg, id) {
  const w = find(cfg, id); if (!w) return { id, state: 'none' };
  const dialog = dialogOf(screen(cfg, w.pane, false));
  if (dialog) return { id, state: 'waiting', dialog, session_id: w.spec?.session_id };
  const s = claudeSession(w.spec?.session_id);   // Claude Code 상태 파일이 있으면 그것(tmux 와 같은 값)
  if (s) return { id, state: { busy: 'busy', idle: 'idle', waiting: 'waiting', shell: 'background' }[s.status] || 'busy', since: s.updatedAt, session_id: w.spec?.session_id };
  const p = panes(cfg).find(x => x.pane_id === w.pane);
  return { id, state: MAP[p?.agent_status] || 'starting', session_id: w.spec?.session_id };
}
export async function park(cfg, id) {
  const w = find(cfg, id); if (!w) throw new EngineError(4, 'no such window');
  hd(cfg, ['workspace', 'close', w.workspace]);
  const m = load(); delete m[id]; save(m);
  return { handle: { engine: 'herdr', ...w.spec, id } };
}
export async function reopen(cfg, handle, text, id) {
  if (!handle?.session_id) throw new EngineError(1, 'handle has no session');
  return open(cfg, { ...handle, id: id || handle.id, prompt: text || undefined, resume: !handle.argv });   // 작업공간부터 새로
}
export async function close(cfg, id) {
  const w = load()[id]; if (!w) return { ok: true, gone: true };
  try { hd(cfg, ['workspace', 'close', w.workspace]); } catch (e) { if (e.code !== 4) throw e; }
  const m = load(); delete m[id]; save(m);
  return { ok: true };
}
