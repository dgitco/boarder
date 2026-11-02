import { loadDevice, server } from './config.mjs';

export const DEVICE_HELP = `Approve a new machine from this one (instead of a browser)
  boarder device approve <code>     the new machine shows the code (boarder setup --email <you> or --device-auth); shows that machine here and opens the approve page in this machine's browser
  boarder device deny <code>        decline that request`;

const AGENT_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX', 'CODEX_MANAGED_BY_NPM', 'GEMINI_CLI', 'CURSOR_AGENT', 'BOARDER_WINDOW_TOKEN'];
const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };

async function openPage(url) {
  const { spawn } = await import('node:child_process');
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) ? ['xdg-open', [url]] : null;
  if (!cmd) return;
  try { const ch = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }); ch.on('error', () => {}); ch.unref(); } catch {}
}

export async function deviceCommand(sub, args) {
  if (sub !== 'approve' && sub !== 'deny') fail(DEVICE_HELP, 64);
  const code = String(args[0] || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) fail('the code looks like ABCD-EFGH — the new machine prints it', 64);
  const d = loadDevice(); if (!d?.token) fail('this machine is not signed in — run `boarder setup` here first, or approve in a browser', 3);
  const agent = AGENT_ENV.find(k => process.env[k]);
  if (!process.stdin.isTTY || !process.stdout.isTTY || agent) fail(`a person has to run this in a terminal${agent ? ` (this looks like an AI tool's shell: ${agent})` : ''} — or answer the card on your board`, 77);
  const auth = { authorization: `Bearer ${d.token}` };
  const r = await fetch(`${server()}/api/device/lookup-by-device?code=${encodeURIComponent(code)}`, { headers: auth, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) fail('this machine was revoked or is not a member machine — sign in again with `boarder setup`', 3);
  if (!r.ok) fail({ unknown: 'no request with that code', done: 'that request was already answered', expired: 'that code expired — run setup on the new machine again' }[j.error] || `server answered ${r.status}`);
  if (j.mode === 'local') fail('that code waits for a browser on the new machine — on the new machine run `boarder setup --email <you>` (or --device-auth) for a code this command can approve');
  const mins = Math.max(0, Math.round((Date.now() - j.at) / 60000));
  console.log(`New machine: ${j.name || '(no name)'}${j.tools ? ` · ${j.tools}` : ''}\nAsked ${mins} min ago${j.country ? ` from ${j.country}` : ''}${j.same ? ' · same network as this machine' : ' · a different network from this machine'}`);
  if (sub === 'approve') {
    // 허용은 사람 길로만(서버가 기기 토큰의 허용을 403 으로 막음) — 이 기기 브라우저의 허용 화면(로그인 세션)
    const url = `${server()}/device?code=${encodeURIComponent(code)}`;
    console.log(`To let it in, press 「허용」 on the approve page (signed in to Boarder): ${url}\nOr type ${code} into the card 「새 기기 … 허용?」 on your board.`);
    await openPage(url);
    return;
  }
  const p = await fetch(`${server()}/api/device/approve-by-device`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ user_code: code, allow: sub === 'approve' }), signal: AbortSignal.timeout(15000) });
  const pj = await p.json().catch(() => ({}));
  if (!p.ok) fail({ unknown: 'no request with that code', done: 'that request was already answered', expired: 'that code expired', browser: 'that code waits for a browser on the new machine' }[pj.error] || `server answered ${p.status}`);
  console.log(sub === 'approve' ? `✓ allowed ${pj.name || 'the new machine'} — it finishes signing in by itself` : `✓ declined ${pj.name || 'the request'}`);
}
