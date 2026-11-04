import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { primaryTarget, notDelivered, primarySend, LOST_LINE } = await import("./primary-send.ts");
const { PRIMARY_HINT } = await import("./engine.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { const out = []; for (const s of ss) out.push(await s.all()); return out; } } as unknown as D1Database };
}
const ME = "kim@example.test", T = Date.now();
// 비서실장 = 보더 엔진 창(engine tmux — 메인 봇 판정 canBePrimary 가 거절하는 꼴), 팀장 = 내 tmux 창
const CHIEF = "window:mbp:tmux:ew_chief", LEAD = "window:mbp:tmux-own:p2";
function setup(o: { item?: string; win?: string; chiefGone?: boolean; revoked?: boolean } = {}) {
  const { db, D1 } = d1();
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, revoked_at) VALUES (?,?,?,?,?,?,?,?,?)").run("d1", ME, "mbp", "[]", "h1", T, T, "full", o.revoked ? T : null);
  const item = db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, session, handle, seen_at, gone_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  item.run(ME, CHIEF, "d1", "window", "tmux", "비서실장", "/home/kim", "idle", T, "mbp:ew_chief", "", JSON.stringify({ engine: "tmux", id: "ew_chief" }), T, o.chiefGone ? T : null);
  item.run(ME, LEAD, "d1", "window", "tmux-own", "팀장", "/home/kim/app", "working", T, "mbp:p2", "", JSON.stringify({ engine: "tmux-own", pane: "p2" }), T, null);
  if (o.item) db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(ME, JSON.stringify({ primary_item: o.item }), T);
  if (o.win) db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(ME, "primary_win", o.win, T);
  return Object.assign(D1, { sql: db });
}

test("기본 창이 비어도 고른 메인 봇 창(엔진 창)이 살아 있으면 그 창 — 예전엔 null 이라 글이 주차된 보더 메인 봇 reopen 으로 사라짐", async () => {
  assert.deepEqual(await primaryTarget(setup({ item: CHIEF }), ME), { via: "item", key: CHIEF });
});
test("기본 창이 살아 있으면 기본 창이 먼저(예전 그대로)", async () => {
  assert.deepEqual(await primaryTarget(setup({ item: CHIEF, win: LEAD }), ME), { via: "win", key: LEAD });
});
test("기본 창이 죽었으면 고른 메인 봇 창으로", async () => {
  assert.deepEqual(await primaryTarget(setup({ item: CHIEF, win: "window:mbp:tmux-own:p9" }), ME), { via: "item", key: CHIEF });
});
test("고른 창이 닫혔거나 · 기기를 끊었거나 · auto · none 이면 null(→ 엔진 메인 봇 길)", async () => {
  assert.equal(await primaryTarget(setup({ item: CHIEF, chiefGone: true }), ME), null);
  assert.equal(await primaryTarget(setup({ item: CHIEF, revoked: true }), ME), null);
  assert.equal(await primaryTarget(setup({ item: "auto" }), ME), null);
  assert.equal(await primaryTarget(setup({ item: "none" }), ME), null);
  assert.equal(await primaryTarget(setup(), ME), null);
});
test("남의 창 키를 골라 둬도 내 창이 아니면 null", async () => {
  const D1 = setup({ item: "window:other:tmux:ew_x" });
  assert.equal(await primaryTarget(D1, ME), null);
  assert.equal(await primaryTarget(D1, "lee@example.test"), null);
});
test("못 넣음 판정: 엔진 길이 창을 못 열었을 때(started false) · 결과 없음만 — 줄 섬 · 보냄 · 기기 꺼짐(따로 알림)은 아님", () => {
  assert.equal(notDelivered({ started: false }), true);
  assert.equal(notDelivered(null), true);
  assert.equal(notDelivered({ started: true }), false);
  assert.equal(notDelivered({ queued: true, primary: CHIEF }), false);
  assert.equal(notDelivered({ cmd: "abc" }), false);
  assert.equal(notDelivered({ offline: true }), false);
  assert.equal(notDelivered({ sent: true }), false);
});

const LONG = "가".repeat(1500) + "\n둘째 줄\n" + "나".repeat(1500), HEAD = "[보드 · Primary · 스레드 1793000000.000001]";
function envOf(D1: any, device?: { deliver?: (id: string, t: string) => unknown; ensureMain?: () => unknown }) {
  const drained: string[] = [];
  return { drained, env: { DB: D1, PUBLIC_URL: "https://example.test", ENGINE: { idFromName: (n: string) => n, get: (id: string) => ({ drainCmds: async () => { drained.push(id); return { started: true }; }, ...device }) } } as any };
}
const cmds = (D1: any) => (D1.sql.prepare("SELECT verb, args FROM engine_cmd ORDER BY rowid").all() as { verb: string; args: string }[]).map(r => ({ verb: r.verb, a: JSON.parse(r.args) }));

for (const [what, key] of [["엔진 창(자리표 비서실장)", CHIEF], ["내 tmux 창", LEAD]] as const) {
  test(`고른 메인 봇 창 = ${what}: 3,000자 글이 그대로 · 답하는 길 한 줄 · post · main 의 응답 꼴`, async () => {
    const D1 = setup({ item: key }), { env, drained } = envOf(D1);
    const r = await primarySend(env, ME, LONG, HEAD);
    assert.deepEqual(r, { queued: true, primary: key }, "main 의 toImported 꼴");
    const [c] = cmds(D1);
    assert.equal(c.verb, "send");
    assert.equal(c.a.text, `${HEAD} [Boarder chat] ${LONG}\n${PRIMARY_HINT}`, "안 잘림 · 줄바꿈 그대로 · 글 끝 · 힌트");
    assert.equal(c.a.post, true, "post: 소켓으로 넣고(drainRun) 6시간 낡은 글을 버림(routes.ts · drainRun)");
    assert.deepEqual(drained, ["dev:d1"], "엔진 소켓으로 바로");
  });
}
test("기본 창 길은 main 그대로: { cmd } · 힌트 없음", async () => {
  const D1 = setup({ win: LEAD, item: CHIEF }), { env } = envOf(D1);
  const r = await primarySend(env, ME, "짧은 글", HEAD) as any;
  assert.deepEqual(Object.keys(r), ["cmd"]);
  assert.equal(cmds(D1)[0].a.text, `${HEAD} [Boarder chat] 짧은 글`);
  assert.equal(cmds(D1)[0].a.item, LEAD);
});
test("주차한 엔진 창을 고름: 연달은 글이 한 번의 다시 열기에 전문 그대로 모임(둘째 reopen 은 「이미 떠 있음」으로 사라짐)", async () => {
  const D1 = setup({ item: CHIEF }), { env } = envOf(D1);
  D1.sql.prepare("UPDATE imp_item SET state = 'parked' WHERE key = ?").run(CHIEF);
  const r1 = await primarySend(env, ME, LONG, HEAD), r2 = await primarySend(env, ME, "둘째 글", HEAD);
  assert.deepEqual(r1, { queued: true, primary: CHIEF }); assert.deepEqual(r2, { queued: true, primary: CHIEF });
  const all = cmds(D1);
  assert.deepEqual(all.map(c => c.verb), ["reopen"], "다시 열기 하나");
  assert.ok(all[0].a.text.includes(LONG), "첫 글 전문"); assert.ok(all[0].a.text.includes("둘째 글"), "둘째 글도");
  assert.equal(all[0].a.post, true);
});
test("주차한 엔진 창이 여는 중이면: 글은 send(fresh) 로 줄 섬 · 전문 · post", async () => {
  const D1 = setup({ item: CHIEF }), { env } = envOf(D1);
  D1.sql.prepare("UPDATE imp_item SET state = 'parked' WHERE key = ?").run(CHIEF);
  await primarySend(env, ME, "첫 글", HEAD);
  D1.sql.prepare("UPDATE engine_cmd SET state = 'taken', taken_at = ?").run(Date.now());
  await primarySend(env, ME, LONG, HEAD);
  const c = cmds(D1).at(-1)!;
  assert.equal(c.verb, "send"); assert.equal(c.a.fresh, true); assert.equal(c.a.post, true);
  assert.ok(c.a.text.includes(LONG));
});
test("주차한 내 tmux 창은 main 그대로(toImported 의 reopen)", async () => {
  const D1 = setup({ item: LEAD }), { env } = envOf(D1);
  D1.sql.prepare("UPDATE imp_item SET state = 'parked' WHERE key = ?").run(LEAD);
  await primarySend(env, ME, "글", HEAD);
  const [c] = cmds(D1);
  assert.equal(c.verb, "reopen"); assert.equal(c.a.post, true);
  assert.equal(c.a.text, `${HEAD} [Boarder chat] 글\n${PRIMARY_HINT}`);
});
test("어느 창에도 못 넣으면 시스템 줄(엔진 메인 봇 길 started false)", async () => {
  const D1 = setup({ item: "none" }), { env } = envOf(D1);
  const r = await primarySend(env, ME, "글", HEAD) as any;
  assert.ok(r?.offline, "산 엔진 기기가 없으면 offline — 그건 부른 쪽이 따로 알림");
  assert.equal(D1.sql.prepare("SELECT count(*) n FROM board_log WHERE kind = 'sys' AND text = ?").get(LOST_LINE)!.n, 0);
  D1.sql.prepare("UPDATE device SET engine_at = ? WHERE id = 'd1'").run(Date.now());
  const { env: e2 } = envOf(D1, { ensureMain: async () => null });
  assert.deepEqual(await primarySend(e2, ME, "글", HEAD), { started: false });
  assert.equal(D1.sql.prepare("SELECT count(*) n FROM board_log WHERE kind = 'sys' AND text = ?").get(LOST_LINE)!.n, 1);
});
