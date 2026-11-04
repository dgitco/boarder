// node --test --no-warnings --experimental-transform-types apps/web/worker/approval-link.test.ts
// 건건 승인 링크(approval-link.ts): 진짜 index.ts(app.fetch) + 메모리 SQLite. 메일 · 토큰은 다 지어낸 것.
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
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test", ENGINE: { idFromName: (n: string) => n, get: () => ({ revoke: async () => 0 }) }, CONNECTOR_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64") };
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

const ask = (s: any, action: string, params: unknown = {}, t = DEV1) => s.call("POST", "/api/device/approval-link", { action, params }, s.dev(t));
const tokenOf = (url: string) => url.split("/a/")[1];
const CONN = "c_" + "b".repeat(20), T0 = Date.now();
const addConn = (s: any, owner = MEMBER, id = CONN) => s.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, off, read_only, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, owner, "linear", "ln", "url", "https://x.test", "", "", "ok", "", 1, T0, T0);

test("신청: 목록에 있는 행동 · 검사된 인자만 · 내 연결/기기만 · 자기 자신 폐기 불가 · 열린 5개 상한 · 회원 full 기기만", async () => {
  const s = await setup(); addConn(s); addConn(s, OTHER, "c_" + "c".repeat(20));
  const a = await ask(s, "connection.disconnect", { id: CONN });
  assert.equal(a.status, 200, a.text); assert.match(a.j.url, /^https:\/\/example\.test\/a\/ap_[0-9a-f]{48}$/); assert.match(a.j.summary, /linear \(ln\)/);
  const row = s.db.prepare("SELECT hash, owner, device_id, action FROM approval_link").get() as any; assert.equal(row.owner, MEMBER); assert.equal(row.device_id, "dev1"); assert.notEqual(row.hash, tokenOf(a.j.url));
  assert.equal((await ask(s, "nope")).status, 400); assert.equal((await ask(s, "__proto__")).status, 400); assert.equal((await ask(s, "constructor")).status, 400);
  assert.equal((await ask(s, "connection.disconnect", { id: "c_" + "c".repeat(20) })).status, 400, "남의 연결");
  assert.equal((await ask(s, "connection.disconnect", { id: "bad" })).status, 400);
  assert.equal((await ask(s, "connection.read-only", { id: CONN, on: "maybe" })).status, 400);
  assert.equal((await ask(s, "device.revoke", { id: "dev1" })).status, 400, "자기 자신");
  assert.equal((await ask(s, "device.revoke", { id: "dev2" })).status, 200);
  assert.equal((await ask(s, "bundle.set", { name: "nope", on: true })).status, 400); assert.equal((await ask(s, "bundle.set", { name: "phone-alert", on: true })).status, 200);
  assert.equal((await ask(s, "rule.set", { name: "outside", on: "false" })).status, 200);
  for (const t of [DEVMW, DEVW]) assert.equal((await ask(s, "session-sync.on", {}, t)).status, 401);
  assert.equal((await s.call("POST", "/api/device/approval-link", { action: "session-sync.on" })).status, 401);
  assert.equal((await ask(s, "session-sync.on")).status, 200); assert.equal((await ask(s, "session-sync.on")).status, 429, "6번째");
  assert.ok((await s.call("GET", "/api/device/approval-actions", undefined, s.dev(DEV1))).j.actions["device.revoke"]);
});

test("확인 화면은 소비하지 않음 · 로그인 필요 · 다른 계정 404 · 소비는 한 번 · 사람 세션만 · 풀기", async () => {
  const s = await setup(); addConn(s);
  const token = tokenOf((await ask(s, "connection.read-only", { id: CONN, on: false })).j.url), path = "/a/" + token;
  assert.equal((await s.call("GET", path)).status, 401);
  assert.equal((await s.call("GET", path, undefined, { cookie: (await s.human()).cookie, authorization: `Bearer ${DEV1}` })).status, 401);
  assert.equal((await s.call("GET", path, undefined, await s.human(OTHER))).status, 404);
  const page = await s.call("GET", path, undefined, await s.human()); assert.equal(page.status, 200); assert.match(page.text, /읽기 전용 해제/);
  assert.equal(s.db.prepare("SELECT used_at FROM approval_link").get().used_at, null);
  assert.equal((await s.call("POST", "/api/approval/consume", { token }, { cookie: (await s.human()).cookie })).status, 403, "x-hb 없음");
  assert.equal((await s.call("POST", "/api/approval/consume", { token }, { ...(await s.human()), authorization: `Bearer ${DEV1}` })).status, 401);
  assert.equal((await s.call("POST", "/api/approval/consume", { token }, await s.human(OTHER))).status, 410);
  const c = await s.call("POST", "/api/approval/consume", { token }, await s.human());
  assert.equal(c.status, 200, c.text); assert.deepEqual([c.j.method, c.j.url, c.j.body], ["PATCH", `/api/connections/${CONN}`, { read_only: false }]);
  assert.equal((await s.call("POST", "/api/approval/consume", { token }, await s.human())).status, 410, "두 번째");
  assert.equal((await s.call("POST", "/api/approval/release", { token }, await s.human(OTHER))).j.ok, false);
  assert.equal((await s.call("POST", "/api/approval/release", { token }, await s.human())).j.ok, true);
  assert.equal((await s.call("POST", "/api/approval/consume", { token }, await s.human())).status, 200, "풀린 뒤 다시");
});

test("소비 때 다시 검사: 그 사이 연결이 지워졌으면 409 로 링크를 되살림 · 만료 410", async () => {
  const s = await setup(); addConn(s);
  const token = tokenOf((await ask(s, "connection.disconnect", { id: CONN })).j.url);
  s.db.prepare("DELETE FROM connection WHERE id = ?").run(CONN);
  const c = await s.call("POST", "/api/approval/consume", { token }, await s.human()); assert.equal(c.status, 409, c.text);
  assert.equal(s.db.prepare("SELECT used_at FROM approval_link").get().used_at, null, "되살림");
  s.db.prepare("UPDATE approval_link SET expires_at = ?").run(Date.now() - 1);
  assert.equal((await s.call("POST", "/api/approval/consume", { token }, await s.human())).status, 410);
});

test("승인으로 만든 요청이 화면 길에서 실제로 통함: 읽기 전용 해제 · 묶음 켜기 · 기기 폐기 (사람 세션이 보냄)", async () => {
  const s = await setup(); addConn(s);
  const run = async (action: string, params: unknown) => { const token = tokenOf((await ask(s, action, params)).j.url); const c = (await s.call("POST", "/api/approval/consume", { token }, await s.human())).j; return s.call(c.method, c.url, c.body, await s.human()); };
  assert.equal((await run("connection.read-only", { id: CONN, on: false })).status, 200); assert.equal(s.db.prepare("SELECT read_only FROM connection WHERE id = ?").get(CONN).read_only, 0);
  assert.equal((await run("bundle.set", { name: "phone-alert", on: true })).status, 200); assert.equal(JSON.parse(s.db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(MEMBER).data).bundles["phone-alert"], true);
  assert.equal((await run("rule.set", { name: "outside", on: false })).status, 200);
  assert.equal((await run("device.revoke", { id: "dev2" })).status, 200); assert.ok(s.db.prepare("SELECT revoked_at FROM device WHERE id = 'dev2'").get().revoked_at);
  assert.equal((await run("session-sync.on", {})).status, 200);
  assert.equal((await run("connection.disconnect", { id: CONN })).status, 200); assert.equal(s.db.prepare("SELECT count(*) n FROM connection").get().n, 0);
});

test("신청한 기기가 그 사이 끊겼으면 링크도 못 씀", async () => {
  const s = await setup(); addConn(s);
  const token = tokenOf((await ask(s, "connection.disconnect", { id: CONN })).j.url);
  s.db.prepare("UPDATE device SET revoked_at = ? WHERE id = 'dev1'").run(Date.now());
  assert.equal((await s.call("POST", "/api/approval/consume", { token }, await s.human())).status, 410);
});

test("연결 목록 읽기(허락 불필요, 자기 연결만, 토큰 · 주소 없음) · 도구 끄기 승인 행동", async () => {
  const s = await setup(); addConn(s); addConn(s, OTHER, "c_" + "c".repeat(20));
  const l = await s.call("GET", "/api/device/connections", undefined, s.dev(DEV1));
  assert.equal(l.status, 200, l.text); assert.deepEqual(l.j.connections.map((c: any) => c.id), [CONN]);
  assert.ok(!("auth" in l.j.connections[0]) && !("url" in l.j.connections[0]) && !("account" in l.j.connections[0]));
  for (const t of [DEVMW, DEVW]) assert.equal((await s.call("GET", "/api/device/connections", undefined, s.dev(t))).status, 401);
  const a = await ask(s, "connection.tools", { id: CONN, off: "create_issue, delete_issue" });
  assert.equal(a.status, 200, a.text); assert.match(a.j.summary, /도구 2개/);
  const c = (await s.call("POST", "/api/approval/consume", { token: tokenOf(a.j.url) }, await s.human())).j;
  assert.deepEqual([c.method, c.url, c.body], ["PATCH", `/api/connections/${CONN}`, { off: ["create_issue", "delete_issue"] }]);
  assert.match((await ask(s, "connection.tools", { id: CONN, off: "" })).j.summary, /모두 켜요/);
  assert.equal((await ask(s, "connection.tools", { id: "c_" + "c".repeat(20), off: "x" })).status, 400, "남의 연결");
  assert.equal((await ask(s, "connection.tools", { id: CONN, off: "x".repeat(121) })).status, 400);
});
