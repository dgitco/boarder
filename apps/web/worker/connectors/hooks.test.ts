/**
 * 웹훅 받는 주소 /hook/:id 의 신뢰성(재전송 · 부분 실패 · 동시 도착) — bun:sqlite 로 D1 흉내(네트워크 없음).
 *   cd apps/web && bun test worker/connectors/hooks.test.ts
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { Hono } from "hono";
import { mountHooks } from "./hooks";

const TOKEN = "tok-abc";
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, "0")).join("");

// D1 꼴(prepare · bind · first · all · run · batch)만. failBatch 번만큼 batch 가 실패(일시 D1 오류)
function d1(db: Database, opt: { failBatch: number }) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => db.query(sql).get(...(args as any[])) ?? null,
    all: async () => ({ results: db.query(sql).all(...(args as any[])) }),
    run: async () => ({ meta: { changes: db.query(sql).run(...(args as any[])).changes } }),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: ReturnType<typeof stmt>[]) => {
      if (opt.failBatch > 0) { opt.failBatch--; throw new Error("D1_ERROR: network connection lost"); }
      return db.transaction(() => list.map(s => db.query(s.sql).run(...(s.args as any[]))))();
    },
  } as unknown as D1Database;
}

async function setup(failBatch = 0) {
  const db = new Database(":memory:");
  db.exec(readFileSync(new URL("../../migrations/0007_hooks.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../../migrations/0012_hook_service.sql", import.meta.url), "utf8"));
  db.query("INSERT INTO hook(id, owner, name, preset, verify, secret_hash, target, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("wh_test", "", "ch", "channeltalk", JSON.stringify({ mode: "query", param: "token" }), await sha256(TOKEN), "work", Date.now());
  const woke: string[] = [], waits: Promise<unknown>[] = [];
  const app = new Hono();
  mountHooks(app, async () => null, async (_env, _ctx, _target, text) => { woke.push(text); return "woke"; });
  const env = { DB: d1(db, { failBatch }), CONNECTOR_KEY: "k", PUBLIC_URL: "https://x.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); }, passThroughOnException() {}, props: {} };
  // 보내는 쪽: 2xx 를 받을 때까지 같은 본문을 다시 보냄(GitHub · 채널톡 재전송과 같음)
  const send = async (body: string, tries = 3) => {
    const codes: number[] = [];
    for (let i = 0; i < tries; i++) {
      const r = await app.request(`/hook/wh_test?token=${TOKEN}`, { method: "POST", body, headers: { "content-type": "application/json" } }, env, ctx as any);
      codes.push(r.status);
      if (r.status < 300) break;
    }
    await Promise.all(waits);
    return codes;
  };
  return { db, woke, send };
}

test("저장 뒤 장부 갱신(batch)이 한 번 실패해도 — 보낸 쪽 재전송 끝에 창은 한 번 깨워짐", async () => {
  const s = await setup(1);
  const codes = await s.send(JSON.stringify({ type: "message", entity: { chatId: "c1" } }));
  expect(codes.at(-1)! < 300).toBe(true);
  expect(s.db.query("SELECT count(*) n FROM hook_event").get()).toEqual({ n: 1 });
  expect(s.woke.length).toBe(1);   // 고치기 전: 첫 요청 500 → 재전송은 「같은 것」 200 → 깨우기 0번(조용히 사라짐)
  expect(s.db.query("SELECT delivered FROM hook_event").get()).toEqual({ delivered: "woke" });
});

test("같은 것을 다시 받으면 두 번 깨우지 않음", async () => {
  const s = await setup();
  const body = JSON.stringify({ type: "message", entity: { chatId: "c2" } });
  expect(await s.send(body)).toEqual([202]);
  expect(await s.send(body)).toEqual([200]);
  expect(s.woke.length).toBe(1);
  expect(s.db.query("SELECT count, last_at IS NOT NULL AS t FROM hook").get()).toEqual({ count: 1, t: 1 });
});

test("같은 것이 동시에 두 번 와도 한 번만 저장 · 깨움", async () => {
  const s = await setup();
  const body = JSON.stringify({ type: "message", entity: { chatId: "c3" } });
  const r = await Promise.all([s.send(body, 1), s.send(body, 1)]);
  expect(r.flat().sort()).toEqual([200, 202]);
  expect(s.woke.length).toBe(1);
});
