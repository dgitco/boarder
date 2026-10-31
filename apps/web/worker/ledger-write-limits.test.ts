import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const LW = await import("./ledger-write.ts");

const MIG = new URL("../migrations/", import.meta.url);
const bytes = (s: string) => Buffer.byteLength(s, "utf8");
function limits(sql: string, args: unknown[]) {
  if (bytes(sql) > 100_000) throw new Error("D1_ERROR: statement too long: SQLITE_TOOBIG");
  if (args.length > 100) throw new Error(`D1_ERROR: too many SQL variables at offset ${sql.length}: SQLITE_ERROR`);
  if (args.some(a => typeof a === "string" && bytes(a) > 2_000_000)) throw new Error("D1_ERROR: string or blob too big: SQLITE_TOOBIG");
}
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  db.exec("INSERT INTO f7_flag(name, on_at) VALUES ('write_ledger', 1)");
  const st = { down: false };
  const exec1 = (sql: string, args: unknown[]) => {
    limits(sql, args);
    const p = db.prepare(sql);
    if (/^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) return { success: true, results: p.all(...(args as never[])), meta: {} };
    const r = p.run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => exec1(sql, args),
    first: async (col?: string) => { const r = exec1(sql, args).results[0] as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    run: async () => exec1(sql, args),
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => {
      if (st.down) throw new Error("D1_ERROR: Network connection lost.");
      db.exec("BEGIN");
      try { const out = ss.map(s => exec1(s.sql, s.args)); db.exec("COMMIT"); return out; }
      catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },
  };
  return { D1: D1 as unknown as D1Database, db, st };
}
const wait = (p: Promise<unknown>) => { p.catch(() => {}); };
const ins = (msg: string) => ({ sql: "INSERT INTO log(at, pane, win, kind, msg) VALUES (?, 'p', 'w', 'k', ?)", args: [1, msg] });

test("D1 한도 안: 그대로 들어감", async () => {
  const { D1, db } = d1();
  const [s, b] = await LW.write(D1, wait, { tag: "lim-ok-0001", stmts: [ins("안녕")] }) as [number, any];
  assert.equal(s, 200, JSON.stringify(b));
  assert.equal((db.prepare("SELECT count(*) n FROM wl_log").get() as { n: number }).n, 1);
});

test("문장이 100KB 를 넘음(SQLITE_TOOBIG): 다시 보내도 안 되니 503 이 아니라 sql(400 → 예전 길) · 아무것도 안 들어감 · 매듭은 claimed", async () => {
  const { D1, db } = d1();
  const long = { sql: `INSERT INTO log(at, pane, win, kind, msg) VALUES (1, 'p', 'w', 'k', '${"가".repeat(40_000)}')` };   // 4만 자 = 12만 바이트(글자 수 20만 검사는 통과)
  for (let i = 0; i < 2; i++) {   // 같은 꼬리표로 다시 보내도 같은 답
    const [s, b] = await LW.write(D1, wait, { tag: "lim-long-001", stmts: [long] }) as [number, any];
    assert.equal(s, 400, JSON.stringify(b));
    assert.equal(b.code, "sql");
  }
  assert.equal((db.prepare("SELECT count(*) n FROM wl_log").get() as { n: number }).n, 0);
  const [cs, cb] = await LW.claim(D1, { tag: "lim-long-001", n: 1 }) as [number, any];
  assert.equal(cs, 200); assert.equal(cb.claimed, true);
});

test("값이 2MB 를 넘음(SQLITE_TOOBIG): sql(400 → 예전 길) · 같은 묶음의 다른 문장도 안 들어감", async () => {
  const { D1, db } = d1();
  const [s, b] = await LW.write(D1, wait, { tag: "lim-big-0001", stmts: [ins("앞 문장"), ins("y".repeat(2_100_000))] }) as [number, any];
  assert.equal(s, 400, JSON.stringify(b));
  assert.equal(b.code, "sql");
  assert.equal((db.prepare("SELECT count(*) n FROM wl_log").get() as { n: number }).n, 0);
});

test("묶는 값 100개 넘음: sql(예전과 같음)", async () => {
  const { D1 } = d1();
  const sql = `INSERT INTO log(at, pane, win, kind, msg) SELECT 1, 'p', 'w', 'k', ${Array(101).fill("?").join(" || ")}`;
  const [s, b] = await LW.write(D1, wait, { tag: "lim-vars-001", stmts: [{ sql, args: Array(101).fill("a") }] }) as [number, any];
  assert.equal(s, 400, JSON.stringify(b));
  assert.equal(b.code, "sql");
});

test("망 끊김은 그대로 transient(503 → 같은 꼬리표로 다시)", async () => {
  const { D1, st } = d1();
  st.down = true;
  const [s, b] = await LW.write(D1, wait, { tag: "lim-down-001", stmts: [ins("끊김")] }) as [number, any];
  assert.equal(s, 503, JSON.stringify(b));
  assert.equal(b.code, "transient");
});
