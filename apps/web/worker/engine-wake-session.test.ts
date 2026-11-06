import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (s === "better-auth" || s === "better-auth/plugins") return { url: "data:text/javascript,export const betterAuth = () => ({}); export const emailOTP = () => ({});", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { Engine } = await import("./engine.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { const out = []; for (const s of ss) out.push(await s.run()); return out; } } as unknown as D1Database };
}

const MEMBER = "member@example.test", DEV = "devMember01", WID = "ew_waitsession1", H = 3_600_000, T = Date.now();
function setup(entries: [string, number][]) {
  const { db, D1 } = d1();
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, "owner@example.test", T);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run(DEV, MEMBER, "member laptop", "", "h1", T, T, "full", T);
  db.prepare("INSERT INTO engine_owner(owner, rules, updated_at) VALUES (?,?,?)").run(MEMBER, JSON.stringify({ wake_min: 10, close_min: 30, park_min: 600, one_goal: true }), T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(WID, MEMBER, DEV, "role", "r_1", "일 창", "idle", T - 3 * H);
  const log = db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)");
  for (const [kind, ago] of entries) log.run(MEMBER, "일 창", kind, kind, null, T - ago * 60_000, WID);
  const dev = { open: new Set<string>([WID]), got: [] as { verb: string; id?: string; text?: string }[], up: true };
  const store = new Map<string, unknown>(), waits: Promise<unknown>[] = [];
  let eng: any;
  const ws = {
    get readyState() { return dev.up ? 1 : 3; },
    deserializeAttachment: () => ({ device: DEV, owner: MEMBER, at: T }),
    close() {},
    send(raw: string) {
      if (!dev.up) throw new Error("closed");
      const m = JSON.parse(raw), a = m.args || {}, id = a.id || a.spec?.id;
      queueMicrotask(async () => {
        let ans: object;
        if (m.verb === "send") {
          if (!dev.open.has(id)) ans = { ok: false, code: 4, error: "no such window" };
          else { dev.got.push({ verb: "send", id, text: a.text }); ans = { ok: true, result: { ok: true } }; }
        } else ans = { ok: true, result: {} };
        await eng.webSocketMessage(ws, JSON.stringify({ id: m.id, ...ans }));
      });
    },
  };
  const ctx = {
    setWebSocketAutoResponse() {},
    getWebSockets: () => [ws],
    waitUntil: (p: Promise<unknown>) => { waits.push(Promise.resolve(p).catch(() => {})); },
    storage: { get: async (k: string) => structuredClone(store.get(k)), put: async (k: string, v: unknown) => { store.set(k, structuredClone(v)); },
      delete: async (k: string) => store.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} },
  };
  store.set("who", { device: DEV, owner: MEMBER, harness: false });
  eng = new (Engine as any)(ctx, { DB: D1, PUBLIC_URL: "https://example.test", ALLOW_EMAILS: "owner@example.test", SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) } });
  const stateOf = () => (db.prepare("SELECT state FROM engine_window WHERE id = ?").get(WID) as { state: string }).state;
  return { db, dev, eng, stateOf, T };
}
const woke = (s: ReturnType<typeof setup>) => s.dev.got.some(g => g.verb === "send" && g.id === WID);

test("끝 → 세션 끝 = 주차(깨움 아님) — 리뷰 P1", async () => {
  const s = setup([["done", 50], ["session_end", 40]]);
  const r = await s.eng.rules(DEV, MEMBER, s.T);
  assert.ok(r.includes(`park-done ${WID}`), `주차 안 함: ${JSON.stringify(r)}`);
  assert.equal(s.stateOf(), "parked");
  assert.ok(!woke(s), "끝난 창을 깨움");
});

test("끝 → 기다림(Stop 훅) → 세션 끝 = 주차 — 리뷰 P1", async () => {
  const s = setup([["done", 50], ["waiting", 45], ["session_end", 40]]);
  const r = await s.eng.rules(DEV, MEMBER, s.T);
  assert.ok(r.includes(`park-done ${WID}`), `주차 안 함: ${JSON.stringify(r)}`);
  assert.equal(s.stateOf(), "parked");
  assert.ok(!woke(s), "끝난 창을 깨움");
});

// 기다림 → 세션 끝: 사람이 기다리던 것이 세션 종료로 풀림 → 다시 깨움
test("기다림 → 세션 끝 = 깨움 — 리뷰 P2", async () => {
  const s = setup([["waiting", 50], ["session_end", 40]]);
  const r = await s.eng.rules(DEV, MEMBER, s.T);
  assert.ok(r.includes(`wake ${WID}`), `안 깨움: ${JSON.stringify(r)}`);
  assert.equal(s.stateOf(), "idle");
});

// 막힘 → 세션 시작: 자동 요약 SessionStart 가 사람이 풀어야 할 막힘을 조용히 풀면 안 됨(세션 줄은 기다림만 풂)
test("막힘 → 세션 시작 = 안 깨움(막힘은 세션 줄로 안 풀림) — 기술장 결정", async () => {
  const s = setup([["blocked", 50], ["session_start", 40]]);
  const r = await s.eng.rules(DEV, MEMBER, s.T);
  assert.ok(!r.includes(`wake ${WID}`), `막힌 창을 깨움: ${JSON.stringify(r)}`);
  assert.equal(s.stateOf(), "idle");
});

for (const session of ["session_start", "session_end"] as const) {
  test(`막힘 → 기다림(Stop 훅) → ${session} = 안 깨움(막힘 유지) — 리뷰 P1`, async () => {
    const s = setup([["blocked", 60], ["waiting", 50], [session, 40]]);
    const r = await s.eng.rules(DEV, MEMBER, s.T);
    assert.ok(!r.includes(`wake ${WID}`), `막힌 창을 깨움: ${JSON.stringify(r)}`);
    assert.equal(s.stateOf(), "idle");
  });
}

test("기다림만 남은 창은 예전처럼 안 깨움(세션 줄 없음)", async () => {
  const s = setup([["waiting", 50]]);
  const r = await s.eng.rules(DEV, MEMBER, s.T);
  assert.ok(!r.includes(`wake ${WID}`), `깨움: ${JSON.stringify(r)}`);
});

test("세션 끝만 남은 창은 깨움(끝난 일도 기다림도 없음)", async () => {
  const s = setup([["session_end", 40]]);
  const r = await s.eng.rules(DEV, MEMBER, s.T);
  assert.ok(r.includes(`wake ${WID}`), `안 깨움: ${JSON.stringify(r)}`);
});

test("세션 시작 → 기다림(세션이 더 앞) = 안 깨움 — 앞 세션 줄은 기다림을 안 풂", async () => {
  const s = setup([["session_start", 60], ["progress", 55], ["waiting", 50]]);
  const r = await s.eng.rules(DEV, MEMBER, s.T);
  assert.ok(!r.includes(`wake ${WID}`), `기다리는 창을 깨움: ${JSON.stringify(r)}`);
});
test("세션 끝 → 진행 5분 전 = 아직 안 깨움(조용 5분) · 진행 20분 전 = 깨움", async () => {
  const a = setup([["session_end", 60], ["progress", 5]]);
  assert.ok(!(await a.eng.rules(DEV, MEMBER, a.T)).includes(`wake ${WID}`), "5분 만에 깨움");
  const b = setup([["session_end", 60], ["progress", 20]]);
  assert.ok((await b.eng.rules(DEV, MEMBER, b.T)).includes(`wake ${WID}`), "20분 조용한데 안 깨움");
});
test("기다림 → 세션 시작 3분 전 = 아직 안 깨움(조용은 세션 줄부터)", async () => {
  const s = setup([["waiting", 50], ["session_start", 3]]);
  const r = await s.eng.rules(DEV, MEMBER, s.T);
  assert.ok(!r.includes(`wake ${WID}`), `3분 만에 깨움: ${JSON.stringify(r)}`);
});
