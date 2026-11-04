import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";

register("./test-hooks.mjs", import.meta.url);
const { memberPushWanted, ONBOARD_QUIET_MS } = await import("./member-push.ts");
const { localTools, askedAt } = await import("./local.ts");

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
const A = "a@example.com", HOUR = 3600_000;
const device = (db: DatabaseSync, owner: string, createdAt: number, id = "devA0000001") =>
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)").run(id, owner, "laptop", "", `h-${id}`, createdAt, createdAt, "full");

// index.ts memberCardPush 와 같은 길: localTools 의 onCard → memberPushWanted 가 true 인 것만 「보냄」
function rig(D1: D1Database, wide = false) {
  const sent: string[] = [], waits: Promise<unknown>[] = [];
  const run = localTools(D1, A, "일 창", "https://board.example", "", c => { waits.push(memberPushWanted(D1, A, c, wide).then((ok: boolean) => { if (ok) sent.push(c.question); })); });
  return { sent, ask: async (a: Record<string, unknown>) => { await run("inbox_ask", { choices: ["A"], ...a }); await Promise.all(waits); } };
}

test("온보딩이 지난 회원: 보통 카드 0건 · urgent 카드 1건 · 할 일은 urgent 여도 0건", async () => {
  const { D1, db } = fakeD1(); device(db, A, Date.now() - 2 * HOUR);
  const r = rig(D1);
  await r.ask({ question: "보통 결정" });
  await r.ask({ question: "보통 질문", kind: "question" });
  assert.deepEqual(r.sent, []);
  await r.ask({ question: "결제 장애", urgent: true });
  assert.deepEqual(r.sent, ["결제 장애"]);
  await r.ask({ question: "급한 할 일", kind: "todo", urgent: true });
  assert.deepEqual(r.sent, ["결제 장애"]);
  assert.deepEqual(db.prepare("SELECT question, urgent FROM board_card ORDER BY at, question").all().map((x: any) => [x.question, x.urgent]).sort(),
    [["결제 장애", 1], ["급한 할 일", 1], ["보통 결정", 0], ["보통 질문", 0]]);
});

test("온보딩 30분 안: urgent 여도 0건(첫 기기 = 가장 이른 created, 대소문자 무관) · 30분 지나면 1건", async () => {
  const { D1, db } = fakeD1(); device(db, "A@Example.com", Date.now() - 5 * 60_000);
  device(db, A, Date.now() - 60_000, "devA0000002");
  const r = rig(D1);
  for (let i = 0; i < 5; i++) await r.ask({ question: `밀린 질문 ${i}`, urgent: true });
  assert.deepEqual(r.sent, []);
  db.prepare("UPDATE device SET created_at = ?").run(Date.now() - ONBOARD_QUIET_MS - 1000);
  await r.ask({ question: "보안 사고", urgent: true });
  assert.deepEqual(r.sent, ["보안 사고"]);
});

test("옛 글: 원래 시각이 10분 넘게 앞서거나 backlog 표시면 urgent 여도 0건 · 원래 시각이 방금이면 1건", async () => {
  const { D1, db } = fakeD1(); device(db, A, Date.now() - 2 * HOUR);
  const r = rig(D1);
  await r.ask({ question: "어제 질문", urgent: true, asked_at: new Date(Date.now() - 24 * HOUR).toISOString() });
  await r.ask({ question: "옛 질문 초", urgent: true, asked_at: Math.floor((Date.now() - HOUR) / 1000) });
  await r.ask({ question: "옛 표시", urgent: true, backlog: true });
  assert.deepEqual(r.sent, []);
  await r.ask({ question: "방금 질문", urgent: true, asked_at: Date.now() - 60_000 });
  assert.deepEqual(r.sent, ["방금 질문"]);
  assert.equal((db.prepare("SELECT orig_at FROM board_card WHERE question = '옛 표시'").get() as any).orig_at, 0);
  assert.equal(askedAt("엉터리"), null);
});

test("비밀 넣기 허용 카드: 온보딩 30분 안이어도 1건(에이전트가 멈춰 기다림) · 기기가 없는 회원도 urgent 는 보냄", async () => {
  const { D1, db } = fakeD1(); device(db, A, Date.now() - 60_000);
  assert.equal(await memberPushWanted(D1, A, { id: "1793170372.000001", question: "「카드」 비밀 넣기 허용?", secret: true }), true);
  assert.equal(await memberPushWanted(D1, A, { id: "1793170372.000002", question: "보통" }), false);
  const e = fakeD1();
  assert.equal(await memberPushWanted(e.D1, A, { id: "1793170372.000003", question: "급함", urgent: true, at: Date.now() }), true);
});

test("넓힘을 켠 회원: 새 카드는 다 1건씩(보통 결정 · 질문 · 승인 · 할 일 · urgent) · 온보딩 30분 안 · 옛 글은 그래도 0", async () => {
  const { D1, db } = fakeD1(); device(db, A, Date.now() - 2 * HOUR);
  const r = rig(D1, true);
  await r.ask({ question: "보통 결정" });
  await r.ask({ question: "보통 질문", kind: "question" });
  await r.ask({ question: "결제 장애", urgent: true });
  await r.ask({ question: "급한 할 일", kind: "todo", urgent: true });
  await r.ask({ question: "배포 승인", kind: "approval" });
  await r.ask({ question: "어제 질문", asked_at: new Date(Date.now() - 24 * HOUR).toISOString() });
  await r.ask({ question: "옛 표시", backlog: true });
  assert.deepEqual(r.sent, ["보통 결정", "보통 질문", "결제 장애", "급한 할 일", "배포 승인"]);
  const q = fakeD1(); device(q.db, A, Date.now() - 60_000);
  const r2 = rig(q.D1, true);
  await r2.ask({ question: "밀린 결정" });
  assert.deepEqual(r2.sent, []);
});
