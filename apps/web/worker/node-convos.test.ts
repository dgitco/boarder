import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MB = await import("./member-board.ts");

const A = "a@example.com", B = "b@example.com";
const MIG = new URL("../migrations/", import.meta.url);
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(A, "n-lead", "예시 팀장", "working", now, now);
  db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(A, "win:팀장 창", "n-lead");
  const imp = (owner: string, key: string, kind: string, title: string, at: number) => {
    db.prepare("INSERT INTO imp_item(owner, key, kind, engine, title, refs, state, state_at, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run(owner, key, kind, kind === "session" ? "claude" : "", title, kind === "thread" ? '["gh:example/repo#1"]' : "[]", "idle", at, at);
    db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(owner, key, owner === A ? "n-lead" : "n-b");
  };
  for (let i = 0; i < 5; i++) imp(A, `session:claude:s${i}`, "session", `다른 창에 준 지시 ${i}`, now - 90_000_000 + i * 1000);
  for (let i = 0; i < 2; i++) imp(A, `thread:gh:example/repo#${i}`, "thread", `예시 이슈 ${i}`, now - 80_000_000 + i * 1000);
  db.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").run(A, "팀장 창", "progress", "이슈를 만들고 넘겼어요", now - 1000);
  db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(B, "n-b", "남의 노드", "working", now, now);
  imp(B, "session:claude:sb", "session", "남의 지시", now - 5000);
  const exec = (sql: string, args: unknown[]) => { const st = db.prepare(sql); if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } }; const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  return { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) } as unknown as D1Database;
}
const get = async (D1: D1Database, me: string, p: string) => { const r = await MB.get(D1, me, { name: "메인 봇" }, new URL("https://x" + p), async () => null) as Response; return r.json() as Promise<any>; };

test("노드 채팅: 들여온 세션 · 스레드는 글로 섞지 않고 맨 위 접힌 글 하나 — 창이 쓴 줄은 그대로", async () => {
  const D1 = setup();
  const nc = await get(D1, A, "/api/nodechat?w=" + encodeURIComponent("예시 팀장"));
  assert.equal(nc.messages.length, 2, JSON.stringify(nc.messages.map((m: any) => m.text)));
  const [fold, line] = nc.messages;
  assert.match(fold.text, /^지난 대화 5 · 스레드 2 — /);
  assert.equal(fold.replies, 7);
  assert.match(fold.ts, /^\d{10}\.99\d{4}$/);
  assert.equal(line.text, "이슈를 만들고 넘겼어요");
  assert.ok(!nc.messages.some((m: any) => m.moved), "옮겨 온 글이 채팅에 섞이지 않음");
});

test("접힌 글을 누르면(스레드) 그 노드에 들여온 대화 일곱이 시각 순으로 — 남은 못 엶", async () => {
  const D1 = setup();
  const fold = (await get(D1, A, "/api/nodechat?w=" + encodeURIComponent("예시 팀장"))).messages[0];
  const th = await get(D1, A, `/api/chat/primary/${fold.ts}`);
  assert.equal(th.root, fold.ts);
  assert.deepEqual(th.messages.slice(1).map((m: any) => m.text), ["다른 창에 준 지시 0", "다른 창에 준 지시 1", "다른 창에 준 지시 2", "다른 창에 준 지시 3", "다른 창에 준 지시 4", "예시 이슈 0", "예시 이슈 1"]);
  assert.ok(th.messages.slice(1).every((m: any) => m.thread === fold.ts && m.moved));
  const other = await get(D1, B, `/api/chat/primary/${fold.ts}`);
  assert.deepEqual(other.messages, []);
});
