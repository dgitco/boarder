import { filterArgs } from "./mcp/log-filter";

export type TaskState = "open" | "blocked" | "done";
export type Ref = { chan?: string; ts?: string; input?: number; url?: string };
export type Session = { id: string; pane?: string; at: number };
export type Task = {
  no: number; title: string; status: string; state: TaskState; unblock: string | null; agent: string; body: string;
  refs: Ref[]; sessions: Session[]; created_at: number; updated_at: number; done_at: number | null;
};
type Row = Omit<Task, "refs" | "sessions"> & { refs: string; sessions: string; rev: number };

export class TaskError extends Error { status = 400; }
export class TaskMissing extends TaskError { status = 404; }
export class TaskBusy extends TaskError { status = 409; }

const CTRL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, CTRL_KEEP_NL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
const COLS = "no, title, status, state, unblock, agent, body, refs, sessions, created_at, updated_at, done_at, rev";
const DONE_KEEP = 50, LIVE_MAX = 300, LOG_KEEP = 30, SESS_KEEP = 20, REFS_MAX = 20;
const BOX = /^(\s*[-*]\s+)\[( |x|X)\](.*)$/;

const line = (v: unknown, what: string, max: number, min = 1) => {
  if (typeof v !== "string") throw new TaskError(`${what}을(를) 글로 주세요`);
  const s = v.replace(CTRL, " ").replace(/\s+/g, " ").trim();
  if (s.length < min || s.length > max) throw new TaskError(min ? `${what}은(는) ${min}–${max}자예요` : `${what}은(는) ${max}자까지예요`);
  return s;
};
export const title = (v: unknown) => line(v, "이름", 40);
export const status = (v: unknown) => line(v, "상태", 200);
const agent = (v: unknown) => line(v, "맡은 에이전트", 60, 0);
const who = (v: unknown) => v === undefined || v === null || v === "" ? "에이전트" : line(v, "누가", 60);
function body(v: unknown) {
  if (typeof v !== "string") throw new TaskError("본문을 글로 주세요");
  const s = v.replace(/\r\n?/g, "\n").replace(CTRL_KEEP_NL, "").trimEnd();
  if (s.length > 8000) throw new TaskError("본문은 8000자까지예요");
  return s;
}
function noOf(v: unknown): number {
  const n = typeof v === "string" && /^#?\d{1,9}$/.test(v) ? +v.replace("#", "") : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) throw new TaskError("할 일 번호(#N)가 없어요");
  return n;
}
function only(b: Record<string, unknown>, keys: string[]) {
  const bad = Object.keys(b).filter(k => !keys.includes(k));
  if (bad.length) throw new TaskError(`모르는 칸: ${bad.join(", ")}`);
}
/** 비밀 꼴(토큰 · 키)은 저장 전 가림 — 작업 기록 줄(board_log)과 같은 거르개. 거르개가 거절하면 저장하지 않음 */
function masked<T extends Record<string, unknown>>(o: T): T {
  try { return filterArgs(o).args; } catch { throw new TaskError("비밀값처럼 보이는 글이 있어 저장하지 않았어요"); }
}

/** 상태 글 첫머리 → state */
export function stateOf(s: string): TaskState {
  if (/^(끝|done\b)/i.test(s)) return "done";
  if (/^(blocked\s+by\b|막힘)/i.test(s)) return "blocked";
  return "open";
}
function ref(v: unknown): Ref {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new TaskError("원 글 꼴이 틀려요");
  const o = v as Record<string, unknown>; only(o, ["chan", "ts", "input", "url"]);
  const r: Ref = {};
  if (o.chan !== undefined) r.chan = line(o.chan, "원 글 채널", 40);
  if (o.ts !== undefined) { if (typeof o.ts !== "string" || !/^\d{10}\.\d{6}$/.test(o.ts)) throw new TaskError("원 글 ts 꼴이 틀려요"); r.ts = o.ts; }
  if (o.input !== undefined) { if (!Number.isSafeInteger(o.input) || (o.input as number) < 1) throw new TaskError("Owner 글 번호가 틀려요"); r.input = o.input as number; }
  if (o.url !== undefined) { const u = line(o.url, "원 글 주소", 300); if (!/^https:\/\//.test(u)) throw new TaskError("원 글 주소는 https 예요"); r.url = u; }
  if (!Object.keys(r).length) throw new TaskError("원 글이 비었어요");
  return r;
}
function session(v: unknown, now: number): Session {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new TaskError("세션 꼴이 틀려요");
  const o = v as Record<string, unknown>; only(o, ["id", "pane"]);
  if (typeof o.id !== "string" || !/^[\w.-]{1,80}$/.test(o.id)) throw new TaskError("세션 id 꼴이 틀려요");
  if (o.pane !== undefined && (typeof o.pane !== "string" || !/^%\d{1,7}$/.test(o.pane))) throw new TaskError("판은 %숫자 예요");
  return { id: o.id, ...(o.pane ? { pane: o.pane as string } : {}), at: now };
}
const json = <T,>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };
const out = ({ rev: _r, ...r }: Row): Task => ({ ...r, refs: json<Ref[]>(r.refs, []), sessions: json<Session[]>(r.sessions, []) });
const newRev = () => 1 + Math.floor(Math.random() * 2 ** 52);

async function getRow(db: D1Database, owner: string, no: number): Promise<Row> {
  const r = await db.prepare(`SELECT ${COLS} FROM task WHERE owner = ? AND no = ?`).bind(owner, no).first<Row>();
  if (!r) throw new TaskMissing(`#${no} 할 일이 없어요`);
  return r;
}
async function unblockOf(db: D1Database, owner: string, v: unknown, self: number | null): Promise<string> {
  const s = typeof v === "string" ? v.trim().replace(/^#(\d+)$/, "task:$1") : "";
  const m = /^(owner|other)$|^usage:([a-z])$|^task:(\d{1,9})$|^watch:(\d{1,9})$/.exec(s);
  if (!m) throw new TaskError("무엇이 풀면 다시 열지(unblock): owner · usage:<계정> · task:<번호> · watch:<감시 번호> · other");
  if (m[3]) {
    const n = +m[3]; if (n === self) throw new TaskError("자기 자신에 막힐 수 없어요");
    const r = await db.prepare("SELECT state FROM task WHERE owner = ? AND no = ?").bind(owner, n).first<{ state: string }>();
    if (!r) throw new TaskMissing(`#${n} 할 일이 없어요`);
    if (r.state === "done") throw new TaskError(`#${n} 은 이미 끝났어요`);
  }
  return s;
}
const short = (s: string, n = 60) => s.length > n ? s.slice(0, n - 1) + "…" : s;
/** 본문 i 번째(1부터) 체크박스를 켜고 끔 */
function tick(b: string, i: unknown, on: boolean): [string, string] {
  const n = noOf(i), ls = b.split("\n");
  let k = 0;
  for (let j = 0; j < ls.length; j++) {
    const m = BOX.exec(ls[j]); if (!m || ++k !== n) continue;
    ls[j] = `${m[1]}[${on ? "x" : " "}]${m[3]}`;
    return [ls.join("\n"), m[3].trim()];
  }
  throw new TaskError(`${n} 번째 체크박스가 없어요(지금 ${k}개)`);
}

export type ListOpt = { state?: unknown; agent?: unknown };
export async function list(db: D1Database, owner: string, o: ListOpt = {}): Promise<Task[]> {
  const st = o.state === undefined ? "live" : o.state;
  if (!["live", "open", "blocked", "done", "all"].includes(st as string)) throw new TaskError("state 는 live · open · blocked · done · all 이에요");
  const ag = o.agent === undefined || o.agent === "" ? null : agent(o.agent);
  const where = ["owner = ?"], args: unknown[] = [owner];
  if (ag) { where.push("agent = ?"); args.push(ag); }
  const q = (cond: string, order: string, lim: number) => db.prepare(`SELECT ${COLS} FROM task WHERE ${where.join(" AND ")} AND ${cond} ORDER BY ${order} LIMIT ${lim}`).bind(...args).all<Row>().then(r => r.results.map(out));
  const live = st === "live" || st === "all" ? await q("state != 'done'", "updated_at DESC, no DESC", LIVE_MAX)
    : st === "open" || st === "blocked" ? await q(`state = '${st}'`, "updated_at DESC, no DESC", LIVE_MAX) : [];
  const done = st === "done" || st === "all" ? await q("state = 'done'", "done_at DESC, no DESC", DONE_KEEP) : [];
  return [...live, ...done];
}
export async function get(db: D1Database, owner: string, no: unknown) {
  const n = noOf(no), t = out(await getRow(db, owner, n));
  const log = (await db.prepare("SELECT at, who, what FROM task_log WHERE owner = ? AND no = ? ORDER BY at DESC, id DESC LIMIT ?").bind(owner, n, LOG_KEEP).all<{ at: number; who: string; what: string }>()).results;
  return { task: t, log };
}

export type NewIn = { title: unknown; body?: unknown; agent?: unknown; status?: unknown; unblock?: unknown; refs?: unknown; who?: unknown };
export async function create(db: D1Database, owner: string, a: NewIn, now = Date.now()): Promise<Task> {
  const m = masked({ title: title(a.title), body: a.body === undefined ? "" : body(a.body), status: a.status === undefined ? "진행" : status(a.status),
    agent: a.agent === undefined ? "" : agent(a.agent), who: who(a.who) });
  const st = stateOf(m.status);
  if (st === "done") throw new TaskError("새 할 일을 끝으로 만들 수 없어요");
  const ub = st === "blocked" ? await unblockOf(db, owner, a.unblock, null) : a.unblock === undefined ? null : (() => { throw new TaskError("unblock 은 막힌(blocked by …) 할 일에만 적어요"); })();
  if (a.refs !== undefined && (!Array.isArray(a.refs) || a.refs.length > REFS_MAX)) throw new TaskError(`원 글은 ${REFS_MAX}개까지 목록으로 주세요`);
  const refs = ((a.refs as unknown[] | undefined) || []).map(r => masked(ref(r)));
  const seq = "(SELECT last FROM task_seq WHERE owner = ?)";
  const rs = await db.batch([
    db.prepare("INSERT INTO task_seq (owner, last) VALUES (?, 1) ON CONFLICT(owner) DO UPDATE SET last = last + 1").bind(owner),
    db.prepare(`INSERT INTO task (owner, no, title, status, state, unblock, agent, body, refs, sessions, created_at, updated_at, done_at, rev) VALUES (?, ${seq}, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, NULL, ?)`)
      .bind(owner, owner, m.title, m.status, st, ub, m.agent, m.body, JSON.stringify(refs), now, now, newRev()),
    db.prepare(`INSERT INTO task_log (owner, no, at, who, what) VALUES (?, ${seq}, ?, ?, ?)`).bind(owner, owner, now, m.who, `만듦: ${short(m.title)}${m.agent ? ` · 맡음 ${m.agent}` : ""}`),
    db.prepare(`SELECT ${COLS} FROM task WHERE owner = ? AND no = ${seq}`).bind(owner, owner),
  ]);
  const t = (rs[3].results as Row[])[0];
  return out(await lateFree(db, owner, t, m.who, now));
}

/** 막힘을 task:M 으로 적었는데 그 사이 M 이 끝났으면(M 의 끝 처리가 우리 쓰기보다 먼저 돎) 바로 풂 — 끝 처리는 그때 막힌 것만 풀어 주므로 */
async function lateFree(db: D1Database, owner: string, t: Row, by: string, now: number): Promise<Row> {
  const m = t.state === "blocked" && /^task:(\d+)$/.exec(t.unblock || ""); if (!m) return t;
  const dep = await db.prepare("SELECT state FROM task WHERE owner = ? AND no = ?").bind(owner, +m[1]).first<{ state: string }>();
  if (dep?.state !== "done") return t;
  const tok = newRev(), g = "owner = ? AND no = ? AND state = 'blocked' AND unblock = ? AND rev = ?";
  const rs = await db.batch([
    db.prepare(`INSERT INTO task_log (owner, no, at, who, what) SELECT owner, no, ?, ?, ? FROM task WHERE ${g}`).bind(now, by, `풀림: #${m[1]} 끝`, owner, t.no, t.unblock, t.rev),
    db.prepare(`UPDATE task SET status = ?, state = 'open', unblock = NULL, updated_at = ?, rev = ? WHERE ${g}`).bind(`진행 — #${m[1]} 끝나 풀림`, now, tok, owner, t.no, t.unblock, t.rev),
    db.prepare(`SELECT ${COLS} FROM task WHERE owner = ? AND no = ?`).bind(owner, t.no),
  ]);
  return (rs[2].results as Row[])[0];
}

export type SetIn = { title?: unknown; status?: unknown; unblock?: unknown; agent?: unknown; body?: unknown; add?: unknown; check?: unknown; uncheck?: unknown; ref?: unknown; session?: unknown; who?: unknown };
/** 보낸 칸만 바꿈 · 바뀐 칸마다 기록 한 줄. 읽은 판(rev)일 때만 써지고, 그 사이 남이 고쳤으면 다시 읽어 다시 적용(체크 한 줄이 사라지지 않게) */
export async function set(db: D1Database, owner: string, no: unknown, s: SetIn, now = Date.now()): Promise<Task> {
  const n = noOf(no);
  for (let i = 0; i < 5; i++) { const t = await setOnce(db, owner, n, s, now); if (t) return out(t); }
  throw new TaskBusy(`#${n} 이 동시에 여러 번 바뀌고 있어요 — 잠시 뒤 다시 해 주세요`);
}
async function setOnce(db: D1Database, owner: string, n: number, s: SetIn, now: number): Promise<Row | null> {
  const o = await getRow(db, owner, n);
  const f: Record<string, unknown> = {}, log: string[] = [];
  const m = masked({
    ...(s.title !== undefined ? { title: title(s.title) } : {}), ...(s.status !== undefined ? { status: status(s.status) } : {}),
    ...(s.body !== undefined ? { body: body(s.body) } : {}), ...(s.add !== undefined ? { add: line(s.add, "더할 한 줄", 200) } : {}),
    ...(s.agent !== undefined ? { agent: agent(s.agent) } : {}), who: who(s.who),
  }) as { title?: string; status?: string; body?: string; add?: string; agent?: string; who: string };
  if (m.title !== undefined && m.title !== o.title) { f.title = m.title; log.push(`이름: ${short(o.title)} → ${short(m.title)}`); }
  let st = o.state as TaskState;
  if (m.status !== undefined && m.status !== o.status) {
    st = stateOf(m.status); f.status = m.status; f.state = st; log.push(`상태: ${short(o.status, 40)} → ${short(m.status, 80)}`);
    if (st === "done") { if (o.state !== "done") f.done_at = now; } else f.done_at = null;
  }
  if (st === "blocked") {
    if (s.unblock !== undefined) { const u = await unblockOf(db, owner, s.unblock, n); if (u !== o.unblock) { f.unblock = u; log.push(`풀림 조건: ${u}`); } }
    else if (o.state !== "blocked" || !o.unblock) throw new TaskError("막힘에는 무엇이 풀면 다시 열지(unblock)를 같이 적어요");
  } else {
    if (s.unblock !== undefined) throw new TaskError("unblock 은 막힌(blocked by …) 할 일에만 적어요");
    if (o.unblock !== null) f.unblock = null;
  }
  if (m.agent !== undefined && m.agent !== o.agent) { f.agent = m.agent; log.push(`맡음: ${o.agent || "없음"} → ${m.agent || "없음"}`); }
  let b = o.body;
  if (m.body !== undefined && m.body !== b) { b = m.body; log.push("본문 고침"); }
  if (m.add !== undefined) { b = (b ? b + "\n" : "") + `- [ ] ${m.add}`; log.push(`더함: ${short(m.add)}`); }
  if (s.check !== undefined) { const [nb, w] = tick(b, s.check, true); b = nb; log.push(`체크: ${short(w)}`); }
  if (s.uncheck !== undefined) { const [nb, w] = tick(b, s.uncheck, false); b = nb; log.push(`체크 풂: ${short(w)}`); }
  if (b !== o.body) f.body = b;
  if (s.ref !== undefined) {
    const r = masked(ref(s.ref)), refs = json<Ref[]>(o.refs, []);
    if (!refs.some(x => JSON.stringify(x) === JSON.stringify(r))) {
      if (refs.length >= REFS_MAX) throw new TaskError(`원 글은 ${REFS_MAX}개까지예요`);
      f.refs = JSON.stringify([...refs, r]); log.push(`원 글 더함${r.ts ? ` ${r.chan || ""}:${r.ts}` : r.input ? ` Owner 글 ${r.input}` : ""}`);
    }
  }
  if (s.session !== undefined) {
    const x = session(s.session, now), old = json<Session[]>(o.sessions, []);
    f.sessions = JSON.stringify([...old.filter(y => y.id !== x.id), x].slice(-SESS_KEEP));
    if (!old.some(y => y.id === x.id)) log.push(`세션 붙음${x.pane ? ` ${x.pane}` : ""}`);
  }
  if (!Object.keys(f).length) return o;   // 같은 값이면 그대로(다시 불러도 기록이 안 쌓임)
  const tok = newRev(); f.updated_at = now; f.rev = tok;
  const ks = Object.keys(f), mine = "(SELECT rev FROM task WHERE owner = ? AND no = ?) = ?";   // 이 batch 의 UPDATE 가 써졌을 때만 뒤 문장이 돎
  const st2: D1PreparedStatement[] = [db.prepare(`UPDATE task SET ${ks.map(k => `${k} = ?`).join(", ")} WHERE owner = ? AND no = ? AND rev = ?`).bind(...ks.map(k => f[k]), owner, n, o.rev)];
  for (const w of log) st2.push(db.prepare(`INSERT INTO task_log (owner, no, at, who, what) SELECT ?, ?, ?, ?, ? WHERE ${mine}`).bind(owner, n, now, m.who, w, owner, n, tok));
  if (f.state === "done") {   // #n 에 막혀 있던 할 일을 같은 트랜잭션 안 한 문장으로 풂(목록을 미리 읽지 않음 — 그 사이 바뀐 후행을 되살리지 않게)
    const g = `owner = ? AND state = 'blocked' AND unblock = ? AND ${mine}`;
    st2.push(
      db.prepare(`INSERT INTO task_log (owner, no, at, who, what) SELECT owner, no, ?, ?, ? FROM task WHERE ${g}`).bind(now, m.who, `풀림: #${n} 끝`, owner, `task:${n}`, owner, n, tok),
      db.prepare(`UPDATE task SET status = ?, state = 'open', unblock = NULL, updated_at = ?, rev = 1 + abs(random() % 4503599627370496) WHERE ${g}`).bind(`진행 — #${n} 끝나 풀림`, now, owner, `task:${n}`, owner, n, tok));
  }
  st2.push(db.prepare(`SELECT ${COLS} FROM task WHERE owner = ? AND no = ?`).bind(owner, n));
  const rs = await db.batch(st2), t = (rs[rs.length - 1].results as Row[])[0];
  if (t.rev !== tok) return null;   // 그 사이 남이 고침 — 다시 읽어 다시 적용
  return await lateFree(db, owner, t, m.who, now);
}

/** 트리 화면용: live 할 일(본문 · 세션 뺌) */
export async function forTree(db: D1Database, owner: string) {
  return (await list(db, owner)).map(({ body: _b, sessions: _s, ...t }) => t);
}

/** 기기 요청 하나 {op, …} → [상태, 답] */
export async function op(db: D1Database, owner: string, b: unknown, now = Date.now()): Promise<[number, Record<string, unknown>]> {
  try {
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new TaskError("꼴이 틀려요");
    const x = b as Record<string, unknown>;
    switch (x.op) {
      case "list": only(x, ["op", "state", "agent"]); return [200, { ok: true, tasks: await list(db, owner, { state: x.state, agent: x.agent }) }];
      case "get": only(x, ["op", "no"]); return [200, { ok: true, ...(await get(db, owner, x.no)) }];
      case "new": only(x, ["op", "title", "body", "agent", "status", "unblock", "refs", "who"]);
        return [200, { ok: true, task: await create(db, owner, x as NewIn, now) }];
      case "set": only(x, ["op", "no", "title", "status", "unblock", "agent", "body", "add", "check", "uncheck", "ref", "session", "who"]);
        return [200, { ok: true, task: await set(db, owner, x.no, x as SetIn, now) }];
      default: throw new TaskError("op 는 list · get · new · set 이에요");
    }
  } catch (e) {
    if (e instanceof TaskError) return [e.status, { ok: false, error: e.message }];
    throw e;
  }
}
