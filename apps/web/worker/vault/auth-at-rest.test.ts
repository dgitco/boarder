// node --test --no-warnings --experimental-transform-types apps/web/worker/vault/auth-at-rest.test.ts (Node 22.18+ · node:sqlite · apps/web 의존성 설치된 채)
// better-auth 칸(봉투 암호화 §13): account.accessToken · refreshToken = encryptOAuthTokens, verification.value(로그인 코드) = otpStore.
// 옛 평문 줄(배포 앞에 쓴 것)도 그대로 읽히고(토큰 새로 받기 · 코드 확인), 새로 쓰는 줄은 D1 덤프에 평문이 없음. 있는 줄은 vault scope "account" 로 옮김 · 되돌림.
// 자료 · 키 · 토큰은 다 지어낸 것, 구글 토큰 길(fetch)은 가짜.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("../test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { createAuth, otpStore, OTP_SEALED } = await import("../auth.ts");
const M = await import("./migrate.ts");
const { default: app } = await import("../index.ts");

const MIG = new URL("../../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const q = (sql: string, args: unknown[]) => /^\s*(select|with)/i.test(sql) || /\breturning\b/i.test(sql);
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: { changes: 0 } }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => (q(sql, args) ? { success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} } : run1(sql, args)),
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = ss.map(s => q(s.sql, s.args) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; } },
    exec: async (sql: string) => { db.exec(sql); return { count: 1 }; },
  } as unknown as D1Database;
  return { db, D1 };
}
const OWNER = "owner@example.test", ADMIN = "admin-token-made-up-0123456789", SECRET = "made-up-better-auth-secret-0123456789abcdef";
const OLD_ACCESS = "ya29.made-up-old-access-token_AAAA", OLD_REFRESH = "1//made-up-old-refresh-token-BBBB";
const NEW_ACCESS = "ya29.made-up-new-access-token_CCCC", NEW_REFRESH = "1//made-up-new-refresh-token-DDDD";

function setup() {
  const t = d1(), sent: { to: string; subject: string }[] = [];
  const env: any = {
    DB: t.D1, BETTER_AUTH_SECRET: SECRET, PUBLIC_URL: "https://example.test", ALLOW_EMAILS: OWNER, ADMIN_TOKEN: ADMIN,
    GOOGLE_CLIENT_ID: "made-up-client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "made-up-client-secret",
    EMAIL: { send: async (m: { to: string; subject: string }) => { sent.push(m); } },
  };
  const now = new Date().toISOString();
  t.db.prepare(`INSERT INTO "user"(id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u_owner', 'Owner', ?, 1, ?, ?)`).run(OWNER, now, now);
  return { ...t, env, sent, auth: createAuth(env) };
}
// 배포 앞(encryptOAuthTokens 없을 때) better-auth 가 쓴 꼴 그대로: 평문 토큰 · 평문 idToken
const legacyAccount = (db: DatabaseSync, expired: boolean) => {
  const now = new Date().toISOString(), exp = new Date(Date.now() + (expired ? -60_000 : 3_600_000)).toISOString();
  db.prepare(`INSERT INTO account(id, accountId, providerId, userId, accessToken, refreshToken, idToken, accessTokenExpiresAt, scope, createdAt, updatedAt) VALUES ('a_g1', 'google-sub-1', 'google', 'u_owner', ?, ?, 'eyJmade.up.idtoken', ?, 'openid,email', ?, ?)`)
    .run(OLD_ACCESS, OLD_REFRESH, exp, now, now);
};
const row = (db: DatabaseSync) => db.prepare("SELECT accessToken, refreshToken, idToken FROM account WHERE id = 'a_g1'").get() as { accessToken: string; refreshToken: string; idToken: string };
const dump = (db: DatabaseSync) => JSON.stringify(["account", "verification"].map(tb => db.prepare(`SELECT * FROM ${tb}`).all()));
// 구글 토큰 길만 가짜로(받은 refresh_token 을 돌려줌)
async function withGoogle<T>(f: (seen: string[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch, seen: string[] = [];
  globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
    const url = String(u instanceof Request ? u.url : u);
    if (!url.startsWith("https://oauth2.googleapis.com/token")) return real(u as never, init);
    seen.push(new URLSearchParams(String(init?.body ?? "")).get("refresh_token") || "");
    return new Response(JSON.stringify({ access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, expires_in: 3600, token_type: "Bearer", scope: "openid email" }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try { return await f(seen); } finally { globalThis.fetch = real; }
}

test("옛 평문 토큰 줄: 안 지난 access 는 그대로 · 지난 것은 평문 refresh 로 새로 받음 → 새 토큰은 봉해서 씀(덤프에 평문 없음)", async () => {
  const s = setup();
  legacyAccount(s.db, false);
  const a = await s.auth.api.getAccessToken({ body: { accountId: "a_g1", userId: "u_owner" } });
  assert.equal(a.accessToken, OLD_ACCESS, "옛 평문 access 는 hex 가 아니라 그대로 읽힘");
  s.db.prepare("UPDATE account SET accessTokenExpiresAt = ? WHERE id = 'a_g1'").run(new Date(Date.now() - 60_000).toISOString());
  const b = await withGoogle(async seen => { const r = await s.auth.api.getAccessToken({ body: { accountId: "a_g1", userId: "u_owner" } }); assert.deepEqual(seen, [OLD_REFRESH], "평문 refresh 를 그대로 구글에 보냄"); return r; });
  assert.equal(b.accessToken, NEW_ACCESS);
  const r = row(s.db);
  assert.match(r.accessToken, /^[0-9a-f]+$/); assert.match(r.refreshToken, /^[0-9a-f]+$/);
  const d = dump(s.db);
  for (const p of [NEW_ACCESS, NEW_REFRESH]) assert.ok(!d.includes(p), `덤프에 「${p}」`);
  // 봉한 줄도 다시 읽힘(안 지남 → 연 access, 지남 → 연 refresh 를 구글에 보냄)
  assert.equal((await s.auth.api.getAccessToken({ body: { accountId: "a_g1", userId: "u_owner" } })).accessToken, NEW_ACCESS);
  s.db.prepare("UPDATE account SET accessTokenExpiresAt = ? WHERE id = 'a_g1'").run(new Date(Date.now() - 60_000).toISOString());
  await withGoogle(async seen => { await s.auth.api.getAccessToken({ body: { accountId: "a_g1", userId: "u_owner" } }); assert.deepEqual(seen, [NEW_REFRESH]); });
});

test("vault scope account: plan · run(봉함) · 다시 run 0 · back(평문) — 읽는 답은 셋 다 같음, 봉투 스위치(KEK)와 상관없이 관리 길로 돎", async () => {
  const s = setup();
  legacyAccount(s.db, true);
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + ADMIN }, body: body === undefined ? undefined : JSON.stringify(body) }), s.env, { waitUntil() {}, passThroughOnException() {} } as any);
    return { status: r.status, j: await r.json().catch(() => null) as any };
  };
  assert.ok(M.scopes().includes("account")); assert.equal(M.envelopeScope("account"), false); assert.equal(M.envelopeScope("connection"), true);
  assert.deepEqual((await call("GET", "/api/admin/vault?scope=account")).j.plan, { accessToken: { plain: 1, v1: 0, v2: 0, empty: 0 }, refreshToken: { plain: 1, v1: 0, v2: 0, empty: 0 } });
  assert.equal((await call("GET", "/api/admin/vault?scope=account&owner=")).j.plan.accessToken.plain, 1);
  assert.equal((await call("GET", `/api/admin/vault?scope=account&owner=${encodeURIComponent("b@example.test")}`)).j.plan.accessToken.plain, 0);
  const ran = await call("POST", "/api/admin/vault", { action: "run", scope: "account" });
  assert.equal(ran.status, 200, "KEK · envelope 스위치 없어도 run(409 아님)");
  assert.deepEqual([ran.j.done, ran.j.failed], [1, []]);
  const r = row(s.db);
  assert.match(r.accessToken, /^[0-9a-f]+$/); assert.match(r.refreshToken, /^[0-9a-f]+$/);
  assert.ok(!dump(s.db).includes(OLD_ACCESS) && !dump(s.db).includes(OLD_REFRESH));
  assert.equal(r.idToken, "eyJmade.up.idtoken", "idToken 은 better-auth 가 안 봉함 — 그대로(문서 §13)");
  assert.equal((await call("POST", "/api/admin/vault", { action: "run", scope: "account" })).j.done, 0, "두 번 돌려도 같음");
  // 옮긴 줄을 better-auth 가 읽음: 지난 access → 연 refresh 로 새로 받기
  await withGoogle(async seen => { await s.auth.api.getAccessToken({ body: { accountId: "a_g1", userId: "u_owner" } }); assert.deepEqual(seen, [OLD_REFRESH]); });
  // back: 평문으로(encryptOAuthTokens 를 끄기 전에)
  const bk = await call("POST", "/api/admin/vault", { action: "back", scope: "account" });
  assert.deepEqual([bk.status, bk.j.done, bk.j.failed], [200, 1, []]);
  assert.deepEqual([row(s.db).accessToken, row(s.db).refreshToken], [NEW_ACCESS, NEW_REFRESH]);
  // 깨진 줄(짝수 hex 인데 안 열림)은 그 줄만 failed, 값 그대로
  s.db.prepare("UPDATE account SET accessToken = 'abcd' WHERE id = 'a_g1'").run();
  const b2 = await M.back(s.env, "account");
  assert.deepEqual(b2.failed.map(f => f.key), ["account:a_g1"]);
  assert.equal(row(s.db).accessToken, "abcd");
});

test("로그인 코드: 배포 앞에 보낸 평문 코드 줄도 확인됨 · 새 코드는 e1. 로 봉해서 씀(덤프에 코드 없음) · 틀린 코드 셈은 그대로", async () => {
  const s = setup();
  const exp = new Date(Date.now() + 300_000).toISOString(), now = new Date().toISOString();
  s.db.prepare("INSERT INTO verification(id, identifier, value, expiresAt, createdAt, updatedAt) VALUES ('v_old', ?, '482913:0', ?, ?, ?)").run(`sign-in-otp-${OWNER}`, exp, now, now);
  await assert.rejects(s.auth.api.signInEmailOTP({ body: { email: OWNER, otp: "000000" } }), "틀린 코드는 거절");
  assert.equal((s.db.prepare("SELECT value FROM verification WHERE identifier = ?").get(`sign-in-otp-${OWNER}`) as any)?.value, "482913:1", "틀린 셈이 옛 줄에도 붙음(평문 그대로)");
  const ok = await s.auth.api.signInEmailOTP({ body: { email: OWNER, otp: "482913" } });
  assert.equal(ok.user.email, OWNER, "옛 평문 코드로 로그인");
  // 새 코드
  await s.auth.api.sendVerificationOTP({ body: { email: OWNER, type: "sign-in" } });
  assert.equal(s.sent.length, 1);
  const code = s.sent[0].subject.match(/(\d{6})$/)![1];
  const v = (s.db.prepare("SELECT value FROM verification WHERE identifier = ?").get(`sign-in-otp-${OWNER}`) as any).value as string;
  assert.ok(v.startsWith(OTP_SEALED), v); assert.ok(!dump(s.db).includes(code), "덤프에 코드 없음");
  // 봉한 줄: 열면 그 코드 · 다른 비밀로는 못 엶
  assert.equal(await otpStore(SECRET).decrypt(v.slice(0, v.lastIndexOf(":"))), code);
  await assert.rejects(otpStore("another-made-up-secret-0123456789abcdef").decrypt(v.slice(0, v.lastIndexOf(":"))));
  const ok2 = await s.auth.api.signInEmailOTP({ body: { email: OWNER, otp: code } });
  assert.equal(ok2.user.email, OWNER, "봉한 코드로 로그인");
  assert.equal(s.db.prepare("SELECT 1 FROM verification WHERE identifier = ?").get(`sign-in-otp-${OWNER}`), undefined, "쓴 코드는 지움");
});
