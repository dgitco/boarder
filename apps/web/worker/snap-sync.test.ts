import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { BoardSnap } = await import("./board.ts");

const disk = () => new DatabaseSync(":memory:");
// DO 하나의 삶: 같은 disk 위에 새 BoardSnap(메모리 · 타이머는 새로)
function life(db: DatabaseSync) {
  const sql = {
    exec: (q: string, ...a: unknown[]) => {
      const st = db.prepare(q);
      if (/^\s*select/i.test(q)) { const rows = st.all(...(a as never[])); return { toArray: () => rows, rowsWritten: 0 }; }
      const r = st.run(...(a as never[])); return { toArray: () => [], rowsWritten: Number(r.changes) };
    },
  };
  const ctx = { storage: { sql, sync: async () => {} }, setWebSocketAutoResponse() {}, getWebSockets: () => [], acceptWebSocket() {}, abort() {} };
  return new BoardSnap(ctx as never, {});
}
// DO 가 늦은 저장 타이머 전에 내려감(배포 · 나감) — 메모리 판은 사라짐
const die = (s: any) => { if (s.persistT) clearTimeout(s.persistT); s.persistT = null; };

test("늦은 저장 판을 잃고 다시 뜬 DO 가 다른 칸을 바로 쓰고 또 내려가도, 그다음 삶에서 잃은 칸의 옛 판을 「맞음」으로 받지 않음", async () => {
  const db = disk();
  // 삶 0(바로 씀): topics = A, data = D0
  let s: any = life(db);
  await s.put("topics", '{"v":"A"}'); await s.put("data", '{"v":"D0"}');
  // 삶 1(write_snaplazy 켬): topics = B 를 메모리에만 — 1.5초 안에 DO 가 내려감(디스크엔 A 그대로, 늦은 저장 표 __lazy 남음)
  s = life(db);
  await s.put("topics", '{"v":"B"}', false, true);
  die(s);
  // 삶 2(스위치를 끈 직후): 릴레이가 data touch → 「없음」 → data 를 통째로 다시(바로 씀). topics 에 닿기 전에 DO 가 또 내려감
  s = life(db);
  assert.equal(await s.touch("data", false), false);
  await s.put("data", '{"v":"D1"}');
  assert.equal(await s.touch("topics", false), false, "삶 2 안에서는 topics 옛 판을 「맞음」으로 받지 않음(지금도 됨)");
  die(s);
  // 삶 3: 디스크 topics 는 아직 A(B 는 잃음). 릴레이는 B 를 이미 올린 줄 알고 touch 만 함 → 받으면 A 가 「지금 판」으로 굳음
  s = life(db);
  const t = await s.get("topics");
  assert.equal(JSON.parse(t.body).v, "A");
  assert.equal(t.at, 0, "다시 받지 않은 칸은 낡음(시각 0)으로 내줘야 함 — 15초 · 120초 검사에서 다리 · 503");
  assert.equal(await s.touch("topics", false), false, "옛 판 A 를 「맞음」으로 받으면 릴레이가 B 를 다시 안 올림");
  // 받은 칸(data)은 그대로 「맞음」
  assert.equal(JSON.parse((await s.get("data")).body).v, "D1");
});

test("늦은 저장 뒤 다시 뜬 DO 에서 모든 칸을 다시 받으면 __lazy 표를 지우고, 그다음 삶은 디스크 판을 그대로 믿음", async () => {
  const db = disk();
  let s: any = life(db);
  await s.put("topics", '{"v":"A"}', false, true); await s.put("data", '{"v":"D0"}', false, true);
  die(s);
  s = life(db);
  await s.put("topics", '{"v":"B"}'); await s.put("data", '{"v":"D1"}');
  assert.equal(db.prepare("SELECT count(*) n FROM snap WHERE key='__lazy'").get()!.n, 0);
  s = life(db);
  assert.ok((await s.get("topics")).at > 0);
  assert.equal(await s.touch("topics", false), true);
});

test("늦은 저장만 쓰는 동안: 타이머가 돌면 디스크에 들어가고, 다시 뜬 뒤 첫 touch 는 「없음」(통째로 다시)", async () => {
  const db = disk();
  let s: any = life(db);
  await s.put("data", '{"v":"D0"}', false, true);
  if (s.persistT) { clearTimeout(s.persistT); s.persist(); }
  assert.equal(JSON.parse(String(db.prepare("SELECT body FROM snap WHERE key='data'").get()!.body)).v, "D0");
  s = life(db);
  assert.equal(await s.touch("data", true), false);
  await s.put("data", '{"v":"D0"}', false, true);
  assert.equal(await s.touch("data", true), true);
  die(s);
});
