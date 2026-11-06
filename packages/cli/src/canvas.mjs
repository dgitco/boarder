import path from 'node:path';
import { lstatSync, readdirSync, readFileSync, existsSync, openAsBlob, openSync, readSync, closeSync } from 'node:fs';
import { loadDevice, server } from './config.mjs';
import { scanFiles, scanText, hitsText, warnsText } from './sensitive.mjs';
import { uploadDirect, legacyUploadAllowed } from './direct-upload.mjs';

export const LIMITS = { files: 200, file: 500 * 1024 * 1024, total: 500 * 1024 * 1024, path: 200, depth: 8 };   // 서버 member-canvas.ts 와 같은 값
export const LEGACY_LIMITS = { file: 10 << 20, total: 25 << 20 };
export const CANVAS_HELP = `Canvases (your own HTML pages on your board)
  boarder canvas put <folder> [--id <id>] [--title <name>] [--acct <account label>] [--todo "<one line for the human>"]
                                    upload index.html and the files next to it; the same --id makes a new version; --id is 16-40 letters/digits (for a claude.ai artifact, its unique id);
                                    --todo also puts a to-do card with the canvas link on the board (the human taps 「했어요」)
  boarder canvas list               your canvases
  boarder canvas rm <id>            delete one of your canvases (all versions and files)
  put refuses (exit 1) folders that hold national ID / card / account numbers or keys and tokens; it names the kind, count and file, never the value`;
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
      if (st.size > LIMITS.file) throw new Error(`파일이 너무 커요(${LIMITS.file >> 20}MiB 까지): ${p}`);
      total += st.size; if (total > LIMITS.total) throw new Error(`합이 너무 커요(${LIMITS.total >> 20}MiB 까지)`);
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
async function send(method, body, suffix = '') {
  const d = device(), multipart = body instanceof FormData;
  const r = await fetch(`${server()}/api/me/canvas${suffix}`, { method, headers: { authorization: `Bearer ${d.token}`, ...(body && !multipart ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180_000) });
  const j = await r.json().catch(() => ({ error: `Boarder ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(j.error || String(r.status)), { status: r.status, code: j.code });
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

// 큰 바이너리를 민감값 검사나 제목 추출 때문에 메모리에 통째로 읽지 않음.
function prefix(file, size) {
  const fd = openSync(file, 'r');
  try { const b = Buffer.alloc(size), n = readSync(fd, b, 0, size, 0); return b.subarray(0, n); }
  finally { closeSync(fd); }
}
function localTitle(files) {
  const cv = files.find(f => f.path === 'project/canvas.json') || files.find(f => f.path === 'canvas.json');
  if (cv) { try { const title = JSON.parse(prefix(cv.abs, 2 << 20).toString('utf8'))?.title; if (title) return String(title).slice(0, 200); } catch {} }
  const index = files.find(f => f.path === 'index.html');
  const m = index && /<title[^>]*>([^<]{1,400})<\/title>/i.exec(prefix(index.abs, 65536).toString('utf8'));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : '';
}

export async function canvasPut(folder, flags = {}, { log = console.log, warn = m => console.error(m), scan = scanFiles } = {}) {
  const id = normId(flags.id), todo = todoLine(flags.todo), { files, total } = collect(folder);
  // 민감 값 거름(sensitive.mjs): 걸리면 올리지 않음 — 종류 · 개수 · 파일만 말하고 값은 안 찍음. 급여 의심은 경고만
  const g = scan(files, { read: file => { const head = prefix(file, 8192); return head.includes(0) ? head : readFileSync(file); } });
  // 제목(훅이 claude.ai 제목을 넘김) · 할 일 글에도 같은 검사: 제목은 「제목 숨김」으로 바꿔 올리고, 할 일 글은 막음
  const risky = t => { const n = scanText(String(t)); return n.rrn + n.card + n.acct + n.secret > 0; };
  if (flags.title && risky(flags.title)) { warn('boarder canvas: 제목에 민감한 값이 있어 「제목 숨김」으로 바꿔 올려요'); flags = { ...flags, title: '제목 숨김' }; }
  if (todo && risky(todo)) throw Object.assign(new Error('--todo 글에 민감한 값이 있어 올리지 않았어요 (Not uploaded — sensitive value in --todo)'), { code: 'SENSITIVE' });
  if (g.warns.length) warn(`boarder canvas: ${warnsText(g)}`);
  if (g.hits.length) throw Object.assign(new Error(`민감한 값이 있어 올리지 않았어요 (Not uploaded — sensitive values found):\n${hitsText(g)}\n지우거나 가린 뒤 다시 올려 주세요.`), { code: 'SENSITIVE', hits: g.hits.map(h => ({ kind: h.kind, count: h.count, files: h.files })) });
  const metadata = { manifest: files.map(f => ({ path: f.path, size: f.size })) };
  if (id) metadata.id = id;
  metadata.title = flags.title ? String(flags.title) : localTitle(files);
  if (flags.acct) metadata.acct = String(flags.acct);
  try { const { windowKey } = await import('./window.mjs'); const k = windowKey(); if (/^[\w@.:/+-]{2,120}$/.test(k.key)) metadata.win = k.key; } catch {}
  if (/^ew_[a-z0-9]{3,40}$/i.test(process.env.BOARDER_WINDOW || '')) metadata.wid = process.env.BOARDER_WINDOW;
  let batch, j;
  try { batch = await send('POST', metadata); }
  catch (e) {
    if (!legacyUploadAllowed(e) && !(e.status === 400 && e.message === 'multipart 아님')) throw e;
    if (total > LEGACY_LIMITS.total || files.some(file => file.size > LEGACY_LIMITS.file)) throw Object.assign(new Error('이 서버는 직접 올리기 지원이 필요해요. 이전 방식은 파일당 10MiB·합 25MiB까지예요'), { code: 'LEGACY_LIMIT', status: e.status });
    const fd = new FormData(); fd.set('manifest', JSON.stringify(files.map(file => ({ path: file.path }))));
    for (const [index, file] of files.entries()) {
      const blob = await openAsBlob(file.abs);
      if (blob.size !== file.size) throw new Error(`검사 뒤 파일 크기가 바뀌었어요: ${file.path}`);
      fd.set(`f${index}`, blob, path.basename(file.path));
    }
    for (const field of ['id', 'title', 'acct', 'win', 'wid']) if (metadata[field]) fd.set(field, metadata[field]);
    warn('boarder canvas: 이 서버는 이전 올리기 방식(파일당 10MiB·합 25MiB)을 사용해요');
    j = await send('POST', fd);
  }
  if (batch) {
    // 세션을 받은 뒤에는 이전 방식으로 재게시하지 않는다. 응답 유실도 같은 세션으로만 처리한다.
    try {
      for (let index = 0; index < files.length; index++) {
        const blob = await openAsBlob(files[index].abs);
        if (blob.size !== files[index].size) throw new Error(`검사 뒤 파일 크기가 바뀌었어요: ${files[index].path}`);
        await uploadDirect(blob, { session: batch.uploads[index], control: (action, body) => send('POST', { ...body, session: batch.session, index }, `/upload/${action}`) });
      }
      j = await send('POST', { session: batch.session }, '/publish');
    } catch (e) {
      await send('POST', { session: batch.session }, '/abort').catch(err => warn(`boarder canvas: 올리기 정리를 못 했어요: ${err.message}`));
      throw e;
    }
  }
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
export async function canvasRm(id, { log = console.log } = {}) {
  const v = normId(id); if (!v) throw new Error('boarder canvas rm <id>');
  const j = await send('DELETE', undefined, `/${v}`);
  log(`지웠어요: ${v} · 파일 ${j.files}`);
  return j;
}
export async function canvasCommand(sub, pos, flags) {
  if (sub === 'put') return canvasPut(pos[0], flags);
  if (sub === 'list') return canvasList();
  if (sub === 'rm') return canvasRm(pos[0]);
  console.error(CANVAS_HELP); process.exit(64);
}
