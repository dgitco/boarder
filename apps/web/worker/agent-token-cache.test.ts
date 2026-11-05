// node --test --no-warnings --experimental-transform-types apps/web/worker/agent-token-cache.test.ts
// 열쇠 표 늘려 읽기: 처음엔 다 읽고, 그 뒤엔 새 줄만 읽어도 원래 질의(ORDER BY created_at)와 같은 결과여야 한다. 자료는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
const { tokenRows } = await import("./agent-token-cache.ts");

const A = "a@example.com";
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("create table agent_token (hash text primary key, pane text not null, win text not null default '', host text not null default 'h', created_at integer not null, revoked_at integer, owner text); create index agent_token_owner on agent_token(owner, created_at);");
  const reads: string[] = [];
  const exec = (sql: string, args: unknown[]) => { reads.push(sql); return { results: db.prepare(sql).all(...(args as never[])).map(r => ({ ...r })) }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ bind: (...a: unknown[]) => stmt(sql, a), all: async () => exec(sql, args) });
  const D1 = { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
  const tok = (h: string, pane: string, win: string, at: number, owner = A) => db.prepare("INSERT INTO agent_token(hash, pane, win, created_at, owner) VALUES (?,?,?,?,?)").run(h, pane, win, at, owner);
  const truth = () => db.prepare("SELECT pane, win FROM agent_token WHERE owner = ? ORDER BY created_at").all(A).map(r => ({ ...r }));
  return { D1, tok, truth, reads };
}

test("새 열쇠는 다음 읽기에 바로 · 결과와 순서는 원래 질의와 같음", async () => {
  const { D1, tok, truth, reads } = setup();
  const t = 1_800_000_000_000;
  tok("h1", "p1", "창 가", t - 600_000); tok("h2", "p2", "창 나", t - 300_000); tok("hx", "px", "남의 창", t, "b@example.com");
  assert.deepEqual(await tokenRows(D1, A), truth());
  tok("h3", "p3", "창 가", t); tok("h4", "p4", "창 다", t);   // 같은 시각 둘 — rowid 순
  assert.deepEqual(await tokenRows(D1, A), truth());
  assert.match(reads[1], /created_at >= \?/);   // 두 번째부터는 새 줄만
  assert.deepEqual(await tokenRows(D1, A), truth());
});

test("DB 가 다르면 따로(시험마다 새 DB)", async () => {
  const a = setup(), b = setup();
  a.tok("h1", "p1", "창", 1); b.tok("h9", "p9", "다른 창", 1);
  assert.deepEqual(await tokenRows(a.D1, A), a.truth());
  assert.deepEqual(await tokenRows(b.D1, A), b.truth());
});
