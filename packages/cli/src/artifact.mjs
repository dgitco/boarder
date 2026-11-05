import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync, rmSync, statSync, lstatSync, realpathSync } from 'node:fs';

const TOOL = /^(publish_version|publish_files|edit_version)$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** 도구 이름 → 게시 도구인지(mcp__<서버>__publish_version 꼴. 서버 이름에 artifact 가 든 것만) */
export function publishTool(name) {
  const m = /^mcp__([^_].*?)__(.+)$/.exec(String(name || ''));
  return m && /artifact/i.test(m[1]) && TOOL.test(m[2]) ? m[2] : null;
}

// 도구 결과에서 글 조각들과 JSON 객체들을 꺼냄: 문자열 · 블록 배열 [{type:'text', text}] · {content:[…]} · structuredContent
function pieces(resp) {
  const texts = [], objs = [];
  const text = s => { if (typeof s !== 'string') return; texts.push(s); try { const v = JSON.parse(s); if (v && typeof v === 'object') objs.push(v); } catch {} };
  const blocks = l => { for (const c of l) { if (typeof c === 'string') text(c); else if (c?.type === 'text') text(c.text); } };
  if (typeof resp === 'string') text(resp);
  else if (Array.isArray(resp)) blocks(resp);
  else if (resp && typeof resp === 'object') { objs.push(resp); if (resp.structuredContent) objs.push(resp.structuredContent); if (Array.isArray(resp.content)) blocks(resp.content); }
  return { texts, objs };
}
const isError = resp => resp && typeof resp === 'object' && !Array.isArray(resp) && (resp.isError === true || resp.is_error === true);

/** 결과에서 아티팩트 주소 이름(…/artifact/<uuid> 먼저, 그다음 slug 꼴 UUID · 키 slug/artifact_id/id/url)과 제목 */
export function resultInfo(resp, input = {}) {
  const { texts, objs } = pieces(resp);
  let id = null, title = null;
  const take = v => { const m = typeof v === 'string' && UUID.exec(v); if (m && !id) id = m[0].replace(/-/g, ''); };
  for (const t of texts) { const m = /\/artifact\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(t); if (m && !id) id = m[1].replace(/-/g, ''); }
  for (const o of [...objs, input]) {
    for (const k of ['url', 'slug', 'artifact_id', 'id']) take(o?.[k]);
    if (!title && typeof o?.title === 'string' && o.title.trim()) title = o.title.trim().slice(0, 120);
  }
  for (const t of texts) take(t);   // JSON 이 아닌 글 속 UUID(slug 꼴)
  if (!title) for (const t of texts) { const m = /(?:title|제목)["']?\s*[:=]\s*["']?([^"'\n]{1,120})/i.exec(t); if (m) { title = m[1].trim(); break; } }
  return { id, title };
}

/** 어느 claude.ai 계정인지 이름: CLAUDE_CONFIG_DIR 폴더 이름 → 없으면 기본 폴더 .claude.json 의 계정 메일 */
export function acctLabel(env = process.env, home = os.homedir()) {
  const d = env.CLAUDE_CONFIG_DIR;
  if (d) return path.basename(d.replace(/[\\/]+$/, '')).replace(/^\.+/, '') || undefined;
  try { const j = JSON.parse(readFileSync(path.join(home, '.claude.json'), 'utf8')); const m = j?.oauthAccount?.emailAddress; if (typeof m === 'string') return m.slice(0, 80); } catch {}
  return undefined;
}

const fileOf = v => typeof v === 'string' ? v : (v && typeof v === 'object' ? (v.path ?? v.from ?? v.file_path ?? v.source) : undefined);
// publish_files 의 파일들 → [[게시 경로, 원본 경로]]. 실제 꼴은 배열 [{as, path}] (게시 경로 = as ?? path 의 이름), 맵 {게시 경로: 원본} 도 받음
function fileList(input) {
  const out = [], f = input.files;
  if (Array.isArray(f)) for (const x of f) { const src = fileOf(x); if (src) out.push([(x && typeof x === 'object' && x.as) || path.basename(src), src]); }
  else if (f && typeof f === 'object') for (const [k, v] of Object.entries(f)) { const src = fileOf(v); if (src) out.push([k, src]); }
  return out;
}
// 비밀 꼴 이름(점 파일 · .env · 키 · id_*)은 안 올림
const SECRET = /^(\.|id_|.*\.(pem|key|p12|pfx|env)$)/i;
const secretName = rel => rel.split('/').some(seg => SECRET.test(seg));
// 원본 파일이 올려도 되는 것인지: 일반 파일, 링크 아님, 실제 위치가 작업 폴더(cwd) 또는 임시 폴더 안, 비밀 꼴 이름 아님
function safeSource(src, cwd, log) {
  try {
    if (secretName(path.basename(src))) { log(`boarder artifact: skip ${path.basename(src)} (secret-like name)`); return false; }
    if (!existsSync(src) || lstatSync(src).isSymbolicLink() || !statSync(src).isFile()) { if (existsSync(src)) log(`boarder artifact: skip ${path.basename(src)} (link or not a file)`); return false; }
    const real = realpathSync(src), roots = [cwd, os.tmpdir()].filter(Boolean).map(r => { try { return realpathSync(r); } catch { return null; } }).filter(Boolean);
    if (!roots.some(r => real === r || real.startsWith(r + path.sep))) { log(`boarder artifact: skip ${path.basename(src)} (outside the working folder)`); return false; }
    return true;
  } catch { return false; }
}

/** 올릴 폴더를 임시로 만듦(index.html + 딸린 파일). 올릴 HTML 이 없으면 null */
export function stage(tool, input, { root = os.tmpdir(), cwd, log = () => {} } = {}) {
  const dir = mkdtempSync(path.join(root, 'boarder-art-'));
  try {
    let any = false;
    const html = typeof input.content === 'string' ? input.content : null;
    if (html) { writeFileSync(path.join(dir, 'index.html'), html); any = true; }
    else if (typeof input.file_path === 'string' && safeSource(input.file_path, cwd, log)) { copyFileSync(input.file_path, path.join(dir, 'index.html')); any = true; }
    for (const [pub, src] of tool === 'publish_files' ? fileList(input) : []) {
      const rel = pub.replace(/^\/+/, '');
      if (!rel || rel.split('/').includes('..') || secretName(rel) || !safeSource(src, cwd, log)) continue;
      const to = path.join(dir, rel); mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(src, to);
      if (rel === 'index.html') any = true;
    }
    if (!any || !existsSync(path.join(dir, 'index.html'))) { rmSync(dir, { recursive: true, force: true }); return null; }
    return dir;
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
}

/** 훅 입력(JSON) 하나 처리. put(folder, flags) 는 canvasPut 과 같은 인자. 결과 {skipped}|{ok, url}|{error} — 던지지 않음 */
export function hookNote(r) {
  if (r?.error) return `보더 캔버스로 올리기 실패: ${String(r.error).slice(0, 300)} — 이 아티팩트의 보더 주소(/art/…)는 아직 없어요. 사람에게 보더 주소를 주지 말고 claude.ai 링크를 주거나, 고친 뒤 \`boarder canvas put <폴더> --id ${r.id || '<아티팩트 id>'}\` 로 다시 올려 나온 주소를 주세요.`;
  if (r?.ok && r.url) return `보더 캔버스에도 올렸어요: ${r.url}`;
  return '';
}
export async function artifactHook(input, { put, env = process.env, home = os.homedir(), log = () => {}, timeoutMs = 15_000 } = {}) {
  try {
    const tool = publishTool(input?.tool_name);
    if (!tool) return { skipped: 'not a publish tool' };
    if (isError(input.tool_response)) return { skipped: 'publish failed' };
    const ti = input.tool_input || {}, { id, title } = resultInfo(input.tool_response, ti);
    if (!id) return { skipped: 'no artifact id in result' };
    const folder = stage(tool, ti, { cwd: input.cwd, log });
    if (!folder) { log(`boarder artifact: ${tool} — nothing to upload (no html content or file path in the input)`); return { skipped: 'no html to upload' }; }
    try {
      const flags = { id, ...(title ? { title } : {}) }, acct = acctLabel(env, home); if (acct) flags.acct = acct;
      // 훅 한도(setup 60초) 안에 끝내려고 15초 상한 — 망이 죽어도 게시마다 오래 멈추지 않게(canvasPut 의 fetch 는 180초)
      let timer; const j = await Promise.race([put(folder, flags), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`upload took over ${timeoutMs / 1000}s — gave up`)), timeoutMs); })]).finally(() => clearTimeout(timer));
      return { ok: true, id, ...(typeof j?.url === 'string' ? { url: j.url } : {}) };
    } catch (e) { throw Object.assign(e, { artifactId: id }); }
    finally { rmSync(folder, { recursive: true, force: true }); }
  } catch (e) { log(`boarder artifact: ${e.message}`); return { error: e.message, ...(e.artifactId ? { id: e.artifactId } : {}) }; }
}
