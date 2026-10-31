// Boarder API(Hono) — /api/* 만 Worker 가 받고, 나머지는 React 정적 자산(SPA)
import { Hono, type Context } from "hono";
import { z } from "zod";
import { METRICS_MAX_BYTES, putMetrics, listDevices, readCapped, tooSoon } from "./devices";
import { legal } from "./legal";
import { createAuth, allowed, isOwner, member, type Env as AuthEnv } from "./auth";
import { installPrompt, BOARDER_SKILL, memberOnboard, type Bot } from "./install";
import { landingPage } from "./landing";
import { localTools } from "./local";
import { addFeedback } from "./feedback";
export { BoardSnap } from "./board";
export { Bridge } from "./bridge";
export { Engine } from "./engine";
export { Search } from "./search";
export { Pusher } from "./push-do";
import { engineOf, chatToMain, approveDraft, deliverTo, ownerCfg, sysLine, RULES, engineSend, ownerWindows, harnessDevice, type Engine } from "./engine";
import shellJs from "./legacy/shell.js?raw";
import shellCss from "./legacy/shell.css?raw";
import installSh from "./install/install.sh?raw";
import installPs1 from "./install/install.ps1?raw";
import settingsJs from "./legacy/settings.js?raw";
import settingsCss from "./legacy/settings.css?raw";
import blobJs from "./legacy/blobatar.js?raw";
import botPickJs from "./legacy/botpick.js?raw";
import { snippet, capture, phId, type PH } from "./posthog";
import { mcp } from "./mcp/server";
import { run as runTool, SCHEMAS } from "./mcp/tools";
import { registry, view, dropCache, diff } from "./mcp/registry";
import { mountConnectors } from "./connectors/routes";
import { mountHooks } from "./connectors/hooks";
import * as sessions from "./connectors/sessions";
import { catalog } from "./connectors/store";
import { open as unseal, seal } from "./connectors/seal";
import { mountImport, onCardAnswered, regroup, setUnit } from "./importer/routes";
import * as ledger from "./ledger";
import * as ownerWrite from "./owner-write";
import * as ledgerWrite from "./ledger-write";
import SCHEMA from "./ledger-schema";
import * as files from "./files";
import * as ownerRead from "./owner-read";
import * as OS from "./owner-state";
import * as memberBoard from "./member-board";
import * as emoji from "./emoji";
import * as memberSearch from "./member-search";
import { newMeter, meterEnv, meterProps, sampleOf } from "./perf";
import * as PU from "./push";
import { resolve as pushResolve, cardLoc } from "./push-do";
import { hosted } from "./hosted";   // 호스팅 전용(ee/) — 공개 판에선 빈 확장
import * as live from "./live";
import * as queue from "./queue";
import * as bxs from "./bxs";

type Env = AuthEnv & PH & { SNAP: DurableObjectNamespace<import("./board").BoardSnap>; BRIDGE: DurableObjectNamespace<import("./bridge").Bridge>; RELAY_TOKEN: string; LEDGER_TOKEN?: string; ADMIN_TOKEN?: string; ENGINE: DurableObjectNamespace<Engine>; RESULTS: R2Bucket; CF_VERSION_METADATA: WorkerVersionMetadata; CONNECTOR_KEY?: string; SEARCH: DurableObjectNamespace<import("./search").Search>; AI: Ai; OB_EXPORT_SIGN_KEY?: string; OB_EXPORT_URL?: string; PUSH: DurableObjectNamespace<import("./push-do").Pusher>; VAPID_PRIVATE?: string; SOURCE_URL?: string; FAULT_OK?: string };
const app = new Hono<{ Bindings: Env }>();
const KEYS = new Set(["data", "topics", "page", "cfg", "history", "emoji"]);
const bridge = (env: Env, ch = "owner") => env.BRIDGE.get(env.BRIDGE.idFromName(ch === "test" ? "test@wnam" : "owner@wnam"), { locationHint: "wnam" });
const boardCall = async (env: Env, ch: string, r: { method: string; path: string; headers: Record<string, string>; body?: Uint8Array }) => (hosted.exec && await hosted.exec.on(env.DB)) ? hosted.exec.call(env, ch, r) : bridge(env, ch).call(r);
// 에이전트 도구(받은편지함 · 감시 줄 · 웹훅 깨우기)도 같은 스위치로 — 실행기가 bridge.mjs 와 같은 명령 · 같은 인자 검사(relay-tools.mjs)
const boardTool = async (env: Env, ch: string, name: string, args: Record<string, unknown>, agent: string) => (hosted.exec && await hosted.exec.on(env.DB)) ? hosted.exec.tool(env, ch, name, args, agent) : bridge(env, ch).tool(name, args, agent);
const chOf = (c: Context<{ Bindings: Env }>) => /(?:^|;\s*)bx-ch=test(?:;|$)/.test(c.req.header("cookie") || "") ? "test" : "owner";
const snap = (env: Env) => env.SNAP.get(env.SNAP.idFromName(live.OWNER_SNAP), { locationHint: "apac" });
const search = (env: Env) => env.SEARCH.get(env.SEARCH.idFromName("owner@wnam"), { locationHint: "wnam" });
const pusher = (env: Env) => env.PUSH.get(env.PUSH.idFromName("owner"), { locationHint: "apac" }) as unknown as import("./push-do").PushApi;
let pushKick = 0;   // 알람 처음 걸기(배포 뒤 · DO 비움 뒤): isolate 마다 1분에 한 번 — 릴레이 sync(10초마다)가 부름
const kickPush = (env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => { if (Date.now() - pushKick < 60_000) return; pushKick = Date.now(); ctx.waitUntil(pusher(env).ensure().catch(() => { pushKick = 0; })); };

type Sess = { user: { email: string } };
async function hmac(env: Env, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.BETTER_AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)))].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}
const cookieOf = (c: Context<{ Bindings: Env }>, n: string) => new RegExp(`(?:^|;\\s*)${n.replace(/[.$]/g, "\\$&")}=([^;]+)`).exec(c.req.header("cookie") || "")?.[1];
const AUTHC = new Map<string, { at: number; email: string }>();
async function dbCheck(c: Context<{ Bindings: Env }>, th: string): Promise<string | null> {
  const hit = AUTHC.get(th);
  if (hit && Date.now() - hit.at < 60_000) return hit.email;
  const r = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers, query: { disableCookieCache: true } });
  const e = r && await member(c.env, r.user.email) ? r.user.email : null;
  if (e) { if (AUTHC.size > 500) AUTHC.clear(); AUTHC.set(th, { at: Date.now(), email: e }); } else AUTHC.delete(th);
  return e;
}
async function bxCookie(c: Context<{ Bindings: Env }>, email: string, th: string) {
  const exp = Date.now() + 600_000, v = `${email}|${exp}|${await hmac(c.env, `bx_s|${email}|${exp}|${th}`)}`;
  return `bx_s=${encodeURIComponent(v)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`;
}
async function signedIn(c: Context<{ Bindings: Env }>): Promise<Sess | null> {
  const t0 = Date.now();
  const tok = cookieOf(c, "__Secure-better-auth.session_token") || cookieOf(c, "better-auth.session_token");
  if (!tok) { seg(c.req.raw, "auth", Date.now() - t0); return null; }
  let bx = ""; try { bx = decodeURIComponent(cookieOf(c, "bx_s") || ""); } catch {}
  const th = (await sha(tok)).slice(0, 32);
  const m = /^([^|]{3,200})\|(\d{13})\|([0-9a-f]{32})$/.exec(bx);
  let s: Sess | null = null;
  const rec = REC.get(c.req.raw);
  if (m && +m[2] > Date.now() && sameToken(m[3], await hmac(c.env, `bx_s|${m[1]}|${m[2]}|${th}`))) {
    s = { user: { email: m[1] } }; hit(c.req.raw, "auth", true);
    // 미리 갈기: 5분 안에 끝나면 D1 확인을 기다리지 않고 띄워 두고, 응답 낼 때(타이밍 미들웨어) 끝나 있으면 새 bx_s — 30초마다 다시 읽는 화면은 0.9초를 안 만남
    if (+m[2] - Date.now() < 300_000 && rec && !rec.renew) { const r: Renew = { th, email: m[1] }; rec.renew = r; c.executionCtx.waitUntil(dbCheck(c, th).then(e => { r.done = e; }, () => { r.done = null; })); }   // 이 요청 안에서 끝냄(못 맞추면 캐시에 남아 다음 요청이 바로)
  } else {
    const e = await dbCheck(c, th); hit(c.req.raw, "auth", false);
    if (e) { s = { user: { email: e } }; rec?.cookies.push(await bxCookie(c, e, th)); }
  }
  seg(c.req.raw, "auth", Date.now() - t0);
  if (s) who(c.req.raw, s.user.email);
  return s;
}

type Renew = { th: string; email: string; done?: string | null };   // 미리 갈기(signedIn → 타이밍 미들웨어)
const REC = new WeakMap<Request, { seg: Record<string, number>; who?: string; dev?: string; cookies: string[]; renew?: Renew; hit?: Record<string, number> }>();
const hit = (req: Request, name: string, yes: boolean) => { const r = REC.get(req); if (r) (r.hit ||= {})[`cache_${name}`] = yes ? 1 : 0; };   // 캐시 맞음 1 · 빗나감 0 — PostHog boarder_request
function seg(req: Request, name: string, ms: number) { const r = REC.get(req); if (r) r.seg[name] = (r.seg[name] || 0) + Math.max(0, ms); }
function who(req: Request, id: string) { const r = REC.get(req); if (r) r.who = id; }
function bridgeSeg(req: Request, total: number, h: Record<string, string>) {
  const doMs = +h["x-do-ms"] || 0, board = +h["x-relay-board-ms"] || 0;
  if (!doMs) return seg(req, "bridge", total);
  seg(req, "hop", total - doMs); seg(req, "relay", doMs - board); seg(req, "board", board);
}
const normPath = (p: string) => p.replace(/\/\d{10}\.\d{6}/g, "/:ts").replace(/\/[0-9a-f]{32}(\.[a-z0-9]+)?/g, "/:hash").replace(/\/(?:%25|%)\d+/g, "/:pane")
  .replace(/\/[A-Za-z0-9_-]{16,}/g, "/:id").replace(/\/[^/]+\.dc\.html$/, "/:board.dc.html").replace(/\/[^/]+\.[A-Za-z0-9]{1,5}$/, "/:file").slice(0, 80);
app.use("*", async (c, next) => {
  const t0 = Date.now(), rec = { seg: {} as Record<string, number>, who: undefined as string | undefined, dev: undefined as string | undefined, cookies: [] as string[] }, meter = newMeter();
  REC.set(c.req.raw, rec);
  c.env = meterEnv(c.env, meter);   // D1 · DO · R2 시간 · 횟수(perf.ts) — 재기만 함
  await next();
  // 미리 갈기(signedIn): D1 확인이 이미 끝났고 같은 사람이면 새 bx_s(안 끝났으면 기다리지 않음 — 다음 요청이 60초 캐시로 받음)
  const rn = (rec as { renew?: Renew }).renew;
  if (rn?.done && rn.done === rn.email) rec.cookies.push(await bxCookie(c, rn.email, rn.th));
  const lw = rec.who && /^[^@\s:%]+@[^@\s:%]+$/.test(rec.who) ? rec.who : rec.dev;
  if (lw && !["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.res.status < 400 && !isOwner(c.env, lw) && !/^\/api\/(relay\/|device\/metrics)/.test(c.req.path))
    c.executionCtx.waitUntil(live.bumpMember(c.env, lw));
  const total = Date.now() - t0, st = [...Object.entries(rec.seg).map(([k, v]) => `${k};dur=${v}`), ...(meter.d1rn ? [`d1r;dur=${meter.d1r};desc=${meter.d1rn}`] : []), ...(meter.d1wn ? [`d1w;dur=${meter.d1w};desc=${meter.d1wn}`] : []), ...(meter.dobn ? [`dob;dur=${meter.dob};desc=${meter.dobn}`] : []), ...(meter.r2n ? [`r2m;dur=${meter.r2};desc=${meter.r2n}`] : []), `total;dur=${total}`].join(", ");
  if (c.res.status === 101 || (c.res as any).webSocket) { }
  else {
    try { c.res.headers.set("server-timing", st); }
    catch { const r = c.res; c.res = new Response(r.body, { status: r.status, statusText: r.statusText, headers: new Headers(r.headers), ...((r as any).encodeBody ? { encodeBody: (r as any).encodeBody } : {}) }); c.res.headers.set("server-timing", st); }
    for (const ck of rec.cookies) c.res.headers.append("set-cookie", ck);
  }
  const url = new URL(c.req.url);
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && url.pathname.startsWith("/api/") && c.res.status < 400 && (!url.pathname.startsWith("/api/relay/") || url.pathname === "/api/relay/write"))
    console.log(JSON.stringify({ ev: "api_write", path: normPath(url.pathname), method: c.req.method, status: c.res.status, ms: total, ...rec.seg }));
  if (url.pathname === "/api/relay/write" && c.res.status < 400) { if (Math.random() < 0.1) capture(c.env, c.executionCtx, "boarder_request", "relay", { path: "/api/relay/write", method: c.req.method, status: c.res.status, total_ms: total, sample: 10, ...Object.fromEntries(Object.entries(rec.seg).map(([k, v]) => [`${k}_ms`, v])), ...meterProps(meter), colo: (c.req.raw as any).cf?.colo }); return; }
  if (url.pathname.startsWith("/api/relay/") || url.pathname.startsWith("/ph/") || url.pathname === "/api/health") return;
  const rid = (c.req.header("x-request-id") || "").slice(0, 40);   // 화면이 붙인 요청 id(R5) — 보드 errors.jsonl · 화면 boarder_error 와 같은 값
  if (c.res.status >= 400 && url.pathname.startsWith("/api/")) console.log(JSON.stringify({ ev: "api_error", rid, path: normPath(url.pathname), method: c.req.method, status: c.res.status, ms: total, ...rec.seg }));   // Workers Logs(observability)
  if (!rec.who && c.res.status < 500) return;
  const np = normPath(url.pathname), sample = sampleOf(np, c.req.method, c.res.status);
  if (sample > 1 && Math.random() >= 1 / sample) return;
  capture(c.env, c.executionCtx, "boarder_request", rec.who || "anon", {
    path: np, method: c.req.method, status: c.res.status, total_ms: total, sample, ...(rid ? { rid } : {}),
    ...Object.fromEntries(Object.entries(rec.seg).map(([k, v]) => [`${k}_ms`, v])), ...meterProps(meter), ...(rec as { hit?: Record<string, number> }).hit,
    colo: (c.req.raw as any).cf?.colo, entry: (c.req.header("cf-ray") || "").split("-")[1], country: (c.req.raw as any).cf?.country, $current_url: undefined,
  });
});
app.use("*", async (c, next) => {
  if ((queue.FAULT.d1 || queue.FAULT.d1after) && !/^\/api\/(admin\/fault|relay\/)/.test(c.req.path)) c.env = { ...c.env, DB: queue.FAULT.d1 ? queue.brokenDB(c.env.DB) : queue.lostDB(c.env.DB) };
  if (c.req.method !== "POST" || !queue.QPATHS.has(c.req.path) || !(await ledger.f7On(c.env.DB, "write_queue"))) return next();
  const s = await signedIn(c); if (!s) return next();
  return queue.idem(c as never, s.user.email, next, ms => seg(c.req.raw, "claim", ms));
});
app.get("/api/rid/:rid", async c => { const s = await signedIn(c); return s ? queue.look(c as never, s.user.email) : c.json({ error: "로그인" }, 401); });
app.post("/api/admin/rid/drop", async c => {   // 배포 뒤 옛 코드로 남은 rid 칸 DO 를 내림(live/drop 처럼) — { who: 메일 }
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ who?: string }>().catch(() => ({} as { who?: string }));
  if (!/^[^@\s]{1,80}@[^@\s]{1,120}$/.test(b.who || "")) return c.json({ error: "who = 메일" }, 400);
  try { await queue.dropRid(c.env as never, b.who!); } catch {}
  return c.json({ ok: true });
});
app.post("/api/admin/fault", async c => {   // 로컬 시험만: { do?: bool, d1?: bool }
  if (c.env.FAULT_OK !== "1" || !admin(c)) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<{ do?: boolean; d1?: boolean; d1after?: boolean }>().catch(() => ({} as { do?: boolean; d1?: boolean; d1after?: boolean }));
  if (b.do !== undefined) queue.FAULT.do = !!b.do; if (b.d1 !== undefined) queue.FAULT.d1 = !!b.d1; if (b.d1after !== undefined) queue.FAULT.d1after = !!b.d1after;
  return c.json({ ok: true, ...queue.FAULT });
});
const sameToken = (a: string, b: string) => { if (!a || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };

app.get("/api/health", async c => {
  const st = async (o: { health(): Promise<unknown> }) => { try { return await o.health(); } catch (e) { return { error: String(e).slice(0, 120) }; } };
  return c.json({ ok: true, bridge: await st(bridge(c.env)), ...(await hosted.health?.(c.env)) });
});
app.all("/ph/*", async c => {
  const u = new URL(c.req.url), rest = u.pathname.slice(3);
  const host = rest.startsWith("/static/") ? "us-assets.i.posthog.com" : "us.i.posthog.com";
  const h = new Headers(); for (const k of ["content-type", "content-encoding", "accept", "accept-encoding", "user-agent"]) { const v = c.req.header(k); if (v) h.set(k, v); }
  const ip = c.req.header("cf-connecting-ip"); if (ip) h.set("x-forwarded-for", ip);
  const r = await fetch(`https://${host}${rest}${u.search}`, { method: c.req.method, headers: h, body: ["GET", "HEAD"].includes(c.req.method) ? undefined : await c.req.arrayBuffer() });
  const out = new Headers(r.headers); out.delete("set-cookie");
  return new Response(r.body, { status: r.status, headers: out });
});
app.on(["GET", "POST"], "/api/auth/*", c => createAuth(c.env).handler(c.req.raw));
const lookAt = new Map<string, number[]>();
app.post("/api/login/lookup", async c => {
  const ip = c.req.header("cf-connecting-ip") || "", now = Date.now();
  const xs = (lookAt.get(ip) || []).filter(t => t > now - 600_000);
  if (xs.length >= 30) return c.json({ ok: false, error: "rate_limited", retryAfterSeconds: 60 }, 429);
  xs.push(now); lookAt.set(ip, xs); if (lookAt.size > 5000) lookAt.clear();
  const b = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
  const email = String(b.email || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ ok: false, error: "email_invalid" }, 400);
  if (!(await member(c.env, email))) return c.json({ ok: false, error: "invite_required" });
  return c.json({ account: "exists", methods: { code: true, google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) } });
});
app.get("/api/login/methods", c => c.json({ code: true, google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET), home: c.env.PUBLIC_URL }));   // 로그인 화면이 켤 단추(구글은 콜백이 PUBLIC_URL 이라 다른 주소에선 거기로 옮겨 시작)
app.get("/api/me", async c => {   // 이름 · id 까지 — 서명 쿠키 말고 better-auth 로(가끔만 부름)
  const s0 = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers }), s = s0 && await member(c.env, s0.user.email) ? s0 : null;
  return s ? c.json({ user: { id: s.user.id, email: s.user.email, name: s.user.name, owner: isOwner(c.env, s.user.email) } }) : c.json({ user: null }, 401);
});

async function gunzipCapped(body: ReadableStream<Uint8Array>, cap: number) {
  const r = (body as ReadableStream).pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader(), parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read(); if (done) break;
    n += value.length;
    if (n > cap) { await r.cancel().catch(() => {}); throw new Error("too big"); }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return new TextDecoder().decode(out);
}
app.put("/api/relay/snap/:key", async c => {
  const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!c.env.RELAY_TOKEN || !sameToken(tok, c.env.RELAY_TOKEN)) return c.json({ error: "no" }, 403);
  const key = c.req.param("key"); if (!KEYS.has(key)) return c.json({ error: "모르는 칸" }, 400);
  const t0 = Date.now();
  let body: string;
  try { body = c.req.header("content-encoding") === "gzip" ? await gunzipCapped(c.req.raw.body!, 4_000_000) : await c.req.text(); }
  catch (e) { return String((e as Error)?.message) === "too big" ? c.json({ error: "너무 큼" }, 413) : c.json({ error: "gzip 아님" }, 400); }
  if (body.length > 4_000_000) return c.json({ error: "너무 큼" }, 413);
  try { JSON.parse(body); } catch { return c.json({ error: "JSON 아님" }, 400); }
  const t1 = Date.now(), push = key === "data" && await ledger.f7Peek(c.env.DB, "read_push", peekWait(c)), lazy = await snapLazy(c), t2 = Date.now();
  const r = await snap(c.env).putT(key, body, push, lazy);
  return c.json({ ok: true, etag: r.etag }, 200, { "x-snap-timing": await snapTiming(c, t0, t1, t2, r, lazy) });   // server-timing 은 요청 시간 미들웨어가 덮어씀
});
const peekWait = (c: Context<{ Bindings: Env }>) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);
const snapLazy = async (c: Context<{ Bindings: Env }>) => !!(await ledger.f7Peek(c.env.DB, "write_snaplazy", peekWait(c)));
// x-snap-timing: 받아 풀기 · 스위치 · DO 왕복 · DO 안 · (X-Snap-Probe: 1 이면) 쓰기 없는 DO 왕복(ping — do 와의 차 ≈ 쓰기 확정 대기) · Worker / DO colo · lazy
async function snapTiming(c: Context<{ Bindings: Env }>, t0: number, t1: number, t2: number, r: { ms?: number; colo?: string }, lazy: boolean) {
  const t3 = Date.now();
  let s = `body;dur=${t1 - t0}, flag;dur=${t2 - t1}, do;dur=${t3 - t2}` + (r.ms !== undefined ? `, doin;dur=${r.ms}` : "");
  if (c.req.header("x-snap-probe") === "1") { const p0 = Date.now(); await snap(c.env).ping().catch(() => ""); s += `, ping;dur=${Date.now() - p0}`; }
  const wc = (c.req.raw as { cf?: { colo?: string } }).cf?.colo;
  return s + `, wcolo;desc=${wc || "?"}, docolo;desc=${r.colo || "?"}, lazy;desc=${lazy ? 1 : 0}`;
}
app.patch("/api/relay/snap/:key", async c => {
  const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!c.env.RELAY_TOKEN || !sameToken(tok, c.env.RELAY_TOKEN)) return c.json({ error: "no" }, 403);
  const key = c.req.param("key"); if (key !== "data") return c.json({ error: "data 만" }, 400);
  const base = c.req.header("x-snap-base") || ""; if (!base) return c.json({ error: "앞 판 없음" }, 400);
  const t0 = Date.now();
  let ops: string;
  try { ops = c.req.header("content-encoding") === "gzip" ? await gunzipCapped(c.req.raw.body!, 4_000_000) : await c.req.text(); }
  catch (e) { return String((e as Error)?.message) === "too big" ? c.json({ error: "너무 큼" }, 413) : c.json({ error: "gzip 아님" }, 400); }
  if (ops.length > 4_000_000) return c.json({ error: "너무 큼" }, 413);
  const t1 = Date.now(), push = await ledger.f7Peek(c.env.DB, "read_push", peekWait(c)), lazy = await snapLazy(c), t2 = Date.now();
  const r = await snap(c.env).patch(key, base, ops, push, lazy);
  const timing = await snapTiming(c, t0, t1, t2, r as { ms?: number; colo?: string }, lazy);
  return "conflict" in r ? c.json({ error: r.conflict }, 409, { "x-snap-timing": timing }) : c.json({ ok: true, etag: r.etag }, 200, { "x-snap-timing": timing });
});
app.put("/api/relay/snap/:key/touch", async c => {
  const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!c.env.RELAY_TOKEN || !sameToken(tok, c.env.RELAY_TOKEN)) return c.json({ error: "no" }, 403);
  const key = c.req.param("key"); if (!KEYS.has(key)) return c.json({ error: "모르는 칸" }, 400);
  return (await snap(c.env).touch(key, await snapLazy(c))) ? c.json({ ok: true }) : c.json({ error: "없음 — 다시 올려요" }, 404);
});
const relayOk = (c: Context<{ Bindings: Env }>) => { const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, ""); return !!c.env.RELAY_TOKEN && sameToken(tok, c.env.RELAY_TOKEN); };
app.put("/api/relay/sync", async c => {
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  const raw = await c.req.text(); if (raw.length > 8_000_000) return c.json({ error: "너무 큼" }, 413);
  let b: { changes?: ledger.Change[] }; try { b = JSON.parse(raw); } catch { return c.json({ error: "JSON 아님" }, 400); }
  if (!Array.isArray(b.changes) || b.changes.length > 5000) return c.json({ error: "changes 0–5000" }, 400);
  try {
    const n = await ledger.apply(c.env.DB, b.changes), sn = snap(c.env);
    const lz = await snapLazy(c);
    if (!(await sn.touch("sync", lz))) await sn.put("sync", "{}", false, lz);
    kickPush(c.env, c.executionCtx);
    if (b.changes.length) c.executionCtx.waitUntil(live.bumpLedger(c.env));
    return c.json({ ok: true, n });
  }
  catch (e) { return c.json({ ok: false, error: String(e).slice(0, 300) }, 400); }
});
app.get("/api/relay/sync/changes", async c => {
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  return c.json({ rows: await ownerWrite.changes(c.env.DB, SCHEMA, Number(c.req.query("after") || 0), Number(c.req.query("limit") || 200)) });
});
app.get("/api/relay/after", async c => relayOk(c) ? c.json({ rows: await OS.afterRows(c.env.DB, Number(c.req.query("after") || 0)) }) : c.json({ error: "no" }, 403));
app.post("/api/relay/after/try", async c => {
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ seq?: number }>().catch(() => ({} as { seq?: number }));
  return c.json(await OS.afterTry(c.env.DB, Number(b.seq)));
});
app.post("/api/relay/after/done", async c => {
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ seq?: number[]; res?: string }>().catch(() => ({} as { seq?: number[]; res?: string }));
  return c.json({ ok: true, n: await OS.afterDone(c.env.DB, b.seq || [], String(b.res || "")) });
});
app.get("/api/relay/owner-state", async c => {
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  const r = await OS.get(c.env.DB, c.req.query("k") || ""); return r ? c.json({ ...r, on: await ledger.f7On(c.env.DB, "write_state") }) : c.json({ error: "없음" }, 404);   // on: 끈 뒤엔 after-hook 이 파일을 안 덮음(실행기가 정본)
});
app.put("/api/relay/owner-state", async c => {   // seed: 이미 있으면 안 덮음(force=1 이면 덮음)
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  const k = c.req.query("k") || ""; if (!OS.KEYS.includes(k)) return c.json({ error: "모르는 칸" }, 400);
  const v = await c.req.json().catch(() => null); if (!v || typeof v !== "object" || Array.isArray(v)) return c.json({ error: "JSON" }, 400);
  return c.json({ ok: true, put: await OS.seed(c.env.DB, k, v as Record<string, unknown>, c.req.query("force") === "1") });
});
app.get("/api/relay/sync/stat", async c => relayOk(c) ? c.json(await ledger.stat(c.env.DB)) : c.json({ error: "no" }, 403));
app.get("/api/relay/sync/dump", async c => {
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  const t = c.req.query("t") || "", a = c.req.query("after");
  if (!ledger.TABLES.includes(t)) return c.json({ error: "모르는 표" }, 400);
  let after: (string | number | null)[] | null = null; try { after = a ? JSON.parse(a) : null; } catch { return c.json({ error: "after" }, 400); }
  return c.json({ rows: await ledger.dump(c.env.DB, t, after, Number(c.req.query("limit") || 1000)) });
});
app.post("/api/relay/write", async c => {
  const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!((c.env.LEDGER_TOKEN && sameToken(tok, c.env.LEDGER_TOKEN)) || relayOk(c))) return c.json({ error: "no" }, 403);
  if (!(await ledger.f7Peek(c.env.DB, "write_ledger", p => c.executionCtx.waitUntil(p)))) return c.json({ ok: false, code: "off", error: "write_ledger 꺼짐" }, 409);
  const raw = await c.req.text(); if (raw.length > 4_000_000) return c.json({ ok: false, code: "bad", error: "너무 큼" }, 413);
  let b: { tag?: unknown; stmts?: unknown; claim?: unknown; n?: unknown }; try { b = JSON.parse(raw); } catch { return c.json({ ok: false, code: "bad", error: "JSON 아님" }, 400); }
  if (b.claim === true) { const [cs, cb] = await ledgerWrite.claim(c.env.DB, b); return c.json(cb, cs as 200 | 400 | 503); }
  const tw = Date.now(), [st, body] = await ledgerWrite.write(c.env.DB, p => c.executionCtx.waitUntil(p), b); seg(c.req.raw, "d1", Date.now() - tw);
  if (st === 200) c.executionCtx.waitUntil(live.bumpLedger(c.env));
  return c.json(body, st as 200 | 400 | 503);
});
app.put("/api/relay/file", async c => {
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  const key = c.req.query("key") || ""; if (!files.okKey(key)) return c.json({ error: "키" }, 400);
  if (+(c.req.header("content-length") || 0) > 32 * 1024 * 1024) return c.json({ error: "너무 큼" }, 413);
  const b = new Uint8Array(await c.req.arrayBuffer()); if (b.length > 32 * 1024 * 1024) return c.json({ error: "너무 큼" }, 413);
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map(x => x.toString(16).padStart(2, "0")).join("");
  if (c.req.header("x-sha256") && c.req.header("x-sha256") !== sha) return c.json({ error: "sha 다름" }, 400);
  await c.env.RESULTS.put(key, b, { httpMetadata: { contentType: c.req.header("content-type") || "application/octet-stream" },
    customMetadata: { sha256: sha, name: (c.req.header("x-file-name") || "").slice(0, 600), mtime: (c.req.header("x-mtime") || "").slice(0, 30) } });
  return c.json({ ok: true, size: b.length, sha256: sha });
});
app.delete("/api/relay/file", async c => {
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  const key = c.req.query("key") || ""; if (!files.okKey(key)) return c.json({ error: "키" }, 400);
  await c.env.RESULTS.delete(key);
  return c.json({ ok: true });
});
app.get("/api/relay/file/list", async c => {
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  const prefix = c.req.query("prefix") || ""; if (!/^(art|up|files)\/$/.test(prefix)) return c.json({ error: "prefix = art/ · up/ · files/" }, 400);
  const r = await c.env.RESULTS.list({ prefix, cursor: c.req.query("cursor") || undefined, limit: 1000, include: ["customMetadata", "httpMetadata"] } as R2ListOptions);
  return c.json({ keys: r.objects.map(o => ({ k: o.key, size: o.size, sha: o.customMetadata?.sha256 || "", ct: o.httpMetadata?.contentType || "" })), cursor: r.truncated ? r.cursor : null });
});
app.put("/api/relay/push/import", async c => {
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json().catch(() => null) as object | null; if (!b || typeof b !== "object") return c.json({ error: "JSON 아님" }, 400);
  const r = await pusher(c.env).importData(b); await pusher(c.env).ensure();
  return c.json(r, r.ok ? 200 : 400);
});
app.get("/api/relay/push/stat", async c => relayOk(c) ? c.json(await pusher(c.env).stat()) : c.json({ error: "no" }, 403));
app.post("/api/relay/push/tick", async c => relayOk(c) ? c.json({ sent: await pusher(c.env).tickNow() }) : c.json({ error: "no" }, 403));
app.get("/api/relay/f7/read", async c => {
  if (!relayOk(c)) return c.json({ error: "no" }, 403);
  const rt = ownerRead.route(c.req.query("p") || ""); if (!rt) return c.json({ error: "모르는 길" }, 400);
  const now = Number(c.req.query("now")) || undefined;
  const o = await ownerRead.build(c.env.DB, await ownerRead.cfgOf(() => snap(c.env).get("cfg")), rt, now, !now);
  return o ? c.json(o.body as object, o.status as 200) : c.json({ error: "cfg 없음" }, 404);
});
// 웹 ← 스냅숏(로그인, ETag 같으면 304)
app.get("/api/board/:key", async c => {
  const sb = await signedIn(c); if (!sb) return c.json({ error: "로그인" }, 401); if (!isOwner(c.env, sb.user.email)) return c.json({ error: "no" }, 403);
  const key = c.req.param("key"); if (!KEYS.has(key)) return c.json({ error: "모르는 칸" }, 400);
  const r = await snap(c.env).get(key);
  if (!r) return c.json({ error: "아직 없음" }, 404);
  const h = { etag: r.etag, "cache-control": "private, no-cache", "x-snap-at": String(r.at) };
  if (c.req.header("if-none-match") === r.etag) return new Response(null, { status: 304, headers: h });
  return new Response(r.body, { headers: { ...h, "content-type": "application/json; charset=utf-8" } });
});

app.get("/api/live", async c => {
  const sb = await signedIn(c); if (!sb) return c.json({ error: "로그인" }, 401);
  if (chOf(c) === "test" || !(await ledger.f7On(c.env.DB, "read_live"))) return c.json({ error: "꺼짐" }, 404);   // 시험 통로는 스냅숏을 안 씀 — 예전 폴링
  const me = sb.user.email;
  if (c.req.header("upgrade") === "websocket") {
    const o = c.req.header("origin") || "", ok = [new URL(c.req.url).origin, c.env.PUBLIC_URL, ...String(c.env.ALT_URLS || "").split(",")].map(x => x.trim()).filter(Boolean);
    if (!ok.includes(o)) return c.json({ error: "no" }, 403);   // 다른 사이트가 쿠키로 여는 것 막기
    return live.liveOf(c.env, me).fetch(c.req.raw);
  }
  const o = await live.table(c.env, me, async () => {
    const m = me.toLowerCase(), [d, l] = await Promise.all([memberBoard.data(c.env.DB, m, await memberBot(c.env, m)), c.env.DB.prepare("SELECT max(id) n FROM board_log WHERE owner = ?").bind(m).first<{ n: number | null }>()]);
    const tag = await memberBoard.etag(JSON.stringify(d));
    return { data: tag, chat: tag + (l?.n ?? 0) };
  });
  return c.json(o, 200, { "cache-control": "no-store" });
});

const SearchDoc = z.object({ id: z.string().min(3).max(300), kind: z.enum(["node", "card", "chat", "log", "art"]), title: z.string().max(2000), body: z.string().max(20000),
  node: z.string().max(300).nullish(), ch: z.string().max(40).nullish(), at: z.number(), meta: z.record(z.string(), z.unknown()).optional(), emb: z.boolean().optional() });
const SearchPut = z.object({ upsert: z.array(SearchDoc).max(1000).default([]), del: z.array(z.string().max(300)).max(5000).default([]), all: z.array(z.string().max(300)).max(100_000).optional() });
app.put("/api/relay/search", async c => {
  const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!c.env.RELAY_TOKEN || !sameToken(tok, c.env.RELAY_TOKEN)) return c.json({ error: "no" }, 403);
  const b = SearchPut.safeParse(await c.req.json().catch(() => null)); if (!b.success) return c.json({ error: "모양이 달라요" }, 400);
  const d = b.data as { upsert: import("./search").Doc[]; del: string[]; all?: string[] };
  return c.json({ ok: true, ...(await search(c.env).upsert(d.upsert, d.del, d.all)) });
});
app.get("/api/relay/search", async c => {
  const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!c.env.RELAY_TOKEN || !sameToken(tok, c.env.RELAY_TOKEN)) return c.json({ error: "no" }, 403);
  return c.json(c.req.query("ids") ? { ...(await search(c.env).state()), ids: await search(c.env).ids() } : await search(c.env).state());
});
app.get("/api/search", async c => {
  const sb = await signedIn(c); if (!sb) return c.json({ error: "로그인" }, 401);
  const q = (c.req.query("q") || "").slice(0, 100), t0 = Date.now();
  // 회원(boarder-internal#4)은 자기 D1 만(member-search.ts) — 주인 색인(DO)은 주인만. 회원은 뜻 찾기가 없어 sem=1 은 같은 답
  const r = await memberSearch.route({ owner: isOwner(c.env, sb.user.email), me: sb.user.email, q, db: c.env.DB,
    ownerSearch: () => search(c.env).query(q, c.req.query("sem") === "1", c.req.query("dbg") === "1") });   // dbg = 노드 점수 나눔(주인만, 순위 고칠 때)
  seg(c.req.raw, "search", Date.now() - t0);
  return c.json({ ...r, ms: { ...r.ms, worker: Date.now() - t0 } }, 200, { "cache-control": "private, no-store" });
});

hosted.mount?.(app);
app.get("/api/relay/ws", async c => {
  const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!c.env.RELAY_TOKEN || !sameToken(tok, c.env.RELAY_TOKEN)) return c.json({ error: "no" }, 403);
  return bridge(c.env, new URL(c.req.url).searchParams.get("ch") || "owner").fetch(c.req.raw);
});
const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");
const tokCache = new Map<string, { pane: string; win: string; host: string; tools: string; owner: string; hash: string; at: number }>();
const flagAt = new Map<string, number>();
async function bound(env: Env, tok: string) {
  if (!/^bxa_[A-Za-z0-9_-]{30,80}$/.test(tok)) return null;
  const h = await sha(tok), hit = tokCache.get(h);
  if (hit && Date.now() - hit.at < 10_000) return hit;
  const r = await env.DB.prepare("SELECT t.pane, t.win, t.host, t.tools, t.owner FROM agent_token t LEFT JOIN device d ON d.id = t.device_id WHERE t.hash = ? AND t.revoked_at IS NULL AND (t.device_id IS NULL OR d.revoked_at IS NULL)").bind(h).first<{ pane: string; win: string; host: string; tools: string; owner: string }>();
  if (!r) { tokCache.delete(h); return null; }
  if (tokCache.size > 1000) tokCache.clear();
  const v = { ...r, hash: h, at: Date.now() }; tokCache.set(h, v); return v;
}
async function agentCtx(c: Context<{ Bindings: Env }>) {
  const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  const ta = Date.now(), who = await bound(c.env, tok); seg(c.req.raw, "auth", Date.now() - ta); if (!who) return null;
  const ch = c.req.header("x-boarder-channel") === "test" ? "test" : "owner";
  const flag = (text: string, agent = `boarder@${who.host}:${who.pane}`) =>
    c.executionCtx.waitUntil((boardTool(c.env, "owner", "flag", { text }, agent) as Promise<unknown>).catch(() => {}));
  const claimed = who.owner ? null : c.req.header("x-boarder-agent");
  if (claimed && (claimed.match(/%\d+/g) || []).join(",") !== who.pane) {
    const last = flagAt.get(who.pane) || 0;
    if (Date.now() - last > 600_000) { flagAt.set(who.pane, Date.now()); if (flagAt.size > 1000) flagAt.clear(); } else return "mismatch" as const;
    flag(`Boarder 신원 머리 불일치 — 토큰은 ${who.win || ""} ${who.pane}, 머리는 ${claimed.slice(0, 80)} · 거절`);
    return "mismatch" as const;
  }
  const agent = `boarder@${who.host}:${who.pane}`;
  REC.get(c.req.raw) && (REC.get(c.req.raw)!.who = who.owner || agent);
  if (who.owner) c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE device SET last_at = ? WHERE id = (SELECT device_id FROM agent_token WHERE hash = ?)").bind(Date.now(), who.hash).run().catch(() => {}));
  const reg = await registry(c.env.DB, t => flag(t, "boarder@worker"), c.env.CF_VERSION_METADATA);
  const owner = who.hash.slice(0, 32);
  return {
    agent, publicUrl: c.env.PUBLIC_URL, view: view(reg, who.tools ?? "*"),
    via: new URL(c.req.url).pathname === "/mcp" ? "mcp" as const : "rest" as const, testCh: c.req.header("x-boarder-channel") === "test",
    flag: (t: string) => c.executionCtx.waitUntil((boardTool(c.env, ch, "flag", { text: t }, "boarder@worker") as Promise<unknown>).catch(() => {})),
    op: async (name: string, args: Record<string, unknown>) => { const t = Date.now(); try { return await boardTool(c.env, ch, name, args, agent); } finally { seg(c.req.raw, "tool", Date.now() - t); } },
    get: async (path: string) => { const t = Date.now(), r = await boardCall(c.env, ch, { method: "GET", path, headers: { accept: "application/json" } }); bridgeSeg(c.req.raw, Date.now() - t, r.headers); if (r.status >= 400) throw new Error(`보드 ${r.status}`); return JSON.parse(new TextDecoder().decode(r.body)); },
    store: async (text: string) => {
      const id = crypto.randomUUID().replace(/-/g, "");
      await c.env.RESULTS.put(`mcp-results/${owner}/${id}.txt`, text, { httpMetadata: { contentType: "text/plain; charset=utf-8" }, customMetadata: { agent } });
      return `${c.env.PUBLIC_URL}/api/agent/result/${id}`;
    },
    owner,
    ...(who.owner ? { local: localTools(c.env.DB, who.owner, who.win || who.pane, c.env.PUBLIC_URL, who.pane) } : {}),
    host: who.host, win: who.win || who.pane,
    conn: { env: c.env, owner: who.owner || "", scope: who.tools ?? "*", catalog: (() => { let p: ReturnType<typeof catalog> | undefined; return () => (p ??= catalog(c.env, who.owner || "", w => c.executionCtx.waitUntil(w))); })() },
  };
}
const ProfileSync = z.object({ host: z.string().regex(/^[\w.@-]{1,60}$/), profiles: z.array(z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/), clis: z.array(z.object({ cli: z.enum(["wrangler", "gh"]), account: z.string().max(80) })).max(4) })).max(30),
  repos: z.array(z.object({ repo: z.string().max(200), profile: z.string().max(32) })).max(200) });
const flagOff = (env: Env, name: string) => String((env as unknown as { FLAGS_OFF?: string }).FLAGS_OFF || "").split(",").map(x => x.trim()).includes(name);
app.put("/api/profiles", async c => {
  if (flagOff(c.env, "cli_profiles")) return c.json({ error: "꺼진 기능" }, 404);
  const ctx = await agentCtx(c); if (ctx === "mismatch") return c.json({ error: "신원 불일치" }, 403); if (!ctx) return c.json({ error: "토큰" }, 401);
  if (ctx.conn?.scope.trim() !== "*") return c.json({ error: "이 토큰은 쓸 수 없음" }, 403);
  const p = ProfileSync.safeParse(await c.req.json().catch(() => ({}))); if (!p.success) return c.json({ error: "꼴이 맞지 않음" }, 400);
  await c.env.DB.prepare("INSERT INTO cli_profile(owner, host, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(owner, host) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(ctx.conn!.owner, p.data.host, JSON.stringify({ profiles: p.data.profiles, repos: p.data.repos }), Date.now()).run();
  return c.json({ ok: true });
});
app.get("/api/profiles", async c => {
  if (flagOff(c.env, "cli_profiles")) return c.json({ error: "꺼진 기능" }, 404);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const r = await c.env.DB.prepare("SELECT host, data, updated_at FROM cli_profile WHERE owner = ? ORDER BY host").bind(allowed(c.env, s.user.email) ? "" : s.user.email).all<{ host: string; data: string; updated_at: number }>();
  return c.json({ hosts: r.results.map(x => ({ host: x.host, updated_at: x.updated_at, ...JSON.parse(x.data) })) });
});
app.get("/api/sessions/offset", async c => {
  const ctx = await agentCtx(c); if (ctx === "mismatch") return c.json({ error: "신원 불일치" }, 403); if (!ctx) return c.json({ error: "토큰" }, 401);
  const tool = c.req.query("tool") || "", native = c.req.query("native") || "";
  if (!sessions.validTool(tool) || !sessions.validNative(native)) return c.json({ error: "tool · native" }, 400);
  if (!(await sessions.syncOn(c.env, ctx.conn!.owner))) return c.json(sessions.SYNC_OFF, 423);
  return c.json(await sessions.offset(c.env, ctx.conn!.owner, tool, native));
});
app.post("/api/sessions/upload", async c => {
  const ctx = await agentCtx(c); if (ctx === "mismatch") return c.json({ error: "신원 불일치" }, 403); if (!ctx) return c.json({ error: "토큰" }, 401);
  if (ctx.conn?.scope.trim() !== "*") return c.json({ error: "이 토큰은 세션을 쓸 수 없음" }, 403);
  const tool = c.req.header("x-session-tool") || "", native = c.req.header("x-session-native") || "", from = Number(c.req.header("x-session-from"));
  if (!sessions.validTool(tool) || !sessions.validNative(native) || !Number.isInteger(from) || from < 0) return c.json({ error: "x-session-tool · native · from" }, 400);
  if (!(await sessions.syncOn(c.env, ctx.conn!.owner))) return c.json(sessions.SYNC_OFF, 423);   // 위치를 먼저 받은 저장이 도는 중에 꺼도 다음 조각부터 멈춤
  const text = await c.req.text(); if (text.length > sessions.MAX_CHUNK) return c.json({ error: "조각은 6MB 까지" }, 413);
  const dec = (h: string) => { try { return decodeURIComponent(c.req.header(h) || ""); } catch { return ""; } };
  const r = await sessions.upload(c.env, ctx.conn!.owner, { tool, native, from, host: ctx.host, win: ctx.win, cwd: dec("x-session-cwd"), repo: dec("x-session-repo") }, text);
  return c.json(r.body, r.status);
});
app.get("/api/sessions", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  return c.json(await sessions.list(c.env, allowed(c.env, s.user.email) ? "" : s.user.email, c.req.query("q"), 50));
});
app.get("/api/me/session-sync", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  return c.json({ on: await sessions.syncOn(c.env, allowed(c.env, s.user.email) ? "" : s.user.email.toLowerCase()) });
});
app.post("/api/me/session-sync", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const { on } = await c.req.json<{ on?: unknown }>().catch(() => ({} as { on?: unknown }));
  if (typeof on !== "boolean") return c.json({ error: "on" }, 400);
  await sessions.setSync(c.env, allowed(c.env, s.user.email) ? "" : s.user.email.toLowerCase(), on)
  return c.json({ on });
});
app.get("/api/sessions/:id/handoff", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  try { return c.json(await sessions.handoff(c.env, allowed(c.env, s.user.email) ? "" : s.user.email, c.req.param("id"))); } catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 404); }
});
app.get("/api/agent/result/:id", async c => {
  const ctx = await agentCtx(c); if (ctx === "mismatch") return c.json({ error: "신원 불일치" }, 403); if (!ctx) return c.json({ error: "토큰" }, 401);
  const id = c.req.param("id"); if (!/^[0-9a-f]{32}$/.test(id)) return c.json({ error: "없음" }, 404);
  const o = await c.env.RESULTS.get(`mcp-results/${ctx.owner}/${id}.txt`); if (!o) return c.json({ error: "없음" }, 404);
  return new Response(o.body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
});
app.route("/", legal);   // 개인정보 처리방침 · 약관(legal.ts) — 구글 동의 화면 링크
app.post("/mcp", async c => { const ctx = await agentCtx(c); if (ctx === "mismatch") return c.json({ error: "신원 불일치" }, 403); if (!ctx) return c.json({ error: "토큰" }, 401); return mcp(c.req.raw, ctx); });
app.get("/mcp", c => new Response(null, { status: 405, headers: { allow: "POST" } }));
app.post("/api/agent/:tool", async c => {
  const ctx = await agentCtx(c); if (ctx === "mismatch") return c.json({ error: "신원 불일치" }, 403); if (!ctx) return c.json({ error: "토큰" }, 401);
  const name = c.req.param("tool"); if (!(name in SCHEMAS)) return c.json({ error: "없는 도구" }, 404);
  try { return c.json(await runTool(ctx, name, await c.req.json().catch(() => ({})))); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/[+/=]/g, m => ({ "+": "-", "/": "_", "=": "" } as Record<string, string>)[m]);
const rand = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const UC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 헷갈리는 0 · O · 1 · I 뺌
const userCode = () => { const s = [...crypto.getRandomValues(new Uint8Array(8))].map(x => UC[x % UC.length]).join(""); return `${s.slice(0, 4)}-${s.slice(4)}`; };
const CTRL_ALL = /[\x00-\x1f\x7f-\x9f]/g;
const clean = (v: unknown, n: number) => String(v ?? "").replace(CTRL_ALL, "").trim().slice(0, n);
const docNav = (c: { req: { method: string; header(k: string): string | undefined } }, url: URL) =>
  c.req.method === "GET" && c.req.header("sec-fetch-dest") === "document" && !url.pathname.startsWith("/api/") && url.pathname !== "/";
const NOFRAME = { "cache-control": "no-store", "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" };
const sameSite = (c: Context<{ Bindings: Env }>) => c.req.header("x-hb") === "1" && ["same-origin", "none", undefined].includes(c.req.header("sec-fetch-site"));
async function deviceOf(c: Context<{ Bindings: Env }>, opt: { watch?: boolean; harness?: boolean } = {}) {
  const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!/^bxd_[A-Za-z0-9_-]{30,80}$/.test(tok)) return null;
  const d = await c.env.DB.prepare("SELECT id, owner, name, tools, scope FROM device WHERE token_hash = ? AND revoked_at IS NULL").bind(await sha(tok)).first<{ id: string; owner: string; name: string; tools: string; scope: string }>();
  if (!d || (d.scope !== "full" && !(opt.watch && d.scope === "watch") && !(opt.harness && d.scope === "harness"))) return null;
  const rec = REC.get(c.req.raw); if (rec) rec.dev = d.owner;
  return d;
}
type CliManifest = { version: string; sha256: string };
const cliManifest = async (env: Env) => (await (await env.RESULTS.get("cli/manifest.json"))?.json<CliManifest>().catch(() => null)) ?? null;
const installScript = async (c: Context<{ Bindings: Env }>, src: string, type: string) => {
  const m = await cliManifest(c.env); if (!m) return c.text("Boarder CLI is not published yet\n", 503, { "cache-control": "no-store" });
  const body = src.replaceAll("__SERVER__", new URL(c.req.url).origin).replaceAll("__VERSION__", m.version).replaceAll("__SHA256__", m.sha256);
  return c.body(body, 200, { "content-type": `${type}; charset=utf-8`, "cache-control": "public, max-age=60" });
};
for (const p of ["/install.sh", "/cli/install.sh"]) app.get(p, c => installScript(c, installSh, "text/x-shellscript"));
for (const p of ["/install.ps1", "/cli/install.ps1"]) app.get(p, c => installScript(c, installPs1, "text/plain"));
app.get("/cli/manifest.json", async c => { const m = await cliManifest(c.env); return m ? c.json(m, 200, { "cache-control": "public, max-age=60" }) : c.json({ error: "not published" }, 503); });
app.get("/cli/:file{boarder-cli-[0-9][0-9a-z.-]*\\.tgz}", async c => {
  const o = await c.env.RESULTS.get(`cli/${c.req.param("file")}`); if (!o) return c.text("not found\n", 404, { "cache-control": "no-store" });
  return new Response(o.body, { headers: { "content-type": "application/gzip", "content-length": String(o.size), "cache-control": "public, max-age=300" } });
});
app.get("/api/install/cli/:file", c => c.text(`This install link was replaced. Install with: curl -fsSL ${new URL(c.req.url).origin}/install.sh | sh\n`, 410, { "cache-control": "no-store" }));
app.get("/api/install/prompt", async c => {   // 회원만(복사 단추는 다 로그인한 화면)
  const s = await signedIn(c); if (!s) return c.text("sign in first", 401, { "cache-control": "no-store" });
  return c.text(installPrompt(c.env.PUBLIC_URL), 200, { "cache-control": "no-store" });
});
app.get("/api/install/skill", c => c.body(BOARDER_SKILL, 200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" }));
app.post("/api/device/code", async c => {
  const b = await c.req.json<{ name?: string; tools?: string[]; callback?: string; state?: string; code_challenge?: string }>().catch(() => ({} as { name?: string; tools?: string[]; callback?: string; state?: string; code_challenge?: string }));
  // 로컬 콜백(기본): 127.0.0.1 · localhost 의 /callback 만, state · S256 challenge 꼴 검사 — 없으면 코드 입력 길(SSH)
  const cb = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/callback$/.test(b.callback || "") && /^[A-Za-z0-9_-]{16,100}$/.test(b.state || "") && /^[A-Za-z0-9_-]{43}$/.test(b.code_challenge || "") ? b : null;
  const tools = (Array.isArray(b.tools) ? b.tools : []).map(String).filter(t => /^[a-z][a-z-]{1,19}$/.test(t)).slice(0, 8).join(", ");
  const dc = rand(32), uc = userCode(), now = Date.now();
  const ip = c.req.header("cf-connecting-ip") || "", country = String((c.req.raw as any).cf?.country || "");
  const [byIp, all] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT count(*) n FROM device_code WHERE req_ip = ? AND created_at > ?").bind(ip, now - 600_000),
    c.env.DB.prepare("SELECT count(*) n FROM device_code WHERE state = 'pending' AND expires_at > ?").bind(now),
  ]);
  if ((byIp.results[0] as { n: number }).n >= 20 || (all.results[0] as { n: number }).n >= 2000) return c.json({ error: "too many" }, 429);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM device_code WHERE expires_at < ?").bind(now - 3600_000),
    c.env.DB.prepare("INSERT INTO device_code(code_hash, user_code, name, tools, created_at, expires_at, req_ip, req_country, callback, cb_state, challenge) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(await sha(dc), uc, clean(b.name, 80), tools, now, now + 600_000, ip, country, cb?.callback ?? null, cb?.state ?? null, cb?.code_challenge ?? null),
  ]);
  return c.json({ device_code: dc, user_code: uc, verify_url: `${c.env.PUBLIC_URL}/device?code=${uc}`, expires_in: 600, interval: 3, mode: cb ? "local" : "code" });
});
app.post("/api/device/token", async c => {
  const { device_code, code, code_verifier } = await c.req.json<{ device_code?: string; code?: string; code_verifier?: string }>().catch(() => ({} as { device_code?: string; code?: string; code_verifier?: string }));
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(device_code || "")) return c.json({ error: "unknown" }, 400);
  const h = await sha(device_code!), now = Date.now();
  const r = await c.env.DB.prepare("SELECT user_code, name, tools, expires_at, state, owner, challenge, grant_hash FROM device_code WHERE code_hash = ?").bind(h).first<{ user_code: string; name: string; tools: string; expires_at: number; state: string; owner: string; challenge: string | null; grant_hash: string | null }>();
  if (!r) return c.json({ error: "unknown" }, 400);
  if (r.state === "denied") return c.json({ state: "denied" }, 403);
  if (r.state === "issued") return c.json({ error: "used" }, 400);
  if (r.state === "pending") return r.expires_at < now ? c.json({ error: "expired" }, 410) : c.json({ state: "pending" });
  if (!(await member(c.env, r.owner))) return c.json({ state: "denied" }, 403);
  if (r.challenge) {   // 로컬 콜백 길: 허용한 브라우저가 127.0.0.1 로 넘긴 grant + 이 CLI 만 아는 verifier(PKCE S256)
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(code || "") || !r.grant_hash || !sameToken(await sha(code!), r.grant_hash)) return c.json({ state: "pending" });
    const ch = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code_verifier || ""))));
    if (!code_verifier || !sameToken(ch, r.challenge)) return c.json({ error: "verifier" }, 400);
  }
  const scope = isOwner(c.env, r.owner) ? "watch" : "full";
  if (scope === "watch" && ((await c.env.DB.prepare("SELECT count(*) n FROM device WHERE owner = ? AND revoked_at IS NULL").bind(r.owner).first<{ n: number }>())?.n || 0) >= 10) return c.json({ state: "denied" }, 403);
  // 승인됨 → 기기 토큰을 지금 한 번만 만듦(값은 안 두고 해시만). 두 폴링이 겹쳐도 한쪽만(state 조건)
  const id = rand(9), tok = "bxd_" + rand(32);
  const u = await c.env.DB.prepare("UPDATE device_code SET state = 'issued', device_id = ? WHERE code_hash = ? AND state = 'approved'").bind(id, h).run();
  if (!u.meta.changes) return c.json({ error: "used" }, 400);
  await c.env.DB.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)").bind(id, r.owner, r.name, r.tools, await sha(tok), now, now, scope).run();
  return c.json({ state: "approved", token: tok, email: r.owner, device_id: id, server: c.env.PUBLIC_URL, scope });
});
app.get("/api/device/lookup", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const r = await c.env.DB.prepare("SELECT name, tools, expires_at, state, created_at, req_ip, req_country, callback FROM device_code WHERE user_code = ?").bind(clean(c.req.query("code"), 9).toUpperCase()).first<{ name: string; tools: string; expires_at: number; state: string; created_at: number; req_ip: string; req_country: string; callback: string | null }>();
  if (!r) return c.json({ error: "unknown" }, 404);
  if (r.state !== "pending") return c.json({ error: "done" }, 409);
  if (r.expires_at < Date.now()) return c.json({ error: "expired" }, 410);
  return c.json({ name: r.name, tools: r.tools, at: r.created_at, ip: r.req_ip, country: r.req_country, same: !!r.req_ip && r.req_ip === (c.req.header("cf-connecting-ip") || ""), mode: r.callback ? "local" : "code", scope: isOwner(c.env, s.user.email) ? "watch" : "full" });
});
app.post("/api/device/approve", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const b = await c.req.json<{ user_code?: string; allow?: boolean }>().catch(() => ({} as { user_code?: string; allow?: boolean }));
  const uc = clean(b.user_code, 9).toUpperCase(), now = Date.now();
  const grant = b.allow ? rand(32) : null;
  const u = await c.env.DB.prepare("UPDATE device_code SET state = ?, owner = ?, grant_hash = ? WHERE user_code = ? AND state = 'pending' AND expires_at > ?").bind(b.allow ? "approved" : "denied", s.user.email.toLowerCase(), grant ? await sha(grant) : null, uc, now).run();
  if (u.meta.changes) {
    const r = await c.env.DB.prepare("SELECT callback, cb_state FROM device_code WHERE user_code = ?").bind(uc).first<{ callback: string | null; cb_state: string | null }>();
    // 로컬 콜백 길: 브라우저가 그 기기의 127.0.0.1 로 grant 를 넘김(거절도 알려 CLI 가 바로 멈춤)
    if (r?.callback) return c.json({ ok: true, redirect: `${r.callback}?state=${encodeURIComponent(r.cb_state || "")}&${grant ? `code=${grant}` : "error=denied"}` });
    return c.json({ ok: true });
  }
  const r = await c.env.DB.prepare("SELECT state, expires_at FROM device_code WHERE user_code = ?").bind(uc).first<{ state: string; expires_at: number }>();
  return c.json({ error: !r ? "unknown" : r.state !== "pending" ? "done" : "expired" }, 400);
});
app.get("/api/device/me", async c => {
  const d = await deviceOf(c, { watch: true, harness: true }); if (!d) return c.json({ error: "기기 토큰" }, 401);   // 데몬이 폐기 확인에 씀(401 이면 끝내고 안 뜸)
  return c.json({ email: d.owner, owner: isOwner(c.env, d.owner), scope: d.scope, device: { id: d.id, name: d.name, tools: d.tools }, server: c.env.PUBLIC_URL });
});
app.post("/api/device/metrics", async c => {
  const d = await deviceOf(c, { watch: true }); if (!d) return c.json({ error: "기기 토큰" }, 401);
  if (!(await member(c.env, d.owner))) return c.json({ error: "기기 토큰" }, 401);
  const len = +(c.req.header("content-length") || 0); if (len > METRICS_MAX_BYTES) return c.json({ error: "too big" }, 413);
  const buf = await readCapped(c.req.raw.body, METRICS_MAX_BYTES); if (!buf) return c.json({ error: "too big" }, 413);
  if (await tooSoon(c.env.DB, d.id)) return c.json({ error: "too soon" }, 429);
  let raw: unknown; try { raw = JSON.parse(new TextDecoder().decode(buf)); } catch { return c.json({ error: "json" }, 400); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return c.json({ error: "json" }, 400);
  return c.json(await putMetrics(c.env.DB, d, raw));
});
app.post("/api/device/window", async c => {
  const d = await deviceOf(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
  if (isOwner(c.env, d.owner) || !(await member(c.env, d.owner))) return c.json({ error: "기기 토큰" }, 401);
  const b = await c.req.json<{ key?: string; name?: string }>().catch(() => ({} as { key?: string; name?: string }));
  const key = String(b.key || ""); if (!/^[\w@.:/+-]{2,120}$/.test(key)) return c.json({ error: "창 키" }, 400);
  const tok = "bxa_" + rand(32), h = await sha(tok), now = Date.now(), host = `device:${d.id}`;
  const own = d.owner;   // 기기 창은 늘 그 사람 D1 보드로 — 다리(주인 보드)로는 절대 안 감
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, tools, owner, device_id) VALUES (?,?,?,?,?,'*',?,?)").bind(h, key, clean(b.name, 80) || key.slice(-40), host, now, own, d.id),
    c.env.DB.prepare("UPDATE agent_token SET revoked_at = ? WHERE pane = ? AND host = ? AND revoked_at IS NULL AND hash != ?").bind(now, key, host, h),
    c.env.DB.prepare("UPDATE device SET last_at = ? WHERE id = ?").bind(now, d.id),
  ]);
  tokCache.clear();
  return c.json({ token: tok });
});
// 주인이 아닌 사람의 보드(첫 화면이 4초마다 읽음)
app.get("/api/me/board", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const me = s.user.email.toLowerCase();
  const [dv, wn, lg, cd] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT d.id, d.name, d.tools, d.created_at, d.last_at, m.at metrics_at, m.data metrics FROM device d LEFT JOIN device_metric m ON m.device_id = d.id WHERE d.owner = ? AND d.revoked_at IS NULL ORDER BY d.created_at DESC").bind(me),
    c.env.DB.prepare("SELECT t.device_id, t.win FROM agent_token t JOIN device d ON d.id = t.device_id WHERE d.owner = ? AND d.revoked_at IS NULL AND t.revoked_at IS NULL ORDER BY t.created_at DESC").bind(me),
    c.env.DB.prepare("SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND (thread IS NULL OR thread != 'primary') ORDER BY at DESC LIMIT 100").bind(me),
    c.env.DB.prepare("SELECT id, win, question, choices, recommend, body, state, answer, done, at FROM board_card WHERE owner = ? ORDER BY at DESC LIMIT 50").bind(me),
  ]);
  const wins = (wn.results as { device_id: string; win: string }[]);
  const [ch, dr, ew, ed] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, win, kind, text, at FROM (SELECT * FROM board_log WHERE owner = ? AND thread = 'primary' ORDER BY at DESC LIMIT 120) ORDER BY at").bind(me),
    c.env.DB.prepare("SELECT id, name, brief, instructions, cwd, state, role_id, created_at FROM role_draft WHERE owner = ? ORDER BY created_at DESC LIMIT 60").bind(me),
    c.env.DB.prepare("SELECT id, kind, role_id, name, state, state_at, dialog, note, device_id, created_at FROM engine_window WHERE owner = ? AND (state NOT IN ('closed','failed') OR state_at > ?) ORDER BY created_at DESC LIMIT 40").bind(me, Date.now() - 86_400_000),
    c.env.DB.prepare("SELECT id, name, engine, engine_at FROM device WHERE owner = ? AND revoked_at IS NULL AND engine IS NOT NULL ORDER BY engine_at DESC").bind(me),
  ]);
  const cfg = await ownerCfg(c.env.DB, me);
  const engine = { perm: cfg.perm, perm_at: cfg.perm_at, devices: (ed.results as { id: string; name: string; engine: string; engine_at: number }[]).map(d => ({ id: d.id, name: d.name, online: Date.now() - (d.engine_at || 0) < 120_000, at: d.engine_at, ...(() => { try { return JSON.parse(d.engine); } catch { return {}; } })() })) };
  return c.json({ devices: (dv.results as { id: string; metrics: string | null }[]).map(d => ({ ...d, metrics: (() => { try { return d.metrics ? JSON.parse(d.metrics) : null; } catch { return null; } })(), windows: wins.filter(w => w.device_id === d.id).map(w => w.win) })), logs: lg.results, cards: cd.results, chat: ch.results, drafts: dr.results, windows: ew.results, engine }, 200, { "cache-control": "no-store" });
});
const NODE_DEF = { check_min: 30, split_at: 3, move_h: 24, rename_h: 6, archive_h: 6 } as const;
const NODE_LIM: Record<keyof typeof NODE_DEF, [number, number]> = { check_min: [5, 1440], split_at: [2, 10], move_h: [1, 168], rename_h: [1, 168], archive_h: [1, 168] };
const nodeVals = (raw: unknown, base: Record<string, number> = { ...NODE_DEF }) => {
  const out = { ...base };
  for (const k of Object.keys(NODE_DEF) as (keyof typeof NODE_DEF)[]) {
    const v = (raw && typeof raw === "object" ? (raw as Record<string, unknown>)[k] : undefined);
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.min(NODE_LIM[k][1], Math.max(NODE_LIM[k][0], Math.trunc(v)));
  }
  return out;
};
async function toBoard(c: Context<{ Bindings: Env }>, method: string, path: string, body?: unknown) {
  try {
    const r = await boardCall(c.env, chOf(c), { method, path, headers: { "content-type": "application/json", "x-hb": "1" }, ...(body !== undefined ? { body: new TextEncoder().encode(JSON.stringify(body)) } : {}) });
    return new Response(r.body as unknown as BodyInit, { status: r.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch { return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503); }
}
async function memberNodeVals(env: Env, me: string) {
  const r = await env.DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me).first<{ data: string }>();
  try { return nodeVals(r ? JSON.parse(r.data) : null); } catch { return nodeVals(null); }
}
app.get("/api/me/nodeset", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  if (isOwner(c.env, s.user.email)) {
    const r = await toBoard(c, "GET", "/api/nodeset");
    if (r.status !== 200 || chOf(c) !== "owner" || !(await ledger.f7On(c.env.DB, "write_state"))) return r;
    const v = await OS.nodeSettings(c.env.DB).catch(() => null); if (!v) return r;
    const j = await r.json().catch(() => null) as Record<string, unknown> | null; if (!j) return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503);
    return c.json({ ...j, values: v }, 200, { "cache-control": "no-store" });
  }
  const me = s.user.email.toLowerCase();
  const [rawSet, arch] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me),
    c.env.DB.prepare("SELECT n.id, n.name, n.why, n.archived_at, EXISTS(SELECT 1 FROM mnode_item m JOIN imp_item i ON i.owner = m.owner AND i.key = m.item WHERE m.owner = n.owner AND m.node = n.id AND i.gone_at IS NULL) open FROM mnode n WHERE n.owner = ? AND n.archived_at IS NOT NULL ORDER BY n.archived_at DESC LIMIT 300").bind(me),
  ]);
  const unit = (() => { try { return (JSON.parse((rawSet.results[0] as { data?: string } | undefined)?.data || "{}") as { unit?: string }).unit || null; } catch { return null; } })();
  const archive = (arch.results as { id: string; name: string; why: string | null; archived_at: number; open: number }[]).map(n => ({ id: n.id, name: n.name, at: n.archived_at / 1000, msg: n.why || "", reopen: !!n.open && !!unit }));
  return c.json({ values: await memberNodeVals(c.env, me), defaults: NODE_DEF, limits: NODE_LIM, archive, unit }, 200, { "cache-control": "no-store" });
});
app.post("/api/me/nodeset", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const b = await c.req.json<{ values?: unknown; unit?: string }>().catch(() => ({} as { values?: unknown; unit?: string }));
  if (!isOwner(c.env, s.user.email) && (b.unit === "goal" || b.unit === "agent")) {   // 채널 묶는 단위 — 회원만(주인은 노드 = 채널 그대로)
    const me = s.user.email.toLowerCase();
    await setUnit(c.env as never, me, b.unit, "me"); await regroup(c.env as never, me);
    return c.json({ ok: true, unit: b.unit });
  }
  if (!b.values || typeof b.values !== "object") return c.json({ ok: false, error: "값" }, 400);
  if (isOwner(c.env, s.user.email)) {
    if (chOf(c) === "owner" && await ledger.f7On(c.env.DB, "write_state")) {   // D1 이 정본 — 못 쓰면 실행기 말고 503(실행기는 파일에 써서 D1 과 갈라짐)
      const r = await OS.nodeSet(c.env.DB, { values: b.values }).catch(() => null);
      return r ? c.json(r[1], r[0] as 200) : c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, { "x-retry-safe": "1" });
    }
    return toBoard(c, "POST", "/api/nodeset", { values: b.values });
  }
  const me = s.user.email.toLowerCase(), values = nodeVals(b.values, await memberNodeVals(c.env, me));
  const was = await c.env.DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me).first<{ data: string }>();   // 숫자 칸만 바꿈 — 묶는 단위(unit)는 그대로
  let keep: Record<string, unknown> = {}; try { keep = JSON.parse(was?.data || "{}"); } catch {}
  await c.env.DB.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(me, JSON.stringify({ ...keep, ...values }), Date.now()).run();
  return c.json({ ok: true, values });
});
app.post("/api/me/nodereopen", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  if (!isOwner(c.env, s.user.email)) return c.json({ ok: false, error: "보관함에 없는 노드예요" }, 404);
  const b = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  return toBoard(c, "POST", "/api/nodereopen", { name: String(b.name || "").slice(0, 80) });
});
app.get("/api/me/devices", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  return c.json({ devices: await listDevices(c.env.DB, s.user.email.toLowerCase()) }, 200, { "cache-control": "no-store" });
});
app.post("/api/me/cards/:id/answer", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const me = s.user.email.toLowerCase(), id = c.req.param("id"), { choice: ch, free, rid: rid0 } = await c.req.json<{ choice?: string; free?: boolean; rid?: string }>().catch(() => ({} as { choice?: string; free?: boolean; rid?: string }));
  const rid = queue.ridOfBody({ rid: rid0 });
  let choice = "";
  try {
  const r = await c.env.DB.prepare("SELECT choices FROM board_card WHERE id = ? AND owner = ? AND state = 'open'").bind(id, me).first<{ choices: string }>();
  if (!r) return rid && await queue.ridSeen(c.env.DB, rid) ? c.json({ ok: true, already: true }) : c.json({ error: "없는 카드" }, 404);
  choice = String(ch ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " ").trim().slice(0, 2000);
  const freeOk = !!free && !!choice && !(await c.env.DB.prepare("SELECT 1 FROM imp_proposal WHERE card_id = ? AND owner = ?").bind(id, me).first());
  if (!(JSON.parse(r.choices) as string[]).includes(choice) && !freeOk) return c.json({ error: "없는 선택지" }, 400);
  if (!(await queue.ridBatch(c.env.DB, rid, [c.env.DB.prepare("UPDATE board_card SET state = 'answered', answer = ?, answered_at = ? WHERE id = ? AND owner = ? AND state = 'open'").bind(String(choice), Date.now(), id, me)], p => c.executionCtx.waitUntil(p)))) return c.json({ ok: true, already: true });
  } catch (e) { if (rid) return queue.retrySafe(c); throw e; }
  await onCardAnswered(c.env as never, me, id).catch(e => console.error("들여오기 카드 답", e));
  const card = await c.env.DB.prepare("SELECT wid, question FROM board_card WHERE id = ? AND owner = ?").bind(id, me).first<{ wid: string | null; question: string }>().catch(() => null);   // 답은 이미 씀 — 못 읽어도 오류로 돌리지 않음
  if (card?.wid) c.executionCtx.waitUntil(deliverTo(c.env, me, card.wid, `[Boarder] The person answered your card ${id} ("${card.question.slice(0, 120)}"): ${String(choice)}. Continue with that.`).catch(() => {}));
  return c.json({ ok: true });
});
mountImport(app as never, {
  device: async c => { const d = await deviceOf(c as never); return d && !isOwner(c.env as never, d.owner) && await member(c.env as never, d.owner) ? d : null; },
  member: async c => { const s = await signedIn(c as never); return s && !isOwner(c.env as never, s.user.email) ? s.user.email.toLowerCase() : null; },
  sameSite: c => sameSite(c as never),
});
const memberBot = (env: Env, me: string) => env.DB.prepare("SELECT seed, hue, name, photo, icon, fav FROM member_bot WHERE owner = ?").bind(me).first<Bot>();
const BLOB_ID = /^[0-9a-f]{32}$/;
const botKey = (env: Env, email: string) => isOwner(env, email) ? "@owner" : email.toLowerCase();
app.get("/api/me/bot", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  return c.json({ bot: await memberBot(c.env, botKey(c.env, s.user.email)) }, 200, { "cache-control": "no-store" });
});
// 그림 하나(PNG · JPEG · WebP, 1.5MB 까지) → R2 blobs/<내용 해시 32자>. 머리 바이트로 꼴 확인 — 올린 사람이 꼴을 속여 HTML 등을 못 올리게(받는 쪽도 nosniff · sandbox)
app.post("/api/me/bot/image", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  if (+(c.req.header("content-length") || 0) > 1_500_000) return c.json({ error: "사진이 너무 커요" }, 413);
  const body = new Uint8Array(await c.req.arrayBuffer()); if (!body.byteLength || body.byteLength > 1_500_000) return c.json({ error: "사진이 너무 커요" }, 413);
  const hex = [...body.slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join("");
  const type = hex.startsWith("89504e470d0a1a0a") ? "image/png" : hex.startsWith("ffd8ff") ? "image/jpeg" : hex.startsWith("52494646") && hex.slice(16, 24) === "57454250" ? "image/webp" : "";
  if (!type) return c.json({ error: "PNG · JPEG · WebP 사진만 돼요" }, 400);
  const id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
  await c.env.RESULTS.put(`blobs/${id}`, body, { httpMetadata: { contentType: type } });
  return c.json({ id });
});
app.post("/api/me/bot", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const b = Object(await c.req.json<Partial<Bot>>().catch(() => ({}))) as Partial<Bot>;
  const seed = String(b.seed ?? "").trim(), hue = Number(b.hue), name = String(b.name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim(), photo = String(b.photo ?? ""), icon = String(b.icon ?? ""), fav = String(b.fav ?? "");
  if (!/^[A-Za-z0-9 _-]{1,40}$/.test(seed) || !Number.isInteger(hue) || hue < 0 || hue > 359) return c.json({ error: "모양 · 색" }, 400);
  if (!name || [...name].length > 20) return c.json({ error: "이름은 1–20자예요" }, 400);
  if ((photo && !BLOB_ID.test(photo)) || !BLOB_ID.test(icon) || !BLOB_ID.test(fav)) return c.json({ error: "그림" }, 400);
  const heads = await Promise.all([icon, fav, ...(photo ? [photo] : [])].map(id => c.env.RESULTS.head(`blobs/${id}`)));
  if (heads.some(h => !h || !/^image\/(png|jpeg|webp)$/.test(h.httpMetadata?.contentType || ""))) return c.json({ error: "그림을 먼저 올려요" }, 400);
  const me = botKey(c.env, s.user.email), now = Date.now();
  await c.env.DB.prepare("INSERT INTO member_bot (owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET seed = excluded.seed, hue = excluded.hue, name = excluded.name, photo = excluded.photo, icon = excluded.icon, fav = excluded.fav, updated_at = excluded.updated_at")
    .bind(me, seed, hue, name, photo, icon, fav, now).run();
  return c.json({ bot: { seed, hue, name, photo, icon, fav } });
});
const flagOwner = (c: Context<{ Bindings: Env }>) => (text: string) => c.executionCtx.waitUntil((boardTool(c.env, chOf(c), "flag", { text }, "boarder@worker") as Promise<unknown>).catch(() => {}));
app.post("/api/me/feedback", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const me = s.user.email.toLowerCase();
  if (+(c.req.header("content-length") || 0) > 16_384) return c.json({ error: "너무 큼" }, 413);
  const r = await addFeedback(c.env.DB, { owner: isOwner(c.env, me) ? "" : me, author: me, via: "web", test: chOf(c) === "test" }, await c.req.json().catch(() => ({})), flagOwner(c));
  return "error" in r ? c.json({ error: r.error }, r.status) : c.json(r);
});
app.post("/api/me/devices/:id/revoke", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const id = c.req.param("id"), now = Date.now();
  const u = await c.env.DB.prepare("UPDATE device SET revoked_at = ? WHERE id = ? AND owner = ? AND revoked_at IS NULL").bind(now, id, s.user.email.toLowerCase()).run();
  if (!u.meta.changes) return c.json({ error: "없는 기기" }, 404);
  await c.env.DB.prepare("UPDATE agent_token SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL").bind(now, id).run();
  tokCache.clear();
  await engineOf(c.env, id).revoke().catch(() => null);   // 엔진 데몬도 끊음(4401, 다시 안 뜸)
  return c.json({ ok: true });
});
const memberOnly = async (c: Context<{ Bindings: Env }>) => {
  if (!sameSite(c)) return null;
  const s = await signedIn(c); if (!s || isOwner(c.env, s.user.email)) return null;
  return s.user.email.toLowerCase();
};
const engErr = (c: Context<{ Bindings: Env }>, e: unknown) => c.json({ ok: false, error: e instanceof Error && /^[가-힣]/.test(e.message) ? e.message : "일시적인 오류가 발생했어요" }, 400);
app.post("/api/me/chat", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const { text, rid: rid0 } = await c.req.json<{ text?: string; rid?: string }>().catch(() => ({} as { text?: string; rid?: string }));
  const t = String(text || "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").trim().slice(0, 4000), rid = queue.ridOfBody({ rid: rid0 });
  if (!t) return c.json({ ok: false, error: "내용을 적어요" }, 400);
  try { if (!(await queue.ridBatch(c.env.DB, rid, [c.env.DB.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").bind(me, "나", "chat", t, "primary", Date.now())], p => c.executionCtx.waitUntil(p)))) return c.json({ ok: true, already: true }); }
  catch (e) { if (rid) return queue.retrySafe(c); throw e; }
  try { const r = await chatToMain(c.env, me, t); if ((r as { offline?: boolean })?.offline) await sysLine(c.env.DB, me, "엔진이 켜진 기기가 없어 메인 봇에게 아직 못 전했어요 — 기기에서 boarder engine setup 을 돌려요"); return c.json({ ok: true, ...(r as object || {}) }); }
  catch (e) { return engErr(c, e); }
});
app.post("/api/me/drafts/:id/:act", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const id = c.req.param("id"), act = c.req.param("act");
  try {
    if (act === "approve") return c.json({ ok: true, ...(await approveDraft(c.env, me, id)) });
    if (act === "dismiss") { const r = await c.env.DB.prepare("UPDATE role_draft SET state = 'dismissed', updated_at = ? WHERE id = ? AND owner = ? AND state = 'draft'").bind(Date.now(), id, me).run(); return c.json({ ok: !!r.meta.changes }); }
  } catch (e) { return engErr(c, e); }
  return c.json({ error: "no" }, 404);
});
// B-8: 묻지 않고 일하기 — 사람이 화면에서 위험 안내를 보고 한 번 허용(끄기도 여기). 다음에 여는 창부터
app.post("/api/me/engine/perm", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const { mode } = await c.req.json<{ mode?: string }>().catch(() => ({} as { mode?: string }));
  if (mode !== "bypass" && mode !== "ask") return c.json({ error: "mode" }, 400);
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO engine_owner(owner, perm_mode, perm_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(owner) DO UPDATE SET perm_mode = excluded.perm_mode, perm_at = excluded.perm_at, updated_at = excluded.updated_at").bind(me, mode, now, now).run();
  await sysLine(c.env.DB, me, mode === "bypass" ? "묻지 않고 일하기를 허용했어요 — 다음에 여는 창부터" : "묻지 않고 일하기를 껐어요 — 다음에 여는 창부터 하나하나 물어요");
  return c.json({ ok: true, mode });
});
app.post("/api/me/windows/:id/say", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const { text } = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
  const t = String(text || "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").trim().slice(0, 4000);
  if (!t) return c.json({ ok: false, error: "내용을 적어요" }, 400);
  try { return c.json({ ok: true, ...(await deliverTo(c.env, me, c.req.param("id"), `[Boarder chat] ${t}`) as object || {}) }); }
  catch (e) { return engErr(c, e); }
});
app.post("/api/me/windows/:id/:act", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const id = c.req.param("id"), act = c.req.param("act");
  const w = await c.env.DB.prepare("SELECT device_id, name FROM engine_window WHERE id = ? AND owner = ?").bind(id, me).first<{ device_id: string; name: string }>();
  if (!w || !["park", "reopen", "close"].includes(act)) return c.json({ error: "없는 창" }, 404);
  try {
    const stub = engineOf(c.env, w.device_id);
    const r = act === "park" ? await stub.park(id, "사람이 주차") : act === "reopen" ? await stub.reopen(id) : await stub.close(id);
    await sysLine(c.env.DB, me, `「${w.name}」 창을 ${act === "park" ? "주차했어요" : act === "reopen" ? "다시 열었어요" : "닫았어요"}`, id);
    return c.json({ ok: true, ...(r as object) });
  } catch (e) { return engErr(c, e); }
});
app.get("/api/device/engine", async c => {
  if (c.req.header("upgrade") !== "websocket") return c.json({ error: "websocket" }, 426);
  const d = await deviceOf(c, { harness: true }); if (!d) return c.json({ error: "기기 토큰" }, 401);
  const harness = d.scope === "harness";
  if (harness ? !isOwner(c.env, d.owner) : (isOwner(c.env, d.owner) || !(await member(c.env, d.owner)))) return c.json({ error: "기기 토큰" }, 401);
  const h = new Headers(c.req.raw.headers); h.set("x-bx-device", d.id); h.set("x-bx-owner", d.owner); h.set("x-bx-harness", harness ? "1" : "0");   // 머리는 늘 덮어씀(밖에서 넣은 값 무시)
  return engineOf(c.env, d.id).fetch(new Request(c.req.raw, { headers: h }));
});

const invite = async (env: Env, email: string, by: string) => {
  const e = clean(email, 200).toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null;
  await env.DB.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?) ON CONFLICT(email) DO NOTHING").bind(e, by, Date.now()).run(); return e;
};
app.post("/api/me/invites", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401); if (!isOwner(c.env, s.user.email)) return c.json({ error: "no" }, 403);
  const e = await invite(c.env, (await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }))).email || "", s.user.email); if (!e) return c.json({ error: "메일 주소" }, 400);
  return c.json({ ok: true, email: e });
});
app.get("/api/me/invites", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401); if (!isOwner(c.env, s.user.email)) return c.json({ error: "no" }, 403);
  return c.json((await c.env.DB.prepare("SELECT email, at FROM invite ORDER BY at DESC").all()).results);
});

let stdNames: { at: number; v: Set<string> } | null = null;
async function emojiStd(env: Env) {   // 표준 이름(emoji.json 스냅숏) — 같은 이름 막기용, isolate 에 10분
  if (stdNames && Date.now() - stdNames.at < 600_000) return stdNames.v;
  const e = await snap(env).get("emoji").catch(() => null), v = new Set<string>();
  try { for (const x of (JSON.parse(e?.body || "{}").e || []) as [string, string[]][]) for (const n of x[1]) v.add(n); } catch {}
  if (v.size) stdNames = { at: Date.now(), v };
  return v;
}
app.get("/api/emoji/custom", async c => {
  const s = await signedIn(c);
  if (!s && !relayOk(c)) return c.json({ error: "로그인" }, 401);
  const me = s ? s.user.email.toLowerCase() : null;
  return c.json(await emoji.list(c.env, me, !!me && isOwner(c.env, me)), 200, { "cache-control": "no-store" });
});
app.post("/api/emoji/custom", async c => {
  if (!sameSite(c)) return c.json({ ok: false, error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ ok: false, error: "로그인" }, 401);
  if (Number(c.req.header("content-length") || 0) > emoji.MAX) return c.json({ ok: false, error: "그림이 너무 커요" }, 413);
  let name = ""; try { name = decodeURIComponent(c.req.header("x-emoji-name") || ""); } catch {}
  const rd = c.req.raw.body?.getReader(), parts: Uint8Array[] = []; let n = 0;
  if (rd) for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.byteLength; if (n > emoji.MAX) { await rd.cancel().catch(() => {}); return c.json({ ok: false, error: "그림이 너무 커요" }, 413); } parts.push(value); }
  const body = new Uint8Array(n); let o = 0; for (const x of parts) { body.set(x, o); o += x.byteLength; }
  const [st, j] = await emoji.add(c.env, s.user.email.toLowerCase(), name, (c.req.header("content-type") || "").split(";")[0].trim(), body.buffer, await emojiStd(c.env));
  return c.json(j, st as 200);
});
app.post("/api/emoji/custom/delete", async c => {
  if (!sameSite(c)) return c.json({ ok: false, error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ ok: false, error: "로그인" }, 401);
  const b = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string })), me = s.user.email.toLowerCase();
  const [st, j] = await emoji.remove(c.env, me, isOwner(c.env, me), String(b.name || ""));
  return c.json(j, st as 200);
});
app.post("/api/emoji/bot", async c => {
  if (!sameSite(c)) return c.json({ ok: false, error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ ok: false, error: "로그인" }, 401);
  const me = s.user.email.toLowerCase(); if (!isOwner(c.env, me)) return c.json({ ok: false, error: "관리자만 바꿀 수 있어요" }, 403);
  const b = await c.req.json<{ bot?: string; on?: boolean }>().catch(() => ({} as { bot?: string; on?: boolean }));
  const [st, j] = await emoji.bot(c.env, me, String(b.bot || ""), !!b.on);
  return c.json(j, st as 200);
});
app.get("/emoji/i/:file", async c => {
  if (!(await signedIn(c))) return c.text("", 401);
  return (await emoji.image(c.env, c.req.param("file"))) || c.text("", 404);
});

const admin = (c: Context<{ Bindings: Env }>) => !!c.env.ADMIN_TOKEN && sameToken((c.req.header("authorization") || "").replace(/^Bearer\s+/i, ""), c.env.ADMIN_TOKEN);
hosted.admin?.(app, { admin, invite });
app.post("/api/admin/agent-tokens", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const { pane, win, host } = await c.req.json<{ pane?: string; win?: string; host?: string }>().catch(() => ({} as any));
  if (!pane || !/^[%\w@.:-]{2,60}$/.test(pane)) return c.json({ error: "판" }, 400);
  const raw = crypto.getRandomValues(new Uint8Array(32)), tok = "bxa_" + btoa(String.fromCharCode(...raw)).replace(/[+/=]/g, m => ({ "+": "-", "/": "_", "=": "" } as any)[m]);
  const now = Date.now();
  const h = await sha(tok), hs = host || "owner-host";
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, tools) VALUES (?,?,?,?,?, COALESCE((SELECT tools FROM agent_token WHERE pane = ? AND host = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1), '*'))")
      .bind(h, pane, String(win || "").slice(0, 80), hs, now, pane, hs),
    c.env.DB.prepare("UPDATE agent_token SET revoked_at = ? WHERE pane = ? AND host = ? AND revoked_at IS NULL AND hash != ?").bind(now, pane, hs, h),
  ]);
  tokCache.clear();
  return c.json({ token: tok });
});
app.post("/api/admin/agent-tokens/revoke", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const { pane, host } = await c.req.json<{ pane?: string; host?: string }>().catch(() => ({} as any));
  const r = await c.env.DB.prepare("UPDATE agent_token SET revoked_at = ? WHERE pane = ? AND host = ? AND revoked_at IS NULL").bind(Date.now(), String(pane || ""), host || "owner-host").run();
  tokCache.clear();
  return c.json({ revoked: r.meta.changes || 0 });
});
app.post("/api/admin/invites", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ email?: string; remove?: boolean }>().catch(() => ({} as { email?: string; remove?: boolean }));
  if (b.remove) {
    const e = clean(b.email, 200).toLowerCase(), now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM invite WHERE email = ?").bind(e),
      c.env.DB.prepare("UPDATE agent_token SET revoked_at = ? WHERE owner = ? AND revoked_at IS NULL").bind(now, e),
      c.env.DB.prepare("UPDATE device SET revoked_at = ? WHERE owner = ? AND revoked_at IS NULL").bind(now, e),
    ]);
    tokCache.clear();
    for (const d of (await c.env.DB.prepare("SELECT id FROM device WHERE owner = ? AND revoked_at = ?").bind(e, now).all<{ id: string }>()).results) await engineOf(c.env, d.id).revoke().catch(() => null);   // 초대 빠짐 → 엔진 길도
    return c.json({ ok: true });
  }
  const e = await invite(c.env, b.email || "", "admin"); return e ? c.json({ ok: true, email: e }) : c.json({ error: "메일 주소" }, 400);
});
const TEST_EMAIL = /^[a-z0-9][a-z0-9._+-]{0,60}@example\.com$/;
app.post("/api/admin/test-session", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ email?: string; revoke?: boolean }>().catch(() => ({} as { email?: string; revoke?: boolean }));
  const e = clean(b.email, 80).toLowerCase();
  if (!TEST_EMAIL.test(e) || isOwner(c.env, e)) return c.json({ error: "시험 주소(@example.com)만" }, 400);
  const ctx = await createAuth(c.env).$context;
  const found = await ctx.internalAdapter.findUserByEmail(e);
  if (b.revoke){
    if (found) await ctx.internalAdapter.deleteUserSessions(found.user.id);
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE agent_token SET revoked_at = ? WHERE owner = ? AND revoked_at IS NULL").bind(now, e),
      c.env.DB.prepare("UPDATE device SET revoked_at = ? WHERE owner = ? AND revoked_at IS NULL").bind(now, e),
    ]);
    tokCache.clear(); return c.json({ ok: true });
  }
  if (!(await member(c.env, e))) return c.json({ error: "초대 먼저" }, 403);
  let user = found?.user ?? null;
  if (!user) {
    try { user = await ctx.internalAdapter.createUser({ email: e, name: e.split("@")[0], emailVerified: true }, { method: "email-otp" }); }   // 가입 꼴은 이메일 코드 가입과 같게(databaseHooks · 초대 확인 그대로)
    catch { user = (await ctx.internalAdapter.findUserByEmail(e))?.user ?? null; }   // 동시에 두 번이면 먼저 만든 줄
  }
  if (!user) return c.json({ error: "가입 안 됨" }, 403);   // 가입 훅이 거절(초대가 그 사이 빠짐)
  const sess = await ctx.internalAdapter.createSession(user.id, true);
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(ctx.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sign = async (v: string) => encodeURIComponent(`${v}.${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(v)))))}`);
  return c.json({ cookies: [{ name: ctx.authCookies.sessionToken.name, value: await sign(sess.token) }, { name: ctx.authCookies.dontRememberToken.name, value: await sign("true") }], expires: sess.expiresAt }, 200, { "cache-control": "no-store" });
});
// 감독 규칙 분(시험 계정에서 짧게 — 기본 30 · 30 · 15)
app.post("/api/admin/f7-flag", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ name?: string; on?: boolean; note?: string }>().catch(() => ({} as { name?: string; on?: boolean; note?: string }));
  if (!/^(read|write|shadow)_[a-z]{2,20}$/.test(b.name || "")) return c.json({ error: "name = read_|write_|shadow_<묶음>" }, 400);
  await ledger.setFlag(c.env.DB, b.name!, !!b.on, String(b.note || "").slice(0, 200));
  return c.json({ ok: true, flags: (await c.env.DB.prepare("SELECT name, on_at, note FROM f7_flag ORDER BY name").all()).results });
});
app.post("/api/admin/engine/drain", async c => {   // 그 기기 엔진 칸에 밀린 사람 글을 넣게 함 — { device }. 옛 코드 칸이면 오류 글로 알 수 있음
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ device?: string }>().catch(() => ({} as { device?: string }));
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(b.device || "")) return c.json({ error: "device" }, 400);
  try { return c.json({ ok: true, ...(await (engineOf(c.env, b.device!) as unknown as { drainCmds(): Promise<object> }).drainCmds()) }); } catch (e) { return c.json({ ok: false, error: String(e).slice(0, 200) }, 500); }
});
app.post("/api/admin/regroup", async c => {   // 그 사람 노드를 지금 표로 다시 묶음(묶는 규칙을 고친 뒤) — { email }
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
  const me = String(b.email || "").trim().toLowerCase(); if (!me.includes("@")) return c.json({ error: "email" }, 400);
  await regroup(c.env as never, me); return c.json({ ok: true });
});
app.post("/api/admin/live/drop", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ who?: string; abort?: boolean; old?: boolean }>().catch(() => ({} as { who?: string; abort?: boolean; old?: boolean }));
  if (!/^[^@\s]{1,80}@[^@\s]{1,120}$/.test(b.who || "")) return c.json({ error: "who = 메일" }, 400);
  if (b.old) return c.json({ ok: true, closed: await c.env.SNAP.get(c.env.SNAP.idFromName(isOwner(c.env, b.who!) ? "owner@wnam" : `live:${b.who!.trim().toLowerCase()}@wnam`), { locationHint: "wnam" }).drop(!!b.abort) });
  return c.json({ ok: true, closed: await live.liveOf(c.env, b.who!).drop(!!b.abort) });
});
app.post("/api/admin/owner-engine/device", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const owner = c.env.ALLOW_EMAILS.split(",")[0].trim().toLowerCase(), now = Date.now();
  const old = (await c.env.DB.prepare("SELECT id FROM device WHERE scope = 'harness' AND revoked_at IS NULL").all<{ id: string }>()).results;
  const id = rand(9), tok = "bxd_" + rand(32);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE device SET revoked_at = ? WHERE scope = 'harness' AND revoked_at IS NULL").bind(now),
    c.env.DB.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,'harness')").bind(id, owner, clean(b.name, 60) || "owner-host harness", "", await sha(tok), now, now),
  ]);
  for (const o of old) await engineOf(c.env, o.id).revoke().catch(() => null);
  return c.json({ token: tok, device_id: id, email: owner, server: c.env.PUBLIC_URL, scope: "harness", revoked: old.length }, 200, { "cache-control": "no-store" });
});
app.post("/api/admin/owner-engine/revoke", async c => {   // 되돌리기: 엔진 길 끔(다리는 그대로)
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const old = (await c.env.DB.prepare("SELECT id FROM device WHERE scope = 'harness' AND revoked_at IS NULL").all<{ id: string }>()).results;
  await c.env.DB.prepare("UPDATE device SET revoked_at = ? WHERE scope = 'harness' AND revoked_at IS NULL").bind(Date.now()).run();
  for (const o of old) await engineOf(c.env, o.id).revoke().catch(() => null);
  return c.json({ ok: true, revoked: old.length });
});
// 시험 글: 늘 test 표시 → 어댑터가 시험 세션(hb-test) 판에만 넣음(운영 판은 거절). 바쁨 409 · 엔진 꺼짐 503
app.post("/api/admin/owner-engine/send", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ pane?: string; text?: string; queue?: boolean }>().catch(() => ({} as { pane?: string; text?: string; queue?: boolean }));
  const text = String(b.text || "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").trim().slice(0, 4000);
  if (!text) return c.json({ error: "text" }, 400);
  try {
    const r = await engineSend(c.env, String(b.pane || ""), text, { test: true, queue: !!b.queue });
    return c.json({ ok: !!(r.sent || r.queued), ...r }, r.busy ? 409 : r.offline ? 503 : 200);
  } catch (e) { return c.json({ ok: false, error: String((e as Error).message).slice(0, 200), code: (e as { code?: number }).code || 1 }, (e as { code?: number }).code === 4 ? 404 : 400); }
});
app.get("/api/admin/owner-engine", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const d = await harnessDevice(c.env.DB);
  const live = d ? await (engineOf(c.env, d.id) as unknown as { hstatus: () => Promise<object> }).hstatus().catch(e => ({ error: String(e).slice(0, 100) })) : null;
  return c.json({ device: d ? { id: d.id, engine_at: d.engine_at, live } : null, ...(await ownerWindows(c.env)) });
});
app.post("/api/engine/open", async c => {
  const d = await deviceOf(c); if (!d || !(await member(c.env, d.owner))) return c.json({ ok: false, error: "기기 토큰" }, 401);
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ ok: false, error: "bad json" }, 400);
  const line = (v: unknown, n: number) => String(v ?? "").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, n);
  const path = (v: unknown) => { const p = String(v ?? "").trim(); return p && /^[~/][^\x00-\x1f\x7f]{0,299}$/.test(p) && !/(^|\/)\.\.(\/|$)/.test(p) ? p : null; };
  const name = line(b.name, 40); if (!name) return c.json({ ok: false, error: "이름(name)" }, 400);
  const cwd = b.cwd == null || b.cwd === "" ? `~/boarder/${name.replace(/[^\w가-힣-]+/g, "-").slice(0, 30) || "window"}` : path(b.cwd);
  const config_dir = b.config_dir == null || b.config_dir === "" ? undefined : path(b.config_dir);
  if (!cwd || config_dir === null) return c.json({ ok: false, error: "폴더는 ~ 나 / 로 시작하는 경로" }, 400);
  const prompt = String(b.prompt ?? "").slice(0, 8000);
  const db = c.env.DB, dev = b.device ? String(b.device) : d.id;
  const ok = await db.prepare("SELECT 1 FROM device WHERE id = ? AND owner = ? AND revoked_at IS NULL AND scope = 'full' AND engine_at > ?").bind(dev, d.owner, Date.now() - 120_000).first();
  if (!ok) return c.json({ ok: false, error: "엔진이 켜진 내 기기가 아니에요" }, 409);
  const n = (await db.prepare("SELECT count(*) AS n FROM engine_window WHERE owner = ? AND created_at > ?").bind(d.owner, Date.now() - 3600_000).first<{ n: number }>())?.n || 0;
  if (n >= 30) return c.json({ ok: false, error: "한 시간에 30창까지예요" }, 429);
  try {
    const r = await engineOf(c.env, dev).open({ owner: d.owner, kind: "role", name, cwd, prompt, ...(config_dir ? { config_dir } : {}) });
    await sysLine(db, d.owner, `「${name}」 창을 기기(${line(d.name, 40) || "이름 없음"})에서 바로 열었어요`, r.id).catch(() => null);
    c.executionCtx.waitUntil(live.bumpMember(c.env, d.owner).catch(() => null));
    return c.json({ ok: true, id: r.id, device: dev });
  } catch (e) { return engErr(c, e); }
});
app.get("/api/engine/windows", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401); if (!isOwner(c.env, s.user.email)) return c.json({ error: "no" }, 403);
  return c.json(await ownerWindows(c.env));
});
app.post("/api/admin/engine-rules", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ owner?: string; rules?: Record<string, number | boolean> | null }>().catch(() => ({} as { owner?: string; rules?: Record<string, number | boolean> | null }));
  const owner = String(b.owner || "").toLowerCase(); if (!owner) return c.json({ error: "owner" }, 400);
  const rules = b.rules ? Object.fromEntries(Object.entries(b.rules).filter(([k, v]) => k in RULES && (k === "one_goal" ? typeof v === "boolean" : typeof v === "number" && v >= 1 && v <= 1440))) : null;
  await c.env.DB.prepare("INSERT INTO engine_owner(owner, rules, updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET rules = excluded.rules, updated_at = excluded.updated_at").bind(owner, rules ? JSON.stringify(rules) : null, Date.now()).run();
  return c.json({ ok: true, rules: (await ownerCfg(c.env.DB, owner)).rules });
});
app.get("/api/admin/agent-tokens", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const r = await c.env.DB.prepare("SELECT pane, win, host, created_at, tools FROM agent_token WHERE revoked_at IS NULL ORDER BY created_at").all();
  return c.json({ live: r.results });
});
app.put("/api/admin/blobs/:id", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const id = c.req.param("id"), type = c.req.header("content-type") || "";
  if (!/^[0-9a-f]{32}$/.test(id) || !/^(image\/(png|jpeg|webp|gif|avif)|font\/(woff2?|ttf|otf))$/.test(type)) return c.json({ error: "id · 이미지 · 글꼴 꼴" }, 400);
  const body = await c.req.arrayBuffer(); if (!body.byteLength || body.byteLength > 15 << 20) return c.json({ error: "크기" }, 400);
  await c.env.RESULTS.put(`blobs/${id}`, body, { httpMetadata: { contentType: type } });
  return c.json({ ok: true, bytes: body.byteLength });
});
app.post("/api/admin/agent-tokens/scope", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const { pane, host, tools } = await c.req.json<{ pane?: string; host?: string; tools?: string }>().catch(() => ({} as Record<string, undefined>));
  const t = String(tools || "").trim();
  if (!pane || !(t === "*" || /^[a-z0-9_*-]+(,[a-z0-9_*-]+)*$/.test(t))) return c.json({ error: "pane · tools('*' 또는 도구,도구)" }, 400);
  const r = await c.env.DB.prepare("UPDATE agent_token SET tools = ? WHERE pane = ? AND host = ? AND revoked_at IS NULL").bind(t, pane, host || "owner-host").run();
  tokCache.clear();
  return c.json({ ok: true, changed: r.meta.changes });
});
const kst = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
app.get("/api/admin/tools", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  await registry(c.env.DB, t => c.executionCtx.waitUntil((boardTool(c.env, "owner", "flag", { text: t }, "boarder@worker") as Promise<unknown>).catch(() => {})), c.env.CF_VERSION_METADATA, true);
  const r = await c.env.DB.prepare("SELECT name, enabled, mask, code_hash, active_hash, updated_at FROM tool_state ORDER BY name").all();
  return c.json({ tools: r.results });
});
app.post("/api/admin/tools/:name", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ enabled?: boolean; mask?: boolean }>().catch(() => ({} as { enabled?: boolean; mask?: boolean }));
  const sets: string[] = [], vals: unknown[] = [];
  if (typeof b.enabled === "boolean") { sets.push("enabled = ?"); vals.push(b.enabled ? 1 : 0); }
  if (typeof b.mask === "boolean") { sets.push("mask = ?"); vals.push(b.mask ? 1 : 0); }
  if (!sets.length) return c.json({ error: "enabled · mask" }, 400);
  const r = await c.env.DB.prepare(`UPDATE tool_state SET ${sets.join(", ")}, updated_at = ? WHERE name = ?`).bind(...vals, Date.now(), c.req.param("name")).run();
  dropCache();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "없는 도구" }, 404);
});
app.get("/api/admin/tools/:name/history", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const name = c.req.param("name");
  const st = await c.env.DB.prepare("SELECT active_hash, code_hash FROM tool_state WHERE name = ?").bind(name).first<{ active_hash: string; code_hash: string }>();
  if (!st) return c.json({ error: "없는 도구" }, 404);
  const vs = (await c.env.DB.prepare("SELECT hash, description, at FROM tool_desc WHERE name = ? ORDER BY at, hash").bind(name).all<{ hash: string; description: string; at: number }>()).results;
  return c.json({ ...st, versions: vs.map((v, i) => ({ hash: v.hash, at_kst: kst(v.at), description: v.description, diff: i ? diff(vs[i - 1].description, v.description) : null })) });
});
app.post("/api/admin/tools/:name/rollback", async c => {   // 옛 설명 판으로 — 코드가 설명을 다시 바꾸면 그 새 판이 이김
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const { hash } = await c.req.json<{ hash?: string }>().catch(() => ({} as { hash?: string }));
  const name = c.req.param("name");
  const v = await c.env.DB.prepare("SELECT 1 FROM tool_desc WHERE name = ? AND hash = ?").bind(name, String(hash || "")).first();
  if (!v) return c.json({ error: "그 판이 없음" }, 404);
  await c.env.DB.prepare("UPDATE tool_state SET active_hash = ?, updated_at = ? WHERE name = ?").bind(hash, Date.now(), name).run();
  dropCache();
  return c.json({ ok: true, active_hash: hash });
});

app.post("/api/admin/connections/expire", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const { id } = await c.req.json<{ id?: string }>().catch(() => ({} as { id?: string }));
  if (!id || !/^c_[0-9a-f]{20}$/.test(id)) return c.json({ error: "id" }, 400);
  const row = await c.env.DB.prepare("SELECT kind, auth FROM connection WHERE id = ?").bind(id).first<{ kind: string; auth: string }>();
  if (!row || row.kind !== "oauth" && row.kind !== "api") return c.json({ error: "OAuth 연결 없음" }, 404);   // api = 구글 로그인 API(캘린더 · Gmail)
  const a = await unseal<{ refresh_token?: string; expires_at?: number }>(c.env.CONNECTOR_KEY, row.auth);
  if (!a.refresh_token) return c.json({ error: "갱신 토큰 없음" }, 422);
  const was = a.expires_at ?? null;
  const r = await c.env.DB.prepare("UPDATE connection SET auth = ?, updated_at = ? WHERE id = ? AND auth = ?").bind(await seal(c.env.CONNECTOR_KEY, { ...a, expires_at: Date.now() - 1000 }), Date.now(), id, row.auth).run();
  if (!r.meta.changes) return c.json({ error: "그새 바뀜 — 다시" }, 409);
  return c.json({ ok: true, was });
});

mountHooks(app, async c => { const s = await signedIn(c as unknown as Context<{ Bindings: Env }>); return s ? { owner: allowed(c.env as unknown as Env, s.user.email) ? "" : s.user.email, email: s.user.email } : null; },
  async (env, _ctx, target, text) => { const r = await (boardTool(env as unknown as Env, "owner", "hook_wake", { target, text }, "boarder@worker") as Promise<{ delivered?: string }>); return String(r?.delivered || "woke"); });
mountConnectors(app, async c => { const s = await signedIn(c as unknown as Context<{ Bindings: Env }>); return s ? { owner: allowed(c.env as unknown as Env, s.user.email) ? "" : s.user.email, email: s.user.email } : null; });

app.post("/api/dev/ch", async c => {
  if (c.req.header("x-hb") !== "1" || !["same-origin", "none", undefined].includes(c.req.header("sec-fetch-site"))) return c.json({ error: "no" }, 403);
  const sd = await signedIn(c); if (!sd) return c.json({ error: "로그인" }, 401); if (!isOwner(c.env, sd.user.email)) return c.json({ error: "no" }, 403);
  const to = c.req.query("to") === "test" ? "test" : "owner";
  return c.json({ ch: to }, 200, { "set-cookie": `bx-ch=${to}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${to === "test" ? 3600 : 0}` });
});

let artKinds: { at: number; ch: string; kinds: Record<string, string> } | null = null;
async function isCanvas(env: Env, ch: string, id: string) {
  if (ch === "owner" && await ledger.f7On(env.DB, "read_files")) { const ix = await files.index(env); if (ix) return ix.arts[id]?.kind === "canvas"; }
  if (!artKinds || artKinds.ch !== ch || Date.now() - artKinds.at > 60_000) {
    const r = await boardCall(env, ch, { method: "GET", path: "/api/arts", headers: { accept: "application/json" } });
    const j = r.status === 200 ? JSON.parse(new TextDecoder().decode(r.body)) as Record<string, { kind?: string }> : {};
    artKinds = { at: Date.now(), ch, kinds: Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v.kind || ""])) };
  }
  return artKinds.kinds[id] === "canvas";
}

const PASS_REQ = ["accept", "content-type", "if-none-match", "x-hb", "range", "x-file-name", "x-request-id"];
const PASS_RES = ["x-retry-safe", "content-type", "content-encoding", "etag", "cache-control", "content-disposition", "last-modified", "content-range", "accept-ranges", "x-request-id"];
const edgeCache = () => (caches as unknown as { default: Cache }).default;   // Workers 입구 캐시(DOM 타입엔 없음)
const ART_FILE = /^\/art\/([A-Za-z0-9]{16,40})\/(?:project\/)?(?:canvas\.json|[^/?#]+\.(?:html|js|css|png|jpe?g|webp|gif|avif|svg)|_assets\/[A-Za-z0-9_-]{1,80}\.(?:png|jpe?g|webp|gif|avif|svg))$/;
const artTagHtml = (id: string, t: string, body: ReadableStream) => {
  const tag = (v: string) => !v.trim() || /^(?:[a-z][a-z0-9+.-]*:|[\\/][\\/]|#|data:)/i.test(v.trim()) ? v : v.replace(/^([^?#\s]*)(\?[^#\s]*)?/, (_m, p: string, q?: string) => `${p}${q ? `${q}&` : "?"}bxt=${encodeURIComponent(t)}`);
  return new HTMLRewriter()
    .on("head", { element: e => { e.prepend(artFetchShim(id, t), { html: true }); } })
    .on("img[src], iframe[src], script[src], source[src], video[src], audio[src]", { element: e => { e.setAttribute("src", tag(e.getAttribute("src")!)); } })
    .on("link[href]", { element: e => { if (/\b(stylesheet|icon|preload|modulepreload)\b/i.test(e.getAttribute("rel") || "")) e.setAttribute("href", tag(e.getAttribute("href")!)); } })
    .on("img[srcset], source[srcset]", { element: e => { e.setAttribute("srcset", e.getAttribute("srcset")!.split(",").map(x => { const [u, ...d] = x.trim().split(/\s+/); return [tag(u), ...d].join(" "); }).join(", ")); } })
    .transform(new Response(body)).body!;
};
async function artTok(env: Env, id: string, exp: number) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.BETTER_AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`boarder-art:${id}:${exp}`)));
  return `${exp}.${[...sig.slice(0, 16)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
}
async function artOk(env: Env, id: string, t: string | null) {
  const m = /^(\d{10,13})\.[0-9a-f]{32}$/.exec(t || ""); if (!m || +m[1] < Date.now()) return false;
  return sameToken(t!, await artTok(env, id, +m[1]));
}
const artFetchShim = (id: string, t: string) => `<script>(()=>{const T=${JSON.stringify(t)},B=location.protocol+"//"+location.host,A="/art/${id}/",tag=u=>{try{const x=new URL(u,location.href);if(x.protocol+"//"+x.host===B&&x.pathname.startsWith(A)&&x.pathname!==A){x.searchParams.set("bxt",T);return x.href}}catch(e){}return u};const F=window.fetch;window.fetch=(u,o)=>F(typeof u==="string"||u instanceof URL?tag(String(u)):u,o);const d=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,"src");Object.defineProperty(HTMLIFrameElement.prototype,"src",{get(){return d.get.call(this)},set(v){d.set.call(this,tag(String(v)))},configurable:true})})()</script>`;

const MANIFEST = JSON.stringify({ name: "보더", short_name: "보더", start_url: "/", scope: "/", display: "standalone", background_color: "#fafafa", theme_color: "#fafafa", lang: "ko",
  icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] });
app.get("/manifest.webmanifest", c => {
  const i = c.req.query("i") || "";
  const body = BLOB_ID.test(i) ? JSON.stringify({ ...JSON.parse(MANIFEST), icons: [{ src: `/_blob/${i}.png`, sizes: "512x512", type: "image/png" }, { src: `/_blob/${i}.png`, sizes: "512x512", type: "image/png", purpose: "maskable" }] }) : MANIFEST;
  return c.body(body, 200, { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" });
});

app.get("/art/_kit.js", async c => {
  const o = await files.answer(c.env, "/art/_kit.js", {}).catch(() => null);
  return o && o.status === 200 ? new Response(o.body as BodyInit, { status: 200, headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }) : c.text("not found", 404);
});

async function filesFirst(c: Context<{ Bindings: Env }>, path: string, headers: Record<string, string>): Promise<files.Out | null> {
  const p = path.split("?")[0];
  if (chOf(c) !== "owner" || !files.FILE_PATH.test(p) || (files.isJsonPath(p) && cookieOf(c, "bx_w") && !(await ledger.f7On(c.env.DB, "write_art")))) return null;   // write_art 면 D1 이 정본이라 방금 쓴 사람도 D1
  if (!(await ledger.f7On(c.env.DB, "read_files"))) return null;
  const t = Date.now();
  try { const o = await files.answer(c.env, path, headers); return o ? { ...o, src: "r2" } : null; }
  catch (e) { capture(c.env, c.executionCtx, "$exception", "f7", { $exception_list: [{ type: "F7FilesError", value: String(e).slice(0, 300), mechanism: { handled: true } }], path: normPath(p) }); return null; }
  finally { seg(c.req.raw, "r2", Date.now() - t); }
}
// 그림자 대조(shadow_files): 다리로 답한 파일 길마다 R2 답도 만들어 몸통 해시를 견줌 → PostHog f7_shadow_files(same · miss · 길이 · 해시 앞 8바이트). 답에는 영향 없음
function filesShadow(c: Context<{ Bindings: Env }>, path: string, headers: Record<string, string>, r: { status: number; headers: Record<string, string>; body: Uint8Array }, who: string) {
  const p = path.split("?")[0];
  if (chOf(c) !== "owner" || !files.FILE_PATH.test(p) || r.body.length > 8 * 1024 * 1024) return;
  const out = { status: r.status, headers: { ...r.headers }, body: r.body.slice() };
  c.executionCtx.waitUntil((async () => {
    if (!(await ledger.f7On(c.env.DB, "shadow_files"))) return;
    const r2 = await files.answer(c.env, path, headers).catch(() => null);
    capture(c.env, c.executionCtx, "f7_shadow_files", who, { path: normPath(p), ...(await files.compare(out, r2)) });
  })().catch(() => {}));
}
const fromR2 = (out: Headers) => out.set("x-boarder-src", "r2");   // 확인용(완료 기준: 응답 머리로 R2 에서 온 것)

async function ledgerFresh(env: Env) {
  const [cf, sy] = await Promise.all([snap(env).get("cfg"), snap(env).get("sync")]);
  const ok = (x: { at: number; checked: number } | null, lim: number) => !!x && Date.now() - Math.max(x.at, x.checked || 0) < lim;
  return ok(cf, 120_000) && ok(sy, 30_000);
}
type Snap = { body: string; etag: string; at: number; checked: number } | null;
const fresh2 = (x: Snap) => !!x && Date.now() - Math.max(x.at, x.checked || 0) < 120_000;
function historySince(h: { oldest: number; rows: { open?: boolean; segs: [number, number, string][]; marks: [number][] }[] }, q: string | null) {
  // history.py history() 와 같은 거르기: since 뒤에 걸친 막대 · 표시만, 닫힌 지 오래된 창의 닫힘 막대 하나는 뺌
  const now = Date.now() / 1000, since = Math.max(q && /^\d{9,11}$/.test(q) ? Number(q) : now - 72 * 3600, h.oldest - 60), rows = [];
  for (const r of h.rows) {
    const segs = r.segs.filter(x => x[1] > since);
    if (!segs.length || (!r.open && segs.length === 1 && segs[0][2] === "closed" && segs[0][0] < since)) continue;
    rows.push({ ...r, segs, marks: r.marks.filter(m => m[0] > since) });
  }
  return { now: Math.round(now), since: Math.round(since), oldest: h.oldest, rows };
}
async function ownMisc(c: Context<{ Bindings: Env }>, url: URL): Promise<Response | null> {
  const p = url.pathname, j = (o: unknown) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-f7": "snap" } });
  if (p === "/api/history") {
    if (!(await ledger.f7On(c.env.DB, "read_log"))) return null;
    const h = await snap(c.env).get("history"); return fresh2(h) ? j(historySince(JSON.parse(h!.body), url.searchParams.get("since"))) : null;
  }
  if (!["/emoji.json", "/api/push/key", "/api/drafts"].includes(p) || !(await ledger.f7On(c.env.DB, "read_misc"))) return null;
  if (p === "/emoji.json") {
    const e = await snap(c.env).get("emoji"); if (!e) return null;
    if (c.req.header("if-none-match") === e.etag) return new Response(null, { status: 304, headers: { etag: e.etag } });
    return new Response(e.body, { headers: { "content-type": "application/json; charset=utf-8", etag: e.etag, "x-f7": "snap" } });
  }
  if (p === "/api/drafts" && await ledger.f7On(c.env.DB, "write_state")) { const d = await OS.get(c.env.DB, "drafts").catch(() => null); if (d) return j(d.v); }
  if (p === "/api/drafts" && cookieOf(c, "bx_w")) return null;   // 방금 쓴 사람은 다리로(cfg 는 5초쯤 늦음)
  const cf = await snap(c.env).get("cfg"); if (!fresh2(cf)) return null;
  const v = JSON.parse(cf!.body) as { push_key?: string; drafts?: unknown };
  if (p === "/api/push/key") return v.push_key ? j({ key: v.push_key }) : null;
  return j(v.drafts || {});
}
// 첫 화면 큰 덩어리 캐시(bxs.ts): 틀은 ETag 마다 한 번 덩어리를 빼 둠(isolate 메모리) · 뺀 덩어리는 R2 bxs/ 에도(다른 isolate · 틀이 바뀐 사이에 온 요청이 받게)
const bxStore = new bxs.Store(), bxSaved = new Set<string>();
const bxPut = (sha: string, b: bxs.Block) => bxStore.set(sha, b);
function bxSave(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, shas: string[]) {
  const todo = shas.filter(s => !bxSaved.has(s)); if (!todo.length) return;
  for (const s of todo) bxSaved.add(s);
  ctx.waitUntil(Promise.all(todo.map(async s => {
    const b = bxStore.get(s); if (!b) return;
    const k = `bxs/${s}.${b.kind}`;
    if (!(await env.RESULTS.head(k))) await env.RESULTS.put(k, b.body, { httpMetadata: { contentType: bxs.TYPE[b.kind] } });
  })).catch(() => { for (const s of todo) bxSaved.delete(s); }));
}
// 틀(page 스냅숏) → 덩어리를 뺀 HTML. 값(약속 말고)만 남김 — 요청끼리 promise 를 나누지 않음. 못 빼면 원래 틀(전부 인라인)
let bxTpl: { etag: string; html: string; shas: string[] } | null = null;
async function tplHtml(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, pg: { body: string; etag: string }) {
  if (bxTpl?.etag !== pg.etag) {
    const raw = (JSON.parse(pg.body) as { html: string }).html, shas: string[] = [];
    const x = await bxs.extract(raw, (sha, b) => { shas.push(sha); bxPut(sha, b); }, ["__BX_DATA__", "__BX_DTAG__"]).catch(() => null);
    bxTpl = { etag: pg.etag, html: x?.html ?? raw, shas };
  }
  bxSave(env, ctx, bxTpl.shas);
  return bxTpl.html;
}
// 껍데기(Worker 묶음) 덩어리 태그: isolate 마다 처음 한 번 해시. 못 만들면 null(인라인)
let bxShell: { head: string; body: string; shas: string[] } | null = null;
async function shellTags(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
  if (!bxShell) {
    const shas: string[] = [], put = (sha: string, b: bxs.Block) => { shas.push(sha); bxPut(sha, b); }, esc = (s: string) => s.replace(/<\//g, "<\\/");
    const t = await Promise.all([bxs.pack([{ kind: "css", body: shellCss, id: "hbx-css" }, { kind: "css", body: settingsCss, id: "hbx-set-css" }], put),
      bxs.pack([{ kind: "js", body: esc(shellJs) }, { kind: "js", body: esc(botPickJs) }, { kind: "js", body: esc(settingsJs) }], put)]).catch(() => null);
    if (!t) return null;
    bxShell = { head: t[0], body: t[1], shas };
  }
  bxSave(env, ctx, bxShell.shas);
  return bxShell;
}
app.get("/bxs/:f", async c => {
  const m = bxs.PATH.exec(new URL(c.req.url).pathname); if (!m) return c.text("not found", 404);
  if (!(await signedIn(c))) return c.text("로그인", 401, { "cache-control": "no-store" });   // 주인 · 회원 둘 다(틀은 회원 화면도 같은 것)
  const [, sha, kind] = m as unknown as [string, string, bxs.Kind];
  let b = bxStore.get(sha);
  if (!b) { await shellTags(c.env, c.executionCtx); b = bxStore.get(sha); }
  if (!b) { const o = await c.env.RESULTS.get(`bxs/${sha}.${kind}`).catch(() => null); if (o) { b = { kind, body: await o.text() }; bxPut(sha, b); bxSaved.add(sha); } }
  if (!b) { const pg = await snap(c.env).get("page").catch(() => null); if (pg) { await tplHtml(c.env, c.executionCtx, pg); b = bxStore.get(sha); } }
  if (!b || b.kind !== kind) return c.text("not found", 404, { "cache-control": "no-store" });
  const h = { "content-type": bxs.TYPE[kind], "cache-control": bxs.CACHE, etag: `"${sha}"`, "x-content-type-options": "nosniff" };
  if ((c.req.header("if-none-match") || "").replace(/^W\//, "") === h.etag) return new Response(null, { status: 304, headers: h });
  return new Response(b.body, { headers: h });
});
async function ownPage(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
  const [pg, dt] = await Promise.all([snap(env).get("page"), snap(env).get("data")]);
  const fresh = (x: { at: number; checked: number }) => Date.now() - Math.max(x.at, x.checked || 0) < 15_000;
  if (!pg || !dt || !fresh(pg) || !fresh(dt)) return null;
  const html = (await tplHtml(env, ctx, pg))
    .replace("__BX_DATA__", () => dt.body.replace(/<\//g, "<\\/")).replace('"__BX_DTAG__"', () => JSON.stringify(dt.etag));
  return { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } as Record<string, string>, body: new TextEncoder().encode(html) };
}
async function memberPage(c: Context<{ Bindings: Env }>, me: string, name: string | null | undefined, bot: Bot) {
  const pg = await snap(c.env).get("page"); if (!pg) return null;   // 틀(코드만, 주인 데이터 없음 — page-template.py)이 아직 없으면 503 한 줄
  await memberBoard.fresh(c.env, me).catch(e => console.error("묶기", e));
  const d = JSON.stringify(await memberBoard.data(c.env.DB, me, bot)), tag = await memberBoard.etag(d);
  const html = (await tplHtml(c.env, c.executionCtx, pg)).replace("__BX_DATA__", () => d.replace(/<\//g, "<\\/")).replace('"__BX_DTAG__"', () => JSON.stringify(tag));
  // 회원 값: 채널은 Primary 하나(보드 CH) · 내 이름 · 메인 봇 이름. 영역 칸이 하나라 트리 줄을 한 칸으로
  const member = `<script>window.HB_CH = ["primary"]; window.HB_MEMBER = ${JSON.stringify({ email: me, name: String(name || me.split("@")[0]).slice(0, 40), bot: bot.name }).replace(/</g, "\\u003c")}</script><style id="hbm-css">.areas{grid-template-columns:minmax(0,320px)!important;justify-content:center}</style>`;
  const res = new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "frame-ancestors 'self'", "x-frame-options": "SAMEORIGIN", "x-boarder-src": "member" } });
  return boardShell(c, res, me, member, await ledger.f7On(c.env.DB, "write_queue"));
}
// 회원 쓰기: 보드 몸통을 회원 길(/api/me/*)로 바꿔 같은 앱에 다시 부름(같은 쿠키 · 같은 문 검사) — 답은 보드 꼴(rid · state ok)
async function memberPost(c: Context<{ Bindings: Env }>, me: string, url: URL) {
  if (!sameSite(c)) return c.json({ ok: false, error: "forbidden" }, 403);
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ ok: false, error: "bad json" }, 400);
  const rid = String(b.rid || "").slice(0, 64);
  let hop: Awaited<ReturnType<typeof memberBoard.post>>;
  try { hop = await memberBoard.post(c.env.DB, me, url.pathname, b); } catch { return queue.retrySafe(c); }   // 읽기만(쓰기 전) — D1 실패는 다시 보내도 됨
  if ("error" in hop) return c.json({ ok: false, error: hop.error }, hop.status as 400);
  if ("ok" in hop) return c.json({ rid, ...hop.ok });
  const h = new Headers({ "content-type": "application/json", "x-hb": "1", cookie: c.req.header("cookie") || "" });
  const sf = c.req.header("sec-fetch-site"); if (sf) h.set("sec-fetch-site", sf);
  const r = await app.fetch(new Request(new URL(hop.path, url), { method: "POST", headers: h, body: JSON.stringify({ ...(hop.body as object), ...(rid ? { rid } : {}) }) }), c.env, c.executionCtx);   // rid 도 넘김(안쪽 쓰기가 한 번만)
  const j = await r.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (!r.ok || j.ok === false) return c.json({ ok: false, rid, error: typeof j.error === "string" ? j.error : "일시적인 오류가 발생했어요" }, (r.ok ? 400 : r.status) as 400, r.headers.get("x-retry-safe") === "1" ? { "x-retry-safe": "1" } : {});
  if (hop.log && !j.already) await c.env.DB.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").bind(me, hop.log.win.slice(0, 120), "me", hop.log.text.slice(0, 4000), null, Date.now(), Array.isArray(j.cmds) && j.cmds[0] ? `cmd:${j.cmds[0]}` : null).run().catch(e => console.error("노드 채팅 줄", e));
  return c.json({ ...j, ok: true, rid, state: "ok", channel: "primary" });
}
async function boardShell(c: Context<{ Bindings: Env }>, res: Response, email: string, member = "", q = false) {
  // 큰 껍데기 css · js 는 /bxs 주소로(bxs.ts — 같은 차례, 고전 스크립트). 해시를 못 만들면 예전처럼 인라인
  const bx = await shellTags(c.env, c.executionCtx).catch(() => null);
  return new HTMLRewriter()
      .on('meta[name="apple-mobile-web-app-title"]', { element: e => { e.setAttribute("content", "보더"); } })
      .on("head", { element: async e => { if (member) e.prepend(member, { html: true }); e.prepend(`<script>window.BX_Q = ${q ? 1 : 0}; window.BX_FLAGS_OFF = ${JSON.stringify(String((c.env as unknown as { FLAGS_OFF?: string }).FLAGS_OFF || "").split(",").map(x => x.trim()).filter(Boolean))}</script>`, { html: true }); e.prepend("<script>window.HB_HASH0 = location.hash; if (/^#(chat\\/|art\\/|node\\/|w\\/|inbox$|settings)/.test(location.hash)) history.replaceState(history.state, '', '#tree'); document.documentElement.classList.add('bx-boot'); setTimeout(function(){ document.documentElement.classList.remove('bx-boot') }, 4000)</script>", { html: true });
        e.append(`<style>html.bx-boot body{visibility:hidden}</style>` + (bx ? bx.head : `<style id="hbx-css">${shellCss}</style><style id="hbx-set-css">${settingsCss}</style>`) + snippet(c.env, await phId(c.env, email)), { html: true }); } })
      .on("body", { element: e => { e.append((bx ? bx.body : `<script>${shellJs.replace(/<\//g, "<\\/")}</script><script>${botPickJs.replace(/<\//g, "<\\/")}</script><script>${settingsJs.replace(/<\//g, "<\\/")}</script>`) + `<script>document.documentElement.classList.remove('bx-boot')</script>`, { html: true }); } })
    .transform(res);
}
app.all("*", async c => {
  const url = new URL(c.req.url);
  // React 꾸러미(/assets, 해시 이름)와 기본 봇 그림은 누구에게나 Boarder 것 — 주인이 /device 를 열어도 빈 화면이 안 되게(보드에는 /assets 가 없음)
  if (/^\/(assets|landing)\//.test(url.pathname) || url.pathname === "/icons/primary-blob.svg" || url.pathname === "/node-rules.md") return c.env.ASSETS.fetch(c.req.raw);
  if (url.pathname.startsWith("/icons/")) { const a = await c.env.ASSETS.fetch(c.req.raw); if (a.status === 304) return a; if (a.ok && /^image\//.test(a.headers.get("content-type") || "")) { const h = new Headers(a.headers); h.set("cache-control", "public, max-age=86400"); return new Response(a.body, { status: 200, headers: h }); } }
  if (/^\/(assets|icons)\//.test(url.pathname) && !(await signedIn(c))) return c.env.ASSETS.fetch(c.req.raw);
  if (c.req.method === "GET" && (/^\/_blob\/[0-9a-f]{32}(\.[a-z0-9]{1,5})?$/.test(url.pathname) || /^\/art\/[A-Za-z0-9]{16,40}\/support\.js$/.test(url.pathname))) {
    const blobId = /^\/_blob\/([0-9a-f]{32})/.exec(url.pathname)?.[1];
    if (blobId) {
      // 내용 해시 주소라 바뀌지 않음 — 입구 캐시 먼저(R2 버킷은 아시아라 미국 입구에서 멂)
      const ck = new Request(`${url.origin}/_blob/${blobId}`), tc = Date.now(), cached = await edgeCache().match(ck); seg(c.req.raw, "cache", Date.now() - tc); hit(c.req.raw, "blob", !!cached);
      if (cached) return cached;
      const t1 = Date.now(), o = await c.env.RESULTS.get(`blobs/${blobId}`); seg(c.req.raw, "r2", Date.now() - t1);
      if (o) {
        const res = new Response(o.body, { headers: { "content-type": o.httpMetadata?.contentType || "application/octet-stream", "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "cache-control": "public, max-age=86400", etag: o.httpEtag } });
        c.executionCtx.waitUntil(edgeCache().put(ck, res.clone()));
        return res;
      }
    }
    try {
      const fr = await filesFirst(c, url.pathname, {});
      const t1 = Date.now(), r = fr ?? await boardCall(c.env, "owner", { method: "GET", path: url.pathname, headers: { "accept-encoding": "gzip" } }); if (!fr) { bridgeSeg(c.req.raw, Date.now() - t1, r.headers); filesShadow(c, url.pathname, {}, r, "anon"); }
      const h = new Headers({ "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "cache-control": r.status === 200 ? "private, max-age=86400" : "no-store" });
      for (const k of ["content-type", "content-encoding", "etag"]) if (r.headers[k]) h.set(k, r.headers[k]);
      if (fr) fromR2(h);
      return new Response(r.body as unknown as BodyInit, { status: r.status, headers: h, ...(h.get("content-encoding") ? { encodeBody: "manual" as const } : {}) });
    } catch { return c.json({ error: "일시적인 오류가 발생했어요" }, 503); }
  }
  const aj = c.req.method === "GET" && url.searchParams.has("bxt") && !/%2f|%5c/i.test(url.pathname) ? ART_FILE.exec(url.pathname) : null;
  if (aj && await artOk(c.env, aj[1], url.searchParams.get("bxt"))) {
    try {
      const fh = { accept: c.req.header("accept") || "*/*", "accept-encoding": "gzip" }, fr = await filesFirst(c, url.pathname, fh);
      const t1 = Date.now(), r = fr ?? await boardCall(c.env, chOf(c), { method: "GET", path: url.pathname, headers: fh }); if (!fr) { bridgeSeg(c.req.raw, Date.now() - t1, r.headers); filesShadow(c, url.pathname, fh, r, "anon"); }
      const h = new Headers({ "access-control-allow-origin": "*", "x-content-type-options": "nosniff", "content-security-policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads", "cache-control": "private, no-store" });
      for (const k of ["content-type", "content-encoding"]) if (r.headers[k]) h.set(k, r.headers[k]);
      if (fr) fromR2(h);
      if (r.status === 200 && url.pathname.endsWith(".html")) {
        let b = new Response(r.body as unknown as BodyInit).body!;
        if (h.get("content-encoding") === "gzip") { b = b.pipeThrough(new DecompressionStream("gzip")); h.delete("content-encoding"); }
        h.delete("content-length");
        return new Response(artTagHtml(aj[1], url.searchParams.get("bxt")!, b), { status: 200, headers: h });
      }
      return new Response(r.body as unknown as BodyInit, { status: r.status, headers: h, ...(h.get("content-encoding") ? { encodeBody: "manual" as const } : {}) });
    } catch { return c.json({ error: "일시적인 오류가 발생했어요" }, 503); }
  }
  const s = await signedIn(c);
  if (!s) {
    if (url.pathname.startsWith("/api/")) return c.json({ error: "로그인" }, 401);
    if (url.pathname === "/" && (c.req.method === "GET" || c.req.method === "HEAD"))
      return c.html(landingPage(c.env.PUBLIC_URL, snippet(c.env), undefined, undefined, c.env.SOURCE_URL), 200, { ...NOFRAME, "cache-control": "private, no-cache", vary: "cookie" });
    const page = await c.env.ASSETS.fetch(new Request(new URL("/", url), c.req.raw));   // 로그인 화면(React)에도 PostHog
    return new HTMLRewriter().on("head", { element: e => { e.append(snippet(c.env), { html: true }); } }).transform(page);
  }
  if (url.pathname === "/login" && c.req.method === "GET") return c.redirect("/", 302);   // 이미 들어온 사람이 랜딩의 「로그인」을 누르면 보드로
  if (url.pathname === "/device" && c.req.method === "GET") {
    const page = await c.env.ASSETS.fetch(new Request(new URL("/", url), c.req.raw)), h = new Headers(page.headers);
    for (const [k, v] of Object.entries(NOFRAME)) h.set(k, v);
    return new Response(page.body, { status: 200, headers: h });
  }
  if (!isOwner(c.env, s.user.email)) {
    if (/^\/(assets|icons)\//.test(url.pathname)) return c.env.ASSETS.fetch(c.req.raw);
    if (url.pathname === "/" && c.req.method === "GET") {
      const bot = await memberBot(c.env, s.user.email.toLowerCase()), js = { blob: blobJs, pick: botPickJs };
      if (!bot) return c.html(memberOnboard(s.user.email, js), 200, { ...NOFRAME, "cache-control": "no-store" });
      const pg = await memberPage(c, s.user.email.toLowerCase(), (await c.env.DB.prepare("SELECT name FROM \"user\" WHERE email = ?").bind(s.user.email).first<{ name: string }>().catch(() => null))?.name, bot);
      return pg ?? c.html("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><p style='font:15px system-ui;padding:40px'>일시적인 오류가 발생했어요</p>", 503, { ...NOFRAME, "cache-control": "no-store", "retry-after": "5" });
    }
    {
      const me = s.user.email.toLowerCase();
      if (url.pathname === "/api/events" || url.pathname === "/api/push/stream") return c.json({ error: "다리 밖" }, 503);   // 주인과 같게: 화면이 20초 폴링으로
      if (c.req.method === "GET" || c.req.method === "HEAD") {
        const ans = /^\/api\/answer\/([\w-]{1,64})$/.exec(url.pathname);
        if (ans) {   // 그 rid 의 쓰기가 됐는지(rid 칸) — 늘 ok 이던 것(X1)
          if (!(await ledger.f7On(c.env.DB, "write_queue"))) return c.json({ ok: true, state: "ok" });   // rid 칸이 없으면 예전처럼
          try { const a = await queue.answerOf(c.env, me, ans[1]); return a ? c.json({ ok: true, ...a }, 200, { "cache-control": "no-store" }) : c.json({ state: "unknown" }, 404, { "cache-control": "no-store" }); }
          catch { return queue.retrySafe(c); }   // rid 칸을 못 부름 = 모름(화면은 같은 rid 로)
        }
        if (url.pathname === "/api/data") await memberBoard.fresh(c.env, me).catch(e => console.error("묶기", e));
        const r = await memberBoard.get(c.env.DB, me, await memberBot(c.env, me), url, () => snap(c.env).get("emoji"), c.req.header("if-none-match"));
        if (r) return r;
      }
      if (c.req.method === "POST") return memberPost(c, me, url);
    }
    if (docNav(c, url)) return c.redirect("/#nf", 302);
    return c.json({ error: "no" }, 403);
  }
  if (url.pathname === "/api/events" || url.pathname === "/api/push/stream") return c.json({ error: "다리 밖" }, 503);
  if (chOf(c) === "owner" && (url.pathname.startsWith("/api/push/") || url.pathname === "/sw.js") && await ledger.f7On(c.env.DB, "write_push")) return pushRoute(c, url);
  const ee = await hosted.route?.(c, url, chOf(c), { req: PASS_REQ, res: PASS_RES }, (k, ms) => seg(c.req.raw, k, ms));
  if (ee) return ee;
  if (!["GET", "HEAD", "POST"].includes(c.req.method)) return c.json({ error: "안 되는 방법" }, 405);
  const sk = c.req.method === "GET" && !url.search && chOf(c) === "owner" && !cookieOf(c, "bx_w") ? ({ "/api/data": "data", "/api/topics": "topics" } as Record<string, string>)[url.pathname] : undefined;
  if (sk) {
    const ts = Date.now(), sn = await snap(c.env).get(sk); seg(c.req.raw, "snap", Date.now() - ts);
    hit(c.req.raw, "snap", !!sn && Date.now() - Math.max(sn.at, sn.checked || 0) < 15_000);
    if (sn && Date.now() - Math.max(sn.at, sn.checked || 0) < 15_000) {
      const h = { etag: sn.etag, "cache-control": "private, no-cache", "x-content-type-options": "nosniff", "x-snap-age": String(Date.now() - Math.max(sn.at, sn.checked || 0)) };
      if ((c.req.header("if-none-match") || "").replace(/^W\//, "") === sn.etag) return new Response(null, { status: 304, headers: h });
      return new Response(sn.body, { headers: { ...h, "content-type": "application/json; charset=utf-8" } });
    }
  }
  if (c.req.method === "GET" && chOf(c) === "owner") { const m = await ownMisc(c, url).catch(() => null); if (m) return m; }
  if (c.req.method === "POST" && chOf(c) === "owner" && (url.pathname === "/api/draft" || url.pathname === "/api/nodepri") && await ledger.f7On(c.env.DB, "write_state")) {
    if (c.req.header("x-hb") !== "1") return c.json({ ok: false, error: "forbidden" }, 403);   // 다른 사이트 폼 막기(보드와 같은 문)
    const raw = new Uint8Array(await c.req.arrayBuffer());
    let b: Record<string, unknown> | null = null;
    try { b = raw.length > (url.pathname === "/api/draft" ? 200000 : 20000) ? null : JSON.parse(new TextDecoder().decode(raw) || "{}"); } catch { b = null; }
    if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ ok: false, error: "bad json" }, 400);
    const r = await (url.pathname === "/api/draft" ? OS.draft : OS.nodePri)(c.env.DB, b as Record<string, any>).catch(() => null);
    return r ? c.json(r[1], r[0] as 200) : c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, { "x-retry-safe": "1" });
  }
  if (c.req.method === "POST" && chOf(c) === "owner" && (url.pathname === "/api/artnote" || url.pathname === "/api/artfolder") && c.req.header("x-hb") === "1" && await ledger.f7On(c.env.DB, "write_art")) {
    const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!b) return c.json({ ok: false, error: "bad json" }, 400);
    let r: [number, object] | null; const rid = queue.ridOfBody(b);
    try { r = await (url.pathname === "/api/artnote" ? ownerWrite.artnote(c.env, b, rid) : ownerWrite.artfolder(c.env, b, rid)); }
    catch { return rid ? queue.retrySafe(c) : c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503); }
    if (r && r[0] < 400 && url.pathname === "/api/artnote" && !b.del && /^(?:📍\d+ \(|✅ 정함)/.test(String(b.text || "").trim()) && await files.isCanvas(c.env, String(b.art))) {
      const cut = (v: unknown, n: number) => String(v ?? "").slice(0, n);
      const sending = boardCall(c.env, chOf(c), { method: "POST", path: "/api/artpin", headers: { "content-type": "application/json", "x-hb": "1" }, body: new TextEncoder().encode(JSON.stringify({ art: cut(b.art, 40), target: cut(b.target, 200), page: cut(b.page, 200), text: cut(b.text, 4000), near: cut(b.near, 400) })) })
        .then(x => (JSON.parse(new TextDecoder().decode(x.body)) as { sent?: string | null }).sent ?? null, () => null).catch(() => null);
      c.executionCtx.waitUntil(sending);
      const sent = await Promise.race([sending, new Promise<null>(ok => setTimeout(() => ok(null), 3000))]);
      if (sent) r = [r[0], { ...r[1], sent }];
    }
    if (r) { if (r[0] < 400) c.executionCtx.waitUntil(live.bumpLedger(c.env)); return c.json(r[1], r[0] as 200); }
    return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, { "x-retry-safe": "1" });   // 색인 없음 — 쓰기 전이라 다시 보내도 됨
  }
  const rd = c.req.method === "GET" && chOf(c) === "owner" ? ownerRead.route(url.pathname + url.search) : null;
  const flag = (n: string) => rd?.kind === "inbox" ? ledger.f7Peek(c.env.DB, n, peekWait(c)) : ledger.f7On(c.env.DB, n);
  const shadowRd = !!rd && await flag("shadow_" + rd.group);
  if (rd && !cookieOf(c, "bx_w") && await flag("read_" + rd.group) && await ledgerFresh(c.env)) {
    const st = rd.kind === "inbox" && await flag("write_state");
    const rdb = rd.kind === "frequent" ? c.env.DB.withSession("first-unconstrained") as unknown as D1Database : c.env.DB;
    const res = await ownerRead.respond(rdb, () => snap(c.env).get("cfg"), rd, c.req.header("if-none-match"), st);
    if (res) return res;
  }
  const headers: Record<string, string> = {};
  for (const h of PASS_REQ) { const v = c.req.header(h); if (v) headers[h] = v; }
  const shell = /^\/art\/([A-Za-z0-9]{16,40})\/$/.exec(url.pathname);
  headers["accept-encoding"] = "gzip";
  if (shadowRd) delete headers["if-none-match"];   // 그림자 대조는 다리 몸통이 있어야 함(304 는 아래에서 Worker 가)
  const body = c.req.method === "POST" ? new Uint8Array(await c.req.arrayBuffer()) : undefined;
  if (body && body.length > 25 * 1024 * 1024) return c.json({ ok: false, error: "25MB 까지 올릴 수 있어요" }, 413);
  const own = url.pathname === "/" && c.req.method !== "POST" && chOf(c) === "owner" && await ledger.f7On(c.env.DB, "read_page") ? await ownPage(c.env, c.executionCtx).catch(() => null) : null;
  const fr = !own && (c.req.method === "GET" || c.req.method === "HEAD") ? await filesFirst(c, url.pathname + url.search, headers) : null;
  let r; const t0 = Date.now();
  try { r = own ?? fr ?? await boardCall(c.env, chOf(c), { method: c.req.method === "HEAD" ? "GET" : c.req.method, path: url.pathname + url.search, headers, ...(body !== undefined ? { body } : {}) }); }
  catch (e) {
    capture(c.env, c.executionCtx, "$exception", s.user.email, { $exception_list: [{ type: "BridgeError", value: String(e).slice(0, 120), mechanism: { handled: true } }], path: normPath(url.pathname), method: c.req.method });
    return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, /릴레이 없음/.test(String(e)) ? { "x-retry-safe": "1" } : {});   // 보내지도 못한 요청 — 화면이 쓰기도 조용히 다시
  }
  if (c.req.method === "POST" && r.status < 400) REC.get(c.req.raw)?.cookies.push("bx_w=1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=20");   // 방금 씀 — 20초 스냅숏 건너뜀
  if (shadowRd && rd && !fr && !own) {   // 그림자: 304 대신 몸통을 받아 대조하고, 화면에는 보드처럼 같은 ETag 면 빈 304
    const bridged = r, inm = c.req.header("if-none-match"), bms = Date.now() - t0;
    c.executionCtx.waitUntil(ownerRead.shadow(c.env.DB, () => snap(c.env).get("cfg"), rd, bridged).then(d => {
      if (d?.diff) capture(c.env, c.executionCtx, "f7_shadow_diff", s.user.email, { route: rd.kind, group: rd.group, at: d.diff, n_bridge: d.n_bridge, n_d1: d.n_d1, ms_d1: d.ms });
      else if (d && Math.random() < 0.05) capture(c.env, c.executionCtx, "f7_shadow_ok", s.user.email, { route: rd.kind, group: rd.group, n_bridge: d.n_bridge, ms_d1: d.ms, ms_bridge: bms });   // 차이 0 이 이어지는지 · 빠르기(5% 표본)
    }).catch(e => capture(c.env, c.executionCtx, "f7_shadow_diff", s.user.email, { route: rd.kind, group: rd.group, at: "error " + String((e as Error)?.name || "") })));   // 오류 글은 안 실음(JSON 오류는 몸통 조각을 담음)
    if (r.status === 200 && inm && r.headers.etag === inm) { bridgeSeg(c.req.raw, Date.now() - t0, r.headers); return new Response(null, { status: 304, headers: { etag: inm, "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
  }
  if (!fr) bridgeSeg(c.req.raw, Date.now() - t0, r.headers);
  if (!fr && !own && c.req.method === "GET") filesShadow(c, url.pathname + url.search, headers, r, s.user.email);
  const out = new Headers();
  for (const h of PASS_RES) if (r.headers[h]) out.set(h, r.headers[h]);
  out.set("x-content-type-options", "nosniff");
  if (fr) fromR2(out);
  const canvasShell = !!shell && await isCanvas(c.env, chOf(c), shell[1]);
  if (/^\/(art|_blob)\//.test(url.pathname) && !canvasShell)
    out.set("content-security-policy", "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads");   // 다리 왕복(릴레이 · 보드 포함) — 느릴 때 어디서인지
  const unzip = () => { if (r.headers["content-encoding"] !== "gzip") return r.body as unknown as BodyInit; out.delete("content-encoding"); return new Response(r.body as unknown as BodyInit).body!.pipeThrough(new DecompressionStream("gzip")); };
  if (url.pathname === "/" && (r.headers["content-type"] || "").includes("text/html")) {
    if (!cookieOf(c, "bx_cc1")) { out.set("clear-site-data", '"cache"'); REC.get(c.req.raw)?.cookies.push("bx_cc1=1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000"); }
    out.set("content-security-policy", "frame-ancestors 'self'"); out.set("x-frame-options", "SAMEORIGIN");
    return boardShell(c, new Response(unzip(), { status: r.status, headers: out }), s.user.email, "", await ledger.f7On(c.env.DB, "write_queue"));
  }
  if (canvasShell && r.status === 200 && (r.headers["content-type"] || "").includes("text/html")) {
    const t = await artTok(c.env, shell![1], Date.now() + 2 * 3600_000);
    return new HTMLRewriter().on("head", { element: e => { e.prepend(artFetchShim(shell![1], t), { html: true }); } })
      .transform(new Response(unzip(), { status: r.status, headers: out }));
  }
  if ((r.status === 404 || r.status === 403) && docNav(c, url)) return c.redirect("/#nf", 302);
  return new Response(c.req.method === "HEAD" ? null : (r.body as unknown as BodyInit), { status: r.status, headers: out, ...(out.get("content-encoding") ? { encodeBody: "manual" as const } : {}) });
});

// server.py 의 /sw.js · /api/push/* 와 같은 답(push.py · server.py push_subscribe · push_test · push_ack)
async function pushRoute(c: Context<{ Bindings: Env }>, url: URL) {
  const p = url.pathname, pu = pusher(c.env);
  kickPush(c.env, c.executionCtx);
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    if (p === "/sw.js") return new Response(c.req.method === "HEAD" ? null : PU.SW, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" } });
    if (p === "/api/push/key") return c.json({ key: await pu.key() }, 200, { "cache-control": "no-store" });
    let d = p; try { d = decodeURIComponent(p); } catch {}
    const m = /^\/api\/push\/resolve\/([\w:.-]{1,80})$/.exec(d);   // 알림의 카드 → 지금 판(뒤에 Slack 카드로 바뀌었으면 그 카드)
    if (m) { const ts = await pushResolve(c.env.DB, m[1]); return c.json({ ts, loc: await cardLoc(c.env.DB, ts) }, 200, { "cache-control": "no-store" }); }
    return c.json({ error: "not found" }, 404);
  }
  const fn = ({ "/api/push/subscribe": 1, "/api/push/unsubscribe": 1, "/api/push/test": 1, "/api/push/ack": 1 } as Record<string, number>)[p];
  if (c.req.method !== "POST" || !fn) return c.json({ error: "not found" }, 404);
  if (c.req.header("x-hb") !== "1") return c.json({ ok: false, error: "forbidden" }, 403);   // 다른 사이트 폼이 보내는 것 막기(보드와 같은 문)
  const raw = new Uint8Array(await c.req.arrayBuffer());
  let b: Record<string, unknown>;
  try { b = raw.length > 20000 ? null! : JSON.parse(new TextDecoder().decode(raw) || "{}"); } catch { b = null!; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ ok: false, error: "bad json" }, 400);
  let r: [number, Record<string, unknown>];
  if (p === "/api/push/subscribe") {
    r = await pu.subscribe(b as never);
    const ep = String(((b.sub || {}) as { endpoint?: unknown }).endpoint ?? "");
    if (r[1].new) c.executionCtx.waitUntil(pu.trial({ endpoint: ep }, true).catch(() => null));   // 새로 켠 기기엔 바로 시험 알림 1건 — 켜졌는지 · 누르면 카드가 열리는지
  } else if (p === "/api/push/unsubscribe") r = await pu.unsubscribe(b);
  else if (p === "/api/push/test") r = await pu.trial(b);
  else r = await pu.ack(b);
  return c.json(r[1], r[0] as 200);
}

export default app;
