// node --test --no-warnings --experimental-transform-types apps/web/worker/member-inbox.test.ts (Node 22.18+ · node:sqlite)
// 보드 틀이 부르는 회원 길(반응 · 고치기 · 초안 · 읽지 않음 · 저장)의 계약 · 회원 경계 — 회원 A 는 자기 것만, 회원 B 것은 404 · 빈 답. 자료는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MI = await import("./member-inbox.ts");
const MB = await import("./member-board.ts");

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
const tsOf = (at: number, id: number) => `${Math.floor(at / 1000)}.${String(id % 1_000_000).padStart(6, "0")}`;
const MIG = new URL("../migrations/", import.meta.url);

function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(A, "n-a", "예시 팀 영업", "working", now, now);
  db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(A, "win:영업 창", "n-a");
  db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(B, "n-b", "남의 노드", "working", now, now);
  db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(B, "win:남의 창", "n-b");
  const log = (owner: string, win: string, text: string, at: number, kind = "progress", thread: string | null = null) => Number(db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(owner, win, kind, text, thread, at).lastInsertRowid);
  const card = (id: string, owner: string, win = "영업 창") => db.prepare("INSERT INTO board_card(id, owner, win, question, choices, at) VALUES (?,?,?,?,?,?)").run(id, owner, win, "자료 받기", '["가"]', now);
  const q = (sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])).map(r => ({ ...r }));
  return { db: d1(db) as unknown as D1Database, log, card, q, now };
}

test("반응: 내 글만, Slack 이름만, 다시 누르면(unreact) 뺌", async () => {
  const s = setup(); const mine = s.log(A, "영업 창", "에이전트 글", s.now - 3000), theirs = s.log(B, "남의 창", "남의 글", s.now - 2000);
  assert.equal((await MI.chatPost(s.db, A, { react: "white_check_mark", ts: tsOf(s.now - 2000, theirs) }))!.status, 404);
  assert.equal((await MI.chatPost(s.db, A, { react: "<b>", ts: tsOf(s.now - 3000, mine) }))!.status, 400);
  assert.equal((await MI.chatPost(s.db, A, { react: "white_check_mark", ts: tsOf(s.now - 3000, mine) }))!.status, 200);
  assert.deepEqual(s.q("SELECT log_id, emoji FROM member_react WHERE owner = ?", A), [{ log_id: mine, emoji: "white_check_mark" }]);
  await MI.chatPost(s.db, A, { react: "white_check_mark", unreact: true, ts: tsOf(s.now - 3000, mine) });
  assert.deepEqual(s.q("SELECT * FROM member_react"), []);
  assert.equal(await MI.chatPost(s.db, A, { text: "그냥 글" }), null);   // 여기 일이 아니면 원본 길로
});

test("고치기: 내가 쓴 글(kind me)만 — 에이전트 글 · 남의 글은 404", async () => {
  const s = setup(); const me = s.log(A, "예시 팀 영업", "처음", s.now - 3000, "me"), agent = s.log(A, "영업 창", "에이전트", s.now - 2500), other = s.log(B, "남의 노드", "남의", s.now - 2000, "me");
  assert.equal((await MI.chatPost(s.db, A, { edit: "바꿈", ts: tsOf(s.now - 2500, agent) }))!.status, 404);
  assert.equal((await MI.chatPost(s.db, A, { edit: "바꿈", ts: tsOf(s.now - 2000, other) }))!.status, 404);
  assert.equal((await MI.chatPost(s.db, A, { edit: "  ", ts: tsOf(s.now - 3000, me) }))!.status, 400);
  assert.equal((await MI.chatPost(s.db, A, { edit: "고친 글", ts: tsOf(s.now - 3000, me) }))!.status, 200);
  assert.deepEqual(s.q("SELECT text FROM board_log WHERE id IN (?,?) ORDER BY id", me, other).map(r => r.text), ["고친 글", "남의"]);
});

test("초안: 내 것만 보임, 빈 글은 지움, 4000자에서 자름", async () => {
  const s = setup();
  await MI.draftPost(s.db, A, { key: "chan:n:예시 팀 영업", text: "쓰던 글" });
  await MI.draftPost(s.db, A, { key: "th:1793400000.000001", text: "x".repeat(5000) });
  const m = await MI.draftMap(s.db, A);
  assert.equal(m["chan:n:예시 팀 영업"].text, "쓰던 글"); assert.equal(m["th:1793400000.000001"].text.length, 4000);
  assert.deepEqual(await MI.draftMap(s.db, B), {});
  await MI.draftPost(s.db, A, { key: "chan:n:예시 팀 영업", text: "" });
  assert.equal(Object.keys(await MI.draftMap(s.db, A)).length, 1);
  const ib = await MI.inbox(s.db, A); assert.equal(ib.drafts.length, 1); assert.equal(ib.drafts[0].thread, "1793400000.000001");
  assert.equal((await MI.draftPost(s.db, A, { key: "", text: "a" })).status, 400);
});

test("스레드 초안: 머리 글(내 글)의 채널을 붙임, 남의 글 ts 면 빈 채널", async () => {
  const s = setup(); const at = s.now - 5_000, mine = s.log(A, "영업 창", "머리 글", at), other = s.log(B, "남의 창", "남의 머리", at);
  await MI.draftPost(s.db, A, { key: "th:" + tsOf(at, mine), text: "답 쓰던 것" });
  await MI.draftPost(s.db, A, { key: "th:" + tsOf(at, other), text: "남의 스레드" });
  const ds = (await MI.inbox(s.db, A)).drafts, by = new Map(ds.map((d: { thread: string; chan: string }) => [d.thread, d.chan]));
  assert.equal(by.get(tsOf(at, mine)), "n:예시 팀 영업");
  assert.equal(by.get(tsOf(at, other)), "");
});

test("읽지 않음: 내 채널 에이전트 글 — 읽음(read) · 모두 읽음 뒤 0, 남의 글은 안 섞임", async () => {
  const s = setup(); const l1 = s.log(A, "영업 창", "자료 왔어요", s.now - 60_000); s.log(A, "영업 창", "확인 중", s.now - 30_000); s.log(B, "남의 창", "남의 글", s.now - 10_000);
  const ib = await MI.inbox(s.db, A);
  assert.equal(ib.unread.length, 2); assert.equal(ib.unread[0].chan, "n:예시 팀 영업"); assert.equal(ib.unread[1].ts, tsOf(s.now - 60_000, l1));
  await MI.inboxPost(s.db, A, { op: "read", items: [{ chan: "n:예시 팀 영업", ts: tsOf(s.now - 60_000, l1) }] });
  assert.equal((await MI.inbox(s.db, A)).unread.length, 1);   // 그 글까지만 읽음
  await MI.inboxPost(s.db, A, { op: "readall" });
  assert.equal((await MI.inbox(s.db, A)).unread.length, 0);
  assert.equal((await MI.inbox(s.db, B)).unread.length, 1);
});

test("저장: 내 글 · 내 카드만, 남의 것 404, 풀면 빠짐", async () => {
  const s = setup(); const mine = s.log(A, "영업 창", "저장할 글", s.now - 5000), theirs = s.log(B, "남의 창", "남의 글", s.now - 4000);
  s.card("1793400000.000001", A); s.card("1793400000.000002", B, "남의 창");
  assert.equal((await MI.inboxPost(s.db, A, { op: "save", ts: tsOf(s.now - 4000, theirs) })).status, 404);
  assert.equal((await MI.inboxPost(s.db, A, { op: "save", ts: "1793400000.000002" })).status, 404);
  assert.equal((await MI.inboxPost(s.db, A, { op: "save", ts: tsOf(s.now - 5000, mine) })).status, 200);
  assert.equal((await MI.inboxPost(s.db, A, { op: "save", ts: "1793400000.000001" })).status, 200);
  const ib = await MI.inbox(s.db, A);
  assert.deepEqual(ib.saved_ids.sort(), ["1793400000.000001", tsOf(s.now - 5000, mine)].sort());
  assert.equal(ib.saved.find(x => x.ts === "1793400000.000001")!.text, "자료 받기");
  assert.deepEqual((await MI.inbox(s.db, B)).saved, []);
  await MI.inboxPost(s.db, A, { op: "unsave", ts: tsOf(s.now - 5000, mine) });
  assert.deepEqual((await MI.inbox(s.db, A)).saved_ids, ["1793400000.000001"]);
});

test("고치기: 메인 봇 채팅에 내가 쓴 글(win 나)도 고침", async () => {
  const s = setup(); const mine = s.log(A, "나", "메인 봇에 쓴 글", s.now - 3000, "chat", "primary");
  assert.equal((await MI.chatPost(s.db, A, { edit: "고침", ts: tsOf(s.now - 3000, mine) }))!.status, 200);
  assert.deepEqual(s.q("SELECT text FROM board_log WHERE id = ?", mine), [{ text: "고침" }]);
});

test("반응이 노드 채팅 · 메인 봇 채팅 글에 틀 꼴로 보임(내 것만)", async () => {
  const s = setup(); const at = s.now - 3000, l = s.log(A, "영업 창", "에이전트 글", at), p = s.log(A, "메인 봇", "봇 글", at, "chat", "primary");
  await MI.chatPost(s.db, A, { react: "eyes", ts: tsOf(at, l) });
  await MI.chatPost(s.db, A, { react: "+1", ts: tsOf(at, p) });
  const get = async (me: string, path: string) => (await (await MB.get(s.db, me, { name: "메인 봇" }, new URL("https://b.example" + path), async () => null))!.json()) as any;
  const nc = await get(A, "/api/nodechat?w=" + encodeURIComponent("예시 팀 영업"));
  assert.deepEqual(nc.messages.find((m: any) => m.text === "에이전트 글").reactions, [{ name: "eyes", count: 1, mine: true }]);
  const pc = await get(A, "/api/chat/primary");
  assert.deepEqual(pc.messages.find((m: any) => m.text === "봇 글").reactions, [{ name: "+1", count: 1, mine: true }]);
});
