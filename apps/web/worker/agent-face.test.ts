// node --test --no-warnings --experimental-transform-types apps/web/worker/agent-face.test.ts — 주인 에이전트 얼굴(agent-face.ts), 메모리 SQLite(migrations 전부)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as A from "./agent-face.ts";

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])).map(r => ({ ...(r as object) })) }),
    run: async () => { db.prepare(sql).run(...(args as never[])); return { success: true }; },
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

test("고른 얼굴 저장 · 바꾸기 · 기본으로 되돌리기, 주인마다 따로", async () => {
  const db = d1();
  await A.set(db, "o@x", "company", { seed: "pebble", hue: 215 });
  await A.set(db, "o@x", "harness", { seed: "kiwi", hue: 45, photo: "0123456789abcdef0123456789abcdef" });
  await A.set(db, "p@x", "company", { seed: "tofu", hue: 320 });
  assert.deepEqual(await A.all(db, "o@x"), { company: { seed: "pebble", hue: 215 }, harness: { seed: "kiwi", hue: 45, photo: "0123456789abcdef0123456789abcdef" } });
  await A.set(db, "o@x", "company", { seed: "echo", hue: 18 });
  assert.deepEqual((await A.all(db, "o@x")).company, { seed: "echo", hue: 18 });
  await A.set(db, "o@x", "company", null);
  assert.deepEqual(Object.keys(await A.all(db, "o@x")), ["harness"]);
  assert.deepEqual(await A.all(db, "p@x"), { company: { seed: "tofu", hue: 320 } });
});

test("에이전트 키 꼴: 소문자로 시작하는 짧은 키만", () => {
  for (const k of ["primary", "company", "harness", "qa_lead"]) assert.equal(A.KEY.test(k), true, k);
  for (const k of ["", "Primary", "1x", "a", "x".repeat(40), "n:노드", "../x"]) assert.equal(A.KEY.test(k), false, k);
});

test("보이는 이름: 얼굴은 그대로, 이름만 넣고 · 비우고, 얼굴 없는 줄은 비우면 사라짐", async () => {
  const db = d1();
  await A.set(db, "o@x", "company", { seed: "pebble", hue: 215 });
  await A.setName(db, "o@x", "company", "네오 리드");
  await A.setName(db, "o@x", "dgit", "디깃");
  assert.deepEqual(await A.all(db, "o@x"), { company: { seed: "pebble", hue: 215, name: "네오 리드" }, dgit: { name: "디깃" } });
  await A.set(db, "o@x", "company", null);   // 얼굴만 되돌림, 이름은 남음
  assert.deepEqual((await A.all(db, "o@x")).company, { name: "네오 리드" });
  await A.setName(db, "o@x", "company", "");  // 얼굴 없는 줄 + 이름 비움 = 줄 지움
  await A.setName(db, "o@x", "dgit", "");
  assert.deepEqual(await A.all(db, "o@x"), {});
  await A.set(db, "o@x", "harness", { seed: "kiwi", hue: 45 }); await A.setName(db, "o@x", "harness", "");
  assert.deepEqual((await A.all(db, "o@x")).harness, { seed: "kiwi", hue: 45 });
});

test("이름 다듬기: 제어 글자 뺌 · 앞뒤 공백 · 40자", () => {
  assert.equal(A.cleanName("  회\u0000\n사  "), "회사");
  assert.equal([...A.cleanName("가".repeat(60))].length, 40);
  assert.equal(A.cleanName(null), "");
});
