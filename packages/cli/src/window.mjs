import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadDevice, loadWindow, saveWindow, server } from './config.mjs';

const AGENTS = [['claude', /(^|\/)claude(\.exe)?$|claude-code/i], ['codex', /(^|\/)codex(\.exe)?$|@openai\/codex/i], ['cursor', /cursor/i], ['gemini', /(^|\/)gemini(\.exe)?$|gemini-cli/i]];

function parentOf(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'), ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).slice(0, 3).join(' ');
      return { ppid, cmd };
    } catch { return null; }
  }
  try {
    const out = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }).trim();
    const m = /^(\d+)\s+(.*)$/.exec(out); return m ? { ppid: Number(m[1]), cmd: m[2].split(' ').slice(0, 3).join(' ') } : null;
  } catch { return null; }
}

export function agentProcess() {
  let pid = process.ppid;
  for (let i = 0; i < 12 && pid > 1; i++) {
    const p = parentOf(pid); if (!p) break;
    for (const [name, re] of AGENTS) if (p.cmd.split(' ').some(w => re.test(w))) return { name, pid };
    pid = p.ppid;
  }
  return null;
}

export function windowKey() {
  const host = os.hostname().split('.')[0].replace(/[^\w.-]/g, '').slice(0, 30) || 'host';
  if (process.env.BOARDER_WINDOW) return { key: `${host}:${process.env.BOARDER_WINDOW.replace(/[^\w@.:/+-]/g, '-')}`.slice(0, 120), name: (process.env.BOARDER_WINDOW_NAME || process.env.BOARDER_WINDOW).slice(0, 60) };   // 엔진 창은 역할 이름(BOARDER_WINDOW_NAME)
  if (/^%\d+$/.test(process.env.TMUX_PANE || '')) return { key: `${host}:tmux:${process.env.TMUX_PANE.slice(1)}`, name: `${path.basename(process.cwd())} tmux ${process.env.TMUX_PANE.slice(1)}` };
  const a = agentProcess();
  if (a) return { key: `${host}:${a.name}:${a.pid}`, name: `${a.name} · ${path.basename(process.cwd())}` };
  return { key: `${host}:shell:${process.ppid}`, name: `터미널 · ${path.basename(process.cwd())}` };
}

/** 이 창의 토큰(없거나 서버가 거절하면 기기 토큰으로 새로 받음) */
export async function windowToken({ fresh = false } = {}) {
  const dev = loadDevice();
  if (!dev?.token) { const e = new Error('This machine is not set up for Boarder yet — run `boarder setup --yes`.'); e.code = 'NO_DEVICE'; throw e; }
  const w = windowKey();
  const saved = !fresh && loadWindow(w.key);
  if (saved?.token) return { token: saved.token, ...w };
  const r = await fetch(`${dev.server}/api/device/window`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${dev.token}` }, body: JSON.stringify({ key: w.key, name: w.name }), signal: AbortSignal.timeout(20000) });
  if (r.status === 401) { const e = new Error('This device was revoked or signed out — run `boarder setup --yes` again.'); e.code = 'REVOKED'; throw e; }
  if (!r.ok) throw new Error(`Boarder server answered ${r.status}`);
  const { token } = await r.json();
  saveWindow(w.key, { token, name: w.name, at: Date.now() });
  return { token, ...w };
}
