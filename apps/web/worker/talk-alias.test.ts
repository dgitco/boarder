import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import * as OR from "./owner-read.ts";
const TA = OR;

const NOW = Date.UTC(2026, 10, 6, 3) / 1000;
test("꼴: 올해 글은 MMDD-n, 다른 해는 그대로 · 해 없는 꼴은 오늘 이하 가장 가까운 해", () => {
  assert.equal(TA.ALIAS_MODE, "A");
  assert.equal(TA.aliasShow("2026-1106-3", NOW), "1106-3");
  assert.equal(TA.aliasShow("2025-1231-12", NOW), "2025-1231-12");
  assert.equal(TA.aliasShow("2025-1231-12", Date.UTC(2025, 11, 31, 14, 59) / 1000), "1231-12", "KST 로 아직 12/31");
  assert.equal(TA.aliasShow("2025-1231-12", Date.UTC(2025, 11, 31, 15) / 1000), "2025-1231-12", "KST 로 새해");
  assert.deepEqual(TA.aliasKey("1106-3", NOW), { key: "2026-1106-3", k: 0 });
  assert.deepEqual(TA.aliasKey("1106-3.2", NOW), { key: "2026-1106-3", k: 2 });
  assert.deepEqual(TA.aliasKey("1231-5", NOW), { key: "2025-1231-5", k: 0 }, "아직 안 온 날짜 = 지난해");
  assert.deepEqual(TA.aliasKey("2024-0105-1.7", NOW), { key: "2024-0105-1", k: 7 });
  for (const bad of ["", "1306-1", "1106-0", "1106-3.0", "1106", "p1a2b3c4", "2025-1106", "1106-3-x", "1106-3."]) assert.equal(TA.aliasKey(bad, NOW), null, bad);
});

test("화면 머리(board.html HBR)의 꼴 글자 = Worker 꼴 글자", () => {
  const board = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
  const m = /ALIAS_MODE = ['"](\w)['"], ALIAS_A = ('[^']+'|"[^"]+"), ALIAS_B = ('[^']+'|"[^"]+")[;,\n]/.exec(board)!;
  assert.ok(m, "머리에 꼴 글자가 없음");
  const lit = (s: string) => new Function(`return ${s}`)() as string;
  assert.equal(m[1], TA.ALIAS_MODE); assert.equal(lit(m[2]), TA.ALIAS_A); assert.equal(lit(m[3]), TA.ALIAS_B);
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const re = new Function(`return ${index.match(/export const APP_PATH = (\/.*\/);/)![1]}`)() as RegExp;
  for (const p of ["/m/1106-3", "/m/1106-3.2", "/m/1106-3-" + encodeURIComponent("오늘-회의"), "/m/2025-1231-12.4-x", "/m/57-x"]) assert.ok(re.test(p), p);
  for (const p of ["/m/1106-3/x", "/m/"]) assert.ok(!re.test(p), p);
});

// ── D1(이주 전부) ──
function d1Of(noTable = false) {
  const db = new DatabaseSync(":memory:", { limits: { compoundSelect: 5 } });
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  if (noTable) db.exec("DROP TABLE wl_talk_alias");
  const n = { round: 0 };
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    rows: () => db.prepare(sql).all(...(args as never[])).map(o => ({ ...o })),
    async all() { n.round++; return { results: this.rows(), success: true, meta: {} }; },
    async first() { n.round++; return this.rows()[0] ?? null; },
  });
  const d1 = { prepare: (sql: string) => stmt(sql), async batch(sts: ReturnType<typeof stmt>[]) { n.round++; return sts.map(x => ({ results: x.rows(), success: true, meta: {} })); } };
  return { db, d1: d1 as unknown as D1Database, n };
}
const CFG: OR.Cfg = { channels: { primary: "C2", company: "C3", dgit: "C1", personal: "C4", shop: "C5" } };
const R1 = "1793900000.000100", R2 = "1793900100.000100", R3 = "1793900200.000100";
function seed(db: DatabaseSync) {
  for (const [k, sc] of [...Object.entries(CFG.channels), ["secret", "C99"]]) db.prepare("INSERT INTO wl_talk_chan(id, name, slack_channel) VALUES (?, ?, ?)").run(k, k, sc);
  const m = db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, deleted_at, source) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'cli')");
  m.run(R1, "primary", null, "owner", null, "첫 뿌리", 1793900000.0001, null);
  m.run("1793900001.000100", "primary", R1, "agent", "a", "답 하나", 1793900001.0001, null);
  m.run("1793900002.000100", "primary", R1, "agent", "a", "지운 답", 1793900002.0001, 1793900009);
  m.run("1793900003.000100", "primary", R1, "agent", "a", "답 셋", 1793900003.0001, null);
  m.run(R2, "dgit", null, "owner", null, "영역 뿌리", 1793900100.0001, null);
  m.run(R3, "primary", null, "agent", "a", "번호 없는 뿌리", 1793900200.0001, null);
  m.run("1793900300.000100", "secret", null, "owner", null, "등록 안 된 채널", 1793900300.0001, null);
  const a = db.prepare("INSERT INTO wl_talk_alias(id, alias, at) VALUES (?, ?, ?)");
  a.run(R1, "2026-1106-1", 1); a.run(R2, "2025-1231-4", 2); a.run("1793900300.000100", "2026-1106-2", 3);
}
type M = { ts: string; alias?: string; ch?: string };

test("#메인 · 채널 글: 번호 매긴 뿌리는 alias(보이는 꼴), 없는 뿌리는 칸 없음", async () => {
  const { db, d1 } = d1Of(); seed(db);
  const o = await OR.build(d1, CFG, OR.route("/api/chat/main")!, NOW, true, false, []) as { body: { messages: M[] } };
  const by = Object.fromEntries(o.body.messages.map(x => [x.ts, x.alias]));
  assert.deepEqual(by, { [R1]: "1106-1", [R2]: "2025-1231-4", [R3]: undefined });
  const ch = await OR.build(d1, CFG, OR.route("/api/chat/dgit")!, NOW) as { body: { messages: M[] } };
  assert.deepEqual(ch.body.messages.map(x => x.alias), ["2025-1231-4"]);
});
function seed2(db: DatabaseSync) {   // 표 없는 DB 에 같은 글(번호 줄 없이)
  for (const [k, sc] of Object.entries(CFG.channels)) db.prepare("INSERT INTO wl_talk_chan(id, name, slack_channel) VALUES (?, ?, ?)").run(k, k, sc);
  db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, text, at, source) VALUES (?, 'primary', NULL, 'owner', 'x', 1, 'cli')").run(R1);
}

test("표가 아직 없어도(이주 전) 채널 · 스레드 읽기 그대로 · alias 칸 없음", async () => {
  const { db, d1 } = d1Of(true); seed2(db);
  const o = await OR.build(d1, CFG, OR.route("/api/chat/main")!, NOW, true, false, []) as { status: number; body: { messages: M[] } };
  assert.equal(o.status, 200); assert.equal(o.body.messages.length, 1); assert.equal(o.body.messages[0].alias, undefined);
  const t = await OR.build(d1, CFG, OR.route(`/api/chat/primary/${R1}`)!, NOW) as { status: number; body: { messages: M[] } };
  assert.equal(t.status, 200); assert.equal(t.body.messages[0].alias, undefined);
});

test("스레드: 뿌리 = 표의 id, 답 = <뿌리>.<차례>(지운 답도 셈 — 셋째 답은 .3)", async () => {
  const { db, d1 } = d1Of(); seed(db);
  const t = await OR.build(d1, CFG, OR.route(`/api/chat/primary/${R1}`)!, NOW) as { body: { messages: M[] } };
  assert.deepEqual(t.body.messages.map(x => [x.ts, x.alias]), [[R1, "1106-1"], ["1793900001.000100", "1106-1.1"], ["1793900003.000100", "1106-1.3"]]);
  const u = await OR.build(d1, CFG, OR.route(`/api/chat/primary/${R3}`)!, NOW) as { body: { messages: M[] } };
  assert.equal(u.body.messages[0].alias, undefined, "번호 없는 스레드는 칸 없음");
});

test("/api/m: 보이는 꼴 · 전체 키 · 답 차례 → 글 자리, 없는 글 · 없는 차례 · 등록 안 된 채널 · 엉뚱한 꼴 = 404", async () => {
  const { db, d1 } = d1Of(); seed(db);
  const get = async (x: string) => { const rt = OR.route("/api/m/" + x); if (!rt) return { status: 0, body: null }; return OR.build(d1, CFG, rt, NOW) as Promise<{ status: number; body: unknown }>; };
  assert.deepEqual(await get("1106-1"), { status: 200, body: { chan: "primary", ts: R1, m: null } });
  assert.deepEqual(await get("2026-1106-1"), { status: 200, body: { chan: "primary", ts: R1, m: null } });
  assert.deepEqual(await get("1106-1.3"), { status: 200, body: { chan: "primary", ts: R1, m: "1793900003.000100" } });
  assert.deepEqual(await get("1106-1.2"), { status: 200, body: { chan: "primary", ts: R1, m: "1793900002.000100" } }, "지운 답도 자리(화면이 「삭제됐어요」)");
  assert.deepEqual(await get("1231-4"), { status: 200, body: { chan: "dgit", ts: R2, m: null } }, "해 없는 지난해 꼴");
  for (const x of ["1106-9", "1106-1.4", "1106-2", "1306-1", "x"]) assert.equal((await get(x)).status === 200, false, x);
  assert.equal((await get("1106-2")).status, 404, "등록 안 된 채널 글은 없는 것과 같음");
  assert.equal(OR.route("/api/m/1106-1/x"), null);
});

// ── 앱 통째(index.ts): 주인은 스위치(read_chat)와 상관없이 D1, 회원 길로는 안 샘 ──
register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
const OWNER = "owner@example.test", MEMBER = "member@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email: string) {
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
function appEnv() {
  const { db } = d1Of(); seed(db);
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?, ?, ?)").run(MEMBER, OWNER, Date.now());
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a.map(x => typeof x === "boolean" ? Number(x) : x)),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
  });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => /^\s*select/i.test(s.sql) ? s.all() : s.run())), withSession: () => D1 } as unknown as D1Database;
  const calls: string[] = [], at = Date.now();
  const snaps: Record<string, string> = { cfg: JSON.stringify({ channels: CFG.channels, drafts: {} }), sync: "{}" };
  const SNAP = { idFromName: (n: string) => n, get: () => ({ get: async (k: string) => k in snaps ? { body: snaps[k], etag: `"e-${k}"`, at, checked: at } : null, tags: async () => ({ t: {}, age: 0, boot: "b" }), bump: async () => 0 }) };
  const env = { DB: D1, SNAP, RESULTS: { head: async () => null, put: async () => null, get: async () => null }, ASSETS: { fetch: async () => new Response("nf", { status: 404 }) },
    BRIDGE: { idFromName: (n: string) => n, get: () => ({ call: async (r: { path: string }) => { calls.push(r.path); return { status: 404, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"from":"bridge"}') }; } }) },
    BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const get = async (who: string, path: string) => app.fetch(new Request("https://example.test" + path, { headers: { cookie: await cookie(who) } }), env as never, { waitUntil() {}, passThroughOnException() {} } as never);
  return { calls, get };
}

test("앱: 주인 /api/m 은 스위치가 꺼져 있어도 D1 답(다리 0) · 없는 글 404", async () => {
  const t = appEnv();
  const r = await t.get(OWNER, "/api/m/2026-1106-1.1");
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await r.json(), { chan: "primary", ts: R1, m: "1793900001.000100" });
  assert.equal((await t.get(OWNER, "/api/m/2026-1106-9")).status, 404);
  assert.deepEqual(t.calls, []);
});

test("앱: 회원은 주인 글 자리를 못 봄(200 아님 · 몸통에 글 id 없음)", async () => {
  const t = appEnv();
  const r = await t.get(MEMBER, "/api/m/2026-1106-1");
  assert.notEqual(r.status, 200);
  assert.ok(!(await r.text()).includes(R1));
});

test("대소문자 구분 없이: /M/ · 옛 36진 대문자는 소문자 주소로 넘김, 제목 꼬리 대문자는 그대로 · 우리 링크는 안 넘김 · D1 색인 NOCASE", async () => {
  const { msgPathLower } = await import("./index.ts");
  assert.equal(msgPathLower("/M/1106-3-Some-Title"), "/m/1106-3-Some-Title");
  assert.equal(msgPathLower("/m/P1A2B3C4D_9Z8Y7X6W-Hello"), "/m/p1a2b3c4d_9z8y7x6w-Hello");
  assert.equal(msgPathLower("/m/1106-3-Some-Title"), null, "우리 링크(영어 제목) = 넘김 없음");
  assert.equal(msgPathLower("/m/p1a2b3c4d-Hello"), null);
  assert.equal(msgPathLower("/canvas/hbE69P61Tni5xLgxi4Zi8Cwd"), null, "캔버스 id 는 대소문자가 뜻이 있어 안 건드림");
  const t = appEnv();
  const r = await t.get(OWNER, "/M/1106-3-Hi?x=1");
  assert.equal(r.status, 301); assert.equal(new URL(r.headers.get("location")!, "https://example.test").pathname + new URL(r.headers.get("location")!, "https://example.test").search, "/m/1106-3-Hi?x=1");
  const sql = readFileSync(new URL("../migrations/0085_talk_alias.sql", import.meta.url), "utf8").split("\n").find(l => l.startsWith("CREATE TABLE"))!;
  const db = new DatabaseSync(":memory:"); db.exec(sql);
  db.prepare("INSERT INTO wl_talk_alias VALUES (?, ?, ?)").run("1.1", "2026-ab-1", 0);
  assert.equal((db.prepare("SELECT id FROM wl_talk_alias WHERE alias = ?").get("2026-AB-1") as { id: string } | undefined)?.id, "1.1", "대문자로 찾아도");
  assert.throws(() => db.prepare("INSERT INTO wl_talk_alias VALUES (?, ?, ?)").run("1.2", "2026-AB-1", 0), /UNIQUE/, "대소문자만 다른 번호는 겹침");
});

test("캔버스 주소 제목 꼬리: /canvas/<id>-<제목> 도 화면 경로, 옛 /canvas/<id> 그대로", async () => {
  const { APP_PATH } = await import("./index.ts");
  for (const p of ["/canvas/hbE69P61Tni5xLgxi4Zi8Cwd", "/canvas/hbE69P61Tni5xLgxi4Zi8Cwd-" + encodeURIComponent("보더-id-체계"), "/canvas/XWP2kNDf2h2ARqV75uhE8v-Plan"]) assert.ok(APP_PATH.test(p), p);
  for (const p of ["/canvas/short-x", "/canvas/hbE69P61Tni5xLgxi4Zi8Cwd/x"]) assert.ok(!APP_PATH.test(p), p);
});
