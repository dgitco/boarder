import path from 'node:path';

export const LABEL_PREFIX = 'co.dgit.harness.';

/** systemd 유닛 글 → { 절: { 키: [값…] } } (같은 키 여러 줄은 차례대로, 빈 값은 그 키를 비움 — systemd 와 같음) */
export function parseUnit(text) {
  const out = {}; let sec = null;
  for (const raw of String(text).split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || l.startsWith(';')) continue;
    const s = l.match(/^\[(.+)\]$/); if (s) { sec = (out[s[1]] ||= {}); continue; }
    const m = l.match(/^([A-Za-z0-9]+)\s*=\s*(.*)$/); if (!m || !sec) continue;
    if (m[2] === '') { sec[m[1]] = []; continue; }
    (sec[m[1]] ||= []).push(m[2]);
  }
  return out;
}

/** systemd 시간 길이("5min" · "1h 30min" · "90" · "2m") → 초. 모르는 꼴이면 null */
export function durationSec(v) {
  const U = { us: 1e-6, usec: 1e-6, ms: 1e-3, msec: 1e-3, s: 1, sec: 1, second: 1, seconds: 1, m: 60, min: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400, w: 604800, week: 604800, weeks: 604800 };
  const t = String(v || '').trim(); if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  let sum = 0, rest = t;
  const re = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)/i;
  while (rest.trim()) { const m = rest.match(re); if (!m || !(m[2].toLowerCase() in U)) return null; sum += Number(m[1]) * U[m[2].toLowerCase()]; rest = rest.slice(m[0].length); }
  return Math.round(sum);
}

const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const field = (s, lo, hi) => {   // "*" → null(아무 때), "5" → [5], "1,3" · "1..3" → 여러 값
  if (s === '*') return null;
  const vals = [];
  for (const part of s.split(',')) {
    const r = part.match(/^(\d+)(?:\.\.(\d+))?$/); if (!r) return undefined;
    const a = Number(r[1]), b = r[2] === undefined ? a : Number(r[2]);
    if (a < lo || b > hi || a > b) return undefined;
    for (let i = a; i <= b; i++) vals.push(i);
  }
  return vals;
};
/** OnCalendar 한 줄 → StartCalendarInterval 칸 배열(여러 값이면 여러 칸). 모르는 꼴이면 { skip } */
export function calendarOf(expr, { localTz } = {}) {
  let t = String(expr).trim();
  const alias = { minutely: '*-*-* *:*:00', hourly: '*-*-* *:00:00', daily: '*-*-* 00:00:00', weekly: 'Mon *-*-* 00:00:00', monthly: '*-*-01 00:00:00' }[t.toLowerCase()];
  if (alias) t = alias;
  const parts = t.split(/\s+/);
  // 끝의 시간대: 이 맥의 시간대와 같을 때만(launchd 는 기기 시간대로만 돎)
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^[A-Za-z]+(?:\/[A-Za-z_+-]+)+$|^UTC$/.test(last)) {
    if (!localTz || last !== localTz) return { skip: `OnCalendar ${expr} is in ${last}, this Mac runs in ${localTz || 'an unknown time zone'}` };
    parts.pop();
  }
  let dow = null;
  if (parts.length && /^[A-Za-z]/.test(parts[0])) {
    const d = [];
    for (const p of parts.shift().split(',')) {
      const r = p.toLowerCase().match(/^([a-z]{3})[a-z]*(?:\.\.([a-z]{3})[a-z]*)?$/);
      if (!r || !(r[1] in DOW) || (r[2] && !(r[2] in DOW))) return { skip: `OnCalendar ${expr} — unknown weekday` };
      const a = DOW[r[1]], b = r[2] ? DOW[r[2]] : a;
      if (a > b) return { skip: `OnCalendar ${expr} — weekday range wraps` };
      for (let i = a; i <= b; i++) d.push(i);
    }
    dow = d;
  }
  let date = '*-*-*', time;
  if (parts.length === 2) [date, time] = parts; else if (parts.length === 1) [time] = parts; else return { skip: `OnCalendar ${expr} — not a form launchd can run` };
  const dm = date.match(/^(\*|\d{4})-([\d.,*]+)-([\d.,*]+)$/); if (!dm || dm[1] !== '*') return { skip: `OnCalendar ${expr} — not a repeating date` };
  const tm = time.match(/^([\d.,*]+):([\d.,*]+)(?::([\d.,*]+))?$/); if (!tm) return { skip: `OnCalendar ${expr} — unknown time` };
  if (tm[3] !== undefined && !/^0+$/.test(tm[3])) return { skip: `OnCalendar ${expr} — launchd has no seconds` };
  const Month = field(dm[2], 1, 12), Day = field(dm[3], 1, 31), Hour = field(tm[1], 0, 23), Minute = field(tm[2], 0, 59);
  if ([Month, Day, Hour, Minute].includes(undefined)) return { skip: `OnCalendar ${expr} — unknown value` };
  if (Minute === null) return { skip: `OnCalendar ${expr} — every minute is not a calendar time here` };
  // 곱으로 펼침(launchd 칸 = 값 하나씩)
  let rows = [{}];
  for (const [k, vs] of [['Month', Month], ['Day', Day], ['Weekday', dow], ['Hour', Hour], ['Minute', Minute]]) {
    if (vs === null) continue;
    rows = rows.flatMap(r => vs.map(v => ({ ...r, [k]: v })));
  }
  if (rows.length > 100) return { skip: `OnCalendar ${expr} — too many times for launchd` };
  return { rows };
}

/** ExecStart 한 줄 → argv(systemd 따옴표 규칙 중 흔한 것: '…' · "…" · \ 이스케이프). 셸 꼴(|, &&, ;, >)은 sh -c 로 써야 하므로 그대로 둠 */
export function splitExec(line) {
  let s = String(line).trim().replace(/^[-@+!:]+/, '');   // systemd 앞 표시(- 실패 무시 · @ argv0 등)는 launchd 에 없음
  const out = []; let cur = '', q = null, has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; else cur += c; continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (q) return null;
  if (has || cur) out.push(cur);
  return out;
}

const expand = (v, h) => String(v).replace(/%h/g, h).replace(/%%/g, '%').replace(/^~(?=\/|$)/, h);
const envPairs = v => (splitExec(v) || []).map(p => { const i = p.indexOf('='); return i > 0 ? [p.slice(0, i), p.slice(i + 1)] : null; }).filter(Boolean);

/**
 * 유닛 하나(.service 글 + 있으면 .timer 글) → plist.
 * @returns {{ label, file, log, plist }} 또는 {{ skip }}
 */
export function unitToPlist({ name, service, timer, home, nodeDir, localTz }) {
  if (!/^[\w.@-]+$/.test(name || '')) return { skip: `bad unit name ${name}` };
  const sv = parseUnit(service).Service || {};
  const exec = sv.ExecStart || [];
  if (exec.length !== 1) return { skip: `${name} has ${exec.length} ExecStart lines — launchd runs one command` };
  if (/%[^h%]/.test(exec[0])) return { skip: `${name} uses systemd % names launchd does not know` };
  const argv = splitExec(expand(exec[0], home));
  if (!argv?.length) return { skip: `${name} ExecStart could not be read` };
  if ((sv.EnvironmentFile || []).length) return { skip: `${name} reads an EnvironmentFile — not converted` };
  const env = {};
  for (const v of sv.Environment || []) for (const [k, x] of envPairs(expand(v, home))) env[k] = x;
  const lead = [path.join(home, '.local', 'bin'), ...(nodeDir ? [nodeDir] : [])];
  const rest = String(env.PATH || '/usr/local/bin:/usr/bin:/bin').split(':').filter(Boolean);
  env.PATH = [...new Set([...lead, ...rest, '/opt/homebrew/bin'])].join(':');
  const label = LABEL_PREFIX + name;
  const log = path.join(home, 'Library', 'Logs', 'harness', `${name}.log`);
  const d = { Label: label, ProgramArguments: argv, EnvironmentVariables: env, StandardOutPath: log, StandardErrorPath: log };
  const wd = (sv.WorkingDirectory || []).at(-1);
  if (wd) d.WorkingDirectory = expand(wd.replace(/^-/, ''), home);
  if (timer != null) {
    const tm = parseUnit(timer).Timer || {};
    const every = (tm.OnUnitActiveSec || []).at(-1) ?? (tm.OnUnitInactiveSec || []).at(-1);
    const cal = tm.OnCalendar || [];
    if (every && cal.length) return { skip: `${name}.timer mixes an interval and OnCalendar` };
    if (every) {
      const n = durationSec(every); if (!n || n < 1) return { skip: `${name}.timer interval ${every} could not be read` };
      d.StartInterval = n;
    } else if (cal.length) {
      const rows = [];
      for (const c of cal) { const r = calendarOf(c, { localTz }); if (r.skip) return { skip: r.skip }; rows.push(...r.rows); }
      d.StartCalendarInterval = rows.length === 1 ? rows[0] : rows;
    } else if ((tm.OnBootSec || tm.OnStartupSec || []).length) d.RunAtLoad = true;   // 부팅 뒤 한 번
    else return { skip: `${name}.timer has no interval launchd can run` };
  } else {
    const wanted = (parseUnit(service).Install?.WantedBy || []).join(' ');
    if (!/\bdefault\.target\b/.test(wanted)) return { skip: `${name}.service is not started at login` };
    d.RunAtLoad = true;
    if ((sv.Type || []).at(-1) !== 'oneshot') d.KeepAlive = true;   // 늘 도는 서비스(simple)는 죽으면 다시
  }
  return { label, file: `${label}.plist`, log, plist: toPlist(d) };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function val(v, ind) {
  const p = '\t'.repeat(ind);
  if (Array.isArray(v)) return `${p}<array>\n${v.map(x => val(x, ind + 1)).join('')}${p}</array>\n`;
  if (v && typeof v === 'object') return `${p}<dict>\n${Object.entries(v).map(([k, x]) => `${p}\t<key>${esc(k)}</key>\n${val(x, ind + 1)}`).join('')}${p}</dict>\n`;
  if (typeof v === 'boolean') return `${p}<${v}/>\n`;
  if (Number.isInteger(v)) return `${p}<integer>${v}</integer>\n`;
  return `${p}<string>${esc(v)}</string>\n`;
}
/** 객체 → XML plist 글 */
export function toPlist(d) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${val(d, 0)}</plist>\n`;
}

/** 유닛 이름(start: work-save.timer · work-restore.service) → 라벨에 붙는 이름 */
export const unitName = start => String(start).replace(/\.(service|timer)$/, '');
