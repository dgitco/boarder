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
const { mountImport } = await import("./routes.ts");
const { Hono } = await import("hono");

const MIG = new URL("../../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const batch = async (ss: any[]) => { db.exec("BEGIN"); try { const out = []; for (const s of ss) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database };
}
const MEMBER = "member@example.com";
const quiets: string[] = [];   // 회원 화면 알림을 안 보내게 표시한 요청(index.ts quiet → bumpMember 건너뜀)
function app(D1: D1Database) {
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  mountImport(a, { device: async () => ({ id: "devMember01", owner: MEMBER, name: "member laptop" }), member: async () => null, sameSite: () => true, quiet: c => { quiets.push(c.req.path); } });
  return async (body: unknown) => { const r = await a.request("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { DB: D1, PUBLIC_URL: "https://example.test" }); assert.equal(r.status, 200); return r.json() as Promise<any>; };
}
const body = (stateAt = 1000) => ({ host: "laptop", kinds: ["window"], items: [
  { key: "window:laptop:tmux:1", kind: "window", title: "주간 보고 정리", win: "laptop:tmux:1", state: "working", state_at: stateAt, engine: "tmux-own" },
  { key: "window:laptop:tmux:2", kind: "window", title: "회의록", win: "laptop:tmux:2", state: "idle", state_at: stateAt, engine: "tmux-own" },
] });
const audits = (db: DatabaseSync) => (db.prepare("SELECT COUNT(*) n FROM imp_audit WHERE owner = ?").get(MEMBER) as { n: number }).n;

test("같은 목록을 다시 보내면 묶기를 건너뛰고(대조 줄 안 늘어남) 노드 수 · 상태는 같게 답함", async () => {
  const { db, D1 } = d1(), post = app(D1);
  const r1 = await post(body());
  assert.equal(audits(db), 1);
  const nodes = db.prepare("SELECT id, state, updated_at FROM mnode WHERE owner = ? ORDER BY id").all(MEMBER);
  const r2 = await post(body());
  assert.equal(r2.same, true);
  assert.equal(audits(db), 1, "묶기를 안 돌림");
  assert.equal(r2.nodes, r1.nodes);
  assert.deepEqual(r2.states, r1.states);
  assert.deepEqual(db.prepare("SELECT id, state, updated_at FROM mnode WHERE owner = ? ORDER BY id").all(MEMBER), nodes, "노드 줄 그대로");
});

test("한 줄이라도 바뀌면 · 사라지면 · 마지막 묶기가 5분 넘으면 전처럼 묶음", async () => {
  const { db, D1 } = d1(), post = app(D1);
  await post(body());
  const r = await post(body(2000));   // state_at 바뀜
  assert.notEqual(r.same, true); assert.equal(audits(db), 2);
  const one = body(2000); one.items.pop();
  assert.notEqual((await post(one)).same, true, "창 하나 사라짐"); assert.equal(audits(db), 3);
  db.prepare("UPDATE imp_audit SET at = at - 6 * 60000 WHERE owner = ?").run(MEMBER);
  assert.notEqual((await post(one)).same, true, "5분 넘음 — 시간 지난 보관 · 주차를 맞추려 묶음"); assert.equal(audits(db), 4);
  assert.equal((await post(one)).same, true);
});

test("빈 목록(--stop) · MCP · 역할을 같이 보낸 것은 건너뛰지 않음", async () => {
  const { db, D1 } = d1(), post = app(D1);
  await post(body());
  assert.notEqual((await post({ ...body(), roles: [{ name: "리뷰어", from: "하네스 x" }] })).same, true);
  const n = audits(db);
  assert.notEqual((await post({ host: "laptop", kinds: ["window"], items: [] })).same, true);
  assert.equal(audits(db), n + 1);
});

const { fresh, dataGate, freshOpts, freshForget } = await import("../member-board.ts");
test("fresh: 겹쳐 부르면 묶기 한 번 · 묶은 뒤 30초 안 읽기는 바로 안 묶고 남은 시간 뒤 한 번(조용해져도) · 대조만 한 읽기는 안 막음 · freshForget 은 풂", async () => {
  const { db, D1 } = d1(), post = app(D1);
  let groups = 0;   // regroup 횟수 = 그 imp_item 통째 읽기 질의 수
  const spy = { ...D1, prepare: (sql: string) => { if (/^SELECT key, kind, engine, title, cwd, repo, /.test(sql)) groups++; return (D1 as any).prepare(sql); } } as unknown as D1Database;
  const env = { DB: spy, PUBLIC_URL: "https://example.test" };
  const real = { ...freshOpts }; let later: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { later.push(p); } };
  freshOpts.sleep = async () => {};   // 남은 시간 기다림은 시험에서 바로
  let bumps = 0; freshOpts.bump = (async () => { bumps++; }) as never;   // 미룬 묶기 뒤 화면 알림
  try {
    await post(body());
    const stale = () => { db.prepare("UPDATE imp_audit SET at = 0 WHERE owner = ?").run(MEMBER); db.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").run(MEMBER, "laptop:tmux:1", "progress", "새 줄", Date.now() - 5); };   // 지금보다 앞 — 묶은 뒤에는 낡지 않음
    freshForget(MEMBER); stale();
    groups = 0;
    await Promise.all(Array.from({ length: 8 }, () => fresh(env as never, MEMBER, ctx)));
    assert.equal(groups, 1, "여덟 번 불러도 묶기 한 번");
    assert.equal(later.length, 0, "막 묶었으니 미룰 것 없음");
    db.prepare("UPDATE imp_audit SET at = 0 WHERE owner = ?").run(MEMBER);
    db.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").run(MEMBER, "laptop:tmux:1", "blocked", "막힘: 기다림", Date.now() - 5);   // 노드 상태가 바뀌는 줄(막힘)
    groups = 0; await fresh(env as never, MEMBER, ctx);
    assert.equal(groups, 0, "묶은 뒤 30초 안 읽기는 바로 안 묶음(D1 1위 regroup)");
    assert.equal(later.length, 1, "대신 남은 시간 뒤 한 번을 걸어 둠");
    await fresh(env as never, MEMBER, ctx); assert.equal(later.length, 1, "미룬 것은 사람마다 하나");
    await Promise.all(later); later = [];
    assert.equal(groups, 1, "그 뒤 아무 읽기가 없어도 묶음(막힌 뒤 조용해진 계정)");
    assert.equal(bumps, 1, "미룬 묶기가 노드 상태(막힘)를 바꿨으니 화면에 알림 한 번");
    db.prepare("UPDATE imp_audit SET at = 0 WHERE owner = ?").run(MEMBER);   // 낡음 표시만(노드는 그대로)
    await fresh(env as never, MEMBER, ctx); await Promise.all(later); later = [];
    assert.equal(bumps, 1, "미룬 묶기가 바꾼 것이 없으면 알리지 않음(알림마다 탭이 다시 읽음)");
    freshForget(MEMBER);
    await fresh(env as never, MEMBER, ctx);   // 낡지 않음 — 대조만
    stale(); groups = 0;
    await fresh(env as never, MEMBER, ctx);
    assert.equal(groups, 1, "대조만 한 읽기는 30초를 걸지 않음 — 낡으면 바로 묶음");
    stale(); freshForget(MEMBER); groups = 0;
    await fresh(env as never, MEMBER);
    assert.equal(groups, 1, "freshForget(카드 답 뒤) 하면 30초 안이어도 바로 묶음");
  } finally { Object.assign(freshOpts, real); }
});
test("dataGate: 한 사람 5초에 60번까지, 넘으면 거절, 창이 지나면 다시 · 사람마다 따로", () => {
  const t = 1_000_000, me = "gate@example.com";
  for (let i = 0; i < 60; i++) assert.equal(dataGate(me, t + i), true);
  assert.equal(dataGate(me, t + 61), false);
  assert.equal(dataGate("other@example.com", t + 61), true);
  assert.equal(dataGate(me, t + 5_000), true);
});

test("같은 목록(아무것도 안 바뀜)일 때만 화면 알림을 끔 — 처음 · 바뀐 목록은 알림 그대로", async () => {
  const { D1 } = d1(), post = app(D1);
  quiets.length = 0;
  await post(body());
  assert.equal(quiets.length, 0, "처음 들여오기는 알림");
  const r2 = await post(body());
  assert.equal(r2.same, true); assert.equal(quiets.length, 1, "같은 목록은 알림 끔");
  await post(body(3000));
  assert.equal(quiets.length, 1, "state_at 이 바뀐 목록은 알림");
});

test("같은 목록이어도 기기 기능(features)이 바뀌면 알림 그대로", async () => {
  const { db, D1 } = d1(), post = app(D1);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)").run("devMember01", MEMBER, "member laptop", "", "h1", 1, 1, "full");
  const withF = (engine: boolean) => ({ ...body(), features: { report: ["claude"], engine } });
  quiets.length = 0;
  await post(withF(false));
  await post(withF(false));
  assert.equal(quiets.length, 1, "기능도 같으면 알림 끔");
  const r = await post(withF(true));
  assert.equal(r.same, true, "목록은 같음");
  assert.equal(quiets.length, 1, "기능이 바뀌었으니 알림");
});

test("비교할 줄은 아직 있는 것만 읽음 — 사라졌다 다시 온 항목은 살아나고, 사라진 줄(7일 치)은 비교 질의가 안 읽음", async () => {
  const { db, D1 } = d1();
  const seen: { sql: string; n: number }[] = [];
  const spy = { ...D1, prepare: (sql: string) => {
    const st = (D1 as any).prepare(sql);
    if (/^SELECT key, kind, engine, title, cwd, repo, branch, refs, state, state_at, win, session, handle, gone_at FROM imp_item/.test(sql))
      return { ...st, bind: (...a: unknown[]) => { const b = st.bind(...a); return { ...b, all: async () => { const r = await b.all(); seen.push({ sql, n: r.results.length }); return r; } }; } };
    return st; } } as unknown as D1Database;
  const post = app(spy);
  await post(body());
  await post({ ...body(), items: body().items.slice(0, 1) });
  const gone = db.prepare("SELECT gone_at, state FROM imp_item WHERE owner = ? AND key = ?").get(MEMBER, "window:laptop:tmux:2") as { gone_at: number | null; state: string };
  assert.ok(gone.gone_at && gone.state === "gone", "사라짐 표시");
  for (let i = 0; i < 50; i++) db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, repo, branch, refs, state, win, session, seen_at, gone_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(MEMBER, `window:laptop:old:${i}`, "devMember01", "window", "tmux-own", "옛 창", "", "", "", "[]", "gone", `laptop:old:${i}`, "", 1, Date.now() - 3600_000);
  seen.length = 0;
  await post(body(3000));   // 둘째 창이 다시 옴
  assert.equal(seen.length, 1); assert.equal(seen[0].n, 1, "비교 질의는 아직 있는 첫째 창 한 줄만(사라진 51줄 안 읽음)");
  const back = db.prepare("SELECT gone_at, state, state_at FROM imp_item WHERE owner = ? AND key = ?").get(MEMBER, "window:laptop:tmux:2") as { gone_at: number | null; state: string; state_at: number };
  assert.deepEqual([back.gone_at, back.state, back.state_at], [null, "idle", 3000], "다시 온 항목은 살아남");
  const plan = (db.prepare("EXPLAIN QUERY PLAN " + seen[0].sql).all(MEMBER, "devMember01") as { detail: string }[]).map(r => r.detail).join(" | ");
  assert.match(plan, /imp_item_owner \(owner=\? AND gone_at=\?\)/, plan);
});
