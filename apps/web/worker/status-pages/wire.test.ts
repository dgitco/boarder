// node --test --no-warnings --experimental-transform-types apps/web/worker/status-pages/wire.test.ts — 진짜 index.ts: 기기 토큰 범위 · 화면 밀어 주기(bumpMember) 제외 · 보관 지우기 묶음. 메일 · 토큰은 다 지어낸 것
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("../test-hooks.mjs", import.meta.url);
const { default: app } = await import("../index.ts");
const { d1 } = await import("./test-db.mjs");
const OWNER = "owner@example.test", MEMBER = "member@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (t: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
const DEV = (n: string) => "bxd_" + n.repeat(40).slice(0, 40);
async function cookie(email: string) {
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
async function setup(on = true) {
  const { db, D1 } = d1(), pending: Promise<unknown>[] = [], bumps: string[] = [], now = Date.now();
  const SNAP = { idFromName: (s: string) => s, get: (id: string) => ({ bump: async () => { bumps.push(id); return 0; } }) };
  const ASSETS = { fetch: async () => new Response("<!doctype html><html><head></head><body></body></html>", { headers: { "content-type": "text/html" } }) };
  const env = { DB: D1, ASSETS, SNAP, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, now);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)");
  for (const [id, n, scope] of [["devFull", "a", "full"], ["devWatch", "w", "watch"], ["devHarn", "h", "harness"]]) dev.run(id, MEMBER, id, "", await sha(DEV(n)), now, now, scope);
  if (on) for (const k of ["taskboard", "devboard"]) db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(MEMBER, "feat:" + k, "1", now);
  const fire = (req: Request) => app.fetch(req, env as never, { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() {} } as never).then(async (r: Response) => { await Promise.all(pending.splice(0)); return r; });
  const call = (tok: string, method: string, path: string, body?: unknown) => fire(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${DEV(tok)}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const web = async (method: string, path: string, body?: unknown) => fire(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", accept: "application/json", cookie: await cookie(MEMBER), "x-hb": "1", "sec-fetch-site": "same-origin" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { db, D1, env, call, web, bumps };
}
const PUSH = { tasks: [{ id: "R1", title: "일", status: "진행" }] };

test("올리기 · 가져가기 · ack 는 full 기기만 — 감시 · 하네스 토큰은 401, 아무것도 안 남음", async () => {
  const s = await setup();
  for (const tok of ["w", "h"]) {
    assert.equal((await s.call(tok, "POST", "/api/device/taskboard", PUSH)).status, 401, tok + " 올리기");
    assert.equal((await s.call(tok, "GET", "/api/device/taskboard/said")).status, 401, tok + " 가져가기");
    assert.equal((await s.call(tok, "POST", "/api/device/taskboard/said/ack", { keys: [] })).status, 401, tok + " ack");
  }
  assert.equal(s.db.prepare("SELECT 1 x FROM task_board").get(), undefined);
  assert.equal((await s.call("a", "POST", "/api/device/taskboard", PUSH)).status, 200);
  assert.equal((await s.call("a", "GET", "/api/device/taskboard/said")).status, 200);
});
test("켠 회원의 올리기 · ack · 말하기 · 스위치 · 숨기기는 화면 전체 다시 읽기(bumpMember)를 안 부름", async () => {
  const s = await setup();
  assert.equal((await s.call("a", "POST", "/api/device/taskboard", PUSH)).status, 200);
  const say = await (await s.web("POST", "/api/me/taskboard/R1/say", { text: "말" })).json() as { ok: boolean; line: { k: string } }; assert.equal(say.ok, true);
  const got = await (await s.call("a", "GET", "/api/device/taskboard/said")).json() as { said: unknown[] }; assert.equal(got.said.length, 1);
  assert.equal((await s.call("a", "POST", "/api/device/taskboard/said/ack", { keys: [{ task_id: "R1", k: say.line.k }] })).status, 200);
  assert.equal((await s.web("POST", "/api/me/features", { k: "taskboard", on: true })).status, 200);
  assert.equal((await s.web("POST", "/api/me/devboard/hide", { device: "devFull", hide: true })).status, 200);
  assert.deepEqual(s.bumps, []);
  // 대조: 다른 쓰기는 그대로 부름(이 시험이 부름을 잡아낸다는 뜻)
  assert.equal((await s.call("a", "POST", "/api/device/overlay", { slot: "mine", set: { css: "a{color:red}" } })).status, 200);
  assert.ok(s.bumps.length > 0, "다른 쓰기는 그대로 bump");
});
test("스위치 끈 회원: 페이지 API · 기기 올리기 403, bump 없음, 표에 아무것도 안 남음", async () => {
  const s = await setup(false);
  assert.equal((await s.call("a", "POST", "/api/device/taskboard", PUSH)).status, 403);
  assert.equal((await s.call("a", "GET", "/api/device/taskboard/said")).status, 403);
  assert.equal((await s.web("GET", "/api/me/taskboard")).status, 403);
  assert.equal((await s.web("GET", "/api/me/devboard")).status, 403);
  assert.equal(s.db.prepare("SELECT 1 x FROM task_board_use").get(), undefined, "횟수 줄도 안 생김");
  assert.deepEqual(s.bumps, []);
});
test("매일 정기 작업이 태스크 현황 보관 기간을 지움(영업 메일 스위치와 상관없이)", async () => {
  const s = await setup(); const old = Date.now() - 200 * 86_400_000;
  assert.equal((await s.call("a", "POST", "/api/device/taskboard", PUSH)).status, 200); assert.ok(s.db.prepare("SELECT 1 x FROM task_board").get()); s.db.prepare("UPDATE task_board SET at = ?").run(old);
  const pending: Promise<unknown>[] = [];
  await (app as any).scheduled({}, s.env, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } }); await Promise.all(pending);
  assert.equal(s.db.prepare("SELECT 1 x FROM task_board").get(), undefined);
});
