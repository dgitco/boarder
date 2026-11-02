import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MB = await import("./member-board.ts");
const { localTools } = await import("./local.ts");
const { run } = await import("./mcp/tools.ts");
const A = "a@example.com", B = "b@example.com";
const MIG = new URL("../migrations/", import.meta.url);
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  const node = (o: string, id: string, name: string, state: string, archived: number | null = null) => db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at, archived_at) VALUES (?,?,?,?,?,?,?)").run(o, id, name, state, now, now, archived);
  node(A, "n-1", "매출 보고", "working"); node(A, "n-2", "자료 정리", "working"); node(A, "n-3", "옛 일", "done", now - 3600_000);
  node(B, "n-9", "남의 일", "working");
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, created_at) VALUES (?,?,?,?,?,?,?)").run("ew_mail01", A, "d1", "role", "메일 비서", "idle", now);
  const say = (o: string, win: string, text: string, at: number) => Number(db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?) RETURNING id").get(o, win, win === "나" ? "chat" : "say", text, "primary", at)!.id);
  const rid = say(A, "나", "매출 보고 자료 모아 주고, 메일함에 온 견적 답장도 써 줘", now - 60_000);
  const bot = say(A, "모찌", "네, 나눠서 할게요", now - 50_000);
  const bid = say(B, "나", "남의 글", now - 40_000);
  const exec = (sql: string, args: unknown[]) => { const st = db.prepare(sql); if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } }; const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) } as unknown as D1Database;
  return { db, D1, root: MB.tsOf(now - 60_000, rid), botTs: MB.tsOf(now - 50_000, bot), bRoot: MB.tsOf(now - 40_000, bid) };
}
const get = async (D1: D1Database, me: string, path: string) => (await (await MB.get(D1, me, { name: "모찌" }, new URL("https://x" + path), async () => null, undefined, "김") as Response).json()) as any;
const PARTS = [{ node: "매출 보고", text: "매출 보고 자료 모아 주고" }, { node: "메일 비서", text: "메일함에 온 견적 답장도 써 줘" }];

test("chat_split: 원글 splits(주인 꼴 node · pane · post · at · state) · 노드 채널 몫 글 split_from, 같은 노드 다시는 건너뜀", async () => {
  const { D1, root } = setup();
  const tool = localTools(D1, A, "메인 봇", "https://board.example");
  const r = await tool("chat_split", { thread: root, parts: PARTS }) as any;
  assert.equal(r.ok, true); assert.equal(r.splits.length, 2);
  assert.deepEqual(r.splits.map((x: any) => Object.keys(x).sort()), [["at", "node", "pane", "post", "state"], ["at", "node", "pane", "post", "state"]]);
  assert.deepEqual(r.splits.map((x: any) => [x.node, x.pane]), [["매출 보고", MB.paneOfId("n-1")], ["메일 비서", MB.paneOfId("ew_mail01")]]);
  assert.ok(r.splits[0].at > 1e9 && r.splits[0].at < 1e11, "at 은 초");
  // Primary 목록: 내 원글에 같은 칩
  const pc = await get(D1, A, "/api/chat/primary");
  const m = pc.messages.find((x: any) => x.ts === root);
  assert.deepEqual(m.splits, r.splits);
  assert.ok(!pc.messages.some((x: any) => x.ts !== root && x.splits), "다른 글엔 칩 없음");
  assert.deepEqual((await get(D1, A, `/api/chat/primary/${root}`)).messages[0].splits, r.splits, "원글 스레드 화면도");
  // 노드 채널: 몫 글 = 인용(split_from)
  const nc = await get(D1, A, "/api/nodechat?w=" + encodeURIComponent("매출 보고"));
  const q = nc.messages.find((x: any) => x.split_from);
  assert.equal(q.text, "매출 보고 자료 모아 주고"); assert.equal(q.ts, r.splits[0].post);
  assert.deepEqual(q.split_from, { chan: "primary", ts: root, at: r.splits[0].at, who: "owner", name: "김" });
  const ec = await get(D1, A, "/api/nodechat?w=" + encodeURIComponent("메일 비서"));
  assert.equal(ec.messages.find((x: any) => x.split_from)?.text, "메일함에 온 견적 답장도 써 줘", "엔진 역할 창 노드도");
  assert.equal((await get(D1, A, `/api/chat/n:${encodeURIComponent("매출 보고")}/${r.splits[0].post}`)).messages[0].split_from.ts, root, "몫 글 스레드 화면도");
  const d = await MB.data(D1, A, { name: "모찌" });
  assert.ok(!d.feed.some((f: any) => /견적 답장/.test(f.msg)));
  // 같은 노드에 또 = 건너뜀, 칩 수 그대로
  const again = await tool("chat_split", { thread: root, parts: [{ node: "매출 보고", text: "또" }] }) as any;
  assert.deepEqual(again.skipped, ["매출 보고"]); assert.equal(again.splits.length, 2);
});

test("chat_split 거절: 모르는 · 남의 · 보관한 노드, 남의 글 · 봇 글 · 꼴이 틀린 id — 아무것도 안 씀", async () => {
  const { db, D1, root, botTs, bRoot } = setup();
  const tool = localTools(D1, A, "메인 봇", "https://board.example");
  const n0 = (db.prepare("SELECT count(*) n FROM board_log").get() as any).n;
  await assert.rejects(tool("chat_split", { thread: root, parts: [PARTS[0], { node: "없는 노드", text: "x" }] }), /없는 노드: 없는 노드/);
  await assert.rejects(tool("chat_split", { thread: root, parts: [{ node: "남의 일", text: "x" }] }), /없는 노드/);
  await assert.rejects(tool("chat_split", { thread: root, parts: [{ node: "옛 일", text: "x" }] }), /없는 노드/);
  await assert.rejects(tool("chat_split", { thread: bRoot, parts: PARTS }), /없는 글/);
  await assert.rejects(tool("chat_split", { thread: botTs, parts: PARTS }), /없는 글/);
  assert.equal((db.prepare("SELECT count(*) n FROM board_log").get() as any).n, n0);
  assert.equal((db.prepare("SELECT count(*) n FROM member_split").get() as any).n, 0);
  // 도구 길: 회원 전용(주인 다리엔 없음) · 입력 꼴
  const view = { visible: () => true, why: () => null, desc: () => "", mask: () => false };
  const ctx = { agent: "t", publicUrl: "https://x", view, get: async () => ({}), op: async () => ({ ok: true }) } as any;
  await assert.rejects(run(ctx, "chat_split", { thread: root, parts: PARTS }), /회원 보드 전용/);
  await assert.rejects(run({ ...ctx, local: tool }, "chat_split", { thread: root, parts: [] }), /입력이 맞지 않음/);
  await assert.rejects(run({ ...ctx, local: tool }, "chat_split", { thread: "12", parts: PARTS }), /입력이 맞지 않음/);
  const ok = await run({ ...ctx, local: tool }, "chat_split", { thread: root, parts: PARTS }) as any;
  assert.deepEqual(Object.keys(ok).sort(), ["ok", "splits"]);
});

test("/api/split/move: 내 몫 글을 내 다른 노드로 — 칩 · 두 노드 채널 반영, 남의 글 · 남의 노드 · 보관 노드는 404, 꼴 틀림 400", async () => {
  const { D1, root } = setup();
  const r = await localTools(D1, A, "메인 봇", "https://board.example")("chat_split", { thread: root, parts: PARTS }) as any;
  const post = r.splits[0].post, to = MB.paneOfId("n-2");
  assert.deepEqual(await MB.post(D1, B, "/api/split/move", { post, pane: MB.paneOfId("n-9") }), { error: "나눈 글이 아님", status: 404 });   // 남의 몫 글
  assert.deepEqual(await MB.post(D1, A, "/api/split/move", { post, pane: MB.paneOfId("n-9") }), { error: "없는 노드예요", status: 404 });   // 남의 노드
  assert.deepEqual(await MB.post(D1, A, "/api/split/move", { post, pane: MB.paneOfId("n-3") }), { error: "없는 노드예요", status: 404 });   // 끝난 노드
  assert.deepEqual(await MB.post(D1, A, "/api/split/move", { post: "1.2", pane: to }), { error: "몫 글 · 노드가 틀림", status: 400 });
  const mv = await MB.post(D1, A, "/api/split/move", { post, pane: to }) as any;
  assert.equal(mv.ok.ok, true);
  assert.deepEqual(mv.ok.splits.find((x: any) => x.post === post)?.node, "자료 정리");
  assert.equal(mv.ok.splits.find((x: any) => x.post === post)?.pane, to);
  const pc = await get(D1, A, "/api/chat/primary");
  assert.deepEqual(pc.messages.find((x: any) => x.ts === root).splits.map((x: any) => x.node).sort(), ["메일 비서", "자료 정리"]);
  assert.ok(!(await get(D1, A, "/api/nodechat?w=" + encodeURIComponent("매출 보고"))).messages.some((x: any) => x.ts === post), "옛 노드에서 빠짐");
  assert.equal((await get(D1, A, "/api/nodechat?w=" + encodeURIComponent("자료 정리"))).messages.find((x: any) => x.ts === post)?.split_from.ts, root, "새 노드에 인용으로");
  // 남은 칩의 노드로 합치기(칩 위에 놓기) — 같은 노드로 옮겨도 됨
  const merged = await MB.post(D1, A, "/api/split/move", { post: r.splits[1].post, pane: to }) as any;
  assert.deepEqual(merged.ok.splits.map((x: any) => x.node), ["자료 정리", "자료 정리"]);
});

test("칩 상태: 그 노드 열린 결정 = 내 차례, 아니면 장부 마지막 줄(막힘 · 진행 중), 몫 글을 지우면 칩도 사라짐 · 표가 없으면 그대로", async () => {
  const { db, D1, root } = setup();
  const r = await localTools(D1, A, "메인 봇", "https://board.example")("chat_split", { thread: root, parts: PARTS }) as any;
  db.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").run(A, "메일 비서", "blocked", "메일 권한이 없음", Date.now());
  let s = (await get(D1, A, "/api/chat/primary")).messages.find((x: any) => x.ts === root).splits;
  assert.equal(s.find((x: any) => x.node === "메일 비서").state, "막힘");
  db.prepare("INSERT INTO board_card(id, owner, win, question, choices, at) VALUES (?,?,?,?,?,?)").run("1790000000.000001", A, "메일 비서", "보낼까요?", "[\"네\"]", Date.now());
  s = (await get(D1, A, "/api/chat/primary")).messages.find((x: any) => x.ts === root).splits;
  assert.equal(s.find((x: any) => x.node === "메일 비서").state, "내 차례");
  // 내 몫 글 지우기 → 칩도 빠짐
  const [sec, id] = r.splits[0].post.split(".");
  db.prepare("DELETE FROM board_log WHERE owner = ? AND id % 1000000 = ? AND at >= ? AND at < ?").run(A, Number(id), Number(sec) * 1000, Number(sec) * 1000 + 1000);
  s = (await get(D1, A, "/api/chat/primary")).messages.find((x: any) => x.ts === root).splits;
  assert.deepEqual(s.map((x: any) => x.node), ["메일 비서"]);
  // 이주 전(표 없음): 목록은 칩 없이 그대로
  db.exec("DROP TABLE member_split");
  const pc = await get(D1, A, "/api/chat/primary");
  assert.ok(pc.messages.length >= 2 && !pc.messages.some((x: any) => x.splits));
});
