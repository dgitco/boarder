// node --test --no-warnings --experimental-transform-types apps/web/worker/member-feed-threads.test.ts (Node 22.18+ · node:sqlite)
// 피드 묶음(POST /api/feed/threads — member-board feedThreads): 스레드 여러 개를 질의 2개로, 글은 GET /api/chat/primary/<ts> 와 같게, 남의 줄은 안 섞임.
// 가짜 D1 = 메모리 SQLite + migrations 전부(질의 수를 셈). 자료는 다 지어낸 것.
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
const { feedThreads, get, tsOf, primaryThread, FEED_MAX, FEED_REPLIES_SQL, FEED_ROOTS_SQL } = await import("./member-board.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const q = { n: 0, sql: [] as string[] };   // 실행된 질의 수(batch 안 문장도 하나씩)
  const run = <T>(sql: string, f: () => T) => { q.n++; q.sql.push(sql); return f(); };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => run(sql, () => ({ results: db.prepare(sql).all(...(args as never[])) })),
    first: async () => run(sql, () => db.prepare(sql).get(...(args as never[])) ?? null),
    run: async () => run(sql, () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; }),
  });
  return { db, q, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { const out = []; for (const s of ss) out.push(await s.all()); return out; } } as unknown as D1Database };
}

const ME = "kim@example.test", OTHER = "lee@example.test", WHO = "김하늘", T = 1_793_000_000_000;
function setup() {
  const { db, q, D1 } = d1();
  const log = db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)");
  const add = (owner: string, win: string, kind: string, text: string, thread: string | null, at: number) => { const r = log.run(owner, win, kind, text, thread, at); return tsOf(at, Number(r.lastInsertRowid)); };
  db.prepare("INSERT INTO member_bot(owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(ME, "mochi", 265, "모찌", "", "", "", T);
  // ① 내 Primary 글 + 'p:<ts>' 스레드 답 셋(봇 · 나 · 봇) — 마지막 둘이 last
  const mine = add(ME, "나", "chat", "오늘 할 일 정리해 줘", "primary", T);
  add(ME, "lap:herdr:p1", "chat", "정리 시작할게요", primaryThread(mine), T + 1000);
  add(ME, "나", "chat", "급한 것 먼저", primaryThread(mine), T + 2000);
  add(ME, "lap:herdr:p1", "done", "세 가지로 정리했어요", primaryThread(mine), T + 3000);
  // 남의 줄: 같은 스레드 열쇠 · 같은 초의 남 Primary 글(내 ts 와 초가 같음) — 내 답에 섞이면 안 됨
  add(OTHER, "lap:herdr:p1", "chat", "남의 답", primaryThread(mine), T + 1500);
  const theirs = add(OTHER, "나", "chat", "남의 글", "primary", T + 4000);
  add(OTHER, "lap:herdr:p1", "chat", "남의 글 답", primaryThread(theirs), T + 4500);
  const card = "1793000010.000777";
  db.prepare("INSERT INTO board_card(id, owner, win, question, choices, recommend, body, state, answer, answered_at, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(card, ME, "lap:herdr:p2", "어느 안으로 할까요?", JSON.stringify(["A 안", "B 안"]), "A 안", "A 는 빠르고 B 는 싸요", "answered", "A 안", T + 20_000, T + 10_000);
  add(ME, "lap:herdr:p2", "chat", "A 와 B 비교표 붙였어요", card, T + 12_000);
  add(ME, "lap:herdr:p2", "progress", "A 안으로 시작해요", card, T + 25_000);
  add(OTHER, "lap:herdr:p2", "chat", "남의 카드 줄", card, T + 13_000);   // 같은 카드 id 를 thread 로 쓴 남의 줄
  // ③ 봇이 Primary 에 쓴 글(답 없음) · ④ 답 없는 내 글
  const bot = add(ME, "lap:herdr:p1", "progress", "메인 창 보고", "primary", T + 30_000);
  const lone = add(ME, "나", "chat", "답 없는 내 글", "primary", T + 40_000);
  return { db, q, D1, mine, theirs, card, bot, lone };
}
const emoji = async () => null;
async function viaGet(D1: D1Database, ts: string) {
  const r = await get(D1, ME, { name: "모찌" }, new URL("https://boarder.test/api/chat/primary/" + ts), emoji, undefined, WHO);
  return (await r!.json()).messages as any[];
}

test("스레드마다 GET /api/chat/primary/<ts> 와 같은 뿌리 · 마지막 답 · 답 수 · 마지막 시각", async () => {
  const { D1, mine, card, bot, lone } = setup();
  const [st, o] = await feedThreads(D1, ME, { items: [mine, card, bot, lone].map(ts => ({ k: "primary", ts })) }, { who: WHO });
  assert.equal(st, 200);
  for (const ts of [mine, card, bot, lone]) {
    const ms = await viaGet(D1, ts), t = o.threads[ts];
    assert.ok(t, "묶음에 " + ts);
    assert.deepEqual(t.root, ms[0], "뿌리 " + ts);
    assert.deepEqual(t.last, ms.slice(1).slice(-2), "마지막 답 " + ts);
    assert.equal(t.replies, ms.length - 1, "답 수 " + ts);
    assert.equal(t.latest, ms[0].latest, "마지막 시각 " + ts);
  }
  assert.equal(o.threads[mine].replies, 3); assert.equal(o.threads[mine].last.length, 2);
  assert.equal(o.threads[mine].last[1].text, "세 가지로 정리했어요");
  assert.equal(o.threads[mine].root.name, WHO, "내 글 이름 = 회원 이름");
  assert.equal(o.threads[mine].last[0].name, WHO); assert.equal(o.threads[mine].last[1].name, "모찌", "봇 답 이름 = 메인 봇 이름");
  assert.equal(o.threads[card].replies, 3, "카드: 에이전트 줄 둘 + 내 답");
  assert.equal(o.threads[card].last.at(-1).text, "A 안으로 시작해요");
  assert.equal(o.threads[bot].replies, 0); assert.deepEqual(o.threads[bot].last, []);
  assert.equal(o.threads[lone].replies, 0); assert.equal(o.threads[lone].latest, null);
});

test("질의는 2개(한 batch) — 판 전체(load)를 안 읽음", async () => {
  const { D1, q, mine, card, bot, lone } = setup();
  q.n = 0; q.sql = [];
  const items = [mine, card, bot, lone].map(ts => ({ k: "primary", ts }));
  for (let i = 0; items.length < FEED_MAX; i++) items.push({ k: "primary", ts: tsOf(T + 50_000 + i * 1000, 900 + i) });   // 없는 스레드로 50개 채움
  const [st, o] = await feedThreads(D1, ME, { items }, { who: WHO });
  assert.equal(st, 200);
  assert.ok(q.n <= 2, "질의 " + q.n + "개: " + q.sql.join(" | "));
  assert.equal(Object.keys(o.threads).length, 4, "없는 ts 는 안 넣음");
});

test("남의 owner 줄은 안 읽음 — 같은 스레드 열쇠 · 남의 뿌리 ts", async () => {
  const { D1, mine, card, theirs } = setup();
  const [, o] = await feedThreads(D1, ME, { items: [mine, card, theirs].map(ts => ({ k: "primary", ts })) }, { who: WHO });
  const all = JSON.stringify(o);
  assert.ok(!/남의/.test(all), "남의 글 · 답이 섞임: " + all);
  assert.equal(o.threads[theirs], undefined, "남의 뿌리는 없음");
  assert.equal(o.threads[mine].replies, 3);
  assert.equal(o.threads[card].replies, 3);
  const [, o2] = await feedThreads(D1, OTHER, { items: [{ k: "primary", ts: card }, { k: "primary", ts: mine }] }, { who: "이" });
  assert.equal(o2.threads[card], undefined, "남의 카드는 남에게 없음"); assert.equal(o2.threads[mine], undefined);
});

test("꼴 틀림 · 50개 초과는 400, Primary 밖 채널 · 접은 글 ts 는 묶음에 안 넣음(화면이 GET 으로)", async () => {
  const { D1, mine } = setup();
  for (const b of [null, [], {}, { items: "x" }, { items: [{ k: "primary" }] }, { items: [{ k: "primary", ts: "123" }] }, { items: [{ k: "", ts: mine }] }, { items: [{ k: 1, ts: mine }] }, { items: [null] }])
    assert.equal((await feedThreads(D1, ME, b, { who: WHO }))[0], 400, JSON.stringify(b));
  const many = Array.from({ length: FEED_MAX + 1 }, (_, i) => ({ k: "primary", ts: tsOf(T + i * 1000, i) }));
  assert.equal((await feedThreads(D1, ME, { items: many }, { who: WHO }))[0], 400);
  const [st, o] = await feedThreads(D1, ME, { items: [{ k: "n:팀장", ts: mine }, { k: "primary", ts: "1793000000.990001" }, { k: "primary", ts: "1793000000.980001" }, { k: "primary", ts: "1793000000.960001" }] }, { who: WHO });
  assert.equal(st, 200); assert.deepEqual(o.threads, {});
  assert.deepEqual(await feedThreads(D1, ME, { items: [] }, { who: WHO }), [200, { threads: {} }]);
});

test("앞단 이름(메인 봇 이름) · 에이전트끼리 접기를 켠 사람의 카드", async () => {
  const { db, D1, mine, card } = setup();
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(ME, JSON.stringify({ front_door: { name: "비서실장", pairs: [{ pane: "%1000123", name: "팀장" }] } }), T);
  const [, o] = await feedThreads(D1, ME, { items: [{ k: "primary", ts: mine }, { k: "primary", ts: card }] }, { who: WHO });
  const ms = await viaGet(D1, mine);
  assert.deepEqual(o.threads[mine].root, ms[0]); assert.deepEqual(o.threads[mine].last, ms.slice(-2));
  assert.equal(o.threads[mine].last[1].name, "비서실장", "앞단 이름이 메인 봇 이름");
  assert.deepEqual(o.threads[card].root, (await viaGet(D1, card))[0]);
  db.prepare("UPDATE node_setting SET data = ? WHERE owner = ?").run(JSON.stringify({ agents_fold: true, front_door: { name: "비서실장", pairs: [{ pane: "%1000123", name: "팀장" }] } }), ME);
  const [, o2] = await feedThreads(D1, ME, { items: [{ k: "primary", ts: mine }, { k: "primary", ts: card }] }, { who: WHO });
  assert.equal(o2.threads[card], undefined, "접기 켬: 카드 글쓴이를 판으로 정해서 GET 으로");
  assert.ok(o2.threads[mine]);
});

test("질의 계획: 답 줄은 (owner, thread, at) 색인 · 뿌리는 색인으로 찾음(그 사람 줄 전부 훑기 없음)", () => {
  const { db } = setup();
  const plan = (sql: string, ...a: unknown[]) => (db.prepare("EXPLAIN QUERY PLAN " + sql).all(...(a as never[])) as { detail: string }[]).map(r => r.detail);
  const p1 = plan(FEED_REPLIES_SQL, ME, "[]");
  assert.ok(p1.some(d => /board_log USING (COVERING )?INDEX board_log_thread/.test(d)), p1.join(" / "));
  const p2 = plan(FEED_ROOTS_SQL, ME, "[]"), j = p2.findIndex(d => /^SCAN j\b/.test(d)), b = p2.findIndex(d => /^SEARCH b USING INDEX board_log_(thread|owner) \(owner=\? AND .*at>\? AND at<\?\)/.test(d));
  assert.ok(j >= 0 && b > j, "ts 목록이 바깥, 뿌리 줄은 1초 범위로: " + p2.join(" / "));
  assert.ok(p2.some(d => /^SEARCH c USING INDEX sqlite_autoindex_board_card_1 \(id=\?\)/.test(d)), "카드는 id 로: " + p2.join(" / "));
  assert.ok(!p2.some(d => /^SCAN (b|c|board_log|board_card)\b/.test(d)), p2.join(" / "));
});

test("내 이름은 user 표에서(같은 질의) — GET 이 index.ts 에서 읽는 이름과 같음", async () => {
  const { db, D1, q, mine } = setup();
  db.prepare('INSERT INTO "user"(id, name, email, emailVerified, createdAt, updatedAt) VALUES (?,?,?,?,?,?)').run("u1", WHO, ME, 1, "2026-11-01", "2026-11-01");
  q.n = 0;
  const [, o] = await feedThreads(D1, ME, { items: [{ k: "primary", ts: mine }] }, { email: ME });
  assert.equal(q.n, 2);
  assert.equal(o.threads[mine].root.name, WHO);
  assert.deepEqual(o.threads[mine].root, (await viaGet(D1, mine))[0]);
});
