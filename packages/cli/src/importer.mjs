import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, openSync, readSync, closeSync, realpathSync } from 'node:fs';
import { dir, home, loadDevice, readJson, server, writeSecret } from './config.mjs';

const host = () => os.hostname().split('.')[0].replace(/[^\w.-]/g, '').slice(0, 30) || 'host';
const run = (cmd, args, timeout = 5000, cwd) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout, cwd, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const ls = d => { try { return readdirSync(d); } catch { return []; } };
const mtime = f => { try { return statSync(f).mtimeMs; } catch { return 0; } };
const DAY = 86400_000;
// 파일 머리 · 꼬리만(큰 대화 기록을 다 읽지 않음)
function slice(f, from, n) { let fd; try { fd = openSync(f, 'r'); const b = Buffer.alloc(n); const k = readSync(fd, b, 0, n, from); return b.subarray(0, k).toString('utf8'); } catch { return ''; } finally { if (fd !== undefined) closeSync(fd); } }
const head = (f, n = 65536) => slice(f, 0, n);
const tail = (f, n = 65536) => { let size = 0; try { size = statSync(f).size; } catch {} return slice(f, Math.max(0, size - n), n); };
const jl = s => s.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// ── 비밀 가리기 · 링크(이음) 뽑기
const SECRET = /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|bx[adw]_[A-Za-z0-9_-]{20,})/g;
const safe = s => String(s ?? '').replace(SECRET, '[가림]');
export function refsOf(text, repo) {
  const out = new Set(), t = String(text || '');
  for (const m of t.matchAll(/https?:\/\/[\w-]+\.slack\.com\/archives\/([A-Z0-9]{8,12})\/p(\d{10})(\d{6})/g)) out.add(`slack:${m[1]}/${m[2]}.${m[3]}`);
  for (const m of t.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)/g)) out.add(`gh:${m[1]}/${m[2].replace(/\.git$/, '')}#${m[3]}`.toLowerCase());
  for (const m of t.matchAll(/linear\.app\/[\w-]+\/issue\/([A-Z][A-Z0-9]{1,9}-\d+)/g)) out.add(`linear:${m[1]}`);
  if (repo) { const r = repo.replace(/^github\.com\//, ''); for (const m of t.matchAll(/(?:^|[\s(])#(\d{2,6})\b/g)) if (/^[\w.-]+\/[\w.-]+$/.test(r)) out.add(`gh:${r}#${m[1]}`.toLowerCase()); }
  return [...out].slice(0, 12);
}
const keyPart = (v, n) => String(v ?? '').replace(/[\s\x00-\x1f]+/g, '-').slice(0, n);
const branchRefs = (branch, repo) => { const m = /(?:^|[/_-])(\d{3,6})(?:[/_-]|$)/.exec(branch || ''); const r = (repo || '').replace(/^github\.com\//, ''); return m && /^[\w.-]+\/[\w.-]+$/.test(r) ? [`gh:${r}#${m[1]}`.toLowerCase()] : []; };

// ── 리포(폴더마다 한 번): 주소의 사용자:비번 · .git 떼고 github.com/o/r 꼴
const repoCache = new Map();
export function normRepo(u) {
  if (!u) return '';
  let s = u.trim().replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@/, 'https://').replace(/^([a-z+]+:\/\/)[^@/]+@/i, '$1');
  try { const x = new URL(s); return (x.host + x.pathname).replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase(); } catch { return ''; }
}
const repoOf = cwd => { if (!cwd) return ''; if (!repoCache.has(cwd)) repoCache.set(cwd, existsSync(cwd) ? normRepo(run('git', ['-C', cwd, 'remote', 'get-url', 'origin'], 2000).trim()) : ''); return repoCache.get(cwd); };
const branchOf = cwd => cwd && existsSync(cwd) ? run('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], 2000).trim() : '';

export function claudeDirs() {
  const h = home(), out = new Set();
  if (process.env.CLAUDE_CONFIG_DIR) out.add(process.env.CLAUDE_CONFIG_DIR);
  for (const n of ls(h)) if (n === '.claude' || /^\.claude-[\w-]{1,20}$/.test(n)) { const d = path.join(h, n); try { if (statSync(d).isDirectory()) out.add(fsReal(d)); } catch {} }
  return [...out];
}
const fsReal = d => { try { return realpathSync(d); } catch { return d; } };
const slug = cwd => cwd.replace(/[^A-Za-z0-9]/g, '-');

function liveClaude() {
  const out = [];
  for (const d of claudeDirs()) for (const f of ls(path.join(d, 'sessions'))) {
    if (!/^\d+\.json$/.test(f)) continue;
    const j = readJson(path.join(d, 'sessions', f)); if (!j?.sessionId || !j.pid) continue;
    try { process.kill(j.pid, 0); } catch { continue; }
    out.push({ dir: d, pid: j.pid, sid: j.sessionId, cwd: j.cwd || '', tmux: j.tmux || '', status: j.status || '', name: j.name || '', at: j.statusUpdatedAt || j.updatedAt || 0, kind: j.kind || '' });
  }
  return out;
}
const ST = { busy: 'working', idle: 'idle', waiting: 'question', shell: 'working' };

function procTable() {
  const m = new Map();
  for (const l of run('ps', ['-A', '-o', 'pid=,ppid=,args='], 5000).split('\n')) { const x = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l); if (x) m.set(+x[1], { ppid: +x[2], args: x[3] }); }
  return m;
}
const AGENT = a => { const w = a.trim().split(/\s+/), b = s => path.basename(s || '').toLowerCase(); let n = b(w[0]); if (/^(node\d*|bun|deno)$/.test(n)) n = b(w[1]); return n === 'claude' ? 'claude' : n === 'codex' ? 'codex' : /^cursor(-agent)?$/.test(n) ? 'cursor' : n === 'gemini' ? 'gemini' : null; };
function agentUnder(pid, pt) {
  const kids = new Map(); for (const [p, v] of pt) (kids.get(v.ppid) || kids.set(v.ppid, []).get(v.ppid)).push(p);
  const q = [pid];
  for (let i = 0; q.length && i < 400; i++) { const p = q.shift(), v = pt.get(p); const a = v && AGENT(v.args); if (a) return { tool: a, pid: p, args: v.args }; q.push(...(kids.get(p) || [])); }
  return null;
}
function ownTmux() {
  const fmt = ['#{pane_id}', '#{pane_pid}', '#{pane_current_path}', '#{session_name}', '#{window_index}', '#{window_name}'].join('\t');
  return run('tmux', ['list-panes', '-a', '-F', fmt], 4000).split('\n').filter(Boolean).map(l => { const [pane, pid, cwd, sess, wi, name] = l.split('\t'); return { pane, pid: +pid, cwd, sess, wi, name }; });
}
const capture = pane => run('tmux', ['capture-pane', '-p', '-t', pane, '-S', '-30'], 3000);
function paneState(text) {
  if (/esc to interrupt|\(esc to cancel\)|Running…|Working \(/i.test(text)) return 'working';
  if (/Do you want to|❯ 1\.|\[y\/n\]|Allow this|Approve\?/i.test(text)) return 'question';
  return 'idle';
}

export function herdrCall(args, timeout = 8000) {
  let out = '';
  try { out = execFileSync('herdr', args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) {
    let j = null; try { j = JSON.parse(String(e.stderr || e.stdout || '')); } catch {}
    const err = new Error(j?.error?.message || String(e.stderr || e.message || e).trim().split('\n')[0] || 'herdr failed'); err.code = j?.error?.code || (e.code === 'ENOENT' ? 'no_herdr' : 'herdr'); throw err;
  }
  try { return JSON.parse(out).result || {}; } catch { return {}; }
}
const HS = { working: 'working', blocked: 'question', idle: 'idle', done: 'idle', unknown: 'idle' };
function ownHerdr() {
  let agents, wss;
  try { agents = herdrCall(['agent', 'list'], 4000).agents || []; } catch { return []; }   // Herdr 가 없거나 서버가 안 돎 — 없는 셈
  try { wss = new Map((herdrCall(['workspace', 'list'], 4000).workspaces || []).map(w => [w.workspace_id, w.label || ''])); } catch { wss = new Map(); }
  return agents.map(a => {
    let pids = []; try { pids = (herdrCall(['pane', 'process-info', '--pane', a.pane_id], 4000).process_info?.foreground_processes || []).map(p => p.pid); } catch {}
    return { pane: a.pane_id, workspace: a.workspace_id, label: wss.get(a.workspace_id) || '', name: a.name || '', tool: a.agent || '', status: a.agent_status || '', cwd: a.foreground_cwd || a.cwd || '', pids };
  });
}

let ENGINE;
async function engine() { if (ENGINE === undefined) { try { ENGINE = await import('./engine/index.mjs'); } catch { ENGINE = null; } } return ENGINE; }

export async function collectWindows() {
  const H = host(), items = [], live = liveClaude(), bySid = new Map(live.map(l => [l.sid, l]));
  const byPane = new Map(live.filter(l => l.tmux).map(l => [`${l.tmux.split(':')[0]}|${l.tmux.split('.').pop()}`, l]));
  const taken = new Set();
  const E = await engine();
  const engWins = E?.listAll ? await E.listAll().catch(() => []) : [];
  {
    for (const w of engWins) {
      let st = ''; try { st = (await E.run('state', { id: w.id, engine: w.engine }))?.state || ''; } catch {}
      const l = w.session_id && bySid.get(w.session_id); if (l) taken.add(l.pid);
      items.push({ key: `window:${H}:${w.id}`, kind: 'window', engine: w.engine, title: clip(w.name || w.id, 120), cwd: w.cwd || '', win: `${H}:${w.id}`,
        session: w.session_id ? `session:claude:${w.session_id}` : '', state: ({ busy: 'working', waiting: 'question', background: 'working', starting: 'working', none: 'gone' })[st] || (st || 'idle'),
        state_at: l?.at || Date.now(), handle: { engine: w.engine, id: w.id, tool: 'claude', session_id: w.session_id || '', cwd: w.cwd || '', name: w.name || '' } });
    }
  }
  const pt = procTable();
  for (const p of ownTmux()) {
    const a = agentUnder(p.pid, pt); if (!a) continue;
    const l = live.find(x => x.pid === a.pid) || byPane.get(`${p.sess}|${p.pane}`);
    if (l && taken.has(l.pid)) continue;
    if (l) taken.add(l.pid);
    const sid = l?.sid || (/--(?:resume|session-id)[ =]([0-9a-f-]{36})/.exec(a.args)?.[1]) || '';
    const n = p.pane.slice(1), state = l ? (ST[l.status] || 'idle') : paneState(capture(p.pane));
    const cfgDir = l?.dir && path.resolve(l.dir) !== path.resolve(path.join(home(), '.claude')) ? l.dir : '';
    items.push({ key: `window:${H}:tmux:${n}`, kind: 'window', engine: 'tmux-own', title: clip(!/^(zsh|bash|sh|fish|node|claude|codex)$/.test(p.name) ? p.name : l?.name || `${p.sess}:${p.wi}`, 120), cwd: l?.cwd || p.cwd, win: `${H}:tmux:${n}`,
      session: sid ? `session:${a.tool}:${sid}` : '', state, state_at: l?.at || Date.now(),
      handle: { engine: 'tmux-own', pane: p.pane, tsession: p.sess, tool: a.tool, session_id: sid, cwd: l?.cwd || p.cwd, name: p.name, ...(cfgDir ? { config_dir: cfgDir } : {}) } });
  }
  const ours = new Set(engWins.filter(w => w.engine === 'herdr' && w.pane).map(w => w.pane));
  for (const h of ownHerdr()) {
    if (ours.has(h.pane) || /^ew_/.test(h.label)) continue;
    const l = live.find(x => h.pids.includes(x.pid)); if (l) { if (taken.has(l.pid)) continue; taken.add(l.pid); }
    const tool = ['claude', 'codex', 'cursor', 'gemini'].includes(h.tool) ? h.tool : h.tool || 'agent';
    const sid = l?.sid || '';
    items.push({ key: `window:${H}:herdr:${h.pane}`, kind: 'window', engine: 'herdr-own', title: clip(h.name || h.label || l?.name || `${tool} · ${path.basename(h.cwd || '')}`, 120), cwd: l?.cwd || h.cwd, win: `${H}:herdr:${h.pane}`,
      session: sid ? `session:${tool}:${sid}` : '', state: l ? (ST[l.status] || HS[h.status] || 'idle') : (HS[h.status] || 'idle'), state_at: l?.at || Date.now(),
      handle: { engine: 'herdr-own', pane: h.pane, workspace: h.workspace, tool, session_id: sid, cwd: l?.cwd || h.cwd, name: h.name || h.label, park: false } });
  }
  for (const l of live) {
    if (taken.has(l.pid) || l.tmux || l.kind === 'sdk') continue;
    items.push({ key: `window:${H}:claude:${l.pid}`, kind: 'window', engine: 'terminal', title: clip(l.name || `claude · ${path.basename(l.cwd)}`, 120), cwd: l.cwd, win: `${H}:claude:${l.pid}`,
      session: `session:claude:${l.sid}`, state: ST[l.status] || 'idle', state_at: l.at, handle: { engine: 'terminal', tool: 'claude', session_id: l.sid, cwd: l.cwd, park: false } });
  }
  return items;
}

const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x?.type === 'text' || x?.type === 'input_text').map(x => x.text).join(' ') : '';
const noise = t => !t || /^\s*<(command-|local-command|system-reminder|bash-|user-prompt-submit)/.test(t) || /^\s*Caveat:/.test(t);
export function claudeSessions(days = 7) {
  const out = [], since = Date.now() - days * DAY;
  const files = [];
  for (const d of claudeDirs()) for (const p of ls(path.join(d, 'projects'))) for (const f of ls(path.join(d, 'projects', p))) {
    if (!/^[0-9a-f-]{36}\.jsonl$/.test(f)) continue;
    const full = path.join(d, 'projects', p, f), t = mtime(full); if (t > since) files.push({ full, t, sid: f.slice(0, 36) });
  }
  files.sort((a, b) => b.t - a.t);
  const seen = new Set();
  for (const { full, t, sid } of files.slice(0, 150)) {
    if (seen.has(sid)) continue; seen.add(sid);
    const H = jl(head(full)), T = jl(tail(full));
    const first = H.find(x => x.cwd) || T.find(x => x.cwd) || {};
    const summary = [...H, ...T].reverse().find(x => x.type === 'summary')?.summary;
    const ask = H.find(x => x.type === 'user' && !x.isMeta && !noise(textOf(x.message?.content)));
    const cwd = first.cwd || '', branch = [...T].reverse().find(x => x.gitBranch)?.gitBranch || first.gitBranch || '', repo = repoOf(cwd);
    const text = [...H, ...T].filter(x => x.type === 'user' || x.type === 'assistant').map(x => textOf(x.message?.content)).join('\n');
    out.push({ key: `session:claude:${sid}`, kind: 'session', engine: 'claude', title: clip(safe(summary || textOf(ask?.message?.content) || path.basename(cwd)), 120),
      cwd, repo, branch, refs: [...new Set([...refsOf(text, repo), ...branchRefs(branch, repo)])].slice(0, 12), state: liveState(sid) || (Date.now() - t < 120_000 ? 'working' : 'idle'), state_at: Math.round(t) });
  }
  return out;
}
// 지금 도는 세션이면 Claude Code 상태 파일의 상태(쉼 · 일함 · 질문) — 기록 파일 시각보다 맞음
let LIVE; const liveState = sid => { LIVE ||= new Map(liveClaude().map(l => [l.sid, ST[l.status] || 'idle'])); return LIVE.get(sid); };
export function codexSessions(days = 7) {
  const root = path.join(process.env.CODEX_HOME || path.join(home(), '.codex'), 'sessions'), out = [], since = Date.now() - days * DAY;
  const files = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(Date.now() - i * DAY), p = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    for (const f of ls(p)) if (/^rollout-.*\.jsonl$/.test(f)) { const full = path.join(p, f), t = mtime(full); if (t > since) files.push({ full, t }); }
  }
  for (const { full, t } of files.sort((a, b) => b.t - a.t).slice(0, 60)) {
    const H = jl(head(full)), meta = H.find(x => x.type === 'session_meta')?.payload || {};
    if (!meta.id) continue;
    const ask = H.find(x => x.type === 'response_item' && x.payload?.role === 'user' && !noise(textOf(x.payload?.content)) && !/<environment_context>|<user_instructions>/.test(textOf(x.payload?.content)));
    const cwd = meta.cwd || '', repo = normRepo(meta.git?.repository_url) || repoOf(cwd), branch = meta.git?.branch || '';
    const text = [...H, ...jl(tail(full))].map(x => textOf(x.payload?.content)).join('\n');
    out.push({ key: `session:codex:${meta.id}`, kind: 'session', engine: 'codex', title: clip(safe(textOf(ask?.payload?.content) || path.basename(cwd)), 120), cwd, repo, branch,
      refs: [...new Set([...refsOf(text, repo), ...branchRefs(branch, repo)])].slice(0, 12), state: Date.now() - t < 120_000 ? 'working' : 'idle', state_at: Math.round(t) });
  }
  return out;
}

// ── 할 일: Claude Code 할 일 목록(todos/<세션>-agent-*.json) 중 안 끝난 것
export function claudeTodos(sids) {
  const out = [];
  for (const d of claudeDirs()) for (const f of ls(path.join(d, 'todos'))) {
    const m = /^([0-9a-f-]{36})-agent-[0-9a-f-]+\.json$/.exec(f); if (!m || !sids.has(m[1])) continue;
    const a = readJson(path.join(d, 'todos', f)); if (!Array.isArray(a)) continue;
    a.forEach((t, i) => { if (t?.status && t.status !== 'completed') out.push({ key: `todo:claude:${m[1]}:${i}`, kind: 'todo', title: clip(safe(t.content || t.activeForm), 120), state: t.status === 'in_progress' ? 'working' : 'open', session: `session:claude:${m[1]}` }); });
  }
  return out.slice(0, 150);
}

async function harnessTasks() {
  const cfg = readJson(path.join(process.env.BOARDER_HOME || path.join(home(), '.config', 'boarder'), 'engine.json'), {}) || {};
  const out = []; out.ok = false;
  for (const [name, d] of Object.entries(cfg.custom || {})) {
    if (!d?.exec) continue;
    const r = await new Promise(res => {
      const ch = spawn(d.exec, ['items'], { stdio: ['pipe', 'pipe', 'ignore'] }); let s = '';
      const t = setTimeout(() => ch.kill('SIGKILL'), 20000);
      ch.stdout.on('data', x => { s += x; }); ch.on('error', () => { clearTimeout(t); res(null); });
      ch.on('close', code => { clearTimeout(t); if (code !== 0) return res(null); try { res(JSON.parse(s)); } catch { res(null); } });
      ch.stdin.on('error', () => {});   // 스크립트가 입력을 안 읽고 먼저 끝나도(EPIPE) 들여오기는 계속
      ch.stdin.end('{}');
    });
    const list = Array.isArray(r) ? r : r?.items;
    if (Array.isArray(list)) out.ok = true;
    for (const t of (Array.isArray(list) ? list : []).slice(0, 200)) {
      if (!t?.id || !t.title) continue;
      const H = host();
      out.push({ key: `task:${keyPart(name, 40)}:${keyPart(t.id, 80)}`, kind: 'task', engine: clip(name, 40), title: clip(safe(t.title), 120), state: ['working', 'idle', 'question', 'parked', 'done', 'open'].includes(t.state) ? t.state : 'open',
        win: t.window ? `${H}:${keyPart(t.window, 80)}` : '', branch: clip(t.branch || '', 120), repo: t.repo ? normRepo(t.repo) || clip(t.repo, 200) : '', refs: Array.isArray(t.refs) ? t.refs.map(r => keyPart(r, 150)).filter(Boolean).slice(0, 12) : [] });
    }
  }
  return out;
}

// ── 스레드: 세션 · 창이 가리키는 이슈 · PR · Slack 스레드(제목은 gh 가 있으면 gh 로, 없으면 링크 꼴)
async function threads(items, { gh = true } = {}) {
  const refs = new Map();
  for (const i of items) for (const r of i.refs || []) refs.set(r, (refs.get(r) || 0) + 1);
  const out = [];
  const ghOk = gh && (() => { try { execFileSync('gh', ['auth', 'status'], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; } })();
  const list = [...refs.keys()].slice(0, 60);
  let n = 0;
  for (const r of list) {
    let title = r, state = 'open';
    const m = /^gh:([\w.-]+\/[\w.-]+)#(\d+)$/.exec(r);
    if (m && ghOk && n++ < 25) {
      const j = (() => { try { return JSON.parse(run('gh', ['issue', 'view', m[2], '-R', m[1], '--json', 'title,state'], 8000) || run('gh', ['pr', 'view', m[2], '-R', m[1], '--json', 'title,state'], 8000)); } catch { return null; } })();
      if (j?.title) { title = `${m[1].split('/')[1]}#${m[2]} ${j.title}`; state = /closed|merged/i.test(j.state) ? 'done' : 'open'; }
      else title = `${m[1].split('/')[1]}#${m[2]}`;
    } else if (m) title = `${m[1].split('/')[1]}#${m[2]}`;
    else if (r.startsWith('slack:')) title = `Slack 스레드 ${r.slice(6)}`;
    if (r.length > 180) continue;
    out.push({ key: `thread:${r}`, kind: 'thread', title: clip(safe(title), 120), refs: [r], state });
  }
  return out;
}

const SECRET1 = new RegExp(SECRET.source);
export const tokenish = seg => SECRET1.test(seg) || (/^[A-Za-z0-9_-]{20,}$/.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg));
const cleanUrl = u => { try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return ''; let had = !!(x.search || x.username || x.password); x.username = ''; x.password = ''; x.search = ''; x.hash = '';
  x.pathname = x.pathname.split('/').map(g => { if (tokenish(g)) { had = true; return '_'; } return g; }).join('/'); return { url: x.toString(), had }; } catch { return ''; } };
function mcpEntry(name, v, from) {
  if (!v || typeof v !== 'object') return null;
  const u = v.url || v.httpUrl || v.serverUrl, c = u && cleanUrl(u);
  const secrets = !!(v.env && Object.keys(v.env).length) || !!(v.headers && Object.keys(v.headers).length) || !!(c && c.had) || !!v.bearer_token_env_var;
  if (c) return { name: clip(name, 60), from, transport: v.type === 'sse' ? 'sse' : 'http', url: c.url, secrets };
  if (v.command) return { name: clip(name, 60), from, transport: 'stdio', command: path.basename(String(v.command)).slice(0, 80), secrets };
  return null;
}
export function tomlMcp(text) {   // Codex config.toml 의 [mcp_servers.<이름>] 칸만(작은 읽기 — 다른 칸은 안 봄)
  const out = {}; let cur = null;
  for (const raw of String(text).split('\n')) {
    const l = raw.trim(); if (!l || l.startsWith('#')) continue;
    const h = /^\[mcp_servers\.(?:"([^"]+)"|([^".\]]+))(\.[\w-]+)?\]$/.exec(l); if (h) h[2] = h[1] || h[2];
    if (h) { cur = h[3] ? null : (out[h[2]] ||= {}); if (h[3] === '.env' || h[3] === '.headers' || h[3] === '.http_headers') out[h[2]] && ((out[h[2]][h[3].slice(1) === 'env' ? 'env' : 'headers'] = { x: 1 })); continue; }
    if (l.startsWith('[')) { cur = null; continue; }
    const kv = /^([\w-]+)\s*=\s*(.*)$/.exec(l); if (!cur || !kv) continue;
    const v = kv[2].trim();
    if (kv[1] === 'command' || kv[1] === 'url' || kv[1] === 'bearer_token_env_var') { const s = /^"((?:[^"\\]|\\.)*)"/.exec(v); if (s) cur[kv[1]] = s[1]; }
    if ((kv[1] === 'env' || kv[1] === 'http_headers' || kv[1] === 'headers') && /\S/.test(v.replace(/[{}\s]/g, ''))) cur[kv[1] === 'env' ? 'env' : 'headers'] = { x: 1 };
  }
  return out;
}
export function collectMcp(cwds = []) {
  const out = [], add = (obj, from) => { for (const [n, v] of Object.entries(obj || {})) { const e = mcpEntry(n, v, from); if (e) out.push(e); } };
  const h = home();
  const claudeJson = [path.join(h, '.claude.json'), ...claudeDirs().map(d => path.join(d, '.claude.json'))];
  for (const f of [...new Set(claudeJson)]) { const j = readJson(f); if (!j) continue; add(j.mcpServers, 'Claude Code'); for (const p of Object.values(j.projects || {}).slice(0, 200)) add(p?.mcpServers, 'Claude Code'); }
  for (const c of [...new Set(cwds)].slice(0, 60)) add(readJson(path.join(c, '.mcp.json'))?.mcpServers, 'Claude Code(프로젝트)');
  try { add(tomlMcp(readFileSync(path.join(process.env.CODEX_HOME || path.join(h, '.codex'), 'config.toml'), 'utf8')), 'Codex'); } catch {}
  add(readJson(path.join(h, '.cursor', 'mcp.json'))?.mcpServers, 'Cursor');
  add(readJson(path.join(h, '.gemini', 'settings.json'))?.mcpServers, 'Gemini CLI');
  const seen = new Set();
  return out.filter(e => { const k = `${e.name}|${e.url || e.command}`; if (seen.has(k) || /^(boarder|bridge|0bridge)$/i.test(e.name)) return false; seen.add(k); return true; }).slice(0, 80);
}

export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(String(text).replace(/\r/g, '')); const o = {};
  if (!m) return { meta: o, body: String(text) };
  for (const l of m[1].split('\n')) { const kv = /^([\w-]+):\s*(.*)$/.exec(l); if (kv) o[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim(); }
  return { meta: o, body: m[2] };
}
const firstPara = body => clip(body.split(/\n\s*\n/).map(s => s.replace(/^#+\s.*$/gm, '').trim()).find(Boolean) || '', 400);
export function collectRoles(cwds = []) {
  const out = [], dirs = new Set([...claudeDirs().map(d => path.join(d, 'agents')), ...[...new Set(cwds)].slice(0, 60).map(c => path.join(c, '.claude', 'agents'))]);
  for (const d of dirs) for (const f of ls(d)) {
    if (!f.endsWith('.md')) continue;
    let t = ''; try { t = readFileSync(path.join(d, f), 'utf8').slice(0, 20000); } catch { continue; }
    const { meta, body } = frontmatter(t);
    out.push({ name: clip(meta.name || f.replace(/\.md$/, ''), 60), from: 'Claude Code 서브에이전트', description: clip(safe(meta.description || firstPara(body)), 400), model: clip(meta.model || '', 60), tools: clip(meta.tools || '', 200), path: path.join(d, f).replace(home(), '~') });
  }
  const cfg = readJson(path.join(process.env.BOARDER_HOME || path.join(home(), '.config', 'boarder'), 'engine.json'), {}) || {};
  for (const [name, d] of Object.entries(cfg.custom || {})) {
    const base = d?.dir || (d?.exec && path.dirname(d.exec)); if (!base) continue;
    const cand = [...['TEAMLEAD.md', 'ROLE.md', 'ROLES.md'].map(f => path.join(base, f)), ...ls(path.join(base, 'roles')).filter(f => f.endsWith('.md')).map(f => path.join(base, 'roles', f))];
    for (const f of cand) {
      if (!existsSync(f)) continue;
      const { meta, body } = frontmatter(readFileSync(f, 'utf8').slice(0, 20000));
      const h1 = /^#\s+(.+)$/m.exec(body)?.[1];
      out.push({ name: clip(meta.name || h1 || path.basename(f, '.md'), 60), from: `하네스 ${name}`, description: clip(safe(meta.description || firstPara(body)), 400), model: clip(meta.model || '', 60), tools: clip(meta.tools || '', 200), path: f.replace(home(), '~') });
    }
  }
  return out.slice(0, 80);
}

export async function collect({ days = 7, setup = false, gh = true } = {}) {
  LIVE = undefined;
  const windows = await collectWindows();
  const sessions = [...claudeSessions(days), ...codexSessions(days)];
  const sess = new Map(sessions.map(s => [s.key, s]));
  for (const w of windows) { const s = sess.get(w.session); if (s) { w.repo ||= s.repo; w.branch ||= s.branch; } else if (w.cwd) { w.repo ||= repoOf(w.cwd); w.branch ||= branchOf(w.cwd); } w.refs = branchRefs(w.branch, w.repo); }
  const todos = claudeTodos(new Set(sessions.filter(s => s.engine === 'claude').map(s => s.key.split(':')[2])));
  const tasks = await harnessTasks();
  const ths = await threads([...sessions, ...tasks, ...windows], { gh });
  const all = [...windows, ...tasks, ...sessions, ...todos, ...ths], items = all.slice(0, 600), cut = new Set(all.slice(600).map(i => i.kind));
  const body = { host: host(), kinds: ['window', 'session', 'thread', 'todo', ...(tasks.ok ? ['task'] : [])].filter(k => !cut.has(k)), items };
  if (setup) { const cwds = [...windows, ...sessions].map(i => i.cwd).filter(Boolean); body.connectors = collectMcp(cwds); body.roles = collectRoles(cwds); }
  try { body.features = await (await import('./view.mjs')).features(); } catch {}   // 이 기기에서 켠 것(보고 · 엔진) — 설정 칸 단추
  return body;
}

async function api(method, p, body) {
  const d = loadDevice(); if (!d?.token) { const e = new Error('This machine is not set up for Boarder yet — run `boarder setup --yes`.'); e.code = 'NO_DEVICE'; throw e; }
  const r = await fetch(`${server()}${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${d.token}` }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  if (r.status === 401) { const e = new Error('This device was revoked or signed out — run `boarder setup --yes` again.'); e.code = 'REVOKED'; throw e; }
  const j = await r.json().catch(() => ({ error: `Boarder ${r.status}` }));
  if (!r.ok) throw new Error(j.error || `Boarder ${r.status}`);
  return j;
}

// background: 서비스 · 타이머가 부른 것 — 도는 사이 --stop 이 오면 올리지 않고, 이미 올렸으면 빈 목록으로 되돌림
export async function importOnce({ setup = false, days = 7, print = false, quiet = false, gh = true, background = false } = {}) {
  const body = await collect({ days, setup, gh });
  if (background && stopped()) return null;
  if (print) console.log(JSON.stringify(body, null, 2));
  const j = await api('POST', '/api/import', body);
  if (background && stopped()) { await api('POST', '/api/import', EMPTY()); return null; }
  writeSecret(importMark(), { at: Date.now(), days, nodes: j.nodes });   // 들여오기를 켠 기기 — 감시 타이머(watch)가 5분마다 이어서 들여옴
  if (!quiet) {
    const by = Object.entries(j.states || {}).map(([k, n]) => `${({ turn: 'your turn', blocked: 'blocked', working: 'running', idle: 'idle', parked: 'parked', done: 'done' })[k] || k} ${n}`).join(' · ');
    const c = body.items.reduce((a, i) => ({ ...a, [i.kind]: (a[i.kind] || 0) + 1 }), {});
    console.log(`✓ imported ${c.window || 0} windows · ${c.session || 0} sessions · ${c.thread || 0} threads · ${(c.todo || 0) + (c.task || 0)} to-dos → ${j.nodes} nodes (${by || 'none'})`);
    console.log(`  check: missing ${j.audit.missing} · fixed ${j.audit.fixed + j.audit.moved}${j.audit.mixed ? ` · mixed-repo nodes ${j.audit.mixed}` : ''}`);
    if (setup) console.log(`  MCP servers ${body.connectors.length} · roles ${body.roles.length}${j.proposal_card ? ` → a card on your board asks to move them (card ${j.proposal_card})` : ''}`);
    console.log(`  see it: ${j.url}`);
  }
  return j;
}

const H2 = host;
async function ownPark(h) {
  // 사람 tmux 판의 Claude Code 를 끝냄(/exit) — 대화는 세션 기록에 남아 같은 id 로 다시 열림
  const pane = h.pane; if (!pane) throw new Error('no pane');
  run('tmux', ['send-keys', '-t', pane, 'Escape']); await sleep(300);
  run('tmux', ['send-keys', '-t', pane, '-l', '/exit']); await sleep(200); run('tmux', ['send-keys', '-t', pane, 'Enter']);
  for (let i = 0; i < 40; i++) { await sleep(500); const pid = +run('tmux', ['display', '-p', '-t', pane, '#{pane_pid}'], 2000).trim(); if (!pid || !agentUnder(pid, procTable())) return { ...h, parked_at: Date.now() }; }
  throw new Error('the window did not exit');
}
const resumeArgv = h => h.tool === 'codex' ? ['codex', 'resume', h.session_id] : [...(h.config_dir ? ['env', `CLAUDE_CONFIG_DIR=${h.config_dir}`] : []), 'claude', '--resume', h.session_id];
async function ownReopen(h, text) {
  const argv = [...resumeArgv(h), ...(text ? [text] : [])];
  const has = s => { try { execFileSync('tmux', ['has-session', '-t', s], { stdio: 'ignore', timeout: 2000 }); return true; } catch { return false; } };
  const t = h.tsession && has(h.tsession) ? ['-t', `${h.tsession}:`] : [];
  const pane = run('tmux', ['new-window', '-d', ...t, '-P', '-F', '#{pane_id}', '-n', String(h.name || 'agent').slice(0, 30), '-c', h.cwd || home(), '--', ...argv], 5000).trim();
  if (!pane) throw new Error('could not open a tmux window');
  return { pane };
}
async function doCmd(cmd) {
  const a = cmd.args || {}, h = a.handle || {}, E = await engine();
  const viaEngine = h.engine && !['tmux-own', 'herdr-own', 'terminal', 'report'].includes(h.engine);
  if (cmd.verb === 'feature') {   // 설정에서 켜고 끔(보고 · 엔진) — 그 사람이 누른 것만
    const V = await import('./view.mjs');
    if (!['report', 'engine'].includes(a.what)) throw new Error('unknown feature');
    const r = await (a.on ? V.enable : V.disable)(a.what, { log: () => {} });
    return { features: await V.features(), ok: r.ok };
  }
  if (cmd.verb === 'focus') {
    if (h.engine === 'herdr-own') { herdrCall(['agent', 'focus', h.pane]); return {}; }
    if (h.engine === 'tmux-own' && h.pane) { run('tmux', ['select-window', '-t', h.pane]); run('tmux', ['select-pane', '-t', h.pane]); return {}; }
    throw new Error('Boarder cannot bring this window to the front');
  }
  if (cmd.verb === 'send') {
    if (h.engine === 'herdr-own') {
      // 사람이 그 창에 치고 있으면 안 넣음(엔진 Herdr 어댑터와 같은 확인), 묻는 창은 Herdr 가 거절
      let raw = ''; try { raw = execFileSync('herdr', ['pane', 'read', h.pane, '--source', 'visible', '--format', 'ansi'], { encoding: 'utf8', timeout: 8000 }); } catch { throw new Error('could not read that window — try again'); }
      const T = await import('./engine/tmux.mjs').catch(() => null);
      if (T?.inputBox?.(raw)) throw new Error('someone is typing in that window — try again in a moment');
      const t = String(a.text).replace(/\r?\n/g, ' ');
      try { herdrCall(['agent', 'prompt', h.pane, t.startsWith('-') ? ' ' + t : t], 20000); }
      catch (e) { throw new Error(e.code === 'agent_blocked' ? 'that window is asking something right now — answer it there first' : e.code === 'agent_not_found' ? 'the AI tool in that window has stopped' : e.message); }
      return {};
    }
    if (viaEngine && E) { await E.run('send', { id: h.id, engine: h.engine, text: a.text }); return {}; }
    if (h.pane) {
      const pid = +run('tmux', ['display', '-p', '-t', h.pane, '#{pane_pid}'], 2000).trim();
      if (!pid || !agentUnder(pid, procTable())) throw new Error('the AI tool in that window has stopped — answer it there');
      if (paneState(capture(h.pane)) === 'question') throw new Error('that window is asking something right now — try again after it is answered');
      run('tmux', ['send-keys', '-t', h.pane, '-l', a.text]); await sleep(300); run('tmux', ['send-keys', '-t', h.pane, 'Enter']); return {};
    }
    throw new Error('this window has no way in (open it in tmux or answer with boarder wait)');
  }
  if (['park', 'reopen', 'move'].includes(cmd.verb) && !viaEngine) { const V = await import('./view.mjs'); if (!(await V.features()).engine) throw new Error('turn on the Boarder engine for this machine first (Boarder › 기기에서 보더가 하는 일)'); }
  if (cmd.verb === 'park') {
    if (viaEngine && E) { const r = await E.run('park', { id: h.id, engine: h.engine }); return { state: 'parked', handle: r.handle || h }; }
    if (h.engine === 'tmux-own') return { state: 'parked', handle: await ownPark(h) };
    throw new Error('close this terminal window yourself — Boarder cannot park it');
  }
  if (cmd.verb === 'reopen') {
    if (viaEngine && E) { await E.run('reopen', { handle: h, engine: h.engine, text: a.text || '', id: h.id }); return { state: 'working' }; }
    if (h.engine === 'tmux-own' && h.session_id) { const r = await ownReopen(h, a.text); return { state: 'working', handle: { ...h, pane: r.pane } }; }
    throw new Error('no way to reopen this window');
  }
  if (cmd.verb === 'move') {
    if (!E?.run) throw new Error('the Boarder tmux engine is not installed here — run `boarder engine setup`');
    if (!h.session_id) throw new Error('could not find this window\'s conversation — save it with `boarder session save` first');
    if (h.park === false) throw new Error('close this terminal window first, then move it');
    if (viaEngine) await E.run('park', { id: h.id, engine: h.engine });
    else if (h.engine === 'tmux-own') await ownPark(h);
    // 2) 우리 tmux 엔진에서 같은 대화로 다시 열기
    const id = `ew_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const spec = { id, name: clip(a.title || h.name || id, 40), cwd: h.cwd, session_id: h.session_id, resume: true, ...(h.tool === 'codex' || h.config_dir ? { argv: resumeArgv(h) } : {}) };
    const r = await E.run('open', { engine: 'tmux', spec });
    return { state: 'working', id: r.id || id, key: `window:${H2()}:${r.id || id}`, win: `${H2()}:${r.id || id}`, session: `session:${h.tool || 'claude'}:${h.session_id}`, cwd: h.cwd, title: spec.name,
      handle: { engine: 'tmux', ...spec, session_id: r.session_id || h.session_id } };
  }
  throw new Error(`unknown command ${cmd.verb}`);
}
export async function drainOnce({ quiet = false } = {}) {
  const { cmds } = await api('GET', '/api/device/cmds');
  for (const c of cmds || []) {
    let out;
    try { const item = await doCmd(c); out = { ok: true, item }; if (!quiet) console.log(`✓ ${c.verb} ${c.args?.title || c.args?.item || ''}`); }
    catch (e) { out = { ok: false, error: String(e?.message || e).slice(0, 300) }; if (!quiet) console.error(`✗ ${c.verb}: ${out.error}`); }
    await api('POST', `/api/device/cmds/${encodeURIComponent(c.id)}`, out).catch(e => console.error(e.message));
  }
  return (cmds || []).length;
}

export const IMPORT_HELP = `Bring your current work in (keeps your own harness)
  boarder import [--setup] [--days 7] [--print] [--no-gh]   windows · sessions · threads · to-dos → nodes on your board (--setup also reads your MCP servers and roles once)
  boarder import --follow           keep it fresh (every minute) and carry out board commands: move to the Boarder engine · park · reopen · answers into the window
  boarder import --stop             stop importing from this machine and mark what it sent as gone on your board (also turns off the Boarder reader here; \`boarder setup\` turns it back on)`;

const importMark = () => path.join(dir(), 'import.json');
const stopped = () => !!readJson(importMark())?.stopped;
const EMPTY = () => ({ host: host(), kinds: ['window', 'session', 'thread', 'todo', 'task'], items: [] });
export async function importStop() {
  const off = (await import('./view.mjs')).removeFollow();
  writeSecret(importMark(), { stopped: Date.now() });
  await api('POST', '/api/import', EMPTY());
  console.log('✓ import stopped on this machine. What it sent is marked gone on your board; nodes left empty close on their own (6 hours by default, later if they still hold an open question). Parked windows and tasks stay. `boarder import` turns it back on.');
  if (off.length) console.log('  The Boarder reader on this machine is off too, so board buttons no longer reach it. `boarder setup` turns it back on.');
}

export async function importCommand(flags) {
  if (flags.stop) return importStop();
  if (flags.follow && stopped()) return console.log('import is stopped on this machine — run `boarder import` once to turn it back on');
  const opt = { days: Number(flags.days) || 7, print: !!flags.print, gh: !flags['no-gh'] };
  if (!flags.follow) return importOnce({ ...opt, setup: !!flags.setup });
  let last = 0, first = true, watched = 0;
  for (;;) {
    if (stopped()) return console.log('import stopped');   // boarder import --stop
    try {
      // 기기 상태(설정 › 기기)도 이 서비스가 5분마다 — 보기 전용 기본엔 따로 타이머가 없음
      if (Date.now() - watched > 300_000) { watched = Date.now(); try { const W = await import('./watch.mjs'); await W.sendMetrics(); } catch (e) { if (e.code === 'NO_DEVICE' || e.code === 'REVOKED') throw e; } }
      const n = await drainOnce();
      if (first || n || Date.now() - last > 60_000) { await importOnce({ ...opt, setup: first && !!flags.setup, quiet: !first, print: false, background: true }); last = Date.now(); first = false; }
    } catch (e) { if (e.code === 'NO_DEVICE' || e.code === 'REVOKED') throw e; console.error(e.message); }
    await sleep(5000);
  }
}

/** 감시 타이머(boarder watch --once) 끝에: 들여오기를 켠 기기만 이어서 들여오고 · 밀린 명령을 함. 실패해도 감시는 그대로 */
export async function watchTick() {
  const st = readJson(importMark()); if (!st || st.stopped) return;
  try { await drainOnce({ quiet: true }); await importOnce({ quiet: true, days: st.days || 7, background: true }); } catch (e) { console.error(`import: ${e.message}`); }
}
