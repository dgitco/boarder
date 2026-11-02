import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { data, get, myName } = await import("./member-board.ts");

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
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { const out = []; for (const s of ss) out.push(await s.all()); return out; } } as unknown as D1Database };
}

const ME = "kim@example.test", T = Date.now();
function setup() {
  const { db, D1 } = d1();
  const item = db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, session, handle, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  item.run(ME, "window:lap:herdr:p1", "d1", "window", "herdr-own", "primary", "/home/kim", "working", T, "lap:herdr:p1", "session:claude:m1", JSON.stringify({ engine: "herdr-own", pane: "p1" }), T);
  item.run(ME, "window:lap:herdr:p2", "d1", "window", "herdr-own", "#12 버그", "/home/kim/app", "working", T, "lap:herdr:p2", "", JSON.stringify({ engine: "herdr-own", pane: "p2" }), T);
  // 옛 묶기: primary 창이 노드 n_prim 으로 따로 있었음
  const node = db.prepare("INSERT INTO mnode(owner, id, name, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)");
  node.run(ME, "n_prim", "primary", "working", "", "{}", T, T);
  node.run(ME, "n_bug", "#12 버그", "working", "", "{}", T, T);
  node.run(ME, "n_quiet", "조용한 일", "parked", "6시간 넘게 조용해 주차 — 다시 일하면 살아나요", "{}", T, T);
  const mi = db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)");
  mi.run(ME, "window:lap:herdr:p1", "n_prim", "auto"); mi.run(ME, "window:lap:herdr:p2", "n_bug", "auto");
  const log = db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)");
  log.run(ME, "lap:herdr:p1", "progress", "메인 창이 오늘 일 정리 중", null, T - 2000);
  log.run(ME, "나", "chat", "안녕", "primary", T - 1000);
  return { db, D1 };
}

test("있던 primary 창은 메인 봇 판(%1) — 옛 노드로 따로 안 매닮, 그 창 보고 줄은 봇 판에", async () => {
  const { D1 } = setup();
  const d = await data(D1, ME, { name: "모찌" }) as any;
  assert.equal(d.panes[0].pane, "%1"); assert.equal(d.panes[0].win, "모찌");
  assert.equal(d.panes[0].state, "일하는 중", "엔진 메인 창이 없으면 primary 창 상태");
  assert.equal(d.panes[0].last?.msg, "메인 창이 오늘 일 정리 중");
  const names = d.panes.map((p: any) => p.win);
  assert.ok(!names.includes("primary"), "primary 노드가 봇 옆에 없음");
  assert.ok(names.includes("#12 버그"));
  assert.ok(!d.feed.some((f: any) => f.pane !== "%1" && /메인 창/.test(f.msg)), "그 줄은 다른 노드로 안 감");
  assert.deepEqual(d.parked.map((p: any) => p.name), ["조용한 일"], "주차 노드는 따로(접힌 주차 목록)");
});

test("회원 화면 글 이름 = 회원 이름(주인 이름 아님)", async () => {
  const { D1 } = setup();
  const r = await get(D1, ME, { name: "모찌" }, new URL("https://x.test/api/chat/primary"), async () => null, undefined, "김회원");
  const j = await r!.json() as { messages: { name: string; who: string }[] };
  const mine = j.messages.find(m => m.who === "owner")!;
  assert.equal(mine.name, "김회원");
  assert.ok(!JSON.stringify(j).includes("Owner"));
  assert.equal(myName(ME), "kim", "이름이 없으면 메일 앞");
});
