// node --test --no-warnings --experimental-transform-types apps/web/worker/art-view.test.ts — 아티팩트 열람 기록(art-view.ts), 메모리 SQLite(migrations 전부)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as V from "./art-view.ts";

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])).map(r => ({ ...(r as object) })) }),   // node:sqlite 줄은 null 원형
    run: async () => { db.prepare(sql).run(...(args as never[])); return { success: true }; },
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}
const ID = "abcdefghijklmnop", ID2 = "qrstuvwxyzABCDEFGH";

test("연 것으로 세는 요청: GET 문서 · 틀만, 미리보기 쿼리는 뺌", () => {
  assert.equal(V.viewable("GET", "document", ""), true);
  assert.equal(V.viewable("GET", "iframe", ""), true);
  assert.equal(V.viewable("GET", "image", ""), false);
  assert.equal(V.viewable("HEAD", "document", ""), false);
  assert.equal(V.viewable("GET", "iframe", "?raw=1"), false);
  assert.equal(V.viewable("GET", "document", "?embed"), false);
  assert.equal(V.viewable("GET", "document", "?x=1"), true);
});

test("처음 · 마지막 · 횟수, 사람마다 따로, since 로 거름", async () => {
  const db = d1();
  await V.record(db, "a@x", ID, 1000); await V.record(db, "a@x", ID, 5000); await V.record(db, "a@x", ID2, 3000); await V.record(db, "b@x", ID, 4000);
  await V.record(db, "a@x", "bad id!", 6000);   // 꼴이 아닌 id 는 안 적음
  assert.deepEqual(await V.list(db, "a@x"), [{ art: ID, first_at: 1000, last_at: 5000, n: 2 }, { art: ID2, first_at: 3000, last_at: 3000, n: 1 }]);
  assert.deepEqual((await V.list(db, "a@x", 4000)).map(v => v.art), [ID]);
  assert.deepEqual((await V.list(db, "b@x")).map(v => v.n), [1]);
});
