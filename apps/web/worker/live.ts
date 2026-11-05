import { isOwner, type Env as AuthEnv } from "./auth";
import type { BoardSnap } from "./board";
import { f7All } from "./ledger";
import { canon, unifiedAnyIn } from "./who";

type LEnv = AuthEnv & { SNAP: DurableObjectNamespace<BoardSnap> };
export const OWNER_SNAP = "owner@apac";

/** 그 사용자의 화면 칸 — 주인 메일(ALLOW_EMAILS)은 다 주인 보드 하나. member = 회원 길 칸(스위치 owner_unified 로 회원 길에 든 주인은 live:<canon>) */
export const liveOf = (env: LEnv, email: string, member = false) => {
  const name = isOwner(env, email) && !member ? OWNER_SNAP : `live:${(isOwner(env, email) ? canon(env) : email).trim().toLowerCase()}@apac`;
  return env.SNAP.get(env.SNAP.idFromName(name), { locationHint: "apac" });
};
// 주인 메일 가운데 owner_unified 가 켜진 것이 있나(스위치 10초 캐시). 꺼짐이면 주인 알림은 예전 그대로 스냅숏 칸 하나
const unifiedAny = (env: LEnv) => (env as { DB?: D1Database }).DB ? f7All((env as { DB: D1Database }).DB).then(on => unifiedAnyIn(on, env), () => false) : Promise.resolve(false);
/** 바뀐 칸 알리기(실패는 삼킴 — 화면은 폴링 · 다시 붙기로 따라잡음). 주인 메일 + owner_unified 켜짐이면 회원 길 칸(live:<canon>)에도 — ugap = 그 칸의 묶음 */
export const bump = async (env: LEnv, email: string, t: Record<string, string>, gap?: number, ugap = gap) => {
  const own = liveOf(env, email).bump(t, undefined, gap).catch(() => 0);
  if (!isOwner(env, email) || !(await unifiedAny(env))) return own;
  const [n] = await Promise.all([own, liveOf(env, email, true).bump(t, undefined, ugap).catch(() => 0)]);
  return n;
};
const SNAP_MIRROR: Record<string, string> = { topics: "topics", history: "history", cfg: "drafts" };
export const mirrorOwnerSnap = async (env: LEnv, key: string, etag: string) => {
  const k = SNAP_MIRROR[key]; if (!k || !(await unifiedAny(env))) return 0;
  return liveOf(env, canon(env), true).bump({ [k]: etag }).catch(() => 0);
};
export const bumpLedger = async (env: LEnv) => {
  const e = canon(env), v = "~" + Date.now(), own = liveOf(env, e).bump({ chat: v }).catch(() => 0);
  if (!(await unifiedAny(env))) return own;
  const [n] = await Promise.all([own, liveOf(env, e, true).bump({ chat: v, data: v }, undefined, MEMBER_BUMP_GAP).catch(() => 0)]);
  return n;
};
const MEMBER_BUMP_GAP = 5000;
export const bumpMember = (env: LEnv, email: string) => { const v = "~" + Date.now(); return bump(env, email, { data: v, chat: v }, isOwner(env, email) ? undefined : MEMBER_BUMP_GAP, MEMBER_BUMP_GAP); };

export async function table(env: LEnv, email: string, memberTags: () => Promise<{ data: string; chat: string }>, member = false): Promise<{ t: Record<string, string>; age?: number | null }> {
  if (!isOwner(env, email) || member) return { t: await memberTags() };   // member = owner_unified 로 회원 길에 든 주인   // 회원 보드는 요청 때 D1 에서 만듦 — 나이 없음
  const [tg, seq] = await Promise.all([liveOf(env, email).tags(), env.DB.prepare("SELECT max(seq) n FROM wl_change").first<{ n: number | null }>()]);
  return { t: { ...tg.t, chat: "c" + (seq?.n ?? 0) }, age: tg.age };   // age = 주인 data 스냅숏 나이(서버 시계)
}
