import { readFileSync } from 'node:fs';
import { loadDevice, loadWindow, server } from './config.mjs';
import { windowKey, windowToken } from './window.mjs';

export const SETTINGS_HELP = `Board settings from this machine (show: any member machine · set: only after you allow this machine once on your board)
  boarder settings allow [--wait <s>]     put a card 「기기 … 설정 바꾸기 허용?」 on your board and wait for 「허용」 (default 600 s; exit 0 allowed · 1 declined/expired · 2 timed out)
  boarder settings show                   every value below and whether this machine may change them
  boarder settings revoke                 this machine gives the permission back
  boarder pins show | set <canvas id|url|id=title>… | set --none  sidebar pinned canvases (set replaces the list, 12 at most)
  boarder task-channels show | set on|off                         「채널 = 태스크」: open work items (#123) become channels
  boarder task-repo show | set <owner/repo> | set off             repo that a bare work number (#123) points to
  boarder front-door show | set --name "<name>" --fold "<node>"… [--alias "<old name>"…] | set off
                                                                  fold old front nodes into the Primary chat under one name
  boarder primary-window show | set <window:…|ew_…> | set off     window that gets Primary chat messages instead of the main bot
  boarder bot show | set --name "<name>"                          main bot name (look and pictures stay)
  boarder approve actions | <action> k=v…                         ask a person to approve a risky change by one-use link (they open it and press 계속): connection.disconnect · connection.read-only · connection.label · connection.tools · device.revoke · session-sync.on · bundle.set · rule.set
  boarder connections                                             your connections: id, service, status, read-only, how many tools are off (use the id with approve)
  boarder avatar show | set [--seed <word>] [--hue 0-359] [--photo <png|jpg|webp file> | --photo-id <id> | --no-photo]   your avatar (only the parts you pass change)
  boarder devices                                                 your machines on this board: name, tools, scope, last seen (revoking stays on the board screen)
  boarder windows [--since 2h|<ms>|<ISO>] [--task 1234] [--limit 100] [--cursor <next>] [--closed 0|1]
                                                                  every window that wrote a line to your board since (default 1 day): machine, window, name, task, last line, open/parked/closed, blocked, waiting (read only). A 30-day window drops closed windows unless --closed 1
  boarder node-values show | set check_min=30 split_at=3 move_h=24 rename_h=6 archive_h=6   node numbers (only the ones you pass change)
  boarder unit show | set goal|agent                              what a channel groups: one goal or one agent
  boarder prefs show | set park_on=false park_h=6 task_dots=true tree_tidy=true primary_item=auto rules.<key>=false bundles.<name>=false
                                                                  parking, main-bot window, harness rules and bundles (--json <file|-> for a whole object)
                                                                  phone-alert / external-send / account-autoswitch need a person on the board, not this command
  boarder side-hide show | set node|canvas|feed… | set --none     sidebar top rows to hide
  boarder ui show | set theme=dark accent=orange still=1 …        look and feel (same value ranges as the screen)
  boarder features show | set taskboard=on devboard=off           optional pages
  boarder session-sync show | set on|off                          keep (or stop) saving sessions
  boarder roles show | set <file.json|->                          role seat chart [{name, win, node?, primary?, fold?}…]
  boarder window show | renew                                     this window's key and name · get a new window token (never printed)
  Every set prints {before, after, undo}: run undo to put the old value back.
  The same permission also lets this machine upload screen scripts: \`boarder view overlay js\` and \`boarder harness wrapper ui on\` need it too.`;

const COMMANDS = { pins: 'pins', 'task-channels': 'task_channels', 'task-repo': 'task_repo', 'front-door': 'front_door', 'primary-window': 'primary_window', bot: 'bot_name',
  'node-values': 'node_values', unit: 'unit', prefs: 'prefs', 'side-hide': 'side_hide', ui: 'ui', features: 'features', 'session-sync': 'session_sync', avatar: 'avatar' };
const OBJECT_CMDS = new Set(['node-values', 'prefs', 'ui', 'features']);   // k=v 쌍(또는 --json)으로 받는 칸
export const COMMAND_KEYS = Object.values(COMMANDS);   // 서버 device-settings.ts KEYS 와 같아야 함(settings.test.mjs 가 대조)
export const SETTINGS_COMMANDS = ['settings', ...Object.keys(COMMANDS), 'roles', 'window', 'devices', 'windows', 'connections', 'approve'];

const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };
const out = j => console.log(JSON.stringify(j));
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;   // 되돌리는 명령의 셸 인용

async function call(method, p, body) {
  const d = loadDevice();
  if (!d?.token) fail('This machine is not set up for Boarder yet — run `boarder setup --yes`.', 3);
  const r = await fetch(`${server()}${p}`, { method, headers: { authorization: `Bearer ${d.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) fail('this machine was revoked, is not a member machine, or is watch-only — `boarder status`', 3);
  if (r.status === 403 && j.error === 'not_allowed') fail(`not allowed: ${j.hint || 'run `boarder settings allow` and press 「허용」 on your board'}`, 77);
  if (!r.ok || j.ok === false) fail(`${j.error || `server answered ${r.status}`}${j.missing ? ` (missing: ${j.missing.join(', ')})` : ''}`);
  return j;
}

/** 되돌리는 명령(전 값으로 다시 set) */
export function undoOf(cmd, before) {
  const b = `boarder ${cmd} set`;
  if (cmd === 'pins') return before?.length ? `${b} ${before.map(p => q(p.title && p.title !== p.id ? `${p.id}=${p.title}` : p.id)).join(' ')}` : `${b} --none`;   // 제목까지
  if (cmd === 'task-channels') return `${b} ${before ? 'on' : 'off'}`;
  if (cmd === 'task-repo' || cmd === 'primary-window') return `${b} ${before ? q(before) : 'off'}`;
  if (cmd === 'front-door') {
    if (!before) return `${b} off`;
    // --fold 는 찾을 노드 이름이라 짝(pairs) 이름만 — aliases 에는 지금 없는 이름도 있어 그대로 쓰면 404. 짝에 없는 aliases 는 --alias 로 살림
    const names = [...new Set(before.pairs.map(p => p.name))], aliases = before.aliases || [];
    const fold = [...new Set([...aliases.filter(a => names.includes(a)), ...names])];
    return `${b} --name ${q(before.name)} ${fold.map(n => `--fold ${q(n)}`).join(' ')}${aliases.some(a => !names.includes(a)) ? ` ${aliases.map(n => `--alias ${q(n)}`).join(' ')}` : ''}`;
  }
  if (cmd === 'avatar') return before ? `${b} --seed ${q(before.seed)} --hue ${before.hue}${before.photo ? ` --photo-id ${before.photo}` : ' --no-photo'}` : null;
  if (cmd === 'bot') return before ? `${b} --name ${q(before)}` : null;   // 봇이 없던 때는 되돌릴 이름이 없음
  if (cmd === 'unit') return before ? `${b} ${before}` : null;
  if (cmd === 'session-sync') return before ? null : `${b} off`;   // 켜기는 사람 몫이라 되돌림 명령으로 안내하지 않음(서버가 approval_required)
  if (cmd === 'side-hide') return before?.length ? `${b} ${before.join(' ')}` : `${b} --none`;
  if (cmd === 'node-values' || cmd === 'ui' || cmd === 'features') {   // 납작한 칸은 k=v 그대로(에이전트가 바로 붙여 실행) — 전 값이 없던 칸(ui 의 빈 값)은 되돌릴 값이 없음
    const e = Object.entries(before && typeof before === 'object' ? before : {});
    return e.length ? `${b} ${e.map(([k, v]) => `${k}=${cmd === 'features' ? (v ? 'on' : 'off') : cmd === 'ui' ? q(v) : v}`).join(' ')}` : null;
  }
  if (cmd === 'prefs') return before && typeof before === 'object' ? `${b} --json - <<'JSON'\n${JSON.stringify(before)}\nJSON` : null;
  return null;
}
/** 명령 인자 → 서버에 보낼 값. 틀리면 null(사용법) */
export function valueOf(cmd, pos, flags) {
  const v = pos[0];
  if (cmd === 'pins') return flags.none ? [] : pos.length ? pos.map(x => { const m = /^([A-Za-z0-9_-]{4,64})=(.+)$/s.exec(x); return m ? { id: m[1], title: m[2] } : x; }) : null;
  if (cmd === 'task-channels') return v === 'on' ? true : v === 'off' ? false : null;
  if (cmd === 'task-repo') return v === 'off' ? '' : v || null;
  if (cmd === 'primary-window') return v === 'off' ? null : v || undefined;
  if (cmd === 'front-door') return v === 'off' ? null : flags.name && flags.fold?.length ? { name: flags.name, fold: flags.fold, ...(flags.alias?.length ? { aliases: flags.alias } : {}) } : undefined;
  if (cmd === 'bot') return flags.name || null;
  if (cmd === 'unit') return v === 'goal' || v === 'agent' ? v : undefined;
  if (cmd === 'session-sync') return v === 'on' ? true : v === 'off' ? false : undefined;
  if (cmd === 'side-hide') return flags.none ? [] : pos.length ? pos : undefined;
  if (OBJECT_CMDS.has(cmd)) return pairsOf(cmd, pos, flags);
  return undefined;
}
export function pairsOf(cmd, pos, flags) {
  if (flags.json !== undefined) { try { const o = JSON.parse(flags.json === true || flags.json === '-' ? readFileSync(0, 'utf8') : readFileSync(flags.json, 'utf8')); return o && typeof o === 'object' && !Array.isArray(o) ? o : undefined; } catch { return undefined; } }
  if (!pos.length) return undefined;
  const out = {};
  for (const x of pos) {
    const m = /^([A-Za-z0-9_]+)(?:\.([A-Za-z0-9_-]+))?=(.*)$/s.exec(x); if (!m) return undefined;
    const [, k, sub, raw] = m;
    const v = cmd === 'ui' ? raw : cmd === 'features' ? (raw === 'on' || raw === 'true' ? true : raw === 'off' || raw === 'false' ? false : undefined)
      : cmd === 'node-values' ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
    if (v === undefined) return undefined;
    if (sub) (out[k] ||= {})[sub] = v; else out[k] = v;
  }
  return out;
}
const readJsonArg = p => JSON.parse(p === '-' ? readFileSync(0, 'utf8') : readFileSync(p, 'utf8'));
const seatIn = s => Object.fromEntries(Object.entries({ name: s.name, win: s.win, node: s.node, primary: s.primary, fold: s.fold }).filter(([, x]) => x !== undefined && x !== null && x !== false));

async function allow(flags) {
  const first = await call('POST', '/api/device/settings/allow', {});
  if (first.allowed) return out({ ok: true, allowed: true, note: 'this machine may already change board settings' });
  console.error(`A card 「설정 바꾸기 허용?」 is on your board — press 「허용」 there (card ${first.card_id}).`);
  const until = Date.now() + (Number(flags.wait) || 600) * 1000;
  for (;;) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await call('GET', '/api/device/settings/allow');
    if (s.allowed) return out({ ok: true, allowed: true, card_id: first.card_id });
    if (!s.pending) { out({ ok: false, allowed: false, card_id: first.card_id, note: 'declined or expired' }); process.exit(1); }
    if (Date.now() > until) { out({ ok: false, allowed: false, pending: true, card_id: first.card_id }); process.exit(2); }
  }
}

/** boarder windows 질의: --since 는 30m · 2h · 1d(지금부터 거꾸로)나 밀리초 · ISO 그대로 */
export function windowsPath(flags, now = Date.now()) {
  const qs = new URLSearchParams(), rel = /^(\d{1,4})([mhd])$/.exec(String(flags.since ?? ''));
  if (rel) qs.set('since', String(now - Number(rel[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2]]));
  else if (typeof flags.since === 'string') qs.set('since', flags.since);
  for (const k of ['task', 'limit', 'cursor', 'closed']) if (typeof flags[k] === 'string' || typeof flags[k] === 'number') qs.set(k, String(flags[k]));
  const q = qs.toString(); return '/api/device/windows' + (q ? '?' + q : '');
}

export async function settingsCommand(cmd, sub, pos, flags) {
  if (cmd === 'settings') {
    if (sub === 'allow') return allow(flags);
    if (sub === 'show') return out(await call('GET', '/api/device/settings'));
    if (sub === 'revoke') return out(await call('DELETE', '/api/device/settings/allow'));
    fail(SETTINGS_HELP, 64);
  }
  if (cmd === 'approve') {   // 건건 승인 링크: 허락 카드와 별개로, 바꿀 때마다 사람이 링크를 열어 「계속」
    if (sub === 'actions' || !sub) return out(await call('GET', '/api/device/approval-actions'));
    const params = pairsOf('approve', pos, {}) ?? (pos.length ? undefined : {});
    if (params === undefined) fail('usage: boarder approve <action> k=v … (boarder approve actions lists them)', 64);
    const r = await call('POST', '/api/device/approval-link', { action: sub, params });
    console.log(`Give this link to the person (one use, ${Math.round(r.expires_in / 60)} min): ${r.url}`);
    return console.log(`It will: ${r.summary}`);
  }
  if (cmd === 'connections') return out(await call('GET', '/api/device/connections'));
  if (cmd === 'devices') return out(await call('GET', '/api/device/devices'));
  if (cmd === 'windows') return out(await call('GET', windowsPath(flags)));
  if (cmd === 'window') {
    const w = windowKey();
    if (sub === 'show') return out({ key: w.key, name: w.name, server: server(), token_saved: !!loadWindow(w.key)?.token, env_token: !!process.env.BOARDER_TOKEN?.trim() });
    if (sub === 'renew') {
      if (process.env.BOARDER_TOKEN?.trim()) fail('this window uses BOARDER_TOKEN from its environment — renew it where that token is made (the harness), not here');
      const n = await windowToken({ fresh: true });
      return out({ ok: true, key: n.key, name: n.name, note: 'new window token saved for this window (not shown); the old one for this window stops working' });
    }
    fail(SETTINGS_HELP, 64);
  }
  if (cmd === 'roles') {
    if (sub === 'show') return out(await call('GET', '/api/device/roles'));
    if (sub === 'set') {
      if (!pos[0]) fail(SETTINGS_HELP, 64);
      const raw = readJsonArg(pos[0]), roles = Array.isArray(raw) ? raw : raw?.roles;
      if (!Array.isArray(roles)) fail('roles: a JSON list [{name, win, node?, primary?, fold?}…] or {"roles": […]}', 64);
      const was = await call('GET', '/api/device/roles'), before = was.roles || (was.seats || []).map(seatIn);   // 옛 서버는 roles 칸이 없음
      const frontBefore = (await call('GET', '/api/device/settings')).values?.front_door ?? null;
      const r = await call('POST', '/api/device/roles', { roles });
      // 앞단 접기: 이 표가 바꿨거나(front) 옛 표를 다시 올리면 fold 로 다시 채워지므로(before 의 fold) 전 값까지 되돌림
      const undoFront = r.front || before.some(s => s.fold?.length) ? `\n${undoOf('front-door', frontBefore)}` : '';
      return out({ ok: true, key: 'roles', before, after: r.seats, ...(r.front ? { front: r.front } : {}), front_door_before: frontBefore, undo: `boarder roles set - <<'JSON'\n${JSON.stringify(before)}\nJSON${undoFront}` });
    }
    fail(SETTINGS_HELP, 64);
  }
  const key = COMMANDS[cmd]; if (!key) fail(SETTINGS_HELP, 64);
  if (cmd === 'avatar' && sub === 'set') {   // 사진 파일은 먼저 올려 id 로 바꿈(서버가 PNG · JPEG · WebP 만 받음)
    const value = {};
    if (flags.seed !== undefined) value.seed = String(flags.seed);
    if (flags.hue !== undefined) value.hue = Number(flags.hue);
    if (flags['photo-id']) value.photo = String(flags['photo-id']);
    if (flags['no-photo']) value.photo = '';
    if (flags.photo) {
      const d = loadDevice(); if (!d?.token) fail('This machine is not set up for Boarder yet — run `boarder setup --yes`.', 3);
      let bytes; try { bytes = readFileSync(flags.photo); } catch (e) { fail(`could not read the photo (${e.code || 'error'})`); }
      const hex = bytes.subarray(0, 12).toString('hex'), mime = hex.startsWith('89504e470d0a1a0a') ? 'image/png' : hex.startsWith('ffd8ff') ? 'image/jpeg' : hex.startsWith('52494646') && hex.slice(16, 24) === '57454250' ? 'image/webp' : '';
      if (!mime || bytes.length > 1_500_000) fail('사진은 PNG · JPEG · WebP, 1,500,000바이트까지예요');
      const { uploadDirect } = await import('./direct-upload.mjs');
      const response = async r => {
        const j = await r.json().catch(() => ({}));
        if (r.status === 403 && j.error === 'not_allowed') fail(`not allowed: ${j.hint || 'run `boarder settings allow` and press 「허용」 on your board'}`, 77);
        if (!r.ok) throw Object.assign(new Error(j.error || `server answered ${r.status}`), {status: r.status, code: j.code}); return j;
      };
      const control = async (action, body) => response(await fetch(`${server()}/api/device/avatar-image/${action}`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) }));
      const legacy = async () => response(await fetch(`${server()}/api/device/avatar-image`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/octet-stream' }, body: bytes, signal: AbortSignal.timeout(60_000) }));
      const j = await uploadDirect(new Blob([bytes], {type: mime}), {control, legacy, init: {size: bytes.length, mime}});
      value.photo = j.id;
    }
    if (!Object.keys(value).length) fail(SETTINGS_HELP, 64);
    const r = await call('POST', '/api/device/settings', { key, value });
    return out({ ok: true, key, before: r.before, after: r.after, undo: undoOf(cmd, r.before) });
  }
  if (sub === 'show') { const j = await call('GET', '/api/device/settings'); return out({ key, value: j.values?.[key] ?? null, allowed: !!j.allowed }); }
  if (sub !== 'set') fail(SETTINGS_HELP, 64);
  const value = valueOf(cmd, pos, flags);
  if (value === undefined || (value === null && !['primary-window', 'front-door'].includes(cmd))) fail(SETTINGS_HELP, 64);
  const r = await call('POST', '/api/device/settings', { key, value });
  return out({ ok: true, key, before: r.before, after: r.after, undo: undoOf(cmd, r.before) });
}
