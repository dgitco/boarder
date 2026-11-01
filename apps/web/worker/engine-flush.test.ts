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

const MEMBER = "member@example.test", DEV = "devMember01", W1 = "ew_idlerole0001", W2 = "ew_newrole00002", T = Date.now();
function setup() {
  const { db, D1 } = d1();
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, "owner@example.test", T);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run(DEV, MEMBER, "member laptop", "", "h1", T, T, "full", T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?)").run("ew_mainbot0001", MEMBER, DEV, "main", "Primary", "busy", T, T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(W1, MEMBER, DEV, "role", "r_1", "일 창", "idle", T, T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(W2, MEMBER, DEV, "role", "r_2", "새 창", "starting", T, T);
  // 가짜 데몬: send 는 적어 두고, hold 면 답을 붙잡아 둠(release 로 보냄), lose 면 넣고 답을 잃음
  const dev = { got: [] as { verb: string; id?: string; text?: string }[], hold: false, lose: false, held: [] as (() => Promise<void>)[] };
  const store = new Map<string, unknown>(), waits: Promise<unknown>[] = [];
  let eng: any;
  const ws = {
    readyState: 1,
    deserializeAttachment: () => ({ device: DEV, owner: MEMBER, at: T }),
    close() {},
    send(raw: string) {
      const m = JSON.parse(raw), a = m.args || {};
      if (m.verb === "send") dev.got.push({ verb: "send", id: a.id, text: a.text });
      if (dev.lose && m.verb === "send") { dev.lose = false; return; }   // 넣었는데 답을 잃음
      const answer = () => eng.webSocketMessage(ws, JSON.stringify({ id: m.id, ok: true, result: { ok: true } }));
      if (dev.hold) dev.held.push(answer); else queueMicrotask(answer);
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
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
  const pending = () => (store.get("pending") as { id: string; text: string }[] | undefined) || [];
  return { db, dev, eng, ws, store, waits, settle, pending };
}

test("① 알람의 flush 와 「쉼」 보고의 flush 가 겹쳐도 밀린 글은 한 번만 들어감", async () => {
  const { dev, eng, ws, store, waits, settle } = setup();
  store.set("pending", [{ id: W1, text: "[Boarder chat] 밀린 글", at: Date.now() }]);
  dev.hold = true;
  const alarm = eng.alarm();   // 1분 알람: 규칙 → flush → 넣기 답 기다림
  await settle();
  const state = eng.webSocketMessage(ws, JSON.stringify({ type: "state", windows: [{ id: W1, state: "idle" }] }));   // 그 사이 데몬 상태 보고(쉼) → flush
  await settle();
  dev.hold = false;
  while (dev.held.length) { await dev.held.shift()!(); await settle(); }
  await Promise.all([alarm, state]); await Promise.all(waits.splice(0));
  assert.equal(dev.got.filter(g => g.text === "[Boarder chat] 밀린 글").length, 1, "같은 글이 두 번 들어가면 안 됨");
});

test("② 밀린 글 넣기의 답을 잃으면(넣었을 수 있음) 다음 flush 가 다시 넣지 않음", async () => {
  const { dev, eng, store, settle, pending } = setup();
  store.set("pending", [{ id: W1, text: "[Boarder chat] 밀린 글", at: Date.now() }]);
  dev.lose = true;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const f = eng.flush();
    await settle();
    mock.timers.tick(60_000);   // 서버 cmd 60초 → 「엔진 답 없음」
    await f;
  } finally { mock.timers.reset(); }
  await eng.flush();   // 데몬이 다시 붙음(hello) · 다음 알람
  assert.equal(dev.got.filter(g => g.text === "[Boarder chat] 밀린 글").length, 1, "들어갔을 수 있는 글을 다시 넣으면 안 됨");
  assert.equal(pending().length, 0);
});

test("③ flush 가 넣기 답을 기다리는 사이 줄에 선 새 글이 flush 끝에 지워지지 않음", async () => {
  const { dev, eng, store, settle, pending } = setup();
  store.set("pending", [{ id: W1, text: "[Boarder chat] 밀린 글", at: Date.now() }]);
  dev.hold = true;
  const f = eng.flush();
  await settle();
  assert.deepEqual(await eng.deliver(W2, "[Boarder chat] 뜨는 중인 창에 새 글"), { queued: true });   // 그 사이 뜨는 중인 창에 채팅 → 줄 섬
  dev.hold = false;
  while (dev.held.length) { await dev.held.shift()!(); await settle(); }
  await f;
  assert.ok(pending().some(p => p.id === W2 && p.text === "[Boarder chat] 뜨는 중인 창에 새 글"), "flush 동안 줄 선 글이 사라지면 안 됨");
  assert.ok(!pending().some(p => p.id === W1), "넣은 글은 줄에서 빠짐");
});

test("④ 바로 넣기(deliver)의 답을 잃고 그새 엔진이 꺼지면 — 넣었을 수 있는 글을 줄에 세워 다시 붙을 때 또 넣지 않음", async () => {
  const { dev, eng, ws, settle, pending } = setup();
  dev.lose = true;
  mock.timers.enable({ apis: ["setTimeout"] });
  let r: unknown;
  try {
    const d = eng.deliver(W1, "[Boarder chat] 바로 넣는 글").then((x: unknown) => x, (e: Error) => e);
    await settle();
    ws.readyState = 3;   // 기기는 넣었고, 답을 보내기 전에 끊겨 60초 안에 안 붙음
    mock.timers.tick(60_000);
    r = await d;
  } finally { mock.timers.reset(); }
  ws.readyState = 1;
  await eng.flush();   // 다시 붙음(hello)
  assert.equal(dev.got.filter(g => g.text === "[Boarder chat] 바로 넣는 글").length, 1, `같은 글이 두 번 들어가면 안 됨(deliver 답: ${JSON.stringify(r instanceof Error ? r.message : r)})`);
  assert.equal(pending().length, 0);
});
