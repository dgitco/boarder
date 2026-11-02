import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
(globalThis as any).HTMLRewriter ??= class { on() { return this; } transform(r: Response) { return r; } };   // 표 붙이기는 Workers 것 — 시험은 상태 · 머리 · 몸통만
const { default: app } = await import("./index.ts");
const MC = await import("./member-canvas.ts");

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
// 가짜 R2: put · get · head · list(prefix · include) · delete(하나 · 여럿)
function r2() {
  const m = new Map<string, { b: Uint8Array; httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> }>();
  const obj = (key: string) => { const v = m.get(key)!; return { key, size: v.b.length, httpMetadata: v.httpMetadata, customMetadata: v.customMetadata, body: new Response(v.b as BodyInit).body, arrayBuffer: async () => v.b.slice().buffer, text: async () => new TextDecoder().decode(v.b), json: async () => JSON.parse(new TextDecoder().decode(v.b)) }; };
  const R = {
    put: async (key: string, b: ArrayBuffer | string | Uint8Array | Blob, o: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> } = {}) => { m.set(key, { b: typeof b === "string" ? new TextEncoder().encode(b) : b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array(b as ArrayBuffer), ...o }); return {}; },
    get: async (key: string) => m.has(key) ? obj(key) : null,
    head: async (key: string) => m.has(key) ? obj(key) : null,
    list: async (o: { prefix?: string }) => ({ objects: [...m.keys()].filter(k => k.startsWith(o.prefix || "")).sort().map(obj), truncated: false }),
    delete: async (k: string | string[]) => { for (const x of Array.isArray(k) ? k : [k]) m.delete(x); },
  };
  return { m, R: R as unknown as R2Bucket };
}

const OWNER = "owner@example.test", A = "alice@example.test", B = "bob@example.test", SECRET = "test-secret-not-real";
const TOK = { A: "bxd_" + "a".repeat(40), B: "bxd_" + "b".repeat(40), O: "bxd_" + "o".repeat(40) };
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로
  const tok = "sess-" + email, th = (await sha(tok)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${tok}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
async function setup() {
  const { db, D1 } = d1(), { m, R } = r2(), waits: Promise<unknown>[] = [];
  for (const e of [A, B]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(e, OWNER, 1);
  for (const [k, e] of [["A", A], ["B", B], ["O", OWNER]] as const) db.prepare("INSERT INTO device(id, owner, name, token_hash, created_at, scope) VALUES (?,?,?,?,?,?)").run("dev" + k, e, "시험", await sha(TOK[k]), 1, k === "O" ? "watch" : "full");
  const env = { DB: D1, RESULTS: R, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, ASSETS: { fetch: async () => new Response("<html>로그인 화면</html>", { headers: { "content-type": "text/html" } }) },   // 화면 칸 알리기(live.ts)는 빈 것
    BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil(p: Promise<unknown>) { waits.push(p); }, passThroughOnException() {} };
  const go = (path: string, init: RequestInit = {}) => app.fetch(new Request("https://example.test" + path, init), env, ctx);
  const put = (tok: string, files: Record<string, string | Uint8Array>, o: { id?: string; title?: string; manifest?: unknown; win?: string; wid?: string } = {}) => {
    const fd = new FormData(), paths = Object.keys(files);
    fd.set("manifest", JSON.stringify(o.manifest ?? paths.map(path => ({ path }))));
    paths.forEach((p, i) => fd.set(`f${i}`, new Blob([files[p] as BlobPart]), p.split("/").pop()));
    if (o.id) fd.set("id", o.id); if (o.title) fd.set("title", o.title); if (o.win) fd.set("win", o.win); if (o.wid) fd.set("wid", o.wid);
    return go("/api/me/canvas", { method: "POST", headers: { authorization: `Bearer ${tok}` }, body: fd });
  };
  const view = async (email: string | null, path: string) => go(path, { headers: { accept: "text/html", "sec-fetch-dest": "iframe", ...(email ? { cookie: await cookie(email) } : {}) } });
  return { db, m, env, go, put, view, settle: async () => { await Promise.all(waits.splice(0)); } };
}
const PAGE = "<!doctype html><html><head><title>가상 보고서</title></head><body><img src='a.png'>지어낸 글</body></html>";

test("올리기: 기기 토큰 없으면 401 · 주인 기기(감시만)도 401 · 회원 기기는 됨 — 목록 · 보기", async () => {
  const s = await setup();
  assert.equal((await s.put("bxd_" + "x".repeat(40), { "index.html": PAGE })).status, 401);
  assert.equal((await s.put(TOK.O, { "index.html": PAGE })).status, 401);
  assert.equal(s.m.size, 0);
  const r = await s.put(TOK.A, { "index.html": PAGE, "a.png": new Uint8Array([137, 80, 78, 71]) });
  assert.equal(r.status, 200);
  const j = await r.json() as any;
  assert.match(j.id, MC.ID); assert.equal(j.title, "가상 보고서"); assert.equal(j.files, 2); assert.equal(j.replaced, false);
  // 키는 회원 키 아래 — 메일이 키에 그대로 없음
  const mk = await MC.keyOf(A);
  assert.ok([...s.m.keys()].every(k => k.startsWith(`mart/${mk}/`) && !k.includes("alice")));
  const arts = await (await s.view(A, "/api/arts")).json() as any;
  assert.deepEqual(Object.keys(arts), [j.id]);
  assert.equal(arts[j.id].kind, "page"); assert.equal(arts[j.id].title, "가상 보고서"); assert.equal(arts[j.id].notes, 0);
  const pg = await s.view(A, `/art/${j.id}/`);
  assert.equal(pg.status, 200);
  assert.match(pg.headers.get("content-security-policy") || "", /^sandbox /);
  assert.match(await pg.text(), /지어낸 글/);
  const img = await s.view(A, `/art/${j.id}/a.png`);
  assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png");
  assert.equal((await s.view(A, `/art/${j.id}`)).status, 302);   // 끝 「/」 없으면 붙여서
  const cl = await (await s.go("/api/me/canvas", { headers: { authorization: `Bearer ${TOK.A}` } })).json() as any;
  assert.deepEqual(cl.canvases.map((x: any) => x.id), [j.id]);
});

test("보기 경계: 로그인 없으면 못 봄 · 남의 회원 캔버스는 404 · 남의 목록엔 안 보임 · 같은 id 를 남이 올려도 따로", async () => {
  const s = await setup();
  const id = "SharedIdForTest0000000001";
  assert.equal((await s.put(TOK.A, { "index.html": "<p>A 의 지어낸 글</p>" }, { id })).status, 200);
  const anon = await s.view(null, `/art/${id}/`);
  assert.doesNotMatch(await anon.text(), /A 의 지어낸 글/); assert.equal(anon.headers.get("x-boarder-src"), null);   // 로그인 화면(React)이 감
  const anonApi = await s.view(null, "/api/arts");
  assert.equal(anonApi.status, 401);
  const byB = await s.view(B, `/art/${id}/`);
  assert.equal(byB.status, 404); assert.doesNotMatch(await byB.text(), /A 의 지어낸 글/);
  assert.equal((await s.view(B, `/art/${id}/index.html`)).status, 404);
  assert.deepEqual(await (await s.view(B, "/api/arts")).json(), {});
  // B 가 같은 id 로 올리면 B 것이 따로 생기고 A 것은 그대로
  assert.equal((await s.put(TOK.B, { "index.html": "<p>B 의 지어낸 글</p>" }, { id })).status, 200);
  assert.match(await (await s.view(A, `/art/${id}/`)).text(), /A 의 지어낸 글/);
  assert.match(await (await s.view(B, `/art/${id}/`)).text(), /B 의 지어낸 글/);
  // 경로 넘기: 인코딩된 「/」 · .. 는 404
  assert.equal((await s.view(A, `/art/${id}/..%2f..%2findex.html`)).status, 404);
});

test("회원 표(판 안, 쿠키 없음): 그 회원 · 그 캔버스 파일만 · 다른 캔버스 · 위조 · 만료 · 남의 키는 404", async () => {
  const s = await setup();
  const a1 = await (await s.put(TOK.A, { "index.html": PAGE, "a.png": "png" })).json() as any;
  const a2 = await (await s.put(TOK.A, { "index.html": "<p>두 번째</p>" })).json() as any;
  const mkA = await MC.keyOf(A), mkB = await MC.keyOf(B);
  const t = await MC.token(SECRET, mkA, a1.id);
  const ok = await s.view(null, `/art/${a1.id}/a.png?bxt=${t}`);
  assert.equal(ok.status, 200); assert.equal(await ok.text(), "png");
  assert.equal((await s.view(null, `/art/${a2.id}/index.html?bxt=${t}`)).status, 404);
  assert.equal((await s.view(null, `/art/${a1.id}/a.png?bxt=${t.slice(0, -1)}${t.endsWith("0") ? "1" : "0"}`)).status, 404);   // 서명 한 글자 바꿈
  assert.equal((await s.view(null, `/art/${a1.id}/a.png?bxt=${await MC.token(SECRET, mkA, a1.id, Date.now() - 1)}`)).status, 404);   // 만료
  assert.equal((await s.view(null, `/art/${a1.id}/a.png?bxt=${await MC.token(SECRET, mkB, a1.id)}`)).status, 404);
  assert.equal((await s.view(null, `/art/${a1.id}/a.png?bxt=${await MC.token("other-secret", mkA, a1.id)}`)).status, 404);   // 다른 비밀로 만든 표
  assert.equal(await MC.tokenOk(SECRET, a1.id, "1999999999999.0123456789abcdef0123456789abcdef"), null);   // 주인 표 꼴은 회원 표가 아님
});

test("같은 id 새 판: 새 내용이 보이고 옛 판 파일은 지워짐 · 목록은 하나 · 옛 판에만 있던 파일은 404", async () => {
  const s = await setup();
  const id = "VersionTestCanvas000000001";
  const r1 = await (await s.put(TOK.A, { "index.html": "<p>첫 판</p>", "old.css": "a{}" }, { id, title: "첫 제목" })).json() as any;
  await s.settle();
  const r2 = await (await s.put(TOK.A, { "index.html": "<p>둘째 판</p>" }, { id, title: "새 제목" })).json() as any;
  await s.settle();
  assert.equal(r2.replaced, true); assert.notEqual(r1.ver, r2.ver);
  assert.match(await (await s.view(A, `/art/${id}/`)).text(), /둘째 판/);
  assert.equal((await s.view(A, `/art/${id}/old.css`)).status, 404);
  const mk = await MC.keyOf(A);
  assert.equal([...s.m.keys()].filter(k => k.startsWith(`mart/${mk}/${id}/${r1.ver}/`)).length, 0);
  const arts = await (await s.view(A, "/api/arts")).json() as any;
  assert.equal(Object.keys(arts).length, 1); assert.equal(arts[id].title, "새 제목");
});

test("상한 · 꼴: index.html 없음 · 경로 넘기 · 같은 경로 둘 · 파일 크기 · 총량 · 파일 수 · 캔버스 수 · id 꼴 — 아무것도 안 씀", async () => {
  const s = await setup();
  const st = async (p: Promise<Response>) => (await p).status;
  assert.equal(await st(s.put(TOK.A, { "page.html": PAGE })), 400);
  assert.equal(await st(s.put(TOK.A, { "index.html": PAGE, "../x.js": "1" })), 400);
  assert.equal(await st(s.put(TOK.A, { "index.html": PAGE, "a/./b.js": "1" })), 400);
  assert.equal(await st(s.put(TOK.A, { "index.html": PAGE }, { manifest: [{ path: "index.html" }, { path: "index.html" }] })), 400);
  assert.equal(await st(s.put(TOK.A, { "index.html": PAGE }, { id: "short" })), 400);
  assert.equal(await st(s.put(TOK.A, { "index.html": PAGE, "big.bin": new Uint8Array(MC.LIMITS.file + 1) })), 413);
  const many: Record<string, Uint8Array | string> = { "index.html": PAGE };
  for (let i = 0; i < 3; i++) many[`p${i}.bin`] = new Uint8Array(MC.LIMITS.file);   // 각각은 상한 안, 합은 넘음
  assert.equal(await st(s.put(TOK.A, many)), 413);
  const lots: Record<string, string> = { "index.html": PAGE };
  for (let i = 0; i < MC.LIMITS.files; i++) lots[`f${i}.txt`] = "x";
  assert.equal(await st(s.put(TOK.A, lots)), 413);
  assert.equal(s.m.size, 0);
  const mk = await MC.keyOf(A);
  for (let i = 0; i < MC.LIMITS.canvases; i++) s.m.set(`mart/${mk}/_c/Filler${String(i).padStart(14, "0")}`, { b: new Uint8Array(), customMetadata: { title: "", acct: "", at: "1", ver: "v", n: "1", bytes: "1" } });
  assert.equal(await st(s.put(TOK.A, { "index.html": PAGE })), 429);
  assert.equal(await st(s.put(TOK.A, { "index.html": PAGE }, { id: "Filler00000000000000" })), 200);
});

test("올린 창(통화 · 캔버스 미팅): 꼴이 맞는 win · wid 만 표지에 — ownerWin 은 그 회원 것만", async () => {
  const s = await setup();
  const r = await (await s.put(TOK.A, { "index.html": PAGE }, { win: "mbp:ew_arole000001", wid: "ew_arole000001" })).json() as { id: string };
  assert.deepEqual(await MC.ownerWin(s.env as never, A, r.id), { win: "mbp:ew_arole000001", wid: "ew_arole000001" });
  assert.equal(await MC.ownerWin(s.env as never, B, r.id), null);
  const r2 = await (await s.put(TOK.A, { "index.html": PAGE }, { win: "bad\nwin %1", wid: "%15" })).json() as { id: string };
  assert.deepEqual(await MC.ownerWin(s.env as never, A, r2.id), { win: "", wid: "" });
});
