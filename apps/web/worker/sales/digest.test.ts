// node --test --no-warnings apps/web/worker/sales/digest.test.ts — 영업 보드 아침 알림: 받는 사람 경계(팀원 · 보드에 들어온 사람만) · 날짜(한국 날짜, 오늘 · 지남)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";

registerHooks({ resolve(spec, ctx, next) { try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(spec + ".ts", ctx); throw e; } } });
const { digestOf, digestMail, runDigest } = await import("./digest.ts");

function d1(db: DatabaseSync) {
  const exec = (sql: string, args: unknown[]) => ({ results: db.prepare(sql).all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } });
  const stmt = (sql: string, args: unknown[] = []) => ({ bind: (...a: unknown[]) => stmt(sql, a), all: async () => exec(sql, args), first: async () => exec(sql, args).results[0] ?? null });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}
function setup() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter(f => /_sales(_[a-z]+)?\.sql$/.test(f)).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  db.exec('create table "user" (email text, name text)');
  db.exec("INSERT INTO sales_team(id, name, created_by, created_at) VALUES ('t1', '예시 영업', 'a@example.com', 0), ('t2', '남의 팀', 'z@example.com', 0)");
  db.exec("INSERT INTO sales_member(team, email, role, added_by, at) VALUES ('t1','a@example.com','admin','x',0), ('t1','b@example.com','member','x',0), ('t1','c@example.com','member','x',0), ('t2','z@example.com','admin','x',0)");
  db.exec("INSERT INTO \"user\"(email, name) VALUES ('a@example.com', '에이'), ('Z@example.com', '제트'), ('q@example.com', '큐')");   // b · c 는 아직 보드에 안 들어옴, q 는 들어왔지만 팀원 아님
  let n = 0;
  const card = (team: string, firm: string, stage: string, assignee: string, due: string | null, hold: string | null = null) =>
    db.prepare("INSERT INTO sales_card(id, team, firm, stage, assignee, source, next, due, hold_until, lost_reason, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,'inquiry','다음',?,?,?,?,0,?,0)")
      .run("c" + ++n, team, firm, stage, assignee, due, hold, stage === "lost" ? "이유" : "", assignee, assignee);
  return { db: d1(db), card };
}
const NOW = Date.UTC(2026, 10, 2, 23, 30);

test("한국 날짜로 오늘 기한 · 지난 것만, 지난 것 먼저 — 보류는 다시 볼 날, 놓침 · 앞날은 빠짐", async () => {
  const s = setup();
  s.card("t1", "오늘 사무소", "call", "a@example.com", "2026-11-03");
  s.card("t1", "지난 사무소", "proposal", "a@example.com", "2026-11-01");
  s.card("t1", "내일 사무소", "call", "a@example.com", "2026-11-04");
  s.card("t1", "보류 사무소", "hold", "a@example.com", null, "2026-11-03");
  s.card("t1", "놓친 사무소", "lost", "a@example.com", "2026-11-01");
  const sent: { to: string; subject: string; text: string }[] = [];
  const r = await runDigest(s.db, "https://b.example/", { mail: async (to, m) => { sent.push({ to, ...m }); }, push: async () => {}, member: async () => true }, { now: NOW });
  assert.equal(r.today, "2026-11-03");
  assert.deepEqual(r.sent.map(x => [x.to, x.items]), [["a@example.com", 3]]);
  assert.equal(sent[0].subject, "영업 보드 11/3 — 오늘 기한 2 · 지남 1");
  const lines = sent[0].text.split("\n").filter(l => l.startsWith("["));
  assert.deepEqual(lines.map(l => l.split(" — ")[0]), ["[지남 11/1] 지난 사무소", "[오늘] 보류 사무소", "[오늘] 오늘 사무소"]);
  assert.match(sent[0].text, /https:\/\/b\.example\/sales/);
});

test("받는 사람: 팀원이면서 보드에 들어온 담당만 — 안 들어온 사람 · 팀에서 빠진 담당 · 남의 팀은 안 감", async () => {
  const s = setup();
  s.card("t1", "비 담당", "call", "b@example.com", "2026-11-01");          // b: 팀원이지만 user 줄 없음 → 안 감
  s.card("t1", "빠진 사람 카드", "call", "q@example.com", "2026-11-01");   // q: 팀원 아님
  s.card("t2", "남의 팀 카드", "call", "z@example.com", "2026-11-01");     // z: 대소문자 다른 user 줄 → 감(자기 팀 것만)
  s.card("t1", "에이 카드", "call", "a@example.com", "2026-11-03");
  const to: string[] = [], pushed: string[] = [];
  const r = await runDigest(s.db, "https://b.example", { mail: async (t, m) => { to.push(t + ":" + m.subject); }, push: async (t, n) => { pushed.push(t + ":" + n.url); }, member: async () => true }, { now: NOW });
  assert.deepEqual(to.sort(), ["a@example.com:영업 보드 11/3 — 오늘 기한 1", "z@example.com:영업 보드 11/3 — 지남 1"]);
  assert.deepEqual(pushed.sort(), ["a@example.com:./sales", "z@example.com:./sales"]);
  assert.equal(r.sent.length, 2);
});

test("only = 그 한 사람만, dry = 안 보냄, 한 사람 메일이 실패해도 다음 사람은 감", async () => {
  const s = setup();
  s.card("t1", "에이 카드", "call", "a@example.com", "2026-11-01");
  s.card("t2", "제트 카드", "call", "z@example.com", "2026-11-01");
  let n = 0;
  const one = await runDigest(s.db, "https://b.example", { mail: async () => { n++; }, push: async () => {}, member: async () => true }, { now: NOW, only: "a@example.com" });
  assert.deepEqual(one.sent.map(x => x.to), ["a@example.com"]); assert.equal(n, 1);
  const dry = await runDigest(s.db, "https://b.example", { mail: async () => { n++; }, push: async () => {}, member: async () => true }, { now: NOW, dry: true });
  assert.equal(dry.sent.length, 2); assert.equal(n, 1);
  const bad = await runDigest(s.db, "https://b.example", { mail: async t => { if (t.startsWith("a")) throw new Error("메일 실패"); n++; }, push: async () => {}, member: async () => true }, { now: NOW });
  assert.deepEqual(bad.sent.map(x => [x.to, x.mail === "ok"]), [["a@example.com", false], ["z@example.com", true]]);
});

test("메일 html 은 글자를 풀지 않음(사무소 이름의 < > 그대로 글자로)", () => {
  const [d] = digestOf([{ team: "t", team_name: "팀", firm: "<b>가</b> & 나", stage: "call", assignee: "a@example.com", next: "x", due: "2026-11-03", hold_until: null }], "2026-11-03");
  const m = digestMail(d, "2026-11-03", "https://b.example/sales");
  assert.ok(m.html.includes("&lt;b&gt;가&lt;/b&gt; &amp; 나")); assert.ok(!m.html.includes("<b>가</b>"));
});

test("초대가 빠진 사람(지금 회원 아님)에게는 팀원 · user 줄이 남아 있어도 아무것도 안 감 — dry 에도 안 셈", async () => {
  const s = setup();
  s.card("t1", "에이 카드", "call", "a@example.com", "2026-11-01");
  s.card("t2", "제트 카드", "call", "z@example.com", "2026-11-01");
  const to: string[] = [], pushed: string[] = [];
  const send = { mail: async (t: string) => { to.push(t); }, push: async (t: string) => { pushed.push(t); }, member: async (e: string) => e !== "a@example.com" };
  const r = await runDigest(s.db, "https://b.example", send, { now: NOW });
  assert.deepEqual([to, pushed], [["z@example.com"], ["z@example.com"]]);
  assert.deepEqual(r.sent.map(x => x.to), ["z@example.com"]);
  const dry = await runDigest(s.db, "https://b.example", send, { now: NOW, dry: true });
  assert.deepEqual(dry.sent.map(x => x.to), ["z@example.com"]);
});
