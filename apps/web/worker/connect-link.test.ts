// node --test --no-warnings --experimental-transform-types apps/web/worker/connect-link.test.ts
// 커넥터 연결 링크(connectors/connect-link.ts): 진짜 index.ts(app.fetch) + 메모리 SQLite. 메일 · 토큰은 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).HTMLRewriter ??= class { on() { return this; } transform(r: Response) { return r; } };   // 로그인 화면(앞문 SPA)은 그대로
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", e); return new Response("{}", { status: 500 }); });

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => run1(sql, args),
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = ss.map(s => /^\s*select/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; } },
  } as unknown as D1Database;
  return { db, D1 };
}
const OWNER = "owner@example.test", MEMBER = "member@example.test", OTHER = "other@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up";
const DEV1 = "bxd_made-up-device-one-0123456789abcdef", DEV2 = "bxd_made-up-device-two-0123456789abcdef", DEVMW = "bxd_made-up-member-watch-0123456789abcd", DEVW = "bxd_made-up-owner-watch-0123456789abcde";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}


async function setup() {
  const { db, D1 } = d1(), T = Date.now();
  for (const m of [MEMBER, OTHER]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)");
  dev.run("dev1", MEMBER, "laptop", "", await sha(DEV1), T, T, "full");
  dev.run("dev2", MEMBER, "desktop", "", await sha(DEV2), T, T, "full");
  dev.run("devMW", MEMBER, "member watch", "", await sha(DEVMW), T, T, "watch");
  dev.run("devW", OWNER, "owner mac", "", await sha(DEVW), T, T, "watch");
  const env: any = { DB: D1, ASSETS: { fetch: async () => new Response("<!doctype html><html><head></head><body>SIGNIN</body></html>", { headers: { "content-type": "text/html" } }) }, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  const human = async (email = MEMBER) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  const dev_ = (t: string) => ({ authorization: `Bearer ${t}` });
  const set = (key: string, value: unknown, t = DEV1) => call("POST", "/api/device/settings", { key, value }, dev_(t));
  const get = (t = DEV1) => call("GET", "/api/device/settings", undefined, dev_(t));
  const node = () => db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(MEMBER) as any;
  /** 보드에서 사람이 허락(카드 「허용」) — 기기 하나 */
  const grant = async (t = DEV1) => { const r = await call("POST", "/api/device/settings/allow", {}, dev_(t)); assert.equal(r.status, 200, r.text); assert.equal((await call("POST", `/api/me/cards/${r.j.card_id}/answer`, { choice: "허용" }, await human())).status, 200); return r.j.card_id; };
  return { db, call, human, dev: dev_, set, get, node, grant, env, ctx };
}

const link = async (s: any, body: unknown = { service: "linear", label: "ln" }, t = DEV1) => s.call("POST", "/api/device/connect-link", body, s.dev(t));
const tokenOf = (url: string) => url.split("/c/")[1];

test("링크 만들기: 회원 full 기기만 · OAuth 서비스만 · 키 서비스는 --key-file 안내 · 모르는 서비스 400 · 열린 링크 5개 상한", async () => {
  const s = await setup();
  const r = await link(s);
  assert.equal(r.status, 200, r.text); assert.match(r.j.url, /^https:\/\/example\.test\/c\/cl_[0-9a-f]{48}$/); assert.equal(r.j.expires_in, 600);
  const row = s.db.prepare("SELECT hash, owner, device_id, service FROM connect_link").get() as any;
  assert.equal(row.owner, MEMBER); assert.equal(row.device_id, "dev1"); assert.notEqual(row.hash, tokenOf(r.j.url), "토큰 원문은 저장 안 함"); assert.equal(row.hash.length, 64);
  const k = await link(s, { service: "channeltalk" }); assert.equal(k.status, 422, k.text); assert.match(k.j.error, /--key-file/);
  assert.equal((await link(s, { service: "nope-nope" })).status, 400);
  assert.equal((await link(s, {})).status, 400);
  for (const t of [DEVMW, DEVW]) assert.equal((await link(s, { service: "linear" }, t)).status, 401, "감시 기기 · 주인 기기");
  assert.equal((await s.call("POST", "/api/device/connect-link", { service: "linear" })).status, 401, "토큰 없이");
  for (let i = 0; i < 3; i++) assert.equal((await link(s)).status, 200);   // 지금 4개
  assert.equal((await link(s)).status, 200); assert.equal((await link(s)).status, 429, "6번째");
});

test("확인 화면은 아무것도 소비하지 않음 · 로그인 필요 · 다른 계정 404 · 기기 토큰 머리는 사람이 아님", async () => {
  const s = await setup();
  const url = new URL((await link(s)).j.url).pathname;
  { const r = await s.call("GET", url); assert.equal(r.status, 200, "로그인 안 함 → 그 자리 로그인 화면"); assert.match(r.text, /SIGNIN/); }
  assert.equal((await s.call("GET", url, undefined, { cookie: (await s.human()).cookie, authorization: `Bearer ${DEV1}` })).status, 401, "토큰 머리가 붙으면 사람 아님");
  { const r = await s.call("GET", url, undefined, await s.human(OTHER)); assert.equal(r.status, 403, "다른 계정"); assert.match(r.text, /m\*+@example\.test/, "어느 계정 링크인지(가림)"); assert.match(r.text, /다른 계정으로 로그인/); assert.doesNotMatch(r.text, /member@example/, "메일 전체는 안 보임"); }
  const ok = await s.call("GET", url, undefined, await s.human());
  assert.equal(ok.status, 200); assert.match(ok.text, /laptop/); assert.match(ok.text, /frame-ancestors|계속/);
  assert.equal(s.db.prepare("SELECT used_at FROM connect_link").get().used_at, null, "열기만으로 안 닳음");
  assert.equal((await s.call("GET", url, undefined, await s.human())).status, 200, "다시 열어도 됨");
  assert.equal((await s.call("GET", "/c/not-a-token", undefined, await s.human())).status, 404);
});

test("소비: 한 번만 · 만든 계정만 · x-hb 필요 · 만료 · 다른 계정이 시도해도 링크는 안 닳음", async () => {
  const s = await setup();
  const token = tokenOf((await link(s, { service: "linear", label: "ln" })).j.url);
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token }, { cookie: (await s.human()).cookie })).status, 403, "x-hb 없음");
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token }, await s.human(OTHER))).status, 410, "다른 계정");
  assert.equal(s.db.prepare("SELECT used_at FROM connect_link").get().used_at, null);
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token }, { ...(await s.human()), authorization: `Bearer ${DEV1}` })).status, 401, "기기 토큰은 소비 못 함");
  const a = await s.call("POST", "/api/connect-link/consume", { token }, await s.human());
  assert.equal(a.status, 200, a.text); assert.equal(a.j.service, "linear"); assert.equal(a.j.label, "ln");
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token }, await s.human())).status, 410, "두 번째");
  assert.equal((await s.call("GET", "/c/" + token, undefined, await s.human())).status, 410);
  const t2 = tokenOf((await link(s)).j.url);
  s.db.prepare("UPDATE connect_link SET expires_at = ? WHERE service = 'linear' AND used_at IS NULL").run(Date.now() - 1);
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token: t2 }, await s.human())).status, 410, "만료");
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token: "x" }, await s.human())).status, 404);
});

test("다시 연결(reconnect) 값은 형식이 맞고 내 연결일 때만 이어짐", async () => {
  const s = await setup(), T = Date.now();
  s.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, off, read_only, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("c_" + "a".repeat(20), MEMBER, "linear", "", "url", "https://x.test", "", "", "ok", "", 0, T, T);
  const a = await link(s, { service: "linear", reconnect: "c_" + "a".repeat(20) });
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token: tokenOf(a.j.url) }, await s.human())).j.reconnect, "c_" + "a".repeat(20));
  const b = await link(s, { service: "linear", reconnect: "evil" });
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token: tokenOf(b.j.url) }, await s.human())).j.reconnect, null, "형식이 틀리면 무시");
});

test("reconnect 는 내 연결 · 같은 서비스일 때만 / 소비 뒤 시작 실패면 풀어서 다시 쓸 수 있음 / 상한은 한 문장", async () => {
  const s = await setup();
  const T = Date.now();
  s.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, off, read_only, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("c_" + "b".repeat(20), MEMBER, "google-calendar", "", "api", "https://x.test", "", "", "ok", "", 0, T, T);
  assert.equal((await link(s, { service: "linear", reconnect: "c_" + "b".repeat(20) })).status, 400, "다른 서비스 연결 id");
  assert.equal((await link(s, { service: "linear", reconnect: "c_" + "c".repeat(20) })).status, 400, "없는 id");
  assert.equal((await link(s, { service: "google-calendar", reconnect: "c_" + "b".repeat(20) })).status, 200, "내 연결 · 같은 서비스");
  const token = tokenOf((await link(s)).j.url);
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token }, await s.human())).status, 200);
  assert.equal((await s.call("POST", "/api/connect-link/release", { token }, await s.human(OTHER))).j.ok, false, "다른 계정은 못 풂");
  assert.equal((await s.call("POST", "/api/connect-link/release", { token }, await s.human())).j.ok, true);
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token }, await s.human())).status, 200, "풀린 뒤 다시 쓸 수 있음");
  s.db.prepare("UPDATE connect_link SET used_at = ? WHERE hash = (SELECT hash FROM connect_link WHERE used_at IS NOT NULL LIMIT 1)").run(Date.now() - 3 * 60_000);
  assert.equal((await s.call("POST", "/api/connect-link/release", { token }, await s.human())).j.ok, false, "2분 지나면 못 풂");
});

test("connected 는 「계속」 누른 뒤에 갱신된 연결만", async () => {
  const s = await setup();
  const T = Date.now();
  s.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, off, read_only, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("c_" + "d".repeat(20), MEMBER, "linear", "ln", "url", "https://x.test", "", "", "ok", "", 0, T - 1000, T - 500);
  const r = await link(s, { service: "linear", label: "ln" }); const token = tokenOf(r.j.url);
  const st = () => s.call("GET", `/api/device/connect-link/${r.j.id}`, undefined, s.dev(DEV1));
  assert.equal((await st()).j.state, "waiting");
  await s.call("POST", "/api/connect-link/consume", { token }, await s.human());
  assert.equal((await st()).j.state, "opened", "옛 연결이 있어도 완료로 안 봄");
  s.db.prepare("UPDATE connection SET updated_at = ? WHERE id = ?").run(Date.now() + 5, "c_" + "d".repeat(20));
  assert.equal((await st()).j.state, "connected");
  assert.equal((await s.call("GET", `/api/device/connect-link/${r.j.id}`, undefined, s.dev(DEV2))).status, 404, "다른 기기 것은 못 봄");
});
