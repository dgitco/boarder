import { spawn } from 'node:child_process';
import { server } from './config.mjs';

export function connectUrl(target, label) {
  const q = new URLSearchParams({ connect: target }); if (label) q.set('label', label);
  return `${server()}/#settings/connectors?${q}`;
}
export function connectCommand(pos, flags) {
  const target = pos[0];
  if (!target || !/^([a-z0-9][a-z0-9-]{0,39}|https:\/\/\S{4,400})$/.test(target)) { console.error('usage: boarder connect <service|https MCP URL> [--label <name>]'); process.exit(1); }
  const url = connectUrl(target, flags.label);
  console.log(`Connect ${target}${flags.label ? ` (${flags.label})` : ''} in Boarder: ${url}`);
  const open = flags.open || process.platform === 'darwin' || process.platform === 'win32';
  if (!open) return;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch {}
}
