import type { Context, Hono } from "hono";
import { checkView, readView, STATUSES, type Status, type TaskRow } from "./rules";

type Env = { DB: D1Database };
type C = Context<{ Bindings: Env }>;
type Who = (c: C) => Promise<string | null>;
const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) as T : d; } catch { return d; } };
const sameSite = (c: C) => c.req.header("x-hb") === "1" && ["same-origin", "none", undefined].includes(c.req.header("sec-fetch-site"));
const CLOSED_DAYS = 30;

export function mountTasks(host: Hono<any>, who: Who, paneOf: (id: string) => string) {
  const app = host as unknown as Hono<{ Bindings: Env }>;
  app.get("/api/me/tasks", async c => {
    const me = await who(c); if (!me) return c.json({ ok: false, error: "로그인" }, 401);
    const DB = c.env.DB, since = Date.now() - CLOSED_DAYS * 86400_000;
    const [rows, set] = await Promise.all([
      DB.prepare("SELECT id, name, pinned_name, task, counts, updated_at, archived_at FROM mnode WHERE owner = ? AND id >= 'tk_' AND id < 'tk`' AND id LIKE 'tk\\_%' ESCAPE '\\' AND (archived_at IS NULL OR archived_at > ?)").bind(me, since).all<{ id: string; name: string; pinned_name: string | null; task: string | null; counts: string | null; updated_at: number; archived_at: number | null }>(),
      DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me).first<{ data: string }>(),
    ]);
    const data = json<{ parent?: Record<string, string>; taskview?: unknown } | null>(set?.data, {}) ?? {};   // 저장값이 null 이어도 500 이 나지 않게
    const chatSince = Date.now() - 24 * 3600_000;   // 대화 길(member-board load)은 끝난 지 하루까지만 노드를 앎 — 그 뒤엔 화면이 입력 칸을 닫음
    const tasks: TaskRow[] = rows.results.map(r => {
      const t = json<{ state?: string; line?: string; body?: string; issue?: string; fields?: Record<string, string>; confirm?: boolean }>(r.task, {}) ?? {};
      const up = data.parent?.[r.id];
      return {
        id: r.id, pane: paneOf(r.id), name: r.pinned_name || r.name, status: (STATUSES.includes(t.state as Status) ? t.state : "working") as Status, line: t.line || "", body: t.body || "", issue: t.issue || "",
        fields: t.fields && typeof t.fields === "object" ? t.fields : {}, parent: up && up !== "top" ? up : null, main: json<{ main?: string } | null>(r.counts, {})?.main || null, updated_at: r.updated_at, closed: !!r.archived_at, chat_off: !!r.archived_at && Number(r.archived_at) <= chatSince, confirm: !!t.confirm,
      };
    });
    return c.json({ ok: true, tasks, view: readView(data.taskview) }, 200, { "cache-control": "no-store" });
  });
  // 메뉴 줄 판단용(보드를 열 때마다 부름) — 있는지만
  app.get("/api/me/tasks/has", async c => {
    const me = await who(c); if (!me) return c.json({ ok: false, error: "로그인" }, 401);
    const r = await c.env.DB.prepare("SELECT 1 FROM mnode WHERE owner = ? AND id >= 'tk_' AND id < 'tk`' AND id LIKE 'tk\\_%' ESCAPE '\\' AND archived_at IS NULL LIMIT 1").bind(me).first();
    return c.json({ ok: true, has: !!r }, 200, { "cache-control": "no-store" });
  });
  // 내 보기 저장 — 다른 설정 칸은 그대로 두고 taskview 만. 저장값이 객체가 아니면 새로 시작(그 값으로는 어차피 못 읽음)
  app.put("/api/me/tasks/view", async c => {
    if (!sameSite(c)) return c.json({ ok: false, error: "forbidden" }, 403);
    const me = await who(c); if (!me) return c.json({ ok: false, error: "로그인" }, 401);
    if (+(c.req.header("content-length") || 0) > 16_000) return c.json({ ok: false, error: "너무 큼" }, 413);
    const body = await c.req.json().catch(() => null), view = checkView(body);
    if (!view) return c.json({ ok: false, error: "보기 설정이 올바르지 않아요" }, 400);
    if ((body as Record<string, unknown>).nav === undefined) {
      const was = await c.env.DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me).first<{ data: string }>().catch(() => null);
      view.nav = readView(json<{ taskview?: unknown } | null>(was?.data, {})?.taskview).nav;
    }
    await c.env.DB.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?1, json_object('taskview', json(?2)), ?3) ON CONFLICT(owner) DO UPDATE SET data = json_set(CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END, '$.taskview', json(?2)), updated_at = ?3").bind(me, JSON.stringify(view), Date.now()).run();
    return c.json({ ok: true, view });
  });
}
