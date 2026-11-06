import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MB = await import("./member-board.ts");
const MV = await import("./member-views.ts");
const MS = await import("./member-search.ts");
const { localTools } = await import("./local.ts");
const { run } = await import("./mcp/tools.ts");

const A = "a@example.com", B = "b@example.com";
const MIG = new URL("../migrations/", import.meta.url);
const H = 3600_000;
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const exec = (sql: string, args: unknown[]) => { const st = db.prepare(sql); if (/^\s*select|\breturning\b/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } }; const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) } as unknown as D1Database;
  const now = Date.now();
  const node = (o: string, id: string, name: string, state: string, win: string, o2: { updated?: number; archived?: number | null; area?: string } = {}) => {
    db.prepare("INSERT INTO mnode(owner, id, name, area, state, created_at, updated_at, archived_at) VALUES (?,?,?,?,?,?,?,?)").run(o, id, name, o2.area ?? "", state, now - 50 * H, o2.updated ?? now, o2.archived ?? null);
    db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(o, "win:" + win, id);
  };
  const line = (o: string, win: string, kind: string, text: string, at: number, thread: string | null = null) => {
    const r = db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(o, win, kind, text, thread, at);
    return `${Math.floor(at / 1000)}.${String(Number(r.lastInsertRowid) % 1_000_000).padStart(6, "0")}`;
  };
  return { db, D1, now, node, line };
}
const get = async (D1: D1Database, me: string, path: string) => (await (await MB.get(D1, me, { name: "메인 봇" }, new URL("https://x" + path), async () => null) as Response).json()) as any;

test("지난 판: 노드마다 일함 → 쉼 · 내 차례(카드) → 답하면 쉼 · 주차 · 닫힘, 메인 봇 줄, 기간 거르기, 남의 줄은 안 섞임", async () => {
  const { db, D1, now, node, line } = setup();
  node(A, "n-1", "매출 보고", "working", "보고 창");
  node(A, "n-2", "옛 정리", "done", "정리 창", { updated: now - 30 * H, archived: now - 30 * H });
  node(A, "n-3", "쉬는 일", "parked", "쉬는 창", { updated: now - 2 * H });
  node(B, "n-9", "남의 일", "working", "남 창");
  line(A, "보고 창", "start", "보고서 만들기 시작", now - 5 * H);
  line(A, "보고 창", "done", "보고서 끝", now - 4 * H);
  db.prepare("INSERT INTO board_card(id, owner, win, question, choices, state, answer, answered_at, at) VALUES (?,?,?,?,?,?,?,?,?)").run("1793000000.000001", A, "보고 창", "보낼까요?", '["네"]', "answered", "네", now - 3 * H, now - 3.5 * H);
  line(A, "정리 창", "progress", "정리 중", now - 40 * H);
  line(A, "쉬는 창", "blocked", "남의 답 기다림", now - 3 * H);
  line(A, "메인 봇", "say", "안녕하세요", now - 1 * H, "primary");
  line(A, "나", "chat", "내 글", now - 1 * H, "primary");
  line(B, "남 창", "start", "남의 시작", now - 2 * H);

  const h = await get(D1, A, "/api/history");
  const by = Object.fromEntries(h.rows.map((r: any) => [r.key, r]));
  assert.ok(!by["w:남의 일"], "남의 노드 줄이 섞임");
  assert.ok(Math.abs(h.oldest - (now - 40 * H) / 1000) < 2 && Math.abs(h.since - Math.max(h.now - 72 * 3600, h.oldest - 60)) < 2);
  const s = by["w:매출 보고"];
  assert.equal(s.open, true); assert.equal(s.area, "primary"); assert.equal(s.name, "매출 보고");
  assert.deepEqual(s.segs.map((x: any) => x[2]), ["work", "quiet", "ask", "work"]);   // 시작 → 끝(쉼) → 카드(내 차례) → 답(쉼) — 지금 노드가 일하는 중이라 마지막은 일함(history.py busy_now 와 같음)
  assert.ok(s.marks.some((m: any) => m[1] === "ask"));
  assert.equal(s.segs.at(-1)[1], h.now);
  const p = by["w:쉬는 일"];
  assert.equal(p.open, false); assert.equal(p.now, "park"); assert.deepEqual(p.segs.map((x: any) => x[2]), ["wait", "park"]);
  const c = by["w:옛 정리"];
  assert.equal(c.now, "closed"); assert.ok(c.marks.some((m: any) => m[1] === "close"));
  assert.ok(by.primary && by.primary.open && by.primary.segs.length, "메인 봇 줄");
  const short = await get(D1, A, "/api/history?since=" + Math.floor((now - 6 * H) / 1000));
  assert.ok(!short.rows.some((r: any) => r.key === "w:옛 정리"));
  assert.ok(short.rows.every((r: any) => r.segs.every((x: any) => x[1] > short.since)));
  // B 는 제 것만
  const hb = await get(D1, B, "/api/history");
  assert.deepEqual(hb.rows.map((r: any) => r.key), ["w:남의 일"]);
});

test("지난 판 영역 열: 노드 영역이 둘 이상이면 data().areas 의 열 키(m0 · m1)로", async () => {
  const { D1, now, node, line } = setup();
  node(A, "n-1", "가 일", "working", "가 창", { area: "가 리포" });
  node(A, "n-2", "나 일", "working", "나 창", { area: "나 리포" });
  node(A, "n-3", "나 옛 일", "done", "나옛 창", { area: "나 리포", archived: now - 2 * H, updated: now - 2 * H });
  for (const w of ["가 창", "나 창", "나옛 창"]) line(A, w, "start", "시작", now - 5 * H);
  const d = await MB.data(D1, A, null), key = (n: string) => d.areas.find((a: any) => a.name === n).key;
  const h = await get(D1, A, "/api/history"), by = Object.fromEntries(h.rows.map((r: any) => [r.key, r]));
  assert.equal(by["w:가 일"].area, key("가 리포"));
  assert.equal(by["w:나 옛 일"].area, key("나 리포"));   // 닫힌 노드도 제 영역 열에(화면 off 줄은 h.area 로 놓음)
});

test("주제: 노드(일함 · 주차 · 끝남) = 주제, 스레드 = 카드(그 창 노드가 주제 · 열린 단추 카드는 내 차례) + 내 Primary 글(답 수 · 마지막 답), 남의 것 안 섞임", async () => {
  const { db, D1, now, node, line } = setup();
  node(A, "n-1", "매출 보고", "working", "보고 창");
  node(A, "n-2", "쉬는 일", "parked", "쉬는 창");
  node(A, "n-3", "막 끝남", "done", "끝 창");
  node(B, "n-9", "남의 일", "working", "남 창");
  db.prepare("INSERT INTO board_card(id, owner, win, question, choices, state, at) VALUES (?,?,?,?,?,?,?)").run("1793000000.000002", A, "보고 창", "어느 쪽으로?", '["가","나"]', "open", now - H);
  db.prepare("INSERT INTO board_card(id, owner, win, question, choices, state, at) VALUES (?,?,?,?,?,?,?)").run("1793000000.000003", B, "남 창", "남의 질문", '["가"]', "open", now - H);
  const root = line(A, "나", "chat", "이거 어떻게 돼?", now - 2 * H, "primary");
  line(A, "메인 봇", "say", "보고 있어요", now - H, "p:" + root);
  const t = await get(D1, A, "/api/topics");
  const ids = Object.fromEntries(t.topics.map((x: any) => [x.title, x]));
  assert.deepEqual(Object.keys(ids).sort(), ["막 끝남", "매출 보고", "쉬는 일"]);
  assert.equal(ids["매출 보고"].live, true); assert.equal(ids["매출 보고"].state, "open");
  assert.equal(ids["쉬는 일"].parked, "주차");
  assert.equal(ids["막 끝남"].state, "done");
  const card = t.threads.find((x: any) => x.ts === "1793000000.000002");
  assert.equal(card.topic, ids["매출 보고"].id); assert.equal(card.needs, true); assert.equal(card.buttons, 2); assert.equal(card.channel, "primary");
  const mine = t.threads.find((x: any) => x.ts === root);
  assert.equal(mine.replies, 1); assert.equal(mine.last.text, "보고 있어요"); assert.equal(mine.who, "owner"); assert.equal(mine.needs, false);
  assert.ok(!JSON.stringify(t).includes("남의"));
  assert.deepEqual((await get(D1, B, "/api/topics")).topics.map((x: any) => x.title), ["남의 일"]);
});

test("약속: 창이 promise_add → data().promises(주인 꼴) · 그 노드 판, 기한 지나면 to_check, promise_done 으로 닫힘, 남의 약속은 못 닫음, 주인 길엔 없는 도구", async () => {
  const { D1, node } = setup();
  node(A, "n-1", "매출 보고", "working", "보고 창");
  const tools = localTools(D1, A, "보고 창", "https://example.invalid");
  const ctx = { agent: "t", publicUrl: "https://example.invalid", view: { visible: () => true, why: () => null, desc: () => "", mask: () => false }, get: async () => ({}), op: async () => ({}), local: tools };
  const a1 = await run(ctx as never, "promise_add", { who: "팀장님", what: "배포 끝나면 알려 드림", check: "배포 런 끝", due: "2099-01-01" }) as any;
  const a2 = await run(ctx as never, "promise_add", { who: "동료", what: "지난 일 결과", check: "결과 글", due: "2020-01-01 09:00" }) as any;
  assert.ok(a1.promise_id > 0 && a2.promise_id > a1.promise_id);
  await assert.rejects(run(ctx as never, "promise_add", { who: "x", what: "-옵션", check: "c", due: "d" }), /입력이 맞지 않음/);
  let d = await MB.data(D1, A, null);
  const pane = d.panes.find((p: any) => p.win === "매출 보고").pane;
  assert.equal(d.promises.length, 2);
  const p1 = d.promises.find((p: any) => p.n === a1.promise_id);
  assert.deepEqual(Object.keys(p1).sort(), ["due", "n", "pane", "panes", "short", "title", "to", "watch", "what"]);
  assert.equal(p1.pane, pane); assert.equal(p1.to, "팀장님"); assert.equal(p1.watch, "배포 런 끝");
  assert.deepEqual(d.to_check.map((x: any) => x.id), ["p" + a2.promise_id]);
  assert.match(d.to_check[0].why, /기한/);
  assert.equal((await MB.data(D1, B, null)).promises.length, 0);
  // 남의 약속 · 없는 약속은 못 닫음
  const tb = localTools(D1, B, "남 창", "https://example.invalid");
  await assert.rejects(tb("promise_done", { promise_id: a1.promise_id, done: "x", state: "kept" }), /없는 약속/);
  assert.deepEqual(await run(ctx as never, "promise_done", { promise_id: a2.promise_id, done: "결과 보냄" }), { ok: true });
  await assert.rejects(run(ctx as never, "promise_done", { promise_id: a2.promise_id, done: "또" }), /없는 약속/);
  d = await MB.data(D1, A, null);
  assert.deepEqual(d.promises.map((p: any) => p.n), [a1.promise_id]); assert.deepEqual(d.to_check, []);
  const all = await run(ctx as never, "promise_list", { all: true }) as any;
  assert.equal(all.promises.length, 2); assert.equal(all.promises.find((p: any) => p.promise_id === a2.promise_id).state, "kept");
  // 주인 창(ctx.local 없음)은 다리로 안 감 — 회원 보드 전용
  await assert.rejects(run({ ...ctx, local: undefined } as never, "promise_add", { who: "a", what: "b", check: "c", due: "2099-01-01" }), /회원 보드 전용/);
});

test("기한 판정: 날짜 · 날짜+시각(한국 시각), 날짜 꼴이 아니면 판정 안 함", () => {
  const t = Date.parse("2026-11-02T10:00:00+09:00");
  assert.equal(MV.overdue("2026-11-01", t), true);
  assert.equal(MV.overdue("2026-11-02", t), false);
  assert.equal(MV.overdue("2026-11-02 09:30", t), true);
  assert.equal(MV.overdue("2026-11-02 10:30", t), false);
  assert.equal(MV.overdue("다음 배포 뒤", t), false);
});

test("뜻 찾기(sem=1): 낱말로 안 걸린 내 글을 뜻으로 sem 1, 남의 글은 안 봄, 다시 찾으면 벡터 기억, AI 실패면 낱말 답 그대로", async () => {
  const { D1, now, node, line } = setup();
  node(A, "n-1", "매출 보고", "working", "보고 창");
  line(A, "보고 창", "progress", "분기 결산서 정리", now - H);
  line(A, "보고 창", "progress", "점심 메뉴 고르기", now - H);
  line(B, "남 창", "progress", "결산 남의 글", now - H);
  // 가짜 임베딩: 「매출 · 결산」 들어간 글은 한 쪽, 아니면 다른 쪽
  let calls = 0, texts = 0;
  const ai = { run: async (_m: string, i: { text: string[] }) => { calls++; texts += i.text.length; return { data: i.text.map(t => /매출|결산/.test(t) ? [1, 0, 0] : [0, 1, 0]) }; } };
  const lex = await MS.query(D1, A, "매출", {});
  assert.ok(!lex.chats.some((c: any) => c.text.includes("결산")));   // 낱말로는 안 걸림
  const r = await MS.query(D1, A, "매출", { sem: true, ai });
  const hit = r.chats.find((c: any) => c.text.includes("분기 결산서"));
  assert.ok(hit && hit.sem === 1, "뜻으로 걸린 글");
  assert.ok(!r.chats.some((c: any) => c.text.includes("점심")));
  assert.ok(!JSON.stringify(r).includes("남의 글"));
  const first = texts;
  await MS.query(D1, A, "매출", { sem: true, ai });
  assert.equal(texts - first, 1, "두 번째엔 질의만 임베딩");
  assert.equal(calls, 2);
  const bad = await MS.query(D1, A, "매출", { sem: true, ai: { run: async () => { throw new Error("한도"); } } });
  assert.equal(bad.ms.emb_err, 1); assert.deepEqual(bad.chats, lex.chats);
  // route: 주인은 주인 색인, 회원은 sem · ai 를 넘김
  let owner = 0;
  await MS.route({ owner: true, me: A, q: "매출", db: D1, sem: true, ai, ownerSearch: async () => { owner++; return {}; } });
  assert.equal(owner, 1);
  const viaRoute = await MS.route({ owner: false, me: A, q: "매출", db: D1, sem: true, ai, ownerSearch: async () => { throw new Error("주인 색인을 부름"); } }) as any;
  assert.ok(viaRoute.chats.some((c: any) => c.sem === 1));
});

function timed(D1: D1Database, fail?: (sql: string) => boolean) {
  type S = { sql: string; base: D1PreparedStatement };
  const trace: { wave: number; sql: string }[] = [];
  let wave = 0, pending: (() => void)[] = [], armed = false;
  const later = <T>(statements: S[], fn: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    pending.push(() => {
      trace.push(...statements.map(s => ({ wave, sql: s.sql })));
      if (statements.some(s => fail?.(s.sql))) return reject(new Error("synthetic query failure"));
      fn().then(resolve, reject);
    });
    if (!armed) { armed = true; setTimeout(() => { armed = false; wave++; const batch = pending; pending = []; batch.forEach(run => run()); }, 0); }
  });
  const statement = (sql: string, base = D1.prepare(sql)): any => ({ sql, base,
    bind: (...args: unknown[]) => statement(sql, base.bind(...args)),
    all: () => later([{ sql, base }], () => base.all()),
    first: () => later([{ sql, base }], () => base.first()),
    run: () => later([{ sql, base }], () => base.run()),
  });
  const db = { prepare: (sql: string) => statement(sql), batch: (ss: S[]) => later(ss, () => D1.batch(ss.map(s => s.base))) } as unknown as D1Database;
  return { db, trace, waves: () => wave };
}

function topicFixture() {
  const s = setup();
  s.node(A, "tk_work", "매출 보고", "working", "보고 창");
  s.node(A, "n-park", "쉬는 일", "parked", "쉬는 창");
  s.node(A, "n-done", "막 끝남", "done", "끝 창");
  s.node(B, "n-other", "남의 일", "working", "남 창");
  const card = "1793000000.000002";
  s.db.prepare("INSERT INTO board_card(id, owner, win, question, choices, state, at) VALUES (?,?,?,?,?,?,?)").run(card, A, "보고 창", "고를 것", '["가","나"]', "open", s.now - H);
  s.line(A, "보고 창", "reply", "카드에 온 답", s.now - 1000, card);
  const root = s.line(A, "나", "chat", "내 Primary 글", s.now - 2 * H, "primary");
  s.line(A, "메인 봇", "say", "Primary 답", s.now - 500, "p:" + root);
  s.line(B, "남 창", "say", "남의 답", s.now - 100, "p:" + root);
  return { ...s, card, root };
}

test("topics 병렬 읽기: load 뒤 보조 조회·카드·뿌리, ID 의존 답글은 다음 단계. 4단계·결과·회원 경계 유지", async () => {
  const s = topicFixture(), m = timed(s.D1), out = await get(m.db, A, "/api/topics");
  assert.equal(m.waves(), 4);
  const extra = m.trace.filter(t => /SELECT id, task|SELECT COALESCE\(pinned_name|FROM member_promise|SELECT rowid AS n, id, win, kind, question, choices, body|thread = 'primary' AND at >/.test(t.sql));
  assert.equal(extra.length, 5); assert.ok(extra.every(t => t.wave === 3));
  const replies = m.trace.filter(t => /ORDER BY at \+ 0, id LIMIT 2000/.test(t.sql));
  assert.equal(replies.length, 2); assert.ok(replies.every(t => t.wave === 4));
  assert.equal(out.threads.find((x: any) => x.ts === s.card).last.text, "카드에 온 답");
  assert.equal(out.threads.find((x: any) => x.ts === s.root).last.text, "Primary 답");
  assert.equal(out.threads.length, 2); assert.ok(!JSON.stringify(out).includes("남의"));
  assert.deepEqual(out.topics.map((x: any) => x.title).sort(), ["막 끝남", "매출 보고", "쉬는 일"]);
});

test("topics 빈 목록: 답글 질의 생략, 만료 연결 카드는 먼저 닫고 읽음", async () => {
  const s = setup(), m = timed(s.D1);
  assert.deepEqual((await get(m.db, A, "/api/topics")).threads, []);
  assert.ok(!m.trace.some(t => /ORDER BY at \+ 0, id LIMIT 2000/.test(t.sql)));
  s.db.prepare("INSERT INTO board_card(id, owner, win, kind, question, choices, state, at) VALUES (?,?,?,?,?,?,?,?)").run("1793000000.000004", A, "보고 창", "connect:synthetic", "연결", '["연결"]', "open", s.now - H);
  const m2 = timed(s.D1), got = await get(m2.db, A, "/api/topics");
  assert.equal(s.db.prepare("SELECT state FROM board_card WHERE id=?").get("1793000000.000004")?.state, "closed");
  assert.equal(got.threads[0].needs, false);
  assert.ok(m2.trace.find(t => /UPDATE board_card/.test(t.sql))!.wave < m2.trace.find(t => /choices, body, state/.test(t.sql))!.wave);
});

test("topics 오류: task·약속의 빈 결과 폴백 유지, 필수 조회 오류는 받은 응답으로 숨기지 않음", async () => {
  for (const pattern of [/SELECT id, task/, /FROM member_promise/]) {
    const s = topicFixture(), m = timed(s.D1, sql => pattern.test(sql));
    const out = await get(m.db, A, "/api/topics");
    assert.equal(out.threads.length, 2);
  }
  for (const pattern of [/SELECT COALESCE\(pinned_name/, /question, choices, body, state/, /thread = 'primary' AND at >/,
    /ORDER BY at \+ 0, id LIMIT 2000/]) {
    const s = topicFixture(), m = timed(s.D1, sql => pattern.test(sql));
    await assert.rejects(get(m.db, A, "/api/topics"), /synthetic query failure/);
  }
});

test("data API 순서 유지: tasks → 보관 이름 → 약속. topics에서만 병렬로 읽음", async () => {
  const s = setup(), m = timed(s.D1);
  await get(m.db, A, "/api/data");
  const task = m.trace.find(t => /SELECT id, task/.test(t.sql))!, archived = m.trace.find(t => /SELECT COALESCE\(pinned_name/.test(t.sql))!, promise = m.trace.find(t => /FROM member_promise/.test(t.sql))!;
  assert.ok(task.wave < archived.wave && archived.wave < promise.wave);
});
