import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const SESSION = 'boarder';
const sock = () => process.env.BOARDER_TMUX_SOCKET || 'boarder';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export class EngineError extends Error { constructor(code, msg) { super(msg); this.code = code; } }   // code: 1 실패 · 2 바쁨 · 4 없음

export function tmuxCmd(cfg, args, input) {
  try {
    return execFileSync(cfg.tmux || 'tmux', ['-L', sock(), ...args], { encoding: 'utf8', timeout: 15000, input, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { throw new EngineError(1, `tmux ${args[0]}: ${String(e.stderr || e.message).trim().split('\n')[0]}`); }
}
const has = cfg => { try { tmuxCmd(cfg, ['has-session', '-t', SESSION]); return true; } catch { return false; } };
const expand = p => (p || '').replace(/^~(?=$|\/)/, os.homedir());

const FMT = ['#{@bx_id}', '#{window_id}', '#{pane_id}', '#{pane_pid}', '#{pane_current_path}', '#{@bx_sid}', '#{window_name}', '#{pane_current_command}', '#{@bx_spec}'].join('\t');
export function list(cfg) {
  if (!has(cfg)) return [];
  return tmuxCmd(cfg, ['list-panes', '-s', '-t', SESSION, '-F', FMT]).split('\n').filter(Boolean).map(l => {
    const [id, win, pane, pid, cwd, sid, name, cmd, spec] = l.split('\t');
    return { id, tmux: win, pane, pid: +pid, cwd, session_id: sid || null, name, cmd, spec: spec ? JSON.parse(Buffer.from(spec, 'base64url').toString()) : null };
  }).filter(w => w.id);
}
const find = (cfg, id) => list(cfg).find(w => w.id === id) || null;

// 창에서 돌릴 명령: Claude Code(그 사람 기본 설정 · 그 사람 로그인). 자가 시험은 argv 를 바로 줌
export function agentArgv(cfg, s) {
  if (Array.isArray(s.argv) && s.argv.length) return s.argv;
  const a = [cfg.claude || 'claude'];
  if (s.model) a.push('--model', s.model);
  a.push(s.resume ? '--resume' : '--session-id', s.session_id);
  if (s.perm === 'bypass') a.push('--permission-mode', 'bypassPermissions');   // 사람이 화면에서 한 번 허용했을 때만(B-8) — 서버가 정해 보냄
  if (s.system) a.push('--append-system-prompt', s.system);
  if (s.prompt) a.push(s.prompt);
  return a;
}

/** open: { id, name, cwd, prompt, model, perm, system, session_id?, resume?, argv? } → { id, tmux, pane, session_id } */
export async function open(cfg, s) {
  if (!/^[\w-]{3,64}$/.test(s.id || '')) throw new EngineError(1, 'bad window id');
  if (find(cfg, s.id)) throw new EngineError(1, 'window already open');
  const cwd = expand(s.cwd) || os.homedir();
  mkdirSync(cwd, { recursive: true });
  const spec = { ...s, session_id: s.session_id || randomUUID(), prompt: undefined, resume: undefined };   // 다시 열 때 쓸 손잡이(글은 빼고)
  const argv = agentArgv(cfg, { ...s, session_id: spec.session_id });
  if (!s.argv?.length) { try { execFileSync('sh', ['-c', 'command -v "$1"', 'sh', argv[0]], { stdio: 'ignore' }); } catch { throw new EngineError(1, `Claude Code not found (${argv[0]}) — install it and sign in, then run \`boarder engine setup\``); } }   // 없으면 창이 바로 죽어 「server exited」만 보였음
  const name = String(s.name || s.id).replace(/[\x00-\x1f]/g, ' ').slice(0, 40);
  const env = ['-e', `BOARDER_WINDOW=${s.id}`, '-e', `BOARDER_WINDOW_NAME=${name}`];
  const cdir = configDir(s);
  if (cdir) { if (!existsSync(cdir)) throw new EngineError(1, `config folder not found (${cdir})`); env.push('-e', `CLAUDE_CONFIG_DIR=${cdir}`); }
  const head = has(cfg) ? ['new-window', '-d', '-t', `${SESSION}:`] : ['new-session', '-d', '-s', SESSION, '-x', '200', '-y', '50'];
  const out = tmuxCmd(cfg, [...head, '-P', '-F', '#{window_id}\t#{pane_id}', '-n', name, '-c', cwd, ...env, '--', ...argv]).trim();
  const [win, pane] = out.split('\t');
  tmuxCmd(cfg, ['set-option', '-w', '-t', win, '@bx_id', s.id]);
  tmuxCmd(cfg, ['set-option', '-w', '-t', win, '@bx_sid', spec.session_id]);
  tmuxCmd(cfg, ['set-option', '-w', '-t', win, '@bx_spec', Buffer.from(JSON.stringify(spec)).toString('base64url')]);
  tmuxCmd(cfg, ['set-option', '-w', '-t', win, 'automatic-rename', 'off']);
  return { id: s.id, tmux: win, pane, session_id: spec.session_id };
}

// ── 화면 읽기(pane-box 를 옮김): Claude Code 입력칸(맨 아래 두 가로줄 사이)에 사람이 친 글. 흐린 제안 글은 뺌
const ESC = /\x1b\[([0-9;]*)m|\x1b\][^\x07]*\x07|\x1b[^[\]]/g;
function visible(line) {
  let out = '', dim = false, i = 0;
  for (const m of line.matchAll(ESC)) {
    if (!dim) out += line.slice(i, m.index);
    i = m.index + m[0].length;
    if (m[1] !== undefined) for (const c of (m[1] || '0').split(';')) { if (c === '' || c === '0' || c === '22') dim = false; else if (c === '2') dim = true; }
  }
  if (!dim) out += line.slice(i);
  return out;
}
export function inputBox(raw) {
  const lines = raw.split('\n'), plain = lines.map(l => l.replace(ESC, ''));
  const rules = plain.map((l, i) => l.startsWith('──') ? i : -1).filter(i => i >= 0);
  if (rules.length < 2) return '';
  const [a, b] = rules.slice(-2), parts = [];
  for (let i = a + 1; i < b; i++) if (plain[i].startsWith('❯') || plain[i].startsWith('  ')) parts.push(visible(lines[i]).replace(/^❯/, '').trim());
  return parts.join(' ').replace(/\xa0/g, ' ').trim();
}
export function dialogOf(plain) {
  const tail = plain.split('\n').filter(l => l.trim()).slice(-14).join('\n');
  if (/trust (the files in )?this folder|Yes, I trust this folder|Do you trust/i.test(tail)) return 'trust';
  if (/Bypass Permissions mode/i.test(tail) && /Yes, I accept/i.test(tail)) return 'bypass';
  const bottom = plain.split('\n').filter(l => l.trim()).slice(-8).join('\n');
  if (/Enter to select|Enter to confirm|Esc to cancel|Do you want to proceed\?/.test(bottom)) return 'question';
  return null;
}
const LIMIT = /(usage limit|limit reached|rate limit|resets? (at|in) \d)/i;
const capture = (cfg, pane, esc) => tmuxCmd(cfg, ['capture-pane', '-p', ...(esc ? ['-e'] : []), '-t', pane]);

// Claude Code 가 남기는 세션 상태 파일(<설정 폴더>/sessions/<pid>.json: sessionId · status busy|idle|waiting|shell) — 자격 파일이 아님(C-1)
export const configDir = s => (s?.config_dir ? expand(String(s.config_dir)) : null);
function claudeDirs(first) {
  const d = [first, process.env.CLAUDE_CONFIG_DIR, path.join(os.homedir(), '.claude')].filter(Boolean);
  return [...new Set(d)].filter(x => existsSync(path.join(x, 'sessions')));
}
export function claudeSession(sid, dir) {
  if (!sid) return null;
  let best = null;
  for (const d of claudeDirs(dir)) for (const f of readdirSync(path.join(d, 'sessions'))) {
    if (!f.endsWith('.json')) continue;
    let j; try { j = JSON.parse(readFileSync(path.join(d, 'sessions', f), 'utf8')); } catch { continue; }
    if (j.sessionId !== sid) continue;
    try { process.kill(j.pid, 0); } catch { continue; }   // 죽은 프로세스가 남긴 파일은 버림
    if (!best || (j.updatedAt || 0) > (best.updatedAt || 0)) best = j;
  }
  return best;
}
const MAP = { busy: 'busy', idle: 'idle', waiting: 'waiting', shell: 'background' };

/** state: 일함 busy · 쉼 idle · 질문 waiting · 뒤 작업 background · 막 뜨는 중 starting · 없음 none + since · dialog · box · limit · tail */
export function state(cfg, id, { tail = 0 } = {}) {
  const w = find(cfg, id);
  if (!w) return { id, state: 'none' };
  const raw = capture(cfg, w.pane, true), plain = raw.replace(ESC, '');
  const s = claudeSession(w.session_id, configDir(w.spec)), dialog = dialogOf(plain), box = inputBox(raw);
  const lines = plain.split('\n').filter(l => l.trim());
  const lim = lines.slice(-12).find(l => LIMIT.test(l));
  let st = s ? (MAP[s.status] || 'busy') : 'starting';
  if (dialog) st = 'waiting';
  return { id, state: st, since: s?.updatedAt || null, session_id: w.session_id, ...(dialog ? { dialog } : {}), ...(box ? { box: box.slice(0, 200) } : {}), ...(lim ? { limit: lim.trim().slice(0, 200) } : {}), ...(tail ? { tail: lines.slice(-tail).join('\n') } : {}) };
}

/** send: 글을 붙여넣고 Enter. 사람이 입력칸에 친 글이 있거나 확인창이 떠 있으면 바쁨(2) — 덮어쓰지 않음 */
export async function send(cfg, id, text) {
  const w = find(cfg, id); if (!w) throw new EngineError(4, 'no such window');
  const raw = capture(cfg, w.pane, true);
  if (inputBox(raw)) throw new EngineError(2, 'someone is typing in that window');
  const dlg = dialogOf(raw.replace(ESC, ''));
  if (dlg) throw new EngineError(2, `a ${dlg} dialog is open in that window`);
  const buf = `bx${process.pid}${Date.now()}`;
  tmuxCmd(cfg, ['load-buffer', '-b', buf, '-'], String(text));
  tmuxCmd(cfg, ['paste-buffer', '-d', '-p', '-b', buf, '-t', w.pane]);   // 여러 줄도 한 덩어리(대괄호 붙여넣기)
  for (let i = 0; i < 4; i++) {
    await sleep(i ? 1500 : 400);
    tmuxCmd(cfg, ['send-keys', '-t', w.pane, 'Enter']);
    await sleep(700);
    if (!inputBox(capture(cfg, w.pane, true))) return { ok: true, tries: i + 1 };
  }
  throw new EngineError(1, 'the text stayed in the input box');
}

export async function key(cfg, id, k) { const w = find(cfg, id); if (!w) throw new EngineError(4, 'no such window'); tmuxCmd(cfg, ['send-keys', '-t', w.pane, k]); return { ok: true }; }
/** park: 다시 열 손잡이를 돌려주고 창을 닫음 */
export async function park(cfg, id) {
  const w = find(cfg, id); if (!w) throw new EngineError(4, 'no such window');
  const handle = { engine: 'tmux', ...(w.spec || {}), id, session_id: w.session_id, cwd: w.spec?.cwd || w.cwd, name: w.name };
  tmuxCmd(cfg, ['kill-window', '-t', w.tmux]);
  return { handle };
}
export async function reopen(cfg, handle, text, id) {
  if (!handle?.session_id) throw new EngineError(1, 'handle has no session');
  return open(cfg, { ...handle, id: id || handle.id, prompt: text || undefined, resume: !handle.argv });
}
export async function close(cfg, id) {
  const w = find(cfg, id); if (!w) return { ok: true, gone: true };
  tmuxCmd(cfg, ['kill-window', '-t', w.tmux]);
  return { ok: true };
}
export const VERBS = ['open', 'send', 'state', 'park', 'reopen', 'close'];
