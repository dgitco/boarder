import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", e); return new Response("{}", { status: 500 }); });

const MIG = new URL("../migrations/", import.meta.url);
// 가짜 D1 — batch 는 진짜 트랜잭션. failOnce = 그 글로 시작하는 쓰기 하나를 한 번 실패시킴(D1 일시 오류)
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const st = { failOnce: "" };
  const trip = (sql: string) => { if (st.failOnce && sql.trimStart().startsWith(st.failOnce)) { st.failOnce = ""; throw new Error("D1 일시 오류(시험)"); } };
  const run1 = (sql: string, args: unknown[]) => { trip(sql); const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => run1(sql, args),
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => {
      db.exec("BEGIN");
      try {
        const out = ss.map(s => /^\s*select/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args));
        db.exec("COMMIT"); return out;
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },
  } as unknown as D1Database;
  return { db, D1, st };
}

const MEMBER = "member@example.test", OTHER = "other@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(MEMBER: string) {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${MEMBER}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${MEMBER}|${exp}|${sig}`)}`;
}
const K1 = "a".repeat(32), K2 = "b".repeat(32);
const sha = async (t: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
function setup() {
  const { db, D1 } = d1();
  const writes: string[] = [];
  const D1spy = { ...D1, prepare: (sql: string) => { if (/^UPDATE device SET machine/.test(sql)) writes.push(sql); return D1.prepare(sql); } } as unknown as D1Database;
  for (const m of [MEMBER, OTHER]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, "owner@example.test", Date.now());
  const SNAP = { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) };
  const env = { DB: D1spy, SNAP, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: "owner@example.test", PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const get = async (path: string, h: Record<string, string>) => { const r = await app.fetch(new Request("https://example.test" + path, { headers: h }), env, ctx); let j: any = {}; try { j = await r.json(); } catch {} return { status: r.status, j }; };
  const add = async (id: string, owner: string, name: string, o: { engine_at?: number | null } = {}) => {
    const tok = "bxd_" + id.padEnd(40, "z"), now = Date.now();
    db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, owner, name, "[]", await sha(tok), now, now, "full", o.engine_at ?? null);
    return tok;
  };
  const machine = (id: string) => (db.prepare("SELECT machine FROM device WHERE id = ?").get(id) as { machine: string | null }).machine;
  return { db, writes, get, add, machine };
}
const dev = (tok: string, key?: string) => ({ authorization: `Bearer ${tok}`, ...(key ? { "x-boarder-machine": key } : {}) });

test("deviceOf: 기기 토큰 요청의 열쇠를 바뀐 때만 한 번 적음 · 틀린 꼴 · 없는 열쇠는 안 적음 · 인증은 그대로", async () => {
  const { writes, get, add, machine } = setup();
  const t = await add("dev1", MEMBER, "MacBook (macOS)");
  assert.equal((await get("/api/device/me", dev(t))).status, 200); assert.equal(machine("dev1"), null, "열쇠 없는 옛 CLI");
  assert.equal((await get("/api/device/me", dev(t, "NOT-A-KEY"))).status, 200); assert.equal(machine("dev1"), null, "틀린 꼴은 버림");
  assert.equal((await get("/api/device/me", dev(t, K1))).status, 200); assert.equal(machine("dev1"), K1);
  for (let i = 0; i < 3; i++) await get("/api/device/me", dev(t, K1));
  assert.equal(writes.length, 1, "같은 열쇠 다시 = 안 씀(요청마다 쓰지 않음)");
  await get("/api/device/me", dev(t, K2)); assert.equal(machine("dev1"), K2); assert.equal(writes.length, 2, "컴퓨터가 바뀌면 한 번 더");
  assert.equal((await get("/api/device/me", dev("bxd_" + "q".repeat(40), K1))).status, 401, "모르는 토큰은 그대로 401 · 안 씀"); assert.equal(writes.length, 2);
});

test("/api/me/devices: 같은 사람 · 같은 열쇠 두 줄 → 카드 한 장(members), 남의 기기 · 다른 컴퓨터는 따로, 줄 하나 기기도 roles", async () => {
  const { get, add } = setup();
  const now = Date.now();
  const eng = await add("eng1", MEMBER, "desk engine", { engine_at: now - 5000 }), wat = await add("wat1", MEMBER, "desk (linux)");
  const lap = await add("lap1", MEMBER, "laptop", { engine_at: now - 5000 }), oth = await add("oth1", OTHER, "남의 기기");
  for (const [t, k] of [[eng, K1], [wat, K1], [lap, K2], [oth, K1]] as const) assert.equal((await get("/api/device/me", dev(t, k))).status, 200);
  const r = await get("/api/me/devices", { cookie: await cookie(MEMBER) });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const ds = r.j.devices as any[];
  assert.equal(ds.length, 2, "컴퓨터 둘(묶음 · 노트북) — 남의 기기는 안 보임 · 안 묶임");
  const g = ds.find(d => d.members)!;
  assert.deepEqual(g.members.map((m: any) => m.id).sort(), ["eng1", "wat1"]);
  assert.deepEqual([...g.roles].sort(), ["engine", "metrics"]);
  assert.deepEqual(ds.find(d => d.id === "lap1").roles, ["engine", "metrics"], "줄 하나(엔진 · 감시 한 토큰)도 둘 다");
  assert.equal(ds.some(d => "machine" in d || "owner" in d), false, "열쇠 · 메일은 화면에 안 나감");
  const o = (await get("/api/me/devices", { cookie: await cookie(OTHER) })).j.devices as any[];
  assert.deepEqual(o.map(d => [d.id, !!d.members]), [["oth1", false]]);
});
