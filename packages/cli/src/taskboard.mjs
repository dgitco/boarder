// boarder taskboard — 태스크 현황(설정 › 기능)의 「올리는 쪽」: 에이전트 쪽 도구(생성기)가 이 기기 토큰으로 요청 · 대화 줄을 올리고, 보더에서 쓴 말을 가져감.
//   토큰 값은 찍지 않고 이 명령 안에서만 씀. 계정이 태스크 현황을 꺼 두었으면 서버가 403 — 그대로 알림. 자세한 칸: docs/flows/status-pages.md
import { readFileSync } from 'node:fs';
import { loadDevice, server } from './config.mjs';

export const TASKBOARD_HELP = `Task status page (only when the account turned it on in Settings › Features)
  boarder taskboard push <file.json>   upload {"tasks":[…],"convo":[…],"remove":[…],"board":{…}} (split into parts when large; board goes whole in its own last part, 900 KB max)
  boarder taskboard said               print what people said on the page, for tasks this machine uploaded (JSON). Lines you got are held for 5 minutes, then come back unless acked.
                                       When you push such a line back as convo, keep the same k — otherwise it shows twice.
  boarder taskboard ack <file.json>    mark lines delivered ([{"task_id","k"}…] — the output of said works as is)`;
const LIM = { tasks: 250, convo: 900, bytes: 900_000 };

async function call(method, p, body) {
  const d = loadDevice(); if (!d?.token) { const e = new Error('This machine is not set up for Boarder yet — run `boarder setup --yes`.'); e.code = 'NO_DEVICE'; throw e; }
  const r = await fetch(`${server()}${p}`, { method, headers: { authorization: `Bearer ${d.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body } : {}), signal: AbortSignal.timeout(60_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}
/** 요청 · 대화 · 지우기를 서버 상한 밑 묶음들로 나눔(요청이 먼저 가게 — 대화 줄은 요청이 있어야 들어감) */
export function chunks(b) {
  const out = [], cur = () => out[out.length - 1];
  const start = () => out.push({ tasks: [], convo: [], remove: [], n: 2 });
  start();
  for (const [k, list] of [['tasks', b.tasks], ['remove', b.remove], ['convo', b.convo]]) {
    for (const x of Array.isArray(list) ? list : []) {
      const sz = Buffer.byteLength(JSON.stringify(x)) + 1, c = cur();   // 서버 상한은 바이트(한글 한 자 = 3바이트)
      if (c[k].length >= (LIM[k] || LIM.tasks) || c.n + sz > LIM.bytes) start();
      cur()[k].push(x); cur().n += sz;
    }
  }
  const parts = out.filter(c => c.tasks.length || c.convo.length || c.remove.length).map(({ n, ...c }) => c);
  if (b && b.board !== undefined) {
    if (Buffer.byteLength(JSON.stringify(b.board)) > LIM.bytes) throw Object.assign(new Error(`board is larger than ${LIM.bytes} bytes — trim the lists (merged · open · depts)`), { code: 'BOARD_TOO_BIG' });
    parts.push({ board: b.board });
  }
  return parts;
}
export async function taskboardCommand(sub, pos) {
  if (sub === 'push') {
    if (!pos[0]) { console.error(TASKBOARD_HELP); process.exit(64); }
    const b = JSON.parse(readFileSync(pos[0], 'utf8')), sum = { ok: true, parts: 0, tasks: 0, lines: 0, added: 0, dropped: 0 };
    for (const c of chunks(b)) { const r = await call('POST', '/api/device/taskboard', JSON.stringify(c)); sum.parts++; for (const k of ['tasks', 'lines', 'added', 'dropped']) sum[k] += r[k] || 0; }
    return console.log(JSON.stringify(sum));
  }
  if (sub === 'said') return console.log(JSON.stringify((await call('GET', '/api/device/taskboard/said')).said || []));
  if (sub === 'ack') {
    if (!pos[0]) { console.error(TASKBOARD_HELP); process.exit(64); }
    const raw = JSON.parse(readFileSync(pos[0], 'utf8')), keys = (Array.isArray(raw) ? raw : raw.said || raw.keys || []).map(x => ({ task_id: x.task_id, k: x.k }));
    let acked = 0; for (let i = 0; i < keys.length; i += 100) acked += (await call('POST', '/api/device/taskboard/said/ack', JSON.stringify({ keys: keys.slice(i, i + 100) }))).acked || 0;
    return console.log(JSON.stringify({ ok: true, acked }));
  }
  console.error(TASKBOARD_HELP); process.exit(64);
}
