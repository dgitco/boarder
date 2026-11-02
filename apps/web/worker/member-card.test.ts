import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";

register("./test-hooks.mjs", import.meta.url);
const { data, post, nextMorning, TODO_DONE } = await import("./member-board.ts");
const { localTools } = await import("./local.ts");

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
const A = "a@example.com", B = "b@example.com";
function seed() {
  const f = fakeD1(), now = Date.now();
  const card = f.db.prepare("INSERT INTO board_card(id, owner, win, kind, question, choices, state, answer, answered_at, at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  card.run("1793000000.000001", A, "일 창", "decision", "열린 결정", '["A: 하기","B: 말기"]', "open", null, null, now - 3000);
  card.run("1793000000.000002", A, "일 창", "todo", "서류 올리기", '["했어요"]', "open", null, null, now - 2000);
  card.run("1793000000.000003", A, "일 창", "decision", "답한 결정", '["A","B"]', "answered", "A", now - 500, now - 1000);
  card.run("1793000000.000004", B, "일 창", "todo", "B 의 할 일", '["했어요"]', "open", null, null, now - 1000);
  return f;
}
const rowid = (db: DatabaseSync, id: string) => (db.prepare("SELECT rowid AS n FROM board_card WHERE id = ?").get(id) as { n: number }).n;

test("할 일(kind todo)은 결정 줄이 아니라 todos 로 — 틀 꼴(ts · id · area · title · due 글자), 내 것만", async () => {
  const { D1 } = seed();
  const d = await data(D1, A, { name: "메인 봇" });
  assert.deepEqual(d.todos.map((t: any) => [t.ts, t.id, t.area, t.title, t.due]), [["1793000000.000002", "1793000000.000002", "primary", "서류 올리기", ""]]);
  assert.deepEqual(d.decisions.map((x: any) => x.title), ["열린 결정"]);
  const db = await data(D1, B, { name: "메인 봇" });
  assert.deepEqual(db.todos.map((t: any) => t.title), ["B 의 할 일"]);
});

test("할 일 끝냄(POST /api/todo { id }) = 그 카드에 「했어요」 답, 남의 · 없는 할 일은 404", async () => {
  const { D1 } = seed();
  assert.deepEqual(await post(D1, A, "/api/todo", { area: "primary", id: "1793000000.000002" }), { path: "/api/me/cards/1793000000.000002/answer", body: { choice: TODO_DONE, free: true } });
  assert.deepEqual(await post(D1, A, "/api/todo", { id: "1793000000.000004" }), { error: "없는 할 일이에요", status: 404 });
  assert.deepEqual(await post(D1, A, "/api/todo", { id: "1793000000.000001" }), { error: "없는 할 일이에요", status: 404 });
});

test("「(나중에)」: 내일 아침 8시(한국)까지 결정 줄에서 빠지고 카드는 열린 채, 남의 카드는 안 바뀜", async () => {
  const { D1, db } = seed();
  const r = await post(D1, A, "/api/answer", { item: "w" + rowid(db, "1793000000.000001"), text: "(나중에)" });
  assert.deepEqual(r, { ok: { ok: true, state: "ok" } });
  const row = db.prepare("SELECT state, snooze_until FROM board_card WHERE id = ?").get("1793000000.000001") as { state: string; snooze_until: number };
  assert.equal(row.state, "open");
  assert.ok(row.snooze_until > Date.now());
  assert.deepEqual((await data(D1, A, { name: "메인 봇" })).decisions.map((x: any) => x.title), []);
  assert.deepEqual(await post(D1, B, "/api/answer", { item: "w" + rowid(db, "1793000000.000001"), text: "(나중에)" }), { error: "없는 카드", status: 404 });
});

test("내일 아침 8시 계산(한국 UTC+9): 8시 전이면 오늘 8시, 8시부터는 다음 날 8시", () => {
  const kst = (s: string) => Date.parse(s + "+09:00");
  assert.equal(nextMorning(kst("2026-11-02T07:59:00")), kst("2026-11-02T08:00:00"));
  assert.equal(nextMorning(kst("2026-11-02T08:00:00")), kst("2026-11-03T08:00:00"));
  assert.equal(nextMorning(kst("2026-11-02T23:30:00")), kst("2026-11-03T08:00:00"));
  assert.equal(nextMorning(kst("2026-12-31T21:00:00")), kst("2027-01-01T08:00:00"));
});

test("카드 스레드에 쓴 글: 열린 결정이면 답, 답한 결정 · 할 일이면 스레드 답 길로", async () => {
  const { D1 } = seed();
  assert.deepEqual(await post(D1, A, "/api/chat", { thread: "1793000000.000001", text: "B 로 해요" }), { path: "/api/me/cards/1793000000.000001/answer", body: { choice: "B 로 해요", free: true } });
  assert.deepEqual(await post(D1, A, "/api/chat", { thread: "1793000000.000003", text: "하나 더요" }), { path: "/api/me/cards/1793000000.000003/reply", body: { text: "하나 더요" } });
  assert.deepEqual(await post(D1, A, "/api/chat", { thread: "1793000000.000002", text: "어디에 올려요?" }), { path: "/api/me/cards/1793000000.000002/reply", body: { text: "어디에 올려요?" } });
  // 단추(label)는 답 그대로 — 답한 카드에 다른 단추는 막힘
  assert.deepEqual(await post(D1, A, "/api/chat", { thread: "1793000000.000003", label: "B" }), { error: "이미 답한 결정이에요", status: 400 });
});

test("에이전트 inbox_ask kind 가 카드에 남고 inbox_cards 가 그 kind 를 돌려줌(모르는 값은 decision)", async () => {
  const { D1, db } = fakeD1();
  const run = localTools(D1, A, "일 창", "https://board.example");
  const t = await run("inbox_ask", { question: "영수증 올리기", choices: ["했어요"], kind: "todo" }) as { card_id: string };
  const x = await run("inbox_ask", { question: "이상한 종류", choices: ["A"], kind: "weird" }) as { card_id: string };
  assert.equal((db.prepare("SELECT kind FROM board_card WHERE id = ?").get(t.card_id) as { kind: string }).kind, "todo");
  assert.equal((db.prepare("SELECT kind FROM board_card WHERE id = ?").get(x.card_id) as { kind: string }).kind, "decision");
  const cs = await run("inbox_cards", { query: "", limit: 10 }) as { cards: { card_id: string; kind: string }[] };
  assert.equal(cs.cards.find(c => c.card_id === t.card_id)?.kind, "todo");
});
