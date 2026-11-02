import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);   // 확장자 없는 import · .md 를 풀어 줌(msg-retry.test.ts 와 같음)
const { data } = await import("./member-board.ts");

const MIG = new URL("../migrations/", import.meta.url);
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { db.prepare(sql).run(...(args as never[])); return { success: true }; },
  });
  return { db, d1: { prepare: (sql: string) => stmt(sql), batch: async (ss: ReturnType<typeof stmt>[]) => Promise.all(ss.map(s => s.all())) } as unknown as D1Database };
}
const A = "a@member.test", B = "b@member.test", T = Date.now() - 60_000;
const add = (db: DatabaseSync, who: string, id: string, name: string, area: string | null, state = "idle") =>
  db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)").run(who, id, name, area, state, "", T, T);

test("영역마다 한 열, 열 머리는 팀장 · 기타는 맨 뒤", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_1", "운영 담당", "acme", "working"); add(db, A, "n_2", "팀장", "acme", "turn"); add(db, A, "n_3", "영업 총괄", "acme");
  add(db, A, "n_4", "베타 팀장", "hbeta"); add(db, A, "n_5", "개인 비서", ".team-hq"); add(db, A, "n_6", "시험", "기타", "working");
  add(db, B, "n_9", "남의 노드", "zeta");
  const d = await data(d1, A, null) as { areas: { key: string; name: string; lead: string; lead_name?: string }[]; panes: { pane: string; win: string; area: string; kind: string }[] };
  assert.deepEqual(d.areas.map(a => a.name), ["Primary", "acme", ".team-hq", "hbeta", "기타"]);
  const acme = d.areas[1]; assert.equal(acme.lead_name, "팀장");
  const inAcme = d.panes.filter(p => p.area === acme.key);
  assert.equal(inAcme.length, 3); assert.ok(inAcme.every(p => p.kind === "lead"), "머리도 보통 노드 — 제 채팅 · 채널 목록 그대로");
  assert.ok(d.areas.every(a => /^(primary|m\d+)$/.test(a.key)), "열 키는 m0 · m1 …");
  assert.ok(!d.panes.some(p => p.win === "남의 노드"));
  assert.ok(d.areas.slice(1).every(a => d.panes.some(p => p.pane === a.lead && p.area === a.key)), "열 머리 판이 그 열에 있음");
});

test("영역이 하나뿐이면 예전처럼 Primary 한 열", async () => {
  const { db, d1 } = fakeD1();
  add(db, A, "n_1", "가", "acme"); add(db, A, "n_2", "나", "acme");
  const d = await data(d1, A, null) as { areas: { key: string }[]; panes: { area: string; kind: string }[] };
  assert.deepEqual(d.areas.map(a => a.key), ["primary"]);
  assert.ok(d.panes.every(p => p.area === "primary"));
});
