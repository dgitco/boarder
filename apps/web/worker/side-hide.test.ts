import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
(globalThis as any).HTMLRewriter ??= class { on() { return this; } transform(r: Response) { return r; } };
const { default: app } = await import("./index.ts");
const { cleanHide } = await import("./side-order.ts");

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
const OWNER = "owner@example.test", A = "alice@example.test", B = "bob@example.test", SECRET = "test-secret-not-real";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로
  const tok = "sess-" + email, th = (await sha(tok)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${tok}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
function setup() {
  const { db, D1 } = d1();
  for (const e of [A, B]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(e, OWNER, 1);
  const env = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, ASSETS: { fetch: async () => new Response("x") }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const go = (path: string, init: RequestInit = {}) => app.fetch(new Request("https://example.test" + path, init), env, ctx);
  const get = async (email: string) => go("/api/me/side", { headers: { cookie: await cookie(email) } });
  const post = async (email: string | null, body: unknown, same = true) => go("/api/me/side", { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(same ? { "x-hb": "1" } : { "sec-fetch-site": "cross-site" }), ...(email ? { cookie: await cookie(email) } : {}) } });
  return { db, get, post };
}

test("값 거르기: 정해 둔 열쇠만 · 겹침 하나로 · 빈 목록 = 다 보임 · 배열 아님 · 너무 긺 → null", () => {
  assert.deepEqual(cleanHide(["feed", "zz", "feed", 3, "node"]), ["feed", "node"]);
  assert.deepEqual(cleanHide([]), []);
  assert.deepEqual(cleanHide(["ib", "ch"]), [], "아래 칸 열쇠는 숨기기 열쇠가 아님");
  for (const bad of ["feed", null, {}, Array(11).fill("feed")]) assert.equal(cleanHide(bad), null);
});

test("저장 → 다시 읽기: 회원 · 주인 모두 내 계정 값, 처음엔 빈 목록", async () => {
  const s = setup();
  assert.deepEqual((await (await s.get(A)).json()).hide, []);
  for (const who of [A, OWNER]) {
    const r = await s.post(who, { hide: ["feed", "feed", "모름"] });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).hide, ["feed"]);
    assert.deepEqual((await (await s.get(who)).json()).hide, ["feed"]);
  }
  assert.equal((await s.post(A, { hide: [] })).status, 200, "빈 목록 = 다시 다 보임");
  assert.deepEqual((await (await s.get(A)).json()).hide, []);
});

test("남의 계정 못 바꿈: 본문에 남의 메일을 넣어도 세션 계정에만 저장", async () => {
  const s = setup();
  await s.post(A, { hide: ["feed"], owner: B, email: B });
  assert.deepEqual((await (await s.get(A)).json()).hide, ["feed"]);
  assert.deepEqual((await (await s.get(B)).json()).hide, [], "B 는 그대로");
});

test("틀린 꼴 400 · 다른 사이트 쓰기 403 · 로그인 없으면 401 — 저장 안 됨", async () => {
  const s = setup();
  assert.equal((await s.post(A, { hide: "feed" })).status, 400);
  assert.equal((await s.post(A, { hide: ["feed"] }, false)).status, 403);
  assert.equal((await s.post(null, { hide: ["feed"] })).status, 401);
  assert.deepEqual((await (await s.get(A)).json()).hide, []);
});

test("숨기기 저장은 칸 순서(side) · 고정 캔버스(pins)를 건드리지 않음", async () => {
  const s = setup();
  await s.post(A, { side: ["ch", "ib"] });
  await s.post(A, { pins: [{ id: "abcd1234", title: "가상 판" }] });
  await s.post(A, { hide: ["node", "canvas"] });
  const j = await (await s.get(A)).json();
  assert.deepEqual(j.side, ["ch", "ib"]);
  assert.deepEqual(j.pins, [{ id: "abcd1234", title: "가상 판" }]);
  assert.deepEqual(j.hide, ["node", "canvas"]);
});
