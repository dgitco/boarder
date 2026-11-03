
export type TodoState = "todo" | "doing" | "wait" | "done";
export type Todo = {
  id: number; owner: string; node: string; title: string; prio: number; sort: number; state: TodoState;
  wait: string | null; by: string | null; evidence: string | null; created_at: number; updated_at: number; done_at: number | null;
};
export const STATES: readonly TodoState[] = ["todo", "doing", "wait", "done"];
export const PRIOS = [1, 2, 3] as const;   // 1 급함 · 2 보통 · 3 나중

/** 사람이 고칠 수 있는 잘못(400) — 글은 명령 · 화면에 그대로 보임 */
export class TodoError extends Error { status = 400; }
export class TodoMissing extends TodoError { status = 404; }

const CTRL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
const COLS = `id, owner, node, title, prio, sort, state, wait, "by", evidence, created_at, updated_at, done_at`;
const DONE_KEEP = 50;   // 화면 「끝난 것 보기」는 최근 것만 — 오래 쓴 노드가 끝난 줄 수백을 매번 받지 않게

function text(v: unknown, what: string, max: number, min = 1): string {
  if (typeof v !== "string") throw new TodoError(`${what}을(를) 글로 주세요`);
  const s = v.replace(CTRL, "").replace(/\s+/g, " ").trim();
  if (s.length < min || s.length > max) throw new TodoError(min ? `${what}은(는) ${min}–${max}자예요` : `${what}은(는) ${max}자까지예요`);
  return s;
}
const optText = (v: unknown, what: string, max: number) => v === undefined || v === null || v === "" ? null : text(v, what, max);
export const title = (v: unknown) => text(v, "할 일", 300);
export const nodeName = (v: unknown) => text(v, "노드 이름", 120);
export function prio(v: unknown): number {
  const n = typeof v === "string" && /^\d$/.test(v) ? +v : v;
  if (!PRIOS.includes(n as 1)) throw new TodoError("우선순위는 1(급함) · 2(보통) · 3(나중)이에요");
  return n as number;
}
export function state(v: unknown): TodoState {
  if (!STATES.includes(v as TodoState)) throw new TodoError("상태는 todo · doing · wait · done 이에요");
  return v as TodoState;
}
function sortVal(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new TodoError("순서는 숫자예요");
  return v;
}
function idOf(v: unknown): number {
  const n = typeof v === "string" && /^\d{1,15}$/.test(v) ? +v : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) throw new TodoError("할 일 id 가 없어요");
  return n;
}
/** 모르는 칸이 오면 거절 — 「stat」 같은 오타가 조용히 무시되지 않게 */
function only(b: Record<string, unknown>, keys: string[]) {
  const bad = Object.keys(b).filter(k => !keys.includes(k));
  if (bad.length) throw new TodoError(`모르는 칸: ${bad.join(", ")}`);
}

export async function resolveNode(db: D1Database, owner: string, node: unknown, member: boolean): Promise<string> {
  const n = nodeName(node);
  if (!member) return n;
  const r = await db.prepare("SELECT coalesce(nullif(pinned_name, ''), name) name FROM mnode WHERE owner = ? AND id = ?").bind(owner, n).first<{ name: string }>();
  return r?.name ? nodeName(r.name) : n;
}

export type ListOpt = { all?: boolean; staleMin?: number; now?: number };
/** node 가 없으면 그 사람 모든 노드. 기본은 남은 것만, all 이면 끝난 것도(최근 DONE_KEEP 개). staleMin = 그 분 동안 안 바뀐 남은 것만 */
export async function list(db: D1Database, owner: string, node?: string | null, o: ListOpt = {}): Promise<Todo[]> {
  const where = ["owner = ?"], args: unknown[] = [owner];
  if (node) { where.push("node = ?"); args.push(node); }
  const open = (await db.prepare(`SELECT ${COLS} FROM node_todo WHERE ${where.join(" AND ")} AND state != 'done'${o.staleMin ? " AND updated_at < ?" : ""} ORDER BY node, prio, sort, id`)
    .bind(...args, ...(o.staleMin ? [(o.now ?? Date.now()) - o.staleMin * 60_000] : [])).all<Todo>()).results;
  if (!o.all || o.staleMin) return open;
  const done = (await db.prepare(`SELECT ${COLS} FROM node_todo WHERE ${where.join(" AND ")} AND state = 'done' ORDER BY done_at DESC, id DESC LIMIT ?`).bind(...args, DONE_KEEP).all<Todo>()).results;
  return [...open, ...done];
}
export async function counts(db: D1Database, owner: string, node: string) {
  const r = await db.prepare("SELECT sum(state != 'done') open, sum(state = 'done') done FROM node_todo WHERE owner = ? AND node = ?").bind(owner, node).first<{ open: number | null; done: number | null }>();
  return { open: r?.open ?? 0, done: r?.done ?? 0 };
}
async function get(db: D1Database, owner: string, id: number): Promise<Todo> {
  const r = await db.prepare(`SELECT ${COLS} FROM node_todo WHERE owner = ? AND id = ?`).bind(owner, id).first<Todo>();
  if (!r) throw new TodoMissing("그 할 일이 없어요");
  return r;
}
/** 새 줄은 그 노드 맨 뒤(sort = 지금 가장 큰 값 + 1) */
async function nextSort(db: D1Database, owner: string, node: string) {
  const r = await db.prepare("SELECT max(sort) s FROM node_todo WHERE owner = ? AND node = ?").bind(owner, node).first<{ s: number | null }>();
  return (r?.s ?? 0) + 1;
}

export type AddIn = { node: string; title: unknown; prio?: unknown; state?: unknown; wait?: unknown; by?: unknown; evidence?: unknown };
export async function add(db: D1Database, owner: string, a: AddIn, now = Date.now()): Promise<Todo> {
  const t = title(a.title), p = a.prio === undefined ? 2 : prio(a.prio), st = a.state === undefined ? "todo" : state(a.state);
  const w = st === "wait" ? optText(a.wait, "기다리는 것", 200) : null, by = optText(a.by, "맡은 에이전트", 40), ev = optText(a.evidence, "증거", 1000);
  const r = await db.prepare(`INSERT INTO node_todo (owner, node, title, prio, sort, state, wait, "by", evidence, created_at, updated_at, done_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING ${COLS}`)
    .bind(owner, a.node, t, p, await nextSort(db, owner, a.node), st, w, by, ev, now, now, st === "done" ? now : null).first<Todo>();
  return r!;
}

export type SetIn = { prio?: unknown; state?: unknown; title?: unknown; wait?: unknown; sort?: unknown; by?: unknown };
/** 보낸 칸만 바꿈. state 를 done 이 아닌 것으로 바꾸면 done_at · 증거는 비우고, wait 가 아니면 기다리는 것도 비움 */
export async function set(db: D1Database, owner: string, id: unknown, s: SetIn, now = Date.now()): Promise<Todo> {
  const old = await get(db, owner, idOf(id));
  const f: Record<string, unknown> = {};
  if (s.prio !== undefined) f.prio = prio(s.prio);
  if (s.title !== undefined) f.title = title(s.title);
  if (s.sort !== undefined) f.sort = sortVal(s.sort);
  if (s.by !== undefined) f.by = optText(s.by, "맡은 에이전트", 40);
  const st = s.state === undefined ? old.state : state(s.state);
  if (s.state !== undefined) { f.state = st; if (st !== "done") { f.done_at = null; f.evidence = null; } else if (old.state !== "done") f.done_at = now; }
  if (s.wait !== undefined) { if (st !== "wait") throw new TodoError("기다리는 것은 기다림 상태에만 적어요"); f.wait = optText(s.wait, "기다리는 것", 200); }
  else if (s.state !== undefined && st !== "wait") f.wait = null;
  if (!Object.keys(f).length) throw new TodoError("바꿀 칸이 없어요");
  f.updated_at = now;
  const ks = Object.keys(f);
  return (await db.prepare(`UPDATE node_todo SET ${ks.map(k => `"${k}" = ?`).join(", ")} WHERE owner = ? AND id = ? RETURNING ${COLS}`).bind(...ks.map(k => f[k]), owner, old.id).first<Todo>())!;
}
export async function done(db: D1Database, owner: string, id: unknown, evidence: unknown, now = Date.now()): Promise<Todo> {
  const old = await get(db, owner, idOf(id));
  const ev = optText(evidence, "증거", 1000);
  return (await db.prepare(`UPDATE node_todo SET state = 'done', wait = NULL, evidence = ?, done_at = ?, updated_at = ? WHERE owner = ? AND id = ? RETURNING ${COLS}`)
    .bind(ev, old.state === "done" && old.done_at ? old.done_at : now, now, owner, old.id).first<Todo>())!;
}
/** 다른 노드로 — 그 노드 맨 뒤에 붙음 */
export async function move(db: D1Database, owner: string, id: unknown, node: string, now = Date.now()): Promise<Todo> {
  const old = await get(db, owner, idOf(id));
  if (old.node === node) return old;
  return (await db.prepare(`UPDATE node_todo SET node = ?, sort = ?, updated_at = ? WHERE owner = ? AND id = ? RETURNING ${COLS}`)
    .bind(node, await nextSort(db, owner, node), now, owner, old.id).first<Todo>())!;
}
export async function remove(db: D1Database, owner: string, id: unknown): Promise<{ id: number }> {
  const old = await get(db, owner, idOf(id));
  await db.prepare("DELETE FROM node_todo WHERE owner = ? AND id = ?").bind(owner, old.id).run();
  return { id: old.id };
}
/** 기능 목록 들여오기(todo import): 같은 노드에 같은 글이 있으면 건너뜀 — 여러 번 들여와도 두 벌이 안 생김. 통과 행은 끝(증거와 같이) */
export async function importRows(db: D1Database, owner: string, node: string, rows: unknown, by: unknown, now = Date.now()) {
  if (!Array.isArray(rows) || rows.length > 300) throw new TodoError("들여올 줄은 300개까지예요");
  const items = rows.map(r => {
    if (!r || typeof r !== "object") throw new TodoError("들여올 줄 꼴이 틀려요");
    const o = r as Record<string, unknown>; only(o, ["title", "state", "evidence"]);
    const st = state(o.state); if (st !== "todo" && st !== "done") throw new TodoError("들여올 줄 상태는 todo · done 이에요");
    return { title: title(o.title), state: st, evidence: optText(o.evidence, "증거", 1000) };
  });
  const have = new Set((await db.prepare("SELECT title FROM node_todo WHERE owner = ? AND node = ?").bind(owner, node).all<{ title: string }>()).results.map(r => r.title));
  let added = 0, done = 0, skipped = 0;
  for (const it of items) {
    if (have.has(it.title)) { skipped++; continue; }
    have.add(it.title);
    await add(db, owner, { node, title: it.title, state: it.state, evidence: it.state === "done" ? it.evidence : null, by }, now);
    if (it.state === "done") done++; else added++;
  }
  return { added, done, skipped };
}

/** 한 요청(기기 · 화면 POST 같은 꼴 {op, …}) — [상태, 답]. member = 회원(노드 id → 이름), devOps = 기기만 쓰는 일(목록 · 옮기기 · 들여오기)도 받음 */
export async function op(db: D1Database, owner: string, b: unknown, o: { member: boolean; device: boolean; now?: number }): Promise<[number, Record<string, unknown>]> {
  try {
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new TodoError("꼴이 틀려요");
    const x = b as Record<string, unknown>, now = o.now ?? Date.now();
    const node = async () => resolveNode(db, owner, x.node, o.member);
    switch (x.op) {
      case "list": {
        only(x, ["op", "node", "all", "stale"]);
        const n = x.node === undefined || x.node === null || x.node === "" ? null : await node();
        const st = x.stale === undefined ? 0 : x.stale;
        if (typeof st !== "number" || !Number.isFinite(st) || st < 0 || st > 525_600) throw new TodoError("stale 은 분(0–525600)이에요");
        return [200, { ok: true, node: n, todos: await list(db, owner, n, { all: x.all === true, staleMin: st, now }) }];
      }
      case "add": {
        only(x, ["op", "node", "title", "prio", "state", "wait", "by"]);
        const t = await add(db, owner, { node: await node(), title: x.title, prio: x.prio, state: x.state, wait: x.wait, by: x.by }, now);
        return [200, { ok: true, todo: t }];
      }
      case "set": {
        only(x, ["op", "id", "prio", "state", "title", "wait", "sort", "by"]);
        return [200, { ok: true, todo: await set(db, owner, x.id, { prio: x.prio, state: x.state, title: x.title, wait: x.wait, sort: x.sort, by: x.by }, now) }];
      }
      case "done": {
        only(x, ["op", "id", "evidence", "by"]);
        if (o.device && (typeof x.evidence !== "string" || !x.evidence.trim())) throw new TodoError("끝낼 때는 증거를 적어요");   // 에이전트는 증거와 같이만(화면 손은 없어도 됨)
        const t = await done(db, owner, x.id, x.evidence, now);
        return [200, { ok: true, todo: x.by === undefined ? t : await set(db, owner, t.id, { by: x.by }, now) }];
      }
      case "move": {
        only(x, ["op", "id", "node"]);
        return [200, { ok: true, todo: await move(db, owner, x.id, await node(), now) }];
      }
      case "remove": {
        only(x, ["op", "id"]);
        return [200, { ok: true, ...(await remove(db, owner, x.id)) }];
      }
      case "import": {
        if (!o.device) throw new TodoError("들여오기는 명령으로만 해요");
        only(x, ["op", "node", "rows", "by"]);
        return [200, { ok: true, ...(await importRows(db, owner, await node(), x.rows, x.by, now)) }];
      }
      default: throw new TodoError("op 는 list · add · set · done · move · remove · import 예요");
    }
  } catch (e) {
    if (e instanceof TodoError) return [e.status, { ok: false, error: e.message }];
    throw e;
  }
}
