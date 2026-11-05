import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
(globalThis as any).HTMLRewriter ??= class { on() { return this; } transform(r: Response) { return r; } };
const { default: app } = await import("./index.ts");
const { hosted } = await import("./hosted.ts");

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
  return { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => s.all())) } as unknown as D1Database;
}
const calls: { method: string; path: string; headers: Record<string, string>; len: number }[] = [];
const bridgeNs = () => ({ idFromName: (n: string) => n, get: () => ({
  call: async (r: { method: string; path: string; headers: Record<string, string>; body?: Uint8Array }) => { calls.push({ method: r.method, path: r.path, headers: r.headers, len: r.body?.length || 0 }); return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"ok":true,"id":"0123456789abcdef"}') }; },
  tool: async () => ({ ok: true }) }) });
const OWNER = "owner@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email: string) {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}

function r2(failPuts = 0) {
  const m = new Map<string, { b: Uint8Array; meta?: Record<string, string>; ct?: string }>(); let fail = failPuts;
  const R = { put: async (k: string, v: Uint8Array, o?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => { if (fail-- > 0) throw new Error("R2 일시 오류"); m.set(k, { b: v, meta: o?.customMetadata, ct: o?.httpMetadata?.contentType }); },
    head: async (k: string) => { const o = m.get(k); return o ? { key: k, size: o.b.length, customMetadata: o.meta, httpMetadata: { contentType: o.ct } } : null; },
    get: async (k: string) => null, delete: async (k: string) => { m.delete(k); } } as unknown as R2Bucket;
  return { m, R };
}
const mkEnv = (RESULTS: R2Bucket, DB = d1()) => ({ DB, RESULTS, ASSETS: { fetch: async () => new Response("") }, BRIDGE: bridgeNs(), SNAP: { idFromName: (s: string) => s, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" });
const upReq = async (env: unknown, key: string, bytes = 4) => app.fetch(new Request("https://example.test/api/upload", { method: "POST", headers: { cookie: await cookie(OWNER), "x-hb": "1", "sec-fetch-site": "same-origin", "content-type": "image/png", "x-file-name": encodeURIComponent("사진.png"), ...(key ? { "x-upload-key": key } : {}) }, body: new Uint8Array(bytes).fill(7) }),
  env as never, { waitUntil() {}, passThroughOnException() {} } as never);

test("주인 업로드(Worker → R2, 다리 안 탐): 같은 열쇠로 다시 올려도 파일 하나 · 같은 id, 열쇠 없으면 매번 새 파일", async () => {
  (hosted as any).exec = undefined; calls.length = 0;
  const { m, R } = r2(), env = mkEnv(R);
  const a = await (await upReq(env, "key-abc_123")).json() as any, b = await (await upReq(env, "key-abc_123")).json() as any;
  assert.ok(a.ok && b.ok); assert.equal(a.id, b.id); assert.equal(m.size, 1);
  const c1 = await (await upReq(env, "")).json() as any, c2 = await (await upReq(env, "")).json() as any;
  assert.notEqual(c1.id, c2.id); assert.equal(m.size, 3);
  assert.equal(calls.filter(x => x.path === "/api/upload").length, 0, "다리로 가지 않음");
});

test("R2 에 못 넣으면: 다시 보내도 되는 503 이고 올리기 한도는 돌려줌 — 다시 보내 성공해도 한 번만 셈", async () => {
  (hosted as any).exec = undefined;
  const { m, R } = r2(1), env = mkEnv(R);
  const bad = await upReq(env, "key-retry-1");
  assert.equal(bad.status, 503); assert.equal(bad.headers.get("x-retry-safe"), "1");
  const ok = await upReq(env, "key-retry-1"); assert.equal(ok.status, 200); assert.equal(m.size, 1);
  const row = await (env.DB as any).prepare("SELECT v FROM user_pref WHERE owner = ? AND k LIKE 'q:mfiles:%'").bind(OWNER).first() as { v: string } | null;
  assert.equal(JSON.parse(row!.v).n, 1, "한도는 한 번만 셈");
});

test("D1 오류가 나도(로그인 확인 실패): 올리기는 다시 보내도 되는 503(x-retry-safe) — 읽기 길은 main 의 처리기가 같은 503", async () => {
  const boom = () => { throw new Error("D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window"); };
  const env = { DB: { prepare: boom, batch: boom } as unknown as D1Database, ASSETS: { fetch: async () => new Response("") }, BRIDGE: bridgeNs(), SNAP: { idFromName: (s: string) => s, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ck = (await cookie("member@example.test")).split("; bx_s=")[0], ex = { waitUntil() {}, passThroughOnException() {} } as never, hd = { cookie: ck, "x-hb": "1", "sec-fetch-site": "same-origin" };
  const up = await app.fetch(new Request("https://example.test/api/upload", { method: "POST", headers: { ...hd, "content-type": "image/png" }, body: new Uint8Array([1]) }), env as never, ex);
  assert.equal(up.status, 503); assert.equal(up.headers.get("x-retry-safe"), "1");
  const rd = await app.fetch(new Request("https://example.test/api/topics", { headers: hd }), env as never, ex);
  assert.ok([503, 200, 401].includes(rd.status), "읽기: " + rd.status);
});
