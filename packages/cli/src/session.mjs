import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { server } from './config.mjs';
import { windowToken } from './window.mjs';

const CHUNK = 4 * 1024 * 1024;
const fail = m => { console.error(m); process.exit(1); };
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// Claude Code 의 프로젝트 폴더 이름: 경로의 글자 · 숫자 말고는 「-」
const slug = cwd => cwd.replace(/[^A-Za-z0-9]/g, '-');
function newestTranscript(cwd) {
  const d = path.join(claudeDir(), 'projects', slug(cwd));
  if (!existsSync(d)) return null;
  const fs = readdirSync(d).filter(f => f.endsWith('.jsonl')).map(f => ({ f: path.join(d, f), t: statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  return fs[0]?.f || null;
}
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

async function api(method, p, { body, headers = {} } = {}) {
  let w = await windowToken();
  const go = t => fetch(`${server()}${p}`, { method, headers: { authorization: `Bearer ${t}`, ...headers }, body, signal: AbortSignal.timeout(120000) });
  let r = await go(w.token);
  if (r.status === 401) { w = await windowToken({ fresh: true }); r = await go(w.token); }
  const j = await r.json().catch(() => ({ error: `Boarder ${r.status}` }));
  return { status: r.status, j };
}

async function save(flags) {
  const tool = flags.tool || 'claude-code';
  const file = flags.file || (tool === 'claude-code' ? newestTranscript(process.cwd()) : null) || fail('no transcript found here — pass --file <path to the .jsonl>');
  const native = path.basename(file).replace(/\.jsonl$/, '');
  const q = new URLSearchParams({ tool, native });
  const off = await api('GET', `/api/sessions/offset?${q}`); if (off.status !== 200) fail(off.j.error || off.status);
  const raw = readFileSync(file, 'utf8'), whole = raw.slice(0, raw.lastIndexOf('\n') + 1);
  const lines = whole.split('\n').slice(0, -1).map(l => l.length > CHUNK - 1024 ? JSON.stringify({ type: 'boarder-skipped', bytes: l.length }) : l);
  let from = off.j.lines, sent = 0;
  const meta = { 'x-session-tool': tool, 'x-session-native': native, 'x-session-cwd': encodeURIComponent(process.cwd()), 'x-session-repo': encodeURIComponent(git('remote', 'get-url', 'origin').replace(/^([a-z+]+:\/\/)[^@/]+@/i, '$1')) };
  while (from < lines.length) {
    let end = from, size = 0;
    while (end < lines.length && (size + lines[end].length + 1 <= CHUNK || end === from)) size += lines[end++].length + 1;
    const r = await api('POST', '/api/sessions/upload', { body: lines.slice(from, end).join('\n') + '\n', headers: { 'content-type': 'text/plain; charset=utf-8', 'x-session-from': String(from), ...meta } });
    if (r.status === 409) { from = r.j.lines; continue; }   // 다른 곳에서 먼저 올림 — 서버 위치부터
    if (r.status !== 200) fail(r.j.error || r.status);
    from = r.j.lines; sent += r.j.added;
  }
  console.log(`✓ saved ${tool}:${native} — ${sent} new messages (${lines.length} lines). Continue it anywhere: boarder session handoff ${tool}:${native}`);
}

async function tool(name, args) {
  const w = await windowToken();
  const r = await fetch(`${server()}/api/agent/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${w.token}` }, body: JSON.stringify(args), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({ error: `Boarder ${r.status}` })); if (!r.ok) fail(j.error || r.status); return j;
}

export const SESSION_HELP = `Sessions (save and continue a conversation)
  boarder session save [--file <transcript.jsonl>] [--tool claude-code|codex|gemini-cli]   this folder's latest Claude Code session by default
  boarder session ls ["<words>"]           saved sessions
  boarder session handoff <tool:id>        the session's handoff (where, how to reopen, last messages)`;

export async function sessionCommand(sub, pos, flags) {
  if (sub === 'save') return save(flags);
  if (sub === 'ls' || sub === 'list') { const j = await tool('session_search', { query: pos[0], limit: 20 }); for (const s of j.sessions || []) console.log(`${s.id}  ${s.title || ''}  · ${s.win || s.cwd || ''} · ${s.messages} msgs`); return; }
  if (sub === 'handoff') {
    const j = await tool('session_handoff', { session_id: pos[0] || fail('which session? boarder session ls') });
    console.log(j.header + '\n\n' + (j.messages || []).map(m => `**${m.who}** · ${m.at_kst}\n${m.text}`).join('\n\n'));
    return;
  }
  console.log(SESSION_HELP); process.exitCode = 1;
}
