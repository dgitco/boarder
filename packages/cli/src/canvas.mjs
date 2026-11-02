import path from 'node:path';
import { lstatSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { loadDevice, server } from './config.mjs';

export const LIMITS = { files: 200, file: 10 << 20, total: 25 << 20, path: 200, depth: 8 };   // 서버 member-canvas.ts 와 같은 값
export const CANVAS_HELP = `Canvases (your own HTML pages on your board)
  boarder canvas put <folder> [--id <id>] [--title <name>] [--acct <account label>] [--todo "<one line for the human>"]
                                    upload index.html and the files next to it; the same --id makes a new version;
                                    --todo also puts a to-do card with the canvas link on the board (the human taps 「했어요」)
  boarder canvas list               your canvases`;
const ID = /^[A-Za-z0-9]{16,40}$/;
const SKIP = new Set(['node_modules']);

/** 폴더 안 올릴 파일 [{path, abs, size}] — 상한을 넘으면 무엇이 넘었는지 말하고 던짐 */
export function collect(folder) {
  if (!folder || !existsSync(path.join(folder, 'index.html'))) throw new Error(`${folder ? path.join(folder, 'index.html') : '<folder>'} 이 없어요 — index.html 이 있는 폴더를 주세요`);
  const out = []; let total = 0;
  const walk = (dir, rel, depth) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.') || SKIP.has(name)) continue;
      const abs = path.join(dir, name), p = rel ? `${rel}/${name}` : name, st = lstatSync(abs);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { if (depth + 1 >= LIMITS.depth) throw new Error(`폴더가 너무 깊어요(${LIMITS.depth}단 까지): ${p}`); walk(abs, p, depth + 1); continue; }
      if (!st.isFile()) continue;
      if (p.length > LIMITS.path || /[\x00-\x1f\x7f\\?#%]/.test(p) || p.split('/').some(s => s.trim() !== s)) throw new Error(`올릴 수 없는 이름: ${p}`);
      if (st.size > LIMITS.file) throw new Error(`파일이 너무 커요(${LIMITS.file >> 20}MB 까지): ${p}`);
      total += st.size; if (total > LIMITS.total) throw new Error(`합이 너무 커요(${LIMITS.total >> 20}MB 까지)`);
      out.push({ path: p, abs, size: st.size });
      if (out.length > LIMITS.files) throw new Error(`파일이 너무 많아요(${LIMITS.files}개 까지)`);
    }
  };
  walk(folder, '', 0);
  return { files: out, total };
}
export const normId = v => { if (v === undefined) return undefined; const s = String(v).replace(/-/g, ''); if (!ID.test(s)) throw new Error('--id 는 영문 · 숫자 16–40자(UUID 는 「-」 를 떼고)'); return s; };

function device() {
  const d = loadDevice(); if (!d?.token) { const e = new Error('This machine is not set up for Boarder yet — run `boarder setup --yes`.'); e.code = 'NO_DEVICE'; throw e; }
  return d;
}
async function send(method, body) {
  const d = device();
  const r = await fetch(`${server()}/api/me/canvas`, { method, headers: { authorization: `Bearer ${d.token}` }, ...(body ? { body } : {}), signal: AbortSignal.timeout(180_000) });
  const j = await r.json().catch(() => ({ error: `Boarder ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(j.error || String(r.status)), { status: r.status });
  return j;
}

// 할 일 한 줄: 서버 inbox_ask question 과 같은 검사(한 줄 · 200자 · 「-」로 시작 못 함 · 제어 문자 없음) — 올리기 전에 멈춤
export function todoLine(v) {
  if (v === undefined) return undefined;
  const s = String(v === true ? '' : v).trim();
  if (!s || s.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(s) || s.startsWith('-')) throw new Error('--todo 는 사람이 할 일 한 줄(200자 까지, 「-」로 시작 못 함)');
  return s;
}
async function putTodo(todo, j) {
  const { windowToken } = await import('./window.mjs');
  const w = await windowToken();
  const body = JSON.stringify({ question: todo, choices: [TODO_DONE], kind: 'todo', body: `캔버스: ${j.title}\n${j.url}` });
  const r = await fetch(`${server()}/api/agent/inbox_ask`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${w.token}` }, body, signal: AbortSignal.timeout(30_000) });
  const out = await r.json().catch(() => ({ error: `Boarder ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(out.error || String(r.status)), { status: r.status });
  return out;
}
const TODO_DONE = '했어요';   // 회원 할 일 끝냄 답(apps/web/worker/member-board.ts TODO_DONE)

export async function canvasPut(folder, flags = {}, { log = console.log } = {}) {
  const id = normId(flags.id), todo = todoLine(flags.todo), { files, total } = collect(folder);
  const fd = new FormData();
  fd.set('manifest', JSON.stringify(files.map(f => ({ path: f.path }))));
  files.forEach((f, i) => fd.set(`f${i}`, new Blob([readFileSync(f.abs)]), path.basename(f.path)));
  if (id) fd.set('id', id);
  if (flags.title) fd.set('title', String(flags.title));
  if (flags.acct) fd.set('acct', String(flags.acct));
  try { const { windowKey } = await import('./window.mjs'); const k = windowKey(); if (/^[\w@.:/+-]{2,120}$/.test(k.key)) fd.set('win', k.key); } catch {}
  if (/^ew_[a-z0-9]{3,40}$/i.test(process.env.BOARDER_WINDOW || '')) fd.set('wid', process.env.BOARDER_WINDOW);
  const j = await send('POST', fd);
  log(`${j.replaced ? '새 판' : '새 캔버스'}: ${j.title} · 파일 ${j.files} · ${Math.ceil(total / 1024)}KB\n${j.url}\nid ${j.id}`);
  if (todo) {
    try { const c = await putTodo(todo, j); log(`할 일: ${todo} (card ${c.card_id})`); j.todo = c.card_id; }
    catch (e) { throw Object.assign(new Error(`캔버스는 올렸지만 할 일 카드를 못 세웠어요: ${e.message}`), { status: e.status, code: e.code }); }
  }
  return j;
}
export async function canvasList({ log = console.log } = {}) {
  const j = await send('GET');
  if (!j.canvases.length) log('캔버스가 아직 없어요 — boarder canvas put <folder>');
  for (const c of j.canvases) log(`${c.id}  ${c.title}${c.acct ? `  (${c.acct})` : ''}  · 파일 ${c.files}`);
  return j;
}
export async function canvasCommand(sub, pos, flags) {
  if (sub === 'put') return canvasPut(pos[0], flags);
  if (sub === 'list') return canvasList();
  console.error(CANVAS_HELP); process.exit(64);
}
