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
const { data, paneOfId } = await import("./member-board.ts");

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

const ME = "lee@example.test", T = Date.now();
function setup() {
  const { db, D1 } = d1();
  const item = db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, session, handle, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  item.run(ME, "window:lap:herdr:p2", "d1", "window", "herdr-own", "#12 버그", "/home/lee/app", "working", T, "lap:herdr:p2", "", JSON.stringify({ engine: "herdr-own", pane: "p2" }), T);
  const node = db.prepare("INSERT INTO mnode(owner, id, name, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)");
  node.run(ME, "n_bug", "#12 버그", "working", "", "{}", T, T);
  db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)").run(ME, "window:lap:herdr:p2", "n_bug", "auto");
  return { db, D1 };
}
const ew = (db: DatabaseSync, id: string, name: string, state: string, kind = "role") =>
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?)").run(id, ME, "d1", kind, name, state, T, T);

test("역할 창이 없는 사람: 판에 rolewin 칸이 하나도 없음(예전 판 그대로)", async () => {
  const { db, D1 } = setup();
  ew(db, "ew_main", "모찌", "idle", "main");   // 메인 봇 창은 역할 창이 아님
  const d = await data(D1, ME, { name: "모찌" }) as any;
  assert.ok(d.panes.length >= 2);
  assert.ok(d.panes.every((p: any) => !("rolewin" in p)), JSON.stringify(d.panes.map((p: any) => Object.keys(p))));
});

test("노드에 안 묶인 엔진 역할 창 = 제 판(%N)에 rolewin, 메인 봇 · 보통 노드엔 없음", async () => {
  const { db, D1 } = setup();
  ew(db, "ew_r1", "기술장", "busy");
  const d = await data(D1, ME, { name: "모찌" }) as any;
  const p = d.panes.find((x: any) => x.pane === paneOfId("ew_r1"));
  assert.ok(p, "역할 창 판이 있음");
  assert.equal(p.rolewin, true); assert.equal(p.kind, "lead"); assert.equal(p.win, "기술장");
  assert.ok(!("rolewin" in d.panes[0]), "메인 봇 판엔 없음");
  assert.ok(!("rolewin" in d.panes.find((x: any) => x.win === "#12 버그")), "보통 노드엔 없음");
});

test("역할 창이 묶인 노드(이름이 역할 창 이름) = 그 노드 판에 rolewin, 따로 엔진 판은 안 생김", async () => {
  const { db, D1 } = setup();
  db.prepare("INSERT INTO mnode(owner, id, name, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(ME, "n_chief", "비서실장", "working", "", "{}", T, T);
  ew(db, "ew_r2", "비서실장", "idle");
  const d = await data(D1, ME, { name: "모찌" }) as any;
  const ps = d.panes.filter((x: any) => x.win === "비서실장");
  assert.equal(ps.length, 1, "한 판만");
  assert.equal(ps[0].pane, paneOfId("n_chief")); assert.equal(ps[0].rolewin, true);
  assert.ok(!d.panes.some((x: any) => x.pane === paneOfId("ew_r2")));
});

test("닫힘 · 실패 · 사라진 역할 창은 표지 없음, 주차한 역할 창은 판이 아니라 주차 목록(예전 그대로)", async () => {
  const { db, D1 } = setup();
  db.prepare("INSERT INTO mnode(owner, id, name, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(ME, "n_old", "옛 역할", "working", "", "{}", T, T);
  ew(db, "ew_c", "옛 역할", "closed"); ew(db, "ew_p", "주차 역할", "parked");
  const d = await data(D1, ME, { name: "모찌" }) as any;
  assert.ok(d.panes.every((p: any) => !("rolewin" in p)), "닫힌 역할 창 이름의 노드엔 표지 없음 · 주차 창은 판 없음");
  assert.ok(d.parked.some((q: any) => q.pane === paneOfId("ew_p")));
});

test("업무 노드(tk_)는 역할 창 이름이어도 표지 없음 — 부서 · 업무는 예전 길(에이전트 칸 tkdept · 태스크)", async () => {
  const { db, D1 } = setup();
  db.prepare("INSERT INTO mnode(owner, id, name, state, why, counts, created_at, updated_at, task) VALUES (?,?,?,?,?,?,?,?,?)").run(ME, "tk_dept_tech", "기술장", "working", "", "{}", T, T, JSON.stringify({ state: "working" }));
  ew(db, "ew_r3", "기술장", "busy");
  const d = await data(D1, ME, { name: "모찌" }) as any;
  assert.ok(d.panes.every((p: any) => !("rolewin" in p)));
});

const shell = readFileSync(new URL("./legacy/shell.js", import.meta.url), "utf8");
const rwOf = (o: { panes: any[]; member?: boolean; RS?: string[] | null; MA2?: any[] }) => {
  const line = shell.match(/^    const RW = .*$/m)![0];
  return new Function("window", "panes", "RS", "MA2", "mainOnly", line + "; return [RW.map(p => p.pane), [...RWP]];")(o.member === false ? {} : { HB_MEMBER: { email: "x" } }, o.panes, o.RS ?? null, o.MA2 || [], () => false);
};
const PANES = [{ pane: "%1", kind: "primary" }, { pane: "%2", kind: "lead", rolewin: true }, { pane: "%3", kind: "lead" }, { pane: "%4", kind: "lead", rolewin: true }, { pane: "%5", kind: "lead", rolewin: true, tk: true }];
test("화면: 역할 창 판만 에이전트로(업무 · 열 머리로 이미 있는 판 빼고), 채널 칸에서 뺄 판도 같은 것", () => {
  const [rw, rwp] = rwOf({ panes: PANES, MA2: [{ key: "m0", lead: "%4" }] });
  assert.deepEqual(rw, ["%2"]); assert.deepEqual(rwp, ["%2"]);
});
test("화면: 자리표 있는 회원 · 주인 · 역할 창 없는 사람은 빈 목록(사이드바 예전 그대로)", () => {
  assert.deepEqual(rwOf({ panes: PANES, RS: ["기술장"] })[0], []);
  assert.deepEqual(rwOf({ panes: PANES.map(({ rolewin, ...p }) => p), member: false })[0], [], "주인 판(하네스 스냅숏)엔 rolewin 이 없음 — 판정은 데이터(rolewin)만");
  assert.doesNotMatch(shell.match(/^    const RW = .*$/m)![0], /HB_MEMBER/, "사람 종류로 안 가름");
  assert.deepEqual(rwOf({ panes: PANES.map(({ rolewin, ...p }) => p) })[0], []);
});
test("화면: 채널 칸은 RWP 를 빼고, 에이전트 줄은 열 머리 줄과 같은 꼴(blob · 이름 · 내 차례 점 · 지금 연 판)", () => {
  assert.match(shell, /const nd = myNodes\(\)\.filter\(p => !RWP\.has\(p\.pane\)\)\.map\(/);
  assert.match(shell, /\+ RW\.map\(p => it\('node:' \+ p\.pane, blob\(nameOf\(p\), 20\), esc\(nameOf\(p\)\), rowPanes\(\)\.has\(p\.pane\) \? '<i class="ud" aria-label="내 차례"><\/i>' : '', pg === p\.pane\)\)\.join\(''\);/);
});
