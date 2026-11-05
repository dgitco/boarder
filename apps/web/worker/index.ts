// Boarder API(Hono) — /api/* 만 Worker 가 받고, 나머지는 React 정적 자산(SPA)
import { Hono, type Context } from "hono";
import { z } from "zod";
import { METRICS_MAX_BYTES, putMetrics, listDevices, readCapped, tooSoon } from "./devices";
import * as devCard from "./device-card";
import * as connReq from "./connect-request";
import * as devSettings from "./device-settings";
import { onboarding } from "./member-onboarding";
import { legal } from "./legal";
import { createAuth, allowed, isOwner, member, otpSendOk, type Env as AuthEnv } from "./auth";
import * as W from "./who";
import { installPrompt, BOARDER_SKILL, boarderSkill, RULE_KEYS, memberOnboard, type Bot } from "./install";
import { BUNDLE_KEYS } from "./harness-bundles";
import { readPrefs, prefsOf, prefsPatch, savePrefs, PREF_DEF } from "./node-prefs";
import { cleanHide, cleanPins, cleanSide, readHide, readPins, readSide, saveHide, savePins, saveSide } from "./side-order";
import * as pc from "./person-custom";
import * as artView from "./art-view";
import * as agentFace from "./agent-face";
import { canBePrimary, primaryPick, PARK_H_LIM, type Item } from "./importer/group";
import { landingPage } from "./landing";
import { localTools } from "./local";
import { splitSender } from "./member-split-send";
import { addFeedback } from "./feedback";
export { BoardSnap } from "./board";
export { Bridge } from "./bridge";
export { Engine } from "./engine";
export { Search } from "./search";
export { Pusher } from "./push-do";
import { mountRoleEdit, toolError } from "./role-edit";
import { engineOf, chatToMain, approveDraft, deliverTo, ownerCfg, sysLine, RULES, engineSend, ownerWindows, harnessDevice, liveDevice, openedLastHour, OPEN_PER_HOUR, type Engine } from "./engine";
import shellJs from "./legacy/shell.js?raw";
import shellCss from "./legacy/shell.css?raw";
import installSh from "./install/install.sh?raw";
import installPs1 from "./install/install.ps1?raw";
import settingsJs from "./legacy/settings.js?raw";
import settingsCss from "./legacy/settings.css?raw";
import blobJs from "./legacy/blobatar.js?raw";
import botPickJs from "./legacy/botpick.js?raw";
import eaJs from "./legacy/ea.js?raw";
import eaCss from "./legacy/ea.css?raw";
import xJs from "./legacy/x.js?raw";
import xCss from "./legacy/x.css?raw";
import statusJs from "./legacy/status.js?raw";   // 상태 페이지(태스크 현황 · 기기 세션 현황) — 설정 › 기능에서 켠 사람만 사이드바 「피드」 밑에
import statusCss from "./legacy/status.css?raw";
import eaSecretJs from "./legacy/ea-secret.js?raw";
import { snippet, capture, phId, type PH } from "./posthog";
import { mcp } from "./mcp/server";
import { run as runTool, hasTool, addTools, onlyReads } from "./mcp/tools";
import { registry, view, dropCache, diff } from "./mcp/registry";
import { mountConnectors } from "./connectors/routes";
import { mountConnectLink } from "./connectors/connect-link";
import { mountApprovalLink } from "./approval-link";
import { mountTasks } from "./tasks/routes";
import { mountFeatures } from "./status-pages/routes";   // 설정 › 기능: 태스크 현황 · 기기 세션 현황 켜기/끄기(사람마다, 기본 꺼짐)
import { mountTaskBoard, sweepTaskBoard } from "./status-pages/taskboard";   // 태스크 현황(요청 · 요청 대화 · 말하기) — 기기가 올리고 켠 사람만 봄
import { mountDevBoard } from "./status-pages/devboard";
import { mountSales } from "./sales/routes";
import { runDigest, type Send as SalesSend } from "./sales/digest";
import { mountHooks } from "./connectors/hooks";
import * as sessions from "./connectors/sessions";
import { catalog } from "./connectors/store";
import { openSecret, sealSecret } from "./vault/secret";
import { envelopeOn, forgetFlags, openBlob, sealBlob, type VaultEnv } from "./vault/index";
import * as vmig from "./vault/migrate";
import { mountImport, onCardAnswered, regroup, setUnit } from "./importer/routes";
import { dropRef, mountTaskConvo } from "./task-convo";
import * as slackImport from "./slack-import";
import * as memberCanvas from "./member-canvas";
import { mountSlackConnector } from "./slack-connector";
import { mountSecrets, onCardAnswered as secretCardAnswered } from "./secrets";
import * as ledger from "./ledger";
import * as ownerWrite from "./owner-write";
import * as ledgerWrite from "./ledger-write";
import SCHEMA from "./ledger-schema";
import * as files from "./files";
import * as ownerRead from "./owner-read";
import * as OS from "./owner-state";
import * as memberBoard from "./member-board";
import * as memberVoice from "./member-voice";
import { boardHead, HEAD_RE, withHead } from "./board-head";
import * as memberInbox from "./member-inbox";
import * as nodeTodo from "./node-todo";
import * as memberFiles from "./member-files";
import { importedWindow, queueToImported } from "./member-imported";
import { ownWindow, primarySend, LOST_LINE } from "./primary-send";
import { seatsFromData } from "./role-seat";
import { orderFromData, placeWithin, panesOk, saveOrder } from "./node-order";
import { claimEndpoint, linePushOpen, releaseEndpoint, routeCard, routeLine, setWideRow, type PushCard, type PushLine } from "./member-push";
import * as emoji from "./emoji";
import * as memberSearch from "./member-search";
import { newMeter, meterEnv, meterProps, sampleOf } from "./perf";
import * as PU from "./push";
import { resolve as pushResolve, cardLoc } from "./push-do";
import { hosted } from "./hosted";   // 호스팅 전용(ee/) — 공개 판에선 빈 확장
addTools(hosted.tools);
import * as live from "./live";
import * as queue from "./queue";
import * as bxs from "./bxs";

type Env = AuthEnv & PH & { SNAP: DurableObjectNamespace<import("./board").BoardSnap>; BRIDGE: DurableObjectNamespace<import("./bridge").Bridge>; RELAY_TOKEN: string; LEDGER_TOKEN?: string; ADMIN_TOKEN?: string; ENGINE: DurableObjectNamespace<Engine>; RESULTS: R2Bucket; CF_VERSION_METADATA: WorkerVersionMetadata; CONNECTOR_KEY?: string; SEARCH: DurableObjectNamespace<import("./search").Search>; AI: Ai; VOYAGE_API_KEY?: string; OB_EXPORT_SIGN_KEY?: string; OB_EXPORT_URL?: string; PUSH: DurableObjectNamespace<import("./push-do").Pusher>; VAPID_PRIVATE?: string; SOURCE_URL?: string; FAULT_OK?: string };
const app = new Hono<{ Bindings: Env }>();
const KEYS = new Set(["data", "topics", "page", "cfg", "history", "emoji"]);
const bridge = (env: Env, ch = "owner") => env.BRIDGE.get(env.BRIDGE.idFromName(ch === "test" ? "test@wnam" : "owner@wnam"), { locationHint: "wnam" });
const boardCall = async (env: Env, ch: string, r: { method: string; path: string; headers: Record<string, string>; body?: Uint8Array }) => (hosted.exec && await hosted.exec.on(env.DB)) ? hosted.exec.call(env, ch, r) : bridge(env, ch).call(r);
// 에이전트 도구(받은편지함 · 감시 줄 · 웹훅 깨우기)도 같은 스위치로 — 실행기가 bridge.mjs 와 같은 명령 · 같은 인자 검사(relay-tools.mjs)
const boardTool = async (env: Env, ch: string, name: string, args: Record<string, unknown>, agent: string) => (hosted.exec && await hosted.exec.on(env.DB)) ? hosted.exec.tool(env, ch, name, args, agent) : bridge(env, ch).tool(name, args, agent);
const chOf = (c: Context<{ Bindings: Env }>) => /(?:^|;\s*)bx-ch=test(?:;|$)/.test(c.req.header("cookie") || "") ? "test" : "owner";
const snap = (env: Env) => env.SNAP.get(env.SNAP.idFromName(live.OWNER_SNAP), { locationHint: "apac" });
let verMemo = { at: 0, v: "" };
async function pageVer(env: Env) {
  if (Date.now() - verMemo.at < 60_000) return verMemo.v;
  verMemo.at = Date.now();
  verMemo.v = "";
  try { const pg = await snap(env).get("page"); if (pg && Date.now() - Math.max(pg.at, pg.checked || 0) < 15_000) verMemo.v = String(JSON.parse(pg.body).ver || "").slice(0, 40); } catch { /* 다음 판에 */ }
  return verMemo.v;
}
app.use("/api/data", async (c, next) => {
  await next();
  if (c.req.method !== "GET" || c.res.headers.has("X-HB-Ver")) return;
  const v = await pageVer(c.env); if (!v) return;
  try { c.res.headers.set("X-HB-Ver", v); } catch { const r = new Response(c.res.body, c.res); r.headers.set("X-HB-Ver", v); c.res = r; }   // 다리에서 받은 답은 머리가 잠겨 있음
});
const search = (env: Env) => env.SEARCH.get(env.SEARCH.idFromName("owner@wnam"), { locationHint: "wnam" });
const pusher = (env: Env) => env.PUSH.get(env.PUSH.idFromName("owner"), { locationHint: "apac" }) as unknown as import("./push-do").PushApi;
const memberPusher = (env: Env, me: string) => { const n = PU.memberName(me); return n ? env.PUSH.get(env.PUSH.idFromName(n), { locationHint: "apac" }) as unknown as import("./push-do").MemberPushApi : null; };
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
const REC = new WeakMap<Request, { seg: Record<string, number>; via?: string; who?: string; dev?: string; cookies: string[]; renew?: Renew; hit?: Record<string, number>; quiet?: boolean }>();
const hit = (req: Request, name: string, yes: boolean) => { const r = REC.get(req); if (r) (r.hit ||= {})[`cache_${name}`] = yes ? 1 : 0; };   // 캐시 맞음 1 · 빗나감 0 — PostHog boarder_request
const BRIDGE_SEG = new Set(["bridge", "hop", "relay", "board", "tool"]);
function seg(req: Request, name: string, ms: number) { const r = REC.get(req); if (r) { r.seg[name] = (r.seg[name] || 0) + Math.max(0, ms); if (BRIDGE_SEG.has(name)) r.via = "bridge"; } }
function who(req: Request, id: string) { const r = REC.get(req); if (r) r.who = id; }
function quiet(req: Request) { const r = REC.get(req); if (r) r.quiet = true; }
const QUIET_MCP = new Set(["boarder_search", "boarder_describe", "boarder_execute"]);
function bridgeSeg(req: Request, total: number, h: Record<string, string>) {
  const doMs = +h["x-do-ms"] || 0, board = +h["x-relay-board-ms"] || 0;
  if (!doMs) return seg(req, "bridge", total);
  seg(req, "hop", total - doMs); seg(req, "relay", doMs - board); seg(req, "board", board);
}
const normPath = (p: string) => p.replace(/\/\d{10}\.\d{6}/g, "/:ts").replace(/\/[0-9a-f]{32}(\.[a-z0-9]+)?/g, "/:hash").replace(/\/(?:%25|%)\d+/g, "/:pane")
  .replace(/\/[A-Za-z0-9_-]{16,}/g, "/:id").replace(/\/[^/]+\.dc\.html$/, "/:board.dc.html").replace(/\/[^/]+\.[A-Za-z0-9]{1,5}$/, "/:file").slice(0, 80);
app.use("*", async (c, next) => {
  const t0 = Date.now(), rec = { seg: {} as Record<string, number>, who: undefined as string | undefined, dev: undefined as string | undefined, cookies: [] as string[], quiet: undefined as boolean | undefined }, meter = newMeter();
  REC.set(c.req.raw, rec);
  c.env = meterEnv(c.env, meter);   // D1 · DO · R2 시간 · 횟수(perf.ts) — 재기만 함
  await next();
  // 미리 갈기(signedIn): D1 확인이 이미 끝났고 같은 사람이면 새 bx_s(안 끝났으면 기다리지 않음 — 다음 요청이 60초 캐시로 받음)
  const rn = (rec as { renew?: Renew }).renew;
  if (rn?.done && rn.done === rn.email) rec.cookies.push(await bxCookie(c, rn.email, rn.th));
  const lw = rec.who && /^[^@\s:%]+@[^@\s:%]+$/.test(rec.who) ? rec.who : rec.dev;
  if (lw && !["GET", "HEAD", "OPTIONS"].includes(c.req.method)) memberBoard.loadForget(lw);
  if (lw && !rec.quiet && !["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.res.status < 400 && !isOwner(c.env, lw) && !/^\/api\/(relay\/|device\/metrics|device\/taskboard|me\/taskboard|me\/devboard|me\/features$|draft$|cardcheck$|me\/tasks\/view$)/.test(c.req.path))   // 회원 초안 · 카드 체크는 저장 표가 없음(member-board 가 바로 ok). 상태 페이지 쓰기는 보드 화면 값을 안 바꿈(그 페이지가 스스로 다시 읽음)
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
  const rid = (c.req.header("x-request-id") || "").slice(0, 40);
  if (c.res.status >= 400 && url.pathname.startsWith("/api/")) console.log(JSON.stringify({ ev: "api_error", rid, path: normPath(url.pathname), method: c.req.method, status: c.res.status, ms: total, ...rec.seg }));   // Workers Logs(observability)
  if (!rec.who && c.res.status < 500) return;
  const np = normPath(url.pathname), sample = total > 5000 ? 1 : sampleOf(np, c.req.method, c.res.status);
  if (sample > 1 && Math.random() >= 1 / sample) return;
  capture(c.env, c.executionCtx, "boarder_request", rec.who || "anon", {
    path: np, method: c.req.method, status: c.res.status, total_ms: total, sample, ...(rid ? { rid } : {}),
    ...Object.fromEntries(Object.entries(rec.seg).map(([k, v]) => [`${k}_ms`, v])), ...meterProps(meter), ...(rec as { hit?: Record<string, number> }).hit,
    via: (rec as { via?: string }).via || "worker", colo: (c.req.raw as any).cf?.colo, entry: (c.req.header("cf-ray") || "").split("-")[1], country: (c.req.raw as any).cf?.country, $current_url: undefined,
  });
});
app.use("*", async (c, next) => {
  if ((queue.FAULT.d1 || queue.FAULT.d1after) && !/^\/api\/(admin\/fault|relay\/)/.test(c.req.path)) c.env = { ...c.env, DB: queue.FAULT.d1 ? queue.brokenDB(c.env.DB) : queue.lostDB(c.env.DB) };
  if (c.req.method !== "POST" || !(queue.QPATHS.has(c.req.path) || hosted.qpath?.(c.req.path)) || !(await ledger.f7On(c.env.DB, "write_queue"))) return next();
  const s = await signedIn(c); if (!s) return next();
  return queue.idem(c as never, s.user.email, next, ms => seg(c.req.raw, "claim", ms));
});
app.get("/api/arttok/:id", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  if (!isOwner(c.env, s.user.email)) return c.json({ error: "no" }, 403);
  const id = c.req.param("id");
  if (!/^[A-Za-z0-9]{16,40}$/.test(id) || !["canvas", "page"].includes(await artKind(c.env, chOf(c), id))) return c.json({ error: "not found" }, 404);
  return c.json({ t: await artTok(c.env, id, Date.now() + 2 * 3600_000) }, 200, { "cache-control": "no-store" });
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
// 이메일 코드 보내기는 주소마다 상한(auth.ts otpSendOk). better-auth 안의 보내기 함수에서 던진 오류는 삼켜져 200 이 되므로 여기서 429
app.post("/api/auth/email-otp/send-verification-otp", async (c, next) => {
  const b = await c.req.raw.clone().json().catch(() => null) as { email?: unknown } | null;
  const email = typeof b?.email === "string" ? b.email.trim().toLowerCase().slice(0, 320) : "";
  if (email && !(await otpSendOk(c.env.DB, email))) return c.json({ code: "TOO_MANY_REQUESTS", message: "too many codes for this address" }, 429, { "retry-after": "600" });
  await next();
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
    hosted.tick?.(c.env, p => c.executionCtx.waitUntil(p));
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
  const r = await OS.get(c.env.DB, c.req.query("k") || ""); return r ? c.json({ ...r, on: true }) : c.json({ error: "없음" }, 404);   // on: 끈 뒤엔 after-hook 이 파일을 안 덮음(실행기가 정본)
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
    customMetadata: { sha256: sha, name: (c.req.header("x-file-name") || "").slice(0, files.NAME_MAX), mtime: (c.req.header("x-mtime") || "").slice(0, 30) } });
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
  if ((c.req.header("if-none-match") || "").replace(/^W\//, "") === r.etag) return new Response(null, { status: 304, headers: h });
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
    const dt = await live.liveOf(c.env, me).tags().catch(() => null);
    return { ...(dt?.t.data ? { data: dt.t.data } : {}), chat: dt?.t.chat || "~0" } as { data: string; chat: string };
  });
  if (hosted.liveTags) Object.assign(o.t, await hosted.liveTags(c.env, me).catch(() => ({})));
  return c.json(o, 200, { "cache-control": "no-store" });
});

const SearchDoc = z.object({ id: z.string().min(3).max(300), kind: z.enum(["node", "card", "chat", "log", "art"]), title: z.string().max(2000), body: z.string().max(20000),
  node: z.string().max(300).nullish(), ch: z.string().max(40).nullish(), at: z.number(), meta: z.record(z.string(), z.unknown()).optional(), emb: z.boolean().optional(), ext: z.boolean().optional(), tags: z.array(z.string().max(60)).max(30).optional() });
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
  // 회원은 자기 D1 만(member-search.ts) — 주인 색인(DO)은 주인만. 회원 뜻 찾기(sem=1)는 같은 Workers AI 로 최근 글만(member-search.ts)
  const r = await memberSearch.route({ owner: isOwner(c.env, sb.user.email), me: sb.user.email, q, db: c.env.DB, sem: c.req.query("sem") === "1", ai: c.env.AI as unknown as memberSearch.Ai,
    ownerSearch: () => search(c.env).query(q, c.req.query("sem") === "1", c.req.query("dbg") === "1", c.req.query("engine") === "bge" ? "bge" : c.req.query("engine") === "voyage" ? "voyage" : "mix") });   // dbg = 노드 점수 나눔(주인만, 순위 고칠 때)
  seg(c.req.raw, "search", Date.now() - t0);
  return c.json({ ...r, ms: { ...r.ms, worker: Date.now() - t0 } }, 200, { "cache-control": "private, no-store" });
});

hosted.mount?.(app, { me: async c => (await signedIn(c as never))?.user.email ?? null, sameSite: c => sameSite(c as never) });
// 릴레이의 다리(WebSocket) — 토큰 확인 뒤 Bridge DO 로
app.get("/api/relay/ws", async c => {
  const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!c.env.RELAY_TOKEN || !sameToken(tok, c.env.RELAY_TOKEN)) return c.json({ error: "no" }, 403);
  return bridge(c.env, new URL(c.req.url).searchParams.get("ch") || "owner").fetch(c.req.raw);
});
const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");
const tokCache = new Map<string, { pane: string; win: string; host: string; tools: string; owner: string; device_id: string | null; hash: string; at: number }>();
const flagAt = new Map<string, number>();
async function bound(env: Env, tok: string) {
  if (!/^bxa_[A-Za-z0-9_-]{30,80}$/.test(tok)) return null;
  const h = await sha(tok), hit = tokCache.get(h);
  if (hit && Date.now() - hit.at < 10_000) return hit;
  const r = await env.DB.prepare("SELECT t.pane, t.win, t.host, t.tools, t.owner, t.device_id FROM agent_token t LEFT JOIN device d ON d.id = t.device_id WHERE t.hash = ? AND t.revoked_at IS NULL AND (t.device_id IS NULL OR d.revoked_at IS NULL)").bind(h).first<{ pane: string; win: string; host: string; tools: string; owner: string; device_id: string | null }>();
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
      const id = crypto.randomUUID().replace(/-/g, ""), k = `mcp-results/${owner}/${id}.txt`;
      // 봉함 켜짐(f7_flag envelope): 그 사람 DEK(주인 '') · AAD = key, 메타 vault=1 로 표시 — 꺼짐이면 글 그대로 · 메타도 그대로
      const body = await sealBlob(c.env as unknown as VaultEnv, who.owner || "", k, text);
      await c.env.RESULTS.put(k, body, { httpMetadata: { contentType: "text/plain; charset=utf-8" }, customMetadata: body === text ? { agent } : { agent, vault: "1" } });
      return `${c.env.PUBLIC_URL}/api/agent/result/${id}`;
    },
    owner, person: who.owner || "",   // person = 봉함 DEK 주인(주인 '')
    ...(who.owner ? { local: localTools(c.env.DB, who.owner, who.win || who.pane, c.env.PUBLIC_URL, who.pane, card => c.executionCtx.waitUntil(memberCardPush(c.env, who.owner!, card)), splitSender(c.env, who.owner), line => c.executionCtx.waitUntil(memberLinePush(c.env, who.owner!, line)), c.env, who.device_id) } : {}),
    host: who.host, win: who.win || who.pane,
    conn: { env: c.env, owner: who.owner || "", scope: who.tools ?? "*", card: who.owner ? (card: { id: string; question: string }) => c.executionCtx.waitUntil(memberCardPush(c.env, who.owner!, card)) : undefined, catalog: (() => { let p: ReturnType<typeof catalog> | undefined; return () => (p ??= catalog(c.env, who.owner || "", w => c.executionCtx.waitUntil(w))); })() },
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
  const k = `mcp-results/${ctx.owner}/${id}.txt`, o = await c.env.RESULTS.get(k); if (!o) return c.json({ error: "없음" }, 404);
  const body = o.customMetadata?.vault === "1" ? await openBlob(c.env as unknown as VaultEnv, ctx.person, k, await o.arrayBuffer()) : o.body;   // 봉한 것만 풂 — 옛 것은 지금처럼 흘려보냄
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
});
app.get("/f/:id{[0-9a-f]{32}}", c => memberFiles.signedGet(c as never, c.req.param("id")));
app.route("/", legal);   // 개인정보 처리방침 · 약관(legal.ts) — 구글 동의 화면 링크
app.post("/mcp", async c => { const ctx = await agentCtx(c); if (ctx === "mismatch") return c.json({ error: "신원 불일치" }, 403); if (!ctx) return c.json({ error: "토큰" }, 401);
  const m = await c.req.raw.clone().json().catch(() => null) as { method?: string; params?: { name?: unknown } } | null, tn = String(m?.params?.name || "");
  if (m && !Array.isArray(m) && (m.method !== "tools/call" || onlyReads(tn) || QUIET_MCP.has(tn))) quiet(c.req.raw);
  return mcp(c.req.raw, ctx); });
app.get("/mcp", c => new Response(null, { status: 405, headers: { allow: "POST" } }));
app.post("/api/agent/:tool", async c => {
  const ctx = await agentCtx(c); if (ctx === "mismatch") return c.json({ error: "신원 불일치" }, 403); if (!ctx) return c.json({ error: "토큰" }, 401);
  const name = c.req.param("tool"); if (!hasTool(name)) return c.json({ error: "없는 도구" }, 404);
  if (onlyReads(name)) quiet(c.req.raw);
  try { return c.json(await runTool(ctx, name, await c.req.json().catch(() => ({})))); }
  catch (e) { const [body, status] = toolError(e); return c.json(body, status); }   // 역할 고치기 허락 없음은 403 not_allowed + 안내(role-edit.ts)
});

const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/[+/=]/g, m => ({ "+": "-", "/": "_", "=": "" } as Record<string, string>)[m]);
const rand = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const UC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 헷갈리는 0 · O · 1 · I 뺌
const userCode = () => { const s = [...crypto.getRandomValues(new Uint8Array(8))].map(x => UC[x % UC.length]).join(""); return `${s.slice(0, 4)}-${s.slice(4)}`; };
const CTRL_ALL = /[\x00-\x1f\x7f-\x9f]/g;
const clean = (v: unknown, n: number) => String(v ?? "").replace(CTRL_ALL, "").trim().slice(0, n);
const docNav = (c: { req: { method: string; header(k: string): string | undefined } }, url: URL) =>
  c.req.method === "GET" && c.req.header("sec-fetch-dest") === "document" && !url.pathname.startsWith("/api/") && url.pathname !== "/";
export const APP_PATH = /^\/(?:nodes(?:\/[^/]+)?|timeline|canvas(?:\/[A-Za-z0-9]{16,40})?|unread|saved|drafts|inbox|nf|chat\/[^/]+(?:\/\d{10}\.\d{6})?|w\/[^/]+|settings(?:\/[^/]+){0,2}|task-status(?:\/[\w.-]{1,40})?|device-sessions|agents(?:\/(?:channels|a2a))?)\/?$/;
const NOFRAME = { "cache-control": "no-store", "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" };
const sameSite = (c: Context<{ Bindings: Env }>) => c.req.header("x-hb") === "1" && ["same-origin", "none", undefined].includes(c.req.header("sec-fetch-site"));
async function deviceOf(c: Context<{ Bindings: Env }>, opt: { watch?: boolean; harness?: boolean; ownercli?: boolean } = {}) {
  const tok = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!/^bxd_[A-Za-z0-9_-]{30,80}$/.test(tok)) return null;
  const d = await c.env.DB.prepare("SELECT id, owner, name, tools, scope FROM device WHERE token_hash = ? AND revoked_at IS NULL").bind(await sha(tok)).first<{ id: string; owner: string; name: string; tools: string; scope: string }>();
  if (!d || (d.scope !== "full" && !(opt.watch && d.scope === "watch") && !(opt.harness && d.scope === "harness") && !(opt.ownercli && d.scope === "ownercli"))) return null;
  const rec = REC.get(c.req.raw); if (rec) rec.dev = d.owner;
  return d;
}
async function cliDevice(c: Context<{ Bindings: Env }>) {
  const d = await deviceOf(c, { ownercli: true }); if (!d) return null;
  if (isOwner(c.env, d.owner)) return d.scope === "ownercli" ? d : null;
  return d.scope === "full" && await member(c.env, d.owner) ? d : null;
}
// 승인 신청만은 주인 감시 기기(scope watch)도 부를 수 있음 — 단 행동 ownercli.enable 하나(approval-link.ts 가 가름)
async function cliDeviceOrOwnerWatch(c: Context<{ Bindings: Env }>) {
  const d = await cliDevice(c); if (d) return d;
  const w = await deviceOf(c, { watch: true }); return w && w.scope === "watch" && isOwner(c.env, w.owner) ? w : null;
}
// 설정 · 커넥터 · 비밀이 쓰는 줄 열쇠: 주인 = "" , 회원 = 메일(커넥터 who() 와 같음). 기기 목록은 주인 메일 넷 모두
const cliKey = (env: Env, email: string) => W.dataKey(env, email);
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
  const rules = isOwner(c.env, s.user.email) ? null : (await readPrefs(c.env.DB, s.user.email.toLowerCase()).catch(() => null))?.rules;
  return c.text(installPrompt(c.env.PUBLIC_URL, rules), 200, { "cache-control": "no-store" });
});
// 스킬: 토큰 없이도 받음(옛 CLI · 다 켠 기본). 기기 토큰이 오면(boarder enable report) 그 회원이 켠 규칙 묶음만
app.get("/api/install/skill", async c => {
  const d = c.req.header("authorization") ? await deviceOf(c).catch(() => null) : null;
  const rules = d && !isOwner(c.env, d.owner) ? (await readPrefs(c.env.DB, d.owner).catch(() => null))?.rules : null;
  return c.body(rules ? boarderSkill(rules) : BOARDER_SKILL, 200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" });
});
app.post("/api/device/code", async c => {
  const b = await c.req.json<{ name?: string; tools?: string[]; callback?: string; state?: string; code_challenge?: string; email?: string }>().catch(() => ({} as { name?: string; tools?: string[]; callback?: string; state?: string; code_challenge?: string; email?: string }));
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
    c.env.DB.prepare("UPDATE board_card SET state = 'closed', done = '만료' WHERE state = 'open' AND id IN (SELECT card_id FROM device_code WHERE expires_at < ? AND card_id IS NOT NULL)").bind(now - 3600_000),
    c.env.DB.prepare("DELETE FROM device_code WHERE expires_at < ?").bind(now - 3600_000),
    c.env.DB.prepare("INSERT INTO device_code(code_hash, user_code, name, tools, created_at, expires_at, req_ip, req_country, callback, cb_state, challenge) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(await sha(dc), uc, clean(b.name, 80), tools, now, now + 600_000, ip, country, cb?.callback ?? null, cb?.state ?? null, cb?.code_challenge ?? null),
  ]);
  // 온보딩 2층: 메일을 주면(코드 입력 길만) 그 회원 보드에 허용 카드 — 회원인지 · 카드를 세웠는지는 답에 안 나옴(늘 board: "asked")
  const em = clean(b.email, 200).toLowerCase();
  if (em && !cb && !isOwner(c.env, em)) c.executionCtx.waitUntil((async () => {
    const card = await devCard.askOnBoard(c.env, { userCode: uc, email: em, isMember: await member(c.env, em), name: clean(b.name, 80), country, now });
    if (card) await memberCardPush(c.env, em, { id: card.id, question: `새 기기 「${card.name}」 허용?`, secret: true });   // 사람이 방금 기기에서 시작한 허용(코드 만료) — 늘 보냄
  })().catch(e => console.error("기기 카드", String(e).slice(0, 200))));
  return c.json({ device_code: dc, user_code: uc, verify_url: `${c.env.PUBLIC_URL}/device?code=${uc}`, expires_in: 600, interval: 3, mode: cb ? "local" : "code", ...(em && !cb ? { board: "asked" } : {}) });
});
app.post("/api/device/approve-by-device", async c => {
  const d = await deviceOf(c); if (!d || isOwner(c.env, d.owner) || !(await member(c.env, d.owner))) return c.json({ error: "기기 토큰" }, 401);
  const b = await c.req.json<{ user_code?: string; allow?: boolean }>().catch(() => ({} as { user_code?: string; allow?: boolean }));
  const r = await devCard.approveByDevice(c.env, d, String(b.user_code || ""), b.allow !== false);
  if ("error" in r) return r.error === "person" ? c.json({ error: "person", verify_url: `${c.env.PUBLIC_URL}/device?code=${clean(b.user_code, 9).toUpperCase()}` }, 403) : c.json({ error: r.error }, r.error === "unknown" ? 404 : r.error === "expired" ? 410 : 409);
  await c.env.DB.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").bind(d.owner.toLowerCase(), "보더", "progress", `기기 「${d.name}」 에서 새 기기 「${r.name}」 을 ${b.allow !== false ? "허용" : "거절"}했어요`, Date.now()).run().catch(() => {});
  return c.json({ ok: true, name: r.name });
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
  const [u] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE device_code SET state = 'issued', device_id = ? WHERE code_hash = ? AND state = 'approved'").bind(id, h),
    c.env.DB.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) SELECT ?,?,?,?,?,?,?,? FROM device_code WHERE code_hash = ? AND device_id = ? AND state = 'issued'").bind(id, r.owner, r.name, r.tools, await sha(tok), now, now, scope, h, id),
  ]);
  if (!u.meta.changes) return c.json({ error: "used" }, 400);
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
app.get("/api/device/lookup-by-device", async c => {   // boarder device approve 가 허용 전에 보여 줄 것(이름 · 곳 · 같은 망인지)
  const d = await deviceOf(c); if (!d || isOwner(c.env, d.owner) || !(await member(c.env, d.owner))) return c.json({ error: "기기 토큰" }, 401);
  const r = await c.env.DB.prepare("SELECT name, tools, expires_at, state, created_at, req_ip, req_country, callback FROM device_code WHERE user_code = ?").bind(clean(c.req.query("code"), 9).toUpperCase()).first<{ name: string; tools: string; expires_at: number; state: string; created_at: number; req_ip: string; req_country: string; callback: string | null }>();
  if (!r) return c.json({ error: "unknown" }, 404);
  if (r.state !== "pending") return c.json({ error: "done" }, 409);
  if (r.expires_at < Date.now()) return c.json({ error: "expired" }, 410);
  return c.json({ name: r.name, tools: r.tools, at: r.created_at, country: r.req_country, same: !!r.req_ip && r.req_ip === (c.req.header("cf-connecting-ip") || ""), mode: r.callback ? "local" : "code" });
});
app.post("/api/device/approve", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const b = await c.req.json<{ user_code?: string; allow?: boolean }>().catch(() => ({} as { user_code?: string; allow?: boolean }));
  const uc = clean(b.user_code, 9).toUpperCase(), now = Date.now();
  const grant = b.allow ? rand(32) : null;
  const u = await c.env.DB.prepare("UPDATE device_code SET state = ?, owner = ?, grant_hash = ?, approved_by = 'browser' WHERE user_code = ? AND state = 'pending' AND expires_at > ?").bind(b.allow ? "approved" : "denied", s.user.email.toLowerCase(), grant ? await sha(grant) : null, uc, now).run();
  if (u.meta.changes) {
    await c.env.DB.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE id = (SELECT card_id FROM device_code WHERE user_code = ?) AND owner = ? AND state = 'open'").bind(b.allow ? "브라우저에서 허용함" : "브라우저에서 거절함", uc, s.user.email.toLowerCase()).run().catch(() => {});
    const r = await c.env.DB.prepare("SELECT callback, cb_state FROM device_code WHERE user_code = ?").bind(uc).first<{ callback: string | null; cb_state: string | null }>();
    // 로컬 콜백 길: 브라우저가 그 기기의 127.0.0.1 로 grant 를 넘김(거절도 알려 CLI 가 바로 멈춤)
    if (r?.callback) return c.json({ ok: true, redirect: `${r.callback}?state=${encodeURIComponent(r.cb_state || "")}&${grant ? `code=${grant}` : "error=denied"}` });
    return c.json({ ok: true });
  }
  const r = await c.env.DB.prepare("SELECT state, expires_at, owner, callback, cb_state FROM device_code WHERE user_code = ?").bind(uc).first<{ state: string; expires_at: number; owner: string | null; callback: string | null; cb_state: string | null }>();
  if (r && r.owner === s.user.email.toLowerCase() && r.expires_at > now && r.state === (b.allow ? "approved" : "denied")) {
    if (!r.callback) return c.json({ ok: true });
    if (!b.allow) return c.json({ ok: true, redirect: `${r.callback}?state=${encodeURIComponent(r.cb_state || "")}&error=denied` });
    const g = rand(32);
    const u2 = await c.env.DB.prepare("UPDATE device_code SET grant_hash = ? WHERE user_code = ? AND state = 'approved' AND owner = ?").bind(await sha(g), uc, r.owner).run();
    if (u2.meta.changes) return c.json({ ok: true, redirect: `${r.callback}?state=${encodeURIComponent(r.cb_state || "")}&code=${g}` });
  }
  return c.json({ error: !r ? "unknown" : r.state !== "pending" ? "done" : "expired" }, 400);
});
app.get("/api/device/me", async c => {
  const d = await deviceOf(c, { watch: true, harness: true, ownercli: true }); if (!d) return c.json({ error: "기기 토큰" }, 401);   // 데몬이 폐기 확인에 씀(ownercli 로 올린 주인 기기의 감시 데몬도 계속 돎)(401 이면 끝내고 안 뜸)
  return c.json({ email: d.owner, owner: isOwner(c.env, d.owner), scope: d.scope, device: { id: d.id, name: d.name, tools: d.tools }, server: c.env.PUBLIC_URL });
});
app.post("/api/device/metrics", async c => {
  const d = await deviceOf(c, { watch: true, ownercli: true }); if (!d) return c.json({ error: "기기 토큰" }, 401);
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
app.post("/api/device/voice", async c => {
  const d = await deviceOf(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
  if (isOwner(c.env, d.owner) || !(await member(c.env, d.owner))) return c.json({ error: "기기 토큰" }, 401);
  const len = +(c.req.header("content-length") || 0); if (len > memberVoice.VOICE_BODY_MAX) return c.json({ error: "too big" }, 413);
  const buf = await readCapped(c.req.raw.body, memberVoice.VOICE_BODY_MAX); if (!buf) return c.json({ error: "too big" }, 413);
  let b: Record<string, unknown> | null = null; try { b = JSON.parse(new TextDecoder().decode(buf)); } catch { return c.json({ error: "json" }, 400); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ error: "json" }, 400);
  if (!(await memberVoice.voiceBudgetOk(c.env.DB, d.id, String(b.op || "")))) return c.json({ ok: false, text: memberVoice.VOICE_TOO_MANY }, 429, { "retry-after": "60" });
  const me = d.owner.toLowerCase(), mainName = (await memberBot(c.env, me).catch(() => null))?.name || "Primary";
  const primary = async (who: string, text: string) => await primarySend(c.env, who, text);
  try { const [st, o] = await memberVoice.deviceOp(c.env as never, me, b, { primary }, mainName); return c.json(o, st as 200); }
  catch (e) { console.error("통화 기기 op", e); return c.json({ ok: false, text: "일시적인 오류가 발생했어요" }, 503); }
});
const todoOwner = (env: Env, email: string) => W.canonKey(env, email);
const todoBump = (c: Context<{ Bindings: Env }>, who: string) => { quiet(c.req.raw); c.executionCtx.waitUntil(live.bump(c.env, who, { todo: "~" + Date.now() })); };
async function todoReply(c: Context<{ Bindings: Env }>, email: string, b: unknown, device: boolean) {
  const me = todoOwner(c.env, email), write = !!b && typeof b === "object" && (b as { op?: unknown }).op !== "list";
  try {
    const [st, o] = await nodeTodo.op(c.env.DB, me, b, { member: !isOwner(c.env, email), device });
    if (st === 200 && write) todoBump(c, me); else quiet(c.req.raw);
    return c.json(o, st as 200, { "cache-control": "no-store" });
  } catch (e) { console.error("할 일", e); return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503); }
}
app.get("/api/me/art-views", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  return c.json({ views: await artView.list(c.env.DB, todoOwner(c.env, s.user.email), +(c.req.query("since") || 0)) }, 200, { "cache-control": "no-store" });
});
app.post("/api/device/art-views", async c => {
  const d = await deviceOf(c, { harness: true }); if (!d) return c.json({ ok: false, error: "기기 토큰" }, 401);
  if (!(await member(c.env, d.owner))) return c.json({ ok: false, error: "기기 토큰" }, 401);
  const b = Object(await c.req.json().catch(() => ({}))) as { since?: unknown };
  return c.json({ ok: true, views: await artView.list(c.env.DB, todoOwner(c.env, d.owner), +(b.since as number) || 0) });
});
app.post("/api/device/todos", async c => {
  const d = await deviceOf(c, { harness: true }); if (!d) return c.json({ ok: false, error: "기기 토큰" }, 401);
  if (!(await member(c.env, d.owner))) return c.json({ ok: false, error: "기기 토큰" }, 401);
  if (+(c.req.header("content-length") || 0) > 256_000) return c.json({ ok: false, error: "너무 커요" }, 413);
  return todoReply(c, d.owner, await c.req.json().catch(() => null), true);
});
app.get("/api/todos", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const me = todoOwner(c.env, s.user.email), raw = c.req.query("node");
  try {
    const node = await nodeTodo.resolveNode(c.env.DB, me, raw, !isOwner(c.env, s.user.email));
    const [todos, n] = await Promise.all([nodeTodo.list(c.env.DB, me, node, { all: c.req.query("all") === "1" }), nodeTodo.counts(c.env.DB, me, node)]);
    return c.json({ ok: true, node, todos, ...n }, 200, { "cache-control": "no-store" });
  } catch (e) {
    if (e instanceof nodeTodo.TodoError) return c.json({ ok: false, error: e.message }, e.status as 400);
    console.error("할 일 읽기", e); return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503);
  }
});
app.post("/api/todos", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  return todoReply(c, s.user.email, await c.req.json().catch(() => null), false);
});
// 주인이 아닌 사람의 보드(첫 화면이 4초마다 읽음)
app.get("/api/me/board", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const me = s.user.email.toLowerCase();
  const [dv, wn, lg, cd] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT d.id, d.name, d.tools, d.created_at, d.last_at, m.at metrics_at, m.data metrics FROM device d LEFT JOIN device_metric m ON m.device_id = d.id WHERE d.owner = ? AND d.revoked_at IS NULL ORDER BY d.created_at DESC").bind(me),
    c.env.DB.prepare("SELECT t.device_id, t.win FROM agent_token t JOIN device d ON d.id = t.device_id WHERE d.owner = ? AND d.revoked_at IS NULL AND t.revoked_at IS NULL ORDER BY t.created_at DESC").bind(me),
    c.env.DB.prepare(`SELECT id, win, kind, text, thread, at FROM board_log WHERE owner = ? AND (thread IS NULL OR (thread != 'primary' AND thread NOT LIKE 'p:%')) ${memberBoard.NOT_CHAT} ORDER BY at DESC LIMIT 100`).bind(me),   // p:<ts> = Primary 글 스레드 답 · 「세션」 칸 대화 줄은 그 대화 화면에만
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
// 보낸 칸만 D1 안에서 합침(json_patch) — 화면 길(/api/me/nodeset)과 기기 CLI 길(device-settings.ts)이 같이 씀
async function saveNodeVals(env: Env, me: string, raw: unknown) {
  const patch = nodeVals(raw, {});
  const row = await env.DB.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET data = json_patch(CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END, excluded.data), updated_at = excluded.updated_at RETURNING data")
    .bind(me, JSON.stringify(patch), Date.now()).first<{ data: string }>();
  try { return nodeVals(JSON.parse(row?.data || "{}")); } catch { return nodeVals(patch); }
}
app.get("/api/me/nodeset", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  if (isOwner(c.env, s.user.email)) {
    const r = await toBoard(c, "GET", "/api/nodeset");
    if (r.status !== 200 || chOf(c) !== "owner") return r;
    const v = await OS.nodeSettings(c.env.DB).catch(() => null); if (!v) return r;
    const j = await r.json().catch(() => null) as Record<string, unknown> | null; if (!j) return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503);
    return c.json({ ...j, values: v }, 200, { "cache-control": "no-store" });
  }
  const me = s.user.email.toLowerCase();
  const [rawSet, arch, iw, em, dv] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me),
    c.env.DB.prepare("SELECT n.id, n.name, n.why, n.archived_at, EXISTS(SELECT 1 FROM mnode_item m JOIN imp_item i ON i.owner = m.owner AND i.key = m.item WHERE m.owner = n.owner AND m.node = n.id AND i.gone_at IS NULL) open FROM mnode n WHERE n.owner = ? AND n.archived_at IS NOT NULL ORDER BY n.archived_at DESC LIMIT 300").bind(me),
    c.env.DB.prepare("SELECT i.key, i.kind, i.engine, i.title, i.cwd, i.state, i.state_at, i.seen_at, i.win, i.session, i.handle, i.gone_at, d.name device FROM imp_item i JOIN device d ON d.id = i.device_id WHERE i.owner = ? AND i.kind = 'window' AND i.gone_at IS NULL AND d.revoked_at IS NULL ORDER BY i.seen_at DESC LIMIT 200").bind(me),
    c.env.DB.prepare("SELECT 1 FROM engine_window w JOIN device d ON d.id = w.device_id WHERE w.owner = ? AND w.kind = 'main' AND w.state NOT IN ('closed','failed','gone') AND d.revoked_at IS NULL LIMIT 1").bind(me),
    c.env.DB.prepare("SELECT id, name, engine, engine_at FROM device WHERE owner = ? AND revoked_at IS NULL AND scope = 'full' ORDER BY engine_at DESC LIMIT 20").bind(me),
  ]);
  const data = (rawSet.results[0] as { data?: string } | undefined)?.data;
  const unit = (() => { try { return (JSON.parse(data || "{}") as { unit?: string }).unit || null; } catch { return null; } })();
  const archive = (arch.results as { id: string; name: string; why: string | null; archived_at: number; open: number }[]).map(n => ({ id: n.id, name: n.name, at: n.archived_at / 1000, msg: n.why || "", reopen: !!n.open && !!unit }));
  const prefs = prefsOf(data), wins = (iw.results as (Item & { device: string })[]).filter(canBePrimary);
  const cur = primaryPick(wins, prefs.primary_item, em.results.length > 0).primary;   // 지금 메인 봇인 창(없으면 보더 메인 봇)
  const engines = (dv.results as { id: string; name: string; engine: string | null; engine_at: number | null }[]).map(d => {
    const e = (() => { try { return d.engine ? JSON.parse(d.engine) as { default?: string | null; engines?: Record<string, unknown> } : null; } catch { return null; } })();
    return { id: d.id, name: d.name, online: Date.now() - (d.engine_at || 0) < 120_000, default: e?.default ?? null, engines: e?.engines ? Object.keys(e.engines) : [], known: !!e };
  });
  return c.json({ values: await memberNodeVals(c.env, me), defaults: NODE_DEF, limits: NODE_LIM, archive, unit,
    prefs, pref_defaults: PREF_DEF, park_limits: PARK_H_LIM, rule_keys: RULE_KEYS, bundle_keys: BUNDLE_KEYS,
    windows: wins.map(w => ({ key: w.key, title: w.title || w.win || w.key, engine: w.engine, device: w.device, state: w.state || "" })), primary_now: cur?.key ?? null, engines,
    role_seats: seatsFromData(data).filter(x => !x.primary).length }, 200, { "cache-control": "no-store" });
});
app.post("/api/me/nodeset", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const b = await c.req.json<{ values?: unknown; unit?: string; prefs?: unknown }>().catch(() => ({} as { values?: unknown; unit?: string; prefs?: unknown }));
  if (!isOwner(c.env, s.user.email) && (b.unit === "goal" || b.unit === "agent")) {   // 채널 묶는 단위 — 회원만(주인은 노드 = 채널 그대로)
    const me = s.user.email.toLowerCase();
    await setUnit(c.env as never, me, b.unit, "me"); await regroup(c.env as never, me);
    return c.json({ ok: true, unit: b.unit });
  }
  if (!isOwner(c.env, s.user.email) && b.prefs !== undefined) {
    const me = s.user.email.toLowerCase(), patch = prefsPatch(b.prefs);
    if (!patch) return c.json({ ok: false, error: "값" }, 400);
    await savePrefs(c.env.DB, me, patch);
    if (patch.primary_item !== undefined || patch.park_on !== undefined || patch.park_h !== undefined || patch.task_channels !== undefined || patch.task_repo !== undefined) await regroup(c.env as never, me);
    return c.json({ ok: true, prefs: await readPrefs(c.env.DB, me) });
  }
  if (!b.values || typeof b.values !== "object") return c.json({ ok: false, error: "값" }, 400);
  if (isOwner(c.env, s.user.email)) {
    if (chOf(c) === "owner") {
      const r = await OS.nodeSet(c.env.DB, { values: b.values }).catch(() => null);
      return r ? c.json(r[1], r[0] as 200) : c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, { "x-retry-safe": "1" });
    }
    return toBoard(c, "POST", "/api/nodeset", { values: b.values });   // 시험 통로(bx-ch=test)만 — 별도 서버 파일
  }
  const me = s.user.email.toLowerCase(), patch = nodeVals(b.values, {});
  const row = await c.env.DB.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET data = json_patch(CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END, excluded.data), updated_at = excluded.updated_at RETURNING data")
    .bind(me, JSON.stringify(patch), Date.now()).first<{ data: string }>();
  let values = nodeVals(patch); try { values = nodeVals(JSON.parse(row?.data || "{}")); } catch {}
  return c.json({ ok: true, values });
});
app.post("/api/me/nodereopen", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  if (!isOwner(c.env, s.user.email)) return c.json({ ok: false, error: "보관함에 없는 노드예요" }, 404);
  const b = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  return toBoard(c, "POST", "/api/nodereopen", { name: String(b.name || "").slice(0, 80) });
});
const ownerMails = (env: Env, email: string) => { const me = email.toLowerCase(); return isOwner(env, me) ? env.ALLOW_EMAILS.split(",").map(x => x.trim().toLowerCase()).filter(Boolean) : [me]; };
app.get("/api/me/devices", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  return c.json({ devices: await listDevices(c.env.DB, ownerMails(c.env, s.user.email)) }, 200, { "cache-control": "no-store" });
});
app.post("/api/me/cards/:id/answer", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const me = s.user.email.toLowerCase(), id = c.req.param("id"), { choice: ch, free, rid: rid0 } = await c.req.json<{ choice?: string; free?: boolean; rid?: string }>().catch(() => ({} as { choice?: string; free?: boolean; rid?: string }));
  if (c.req.header("authorization") !== undefined || c.req.header("x-boarder-device") !== undefined) {
    const secret = await c.env.DB.prepare("SELECT 1 FROM secret_request WHERE card_id = ? AND owner = ?").bind(id, me).first();
    if (secret || await devCard.isDeviceCard(c.env, me, id) || await connReq.isConnectCard(c.env, me, id) || await devSettings.isSettingsCard(c.env, me, id)) return c.json({ error: "로그인" }, 401);   // 새 기기 · 커넥터 · 기기 설정 허락 카드도 사람만
  }
  const rid = queue.ridOfBody({ rid: rid0 });
  let choice = "";
  try {
  const r = await c.env.DB.prepare("SELECT choices FROM board_card WHERE id = ? AND owner = ? AND state = 'open'").bind(id, me).first<{ choices: string }>();
  if (!r) { if (!rid || !(await queue.ridSeen(c.env.DB, rid))) return c.json({ error: "없는 카드" }, 404); if (await queue.sentSeen(c.env.DB, rid)) return c.json({ ok: true, already: true }); }
  else {
  choice = String(ch ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " ").trim().slice(0, 2000);
  const freeOk = !!free && !!choice && !(await c.env.DB.prepare("SELECT 1 FROM imp_proposal WHERE card_id = ? AND owner = ?").bind(id, me).first());
  if (!(JSON.parse(r.choices) as string[]).includes(choice) && !freeOk) return c.json({ error: "없는 선택지" }, 400);
  const upd = c.env.DB.prepare("UPDATE board_card SET state = 'answered', answer = ?, answered_at = ? WHERE id = ? AND owner = ? AND state = 'open'").bind(String(choice), Date.now(), id, me);
  let won = false;
  try { won = Number((await c.env.DB.batch(rid ? [upd, c.env.DB.prepare("INSERT INTO f7_rid(rid, at) SELECT ?, ? WHERE changes() > 0").bind(rid, Date.now())] : [upd]))[0]?.meta?.changes || 0) > 0; }
  catch (e) { if (!queue.ridDup(e)) throw e; }
  if (!won) {
    if (!rid || !(await queue.ridSeen(c.env.DB, rid))) return c.json({ error: "이미 답한 결정이에요" }, 400);   // 다른 답이 먼저 — 확정 실패(409 면 화면이 보낸 것으로 봄)
    if (await queue.sentSeen(c.env.DB, rid)) return c.json({ ok: true, already: true });   // 같은 rid 로 이미 답함 — 넘기기가 빠졌으면 아래로
  }
  }
  } catch (e) { if (rid) return queue.retrySafe(c); throw e; }
  // 보드 글 머리 줄(board-head.ts): 「[보드 · <채널> · 카드 <id>]」 — 창이 답을 그 카드 스레드로(boarder say <카드>)
  const head = await cardHead(c.env, me, id);
  await onCardAnswered(c.env as never, me, id, head).catch(e => console.error("들여오기 카드 답", e));
  await secretCardAnswered(c.env as never, me, id).catch(e => console.error("비밀 요청 카드 답", String(e).slice(0, 200)));
  await devCard.onDeviceCardAnswered(c.env, me, id).catch(e => console.error("새 기기 카드 답", String(e).slice(0, 200)));   // 새 기기 허용 카드(device-card.ts)
  await connReq.onConnectCardAnswered(c.env as never, me, id).catch(e => console.error("커넥터 카드 답", String(e).slice(0, 200)));   // 기기에서 넣는 커넥터(connect-request.ts)
  await devSettings.onSettingsCardAnswered(c.env, me, id).catch(e => console.error("기기 설정 허락 카드 답", String(e).slice(0, 200)));
  const card = await c.env.DB.prepare("SELECT wid, question, answer FROM board_card WHERE id = ? AND owner = ?").bind(id, me).first<{ wid: string | null; question: string; answer: string | null }>().catch(() => null);
  const ansText = card ? `${head} [Boarder] The person answered your card ${id} ("${card.question.slice(0, 120)}"): ${String(card.answer ?? choice)}. Continue with that.` : "";
  const sent = card?.wid ? deliverTo(c.env, me, card.wid, ansText).catch(async e => {
    if (!/없는 창/.test(String((e as Error)?.message || e))) return;
    const w = await importedWindow(c.env.DB, me, { wid: card.wid, win: "" });
    if (w && w.engine === "tmux") await queueToImported(c.env.DB, me, w, ansText, id);
  }).catch(() => {}) : Promise.resolve();
  c.executionCtx.waitUntil(sent.then(() => rid ? queue.markSent(c.env.DB, rid) : null).catch(() => {}));
  return c.json({ ok: true });
});
app.post("/api/me/cards/:id/reply", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const { text, rid: rid0 } = await c.req.json<{ text?: string; rid?: string }>().catch(() => ({} as { text?: string; rid?: string }));
  const t = String(text || "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, " ").trim().slice(0, 3000), rid = queue.ridOfBody({ rid: rid0 });
  if (!t) return c.json({ ok: false, error: "내용을 적어요" }, 400);
  const k = await c.env.DB.prepare("SELECT id, win, question, wid FROM board_card WHERE id = ? AND owner = ?").bind(c.req.param("id"), me).first<{ id: string; win: string; question: string; wid: string | null }>();
  if (!k) return c.json({ ok: false, error: "없는 카드예요" }, 404);
  try { if (!(await queue.ridBatch(c.env.DB, rid, [c.env.DB.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").bind(me, "나", "me", t, k.id, Date.now())], p => c.executionCtx.waitUntil(p))) && await queue.sentSeen(c.env.DB, rid)) return c.json({ ok: true, already: true }); }
  catch (e) { if (rid) return queue.retrySafe(c); throw e; }
  const delivered = await cardTell(c.env, me, k, `${await cardHead(c.env, me, k.id)} [Boarder] The person replied in the thread of your card ${k.id} ("${k.question.slice(0, 120)}"): ${t}`).then(ok => ok, e => { console.error("카드 스레드 답 넣기", String(e).slice(0, 200)); return false; });
  if (rid && delivered) c.executionCtx.waitUntil(queue.markSent(c.env.DB, rid).catch(() => {}));
  return c.json({ ok: true, delivered });
});
async function cardHead(env: Env, me: string, id: string) {
  const k = await env.DB.prepare("SELECT win FROM board_card WHERE id = ? AND owner = ?").bind(id, me).first<{ win: string }>().catch(() => null);
  const ch = k ? await memberBoard.channelOf(env.DB, me, k.win).catch(() => k.win) : "";
  return boardHead({ channel: ch || "Primary", card: id });
}
// 카드를 낸 창에 한 줄: 엔진 창(wid)이면 엔진으로, 아니면 들여온 창(import --follow)의 기기 명령 줄로(member-imported.ts). 넣었으면 true, 넣을 창이 없으면 false
async function cardTell(env: Env, me: string, k: { id?: string; wid: string | null; win: string }, text: string) {
  if (k.wid) { try { await deliverTo(env, me, k.wid, text); return true; } catch (e) { if (!/없는 창/.test(String((e as Error)?.message || e))) throw e; } }
  const w = await importedWindow(env.DB, me, k);
  if (!w) return false;
  await queueToImported(env.DB, me, w, text, k.id);
  return true;
}
mountImport(app as never, {
  device: async c => { const d = await deviceOf(c as never); return d && !isOwner(c.env as never, d.owner) && await member(c.env as never, d.owner) ? d : null; },
  member: async c => { const s = await signedIn(c as never); return s && !isOwner(c.env as never, s.user.email) ? s.user.email.toLowerCase() : null; },
  sameSite: c => sameSite(c as never),
  quiet: c => quiet(c.req.raw),
});
mountTaskConvo(app as never, {
  device: async c => { const d = await deviceOf(c as never); return d && !isOwner(c.env as never, d.owner) && await member(c.env as never, d.owner) ? d : null; },
  member: async c => { const s = await signedIn(c as never); return s && !isOwner(c.env as never, s.user.email) ? s.user.email.toLowerCase() : null; },
  sameSite: c => sameSite(c as never),
  sync: (db, me, node) => memberBoard.syncTaskConvo(db, me, node),
});
// 옛 Slack 글 들여오기(slack-import.ts): 회원 기기만 — 들여오기와 같은 가림
slackImport.mountSlackImport(app as never, { device: async c => { const d = await deviceOf(c as never); return d && !isOwner(c.env as never, d.owner) && await member(c.env as never, d.owner) ? d : null; } });
memberCanvas.mountMemberCanvas(app as never, { device: async c => { const d = await deviceOf(c as never); return d && !isOwner(c.env as never, d.owner) && await member(c.env as never, d.owner) ? d : null; } });
// Slack 들여오기를 커넥터로(slack-connector.ts, 온보딩 5층): 회원 기기만 — 그 회원의 Slack 봇 열쇠 연결로 서버가 읽어 회원 들여오기 길로 넣음
mountSlackConnector(app as never, { device: async c => { const d = await deviceOf(c as never); return d && !isOwner(c.env as never, d.owner) && await member(c.env as never, d.owner) ? d : null; } });
// 기기에서 커넥터 넣기(connect-request.ts, 온보딩 3층): 회원 기기(scope full)만 — 넣기는 그 회원 보드 카드의 허용 뒤
connReq.mountConnectRequests(app as never, {
  device: async c => { const d = await deviceOf(c as never); return d && !isOwner(c.env as never, d.owner) && await member(c.env as never, d.owner) ? d : null; },
  card: (env, owner, card) => void memberCardPush(env as never, owner, { ...card, secret: true }),   // 기기가 기다리는 허용 — 늘 보냄(비밀 넣기와 같음)
});
mountConnectLink(app as never, {
  device: async c => cliDevice(c as never) as never,
  human: async c => { if (c.req.header("authorization") !== undefined || c.req.header("x-boarder-device") !== undefined) return null; const s = await signedIn(c as never); return s && await member(c.env as never, s.user.email) ? s.user.email.toLowerCase() : null; },
  sameSite: c => sameSite(c as never),
  key: (env, email) => cliKey(env as never, email),
});
mountApprovalLink(app as never, {
  device: async c => cliDeviceOrOwnerWatch(c as never) as never,
  human: async c => { if (c.req.header("authorization") !== undefined || c.req.header("x-boarder-device") !== undefined) return null; const s = await signedIn(c as never); return s && await member(c.env as never, s.user.email) ? s.user.email.toLowerCase() : null; },
  sameSite: c => sameSite(c as never),
  key: (env, email) => cliKey(env as never, email),
  mails: (env, email) => ownerMails(env as never, email),
  isOwner: (env, email) => isOwner(env as never, email),
});
devSettings.mountDeviceSettings(app as never, {
  device: async c => cliDevice(c as never) as never,
  isOwner: (env, email) => isOwner(env as never, email),
  mails: (env, email) => ownerMails(env as never, email),
  ownerNodeValues: {
    read: async env => (await OS.nodeSettings(env.DB)) as Record<string, number> | null,
    save: async (env, raw) => { const r = await OS.nodeSet(env.DB, { values: raw as never }); return r && r[0] === 200 ? (r[1] as { values: Record<string, number> }).values : null; },
  },
  ownWindow: (db, me, t) => ownWindow(db, me, t),
  regroup: (env, me) => regroup(env as never, me),
  setUnit: (env, me, unit) => setUnit(env as never, me, unit, "me"),
  uiPref: () => UI_PREF,
  nodeValues: { read: (env, me) => memberNodeVals(env as never, me), save: (env, me, raw) => saveNodeVals(env as never, me, raw) },
  sessionSync: { get: (env, me) => sessions.syncOn(env as never, cliKey(env as never, me)), set: (env, me, on) => sessions.setSync(env as never, cliKey(env as never, me), on) },
  flagsOff: env => (env as unknown as { FLAGS_OFF?: string }).FLAGS_OFF,
  avatar: { get: (env, me) => memberBoard.myAvatar(env.DB, me), set: (env, me, face) => memberBoard.setMyAvatar(env.DB, me, face), clean: v => memberBoard.cleanFace(v), photoOk: (env, photo) => photoOk(env as never, photo), put: (env, body) => putPhoto(env as never, body) },
  card: (env, owner, card) => void memberCardPush(env as never, owner, { ...card, secret: true }),   // 기기가 기다리는 허락 — 늘 보냄(커넥터 허용과 같음)
});
mountSecrets(app as never, {
  human: async c => { if (c.req.header("authorization") !== undefined || c.req.header("x-boarder-device") !== undefined) return null; const s = await signedIn(c as never); return s ? { email: s.user.email, owner: isOwner(c.env as never, s.user.email) } : null; },
  sameSite: c => sameSite(c as never),
  agent: async c => {
    const w = await bound(c.env as never, (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "")); if (!w) return null;
    const t = await (c.env as unknown as Env).DB.prepare("SELECT device_id FROM agent_token WHERE hash = ?").bind(w.hash).first<{ device_id: string | null }>();
    return { owner: w.owner || "", device_id: t?.device_id ?? null, win: w.win || w.pane, tok: w.hash.slice(0, 32) };
  },
  // 기기 토큰 → 비밀 줄 owner: 주인 메일 = '', 회원 = 메일(초대가 빠지면 없음). scope 는 secrets.ts 가 가림(회원 full 만 · 주인은 묶인 기기면 무엇이든)
  device: async (env, tok) => {
    if (!/^bxd_[A-Za-z0-9_-]{30,80}$/.test(tok)) return null;
    const e = env as unknown as Env, d = await e.DB.prepare("SELECT id, owner, scope FROM device WHERE token_hash = ? AND revoked_at IS NULL").bind(await sha(tok)).first<{ id: string; owner: string; scope: string }>();
    if (!d) return null;
    if (isOwner(e, d.owner)) return { id: d.id, key: "", scope: d.scope };
    return await member(e, d.owner) ? { id: d.id, key: d.owner.toLowerCase(), scope: d.scope } : null;
  },
  admin: c => admin(c as never),
  card: (env, owner, card) => void memberCardPush(env as never, owner, { ...card, secret: true }),   // 비밀 넣기 허용: 에이전트가 멈춰 기다림 — 급함 · 온보딩 조용히와 상관없이 보냄
});
const memberBot = (env: Env, me: string) => env.DB.prepare("SELECT seed, hue, name, photo, icon, fav FROM member_bot WHERE owner = ?").bind(me).first<Bot>();
const BLOB_ID = /^[0-9a-f]{32}$/;
const botKey = (env: Env, email: string) => W.botKey(env, email);
app.get("/api/me/bot", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  return c.json({ bot: await memberBot(c.env, botKey(c.env, s.user.email)) }, 200, { "cache-control": "no-store" });
});
// 그림 하나(PNG · JPEG · WebP, 1.5MB 까지) → R2 blobs/<내용 해시 32자>. 머리 바이트로 꼴 확인 — 올린 사람이 꼴을 속여 HTML 등을 못 올리게(받는 쪽도 nosniff · sandbox)
// 사진 한 장 받아 두기(PNG · JPEG · WebP, 1.5MB 이하): 화면 길(/api/me/bot/image)과 기기 CLI 길(device-settings.ts avatar)이 같이 씀
async function putPhoto(env: Env, body: Uint8Array<ArrayBuffer>): Promise<{ id: string } | { error: string; status: 400 | 413 }> {
  if (!body.byteLength || body.byteLength > 1_500_000) return { error: "사진이 너무 커요", status: 413 };
  const hex = [...body.slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join("");
  const type = hex.startsWith("89504e470d0a1a0a") ? "image/png" : hex.startsWith("ffd8ff") ? "image/jpeg" : hex.startsWith("52494646") && hex.slice(16, 24) === "57454250" ? "image/webp" : "";
  if (!type) return { error: "PNG · JPEG · WebP 사진만 돼요", status: 400 };
  const id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
  await env.RESULTS.put(`blobs/${id}`, body, { httpMetadata: { contentType: type } });
  return { id };
}
app.post("/api/me/bot/image", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  if (+(c.req.header("content-length") || 0) > 1_500_000) return c.json({ error: "사진이 너무 커요" }, 413);
  const r = await putPhoto(c.env, new Uint8Array(await c.req.arrayBuffer()));
  return "error" in r ? c.json({ error: r.error }, r.status) : c.json({ id: r.id });
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
  // 온보딩을 마친 순간 기기가 이미 붙어 있으면 기본 역할을 바로 심음(멱등 — 안 붙었으면 다음 hello 때)
  if (!isOwner(c.env, me)) c.executionCtx.waitUntil((async () => { const dev = await liveDevice(c.env.DB, me); if (dev) await (engineOf(c.env, dev) as unknown as { seedRoles(o: string): Promise<unknown> }).seedRoles(me); })().catch(() => {}));
  return c.json({ bot: { seed, hue, name, photo, icon, fav } });
});
const photoOk = async (env: Env, photo: string) => { if (!photo) return true; if (!BLOB_ID.test(photo)) return false; const h = await env.RESULTS.head(`blobs/${photo}`); return !!h && /^image\/(png|jpeg|webp)$/.test(h.httpMetadata?.contentType || ""); };
app.get("/api/me/avatar", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const me = s.user.email.toLowerCase();
  if (isOwner(c.env, me)) { const b = await memberBot(c.env, "@owner"); return c.json({ avatar: b ? memberBoard.cleanFace(b) : null }, 200, { "cache-control": "no-store" }); }   // 주인 아바타 = 「@owner」 줄(api/me/bot 과 같음)
  return c.json({ avatar: await memberBoard.myAvatar(c.env.DB, me) }, 200, { "cache-control": "no-store" });
});
app.post("/api/me/avatar", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const f = memberBoard.cleanFace(await c.req.json().catch(() => null));
  if (!f) return c.json({ error: "모양 · 색" }, 400);
  if (!(await photoOk(c.env, f.photo || ""))) return c.json({ error: "그림을 먼저 올려요" }, 400);
  return c.json({ avatar: await memberBoard.setMyAvatar(c.env.DB, me, f) });
});
app.get("/api/me/side", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const me = s.user.email.toLowerCase();
  return c.json({ side: await readSide(c.env.DB, me), pins: await readPins(c.env.DB, me), hide: await readHide(c.env.DB, me) }, 200, { "cache-control": "no-store" });
});
app.post("/api/me/side", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const b = Object(await c.req.json().catch(() => ({}))) as { side?: unknown; pins?: unknown; hide?: unknown };
  if (b.hide !== undefined) {
    const hide = cleanHide(b.hide);
    if (!hide) return c.json({ ok: false, error: "값" }, 400);
    await saveHide(c.env.DB, s.user.email.toLowerCase(), hide);
    return c.json({ ok: true, hide });
  }
  if (b.pins !== undefined) {
    const pins = cleanPins(b.pins);
    if (!pins) return c.json({ ok: false, error: "캔버스 주소가 틀렸거나 12개를 넘었어요" }, 400);
    await savePins(c.env.DB, s.user.email.toLowerCase(), pins);
    return c.json({ ok: true, pins });
  }
  const side = cleanSide(b.side);
  if (!side) return c.json({ ok: false, error: "값" }, 400);
  await saveSide(c.env.DB, s.user.email.toLowerCase(), side);
  return c.json({ ok: true, side });
});
// 사람별 화면 덧씌우기(person-custom.ts): 내 계정 것만 읽고 씀. 쓰기는 같은 사이트에서만, 값은 css · js 각 200KB 까지
const ovMeta = (o: pc.Overlay | null) => ({ cssBytes: o?.css.length ?? 0, jsBytes: o?.js.length ?? 0, wrapper: { css: o?.wcss.length ?? 0, js: o?.wjs.length ?? 0, jsSha: o?.wjsSha || null, side: !!o?.wside } });
app.get("/api/me/overlay", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const o = await pc.readOverlay(c.env.DB, s.user.email.toLowerCase());
  return c.json({ css: o?.css ?? "", js: o?.js ?? "", ...ovMeta(o) }, 200, { "cache-control": "no-store" });
});
app.post("/api/me/overlay", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const b = Object(await c.req.json().catch(() => ({}))) as { css?: unknown; js?: unknown };
  const css = b.css === undefined ? undefined : pc.cleanText(b.css), js = b.js === undefined ? undefined : pc.cleanText(b.js);
  if (css === null || js === null || (css === undefined && js === undefined)) return c.json({ ok: false, error: "css · js 는 글이고 각각 200KB 까지예요" }, 400);
  await pc.savePatch(c.env.DB, s.user.email.toLowerCase(), { ...(css !== undefined ? { css } : {}), ...(js !== undefined ? { js } : {}) });
  return c.json({ ok: true });
});
app.delete("/api/me/overlay", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  // ?all=1 이면 래퍼 칸(css · js · 사이드)까지 — 웹에서 래퍼 js 도 끌 수 있게
  const all = new URL(c.req.url).searchParams.get("all") === "1";
  await pc.savePatch(c.env.DB, s.user.email.toLowerCase(), { css: null, js: null, ...(all ? { wcss: null, wjs: null, wjs_sha: null, wside: null } : {}) });
  return c.json({ ok: true });
});
const plainName = (n: unknown) => String(n || "").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40) || "이름 없음";
function noteDevice(c: Context<{ Bindings: Env }>, owner: string, device: { name?: string }, text: string) {
  const line = `기기 「${plainName(device.name)}」가 ${text}. 내가 한 게 아니면 설정에서 기기를 끊어 주세요`, viaRelay = isOwner(c.env, owner) && !!hosted.exec;
  c.executionCtx.waitUntil((async () => {
    try {
      if (viaRelay) await (boardTool(c.env, "owner", "notify", { text: line }, "boarder@worker") as Promise<unknown>);
      else await sysLine(c.env.DB, owner, line);
    } catch (e) { console.error("기기 알림 못 올림", viaRelay ? "relay" : "d1", String((e as Error)?.message || e).slice(0, 160)); }
  })());
}
async function overlayDevice(c: Context<{ Bindings: Env }>) {
  const d = await deviceOf(c); if (!d || d.scope !== "full") return null;
  if (!isOwner(c.env, d.owner) && !(await member(c.env, d.owner))) return null;
  return { d, owner: d.owner.toLowerCase() };
}
app.get("/api/device/overlay", async c => {
  const a = await overlayDevice(c); if (!a) return c.json({ ok: false, error: "기기 토큰" }, 401);
  return c.json({ ok: true, ...ovMeta(await pc.readOverlay(c.env.DB, a.owner)) }, 200, { "cache-control": "no-store" });
});
app.post("/api/device/overlay", async c => {
  const a = await overlayDevice(c); if (!a) return c.json({ ok: false, error: "기기 토큰" }, 401);
  if (+(c.req.header("content-length") || 0) > 700_000) return c.json({ ok: false, error: "너무 커요" }, 413);
  const b = Object(await c.req.json().catch(() => ({}))) as { slot?: unknown; set?: Record<string, unknown>; consent?: unknown };
  const set = b.set && typeof b.set === "object" && !Array.isArray(b.set) ? b.set : null;
  if ((b.slot !== "mine" && b.slot !== "wrapper") || !set) return c.json({ ok: false, error: "slot · set" }, 400);
  const patch: Parameters<typeof pc.savePatch>[2] = {}, what: string[] = [], cur = await pc.readOverlay(c.env.DB, a.owner);
  let risky = false;
  for (const k of Object.keys(set)) {
    const v = set[k];
    if ((k === "css" || k === "js") && v !== undefined) {
      const t = v === null ? "" : pc.cleanText(v); if (t === null) return c.json({ ok: false, error: `${k} 는 글이고 200KB 까지예요` }, 400);
      if (k === "js" && t && t !== (b.slot === "mine" ? cur?.js : cur?.wjs)) risky = true;
      if (b.slot === "mine") patch[k] = t;
      else if (k === "css") patch.wcss = t;
      else {   // 래퍼 js: 받는 사람이 동의한 해시와 같은 글일 때만
        if (t && (typeof b.consent !== "string" || b.consent !== await pc.sha256(t))) return c.json({ ok: false, error: "래퍼 js 는 켜기에 동의한 해시가 있어야 올라가요" }, 400);
        patch.wjs = t; patch.wjs_sha = t ? String(b.consent) : null;
      }
      what.push(`${b.slot === "wrapper" ? "래퍼 " : ""}${k}${t ? "" : " 비움"}`);
    } else if (k === "side" && b.slot === "wrapper") {
      const w = v === null ? null : pc.cleanWrapperSide(v); if (v !== null && !w) return c.json({ ok: false, error: "side 꼴이 틀렸어요" }, 400);
      if (JSON.stringify(w?.pins ?? []) !== JSON.stringify(cur?.wside?.pins ?? [])) risky = true;
      patch.wside = w ? JSON.stringify(w) : null; what.push(`래퍼 사이드${w ? "" : " 비움"}`);
    } else return c.json({ ok: false, error: `모르는 칸: ${k}` }, 400);
  }
  if (!what.length) return c.json({ ok: false, error: "바꿀 칸이 없어요" }, 400);
  if (risky && !isOwner(c.env, a.owner) && !(await devSettings.allowed(c.env.DB, a.owner, a.d.id))) return c.json({ ok: false, error: "not_allowed", hint: devSettings.NOT_ALLOWED_HINT }, 403, { "cache-control": "no-store" });
  await pc.savePatch(c.env.DB, a.owner, patch);
  noteDevice(c, a.owner, a.d, `화면 덧씌우기를 바꿨어요 (${what.join(" · ")})`);
  return c.json({ ok: true });
});
// 프롬프트 칸: 메인 봇 첫 글 · 새 회원 기본 역할을 그 사람 값으로(래퍼 prompts/ 를 기기가 읽어 올림). 비우면 코드 기본값
app.post("/api/device/prompts", async c => {
  const a = await overlayDevice(c); if (!a) return c.json({ ok: false, error: "기기 토큰" }, 401);
  if (+(c.req.header("content-length") || 0) > 200_000) return c.json({ ok: false, error: "너무 커요" }, 413);
  const b = Object(await c.req.json().catch(() => ({}))) as { main?: unknown; roles?: unknown };
  const patch: Parameters<typeof pc.savePatch>[2] = {};
  if (b.main !== undefined) { const m = b.main === null ? "" : pc.cleanText(b.main, pc.MAX_MAIN); if (m === null) return c.json({ ok: false, error: "main 은 글이고 6000바이트까지예요" }, 400); patch.p_main = m.trim() || null; }
  if (b.roles !== undefined) { const r = b.roles === null ? [] : pc.cleanRoles(b.roles); if (!r) return c.json({ ok: false, error: "roles 꼴이 틀렸어요(열두 개까지, id · name · instructions)" }, 400); patch.p_roles = r.length ? JSON.stringify(r) : null; }
  if (!Object.keys(patch).length) return c.json({ ok: false, error: "바꿀 칸이 없어요" }, 400);
  await pc.savePatch(c.env.DB, a.owner, patch);
  noteDevice(c, a.owner, a.d, "메인 봇 · 역할 글을 바꿨어요");
  return c.json({ ok: true });
});
app.get("/api/me/nodes/avatar", async c => {
  const s = await signedIn(c); if (!s || isOwner(c.env, s.user.email)) return c.json({ error: "no" }, 403);
  const me = s.user.email.toLowerCase();
  return c.json({ nodes: await memberBoard.nodeFaceList(c.env.DB, me, await memberBot(c.env, me)) }, 200, { "cache-control": "no-store" });
});
app.post("/api/me/nodes/avatar", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const b = Object(await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const reset = !b.seed && !b.photo;
  const id = await memberBoard.nodeIdOf(c.env.DB, me, String(b.node ?? "")); if (!id) return c.json({ error: "없는 노드예요" }, 404);
  const base = memberBoard.faceOf(id), f = reset ? null : memberBoard.cleanFace({ seed: b.seed || base.seed, hue: b.hue ?? base.hue, photo: b.photo || "" });
  if (!reset && !f) return c.json({ error: "모양 · 색" }, 400);
  if (f && !(await photoOk(c.env, f.photo || ""))) return c.json({ error: "그림을 먼저 올려요" }, 400);
  const r = await memberBoard.setNodeFace(c.env.DB, me, id, f);
  return "error" in r ? c.json({ error: r.error }, r.status) : c.json(r);
});
app.get("/api/me/agent-faces", async c => {
  const s = await signedIn(c); if (!s || !isOwner(c.env, s.user.email)) return c.json({ error: "no" }, 403);
  return c.json({ faces: await agentFace.all(c.env.DB, todoOwner(c.env, s.user.email)) }, 200, { "cache-control": "no-store" });
});
// { key: 에이전트 키, seed?, hue?, photo? } — seed · photo 둘 다 없으면 기본 얼굴로 되돌림
app.post("/api/me/agent-faces", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s || !isOwner(c.env, s.user.email)) return c.json({ error: "no" }, 403);
  const b = Object(await c.req.json().catch(() => ({}))) as Record<string, unknown>, key = String(b.key ?? "");
  if (!agentFace.KEY.test(key)) return c.json({ error: "없는 에이전트예요" }, 404);
  if ("name" in b && !("seed" in b) && !("photo" in b)) {   // 보이는 이름만(얼굴은 그대로) — 빈 글이면 기본 이름으로
    if (b.name !== null && typeof b.name !== "string") return c.json({ error: "이름은 글이에요" }, 400);
    const name = agentFace.cleanName(b.name); await agentFace.setName(c.env.DB, todoOwner(c.env, s.user.email), key, name);
    return c.json({ ok: true, key, name });
  }
  const reset = !b.seed && !b.photo, f = reset ? null : memberBoard.cleanFace({ seed: b.seed || "mochi", hue: b.hue ?? 180, photo: b.photo || "" });
  if (!reset && !f) return c.json({ error: "모양 · 색" }, 400);
  if (f && !(await photoOk(c.env, f.photo || ""))) return c.json({ error: "그림을 먼저 올려요" }, 400);
  await agentFace.set(c.env.DB, todoOwner(c.env, s.user.email), key, f);
  return c.json({ ok: true, key, avatar: f });
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
// 주인 감시 기기를 설정 · 커넥터 · 승인 CLI 기기(scope ownercli)로 올림 — 승인 링크(approval-link.ts ownercli.enable)에서 주인 본인 세션이 부름.
//   올릴 때 설정 허락(v2)도 같이 남김: 이 승인이 곧 「이 기기가 내 보드 설정을 바꿔도 돼요」. 끊으면(revoke) 토큰이 죽어 함께 끝남
app.post("/api/me/devices/:id/ownercli", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  if (c.req.header("authorization") !== undefined || c.req.header("x-boarder-device") !== undefined) return c.json({ error: "로그인" }, 401);   // 기기 토큰 머리가 붙은 요청은 사람이 아님
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  if (!isOwner(c.env, s.user.email)) return c.json({ error: "주인만" }, 403);
  const id = c.req.param("id"), now = Date.now(), ms = ownerMails(c.env, s.user.email);
  const d = await c.env.DB.prepare(`SELECT owner FROM device WHERE id = ? AND owner IN (${ms.map(() => "?").join(",")}) AND scope = 'watch' AND revoked_at IS NULL`).bind(id, ...ms).first<{ owner: string }>();
  if (!d) return c.json({ error: "올릴 수 있는 주인 감시 기기가 아니에요" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE device SET scope = 'ownercli' WHERE id = ? AND scope = 'watch' AND revoked_at IS NULL").bind(id),
    c.env.DB.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(d.owner.toLowerCase(), `cli_settings:${id}`, `v2:${now}`, now),
  ]);
  return c.json({ ok: true });
});
app.post("/api/me/devices/:id/revoke", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const id = c.req.param("id"), now = Date.now();
  const ms = ownerMails(c.env, s.user.email);
  const u = await c.env.DB.prepare(`UPDATE device SET revoked_at = ? WHERE id = ? AND owner IN (${ms.map(() => "?").join(",")}) AND revoked_at IS NULL`).bind(now, id, ...ms).run();
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
mountRoleEdit(app, memberOnly);
const engErr = (c: Context<{ Bindings: Env }>, e: unknown) => c.json({ ok: false, error: e instanceof Error && /^[가-힣]/.test(e.message) ? e.message : "일시적인 오류가 발생했어요" }, 400);
app.post("/api/me/chat", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const { text, rid: rid0, thread } = await c.req.json<{ text?: string; rid?: string; thread?: string }>().catch(() => ({} as { text?: string; rid?: string; thread?: string }));
  const t = String(text || "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").trim().slice(0, 4000), rid = queue.ridOfBody({ rid: rid0 });
  if (!t) return c.json({ ok: false, error: "내용을 적어요" }, 400);
  const root = thread === undefined || thread === null || thread === "" ? undefined : String(thread);
  if (root !== undefined && !(await memberBoard.primaryRoot(c.env.DB, me, root))) return c.json({ ok: false, error: "없는 스레드예요" }, 404);
  try { if (!(await queue.ridBatch(c.env.DB, rid, [c.env.DB.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").bind(me, "나", "chat", t, root ? memberBoard.primaryThread(root) : "primary", Date.now())], p => c.executionCtx.waitUntil(p))) && await queue.sentSeen(c.env.DB, rid)) return c.json({ ok: true, already: true }); }
  catch (e) { if (rid) return queue.retrySafe(c); throw e; }
  // 머리 줄: 스레드 글 = 그 뿌리, 새 글 = 방금 쓴 그 글(창이 boarder chat --thread <ts> 로 그 글 아래에 답) — 못 찾으면 예전 「[보드 · Primary]」
  const head = boardHead({ thread: root ?? await memberBoard.myPrimaryTs(c.env.DB, me, t).catch(() => null) });
  try { const r = await primarySend(c.env, me, t, head); if (rid) c.executionCtx.waitUntil(queue.markSent(c.env.DB, rid).catch(() => {})); if ((r as { offline?: boolean })?.offline) await sysLine(c.env.DB, me, "엔진이 켜진 기기가 없어 메인 봇에게 아직 못 전했어요 — 기기에서 boarder engine setup 을 돌려요"); return c.json({ ok: true, ...(r as object || {}) }); }
  catch (e) { await sysLine(c.env.DB, me, LOST_LINE).catch(() => null); return engErr(c, e); }   // 넣다 깨져도 채팅에 표시(글 줄은 이미 남음)
});
// 회원 온보딩 점검표(member-onboarding.ts, 온보딩 4층): 설정 › 시작하기 — 그 회원 것만, 읽기만
app.get("/api/me/onboarding", async c => {
  const s = await signedIn(c); if (!s || isOwner(c.env, s.user.email)) return c.json({ error: "no" }, 403);
  return c.json(await onboarding(c.env.DB, s.user.email.toLowerCase(), { server: c.env.PUBLIC_URL, push: await ledger.f7On(c.env.DB, "member_push").catch(() => false) }), 200, { "cache-control": "no-store" });
});
const UI_PREF: Record<string, (v: string) => boolean> = { theme: v => /^(system|light|dark)$/.test(v), accent: v => v === "bot" || v === "orange" || /^#[0-9a-f]{6}$/.test(v), still: v => v === "0" || v === "1", favblink: v => v === "0" || v === "1", tapthread: v => v === "0" || v === "1", unreadkeep: v => v === "0" || v === "1", canvasback: v => v === "0" || v === "1", ibboth: v => v === "0" || v === "1", sbw: v => v === "0" || v === "72" || (/^[1-9]\d{2}$/.test(v) && +v >= 200 && +v <= 480) }
app.get("/api/me/ui", async c => {
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  const rs = (await c.env.DB.prepare("SELECT k, v FROM user_pref WHERE owner = ? AND k LIKE 'ui:%'").bind(s.user.email.toLowerCase()).all<{ k: string; v: string }>()).results || [];
  const out: Record<string, string> = {}; for (const r of rs) { const k = r.k.slice(3); if (Object.hasOwn(UI_PREF, k) && UI_PREF[k](r.v)) out[k] = r.v; }
  return c.json(out, 200, { "cache-control": "no-store" });
});
app.post("/api/me/ui", async c => {   // { k: "theme" | "accent" | "still" | "favblink" | "tapthread" | "unreadkeep", v }
  const s = await signedIn(c); if (!s) return c.json({ error: "로그인" }, 401);
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const { k, v } = await c.req.json<{ k?: string; v?: string }>().catch(() => ({} as { k?: string; v?: string }));
  const key = String(k || ""), val = String(v ?? "");
  if (!Object.hasOwn(UI_PREF, key) || !UI_PREF[key](val)) return c.json({ ok: false, error: "모르는 값" }, 400);   // 객체 원형 이름(toString 등)이 검사를 지나 아무 값이나 저장되던 것
  await c.env.DB.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(s.user.email.toLowerCase(), "ui:" + key, val, Date.now()).run();
  return c.json({ ok: true });
});
app.post("/api/me/nodes/order", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ panes?: unknown } | null>().catch(() => null);
  const panes = panesOk(b?.panes); if (!panes) return c.json({ ok: false, error: "판 번호 2~60개" }, 400);
  const [nd, ns] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id FROM mnode WHERE owner = ?1 UNION ALL SELECT id FROM engine_window WHERE owner = ?1 AND kind = 'role'").bind(me),
    c.env.DB.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(me),
  ]);
  const live = (nd.results as { id: string }[]).map(r => r.id), byPane = new Map(live.map(id => [memberBoard.paneOfId(id), id]));
  const ids = panes.map(p => byPane.get(p)); if (ids.some(x => !x)) return c.json({ ok: false, error: "없는 노드" }, 404);
  const order = placeWithin(orderFromData((ns.results[0] as { data?: string } | undefined)?.data), ids as string[], live);
  if (!order) return c.json({ ok: false, error: "순서를 저장할 노드가 너무 많아요" }, 409);   // 조용히 잘라 ok 를 주면 새 순서가 사라짐
  await saveOrder(c.env.DB, me, order);
  return c.json({ ok: true, n: ids.length });
});
app.get("/api/me/primary-window", async c => {
  const s = await signedIn(c); if (!s || isOwner(c.env, s.user.email)) return c.json({ error: "no" }, 403);
  const v = (await c.env.DB.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = 'primary_win'").bind(s.user.email.toLowerCase()).first<{ v: string }>())?.v || null;
  return c.json({ target: v }, 200, { "cache-control": "no-store" });
});
app.post("/api/me/primary-window", async c => {   // { target: "window:…" | "ew_…" | null } — null · 빈 값 = 메인 봇으로 되돌림
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const { target } = await c.req.json<{ target?: string | null }>().catch(() => ({} as { target?: string | null }));
  const t = String(target ?? "").trim().slice(0, 300);
  if (!t) { await c.env.DB.prepare("DELETE FROM user_pref WHERE owner = ? AND k = 'primary_win'").bind(me).run(); return c.json({ ok: true, target: null }); }
  if (!(await ownWindow(c.env.DB, me, t))) return c.json({ ok: false, error: "내 살아 있는 창이 아니에요" }, 404);
  await c.env.DB.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(me, "primary_win", t, Date.now()).run();
  return c.json({ ok: true, target: t });
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
  if (mode !== "bypass" && mode !== "auto" && mode !== "ask") return c.json({ error: "mode" }, 400);
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO engine_owner(owner, perm_mode, perm_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(owner) DO UPDATE SET perm_mode = excluded.perm_mode, perm_at = excluded.perm_at, updated_at = excluded.updated_at").bind(me, mode, now, now).run();
  await sysLine(c.env.DB, me, mode === "bypass" ? "묻지 않고 일하기를 허용했어요 — 다음에 여는 창부터" : mode === "auto" ? "자동 허용으로 바꿨어요 — 안전한 일은 알아서 하고 위험한 일은 막아요. 다음에 여는 창부터" : "묻지 않고 일하기를 껐어요 — 다음에 여는 창부터 하나하나 물어요");
  return c.json({ ok: true, mode });
});
// BYOS 설정 › 엔진: 그 기기의 지금 엔진 · 공급자별 계정, 브라우저 로그인 주소, 엔진 고르기 — 내 기기(owner = 나 · full · 폐기 안 됨)만.
//   쓰기(login · choose)는 같은 사이트 + 회원 세션. 서버는 기기 동사만 내리고 로그인 값은 받지 않음(이름 · 여부 · 주소만)
type DevCmd = { devCmd(verb: string, args: Record<string, unknown>, ms?: number): Promise<{ ok: boolean; result?: any; code?: number; error?: string }> };
const myEngineDevice = async (c: Context<{ Bindings: Env }>, me: string) => c.env.DB.prepare("SELECT id, engine, engine_at FROM device WHERE id = ? AND owner = ? AND revoked_at IS NULL AND scope = 'full'").bind(c.req.param("id") || "", me).first<{ id: string; engine: string | null; engine_at: number | null }>();
async function engineDevCmd(c: Context<{ Bindings: Env }>, verb: string, args: Record<string, unknown>, ms: number) {
  const me = await memberOnly(c); if (!me) return { err: c.json({ error: "no" }, 403) as Response };
  const d = await myEngineDevice(c, me); if (!d) return { err: c.json({ ok: false, error: "없는 기기" }, 404) as Response };
  if (Date.now() - (d.engine_at || 0) > 120_000) return { err: c.json({ ok: false, error: "기기가 꺼져 있어요" }, 409) as Response };
  const r = await (engineOf(c.env, d.id) as unknown as DevCmd).devCmd(verb, args, ms);
  if (!r.ok) return { err: c.json({ ok: false, error: /^[가-힣]/.test(r.error || "") ? r.error : "기기가 답하지 않아요" }, r.code === 5 ? 409 : 502) as Response };
  return { me, d, result: r.result };
}
app.get("/api/me/engine/device/:id", async c => {
  const x = await engineDevCmd(c, "account_list", {}, 30_000); if ("err" in x) return x.err;
  const r = x.result || {}, accounts: Record<string, { name: string; logged_in: boolean }[]> = {};
  for (const p of ["claude", "codex"]) accounts[p] = (Array.isArray(r.accounts?.[p]) ? r.accounts[p] : []).slice(0, 20).map((a: any) => ({ name: String(a?.name || "").slice(0, 40), logged_in: a?.logged_in === true }));
  return c.json({ ok: true, engine: typeof r.engine === "string" ? r.engine.slice(0, 30) : null, engines: Array.isArray(r.engines) ? r.engines.filter((e: unknown) => typeof e === "string").slice(0, 8) : [], accounts }, 200, { "cache-control": "no-store" });
});
app.post("/api/me/engine/device/:id/login", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ provider?: string; name?: string }>().catch(() => ({} as { provider?: string; name?: string }));
  if (!["claude", "codex"].includes(b.provider || "") || !/^\w[\w.-]{0,39}$/.test(b.name || "")) return c.json({ ok: false, error: "공급자나 계정 이름이 맞지 않아요" }, 400);
  const x = await engineDevCmd(c, "account_login", { provider: b.provider, name: b.name }, 40_000); if ("err" in x) return x.err;
  const u = typeof x.result?.url === "string" && /^https:\/\/[^\s]{1,2000}$/.test(x.result.url) ? x.result.url : null;   // 주소는 https 만 화면에 링크로
  return c.json({ ok: true, url: u, started: x.result?.started !== false });
});
app.post("/api/me/engine/device/:id/choose", async c => {
  if (!sameSite(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ engine?: string }>().catch(() => ({} as { engine?: string }));
  if (b.engine !== "sdk" && b.engine !== "tmux") return c.json({ ok: false, error: "엔진은 sdk 나 tmux 예요" }, 400);
  const x = await engineDevCmd(c, "engine_choose", { engine: b.engine }, 170_000); if ("err" in x) return x.err;
  const cur = (() => { try { return x.d.engine ? JSON.parse(x.d.engine) : {}; } catch { return {}; } })();   // 기기가 다음에 붙을 때 알려 줄 값을 미리 맞춤
  await c.env.DB.prepare("UPDATE device SET engine = ? WHERE id = ? AND owner = ?").bind(JSON.stringify({ ...cur, default: b.engine }), x.d.id, x.me).run();
  await sysLine(c.env.DB, x.me, b.engine === "sdk" ? "엔진을 내 구독으로 바꿨어요 — 다음에 여는 창부터" : "엔진을 쓰던 Codex · Claude Code 로 바꿨어요 — 다음에 여는 창부터");
  return c.json({ ok: true, engine: b.engine });
});
app.post("/api/me/session/new", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ folder?: string; text?: string }>().catch(() => ({} as { folder?: string; text?: string }));
  const folder = String(b.folder || ""), text = String(b.text || "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").trim().slice(0, 4000);
  if (!(await memberBoard.folderOk(c.env.DB, me, folder))) return c.json({ ok: false, error: "없는 폴더" }, 404);
  const dev = await liveDevice(c.env.DB, me); if (!dev) return c.json({ ok: false, error: "엔진이 켜진 기기가 없어요" }, 409);
  const name = Array.from(folder.replace(/\/+$/, "").split("/").pop() || "새 대화").slice(0, 40).join("");
  try {
    const w = await engineOf(c.env, dev).open({ owner: me, kind: "role", role_id: null, name, cwd: folder, prompt: text ? `[Boarder chat] ${text}` : "[Boarder] The person opened a new conversation in this folder from the board. Wait for their first message." });
    await sysLine(c.env.DB, me, `「${name}」 새 대화를 열었어요`, w.id);
    return c.json({ ok: true, pane: memberBoard.paneOfId(w.id), name, window: w.id });
  } catch (e) { return engErr(c, e); }
});
app.post("/api/me/chats/new", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ text?: string; rid?: string }>().catch(() => ({} as { text?: string; rid?: string }));
  const t = memberBoard.chatText(b.text);
  if (!t) return c.json({ ok: false, error: "첫 글이 없어요" }, 400);
  const db = c.env.DB, rid = queue.ridOfBody(b);
  if (rid) {
    try {
      const got = await memberBoard.chatOfRid(db, me, rid);
      if (got) return c.json({ ok: true, sid: got.id, title: String(got.name || "새 대화"), already: true });
    } catch { return queue.retrySafe(c); }
  }
  const dev = await liveDevice(db, me); if (!dev) return c.json({ ok: false, error: "엔진이 켜진 기기가 없어요" }, 409);
  if (await memberBoard.chatCount(db, me) >= memberBoard.CHAT_MAX) return c.json({ ok: false, error: `열린 대화가 ${memberBoard.CHAT_MAX}개예요. 안 쓰는 대화를 닫고 다시 해 주세요` }, 409);
  // rid 를 먼저 잡음: 같은 rid 가 동시에 오면 하나만 창을 엶 — 다른 쪽은 다시 보내라(503 x-retry-safe)고 해 끝난 뒤 위 「이미 연 대화」로 받음. 잡고 2분 넘게 창이 없으면(Worker 가 죽음) 다시 잡음
  if (rid) { try { if (!(await memberBoard.chatClaim(db, rid))) return queue.retrySafe(c); } catch { return queue.retrySafe(c); } }
  const title = memberBoard.chatTitle(t), at = Date.now();
  let w: { id: string };
  try { w = await engineOf(c.env, dev).open({ owner: me, kind: "chat", name: title, cwd: memberBoard.CHAT_DIR, prompt: t }); }
  catch (e) { if (rid) await db.prepare("DELETE FROM f7_rid WHERE rid = ?").bind(rid).run().catch(() => {}); return engErr(c, e); }   // 못 열었으면 rid 를 놓아 다시 보내면 다시 엶
  const st = [db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").bind(me, title, "me", t, null, at, w.id)];
  if (rid) st.push(db.prepare("INSERT OR IGNORE INTO f7_rid(rid, at) VALUES (?, ?)").bind(memberBoard.chatRidKey(rid, w.id), at));
  // 창은 이미 열림 — 줄을 못 남겨도 대화는 있음(목록 · 기록은 창으로 읽음). 오류로 돌려 다시 열게 하지 않음
  await db.batch(st).catch(e => console.error("새 대화 줄", e));
  return c.json({ ok: true, sid: w.id, title });
});
app.post("/api/me/chats/:id/send", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const id = c.req.param("id"), b = await c.req.json<{ text?: string; rid?: string }>().catch(() => ({} as { text?: string; rid?: string }));
  const t = memberBoard.chatText(b.text);
  if (!t) return c.json({ ok: false, error: "내용을 적어요" }, 400);
  const w = await memberBoard.chatOf(c.env.DB, me, id); if (!w) return c.json({ ok: false, error: "없는 대화예요" }, 404);
  const rid = queue.ridOfBody(b);
  try { if (!(await queue.ridBatch(c.env.DB, rid, [c.env.DB.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").bind(me, String(w.name), "me", t, null, Date.now(), id)], p => c.executionCtx.waitUntil(p)))) return c.json({ ok: true, already: true }); }
  catch (e) { if (rid) return queue.retrySafe(c); throw e; }
  try { return c.json({ ok: true, ...(await deliverTo(c.env, me, id, t) as object || {}) }); }
  catch (e) { return engErr(c, e); }
});
app.post("/api/me/windows/:id/say", async c => {
  const me = await memberOnly(c); if (!me) return c.json({ error: "no" }, 403);
  const { text, head } = await c.req.json<{ text?: string; head?: string }>().catch(() => ({} as { text?: string; head?: string }));
  const t = String(text || "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").trim().slice(0, 4000);
  if (!t) return c.json({ ok: false, error: "내용을 적어요" }, 400);
  const h = typeof head === "string" && HEAD_RE.exec(head)?.[0].trim() === head ? head + " " : "";   // 머리 줄(member-board post 가 붙임) — 꼴이 맞을 때만 맨 앞에
  try { return c.json({ ok: true, ...(await deliverTo(c.env, me, c.req.param("id"), `${h}[Boarder chat] ${t}`) as object || {}) }); }
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
      c.env.DB.prepare("DELETE FROM sales_member WHERE email = ?").bind(e),
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
app.get("/api/admin/mthumb/jobs", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  return c.json({ jobs: await memberCanvas.thumbJobs(c.env as never, Math.min(Math.max(Number(c.req.query("limit")) || 8, 1), 20), new Set((c.req.query("skip") || "").split(",").filter(x => /^[A-Za-z0-9]{16,40}$/.test(x)).slice(0, 200))) }, 200, { "cache-control": "no-store" });
});
app.put("/api/admin/mthumb/:mk/:id", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const r = await memberCanvas.putThumb(c.env as never, c.req.param("mk"), c.req.param("id"), await c.req.arrayBuffer(), c.req.query("ver") || "", c.req.query("pref") || "");
  return c.json(r[1], r[0] as 200);
});
app.post("/api/admin/member-push-log", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const e = String((await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }))).email || "").trim().toLowerCase();
  if (!TEST_EMAIL.test(e)) return c.json({ error: "시험 주소(@example.com)만" }, 400);
  const pu = memberPusher(c.env, e); if (!pu) return c.json({ error: "no" }, 404);
  return c.json({ log: await pu.mLog(e) ?? [] });
});
app.post("/api/admin/member-push-fails", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const e = String((await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }))).email || "").trim().toLowerCase();
  if (!PU.memberName(e) || isOwner(c.env, e) || !(await member(c.env, e))) return c.json({ error: "초대한 회원 주소만" }, 400);
  const pu = memberPusher(c.env, e); if (!pu) return c.json({ error: "no" }, 404);
  return c.json({ email: e, fails: await pu.mFails(e) });
});
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
// 봉투 옮기기(worker/vault/migrate.ts) — 관리 토큰만. GET ?scope=&owner= = plan(쓰지 않음) · POST { action: run | back, scope, owner?, page?, dryRun? }
// owner = 그 DEK 주인만('' = 주인, 소문자 메일, x:<이름>) — 없으면 모두. 스위치는 그 owner 의 것(envelopeOn(env, owner), owner 없으면 모두 스위치):
// run 은 켜져 있을 때만(꺼진 채면 옮긴 뒤 새 쓰기가 봉해지지 않음), back 은 꺼져 있을 때만(켜진 채면 새 쓰기가 곧 다시 봉함). dryRun 은 늘 됨
const vscope = (s: unknown) => vmig.scopes().includes(String(s)) ? String(s) as vmig.Scope : null;   // 등록한 scope 만(공개 판엔 호스팅 전용 표가 없음)
const vowner = (o: unknown) => typeof o === "string" ? (o.startsWith("x:") ? o : o.trim().toLowerCase()) : undefined;
app.get("/api/admin/vault", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const scope = vscope(c.req.query("scope")); if (!scope) return c.json({ error: `scope = ${vmig.scopes().join(" · ")}` }, 400);
  const env = c.env as unknown as vmig.MEnv, owner = vowner(c.req.query("owner"));
  return c.json({ scope, owner: owner ?? null, envelope: await envelopeOn(env, owner ?? null), plan: await vmig.plan(env, scope, { owner }) }, 200, { "cache-control": "no-store" });
});
app.post("/api/admin/vault", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ action?: string; scope?: string; owner?: string; page?: number; dryRun?: boolean }>().catch(() => ({} as { action?: string; scope?: string; owner?: string; page?: number; dryRun?: boolean }));
  const scope = vscope(b.scope); if (!scope) return c.json({ error: `scope = ${vmig.scopes().join(" · ")}` }, 400);
  if (b.action !== "run" && b.action !== "back") return c.json({ error: "action = run · back" }, 400);
  const env = c.env as unknown as vmig.MEnv, owner = vowner(b.owner), on = await envelopeOn(env, owner ?? null);
  // codec 표(account = better-auth 토큰)는 봉투 스위치와 상관없음: 봉한 꼴 · 평문 둘 다 읽히니 언제 옮겨도 됨(되돌리기는 encryptOAuthTokens 를 끄기 전에)
  const gate = vmig.envelopeScope(scope);
  const sw = owner === undefined ? "envelope" : owner.startsWith("x:") ? "envelope(x: 주인은 모두 스위치)" : `envelope 또는 envelope:${owner || "owner"}`;
  if (gate && !b.dryRun && b.action === "run" && !on) return c.json({ error: `스위치 ${sw} 가 꺼져 있어요(DATA_KEK_CUR · f7_flag) — 켠 뒤 옮겨요` }, 409);
  if (gate && !b.dryRun && b.action === "back" && on) return c.json({ error: `스위치 ${sw} 가 켜져 있어요 — 끈 뒤 되돌려요` }, 409);
  const o = { page: Number(b.page) || undefined, dryRun: !!b.dryRun, owner };
  return c.json(b.action === "run" ? await vmig.run(env, scope, o) : await vmig.back(env, scope, o), 200, { "cache-control": "no-store" });
});
app.post("/api/admin/f7-flag", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ name?: string; on?: boolean; note?: string }>().catch(() => ({} as { name?: string; on?: boolean; note?: string }));
  if (/^envelope:/i.test(b.name || "")) b.name = b.name!.toLowerCase();
  if (!/^(read|write|shadow|member)_[a-z]{2,20}$/.test(b.name || "")
    && !/^envelope(:owner|:[^@\s:,]{1,64}@[^@\s:,]{1,190})?$/.test(b.name || "")) return c.json({ error: "name = read_|write_|shadow_|member_<묶음> · envelope · envelope:<메일 | owner>" }, 400);
  // e2e 판이 있는 사람의 envelope:<owner> 는 못 끔(vault adoptE2e 의 지킬 것 — 끄면 그 사람 쓰기가 봉해지지 않음)
  if (!b.on && /^envelope:/.test(b.name!)) {
    const who = b.name === "envelope:owner" ? "" : b.name!.slice("envelope:".length);
    if (await c.env.DB.prepare("SELECT 1 FROM dek WHERE owner = ? AND mode = 'e2e' LIMIT 1").bind(who).first()) return c.json({ error: "종단간(e2e) 판이 있는 사람은 envelope 스위치를 끌 수 없어요" }, 409);
  }
  await ledger.setFlag(c.env.DB, b.name!, !!b.on, String(b.note || "").slice(0, 200));
  if (/^envelope/.test(b.name!)) forgetFlags();
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
  if (await openedLastHour(db, d.owner) >= OPEN_PER_HOUR) return c.json({ ok: false, error: `한 시간에 ${OPEN_PER_HOUR}창까지예요` }, 429);   // 설정 「새 역할」(role-edit.ts)과 같은 한도
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
  const rules = b.rules ? Object.fromEntries(Object.entries(b.rules).filter(([k, v]) => k in RULES && (k === "one_goal" || k === "default_roles" ? typeof v === "boolean" : typeof v === "number" && v >= 1 && v <= 1440))) : null;
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
  const row = await c.env.DB.prepare("SELECT kind, auth, owner FROM connection WHERE id = ?").bind(id).first<{ kind: string; auth: string; owner: string }>();
  if (!row || row.kind !== "oauth" && row.kind !== "api") return c.json({ error: "OAuth 연결 없음" }, 404);   // api = 구글 로그인 API(캘린더 · Gmail)
  const ref = { tbl: "connection" as const, pk: id, col: "auth" as const };
  const a = await openSecret<{ refresh_token?: string; expires_at?: number }>(c.env, row.owner, ref, row.auth);
  if (!a.refresh_token) return c.json({ error: "갱신 토큰 없음" }, 422);
  const was = a.expires_at ?? null;
  const r = await c.env.DB.prepare("UPDATE connection SET auth = ?, updated_at = ? WHERE id = ? AND auth = ?").bind(await sealSecret(c.env, row.owner, ref, { ...a, expires_at: Date.now() - 1000 }), Date.now(), id, row.auth).run();
  if (!r.meta.changes) return c.json({ error: "그새 바뀜 — 다시" }, 409);
  return c.json({ ok: true, was });
});

mountHooks(app, async c => { const s = await signedIn(c as unknown as Context<{ Bindings: Env }>); return s ? { owner: allowed(c.env as unknown as Env, s.user.email) ? "" : s.user.email, email: s.user.email } : null; },
  async (env, _ctx, target, text) => { const r = await (boardTool(env as unknown as Env, "owner", "hook_wake", { target, text }, "boarder@worker") as Promise<{ delivered?: string }>); return String(r?.delivered || "woke"); });
mountConnectors(app, async c => { const s = await signedIn(c as unknown as Context<{ Bindings: Env }>); return s ? { owner: allowed(c.env as unknown as Env, s.user.email) ? "" : s.user.email, email: s.user.email } : null; });
mountSales(app as never, async c => { const s = await signedIn(c as unknown as Context<{ Bindings: Env }>); return s ? s.user.email.toLowerCase() : null; }, (c, email) => member(c.env as never, email));

mountTasks(app as never, async c => { const s = await signedIn(c as unknown as Context<{ Bindings: Env }>); return s ? s.user.email.toLowerCase() : null; }, memberBoard.paneOfId);

// 상태 페이지 켜기/끄기(설정 › 기능) — 주인 · 회원 둘 다, 자기 값만
mountFeatures(app as never, async c => { const s = await signedIn(c as unknown as Context<{ Bindings: Env }>); return s ? s.user.email.toLowerCase() : null; });
mountTaskBoard(app as never, {
  who: async c => { const s = await signedIn(c as unknown as Context<{ Bindings: Env }>); return s ? s.user.email.toLowerCase() : null; },
  device: async c => { const x = c as unknown as Context<{ Bindings: Env }>, d = await deviceOf(x); return d && (isOwner(x.env, d.owner) || await member(x.env, d.owner)) ? d : null; },
  nameOf: async (c, email) => (await (c.env.DB.prepare("SELECT name FROM \"user\" WHERE email = ?").bind(email).first<{ name: string }>()))?.name || "",
});
// 기기 세션 현황: 로그인한 사람의 기기만(주인은 그 메일 여럿 — 설정 › 기기와 같은 범위)
mountDevBoard(app as never, {
  who: async c => { const s = await signedIn(c as unknown as Context<{ Bindings: Env }>); return s ? s.user.email.toLowerCase() : null; },
  mails: (c, email) => ownerMails(c.env as unknown as Env, email),
});

app.post("/api/dev/ch", async c => {
  if (c.req.header("x-hb") !== "1" || !["same-origin", "none", undefined].includes(c.req.header("sec-fetch-site"))) return c.json({ error: "no" }, 403);
  const sd = await signedIn(c); if (!sd) return c.json({ error: "로그인" }, 401); if (!isOwner(c.env, sd.user.email)) return c.json({ error: "no" }, 403);
  const to = c.req.query("to") === "test" ? "test" : "owner";
  return c.json({ ch: to }, 200, { "set-cookie": `bx-ch=${to}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${to === "test" ? 3600 : 0}` });
});

let artKinds: { at: number; ch: string; kinds: Record<string, string> } | null = null;
async function isCanvas(env: Env, ch: string, id: string) { return (await artKind(env, ch, id)) === "canvas"; }
async function artKind(env: Env, ch: string, id: string): Promise<string> {
  if (ch === "owner" && await ledger.f7On(env.DB, "read_files")) { const ix = await files.index(env); if (ix) return ix.arts[id]?.kind || ""; }
  const age = artKinds && artKinds.ch === ch ? Date.now() - artKinds.at : Infinity;
  if (age > 60_000 || (age > 5_000 && !(id in artKinds!.kinds))) {
    const r = await boardCall(env, ch, { method: "GET", path: "/api/arts", headers: { accept: "application/json" } }).catch(() => null);
    let j: Record<string, { kind?: string }> | null = null;
    try { j = r?.status === 200 ? JSON.parse(new TextDecoder().decode(r.body)) : null; } catch { j = null; }
    if (j) artKinds = { at: Date.now(), ch, kinds: Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v?.kind || ""])) };
    else if (artKinds?.ch !== ch) return "";
  }
  return artKinds!.kinds[id] || "";
}

const PASS_REQ = ["accept", "content-type", "if-none-match", "x-hb", "range", "x-file-name", "x-request-id"];
const PASS_RES = ["x-retry-safe", "content-type", "content-encoding", "etag", "cache-control", "content-disposition", "last-modified", "content-range", "accept-ranges", "x-request-id"];
const ART_ROOT = /^\/art\/([A-Za-z0-9]{16,40})\/$/;
const ART_DEEP = /^\/art\/([A-Za-z0-9]{16,40})\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/){1,4}[A-Za-z0-9_-][^/?#]*\.(?:html|js|css|json|png|jpe?g|webp|gif|avif|svg|woff2?)$/;   // 마디 첫 글자는 점이 아님(.. 막음)
const edgeCache = () => (caches as unknown as { default: Cache }).default;   // Workers 입구 캐시(DOM 타입엔 없음)
const ART_FILE = /^\/art\/([A-Za-z0-9]{16,40})\/(?:project\/)?(?:canvas\.json|[^/?#]+\.(?:html|js|css|png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|m4v|mp3|m4a|wav|ogg)|_assets\/[A-Za-z0-9_-]{1,80}\.(?:png|jpe?g|webp|gif|avif|svg))$/;
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

const ART_CSP = "sandbox allow-scripts allow-popups allow-downloads; form-action 'none'";
async function memberArt(c: Context<{ Bindings: Env }>, mk: string, id: string, rel: string, tok?: string, self?: () => Promise<string>) {
  const f = await memberCanvas.file(c.env as never, mk, id, rel, c.req.header("range")); if (!f) return null;
  const h = new Headers({ "content-type": f.ct, "x-content-type-options": "nosniff", "content-security-policy": ART_CSP, "cache-control": "private, no-store", "x-boarder-src": "member", ...f.extra });
  if (tok) h.set("access-control-allow-origin", "*");
  if (c.req.method === "HEAD") return new Response(null, { status: f.status || 200, headers: h });
  let body = f.body;
  if (f.shell && self && body instanceof Uint8Array) {
    const name = await self().catch(() => "");
    if (name) body = new TextEncoder().encode(new TextDecoder().decode(body).replace(/<head(?:\s[^>]*)?>/i, m => `${m}<script>window.HB_SELF=${JSON.stringify(name.slice(0, 40)).replace(/</g, "\\u003c")}</script>`));   // <head> 안에(문서 앞에 두면 quirks)
  }
  const stream = () => body instanceof Uint8Array ? new Response(body as unknown as BodyInit).body! : body;
  if (f.html) return new Response(artTagHtml(id, tok || await memberCanvas.token(c.env.BETTER_AUTH_SECRET, mk, id), stream()), { status: 200, headers: h });
  return new Response(stream(), { status: f.status || 200, headers: h });
}

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

async function filesFirst(c: Context<{ Bindings: Env }>, path: string, headers: Record<string, string>, anon = false): Promise<files.Out | null> {
  const p = path.split("?")[0];
  if (chOf(c) !== "owner" || !files.FILE_PATH.test(p) || (files.isJsonPath(p) && cookieOf(c, "bx_w") && !(await ledger.f7On(c.env.DB, "write_art")))) return null;   // write_art 면 D1 이 정본이라 방금 쓴 사람도 D1
  if (!(await ledger.f7On(c.env.DB, "read_files"))) return null;
  const t = Date.now();
  try { const o = await files.answer(c.env, path, headers, anon); return o ? { ...o, src: "r2" } : null; }
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
    if ((c.req.header("if-none-match") || "").replace(/^W\//, "") === e.etag) return new Response(null, { status: 304, headers: { etag: e.etag } });
    return new Response(e.body, { headers: { "content-type": "application/json; charset=utf-8", etag: e.etag, "x-f7": "snap" } });
  }
  if (p === "/api/drafts") { const d = await OS.get(c.env.DB, "drafts").catch(() => null); if (d) return j(d.v); }
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
let bxShell: { head: string; body: string; eaHead: string; eaBody: string; xHead: string; xBody: string; shas: string[] } | null = null;
async function shellTags(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
  if (!bxShell) {
    const shas: string[] = [], put = (sha: string, b: bxs.Block) => { shas.push(sha); bxPut(sha, b); }, esc = (s: string) => s.replace(/<\//g, "<\\/");
    const t = await Promise.all([bxs.pack([{ kind: "css", body: shellCss, id: "hbx-css" }, { kind: "css", body: settingsCss, id: "hbx-set-css" }, { kind: "css", body: statusCss, id: "hbx-st-css" }], put),
      bxs.pack([{ kind: "js", body: esc(shellJs) }, { kind: "js", body: esc(botPickJs) }, { kind: "js", body: esc(settingsJs) }, { kind: "js", body: esc(statusJs) }], put),
      bxs.pack([{ kind: "css", body: eaCss, id: "hbx-ea-css" }], put), bxs.pack([{ kind: "js", body: esc(eaJs) }, { kind: "js", body: esc(eaSecretJs) }], put),
      bxs.pack([{ kind: "css", body: xCss, id: "hbx-x-css" }], put), bxs.pack([{ kind: "js", body: esc(xJs) }], put)]).catch(() => null);   // 비서(/es) 덩어리는 따로 — / 몸통 바이트 그대로
    if (!t) return null;
    bxShell = { head: t[0], body: t[1], eaHead: t[2], eaBody: t[3], xHead: t[4], xBody: t[5], shas };
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
async function memberPage(c: Context<{ Bindings: Env }>, me: string, name: string | null | undefined, bot: Bot, ea: boolean | "x" = false) {
  const pg = await snap(c.env).get("page"); if (!pg) return null;   // 틀(코드만, 주인 데이터 없음 — page-template.py)이 아직 없으면 503 한 줄
  await memberBoard.fresh(c.env, me).catch(e => console.error("묶기", e));
  const d = JSON.stringify(await memberBoard.data(c.env.DB, me, bot, await memberBoard.loadShared(c.env.DB, me, c.executionCtx))), tag = await memberBoard.etag(d);
  const html = (await tplHtml(c.env, c.executionCtx, pg)).replace("__BX_DATA__", () => d.replace(/<\//g, "<\\/")).replace('"__BX_DTAG__"', () => JSON.stringify(tag));
  // 회원 값: 채널은 Primary 하나(보드 CH) · 내 이름 · 메인 봇 이름. 영역 칸이 하나라 트리 줄을 한 칸으로
  const member = `<script>window.HB_CH = ["primary"]; window.HB_MEMBER = ${JSON.stringify({ email: me, name: String(name || me.split("@")[0]).slice(0, 40), bot: bot.name, avatar: await memberBoard.myAvatar(c.env.DB, me).catch(() => null), push: await ledger.f7On(c.env.DB, "member_push").catch(() => false), unit: await c.env.DB.prepare("SELECT json_extract(data, '$.unit') u FROM node_setting WHERE owner = ? AND json_valid(data)").bind(me).first<{ u: string | null }>().then(r => r?.u === "agent" || r?.u === "goal" ? r.u : null).catch(() => null) }).replace(/</g, "\\u003c")}</script><style id="hbm-css">.areas{grid-template-columns:minmax(0,320px)!important;justify-content:center}</style>`;
  const res = new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "frame-ancestors 'self'", "x-frame-options": "SAMEORIGIN", "x-boarder-src": "member" } });
  return boardShell(c, res, me, member, await ledger.f7On(c.env.DB, "write_queue"), ea);
}
// 회원 쓰기: 보드 몸통을 회원 길(/api/me/*)로 바꿔 같은 앱에 다시 부름(같은 쿠키 · 같은 문 검사) — 답은 보드 꼴(rid · state ok)
async function memberPost(c: Context<{ Bindings: Env }>, me: string, url: URL) {
  if (!sameSite(c)) return c.json({ ok: false, error: "forbidden" }, 403);
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ ok: false, error: "bad json" }, 400);
  if (url.pathname === "/api/artnote" || url.pathname === "/api/artfolder" || url.pathname === "/api/artstar" || url.pathname === "/api/artthumb") {
    let r: [number, object]; const rid = queue.ridOfBody(b);
    const fn = { "/api/artnote": memberCanvas.artnote, "/api/artfolder": memberCanvas.artfolder, "/api/artstar": memberCanvas.artstar, "/api/artthumb": memberCanvas.artthumb }[url.pathname] as (e: never, m: string, b: Record<string, unknown>, r: string) => Promise<[number, object]>;
    try { r = await fn(c.env as never, me, b, rid); }
    catch { return rid ? queue.retrySafe(c) : c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503); }   // rid 가 있으면 다시 보내도 한 번 — 없으면 됐을 수도 있어 다시 보내기 표시 없음(주인과 같음)
    return c.json(r[1], r[0] as 200);
  }
  try { const mi = await memberInbox.route(c as never, me, url, b); if (mi) return mi; } catch { return queue.retrySafe(c); }   // 반응 · 고치기 · 읽음 · 모아 보기 · 초안(member-inbox.ts)
  // 파일 붙은 글: 창이 받아 갈 서명 링크 줄(「📎 이름: 링크」)을 글 끝에 붙여 보냄 — 내 파일만(member-files.ts)
  if (url.pathname === "/api/chat" && Array.isArray(b.files) && b.files.length && !b.delete && !b.react && b.edit === undefined) {
    const f = await memberFiles.fileLines(c.env, me, c.env.PUBLIC_URL || url.origin, b.files as unknown[]);
    if (!f.lines.length) return c.json({ ok: false, error: "파일을 찾지 못했어요" }, 400);
    b.text = [String(b.text || "").trim(), ...f.lines].filter(Boolean).join("\n"); delete b.files;
  }
  const rid = String(b.rid || "").slice(0, 64);
  let hop: Awaited<ReturnType<typeof memberBoard.post>>;
  try { hop = await memberBoard.post(c.env.DB, me, url.pathname, b); } catch { return queue.retrySafe(c); }   // 읽기만(쓰기 전) — D1 실패는 다시 보내도 됨
  if ("error" in hop) return c.json({ ok: false, error: hop.error }, hop.status as 400);
  if ("ok" in hop) return c.json({ rid, ...hop.ok });
  const qrid = hop.log ? queue.ridOfBody(b) : "";
  if (qrid) { try { if (await queue.ridSeen(c.env.DB, qrid)) return c.json({ ok: true, rid, state: "ok", channel: "primary", already: true }); } catch { return queue.retrySafe(c); } }
  let body = hop.body as Record<string, unknown>, pre: { id: number; at: number; again?: boolean } | null = null;
  if (hop.log && !hop.log.thread && typeof hop.log.ch === "string" && boardHead({ channel: hop.log.ch }) !== boardHead({})) {
    const at = Date.now(), lg = hop.log, tag = qrid ? `rid:${qrid}` : null;
    try {
      const old = tag ? await c.env.DB.prepare("SELECT id, at FROM board_log WHERE owner = ? AND kind = 'me' AND wid = ? AND at > ? LIMIT 1").bind(me, tag, at - 86_400_000).first<{ id: number; at: number }>() : null;
      if (old) pre = { id: old.id, at: old.at, again: true };
      else { const row = await c.env.DB.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?) RETURNING id").bind(me, lg.win.slice(0, 120), "me", lg.text.slice(0, 4000), null, at, tag).first<{ id: number }>(); pre = row ? { id: row.id, at } : null; }
    } catch { return queue.retrySafe(c); }   // 아직 아무것도 안 넘김 — 다시 보내도 됨
    if (pre) { const head = boardHead({ channel: lg.ch, thread: memberBoard.tsOf(pre.at, pre.id) }); body = "head" in body ? { ...body, head } : { ...body, text: withHead(head, lg.text) };
      if (hop.path === "/api/me/tasks/assign") body.thread = memberBoard.tsOf(pre.at, pre.id); }   // 업무 노드 배정(④): 맨 위 글도 스레드 = 그 글 — 배정기 세션이 그 스레드에 답
  }
  const unpre = async () => { if (!pre) return;
    await c.env.DB.prepare("DELETE FROM board_log WHERE id = ? AND owner = ?").bind(pre.id, me).run().catch(e => console.error("노드 채팅 줄 지우기", e));
    await dropRef(c.env.DB, me, "board_log:" + pre.id).catch(e => console.error("태스크 대화 지우기", e)); };   // 그 사이 화면이 읽어 태스크 대화 표에 들어갔을 수 있음
  const h = new Headers({ "content-type": "application/json", "x-hb": "1", cookie: c.req.header("cookie") || "" });
  const sf = c.req.header("sec-fetch-site"); if (sf) h.set("sec-fetch-site", sf);
  const r = await app.fetch(new Request(new URL(hop.path, url), { method: "POST", headers: h, body: JSON.stringify({ ...body, ...(rid ? { rid } : {}) }) }), c.env, c.executionCtx);   // rid 도 넘김(안쪽 쓰기가 한 번만) — 던지면 줄은 남김(들어갔을 수 있음)
  const j = await r.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (!r.ok || j.ok === false) {
    if (r.status < 500 && j.error !== "엔진 답 없음") await unpre();
    return c.json({ ok: false, rid, error: typeof j.error === "string" ? j.error : "일시적인 오류가 발생했어요" }, (r.ok ? 400 : r.status) as 400, r.headers.get("x-retry-safe") === "1" ? { "x-retry-safe": "1" } : {});
  }
  const wid = Array.isArray(j.cmds) && j.cmds[0] ? `cmd:${j.cmds[0]}` : null;
  if (hop.log && pre) {
    if (j.already && !pre.again) await unpre();   // 안쪽이 「이미 됨」 = 앞 요청의 줄이 따로 있음 — 방금 넣은 줄만 지움
    else if (!j.already) {
      const upd = () => c.env.DB.prepare("UPDATE board_log SET wid = ? WHERE id = ? AND owner = ?").bind(wid, pre!.id, me);
      const won = await queue.ridBatch(c.env.DB, qrid, [upd()]).catch(e => { console.error("노드 채팅 줄", e); return true; });
      if (!won) await upd().run().catch(e => console.error("노드 채팅 줄", e));
    }
  } else if (hop.log && !j.already) await queue.ridBatch(c.env.DB, qrid, [c.env.DB.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").bind(me, hop.log.win.slice(0, 120), "me", hop.log.text.slice(0, 4000), hop.log.thread ?? null, Date.now(), wid)]).catch(e => console.error("노드 채팅 줄", e));
  return c.json({ ...j, ok: true, rid, state: "ok", channel: "primary", ...(pre ? { ts: memberBoard.tsOf(pre.at, pre.id) } : {}) });
}
async function boardShell(c: Context<{ Bindings: Env }>, res: Response, email: string, member = "", q = false, ea: boolean | "personal" | "x" = false) {
  // 큰 껍데기 css · js 는 /bxs 주소로(bxs.ts — 같은 차례, 고전 스크립트). 해시를 못 만들면 예전처럼 인라인
  const bx = await shellTags(c.env, c.executionCtx).catch(() => null);
  // 사람별 덧씌우기: 지금 로그인한 사람 것만. ?no_overlay=1 이면 얹지 않음(깨졌을 때 꺼내는 길). 읽기 실패는 덧씌우기 없이 그대로 그림
  const ov = new URL(c.req.url).searchParams.has("no_overlay") ? null : pc.overlayTags(await pc.readOverlay(c.env.DB, email.toLowerCase()).catch(() => null));
  const emb = new URL(c.req.url).searchParams.has("embed");
  return new HTMLRewriter()
      .on('meta[name="apple-mobile-web-app-title"]', { element: e => { e.setAttribute("content", "보더"); } })
      .on("head", { element: async e => { if (member) e.prepend(member, { html: true }); e.prepend(`<script>window.BX_Q = ${q ? 1 : 0}; window.BX_FLAGS_OFF = ${JSON.stringify(String((c.env as unknown as { FLAGS_OFF?: string }).FLAGS_OFF || "").split(",").map(x => x.trim()).filter(Boolean))}</script>`, { html: true }); e.prepend("<script>window.HB_HASH0 = location.hash; if (!/^#(chat|art\\/|arts|node\\/|tree|w\\/|inbox|unread|saved|drafts|timeline|nf|settings|t=|board)/.test(location.hash) && location.pathname && location.pathname !== '/') { var hp = location.pathname, hq = new URLSearchParams(location.search), hm; if (hp === '/nodes') HB_HASH0 = '#tree'; else if (hm = /^\\/nodes\\/([^/]+)$/.exec(hp)) HB_HASH0 = '#node/' + hm[1] + (/^\\d{10}\\.\\d{6}$/.test(hq.get('thread') || '') ? '/' + hq.get('thread') : ''); else if (hm = /^\\/canvas\\/([A-Za-z0-9]{16,40})$/.exec(hp)) HB_HASH0 = '#art/' + hm[1]; else if (hp === '/canvas') HB_HASH0 = '#arts'; else if (hm = /^\\/chat\\/([^/]+)(?:\\/([^/]+))?$/.exec(hp)) HB_HASH0 = '#chat/' + hm[1] + (hm[2] ? (hq.get('thread') ? '/' + hq.get('thread') + '/' + hm[2] : '/' + hm[2]) : ''); else if (hp === '/unread' && /^\\d{10}\\.\\d{6}$/.test(hq.get('msg') || '')) HB_HASH0 = '#unread?msg=' + hq.get('msg'); else if (hm = /^\\/(inbox|unread|saved|drafts|timeline|nf|w\\/.+|settings(?:\\/.*)?)$/.exec(hp)) HB_HASH0 = '#' + hm[1]; } document.documentElement.classList.add('bx-boot'); setTimeout(function(){ document.documentElement.classList.remove('bx-boot') }, 4000); if (/^#(chat\\/|art\\/|node\\/|w\\/|inbox$|unread(\\?msg=\\d{10}\\.\\d{6})?$|saved$|drafts$|settings(\\/|$|\\?))/.test(window.HB_HASH0)) { document.documentElement.classList.add('bx-route'); setTimeout(function(){ document.documentElement.classList.remove('bx-route') }, 35000) }</script>", { html: true });
        e.prepend(`<script>window.HBR=window.HBR||{hash:function(){return location.hash},same:function(a,b){return a===b},go:function(h){location.hash=h},toHash:function(){return ''},toPath:function(){return null},isApp:function(){return false},url:function(h){return location.origin+'/'+h}}</script>`, { html: true });
        if (!ea && !emb) e.prepend(`<base href="/"><script>window.HB_PATHS=1</script>`, { html: true });
        const pg0 = ({ "/task-status": "tasks", "/device-sessions": "devices" } as Record<string, string>)[new URL(c.req.url).pathname.replace(/^(\/task-status)\/[\w.-]{1,40}$/, "$1").replace(/\/$/, "")];   // /task-status/<요청 id> = 그 요청 세부
        if (pg0) e.prepend(`<script>window.BX_PG0 = "${pg0}"; window.BX_PG0_PATH = ${JSON.stringify(new URL(c.req.url).pathname)}</script>`, { html: true });   // 경로는 위 꼴(글자 · 숫자 · . _ -)만 지난 것   // 상태 페이지 주소로 열림(status.js) — 보드 첫 그리기가 주소를 /nodes 로 바꾸기 전에 남겨 둠
        if (ea === "x") e.prepend(`<script>window.BX_X=1</script>`, { html: true });   // /x = 피드 화면(x.js 가 같은 몸통 위에 피드 · 유리 막대를 얹음)
        else if (ea) e.prepend(`<script>window.BX_EA=1${ea === "personal" ? ';window.BX_EA_MODE="personal"' : ""}</script>`, { html: true });
        e.append(`<style>html.bx-boot body{visibility:hidden}</style>` + (bx ? bx.head : `<style id="hbx-css">${shellCss}</style><style id="hbx-set-css">${settingsCss}</style><style id="hbx-st-css">${statusCss}</style>`) + (ea === "x" ? (bx ? bx.xHead : `<style id="hbx-x-css">${xCss}</style>`) : ea ? (bx ? bx.eaHead : `<style id="hbx-ea-css">${eaCss}</style>`) : "") + snippet(c.env, await phId(c.env, email)) + (ov?.head || ""), { html: true }); } })
      .on("body", { element: e => { e.append((bx ? bx.body : `<script>${shellJs.replace(/<\//g, "<\\/")}</script><script>${botPickJs.replace(/<\//g, "<\\/")}</script><script>${settingsJs.replace(/<\//g, "<\\/")}</script><script>${statusJs.replace(/<\//g, "<\\/")}</script>`) + (ea === "x" ? (bx ? bx.xBody : `<script>${xJs.replace(/<\//g, "<\\/")}</script>`) : ea ? (bx ? bx.eaBody : `<script>${eaJs.replace(/<\//g, "<\\/")}</script><script>${eaSecretJs.replace(/<\//g, "<\\/")}</script>`) : "") + `<script>document.documentElement.classList.remove('bx-boot')</script>` + (ov?.body || ""), { html: true }); } })
    .transform(res);
}
app.all("*", async c => {
  let url = new URL(c.req.url);
  if ((c.req.method === "GET" || c.req.method === "HEAD") && APP_PATH.test(url.pathname)) url = new URL("/", url);   // 보더 화면 경로 = 같은 보드(주소창은 그대로 — ?thread= 같은 물음 글은 화면이 읽음)
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
      if (url.pathname.startsWith("/art/")) return new Response(files.SUPPORT_JS, { headers: { "content-type": "text/javascript", "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "cache-control": "private, max-age=86400" } });
      const fr = await filesFirst(c, url.pathname, {}, true);
      const t1 = Date.now(), r = fr ?? await boardCall(c.env, "owner", { method: "GET", path: url.pathname, headers: { "accept-encoding": "gzip" } }); if (!fr) { bridgeSeg(c.req.raw, Date.now() - t1, r.headers); filesShadow(c, url.pathname, {}, r, "anon"); }
      const h = new Headers({ "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "cache-control": r.status === 200 ? "private, max-age=86400" : "no-store" });
      for (const k of ["content-type", "content-encoding", "etag"]) if (r.headers[k]) h.set(k, r.headers[k]);
      if (fr) fromR2(h);
      return new Response(r.body as unknown as BodyInit, { status: r.status, headers: h, ...(h.get("content-encoding") ? { encodeBody: "manual" as const } : {}) });
    } catch { return c.json({ error: "일시적인 오류가 발생했어요" }, 503); }
  }
  const bxts = url.searchParams.getAll("bxt");
  if ((c.req.method === "GET" || c.req.method === "HEAD") && bxts.length && bxts.every(t => t.startsWith("m."))) {
    const pa = memberCanvas.parseArt(url.pathname), t = url.searchParams.get("bxt")!;
    const mk = pa && !pa.bare ? await memberCanvas.tokenOk(c.env.BETTER_AUTH_SECRET, pa.id, t) : null;
    const r = mk ? await memberArt(c, mk, pa!.id, pa!.rel, t).catch(() => undefined) : null;
    if (r === undefined) return c.json({ error: "일시적인 오류가 발생했어요" }, 503);
    return r ?? c.text("not found", 404, { "cache-control": "no-store" });
  }
  let aj = c.req.method === "GET" && url.searchParams.has("bxt") && !/%2f|%5c/i.test(url.pathname) ? ART_FILE.exec(url.pathname) || ART_ROOT.exec(url.pathname) : null;
  if (!aj && c.req.method === "GET" && url.searchParams.has("bxt") && !/%2f|%5c/i.test(url.pathname)) { const d = ART_DEEP.exec(url.pathname); if (d) { const k = await artKind(c.env, chOf(c), d[1]); if (k === "page" || (k === "canvas" && /\.(?:png|jpe?g|webp|gif|avif|svg|woff2?)$/i.test(url.pathname))) aj = d; } }
  if (aj && await artOk(c.env, aj[1], url.searchParams.get("bxt"))) {
    try {
      const rg = c.req.header("range"), fh: Record<string, string> = { accept: c.req.header("accept") || "*/*", "accept-encoding": "gzip", ...(rg ? { range: rg } : {}) }, fr = await filesFirst(c, url.pathname, fh);
      const t1 = Date.now(), r = fr ?? await boardCall(c.env, chOf(c), { method: "GET", path: url.pathname, headers: fh }); if (!fr) { bridgeSeg(c.req.raw, Date.now() - t1, r.headers); filesShadow(c, url.pathname, fh, r, "anon"); }
      const h = new Headers({ "access-control-allow-origin": "*", "x-content-type-options": "nosniff", "content-security-policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads", "cache-control": "private, no-store" });
      for (const k of ["content-type", "content-encoding", "content-range", "accept-ranges"]) if (r.headers[k]) h.set(k, r.headers[k]);
      if (fr) fromR2(h);
      if (r.status === 200 && (url.pathname.endsWith(".html") || (url.pathname.endsWith("/") && (r.headers["content-type"] || "").includes("text/html")))) {
        let b = new Response(r.body as unknown as BodyInit).body!;
        if (h.get("content-encoding") === "gzip") { b = b.pipeThrough(new DecompressionStream("gzip")); h.delete("content-encoding"); }
        h.delete("content-length");
        return new Response(artTagHtml(aj[1], url.searchParams.get("bxt")!, b), { status: 200, headers: h });
      }
      return new Response(r.body as unknown as BodyInit, { status: r.status, headers: h, ...(h.get("content-encoding") ? { encodeBody: "manual" as const } : {}) });
    } catch { return c.json({ error: "일시적인 오류가 발생했어요" }, 503); }
  }
  // 비서(/es): 보드 스크립트가 상대 주소(api/… · art/…)를 써서 /ea/ 면 깨짐 — 끝 「/」 없는 주소로
  if ((url.pathname === "/x" || url.pathname === "/x/") && (c.req.method === "GET" || c.req.method === "HEAD")) return c.redirect("/feed" + url.search, 301);
  if ((url.pathname === "/es/" || url.pathname === "/ea/" || url.pathname === "/feed/") && (c.req.method === "GET" || c.req.method === "HEAD")) return c.redirect(url.pathname.slice(0, -1) + url.search, 301);
  const s = await signedIn(c);
  if (!s) {
    if (url.pathname.startsWith("/api/")) return c.json({ error: "로그인" }, 401);
    if (url.pathname === "/" && (c.req.method === "GET" || c.req.method === "HEAD"))
      return c.html(landingPage(c.env.PUBLIC_URL, snippet(c.env), undefined, undefined, c.env.SOURCE_URL), 200, { ...NOFRAME, "cache-control": "private, no-cache", vary: "cookie" });
    const page = await c.env.ASSETS.fetch(new Request(new URL("/", url), c.req.raw));   // 로그인 화면(React)에도 PostHog
    return new HTMLRewriter().on("head", { element: e => { e.append(snippet(c.env), { html: true }); } }).transform(page);
  }
  if (url.pathname === "/login" && c.req.method === "GET") return c.redirect("/", 302);   // 이미 들어온 사람이 랜딩의 「로그인」을 누르면 보드로
  if ((url.pathname === "/device" || url.pathname === "/sales" || url.pathname === "/tasks") && c.req.method === "GET") {
    const page = await c.env.ASSETS.fetch(new Request(new URL("/", url), c.req.raw)), h = new Headers(page.headers);
    for (const [k, v] of Object.entries(NOFRAME)) h.set(k, v);
    return new Response(page.body, { status: 200, headers: h });
  }
  if (!isOwner(c.env, s.user.email)) {
    if (/^\/(assets|icons)\//.test(url.pathname)) return c.env.ASSETS.fetch(c.req.raw);
    if (url.pathname === "/ea" && c.req.method === "GET") return c.redirect("/es" + url.search, 302);
    if ((url.pathname === "/" || url.pathname === "/es" || url.pathname === "/feed") && c.req.method === "GET") {
      const bot = await memberBot(c.env, s.user.email.toLowerCase()), js = { blob: blobJs, pick: botPickJs };
      if (!bot) return c.html(memberOnboard(s.user.email, js), 200, { ...NOFRAME, "cache-control": "no-store" });
      const pg = await memberPage(c, s.user.email.toLowerCase(), (await c.env.DB.prepare("SELECT name FROM \"user\" WHERE email = ?").bind(s.user.email).first<{ name: string }>().catch(() => null))?.name, bot, url.pathname === "/feed" ? "x" : url.pathname === "/es");
      return pg ?? c.html("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><p style='font:15px system-ui;padding:40px'>일시적인 오류가 발생했어요</p>", 503, { ...NOFRAME, "cache-control": "no-store", "retry-after": "5" });
    }
    {
      const me = s.user.email.toLowerCase();
      if (url.pathname === "/api/events" || url.pathname === "/api/push/stream") return c.json({ error: "다리 밖" }, 503);   // 주인과 같게: 화면이 20초 폴링으로
      // 회원 웹 푸시(member_push 켜짐): 주인과 같은 /sw.js · /api/push/* 꼴 — 그 사람 칸(memberPusher)에만. 꺼지면 아래 빈 키(화면이 푸시를 조용히 끔) 그대로
      if ((url.pathname.startsWith("/api/push/") || url.pathname === "/sw.js") && await ledger.f7On(c.env.DB, "member_push")) return memberPushRoute(c, me, url);
      if (c.req.method === "GET" || c.req.method === "HEAD") {
        const ans = /^\/api\/answer\/([\w-]{1,64})$/.exec(url.pathname);
        if (ans) {   // 그 rid 의 쓰기가 됐는지(rid 칸) — 늘 ok 이던 것(X1)
          if (!(await ledger.f7On(c.env.DB, "write_queue"))) return c.json({ ok: true, state: "ok" });   // rid 칸이 없으면 예전처럼
          try { const a = await queue.answerOf(c.env, me, ans[1]); return a ? c.json({ ok: true, ...a }, 200, { "cache-control": "no-store" }) : c.json({ state: "unknown" }, 404, { "cache-control": "no-store" }); }
          catch { return queue.retrySafe(c); }   // rid 칸을 못 부름 = 모름(화면은 같은 rid 로)
        }
        const fm = /^\/api\/file\/([0-9a-f]{32})$/.exec(url.pathname); if (fm) return memberFiles.fileGet(c as never, me, fm[1], url.searchParams.has("dl"));
        if (url.pathname === "/api/voice/modes") return c.json(await memberVoice.modes(c.env.DB, me, url.searchParams.get("pane") || ""), 200, { "cache-control": "no-store" });
        const ao = /^\/api\/artowner\/([A-Za-z0-9]{16,40})$/.exec(url.pathname);
        if (ao) return c.json(await memberVoice.artOwner(c.env as never, me, ao[1]).catch(() => ({})), 200, { "cache-control": "no-store" });
        const vp = /^\/api\/voice\/rtc\/poll\/([\w.-]{1,110})$/.exec(url.pathname);
        if (vp) { const [st, o] = await memberVoice.poll(c.env as never, me, vp[1]); return c.json(o, st as 200, { "cache-control": "no-store" }); }
        const mi = await memberInbox.route(c as never, me, url); if (mi) return mi;
        if (url.pathname === "/api/arts") return c.json(await memberCanvas.list(c.env, me), 200, { "cache-control": "no-store" });
        const pa = url.pathname.startsWith("/art/") ? memberCanvas.parseArt(url.pathname) : null;
        if (pa?.bare) return c.redirect(`/art/${pa.id}/`, 302);
        const an = /^\/api\/artnotes\/([A-Za-z0-9]{16,40})$/.exec(url.pathname);
        if (an) { try { const [st, o] = await memberCanvas.artnotes(c.env as never, me, an[1]); return c.json(o, st as 200, { "cache-control": "no-store" }); } catch { return queue.retrySafe(c); } }
        if (pa) { const r = await memberArt(c, await memberCanvas.keyOf(me), pa.id, pa.rel, undefined,
          async () => (await c.env.DB.prepare("SELECT name FROM \"user\" WHERE email = ?").bind(s.user.email).first<{ name: string }>())?.name || "");
          if (r && r.status === 200 && !pa.rel && artView.viewable(c.req.method, c.req.header("sec-fetch-dest"), url.search)) c.executionCtx.waitUntil(artView.record(c.env.DB, me, pa.id).catch(e => console.error("열람 기록", e)));
          if (r) return r; }
        if (url.pathname.startsWith("/art/")) return docNav(c, url) ? c.redirect("/nf", 302) : c.text("not found", 404, { "cache-control": "no-store" });
        if (url.pathname === "/api/data") { if (!memberBoard.dataGate(me)) return queue.retrySafe(c); await memberBoard.fresh(c.env, me).catch(e => console.error("묶기", e)); }
        const sl = await slackImport.get(c.env as never, me, url);   // Slack 채널 노드(sl_…)의 노드 채팅 · 스레드
        if (sl) return sl;
        const r = await memberBoard.get(c.env.DB, me, await memberBot(c.env, me), url, () => snap(c.env).get("emoji"), c.req.header("if-none-match"),
          async () => (await c.env.DB.prepare("SELECT name FROM \"user\" WHERE email = ?").bind(s.user.email).first<{ name: string }>())?.name, c.executionCtx,
          () => live.liveOf(c.env, me).tags().then(x => JSON.stringify([(x as { boot?: string }).boot ?? "", x.t.data ?? "", x.t.chat ?? ""])));
        if (r) return r;
      }
      if (c.req.method === "POST" && (url.pathname === "/api/upload" || url.pathname === "/api/voice/stt")) {   // 몸통이 파일 · 녹음(JSON 아님) — 회원 쓰기와 같은 문
        if (!sameSite(c)) return c.json({ ok: false, error: "forbidden" }, 403);
        return url.pathname === "/api/upload" ? memberFiles.upload(c as never, me) : memberFiles.stt(c as never, me);
      }
      if (c.req.method === "POST" && /^\/api\/voice\/(rtc\/(start|stop|note)|end)$/.test(url.pathname)) {   // 통화 — 내 엔진 기기에서만(member-voice.ts)
        if (!sameSite(c)) return c.json({ ok: false, error: "forbidden" }, 403);
        const b = await c.req.json<Record<string, unknown>>().catch(() => null);
        if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ ok: false, error: "bad json" }, 400);
        const mainName = (await memberBot(c.env, me).catch(() => null))?.name || "Primary";
        const [st, o] = url.pathname === "/api/voice/rtc/start" ? await memberVoice.start(c.env as never, me, b, mainName) : url.pathname === "/api/voice/rtc/stop" ? await memberVoice.stop(c.env as never, me, b)
          : url.pathname === "/api/voice/rtc/note" ? await memberVoice.note(c.env as never, me, b) : await memberVoice.end(c.env.DB, me, b);
        return c.json(o, st as 200);
      }
      if (c.req.method === "POST") return memberPost(c, me, url);
    }
    if (docNav(c, url)) return c.redirect("/nf", 302);
    return c.json({ error: "no" }, 403);
  }
  // 비서(/es, 주인): / 와 같은 길(첫 화면 · 틀 · 캐시 지우기)로 — 받는 path 만 「/」, 틀에 BX_EA 를 더 얹음
  const ea = (url.pathname === "/es" || url.pathname === "/ea" || url.pathname === "/feed") && (c.req.method === "GET" || c.req.method === "HEAD") ? (url.pathname === "/ea" ? "personal" as const : url.pathname === "/feed" ? "x" as const : true) : false;   // /x = 피드 화면   // /ea = 퍼스널 비서
  if (ea) url.pathname = "/";
  if (url.pathname === "/api/events" || url.pathname === "/api/push/stream") return c.json({ error: "다리 밖" }, 503);
  if (chOf(c) === "owner" && (url.pathname.startsWith("/api/push/") || url.pathname === "/sw.js") && await ledger.f7On(c.env.DB, "write_push")) return pushRoute(c, url);
  const ee = await hosted.route?.(c, url, chOf(c), { req: PASS_REQ, res: PASS_RES }, (k, ms) => seg(c.req.raw, k, ms));
  if (ee) return ee;
  if (!["GET", "HEAD", "POST"].includes(c.req.method)) return c.json({ error: "안 되는 방법" }, 405);
  {
    const me = s.user.email.toLowerCase();
    if (c.req.method === "POST" && (url.pathname === "/api/upload" || url.pathname === "/api/voice/stt")) {
      if (!sameSite(c)) return c.json({ ok: false, error: "forbidden" }, 403);
      return url.pathname === "/api/upload" ? memberFiles.upload(c as never, me) : memberFiles.stt(c as never, me);
    }
    const fm = c.req.method === "GET" || c.req.method === "HEAD" ? /^\/api\/file\/([0-9a-f]{32})$/.exec(url.pathname) : null;
    if (fm) return memberFiles.fileGet(c as never, me, fm[1], url.searchParams.has("dl"));
  }
  // 파일 붙은 글: 회원과 같이 서명 링크 줄(「📎 이름: 링크」)을 글 끝에 붙여 다리로(창이 링크로 받아 감)
  let sent: Uint8Array | undefined;
  if (c.req.method === "POST" && url.pathname === "/api/chat" && (c.req.header("content-type") || "").includes("json")) {
    sent = new Uint8Array(await c.req.arrayBuffer()); let b: Record<string, unknown> | null = null;
    try { b = JSON.parse(new TextDecoder().decode(sent)); } catch {}
    if (b && typeof b === "object" && Array.isArray(b.files) && b.files.length && !b.delete && !b.react && b.edit === undefined) {
      const f = await memberFiles.fileLines(c.env, s.user.email.toLowerCase(), c.env.PUBLIC_URL || url.origin, b.files as unknown[]);
      if (!f.lines.length) return c.json({ ok: false, error: "파일을 찾지 못했어요" }, 400);
      b.text = [String(b.text || "").trim(), ...f.lines].filter(Boolean).join("\n"); delete b.files;
      sent = new TextEncoder().encode(JSON.stringify(b));
    }
  }
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
  if (c.req.method === "POST" && chOf(c) === "owner" && (url.pathname === "/api/draft" || url.pathname === "/api/nodepri")) {
    if (c.req.header("x-hb") !== "1") return c.json({ ok: false, error: "forbidden" }, 403);   // 다른 사이트 폼 막기(보드와 같은 문)
    const raw = new Uint8Array(await c.req.arrayBuffer());
    let b: Record<string, unknown> | null = null;
    try { b = raw.length > (url.pathname === "/api/draft" ? 200000 : 20000) ? null : JSON.parse(new TextDecoder().decode(raw) || "{}"); } catch { b = null; }
    if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ ok: false, error: "bad json" }, 400);
    const r = await (url.pathname === "/api/draft" ? OS.draft : OS.nodePri)(c.env.DB, b as Record<string, any>).catch(() => null);
    return r ? c.json(r[1], r[0] as 200) : c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, { "x-retry-safe": "1" });
  }
  if (c.req.method === "POST" && chOf(c) === "owner" && (url.pathname === "/api/artnote" || url.pathname === "/api/artfolder" || url.pathname === "/api/artstar" || url.pathname === "/api/artthumb") && c.req.header("x-hb") === "1" && await ledger.f7On(c.env.DB, "write_art")) {
    const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!b) return c.json({ ok: false, error: "bad json" }, 400);
    let r: [number, object] | null; const rid = queue.ridOfBody(b);
    try { r = await (url.pathname === "/api/artnote" ? ownerWrite.artnote(c.env, b, rid) : url.pathname === "/api/artstar" ? ownerWrite.artstar(c.env, b, rid) : url.pathname === "/api/artthumb" ? ownerWrite.artthumb(c.env, b, rid) : ownerWrite.artfolder(c.env, b, rid)); }
    catch { return rid ? queue.retrySafe(c) : c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503); }
    if (r && r[0] < 400 && url.pathname === "/api/artnote" && !b.del && /^(?:📍\d+ \(|✅ 정함|\[?[A-Z]\d{1,3}(?![0-9A-Za-z]))/.test(String(b.text || "").trim()) && await files.isCanvas(c.env, String(b.art))) {
      const cut = (v: unknown, n: number) => String(v ?? "").slice(0, n);
      const t0 = String(b.text || "").trim().slice(0, 4000), mine = ((r[1] as { notes?: { id: number; target: string; who: string; text: string }[] }).notes || []).filter(n => n.who === "owner" && n.target === String(b.target || "").slice(0, 200) && n.text === t0);
      const nid = mine.length ? Math.max(...mine.map(n => Number(n.id) || 0)) : 0;
      const sending = boardCall(c.env, chOf(c), { method: "POST", path: "/api/artpin", headers: { "content-type": "application/json", "x-hb": "1" }, body: new TextEncoder().encode(JSON.stringify({ art: cut(b.art, 40), target: cut(b.target, 200), page: cut(b.page, 200), text: cut(b.text, 4000), near: cut(b.near, 400), ...(nid ? { id: nid } : {}) })) })
        .then(x => (JSON.parse(new TextDecoder().decode(x.body)) as { sent?: string | null }).sent ?? null, () => null).catch(() => null);
      c.executionCtx.waitUntil(sending);
      const sent = await Promise.race([sending, new Promise<null>(ok => setTimeout(() => ok(null), 3000))]);
      if (sent) r = [r[0], { ...r[1], sent }];
    }
    if (r) { if (r[0] < 400) c.executionCtx.waitUntil(live.bumpLedger(c.env)); return c.json(r[1], r[0] as 200); }
    return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, { "x-retry-safe": "1" });   // 색인 없음 — 쓰기 전이라 다시 보내도 됨
  }
  // 주인 GET /api/answer/:rid — Worker 가 직접 D1 에 쓴 rid(f7_rid) · 남은 답이 4xx 인 것만 여기서. 다리가 받은 글(202 queued 등) · 모르는 rid · 칸 오류는 예전처럼 다리(_jobs)로
  if (c.req.method === "GET" && chOf(c) === "owner") {
    const am = /^\/api\/answer\/([\w-]{1,64})$/.exec(url.pathname);
    if (am && await ledger.f7On(c.env.DB, "write_queue")) {
      const a = await queue.ownerAnswerOf(c.env, s.user.email, am[1]).catch(() => null);
      if (a) return c.json({ ok: true, ...a }, 200, { "cache-control": "no-store", "x-f7": "queue" });
    }
  }
  const rd = c.req.method === "GET" && chOf(c) === "owner" ? ownerRead.route(url.pathname + url.search) : null;
  const flag = (n: string) => rd?.kind === "inbox" ? ledger.f7Peek(c.env.DB, n, peekWait(c)) : ledger.f7On(c.env.DB, n);
  const shadowRd = !!rd && await flag("shadow_" + rd.group);
  if (rd && !cookieOf(c, "bx_w") && await flag("read_" + rd.group) && await ledgerFresh(c.env)) {
    const st = rd.kind === "inbox";
    const rdb = rd.kind === "frequent" ? c.env.DB.withSession("first-unconstrained") as unknown as D1Database : c.env.DB;
    const res = await ownerRead.respond(rdb, () => snap(c.env).get("cfg"), rd, c.req.header("if-none-match"), st);
    if (res) return res;
  }
  const headers: Record<string, string> = {};
  for (const h of PASS_REQ) { const v = c.req.header(h); if (v) headers[h] = v; }
  const shell = /^\/art\/([A-Za-z0-9]{16,40})\/$/.exec(url.pathname);
  headers["accept-encoding"] = "gzip";
  if (shadowRd) delete headers["if-none-match"];   // 그림자 대조는 다리 몸통이 있어야 함(304 는 아래에서 Worker 가)
  const body = c.req.method === "POST" ? (sent ?? new Uint8Array(await c.req.arrayBuffer())) : undefined;
  if (body && body.length > 25 * 1024 * 1024) return c.json({ ok: false, error: "25MB 까지 올릴 수 있어요" }, 413);
  const own = url.pathname === "/" && c.req.method !== "POST" && chOf(c) === "owner" && await ledger.f7On(c.env.DB, "read_page") ? await ownPage(c.env, c.executionCtx).catch(() => null) : null;
  const fr = !own && (c.req.method === "GET" || c.req.method === "HEAD") ? await filesFirst(c, url.pathname + url.search, headers) : null;
  let r; const t0 = Date.now();
  try { r = own ?? fr ?? await boardCall(c.env, chOf(c), { method: c.req.method === "HEAD" ? "GET" : c.req.method, path: url.pathname + url.search, headers, ...(body !== undefined ? { body } : {}) }); }
  catch (e) {
    const reqId = (c.req.header("x-request-id") || "").slice(0, 40);   // 화면 오류 기록(boarder_error)의 rid 와 같은 값 — 위 api_error 로그와 같음
    let rid = ""; if (body && body.byteLength <= 64 * 1024) try { rid = String((JSON.parse(new TextDecoder().decode(body)) as { rid?: unknown }).rid || "").slice(0, 64); } catch {}   // 글 rid(chatPost errLog) — 큰 업로드는 안 읽음
    const safe = /릴레이 없음/.test(String(e));
    capture(c.env, c.executionCtx, "$exception", s.user.email, { $exception_list: [{ type: "BridgeError", value: String(e).slice(0, 120), mechanism: { handled: true } }], path: normPath(url.pathname), method: c.req.method, req_id: reqId || null, rid: rid || null, retry_safe: safe });
    console.error("다리 503", JSON.stringify({ req_id: reqId, rid, path: normPath(url.pathname), method: c.req.method, safe, err: String(e).slice(0, 120) }));   // Workers 로그(tail)에도
    return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, safe ? { "x-retry-safe": "1" } : {});   // 보내지도 못한 요청 — 화면이 쓰기도 조용히 다시
  }
  if (c.req.method === "POST" && r.status < 400) REC.get(c.req.raw)?.cookies.push("bx_w=1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=20");   // 방금 씀 — 20초 스냅숏 건너뜀
  if (shadowRd && rd && !fr && !own) {   // 그림자: 304 대신 몸통을 받아 대조하고, 화면에는 보드처럼 같은 ETag 면 빈 304
    const bridged = r, inm = c.req.header("if-none-match"), bms = Date.now() - t0;
    c.executionCtx.waitUntil(ownerRead.shadow(c.env.DB, () => snap(c.env).get("cfg"), rd, bridged).then(d => {
      if (d?.diff) capture(c.env, c.executionCtx, "f7_shadow_diff", s.user.email, { route: rd.kind, group: rd.group, at: d.diff, n_bridge: d.n_bridge, n_d1: d.n_d1, ms_d1: d.ms });
      else if (d && Math.random() < 0.05) capture(c.env, c.executionCtx, "f7_shadow_ok", s.user.email, { route: rd.kind, group: rd.group, n_bridge: d.n_bridge, ms_d1: d.ms, ms_bridge: bms });   // 차이 0 이 이어지는지 · 빠르기(5% 표본)
    }).catch(e => capture(c.env, c.executionCtx, "f7_shadow_diff", s.user.email, { route: rd.kind, group: rd.group, at: "error " + String((e as Error)?.name || "") })));   // 오류 글은 안 실음(JSON 오류는 몸통 조각을 담음)
    if (r.status === 200 && inm && r.headers.etag === inm.replace(/^W\//, "")) { bridgeSeg(c.req.raw, Date.now() - t0, r.headers); return new Response(null, { status: 304, headers: { etag: inm, "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
  }
  if (!fr && !own) bridgeSeg(c.req.raw, Date.now() - t0, r.headers);
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
    return boardShell(c, new Response(unzip(), { status: r.status, headers: out }), s.user.email, "", await ledger.f7On(c.env.DB, "write_queue"), ea);
  }
  if (shell && r.status === 200 && (r.headers["content-type"] || "").includes("text/html") && artView.viewable(c.req.method, c.req.header("sec-fetch-dest"), url.search))
    c.executionCtx.waitUntil(artView.record(c.env.DB, todoOwner(c.env, s.user.email), shell[1]).catch(e => console.error("열람 기록", e)));
  if (canvasShell && r.status === 200 && (r.headers["content-type"] || "").includes("text/html")) {
    const t = await artTok(c.env, shell![1], Date.now() + 2 * 3600_000);
    return new HTMLRewriter().on("head", { element: e => { e.prepend(artFetchShim(shell![1], t), { html: true }); } })
      .transform(new Response(unzip(), { status: r.status, headers: out }));
  }
  if ((r.status === 404 || r.status === 403) && docNav(c, url)) return c.redirect("/nf", 302);
  return new Response(c.req.method === "HEAD" ? null : (r.body as unknown as BodyInit), { status: r.status, headers: out, ...(out.get("content-encoding") ? { encodeBody: "manual" as const } : {}) });
});

// server.py 의 /sw.js · /api/push/* 와 같은 답(push.py · server.py push_subscribe · push_test · push_ack)
async function pushRoute(c: Context<{ Bindings: Env }>, url: URL) {
  const p = url.pathname, pu = pusher(c.env);
  kickPush(c.env, c.executionCtx);
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    if (p === "/sw.js") return new Response(c.req.method === "HEAD" ? null : PU.SW, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" } });
    if (p === "/api/push/key") return c.json({ key: await pu.key() }, 200, { "cache-control": "no-store" });
    if (p === "/api/push/page") {   // 「보드가 열려 있을 때 알림」(웹 푸시가 없는 브라우저): 틱이 보낸 것과 같은 알림을 after 뒤 것만(회원 길과 같은 꼴)
      const a = url.searchParams.get("after"), after = a != null && /^\d{1,9}$/.test(a) ? Number(a) : null;
      const r = await pu.page(after); return c.json(r[1], r[0] as 200, { "cache-control": "no-store" });
    }
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

const salesSend = (env: Env): SalesSend => ({
  mail: (to, m) => env.EMAIL.send({ to, from: { email: "login@0bridge.dev", name: "Boarder 영업 보드" }, ...m } as never),
  push: async (to, n) => { if (await ledger.f7On(env.DB, "member_push")) return memberPusher(env, to)?.mNotify(to, { ...n, title: "영업 보드" }); },
  member: e => member(env as never, e),
});
// 관리 토큰으로 한 번 돌리기 — only = 그 한 사람만(시험), dry = 안 보내고 묶음 수만. 모두에게 보내기는 아침 자동만
app.post("/api/admin/sales-digest", async c => {
  if (!admin(c)) return c.json({ error: "no" }, 403);
  const b = await c.req.json<{ only?: string; dry?: boolean }>().catch(() => ({} as { only?: string; dry?: boolean }));
  const only = b.only ? String(b.only).trim().toLowerCase() : undefined;
  if (!only && !b.dry) return c.json({ error: "모두에게 보내기는 아침 자동만 — only 나 dry 를 주세요" }, 400);
  return c.json({ ok: true, ...(await runDigest(c.env.DB, c.env.PUBLIC_URL, salesSend(c.env), { only, dry: !!b.dry })) });
});
const memberCardPush = async (env: Env, me: string, card: PushCard) => {
  try { if (await ledger.f7On(env.DB, "member_push")) { const pu = memberPusher(env, me); if (pu) await routeCard(env.DB, me, card, pu); } }
  catch (e) { console.log(JSON.stringify({ ev: "member_push", error: String(e).slice(0, 200) })); }
};
// 에이전트 글 한 줄(넓힘을 켠 회원만, member-push.ts routeLine): 내 글에 온 답 · 나를 부름은 바로 한 통(key log:<줄>), 그 밖 진행 글은 묶음(5분에 한 통 「새 글 n」, 설정에서 끔).
// 구독 줄도 넓힘 표시 줄(페이지 알림 기기)도 없으면 칸을 안 부르고, 넓힘이 꺼졌으면(기본) 글을 가르지도 않음 — 기본 회원은 main 과 같게 글 알림 0
const memberLinePush = async (env: Env, me: string, line: PushLine) => {
  try {
    if (!(await ledger.f7On(env.DB, "member_push"))) return;
    if (!(await linePushOpen(env.DB, me))) return;
    const pu = memberPusher(env, me); if (pu) await routeLine(env.DB, me, line, pu);
  } catch (e) { console.log(JSON.stringify({ ev: "member_push_line", error: String(e).slice(0, 200) })); }
};
// 넓힘 표시 줄 맞추기(설정은 칸이 정본, 이 줄은 글 알림 문만): POST 때 맞추고, 읽을 때도 켜짐이면 되살림(이 고침 전에 켠 회원 · 줄 쓰기가 실패한 때). 실패해도 설정 답은 그대로
const wideRow = (db: D1Database, me: string, wide: boolean) => setWideRow(db, me, wide).catch(e => console.log(JSON.stringify({ ev: "member_push_wide", error: String(e).slice(0, 200) })));
// 회원 웹 푸시(pushRoute 와 같은 답 꼴): 칸 = 세션 메일 · 원천 = 그 사람 board_card. POST 는 주인 길과 같은 x-hb 문 + 회원 쓰기와 같은 sameSite(다른 사이트 폼 · 링크 막기)
async function memberPushRoute(c: Context<{ Bindings: Env }>, me: string, url: URL) {
  const p = url.pathname, pu = memberPusher(c.env, me);
  if (!pu) return c.json({ error: "no" }, 403);
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    if (p === "/sw.js") return new Response(c.req.method === "HEAD" ? null : PU.SW, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" } });
    if (p === "/api/push/key") return c.json({ key: await pu.key() }, 200, { "cache-control": "no-store" });
    if (p === "/api/push/page") {   // 「보드가 열려 있을 때 알림」(웹 푸시 서비스가 없는 브라우저): after 뒤 알림만
      const a = url.searchParams.get("after"), after = a != null && /^\d{1,9}$/.test(a) ? Number(a) : null;
      const r = await pu.mPage(me, after); return c.json(r[1], r[0] as 200, { "cache-control": "no-store" });
    }
    if (p === "/api/push/prefs") { const r = await pu.mPrefs(me); if (r[1].wide === true) await wideRow(c.env.DB, me, true); return c.json(r[1], r[0] as 200, { "cache-control": "no-store" }); }   // 알림 범위 넓힘 · 진행 글 묶음 · 끔(사람마다, 기본 급한 것만)
    let d = p; try { d = decodeURIComponent(p); } catch {}
    const m = /^\/api\/push\/resolve\/([\w:.-]{1,80})$/.exec(d);   // 회원 카드는 바뀌지 않음 — 그 사람 카드면 그 글 자리(Primary 채팅의 카드 글)
    if (m) return c.json(await memberBoard.pushLoc(c.env.DB, me, m[1]), 200, { "cache-control": "no-store" });   // 회원 보드 길(member-board.get)과 같은 셈 — w:<n> 카드도
    return c.json({ error: "not found" }, 404);
  }
  const fn = ({ "/api/push/subscribe": 1, "/api/push/unsubscribe": 1, "/api/push/test": 1, "/api/push/ack": 1, "/api/push/prefs": 1 } as Record<string, number>)[p];
  if (c.req.method !== "POST" || !fn) return c.json({ error: "not found" }, 404);
  if (c.req.header("x-hb") !== "1" || !sameSite(c)) return c.json({ ok: false, error: "forbidden" }, 403);
  const raw = new Uint8Array(await c.req.arrayBuffer());
  let b: Record<string, unknown>;
  try { b = raw.length > 20000 ? null! : JSON.parse(new TextDecoder().decode(raw) || "{}"); } catch { b = null!; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ ok: false, error: "bad json" }, 400);
  let r: [number, Record<string, unknown>];
  if (p === "/api/push/subscribe") {
    r = await pu.mSubscribe(me, b);
    const ep = String(((b.sub || {}) as { endpoint?: unknown }).endpoint ?? "");
    // 이 브라우저 구독은 지금 회원 것 — 로그아웃 없이 다른 계정으로 들어와 켰으면 옛 회원 칸의 같은 주소를 지움(옛 회원 알림이 이 기기로 오지 않게)
    if (r[0] === 200) await claimEndpoint(c.env.DB, me, ep, prev => memberPusher(c.env, prev)?.mUnsubscribe(prev, { endpoint: ep }) ?? Promise.resolve()).catch(e => console.log(JSON.stringify({ ev: "member_push_claim", error: String(e).slice(0, 200) })));
    if (r[1].new) c.executionCtx.waitUntil(pu.mTrial(me, { endpoint: ep }, true).catch(() => null));   // 새로 켠 기기엔 바로 시험 알림 1건(주인과 같게)
  } else if (p === "/api/push/unsubscribe") { r = await pu.mUnsubscribe(me, b); if (r[0] === 200) await releaseEndpoint(c.env.DB, me, String(b.endpoint ?? "")).catch(() => {}); }
  else if (p === "/api/push/test") r = await pu.mTrial(me, b);
  else if (p === "/api/push/prefs") { r = await pu.mSetPrefs(me, b); if (r[0] === 200) await wideRow(c.env.DB, me, r[1].wide === true); }
  else r = await pu.mAck(me, b);
  return c.json(r[1], r[0] as 200);
}

const AGAIN = "x-bx-again", D1_BUSY = /overloaded|Too many resources consumed/i;
app.onError(async (err, c) => {
  const u = new URL(c.req.url), m = c.req.method, msg = String((err as Error)?.message ?? err).slice(0, 300), again = c.req.raw.headers.has(AGAIN), busy = D1_BUSY.test(msg);
  console.error(JSON.stringify({ ev: "req_error", m, path: u.pathname.slice(0, 120), again, busy, msg }));
  const upload = m === "POST" && u.pathname === "/api/upload";   // 올리기는 열쇠(X-Upload-Key)로 같은 파일이 하나라 다시 보내도 됨 — 아래 503 + x-retry-safe 로(화면이 조용히 다시)
  if (m !== "GET" && m !== "HEAD" && !upload) return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 500, { "cache-control": "no-store" });
  if (!again && !busy && !upload && !u.pathname.startsWith("/api/auth/")) {
    await new Promise(ok => setTimeout(ok, 150 + Math.floor(Math.random() * 200)));
    const h = new Headers(c.req.raw.headers); h.set(AGAIN, "1");
    try { const r = await app.fetch(new Request(c.req.raw.url, { method: m, headers: h }), c.env, c.executionCtx); if (r.status < 500) return r; } catch { /* 아래 503 */ }
  }
  if ((c.req.header("accept") || "").includes("text/html") && !u.pathname.startsWith("/api/"))
    return c.html('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>보더</title><p style="font:15px system-ui;color:#888;text-align:center;margin-top:40vh">잠시 붐벼요. 곧 다시 열어요</p><noscript><meta http-equiv="refresh" content="15"></noscript><script>(function(){var k="bx-busy",n=0,t=Date.now();try{var v=(sessionStorage.getItem(k)||"").split(":");if(t-(+v[1]||0)<120000)n=+v[0]||0;sessionStorage.setItem(k,(n+1)+":"+t)}catch(e){}var s=[2,4,8,15,30][Math.min(n,4)];setTimeout(function(){location.reload()},(s+Math.random()*s/2)*1000)})()</script>', 503, { "retry-after": "5", "cache-control": "no-store" });
  return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, { "x-retry-safe": "1", "retry-after": "1", "cache-control": "no-store" });
});

// app 에 scheduled 를 붙여 내보냄 — 시험이 default 로 받는 app(onError · request)이 그대로 Hono 앱이게
export default Object.assign(app, {
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sweepTaskBoard(env.DB).catch(e => console.log(JSON.stringify({ ev: "taskboard_sweep", error: String(e).slice(0, 200) }))));
    ctx.waitUntil((async () => {
      if (!(await ledger.f7On(env.DB, "member_salesmail"))) return;
      const r = await runDigest(env.DB, env.PUBLIC_URL, salesSend(env));
      console.log(JSON.stringify({ ev: "sales_digest", today: r.today, to: r.sent.length, fail: r.sent.filter(x => x.mail !== "ok").length }));
    })().catch(e => console.log(JSON.stringify({ ev: "sales_digest", error: String(e).slice(0, 200) }))));
  },
});
