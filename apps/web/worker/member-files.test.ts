// node --test --no-warnings --experimental-transform-types apps/web/worker/member-files.test.ts (Node 22.18+)
// 회원 파일 · 받아쓰기(member-files.ts) 계약 · 경계: 올린 사람만 봄(남은 404) · 서명 링크는 7일 · 틀린 서명 403 · 위험한 꼴은 내려받기 · 글 링크 줄은 내 파일만. 자료는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { register } from "node:module";

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
  const env = { RESULTS: R2, AI: { run: async (_m: string, i: { audio: number[] }) => ({ text: ` 들린 글 ${i.audio.length} ` }) }, BETTER_AUTH_SECRET: SECRET };
  const app = new Hono();
  app.post("/api/upload", c => F.upload(c as never, c.req.header("x-test-user")!));
  app.post("/api/voice/stt", c => F.stt(c as never));
  app.get("/api/file/:id", c => F.fileGet(c as never, c.req.header("x-test-user")!, c.req.param("id"), c.req.query("dl") !== undefined));
  app.get("/f/:id", c => F.signedGet(c as never, c.req.param("id")));
  const call = async (method: string, path: string, h: Record<string, string> = {}, body?: BodyInit) => {
    const r = await app.fetch(new Request("https://b.example" + path, { method, headers: h, body }), env);
    return { status: r.status, h: r.headers, t: await r.text() };
  };
  return { env, call };
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
