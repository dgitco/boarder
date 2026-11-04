import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
const { placeOrder, panesOk, orderFromData, deptOf, deptMatch, ORDER_MAX } = await import("./node-order.ts");
const { data, paneOfId } = await import("./member-board.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => run1(sql, args),
  });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = ss.map(s => /^\s*select/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; } } } as unknown as D1Database;
  return { db, D1 };
}
const OWNER = "owner@example.test", A = "kim@example.test", B = "lee@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
const T = Date.now();
const DEPTS = ["운영장", "기술장", "영업장"];
function setup() {
  const { db, D1 } = d1();
  for (const m of [A, B]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, OWNER, T);
  const node = db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, task, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const tk = (o: string, id: string, name: string, task: object) => node.run(o, id, name, "", "working", "", JSON.stringify(task), "{}", T, T);
  DEPTS.forEach((n, i) => tk(A, "tk_d" + i, n, { state: "working", line: "", issue: "" }));
  tk(A, "tk_101", "#101 은행 규칙", { state: "working", line: "", issue: "#101" });                               // 상위 = 기술장
  tk(A, "tk_102", "#102 영업 덱", { state: "blocked", line: "", issue: "#102", fields: { dept: "dept:sales" } });   // 업무 칸 dept
  tk(A, "tk_103", "#103 어디에도 없음", { state: "working", line: "", issue: "#103" });
  tk(B, "tk_b0", "B 부서", { state: "working", line: "", issue: "" });
  const set = db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)");
  set.run(A, JSON.stringify({ task_channels: true, roles: DEPTS.map((n, i) => ({ name: n, win: `mbp:ew_d${i}`, node: "tk_d" + i })), parent: { tk_d0: "top", tk_d1: "top", tk_d2: "top", tk_101: "tk_d1" } }), T);
  set.run(B, JSON.stringify({ order: ["tk_b0"], unit: "goal" }), T);
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (body: unknown, h: Record<string, string>) => {
    const r = await app.fetch(new Request("https://example.test/api/me/nodes/order", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }), env, ctx);
    return { status: r.status, j: await r.json().catch(() => null) as any };
  };
  const human = async (email = A) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  const orderOf = (o: string) => orderFromData((db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(o) as any)?.data);
  return { db, D1, call, human, orderOf };
}
const P = (id: string) => paneOfId(id);

test("계산: 형제 묶음을 그 첫 자리에 새 순서로 · 다른 묶음 그대로 · 처음이면 끝에", () => {
  assert.deepEqual(placeOrder(["x", "a", "b", "y", "c"], ["c", "a", "b"]), ["x", "c", "a", "b", "y"]);
  assert.deepEqual(placeOrder(["x", "y"], ["b", "a"]), ["x", "y", "b", "a"]);
  assert.deepEqual(placeOrder([], ["a", "b"]), ["a", "b"]);
  assert.deepEqual(panesOk(["%1000001", "%1000002"]), ["%1000001", "%1000002"]);
  for (const bad of [["%1"], ["%1", "%1"], ["a", "%2"], "x", null, Array.from({ length: 61 }, (_, i) => "%" + (i + 10))]) assert.equal(panesOk(bad), null);
  assert.deepEqual(orderFromData('{"order":["a","a","b",3,"c d"]}'), ["a", "b"], "겹침 · 틀린 꼴 버림");
});

test("업무 부서: 상위 사슬의 자리표 부서 → 아니면 업무 칸 dept(tech · 기술 · 기술장 · dept:tech) → 못 정하면 빈 값", () => {
  const seats = ["운영장", "기술장", "영업장"], seatName = new Map([["tk_d1", "기술장"]]);
  assert.equal(deptOf("tk_x", { parents: { tk_x: "tk_y", tk_y: "tk_d1" }, seatName, seats }), "기술장", "두 층 위");
  assert.equal(deptOf("tk_d1", { parents: {}, seatName, seats }), "", "부서 노드 자신은 부서 그룹 머리라 태스크 부서 없음");
  for (const v of ["tech", "기술", "기술장", "dept:tech", "DEPT:Tech"]) assert.equal(deptMatch(v, seats), "기술장", v);
  assert.equal(deptOf("tk_z", { parents: {}, seatName, seats, fields: { 부서: "영업" } }), "영업장");
  assert.equal(deptMatch("hr", seats), ""); assert.equal(deptMatch(3, seats), "");
});

test("API: 회원이 내 노드 순서를 저장 → 판의 열 · 부서 그룹이 그 순서, 다른 사람 순서는 그대로", async () => {
  const s = setup();
  const before = await data(s.D1, A, { name: "비서실장" }) as any;
  assert.deepEqual(before.role_seats, DEPTS, "저장 전 = 자리표 순서");
  const r = await s.call({ panes: [P("tk_d2"), P("tk_d0"), P("tk_d1")] }, await s.human());
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.n, 3);
  assert.deepEqual(s.orderOf(A), ["tk_d2", "tk_d0", "tk_d1"]);
  assert.deepEqual(s.orderOf(B), ["tk_b0"], "B 순서 안 바뀜");
  const d = await data(s.D1, A, { name: "비서실장" }) as any;
  assert.deepEqual(d.areas.filter((a: any) => a.key !== "primary").map((a: any) => a.name), ["영업장", "운영장", "기술장", "분류 안 됨"], "열 순서(분류 안 됨은 늘 끝 — 부서 없는 #103)");
  assert.deepEqual(d.role_seats, ["영업장", "운영장", "기술장"], "사이드바 부서 그룹 순서도 같게");
  assert.equal(d.panes.find((p: any) => p.win === "영업장").ord, 0);
  const side = Object.fromEntries(d.task_side.map((t: any) => [t.issue, t.dept]));
  assert.deepEqual(side, { "#101": "기술장", "#102": "영업장", "#103": "" }, "태스크마다 부서");
  const db0 = await data(s.D1, B, null) as any;
  assert.ok(!db0.task_side && !("role_seats" in db0), "자리표 없는 사람은 부서 칸 없음");
});

test("API 경계: 남의 노드가 섞이면 404 · 아무것도 안 씀 / 주인 · 로그인 없음 · 다른 사이트 403 / 틀린 몸 400", async () => {
  const s = setup();
  assert.equal((await s.call({ panes: [P("tk_d0"), P("tk_b0")] }, await s.human())).status, 404);
  assert.deepEqual(s.orderOf(A), [], "A 에 안 씀");
  assert.deepEqual(s.orderOf(B), ["tk_b0"], "B 에 안 씀");
  assert.equal((await s.call({ panes: [P("tk_b0"), P("tk_d0")] }, await s.human(B))).status, 404, "B 가 A 노드를 못 넣음");
  assert.equal((await s.call({ panes: [P("tk_d0"), P("tk_d1")] }, await s.human(OWNER))).status, 403, "주인 아님(회원만)");
  assert.equal((await s.call({ panes: [P("tk_d0"), P("tk_d1")] }, { "x-hb": "1", "sec-fetch-site": "same-origin" })).status, 403, "로그인 없음");
  assert.equal((await s.call({ panes: [P("tk_d0"), P("tk_d1")] }, { ...(await s.human()), "sec-fetch-site": "cross-site" })).status, 403, "다른 사이트");
  assert.equal((await s.call({ panes: [P("tk_d0")] }, await s.human())).status, 400);
  assert.equal((await s.call({ panes: "x" }, await s.human())).status, 400);
  assert.deepEqual(s.orderOf(A), []);
});

test("자리표 노드 이름이 역할 이름과 달라도: 태스크 부서 · 사이드바 순서 · 부서 머리가 역할 이름으로 이어짐", async () => {
  const s = setup();
  s.db.prepare("UPDATE mnode SET name = '기술팀' WHERE owner = ? AND id = 'tk_d1'").run(A);
  const r = await s.call({ panes: [P("tk_d1"), P("tk_d0"), P("tk_d2")] }, await s.human());
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const d = await data(s.D1, A, { name: "비서실장" }) as any;
  assert.deepEqual(d.role_seats, ["기술장", "운영장", "영업장"], "끌어 정한 순서가 역할 이름에 먹음");
  assert.equal(d.task_side.find((t: any) => t.issue === "#101").dept, "기술장", "상위가 그 부서면 역할 이름");
  assert.equal(d.areas.find((a: any) => a.lead === P("tk_d1")).seat_name, "기술장", "화면이 부서 머리를 찾을 값");
  assert.ok(!("seat_name" in d.areas.find((a: any) => a.lead === P("tk_d0"))), "이름이 같으면 칸 없음");
});
test("API: 엔진 역할 창 노드가 형제에 있어도 순서 저장 · 남의 역할 창은 404", async () => {
  const s = setup();
  s.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)").run("devA", A, "mbp", "", "h1", T, T, "full");
  s.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)").run("devB", B, "mbp", "", "h2", T, T, "full");
  const ew = s.db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?)");
  ew.run("ew_arole01", A, "devA", "role", "역할 창", "idle", T, T);
  ew.run("ew_brole01", B, "devB", "role", "남의 역할 창", "idle", T, T);
  const r = await s.call({ panes: [P("ew_arole01"), P("tk_d0")] }, await s.human());
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(s.orderOf(A), ["ew_arole01", "tk_d0"]);
  assert.equal((await s.call({ panes: [P("ew_brole01"), P("tk_d0")] }, await s.human())).status, 404);
  assert.deepEqual(s.orderOf(A), ["ew_arole01", "tk_d0"], "남의 창이 섞이면 안 씀");
});
// ⑧: 본문이 JSON null 이면 b.panes 에서 깨져 500 이었음
test("API: 본문이 JSON null · 배열이면 400", async () => {
  const s = setup();
  for (const body of [null, []]) assert.equal((await s.call(body, await s.human())).status, 400, JSON.stringify(body));
});
// ⑩: 300개로 차면 새 형제 묶음이 잘리는데 ok:true 였음
test("API: 목록이 차면 지운 노드 id 를 정리해 새 묶음을 넣음", async () => {
  const s = setup();
  const full = Array.from({ length: ORDER_MAX }, (_, i) => "n_gone" + i);
  s.db.prepare("UPDATE node_setting SET data = ? WHERE owner = ?").run(JSON.stringify({ order: full }), A);
  const r = await s.call({ panes: [P("tk_d1"), P("tk_d0")] }, await s.human());
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(s.orderOf(A), ["tk_d1", "tk_d0"], "지운 노드는 빠지고 새 묶음이 들어감");
});
test("API: 산 노드만으로 차 있으면 조용히 자르지 않고 409 · 아무것도 안 씀", async () => {
  const s = setup();
  const node = s.db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, task, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const full = Array.from({ length: ORDER_MAX }, (_, i) => "n_live" + i);
  for (const id of full) node.run(A, id, id, "", "idle", "", null, "{}", T, T);
  s.db.prepare("UPDATE node_setting SET data = ? WHERE owner = ?").run(JSON.stringify({ order: full }), A);
  const r = await s.call({ panes: [P("tk_d1"), P("tk_d0")] }, await s.human());
  assert.equal(r.status, 409, JSON.stringify(r.j));
  assert.equal(r.j.ok, false);
  assert.deepEqual(s.orderOf(A), full, "그대로");
});
test("태스크 줄에 채널 키(번호 포함 노드 이름) — 자리표 있는 사람만", async () => {
  const s = setup();
  const d = await data(s.D1, A, { name: "비서실장" }) as any;
  const t = d.task_side.find((x: any) => x.issue === "#101");
  assert.equal(t.name, "은행 규칙"); assert.equal(t.chan, "n:#101 은행 규칙");
  s.db.prepare("UPDATE node_setting SET data = ? WHERE owner = ?").run(JSON.stringify({ task_channels: true }), A);
  assert.ok(!("chan" in (await data(s.D1, A, { name: "비서실장" }) as any).task_side.find((x: any) => x.issue === "#101")), "자리표 없으면 칸 없음(main 과 같은 꼴)");
});

const shell = readFileSync(new URL("./legacy/shell.js", import.meta.url), "utf8");
const board = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
test("사이드바: 부서 그룹은 채널 = 태스크를 켠 사람만(꺼진 회원은 main 과 같은 「채널」 칸)", () => {
  assert.match(shell, /const DG = RS && TS && window\.HB_MEMBER \?/);
});
test("사이드바: 접힌 그룹 수는 서버가 준 채널 키로 · 머리는 역할 이름으로 찾음", () => {
  assert.match(shell, /unreadOf\(\[t\.chan \|\| 'n:' \+ t\.name, 'node:' \+ t\.pane\], t\.pane\)/);
  assert.match(shell, /a\.seat_name \|\| AREA_NAME\[a\.key\]/);
});
test("오른쪽 판 단추: aria-pressed 줄이 주석 뒤로 안 들어감", () => {
  const line = shell.split("\n").find(l => l.includes("db.type = 'button'"))!;
  assert.ok(line.indexOf("db.setAttribute('aria-pressed', 'false')") >= 0, "그 줄에 있음");
  const c = line.indexOf("//");
  assert.ok(c < 0 || c > line.indexOf("db.setAttribute('aria-pressed', 'false')"), "주석보다 앞");
});
test("토스트: 주인은 main 글자 그대로, 회원만 메인 봇 이름", () => {
  assert.match(board, /toast\(window\.HB_MEMBER \? `그 채널을 못 찾아 \$\{BOTN\} 채팅을 열어요` : ['"]그 채널을 못 찾아 Primary 로 열어요['"]\)/);
});
