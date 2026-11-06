import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const OS = await import("./owner-state.ts");
function d1(db: DatabaseSync) {
  const exec = (sql: string, args: unknown[]) => {
    const st = db.prepare(sql);
    if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } };
    const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } };
  };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  return { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => { db.exec("BEGIN"); try { const out = ss.map(s => exec(s.sql, s.args)); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
}
const A = "a@example.com", B = "b@example.com";
const MIG = new URL("../migrations/", import.meta.url);
function setup() {
  const raw = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(f, MIG), "utf8"));
  raw.prepare("INSERT INTO owner_state(k, v, at, ver) VALUES ('drafts', '{}', 1, 0)").run();   // seed 뒤
  const row = (key: string) => { const r = raw.prepare("SELECT v FROM owner_state WHERE k = ?").get("drafts:" + key) as { v: string } | undefined; return r ? JSON.parse(r.v) : undefined; };
  return { db: d1(raw) as unknown as D1Database, raw, row };
}
const F1 = { id: "a".repeat(32), name: "사진.png", img: true, mime: "image/png", size: 10 }, F2 = { id: "c".repeat(32), name: "표.pdf", img: false, mime: "application/pdf", size: 20 };
const K = "chan:n:예시 노드";

test("주인 초안 첨부: 첨부만 저장 · 글만 고친 저장은 첨부 그대로 · [] 면 비움 · 보냄이면 비움", async () => {
  const s = setup(); let t = Date.now();
  assert.deepEqual(await OS.draft(s.db, { key: K, text: "", at: ++t, dev: "pc", files: [F1, F2] }), [200, { ok: true }]);
  assert.deepEqual(s.row(K), { text: "", at: t, dev: "pc", files: [F1, F2] });
  await OS.draft(s.db, { key: K, text: "글", at: ++t, dev: "phone" });   // 첨부를 모르는 다른 기기의 글 저장
  assert.deepEqual(s.row(K).files, [F1, F2]); assert.equal(s.row(K).text, "글");
  await OS.draft(s.db, { key: K, text: "", at: ++t, dev: "phone" });   // 글만 지움
  assert.deepEqual(s.row(K).files, [F1, F2]);
  await OS.draft(s.db, { key: K, text: "글", at: ++t, dev: "pc", files: [] });
  assert.equal(s.row(K).files, undefined);
  await OS.draft(s.db, { key: K, text: "글", at: ++t, dev: "pc", files: [F2] });
  const sentAt = ++t; await OS.draft(s.db, { key: K, text: "", at: sentAt, dev: "pc", sent: "글" });
  assert.equal(s.row(K).files, undefined); assert.equal(s.row(K).sent, sentAt);
  // 보낸 기기의 늦게 온 저장(보낸 시각 전) — 첨부만 있어도 버림
  assert.deepEqual(await OS.draft(s.db, { key: K, text: "", at: sentAt - 1, dev: "pc", files: [F2] }), [200, { ok: true, stale: true }]);
  // 다른 기기가 보낸 직후 첨부만 붙임 — 앞부분 규칙(글)은 안 걸림
  assert.deepEqual(await OS.draft(s.db, { key: K, text: "", at: ++t, dev: "phone", files: [F1] }), [200, { ok: true }]);
  assert.deepEqual(s.row(K).files, [F1]);
  // 더 옛 저장은 버림(첨부도)
  assert.deepEqual(await OS.draft(s.db, { key: K, text: "", at: t - 5, dev: "pc", files: [] }), [200, { ok: true, stale: true }]);
  assert.deepEqual(s.row(K).files, [F1]);
});

test("주인 초안 첨부: 첨부만 남은 칸은 7일 지난 지움 표 거름에서 안 지워짐 · 빈 칸은 지워짐", async () => {
  const s = setup(), old = Date.now() - 8 * 86400 * 1000;
  s.raw.prepare("INSERT INTO owner_state(k, v, at, ver, ord) VALUES (?, ?, 1, 0, 1)").run("drafts:th:1", JSON.stringify({ text: "", at: old, files: [F1] }));
  s.raw.prepare("INSERT INTO owner_state(k, v, at, ver, ord) VALUES (?, ?, 1, 0, 2)").run("drafts:th:2", JSON.stringify({ text: "", at: old }));
  await OS.draft(s.db, { key: K, text: "새 글", at: Date.now(), dev: "pc" });   // 저장 batch 끝의 거름이 돔
  assert.deepEqual(s.row("th:1").files, [F1]); assert.equal(s.row("th:2"), undefined);
});
