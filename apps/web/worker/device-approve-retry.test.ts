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
  const { db, D1, st } = d1();
  for (const m of [MEMBER, OTHER]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, "owner@example.test", Date.now());
  const SNAP = { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) };
  const env = { DB: D1, SNAP, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: "owner@example.test", PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (path: string, body: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }), env, ctx);
    let j: any = {}; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
  const approve = async (user_code: string, allow = true, who = MEMBER) => call("/api/device/approve", { user_code, allow }, { "x-hb": "1", "sec-fetch-site": "same-origin", cookie: await cookie(who) });
  return { db, st, call, approve };
}
// boarder setup 의 기본 길(브라우저 있는 기기): 127.0.0.1 콜백 + PKCE
async function localCode(call: (p: string, b: unknown) => Promise<{ status: number; j: any }>) {
  const verifier = "v".repeat(43);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const c = await call("/api/device/code", { name: "member laptop", tools: ["claude"], callback: "http://127.0.0.1:43123/callback", state: "s".repeat(24), code_challenge: challenge });
  assert.equal(c.status, 200, JSON.stringify(c.j)); assert.equal(c.j.mode, "local");
  return { dc: c.j.device_code as string, uc: c.j.user_code as string, verifier };
}
const grantOf = (redirect: string) => new URL(redirect).searchParams.get("code");

test("기기 허용: 「허용」 답(127.0.0.1 로 넘길 주소)을 잃고 다시 눌러도 그 기기로 넘어가 로그인이 이어짐", async () => {
  const { call, approve } = setup();
  const { dc, uc, verifier } = await localCode(call);
  const lost = await approve(uc);   // 서버는 승인했는데 브라우저가 답을 못 받음(끊김) — 화면은 「일시적인 오류」, 단추는 다시 눌림
  assert.equal(lost.status, 200);
  const again = await approve(uc);
  assert.equal(again.status, 200, `다시 누르면 그 기기로 넘어가야 함 — 받은 답 ${again.status} ${JSON.stringify(again.j)}`);
  const g = grantOf(again.j.redirect);
  assert.ok(g, "redirect 에 grant");
  const t = await call("/api/device/token", { device_code: dc, code: g, code_verifier: verifier });
  assert.equal(t.j.state, "approved", JSON.stringify(t.j));
});

test("기기 허용 다시 누르기: 다른 사람 · 반대 결정 · 이미 토큰을 받은 코드는 여전히 「이미 처리」", async () => {
  const { call, approve } = setup();
  const { dc, uc, verifier } = await localCode(call);
  const first = await approve(uc);
  assert.equal((await approve(uc, true, OTHER)).j.error, "done", "다른 회원은 남의 승인에 grant 를 못 받음");
  assert.equal((await approve(uc, false)).j.error, "done", "허용한 뒤 거절은 안 바뀜");
  const t = await call("/api/device/token", { device_code: dc, code: grantOf(first.j.redirect), code_verifier: verifier });
  assert.equal(t.j.state, "approved");
  assert.equal((await approve(uc)).j.error, "done", "토큰을 받은 뒤엔 새 grant 없음");
});

test("기기 거절: 답을 잃고 다시 눌러도 그 기기에 거절을 알림", async () => {
  const { call, approve } = setup();
  const { uc } = await localCode(call);
  await approve(uc, false);
  const again = await approve(uc, false);
  assert.equal(again.status, 200, JSON.stringify(again.j));
  assert.match(again.j.redirect, /error=denied/);
});
