// 회원 웹 푸시 더하기: 어느 사건에 알림을 보내나 · 한 브라우저 구독 주소는 한 회원 것만.
import { paneLogs } from "./member-board";
import { shows, chiefTrouble } from "./inbox-rules";
import { seatsFromData } from "./role-seat";
const QUIET_KINDS = new Set(["status", "start", "progress", "done"]);

export type PushWhy = "card" | "reply" | "call" | "progress";
export type ProgressPref = "digest" | "off";
export const PROGRESS_PREFS: ProgressPref[] = ["digest", "off"];
export const DIGEST_MS = 5 * 60_000;   // 진행 글 묶음 간격
export const SENT_KEEP = 500;          // 보낸 사건 key 를 이만큼 기억(두 번 안 보내기)

export const ONBOARD_QUIET_MS = 30 * 60_000;
/** 카드 원래 시각(asked_at)이 만든 때보다 이만큼 넘게 앞서면 옛 글(밀린 질문 다시 올림) — 새로 선 카드가 아니라 알림 안 감 */
export const OLD_MS = 10 * 60_000;

export type PushCard = { id: string; question: string; kind?: string; urgent?: boolean; at?: number; orig_at?: number | null; secret?: boolean };
export const pushKind = (kind: unknown) => kind !== "todo";
/**
 * 새 카드의 알림 범위: "urgent" = 누구에게나 보냄(비밀 넣기 허용 카드 = 에이전트가 멈춰 기다림 · 할 일 아닌 urgent 카드),
 * "wide" = 넓힘을 켠 회원에게만(그 밖의 새 카드 — 할 일 포함), null = 아무에게도 안 감(옛 글 · 온보딩 30분 안의 첫 물결)
 */
export async function memberPushTier(db: D1Database, me: string, card: PushCard): Promise<"urgent" | "wide" | null> {
  if (card.secret) return "urgent";
  const at = card.at ?? Date.now();
  if (card.orig_at != null && card.orig_at < at - OLD_MS) return null;
  const first = (await db.prepare("SELECT MIN(created_at) t FROM device WHERE lower(owner) = ?").bind(me.toLowerCase()).first<{ t: number | null }>())?.t;
  if (first != null && at < first + ONBOARD_QUIET_MS) return null;
  return pushKind(card.kind) && card.urgent ? "urgent" : "wide";
}
/** 이 회원에게 이 카드 알림을 보내나 — wide = 그 사람이 넓힘을 켰나(기본 false = 급한 카드만) */
export async function memberPushWanted(db: D1Database, me: string, card: PushCard, wide = false) {
  const t = await memberPushTier(db, me, card);
  return t === "urgent" || (wide && t === "wide");
}

/** 에이전트가 보드에 쓴 글 한 줄(local.ts onLine) — id = board_log 줄 id */
export type PushLine = { id: number; tool: "inbox_log" | "inbox_say" | "chat_say"; kind: string; text: string; thread: string | null; unblocks?: string; win: string };
const PTH = /^p:(\d{10}\.\d{6})$/, TS = /^(\d{10})\.(\d{6})$/;
/**
 * 이 스레드가 사람(회원)이 쓴 글에 달린 것인가: Primary 내 글 스레드(p:<뿌리> — chat_say · inbox_say 가 뿌리를 확인하고 씀) ·
 * 그 스레드에 내가 쓴 줄(kind me · win 나)이 있음 · 뿌리 줄이 내 글 · 내가 답한 카드. card = 이 스레드가 내 카드(누르면 그 카드)
 */
export async function humanThread(db: D1Database, me: string, thread: string | null): Promise<{ human: boolean; card: boolean }> {
  if (!thread || thread === "primary") return { human: false, card: false };
  if (PTH.test(thread)) return { human: true, card: false };
  const m = TS.exec(thread);
  const c = m ? await db.prepare("SELECT answer FROM board_card WHERE id = ? AND owner = ?").bind(thread, me).first<{ answer: string | null }>() : null;
  if (c?.answer != null) return { human: true, card: true };
  const mine = await db.prepare("SELECT 1 x FROM board_log WHERE owner = ? AND thread = ? AND (kind = 'me' OR win = '나') LIMIT 1").bind(me, thread).first();
  if (mine || !m) return { human: !!mine, card: !!c };
  const root = await db.prepare("SELECT 1 x FROM board_log WHERE owner = ? AND id % 1000000 = ? AND at >= ? AND at < ? AND (kind = 'me' OR win = '나') LIMIT 1").bind(me, Number(m[2]), Number(m[1]) * 1000, Number(m[1]) * 1000 + 1000).first();
  return { human: !!root, card: !!c };
}
const SEAT_MS = 60_000, SEAT_MAX = 200;
const seatMemo = new WeakMap<D1Database, Map<string, { at: number; p: Promise<Awaited<ReturnType<typeof paneLogs>>> }>>();
export function seatView(db: D1Database, me: string, now = Date.now()) {
  let m = seatMemo.get(db); if (!m) seatMemo.set(db, m = new Map());
  const hit = m.get(me); if (hit && now - hit.at < SEAT_MS) return hit.p;
  if (m.size >= SEAT_MAX) m.clear();
  const p = paneLogs(db, me); m.set(me, { at: now, p });
  p.catch(() => { if (m!.get(me)?.p === p) m!.delete(me); });   // 실패는 두지 않음 — 다음 줄이 다시 읽음
  return p;
}
/**
 * 글 한 줄의 알림 종류: 턴 답(inbox_log reply — 보드에서 창에 넣은 내 글에 대한 답) · 사람 글 스레드의 답 = reply,
 * 막힘 unblocks=me · 장애 = call, 그 밖 = progress. card = 그 스레드가 내 카드
 */
export async function lineWhy(db: D1Database, me: string, l: PushLine): Promise<{ why: PushWhy | "none"; card: boolean; fresh?: boolean }> {
  const t = await humanThread(db, me, l.thread);
  const seated = seatsFromData((await db.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me).first<{ data: string | null }>().catch(() => null))?.data).length > 0;   // 자리표 없는 사람은 보드 전체를 안 읽음(예전 그대로)
  const P = seated ? await seatView(db, me) : null;
  if (P?.rules.on) {
    const seat = P.seatOf({ win: l.win, kind: l.kind, thread: l.thread }), human = t.human || (l.tool === "inbox_log" && l.kind === "reply");
    const line = { win: l.win, kind: l.kind, text: l.text };
    if (!shows(line, seat, P.rules.chief, human)) return { why: seat && QUIET_KINDS.has(l.kind) ? "progress" : "none", card: t.card };
    if (chiefTrouble(line, P.rules.chief) || l.kind === "incident" || (l.kind === "blocked" && l.unblocks === "me")) return { why: "call", card: t.card };
    return { why: "reply", card: t.card, fresh: !human };
  }
  if (l.tool === "inbox_log" && l.kind === "reply") return { why: "reply", card: t.card };
  if (l.tool === "inbox_log" && (l.kind === "incident" || (l.kind === "blocked" && l.unblocks === "me"))) return { why: "call", card: t.card };
  return { why: t.human ? "reply" : "progress", card: t.card };
}
/** reply · call 알림 글. 누르면: Primary 내 글 스레드 → 그 스레드, 카드 스레드 → 그 카드, 그 밖 → 보드 첫 화면 */
export function lineMsg(l: PushLine, why: "reply" | "call", card = false, fresh = false) {
  const p = PTH.exec(l.thread || "");
  const url = p ? `./?open=thread:primary:${p[1]}` : card && l.thread ? `./?open=card:${l.thread}` : "./";
  const text = String(l.text || "").replace(/\s+/g, " ").trim(), win = String(l.win || "").trim();
  return { id: `log:${l.id}`, question: (win ? `${win} — ` : "") + text, url, title: why === "call" ? "나를 불러요" : fresh ? "새 글이 왔어요" : "답이 왔어요" };
}
type Pu = Pick<import("./push-do").MemberPushApi, "mNotify" | "mDigest" | "mPrefs">;
/** 새 카드 한 장을 회원 칸으로(index.ts memberCardPush): 급한 카드는 누구에게나, 그 밖 새 카드는 넓힘을 켠 사람만(칸이 opt.wide 로 설정을 봄) */
export async function routeCard(db: D1Database, me: string, card: PushCard, pu: Pick<Pu, "mNotify">) {
  const tier = await memberPushTier(db, me, card);
  if (!tier) return null;
  return pu.mNotify(me.toLowerCase(), { id: card.id, question: card.question }, `card:${card.id}`, { wide: tier === "wide" });
}
/** 에이전트 글 한 줄을 회원 칸으로(index.ts memberLinePush): 넓힘이 꺼졌으면(기본) 아무것도 안 함 — 글 알림은 넓힘을 켠 사람만 */
export async function routeLine(db: D1Database, me: string, line: PushLine, pu: Pu) {
  const m = me.toLowerCase(), pr = await pu.mPrefs(m);
  if (pr[0] !== 200 || (pr[1] as { wide?: boolean }).wide !== true) return null;
  const { why, card, fresh } = await lineWhy(db, me, line);
  if (why === "none") return null;
  if (why === "progress") return pu.mDigest(m);
  if (why !== "card") return pu.mNotify(m, lineMsg(line, why, card, fresh), `log:${line.id}`, { wide: true });
  return null;
}
/** 묶음 알림 한 통(진행 글 n개) */
export const digestMsg = (n: number) => ({ title: `새 글 ${n}`, body: `보드에 진행 글 ${n}개가 새로 올라왔어요`, url: "./", tag: "digest" });

/** 이 구독 주소를 me 것으로 적고, 다른 회원 것으로 적혀 있었으면 그 회원 칸 구독을 지움(unsub). 지운 옛 회원 메일, 없으면 null */
export async function claimEndpoint(db: D1Database, me: string, endpoint: string, unsub: (owner: string) => Promise<unknown>) {
  if (!endpoint) return null;
  const prev = (await db.prepare("SELECT owner FROM member_push_ep WHERE endpoint = ?").bind(endpoint).first<{ owner: string }>())?.owner || null;
  if (prev && prev !== me) await unsub(prev);
  await db.prepare("INSERT INTO member_push_ep(endpoint, owner, at) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET owner = excluded.owner, at = excluded.at").bind(endpoint, me, Date.now()).run();
  return prev && prev !== me ? prev : null;
}
// 글 알림의 문(글마다 도는 D1 한 번): 구독 줄이 있거나 넓힘을 켠 회원(아래 표시 줄)만 회원 칸까지 감. 둘 다 없으면(기본) 칸을 안 부르고 끝 — 기기 조회도 없음
export const linePushOpen = async (db: D1Database, me: string) => !!(await db.prepare("SELECT 1 x FROM member_push_ep WHERE owner = ? LIMIT 1").bind(me.toLowerCase()).first());
/**
 * 넓힘 표시 줄(member_push_ep 의 page:<메일>): 구독 없는 기기(페이지 알림)만 쓰는 회원도 문을 지나게 — 켜면 답 · 부름이 칸의 페이지 모음에 쌓임.
 * 표는 그대로라 마이그레이션 없음. 보내기는 칸의 sub 표를 쓰니 이 줄로 나가는 푸시는 없고, 진짜 구독 주소는 https:// 만이라(push.ts subOf) 겹치지 않음
 */
export async function setWideRow(db: D1Database, me: string, wide: boolean) {
  const m = me.toLowerCase(), ep = `page:${m}`;
  if (wide) await db.prepare("INSERT INTO member_push_ep(endpoint, owner, at) VALUES (?,?,?) ON CONFLICT(endpoint) DO NOTHING").bind(ep, m, Date.now()).run();
  else await db.prepare("DELETE FROM member_push_ep WHERE endpoint = ?").bind(ep).run();
}
/** 구독을 끔 — 내 것으로 적힌 줄만 지움 */
export async function releaseEndpoint(db: D1Database, me: string, endpoint: string) {
  if (endpoint) await db.prepare("DELETE FROM member_push_ep WHERE endpoint = ? AND owner = ?").bind(endpoint, me).run();
}
