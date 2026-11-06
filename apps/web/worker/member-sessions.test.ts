import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MB = await import("./member-board.ts");

function d1(db: DatabaseSync) {
  const exec = (sql: string, args: unknown[]) => {
    const st = db.prepare(sql);
    if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } };
    const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } };
  };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  return { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) };
}
const A = "a@example.com", B = "b@example.com";
const MIG = new URL("../migrations/", import.meta.url);

function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  const node = (owner: string, id: string, name: string, key: string, cwd: string) => {
    db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(owner, id, name, "working", now, now);
    db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(owner, key, "dev-" + owner, "window", "herdr-own", name, cwd, "working", now, key.slice(7), now);
    db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(owner, key, id);
  };
  node(A, "n-a", "예시 영업 창", "window:host-a:herdr:w1:p1", "/home/a/work/sales");
  node(B, "n-b", "남의 창", "window:host-b:herdr:w9:p9", "/home/b/secret");
  const ew = (owner: string, id: string, kind: string, name: string) => db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?)").run(id, owner, "dev-" + owner, kind, name, "idle", now, now);
  ew(A, "ew_amain000001", "main", "메인 봇");
  ew(A, "ew_arole000001", "role", "예시 정리 창");
  ew(B, "ew_brole000001", "role", "남의 역할 창");
  const log = (owner: string, win: string, kind: string, text: string, thread: string | null, at: number) => db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(owner, win, kind, text, thread, at);
  log(A, "나", "me", "A 가 메인 봇에게", "primary", now - 3000);
  log(A, "메인 봇", "say", "메인 봇 답", "primary", now - 2000);
  log(B, "나", "me", "B 의 비밀 글", "primary", now - 1000);
  log(A, "host-a:herdr:w1:p1", "progress", "영업 창 진행", null, now - 1500);
  log(A, "예시 정리 창", "progress", "정리 창 진행", null, now - 1400);
  log(B, "남의 역할 창", "progress", "남의 역할 진행", null, now - 1300);
  return { db: d1(db) as unknown as D1Database };
}
const PRIMARY = "%1", paneA = MB.paneOfId("n-a"), paneB = MB.paneOfId("n-b"), engA = MB.paneOfId("ew_arole000001"), engB = MB.paneOfId("ew_brole000001");
const url = (p: string) => new URL("https://board.example" + p);
const get = async (db: D1Database, me: string, p: string) => { const r = await MB.get(db, me, { name: "메인 봇" }, url(p), async () => null); return r ? { status: r.status, body: await r.json() as any } : null; };

test("세션 로그: 메인 봇 판(%1)은 내 Primary 글만(사람 · 봇), 남의 글은 안 섞임", async () => {
  const { db } = setup();
  const r = await get(db, A, "/api/sesslog?pane=" + encodeURIComponent(PRIMARY));
  assert.equal(r!.status, 200);
  assert.equal(r!.body.pane, PRIMARY);
  assert.deepEqual([r!.body.channel, r!.body.live, r!.body.stale_min, r!.body.more], ["s:" + PRIMARY, true, 0, false], "주인 sess_log 와 같은 칸");
  assert.deepEqual(r!.body.messages.map((m: any) => [m.who, m.text]), [["owner", "A 가 메인 봇에게"], ["agent", "메인 봇 답"]]);
});

test("세션 로그: 내 노드 · 내 엔진 창은 그 창 글만, 남의 판 · 모르는 판 · 꼴이 틀린 판은 404", async () => {
  const { db } = setup();
  const n = await get(db, A, "/api/sesslog?pane=" + encodeURIComponent(paneA));
  assert.equal(n!.status, 200); assert.deepEqual(n!.body.messages.map((m: any) => m.text), ["영업 창 진행"]);
  const e = await get(db, A, "/api/sesslog?pane=" + encodeURIComponent(engA));
  assert.equal(e!.status, 200); assert.deepEqual(e!.body.messages.map((m: any) => m.text), ["정리 창 진행"]);
  for (const p of [paneB, engB, "%42", "n-b", ""]) {
    const r = await get(db, A, "/api/sesslog?pane=" + encodeURIComponent(p));
    assert.equal(r!.status, 404, p); assert.equal(r!.body.messages, undefined);
  }
});

test("폴더 목록: 내 기기가 들여온 폴더만", async () => {
  const { db } = setup();
  const r = await get(db, A, "/api/session/folders");
  assert.equal(r!.status, 200);
  assert.deepEqual(r!.body.folders, [{ path: "/home/a/work/sales", title: "sales" }]);
});

test("세션에 글: %1 → 메인 봇 길, 내 노드 → 그 창 명령, 내 엔진 창 → windows/:id/say, 남의 판은 404 · 빈 글은 400", async () => {
  const { db } = setup();
  assert.deepEqual(await MB.post(db, A, "/api/sess/send", { pane: PRIMARY, text: "안녕" }), { path: "/api/me/chat", body: { text: "안녕" } });
  const n = await MB.post(db, A, "/api/sess/send", { pane: paneA, text: "영업 창에" }) as any;
  assert.equal(n.path, "/api/me/nodes/cmd"); assert.equal(n.body.item, "window:host-a:herdr:w1:p1"); assert.ok(String(n.body.text).endsWith("영업 창에"), n.body.text);   // 앞에 보드 머리 줄([보드 · …])이 붙음(보드 글 머리 줄 커밋)
  const e = await MB.post(db, A, "/api/sess/send", { pane: engA, text: "정리 창에" }) as any;
  assert.equal(e.path, "/api/me/windows/ew_arole000001/say");
  for (const p of [paneB, engB, "%42"]) assert.deepEqual(await MB.post(db, A, "/api/sess/send", { pane: p, text: "넣기" }), { error: "없는 판", status: 404 }, p);
  assert.equal((await MB.post(db, A, "/api/sess/send", { pane: PRIMARY, text: "  " }) as any).status, 400);
});

test("새 대화: 내 폴더만 열기 길로, 남의 폴더 · 아무 경로 · 「..」는 404", async () => {
  const { db } = setup();
  assert.deepEqual(await MB.post(db, A, "/api/session/new", { folder: "/home/a/work/sales", text: "시작" }), { path: "/api/me/session/new", body: { folder: "/home/a/work/sales", text: "시작" } });
  for (const f of ["/home/b/secret", "/etc", "/home/a/work/sales/../../b/secret", ""]) assert.deepEqual(await MB.post(db, A, "/api/session/new", { folder: f, text: "x" }), { error: "없는 폴더", status: 404 }, f);
  assert.equal(await MB.folderOk(db, A, "/home/b/secret"), false);
  assert.equal(await MB.folderOk(db, B, "/home/b/secret"), true);
});

test("세션 로그 live(주인 sess_log 꼴): 살아 있는 노드 · 엔진 창은 참, 주차 노드 · 닫힌 엔진 창은 거짓", async () => {
  const { db } = setup();
  const live = async (p: string) => (await get(db, A, "/api/sesslog?pane=" + encodeURIComponent(p)))!.body.live;
  assert.equal(await live(paneA), true);
  assert.equal(await live(engA), true);
  await db.prepare("UPDATE mnode SET state = 'parked' WHERE id = 'n-a'").run();
  await db.prepare("UPDATE engine_window SET state = 'closed', closed_at = ? WHERE id = 'ew_arole000001'").bind(Date.now()).run();
  assert.equal(await live(paneA), false, "주차 노드");
  assert.equal(await live(engA), false, "닫힌 엔진 창");
});

function harnessSetup() {
  const s = setup(), now = Date.now(), db = s.db as any;
  const hw = (owner: string, id: string, name: string, state: string, meta: object) => db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, handle, created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, owner, "devH", "harness", name, state, now, JSON.stringify(meta), now).run();
  return { ...s, hw, now };
}
test("하네스 판 세션: 켠 주인은 판(%N)에 글 = 하네스 보내기 길, 주차 판도 · 닫힌 판 · 회원(하네스 열쇠 아님)은 404 — 통화 쪽 판정(옵션 없음)은 그대로", async () => {
  const { db, hw } = harnessSetup();
  await hw(A, "ew_pane40", "지어낸 일", "busy", { pane: "%40", win: "5 지어낸 일", role: "리드" });
  await hw(A, "ew_pane41", "주차한 일", "parked", { pane: "%41", win: "6 주차한 일", role: "리드" });
  await hw(A, "ew_pane42", "닫힌 일", "closed", { pane: "%42", win: "7 닫힌 일" });
  try {
    MB.setHarnessKey(A);
    assert.deepEqual(await MB.post(db, A, "/api/sess/send", { pane: "%40", text: "판에 바로" }), { path: "/api/me/harness/send", body: { pane: "%40", text: "판에 바로" } });
    assert.deepEqual(await MB.post(db, A, "/api/sess/send", { pane: "%41", text: "주차 판에" }), { path: "/api/me/harness/send", body: { pane: "%41", text: "주차 판에" } }, "주차 판은 어댑터 send 가 다시 열며 넣음");
    assert.deepEqual(await MB.post(db, A, "/api/sess/send", { pane: "%42", text: "닫힌 판" }), { error: "없는 판", status: 404 });
    assert.equal((await MB.post(db, A, "/api/sess/send", { pane: "%40", text: "  " }) as any).status, 400);
    const t = await MB.sessTarget(db, A, "%40", { harness: true });
    assert.deepEqual([t?.kind, t?.name, t?.state], ["harness", "5 지어낸 일", "busy"]);
    assert.equal(await MB.sessTarget(db, A, "%40"), null, "옵션 없이(통화 member-voice)는 예전처럼 모르는 판");
    assert.deepEqual(await MB.post(db, B, "/api/sess/send", { pane: "%40", text: "남의 판" }), { error: "없는 판", status: 404 });
    MB.setHarnessKey(""); MB.loadForget(A);
    assert.deepEqual(await MB.post(db, A, "/api/sess/send", { pane: "%40", text: "꺼짐" }), { error: "없는 판", status: 404 });
  } finally { MB.setHarnessKey(""); MB.loadForget(A); }
});
test("하네스 판 세션 기록(sesslog): 엔진 log 를 거치지 않은 보통 길(memberBoard.get)은 404(틀은 빈 대화) — index.ts 가 sessLogHarness 를 먼저 부름", async () => {
  const { db, hw } = harnessSetup();
  await hw(A, "ew_pane40", "지어낸 일", "idle", { pane: "%40", win: "5 지어낸 일" });
  try {
    MB.setHarnessKey(A);
    assert.equal((await get(db, A, "/api/sesslog?pane=" + encodeURIComponent("%40")))!.status, 404);
    assert.equal((await get(db, A, "/api/sesslog?pane=" + encodeURIComponent(engA)))!.status, 200, "엔진 창 기록은 그대로");
  } finally { MB.setHarnessKey(""); MB.loadForget(A); }
});
test("하네스 판 최근 줄(/api/pane/%N): 주인 server.py pane_rows 와 같게 장부 사본(wl_log)의 그 판 줄 + 보드가 그 판에 넣은 Owner 글(머리 뗌) · 이틀 안 · 오래된 것부터 — 회원 · 꺼짐은 빈 목록", async () => {
  const { db, hw, now } = harnessSetup(), s = now / 1000;
  await hw(A, "ew_pane40", "지어낸 일", "idle", { pane: "%40", win: "5 지어낸 일" });
  const wl = (id: number, at: number, pane: string, kind: string, msg: string, ref: string | null = null) => db.prepare("INSERT INTO wl_log(id, at, pane, win, kind, msg, ref) VALUES (?,?,?,?,?,?,?)").bind(id, at, pane, "5 지어낸 일", kind, msg, ref).run();
  await wl(1, s - 3 * 86400, "%40", "진행", "사흘 전 줄");
  await wl(2, s - 300, "%40", "시작", "일을 시작");
  await wl(3, s - 200, "owner", "Owner", "보드 → %40: 이것도 해 줘");
  await wl(4, s - 150, "owner", "Owner", "보드 → %41: 다른 판 글");
  await wl(5, s - 100, "%41", "진행", "다른 판 줄");
  await wl(6, s - 50, "%40", "진행", "반쯤 함 — 보드 → %40: 글 안 머리는 그대로", "ref-1");
  const rows = async (me: string) => (await get(db, me, "/api/pane/" + encodeURIComponent("%40")))!.body;
  try {
    MB.setHarnessKey(A);
    const r = await rows(A);
    assert.equal(r.pane, "%40");
    assert.deepEqual(r.rows.map((x: any) => [x.id, x.kind, x.msg, x.owner]), [[2, "시작", "일을 시작", false], [3, "Owner", "이것도 해 줘", true], [6, "진행", "반쯤 함 — 보드 → %40: 글 안 머리는 그대로", false]]);
    assert.equal(r.rows[2].ref, "ref-1"); assert.equal(r.rows[0].at, s - 300, "at 은 초(틀 loadPane 꼴)");
    assert.deepEqual((await rows(B)).rows, [], "회원 B — 남의 하네스 판 줄은 안 읽음");
    MB.setHarnessKey(""); MB.loadForget(A);
    assert.deepEqual((await rows(A)).rows, [], "하네스 열쇠가 꺼지면(끈 주인 · 회원) 예전처럼 빈 목록");
  } finally { MB.setHarnessKey(""); MB.loadForget(A); }
});

test("하네스 판 세션 기록(sessLogHarness): 엔진 log 기록을 server.py sess_log 꼴로 · 이름은 화면 값(다듬음) 없으면 판 이름 · 못 읽으면 404 · 하네스 판이 아니면 null(보통 길)", async () => {
  const { db, hw } = harnessSetup();
  await hw(A, "ew_pane40", "지어낸 일", "busy", { pane: "%40", win: "5 지어낸 일" });
  const asked: [string, string][] = [];
  const rec = { messages: [{ ts: "1.000001", who: "owner", text: "배포 봐 줘" }], kind: "claude", live: true };
  const read = (r: typeof rec | null) => async (p: string, n: string) => { asked.push([p, n]); return r; };
  try {
    MB.setHarnessKey(A);
    const ok = await MB.sessLogHarness(db, A, "%40", " 5\t지어낸   일 ", read(rec));
    assert.deepEqual(ok, { status: 200, body: { pane: "%40", name: "5 지어낸 일", state: "busy", messages: rec.messages, channel: "s:%40", kind: "claude", live: true, stale_min: 0, more: false } });
    assert.deepEqual(asked.at(-1), ["%40", "5 지어낸 일"]);
    await MB.sessLogHarness(db, A, "%40", "", read(rec)); assert.deepEqual(asked.at(-1), ["%40", "5 지어낸 일"], "화면 이름이 없으면 판 이름(handle win)");
    assert.deepEqual(await MB.sessLogHarness(db, A, "%40", "", read(null)), { status: 404, body: { error: "세션 기록이 없어요" } }, "옛 엔진 · 꺼짐 · 기록 없음 = 지금처럼 404(빈 대화)");
    const n = asked.length;
    for (const p of [PRIMARY, paneA, engA, "%99", "x"]) assert.equal(await MB.sessLogHarness(db, A, p, "", read(rec)), null, p);
    assert.equal(await MB.sessLogHarness(db, B, "%40", "", read(rec)), null, "회원 B");
    MB.setHarnessKey(""); MB.loadForget(A);
    assert.equal(await MB.sessLogHarness(db, A, "%40", "", read(rec)), null, "하네스 열쇠가 꺼지면(끈 주인 · 회원) 보통 길");
    assert.equal(asked.length, n, "하네스 판이 아니면 엔진을 안 부름");
  } finally { MB.setHarnessKey(""); MB.loadForget(A); }
});
