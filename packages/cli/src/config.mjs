import os from 'node:os';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const DEFAULT_SERVER = 'https://boarder.dgit.co';
export const home = () => process.env.HOME || os.homedir();
export const dir = () => process.env.BOARDER_HOME || path.join(home(), '.config', 'boarder');
export const sha = s => createHash('sha256').update(s).digest('hex');

export function ensureDir(d, mode = 0o700) { mkdirSync(d, { recursive: true, mode }); try { chmodSync(d, mode); } catch {} return d; }
export function readJson(p, fallback = null) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } }
export function writeSecret(p, obj) {
  ensureDir(path.dirname(p));
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  chmodSync(p, 0o600);
}

const devicePath = () => path.join(dir(), 'device.json');
export const loadDevice = () => readJson(devicePath());
export const saveDevice = d => writeSecret(devicePath(), d);
export const server = () => (loadDevice()?.server || process.env.BOARDER_URL || DEFAULT_SERVER).replace(/\/+$/, '');

const winPath = key => path.join(dir(), 'windows', sha(`${loadDevice()?.server || ''}|${loadDevice()?.device_id || ''}|${key}`).slice(0, 32) + '.json');
export const loadWindow = key => readJson(winPath(key));
export const saveWindow = (key, w) => writeSecret(winPath(key), w);
export const exists = existsSync;
