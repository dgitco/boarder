// node --test --no-warnings --experimental-transform-types apps/web/worker/owner-upload.test.ts
// 주인도 회원과 같은 한 길: Worker는 사진·파일의 JSON 제어만, 본문은 R2 직접 전송. 파일 붙은 글의 링크 등록과 다리 호출 경계를 확인.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { fileD1, fileR2, directConfig, uploadFile } from "./file-direct-test-helper.ts";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
// 틀 얹기(boardShell)가 쓰는 것만: head · body 의 prepend(뒤에 부른 것이 맨 앞) · append
(globalThis as any).HTMLRewriter = class {
  hs: [string, { element?: (e: unknown) => unknown }][] = [];
  on(sel: string, h: { element?: (e: unknown) => unknown }) { this.hs.push([sel, h]); return this; }
  transform(r: Response) {
    const hs = this.hs;
    const run = async () => {
      let html = await r.text();
      for (const [sel, h] of hs) {
        if ((sel !== "head" && sel !== "body") || !h.element) continue;
        const pre: string[] = [], app: string[] = [];
        await h.element({ prepend: (s: string) => { pre.unshift(s); }, append: (s: string) => { app.push(s); }, setAttribute() {} });
        html = html.replace(new RegExp(`<${sel}[^>]*>`), m => m + pre.join("")).replace(`</${sel}>`, () => app.join("") + `</${sel}>`);
      }
      return html;
    };
    return new Response(new ReadableStream({ async start(ctl) { ctl.enqueue(new TextEncoder().encode(await run())); ctl.close(); } }), { status: r.status, headers: r.headers });
  }
};
const { default: app } = await import("./index.ts");

const OWNER = "owner@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email: string) {
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
function setup() {
  const { DB: D1 } = fileD1(), calls: { path: string; body: string }[] = [], { m, R: bucket } = fileR2();
  const call = async (r: { path: string; body?: Uint8Array }) => { calls.push({ path: r.path, body: r.body ? new TextDecoder().decode(r.body) : "" }); return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"ok":true}') }; };
  const env = { ...directConfig, DB: D1, RESULTS: bucket, ASSETS: { fetch: async () => new Response("nf") }, BRIDGE: { idFromName: (n: string) => n, get: () => ({ call }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const send = async (path: string, body: BodyInit, headers: Record<string, string> = {}) => app.fetch(new Request("https://example.test" + path, { method: "POST", headers: { cookie: await cookie(OWNER), "x-hb": "1", "sec-fetch-site": "same-origin", ...headers }, body }), env as never, { waitUntil() {}, passThroughOnException() {} } as never);
  const get = async (path: string) => app.fetch(new Request("https://example.test" + path, { headers: { cookie: await cookie(OWNER) } }), env as never, { waitUntil() {}, passThroughOnException() {} } as never);
  const upload = (body: Uint8Array, name: string) => uploadFile((suffix, b) => send("/api/upload" + suffix, JSON.stringify(b), { "content-type": "application/json" }), env, body, { name, mime: "image/png" });
  return { calls, m, send, get, upload };
}
test("주인 사진 올리기: Worker 는 JSON 제어만, 본문은 R2 직접 전송, 올린 파일은 주인이 읽음", async () => {
  const t = setup();
  const r = await t.upload(new Uint8Array([1, 2, 3, 4]), "사진.png");
  assert.equal(r.status, 200);
  const j = await r.json() as { ok: boolean; id: string; name: string };
  assert.ok(j.ok && /^[0-9a-f]{32}$/.test(j.id) && j.name === "사진.png");
  assert.equal(t.calls.length, 0, "다리를 불렀음");
  assert.equal((await t.get(`/api/file/${j.id}`)).status, 200);
  assert.equal(t.calls.length, 0);
});
test("주인 파일 붙은 글: 링크 줄이 붙어 다리로 한 번, 없는 파일이면 400 이고 다리 안 감", async () => {
  const t = setup();
  const up = await (await t.upload(new Uint8Array([9, 9]), "a.png")).json() as { id: string };
  const r = await t.send("/api/chat", JSON.stringify({ text: "봐줘", files: [{ id: up.id }] }), { "content-type": "application/json" });
  assert.equal(r.status, 200);
  assert.equal(t.calls.length, 1);
  const sent = JSON.parse(t.calls[0].body) as { text: string; files?: unknown };
  assert.match(sent.text, /^봐줘\n📎 a\.png: https:\/\/example\.test\/f\//);
  assert.equal(sent.files, undefined);
  const bad = await t.send("/api/chat", JSON.stringify({ text: "x", files: [{ id: "0".repeat(32) }] }), { "content-type": "application/json" });
  assert.equal(bad.status, 400);
  assert.equal(t.calls.length, 1);
});
test("주인 글(파일 없음)은 그대로 다리로", async () => {
  const t = setup();
  const r = await t.send("/api/chat", JSON.stringify({ text: "안녕" }), { "content-type": "application/json" });
  assert.equal(r.status, 200); assert.equal(t.calls.length, 1); assert.equal(JSON.parse(t.calls[0].body).text, "안녕");
});
test("주인 읽음 표시(seen) POST 는 「방금 씀」 쿠키를 안 붙이고, 글 POST 는 붙임", async () => {
  const t = setup();
  const seen = await t.send("/api/chat", JSON.stringify({ channel: "dgit", thread: "1793000000.000001", seen: true }), { "content-type": "application/json" });
  assert.equal(seen.status, 200);
  assert.ok(!(seen.headers.get("set-cookie") || "").includes("bx_w="), "읽음에 bx_w");
  const post = await t.send("/api/chat", JSON.stringify({ text: "안녕" }), { "content-type": "application/json" });
  assert.ok((post.headers.get("set-cookie") || "").includes("bx_w="), "글에 bx_w 없음");
});
