import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDevice, server } from './config.mjs';
import { windowKey, windowToken } from './window.mjs';
import { setup, restore, found, configured, TOOLS } from './setup.mjs';
import { mcp } from './mcp.mjs';
import { profileCommand, PROFILE_HELP } from './profile.mjs';
import { sessionCommand, SESSION_HELP } from './session.mjs';
import { watchCommand, WATCH_HELP } from './watch.mjs';
import { connectCommand } from './connect.mjs';
import { importCommand, IMPORT_HELP } from './importer.mjs';
import { engineCommand, ENGINE_HELP } from './engine/cmd.mjs';
import { enable, disable, uninstall, VIEW_HELP } from './view.mjs';

const VERSION = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version;
const KIND = { 시작: 'start', 진행: 'progress', 막힘: 'blocked', 끝: 'done', 결정: 'decision', 장애: 'incident', 마감: 'deadline' };
const HELP = `boarder ${VERSION} — Boarder for your AI tools

Set up
  boarder setup [--yes] [--server <url>] [--only claude,codex,cursor,gemini] [--device-auth] [--no-browser] [--no-watch] [--report] [--engine]
                                    signs in and reads — changes nothing in your AI tools, harness or shell files
  boarder status                    sign-in, this window, what Boarder may do here
  boarder restore                   remove Boarder from your AI tools (keeps your other settings)

${VIEW_HELP}

Report (from an AI tool's session)
  boarder log <start|progress|blocked|done|decision|incident|deadline> "<one line>" [--evidence <url>]...
  boarder ask "<question>" --choice "<A>" --choice "<B>" [--rec A] [--wait <s>]
  boarder wait <card id> [--timeout <s>]      exit 0 = answered or closed, 2 = timed out
  boarder close <card id> "<how it was handled>"
  boarder say <card id> "<text>"
  boarder status "<what this window is doing, 40 chars>"
  boarder cards ["<words>"] [--limit 15]
  boarder feedback "<text>" [--kind bug|idea|other]   feedback about Boarder to the people who make it

Main bot (the Primary chat on your board)
  boarder chat "<text>"                       answer the human in the Primary chat
  boarder role draft --name "<name>" --brief "<one line>" --instructions "<what it does, what it must not do>" [--cwd <folder>]
                                              put a role draft card in the chat (the human approves it, Boarder opens its window)
  boarder role list                           roles and their windows
  boarder headers                   MCP headers (JSON) for this window
  boarder mcp                       stdio MCP server (setup adds it to your tools)

${IMPORT_HELP}

${WATCH_HELP}

${ENGINE_HELP}

Connect a service (Linear, Notion, GitHub, any MCP server)
  boarder connect <service|https MCP URL> [--label <second account>] [--open]

${SESSION_HELP}`;

const SECTION_HELP = { import: IMPORT_HELP, watch: WATCH_HELP, engine: ENGINE_HELP, session: SESSION_HELP, profile: PROFILE_HELP, enable: VIEW_HELP, disable: VIEW_HELP, uninstall: VIEW_HELP };
function wantsHelp(cmd, rest) {
  if (cmd === 'engine' && rest[0] === 'verify') return false;
  if (cmd === 'profile' && rest[0] === 'run') return rest[1] === '--help' || rest[1] === '-h';
  return rest.some(a => a === '--help' || a === '-h');
}

function parse(rest) {
  const flags = {}, pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (['yes', 'no-browser', 'device-auth', 'me', 'help', 'version', 'once', 'print', 'no-watch', 'setup', 'follow', 'no-gh', 'no-engine', 'no-service', 'allow-remote', 'report', 'engine', 'stop'].includes(k)) { flags[k] = true; continue; }
    const v = rest[++i];
    if (['choice', 'evidence'].includes(k)) (flags[k] ||= []).push(v); else flags[k] = v;
  }
  return { flags, pos };
}

async function callJson(tool, args) {
  let w = await windowToken();
  const go = t => fetch(`${server()}/api/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(process.env.BOARDER_CHANNEL ? { 'x-boarder-channel': process.env.BOARDER_CHANNEL } : {}) }, body: JSON.stringify(args), signal: AbortSignal.timeout(90000) });
  let r = await go(w.token);
  if (r.status === 401) { w = await windowToken({ fresh: true }); r = await go(w.token); }
  const j = await r.json().catch(() => ({ error: `Boarder ${r.status}` }));
  if (!r.ok) throw new Error(j.error || String(r.status));
  return j;
}
async function call(tool, args) {
  for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k];
  let w = await windowToken();
  const go = t => fetch(`${server()}/api/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(process.env.BOARDER_CHANNEL ? { 'x-boarder-channel': process.env.BOARDER_CHANNEL } : {}) }, body: JSON.stringify(args), signal: AbortSignal.timeout(660000) });
  let r = await go(w.token);
  if (r.status === 401) { w = await windowToken({ fresh: true }); r = await go(w.token); }
  const j = await r.json().catch(() => ({ error: `Boarder ${r.status}` }));
  if (!r.ok) { console.error(j.error || r.status); process.exit(1); }
  console.log(JSON.stringify(j));
  if (tool === 'inbox_wait' && j.state === 'open') process.exit(2);
}
async function waitLong(cardId, timeoutS) {
  const until = Date.now() + timeoutS * 1000;
  for (;;) {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    let j; try { j = await callJson('inbox_wait', { card_id: cardId, timeout_s: Math.min(50, left) }); } catch (e) { if (Date.now() > until) throw e; await new Promise(r => setTimeout(r, 5000)); continue; }
    if (j.state !== 'open' || Date.now() >= until) { console.log(JSON.stringify(j)); if (j.state === 'open') process.exit(2); return; }
  }
}

async function status() {
  const d = loadDevice(), srv = server(), ok = s => `✓ ${s}`, todo = (s, fix) => `● ${s}${fix ? `  → ${fix}` : ''}`;
  const lines = [`Boarder ${VERSION} · ${srv}`];
  let me = null;
  if (d?.token) { try { const r = await fetch(`${srv}/api/device/me`, { headers: { authorization: `Bearer ${d.token}` }, signal: AbortSignal.timeout(15000) }); me = r.ok ? await r.json() : null; } catch {} }
  lines.push(me ? ok(`signed in as ${me.email} (device ${me.device.name || me.device.id}${me.scope === 'watch' ? ', watch only' : ''})`) : todo(d?.token ? 'this device was revoked or the server is unreachable' : 'not signed in', 'boarder setup --yes [agent]'));
  const tools = found();
  if (!tools.length) lines.push(todo('no AI tools found', 'install Claude Code, Codex, Cursor or Gemini CLI [you]'));
  // 보기 · 누르기 전용이 기본 — 도구에 안 넣은 건 할 일이 아님(켜려면 boarder enable report)
  for (const t of tools) lines.push(configured(t) ? ok(`${TOOLS[t].label}: reports to Boarder`) : `· ${TOOLS[t].label}: view only (unchanged) — \`boarder enable report\` lets it report`);
  const w = windowKey();
  if (me) { try { await windowToken(); lines.push(ok(`this window: ${w.name}`)); } catch (e) { lines.push(todo(`this window: ${e.message}`)); } }
  else lines.push(todo(`this window: ${w.name} (needs sign-in)`));
  console.log(lines.join('\n'));
  if (!me) process.exitCode = 1;
}

export async function main(argv) {
  const [cmd, ...rest] = argv, { flags, pos } = parse(rest);
  try {
    if (!cmd || cmd === '--help' || cmd === '-h') return console.log(HELP);
    if (cmd === 'help') return console.log(SECTION_HELP[pos[0]] || HELP);
    if (wantsHelp(cmd, rest)) return console.log(SECTION_HELP[cmd] || HELP);
    if (cmd === '--version' || cmd === '-v' || cmd === 'version') return console.log(VERSION);
    if (cmd === 'profile') return await profileCommand(rest);
    if (cmd === 'connect') return connectCommand(pos, flags);
    if (cmd === 'session') return await sessionCommand(pos[0], pos.slice(1), flags);
    if (cmd === 'setup') return await setup({ yes: !!flags.yes, server: flags.server, only: flags.only?.split(',').map(s => s.trim()), noBrowser: !!flags['no-browser'], deviceAuth: !!flags['device-auth'], noWatch: !!flags['no-watch'], noEngine: !!flags['no-engine'], report: !!flags.report, engine: !!flags.engine });
    if (cmd === 'enable' || cmd === 'disable') { if (!['report', 'engine'].includes(pos[0])) { console.error(VIEW_HELP); process.exit(64); } if (cmd === 'enable' && !loadDevice()?.token) { console.error('not signed in — run `boarder setup --yes` first'); process.exit(3); } const r = await (cmd === 'enable' ? enable : disable)(pos[0]); console.log(`${pos[0]}: ${cmd === 'enable' ? 'on' : 'off'}`); if (!r.ok) process.exitCode = 1; return; }
    if (cmd === 'uninstall') return void await uninstall();
    if (cmd === 'engine') return await engineCommand(pos[0], pos.slice(1), flags);
    if (cmd === 'watch') return await watchCommand(pos[0], flags);
    if (cmd === 'import') return await importCommand(flags);   // 들여오기 · 경우 (가)(A-2 · A-3 · A-4)
    if (cmd === 'restore') return await restore(pos[0]);
    if (cmd === 'mcp') return await mcp();
    if (cmd === 'status' && !pos.length) return await status();
    if (cmd === 'headers') { const w = await windowToken(); return console.log(JSON.stringify({ Authorization: `Bearer ${w.token}` })); }
    if (cmd === 'hook' && pos[0] === 'session-start') {
      let note = 'Boarder: report this session on the human\'s board — `boarder log start|progress|blocked|done "<one line>"`, decisions with `boarder ask` (skill: boarder).';
      try { await windowToken(); } catch (e) { note = `Boarder: ${e.message}`; }
      return console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: note } }));
    }
    const num = v => v === undefined ? undefined : Number(v);
    const plan = {
      ask: () => ['inbox_ask', { question: pos[0], choices: flags.choice || [], recommend: flags.rec, urgency: flags.urgency, body: flags.body, due: flags.due, wait_s: num(flags.wait) }],
      wait: () => ['inbox_wait', { card_id: pos[0], timeout_s: num(flags.timeout) ?? 600 }],
      log: () => ['inbox_log', { kind: KIND[pos[0]] || pos[0], text: pos[1], unblocks: flags.me ? 'me' : undefined, evidence: flags.evidence }],
      close: () => ['inbox_close', { card_id: pos[0], done: pos[1] }],
      say: () => ['inbox_say', { thread_id: pos[0], text: pos[1] }],
      status: () => ['inbox_status', { text: pos[0] }],
      cards: () => ['inbox_cards', { query: pos[0], limit: num(flags.limit) }],
      feedback: () => ['feedback_send', { text: pos.join(' '), kind: flags.kind }],
      chat: () => ['chat_say', { text: pos.join(' ') }],
      role: () => pos[0] === 'draft' ? ['role_draft', { name: flags.name, brief: flags.brief, instructions: flags.instructions, cwd: flags.cwd }] : pos[0] === 'list' ? ['role_list', {}] : null,
    }[cmd];
    const p = plan?.();
    if (!p) { console.error(HELP); process.exit(64); }
    if (p[0] === 'inbox_wait' && p[1].timeout_s > 50) return await waitLong(p[1].card_id, p[1].timeout_s);
    await call(...p);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(e?.code === 'NO_DEVICE' || e?.code === 'REVOKED' ? 3 : 1);
  }
}
