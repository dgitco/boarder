import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
const MIG = new URL("../migrations/", import.meta.url);
let mode: "ok" | "fail" | "once" = "ok", msg = "D1_ERROR: something broke", throws = 0, gen = 0;
const boom = () => { throws++; if (mode === "once" && throws === 1) { const g = gen; setTimeout(() => { if (g === gen) mode = "ok"; }, 60); } return new Error(msg); };
const bad = () => mode !== "ok";
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => { if (bad()) throw boom(); return { success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }; },
    first: async (col?: string) => { if (bad()) throw boom(); const r = db.prepare(sql).get(...(args as never[])) as any; return r ? (col ? r[col] : r) : null; },
    raw: async () => { if (bad()) throw boom(); return db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)); },
    run: async () => { if (bad()) throw boom(); return run1(sql, args); },
  });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { if (bad()) throw boom(); return ss.map(s => /^\s*(select|with)/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); } } as unknown as D1Database;
  return { db, D1 };
}
const OWNER = "owner@example.test", MEMBER = "member@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
const { db, D1 } = d1();
db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, Date.now());
db.prepare("INSERT INTO member_bot(owner, seed, hue, name, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?)").run(MEMBER, 1, 1, "봇", "bot", "x", Date.now());
const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0, get: async () => null }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
const logs: any[] = []; const ce = console.error; console.error = (...a: unknown[]) => { try { const j = JSON.parse(String(a[0])); if (j.ev === "req_error") { logs.push(j); return; } } catch {} };
const call = async (method: string, path: string, h: Record<string, string> = {}, body?: unknown) => {
  const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { cookie: await cookie(MEMBER), "x-hb": "1", "sec-fetch-site": "same-origin", "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  return { status: r.status, h: r.headers, text: await r.text() };
};
const reset = (m: typeof mode, s = "D1_ERROR: something broke") => { gen++; mode = m; msg = s; throws = 0; logs.length = 0; };

test("기준: 고장 없으면 GET /api/data 200", async () => { reset("ok"); const r = await call("GET", "/api/data"); assert.equal(r.status, 200, r.text.slice(0, 200)); });
test("GET 첫 시도만 예외 → 서버가 한 번 다시 → 200", async () => {
  reset("once"); const r = await call("GET", "/api/data");
  assert.equal(r.status, 200, r.text.slice(0, 200)); assert.equal(logs.length, 1); assert.equal(logs[0].again, false);
});
test("GET 늘 예외 → 한 번만 다시(무한 아님) → 503 + x-retry-safe", async () => {
  reset("fail"); const r = await call("GET", "/api/data");
  assert.equal(r.status, 503); assert.equal(r.h.get("x-retry-safe"), "1"); assert.equal(logs.length, 2); assert.deepEqual(logs.map(l => l.again), [false, true]);
});
test("GET D1 과부하 → 서버가 다시 안 함 → 503", async () => {
  reset("fail", "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window"); const r = await call("GET", "/api/data");
  assert.equal(r.status, 503); assert.equal(logs.length, 1); assert.equal(logs[0].busy, true);
});
test("x-bx-again 을 밖에서 붙여도 다시 안 할 뿐 → 503", async () => {
  reset("once"); const r = await call("GET", "/api/data", { "x-bx-again": "1" }); assert.equal(r.status, 503); assert.equal(logs.length, 1);
});
test("POST 예외 → 다시 안 함 → 500", async () => {
  reset("fail"); const r = await call("POST", "/api/chat", { origin: "https://example.test" }, { text: "hi", channel: "primary" });
  assert.equal(r.status, 500, r.text.slice(0, 200)); assert.equal(logs.length, 1);
});
test("첫 화면(HTML) 예외 → 503 html + meta refresh", async () => {
  reset("fail"); const r = await call("GET", "/", { accept: "text/html,application/xhtml+xml" });
  assert.equal(r.status, 503, r.text.slice(0, 200)); assert.match(r.h.get("content-type") || "", /text\/html/); assert.match(r.text, /location\.reload/);
});
test.after(() => { console.error = ce; });
