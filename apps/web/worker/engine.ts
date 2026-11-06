import { isAdmin } from "./who";
import { f7On } from "./ledger";
import { boardHead, stripHead } from "./board-head";
import { DurableObject } from "cloudflare:workers";
import { bumpMember } from "./live";
import { envelopeOn, getDek, openField, sealFieldNow, type VaultEnv } from "./vault/index";
import { primaryPick, type Item } from "./importer/group";
import { readPrefs } from "./node-prefs";
import { readPrompts } from "./person-custom";

export type EngEnv = { DB: D1Database; ENGINE: DurableObjectNamespace<Engine>; PUBLIC_URL: string };
type Win = { id: string; owner: string; device_id: string; kind: string; role_id: string | null; name: string; state: string; state_at: number | null; handle: string | null; woke_at: number | null; created_at: number; dialog: string | null };
type Wait = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export const MODEL = "claude-opus-5-5";
export const RULES = { wake_min: 30, park_min: 30, close_min: 15, one_goal: true, default_roles: false };
const LIVE = ["opening", "starting", "busy", "idle", "waiting", "background"];
/** 봉투 스위치 이름의 사람(주인 메일들 → '' = envelope:owner) — 엔진 DO 는 기기 주인 메일을 들고 있음 */
export const flagOwner = (env: { ALLOW_EMAILS?: string }, owner: string) => isAdmin(env, owner) ? "" : owner;
const hhmm = (at: number) => new Date(at).toISOString().slice(11, 16) + " UTC";
export const hNote = (db: D1Database, id: string, why: string, at: number) =>
  db.prepare("UPDATE engine_window SET note = ? WHERE id = ? AND kind = 'harness'").bind(`보드 글을 못 넣었을 수 있어요(${String(why).slice(0, 60)}) — ${hhmm(at)} 에 보낸 글`, id).run();
export const rid = (p: string) => p + [...crypto.getRandomValues(new Uint8Array(12))].map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
export const engineOf = (env: EngEnv, device: string) => env.ENGINE.get(env.ENGINE.idFromName(`dev:${device}`));
export class EngineError extends Error { constructor(public code: number, msg: string) { super(msg); } }

// ── 창에 넣는 글(영어 — AI 도구가 가장 잘 따름, 사람에게는 그 사람 말로 쓰라고 함)
export function mainSystem(email: string, name = "Primary", oneGoal = true) {
  return `You are ${name}, the main bot ("Primary") of ${email}'s Boarder — the board where they follow and steer all their AI agent windows.
- What the person writes in Boarder's Primary chat arrives here as a message starting with "[보드 · Primary · 스레드 <id>] [Boarder chat]" (older: "[보드 · Primary] [Boarder chat]"). Messages starting with "[Boarder]" are notes from Boarder itself.
- The person does not see this terminal. Answer only with \`boarder chat --thread <id> "<text>"\` (the id from that head — the answer goes under their message; no id → \`boarder chat "<text>"\`) — short and warm, in the person's language (Korean if they write Korean).
- Your job: learn what they want their AI agents to do, then set up roles. A role is one agent window with one clear job. Propose one role at a time:
  boarder role draft --name "<short name>" --brief "<one line: what it handles>" --instructions "<what this agent does, how it reports, what it must not do>"
  They see it as a card in the chat and press 「이대로」 (Boarder then opens a Claude Code window for it), or tell you what to change — then draft again.
- To change an existing role when the person asks, use \`boarder role edit <role id> --name "<name>" --brief "<one line>" --instructions "<full new instructions>"\` (only the fields to change). Boarder saves it and informs its live windows. It needs this device allowed on their board once: if it fails with not_allowed, run \`boarder settings allow\` and ask them to press 「허용」 on the card.
- Don't do the roles' work yourself and don't open windows yourself. \`boarder role list\` shows roles and their windows.
- The person writes only here; you hand each ask to the node or role window that owns it. Look first (\`boarder role list\`, the nodes on the board). If the board has top-level nodes (parent = "top"), split only among those nodes; recipients may split further only to their own direct children, never to another branch. With no top-level nodes, keep the existing routing. When a message is an ask for an existing node or role, send it there: \`boarder split <id> --why "<one line: why it goes there>" --part "<node>: <their words, as they wrote them>"\` (the id from the head) — one --part for a single ask, one per node when one message holds asks for several nodes. Each part shows in that node's channel and goes into that node's window with your why; that window answers under their message here. Then tell them in one line where it went.
- If you can't tell which node or role an ask belongs to (two could fit, or none does and it is not clearly a new goal), don't guess and don't split: ask them in one line under their message — \`boarder chat --thread <id> "<which one: A or B?>"\` — and split after they answer.${oneGoal ? ONE_GOAL_MAIN : ""}`;
}
export const ONE_GOAL_MAIN = `
- One role = one goal, not one request. Before drafting, run \`boarder role list\`. If a role already covers the same goal (same product or area: polishing a screen, a button that should react at once, an input box, a bug or follow-up there), do not draft a new role — hand the ask to that role with \`boarder split\` (above) and tell the person in one line that 「<role>」 has it. Draft a new role only for a different goal (another product, another area, or a separate long-running goal).`;
export const ONE_GOAL_ROLE = `
This window is one goal. Take related and follow-up requests for that goal here — do not ask for a new window for them. Work through them one at a time; when there is enough to split, split inside this window (subagents, or helper panes for separate front-end and back-end work that does not touch the same files). Ask for a new role only when the work is a different goal.`;
export const DEFAULT_ROLES = [
  { id: "default-plan", name: "일 정리", brief: "오늘 할 일 · 메모 · 일정을 모아 차례로 정리해요", instructions: "Help the person sort what they need to do: collect tasks, notes and dates they give you, put them in a sensible order, and keep a short running list. Ask one short question when something is unclear. Do not take actions outside their files without asking." },
  { id: "default-research", name: "조사", brief: "궁금한 것을 찾아 쉬운 말로 정리해 줘요", instructions: "Look things up for the person and report back in plain, short language: what you found, how sure you are, and where it came from. Say so when you could not confirm something. Do not change their files unless asked." },
  { id: "default-writing", name: "글쓰기", brief: "메일 · 문서 · 글의 초안을 같이 써요", instructions: "Draft and polish the person's emails, documents and messages in their tone and language. Offer a first draft quickly, then revise from their feedback. Never send anything to anyone yourself — they send it." },
] as const;
/** 메인 봇 첫 글 · 새 회원 기본 역할: 그 사람 값(래퍼 prompts/ 를 기기가 올림)이 있으면 그것, 없으면 코드 기본값. 메인 봇 시스템 글(mainSystem)은 보더 명령 규약이라 바꾸지 않음 */
export async function promptsOf(db: D1Database, owner: string): Promise<{ mainHello: string; roles: readonly { id: string; name: string; brief: string; instructions: string }[] }> {
  const p = await readPrompts(db, owner).catch(() => ({ main: null, roles: null }));
  return { mainHello: p.main ?? MAIN_HELLO, roles: p.roles ?? DEFAULT_ROLES };
}
export const MAIN_HELLO = `[Boarder] Boarder just started you as the person's main bot. Greet them in one or two sentences with boarder chat and ask what they would like their AI agents to do. If the board has top-level nodes (parent = "top"), split only among those nodes; recipients may split further only to their own direct children, never to another branch. With no top-level nodes, keep the existing routing.`;
/** 역할 표 perms(권한) 를 사람이 읽을 글로: 들여오기(importer/proposal.ts)가 서브에이전트 tools 칸을 그대로 넣어 JSON 배열 · 객체, YAML 흐름 꼴([Read, Grep]),
 *  도구 이름만 쉼표로 늘어놓은 꼴(Read, Grep, Bash(git:*))이 올 수 있음 — 그 꼴이면 「쓸 수 있는 도구: …」, 아니면 적힌 글 그대로. 저장 값은 안 바꿈(화면에서 고치면 글로 저장) */
const TOOL_NAME = /^(?:[A-Z][A-Za-z0-9]*(?:\([^()]*\))?|mcp__[\w*-]+)$/;
export function permsText(raw: unknown): string {
  const s = String(raw ?? "").trim(); if (!s) return "";
  const tools = (xs: unknown[]) => { const t = xs.map(x => typeof x === "string" ? x.trim() : JSON.stringify(x)).filter(Boolean); return t.length ? `쓸 수 있는 도구: ${t.join(", ")}` : ""; };
  if (/^[\[{]/.test(s)) {
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) return tools(v);
      if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.map(y => typeof y === "string" ? y : JSON.stringify(y)).join(", ") : typeof x === "string" ? x : JSON.stringify(x)}`).join("\n");
    } catch {}
    const m = /^\[([^[\]]*)\]$/.exec(s);
    if (m) return tools(m[1].split(",").map(x => x.trim().replace(/^["']|["']$/g, "")));
  }
  const xs = s.split(",").map(x => x.trim());
  return xs.length > 1 && xs.every(x => TOOL_NAME.test(x)) ? tools(xs) : s;
}
/** 권한 · 보고 라인(role.perms · role.supervise)은 비어 있으면 안 넣음 — 두 칸이 비면 예전 글과 글자 하나까지 같음(role-edit.test.ts) */
export type RoleMore = { perms?: string | null; supervise?: string | null };
export function rolePrompt(name: string, instructions: string, oneGoal = true, more: RoleMore = {}) {
  const perms = permsText(more.perms), sup = String(more.supervise ?? "").trim();
  const extra = (perms ? `\nPermissions (tools, connectors, what you must not do): ${perms}` : "") + (sup ? `\nReporting line (who you report to, who reviews your work, when to bring things to the person): ${sup}` : "");
  return `[Boarder] You are the "${name}" agent. Your job: ${instructions}${oneGoal ? ONE_GOAL_ROLE : ""}${extra}
Report on the person's Boarder board as you work: run \`boarder log start "<one line>"\` now, \`boarder log progress "<where things stand>"\` at each big step, \`boarder ask "<question>" --choice "<A>" --choice "<B>"\` only for decisions they must make, \`boarder log blocked "<why, who can unblock>"\` when stuck, and \`boarder log done "<result>"\` when finished. Write board lines in the person's language. Start now.`;
}
const WAKE = `[Boarder] This window has been quiet for a while. Write where things stand with boarder log progress, then keep going. If you are stuck, boarder log blocked "<why>"; if you are finished, boarder log done "<result>".`;

export async function ownerCfg(db: D1Database, owner: string) {
  const r = await db.prepare("SELECT e.perm_mode, e.perm_at, e.rules, (SELECT json_extract(data, '$.rules.one_goal') FROM node_setting WHERE owner = ?1 AND json_valid(data)) og FROM (SELECT ?1 AS o) x LEFT JOIN engine_owner e ON e.owner = x.o").bind(owner).first<{ perm_mode: string | null; perm_at: number | null; rules: string | null; og: number | null }>();
  let rules = { ...RULES }; try { rules = { ...RULES, ...(r?.rules ? JSON.parse(r.rules) : {}) }; } catch {}
  if (r?.og === 0 || r?.og === 1) rules.one_goal = r.og === 1;
  return { perm: (r?.perm_mode === "bypass" ? "bypass" : r?.perm_mode === "auto" ? "auto" : "ask") as "ask" | "auto" | "bypass", perm_at: r?.perm_at ?? null, rules };
}
// 엔진이 붙어 있는 그 사람 기기(가장 최근 연락, 2분 안)
export async function liveDevice(db: D1Database, owner: string, forPrimary = false) {
  const scope = (await f7On(db, "owner_device")) ? "scope IN ('full', 'harness')" : "scope = 'full'";
  return (await db.prepare(`SELECT id FROM device WHERE owner = ? AND revoked_at IS NULL AND ${scope} AND engine_at > ?${forPrimary ? " AND coalesce(json_extract(engine, '$.primary'), 1) != 0" : ""} ORDER BY engine_at DESC LIMIT 1`).bind(owner, Date.now() - 120_000).first<{ id: string }>())?.id || null;
}
export async function deviceOk(db: D1Database, device: string, owner: string) {   // 시험이 부름(owner-unify.test.ts)
  const r = await db.prepare("SELECT d.revoked_at, d.scope, (SELECT 1 FROM invite WHERE email = d.owner) inv FROM device d WHERE d.id = ? AND d.owner = ?").bind(device, owner).first<{ revoked_at: number | null; scope: string | null; inv: number | null }>();
  return !!r && !r.revoked_at && (!!r.inv || r.scope === "harness");
}

export const paneWid = (pane: string) => /^%\d{1,7}$/.test(pane) ? `ew_pane${pane.slice(1)}` : null;
export const widPane = (id: string) => { const m = /^ew_pane(\d{1,7})$/.exec(id); return m ? `%${m[1]}` : null; };
const HSTATE = /^(busy|idle|waiting|background|starting|none|parked)$/;
type HPend = { k?: string; id: string; text: string; at: number; test?: boolean; owner?: boolean; sending?: number };
const HCMD_MS = 160_000;
type Pend = { id: string; text: string; at: number; k?: string };
/** 회원 화면에 남길 실패 이유: 제어문자 · 토큰 꼴(sk- · bxd_ · Bearer …) 가리고 80자 */
const shortWhy = (e: unknown) => String((e as Error)?.message || e).replace(/[\x00-\x1f\x7f]/g, " ").replace(/\b(?:sk-|bxd_|ghp_|xox[a-z]-)[\w-]+|Bearer\s+\S+/gi, "…").slice(0, 80);
export const sysLine = (db: D1Database, owner: string, text: string, wid?: string) =>
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").bind(owner, "보더", "sys", text, "primary", Date.now(), wid ?? null).run();

// deliver 와 reopen 이 서로 부르니 답 꼴을 적어 둠(추론이 돌아 TS7023)
type Delivered = { sent?: boolean; reopened?: boolean; queued?: boolean; device?: boolean };
export const LOST_LINE = "방금 글이 창에 안 들어갔어요 — 메인 봇 창을 열지 못했어요. 설정 › 노드 「메인 봇 창」을 확인하고 다시 보내 주세요";
const REOPEN_ASK_MS = 3 * 60_000, REOPEN_GIVEUP_MS = 10 * 60_000, REOPEN_DROP_MS = 60 * 60_000;
const reopenLostLine = (name: string) => `「${name}」 창이 다시 뜨지 않아 방금 글이 안 들어갔어요 — 다시 보내 주세요. 또 그러면 그 기기에서 boarder engine 상태를 확인해 주세요`;
const lostAnswer = (e: unknown) => (e as Error)?.message === "엔진 답 없음";   // cmd 가 보낸 뒤 답을 못 받음 — 기기는 했을 수 있음
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
    await this.ctx.storage.deleteAlarm(); await this.ctx.storage.delete("pending"); await this.ctx.storage.delete("hpending"); await this.ctx.storage.delete("reopens");
    return { ok: true };
  }
  async pend(p: Pend) { const q = (await this.q<Pend>("pending")) || []; q.push({ ...p, k: p.k || crypto.randomUUID() }); await this.qput("pending", q.slice(-50)); return { queued: true }; }
  // 밀린 글 줄(pending · hpending — 사람 글 원문) 봉함(f7_flag envelope): 켜짐이면 {o: 주인, d: 기기, s: 봉한 JSON}, 꺼짐이면 지금처럼 배열 그대로.
  // 읽기는 꼴로 가름(켰다 꺼도 열림). 읽기 앞에 스위치 · DEK 를 미리 데움 — 읽고 고쳐 쓰는 사이에 D1 을 부르면 입력 문이 열려 다른 부르기가 끼어듦
  private ve() { return this.env as unknown as VaultEnv; }
  // 스위치는 사람마다: 엔진 DEK 주인은 who.owner(기기 주인 메일) 그대로 두고, 스위치 이름만 다른 길과 같게(주인 메일 = 'envelope:owner')
  private on(owner: string) { return envelopeOn(this.ve(), flagOwner(this.env as { ALLOW_EMAILS?: string }, owner)); }
  private async warm() { try { const { owner } = await this.who(); if (await this.on(owner)) await getDek(this.ve(), owner, { create: true }); } catch { /* 데우기는 덤 — 스위치 · DEK 오류는 쓰는 qput 이 크게 던짐 */ } }
  private async q<T>(k: "pending" | "hpending"): Promise<T[]> {
    await this.warm();
    const v = await this.ctx.storage.get<T[] | { o: string; d: string; s: string }>(k);
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return JSON.parse((await openField(this.ve(), v.o, { tbl: "engine", pk: v.d, col: k }, v.s)) as string) as T[];
  }
  private async qput(k: "pending" | "hpending", q: unknown[]) {
    const { owner, device } = await this.who(), d = device || "-";
    if (!(await this.on(owner))) return this.ctx.storage.put(k, q);
    await this.ctx.storage.put(k, { o: owner, d, s: await sealFieldNow(this.ve(), owner, { tbl: "engine", pk: d, col: k }, JSON.stringify(q)) });
  }
  /** 옮기기(worker/vault/migrate.ts): 두 줄의 꼴 — plain = 배열, v2 = {o, d, s} */
  async vaultPlan() {
    const out = { plain: 0, v2: 0, empty: 0 };
    for (const k of ["pending", "hpending"] as const) { const v = await this.ctx.storage.get(k); if (!v || Array.isArray(v) && !v.length) out.empty++; else if (Array.isArray(v)) out.plain++; else out.v2++; }
    return out;
  }
  /** to v2 = 배열을 봉함, plain = 봉한 것을 배열로(되돌리기). 봉한 값을 다시 열어 같은지 본 뒤, 그사이 줄이 바뀌었으면(다시 읽어 비교) 안 씀 */
  async vaultMove(to: "v2" | "plain", dryRun = false) {
    const out = { done: 0, skipped: 0, changed: 0, failed: [] as { key: string; error: string }[] };
    const { owner, device } = await this.who(), d = device || "-", ve = this.ve();
    for (const k of ["pending", "hpending"] as const) {
      try {
        if (to === "v2") await getDek(ve, owner, { create: true });   // 읽기 앞에 데움(입력 문)
        const v = await this.ctx.storage.get<unknown[] | { o: string; d: string; s: string }>(k);
        if (!v || (Array.isArray(v) ? to === "plain" || !v.length : to === "v2")) { out.skipped++; continue; }
        const was = JSON.stringify(v), arr = Array.isArray(v) ? v : JSON.parse((await openField(ve, v.o, { tbl: "engine", pk: v.d, col: k }, v.s)) as string);
        const next = to === "v2" ? { o: owner, d, s: await sealFieldNow(ve, owner, { tbl: "engine", pk: d, col: k }, JSON.stringify(arr)) } : arr;
        if (to === "v2" && (await openField(ve, owner, { tbl: "engine", pk: d, col: k }, (next as { s: string }).s)) !== JSON.stringify(arr)) throw new Error("다시 연 값이 다름");
        if (JSON.stringify(await this.ctx.storage.get(k)) !== was) { out.changed++; continue; }   // CAS
        if (dryRun) { out.done++; continue; }
        await this.ctx.storage.put(k, next);
        out.done++;
      } catch (e) { out.failed.push({ key: k, error: String((e as Error)?.message || e).slice(0, 200) }); }
    }
    return out;
  }
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

  async rtc(verb: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<{ ok: true; result: any } | { ok: false; code: number; error: string }> {
    if (!/^rtc_(start|poll|note|say|stop)$/.test(verb)) return { ok: false, code: 5, error: "없는 동사" };
    if ((await this.who()).harness) return { ok: false, code: 1, error: "주인 하네스 기기엔 회원 통화가 없어요" };
    try { return { ok: true, result: await this.cmd(verb, args, timeoutMs) }; }
    catch (e) { return { ok: false, code: Number((e as EngineError)?.code) || 1, error: String((e as Error)?.message || e).slice(0, 300) }; }
  }

  /** 보더 웹 설정 › 엔진(BYOS): 기기 동사 셋 — 계정 목록 · 브라우저 로그인 주소 · 엔진 고르기. 그 밖의 동사는 안 보냄. 로그인 값은 오지 않고 이름 · 여부 · 주소만 옴 */
  async devCmd(verb: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<{ ok: true; result: any } | { ok: false; code: number; error: string }> {
    if (!/^(account_list|account_login|engine_choose)$/.test(verb)) return { ok: false, code: 5, error: "없는 동사" };
    if ((await this.who()).harness) return { ok: false, code: 1, error: "주인 하네스 기기엔 없어요" };
    try { return { ok: true, result: await this.cmd(verb, args, timeoutMs) }; }
    catch (e) { return { ok: false, code: Number((e as EngineError)?.code) || 1, error: String((e as Error)?.message || e).slice(0, 300) }; }
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
        engines: Object.fromEntries(Object.entries(m.engines || {}).slice(0, 8).map(([k, v]: [string, any]) => [k.slice(0, 30), { caps: Array.isArray(v?.caps) ? v.caps.filter((x: unknown) => typeof x === "string").slice(0, 8) : null }])),
        // 통화: 이 기기 codex 로그인으로 GPT voice 를 열 수 있나(/api/voice/modes). 옛 CLI 는 칸이 없음(null)
        voice: m.voice && typeof m.voice === "object" ? { ok: m.voice.ok === true, why: String(m.voice.why || "").replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 160) } : null };
      await db.prepare("UPDATE device SET engine = ?, engine_at = ? WHERE id = ?").bind(JSON.stringify(eng), now, device).run();
      // 기기에 없는 창(재부팅 · tmux 꺼짐)은 gone — 손잡이가 있으니 채팅 · 카드 답이 오면 다시 열림
      const have = new Set((Array.isArray(m.windows) ? m.windows : []).map((w: any) => String(w.id)));
      const rows = (await db.prepare(`SELECT id FROM engine_window WHERE device_id = ? AND state IN (${LIVE.map(() => "?").join(",")})`).bind(device, ...LIVE).all<{ id: string }>()).results;
      for (const r of rows) if (!have.has(r.id) && r.id) { await db.prepare("UPDATE engine_window SET state = 'gone', state_at = ? WHERE id = ?").bind(now, r.id).run(); if (!m.partial) await this.reopenSettled(r.id, true); }   // partial = 목록을 못 읽은 엔진이 있음 — 없는지 모르니 감시 판정은 미룸(알람이 물어봄)
      // 서버가 이미 닫은 창(다른 기기로 옮긴 메인 봇 · 못 연 창)이 기기에 아직 있으면 닫음
      const dead = new Set((await db.prepare("SELECT id FROM engine_window WHERE device_id = ? AND state IN ('closed','failed')").bind(device).all<{ id: string }>()).results.map(r => r.id));
      for (const id of have) if (dead.has(id as string)) this.ctx.waitUntil(this.cmd("close", { id }, 90_000).catch(() => null));
      if (m.primary === false) {   // 이 기기는 Primary 자리가 아님: 여기 떠 있던 Primary 는 닫고(다음 채팅 때 다른 엔진 기기에서 뜸), 새로 띄우지 않음
        const mine = (await db.prepare("SELECT id FROM engine_window WHERE owner = ? AND device_id = ? AND kind = 'main' AND state NOT IN ('closed','failed')").bind(owner, device).all<{ id: string }>()).results;
        for (const w of mine) await this.close(w.id).catch(() => null);
      } else { await this.ensureMain(owner, device); this.ctx.waitUntil(this.seedRoles(owner).catch(() => null)); }   // 응답 길(flush · drain)을 안 막음
      this.ctx.waitUntil(this.openPending(owner).catch(() => null));   // 엔진이 꺼진 동안 설정에서 만든 역할의 창

      await this.flush();   // 꺼져 있던 동안 쌓인 채팅 · 카드 답
      this.ctx.waitUntil(this.drainCmds().catch(() => null));
      this.ctx.waitUntil(bumpMember(this.env as never, owner));
      return;
    }
    if (m.type === "queue") return this.queueMsg(m, device, owner);
    if (m.type === "state" || m.type === "event") {
      const list = m.type === "event" ? [m] : Array.isArray(m.windows) ? m.windows.slice(0, 50) : [];
      let changed = 0;
      for (const w of list) {
        const st = String(w.state || ""); if (!/^(busy|idle|waiting|background|starting|none)$/.test(st) || !/^ew_[a-z0-9]{6,30}$/.test(String(w.id))) continue;
        const next = st === "none" ? "gone" : st, dialog = w.dialog ? String(w.dialog).slice(0, 20) : null, note = w.limit ? String(w.limit).slice(0, 200) : null;
        const r = await db.prepare("UPDATE engine_window SET state = ?, state_at = CASE WHEN state = ? THEN state_at ELSE ? END, dialog = ?, note = COALESCE(?, note) WHERE id = ? AND device_id = ? AND state NOT IN ('parked','closed','failed') AND (state IS NOT ? OR dialog IS NOT ? OR (? IS NOT NULL AND note IS NOT ?))")
          .bind(next, next, now, dialog, note, String(w.id), device, next, dialog, note, note).run();
        changed += Number(r?.meta?.changes || 0);
        if (st === "none" || w.error) { if (await this.reopenSettled(String(w.id), true)) changed++; }
        else if (st !== "starting" && !w.dialog) await this.reopenSettled(String(w.id), false);   // 창이 떠서 일하거나 쉼 — 첫 메시지를 받은 것(확인창이 떠 있으면 아직 아님)
      }
      await db.prepare("UPDATE device SET engine_at = ? WHERE id = ?").bind(now, device).run();
      if (list.some((w: any) => w.state === "idle")) await this.flush();   // 쉬게 된 창에 밀린 글
      if (list.length) this.ctx.waitUntil(this.drainCmds().catch(() => null));   // 바빠서 못 넣은 사람 글 다시
      if (changed) this.ctx.waitUntil(bumpMember(this.env as never, owner));
    }
  }
  async queueMsg(m: any, device: string, owner: string) {
    const db = this.env.DB, id = String(m.id || "").slice(0, 64);
    const w = id ? await db.prepare("SELECT name FROM engine_window WHERE id = ? AND device_id = ? AND owner = ?").bind(id, device, owner).first<{ name: string }>() : null;
    const text = typeof m.note === "string" ? m.note.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 240) : "";
    if (text && w) await sysLine(db, owner, `「${w.name}」 ${text}`, id);
    else if (text && /^ew_[\w-]{3,60}$/.test(id)) {
      const it = await db.prepare("SELECT win FROM imp_item WHERE owner = ? AND device_id = ? AND kind = 'window' AND substr(win, -?) = ? LIMIT 1").bind(owner, device, id.length + 1, ":" + id).first<{ win: string }>();
      if (it) await db.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").bind(owner, it.win, "blocked", text, Date.now()).run();
    }
    const done = (Array.isArray(m.done) ? m.done : []).filter((x: unknown) => typeof x === "string" && /^[\w-]{1,64}$/.test(x)).slice(0, 100) as string[];
    for (const c of done) await db.prepare("UPDATE engine_cmd SET state = 'done', done_at = ? WHERE id = ? AND device_id = ? AND state IN ('sending','waiting','taken')").bind(Date.now(), c, device).run();
    if (done.length) this.ctx.waitUntil(bumpMember(this.env as never, owner));
  }
  async webSocketClose(ws: WebSocket) { try { ws.close(1011, "닫힘"); } catch {} }
  async webSocketError(ws: WebSocket) { await this.webSocketClose(ws); }

  async row(id: string) { return this.env.DB.prepare("SELECT * FROM engine_window WHERE id = ?").bind(id).first<Win>(); }
  async open(o: { owner: string; kind: "main" | "role" | "chat"; role_id?: string | null; name: string; cwd: string; prompt: string; system?: string; email?: string; config_dir?: string }) {
    const { device, harness } = await this.who(), db = this.env.DB, now = Date.now(), id = rid("ew_");
    if (harness) throw new EngineError(5, "주인 하네스 기기는 서버가 창을 열지 않아요");
    const cfg = await ownerCfg(db, o.owner);
    const codex = (cfg.rules as Record<string, unknown>).provider === "codex";
    const spec = { id, name: o.name, cwd: o.cwd, ...(codex ? { provider: "codex" } : { model: MODEL }), perm: cfg.perm, ...(o.system ? { system: o.system } : {}), ...(o.config_dir ? { config_dir: o.config_dir } : {}), ...(codex ? {} : { session_id: crypto.randomUUID() }) };
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
  /** 기본 역할 심기: 멱등(user_pref 표시를 먼저 차지) · 주인 제외 · 역할이 이미 있으면 그대로 · 온보딩(메인 봇 줄)이 끝난 회원만 · 기기 소켓이 붙어 있을 때만(안 붙었으면 표시도 안 하고 다음 hello 때) */
  async seedRoles(owner: string) {
    const db = this.env.DB, { device, harness } = await this.who();
    if (harness || !device || flagOwner(this.env as { ALLOW_EMAILS?: string }, owner) === "" || !this.online()) return { seeded: 0 };
    const { rules } = await ownerCfg(db, owner);
    if (rules.default_roles !== true) return { seeded: 0 };
    if (!(await db.prepare("SELECT 1 x FROM member_bot WHERE owner = ?").bind(owner).first())) return { seeded: 0 };
    const have = await db.prepare("SELECT (SELECT count(*) FROM role WHERE owner = ?1) + (SELECT count(*) FROM engine_window WHERE owner = ?1 AND kind = 'role') n").bind(owner).first<{ n: number }>();
    const now = Date.now(), claim = await db.prepare("INSERT OR IGNORE INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").bind(owner, "default_roles_seeded", have?.n ? "had-roles" : "seeded", now).run();
    if (!claim.meta.changes || have?.n) return { seeded: 0 };
    let opened = 0, why = "";
    const { roles: defaults } = await promptsOf(db, owner);
    for (const r of defaults) {
      const cwd = `~/boarder/${r.id}`;
      await db.prepare("INSERT OR IGNORE INTO role(owner, id, name, instructions, intake, engine, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(owner, r.id, r.name, r.instructions, r.brief, JSON.stringify({ device, engine: "tmux", model: MODEL, cwd }), "default", now, now).run();
      try { await this.open({ owner, kind: "role", role_id: r.id, name: r.name, cwd, prompt: rolePrompt(r.name, r.instructions, rules.one_goal !== false) }); opened++; }
      catch (e) {
        why = shortWhy(e);
        await db.batch([db.prepare("UPDATE role SET engine = json_set(engine, '$.pending', 1) WHERE owner = ? AND id = ? AND json_valid(engine)").bind(owner, r.id),
          db.prepare("UPDATE engine_window SET state = 'closed', state_at = ? WHERE owner = ? AND role_id = ? AND state = 'failed'").bind(Date.now(), owner, r.id)]).catch(() => null);
      }
    }
    await sysLine(db, owner, opened ? `기본 역할 ${opened}개(${defaults.map(r => r.name).join(" · ")})를 만들었어요` : `기본 역할을 만들었지만 창은 못 열었어요${why ? ` — ${why}` : ""}`).catch(() => null);
    return { seeded: defaults.length, opened };
  }
  /** 설정 「새 역할」을 엔진이 꺼진 동안 만든 역할(role.engine.pending = 1): 엔진이 붙으면(hello) 이 기기에 창을 엶 — 먼저 차지한 한 번만, 못 열면 다시 미룸 */
  async openPending(owner: string) {
    const db = this.env.DB, { device, harness } = await this.who();
    if (harness || !device || !this.online()) return { opened: 0 };
    const rs = (await db.prepare("SELECT id, name, instructions, perms, supervise, engine FROM role WHERE owner = ? AND (CASE WHEN json_valid(engine) THEN json_extract(engine, '$.pending') END) = 1 ORDER BY created_at LIMIT 10").bind(owner).all<{ id: string; name: string; instructions: string; perms: string; supervise: string; engine: string }>()).results;
    let opened = 0;
    for (const r of rs) {
      if (await openedLastHour(db, owner) >= OPEN_PER_HOUR) break;
      if (await sameGoalWindow(db, owner, r.name, { liveOnly: true })) continue;
      const claim = await db.prepare("UPDATE role SET engine = json_set(engine, '$.pending', 0, '$.device', ?) WHERE owner = ? AND id = ? AND (CASE WHEN json_valid(engine) THEN json_extract(engine, '$.pending') END) = 1").bind(device, owner, r.id).run();
      if (!claim.meta.changes) continue;
      let cwd = `~/boarder/${r.id}`; try { cwd = JSON.parse(r.engine).cwd || cwd; } catch {}
      try { await openRole(this.env, owner, device, r.id, { name: r.name, instructions: r.instructions, perms: r.perms, supervise: r.supervise, cwd }, "pending", o => this.open(o)); opened++; }
      catch {
        await db.batch([db.prepare("UPDATE role SET engine = json_set(engine, '$.pending', 1) WHERE owner = ? AND id = ? AND json_valid(engine)").bind(owner, r.id),
          db.prepare("UPDATE engine_window SET state = 'closed', state_at = ? WHERE owner = ? AND role_id = ? AND state = 'failed'").bind(Date.now(), owner, r.id)]).catch(() => null);
      }
    }
    return { opened };
  }
  async ensureMain(owner: string, device: string) {
    const db = this.env.DB;
    const main = await db.prepare("SELECT w.id, w.state, w.device_id FROM engine_window w JOIN device d ON d.id = w.device_id WHERE w.owner = ? AND w.kind = 'main' AND w.state NOT IN ('closed','failed') AND d.revoked_at IS NULL ORDER BY w.created_at DESC LIMIT 1").bind(owner).first<{ id: string; state: string; device_id: string }>();
    if (main) return main.id;
    if (await importedPrimary(db, owner)) return null;
    const bot = await db.prepare("SELECT name FROM member_bot WHERE owner = ?").bind(owner).first<{ name: string }>().catch(() => null);
    const name = bot?.name || "Primary";
    const { rules } = await ownerCfg(db, owner).catch(() => ({ rules: RULES }));
    const r = await this.open({ owner, kind: "main", name, cwd: "~/boarder/primary", prompt: (await promptsOf(db, owner)).mainHello, system: mainSystem(owner, name, rules.one_goal !== false) }).catch(async (e: unknown) => {
      await sysLine(db, owner, `메인 봇을 못 열었어요 — ${shortWhy(e)}`).catch(() => null);
      return null;
    });
    if (r) {
      await sysLine(db, owner, "메인 봇이 이 기기에서 시작했어요", r.id);
      // 새 메인 창이 열렸다 = 이 기기 엔진이 이제 일함(예: 구독 로그인 뒤 첫 글) — 미뤄 둔 역할 창도 지금 엶(hello 를 기다리지 않음, 먼저 차지한 한 번만)
      this.ctx.waitUntil(this.openPending(owner).catch(() => null));
    }
    return r?.id || null;
  }
  async deliver(id: string, text: string, ordered = true, k?: string): Promise<Delivered> {
    const w = await this.row(id); if (!w) throw new EngineError(4, "없는 창");
    if (w.state === "closed" || w.state === "failed") throw new EngineError(4, "닫힌 창이에요");
    if (ordered && ((await this.q<Pend>("pending")) || []).some(p => p.id === id)) { const r = await this.pend({ id, text, at: Date.now() }); await this.flush().catch(() => null); return r; }
    if (w.state === "parked" || w.state === "gone") return this.reopen(id, text, k);
    if (w.state === "opening" || w.state === "starting" || !this.online()) return this.pend({ id, text, at: Date.now(), k });
    try { const r = await this.cmd("send", { id, text }); return r?.queued ? { queued: true, device: true } : { sent: true }; }
    catch (e) {
      const code = (e as EngineError).code;
      if (code === 2 || (!this.online() && !lostAnswer(e))) return this.pend({ id, text, at: Date.now(), k });
      if (code === 4) { await this.env.DB.prepare("UPDATE engine_window SET state = 'gone', state_at = ? WHERE id = ? AND state NOT IN ('closed','failed','parked')").bind(Date.now(), id).run(); return this.reopen(id, text, k); }
      // 글 넣기가 없는 엔진(caps 에 send 없음, 16쪽 ②): 닫고 같은 손잡이로 그 글과 함께 새로 돌림
      if (code === 5) { await this.cmd("close", { id }).catch(() => null); await this.env.DB.prepare("UPDATE engine_window SET state = 'gone', state_at = ? WHERE id = ?").bind(Date.now(), id).run(); return this.reopen(id, text, k); }
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
          const a = JSON.parse(r.args) as { engine: string; handle: { id: string }; text?: string; primary?: boolean }, id = a.handle.id;
          if (!a.text || held.has(id)) continue;
          const w = await this.row(id).catch(() => null);
          if (w && (w.state === "opening" || w.state === "starting")) { held.add(id); continue; }
          if (!await db.prepare("UPDATE engine_cmd SET state = 'sending', taken_at = ? WHERE id = ? AND state = 'queued' RETURNING id").bind(Date.now(), r.id).first()) continue;
          try {
            // cmd: 기기가 줄에 세웠다가 넣으면 이 id 로 끝을 알림(type 'queue' done). 줄에 세웠으면 'waiting' — 화면엔 아직 안 넣은 글
            const res = await this.cmd("send", { id, engine: a.engine, text: a.text, cmd: r.id });
            if (res?.queued) await db.prepare("UPDATE engine_cmd SET state = 'waiting', result = ? WHERE id = ? AND state = 'sending'").bind(JSON.stringify({ queued: true }), r.id).run();
            else await db.prepare("UPDATE engine_cmd SET state = 'done', done_at = ? WHERE id = ?").bind(Date.now(), r.id).run();
          } catch (e) {
            const err = e as EngineError, off = err.message === "엔진이 꺼져 있어요", busy = err.code === 2;
            await db.prepare("UPDATE engine_cmd SET state = ?, result = ?, done_at = ? WHERE id = ?").bind(busy || off ? "queued" : "failed", String(err.message || err).slice(0, 300), busy || off ? null : Date.now(), r.id).run();
            if (off) return;
            if (busy) held.add(id);
            else if (a.primary) await this.primaryDrainFailed(r.id, id, a.text, err);
          }
        }
      } while (this.drainAgain);
    } finally { this.draining = false; }
  }
  /** 메인 봇 창에 소켓으로 넣다 실패한 글: 응답은 이미 「줄 섬」이라 여기서 끝내면 표시 없이 사라짐. 창이 기기에 없으면(4) 다시 열며 넣고(감시를 탐), 못 하면 시스템 줄 */
  private async primaryDrainFailed(cmd: string, id: string, text: string, err: EngineError) {
    const db = this.env.DB;
    if (err.code === 4) try {
      await db.prepare("UPDATE engine_window SET state = 'gone', state_at = ? WHERE id = ? AND state NOT IN ('closed','failed','parked')").bind(Date.now(), id).run();
      await this.reopen(id, text);
      await db.prepare("UPDATE engine_cmd SET state = 'done', result = '창이 없어 다시 열며 넣음', done_at = ? WHERE id = ?").bind(Date.now(), cmd).run();
      return;
    } catch { }
    const line = lostAnswer(err) ? "방금 글이 창에 들어갔는지 확인하지 못했어요 — 답이 없으면 다시 보내 주세요" : LOST_LINE;   // 답을 잃은 send 는 들어갔을 수 있어 다시 넣지 않음
    await sysLine(db, (await this.who()).owner, line, id).catch(() => null);
  }
  flushing = false; flushAgain = false;
  async flush() {
    if (!this.online()) return;
    if (this.flushing) { this.flushAgain = true; return; }
    this.flushing = true;
    try { do { this.flushAgain = false; await this.flushOnce(); } while (this.flushAgain && this.online()); }
    finally { this.flushing = false; }
  }
  private async flushOnce() {
    const q = (await this.q<Pend>("pending")) || []; if (!q.length) return;
    const db = this.env.DB, left: Pend[] = [], held = new Set<string>(), wait = (p: Pend) => { left.push(p); held.add(p.id); };
    const key = (p: Pend) => p.k || `${p.id}\n${p.at}\n${p.text}`;
    const lost = (p: Pend, w: Win) => sysLine(db, w.owner, `「${w.name}」 창에 글이 들어갔는지 확인하지 못했어요: ${stripHead(p.text).replace(/^\[Boarder( chat)?\] /, "").slice(0, 120)}`, p.id).catch(() => null);
    // 기기 줄에 선 글(device)은 기기가 넣음 — 서버 줄에 남기면 다음 flush 가 또 보내 같은 글이 두 번 들어감
    const reopenAt = async (p: Pend, w: Win) => { try { const r = await this.reopen(p.id, p.text, key(p)); if (r.queued && !r.device) wait(p); } catch (e) { if (lostAnswer(e)) await lost(p, w); else wait(p); } };
    for (const p of q) {
      if (held.has(p.id)) { left.push(p); continue; }
      const w = await this.row(p.id);
      if (!w || w.state === "closed" || w.state === "failed") continue;
      if (Date.now() - p.at > 6 * 3600_000) { await sysLine(db, w.owner, `「${w.name}」 창에 6시간 동안 못 넣은 글을 버렸어요: ${stripHead(p.text).replace(/^\[Boarder( chat)?\] /, "").slice(0, 120)}`, p.id).catch(() => null); continue; }
      if (w.state === "parked" || w.state === "gone") { await reopenAt(p, w); continue; }
      if (w.state !== "idle") { wait(p); continue; }
      try { await this.cmd("send", { id: p.id, text: p.text }); }
      catch (e) {
        if (lostAnswer(e)) { await lost(p, w); continue; }
        if ((e as EngineError).code !== 4) { wait(p); continue; }
        await db.prepare("UPDATE engine_window SET state = 'gone', state_at = ? WHERE id = ? AND state NOT IN ('closed','failed','parked')").bind(Date.now(), p.id).run();
        await reopenAt(p, w);
      }
    }
    const had = new Set(q.map(key));
    const added = ((await this.q<Pend>("pending")) || []).filter(p => !had.has(key(p)));
    await this.qput("pending", [...left, ...added].slice(-50));
  }
  async park(id: string, why = "") {
    const w = await this.row(id); if (!w || !LIVE.includes(w.state)) return { ok: false };
    let r: any;
    try { r = await this.cmd("park", { id }); }
    catch (e) { if ((e as EngineError).code === 5) { await this.env.DB.prepare("UPDATE engine_window SET note = ? WHERE id = ?").bind("이 엔진은 주차를 못 해요 — 열어 둠", id).run(); return { ok: false, cannot: true }; } throw e; }
    const old = (() => { try { return JSON.parse(w.handle || "{}"); } catch { return {}; } })();
    await this.env.DB.prepare("UPDATE engine_window SET state = 'parked', state_at = ?, handle = ?, note = ? WHERE id = ?").bind(Date.now(), JSON.stringify({ ...old, ...(r?.handle || {}), argv: undefined, role_at: old.role_at }), why || null, id).run();   // 지시 받은 시각(role_at)은 서버 값 그대로
    return { ok: true };
  }
  async reopen(id: string, text = "", k?: string): Promise<Delivered> {
    const w = await this.row(id); if (!w) throw new EngineError(4, "없는 창");
    const h = (() => { try { return JSON.parse(w.handle || "{}"); } catch { return {}; } })();
    if (!h.session_id) throw new EngineError(1, "다시 열 손잡이가 없어요");
    if (!this.online()) return text ? this.pend({ id, text, at: Date.now(), k }) : (() => { throw new EngineError(1, "엔진이 꺼져 있어요"); })();
    const claim = await this.env.DB.prepare("UPDATE engine_window SET state = 'starting', state_at = ?, woke_at = NULL, note = NULL WHERE id = ? AND state IN ('parked','gone')").bind(Date.now(), id).run();
    if (!claim.meta.changes) { if (text && LIVE.includes((await this.row(id))?.state || "")) return this.pend({ id, text, at: Date.now(), k }); throw new EngineError(1, "다시 열 수 없는 창이에요"); }
    const cfg = await ownerCfg(this.env.DB, w.owner);
    const role = w.role_id ? await this.env.DB.prepare("SELECT name, instructions, perms, supervise, updated_at FROM role WHERE owner = ? AND id = ?").bind(w.owner, w.role_id).first<{ name: string; instructions: string; perms: string; supervise: string; updated_at: number | null }>() : null;
    const fresh = !!role && Number(role.updated_at || 0) > (Number(h.role_at) || w.created_at || 0);
    const resumeText = text || `[Boarder] This window was parked and is open again. Continue from your last board line.`;
    const { role_at: _roleAt, ...dh } = h;   // 받은 시각은 서버 몫 — 기기 손잡이로 안 보냄(되돌아와 새 값을 덮지 않게)
    try { await this.cmd("reopen", { id, handle: { ...dh, ...(role ? { name: role.name } : {}), perm: cfg.perm }, text: fresh ? `${rolePrompt(role!.name, role!.instructions, cfg.rules.one_goal !== false, role!)}\n\n${resumeText}` : resumeText }); }
    catch (e) {
      const st = await this.cmd("state", { id }).catch(() => null), s = String(st?.state || "");
      if (/^(busy|idle|waiting|background|starting)$/.test(s)) {
        await this.env.DB.prepare("UPDATE engine_window SET state = ?, state_at = ? WHERE id = ? AND state = 'starting'").bind(s, Date.now(), id).run();
        // 이번 답이 없었으면 이 글이 그 창의 첫 메시지로 들어갔을 수 있음 — 다시 안 넣음. 기기가 「이미 떠 있음」으로 거절했으면 이 글은 안 들어감 — 넣음
        if (!text) return { reopened: true };
        if ((e as Error).message === "엔진 답 없음") {   // 들어갔을 수 있어 다시 넣지 않음 — 대신 표시(flush 의 lost 와 같은 글)
          await sysLine(this.env.DB, w.owner, `「${w.name}」 창에 글이 들어갔는지 확인하지 못했어요: ${stripHead(text).replace(/^\[Boarder( chat)?\] /, "").slice(0, 120)}`, id).catch(() => null);
          return { reopened: true };
        }
        return this.deliver(id, text, false, k);
      }
      await this.env.DB.prepare("UPDATE engine_window SET state = ?, state_at = ?, note = ? WHERE id = ?").bind(w.state, Date.now(), String((e as Error).message).slice(0, 200), id).run(); throw e;
    }
    if (fresh) await this.env.DB.prepare("UPDATE engine_window SET handle = json_set(CASE WHEN json_valid(handle) THEN handle ELSE '{}' END, '$.role_at', ?) WHERE id = ?").bind(Number(role!.updated_at), id).run().catch(() => null);
    if (text && !(await this.who()).harness) { const m = (await this.ctx.storage.get<Record<string, number>>("reopens")) || {}; m[id] = Date.now(); await this.ctx.storage.put("reopens", m); }
    return { reopened: true };
  }
  /** 돌려줌: 채팅에 시스템 줄을 남겼으면 true(state 처리가 화면 알림을 보낼지 정할 때) */
  private async reopenSettled(id: string, lost: boolean | "unknown"): Promise<boolean> {
    const m = await this.ctx.storage.get<Record<string, number>>("reopens"); if (!m || !(id in m)) return false;
    delete m[id]; await this.ctx.storage.put("reopens", m);
    if (!lost) return false;
    const w = await this.row(id); if (!w || !["starting", "gone", "opening", "idle", "busy", "background", "waiting"].includes(w.state)) return false;
    return await sysLine(this.env.DB, w.owner, lost === "unknown" ? `「${w.name}」 창에 방금 글이 들어갔는지 확인하지 못했어요 — 답이 없으면 다시 보내 주세요` : reopenLostLine(w.name), id).then(() => true, () => false);
  }
  async checkReopens(now = Date.now()) {
    const m = await this.ctx.storage.get<Record<string, number>>("reopens"); if (!m) return;
    for (const [id, at] of Object.entries(m)) {
      if (now - at < REOPEN_ASK_MS) continue;
      const st = await this.cmd("state", { id }).catch((e: unknown) => (e as EngineError).code === 5 ? { cannot: true } : null), s = String(st?.state || "");
      if (!st) { if (now - at >= REOPEN_DROP_MS) await this.reopenSettled(id, "unknown"); continue; }   // 답을 못 받음 — 모르는 것으로 「안 들어갔어요」 줄을 남기지 않음
      if (st.cannot) { await this.reopenSettled(id, false); continue; }   // 상태 동사가 없는 커스텀 엔진 — 알 길이 없어 거짓 줄을 안 남김
      if (/^(busy|idle|background|waiting)$/.test(s) && (!st?.dialog || st.dialog === "question") && !st?.error) { await this.reopenSettled(id, false); continue; }
      if (s !== "none" && !st?.error && now - at < REOPEN_GIVEUP_MS) continue;
      // 닫기 답을 못 받으면 창이 기기에 남아 있을 수 있음 — gone 으로 맞추면 다시 보낸 글이 그 창에 들어가 둘 다 들어감. 다음 알람에 다시 봄
      if (s === "starting" && !st.error && !(await this.cmd("close", { id }, 90_000).then(() => true).catch(() => false))) { if (now - at >= REOPEN_DROP_MS) await this.reopenSettled(id, "unknown"); continue; }
      if (!st.error && (s === "none" || s === "starting")) await this.env.DB.prepare("UPDATE engine_window SET state = 'gone', state_at = ? WHERE id = ? AND state NOT IN ('closed','failed','parked')").bind(Date.now(), id).run();
      await this.reopenSettled(id, true);
    }
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
  async hsend(id: string, text: string, o: { test?: boolean; queue?: boolean; owner?: boolean } = {}) {
    if (!(await this.who()).harness) throw new EngineError(1, "하네스 기기가 아니에요");
    const bob = o.owner && !o.test ? { owner: true } : {};
    if (!this.online()) { if (o.queue) return this.hpend({ id, text, at: Date.now(), test: o.test, ...bob }); return { offline: true }; }
    if (o.queue && ((await this.q<HPend>("hpending")) || []).some(p => p.id === id)) { const r = await this.hpend({ id, text, at: Date.now(), test: o.test, ...bob }); this.hflush(); return r; }
    try { const r = await this.cmd("send", { id, text, ...(o.test ? { test: true } : {}), ...bob }, HCMD_MS); return { sent: true, to: r?.to || widPane(id), ...(r?.reopening ? { reopening: true } : {}) }; }
    catch (e) {
      if ((e as EngineError).code !== 2) throw e;
      return o.queue ? this.hpend({ id, text, at: Date.now(), test: o.test, ...bob }) : { busy: true };
    }
  }
  /** 운영 확인: 산 소켓 수 · 밀린 글 수(D1 engine_at 은 2분 늦을 수 있음 — 이게 진짜 붙음) */
  async hstatus() {
    const all = this.ctx.getWebSockets();
    return { sockets: all.length, open: all.filter(w => !(w.readyState >= 2)).length, online: this.online(), pending: ((await this.q<HPend>("hpending")) || []).length };
  }
  async hpend(p: HPend) { const q = (await this.q<HPend>("hpending")) || []; q.push({ ...p, k: crypto.randomUUID() }); await this.qput("hpending", q.slice(-50)); await this.ctx.storage.setAlarm(Date.now() + 10_000); return { queued: true }; }
  async hmark(k: string | undefined, sending: number | undefined) { const q = (await this.q<HPend>("hpending")) || []; await this.qput("hpending", q.map(x => x.k === k ? { ...x, sending } : x)); }
  async hdrop(k?: string) { const q = (await this.q<HPend>("hpending")) || []; await this.qput("hpending", q.filter(x => x.k !== k)); }
  hflushing = false;
  async hflush() {
    if (this.hflushing || !this.online()) return;
    this.hflushing = true;
    try {
      const q = (await this.q<HPend>("hpending")) || [], held = new Set<string>();
      for (const p of q.filter(x => x.sending)) {
        await hNote(this.env.DB, p.id, "보내는 중 서버가 다시 뜸", p.at);
        await this.hdrop(p.k);
      }
      for (const p of q.filter(x => !x.sending)) {
        if (!this.online()) break;
        if (held.has(p.id)) continue;
        if (Date.now() - p.at > 10 * 60_000) {
          await this.env.DB.prepare("UPDATE engine_window SET note = ? WHERE id = ? AND kind = 'harness'").bind(`보드 글을 10분 동안 못 넣었어요 — ${hhmm(p.at)} 에 보낸 글`, p.id).run();
          await this.hdrop(p.k); continue;
        }
        await this.hmark(p.k, Date.now());
        try { await this.cmd("send", { id: p.id, text: p.text, ...(p.test ? { test: true } : {}), ...(p.owner ? { owner: true } : {}) }, HCMD_MS); }
        catch (e) {
          if ((e as EngineError).code === 2 || (!this.online() && /꺼져/.test((e as Error).message))) { held.add(p.id); await this.hmark(p.k, undefined); continue; }   // 바쁨 · 보내기 전 끊김만 다시
          await hNote(this.env.DB, p.id, String((e as Error).message), p.at);
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
    if ((await this.who()).harness) { await this.hflush(); await this.ctx.storage.setAlarm(Date.now() + ((await this.q<HPend>("hpending"))?.length ? 10_000 : 60_000)); return; }
    try { await this.rules(device, owner); } catch {}
    try { await this.flush(); } catch {}
    try { await this.checkReopens(); } catch {}
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
  }
  async rules(device: string, owner: string, now = Date.now()) {
    const db = this.env.DB, { rules } = await ownerCfg(db, owner), done: string[] = [];
    const rows = (await db.prepare("SELECT * FROM engine_window WHERE device_id = ? AND kind = 'role' AND state IN ('idle','background','busy')").bind(device).all<Win>()).results;
    for (const w of rows) {
      const last = await db.prepare(
        `SELECT l.kind lk, l.at la,
           CASE WHEN l.kind IS NULL OR l.kind <> 'waiting' THEN l.kind
                ELSE (SELECT kind FROM board_log WHERE owner = ?1 AND wid = ?2 AND kind IN ('start','progress','blocked','done','decision','incident','deadline') ORDER BY at DESC LIMIT 1) END wk,
           (SELECT max(at) FROM board_log WHERE owner = ?1 AND wid = ?2 AND kind IN ('session_start','session_end') AND at > coalesce(l.at, -1)) sa
         FROM (SELECT 1) LEFT JOIN (SELECT kind, at FROM board_log WHERE owner = ?1 AND wid = ?2 AND kind IN ('start','progress','blocked','waiting','done','decision','incident','deadline') ORDER BY at DESC LIMIT 1) l ON 1`
      ).bind(owner, w.id).first<{ lk: string | null; la: number | null; wk: string | null; sa: number | null }>();
      const lastKind = last?.lk ?? null, lastAt = last?.la ?? 0, workKind = last?.wk ?? null, sessionAt = last?.sa ?? 0;
      // 기다림은 세션 줄이 풂 · 막힘은 사람이 풀어야 하므로 세션 줄로 안 풂(자동 요약 SessionStart 가 사람 몫 막힘을 조용히 풀지 않게).
      //   막힘 판단도 끝 판단과 같은 기준(workKind — 훅이 턴마다 쓰는 waiting 은 건너뜀): 막힘 → 기다림(Stop 훅) → 세션 시작/끝도 계속 막힘으로 봄
      const held = workKind === "blocked" || (lastKind === "waiting" && sessionAt <= lastAt);
      const card = await db.prepare("SELECT waited_at FROM board_card WHERE owner = ? AND wid = ? AND state = 'open' ORDER BY at DESC LIMIT 1").bind(owner, w.id).first<{ waited_at: number | null }>();
      const waiting = !!card && (card.waited_at || 0) > now - 120_000;
      if (w.state === "busy" && !waiting) continue;   // 그냥 일하는 중
      const since = Math.max(w.state_at || 0, lastAt, sessionAt, w.created_at), quiet = now - since;
      const idle = w.state === "idle";
      if (idle && workKind === "done" && quiet >= rules.close_min * 60_000) {
        if (rules.one_goal !== false) {
          if (!(await this.park(w.id, "끝 — 같은 목표 일이 오면 다시 열림")).ok) continue;
          await sysLine(db, owner, `「${w.name}」 창이 일을 끝내고 쉬어요 — 이 역할 채널에 쓰면 다시 열려요`, w.id); done.push(`park-done ${w.id}`); continue;
        }
        await this.close(w.id); await sysLine(db, owner, `「${w.name}」 창이 일을 끝내고 닫혔어요`, w.id); done.push(`close ${w.id}`); continue;
      }
      if ((held || card) && quiet >= rules.park_min * 60_000) {
        if (!(await this.park(w.id, card ? "사람 답 기다림" : "막힘")).ok) continue;
        await sysLine(db, owner, `「${w.name}」 창을 주차했어요 — ${card ? "질문에 답하면" : "채팅으로 말하면"} 다시 열려요`, w.id); done.push(`park ${w.id}`); continue;
      }
      if (idle && !held && workKind !== "done" && !card && now - Math.max(since, w.woke_at || 0) >= rules.wake_min * 60_000) {
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
type Imp = Item & { device_id: string; handle: string | null };
//   어느 창이 메인 봇인지는 사람이 고름(설정 › 노드 primary_item, group.ts primaryPick 의 규칙 — 'auto' · 'none' · 고른 창).
export async function importedPrimary(db: D1Database, owner: string): Promise<Imp | null> {
  const pick = (await readPrefs(db, owner).catch(() => null))?.primary_item ?? "auto";
  if (pick === "none") return null;
  const engineMain = pick === "auto" && !!(await db.prepare("SELECT 1 FROM engine_window w JOIN device d ON d.id = w.device_id WHERE w.owner = ? AND w.kind = 'main' AND w.state NOT IN ('closed','failed','gone') AND d.revoked_at IS NULL LIMIT 1").bind(owner).first().catch(() => null));
  if (engineMain) return null;
  const rows = (await db.prepare("SELECT i.key, i.kind, i.engine, i.title, i.cwd, i.state, i.state_at, i.seen_at, i.win, i.session, i.handle, i.device_id, i.gone_at FROM imp_item i JOIN device d ON d.id = i.device_id WHERE i.owner = ? AND i.kind = 'window' AND i.gone_at IS NULL AND d.revoked_at IS NULL").bind(owner).all<Imp>().catch(() => ({ results: [] as Imp[] }))).results;
  return primaryPick(rows, pick, false).primary;
}
export const PRIMARY_HINT = `(This is the person's Boarder Primary chat; this window is their main bot. If the board has top-level nodes (parent = "top"), split only among those nodes; recipients may split further only to their own direct children, never to another branch. With no top-level nodes, keep the existing routing. They don't see this terminal — answer with \`boarder chat "<text>"\` — if the head above says 「스레드 <id>」, answer under that message with \`boarder chat --thread <id> "<text>"\` — short, in their language. An ask that belongs to another node or role window: hand it there with \`boarder split <id> --why "<one line>" --part "<node>: <their words>"\`; if you can't tell which one, ask them in one line under their message instead of guessing.)`;
export async function toImported(env: EngEnv, owner: string, w: Pick<Imp, "key" | "device_id" | "engine" | "handle" | "title" | "state">, text: string, extra?: { primary: true }) {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20), handle = (() => { try { return w.handle ? JSON.parse(w.handle) : null; } catch { return null; } })();
  await env.DB.prepare("INSERT INTO engine_cmd(id, owner, device_id, verb, args, at) VALUES (?,?,?,?,?,?)")
    .bind(id, owner, w.device_id, w.state === "parked" ? "reopen" : "send", JSON.stringify({ item: w.key, engine: w.engine, handle, title: w.title, text, post: true, ...extra }), Date.now()).run();
  try { await (engineOf(env, w.device_id) as unknown as { drainCmds(): Promise<unknown> }).drainCmds(); } catch {}   // 엔진 소켓이 붙어 있으면 바로, 아니면 boarder import --follow 가 가져감
  return { queued: true, primary: w.key };
}

async function mainOf(env: EngEnv, owner: string) {
  return env.DB.prepare(`SELECT w.id, w.device_id, d.engine_at FROM engine_window w JOIN device d ON d.id = w.device_id WHERE w.owner = ? AND w.kind = 'main' AND w.state NOT IN ('closed','failed') AND d.revoked_at IS NULL ORDER BY (d.engine_at > ?) DESC, w.created_at DESC LIMIT 1`).bind(owner, Date.now() - 120_000).first<{ id: string; device_id: string; engine_at: number | null }>();
}
/** 회원 Primary 채팅 글 → 메인 봇 판(없으면 엔진 기기에서 새로) */
export async function chatToMain(env: EngEnv, owner: string, text: string, head = boardHead({})) {
  const imp = await importedPrimary(env.DB, owner);
  if (imp) return toImported(env, owner, imp, `${head} [Boarder chat] ${text}\n${PRIMARY_HINT}`);
  const main = await mainOf(env, owner), msg = `${head} [Boarder chat] ${text}`;   // 머리 줄 「[보드 · Primary( · 스레드 <ts>)]」(board-head.ts)
  const dev = await liveDevice(env.DB, owner, true);
  if (main && (!dev || Date.now() - (main.engine_at || 0) < 120_000)) return engineOf(env, main.device_id).deliver(main.id, msg);
  if (!dev) return { offline: true };
  if (main) await env.DB.prepare("UPDATE engine_window SET state = 'closed', state_at = ?, closed_at = ?, note = ? WHERE id = ?").bind(Date.now(), Date.now(), "다른 기기로 옮김", main.id).run();   // 옛 기기 창은 그 데몬이 다시 붙을 때 hello 가 닫음
  const stub = engineOf(env, dev), id = await stub.ensureMain(owner, dev);
  if (id) await stub.deliver(id, msg);
  else {
    const imp2 = await importedPrimary(env.DB, owner);
    if (imp2) return toImported(env, owner, imp2, `${msg}\n${PRIMARY_HINT}`);
  }
  return { started: !!id };
}
export async function noteMain(env: EngEnv, owner: string, text: string) {
  const imp = await importedPrimary(env.DB, owner);
  if (imp) return toImported(env, owner, imp, text);
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
  try { w = await openRole(env, owner, dev, roleId, { name: d.name, instructions: d.instructions, cwd }, "approved"); }
  catch (e) {
    await db.batch([db.prepare("UPDATE role_draft SET state = 'draft', role_id = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), d.id), db.prepare("DELETE FROM role WHERE owner = ? AND id = ?").bind(owner, roleId)]);
    throw e;
  }
  return { role_id: roleId, window: w.id };
}
export type RoleSpec = { name: string; instructions: string; cwd: string } & RoleMore;
export async function openRole(env: EngEnv, owner: string, dev: string, roleId: string, r: RoleSpec, how: "approved" | "created" | "pending", open?: (o: Parameters<Engine["open"]>[0]) => Promise<{ id: string }>) {
  const db = env.DB, { rules } = await ownerCfg(db, owner).catch(() => ({ rules: RULES }));
  const o = { owner, kind: "role" as const, role_id: roleId, name: r.name, cwd: r.cwd, prompt: rolePrompt(r.name, r.instructions, rules.one_goal !== false, r) };
  const w = open ? await open(o) : await engineOf(env, dev).open(o);
  await sysLine(db, owner, `「${r.name}」 창을 열었어요`, w.id).catch(() => null);
  // 메인 봇도 알게. 미뤄 둔 역할(엔진 DO 안 hello)은 같은 DO 를 다시 부르지 않게 알리지 않음 — 시스템 줄은 남음
  if (how !== "pending") await noteMain(env, owner, `[Boarder] The person ${how === "approved" ? "approved" : "made in Boarder settings"} the role "${r.name}" and Boarder opened its window. Tell them in one line with boarder chat.`).catch(() => null);
  return w;
}
export const OPEN_PER_HOUR = 30;
export const openedLastHour = async (db: D1Database, owner: string) => (await db.prepare("SELECT count(*) AS n FROM engine_window WHERE owner = ? AND created_at > ?").bind(owner, Date.now() - 3600_000).first<{ n: number }>())?.n || 0;
export const pendingRoles = async (db: D1Database, owner: string) => (await db.prepare("SELECT count(*) AS n FROM role WHERE owner = ? AND (CASE WHEN json_valid(engine) THEN json_extract(engine, '$.pending') END) = 1").bind(owner).first<{ n: number }>())?.n || 0;
export async function sameGoalWindow(db: D1Database, owner: string, name: string, o: { liveOnly?: boolean } = {}): Promise<{ name: string; id: string | null; pending: boolean } | null> {
  const cfg = await db.prepare("SELECT (SELECT rules FROM engine_owner WHERE owner = ?1) rules, (SELECT json_extract(data, '$.rules.one_goal') FROM node_setting WHERE owner = ?1 AND json_valid(data)) og").bind(owner).first<{ rules: string | null; og: number | null }>().catch(() => null);
  let oneGoal = true; try { oneGoal = JSON.parse(cfg?.rules || "{}").one_goal !== false; } catch {}
  if (cfg?.og === 0 || cfg?.og === 1) oneGoal = cfg.og === 1;
  if (!oneGoal) return null;
  const norm = (t: string) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();
  const live = (await db.prepare("SELECT r.name, w.id FROM role r JOIN engine_window w ON w.role_id = r.id AND w.owner = r.owner WHERE r.owner = ? AND w.state NOT IN ('closed','failed') AND w.device_id IN (SELECT id FROM device WHERE revoked_at IS NULL)").bind(owner).all<{ name: string; id: string }>()).results;
  const w = live.find(x => norm(x.name) === norm(name));
  if (w) return { name: w.name, id: w.id, pending: false };
  if (o.liveOnly) return null;
  const wait = (await db.prepare("SELECT id, name FROM role WHERE owner = ? AND (CASE WHEN json_valid(engine) THEN json_extract(engine, '$.pending') END) = 1").bind(owner).all<{ id: string; name: string }>()).results;
  const p = wait.find(x => norm(x.name) === norm(name));
  return p ? { name: p.name, id: null, pending: true } : null;
}

export async function harnessDevice(db: D1Database) {
  return db.prepare("SELECT id, owner, engine_at FROM device WHERE scope = 'harness' AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").first<{ id: string; owner: string; engine_at: number | null }>();
}
export async function engineSend(env: EngEnv, pane: string, text: string, o: { test?: boolean; queue?: boolean; owner?: boolean } = {}) {
  const id = paneWid(pane); if (!id) throw new EngineError(4, "판 번호(%N)만");
  const d = await harnessDevice(env.DB);
  if (!d || (!o.queue && Date.now() - (d.engine_at || 0) > 120_000)) return { offline: true };
  type Sent = { sent?: boolean; to?: string; busy?: boolean; queued?: boolean; offline?: boolean; reopening?: boolean };
  return (engineOf(env, d.id) as unknown as { hsend: (id: string, text: string, o: object) => Promise<Sent> }).hsend(id, text, o);   // RPC 스텁 형이 너무 깊어(TS2589) 모양만
}
export async function engineLog(env: EngEnv, pane: string, name = ""): Promise<{ messages: unknown[]; kind: string | null; live: boolean } | null> {
  const id = paneWid(pane); if (!id) return null;
  const d = await harnessDevice(env.DB); if (!d) return null;
  try {
    const r = await (engineOf(env, d.id) as unknown as { cmd(v: string, a: object): Promise<any> }).cmd("log", { id, ...(name ? { name } : {}) });
    return r && Array.isArray(r.messages) ? { messages: r.messages, kind: typeof r.kind === "string" ? r.kind : null, live: !!r.live } : null;
  } catch { return null; }
}
export async function ownerWindows(env: EngEnv) {
  const d = await harnessDevice(env.DB); if (!d) return { online: false, windows: [] };
  const rows = (await env.DB.prepare("SELECT id, name, state, state_at, dialog, note, handle FROM engine_window WHERE device_id = ? AND kind = 'harness' AND state != 'closed' ORDER BY id").bind(d.id).all<{ id: string; name: string; state: string; state_at: number; dialog: string | null; note: string | null; handle: string | null }>()).results;
  return { online: Date.now() - (d.engine_at || 0) < 120_000, at: d.engine_at, windows: rows.map(r => ({ id: r.id, pane: widPane(r.id), name: r.name, state: r.state, since: r.state_at, dialog: r.dialog, note: r.note, meta: (() => { try { return JSON.parse(r.handle || "null"); } catch { return null; } })() })) };
}
