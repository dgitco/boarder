// 태스크 현황(설정 › 기능 taskboard): 요청(태스크) 목록 · 세부 · 요청 대화(두 겹) · 「말하기」.
//   올리는 쪽 = 기기(에이전트 쪽 도구, 기기 토큰): POST /api/device/taskboard 로 요청 · 대화 줄을 밀어 넣고, 보더에서 쓴 말은 GET …/said 로 가져가 ack.
//   보는 쪽 = 로그인한 사람: 자기 것(owner = 자기 메일)만. 기능이 꺼져 있으면 읽기 · 쓰기 · 올리기 모두 403(데이터를 받지도 주지도 않음).
//   받는 칸은 정해 두고 그 밖은 버림 · 글자 수 상한 · 제어 문자 지움. 화면은 글을 HTML 로 그리지 않음(status.js 가 이스케이프).
import type { Hono } from "hono";
import { redact } from "../session/redact";
import { featOn } from "./feature";
import { jsonCapped, sameSite, type SC, type Who } from "./routes";

export type Dev = { id: string; owner: string };
export const STATES = ["working", "blocked", "waiting", "done", "cancelled"] as const;
export type State = typeof STATES[number];
const KO: [RegExp, State][] = [[/^(끝|완료|done|closed|merged)/i, "done"], [/^(막힘|blocked|멈춤)/i, "blocked"], [/^(기다림|대기|확인|waiting)/i, "waiting"], [/^(안 ?함|취소|없앰|cancel)/i, "cancelled"]];
export const stateOf = (state: unknown, status: string): State => typeof state === "string" && (STATES as readonly string[]).includes(state) ? state as State : KO.find(([re]) => re.test(status.trim()))?.[1] ?? "working";
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;   // 줄바꿈 · 탭은 둠
const str = (v: unknown, n: number) => typeof v === "string" ? v.replace(CTRL, "").trim().slice(0, n) : typeof v === "number" && Number.isFinite(v) ? String(v).slice(0, n) : "";
const line1 = (v: unknown, n: number) => str(v, n).replace(/\s+/g, " ");
// 기기가 올리는 글은 저장 전에 비밀 꼴을 가림(세션 저장 · 도구 쓰기와 같은 redact). 글자 수를 먼저 자르면 비밀이 잘려 꼴이 안 맞으니 가린 뒤 자름
// 순서: 제어 문자를 먼저 지움(끼어 있으면 비밀 꼴을 못 찾음) → 상한 + 8KB 에서 자름(큰 글을 가림 정규식에 통째로 넣지 않게, 끝 표시가 필요한 개인 키 · 긴 JWT 도 꼴이 맞을 만큼) → 가림 → 상한
const safe = (v: unknown, n: number) => typeof v === "string" ? str(redact(v.replace(CTRL, "").slice(0, n + 8192)), n) : str(v, n);
const safe1 = (v: unknown, n: number) => safe(v, n).replace(/\s+/g, " ");
/** 시각: ms · 초 숫자나 ISO 글 → ms. 모르면 null */
export const msOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n < 1e12 ? n * 1000 : n) : null;
};
export const ID = /^(?!\.{1,2}$)[\w.-]{1,40}$/;   // 「.」 · 「..」 는 주소에 넣으면 브라우저가 경로를 줄여 세부가 안 열림
const PR_STATES = ["open", "merged", "closed", "deployed"];
const https = (v: unknown) => { const s = safe(v, 400); if (!/^https:\/\/[^\s"'<>]{3,400}$/.test(s)) return undefined; try { const u = new URL(s); return u.username || u.password || /\[(secret|redacted)/i.test(s) ? undefined : s; } catch { return undefined; } };   // 주소에 넣은 사용자 · 비밀번호 · 토큰이 남으면 링크로 안 씀
export const MAX_BODY = 1_000_000, MAX_TASKS = 300, MAX_LINES = 1000, MAX_TEXT = 8000;
const SAY_BODY = 64 * 1024, ACK_BODY = 128 * 1024;   // 말하기(글 8000자) · ack(열쇠 100개) 몸 상한
// 사람별 한도(공용 D1 을 한 사람이 채우지 못하게): 총량 · 하루 횟수 · 보관 기간. 있던 요청 덮어쓰기 · 같은 줄 다시 올리기는 한도를 안 먹음
export const LIMITS = { tasks: 2000, lines: 20_000, bytes: 50_000_000, dayPushes: 5000, dayLines: 5000, daySays: 500, keepDays: 90 };
export const LEASE_MS = 5 * 60_000;   // 가져간 줄을 맡는 시간 — 지나도 ack 가 없으면 다시 나감(기기가 가져간 뒤 죽어도 말이 안 사라짐)
const DAY_MS = 86_400_000, dayOf = (ms: number) => Math.floor(ms / DAY_MS);
type Use = { day: number; pushes: number; lines: number; says: number; last_at: number | null };
const useOf = async (db: D1Database, owner: string, now: number) => {   // 오늘 값(날이 바뀌었으면 0)
  const u = await db.prepare("SELECT day, pushes, lines, says, last_at FROM task_board_use WHERE owner = ?").bind(owner).first<Use>();
  return u && u.day === dayOf(now) ? u : { day: dayOf(now), pushes: 0, lines: 0, says: 0, last_at: u?.last_at ?? null };
};
const useAdd = (db: D1Database, owner: string, now: number, d: { pushes?: number; lines?: number; says?: number; last_at?: number }) => db.prepare(`INSERT INTO task_board_use(owner, day, pushes, lines, says, last_at) VALUES (?,?,?,?,?,?)
  ON CONFLICT(owner) DO UPDATE SET pushes = (CASE WHEN day = excluded.day THEN pushes ELSE 0 END) + excluded.pushes, lines = (CASE WHEN day = excluded.day THEN lines ELSE 0 END) + excluded.lines,
  says = (CASE WHEN day = excluded.day THEN says ELSE 0 END) + excluded.says, day = excluded.day, last_at = COALESCE(excluded.last_at, last_at)`).bind(owner, dayOf(now), d.pushes || 0, d.lines || 0, d.says || 0, d.last_at ?? null);
const totals = (db: D1Database, owner: string) => db.prepare(`SELECT (SELECT count(*) FROM task_board WHERE owner = ?1) tasks, (SELECT count(*) FROM task_board_convo WHERE owner = ?1) lines,
  (SELECT coalesce(sum(length(CAST(text AS BLOB))), 0) FROM task_board_convo WHERE owner = ?1) bytes`).bind(owner).first<{ tasks: number; lines: number; bytes: number }>();
const utf8 = (s: string) => new TextEncoder().encode(s).length;
/** 보관 기간 지우기(매일 정기 작업): 오래 안 올라온 요청 · 오래된 줄(전달 못 한 말 포함) · 옛 횟수 줄 */
export async function sweepTaskBoard(db: D1Database, now = Date.now()) {
  const cut = now - LIMITS.keepDays * DAY_MS;
  await db.batch([db.prepare("DELETE FROM task_board WHERE at < ?").bind(cut), db.prepare("DELETE FROM task_board_convo WHERE got_at < ?").bind(cut), db.prepare("DELETE FROM task_board_use WHERE day < ?").bind(dayOf(cut))]);
}

export function cleanTask(raw: unknown, now: number) {
  const t = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const id = t ? str(t.id, 40) : ""; if (!t || !ID.test(id)) return null;
  const status = safe1(t.status, 20);
  const prs = (Array.isArray(t.prs) ? t.prs : []).slice(0, 30).map(p => typeof p === "number" ? { n: p } : p && typeof p === "object" ? p as Record<string, unknown> : null)
    .filter((p): p is Record<string, unknown> => !!p && Number.isInteger(p.n) && Number(p.n) > 0 && Number(p.n) < 1e7)
    .map(p => ({ n: Number(p.n), state: PR_STATES.includes(String(p.state)) ? String(p.state) : "open", ...(https(p.url) ? { url: https(p.url) } : {}), ...(safe1(p.title, 120) ? { title: safe1(p.title, 120) } : {}) }));
  const list = (v: unknown, k: number, n: number) => (Array.isArray(v) ? v : []).slice(0, k).map(x => safe(x, n)).filter(Boolean);
  return {
    id, title: safe1(t.title, 200), quote: safe(t.quote, 4000), status, state: stateOf(t.state, status), dept: safe1(t.dept, 40), assignee: safe1(t.assignee, 80), area: safe1(t.area, 60),
    done_text: safe(t.done, 2000), next_text: safe(t.next, 2000), q: safe1(t.q, 40), prs, tasks: list(t.tasks, 20, 20).map(x => x.replace(/\s+/g, " ")), logs: list(t.logs, 30, 300),
    requested_at: msOf(t.requested_at), updated_at: msOf(t.updated_at) ?? now, completed_at: msOf(t.completed_at), src_ref: safe1(t.src_ref, 200) || null,
  };
}
export function cleanLine(raw: unknown) {
  const l = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const task_id = l ? str(l.task_id, 40) : "", text = l ? safe(l.text, MAX_TEXT) : "", at = l ? msOf(l.at) : null;
  if (!l || !ID.test(task_id) || !text || !at) return null;
  const src_ref = safe1(l.src_ref, 200) || null, who = safe1(l.who, 60), source = safe1(l.source, 40);
  const k = line1(l.k, 120) || line1(l.src_ref, 200) || `${at}:${who}:${text.slice(0, 60)}`;
  return { task_id, k: k.slice(0, 200), layer: l.layer === "agent" ? "agent" : "human", who, mine: l.mine === true ? 1 : 0, at, source, text, src_ref };
}

const J = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) as T : d; } catch { return d; } };
type Row = { id: string; title: string; quote: string; status: string; state: string; dept: string; assignee: string; area: string; done_text: string; next_text: string; q: string; prs: string; tasks: string; logs: string; requested_at: number | null; updated_at: number; completed_at: number | null; at: number };
const out = (r: Row, extra: Record<string, unknown> = {}) => ({ id: r.id, title: r.title, quote: r.quote, status: r.status, state: r.state, dept: r.dept, assignee: r.assignee, area: r.area,
  done: r.done_text, next: r.next_text, q: r.q, prs: J(r.prs, []), tasks: J(r.tasks, []), logs: J(r.logs, []), requested_at: r.requested_at, updated_at: r.updated_at, completed_at: r.completed_at, ...extra });

export function mountTaskBoard(host: Hono<any>, o: { who: Who; device: (c: SC) => Promise<Dev | null>; nameOf: (c: SC, email: string) => Promise<string> }) {
  const app = host as unknown as Hono<{ Bindings: { DB: D1Database; FLAGS_OFF?: string } }>;
  const gate = async (c: SC) => {   // 로그인 + 기능 켬
    const me = await o.who(c); if (!me) return { err: c.json({ ok: false, error: "로그인" }, 401) };
    if (!(await featOn(c.env.DB, me, "taskboard", c.env.FLAGS_OFF))) return { err: c.json({ ok: false, error: "설정 › 기능에서 켜야 해요" }, 403) };
    return { me };
  };
  const devGate = async (c: SC) => {
    const d = await o.device(c); if (!d) return { err: c.json({ ok: false, error: "기기 토큰" }, 401) };
    if (!(await featOn(c.env.DB, d.owner, "taskboard", c.env.FLAGS_OFF))) return { err: c.json({ ok: false, error: "이 계정은 태스크 현황을 꺼 뒀어요" }, 403) };
    return { d };
  };

  // ── 올리는 쪽(기기): { tasks?: [...], convo?: [...], remove?: [id] } — 요청은 덮어씀(같은 id), 대화 줄은 열쇠(k)가 같으면 한 번만
  app.post("/api/device/taskboard", async c => {
    const g = await devGate(c); if ("err" in g) return g.err;
    const b = await jsonCapped(c, MAX_BODY) as Record<string, unknown> | null | undefined;
    if (b === undefined) return c.json({ ok: false, error: "너무 커요" }, 413);
    if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ ok: false, error: "json" }, 400);
    const ta = Array.isArray(b.tasks) ? b.tasks : [], cv = Array.isArray(b.convo) ? b.convo : [], rm = Array.isArray(b.remove) ? b.remove : [];
    if (ta.length > MAX_TASKS || cv.length > MAX_LINES || rm.length > MAX_TASKS) return c.json({ ok: false, error: `한 번에 요청 ${MAX_TASKS} · 대화 ${MAX_LINES}줄까지` }, 413);
    const now = Date.now(), DB = c.env.DB, own = g.d.owner.toLowerCase(), st: D1PreparedStatement[] = [], ls: D1PreparedStatement[] = [];
    const use = await useOf(DB, own, now);
    if (use.pushes >= LIMITS.dayPushes) return c.json({ ok: false, error: "오늘 올리기 횟수를 다 썼어요", max_per_day: LIMITS.dayPushes }, 429);
    const gone = rm.map(x => str(x, 40)).filter(x => ID.test(x)), goneSet = new Set(gone);
    const cleaned = ta.map(t => cleanTask(t, now)), badTasks = cleaned.filter(t => !t).length;
    const tasks = cleaned.filter(t => !!t && !goneSet.has(t.id)) as NonNullable<ReturnType<typeof cleanTask>>[], lines = cv.map(cleanLine).filter(l => !!l);
    // 지우기 먼저(한도에서 자리를 비움). 전달 대기 말은 안 지움 — 올렸던 기기가 가져가 ack 하면 그때 사라짐
    for (const id of gone) st.push(DB.prepare("DELETE FROM task_board WHERE owner = ? AND id = ?").bind(own, id), DB.prepare("DELETE FROM task_board_convo WHERE owner = ? AND task_id = ? AND pending = 0").bind(own, id));
    for (let i = 0; i < st.length; i += 50) await DB.batch(st.slice(i, i + 50));
    st.length = 0;
    // 이미 있는 것은 한도를 안 먹음(slack-import 와 같음) — 새 요청 · 새 줄만 셈
    const [hadT, hadL] = await DB.batch([
      DB.prepare("SELECT id FROM task_board WHERE owner = ? AND id IN (SELECT value FROM json_each(?))").bind(own, JSON.stringify(tasks.map(t => t.id))),
      DB.prepare("SELECT task_id, k, text FROM task_board_convo WHERE owner = ? AND (task_id, k) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))").bind(own, JSON.stringify(lines.map(l => [l.task_id, l.k]))),
    ]);
    const hasT = new Set((hadT.results as { id: string }[]).map(r => r.id)), kept = new Map((hadL.results as { task_id: string; k: string; text: string }[]).map(r => [JSON.stringify([r.task_id, r.k]), r.text]));
    const freshT = new Set(tasks.filter(t => !hasT.has(t.id)).map(t => t.id)), seen = new Map(kept); let repeats = 0, newLines = 0, newBytes = 0;
    for (const l of lines) {   // 같은 열쇠 · 같은 글 = 다시 올리기(빠진 게 아님), 같은 열쇠 · 다른 글 = 빠짐(아래 dropped)
      const key = JSON.stringify([l.task_id, l.k]), had = seen.get(key);
      if (had === undefined) { seen.set(key, l.text); newLines++; newBytes += utf8(l.text); } else if (had === l.text) repeats++;
    }
    if (use.lines + newLines > LIMITS.dayLines) return c.json({ ok: false, error: "오늘 새 대화 줄 수를 다 썼어요", max_per_day: LIMITS.dayLines, left: Math.max(0, LIMITS.dayLines - use.lines) }, 429);
    if (freshT.size || newLines) {
      const t = await totals(DB, own);
      if (t && t.tasks + freshT.size > LIMITS.tasks) return c.json({ ok: false, error: "요청 수 상한이에요 — 안 쓰는 요청을 지워 주세요", max_tasks: LIMITS.tasks }, 429);
      if (t && t.lines + newLines > LIMITS.lines) return c.json({ ok: false, error: "대화 줄 수 상한이에요 — 안 쓰는 요청을 지워 주세요", max_lines: LIMITS.lines }, 429);
      if (t && newLines && t.bytes + newBytes > LIMITS.bytes) return c.json({ ok: false, error: "대화 크기 상한이에요 — 안 쓰는 요청을 지워 주세요", max_bytes: LIMITS.bytes }, 429);
    }
    for (const t of tasks) st.push(DB.prepare(`INSERT INTO task_board(owner, id, title, quote, status, state, dept, assignee, area, done_text, next_text, q, prs, tasks, logs, requested_at, updated_at, completed_at, src_ref, device_id, at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner, id) DO UPDATE SET title = excluded.title, quote = excluded.quote, status = excluded.status, state = excluded.state, dept = excluded.dept,
      assignee = excluded.assignee, area = excluded.area, done_text = excluded.done_text, next_text = excluded.next_text, q = excluded.q, prs = excluded.prs, tasks = excluded.tasks, logs = excluded.logs,
      requested_at = excluded.requested_at, updated_at = excluded.updated_at, completed_at = excluded.completed_at, src_ref = excluded.src_ref, device_id = excluded.device_id, at = excluded.at`)
      .bind(own, t.id, t.title, t.quote, t.status, t.state, t.dept, t.assignee, t.area, t.done_text, t.next_text, t.q, JSON.stringify(t.prs), JSON.stringify(t.tasks), JSON.stringify(t.logs), t.requested_at, t.updated_at, t.completed_at, t.src_ref, g.d.id, now));
    // 대화 줄은 그 요청이 이 사람 것으로 있을 때만(이번에 같이 올린 것 포함) — 남의 요청 id 로 줄을 꽂지 못함(owner 가 늘 자기 메일이라 애초에 안 섞이지만, 고아 줄을 안 만듦)
    for (const l of lines) ls.push(DB.prepare(`INSERT INTO task_board_convo(owner, task_id, k, layer, who, mine, at, source, text, src_ref, got_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM task_board WHERE owner = ? AND id = ?)
      ON CONFLICT(owner, task_id, k) DO NOTHING`).bind(own, l.task_id, l.k, l.layer, l.who, l.mine, l.at, l.source, l.text, l.src_ref, now, own, l.task_id));
    let added = 0;
    for (let i = 0; i < st.length; i += 50) await DB.batch(st.slice(i, i + 50));   // 요청 먼저(대화 줄은 요청이 있어야 들어감)
    for (let i = 0; i < ls.length; i += 50) added += (await DB.batch(ls.slice(i, i + 50))).reduce((a, x) => a + Number(x.meta?.changes || 0), 0);
    await useAdd(DB, own, now, { pushes: 1, lines: added, last_at: now }).run();
    // dropped = 망가진 요청 · 줄 + 안 들어간 줄(없는 요청 · 같은 열쇠의 다른 글). 같은 줄 다시 올리기는 안 셈
    return c.json({ ok: true, tasks: tasks.length, lines: lines.length, added, dropped: badTasks + cv.length - repeats - added });
  });
  // 보더에서 「말하기」로 쓴 줄 — 그 요청을 올린 기기만 가져감(가져감 표시를 남겨 다른 회차 · 기기가 또 받지 않음). 전한 뒤 ack, ack 가 없으면 LEASE_MS 뒤 다시 나감
  app.get("/api/device/taskboard/said", async c => {
    const g = await devGate(c); if ("err" in g) return g.err;
    const now = Date.now();
    const rows = (await c.env.DB.prepare(`UPDATE task_board_convo SET taken_by = ?, taken_at = ? WHERE rowid IN (SELECT c.rowid FROM task_board_convo c LEFT JOIN task_board b ON b.owner = c.owner AND b.id = c.task_id
      WHERE c.owner = ? AND c.pending = 1 AND COALESCE(b.device_id, c.to_device) = ? AND (c.taken_at IS NULL OR c.taken_at < ?) ORDER BY c.at LIMIT 100) RETURNING task_id, k, who, at, text`)
      .bind(g.d.id, now, g.d.owner.toLowerCase(), g.d.id, now - LEASE_MS).all<{ at: number }>()).results;
    return c.json({ ok: true, said: rows.sort((a, b) => a.at - b.at) }, 200, { "cache-control": "no-store" });
  });
  app.post("/api/device/taskboard/said/ack", async c => {
    const g = await devGate(c); if ("err" in g) return g.err;
    const b = await jsonCapped(c, ACK_BODY) as { keys?: unknown } | null | undefined; if (b === undefined) return c.json({ ok: false, error: "너무 커요" }, 413);
    const keys = Array.isArray(b?.keys) ? b!.keys.slice(0, 100) : [];
    const own = g.d.owner.toLowerCase(), ok = keys.map(x => x && typeof x === "object" ? x as Record<string, unknown> : {}).filter(x => ID.test(str(x.task_id, 40)) && str(x.k, 200)).map(x => [str(x.task_id, 40), str(x.k, 200)]);
    const r = ok.length ? await c.env.DB.batch(ok.map(([t, k]) => c.env.DB.prepare("UPDATE task_board_convo SET pending = 0 WHERE owner = ? AND task_id = ? AND k = ? AND pending = 1 AND taken_by = ?").bind(own, t, k, g.d.id))) : [];
    const acked = r.reduce((a, x) => a + Number(x.meta?.changes || 0), 0);
    // 요청이 이미 지워진 줄은 전했으니 이제 지움
    if (acked) await c.env.DB.prepare("DELETE FROM task_board_convo WHERE owner = ?1 AND pending = 0 AND task_id IN (SELECT value FROM json_each(?2)) AND task_id NOT IN (SELECT id FROM task_board WHERE owner = ?1)").bind(own, JSON.stringify(ok.map(x => x[0]))).run();
    return c.json({ ok: true, acked });
  });

  // ── 보는 쪽(로그인한 사람)
  app.get("/api/me/taskboard", async c => {
    const g = await gate(c); if ("err" in g) return g.err;
    const DB = c.env.DB;
    const [rows, cnt, use] = await DB.batch([
      DB.prepare("SELECT id, title, quote, status, state, dept, assignee, area, done_text, next_text, q, prs, tasks, logs, requested_at, updated_at, completed_at, at FROM task_board WHERE owner = ? ORDER BY updated_at DESC LIMIT 1000").bind(g.me),
      DB.prepare("SELECT task_id, count(*) n, max(at) last, sum(pending) wait FROM task_board_convo WHERE owner = ? GROUP BY task_id").bind(g.me),
      DB.prepare("SELECT last_at FROM task_board_use WHERE owner = ?").bind(g.me),
    ]);
    const by = new Map((cnt.results as { task_id: string; n: number; last: number; wait: number }[]).map(r => [r.task_id, r]));
    const at = Math.max(0, ...(rows.results as Row[]).map(r => r.at), (use.results[0] as { last_at?: number } | undefined)?.last_at || 0);   // 마지막으로 올라온 때 = 요청이든 대화 줄이든 기기가 올린 때(사람의 말하기는 안 셈)
    return c.json({ ok: true, at: at || null, tasks: (rows.results as Row[]).map(r => out(r, { quote: r.quote.slice(0, 300), logs: undefined, lines: by.get(r.id)?.n || 0, last_line: by.get(r.id)?.last || null })) }, 200, { "cache-control": "no-store" });
  });
  app.get("/api/me/taskboard/:id", async c => {
    const g = await gate(c); if ("err" in g) return g.err;
    const id = c.req.param("id"); if (!ID.test(id)) return c.json({ ok: false, error: "없는 태스크예요" }, 404);
    const r = await c.env.DB.prepare("SELECT * FROM task_board WHERE owner = ? AND id = ?").bind(g.me, id).first<Row>();
    if (!r) return c.json({ ok: false, error: "없는 태스크예요" }, 404);
    const lines = (await c.env.DB.prepare("SELECT k, layer, who, mine, at, source, text, pending FROM (SELECT * FROM task_board_convo WHERE owner = ? AND task_id = ? ORDER BY at DESC LIMIT 2000) ORDER BY at, k").bind(g.me, id).all()).results;
    return c.json({ ok: true, task: out(r), convo: lines.map(l => ({ ...l, k: redact(String(l.k)) })) }, 200, { "cache-control": "no-store" });
  });
  // 「말하기」: 그 요청 대화에 내 줄(사람 겹) — 올리는 쪽이 가져가 에이전트에게 전함(전하기 전까지 pending)
  app.post("/api/me/taskboard/:id/say", async c => {
    if (!sameSite(c)) return c.json({ ok: false, error: "forbidden" }, 403);
    const g = await gate(c); if ("err" in g) return g.err;
    const id = c.req.param("id"); if (!ID.test(id)) return c.json({ ok: false, error: "없는 태스크예요" }, 404);
    const b = await jsonCapped(c, SAY_BODY) as { text?: unknown } | null | undefined; if (b === undefined) return c.json({ ok: false, error: "너무 길어요" }, 413);
    const text = str(b?.text, MAX_TEXT);
    if (!text) return c.json({ ok: false, error: "할 말을 써 주세요" }, 400);
    const task = await c.env.DB.prepare("SELECT device_id FROM task_board WHERE owner = ? AND id = ?").bind(g.me, id).first<{ device_id: string | null }>();
    if (!task) return c.json({ ok: false, error: "없는 태스크예요" }, 404);
    const now = Date.now(), use = await useOf(c.env.DB, g.me, now), tot = await totals(c.env.DB, g.me);
    if (use.says >= LIMITS.daySays) return c.json({ ok: false, error: `오늘은 말하기를 ${LIMITS.daySays}번까지 쓸 수 있어요` }, 429);
    if (tot && (tot.lines >= LIMITS.lines || tot.bytes + utf8(text) > LIMITS.bytes)) return c.json({ ok: false, error: "대화가 너무 많아요 — 안 쓰는 요청을 지운 뒤 다시 해 주세요" }, 429);
    const k = `say:${now}:${crypto.randomUUID().slice(0, 8)}`, who = (await o.nameOf(c, g.me).catch(() => "")) || g.me.split("@")[0];
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO task_board_convo(owner, task_id, k, layer, who, mine, at, source, text, pending, to_device, got_at) VALUES (?,?,?,?,?,1,?,?,?,1,?,?)").bind(g.me, id, k, "human", who.slice(0, 60), now, "board", text, task.device_id, now),
      useAdd(c.env.DB, g.me, now, { says: 1 }),
    ]);
    return c.json({ ok: true, line: { k, layer: "human", who, mine: 1, at: now, source: "board", text, pending: 1 } });
  });
}
