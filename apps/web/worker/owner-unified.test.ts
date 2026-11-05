// node --test --no-warnings --experimental-transform-types apps/web/worker/owner-unified.test.ts
// 주인 · 회원 한 길 ④-가 화면 전환(스위치 owner_unified — 계정별, design-owner-unify.md PR6).
//   끔 = 지금 그대로(주인 다리 · 스냅숏 길), 켬 = 주인 화면 요청이 다리 호출 0 으로 회원 길(D1, 열쇠 canon), 회원 회귀 없음, 역할(초대 등) 기능 유지.
// 진짜 index.ts(app.fetch) + 메모리 SQLite. 메일 · 토큰 · 열쇠는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
(globalThis as any).HTMLRewriter ??= class { on() { return this; } transform(r: Response) { return r; } };   // 틀 얹기는 이 시험의 관심 밖 — 답 머리(x-boarder-src)만 봄
const { default: app } = await import("./index.ts");
const ledger = await import("./ledger.ts");
const W = await import("./who.ts");
const live = await import("./live.ts");
const { _resetVaultCache } = await import("./vault/index.ts");
const { Engine } = await import("./engine.ts");
const MB = await import("./member-board.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", e); return new Response("{}", { status: 500 }); });

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a.map(x => typeof x === "boolean" ? Number(x) : x)),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => run1(sql, args),
  });
  const D1: any = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = ss.map(s => /^\s*(select|with)/i.test(s.sql) || /\breturning\b/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; } },
  };
  D1.withSession = () => D1;
  return { db, D1: D1 as D1Database };
}
const OWNER = "owner@example.test", OWNER2 = "owner-alt@example.test", MEMBER = "member@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up", ADMIN = "admin-token-made-up";
const OFULL = "bxd_made-up-owner-full-0123456789abcdef0", MDEV = "bxd_made-up-member-device-0123456789abcde", ATOK = "bxa_made-up-owner-agent-token-0123456789abcdef";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
const PAGE = JSON.stringify({ ver: "v1", html: '<!doctype html><html><head></head><body><script>window.D = __BX_DATA__; window.T = "__BX_DTAG__"</script></body></html>' });

async function setup() {
  const { db, D1 } = d1(), T = Date.now();
  _resetVaultCache(); W.setCanonOn(false);
  await ledger.setFlag(D1, "owner_unified", false);   // 스위치 캐시(isolate 10초)를 이 DB 로 비움
  await ledger.setFlag(D1, "owner_unified_prep", true);
  await ledger.f7On(D1, "__reset__");
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)");
  dev.run("devOF", OWNER, "owner laptop", "", await sha(OFULL), T, T, "full");   // owner_unified_prep 이 옮긴 뒤 꼴(owner = canon, full)
  dev.run("devM", MEMBER, "laptop", "", await sha(MDEV), T, T, "full");
  db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, tools, owner, device_id) VALUES (?,?,?,?,?,'*',?,?)").run(await sha(ATOK), "%77", "총괄", "owner-host", T, "", null);
  const bot = db.prepare("INSERT INTO member_bot (owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?)");
  bot.run("@owner", "s1", 10, "총괄", "", "", "", T);
  bot.run(OWNER, "s1", 10, "총괄", "", "", "", T);   // owner_unified_prep face 가 옮긴 canon 줄
  bot.run(MEMBER, "s2", 20, "모찌", "", "", "", T);
  const bridge: string[] = [], cells: string[] = [], bumps: string[] = [];
  const call = async (r: { path: string }) => { bridge.push(r.path); return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"ok":true,"from":"bridge"}') }; };
  const tool = async (name: string) => { bridge.push("tool:" + name); return { ok: true, from: "bridge" }; };
  const snaps: Record<string, string> = { data: '{"from":"snap-data"}', topics: '{"from":"snap-topics"}', page: PAGE, sync: "{}" };
  const rids = new Map<string, Map<string, { status: number } | null>>();   // rid 칸(DO)마다 받은 rid — 끝나면 답 상태
  const ridCell = (n: string) => { let m = rids.get(n); if (!m) rids.set(n, m = new Map()); return m; };
  const SNAP = { idFromName: (n: string) => n, get: (n: string) => { cells.push(n); return {
    get: async (k: string) => k in snaps ? { body: snaps[k], etag: `"e-${k}"`, at: Date.now(), checked: Date.now() } : null,
    tags: async () => ({ t: { data: "d-" + n }, age: 0, boot: "b" }), bump: async () => { bumps.push(n); return 0; },
    claim: async (rid: string) => { const m = ridCell(n), v = m.get(rid); if (v) return { state: "done", status: v.status, body: "", ct: "application/json" }; if (m.has(rid)) return { state: "busy" }; m.set(rid, null); return { state: "new" }; },
    done: async (rid: string, status: number) => { ridCell(n).set(rid, { status }); return 0; }, release: async (rid: string) => { ridCell(n).delete(rid); return 0; },
    look: async (rid: string) => ridCell(n).get(rid) ? "done" : "none",
  }; } };
  const r2 = new Map<string, unknown>();
  const RESULTS = { list: async () => ({ objects: [], truncated: false }), head: async () => null, get: async (k: string) => r2.get(k) ?? null, put: async (k: string, v: unknown) => { r2.set(k, v); }, delete: async (k: string) => { r2.delete(k); } };
  const env: any = { DB: D1, RESULTS, SNAP, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: `${OWNER},${OWNER2}`, PUBLIC_URL: "https://example.test", ADMIN_TOKEN: ADMIN,
    ASSETS: { fetch: async () => new Response("nf") }, BRIDGE: { idFromName: (n: string) => n, get: () => ({ call, tool }) },
    ENGINE: { idFromName: (n: string) => n, get: () => ({ revoke: async () => 0 }) }, PUSH: { idFromName: (n: string) => n, get: () => ({}) } };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p.catch(() => {})); }, passThroughOnException() {} };
  const req = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    for (let i = 0; i < 20 && pending.length; i++) await Promise.all(pending.splice(0));   // 뒤 작업(rid 칸 끝남 등)까지
    return { status: r.status, j, text, h: r.headers };
  };
  const adm = { authorization: `Bearer ${ADMIN}` };
  const flag = async (name: string, on: boolean) => { const r = await req("POST", "/api/admin/f7-flag", { name, on }, adm); assert.equal(r.status, 200, r.text); };
  const human = async (email: string) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  const reset = () => { bridge.length = 0; cells.length = 0; bumps.length = 0; };
  return { db, D1, env, ctx, r2, req, adm, flag, human, bridge, cells, bumps, reset };
}

test("스위치 이름: owner_unified · owner_unified:<주인 메일>(대문자도 소문자로) 받음, 회원 메일 · 꼴이 틀린 이름은 400", async () => {
  const t = await setup();
  await t.flag("owner_unified", true); await t.flag("owner_unified", false);
  assert.equal((await t.req("POST", "/api/admin/f7-flag", { name: "owner_unified:Owner-Alt@Example.test", on: true }, t.adm)).status, 200);
  assert.ok(t.db.prepare("SELECT 1 FROM f7_flag WHERE name = ? AND on_at IS NOT NULL").get("owner_unified:" + OWNER2));
  assert.equal((await t.req("POST", "/api/admin/f7-flag", { name: "owner_unified:" + MEMBER, on: true }, t.adm)).status, 400, "회원 메일은 안 받음");
  assert.equal((await t.req("POST", "/api/admin/f7-flag", { name: "owner_unifiedx", on: true }, t.adm)).status, 400);
});

test("끔: 주인 / · /api/data · /api/chat/primary · POST /api/chat 은 지금 그대로 주인 길(스냅숏 · 다리)", async () => {
  const t = await setup(), h = await t.human(OWNER);
  const pg = await t.req("GET", "/", undefined, h);
  assert.notEqual(pg.h.get("x-boarder-src"), "member", "끔인데 회원 화면");
  const d = await t.req("GET", "/api/data", undefined, h);
  assert.equal(d.j?.from, "snap-data", "끔인데 스냅숏 아님");
  t.reset();
  await t.req("GET", "/api/chat/primary", undefined, h);
  assert.deepEqual(t.bridge, ["/api/chat/primary"], "끔이면 채팅 읽기는 다리(read_chat 꺼짐)");
  t.reset();
  await t.req("POST", "/api/chat", { text: "안녕", channel: "primary" }, h);
  assert.deepEqual(t.bridge, ["/api/chat"], "끔이면 쓰기는 다리");
  assert.equal(t.db.prepare("SELECT count(*) n FROM board_log").get()!.n, 0, "끔이면 D1 보드 줄 없음");
  assert.equal((await t.req("GET", "/api/me/onboarding", undefined, h)).status, 403, "끔이면 주인은 회원 온보딩 밖(예전)");
  assert.equal((await t.req("POST", "/api/me/chat", { text: "x" }, h)).status, 403, "끔이면 memberOnly 가 주인 거절(예전)");
});

test("켬(owner_unified): 주인 화면 요청이 다리 호출 0 으로 회원 길 — 열쇠는 canon", async () => {
  const t = await setup(), h = await t.human(OWNER);
  await t.flag("owner_unified", true); t.reset();
  const pg = await t.req("GET", "/", undefined, h);
  assert.equal(pg.status, 200, pg.text); assert.equal(pg.h.get("x-boarder-src"), "member");
  const d = await t.req("GET", "/api/data", undefined, h);
  assert.equal(d.status, 200, d.text); assert.notEqual(d.j?.from, "snap-data"); assert.equal(d.h.get("x-boarder-src"), "member");
  const ch = await t.req("GET", "/api/chat/primary", undefined, h);
  assert.equal(ch.status, 200, ch.text); assert.notEqual(ch.j?.from, "bridge");
  const w = await t.req("POST", "/api/chat", { text: "주인 글", channel: "primary", rid: "rid-owner-1" }, h);
  assert.equal(w.status, 200, w.text); assert.equal(w.j?.ok, true, w.text);
  assert.ok(t.db.prepare("SELECT 1 FROM board_log WHERE owner = ? AND text = ?").get(OWNER, "주인 글"), "글이 canon 회원 보드(D1)에");
  for (const p of ["/api/me/onboarding", "/api/me/nodes/avatar", "/api/me/nodeset", "/api/me/bot", "/api/me/board"]) {
    const r = await t.req("GET", p, undefined, h); assert.equal(r.status, 200, `${p} ${r.text}`);
  }
  assert.equal((await t.req("GET", "/api/me/bot", undefined, h)).j?.bot?.name, "총괄", "메인 봇 = canon 줄");
  assert.deepEqual(t.bridge, [], "켬인데 다리 호출이 있음");
});

test("켬: 주인 다른 로그인 메일(OWNER2)도 canon 열쇠 · 계정별 owner_unified:<메일> 은 그 메일만", async () => {
  const t = await setup();
  await t.flag("owner_unified:" + OWNER2, true); t.reset();
  const w = await t.req("POST", "/api/chat", { text: "둘째 메일 글", channel: "primary" }, await t.human(OWNER2));
  assert.equal(w.status, 200, w.text);
  assert.ok(t.db.prepare("SELECT 1 FROM board_log WHERE owner = ? AND text = ?").get(OWNER, "둘째 메일 글"), "OWNER2 로 써도 canon 줄");
  assert.deepEqual(t.bridge, []);
  const d = await t.req("GET", "/api/data", undefined, await t.human(OWNER));
  assert.equal(d.j?.from, "snap-data", "켜지 않은 OWNER 메일은 그대로 주인 길");
});

test("켬: 실시간 칸 · 화면 알림이 회원 쪽(live:<canon>) — 끄면 주인 칸 하나", async () => {
  const t = await setup(), h = await t.human(OWNER);
  await ledger.setFlag(t.D1, "read_live", true);
  t.reset(); await ledger.f7On(t.D1, "__reset__");
  await live.bumpMember(t.env, OWNER);
  assert.deepEqual(t.bumps, [live.OWNER_SNAP], "끄면 주인 알림은 스냅숏 칸 하나(예전)");
  const off = await t.req("GET", "/api/live", undefined, h);
  assert.equal(off.j?.t?.data, `d-${live.OWNER_SNAP}`, "끄면 주인 폴링 표 = 스냅숏 칸(예전)");
  await t.flag("owner_unified", true); t.reset();
  await live.bumpMember(t.env, OWNER);
  assert.deepEqual(t.bumps.sort(), [live.OWNER_SNAP, `live:${OWNER}@apac`].sort(), "켜면 canon 회원 칸에도");
  const on = await t.req("GET", "/api/live", undefined, h);
  assert.equal(on.j?.t?.data, `d-live:${OWNER}@apac`, on.text);
  t.reset();
  assert.equal((await t.req("POST", "/api/chat", { text: "알림 글", channel: "primary" }, h)).status, 200);
  assert.ok(t.bumps.includes(`live:${OWNER}@apac`), "쓰기 뒤 canon 화면 칸 알림");
});

test("rid 칸: 주인은 켬 · 끔 모두 rid:owner — 끔에서 받은 rid 를 켬에서 다시 보내면 「이미 됨」(두 번 안 씀)", async () => {
  const t = await setup(), h = await t.human(OWNER);
  await ledger.setFlag(t.D1, "write_queue", true); await ledger.f7On(t.D1, "__reset__");
  const w1 = await t.req("POST", "/api/chat", { text: "한 번만", channel: "primary", rid: "rid-same-1" }, h);
  assert.equal(w1.status, 200, w1.text); assert.deepEqual(t.bridge, ["/api/chat"], "끔 = 다리로 씀");
  await t.flag("owner_unified", true); t.reset();
  const w2 = await t.req("POST", "/api/chat", { text: "한 번만", channel: "primary", rid: "rid-same-1" }, h);
  assert.equal(w2.h.get("x-rid"), "replay", "켬에서 같은 rid 가 새로 처리됨 — " + w2.text);
  assert.deepEqual(t.bridge, []); assert.equal(t.db.prepare("SELECT count(*) n FROM board_log WHERE text = '한 번만'").get()!.n, 0, "D1 에 또 쓰지 않음");
  assert.ok(t.cells.includes("rid:owner@apac") && !t.cells.includes(`rid:${OWNER}@apac`), t.cells.join(","));
  const w3 = await t.req("POST", "/api/chat", { text: "켬 새 글", channel: "primary", rid: "rid-new-2" }, h);
  assert.equal(w3.status, 200, w3.text);
  const a = await t.req("GET", "/api/answer/rid-new-2", undefined, h);
  assert.equal(a.j?.state, "ok", "켬에서 쓴 rid 의 답도 rid:owner 칸 — " + a.text);
});

test("켬: 주인 full 기기 창 토큰 · 음성이 열림(canon 보드) — 끄면 예전처럼 거절", async () => {
  const t = await setup(), dv = { authorization: `Bearer ${OFULL}` };
  assert.equal((await t.req("POST", "/api/device/window", { key: "tmux:work:1", name: "창" }, dv)).status, 401);
  assert.equal((await t.req("POST", "/api/device/voice", { op: "x" }, dv)).status, 401);
  await t.flag("owner_unified", true);
  const r = await t.req("POST", "/api/device/window", { key: "tmux:work:1", name: "창" }, dv);
  assert.equal(r.status, 200, r.text);
  assert.equal((t.db.prepare("SELECT owner FROM agent_token WHERE device_id = 'devOF'").get() as { owner: string }).owner, OWNER, "창 토큰 owner = canon");
  assert.notEqual((await t.req("POST", "/api/device/voice", { op: "x" }, dv)).status, 401);
  const tok = r.j.token as string, at = { authorization: `Bearer ${tok}` };
  assert.notEqual((await t.req("POST", "/api/agent/__none__", {}, at)).status, 401, "켬이면 그 창 토큰이 삶");
  await t.flag("owner_unified", false);
  assert.equal((await t.req("POST", "/api/agent/__none__", {}, at)).status, 401, "끄면 켠 동안 만든 주인 기기 창 토큰은 죽음");
  await t.flag("owner_unified:" + OWNER, true);
  assert.equal((await t.req("POST", "/api/device/window", { key: "tmux:work:2", name: "창" }, dv)).status, 401, "메일별 스위치는 화면만 — 주인 기기 창 토큰 안 만듦");
  assert.equal((await t.req("POST", "/api/agent/__none__", {}, at)).status, 401);
  assert.equal((await t.req("POST", "/api/device/window", { key: "tmux:m:1", name: "m" }, { authorization: `Bearer ${MDEV}` })).status, 200, "회원 기기 그대로");
});

test("전체 켬: 주인 창 토큰(owner 빈 값)의 도구가 canon D1 보드로 — 끄면 · 메일별이면 다리", async () => {
  const t = await setup(), ag = { authorization: `Bearer ${ATOK}` };
  t.reset();
  const tools = () => t.bridge.filter(x => x !== "tool:flag");
  await t.req("POST", "/api/agent/inbox_status", { text: "끔 상태" }, ag);
  assert.deepEqual(tools(), ["tool:inbox_status"], "끄면 다리 도구");
  await t.flag("owner_unified:" + OWNER, true); t.reset();
  await t.req("POST", "/api/agent/inbox_status", { text: "메일별 상태" }, ag);
  assert.deepEqual(tools(), ["tool:inbox_status"], "메일별 스위치는 화면만 — 에이전트 글은 그대로 다리");
  await t.flag("owner_unified", true); t.reset();
  const r = await t.req("POST", "/api/agent/inbox_status", { text: "켬 상태" }, ag);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(tools(), [], "켜면 다리 0");
  assert.ok(t.db.prepare("SELECT 1 FROM board_log WHERE owner = ? AND text = ?").get(OWNER, "켬 상태"), "canon 보드 줄");
});

test("회원 회귀 없음 · 역할 기능은 그대로 주인에게(켬이어도)", async () => {
  const t = await setup(), hm = await t.human(MEMBER), ho = await t.human(OWNER);
  for (const on of [false, true]) {
    await t.flag("owner_unified", on); t.reset();
    const w = await t.req("POST", "/api/chat", { text: "회원 글 " + on, channel: "primary" }, hm);
    assert.equal(w.status, 200, w.text);
    assert.ok(t.db.prepare("SELECT 1 FROM board_log WHERE owner = ? AND text = ?").get(MEMBER, "회원 글 " + on));
    const d = await t.req("GET", "/api/data", undefined, hm); assert.equal(d.h.get("x-boarder-src"), "member");
    assert.deepEqual(t.bridge, []);
    t.reset(); await live.bumpMember(t.env, MEMBER); assert.deepEqual(t.bumps, [`live:${MEMBER}@apac`], "회원 알림은 제 칸 하나");
    assert.equal((await t.req("GET", "/api/me/invites", undefined, ho)).status, 200, "초대 목록은 주인(역할)");
    assert.equal((await t.req("GET", "/api/me/invites", undefined, hm)).status, 403);
  }
});

test("켬: canon 회원 보드 load 가 주인 하네스 판을 읽음 — 끄면 안 읽음(회원 load 조회 그대로)", async () => {
  const t = await setup(), h = await t.human(OWNER), T = Date.now();
  t.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devH", OWNER, "owner-host harness", "", "h1", T, T, "harness", T);
  await new (Engine as any)({ setWebSocketAutoResponse() {} }, { DB: t.D1 }).hsync([{ id: "ew_pane40", state: "busy", name: "지어낸 일", meta: { pane: "%40", win: "5 지어낸 일", role: "리드", cwd: "~/src/x" } }], true, "devH", OWNER, T);
  MB.setHarnessKey("");
  assert.equal((await MB.load(t.D1, OWNER)).harness.length, 0, "끄면(설정값 빈 것) 하네스 판을 안 읽음");
  await t.flag("owner_unified", true);
  const d = await t.req("GET", "/api/data", undefined, h);
  assert.equal(d.status, 200, d.text);
  assert.ok((d.j.panes as any[]).some(p => p.harness && p.pane === "%40"), "켬이면 주인 하네스 판이 canon 보드에 — " + d.text.slice(0, 200));
  assert.equal((await MB.load(t.D1, MEMBER)).harness.length, 0, "회원 load 는 하네스 판 조회 없음");
  await t.flag("owner_unified", false);
  await t.req("GET", "/api/data", undefined, await t.human(MEMBER));   // 미들웨어가 설정값을 다시 맞춤(꺼짐 → "")
  assert.equal((await MB.load(t.D1, OWNER)).harness.length, 0);
});

test("owner_unified 는 owner_unified_prep 이 켜져 있어야 켜짐(409) — 끄기는 늘 됨", async () => {
  const t = await setup();
  await ledger.setFlag(t.D1, "owner_unified_prep", false);
  for (const n of ["owner_unified", "owner_unified:" + OWNER2]) assert.equal((await t.req("POST", "/api/admin/f7-flag", { name: n, on: true }, t.adm)).status, 409, n);
  assert.equal((await t.req("POST", "/api/admin/f7-flag", { name: "owner_unified", on: false }, t.adm)).status, 200);
});

test("켬: nodereopen · 할 일은 canon 회원 길(다리 0), 주인 메일 넷이 올린 파일이 열림", async () => {
  const t = await setup(), h = await t.human(OWNER);
  t.r2.set("mfiles/0123456789abcdef0123456789abcdef", { body: "글", customMetadata: { owner: OWNER2, name: "a.txt" }, writeHttpMetadata: (x: Headers) => x.set("content-type", "text/plain") });
  assert.equal((await t.req("GET", "/api/file/0123456789abcdef0123456789abcdef", undefined, h)).status, 404, "끔 = 지금 그대로(주인 길은 그 로그인 메일이 올린 것만)");
  await t.flag("owner_unified", true); t.reset();
  const nr = await t.req("POST", "/api/me/nodereopen", { name: "보관 노드" }, h);
  assert.equal(nr.status, 404, nr.text);
  const td = await t.req("GET", "/api/todos", undefined, h);
  assert.ok(td.status < 500, td.text);
  const f = await t.req("GET", "/api/file/0123456789abcdef0123456789abcdef", undefined, h);
  assert.equal(f.status, 200, "켬이면 OWNER2 가 올린 파일도 canon 회원 길에서 — " + f.text);
  assert.equal((await t.req("GET", "/api/file/0123456789abcdef0123456789abcdef", undefined, await t.human(MEMBER))).status, 404, "회원은 남의 파일 못 봄");
  assert.deepEqual(t.bridge, []);
});

test("켬: 하네스 MCP 읽기(조용한 POST)는 canon 의 나눠 쓰는 load 를 안 버림 — 쓰기는 버림", async () => {
  const t = await setup(), ag = { authorization: `Bearer ${ATOK}` };
  await t.flag("owner_unified", true);
  const p1 = MB.loadRead(t.D1, OWNER, t.ctx);
  await t.req("POST", "/api/agent/promise_list", {}, ag);
  assert.equal(MB.loadRead(t.D1, OWNER, t.ctx), p1, "읽기 도구 뒤에 나눠 쓰던 load 가 버려짐");
  await t.req("POST", "/api/agent/inbox_status", { text: "쓰기" }, ag);
  assert.notEqual(MB.loadRead(t.D1, OWNER, t.ctx), p1, "쓰기 뒤엔 버림");
});
