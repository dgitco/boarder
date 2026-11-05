// 회원 버전 트리거 · Cache API. 자료는 전부 시험용.
import { test, beforeEach } from "node:test";
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
const { load, loadRead, loadForget, get } = await import("./member-board.ts");

beforeEach(() => { loadForget(ME); loadForget(OTHER); });   // 0.4초 나눠 쓰기 표는 모듈 전체가 같이 씀 — 시험마다 새 DB 라 앞 시험 판을 같은 번호로 집지 않게
const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:"); let batches = 0; const queries: string[] = [];
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => { queries.push(sql); return { results: db.prepare(sql).all(...(args as never[])) }; },
    first: async () => { queries.push(sql); return db.prepare(sql).get(...(args as never[])) ?? null; },
    run: async () => { queries.push(sql); const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { db, queries, count: () => batches, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { batches++; const out = []; for (const s of ss) out.push(await s.all()); return out; } } as unknown as D1Database };
}
const ME = "cache@example.com", OTHER = "other@example.com";
const TABLES = "board_log imp_item mnode mnode_item board_card role_draft engine_window node_setting user_pref member_bot agent_token device member_promise".split(" ");
const version = (db: DatabaseSync, owner = ME) => Number((db.prepare("SELECT v FROM owner_ver WHERE owner = ?").get(owner) as any)?.v || 0);
function insert(db: DatabaseSync, table: string, owner = ME) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  const required = cols.filter(c => c.name === "owner" || (c.notnull && c.dflt_value === null) || (c.pk && !/INT/i.test(c.type)));
  db.prepare(`INSERT INTO ${table} (${required.map(c => c.name).join(",")}) VALUES (${required.map(() => "?").join(",")})`)
    .run(...required.map(c => c.name === "owner" ? owner : table === "user_pref" && c.name === "k" ? "primary_win" : /INT/i.test(c.type) ? Date.now() : `${table}-${c.name}`));
}
function fakeCache() {
  const entries = new Map<string, Response>();
  return { entries, match: async (key: Request) => entries.get(key.url)?.clone(), put: async (key: Request, response: Response) => { entries.set(key.url, response.clone()); } };
}
async function withCache(fn: (cache: ReturnType<typeof fakeCache>) => Promise<void>) {
  const old = Object.getOwnPropertyDescriptor(globalThis, "caches"), cache = fakeCache();
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: cache } });
  try { await fn(cache); } finally { if (old) Object.defineProperty(globalThis, "caches", old); else delete (globalThis as any).caches; }
}
function client(D1: D1Database) {
  const pending: Promise<unknown>[] = [], ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  return async (path: string, owner = ME, name = "봇", inm?: string) => {
    const r = await get(D1, owner, { name }, new URL("https://example.com" + path), async () => null, inm, null, ctx);
    await Promise.all(pending.splice(0)); return r!;
  };
}

for (const table of TABLES) test(`${table}: INSERT/UPDATE/DELETE · 주인 변경은 두 사람 번호를 올림 · 값이 같은 UPDATE 는 그대로`, () => {
  const { db } = d1(); insert(db, table);
  assert.equal(version(db), 1);
  db.prepare(`UPDATE ${table} SET owner = owner WHERE owner = ?`).run(ME); assert.equal(version(db), 1);   // 값이 같은 UPDATE(같은 값 upsert)는 안 올림
  db.prepare(`UPDATE ${table} SET owner = ? WHERE owner = ?`).run(OTHER, ME);
  assert.equal(version(db), 2); assert.equal(version(db, OTHER), 1);
  db.prepare(`DELETE FROM ${table} WHERE owner = ?`).run(OTHER); assert.equal(version(db, OTHER), 2);
});

test("member_bot: @me 아바타는 실제 사람 번호를 올림", () => {
  const { db } = d1(); insert(db, "member_bot", "@me:" + ME); assert.equal(version(db), 1);
  db.prepare("UPDATE member_bot SET hue = 20 WHERE owner = ?").run("@me:" + ME); assert.equal(version(db), 2);
  db.prepare("DELETE FROM member_bot WHERE owner = ?").run("@me:" + ME); assert.equal(version(db), 3);
});

for (const path of ["/api/data", "/api/topics"]) test(`${path}: 같은 v는 버전 질의 하나만 · 같은 몸통/ETag · 304 · 쓰기 직후 새 몸통`, async () => {
  await withCache(async cache => {
    const { db, D1, queries } = d1(), call = client(D1);
    insert(db, "node_setting");
    const first = await call(path), body = await first.text(), tag = first.headers.get("etag")!;
    assert.equal(cache.entries.size, 1);
    assert.match([...cache.entries.keys()][0], /cache\.internal\/mb\/cache%40example.com\/%EB%B4%87\/api\/(data|topics)\/v1$/);
    assert.equal(first.headers.get("cache-control"), "no-store"); assert.equal(first.headers.has("x-boarder-cached-at"), false);
    queries.length = 0;
    const second = await call(path); assert.equal(await second.text(), body); assert.equal(second.headers.get("etag"), tag);
    assert.deepEqual(queries, ["SELECT v FROM owner_ver WHERE owner = ?"]);
    queries.length = 0;
    const unchanged = await call(path, ME, "봇", "W/" + tag); assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), "");
    assert.equal(queries.length, 1);
    db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES (?,?,?,?,?,?)").run(ME, "봇", "progress", "새 글", "primary", Date.now());
    queries.length = 0;
    const changed = await call(path, ME, "봇", tag); assert.equal(changed.status, 200); assert.notEqual(await changed.text(), body);
    assert.ok(queries.length > 1); assert.equal(cache.entries.size, 2);
    await call(path, ME, "다른 봇"); assert.equal(cache.entries.size, 3);
    insert(db, "node_setting", OTHER); await call(path, OTHER); assert.equal(cache.entries.size, 4);
  });
});

test("30초 만료 · 버전 없음/읽기 실패 · Cache API 실패는 새 계산", async () => {
  await withCache(async cache => {
    const { db, D1, queries } = d1(), call = client(D1), real = Date.now;
    let now = real(); Date.now = () => now;
    try {
      await call("/api/data"); await call("/api/data"); assert.equal(cache.entries.size, 0);
      insert(db, "node_setting"); await call("/api/data");
      queries.length = 0; now += 29_999; await call("/api/data"); assert.equal(queries.length, 1);
      queries.length = 0; now++; await call("/api/data"); assert.ok(queries.length > 1);
      db.exec("DROP TABLE owner_ver"); queries.length = 0; await call("/api/data"); assert.ok(queries.length > 1);
    } finally { Date.now = real; }
  });
  await withCache(async cache => {
    const { db, D1 } = d1(); insert(db, "node_setting");
    cache.match = async () => { throw new Error("Cache API unavailable"); };
    cache.put = async () => { throw new Error("Cache API unavailable"); };
    assert.equal((await client(D1)("/api/data")).status, 200);
  });
});

test("계산 중 쓰기는 다음 v로 다시 계산", async () => {
  await withCache(async cache => {
    const { db, D1 } = d1(); insert(db, "node_setting");
    const batch = D1.batch.bind(D1); let wrote = false;
    const racing = { ...D1, batch: async (ss: any[]) => {
      const r = await batch(ss);
      if (!wrote) { wrote = true; db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES (?,?,?,?,?,?)").run(ME, "봇", "progress", "계산 중 쓰기", "primary", Date.now()); }
      return r;
    } } as D1Database;
    const call = client(racing), first = await (await call("/api/data")).text(), second = await (await call("/api/data")).text();
    assert.notEqual(first, second); assert.equal(cache.entries.size, 2);
  });
});

test("seen_at만 바뀌어도 state_at 없는 메인 봇 선택이 바뀌므로 번호를 올림", async () => {
  await withCache(async () => {
    const { db, D1 } = d1(), now = Date.now();
    for (const [key, cwd, seen] of [["a", "/first", now - 2000], ["b", "/second", now - 1000]] as const)
      db.prepare("INSERT INTO imp_item(owner,key,kind,title,cwd,seen_at,engine) VALUES (?,?,?,?,?,?,?)").run(ME, key, "window", "Primary", cwd, seen, "tmux-own");
    const call = client(D1), before = await (await call("/api/data")).json() as any, v = version(db);
    assert.equal(before.panes[0].cwd, "/second");
    db.prepare("UPDATE imp_item SET seen_at = ? WHERE owner = ? AND key = 'a'").run(now, ME);
    assert.equal(version(db), v + 1);
    const after = await (await call("/api/data")).json() as any; assert.equal(after.panes[0].cwd, "/first");
  });
});

test("사본 없는 조건부 요청의 304도 200 몸통을 캐시에 채움", async () => {
  await withCache(async cache => {
    const { db, D1 } = d1(), call = client(D1); insert(db, "node_setting");
    const first = await call("/api/data"), body = await first.text(), tag = first.headers.get("etag")!;
    cache.entries.clear();
    assert.equal((await call("/api/data", ME, "봇", tag)).status, 304);
    assert.equal(cache.entries.size, 1); assert.equal(await (await call("/api/data")).text(), body);
  });
});
