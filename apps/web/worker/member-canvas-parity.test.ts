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
function d1() {   // member-parity.test 의 가짜 D1(+ first(col) · raw — index.ts 로그인 길이 씀)
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const exec = (sql: string, args: unknown[]) => { const st = db.prepare(sql); if ((/^\s*(select|with)/i.test(sql) || /\bRETURNING\b/i.test(sql))) return { success: true, results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } }; const r = st.run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    first: async (col?: string) => { const r = exec(sql, args).results[0] as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    all: async () => exec(sql, args), run: async () => exec(sql, args), raw: async () => exec(sql, args).results.map(r => Object.values(r)) });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => { db.exec("BEGIN"); try { const o = ss.map(s => exec(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { db.exec("ROLLBACK"); throw e; } } } as unknown as D1Database;
  return { db, D1 };
}
function r2() {
  const m = new Map<string, { b: Uint8Array; tag?: string; httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> }>();
  const obj = (key: string) => { const v = m.get(key)!; return { key, etag: v.tag || "test-etag", size: v.b.length, httpMetadata: v.httpMetadata, customMetadata: v.customMetadata, body: new Response(v.b as BodyInit).body, arrayBuffer: async () => v.b.slice().buffer, text: async () => new TextDecoder().decode(v.b), json: async () => JSON.parse(new TextDecoder().decode(v.b)) }; };
  let revision = 0;
  const R = {
    createMultipartUpload: async () => ({ uploadId: crypto.randomUUID(), abort: async () => {} }),
    resumeMultipartUpload: () => ({ abort: async () => {} }),
    put: async (key: string, b: ArrayBuffer | string | Uint8Array | Blob, o: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string>; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } } = {}) => { if (o.onlyIf?.etagMatches && (m.get(key)?.tag || "test-etag") !== o.onlyIf.etagMatches || o.onlyIf?.etagDoesNotMatch === "*" && m.has(key)) return null; m.set(key, { tag: String(++revision), b: typeof b === "string" ? new TextEncoder().encode(b) : b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array(b as ArrayBuffer), ...o }); return {}; },
    get: async (key: string) => m.has(key) ? obj(key) : null,
    head: async (key: string) => m.has(key) ? obj(key) : null,
    list: async (o: { prefix?: string }) => ({ objects: [...m.keys()].filter(k => k.startsWith(o.prefix || "")).sort().map(obj), truncated: false }),
    delete: async (k: string | string[]) => { for (const x of Array.isArray(k) ? k : [k]) m.delete(x); },
  };
  return { m, R: R as unknown as R2Bucket };
}

const OWNER = "owner@example.test", A = "alice@example.test", B = "bob@example.test", SECRET = "test-secret-not-real";
const TOK = { A: "bxd_" + "a".repeat(40), B: "bxd_" + "b".repeat(40) };
const SHIM = "<style>x-dc{display:block}</style>";   // 주인 색인 SHIM 자리(지어낸 짧은 것)
const SHELL = "<!doctype html><html><head><title>__TITLE__</title></head><body><b>__TITLE__</b><script>/* 껍데기 */</script></body></html>";
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
  for (const [k, e] of [["A", A], ["B", B]] as const) db.prepare("INSERT INTO device(id, owner, name, token_hash, created_at, scope) VALUES (?,?,?,?,?,?)").run("dev" + k, e, "시험", await sha(TOK[k]), 1, "full");
  db.prepare(`INSERT INTO "user"(id, name, email, emailVerified, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`).run("u-a", "앨리스<가상>", A, 1, "2026-11-02", "2026-11-02");
  await R.put("art/_sys/artcanvas.html", SHELL);
  await R.put("art/_sys/index.json", JSON.stringify({ v: 1, at: 1, arts: {}, blobs: {}, shim: btoa(SHIM) }));
  copyFetch(m);
  const env = { ...directConfig, DB: D1, RESULTS: R, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, ASSETS: { fetch: async () => new Response("<html>로그인 화면</html>", { headers: { "content-type": "text/html" } }) },
    BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test", ADMIN_TOKEN: "admin-test-not-real" };
  const ctx = { waitUntil(p: Promise<unknown>) { waits.push(p); }, passThroughOnException() {} };
  const go = (path: string, init: RequestInit = {}) => app.fetch(new Request("https://example.test" + path, init), env, ctx);
  const { put, init, control } = directHelpers(go, db, R);
  const view = async (email: string | null, path: string) => go(path, { headers: { accept: "text/html", ...(email ? { cookie: await cookie(email) } : {}) } });
  const getj = async (email: string, path: string) => { const r = await go(path, { headers: { accept: "application/json", cookie: await cookie(email) } }); return { status: r.status, j: await r.json() as any }; };
  const post = async (email: string, path: string, body: unknown, h: Record<string, string> = {}) => {
    const r = await go(path, { method: "POST", headers: { "content-type": "application/json", "x-hb": "1", "sec-fetch-site": "same-origin", cookie: await cookie(email), ...h }, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json() as any };
  };
  return { db, m, go, put, init, control, view, getj, post };
}
const PAGE = "<!doctype html><html><head><title>가상 페이지</title></head><body>지어낸 글</body></html>";
const CANVAS = { title: "가상 설계안", boards: { "Overview.dc.html": { x: 0, y: 0, w: 800, h: 600 } }, order: ["Overview.dc.html"] };
const BOARD = "<!doctype html><html><head><title>판</title></head><body><x-dc>지어낸 판</x-dc></body></html>";

test("댓글 · 핀: 주인 꼴(notes · {id,target,page,who,text,at}) — 쓰기 · 지우기 · 목록 칸 수, 남의 캔버스 · 없는 id 는 404", async () => {
  const s = await setup();
  const a = await (await s.put(TOK.A, { "index.html": PAGE })).json() as any;
  assert.deepEqual(await s.getj(A, `/api/artnotes/${a.id}`), { status: 200, j: { notes: [] } });
  let r = await s.post(A, "/api/artnote", { art: a.id, target: "*", page: "", text: "  지어낸 댓글  " });
  assert.equal(r.status, 200); assert.equal(r.j.ok, true); assert.equal(r.j.notes.length, 1);
  const n = r.j.notes[0];
  assert.deepEqual(Object.keys(n).sort(), ["at", "id", "page", "target", "text", "who"]);
  assert.equal(n.text, "지어낸 댓글"); assert.equal(n.who, "owner"); assert.equal(typeof n.at, "number");
  r = await s.post(A, "/api/artnote", { art: a.id, target: "Overview.dc.html", page: "p1", text: "📍1 (10%, 20%) 여기" });
  assert.equal(r.j.notes.length, 2); assert.equal(r.j.notes[1].page, "p1");
  assert.deepEqual((await s.getj(A, `/api/artnotes/${a.id}`)).j.notes.map((x: any) => x.text), ["지어낸 댓글", "📍1 (10%, 20%) 여기"]);
  assert.equal((await s.getj(A, "/api/arts")).j[a.id].notes, 2);
  // 빈 댓글 · 빈 target 은 400
  assert.equal((await s.post(A, "/api/artnote", { art: a.id, target: "*", text: "  " })).status, 400);
  assert.equal((await s.post(A, "/api/artnote", { art: a.id, text: "글" })).status, 400);
  // 지우기
  r = await s.post(A, "/api/artnote", { art: a.id, del: n.id });
  assert.equal(r.status, 200); assert.deepEqual(r.j.notes.map((x: any) => x.text), ["📍1 (10%, 20%) 여기"]);
  assert.equal((await s.getj(A, "/api/arts")).j[a.id].notes, 1);
  // 남(B): 읽기 · 쓰기 · 지우기 · 폴더 모두 404, A 의 글은 그대로
  assert.equal((await s.getj(B, `/api/artnotes/${a.id}`)).status, 404);
  assert.equal((await s.post(B, "/api/artnote", { art: a.id, target: "*", text: "남의 글" })).status, 404);
  assert.equal((await s.post(B, "/api/artnote", { art: a.id, del: r.j.notes[0].id })).status, 404);
  assert.equal((await s.post(B, "/api/artfolder", { art: a.id, folder: "남/폴더" })).status, 404);
  assert.equal((s.db.prepare("SELECT count(*) AS n FROM member_artnote WHERE deleted_at IS NULL").get() as any).n, 1);
  assert.equal((s.db.prepare("SELECT count(*) AS n FROM member_artfolder").get() as any).n, 0);
  // 없는 id · 꼴 틀린 id
  assert.equal((await s.getj(A, "/api/artnotes/NoSuchCanvas000000000001")).status, 404);
  assert.equal((await s.post(A, "/api/artnote", { art: "x", target: "*", text: "글" })).status, 404);
  // B 가 같은 id 로 올려도 댓글은 따로
  assert.equal((await s.put(TOK.B, { "index.html": PAGE }, { id: a.id })).status, 200);
  assert.deepEqual(await s.getj(B, `/api/artnotes/${a.id}`), { status: 200, j: { notes: [] } });
  assert.equal((await s.post(B, "/api/artnote", { art: a.id, target: "*", text: "B 의 글" })).j.notes.length, 1);
  assert.equal((await s.getj(A, `/api/artnotes/${a.id}`)).j.notes.length, 1);
  // 로그인 없으면 401 · 다른 사이트 POST 는 403
  assert.equal((await s.go(`/api/artnotes/${a.id}`)).status, 401);
  assert.equal((await s.post(A, "/api/artnote", { art: a.id, target: "*", text: "글" }, { "sec-fetch-site": "cross-site" })).status, 403);
});

test("같은 rid 로 다시 보낸 댓글은 한 번만", async () => {
  const s = await setup();
  const a = await (await s.put(TOK.A, { "index.html": PAGE })).json() as any;
  const rid = "r" + "1".repeat(20);
  const one = await s.post(A, "/api/artnote", { art: a.id, target: "*", text: "한 번", rid });
  const two = await s.post(A, "/api/artnote", { art: a.id, target: "*", text: "한 번", rid });
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  assert.equal(two.j.notes.length, one.j.notes.length);
});

test("폴더 옮기기: 주인 꼴 {ok, folder} — 칸 다듬기 · 목록 folder · moved, 빈 값이면 자동 분류로", async () => {
  const s = await setup();
  const a = await (await s.put(TOK.A, { "index.html": PAGE })).json() as any;
  assert.deepEqual((await s.getj(A, "/api/arts")).j[a.id], { kind: "page", title: "가상 페이지", at: (await s.getj(A, "/api/arts")).j[a.id].at, acct: "", folder: "캔버스", moved: false, notes: 0, pin: false, thumb: "" });
  let r = await s.post(A, "/api/artfolder", { art: a.id, folder: "  가상   영역 / 리포트 //" });
  assert.deepEqual(r, { status: 200, j: { ok: true, folder: "가상 영역/리포트" } });
  let it = (await s.getj(A, "/api/arts")).j[a.id];
  assert.equal(it.folder, "가상 영역/리포트"); assert.equal(it.moved, true);
  r = await s.post(A, "/api/artfolder", { art: a.id, folder: "" });
  assert.deepEqual(r, { status: 200, j: { ok: true, folder: "캔버스" } });
  it = (await s.getj(A, "/api/arts")).j[a.id];
  assert.equal(it.folder, "캔버스"); assert.equal(it.moved, false);
});

test("Design 캔버스(canvas.json): kind canvas · 껍데기(artcanvas) + 같은 sandbox CSP · 판은 project/ 에서 찾고 SHIM · support.js 빈 대역", async () => {
  const s = await setup();
  const r = await s.put(TOK.A, { "project/canvas.json": JSON.stringify(CANVAS), "project/Overview.dc.html": BOARD, "project/_assets/a.png": "png" });
  assert.equal(r.status, 200);   // index.html 없어도 됨
  const c = await r.json() as any;
  assert.equal(c.kind, "canvas"); assert.equal(c.title, "가상 설계안");   // canvas.json title
  const arts = (await s.getj(A, "/api/arts")).j;
  assert.equal(arts[c.id].kind, "canvas"); assert.equal(arts[c.id].title, "가상 설계안");
  const sh = await s.view(A, `/art/${c.id}/`);
  assert.equal(sh.status, 200);
  assert.equal(sh.headers.get("content-security-policy"), "sandbox allow-scripts allow-popups allow-downloads; form-action 'none'");
  assert.equal(sh.headers.get("x-content-type-options"), "nosniff");
  const html = await sh.text();
  assert.match(html, /<title>가상 설계안<\/title>/); assert.match(html, /\/\* 껍데기 \*\//); assert.doesNotMatch(html, /__TITLE__/);
  assert.match(html, /^<!doctype html><html><head><script>window\.HB_SELF="앨리스\\u003c가상>"<\/script>/);
  const cj = await s.view(A, `/art/${c.id}/canvas.json`);
  assert.equal(cj.status, 200); assert.deepEqual(await cj.json(), CANVAS);
  assert.equal(cj.headers.get("content-security-policy"), "sandbox allow-scripts allow-popups allow-downloads; form-action 'none'");
  const bd = await s.view(A, `/art/${c.id}/Overview.dc.html`);
  assert.equal(bd.status, 200);
  const bh = await bd.text();
  assert.match(bh, /지어낸 판/); assert.ok(bh.indexOf(SHIM) > 0 && bh.indexOf(SHIM) < bh.indexOf("</head>"));   // SHIM 은 </head> 앞
  assert.equal(await (await s.view(A, `/art/${c.id}/_assets/a.png`)).text(), "png");
  assert.equal(await (await s.view(A, `/art/${c.id}/project/Overview.dc.html`)).status, 200);
  const sj = await s.view(A, `/art/${c.id}/sub/support.js`);
  assert.equal(sj.status, 200); assert.match(await sj.text(), /DCLogic/);
  const t = await MC.token(SECRET, await MC.keyOf(A), c.id);
  assert.equal((await s.view(null, `/art/${c.id}/canvas.json?bxt=${t}`)).status, 200);
  assert.equal((await s.view(null, `/art/${c.id}/Overview.dc.html?bxt=${t}`)).headers.get("content-security-policy"), "sandbox allow-scripts allow-popups allow-downloads; form-action 'none'");
  assert.equal((await s.view(B, `/art/${c.id}/`)).status, 404);
  assert.equal((await s.view(B, `/art/${c.id}/canvas.json`)).status, 404);
  assert.equal((await s.view(A, `/art/${c.id}/..%2fx`)).status, 404);
  assert.equal((await s.view(A, `/art/${c.id}/Nope.dc.html`)).status, 404);
  assert.equal((await s.post(A, "/api/artnote", { art: c.id, target: "Overview.dc.html", text: "📍1 (5%, 5%) 지어낸 핀" })).j.notes.length, 1);
});

test("Design 캔버스: 루트 canvas.json 도 · 같은 id 새 판에서 page ↔ canvas 바뀜 · 껍데기 원본이 없으면 404", async () => {
  const s = await setup();
  const id = "DesignSwitchCanvas000001";
  const r1 = await (await s.put(TOK.A, { "canvas.json": JSON.stringify({ boards: {} }), "Main.dc.html": BOARD }, { id })).json() as any;
  assert.equal(r1.kind, "canvas"); assert.equal(r1.title, id);   // 제목 없으면 id
  assert.match(await (await s.view(A, `/art/${id}/Main.dc.html`)).text(), /지어낸 판/);
  assert.equal((await s.put(TOK.A, { "index.html": PAGE }, { id })).status, 200);
  assert.equal((await s.getj(A, "/api/arts")).j[id].kind, "page");
  assert.match(await (await s.view(A, `/art/${id}/`)).text(), /지어낸 글/);
  await s.put(TOK.A, { "project/canvas.json": "{}", "project/Main.dc.html": BOARD }, { id });
  s.m.delete("art/_sys/artcanvas.html");
  assert.equal((await s.view(A, `/art/${id}/`)).status, 404);
  // index.html · canvas.json 둘 다 없으면 여전히 400
  assert.equal((await s.put(TOK.A, { "page.html": PAGE })).status, 400);
});

test("목록 고정 별 · 썸네일 판: 내 캔버스만, 판 이름 검사, 지울 때 같이 지움", async () => {
  const s = await setup();
  const cv = await (await s.put(TOK.A, { "project/canvas.json": JSON.stringify(CANVAS), "project/Overview.dc.html": BOARD })).json() as any;
  const row = async () => (await s.getj(A, "/api/arts")).j[cv.id];
  assert.deepEqual([(await row()).pin, (await row()).thumb], [false, ""]);
  let r = await s.post(A, "/api/artstar", { art: cv.id, on: true });
  assert.deepEqual([r.status, r.j.ok, r.j.pin], [200, true, true]);
  assert.equal((await row()).pin, true);
  r = await s.post(A, "/api/artthumb", { art: cv.id, board: "Overview.dc.html" });
  assert.deepEqual([r.status, r.j], [200, { ok: true, thumb: "Overview.dc.html" }]);
  assert.deepEqual([(await row()).pin, (await row()).thumb], [true, "Overview.dc.html"]);   // 한 칸을 바꿔도 다른 칸은 그대로
  assert.equal((await s.post(A, "/api/artthumb", { art: cv.id, board: "Nope.dc.html" })).status, 400);
  assert.equal((await row()).thumb, "Overview.dc.html");
  r = await s.post(A, "/api/artthumb", { art: cv.id, board: "" });   // 첫 판으로 되돌림
  assert.deepEqual([r.status, r.j.thumb], [200, ""]);
  assert.equal((await s.post(A, "/api/artstar", { art: cv.id, on: false })).j.pin, false);
  assert.equal((await s.post(A, "/api/artstar", { art: cv.id, on: "false" })).j.pin, false);   // 문자열 "false" 는 켜짐이 아님
  assert.equal((await s.post(A, "/api/artstar", { art: cv.id, on: "true" })).j.pin, true);
  assert.equal((await s.post(A, "/api/artstar", { art: cv.id })).j.pin, false);
  // 남(B): 둘 다 404, 아무것도 안 씀
  assert.equal((await s.post(B, "/api/artstar", { art: cv.id, on: true })).status, 404);
  assert.equal((await s.post(B, "/api/artthumb", { art: cv.id, board: "Overview.dc.html" })).status, 404);
  assert.equal((s.db.prepare("SELECT count(*) AS n FROM member_artpref WHERE owner = ?").get(B) as any).n, 0);
  // 페이지 아티팩트는 썸네일 판이 없음(404), 별은 가능
  const pg = await (await s.put(TOK.A, { "index.html": PAGE })).json() as any;
  assert.equal((await s.post(A, "/api/artthumb", { art: pg.id, board: "x.html" })).status, 404);
  assert.equal((await s.post(A, "/api/artstar", { art: pg.id, on: true })).j.pin, true);
  // 지우면 그 줄도 지움
  assert.equal((await s.go(`/api/me/canvas/${cv.id}`, { method: "DELETE", headers: { authorization: `Bearer ${TOK.A}` } })).status, 200);
  assert.equal((s.db.prepare("SELECT count(*) AS n FROM member_artpref WHERE art = ?").get(cv.id) as any).n, 0);
});

const ADM = { authorization: "Bearer admin-test-not-real" };
const JPG = new Uint8Array([0xff, 0xd8, 0xff, ...new Array(3000).fill(7), 0xff, 0xd9]);
const CV2 = { ...CANVAS, boards: { "Overview.dc.html": { w: 800, h: 600 }, "Second.dc.html": { w: 1000, h: 700 } }, order: ["Overview.dc.html", "Second.dc.html"] };
const jobs = async (s: any) => (await (await s.go("/api/admin/mthumb/jobs?limit=20", { headers: ADM })).json() as any).jobs as any[];
const putThumb = async (s: any, j: any, ver = j.ver, pref = j.pref, bytes = JPG) => {
  const post = (action: string, body: unknown) => s.go(`/api/admin/media/thumb/${action}`, { method: "POST", headers: { ...ADM, "content-type": "application/json" }, body: JSON.stringify(body) });
  const r = await post("init", { mk: j.mk, art: j.art, ver, pref, size: bytes.length, mime: "image/jpeg" }); if (!r.ok) return r;
  const session = await r.json() as any;
  const part = await post("part", { id: session.id, number: 1 }); if (!part.ok) return part;
  const row = s.db.prepare("SELECT * FROM direct_upload WHERE id=?").get(session.id) as any;
  // JPEG 본문은 Worker 요청을 거치지 않고 R2에 들어간 것으로 흉내 낸다.
  s.m.set(row.source, { b: bytes, customMetadata: JSON.parse(row.metadata), httpMetadata: { contentType: row.mime } });
  return post("complete", { id: session.id, parts: [{ partNumber: 1, etag: "test-etag" }] });
};

test("회원 썸네일 일감: 관리자 토큰만 · 없음 → 찍으면 빠짐 · 판 버전 바뀜 · 지정 판 바뀜 · 회원마다 따로", async () => {
  const s = await setup();
  assert.equal((await s.go("/api/admin/mthumb/jobs")).status, 403);
  assert.equal((await s.go("/api/admin/mthumb/jobs", { headers: { authorization: "Bearer nope" } })).status, 403);
  const a = await (await s.put(TOK.A, { "project/canvas.json": JSON.stringify(CV2), "project/Overview.dc.html": BOARD, "project/Second.dc.html": BOARD })).json() as any;
  const b = await (await s.put(TOK.B, { "project/canvas.json": JSON.stringify(CV2), "project/Overview.dc.html": BOARD })).json() as any;
  let js = await jobs(s);
  assert.deepEqual(js.map(j => j.art).sort(), [a.id, b.id].sort());   // 없음 → 둘 다
  const ja = js.find(j => j.art === a.id);
  assert.deepEqual([ja.board, ja.w, ja.h, ja.pref], ["Overview.dc.html", 800, 600, ""]);   // 지정 없으면 order 맨 앞
  assert.match(ja.bxt, /^m\.[0-9a-f]{32}\.\d{13}\.[0-9a-f]{32}$/);
  assert.equal(await MC.tokenOk(SECRET, a.id, ja.bxt), ja.mk);
  assert.equal(await MC.tokenOk(SECRET, b.id, ja.bxt), null);
  assert.equal((await putThumb(s, ja)).status, 200);
  js = await jobs(s); assert.deepEqual(js.map(j => j.art), [b.id]);
  assert.equal((await s.post(A, "/api/artthumb", { art: a.id, board: "Second.dc.html" })).status, 200);
  js = await jobs(s); const ja2 = js.find(j => j.art === a.id);
  assert.deepEqual([ja2.board, ja2.w, ja2.pref], ["Second.dc.html", 1000, "Second.dc.html"]);
  assert.equal((await putThumb(s, ja2)).status, 200);
  assert.deepEqual((await jobs(s)).map(j => j.art), [b.id]);
  // 첫 판으로 되돌림(지정 해제)도 낡음
  await s.post(A, "/api/artthumb", { art: a.id, board: "" });
  assert.equal((await jobs(s)).find(j => j.art === a.id)!.board, "Overview.dc.html");
  const old = (await jobs(s)).find(j => j.art === a.id)!;
  assert.equal((await s.put(TOK.A, { "project/canvas.json": JSON.stringify(CV2), "project/Overview.dc.html": BOARD + " " }, { id: a.id })).status, 200);
  assert.equal((await putThumb(s, old)).status, 409);
  const nw = (await jobs(s)).find(j => j.art === a.id)!; assert.notEqual(nw.ver, old.ver);
  assert.equal((await putThumb(s, nw)).status, 200);
  assert.equal((await jobs(s)).some(j => j.art === a.id), false);
  await s.post(A, "/api/artthumb", { art: a.id, board: "Second.dc.html" });
  assert.equal((await (await s.go("/api/admin/mthumb/jobs?limit=1", { headers: ADM })).json() as any).jobs.length, 1);
  const first = (await (await s.go("/api/admin/mthumb/jobs?limit=1", { headers: ADM })).json() as any).jobs[0].art;
  const next = (await (await s.go(`/api/admin/mthumb/jobs?limit=1&skip=${first},bad!`, { headers: ADM })).json() as any).jobs;
  assert.equal(next.length, 1); assert.notEqual(next[0].art, first);
  assert.deepEqual((await (await s.go(`/api/admin/mthumb/jobs?limit=5&skip=${[a.id, b.id].join(",")}`, { headers: ADM })).json() as any).jobs, []);
});

test("회원 글(page) 썸네일 일감: 첫 화면 1280×800 · 지정 무시 · 다시 올리면 낡음 · 올린 그림은 같은 길로 서빙", async () => {
  const s = await setup();
  const pg = await (await s.put(TOK.A, { "index.html": PAGE })).json() as any;
  let js = await jobs(s);
  assert.deepEqual(js.map(j => [j.art, j.board, j.w, j.h, j.pref]), [[pg.id, "index.html", 1280, 800, ""]]);
  assert.equal(await MC.tokenOk(SECRET, pg.id, js[0].bxt), js[0].mk);
  assert.equal((await putThumb(s, js[0])).status, 200);
  assert.deepEqual(await jobs(s), []);
  assert.equal((await s.go(`/art/${pg.id}/_thumb.jpg`, { headers: { cookie: await cookie(A) } })).status, 200);
  assert.equal((await s.put(TOK.A, { "index.html": PAGE + " " }, { id: pg.id })).status, 200);   // 다시 게시 → 낡음
  js = await jobs(s); assert.equal(js.length, 1);
  assert.equal((await putThumb(s, { ...js[0], ver: "old" })).status, 409);
});

test("회원 썸네일 올리기 · 서빙: JPEG 만 · 내 캔버스만 읽힘 · 지우면 같이 지워짐", async () => {
  const s = await setup();
  const a = await (await s.put(TOK.A, { "project/canvas.json": JSON.stringify(CV2), "project/Overview.dc.html": BOARD })).json() as any;
  const j = (await jobs(s))[0];
  assert.equal((await s.go(`/art/${a.id}/_thumb.jpg`, { headers: { cookie: await cookie(A) } })).status, 404);   // 아직 없음
  assert.equal((await putThumb(s, j, j.ver, j.pref, new Uint8Array(3000).fill(65))).status, 400);   // JPEG 아님
  assert.equal((await s.go("/api/admin/media/thumb/init", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mk: j.mk, art: a.id, ver: j.ver, pref: "", size: JPG.length, mime: "image/jpeg" }) })).status, 403);
  const legacy = await s.go(`/api/admin/mthumb/${j.mk}/${a.id}?ver=${j.ver}&pref=`, { method: "PUT", headers: ADM, body: JPG });
  assert.equal(legacy.status, 200); assert.equal(legacy.headers.get("deprecation"), "true");
  assert.equal((await putThumb(s, { ...j, art: "Nope0000000000000000001" })).status, 404);
  assert.equal((await putThumb(s, j)).status, 200);
  const r = await s.go(`/art/${a.id}/_thumb.jpg`, { headers: { cookie: await cookie(A) } });
  assert.deepEqual([r.status, r.headers.get("content-type")], [200, "image/jpeg"]);
  assert.equal((await r.arrayBuffer()).byteLength, JPG.length);
  assert.equal((await s.go(`/art/${a.id}/_thumb.jpg`, { headers: { cookie: await cookie(B) } })).status, 404);   // 남은 못 읽음
  assert.notEqual((await s.go(`/art/${a.id}/_thumb.jpg`)).headers.get("content-type"), "image/jpeg");        // 로그인 · 표 없이는 그림이 안 나감(로그인 화면)
  assert.equal((await s.go(`/art/${a.id}/_thumb.jpg?bxt=${j.bxt}`)).status, 200);
  assert.equal((await s.go(`/api/admin/mthumb/jobs`, { headers: ADM })).status, 200);
  await s.go(`/api/me/canvas/${a.id}`, { method: "DELETE", headers: { authorization: `Bearer ${TOK.A}` } });
  assert.deepEqual([...s.m.keys()].filter(k => k.includes("_thumb.jpg")), []);
});
