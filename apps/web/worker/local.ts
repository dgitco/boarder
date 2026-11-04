import { nodeRoot, primaryRoot, primaryThread } from "./member-board";
import { overdue } from "./member-views";
import { splitAdd } from "./member-split";
import { splitText, type SplitSend } from "./member-split-send";
import type { PushLine } from "./member-push";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// 카드 id 는 지금 카드 꼴(초.여섯 자리)과 같게 — 도구 입력 검사(tsId)를 그대로 씀
const cardId = () => `${Math.floor(Date.now() / 1000)}.${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`;
const KINDS = ["decision", "approval", "question", "todo"];   // inbox_ask kind(mcp/tools.ts 와 같음)
// inbox_ask asked_at(질문의 원래 시각): ms · 초 숫자나 ISO 글 → ms. 모르는 꼴이면 null
export const askedAt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n < 1e12 ? n * 1000 : n) : null;
};
type Card = { id: string; state: string; question: string; choices: string; answer: string | null; answered_at: number | null; done: string | null; win: string; at: number };

// onLine = 에이전트가 보드에 쓴 글 한 줄(inbox_log · inbox_say · chat_say)마다 — 폰 알림이 답 · 부름 · 진행 글을 가름(member-push.ts lineWhy). 상태 줄(inbox_status)은 안 부름
export function localTools(db: D1Database, owner: string, win: string, publicUrl: string, key = "", onCard?: (card: { id: string; question: string; kind?: string; urgent: boolean; at: number; orig_at: number | null }) => void, send?: SplitSend, onLine?: (l: PushLine) => void) {
  const wid = /:(ew_[a-z0-9]{6,30})$/.exec(key)?.[1] ?? null;
  const log = async (kind: string, text: string, thread?: string, ev?: { tool: PushLine["tool"]; unblocks?: string }) => {
    const r = await db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?) RETURNING id").bind(owner, win, kind, text, thread ?? null, Date.now(), wid).first<{ id: number }>();
    if (ev && r && onLine) onLine({ id: Number(r.id), tool: ev.tool, kind, text, thread: thread ?? null, unblocks: ev.unblocks, win });
  };
  const card = (id: string) => db.prepare("SELECT id, state, question, choices, answer, answered_at, done, win, at FROM board_card WHERE id = ? AND owner = ?").bind(id, owner).first<Card>();
  const answerOf = (c: Card) => c.answer ? { choice: c.answer, text: c.answer, by: owner, at: String(c.answered_at || "") } : null;
  async function wait(id: string, timeoutS: number) {
    await db.prepare("UPDATE board_card SET waited_at = ? WHERE id = ? AND owner = ?").bind(Date.now(), id, owner).run();   // 이 창이 사람 답을 기다리는 중(감독 규칙)
    const until = Date.now() + Math.min(timeoutS, 55) * 1000;   // Cloudflare 가 한 요청을 ~100초에 끊음 — 열려 있으면 「open」으로 돌려주고 부르는 쪽이 다시(CLI 는 waitLong)
    for (;;) {
      const c = await card(id);
      if (!c) return { state: "closed", answer: null };
      if (c.state !== "open") return { state: c.state === "answered" ? "answered" : "closed", answer: answerOf(c) };
      if (Date.now() + 3000 > until) return { state: "open", answer: null };
      await sleep(3000);
    }
  }
  return async (name: string, a: Record<string, any>): Promise<unknown> => {
    switch (name) {
      case "inbox_log": await log(a.kind, a.text + (a.evidence?.length ? `\n${a.evidence.join("\n")}` : ""), a.thread, { tool: "inbox_log", unblocks: a.unblocks }); return { ok: true };
      case "inbox_status": await log("status", a.text); return { ok: true, shown: true };
      case "inbox_say": {
        if (!(await card(a.thread_id)) && !(await nodeRoot(db, owner, a.thread_id))) {
          if (!(await primaryRoot(db, owner, a.thread_id))) throw new Error("없는 스레드 — 이 사람 보드의 카드 id 나 노드 글 · Primary 내 글 스레드 id 만");
          await log("say", a.text, primaryThread(a.thread_id), { tool: "inbox_say" }); return { msg_id: `${a.thread_id}:${Date.now()}` };
        }
        await log("say", a.text, a.thread_id, { tool: "inbox_say" }); return { msg_id: `${a.thread_id}:${Date.now()}` };
      }
      case "inbox_ask": {
        const id = cardId();
        const kind = KINDS.includes(a.kind) ? String(a.kind) : "decision";   // todo = 사람이 할 일 — 보드 「할 일」 줄로(member-board data)
        // urgent = 지금 사람이 처리해야 함(폰 알림 — 종 칸에서 넓힘을 켠 사람은 새 카드면 다 감, member-push.ts) · orig_at = 밀린 질문의 원래 시각(backlog 만 오면 0 = 옛 글, 시각 모름)
        const urgent = a.urgent === true || a.urgency === "incident", at = Date.now(), orig = askedAt(a.asked_at) ?? (a.backlog === true ? 0 : null);
        await db.prepare("INSERT INTO board_card(id, owner, win, question, choices, recommend, body, at, wid, kind, urgent, orig_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(id, owner, win, a.question, JSON.stringify(a.choices), a.recommend ?? null, a.body ?? null, at, wid, kind, urgent ? 1 : 0, orig).run();
        onCard?.({ id, question: a.question, kind, urgent, at, orig_at: orig });
        const res = { card_id: id, thread_id: id, url: `${publicUrl}/` };
        return a.wait_s ? { ...res, ...(await wait(id, a.wait_s)) } : res;
      }
      case "inbox_wait": return wait(a.card_id, a.timeout_s);
      case "inbox_close": {
        const r = await db.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE id = ? AND owner = ?").bind(a.done, a.card_id, owner).run();
        if (!r.meta.changes) throw new Error("없는 카드");
        return { ok: true };
      }
      case "inbox_cards": {
        const rs = (await db.prepare("SELECT id, state, kind, question, win, at FROM board_card WHERE owner = ? ORDER BY at DESC LIMIT 200").bind(owner).all<{ id: string; state: string; kind: string; question: string; win: string; at: number }>()).results;
        const words = String(a.query || "").toLowerCase().split(/\s+/).filter(Boolean);
        const hit = rs.filter(c => words.every(w => c.question.toLowerCase().includes(w)));
        return { total: hit.length, cards: hit.slice(0, a.limit).map(c => ({ card_id: c.id, state: c.state, kind: c.kind || "decision", title: c.question, thread: c.id })) };
      }
      case "chat_say": {
        if (a.thread === undefined) { await log("say", a.text, "primary", { tool: "chat_say" }); return { ok: true }; }
        if (!(await primaryRoot(db, owner, a.thread))) throw new Error("없는 스레드 — 이 사람 Primary 채팅의 사람 글 id 만");
        await log("say", a.text, primaryThread(a.thread), { tool: "chat_say" }); return { ok: true };
      }
      case "chat_split": {
        const { added, ...r } = await splitAdd(db, owner, a.thread, a.parts);
        if (!send) return r;
        const sent = [];
        for (const p of added) sent.push({ node: p.node, ...(await send(p.pane, splitText(a.thread, p.text, a.why))) });
        return { ...r, sent };
      }
      case "role_draft": {
        const cfg = await db.prepare("SELECT (SELECT rules FROM engine_owner WHERE owner = ?1) rules, (SELECT json_extract(data, '$.rules.one_goal') FROM node_setting WHERE owner = ?1 AND json_valid(data)) og").bind(owner).first<{ rules: string | null; og: number | null }>().catch(() => null);
        let oneGoal = true; try { oneGoal = JSON.parse(cfg?.rules || "{}").one_goal !== false; } catch {}
        if (cfg?.og === 0 || cfg?.og === 1) oneGoal = cfg.og === 1;
        const norm = (t: string) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (oneGoal) {
          const live = (await db.prepare("SELECT r.name, w.id FROM role r JOIN engine_window w ON w.role_id = r.id AND w.owner = r.owner WHERE r.owner = ? AND w.state NOT IN ('closed','failed') AND w.device_id IN (SELECT id FROM device WHERE revoked_at IS NULL)").bind(owner).all<{ name: string; id: string }>()).results;
          const same = live.find(x => norm(x.name) === norm(a.name));
          if (same) return { refused: true, same_role: same.name, window: same.id, why: `「${same.name}」 role already has a window — one role = one goal. Hand the ask to it with chat_split (one part for that role) instead of drafting it again.` };
        }
        const id = `rd_${Date.now().toString(36)}${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`, now = Date.now();
        await db.batch([
          db.prepare("UPDATE role_draft SET state = 'revised', updated_at = ? WHERE owner = ? AND name = ? AND state = 'draft'").bind(now, owner, a.name),   // 같은 이름 초안을 다시 올리면 옛 카드는 「고침」
          db.prepare("INSERT INTO role_draft(id, owner, name, brief, instructions, cwd, by_win, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, owner, a.name, a.brief || "", a.instructions, a.cwd || "", wid ?? win, now, now),
          db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").bind(owner, win, "role", id, "primary", now, wid),
        ]);
        return { draft_id: id, shown: "as a card in the Primary chat — the person approves it there" };
      }
      case "role_list": {
        const [r, w, d] = await db.batch([
          db.prepare("SELECT id, name, intake, source, created_at FROM role WHERE owner = ? ORDER BY created_at DESC LIMIT 50").bind(owner),
          db.prepare("SELECT id, kind, role_id, name, state FROM engine_window WHERE owner = ? AND state NOT IN ('closed','failed') ORDER BY created_at DESC LIMIT 50").bind(owner),
          db.prepare("SELECT id, name, state FROM role_draft WHERE owner = ? AND state = 'draft' ORDER BY created_at DESC LIMIT 20").bind(owner),
        ]);
        return { roles: r.results, windows: w.results, drafts: d.results };
      }
      // 약속(0047 member_promise): 이 회원 것만, 적은 창(win · wid)을 남겨 보드가 그 노드 판에 붙임. 닫기는 내 열린 약속만
      case "promise_add": {
        const r = await db.prepare("INSERT INTO member_promise(owner, win, wid, who, what, check_by, due, at) VALUES (?,?,?,?,?,?,?,?) RETURNING id").bind(owner, win, wid, a.who, a.what, a.check, a.due, Date.now()).first<{ id: number }>();
        return { promise_id: Number(r?.id), shown: "on the person's board under promises" };
      }
      case "promise_done": {
        const r = await db.prepare("UPDATE member_promise SET state = ?, done = ?, done_at = ? WHERE id = ? AND owner = ? AND state = 'open'").bind(a.state, a.done, Date.now(), a.promise_id, owner).run();
        if (!r.meta.changes) throw new Error("없는 약속 — 이 사람 보드의 열린 약속 id 만");
        return { ok: true };
      }
      case "promise_list": {
        const rs = (await db.prepare(`SELECT id, win, who, what, check_by, due, state, done, at FROM member_promise WHERE owner = ?${a.all ? "" : " AND state = 'open'"} ORDER BY at DESC LIMIT 50`).bind(owner).all<Record<string, any>>()).results;
        const now = Date.now();
        return { promises: rs.map(p => ({ promise_id: p.id, who: p.who, what: p.what, check: p.check_by, due: p.due, state: p.state, overdue: p.state === "open" && overdue(p.due, now), win: p.win, ...(p.done ? { done: p.done } : {}) })) };
      }
    }
    throw new Error(`없는 도구: ${name}`);
  };
}
