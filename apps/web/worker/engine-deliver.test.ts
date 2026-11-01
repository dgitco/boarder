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

const MEMBER = "member@example.test", DEV = "devMember01", MAIN = "ew_mainbot0001", ROLE = "ew_roleidle001", STARTING = "ew_rolestart01", T = Date.now();
const tick = () => new Promise(r => setImmediate(r));
function setup() {
  const { db, D1 } = d1();
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, "owner@example.test", T);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run(DEV, MEMBER, "member laptop", "", "h1", T, T, "full", T);
  const win = db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, state_at, handle, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const h = (id: string, n: number) => JSON.stringify({ engine: "tmux", id, name: id, cwd: "~/boarder/x", session_id: `00000000-0000-4000-8000-00000000000${n}` });
  win.run(MAIN, MEMBER, DEV, "main", null, "Primary", "idle", T, h(MAIN, 1), T);
  win.run(ROLE, MEMBER, DEV, "role", "r_1", "일 창", "idle", T, h(ROLE, 2), T);
  win.run(STARTING, MEMBER, DEV, "role", "r_2", "뜨는 창", "starting", T, h(STARTING, 3), T);
  // 가짜 데몬: send 는 열린 창에만(없으면 code 4), busyOnce 에 든 창은 한 번 「바쁨」(code 2), hold 면 답을 release() 때까지 붙잡음
  const dev = { open: new Set<string>([MAIN, ROLE, STARTING]), got: [] as { verb: string; id?: string; text?: string }[], up: true, hold: false, held: [] as (() => Promise<void>)[], busyOnce: new Set<string>() };
  const store = new Map<string, unknown>(), waits: Promise<unknown>[] = [];
  let eng: any;
  const ws = {
    get readyState() { return dev.up ? 1 : 3; },
    deserializeAttachment: () => ({ device: DEV, owner: MEMBER, at: T }),
    close() {},
    send(raw: string) {
      if (!dev.up) throw new Error("closed");
      const m = JSON.parse(raw), a = m.args || {}, id = a.id || a.spec?.id;
      let ans: object;
      if (m.verb === "reopen" || m.verb === "open") {
        if (dev.open.has(id)) ans = { ok: false, code: 1, error: "window already open" };
        else { dev.open.add(id); dev.got.push({ verb: m.verb, id, text: a.text }); ans = { ok: true, result: { id, session_id: a.handle?.session_id } }; }
      } else if (m.verb === "send") {
        if (!dev.open.has(id)) ans = { ok: false, code: 4, error: "no such window" };
        else if (dev.busyOnce.delete(id)) ans = { ok: false, code: 2, error: "busy" };
        else { dev.got.push({ verb: "send", id, text: a.text }); ans = { ok: true, result: { ok: true } }; }
      } else if (m.verb === "state") ans = { ok: true, result: { id, state: dev.open.has(id) ? "idle" : "none" } };
      else if (m.verb === "close") { dev.open.delete(id); ans = { ok: true, result: { ok: true } }; }
      else ans = { ok: true, result: {} };
      const reply = () => eng.webSocketMessage(ws, JSON.stringify({ id: m.id, ...ans }));
      if (dev.hold) dev.held.push(reply); else queueMicrotask(reply);
    },
  };
  const ctx = {
    setWebSocketAutoResponse() {},
    getWebSockets: () => [ws],
    waitUntil: (p: Promise<unknown>) => { waits.push(Promise.resolve(p).catch(() => {})); },
    storage: { get: async (k: string) => structuredClone(store.get(k)), put: async (k: string, v: unknown) => { store.set(k, structuredClone(v)); }, delete: async (k: string) => store.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} },
  };
  store.set("who", { device: DEV, owner: MEMBER, harness: false });
  eng = new (Engine as any)(ctx, { DB: D1, PUBLIC_URL: "https://example.test", ALLOW_EMAILS: "owner@example.test", SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) } });
  const say = async (o: object) => { await eng.webSocketMessage(ws, JSON.stringify(o)); await Promise.all(waits.splice(0)); };
  const release = async () => { dev.hold = false; while (dev.held.length) { await dev.held.shift()!(); await tick(); } };
  const pending = () => (store.get("pending") as { id: string; text: string }[] | undefined) || [];
  const sends = (id: string) => dev.got.filter(g => g.id === id).map(g => g.text);
  return { db, dev, eng, store, say, release, pending, sends };
}
const HELLO = { type: "hello", v: 1, primary: true, cli: "0.1.4", host: "laptop", os: "linux", default: "tmux", engines: { tmux: { caps: null } }, windows: [{ id: MAIN, state: "idle" }, { id: ROLE, state: "idle" }, { id: STARTING, state: "starting" }] };

test("엔진이 꺼진 동안 밀린 글 뒤에 쓴 글이, 다시 붙은 직후(hello 전) 앞 글보다 먼저 들어가지 않음", async () => {
  const { dev, eng, say, sends } = setup();
  dev.up = false;
  assert.deepEqual(await eng.deliver(ROLE, "글 1"), { queued: true });
  dev.up = true;   // 데몬 소켓이 붙음(fetch) — hello 는 아직
  await eng.deliver(ROLE, "글 2");
  await say(HELLO);   // hello → flush
  assert.deepEqual(sends(ROLE), ["글 1", "글 2"], "쓴 순서대로 들어가야 함");
});

test("flush 가 도는 동안 줄 선 글이 flush 끝에 덮여 사라지지 않음", async () => {
  const { dev, eng, release, pending, sends } = setup();
  dev.up = false; await eng.deliver(ROLE, "밀린 글"); dev.up = true;
  dev.hold = true;
  const f = eng.flush();
  await tick(); await tick();
  assert.deepEqual(await eng.deliver(STARTING, "뜨는 창 글"), { queued: true });
  await release(); await f;
  assert.deepEqual(sends(ROLE), ["밀린 글"]);
  assert.ok(pending().some(p => p.text === "뜨는 창 글"), `flush 중 줄 선 글이 남아야 함: ${JSON.stringify(pending())}`);
});

test("flush 두 번이 겹쳐도(hello · 상태 · 알람) 같은 밀린 글을 두 번 넣지 않음", async () => {
  const { dev, eng, release, sends } = setup();
  dev.up = false; await eng.deliver(ROLE, "밀린 글"); dev.up = true;
  dev.hold = true;
  const a = eng.flush(), b = eng.flush();
  await tick(); await tick();
  await release(); await Promise.all([a, b]);
  assert.deepEqual(sends(ROLE), ["밀린 글"], "한 번만");
});

test("같은 창 밀린 글 중 앞 글이 잠깐 바쁨이면 뒷글이 앞질러 들어가지 않음", async () => {
  const { dev, eng, say, sends, pending } = setup();
  dev.up = false; await eng.deliver(ROLE, "글 1"); await eng.deliver(ROLE, "글 2"); dev.up = true;
  dev.busyOnce.add(ROLE);
  await eng.flush();
  assert.deepEqual(sends(ROLE), [], "앞 글이 바쁘면 뒷글도 기다림");
  assert.deepEqual(pending().map(p => p.text), ["글 1", "글 2"]);
  await say({ type: "event", id: ROLE, state: "idle" });
  assert.deepEqual(sends(ROLE), ["글 1", "글 2"]);
});

test("밀린 글을 넣으려는데 창이 기기에서 사라졌으면(code 4) 글을 버리지 않고 다시 열며 넣음", async () => {
  const { db, dev, eng, pending } = setup();
  dev.up = false; await eng.deliver(ROLE, "밀린 글"); dev.up = true;
  dev.open.delete(ROLE);   // tmux 판이 죽음 — 서버 줄은 아직 idle
  await eng.flush();
  const reached = dev.got.some(g => g.id === ROLE && g.verb === "reopen" && g.text === "밀린 글");
  assert.ok(reached || pending().some(p => p.text === "밀린 글"), `글이 조용히 사라짐: got=${JSON.stringify(dev.got)} pending=${JSON.stringify(pending())}`);
  assert.ok(reached, "다시 열며 그 글을 첫 메시지로 넣어야 함(deliver 와 같게)");
  assert.equal((db.prepare("SELECT state FROM engine_window WHERE id = ?").get(ROLE) as { state: string }).state, "starting");
});

test("6시간 넘게 못 넣은 밀린 글은 버리되 보드에 남김(조용히 사라지지 않음)", async () => {
  const { db, eng, store, pending } = setup();
  store.set("pending", [{ id: ROLE, text: "[Boarder chat] 오래된 글", at: Date.now() - 7 * 3600_000 }]);
  await eng.flush();
  assert.deepEqual(pending(), []);
  const line = db.prepare("SELECT text FROM board_log WHERE owner = ? AND kind = 'sys' AND wid = ?").get(MEMBER, ROLE) as { text: string } | undefined;
  assert.ok(line && /못 넣/.test(line.text) && line.text.includes("오래된 글"), `보드 줄이 있어야 함: ${JSON.stringify(line)}`);
});
