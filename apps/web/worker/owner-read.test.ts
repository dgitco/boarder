// node --test --no-warnings apps/web/worker/owner-read.test.ts (Node 22.18+ 타입 지우기 · node:sqlite)
// 모아 보기(/api/inbox): D1 왕복 한 번 · 답은 고치기 전(5cda879)과 같은지 — 가짜 D1 = 메모리 SQLite(같은 SQL 을 그대로 돌림), 왕복 = prepare().all/first/run + batch 한 번씩 셈.
// 기대값 owner-read.test.inbox.json 은 고치기 전 owner-read.ts(+ index.ts 의 OS.get 초안 합치기)로 같은 자료에서 뽑은 것.
// INBOX_OLD=<옛 owner-read.ts 경로> 면 그 코드로도 바로 대조(왕복 수는 안 봄)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as OR from "./owner-read.ts";

const SCHEMA = `
create table wl_cards (ts TEXT PRIMARY KEY, channel TEXT, area TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, title TEXT, state TEXT NOT NULL DEFAULT 'open', thread TEXT, replaced_by TEXT, dup_of TEXT);
create table wl_log (id INTEGER PRIMARY KEY, at REAL NOT NULL, pane TEXT NOT NULL, kind TEXT NOT NULL, msg TEXT NOT NULL);
create table wl_talk_msg (id TEXT PRIMARY KEY, chan TEXT NOT NULL, thread TEXT, who TEXT NOT NULL, author TEXT, pane TEXT, text TEXT NOT NULL DEFAULT '', at REAL NOT NULL, deleted_at REAL, source TEXT NOT NULL DEFAULT 'web');
create table wl_talk_reaction (msg TEXT NOT NULL, emoji TEXT NOT NULL, who TEXT NOT NULL, at REAL, removed_at REAL, PRIMARY KEY (msg, emoji, who));
create table wl_talk_saved (who TEXT NOT NULL, msg TEXT NOT NULL, chan TEXT NOT NULL, thread TEXT NOT NULL DEFAULT '', at REAL NOT NULL, PRIMARY KEY (who, msg));
create table wl_talk_seen (who TEXT NOT NULL, chan TEXT NOT NULL, thread TEXT NOT NULL DEFAULT '', last_id TEXT, at REAL, PRIMARY KEY (who, chan, thread));
create table owner_state (k text primary key, v text not null, at integer not null, ver integer not null default 0, ord integer not null default 0);`;

const NOW = 1703400000, T1 = "1703300000.000100", T2 = "1703300001.000100";
const TALK_VER = readFileSync(new URL("../migrations/0083_talk_ver.sql", import.meta.url), "utf8");   // 운영처럼 번호 표 · 트리거(없으면 예전 질의로 한 번 더 — 왕복 둘)
function seed(db: DatabaseSync, state: "none" | "seeded" | "rows-only") {
  db.exec(SCHEMA); db.exec(TALK_VER);
  const m = db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  m.run(T1, "dgit", null, "owner", null, null, "루트 글 *굵게* <https://a.b|링크>", 1703300000.0001, null);
  m.run("1703300000.000200", "dgit", T1, "agent", "도우미", "p1", "답 1", 1703300000.0002, null);
  m.run("1703300000.000300", "dgit", T1, "agent", "도우미", "p1", "답 2   여러  칸", 1703300000.0003, null);
  m.run(T2, "primary", null, "agent", null, null, "둘째 루트", 1703300001.0001, null);
  m.run("1703300001.000200", "primary", T2, "agent", null, null, "둘째 답", 1703300001.0002, null);
  m.run("1703390000.000100", "company", null, "agent", "a", "p2", "새 글 " + "가".repeat(200), NOW - 10000, null);
  m.run("1703390001.000100", "company", null, "agent", null, null, "반응 단 글", NOW - 9000, null);
  m.run("1703000000.000100", "company", null, "agent", null, null, "오래된 글", NOW - 4 * 86400, null);
  m.run("1703390002.000100", "dgit", null, "agent", null, null, "지운 글 원문", NOW - 8000, NOW - 100);
  db.prepare("INSERT INTO wl_talk_seen(who, chan, thread, at) VALUES ('owner', 'primary', ?, ?)").run(T2, 1703300002);
  db.prepare("INSERT INTO wl_talk_reaction(msg, emoji, who, at) VALUES ('1703390001.000100', 'eyes', 'owner', ?)").run(NOW - 1);
  const s = db.prepare("INSERT INTO wl_talk_saved(who, msg, chan, thread, at) VALUES ('owner', ?, ?, ?, ?)");
  s.run("1703390000.000100", "company", "", NOW - 50); s.run("1703390002.000100", "dgit", "", NOW - 40); s.run("1703300000.000200", "dgit", T1, NOW - 30); s.run("1700000000.000001", "dgit", "", NOW - 20);
  const c = db.prepare("INSERT INTO wl_cards(ts, area, kind, ref, thread, replaced_by, dup_of) VALUES (?, 'a', 'k', ?, ?, ?, ?)");
  c.run("CARD1", null, T1, null, null);
  c.run("CARD2", null, null, "CARD3", null);
  c.run("CARD3", null, "", null, "w:7");
  c.run("w:7", null, null, null, null);
  c.run("w:8", null, "1703300001.000200", null, null);
  c.run("CARD4", "slack:REFX", T2, null, null);
  c.run("CARD5", "slack:REFY", T1, null, null);
  c.run("CARD6", "mail:REFY", T1, null, null);
  c.run("LOOP1", null, null, "LOOP2", null);
  c.run("LOOP2", null, null, "LOOP1", "LOOP1");
  db.prepare("INSERT INTO wl_log(id, at, pane, kind, msg) VALUES (7, 1, 'p', 'k', ?)").run("스레드 없음 · 스레드 1703300000.000100 에 답");
  if (state === "none") return;
  if (state === "seeded") db.prepare("INSERT INTO owner_state(k, v, at, ver) VALUES ('drafts', '{}', 1, 3)").run();
  const o = db.prepare("INSERT INTO owner_state(k, v, at, ver, ord) VALUES (?, ?, 1, 1, ?)");
  o.run("drafts:card:CARD2", JSON.stringify({ text: "D1 카드 초안", at: 1703399500000 }), 1);
  o.run("drafts:th:" + T2, JSON.stringify({ text: "D1 스레드 초안", at: 1703399600000 }), 0);
  o.run("drafts:chan:company", JSON.stringify({ text: "D1 채널", at: 1703399700000 }), 2);
}
const DRAFTS = {
  "chan:dgit": { text: "채널 초안", at: 1703399000000 },
  [`th:${T1}`]: { text: "스레드 초안", at: 1703399100000 },
  "th:9999999999.000000": { text: "없는 스레드", at: 1703399200000 },
  "card:1703300001.000200": { text: "글 ts 카드", at: 1703399300000 },
  "card:x|CARD1": { text: "카드 스레드", at: 1703399310000 },
  "card:CARD2": { text: "바뀐 카드 → 중복 → 일지", at: 1703399320000 },
  "card:w8": { text: "w 숫자", at: 1703399330000 },
  "card:REFX": { text: "ref 하나", at: 1703399340000 },
  "card:REFY": { text: "ref 둘", at: 1703399350000 },
  "card:LOOP1": { text: "돌고 도는 카드", at: 1703399355000 },
  "card:a|": { text: "끝이 |", at: 1703399360000 },
  "card:CARD1": { text: "   ", at: 1703399370000 },
  "foo:bar": { text: "모르는 칸", at: 1703399380000 },
};
const CFG: OR.Cfg = { channels: { dgit: "C1", primary: "C2", company: "C3" }, drafts: DRAFTS };

// 가짜 D1: SQLite 위에 prepare · bind · all · first · run · batch. 왕복 = 바깥에서 부른 all · first · run · batch 수
function fakeD1(db: DatabaseSync) {
  const n = { round: 0 };
  const plain = (o: unknown) => ({ ...(o as object) }) as Record<string, unknown>;
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a.map(x => typeof x === "boolean" ? Number(x) : x)),
    rows: () => db.prepare(sql).all(...(args as never[])).map(plain),
    async all() { n.round++; return { results: this.rows(), success: true, meta: {} }; },
    async first() { n.round++; return this.rows()[0] ?? null; },
    async run() { n.round++; db.prepare(sql).run(...(args as never[])); return { success: true, meta: {} }; },
  });
  const d1 = { prepare: (sql: string) => stmt(sql), async batch(sts: ReturnType<typeof stmt>[]) { n.round++; return sts.map(s => ({ results: s.rows(), success: true, meta: {} })); } };
  return { d1: d1 as unknown as D1Database, n };
}

const CASES = [["cfg 초안", "none", false], ["write_state 켬 · D1 초안", "seeded", true], ["write_state 켬 · 아직 안 올림(cfg 초안)", "rows-only", true], ["write_state 꺼짐 · D1 줄 있음(cfg 초안)", "seeded", false]] as const;
const want = JSON.parse(readFileSync(new URL("./owner-read.test.inbox.json", import.meta.url), "utf8")) as Record<string, unknown>;

for (const [name, state, on] of CASES) {
  test(`모아 보기 ${name}: D1 왕복 1번 · 답이 고치기 전과 같음`, async () => {
    const db = new DatabaseSync(":memory:"); seed(db, state);
    const { d1, n } = fakeD1(db);
    const o = await OR.build(d1, CFG, { group: "cards", kind: "inbox" }, NOW, true, on);
    assert.equal(n.round, 1);
    assert.deepEqual(o, want[name]);
    if (process.env.INBOX_OLD) assert.deepEqual(o, await oldInbox(db, on));
  });
}
test("모아 보기 respond: 같은 몸통이면 304, 왕복 1번", async () => {
  const db = new DatabaseSync(":memory:"); seed(db, "seeded");
  const { d1, n } = fakeD1(db), get = async () => ({ body: JSON.stringify(CFG), etag: "e1" });
  const r1 = await OR.respond(d1, get, { group: "cards", kind: "inbox" }, undefined, true);
  assert.equal(r1?.status, 200); assert.equal(n.round, 1);
  const r2 = await OR.respond(d1, get, { group: "cards", kind: "inbox" }, r1!.headers.get("etag")!, true);
  assert.equal(r2?.status, 304); assert.equal(n.round, 2);
});

// 옛 길: index.ts 가 OS.get(drafts) 로 읽어 cfg 초안을 바꿔 끼운 뒤 build
async function oldInbox(db: DatabaseSync, on: boolean) {
  const old = await import(process.env.INBOX_OLD!) as typeof OR, OS = await import("./owner-state.ts");
  const { d1 } = fakeD1(db), st = on ? await OS.get(d1, "drafts").catch(() => null) : null;
  return old.build(d1, st ? { ...CFG, drafts: st.v } : CFG, { group: "cards", kind: "inbox" }, NOW);
}
if (process.env.INBOX_DUMP) {   // 기대값 다시 뽑기: INBOX_OLD=<옛 owner-read.ts> INBOX_DUMP=<쓸 파일>
  const out: Record<string, unknown> = {};
  for (const [name, state, on] of CASES) { const db = new DatabaseSync(":memory:"); seed(db, state); out[name] = await oldInbox(db, on); }
  writeFileSync(process.env.INBOX_DUMP, JSON.stringify(out, null, 1) + "\n");
}

test("등록한 에이전트 채널 키도 채팅 길(있는지는 build 가 cfg.channels 로 — 없으면 null 로 다리)", async () => {
  assert.deepEqual(OR.route("/api/chat/harness"), { group: "chat", kind: "channel", a: "harness", b: undefined });
  assert.deepEqual(OR.route("/api/chat/harness/1703300000.000100"), { group: "chat", kind: "thread", a: "harness", b: "1703300000.000100" });
  assert.deepEqual(OR.route("/api/chat/company"), { group: "chat", kind: "channel", a: "company", b: undefined });   // 기본 다섯은 그대로
  assert.equal(OR.route("/api/chat/Harness"), null);
  assert.equal(OR.route("/api/chat/x"), null);
  const { d1, n } = fakeD1(new DatabaseSync(":memory:"));
  assert.equal(await OR.build(d1, { channels: { primary: "CPRI" } }, OR.route("/api/chat/harness")!), null);   // 등록 전(cfg 에 없음) → D1 안 묻고 다리로
  assert.equal(n.round, 0);
});

test("시스템 글(원문 raw 없음)도 글쓴이가 화면에 나옴 — 에이전트 글과 같은 꼴로, 글쓴이가 없으면 예전 그대로", async () => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const m = db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cli')");
  m.run("1703390100.000100", "primary", null, "system", "보더", null, "기기 「내 노트북」가 화면 덧씌우기를 바꿨어요", NOW - 100);
  m.run("1703390101.000100", "primary", null, "system", null, null, "글쓴이 없는 시스템 글", NOW - 90);
  m.run("1703390102.000100", "primary", null, "agent", "도우미", "p1", "에이전트 글", NOW - 80);
  db.prepare("INSERT INTO wl_talk_chan(id, name, slack_channel) VALUES ('primary', 'primary', 'C2')").run();
  const { d1 } = fakeD1(db);
  const o = await OR.build(d1, CFG, OR.route("/api/chat/primary")!, NOW) as { status: number; body: { messages: { ts: string; name: string }[] } };
  assert.equal(o.status, 200);
  const name = (ts: string) => o.body.messages.find(x => x.ts === ts)?.name;
  assert.equal(name("1703390100.000100"), "보더", "「비서」가 아니라 글쓴이 이름");
  assert.equal(name("1703390101.000100"), "비서", "글쓴이가 없으면 예전 그대로");
  assert.equal(name("1703390102.000100"), "도우미", "에이전트 글은 그대로");
});

test("#메인 합쳐 보기(/api/chat/main): 다섯 채널 뿌리 글을 시간순 한 줄기 · 글마다 진짜 채널 · 왕복은 채널 하나와 같음", async () => {
  assert.deepEqual(OR.route("/api/chat/main"), { group: "chat", kind: "channel", a: "main", b: undefined });
  assert.deepEqual(OR.route("/api/chat/main?before=1703390102.000100"), { group: "chat", kind: "channel", a: "main", b: "1703390102.000100" });
  assert.equal(OR.route("/api/chat/main/1703390102.000100"), null, "스레드는 그 글의 진짜 채널 길로");
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const cfg: OR.Cfg = { channels: { primary: "C2", company: "C3", dgit: "C1", personal: "C4", shop: "C5", harness: "C9" } };
  for (const [k, sc] of Object.entries(cfg.channels)) db.prepare("INSERT INTO wl_talk_chan(id, name, slack_channel) VALUES (?, ?, ?)").run(k, k, sc);
  const m = db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cli')");
  m.run("1703390100.000100", "company", null, "agent", "a", null, "회사 글", 1703390100.0001);
  m.run("1703390101.000100", "primary", null, "owner", null, null, "메인 글", 1703390101.0001);
  m.run("1703390101.000200", "primary", "1703390101.000100", "agent", "a", null, "메인 답(줄기엔 안 옴)", 1703390101.0002);
  m.run("1703390102.000100", "dgit", null, "agent", "a", null, "디지트 글", 1703390102.0001);
  m.run("1703390103.000100", "harness", null, "agent", "a", null, "에이전트 채널 글(줄기엔 안 옴)", 1703390103.0001);
  m.run("1703390104.000100", "shop", null, "agent", "a", null, "가게 글", 1703390104.0001);
  const { d1, n } = fakeD1(db);
  type O = { status: number; body: { channel: string; more: boolean; cursor: string; messages: { ts: string; ch?: string; replies: number }[] } };
  const o = await OR.build(d1, cfg, OR.route("/api/chat/main")!, NOW) as O;
  const rMain = n.round; n.round = 0;
  assert.equal(o.status, 200);
  assert.equal(o.body.channel, "main");
  assert.deepEqual(o.body.messages.map(x => [x.ts, x.ch]), [["1703390100.000100", "company"], ["1703390101.000100", "primary"], ["1703390102.000100", "dgit"], ["1703390104.000100", "shop"]]);
  assert.equal(o.body.messages[1].replies, 1, "답 수는 채널 보기와 같음");
  const one = await OR.build(d1, cfg, OR.route("/api/chat/primary")!, NOW) as O;
  assert.equal(n.round, rMain, "왕복 수 = 채널 하나 읽기와 같음");
  assert.equal(one.body.messages[0].ch, undefined, "채널 하나 보기 꼴은 그대로(ch 없음)");
  const old = await OR.build(d1, cfg, OR.route("/api/chat/main?before=1703390102.000100")!, NOW) as O;
  assert.deepEqual(old.body.messages.map(x => x.ch), ["company", "primary"], "옛 글 쪽(커서)도 채널을 가로질러");
  assert.equal(await OR.build(d1, { channels: { harness: "C9" } }, OR.route("/api/chat/main")!, NOW), null, "기본 채널이 하나도 없으면 다리로");
});

test("모아 보기 스레드 읽지 않음 맡김: 번호가 같으면 답글 훑기 질의를 안 보냄 · 답글 · 읽음이 들어오면 새 줄 · 답은 그대로", async () => {
  OR.unreadForget();
  const db = new DatabaseSync(":memory:"); seed(db, "none");
  const { d1 } = fakeD1(db); let scans = 0;
  const spy = { prepare: (sql: string) => { if (/FROM wl_talk_msg r WHERE r\.thread IS NOT NULL/.test(sql)) scans++; return (d1 as any).prepare(sql); }, batch: (s: any[]) => (d1 as any).batch(s) } as unknown as D1Database;
  const a = await OR.build(spy, CFG, { group: "cards", kind: "inbox" }, NOW, true, false);
  const b = await OR.build(spy, CFG, { group: "cards", kind: "inbox" }, NOW, true, false);
  assert.equal(scans, 1, "두 번째는 맡긴 줄"); assert.deepEqual(b, a);
  const th = (db.prepare("SELECT thread FROM wl_talk_msg WHERE thread IS NOT NULL LIMIT 1").get() as { thread: string } | undefined)?.thread || T1;
  db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at) VALUES (?,?,?,?,?,?,?,?)").run("1703399999.000100", "dgit", th, "agent", "에이전트", "", "새 답", 1703399999.0001);
  const c = await OR.build(spy, CFG, { group: "cards", kind: "inbox" }, NOW, true, false) as any;
  assert.equal(scans, 2, "답글이 들어오면 번호가 올라 다시 훑음");
  assert.ok(JSON.stringify(c.body.unread).includes("새 답"), "새 답글이 읽지 않음에");
  db.prepare("INSERT INTO wl_talk_seen(who, chan, thread, last_id, at) VALUES ('owner', 'dgit', ?, '1703399999.000100', 1703399999.5) ON CONFLICT(who, chan, thread) DO UPDATE SET at = excluded.at").run(th);
  const d = await OR.build(spy, CFG, { group: "cards", kind: "inbox" }, NOW, true, false) as any;
  assert.equal(scans, 3, "읽음이 들어와도 다시"); assert.ok(!JSON.stringify(d.body.unread).includes("새 답"), "읽은 스레드는 빠짐");
});

test("모아 보기: 번호 표가 없으면(이주 전) 예전 질의로 한 번 더 — 답은 그대로", async () => {
  OR.unreadForget();
  const db = new DatabaseSync(":memory:"); db.exec(SCHEMA);
  const ref = new DatabaseSync(":memory:"); seed(ref, "none");
  for (const t of ["wl_cards", "wl_log", "wl_talk_msg", "wl_talk_reaction", "wl_talk_saved", "wl_talk_seen", "owner_state"]) for (const r of ref.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]) { const k = Object.keys(r); db.prepare(`INSERT INTO ${t}(${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(Object.values(r) as never[])); }
  const { d1 } = fakeD1(db);
  const throwing = { prepare: (sql: string) => (d1 as any).prepare(sql), batch: (s: any[]) => s.some((x: any) => /talk_ver/.test(String(x.sql ?? x.q ?? ""))) ? Promise.reject(new Error("D1_ERROR: no such table: talk_ver: SQLITE_ERROR")) : (d1 as any).batch(s) } as unknown as D1Database;
  const o = await OR.build(throwing, CFG, { group: "cards", kind: "inbox" }, NOW, true, false);
  assert.deepEqual(o, want["cfg 초안"]);
});

test("모아 보기 카드 사슬 질의: 대화 표를 통째로 훑지 않음(CROSS JOIN 으로 묶는 순서 고정)", () => {
  const db = new DatabaseSync(":memory:"); seed(db, "seeded");
  const src = readFileSync(new URL("./owner-read.ts", import.meta.url), "utf8");
  const dk = /const DKEYS = "(.*?)";/.exec(src)![1], sql = /const CARD_SQL = `([\s\S]*?)`;/.exec(src)![1].replace("${DKEYS}", dk);
  const plan = (db.prepare("EXPLAIN QUERY PLAN " + sql).all("[]", 1) as { detail: string }[]).map(r => r.detail);
  assert.ok(!plan.some(d => /^SCAN t\b/.test(d)), "대화 표 통째 훑기 없음: " + plan.join(" | "));
});
