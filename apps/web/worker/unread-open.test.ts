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
  for (const [o, id, name, win] of [[A, "n-a", "예시 팀장", "팀장 창"], [A, "n-s", "11/02 보고/정리 확인", "슬래시 창"], [B, "n-b", "남의 노드", "남의 창"]]) {
    db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(o, id, name, "working", now, now);
    db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(o, "win:" + win, id);
  }
  const log = (o: string, win: string, text: string, at: number, thread: string | null = null) => Number(db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(o, win, "reply", text, thread, at).lastInsertRowid);
  const l1 = log(A, "팀장 창", "이슈를 만들고 넘겼어요", now - 5000);
  const lb = log(B, "남의 창", "남의 글", now - 4000);
  const ls = log(A, "슬래시 창", "슬래시 든 노드의 글", now - 3500);
  const lp = log(A, "팀장 창", "Primary 글", now - 3000, "primary");
  db.prepare("INSERT INTO board_card(id, owner, win, question, choices, state, answer, answered_at, at) VALUES (?,?,?,?,?,?,?,?,?)").run("1793000000.000123", A, "팀장 창", "배포할까요?", '["A","B"]', "answered", "A", now - 1000, now - 2000);
  const lc = log(A, "팀장 창", "배포했어요", now - 500, "1793000000.000123");
  const exec = (sql: string, args: unknown[]) => { const st = db.prepare(sql); if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } }; const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) } as unknown as D1Database;
  const at = (id: number) => (db.prepare("SELECT at FROM board_log WHERE id = ?").get(id) as { at: number }).at;
  const tsOf = (id: number) => `${Math.floor(at(id) / 1000)}.${String(id % 1_000_000).padStart(6, "0")}`;
  const addTwin = () => {
    const t = Date.now();
    db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(A, "n-twin", "예시 팀장", "working", t, t + 1000);
    db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(A, "win:쌍둥이 창", "n-twin");
    return tsOf(log(A, "쌍둥이 창", "쌍둥이 글", t));
  };
  return { D1, tsOf, addTwin, ts: { l1: tsOf(l1), lb: tsOf(lb), ls: tsOf(ls), lp: tsOf(lp), lc: tsOf(lc) } };
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

test("이름에 「/」 가 든 노드(업무 「11/02 …」)의 글도 스레드로 읽힘 · 남의 계정은 빈 답", async () => {
  const { D1, ts } = setup();
  const j = await chat(D1, A, encodeURIComponent("n:11/02 보고/정리 확인"), ts.ls);
  assert.equal(j.home, "11/02 보고/정리 확인");
  assert.deepEqual(j.messages.map((m: any) => m.text), ["슬래시 든 노드의 글"]);
  assert.deepEqual((await chat(D1, B, encodeURIComponent("n:11/02 보고/정리 확인"), ts.ls)).messages, []);
});

test("같은 이름 노드가 둘이면 id 로 그 노드의 글만(업무 화면) · 남의 id 는 이름 길로", async () => {
  const { D1, ts, addTwin } = setup();
  const lt = addTwin();
  const u = (me: string, id: string) => MB.get(D1, me, { name: "메인 봇" }, new URL(`https://x/api/nodechat?w=${encodeURIComponent("예시 팀장")}&id=${id}`), async () => null).then((r: any) => r.json());
  const a = await u(A, "n-a"), b = await u(A, "n-twin");
  assert.ok(a.messages.some((m: any) => m.ts === ts.l1) && !a.messages.some((m: any) => m.ts === lt));
  assert.ok(b.messages.some((m: any) => m.ts === lt) && !b.messages.some((m: any) => m.ts === ts.l1));
  assert.ok(!(await u(B, "n-a")).messages.some((m: any) => m.ts === ts.l1), "남의 id 로 못 읽음");
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
  const moved = await chat(D1, A, "n:없는 노드", ts.l1);
  assert.deepEqual(moved.messages.map((m: any) => [m.ts, m.text, m.ch]), [[ts.l1, "이슈를 만들고 넘겼어요", "n:없는 노드"]]);
  assert.equal(moved.orphan, true);
  // 남의 뿌리 · 남의 카드 · 모르는 ts 는 없는 노드 채널로 불러도 빈 답
  assert.deepEqual((await chat(D1, B, "n:없는 노드", ts.l1)).messages, [], "남의 뿌리");
  assert.deepEqual((await chat(D1, A, "n:없는 노드", ts.lb)).messages, [], "남의 글");
  assert.deepEqual((await chat(D1, A, "n:없는 노드", "1793000000.000999")).messages, [], "모르는 ts");
  assert.deepEqual((await chat(D1, B, "n:남의 노드", "1793000000.000123")).messages, [], "남의 카드");
});

test("스레드 글의 quiet 표시: 상태 · 작업 기록 줄만 quiet — 화면이 「새 답」 선을 서버 새 답 수(n)와 같게 셈", async () => {
  const { D1, ts } = setup(), now = Date.now();
  for (const [k, txt, d] of [["reply", "답 A", 400], ["progress", "진행 P1", 300], ["status", "상태 S1", 200]] as const)
    await D1.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").bind(A, "팀장 창", k, txt, ts.l1, now - d).run();
  const j = await chat(D1, A, "n:예시 팀장", ts.l1);
  const q = Object.fromEntries(j.messages.map((m: any) => [m.text, !!m.quiet]));
  assert.deepEqual(q, { "이슈를 만들고 넘겼어요": false, "답 A": false, "진행 P1": true, "상태 S1": true });
  const it = (await MI.inbox(D1, A)).unread.find((u: any) => u.thread === ts.l1);
  assert.equal(it?.n, 1); assert.equal(it?.text, "답 A");   // 서버 새 답 수 = quiet 아닌 답만
});
