import type { Context, Hono } from "hono";
import { z } from "zod";
import { engineOf, rolePrompt, ownerCfg, type EngEnv } from "./engine";
import { redact } from "./session/redact";
import { allowed as settingsAllowed, logChange, NOT_ALLOWED_HINT } from "./device-settings";

const text = (max: number, multiline = false, empty = false) => z.string().trim().min(empty ? 0 : 1).max(max)
  .refine(v => !(multiline ? /[\x00-\x09\x0b-\x1f\x7f-\x9f]/ : /[\x00-\x1f\x7f-\x9f]/).test(v), "제어 문자는 못 씀")
  .refine(v => !v.startsWith("-"), "「-」로 시작할 수 없음");
export const roleEditSchema = z.object({
  role_id: z.string().regex(/^[\w-]{1,80}$/),
  name: text(40).optional(), brief: text(200, false, true).optional(), instructions: text(3000, true).optional(),
}).strict().refine(v => v.name !== undefined || v.brief !== undefined || v.instructions !== undefined, "고칠 칸이 없어요");

export class RoleEditDenied extends Error {
  status = 403 as const; hint = NOT_ALLOWED_HINT;
  constructor() { super(`not_allowed — ${NOT_ALLOWED_HINT}`); }
}
/** /api/agent/:tool 의 도구 오류 답: 허락 없음은 403 { error: "not_allowed", hint }, 나머지는 예전대로 400 */
export const toolError = (e: unknown): [Record<string, string>, 400 | 403] =>
  e instanceof RoleEditDenied ? [{ error: "not_allowed", hint: e.hint }, 403] : [{ error: e instanceof Error ? e.message : String(e) }, 400];

// 창이 마지막으로 지시 전문을 받은 시각(engine_window.handle 의 role_at — 칸을 새로 만들지 않음). engine.ts reopen 이 이 값보다 역할이 새로울 때만 지시를 붙임
const markRoleAt = (db: D1Database, owner: string, id: string, at: number | null) => db.prepare(at === null
  ? "UPDATE engine_window SET handle = json_remove(handle, '$.role_at') WHERE owner = ? AND id = ? AND json_valid(handle)"
  : "UPDATE engine_window SET handle = json_set(CASE WHEN json_valid(handle) THEN handle ELSE '{}' END, '$.role_at', ?3) WHERE owner = ?1 AND id = ?2").bind(...(at === null ? [owner, id] : [owner, id, at])).run();

type Edited = { ok: true; role_id: string; delivery: { window: string; state: string }[]; before: { name: string; brief: string; instructions: string }; after: { name: string; brief: string; instructions: string } };
async function edit(env: EngEnv, owner: string, input: unknown): Promise<Edited | { error: string; status: 400 | 404 }> {
  const parsed = roleEditSchema.safeParse(input);
  if (!parsed.success) return { error: "역할 입력이 맞지 않아요(이름 40자 · 설명 200자 · 지시 3000자)", status: 400 as const };
  const a = parsed.data, db = env.DB;
  const old = await db.prepare("SELECT name, intake, instructions FROM role WHERE owner = ? AND id = ?").bind(owner, a.role_id).first<{ name: string; intake: string; instructions: string }>();
  if (!old) return { error: "없는 역할이에요", status: 404 as const };
  const name = redact(a.name ?? old.name), brief = redact(a.brief ?? old.intake), instructions = redact(a.instructions ?? old.instructions), now = Date.now();
  await db.batch([
    db.prepare("UPDATE role SET name = ?, intake = ?, instructions = ?, updated_at = ? WHERE owner = ? AND id = ?").bind(name, brief, instructions, now, owner, a.role_id),
    db.prepare("UPDATE engine_window SET name = ? WHERE owner = ? AND role_id = ?").bind(name, owner, a.role_id),
  ]);
  // 대화 대기(waiting) 창도 받음 — 입력칸에 바로 넣으면 떠 있는 물음의 답이 될 수 있어 엔진 줄에만 세움(쉴 때 넣음)
  const windows = (await db.prepare("SELECT w.id, w.device_id, w.state, CASE WHEN json_valid(w.handle) THEN json_extract(w.handle, '$.role_at') END role_at FROM engine_window w JOIN device d ON d.id = w.device_id AND d.owner = w.owner AND d.revoked_at IS NULL WHERE w.owner = ? AND w.role_id = ? AND w.state IN ('idle','background','busy','waiting')").bind(owner, a.role_id).all<{ id: string; device_id: string; state: string; role_at: number | null }>()).results;
  const { rules } = await ownerCfg(db, owner);
  const message = `[Boarder] 이 역할의 지시가 바뀌었어요: ${name}\n${brief}\n\n${rolePrompt(name, instructions, rules.one_goal !== false)}`;
  const delivery = [];
  for (const w of windows) {
    await markRoleAt(db, owner, w.id, now);
    try {
      const eng = engineOf(env, w.device_id);
      const r = w.state === "waiting" ? await eng.pend({ id: w.id, text: message, at: Date.now() }) : await eng.deliver(w.id, message);
      delivery.push({ window: w.id, state: r.queued ? "queued" : "sent" });
    } catch {   // 저장은 끝남. 넣지 못한 창을 숨기지 않고 돌려줌 — 받은 시각을 되돌려 다음 reopen 이 최신 지시를 붙이게
      await markRoleAt(db, owner, w.id, w.role_at ?? null).catch(() => null);
      delivery.push({ window: w.id, state: "failed" });
    }
  }
  return { ok: true, role_id: a.role_id, delivery, before: { name: old.name, brief: old.intake, instructions: old.instructions }, after: { name, brief, instructions } };
}
const out = (r: Awaited<ReturnType<typeof edit>>) => "error" in r ? r : { ok: r.ok, role_id: r.role_id, delivery: r.delivery };

export async function editRole(env: EngEnv, owner: string, input: unknown) { return out(await edit(env, owner, input)); }

export async function editRoleFromDevice(env: EngEnv, owner: string, device: string | null | undefined, input: unknown) {
  const me = owner.toLowerCase();
  const dev = device ? await env.DB.prepare("SELECT id, name FROM device WHERE id = ? AND lower(owner) = ? AND revoked_at IS NULL").bind(device, me).first<{ id: string; name: string }>() : null;
  if (!dev || !(await settingsAllowed(env.DB, me, dev.id))) throw new RoleEditDenied();
  const r = await edit(env, owner, input);
  if (!("error" in r)) {
    const cut = (v: string, n: number) => { const t = redact(v).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t || "없음"; };
    const view = (x: Edited["before"]) => `이름 ${cut(x.name, 40)} · 설명 ${cut(x.brief, 60)} · 지시 ${cut(x.instructions, 160)}`;
    await logChange(env.DB, me, dev.name, `역할 「${cut(r.before.name, 40)}」`, view(r.before), view(r.after));
  }
  return out(r);
}

// 설정 › 노드 「역할」 칸이 읽는 목록: 그 사람 역할만(최근 고친 50), 붙은 창은 닫힘 · 사라짐을 뺀 것.
export type RoleRow = { id: string; name: string; brief: string; instructions: string; source: string; updated_at: number; windows: { id: string; name: string; state: string }[] };
export async function listRoles(db: D1Database, owner: string): Promise<RoleRow[]> {
  const roles = (await db.prepare("SELECT id, name, intake AS brief, instructions, source, updated_at FROM role WHERE owner = ? ORDER BY updated_at DESC, id LIMIT 50")
    .bind(owner).all<Omit<RoleRow, "windows">>()).results;
  if (!roles.length) return [];
  const wins = (await db.prepare(`SELECT id, role_id, name, state FROM engine_window WHERE owner = ? AND role_id IN (${roles.map(() => "?").join(",")}) AND state NOT IN ('closed','gone') ORDER BY created_at, id`)
    .bind(owner, ...roles.map(r => r.id)).all<{ id: string; role_id: string; name: string; state: string }>()).results;
  return roles.map(r => ({ ...r, windows: wins.filter(w => w.role_id === r.id).map(({ id, name, state }) => ({ id, name, state })) }));
}

export function mountRoleEdit(app: Hono<any>, member: (c: Context<any>) => Promise<string | null>) {
  app.get("/api/me/roles", async c => {
    const me = await member(c); if (!me) return c.json({ error: "no" }, 403);
    return c.json({ ok: true, roles: await listRoles(c.env.DB, me) });
  });
  app.post("/api/me/roles/:id", async c => {
    const me = await member(c); if (!me) return c.json({ error: "no" }, 403);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "역할 입력이 맞지 않아요" }, 400);
    const r = await editRole(c.env, me, { ...body, role_id: c.req.param("id") });
    return "error" in r ? c.json({ ok: false, error: r.error }, r.status) : c.json(r);
  });
}
