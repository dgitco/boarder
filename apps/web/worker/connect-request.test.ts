// node --test --no-warnings --experimental-transform-types apps/web/worker/connect-request.test.ts (Node 22.18+ · node:sqlite · apps/web 의존성 설치된 채)
// 기기에서 커넥터 넣기(connect-request.ts, 온보딩 3층): 진짜 index.ts(app.fetch) + 메모리 SQLite(migrations 전부). 키 · 토큰 · 메일은 다 지어낸 것.
//   권한 경계: 카드 허용 없이는 연결이 안 생김 · 카드는 그 회원 세션만(남의 회원 · 토큰 머리 X) · 키는 답 · 카드 글 · D1 어디에도 평문 없음 ·
//   상태는 낸 기기만 · 감시 기기 · 주인 기기 X · 로그인(OAuth) 꼴은 거절 · 10분 지나면 허용해도 안 넣음
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

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
const KEY = "xoxb-made-up-0000-not-a-real-bot-token";
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
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test", CONNECTOR_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64") };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const texts: string[] = [];
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); texts.push(text); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  const human = async (email = MEMBER) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  const dev_ = (t: string) => ({ authorization: `Bearer ${t}` });
  const ask = (b: Record<string, unknown> = {}, t = DEV1) => call("POST", "/api/device/connect", { service: "slack-team", api: { base_url: "https://slack.com/api", auth: { type: "bearer" } }, key: KEY, ...b }, dev_(t));
  const conns = () => db.prepare("SELECT service, label, kind, url, read_only, auth FROM connection").all() as any[];
  const dump = () => JSON.stringify(["connect_request", "board_card", "connection", "board_log"].map(t => db.prepare(`SELECT * FROM ${t}`).all())) + texts.join("\n");
  return { db, call, human, dev: dev_, ask, conns, dump };
}

test("기기가 낸 열쇠: 카드만 서고 연결은 없음 — 허용하면 읽기 전용 연결 · payload 지움 · 키는 어디에도 평문 없음", async () => {
  const s = await setup();
  const r = await s.ask();
  assert.equal(r.status, 200, r.text); assert.equal(r.j.state, "pending"); assert.equal(r.j.name, "slack-team");
  const card = s.db.prepare("SELECT owner, question, choices, body FROM board_card WHERE id = ?").get(r.j.card_id) as any;
  assert.equal(card.owner, MEMBER); assert.match(card.question, /기기 「laptop」 이 「slack-team」 연결/); assert.deepEqual(JSON.parse(card.choices), ["허용", "거절"]);
  assert.match(card.body, /slack\.com · 읽기 전용/);
  assert.equal(s.conns().length, 0, "허용 전에는 연결 없음");
  assert.ok((s.db.prepare("SELECT payload FROM connect_request").get() as any).payload, "봉한 payload");
  assert.ok(!s.dump().includes(KEY), "키 평문 없음(허용 전)");
  assert.equal((await s.call("GET", `/api/device/connect/${r.j.id}`, undefined, s.dev(DEV1))).j.state, "pending");
  assert.equal((await s.call("POST", `/api/me/cards/${r.j.card_id}/answer`, { choice: "허용" }, await s.human())).status, 200);
  const c = s.conns(); assert.equal(c.length, 1);
  assert.deepEqual([c[0].service, c[0].kind, c[0].url, c[0].read_only], ["slack-team", "api", "https://slack.com/api", 1]);
  const q = s.db.prepare("SELECT state, payload, conn_id FROM connect_request").get() as any;
  assert.equal(q.state, "approved"); assert.equal(q.payload, null); assert.ok(q.conn_id);
  const st = await s.call("GET", `/api/device/connect/${r.j.id}`, undefined, s.dev(DEV1));
  assert.equal(st.j.state, "approved");
  assert.equal((await s.call("GET", `/api/device/connect/${r.j.id}`, undefined, s.dev(DEV2))).status, 404, "다른 기기는 상태도 못 봄");
  assert.ok(!s.dump().includes(KEY), "키 평문 없음(허용 뒤)");
});

test("--write(read_only false) 면 쓰기도 · 거절이면 연결 없음 · payload 지움", async () => {
  const s = await setup();
  const w = await s.ask({ read_only: false, service: "gh", api: { base_url: "https://api.github.com", auth: { type: "bearer" } } });
  await s.call("POST", `/api/me/cards/${w.j.card_id}/answer`, { choice: "허용" }, await s.human());
  assert.equal(s.conns()[0].read_only, 0);
  const d = await s.ask();
  await s.call("POST", `/api/me/cards/${d.j.card_id}/answer`, { choice: "거절" }, await s.human());
  assert.equal(s.conns().length, 1);
  assert.deepEqual({ ...(s.db.prepare("SELECT state, payload FROM connect_request WHERE id = ?").get(d.j.id) as any) }, { state: "denied", payload: null });
  assert.equal((await s.call("GET", `/api/device/connect/${d.j.id}`, undefined, s.dev(DEV1))).j.state, "denied");
});

test("카드 경계: 남의 회원 404 · 토큰 머리 401 · 10분 지나 허용해도 안 넣음", async () => {
  const s = await setup();
  const r = await s.ask();
  assert.equal((await s.call("POST", `/api/me/cards/${r.j.card_id}/answer`, { choice: "허용" }, await s.human(OTHER))).status, 404);
  for (const h of [s.dev(DEV1), { "x-boarder-device": DEV1 }]) assert.equal((await s.call("POST", `/api/me/cards/${r.j.card_id}/answer`, { choice: "허용" }, { ...(await s.human()), ...h })).status, 401);
  assert.equal(s.conns().length, 0);
  s.db.prepare("UPDATE connect_request SET created_at = ?").run(Date.now() - 11 * 60_000);
  await s.call("POST", `/api/me/cards/${r.j.card_id}/answer`, { choice: "허용" }, await s.human());
  assert.equal(s.conns().length, 0, "만료 뒤 허용은 안 넣음");
  assert.equal((s.db.prepare("SELECT payload FROM connect_request").get() as any).payload, null);
});

test("기기 경계 · 꼴: 감시 기기 · 주인 기기 · 토큰 없음 401, 로그인(OAuth) 꼴 · 내부 주소 · 빈 키는 400(키는 오류에도 없음)", async () => {
  const s = await setup();
  for (const t of [DEVMW, DEVW]) assert.equal((await s.ask({}, t)).status, 401);
  assert.equal((await s.call("POST", "/api/device/connect", { service: "x", key: KEY })).status, 401);
  const o = await s.ask({ service: "slack", api: { preset: "slack" } });
  assert.equal(o.status, 400); assert.match(o.j.error, /로그인\(브라우저\)/);
  assert.equal((await s.ask({ api: { base_url: "https://127.0.0.1/api", auth: { type: "bearer" } } })).status, 400);
  assert.equal((await s.ask({ key: "" })).status, 400);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM board_card").get()!.n, 0);
  assert.ok(!s.dump().includes(KEY));
});
