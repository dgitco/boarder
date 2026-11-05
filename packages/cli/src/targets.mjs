import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { home, readJson } from './config.mjs';

const H = (...p) => path.join(home(), ...p);
const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
const list = d => { try { return readdirSync(d).sort(); } catch { return []; } };
const which = cmd => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
export const tilde = p => { const h = path.resolve(home()), r = path.resolve(p); return r === h ? '~' : r.startsWith(h + path.sep) ? '~/' + path.relative(h, r).split(path.sep).join('/') : r; };
const untilde = p => p === '~' ? home() : p.startsWith('~/') ? path.join(home(), p.slice(2)) : p;

/** 실제 경로(링크를 따라감). 아직 없는 경로면 있는 가장 가까운 윗 폴더의 실제 경로 + 나머지 */
export function realish(p) {
  let x = path.resolve(p); const rest = [];
  for (;;) {
    try { return path.join(realpathSync(x), ...rest); } catch {}
    const up = path.dirname(x); if (up === x) return path.resolve(p);
    rest.unshift(path.basename(x)); x = up;
  }
}
/** p 의 실제 경로가 root(의 실제 경로) 안인가 */
export const within = (p, root) => { const r = realish(root), x = realish(p); return x === r || x.startsWith(r.endsWith(path.sep) ? r : r + path.sep); };
/** 지금 HOME 이 로그인 홈인가 — 시험 · 임시 HOME(HOME=/tmp/…)이면 false. 알 수 없으면 true(지금과 같게) */
export const loginHome = () => { try { return realish(home()) === realish(os.userInfo().homedir); } catch { return true; } };
/** 임시 HOME 으로 도는데 실제 경로가 그 HOME 밖인 설정 폴더 — 로그인 사용자의 진짜 설정이라 고르지 않음. 로그인 홈이면 늘 false(지금과 같음) */
export const outsideHome = d => !loginHome() && !within(d, home());
export const linkedOutside = p => !loginHome() && realish(p) !== path.resolve(p) && !within(p, home());
const tmpRoots = () => [...new Set(['/tmp', os.tmpdir()])].filter(r => existsSync(r)).map(realish).sort((a, b) => b.length - a.length);
/** 임시 자리(/tmp · os.tmpdir(), 실제 경로) 밑이면 그 뿌리 바로 밑 폴더(/tmp/tmp.X 처럼 한 번 쓰고 버리는 칸), 아니면 null.
 *  뿌리가 겹치면 가장 깊은 것(TMPDIR=/tmp/claude-1000/… 이면 그 밑 칸) */
export function tmpTop(p) {
  const x = realish(p);
  for (const r of tmpRoots()) if (x.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) return path.join(r, x.slice(r.length).split(path.sep).filter(Boolean)[0]);
  return null;
}
const noted = new Set();
const skipNote = d => { if (noted.has(d)) return; noted.add(d); process.stderr.write(`boarder: left ${d} alone — it is outside HOME (${home()}), so it belongs to your login account, not this HOME\n`); };

export const LABELS = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini CLI' };

function claudeTargets() {
  const out = [], seen = new Set();
  const add = (d, mcp) => {
    const key = path.resolve(mcp); if (seen.has(key)) return; seen.add(key);
    if (outsideHome(d) || outsideHome(mcp)) { skipNote(path.resolve(d)); return; }
    out.push({ dir: path.resolve(d), mcp: key });
  };
  if (isDir(H('.claude')) || existsSync(H('.claude.json'))) add(H('.claude'), H('.claude.json'));   // CLAUDE_CONFIG_DIR 없이 Claude Code 가 쓰는 곳
  const custom = d => add(d, path.join(d, '.claude.json'));   // CLAUDE_CONFIG_DIR 를 주면 .claude.json 도 그 폴더 안
  if (process.env.CLAUDE_CONFIG_DIR) custom(untilde(process.env.CLAUDE_CONFIG_DIR));
  for (const e of list(H('.claude-accounts'))) { const d = H('.claude-accounts', e); if (existsSync(path.join(d, '.claude.json'))) custom(d); }
  for (const e of list(home())) if (/^\.claude-./.test(e) && e !== '.claude-accounts' && existsSync(path.join(H(e), '.claude.json'))) custom(H(e));
  for (const d of (process.env.BOARDER_CLAUDE_DIRS || '').split(path.delimiter).filter(Boolean)) custom(untilde(d));
  if (!out.length && which('claude')) add(H('.claude'), H('.claude.json'));
  return out.map(({ dir, mcp }) => {
    const dflt = mcp === path.resolve(H('.claude.json'));
    return { tool: 'claude', id: `claude:${dflt ? '~/.claude' : tilde(dir)}`, where: dflt ? '~/.claude' : tilde(dir), dir, files: { mcp, settings: path.join(dir, 'settings.json'), skills: [path.join(dir, 'skills', 'boarder', 'SKILL.md')] } };
  });
}

/** 이 기기의 AI 도구 설정 자리 전부(찾은 것만) */
export function targets() {
  const out = claudeTargets();
  const codex = process.env.CODEX_HOME ? untilde(process.env.CODEX_HOME) : H('.codex');
  if (outsideHome(codex)) skipNote(path.resolve(codex));
  else if (isDir(codex) || which('codex')) out.push({ tool: 'codex', id: 'codex', where: tilde(codex), dir: codex, files: { toml: path.join(codex, 'config.toml'), skills: [path.join(codex, 'skills', 'boarder', 'SKILL.md'), H('.agents', 'skills', 'boarder', 'SKILL.md')] } });
  if (isDir(H('.cursor')) || which('cursor')) out.push({ tool: 'cursor', id: 'cursor', where: '~/.cursor', dir: H('.cursor'), files: { mcp: H('.cursor', 'mcp.json'), skills: [] } });
  if (isDir(H('.gemini')) || which('gemini')) out.push({ tool: 'gemini', id: 'gemini', where: '~/.gemini', dir: H('.gemini'), files: { mcp: H('.gemini', 'settings.json'), skills: [] } });
  return out;
}
export const label = t => t.tool === 'claude' ? `${LABELS.claude} (${t.where})` : LABELS[t.tool];

export function pick(all, only, skip) {
  const match = (t, w) => { const v = w.trim(); if (!v) return false; if (v === t.tool || v === t.id) return true; const p = path.resolve(untilde(v)); return p === t.dir || p === path.resolve(t.files.mcp || t.files.toml || ''); };
  let out = all;
  if (only?.length) {
    const bad = only.filter(w => !all.some(t => match(t, w)));
    if (bad.length) throw new Error(`not found on this machine: ${bad.join(', ')} — \`boarder status\` lists the AI tool folders here`);
    out = all.filter(t => only.some(w => match(t, w)));
  }
  if (skip?.length) out = out.filter(t => !skip.some(w => match(t, w)));
  return out;
}

const TOML_HEAD = /^\[mcp_servers\.boarder\][ \t]*\r?$/m;
/** 그 자리에 든 Boarder MCP 칸(없으면 null) — { command, args } */
export function entryOf(t) {
  try {
    if (t.tool === 'codex') {
      const s = readFileSync(t.files.toml, 'utf8'); if (!TOML_HEAD.test(s)) return null;
      const sec = s.slice(s.search(TOML_HEAD)).split(/\r?\n(?=[ \t]*\[)/)[0];
      const cmd = /^command\s*=\s*("(?:[^"\\]|\\.)*")/m.exec(sec)?.[1], args = /^args\s*=\s*(\[.*\])/m.exec(sec)?.[1];
      return { command: cmd ? JSON.parse(cmd) : '', args: args ? JSON.parse(args) : [] };
    }
    const e = readJson(t.files.mcp)?.mcpServers?.boarder;
    return e ? { command: e.command || '', args: Array.isArray(e.args) ? e.args : [] } : null;
  } catch { return null; }
}
/** off · on · stale(옛 CLI 경로 — 다른 boarder.mjs 나 없어진 node 를 가리킴) */
export function state(t, bin, node) {
  const e = entryOf(t); if (!e) return { state: 'off' };
  const cliPath = e.args.find(a => /boarder(\.mjs)?$/.test(String(a))) || e.command;
  if (e.args.includes(bin) && (e.command === node || existsSync(e.command))) return { state: 'on' };
  return { state: 'stale', was: cliPath };
}
