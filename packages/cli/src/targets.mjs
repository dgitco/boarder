import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { home, readJson } from './config.mjs';

const H = (...p) => path.join(home(), ...p);
const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
const list = d => { try { return readdirSync(d).sort(); } catch { return []; } };
const which = cmd => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
export const tilde = p => { const h = path.resolve(home()), r = path.resolve(p); return r === h ? '~' : r.startsWith(h + path.sep) ? '~/' + path.relative(h, r).split(path.sep).join('/') : r; };
const untilde = p => p === '~' ? home() : p.startsWith('~/') ? path.join(home(), p.slice(2)) : p;

export const LABELS = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini CLI' };

function claudeTargets() {
  const out = [], seen = new Set();
  const add = (d, mcp) => { const key = path.resolve(mcp); if (seen.has(key)) return; seen.add(key); out.push({ dir: path.resolve(d), mcp: key }); };
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
  if (isDir(codex) || which('codex')) out.push({ tool: 'codex', id: 'codex', where: tilde(codex), dir: codex, files: { toml: path.join(codex, 'config.toml'), skills: [path.join(codex, 'skills', 'boarder', 'SKILL.md'), H('.agents', 'skills', 'boarder', 'SKILL.md')] } });
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
