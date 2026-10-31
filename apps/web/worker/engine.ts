import { DurableObject } from "cloudflare:workers";
import { bumpMember } from "./live";

export type EngEnv = { DB: D1Database; ENGINE: DurableObjectNamespace<Engine>; PUBLIC_URL: string };
type Win = { id: string; owner: string; device_id: string; kind: string; role_id: string | null; name: string; state: string; state_at: number | null; handle: string | null; woke_at: number | null; created_at: number; dialog: string | null };
type Wait = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export const MODEL = "claude-opus-5-5";
export const RULES = { wake_min: 30, park_min: 30, close_min: 15, one_goal: true };
const LIVE = ["opening", "starting", "busy", "idle", "waiting", "background"];
const rid = (p: string) => p + [...crypto.getRandomValues(new Uint8Array(12))].map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
export const engineOf = (env: EngEnv, device: string) => env.ENGINE.get(env.ENGINE.idFromName(`dev:${device}`));
export class EngineError extends Error { constructor(public code: number, msg: string) { super(msg); } }

// ── 창에 넣는 글(영어 — AI 도구가 가장 잘 따름, 사람에게는 그 사람 말로 쓰라고 함)
export function mainSystem(email: string, name = "Primary", oneGoal = true) {
  return `You are ${name}, the main bot ("Primary") of ${email}'s Boarder — the board where they follow and steer all their AI agent windows.
- What the person writes in Boarder's Primary chat arrives here as a message starting with "[Boarder chat]". Messages starting with "[Boarder]" are notes from Boarder itself.
- The person does not see this terminal. Answer only with \`boarder chat "<text>"\` — short and warm, in the person's language (Korean if they write Korean).
- Your job: learn what they want their AI agents to do, then set up roles. A role is one agent window with one clear job. Propose one role at a time:
  boarder role draft --name "<short name>" --brief "<one line: what it handles>" --instructions "<what this agent does, how it reports, what it must not do>"
  They see it as a card in the chat and press 「이대로」 (Boarder then opens a Claude Code window for it), or tell you what to change — then draft again.
- Don't do the roles' work yourself and don't open windows yourself. \`boarder role list\` shows roles and their windows.${oneGoal ? ONE_GOAL_MAIN : ""}`;
}
export const ONE_GOAL_MAIN = `
- One role = one goal, not one request. Before drafting, run \`boarder role list\`. If a role already covers the same goal (same product or area: polishing a screen, a button that should react at once, an input box, a bug or follow-up there), do not draft a new role — tell the person in one line that 「<role>」 handles it and that writing in that role's channel on the board sends it there. Draft a new role only for a different goal (another product, another area, or a separate long-running goal).`;
export const ONE_GOAL_ROLE = `
This window is one goal. Take related and follow-up requests for that goal here — do not ask for a new window for them. Work through them one at a time; when there is enough to split, split inside this window (subagents, or helper panes for separate front-end and back-end work that does not touch the same files). Ask for a new role only when the work is a different goal.`;
export const MAIN_HELLO = `[Boarder] Boarder just started you as the person's main bot. Greet them in one or two sentences with boarder chat and ask what they would like their AI agents to do.`;
export function rolePrompt(name: string, instructions: string, oneGoal = true) {
  return `[Boarder] You are the "${name}" agent. Your job: ${instructions}${oneGoal ? ONE_GOAL_ROLE : ""}
Report on the person's Boarder board as you work: run \`boarder log start "<one line>"\` now, \`boarder log progress "<where things stand>"\` at each big step, \`boarder ask "<question>" --choice "<A>" --choice "<B>"\` only for decisions they must make, \`boarder log blocked "<why, who can unblock>"\` when stuck, and \`boarder log done "<result>"\` when finished. Write board lines in the person's language. Start now.`;
}
const WAKE = `[Boarder] This window has been quiet for a while. Write where things stand with boarder log progress, then keep going. If you are stuck, boarder log blocked "<why>"; if you are finished, boarder log done "<result>".`;

// 사람마다 설정(묻지 않고 일하기 · 감독 규칙 분)
export async function ownerCfg(db: D1Database, owner: string) {
  const r = await db.prepare("SELECT perm_mode, perm_at, rules FROM engine_owner WHERE owner = ?").bind(owner).first<{ perm_mode: string; perm_at: number | null; rules: string | null }>();
  let rules = { ...RULES }; try { rules = { ...RULES, ...(r?.rules ? JSON.parse(r.rules) : {}) }; } catch {}
  return { perm: r?.perm_mode === "bypass" ? "bypass" as const : "ask" as const, perm_at: r?.perm_at ?? null, rules };
}
// 엔진이 붙어 있는 그 사람 기기(가장 최근 연락, 2분 안)
export async function liveDevice(db: D1Database, owner: string, forPrimary = false) {
  return (await db.prepare(`SELECT id FROM device WHERE owner = ? AND revoked_at IS NULL AND scope = 'full' AND engine_at > ?${forPrimary ? " AND coalesce(json_extract(engine, '$.primary'), 1) != 0" : ""} ORDER BY engine_at DESC LIMIT 1`).bind(owner, Date.now() - 120_000).first<{ id: string }>())?.id || null;
}
async function deviceOk(db: D1Database, device: string, owner: string) {
  const r = await db.prepare("SELECT d.revoked_at, d.scope, (SELECT 1 FROM invite WHERE email = d.owner) inv FROM device d WHERE d.id = ? AND d.owner = ?").bind(device, owner).first<{ revoked_at: number | null; scope: string | null; inv: number | null }>();
  return !!r && !r.revoked_at && (!!r.inv || r.scope === "harness");
}

export const paneWid = (pane: string) => /^%\d{1,7}$/.test(pane) ? `ew_pane${pane.slice(1)}` : null;
export const widPane = (id: string) => { const m = /^ew_pane(\d{1,7})$/.exec(id); return m ? `%${m[1]}` : null; };
const HSTATE = /^(busy|idle|waiting|background|starting|none|parked)$/;
type HPend = { k?: string; id: string; text: string; at: number; test?: boolean; sending?: number };
const HCMD_MS = 160_000;
type Pend = { id: string; text: string; at: number };
export const sysLine = (db: D1Database, owner: string, text: string, wid?: string) =>
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").bind(owner, "보더", "sys", text, "primary", Date.now(), wid ?? null).run();

export class Engine extends DurableObject<EngEnv> {
  wait = new Map<string, Wait>();
  constructor(ctx: DurableObjectState, env: EngEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));   // 데몬 30초 ping — DO 를 깨우지 않음
  }
  // 데몬의 WebSocket(기기 토큰 · 회원 확인은 Worker 가 이미 함)
  async fetch(req: Request) {
    if (req.headers.get("upgrade") !== "websocket") return new Response("no", { status: 426 });
    const device = req.headers.get("x-bx-device") || "", owner = req.headers.get("x-bx-owner") || "", harness = req.headers.get("x-bx-harness") === "1";
    for (const old of this.ctx.getWebSockets()) try { old.close(1012, "새 데몬"); } catch {}
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ device, owner, at: Date.now() });
    await this.ctx.storage.put("who", { device, owner, harness });
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  sock() { return this.ctx.getWebSockets().filter(w => !(w.readyState >= 2)).sort((a, b) => ((b.deserializeAttachment() as { at: number })?.at || 0) - ((a.deserializeAttachment() as { at: number })?.at || 0))[0]; }
  online() { return !!this.sock(); }
  /** 기기 폐기 · 초대 빠짐: 데몬에 4401(데몬은 끝내고 다시 안 뜸), 규칙 알람 멈춤 */
  async revoke() {
    for (const w of this.ctx.getWebSockets()) try { w.close(4401, "revoked"); } catch {}
    await this.ctx.storage.deleteAlarm(); await this.ctx.storage.delete("pending"); await this.ctx.storage.delete("hpending");
    return { ok: true };
  }
  async pend(p: Pend) { const q = (await this.ctx.storage.get<Pend[]>("pending")) || []; q.push(p); await this.ctx.storage.put("pending", q.slice(-50)); return { queued: true }; }
  async who() { return (await this.ctx.storage.get<{ device: string; owner: string; harness?: boolean }>("who")) || { device: "", owner: "", harness: false }; }

  /** 기기에서 동사 하나 — 답(result)이나 EngineError(code 1 실패 · 2 바쁨 · 4 없음 · 5 못 하는 동사) */
  cmd(verb: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<any> {
    const ws = this.sock();
    if (!ws) return Promise.reject(new EngineError(1, "엔진이 꺼져 있어요"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wait.delete(id); reject(new EngineError(1, "엔진 답 없음")); }, timeoutMs);
      this.wait.set(id, { resolve, reject, timer });
      try { ws.send(JSON.stringify({ id, op: "cmd", verb, args })); } catch (e) { clearTimeout(timer); this.wait.delete(id); reject(new EngineError(1, String(e))); }
    });
  }

  async webSocketMessage(_ws: WebSocket, msg: string | ArrayBuffer) {
    if (typeof msg !== "string" || msg.length > 256_000) return;
    let m: any; try { m = JSON.parse(msg); } catch { return; }
    if (m.id && this.wait.has(m.id)) {
      const w = this.wait.get(m.id)!; clearTimeout(w.timer); this.wait.delete(m.id);
      return m.ok ? w.resolve(m.result) : w.reject(new EngineError(Number(m.code) || 1, String(m.error || "실패").slice(0, 300)));
    }
    const { device, owner, harness } = await this.who(); if (!device) return;
    const db = this.env.DB, now = Date.now();
    if (m.type === "hello" && !(await deviceOk(db, device, owner))) { await this.revoke(); return; }
    if (harness) return this.hmsg(m, device, owner, now);
    if (m.type === "hello") {
      const eng = { cli: String(m.cli || "").slice(0, 20), host: String(m.host || "").slice(0, 60), os: String(m.os || "").slice(0, 20), default: m.default ? String(m.default).slice(0, 30) : null, primary: m.primary !== false,
        engines: Object.fromEntries(Object.entries(m.engines || {}).slice(0, 8).map(([k, v]: [string, any]) => [k.slice(0, 30), { caps: Array.isArray(v?.caps) ? v.caps.filter((x: unknown) => typeof x === "string").slice(0, 8) : null }])) };
      await db.prepare("UPDATE device SET engine = ?, engine_at = ? WHERE id = ?").bind(JSON.stringify(eng), now, device).run();
      // 기기에 없는 창(재부팅 · tmux 꺼짐)은 gone — 손잡이가 있으니 채팅 · 카드 답이 오면 다시 열림
      const have = new Set((Array.isArray(m.windows) ? m.windows : []).map((w: any) => String(w.id)));
      const rows = (await db.prepare(`SELECT id FROM engine_window WHERE device_id = ? AND state IN (${LIVE.map(() => "?").join(",")})`).bind(device, ...LIVE).all<{ id: string }>()).results;
      for (const r of rows) if (!have.has(r.id) && r.id) await db.prepare("UPDATE engine_window SET state = 'gone', state_at = ? WHERE id = ?").bind(now, r.id).run();
      // 서버가 이미 닫은 창(다른 기기로 옮긴 메인 봇 · 못 연 창)이 기기에 아직 있으면 닫음
      const dead = new Set((await db.prepare("SELECT id FROM engine_window WHERE device_id = ? AND state IN ('closed','failed')").bind(device).all<{ id: string }>()).results.map(r => r.id));
      for (const id of have) if (dead.has(id as string)) this.ctx.waitUntil(this.cmd("close", { id }, 90_000).catch(() => null));
      if (m.primary === false) {   // 이 기기는 Primary 자리가 아님: 여기 떠 있던 Primary 는 닫고(다음 채팅 때 다른 엔진 기기에서 뜸), 새로 띄우지 않음
        const mine = (await db.prepare("SELECT id FROM engine_window WHERE owner = ? AND device_id = ? AND kind = 'main' AND state NOT IN ('closed','failed')").bind(owner, device).all<{ id: string }>()).results;
        for (const w of mine) await this.close(w.id).catch(() => null);
      } else await this.ensureMain(owner, device);
      await this.flush();   // 꺼져 있던 동안 쌓인 채팅 · 카드 답
      this.ctx.waitUntil(this.drainCmds().catch(() => null));
      this.ctx.waitUntil(bumpMember(this.env as never, owner));
      return;
    }
    if (m.type === "state" || m.type === "event") {
      const list = m.type === "event" ? [m] : Array.isArray(m.windows) ? m.windows.slice(0, 50) : [];
      for (const w of list) {
        const st = String(w.state || ""); if (!/^(busy|idle|waiting|background|starting|none)$/.test(st) || !/^ew_[a-z0-9]{6,30}$/.test(String(w.id))) continue;
        const next = st === "none" ? "gone" : st;
        await db.prepare("UPDATE engine_window SET state = ?, state_at = CASE WHEN state = ? THEN state_at ELSE ? END, dialog = ?, note = COALESCE(?, note) WHERE id = ? AND device_id = ? AND state NOT IN ('parked','closed','failed')")
          .bind(next, next, now, w.dialog ? String(w.dialog).slice(0, 20) : null, w.limit ? String(w.limit).slice(0, 200) : null, String(w.id), device).run();
      }
      await db.prepare("UPDATE device SET engine_at = ? WHERE id = ?").bind(now, device).run();
      if (list.some((w: any) => w.state === "idle")) await this.flush();   // 쉬게 된 창에 밀린 글
      if (list.length) this.ctx.waitUntil(this.drainCmds().catch(() => null));   // 바빠서 못 넣은 사람 글 다시
      if (list.length) this.ctx.waitUntil(bumpMember(this.env as never, owner));
    }
  }
  async webSocketClose(ws: WebSocket) { try { ws.close(1011, "닫힘"); } catch {} }
  async webSocketError(ws: WebSocket) { await this.webSocketClose(ws); }

  async row(id: string) { return this.env.DB.prepare("SELECT * FROM engine_window WHERE id = ?").bind(id).first<Win>(); }
  async open(o: { owner: string; kind: "main" | "role"; role_id?: string | null; name: string; cwd: string; prompt: string; system?: string; email?: string; config_dir?: string }) {
    const { device, harness } = await this.who(), db = this.env.DB, now = Date.now(), id = rid("ew_");
    if (harness) throw new EngineError(5, "주인 하네스 기기는 서버가 창을 열지 않아요");
    const cfg = await ownerCfg(db, o.owner);
    const spec = { id, name: o.name, cwd: o.cwd, model: MODEL, perm: cfg.perm, ...(o.system ? { system: o.system } : {}), ...(o.config_dir ? { config_dir: o.config_dir } : {}), session_id: crypto.randomUUID() };
    await db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, state_at, handle, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, o.owner, device, o.kind, o.role_id ?? null, o.name, "opening", now, JSON.stringify({ engine: "tmux", ...spec }), now).run();
    try {
      const r = await this.cmd("open", { spec: { ...spec, prompt: o.prompt } });
      await db.prepare("UPDATE engine_window SET state = 'starting', state_at = ?, handle = ? WHERE id = ?").bind(Date.now(), JSON.stringify({ engine: "tmux", ...spec, session_id: r?.session_id || spec.session_id }), id).run();
      return { id };
    } catch (e) {
      await db.prepare("UPDATE engine_window SET state = 'failed', state_at = ?, note = ? WHERE id = ?").bind(Date.now(), String((e as Error).message).slice(0, 200), id).run();
      throw e;
    }
  }
  async ensureMain(owner: string, device: string) {
    const db = this.env.DB;
    const main = await db.prepare("SELECT id, state, device_id FROM engine_window WHERE owner = ? AND kind = 'main' AND state NOT IN ('closed','failed') ORDER BY created_at DESC LIMIT 1").bind(owner).first<{ id: string; state: string; device_id: string }>();
    if (main) return main.id;
    const bot = await db.prepare("SELECT name FROM member_bot WHERE owner = ?").bind(owner).first<{ name: string }>().catch(() => null);
    const name = bot?.name || "Primary";
    const { rules } = await ownerCfg(db, owner).catch(() => ({ rules: RULES }));
    const r = await this.open({ owner, kind: "main", name, cwd: "~/boarder/primary", prompt: MAIN_HELLO, system: mainSystem(owner, name, rules.one_goal !== false) }).catch(() => null);
    if (r) await sysLine(db, owner, "메인 봇이 이 기기에서 시작했어요", r.id);
    return r?.id || null;
  }
  async deliver(id: string, text: string) {
    const w = await this.row(id); if (!w) throw new EngineError(4, "없는 창");
    if (w.state === "closed" || w.state === "failed") throw new EngineError(4, "닫힌 창이에요");
    if (w.state === "parked" || w.state === "gone") return this.reopen(id, text);
    if (w.state === "opening" || w.state === "starting" || !this.online()) return this.pend({ id, text, at: Date.now() });
    try { await this.cmd("send", { id, text }); return { sent: true }; }
    catch (e) {
      const code = (e as EngineError).code;
      if (code === 2 || !this.online()) return this.pend({ id, text, at: Date.now() });
      if (code === 4) { await this.env.DB.prepare("UPDATE engine_window SET state = 'gone', state_at = ? WHERE id = ? AND state NOT IN ('closed','failed','parked')").bind(Date.now(), id).run(); return this.reopen(id, text); }
      // 글 넣기가 없는 엔진(caps 에 send 없음, 16쪽 ②): 닫고 같은 손잡이로 그 글과 함께 새로 돌림
      if (code === 5) { await this.cmd("close", { id }).catch(() => null); await this.env.DB.prepare("UPDATE engine_window SET state = 'gone', state_at = ? WHERE id = ?").bind(Date.now(), id).run(); return this.reopen(id, text); }
      throw e;
    }
  }
  draining = false; drainAgain = false;
  async drainCmds() {
    if (this.draining) { this.drainAgain = true; return { started: false }; }
    this.ctx.waitUntil(this.drainRun().catch(e => console.log(JSON.stringify({ ev: "engine_drain", error: String(e).slice(0, 200) }))));
    return { started: true };
  }
  private async drainRun() {
    if (this.draining || !this.online()) return;
    this.draining = true;
    try {
      const { device } = await this.who(), db = this.env.DB; if (!device) return;
      await db.prepare("UPDATE engine_cmd SET state = 'failed', result = '오래돼 안 넣음', done_at = ? WHERE device_id = ? AND state = 'queued' AND verb IN ('send', 'reopen') AND at < ? AND json_extract(args, '$.post') = 1").bind(Date.now(), device, Date.now() - 6 * 3600_000).run();
      do {
        this.drainAgain = false;
        const rows = (await db.prepare(`SELECT id, args FROM engine_cmd c WHERE device_id = ? AND state = 'queued' AND verb = 'send' AND json_extract(args, '$.post') = 1
          AND json_extract(args, '$.engine') NOT LIKE '%-own' AND json_extract(args, '$.handle.id') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM engine_cmd r WHERE r.device_id = c.device_id AND r.verb = 'reopen' AND r.state IN ('queued', 'taken') AND json_extract(r.args, '$.item') = json_extract(c.args, '$.item'))
          ORDER BY at LIMIT 20`).bind(device).all<{ id: string; args: string }>()).results;
        const held = new Set<string>();
        for (const r of rows) {
          const a = JSON.parse(r.args) as { engine: string; handle: { id: string }; text?: string }, id = a.handle.id;
          if (!a.text || held.has(id)) continue;
          const w = await this.row(id).catch(() => null);
          if (w && (w.state === "opening" || w.state === "starting")) { held.add(id); continue; }
          if (!await db.prepare("UPDATE engine_cmd SET state = 'sending', taken_at = ? WHERE id = ? AND state = 'queued' RETURNING id").bind(Date.now(), r.id).first()) continue;
          try {
            await this.cmd("send", { id, engine: a.engine, text: a.text });
            await db.prepare("UPDATE engine_cmd SET state = 'done', done_at = ? WHERE id = ?").bind(Date.now(), r.id).run();
          } catch (e) {
            const err = e as EngineError, off = err.message === "엔진이 꺼져 있어요", busy = err.code === 2;
            await db.prepare("UPDATE engine_cmd SET state = ?, result = ?, done_at = ? WHERE id = ?").bind(busy || off ? "queued" : "failed", String(err.message || err).slice(0, 300), busy || off ? null : Date.now(), r.id).run();
            if (off) return;
            if (busy) held.add(id);
          }
        }
      } while (this.drainAgain);
    } finally { this.draining = false; }
  }
  /** 밀린 글: 그 창이 쉬는 중일 때만 넣음(뜨는 중엔 입력칸이 없어 글이 사라짐) */
  async flush() {
    if (!this.online()) return;
    const q = (await this.ctx.storage.get<Pend[]>("pending")) || []; if (!q.length) return;
    const left: Pend[] = [];
    for (const p of q) {
      if (Date.now() - p.at > 6 * 3600_000) continue;
      const w = await this.row(p.id);
      if (!w || w.state === "closed" || w.state === "failed") continue;
      if (w.state === "parked" || w.state === "gone") { try { await this.reopen(p.id, p.text); } catch { left.push(p); } continue; }
      if (w.state !== "idle") { left.push(p); continue; }
      try { await this.cmd("send", { id: p.id, text: p.text }); } catch (e) { if ((e as EngineError).code !== 4) left.push(p); }
    }
    await this.ctx.storage.put("pending", left);
  }
  async park(id: string, why = "") {
    const w = await this.row(id); if (!w || !LIVE.includes(w.state)) return { ok: false };
    let r: any;
    try { r = await this.cmd("park", { id }); }
    catch (e) { if ((e as EngineError).code === 5) { await this.env.DB.prepare("UPDATE engine_window SET note = ? WHERE id = ?").bind("이 엔진은 주차를 못 해요 — 열어 둠", id).run(); return { ok: false, cannot: true }; } throw e; }
    const old = (() => { try { return JSON.parse(w.handle || "{}"); } catch { return {}; } })();
    await this.env.DB.prepare("UPDATE engine_window SET state = 'parked', state_at = ?, handle = ?, note = ? WHERE id = ?").bind(Date.now(), JSON.stringify({ ...old, ...(r?.handle || {}), argv: undefined }), why || null, id).run();
    return { ok: true };
  }
  async reopen(id: string, text = "") {
    const w = await this.row(id); if (!w) throw new EngineError(4, "없는 창");
    const h = (() => { try { return JSON.parse(w.handle || "{}"); } catch { return {}; } })();
    if (!h.session_id) throw new EngineError(1, "다시 열 손잡이가 없어요");
    if (!this.online()) return text ? this.pend({ id, text, at: Date.now() }) : (() => { throw new EngineError(1, "엔진이 꺼져 있어요"); })();
    const claim = await this.env.DB.prepare("UPDATE engine_window SET state = 'starting', state_at = ?, woke_at = NULL, note = NULL WHERE id = ? AND state IN ('parked','gone')").bind(Date.now(), id).run();
    if (!claim.meta.changes) { if (text && LIVE.includes((await this.row(id))?.state || "")) return this.pend({ id, text, at: Date.now() }); throw new EngineError(1, "다시 열 수 없는 창이에요"); }
    const cfg = await ownerCfg(this.env.DB, w.owner);
    try { await this.cmd("reopen", { id, handle: { ...h, perm: cfg.perm }, text: text || `[Boarder] This window was parked and is open again. Continue from your last board line.` }); }
    catch (e) { await this.env.DB.prepare("UPDATE engine_window SET state = ?, state_at = ?, note = ? WHERE id = ?").bind(w.state, Date.now(), String((e as Error).message).slice(0, 200), id).run(); throw e; }
    return { reopened: true };
  }
  async close(id: string) {
    const w = await this.row(id); if (!w) return { ok: false };
    if (LIVE.includes(w.state)) await this.cmd("close", { id }, 90_000).catch(() => null);
    await this.env.DB.prepare("UPDATE engine_window SET state = 'closed', state_at = ?, closed_at = ? WHERE id = ?").bind(Date.now(), Date.now(), id).run();
    return { ok: true };
  }

  async hmsg(m: any, device: string, owner: string, now: number) {
    const db = this.env.DB;
    if (m.type === "hello") {
      const eng = { cli: String(m.cli || "").slice(0, 20), host: String(m.host || "").slice(0, 60), os: String(m.os || "").slice(0, 20), default: m.default ? String(m.default).slice(0, 30) : null, harness: true };
      await db.prepare("UPDATE device SET engine = ?, engine_at = ? WHERE id = ?").bind(JSON.stringify(eng), now, device).run();
      await this.hsync(Array.isArray(m.windows) ? m.windows : [], !m.partial, device, owner, now);
      await db.prepare("DELETE FROM engine_window WHERE owner = ? AND kind = 'harness' AND state = 'closed' AND closed_at < ?").bind(owner, now - 7 * 86400_000).run();
      await this.ctx.storage.setAlarm(now + 60_000);
      this.hflush();
      return;
    }
    if (m.type !== "state" && m.type !== "event") return;
    if (m.type === "event" && m.fail && widPane(String(m.id || ""))) {
      const note = String(m.limit || "보드 글을 못 넣었어요").slice(0, 200);
      const u = await db.prepare("UPDATE engine_window SET note = ?, state_at = ? WHERE id = ? AND owner = ? AND kind = 'harness'").bind(note, now, String(m.id), owner).run();
      if (!u.meta.changes) await db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, note, created_at) VALUES (?,?,?,'harness',?,'gone',?,?,?) ON CONFLICT(id) DO NOTHING").bind(String(m.id), owner, device, String(m.id), now, note, now).run();
      return;
    }
    await this.hsync(m.type === "event" ? [m] : Array.isArray(m.windows) ? m.windows : [], m.type === "state" && !!m.full && !m.partial, device, owner, now);
    await db.prepare("UPDATE device SET engine_at = ? WHERE id = ?").bind(now, device).run();
    this.hflush();   // 기다리지 않음 — 넣기(pane-tell)가 길어도 상태 받기는 계속
  }
  async hsync(list: any[], full: boolean, device: string, owner: string, now: number) {
    const db = this.env.DB, seen: string[] = [], stmts: D1PreparedStatement[] = [];
    for (const w of list.slice(0, 300)) {
      const id = String(w?.id || ""), st = String(w?.state || "starting");
      if (!widPane(id) || !HSTATE.test(st)) continue;
      seen.push(id);
      const meta = w.meta && typeof w.meta === "object" ? JSON.stringify(w.meta).slice(0, 800) : null;
      const name = w.name ? String(w.name).replace(/[\x00-\x1f]/g, " ").slice(0, 80) : null;
      const next = st === "none" ? "gone" : st;
      stmts.push(db.prepare(`INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, dialog, note, handle, created_at) VALUES (?,?,?,'harness',?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET device_id = excluded.device_id, state = excluded.state, state_at = CASE WHEN engine_window.state = excluded.state THEN engine_window.state_at ELSE excluded.state_at END,
          dialog = excluded.dialog, note = COALESCE(excluded.note, engine_window.note), name = COALESCE(?, engine_window.name), handle = COALESCE(?, engine_window.handle), closed_at = NULL
        WHERE engine_window.owner = excluded.owner AND engine_window.kind = 'harness'`)
        .bind(id, owner, device, name || id, next, now, w.dialog ? String(w.dialog).slice(0, 20) : null, w.limit ? String(w.limit).slice(0, 200) : null, meta, now, name, meta));
    }
    if (full) {
      const live = (await db.prepare("SELECT id FROM engine_window WHERE owner = ? AND kind = 'harness' AND state NOT IN ('closed')").bind(owner).all<{ id: string }>()).results;
      if (seen.length) for (const r of live) if (!seen.includes(r.id)) stmts.push(db.prepare("UPDATE engine_window SET state = 'closed', state_at = ?, closed_at = ? WHERE id = ? AND kind = 'harness'").bind(now, now, r.id));
    }
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  }
  /** 주인 판에 글: 어댑터가 pane-tell 로 넣음. 바쁨(입력칸에 친 글 · 확인창)은 { busy } — queue 면 줄 세워 상태가 올 때마다 다시(10분) */
  async hsend(id: string, text: string, o: { test?: boolean; queue?: boolean } = {}) {
    if (!(await this.who()).harness) throw new EngineError(1, "하네스 기기가 아니에요");
    if (!this.online()) { if (o.queue) return this.hpend({ id, text, at: Date.now(), test: o.test }); return { offline: true }; }
    try { const r = await this.cmd("send", { id, text, ...(o.test ? { test: true } : {}) }, HCMD_MS); return { sent: true, to: r?.to || widPane(id), ...(r?.reopening ? { reopening: true } : {}) }; }
    catch (e) {
      if ((e as EngineError).code !== 2) throw e;
      return o.queue ? this.hpend({ id, text, at: Date.now(), test: o.test }) : { busy: true };
    }
  }
  /** 운영 확인: 산 소켓 수 · 밀린 글 수(D1 engine_at 은 2분 늦을 수 있음 — 이게 진짜 붙음) */
  async hstatus() {
    const all = this.ctx.getWebSockets();
    return { sockets: all.length, open: all.filter(w => !(w.readyState >= 2)).length, online: this.online(), pending: ((await this.ctx.storage.get<HPend[]>("hpending")) || []).length };
  }
  async hpend(p: HPend) { const q = (await this.ctx.storage.get<HPend[]>("hpending")) || []; q.push({ ...p, k: crypto.randomUUID() }); await this.ctx.storage.put("hpending", q.slice(-50)); await this.ctx.storage.setAlarm(Date.now() + 10_000); return { queued: true }; }
  async hmark(k: string | undefined, sending: number | undefined) { const q = (await this.ctx.storage.get<HPend[]>("hpending")) || []; await this.ctx.storage.put("hpending", q.map(x => x.k === k ? { ...x, sending } : x)); }
  async hdrop(k?: string) { const q = (await this.ctx.storage.get<HPend[]>("hpending")) || []; await this.ctx.storage.put("hpending", q.filter(x => x.k !== k)); }
  hflushing = false;
  async hflush() {
    if (this.hflushing || !this.online()) return;
    this.hflushing = true;
    try {
      const q = (await this.ctx.storage.get<HPend[]>("hpending")) || [], held = new Set<string>();
      for (const p of q.filter(x => x.sending)) {
        await this.env.DB.prepare("UPDATE engine_window SET note = ? WHERE id = ? AND kind = 'harness'").bind(`보드 글을 못 넣었을 수 있어요(보내는 중 서버가 다시 뜸): ${p.text.slice(0, 100)}`, p.id).run();
        await this.hdrop(p.k);
      }
      for (const p of q.filter(x => !x.sending)) {
        if (!this.online()) break;
        if (held.has(p.id)) continue;
        if (Date.now() - p.at > 10 * 60_000) {
          await this.env.DB.prepare("UPDATE engine_window SET note = ? WHERE id = ? AND kind = 'harness'").bind(`보드 글을 10분 동안 못 넣었어요: ${p.text.slice(0, 120)}`, p.id).run();
          await this.hdrop(p.k); continue;
        }
        await this.hmark(p.k, Date.now());
        try { await this.cmd("send", { id: p.id, text: p.text, ...(p.test ? { test: true } : {}) }, HCMD_MS); }
        catch (e) {
          if ((e as EngineError).code === 2 || (!this.online() && /꺼져/.test((e as Error).message))) { held.add(p.id); await this.hmark(p.k, undefined); continue; }   // 바쁨 · 보내기 전 끊김만 다시
          await this.env.DB.prepare("UPDATE engine_window SET note = ? WHERE id = ? AND kind = 'harness'").bind(`보드 글을 못 넣었을 수 있어요(${String((e as Error).message).slice(0, 60)}): ${p.text.slice(0, 100)}`, p.id).run();
        }
        await this.hdrop(p.k);
      }
    } finally { this.hflushing = false; }
  }

  // ── 감독 규칙(B-5, 1분마다 · 데몬이 붙어 있을 때만)
  async alarm() {
    const { device, owner } = await this.who();
    if (!device || !this.online()) return;   // 데몬이 붙으면 fetch 가 다시 건다
    if (!(await deviceOk(this.env.DB, device, owner))) { await this.revoke(); return; }
    if ((await this.who()).harness) { await this.hflush(); await this.ctx.storage.setAlarm(Date.now() + ((await this.ctx.storage.get<HPend[]>("hpending"))?.length ? 10_000 : 60_000)); return; }
    try { await this.rules(device, owner); } catch {}
    try { await this.flush(); } catch {}
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
  }
  async rules(device: string, owner: string, now = Date.now()) {
    const db = this.env.DB, { rules } = await ownerCfg(db, owner), done: string[] = [];
    const rows = (await db.prepare("SELECT * FROM engine_window WHERE device_id = ? AND kind = 'role' AND state IN ('idle','background','busy')").bind(device).all<Win>()).results;
    for (const w of rows) {
      const last = await db.prepare("SELECT kind, at FROM board_log WHERE owner = ? AND wid = ? AND kind IN ('start','progress','blocked','done','decision','incident','deadline') ORDER BY at DESC LIMIT 1").bind(owner, w.id).first<{ kind: string; at: number }>();
      const card = await db.prepare("SELECT waited_at FROM board_card WHERE owner = ? AND wid = ? AND state = 'open' ORDER BY at DESC LIMIT 1").bind(owner, w.id).first<{ waited_at: number | null }>();
      const waiting = !!card && (card.waited_at || 0) > now - 120_000;
      if (w.state === "busy" && !waiting) continue;   // 그냥 일하는 중
      const since = Math.max(w.state_at || 0, last?.at || 0, w.created_at), quiet = now - since;
      const idle = w.state === "idle";
      if (idle && last?.kind === "done" && quiet >= rules.close_min * 60_000) {
        if (rules.one_goal !== false) {
          if (!(await this.park(w.id, "끝 — 같은 목표 일이 오면 다시 열림")).ok) continue;
          await sysLine(db, owner, `「${w.name}」 창이 일을 끝내고 쉬어요 — 이 역할 채널에 쓰면 다시 열려요`, w.id); done.push(`park-done ${w.id}`); continue;
        }
        await this.close(w.id); await sysLine(db, owner, `「${w.name}」 창이 일을 끝내고 닫혔어요`, w.id); done.push(`close ${w.id}`); continue;
      }
      if ((last?.kind === "blocked" || card) && quiet >= rules.park_min * 60_000) {
        if (!(await this.park(w.id, card ? "사람 답 기다림" : "막힘")).ok) continue;
        await sysLine(db, owner, `「${w.name}」 창을 주차했어요 — ${card ? "질문에 답하면" : "채팅으로 말하면"} 다시 열려요`, w.id); done.push(`park ${w.id}`); continue;
      }
      if (idle && last?.kind !== "blocked" && last?.kind !== "done" && !card && now - Math.max(since, w.woke_at || 0) >= rules.wake_min * 60_000) {
        try { await this.cmd("send", { id: w.id, text: WAKE }); await db.prepare("UPDATE engine_window SET woke_at = ? WHERE id = ?").bind(now, w.id).run(); done.push(`wake ${w.id}`); } catch {}
      }
    }
    return done;
  }
}

const OKDEV = "AND device_id IN (SELECT id FROM device WHERE revoked_at IS NULL)";
export async function deliverTo(env: EngEnv, owner: string, wid: string, text: string) {
  const w = await env.DB.prepare(`SELECT device_id FROM engine_window WHERE id = ? AND owner = ? ${OKDEV}`).bind(wid, owner).first<{ device_id: string }>();
  if (!w) throw new EngineError(4, "없는 창");
  return engineOf(env, w.device_id).deliver(wid, text);
}
async function mainOf(env: EngEnv, owner: string) {
  return env.DB.prepare(`SELECT w.id, w.device_id, d.engine_at FROM engine_window w JOIN device d ON d.id = w.device_id WHERE w.owner = ? AND w.kind = 'main' AND w.state NOT IN ('closed','failed') AND d.revoked_at IS NULL ORDER BY (d.engine_at > ?) DESC, w.created_at DESC LIMIT 1`).bind(owner, Date.now() - 120_000).first<{ id: string; device_id: string; engine_at: number | null }>();
}
/** 회원 Primary 채팅 글 → 메인 봇 판(없으면 엔진 기기에서 새로) */
export async function chatToMain(env: EngEnv, owner: string, text: string) {
  const main = await mainOf(env, owner), msg = `[Boarder chat] ${text}`;
  const dev = await liveDevice(env.DB, owner, true);
  if (main && (!dev || Date.now() - (main.engine_at || 0) < 120_000)) return engineOf(env, main.device_id).deliver(main.id, msg);
  if (!dev) return { offline: true };
  if (main) await env.DB.prepare("UPDATE engine_window SET state = 'closed', state_at = ?, closed_at = ?, note = ? WHERE id = ?").bind(Date.now(), Date.now(), "다른 기기로 옮김", main.id).run();   // 옛 기기 창은 그 데몬이 다시 붙을 때 hello 가 닫음
  const stub = engineOf(env, dev), id = await stub.ensureMain(owner, dev);
  if (id) await stub.deliver(id, msg);
  return { started: !!id };
}
export async function noteMain(env: EngEnv, owner: string, text: string) {
  const main = await mainOf(env, owner);
  return main ? engineOf(env, main.device_id).deliver(main.id, text) : null;
}
export async function approveDraft(env: EngEnv, owner: string, draftId: string) {
  const db = env.DB, d = await db.prepare("SELECT * FROM role_draft WHERE id = ? AND owner = ?").bind(draftId, owner).first<{ id: string; name: string; brief: string; instructions: string; cwd: string; state: string }>();
  if (!d) throw new EngineError(4, "없는 초안");
  const dev = await liveDevice(db, owner);
  if (!dev) throw new EngineError(1, "엔진이 켜진 기기가 없어요");
  const now = Date.now(), roleId = rid("r_");
  const claim = await db.prepare("UPDATE role_draft SET state = 'approved', role_id = ?, updated_at = ? WHERE id = ? AND owner = ? AND state = 'draft'").bind(roleId, now, d.id, owner).run();
  if (!claim.meta.changes) throw new EngineError(1, "이미 정한 초안이에요");
  const cwd = d.cwd || `~/boarder/${roleId}`;
  await db.prepare("INSERT INTO role(owner, id, name, instructions, intake, engine, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(owner, roleId, d.name, d.instructions, d.brief, JSON.stringify({ device: dev, engine: "tmux", model: MODEL, cwd }), "bot", now, now).run();
  let w: { id: string };
  const { rules } = await ownerCfg(db, owner).catch(() => ({ rules: RULES }));
  try { w = await engineOf(env, dev).open({ owner, kind: "role", role_id: roleId, name: d.name, cwd, prompt: rolePrompt(d.name, d.instructions, rules.one_goal !== false) }); }
  catch (e) {
    await db.batch([db.prepare("UPDATE role_draft SET state = 'draft', role_id = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), d.id), db.prepare("DELETE FROM role WHERE owner = ? AND id = ?").bind(owner, roleId)]);
    throw e;
  }
  await sysLine(db, owner, `「${d.name}」 창을 열었어요`, w.id);
  await noteMain(env, owner, `[Boarder] The person approved the role "${d.name}" and Boarder opened its window. Tell them in one line with boarder chat.`).catch(() => null);   // 메인 봇도 알게
  return { role_id: roleId, window: w.id };
}

export async function harnessDevice(db: D1Database) {
  return db.prepare("SELECT id, owner, engine_at FROM device WHERE scope = 'harness' AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").first<{ id: string; owner: string; engine_at: number | null }>();
}
export async function engineSend(env: EngEnv, pane: string, text: string, o: { test?: boolean; queue?: boolean } = {}) {
  const id = paneWid(pane); if (!id) throw new EngineError(4, "판 번호(%N)만");
  const d = await harnessDevice(env.DB);
  if (!d || (!o.queue && Date.now() - (d.engine_at || 0) > 120_000)) return { offline: true };
  type Sent = { sent?: boolean; to?: string; busy?: boolean; queued?: boolean; offline?: boolean; reopening?: boolean };
  return (engineOf(env, d.id) as unknown as { hsend: (id: string, text: string, o: object) => Promise<Sent> }).hsend(id, text, o);   // RPC 스텁 형이 너무 깊어(TS2589) 모양만
}
export async function ownerWindows(env: EngEnv) {
  const d = await harnessDevice(env.DB); if (!d) return { online: false, windows: [] };
  const rows = (await env.DB.prepare("SELECT id, name, state, state_at, dialog, note, handle FROM engine_window WHERE device_id = ? AND kind = 'harness' AND state != 'closed' ORDER BY id").bind(d.id).all<{ id: string; name: string; state: string; state_at: number; dialog: string | null; note: string | null; handle: string | null }>()).results;
  return { online: Date.now() - (d.engine_at || 0) < 120_000, at: d.engine_at, windows: rows.map(r => ({ id: r.id, pane: widPane(r.id), name: r.name, state: r.state, since: r.state_at, dialog: r.dialog, note: r.note, meta: (() => { try { return JSON.parse(r.handle || "null"); } catch { return null; } })() })) };
}
