// node --test --no-warnings --experimental-transform-types apps/web/worker/task.test.ts (Node 22.18+ · node:sqlite · apps/web 의존성 설치된 채)
// 할 일 정본(task.ts + /api/device/task · /api/me/task): 메모리 SQLite(migrations 전부) — 앞은 모듈 그대로, 뒤는 진짜 index.ts(app.fetch).
//   번호 늘기(주인마다 따로) · 상태 글 → state · 막힘엔 풀림 조건 · 체크박스 · 끝나면 그 번호에 막힌 것 풀림 · 비밀 가림 · 남의 할 일은 없는 것 · 기기 토큰 · 화면 길. 값 · 토큰 · 메일은 다 지어낸 것
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const T = await import("./task.ts");   // test-hooks 가 확장자 없는 import 를 풀어야 해서 register 뒤에 부름
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => run1(sql, args),
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = ss.map(s => /^\s*select/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; } },
  } as unknown as D1Database;
  return { db, D1 };
}
const A = "a@example.test", B = "b@example.test";
const rej = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: unknown) => e instanceof T.TaskError && re.test((e as Error).message));

test("새 할 일: 번호는 주인마다 1 부터 · 기본 상태 진행 · 기록 한 줄", async () => {
  const { db, D1 } = d1();
  const a = await T.create(D1, A, { title: "  할 일   정본 ", agent: "팀 리드", refs: [{ chan: "primary", ts: "1793900000.367101" }, { input: 2584 }], who: "비서실장" }, 1000);
  assert.equal(a.no, 1); assert.equal(a.title, "할 일 정본"); assert.equal(a.status, "진행"); assert.equal(a.state, "open"); assert.equal(a.unblock, null);
  assert.deepEqual(a.refs, [{ chan: "primary", ts: "1793900000.367101" }, { input: 2584 }]);
  assert.equal((await T.create(D1, A, { title: "둘째" }, 1001)).no, 2);
  assert.equal((await T.create(D1, B, { title: "남의 첫째" }, 1002)).no, 1, "다른 주인은 따로 셈");
  assert.equal((db.prepare("SELECT count(*) n FROM task_log WHERE owner = ? AND no = 1").get(A) as any).n, 1);
  await rej(T.create(D1, A, { title: "" }), /이름/);
  await rej(T.create(D1, A, { title: "x".repeat(41) }), /1–40/);
  await rej(T.create(D1, A, { title: "끝난 일", status: "끝 — 다 함" }), /끝으로/);
  await rej(T.create(D1, A, { title: "막힌 일", status: "blocked by owner — 고르기" }), /unblock/);
  await rej(T.create(D1, A, { title: "x", unblock: "owner" }), /막힌/);
  await rej(T.create(D1, A, { title: "x", refs: [{ ts: "123" }] }), /ts/);
  const blk = await T.create(D1, A, { title: "막힌 일", status: "blocked by owner — 고르기", unblock: "owner" });
  assert.equal(blk.state, "blocked"); assert.equal(blk.unblock, "owner");
});

test("상태 글 → state · 막힘은 풀림 조건이 있어야 · 풀리면 조건 지움 · 끝 시각", async () => {
  assert.equal(T.stateOf("blocked by 사용량 — f 5시간"), "blocked"); assert.equal(T.stateOf("Blocked by owner"), "blocked");
  assert.equal(T.stateOf("막힘: 배포"), "blocked"); assert.equal(T.stateOf("끝 — PR 머지"), "done"); assert.equal(T.stateOf("done"), "done");
  assert.equal(T.stateOf("진행 — 막힘 아님"), "open"); assert.equal(T.stateOf("doneness"), "open");
  const { D1 } = d1();
  const t = await T.create(D1, A, { title: "일" }, 1000);
  await rej(T.set(D1, A, 1, { status: "blocked by owner — 고르기" }), /unblock/);
  await rej(T.set(D1, A, 1, { status: "blocked by x", unblock: "nobody" }), /owner · usage/);
  await rej(T.set(D1, A, 1, { status: "blocked by x", unblock: "task:1" }), /자기 자신/);
  await rej(T.set(D1, A, 1, { status: "blocked by x", unblock: "#9" }), /없어요/);
  const b = await T.set(D1, A, t.no, { status: "blocked by 사용량 — f 계정 5시간", unblock: "usage:f", who: "일꾼" }, 2000);
  assert.equal(b.state, "blocked"); assert.equal(b.unblock, "usage:f"); assert.equal(b.updated_at, 2000);
  const b2 = await T.set(D1, A, t.no, { status: "blocked by 사용량 — 23:10 풀림" }, 2100);
  assert.equal(b2.unblock, "usage:f", "막힌 채 글만 바꾸면 조건 그대로");
  await rej(T.set(D1, A, t.no, { unblock: "owner", status: "진행" }), /막힌/);
  const o = await T.set(D1, A, t.no, { status: "진행 — 한도 풀림" }, 3000);
  assert.equal(o.state, "open"); assert.equal(o.unblock, null);
  const d = await T.set(D1, A, t.no, { status: "끝 — 운영 확인" }, 4000);
  assert.equal(d.state, "done"); assert.equal(d.done_at, 4000);
  assert.equal((await T.set(D1, A, t.no, { status: "진행 — 다시" }, 5000)).done_at, null, "다시 열면 끝 시각 지움");
  const same = await T.set(D1, A, t.no, { status: "진행 — 다시" }, 6000);
  assert.equal(same.updated_at, 5000, "같은 값이면 안 바뀜");
});

test("본문 · 체크박스 · 맡은 이 · 원 글 · 세션 · 기록", async () => {
  const { D1 } = d1();
  await T.create(D1, A, { title: "일", body: "할 것\n- [ ] 하나\n* [x] 둘\n아무 글" }, 1000);
  let t = await T.set(D1, A, "#1", { add: "셋", check: 1, agent: "일꾼", who: "팀 리드" }, 2000);
  assert.equal(t.body, "할 것\n- [x] 하나\n* [x] 둘\n아무 글\n- [ ] 셋"); assert.equal(t.agent, "일꾼");
  t = await T.set(D1, A, 1, { uncheck: 2 }, 2100);
  assert.match(t.body, /\* \[ \] 둘/);
  await rej(T.set(D1, A, 1, { check: 4 }), /4 번째 체크박스가 없어요\(지금 3개\)/);
  t = await T.set(D1, A, 1, { ref: { chan: "primary", ts: "1793900100.660576" } }, 2200);
  t = await T.set(D1, A, 1, { ref: { chan: "primary", ts: "1793900100.660576" } }, 2300);
  assert.equal(t.refs.length, 1, "같은 원 글은 한 번");
  t = await T.set(D1, A, 1, { session: { id: "0b5c-sess", pane: "%12" } }, 2400);
  t = await T.set(D1, A, 1, { session: { id: "0b5c-sess", pane: "%13" } }, 2500);
  assert.deepEqual(t.sessions, [{ id: "0b5c-sess", pane: "%13", at: 2500 }], "같은 세션은 한 줄(새 판으로)");
  await rej(T.set(D1, A, 1, { session: { id: "x y" } }), /세션 id/);
  const g = await T.get(D1, A, 1);
  assert.deepEqual(g.log.map(l => l.what).reverse(), ["만듦: 일", "맡음: 없음 → 일꾼", "더함: 셋", "체크: 하나", "체크 풂: 둘", "원 글 더함 primary:1793900100.660576", "세션 붙음 %12"]);
  assert.equal(g.log.find(l => l.what.startsWith("맡음"))!.who, "팀 리드");
  await rej(T.get(D1, B, 1), /#1 할 일이 없어요/);
});

test("끝나면 그 번호에 막혀 있던 할 일이 풀림", async () => {
  const { D1 } = d1();
  await T.create(D1, A, { title: "배포 도구" }, 1000);
  await T.create(D1, A, { title: "기다리는 일", status: "blocked by #1 — 배포 도구 먼저", unblock: "#1" }, 1001);
  await T.create(D1, A, { title: "딴 일", status: "blocked by owner — 고르기", unblock: "owner" }, 1002);
  await T.set(D1, A, 1, { status: "끝 — 머지", who: "일꾼" }, 9000);
  const [a, b] = [(await T.get(D1, A, 2)), (await T.get(D1, A, 3))];
  assert.equal(a.task.state, "open"); assert.equal(a.task.unblock, null); assert.equal(a.task.status, "진행 — #1 끝나 풀림"); assert.equal(a.log[0].what, "풀림: #1 끝");
  assert.equal(b.task.state, "blocked", "다른 조건은 그대로");
  await rej(T.create(D1, A, { title: "x", status: "blocked by #1", unblock: "task:1" }), /이미 끝났어요/);
});

test("목록: 기본 live(열림 + 막힘) 최근 순 · 맡은 이로 거름 · 끝은 done/all · 트리용은 본문 뺌 · 비밀 가림", async () => {
  const { D1 } = d1();
  await T.create(D1, A, { title: "하나", agent: "QA 팀장", body: "비밀 아님" }, 1000);
  await T.create(D1, A, { title: "둘", agent: "일꾼", status: "blocked by owner — 고르기", unblock: "owner" }, 1001);
  await T.create(D1, A, { title: "셋" }, 1002); await T.set(D1, A, 3, { status: "끝" }, 1003);
  await T.create(D1, B, { title: "남의 것" }, 1004);
  assert.deepEqual((await T.list(D1, A)).map(t => t.no), [2, 1]);
  assert.deepEqual((await T.list(D1, A, { agent: "일꾼" })).map(t => t.no), [2]);
  assert.deepEqual((await T.list(D1, A, { state: "done" })).map(t => t.no), [3]);
  assert.deepEqual((await T.list(D1, A, { state: "all" })).map(t => t.no), [2, 1, 3]);
  assert.deepEqual((await T.list(D1, A, { state: "blocked" })).map(t => t.no), [2]);
  await rej(T.list(D1, A, { state: "x" }), /live/);
  const tr = await T.forTree(D1, A);
  assert.ok(tr.every(t => !("body" in t) && !("sessions" in t)));
  const s = await T.create(D1, A, { title: "키", body: "토큰 sk-ant-api03-" + "a".repeat(90) + " 끝" });
  assert.ok(!s.body.includes("a".repeat(90)), "비밀 꼴은 가림: " + s.body);
});

function hook(D1: D1Database, match: RegExp, fn: () => Promise<unknown>) {
  let once: (() => Promise<unknown>) | null = fn;
  const wrap = (st: any): any => ({ ...st, bind: (...a: unknown[]) => wrap(st.bind(...a)), first: async (c?: string) => { const r = await st.first(c); if (once) { const f = once; once = null; await f(); } return r; } });
  return { prepare: (sql: string) => match.test(sql) ? wrap(D1.prepare(sql)) : D1.prepare(sql), batch: (ss: any[]) => D1.batch(ss) } as unknown as D1Database;
}

test("동시에 고쳐도 안 사라짐 · 막힘 등록과 선행 끝이 겹쳐도 풀림 · 끝난 후행은 안 되살림(리뷰 921)", async () => {
  const { D1 } = d1();
  await T.create(D1, A, { title: "일" }, 1000);
  await Promise.all([T.set(D1, A, 1, { add: "첫 요구" }, 2000), T.set(D1, A, 1, { add: "둘째 요구" }, 2000)]);
  assert.equal((await T.get(D1, A, 1)).task.body, "- [ ] 첫 요구\n- [ ] 둘째 요구", "두 줄 다 남음");
  // 후행 #2 가 #1 열림을 확인한 직후 #1 이 끝남 → #2 는 막힌 채 남지 않고 바로 풀림
  const H = hook(D1, /^SELECT state FROM task WHERE owner = \? AND no = \?$/, () => T.set(D1, A, 1, { status: "끝 — 머지" }, 3000));
  const late = await T.create(H, A, { title: "후행", status: "blocked by #1 — 먼저", unblock: "#1" }, 3001);
  assert.equal(late.state, "open"); assert.equal(late.unblock, null); assert.equal(late.status, "진행 — #1 끝나 풀림");
  // 막힌 #4 가 그 사이 스스로 끝나도, #3 끝 처리가 #4 를 다시 열지 않음
  await T.create(D1, A, { title: "선행" }, 4000);
  await T.create(D1, A, { title: "막힌", status: "blocked by #3", unblock: "task:3" }, 4001);
  await T.set(D1, A, 4, { status: "끝 — 스스로" }, 4002);
  await T.set(D1, A, 3, { status: "끝" }, 4003);
  const four = (await T.get(D1, A, 4)).task;
  assert.equal(four.state, "done"); assert.equal(four.done_at, 4002);
});

test("비밀 꼴은 맡은 이 · 누가 · 원 글에서도 가림(리뷰 921)", async () => {
  const { D1 } = d1(), fake = "ghp_" + "Ab3".repeat(12);
  const t = await T.create(D1, A, { title: "일", agent: "일꾼 " + fake, who: fake, refs: [{ chan: "primary", url: "https://example.test/x?k=" + fake }] }, 1000);
  await T.set(D1, A, 1, { ref: { chan: fake }, who: fake }, 2000);
  const g = await T.get(D1, A, 1), all = JSON.stringify(g);
  assert.ok(!all.includes(fake), "원문이 남음: " + all.slice(0, 300));
  assert.ok(t.agent.startsWith("일꾼"));
});

test("op: 모르는 칸 · 모르는 op · 상태 코드", async () => {
  const { D1 } = d1();
  assert.equal((await T.op(D1, A, { op: "new", title: "일", stat: "x" }))[0], 400);
  assert.equal((await T.op(D1, A, { op: "zap" }))[0], 400);
  assert.equal((await T.op(D1, A, null))[0], 400);
  const [s, o] = await T.op(D1, A, { op: "new", title: "일" }); assert.equal(s, 200); assert.equal((o.task as any).no, 1);
  assert.equal((await T.op(D1, A, { op: "set", no: 9, status: "끝" }))[0], 404);
  assert.equal((await T.op(D1, A, { op: "set", no: "x" }))[0], 400);
  assert.equal(((await T.op(D1, A, { op: "get", no: "#1" }))[1] as any).task.title, "일");
});

// ── API(진짜 index.ts) ──
const { default: app } = await import("./index.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", e); return new Response("{}", { status: 500 }); });
const OWNER = "owner@example.test", MEMBER = "member@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up";
const DEV = "bxd_made-up-member-device-0123456789abcd", DEVH = "bxd_made-up-owner-harness-0123456789abcd", DEVW = "bxd_made-up-owner-watch-0123456789abcde";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
async function setup() {
  const { db, D1 } = d1(), now = Date.now();
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, now);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)");
  dev.run("devM", MEMBER, "laptop", "", await sha(DEV), now, now, "full");
  dev.run("devH", OWNER, "owner-host", "", await sha(DEVH), now, now, "harness");
  dev.run("devW", OWNER, "owner mac", "", await sha(DEVW), now, now, "watch");
  const bumps: [string, Record<string, string>][] = [];
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: (n: string) => ({ bump: async (t: Record<string, string>) => { bumps.push([n, t]); return 1; } }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const pend: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pend.push(p.catch(() => {})); }, passThroughOnException() {} };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    while (pend.length) await Promise.all(pend.splice(0));
    return { status: r.status, j, text };
  };
  const human = async (email: string) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  return { db, call, human, bumps };
}
const dev = (t: string) => ({ authorization: `Bearer ${t}` });

test("API 기기: 주인 하네스 · full 은 됨, 감시 기기 · 토큰 없음은 401 · 쓰면 화면 칸에 task 만 알림 · 남의 할 일은 404", async () => {
  const s = await setup();
  assert.equal((await s.call("POST", "/api/device/task", { op: "list" })).status, 401);
  assert.equal((await s.call("POST", "/api/device/task", { op: "list" }, dev(DEVW))).status, 401, "감시 기기는 못 씀");
  const a = await s.call("POST", "/api/device/task", { op: "new", title: "할 일 정본", agent: "팀 리드" }, dev(DEVH));
  assert.equal(a.status, 200, a.text); assert.equal(a.j.task.no, 1);
  assert.ok(s.bumps.some(([n, t]) => n === "owner@apac" && /^~\d+$/.test(t.task) && !t.data), "주인 화면 칸에 task 만: " + JSON.stringify(s.bumps));
  s.bumps.length = 0;
  const l = await s.call("POST", "/api/device/task", { op: "list" }, dev(DEVH));
  assert.equal(l.j.tasks.length, 1); assert.equal(s.bumps.length, 0, "읽기는 알림 없음");
  const m = await s.call("POST", "/api/device/task", { op: "new", title: "회원 일" }, dev(DEV));
  assert.equal(m.j.task.no, 1, "회원은 따로 셈");
  assert.equal((await s.call("POST", "/api/device/task", { op: "set", no: 1, status: "끝" }, dev(DEV))).j.task.title, "회원 일", "회원 기기는 제 #1");
  assert.equal((await s.call("POST", "/api/device/task", { op: "get", no: 1 }, dev(DEVH))).j.task.state, "open", "주인 #1 은 그대로");
  assert.equal((await s.call("POST", "/api/device/task", { op: "new", title: "" }, dev(DEVH))).status, 400);
  assert.equal((s.db.prepare("SELECT count(*) n FROM task").get() as any).n, 2);
});

test("API 화면: 로그인만 · live 할 일(본문 뺌)", async () => {
  const s = await setup();
  await s.call("POST", "/api/device/task", { op: "new", title: "열린 일", agent: "비서실장", body: "- [ ] 하나" }, dev(DEVH));
  await s.call("POST", "/api/device/task", { op: "new", title: "막힌 일", agent: "일꾼", status: "blocked by owner — 고르기", unblock: "owner" }, dev(DEVH));
  assert.equal((await s.call("GET", "/api/me/task")).status, 401);
  const g = await s.call("GET", "/api/me/task", undefined, await s.human(OWNER));
  assert.equal(g.status, 200, g.text);
  assert.deepEqual(g.j.tasks.map((t: any) => [t.no, t.state, t.agent]), [[2, "blocked", "일꾼"], [1, "open", "비서실장"]]);
  assert.ok(g.j.tasks.every((t: any) => t.body === undefined));
  assert.equal((await s.call("GET", "/api/me/task", undefined, await s.human(MEMBER))).j.tasks.length, 0, "회원 보드는 따로");
});
