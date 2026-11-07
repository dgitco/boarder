import type { Env as AuthEnv } from "./auth";
import type { BoardSnap } from "./board";
import { canon, isAdmin } from "./who";

type LEnv = AuthEnv & { SNAP: DurableObjectNamespace<BoardSnap> };
export const OWNER_SNAP = "owner@apac";

/** 그 사용자의 화면 칸: 회원 = live:<메일>, 주인 메일(ALLOW_EMAILS) 넷 = live:<canon> 하나(주인 · 회원 한 길) */
export const liveOf = (env: LEnv, email: string) => {
  const name = `live:${(isAdmin(env, email) ? canon(env) : email).trim().toLowerCase()}@apac`;
  return env.SNAP.get(env.SNAP.idFromName(name), { locationHint: "apac" });
};
/** 바뀐 칸 알리기(실패는 삼킴 — 화면은 폴링 · 다시 붙기로 따라잡음). gap = 그 칸의 묶음 */
export const bump = (env: LEnv, email: string, t: Record<string, string>, gap?: number) => liveOf(env, email).bump(t, undefined, gap).catch(() => 0);
const SNAP_MIRROR: Record<string, string> = { topics: "topics", history: "history", cfg: "drafts" };
export const mirrorOwnerSnap = async (env: LEnv, key: string, etag: string) => {
  const k = SNAP_MIRROR[key]; if (!k) return 0;
  return liveOf(env, canon(env)).bump({ [k]: etag }).catch(() => 0);
};
export const bumpLedger = (env: LEnv) => { const v = "~" + Date.now(); return liveOf(env, canon(env)).bump({ chat: v, data: v }, undefined, MEMBER_BUMP_GAP).catch(() => 0); };
export const bumpOwnerVals = (env: LEnv) => liveOf(env, canon(env)).bump({ data: "~" + Date.now() }, undefined, MEMBER_BUMP_GAP).catch(() => 0);
const MEMBER_BUMP_GAP = 5000;
export const bumpMember = (env: LEnv, email: string) => { const v = "~" + Date.now(); return bump(env, email, { data: v, chat: v }, MEMBER_BUMP_GAP); };

export async function table(_env: LEnv, _email: string, memberTags: () => Promise<{ data: string; chat: string }>): Promise<{ t: Record<string, string>; age?: number | null }> {
  return { t: await memberTags() };
}
