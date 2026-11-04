import path from 'node:path';
import { closeSync, fstatSync, openSync, readSync, renameSync, writeFileSync } from 'node:fs';
import { dir, ensureDir, readJson, sha } from './config.mjs';
import { redact } from './redact.mjs';

export const REPLY_MAX = 3000;   // 서버 inbox_log reply 상한과 같음(apps/web/worker/mcp/tools.ts REPLY_MAX)
const TTL = 6 * 3600_000;        // 오래 걸린 턴도 — 그보다 오래된 표지는 버림
const NEAR = [-5_000, 120_000];  // 글이 아주 다르게 남아도(긴 붙여넣기 등) 그 턴을 연 입력 시각이 표지 뒤 2분 안이면 같은 것으로
const norm = t => String(t || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);   // Herdr 는 줄바꿈을 빈칸으로 넣음
const file = () => path.join(dir(), 'turns.json');
const load = now => (readJson(file(), []) || []).filter(m => m && now - m.at < TTL && Array.isArray(m.k));
const MARKS_MAX = 50, REPLIES_MAX = 50;
const save = list => { ensureDir(dir()); const f = file(), tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify([...list.filter(m => !m.reply).slice(-MARKS_MAX), ...list.filter(m => m.reply).slice(-REPLIES_MAX)]), { mode: 0o600 }); renameSync(tmp, f); };
const ids = keys => [...new Set(keys.filter(Boolean).map(k => sha(String(k)).slice(0, 24)))];

export function markTurn(keys, text, now = Date.now()) {
  const k = ids(keys); if (!k.length) return;
  save([...load(now), { k, h: sha(norm(text)), head: parseHead(text), at: now }]);
}
/** 이 창(열쇠들)에 남은 표지가 있나 — 없으면 기록(jsonl)을 읽을 까닭이 없음(보드에서 온 턴이 아님) */
export function hasMark(keys, now = Date.now(), { within } = {}) {
  const k = ids(keys); if (!k.length) return false;
  return load(now).some(m => m.h && m.k.some(x => k.includes(x)) && (!within || now - m.at < within));   // within: 막 넣은 표지만(엔진 대기열 — 넣은 글을 Claude 가 아직 안 집은 틈)
}
export const FRESH = NEAR[1];   // 넣은 뒤 이 안의 표지 = 아직 턴이 안 끝났을 수 있음(엔진 대기열이 다음 글을 미룸)
/** 그 턴 입력에 든 보드 글의 표지를 소비. 맞는 글이 없으면 가장 가까운 입력 시각의 표지 하나만.
 *  text = 글 하나(Claude 입력 · 묶음) 또는 글 목록(Codex input-messages — 보드 글과 사람이 친 글이 섞일 수 있어 글마다 따로 맞춤) */
function takeMark(keys, text, at, now = Date.now()) {
  const k = ids(keys), list = load(now);
  const owned = m => m.k.some(x => k.includes(x)), mine = m => m.h && owned(m);
  const msgs = (Array.isArray(text) ? text : [text]).map(t => String(t ?? '')).filter(t => t.trim());
  const used = new Set(), matches = [];
  const take = (h, order) => { const i = list.findIndex((m, j) => mine(m) && m.h === h && !used.has(j)); if (i < 0) return false; used.add(i); matches.push({ m: list[i], i, order }); return true; };
  let order = 0;
  for (const msg of msgs) {
    // 한 번에 붙인 보드 글: 각 글의 표지를 모두 소비하고 마지막 글을 답 자리로.
    const parts = msg.split(/\n(?=\s*\[보드 · )/), hashes = parts.map(p => sha(norm(p))), whole = sha(norm(msg));
    // 한 묶음으로 넣은 표지는 하나만. 글별로 넣은 묶음은 입력에 실제 든 횟수만큼만 소비.
    // norm 은 앞 300자라 긴 묶음과 첫 글의 해시가 같을 수 있음: 이때는 글별 순서를 먼저 봄.
    if (!((parts.length === 1 || !hashes.includes(whole)) && take(whole, order++))) for (const h of hashes) take(h, order++);
  }
  if (!matches.length && at) {
    let best = Infinity, i = -1;
    list.forEach((m, j) => { const d = at - m.at; if (mine(m) && d >= NEAR[0] && d <= NEAR[1] && Math.abs(d) < best) { best = Math.abs(d); i = j; } });
    if (i >= 0) { used.add(i); matches.push({ m: list[i], i, order: 0 }); }
  }
  if (!matches.length) return null;
  const last = matches.sort((a, b) => a.order - b.order || a.m.at - b.m.at).at(-1).m;
  const replies = list.filter(m => owned(m) && m.reply && m.at >= Math.min(...matches.map(x => x.m.at)));
  save(list.filter((m, i) => !used.has(i) && !replies.includes(m)));
  const target = headTarget(last.head);
  return { ...last, said: replies.some(m => sameSpot(m.reply, target)) };
}
export function takeTurn(keys, text, at, now = Date.now()) { return !!takeMark(keys, text, at, now); }

// ── Claude Code 기록(jsonl): 그 턴을 연 사람 입력 · 그 뒤 마지막 답
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '';
const isPrompt = e => e?.type === 'user' && !e.isMeta && !e.isSidechain && e.message?.role === 'user' && (typeof e.message.content === 'string' || (Array.isArray(e.message.content) && e.message.content.some(b => b?.type === 'text') && !e.message.content.some(b => b?.type === 'tool_result')));
export function lastTurn(jsonl) {
  const rows = []; for (const l of String(jsonl).split('\n')) { if (!l.trim()) continue; try { rows.push(JSON.parse(l)); } catch {} }
  let i = rows.length - 1; while (i >= 0 && !isPrompt(rows[i])) i--;
  if (i < 0) return null;
  const p = rows[i], after = rows.slice(i + 1).filter(e => e?.type === 'assistant' && !e.isSidechain && textOf(e.message?.content).trim());
  const last = after.at(-1), id = last?.message?.id;
  // 한 답이 블록마다 줄로 나뉘어 남음(같은 message.id) — 마지막 답의 글 블록을 이어 붙임
  const reply = last ? after.filter(e => id ? e.message?.id === id : e === last).map(e => textOf(e.message.content)).join('\n').trim() : '';
  // 그 턴에 창이 스스로 그 자리에 답했나(boarder chat · say, chat_say · inbox_say) — 그러면 훅이 또 올리지 않음(두 번 보이지 않게)
  const done = new Set(rows.slice(i + 1).flatMap(e => e?.type === 'user' && Array.isArray(e.message?.content) ? e.message.content.filter(b => b?.type === 'tool_result' && !b.is_error).map(b => b.tool_use_id) : []));
  const said = rows.slice(i + 1).flatMap(e => e?.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content.filter(b => b?.type === 'tool_use' && done.has(b.id)) : []);
  return { prompt: textOf(p.message.content), at: Date.parse(p.timestamp) || 0, reply, said };
}

export const HEAD_RE = /^\[보드 · ([^\]·]{1,60}?)(?: · (스레드|카드) (\d{10}\.\d{6}))?\] ?/;
export function promptLine(prompt) {
  const s = String(prompt || '').replace(/\r/g, '');
  if (!s.trim() || HEAD_RE.test(s.trimStart()) || /^\s*[<\/]/.test(s)) return null;
  const lines = s.split('\n').map(x => x.trim()).filter(Boolean);
  let line = lines[0] || '';
  const m = /^\[[^\]]{0,160}\]\s*(.*)$/.exec(line);
  if (m) line = m[1] || lines[1] || line.slice(1, -1);
  line = redact(line).replace(/\s+/g, ' ').trim();
  if (!line) return null;
  const a = Array.from(line);
  return '요청: ' + (a.length > 60 ? a.slice(0, 59).join('') + '…' : line);
}
export function parseHead(prompt) {
  const m = HEAD_RE.exec(String(prompt || '').trimStart().split('\n')[0]); if (!m) return null;
  if (m[3] && m[2] === '스레드' && m[1] === 'Primary') return { primary: true, thread: m[3] };
  if (m[3]) return { channel: m[1], [m[2] === '카드' ? 'card' : 'thread']: m[3] };
  return m[1] === 'Primary' ? { primary: true } : { channel: m[1] };
}
/** 답을 같은 자리로: Primary → chat_say(스레드가 있으면 그 글 스레드로) · 카드 → inbox_say 카드 · 노드 스레드 → inbox_say 스레드 · 노드 채널(머리 줄 없음 포함) → inbox_log reply(예전 그대로) */
export function replyCall(prompt, text) {
  const h = prompt && typeof prompt === 'object' ? prompt : parseHead(prompt), t = String(text).replace(/^-/, '\u2010');   // say · chat 은 「-」로 시작하는 글을 안 받음 — 보이는 꼴은 같은 하이픈
  if (h?.primary) return ['chat_say', h.thread ? { text: t, thread: h.thread } : { text: t }];
  if (h?.card || h?.thread) return ['inbox_say', { thread_id: h.card || h.thread, text: t }];
  return ['inbox_log', { kind: 'reply', text }];
}
export function lastTurnOfFile(file, { first = 1 << 20, max = 64 << 20 } = {}) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    for (let n = Math.min(first, size); ; n = Math.min(n * 2, size, max)) {
      const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, size - n);
      let text = buf.toString('utf8'); if (n < size) text = text.slice(text.indexOf('\n') + 1);
      const t = lastTurn(text);
      if (t || n >= size || n >= max) return t;
    }
  } finally { closeSync(fd); }
}
export const clip = t => { const s = redact(String(t || '')).trim(); return s.length > REPLY_MAX ? s.slice(0, REPLY_MAX - 12).trimEnd() + '\n…(줄였어요)' : s; };

const WAKE_LINE = /^ {0,3}(?:\*\*)?깨움(?:\*\*)?[ \t]*[:：](?:\*\*)?[ \t]*(?:\*\*)?\d{1,2}\/\d{1,2}[ \t]+\d{1,2}:\d{2}(?:\*\*)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const blank = l => !l.trim();
export function dropWake(reply) {
  const text = String(reply ?? ''), lines = text.split('\n'), out = [];
  let fence = null, dropped = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], bare = line.replace(/\r$/, ''), f = FENCE.exec(bare);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null; out.push(line); continue; }
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) { fence = f[1]; out.push(line); continue; }
    if (!WAKE_LINE.test(bare)) { out.push(line); continue; }
    dropped = true;
    let gap = false;
    while (out.length && blank(out.at(-1))) { out.pop(); gap = true; }
    while (i + 1 < lines.length && blank(lines[i + 1])) { i++; gap = true; }
    if (gap && out.length && i + 1 < lines.length) out.push('');
  }
  return dropped ? out.join('\n') : text;
}

/** 턴 하나(입력 · 시각 · 답, 열쇠들) → 올릴 답 글(보드에서 온 턴이 아니거나 답이 없으면 null) */
export function replyFor({ keys, prompt, at, reply }) {
  if (!reply?.trim() || !prompt) return null;
  if (!takeTurn(keys, prompt, at)) return null;
  const r = dropWake(reply);
  return r ? clip(r) : null;
}

// 성공한 명시적 답만 해당 창의 같은 자리 표지에 남김(Codex notify 에는 도구 기록이 없음).
const targetOf = (tool, args) => args?.unknown ? null : tool === 'inbox_say' && args.thread_id ? `inbox:${args.thread_id}` : tool === 'chat_say' ? `primary:${args.thread || ''}` : null;
const headTarget = head => { const [tool, args] = replyCall(head, ''); return targetOf(tool, args); };
const sameSpot = (said, target) => !!target && (said === target || (target.startsWith('primary:') && said === 'primary:'));

const SAY = new Set(['inbox_say', 'chat_say']);
const bare = n => String(n || '').replace(/^mcp__.*__/, '');
const TS = /^\d{10}\.\d{6}$/;
function scriptSays(code, input) {
  const out = [], re = /tools\.call\(\s*(['"`])(inbox_say|chat_say)\1/g, at = [...code.matchAll(re)];
  at.forEach((m, n) => {
    const seg = code.slice(m.index + m[0].length, at[n + 1]?.index ?? code.length);
    const val = key => {
      const lit = new RegExp(`\\b${key}\\s*:\\s*(['"\`])(\\d{10}\\.\\d{6})\\1`).exec(seg); if (lit) return lit[2];
      const ref = new RegExp(`\\b${key}\\s*:\\s*input\\.(\\w+)\\b`).exec(seg), v = ref && input && typeof input === 'object' ? input[ref[1]] : null;
      return typeof v === 'string' && TS.test(v) ? v : null;
    };
    if (m[2] === 'inbox_say') { const id = val('thread_id'); out.push(['inbox_say', id ? { thread_id: id } : { unknown: true }]); return; }
    if (!/\bthread\b/.test(seg)) { out.push(['chat_say', {}]); return; }
    const id = val('thread'); out.push(['chat_say', id ? { thread: id } : { unknown: true }]);
  });
  return out;
}
/** 도구 호출 하나 → 그 안의 답(inbox_say · chat_say) [이름, 인자] 목록 */
export function sayCalls(tool, args) {
  const name = bare(tool), a = args && typeof args === 'object' ? args : {};
  if (SAY.has(name)) return [[name, a]];
  if (name !== 'boarder_execute_write') return [];
  const out = [], one = (t, x) => { if (SAY.has(bare(t))) out.push([bare(t), x && typeof x === 'object' ? x : {}]); };
  one(a.tool ?? a.name, a.arguments);
  if (Array.isArray(a.calls)) for (const c of a.calls) one(c?.tool ?? c?.name, c?.arguments);
  if (typeof a.code === 'string') out.push(...scriptSays(a.code, a.input));
  return out;
}
export function recordReply(keys, tool, args, now = Date.now()) {
  const targets = sayCalls(tool, args).map(([t, a]) => targetOf(t, a)).filter(Boolean); if (!targets.length) return;
  const k = ids(keys); if (!k.length) return;
  const list = load(now); if (!list.some(m => m.h && m.k.some(x => k.includes(x)))) return;
  save([...list, ...targets.map(reply => ({ k, reply, at: now }))]);
}
const SAID = /boarder\s+(chat|say)\b|chat_say|inbox_say/;   // main 의 낱말 판정 — 자리를 못 읽을 때만
function toolReplied(tools, head) {
  const target = headTarget(head); if (!target) return false;
  return tools.some(b => {
    const input = b.input || {}, calls = sayCalls(b.name, input);
    // 자리를 글자로 못 읽은 답은 main 처럼 답한 것으로(두 번 안 나가게) — 글자로 다른 자리면 안 셈
    if (calls.length) return calls.some(([t, a]) => a.unknown || (t === 'inbox_say' && !a.thread_id) || sameSpot(targetOf(t, a), target));
    const command = input.command || input.cmd || '';
    // 명령 맨 앞의 실행만 판별 — 본문에 든 명령 예시는 답으로 세지 않음.
    const m = /^\s*(?:(?:[^\s;|&]*\/)?node\s+)?(?:[^\s;|&]*\/)?boarder(?:\.mjs)?\s+(say|chat)\s+([^\n;&|]*)/.exec(command);
    // 맨 앞이 아닌 실행(cd … && boarder say · npx boarder say)은 자리를 못 읽음 — main 처럼 낱말만 보고 답한 것으로
    if (!m) return SAID.test(JSON.stringify(input));
    if (m[1] === 'say') { const id = /^['"]?(\d{10}\.\d{6})['"]?(?:\s|$)/.exec(m[2]); return id ? target === `inbox:${id[1]}` : true; }
    const id = /(?:^|\s)--thread\s+['"]?(\d{10}\.\d{6})/.exec(m[2]);
    return sameSpot(`primary:${id?.[1] || ''}`, target);
  });
}
/** 보드가 넣은 표지의 답 자리로 한 번. 사람 글 없는 턴은 null. prompt = 글 하나 또는 글 목록(Codex) */
export function replyPlan({ keys, prompt, at, reply, said = [] }) {
  if (!reply?.trim() || !(Array.isArray(prompt) ? prompt.length : prompt)) return null;
  const mark = takeMark(keys, prompt, at); if (!mark) return null;
  const head = mark.head === undefined ? parseHead(Array.isArray(prompt) ? prompt.find(p => HEAD_RE.test(String(p).trimStart())) : prompt) : mark.head;
  if (mark.said || toolReplied(said, head)) return null;
  const r = dropWake(reply);   // 깨움 줄만 있던 답이면 표지는 소비하고 아무것도 안 올림
  return r ? replyCall(head, clip(r)) : null;
}
