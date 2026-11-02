import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MB = await import("./member-board.ts");
const MI = await import("./member-inbox.ts");

const A = "a@example.com", B = "b@example.com";
const MIG = new URL("../migrations/", import.meta.url);
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  for (const [o, id, name, win] of [[A, "n-a", "예시 팀장", "팀장 창"], [B, "n-b", "남의 노드", "남의 창"]]) {
    db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(o, id, name, "working", now, now);
    db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(o, "win:" + win, id);
  }
  const log = (o: string, win: string, text: string, at: number, thread: string | null = null) => Number(db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(o, win, "progress", text, thread, at).lastInsertRowid);
  const l1 = log(A, "팀장 창", "이슈를 만들고 넘겼어요", now - 5000);
  const lb = log(B, "남의 창", "남의 글", now - 4000);
  const lp = log(A, "팀장 창", "Primary 글", now - 3000, "primary");
  db.prepare("INSERT INTO board_card(id, owner, win, question, choices, state, answer, answered_at, at) VALUES (?,?,?,?,?,?,?,?,?)").run("1793000000.000123", A, "팀장 창", "배포할까요?", '["A","B"]', "answered", "A", now - 1000, now - 2000);
  const lc = log(A, "팀장 창", "배포했어요", now - 500, "1793000000.000123");
  const exec = (sql: string, args: unknown[]) => { const st = db.prepare(sql); if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } }; const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) } as unknown as D1Database;
  const at = (id: number) => (db.prepare("SELECT at FROM board_log WHERE id = ?").get(id) as { at: number }).at;
  const tsOf = (id: number) => `${Math.floor(at(id) / 1000)}.${String(id % 1_000_000).padStart(6, "0")}`;
  return { D1, ts: { l1: tsOf(l1), lb: tsOf(lb), lp: tsOf(lp), lc: tsOf(lc) } };
}
// 틀이 부르는 꼴 그대로: 채널 이름은 인코딩 안 한 채 붙이고 브라우저가 한글을 %인코딩
const chat = async (D1: D1Database, me: string, ch: string, ts: string) => { const u = new URL(`https://x/api/chat/${ch}/${ts}`); const r = await MB.get(D1, me, { name: "메인 봇" }, u, async () => null) as Response | null; return r ? r.json() as Promise<any> : null; };

test("읽지 않음 목록의 노드 글 → api/chat/n:<노드>/<ts> 가 그 글 + home(노드 이름)", async () => {
  const { D1, ts } = setup();
  const ib = await MI.inbox(D1, A);
  const x = ib.unread.find((u: any) => u.ts === ts.l1)!;
  assert.equal(x.chan, "n:예시 팀장");
  const j = await chat(D1, A, x.chan, x.thread || x.ts);
  assert.equal(j.home, "예시 팀장"); assert.equal(j.root, ts.l1); assert.equal(j.channel, "n:예시 팀장");
  assert.deepEqual(j.messages.map((m: any) => [m.ts, m.text]), [[ts.l1, "이슈를 만들고 넘겼어요"]]);
});

test("카드 스레드의 답 줄 → 그 카드 스레드(카드 글 + 에이전트 줄 + 사람 답)", async () => {
  const { D1, ts } = setup();
  const x = (await MI.inbox(D1, A)).unread.find((u: any) => u.ts === ts.lc)!;
  assert.equal(x.thread, "1793000000.000123");
  const j = await chat(D1, A, x.chan, x.thread);
  assert.equal(j.home, "예시 팀장");
  assert.equal(j.messages[0].text, "배포할까요?");
  assert.deepEqual(new Set(j.messages.slice(1).map((m: any) => m.text)), new Set(["A", "배포했어요"]));
});

test("남의 노드 · 남의 글 · Primary 글 · 모르는 노드는 빈 답(글을 안 내줌)", async () => {
  const { D1, ts } = setup();
  assert.deepEqual((await chat(D1, A, "n:남의 노드", ts.lb)).messages, []);
  assert.deepEqual((await chat(D1, A, "n:예시 팀장", ts.lb)).messages, []);
  assert.deepEqual((await chat(D1, B, "n:예시 팀장", ts.l1)).messages, []);
  assert.deepEqual((await chat(D1, A, "n:예시 팀장", ts.lp)).messages, []);
  assert.deepEqual((await chat(D1, A, "n:없는 노드", ts.l1)).messages, []);
  assert.deepEqual((await chat(D1, B, "n:남의 노드", "1793000000.000123")).messages, [], "남의 카드");
});
