import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadDevice, server } from './config.mjs';

export function connectUrl(target, label) {
  const q = new URLSearchParams({ connect: target }); if (label) q.set('label', label);
  return `${server()}/#settings/connectors?${q}`;
}
const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --auth: bearer(기본) · basic · header:<이름> · query:<이름>
function authOf(v = 'bearer') {
  const [t, name] = String(v).split(':');
  if (t === 'bearer' || t === 'basic') return { type: t };
  if ((t === 'header' || t === 'query') && name) return { type: t, name };
  fail('--auth bearer | basic | header:<Name> | query:<name>', 64);
}

async function connectWithKey(service, flags) {
  const d = loadDevice(); if (!d?.token) fail('this machine is not signed in — run `boarder setup` first', 3);
  let key;
  try { key = (flags['key-file'] === '-' ? readFileSync(0, 'utf8') : readFileSync(flags['key-file'], 'utf8')).replace(/\r\n/g, '\n').trim(); }
  catch (e) { fail(`could not read the key file (${e.code || 'error'})`); }   // 경로 · 내용은 안 찍음
  if (!key) fail('the key file is empty');
  const api = flags['base-url'] ? { base_url: flags['base-url'], auth: authOf(flags.auth) } : { preset: service };
  const body = { service, label: flags.label, api, key, read_only: !flags.write };
  key = null;
  const auth = { authorization: `Bearer ${d.token}` };
  const r = await fetch(`${server()}/api/device/connect`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  body.key = null;
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) fail('this machine was revoked or is not a member machine — sign in again with `boarder setup`', 3);
  if (!r.ok) fail(`not sent: ${j.error || r.status}`);
  console.log(`A card is on your board: 「${j.name}」 — press 허용 there (${flags.write ? 'read and write' : 'read only'}). The key is sealed on the server and shown nowhere.`);
  if (flags['no-wait']) return console.log(`request ${j.id}`);
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    await sleep(3000);
    let s; try { const p = await fetch(`${server()}/api/device/connect/${encodeURIComponent(j.id)}`, { headers: auth, signal: AbortSignal.timeout(15000) }); s = await p.json(); } catch { continue; }
    if (s.state === 'approved') return console.log(`✓ connected ${j.name}${s.read_only ? ' (read only)' : ''}`);
    if (s.state === 'denied') fail('declined on the board');
    if (s.state === 'expired') fail('the card expired — run this again');
    if (s.state === 'failed') fail(`allowed, but it could not be added: ${s.error || 'error'}`);
  }
  fail('no answer in 10 minutes — run this again', 75);
}

export async function connectCommand(pos, flags) {
  const target = pos[0];
  if (!target || !/^([a-z0-9][a-z0-9-]{0,39}|https:\/\/\S{4,400})$/.test(target)) { console.error('usage: boarder connect <service|https MCP URL> [--label <name>]\n       boarder connect <name> --key-file <file|-> [--base-url https://… --auth bearer|basic|header:<Name>|query:<name>] [--label <name>] [--write] [--no-wait]'); process.exit(1); }
  if (flags['key-file']) { if (target.startsWith('https://')) fail('--key-file takes a name (slack-team, github, imap …) — the address goes in --base-url', 64); return connectWithKey(target, flags); }
  const url = connectUrl(target, flags.label);
  console.log(`Connect ${target}${flags.label ? ` (${flags.label})` : ''} in Boarder: ${url}`);
  const open = flags.open || process.platform === 'darwin' || process.platform === 'win32';
  if (!open) return;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch {}
}
