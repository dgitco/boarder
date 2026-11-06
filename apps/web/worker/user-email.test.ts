import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const UE = await import("./user-email.ts");
const { member } = await import("./auth.ts");
const { default: app } = await import("./index.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const q = (sql: string) => /^\s*(select|with)/i.test(sql) || /\breturning\b/i.test(sql);
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: { changes: 0 } }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => (q(sql) ? { success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} } : run1(sql, args)),
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = ss.map(s => q(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; } },
    exec: async (sql: string) => { db.exec(sql); return { count: 1 }; },
  } as unknown as D1Database;
  return { db, D1 };
}
const OWNER = "owner@example.test", OWNER2 = "owner2@example.test", ADMIN = "admin-token-made-up-0123456789", SECRET = "made-up-better-auth-secret-0123456789abcdef";
const A = "a@example.com", A2 = "a2@example.com", A3 = "a3@corp.test", B = "b@example.com", C = "c@example.com";
const BASE = "https://example.test";
const ctx = { waitUntil() {}, passThroughOnException() {} } as any;

function setup() {
  const t = d1(), sent: { to: string; subject: string }[] = [];
  const env: any = {
    DB: t.D1, BETTER_AUTH_SECRET: SECRET, PUBLIC_URL: BASE, ALLOW_EMAILS: `${OWNER},${OWNER2}`, ADMIN_TOKEN: ADMIN,
    EMAIL: { send: async (m: { to: string; subject: string }) => { sent.push(m); } },
    SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) },   // 화면 알림(live.ts)은 가짜
  };
  const now = new Date().toISOString(), user = (id: string, e: string) => t.db.prepare(`INSERT INTO "user"(id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`).run(id, e.split("@")[0], e, now, now);
  user("u_owner", OWNER); user("u_owner2", OWNER2); user("u_a", A); user("u_b", B);
  for (const e of [A, B, C]) t.db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?, ?, ?)").run(e, OWNER, Date.now());
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request(BASE + path, { method, headers: { "content-type": "application/json", origin: BASE, ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    return { status: r.status, j: await r.json().catch(() => null) as any, cookies: r.headers.getSetCookie() };
  };
  const adminCall = (path: string, body: unknown) => call("POST", path, body, { authorization: "Bearer " + ADMIN });
  // 시험 세션(관리 토큰): 쿠키 머리 한 줄
  const login = async (email: string) => { const r = await adminCall("/api/admin/test-session", { email }); assert.equal(r.status, 200, JSON.stringify(r.j)); return (r.j.cookies as { name: string; value: string }[]).map(c => `${c.name}=${c.value}`).join("; "); };
  const as = (cookie: string) => (method: string, path: string, body?: unknown) => call(method, path, body, { cookie, "x-hb": "1", "sec-fetch-site": "same-origin" });
  return { ...t, env, sent, call, adminCall, login, as };
}
const users = (db: DatabaseSync) => (db.prepare('SELECT email FROM "user" ORDER BY email').all() as { email: string }[]).map(r => r.email);

test("이주 0086: 지금 user 줄마다 열쇠 메일 한 줄(대표) · 새 가입도 트리거로", async () => {
  const s = setup();
  const rows = s.db.prepare("SELECT email, user_id, is_primary FROM user_email ORDER BY email").all() as any[];
  assert.deepEqual(rows.map(r => [r.email, r.user_id, r.is_primary]), [[A, "u_a", 1], [B, "u_b", 1], [OWNER2, "u_owner2", 1], [OWNER, "u_owner", 1]]);
});

test("메일 더하기: 코드 메일 → 확인 → 붙음 · 틀린 코드 · 한 번만 · 만료 · 시험 주소는 메일 없이 관리 길로 코드", async () => {
  const s = setup(), a = s.as(await s.login(A));
  // 진짜 주소: 코드 메일이 그 주소로 감, 응답에 코드 없음
  const r = await a("POST", "/api/me/emails", { email: " A3@Corp.test " });
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.email, A3); assert.equal(r.j.code, undefined, "코드는 응답에 안 냄");
  assert.equal(s.sent.length, 1); assert.equal(s.sent[0].to, A3);
  const code = s.sent[0].subject.match(/(\d{6})$/)![1];
  assert.ok(!JSON.stringify(s.db.prepare("SELECT * FROM verification").all()).includes(code), "코드는 봉해서 씀");
  assert.equal((await s.adminCall("/api/admin/test-email-code", { email: A3 })).status, 404, "진짜 주소 코드는 관리 길로도 안 나옴");
  // 확인 전: 목록엔 대기, 로그인 · 회원으로 안 셈
  let l = await a("GET", "/api/me/emails");
  assert.deepEqual(l.j.pending, [A3]); assert.deepEqual(l.j.emails.map((e: any) => e.email), [A]);
  assert.equal(await member(s.env, A3), false, "확인 전 메일은 회원 아님");
  assert.equal((await s.call("POST", "/api/login/lookup", { email: A3 })).j.error, "invite_required");
  // 틀린 코드 → 맞는 코드 → 붙음 → 같은 코드 다시는 안 됨
  assert.equal((await a("POST", "/api/me/emails/verify", { email: A3, code: code === "000000" ? "111111" : "000000" })).j.error, "코드가 맞지 않아요");
  const ok = await a("POST", "/api/me/emails/verify", { email: A3, code });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.equal((await a("POST", "/api/me/emails/verify", { email: A3, code })).j.error, "코드가 지났어요. 다시 받아 주세요", "한 번만(코드 줄은 지워짐)");
  l = await a("GET", "/api/me/emails");
  assert.deepEqual(l.j.emails.map((e: any) => [e.email, e.primary, e.key]), [[A, true, true], [A3, false, false]]);
  assert.deepEqual(l.j.pending, []);
  assert.equal(await member(s.env, A3), true, "확인된 붙은 메일은 그 계정이 회원이라 회원");
  assert.equal((await s.call("POST", "/api/login/lookup", { email: A3 })).j.account, "exists");
  // 시험 주소: 메일 안 보냄 · 관리 길로 코드
  const before = s.sent.length;
  assert.equal((await a("POST", "/api/me/emails", { email: A2 })).status, 200);
  assert.equal(s.sent.length, before, "@example.com 엔 안 보냄");
  assert.equal((await s.call("POST", "/api/admin/test-email-code", { email: A2 })).status, 403, "관리 토큰 없으면 거절");
  const tc = await s.adminCall("/api/admin/test-email-code", { email: A2 });
  assert.match(tc.j.code, /^\d{6}$/);
  // 만료: 10분 지나면 「지났어요」, 줄도 지움
  s.db.prepare("UPDATE verification SET expiresAt = ? WHERE identifier LIKE 'add-email:%'").run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await a("POST", "/api/me/emails/verify", { email: A2, code: tc.j.code })).j.error, "코드가 지났어요. 다시 받아 주세요");
  assert.equal((s.db.prepare("SELECT count(*) n FROM verification WHERE identifier LIKE 'add-email:%'").get() as any).n, 0);
  // 다섯 번 틀리면 코드가 사라짐
  await a("POST", "/api/me/emails", { email: A2 });
  const c2 = (await s.adminCall("/api/admin/test-email-code", { email: A2 })).j.code as string, wrong = c2 === "999999" ? "888888" : "999999";
  for (let i = 0; i < 4; i++) assert.equal((await a("POST", "/api/me/emails/verify", { email: A2, code: wrong })).j.error, "코드가 맞지 않아요");
  assert.equal((await a("POST", "/api/me/emails/verify", { email: A2, code: wrong })).j.error, "코드를 너무 많이 틀렸어요. 다시 받아 주세요");
  assert.equal((await a("POST", "/api/me/emails/verify", { email: A2, code: c2 })).j.error, "코드가 지났어요. 다시 받아 주세요", "맞는 코드도 이제 안 됨");
});

test("붙은 메일 로그인: 코드 로그인 · 시험 세션 모두 열쇠 user(열쇠 메일)로 · 빈 user 줄 안 남음 · 캐시 쿠키 비움", async () => {
  const s = setup(); let a = s.as(await s.login(A));
  await a("POST", "/api/me/emails", { email: A3 });
  await a("POST", "/api/me/emails/verify", { email: A3, code: s.sent.at(-1)!.subject.match(/(\d{6})$/)![1] });
  // 코드 로그인(better-auth 길 그대로): 코드 메일은 붙은 메일로 감
  const sent = await s.call("POST", "/api/auth/email-otp/send-verification-otp", { email: A3, type: "sign-in" });
  assert.equal(sent.status, 200, JSON.stringify(sent.j));
  assert.equal(s.sent.at(-1)!.to, A3);
  const otp = s.sent.at(-1)!.subject.match(/(\d{6})$/)![1];
  const si = await s.call("POST", "/api/auth/sign-in/email-otp", { email: A3, otp });
  assert.equal(si.status, 200, JSON.stringify(si.j));
  const tok = si.cookies.find(c => /session_token=/.test(c))!.split(";")[0];
  assert.ok(si.cookies.some(c => /session_data=;.*Max-Age=0/.test(c)), "캐시 쿠키(빈 user 를 담음)는 비움: " + si.cookies.join(" | "));
  assert.ok(!si.cookies.some(c => /session_data=[^;]/.test(c)), "빈 user 캐시 쿠키가 안 남음");
  const me = await s.call("GET", "/api/me", undefined, { cookie: tok });
  assert.equal(me.j.user.email, A, "열쇠 메일로 보임(데이터 열쇠 그대로)");
  assert.deepEqual(users(s.db), [A, B, OWNER2, OWNER], "붙은 메일로 만든 빈 user 줄은 지움");
  // 쿠키 길(signedIn)도 열쇠 메일
  assert.equal((await s.as(tok)("GET", "/api/me/emails")).j.emails[0].email, A);
  // 한 번 더 로그인해도 같음(빈 줄이 또 생겼다 지워짐)
  await s.call("POST", "/api/auth/email-otp/send-verification-otp", { email: A3, type: "sign-in" });
  const si2 = await s.call("POST", "/api/auth/sign-in/email-otp", { email: A3, otp: s.sent.at(-1)!.subject.match(/(\d{6})$/)![1] });
  assert.equal((await s.call("GET", "/api/me", undefined, { cookie: si2.cookies.find(c => /session_token=/.test(c))!.split(";")[0] })).j.user.email, A);
  assert.deepEqual(users(s.db), [A, B, OWNER2, OWNER]);
  // 열쇠 메일 로그인은 그대로(옮기지 않음)
  await s.call("POST", "/api/auth/email-otp/send-verification-otp", { email: A, type: "sign-in" });
  const si3 = await s.call("POST", "/api/auth/sign-in/email-otp", { email: A, otp: s.sent.at(-1)!.subject.match(/(\d{6})$/)![1] });
  assert.ok(si3.cookies.some(c => /session_data=[^;]/.test(c)), "열쇠 메일 로그인은 캐시 쿠키 그대로");
  // 열쇠 메일을 바꾸는 better-auth 길은 꺼짐(데이터 열쇠)
  for (const p of ["/api/auth/change-email", "/api/auth/email-otp/request-email-change", "/api/auth/email-otp/change-email"])
    assert.equal((await s.call("POST", p, { newEmail: "x@example.com", email: "x@example.com" }, { cookie: tok })).status, 404, p);
  // 시험 세션 길(관리 토큰)도 붙은 시험 메일 → 열쇠 user
  await a("POST", "/api/me/emails", { email: A2 });
  await a("POST", "/api/me/emails/verify", { email: A2, code: (await s.adminCall("/api/admin/test-email-code", { email: A2 })).j.code });
  const ck = await s.login(A2);
  assert.equal((await s.call("GET", "/api/me", undefined, { cookie: ck })).j.user.email, A);
  assert.deepEqual(users(s.db), [A, B, OWNER2, OWNER]);
  // 붙은 메일로 지우기(revoke)는 열쇠 계정 세션을 지움
  assert.equal((await s.adminCall("/api/admin/test-session", { email: A2, revoke: true })).status, 200);
  assert.equal((await s.call("GET", "/api/me", undefined, { cookie: ck })).status, 401, "열쇠 계정 세션이 지워짐");
  a = s.as(await s.login(A));
  // 뗀 메일로는 더 로그인 못 함(회원 아님 → 코드 안 감)
  assert.equal((await a("DELETE", "/api/me/emails/" + encodeURIComponent(A3))).status, 200);
  const n = s.sent.length;
  await s.call("POST", "/api/auth/email-otp/send-verification-otp", { email: A3, type: "sign-in" });
  assert.equal(s.sent.length, n, "뗀 메일엔 로그인 코드 안 감");
});

test("가로채기 막기: 남의 계정 메일 · 남이 붙인 메일 · 주인 메일(회원이) · 회원 메일(주인이) · 10개 상한", async () => {
  const s = setup(), a = s.as(await s.login(A)), b = s.as(await s.login(B));
  assert.deepEqual([(await a("POST", "/api/me/emails", { email: B })).status, (await a("POST", "/api/me/emails", { email: B })).j.error], [409, UE.TAKEN], "그 메일로 가입한 계정이 있음");
  assert.equal((await a("POST", "/api/me/emails", { email: OWNER })).j.error, UE.TAKEN, "회원이 주인 메일");
  assert.equal((await a("POST", "/api/me/emails", { email: A })).j.error, "이미 붙은 메일이에요");
  assert.equal((await a("POST", "/api/me/emails", { email: "nope" })).j.error, "메일 주소를 확인해 주세요");
  // A 가 붙인 메일은 B 가 못 붙임 · B 가 대기 중인 같은 메일도 A 가 먼저 확인하면 B 확인은 거절
  await a("POST", "/api/me/emails", { email: A2 }); await b("POST", "/api/me/emails", { email: A2 });
  const codes = s.db.prepare("SELECT identifier FROM verification WHERE identifier LIKE 'add-email:%'").all() as any[];
  assert.equal(codes.length, 2, "대기는 계정마다 따로");
  const ca = (await UE.testCode(s.env, A2))!;   // 마지막 것(B) — 계정별로 따로 꺼냄
  const cOf = async (uid: string) => { const v = (s.db.prepare("SELECT value FROM verification WHERE identifier = ?").get(`add-email:${uid}:${A2}`) as any).value as string; const { symmetricDecrypt } = await import("better-auth/crypto"); return (await symmetricDecrypt({ key: SECRET, data: v.slice(3) })).split(":")[0]; };
  assert.equal(ca, await cOf("u_b"));
  assert.equal((await a("POST", "/api/me/emails/verify", { email: A2, code: await cOf("u_a") })).status, 200);
  assert.equal((await b("POST", "/api/me/emails/verify", { email: A2, code: await cOf("u_b") })).j.error, UE.TAKEN, "먼저 붙은 계정이 있음");
  assert.equal((await b("POST", "/api/me/emails", { email: A2 })).j.error, UE.TAKEN);
  // 남이 확인 안 한 메일 코드를 내 계정 코드로 못 씀(계정마다 identifier)
  await b("POST", "/api/me/emails", { email: "z@example.com" });
  assert.equal((await a("POST", "/api/me/emails/verify", { email: "z@example.com", code: (await UE.testCode(s.env, "z@example.com"))! })).j.error, "코드가 지났어요. 다시 받아 주세요");
  // 주인이 회원 메일(초대됨, 아직 가입 안 함) — 첫 판은 막음
  assert.equal((await UE.startAdd(s.env, OWNER, C, async () => true) as any).error, "회원이 쓰는 메일이라 붙일 수 없어요");
  // 10개 상한(열쇠 메일 + 붙은 것 + 대기)
  for (let i = 0; i < 7; i++) s.db.prepare("INSERT INTO user_email(email, user_id, verified_at, is_primary, added_at) VALUES (?, 'u_a', 1, 0, 1)").run(`x${i}@example.com`);
  s.db.prepare("DELETE FROM otp_send").run();
  assert.equal((await a("POST", "/api/me/emails", { email: "x8@example.com" })).status, 200, "열쇠 + 붙은 8 + 대기 1 = 10");
  assert.equal((await a("POST", "/api/me/emails", { email: "x9@example.com" })).j.error, "메일은 10개까지 붙여요");
});

test("코드 메일 상한: 한 계정이 여러 주소로 10분에 5번까지(더하기 · 취소 되풀이로 메일 뿌리기 막음)", async () => {
  const s = setup(), a = s.as(await s.login(A));
  for (let i = 0; i < 5; i++) {
    assert.equal((await a("POST", "/api/me/emails", { email: `y${i}@corp.test` })).status, 200);
    assert.equal((await a("DELETE", "/api/me/emails/" + encodeURIComponent(`y${i}@corp.test`))).status, 200, "대기 취소");
  }
  const r = await a("POST", "/api/me/emails", { email: "y9@corp.test" });
  assert.deepEqual([r.status, r.j.error], [429, "잠시 뒤 다시 해 주세요"]);
  assert.equal(s.sent.length, 5);
});

test("대표 메일 · 떼기: 대표로 → /api/me primary_email · 대표를 떼면 열쇠 메일로 · 열쇠 메일은 못 뗌 · 주인 넷은 잠김", async () => {
  const s = setup(), a = s.as(await s.login(A));
  await a("POST", "/api/me/emails", { email: A2 });
  await a("POST", "/api/me/emails/verify", { email: A2, code: (await s.adminCall("/api/admin/test-email-code", { email: A2 })).j.code });
  assert.equal((await a("POST", "/api/me/emails/primary", { email: A2 })).status, 200);
  assert.equal((await a("GET", "/api/me")).j.user.primary_email, A2);
  assert.equal((await a("GET", "/api/me")).j.user.email, A, "열쇠는 그대로");
  assert.deepEqual((await UE.primaryOf(s.env.DB, [A, B])).get(A), A2);
  assert.equal((await a("POST", "/api/me/emails/primary", { email: B })).status, 404, "남의 메일은 대표로 못 함");
  assert.equal((await a("DELETE", "/api/me/emails/" + encodeURIComponent(A))).j.error, "처음 가입한 메일은 뗄 수 없어요");
  assert.equal((await a("DELETE", "/api/me/emails/" + encodeURIComponent(A2))).status, 200);
  assert.equal((await a("GET", "/api/me")).j.user.primary_email, A, "대표를 떼면 열쇠 메일로");
  // 주인: 넷(여기선 둘) 잠긴 줄 + 대표 바꾸기 없음 · 새 메일은 첫 주인 user 에
  const o = (await UE.listEmails(s.env, OWNER2))!;
  assert.deepEqual(o.emails.map(e => [e.email, e.locked, e.primary]), [[OWNER, true, true], [OWNER2, true, false]]);
  assert.equal(((await UE.setPrimary(s.env, OWNER, OWNER2)) as any).status, 403);
  assert.equal(((await UE.removeEmail(s.env, OWNER, OWNER2)) as any).status, 403);
  await UE.startAdd(s.env, OWNER2, "owner-new@example.com", async () => true);
  assert.equal(((await UE.verifyAdd(s.env, OWNER2, "owner-new@example.com", (await UE.testCode(s.env, "owner-new@example.com"))!)) as any).ok, true);
  assert.equal((s.db.prepare("SELECT user_id FROM user_email WHERE email = 'owner-new@example.com'").get() as any).user_id, "u_owner");
  assert.equal(await member(s.env, "owner-new@example.com"), true);
  assert.equal(await UE.keyEmail(s.env.DB, "owner-new@example.com"), OWNER);
});

test("보더 초대: 붙은 메일을 넣어도 열쇠 메일로(한 사람 한 줄)", async () => {
  const s = setup(), a = s.as(await s.login(A));
  await a("POST", "/api/me/emails", { email: A2 });
  await a("POST", "/api/me/emails/verify", { email: A2, code: (await s.adminCall("/api/admin/test-email-code", { email: A2 })).j.code });
  const inv = await s.adminCall("/api/admin/invites", { email: A2 });
  assert.equal(inv.j.email, A, "보더 초대도 열쇠 메일로");
  assert.equal((s.db.prepare("SELECT count(*) n FROM invite WHERE email = ?").get(A2) as any).n, 0);
});

test("시험 세션(관리 토큰): 주인 · 진짜 회원 계정에 붙은 시험 메일은 거절(그 계정 세션이 안 나옴) · 지우기도 거절", async () => {
  const s = setup(), now = new Date().toISOString();
  // 주인 계정에 시험 메일을 붙임
  await UE.startAdd(s.env, OWNER, "own-x@example.com", async () => true);
  assert.equal(((await UE.verifyAdd(s.env, OWNER, "own-x@example.com", (await UE.testCode(s.env, "own-x@example.com"))!)) as any).ok, true);
  // 진짜 회원(시험 주소가 아닌 열쇠)에 시험 메일을 붙임
  s.db.prepare(`INSERT INTO "user"(id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u_real', 'real', 'real@corp.test', 1, ?, ?)`).run(now, now);
  s.db.prepare("INSERT INTO invite(email, by_email, at) VALUES ('real@corp.test', ?, ?)").run(OWNER, Date.now());
  await UE.startAdd(s.env, "real@corp.test", "rx@example.com", async () => true);
  assert.equal(((await UE.verifyAdd(s.env, "real@corp.test", "rx@example.com", (await UE.testCode(s.env, "rx@example.com"))!)) as any).ok, true);
  for (const e of ["own-x@example.com", "rx@example.com"]) {
    const r = await s.adminCall("/api/admin/test-session", { email: e });
    assert.equal(r.status, 400, e); assert.equal(r.j.cookies, undefined, e);
    assert.equal((await s.adminCall("/api/admin/test-session", { email: e, revoke: true })).status, 400, e + " 지우기");
  }
  assert.equal((s.db.prepare('SELECT count(*) n FROM session WHERE "userId" IN (\'u_owner\', \'u_real\')').get() as any).n, 0, "주인 · 진짜 회원 세션 안 생김");
  assert.deepEqual(users(s.db), [A, B, OWNER2, OWNER, "real@corp.test"].sort(), "빈 user 줄도 안 생김");
});
