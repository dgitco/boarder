import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MB = await import("./member-board.ts");
const A = "a@example.com", B = "b@example.com";
const MIG = new URL("../migrations/", import.meta.url);
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  const node = (o: string, id: string, name: string, state: string, archived: number | null = null) => db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at, archived_at) VALUES (?,?,?,?,?,?,?)").run(o, id, name, state, now, now, archived);
  node(A, "n-1", "매출 보고", "working"); node(A, "n-2", "옛 일", "done", now - 3 * 86_400_000); node(A, "n-3", "막 끝남", "done");
  node(B, "n-9", "옛 일", "done", now - 86_400_000);
  const exec = (sql: string, args: unknown[]) => { const st = db.prepare(sql); if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } }; const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) } as unknown as D1Database;
  return { db, D1 };
}
const get = async (D1: D1Database, me: string, path: string) => (await (await MB.get(D1, me, { name: "메인 봇" }, new URL("https://x" + path), async () => null) as Response).json()) as any;

test("노드 우선순위: 저장 → 판 · 주차에 pri, 빈 단계면 지움, 다른 칸(unit) 그대로, 남의 것과 안 섞임 · 틀린 단계 거절", async () => {
  const { db, D1 } = setup();
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ unit: "goal" }), 1);
  assert.deepEqual(await MB.post(D1, A, "/api/nodepri", { title: "1 매출 보고", pri: "급함" }), { ok: { ok: true, state: "ok", title: "매출 보고", pri: "급함" } });
  assert.deepEqual(await MB.post(D1, A, "/api/nodepri", { title: '따옴표 "이름"', pri: "낮음" }), { ok: { ok: true, state: "ok", title: '따옴표 "이름"', pri: "낮음" } });
  let d = await MB.data(D1, A, null);
  assert.equal(d.panes.find((p: any) => p.win === "매출 보고").pri, "급함");
  const set = JSON.parse((db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(A) as any).data);
  assert.equal(set.unit, "goal"); assert.equal(set.pri['따옴표 "이름"'].pri, "낮음");
  await MB.post(D1, A, "/api/nodepri", { title: "매출 보고", pri: "" });
  d = await MB.data(D1, A, null);
  assert.equal(d.panes.find((p: any) => p.win === "매출 보고").pri, "");
  assert.equal((await MB.data(D1, B, null)).panes.some((p: any) => p.pri), false);
  assert.deepEqual(await MB.post(D1, A, "/api/nodepri", { title: "매출 보고", pri: "아주 급함" }), { error: "노드 이름 · 단계", status: 400 });
  // 설정 줄이 없던 회원도 새로 만듦
  await MB.post(D1, B, "/api/nodepri", { title: "새 노드", pri: "높음" });
  assert.equal(JSON.parse((db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(B) as any).data).pri["새 노드"].pri, "높음");
});

test("보관 노드 이름 목록 · 닫힌 노드 다시 열기는 회원 보관함 다시 열기 길로(내 것만)", async () => {
  const { D1 } = setup();
  const d = await MB.data(D1, A, null);
  assert.deepEqual(d.archived, ["옛 일"]);
  assert.deepEqual(await MB.post(D1, A, "/api/nodereopen", { name: "옛 일" }), { path: "/api/me/nodes/edit", body: { op: "reopen", node: "n-2" } });
  assert.deepEqual(await MB.post(D1, A, "/api/nodereopen", { name: "막 끝남" }), { path: "/api/me/nodes/edit", body: { op: "reopen", node: "n-3" } });
  assert.deepEqual(await MB.post(D1, A, "/api/nodereopen", { name: "매출 보고" }), { error: "없는 노드예요", status: 404 });   // 살아 있는 노드
  assert.deepEqual(await MB.post(D1, B, "/api/nodereopen", { name: "막 끝남" }), { error: "없는 노드예요", status: 404 });     // 남의 노드
});

test("자주 쓴 반응: 내가 많이 단 것 먼저, 기본 순서로 채움, 남의 반응은 안 셈", async () => {
  const { db, D1 } = setup();
  const r = (o: string, id: number, e: string) => db.prepare("INSERT INTO member_react(owner, log_id, emoji, at) VALUES (?,?,?,?)").run(o, id, e, Date.now());
  r(A, 1, "fire"); r(A, 2, "fire"); r(A, 3, "tada"); r(B, 1, "skull"); r(B, 2, "skull"); r(B, 3, "skull");
  const base = (await get(D1, "c@example.com", "/api/emoji/frequent")).names;
  const mine = (await get(D1, A, "/api/emoji/frequent")).names;
  assert.deepEqual(mine.slice(0, 2), ["fire", "tada"]);
  assert.ok(!mine.includes("skull"));
  assert.equal(mine.length, base.length);
  assert.deepEqual(mine.slice(2), base.filter((x: string) => !["fire", "tada"].includes(x)).slice(0, base.length - 2));
});
