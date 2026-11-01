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
const HANDLE = JSON.stringify({ engine: "tmux", id: WID, name: "일 창", cwd: "~/boarder/r_1", session_id: "00000000-0000-4000-8000-000000000001" });
// 가짜 데몬: open · reopen 은 같은 id 가 열려 있으면 「window already open」(code 1), send 는 열린 창에만(없으면 code 4)
function setup(state: string) {
  const { db, D1 } = d1();
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, "owner@example.test", T);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run(DEV, MEMBER, "member laptop", "", "h1", T, T, "full", T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, created_at) VALUES (?,?,?,?,?,?,?)").run("ew_mainbot0001", MEMBER, DEV, "main", "Primary", "idle", T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, state_at, handle, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(WID, MEMBER, DEV, "role", "r_1", "일 창", state, T, HANDLE, T);
  const dev = { open: new Set<string>(["ew_mainbot0001"]), got: [] as { verb: string; id?: string; text?: string }[], loseOn: "" as string, up: true };
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
        if (dev.loseOn === m.verb) { dev.loseOn = ""; dev.up = false; return; }   // 해 놓고 그 답을 보내기 전에 끊김
        await eng.webSocketMessage(ws, JSON.stringify({ id: m.id, ...ans }));
      });
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
  const pending = () => (store.get("pending") as { id: string; text: string }[] | undefined) || [];
  const board = () => db.prepare("SELECT text FROM board_log WHERE wid = ? AND kind = 'sys'").all(WID) as { text: string }[];
  return { db, dev, eng, store, say, pending, board };
}

const TEXT = "[Boarder chat] 밀린 글";
async function loseThenReconnect(s: ReturnType<typeof setup>) {
  const { dev, eng, say } = s;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const f = eng.flush();
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    mock.timers.tick(60_000);   // 서버 cmd 60초 → 「엔진 답 없음」
    await f;
  } finally { mock.timers.reset(); }
  assert.deepEqual(dev.got.filter(g => g.verb === "reopen").map(g => g.text), [TEXT], "기기는 창을 다시 열며 그 글을 첫 메시지로 넣었음");
  dev.up = true;
  const windows = [{ id: "ew_mainbot0001", engine: "tmux", state: "idle" }, { id: WID, engine: "tmux", state: "idle" }];
  await say({ type: "hello", v: 1, primary: true, cli: "0.1.7", host: "laptop", os: "linux", default: "tmux", engines: { tmux: { caps: null } }, windows });
  await say({ type: "state", full: true, windows });
  await eng.flush();   // 다음 알람
}

test("주차 창에 밀린 글: flush 의 다시 열기 답을 잃으면 다시 붙은 뒤 같은 글을 또 넣지 않음", async () => {
  const s = setup("parked");
  s.store.set("pending", [{ id: WID, text: TEXT, at: Date.now(), k: "k1" }]);
  s.dev.loseOn = "reopen";
  await loseThenReconnect(s);
  assert.equal(s.dev.got.filter(g => g.text === TEXT).length, 1, `같은 글이 두 번 들어가면 안 됨: ${JSON.stringify(s.dev.got)}`);
  assert.equal(s.pending().length, 0, "들어갔을 수 있는 글이 줄에 남으면 안 됨");
  assert.ok(s.board().some(b => b.text.includes("확인하지 못했어요")), "못 넣었을 수 있다는 줄은 보드에 남음");
});

test("기기에서 사라진 창(send 4)에 밀린 글: flush 의 다시 열기 답을 잃으면 다시 붙은 뒤 같은 글을 또 넣지 않음", async () => {
  const s = setup("idle");   // 줄은 쉼인데 기기엔 창이 없음(재부팅 등)
  s.store.set("pending", [{ id: WID, text: TEXT, at: Date.now(), k: "k1" }]);
  s.dev.loseOn = "reopen";
  await loseThenReconnect(s);
  assert.equal(s.dev.got.filter(g => g.text === TEXT).length, 1, `같은 글이 두 번 들어가면 안 됨: ${JSON.stringify(s.dev.got)}`);
  assert.equal(s.pending().length, 0, "들어갔을 수 있는 글이 줄에 남으면 안 됨");
});

test("정상 흐름: 다시 열기를 기기가 거절한(답이 온, 안 들어간) 글은 줄에 남았다가 다시 붙으면 한 번 들어감", async () => {
  const s = setup("parked");
  s.store.set("pending", [{ id: WID, text: TEXT, at: Date.now(), k: "k1" }]);
  // 다시 열기를 보내자마자 기기가 「바쁨」으로 거절(답은 옴) → 줄에 남아야 함
  const real = s.eng.cmd.bind(s.eng); let once = true;
  s.eng.cmd = (verb: string, args: any, ms?: number) => {
    if (verb === "reopen" && once) { once = false; return Promise.reject(Object.assign(new Error("잠깐 바쁨"), { code: 2 })); }
    if (verb === "state" && !once && !s.dev.open.has(WID)) return Promise.resolve({ state: "none" });
    return real(verb, args, ms);
  };
  await s.eng.flush();
  assert.equal(s.pending().length, 1, "답이 온 실패(안 들어감)는 줄에 남음");
  await s.eng.flush();
  assert.equal(s.dev.got.filter(g => g.text === TEXT).length, 1);
  assert.equal(s.pending().length, 0);
});
