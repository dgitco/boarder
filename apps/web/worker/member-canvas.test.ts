import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { copyFetch, directConfig, directHelpers } from "./canvas-direct-test-helper.ts";

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
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = []; for (const s of ss) o.push(await s.all()); db.exec("COMMIT"); return o; } catch (e) { db.exec("ROLLBACK"); throw e; } } } as unknown as D1Database };
}
// 가짜 R2: put · get · head · list(prefix · include) · delete(하나 · 여럿)
function r2() {
  const m = new Map<string, { b: Uint8Array; tag?: string; httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> }>();
  const obj = (key: string) => { const v = m.get(key)!; return { key, etag: v.tag || "test-etag", size: v.b.length, httpMetadata: v.httpMetadata, customMetadata: v.customMetadata, body: new Response(v.b as BodyInit).body, arrayBuffer: async () => v.b.slice().buffer, text: async () => new TextDecoder().decode(v.b), json: async () => JSON.parse(new TextDecoder().decode(v.b)) }; };
  let revision = 0;
  const R = {
    createMultipartUpload: async () => ({ uploadId: crypto.randomUUID(), abort: async () => {} }),
    resumeMultipartUpload: () => ({ abort: async () => {} }),
    put: async (key: string, b: ArrayBuffer | string | Uint8Array | Blob, o: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string>; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } } = {}) => { if (o.onlyIf?.etagMatches && (m.get(key)?.tag || "test-etag") !== o.onlyIf.etagMatches || o.onlyIf?.etagDoesNotMatch === "*" && m.has(key)) return null; m.set(key, { tag: String(++revision), b: typeof b === "string" ? new TextEncoder().encode(b) : b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array(b as ArrayBuffer), ...o }); return {}; },
    get: async (key: string, o?: { range?: { offset: number; length: number } }) => {   // R2 range 받기(조각 몸통 · size 는 전체)
      if (!m.has(key)) return null; const x = obj(key), r = o?.range; if (!r) return x;
      const b = m.get(key)!.b.slice(r.offset, r.offset + r.length); return { ...x, body: new Response(b as BodyInit).body, arrayBuffer: async () => b.slice().buffer };
    },
    head: async (key: string) => m.has(key) ? obj(key) : null,
    list: async (o: { prefix?: string; limit?: number; cursor?: string }) => {   // 진짜 R2 처럼 한 번에 limit(최대 1000)개 · cursor 로 다음 쪽
      const ks = [...m.keys()].filter(k => k.startsWith(o.prefix || "")).sort(), at = Number(o.cursor || 0), n = Math.min(o.limit || 1000, 1000), page = ks.slice(at, at + n);
      return { objects: page.map(obj), truncated: at + n < ks.length, cursor: at + n < ks.length ? String(at + n) : undefined };
    },
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
  copyFetch(m);
  const env = { ...directConfig, DB: D1, RESULTS: R, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, ASSETS: { fetch: async () => new Response("<html>로그인 화면</html>", { headers: { "content-type": "text/html" } }) },   // 화면 칸 알리기(live.ts)는 빈 것
    BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil(p: Promise<unknown>) { waits.push(p); }, passThroughOnException() {} };
  const go = (path: string, init: RequestInit = {}) => app.fetch(new Request("https://example.test" + path, init), env, ctx);
  const { put, init, control } = directHelpers(go, db, R);
  const view = async (email: string | null, path: string) => go(path, { headers: { accept: "text/html", "sec-fetch-dest": "iframe", ...(email ? { cookie: await cookie(email) } : {}) } });
  return { db, m, env, go, put, init, control, view, settle: async () => { await Promise.all(waits.splice(0)); } };
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
  assert.equal(await st(s.init(TOK.A, [{ path: "index.html", size: MC.LIMITS.file + 1 }])), 413);
  assert.equal(await st(s.init(TOK.A, [{ path: "index.html", size: MC.LIMITS.total }, { path: "big.bin", size: 1 }])), 413);
  const lots: Record<string, string> = { "index.html": PAGE };
  for (let i = 0; i < MC.LIMITS.files; i++) lots[`f${i}.txt`] = "x";
  assert.equal(await st(s.put(TOK.A, lots)), 413);
  assert.equal(s.m.size, 0);
  const mk = await MC.keyOf(A);
  //   상한(2000)은 R2 목록 한 쪽(1000)보다 커서 수 세기가 쪽을 넘겨 다 세야 함(첫 쪽만 세면 아래 429 가 안 남)
  for (let i = 0; i < MC.LIMITS.canvases - 1; i++) s.m.set(`mart/${mk}/_c/Filler${String(i).padStart(14, "0")}`, { b: new Uint8Array(), customMetadata: { title: "", acct: "", at: "1", ver: "v", n: "1", bytes: "1" } });
  assert.equal(await st(s.put(TOK.A, { "index.html": PAGE })), 200);
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

test("캔버스 댓글 같은 rid 로 다시 보내도 한 번만 저장(다시 보내기 · 화면이 같은 rid 를 씀), 다른 rid 는 따로", async () => {
  const s = await setup();
  const a = await (await s.put(TOK.A, { "index.html": PAGE })).json() as any;
  const post = (text: string, rid: string) => MC.artnote(s.env as never, A, { art: a.id, target: "t", page: "", text }, rid);
  const r1 = await post("같은 글", "rid1abcdefgh"), r2 = await post("같은 글", "rid1abcdefgh"), r3 = await post("같은 글", "rid2abcdefgh");
  assert.equal(r1[0], 200); assert.equal(r2[0], 200);
  const n = (s.db.prepare("SELECT COUNT(*) AS n FROM member_artnote WHERE owner = ? AND art = ? AND deleted_at IS NULL").get(A, a.id) as any).n;
  assert.equal(n, 2);   // rid1 두 번 = 1, rid2 = 1
  assert.equal(r3[0], 200);
});

test("지우기: 내 캔버스만 — 남의 · 없는 id 404, 토큰 없음 401, 모든 판 파일 · 표지 지움, 댓글 숨김, 남의 것 그대로", async () => {
  const s = await setup();
  const a = await (await s.put(TOK.A, { "index.html": PAGE, "a.png": new Uint8Array([1]) })).json() as any;
  const a2 = await (await s.put(TOK.A, { "index.html": PAGE + "2" })).json() as any;
  const b = await (await s.put(TOK.B, { "index.html": PAGE }, { id: a.id })).json() as any;   // 같은 id 를 남이 올려도 따로
  s.db.prepare("INSERT INTO member_artnote(owner, art, target, page, who, text, at) VALUES (?,?,?,?,?,?,?)").run(A, a.id, "t", "", "owner", "메모", 1);
  s.db.prepare("INSERT INTO member_artfolder(owner, art, folder, at) VALUES (?,?,?,?)").run(A, a.id, "폴더", 1);
  const del = (tok: string | null, id: string) => s.go(`/api/me/canvas/${id}`, { method: "DELETE", headers: tok ? { authorization: `Bearer ${tok}` } : {} });
  assert.equal((await del(null, a.id)).status, 401);
  assert.equal((await del(TOK.O, a.id)).status, 401);
  assert.equal((await del(TOK.A, "x".repeat(24))).status, 404);   // 없는 id
  const before = s.m.size;
  const r = await del(TOK.A, a.id);
  assert.equal(r.status, 200); assert.equal((await r.json() as any).ok, true);
  const mkA = await MC.keyOf(A), mkB = await MC.keyOf(B);
  assert.ok(![...s.m.keys()].some(k => k.startsWith(`mart/${mkA}/${a.id}/`) || k === `mart/${mkA}/_c/${a.id}`));
  assert.ok(s.m.has(`mart/${mkA}/_c/${a2.id}`));
  assert.ok(s.m.has(`mart/${mkB}/_c/${b.id}`));   // 남의 같은 id 도 그대로
  assert.ok(s.m.size < before);
  assert.equal((await s.view(A, `/art/${a.id}/`)).status, 404);
  assert.equal((await s.view(B, `/art/${b.id}/`)).status, 200);
  const note = s.db.prepare("SELECT deleted_at FROM member_artnote WHERE owner = ? AND art = ?").get(A, a.id) as any;
  assert.ok(note.deleted_at > 0);
  assert.equal((s.db.prepare("SELECT count(*) n FROM member_artfolder WHERE owner = ? AND art = ?").get(A, a.id) as any).n, 0);
  assert.equal((await del(TOK.A, a.id)).status, 404);   // 두 번째는 없음
  assert.equal((await del(TOK.A, b.id)).status, 404);   // 남의 id 로 (내겐 같은 id 가 이미 지워짐) — 남의 것은 안 지워짐
  assert.ok(s.m.has(`mart/${mkB}/_c/${b.id}`));
});

test("지우기: 파일 지우다 중간에 실패해도 표지가 남아 다시 rm 이 끝까지 지움", async () => {
  const s = await setup();
  const a = await (await s.put(TOK.A, { "index.html": PAGE, "a.png": new Uint8Array([1]), "b.css": "a{}" })).json() as any;
  const mk = await MC.keyOf(A), env = s.env as any, realDelete = env.RESULTS.delete;
  env.RESULTS.delete = async () => { throw new Error("R2 일시 오류"); };
  const del = () => s.go(`/api/me/canvas/${a.id}`, { method: "DELETE", headers: { authorization: `Bearer ${TOK.A}` } });
  assert.equal((await del()).status, 500);
  assert.ok(s.m.has(`mart/${mk}/_c/${a.id}`));   // 표지가 남아 있음 → 다시 지울 수 있음
  env.RESULTS.delete = realDelete;
  assert.equal((await del()).status, 200);
  assert.ok(![...s.m.keys()].some(k => k.includes(`/${a.id}`)));
  assert.equal((await del()).status, 404);
});

test("Range: 회원 캔버스 영상은 206 조각 · 끝 n 바이트 · 파일 밖 416, 로그인 · 표 길 둘 다(아이폰 사파리)", async () => {
  const s = await setup(), vid = new Uint8Array(5000).map((_, i) => i % 251);
  const j = await (await s.put(TOK.A, { "index.html": PAGE, "clip.mp4": vid })).json() as any;
  const get = async (path: string, range?: string, email: string | null = A) => s.go(path, { headers: { ...(range ? { range } : {}), ...(email ? { cookie: await cookie(email) } : {}) } });
  const r1 = await get(`/art/${j.id}/clip.mp4`, "bytes=0-1023");
  assert.equal(r1.status, 206); assert.equal(r1.headers.get("content-range"), "bytes 0-1023/5000"); assert.equal(r1.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(new Uint8Array(await r1.arrayBuffer()), vid.slice(0, 1024));
  const r2 = await get(`/art/${j.id}/clip.mp4`, "bytes=-100");
  assert.equal(r2.status, 206); assert.equal(r2.headers.get("content-range"), "bytes 4900-4999/5000");
  assert.deepEqual(new Uint8Array(await r2.arrayBuffer()), vid.slice(4900));
  const r3 = await get(`/art/${j.id}/clip.mp4`, "bytes=4000-");   // 끝 없는 꼴 · 끝 넘는 끝은 파일 끝으로
  assert.equal(r3.headers.get("content-range"), "bytes 4000-4999/5000"); assert.equal((await r3.arrayBuffer()).byteLength, 1000);
  const r4 = await get(`/art/${j.id}/clip.mp4`, "bytes=5000-");
  assert.equal(r4.status, 416); assert.equal(r4.headers.get("content-range"), "bytes */5000");
  const r5 = await get(`/art/${j.id}/clip.mp4`);   // Range 없으면 예전처럼 통째 200
  assert.equal(r5.status, 200); assert.equal((await r5.arrayBuffer()).byteLength, 5000);
  const t = await MC.token(SECRET, await MC.keyOf(A), j.id);
  const r6 = await get(`/art/${j.id}/clip.mp4?bxt=${t}`, "bytes=10-19", null);
  assert.equal(r6.status, 206); assert.equal(r6.headers.get("content-range"), "bytes 10-19/5000");
  assert.deepEqual(new Uint8Array(await r6.arrayBuffer()), vid.slice(10, 20));
  const r7 = await get(`/art/${j.id}/`, "bytes=0-9");   // 판(HTML)은 Range 를 안 봄 — 표를 끼운 통째
  assert.equal(r7.status, 200); assert.match(await r7.text(), /지어낸 글/);
});

test("목록 칸 at 은 주인 판처럼 서울 시각 「YYYY-MM-DD HH:MM」(표지의 초 · ms 숫자를 바꿈, 글자는 그대로)", async () => {
  const { seoulAt } = await import("./member-canvas.ts");
  assert.equal(seoulAt("1793818282"), "2026-11-05 03:51");
  assert.equal(seoulAt("1793818282123"), "2026-11-05 03:51");
  assert.equal(seoulAt("2026-11-05 08:18"), "2026-11-05 08:18");
  assert.equal(seoulAt(undefined), "");
});

test("썸네일 일감(2분마다): 캔버스 2000장 다 찍었어도 head 는 최근 · 돌아가는 조각 THUMB_SCAN 장씩 + 지정한 것만, 지정을 바꾼 옛 캔버스는 일감 · 판 바뀐 것은 맨 앞", async () => {
  const me = "alice@example.test", mk = await MC.keyOf(me), m = new Map<string, { b: string; customMetadata?: Record<string, string> }>();
  let heads = 0;
  const R = {
    head: async (k: string) => { heads++; return m.has(k) ? { customMetadata: m.get(k)!.customMetadata } : null; },
    get: async (k: string) => m.has(k) ? { text: async () => m.get(k)!.b } : null,
    list: async (o: { prefix?: string; limit?: number; cursor?: string }) => {
      const ks = [...m.keys()].filter(k => k.startsWith(o.prefix || "")).sort(), at = Number(o.cursor || 0), n = Math.min(o.limit || 1000, 1000);
      return { objects: ks.slice(at, at + n).map(key => ({ key, customMetadata: m.get(key)!.customMetadata })), truncated: at + n < ks.length, cursor: String(at + n) };
    },
  };
  const id = (i: number) => "Cv" + String(i).padStart(18, "0"), cvj = JSON.stringify({ boards: { "A.dc.html": { w: 800, h: 600 }, "B.dc.html": { w: 900, h: 700 } }, order: ["A.dc.html"] });
  for (let i = 0; i < 2000; i++) {   // i 가 클수록 최근(at) — 다 찍혀 있음(썸네일 ver = 판)
    m.set(`mart/${mk}/_c/${id(i)}`, { b: "{}", customMetadata: { title: "", acct: "", at: String(1000 + i), ver: "v1", n: "1", bytes: "1", kind: "canvas", cv: "" } });
    m.set(`mart/${mk}/${id(i)}/v1/canvas.json`, { b: cvj });
    m.set(`mart/${mk}/${id(i)}/${MC.THUMB}`, { b: "", customMetadata: { ver: "v1", pref: "" } });
  }
  const pref: { art: string; thumb: string }[] = [];
  const DB = { prepare: (sql: string) => {
    const rows = () => /FROM invite/.test(sql) ? [{ email: me }] : pref;
    return { all: async () => ({ results: rows() }), bind: () => ({ all: async () => ({ results: rows() }) }) };
  } };
  const env = { DB, RESULTS: R, BETTER_AUTH_SECRET: "test-secret-not-real" } as never;
  assert.deepEqual(await MC.thumbJobs(env, 8), []);
  assert.ok(heads <= 2 * MC.THUMB_SCAN, `head ${heads} 번 — 2000 이 아니라 최근 + 돌아가는 조각 ${2 * MC.THUMB_SCAN} 장까지만`);
  pref.push({ art: id(3), thumb: "B.dc.html" }); heads = 0;
  const j1 = await MC.thumbJobs(env, 8);
  assert.deepEqual(j1.map(j => [j.art, j.board, j.pref]), [[id(3), "B.dc.html", "B.dc.html"]]);
  assert.ok(heads <= 2 * MC.THUMB_SCAN + 1, String(heads));
  m.set(`mart/${mk}/_c/${id(5)}`, { b: "{}", customMetadata: { title: "", acct: "", at: "9999", ver: "v2", n: "1", bytes: "1", kind: "canvas", cv: "" } });
  m.set(`mart/${mk}/${id(5)}/v2/canvas.json`, { b: cvj });
  assert.deepEqual((await MC.thumbJobs(env, 8)).map(j => j.art), [id(5), id(3)]);
});

test("썸네일 일감: 최근 200장 밖으로 밀린 옛 캔버스(썸네일 없음)도 시각이 지나면 돌아가는 조각으로 결국 일감", async () => {
  const me = "alice@example.test", mk = await MC.keyOf(me), m = new Map<string, { b: string; customMetadata?: Record<string, string> }>();
  let heads = 0;
  const R = {
    head: async (k: string) => { heads++; return m.has(k) ? { customMetadata: m.get(k)!.customMetadata } : null; },
    get: async (k: string) => m.has(k) ? { text: async () => m.get(k)!.b } : null,
    list: async (o: { prefix?: string; limit?: number; cursor?: string }) => {
      const ks = [...m.keys()].filter(k => k.startsWith(o.prefix || "")).sort(), at = Number(o.cursor || 0), n = Math.min(o.limit || 1000, 1000);
      return { objects: ks.slice(at, at + n).map(key => ({ key, customMetadata: m.get(key)!.customMetadata })), truncated: at + n < ks.length, cursor: String(at + n) };
    },
  };
  const id = (i: number) => "Cv" + String(i).padStart(18, "0"), cvj = JSON.stringify({ boards: { "A.dc.html": { w: 800, h: 600 } }, order: ["A.dc.html"] });
  for (let i = 0; i < 2000; i++) {   // 최근 200장(i ≥ 1800)만 찍혀 있고, 옛 1800장은 썸네일 없음(한꺼번에 올려 밀린 꼴)
    m.set(`mart/${mk}/_c/${id(i)}`, { b: "{}", customMetadata: { title: "", acct: "", at: String(1000 + i), ver: "v1", n: "1", bytes: "1", kind: "canvas", cv: "" } });
    m.set(`mart/${mk}/${id(i)}/v1/canvas.json`, { b: cvj });
    if (i >= 1800) m.set(`mart/${mk}/${id(i)}/${MC.THUMB}`, { b: "", customMetadata: { ver: "v1", pref: "" } });
  }
  const DB = { prepare: (sql: string) => { const rows = () => /FROM invite/.test(sql) ? [{ email: me }] : []; return { all: async () => ({ results: rows() }), bind: () => ({ all: async () => ({ results: rows() }) }) }; } };
  const env = { DB, RESULTS: R, BETTER_AUTH_SECRET: "test-secret-not-real" } as never;
  const seen = new Set<string>(); let maxHeads = 0;
  for (let t = 0; t < 10; t++) {   // 2분씩 열 번 = 한 바퀴 — 찍은 셈 치고 다음으로
    heads = 0;
    const js = await MC.thumbJobs(env, 2000, new Set(), t * 120_000);
    maxHeads = Math.max(maxHeads, heads);
    for (const j of js) { seen.add(j.art); m.set(`mart/${mk}/${j.art}/${MC.THUMB}`, { b: "", customMetadata: { ver: j.ver, pref: j.pref } }); }
  }
  assert.equal(seen.size, 1800, `옛 1800장 중 ${seen.size} 장만 일감`);
  assert.ok(maxHeads <= 2 * MC.THUMB_SCAN, `한 번에 head ${maxHeads} 번 — 최근 + 조각 ${2 * MC.THUMB_SCAN} 이하`);
});

test("직접 올리기: 500MiB 딱 허용 · 1바이트 초과 거절 · 구형 multipart는 별도 검증", async () => {
  const s = await setup();
  assert.equal(MC.LIMITS.file, 524288000); assert.equal(MC.LIMITS.total, 524288000);
  const r = await s.init(TOK.A, [{ path: "index.html", size: MC.LIMITS.file }]);
  assert.equal(r.status, 200);
  const batch = await r.json() as any;
  assert.equal(batch.uploads[0].size, 524288000);
  assert.ok(batch.uploads[0].parts > 1);
  assert.equal(s.m.size, 0); // 500MiB 선언만 보냈으며 본문 할당이나 Worker 전송 없음
  assert.equal((await s.init(TOK.A, [{ path: "index.html", size: MC.LIMITS.file + 1 }])).status, 413);
  assert.equal((await s.init(TOK.A, [{ path: "index.html", size: -1 }])).status, 400);
  const fd = new FormData(); fd.set("f0", new Blob(["아주 작은 파일"]));
  const legacy = await s.go("/api/me/canvas", { method: "POST", headers: { authorization: `Bearer ${TOK.A}` }, body: fd });
  assert.equal(legacy.status, 400); assert.equal(legacy.headers.get("deprecation"), "true");
  assert.equal((await s.control(TOK.A, "/abort", { session: batch.session })).status, 200);
});

test("직접 올리기: 서명 · 회원 · 파일 세션 경계와 전송 완료 확인 뒤 게시", async () => {
  const s = await setup(), batch = await (await s.init(TOK.A, [{ path: "index.html", size: 7 }], { title: "직접 전송" })).json() as any;
  const id = batch.uploads[0].id, ctl = { session: batch.session, index: 0, id, number: 1 };
  assert.equal((await s.control(TOK.B, "/upload/part", ctl)).status, 404);
  assert.equal((await s.control(TOK.B, "/upload/complete", ctl)).status, 404);
  assert.equal((await s.control(TOK.A, "/upload/part", { ...ctl, id: "0".repeat(32) })).status, 404);
  assert.equal((await s.control(TOK.A, "/upload/part", { ...ctl, index: 1 })).status, 404);
  assert.equal((await s.control(TOK.A, "/upload/part", { ...ctl, session: batch.session + "x" })).status, 404);
  assert.equal((await s.control(TOK.A, "/publish", { session: batch.session })).status, 409);
  const signed = await s.control(TOK.A, "/upload/part", ctl); assert.equal(signed.status, 200);
  assert.match((await signed.json() as any).url, /^https:\/\/canvas-test\.r2\.cloudflarestorage\.com\//);
  const row = s.db.prepare("SELECT * FROM direct_upload WHERE id = ?").get(id) as any;
  // 파일 전송은 R2 쪽에서만 일어나는 것으로 흉내 낸다. Worker에는 JSON 제어만 보낸다.
  await s.env.RESULTS.put(row.source, "<p></p>", { httpMetadata: { contentType: row.mime }, customMetadata: JSON.parse(row.metadata) });
  assert.equal((await s.control(TOK.A, "/upload/complete", { ...ctl, parts: [{ partNumber: 1, etag: "test-etag" }] })).status, 200);
  assert.equal((await s.control(TOK.A, "/publish", { session: batch.session })).status, 200);
  assert.equal((await s.control(TOK.A, "/publish", { session: batch.session })).status, 200); // 응답 유실 뒤 재시도
  assert.equal((await s.control(TOK.A, "/upload/part", ctl)).status, 409);
  assert.equal((await s.control(TOK.A, "/abort", { session: batch.session })).status, 200);
  assert.equal((await s.view(A, `/art/${batch.id}/`)).status, 200); // 게시 뒤 취소로 파일이 지워지지 않음
  assert.equal((await s.put(TOK.A, { "index.html": "다음 판" }, { id: batch.id })).status, 200);
  assert.equal((await s.control(TOK.A, "/publish", { session: batch.session })).status, 409);
});

test("직접 올리기: 빈 부속 파일 지원 · 전송 중 취소는 새 판만 정리", async () => {
  const s = await setup(), first = await (await s.put(TOK.A, { "index.html": PAGE, "empty.css": "" })).json() as any;
  assert.equal((await s.view(A, `/art/${first.id}/empty.css`)).status, 200);
  const batch = await (await s.init(TOK.A, [{ path: "index.html", size: 1 }, { path: "x.css", size: 0 }], { id: first.id })).json() as any;
  const row = s.db.prepare("SELECT * FROM direct_upload WHERE id = ?").get(batch.uploads[0].id) as any;
  await s.env.RESULTS.put(row.source, "x", { customMetadata: JSON.parse(row.metadata) });
  assert.equal((await s.control(TOK.A, "/upload/complete", { session: batch.session, index: 0, id: row.id, parts: [] })).status, 200);
  assert.equal((await s.control(TOK.A, "/abort", { session: batch.session })).status, 200);
  const mk = await MC.keyOf(A);
  assert.ok(![...s.m.keys()].some(k => k.startsWith(`mart/${mk}/${first.id}/${batch.ver}/`)));
  assert.match(await (await s.view(A, `/art/${first.id}/`)).text(), /지어낸 글/);
  assert.equal((await s.control(TOK.A, "/upload/part", { session: batch.session, index: 1, id: batch.uploads[1].id, number: 1 })).status, 409);
});

test("큰 Design HTML은 SHIM을 앞64KiB에만 끼운 스트림 · 큰 canvas.json은 구조 파싱하지 않음", async () => {
  const s = await setup();
  const j = await (await s.put(TOK.A, { "canvas.json": JSON.stringify({ title: "스트림", boards: { "Overview.dc.html": {} } }), "Overview.dc.html": "<head></head><body>작은 판</body>" })).json() as any;
  await s.env.RESULTS.put("art/_sys/index.json", JSON.stringify({ v: 1, at: 1, arts: {}, blobs: {}, shim: btoa("<meta name='stream-shim'>") }));
  const get = s.env.RESULTS.get.bind(s.env.RESULTS), mk = await MC.keyOf(A);
  let fullReads = 0;
  (s.env.RESULTS as any).get = async (key: string, options: any) => {
    const o = await get(key, options); if (!o) return null;
    if (key.endsWith("/Overview.dc.html")) return { ...o, size: MC.LIMITS.file,
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("<head></head><body>" + "x".repeat(70000))); c.enqueue(new TextEncoder().encode("마지막</body>")); c.close(); } }),
      arrayBuffer: async () => { fullReads++; throw new Error("통째 읽기 금지"); }, text: async () => { fullReads++; throw new Error("통째 읽기 금지"); } };
    if (key.endsWith("/canvas.json")) return { ...o, size: MC.LIMITS.file, text: async () => { fullReads++; throw new Error("큰 JSON 파싱 금지"); } };
    return o;
  };
  const result = await MC.file(s.env as never, mk, j.id, "Overview.dc.html");
  const html = await new Response(result!.body as BodyInit).text();
  assert.match(html, /<meta name='stream-shim'><\/head>/); assert.match(html, /마지막<\/body>$/);
  assert.equal((await MC.artthumb(s.env as never, A, { art: j.id, board: "Overview.dc.html" }))[0], 400);
  assert.equal(fullReads, 0);
});


test("직접 올린 썸네일의 한글 판 이름은 metadata prefencoded 표에 따라 디코딩", () => {
  assert.equal(MC.thumbStale({ ver: "v", pref: encodeURIComponent("설계.dc.html"), prefencoded: "1" }, { ver: "v" }, "설계.dc.html"), false);
  assert.equal(MC.thumbStale({ ver: "v", pref: "%ZZ", prefencoded: "1" }, { ver: "v" }, "설계.dc.html"), true);
  assert.equal(MC.thumbStale({ ver: "v", pref: "설계.dc.html" }, { ver: "v" }, "설계.dc.html"), false);
});

test("캔버스 게시 잠금은 취소·추가 조각 발급과 배타적 · 만료된 미게시 판만 정리", async () => {
  const s = await setup(), first = await (await s.put(TOK.A, { "index.html": PAGE })).json() as any;
  const batch = await (await s.init(TOK.A, [{ path: "index.html", size: 1 }], { id: first.id })).json() as any;
  const row = s.db.prepare("SELECT * FROM direct_upload WHERE id = ?").get(batch.uploads[0].id) as any;
  await s.env.RESULTS.put(row.source, "x", { customMetadata: JSON.parse(row.metadata) });
  assert.equal((await s.control(TOK.A, "/upload/complete", { session: batch.session, index: 0, id: row.id, parts: [] })).status, 200);
  const mk = await MC.keyOf(A), key = `${mk}/${first.id}/${batch.ver}`;
  s.db.prepare("UPDATE canvas_upload SET state='publishing' WHERE id=?").run(key);
  assert.equal((await s.control(TOK.A, "/abort", { session: batch.session })).status, 409);
  assert.equal((await s.control(TOK.A, "/upload/part", { session: batch.session, index: 0, id: row.id, number: 1 })).status, 409);
  s.db.prepare("UPDATE canvas_upload SET expires=?").run(Date.now() - 16 * 60_000);
  await MC.sweepUploads(s.env as never);
  assert.ok(![...s.m.keys()].some(k => k.startsWith(`mart/${mk}/${first.id}/${batch.ver}/`)));
  assert.match(await (await s.view(A, `/art/${first.id}/`)).text(), /지어낸 글/);
  assert.equal((s.db.prepare("SELECT count(*) n FROM canvas_upload").get() as any).n, 0);
});

test("게시·취소 중 강제 종료: 5분 지난 잠금 재획득, 표지 게시 뒤 완료 영수증 복구", async () => {
  const s = await setup(), batch = await (await s.init(TOK.A, [{ path: "index.html", size: 1 }])).json() as any;
  const id = batch.uploads[0].id, row = s.db.prepare("SELECT * FROM direct_upload WHERE id=?").get(id) as any;
  await s.env.RESULTS.put(row.source, "x", { customMetadata: JSON.parse(row.metadata) });
  assert.equal((await s.control(TOK.A, "/upload/complete", { session: batch.session, index: 0, id, parts: [] })).status, 200);
  const mk = await MC.keyOf(A), key = `${mk}/${batch.id}/${batch.ver}`;
  s.db.prepare("UPDATE canvas_upload SET state='publishing', locked_at=? WHERE id=?").run(Date.now() - 6 * 60_000, key);
  assert.equal((await s.control(TOK.A, "/publish", { session: batch.session })).status, 200);
  s.db.prepare("UPDATE canvas_upload SET state='publishing', locked_at=? WHERE id=?").run(Date.now(), key);
  assert.equal((await s.control(TOK.A, "/publish", { session: batch.session })).status, 200);
  assert.equal((s.db.prepare("SELECT state FROM canvas_upload WHERE id=?").get(key) as any).state, "done");
  const cancelled = await (await s.init(TOK.A, [{ path: "index.html", size: 1 }], { id: batch.id })).json() as any;
  const cancelledKey = `${mk}/${batch.id}/${cancelled.ver}`;
  s.db.prepare("UPDATE canvas_upload SET state='aborting', locked_at=? WHERE id=?").run(Date.now() - 6 * 60_000, cancelledKey);
  assert.equal((await s.control(TOK.A, "/abort", { session: cancelled.session })).status, 200);
  assert.equal((s.db.prepare("SELECT state FROM canvas_upload WHERE id=?").get(cancelledKey) as any).state, "aborted");
  assert.equal((await s.view(A, `/art/${batch.id}/`)).status, 200);
});

test("캔버스 정리: 완료·취소 행은 일괄 삭제, 미게시 판은 같은 20개 예산을 반복해 모두 정리", async () => {
  const s = await setup(), published = await (await s.put(TOK.A, { "index.html": PAGE })).json() as any;
  const mk = await MC.keyOf(A), expired = Date.now() - 16 * 60_000;
  s.db.prepare("UPDATE canvas_upload SET expires=?").run(expired);
  const insert = s.db.prepare("INSERT INTO canvas_upload(id,owner,state,expires) VALUES (?,?,?,?)");
  for (let i = 0; i < 250; i++) insert.run(`${mk}/TerminalCanvas0000000001/v${i}`, A, i < 200 ? "done" : "aborted", expired);
  for (let i = 0; i < 45; i++) {
    const id = "DrainCanvas" + String(i).padStart(16, "0");
    insert.run(`${mk}/${id}/v1`, A, "open", expired);
    s.m.set(`mart/${mk}/${id}/v1/index.html`, { b: new Uint8Array([1]) });
  }
  let lists = 0;
  const list = s.env.RESULTS.list.bind(s.env.RESULTS);
  (s.env.RESULTS as any).list = (...args: any[]) => { lists++; return list(...args); };
  const remaining = () => (s.db.prepare("SELECT count(*) n FROM canvas_upload").get() as any).n;
  for (const expected of [25, 5, 0]) {
    lists = 0; await MC.sweepUploads(s.env as never);
    assert.equal(remaining(), expected); assert.ok(lists <= 20, `R2 청소 ${lists}개, 한 번에 20개 이하`);
  }
  assert.equal((await s.view(A, `/art/${published.id}/`)).status, 200);
  assert.ok(![...s.m.keys()].some(key => /\/DrainCanvas/.test(key)));
});

function oldCanvas(s: any, token: string, files: Record<string, string | Uint8Array>, options: Record<string, string> = {}) {
  const fd = new FormData(), paths = Object.keys(files);
  fd.set("manifest", JSON.stringify(paths.map(path => ({ path }))));
  for (const [index, path] of paths.entries()) fd.set(`f${index}`, new Blob([files[path] as BlobPart]), path.split("/").pop());
  for (const [key, value] of Object.entries(options)) fd.set(key, value);
  return s.go("/api/me/canvas", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
}
test("구형 CLI multipart는 새 Worker에서도 구한도·기존 제목·새 판·회원 경계 유지, Deprecation 표시", async () => {
  const s = await setup();
  assert.equal((await oldCanvas(s, TOK.O, { "index.html": PAGE })).status, 401);
  const response = await oldCanvas(s, TOK.A, { "index.html": PAGE, "a.png": new Uint8Array([1, 2, 3]) }, { acct: "구형", win: "test:window", wid: "ew_legacy0001" });
  assert.equal(response.status, 200); assert.equal(response.headers.get("deprecation"), "true");
  const a = await response.json() as any;
  assert.equal(a.title, "가상 보고서"); assert.equal(a.files, 2); assert.equal(a.replaced, false);
  assert.equal((await s.view(B, `/art/${a.id}/`)).status, 404);
  assert.match(await (await s.view(A, `/art/${a.id}/`)).text(), /지어낸 글/);
  const next = await oldCanvas(s, TOK.A, { "index.html": "<title>다음 판</title>" }, { id: a.id });
  assert.equal(next.status, 200); assert.equal((await next.json() as any).replaced, true);
  await s.settle(); assert.equal((await s.view(A, `/art/${a.id}/a.png`)).status, 404);
  assert.equal((s.db.prepare("SELECT count(*) n FROM direct_upload").get() as any).n, 0);
  assert.equal((await oldCanvas(s, TOK.A, { "index.html": PAGE, "../outside": "x" })).status, 400);
});

test("서명 설정이 없어도 구형 CLI는 게시, 새 JSON init은 식별 가능한503 · 일반 JSON 오류는400", async () => {
  const s = await setup(); delete (s.env as any).R2_BOARDER_ACCESS_KEY_ID; delete (s.env as any).R2_BOARDER_SECRET_ACCESS_KEY;
  const init = await s.init(TOK.A, [{ path: "index.html", size: 1 }]);
  assert.equal(init.status, 503); assert.equal((await init.json() as any).code, "direct_upload_unavailable");
  const legacy = await oldCanvas(s, TOK.A, { "index.html": PAGE });
  assert.equal(legacy.status, 200); assert.equal(legacy.headers.get("deprecation"), "true");
  assert.equal((await s.init(TOK.A, [{ path: "../invalid", size: 1 }])).status, 400);
});

test("multipart 구한도는 10MiB/파일·25MiB/묶음 그대로, 정확히25MiB 허용·1바이트 초과 거절", async () => {
  const s = await setup(), MiB = 1024 * 1024;
  assert.deepEqual(MC.LEGACY_LIMITS, { file: 10 * MiB, total: 25 * MiB });
  const files = { "index.html": "", "a.bin": new Uint8Array(10 * MiB), "b.bin": new Uint8Array(10 * MiB), "c.bin": new Uint8Array(5 * MiB) };
  const exact = await oldCanvas(s, TOK.A, files); assert.equal(exact.status, 200);
  assert.equal((await exact.json() as any).bytes, 25 * MiB);
  assert.equal((await oldCanvas(s, TOK.A, { ...files, "c.bin": new Uint8Array(5 * MiB + 1) })).status, 413);
  assert.equal((await oldCanvas(s, TOK.A, { "index.html": "", "too-big.bin": new Uint8Array(10 * MiB + 1) })).status, 413);
});

test('0093 이주 전의 옛 multipart 유지, 키가 있어도 없는 테이블은 준비안됨503',async()=>{
 for(const drop of ['DROP TABLE direct_upload; DROP TABLE canvas_upload','DROP TABLE canvas_upload']){
  const s=await setup();s.db.exec(drop);
  const init=await s.init(TOK.A,[{path:'index.html',size:1}]);assert.equal(init.status,503);
  assert.equal((await init.json() as any).code,'direct_upload_unavailable');
  const old=await oldCanvas(s,TOK.A,{'index.html':PAGE});assert.equal(old.status,200);assert.equal(old.headers.get('deprecation'),'true');
  assert.equal((await s.view(A,`/art/${(await old.json() as any).id}/`)).status,200);
 }
});
