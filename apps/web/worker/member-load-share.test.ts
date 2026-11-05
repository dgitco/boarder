import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { load, loadRead, loadForget, get } = await import("./member-board.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:"); let batches = 0;
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { db, count: () => batches, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { batches++; const out = []; for (const s of ss) out.push(await s.all()); return out; } } as unknown as D1Database };
}
const ME = "share@example.com", CTX = { waitUntil: (_p: Promise<unknown>) => {} };

test("loadRead: 같은 사람의 읽기가 0.4초 안에 몰리면 load 한 번, 쓰기(loadForget) 뒤에는 새로 읽음, 다른 사람은 따로", async () => {
  const { D1, count } = d1();
  const [a, b] = await Promise.all([loadRead(D1, ME, CTX), loadRead(D1, ME, CTX)]);
  assert.equal(count(), 1); assert.equal(a, b);
  await loadRead(D1, ME, CTX); assert.equal(count(), 1);
  loadForget("Share@Example.com"); await loadRead(D1, ME, CTX); assert.equal(count(), 2);   // 버림은 대소문자 상관없이
  await loadRead(D1, "other@example.com", CTX); assert.equal(count(), 3);
  await load(D1, ME); assert.equal(count(), 4);   // load 는 늘 새로(쓰기 길)
  await loadRead(D1, ME); assert.equal(count(), 5);   // ctx 없으면 나눠 쓰지 않음(남의 요청 읽기를 붙잡을 수 없음)   // load 는 늘 새로(쓰기 길)
  loadForget(ME); loadForget("other@example.com");
});

test("loadRead: 0.4초가 지나면 새로 읽음 · 실패한 읽기는 나눠 주지 않음", async () => {
  const { D1, count } = d1(), real = Date.now;
  try {
    let t = real(); Date.now = () => t;
    const kept: Promise<unknown>[] = [], C2 = { waitUntil: (p: Promise<unknown>) => { kept.push(p); } };
    await loadRead(D1, ME, C2); assert.equal(kept.length, 1);   // 먼저 읽은 요청이 waitUntil 로 붙잡음
    t += 401; await loadRead(D1, ME, C2); assert.equal(count(), 2);
    const bad = { ...D1, batch: async () => { throw new Error("D1_ERROR: overloaded"); } } as unknown as D1Database;
    t += 401; await assert.rejects(loadRead(bad, ME, C2)); await Promise.all(kept);
    await loadRead(D1, ME, C2); assert.equal(count(), 3);   // 실패 뒤 바로 다음 요청은 새로 읽음
  } finally { Date.now = real; loadForget(ME); }
});

test("지난 항목: 코드가 보내는 질의가 아직 있음 + 하루 안 사라짐만 — 예전 OR 꼴과 같은 줄, 하루 넘게 사라진 것 · 남의 것은 안 섞임", async () => {
  const { db, D1 } = d1(), now = Date.now();
  const add = (owner: string, key: string, gone: number | null) => db.prepare("INSERT INTO imp_item(owner, key, kind, title, seen_at, gone_at) VALUES (?,?,?,?,?,?)").run(owner, key, "window", key, now, gone);
  add(ME, "live", null); add(ME, "recent", now - 3600_000); add(ME, "old", now - 3 * 86_400_000); add("other@example.com", "theirs", null); add("other@example.com", "theirs2", now - 60_000);
  let seen: { sql: string; args: unknown[] } | null = null;
  const spy = { ...D1, prepare: (sql: string) => { const st = (D1 as any).prepare(sql); if (/FROM imp_item WHERE owner/.test(sql) && /handle END handle FROM imp_item/.test(sql)) return { ...st, bind: (...a: unknown[]) => { seen = { sql, args: a }; return st.bind(...a); } }; return st; } } as unknown as D1Database;
  await load(spy, ME);
  assert.ok(seen, "load 가 지난 항목 질의를 보냄");
  const got = (db.prepare(seen!.sql).all(...(seen!.args as never[])) as { key: string }[]).map(r => r.key).sort();
  const was = (db.prepare("SELECT key FROM imp_item WHERE owner = ? AND (gone_at IS NULL OR gone_at > ?)").all(ME, Number(seen!.args.at(-1))) as { key: string }[]).map(r => r.key).sort();
  assert.deepEqual(got, ["live", "recent"]); assert.deepEqual(got, was);
  const plan = (db.prepare("EXPLAIN QUERY PLAN " + seen!.sql).all(...(seen!.args as never[])) as { detail: string }[]).map(r => r.detail).join(" | ");
  assert.match(plan, /imp_item_owner/); assert.doesNotMatch(plan, /SCAN imp_item(?! USING)/);   // 색인 범위로만(표 통째 훑기 없음)
});

test("/api/topics: Cache API가 없으면 0.4초 안 같은 요청은 load 를 나눠 씀(loadRead)", async () => {
  const { D1, count } = d1(), url = new URL("https://x.test/api/topics"), none = async () => null;
  const call = () => get(D1, ME, { name: "봇" }, url, none, undefined, null, CTX, async () => "~1");
  assert.equal((await call())?.status, 200); const n = count();
  assert.equal((await call())?.status, 200); assert.equal(count(), n);
  loadForget(ME);
});
