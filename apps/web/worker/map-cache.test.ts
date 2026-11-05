// node --test --no-warnings --experimental-transform-types apps/web/worker/map-cache.test.ts (Node 22.18+ · node:sqlite)
// 노드 ↔ 항목 맡김(map-cache.ts · 이주 0082): 바뀜 번호가 같으면 줄을 다시 안 읽고, 쓰기 · 지우기 · 주인 옮기기가 번호를 올리고, 같은 값 upsert 는 안 올림. 자료는 다 지어낸 것.
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
const { load } = await import("./member-board.ts");
const { regroup } = await import("./importer/routes.ts");
const { mapForget } = await import("./map-cache.ts");
const { meterEnv, newMeter } = await import("./perf.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  let rowsReads = 0;
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => { if (/^SELECT item, node, how FROM mnode_item WHERE owner = \?$/.test(sql)) rowsReads++; return { results: db.prepare(sql).all(...(args as never[])) }; },
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const batch = async (ss: any[]) => { db.exec("BEGIN"); try { const out = []; for (const s of ss) out.push(/^\s*(select|with)/i.test(s.sql) ? await s.all() : await s.run()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  return { db, reads: () => rowsReads, D1: { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database };
}
const A = "map@example.com", B = "map2@example.com";
const ver = (db: DatabaseSync, o: string) => (db.prepare("SELECT v FROM mnode_item_ver WHERE owner = ?").get(o) as { v: number } | undefined)?.v ?? 0;

test("트리거: 넣기 · 값이 바뀐 바꾸기 · 지우기 · 주인 옮기기는 번호를 올리고, 같은 값 upsert 는 안 올림", () => {
  const { db } = d1();
  const up = (item: string, node: string, how = "auto") => db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?) ON CONFLICT(owner, item) DO UPDATE SET node = excluded.node, how = excluded.how").run(A, item, node, how);
  assert.equal(ver(db, A), 0);
  up("window:a", "n1"); assert.equal(ver(db, A), 1, "넣기");
  up("window:a", "n1"); assert.equal(ver(db, A), 1, "같은 값 upsert 는 안 셈");
  up("window:a", "n2"); assert.equal(ver(db, A), 2, "노드 바뀜");
  up("window:a", "n2", "pin"); assert.equal(ver(db, A), 3, "how 바뀜");
  db.prepare("UPDATE mnode_item SET owner = ? WHERE owner = ?").run(B, A); assert.deepEqual([ver(db, A), ver(db, B)], [4, 1], "주인 옮기기는 둘 다");
  db.prepare("DELETE FROM mnode_item WHERE owner = ?").run(B); assert.equal(ver(db, B), 2, "지우기");
});

test("판 읽기: 번호가 같으면 줄을 다시 안 읽음 — 쓰기 뒤엔 새 줄 · 요청마다 재기 감싸개여도 맞음", async () => {
  const f = d1(); mapForget(f.D1);
  f.db.prepare("INSERT INTO mnode(owner, id, name, pinned_name, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(A, "n1", "노드1", "", "working", "", "{}", 1, Date.now());
  f.db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)").run(A, "window:a", "n1", "auto");
  const rd = (D: D1Database) => load(meterEnv({ DB: D } as never, newMeter()).DB, A, true);   // 운영처럼 요청마다 감쌈
  await rd(f.D1); await rd(f.D1); await rd(f.D1);
  assert.equal(f.reads(), 1, "세 번 읽어도 줄은 한 번");
  f.db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)").run(A, "window:b", "n1", "auto");   // 다른 isolate 의 쓰기 흉내(이 isolate 맡김은 안 비움)
  await rd(f.D1); assert.equal(f.reads(), 2, "번호가 바뀌면 다시 읽음");
  await rd(f.D1); assert.equal(f.reads(), 2, "그 뒤 다시 맞음");
});

test("다시 묶기: 맡긴 줄은 사본 — 묶기가 고쳐 써도 다음 읽기에 안 샘 · 묶기가 쓴 줄은 번호로 다음 판 읽기에 보임", async () => {
  const f = d1(); mapForget(f.D1);
  const T = Date.now();
  f.db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, repo, state, state_at, win, session, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(A, "window:m:1", "dev1", "window", "tmux", "세금 정리", "/x", "", "working", T, "window:m:1", "", T);
  const env = { DB: f.D1, PUBLIC_URL: "https://example.test" };
  await regroup(env as never, A);
  const after = f.db.prepare("SELECT item, node FROM mnode_item WHERE owner = ?").all(A) as { item: string; node: string }[];
  assert.ok(after.length >= 1, "묶기가 줄을 씀");
  const L = await load(f.D1, A, true) as any;
  assert.ok(L.byId.get(after[0].node), "판 읽기가 묶기가 쓴 노드를 봄(번호가 올라 다시 읽음)");
  const r0 = f.reads(); await regroup(env as never, A); await regroup(env as never, A);
  assert.ok(f.reads() - r0 <= 1, "바뀐 것 없는 묶기 둘은 줄을 거의 다시 안 읽음: " + (f.reads() - r0));
});

test("번호 표가 없으면(이주 전 · 지운 뒤) 판 읽기 · 다시 묶기가 예전 질의로 한 번 더 읽어 그대로 됨 — 맡기지 않음(리뷰: 표가 없으면 batch 전체가 실패)", async () => {
  const f = d1(); mapForget(f.D1);
  f.db.exec("DROP TRIGGER mnode_item_ver_ins; DROP TRIGGER mnode_item_ver_upd; DROP TRIGGER mnode_item_ver_del; DROP TABLE mnode_item_ver;");
  f.db.prepare("INSERT INTO mnode(owner, id, name, pinned_name, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(A, "n1", "노드1", "", "working", "", "{}", 1, Date.now());
  f.db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)").run(A, "window:a", "n1", "auto");
  const L1 = await load(f.D1, A, true) as any, L2 = await load(f.D1, A, true) as any;
  assert.ok(L1.byId.get("n1") && L2.byId.get("n1"));
  assert.equal(f.reads(), 2, "맡기지 않고 그때그때 읽음");
  await regroup({ DB: f.D1, PUBLIC_URL: "https://example.test" } as never, A);   // 던지지 않음
});
