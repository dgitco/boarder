import type { Context, Hono } from "hono";
import { redact } from "./session/redact";
import { cut } from "./member-board";

type Env = { DB: D1Database };
type R = Record<string, unknown>;
const KINDS = ["start", "progress", "blocked", "done", "decision", "incident", "deadline", "reply", "status"] as const;
const KIND_SQL = KINDS.map(k => `'${k}'`).join(",");
const NOT_PRIM = "(b.thread IS NULL OR (b.thread != 'primary' AND b.thread NOT LIKE 'p:%'))";   // Primary 채팅 · 그 스레드 답은 창의 지금이 아님
const DAY = 86_400_000, MAX_BACK = 30 * DAY, LIM_DEF = 100, LIM_MAX = 500;
const ACT = new Set(["working", "idle", "question", "done"]);
const WAIT = /깨움|기다|대기|wait/i;

const OWN_SQL = "b.win != '보더 들여오기' AND b.win NOT LIKE '%boarder-import' AND b.win NOT LIKE '%boarder:import'";   // member-board OWN 과 같은 이름(보더 자신의 줄)
const WK_SQL = "CASE WHEN substr(b.wid, 1, 3) = 'ew_' THEN b.wid ELSE '' END";
const TOK_OK = (w: string) => `SELECT 1 FROM agent_token t WHERE t.owner = ?1 AND t.win = ${w}.win
      AND (${w}.wk = '' OR substr(t.pane, -length(${w}.wk) - 1) = ':' || ${w}.wk)`;
const REV = "(t.revoked_at IS NULL OR t.revoked_at >= ?5)";
export const WINDOWS_SQL = `WITH a AS (
  SELECT b.win, ${WK_SQL} wk, max(b.id) last_id FROM board_log b INDEXED BY board_log_owner
  WHERE b.owner = ?1 AND b.at >= ?2 AND b.kind IN (${KIND_SQL}) AND ${NOT_PRIM} AND ${OWN_SQL}
  GROUP BY b.win, wk
), g AS (
  SELECT win, wk, last_id,
    SUM(CASE WHEN wk <> '' THEN 1 ELSE 0 END) OVER (PARTITION BY win) nw,
    MAX(CASE WHEN wk <> '' THEN last_id END) OVER (PARTITION BY win) wid_max,
    MAX(CASE WHEN wk = '' THEN last_id END) OVER (PARTITION BY win) shell_max,
    MAX(last_id) OVER (PARTITION BY win) name_max
  FROM a
), m AS (
  SELECT win, wk,
    CASE WHEN last_id = wid_max THEN max(last_id, IFNULL(shell_max, 0)) ELSE last_id END last_id,
    CASE WHEN last_id = wid_max AND shell_max IS NOT NULL THEN 1 ELSE 0 END att   -- wid 없는 줄을 붙인 창(가장 최근 wid)
  FROM g WHERE nw >= 2 AND wk <> ''
  UNION ALL
  SELECT win, '', name_max, 0 FROM g WHERE nw < 2 GROUP BY win
), p AS (
  SELECT m.win, m.wk, m.last_id, m.att FROM m
  WHERE m.last_id < ?3 AND (EXISTS (${TOK_OK("m")} AND t.revoked_at IS NULL) OR EXISTS (${TOK_OK("m")} AND t.revoked_at >= ?5))
  ORDER BY m.last_id DESC LIMIT ?4
), x AS (
  SELECT p.win, p.wk, p.last_id,
    (SELECT b.id FROM board_log b WHERE b.owner = ?1 AND b.win = p.win
      AND (p.wk = '' OR b.wid = p.wk OR (p.att = 1 AND b.wid IS NULL))
      AND b.kind IN (${KIND_SQL}) AND b.kind != 'status' AND ${NOT_PRIM} ORDER BY b.id DESC LIMIT 1) real_id,
    (SELECT t.rowid FROM agent_token t WHERE t.owner = ?1 AND t.win = p.win
      AND (p.wk = '' OR substr(t.pane, -length(p.wk) - 1) = ':' || p.wk)
      AND ${REV} ORDER BY t.created_at DESC LIMIT 1) tok
  FROM p
)
SELECT x.win, x.last_id, t.pane, t.device_id, t.revoked_at, d.name dev, d.revoked_at dev_rv,
  (SELECT i.state FROM imp_item i WHERE i.owner = ?1 AND i.key = 'window:' || t.pane) ist,
  (SELECT i.gone_at FROM imp_item i WHERE i.owner = ?1 AND i.key = 'window:' || t.pane) gone_at, l.kind lk, l.text lt, l.at la, r.kind rk, r.text rt, r.at ra
FROM x LEFT JOIN agent_token t ON t.rowid = x.tok
  LEFT JOIN device d ON d.id = t.device_id
  LEFT JOIN board_log l ON l.id = x.last_id
  LEFT JOIN board_log r ON r.id = x.real_id
ORDER BY x.last_id DESC`;
// ?1..?5 — ?5 = since(닫힌 창을 since 뒤까지 셈) · NULL(산 열쇠만, 30일 기본). 시험 · 옛 이름 호환으로 같은 글을 OPEN 으로도 냄
export const WINDOWS_SQL_OPEN = WINDOWS_SQL;

export type Line = { kind: string; text: string; at: number };
export type Win = {
  device: string | null; device_id: string | null; window: string; name: string; task: string | null;
  state: "open" | "parked" | "closed"; activity: string | null; at: number;
  last: Line | null; blocked: Line | null; status: Line | null; wait: string | null;
};
export type Query = { since?: string | null; task?: string | null; limit?: string | null; cursor?: string | null; closed?: string | null };

/** 한 줄 글: 첫 줄만 · 200자 · 비밀값 꼴 가림(쓰기 길 거르개(③)와 따로 — 옛 줄도 가려서 냄) */
const one = (s: unknown) => cut(redact(String(s ?? "").split("\n")[0].replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim()), 200);
const line = (kind: unknown, text: unknown, at: unknown): Line | null => kind ? { kind: String(kind), text: one(text), at: Number(at) || 0 } : null;
const TASK = /#(\d{1,7})(?!\d)/;
export const taskOf = (name: string, text?: string | null) => { const m = TASK.exec(name) || TASK.exec(String(text || "")); return m ? "#" + m[1] : null; };

/** since: 밀리초 · 초 숫자나 ISO 글. 없으면 하루 전, 30일보다 앞은 30일로. 틀린 꼴은 null(400) */
export function sinceOf(v: string | null | undefined, now = Date.now()): number | null {
  if (v === undefined || v === null || v === "") return now - DAY;
  const s = v.trim(), n = /^\d{9,13}$/.test(s) ? Number(s) : /^\d{4}-\d{2}-\d{2}/.test(s) ? Date.parse(s) : NaN;
  if (!Number.isFinite(n)) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  return Math.max(now - MAX_BACK, Math.min(ms, now));
}
export async function windowsNow(db: D1Database, me: string, q: Query, now = Date.now()): Promise<{ windows: Win[]; next: string | null; since: number; closed: boolean } | { error: string }> {
  const since = sinceOf(q.since, now); if (since === null) return { error: "since: 밀리초 · 초 숫자나 ISO 시각(예 2026-11-05T21:00:00+09:00)" };
  const t = String(q.task ?? "").trim(); if (t && !/^#?\d{1,7}$/.test(t)) return { error: "task: #번호(예 #1234)" };
  const task = t ? "#" + String(Number(t.replace(/^#/, ""))) : null;
  const lim = q.limit ? Number(q.limit) : LIM_DEF; if (!Number.isInteger(lim) || lim < 1 || lim > LIM_MAX) return { error: `limit: 1–${LIM_MAX}` };
  const c = String(q.cursor ?? ""); if (c && !/^\d{1,15}$/.test(c)) return { error: "cursor: 앞 답의 next 그대로" };
  const cv = String(q.closed ?? "").trim().toLowerCase(); if (cv && !/^(0|1|true|false|on|off)$/.test(cv)) return { error: "closed: 0 · 1" };
  const wide = q.since != null && String(q.since).trim() !== "" && since <= now - MAX_BACK;
  const withClosed = cv ? /^(1|true|on)$/.test(cv) : !wide;
  const rows = (await db.prepare(WINDOWS_SQL).bind(me, since, c ? Number(c) : Number.MAX_SAFE_INTEGER, task ? -1 : lim + 1, withClosed ? since : null).all<R>()).results || [];
  const out: (Win & { id: number })[] = [];
  for (const r of rows) {
    const name = String(r.win || "");
    const closed = r.revoked_at != null || r.dev_rv != null || r.gone_at != null || r.ist === "gone";
    const last = line(r.lk, r.lt, r.la), real = line(r.rk, r.rt, r.ra);
    // 판(member-board paneNow · data pane)과 같은 「지금」: 막힘 = 상태 줄이 아닌 가장 새 줄이 막힘(그때 last = 그 막힘 줄) · 상태 = 가장 새 줄이 하루 안 상태 줄
    const blocked = real && real.kind === "blocked" ? real : null, status = !blocked && last?.kind === "status" && now - last.at < DAY ? last : null;
    const w = {
      device: r.dev == null ? null : cut(redact(String(r.dev)), 80), device_id: r.device_id == null ? null : String(r.device_id), window: String(r.pane ?? ""), name: cut(redact(name), 80),
      task: taskOf(name, real?.text), state: closed ? "closed" as const : r.ist === "parked" ? "parked" as const : "open" as const, activity: !closed && ACT.has(String(r.ist)) ? String(r.ist) : null, at: last?.at || 0,
      last: blocked || last, blocked, status, wait: blocked ? blocked.text : status && WAIT.test(status.text) ? status.text : null, id: Number(r.last_id),
    };
    if (task && w.task !== task) continue;
    out.push(w);
  }
  const page = out.slice(0, lim), more = out.length > lim;
  return { windows: page.map(({ id: _id, ...w }) => w), next: more ? String(page[page.length - 1].id) : null, since, closed: withClosed };
}

type Hooks = {
  /** 로그인한 회원의 보드 열쇠(회원 메일 · 켠 주인 canon). 회원 길 밖(옛 주인)이면 null → 403 */
  human: (c: Context<any>) => Promise<{ me: string | null } | null>;
  /** 기기 열쇠(scope full)의 보드 열쇠. 기기 열쇠가 아니면 undefined(401), 보드 밖 기기면 null(403) */
  device: (c: Context<any>) => Promise<string | null | undefined>;
};
const NOSTORE = { "cache-control": "no-store" };
export function mountWindows(host: Hono<any>, h: Hooks) {
  const app = host as unknown as Hono<{ Bindings: Env }>;
  const reply = async (c: Context<{ Bindings: Env }>, me: string) => {
    const r = await windowsNow(c.env.DB, me, { since: c.req.query("since"), task: c.req.query("task"), limit: c.req.query("limit"), cursor: c.req.query("cursor"), closed: c.req.query("closed") });
    return "error" in r ? c.json(r, 400, NOSTORE) : c.json(r, 200, NOSTORE);
  };
  const bearer = (c: Context) => (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const writeKey = (c: Context) => /^bxa_/.test(bearer(c));
  app.get("/api/me/windows", async c => {
    if (writeKey(c)) return c.json({ error: "창 열쇠(쓰기)로는 못 읽어요" }, 403, NOSTORE);
    if (c.req.header("authorization") !== undefined) return c.json({ error: "로그인" }, 401, NOSTORE);   // 사람 길은 세션만 — 기기는 /api/device/windows
    const s = await h.human(c); if (!s) return c.json({ error: "로그인" }, 401, NOSTORE);
    if (!s.me) return c.json({ error: "no" }, 403, NOSTORE);
    return reply(c, s.me);
  });
  app.get("/api/device/windows", async c => {
    if (writeKey(c)) return c.json({ error: "창 열쇠(쓰기)로는 못 읽어요" }, 403, NOSTORE);
    const me = await h.device(c); if (me === undefined) return c.json({ error: "기기 토큰" }, 401, NOSTORE);
    if (!me) return c.json({ error: "no" }, 403, NOSTORE);
    return reply(c, me);
  });
}
