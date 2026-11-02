import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";

register("./test-hooks.mjs", import.meta.url);
const { get, post } = await import("./member-board.ts");

const MIG = new URL("../migrations/", import.meta.url);
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => (db.prepare(sql).get(...(args as never[])) as unknown) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { db, D1: { prepare: (s: string) => stmt(s), batch: async (ss: any[]) => ss.map(s => ({ results: db.prepare(s.sql).all(...(s.args as never[])) })) } as unknown as D1Database };
}
const A = "a@example.com", B = "b@example.com", now = Date.now();
function seed() {
  const f = fakeD1();
  const log = f.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)");
  log.run(A, "메인 봇", "chat", "A 의 메인 봇 글", "primary", now - 2000);
  log.run(A, "나", "chat", "A 가 쓴 글(판 줄에서 빠짐)", "primary", now - 1000);
  log.run(B, "메인 봇", "chat", "B 의 글", "primary", now - 1500);
  f.db.prepare("INSERT INTO board_card(id, owner, win, question, choices, at) VALUES (?,?,?,?,?,?)").run("1793000000.000001", A, "일 창", "A 카드", "[]", now);
  f.db.prepare("INSERT INTO board_card(id, owner, win, question, choices, at) VALUES (?,?,?,?,?,?)").run("1793000000.000002", B, "일 창", "B 카드", "[]", now);
  return f;
}
const call = async (D1: D1Database, me: string, path: string) => {
  const r = await get(D1, me, { name: "메인 봇" }, new URL("https://board.example" + path), async () => null);
  assert.ok(r, `${path} 는 회원 길이 받아야 함(null = 403)`);
  return { status: r!.status, body: await r!.json() as any };
};

test("판 자세히(/api/pane/:p): 메인 봇 판은 내 메인 봇 줄만 { rows: [{ id, at, kind, msg }] }, 남의 줄 · 내 글은 빠짐", async () => {
  const { D1 } = seed();
  const a = await call(D1, A, "/api/pane/%251");
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.rows.map((r: any) => r.msg), ["A 의 메인 봇 글"]);
  assert.deepEqual(Object.keys(a.body.rows[0]).sort(), ["at", "id", "kind", "msg"]);
  assert.ok(Math.abs(a.body.rows[0].at - (now - 2000) / 1000) < 1, "at 은 초");
  const b = await call(D1, B, "/api/pane/%251");
  assert.deepEqual(b.body.rows.map((r: any) => r.msg), ["B 의 글"]);
  const none = await call(D1, A, "/api/pane/%25999");
  assert.deepEqual(none.body, { rows: [] });
});

test("알림 카드 자리(/api/push/resolve/:ts): 내 카드면 자리, 남의 카드는 null", async () => {
  const { D1 } = seed();
  const mine = await call(D1, A, "/api/push/resolve/1793000000.000001");
  assert.deepEqual(mine.body, { ts: "1793000000.000001", loc: { c: "primary", t: "1793000000.000001", m: "1793000000.000001", state: "open" } });
  const other = await call(D1, A, "/api/push/resolve/1793000000.000002");
  assert.equal(other.body.loc, null);
});

test("판 주인 · 첨부 · 바깥 주소: 403 대신 빈 답 · 404", async () => {
  const { D1 } = seed();
  assert.deepEqual((await call(D1, A, "/api/artowner/AbCdEfGh12345678")).body, {});
  assert.equal((await call(D1, A, "/api/file/0123456789abcdef0123456789abcdef")).status, 404);
  assert.equal((await call(D1, A, "/api/permalink/primary/1793000000.000001")).status, 404);
});

test("화면 오류 기록(POST /api/clientlog)은 400 이 아니라 ok", async () => {
  const { D1 } = seed();
  assert.deepEqual(await post(D1, A, "/api/clientlog", { msg: "x" }), { ok: { ok: true } });
  assert.deepEqual(await post(D1, A, "/api/nothing", {}), { error: "아직 안 돼요", status: 400 });
});
