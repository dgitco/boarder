import { converters, redact, toConversation, type ConverterId, type ParseState } from "../session";

type Env = { DB: D1Database; RESULTS: R2Bucket };
export type SessionRow = { id: string; owner: string; tool: string; native: string; title: string; cwd: string; repo: string; branch: string; model: string; host: string; win: string; lines: number; messages: number; parts: number; state: string; created_at: number; updated_at: number };
type Msg = { role: string; at: number; text: string };

export const MAX_CHUNK = 6 * 1024 * 1024;
const TOOLS = new Set(Object.keys(converters));
const RESUME: Record<string, (n: string) => string> = { "claude-code": n => `claude --resume ${n}`, codex: n => `codex resume ${n}`, "gemini-cli": () => "gemini --resume" };
const key = (owner: string, sid: string, n: number) => `sessions/${owner || "_"}/${encodeURIComponent(sid)}/${String(n).padStart(5, "0")}.json`;
const sidOf = (tool: string, native: string) => `${tool}:${native}`;

export const validTool = (t: string): t is ConverterId => TOOLS.has(t);
export const validNative = (n: string) => /^[\w.-]{6,120}$/.test(n);

export async function syncOn(env: Env, owner: string) {
  const r = await env.DB.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = 'session_sync'").bind(owner).first<{ v: string }>();
  return r?.v !== "off";
}
export async function setSync(env: Env, owner: string, on: boolean) {
  await env.DB.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?, 'session_sync', ?, ?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(owner, on ? "on" : "off", Date.now()).run();
}
export const SYNC_OFF = { error: "세션 싱크가 꺼져 있어요 — 설정 › 세션에서 켜요", sync: "off" } as const;

export async function offset(env: Env, owner: string, tool: string, native: string) {
  const r = await env.DB.prepare("SELECT lines, messages FROM ai_session WHERE owner = ? AND id = ?").bind(owner, sidOf(tool, native)).first<{ lines: number; messages: number }>();
  return { lines: r?.lines ?? 0, messages: r?.messages ?? 0 };
}

/** 조각 하나(from 줄부터). from 이 저장된 줄 수와 다르면 409 — 같은 조각을 두 번 넣지 않게 */
export async function upload(env: Env, owner: string, meta: { tool: ConverterId; native: string; from: number; host: string; win: string; cwd?: string; repo?: string }, text: string) {
  const sid = sidOf(meta.tool, meta.native);
  const row = await env.DB.prepare("SELECT * FROM ai_session WHERE owner = ? AND id = ?").bind(owner, sid).first<SessionRow>();
  const have = row?.lines ?? 0;
  if (meta.from !== have) return { status: 409 as const, body: { error: "줄 위치가 다름", lines: have } };
  const lines = text.split("\n"); if (lines.at(-1) === "") lines.pop();
  const claimAt = Date.now();
  const claim = row
    ? await env.DB.prepare("UPDATE ai_session SET lines = ?, updated_at = ? WHERE owner = ? AND id = ? AND lines = ?").bind(have + lines.length, claimAt, owner, sid, have).run()
    : await env.DB.prepare("INSERT INTO ai_session(id, owner, tool, native, lines, created_at, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner, id) DO NOTHING").bind(sid, owner, meta.tool, meta.native, lines.length, claimAt, claimAt).run();
  if (!claim.meta.changes) return { status: 409 as const, body: { error: "줄 위치가 다름", lines: (await offset(env, owner, meta.tool, meta.native)).lines } };
  const prev = row?.state ? JSON.parse(row.state) as ParseState : undefined;
  const r = converters[meta.tool](lines, prev);
  const msgs: Msg[] = toConversation(r.events).map(m => ({ role: m.role, at: m.at, text: redact(m.text) }));
  const restart = !!row && row.win === "0b" && have === 0;
  const n = restart ? 0 : row?.parts ?? 0, now = Date.now();
  if (msgs.length) await env.RESULTS.put(key(owner, sid, n), JSON.stringify(msgs), { httpMetadata: { contentType: "application/json" } });
  const firstAsk = msgs.find(m => m.role === "user")?.text.replace(/\s+/g, " ").trim().slice(0, 80);
  const title = redact(r.meta.title || row?.title || firstAsk || "").slice(0, 200), cwd = redact(meta.cwd || r.meta.cwd || row?.cwd || "").slice(0, 300);
  meta.repo = redact((meta.repo || "").replace(/^([a-z+]+:\/\/)[^@/]+@/i, "$1"));
  await env.DB.prepare(`INSERT INTO ai_session(id, owner, tool, native, title, cwd, repo, branch, model, host, win, lines, messages, parts, state, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(owner, id) DO UPDATE SET title = excluded.title, cwd = excluded.cwd, repo = CASE WHEN excluded.repo != '' THEN excluded.repo ELSE ai_session.repo END, branch = excluded.branch, model = excluded.model,
      host = excluded.host, win = excluded.win, lines = excluded.lines, messages = excluded.messages, parts = excluded.parts, state = excluded.state, updated_at = excluded.updated_at`)
    .bind(sid, owner, meta.tool, meta.native, title, cwd, (meta.repo || "").slice(0, 200), (r.meta.branch || row?.branch || "").slice(0, 120), (r.meta.model || row?.model || "").slice(0, 80),
      meta.host.slice(0, 60), meta.win.slice(0, 80), have + lines.length, (restart ? 0 : row?.messages ?? 0) + msgs.length, n + (msgs.length ? 1 : 0), JSON.stringify(r.state), row?.created_at ?? (r.meta.startedAt || now), now).run();
  return { status: 200 as const, body: { id: sid, lines: have + lines.length, messages: (restart ? 0 : row?.messages ?? 0) + msgs.length, added: msgs.length } };
}

export async function list(env: Env, owner: string, query: string | undefined, limit: number) {
  const q = (query || "").trim();
  const r = q
    ? await env.DB.prepare("SELECT id, tool, title, cwd, repo, branch, host, win, messages, updated_at FROM ai_session WHERE owner = ?1 AND (title LIKE ?2 OR cwd LIKE ?2 OR repo LIKE ?2 OR win LIKE ?2 OR id LIKE ?2) ORDER BY updated_at DESC LIMIT ?3")
      .bind(owner, `%${q.replace(/[%_]/g, "")}%`, limit).all()
    : await env.DB.prepare("SELECT id, tool, title, cwd, repo, branch, host, win, messages, updated_at FROM ai_session WHERE owner = ? ORDER BY updated_at DESC LIMIT ?").bind(owner, limit).all();
  return { sessions: r.results };
}

export async function handoff(env: Env, owner: string, id: string, last = 30) {
  const s = await env.DB.prepare("SELECT * FROM ai_session WHERE owner = ? AND id = ?").bind(owner, id).first<SessionRow>();
  if (!s) throw new Error("없는 세션");
  const msgs: Msg[] = [];
  for (let n = s.parts - 1; n >= 0 && msgs.length < last; n--) {
    const o = await env.RESULTS.get(key(owner, s.id, n)); if (!o) continue;
    msgs.unshift(...(await o.json<Msg[]>()));
  }
  const tail = msgs.slice(-last), resume = RESUME[s.tool]?.(s.native);
  const head = [`# ${s.title || s.id}`, `- 도구: ${s.tool} · 기기: ${s.host || "?"} · 창: ${s.win || "?"}`, s.cwd && `- 폴더: ${s.cwd}`, (s.repo || s.branch) && `- 리포: ${s.repo}${s.branch ? ` (${s.branch})` : ""}`,
    resume && `- 같은 기기에서 다시 열기: \`${resume}\``, `- 대화 ${s.messages}개 중 마지막 ${tail.length}개(사람 · 에이전트 글만, 비밀 가림)`].filter(Boolean).join("\n");
  // 글 하나로 붙이면 도구 결과 자르기(4000자)에 걸림 — 머리 글 + 대화 목록으로
  const messages = tail.map(m => ({ who: m.role === "user" ? "사람" : "에이전트", at_kst: new Date(m.at + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " "), text: m.text }));
  return { id: s.id, title: s.title, resume, header: head, messages };
}
