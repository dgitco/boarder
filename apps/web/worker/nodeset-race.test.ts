import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");

const MIG = new URL("../migrations/", import.meta.url);
type Park = { when: (sql: string, args: unknown[]) => boolean; until: Promise<unknown> } | null;
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const st = { park: null as Park };
  const hold = async (sql: string, args: unknown[]) => { const p = st.park; if (p && p.when(sql, args)) { st.park = null; await p.until; } };
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { await hold(sql, args); const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => { await hold(sql, args); return /\breturning\b/i.test(sql) ? { success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} } : run1(sql, args); },
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => {
      db.exec("BEGIN");
      try {
        const out = ss.map(s => /^\s*select/i.test(s.sql) || /\breturning\b/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args));
        db.exec("COMMIT"); return out;
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },
    exec: async (sql: string) => { db.exec(sql); return { count: 1 }; },
  } as unknown as D1Database;
  return { db, D1, st };
}

const MEMBER = "member@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie() {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${MEMBER}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${MEMBER}|${exp}|${sig}`)}`;
}
function setup(data?: object) {
  const { db, D1, st } = d1();
  if (data) db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(MEMBER, JSON.stringify(data), Date.now());
  const SNAP = { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) };   // 화면 칸 알리기는 빈 것
  const env = { DB: D1, SNAP, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: "owner@example.test", PUBLIC_URL: "https://example.test" };
  const post = async (body: unknown) => {
    const waits: Promise<unknown>[] = [];
    const r = await app.fetch(new Request("https://example.test/api/me/nodeset", { method: "POST", headers: { "content-type": "application/json", "x-hb": "1", "sec-fetch-site": "same-origin", cookie: await cookie() }, body: JSON.stringify(body) }), env, { waitUntil: (p: Promise<unknown>) => { waits.push(p.catch(() => {})); }, passThroughOnException() {} });
    await Promise.all(waits);
    return r;
  };
  const saved = () => JSON.parse((db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(MEMBER) as { data: string }).data);
  return { st, post, saved };
}
const isSettingWrite = (sql: string) => /^\s*INSERT INTO node_setting/i.test(sql);
const later = () => { let go!: () => void; const p = new Promise<void>(r => { go = r; }); return { p, go }; };

test("설정 › 노드: 두 칸을 잇달아 바꿔 두 저장이 겹쳐도 — 두 값이 다 남음", async () => {
  const { st, post, saved } = setup();
  const gate = later();
  st.park = { when: isSettingWrite, until: gate.p };   // 첫 저장(check_min)은 쓰기 직전에 섬
  const a = post({ values: { check_min: 60 } });
  await new Promise(r => setTimeout(r, 20));
  const b = await post({ values: { split_at: 5 } });   // 둘째 저장(split_at)이 먼저 끝남
  assert.equal(b.status, 200);
  gate.go(); assert.equal((await a).status, 200);
  const v = saved();
  assert.equal(v.split_at, 5, "둘째 저장의 split_at 이 첫 저장의 옛 값(3)으로 덮이면 안 됨");
  assert.equal(v.check_min, 60);
});

test("설정 › 노드: 단위를 바꾸는 동안 숫자 칸 저장이 겹쳐도 — 바꾼 단위가 옛 단위로 안 돌아감", async () => {
  const { st, post, saved } = setup({ unit: "agent", unit_by: "auto" });
  const gate = later();
  st.park = { when: (sql, args) => isSettingWrite(sql) && args.some(x => String(x).includes("archive_h")), until: gate.p };   // 숫자 칸 저장이 쓰기 직전에 섬
  const a = post({ values: { archive_h: 24 } });
  await new Promise(r => setTimeout(r, 20));
  const u = await post({ unit: "goal" });   // 그 사이 단위 바꿈(다시 묶기까지) 끝남
  assert.equal(u.status, 200);
  gate.go(); assert.equal((await a).status, 200);
  const v = saved();
  assert.equal(v.unit, "goal", "숫자 칸 저장이 읽어 둔 옛 unit(agent)으로 덮으면 화면 · 묶기는 goal 인데 저장은 agent");
  assert.equal(v.unit_by, "me");
  assert.equal(v.archive_h, 24);
});

test("설정 › 노드: 숫자 칸을 저장하는 동안 단위 바꾸기가 겹쳐도 — 저장한 숫자가 안 사라짐", async () => {
  const { st, post, saved } = setup({ unit: "agent", unit_by: "auto" });
  const gate = later();
  st.park = { when: (sql, args) => isSettingWrite(sql) && args.some(x => String(x).includes("goal")), until: gate.p };   // 단위 바꾸기(setUnit)가 쓰기 직전에 섬
  const u = post({ unit: "goal" });
  await new Promise(r => setTimeout(r, 20));
  const a = await post({ values: { check_min: 120 } });
  assert.equal(a.status, 200);
  gate.go(); assert.equal((await u).status, 200);
  const v = saved();
  assert.equal(v.check_min, 120, "setUnit 이 읽어 둔 옛 data 로 통째로 덮으면 방금 저장한 숫자가 사라짐");
  assert.equal(v.unit, "goal");
});

test("설정 › 노드: 저장 답은 지금 값 전부(보낸 칸 + 저장돼 있던 칸 + 처음 값)", async () => {
  const { post, saved } = setup({ unit: "agent", rename_h: 12 });
  const r = await post({ values: { check_min: 9999, move_h: "x" } });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json() as { values: unknown }).values, { check_min: 1440, split_at: 3, move_h: 24, rename_h: 12, archive_h: 6 });
  assert.equal(saved().unit, "agent");
});
