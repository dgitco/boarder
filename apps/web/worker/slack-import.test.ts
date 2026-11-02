// node --test --no-warnings --experimental-transform-types apps/web/worker/slack-import.test.ts (Node 22.18+ · node:sqlite · hono · zod 는 apps/web 의존성)
// 옛 Slack 글 들여오기(slack-import.ts) 경계: 기기 토큰 주인 것만 씀 · 남의 노드는 못 읽음 · 같은 ts 두 번 → 한 줄 · 묶음 · 몸통 · 하루 상한 ·
// 봉투 스위치를 켜면 D1 에 평문이 없음 · 묶기(regroup)가 Slack 노드를 보관하지 않음. 가짜 D1 = 메모리 SQLite + migrations 전부, 자료 · 키는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const S = await import("./slack-import.ts");
const { regroup } = await import("./importer/routes.ts");
const { _resetVaultCache } = await import("./vault/index.ts");
const { Hono } = await import("hono");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; };
  const isRead = (sql: string) => /^\s*select/i.test(sql);
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => run1(sql, args),
  });
  const batch = async (ss: any[]) => {
    db.exec("BEGIN");
    try { const out = ss.map(s => isRead(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database };
}

const A = "alice@example.com", B = "bob@example.com";
const KEK = Buffer.from(new Uint8Array(32).map((_, i) => i * 7 + 3)).toString("base64");   // 지어낸 시험 키
function setup(opt: { envelope?: boolean } = {}) {
  _resetVaultCache();
  const { db, D1 } = d1();
  if (opt.envelope) db.prepare("INSERT INTO f7_flag(name, on_at, note) VALUES ('envelope', 1, 'test') ON CONFLICT(name) DO UPDATE SET on_at = 1").run();
  const env = { DB: D1, PUBLIC_URL: "https://example.test", DATA_KEK_CUR: "1", DATA_KEK_1: KEK };
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  // 기기 토큰 → 주인: 「tokA」= A 기기, 「tokB」= B 기기, 그 밖 = 없음(401)
  S.mountSlackImport(a, { device: async c => { const t = (c.req.header("authorization") || "").replace(/^Bearer\s+/, ""); return t === "tokA" ? { id: "devA", owner: A } : t === "tokB" ? { id: "devB", owner: B } : null; } });
  const post = (tok: string, body: unknown, raw?: string) => a.request("/api/me/import/slack", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: raw ?? JSON.stringify(body) }, env);
  const get = async (me: string, path: string) => { const r = await S.get(env as never, me, new URL("https://example.test" + path)); return r ? { status: r.status, body: await r.json() as any } : null; };
  return { db, env, post, get };
}
const CH = { id: "C0TEST0001", name: "general", workspace: "Example HQ", is_private: false, topic: "지어낸 채널" };
const msg = (sec: number, text: string, o: Record<string, unknown> = {}) => ({ ts: `${1700000000 + sec}.000100`, user: "U0EXAMPLE1", user_name: "가상 직원", text, ...o });

test("기기 토큰 없으면 401 · 쓴 줄 주인은 몸통이 아니라 토큰 주인", async () => {
  const { db, post } = setup();
  assert.equal((await post("nope", { channel: CH, messages: [msg(1, "안녕")] })).status, 401);
  assert.equal((db.prepare("SELECT count(*) n FROM slack_msg").get() as any).n, 0);
  // 몸통에 owner 를 넣어도 무시 — B 토큰으로 「A 것」이라 우겨도 B 줄
  const r = await post("tokB", { owner: A, channel: CH, messages: [msg(1, "B 의 글")] });
  assert.equal(r.status, 200);
  assert.deepEqual(db.prepare("SELECT owner FROM slack_msg").all().map((x: any) => x.owner), [B]);
  assert.equal((db.prepare("SELECT count(*) n FROM mnode WHERE owner = ?").get(A) as any).n, 0);
});

test("남의 Slack 노드는 못 읽음 — 노드 채팅은 내 것 아님(null), 채널 · 스레드 주소는 빈 꼴", async () => {
  const { post, get } = setup();
  const j = await (await post("tokA", { channel: CH, messages: [msg(1, "A 비밀 아닌 글"), msg(2, "답", { thread_ts: "1700000001.000100" })] })).json() as any;
  assert.ok(j.ok && /^sl_[0-9a-f]{12}$/.test(j.node));
  const mine = await get(A, `/api/nodechat?w=${encodeURIComponent(j.name)}`);
  assert.equal(mine!.body.messages.length, 1);
  assert.equal(await get(B, `/api/nodechat?w=${encodeURIComponent(j.name)}`), null);
  const ch = await get(B, `/api/chat/${j.node}`), th = await get(B, `/api/chat/${j.node}/1700000001.000100`);
  assert.deepEqual([ch!.body.messages.length, th!.body.messages.length], [0, 0]);
});

test("같은 ts 두 번(다시 돌림 · 같은 묶음 안) → 한 줄", async () => {
  const { db, post } = setup();
  const r1 = await (await post("tokA", { channel: CH, messages: [msg(1, "첫 글"), msg(1, "첫 글 다시"), msg(2, "둘째")] })).json() as any;
  assert.deepEqual([r1.inserted, r1.channel_total], [2, 2]);
  const r2 = await (await post("tokA", { channel: CH, messages: [msg(1, "첫 글"), msg(2, "둘째"), msg(3, "셋째")] })).json() as any;
  assert.deepEqual([r2.inserted, r2.skipped, r2.channel_total], [1, 2, 3]);
  assert.equal((db.prepare("SELECT count(*) n FROM slack_msg WHERE owner = ?").get(A) as any).n, 3);
  assert.equal((db.prepare("SELECT text FROM slack_msg WHERE ts = '1700000001.000100'").get() as any).text, "첫 글");   // 먼저 들어간 것을 덮지 않음
  // 다른 채널의 같은 ts 는 다른 글
  await post("tokA", { channel: { ...CH, id: "C0TEST0002", name: "random" }, messages: [msg(1, "다른 채널")] });
  assert.equal((db.prepare("SELECT count(*) n FROM slack_msg WHERE owner = ?").get(A) as any).n, 4);
});

test("상한: 묶음 500 넘음 400 · 몸통 413 · 하루 상한 429(겹친 글은 상한을 안 먹음)", async () => {
  const { db, post } = setup();
  const many = Array.from({ length: S.LIMITS.batch + 1 }, (_, i) => msg(i, "x"));
  assert.equal((await post("tokA", { channel: CH, messages: many })).status, 400);
  assert.equal((await post("tokA", null, JSON.stringify({ channel: CH, messages: [msg(1, "y".repeat(S.LIMITS.body))] }))).status, 413);
  const day = S.LIMITS.day;
  S.LIMITS.day = 3;
  try {
    assert.equal((await post("tokA", { channel: CH, messages: [msg(1, "a"), msg(2, "b")] })).status, 200);
    const over = await post("tokA", { channel: CH, messages: [msg(3, "c"), msg(4, "d")] });
    assert.equal(over.status, 429);
    assert.equal(((await over.json()) as any).left, 1);
    assert.equal((await post("tokA", { channel: CH, messages: [msg(1, "a"), msg(2, "b"), msg(3, "c")] })).status, 200);   // 겹친 둘 + 새 하나 = 상한 안
    assert.equal((db.prepare("SELECT count(*) n FROM slack_msg").get() as any).n, 3);
    assert.equal((await post("tokB", { channel: CH, messages: [msg(1, "a"), msg(2, "b")] })).status, 200);   // 상한은 사람마다
  } finally { S.LIMITS.day = day; }
});

test("이상한 글 하나는 그 글만 버림 · 비밀값 꼴은 가림", async () => {
  const { db, post } = setup();
  const r = await (await post("tokA", { channel: CH, messages: [msg(1, "토큰 xoxb-1234567890-abcdefghij 붙임"), { ts: "bad", text: "꼴 틀림" }] })).json() as any;
  assert.deepEqual([r.inserted, r.bad], [1, 1]);
  assert.equal((db.prepare("SELECT text FROM slack_msg").get() as any).text, "토큰 [가림] 붙임");
});

test("노드: 채널 하나 = 노드 하나, 같은 이름은 (워크스페이스) · 스레드는 뿌리 아래로", async () => {
  const { db, post, get } = setup();
  const a = await (await post("tokA", { channel: CH, messages: [msg(1, "뿌리", { files: [{ name: "가상.pdf", permalink: "https://example.slack.com/files/x" }], reactions: [{ name: "eyes", count: 2 }] }), msg(5, "답 하나", { thread_ts: "1700000001.000100", user_name: "가상 팀장" }), msg(9, "보통 글")] })).json() as any;
  const b = await (await post("tokA", { channel: { ...CH, id: "C0TEST0003", workspace: "Other WS" }, messages: [msg(1, "다른 워크스페이스 general")] })).json() as any;
  assert.equal(a.name, "Slack · #general");
  assert.equal(b.name, "Slack · #general (Other WS)");
  assert.equal((db.prepare("SELECT count(*) n FROM mnode WHERE owner = ? AND id LIKE 'sl_%'").get(A) as any).n, 2);
  const nc = (await get(A, `/api/nodechat?w=${encodeURIComponent(a.name)}`))!.body;
  assert.deepEqual(nc.messages.map((m: any) => [m.ts, m.replies, m.ch]), [["1700000001.000100", 1, a.node], ["1700000009.000100", 0, a.node]]);
  assert.match(nc.messages[0].text, /📎 가상\.pdf https:\/\/example\.slack\.com/);
  assert.deepEqual(nc.messages[0].rnames, ["가상 팀장"]);
  const th = (await get(A, `/api/chat/${a.node}/1700000001.000100`))!.body;
  assert.deepEqual(th.messages.map((m: any) => [m.text.split("\n")[0], m.thread]), [["뿌리", null], ["답 하나", "1700000001.000100"]]);
});

test("봉투 스위치 켜짐: D1 에 글 평문이 없고 화면은 같은 글", async () => {
  const { db, post, get } = setup({ envelope: true });
  const a = await (await post("tokA", { channel: CH, messages: [msg(1, "지어낸 봉할 글", { files: [{ name: "지어낸파일.txt", permalink: "" }] })] })).json() as any;
  const dump = JSON.stringify(db.prepare("SELECT * FROM slack_msg").all());
  assert.ok(!dump.includes("지어낸 봉할 글") && !dump.includes("지어낸파일"), "평문이 남음");
  assert.match((db.prepare("SELECT text FROM slack_msg").get() as any).text, /^v2\.1\./);
  const nc = (await get(A, `/api/nodechat?w=${encodeURIComponent(a.name)}`))!.body;
  assert.equal(nc.messages[0].text, "지어낸 봉할 글\n📎 지어낸파일.txt");
});

test("묶기(regroup)는 Slack 노드를 보관하지도 이름을 바꾸지도 않음", async () => {
  const { db, env, post } = setup();
  const a = await (await post("tokA", { channel: CH, messages: [msg(1, "x")] })).json() as any;
  await regroup(env as never, A);
  const n = db.prepare("SELECT name, state, archived_at FROM mnode WHERE owner = ? AND id = ?").get(A, a.node) as any;
  assert.deepEqual([n.name, n.state, n.archived_at], ["Slack · #general", "idle", null]);
});

test("스위치를 나중에 켜도: 옛 평문 줄을 vault 옮기기(slack_msg)가 봉하고 화면은 같은 글", async () => {
  const M = await import("./vault/migrate.ts");
  const { db, env, post, get } = setup();
  const a = await (await post("tokA", { channel: CH, messages: [msg(1, "지어낸 옛 평문"), msg(2, "답", { thread_ts: "1700000001.000100", files: [{ name: "가상.txt", permalink: "" }] })] })).json() as any;
  assert.equal((db.prepare("SELECT text FROM slack_msg WHERE ts = '1700000001.000100'").get() as any).text, "지어낸 옛 평문");
  db.prepare("INSERT INTO f7_flag(name, on_at, note) VALUES ('envelope', 1, 'test') ON CONFLICT(name) DO UPDATE SET on_at = 1").run();
  _resetVaultCache();
  const r = await M.run({ ...env, RESULTS: {} } as never, "slack_msg");
  assert.deepEqual([r.done, r.failed], [2, []]);
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM slack_msg").all()).includes("지어낸 옛 평문"));
  const th = (await get(A, `/api/chat/${a.node}/1700000001.000100`))!.body;
  assert.deepEqual(th.messages.map((m: any) => m.text), ["지어낸 옛 평문", "답\n📎 가상.txt"]);
});

test("같은 이름의 다른 노드가 있으면 그 노드 채팅이 이김 · 채널 수 상한은 429 + max_channels", async () => {
  const { db, post, get } = setup();
  const a = await (await post("tokA", { channel: CH, messages: [msg(1, "slack 글")] })).json() as any;
  db.prepare("INSERT INTO mnode(owner, id, name, pinned_name, created_at, updated_at) VALUES (?, 'n_other', 'x', ?, 1, 1)").run(A, a.name);
  assert.equal(await get(A, `/api/nodechat?w=${encodeURIComponent(a.name)}`), null);
  const chans = S.LIMITS.chans;
  S.LIMITS.chans = 1;
  try {
    const r = await post("tokA", { channel: { ...CH, id: "C0TEST0009", name: "more" }, messages: [msg(1, "x")] });
    assert.equal(r.status, 429); assert.equal(((await r.json()) as any).max_channels, 1);
    assert.equal((await post("tokA", { channel: CH, messages: [msg(2, "있던 채널은 됨")] })).status, 200);
  } finally { S.LIMITS.chans = chans; }
});
