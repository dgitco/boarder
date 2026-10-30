import readline from 'node:readline';
import { server } from './config.mjs';
import { windowToken } from './window.mjs';

export async function mcp() {
  let tok = null;
  const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
  const fail = (id, message) => id !== undefined && id !== null && send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
  async function forward(body, retry = true) {
    tok ||= (await windowToken()).token;
    const r = await fetch(`${server()}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tok}` }, body, signal: AbortSignal.timeout(660000) });
    if (r.status === 401 && retry) { tok = (await windowToken({ fresh: true })).token; return forward(body, false); }
    return r;
  }
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set();
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { return; }
    const p = (async () => {
      try {
        const r = await forward(line);
        const text = await r.text();
        if (!text.trim()) return;   // 알림(notification)은 답 없음
        if (!r.ok) { let e; try { e = JSON.parse(text).error; } catch {} return fail(msg.id, typeof e === 'string' ? e : `Boarder ${r.status}`); }
        if ((r.headers.get('content-type') || '').includes('text/event-stream')) {
          for (const l of text.split('\n')) if (l.startsWith('data:')) process.stdout.write(l.slice(5).trim() + '\n');
        } else process.stdout.write(text.trim() + '\n');
      } catch (e) { fail(msg.id, e instanceof Error ? e.message : String(e)); }
    })();
    pending.add(p); p.finally(() => pending.delete(p));
  });
  await new Promise(r => rl.on('close', r));
  await Promise.allSettled([...pending]);
}
