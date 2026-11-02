import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MB = await import("./member-board.ts");
const { localTools } = await import("./local.ts");
const { boardHead, HEAD_RE, stripHead } = await import("./board-head.ts");

const A = "a@example.com", B = "b@example.com";
const MIG = new URL("../migrations/", import.meta.url);
const NODE = "예시 팀장 노드", WIN = "팀장 창";
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  for (const o of [A, B]) {
    db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(o, "n-a", NODE, "working", now, now);
    db.prepare("INSERT INTO imp_item(owner, key, kind, engine, title, win, device_id, state, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run(o, "window:d1:%3", "window", "tmux-own", WIN, WIN, "d1", "idle", now);
    db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(o, "window:d1:%3", "n-a");
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
const pane = async (D1: D1Database, me: string) => (await MB.data(D1, me, { name: "메인 봇" })).panes.find((p: any) => p.win === NODE)!.pane;

test("머리 줄 꼴: Primary · 노드 채널 · 스레드 · 카드 — 채널 이름의 [ ] · 는 빈칸, 읽으면 같은 값", () => {
  assert.equal(boardHead({}), "[보드 · Primary]");
  assert.equal(boardHead({ channel: NODE }), `[보드 · ${NODE}]`);
  assert.equal(boardHead({ channel: NODE, thread: "1793000000.000123" }), `[보드 · ${NODE} · 스레드 1793000000.000123]`);
  assert.equal(boardHead({ channel: "팀 · [리드]", card: "1793000000.000001", thread: "1793000000.000123" }), "[보드 · 팀 리드 · 카드 1793000000.000001]");
  assert.equal(boardHead({ channel: NODE, thread: "w:12" }), `[보드 · ${NODE}]`, "id 꼴이 아니면 안 붙임");
  const m = HEAD_RE.exec(`[보드 · ${NODE} · 스레드 1793000000.000123] 이거 봐 줘`)!;
  assert.deepEqual([m[1], m[2], m[3]], [NODE, "스레드", "1793000000.000123"]);
  assert.equal(stripHead("[보드 · Primary] [Boarder chat] 안녕"), "[Boarder chat] 안녕");
});

test("노드 글 스레드에 쓴 사람 글 → 창에 넘기는 글 맨 앞에 [보드 · <노드> · 스레드 <뿌리>], 내 글 줄은 그 스레드로", async () => {
  const { D1, line } = setup();
  const root = line(A, WIN, "progress", "PR 올렸어요");
  const p = await pane(D1, A);
  const hop = await MB.post(D1, A, "/api/chat", { pane: p, thread: root, text: "이거 다시 봐 줘" }) as any;
  assert.equal(hop.path, "/api/me/nodes/cmd");
  assert.equal(hop.body.text, `[보드 · ${NODE} · 스레드 ${root}] 이거 다시 봐 줘`);
  assert.deepEqual(hop.log, { win: WIN, text: "이거 다시 봐 줘", thread: root });
  // 스레드가 아닌 노드 글 = 채널 머리 줄만(답은 예전처럼 그 채널)
  const top = await MB.post(D1, A, "/api/chat", { pane: p, text: "오늘 할 일?" }) as any;
  assert.equal(top.body.text, `[보드 · ${NODE}] 오늘 할 일?`);
  assert.equal(top.log.thread, undefined);
});

test("노드 스레드: 남의 · Primary · 없는 뿌리는 「없는 스레드」 — 다른 채널 밖으로 새지 않음", async () => {
  const { D1, line } = setup();
  const other = line(B, WIN, "progress", "B 의 글"), prim = line(A, "나", "chat", "Primary 글", "primary");
  const p = await pane(D1, A);
  for (const t of [other, prim, "1793000000.000999"]) assert.deepEqual(await MB.post(D1, A, "/api/chat", { pane: p, thread: t, text: "답" }), { error: "없는 스레드예요", status: 404 }, t);
});

test("inbox_say(boarder say): 카드 말고 내 노드 글 스레드 뿌리도 받음 → 노드 채팅 그 글 아래 답 · 남의 · Primary · 답 줄 뿌리는 거절", async () => {
  const { db, D1, line } = setup();
  const root = line(A, WIN, "progress", "PR 올렸어요");
  const human = line(A, WIN, "me", "사람이 스레드에 쓴 글", root);
  const say = localTools(D1, A, WIN, "https://example.invalid");
  const r = await say("inbox_say", { thread_id: root, text: "다시 봤어요 — 고칠 것 없음" }) as { msg_id: string };
  assert.match(r.msg_id, new RegExp(`^${root.replace(".", "\\.")}:`));
  assert.deepEqual(db.prepare("SELECT kind, text, thread FROM board_log WHERE owner = ? AND kind = 'say'").all(A).map(x => ({ ...x })), [{ kind: "say", text: "다시 봤어요 — 고칠 것 없음", thread: root }]);
  // 남의 글 · Primary 줄 · 답 줄(스레드 안 글) · 없는 id 는 거절
  const other = line(B, WIN, "progress", "B 의 글"), prim = line(A, "나", "chat", "Primary 글", "primary");
  for (const t of [other, prim, human, "1793000000.000999"]) await assert.rejects(say("inbox_say", { thread_id: t, text: "x" }), /없는 스레드/, t);
  const nc = await get(D1, A, "/api/nodechat?w=" + encodeURIComponent(NODE));
  const rootMsg = nc.messages.find((m: any) => m.ts === root);
  assert.equal(rootMsg.replies, 2);
  assert.ok(!nc.messages.some((m: any) => /다시 봤어요|사람이 스레드에/.test(m.text)), "답은 채널 바깥에 없음");
  const th = await get(D1, A, `/api/chat/${encodeURIComponent("n:" + NODE)}/${root}`);
  assert.deepEqual(th.messages.map((m: any) => [m.who, m.text]), [["agent", "PR 올렸어요"], ["owner", "사람이 스레드에 쓴 글"], ["agent", "다시 봤어요 — 고칠 것 없음"]]);
  // B 는 A 의 스레드를 못 봄
  assert.deepEqual((await get(D1, B, `/api/chat/${encodeURIComponent("n:" + NODE)}/${root}`)).messages, []);
});

test("카드 inbox_say 는 예전 그대로 · 카드 머리 줄의 채널 = 카드를 낸 창의 노드", async () => {
  const { db, D1 } = setup();
  db.prepare("INSERT INTO board_card(id, owner, win, kind, question, choices, state, at) VALUES (?,?,?,?,?,?,?,?)").run("1793000000.000001", A, WIN, "decision", "할까요?", '["네"]', "answered", Date.now());
  await localTools(D1, A, WIN, "https://example.invalid")("inbox_say", { thread_id: "1793000000.000001", text: "했어요" });
  assert.equal(await MB.channelOf(D1, A, WIN), NODE);
  assert.equal(await MB.channelOf(D1, A, "모르는 창"), "모르는 창");
});
