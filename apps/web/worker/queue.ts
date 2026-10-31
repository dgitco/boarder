import type { Context, Next } from "hono";
import { isOwner, type Env as AuthEnv } from "./auth";
import type { BoardSnap } from "./board";
import { f7On } from "./ledger";

type QEnv = AuthEnv & { SNAP: DurableObjectNamespace<BoardSnap>; FAULT_OK?: string };
type C = Context<{ Bindings: QEnv }>;
export const QPATHS = new Set(["/api/chat", "/api/answer", "/api/todo", "/api/cardcheck", "/api/artnote", "/api/artfolder"]);
const RID = /^[\w-]{6,64}$/;

// 시험 장애 흉내(로컬만): FAULT_OK=1(.dev.vars) 일 때만 /api/admin/fault 가 켬 — 운영 설정엔 이 값이 없어 늘 꺼짐
export const FAULT = { do: false, d1: false, d1after: false };   // d1after = batch 는 들어가고 응답만 잃음
const ridOf = (env: QEnv, email: string) => {
  if (FAULT.do) throw new Error("DO 장애(시험)");
  return env.SNAP.get(env.SNAP.idFromName(`rid:${isOwner(env, email) ? "owner" : email.trim().toLowerCase()}@apac`), { locationHint: "apac" });
};
export const brokenDB = (db: D1Database) => new Proxy(db, { get: () => () => { throw new Error("D1 장애(시험)"); } }) as D1Database;
export const lostDB = (db: D1Database) => new Proxy(db, { get: (t, k) => k === "batch" ? async (s: D1PreparedStatement[]) => { await t.batch(s); throw new Error("D1 응답 잃음(시험)"); } : (v => typeof v === "function" ? v.bind(t) : v)(Reflect.get(t, k)) }) as D1Database;

export const ridOfBody = (b: unknown) => { const r = String((b as { rid?: unknown } | null)?.rid ?? ""); return RID.test(r) ? r : ""; };
export const ridRow = (db: D1Database, rid: string) => db.prepare("INSERT INTO f7_rid(rid, at) VALUES (?, ?)").bind(rid, Date.now());
export const ridDup = (e: unknown) => /UNIQUE constraint failed: f7_rid/i.test(String((e as Error)?.message || e));
export const ridSeen = async (db: D1Database, rid: string) => !!(await db.prepare("SELECT 1 FROM f7_rid WHERE rid = ?").bind(rid).first());
/** rid 와 함께 batch 하나로 — 이미 쓴 rid 면 false(쓰지 않음), 새로 썼으면 true. 그 밖 D1 오류는 던짐 */
export async function ridBatch(db: D1Database, rid: string, st: D1PreparedStatement[], wait?: (p: Promise<unknown>) => void) {
  if (!rid) { await db.batch(st); return true; }
  try { await db.batch([ridRow(db, rid), ...st]); }
  catch (e) { if (ridDup(e)) return false; throw e; }
  if (wait && Math.random() < 0.02) wait(db.prepare("DELETE FROM f7_rid WHERE at < ?").bind(Date.now() - 2 * 86_400_000).run().catch(() => {}));
  return true;
}
export const retrySafe = (c: Context) => c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, { "x-retry-safe": "1" });

// 답에 표(x-rid): new = 이번에 처리 · replay = 남긴 답 · busy = 하는 중 · nostore = rid 칸 못 부름(안 씀). 표가 없는 5xx 는 Worker 밖(입구 장애) — 화면이 「확인 필요」로 다시
function mark(c: C, v: string) {
  try { c.res.headers.set("x-rid", v); }
  catch { const r = c.res; c.res = new Response(r.body, { status: r.status, statusText: r.statusText, headers: new Headers(r.headers), ...((r as { encodeBody?: "manual" }).encodeBody ? { encodeBody: "manual" as const } : {}) }); c.res.headers.set("x-rid", v); }
}
/** 쓰기 POST 미들웨어 — 스위치 · 로그인은 부른 쪽이 먼저(email). seg = Server-Timing 「claim」 칸 */
export async function idem(c: C, email: string, next: Next, seg: (ms: number) => void) {
  let rid = ""; try { rid = String((JSON.parse(await c.req.text()) as { rid?: unknown }).rid ?? ""); } catch {}
  if (!RID.test(rid)) return next();   // rid 없는 쓰기는 예전처럼(화면은 늘 붙여 보냄)
  let st: ReturnType<typeof ridOf>, got: Awaited<ReturnType<BoardSnap["claim"]>>;
  const t0 = Date.now();
  try { st = ridOf(c.env, email); got = await st.claim(rid, c.req.path); }
  catch (e) {
    seg(Date.now() - t0);
    // 배포 직후 옛 코드 DO(새 메서드 없음 — 「does not implement」): 이 층 없이 그대로(예전과 같음) · 관리 길 /api/admin/rid/drop 으로 내리면 새 코드로
    if (/does not implement|not implemented|is not a function/i.test(String((e as Error)?.message || e))) return next();
    return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, { "x-retry-safe": "1", "x-rid": "nostore" });   // 쓰기 전 — 다시 보내도 됨
  }
  seg(Date.now() - t0);
  if (got.state === "done") {   // 남긴 답 그대로(바이트 · 눌림 · 종류 · 오류도) — 다시 처리 안 함
    const h: Record<string, string> = { "content-type": got.ct || "application/json", "cache-control": "no-store", "x-rid": "replay" }; if (got.ce) h["content-encoding"] = got.ce;
    return new Response(got.body ? Uint8Array.from(atob(got.body), x => x.charCodeAt(0)) : null, { status: got.status, headers: h, ...(got.ce ? { encodeBody: "manual" as const } : {}) });
  }
  if (got.state === "busy") return c.json({ ok: false, error: "일시적인 오류가 발생했어요", code: "busy" }, 409, { "x-rid": "busy" });
  try { await next(); }
  catch (e) { c.executionCtx.waitUntil(st.done(rid, 500, "", "", "").catch(() => {})); throw e; }   // 됐는지 모름 — 끝남(500)으로 남김, 다시 처리 안 함
  const r = c.res;
  if (r.status === 503 && r.headers.get("x-retry-safe") === "1") { c.executionCtx.waitUntil(st.release(rid).catch(() => {})); mark(c, "new"); return; }
  // 남기는 답은 64KB 까지(보드 쓰기 답은 몇백 바이트, server.py 는 4KB 넘으면 gzip — 바이트 그대로 base64) — 넘으면 상태만(다시 보낸 쪽은 몸통 없는 같은 상태)
  const u = new Uint8Array(await r.clone().arrayBuffer().catch(() => new ArrayBuffer(0)));
  let b64 = ""; if (u.length <= 65536) for (let i = 0; i < u.length; i += 0x8000) b64 += String.fromCharCode(...u.subarray(i, i + 0x8000));
  c.executionCtx.waitUntil(st.done(rid, r.status, b64 ? btoa(b64) : "", r.headers.get("content-type") || "", u.length <= 65536 ? r.headers.get("content-encoding") || "" : "").catch(() => {}));
  mark(c, "new");
}

/** 관리: 그 사람 rid 칸 DO 를 내림(배포 뒤 옛 코드로 남은 칸 · 시험) — 남긴 rid 표는 그대로 */
export const dropRid = (env: QEnv, email: string) => ridOf(env, email).drop(true);

export async function answerOf(env: QEnv, email: string, rid: string): Promise<{ state: string } | null> {
  if (!RID.test(rid)) return null;
  const a = await ridOf(env, email).look(rid, true) as { state: string; status: number } | string;
  const o = typeof a === "string" ? { state: a, status: 200 } : a;   // 배포 직후 옛 코드 DO — 「됨」만 앎(예전과 같게 ok)
  if (o.state === "busy") return { state: "queued" };
  if (o.state === "done" && o.status && o.status < 400) return { state: "ok" };
  if (o.state === "done" && o.status >= 400 && o.status < 500) return { state: "fail" };
  return (await ridSeen(env.DB, rid)) ? { state: "ok" } : null;   // D1 오류는 던짐 → 부른 쪽 503(모름 — 같은 rid)
}

/** GET /api/rid/:rid — 「확인 필요」 글이 서버에 이미 들어갔나(done · busy · none). 스위치가 꺼져 있으면 404(화면은 「모름」 — 다시 안 보내고 오류로) */
export async function look(c: C, email: string) {
  if (!(await f7On(c.env.DB, "write_queue"))) return c.json({ error: "꺼짐" }, 404);
  const rid = c.req.param("rid") || ""; if (!RID.test(rid)) return c.json({ error: "rid" }, 400);
  try { return c.json({ state: await ridOf(c.env, email).look(rid) }, 200, { "cache-control": "no-store" }); }
  catch { return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, { "x-retry-safe": "1" }); }
}
