import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const { importedWindow, queueToImported } = await import("./member-imported.ts");
const MIG = new URL("../migrations/", import.meta.url), A = "a@example.com", B = "b@example.com";
function fake() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({ bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => (db.prepare(sql).get(...(args as never[])) as unknown) ?? null, all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    run: async () => { db.prepare(sql).run(...(args as never[])); return { meta: {} }; } });
  return { db, D1: { prepare: (s: string) => stmt(s) } as unknown as D1Database };
}
const win = (db: DatabaseSync, owner: string, key: string, w: string, session: string, gone: number | null, handle: string | null = '{"engine":"tmux-own","pane":"%3"}') =>
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, state, win, session, handle, seen_at, gone_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(owner, key, "dev1", "window", "tmux-own", "AI 담당자", gone ? "gone" : "idle", w, session, handle, Date.now(), gone);

test("살아 있는 그 창이면 그 창(예전 그대로)", async () => {
  const { db, D1 } = fake(); win(db, A, "window:k1", "mini:ew_old1", "session:claude:s1", null);
  assert.equal((await importedWindow(D1, A, { wid: "ew_old1", win: "" }))?.key, "window:k1");
});
test("그 창이 닫히고 같은 대화가 새 창 id 로 열렸으면 새 창으로", async () => {
  const { db, D1 } = fake(); win(db, A, "window:k1", "mini:ew_old1", "session:claude:s1", Date.now() - 60_000); win(db, A, "window:k2", "mini:ew_new2", "session:claude:s1", null);
  win(db, B, "window:k9", "mini:ew_bbb9", "session:claude:s1", null);   // 남의 같은 세션 id 는 안 섞임
  const w = await importedWindow(D1, A, { wid: "ew_old1", win: "" });
  assert.equal(w?.key, "window:k2"); assert.equal(w?.state, "idle");
});
test("같은 대화 창도 없으면 닫힌 그 창을 다시 열며(reopen) — 손잡이가 없으면 null", async () => {
  const { db, D1 } = fake(); win(db, A, "window:k1", "mini:ew_old1", "session:claude:s1", Date.now() - 60_000);
  const w = await importedWindow(D1, A, { wid: "ew_old1", win: "" });
  assert.equal(w?.key, "window:k1"); assert.equal(w?.state, "parked");
  await queueToImported(D1, A, w!, "답", "1793000000.000001");
  assert.equal((db.prepare("SELECT verb FROM engine_cmd WHERE owner = ?").get(A) as any).verb, "reopen");
  const g = fake(); win(g.db, A, "window:k1", "mini:ew_old1", "", Date.now() - 60_000, null);
  assert.equal(await importedWindow(g.D1, A, { wid: "ew_old1", win: "" }), null);
});
test("wid 없는 카드(창 이름)도 같은 길: 이름으로 찾은 창이 닫혔으면 같은 대화의 새 창", async () => {
  const { db, D1 } = fake(); win(db, A, "window:q1", "qbus", "session:claude:s7", Date.now() - 60_000); win(db, A, "window:q2", "qbus2", "session:claude:s7", null);
  assert.equal((await importedWindow(D1, A, { wid: null, win: "qbus" }))?.key, "window:q2");
  assert.equal(await importedWindow(D1, B, { wid: null, win: "qbus" }), null);
});
test("닫힌 창에 답이 연달아 와도 다시 열기는 하나: 대기 중이면 그 글에 덧붙임, 여는 중이면 손잡이 빈 send(fresh)", async () => {
  const { db, D1 } = fake(); win(db, A, "window:k1", "mini:ew_old1", "session:claude:s1", Date.now() - 60_000);
  for (const t of ["답 하나", "답 둘"]) await queueToImported(D1, A, (await importedWindow(D1, A, { wid: "ew_old1", win: "" }))!, t, "1793000000.000001");
  let rows = db.prepare("SELECT verb, state, args FROM engine_cmd WHERE owner = ?").all(A) as any[];
  assert.equal(rows.length, 1); assert.equal(rows[0].verb, "reopen"); assert.match(JSON.parse(rows[0].args).text, /답 하나 \/ 답 둘/);
  db.prepare("UPDATE engine_cmd SET state = 'taken', taken_at = ? WHERE owner = ?").run(Date.now(), A);   // 기기가 가져가 여는 중
  await queueToImported(D1, A, (await importedWindow(D1, A, { wid: "ew_old1", win: "" }))!, "답 셋", "1793000000.000001");
  rows = db.prepare("SELECT verb, args FROM engine_cmd WHERE owner = ? ORDER BY at").all(A) as any[];
  assert.equal(rows.length, 2); assert.equal(rows[1].verb, "send"); const a = JSON.parse(rows[1].args); assert.equal(a.fresh, true); assert.equal(a.handle, null); assert.equal(a.text, "답 셋");
  db.prepare("UPDATE imp_item SET gone_at = NULL, state = 'working', handle = ? WHERE owner = ? AND key = ?").run('{"engine":"tmux-own","pane":"%9"}', A, "window:k1");
  const w = await importedWindow(D1, A, { wid: "ew_old1", win: "" }); assert.equal(w?.state, "working");
  await queueToImported(D1, A, w!, "답 넷"); assert.equal((db.prepare("SELECT verb FROM engine_cmd WHERE owner = ? ORDER BY at DESC LIMIT 1").get(A) as any).verb, "send");
});
