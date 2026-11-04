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

const A = "member@example.com", B = "other@example.com";
// grant: 기기가 보드에서 「설정 바꾸기」 허락을 받은 채(device-settings.ts — 자리표 쓰기는 허락 뒤만). false 면 허락 없는 기기
function app(D1: D1Database, who: { device?: string | null; member?: string | null; same?: boolean; grant?: boolean } = { device: A }) {
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  mountImport(a, { device: async () => who.device ? { id: "dev1", owner: who.device, name: "mini" } : null, member: async () => who.member ?? null, sameSite: () => who.same ?? false });
  return async (method: string, path: string, body?: unknown) => {
    if (who.device && who.grant !== false) await D1.prepare("INSERT OR IGNORE INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").bind(who.device.toLowerCase(), "cli_settings:dev1", "1", 1).run();
    return a.request(path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: D1, PUBLIC_URL: "https://example.test" });
  };
}
const { post, paneOfId, paneLogs } = await import("./member-board.ts");
const ENV = { DB: null as unknown as D1Database, PUBLIC_URL: "https://example.test" };
const T = Date.now() - 60_000;
// 지어낸 창: 키 window:<win>, 같은 대화(session)
const win = (db: DatabaseSync, who: string, w: string, title: string, session = "", engine = "herdr-own", state = "working") =>
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, session, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(who, "window:" + w, "dev1", "window", engine, title, "/x/app", state, T, w, session, Date.now());
const sess = (db: DatabaseSync, who: string, s: string, title: string) =>
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, title, state, session, seen_at) VALUES (?,?,?,?,?,?,?,?)").run(who, s, "dev1", "session", title, "open", s, Date.now());
const gone = (db: DatabaseSync, w: string, at = Date.now()) => db.prepare("UPDATE imp_item SET gone_at = ?, state = 'gone' WHERE owner = ? AND key = ?").run(at, A, "window:" + w);
const log = (db: DatabaseSync, w: string, text: string, at = Date.now()) => db.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").run(A, w, "progress", text, at);
const mapOf = (db: DatabaseSync, item: string) => { const r = db.prepare("SELECT node, how FROM mnode_item WHERE owner = ? AND item = ?").get(A, item) as any; return r ? { ...r } : r; };
const mainOf = (db: DatabaseSync, id: string) => JSON.parse((db.prepare("SELECT counts FROM mnode WHERE owner = ? AND id = ?").get(A, id) as any).counts || "{}");
const nodeCount = (db: DatabaseSync) => (db.prepare("SELECT COUNT(*) n FROM mnode WHERE owner = ? AND archived_at IS NULL").get(A) as any).n;
const say = (D1: D1Database, id: string, name: string, text: string) => post(D1, A, "/api/chat", { pane: paneOfId(id), channel: "n:" + name, text });
const chanRows = async (D1: D1Database, id: string) => ((await paneLogs(D1, A)).chans.find(c => c.pane === paneOfId(id))?.rows || []).map(r => String(r.text));

async function seed(unit: "agent" | null = "agent") {
  const f = d1(), call = app(f.D1);
  f.db.prepare("INSERT INTO device(id, owner, name, token_hash, created_at) VALUES (?,?,?,?,?)").run("dev1", A, "host1", "h1", Date.now());
  if (unit) f.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ unit }), T);
  await call("POST", "/api/device/tasks", { tasks: [{ key: "dept_tech", name: "기술장", parent: "top" }, { key: "dept_sales", name: "영업장", parent: "top" }] });
  win(f.db, A, "host1:ew_tech01", "기술장", "session:codex:t1", "herdr-own");
  sess(f.db, A, "session:codex:t1", "기술장 세션입니다");
  win(f.db, A, "host1:ew_sales01", "영업장", "session:codex:s1", "herdr-own");
  sess(f.db, A, "session:codex:s1", "영업장 세션입니다");
  log(f.db, "host1:ew_tech01", "옛 기술장 창의 보고", T);
  await regroup({ ...ENV, DB: f.D1 } as never, A);
  return { ...f, call };
}
const SEATS1 = [{ name: "기술장", win: "host1:ew_tech01" }, { name: "영업장", win: "host1:ew_sales01" }];

test("전(자리표 없음): 기술장 창이 옮기면 부서 에이전트(tk_dept_tech)와 따로 놂 — 새 창 칸이 생기고 부서에 쓴 글은 창에 안 감", async () => {
  const { db, D1 } = await seed();
  gone(db, "host1:ew_tech01");
  win(db, A, "host1:ew_tech02", "기술장", "session:claude:t2", "herdr-own");
  await regroup({ ...ENV, DB: D1 } as never, A);
  assert.notEqual(mapOf(db, "window:host1:ew_tech02")?.node, "tk_dept_tech", "새 창은 부서 노드 밖 — 이것이 고칠 것");
  assert.equal(((await say(D1, "tk_dept_tech", "기술장", "지금 뭐 해요?")) as any).path, "/api/me/tasks/assign", "부서에 쓴 글이 창이 아니라 배정기로");
});

test("후: 자리표를 올리면 역할 노드에 지금 창 · 같은 대화가 pin, 주 창 = 그 창, 부서에 쓴 글이 그 창으로", async () => {
  const { db, D1, call } = await seed();
  const r = await call("POST", "/api/device/roles", { roles: SEATS1 });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json() as any;
  assert.deepEqual(j.seats.map((s: any) => [s.name, s.node, s.why]), [["기술장", "tk_dept_tech", "붙음"], ["영업장", "tk_dept_sales", "붙음"]]);
  assert.deepEqual(mapOf(db, "window:host1:ew_tech01"), { node: "tk_dept_tech", how: "pin" });
  assert.deepEqual(mapOf(db, "session:codex:t1"), { node: "tk_dept_tech", how: "pin" });
  assert.equal(mainOf(db, "tk_dept_tech").main, "window:host1:ew_tech01");
  const hop = await say(D1, "tk_dept_tech", "기술장", "지금 뭐 해요?") as any;
  assert.equal(hop.path, "/api/me/nodes/cmd"); assert.equal(hop.body.item, "window:host1:ew_tech01");
});

test("창 바뀜(기기 · Codex↔Claude): 표만 고치면 새 창으로 글이 가고, 옛 창 기록 · 새 창 답이 같은 에이전트 대화 — 새 칸 안 생김", async () => {
  const { db, D1, call } = await seed();
  await call("POST", "/api/device/roles", { roles: SEATS1 });
  const before = nodeCount(db);
  // 기술장 창이 다른 창으로 · 영업장은 Codex → Claude 되돌림(세션도 바뀜)
  gone(db, "host1:ew_tech01"); gone(db, "host1:ew_sales01");
  win(db, A, "host1:ew_tech02", "기술장", "session:claude:t2", "herdr-own"); sess(db, A, "session:claude:t2", "기술장 세션입니다");
  win(db, A, "host1:ew_tech03", "영업장", "session:claude:s2", "herdr-own"); sess(db, A, "session:claude:s2", "영업장 세션입니다");
  const r = await call("POST", "/api/device/roles", { roles: [{ name: "기술장", win: "host1:ew_tech02" }, { name: "영업장", win: "host1:ew_tech03" }] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(mapOf(db, "window:host1:ew_tech02"), { node: "tk_dept_tech", how: "pin" });
  assert.deepEqual(mapOf(db, "window:host1:ew_tech03"), { node: "tk_dept_sales", how: "pin" });
  assert.equal(mainOf(db, "tk_dept_tech").main, "window:host1:ew_tech02");
  assert.deepEqual(mainOf(db, "tk_dept_tech").past, ["host1:ew_tech01"]);
  assert.equal(nodeCount(db), before, "옮겨도 새 노드 칸이 안 생김");
  const hop = await say(D1, "tk_dept_sales", "영업장", "견적 어떻게 됐어요?") as any;
  assert.equal(hop.body?.item, "window:host1:ew_tech03", "영업장 글은 되돌린 새 창으로");
  log(db, "host1:ew_tech02", "새 기술장 창의 답");
  const rows = await chanRows(D1, "tk_dept_tech");
  assert.ok(rows.includes("새 기술장 창의 답") && rows.includes("옛 기술장 창의 보고"), JSON.stringify(rows));
});

test("주차 뒤 다시 열림: 옛 창이 하루 넘게 닫혀 들여온 목록에서 빠져도 옛 글은 같은 에이전트 대화(past)", async () => {
  const { db, D1, call } = await seed();
  await call("POST", "/api/device/roles", { roles: SEATS1 });
  gone(db, "host1:ew_tech01", Date.now() - 30 * 3600_000);
  db.prepare("DELETE FROM imp_item WHERE owner = ? AND key = 'window:host1:ew_tech01'").run(A);   // 들여오기가 오래된 창을 지운 것
  win(db, A, "host1:ew_tech02", "기술장", "session:claude:t2", "herdr-own");
  await call("POST", "/api/device/roles", { roles: [{ name: "기술장", win: "host1:ew_tech02" }, SEATS1[1]] });
  const rows = await chanRows(D1, "tk_dept_tech");
  assert.ok(rows.includes("옛 기술장 창의 보고"), JSON.stringify(rows));
});

test("창이 아직 안 들어옴 · 역할 노드 없음 · 같은 이름 둘: 아무것도 안 바꾸고 판정만 · 다음 들여오기 뒤 묶기에서 붙음", async () => {
  const { db, D1, call } = await seed();
  await call("POST", "/api/device/roles", { roles: SEATS1 });
  const r = await call("POST", "/api/device/roles", { roles: [{ name: "기술장", win: "host1:ew_notyet" }, { name: "법무장", win: "host1:ew_tech01" }] });
  const j = await r.json() as any;
  assert.deepEqual(j.seats.map((s: any) => s.why), ["창이 아직 안 들어옴", "역할 노드 없음"]);
  assert.equal(mainOf(db, "tk_dept_tech").main, "window:host1:ew_tech01", "못 찾으면 예전 주 창 그대로");
  win(db, A, "host1:ew_notyet", "기술장 (새 기기)", "", "herdr-own");
  await regroup({ ...ENV, DB: D1 } as never, A);
  assert.deepEqual(mapOf(db, "window:host1:ew_notyet"), { node: "tk_dept_tech", how: "pin" }, "들여온 뒤 다음 묶기에서 붙음");
});

test("비서실장(primary): 지금 창이 메인 봇 창(primary_item) — 창이 바뀌면 메인 봇도 따라감", async () => {
  const { db, D1, call } = await seed();
  win(db, A, "host2:ew_chief1", "비서실장", "", "herdr-own");
  await call("POST", "/api/device/roles", { roles: [{ name: "비서실장", win: "host2:ew_chief1", primary: true }] });
  const pi = () => JSON.parse((db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(A) as any).data).primary_item;
  assert.equal(pi(), "window:host2:ew_chief1");
  gone(db, "host2:ew_chief1"); win(db, A, "host1:ew_chief2", "비서실장", "", "herdr-own");
  await call("POST", "/api/device/roles", { roles: [{ name: "비서실장", win: "host1:ew_chief2", primary: true }] });
  assert.equal(pi(), "window:host1:ew_chief2");
});

test("거절: 틀린 꼴 · 같은 역할 둘 · primary 둘 · 토큰 없음 · 남의 표는 안 보임", async () => {
  const { D1, call } = await seed();
  const bad = async (body: unknown, status = 400, c = call) => { const r = await c("POST", "/api/device/roles", body); assert.equal(r.status, status, `${JSON.stringify(body)} → ${await r.text()}`); };
  await bad({ roles: [{ name: "기술장" }] });
  await bad({ roles: [{ name: "기술장", win: "띄어 쓴 창" }] });
  await bad({ roles: [{ name: "기술장", win: "a:b" }, { name: "기술장", win: "a:c" }] });
  await bad({ roles: [{ name: "가", win: "a:b", primary: true }, { name: "나", win: "a:c", primary: true }] });
  await bad({ roles: [{ name: "기술장", win: "a:b", node: "n_abc" }] });
  await bad({ roles: SEATS1 }, 401, app(D1, { device: null }));
  await bad({ roles: SEATS1 }, 403, app(D1, { device: B, grant: false }));   // 보드 허락 없는 기기 토큰은 못 씀(device-settings.ts)
  assert.equal((await app(D1, { device: B, grant: false })("GET", "/api/device/roles")).status, 200, "읽기는 허락 없이도");
  assert.equal((await app(D1, { device: null, member: A, same: true })("POST", "/api/device/roles", { roles: SEATS1 })).status, 200, "같은 사이트 회원 화면은 허락 없이");
  await call("POST", "/api/device/roles", { roles: SEATS1 });
  const other = await app(D1, { device: B })("GET", "/api/device/roles");
  assert.deepEqual(((await other.json()) as any).seats, [], "다른 회원 표는 안 보임");
});

test("자리표 없는 회원은 예전 그대로: 묶기 결과 · 주 창이 표를 올리기 전과 같음", async () => {
  const { db, D1 } = await seed();
  const snap = () => JSON.stringify(db.prepare("SELECT item, node, how FROM mnode_item WHERE owner = ? ORDER BY item").all(A));
  const s0 = snap();
  await regroup({ ...ENV, DB: D1 } as never, A);
  assert.equal(snap(), s0);
  assert.equal(mainOf(db, "tk_dept_tech").main, undefined);
});

test("채널 = 태스크를 켠 회원 · 일마다 채널(unit 없음)도 같음: 주 창이 자리표 창으로 남고 글이 그 창으로", async () => {
  for (const [unit, tc] of [["agent", true], [null, false], [null, true]] as const) {
    const { db, D1, call } = await seed(unit);
    db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET data = json_set(data, '$.task_channels', json(?4))").run(A, JSON.stringify({ task_channels: tc }), T, JSON.stringify(tc));
    win(db, A, "host1:ew_other", "기술장 보조 창", "", "herdr-own");   // 같은 노드 후보가 될 수 있는 다른 열린 창
    gone(db, "host1:ew_tech01");
    win(db, A, "host1:ew_tech02", "기술장", "session:claude:t2", "herdr-own");
    await call("POST", "/api/device/roles", { roles: [{ name: "기술장", win: "host1:ew_tech02" }] });
    await regroup({ ...ENV, DB: D1 } as never, A);
    assert.equal(mainOf(db, "tk_dept_tech").main, "window:host1:ew_tech02", `unit=${unit} tc=${tc}`);
    const hop = await say(D1, "tk_dept_tech", "기술장", "확인") as any;
    assert.equal(hop.body?.item, "window:host1:ew_tech02", `unit=${unit} tc=${tc} ${JSON.stringify(hop)}`);
  }
});

const { chatToMain, importedPrimary } = await import("./engine.ts");
const { data } = await import("./member-board.ts");
const oldFront = (db: DatabaseSync, id: string, name: string, w: string, text: string) => {
  db.prepare("INSERT INTO mnode(owner, id, name, pinned_name, area, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(A, id, name, name, "", "idle", "", "{}", T, T);
  db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?, 'pin')").run(A, "win:" + w, id);
  log(db, w, text, T);
};

test("Primary = 비서실장: Primary 채팅 글이 지금 비서실장 창으로(엔진 send) — 창이 바뀌면 새 창으로", async () => {
  const { db, D1, call } = await seed();
  win(db, A, "host2:ew_chief3", "비서실장", "session:claude:chief", "herdr-own");
  await call("POST", "/api/device/roles", { roles: [{ name: "비서실장", win: "host2:ew_chief3", primary: true }, ...SEATS1] });
  assert.equal((await importedPrimary(D1, A))?.key, "window:host2:ew_chief3");
  const r = await chatToMain({ DB: D1 } as never, A, "이번 주 부서별로 나눠 줘") as any;
  assert.equal(r.primary, "window:host2:ew_chief3");
  const cmd = db.prepare("SELECT verb, args FROM engine_cmd WHERE owner = ? ORDER BY at DESC LIMIT 1").get(A) as any;
  assert.equal(cmd.verb, "send"); assert.equal(JSON.parse(cmd.args).item, "window:host2:ew_chief3");
  gone(db, "host2:ew_chief3"); win(db, A, "host1:ew_chief2", "비서실장", "session:claude:chief2", "herdr-own");
  await call("POST", "/api/device/roles", { roles: [{ name: "비서실장", win: "host1:ew_chief2", primary: true }, ...SEATS1] });
  assert.equal(((await chatToMain({ DB: D1 } as never, A, "다시")) as any).primary, "window:host1:ew_chief2");
});

test("옛 앞단 셋(fold)은 Primary 대화로: 왼쪽 칸에서 빠지고 그 기록은 Primary 에 남음 · 없는 이름은 판정에 · 원본 노드는 안 지움", async () => {
  const { db, D1, call } = await seed();
  win(db, A, "host2:ew_chief3", "비서실장", "", "herdr-own");
  oldFront(db, "n_old_co", "회사", "host2:old_co", "옛 회사 앞단 글");
  oldFront(db, "n_old_lead", "팀장", "host2:old_lead", "옛 팀장 앞단 글");
  const r = await call("POST", "/api/device/roles", { roles: [{ name: "비서실장", win: "host2:ew_chief3", primary: true, fold: ["회사", "팀장", "Chief of Staff"] }, ...SEATS1] });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json() as any;
  assert.deepEqual([j.front.folded.sort(), j.front.missing], [["회사", "팀장"].sort(), ["Chief of Staff"]]);
  const d = await data(D1, A, { name: "비서실장" }) as any;
  const names = d.panes.map((p: any) => p.win);
  assert.equal(d.panes[0].win, "비서실장", "Primary 이름 = 비서실장");
  assert.ok(!names.includes("회사") && !names.includes("팀장"), JSON.stringify(names));
  const prim = (await paneLogs(D1, A)).paneOfLog({ win: "host2:old_co", kind: "progress" });
  assert.equal(prim, "%1", "옛 앞단 글은 Primary 판");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM mnode WHERE owner = ? AND id IN ('n_old_co','n_old_lead')").get(A) as any).n, 2, "원본 노드는 남음");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM board_log WHERE owner = ? AND win IN ('host2:old_co','host2:old_lead')").get(A) as any).n, 2, "글도 남음");
});

test("fold 거절: primary 가 아닌 자리 · 빈 이름 · 9개 이상", async () => {
  const { call } = await seed();
  for (const roles of [[{ name: "기술장", win: "a:b", fold: ["팀장"] }], [{ name: "비서실장", win: "a:b", primary: true, fold: [""] }], [{ name: "비서실장", win: "a:b", primary: true, fold: Array.from({ length: 9 }, (_, i) => "n" + i) }]])
    assert.equal((await call("POST", "/api/device/roles", { roles })).status, 400, JSON.stringify(roles));
});

test("옛 앞단 세 칸 글이 Primary 에 시각 순 · 표지 붙어 · 원본 그대로 · 새 글은 Primary 로만", async () => {
  const { db, D1, call } = await seed();
  const { get } = await import("./member-board.ts");
  win(db, A, "host2:ew_chief3", "비서실장", "", "herdr-own");
  oldFront(db, "n_old_co", "회사", "host2:old_co", "회사 첫 글");
  oldFront(db, "n_old_lead", "팀장", "host2:old_lead", "팀장 첫 글");
  oldFront(db, "n_old_cos", "Chief of Staff", "host2:old_cos", "CoS 첫 글");
  const at = (w: string, text: string, dt: number) => db.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").run(A, w, "progress", text, T + dt);
  db.prepare("UPDATE board_log SET at = ? WHERE owner = ? AND win = 'host2:old_co'").run(T + 1000, A);
  db.prepare("UPDATE board_log SET at = ? WHERE owner = ? AND win = 'host2:old_lead'").run(T + 2000, A);
  db.prepare("UPDATE board_log SET at = ? WHERE owner = ? AND win = 'host2:old_cos'").run(T + 3000, A);
  at("host2:old_co", "회사 둘째 글", 4000);
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "나", "chat", "내 Primary 글", "primary", T + 5000);
  at("host2:old_lead", "팀장 둘째 글", 6000);
  const before = (db.prepare("SELECT COUNT(*) n FROM board_log WHERE owner = ? AND win != '보더'").get(A) as any).n;   // 기기가 표를 바꾼 기록 줄(보더)은 원본 글이 아님
  const r = await call("POST", "/api/device/roles", { roles: [{ name: "비서실장", win: "host2:ew_chief3", primary: true, fold: ["회사", "팀장", "Chief of Staff"] }, ...SEATS1] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual((await r.json() as any).front.missing, []);
  const res = await get(D1, A, { name: "비서실장" }, new URL("https://demo.test/api/chat/primary"), async () => null);
  assert.ok(res); const j = await res!.json() as any;
  const ours = j.messages.filter((m: any) => /첫 글|둘째 글|내 Primary 글/.test(m.text));
  assert.deepEqual(ours.map((m: any) => m.text), ["회사 첫 글", "팀장 첫 글", "CoS 첫 글", "회사 둘째 글", "내 Primary 글", "팀장 둘째 글"], "시각 순으로 섞여 이어짐");
  assert.deepEqual(ours.map((m: any) => m.tag ?? null), ["옛 회사", "옛 팀장", "옛 Chief of Staff", "옛 회사", null, "옛 팀장"], "줄마다 어디서 왔는지");
  assert.ok(ours.every((m: any) => m.who === "owner" || m.name === "비서실장"));
  // 원본: 노드 · 글 그대로(세 칸 노드 남음, 글 수 같음)
  assert.equal((db.prepare("SELECT COUNT(*) n FROM mnode WHERE owner = ? AND id IN ('n_old_co','n_old_lead','n_old_cos')").get(A) as any).n, 3);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM board_log WHERE owner = ? AND win != '보더'").get(A) as any).n, before, "글을 지우지 않음");
  // 왼쪽 목록에서 옛 칸은 숨김
  const d = await data(D1, A, { name: "비서실장" }) as any, names = d.panes.map((p: any) => p.win);
  assert.ok(!["회사", "팀장", "Chief of Staff"].some(n => names.includes(n)), JSON.stringify(names));
  // 새 글: 옛 칸 판으로 보내도 Primary 길 하나
  for (const id of ["n_old_co", "n_old_lead", "n_old_cos"]) assert.deepEqual(await post(D1, A, "/api/chat", { pane: paneOfId(id), text: "새 요청" }), { path: "/api/me/chat", body: { text: "새 요청" } });
});

const { seatPlan } = await import("./role-seat.ts");
const W = (w: string, at = 1) => ({ key: "window:" + w, kind: "window", win: w, state: "working", state_at: at });
test("메인 봇(primary) 창은 부서 자리가 못 가져감 — 표 순서와 상관없이 「다른 역할이 이미 이 창」", () => {
  const tasks = [{ id: "tk_dept_tech", name: "기술장" }];
  for (const seats of [[{ name: "비서실장", win: "m:1", primary: true }, { name: "기술장", win: "m:1" }], [{ name: "기술장", win: "m:1" }, { name: "비서실장", win: "m:1", primary: true }]]) {
    const p = seatPlan({ seats, items: [W("m:1")], tasks, map: [] });
    assert.equal(p.primary, "window:m:1");
    assert.deepEqual(p.pins, [], JSON.stringify(p.pins));
    assert.deepEqual(p.mains, []);
    assert.equal(p.seats.find(s => s.name === "기술장")?.why, "다른 역할이 이미 이 창");
  }
});
test("두 역할의 옛 창(past)이 같아도 win: pin 은 한 자리만(먼저 적힌 역할) — 묶기를 되풀이해도 안 오감", () => {
  const seats = [{ name: "기술장", win: "m:a" }, { name: "영업장", win: "m:b" }];
  const tasks = [{ id: "tk_tech", name: "기술장", counts: JSON.stringify({ main: "window:m:a", past: ["m:old"] }) }, { id: "tk_sales", name: "영업장", counts: JSON.stringify({ main: "window:m:b", past: ["m:old"] }) }];
  const map = [{ item: "window:m:a", node: "tk_tech", how: "pin" }, { item: "window:m:b", node: "tk_sales", how: "pin" }];
  const p1 = seatPlan({ seats, items: [W("m:a"), W("m:b")], tasks, map });
  assert.deepEqual(p1.pins, [{ item: "win:m:old", node: "tk_tech" }]);
  const p2 = seatPlan({ seats, items: [W("m:a"), W("m:b")], tasks, map: [...map, { item: "win:m:old", node: "tk_tech", how: "pin" }] });
  assert.deepEqual(p2.pins, [], "두 번째 묶기에서 다른 자리로 안 옮김");
});
