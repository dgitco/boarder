import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const sessions = await import("./connectors/sessions.ts");

// 가짜 R2. beforePut = 다음 put 이 실제로 쓰기 직전에 끼어들 일(다른 요청 · 실패)
function r2() {
  const m = new Map<string, string>(), hook: { beforePut: null | ((k: string) => Promise<unknown>) } = { beforePut: null };
  const bucket = {
    put: async (k: string, v: string) => { const h = hook.beforePut; hook.beforePut = null; if (h) await h(k); m.set(k, String(v)); },
    get: async (k: string) => (m.has(k) ? { json: async () => JSON.parse(m.get(k)!) } : null),
  } as unknown as R2Bucket;
  return { m, hook, bucket };
}
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0009_sessions.sql", import.meta.url), "utf8"));
  db.exec("create table f7_flag (name text primary key, on_at integer, note text)");   // 봉투 스위치(vault envelopeOn)가 읽음 — 0021 마이그레이션이 만듦
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async () => (db.prepare(sql).get(...(args as never[])) as object | undefined) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

const OWNER = "a@example.test", NATIVE = "made-up-session-0001", SID = `claude-code:${NATIVE}`;
// Claude Code 기록 한 줄 = 사람 · 에이전트 글 하나
const line = (i: number) => JSON.stringify({ type: i % 2 ? "assistant" : "user", uuid: `u${i}`, timestamp: 1_790_000_000_000 + i * 1000, cwd: "/work/made-up", message: { role: i % 2 ? "assistant" : "user", content: `글 ${i}` } });
const transcript = (n: number) => Array.from({ length: n }, (_, i) => line(i));

// CLI save 고리(조각 = chunk 줄). 서버 오류(던짐)는 CLI 처럼 그 저장을 멈춤
async function save(env: any, all: string[], chunk: number) {
  let from = (await sessions.offset(env, OWNER, "claude-code", NATIVE)).lines;
  while (from < all.length) {
    const end = Math.min(all.length, from + chunk);
    const r = await sessions.upload(env, OWNER, { tool: "claude-code", native: NATIVE, from, host: "host-a", win: "win-a" }, all.slice(from, end).join("\n") + "\n");
    from = r.body.lines;
  }
}
const texts = async (env: any) => (await sessions.handoff(env, OWNER, SID, 1000)).messages.map(m => m.text);

test("부분 실패: 조각 저장(R2)이 한 번 실패한 뒤 다시 저장해도 그 조각의 글을 잃지 않음", async () => {
  const { hook, bucket } = r2(), env = { RESULTS: bucket, DB: d1() };
  const all = transcript(6);
  await save(env, all.slice(0, 2), 2);                         // 글 0 · 1 저장됨
  hook.beforePut = async () => { throw new Error("R2 잠깐 안 됨(지어낸 실패)"); };
  await assert.rejects(save(env, all.slice(0, 4), 2));           // 글 2 · 3 조각에서 실패 — CLI 는 오류로 멈춤
  await save(env, all, 2);                                        // 다음 저장(다시 시도)
  assert.deepEqual(await texts(env), all.map((_, i) => `글 ${i}`), "실패했던 조각의 글이 빠짐(줄 위치만 앞서 감)");
  const row = await env.DB.prepare("SELECT lines, messages FROM ai_session WHERE owner = ? AND id = ?").bind(OWNER, SID).first();
  assert.deepEqual({ ...row }, { lines: 6, messages: 6 });
});

test("같은 세션 동시 저장: 앞 저장이 조각을 쓰는 사이 다른 저장이 이어 올려도 두 조각 글이 다 남음", async () => {
  const { hook, bucket } = r2(), env = { RESULTS: bucket, DB: d1() };
  const all = transcript(6);
  await save(env, all.slice(0, 2), 2);
  let b: Promise<unknown> | null = null;
  hook.beforePut = async () => { b = save(env, all, 2); await b; };
  await save(env, all.slice(0, 4), 2);
  await b;
  // 두 저장이 다 끝난 바로 그때: 받은 줄 6 · 글 0~5 가 다 있어야 함(다음 저장이 우연히 메꾸기 전)
  assert.deepEqual(await texts(env), all.map((_, i) => `글 ${i}`), "한 저장의 조각이 다른 저장에 덮이거나 빠짐");
  assert.equal((await sessions.offset(env as never, OWNER, "claude-code", NATIVE)).lines, 6, "받은 줄 수가 뒤로 감");
  await save(env, all, 2);                                        // 한 번 더 저장해도 그대로
  const row = await env.DB.prepare("SELECT lines, messages, parts FROM ai_session WHERE owner = ? AND id = ?").bind(OWNER, SID).first();
  assert.deepEqual({ ...row }, { lines: 6, messages: 6, parts: 3 });
});

test("큰 세션: 여러 조각으로 나눠 올려도 한 번에 올린 것과 같은 글 · 같은 수", async () => {
  const one = { RESULTS: r2().bucket, DB: d1() }, many = { RESULTS: r2().bucket, DB: d1() };
  const all = transcript(301);
  await save(one, all, 1000);
  await save(many, all.slice(0, 150), 7);
  await save(many, all, 13);
  assert.deepEqual(await texts(many), await texts(one));
  assert.equal((await texts(many)).length, 301);
});

test("같은 위치로 두 번(앞 응답을 못 받고 다시 보냄): 두 번째는 409, 글이 겹치지 않음", async () => {
  const env = { RESULTS: r2().bucket, DB: d1() };
  const all = transcript(4), body = all.join("\n") + "\n";
  const m = { tool: "claude-code" as const, native: NATIVE, from: 0, host: "h", win: "w" };
  assert.equal((await sessions.upload(env as never, OWNER, m, body)).status, 200);
  const again = await sessions.upload(env as never, OWNER, m, body);
  assert.equal(again.status, 409); assert.equal(again.body.lines, 4);
  assert.equal((await texts(env)).length, 4);
});

test("부분 실패: 첫 조각부터 실패해도 다음 저장이 처음부터 다시 올림", async () => {
  const { hook, bucket } = r2(), env = { RESULTS: bucket, DB: d1() };
  const all = transcript(3);
  hook.beforePut = async () => { throw new Error("R2 잠깐 안 됨(지어낸 실패)"); };
  await assert.rejects(save(env, all, 10));
  assert.equal((await sessions.offset(env as never, OWNER, "claude-code", NATIVE)).lines, 0);
  await save(env, all, 10);
  assert.deepEqual(await texts(env), ["글 0", "글 1", "글 2"]);
});
