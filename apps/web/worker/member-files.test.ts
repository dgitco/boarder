// node --test --no-warnings --experimental-transform-types apps/web/worker/member-files.test.ts (Node 22.18+)
// 회원 파일 · 받아쓰기(member-files.ts) 계약 · 경계: 올린 사람만 봄(남은 404) · 서명 링크는 7일 · 틀린 서명 403 · 위험한 꼴은 내려받기 · 글 링크 줄은 내 파일만. 자료는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

register("./test-hooks.mjs", import.meta.url);
const F = await import("./member-files.ts");

const A = "a@example.com", B = "b@example.com", SECRET = "test-secret-not-real";
function setup() {
  const objs = new Map<string, { body: Uint8Array; http: Record<string, string>; meta: Record<string, string> }>();
  const R2 = {
    put: async (k: string, v: ArrayBuffer, o: { httpMetadata: Record<string, string>; customMetadata: Record<string, string> }) => { objs.set(k, { body: new Uint8Array(v), http: o.httpMetadata, meta: o.customMetadata }); },
    get: async (k: string) => { const o = objs.get(k); return o ? { customMetadata: o.meta, body: new Blob([o.body]).stream(), writeHttpMetadata: (h: Headers) => { if (o.http.contentType) h.set("content-type", o.http.contentType); if (o.http.contentDisposition) h.set("content-disposition", o.http.contentDisposition); } } : null; },
    head: async (k: string) => { const o = objs.get(k); return o ? { customMetadata: o.meta, httpMetadata: o.http, size: o.body.length } : null; },
  };
  // 하루 상한 칸(user_pref) — 가짜 D1 = 메모리 SQLite, 표는 마이그레이션 파일 그대로
  const sq = new DatabaseSync(":memory:"); sq.exec(readFileSync(new URL("../migrations/0030_user_pref.sql", import.meta.url), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({ bind: (...a: unknown[]) => stmt(sql, a), first: async () => (sq.prepare(sql).get(...(args as never[])) as unknown) ?? null, run: async () => sq.prepare(sql).run(...(args as never[])) });
  const DB = { prepare: (s: string) => stmt(s) };
  const env = { DB, RESULTS: R2, AI: { run: async (_m: string, i: { audio: number[] }) => { ai.n++; return { text: ` 들린 글 ${i.audio.length} ` }; } }, BETTER_AUTH_SECRET: SECRET };
  const ai = { n: 0 };
  const app = new Hono();
  app.post("/api/upload", c => F.upload(c as never, c.req.header("x-test-user")!));
  app.post("/api/voice/stt", c => F.stt(c as never, c.req.header("x-test-user") || A));
  app.get("/api/file/:id", c => F.fileGet(c as never, c.req.header("x-test-user")!, c.req.param("id"), c.req.query("dl") !== undefined));
  app.get("/f/:id", c => F.signedGet(c as never, c.req.param("id")));
  const call = async (method: string, path: string, h: Record<string, string> = {}, body?: BodyInit) => {
    const r = await app.fetch(new Request("https://b.example" + path, { method, headers: h, body, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit), env);
    return { status: r.status, h: r.headers, t: await r.text() };
  };
  return { env, call, sq, ai };
}
const up = async (s: ReturnType<typeof setup>, who: string, name: string, type: string, body = "내용") =>
  JSON.parse((await s.call("POST", "/api/upload", { "x-test-user": who, "x-file-name": encodeURIComponent(name), "content-type": type }, body)).t) as { ok: boolean; id: string; name: string };

test("올리기 → 보기: 올린 사람만(남은 404), 빈 몸통 400, 이름의 「/」는 바꿈", async () => {
  const s = setup(), a = await up(s, A, "a/보고서.pdf", "application/pdf");
  assert.ok(a.ok); assert.match(a.id, /^[0-9a-f]{32}$/); assert.equal(a.name, "a_보고서.pdf");
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": A })).t, "내용");
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": B })).status, 404);
  assert.equal((await s.call("POST", "/api/upload", { "x-test-user": A }, "")).status, 400);
});

test("같은 열쇠(X-Upload-Key)로 다시 올려도 파일 하나 · 올리기 한도 한 번만, 열쇠가 다르거나 남이면 따로", async () => {
  const s = setup(), put = async (who: string, key: string) => JSON.parse((await s.call("POST", "/api/upload", { "x-test-user": who, "x-file-name": "p.png", "content-type": "image/png", ...(key ? { "x-upload-key": key } : {}) }, "사진")).t) as { ok: boolean; id: string; size: number };
  const a = await put(A, "k-1"), a2 = await put(A, "k-1"), a3 = await put(A, "k-2"), n1 = await put(A, ""), n2 = await put(A, ""), b = await put(B, "k-1");
  assert.ok(a.ok && a2.ok); assert.equal(a2.id, a.id); assert.equal(a2.size, a.size); assert.match(a.id, /^[0-9a-f]{32}$/);
  assert.notEqual(a3.id, a.id); assert.notEqual(n1.id, n2.id); assert.notEqual(b.id, a.id);   // 열쇠 없으면 예전처럼 매번 새 파일, 남의 같은 열쇠는 다른 파일
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": A })).t, "사진");
});

test("위험한 꼴(HTML · SVG)은 화면에 띄우지 않고 내려받기, ?dl 이면 무엇이든 내려받기", async () => {
  const s = setup(), h = await up(s, A, "x.html", "text/html", "<script>1</script>"), p = await up(s, A, "p.png", "image/png");
  const r = await s.call("GET", `/api/file/${h.id}`, { "x-test-user": A });
  assert.equal(r.h.get("content-type"), "application/octet-stream"); assert.match(r.h.get("content-disposition") || "", /^attachment/); assert.equal(r.h.get("content-security-policy"), "sandbox");
  assert.match((await s.call("GET", `/api/file/${p.id}`, { "x-test-user": A })).h.get("content-disposition") || "", /^inline/);
  assert.match((await s.call("GET", `/api/file/${p.id}?dl`, { "x-test-user": A })).h.get("content-disposition") || "", /^attachment/);
});

test("글 링크 줄: 내 파일만 「📎 이름: 서명 링크」, 남의 · 모르는 id 는 빼고 셈 — 링크는 로그인 없이 받힘, 서명이 틀리거나 지나면 403", async () => {
  const s = setup(), a = await up(s, A, "보고서.pdf", "application/pdf"), b = await up(s, B, "남의.pdf", "application/pdf");
  const f = await F.fileLines(s.env as never, A, "https://b.example/", [a.id, b.id, "nope"]);
  assert.equal(f.bad, 2); assert.equal(f.lines.length, 1);
  const m = /^📎 보고서\.pdf: https:\/\/b\.example(\/f\/[0-9a-f]{32}\?e=(\d+)&t=([0-9a-f]{32}))$/.exec(f.lines[0]); assert.ok(m, f.lines[0]);
  assert.equal((await s.call("GET", m![1])).t, "내용");
  assert.equal((await s.call("GET", m![1].replace(/t=[0-9a-f]/, "t=" + (m![3][0] === "0" ? "1" : "0")))).status, 403);
  const old = await F.fileLink(SECRET, "https://b.example", a.id, Date.now() - 8 * 86400_000);
  assert.equal((await s.call("GET", old.replace("https://b.example", ""))).status, 403, "7일 지난 링크");
  assert.equal(await F.linkOk("other-secret", a.id, m![2], m![3]), false, "다른 비밀값으로 만든 서명 아님");
});

test("받아쓰기: 녹음 → 글, 빈 녹음 400, 3MB 넘으면 413", async () => {
  const s = setup();
  assert.deepEqual(JSON.parse((await s.call("POST", "/api/voice/stt", { "content-type": "audio/wav" }, new Uint8Array(4))).t), { ok: true, text: "들린 글 4" });
  assert.equal((await s.call("POST", "/api/voice/stt", { "content-type": "audio/wav" }, new Uint8Array(0))).status, 400);
  assert.equal((await s.call("POST", "/api/voice/stt", { "content-type": "audio/wav" }, new Uint8Array(F.VOICE_MAX + 1))).status, 413);
});

// content-length 없이 조각으로 오는 몸통(스트림) — 상한을 넘으면 그 자리에서 끊는지: 넘은 뒤 조각은 당기지 않음
function chunked(size: number, chunk = 1024 * 1024) {
  const st = { pulled: 0 };
  const body = new ReadableStream<Uint8Array>({ pull(ctl) { if (st.pulled * chunk >= size) return ctl.close(); st.pulled++; ctl.enqueue(new Uint8Array(chunk)); } }, { highWaterMark: 0 });
  return { body, st };
}
test("조각 요청(content-length 없음): 올리기 · 받아쓰기는 읽으면서 상한을 넘으면 끊고 413 — 끝까지 읽지 않음", async () => {
  const s = setup();
  const up1 = chunked(F.FILE_MAX * 5);
  const r = await s.call("POST", "/api/upload", { "x-test-user": A, "x-file-name": "big.bin" }, up1.body as never);
  assert.equal(r.status, 413);
  assert.ok(up1.st.pulled <= F.FILE_MAX / (1024 * 1024) + 2, `20MB 를 조금 넘어 끊어야 함(당긴 조각 ${up1.st.pulled})`);
  const v = chunked(F.VOICE_MAX * 10, 256 * 1024);
  assert.equal((await s.call("POST", "/api/voice/stt", { "x-test-user": A }, v.body as never)).status, 413);
  assert.ok(v.st.pulled <= F.VOICE_MAX / (256 * 1024) + 2, `3MB 를 조금 넘어 끊어야 함(당긴 조각 ${v.st.pulled})`);
  assert.equal(s.ai.n, 0, "받아쓰기를 부르지 않음");
  const ok = chunked(3 * 1024, 1024);   // 상한 안의 조각 요청은 그대로 받음
  assert.equal(JSON.parse((await s.call("POST", "/api/upload", { "x-test-user": A, "x-file-name": "s.bin" }, ok.body as never)).t).size, 3 * 1024);
});

test("하루 상한: 올리기는 회원마다 개수 · 총량, 받아쓰기는 회원마다 횟수 — 넘으면 429 이고 받아쓰기(AI)를 부르지 않음, 다른 회원은 따로", async () => {
  const s = setup();
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  const set = (who: string, kind: string, n: number, b: number) => s.sq.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v").run(who, `q:${kind}:${day}`, JSON.stringify({ n, b }), now);
  set(A, "mfiles", F.DAY_FILES - 1, 0);
  assert.ok((await up(s, A, "a.txt", "text/plain")).ok, "상한 바로 아래는 됨");
  assert.equal((await s.call("POST", "/api/upload", { "x-test-user": A, "x-file-name": "b.txt" }, "내용")).status, 429, "개수 상한");
  assert.ok((await up(s, B, "b.txt", "text/plain")).ok, "다른 회원은 따로");
  set(B, "mfiles", 0, F.DAY_FILE_BYTES - 3);
  assert.equal((await s.call("POST", "/api/upload", { "x-test-user": B, "x-file-name": "c.txt" }, "내용")).status, 429, "총량 상한(「내용」 = 6바이트)");
  set(A, "stt", F.DAY_STT - 1, 0);
  assert.equal((await s.call("POST", "/api/voice/stt", { "x-test-user": A }, new Uint8Array(4))).status, 200);
  const before = s.ai.n;
  assert.equal((await s.call("POST", "/api/voice/stt", { "x-test-user": A }, new Uint8Array(4))).status, 429, "받아쓰기 횟수 상한");
  assert.equal(s.ai.n, before, "넘은 뒤엔 AI 를 부르지 않음");
  assert.equal((await s.call("POST", "/api/voice/stt", { "x-test-user": B }, new Uint8Array(4))).status, 200, "다른 회원은 따로");
});

test("하루 상한 셈: 동시에 와도 상한을 넘지 않음 · 셈을 못 하면(D1 장애) 받지 않음", async () => {
  const s = setup();
  const r = await Promise.all(Array.from({ length: 8 }, () => F.quotaTake(s.env.DB as never, A, "t", 1, 5, 100)));
  assert.equal(r.filter(Boolean).length, 5);
  const broken = { prepare: () => { throw new Error("D1 장애(시험)"); } };
  const s2 = setup(); (s2.env as any).DB = broken;
  assert.equal((await s2.call("POST", "/api/upload", { "x-test-user": A, "x-file-name": "x.txt" }, "내용")).status, 503);
});

test("PDF: 맨 앞이 %PDF- 면 화면 안 보기(inline · application/pdf · sandbox 없이 frame-ancestors), 가짜 PDF 는 내려받기 + sandbox, ?dl 은 내려받기 · 한글 이름 RFC5987", async () => {
  const s = setup(), a = await up(s, A, "분기 보고서 (최종).pdf", "application/pdf", "%PDF-1.7\n본문"), f = await up(s, A, "가짜.pdf", "application/pdf", "<script>1</script>");
  const r = await s.call("GET", `/api/file/${a.id}`, { "x-test-user": A }), cd = r.h.get("content-disposition") || "";
  assert.equal(r.status, 200); assert.equal(r.h.get("content-type"), "application/pdf"); assert.match(cd, /^inline; filename="/);
  assert.ok(cd.includes(`filename*=UTF-8''${encodeURIComponent("분기 보고서 ")}%28%EC%B5%9C%EC%A2%85%29.pdf`), cd);
  assert.equal(r.h.get("content-security-policy"), "frame-ancestors 'self'"); assert.equal(r.h.get("x-content-type-options"), "nosniff"); assert.ok(r.t.startsWith("%PDF-"));
  const d = await s.call("GET", `/api/file/${a.id}?dl`, { "x-test-user": A });
  assert.match(d.h.get("content-disposition") || "", /^attachment; filename=/); assert.equal(d.h.get("content-security-policy"), "sandbox");
  const x = await s.call("GET", `/api/file/${f.id}`, { "x-test-user": A });
  assert.match(x.h.get("content-disposition") || "", /^attachment/); assert.equal(x.h.get("content-security-policy"), "sandbox");
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": B })).status, 404);
  assert.equal((await s.call("GET", `/api/file/${a.id}?dl`, { "x-test-user": B })).status, 404);
});
