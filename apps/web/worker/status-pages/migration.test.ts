// node --test --no-warnings --experimental-transform-types apps/web/worker/status-pages/migration.test.ts — 태스크 현황 마이그레이션: 새 표 · 색인만, 다른 PR 의 task_convo 와 안 겹침
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const MIG = new URL("../../migrations/", import.meta.url), FILE = "0061_task_board.sql";
const files = () => readdirSync(MIG).filter(f => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(new URL(f, MIG), "utf8");
function before() { const db = new DatabaseSync(":memory:"); for (const f of files().filter(f => f < "0060_task_board.sql")) db.exec(read(f)); return db; }
const schema = (db: DatabaseSync) => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => JSON.stringify(r));
// 열린 다른 PR 의 표와 같은 꼴(줄 id · layer 검사 · 유일 색인)
const OTHER = `create table if not exists task_convo (id integer primary key autoincrement, owner text not null, task_id text not null, layer text not null check (layer in ('human', 'agents')), who text not null, at integer not null, source text not null, text text not null, src_ref text not null, created_at integer not null);
create unique index if not exists task_convo_ref on task_convo(owner, task_id, src_ref);
create index if not exists task_convo_read on task_convo(owner, task_id, at, id);`;

test("파일은 0061_task_board.sql 하나(0060_task_board.sql 은 없음)", () => {
  assert.ok(files().includes(FILE)); assert.ok(!files().includes("0060_task_board.sql"));
});
test("새 표 · 색인만 더함 — 있던 표는 그대로, 이름은 모두 task_board 로 시작", () => {
  const db = before(), s0 = new Set(schema(db)); db.exec(read(FILE)); const s1 = schema(db);
  assert.deepEqual([...s0].filter(x => !s1.includes(x)), [], "바뀌거나 사라진 것 없음");
  const fresh = s1.filter(x => !s0.has(x)).map(x => JSON.parse(x) as { type: string; name: string });
  assert.ok(fresh.some(x => x.name === "task_board_convo" && x.type === "table"));
  assert.ok(fresh.every(x => x.name.startsWith("task_board")), fresh.map(x => x.name).join());
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'task_convo'").get(), undefined);
  db.exec(read(FILE));   // 두 번 돌려도 그대로
});
test("task_convo 를 만드는 다른 마이그레이션과 어느 순서로든 같이 살고, 그 표 꼴을 안 바꿈", () => {
  for (const order of [[OTHER, FILE], [FILE, OTHER]]) {
    const db = before(); for (const x of order) db.exec(x === FILE ? read(FILE) : x);
    assert.ok(db.prepare("PRAGMA table_info(task_convo)").all().some(c => (c as { name: string }).name === "created_at"), "task_convo 는 그 PR 꼴");
    assert.ok(db.prepare("PRAGMA table_info(task_board_convo)").all().some(c => (c as { name: string }).name === "pending"));
  }
});
