// node --test --no-warnings --experimental-transform-types apps/web/worker/owner-upload.test.ts
// 주인도 회원과 같은 한 길: 사진·파일 올리기(/api/upload)와 파일 붙은 글(/api/chat)은 다리를 거치지 않고 Worker(R2)가 받음. 다리 호출을 적어 두는 가짜로 확인.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

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
  return { D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => s.all())) } as unknown as D1Database };
}

function r2() {
  const m = new Map<string, { b: Uint8Array; meta: Record<string, string> }>();
  return { m, bucket: {
    put: async (k: string, v: ArrayBuffer | Uint8Array, o?: { customMetadata?: Record<string, string> }) => { m.set(k, { b: new Uint8Array(v as ArrayBuffer), meta: o?.customMetadata || {} }); },
    head: async (k: string) => { const o = m.get(k); return o ? { customMetadata: o.meta, size: o.b.length } : null; },
    get: async (k: string) => { const o = m.get(k); return o ? { customMetadata: o.meta, httpMetadata: { contentType: "image/png" }, size: o.b.length, writeHttpMetadata: (h: Headers) => { h.set("content-type", "image/png"); }, body: new Response(o.b as BodyInit).body } : null; },
  } as unknown as R2Bucket };
}
const OWNER = "owner@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email: string) {
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
function setup() {
  const { D1 } = d1(), calls: { path: string; body: string }[] = [], { m, bucket } = r2();
  const call = async (r: { path: string; body?: Uint8Array }) => { calls.push({ path: r.path, body: r.body ? new TextDecoder().decode(r.body) : "" }); return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"ok":true}') }; };
  const env = { DB: D1, RESULTS: bucket, ASSETS: { fetch: async () => new Response("nf") }, BRIDGE: { idFromName: (n: string) => n, get: () => ({ call }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const send = async (path: string, body: BodyInit, headers: Record<string, string> = {}) => app.fetch(new Request("https://example.test" + path, { method: "POST", headers: { cookie: await cookie(OWNER), "x-hb": "1", "sec-fetch-site": "same-origin", ...headers }, body }), env as never, { waitUntil() {}, passThroughOnException() {} } as never);
  const get = async (path: string) => app.fetch(new Request("https://example.test" + path, { headers: { cookie: await cookie(OWNER) } }), env as never, { waitUntil() {}, passThroughOnException() {} } as never);
  return { calls, m, send, get };
}
test("주인 사진 올리기: 다리를 안 거치고 Worker 가 R2 에 받음, 올린 파일은 주인이 읽음", async () => {
  const t = setup();
  const r = await t.send("/api/upload", new Uint8Array([1, 2, 3, 4]), { "content-type": "image/png", "x-file-name": encodeURIComponent("사진.png") });
  assert.equal(r.status, 200);
  const j = await r.json() as { ok: boolean; id: string; name: string };
  assert.ok(j.ok && /^[0-9a-f]{32}$/.test(j.id) && j.name === "사진.png");
  assert.equal(t.calls.length, 0, "다리를 불렀음");
  assert.equal((await t.get(`/api/file/${j.id}`)).status, 200);
  assert.equal(t.calls.length, 0);
});
test("주인 파일 붙은 글: 링크 줄이 붙어 다리로 한 번, 없는 파일이면 400 이고 다리 안 감", async () => {
  const t = setup();
  const up = await (await t.send("/api/upload", new Uint8Array([9, 9]), { "content-type": "image/png", "x-file-name": "a.png" })).json() as { id: string };
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
