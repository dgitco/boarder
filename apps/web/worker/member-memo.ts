import * as live from "./live";
import { loadForget } from "./member-board";

type Ctx = { req: { header(k: string): string | undefined }; env: Parameters<typeof live.liveOf>[0]; executionCtx: { waitUntil(p: Promise<unknown>): void } };
export const MEMO_PATHS = new Set(["/api/data", "/api/topics", "/api/inbox"]);

export async function memo(c: Ctx, me: string, key: string, make: (inm: string | undefined) => Promise<Response | null>): Promise<Response | null> {
  const inm = (c.req.header("if-none-match") || "").replace(/^W\//, "") || undefined;
  const st = live.liveOf(c.env, me) as unknown as { memoGet(k: string, min?: number): Promise<{ stamp: string; body?: string; etag?: string; ct?: string }>; memoPut(k: string, s: string, b: string, e: string, ct: string, t0?: number): Promise<boolean> };
  let g: { stamp: string; body?: string; etag?: string; ct?: string };
  const min = Math.max(0, Number(c.req.header("x-bx-min")) || 0);   // 화면이 받은 바뀜 시각(shell.js) — 그 뒤 판이면 같이 씀
  try { g = await st.memoGet(key, min); } catch { return make(inm); }
  const t0 = Date.now();
  const h = (etag: string, ct: string, how: string) => ({ "content-type": ct, etag, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-boarder-src": "member", "x-bx-memo": how });
  if (g.body !== undefined && g.etag) return inm === g.etag ? new Response(null, { status: 304, headers: h(g.etag, g.ct || "application/json; charset=utf-8", "hit") }) : new Response(g.body, { headers: h(g.etag, g.ct || "application/json; charset=utf-8", "hit") });
  loadForget(me);
  const r = await make(undefined);   // 맡길 몸통이 있어야 해서 조건 없이 계산(304 는 아래에서)
  if (!r || r.status !== 200) return r;
  const body = await r.text(), etag = r.headers.get("etag") || "", ct = r.headers.get("content-type") || "application/json; charset=utf-8";
  if (etag) c.executionCtx.waitUntil(st.memoPut(key, g.stamp, body, etag, ct, t0).catch(() => false));
  if (etag && inm === etag) return new Response(null, { status: 304, headers: h(etag, ct, "miss") });
  const hh = new Headers(r.headers); hh.set("x-bx-memo", "miss");
  return new Response(body, { status: 200, headers: hh });
}
