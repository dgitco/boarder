import type { Context, Hono } from "hono";
import { z } from "zod";
import { engineOf, rolePrompt, ownerCfg, openRole, openedLastHour, pendingRoles, sameGoalWindow, OPEN_PER_HOUR, liveDevice, permsText, rid, sysLine, MODEL, type EngEnv } from "./engine";
export { sameGoalWindow };   // 메인 봇 초안(local.ts role_draft)이 이 이름으로 부름
import { redact } from "./session/redact";
import { allowed as settingsAllowed, logChange, NOT_ALLOWED_HINT } from "./device-settings";
import { paneNow, inPrim, OWN, KIND_KO, cut, NOT_CHAT } from "./member-board";
import { deviceFeatures } from "./importer/device-engine";

// dash: 「-」 시작을 받음 — 권한 · 보고 라인은 목록 꼴(「- 읽기만」)이 흔함. 이름 · 지시 · 목표는 예전처럼 거절(CLI 인자로 넘어감)
const text = (max: number, multiline = false, empty = false, dash = false) => z.string().trim().min(empty ? 0 : 1).max(max)
  .refine(v => !(multiline ? /[\x00-\x09\x0b-\x1f\x7f-\x9f]/ : /[\x00-\x1f\x7f-\x9f]/).test(v), "제어 문자는 못 씀")
  .refine(v => dash || !v.startsWith("-"), "「-」로 시작할 수 없음");
export const roleEditSchema = z.object({
  role_id: z.string().regex(/^[\w-]{1,80}$/),
  name: text(40).optional(), brief: text(200, false, true).optional(), instructions: text(3000, true).optional(),
  perms: text(1000, true, true, true).optional(), supervise: text(1000, true, true, true).optional(),
}).strict().refine(v => v.name !== undefined || v.brief !== undefined || v.instructions !== undefined || v.perms !== undefined || v.supervise !== undefined, "고칠 칸이 없어요");
/** 설정 「새 역할」 입력: 고치기와 같은 칸 · 같은 검사(이름 · 지시는 꼭) */
export const roleCreateSchema = z.object({
  name: text(40), brief: text(200, false, true).optional(), instructions: text(3000, true),
  perms: text(1000, true, true, true).optional(), supervise: text(1000, true, true, true).optional(),
}).strict();
const BAD_INPUT = "역할 입력이 맞지 않아요(이름 40자 · 목표 200자 · 지시 3000자 · 권한 · 보고 라인 1000자, 이름 · 목표 · 지시는 -로 시작 못 함)";

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

type Fields = { name: string; brief: string; instructions: string; perms: string; supervise: string };
type Edited = { ok: true; role_id: string; delivery: { window: string; state: string }[]; before: Fields; after: Fields };
async function edit(env: EngEnv, owner: string, input: unknown): Promise<Edited | { error: string; status: 400 | 404 }> {
  const parsed = roleEditSchema.safeParse(input);
  if (!parsed.success) return { error: BAD_INPUT, status: 400 as const };
  const a = parsed.data, db = env.DB;
  const old = await db.prepare("SELECT name, intake, instructions, perms, supervise FROM role WHERE owner = ? AND id = ?").bind(owner, a.role_id).first<{ name: string; intake: string; instructions: string; perms: string; supervise: string }>();
  if (!old) return { error: "없는 역할이에요", status: 404 as const };
  // 권한을 안 고치면 저장 값 그대로(들여온 도구 목록 꼴도) — 고치면 사람이 쓴 글로
  const name = redact(a.name ?? old.name), brief = redact(a.brief ?? old.intake), instructions = redact(a.instructions ?? old.instructions), now = Date.now();
  const perms = a.perms === undefined ? old.perms : redact(a.perms), supervise = a.supervise === undefined ? old.supervise : redact(a.supervise);
  await db.batch([
    db.prepare("UPDATE role SET name = ?, intake = ?, instructions = ?, perms = ?, supervise = ?, updated_at = ? WHERE owner = ? AND id = ?").bind(name, brief, instructions, perms, supervise, now, owner, a.role_id),
    db.prepare("UPDATE engine_window SET name = ? WHERE owner = ? AND role_id = ?").bind(name, owner, a.role_id),
  ]);
  // 대화 대기(waiting) 창도 받음 — 입력칸에 바로 넣으면 떠 있는 물음의 답이 될 수 있어 엔진 줄에만 세움(쉴 때 넣음)
  const windows = (await db.prepare("SELECT w.id, w.device_id, w.state, CASE WHEN json_valid(w.handle) THEN json_extract(w.handle, '$.role_at') END role_at FROM engine_window w JOIN device d ON d.id = w.device_id AND d.owner = w.owner AND d.revoked_at IS NULL WHERE w.owner = ? AND w.role_id = ? AND w.state IN ('idle','background','busy','waiting')").bind(owner, a.role_id).all<{ id: string; device_id: string; state: string; role_at: number | null }>()).results;
  const { rules } = await ownerCfg(db, owner);
  const message = `[Boarder] 이 역할의 지시가 바뀌었어요: ${name}\n${brief}\n\n${rolePrompt(name, instructions, rules.one_goal !== false, { perms, supervise })}`;
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
  return { ok: true, role_id: a.role_id, delivery, before: { name: old.name, brief: old.intake, instructions: old.instructions, perms: old.perms, supervise: old.supervise }, after: { name, brief, instructions, perms, supervise } };
}
const out = (r: Awaited<ReturnType<typeof edit>>) => "error" in r ? r : { ok: r.ok, role_id: r.role_id, delivery: r.delivery };

export async function editRole(env: EngEnv, owner: string, input: unknown) { return out(await edit(env, owner, input)); }

export async function editRoleFromDevice(env: EngEnv, owner: string, device: string | null | undefined, input: unknown) {
  const me = owner.toLowerCase();
  const dev = device ? await env.DB.prepare("SELECT id, name FROM device WHERE id = ? AND lower(owner) = ? AND revoked_at IS NULL").bind(device, me).first<{ id: string; name: string }>() : null;
  if (!dev || !(await settingsAllowed(env.DB, me, dev.id))) throw new RoleEditDenied();
  const r = await edit(env, owner, input);
  if (!("error" in r)) {
    const cut = (v: string, n: number) => { const t = redact(v).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t || "없음"; };   // 보드 기록 한 줄(member-board cut 과 다름 — 빈 값은 「없음」)
    const more = !!(r.before.perms || r.before.supervise || r.after.perms || r.after.supervise);   // 권한 · 보고 라인을 안 쓰는 역할은 예전 줄 그대로
    const view = (x: Fields) => `이름 ${cut(x.name, 40)} · 설명 ${cut(x.brief, 60)} · 지시 ${cut(x.instructions, 160)}` + (more ? ` · 권한 ${cut(permsText(x.perms), 80)} · 보고 라인 ${cut(x.supervise, 80)}` : "");
    await logChange(env.DB, me, dev.name, `역할 「${cut(r.before.name, 40)}」`, view(r.before), view(r.after));
  }
  return out(r);
}

// 설정 › 노드 「역할」 칸이 읽는 목록: 그 사람 역할만(최근 고친 50), 붙은 창은 닫힘 · 사라짐을 뺀 것.
//   perms = 사람이 읽을 글(permsText — 들여온 도구 목록 꼴도), pending = 엔진이 꺼진 동안 만든 역할(엔진이 붙으면 창이 열림)
//   창마다 「지금 하는 일」: 보드 판(member-board data)의 last · watch 와 같은 줄(paneNow) — last = { kind(한국어), text(한 줄 120자), at }, watch = 상태 한 줄(120자)
export type RoleWin = { id: string; name: string; state: string; last: { kind: string; text: string; at: number } | null; watch: string };
export type RoleRow = { id: string; name: string; brief: string; instructions: string; perms: string; supervise: string; source: string; updated_at: number; pending: boolean; windows: RoleWin[] };
const oneLine = (v: unknown, n: number) => cut(String(v ?? "").replace(/\s+/g, " ").trim(), n);
export async function listRoles(db: D1Database, owner: string): Promise<RoleRow[]> {
  const roles = (await db.prepare("SELECT id, name, intake AS brief, instructions, perms, supervise, source, updated_at, CASE WHEN json_valid(engine) THEN json_extract(engine, '$.pending') END AS pending FROM role WHERE owner = ? ORDER BY updated_at DESC, id LIMIT 50")
    .bind(owner).all<Omit<RoleRow, "windows" | "pending"> & { pending: number | null }>()).results;
  if (!roles.length) return [];
  const wins = (await db.prepare(`SELECT id, role_id, name, state FROM engine_window WHERE owner = ? AND role_id IN (${roles.map(() => "?").join(",")}) AND state NOT IN ('closed','gone') ORDER BY created_at, id`)
    .bind(owner, ...roles.map(r => r.id)).all<{ id: string; role_id: string; name: string; state: string }>()).results;
  const names = [...new Set(wins.map(w => w.name))];
  const logs = names.length ? (await db.prepare(`SELECT win, kind, text, thread, at FROM (SELECT win, kind, text, thread, at, row_number() OVER (PARTITION BY win ORDER BY at DESC, id DESC) n FROM board_log WHERE owner = ? AND win IN (SELECT value FROM json_each(?)) AND kind != 'me' AND coalesce(thread, '') != 'primary' AND coalesce(thread, '') NOT GLOB 'p:[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9].[0-9][0-9][0-9][0-9][0-9][0-9]' ${NOT_CHAT}) WHERE n <= 30 ORDER BY at DESC`)
    .bind(owner, JSON.stringify(names)).all<{ win: string; kind: string; text: string; thread: string | null; at: number }>()).results.filter(r => !inPrim(r) && !OWN.test(r.win)) : [];
  const nowMin = Math.floor(Date.now() / 60_000) * 60_000;
  const now = (name: string) => {
    const p = paneNow(logs.filter(r => r.win === name), nowMin);
    return { last: p.last ? { kind: KIND_KO[p.last.kind] || p.last.kind, text: oneLine(p.last.text, 120), at: Number(p.last.at) } : null, watch: p.watch ? oneLine(p.watch.text, 120) : "" };
  };
  return roles.map(r => ({ ...r, perms: permsText(r.perms), supervise: r.supervise || "", pending: r.pending === 1,
    windows: wins.filter(w => w.role_id === r.id).map(({ id, name, state }) => ({ id, name, state, ...now(name) })) }));
}
export async function usesEngine(db: D1Database, owner: string) {
  const ds = (await db.prepare("SELECT features, engine, engine_at FROM device WHERE owner = ? AND revoked_at IS NULL").bind(owner).all<{ features: string | null; engine: string | null; engine_at: number | null }>()).results;
  const ran = (d: { engine: string | null; engine_at: number | null }) => { if (!d.engine_at || !d.engine) return false; try { const e = JSON.parse(d.engine); return !!e && typeof e === "object" && !e.harness; } catch { return false; } };
  return ds.some(d => !!deviceFeatures(d.features, d.engine, d.engine_at)?.engine || ran(d));
}

export async function createRole(env: EngEnv, owner: string, input: unknown): Promise<{ ok: true; role_id: string; window: string | null; pending: boolean } | { error: string; status: 400 | 409 | 429 }> {
  const parsed = roleCreateSchema.safeParse(input);
  if (!parsed.success) return { error: BAD_INPUT, status: 400 };
  const a = parsed.data, db = env.DB;
  const r = { name: redact(a.name), brief: redact(a.brief ?? ""), instructions: redact(a.instructions), perms: redact(a.perms ?? ""), supervise: redact(a.supervise ?? "") };
  const same = await sameGoalWindow(db, owner, r.name);
  if (same) return { error: same.pending ? `같은 이름의 역할이 엔진을 기다리고 있어요(${same.name}) — 한 역할은 한 목표예요` : `같은 이름의 역할 창이 이미 있어요(${same.name}) — 한 역할은 한 목표예요. 그 창에 맡겨 주세요`, status: 409 };
  if (await openedLastHour(db, owner) + await pendingRoles(db, owner) >= OPEN_PER_HOUR) return { error: `한 시간에 ${OPEN_PER_HOUR}창까지예요`, status: 429 };
  const dev = await liveDevice(db, owner), now = Date.now(), roleId = rid("r_"), cwd = `~/boarder/${roleId}`;
  await db.prepare("INSERT INTO role(owner, id, name, instructions, intake, perms, supervise, engine, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(owner, roleId, r.name, r.instructions, r.brief, r.perms, r.supervise, JSON.stringify(dev ? { device: dev, engine: "tmux", model: MODEL, cwd } : { engine: "tmux", model: MODEL, cwd, pending: 1 }), "user", now, now).run();
  if (!dev) {
    await sysLine(db, owner, `「${r.name}」 역할을 만들었어요 — 기기에서 엔진을 켜면 창이 열려요`).catch(() => null);
    return { ok: true, role_id: roleId, window: null, pending: true };
  }
  try { const w = await openRole(env, owner, dev, roleId, { ...r, cwd }, "created"); return { ok: true, role_id: roleId, window: w.id, pending: false }; }
  catch (e) {   // 초안 길과 같이 못 열면 역할 줄을 되돌림 — 화면은 쓴 글을 그대로 두고 한 줄 오류
    await db.prepare("DELETE FROM role WHERE owner = ? AND id = ?").bind(owner, roleId).run().catch(() => null);
    return { error: e instanceof Error && /^[가-힣]/.test(e.message) ? e.message : "일시적인 오류가 발생했어요", status: 400 };
  }
}
export function mountRoleEdit(app: Hono<any>, member: (c: Context<any>) => Promise<string | null>) {
  app.get("/api/me/roles", async c => {
    const me = await member(c); if (!me) return c.json({ error: "no" }, 403);
    const [roles, engine] = await Promise.all([listRoles(c.env.DB, me), usesEngine(c.env.DB, me)]);
    return c.json({ ok: true, roles, engine });
  });
  // 새 역할(회원만 · 같은 사이트 — member 가 index.ts memberOnly)
  app.post("/api/me/roles", async c => {
    const me = await member(c); if (!me) return c.json({ error: "no" }, 403);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "역할 입력이 맞지 않아요" }, 400);
    const r = await createRole(c.env, me, body);
    return "error" in r ? c.json({ ok: false, error: r.error }, r.status) : c.json(r);
  });
  app.post("/api/me/roles/:id", async c => {
    const me = await member(c); if (!me) return c.json({ error: "no" }, 403);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "역할 입력이 맞지 않아요" }, 400);
    const r = await editRole(c.env, me, { ...body, role_id: c.req.param("id") });
    return "error" in r ? c.json({ ok: false, error: r.error }, r.status) : c.json(r);
  });
}
