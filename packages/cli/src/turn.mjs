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
const save = list => { ensureDir(dir()); const f = file(), tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(list.slice(-50)), { mode: 0o600 }); renameSync(tmp, f); };
const ids = keys => [...new Set(keys.filter(Boolean).map(k => sha(String(k)).slice(0, 24)))];

export function markTurn(keys, text, now = Date.now()) {
  const k = ids(keys); if (!k.length) return;
  save([...load(now), { k, h: sha(norm(text)), at: now }]);
}
/** 이 창(열쇠들)에 남은 표지가 있나 — 없으면 기록(jsonl)을 읽을 까닭이 없음(보드에서 온 턴이 아님) */
export function hasMark(keys, now = Date.now()) {
  const k = ids(keys); if (!k.length) return false;
  return load(now).some(m => m.k.some(x => k.includes(x)));
}
/** 그 턴을 연 입력(글 · 시각)이 그 창의 표지와 맞으면 표지를 지우고 true */
export function takeTurn(keys, text, at, now = Date.now()) {
  const k = ids(keys), h = sha(norm(text)), list = load(now);
  const i = list.findIndex(m => m.k.some(x => k.includes(x)) && (m.h === h || (at && at - m.at >= NEAR[0] && at - m.at <= NEAR[1])));
  if (i < 0) return false;
  list.splice(i, 1); save(list);
  return true;
}

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
  const said = rows.slice(i + 1).some(e => e?.type === 'assistant' && Array.isArray(e.message?.content) && e.message.content.some(b => b?.type === 'tool_use' && SAID.test(JSON.stringify(b.input ?? ''))));
  return { prompt: textOf(p.message.content), at: Date.parse(p.timestamp) || 0, reply, said };
}
const SAID = /boarder\s+(chat|say)\b|chat_say|inbox_say/;

export const HEAD_RE = /^\[보드 · ([^\]·]{1,60}?)(?: · (스레드|카드) (\d{10}\.\d{6}))?\] ?/;
export function parseHead(prompt) {
  const m = HEAD_RE.exec(String(prompt || '').trimStart()); if (!m) return null;
  if (m[3]) return { channel: m[1], [m[2] === '카드' ? 'card' : 'thread']: m[3] };
  return m[1] === 'Primary' ? { primary: true } : { channel: m[1] };
}
/** 답을 같은 자리로: Primary → chat_say · 카드 → inbox_say 카드 · 노드 스레드 → inbox_say 스레드 · 노드 채널(머리 줄 없음 포함) → inbox_log reply(예전 그대로) */
export function replyCall(prompt, text) {
  const h = parseHead(prompt), t = String(text).replace(/^-/, '\u2010');   // say · chat 은 「-」로 시작하는 글을 안 받음 — 보이는 꼴은 같은 하이픈
  if (h?.card || h?.thread) return ['inbox_say', { thread_id: h.card || h.thread, text: t }];
  if (h?.primary) return ['chat_say', { text: t }];
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

/** 턴 하나(입력 · 시각 · 답, 열쇠들) → 올릴 답 글(보드에서 온 턴이 아니거나 답이 없으면 null) */
export function replyFor({ keys, prompt, at, reply }) {
  if (!reply?.trim() || !prompt) return null;
  if (!takeTurn(keys, prompt, at)) return null;
  return clip(reply);
}
