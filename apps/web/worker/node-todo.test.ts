import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import * as T from "./node-todo.ts";

register("./test-hooks.mjs", import.meta.url);
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
const rej = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: unknown) => e instanceof T.TodoError && re.test((e as Error).message));

// ── 모듈 ──
test("더하기 · 목록: 남은 것은 우선순위 → 넣은 순서, 끝은 all 일 때만 · 노드 · 주인으로 거름", async () => {
  const { D1 } = d1();
  const a = await T.add(D1, A, { node: "보더 웹", title: "  할 일   하나 " }, 1000);
  assert.equal(a.title, "할 일 하나", "빈칸 줄임"); assert.equal(a.prio, 2); assert.equal(a.state, "todo"); assert.equal(a.sort, 1);
  const b = await T.add(D1, A, { node: "보더 웹", title: "급한 것", prio: 1, by: "Claude" }, 1001);
  const c = await T.add(D1, A, { node: "보더 웹", title: "나중 것", prio: "3" }, 1002);
  await T.add(D1, A, { node: "다른 노드", title: "다른 노드 일" }, 1003);
  await T.add(D1, B, { node: "보더 웹", title: "남의 일" }, 1004);
  assert.equal(b.sort, 2); assert.equal(b.by, "Claude");
  assert.deepEqual((await T.list(D1, A, "보더 웹")).map(t => t.title), ["급한 것", "할 일 하나", "나중 것"]);
  await T.done(D1, A, c.id, "PR 링크", 2000);
  assert.deepEqual((await T.list(D1, A, "보더 웹")).map(t => t.id), [b.id, a.id], "끝은 기본 목록에 없음");
  assert.deepEqual((await T.list(D1, A, "보더 웹", { all: true })).map(t => t.id), [b.id, a.id, c.id], "all = 끝도(뒤에)");
  assert.equal((await T.list(D1, A, null)).length, 3, "노드 없음 = 그 사람 모든 노드의 남은 것");
  assert.deepEqual(await T.counts(D1, A, "보더 웹"), { open: 2, done: 1 });
});

test("값 거르기: 제목 1–300자 · 우선순위 · 상태 · 기다림은 기다림 상태에만 · 바꿀 칸 없음", async () => {
  const { D1 } = d1();
  await rej(T.add(D1, A, { node: "n", title: "" }), /1–300자/);
  await rej(T.add(D1, A, { node: "n", title: "   " }), /1–300자/);
  await rej(T.add(D1, A, { node: "n", title: "x".repeat(301) }), /1–300자/);
  assert.equal((await T.add(D1, A, { node: "n", title: "x".repeat(300) })).title.length, 300);
  await rej(T.add(D1, A, { node: "n", title: 3 }), /글로/);
  await rej(T.add(D1, A, { node: "n", title: "t", prio: 4 }), /우선순위/);
  await rej(T.add(D1, A, { node: "n", title: "t", prio: "급함" }), /우선순위/);
  await rej(T.add(D1, A, { node: "n", title: "t", state: "blocked" }), /상태/);
  const t = await T.add(D1, A, { node: "n", title: "t" });
  await rej(T.set(D1, A, t.id, {}), /바꿀 칸/);
  await rej(T.set(D1, A, t.id, { wait: "답" }), /기다림 상태에만/);
  await rej(T.set(D1, A, t.id, { sort: Number.NaN }), /순서/);
  await rej(T.set(D1, A, "abc", { prio: 1 }), /id/);
  assert.equal((await T.add(D1, A, { node: "n", title: "줄\n바꿈\x07" })).title, "줄 바꿈", "제어 글자 · 줄바꿈 빼고 한 줄로");
});

test("고치기 · 끝 · 되돌리기 · 옮기기 · 지우기 — 남의 할 일은 없는 것(404)", async () => {
  const { D1 } = d1();
  const t = await T.add(D1, A, { node: "n", title: "t" }, 1000);
  let x = await T.set(D1, A, t.id, { state: "wait", wait: "팀장 답" }, 1100);
  assert.equal(x.state, "wait"); assert.equal(x.wait, "팀장 답"); assert.equal(x.updated_at, 1100);
  x = await T.set(D1, A, t.id, { state: "doing" }, 1200);
  assert.equal(x.wait, null, "기다림이 아니면 기다리는 것 비움");
  x = await T.done(D1, A, t.id, "시험 통과", 1300);
  assert.equal(x.state, "done"); assert.equal(x.done_at, 1300); assert.equal(x.evidence, "시험 통과");
  x = await T.set(D1, A, t.id, { state: "todo" }, 1400);
  assert.equal(x.done_at, null); assert.equal(x.evidence, null, "되돌리면 끝 시각 · 증거 비움");
  x = await T.set(D1, A, t.id, { prio: 1, title: "새 글", sort: 0.5 }, 1500);
  assert.deepEqual([x.prio, x.title, x.sort], [1, "새 글", 0.5]);
  await T.add(D1, A, { node: "m", title: "m 일" });
  x = await T.move(D1, A, t.id, "m", 1600);
  assert.equal(x.node, "m"); assert.equal(x.sort, 2, "옮긴 노드 맨 뒤");
  await assert.rejects(T.set(D1, B, t.id, { prio: 3 }), (e: unknown) => e instanceof T.TodoMissing);
  await assert.rejects(T.remove(D1, B, t.id), (e: unknown) => e instanceof T.TodoMissing);
  assert.deepEqual(await T.remove(D1, A, t.id), { id: t.id });
  await assert.rejects(T.done(D1, A, t.id, "x"), (e: unknown) => e instanceof T.TodoMissing);
});

test("오래 안 바뀐 것(stale 분) · 들여오기(같은 글 건너뜀, 통과는 끝)", async () => {
  const { D1 } = d1();
  const now = 10_000_000;
  await T.add(D1, A, { node: "n", title: "오래됨" }, now - 40 * 60_000);
  await T.add(D1, A, { node: "n", title: "새것" }, now - 5 * 60_000);
  assert.deepEqual((await T.list(D1, A, "n", { staleMin: 30, now })).map(t => t.title), ["오래됨"]);
  const r = await T.importRows(D1, A, "n", [{ title: "새것", state: "todo" }, { title: "실패 행", state: "todo" }, { title: "통과 행", state: "done", evidence: "링크" }, { title: "실패 행", state: "todo" }], "Claude", now);
  assert.deepEqual(r, { added: 1, done: 1, skipped: 2 });
  const all = await T.list(D1, A, "n", { all: true });
  assert.equal(all.find(t => t.title === "통과 행")!.evidence, "링크");
  await rej(T.importRows(D1, A, "n", [{ title: "x", state: "wait" }], null), /todo · done/);
  await rej(T.importRows(D1, A, "n", [{ title: "x", state: "todo", extra: 1 }], null), /모르는 칸/);
});

test("op: 모르는 op · 모르는 칸 거절 · 회원은 mnode id 를 이름으로 · 기기 끝은 증거가 있어야 · 들여오기는 기기만", async () => {
  const { db, D1 } = d1();
  db.prepare("INSERT INTO mnode(owner, id, name, pinned_name, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(A, "n_abc", "옛 이름", "보더 할 일", 1, 1);
  assert.equal((await T.op(D1, A, { op: "drop" }, { member: true, device: true }))[0], 400);
  assert.match(String((await T.op(D1, A, { op: "add", node: "x", title: "t", stat: "todo" }, { member: true, device: true }))[1].error), /모르는 칸: stat/);
  const [st, o] = await T.op(D1, A, { op: "add", node: "n_abc", title: "회원 일" }, { member: true, device: true });
  assert.equal(st, 200); assert.equal((o.todo as T.Todo).node, "보더 할 일", "id → 사람이 지은 이름");
  assert.equal(((await T.op(D1, A, { op: "add", node: "n_abc", title: "주인 일" }, { member: false, device: true }))[1].todo as T.Todo).node, "n_abc", "주인은 창 이름 그대로");
  const id = (o.todo as T.Todo).id;
  assert.equal((await T.op(D1, A, { op: "done", id }, { member: true, device: true }))[0], 400, "기기는 증거 없이 못 끝냄");
  assert.equal((await T.op(D1, A, { op: "done", id }, { member: true, device: false }))[0], 200, "화면 손은 증거 없이도");
  assert.equal((await T.op(D1, A, { op: "import", node: "x", rows: [] }, { member: true, device: false }))[0], 400);
  assert.equal((await T.op(D1, A, { op: "list", stale: -1 }, { member: true, device: true }))[0], 400);
  assert.equal((await T.op(D1, A, { op: "set", id: 99999, prio: 1 }, { member: true, device: true }))[0], 404);
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

test("API 기기: full · 주인 하네스는 됨, 감시 기기 · 토큰 없음은 401 · 쓰면 그 사람 화면 칸에 todo 알림(보드 전체 다시 읽기 아님)", async () => {
  const s = await setup();
  assert.equal((await s.call("POST", "/api/device/todos", { op: "list" })).status, 401);
  assert.equal((await s.call("POST", "/api/device/todos", { op: "list" }, dev(DEVW))).status, 401, "감시 기기는 못 씀");
  const a = await s.call("POST", "/api/device/todos", { op: "add", node: "보더 웹 만들기", title: "할 일 칸", prio: 1, by: "Claude" }, dev(DEVH));
  assert.equal(a.status, 200, a.text); assert.equal(a.j.todo.owner, OWNER);
  assert.ok(s.bumps.some(([n, t]) => n === "owner@apac" && /^~\d+$/.test(t.todo) && !t.data), "주인 화면 칸에 todo 만");
  s.bumps.length = 0;
  const m = await s.call("POST", "/api/device/todos", { op: "add", node: "내 노드", title: "회원 일" }, dev(DEV));
  assert.equal(m.status, 200); assert.equal(m.j.todo.owner, MEMBER);
  assert.deepEqual(s.bumps.map(([n, t]) => [n, Object.keys(t)]), [[`live:${MEMBER}@apac`, ["todo"]]], "회원 화면 칸에 todo 만(data · chat 다시 읽기 안 부름)");
  s.bumps.length = 0;
  const l = await s.call("POST", "/api/device/todos", { op: "list", node: "내 노드" }, dev(DEV));
  assert.equal(l.j.todos.length, 1); assert.equal(s.bumps.length, 0, "읽기는 알림 없음");
  assert.equal((await s.call("POST", "/api/device/todos", { op: "set", id: a.j.todo.id, prio: 3 }, dev(DEV))).status, 404, "회원 기기는 주인 할 일을 못 건드림");
  assert.equal((await s.call("POST", "/api/device/todos", { op: "add", node: "n", title: "" }, dev(DEV))).status, 400);
});

test("API 화면: 로그인 + 같은 사이트만 쓰기 · GET 은 그 노드 남은 것 · 끝 수 · 회원은 남의 것 안 보임", async () => {
  const s = await setup();
  const add = async (t: string, extra = {}) => (await s.call("POST", "/api/device/todos", { op: "add", node: "보더 웹 만들기", title: t, ...extra }, dev(DEVH))).j.todo;
  const x = await add("하나"), y = await add("둘", { prio: 1 });
  await s.call("POST", "/api/device/todos", { op: "done", id: x.id, evidence: "시험 통과" }, dev(DEVH));
  assert.equal((await s.call("GET", "/api/todos?node=" + encodeURIComponent("보더 웹 만들기"))).status, 401);
  const g = await s.call("GET", "/api/todos?node=" + encodeURIComponent("보더 웹 만들기") + "&all=1", undefined, await s.human(OWNER));
  assert.equal(g.status, 200, g.text); assert.equal(g.j.open, 1); assert.equal(g.j.done, 1); assert.deepEqual(g.j.todos.map((t: any) => t.title), ["둘", "하나"]);
  assert.equal((await s.call("GET", "/api/todos?node=" + encodeURIComponent("보더 웹 만들기"), undefined, await s.human(MEMBER))).j.todos.length, 0, "회원 보드는 따로");
  assert.equal((await s.call("GET", "/api/todos", undefined, await s.human(OWNER))).status, 400, "노드 없음");
  assert.equal((await s.call("POST", "/api/todos", { op: "set", id: y.id, prio: 3 }, { cookie: await cookie(OWNER) })).status, 403, "같은 사이트 머리 없음");
  assert.equal((await s.call("POST", "/api/todos", { op: "set", id: y.id, prio: 3 }, { ...(await s.human(OWNER)), "sec-fetch-site": "cross-site" })).status, 403);
  const p = await s.call("POST", "/api/todos", { op: "set", id: y.id, prio: 3, title: "둘 고침" }, await s.human(OWNER));
  assert.equal(p.status, 200, p.text); assert.equal(p.j.todo.title, "둘 고침");
  assert.equal((await s.call("POST", "/api/todos", { op: "done", id: y.id }, await s.human(OWNER))).status, 200, "화면은 증거 없이 끝");
  assert.equal((await s.call("POST", "/api/todos", { op: "import", node: "n", rows: [] }, await s.human(OWNER))).status, 400, "들여오기는 명령만");
  assert.equal((await s.call("POST", "/api/todos", { op: "remove", id: y.id }, await s.human(MEMBER))).status, 404, "남의 것");
  assert.equal((await s.call("POST", "/api/todos", { op: "remove", id: y.id }, await s.human(OWNER))).status, 200);
  assert.equal((s.db.prepare("SELECT count(*) n FROM node_todo").get() as any).n, 1);
});
