import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

// engine.ts 의 cloudflare:workers 는 Workers 밖에 없음 — 빈 DurableObject 로 갈음(hsync · ownerWindows 는 env.DB 만 씀)
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);   // 워커 코드는 확장자 없이 import(번들러 꼴)
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { Engine, ownerWindows } = await import("./engine.ts");
const { mountImport } = await import("./importer/routes.ts");
const { Hono } = await import("hono");

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
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { const out = []; for (const s of ss) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); return out; } } as unknown as D1Database };
}

const OWNER = "owner@example.com", MEMBER = "member@example.com", T = Date.now();
function seed(db: DatabaseSync) {
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)");
  dev.run("devHarness1", OWNER, "owner-host harness", "", "h1", T, T, "harness", T);
  dev.run("devMember01", MEMBER, "member laptop", "", "h2", T, T, "full", T);
  db.prepare("INSERT INTO engine_cmd(id, owner, device_id, verb, args, at, state, taken_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("cmd_move_1", MEMBER, "devMember01", "move", JSON.stringify({ item: "window:herdr:1", engine: "herdr", title: "옛 창" }), T, "taken", T);
}
function app(D1: D1Database) {
  const a = new Hono<any>();
  a.onError((e, c) => { console.error("app error", e); return c.text(String(e), 500); });
  mountImport(a, { device: async () => ({ id: "devMember01", owner: MEMBER, name: "member laptop" }), member: async () => null, sameSite: () => true });
  return (path: string, body: unknown) => a.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { DB: D1, PUBLIC_URL: "https://example.test" });
}

test("회원 기기의 옮기기 결과는 주인 하네스 창 id(ew_pane<N>)를 차지하지 못함 — 주인 판 %12 가 주인 창 목록에 남음", async () => {
  const { db, D1 } = d1(); seed(db);
  const r = await app(D1)("/api/device/cmds/cmd_move_1", { ok: true, item: { key: "window:tmux:x", id: "ew_pane12", title: "squat", session: "s:1" } });
  assert.equal(r.status, 200);
  const eng = new (Engine as any)({ setWebSocketAutoResponse() {} }, { DB: D1 });
  await eng.hsync([{ id: "ew_pane12", state: "busy", name: "주인 판" }, { id: "ew_pane3", state: "idle", name: "다른 판" }], true, "devHarness1", OWNER, T);
  const ids = (await ownerWindows({ DB: D1 } as any)).windows.map((w: { id: string }) => w.id).sort();
  assert.deepEqual(ids, ["ew_pane12", "ew_pane3"]);
  const row = db.prepare("SELECT owner, kind FROM engine_window WHERE id = 'ew_pane12'").get() as { owner: string; kind: string };
  assert.equal(row.owner, OWNER);
});

test("보통 CLI 창 id(ew_<시각36><무작위>)는 그대로 engine_window 에 들어감", async () => {
  const { db, D1 } = d1(); seed(db);
  const r = await app(D1)("/api/device/cmds/cmd_move_1", { ok: true, item: { key: "window:tmux:y", id: "ew_mgx1abcdq3k9zz", title: "옮긴 창", session: "s:2" } });
  assert.equal(r.status, 200);
  const row = db.prepare("SELECT owner, device_id, kind FROM engine_window WHERE id = 'ew_mgx1abcdq3k9zz'").get();
  assert.deepEqual({ ...(row as object) }, { owner: MEMBER, device_id: "devMember01", kind: "role" });
});

test("기기 명령 결과 queued → waiting(note 는 보드 한 줄) → 다시 ok → done, 옛 꼴(ok 만)은 그대로 done", async () => {
  const { db, D1 } = d1(); seed(db);
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, win, state, state_at, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(MEMBER, "window:laptop:tmux:7", "devMember01", "window", "tmux-own", "내 창", "laptop:tmux:7", "working", T, T);
  db.prepare("INSERT INTO engine_cmd(id, owner, device_id, verb, args, at, state, taken_at) VALUES (?,?,?,?,?,?,?,?)").run("cmd_send_q1", MEMBER, "devMember01", "send", JSON.stringify({ item: "window:laptop:tmux:7", engine: "tmux-own", text: "글" }), T, "taken", T);
  const st = () => (db.prepare("SELECT state FROM engine_cmd WHERE id = 'cmd_send_q1'").get() as { state: string }).state;
  assert.equal((await app(D1)("/api/device/cmds/cmd_send_q1", { ok: true, item: { queued: true } })).status, 200);
  assert.equal(st(), "waiting");
  assert.equal((await app(D1)("/api/device/cmds/cmd_send_q1", { ok: true, item: { queued: true }, note: "this board message has waited over 10 minutes" })).status, 200);
  assert.equal(st(), "waiting");
  const line = db.prepare("SELECT win, kind, text FROM board_log WHERE owner = ? AND text LIKE '%10 minutes%'").get(MEMBER) as { win: string; kind: string } | undefined;
  assert.deepEqual({ ...(line as object) }, { win: "laptop:tmux:7", kind: "blocked", text: "this board message has waited over 10 minutes" });
  assert.equal((await app(D1)("/api/device/cmds/cmd_send_q1", { ok: true })).status, 200);
  assert.equal(st(), "done");
  assert.equal((await app(D1)("/api/device/cmds/cmd_send_q1", { ok: true })).status, 404, "끝난 명령은 다시 안 받음");
});
