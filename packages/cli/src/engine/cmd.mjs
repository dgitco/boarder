import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { loadDevice, server } from '../config.mjs';
import * as E from './index.mjs';
import { runDaemon, installService, removeService, writeEvent } from './daemon.mjs';

export const ENGINE_HELP = `Engine (lets Boarder open, wake, park and reopen AI windows on this machine)
  boarder engine setup [--no-service]      find or install tmux, find Claude Code, self-test, start the engine service
  boarder engine status                    engines, what they can do, the service, open windows
  boarder engine test [<engine>]           self-test the six verbs (open · send · state · park · reopen · close)
  boarder engine add <name> --exec <file> | --url <http://127.0.0.1:…>   attach your own engine (spec: docs/engine-adapter.md)
  boarder engine remove <name>
  boarder engine event <window id> <busy|idle|waiting|background|none>  state hook for custom engines
  boarder engine default <engine>          engine for new windows on this machine
  boarder engine primary on|off            whether Boarder may start your Primary (main bot) window on this machine
  boarder engine open --name <name> [--cwd <folder>] [--prompt <first message>] [--config-dir <Claude config folder>] [--device <device id>]
                                           open a window now, without a role card (Primary chat gets one line)
  boarder engine verify <signature>        for HTTP engines: exit 0 if the request body on stdin was signed by Boarder on this machine
  boarder engine run                       the engine service itself (setup starts it)
  boarder engine stop                      stop and remove the service`;

export async function ensureEngine({ log = console.log, service = true } = {}) {
  const cfg = E.loadCfg();
  const t = await E.ensureTmux({ log });
  cfg.tmux = t.path;
  cfg.claude = E.which('claude') || cfg.claude || null;
  cfg.path = process.env.PATH;
  cfg.default ||= 'tmux';
  E.saveCfg(cfg);
  log(`tmux: ${t.path} (${t.how})`);
  log(cfg.claude ? `Claude Code: ${cfg.claude}` : 'Claude Code: not found — install it and sign in (claude), then run `boarder engine setup` again');
  log('Self-test (tmux):');
  const r = await E.selfTest('tmux', { log: l => log(l) });
  log(`tmux can: ${r.caps.join(' · ') || 'nothing'}`);
  const hb = E.which('herdr');
  if (hb) { const c2 = E.loadCfg(); c2.herdr = hb; E.saveCfg(c2); if (E.adapters(c2).herdr) { log('Self-test (Herdr):'); const h = await E.selfTest('herdr', { log: l => log(l) }); log(`Herdr can: ${h.caps.join(' · ') || 'nothing'}`); } else log('Herdr: installed but its server is not running — start `herdr` to use it'); }
  let svc = null;
  if (service) { svc = await installService(); log(`Engine service: ${svc.ok ? svc.how : svc.why}`); }
  return { tmux: t, claude: cfg.claude, caps: r.caps, service: svc };
}

export async function engineCommand(sub, pos, flags) {
  if (!sub || sub === 'help') return console.log(ENGINE_HELP);
  if (sub === 'run') return runDaemon();
  if (sub === 'setup') { if (!loadDevice()?.token) { console.error('not signed in — run `boarder setup --yes` first'); process.exit(3); } const r = await ensureEngine({ service: !flags['no-service'] }); if (!r.caps.length) process.exitCode = 1; return; }
  if (sub === 'stop') { const d = await removeService(); return console.log(d.length ? `engine service removed (${d.join(', ')})` : 'engine service was not installed'); }
  if (sub === 'test') { const name = pos[0] || 'tmux'; console.log(`Self-test (${name}):`); const r = await E.selfTest(name, { log: console.log }); console.log(`caps: ${r.caps.join(' · ') || 'none'}`); if (r.caps.length < E.VERBS.length) process.exitCode = 1; return; }
  if (sub === 'add') {
    const name = pos[0]; if (!/^[a-z][a-z0-9-]{1,30}$/.test(name || '') || ['tmux', 'herdr'].includes(name)) { console.error('name: lowercase letters, digits, - (not tmux or herdr)'); process.exit(64); }
    let def;
    if (flags.exec) { const f = path.resolve(flags.exec); if (!existsSync(f) || !(statSync(f).mode & 0o111)) { console.error(`${f} is not an executable file`); process.exit(64); } def = { exec: f }; }
    else if (flags.url) { const u = new URL(flags.url); if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname) && !flags['allow-remote']) { console.error('use a local address (127.0.0.1) — add --allow-remote if you really mean another machine'); process.exit(64); } def = { url: u.toString().replace(/\/+$/, '') }; }
    else { console.error('give --exec <file> or --url <address>'); process.exit(64); }
    const cfg = E.loadCfg(); (cfg.custom ||= {})[name] = def; E.saveCfg(cfg);
    console.log(`added engine ${name} — self-test:`);
    const r = await E.selfTest(name, { log: console.log });
    console.log(`caps: ${r.caps.join(' · ') || 'none'} (Boarder avoids what is missing)`);
    return;
  }
  if (sub === 'remove') { const cfg = E.loadCfg(); if (!cfg.custom?.[pos[0]]) { console.error('no such custom engine'); process.exit(1); } delete cfg.custom[pos[0]]; delete cfg.caps?.[pos[0]]; if (cfg.default === pos[0]) cfg.default = 'tmux'; E.saveCfg(cfg); return console.log(`removed ${pos[0]}`); }
  if (sub === 'default') { const cfg = E.loadCfg(); if (!E.adapters(cfg)[pos[0]]) { console.error('no such engine here'); process.exit(1); } cfg.default = pos[0]; E.saveCfg(cfg); return console.log(`default engine: ${pos[0]}`); }
  if (sub === 'primary') {
    const v = pos[0]; if (!['on', 'off'].includes(v)) { console.error('boarder engine primary on|off'); process.exit(64); }
    const cfg = E.loadCfg(); cfg.no_primary = v === 'off'; E.saveCfg(cfg);
    return console.log(v === 'off' ? 'Primary will not start on this machine (takes effect when the engine reconnects — run `boarder engine setup` or restart the engine service)' : 'Primary may start on this machine again (after the engine reconnects)');
  }
  if (sub === 'open') {
    const dev = loadDevice(); if (!dev?.token) { console.error('not signed in — run `boarder setup --yes` first'); process.exit(3); }
    if (!flags.name) { console.error('give --name <window name>'); process.exit(64); }
    const body = { name: flags.name, ...(flags.cwd ? { cwd: flags.cwd } : {}), ...(flags.prompt ? { prompt: flags.prompt } : {}), ...(flags['config-dir'] ? { config_dir: flags['config-dir'] } : {}), ...(flags.device ? { device: flags.device } : {}) };
    const r = await fetch(`${server()}/api/engine/open`, { method: 'POST', headers: { authorization: `Bearer ${dev.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { console.error(`could not open: ${j.error || r.status}`); process.exit(1); }
    return console.log(`opened ${j.id} on ${j.device}`);
  }
  if (sub === 'verify') { let body = ''; for await (const d of process.stdin) body += d; process.exit(E.verify(pos[0], body) ? 0 : 1); }
  if (sub === 'event') { const st = pos[1]; if (!pos[0] || !['busy', 'idle', 'waiting', 'background', 'none'].includes(st)) { console.error('boarder engine event <window id> <busy|idle|waiting|background|none>'); process.exit(64); } writeEvent({ id: pos[0], state: st }); return; }
  if (sub === 'status') {
    const cfg = E.loadCfg(), a = E.adapters(cfg), wins = await E.listAll(cfg);
    const lines = [`default: ${E.pick(cfg) || 'none (report only)'}`];
    for (const n of Object.keys(a)) lines.push(`${n}: ${(cfg.caps?.[n] || []).join(' · ') || 'not self-tested — boarder engine test ' + n}${n === 'tmux' ? ` (${cfg.tmux || 'tmux'})` : cfg.custom?.[n]?.exec ? ` (${cfg.custom[n].exec})` : cfg.custom?.[n]?.url ? ` (${cfg.custom[n].url})` : ''}`);
    if (!Object.keys(a).length) lines.push('no engine — run `boarder engine setup`');
    lines.push(`Claude Code: ${cfg.claude || 'not found'}`);
    lines.push(`windows: ${wins.length ? wins.map(w => `${w.name} (${w.engine})`).join(', ') : 'none'}`);
    return console.log(lines.join('\n'));
  }
  console.error(ENGINE_HELP); process.exit(64);
}
