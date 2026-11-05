import type { Context, Hono } from "hono";

// role-edit.ts mountRoleEdit 처럼 index.ts 의 Env 를 그대로 받음(여기서 쓰는 것은 DB 하나)
type C = Context<any>;
const db = (c: C) => c.env.DB as D1Database;
export type RevokeDeps = {
  sameSite: (c: C) => boolean;
  signedIn: (c: C) => Promise<{ user: { email: string } } | null>;
  ownerMails: (env: any, email: string) => string[];
  dropCache: () => void;
};

const KEY = /^[\w@.:/+-]{2,120}$/;
export const deviceHost = (id: string) => `device:${id}`;
export const NOT_BLOCKED = "NOT EXISTS (SELECT 1 FROM window_block WHERE device_id = ? AND pane = ?)";
export const noBlockTable = (e: unknown) => /no such table: window_block/i.test(String((e as Error)?.message || e));
/** 기기 끊기 batch 용 — 0077 전이면 token_audit 도 없음(둘 중 하나라도 없으면 예전 길) */
export const noRevokeTables = (e: unknown) => /no such table: (window_block|token_audit)/i.test(String((e as Error)?.message || e));
// 감사 한 줄 — 끊기 · 다시 켜기와 같은 batch 에 넣어 한 번에(쓰기가 반쯤 실패해 「끊겼는데 감사 없음」이 없게).
//   n = 끊긴 열쇠 수를 batch 안에서 셈(nSql), when = 이 줄을 남길 조건(실제로 끊거나 푼 때만)
export const auditStmt = (db: D1Database, a: { owner: string; act: "revoke_device" | "revoke_window" | "enable_window"; device: string; pane?: string | null; by: string; at: number; nSql?: string; nArgs?: unknown[]; when?: string; whenArgs?: unknown[] }) =>
  db.prepare(`INSERT INTO token_audit(owner, at, act, device_id, pane, by_email, n) SELECT ?,?,?,?,?,?, ${a.nSql ? `(${a.nSql})` : "0"} WHERE ${a.when || "1"}`)
    .bind(a.owner, a.at, a.act, a.device, a.pane ?? null, a.by.toLowerCase(), ...(a.nArgs || []), ...(a.whenArgs || []));
const LIVE_WIN = "SELECT count(*) FROM agent_token WHERE host = ? AND pane = ? AND revoked_at IS NULL";

/** 로그인한 사람 + 그 기기의 주인인지. 응답(401 · 403 다른 사이트 · 404 없음/남의 것)이거나 { me, owner, revoked } */
export async function ownDevice(c: C, d: RevokeDeps, id: string): Promise<Response | { me: string; owner: string; revoked: boolean }> {
  if (!d.sameSite(c)) return c.json({ error: "no" }, 403);
  if (c.req.header("authorization") !== undefined || c.req.header("x-boarder-device") !== undefined) return c.json({ error: "로그인" }, 401);
  const s = await d.signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const row = await db(c).prepare("SELECT owner, revoked_at FROM device WHERE id = ?").bind(id).first<{ owner: string; revoked_at: number | null }>();
  // 남의 기기도 「없는 기기」 404 — 그 id 가 있는지 남에게 알리지 않음(격리 시험 isolation-e2e.mjs 「B 기기 폐기 404」 · 남의 카드 답 404 와 같은 약속)
  if (!row || !d.ownerMails(c.env, s.user.email).includes(String(row.owner).toLowerCase())) return c.json({ error: "없는 기기" }, 404);
  return { me: s.user.email, owner: row.owner, revoked: !!row.revoked_at };
}

export function mountTokenRevoke(app: Hono<any>, d: RevokeDeps) {
  app.get("/api/me/devices/:id/windows", async c => {
    const id = c.req.param("id"), o = await ownDevice(c, d, id); if (o instanceof Response) return o;
    const [ws, bs] = await db(c).batch([
      db(c).prepare("SELECT pane, win, at, live FROM (SELECT pane, win, created_at AS at, max(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) OVER (PARTITION BY pane) AS live, row_number() OVER (PARTITION BY pane ORDER BY created_at DESC, rowid DESC) AS rn FROM agent_token WHERE host = ?) WHERE rn = 1 ORDER BY at DESC LIMIT 200").bind(deviceHost(id)),
      db(c).prepare("SELECT pane, at FROM window_block WHERE device_id = ?").bind(id),
    ]);
    const blocked = new Map(((bs.results || []) as { pane: string; at: number }[]).map(b => [b.pane, b.at]));
    const windows = ((ws.results || []) as { pane: string; win: string; at: number; live: number }[])
      .map(w => ({ key: w.pane, name: w.win, at: w.at, live: !o.revoked && !!w.live, blocked_at: blocked.get(w.pane) ?? null }));
    return c.json({ device: id, revoked: o.revoked, windows }, 200, { "cache-control": "no-store" });
  });
  app.post("/api/me/devices/:id/windows/revoke", async c => {
    const id = c.req.param("id"), o = await ownDevice(c, d, id); if (o instanceof Response) return o;
    const b = await c.req.json<{ key?: unknown }>().catch(() => ({} as { key?: unknown }));
    const key = String(b.key ?? ""); if (!KEY.test(key)) return c.json({ error: "창 키" }, 400);
    const seen = await db(c).prepare("SELECT 1 FROM agent_token WHERE host = ? AND pane = ? LIMIT 1").bind(deviceHost(id), key).first();
    if (!seen) return c.json({ error: "이 기기에 없는 창" }, 404);
    const now = Date.now();
    const [, u] = await db(c).batch([
      auditStmt(db(c), { owner: o.owner, act: "revoke_window", device: id, pane: key, by: o.me, at: now, nSql: LIVE_WIN, nArgs: [deviceHost(id), key] }),   // 끊기 전에 산 열쇠를 셈
      db(c).prepare("UPDATE agent_token SET revoked_at = ? WHERE host = ? AND pane = ? AND revoked_at IS NULL").bind(now, deviceHost(id), key),
      db(c).prepare("INSERT INTO window_block(device_id, pane, owner, at) VALUES (?,?,?,?) ON CONFLICT(device_id, pane) DO NOTHING").bind(id, key, o.owner, now),
    ]);
    const n = Number(u.meta?.changes || 0);
    d.dropCache();
    return c.json({ ok: true, revoked: n });
  });
  app.post("/api/me/devices/:id/windows/enable", async c => {
    const id = c.req.param("id"), o = await ownDevice(c, d, id); if (o instanceof Response) return o;
    if (o.revoked) return c.json({ error: "끊긴 기기예요 — 기기를 다시 연결하세요" }, 409);
    const b = await c.req.json<{ key?: unknown }>().catch(() => ({} as { key?: unknown }));
    const key = String(b.key ?? ""); if (!KEY.test(key)) return c.json({ error: "창 키" }, 400);
    const BLOCK = "EXISTS (SELECT 1 FROM window_block WHERE device_id = ? AND pane = ?)";
    const [, u] = await db(c).batch([
      auditStmt(db(c), { owner: o.owner, act: "enable_window", device: id, pane: key, by: o.me, at: Date.now(), when: BLOCK, whenArgs: [id, key] }),   // 실제로 풀 때만(지우기 전에 확인)
      db(c).prepare("DELETE FROM window_block WHERE device_id = ? AND pane = ?").bind(id, key),
    ]);
    if (!u.meta?.changes) return c.json({ error: "끊긴 창이 아니에요" }, 404);
    return c.json({ ok: true });
  });
}
