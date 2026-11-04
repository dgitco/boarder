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
const { data } = await import("./member-board.ts");
const { prefsOf, prefsPatch } = await import("./node-prefs.ts");

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
function setup(set: object, more?: (db: DatabaseSync) => void) {
  const { db, D1 } = d1();
  const item = db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, session, handle, seen_at, gone_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const node = db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, task, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const mi = db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)");
  // 자리표 부서(기술장) — 맨 위 업무 노드, 그 밑 업무 하나
  node.run(ME, "tk_tech", "기술장", "", "working", "", JSON.stringify({ state: "working", line: "", issue: "" }), "{}", T, T);
  item.run(ME, "window:mbp:tmux:ew_tech", "d1", "window", "tmux", "기술장", "/x", "working", T, "mbp:ew_tech", "", "{}", T, null);
  mi.run(ME, "window:mbp:tmux:ew_tech", "tk_tech", "pin");
  node.run(ME, "n_sub", "#12 결제 버그", "", "working", "", null, "{}", T, T - 10);
  item.run(ME, "window:mbp:tmux:ew_sub", "d1", "window", "tmux", "#12 결제 버그", "/x", "working", T, "mbp:ew_sub", "", "{}", T, null);
  mi.run(ME, "window:mbp:tmux:ew_sub", "n_sub", "auto");
  node.run(ME, "n_worker", "작업자 · 조사", "", "working", "", null, "{}", T, T - 20);
  item.run(ME, "window:lap2:tmux:ew_w", "d2", "window", "tmux", "작업자 · 조사", "/y", "working", T, "lap2:ew_w", "", "{}", T, null);
  mi.run(ME, "window:lap2:tmux:ew_w", "n_worker", "auto");
  node.run(ME, "n_park", "조용한 일", "", "parked", "6시간 넘게 조용해 주차", null, "{}", T, T - 30);
  node.run(ME, "n_end", "끝난 작업자", "", "idle", "", null, "{}", T, T - 40);
  item.run(ME, "window:lap2:tmux:ew_end", "d2", "window", "tmux", "끝난 작업자", "/y", "gone", T, "lap2:ew_end", "", "{}", T, T - 1000);
  mi.run(ME, "window:lap2:tmux:ew_end", "n_end", "auto");
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(ME, JSON.stringify({ parent: { tk_tech: "top", n_sub: "tk_tech" }, ...set }), T);
  more?.(db);
  return D1;
}
const ROLES = { roles: [{ name: "비서실장", win: "lap4:ew_chief", primary: true }, { name: "기술장", win: "mbp:ew_tech" }] };
const area = (d: any, w: string) => d.panes.find((p: any) => p.win === w)?.area;

test("자리표 있음: 메인 봇 바로 밑(primary)에 창 없음 — 상위 없는 작업자 · 주차 노드는 「분류 안 됨」, 부서 밑 업무는 부서 열", async () => {
  const d = await data(setup(ROLES), ME, { name: "비서실장" }) as any;
  assert.equal(d.tree_tidy, true);
  assert.deepEqual(d.panes.filter((p: any) => p.pane !== "%1" && p.area === "primary").map((p: any) => p.win), [], "메인 봇 바로 밑 창 없음");
  assert.equal(area(d, "작업자 · 조사"), "unsorted");
  assert.deepEqual(d.parked.map((q: any) => [q.name, q.area]), [["조용한 일", "unsorted"]]);
  const tech = d.areas.find((a: any) => a.name === "기술장");
  assert.ok(tech && tech.seat === true, "자리표 부서 열은 seat");
  assert.equal(area(d, "#12 결제 버그"), tech.key, "부서 밑 업무는 부서 열(그대로)");
  assert.deepEqual(d.areas.filter((a: any) => a.key === "unsorted").map((a: any) => [a.name, a.lead]), [["분류 안 됨", ""]], "머리 없는 열 하나");
  assert.ok(!d.panes.some((p: any) => p.win === "끝난 작업자"), "창이 다 닫힌 노드는 바로 빠짐");
  assert.ok(d.closed.some((c: any) => c.win === "끝난 작업자"), "닫힌 목록엔 남음(숨김 — 안 지움)");
  assert.equal(area(d, "기술장"), tech.key);
});

test("자리표 없음: 예전 그대로 — 작업자 · 주차는 primary, 끝난 노드도 판에, 분류 안 됨 열 없음", async () => {
  const d = await data(setup({}), ME, { name: "모찌" }) as any;
  assert.equal(d.tree_tidy, undefined);
  assert.equal(area(d, "작업자 · 조사"), "primary");
  assert.deepEqual(d.parked.map((q: any) => q.area), ["primary"]);
  assert.ok(d.panes.some((p: any) => p.win === "끝난 작업자"));
  assert.ok(!d.areas.some((a: any) => a.key === "unsorted"));
  assert.ok(d.areas.every((a: any) => a.seat === undefined));
});

test("자리표 있어도 설정 › 노드에서 끄면(tree_tidy false) 예전 그대로", async () => {
  const d = await data(setup({ ...ROLES, tree_tidy: false }), ME, { name: "비서실장" }) as any;
  assert.equal(d.tree_tidy, undefined);
  assert.equal(area(d, "작업자 · 조사"), "primary");
  assert.ok(!d.areas.some((a: any) => a.key === "unsorted"));
});

test("설정 칸: 값 없음 = null(자리표 있으면 켬) · 불린만 저장", () => {
  assert.equal(prefsOf({}).tree_tidy, null);
  assert.equal(prefsOf({ tree_tidy: false }).tree_tidy, false);
  assert.equal(prefsOf({ tree_tidy: "no" }).tree_tidy, null);
  assert.deepEqual(prefsPatch({ tree_tidy: true }), { tree_tidy: true });
  assert.equal(prefsPatch({ tree_tidy: "yes" }), null);
});

function goneNode(db: DatabaseSync, id: string, name: string, state: string) {
  db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, task, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(ME, id, name, "", state, "", null, "{}", T, T - 50);
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, session, handle, seen_at, gone_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(ME, `window:lap2:tmux:${id}`, "d2", "window", "tmux", name, "/y", "gone", T, `lap2:${id}`, "", "{}", T, T - 1000);
  db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)").run(ME, `window:lap2:tmux:${id}`, id, "auto");
}
test("창이 다 닫혀도 세션이 일하거나(working) 물음이 열린(turn) 노드는 판에 남음 — 결정 카드가 노드를 안 잃음", async () => {
  const d = await data(setup(ROLES, db => {
    goneNode(db, "n_busy", "일하는 세션", "working");
    goneNode(db, "n_turn", "묻는 세션", "turn");
    db.prepare("INSERT INTO board_card(id, owner, win, question, choices, at) VALUES (?,?,?,?,?,?)").run("1793000000.000001", ME, "lap2:n_turn", "어느 쪽으로 할까요", "[]", T);
  }), ME, { name: "비서실장" }) as any;
  for (const w of ["일하는 세션", "묻는 세션"]) {
    assert.ok(d.panes.some((p: any) => p.win === w), `${w} 는 판에 남음`);
    assert.ok(!d.closed.some((c: any) => c.win === w), `${w} 는 닫힌 목록에 안 감`);
  }
  assert.equal(d.cardlist.find((c: any) => c.ts === "1793000000.000001").channel, "n:묻는 세션", "결정 카드가 그 노드 채널에 남음");
  assert.ok(d.closed.some((c: any) => c.win === "끝난 작업자"), "쉬는 노드는 그대로 바로 빠짐");
});
test("쉬는 노드라도 열린 결정 카드가 있으면 판에 남음", async () => {
  const d = await data(setup(ROLES, db => {
    goneNode(db, "n_card", "카드 남은 노드", "idle");
    db.prepare("INSERT INTO board_card(id, owner, win, question, choices, at) VALUES (?,?,?,?,?,?)").run("1793000000.000002", ME, "lap2:n_card", "이건 어떻게 할까요", "[]", T);
  }), ME, { name: "비서실장" }) as any;
  assert.ok(d.panes.some((p: any) => p.win === "카드 남은 노드"));
  assert.equal(d.cardlist.find((c: any) => c.ts === "1793000000.000002").channel, "n:카드 남은 노드");
});

test("창이 다 닫혀도 막힌(blocked) 노드는 판에 남음 — 쉬는 상태(idle · parked)만 바로 빠짐", async () => {
  const d = await data(setup(ROLES, db => { goneNode(db, "n_blk", "막힌 노드", "blocked"); goneNode(db, "n_idle", "쉬는 노드", "idle"); goneNode(db, "n_prk", "주차된 끝 노드", "parked"); }), ME, { name: "비서실장" }) as any;
  assert.ok(d.panes.some((p: any) => p.win === "막힌 노드"), "막힘 표시 · 내 차례가 빠지면 안 됨");
  assert.ok(!d.closed.some((c: any) => c.win === "막힌 노드"));
  assert.ok(d.closed.some((c: any) => c.win === "쉬는 노드"));
  assert.ok(d.closed.some((c: any) => c.win === "주차된 끝 노드"));
});
