// node --test --no-warnings --experimental-transform-types apps/web/worker/status-pages/taskboard.test.ts — 태스크 현황 API 계약 · 사람 경계(자료는 다 지어낸 것)
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { Hono } from "hono";
registerHooks({ resolve(spec, ctx, next) { try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(spec + ".ts", ctx); throw e; } } });
const { mountTaskBoard, cleanTask, stateOf } = await import("./taskboard.ts");
const { setFeat } = await import("./feature.ts");
const { d1 } = await import("./test-db.mjs");
const A = "minji@example.com", B = "junho@example.com";
const DEV: Record<string, { id: string; owner: string }> = { "tok-a": { id: "dv_a", owner: A }, "tok-b": { id: "dv_b", owner: B } };
async function setup(on: string[] = [A, B]) {
  const f = d1(), app = new Hono();
  mountTaskBoard(app as never, { who: async c => c.req.header("x-test-user") || null, device: async c => DEV[(c.req.header("authorization") || "").replace(/^Bearer /, "")] || null, nameOf: async (_c, e) => e === A ? "민지" : "" });
  for (const e of on) await setFeat(f.D1, e, "taskboard", true);
  const env = { DB: f.D1, FLAGS_OFF: "" };
  const wire = (b: unknown) => b === undefined ? {} : b instanceof ReadableStream ? { body: b, duplex: "half" } : { body: JSON.stringify(b) };   // 스트림 = content-length 없는 몸
  const me = (who: string | null, method: string, path: string, body?: unknown, hb = true) => app.request(path, { method, headers: { ...(who ? { "x-test-user": who } : {}), ...(hb ? { "x-hb": "1" } : {}), "content-type": "application/json" }, ...wire(body) } as RequestInit, env as never);
  const dev = (tok: string | null, method: string, path: string, body?: unknown) => app.request(path, { method, headers: { ...(tok ? { authorization: "Bearer " + tok } : {}), "content-type": "application/json" }, ...wire(body) } as RequestInit, env as never);
  return { ...f, me, dev };
}
const T = (id: string, x: object = {}) => ({ id, title: "제목 " + id, quote: "원문 " + id, status: "진행", ...x });
const L = (task_id: string, k: string, text: string, x: object = {}) => ({ task_id, k, text, at: 1_790_000_000_000, who: "비서실장", ...x });

test("로그인 · 기기 토큰 없으면 401", async () => {
  const { me, dev } = await setup();
  assert.equal((await me(null, "GET", "/api/me/taskboard")).status, 401);
  assert.equal((await me(null, "GET", "/api/me/taskboard/R1")).status, 401);
  assert.equal((await me(null, "POST", "/api/me/taskboard/R1/say", { text: "x" })).status, 401);
  assert.equal((await dev(null, "POST", "/api/device/taskboard", { tasks: [T("R1")] })).status, 401);
  assert.equal((await dev("bad", "GET", "/api/device/taskboard/said")).status, 401);
});
test("기능을 끈 사람은 읽기 · 말하기 · 기기 올리기 · 가져가기 모두 403, 올린 것도 안 남음", async () => {
  const { me, dev, db } = await setup([]);
  assert.equal((await me(A, "GET", "/api/me/taskboard")).status, 403);
  assert.equal((await me(A, "GET", "/api/me/taskboard/R1")).status, 403);
  assert.equal((await me(A, "POST", "/api/me/taskboard/R1/say", { text: "x" })).status, 403);
  assert.equal((await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] })).status, 403);
  assert.equal((await dev("tok-a", "GET", "/api/device/taskboard/said")).status, 403);
  assert.equal((await dev("tok-a", "POST", "/api/device/taskboard/said/ack", { keys: [] })).status, 403);
  assert.equal((db.prepare("SELECT count(*) n FROM task_board").get() as { n: number }).n, 0);
});
test("올린 사람(기기 주인)만 봄 — 다른 사람은 목록에 없고 세부 · 말하기는 404", async () => {
  const { me, dev } = await setup();
  const r = await (await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1"), T("R2", { status: "끝" })], convo: [L("R1", "a", "첫 줄")] })).json();
  assert.deepEqual([r.ok, r.tasks, r.added], [true, 2, 1]);
  const a = await (await me(A, "GET", "/api/me/taskboard")).json();
  assert.deepEqual(a.tasks.map((t: { id: string }) => t.id).sort(), ["R1", "R2"]);
  assert.equal(a.tasks.find((t: { id: string }) => t.id === "R2").state, "done");
  const b = await (await me(B, "GET", "/api/me/taskboard")).json();
  assert.deepEqual(b.tasks, []);
  assert.equal((await me(B, "GET", "/api/me/taskboard/R1")).status, 404);
  assert.equal((await me(B, "POST", "/api/me/taskboard/R1/say", { text: "끼어들기" })).status, 404);
  const d = await (await me(A, "GET", "/api/me/taskboard/R1")).json();
  assert.equal(d.task.quote, "원문 R1"); assert.equal(d.convo.length, 1);
});
test("대화 줄: 같은 열쇠(k)는 한 번 · 없는 요청에 붙인 줄은 버림 · 겹(layer) · 내 줄(mine) 그대로", async () => {
  const { me, dev } = await setup();
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] });
  const r = await (await dev("tok-a", "POST", "/api/device/taskboard", { convo: [L("R1", "a", "하나"), L("R1", "a", "하나 다시"), L("R1", "b", "에이전트끼리", { layer: "agent" }), L("R1", "c", "내 말", { mine: true }), L("R9", "z", "없는 요청")] })).json();
  assert.equal(r.added, 3);
  const again = await (await dev("tok-a", "POST", "/api/device/taskboard", { convo: [L("R1", "a", "하나")] })).json();
  assert.equal(again.added, 0);
  const d = await (await me(A, "GET", "/api/me/taskboard/R1")).json();
  assert.deepEqual(d.convo.map((l: { k: string; layer: string; mine: number }) => [l.k, l.layer, l.mine]), [["a", "human", 0], ["b", "agent", 0], ["c", "human", 1]]);
  // 다른 사람 기기가 같은 요청 id 로 올려도 A 의 요청에 안 섞임(자기 칸에만 — 요청이 없으니 줄도 버림)
  const rb = await (await dev("tok-b", "POST", "/api/device/taskboard", { convo: [L("R1", "x", "남의 줄")] })).json();
  assert.equal(rb.added, 0);
  assert.equal((await (await me(A, "GET", "/api/me/taskboard/R1")).json()).convo.length, 3);
});
test("말하기: 같은 사이트 머리 · 빈 글 · 없는 요청 막음, 쓴 줄은 전달 대기 → 기기가 가져가 ack 하면 전달됨(남의 기기 ack 는 안 먹음)", async () => {
  const { me, dev } = await setup();
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] });
  assert.equal((await me(A, "POST", "/api/me/taskboard/R1/say", { text: "x" }, false)).status, 403);
  assert.equal((await me(A, "POST", "/api/me/taskboard/R1/say", { text: "   " })).status, 400);
  assert.equal((await me(A, "POST", "/api/me/taskboard/R404/say", { text: "x" })).status, 404);
  const s = await (await me(A, "POST", "/api/me/taskboard/R1/say", { text: "B 안으로 가요" })).json();
  assert.deepEqual([s.line.who, s.line.mine, s.line.pending, s.line.layer], ["민지", 1, 1, "human"]);
  assert.deepEqual((await (await dev("tok-b", "GET", "/api/device/taskboard/said")).json()).said, []);
  const got = await (await dev("tok-a", "GET", "/api/device/taskboard/said")).json();
  assert.equal(got.said.length, 1); assert.equal(got.said[0].text, "B 안으로 가요");
  assert.equal((await (await dev("tok-b", "POST", "/api/device/taskboard/said/ack", { keys: [{ task_id: "R1", k: got.said[0].k }] })).json()).acked, 0);
  assert.equal((await (await dev("tok-a", "POST", "/api/device/taskboard/said/ack", { keys: [{ task_id: "R1", k: got.said[0].k }] })).json()).acked, 1);
  assert.deepEqual((await (await dev("tok-a", "GET", "/api/device/taskboard/said")).json()).said, []);
  const d = await (await me(A, "GET", "/api/me/taskboard/R1")).json();
  assert.equal(d.convo[0].pending, 0);
});
test("올리기 상한(요청 300 · 대화 1000줄)을 넘으면 413 · 지우기(remove)는 그 요청과 대화만", async () => {
  const { me, dev } = await setup();
  assert.equal((await dev("tok-a", "POST", "/api/device/taskboard", { tasks: Array.from({ length: 301 }, (_, i) => T("R" + i)) })).status, 413);
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1"), T("R2")], convo: [L("R1", "a", "x"), L("R2", "b", "y")] });
  await dev("tok-a", "POST", "/api/device/taskboard", { remove: ["R1"] });
  const a = await (await me(A, "GET", "/api/me/taskboard")).json();
  assert.deepEqual(a.tasks.map((t: { id: string }) => t.id), ["R2"]);
  assert.equal((await me(A, "GET", "/api/me/taskboard/R1")).status, 404);
});
test("받는 칸 거르기: 이상한 id 는 버림 · PR 주소는 https 만 · 상태 글자 → 칩 꼴", () => {
  assert.equal(cleanTask({ id: "../x" }, 1), null);
  assert.equal(cleanTask({ id: "R1 R2" }, 1), null);
  const t = cleanTask({ id: "R1", prs: [7, { n: 8, state: "merged", url: "javascript:alert(1)" }, { n: 9, url: "https://example.com/pull/9" }, { n: -1 }] }, 1)!;
  assert.deepEqual(t.prs, [{ n: 7, state: "open" }, { n: 8, state: "merged" }, { n: 9, state: "open", url: "https://example.com/pull/9" }]);
  assert.deepEqual(["진행", "막힘", "기다림", "끝", "안 함", "멈춤", "모름"].map(s => stateOf(undefined, s)), ["working", "blocked", "waiting", "done", "cancelled", "blocked", "working"]);
  assert.equal(stateOf("waiting", "끝"), "waiting");
});

const A2 = "tok-a2"; DEV[A2] = { id: "dv_a2", owner: A };
const pend = (db: any) => db.prepare("SELECT task_id, k, pending, taken_by, to_device FROM task_board_convo WHERE pending = 1").all();
const said = async (dev: any, tok: string) => (await (await dev(tok, "GET", "/api/device/taskboard/said")).json()).said as { task_id: string; k: string; text: string }[];
const big = (len: number) => { let n = 0; return new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode("x".repeat(65536))); n += 65536; if (n >= len) c.close(); } }); };
test("said: 그 요청을 올린 기기만 받고 가져감 표시를 남김 — 두 기기가 같은 줄을 둘 다 못 받음, 표시는 줄에", async () => {
  const { me, dev, db } = await setup();
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] }); await dev(A2, "POST", "/api/device/taskboard", { tasks: [T("R2")] });
  await me(A, "POST", "/api/me/taskboard/R1/say", { text: "일번" }); await me(A, "POST", "/api/me/taskboard/R2/say", { text: "이번" });
  assert.deepEqual((await said(dev, "tok-a")).map(x => x.text), ["일번"], "자기 기기가 올린 요청의 말만");
  assert.deepEqual((await said(dev, A2)).map(x => x.text), ["이번"]);
  assert.deepEqual(await said(dev, "tok-a"), [], "이미 가져간 줄은 또 안 나감");
  assert.deepEqual(pend(db).map((r: any) => [r.task_id, r.taken_by, r.pending]), [["R1", "dv_a", 1], ["R2", "dv_a2", 1]]);
});
test("said: 가져가고 ack 를 못 한 줄은 잠시 뒤 다시 나감 · ack 는 가져간 기기만", async () => {
  const { me, dev, db } = await setup();
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] }); await me(A, "POST", "/api/me/taskboard/R1/say", { text: "말" });
  const [l] = await said(dev, "tok-a"); assert.ok(l);
  assert.equal((await (await dev(A2, "POST", "/api/device/taskboard/said/ack", { keys: [{ task_id: "R1", k: l.k }] })).json()).acked, 0, "다른 기기 ack 는 안 먹음");
  db.prepare("UPDATE task_board_convo SET taken_at = taken_at - 3600000").run();
  assert.deepEqual((await said(dev, "tok-a")).map(x => x.k), [l.k], "맡은 시간이 지나면 다시");
  assert.equal((await (await dev("tok-a", "POST", "/api/device/taskboard/said/ack", { keys: [{ task_id: "R1", k: l.k }] })).json()).acked, 1);
  db.prepare("UPDATE task_board_convo SET taken_at = taken_at - 3600000").run();
  assert.deepEqual(await said(dev, "tok-a"), [], "ack 뒤엔 안 나감");
});
test("said: 다른 기기가 같은 요청을 다시 올리면 그 뒤 말은 새 기기로", async () => {
  const { me, dev } = await setup();
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] }); await dev(A2, "POST", "/api/device/taskboard", { tasks: [T("R1")] });
  await me(A, "POST", "/api/me/taskboard/R1/say", { text: "말" });
  assert.deepEqual(await said(dev, "tok-a"), []); assert.equal((await said(dev, A2)).length, 1);
});
test("remove: 전달 대기 말은 안 지움 — 요청을 지워도 올렸던 기기가 받고, ack 하면 그때 줄이 사라짐 · 전달 끝난 줄은 같이 지움", async () => {
  const { me, dev, db } = await setup();
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")], convo: [L("R1", "a", "옛 줄")] }); await me(A, "POST", "/api/me/taskboard/R1/say", { text: "못 받은 말" });
  await dev("tok-a", "POST", "/api/device/taskboard", { remove: ["R1"] });
  const n = () => (db.prepare("SELECT count(*) n FROM task_board_convo").get() as { n: number }).n;
  assert.equal(n(), 1, "전달 대기 한 줄만 남음"); assert.equal((await me(A, "GET", "/api/me/taskboard/R1")).status, 404);
  assert.deepEqual(await said(dev, A2), [], "다른 기기는 못 받음");
  const got = await said(dev, "tok-a"); assert.deepEqual(got.map(x => x.text), ["못 받은 말"]);
  assert.equal((await (await dev("tok-a", "POST", "/api/device/taskboard/said/ack", { keys: [{ task_id: "R1", k: got[0].k }] })).json()).acked, 1);
  assert.equal(n(), 0, "전한 뒤 고아 줄이 안 남음");
});
test("said 의 k 를 그대로 다시 올리면 한 줄(겹치지 않고 dropped 도 아님)", async () => {
  const { me, dev } = await setup();
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] }); await me(A, "POST", "/api/me/taskboard/R1/say", { text: "말" });
  const [l] = await said(dev, "tok-a");
  const r = await (await dev("tok-a", "POST", "/api/device/taskboard", { convo: [{ task_id: "R1", k: l.k, text: "말", at: 1_790_000_000_000, who: "나", mine: true }] })).json();
  assert.deepEqual([r.added, r.dropped], [0, 0]);
  assert.equal((await (await me(A, "GET", "/api/me/taskboard/R1")).json()).convo.length, 1);
});
test("dropped: k 없이 같은 src_ref 인 다른 글 · 같은 열쇠의 다른 글 · 없는 요청 줄 · 망가진 줄을 다 셈, 같은 줄 다시 올리기는 안 셈", async () => {
  const { dev } = await setup();
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] });
  const sr = (i: number) => ({ task_id: "R1", src_ref: "thread-1", at: 1_790_000_000_000 + i, who: "w", text: "줄" + i });
  let r = await (await dev("tok-a", "POST", "/api/device/taskboard", { convo: [sr(1), sr(2), sr(3)] })).json();
  assert.deepEqual([r.lines, r.added, r.dropped], [3, 1, 2], "같은 src_ref 의 다른 글 둘이 빠짐");
  r = await (await dev("tok-a", "POST", "/api/device/taskboard", { convo: [sr(1)] })).json();
  assert.deepEqual([r.added, r.dropped], [0, 0], "같은 줄 다시 올리기는 빠진 게 아님");
  r = await (await dev("tok-a", "POST", "/api/device/taskboard", { convo: [sr(2)] })).json();
  assert.deepEqual([r.added, r.dropped], [0, 1], "저장된 줄과 글이 다름");
  r = await (await dev("tok-a", "POST", "/api/device/taskboard", { convo: [L("R9", "z", "없는 요청"), { task_id: "../x", text: "t", at: 1 }, L("R1", "ok", "새 줄")], tasks: [{ id: "../x" }] })).json();
  assert.deepEqual([r.added, r.dropped], [1, 3], "없는 요청 · 망가진 줄 · 망가진 요청");
});
test("마지막으로 올라온 때: 대화 줄만 올려도 바뀜, 사람의 「말하기」는 안 바꿈", async () => {
  const { me, dev, db } = await setup();
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] });
  const old = Date.now() - 3_600_000; db.prepare("UPDATE task_board SET at = ?").run(old); db.prepare("UPDATE task_board_use SET last_at = ?").run(old);
  await me(A, "POST", "/api/me/taskboard/R1/say", { text: "말" });
  assert.equal((await (await me(A, "GET", "/api/me/taskboard")).json()).at, old, "말하기는 올라온 게 아님");
  await dev("tok-a", "POST", "/api/device/taskboard", { convo: [L("R1", "a", "줄")] });
  assert.ok((await (await me(A, "GET", "/api/me/taskboard")).json()).at > Date.now() - 60_000);
});
test("사람별 총량: 요청 · 대화 줄 · 글 크기 — 넘으면 429 로 아무것도 안 들어가고, 있던 것 덮어쓰기와 같은 줄 다시 올리기 · 다른 사람은 그대로", async () => {
  const { LIMITS } = await import("./taskboard.ts"); const { me, dev, db } = await setup(); const now = Date.now();
  const addT = db.prepare("INSERT INTO task_board(owner, id, updated_at, at) VALUES (?,?,?,?)"), addL = db.prepare("INSERT INTO task_board_convo(owner, task_id, k, at, text, got_at) VALUES (?,?,?,?,?,?)");
  db.exec("BEGIN"); for (let i = 0; i < LIMITS.tasks; i++) addT.run(A, "F" + i, now, now); db.exec("COMMIT");
  let r = await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("NEW")] }); assert.equal(r.status, 429); assert.equal((await r.json()).max_tasks, LIMITS.tasks);
  assert.equal(db.prepare("SELECT 1 x FROM task_board WHERE id = 'NEW'").get(), undefined);
  assert.equal((await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("F1", { title: "덮어씀" })] })).status, 200, "있던 요청 덮어쓰기는 됨");
  assert.equal((await dev("tok-b", "POST", "/api/device/taskboard", { tasks: [T("NEW")] })).status, 200, "다른 사람은 그대로");
  await dev("tok-a", "POST", "/api/device/taskboard", { remove: ["F0", "F2"] });
  assert.equal((await dev("tok-a", "POST", "/api/device/taskboard", { remove: ["F3"], tasks: [T("NEW2")] })).status, 200, "같은 몸의 지우기로 자리가 나면 됨");
  db.exec("BEGIN"); for (let i = 0; i < LIMITS.lines; i++) addL.run(A, "F1", "k" + i, now, "x", now); db.exec("COMMIT");
  r = await dev("tok-a", "POST", "/api/device/taskboard", { convo: [L("F1", "new", "새 줄")] }); assert.equal(r.status, 429); assert.equal((await r.json()).max_lines, LIMITS.lines);
  r = await dev("tok-a", "POST", "/api/device/taskboard", { convo: [{ task_id: "F1", k: "k5", text: "x", at: now }] }); assert.equal(r.status, 200, "같은 줄 다시 올리기는 한도를 안 먹음");
  assert.equal((await me(A, "POST", "/api/me/taskboard/F1/say", { text: "말" })).status, 429, "말하기도 총량 안에서");
  db.prepare("DELETE FROM task_board_convo").run(); addL.run(A, "F1", "huge", now, "가".repeat(Math.ceil(LIMITS.bytes / 3)), now);
  r = await dev("tok-a", "POST", "/api/device/taskboard", { convo: [L("F1", "new", "새 줄")] }); assert.equal(r.status, 429); assert.equal((await r.json()).max_bytes, LIMITS.bytes);
});
test("하루 횟수: 올리기 · 새 줄 · 말하기 — 넘으면 429, 다음 날 풀림, 안 쓰면 그 사람 값만", async () => {
  const { LIMITS } = await import("./taskboard.ts"); const { me, dev, db } = await setup();
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] });
  const u = db.prepare("SELECT * FROM task_board_use WHERE owner = ?").get(A) as { pushes: number; lines: number; day: number };
  assert.equal(u.pushes, 1);
  db.prepare("UPDATE task_board_use SET pushes = ?").run(LIMITS.dayPushes);
  let r = await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] }); assert.equal(r.status, 429); assert.equal((await r.json()).max_per_day, LIMITS.dayPushes);
  assert.equal((await dev("tok-b", "POST", "/api/device/taskboard", { tasks: [T("R1")] })).status, 200);
  db.prepare("UPDATE task_board_use SET pushes = 0, lines = ?").run(LIMITS.dayLines - 1);
  r = await dev("tok-a", "POST", "/api/device/taskboard", { convo: [L("R1", "a", "일"), L("R1", "b", "이")] }); assert.equal(r.status, 429); const j = await r.json(); assert.deepEqual([j.max_per_day, j.left], [LIMITS.dayLines, 1]);
  assert.equal((await dev("tok-a", "POST", "/api/device/taskboard", { convo: [L("R1", "a", "일")] })).status, 200);
  db.prepare("UPDATE task_board_use SET says = ?").run(LIMITS.daySays);
  assert.equal((await me(A, "POST", "/api/me/taskboard/R1/say", { text: "말" })).status, 429);
  db.prepare("UPDATE task_board_use SET day = day - 1").run();
  assert.equal((await me(A, "POST", "/api/me/taskboard/R1/say", { text: "말" })).status, 200, "다음 날 풀림");
  assert.equal((await dev("tok-a", "POST", "/api/device/taskboard", { convo: [L("R1", "c", "삼")] })).status, 200);
  const v = db.prepare("SELECT lines, pushes, says FROM task_board_use WHERE owner = ?").get(A) as any; assert.deepEqual([v.lines, v.pushes, v.says], [1, 1, 1], "날이 바뀌면 처음부터");
});
test("보관 기간: 오래 안 올라온 요청 · 오래된 줄(전달 대기 포함) · 옛 횟수 줄을 지우고 나머지는 둠", async () => {
  const { LIMITS, sweepTaskBoard } = await import("./taskboard.ts"); const { dev, db, D1, me } = await setup(); const old = Date.now() - (LIMITS.keepDays + 1) * 86_400_000;
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1"), T("R2")], convo: [L("R1", "a", "옛 줄"), L("R1", "b", "새 줄")] });
  await me(A, "POST", "/api/me/taskboard/R2/say", { text: "못 받은 말" });
  db.prepare("UPDATE task_board SET at = ? WHERE id = 'R2'").run(old); db.prepare("UPDATE task_board_convo SET got_at = ? WHERE k = 'a' OR pending = 1").run(old);
  await dev("tok-b", "POST", "/api/device/taskboard", { tasks: [T("R9")] }); db.prepare("UPDATE task_board_use SET day = day - ? WHERE owner = ?").run(LIMITS.keepDays + 1, B);
  await sweepTaskBoard(D1);
  assert.deepEqual(db.prepare("SELECT id FROM task_board WHERE owner = ?").all(A).map((r: any) => r.id), ["R1"]);
  assert.deepEqual(db.prepare("SELECT k FROM task_board_convo").all().map((r: any) => r.k), ["b"]);
  assert.equal(db.prepare("SELECT 1 x FROM task_board_use WHERE owner = ?").get(B), undefined);
  assert.ok(db.prepare("SELECT 1 x FROM task_board_use WHERE owner = ?").get(A));
});
test("몸 크기 상한: content-length 없는 큰 몸 — 올리기 · 말하기 · ack 413, 아무것도 안 남음", async () => {
  const { me, dev, db } = await setup();
  await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1")] });
  for (const [who, path] of [["tok-a", "/api/device/taskboard"], ["tok-a", "/api/device/taskboard/said/ack"], [null, "/api/me/taskboard/R1/say"]] as const) {
    const r = await (who ? dev(who, "POST", path, big(2_000_000)) : me(A, "POST", path, big(2_000_000)));
    assert.equal(r.status, 413, path);
  }
  assert.equal((db.prepare("SELECT count(*) n FROM task_board_convo").get() as { n: number }).n, 0);
  const ok = await me(A, "POST", "/api/me/taskboard/R1/say", { text: "가".repeat(8000) }); assert.equal(ok.status, 200, "글 8000자(한글)는 상한 안");
});

test("기기가 올린 글은 저장 전에 비밀 꼴을 가림 — 표 · 세부 응답 어디에도 원문 없음(자료는 지어낸 값)", async () => {
  const { dev, me, D1 } = await setup();
  const FAKE = "ghp_" + "a1B2c3D4".repeat(5), KEY = "API_KEY=" + "zZ9yY8xX".repeat(4);
  const r = await dev("tok-a", "POST", "/api/device/taskboard", {
    tasks: [T("R1", { title: `제목 ${FAKE}`, quote: `원문 ${KEY}`, done: `끝 ${FAKE}`, next: `다음 ${FAKE}`, assignee: `담당 ${FAKE}`, logs: [`기록 ${FAKE}`], prs: [{ n: 1, title: `PR ${FAKE}` }] })],
    convo: [L("R1", "a", `대화 ${FAKE} 그리고 ${KEY}`, { who: `사람 ${FAKE}` })],
  });
  assert.equal(r.status, 200);
  const j = await (await me(A, "GET", "/api/me/taskboard/R1")).json(), raw = JSON.stringify(j);
  assert.ok(raw.includes("제목") && raw.includes("대화"), "가려도 글은 남음");
  assert.ok(!raw.includes(FAKE) && !raw.includes(KEY.slice(8)), raw.slice(0, 200));
  const t = await D1.prepare("SELECT * FROM task_board WHERE id = 'R1'").first(), c = await D1.prepare("SELECT * FROM task_board_convo WHERE task_id = 'R1'").first();
  assert.ok(!JSON.stringify([t, c]).includes(FAKE));
});

test("망가진 상태 값은 그 칸만 무시 — 올리기 전체가 500 이 안 됨 · 「.」 「..」 요청 id 는 버림", async () => {
  const { dev, me } = await setup();
  assert.equal(stateOf(["done"], "진행"), "working");
  assert.equal(stateOf("done", "진행"), "done");
  const r = await dev("tok-a", "POST", "/api/device/taskboard", { tasks: [T("R1", { state: ["done"] }), T("."), T(".."), T("R2")] });
  assert.equal(r.status, 200);
  const ids = (await (await me(A, "GET", "/api/me/taskboard")).json()).tasks.map((x: { id: string }) => x.id).sort();
  assert.deepEqual(ids, ["R1", "R2"]);
});

test("가림 빠짐 없음: 주소 · status · source · 제어 문자 낀 비밀, 열쇠(k)가 비밀 꼴이어도 줄이 안 합쳐짐, 큰 글도 금방 끝남", async () => {
  const { dev, me } = await setup();
  const FAKE = "ghp_" + "a1B2c3D4".repeat(5), split = "ghp_a1B2c3D4\u0001" + "a1B2c3D4".repeat(5);
  await dev("tok-a", "POST", "/api/device/taskboard", {
    tasks: [T("R1", { status: FAKE, quote: `원문 ${split}`, prs: [{ n: 1, url: `https://x.example/p?access_token=${FAKE}` }, { n: 2, url: "https://" + ["user", "hunter2secret"].join(":") + "@x.example/p" }, { n: 3, url: "https://x.example/p/3" }] })],
    convo: [L("R1", "rk-" + "1".repeat(24), `첫째 ${FAKE}`, { source: FAKE }), L("R1", "rk-" + "2".repeat(24), "둘째")],
  });
  const j = await (await me(A, "GET", "/api/me/taskboard/R1")).json(), raw = JSON.stringify(j);
  assert.equal(j.convo.length, 2, "다른 열쇠 두 줄은 두 줄");
  for (const bad of [FAKE, FAKE.slice(0, 20), "a1B2c3D4a1B2c3D4", "hunter2secret"]) assert.ok(!raw.includes(bad), bad);
  assert.deepEqual(j.task.prs.map((p: { url?: string }) => p.url), [undefined, undefined, "https://x.example/p/3"]);
  const K = "RSA PRIVATE " + "KEY-----", pem = "-----BEGIN " + K + "\n" + "QUJD".repeat(420) + "\n-----END " + K;   // 낱말 검사가 지어낸 키를 진짜로 읽지 않게 나눠 씀
  assert.ok(!JSON.stringify(cleanTask({ id: "R3", logs: [pem], quote: "가".repeat(3500) + pem }, Date.now())).includes("QUJDQUJD"), "상한보다 긴 개인 키도 가림");
  await dev("tok-a", "POST", "/api/device/taskboard", { convo: [L("R1", FAKE, "열쇠가 비밀 꼴")] });
  assert.ok(!JSON.stringify(await (await me(A, "GET", "/api/me/taskboard/R1")).json()).includes(FAKE), "열쇠도 응답에는 가려서");
  const t0 = Date.now(); assert.equal(cleanTask({ id: "R2", quote: "-----BEGIN A PRIVATE KEY-----".repeat(36000) }, t0)?.id, "R2");
  assert.ok(Date.now() - t0 < 2000, "큰 글을 통째로 가림에 넣지 않음");
});
