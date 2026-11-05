import type { RoleSeat } from "./role-seat";

export type Seat = "chief" | "dept" | null;
export type RuleLine = { win: string; kind: string; text?: string | null; wid?: string | null };
export type Chief = { name: string; win: string; wid: string | null };

const QUIET = new Set(["status", "start", "progress", "done", "waiting", "session_start", "session_end"]);
// 기계 줄: 보더 자신(시스템 줄 「보더」 · 들여오기) · 기기 도구 줄(<기기>:boarder) · 시스템 종류
const OWN = /^보더 들여오기$|(^|:)boarder(-|:)import$/;
export const isMachine = (l: RuleLine) => l.win === "보더" || OWN.test(l.win) || /:boarder$/.test(l.win) || l.kind === "sys";

export function chiefOf(seats: RoleSeat[]): Chief | null {
  const s = seats.find(x => x.primary); if (!s) return null;
  const tail = s.win.slice(s.win.lastIndexOf(":") + 1);
  return { name: s.name, win: s.win, wid: /^ew_[\w-]{3,60}$/.test(tail) ? tail : null };
}
export function chiefTrouble(l: RuleLine, chief: Chief | null): boolean {
  if (!chief || !["sys", "blocked", "incident"].includes(l.kind)) return false;
  if (chief.wid && l.wid === chief.wid) return true;
  const t = String(l.text || ""), n = chief.name;
  return t.includes(chief.win) || (!!chief.wid && t.includes(chief.wid)) || t.includes(`「${n}」`) || new RegExp(`${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(창|세션)`).test(t);
}
/**
 * 자리표를 쓰는 사람의 글 한 줄 판정(채널 글 · 스레드 답 공통). human = 내 글에 달린 스레드 답.
 *   true = 읽지 않음에 뜨고 알림 감 · false = 채널에만 남음
 */
export function shows(l: RuleLine, seat: Seat, chief: Chief | null, human = false): boolean {
  if (chiefTrouble(l, chief)) return true;
  if (isMachine(l) || QUIET.has(l.kind) || l.kind === "role") return false;
  return human || seat !== null;
}
