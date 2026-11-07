import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
const ledger = await import("./ledger.ts");
const OJ = await import("./owner-jobs.ts");

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
  // batch = 한 트랜잭션(진짜 D1 처럼)
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { db.exec("BEGIN"); try { const out = []; for (const s of ss) out.push({ success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} }); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } } } as unknown as D1Database;
  return { db, D1 };
}
const OWNER = "owner@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up", RELAY = "relay-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email: string) {
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
async function setup(o: { on?: boolean; beat?: number | null } = {}) {
  const { db, D1 } = d1(), calls: { method: string; path: string; body: string }[] = [];
  await ledger.setFlag(D1, "write_owner_jobs", o.on ?? true);   // 스위치 캐시도 비움
  if (o.beat !== null) db.prepare("INSERT INTO owner_job_beat(id, at) VALUES (1, ?)").run(Date.now() - (o.beat ?? 1000));
  const call = async (r: { method: string; path: string; body?: Uint8Array }) => { calls.push({ method: r.method, path: r.path, body: r.body ? new TextDecoder().decode(r.body) : "" }); return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"ok":true,"state":"ok","from":"bridge"}') }; };
  // 스냅숏 · 화면 칸(주인도 회원 길 — 쓰기 뒤 화면 칸 알림 · 채널 표 cfg)
  const SNAP = { idFromName: (n: string) => n, get: () => ({ get: async (k: string) => k === "cfg" ? { body: JSON.stringify({ channels: { primary: "C1", dgit: "C4", company: "C2" }, drafts: {} }), etag: '"e-cfg"', at: Date.now(), checked: Date.now() } : null, tags: async () => ({ t: {}, age: 0, boot: "b" }), bump: async () => 0 }) };
  const env = { DB: D1, SNAP, ASSETS: { fetch: async () => new Response("nf") }, BRIDGE: { idFromName: (n: string) => n, get: () => ({ call }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test", RELAY_TOKEN: RELAY, CONNECTOR_KEY: btoa("k".repeat(32)), ADMIN_TOKEN: "admin-token-made-up" };
  const ctx = { waitUntil() {}, passThroughOnException() {} } as never;
  const send = async (path: string, body: unknown, headers: Record<string, string> = {}) => app.fetch(new Request("https://example.test" + path, { method: "POST", headers: { cookie: await cookie(OWNER), "x-hb": "1", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), env as never, ctx);
  const get = async (path: string) => app.fetch(new Request("https://example.test" + path, { headers: { cookie: await cookie(OWNER) } }), env as never, ctx);
  const relay = async (method: string, path: string, body?: unknown, tok = RELAY) => app.fetch(new Request("https://example.test" + path, { method, headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env as never, ctx);
  const rows = () => db.prepare("SELECT rid, kind, okey, body, done_at, status, result, tries FROM owner_job ORDER BY seq").all() as { rid: string; kind: string; okey: string; body: string; done_at: number | null; status: number | null; result: string | null; tries: number }[];
  const admin = async (body: unknown) => app.fetch(new Request("https://example.test/api/admin/f7-flag", { method: "POST", headers: { authorization: "Bearer admin-token-made-up", "content-type": "application/json" }, body: JSON.stringify(body) }), env as never, ctx);
  return { db, calls, send, get, relay, rows, admin, env };
}

test("주인 글: 다리를 안 부르고 할 일 줄 한 줄 · 202 queued(rid 그대로)", async () => {
  const t = await setup();
  const r = await t.send("/api/chat", { rid: "rjob-chat-0001", channel: "dgit", text: "안녕" });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { ok: true, rid: "rjob-chat-0001", state: "queued" });
  assert.equal(r.headers.get("x-owner-job"), "new");
  assert.ok((r.headers.get("set-cookie") || "").includes("bx_w=1; Max-Age=20"), "주인도 회원과 같이 앞단 「방금 씀」 쿠키(owner_unified 늘 켬)");
  assert.equal(t.calls.length, 0, "다리를 불렀음");
  const [row] = t.rows();
  assert.equal(row.rid, "rjob-chat-0001"); assert.equal(row.kind, "/api/chat"); assert.equal(row.okey, "chat:dgit");
  assert.deepEqual(JSON.parse(row.body), { rid: "rjob-chat-0001", channel: "dgit", text: "안녕" });
  const a = await t.get("/api/answer/rjob-chat-0001");
  assert.equal(a.status, 200); assert.deepEqual(await a.json(), { rid: "rjob-chat-0001", state: "queued" });
  assert.equal(t.calls.length, 0);
});

test("같은 rid 를 두 번 보내도 줄 하나 · 실행기는 한 번만 받음", async () => {
  const t = await setup();
  for (let i = 0; i < 2; i++) assert.equal((await t.send("/api/chat", { rid: "rjob-chat-0002", channel: "dgit", text: "한 번만" })).status, 202);
  assert.equal(t.rows().length, 1);
  const take1 = await (await t.relay("POST", "/api/relay/jobs/take", { limit: 5 })).json() as { jobs: { rid: string }[] };
  assert.deepEqual(take1.jobs.map(j => j.rid), ["rjob-chat-0002"]);
  const take2 = await (await t.relay("POST", "/api/relay/jobs/take", { limit: 5 })).json() as { jobs: unknown[] };
  assert.equal(take2.jobs.length, 0, "맡은 줄을 또 내줌");
  assert.equal(t.calls.length, 0);
});

test("실행기 결과가 /api/answer 에 보임 — 성공 · 실패 · 판 넣기 진행, 몸통은 비움", async () => {
  const t = await setup();
  await t.send("/api/chat", { rid: "rjob-ok-0003", channel: "dgit", text: "a" });
  await t.send("/api/chat", { rid: "rjob-bad-0004", channel: "primary", text: "b" });
  await t.relay("POST", "/api/relay/jobs/take", { limit: 5 });
  assert.equal((await t.relay("POST", "/api/relay/jobs/rjob-ok-0003", { status: 202, result: { ok: true, rid: "rjob-ok-0003", state: "queued" } })).status, 200);
  assert.deepEqual(await (await t.get("/api/answer/rjob-ok-0003")).json(), { ok: true, rid: "rjob-ok-0003", state: "queued" });
  await t.relay("POST", "/api/relay/jobs/rjob-ok-0003", { status: 200, result: { ok: true, rid: "rjob-ok-0003", state: "sent", posted: "1793900000.000100", text: "a" } });
  assert.deepEqual(await (await t.get("/api/answer/rjob-ok-0003")).json(), { ok: true, rid: "rjob-ok-0003", state: "sent", posted: "1793900000.000100" });
  await t.relay("POST", "/api/relay/jobs/rjob-bad-0004", { status: 400, result: { ok: false, error: "요청 모양이 틀림" } });
  assert.deepEqual(await (await t.get("/api/answer/rjob-bad-0004")).json(), { ok: false, rid: "rjob-bad-0004", state: "fail", error: "요청 모양이 틀림" });
  assert.ok(t.rows().every(r => r.body === "" && r.done_at), "끝난 줄 몸통이 남음");
  assert.ok(t.rows().every(r => !JSON.parse(r.result || "{}").text), "결과에 글 원문이 남음");
  assert.equal((await t.relay("POST", "/api/relay/jobs/nope-0000", { status: 200, result: {} })).status, 404);
  assert.equal((await t.relay("POST", "/api/relay/jobs/take", { limit: 5 }, "wrong")).status, 403);
  assert.equal(t.calls.length, 0);
});

test("같은 채널은 받은 순서 하나씩 — 앞 줄이 끝나야 다음 줄, 다른 채널은 같이", async () => {
  const t = await setup();
  await t.send("/api/chat", { rid: "rjob-ord-0001", channel: "dgit", text: "첫째" });
  await t.send("/api/chat", { rid: "rjob-ord-0002", channel: "dgit", thread: "1793900000.000001", text: "둘째" });
  await t.send("/api/inbox", { op: "read", items: [] });   // rid 없는 쓰기 — Worker 가 rid 를 지음
  const a = await (await t.relay("POST", "/api/relay/jobs/take", { limit: 10 })).json() as { jobs: { rid: string; kind: string }[] };
  assert.deepEqual(a.jobs.map(j => j.kind), ["/api/chat", "/api/inbox"]);
  assert.equal(a.jobs[0].rid, "rjob-ord-0001");
  assert.match(a.jobs[1].rid, /^[\w-]{6,64}$/);
  assert.equal(((await (await t.relay("POST", "/api/relay/jobs/take", { limit: 10 })).json()) as { jobs: unknown[] }).jobs.length, 0, "앞 줄이 안 끝났는데 둘째를 내줌");
  await t.relay("POST", "/api/relay/jobs/rjob-ord-0001", { status: 200, result: { ok: true, state: "ok" } });
  const b = await (await t.relay("POST", "/api/relay/jobs/take", { limit: 10 })).json() as { jobs: { rid: string }[] };
  assert.deepEqual(b.jobs.map(j => j.rid), ["rjob-ord-0002"]);
});

test("기기가 꺼져 있던 동안 쌓인 줄: 맡김이 풀리면 다시 내주고, 5번 넘게 못 끝내면 실패로 보임", async () => {
  const t = await setup();
  await t.send("/api/chat", { rid: "rjob-lease-001", channel: "dgit", text: "x" });
  await t.relay("POST", "/api/relay/jobs/take", { limit: 1 });
  t.db.prepare("UPDATE owner_job SET taken_at = ? WHERE rid = 'rjob-lease-001'").run(Date.now() - OJ.LEASE - 1);   // 맡은 기기가 죽음
  const again = await (await t.relay("POST", "/api/relay/jobs/take", { limit: 1 })).json() as { jobs: { rid: string; tries: number }[] };
  assert.deepEqual(again.jobs.map(j => [j.rid, j.tries]), [["rjob-lease-001", 2]]);
  t.db.prepare("UPDATE owner_job SET taken_at = ?, tries = ? WHERE rid = 'rjob-lease-001'").run(Date.now() - OJ.LEASE - 1, OJ.MAX_TRIES);
  assert.equal(((await (await t.relay("POST", "/api/relay/jobs/take", { limit: 1 })).json()) as { jobs: unknown[] }).jobs.length, 0);
  const a = await (await t.get("/api/answer/rjob-lease-001")).json() as { state: string; error: string };
  assert.equal(a.state, "fail"); assert.equal(a.error, "일시적인 오류가 발생했어요");
  const st = await (await t.relay("GET", "/api/relay/jobs/stat")).json() as { open: number; beat_ok: boolean };
  assert.equal(st.open, 0); assert.equal(st.beat_ok, true);
});

test("실행기가 한 번도 안 당겼거나 10분 넘게 안 당기면 503 다시 보내기", async () => {
  for (const beat of [null, OJ.BEAT_MAX + 1000]) {
    const t = await setup({ beat });
    const r = await t.send("/api/chat", { rid: "rjob-nobeat-01", channel: "dgit", text: "다리로" });
    assert.equal(r.status, 503); assert.equal(r.headers.get("x-retry-safe"), "1");
    assert.equal(t.calls.length, 0);
    assert.equal(t.rows().length, 0);
  }
});

test("스위치를 끄면 예전 다리 길(쌓인 줄의 답은 그대로 보임)", async () => {
  const t = await setup({ on: false });
  t.db.prepare("INSERT INTO owner_job(rid, kind, okey, body, at, done_at, status, result) VALUES ('rjob-left-0001', '/api/chat', 'chat:dgit', '', ?, ?, 200, '{\"ok\":true,\"state\":\"sent\"}')").run(Date.now(), Date.now());
  const r = await t.send("/api/chat", { rid: "rjob-off-0001", channel: "dgit", text: "꺼짐" });
  assert.equal(r.status, 200); assert.equal(t.calls.length, 1);
  assert.equal(t.rows().length, 1);
  assert.deepEqual(await (await t.get("/api/answer/rjob-left-0001")).json(), { ok: true, rid: "rjob-left-0001", state: "sent" });
  assert.equal(t.calls.length, 1, "쌓인 줄 답을 다리로 물음");
});

test("문 · 모양: X-HB 없으면 403, 깨진 JSON 은 400(줄 없음), 줄로 안 받는 길(chat/new)은 회원 길(다리 아님)", async () => {
  const t = await setup();
  assert.equal((await t.send("/api/chat", { channel: "dgit", text: "x" }, { "x-hb": "" })).status, 403);
  const bad = await t.send("/api/chat", "{깨짐");
  assert.equal(bad.status, 400); assert.equal(t.rows().length, 0);
  assert.ok((await t.send("/api/chat/new", { text: "새 대화" })).status < 500);
  assert.equal(t.calls.length, 0, "세션 새로 열기는 회원 길(memberPost)");
});

test("읽음 표시는 할 일 줄로 · 화면 오류 기록은 회원 길(Workers Logs) — 둘 다 다리 아님, 화면 오류 기록엔 「방금 씀」 쿠키 없음", async () => {
  const t = await setup();
  const seen = await t.send("/api/chat", { channel: "dgit", thread: "1793900000.000001", seen: true, rid: "rjob-seen-0001" });
  assert.equal(seen.status, 202);
  const log = await t.send("/api/clientlog", { kind: "http", err: "x" });
  assert.ok(log.status < 400, String(log.status)); assert.ok(!(log.headers.get("set-cookie") || "").includes("bx_w="));
  assert.deepEqual(t.rows().map(r => [r.kind, r.okey.split(":")[0]]), [["/api/chat", "seen"]]);
  assert.equal(t.calls.length, 0);
});

test("관리 길로 스위치를 켜고 끔(write_owner_jobs — 이름에 밑줄)", async () => {
  const t = await setup({ on: false });
  assert.equal((await t.admin({ name: "write_owner_jobs", on: true })).status, 200);
  assert.equal((await t.send("/api/chat", { rid: "rjob-flag-0001", channel: "dgit", text: "켬" })).status, 202);
  assert.equal((await t.admin({ name: "write_owner_jobs", on: false })).status, 200);
  assert.equal((await t.send("/api/chat", { rid: "rjob-flag-0002", channel: "dgit", text: "끔" })).status, 200);
  assert.equal(t.calls.length, 1); assert.equal(t.rows().length, 1);
  assert.equal((await t.admin({ name: "write_Bad-name", on: true })).status, 400);
});

test("고치기 · 지우기는 할 일 줄로 처리 결과를 올림 · 세션 넣기 · 세션 대화는 회원 길", async () => {
  const t = await setup();
  for (const [p, b] of [["/api/chat", { rid: "rjob-edit-0001", channel: "dgit", ts: "1793900000.000001", edit: "고친 글" }], ["/api/chat", { rid: "rjob-del-00001", channel: "dgit", ts: "1793900000.000001", delete: true }]] as const) {
    const r = await t.send(p, b); assert.equal(r.status, 202, p); assert.equal((await r.json() as { state: string }).state, "queued");
  }
  for (const [p, b] of [["/api/sess/send", { pane: "%1", text: "x" }], ["/api/chat/send", { sid: "s1", text: "x" }]] as const) assert.ok((await t.send(p, b)).status < 500, p);
  assert.equal(t.calls.length, 0);
  assert.equal(t.rows().length, 2);
  const jobs = await (await t.relay("POST", "/api/relay/jobs/take", { limit: 5 })).json() as { jobs: { rid: string; body: string }[] };
  assert.equal(JSON.parse(jobs.jobs[0].body).edit, "고친 글");
  await t.relay("POST", "/api/relay/jobs/rjob-edit-0001", { status: 400, result: { ok: false, error: "내 글이 아님" } });
  assert.equal((await (await t.get("/api/answer/rjob-edit-0001")).json() as { state: string }).state, "fail");
  assert.equal(JSON.parse((await (await t.relay("POST", "/api/relay/jobs/take", {})).json() as { jobs: { body: string }[] }).jobs[0].body).delete, true);
  assert.equal((await t.send("/api/chat", { rid: "rjob-react-001", channel: "dgit", ts: "1793900000.000001", react: "eyes" })).status, 202);   // 반응은 줄로
});

test("비밀 꼴 글은 봉해 저장하고 인증된 실행기에만 원문 · 결과 뒤 몸통 비움", async () => {
  const t = await setup();
  const r = await t.send("/api/chat", { rid: "rjob-sec-00001", channel: "dgit", text: "API_KEY=abcd1234efgh5678 붙여 둠" });
  assert.equal(r.status, 202); assert.equal(t.calls.length, 0); assert.equal(t.rows().length, 1);
  assert.match(t.rows()[0].body, /^v1\./); assert.ok(!t.rows()[0].body.includes("abcd1234efgh5678"));
  assert.equal((await t.relay("POST", "/api/relay/jobs/take", {}, "wrong")).status, 403);
  const take = await (await t.relay("POST", "/api/relay/jobs/take", {})).json() as { jobs: { body: string }[] };
  assert.equal(JSON.parse(take.jobs[0].body).text, "API_KEY=abcd1234efgh5678 붙여 둠");
  await t.relay("POST", "/api/relay/jobs/rjob-sec-00001", { status: 400, result: { ok: false, error: "비밀 거절" } });
  assert.equal(t.rows()[0].body, "");
});

test("읽음과 글은 다른 줄 — 읽음이 맡겨진 채여도 글은 바로 내줌", async () => {
  const t = await setup();
  await t.send("/api/chat", { rid: "rjob-seen-0101", channel: "dgit", thread: "1793900000.000001", seen: true });
  await t.send("/api/chat", { rid: "rjob-post-0101", channel: "dgit", text: "보낸 글" });
  const a = await (await t.relay("POST", "/api/relay/jobs/take", { limit: 10 })).json() as { jobs: { rid: string }[] };
  assert.deepEqual(a.jobs.map(j => j.rid), ["rjob-seen-0101", "rjob-post-0101"]);
});

test("판 넣기 기다림이 30초 멈추면 unknown 404 · 실행기가 기록을 다시 올리면 정상 답", async () => {
  const t = await setup();
  await t.send("/api/chat", { rid: "rjob-stuck-001", channel: "dgit", text: "x" });
  await t.relay("POST", "/api/relay/jobs/take", { limit: 1 });
  await t.relay("POST", "/api/relay/jobs/rjob-stuck-001", { status: 202, result: { ok: true, rid: "rjob-stuck-001", state: "queued" } });
  assert.equal((await (await t.get("/api/answer/rjob-stuck-001")).json() as { state: string }).state, "queued");
  assert.equal(t.calls.length, 0);
  t.db.prepare("UPDATE owner_job SET upd_at = ?, done_at = ? WHERE rid = 'rjob-stuck-001'").run(Date.now() - OJ.STUCK - 1, Date.now() - OJ.STUCK - 1);
  const r = await t.get("/api/answer/rjob-stuck-001");
  assert.equal(r.status, 404); assert.deepEqual(await r.json(), { rid: "rjob-stuck-001", state: "unknown" }); assert.equal(t.calls.length, 0);
  await t.relay("POST", "/api/relay/jobs/rjob-stuck-001", { status: 200, result: { ok: true, state: "sent", posted: "1793900000.000100" } });
  assert.equal((await (await t.get("/api/answer/rjob-stuck-001")).json() as { state: string }).state, "sent");
});

test("봉할 키가 없으면 비밀 글을 저장하지 않고 503", async () => {
  const t = await setup(); delete (t.env as { CONNECTOR_KEY?: string }).CONNECTOR_KEY;
  const r = await t.send("/api/chat", { rid: "rjob-nokey-01", channel: "dgit", text: "API_KEY=abcd1234efgh5678" });
  assert.equal(r.status, 503); assert.equal(t.rows().length, 0); assert.equal(t.calls.length, 0);
});

for (const [name, value] of [
  ["NBSP", "API_KEY=1234\u00a05678"],
  ["앞 빈칸 JSON", '  {"api_key":"가나다라마바사아"}'],
  ["앞 빈칸 JSON 배열", ' \n [{"key":"짧은값"}]'],
] as const) for (const field of ["text", "edit"] as const) {
  test(`${name} ${field}: 키 없음은 503 · 저장 없음`, async () => {
    const t = await setup(); delete (t.env as { CONNECTOR_KEY?: string }).CONNECTOR_KEY;
    const body = { rid: "rjob-secret-forms", channel: "dgit", ts: "1793900000.000001", [field]: value };
    const r = await t.send("/api/chat", body);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("x-retry-safe"), "1");
    assert.equal(t.rows().length, 0); assert.equal(t.calls.length, 0);
  });

  test(`${name} ${field}: 봉해 저장 · 인증된 relay take 에서만 원문 복원`, async () => {
    const t = await setup();
    const body = { rid: "rjob-secret-forms", channel: "dgit", ts: "1793900000.000001", [field]: value };
    assert.equal((await t.send("/api/chat", body)).status, 202);
    assert.equal(t.rows().length, 1);
    const stored = t.rows()[0].body;
    assert.match(stored, /^v1\./); assert.ok(!stored.includes(value));
    assert.equal((await t.send("/api/relay/jobs/take", {})).status, 403, "브라우저 쿠키만으로 복원됨");
    assert.equal((await t.relay("POST", "/api/relay/jobs/take", {}, "wrong")).status, 403);
    assert.equal(t.rows()[0].tries, 0, "거절된 take 가 줄을 맡음");
    const r = await t.relay("POST", "/api/relay/jobs/take", {});
    assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
    const take = await r.json() as { jobs: { body: string }[] };
    assert.equal(take.jobs.length, 1); assert.deepEqual(JSON.parse(take.jobs[0].body), body);
    assert.equal(t.rows()[0].body, stored, "take 가 저장 몸통을 평문으로 바꿈");
    assert.equal(t.calls.length, 0);
  });
}

test("일반 글과 수정은 키 없이도 받음 · JSON 안의 유니코드 이스케이프 비밀도 봉함", async () => {
  for (const field of ["text", "edit"] as const) {
    const t = await setup(); delete (t.env as { CONNECTOR_KEY?: string }).CONNECTOR_KEY;
    assert.equal((await t.send("/api/chat", { rid: "rjob-plain-nokey", channel: "dgit", [field]: "일반 글 https://example.test/long-url-does-not-need-key" })).status, 202);
    assert.equal(t.rows().length, 1);
  }
  const t = await setup(); delete (t.env as { CONNECTOR_KEY?: string }).CONNECTOR_KEY;
  const r = await t.send("/api/chat", '{"rid":"rjob-escaped-secret","channel":"dgit","edit":"API_KEY=1234\\u00a05678"}');
  assert.equal(r.status, 503); assert.equal(t.rows().length, 0);
});

test("모르는 rid 는 unknown 404 · D1 장애는 모름으로 숨기지 않고 503", async () => {
  const t = await setup();
  const unknown = await t.get("/api/answer/rjob-unknown-01");
  assert.equal(unknown.status, 404); assert.deepEqual(await unknown.json(), { rid: "rjob-unknown-01", state: "unknown" });
  const prepare = t.env.DB.prepare.bind(t.env.DB);
  t.env.DB.prepare = (sql: string) => { if (sql.startsWith("SELECT done_at")) throw new Error("DB 읽기 실패"); return prepare(sql); };
  assert.equal((await t.get("/api/answer/rjob-unknown-02")).status, 503);
  assert.equal(t.calls.length, 0);
});
