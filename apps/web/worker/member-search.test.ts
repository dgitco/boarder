// node --test apps/web/worker/member-search.test.ts (Node 22.18+ 타입 지우기 · node:sqlite)
// 회원 찾기(boarder-internal#4) 경계: 회원 A 는 자기 글만 · 회원 B 글은 0건 · 주인 줄 · 주인 색인(SEARCH DO)은 안 탐
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { query, route } from "./member-search.ts";

// 메모리 SQLite 가짜 D1 — 진짜 마이그레이션을 차례로 올림(표 이름 · 칸이 운영과 같게). 부른 SQL · 값은 seen 에 남김
const MIG = new URL("../migrations/", import.meta.url);
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const seen: { sql: string; args: unknown[] }[] = [];
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => { seen.push({ sql, args }); return { results: db.prepare(sql).all(...(args as never[])) }; },
    first: async () => { seen.push({ sql, args }); return db.prepare(sql).get(...(args as never[])) ?? null; },
    run: async () => { seen.push({ sql, args }); db.prepare(sql).run(...(args as never[])); return { success: true }; },
  });
  const d1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: ReturnType<typeof stmt>[]) => Promise.all(ss.map(s => s.all())) };
  return { db, seen, d1: d1 as unknown as D1Database };
}

const A = "a@member.test", B = "b@member.test", OWNER = "owner@boss.test", T = 1_793_300_000_000;
function seed(db: DatabaseSync) {
  const log = db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES(?,?,?,?,?,?)");
  const card = db.prepare("INSERT INTO board_card(id, owner, win, question, choices, body, state, at) VALUES(?,?,?,?,'[]',?,?,?)");
  const node = db.prepare("INSERT INTO mnode(owner, id, name, state, why, created_at, updated_at) VALUES(?,?,?,?,?,?,?)");
  const item = db.prepare("INSERT INTO imp_item(owner, key, kind, title, win, seen_at) VALUES(?,?,?,?,?,?)");
  const link = db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES(?,?,?)");
  for (const [who, tag] of [[A, "에이"], [B, "비이"], [OWNER, "주인"]]) {
    // 같은 낱말(가산세)을 셋 모두 씀 — 회원 A 답에 B · 주인 것이 섞이면 안 됨
    node.run(who, "n_" + tag, `${tag} 가산세 정리`, "turn", "납부서 다시 받기", T, T);
    item.run(who, "window:" + tag, "window", `${tag} 창`, `win-${tag}`, T);
    item.run(who, "todo:" + tag + ":1", "todo", `${tag} 가산세 서류 내기`, "", T);
    link.run(who, "window:" + tag, "n_" + tag); link.run(who, "todo:" + tag + ":1", "n_" + tag);
    log.run(who, `win-${tag}`, "progress", `${tag} 가산세 계산 끝`, null, T + 1000);
    log.run(who, "나", "me", `${tag} Primary 에 가산세 물어봄`, "primary", T + 2000);
    card.run("card-" + tag, who, `win-${tag}`, `${tag} 가산세 낼까요?`, "기한 오늘", "open", T + 3000);
  }
  log.run(B, "win-비이", "progress", "비밀 계획 B 만 아는 낱말 qzx", null, T + 4000);
  log.run(OWNER, "win-주인", "progress", "주인만 아는 낱말 qzx", null, T + 4000);
}
const texts = (r: Awaited<ReturnType<typeof query>>) => JSON.stringify([r.nodes, r.cards, r.chats]);

test("회원 A 는 자기 글만: 노드 · 결정 · 할 일 · 장부 · Primary 대화", async () => {
  const { db, d1 } = fakeD1(); seed(db);
  const r = await query(d1, A, "가산세");
  assert.deepEqual(r.nodes.map(n => n.title), ["에이 가산세 정리"]);
  assert.equal(r.nodes[0].turn, "내 차례");
  assert.deepEqual(r.cards.map(c => [c.title, c.ckind, c.node]).sort(), [["에이 가산세 낼까요?", "decision", "에이 가산세 정리"], ["에이 가산세 서류 내기", "todo", "에이 가산세 정리"]]);
  assert.match(r.cards.find(c => c.ckind === "decision")!.ts, /^w:\d+$/);   // 보드 cardlist 와 같은 열쇠(w:<rowid>)
  assert.deepEqual(r.chats.map(m => [m.kind, m.title]).sort(), [["chat", "나"], ["log", "에이 가산세 정리"]]);
  assert.ok(!/비이|주인/.test(texts(r)), "B · 주인 줄이 섞임");
});

test("회원 B 글 · 주인 줄은 회원 A 에게 0건", async () => {
  const { db, d1 } = fakeD1(); seed(db);
  for (const q of ["qzx", "비밀 계획", "비이", "주인"]) {
    const r = await query(d1, A, q);
    assert.equal(r.nodes.length + r.cards.length + r.chats.length + r.arts.length, 0, q);
  }
  const b = await query(d1, B, "qzx");   // 같은 낱말 — B 는 자기 것 하나만
  assert.deepEqual(b.chats.map(m => m.text), ["비밀 계획 B 만 아는 낱말 qzx"]);
});

test("모든 쿼리가 owner = ? 에 그 회원 메일을 묶음", async () => {
  const { db, d1, seen } = fakeD1(); seed(db);
  await query(d1, A, "가산세 계산");
  assert.ok(seen.length >= 8);
  for (const s of seen) { assert.match(s.sql, /\bWHERE owner = \?/, s.sql); assert.equal(s.args[0], A, s.sql); }
});

test("LIKE 글자(% _ \\)는 글자 그대로", async () => {
  const { db, d1 } = fakeD1(); seed(db);
  for (const q of ["%", "_", "\\"]) { const r = await query(d1, A, q); assert.equal(r.nodes.length + r.cards.length + r.chats.length, 0, q); }
  assert.equal((await query(d1, A, "   ")).chats.length, 0);
});

test("route: 회원은 주인 색인을 안 탐 · 메일은 작은 글자로, 주인은 주인 색인만", async () => {
  const { db, d1, seen } = fakeD1(); seed(db);
  let ownerCalls = 0;
  const ownerSearch = async () => { ownerCalls++; return { owner: true }; };
  const m = await route({ owner: false, me: "A@Member.Test", q: "가산세", db: d1, ownerSearch });
  assert.equal(ownerCalls, 0);
  const mm = m as Awaited<ReturnType<typeof query>>; assert.equal(mm.member, 1); assert.deepEqual(mm.nodes.map(x => x.title), ["에이 가산세 정리"]);
  const n = seen.length;
  assert.deepEqual(await route({ owner: true, me: OWNER, q: "가산세", db: d1, ownerSearch }), { owner: true });
  assert.equal(ownerCalls, 1); assert.equal(seen.length, n, "주인 갈래가 회원 D1 을 읽음");
});
