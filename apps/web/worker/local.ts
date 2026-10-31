const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// 카드 id 는 지금 카드 꼴(초.여섯 자리)과 같게 — 도구 입력 검사(tsId)를 그대로 씀
const cardId = () => `${Math.floor(Date.now() / 1000)}.${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`;
type Card = { id: string; state: string; question: string; choices: string; answer: string | null; answered_at: number | null; done: string | null; win: string; at: number };

export function localTools(db: D1Database, owner: string, win: string, publicUrl: string, key = "", onCard?: (card: { id: string; question: string }) => void) {
  const wid = /:(ew_[a-z0-9]{6,30})$/.exec(key)?.[1] ?? null;
  const log = (kind: string, text: string, thread?: string) =>
    db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").bind(owner, win, kind, text, thread ?? null, Date.now(), wid).run();
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
      case "inbox_log": await log(a.kind, a.text + (a.evidence?.length ? `\n${a.evidence.join("\n")}` : ""), a.thread); return { ok: true };
      case "inbox_status": await log("status", a.text); return { ok: true, shown: true };
      case "inbox_say": {
        if (!(await card(a.thread_id))) throw new Error("없는 스레드(카드) — 이 사람 보드의 카드 id 만");
        await log("say", a.text, a.thread_id); return { msg_id: `${a.thread_id}:${Date.now()}` };
      }
      case "inbox_ask": {
        const id = cardId();
        await db.prepare("INSERT INTO board_card(id, owner, win, question, choices, recommend, body, at, wid) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(id, owner, win, a.question, JSON.stringify(a.choices), a.recommend ?? null, a.body ?? null, Date.now(), wid).run();
        onCard?.({ id, question: a.question });
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
        const rs = (await db.prepare("SELECT id, state, question, win, at FROM board_card WHERE owner = ? ORDER BY at DESC LIMIT 200").bind(owner).all<{ id: string; state: string; question: string; win: string; at: number }>()).results;
        const words = String(a.query || "").toLowerCase().split(/\s+/).filter(Boolean);
        const hit = rs.filter(c => words.every(w => c.question.toLowerCase().includes(w)));
        return { total: hit.length, cards: hit.slice(0, a.limit).map(c => ({ card_id: c.id, state: c.state, kind: "decision", title: c.question, thread: c.id })) };
      }
      case "chat_say": await log("say", a.text, "primary"); return { ok: true };
      case "role_draft": {
        const cfg = await db.prepare("SELECT rules FROM engine_owner WHERE owner = ?").bind(owner).first<{ rules: string | null }>().catch(() => null);
        let oneGoal = true; try { oneGoal = JSON.parse(cfg?.rules || "{}").one_goal !== false; } catch {}
        const norm = (t: string) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (oneGoal) {
          const live = (await db.prepare("SELECT r.name, w.id FROM role r JOIN engine_window w ON w.role_id = r.id AND w.owner = r.owner WHERE r.owner = ? AND w.state NOT IN ('closed','failed') AND w.device_id IN (SELECT id FROM device WHERE revoked_at IS NULL)").bind(owner).all<{ name: string; id: string }>()).results;
          const same = live.find(x => norm(x.name) === norm(a.name));
          if (same) return { refused: true, same_role: same.name, window: same.id, why: `「${same.name}」 role already has a window — one role = one goal. Tell the person to write in that role's channel (it goes to that window) instead of drafting it again.` };
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
    }
    throw new Error(`없는 도구: ${name}`);
  };
}
