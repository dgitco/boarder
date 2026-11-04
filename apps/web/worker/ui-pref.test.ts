import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", e); return new Response("{}", { status: 500 }); });   // 500 은 까닭을 보이게

const MIG = new URL("../migrations/", import.meta.url);
// 가짜 D1 — batch 는 진짜 트랜잭션. failOnce = 그 글로 시작하는 쓰기 하나를 한 번 실패시킴(D1 일시 오류)
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const st = { failOnce: "" };
  const trip = (sql: string) => { if (st.failOnce && sql.trimStart().startsWith(st.failOnce)) { st.failOnce = ""; throw new Error("D1 일시 오류(시험)"); } };
  const run1 = (sql: string, args: unknown[]) => { trip(sql); const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
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
    batch: async (ss: any[]) => {
      db.exec("BEGIN");
      try {
        const out = ss.map(s => /^\s*select/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args));
        db.exec("COMMIT"); return out;
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },
  } as unknown as D1Database;
  return { db, D1, st };
}

const MEMBER = "member@example.test", OTHER = "other@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(MEMBER: string) {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${MEMBER}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${MEMBER}|${exp}|${sig}`)}`;
}
function setup() {
  const { db, D1 } = d1();
  for (const m of [MEMBER, OTHER]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, "owner@example.test", Date.now());
  const SNAP = { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) };
  const env = { DB: D1, SNAP, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: "owner@example.test", PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const req = async (method: string, path: string, who: string | null, body?: unknown, h: Record<string, string> = { "x-hb": "1", "sec-fetch-site": "same-origin" }) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...(who ? { cookie: await cookie(who) } : {}), ...h }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env, ctx);
    let j: any = {}; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
  return { db, req };
}

test("화면 설정: 쓴 값을 다른 기기(같은 계정)에서 받음 · 남의 계정엔 안 보임", async () => {
  const { req } = setup();
  assert.deepEqual((await req("GET", "/api/me/ui", MEMBER)).j, {}, "처음은 빈 값(화면이 지금 브라우저 값을 올림)");
  for (const [k, v] of [["theme", "dark"], ["accent", "#12ab34"], ["still", "1"], ["favblink", "0"], ["tapthread", "1"], ["unreadkeep", "1"], ["canvasback", "1"]]) assert.equal((await req("POST", "/api/me/ui", MEMBER, { k, v })).status, 200, k);
  assert.deepEqual((await req("GET", "/api/me/ui", MEMBER)).j, { theme: "dark", accent: "#12ab34", still: "1", favblink: "0", tapthread: "1", unreadkeep: "1", canvasback: "1" });
  assert.equal((await req("POST", "/api/me/ui", MEMBER, { k: "theme", v: "light" })).status, 200);
  assert.equal((await req("GET", "/api/me/ui", MEMBER)).j.theme, "light", "고치면 바뀜(줄 하나)");
  assert.deepEqual((await req("GET", "/api/me/ui", OTHER)).j, {}, "남의 계정");
  assert.equal((await req("POST", "/api/me/ui", "owner@example.test", { k: "theme", v: "dark" })).status, 200, "주인도 같은 길");
  assert.deepEqual((await req("GET", "/api/me/ui", "owner@example.test")).j, { theme: "dark" });
});

test("화면 설정 sbw(사이드바 폭): 200~480 정수 · 0(기본)만, 그 밖은 400 · 남의 계정엔 안 보임", async () => {
  const { req } = setup();
  for (const v of ["200", "320", "480", "0"]) assert.equal((await req("POST", "/api/me/ui", MEMBER, { k: "sbw", v })).status, 200, v);
  for (const v of ["199", "481", "1000", "-1", "300.5", "0300", "abc", "", " 300"]) assert.equal((await req("POST", "/api/me/ui", MEMBER, { k: "sbw", v })).status, 400, JSON.stringify(v));
  assert.equal((await req("POST", "/api/me/ui", MEMBER, { k: "sbw", v: "360" })).status, 200);
  assert.equal((await req("GET", "/api/me/ui", MEMBER)).j.sbw, "360");
  assert.equal((await req("GET", "/api/me/ui", OTHER)).j.sbw, undefined);
});

test("화면 설정: 정해 둔 키 · 꼴만, 다른 사이트 글 · 로그인 없음은 막음", async () => {
  const { req, db } = setup();
  for (const [k, v] of [["theme", "pink"], ["accent", "red"], ["accent", "#12AB3"], ["still", "yes"], ["favblink", "off"], ["tapthread", "true"], ["unreadkeep", "true"], ["unreadkeep", "2"], ["canvasback", "true"], ["canvasback", "2"], ["primary_win", "window:x"], ["", ""], ["toString", "x".repeat(5000)], ["constructor", "1"], ["__proto__", "1"], ["hasOwnProperty", "1"]]) assert.equal((await req("POST", "/api/me/ui", MEMBER, { k, v })).status, 400, `${k}=${v}`);
  assert.equal((await req("POST", "/api/me/ui", MEMBER, { k: "theme", v: "dark" }, { "sec-fetch-site": "cross-site", "x-hb": "1" })).status, 403, "다른 사이트");
  assert.equal((await req("POST", "/api/me/ui", MEMBER, { k: "theme", v: "dark" }, {})).status, 403, "x-hb 없음");
  assert.equal((await req("POST", "/api/me/ui", null, { k: "theme", v: "dark" })).status, 401);
  assert.equal((await req("GET", "/api/me/ui", null)).status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM user_pref").get()!.n, 0, "막힌 글은 아무것도 안 씀");
  db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(MEMBER, "ui:theme", "<script>", Date.now());
  assert.deepEqual((await req("GET", "/api/me/ui", MEMBER)).j, {}, "꼴이 아닌 저장 값은 안 내보냄");
  db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(MEMBER, "ui:toString", "x", Date.now());
  assert.deepEqual((await req("GET", "/api/me/ui", MEMBER)).j, {}, "객체 원형 이름 저장 값도 안 내보냄");
});
