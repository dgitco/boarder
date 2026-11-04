import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { dir, loadDevice, readJson, server } from './config.mjs';
import { windowKey, windowToken } from './window.mjs';
import { setup, restore, targets, reportState } from './setup.mjs';
import { label } from './targets.mjs';
import { mcp } from './mcp.mjs';
import { profileCommand, PROFILE_HELP } from './profile.mjs';
import { sessionCommand, SESSION_HELP } from './session.mjs';
import { watchCommand, WATCH_HELP } from './watch.mjs';
import { connectCommand } from './connect.mjs';
import { importCommand, IMPORT_HELP } from './importer.mjs';
import { slackImport } from './slack-import.mjs';
import { canvasCommand, CANVAS_HELP } from './canvas.mjs';
import { SETTINGS_HELP, SETTINGS_COMMANDS } from './settings.mjs';
import { TASKBOARD_HELP } from './taskboard.mjs';
import { engineCommand, ENGINE_HELP } from './engine/cmd.mjs';
import { enable, disable, uninstall, VIEW_HELP } from './view.mjs';
import { secretCommand, SECRET_HELP } from './secret.mjs';
import { deviceCommand, DEVICE_HELP } from './device.mjs';

const VERSION = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version;
const KIND = { 시작: 'start', 진행: 'progress', 막힘: 'blocked', 끝: 'done', 결정: 'decision', 장애: 'incident', 마감: 'deadline' };
const HELP = `boarder ${VERSION} — Boarder for your AI tools

Set up
  boarder setup [--yes] [--server <url>] [--email <you@…>] [--only claude,codex,cursor,gemini|<folder>] [--skip <folder>] [--device-auth] [--no-browser] [--no-watch] [--report] [--engine]
                                    signs in and reads — changes nothing in your AI tools, harness or shell files
                                    (every Claude Code folder counts: ~/.claude, CLAUDE_CONFIG_DIR, ~/.claude-accounts/*/)
                                    --email: approve this machine from a card on your board (phone) or another signed-in machine — no browser here
  boarder status                    sign-in, this window, each AI tool folder and whether it reports
  boarder restore [<folder>]        remove Boarder from your AI tools, or from one folder (keeps your other settings)

${VIEW_HELP}

Report (from an AI tool's session)
  boarder log <start|progress|blocked|done|decision|incident|deadline> "<one line>" [--evidence <url>]...
  boarder ask "<question>" --choice "<A>" --choice "<B>" [--rec A] [--wait <s>] [--urgent] [--asked-at <time>] [--backlog]
                                    --urgent = phone notification: only when a person must handle it now (security incident,
                                    customer-facing outage, a schedule that must be acted on now). --asked-at / --backlog: re-posting an older question (no notification)
  boarder wait <card id> [--timeout <s>]      exit 0 = answered or closed, 2 = timed out
  boarder close <card id> "<how it was handled>"
  boarder say <card id|thread id> "<text>"
  A board message starts with a head like [보드 · <channel | Primary>( · 스레드 <id> | · 카드 <id>)] — answer in the same place:
    Primary → boarder chat · Primary · 스레드 <id> → boarder chat --thread <id> · 카드 <id> → boarder say <id> · 스레드 <id> → boarder say <id> · channel only → boarder log
  boarder status "<what this window is doing, 40 chars>"
  boarder cards ["<words>"] [--limit 15]
  boarder feedback "<text>" [--kind bug|idea|other]   feedback about Boarder to the people who make it

Main bot (the Primary chat on your board)
  boarder chat "<text>" [--thread <id>]       answer the human in the Primary chat (--thread: under their message)
  boarder split <id> --why "<one line>" --part "<node>: <text>" --part "<node>: <text>"…
                                              one Primary message with several asks → a part per node (chips on the message);
                                              each part also goes into that node's window, which answers under the message
  boarder promise add "<what>" --who "<to whom>" --check "<how you'll know>" --due YYYY-MM-DD[ HH:MM]
                                              record a promise (shows under promises; past due → to check)
  boarder promise done <id> "<how it was kept>" [--dropped]   ·   boarder promise list [--all]
  boarder role draft --name "<name>" --brief "<one line>" --instructions "<what it does, what it must not do>" [--cwd <folder>]
                                              put a role draft card in the chat (the human approves it, Boarder opens its window)
  boarder role edit <role id> [--name "<name>"] [--brief "<one line>"] [--instructions "<full instructions>"]
                                              save changes and inform the role’s live windows (this device must be allowed on the board first: boarder settings allow)
  boarder role list                           roles and their windows
  boarder headers                   MCP headers (JSON) for this window
  boarder mcp                       stdio MCP server (setup adds it to your tools)

${IMPORT_HELP}

${CANVAS_HELP}

${SETTINGS_HELP}
${TASKBOARD_HELP}

${WATCH_HELP}

${ENGINE_HELP}

${SECRET_HELP}

${DEVICE_HELP}

Connect a service (Linear, Notion, GitHub, any MCP server)
  boarder connect <service|https MCP URL> [--label <second account>] [--open]
  boarder connect <name> --key-file <file|-> [--base-url https://… --auth bearer|basic|header:<Name>|query:<name>] [--label <name>] [--write] [--no-wait]
                                    API key or mail (IMAP) from this machine: a card on your board asks you to allow it; read only unless --write

${SESSION_HELP}`;

const SECTION_HELP = { device: DEVICE_HELP, import: IMPORT_HELP, canvas: CANVAS_HELP, ...Object.fromEntries(SETTINGS_COMMANDS.map(c => [c, SETTINGS_HELP])), watch: WATCH_HELP, engine: ENGINE_HELP, session: SESSION_HELP, profile: PROFILE_HELP, secret: SECRET_HELP, enable: VIEW_HELP, disable: VIEW_HELP, harness: VIEW_HELP, view: VIEW_HELP, uninstall: VIEW_HELP, taskboard: TASKBOARD_HELP };
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
    if (['bg', 'no-enter', 'yes', 'no-browser', 'device-auth', 'me', 'help', 'version', 'once', 'print', 'no-watch', 'setup', 'follow', 'no-gh', 'no-engine', 'no-service', 'allow-remote', 'report', 'engine', 'stop', 'dry-run', 'urgent', 'backlog', 'write', 'no-wait', 'open', 'no-mask-ids', 'no-mask-pay', 'force', 'dropped', 'all', 'none'].includes(k)) { flags[k] = true; continue; }
    const v = rest[++i];
    if (['choice', 'evidence', 'fold', 'alias', 'part'].includes(k)) (flags[k] ||= []).push(v); else flags[k] = v;
  }
  return { flags, pos };
}

const csv = v => v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined;

async function callJson(tool, args) {
  let w = await windowToken();
  const go = t => fetch(`${server()}/api/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(process.env.BOARDER_CHANNEL ? { 'x-boarder-channel': process.env.BOARDER_CHANNEL } : {}) }, body: JSON.stringify(args), signal: AbortSignal.timeout(90000) });
  let r = await go(w.token);
  if (r.status === 401) { w = await windowToken({ fresh: true }); r = await go(w.token); }
  const j = await r.json().catch(() => ({ error: `Boarder ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(j.error || String(r.status)), { status: r.status });
  return j;
}
async function call(tool, args) {
  for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k];
  let w = await windowToken();
  const go = t => fetch(`${server()}/api/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(process.env.BOARDER_CHANNEL ? { 'x-boarder-channel': process.env.BOARDER_CHANNEL } : {}) }, body: JSON.stringify(args), signal: AbortSignal.timeout(660000) });
  let r = await go(w.token);
  if (r.status === 401) { w = await windowToken({ fresh: true }); r = await go(w.token); }
  const j = await r.json().catch(() => ({ error: `Boarder ${r.status}` }));
  if (!r.ok) { console.error(j.hint ? `${j.error}: ${j.hint}` : j.error || r.status); process.exit(1); }   // 허락 없음(403 not_allowed)은 안내까지 — boarder settings allow
  if (/^(?:inbox_say|chat_say|boarder_execute_write)$/.test(tool)) { const T = await import('./turn.mjs'); T.recordReply([process.env.BOARDER_WINDOW, process.env.TMUX_PANE, windowKey().key], tool, args); }   // 코드 모드 안의 답도(turn.mjs sayCalls)
  console.log(JSON.stringify(j));
  if (tool === 'inbox_wait' && j.state === 'open') process.exit(2);
}
const transient = e => e?.code !== 'NO_DEVICE' && e?.code !== 'REVOKED' && (!e?.status || e.status >= 500 || e.status === 408 || e.status === 429);
async function waitLong(cardId, timeoutS) {
  const until = Date.now() + timeoutS * 1000;
  for (;;) {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    let j; try { j = await callJson('inbox_wait', { card_id: cardId, timeout_s: Math.min(50, left) }); } catch (e) { if (Date.now() > until || !transient(e)) throw e; await new Promise(r => setTimeout(r, 5000)); continue; }
    if (j.state !== 'open' || Date.now() >= until) { console.log(JSON.stringify(j)); if (j.state === 'open') process.exit(2); return; }
  }
}

async function readStdin(ms = 3000) {
  if (process.stdin.isTTY) return '';
  let out = ''; const t = setTimeout(() => process.stdin.destroy(), ms);
  try { for await (const d of process.stdin) out += d; } catch {}
  clearTimeout(t); return out;
}
async function postReply(plan) {
  const w = await windowToken({ timeoutMs: 4000 });   // 훅 한도(setup 의 Stop 20초) 안에 — 매달린 망이어도 4 + 6초
  const [tool, args] = plan;
  const r = await fetch(`${server()}/api/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${w.token}` }, body: JSON.stringify(args), signal: AbortSignal.timeout(6000) });
  return r.ok;
}
async function turnHook(kind, arg) {
  const T = await import('./turn.mjs');
  if (!loadDevice()?.token && !process.env.BOARDER_TOKEN) return;
  if (kind === 'codex-turn') {   // Codex notify: 마지막 인자 하나가 JSON(type agent-turn-complete · thread-id · input-messages · last-assistant-message)
    let j; try { j = JSON.parse(arg || ''); } catch { return; }
    if (j?.type !== 'agent-turn-complete') return;
    const keys = [process.env.BOARDER_WINDOW, j['thread-id'], windowKey().key];
    const prompt = (Array.isArray(j['input-messages']) ? j['input-messages'] : []).filter(p => typeof p === 'string');
    const plan = T.replyPlan({ keys, prompt, at: 0, reply: j['last-assistant-message'] });
    if (plan) await postReply(plan);
    return;
  }
  let j; try { j = JSON.parse(await readStdin()); } catch { return; }
  if (!j?.transcript_path || !j?.session_id) return;
  const keys = [process.env.BOARDER_WINDOW, j.session_id, windowKey().key];
  if (!T.hasMark(keys)) return;   // 보드에서 온 턴이 아니면 기록을 읽지 않음(턴마다 수백 MB 를 읽던 것)
  // 마지막 답이 기록에 늦게 써질 수 있어 잠깐 다시 읽음. 훅이 마지막 답을 주면(last_assistant_message) 그것을 씀
  let t = null;
  for (let i = 0; i < 3; i++) {
    try { t = T.lastTurnOfFile(j.transcript_path); } catch { return; }
    if (typeof j.last_assistant_message === 'string' && j.last_assistant_message.trim() && t) t.reply = j.last_assistant_message;
    if (t?.reply) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!t) return;
  const plan = T.replyPlan({ keys, ...t });
  if (plan) await postReply(plan);   // 창이 그 턴에 스스로 boarder chat · say 로 답했으면 또 올리지 않음
}

async function promptHook() {
  if (process.env.BOARDER_PROMPT_STATUS === '0') return;
  if (!loadDevice()?.token && !process.env.BOARDER_TOKEN) return;
  let j; try { j = JSON.parse(await readStdin(1000)); } catch { return; }
  const T = await import('./turn.mjs'), text = T.promptLine(j?.prompt);
  if (!text) return;
  const w = await windowToken({ timeoutMs: 2000 });
  await fetch(`${server()}/api/agent/inbox_log`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${w.token}` }, body: JSON.stringify({ kind: 'progress', text }), signal: AbortSignal.timeout(2500) });
}

async function status() {
  const d = loadDevice(), srv = server(), ok = s => `✓ ${s}`, todo = (s, fix) => `● ${s}${fix ? `  → ${fix}` : ''}`;
  const lines = [`Boarder ${VERSION} · ${srv}`];
  let me = null;
  if (d?.token) { try { const r = await fetch(`${srv}/api/device/me`, { headers: { authorization: `Bearer ${d.token}` }, signal: AbortSignal.timeout(15000) }); me = r.ok ? await r.json() : null; } catch {} }
  lines.push(me ? ok(`signed in as ${me.email} (device ${me.device.name || me.device.id}${me.scope === 'watch' ? ', watch only' : ''})`) : todo(d?.token ? 'this device was revoked or the server is unreachable' : 'not signed in', 'boarder setup --yes [agent]'));
  const list = targets();
  if (!list.length) {
    let sdk = false; try { sdk = readJson(path.join(dir(), 'engine.json'))?.default === 'sdk'; } catch {}
    lines.push(sdk ? '· no AI tool needed here: the SDK engine runs on your own subscription (boarder engine account list)' : todo('no AI tools found', 'install Claude Code, Codex, Cursor or Gemini CLI [you]'));
  }
  // 보기 · 누르기 전용이 기본 — 도구에 안 넣은 건 할 일이 아님(켜려면 boarder enable report). 설정 폴더마다 한 줄(Claude 계정이 여럿이면 계정마다)
  for (const t of list) {
    const s = reportState(t), name = label(t);
    lines.push(s.state === 'on' ? ok(`${name}: reports to Boarder`) : s.state === 'stale' ? todo(`${name}: Boarder points to an old CLI path (${s.was})`, `boarder enable report --only ${t.id}`) : `· ${name}: view only (unchanged) — \`boarder enable report --only ${t.id}\` lets it report`);
  }
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
    if (cmd === 'connect') return await connectCommand(pos, flags);
    if (cmd === 'session') return await sessionCommand(pos[0], pos.slice(1), flags);
    if (cmd === 'setup') return await setup({ yes: !!flags.yes, server: flags.server, email: flags.email, only: csv(flags.only), skip: csv(flags.skip), noBrowser: !!flags['no-browser'], deviceAuth: !!flags['device-auth'], noWatch: !!flags['no-watch'], noEngine: !!flags['no-engine'], report: !!flags.report, engine: !!flags.engine });
    if (cmd === 'enable' || cmd === 'disable') { if (!['report', 'engine', 'harness'].includes(pos[0])) { console.error(VIEW_HELP); process.exit(64); } if (cmd === 'enable' && !loadDevice()?.token && !(pos[0] === 'harness' && flags.from)) { console.error('not signed in — run `boarder setup --yes` first'); process.exit(3); } const r = await (cmd === 'enable' ? enable : disable)(pos[0], { only: csv(flags.only), skip: csv(flags.skip), yes: !!flags.yes, name: flags.name, lang: flags.lang, from: flags.from, wrapper: flags.wrapper }); console.log(r.skipped ? `${pos[0]}: skipped (${r.skipped})` : `${pos[0]}: ${cmd === 'enable' ? 'on' : 'off'}`); if (!r.ok) process.exitCode = 1; return; }
    if (cmd === 'view' && pos[0] === 'overlay') { const { overlayCommand, OVERLAY_HELP } = await import('./overlay.mjs'); try { return void await overlayCommand(pos[1], pos.slice(2)); } catch (e) { if (e.code !== 'USAGE') throw e; console.error(OVERLAY_HELP); process.exit(64); } }   // 내 화면에만 얹는 css · js
    if (cmd === 'harness') { if (pos[0] !== 'list') { console.error(VIEW_HELP); process.exit(64); } const { listHarness } = await import('./harness.mjs'); return void await listHarness(); }
    if (cmd === 'uninstall') return void await uninstall();
    if (cmd === 'engine') return await engineCommand(pos[0], pos.slice(1), flags);
    if (cmd === 'watch') return await watchCommand(pos[0], flags);
    if (cmd === 'import' && pos[0] === 'slack') { const r = await slackImport(pos[1], flags); if (r.stopped) process.exitCode = 75; return; }   // 옛 Slack 글(채널 = 노드)
    if (cmd === 'canvas') return void await canvasCommand(pos[0], pos.slice(1), flags);
    if (SETTINGS_COMMANDS.includes(cmd)) { const { settingsCommand } = await import('./settings.mjs'); return void await settingsCommand(cmd, pos[0], pos.slice(1), flags); }   // 내 보드 설정 읽기 · 바꾸기(바꾸기는 보드에서 이 기기를 허락한 뒤 — device-settings.ts)
    if (cmd === 'taskboard') { const { taskboardCommand } = await import('./taskboard.mjs'); return void await taskboardCommand(pos[0], pos.slice(1)); }   // 태스크 현황 올리는 쪽(설정 › 기능에서 켠 계정)
    if (cmd === 'import') return await importCommand(flags);   // 들여오기 · 경우 (가)(A-2 · A-3 · A-4)
    if (cmd === 'restore') return await restore(pos[0], { only: csv(flags.only) });
    if (cmd === 'secret') return await secretCommand(pos[0], pos.slice(1), flags);
    if (cmd === 'device') return await deviceCommand(pos[0], pos.slice(1), flags);   // 승인된 기기에서 새 기기 허용(온보딩 2층)   // 비밀 넣기(값은 안 찍음)
    if (cmd === 'mcp') return await mcp();
    if (cmd === 'status' && !pos.length) return await status();
    if (cmd === 'headers') { const w = await windowToken(); return console.log(JSON.stringify({ Authorization: `Bearer ${w.token}` })); }
    if (cmd === 'hook' && ['session-start', 'stop', 'prompt'].includes(pos[0]) && /^sdk/i.test(process.env.CLAUDE_CODE_ENTRYPOINT || '')) return;
    if (cmd === 'hook' && pos[0] === 'artifact') {
      try {
        const { artifactHook } = await import('./artifact.mjs'), { canvasPut } = await import('./canvas.mjs');
        let j; try { j = JSON.parse(await readStdin()); } catch { return; }
        if (!loadDevice()?.token) return;
        await artifactHook(j, { put: (f, fl) => canvasPut(f, fl, { log: m => console.error(`boarder artifact: ${String(m).split('\n')[0]}`) }), log: m => console.error(m) });
      } catch (e) { console.error(`boarder artifact: ${e.message}`); }
      process.exit(0);   // 시간 상한에 걸려 남은 올리기 연결이 있어도 바로 끝
    }
    if (cmd === 'hook' && pos[0] === 'session-start') {
      let note = 'Boarder: report this session on the human\'s board — `boarder log start|progress|blocked|done "<one line>"`, decisions with `boarder ask` (skill: boarder).';
      try { await windowToken({ timeoutMs: 6000 }); } catch (e) { note = `Boarder: ${e.name === 'TimeoutError' ? 'the Boarder server did not answer in time — reports may fail until the network is back' : e.message}`; }
      return console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: note } }));
    }
    if (cmd === 'hook' && (pos[0] === 'stop' || pos[0] === 'codex-turn')) { await turnHook(pos[0], pos[1]).catch(() => {}); return; }
    if (cmd === 'hook' && pos[0] === 'prompt') { await promptHook().catch(() => {}); return; }
    const num = v => v === undefined ? undefined : Number(v);
    const plan = {
      ask: () => ['inbox_ask', { question: pos[0], choices: flags.choice || [], recommend: flags.rec, urgency: flags.urgency, urgent: !!flags.urgent, backlog: !!flags.backlog, asked_at: flags['asked-at'], body: flags.body, due: flags.due, wait_s: num(flags.wait) }],
      wait: () => ['inbox_wait', { card_id: pos[0], timeout_s: num(flags.timeout) ?? 600 }],
      log: () => ['inbox_log', { kind: KIND[pos[0]] || pos[0], text: pos[1], unblocks: flags.me ? 'me' : undefined, evidence: flags.evidence }],
      close: () => ['inbox_close', { card_id: pos[0], done: pos[1] }],
      say: () => ['inbox_say', { thread_id: pos[0], text: pos[1] }],
      status: () => ['inbox_status', { text: pos[0] }],
      cards: () => ['inbox_cards', { query: pos[0], limit: num(flags.limit) }],
      feedback: () => ['feedback_send', { text: pos.join(' '), kind: flags.kind }],
      split: () => ['chat_split', { thread: pos[0], ...(flags.why ? { why: flags.why } : {}), parts: (flags.part || []).map(x => { const i = String(x).indexOf(':'); return i < 0 ? { node: '', text: String(x) } : { node: String(x).slice(0, i).trim(), text: String(x).slice(i + 1).trim() }; }) }],
      chat: () => ['chat_say', { text: pos.join(' '), ...(flags.thread ? { thread: flags.thread } : {}) }],
      promise: () => pos[0] === 'add' ? ['promise_add', { who: flags.who, what: pos.slice(1).join(' '), check: flags.check, due: flags.due }] : pos[0] === 'done' ? ['promise_done', { promise_id: num(pos[1]), done: pos.slice(2).join(' '), state: flags.dropped ? 'dropped' : 'kept' }] : pos[0] === 'list' ? ['promise_list', { all: !!flags.all }] : null,
      role: () => pos[0] === 'draft' ? ['role_draft', { name: flags.name, brief: flags.brief, instructions: flags.instructions, cwd: flags.cwd }] : pos[0] === 'edit' ? ['role_edit', { role_id: pos[1], name: flags.name, brief: flags.brief, instructions: flags.instructions }] : pos[0] === 'list' ? ['role_list', {}] : null,
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
