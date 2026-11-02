import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

// engine.ts 의 cloudflare:workers 는 Workers 밖에 없음 — 빈 DurableObject 로 갈음(engine-sec.test.ts 와 같음)
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { mountImport } = await import("./routes.ts");
const { IMPORT_WIN } = await import("./proposal.ts");
const { Hono } = await import("hono");

const MIG = new URL("../../migrations/", import.meta.url);
// failOnce: 이 SQL 이 처음 한 번 실패(D1 일시 오류) — 그 묶음은 통째로 안 씀(D1 batch 는 한 트랜잭션)
function d1(failOnce?: RegExp) {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  let armed = !!failOnce;
  const trip = (sql: string) => { if (armed && failOnce!.test(sql)) { armed = false; throw new Error("D1_ERROR: Network connection lost."); } };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => { trip(sql); return { results: db.prepare(sql).all(...(args as never[])) }; },
    first: async () => { trip(sql); return db.prepare(sql).get(...(args as never[])) ?? null; },
    run: async () => { trip(sql); const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const batch = async (ss: any[]) => {
    for (const s of ss) trip(s.sql);
    db.exec("BEGIN");
    try { const out = []; for (const s of ss) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database };
}

const MEMBER = "member@example.com";
function app(D1: D1Database) {
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  mountImport(a, { device: async () => ({ id: "devMember01", owner: MEMBER, name: "member laptop" }), member: async () => null, sameSite: () => true });
  return (body: unknown) => a.request("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { DB: D1, PUBLIC_URL: "https://example.test" });
}
const BODY = {
  host: "laptop", kinds: ["window", "session"],
  items: [
    { key: "window:tmux:1", kind: "window", title: "매출 보고 정리", win: "tmux:1", state: "working", engine: "claude" },
    { key: "session:claude:aaa", kind: "session", title: "보고서 초안", repo: "github.com/example/ledger", branch: "main" },
  ],
};
const unitCards = (db: DatabaseSync) => db.prepare("SELECT question, state FROM board_card WHERE owner = ? AND win = ? AND question = '노드를 어떻게 묶을까요?'").all(MEMBER, IMPORT_WIN);

test("처음 들여오기가 단위를 고른 뒤(묶기 중) 끊겨도, 같은 몸으로 다시 올리면 단위 카드가 하나 생김", async () => {
  const { db, D1 } = d1(/INSERT INTO imp_audit/);   // regroup 의 마지막 묶음(노드 · 대조 쓰기)이 한 번 실패
  const post = app(D1);
  const r1 = await post(BODY);
  assert.equal(r1.status, 500, "첫 번째는 D1 일시 오류로 실패(기기는 5초 뒤 다시 올림)");
  const set = db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(MEMBER) as { data: string } | undefined;
  assert.equal(JSON.parse(set!.data).unit_by, "auto", "단위는 이미 골라 적힘(끊기기 전)");
  const r2 = await post(BODY);
  assert.equal(r2.status, 200);
  assert.equal(unitCards(db).length, 1, "다시 올린 들여오기에서 단위 카드가 이어서 생겨야 함 — 없으면 사람이 고른 적 없는 단위로 굳음");
  // 그다음 들여오기(1분마다)는 카드를 또 만들지 않음
  assert.equal((await post(BODY)).status, 200);
  assert.equal(unitCards(db).length, 1);
});

test("단위 카드에 답했거나(닫힘) 설정에서 사람이 고른 뒤에는 들여오기가 카드를 다시 만들지 않음", async () => {
  const { db, D1 } = d1();
  const post = app(D1);
  assert.equal((await post(BODY)).status, 200);
  assert.equal(unitCards(db).length, 1);
  db.prepare("UPDATE board_card SET state = 'closed' WHERE owner = ? AND win = ?").run(MEMBER, IMPORT_WIN);
  assert.equal((await post(BODY)).status, 200);
  assert.equal(unitCards(db).length, 1, "닫힌 카드가 있으면 새로 묻지 않음");
  // 설정 › 노드에서 사람이 고름(unit_by me) — 카드가 없어도(예: 처음부터) 묻지 않음
  db.prepare("DELETE FROM board_card WHERE owner = ?").run(MEMBER);
  db.prepare("UPDATE node_setting SET data = ? WHERE owner = ?").run(JSON.stringify({ unit: "goal", unit_by: "me" }), MEMBER);
  assert.equal((await post(BODY)).status, 200);
  assert.equal(unitCards(db).length, 0);
});
