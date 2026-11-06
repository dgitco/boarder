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

const OWNER = "owner@example.test", DEV = "devHarness01", PANE = "ew_pane7", T = Date.now();
const tick = () => new Promise(r => setImmediate(r));
function setup() {
  const { db, D1 } = d1();
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run(DEV, OWNER, "owner harness", "", "h1", T, T, "harness", T);
  // 가짜 어댑터: send 는 그 판에 넣음(busyOnce 에 든 판은 한 번 「바쁨」)
  const dev = { got: [] as string[], args: [] as any[], up: true, busyOnce: new Set<string>() };
  const store = new Map<string, unknown>();
  let eng: any;
  const ws = {
    get readyState() { return dev.up ? 1 : 3; },
    deserializeAttachment: () => ({ device: DEV, owner: OWNER, at: T }),
    close() {},
    send(raw: string) {
      if (!dev.up) throw new Error("closed");
      const m = JSON.parse(raw), a = m.args || {};
      let ans: object;
      if (m.verb === "send") {
        if (dev.busyOnce.delete(a.id)) ans = { ok: false, code: 2, error: "busy" };
        else { dev.got.push(a.text); dev.args.push(a); ans = { ok: true, result: { to: "%7" } }; }
      } else ans = { ok: true, result: {} };
      queueMicrotask(() => eng.webSocketMessage(ws, JSON.stringify({ id: m.id, ...ans })));
    },
  };
  const ctx = {
    setWebSocketAutoResponse() {},
    getWebSockets: () => (dev.up ? [ws] : []),
    waitUntil: () => {},
    storage: { get: async (k: string) => structuredClone(store.get(k)), put: async (k: string, v: unknown) => { store.set(k, structuredClone(v)); }, delete: async (k: string) => store.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} },
  };
  store.set("who", { device: DEV, owner: OWNER, harness: true });
  eng = new (Engine as any)(ctx, { DB: D1, PUBLIC_URL: "https://example.test", ALLOW_EMAILS: OWNER, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) } });
  const say = async (o: object) => { await eng.webSocketMessage(ws, JSON.stringify(o)); for (let i = 0; i < 20; i++) await tick(); };
  const hpending = () => (store.get("hpending") as { text: string }[] | undefined) || [];
  return { dev, eng, say, hpending };
}
const HELLO = { type: "hello", v: 1, cli: "harness", host: "owner-host", os: "linux", windows: [{ id: PANE, state: "idle", name: "lead" }] };

test("하네스: 꺼진 동안 줄 선 글 뒤에 보낸 글이, 다시 붙은 직후(hello 전) 앞 글보다 먼저 들어가지 않음", async () => {
  const { dev, eng, say } = setup();
  dev.up = false;
  assert.deepEqual(await eng.hsend(PANE, "글 1", { queue: true }), { queued: true });
  dev.up = true;   // 어댑터 소켓이 붙음 — hello 는 아직
  await eng.hsend(PANE, "글 2", { queue: true });
  await say(HELLO);   // hello → hflush
  assert.deepEqual(dev.got, ["글 1", "글 2"], "보낸 순서대로 들어가야 함");
});

test("하네스: 판이 바빠 줄 선 글이 있으면, 쉬게 된 뒤 상태 보고 전에 온 새 글이 앞지르지 않음", async () => {
  const { dev, eng, say } = setup();
  dev.busyOnce.add(PANE);
  assert.deepEqual(await eng.hsend(PANE, "글 1", { queue: true }), { queued: true });   // 바쁨 → 줄
  await eng.hsend(PANE, "글 2", { queue: true });   // 판은 이제 쉼 — 상태 보고는 아직
  await say({ type: "event", id: PANE, state: "idle" });
  assert.deepEqual(dev.got, ["글 1", "글 2"], "보낸 순서대로 들어가야 함");
});

test("하네스: 줄이 빈 정상 흐름은 그대로 바로 넣음(sent)", async () => {
  const { dev, eng, hpending } = setup();
  const r = await eng.hsend(PANE, "바로 글", { queue: true });
  assert.equal(r.sent, true);
  assert.deepEqual(dev.got, ["바로 글"]);
  assert.deepEqual(hpending(), []);
});

test("하네스: 보드 세션 글(owner)은 어댑터에 owner 를 넘김 — 바빠 줄 선 뒤 넣을 때도 · 시험 글 · 다른 글엔 안 붙음", async () => {
  const { dev, eng, say } = setup();
  await eng.hsend(PANE, "바로 Owner 글", { queue: true, owner: true });
  dev.busyOnce.add(PANE);
  assert.deepEqual(await eng.hsend(PANE, "줄 선 Owner 글", { queue: true, owner: true }), { queued: true });
  await say({ type: "event", id: PANE, state: "idle" });
  await eng.hsend(PANE, "리드끼리 넘김 글", { queue: true });
  await eng.hsend(PANE, "시험 글", { queue: true, owner: true, test: true });
  assert.deepEqual(dev.args.map(a => [a.text, !!a.owner]), [["바로 Owner 글", true], ["줄 선 Owner 글", true], ["리드끼리 넘김 글", false], ["시험 글", false]]);
});
