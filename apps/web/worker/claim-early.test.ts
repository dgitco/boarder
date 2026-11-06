import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./claim-early-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app, BoardSnap } = await import("./index.ts");
Math.random = () => 0.5;   // 확률적 오래된 rid 정리는 지연·SQL 비교에서 제외.

const MIG = new URL("../migrations/", import.meta.url);
// 가짜 D1 — batch 는 진짜 트랜잭션(하나라도 실패하면 전부 되돌림, rid UNIQUE 가 그 위에 섬). loseNext = 다음 batch 는 들어가고 답만 잃음(queue.ts lostDB 와 같은 장애)
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const queries: { sql: string; op: string }[] = [];
  const record = (sql: string, op: string) => queries.push({ sql, op });
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  // gate = 이 글을 담은 읽기는 waitFor 개가 모일 때까지 기다렸다 같이 풀림(동시 요청이 같은 「열린 카드」를 읽은 뒤 쓰는 경합)
  const st = { queries, delayRead: 0, events: [] as string[], loseNext: false, gate: "", waitFor: 0, parked: [] as (() => void)[] };
  const hold = (sql: string) => !st.gate || !sql.includes(st.gate) ? null : new Promise<void>(res => {
    st.parked.push(res); if (st.parked.length >= st.waitFor) { st.gate = ""; st.parked.splice(0).forEach(f => f()); }
  });
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => { record(sql, "all"); return { success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }; },
    first: async (col?: string) => { record(sql, "first"); if (sql === "SELECT data FROM node_setting WHERE owner = ?") { st.events.push("read:start"); if (st.delayRead) await new Promise(r => setTimeout(r, st.delayRead)); st.events.push("read:end"); } await hold(sql); const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => (record(sql, "run"), /\breturning\b/i.test(sql) ? { success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} } : run1(sql, args)),
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => {
      ss.forEach(s => record(s.sql, "batch"));
      db.exec("BEGIN");
      try {
        const out = ss.map(s => /^\s*select/i.test(s.sql) || /\breturning\b/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args));
        db.exec("COMMIT");
        if (st.loseNext) { st.loseNext = false; throw new Error("D1 응답 잃음(시험)"); }
        return out;
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },
    exec: async (sql: string) => { db.exec(sql); return { count: 1 }; },
  } as unknown as D1Database;
  return { db, D1, st };
}
// DO 이름표 — 같은 이름은 같은 칸(진짜 BoardSnap: rid 표 claim · done · release)
function snapNs() {
  const cells = new Map<string, any>();
  const ctx = () => { const s = new DatabaseSync(":memory:"); return {
    storage: { sql: { exec: (q: string, ...a: unknown[]) => { const p = s.prepare(q); if (/^\s*(select|with)/i.test(q)) { const rows = p.all(...(a as never[])); return { toArray: () => rows, rowsWritten: 0 }; } const r = p.run(...(a as never[])); return { toArray: () => [], rowsWritten: Number(r.changes) }; } } },
    getWebSockets: () => [], setWebSocketAutoResponse() {}, waitUntil() {}, blockConcurrencyWhile: (f: () => unknown) => f(),
  }; };
  // DO 부르기(RPC)는 늘 promise — 동기 메서드도
  const rpc = (o: any) => new Proxy(o, { get: (t, k) => typeof t[k] === "function" ? async (...a: unknown[]) => t[k](...a) : t[k] });
  return { idFromName: (n: string) => n, get: (n: string) => { if (!cells.has(n)) cells.set(n, rpc(new (BoardSnap as any)(ctx(), {}))); return cells.get(n); } };
}
// 엔진 DO(기기마다): 넣은 글만 적음
function engineNs(sent: { id: string; text: string }[]) {
  return { idFromName: (n: string) => n, get: () => ({ deliver: async (id: string, text: string) => { sent.push({ id, text }); return { sent: true }; }, drainCmds: async () => null }) };
}

const MEMBER = "member@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email = MEMBER) {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로 — D1 세션 확인 없이 들어감
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
function setup() {
  const { db, D1, st } = d1(), sent: { id: string; text: string }[] = [], T = Date.now();
  for (const f of ["write_queue", "write_chat_d1", "write_exec", "write_ledger"]) db.prepare("INSERT INTO f7_flag(name, on_at) VALUES (?, ?)").run(f, T);
  db.prepare("INSERT INTO owner_job_beat(id, at) VALUES (1, ?)").run(T);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devMember01", MEMBER, "member laptop", "", "h1", T, T, "full", T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, created_at) VALUES (?,?,?,?,?,?,?)").run("ew_main1", MEMBER, "devMember01", "main", "메인 봇", "idle", T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, created_at) VALUES (?,?,?,?,?,?,?)").run("ew_role1", MEMBER, "devMember01", "role", "일 창", "idle", T);
  db.prepare("INSERT INTO board_card(id, owner, win, question, choices, body, state, at, wid) VALUES (?,?,?,?,?,?,?,?,?)").run("1793300000.000001", MEMBER, "일 창", "어느 쪽?", JSON.stringify(["A", "B"]), "", "open", T, "ew_role1");
  const env = { DB: D1, SNAP: snapNs(), ENGINE: engineNs(sent), BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: "owner@example.test", PUBLIC_URL: "https://example.test" };
  const waits: Promise<unknown>[] = [];
  const post = async (path: string, body: unknown, email: string | null = MEMBER) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method: "POST", headers: { "content-type": "application/json", "x-hb": "1", "sec-fetch-site": "same-origin", cookie: email ? await cookie(email) : "" }, body: JSON.stringify(body) }), env, { waitUntil: (p: Promise<unknown>) => { waits.push(p.catch(() => {})); }, passThroughOnException() {} });
    await Promise.all(waits.splice(0));   // 뒷일(rid 칸 done · release · 엔진 넣기)까지 끝난 뒤
    return r;
  };
  return { db, st, sent, post, env };
}



const body = (rid: string) => ({ text: "합성 글 한 번만", channel: "primary", rid });
const count = (db: DatabaseSync) => (db.prepare("SELECT count(*) n FROM board_log WHERE owner=? AND text=?").get(MEMBER, body("").text) as any).n;
function claimControl(env: any, events: string[] = []) {
  const original = env.SNAP; let calls = 0;
  let mode: "normal" | "fail" | "old" = "normal", delay = 0;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(r => entered = r), gate = new Promise<void>(r => release = r);
  let held = false;
  env.SNAP = { ...original, get: (n: string) => new Proxy(original.get(n), { get: (t, k) => k === "claim" ? async (...a: any[]) => {
    calls++; events.push("claim:start"); entered();
    if (held) await gate;
    if (delay) await new Promise(r => setTimeout(r, delay));
    if (mode === "fail") throw new Error("합성 DO 장애");
    if (mode === "old") throw new Error("does not implement method claim");
    const result = await t.claim(...a); events.push("claim:end"); return result;
  } : t[k] }) };
  return { started, release, get calls() { return calls; }, hold() { held = true; }, fail() { mode = "fail"; }, old() { mode = "old"; }, delay(ms: number) { delay = ms; } };
}

test("같은 rid 순차 재전송은 글1·전달1·같은 응답", async () => {
  const { db, env, post, sent } = setup(); const ctl = claimControl(env);
  const a = await post("/api/chat", body("early-sequential-01"));
  const b = await post("/api/chat", body("early-sequential-01"));
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(b.headers.get("x-rid"), "replay"); assert.deepEqual(await a.json(), await b.json());
  assert.equal(count(db), 1); assert.equal(sent.length, 1); assert.equal(ctl.calls, 2);
});

test("claim 대기에는 읽기만, 동시 같은 rid도 글1·전달1", async () => {
  const { db, env, post, sent, st } = setup(); const ctl = claimControl(env, st.events); ctl.hold();
  const first = post("/api/chat", body("early-concurrent-01")); await ctl.started;
  await new Promise(r => setImmediate(r));
  assert.equal(count(db), 0); assert.equal(sent.length, 0);
  if (!process.env.CLAIM_BASELINE) assert.ok(st.events.includes("read:start"));
  ctl.release(); const second = post("/api/chat", body("early-concurrent-01"));
  const responses = await Promise.all([first, second]);
  assert.ok(responses.every(r => [200, 409].includes(r.status)));
  assert.equal(count(db), 1); assert.equal(sent.length, 1);
});

test("로그인 실패는 rid 칸을 선점하지 않음", async () => {
  const { db, env, post, sent, st } = setup(); const ctl = claimControl(env);
  const r = await post("/api/chat", body("early-no-auth-01"), null);
  assert.equal(r.status, 401); assert.equal(ctl.calls, 0); assert.equal(count(db), 0); assert.equal(sent.length, 0);
  assert.ok(!st.queries.some(q => q.sql === "SELECT data FROM node_setting WHERE owner = ?"));
  assert.equal((await post("/api/chat", body("early-no-auth-01"))).status, 200);
});

test("claim 실패는 기존 503·nostore·재시도 가능, 쓰기·전달 없음", async () => {
  const { db, env, post, sent } = setup(); const ctl = claimControl(env); ctl.fail();
  const r = await post("/api/chat", body("early-failure-01"));
  assert.equal(r.status, 503); assert.equal(r.headers.get("x-rid"), "nostore"); assert.equal(r.headers.get("x-retry-safe"), "1");
  assert.equal(count(db), 0); assert.equal(sent.length, 0);
});

test("옛 DO에 claim 메서드 없음: 기존 폴백 유지", async () => {
  const { db, env, post, sent } = setup(); const ctl = claimControl(env); ctl.old();
  assert.equal((await post("/api/chat", body("early-old-method-01"))).status, 200);
  assert.equal((await post("/api/chat", body("early-old-method-01"))).status, 200);
  assert.equal(count(db), 1); assert.equal(sent.length, 1);
});

test("새 Worker·옛 Worker가 같은 DO를 쓰면 글1·전달1", async () => {
  const { db, env, post, sent } = setup();
  const original = env.SNAP, cell = original.get(original.idFromName(`rid:${MEMBER}@apac`));
  // 옛 Worker의 같은 claim RPC가 처리 중인 상태.
  assert.equal((await cell.claim("early-mixed-worker-01", "/api/chat")).state, "new");
  const busy = await post("/api/chat", body("early-mixed-worker-01"));
  assert.equal(busy.status, 409); assert.equal(count(db), 0); assert.equal(sent.length, 0);
  await cell.release("early-mixed-worker-01");
  assert.equal((await post("/api/chat", body("early-mixed-worker-01"))).status, 200);
  assert.equal((await cell.claim("early-mixed-worker-01", "/api/chat")).state, "done");
  assert.equal(count(db), 1); assert.equal(sent.length, 1);
});

test("claim 90ms와 D1 읽기 90ms 합성: 정상 글 질의·쓰기 목록과 total", async t => {
  const { db, env, post, sent, st } = setup(); st.delayRead = 90;
  const ctl = claimControl(env, st.events); ctl.delay(90);
  const t0 = performance.now(); const r = await post("/api/chat", body("early-latency-01")); const elapsed = performance.now() - t0;
  assert.equal(r.status, 200); assert.equal(count(db), 1); assert.equal(sent.length, 1);
  assert.equal(st.queries.filter(q => q.sql === "SELECT data FROM node_setting WHERE owner = ?").length, 3);
  if (!process.env.CLAIM_BASELINE) assert.ok(st.events.indexOf("read:start") < st.events.indexOf("claim:end"));
  t.diagnostic("CLAIM_MEASURE " + JSON.stringify({ baseline: !!process.env.CLAIM_BASELINE, elapsed, events: st.events, queries: st.queries }));
});

function ownerSetup() {
  const ctx = setup(), original = ctx.env.SNAP;
  const cfg = { body: JSON.stringify({ channels: { primary: "C0", dgit: "C1" } }), etag: "early-cfg", at: Date.now(), checked: Date.now() };
  ctx.env.SNAP = { ...original, get: (n: string) => new Proxy(original.get(n), { get: (t, k) => k === "get" ? async () => { ctx.st.events.push("cfg:read"); return cfg; } : t[k] }) };
  return ctx;
}

test("주인도 claim 뒤에만 글·전달 할 일을 한 번 확정", async () => {
  const { db, env, post, st } = ownerSetup(); const ctl = claimControl(env, st.events); ctl.hold();
  const first = post("/api/chat", body("early-owner-01"), "owner@example.test"); await ctl.started;
  await new Promise(r => setImmediate(r));
  assert.equal((db.prepare("SELECT count(*) n FROM wl_talk_msg").get() as any).n, 0);
  assert.equal((db.prepare("SELECT count(*) n FROM owner_job").get() as any).n, 0);
  if (!process.env.CLAIM_BASELINE) assert.ok(st.events.includes("cfg:read"));
  ctl.release(); const a = await first, b = await post("/api/chat", body("early-owner-01"), "owner@example.test");
  assert.equal(a.status, 200); assert.equal(a.headers.get("x-f7"), "chat-d1"); assert.equal(b.headers.get("x-rid"), "replay");
  assert.equal((db.prepare("SELECT count(*) n FROM wl_talk_msg").get() as any).n, 1);
  assert.equal((db.prepare("SELECT count(*) n FROM owner_job").get() as any).n, 1);
});

test("주인 claim 실패에도 글·전달 할 일 없음", async () => {
  const { db, env, post } = ownerSetup(); const ctl = claimControl(env); ctl.fail();
  const r = await post("/api/chat", body("early-owner-fail-01"), "owner@example.test");
  assert.equal(r.status, 503); assert.equal((db.prepare("SELECT count(*) n FROM wl_talk_msg").get() as any).n, 0);
  assert.equal((db.prepare("SELECT count(*) n FROM owner_job").get() as any).n, 0);
});


test("주인 동시 같은 rid는 글1·전달 할 일1", async () => {
  const { db, env, post } = ownerSetup(); const ctl = claimControl(env); ctl.hold();
  const a = post("/api/chat", body("early-owner-concurrent-01"), "owner@example.test"); await ctl.started;
  const b = post("/api/chat", body("early-owner-concurrent-01"), "owner@example.test");
  await new Promise(r => setImmediate(r)); ctl.release();
  assert.ok((await Promise.all([a, b])).every(r => [200, 409].includes(r.status)));
  assert.equal((db.prepare("SELECT count(*) n FROM wl_talk_msg").get() as any).n, 1);
  assert.equal((db.prepare("SELECT count(*) n FROM owner_job").get() as any).n, 1);
});

test("스레드 등 별도 동작은 미리 읽지 않고 기존 순서 유지", async () => {
  const { env, post, st } = setup(); const ctl = claimControl(env, st.events); ctl.hold();
  const p = post("/api/chat", { ...body("early-thread-01"), thread: "1793300000.000001" }); await ctl.started;
  await new Promise(r => setImmediate(r)); assert.ok(!st.events.includes("read:start"));
  ctl.release(); await p;
});

test("rid 없는 글은 claim·선행 읽기 없이 기존 처리", async () => {
  const { env, post, st, sent } = setup(); const ctl = claimControl(env, st.events);
  assert.equal((await post("/api/chat", { text: "rid 없이", channel: "primary" })).status, 200);
  assert.equal(ctl.calls, 0); assert.equal(sent.length, 1);
  assert.equal(st.queries.filter(q => q.sql === "SELECT data FROM node_setting WHERE owner = ?").length, 3);
});


test("선행 준비가 잘못된 text로 실패해도 claim을 버리지 않고 기존 재시도 가능 응답", async () => {
  const { env, post } = setup();
  const malformed = { ...body("early-bad-text-01"), text: { toString: 0 } };
  for (let i = 0; i < 2; i++) {
    const r = await post("/api/chat", malformed);
    assert.equal(r.status, 503); assert.equal(r.headers.get("x-retry-safe"), "1"); assert.equal(r.headers.get("x-rid"), "new");
  }
});
