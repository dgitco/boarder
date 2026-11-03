import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
(globalThis as any).HTMLRewriter ??= class { on() { return this; } transform(r: Response) { return r; } };   // 껍데기에 표(심)를 얹는 것만 — 시험은 머리 · 상태만 봄
const { default: app } = await import("./index.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
  });
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => s.all())) } as unknown as D1Database };
}
function bridgeNs(arts: Record<string, { kind: string }>, st: { artsDown: boolean; artsCalls: number }) {
  const te = new TextEncoder();
  const call = async (r: { method: string; path: string }) => {
    if (r.path === "/api/arts") { st.artsCalls++; return st.artsDown ? { status: 502, headers: { "content-type": "text/plain" }, body: te.encode("bad gateway") } : { status: 200, headers: { "content-type": "application/json" }, body: te.encode(JSON.stringify(arts)) }; }
    const m = /^\/art\/([A-Za-z0-9]+)\/$/.exec(r.path);
    if (m && arts[m[1]]) return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: te.encode("<!doctype html><html><head></head><body>캔버스 껍데기</body></html>") };
    return { status: 404, headers: { "content-type": "application/json" }, body: te.encode('{"error":"not found"}') };
  };
  return { idFromName: (n: string) => n, get: () => ({ call }) };
}

const OWNER = "owner@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie() {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${OWNER}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${OWNER}|${exp}|${sig}`)}`;
}
const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew; const later = (ms: number) => { skew += ms; };
let n = 0; const newId = (p: string) => (p + "Canvas" + String(++n).padStart(4, "0") + "x".repeat(16)).slice(0, 24);
function setup(arts: Record<string, { kind: string }>) {
  const { D1 } = d1(), st = { artsDown: false, artsCalls: 0 };
  const env = { DB: D1, BRIDGE: bridgeNs(arts, st), BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const get = async (path: string) => app.fetch(new Request("https://example.test" + path, { headers: { accept: "text/html", "sec-fetch-dest": "iframe", cookie: await cookie() } }), env, { waitUntil() {}, passThroughOnException() {} });
  return { st, get };
}
const isShell = (r: Response) => r.status === 200 && !r.headers.get("content-security-policy");

test("캔버스 껍데기: 에이전트가 방금 만든 캔버스를 1분 안에 열어도 껍데기로(sandbox 로 가두지 않음)", async () => {
  const A = newId("A"), B = newId("B"), arts: Record<string, { kind: string }> = { [A]: { kind: "canvas" } };
  const { get } = setup(arts);
  assert.ok(isShell(await get(`/art/${A}/`)), "있던 캔버스 A");   // 목록을 읽어 둠(60초)
  arts[B] = { kind: "canvas" };
  later(20_000);
  const r = await get(`/art/${B}/`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-security-policy"), null, "새 캔버스 B 가 낡은 목록 때문에 sandbox(다른 출처)로 갇혀 판을 못 부름");
});

test("캔버스 껍데기: 보드 목록(/api/arts)이 한 번 일시 실패해도 그 뒤 1분 동안 모든 캔버스가 깨지지 않음", async () => {
  const A = newId("C"), arts = { [A]: { kind: "canvas" } };
  const { st, get } = setup(arts);
  // 다른 채널로 한 번 불러 캐시를 새로 채우게 함(채널이 바뀌면 다시 읽음)
  await app.fetch(new Request(`https://example.test/art/${A}/`, { headers: { cookie: (await cookie()) + "; bx-ch=test" } }), { DB: d1().D1, BRIDGE: bridgeNs({}, { artsDown: false, artsCalls: 0 }), BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" } as never, { waitUntil() {}, passThroughOnException() {} });
  st.artsDown = true;   // 다리 일시 실패(502)
  await get(`/art/${A}/`).catch(() => null);
  st.artsDown = false;   // 곧 돌아옴
  assert.ok(isShell(await get(`/art/${A}/`)), "일시 실패 한 번의 빈 목록이 60초 캐시에 남아 캔버스가 sandbox 로 갇힘");
});

test("지운 캔버스의 링크: 껍데기 대신 404 → 주소창이면 「없는 주소예요」로, 목록을 매번 다시 읽지는 않음(5초 안)", async () => {
  const A = newId("D"), arts = { [A]: { kind: "canvas" } };
  const { st, get } = setup(arts); later(6_000);
  assert.ok(isShell(await get(`/art/${A}/`)));
  const gone = newId("E"), before = st.artsCalls;
  for (let i = 0; i < 5; i++) { const r = await get(`/art/${gone}/`); assert.notEqual(r.status, 200); }
  assert.ok(st.artsCalls - before <= 1, `없는 id 를 열 때마다 보드 목록을 다시 읽음: ${st.artsCalls - before}번`);
});

function snapNs() {   // DO 이름표 — 같은 이름은 같은 칸(진짜 BoardSnap: rid 표 claim · done · release)
  const cells = new Map<string, any>();
  const ctx = () => { const s = new DatabaseSync(":memory:"); return {
    storage: { sql: { exec: (q: string, ...a: unknown[]) => { const p = s.prepare(q); if (/^\s*(select|with)/i.test(q)) { const rows = p.all(...(a as never[])); return { toArray: () => rows, rowsWritten: 0 }; } const r = p.run(...(a as never[])); return { toArray: () => [], rowsWritten: Number(r.changes) }; } } },
    getWebSockets: () => [], setWebSocketAutoResponse() {}, waitUntil() {}, blockConcurrencyWhile: (f: () => unknown) => f(),
  }; };
  const rpc = (o: any) => new Proxy(o, { get: (t, k) => typeof t[k] === "function" ? async (...a: unknown[]) => t[k](...a) : t[k] });
  return { idFromName: (n: string) => n, get: (n: string) => { if (!cells.has(n)) cells.set(n, rpc(new (BoardSnap as any)(ctx(), {}))); return cells.get(n); } };
}
const { BoardSnap } = await import("./index.ts");

test("큰 캔버스 댓글: 같은 rid 로 다시 보내면(답을 잃은 뒤) 처음과 같은 댓글 목록을 받음 — 빈 몸통 200 이 아님", async () => {
  const { db, D1 } = d1(), T = Date.now(), ART = newId("F");
  for (const f of ["write_queue", "write_art"]) db.prepare("INSERT INTO f7_flag(name, on_at) VALUES (?, ?)").run(f, T);
  later(11_000);   // 스위치 캐시(ledger.f7On 10초)가 앞 시험의 빈 스위치를 들고 있음 — 다음 읽기로
  // 이미 댓글이 많은 판: 2KB 댓글 40개 ≈ 80KB(지어낸 글)
  for (let i = 1; i <= 40; i++) db.prepare("INSERT INTO wl_art_note(id, art, target, page, who, text, at) VALUES (?,?,?,?,?,?,?)").run(i, ART, `#t${i}`, "", "owner", `메모 ${i} ` + "가".repeat(680), T / 1000 + i);
  const ix = { v: 1, at: 0, blobs: {}, shim: "", arts: { [ART]: { kind: "page", title: "큰 판", at: "", acct: "", auto: "디자인", main: "index.html" } } };
  const RESULTS = { get: async (k: string) => k === "art/_sys/index.json" ? { json: async () => ix } : null, head: async () => null } as unknown as R2Bucket;
  const env = { DB: D1, SNAP: snapNs(), RESULTS, BRIDGE: bridgeNs({}, { artsDown: false, artsCalls: 0 }), BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const waits: Promise<unknown>[] = [];
  const post = async (body: unknown) => {
    const r = await app.fetch(new Request("https://example.test/api/artnote", { method: "POST", headers: { "content-type": "application/json", "x-hb": "1", "sec-fetch-site": "same-origin", cookie: await cookie() }, body: JSON.stringify(body) }), env, { waitUntil: (p: Promise<unknown>) => { waits.push(p.catch(() => {})); }, passThroughOnException() {} });
    await Promise.all(waits.splice(0)); return r;
  };
  const body = { art: ART, target: "#hero", text: "제목 글자 키워 주세요", rid: "rtest-artnote-big1" };
  const r1 = await post(body); assert.equal(r1.status, 200, await r1.clone().text());
  const j1 = await r1.json() as { notes: unknown[] };
  assert.equal(j1.notes.length, 41);
  const r2 = await post(body);   // 화면: 첫 답을 망에서 잃음 → 「확인 필요」 → 같은 rid 로 다시
  assert.equal(r2.status, 200);
  // 남긴 답이 눌린 채면(content-encoding: gzip, Workers 는 encodeBody manual 로 그대로 보내고 브라우저가 풂) 브라우저처럼 풀어 읽음
  const t2 = r2.headers.get("content-encoding") === "gzip" ? await new Response(r2.body!.pipeThrough(new DecompressionStream("gzip"))).text() : await r2.text();
  assert.ok(t2.length > 0, "다시 보낸 쪽이 몸통 없는 200(JSON 아님)을 받음 — 보드가 댓글 저장을 실패로 그림");
  assert.equal((JSON.parse(t2) as { notes: unknown[] }).notes.length, 41, "댓글이 두 번 들어가거나 목록이 다름");
  assert.equal((db.prepare("SELECT count(*) n FROM wl_art_note WHERE art = ?").get(ART) as { n: number }).n, 41, "같은 rid 의 댓글이 두 번 들어감");
});

test("끼운 /art: 주인만 그 /art 표를 받고, 표가 붙은 첫 화면(껍데기 · 페이지)은 쿠키 없이 sandbox 로 열림 · 다른 /art 표로는 안 열림", async () => {
  const A = newId("G"), P = newId("H"), arts: Record<string, { kind: string }> = { [A]: { kind: "canvas" }, [P]: { kind: "page" } };
  const { D1 } = d1(), env = { DB: D1, BRIDGE: bridgeNs(arts, { artsDown: false, artsCalls: 0 }), BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const call = (path: string, h: Record<string, string> = {}) => app.fetch(new Request("https://example.test" + path, { headers: { accept: "text/html", ...h } }), env, ctx);
  const tok = async (id: string, h: Record<string, string>) => { const r = await call(`/api/arttok/${id}`, { accept: "application/json", ...h }); return { status: r.status, t: r.status === 200 ? (await r.json() as { t: string }).t : "" }; };
  const ck = { cookie: await cookie() };
  assert.equal((await tok(A, {})).status, 401, "로그인 안 한 사람");
  assert.equal((await tok(newId("Z"), ck)).status, 404, "없는 아티팩트");
  assert.equal((await tok("짧음", ck)).status, 404);
  const ta = await tok(A, ck), tp = await tok(P, ck);
  assert.equal(ta.status, 200); assert.match(ta.t, /^\d{10,13}\.[0-9a-f]{32}$/);
  const shell = await call(`/art/${A}/?bxt=${encodeURIComponent(ta.t)}`, { "sec-fetch-dest": "iframe" });
  assert.equal(shell.status, 200, "표가 붙은 캔버스 첫 화면");
  assert.match(shell.headers.get("content-security-policy") || "", /^sandbox /, "판 안에서 연 것도 같은 sandbox");
  const page = await call(`/art/${P}/?bxt=${encodeURIComponent(tp.t)}`, { "sec-fetch-dest": "iframe" });
  assert.equal(page.status, 200, "표가 붙은 페이지 첫 화면");
  const wrong = await call(`/art/${P}/?bxt=${encodeURIComponent(ta.t)}`, { "sec-fetch-dest": "iframe" });   // A 표로 P 를
  assert.notEqual(wrong.status, 200, "다른 /art 표로 열림");
  const deep = await call(`/art/${A}/sub/x.html?bxt=${encodeURIComponent(ta.t)}`, { "sec-fetch-dest": "iframe" });
  assert.notEqual(deep.status, 200, "캔버스 표로 하위 폴더까지 열림");
  const pdeep = await call(`/art/${P}/img/a.png?bxt=${encodeURIComponent(tp.t)}`, { "sec-fetch-dest": "image" });
  assert.notEqual(pdeep.status, 401); assert.notEqual(pdeep.headers.get("location") || "", "/login", "페이지 표로 그 페이지 하위 그림은 표 길로(로그인 화면 아님)");
  const cimg = await call(`/art/${A}/qa-guest/pc-00.png?bxt=${encodeURIComponent(ta.t)}`, { "sec-fetch-dest": "image" });
  assert.notEqual(cimg.status, 401); assert.notEqual(cimg.headers.get("location") || "", "/login", "캔버스 표로 그 캔버스 하위 그림은 표 길로");
  assert.match(cimg.headers.get("content-security-policy") || "", /^sandbox /, "캔버스 하위 그림도 표 길(sandbox 머리)");
  const cjs = await call(`/art/${A}/qa-guest/x.js?bxt=${encodeURIComponent(ta.t)}`, { "sec-fetch-dest": "script" });
  assert.notEqual(cjs.status, 200, "캔버스 표로 하위 폴더 스크립트까지 열림");
  const trav = await call(`/art/${P}/../${A}/x.html?bxt=${encodeURIComponent(tp.t)}`, { "sec-fetch-dest": "iframe" });
  assert.notEqual(trav.status, 200, "점점으로 다른 /art");
  const D = newId("I"); arts[D] = { kind: "doc" }; later(6_000);
  assert.equal((await tok(D, ck)).status, 404, "글(doc)은 끼우지 않음");
});
