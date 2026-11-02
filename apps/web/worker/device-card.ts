export type DEnv = { DB: D1Database };
export const DENY = "거절";
export const CARD_TTL = 10 * 60_000;
const MAX_OPEN_CARDS = 3;   // 메일 하나에 10분 안 카드 셋까지 — 메일만 아는 남이 카드를 쏟아붓지 못하게
export const MAX_DAY_CARDS = 5;   // 하루 다섯(알림 피로)
export const LOCK_MS = 24 * 3600_000;   // 틀린 코드 · 거절 뒤 그 메일의 카드 길을 끄는 시간
const DAY = 24 * 3600_000;
/** 쳐 넣은 코드 비교 — 대소문자 · 띄어쓰기 · 붙임표 무시 */
const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export function cardName(name: unknown, codes: string[]): string | null {
  const n = String(name ?? "").replace(/[^A-Za-z0-9 ._()-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40), flat = norm(n);
  for (const c of codes.map(norm)) if (c.length >= 8 && (flat.includes(c.slice(0, 4)) || flat.includes(c.slice(4, 8)))) return null;
  return n || "이름 없는 기기";
}
const cardId = (now: number) => `${Math.floor(now / 1000)}.${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`;
const ctl = (s: unknown, n: number) => String(s ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim().slice(0, n);

/** (가) 카드 세우기 — 회원이 아니거나 한도를 넘으면 조용히 건너뜀(답은 늘 같은 꼴: 누가 회원인지 새지 않게). 세웠으면 { 카드 id, 보인 이름 } */
export async function askOnBoard(env: DEnv, o: { userCode: string; email: string; isMember: boolean; name: string; country: string; now?: number }) {
  const now = o.now ?? Date.now(), email = o.email.trim().toLowerCase();
  if (!o.isMember || !/^[^@\s]{1,100}@[^@\s]{1,100}\.[^@\s]{1,40}$/.test(email)) return null;
  // 만료 · 끝난 요청의 열린 카드는 닫음(그 회원 것만)
  await env.DB.prepare("UPDATE board_card SET state = 'closed', done = '만료' WHERE owner = ? AND state = 'open' AND id IN (SELECT card_id FROM device_code WHERE card_owner = ? AND (state != 'pending' OR expires_at < ?))").bind(email, email, now).run();
  const n = await env.DB.prepare("SELECT count(*) AS n FROM device_code WHERE card_owner = ? AND created_at > ?").bind(email, now - CARD_TTL).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_OPEN_CARDS) return null;
  const ev = await env.DB.prepare("SELECT sum(kind = 'asked' AND at > ?) AS asked, sum(kind = 'locked' AND at > ?) AS locked FROM device_card_event WHERE email = ?").bind(now - DAY, now - LOCK_MS, email).first<{ asked: number | null; locked: number | null }>();
  if ((ev?.locked ?? 0) > 0 || (ev?.asked ?? 0) >= MAX_DAY_CARDS) return null;
  const open = await env.DB.prepare("SELECT user_code FROM device_code WHERE card_owner = ? AND state = 'pending' AND expires_at > ?").bind(email, now).all<{ user_code: string }>();
  const name = cardName(o.name, [o.userCode, ...(open.results || []).map(r => r.user_code)]); if (name === null) return null;
  const id = cardId(now);
  const choices = [DENY];   // 코드는 보이지 않음 — 「기타」 칸에 쳐 넣기
  const body = `내가 방금 연 기기라면 그 기기 화면(터미널)에 나온 코드(ABCD-EFGH 꼴)를 「기타」 칸에 그대로 쳐 넣으세요 — 맞으면 그 기기가 내 보드에 들어와요. 내가 연 기기가 아니면 「${DENY}」(틀린 코드도 거절이고, 하루 동안 이 메일로는 카드가 다시 오지 않아요).${o.country ? ` 요청한 곳: ${ctl(o.country, 4)}.` : ""} 10분 안에 답하지 않으면 만료돼요.`;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM device_card_event WHERE at < ?").bind(now - 2 * DAY),
    env.DB.prepare("INSERT INTO device_card_event(email, kind, at) VALUES (?, 'asked', ?)").bind(email, now),
    env.DB.prepare("INSERT INTO board_card(id, owner, win, question, choices, recommend, body, at) VALUES (?,?,?,?,?,?,?,?)").bind(id, email, "보더", `새 기기 「${name}」 을 허용할까요?`, JSON.stringify(choices), null, body, now),
    env.DB.prepare("UPDATE device_code SET card_id = ?, card_owner = ? WHERE user_code = ? AND state = 'pending' AND callback IS NULL").bind(id, email, o.userCode),
  ]);
  return { id, name };
}

export async function onDeviceCardAnswered(env: DEnv, me: string, id: string, now = Date.now()) {
  const r = await env.DB.prepare("SELECT d.user_code, d.state, d.expires_at, c.answer FROM device_code d JOIN board_card c ON c.id = d.card_id AND c.owner = d.card_owner WHERE d.card_id = ? AND d.card_owner = ?").bind(id, me).first<{ user_code: string; state: string; expires_at: number; answer: string | null }>();
  if (!r) return false;
  const allow = !!r.answer && norm(r.answer) === norm(r.user_code);
  const u = await env.DB.prepare("UPDATE device_code SET state = ?, owner = ?, approved_by = 'card' WHERE card_id = ? AND card_owner = ? AND state = 'pending' AND expires_at > ? AND callback IS NULL")
    .bind(allow ? "approved" : "denied", me, id, me, now).run();
  const done = !u.meta.changes ? "만료" : allow ? "허용함" : r.answer === DENY ? "거절함" : "코드가 달라 거절함";
  await env.DB.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE id = ? AND owner = ? AND state = 'answered'").bind(done, id, me).run();
  if (u.meta.changes && !allow) {
    // 잠금: 그 메일의 다른 열린 허용 카드 · 기다리는 요청도 거절로 닫음(남이 카드를 여럿 세워 둔 경우)
    await env.DB.batch([
      env.DB.prepare("INSERT INTO device_card_event(email, kind, at) VALUES (?, 'locked', ?)").bind(me, now),
      env.DB.prepare("UPDATE board_card SET state = 'closed', done = '잠김 — 하루 동안 이 메일 카드 없음' WHERE owner = ? AND state = 'open' AND id IN (SELECT card_id FROM device_code WHERE card_owner = ? AND state = 'pending')").bind(me, me),
      env.DB.prepare("UPDATE device_code SET state = 'denied', owner = ?, approved_by = 'card' WHERE card_owner = ? AND state = 'pending' AND callback IS NULL").bind(me, me),
    ]);
  }
  return true;
}
/** 카드가 새 기기 허용 카드인지(답 길이 토큰 머리를 거절할 때) */
export const isDeviceCard = async (env: DEnv, me: string, id: string) => !!(await env.DB.prepare("SELECT 1 FROM device_code WHERE card_id = ? AND card_owner = ?").bind(id, me).first());

/** (나) 승인된 기기가 거절 — 코드 입력 길(로컬 콜백 없음)의 기다리는 코드만. 허용은 기기 토큰만으로 안 됨(person: 사람 길 — 카드 · 브라우저).
 *  결과: ok | person | unknown | done | expired | browser */
export async function approveByDevice(env: DEnv, dev: { id: string; owner: string }, userCode: string, allow: boolean, now = Date.now()) {
  if (allow) return { error: "person" as const };   // 기기 토큰은 사람인지 모름 — device.json 을 읽은 에이전트도 같은 토큰을 씀
  const uc = ctl(userCode, 9).toUpperCase();
  const r = await env.DB.prepare("SELECT state, expires_at, callback, name, card_owner FROM device_code WHERE user_code = ?").bind(uc).first<{ state: string; expires_at: number; callback: string | null; name: string; card_owner: string | null }>();
  if (!r || (r.card_owner && r.card_owner !== dev.owner.toLowerCase())) return { error: "unknown" as const };   // 다른 회원 메일로 낸 요청은 그 회원 기기만
  if (r.state !== "pending") return { error: "done" as const };
  if (r.expires_at < now) return { error: "expired" as const };
  if (r.callback) return { error: "browser" as const };   // 로컬 콜백 길: grant 가 그 기기의 127.0.0.1 로만 가야 함 — 여기선 못 넘김
  const u = await env.DB.prepare("UPDATE device_code SET state = ?, owner = ?, approved_by = ? WHERE user_code = ? AND state = 'pending' AND expires_at > ? AND callback IS NULL")
    .bind(allow ? "approved" : "denied", dev.owner.toLowerCase(), `device:${dev.id}`, uc, now).run();
  if (!u.meta.changes) return { error: "done" as const };
  // 열린 카드가 있었으면 닫음(같은 요청을 두 곳에서)
  await env.DB.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE id = (SELECT card_id FROM device_code WHERE user_code = ?) AND owner = ? AND state = 'open'").bind(allow ? "다른 기기에서 허용함" : "다른 기기에서 거절함", uc, dev.owner.toLowerCase()).run();
  return { ok: true as const, name: r.name };
}
