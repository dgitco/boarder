import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { dir, loadDevice, readJson, server, sha, writeSecret } from './config.mjs';

export const BATCH = 500, MAX_BYTES = 3_500_000;
const NOISE = new Set(['channel_join', 'channel_leave', 'group_join', 'group_leave']);   // 들어옴 · 나감 알림은 대화가 아님
const TS = /^\d{10}\.\d{6}$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 폴더 읽기 — 채널 목록 · 사람 이름표. 틀리면 무엇이 빠졌는지 말하고 던짐 */
export function readExport(folder) {
  const f = n => path.join(folder, n);
  if (!existsSync(f('channels.json'))) throw new Error(`${f('channels.json')} 이 없어요 — 내보내기 폴더를 주세요`);
  const channels = JSON.parse(readFileSync(f('channels.json'), 'utf8'));
  if (!Array.isArray(channels)) throw new Error('channels.json 은 [{id, name, …}] 목록이어야 해요');
  const users = new Map((existsSync(f('users.json')) ? JSON.parse(readFileSync(f('users.json'), 'utf8')) : []).map(u => [String(u.id), String(u.name || u.id)]));
  return { channels: channels.filter(c => c && /^[A-Z][A-Z0-9]{5,20}$/.test(String(c.id)) && c.name), users };
}

/** 채널 한 개의 글(ts 순) — 들어옴 · 나감 · 꼴 틀린 줄은 건너뜀으로 셈. <@U…> 는 @이름 으로 */
export function channelMessages(folder, chan, users) {
  const p = path.join(folder, `${chan.id}.ndjson`);
  if (!existsSync(p)) return { msgs: [], noise: 0, missing: true };
  const out = [], seen = new Set(); let noise = 0;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { noise++; continue; }
    if (!m || !TS.test(String(m.ts)) || NOISE.has(m.subtype) || seen.has(m.ts)) { noise++; continue; }
    seen.add(m.ts);
    const text = String(m.text ?? '').replace(/<@([A-Z0-9]{6,20})(?:\|[^>]*)?>/g, (_, id) => '@' + (users.get(id) || id));
    out.push({
      ts: m.ts, ...(TS.test(String(m.thread_ts)) && m.thread_ts !== m.ts ? { thread_ts: m.thread_ts } : {}),
      user: String(m.user || '').slice(0, 40), user_name: String(m.user_name || users.get(m.user) || m.user || '').slice(0, 200),
      text: text.slice(0, 12_000),
      ...(Array.isArray(m.files) && m.files.length ? { files: m.files.slice(0, 50).map(x => ({ name: String(x?.name ?? '').slice(0, 400), permalink: String(x?.permalink ?? '').slice(0, 1000) })) } : {}),
      ...(Array.isArray(m.reactions) && m.reactions.length ? { reactions: m.reactions.slice(0, 50).filter(r => r?.name).map(r => ({ name: String(r.name).slice(0, 100), count: Math.max(0, Math.min(100_000, Number(r.count) | 0)) })) } : {}),
      ...(m.subtype ? { subtype: String(m.subtype).slice(0, 60) } : {}),
    });
  }
  out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { msgs: out, noise, missing: false };
}

/** 글 ≤BATCH · 몸통 ≤MAX_BYTES 묶음으로 */
export function batches(msgs, channel) {
  const out = []; let cur = [], size = Buffer.byteLength(JSON.stringify({ channel, messages: [] }));
  for (const m of msgs) {
    const n = Buffer.byteLength(JSON.stringify(m)) + 1;
    if (cur.length && (cur.length >= BATCH || size + n > MAX_BYTES)) { out.push(cur); cur = []; size = Buffer.byteLength(JSON.stringify({ channel, messages: [] })); }
    cur.push(m); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

const markPath = folder => { const d = loadDevice() || {}; return path.join(dir(), 'slack-import', sha(`${d.server || server()}|${d.device_id || ''}|${path.resolve(folder)}`).slice(0, 32) + '.json'); };

async function devicePost(body) {
  const d = loadDevice(); if (!d?.token) { const e = new Error('This machine is not set up for Boarder yet — run `boarder setup --yes`.'); e.code = 'NO_DEVICE'; throw e; }
  const r = await fetch(`${server()}/api/me/import/slack`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${d.token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const j = await r.json().catch(() => ({ error: `Boarder ${r.status}` }));
  return { status: r.status, j };
}

/**
 * 들여오기. post(body) → {status, j} 를 바꿔 끼울 수 있음(시험). 돌려줌: {channels, sent, skipped, stopped?}
 * 다시 보내기: 망 오류 · 5xx 는 세 번까지(2 · 4 · 8초), 429(하루 상한)는 표를 남기고 멈춤 — 다음 날 같은 명령으로 이어서
 */
export async function slackImport(folder, flags = {}, { post = devicePost, log = console.log, mark = markPath(folder), wait = sleep } = {}) {
  if (!folder) throw new Error('usage: boarder import slack <export folder> [--dry-run]');
  const dry = !!flags['dry-run'];
  const { channels, users } = readExport(folder);
  const st = readJson(mark, null) || { v: 1, chans: {} };
  const tot = { channels: 0, sent: 0, skipped: 0, already: 0 };
  for (const ch of channels) {
    const { msgs, noise, missing } = channelMessages(folder, ch, users);
    if (missing) { log(`  #${ch.name}: ${ch.id}.ndjson 없음 — 건너뜀`); continue; }
    const done = st.chans[ch.id]?.last_ts || '';
    const todo = msgs.filter(m => m.ts > done);
    tot.skipped += noise; tot.already += msgs.length - todo.length;
    const channel = { id: ch.id, name: String(ch.name).slice(0, 200), ...(ch.workspace ? { workspace: String(ch.workspace).slice(0, 200) } : {}), is_private: !!ch.is_private, ...(ch.topic ? { topic: String(ch.topic).slice(0, 2000) } : {}) };
    const bs = batches(todo, channel);
    if (dry) { log(`  #${ch.name}: 글 ${msgs.length} · 올릴 것 ${todo.length}(묶음 ${bs.length}) · 건너뜀 ${noise}${done ? ' · 앞서 올린 것 ' + (msgs.length - todo.length) : ''}`); tot.channels++; tot.sent += todo.length; continue; }
    let inChan = 0, capped = false;
    for (const b of bs) {
      let res;
      for (let i = 0; ; i++) {
        try { res = await post({ channel, messages: b }); } catch (e) { if (e.code === 'NO_DEVICE') throw e; res = { status: 0, j: { error: e.message } }; }
        if (res.status === 0 || res.status >= 500) { if (i < 3) { await wait(2000 * 2 ** i); continue; } }
        break;
      }
      if (res.status === 429 && res.j?.max_channels) {   // 채널 수 상한 — 이 채널만 못 넣음, 다음 채널로(하루 상한과 달리 내일 풀리지 않음)
        log(`  #${ch.name}: 채널 수 상한(${res.j.max_channels})이라 못 넣음 — 건너뜀`); tot.capped = (tot.capped || 0) + 1; tot.skipped += todo.length; capped = true; break;
      }
      if (res.status === 429) {
        writeSecret(mark, st);
        log(`멈춤: ${res.j.error || '상한'}${res.j.left !== undefined ? ` (오늘 남은 글 ${res.j.left})` : ''} — 내일 같은 명령으로 이어서 올려요`);
        log(`채널 ${tot.channels} · 글 ${tot.sent} · 건너뜀 ${tot.skipped + tot.already}`);
        return { ...tot, stopped: 'limit' };
      }
      if (res.status !== 200) { writeSecret(mark, st); throw new Error(`#${ch.name} 올리기 실패(${res.status || '망'}): ${res.j?.error || ''} — 같은 명령으로 이어서 올려요`); }
      tot.sent += Number(res.j.inserted || 0); tot.skipped += Number(res.j.skipped || 0) + Number(res.j.bad || 0); inChan += Number(res.j.inserted || 0);
      st.chans[ch.id] = { last_ts: b[b.length - 1].ts, node: res.j.node, name: res.j.name };
      writeSecret(mark, st);   // 묶음마다 — 끊기면 다음 묶음부터
    }
    if (capped) continue;
    tot.channels++;
    log(`  #${ch.name} → 「${st.chans[ch.id]?.name || ch.name}」 새 글 ${inChan}`);
  }
  log(`${dry ? '(시험 — 안 올림) ' : ''}채널 ${tot.channels} · 글 ${tot.sent} · 건너뜀 ${tot.skipped + tot.already}`);
  return tot;
}
