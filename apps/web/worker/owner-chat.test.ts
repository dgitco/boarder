import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
(globalThis as any).HTMLRewriter ??= class { on() { return this; } transform(r: Response) { return r; } };
const { default: app } = await import("./index.ts");
const OC = await import("./owner-chat.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
  });
  // batch = 트랜잭션 하나(D1 과 같음 — 하나가 막히면 다 되돌림)
  const batch = async (ss: any[]) => { db.exec("BEGIN"); try { const out = ss.map(s => { const r = db.prepare(s.sql); return { success: true, results: /^\s*(select|insert[^;]*returning)/i.test(s.sql) ? r.all(...s.args) : (r.run(...s.args), []), meta: {} }; }); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch, withSession() { return this; } } as unknown as D1Database };
}

const OWNER = "owner@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up", VOICE = "voice-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie() {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${OWNER}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${OWNER}|${exp}|${sig}`)}`;
}

// 스위치는 10초 캐시(ledger.f7On) — 시험마다 시계를 11초 앞당겨 그 시험 D1 의 스위치를 읽게
const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
function setup(flags = ["write_chat_d1", "write_exec", "write_ledger"], beat = true) {
  skew += 11_000;
  const { db, D1 } = d1();
  for (const f of flags) db.prepare("INSERT OR REPLACE INTO f7_flag(name, on_at, note) VALUES (?, ?, '')").run(f, Date.now());
  if (beat) db.prepare("INSERT INTO owner_job_beat(id, at) VALUES (1, ?)").run(Date.now());   // 실행기가 할 일 줄을 당기는 중
  const calls: { ch: string; path: string; body: string }[] = [];
  const te = new TextEncoder();
  const call = (ch: string) => async (r: { method: string; path: string; body?: Uint8Array }) => {
    calls.push({ ch, path: r.path, body: r.body ? new TextDecoder().decode(r.body) : "" });
    return { status: 202, headers: { "content-type": "application/json" }, body: te.encode('{"ok":true,"rid":"x","state":"queued"}') };
  };
  const cfg = { body: JSON.stringify({ channels: { primary: "C0PRIMARY", dgit: "C0DGIT" } }), etag: '"cfg1"', at: Date.now() };
  const env: any = {
    DB: D1, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test", VOICE_TOKEN: VOICE, RELAY_TOKEN: "relay-token-made-up",
    BRIDGE: { idFromName: (n: string) => n, get: (id: string) => ({ call: call(String(id)) }) },
    SNAP: { idFromName: (n: string) => n, get: () => ({ get: async (k: string) => k === "cfg" ? cfg : null, bump: async () => 0 }) },
  };
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil(p: Promise<unknown>) { waits.push(Promise.resolve(p).catch(() => null)); }, passThroughOnException() {} };
  const post = async (body: object) => {
    const r = await app.fetch(new Request("https://example.test/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-hb": "1", "sec-fetch-site": "same-origin", cookie: await cookie() }, body: JSON.stringify(body) }), env, ctx);
    await Promise.all(waits);
    return r;
  };
  const relay = (path: string, init: RequestInit = {}) => app.fetch(new Request("https://example.test" + path, { ...init, headers: { authorization: "Bearer " + VOICE, "content-type": "application/json" } }), env, ctx);
  return { db, env, calls, post, relay };
}
const chatCalls = <T extends { path: string }>(calls: T[]) => calls.filter(x => x.path === "/api/chat");

test("보통 글: 대화 표에 바로 쓰고 posted 로 답 — 실행기 · 다리를 안 거침", async () => {
  const { db, calls, post } = setup();
  const r = await post({ rid: "rid-plain-0001", channel: "dgit", text: "**굵게** 해 줘\n- 하나" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-f7"), "chat-d1");
  assert.equal(r.headers.get("set-cookie")?.includes("bx_w") ?? false, false, "D1 먼저 쓴 글은 쓴 뒤 20초 쿠키를 남기지 않음");
  const j = await r.json() as any;
  assert.equal(j.state, "ok"); assert.match(j.posted, /^\d{10}\.\d{6}$/); assert.equal(j.root, j.posted);
  const m = db.prepare("SELECT * FROM wl_talk_msg WHERE id = ?").get(j.posted) as any;
  assert.equal(m.who, "owner"); assert.equal(m.author, "Owner (보드)"); assert.equal(m.chan, "dgit"); assert.equal(m.thread, null); assert.equal(m.source, "boarder");
  assert.equal(m.text, "**굵게** 해 줘\n- 하나");
  assert.deepEqual(JSON.parse(m.blocks), [{ type: "section", text: { type: "mrkdwn", text: "*굵게* 해 줘\n• 하나" } }]);
  assert.equal((db.prepare("SELECT state FROM wl_talk_mirror WHERE msg = ?").get(j.posted) as any).state, "off");
  const job = db.prepare("SELECT kind, okey, body FROM owner_job WHERE rid = 'rid-plain-0001'").get() as any;
  assert.equal(job.kind, "/api/chat"); assert.equal(job.okey, "chat:dgit");
  assert.deepEqual(JSON.parse(job.body)._pre, { mid: j.posted, root: j.posted }, "판 넣기는 할 일 줄 — 실행기가 올리기를 건너뛰게 _pre");
  assert.ok((db.prepare("SELECT count(*) n FROM wl_change WHERE origin = 'web' AND tbl = 'talk_msg'").get() as any).n > 0, "트리거가 web 바뀜으로 적음(사본 당기기)");
  assert.ok(db.prepare("SELECT 1 FROM f7_rid WHERE rid = 'rid-plain-0001'").get());
  assert.deepEqual(calls, [], "글은 실행기 · 다리를 안 거침");
});

test("같은 rid 를 다시 보내면 쓰지 않고 그 글을 다시 답", async () => {
  const { db, post } = setup();
  const j1 = await (await post({ rid: "rid-again-0001", channel: "primary", text: "한 번만" })).json() as any;
  const j2 = await (await post({ rid: "rid-again-0001", channel: "primary", text: "한 번만" })).json() as any;
  assert.equal(j2.posted, j1.posted); assert.equal(j2.already, true);
  assert.equal((db.prepare("SELECT count(*) n FROM wl_talk_msg").get() as any).n, 1);
  assert.equal((db.prepare("SELECT count(*) n FROM owner_job").get() as any).n, 1);
});

test("스레드 답: Slack ts 로 와도 우리 id 로 · 노드 판(pane) 같이 남김", async () => {
  const { db, post } = setup();
  db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, text, at, source, slack_ts) VALUES ('1790000000.000001', 'dgit', NULL, 'agent', '뿌리', 1, 'cli', '1790000000.999999')").run();
  const j = await (await post({ rid: "rid-thread-0001", channel: "dgit", thread: "1790000000.999999", text: "답", pane: "%12" })).json() as any;
  assert.equal(j.root, "1790000000.000001");
  assert.equal((db.prepare("SELECT thread FROM wl_talk_msg WHERE id = ?").get(j.posted) as any).thread, "1790000000.000001");
  const body = JSON.parse((db.prepare("SELECT body FROM owner_job").get() as any).body);
  assert.equal(body.pane, "%12"); assert.equal(body.thread, "1790000000.000001", "할 일 줄 몸통도 우리 id 스레드");
});

test("비밀 값 꼴이 든 글은 예전 길 — 원문을 D1 할 일 줄에 남기지 않음(owner-jobs.accept 와 같음)", async () => {
  const { db, calls, post } = setup();
  await post({ rid: "rid-secret-001", channel: "dgit", text: "키 sk-ant-" + "a".repeat(30) + " 넣어 둠" });
  await post({ rid: "rid-secret-002", channel: "dgit", text: "xoxb-" + "1".repeat(12) });
  assert.equal(chatCalls(calls).length, 2);
  assert.equal((db.prepare("SELECT count(*) n FROM wl_talk_msg").get() as any).n, 0);
  assert.equal((db.prepare("SELECT count(*) n FROM owner_job").get() as any).n, 0);
});

test("실행기가 할 일 줄을 안 당기면(beat 없음) 예전 길 — 판에 넣을 쪽 없는 글을 만들지 않음", async () => {
  const { db, calls, post } = setup(undefined, false);
  await post({ rid: "rid-nobeat-01", channel: "dgit", text: "글" });
  assert.equal(chatCalls(calls).length, 1);
  assert.equal((db.prepare("SELECT count(*) n FROM wl_talk_msg").get() as any).n, 0);
});

test("화면이 보낸 _pre 는 지우고 넘김 — 이미 올린 글 표시는 Worker 만", async () => {
  const { calls, post } = setup(["write_exec", "write_ledger"]);
  await post({ rid: "rid-forge-001", channel: "dgit", text: "글", _pre: { mid: "1790000000.000001", root: "1790000000.000001" } });
  assert.equal(chatCalls(calls).length, 1);
  assert.equal("_pre" in JSON.parse(chatCalls(calls)[0].body), false);
});

test("Worker 가 못 읽는 몸통(NaN 등)은 400 — _pre 를 못 지운 채 넘기지 않음", async () => {
  const { calls, env } = setup(["write_exec", "write_ledger"]);
  const r = await app.fetch(new Request("https://example.test/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-hb": "1", "sec-fetch-site": "same-origin", cookie: await cookie() },
    body: '{"rid":"abcdef1","channel":"dgit","text":"x","n":NaN,"_pre":{"mid":"1790000000.000001","root":"1790000000.000001"}}' }), env, { waitUntil() {}, passThroughOnException() {} } as any);
  assert.equal(r.status, 400);
  assert.equal(chatCalls(calls).length, 0);
});

test("글 앞뒤 빈칸은 파이썬 strip 과 같게(\\x85 는 지우고 BOM 은 둠) · 4000 자는 코드 포인트로", () => {
  assert.equal(OC.plain({ rid: "rid-ws-00001", channel: "dgit", text: " \u0085가\uFEFF\u0085 " }, ["dgit"])!.text, "가\uFEFF");
  assert.equal(Array.from(OC.plain({ rid: "rid-ws-00002", channel: "dgit", text: "😀".repeat(4100) }, ["dgit"])!.text).length, 4000);
});

test("비밀일 수 있는 글 판정(리드 결정 A): NBSP 낀 API_KEY= · 긴 덩어리는 예전 길, 서명 링크 사진 글 · 보통 글 · URL 든 글은 D1 길", () => {
  const P = (text: string, ours: string[] = []) => OC.plain({ rid: "rid-ms-" + Math.random().toString(36).slice(2, 10), channel: "dgit", text }, ["dgit"], ours);
  // 파이썬 redact(re.ASCII)는 NBSP 를 글자로 봐 값 전체를 가림 — JS 만으로는 못 잡던 꼴
  assert.equal(P("API_KEY=abcd\u00a0efgh1234 확인"), null, "NBSP 낀 API_KEY= → 예전 길");
  assert.equal(P("PASSWORD: hunter2hunter2"), null, "이름이 비밀인 값 → 예전 길");
  assert.equal(P("이거 넣어 둬 a1b2c3d4e5f6a7b8c9d0e1f2"), null, "꼴 없는 긴 덩어리(서버 환경 값일 수 있음) → 예전 길");
  assert.equal(P("internationalization 문제"), null, "긴 영문 단어만 있는 글 — 예전 길로 가도 괜찮음(리드)");
  const photo = ["📎 Screenshot_2026-11-05-192233_KakaoTalk.png: https://boarder.dgit.co/f/0123456789abcdef0123456789abcdef?e=1794477575&t=00112233445566778899aabbccddeeff",
    "📎 IMG_20261105_123456789.jpg: https://boarder.dgit.co/f/fedcba9876543210fedcba9876543210?e=1794477575&t=ffeeddccbbaa99887766554433221100"];
  assert.ok(P(["사진 봐 줘", ...photo].join("\n"), photo), "Worker 가 붙인 서명 링크 사진 글 → D1 길(파일 이름 · 서명 값은 판정에서 뺌)");
  assert.equal(P(["사진 봐 줘", ...photo].join("\n")), null, "같은 줄이라도 Worker 가 붙인 게 아니면(손으로 친 글) 판정 그대로");
  assert.ok(P("PR https://github.com/example/demo/pull/1/files#diff-0123456789abcdef 봐 줘"), "URL 안 긴 덩어리는 판정에서 뺌");
  assert.ok(P("오늘 배포 끝나면 알려 줘. 3시쯤?"), "보통 글 → D1 길");
});

test("보통 글이 아니면 예전 길(실행기) 그대로", async () => {
  const cases: [string, object][] = [
    ["단추", { channel: "dgit", thread: "1790000000.000001", ts: "1790000000.000002", label: "A" }],
    ["반응", { channel: "dgit", ts: "1790000000.000002", react: "eyes" }],
    ["고치기", { channel: "dgit", ts: "1790000000.000002", edit: "새 글" }],
    ["주제", { channel: "primary", text: "주제 글", topic: "t1" }],
    ["싱크", { channel: "primary", text: "간단히 싱크" }],
    ["짧은 답", { channel: "primary", thread: "1790000000.000001", text: "1A 2B" }],
    ["모르는 채널", { channel: "nope", text: "글" }],
    ["쉬는 노드 자리 판", { channel: "dgit", text: "글", pane: "g:어떤 노드" }],
    ["음성 메모", { channel: "dgit", text: "", stt: "up1" }],
    ["빈 고치기", { channel: "dgit", ts: "1790000000.000002", text: "글", edit: "" }],
    ["JSON 꼴 글", { channel: "dgit", text: ' {"password": "correct horse battery staple"}' }],
  ];
  for (const [name, b] of cases) {
    const { db, calls, post } = setup();
    await post({ rid: "rid-old-" + Math.random().toString(36).slice(2, 10), ...b });
    assert.equal(chatCalls(calls).length, 1, name + ": 실행기로 가야 함");
    assert.equal((db.prepare("SELECT count(*) n FROM wl_talk_msg").get() as any).n, 0, name + ": D1 에 먼저 쓰면 안 됨");
  }
});

test("전달 상자 스레드(source node-move)는 원글로 바뀌어야 해 예전 길", async () => {
  const { db, calls, post } = setup();
  db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, text, at, source, ref) VALUES ('1790000000.000005', 'dgit', NULL, 'agent', '상자', 1, 'node-move', '1790000000.000001')").run();
  await post({ rid: "rid-box-00001", channel: "dgit", thread: "1790000000.000005", text: "답" });
  assert.equal(chatCalls(calls).length, 1);
  assert.equal((db.prepare("SELECT count(*) n FROM wl_talk_msg WHERE who = 'owner'").get() as any).n, 0);
});

test("스위치 꺼짐 · 시험 통로는 예전 길", async () => {
  const off = setup(["write_exec", "write_ledger"]);
  await off.post({ rid: "rid-off-00001", channel: "dgit", text: "글" });
  assert.equal(chatCalls(off.calls).length, 1);
});

test("mrkdwn · 블록 꼴은 primary_relay.mrkdwn · text_blocks 와 같음", () => {
  assert.equal(OC.mrkdwn("# 제목\n**a** [링크](https://x.test/a)\n* 점\n```\n**그대로**\n```"), "*제목*\n*a* <https://x.test/a|링크>\n• 점\n```\n**그대로**\n```");
  const long = "가".repeat(2900) + "😀나";
  assert.deepEqual(OC.textBlocks(long).map((b: any) => b.text.text), ["가".repeat(2900), "😀나"]);
});
