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

const K1 = "a".repeat(32), K2 = "b".repeat(32);
function devs(db: ReturnType<typeof d1>, now: number) {
  return (id: string, owner: string, scope: string, o: { machine?: string | null; name?: string; engine_at?: number | null; created?: number; revoked?: number | null } = {}) =>
    db.raw.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, revoked_at, scope, engine_at, machine) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, owner, o.name ?? id, "[]", "h" + id, o.created ?? now, o.created ?? now, o.revoked ?? null, scope, o.engine_at ?? null, o.machine ?? null);
}
test("열쇠 적기: 꼴이 맞고 줄 값과 다를 때만 한 번 씀 · 같은 값 · 틀린 꼴 · 칸 없는 D1 은 안 씀", async () => {
  const db = d1(), now = Date.now(); devs(db, now)("x1", "m@example.com", "full");
  const writes: string[] = [], spy = { ...db, prepare: (sql: string) => { if (/^UPDATE device SET machine/.test(sql)) writes.push(sql); return db.prepare(sql); } } as unknown as D1Database;
  const row = (await D.deviceByHash(spy, "hx1"))!;
  assert.equal(row.machine, null, "옛 줄은 NULL");
  assert.equal(await D.noteMachine(spy, row, K1), true);
  assert.equal((db.raw.prepare("SELECT machine FROM device WHERE id = 'x1'").get() as { machine: string }).machine, K1);
  const again = (await D.deviceByHash(spy, "hx1"))!;
  assert.equal(await D.noteMachine(spy, again, K1), false, "같은 값이면 안 씀");
  for (const bad of [undefined, "", "A".repeat(32), "a".repeat(31), "a".repeat(33), "/etc/machine-id", "g".repeat(32)]) assert.equal(await D.noteMachine(spy, again, bad), false, `틀린 꼴 ${bad}`);
  assert.equal(await D.noteMachine(spy, { id: "x1", machine: undefined }, K2), false, "0087 전(칸 없음)이면 안 씀");
  assert.equal(writes.length, 1, "쓰기는 바뀐 한 번뿐");
  assert.equal(await D.noteMachine(spy, again, K2), true, "컴퓨터가 바뀌면(토큰을 옮김) 새 값");
  assert.equal(writes.length, 2);
});
test("열쇠 적기: 0087 가 아직인 D1 은 예전 질의로 기기를 찾고 · 적지 않음", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE device (id TEXT PRIMARY KEY, owner TEXT, name TEXT, tools TEXT, token_hash TEXT, scope TEXT, revoked_at INTEGER)");
  db.prepare("INSERT INTO device VALUES ('o1','m@example.com','n','[]','ho1','full',NULL)").run();
  const stmt = (sql: string, args: unknown[] = []): any => ({ bind: (...a: unknown[]) => stmt(sql, a), first: async () => { const r = db.prepare(sql).get(...(args as never[])); return r ? { ...(r as object) } : null; }, run: async () => db.prepare(sql).run(...(args as never[])) });
  const old = { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
  const r = (await D.deviceByHash(old, "ho1"))!;
  assert.equal(r.id, "o1"); assert.equal(r.machine, undefined);
  assert.equal(await D.noteMachine(old, r, K1), false);
});
test("기기 목록 묶기: 같은 사람 · 같은 컴퓨터 → 한 항목(이름은 상태 보내는 기기 · 둘 다 하는 일 · members), 기기 수 = 컴퓨터 수", async () => {
  const db = d1(), now = Date.now(), add = devs(db, now);
  add("hrn", "owner-a@example.com", "harness", { machine: K1, name: "owner-host harness", engine_at: now - 30_000, created: now - 1000 });
  add("srv", "owner-a@example.com", "full", { machine: K1, name: "owner-host (linux)", created: now - 5000 });
  add("mac", "owner-a@example.com", "full", { machine: K2, name: "mac" });
  add("old", "owner-a@example.com", "watch", { name: "옛 기기" });   // machine 없음 → 따로
  await D.putMetrics(db, { id: "srv", owner: "owner-a@example.com" }, { mem: { total_mb: 100, avail_mb: 50 } }, now);
  const L = await D.listDevices(db, ["owner-a@example.com", "owner-b@example.com"], now, { fold: true }) as any[];
  assert.equal(L.length, 3, "컴퓨터 셋(묶음 · mac · 옛 기기)");
  const g = L.find(d => d.members)!;
  assert.equal(g.id, "srv"); assert.equal(g.name, "owner-host (linux)", "이름은 상태 보내는 기기 먼저");
  assert.equal(g.scope, "full"); assert.equal(g.metrics.mem.avail_mb, 50); assert.equal(g.engine_at, now - 30_000, "엔진 시각은 묶음 안 가장 늦은 것");
  assert.deepEqual(g.roles.sort(), ["engine", "metrics"]);
  assert.deepEqual(g.members.map((m: any) => [m.id, m.scope, m.roles.join("+")]), [["srv", "full", "metrics"], ["hrn", "harness", "engine"]]);
  assert.equal("machine" in g || "owner" in g, false, "열쇠 · 메일은 화면에 안 나감");
  for (const d of L.filter(d => !d.members)) assert.equal("machine" in d || "owner" in d, false, "혼자인 줄도 열쇠 · 메일은 안 나감");
  assert.deepEqual(L.filter(d => !d.members).map(d => [d.id, d.roles.join("+")]).sort(), [["mac", "metrics"], ["old", "metrics"]], "혼자인 줄은 members 없이 그 줄 roles");
  assert.deepEqual(L.filter(d => !d.members).map(d => d.id).sort(), ["mac", "old"]);
  // 주인 메일 넷 = 한 사람: 다른 주인 메일로 승인한 같은 컴퓨터 줄도 묶음
  add("srv2", "owner-b@example.com", "ownercli", { machine: K1, name: "owner-host cli" });
  const g2 = (await D.listDevices(db, ["owner-a@example.com", "owner-b@example.com"], now, { fold: true }) as any[]).find(d => d.members)!;
  assert.deepEqual(g2.members.map((m: any) => m.id), ["srv", "srv2", "hrn"], "full → ownercli → harness 차례");
});
test("기기 목록 묶기: 남의 기기는 같은 열쇠여도 안 묶음 · 폐기된 줄 빠짐 · fold 없으면(CLI 목록) 줄마다 그대로", async () => {
  const db = d1(), now = Date.now(), add = devs(db, now);
  add("mine", "m@example.com", "full", { machine: K1 }); add("theirs", "x@example.com", "full", { machine: K1 });
  add("cut", "m@example.com", "full", { machine: K1, revoked: now });
  const mine = await D.listDevices(db, "m@example.com", now, { fold: true }) as any[];
  assert.deepEqual(mine.map(d => [d.id, !!d.members]), [["mine", false]], "내 줄 하나 — 남의 줄 · 폐기 줄과 안 묶임");
  // 같은 목록에 남의 owner 가 섞여 와도(부른 쪽 메일 밖) 사람 열쇠가 달라 안 묶음
  const mixed = D.foldMachines([
    { id: "a", owner: "m@example.com", machine: K1, name: "a", tools: "[]", scope: "full", created_at: 1, last_at: 1, engine_at: null, metrics_at: null, metrics: null, history: [] },
    { id: "b", owner: "x@example.com", machine: K1, name: "b", tools: "[]", scope: "harness", created_at: 1, last_at: 1, engine_at: 1, metrics_at: null, metrics: null, history: [] },
  ]) as any[];
  assert.deepEqual(mixed.map(d => [d.id, !!d.members]), [["a", false], ["b", false]]);
  add("hrn", "m@example.com", "harness", { machine: K1, engine_at: now });
  const raw = await D.listDevices(db, "m@example.com", now) as any[];
  assert.deepEqual(raw.map(d => d.id).sort(), ["hrn", "mine"], "CLI 목록 · 폐기 대상은 줄마다");
  assert.equal(raw.some(d => "members" in d || "machine" in d || "roles" in d || "owner" in d), false, "CLI 목록은 예전 꼴 그대로");
});

test("줄 하나인 맥 · 윈도우 회원 기기(엔진 · 감시가 한 토큰): 그 줄 roles 에 엔진 연결 · 상태 보내기 둘 다", async () => {
  const db = d1(), now = Date.now(), add = devs(db, now);
  add("mac", "m@example.com", "full", { machine: K1, name: "MacBook (macOS)", engine_at: now - 5000 });   // engine.ts hello 가 같은 줄에 engine_at
  add("win", "m@example.com", "full", { name: "PC (windows)", engine_at: now - 5000 });                   // 열쇠 전 옛 줄도 같은 규칙
  add("only", "m@example.com", "full", { machine: K2 });                                                    // 엔진 안 켠 기기
  await D.putMetrics(db, { id: "mac", owner: "m@example.com" }, { mem: { total_mb: 100, avail_mb: 50 } }, now);
  const L = await D.listDevices(db, "m@example.com", now, { fold: true }) as any[];
  const r = Object.fromEntries(L.map(d => [d.id, d.roles.join("+")]));
  assert.deepEqual(r, { mac: "engine+metrics", win: "engine+metrics", only: "metrics" });
  assert.equal(L.some(d => d.members), false);
});
