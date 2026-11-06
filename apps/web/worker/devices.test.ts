// node --test --no-warnings --experimental-transform-types apps/web/worker/devices.test.ts — 기기 감시 값(devices.ts), 메모리 SQLite(migrations 전부)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as D from "./devices.ts";

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])).map(r => ({ ...(r as object) })) }),
    first: async () => { const r = db.prepare(sql).get(...(args as never[])); return r ? { ...(r as object) } : null; },
    run: async () => { db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: 1 } }; },
  });
  return { raw: db, prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => /^\s*select/i.test(s.sql ?? "") ? s.all() : s.all().catch(() => s.run()))) } as unknown as D1Database & { raw: DatabaseSync };
}

test("주인 계정 덧붙임(계정 글자 · 이름 · 기울기 · 바닥 예상 · 크레딧) · Codex 는 받고, 모르는 칸 · 토큰은 버림", () => {
  const m = D.cleanMetrics({
    accounts: [{ email: "A@example.com", status: "ok", p5: 10, p7: 93, r7: "2026-11-09T23:59:59+00:00", acct: "a", name: "개인", rate: 2.93, out_at: "2026-11-04T10:44:19+00:00",
      credits: { limit: 250, used: 250.07, left: 0, expires: "2026-11-05T07:59:00+00:00", token: "sk-x" }, accessToken: "sk-ant-x", dir: "/home/x/.claude" },
      { email: "b@example.com", acct: "bb", rate: 500 }],
    codex: { plan: "pro", p7: 1, r7: "2026-11-11T06:36:00.000Z", balance: 1000.5, at: "2026-11-04T08:05:24.143Z", token: "x" },
  });
  const a = m.accounts[0] as Record<string, unknown>;
  assert.equal(a.acct, "a"); assert.equal(a.name, "개인"); assert.equal(a.rate, 2.9); assert.equal(a.out_at, "2026-11-04T10:44:19+00:00");
  assert.deepEqual(a.credits, { limit: 250, used: 250.1, left: 0, expires: "2026-11-05T07:59:00+00:00" });
  assert.equal(a.accessToken, undefined); assert.equal(a.dir, undefined);
  const b = m.accounts[1] as Record<string, unknown>;
  assert.equal(b.acct, "bb"); assert.equal(b.rate, undefined);   // 계정 글자는 자유(길이만 제한) · 범위 밖 값은 버림
  assert.equal((D.cleanMetrics({ accounts: [{ acct: "회사-work.2 " + "x".repeat(100) }, { acct: 7 }, { acct: "\u0000\u0001" }] }).accounts as Record<string, unknown>[]).map(a => a.acct === undefined ? a.acct : String(a.acct).length).join(), "30,,", "길이 제한 · 글자 아닌 값 · 빈 값은 칸 없음");
  assert.deepEqual(m.codex, { plan: "pro", p7: 1, r7: "2026-11-11T06:36:00.000Z", balance: 1000.5, at: "2026-11-04T08:05:24.143Z" });
  assert.equal("codex" in D.cleanMetrics({ accounts: [] }), false);
});

test("기기 목록: 메일 여럿이면 그 메일들 기기 모두(주인 메일 여럿), 하나면 그 메일만 · 폐기된 것은 뺌", async () => {
  const db = d1(), now = Date.now();
  const add = (id: string, owner: string, revoked: number | null = null) => db.raw.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, revoked_at, scope) VALUES (?,?,?,?,?,?,?,?,?)").run(id, owner, id, "[]", "h" + id, now, now, revoked, "watch");
  add("srv", "owner-b@example.com"); add("hrn", "owner-a@example.com"); add("old", "owner-c@example.com", now); add("mem", "m@example.com");
  await D.putMetrics(db, { id: "srv", owner: "owner-b@example.com" }, { mem: { total_mb: 100, avail_mb: 50 }, accounts: [{ acct: "c", name: "DGit", p7: 50 }] }, now);
  const own = await D.listDevices(db, ["owner-a@example.com", "owner-c@example.com", "owner-b@example.com", "owner-d@example.com"], now);
  assert.deepEqual(own.map(d => d.id).sort(), ["hrn", "srv"]);
  assert.equal((own.find(d => d.id === "srv")!.metrics as any).accounts[0].acct, "c");
  assert.deepEqual((await D.listDevices(db, "m@example.com", now)).map(d => d.id), ["mem"]);
  assert.deepEqual((await D.listDevices(db, "owner-c@example.com", now)).map(d => d.id), []);
});
test("이력은 마지막 이력 줄에서 4분 30초마다 — 1분마다 올려도 5번에 한 번, 5분 감시 타이머는 늘 쌓음 · 최신 값은 늘 바뀜", async () => {
  const db = d1(), t0 = 1_790_000_000_000, n = (id: string) => (db.raw.prepare("SELECT count(*) n FROM device_metric_hist WHERE device_id = ?").get(id) as { n: number }).n;
  for (let i = 0; i < 15; i++) await D.putMetrics(db, { id: "m1", owner: "m@example.com" }, { mem: { total_mb: 100, avail_mb: i } }, t0 + i * 60_000);
  assert.equal(n("m1"), 3, "1분 × 15 = 이력 3줄(0 · 5 · 10분)");
  assert.equal(JSON.parse((db.raw.prepare("SELECT data FROM device_metric WHERE device_id = 'm1'").get() as { data: string }).data).mem.avail_mb, 14, "최신 값은 마지막 것");
  for (let i = 0; i < 4; i++) await D.putMetrics(db, { id: "w1", owner: "m@example.com" }, { mem: { total_mb: 100, avail_mb: i } }, t0 + i * 280_000);
  assert.equal(n("w1"), 4, "5분(흔들림 -20초) 타이머는 매번");
});
