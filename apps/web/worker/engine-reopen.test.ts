import { test, mock } from "node:test";
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
  eng = new (Engine as any)(ctx, { DB: D1, PUBLIC_URL: "https://example.test", ALLOW_EMAILS: "owner@example.test", SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) } });
  const say = async (o: object) => { await eng.webSocketMessage(ws, JSON.stringify(o)); await Promise.all(waits.splice(0)); };
  const stateOf = () => (db.prepare("SELECT state FROM engine_window WHERE id = ?").get(WID) as { state: string }).state;
  return { db, dev, eng, say, stateOf };
}

test("주차 창 다시 열기의 답을 잃고(끊김) 데몬이 다시 붙은 뒤 — 다음 글이 그 창에 닿음", async () => {
  const { dev, eng, say, stateOf } = setup();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    dev.loseAnswer = true;
    const first = eng.deliver(WID, "[Boarder chat] 첫 글").then(() => null, (e: Error) => e);
    await new Promise(r => setImmediate(r));
    mock.timers.tick(60_000);   // 서버 cmd 60초 → 「엔진 답 없음」
    assert.ok(await first, "첫 글은 답을 잃어 실패로 끝남(이건 맞음)");
  } finally { mock.timers.reset(); }
  assert.deepEqual(dev.got.map(g => g.verb), ["reopen"], "기기는 창을 다시 열었음(첫 글이 첫 메시지)");
  dev.up = true;
  const windows = [{ id: "ew_mainbot0001", engine: "tmux", state: "idle" }, { id: WID, engine: "tmux", state: "idle" }];
  await say({ type: "hello", v: 1, primary: true, cli: "0.1.4", host: "laptop", os: "linux", default: "tmux", engines: { tmux: { caps: null } }, windows });
  await say({ type: "state", full: true, windows });
  // 사람이 그 창에 다시 씀
  const r = await eng.deliver(WID, "[Boarder chat] 두 번째 글").then((x: unknown) => x, (e: Error) => e);
  assert.ok(!(r instanceof Error), `두 번째 글이 실패하면 안 됨: ${r instanceof Error ? r.message : ""}`);
  assert.ok(dev.got.some(g => g.verb === "send" && g.text === "[Boarder chat] 두 번째 글"), "두 번째 글이 그 창에 들어가야 함");
  assert.notEqual(stateOf(), "parked", "기기에 떠 있는 창이 parked 로 남으면 안 됨");
});

test("같은 소켓에서 다시 열기 답만 잃음(60초 넘김) — 다음 글이 그 창에 닿고, 앞 글은 두 번 안 넣음", async () => {
  const { dev, eng, stateOf } = setup();
  // 기기는 창을 열었지만 답이 60초 안에 안 옴
  const realSend = (eng as any).cmd.bind(eng);
  let lose = true;
  (eng as any).cmd = (verb: string, args: any, ms?: number) => {
    if (verb === "reopen" && lose) { lose = false; dev.open.add(args.id); dev.got.push({ verb, id: args.id, text: args.text }); return Promise.reject(Object.assign(new Error("엔진 답 없음"), { code: 1 })); }
    return realSend(verb, args, ms);
  };
  assert.ok(await eng.deliver(WID, "[Boarder chat] 첫 글").then(() => null, (e: Error) => e) || true);
  const r = await eng.deliver(WID, "[Boarder chat] 두 번째 글").then((x: unknown) => x, (e: Error) => e);
  assert.ok(!(r instanceof Error), `두 번째 글이 실패하면 안 됨: ${r instanceof Error ? r.message : ""}`);
  assert.ok(dev.got.some(g => g.verb === "send" && g.text === "[Boarder chat] 두 번째 글"), "두 번째 글이 그 창에 들어가야 함");
  assert.equal(dev.got.filter(g => g.text === "[Boarder chat] 첫 글").length, 1, "첫 글은 다시 열기의 첫 메시지로 한 번만");
  assert.notEqual(stateOf(), "parked");
});

test("flush 다시 열기가 「이미 떠 있음」 · 바쁨이면 — 그 창 밀린 글 순서 그대로", async () => {
  const { db, dev, eng } = setup();
  dev.open.add(WID);   // 앞선 다시 열기는 기기에 창을 열었고 그 답만 잃어 줄은 parked 로 되돌아감
  const realCmd = (eng as any).cmd.bind(eng);
  // 창은 일하는 중: 상태 = busy, 글 넣기 = 바쁨(code 2)
  (eng as any).cmd = (verb: string, args: any, ms?: number) => verb === "state" ? Promise.resolve({ id: args.id, state: "busy" })
    : verb === "send" ? Promise.reject(Object.assign(new Error("busy"), { code: 2 })) : realCmd(verb, args, ms);
  await eng.ctx.storage.put("pending", [{ id: WID, text: "글 1", at: Date.now() - 2000, k: "k1" }, { id: WID, text: "글 2", at: Date.now() - 1000, k: "k2" }]);
  await eng.flush();
  assert.deepEqual(((await eng.ctx.storage.get("pending")) as { text: string }[]).map(p => p.text), ["글 1", "글 2"], "밀린 글 순서가 뒤집히면 안 됨");
  // 창이 쉬게 되면 그 순서대로 들어감
  (eng as any).cmd = realCmd;
  db.prepare("UPDATE engine_window SET state = 'idle' WHERE id = ?").run(WID);
  await eng.flush();
  assert.deepEqual(dev.got.filter(g => g.verb === "send" && g.id === WID).map(g => g.text), ["글 1", "글 2"]);
  assert.deepEqual((await eng.ctx.storage.get("pending")) as unknown[], []);
});

test("flush 다시 열기가 「이미 떠 있음」이고 기기가 그 글을 자기 줄에 세우면 — 서버 줄에서 빠지고 다시 안 보냄", async () => {
  const { dev, eng } = setup();
  dev.open.add(WID);
  const realCmd = (eng as any).cmd.bind(eng);
  (eng as any).cmd = (verb: string, args: any, ms?: number) => verb === "state" ? Promise.resolve({ id: args.id, state: "busy" })
    : verb === "send" ? (dev.got.push({ verb, id: args.id, text: args.text }), Promise.resolve({ ok: true, queued: true })) : realCmd(verb, args, ms);
  await eng.ctx.storage.put("pending", [{ id: WID, text: "글 1", at: Date.now() - 1000, k: "k1" }]);
  await eng.flush();
  assert.deepEqual((await eng.ctx.storage.get("pending")) as unknown[], [], "기기 줄에 선 글은 서버 줄에 남지 않음");
  await eng.flush();
  assert.equal(dev.got.filter(g => g.verb === "send" && g.text === "글 1").length, 1, "같은 글을 기기에 한 번만 보냄");
});
