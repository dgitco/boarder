import path from 'node:path';
import { renameSync, writeFileSync } from 'node:fs';
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
  return { prompt: textOf(p.message.content), at: Date.parse(p.timestamp) || 0, reply };
}
export const clip = t => { const s = redact(String(t || '')).trim(); return s.length > REPLY_MAX ? s.slice(0, REPLY_MAX - 12).trimEnd() + '\n…(줄였어요)' : s; };

/** 턴 하나(입력 · 시각 · 답, 열쇠들) → 올릴 답 글(보드에서 온 턴이 아니거나 답이 없으면 null) */
export function replyFor({ keys, prompt, at, reply }) {
  if (!reply?.trim() || !prompt) return null;
  if (!takeTurn(keys, prompt, at)) return null;
  return clip(reply);
}
