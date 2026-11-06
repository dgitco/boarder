import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
(globalThis as any).HTMLRewriter ??= class { on() { return this; } transform(r: Response) { return r; } };
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
const OWNER = "owner@example.test", A = "alice@example.com", B = "bob@example.com", ADMIN = "admin-token-made-up-0123456789", SECRET = "made-up-better-auth-secret-0123456789abcdef";
const BASE = "https://example.test", DEV = "bxd_made-up-device-alice-0123456789abcdef";
const ctx = { waitUntil(p: Promise<unknown>) { p?.catch?.(() => {}); }, passThroughOnException() {} } as any;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const b64u = (b: Buffer) => b.toString("base64url");
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

function setup() {
  const t = d1(), sent: { to: string; subject: string }[] = [];
  const env: any = {
    DB: t.D1, BETTER_AUTH_SECRET: SECRET, PUBLIC_URL: BASE, ALLOW_EMAILS: OWNER, ADMIN_TOKEN: ADMIN,
    EMAIL: { send: async (m: { to: string; subject: string }) => { sent.push(m); } },
    ASSETS: { fetch: async () => new Response("<!doctype html><html><head></head><body>SIGNIN</body></html>", { headers: { "content-type": "text/html" } }) },
    SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) },
  };
  const now = new Date().toISOString();
  for (const [id, e] of [["u_a", A], ["u_b", B], ["u_o", OWNER]]) t.db.prepare(`INSERT INTO "user"(id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`).run(id, e.split("@")[0], e, now, now);
  for (const e of [A, B]) t.db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?, ?, ?)").run(e, OWNER, Date.now());
  const T = Date.now();
  t.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)").run("devA", A, "alice-mac", "", sha(DEV), T, T, "full");
  const browser = (ip: string, cookie = "") => {
    const b = { cookie, ip, call: async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
      const form = body instanceof URLSearchParams;
      const r = await app.fetch(new Request(BASE + path, { method, redirect: "manual", headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json", origin: BASE, "cf-connecting-ip": ip, ...(b.cookie ? { cookie: b.cookie } : {}), ...h }, body: body === undefined ? undefined : form ? body.toString() : JSON.stringify(body) }), env, ctx);
      const set = r.headers.getSetCookie().map(c => c.split(";")[0]).filter(c => !/=$/.test(c));
      if (set.length) b.cookie = [...b.cookie.split("; ").filter(Boolean).filter(c => !set.some(n => n.split("=")[0] === c.split("=")[0])), ...set].join("; ");
      const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
      return { status: r.status, j, text, location: r.headers.get("location") || "" };
    } };
    return b;
  };
  const login = async (email: string, ip: string) => {
    const r = await app.fetch(new Request(BASE + "/api/admin/test-session", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + ADMIN }, body: JSON.stringify({ email }) }), env, ctx);
    const j = await r.json() as any; assert.equal(r.status, 200, JSON.stringify(j));
    return browser(ip, (j.cookies as { name: string; value: string }[]).map(c => `${c.name}=${c.value}`).join("; "));
  };
  return { ...t, env, sent, browser, login };
}
const HB = { "x-hb": "1", "sec-fetch-site": "same-origin" };

// ── 커넥터 연결 링크(/c/) ───────────────────────────────────────────
test("커넥터 연결 링크: 다른 프로필(로그인 없음) → 그 자리 로그인 화면 → 로그인 뒤 같은 링크가 확인 화면 · 다른 계정은 어느 계정 링크인지 + 바꾸기", async () => {
  const s = setup();
  const mk = await (s.browser("10.0.0.1")).call("POST", "/api/device/connect-link", { service: "linear" }, { authorization: `Bearer ${DEV}` });
  assert.equal(mk.status, 200, mk.text);
  const path = new URL(mk.j.url).pathname;
  // 다른 프로필: 보더 로그인 없음 → 예전엔 「로그인한 브라우저에서 다시 열어요」(401, 막다른 길). 이제 로그인 화면(SPA)이 이 주소에 뜸
  const anon = s.browser("10.0.0.2");
  const r1 = await anon.call("GET", path); assert.equal(r1.status, 200); assert.match(r1.text, /SIGNIN/);
  // 그 프로필에서 로그인(코드) → 같은 주소를 다시 엶(App SignIn onDone = reload) → 확인 화면, 어느 계정에 붙는지 보임
  assert.equal((await anon.call("POST", "/api/auth/email-otp/send-verification-otp", { email: A, type: "sign-in" })).status, 200);
  const otp = s.sent.at(-1)!.subject.match(/(\d{6})$/)![1];
  assert.equal((await anon.call("POST", "/api/auth/sign-in/email-otp", { email: A, otp })).status, 200);
  const r2 = await anon.call("GET", path); assert.equal(r2.status, 200); assert.match(r2.text, /alice-mac/); assert.match(r2.text, new RegExp(`보더 계정 <b>${A}`));
  // 다른 계정(B) 으로 로그인된 프로필: 어느 계정 링크인지(가림) + 다른 계정으로 로그인 — 소비 안 됨
  const other = await s.login(B, "10.0.0.3");
  const r3 = await other.call("GET", path); assert.equal(r3.status, 403); assert.match(r3.text, /a\*+@example\.com/); assert.match(r3.text, /다른 계정으로 로그인/); assert.doesNotMatch(r3.text, /alice@/);
  assert.equal((await other.call("POST", "/api/connect-link/consume", { token: path.slice(3) }, HB)).status, 410, "남의 링크는 못 씀");
  assert.equal(s.db.prepare("SELECT used_at FROM connect_link").get()!.used_at, null);
});

// ── 커넥터 OAuth 돌아오기 ──────────────────────────────────────────
const pending = (s: ReturnType<typeof setup>, state: string, owner = A, mins = 10) =>
  s.db.prepare("INSERT INTO connection_pending(state, owner, service, label, url, auth, back, bind, expires_at) VALUES (?,?,?,?,?,?,?,?,?)").run(state, owner, "linear", "work", "https://mcp.linear.app/mcp", "x", "#settings/connectors", "", Date.now() + mins * 60_000);

test("커넥터 돌아오기: 시작한 사람으로 로그인된 브라우저에서만 끝 · 로그인 없는 휴대폰은 그 자리 로그인 뒤 이어서 · 다른 계정은 안 붙고 안내 · 그 사이 줄은 안 닳음", async () => {
  const s = setup();
  // 같은 브라우저(시작한 A 로그인): 예전처럼 바로 설정 화면으로(여기선 공급자 오류 길로 끝을 봄)
  pending(s, "st-same-browser-0001");
  const a = await s.login(A, "10.0.0.1");
  const r0 = await a.call("GET", "/api/connectors/callback?state=st-same-browser-0001&error=access_denied");
  assert.equal(r0.status, 302); assert.match(r0.location, /settings\/connectors\?error=/);
  assert.equal(s.db.prepare("SELECT count(*) n FROM connection_pending").get()!.n, 0);
  // 휴대폰(보더 로그인 없음): /api 밖 /connect/finish 로 옮겨 그 자리 로그인 화면 — 줄은 그대로
  pending(s, "st-phone-0002", A, 8);
  const p = s.browser("100.64.0.9");
  const r1 = await p.call("GET", "/api/connectors/callback?state=st-phone-0002&error=access_denied&error_description=t", undefined, { "user-agent": PHONE });
  assert.equal(r1.status, 302); assert.equal(r1.location, "/connect/finish?state=st-phone-0002&error=access_denied&error_description=t");
  const r2 = await p.call("GET", r1.location); assert.equal(r2.status, 200); assert.match(r2.text, /SIGNIN/);
  assert.equal(s.db.prepare("SELECT count(*) n FROM connection_pending WHERE state = 'st-phone-0002'").get()!.n, 1, "로그인 전엔 안 닳음");
  // 다른 계정(B)이 그 휴대폰에서 로그인: 붙지 않음 — 어느 계정 연결인지(가림) + 다른 계정으로 로그인, 줄은 그대로(남의 링크로 내 계정이 남의 보더에 안 붙음)
  const pb = await s.login(B, "100.64.0.9");
  const r3 = await pb.call("GET", r1.location); assert.equal(r3.status, 403); assert.match(r3.text, /a\*+@example\.com/); assert.match(r3.text, /다른 계정으로 로그인/); assert.match(r3.text, /Linear 연결 링크/);
  const r3b = await pb.call("GET", "/api/connectors/callback?state=st-phone-0002&code=x"); assert.equal(r3b.status, 403, "돌아오기 주소로 바로 와도 같음");
  assert.equal(s.db.prepare("SELECT count(*) n FROM connection_pending WHERE state = 'st-phone-0002'").get()!.n, 1);
  // 시작한 A 로 그 휴대폰에서 로그인 → 같은 주소 → 그때 끝(한 번만)
  const pa = await s.login(A, "100.64.0.9");
  const r4 = await pa.call("GET", r1.location); assert.equal(r4.status, 302); assert.match(r4.location, /settings\/connectors\?error=.*access_denied|settings\/connectors\?error=/);
  assert.equal(s.db.prepare("SELECT count(*) n FROM connection_pending WHERE state = 'st-phone-0002'").get()!.n, 0, "한 번만");
  // 시간 지난 줄: 로그인 화면으로 보내지 않고 바로 「시간이 지났어요」
  pending(s, "st-expired-0004", A, -1);
  const r5 = await p.call("GET", "/api/connectors/callback?state=st-expired-0004&code=x");
  assert.equal(r5.status, 400); assert.match(r5.text, /시간이 지났어요/);
});

// ── 기기 페어링(boarder setup 로컬 콜백 길) ──────────────────────────
async function localCode(s: ReturnType<typeof setup>) {
  const verifier = b64u(randomBytes(32)), challenge = b64u(createHash("sha256").update(verifier).digest()), state = b64u(randomBytes(24));
  const term = s.browser("10.0.0.1");
  const r = await term.call("POST", "/api/device/code", { name: "alice-linux", callback: "http://127.0.0.1:45123/callback", state, code_challenge: challenge });
  assert.equal(r.status, 200, r.text); assert.equal(r.j.mode, "local");
  return { term, verifier, state, dc: r.j.device_code as string, uc: r.j.user_code as string };
}

test("기기 페어링: 같은 컴퓨터는 127.0.0.1 로 · 휴대폰 · 다른 컴퓨터는 확인 코드를 터미널에 넣어 끝 · 틀린 코드 5번 · verifier 없으면 못 받음", async () => {
  const s = setup();
  // 같은 컴퓨터 · 다른 프로필(같은 기기의 127.0.0.1 로 넘김) — 예전과 같음
  { const c = await localCode(s), a = await s.login(A, "10.0.0.1");
    const ok = await a.call("POST", "/api/device/approve", { user_code: c.uc, allow: true }, HB);
    assert.equal(ok.status, 200); assert.match(ok.j.redirect, /^http:\/\/127\.0\.0\.1:45123\/callback\?state=.+&code=/); assert.match(ok.j.confirm, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const grant = new URL(ok.j.redirect).searchParams.get("code")!;
    const t = await c.term.call("POST", "/api/device/token", { device_code: c.dc, code: grant, code_verifier: c.verifier });
    assert.equal(t.j.state, "approved"); assert.equal(t.j.email, A); }
  // 휴대폰에서 허용: 127.0.0.1 로 못 감(그 폰엔 터미널 없음) → 예전엔 터미널이 만료까지 기다림. 이제 화면의 확인 코드를 터미널에 넣음
  { const c = await localCode(s), phone = await s.login(A, "100.64.0.9");
    const look = await phone.call("GET", `/api/device/lookup?code=${c.uc}`, undefined, { "user-agent": PHONE });
    assert.equal(look.j.name, "alice-linux"); assert.equal(look.j.same, false, "다른 곳에서 온 요청이라고 보임");
    const before = await c.term.call("POST", "/api/device/token", { device_code: c.dc });
    assert.equal(before.j.state, "pending", "허용 전");
    const ok = await phone.call("POST", "/api/device/approve", { user_code: c.uc, allow: true }, HB);
    assert.equal(ok.status, 200); const cf = ok.j.confirm as string;
    // 그냥 폴링(코드 없이)은 안 됨 — 남이 보낸 링크를 누른 사람의 기기 토큰을 링크 만든 쪽이 못 가져감(로컬 길의 뜻 그대로)
    assert.equal((await c.term.call("POST", "/api/device/token", { device_code: c.dc, code_verifier: c.verifier })).j.state, "pending");
    const bad = await c.term.call("POST", "/api/device/token", { device_code: c.dc, confirm: "AAAA-AAAA", code_verifier: c.verifier });
    assert.equal(bad.status, 400); assert.equal(bad.j.error, "confirm"); assert.equal(bad.j.left, 4);
    assert.equal((await c.term.call("POST", "/api/device/token", { device_code: c.dc, confirm: cf, code_verifier: "wrong-verifier" })).j.error, "verifier", "verifier 없으면 못 받음");
    const t = await c.term.call("POST", "/api/device/token", { device_code: c.dc, confirm: cf.toLowerCase(), code_verifier: c.verifier });
    assert.equal(t.j.state, "approved", t.text); assert.equal(t.j.email, A); assert.match(t.j.token, /^bxd_/);
    assert.equal((await c.term.call("POST", "/api/device/token", { device_code: c.dc, confirm: cf, code_verifier: c.verifier })).j.error, "used", "한 번만"); }
  // 틀린 코드 5번이면 확인 코드 길은 막힘(맞는 코드도) — 127.0.0.1 길은 그대로
  { const c = await localCode(s), a = await s.login(A, "100.64.0.9");
    const ok = await a.call("POST", "/api/device/approve", { user_code: c.uc, allow: true }, HB);
    for (let i = 0; i < 5; i++) await c.term.call("POST", "/api/device/token", { device_code: c.dc, confirm: "ZZZZ-ZZZZ", code_verifier: c.verifier });
    const t = await c.term.call("POST", "/api/device/token", { device_code: c.dc, confirm: ok.j.confirm, code_verifier: c.verifier });
    assert.equal(t.j.error, "confirm"); assert.equal(t.j.left, 0);
    const g = await c.term.call("POST", "/api/device/token", { device_code: c.dc, code: new URL(ok.j.redirect).searchParams.get("code"), code_verifier: c.verifier });
    assert.equal(g.j.state, "approved", "127.0.0.1 길은 그대로"); }
  { const c = await localCode(s), a = await s.login(A, "100.64.0.9");
    const ok = await a.call("POST", "/api/device/approve", { user_code: c.uc, allow: true }, HB);
    const rs = await Promise.all(Array.from({ length: 20 }, () => c.term.call("POST", "/api/device/token", { device_code: c.dc, confirm: "YYYY-YYYY", code_verifier: c.verifier })));
    assert.equal(rs.filter(r => r.j.left > 0).length, 4, "남은 횟수가 있는 답은 4개뿐");
    assert.equal(s.db.prepare("SELECT confirm_tries n FROM device_code WHERE user_code = ?").get(c.uc)!.n, 5);
    assert.equal((await c.term.call("POST", "/api/device/token", { device_code: c.dc, confirm: ok.j.confirm, code_verifier: c.verifier })).j.left, 0); }
  // 요청 10분이 지나면 확인 코드도 안 맞음
  { const c = await localCode(s), a = await s.login(A, "100.64.0.9");
    const ok = await a.call("POST", "/api/device/approve", { user_code: c.uc, allow: true }, HB);
    s.db.prepare("UPDATE device_code SET expires_at = ? WHERE user_code = ?").run(Date.now() - 1000, c.uc);
    assert.equal((await c.term.call("POST", "/api/device/token", { device_code: c.dc, confirm: ok.j.confirm, code_verifier: c.verifier })).j.error, "expired"); }
  // 거절은 확인 코드 없음
  { const c = await localCode(s), a = await s.login(A, "100.64.0.9");
    const no = await a.call("POST", "/api/device/approve", { user_code: c.uc, allow: false }, HB);
    assert.equal(no.j.confirm, undefined); assert.match(no.j.redirect, /error=denied/);
    assert.equal((await c.term.call("POST", "/api/device/token", { device_code: c.dc, confirm: "ABCD-EFGH", code_verifier: c.verifier })).status, 403); }
});

test("기기 페어링 코드 길(SSH): 다른 기기 · 다른 프로필에서 허용해도 폴링으로 받음(예전과 같음)", async () => {
  const s = setup(), term = s.browser("10.0.0.1");
  const r = await term.call("POST", "/api/device/code", { name: "alice-ssh" });
  assert.equal(r.j.mode, "code");
  const phone = await s.login(A, "100.64.0.9");
  assert.equal((await phone.call("POST", "/api/device/approve", { user_code: r.j.user_code, allow: true }, HB)).j.confirm, undefined, "코드 길은 확인 코드 필요 없음");
  const t = await term.call("POST", "/api/device/token", { device_code: r.j.device_code });
  assert.equal(t.j.state, "approved"); assert.equal(t.j.email, A);
});

// ── 이메일 로그인 코드 ─────────────────────────────────────────────
test("이메일 로그인 코드: 보낸 브라우저와 다른 프로필 · 휴대폰에서 넣어도 로그인됨(쿠키 · state 에 안 묶임)", async () => {
  const s = setup();
  const pc = s.browser("10.0.0.1");
  assert.equal((await pc.call("POST", "/api/auth/email-otp/send-verification-otp", { email: A, type: "sign-in" })).status, 200);
  const otp = s.sent.at(-1)!.subject.match(/(\d{6})$/)![1];
  // 다른 프로필(쿠키 없음) · 다른 IP(휴대폰)에서 코드 넣기
  const phone = s.browser("100.64.0.9");
  const r = await phone.call("POST", "/api/auth/sign-in/email-otp", { email: A, otp }, { "user-agent": PHONE });
  assert.equal(r.status, 200, r.text); assert.match(phone.cookie, /better-auth\.session_token=/);
  const me = await phone.call("GET", "/api/auth/get-session"); assert.equal(me.j?.user?.email, A);
  // 같은 코드는 한 번만
  assert.notEqual((await pc.call("POST", "/api/auth/sign-in/email-otp", { email: A, otp })).status, 200);
});
