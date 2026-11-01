// node --test --no-warnings apps/web/worker/owner-read-page.test.ts (Node 22.18+ 타입 지우기 · node:sqlite)
// 채널 글 긴 목록 쪽 넘김(/api/chat/<ch>?before=<ts>): 빠짐 · 중복 없이 끝까지 내려가는지 — 가짜 D1 = 메모리 SQLite(같은 SQL 을 그대로 돌림)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as OR from "./owner-read.ts";

const mig = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");
function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec(mig("0021_owner_ledger.sql")); db.exec(mig("0023_card_home.sql")); db.exec("ALTER TABLE wl_talk_msg ADD COLUMN ack TEXT");
  db.prepare("INSERT INTO wl_talk_chan(id, name, slack_channel) VALUES ('dgit', 'dgit', 'C1')").run();
  return db;
}
function fakeD1(db: DatabaseSync) {
  const plain = (o: unknown) => ({ ...(o as object) }) as Record<string, unknown>;
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a.map(x => typeof x === "boolean" ? Number(x) : x)),
    rows: () => db.prepare(sql).all(...(args as never[])).map(plain),
    async all() { return { results: this.rows(), success: true, meta: {} }; },
    async first() { return this.rows()[0] ?? null; },
    async run() { db.prepare(sql).run(...(args as never[])); return { success: true, meta: {} }; },
  });
  return { prepare: (sql: string) => stmt(sql), async batch(sts: ReturnType<typeof stmt>[]) { return sts.map(s => ({ results: s.rows(), success: true, meta: {} })); } } as unknown as D1Database;
}
const CFG: OR.Cfg = { channels: { dgit: "C1" } };
const NOW = 1790000000;
const tsOf = (i: number) => `${1780000000 + i}.000100`;
function post(db: DatabaseSync, id: string, at: number, slack: string | null = null) {
  db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, text, at, source, slack_ts) VALUES (?, 'dgit', NULL, 'agent', ?, ?, 'web', ?)").run(id, "글 " + id, at, slack);
}
type Page = { messages: { ts: string }[]; more: boolean; cursor: string | null };
async function page(d1: D1Database, before?: string) {
  const o = await OR.build(d1, CFG, { group: "chat", kind: "channel", a: "dgit", b: before }, NOW);
  assert.equal(o?.status, 200);
  return o!.body as Page;
}

test("쪽 넘김 대조: 250 글을 쪽마다 내려가면 빠짐 · 중복 없이 전부", async () => {
  const db = fresh(), d1 = fakeD1(db);
  for (let i = 0; i < 250; i++) post(db, tsOf(i), 1780000000 + i + 0.0001);
  const seen: string[] = []; let p = await page(d1);
  for (;;) { seen.push(...p.messages.map(m => m.ts)); if (!p.more) break; p = await page(d1, p.cursor!); }
  assert.equal(seen.length, 250); assert.equal(new Set(seen).size, 250);
});

test("쓰는 중 읽기: 첫 쪽의 마지막(커서) 글이 장부에서 지워져도 다음 쪽은 그 앞 글부터(고치기 전: 빈 쪽 · more=false)", async () => {
  const db = fresh(), d1 = fakeD1(db);
  for (let i = 0; i < 250; i++) post(db, tsOf(i), 1780000000 + i + 0.0001);
  const p1 = await page(d1);
  assert.ok(p1.more); assert.equal(p1.cursor, tsOf(150));
  db.prepare("DELETE FROM wl_talk_msg WHERE id = ?").run(p1.cursor);   // 릴레이 op del · slack_ts 겹침 지우기(ledger.apply) · 웹 쓰기 DELETE
  const p2 = await page(d1, p1.cursor!);
  assert.equal(p2.messages.length, 100, "커서 글이 없어져도 그보다 오래된 글이 나와야 함");
  assert.equal(p2.messages[p2.messages.length - 1].ts, tsOf(149));
  assert.equal(p2.messages[0].ts, tsOf(50));
  assert.ok(p2.more);
});

test("새 글이 앞쪽에 끼어도 다음 쪽은 커서(at) 기준이라 빠짐 · 중복 없음", async () => {
  const db = fresh(), d1 = fakeD1(db);
  for (let i = 0; i < 150; i++) post(db, tsOf(i), 1780000000 + i + 0.0001);
  const p1 = await page(d1);
  for (let i = 150; i < 160; i++) post(db, tsOf(i), 1780000000 + i + 0.0001);
  const p2 = await page(d1, p1.cursor!);
  const all = [...p1.messages, ...p2.messages].map(m => m.ts);
  assert.equal(all.length, 150); assert.equal(new Set(all).size, 150);
});
