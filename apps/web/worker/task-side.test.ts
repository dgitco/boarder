// node --test --no-warnings --experimental-transform-types apps/web/worker/task-side.test.ts — 사이드 「태스크」(member-board taskSide · /api/data task_side · role_seats). 자료는 다 지어낸 것
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

// engine.ts 의 cloudflare:workers 는 Workers 밖에 없음 — 빈 DurableObject 로 갈음(node-close.test.ts 와 같음)
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { mountImport, regroup } = await import("./importer/routes.ts");
const { Hono } = await import("hono");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const batch = async (ss: any[]) => {
    db.exec("BEGIN");
    try { const out = []; for (const s of ss) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database };
}

const A = "member@example.com";
function app(D1: D1Database) {
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  mountImport(a, { device: async () => ({ id: "dev1", owner: A, name: "host1" }), member: async () => null, sameSite: () => false });
  return (method: string, path: string, body?: unknown) => a.request(path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: D1, PUBLIC_URL: "https://example.test" });
}
const { post, paneOfId, data, paneLogs, taskSide } = await import("./member-board.ts");
const ENV = { DB: null as unknown as D1Database, PUBLIC_URL: "https://example.test" };
const H = 3600_000, NOW = Date.now();
const win = (db: DatabaseSync, w: string, title: string, session = "", at = NOW) =>
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, repo, state, state_at, win, session, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(A, "window:" + w, "dev1", "window", "herdr-own", title, "/x/app", "example-org/app", "working", at, w, session, at);
const gone = (db: DatabaseSync, w: string, at = NOW) => db.prepare("UPDATE imp_item SET gone_at = ?, state = 'gone' WHERE owner = ? AND key = ?").run(at, A, "window:" + w);
const log = (db: DatabaseSync, w: string, text: string, at = NOW) => db.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").run(A, w, "progress", text, at);
const rg = (D1: D1Database) => regroup({ ...ENV, DB: D1 } as never, A);

async function seed(tc = true) {
  const f = d1(), call = app(f.D1);
  f.db.prepare("INSERT INTO device(id, owner, name, token_hash, created_at) VALUES (?,?,?,?,?)").run("dev1", A, "host1", "h1", NOW);
  f.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ unit: "agent", task_channels: tc, task_repo: "example-org/app" }), NOW);
  const r = await call("POST", "/api/device/tasks", { tasks: [
    { key: "dept_tech", name: "기술장", parent: "top" },
    { key: "6386", name: "#6386 은행 거래 정리", issue: 6386, parent: "tk_dept_tech", state: "working" },
    { key: "6400", name: "영수증 칸 채우기", issue: 6400, parent: "tk_dept_tech", state: "blocked" },
    { key: "6100", name: "옛 일", issue: 6100, parent: "tk_dept_tech", state: "done" },
  ] });
  assert.equal(r.status, 200, await r.clone().text());
  win(f.db, "host1:ew_a6386", "#6386 은행 거래 정리 담당", "session:claude:a");
  log(f.db, "host1:ew_a6386", "6386 첫 보고", NOW - 3 * H);
  win(f.db, "host1:ew_w6400", "작업자 #6400 영수증", "session:codex:w");
  log(f.db, "host1:ew_w6400", "6400 작업자 보고", NOW - 60_000);
  await rg(f.D1);
  return { ...f, call };
}
const side = async (D1: D1Database) => ((await data(D1, A, null)) as any).task_side as any[];
const rowsOf = async (D1: D1Database, pane: string) => ((await paneLogs(D1, A)).chans.find(c => c.pane === pane)?.rows || []).map(r => String(r.text));

test("목록: 번호 있는 업무만(부서 뺌) · 진행 중 최근 글 순 · 끝난 것 뒤(done) · 제목 앞 #번호는 떼고 번호 칸에", async () => {
  const { D1 } = await seed();
  const s = await side(D1);
  assert.deepEqual(s.map(t => [t.issue, t.name, t.state_ko, t.done]), [
    ["#6400", "영수증 칸 채우기", "막힘", false],
    ["#6386", "은행 거래 정리", "진행", false],
    ["#6100", "옛 일", "완료", true],
  ]);
  assert.equal(s[0].pane, paneOfId("tk_6400"));
});

test("창 바뀜(다른 기기 · Codex↔Claude) · 주차 뒤 다시 열림: 같은 태스크 대화에 이어 붙고, 태스크에 쓴 글은 지금 담당 창으로", async () => {
  const { db, D1 } = await seed();
  gone(db, "host1:ew_a6386", NOW - 2 * H);
  win(db, "host2:ew_b6386", "#6386 은행 거래 정리 담당 (다시 엶)", "session:claude:b");
  log(db, "host2:ew_b6386", "6386 새 창 보고");
  await rg(D1);
  const pane = paneOfId("tk_6386");
  const rows = await rowsOf(D1, pane);
  assert.ok(rows.includes("6386 첫 보고") && rows.includes("6386 새 창 보고"), JSON.stringify(rows));
  assert.equal((await side(D1)).filter(t => t.issue === "#6386").length, 1, "태스크 칸이 하나 그대로");
  const hop = await post(D1, A, "/api/chat", { pane, channel: "n:#6386 은행 거래 정리", text: "어디까지 됐어요?" }) as any;
  assert.equal(hop.path, "/api/me/nodes/cmd"); assert.equal(hop.body.item, "window:host2:ew_b6386");
  assert.equal(((await side(D1)).find(t => t.issue === "#6386")).ago, 0, "새 글이 오면 최근 순 맨 앞으로");
});

test("에이전트 목록 자료: 자리표가 있으면 role_seats = 부서장 이름(메인 봇 primary 칸은 뺌), 없으면 칸 없음", async () => {
  const { db, D1, call } = await seed();
  assert.equal(((await data(D1, A, null)) as any).role_seats, undefined);
  win(db, "host1:ew_tech02", "기술장", "session:claude:t");
  win(db, "host2:ew_chief", "비서실장");
  db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(A, "cli_settings:dev1", "1", 1);   // 자리표 쓰기는 보드에서 허락받은 기기만(device-settings.ts)
  assert.equal((await call("POST", "/api/device/roles", { roles: [{ name: "비서실장", win: "host2:ew_chief", primary: true }, { name: "기술장", win: "host1:ew_tech02" }] })).status, 200);
  assert.deepEqual(((await data(D1, A, null)) as any).role_seats, ["기술장"]);
});

test("채널 = 태스크를 끈 회원은 예전 그대로: task_side 칸 없음", async () => {
  const { D1 } = await seed(false);
  assert.equal(await side(D1), undefined);
});

test("taskSide 순수 계산: 보관된 업무는 끝난 것 · 같은 시각이면 판 번호 순", () => {
  const nodes = [{ id: "tk_1", pane: "%2", name: "가", archived_at: 5, state: "idle" }, { id: "tk_2", pane: "%1", name: "나", archived_at: null, state: "idle" }, { id: "tk_3", pane: "%3", name: "다", archived_at: null, state: "idle" }];
  const tasks = new Map<string, any>([["tk_1", { state: "working", issue: "#1" }], ["tk_2", { state: "waiting", issue: "#2" }], ["tk_3", { state: "working", issue: "#3" }]]);
  const out = taskSide(nodes as never, tasks, new Map([["tk_2", 10], ["tk_3", 10], ["tk_1", 99]]), 60_000);
  assert.deepEqual(out.map(t => [t.issue, t.done]), [["#2", false], ["#3", false], ["#1", true]]);
});
