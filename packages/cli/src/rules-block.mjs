// 받은 규칙을 Claude · Codex 가 읽는 파일(<Claude 설정 폴더>/CLAUDE.md · <Codex 폴더>/AGENTS.md)에 표시 구역으로 넣고 뺀다.
// 그 사람 글은 한 글자도 안 건드림: 우리가 붙인 앞머리(줄바꿈)와 구역만 적어 두고, 뺄 때 넣기 전 바이트 그대로 돌아간다. 우리가 만든 파일이면 비었을 때 지움.
// 구역 안 글에 구역 표시 문자열이 있으면 걸러 낸다(글이 구역을 일찍 닫거나 다른 구역을 흉내 내지 못하게).
import path from 'node:path';
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dir, ensureDir, readJson } from './config.mjs';
import { targets } from './targets.mjs';

export const BEGIN = '<!-- boarder:rules begin (`boarder disable harness` or turning the rule off removes only this block) -->';
export const END = '<!-- boarder:rules end -->';
const stripMarks = t => t.replace(/<!--\s*boarder:rules[^>]*-->/g, '');
const statePath = () => path.join(dir(), 'rules-block.json');
const load = () => readJson(statePath()) || { files: {} };
// 적어 둘 구역이 없으면 상태 파일도 지움(끈 뒤 흔적 0)
const save = s => { if (!Object.keys(s.files).length) { rmSync(statePath(), { force: true }); return; } ensureDir(dir()); writeFileSync(statePath(), JSON.stringify(s, null, 2) + '\n'); };

/** 링크로 관리하는 닷파일이면 링크의 실제 파일에 씀 */
function realOf(p) { try { return realpathSync(p); } catch { return p; } }
function write(p, text) {
  const real = realOf(p); mkdirSync(path.dirname(real), { recursive: true });
  const tmp = `${real}.boarder-${process.pid}.tmp`, mode = existsSync(real) ? statSync(real).mode & 0o777 : 0o644;
  writeFileSync(tmp, text, { mode }); renameSync(tmp, real);
}
const read = p => { try { return readFileSync(realOf(p), 'utf8'); } catch { return null; } };

/** 글 안의 표시 짝 찾기. 온전한 짝(BEGIN 다음 END, 사이에 다른 BEGIN 없음)만 pairs 에, 짝이 안 맞는 표시가 하나라도 있으면 broken */
export function findPairs(text) {
  const toks = [];
  for (const [kind, mark] of [['b', BEGIN], ['e', END]]) for (let i = text.indexOf(mark); i >= 0; i = text.indexOf(mark, i + mark.length)) toks.push({ kind, at: i, len: mark.length });
  toks.sort((x, y) => x.at - y.at);
  const pairs = []; let open = null, broken = false;
  for (const t of toks) {
    if (t.kind === 'b') { if (open) broken = true; open = t; }
    else if (!open) broken = true;
    else { pairs.push({ a: open.at, end: t.at + t.len + (text[t.at + t.len] === '\n' ? 1 : 0) }); open = null; }
  }
  if (open) broken = true;
  return { pairs, broken };
}

/** 구역을 넣거나 기존 짝을 새 글로 바꿈(상태 파일과 상관없이 파일에 든 짝을 봄). 표시가 깨져 있으면 아무것도 안 쓰고 멈춤 */
export function putBlock(file, body) {
  const st = load(), key = path.resolve(file), cur = read(file), block = `${BEGIN}\n${stripMarks(body).replace(/\s+$/, '')}\n${END}\n`;
  if (cur !== null) {
    const { pairs, broken } = findPairs(cur);
    if (broken) throw new Error(`${file} has a boarder:rules marker line without its partner — fix or delete the marker lines there, nothing was changed`);
    if (pairs.length) {
      // 첫 짝을 새 글로, 겹쳐 있던 나머지 짝은 뺌(구역은 파일에 하나)
      let out = cur.slice(0, pairs[0].a) + block, pos = pairs[0].end;
      for (const q of pairs.slice(1)) { out += cur.slice(pos, q.a); pos = q.end; }
      write(file, out + cur.slice(pos));
      st.files[key] ||= { created: false, prefix: '' };
      save(st);
      return 'updated';
    }
  }
  const created = cur === null;
  const prefix = created || cur === '' ? '' : cur.endsWith('\n\n') ? '' : cur.endsWith('\n') ? '\n' : '\n\n';
  write(file, (cur ?? '') + prefix + block);
  st.files[key] = { created, prefix };
  save(st);
  return created ? 'created' : 'added';
}

/** 온전한 짝만 모두 뺌(짝이 안 맞는 표시 줄은 그 사람 글일 수 있어 그대로 두고 leftover 로 알림). 앞머리까지 되돌리고, 우리가 만든 파일이 비면 지움 */
export function dropBlock(file) {
  const st = load(), key = path.resolve(file), rec = st.files[key], cur = read(file);
  if (cur === null) { delete st.files[key]; save(st); return { removed: 0, leftover: false }; }
  const { pairs } = findPairs(cur);
  let out = '', pos = 0;
  pairs.forEach((q, i) => {
    let start = q.a; const pre = rec?.prefix || '';
    if (i === 0 && pre && cur.slice(pos, q.a).endsWith(pre)) start = q.a - pre.length;
    out += cur.slice(pos, start); pos = q.end;
  });
  out += cur.slice(pos);
  const leftover = out.includes(BEGIN) || out.includes(END);
  if (pairs.length) { if (rec?.created && out.trim() === '') rmSync(realOf(file), { force: true }); else write(file, out); }
  if (!leftover) delete st.files[key];
  save(st);
  return { removed: pairs.length, leftover };
}

/** 이 기기의 규칙 파일 자리: Claude 설정 폴더마다 CLAUDE.md, Codex 는 AGENTS.md */
export function ruleFiles() {
  const out = [];
  for (const t of targets()) {
    if (t.tool === 'claude') out.push({ kind: 'CLAUDE.user.md', file: path.join(t.dir, 'CLAUDE.md') });
    else if (t.tool === 'codex') out.push({ kind: 'AGENTS.md', file: path.join(t.dir, 'AGENTS.md') });
  }
  return out;
}

/** 내 판의 rules/ 에 맞춰 넣고 뺌. rulesDir 가 null 이거나 파일이 없으면 그 자리 구역을 뺌. 파일 하나가 깨져 있어도 다른 파일은 계속하고, 한 일을 목록으로 돌려줌 */
export function syncRules(rulesDir) {
  const done = [], seen = new Set();
  const drop = file => { const r = dropBlock(file); if (r.removed) done.push(`removed ${file}`); if (r.leftover) done.push(`! ${file} still has an unmatched boarder:rules marker line — left as it is, delete it by hand`); };
  for (const { kind, file } of ruleFiles()) {
    seen.add(path.resolve(file));
    const src = rulesDir ? path.join(rulesDir, kind) : null;
    if (src && existsSync(src)) { try { done.push(`${putBlock(file, readFileSync(src, 'utf8'))} ${file}`); } catch (e) { done.push(`! ${e.message}`); } }
    else drop(file);
  }
  // 도구가 사라졌거나 폴더가 바뀐 자리에 적어 둔 구역도 뺌
  if (!rulesDir) for (const f of Object.keys(load().files)) if (!seen.has(f)) drop(f);
  return done;
}
export const dropAllRules = () => syncRules(null);
