#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import os from 'node:os';

const SOCK = process.env.CUSTOM_ENGINE_SOCKET || 'boarder-custom';
const tm = (...a) => execFileSync('tmux', ['-L', SOCK, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fail = (code, msg) => Object.assign(new Error(msg), { code });
const has = () => { try { tm('has-session', '-t', 'c'); return true; } catch { return false; } };
const wins = () => has() ? tm('list-windows', '-t', 'c', '-F', '#{@bx_id}\t#{window_id}\t#{@bx_h}').split('\n').filter(Boolean).map(l => { const [id, w, h] = l.split('\t'); return { id, w, handle: h ? JSON.parse(Buffer.from(h, 'base64url')) : null }; }).filter(x => x.id) : [];
const find = id => wins().find(x => x.id === id) || null;

const VERBS = {
  // spec: { id, name, cwd, prompt, model, perm, system, session_id, argv?, test? } — in a self-test Boarder sends argv (a tiny echo program) instead of an AI tool
  open(s) {
    const sid = s.session_id || randomUUID();
    const argv = s.argv?.length ? s.argv : ['claude', ...(s.model ? ['--model', s.model] : []), s.resume ? '--resume' : '--session-id', sid, ...(s.prompt ? [s.prompt] : [])];
    const cwd = (s.cwd || '~').replace(/^~/, os.homedir());
    const head = has() ? ['new-window', '-d', '-t', 'c:'] : ['new-session', '-d', '-s', 'c', '-x', '200', '-y', '50'];
    const w = tm(...head, '-P', '-F', '#{window_id}', '-c', cwd, '-e', `BOARDER_WINDOW=${s.id}`, '--', ...argv).trim();
    tm('set-option', '-w', '-t', w, '@bx_id', s.id);
    tm('set-option', '-w', '-t', w, '@bx_h', Buffer.from(JSON.stringify({ ...s, prompt: undefined, resume: undefined, session_id: sid })).toString('base64url'));
    return { id: s.id, session_id: sid };
  },
  send({ id, text }) {
    const x = find(id); if (!x) throw fail(4, 'no such window');
    spawnSync('tmux', ['-L', SOCK, 'load-buffer', '-b', 'cx', '-'], { input: text });
    tm('paste-buffer', '-d', '-b', 'cx', '-t', x.w); tm('send-keys', '-t', x.w, 'Enter');
    return { ok: true };
  },
  state({ id }) { return find(id) ? { id, state: 'idle' } : { id, state: 'none' }; },   // a real engine reports busy · idle · waiting · background (or calls `boarder engine event`)
  park({ id }) { const x = find(id); if (!x) throw fail(4, 'no such window'); tm('kill-window', '-t', x.w); return { handle: { ...x.handle, id } }; },
  reopen({ handle, text, id }) { return VERBS.open({ ...handle, id: id || handle.id, prompt: text || undefined, resume: !handle.argv }); },
  close({ id }) { const x = find(id); if (x) tm('kill-window', '-t', x.w); return { ok: true }; },
  list() { return { windows: wins().map(x => ({ id: x.id })) }; },
};

if (process.argv[2] === '--serve') {
  const port = +process.argv[3] || 7788;
  http.createServer((q, r) => {
    let body = ''; q.on('data', d => { body += d; });
    q.on('end', () => {
      const verb = (q.url || '').slice(1), out = (code, o) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
      // only Boarder on this machine can call us: `boarder engine verify` checks the signature with this device's key
      const ok = spawnSync('boarder', ['engine', 'verify', String(q.headers['x-boarder-signature'] || '')], { input: body }).status === 0;
      if (!ok) return out(401, { error: 'bad signature' });
      if (!VERBS[verb]) return out(404, { error: 'unknown verb' });
      try { out(200, VERBS[verb](JSON.parse(body || '{}'))); } catch (e) { out(e.code === 2 ? 409 : e.code === 4 ? 404 : 500, { error: e.message }); }
    });
  }).listen(port, '127.0.0.1', () => console.log(`custom engine on http://127.0.0.1:${port}`));
} else {
  const verb = process.argv[2]; let input = '';
  process.stdin.on('data', d => { input += d; });
  process.stdin.on('end', () => {
    if (!VERBS[verb]) { console.error('unknown verb'); process.exit(1); }
    try { process.stdout.write(JSON.stringify(VERBS[verb](JSON.parse(input || '{}')))); }
    catch (e) { console.error(e.message); process.exit(e.code === 2 ? 2 : e.code === 4 ? 4 : 1); }
  });
}
