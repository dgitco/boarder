// node --test --no-warnings --experimental-transform-types apps/web/worker/slack-connector.test.ts (Node 22.18+ · node:sqlite · apps/web 의존성 설치된 채)
// Slack 들여오기를 커넥터로(slack-connector.ts, 온보딩 5층): 진짜 index.ts + 메모리 SQLite, Slack API 는 가짜(fetch 갈음). 글 · 열쇠 · 메일은 다 지어낸 것.
//   가리기(주민번호 · 카드 · 계좌 · 비밀값 · 급여 글과 그 스레드의 금액) · 봇이 든 채널만 · 그 회원의 Slack 봇 열쇠 연결만 · 다시 돌려도 겹침 없음 ·
//   열쇠는 답에 없음 · 기기 토큰 없으면 401
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
const store = await import("./connectors/store.ts");
const { mask } = await import("./slack-connector.ts");
const OWNER = "owner@example.test", A = "member@example.test", B = "other@example.test";
const DEVA = "bxd_made-up-device-one-0123456789abcdef", DEVB = "bxd_made-up-device-two-0123456789abcdef";
const BOT = "xoxb-made-up-0000-not-a-real-bot-token";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

// 가짜 Slack: 봇은 C1(일반) 에만 듦, C2 는 안 듦
const calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.origin !== "https://slack.com") return realFetch(input, init);
  calls.push(u.pathname + " " + (init?.headers?.authorization === `Bearer ${BOT}` ? "auth" : "noauth"));
  const ok = (o: any) => new Response(JSON.stringify({ ok: true, ...o }), { headers: { "content-type": "application/json" } });
  const m = u.pathname.replace("/api/", "");
  if (m === "users.conversations") return ok({ channels: [{ id: "C1AAAAAA", name: "general", is_private: false, topic: { value: "모두" } }] });
  if (m === "conversations.info") return ok({ channel: { id: u.searchParams.get("channel"), name: "general", is_member: u.searchParams.get("channel") === "C1AAAAAA" } });
  if (m === "auth.test") return ok({ team: "예시팀" });
  if (m === "conversations.history") return ok({ messages: [
    { ts: "1790000000.000100", user: "U1AAAAAA", text: "이번 달 급여 3,200,000원 확인 부탁" , reply_count: 1 },
    { ts: "1790000001.000100", user: "U2BBBBBB", text: "주민번호 900101-1234567 계좌 110-123-456789 카드 4111-1111-1111-1111 전화 010-1234-5678 날짜 2026-11-02 토큰 xoxp-1234567890-abcdefghij" },
    { ts: "1790000002.000100", subtype: "channel_join", user: "U3", text: "joined" },
  ], response_metadata: { next_cursor: "" } });
  if (m === "conversations.replies") return ok({ messages: [{ ts: "1790000000.000100", text: "root" }, { ts: "1790000000.000200", user: "U2BBBBBB", text: "네 450만원 맞아요" }] });
  if (m === "users.info") return ok({ user: { profile: { display_name: u.searchParams.get("user") === "U1AAAAAA" ? "가나" : "다라" } } });
  return new Response(JSON.stringify({ ok: false, error: "unknown_method" }));
}) as typeof fetch;

async function setup() {
  const { db, D1 } = d1(), T = Date.now();
  for (const m of [A, B]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)");
  dev.run("devA", A, "mbp", "", await sha(DEVA), T, T, "full"); dev.run("devB", B, "other", "", await sha(DEVB), T, T, "full");
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: "s", ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test", CONNECTOR_KEY: Buffer.alloc(32, 3).toString("base64") };
  await store.upsert(env, A, { service: "slack-team", label: "", kind: "api", url: "https://slack.com/api", auth: { api: { baseUrl: "https://slack.com/api", auth: { type: "bearer" } }, key: BOT } });
  await store.upsert(env, A, { service: "gh", label: "", kind: "api", url: "https://api.github.com", auth: { api: { baseUrl: "https://api.github.com", auth: { type: "bearer" } }, key: "ghp_made_up_000000000000000000000000" } });
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (body: unknown, t?: string) => {
    const r = await app.fetch(new Request("https://example.test/api/me/import/slack/connector", { method: "POST", headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  return { db, call };
}

test("가리기: 주민번호 · 카드 · 계좌 · 비밀값, 전화 · 날짜는 그대로, 급여 글과 그 스레드의 금액", () => {
  const t = mask("900101-1234567 / 4111-1111-1111-1111 / 110-123-456789 / 010-1234-5678 / 2026-11-02 / xoxb-1234567890-abc");
  assert.equal(t, "[주민번호] / [카드] / [계좌] / 010-1234-5678 / 2026-11-02 / [가림]");
  assert.equal(mask("연봉 5,000만원 · 상여 1,200,000"), "연봉 [금액] · 상여 [금액]");
  assert.equal(mask("회의는 3,000명 규모"), "회의는 3,000명 규모", "급여 낱말 없으면 숫자 그대로");
  assert.equal(mask("네 450만원", { payThread: true }), "네 [금액]");
  assert.equal(mask("연봉 5,000만원", { pay: false }), "연봉 5,000만원");
  assert.equal(mask("900101-1234567", { ids: false }), "900101-1234567");
});

test("채널 목록: 봇이 든 채널만 · 기기 토큰 없으면 401 · 남의 연결 · Slack 아닌 연결은 400", async () => {
  const s = await setup();
  const r = await s.call({ connector: "slack-team" }, DEVA);
  assert.equal(r.status, 200, r.text); assert.deepEqual(r.j.channels.map((c: any) => c.id), ["C1AAAAAA"]);
  assert.ok(calls.every(c => c.endsWith(" auth")), "봇 열쇠로 부름");
  assert.equal((await s.call({ connector: "slack-team" })).status, 401);
  assert.equal((await s.call({ connector: "slack-team" }, DEVB)).status, 400, "다른 회원 기기로는 그 연결을 못 씀");
  assert.equal((await s.call({ connector: "gh" }, DEVA)).status, 400);
  assert.ok(!r.text.includes(BOT));
});

test("채널 들여오기: 스레드째 · 가린 채로 · 들어옴 알림 빼고 · 다시 돌려도 겹침 없음 · 봇이 안 든 채널은 403", async () => {
  const s = await setup();
  const r = await s.call({ connector: "slack-team", channel: "C1AAAAAA" }, DEVA);
  assert.equal(r.status, 200, r.text); assert.equal(r.j.inserted, 3); assert.equal(r.j.name, "Slack · #general"); assert.equal(r.j.next_cursor, null);
  const rows = s.db.prepare("SELECT ts, thread_ts, user_name, text FROM slack_msg WHERE owner = ? ORDER BY ts").all(A) as any[];
  assert.deepEqual(rows.map(x => x.ts), ["1790000000.000100", "1790000000.000200", "1790000001.000100"]);
  assert.equal(rows[0].text, "이번 달 급여 [금액] 확인 부탁"); assert.equal(rows[0].user_name, "가나");
  assert.equal(rows[1].thread_ts, "1790000000.000100"); assert.equal(rows[1].text, "네 [금액] 맞아요", "급여 스레드 답글의 금액도");
  assert.equal(rows[2].text, "주민번호 [주민번호] 계좌 [계좌] 카드 [카드] 전화 010-1234-5678 날짜 2026-11-02 토큰 [가림]");
  assert.ok(!r.text.includes(BOT));
  assert.equal((await s.call({ connector: "slack-team", channel: "C1AAAAAA" }, DEVA)).j.inserted, 0, "겹침 없음");
  assert.equal((await s.call({ connector: "slack-team", channel: "C2BBBBBB" }, DEVA)).status, 403);
  assert.equal((s.db.prepare("SELECT count(*) AS n FROM slack_chan WHERE owner = ?").get(B) as any).n, 0);
});
