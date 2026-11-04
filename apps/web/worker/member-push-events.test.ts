import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";

register("./test-hooks.mjs", import.meta.url);
const { lineWhy, lineMsg, DIGEST_MS, routeCard, routeLine } = await import("./member-push.ts");
const { localTools } = await import("./local.ts");
const { Pusher } = await import("./push-do.ts");
const { b64u, memberMsg } = await import("./push.ts");

const MIG = new URL("../migrations/", import.meta.url);
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => (db.prepare(sql).get(...(args as never[])) as unknown) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { db, D1: { prepare: (s: string) => stmt(s), batch: async (ss: any[]) => ss.map(s => ({ results: db.prepare(s.sql).all(...(s.args as never[])) })) } as unknown as D1Database };
}
const A = "a@example.com";

// ---------- 글 한 줄의 종류 ----------
function rig() {
  const { D1, db } = fakeD1(), lines: any[] = [];
  const run = localTools(D1, A, "일 창", "https://board.example", "", undefined, undefined, l => lines.push(l));
  const why = async () => { const l = lines.at(-1); return { ...(await lineWhy(D1, A, l)), l }; };
  return { D1, db, run, lines, why };
}
// 사람이 Primary 에 쓴 글(/api/me/chat 과 같은 줄) → 스레드 뿌리 ts
const myPrimary = (db: DatabaseSync, text: string) => {
  const at = Date.now(), r = db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?) RETURNING id").get(A, "나", "chat", text, "primary", at) as { id: number };
  return `${Math.floor(at / 1000)}.${String(r.id % 1_000_000).padStart(6, "0")}`;
};

test("턴 답(inbox_log reply) · 막힘 unblocks=me · 장애 = 바로(reply · call), 그 밖 진행 · 끝 · 남이 풀 막힘 · 상태 줄 = 진행 글", async () => {
  const r = rig();
  await r.run("inbox_log", { kind: "reply", text: "고쳤어요" });
  assert.equal((await r.why()).why, "reply");
  await r.run("inbox_log", { kind: "blocked", text: "로그인 필요", unblocks: "me" });
  assert.equal((await r.why()).why, "call");
  await r.run("inbox_log", { kind: "incident", text: "결제 오류" });
  assert.equal((await r.why()).why, "call");
  for (const [kind, unblocks] of [["progress"], ["done"], ["start"], ["blocked", "other"], ["decision"]] as const) {
    await r.run("inbox_log", { kind, text: `${kind} 줄`, ...(unblocks ? { unblocks } : {}) });
    assert.equal((await r.why()).why, "progress", kind);
  }
  const n = r.lines.length;
  await r.run("inbox_status", { text: "고치는 중" });
  assert.equal(r.lines.length, n, "상태 줄은 알림 쪽에 안 넘어감");
});

test("스레드 글: 내 Primary 글 스레드 · 내가 답한 카드 · 내가 쓴 노드 글 = 답(reply), 안 답한 카드 · 스레드 없는 글 = 진행 글", async () => {
  const r = rig();
  const root = myPrimary(r.db, "배포 언제 돼요?");
  await r.run("chat_say", { text: "오늘 6시요", thread: root });
  const a = await r.why();
  assert.equal(a.why, "reply");
  assert.deepEqual(lineMsg(a.l, "reply", a.card), { id: `log:${a.l.id}`, question: "일 창 — 오늘 6시요", url: `./?open=thread:primary:${root}`, title: "답이 왔어요" });
  await r.run("chat_say", { text: "아침 정리" });
  assert.equal((await r.why()).why, "progress");

  const { card_id } = await r.run("inbox_ask", { question: "A 로 갈까요?", choices: ["A", "B"] }) as { card_id: string };
  await r.run("inbox_say", { thread_id: card_id, text: "자료 붙였어요" });
  assert.equal((await r.why()).why, "progress", "사람이 아직 안 건드린 카드 스레드");
  r.db.prepare("UPDATE board_card SET state = 'answered', answer = 'A', answered_at = ? WHERE id = ?").run(Date.now(), card_id);
  await r.run("inbox_say", { thread_id: card_id, text: "A 로 했어요" });
  const b = await r.why();
  assert.deepEqual([b.why, b.card], ["reply", true]);
  assert.equal(lineMsg(b.l, "reply", b.card).url, `./?open=card:${card_id}`);

  // 노드 채널에 내가 쓴 글(kind me · thread 없음)을 뿌리로 한 스레드 답
  const at = Date.now(), me = r.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?) RETURNING id").get(A, "일 창", "me", "로그 봐 줘", null, at) as { id: number };
  const nroot = `${Math.floor(at / 1000)}.${String(me.id % 1_000_000).padStart(6, "0")}`;
  await r.run("inbox_say", { thread_id: nroot, text: "봤어요 — 원인은 X" });
  const c = await r.why();
  assert.deepEqual([c.why, lineMsg(c.l, "reply", c.card).url], ["reply", "./"]);
});

test("알림 글 꼴: 부름 제목 · 글 id 는 tag 그대로(카드 tag 와 안 겹침) · 우리 보드 밖 주소는 카드 주소로", () => {
  const m = memberMsg(lineMsg({ id: 7, tool: "inbox_log", kind: "blocked", text: "로그인\n필요", thread: null, unblocks: "me", win: "창" }, "call"));
  assert.deepEqual(m, { title: "나를 불러요", body: "창 — 로그인 필요", url: "./", tag: "log:7" });
  assert.equal(memberMsg({ id: "1793170372.000001", question: "q", url: "https://evil.example/" }).url, "./?open=card:1793170372.000001");
  assert.equal(memberMsg({ id: "1793170372.000001", question: "q", url: "./?open=thread:primary:1793170372.000002" }).url, "./?open=thread:primary:1793170372.000002");
  assert.equal(memberMsg({ id: "sales:2026-11-04", question: "q", url: "./sales" }).tag, "card:sales:2026-11-04");
});

// ---------- 회원 칸(Pusher DO): 같은 사건 한 번 · 진행 글 묶음 · 끔 ----------
async function fakeSub() {   // 브라우저 구독 꼴(P-256 공개 키 · auth 16바이트) — 보내기는 가짜 fetch 가 받음
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey) as ArrayBuffer);
  return { endpoint: "https://push.example/send/abc", keys: { p256dh: b64u(pub), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
}
function fakeDO(D1: D1Database) {
  const s = new DatabaseSync(":memory:");
  let alarm: number | null = null;
  const sql = {
    exec: (q: string, ...b: unknown[]) => {
      const st = s.prepare(q);
      if (/^\s*select/i.test(q)) { const rows = st.all(...(b as never[])); return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }; }
      const r = st.run(...(b as never[])); return { toArray: () => [], one: () => undefined, rowsWritten: Number(r.changes) };
    },
  };
  const ctx = { storage: { sql, getAlarm: async () => alarm, setAlarm: async (t: number) => { alarm = t; }, deleteAlarm: async () => { alarm = null; } } };
  // P-256 개인 키 32바이트(가짜 VAPID) — 0 이 아닌 작은 값이라 늘 올바른 키
  const vapid = b64u(Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? 7 : 0)));
  const pu = new (Pusher as any)(ctx, { DB: D1, VAPID_PRIVATE: vapid });
  const sent = () => s.prepare("SELECT ev FROM log ORDER BY id").all().map((r: any) => JSON.parse(r.ev)).filter((e: any) => e.ev === "send");
  return { pu, sent, alarm: () => alarm, clearAlarm: () => { alarm = null; } };
}
const realFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = (async () => new Response(null, { status: 201 })) as typeof fetch; });
test.after(() => { globalThis.fetch = realFetch; });

test("같은 사건(key)은 한 번만 — 카드 · 답이 두 번 불려도 기기엔 한 통", async () => {
  const { D1 } = fakeD1(), d = fakeDO(D1);
  assert.equal((await d.pu.mSubscribe(A, { sub: await fakeSub(), ua: "test" }))[0], 200);
  const card = { id: "1793170372.000001", question: "A 로 갈까요?" };
  assert.equal((await d.pu.mNotify(A, card, "card:1793170372.000001"))[1].sent, 1);
  assert.deepEqual((await d.pu.mNotify(A, card, "card:1793170372.000001"))[1], { ok: true, sent: 0, dup: true });
  const reply = lineMsg({ id: 42, tool: "chat_say", kind: "say", text: "오늘 6시요", thread: "p:1793170372.000002", win: "창" }, "reply");
  await d.pu.mNotify(A, reply, "log:42");
  await d.pu.mNotify(A, reply, "log:42");
  assert.deepEqual(d.sent().map((e: any) => [e.title, e.tag]), [["내 차례", "card:1793170372.000001"], ["답이 왔어요", "log:42"]]);
});

test("카드가 1분에 넷 넘게 와서 한 장으로 묶여도 답 · 부름은 묶이지 않음(제목 · 글 · tag 그대로)", async () => {
  const { D1 } = fakeD1(), d = fakeDO(D1);
  await d.pu.mSubscribe(A, { sub: await fakeSub(), ua: "test" });
  for (let i = 1; i <= 5; i++) await d.pu.mNotify(A, { id: `1793170372.00000${i}`, question: `카드 ${i}` }, `card:${i}`);
  await d.pu.mNotify(A, lineMsg({ id: 9, tool: "inbox_log", kind: "reply", text: "고쳤어요", thread: null, win: "창" }, "reply"), "log:9");
  const s = d.sent();
  assert.deepEqual(s.slice(-2).map((e: any) => e.tag), ["cards", "log:9"], "다섯째 카드는 묶음, 답은 제 tag");
  assert.equal(s.at(-1).title, "답이 왔어요");
});

test("진행 글 묶음: 세 줄이 와도 바로는 0통, 5분 알람 하나 → 「새 글 3」 한 통 · 비운 뒤 다음 줄이 새 알람", async () => {
  const { D1 } = fakeD1(), d = fakeDO(D1);
  await d.pu.mSubscribe(A, { sub: await fakeSub(), ua: "test" });
  await d.pu.mSetPrefs(A, { wide: true });
  const t0 = Date.now();
  for (let i = 1; i <= 3; i++) assert.equal((await d.pu.mDigest(A))[1].n, i);
  assert.equal(d.sent().length, 0);
  const at = d.alarm();
  assert.ok(at != null && at >= t0 + DIGEST_MS && at <= Date.now() + DIGEST_MS, "첫 줄에서 5분 뒤 알람 하나");
  d.clearAlarm(); await d.pu.alarm();
  assert.deepEqual(d.sent().map((e: any) => [e.title, e.tag]), [["새 글 3", "digest"]]);
  assert.equal(d.alarm(), null, "회원 칸 알람은 다시 걸지 않음(주인 10초 틱 아님)");
  await d.pu.alarm();
  assert.equal(d.sent().length, 1, "비운 뒤 알람은 아무것도 안 보냄");
  await d.pu.mDigest(A);
  assert.ok(d.alarm() != null);
});

test("진행 글 끔: 세지도 알람도 없음 · 켜 둔 사이 쌓인 것도 버림 · 잘못된 값은 400 · 기본은 묶음", async () => {
  const { D1 } = fakeD1(), d = fakeDO(D1);
  await d.pu.mSubscribe(A, { sub: await fakeSub(), ua: "test" });
  assert.deepEqual((await d.pu.mPrefs(A))[1], { ok: true, wide: false, progress: "digest" });
  await d.pu.mSetPrefs(A, { wide: true });
  await d.pu.mDigest(A);
  assert.deepEqual((await d.pu.mSetPrefs(A, { progress: "off" }))[1], { ok: true, wide: true, progress: "off" });
  d.clearAlarm(); await d.pu.alarm();
  assert.equal(d.sent().length, 0);
  assert.equal((await d.pu.mDigest(A))[1].n, 0);
  assert.equal(d.alarm(), null);
  assert.equal((await d.pu.mSetPrefs(A, { progress: "loud" }))[0], 400);
  assert.equal((await d.pu.mSetPrefs(A, { wide: "yes" }))[0], 400);
  assert.equal((await d.pu.mSetPrefs(A, {}))[0], 400);
  assert.equal((await d.pu.mSetPrefs("b@example.com", { progress: "digest" }))[0], 403, "남의 칸은 못 바꿈");
});

// ---------- 사람마다 설정: 설정 없는 회원 = main 과 같은 알림(급한 카드만) · 켠 회원만 넓은 범위 ----------
// index.ts memberCardPush · memberLinePush 와 같은 길(routeCard · routeLine)로 같은 사건 묶음을 흘려 기기에 간 알림을 셈
async function flow(wide: boolean | null) {
  const { D1, db } = fakeD1(), d = fakeDO(D1);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)").run("devA0000001", A, "laptop", "", "h-a", Date.now() - 3600_000, Date.now(), "full");
  await d.pu.mSubscribe(A, { sub: await fakeSub(), ua: "test" });
  if (wide != null) await d.pu.mSetPrefs(A, { wide });
  const waits: Promise<unknown>[] = [];
  const run = localTools(D1, A, "일 창", "https://board.example", "", c => waits.push(routeCard(D1, A, c, d.pu)), undefined, l => waits.push(routeLine(D1, A, l, d.pu)));
  const settle = async () => { await Promise.all(waits); waits.length = 0; };
  await run("inbox_ask", { question: "보통 결정", choices: ["A"] });
  await run("inbox_ask", { question: "할 일", choices: ["했어요"], kind: "todo" });
  await run("inbox_ask", { question: "결제 장애", choices: ["A"], urgent: true });
  await run("inbox_ask", { question: "급한 할 일", choices: ["A"], kind: "todo", urgent: true });
  await settle();
  await routeCard(D1, A, { id: "1793170372.000009", question: "비밀 넣기 허용?", secret: true }, d.pu);
  const root = myPrimary(db, "배포 언제 돼요?");
  await run("chat_say", { text: "오늘 6시요", thread: root });
  await run("inbox_log", { kind: "reply", text: "고쳤어요" });
  await run("inbox_log", { kind: "blocked", text: "로그인 필요", unblocks: "me" });
  await run("inbox_log", { kind: "progress", text: "진행 1" });
  await run("inbox_log", { kind: "progress", text: "진행 2" });
  await settle();
  const pending = d.alarm() != null;
  d.clearAlarm(); await d.pu.alarm();
  return { bodies: d.sent().map((e: any) => e.title), pending };
}

test("설정 없는 회원 = main 과 같은 알림: urgent 카드 · 비밀 넣기 허용만, 할 일 · 보통 카드 · 답 · 부름 · 진행 글은 0 · 묶음 알람도 없음", async () => {
  const none = await flow(null);
  assert.deepEqual(none.bodies, ["내 차례", "내 차례"], "결제 장애 · 비밀 넣기 허용 두 통만");
  assert.equal(none.pending, false, "진행 글 묶음 알람을 안 검");
  assert.deepEqual(await flow(false), none, "넓힘을 끈 회원도 같음");
});

test("넓힘을 켠 회원: 새 카드 넷 · 비밀 · 답 둘 · 부름 하나는 바로, 진행 글 둘은 5분 알람 뒤 「새 글 2」 한 통", async () => {
  const w = await flow(true);
  assert.deepEqual(w.bodies, ["내 차례", "내 차례", "내 차례", "내 차례", "내 차례", "답이 왔어요", "답이 왔어요", "나를 불러요", "새 글 2"]);
  assert.equal(w.pending, true);
});

test("넓힘이 꺼진 회원 칸: 넓은 범위 사건(opt.wide)은 key 도 안 적고 0통 — 나중에 켜면 새 사건부터", async () => {
  const { D1 } = fakeD1(), d = fakeDO(D1);
  await d.pu.mSubscribe(A, { sub: await fakeSub(), ua: "test" });
  assert.deepEqual((await d.pu.mNotify(A, { id: "1793170372.000001", question: "보통" }, "card:1", { wide: true }))[1], { ok: true, sent: 0, scope: "urgent" });
  assert.equal((await d.pu.mDigest(A))[1].n, 0);
  assert.equal(d.alarm(), null);
  await d.pu.mSetPrefs(A, { wide: true });
  assert.equal((await d.pu.mNotify(A, { id: "1793170372.000001", question: "보통" }, "card:1", { wide: true }))[1].sent, 1);
  await d.pu.mDigest(A);
  await d.pu.mSetPrefs(A, { wide: false });
  d.clearAlarm(); await d.pu.alarm();
  assert.deepEqual(d.sent().map((e: any) => e.title), ["내 차례"], "넓힘을 끄면 쌓인 진행 글 묶음도 버림");
});
