// 회원 보드 「모아 보기」 · 반응 · 내 글 고치기 · 읽음 — 보드 틀(page)이 부르는 길을 회원 D1 표로(틀은 그대로).
// 예전 회원 길은 반응 · 고치기 「아직 안 돼요」(400), 모아 보기(/api/inbox) · 초안(/api/drafts)은 늘 빈 답, 저장 · 읽음 · 초안 저장은 저장 없이 ok 였음.
// 표: member_react · member_saved · member_draft · member_seen(0041). 모두 owner = 나, 남의 것은 404 · 빈 답
import type { Context } from "hono";
import { paneLogs, ME, OWN, NOT_CHAT } from "./member-board";

type Env = { DB: D1Database };
type C = Context<{ Bindings: Env }>;
type R = Record<string, any>;

export const SAVED_MAX = 500, DRAFT_MAX = 4000, UNREAD_MAX = 50, FIRST_DAY = 86_400_000;
const PRIMARY = "%1";
const PRIM_ALL = "t:*", thKey = (root: string) => "t:" + root, PTH = /^p:(\d{10}\.\d{6})$/;
const TH_ROWS = 1000;
const rootOf = (thread: unknown) => { const t = String(thread || ""); return PTH.exec(t)?.[1] || (TS.test(t) ? t : null); };
const TS = /^(\d{10})\.(\d{6})$/, RX = /^[a-z0-9_+-]{1,40}$/;
const CTRL = /[\x00-\x08\x0b-\x1f\x7f]/g;
// 파일 붙은 글 끝의 첨부 줄(member-files.ts fileLines 꼴): 「📎 이름: <주소>/f/<id>?e=<초>&t=<서명>」
const FILE_LINE = /^📎 .{1,200}: https?:\/\/\S+\/f\/[0-9a-f]{32}\?e=\d{9,11}&t=[0-9a-f]{32}$/u;
const cut = (s: unknown, n: number) => { const a = Array.from(String(s ?? "")); return a.length <= n ? a.join("") : a.slice(0, n - 1).join("") + "…"; };
const tsOf = (at: number, id: number) => `${Math.floor(at / 1000)}.${String(id % 1_000_000).padStart(6, "0")}`;   // member-board 채팅 글 ts 와 같은 꼴


// 채팅 글 ts(초.마이크로초 — 끝 여섯 자리 = 줄 id % 1e6) → 내 board_log 한 줄
export async function logByTs(db: D1Database, me: string, ts: unknown): Promise<R | null> {
  const m = TS.exec(String(ts || "")); if (!m) return null;
  const s = Number(m[1]) * 1000;
  return db.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND id % 1000000 = ? AND at >= ? AND at < ? LIMIT 1").bind(me, Number(m[2]), s, s + 1000).first<R>();
}
const cardByTs = (db: D1Database, me: string, ts: string) => TS.test(ts) ? db.prepare("SELECT id, win, question, state, at FROM board_card WHERE id = ? AND owner = ?").bind(ts, me).first<R>() : Promise.resolve(null);

// 채널 열쇠(틀의 「n:<화면 이름>」) ↔ pane
async function chans(db: D1Database, me: string) {
  const P = await paneLogs(db, me);
  const key = new Map(P.chans.map(c => [c.pane, "n:" + c.name])), byKey = new Map(P.chans.map(c => ["n:" + c.name, c.pane]));
  const chanOf = (r: { win: string; kind?: string; thread?: string | null }) => { const p = P.paneOfLog(r); return p && p !== PRIMARY ? key.get(p) || "" : ""; };
  return { P, key, byKey, chanOf };
}
async function seeUpTo(db: D1Database, me: string, pane: string, at: number) {
  await db.prepare("INSERT INTO member_seen(owner, pane, at) VALUES (?,?,?) ON CONFLICT(owner, pane) DO UPDATE SET at = MAX(at, excluded.at)").bind(me, pane, Math.min(at, Date.now())).run();
}

// ── 모아 보기(/api/inbox) ──
export async function inbox(db: D1Database, me: string) {
  const { P, key, chanOf } = await chans(db, me), now = Date.now();
  const [sn, sv, dr] = await db.batch([
    db.prepare("SELECT pane, at FROM member_seen WHERE owner = ?").bind(me),
    db.prepare("SELECT kind, ref, at FROM member_saved WHERE owner = ? ORDER BY at DESC LIMIT ?").bind(me, SAVED_MAX),
    db.prepare("SELECT pane AS key, text, at FROM member_draft WHERE owner = ? ORDER BY at DESC LIMIT 100").bind(me),
  ]);
  const seen = new Map((sn.results as R[]).map(r => [String(r.pane), Number(r.at)]));
  const unread: R[] = [];
  for (const c of P.chans) {
    const s = seen.get(c.pane) ?? now - FIRST_DAY;   // 처음 보는 채널은 하루 안 글만
    for (const r of c.rows) if (!TS.test(String(r.thread || "")) && Number(r.at) > s) unread.push({ ts: tsOf(r.at, r.id), chan: key.get(c.pane), thread: null, text: cut(r.text, 400), at: Number(r.at) / 1000, who: "agent", author: c.name });   // 스레드 답은 아래 threadUnread(채널 읽음과 따로)
  }
  unread.push(...await threadUnread(db, me, seen, now, P, key));
  unread.sort((a, b) => b.at - a.at);
  // 저장: 글은 board_log id, 카드는 board_card id(= 카드 글 ts)
  const savedRows = sv.results as R[], logIds = savedRows.filter(r => r.kind === "log").map(r => Number(r.ref)), cardIds = savedRows.filter(r => r.kind === "card").map(r => String(r.ref));
  const [lg, cd] = await db.batch([
    db.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND id IN (SELECT value FROM json_each(?))").bind(me, JSON.stringify(logIds)),
    db.prepare("SELECT id, win, question, state, at FROM board_card WHERE owner = ? AND id IN (SELECT value FROM json_each(?))").bind(me, JSON.stringify(cardIds)),
  ]);
  const logs = new Map((lg.results as R[]).map(r => [String(r.id), r])), cards = new Map((cd.results as R[]).map(r => [String(r.id), r]));
  const saved: R[] = [];
  for (const s of savedRows) {
    if (s.kind === "log") { const r = logs.get(String(s.ref)); if (r) saved.push({ ts: tsOf(r.at, r.id), chan: chanOf(r as { win: string }), thread: TS.test(String(r.thread || "")) ? r.thread : null, text: cut(r.text, 400), at: Number(r.at) / 1000, who: r.kind === "me" ? "owner" : "agent", author: String(r.win), saved_at: Number(s.at) / 1000 }); }
    else { const r = cards.get(String(s.ref)); if (r) saved.push({ ts: r.id, chan: chanOf({ win: r.win }), thread: null, text: cut(r.question, 400), at: Number(r.at) / 1000, who: "agent", author: String(r.win), saved_at: Number(s.at) / 1000 }); }
  }
  // 초안: 열쇠는 틀 것 그대로(「chan:<채널>」 · 「th:<스레드 ts>」 · 「card:<카드>」)
  // 스레드 초안(「th:<ts>」)은 열쇠에 채널이 없음 — 그 스레드 머리 글(내 글 · 카드)에서 채널을 찾아 붙임(없으면 빈 칸 그대로)
  const drafts = await Promise.all((dr.results as R[]).filter(d => String(d.text || "").trim()).map(async d => {
    const k = String(d.key), th = k.startsWith("th:") ? k.slice(3) : null;
    const head = th ? (await logByTs(db, me, th)) || (await cardByTs(db, me, th)) : null;
    const chan = k.startsWith("chan:") ? k.slice(5) : head ? chanOf({ win: String(head.win), kind: head.kind, thread: head.thread }) : "";
    return { key: k, chan, thread: th, card: k.startsWith("card:") ? k.slice(5) : null, text: cut(d.text, 400), at: Number(d.at) / 1000 };
  }));
  return { unread: unread.slice(0, UNREAD_MAX), drafts, saved, saved_ids: saved.map(x => x.ts) };
}
export async function inboxPost(db: D1Database, me: string, b: R): Promise<{ status: number; body: R }> {
  const op = String(b.op || "");
  if (op === "save" || op === "unsave") {
    const ts = String(b.ts || ""), card = await cardByTs(db, me, ts), log = card ? null : await logByTs(db, me, ts);
    if (!card && !log) return { status: 404, body: { ok: false, error: "없는 글이에요" } };
    const kind = card ? "card" : "log", ref = card ? String(card.id) : String(log!.id);
    if (op === "unsave") { await db.prepare("DELETE FROM member_saved WHERE owner = ? AND kind = ? AND ref = ?").bind(me, kind, ref).run(); return { status: 200, body: { ok: true } }; }
    const n = await db.prepare("SELECT COUNT(*) n FROM member_saved WHERE owner = ?").bind(me).first<{ n: number }>();
    if ((n?.n || 0) >= SAVED_MAX) return { status: 400, body: { ok: false, error: `저장은 ${SAVED_MAX}개까지예요` } };
    await db.prepare("INSERT INTO member_saved(owner, kind, ref, at) VALUES (?,?,?,?) ON CONFLICT(owner, kind, ref) DO NOTHING").bind(me, kind, ref, Date.now()).run();
    return { status: 200, body: { ok: true } };
  }
  if (op === "read" || op === "readall") {
    const { P, byKey } = await chans(db, me);
    if (op === "readall") { for (const c of P.chans) await seeUpTo(db, me, c.pane, Date.now()); await seeUpTo(db, me, PRIM_ALL, Date.now()); return { status: 200, body: { ok: true } }; }
    const items = Array.isArray(b.items) ? (b.items as R[]).slice(0, 200) : [];
    for (const it of items) {
      const r = await logByTs(db, me, it?.ts); if (!r) continue;
      const pt = r.thread !== "primary" ? rootOf(r.thread) : null; if (pt) { await seeUpTo(db, me, thKey(pt), Number(r.at)); continue; }   // 스레드 답 = 그 스레드만(그 답까지)
      const pane = byKey.get(String(it?.chan || "")) || P.paneOfLog(r as { win: string }); if (pane) await seeUpTo(db, me, pane, Number(r.at));
    }
    return { status: 200, body: { ok: true } };
  }
  return { status: 400, body: { ok: false, error: "모르는 요청" } };
}

async function threadUnread(db: D1Database, me: string, seen: Map<string, number>, now: number, P: Awaited<ReturnType<typeof paneLogs>>, key: Map<string, string>): Promise<R[]> {
  const all = seen.get(PRIM_ALL) ?? now - FIRST_DAY;
  const rows = ((await db.prepare(`SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND thread IS NOT NULL AND thread != 'primary' AND at > ? ${NOT_CHAT} ORDER BY at DESC, id DESC LIMIT ?`).bind(me, all, TH_ROWS).all<R>()).results || []) as R[];
  if (!rows.length) return [];
  const reacted = new Set(((await db.prepare("SELECT DISTINCT log_id FROM member_react WHERE owner = ? AND log_id IN (SELECT value FROM json_each(?))").bind(me, JSON.stringify(rows.map(r => Number(r.id)))).all<{ log_id: number }>()).results || []).map(r => Number(r.log_id)));
  const mine = (r: R) => r.kind === "me" || r.win === ME;
  const bot = String((await db.prepare("SELECT name FROM member_bot WHERE owner = ?").bind(me.toLowerCase()).first<{ name: string | null }>().catch(() => null))?.name || "Primary");
  const floor = new Map<string, number>();
  for (const r of rows) { const root = rootOf(r.thread); if (root && (mine(r) || reacted.has(Number(r.id)))) floor.set(root, Math.max(floor.get(root) ?? 0, Number(r.at))); }
  const out: R[] = [];
  for (const r of rows) {
    const root = rootOf(r.thread); if (!root || mine(r) || OWN.test(String(r.win)) || r.win === "보더") continue;
    if (Number(r.at) <= Math.max(all, seen.get(thKey(root)) ?? 0, floor.get(root) ?? 0)) continue;
    const prim = PTH.test(String(r.thread)), pane = prim ? null : P.paneOfLog({ win: String(r.win), kind: r.kind, thread: null }), chan = prim ? "primary" : pane && pane !== PRIMARY ? key.get(pane) : null;
    if (!chan) continue;
    const author = prim ? bot : P.chans.find(c => c.pane === pane)?.name || String(r.win || "");
    out.push({ ts: tsOf(r.at, r.id), chan, thread: root, text: cut(r.text, 400), at: Number(r.at) / 1000, who: "agent", author });
  }
  return out;
}

// ── 초안(/api/drafts · /api/draft) ──
export async function draftMap(db: D1Database, me: string) {
  const rs = (await db.prepare("SELECT pane AS key, text, at FROM member_draft WHERE owner = ? ORDER BY at DESC LIMIT 100").bind(me).all<R>()).results;
  return Object.fromEntries(rs.map(r => [String(r.key), { text: String(r.text), at: Number(r.at) }]));
}
export async function draftPost(db: D1Database, me: string, b: R): Promise<{ status: number; body: R }> {
  const key = String(b.key || "").replace(CTRL, "").slice(0, 200), text = String(b.text ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, DRAFT_MAX);
  if (!key) return { status: 400, body: { ok: false, error: "열쇠" } };
  if (!text.trim()) await db.prepare("DELETE FROM member_draft WHERE owner = ? AND pane = ?").bind(me, key).run();
  else await db.prepare("INSERT INTO member_draft(owner, pane, text, at) VALUES (?,?,?,?) ON CONFLICT(owner, pane) DO UPDATE SET text = excluded.text, at = excluded.at").bind(me, key, text, Date.now()).run();
  return { status: 200, body: { ok: true, state: "ok" } };
}

// ── /api/chat 의 반응 · 고치기 · 읽음 ──
// null = 이 몸통은 여기 일이 아님(원본 회원 길로)
export async function chatPost(db: D1Database, me: string, b: R): Promise<{ status: number; body: R } | null> {
  if (b.react) {
    const name = String(b.react);
    if (!RX.test(name)) return { status: 400, body: { ok: false, error: "모르는 반응이에요" } };
    const r = await logByTs(db, me, b.ts); if (!r) return { status: 404, body: { ok: false, error: "반응을 달 수 없는 글이에요" } };
    if (b.unreact) await db.prepare("DELETE FROM member_react WHERE owner = ? AND log_id = ? AND emoji = ?").bind(me, r.id, name).run();
    else await db.prepare("INSERT INTO member_react(owner, log_id, emoji, at) VALUES (?,?,?,?) ON CONFLICT(owner, log_id, emoji) DO NOTHING").bind(me, r.id, name, Date.now()).run();
    return { status: 200, body: { ok: true, state: "ok" } };
  }
  if (b.edit !== undefined && !b.delete) {
    const text = String(b.edit ?? "").replace(CTRL, " ").trim().slice(0, DRAFT_MAX);
    if (!text) return { status: 400, body: { ok: false, error: "내용을 적어요" } };
    const r = await logByTs(db, me, b.ts);
    if (!r || (r.kind !== "me" && r.win !== "나")) return { status: 404, body: { ok: false, error: "내 글만 고칠 수 있어요" } };
    const has = new Set(text.split("\n").map(l => l.trim()));
    const fl = String(r.text || "").split("\n").map(l => l.trim()).filter(l => FILE_LINE.test(l) && !has.has(l));
    await db.prepare("UPDATE board_log SET text = ? WHERE id = ? AND owner = ? AND (kind = 'me' OR win = '나')").bind([text, ...fl].join("\n"), r.id, me).run();
    return { status: 200, body: { ok: true, state: "ok" } };
  }
  if (b.seen) {   // 스레드 · 글을 봄 — 그 글의 채널을 그 글까지 읽음으로
    const ts = String(b.thread || b.ts || ""), r = await logByTs(db, me, ts) || await cardByTs(db, me, ts);
    // 스레드(뿌리 · 답 어느 ts 든) — 그 스레드 답을 지금까지 읽음으로. 뿌리 글이면 그 채널도 예전처럼(반응 · 답 = 읽음)
    const root = r && r.thread && r.thread !== "primary" ? rootOf(r.thread) : r && TS.test(ts) ? ts : null;
    if (root) await seeUpTo(db, me, thKey(root), Date.now());
    if (r && !r.thread) {   // 노드 채널 글 · 카드(Primary 줄은 채널 읽음 없음 — 위 스레드만)
      const { P } = await chans(db, me), pane = P.paneOfLog({ win: String(r.win), kind: r.kind, thread: r.thread }); if (pane) await seeUpTo(db, me, pane, Date.now()); }
    return { status: 200, body: { ok: true, state: "ok", seen: true } };
  }
  return null;
}
// 노드 채팅을 열면(틀이 api/nodechat 을 부름) 그 채널을 읽음으로 — 화면 이름 → pane. 틀이 몇 초마다 다시 부르므로 같은 채널은 30초에 한 번만
const SEEN_GAP = 30_000, seenAt = new Map<string, number>();
export async function seenByLabel(db: D1Database, me: string, label: string, now = Date.now()) {
  const k = me + "|" + label; if (now - (seenAt.get(k) || 0) < SEEN_GAP) return;
  if (seenAt.size > 2000) seenAt.clear(); seenAt.set(k, now);
  const { byKey } = await chans(db, me), pane = byKey.get("n:" + label);
  if (pane) await seeUpTo(db, me, pane, Date.now());
}

// 회원 요청 하나 — 여기 일이면 답, 아니면 null(member-board 회원 길로). body: 이미 읽은 JSON 몸통(POST /api/chat · inbox · draft)
export async function route(c: C, me: string, url: URL, body?: R | null): Promise<Response | null> {
  const p = url.pathname, db = c.env.DB, J = (o: R, st = 200) => c.json(o, st as 200, { "cache-control": "no-store" });
  if (c.req.method === "GET") {
    if (p === "/api/inbox") return J(await inbox(db, me));
    if (p === "/api/drafts") return J(await draftMap(db, me));
    if (p === "/api/nodechat") { const w = String(url.searchParams.get("w") || "").trim(); if (w) c.executionCtx.waitUntil(seenByLabel(db, me, w).catch(e => console.error("읽음", e))); }
    return null;
  }
  if (c.req.method !== "POST" || !body) return null;
  if (p === "/api/inbox") { const r = await inboxPost(db, me, body); return J(r.body, r.status); }
  if (p === "/api/draft") { const r = await draftPost(db, me, body); return J(r.body, r.status); }
  if (p === "/api/chat") { const r = await chatPost(db, me, body); return r ? J({ rid: String(body.rid || "").slice(0, 64), ...r.body }, r.status) : null; }
  return null;
}
