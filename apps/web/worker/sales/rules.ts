export const STAGES = ["inquiry", "contact", "call", "demo", "proposal", "contract", "handoff", "hold", "lost"] as const;
export const SOURCES = ["inquiry", "seminar", "referral", "branch"] as const;
export type Stage = typeof STAGES[number];
export type Source = typeof SOURCES[number];
export const STAGE_KO: Record<Stage, string> = { inquiry: "문의", contact: "첫 연락", call: "통화", demo: "시연 · 설명회", proposal: "제안 · 가격", contract: "계약", handoff: "온보딩 넘김", hold: "보류", lost: "놓침" };
export const SOURCE_KO: Record<Source, string> = { inquiry: "문의", seminar: "설명회", referral: "소개", branch: "지점" };
export const DUE_DAYS: Partial<Record<Stage, number>> = { inquiry: 0, contact: 1, call: 1, demo: 1, proposal: 3, contract: 3, handoff: 0 };

export type Card = {
  firm: string; stage: Stage; assignee: string; source: Source;
  last_at: string | null; last_note: string; next: string; due: string | null;
  links: string[]; hold_until: string | null; lost_reason: string;
};
export const FIELDS = ["firm", "stage", "assignee", "source", "last_at", "last_note", "next", "due", "links", "hold_until", "lost_reason"] as const;
const LIMIT = { firm: 80, last_note: 200, next: 200, lost_reason: 200, link: 500, links: 10 };

const CTRL = /[\x00-\x1f\x7f-\x9f]/g;
const text = (v: unknown, n: number) => typeof v === "string" ? v.replace(CTRL, " ").trim().slice(0, n) : "";
// 날짜는 「YYYY-MM-DD」 한 꼴만(시각 · 시간대 없음 — 기한은 한국 날짜). 없는 날(2월 30일)은 거절
export function day(v: unknown): string | null | undefined {
  if (v === null || v === "" || v === undefined) return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(v + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v;
}
const url = (v: unknown) => typeof v === "string" && v.length <= LIMIT.link && /^https?:\/\/[^\s<>"]+$/.test(v.trim()) ? v.trim() : null;

export type Check = { ok: true; card: Card } | { ok: false; error: string };
// 만들기 · 고치기 둘 다: 앞 판(없으면 빈 카드)에 받은 칸만 덮고 전체를 검사. members = 그 팀 사람 메일(담당은 그 안에서만)
export function check(prev: Card | null, input: Record<string, unknown>, members: string[]): Check {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const base: Card = prev ?? { firm: "", stage: "inquiry", assignee: "", source: "inquiry", last_at: null, last_note: "", next: "", due: null, links: [], hold_until: null, lost_reason: "" };
  const c: Card = { ...base, links: [...base.links] };
  if (has("firm")) c.firm = text(input.firm, LIMIT.firm);
  if (has("stage")) { if (!STAGES.includes(input.stage as Stage)) return { ok: false, error: "단계가 올바르지 않아요" }; c.stage = input.stage as Stage; }
  if (has("source")) { if (!SOURCES.includes(input.source as Source)) return { ok: false, error: "들어온 길이 올바르지 않아요" }; c.source = input.source as Source; }
  if (has("assignee")) c.assignee = text(input.assignee, 200).toLowerCase();
  for (const k of ["last_at", "due", "hold_until"] as const) if (has(k)) { const d = day(input[k]); if (d === undefined) return { ok: false, error: "날짜는 YYYY-MM-DD 꼴이어야 해요" }; c[k] = d; }
  for (const k of ["last_note", "next", "lost_reason"] as const) if (has(k)) c[k] = text(input[k], LIMIT[k]);
  if (has("links")) {
    if (!Array.isArray(input.links) || input.links.length > LIMIT.links) return { ok: false, error: `원문 링크는 ${LIMIT.links}개까지예요` };
    const ls = input.links.map(url); if (ls.some(x => !x)) return { ok: false, error: "원문 링크는 http(s) 주소여야 해요" };
    c.links = [...new Set(ls as string[])];
  }
  if (!c.firm) return { ok: false, error: "사무소 이름을 넣어 주세요" };
  if (!members.includes(c.assignee) && !(prev && prev.assignee === c.assignee)) return { ok: false, error: "담당은 이 팀 사람이어야 해요" };   // 담당을 안 바꾸면 통과(팀에서 빠진 사람 카드도 옮기기 · 고치기는 됨)
  if (c.stage !== "hold") c.hold_until = null;
  if (c.stage !== "lost") c.lost_reason = "";
  if (c.stage === "hold" && !c.hold_until) return { ok: false, error: "보류는 다시 볼 날짜가 있어야 해요" };
  if (c.stage === "lost" && !c.lost_reason) return { ok: false, error: "놓침은 이유 한 줄이 있어야 해요" };
  if (c.stage !== "hold" && c.stage !== "lost" && (!c.next || !c.due)) return { ok: false, error: "다음 할 일과 기한을 넣어 주세요" };
  return { ok: true, card: c };
}

// 바뀐 칸만 [앞, 뒤] — 카드 기록 줄. 바뀐 게 없으면 빈 객체
export function diff(a: Card | null, b: Card): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of FIELDS) { const x = a ? a[k] : null, y = b[k]; if (JSON.stringify(x) !== JSON.stringify(y)) out[k] = [x, y]; }
  return out;
}

// 기본 기한: from(YYYY-MM-DD)에서 영업일 n 일 뒤(토 · 일 건너뜀, 공휴일은 2차). 당일(0)이 주말이면 다음 월요일
export function addBusinessDays(from: string, n: number): string {
  const d = new Date(from + "T00:00:00Z"), wk = () => d.getUTCDay() === 0 || d.getUTCDay() === 6, step = () => d.setUTCDate(d.getUTCDate() + 1);
  while (wk()) step();
  for (let i = 0; i < n; i++) { step(); while (wk()) step(); }
  return d.toISOString().slice(0, 10);
}
export const suggestDue = (stage: Stage, today: string) => DUE_DAYS[stage] === undefined ? null : addBusinessDays(today, DUE_DAYS[stage]!);
// 한국 날짜(기한 비교 · 기본 기한의 「오늘」)
export const todayKst = (ms = Date.now()) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

// CSV(엑셀용): 맨 앞 BOM(한글), 칸에 쉼표 · 따옴표 · 줄바꿈이 있으면 따옴표로, = + - @ 로 시작하면 앞에 '(수식으로 안 돌게)
const cell = (v: unknown) => { let s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const CSV_HEAD = ["사무소", "단계", "담당", "들어온 길", "마지막 연락", "마지막 연락 한 줄", "다음 할 일", "기한", "원문 링크", "다시 볼 날짜", "놓친 이유"];
export function csv(cards: Card[], name: (email: string) => string): string {
  const rows = cards.map(c => [c.firm, STAGE_KO[c.stage], name(c.assignee), SOURCE_KO[c.source], c.last_at, c.last_note, c.next, c.due, c.links.join(" "), c.hold_until, c.lost_reason]);
  return "\uFEFF" + [CSV_HEAD, ...rows].map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
// 아침 알림 대상: 기한이 오늘이거나 지난 진행 카드 + 다시 볼 날짜가 된 보류 카드
export const dueToday = (c: Card, today: string) => c.stage === "hold" ? !!c.hold_until && c.hold_until <= today : c.stage !== "lost" && !!c.due && c.due <= today;
