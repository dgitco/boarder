import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MI = await import("./member-inbox.ts");
const MP = await import("./member-push.ts");
const IR = await import("./inbox-rules.ts");

function d1(db: DatabaseSync) {
  const exec = (sql: string, args: unknown[]) => {
    const st = db.prepare(sql);
    if (/^\s*(select|with)/i.test(sql) || /\breturning\b/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } };
    const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } };
  };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  return { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) };
}
const A = "chief@example.com";
const CHIEF = "mini:%7", TECH = "pc:ew_tech01", WORKER = "pc:ew_work01", MONITOR = "mini:%9";
const MIG = new URL("../migrations/", import.meta.url);
const tsOf = (at: number, id: number) => `${Math.floor(at / 1000)}.${String(id % 1_000_000).padStart(6, "0")}`;

function setup({ seats = true } = {}) {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  const item = (key: string, win: string) => db.prepare("INSERT INTO imp_item(owner, key, kind, engine, state, state_at, win, seen_at) VALUES (?,?,?,?,?,?,?,?)").run(A, key, "window", "herdr-own", "idle", now, win, now);
  const node = (id: string, name: string, ...items: string[]) => { db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(A, id, name, "working", now, now); for (const i of items) db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)").run(A, i, id, "pin"); };
  item("window:chief", CHIEF); item("window:tech", TECH); item("window:work", WORKER); item("window:mon", MONITOR);
  node("tk_dept_tech", "기술장", "window:tech"); node("tk_6000", "#6000 보더 고침", "window:work"); node("n_mon", "운영 감시", "window:mon");
  const data = { primary_item: "window:chief", ...(seats ? { roles: [{ name: "비서실장", win: CHIEF, primary: true }, { name: "기술장", win: TECH, node: "tk_dept_tech" }] } : {}) };
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify(data), now);
  let t = now - 60_000;
  const log = (win: string, kind: string, text: string, thread: string | null = null, wid: string | null = null, when?: number) => { const at = when ?? ++t; const id = Number(db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").run(A, win, kind, text, thread, at, wid).lastInsertRowid); return tsOf(at, id); };
  const card = (id: string, win: string, answer: string | null = null) => db.prepare("INSERT INTO board_card(id, owner, win, question, choices, state, answer, at) VALUES (?,?,?,?,?,?,?,?)").run(id, A, win, "고를까요", '["가"]', answer ? "answered" : "open", answer, now);
  return { db: d1(db) as unknown as D1Database, log, card };
}
const texts = async (db: D1Database) => (await MI.inbox(db, A)).unread.map((x: any) => x.text).sort();

test("판정(I/O 없음): 비서실장 창 이상은 기계 줄이어도 뜸, 상태 · 작업 기록 · 역할 초안 줄은 자리표 창이어도 안 뜸, 그 밖 창은 내 글에 단 답만", () => {
  const chief = IR.chiefOf([{ name: "비서실장", win: "pc:ew_chief9", primary: true }, { name: "기술장", win: TECH }])!;
  assert.deepEqual(chief, { name: "비서실장", win: "pc:ew_chief9", wid: "ew_chief9" });
  assert.equal(IR.shows({ win: "보더", kind: "sys", text: "x", wid: "ew_chief9" }, null, chief), true, "그 창 id 의 시스템 줄");
  assert.equal(IR.shows({ win: "보더", kind: "sys", text: "「기술장」 창을 주차했어요", wid: "ew_tech01" }, null, chief), false, "다른 창 시스템 줄");
  assert.equal(IR.shows({ win: MONITOR, kind: "incident", text: "비서실장 창 계정 한도 — 멈춤" }, null, chief), true, "감시 창이 알린 비서실장 창 이상");
  assert.equal(IR.shows({ win: MONITOR, kind: "progress", text: "비서실장 창 계정 한도" }, null, chief), false, "진행 줄은 이상 알림 아님");
  assert.equal(IR.shows({ win: WORKER, kind: "blocked", text: "비서실장 답 기다림" }, null, chief), false, "「비서실장」 낱말만으론 이상 아님");
  assert.equal(IR.shows({ win: TECH, kind: "say", text: "끝났어요" }, "dept", chief), true);
  assert.equal(IR.shows({ win: TECH, kind: "progress", text: "진행" }, "dept", chief), false);
  assert.equal(IR.shows({ win: CHIEF, kind: "role", text: "rd_x" }, "chief", chief), false);
  assert.equal(IR.shows({ win: WORKER, kind: "reply", text: "답" }, null, chief), false);
  assert.equal(IR.shows({ win: WORKER, kind: "say", text: "답" }, null, chief, true), true, "내 글에 온 답은 누가 답했든");
});

test("읽지 않음(자리표 있음): 비서실장 채팅 · 비서실장 보고 · 부서장 글 · 내 글에 온 작업자 답 · 비서실장 창 이상 = 뜸 / 작업자 · 감시 · 기계 · 상태 줄 = 안 뜸", async () => {
  const s = setup();
  // 뜸
  s.log(CHIEF, "chat", "비서실장 채팅 새 글", "primary");
  s.log(CHIEF, "blocked", "비서실장 보고 — 팀장 결정 필요");
  s.log(TECH, "say", "기술장 글 — PR 올렸어요");
  s.log(TECH, "decision", "기술장 결정 줄");
  const mine = s.log("기술장", "me", "내가 기술장 채널에 쓴 글");
  s.log(WORKER, "say", "작업자가 내 글에 단 답", mine);
  s.log(WORKER, "reply", "작업자 턴 답 — 보드에서 그 창에 넣은 내 글의 답");
  s.card("1793000000.000111", WORKER, "가"); s.log(WORKER, "say", "작업자가 내가 답한 카드에 단 답", "1793000000.000111");
  s.log("보더", "sys", "「비서실장」 보드 글 1개가 10분 넘게 이 창이 쉬기를 기다려요", "primary", null);
  s.log(MONITOR, "incident", "비서실장 창 멈춤 — 계정 한도");
  // 안 뜸
  s.log(WORKER, "blocked", "작업자 막힘 — 기술장에게");
  s.log(MONITOR, "incident", "기술장 창 계정 한도");
  s.log("보더", "sys", "「작업자」 창을 주차했어요 — 채팅으로 말하면 다시 열려요", "primary", "ew_work01");
  s.log("pc:boarder", "progress", "기기 줄");
  s.log(TECH, "progress", "기술장 진행 기록"); s.log(CHIEF, "status", "비서실장 상태 줄");
  const agentPost = s.log(WORKER, "say", "작업자 노드 글");
  s.log(MONITOR, "say", "감시 창이 작업자 글에 단 답", agentPost);
  s.card("1793000000.000222", WORKER); s.log(WORKER, "say", "작업자가 안 답한 카드에 단 답", "1793000000.000222");
  assert.deepEqual(await texts(s.db), [
    "「비서실장」 보드 글 1개가 10분 넘게 이 창이 쉬기를 기다려요", "기술장 결정 줄", "기술장 글 — PR 올렸어요", "비서실장 보고 — 팀장 결정 필요", "비서실장 창 멈춤 — 계정 한도", "비서실장 채팅 새 글",
    "작업자 턴 답 — 보드에서 그 창에 넣은 내 글의 답", "작업자가 내 글에 단 답", "작업자가 내가 답한 카드에 단 답",
  ].sort());
});

test("읽지 않음(자리표 있음): 비서실장 채팅 글 — 읽음 · 모두 읽음 · 내가 그 뒤에 쓴 글이면 빠짐", async () => {
  const s = setup(), a = s.log(CHIEF, "chat", "첫째", "primary");
  const it = (await MI.inbox(s.db, A)).unread.find((x: any) => x.ts === a)!;
  assert.equal(it.chan, "primary");
  assert.equal((await MI.inboxPost(s.db, A, { op: "read", items: [{ ts: a, chan: "primary" }] })).status, 200);
  assert.deepEqual(await texts(s.db), []);
  s.log(CHIEF, "chat", "둘째", "primary"); assert.deepEqual(await texts(s.db), ["둘째"]);
  await MI.inboxPost(s.db, A, { op: "readall" }); assert.deepEqual(await texts(s.db), []);
  s.log(CHIEF, "chat", "셋째", "primary"); s.log("나", "chat", "내 답", "primary");
  assert.deepEqual(await texts(s.db), [], "내가 그 뒤에 Primary 에 썼으면 읽은 것");
});

test("읽지 않음(자리표 있음): 남의 노드 글에 내가 단 답글 → 모두 읽음 → 다시 온 작업자 답은 뜸(내 줄이 바닥보다 옛것이어도), 내가 안 낀 스레드 답은 안 뜸", async () => {
  const s = setup();
  const root = s.log(WORKER, "say", "작업자 노드 글");
  s.log("나", "me", "내가 그 스레드에 단 답글", root);
  const other = s.log(WORKER, "say", "작업자 다른 글");
  await MI.inboxPost(s.db, A, { op: "readall" });
  await new Promise(r => setTimeout(r, 5));
  s.log(WORKER, "say", "작업자가 다시 단 답", root, null, Date.now() + 10);
  s.log(MONITOR, "say", "감시 창이 다른 글에 단 답", other, null, Date.now() + 20);
  assert.deepEqual(await texts(s.db), ["작업자가 다시 단 답"]);
});

test("폰 알림(자리표 있음): 줄마다 보드 한 판을 다시 읽지 않음 — 60초 안 같은 회원은 한 번(D1 batch 1번)", async () => {
  const s = setup(); let n = 0; const b0 = (s.db as any).batch; (s.db as any).batch = (x: any) => { n++; return b0(x); };
  const L = (win: string, kind: string, text: string) => ({ id: 1, tool: "inbox_log" as const, kind, text, thread: null, win });
  for (let i = 0; i < 5; i++) await MP.lineWhy(s.db, A, L(TECH, "say", "글 " + i));
  assert.equal(n, 1);
  assert.equal((await MP.lineWhy(s.db, A, L(WORKER, "progress", "작업자 진행"))).why, "none");
  assert.equal(n, 1);
});

test("자리표 없는 사람은 예전 그대로: 작업자 · 감시 글도 뜨고, 비서실장(메인 봇) 채팅 글은 안 뜸", async () => {
  const s = setup({ seats: false });
  s.log(CHIEF, "chat", "메인 봇 채팅", "primary");
  s.log(WORKER, "blocked", "작업자 막힘");
  s.log(MONITOR, "incident", "감시 장애");
  s.log(WORKER, "progress", "진행");
  assert.deepEqual(await texts(s.db), ["감시 장애", "작업자 막힘"]);
});

test("폰 알림(자리표 있음): 부서장 글 = 「새 글」 바로 · 내 글 답 = 답 · 비서실장 창 이상 = 부름 · 부서장 진행 = 묶음 · 작업자 · 감시 글 = 안 감", async () => {
  const s = setup();
  const L = (win: string, kind: string, text: string, thread: string | null = null, unblocks?: string) => ({ id: 1, tool: "inbox_log" as const, kind, text, thread, win, unblocks });
  const why = async (l: any) => { const w = await MP.lineWhy(s.db, A, l); return [w.why, !!w.fresh]; };
  assert.deepEqual(await why({ ...L(TECH, "say", "PR 올렸어요"), tool: "inbox_say" }), ["reply", true]);
  assert.deepEqual(await why(L(CHIEF, "blocked", "결정 필요", null, "me")), ["call", false]);
  assert.deepEqual(await why(L(MONITOR, "incident", "비서실장 창 멈춤")), ["call", false]);
  assert.deepEqual(await why(L(TECH, "progress", "진행 기록")), ["progress", false]);
  assert.deepEqual(await why(L(WORKER, "reply", "턴 답")), ["reply", false], "보드에서 넣은 내 글에 대한 턴 답");
  const mine = s.log("기술장", "me", "내 글");
  assert.deepEqual(await why({ ...L(WORKER, "say", "답", mine), tool: "inbox_say" }), ["reply", false]);
  assert.deepEqual(await why(L(WORKER, "blocked", "기술장 답 기다림", null, "me")), ["none", false], "작업자가 나를 불러도 부서장을 거침");
  assert.deepEqual(await why(L(MONITOR, "incident", "기술장 창 한도")), ["none", false]);
  assert.deepEqual(await why(L(WORKER, "progress", "작업자 진행")), ["none", false]);
  const m = MP.lineMsg({ ...L(TECH, "say", "PR 올렸어요"), id: 9 } as any, "reply", false, true);
  assert.equal(m.title, "새 글이 왔어요");
});
