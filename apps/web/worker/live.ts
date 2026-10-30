import { isOwner, type Env as AuthEnv } from "./auth";
import type { BoardSnap } from "./board";

type LEnv = AuthEnv & { SNAP: DurableObjectNamespace<BoardSnap> };

/** 그 사용자의 화면 칸 — 주인 메일(ALLOW_EMAILS)은 다 주인 보드 하나 */
export const liveOf = (env: LEnv, email: string) => {
  const name = isOwner(env, email) ? "owner@wnam" : `live:${email.trim().toLowerCase()}@wnam`;
  return env.SNAP.get(env.SNAP.idFromName(name), { locationHint: "wnam" });
};
/** 바뀐 칸 알리기(실패는 삼킴 — 화면은 폴링 · 다시 붙기로 따라잡음) */
export const bump = (env: LEnv, email: string, t: Record<string, string>) => liveOf(env, email).bump(t).catch(() => 0);
export const bumpLedger = (env: LEnv) => bump(env, env.ALLOW_EMAILS.split(",")[0].trim(), { chat: "~" + Date.now() });
export const bumpMember = (env: LEnv, email: string) => { const v = "~" + Date.now(); return bump(env, email, { data: v, chat: v }); };

export async function table(env: LEnv, email: string, memberTags: () => Promise<{ data: string; chat: string }>): Promise<{ t: Record<string, string>; age?: number | null }> {
  if (!isOwner(env, email)) return { t: await memberTags() };   // 회원 보드는 요청 때 D1 에서 만듦 — 나이 없음
  const [tg, seq] = await Promise.all([liveOf(env, email).tags(), env.DB.prepare("SELECT max(seq) n FROM wl_change").first<{ n: number | null }>()]);
  return { t: { ...tg.t, chat: "c" + (seq?.n ?? 0) }, age: tg.age };   // age = 주인 data 스냅숏 나이(서버 시계)
}
