import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (s === "better-auth" || s === "better-auth/plugins") return { url: "data:text/javascript,export const betterAuth = () => ({}); export const emailOTP = () => ({});", shortCircuit: true };
  if (s === "better-auth/crypto") return { url: "data:text/javascript,export const symmetricEncrypt = async () => ''; export const symmetricDecrypt = async () => '';", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { Engine, chatToMain, importedPrimary, ownerCfg } = await import("./engine.ts");

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

const MEMBER = "member@example.test", DEV = "devMember01", T = Date.now();
function setup(primary: null | { title: string; state?: string; handle?: object; engine?: string }) {
  const { db, D1 } = d1();
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, "owner@example.test", T);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run(DEV, MEMBER, "member laptop", "", "h1", T, T, "full", T);
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, win, handle, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(MEMBER, "window:lap:herdr:p2", DEV, "window", "herdr-own", "#3720 uptime", "/home/m/app", "working", "lap:herdr:p2", JSON.stringify({ engine: "herdr-own", pane: "p2" }), T);
  if (primary) db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, win, session, handle, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(MEMBER, "window:lap:herdr:p1", DEV, "window", primary.engine || "herdr-own", primary.title, "/home/m", primary.state || "idle", "lap:herdr:p1", "session:claude:main1", JSON.stringify(primary.handle || { engine: "herdr-own", pane: "p1", session_id: "main1" }), T);
  const store = new Map<string, unknown>();
  const ctx = {
    setWebSocketAutoResponse() {},
    getWebSockets: () => [],   // 데몬 없음: 새 창을 열려 하면 「엔진이 꺼져 있어요」로 실패하고 failed 줄이 남음
    waitUntil() {},
    storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v); }, delete: async (k: string) => store.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} },
  };
  store.set("who", { device: DEV, owner: MEMBER, harness: false });
  const drained: string[] = [];
  const env = { DB: D1, PUBLIC_URL: "https://example.test", ALLOW_EMAILS: "owner@example.test", ENGINE: { idFromName: (n: string) => n, get: (id: string) => ({ drainCmds: async () => { drained.push(id); return { started: true }; } }) } };
  const eng = new (Engine as any)(ctx, env);
  const mains = () => db.prepare("SELECT id, state FROM engine_window WHERE owner = ? AND kind = 'main'").all(MEMBER) as { id: string; state: string }[];
  const cmds = () => (db.prepare("SELECT verb, args FROM engine_cmd WHERE owner = ? ORDER BY at").all(MEMBER) as { verb: string; args: string }[]).map(r => ({ verb: r.verb, args: JSON.parse(r.args) }));
  return { db, env, eng, mains, cmds, drained };
}

test("들여온 primary 창이 없으면 예전처럼 새 메인 창을 띄우려 함", async () => {
  const s = setup(null);
  assert.equal(await importedPrimary(s.env.DB, MEMBER), null);
  await s.eng.ensureMain(MEMBER, DEV);
  assert.equal(s.mains().length, 1, "메인 창 줄이 생김(데몬이 없어 failed)");
});

test("들여온 primary 창(창 이름 primary)이 있으면 새 메인 창을 안 띄움", async () => {
  const s = setup({ title: "primary" });
  assert.equal((await importedPrimary(s.env.DB, MEMBER))?.key, "window:lap:herdr:p1");
  assert.equal(await s.eng.ensureMain(MEMBER, DEV), null);
  assert.equal(s.mains().length, 0, "엔진 메인 창 줄 없음");
});

test("Primary 채팅 글은 그 primary 창에 그 사람 하네스 동사로(send) — 답하는 길 한 줄을 붙임", async () => {
  const s = setup({ title: "메인", handle: { engine: "herdr-own", pane: "p1" } });
  const r = await chatToMain(s.env as never, MEMBER, "오늘 할 일 정리해 줘") as { queued?: boolean; primary?: string };
  assert.equal(r.queued, true); assert.equal(r.primary, "window:lap:herdr:p1");
  const c = s.cmds();
  assert.equal(c.length, 1); assert.equal(c[0].verb, "send");
  assert.equal(c[0].args.item, "window:lap:herdr:p1"); assert.equal(c[0].args.engine, "herdr-own"); assert.equal(c[0].args.post, true);
  assert.match(c[0].args.text, /^\[보드 · Primary\] \[Boarder chat\] 오늘 할 일 정리해 줘\n/);   // 머리 줄(board-head.ts)은 들여온 primary 창에도
  assert.match(c[0].args.text, /boarder chat/);
  assert.deepEqual(s.drained, [`dev:${DEV}`]);
  assert.equal(s.mains().length, 0, "새 메인 창을 안 띄움");
});

test("primary 창이 주차면 다시 열며 넣음(reopen) · 들여오기 표시(handle.primary)는 이름보다 이김", async () => {
  const s = setup({ title: "아무 이름", state: "parked", handle: { engine: "tmux-own", pane: "%9", primary: true }, engine: "tmux-own" });
  await chatToMain(s.env as never, MEMBER, "안녕");
  const c = s.cmds();
  assert.equal(c[0].verb, "reopen"); assert.equal(c[0].args.item, "window:lap:herdr:p1");
});

test("폐기한 기기의 primary 창 · 닫힌 창은 메인 봇이 아님", async () => {
  const s = setup({ title: "primary" });
  s.db.prepare("UPDATE device SET revoked_at = ? WHERE id = ?").run(T, DEV);
  assert.equal(await importedPrimary(s.env.DB, MEMBER), null);
  const s2 = setup({ title: "primary" });
  s2.db.prepare("UPDATE imp_item SET gone_at = ?, state = 'gone' WHERE key = ?").run(T, "window:lap:herdr:p1");
  assert.equal(await importedPrimary(s2.env.DB, MEMBER), null);
});

test("메인 봇 창을 사람이 고름(primary_item): none = 들여온 창 안 씀 · 고른 창은 보더 메인 봇 창이 떠 있어도 채팅을 받음 · 닫힌 고른 창은 다른 창으로 안 바꿈", async () => {
  const s = setup({ title: "primary" });
  const set = (v: object) => s.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET data = excluded.data").run(MEMBER, JSON.stringify(v), T);
  set({ unit: "goal", primary_item: "none" });
  assert.equal(await importedPrimary(s.env.DB, MEMBER), null, "none: 이름이 primary 여도");
  await s.eng.ensureMain(MEMBER, DEV);
  assert.equal(s.mains().length, 1, "보더 메인 봇을 띄우려 함");
  s.db.prepare("UPDATE engine_window SET state = 'idle' WHERE owner = ? AND kind = 'main'").run(MEMBER);   // 보더 메인 봇이 떠 있음
  set({ primary_item: "auto" });
  assert.equal(await importedPrimary(s.env.DB, MEMBER), null, "auto: 보더 메인 봇이 이김(예전 그대로)");
  set({ primary_item: "window:lap:herdr:p2" });
  assert.equal((await importedPrimary(s.env.DB, MEMBER))?.key, "window:lap:herdr:p2", "고른 창이 이김");
  const r = await chatToMain(s.env as never, MEMBER, "안녕") as { primary?: string };
  assert.equal(r.primary, "window:lap:herdr:p2"); assert.equal(s.cmds()[0].args.item, "window:lap:herdr:p2");
  s.db.prepare("UPDATE imp_item SET gone_at = ?, state = 'gone' WHERE key = ?").run(T, "window:lap:herdr:p2");
  assert.equal(await importedPrimary(s.env.DB, MEMBER), null, "고른 창이 닫히면 보더 메인 봇(이름 primary 창으로 몰래 안 바꿈)");
});

test("권한 모드: auto · bypass 는 그대로 읽고, 모르는 값은 ask", async () => {
  const s = setup(null);
  for (const [v, want] of [["auto", "auto"], ["bypass", "bypass"], ["ask", "ask"], ["엉뚱", "ask"]] as const) {
    s.db.prepare("INSERT INTO engine_owner(owner, perm_mode, updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET perm_mode = excluded.perm_mode").run(MEMBER, v, T);
    assert.equal((await ownerCfg(s.env.DB, MEMBER)).perm, want, v);
  }
});

test("하네스 규칙 one_goal: 그 사람이 설정에서 고른 값이 엔진 규칙(관리 값)보다 이김, 안 골랐으면 그대로", async () => {
  const s = setup(null);
  assert.equal((await ownerCfg(s.env.DB, MEMBER)).rules.one_goal, true, "기본 켬");
  s.db.prepare("INSERT INTO engine_owner(owner, rules, updated_at) VALUES (?,?,?)").run(MEMBER, JSON.stringify({ one_goal: false, wake_min: 20 }), T);
  let c = await ownerCfg(s.env.DB, MEMBER);
  assert.equal(c.rules.one_goal, false); assert.equal(c.rules.wake_min, 20);
  s.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(MEMBER, JSON.stringify({ rules: { one_goal: true } }), T);
  c = await ownerCfg(s.env.DB, MEMBER);
  assert.equal(c.rules.one_goal, true, "사람이 고른 값"); assert.equal(c.rules.wake_min, 20, "다른 규칙은 그대로");
  s.db.prepare("UPDATE node_setting SET data = ? WHERE owner = ?").run(JSON.stringify({ rules: { one_goal: false } }), MEMBER);
  assert.equal((await ownerCfg(s.env.DB, MEMBER)).rules.one_goal, false);
  assert.equal((await ownerCfg(s.env.DB, "nobody@example.test")).perm, "ask", "줄 없는 사람도 기본값");
});

test("다시 묶기(regroup)도 폐기한 기기의 primary 창을 메인 봇으로 안 고름 — 끊은 기기 표시(rv)가 그 질의에 붙는지(device_id 칸)", async () => {
  const { regroup } = await import("./importer/routes.ts");
  const pick = async (revoke: boolean) => {
    const s = setup({ title: "primary", handle: { engine: "herdr-own", pane: "p1", primary: true } });
    if (revoke) s.db.prepare("UPDATE device SET revoked_at = ? WHERE id = ?").run(T, DEV);
    const q = (sql: string, args: unknown[] = []): any => ({ sql, bind: (...a: unknown[]) => q(sql, a),
      all: async () => ({ results: s.db.prepare(sql).all(...(args as never[])) }), first: async () => s.db.prepare(sql).get(...(args as never[])) ?? null,
      run: async () => { const r = s.db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; } });
    const DB = { prepare: (sql: string) => q(sql), batch: async (ss: any[]) => { const out = []; for (const x of ss) out.push(/^\s*(select|with)/i.test(x.sql) ? await x.all() : await x.run()); return out; } };
    await regroup({ ...s.env, DB } as never, MEMBER);
    return !!s.db.prepare("SELECT 1 FROM mnode_item WHERE owner = ? AND item = ?").get(MEMBER, "window:lap:herdr:p1");   // 메인 봇으로 뽑힌 창은 노드에 안 묶임(group.ts)
  };
  assert.equal(await pick(false), false, "살아 있는 기기의 primary 창 = 메인 봇 → 노드에 안 묶임");
  assert.equal(await pick(true), true, "폐기한 기기 창은 메인 봇이 아님 → 보통 창처럼 노드에 묶임");
});
