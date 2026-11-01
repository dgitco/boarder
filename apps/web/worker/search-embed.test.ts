import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const { Search } = await import("./search.ts");

function mk(ai: { down: boolean; calls: number }) {
  const db = new DatabaseSync(":memory:");
  const cur = (rows: unknown[], w = 0) => ({ toArray: () => rows, one: () => rows[0], rowsWritten: w, [Symbol.iterator]: () => rows[Symbol.iterator]() });
  const sql = {
    exec: (q: string, ...a0: unknown[]) => {
      const st = db.prepare(q), a = a0.map(x => x instanceof ArrayBuffer ? new Uint8Array(x) : x);   // DO SQL 은 ArrayBuffer 를 BLOB 으로 받음 — node:sqlite 는 Uint8Array 만
      if (/^\s*select/i.test(q) || /returning/i.test(q)) return cur(st.all(...(a as never[])));
      const r = st.run(...(a as never[])); return cur([], Number(r.changes));
    },
  };
  let alarmAt: number | null = null;
  const storage = { sql, getAlarm: async () => alarmAt, setAlarm: async (t: number) => { alarmAt = t; }, deleteAlarm: async () => { alarmAt = null; } };
  const AI = {
    run: async (_m: string, x: { text: string[] }) => {
      ai.calls++;
      if (ai.down) throw new Error("3040: Capacity temporarily exceeded, please try again.");
      // 글마다 다른 단위 벡터(첫 글자 코드로 칸을 고름)
      return { data: x.text.map(t => Array.from({ length: 1024 }, (_, i) => (i === t.charCodeAt(0) % 1024 ? 1 : 0.01))) };
    },
  };
  const s = new (Search as any)({ storage }, { AI });
  return { s, db, alarm: async () => { const at = alarmAt; alarmAt = null; await s.alarm(); return at; }, next: () => alarmAt };
}
const doc = (id: string, body: string) => ({ id, kind: "chat" as const, title: "", body, ch: "dgit", at: 1_793_300_000, emb: true });

test("AI 가 몇 분 막혀도(한도 · 일시 오류) 다시 열리면 기다리던 글이 뜻 색인에 들어감", async () => {
  const ai = { down: true, calls: 0 };
  const { s, alarm } = mk(ai);
  await s.upsert([doc("m:1", "가산세 납부서 다시 받기"), doc("m:2", "CMS 자동이체 신청")]);
  for (let i = 0; i < 8; i++) await alarm();   // 30초 × 8 ≈ 4분 막힘(예전엔 다섯 번째에 줄을 버림)
  assert.equal(s.state().vecs, 0);
  ai.down = false;
  for (let i = 0; i < 3; i++) await alarm();
  assert.deepEqual({ vecs: s.state().vecs, pending: s.state().pending }, { vecs: 2, pending: 0 }, "막힘이 풀린 뒤 두 글 모두 벡터가 있어야 함");
});

test("버려진 뒤에는 같은 글로 다시 올려도 되살아나지 않음 — 그래서 일시 막힘에 버리면 안 됨(위 시험의 까닭)", async () => {
  const ai = { down: true, calls: 0 };
  const { s, alarm } = mk(ai);
  await s.upsert([doc("m:1", "가산세 납부서 다시 받기")]);
  for (let i = 0; i < 8; i++) await alarm();
  ai.down = false;
  const r = await s.upsert([doc("m:1", "가산세 납부서 다시 받기")]);
  assert.equal(r.changed, 0, "sig 가 같아 건너뜀(정상)");
  await alarm();
  assert.equal(s.state().vecs, 1, "줄이 남아 있으면 막힘이 풀린 뒤 벡터가 생김");
});

test("계속 실패하는 글은 늘어나는 간격으로 다시 해보다(최대 1시간) 하루쯤 뒤 버림 — 무한히 30초마다 한도를 쓰지 않음", async () => {
  const ai = { down: true, calls: 0 };
  const { s, alarm, next } = mk(ai);
  await s.upsert([doc("m:1", "늘 실패하는 글")]);
  let total = 0, last = 0;
  for (let i = 0; i < 60 && s.state().pending; i++) {
    const t0 = Date.now(); await alarm();
    const at = next(); if (at === null) break;
    const gap = at - t0; assert.ok(gap >= last - 50 && gap <= 3_600_000 + 50, `간격은 줄지 않고 1시간을 넘지 않음 (${gap})`); last = gap; total += gap;
  }
  await alarm();
  assert.equal(s.state().pending, 0, "결국 버림");
  assert.ok(total >= 20 * 3600_000, `버리기 전 하루 가까이는 버팀 (${Math.round(total / 3600_000)}시간)`);
  assert.ok(ai.calls <= 40, `부른 횟수가 많지 않음 (${ai.calls})`);
});

test("(본 경로 확인) 지운 글 · 다시 맞추기(all)에서 빠진 글 · 벡터를 만드는 사이 지운 글은 낱말 · 뜻 찾기에 안 걸림", async () => {
  const ai = { down: false, calls: 0 };
  const { s, alarm } = mk(ai);
  await s.upsert([doc("m:1", "가산세 납부서 하나"), doc("m:2", "가산세 납부서 둘"), doc("m:3", "가산세 납부서 셋")]);
  await alarm();
  assert.equal(s.state().vecs, 3);
  await s.upsert([], ["m:1"]);                        // 지움
  await s.upsert([], [], ["m:3"]);                    // 다시 맞추기: m:3 만 남음(보낸 기록을 잃은 릴레이)
  const ids = (r: any) => r.chats.map((x: { id: string }) => x.id).sort();
  assert.deepEqual(ids(await s.query("가산세 납부서", false)), ["m:3"]);
  assert.equal(s.state().vecs, 1);
  // 모델을 기다리는 사이 지움 → 벡터를 쓰지 않음
  await s.upsert([doc("m:4", "가산세 새 글")]);
  const run = ai as any, orig = s.env.AI.run;
  s.env.AI.run = async (m: string, x: { text: string[] }) => { await s.upsert([], ["m:4"]); return orig(m, x); };
  await alarm(); s.env.AI.run = orig; void run;
  assert.deepEqual({ docs: s.state().docs, vecs: s.state().vecs, pending: s.state().pending }, { docs: 1, vecs: 1, pending: 0 });
  assert.deepEqual(ids(await s.query("가산세", true)), ["m:3"]);
});
