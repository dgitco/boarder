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

const MEMBER = "member@example.test", DEV = "devMember01", WID = "ew_parkedrole01", T = Date.now();
// 가짜 데몬: tmux 어댑터처럼 — open · reopen 은 같은 id 가 열려 있으면 「window already open」(code 1), send 는 열린 창에만
function setup() {
  const { db, D1 } = d1();
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, "owner@example.test", T);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run(DEV, MEMBER, "member laptop", "", "h1", T, T, "full", T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, created_at) VALUES (?,?,?,?,?,?,?)").run("ew_mainbot0001", MEMBER, DEV, "main", "Primary", "idle", T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, state_at, handle, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(WID, MEMBER, DEV, "role", "r_1", "일 창", "parked", T, JSON.stringify({ engine: "tmux", id: WID, name: "일 창", cwd: "~/boarder/r_1", session_id: "00000000-0000-4000-8000-000000000001" }), T);
  const dev = { open: new Set<string>(["ew_mainbot0001"]), got: [] as { verb: string; id?: string; text?: string }[], loseAnswer: false, up: true };
  const store = new Map<string, unknown>(), waits: Promise<unknown>[] = [], bumps = { n: 0 };
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
        if (m.verb === "reopen" || m.verb === "open") {
          if (dev.open.has(id)) ans = { ok: false, code: 1, error: "window already open" };
          else { dev.open.add(id); dev.got.push({ verb: m.verb, id, text: a.text }); ans = { ok: true, result: { id, session_id: a.handle?.session_id } }; }
        } else if (m.verb === "send") {
          if (!dev.open.has(id)) ans = { ok: false, code: 4, error: "no such window" };
          else { dev.got.push({ verb: "send", id, text: a.text }); ans = { ok: true, result: { ok: true } }; }
        } else if (m.verb === "state") ans = { ok: true, result: { id, state: dev.open.has(id) ? "idle" : "none" } };
        else if (m.verb === "close") { dev.open.delete(id); ans = { ok: true, result: { ok: true } }; }
        else ans = { ok: true, result: {} };
        if (dev.loseAnswer) { dev.loseAnswer = false; dev.up = false; return; }   // 창은 열었는데 그 답을 보내기 전에 끊김
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
  eng = new (Engine as any)(ctx, { DB: D1, PUBLIC_URL: "https://example.test", ALLOW_EMAILS: "owner@example.test", SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => { bumps.n++; return 0; } }) } });
  const say = async (o: object) => { await eng.webSocketMessage(ws, JSON.stringify(o)); await Promise.all(waits.splice(0)); };
  const stateOf = () => (db.prepare("SELECT state FROM engine_window WHERE id = ?").get(WID) as { state: string }).state;
  return { db, dev, eng, say, stateOf, bumps };
}

test("1분마다 오는 창 목록이 그대로면 화면 알림을 안 보내고, 한 창이라도 바뀌면 보냄", async () => {
  const { db, say, bumps } = setup();
  const windows = [{ id: "ew_mainbot0001", engine: "tmux", state: "idle" }];
  await say({ type: "state", full: true, windows });   // 이미 idle — 그대로
  assert.equal(bumps.n, 0, "그대로인 목록은 알림 0");
  const at0 = (db.prepare("SELECT state_at FROM engine_window WHERE id = ?").get("ew_mainbot0001") as { state_at: number | null }).state_at;
  await say({ type: "state", full: true, windows: [{ id: "ew_mainbot0001", engine: "tmux", state: "busy" }] });
  assert.equal(bumps.n, 1, "바뀌면 알림 한 번");
  assert.equal((db.prepare("SELECT state FROM engine_window WHERE id = ?").get("ew_mainbot0001") as { state: string }).state, "busy");
  await say({ type: "state", full: true, windows: [{ id: "ew_mainbot0001", engine: "tmux", state: "busy" }] });
  assert.equal(bumps.n, 1, "다시 그대로면 알림 없음");
  assert.notEqual(at0, undefined);
});

test("확인창 · 한도 글만 바뀌어도 알림 · 줄 고침(상태는 그대로)", async () => {
  const { db, say, bumps } = setup();
  await say({ type: "state", windows: [{ id: "ew_mainbot0001", state: "idle", dialog: "trust" }] });
  assert.equal(bumps.n, 1);
  assert.equal((db.prepare("SELECT dialog FROM engine_window WHERE id = ?").get("ew_mainbot0001") as { dialog: string }).dialog, "trust");
  await say({ type: "state", windows: [{ id: "ew_mainbot0001", state: "idle", dialog: "trust" }] });
  assert.equal(bumps.n, 1, "같은 확인창이면 그대로");
  await say({ type: "state", windows: [{ id: "ew_mainbot0001", state: "idle" }] });
  assert.equal(bumps.n, 2, "확인창이 닫힘(빈 값)도 바뀜");
  await say({ type: "state", windows: [{ id: "ew_mainbot0001", state: "idle", limit: "한도 5시" }] });
  assert.equal(bumps.n, 3, "한도 글 새로 옴");
  await say({ type: "state", windows: [{ id: "ew_mainbot0001", state: "idle" }] });
  assert.equal(bumps.n, 3, "한도 글이 안 오면 예전 글을 지우지 않음(COALESCE) — 바뀐 것 없음");
});

test("주차된 창의 상태 보고는 전처럼 줄을 안 고치고 알림도 없음", async () => {
  const { say, stateOf, bumps } = setup();
  await say({ type: "state", windows: [{ id: WID, state: "idle" }] });
  assert.equal(stateOf(), "parked");
  assert.equal(bumps.n, 0);
});
