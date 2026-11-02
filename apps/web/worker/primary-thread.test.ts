import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MB = await import("./member-board.ts");
const { localTools } = await import("./local.ts");
const { run } = await import("./mcp/tools.ts");
const { boardHead } = await import("./board-head.ts");

const A = "a@example.com", B = "b@example.com";
const MIG = new URL("../migrations/", import.meta.url);
const NODE = "예시 팀장 노드", WIN = "팀장 창";
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  for (const o of [A, B]) {   // 기본 창(팀장 창)이 노드에 묶여 있어도 Primary 스레드 답은 그 노드 채널로 새지 않아야 함
    db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(o, "n-a", NODE, "working", now, now);
    db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(o, "win:" + WIN, "n-a");
  }
  const exec = (sql: string, args: unknown[]) => { const st = db.prepare(sql); if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } }; const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) } as unknown as D1Database;
  const line = (owner: string, win: string, kind: string, text: string, thread: string | null = null, at = Date.now() - 60_000) => {
    const r = db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(owner, win, kind, text, thread, at);
    return `${Math.floor(at / 1000)}.${String(Number(r.lastInsertRowid) % 1_000_000).padStart(6, "0")}`;
  };
  return { db, D1, line };
}
const get = async (D1: D1Database, me: string, path: string) => (await (await MB.get(D1, me, { name: "메인 봇" }, new URL("https://x" + path), async () => null) as Response).json()) as any;

test("chat_say thread = 내 Primary 글 → 그 글 스레드 답: 목록엔 뿌리에 답 수 · 마지막 답, 스레드엔 뿌리 → 답(시각 순), 노드 채널엔 안 나옴", async () => {
  const { db, D1, line } = setup();
  const root = line(A, "나", "chat", "내일 회의 정리해 줘", "primary", Date.now() - 120_000);
  line(A, "메인 봇", "say", "예전 답(새 줄)", "primary", Date.now() - 110_000);
  const tools = localTools(D1, A, WIN, "https://example.invalid");
  assert.deepEqual(await tools("chat_say", { text: "정리했어요", thread: root }), { ok: true });
  assert.deepEqual(await tools("chat_say", { text: "하나 더 — 안건 셋", thread: root }), { ok: true });
  assert.deepEqual(db.prepare("SELECT text, thread FROM board_log WHERE owner = ? AND kind = 'say' AND thread != 'primary' ORDER BY id").all(A).map(r => ({ ...r })),
    [{ text: "정리했어요", thread: "p:" + root }, { text: "하나 더 — 안건 셋", thread: "p:" + root }]);
  const list = await get(D1, A, "/api/chat/primary");
  assert.deepEqual(list.messages.map((m: any) => m.text), ["내일 회의 정리해 줘", "예전 답(새 줄)"], "답은 목록 맨 바깥에 없음");
  const r = list.messages[0];
  assert.equal(r.ts, root); assert.equal(r.replies, 2); assert.ok(r.latest > root); assert.deepEqual(r.rnames, ["메인 봇"]);
  const th = await get(D1, A, `/api/chat/primary/${root}`);
  assert.deepEqual(th.messages.map((m: any) => [m.who, m.text, m.thread]), [["owner", "내일 회의 정리해 줘", null], ["agent", "정리했어요", root], ["agent", "하나 더 — 안건 셋", root]]);
  // 기본 창(팀장 창)이 노드에 묶여 있어도 노드 채팅 · 소식에 안 섞임
  const nc = await get(D1, A, "/api/nodechat?w=" + encodeURIComponent(NODE));
  assert.ok(!nc.messages.some((m: any) => /정리했어요|안건 셋/.test(m.text)), "노드 채널에 안 나옴");
  assert.ok(!(await MB.data(D1, A, { name: "메인 봇" })).feed.some((f: any) => /정리했어요/.test(f.msg)), "소식에 안 나옴");
  // B 는 A 의 스레드를 못 봄
  assert.deepEqual((await get(D1, B, `/api/chat/primary/${root}`)).messages, []);
});

test("chat_say thread 권한 경계: 남의 Primary 글 · 봇 글 · 스레드 답 줄 · 없는 ts · 꼴이 틀린 id 는 거절, 아무것도 안 남음", async () => {
  const { db, D1, line } = setup();
  const mine = line(A, "나", "chat", "내 글", "primary");
  const others = line(B, "나", "chat", "B 의 글", "primary");
  const bot = line(A, "메인 봇", "say", "봇 글", "primary");
  const reply = line(A, "나", "chat", "스레드에 더 쓴 글", "p:" + mine);
  const node = line(A, WIN, "progress", "노드 글");
  const tools = localTools(D1, A, WIN, "https://example.invalid");
  const before = (db.prepare("SELECT COUNT(*) n FROM board_log").get() as any).n;
  for (const t of [others, bot, reply, node, "1793000000.000999"]) await assert.rejects(tools("chat_say", { text: "x", thread: t }), /없는 스레드/, t);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM board_log").get() as any).n, before);
  // 도구 입력 검사: thread 꼴(초.여섯 자리)이 아니면 들어가지도 않음
  const ctx = { agent: "t", publicUrl: "https://example.invalid", view: { visible: () => true, why: () => null, desc: () => "", mask: () => false }, get: async () => ({}), op: async () => ({}), local: tools };
  await assert.rejects(run(ctx as never, "chat_say", { text: "x", thread: "p:" + mine }), /입력이 맞지 않음/);
  // thread 없으면 예전처럼 Primary 새 줄
  assert.deepEqual(await run(ctx as never, "chat_say", { text: "새 줄 답" }), { ok: true });
  assert.equal((db.prepare("SELECT thread FROM board_log WHERE text = ?").get("새 줄 답") as any).thread, "primary");
});

test("사람이 그 스레드에 더 쓴 글(POST /api/chat thread) → /api/me/chat { text, thread } · 내 글이 아닌 뿌리는 예전처럼 새 줄 · 머리 줄 꼴", async () => {
  const { D1, line } = setup();
  const mine = line(A, "나", "chat", "내 글", "primary"), bot = line(A, "메인 봇", "say", "봇 글", "primary"), others = line(B, "나", "chat", "B 의 글", "primary");
  assert.deepEqual(await MB.post(D1, A, "/api/chat", { thread: mine, text: "하나 더" }), { path: "/api/me/chat", body: { text: "하나 더", thread: mine } });
  assert.deepEqual(await MB.post(D1, A, "/api/chat", { pane: "%1", thread: mine, text: "하나 더" }), { path: "/api/me/chat", body: { text: "하나 더", thread: mine } });
  for (const t of [bot, others]) assert.deepEqual(await MB.post(D1, A, "/api/chat", { thread: t, text: "답" }), { path: "/api/me/chat", body: { text: "답" } }, t);
  assert.deepEqual(await MB.post(D1, A, "/api/chat", { text: "새 글" }), { path: "/api/me/chat", body: { text: "새 글" } });
  // /api/me/chat 이 남의 뿌리를 거절하는 검사 · 머리 줄에 쓰는 내 글 ts
  assert.equal(await MB.primaryRoot(D1, B, mine), null);
  assert.ok(await MB.primaryRoot(D1, A, mine));
  assert.equal(await MB.myPrimaryTs(D1, A, "내 글"), mine);
  const r2 = line(A, "나", "chat", "하나 더", "p:" + mine);
  assert.equal(await MB.myPrimaryTs(D1, A, "하나 더", mine), r2);
  assert.equal(await MB.myPrimaryTs(D1, B, "내 글"), null);
  assert.equal(boardHead({ thread: mine }), `[보드 · Primary · 스레드 ${mine}]`);
  const list = await get(D1, A, "/api/chat/primary");
  const root = list.messages.find((m: any) => m.ts === mine);
  assert.equal(root.replies, 1); assert.deepEqual(root.rnames, ["a"]);
  assert.ok(!list.messages.some((m: any) => m.ts === r2));
});
