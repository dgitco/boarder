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
const { primarySend, primaryTarget, LOST_LINE } = await import("./primary-send.ts");

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

const sysLines = (db: any) => (db.prepare("SELECT text, wid FROM board_log WHERE kind = 'sys' ORDER BY id").all() as { text: string; wid: string }[]).map(r => ({ ...r }));
const windowDied = (dev: any) => dev.open.delete(WID);   // 새 창이 뜨자마자 끝남 — 기기 목록 · 상태에 없음
const LATE = 10 * 60_000 + 1;

test("다시 열기는 ok 인데 창이 죽음: 정해진 시간 뒤 시스템 줄 · gone(다음 글이 다시 엶) · 줄은 한 번만", async () => {
  const { db, dev, eng, stateOf } = setup();
  assert.deepEqual(await eng.deliver(WID, "[Boarder chat] 사라질 뻔한 글"), { reopened: true });
  windowDied(dev);
  await eng.checkReopens(Date.now() + 1000);
  assert.deepEqual(sysLines(db), [], "아직 시간 안 됨 — 뜨는 중일 수 있음");
  await eng.checkReopens(Date.now() + LATE);
  const lines = sysLines(db);
  assert.equal(lines.length, 1); assert.match(lines[0].text, /「일 창」.*안 들어갔어요/); assert.equal(lines[0].wid, WID);
  assert.equal(stateOf(), "gone", "다음 글이 다시 열게");
  await eng.checkReopens(Date.now() + LATE * 2);
  assert.equal(sysLines(db).length, 1, "같은 글로 줄이 또 안 남음");
  await eng.deliver(WID, "[Boarder chat] 다시 보낸 글");
  assert.equal(dev.got.filter(g => g.verb === "reopen").at(-1)!.text, "[Boarder chat] 다시 보낸 글");
});
test("다시 연 창이 떠서 상태를 올리면(쉼 · 일함) 글은 들어간 것 — 줄 없음", async () => {
  for (const state of ["idle", "busy", "background"]) {
    const { db, eng, say } = setup();
    await eng.deliver(WID, "[Boarder chat] 글");
    await say({ type: "state", windows: [{ id: WID, state }] });
    await eng.checkReopens(Date.now() + LATE);
    assert.deepEqual(sysLines(db), [], state);
  }
});
test("상태 보고를 놓쳐도(바로 그 시각에 물어봄) 창이 살아 있으면 줄 없음", async () => {
  const { db, eng } = setup();
  await eng.deliver(WID, "[Boarder chat] 글");
  await eng.checkReopens(Date.now() + LATE);
  assert.deepEqual(sysLines(db), []);
});
test("엔진이 뜨는 중이라고만 답하면 기다렸다가, 끝내 안 뜨면 줄", async () => {
  const { db, eng } = setup();
  await eng.deliver(WID, "[Boarder chat] 글");
  const real = (eng as any).cmd.bind(eng);
  (eng as any).cmd = (verb: string, args: any, ms?: number) => verb === "state" ? Promise.resolve({ id: args.id, state: "starting" }) : real(verb, args, ms);
  await eng.checkReopens(Date.now() + 4 * 60_000);
  assert.deepEqual(sysLines(db), [], "아직 뜨는 중");
  await eng.checkReopens(Date.now() + LATE);
  assert.equal(sysLines(db).length, 1);
});
test("데몬이 다시 붙었는데 그 창이 없음(hello): 바로 줄", async () => {
  const { db, dev, eng, say, stateOf } = setup();
  await eng.deliver(WID, "[Boarder chat] 글");
  windowDied(dev);
  await say({ type: "hello", v: 1, primary: true, cli: "0.1.4", host: "laptop", os: "linux", default: "tmux", engines: { tmux: { caps: null } }, windows: [{ id: "ew_mainbot0001", engine: "tmux", state: "idle" }] });
  assert.equal(stateOf(), "gone");
  assert.equal(sysLines(db).filter(l => l.wid === WID).length, 1);
});
test("상태 보고가 오류를 달고 오면(SDK 창: 첫 턴 실패) 글이 안 들어간 것", async () => {
  const { db, eng, say } = setup();
  await eng.deliver(WID, "[Boarder chat] 글");
  await say({ type: "state", windows: [{ id: WID, state: "idle", error: "session not found" }] });
  assert.equal(sysLines(db).length, 1);
});
test("답을 잃은 다시 열기(창은 떠 있음): 들어갔는지 모른다고 줄을 남김 · 다시 안 넣음", async () => {
  const { db, dev, eng } = setup();
  const real = (eng as any).cmd.bind(eng);
  let lose = true;
  (eng as any).cmd = (verb: string, args: any, ms?: number) => {
    if (verb === "reopen" && lose) { lose = false; dev.open.add(args.id); return Promise.reject(Object.assign(new Error("엔진 답 없음"), { code: 1 })); }
    return real(verb, args, ms);
  };
  assert.deepEqual(await eng.deliver(WID, "[보드 · Primary] [Boarder chat] 애매한 글"), { reopened: true });
  const lines = sysLines(db);
  assert.equal(lines.length, 1); assert.match(lines[0].text, /들어갔는지 확인하지 못했어요: 애매한 글/);
});
test("상태 동사가 없는 커스텀 엔진: 알 길이 없으니 거짓 줄을 안 남김", async () => {
  const { db, eng } = setup();
  await eng.deliver(WID, "[Boarder chat] 글");
  (eng as any).cmd = () => Promise.reject(Object.assign(new Error("engine x cannot state"), { code: 5 }));
  await eng.checkReopens(Date.now() + LATE);
  assert.deepEqual(sysLines(db), []);
});
test("글 없는 다시 열기(사람 글 아님)는 지켜보지 않음", async () => {
  const { db, dev, eng } = setup();
  await eng.reopen(WID, "");
  windowDied(dev);
  await eng.checkReopens(Date.now() + LATE);
  assert.deepEqual(sysLines(db), []);
});
test("끝에서 끝: 주차된 메인 봇 + 고른 창 없음 → chatToMain 은 reopened, 창이 죽으면 메인 봇 이름으로 줄", async () => {
  const { db, dev, eng } = setup();
  const MAIN = "ew_mainbot0001", E = await import("./engine.ts");
  db.prepare("UPDATE engine_window SET state = 'parked', handle = ? WHERE id = ?").run(JSON.stringify({ engine: "tmux", id: MAIN, name: "Primary", session_id: "00000000-0000-4000-8000-000000000002" }), MAIN);
  dev.open.delete(MAIN);
  const env = { DB: eng.env.DB, PUBLIC_URL: "https://example.test", ENGINE: { idFromName: (n: string) => n, get: () => eng } } as any;
  const r = await E.chatToMain(env, MEMBER, "회원 글 예시");
  assert.deepEqual(r, { reopened: true });
  assert.ok(dev.got.some(g => g.verb === "reopen" && g.id === MAIN && /회원 글 예시/.test(g.text || "")), "글은 다시 여는 창의 첫 메시지로 감");
  dev.open.delete(MAIN);
  await eng.checkReopens(Date.now() + LATE);
  const l = sysLines(db).filter(x => x.wid === MAIN);
  assert.equal(l.length, 1); assert.match(l[0].text, /「Primary」.*안 들어갔어요/);
});

const CHIEF = "window:laptop:tmux:" + WID;
function wire(s: any, o: { impState?: string; impGone?: boolean } = {}) {
  s.db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, session, handle, seen_at, gone_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(MEMBER, CHIEF, DEV, "window", "tmux", "비서실장", "/x", o.impState || "idle", T, "laptop:" + WID, "", JSON.stringify({ engine: "tmux", id: WID }), T, o.impGone ? T : null);
  s.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(MEMBER, JSON.stringify({ primary_item: CHIEF }), T);
  return { DB: s.eng.env.DB, PUBLIC_URL: "https://example.test", ENGINE: { idFromName: (n: string) => n, get: () => s.eng } } as any;
}
const settle = () => new Promise(r => setTimeout(r, 30));
const cmdRows = (db: any) => db.prepare("SELECT verb, state, result FROM engine_cmd ORDER BY rowid").all() as { verb: string; state: string; result: string }[];
const allSys = (db: any) => (db.prepare("SELECT text FROM board_log WHERE kind = 'sys' ORDER BY id").all() as { text: string }[]).map(r => r.text);

test("① 고른 엔진 창이 주차됐는데 imp_item 은 산 꼴: 줄 세우지 않고 그 창을 다시 열며 넣음 · 감시를 탐", async () => {
  const s = setup(), env = wire(s);
  const r = await primarySend(env, MEMBER, "주차 뒤 글", "[보드 · Primary]"); await settle();
  assert.deepEqual(r, { reopened: true });
  const g = s.dev.got.filter(x => x.id === WID);
  assert.equal(g.length, 1); assert.equal(g[0].verb, "reopen");
  assert.match(g[0].text!, /^\[보드 · Primary\] \[Boarder chat\] 주차 뒤 글\n\(This is/);
  assert.deepEqual(cmdRows(s.db), [], "기기 명령 줄에 안 섬");
  s.dev.open.delete(WID);
  await s.eng.checkReopens(Date.now() + LATE);
  assert.equal(sysLines(s.db).filter(l => l.wid === WID).length, 1, "다시 연 창이 안 뜨면 줄");
});
test("① 서버 표까지 산 꼴인데 기기엔 창이 없음: 소켓이 no such window 를 받으면 다시 열며 넣음", async () => {
  const s = setup(), env = wire(s);
  s.db.prepare("UPDATE engine_window SET state = 'idle' WHERE id = ?").run(WID);
  assert.deepEqual(await primarySend(env, MEMBER, "틈에 낀 글", "[보드 · Primary]"), { queued: true, primary: CHIEF });
  await settle();
  assert.equal(s.dev.got.filter(x => x.id === WID && x.verb === "reopen").length, 1);
  assert.match(s.dev.got.find(x => x.verb === "reopen" && x.id === WID)!.text!, /틈에 낀 글/);
  assert.equal(cmdRows(s.db)[0].state, "done");
  assert.deepEqual(allSys(s.db), []);
  assert.ok(WID in ((await s.eng.ctx.storage.get("reopens")) as object), "감시를 탐");
});
test("① 다시 열 손잡이가 없으면 LOST 시스템 줄 · 명령은 failed", async () => {
  const s = setup(), env = wire(s);
  s.db.prepare("UPDATE engine_window SET state = 'idle', handle = '{}' WHERE id = ?").run(WID);
  await primarySend(env, MEMBER, "못 넣을 글", "[보드 · Primary]"); await settle();
  assert.equal(cmdRows(s.db)[0].state, "failed");
  assert.deepEqual(allSys(s.db), [LOST_LINE]);
});
test("① 엔진 표에 없는 창 · 그 밖의 실패도 LOST 줄", async () => {
  const s = setup(), env = wire(s);
  s.db.prepare("DELETE FROM engine_window WHERE id = ?").run(WID);
  await primarySend(env, MEMBER, "표에 없는 창", "[보드 · Primary]"); await settle();
  assert.deepEqual(allSys(s.db), [LOST_LINE]);
  const s2 = setup(), env2 = wire(s2);
  s2.db.prepare("UPDATE engine_window SET state = 'idle' WHERE id = ?").run(WID); s2.dev.open.add(WID);
  const real = (s2.eng as any).cmd.bind(s2.eng);
  (s2.eng as any).cmd = (v: string, a: any, ms?: number) => v === "send" ? Promise.reject(Object.assign(new Error("the text stayed in the input box"), { code: 1 })) : real(v, a, ms);
  await primarySend(env2, MEMBER, "입력칸에 남은 글", "[보드 · Primary]"); await settle();
  assert.deepEqual(allSys(s2.db), [LOST_LINE]);
  assert.equal(cmdRows(s2.db)[0].state, "failed");
});
test("① 바쁨(2)은 예전처럼 다시 넣을 줄로 — 줄 없음 · Primary 글이 아닌 줄은 main 그대로(다시 안 엶)", async () => {
  const s = setup(), env = wire(s);
  s.db.prepare("UPDATE engine_window SET state = 'idle' WHERE id = ?").run(WID); s.dev.open.add(WID);
  const real = (s.eng as any).cmd.bind(s.eng);
  (s.eng as any).cmd = (v: string, a: any, ms?: number) => v === "send" ? Promise.reject(Object.assign(new Error("busy"), { code: 2 })) : real(v, a, ms);
  await primarySend(env, MEMBER, "바쁠 때 글", "[보드 · Primary]"); await settle();
  assert.equal(cmdRows(s.db)[0].state, "queued"); assert.deepEqual(allSys(s.db), []);
  const s3 = setup();
  s3.db.prepare("UPDATE engine_window SET state = 'idle' WHERE id = ?").run(WID);
  s3.db.prepare("INSERT INTO engine_cmd(id, owner, device_id, verb, args, at) VALUES (?,?,?,?,?,?)").run("c1", MEMBER, DEV, "send", JSON.stringify({ item: CHIEF, engine: "tmux", handle: { id: WID }, text: "노드 글", post: true }), Date.now());
  await s3.eng.drainCmds(); await settle();
  assert.equal(cmdRows(s3.db)[0].state, "failed");
  assert.ok(!s3.dev.got.some(x => x.verb === "reopen"));
});
test("③ imp_item 이 gone 이어도 고른 엔진 창이 engine_window 에 주차로 살아 있으면 그 창(메인 봇으로 안 감)", async () => {
  const s = setup(), env = wire(s, { impState: "gone", impGone: true });
  assert.deepEqual(await primaryTarget(s.eng.env.DB, MEMBER), { via: "ew", key: WID });
  await primarySend(env, MEMBER, "비서실장 글", "[보드 · Primary]"); await settle();
  assert.equal(s.dev.got.filter(x => x.id === WID && x.verb === "reopen").length, 1);
  assert.ok(!s.dev.got.some(x => x.id === "ew_mainbot0001"), "메인 봇 창으로 안 감");
});
test("③ 다시 열 손잡이가 없거나 닫힌 창이면 예전처럼 엔진 메인 봇 길", async () => {
  const s = setup(); wire(s, { impState: "gone", impGone: true });
  s.db.prepare("UPDATE engine_window SET handle = '{}' WHERE id = ?").run(WID);
  assert.equal(await primaryTarget(s.eng.env.DB, MEMBER), null);
  s.db.prepare("UPDATE engine_window SET state = 'closed', handle = ? WHERE id = ?").run(JSON.stringify({ session_id: "x" }), WID);
  assert.equal(await primaryTarget(s.eng.env.DB, MEMBER), null);
});
test("④ 10분 넘게 starting: 그 창을 닫고 gone 으로 맞춘 뒤 줄 — 뒤늦게 떠 첫 글이 또 들어가지 않음", async () => {
  const s = setup();
  await s.eng.deliver(WID, "[Boarder chat] 첫 글");
  const real = (s.eng as any).cmd.bind(s.eng), asked: string[] = [];
  (s.eng as any).cmd = (v: string, a: any, ms?: number) => { asked.push(v); return v === "state" ? Promise.resolve({ id: a.id, state: "starting" }) : real(v, a, ms); };
  await s.eng.checkReopens(Date.now() + LATE);
  assert.ok(asked.includes("close"), "기기에 그 창을 닫으라고 함");
  assert.ok(!s.dev.open.has(WID));
  assert.equal(s.stateOf(), "gone");
  assert.equal(sysLines(s.db).length, 1);
  (s.eng as any).cmd = real;
  await s.eng.deliver(WID, "[Boarder chat] 다시 보낸 글");
  assert.equal(s.dev.got.filter(g => g.verb === "reopen").at(-1)!.text, "[Boarder chat] 다시 보낸 글");
});
test("⑤ partial hello(목록을 못 읽음): 감시 판정을 미룸 — 줄 없음, 뒤에 살아 있으면 끝", async () => {
  const s = setup();
  await s.eng.deliver(WID, "[Boarder chat] 글");
  await s.say({ type: "hello", v: 1, primary: true, cli: "0.1.4", host: "laptop", os: "linux", default: "tmux", engines: { tmux: { caps: null } }, windows: [], partial: true });
  assert.deepEqual(sysLines(s.db), []);
  await s.eng.checkReopens(Date.now() + LATE);
  assert.deepEqual(sysLines(s.db), []);
  assert.deepEqual(await s.eng.ctx.storage.get("reopens"), {});
});
test("도구 허락 · 선택 질문에 멈춘 창은 글을 받은 것 — 안 닫고 줄도 없음 · 감시 끝", async () => {
  const s = setup();
  await s.eng.deliver(WID, "[Boarder chat] 첫 글");
  const real = (s.eng as any).cmd.bind(s.eng), asked: string[] = [];
  (s.eng as any).cmd = (v: string, a: any, ms?: number) => { asked.push(v); return v === "state" ? Promise.resolve({ id: a.id, state: "waiting", dialog: "question" }) : real(v, a, ms); };
  await s.eng.checkReopens(Date.now() + LATE);
  assert.ok(!asked.includes("close"));
  assert.notEqual(s.stateOf(), "gone");
  assert.deepEqual(sysLines(s.db), []);
  asked.length = 0; await s.eng.checkReopens(Date.now() + LATE);
  assert.ok(!asked.includes("state"), "감시 끝");
});
test("신뢰 · 권한 확인창에 10분: 안 닫고 gone 도 아님 · 줄만", async () => {
  const s = setup();
  await s.eng.deliver(WID, "[Boarder chat] 첫 글");
  const real = (s.eng as any).cmd.bind(s.eng), asked: string[] = [];
  (s.eng as any).cmd = (v: string, a: any, ms?: number) => { asked.push(v); return v === "state" ? Promise.resolve({ id: a.id, state: "waiting", dialog: "trust" }) : real(v, a, ms); };
  await s.eng.checkReopens(Date.now() + LATE);
  assert.ok(!asked.includes("close"));
  assert.notEqual(s.stateOf(), "gone");
  assert.equal(sysLines(s.db).length, 1);
});
test("닫기 답을 못 받으면 gone 으로 안 맞춤 · 줄 없음, 다음 알람에 다시", async () => {
  const s = setup();
  await s.eng.deliver(WID, "[Boarder chat] 첫 글");
  const real = (s.eng as any).cmd.bind(s.eng);
  (s.eng as any).cmd = (v: string, a: any, ms?: number) => v === "state" ? Promise.resolve({ id: a.id, state: "starting" }) : v === "close" ? Promise.reject(Object.assign(new Error("엔진 답 없음"), { code: 1 })) : real(v, a, ms);
  await s.eng.checkReopens(Date.now() + LATE);
  assert.notEqual(s.stateOf(), "gone");
  assert.deepEqual(sysLines(s.db), []);
});
test("state 가 계속 오류: 한 시간 뒤 「확인하지 못했어요」 줄로 감시 끝", async () => {
  const s = setup();
  await s.eng.deliver(WID, "[Boarder chat] 글");
  const real = (s.eng as any).cmd.bind(s.eng), asked: string[] = [];
  (s.eng as any).cmd = (v: string, a: any, ms?: number) => { asked.push(v); return v === "state" ? Promise.reject(Object.assign(new Error("엔진 답 없음"), { code: 1 })) : real(v, a, ms); };
  await s.eng.checkReopens(Date.now() + 61 * 60_000);
  assert.equal(sysLines(s.db).length, 1);
  assert.match(JSON.stringify(sysLines(s.db)[0]), /확인하지 못했어요/);
  asked.length = 0; await s.eng.checkReopens(Date.now() + 62 * 60_000);
  assert.ok(!asked.includes("state"), "감시 끝");
});
test("⑥ state 답을 못 받으면 다음 알람으로 미룸 — 줄 없음, 답이 오면 그때 판정", async () => {
  const s = setup();
  await s.eng.deliver(WID, "[Boarder chat] 글");
  const real = (s.eng as any).cmd.bind(s.eng);
  (s.eng as any).cmd = (v: string, a: any, ms?: number) => v === "state" ? Promise.reject(Object.assign(new Error("엔진 답 없음"), { code: 1 })) : real(v, a, ms);
  await s.eng.checkReopens(Date.now() + LATE);
  assert.deepEqual(sysLines(s.db), []);
  (s.eng as any).cmd = real; s.dev.open.delete(WID);
  await s.eng.checkReopens(Date.now() + LATE);
  assert.equal(sysLines(s.db).length, 1);
});
test("① 넣다 답을 잃으면(들어갔을 수 있음) 다시 안 넣고 「확인하지 못했어요」 줄", async () => {
  const s = setup(), env = wire(s);
  s.db.prepare("UPDATE engine_window SET state = 'idle' WHERE id = ?").run(WID); s.dev.open.add(WID);
  const real = (s.eng as any).cmd.bind(s.eng);
  (s.eng as any).cmd = (v: string, a: any, ms?: number) => v === "send" ? Promise.reject(Object.assign(new Error("엔진 답 없음"), { code: 1 })) : real(v, a, ms);
  await primarySend(env, MEMBER, "애매한 글", "[보드 · Primary]"); await settle();
  assert.equal(allSys(s.db).length, 1); assert.match(allSys(s.db)[0], /확인하지 못했어요/);
  assert.ok(!s.dev.got.some(x => x.id === WID), "다시 안 넣음");
});
