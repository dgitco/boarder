// 영업 보드 아침 알림 — 담당마다 「오늘 기한 · 지난 것」 한 묶음(메일 + 보드 폰 알림). 영업 팀 사람에게만.
// 받는 사람 = 카드 담당이면서 지금 그 팀 팀원이고, 보드에 한 번이라도 들어온 사람(user 줄 있음) — 아직 안 들어온 사람에게는 아무것도 안 감.
import { dueToday, todayKst, STAGE_KO, type Card, type Stage } from "./rules";

export type DigestRow = { team: string; team_name: string; firm: string; stage: string; assignee: string; next: string; due: string | null; hold_until: string | null };
export type DigestItem = { team: string; firm: string; stage_ko: string; next: string; day: string; late: boolean };
export type Digest = { to: string; name: string; items: DigestItem[] };
export type Mail = { subject: string; text: string; html: string };

// 순수 함수: 줄 → 담당별 묶음(지난 것 먼저, 날짜 순). today = 한국 날짜 YYYY-MM-DD
export function digestOf(rows: DigestRow[], today: string, names: Map<string, string> = new Map()): Digest[] {
  const by = new Map<string, DigestItem[]>();
  for (const r of rows) {
    const c = { stage: r.stage as Stage, due: r.due, hold_until: r.hold_until } as Card;
    if (!dueToday(c, today)) continue;
    const day = (r.stage === "hold" ? r.hold_until : r.due)!;
    const it: DigestItem = { team: r.team_name, firm: r.firm, stage_ko: STAGE_KO[r.stage as Stage] || r.stage, next: r.stage === "hold" ? "다시 볼 날" : r.next, day, late: day < today };
    (by.get(r.assignee) ?? by.set(r.assignee, []).get(r.assignee)!).push(it);
  }
  return [...by].map(([to, items]) => ({ to, name: names.get(to) || to.split("@")[0], items: items.sort((a, b) => Number(b.late) - Number(a.late) || a.day.localeCompare(b.day) || a.firm.localeCompare(b.firm)) }));
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
export const headOf = (d: Digest) => { const late = d.items.filter(x => x.late).length, now = d.items.length - late; return [now ? `오늘 기한 ${now}` : "", late ? `지남 ${late}` : ""].filter(Boolean).join(" · "); };

export function digestMail(d: Digest, today: string, url: string): Mail {
  const head = headOf(d);
  const line = (x: DigestItem) => `${x.late ? `[지남 ${md(x.day)}]` : "[오늘]"} ${x.firm} — ${x.stage_ko} · ${x.next}`;
  const text = [`${d.name}님, ${md(today)} 영업 보드 — ${head}`, "", ...d.items.map(line), "", `영업 보드 열기: ${url}`, "", "기한을 옮기거나 카드를 다음 단계로 넘기면 내일 아침 알림에서 빠져요."].join("\n");
  const li = (x: DigestItem) => `<li style="margin:6px 0"><span style="display:inline-block;min-width:64px;font-weight:600;color:${x.late ? "#c62828" : "#111113"}">${x.late ? "지남 " + md(x.day) : "오늘"}</span>${esc(x.firm)} <span style="color:#8b8b93">— ${esc(x.stage_ko)} · ${esc(x.next)}</span></li>`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111113"><p>${esc(d.name)}님, ${md(today)} 영업 보드 — <b>${esc(head)}</b></p><ul style="padding-left:18px">${d.items.map(li).join("")}</ul><p><a href="${esc(url)}">영업 보드 열기</a></p><p style="color:#8b8b93">기한을 옮기거나 카드를 다음 단계로 넘기면 내일 아침 알림에서 빠져요.</p></div>`;
  return { subject: `영업 보드 ${md(today)} — ${head}`, text, html };
}

type Db = D1Database;
// 대상 줄: 팀원인 담당 + user 줄이 있는 사람만. only = 그 한 사람만(시험)
export async function digestRows(db: Db, only?: string) {
  const q = `SELECT c.team, t.name team_name, c.firm, c.stage, c.assignee, c.next, c.due, c.hold_until, COALESCE(u.name, '') uname
    FROM sales_card c JOIN sales_team t ON t.id = c.team
    JOIN sales_member m ON m.team = c.team AND m.email = c.assignee
    JOIN "user" u ON lower(u.email) = c.assignee
    WHERE c.stage != 'lost'${only ? " AND c.assignee = ?" : ""} LIMIT 2000`;
  const r = await (only ? db.prepare(q).bind(only) : db.prepare(q)).all<DigestRow & { uname: string }>();
  return { rows: r.results, names: new Map(r.results.filter(x => x.uname).map(x => [x.assignee, x.uname])) };
}

export type Send = { mail: (to: string, m: Mail) => Promise<unknown>; push: (to: string, n: { id: string; question: string; url: string }) => Promise<unknown> };
// 한 번 돌기: 받을 사람마다 메일 한 통 + 폰 알림 한 통(구독 기기가 있을 때만 실제로 감). 하나가 실패해도 다음 사람은 계속
export async function runDigest(db: Db, base: string, send: Send, o: { only?: string; dry?: boolean; now?: number } = {}) {
  const today = todayKst(o.now), { rows, names } = await digestRows(db, o.only), url = base.replace(/\/$/, "") + "/sales";
  const out: { to: string; items: number; mail?: string; push?: string }[] = [];
  for (const d of digestOf(rows, today, names)) {
    const r: (typeof out)[number] = { to: d.to, items: d.items.length };
    if (!o.dry) {
      try { await send.mail(d.to, digestMail(d, today, url)); r.mail = "ok"; } catch (e) { r.mail = String(e).slice(0, 120); }
      try { await send.push(d.to, { id: `sales:${today}`, question: `영업 보드 — ${headOf(d)}: ${d.items.slice(0, 3).map(x => x.firm).join(", ")}${d.items.length > 3 ? " 외" : ""}`, url: "./sales" }); r.push = "ok"; } catch (e) { r.push = String(e).slice(0, 120); }
    }
    out.push(r);
  }
  return { today, sent: out };
}
