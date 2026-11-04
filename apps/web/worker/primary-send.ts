import { chatToMain, deliverTo, LOST_LINE, PRIMARY_HINT, sysLine, toImported, type EngEnv } from "./engine";
import { queueToImported } from "./member-imported";
import { boardHead } from "./board-head";
import { readPrefs } from "./node-prefs";

const LIVE_DEV = "AND device_id IN (SELECT id FROM device WHERE owner = ? AND revoked_at IS NULL)";
export async function ownWindow(db: D1Database, me: string, target: string) {
  if (/^window:/.test(target)) return !!(await db.prepare(`SELECT 1 FROM imp_item WHERE owner = ? AND key = ? AND kind = 'window' AND gone_at IS NULL AND device_id != '' ${LIVE_DEV}`).bind(me, target, me).first());
  if (/^ew_[a-z0-9]{3,40}$/i.test(target)) return !!(await db.prepare(`SELECT 1 FROM engine_window WHERE owner = ? AND id = ? AND state NOT IN ('closed','failed','gone') ${LIVE_DEV}`).bind(me, target, me).first());
  return false;
}

export async function pickedEngineWindow(db: D1Database, me: string, key: string) {
  const id = key.split(":").pop() || ""; if (!/^ew_[a-z0-9]{3,40}$/i.test(id)) return null;
  const w = await db.prepare(`SELECT id, state, handle FROM engine_window WHERE owner = ? AND id = ? AND state NOT IN ('closed','failed') ${LIVE_DEV}`).bind(me, id, me).first<{ id: string; state: string; handle: string | null }>().catch(() => null);
  if (!w) return null;
  const canOpen = (() => { try { return !!JSON.parse(w.handle || "{}").session_id; } catch { return false; } })();
  return { id: w.id, closedOnDevice: w.state === "parked" || w.state === "gone", canOpen };
}

export type PrimaryTarget = { via: "win" | "item" | "ew"; key: string };
export async function primaryTarget(db: D1Database, me: string): Promise<PrimaryTarget | null> {
  const v = (await db.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = 'primary_win'").bind(me).first<{ v: string }>().catch(() => null))?.v || "";
  if (v && await ownWindow(db, me, v)) return { via: "win", key: v };
  const pick = (await readPrefs(db, me).catch(() => null))?.primary_item ?? "auto";
  if (!/^window:/.test(pick)) return null;
  if (await ownWindow(db, me, pick)) return { via: "item", key: pick };
  const ew = await pickedEngineWindow(db, me, pick);
  return ew && (!ew.closedOnDevice || ew.canOpen) ? { via: "ew", key: ew.id } : null;
}

/** 엔진 메인 봇 길(chatToMain)의 결과가 「아무 창에도 안 넣음」인가 — 창을 못 열었고(started false) 들여온 창에도 안 줄 섬. offline 은 따로 알림이 있음 */
export const notDelivered = (r: unknown) => r == null || (typeof r === "object" && (r as { started?: unknown }).started === false && !(r as { offline?: unknown }).offline);
export { LOST_LINE };

export async function primaryWinSend(env: EngEnv, me: string, text: string, head = boardHead({})) {
  const t = await primaryTarget(env.DB, me); if (!t) return null;
  const v = t.key, msg = `${head} [Boarder chat] ${text}`;   // 머리 줄 「[보드 · Primary( · 스레드 <ts>)]」 — 기본 창(팀장 창)도 답을 Primary 채팅으로(boarder chat · 스레드면 --thread)
  if (v.startsWith("ew_")) return deliverTo(env, me, v, t.via === "ew" ? `${msg}\n${PRIMARY_HINT}` : msg).catch(e => { if (/없는 창/.test(String((e as Error)?.message || e))) return null; throw e; });   // 확인 뒤 사이에 사라진 창도 메인 봇으로
  const w = await env.DB.prepare("SELECT key, device_id, engine, handle, title, state FROM imp_item WHERE owner = ? AND key = ?").bind(me, v).first<{ key: string; device_id: string; engine: string; handle: string | null; title: string; state: string }>();
  if (!w) return null;
  if (t.via === "win") return { cmd: await queueToImported(env.DB, me, w, msg) };
  const full = `${msg}\n${PRIMARY_HINT}`;
  const own = /-own$/.test(w.engine);
  const ew = own ? null : await pickedEngineWindow(env.DB, me, w.key);
  if (ew && (ew.closedOnDevice || w.state === "parked")) return deliverTo(env, me, ew.id, full);
  if (w.state === "parked" && !own) { await queueToImported(env.DB, me, w, full, undefined, true, true); return { queued: true, primary: w.key }; }
  return toImported(env, me, w, full, own ? undefined : { primary: true });   // primary = 소켓으로 넣다 실패하면 drainRun 이 다시 열거나 줄을 남김
}
export async function primarySend(env: EngEnv, me: string, text: string, head = boardHead({})) {
  const r = await primaryWinSend(env, me, text, head) ?? await chatToMain(env, me, text, head);
  if (notDelivered(r)) await sysLine(env.DB, me, LOST_LINE).catch(() => null);
  return r;
}
