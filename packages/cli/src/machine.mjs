import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

export const MACHINE_HEADER = 'x-boarder-machine';
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });

/** 이 컴퓨터의 원문 기계 id — 이 파일 밖으로 내보내지 않음(열쇠만 내보냄). 시험은 platform · read · exec · hostname 을 바꿔 넣음 */
function rawId({ platform = process.platform, read = p => readFileSync(p, 'utf8'), exec = run, hostname = () => os.hostname() } = {}) {
  try {
    if (platform === 'linux') {
      for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) { try { const v = String(read(p)).trim(); if (v) return v; } catch {} }
    } else if (platform === 'darwin') {
      const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(exec('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']) || ''); if (m) return m[1];
    } else if (platform === 'win32') {
      const m = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(exec('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']) || ''); if (m) return m[1];
    }
  } catch {}
  try { return String(hostname() || '').trim(); } catch { return ''; }
}

export const machineKeyOf = id => createHash('sha256').update('boarder-machine:' + id).digest('hex').slice(0, 32);

let cached;
/** 열쇠(32자 소문자 16진) 또는 ''(기계 id 도 hostname 도 없음 — 머리를 안 실음). 인자를 주면(시험) 캐시를 안 씀 */
export function machineKey(o) {
  if (o) { const id = rawId(o); return id ? machineKeyOf(id) : ''; }
  if (cached === undefined) { const id = rawId(); cached = id ? machineKeyOf(id) : ''; }
  return cached;
}

const DEVICE_AUTH = /^Bearer\s+bxd_/i;
const plain = h => h && typeof h === 'object' && !(h instanceof Headers) && !Array.isArray(h);
export function withMachine(headers, key = machineKey) {
  if (!headers) return headers;
  const h = new Headers(headers);
  if (!DEVICE_AUTH.test(h.get('authorization') || '') || h.has(MACHINE_HEADER)) return headers;
  const k = typeof key === 'function' ? key() : key; if (!k) return headers;
  if (plain(headers)) return { ...headers, [MACHINE_HEADER]: k };
  h.set(MACHINE_HEADER, k); return Array.isArray(headers) ? [...h] : h;
}

const MARK = Symbol.for('boarder.machineFetch');
export function installMachineHeader(g = globalThis, key = machineKey) {
  const orig = g.fetch; if (typeof orig !== 'function' || orig[MARK]) return;
  const wrapped = function (input, init) {
    try {
      if (init?.headers) { const h = withMachine(init.headers, key); if (h !== init.headers) init = { ...init, headers: h }; }
      else if (typeof Request === 'function' && input instanceof Request) { const h = withMachine(input.headers, key); if (h !== input.headers) input = new Request(input, { headers: h }); }
    } catch {}
    return orig.call(this, input, init);
  };
  wrapped[MARK] = true; g.fetch = wrapped;
}
