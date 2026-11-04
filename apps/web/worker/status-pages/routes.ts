// 설정 › 기능: 상태 페이지 켜기/끄기(태스크 현황 · 기기 세션 현황) — 로그인한 사람 자기 값만 읽고 씀. 주인 · 회원 같음
import type { Context, Hono } from "hono";
import { featsOf, isFeat, setFeat } from "./feature";
import { readCapped } from "../devices";

export type SEnv = { DB: D1Database; FLAGS_OFF?: string };
export type SC = Context<{ Bindings: SEnv }>;
export type Who = (c: SC) => Promise<string | null>;
export const sameSite = (c: SC) => c.req.header("x-hb") === "1" && ["same-origin", "none", undefined].includes(c.req.header("sec-fetch-site"));
/** 몸을 n 바이트까지만 읽어 JSON 으로(content-length 를 믿지 않음) — 넘으면 undefined(413), 망가졌으면 null */
export async function jsonCapped(c: SC, n: number): Promise<unknown> {
  const buf = await readCapped(c.req.raw.body, n); if (!buf) return undefined;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}
export const SMALL_BODY = 4096;
export const offList = (c: SC) => String(c.env.FLAGS_OFF || "").split(",").map(x => x.trim()).filter(Boolean);

export function mountFeatures(host: Hono<any>, who: Who) {
  const app = host as unknown as Hono<{ Bindings: SEnv }>;
  app.get("/api/me/features", async c => {
    const me = await who(c); if (!me) return c.json({ ok: false, error: "로그인" }, 401);
    const f = await featsOf(c.env.DB, me, c.env.FLAGS_OFF);
    return c.json({ ok: true, ...f, off: offList(c).filter(isFeat) }, 200, { "cache-control": "no-store" });
  });
  // { k: "taskboard" | "devboard", on: boolean }
  app.post("/api/me/features", async c => {
    if (!sameSite(c)) return c.json({ ok: false, error: "forbidden" }, 403);
    const me = await who(c); if (!me) return c.json({ ok: false, error: "로그인" }, 401);
    const raw = await jsonCapped(c, SMALL_BODY); if (raw === undefined) return c.json({ ok: false, error: "너무 커요" }, 413);
    const b = raw as { k?: unknown; on?: unknown } | null;
    if (!b || !isFeat(b.k) || typeof b.on !== "boolean") return c.json({ ok: false, error: "모르는 값" }, 400);
    if (b.on && offList(c).includes(b.k)) return c.json({ ok: false, error: "이 서버에서 꺼 둔 기능이에요" }, 409);
    await setFeat(c.env.DB, me, b.k, b.on);
    return c.json({ ok: true, ...(await featsOf(c.env.DB, me, c.env.FLAGS_OFF)) });
  });
}
