import path from 'node:path';
import { closeSync, openSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dir, ensureDir, readJson } from '../config.mjs';
import { parseHead } from '../turn.mjs';

export const PER_WINDOW_MAX = 100;   // 한 창에 이만큼 쌓이면 새 글은 받지 않음(버리지 않고 보낸 쪽이 다시 보내게 · 보드에 한 줄)
export const STALE_MS = 10 * 60_000;   // 이보다 오래 기다린 글은 보드에 한 줄(줄에는 그대로)
export const JOIN = '\n\n';

/** 답이 가는 자리(turn.mjs replyCall 과 같은 갈래) — 같은 열쇠의 글은 한 턴에 묶어도 답 하나가 제자리로 감 */
export function threadKey(text) {
  const h = parseHead(text);
  if (!h) return 'node:';
  if (h.primary) return `primary:${h.thread || ''}`;
  if (h.card) return `card:${h.card}`;
  if (h.thread) return `thread:${h.thread}`;
  return `node:${h.channel}`;
}

const alive = pid => { if (!pid) return false; if (pid === process.pid) return true; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const nap = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} };
const strip = x => { const { inflight, ...rest } = x; return rest; };

export function makeQueue(name) {
  const file = () => path.join(dir(), name);
  const load = () => { const j = readJson(file(), {}); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; };
  function save(q) {
    ensureDir(dir());
    for (const k of Object.keys(q)) if (!q[k]?.length) delete q[k];
    const f = file(), tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(q), { mode: 0o600 }); renameSync(tmp, f);
  }
  // 다른 프로세스와 겹치지 않게(잠금 파일 · 5초 넘은 잠금은 죽은 것으로 봄) — 안의 일은 다 동기(파일 읽고 씀)라 짧음
  function mutate(fn) {
    ensureDir(dir());
    const lk = file() + '.lock'; let fd = null;
    for (let i = 0; i < 150 && fd === null; i++) {
      try { fd = openSync(lk, 'wx', 0o600); }
      catch (e) {
        if (e.code !== 'EEXIST') break;
        try { if (Date.now() - statSync(lk).mtimeMs > 5000) unlinkSync(lk); } catch {}
        nap(20);
      }
    }
    try { const q = load(), r = fn(q); save(q); return r; }
    finally { if (fd !== null) { try { closeSync(fd); } catch {} try { unlinkSync(lk); } catch {} } }
  }
  const api = {
    PER_WINDOW_MAX, STALE_MS, file, load,
    pending: id => (load()[id] || []).length,
    ids: () => Object.keys(load()),
    /** 줄 끝에 하나(extra: 명령 id · 손잡이 같은 넣을 때 쓸 값). 상한이면 받지 않고 { full: true } */
    push(id, text, extra = {}, now = Date.now()) {
      return mutate(q => {
        const list = (q[id] ||= []);
        if (list.length >= PER_WINDOW_MAX) return { full: true, size: list.length };
        list.push({ ...extra, mid: randomUUID(), text: String(text), at: now, key: threadKey(text) });
        return { ok: true, size: list.length };
      });
    },
    /** 맨 앞 글과 같은 스레드의 대기 글 모두(순서대로) — 꺼내지는 않음. 없으면 null */
    peekBatch(id) {
      const list = load()[id] || []; if (!list.length) return null;
      const key = list[0].key, items = list.filter(x => x.key === key);
      return { key, items, text: items.map(x => x.text).join(JOIN) };
    },
    /** 맨 앞 묶음을 「넣는 중」으로 표시하고 돌려줌(넣기 직전). 다른 산 프로세스가 넣는 중이면 batch 없음.
     *  죽은 프로세스가 넣다 만 글(maybe)은 줄에서 빼서 돌려줌 — 들어갔을 수 있으니 다시 넣지 않음 */
    claim(id, now = Date.now()) {
      return mutate(q => {
        const list = q[id] || [];
        const maybe = list.filter(x => x.inflight && !alive(x.inflight.pid));
        const rest = list.filter(x => !maybe.includes(x)); q[id] = rest;
        if (!rest.length || rest.some(x => x.inflight)) return { maybe: maybe.map(strip), batch: null };
        const key = rest[0].key, items = rest.filter(x => x.key === key);
        for (const x of items) x.inflight = { pid: process.pid, at: now };
        return { maybe: maybe.map(strip), batch: { key, items: items.map(strip), text: items.map(x => x.text).join(JOIN) } };
      });
    },
    /** 넣기가 끝남: 들어갔으면 줄에서 빼고, 못 넣었으면 표시만 지움(다음 회에 다시) */
    release(id, batch, delivered) {
      const mids = new Set(batch.items.map(x => x.mid));
      return mutate(q => {
        if (delivered) q[id] = (q[id] || []).filter(x => !mids.has(x.mid));
        else for (const x of q[id] || []) if (mids.has(x.mid)) delete x.inflight;
      });
    },
    /** 넣은 묶음을 줄에서 뺌(옛 이름 — release(…, true) 와 같음) */
    dropBatch(id, batch) { return api.release(id, batch, true); },
    /** 조건에 맞는데 아직 그 표시(field)가 없는 글에 표시를 달고 돌려줌 — 보드에 한 번만 알리게 */
    flag(id, field, pred, now = Date.now()) {
      return mutate(q => { const out = []; for (const x of q[id] || []) if (!x[field] && pred(x)) { x[field] = now; out.push(strip(x)); } return out; });
    },
    /** 조건에 맞는 글을 줄에서 빼고 돌려줌(넣는 중인 글은 안 뺌) */
    remove(id, pred) {
      return mutate(q => { const list = q[id] || [], out = list.filter(x => !x.inflight && pred(x)); q[id] = list.filter(x => !out.includes(x)); return out.map(strip); });
    },
  };
  return api;
}

// 엔진 데몬 줄(보드 → Boarder 엔진 창)
const main = makeQueue('send-queue.json');
export const { load, pending, ids, push, peekBatch, claim, release, dropBatch, flag, remove } = main;

// 같은 창의 넣기 · 줄 세우기 · 꺼내기가 서로 끼어들지 않게(한 프로세스 안 — 보드 명령과 15초 폴링이 같이 돎)
const locks = new Map();
export function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {}); locks.set(id, tail);
  tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
  return next;
}
