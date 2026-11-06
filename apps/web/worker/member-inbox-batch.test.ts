import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MI = await import("./member-inbox.ts");
const A = "a@example.com", B = "b@example.com", AT = 1794000000000;
const tsOf = (at: number, id: number) => `${Math.floor(at / 1000)}.${String(id % 1000000).padStart(6, "0")}`;

function fixture() {
  const sql = new DatabaseSync(":memory:"), mig = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(mig).filter(f => f.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(file, mig), "utf8"));
  const queries: string[] = [], batches: number[] = [];
  let calls = 0;
  const execute = (q: string, args: unknown[]) => {
    queries.push(JSON.stringify([q, args]));
    return sql.prepare(q).all(...args as never[]).map(r => ({ ...r }));
  };
  const stmt = (q: string, args: unknown[] = []): any => ({ q, args, bind: (...a: unknown[]) => stmt(q, a),
    first: async () => { calls++; return execute(q, args)[0] || null; } });
  const db = { prepare: (q: string) => stmt(q), batch: async (ss: { q: string; args: unknown[] }[]) => {
    assert.ok(ss.length > 0 && ss.length <= 100);
    calls++; batches.push(ss.length);
    return ss.map(s => ({ results: execute(s.q, s.args), success: true, meta: { rows_written: 0 } }));
  } } as unknown as D1Database;
  const log = (id: number, at: number, owner = A, win = "담당 창") => {
    sql.prepare("INSERT INTO board_log(id, owner, win, kind, text, thread, at) VALUES (?,?,?,'me','synthetic',NULL,?)").run(id, owner, win, at);
    return tsOf(at, id);
  };
  const card = (ts: string, owner = A) => sql.prepare("INSERT INTO board_card(id, owner, win, question, choices, state, answer, at) VALUES (?,?,?,'synthetic','[]','answered','선택',?)").run(ts, owner, "카드 창", AT);
  const reset = () => { queries.length = 0; batches.length = 0; calls = 0; };
  const stats = () => ({ calls, batches: [...batches], queries: [...queries].sort() });
  return { db, log, card, reset, stats, sql };
}

// 변경 전 threadUnread의 카드 우선·없으면 글·뿌리 중복 생략을 그대로 재현한다.
async function before(db: D1Database, roots: string[]) {
  const home = new Map<string, Record<string, any> | null>();
  for (const root of roots) {
    if (home.has(root)) continue;
    const card = await db.prepare("SELECT id, win, question, state, answer, at FROM board_card WHERE id = ? AND owner = ?").bind(root, A).first<Record<string, any>>();
    home.set(root, card || await MI.logByTs(db, A, root));
  }
  return home;
}

for (const hits of [0, 5, 10]) test(`뿌리 10개, 카드 ${hits}개: 옛 결과·SQL·인자 동일, 글 생략 유지`, async () => {
  const s = fixture(), roots = Array.from({ length: 10 }, (_, i) => s.log(i+1, AT+i*1000));
  roots.slice(0, hits).forEach(root => s.card(root));
  const want = await before(s.db, roots), old = s.stats();
  s.reset();
  const actual = await MI.threadHomes(s.db, A, roots), next = s.stats();
  assert.deepEqual(actual, want);
  assert.deepEqual(next.queries, old.queries, "읽는 SQL·bind·문장 수를 늘리지 않음");
  assert.equal(old.calls, 20-hits);
  assert.equal(next.calls, hits === 10 ? 1 : 2);
  assert.deepEqual(next.batches, hits === 10 ? [10] : [10, 10-hits]);
  s.sql.close();
});

test("남의 카드·글, 없는 뿌리, 같은 초·백만 단위 id, 중복 뿌리는 옛 선택 그대로", async () => {
  const s = fixture();
  const own = s.log(1, AT), foreign = s.log(2, AT+1000, B);
  s.card(own, B); // 남의 카드와 같은 ts인 내 글은 내 글로 물러나야 한다.
  s.log(1000001, AT); // 같은 초·나머지 id가 충돌해도 기존 LIMIT 1 SQL의 선택을 보존한다.
  const sameSecond = s.log(3, AT+999), nextSecond = s.log(4, AT+1000);
  const roots = [own, foreign, tsOf(AT+2000, 999), sameSecond, nextSecond, own];
  const want = await before(s.db, roots), old = s.stats();
  s.reset();
  assert.deepEqual(await MI.threadHomes(s.db, A, roots), want);
  assert.deepEqual(s.stats().queries, old.queries);
  assert.equal(want.get(foreign), null);
  assert.equal(want.get(own)?.win, "담당 창");
  assert.equal(want.size, 5);
  s.sql.close();
});

for (const count of [0, 1, 100, 101, 1000]) test(`뿌리 ${count}개: 빈 batch 없음, 최대 100개씩, 옛 결과 동일`, async () => {
  const s = fixture(), roots = Array.from({ length: count }, (_, i) => s.log(i+1, AT+i*1000));
  const want = await before(s.db, roots), old = s.stats();
  s.reset();
  assert.deepEqual(await MI.threadHomes(s.db, A, roots), want);
  assert.deepEqual(s.stats().queries, old.queries);
  assert.equal(s.stats().calls, Math.ceil(count/100)*2);
  s.sql.close();
});

test("batch 오류는 빈 뿌리로 숨기지 않고 받은함 읽기에 전달", async () => {
  const error = new Error("synthetic D1 failure");
  const s = fixture(), root = s.log(1, AT);
  for (const failAt of [1, 2]) {
    let calls = 0;
    const db = { prepare: s.db.prepare.bind(s.db), batch: async (ss: D1PreparedStatement[]) => {
      if (++calls === failAt) throw error;
      return s.db.batch(ss);
    } } as unknown as D1Database;
    await assert.rejects(MI.threadHomes(db, A, [root]), e => e === error);
  }
  s.sql.close();
});
