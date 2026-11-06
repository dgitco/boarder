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
  return { D1, tok, truth, reads, db };
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

test("입구 캐시 사본: 새 isolate(다른 DB 객체)는 통째 읽기 없이 사본 + 그 뒤 줄만 — 결과는 원래 질의와 같음 · 캐시가 없으면 예전처럼", async () => {
  const store = new Map<string, string>();
  const fake = { match: async (u: string) => store.has(u) ? new Response(store.get(u)) : undefined, put: async (u: string, r: Response) => { store.set(u, await r.text()); } };
  const g = globalThis as unknown as { caches?: unknown }, had = g.caches;
  try {
    g.caches = { default: fake };
    const { D1, tok, truth, reads } = setup();
    const t = 1_800_000_000_000, now = Date.now;
    tok("h1", "p1", "창 가", t - 900_000); tok("h2", "p2", "창 나", t - 600_000);
    assert.deepEqual(await tokenRows(D1, A), truth());
    assert.equal(store.size, 1, "통째로 읽은 뒤 사본을 올림");
    assert.ok(![...store.keys()][0].includes("example.com"), "열쇠 주소에 메일 없음");
    tok("h3", "p3", "창 다", t);   // 사본 뒤에 생긴 열쇠
    const D2 = { prepare: (sql: string) => (D1 as any).prepare(sql) } as unknown as D1Database;   // 다른 isolate 흉내(맡김 Map 이 비어 있음)
    const n = reads.length;
    assert.deepEqual(await tokenRows(D2, A), truth(), "사본 + 뒤 줄 = 원래 질의");
    assert.equal(reads.length - n, 1); assert.match(reads[n], /created_at >= \?/, "새 isolate 도 뒤 줄만 읽음");
    g.caches = undefined;
    const D3 = { prepare: (sql: string) => (D1 as any).prepare(sql) } as unknown as D1Database;
    const k = reads.length; assert.deepEqual(await tokenRows(D3, A), truth()); assert.doesNotMatch(reads[k], /created_at >= \?/, "캐시가 없으면 통째로");
    Date.now = now;
  } finally { g.caches = had; }
});

test("입구 캐시 사본: 통째 읽은 지 1시간 넘은 사본은 버리고 통째로 — 사본에서 시작한 판이 다시 올려도 지운 줄이 영영 남지 않음", async () => {
  const store = new Map<string, string>();
  const fake = { match: async (u: string) => store.has(u) ? new Response(store.get(u)) : undefined, put: async (u: string, r: Response) => { store.set(u, await r.text()); } };
  const g = globalThis as unknown as { caches?: unknown }, had = g.caches, real = Date.now;
  try {
    g.caches = { default: fake };
    let now = 1_800_000_000_000; Date.now = () => now;
    const { D1, tok, truth, db } = setup();
    const raw = (D1 as any), iso = () => ({ prepare: (sql: string) => raw.prepare(sql) }) as unknown as D1Database;
    tok("h1", "p1", "창 가", now - 900_000); tok("h2", "p2", "창 나", now - 600_000);
    await tokenRows(iso(), A);   // 첫 isolate 통째 → 사본(full = 지금)
    db.prepare("DELETE FROM agent_token WHERE hash = 'h1'").run();
    now += 31 * 60_000; const b = iso(); for (let i = 0; i < 501; i++) tok("n" + i, "q" + i, "창 " + i, now); await tokenRows(b, A);   // 사본에서 시작한 판이 줄 501 늘어 다시 올림(full 은 그대로)
    now += 31 * 60_000;   // 첫 통째 읽기에서 62분
    assert.deepEqual(await tokenRows(iso(), A), truth(), "1시간 넘은 사본은 버리고 통째로 읽어 지금 D1 과 같음");
  } finally { g.caches = had; Date.now = real; }
});
