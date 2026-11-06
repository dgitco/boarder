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
// 틀 얹기(boardShell)가 쓰는 것만: head · body 의 prepend(뒤에 부른 것이 맨 앞) · append — 회원 값(HB_CH)을 봄
(globalThis as any).HTMLRewriter = class {
  hs: [string, { element?: (e: unknown) => unknown }][] = [];
  on(sel: string, h: { element?: (e: unknown) => unknown }) { this.hs.push([sel, h]); return this; }
  transform(r: Response) {
    const hs = this.hs;
    const run = async () => {
      let html = await r.text();
      for (const [sel, h] of hs) {
        if ((sel !== "head" && sel !== "body") || !h.element) continue;
        const pre: string[] = [], app: string[] = [];
        await h.element({ prepend: (s: string) => { pre.unshift(s); }, append: (s: string) => { app.push(s); }, setAttribute() {} });
        html = html.replace(new RegExp(`<${sel}[^>]*>`), m => m + pre.join("")).replace(`</${sel}>`, () => app.join("") + `</${sel}>`);
      }
      return html;
    };
    return new Response(new ReadableStream({ async start(ctl) { ctl.enqueue(new TextEncoder().encode(await run())); ctl.close(); } }), { status: r.status, headers: r.headers });
  }
};
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
// 주인 채널 표(cfg 스냅숏): 기본 다섯 + 에이전트 채널 하나
const CFG = JSON.stringify({ channels: { primary: "C1", company: "C2", personal: "C3", dgit: "C4", shop: "C5", harness_lead: "C6" }, drafts: {}, push_key: "made-up-key" });
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
  const bridge: string[] = [], cells: string[] = [], bumps: string[] = [], marks: [string, Record<string, string>][] = [];
  const call = async (r: { path: string }) => { bridge.push(r.path); return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"ok":true,"from":"bridge"}') }; };
  const agents: string[] = [];
  const tool = async (name: string, _a?: unknown, agent?: string) => { bridge.push("tool:" + name); agents.push(String(agent)); return { ok: true, from: "bridge" }; };
  const snaps: Record<string, string> = { data: '{"from":"snap-data"}', topics: '{"from":"snap-topics"}', page: PAGE, sync: "{}", cfg: CFG, history: JSON.stringify({ oldest: 1, rows: [{ open: true, segs: [[1, 9e12, "work"]], marks: [] }] }) };
  const rids = new Map<string, Map<string, { status: number } | null>>();   // rid 칸(DO)마다 받은 rid — 끝나면 답 상태
  const ridCell = (n: string) => { let m = rids.get(n); if (!m) rids.set(n, m = new Map()); return m; };
  const SNAP = { idFromName: (n: string) => n, get: (n: string) => { cells.push(n); return {
    get: async (k: string) => k in snaps ? { body: snaps[k], etag: `"e-${k}"`, at: Date.now(), checked: Date.now() } : null,
    tags: async () => ({ t: { data: "d-" + n, todo: "t-" + n }, age: 0, boot: "b" }), bump: async (bt?: Record<string, string>) => { bumps.push(n); if (bt) marks.push([n, bt]); return 0; },
    putT: async (k: string, b: string) => { const changed = snaps[k] !== b; snaps[k] = b; return { etag: `"e-${k}-${b.length}"`, ms: 0, colo: "x", changed }; },
    claim: async (rid: string) => { const m = ridCell(n), v = m.get(rid); if (v) return { state: "done", status: v.status, body: "", ct: "application/json" }; if (m.has(rid)) return { state: "busy" }; m.set(rid, null); return { state: "new" }; },
    done: async (rid: string, status: number) => { ridCell(n).set(rid, { status }); return 0; }, release: async (rid: string) => { ridCell(n).delete(rid); return 0; },
    look: async (rid: string) => ridCell(n).get(rid) ? "done" : "none",
  }; } };
  const r2 = new Map<string, unknown>();
  const RESULTS = { list: async () => ({ objects: [], truncated: false }), head: async () => null, get: async (k: string) => r2.get(k) ?? null, put: async (k: string, v: unknown) => { r2.set(k, v); }, delete: async (k: string) => { r2.delete(k); } };
  const env: any = { DB: D1, RESULTS, SNAP, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: `${OWNER},${OWNER2}`, PUBLIC_URL: "https://example.test", ADMIN_TOKEN: ADMIN, RELAY_TOKEN: "relay-made-up",
    ASSETS: { fetch: async () => new Response("nf") }, BRIDGE: { idFromName: (n: string) => n, get: () => ({ call, tool }) },
    ENGINE: { idFromName: (n: string) => n, get: () => ({ revoke: async () => 0 }) }, PUSH: { idFromName: (n: string) => n, get: (n: string) => new Proxy({}, { get: (_o, k) => k === "then" ? undefined : async () => k === "key" ? "k-" + n : [200, { ok: true, from: n }] }) } };
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
  const reset = () => { bridge.length = 0; cells.length = 0; bumps.length = 0; marks.length = 0; };
  // 주인 쓰기 길(운영과 같게): 글 D1 먼저(write_chat_d1) · 할 일 줄(write_owner_jobs), 실행기가 방금 당김(beat)
  const ownerWrites = async () => {
    for (const f of ["write_chat_d1", "write_owner_jobs"]) await ledger.setFlag(D1, f, true);
    db.prepare("INSERT INTO owner_job_beat(id, at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at").run(Date.now());
    await ledger.f7On(D1, "__reset__");
  };
  return { db, D1, env, ctx, r2, req, adm, flag, human, bridge, agents, cells, bumps, marks, reset, ownerWrites };
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
  await t.ownerWrites(); await t.flag("owner_unified", true); t.reset();
  const pg = await t.req("GET", "/", undefined, h);
  assert.equal(pg.status, 200, pg.text); assert.equal(pg.h.get("x-boarder-src"), "member");
  const d = await t.req("GET", "/api/data", undefined, h);
  assert.equal(d.status, 200, d.text); assert.notEqual(d.j?.from, "snap-data"); assert.equal(d.h.get("x-boarder-src"), "member");
  const ch = await t.req("GET", "/api/chat/primary", undefined, h);
  assert.equal(ch.status, 200, ch.text); assert.notEqual(ch.j?.from, "bridge");
  const w = await t.req("POST", "/api/chat", { text: "주인 글", channel: "primary", rid: "rid-owner-1" }, h);
  assert.equal(w.status, 200, w.text); assert.equal(w.j?.ok, true, w.text);
  assert.ok(t.db.prepare("SELECT 1 FROM wl_talk_msg WHERE chan = 'primary' AND text = ?").get("주인 글"), "글이 주인 대화 표(D1 wl_talk_msg)에 — 읽기(owner-read)와 같은 표");
  assert.equal(t.db.prepare("SELECT count(*) n FROM board_log").get()!.n, 0, "회원 보드 줄엔 안 씀");
  for (const p of ["/api/me/onboarding", "/api/me/nodes/avatar", "/api/me/nodeset", "/api/me/bot", "/api/me/board"]) {
    const r = await t.req("GET", p, undefined, h); assert.equal(r.status, 200, `${p} ${r.text}`);
  }
  assert.equal((await t.req("GET", "/api/me/bot", undefined, h)).j?.bot?.name, "총괄", "메인 봇 = canon 줄");
  assert.deepEqual(t.bridge, [], "켬인데 다리 호출이 있음");
});

test("켬: 주인 다른 로그인 메일(OWNER2)도 canon 열쇠 · 계정별 owner_unified:<메일> 은 그 메일만", async () => {
  const t = await setup();
  await t.ownerWrites(); await t.flag("owner_unified:" + OWNER2, true); t.reset();
  const w = await t.req("POST", "/api/chat", { text: "둘째 메일 글", channel: "primary", rid: "rid-owner2-1" }, await t.human(OWNER2));
  assert.equal(w.status, 200, w.text);
  assert.ok(t.db.prepare("SELECT 1 FROM wl_talk_msg WHERE text = ?").get("둘째 메일 글"), "OWNER2 로 써도 주인 대화 표 하나");
  assert.equal((await t.req("GET", "/", undefined, await t.human(OWNER2))).h.get("x-boarder-src"), "member", "OWNER2 는 회원 길 화면");
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
  assert.ok(t.cells.includes("rid:owner@apac"), "켬에서 쓴 rid 도 rid:owner 칸");
  t.reset();
  const a = await t.req("GET", "/api/answer/rid-new-2", undefined, h);
  assert.deepEqual(t.bridge, ["/api/answer/rid-new-2"], a.text);
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

test("전체 켬이어도 owner-host 주인 창 토큰(owner 빈 값)의 도구는 주인 장부로 — 회원 보드(board_log canon) 0줄", async () => {
  const t = await setup(), ag = { authorization: `Bearer ${ATOK}` }, dv = { authorization: `Bearer ${OFULL}` };
  const tools = () => t.bridge.filter(x => x !== "tool:flag");
  for (const f of ["", "owner_unified:" + OWNER, "owner_unified"]) {
    if (f) await t.flag(f, true);
    t.reset();
    for (const [name, args] of [["inbox_status", { text: "상태 " + f }], ["inbox_log", { kind: "progress", text: "진행 " + f }], ["inbox_ask", { question: "물음 " + f, choices: ["가", "나"] }]] as const) {
      const r = await t.req("POST", "/api/agent/" + name, args, ag);
      assert.equal(r.status, 200, name + " " + r.text);
    }
    assert.deepEqual(tools(), ["tool:inbox_status", "tool:inbox_log", "tool:inbox_ask"], "주인 장부 도구 " + f);
    assert.ok(t.agents.slice(-3).every(x => /:%77$/.test(x)), "릴레이가 받는 에이전트에 owner-host 판(%N) — inbox_log · ask 가 그 창 몫: " + t.agents.slice(-3).join(","));
  }
  assert.equal((t.db.prepare("SELECT count(*) n FROM board_log WHERE owner = ?").get(OWNER) as { n: number }).n, 0, "회원 보드 줄 0");
  assert.equal((t.db.prepare("SELECT count(*) n FROM board_card WHERE owner = ?").get(OWNER) as { n: number }).n, 0, "회원 카드 0");
  const w = await t.req("POST", "/api/device/window", { key: "tmux:work:1", name: "창" }, dv);
  assert.equal(w.status, 200, w.text); t.reset();
  const r = await t.req("POST", "/api/agent/inbox_status", { text: "canon 토큰 상태" }, { authorization: `Bearer ${w.j.token}` });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(tools(), [], "canon 기기 창 토큰은 다리 안 감");
  t.reset();
  const m = await t.req("POST", "/api/device/window", { key: "tmux:m:1", name: "m" }, { authorization: `Bearer ${MDEV}` });
  await t.req("POST", "/api/agent/inbox_status", { text: "회원 상태" }, { authorization: `Bearer ${m.j.token}` });
  assert.deepEqual(tools(), [], "회원 창 토큰은 그대로 제 D1 보드 · 다리 0");
  assert.ok(t.db.prepare("SELECT 1 FROM board_log WHERE owner = ? AND text = ?").get(MEMBER, "회원 상태"));
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
  MB.loadRead(t.D1, OWNER, t.ctx); const p1 = MB.readShareOf(OWNER);   // 나눠 쓰는 판(맡김 칸) — loadRead 는 기다림 상한으로 감싸 매번 새 Promise
  assert.ok(p1, "나눠 쓰는 판이 맡겨짐");
  await t.req("POST", "/api/agent/promise_list", {}, ag);
  assert.equal(MB.readShareOf(OWNER), p1, "읽기 도구 뒤에 나눠 쓰던 load 가 버려짐");
  await t.req("POST", "/api/agent/inbox_status", { text: "쓰기" }, ag);
  assert.notEqual(MB.readShareOf(OWNER), p1, "쓰기 뒤엔 버림");
});

const ROOT = "1703300000.000100", REPLY = "1703300000.000200";
function seedTalk(db: DatabaseSync) {
  const now = Date.now() / 1000;
  const ch = db.prepare("INSERT OR IGNORE INTO wl_talk_chan(id, name, slack_channel) VALUES (?, ?, ?)");
  for (const [k, c] of [["primary", "C1"], ["company", "C2"], ["harness_lead", "C6"]]) ch.run(k, k, c);
  const m = db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cli')");
  m.run(ROOT, "primary", null, "agent", "도우미", "%9", "주인 뿌리 글", now - 100);
  m.run(REPLY, "primary", ROOT, "agent", "도우미", "%9", "주인 답 글", now - 90);
  m.run("1703300000.000300", "harness_lead", null, "agent", "하네스 리드", "%12", "에이전트 채널 글", now - 80);
  db.prepare("INSERT INTO wl_talk_reaction(msg, emoji, who, at, source) VALUES (?, 'eyes', 'owner', ?, 'boarder')").run(ROOT, now - 50);
  db.prepare("INSERT INTO wl_talk_saved(who, msg, chan, thread, at) VALUES ('owner', ?, 'primary', ?, ?)").run(REPLY, ROOT, now - 40);
}
const CHAT_GETS = ["/api/chat/primary", `/api/chat/primary/${ROOT}`, `/api/chat/primary?before=${ROOT}`, "/api/chat/harness_lead", "/api/inbox", "/api/nodechat?w=" + encodeURIComponent("지어낸 노드"), "/api/emoji/frequent"];

test("켬: 주인 채널 · 스레드 · 노드 채팅 · 모아 보기 · 자주 쓰는 반응이 주인 길 D1 답(owner-read)과 같은 몸통 · 다리 0", async () => {
  const t = await setup(), h = await t.human(OWNER);
  seedTalk(t.db);
  for (const f of ["read_chat", "read_cards"]) await ledger.setFlag(t.D1, f, true);   // 끔 쪽 기준 답 = 주인 길 D1(owner-read)
  await ledger.f7On(t.D1, "__reset__");
  const want: Record<string, string> = {};
  for (const p of CHAT_GETS) { t.reset(); const r = await t.req("GET", p, undefined, h); assert.equal(r.status, 200, `${p} ${r.text}`); assert.deepEqual(t.bridge, [], p); want[p] = r.text; }
  for (const f of ["read_chat", "read_cards"]) await ledger.setFlag(t.D1, f, false);   // 켬은 read_* 스위치와 상관없이 D1
  await t.flag("owner_unified", true);
  for (const p of CHAT_GETS) {
    t.reset();
    const r = await t.req("GET", p, undefined, h);
    assert.equal(r.status, 200, `${p} ${r.text}`);
    assert.equal(r.h.get("x-f7"), "d1", p);
    const noAt = (o: any) => { const { read_at: _a, ...x } = o ?? {}; return x; };   // read_at = 부른 시각(초) — 두 번 읽는 사이 초가 넘어가면 1 다름(서버 ETag 도 이 칸을 뺌)
    assert.deepEqual(noAt(r.j), noAt(JSON.parse(want[p])), `${p}: 주인 길 답과 몸통이 다름`);
    assert.deepEqual(t.bridge, [], `${p}: 다리 호출`);
  }
  const ch = await t.req("GET", "/api/chat/primary", undefined, h);
  assert.ok(ch.text.includes("주인 뿌리 글") && ch.text.length > 200, "채널 글이 빔 — " + ch.text.slice(0, 120));
  const th = await t.req("GET", `/api/chat/primary/${ROOT}`, undefined, h);
  assert.deepEqual((th.j.messages as { text: string }[]).map(x => x.text), ["주인 뿌리 글", "주인 답 글"]);
  const ib = await t.req("GET", "/api/inbox", undefined, h);
  assert.ok((ib.j.saved_ids as string[]).includes(REPLY), "저장한 글이 모아 보기에 — " + ib.text.slice(0, 200));
  const et = ch.h.get("etag")!; assert.ok(et);
  assert.equal((await t.req("GET", "/api/chat/primary", undefined, { ...h, "if-none-match": et })).status, 304, "같은 ETag 면 304(주인 길과 같음)");
  assert.equal((await t.req("GET", "/api/chat/nosuch", undefined, h)).status, 404, "등록 안 된 채널은 404(다리로 안 감)");
  assert.deepEqual(t.bridge, []);
});

test("켬: cfg 스냅숏이 아직 없으면 채널 읽기는 503 다시 읽기(다리로 안 감 · 회원 빈 답도 아님)", async () => {
  const t = await setup(), h = await t.human(OWNER);
  seedTalk(t.db);
  await t.flag("owner_unified", true);
  const env0 = t.env.SNAP;
  t.env.SNAP = { ...env0, get: (n: string) => { const o = env0.get(n); return { ...o, get: async (k: string) => k === "cfg" ? null : o.get(k) }; } };
  t.reset();
  const r = await t.req("GET", "/api/chat/primary", undefined, h);
  assert.equal(r.status, 503, r.text); assert.equal(r.h.get("x-retry-safe"), "1");
  assert.deepEqual(t.bridge, []);
  t.env.SNAP = env0;
});

test("켬: 첫 화면 채널 목록(HB_CH) = 주인 채널 표(기본 다섯 + 에이전트 채널) — 회원은 Primary 하나 그대로", async () => {
  const t = await setup();
  await t.flag("owner_unified", true);
  const pg = await t.req("GET", "/", undefined, await t.human(OWNER));
  assert.equal(pg.h.get("x-boarder-src"), "member");
  assert.match(pg.text, /window\.HB_CH = \["primary","company","personal","dgit","shop","harness_lead"\];/);
  const pm = await t.req("GET", "/", undefined, await t.human(MEMBER));
  assert.match(pm.text, /window\.HB_CH = \["primary"\];/);
});

test("켬: 주인 반응 · 읽음 · 저장 · 결정 답 · 할 일 · 초안 쓰기는 주인 길(할 일 줄 · D1 owner_state) — 회원 표엔 안 씀 · 다리 0, rid 답은 그 줄", async () => {
  const t = await setup(), h = await t.human(OWNER);
  seedTalk(t.db); await t.ownerWrites(); await t.flag("owner_unified", true); t.reset();
  const posts: [string, Record<string, unknown>][] = [
    ["/api/chat", { rid: "rid-react-1", channel: "primary", ts: ROOT, react: "+1" }],
    ["/api/chat", { rid: "rid-seen-1", channel: "primary", seen: ROOT }],
    ["/api/inbox", { rid: "rid-save-1", save: REPLY, chan: "primary", thread: ROOT }],
    ["/api/answer", { rid: "rid-ans-1", item: "w1", text: "A" }],
    ["/api/todo", { rid: "rid-todo-1", area: "dgit", id: "Q-20261105-ab" }],
  ];
  for (const [p, b] of posts) {
    const r = await t.req("POST", p, b, h);
    assert.equal(r.status, 202, `${p} ${r.text}`); assert.equal(r.j?.state, "queued", r.text);
    assert.ok(t.db.prepare("SELECT 1 FROM owner_job WHERE rid = ? AND kind = ?").get(b.rid as string, p), `${p} 할 일 줄`);
  }
  assert.deepEqual((await t.req("GET", "/api/drafts", undefined, h)).j, {}, "seed 전 = cfg 사본 초안");
  t.db.prepare("INSERT INTO owner_state(k, v, at, ver, ord) VALUES ('drafts', '{}', ?, 0, 0)").run(Date.now());   // 릴레이가 올린 표시(seed)
  const d = await t.req("POST", "/api/draft", { key: "chan:primary", text: "쓰던 글" }, h);
  assert.equal(d.status, 200, d.text);
  const dr = await t.req("GET", "/api/drafts", undefined, h);
  assert.equal(dr.status, 200, dr.text); assert.equal(dr.j?.["chan:primary"]?.text, "쓰던 글", "초안 = D1 owner_state — " + dr.text);
  const a = await t.req("GET", "/api/answer/rid-react-1", undefined, h);
  assert.equal(a.j?.state, "queued", "rid 답은 할 일 줄에서 — " + a.text);
  for (const tb of ["board_log", "board_card", "member_reaction", "member_saved", "member_seen", "member_draft"]) {
    const has = t.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tb);
    if (has) assert.equal(t.db.prepare(`SELECT count(*) n FROM ${tb}`).get()!.n, 0, `${tb} 에 씀`);
  }
  assert.deepEqual(t.bridge, []);
});

test("회원 회귀 없음: 켬이어도 회원 채널 · 모아 보기는 회원 길(주인 대화 표 안 읽음)", async () => {
  const t = await setup(), hm = await t.human(MEMBER);
  seedTalk(t.db);
  for (const on of [false, true]) {
    await t.flag("owner_unified", on); t.reset();
    const ch = await t.req("GET", "/api/chat/primary", undefined, hm);
    assert.equal(ch.status, 200, ch.text); assert.ok(!ch.text.includes("주인 뿌리 글"), "회원이 주인 글을 봄");
    assert.notEqual(ch.h.get("x-f7"), "d1");
    const ib = await t.req("GET", "/api/inbox", undefined, hm);
    assert.equal(ib.status, 200, ib.text); assert.ok(!ib.text.includes(REPLY), "회원 모아 보기에 주인 저장 글");
    assert.deepEqual(t.bridge, []);
  }
});

test("켬: 할 일 없애기 — 화면이 회원 꼴(/api/todo {id, drop})로 보내도 주인 꼴(/api/cardcheck {rid, ts}) 할 일 줄로 · 끔 · 회원은 그대로", async () => {
  const t = await setup(), h = await t.human(OWNER);
  await t.ownerWrites(); await t.flag("owner_unified", true); t.reset();
  const r = await t.req("POST", "/api/todo", { rid: "rid-drop-1", id: ROOT, drop: true }, h);
  assert.equal(r.status, 202, r.text); assert.equal(r.j?.state, "queued");
  const j = t.db.prepare("SELECT kind, body FROM owner_job WHERE rid = 'rid-drop-1'").get() as { kind: string; body: string };
  assert.equal(j.kind, "/api/cardcheck"); assert.deepEqual(JSON.parse(j.body), { rid: "rid-drop-1", ts: ROOT });
  const q = await t.req("POST", "/api/todo", { rid: "rid-todo-2", area: "dgit", id: "Q-20261105-ab" }, h);   // 주인 꼴 할 일 끝냄은 그대로 /api/todo
  assert.equal(q.status, 202, q.text); assert.equal((t.db.prepare("SELECT kind FROM owner_job WHERE rid = 'rid-todo-2'").get() as { kind: string }).kind, "/api/todo");
  assert.equal((await t.req("GET", "/api/answer/rid-drop-1", undefined, h)).j?.state, "queued");
  assert.deepEqual(t.bridge, []);
  const m = await t.req("POST", "/api/todo", { rid: "rid-mdrop-1", id: "1703300000.000999", drop: true }, await t.human(MEMBER));
  assert.ok(m.status < 500, m.text); assert.ok(!t.db.prepare("SELECT 1 FROM owner_job WHERE rid = 'rid-mdrop-1'").get(), "회원 것은 주인 할 일 줄이 아님");
  await t.flag("owner_unified", false); t.reset();
  await t.req("POST", "/api/todo", { rid: "rid-off-1", id: ROOT, drop: true }, h);
  assert.equal((t.db.prepare("SELECT kind FROM owner_job WHERE rid = 'rid-off-1'").get() as { kind: string } | undefined)?.kind, "/api/todo", "끄면 바꾸지 않음(예전 주인 길)");
});

test("켬: 에이전트 채널 이름 표(HB_AGENTS) — 주인 cfg 채널 표의 에이전트 채널, 이름은 하네스가 올린 것(없으면 키) · 회원 · 끔은 없음", async () => {
  const t = await setup();
  await t.flag("owner_unified", true);
  const pg = await t.req("GET", "/", undefined, await t.human(OWNER));
  const m = /window\.HB_AGENTS = (\[[^\n]*?\]);/.exec(pg.text); assert.ok(m, pg.text.slice(0, 400));
  assert.deepEqual(JSON.parse(m![1]), [{ key: "harness_lead", name: "harness_lead", lead: null }]);
  assert.ok(!/HB_AGENTS/.test((await t.req("GET", "/", undefined, await t.human(MEMBER))).text), "회원 화면엔 없음");
  const html = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
  const line = html.split("\n").find(l => l.startsWith("const AGENT_CH = "))!; assert.ok(line);
  const run = (window: unknown, D: unknown) => new Function("window", "D", "AREA_NAME", line.replace(/^const /, "") + "; return AGENT_CH;")(window, D, { primary: "Primary", company: "회사 리드" });
  const ag = [{ key: "harness_lead", name: "하네스 리드", lead: "%12" }];
  assert.deepEqual(run({ HB_CH: ["primary", "harness_lead"], HB_AGENTS: ag }, {}), ag, "켠 주인");
  assert.deepEqual(run({ HB_CH: ["primary"] }, {}), [], "회원은 그대로 빈 표(member-board 데이터엔 agents 가 없음)");
  assert.deepEqual(run({ HB_CH: ["primary", "harness_lead"], HB_AGENTS: [{ key: "harness_lead", name: "harness_lead", lead: null }] }, { agents: ag }), ag, "켠 주인: 하네스가 올린 이름(D.agents)이 키 대신");
  assert.deepEqual(run({}, { agents: ag }), ag, "끈 주인은 D.agents 그대로");
});

test("켬: rid 답(GET /api/answer/:rid)은 주인 길 — 다리로 간 글(비밀 꼴)은 다리 판정(_jobs)으로, 회원 rid 칸 ok 로 안 떨어짐 · 회원은 그대로", async () => {
  const t = await setup(), h = await t.human(OWNER);
  await t.ownerWrites(); await ledger.setFlag(t.D1, "write_queue", true); await ledger.f7On(t.D1, "__reset__");
  await t.flag("owner_unified", true); t.reset();
  const w = await t.req("POST", "/api/chat", { rid: "rid-secret-1", channel: "primary", text: "토큰 ghp_madeupmadeupmadeupmadeupmadeup0000" }, h);   // 지어낸 비밀 꼴 — D1 · 할 일 줄에 원문을 안 남기고 다리로
  assert.equal(w.status, 200, w.text); assert.deepEqual(t.bridge, ["/api/chat"], "비밀 꼴 글은 다리로");
  assert.ok(!t.db.prepare("SELECT 1 FROM owner_job WHERE rid = 'rid-secret-1'").get());
  t.reset();
  const a = await t.req("GET", "/api/answer/rid-secret-1", undefined, h);
  assert.deepEqual(t.bridge, ["/api/answer/rid-secret-1"], "다리가 받은 글의 답은 다리(_jobs)가 앎 — " + a.text);
  assert.equal(a.j?.from, "bridge");
  t.reset();
  const q = await t.req("POST", "/api/chat", { rid: "rid-react-9", channel: "primary", ts: ROOT, react: "+1" }, h);
  assert.equal(q.status, 202, q.text);
  assert.equal((await t.req("GET", "/api/answer/rid-react-9", undefined, h)).j?.state, "queued", "할 일 줄 답 먼저");
  assert.deepEqual(t.bridge, []);
  const hm = await t.human(MEMBER);
  assert.equal((await t.req("POST", "/api/chat", { rid: "rid-member-9", channel: "primary", text: "회원 글" }, hm)).status, 200);
  const ma = await t.req("GET", "/api/answer/rid-member-9", undefined, hm);
  assert.equal(ma.j?.state, "ok", "회원은 회원 rid 칸 — " + ma.text); assert.deepEqual(t.bridge, []);
});

test("켬: 회원 길로 쓴 세션 글(/api/chat/new)의 rid 답은 회원 판정(ok · 실패) — 다리에 안 물음, 할 일 줄 · 다리로 간 글은 그대로", async () => {
  const t = await setup(), h = await t.human(OWNER), T = Date.now();
  t.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devE", OWNER, "engine mac", "", "e".repeat(64), T, T, "full", T);
  let n = 0;
  t.env.ENGINE = { idFromName: (s: string) => s, get: (id: string) => ({ revoke: async () => 0, deliver: async () => ({ sent: true }),
    open: async (w: any) => { const wid = `ew_own${String(++n).padStart(6, "0")}`; t.db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?)").run(wid, w.owner, id.replace(/^dev:/, ""), w.kind, w.name, "starting", Date.now(), Date.now()); return { id: wid }; } }) };
  await t.ownerWrites(); await ledger.setFlag(t.D1, "write_queue", true); await ledger.f7On(t.D1, "__reset__");
  await t.flag("owner_unified", true); t.reset();
  const w = await t.req("POST", "/api/chat/new", { rid: "rid-sess-new1", text: "새 대화 첫 글" }, h);
  assert.equal(w.status, 200, w.text); assert.match(w.j?.sid || "", /^ew_own/);
  const a = await t.req("GET", "/api/answer/rid-sess-new1", undefined, h);
  assert.equal(a.j?.state, "ok", a.text); assert.equal(a.h.get("x-f7"), "member");
  const bad = await t.req("POST", "/api/chat/new", { rid: "rid-sess-bad1", text: "  " }, h);
  assert.equal(bad.status, 400, bad.text);
  assert.equal((await t.req("GET", "/api/answer/rid-sess-bad1", undefined, h)).j?.state, "fail", "회원 길에서 거절된 글은 실패");
  const q = await t.req("POST", "/api/chat", { rid: "rid-react-7", channel: "primary", ts: ROOT, react: "+1" }, h);
  assert.equal(q.status, 202, q.text); assert.equal((await t.req("GET", "/api/answer/rid-react-7", undefined, h)).j?.state, "queued", "할 일 줄 먼저");
  assert.deepEqual(t.bridge, [], "회원 길 글 · 할 일 줄 rid 답에 다리 호출");
  await t.req("POST", "/api/chat", { rid: "rid-secret-7", channel: "primary", text: "토큰 ghp_madeupmadeupmadeupmadeupmadeup0000" }, h);
  t.reset();
  await t.req("GET", "/api/answer/rid-secret-7", undefined, h);
  assert.deepEqual(t.bridge, ["/api/answer/rid-secret-7"], "다리로 간 글은 다리 판정");
});

test("피드 묶음 길(POST /api/feed/threads): 켠 주인은 빈 답(스레드마다 GET 으로) · 회원은 묶음 · 같은 사이트가 아니면 403", async () => {
  const t = await setup(), h = await t.human(OWNER), m = await t.human(MEMBER);
  await t.ownerWrites(); await t.flag("owner_unified", true); t.reset();
  const ts = "1790000000.000001", key = W.canon({ ALLOW_EMAILS: OWNER } as never) || OWNER;
  for (const own of [key, OWNER]) t.db.prepare("INSERT OR IGNORE INTO board_card(id, owner, win, question, choices, recommend, body, state, at) VALUES (?,?,?,?,?,?,?,?,?)").run(ts, own, "lap:herdr:p2", "회원 표의 카드", "[]", "", "", "open", Date.now());   // 켠 주인 열쇠의 회원 표 줄 — 가드가 없으면 이것이 새어 나옴
  const body = { items: [{ k: "primary", ts }] };
  const o = await t.req("POST", "/api/feed/threads", body, h);
  assert.equal(o.status, 200, o.text); assert.deepEqual(o.j, { threads: {} }, "켠 주인은 회원 표를 안 읽고 빈 답");
  const r = await t.req("POST", "/api/feed/threads", body, m);
  assert.equal(r.status, 200, r.text); assert.ok(r.j && typeof r.j.threads === "object", "회원은 묶음 답");
  const cross = await t.req("POST", "/api/feed/threads", body, { ...m, "sec-fetch-site": "cross-site" });
  assert.equal(cross.status, 403, "같은 사이트가 아니면 403");
  assert.deepEqual(t.bridge, [], "다리 호출 없음");
});

test("켬: 주인 주제 · 지난 판은 주인 스냅숏(회원 표 아님) · 다리 0 — 회원은 그대로", async () => {
  const t = await setup(), h = await t.human(OWNER), hm = await t.human(MEMBER);
  await t.flag("owner_unified:" + OWNER, true); t.reset();
  const tp = await t.req("GET", "/api/topics", undefined, h);
  assert.equal(tp.status, 200, tp.text); assert.deepEqual(tp.j, { from: "snap-topics" }, "주제 = 주인 스냅숏");
  assert.equal(tp.h.get("etag"), '"e-topics"');
  assert.equal((await t.req("GET", "/api/topics", undefined, { ...h, "if-none-match": 'W/"e-topics"' })).status, 304, "같은 판이면 304");
  const hs = await t.req("GET", "/api/history", undefined, h);
  assert.equal(hs.status, 200, hs.text); assert.equal(hs.j.rows.length, 1, "지난 판 = 주인 스냅숏 줄");
  assert.deepEqual(t.bridge, [], "다리 0");
  const mt = await t.req("GET", "/api/topics", undefined, hm);
  assert.equal(mt.h.get("x-boarder-src"), "member", "회원은 그대로 제 표"); assert.notDeepEqual(mt.j, { from: "snap-topics" });
});

test("켬: 릴레이가 주제 · 지난 판 · cfg 스냅숏을 바꿔 올리면 켠 주인 칸(live:<canon>)에도 그 표시 — data 는 안 보냄 · 끄면 주인 칸만 · 폴링 표는 칸 전부", async () => {
  const t = await setup(), h = await t.human(OWNER), rl = { authorization: "Bearer relay-made-up" }, U = `live:${OWNER}@apac`;
  const put = async (k: string, b: unknown) => { const r = await t.req("PUT", "/api/relay/snap/" + k, b, rl); assert.equal(r.status, 200, k + " " + r.text); };
  t.reset(); await put("topics", { topics: [1] });
  assert.deepEqual(t.marks.filter(m => m[0] === U), [], "끄면 회원 칸에 안 감");
  await t.flag("owner_unified:" + OWNER, true); t.reset();
  await put("topics", { topics: [1, 2] }); await put("history", { oldest: 1, rows: [] }); await put("cfg", { ...JSON.parse(CFG), drafts: { a: 1 } }); await put("data", { from: "snap-data-2" });
  const um = t.marks.filter(m => m[0] === U).map(m => Object.keys(m[1])[0]).sort();
  assert.deepEqual(um, ["drafts", "history", "topics"], "주제 · 지난 판 · 초안만 — data 는 안 보냄: " + JSON.stringify(t.marks));
  t.reset(); await put("topics", { topics: [1, 2] });
  assert.deepEqual(t.marks.filter(m => m[0] === U), [], "같은 판이면 안 보냄");
  await ledger.setFlag(t.D1, "read_live", true); await ledger.f7On(t.D1, "__reset__");
  const lv = await t.req("GET", "/api/live", undefined, h);
  assert.equal(lv.j?.t?.todo, "t-" + U, "폴링 표에 DO 칸 전부(할 일 등): " + lv.text);
});

test("꺼진 회원 폴링 표는 예전 그대로 data · chat 만 — DO 칸에 todo 가 있어도 안 실음(꺼짐이면 아무것도 안 바뀜)", async () => {
  const t = await setup();
  await ledger.setFlag(t.D1, "read_live", true); await ledger.f7On(t.D1, "__reset__");
  const lv = await t.req("GET", "/api/live", undefined, await t.human(MEMBER));
  assert.equal(lv.status, 200, lv.text);
  assert.deepEqual(Object.keys(lv.j?.t || {}).filter(k => k === "data" || k === "todo" || k === "chat").sort(), ["chat", "data"], "회원 표: " + lv.text);
});

test("켬: 웹 푸시(/api/push/* · /sw.js)는 주인 길(주인 구독 칸) — 회원은 회원 칸", async () => {
  const t = await setup(), h = await t.human(OWNER), hm = await t.human(MEMBER);
  for (const f of ["member_push", "write_push"]) await ledger.setFlag(t.D1, f, true);
  await t.flag("owner_unified:" + OWNER, true); t.reset();
  const k = await t.req("GET", "/api/push/key", undefined, h);
  assert.equal(k.j?.key, "k-owner", "켠 주인 = 주인 구독 칸: " + k.text);
  const sub = await t.req("POST", "/api/push/subscribe", { sub: { endpoint: "https://push.example.test/x" } }, h);
  assert.equal(sub.j?.from, "owner", "구독도 주인 칸: " + sub.text);
  assert.equal((await t.req("GET", "/sw.js", undefined, h)).status, 200);
  const pf = await t.req("POST", "/api/push/prefs", { wide: true }, h);
  assert.equal(pf.status, 200, "알림 범위 칸은 회원 칸 그대로(주인 pushRoute 엔 없음): " + pf.text); assert.notEqual(pf.j?.from, "owner");
  const mk = await t.req("GET", "/api/push/key", undefined, hm);
  assert.notEqual(mk.j?.key, "k-owner", "회원은 제 칸: " + mk.text);
  assert.deepEqual(t.bridge, [], "다리 0");
});

test("메일별 미리 보기: 하네스 기기 쓰기(로그인 메일 없음)도 켠 주인 칸(live:<canon>)에 알림 — 다 끄면 안 감", async () => {
  const t = await setup(), HT = "bxd_" + "h".repeat(32), T = Date.now(), U = `live:${OWNER}@apac`;
  t.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devH2", OWNER, "owner-host harness", "", await sha(HT), T, T, "harness", T);
  await ledger.setFlag(t.D1, "shadow_unified", true); await ledger.f7On(t.D1, "__reset__");
  const S0 = Math.floor(T / 1000), up = () => t.req("POST", "/api/device/owner-state", { v: 1, at: S0, panes: {}, topics: {}, leads: { primary: "%15", leads: {}, windows: {} }, agents: [], parked: [], archived: [], promises: [], snoozed: [], ch_keys: {}, attn: null }, { authorization: `Bearer ${HT}` });
  t.reset(); const r0 = await up(); assert.equal(r0.status, 200, r0.text);
  assert.deepEqual(t.bumps, [], "다 끄면 어느 칸에도 안 감(주인 칸 chat 도 아님): " + t.bumps.join(","));
  await t.flag("owner_unified:" + OWNER2, true); t.reset();   // canon 이 아닌 주인 메일 하나만 켬
  const r1 = await up(); assert.equal(r1.status, 200, r1.text);
  assert.ok(t.bumps.includes(U), "켠 주인 칸에 알림: " + t.bumps.join(","));
  assert.ok(t.marks.some(m => m[0] === U && "data" in m[1]), "켠 주인 칸에 data(그 화면 /api/data 가 올린 값으로 계산)");
});

test("켬: 장부 바뀜 알림이 켠 주인 칸(live:<canon>)에는 chat 과 data 를 같이(그 화면 /api/data 가 장부 사본으로 계산) — 주인 칸은 chat 만 · 끄면 주인 칸만", async () => {
  const t = await setup(), U = `live:${OWNER}@apac`;
  t.reset(); await ledger.f7On(t.D1, "__reset__");
  await live.bumpLedger(t.env);
  assert.deepEqual(t.marks.map(m => [m[0], Object.keys(m[1]).sort()]), [[live.OWNER_SNAP, ["chat"]]], "끄면 주인 칸 chat 하나(예전)");
  await t.flag("owner_unified", true); t.reset();
  await live.bumpLedger(t.env);
  const by = Object.fromEntries(t.marks.map(m => [m[0], Object.keys(m[1]).sort()]));
  assert.deepEqual(by[live.OWNER_SNAP], ["chat"], "주인 칸(스냅숏 길)은 그대로 chat 만");
  assert.deepEqual(by[U], ["chat", "data"], "켠 주인 칸에는 data 도 — 판 줄 · 결정이 2분 확인까지 안 멈춤");
});

test("켬: 사람 값 · 기능 문(HB_MEMBER.turn · HB_CAPS) · 회원 틀 CSS — 켠 주인은 관리 권한 값 · 차례 글은 사람 설정 · 열 꼴 주인, 회원은 지금 값", async () => {
  const t = await setup();
  await t.flag("owner_unified", true);
  const page = async (who: string) => (await t.req("GET", "/", undefined, await t.human(who))).text;
  const vals = (html: string) => ({ caps: JSON.parse((/window\.HB_CAPS = (\{[^\n]*?\});/.exec(html) || [])[1] || "null"), mem: JSON.parse((/window\.HB_MEMBER = (\{[^\n]*?\})<\/script>/.exec(html) || [])[1] || "null"), css: /id="hbm-css"/.test(html) });
  const o = vals(await page(OWNER)), m = vals(await page(MEMBER));
  assert.deepEqual(o.caps, { invite: true, org_links: true, mainline: true, session_files: true, start_tab: false, push: true, push_wide: false, area_tabs: true }, "켠 주인(관리 권한)은 지금 주인 기능 문 — 세션 첨부도 참(회원 세션 길이 첨부를 링크 줄로 넘김, 빠짐 4) · 넓힘 칸은 거짓(주인 구독 칸)");
  assert.equal(o.css, true, "하네스 총괄 판이 없으면(이 시험 준비) 켠 주인도 회원 틀 CSS — 아래에서 총괄 판을 넣으면 빠짐");
  assert.deepEqual([m.caps?.org_links, m.caps?.session_files, m.caps?.push, m.caps?.push_wide], [false, false, false, true], "회원 org_links · session_files 거짓, push = member_push(꺼짐), push_wide 참(넓힘을 고름)");
  const o2 = vals(await page(OWNER2)); assert.deepEqual(o2.caps, o.caps, "다른 주인 메일로 들어온 미리 보기도 canon 값");
  assert.equal(m.caps?.start_tab, true, "회원은 「시작하기」 그대로"); assert.equal(m.caps?.invite, false); assert.equal(m.caps?.mainline, false);
  assert.equal(m.mem?.turn, "내 차례"); assert.equal(m.css, true, "회원 틀 CSS 그대로(열 하나)");
  t.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET data = json_set(data, '$.turn_label', '내 차례')").run(OWNER, JSON.stringify({ turn_label: "내 차례" }), Date.now());
  assert.equal(vals(await page(OWNER)).mem?.turn, "내 차례", "차례 글은 사람 설정(데이터)");
  const { Engine } = await import("./engine.ts"), OV = await import("./owner-vals.ts"), T = Date.now();
  const t2 = await setup(); await t2.flag("owner_unified", true); await ledger.f7On(t2.D1, "__reset__");
  const page2 = async (who: string) => (await t2.req("GET", "/", undefined, await t2.human(who))).text;
  t2.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devHx", OWNER, "owner-host harness", "", "h".repeat(64), T, T, "harness", T);
  await new (Engine as any)({ setWebSocketAutoResponse() {} }, { DB: t2.D1 }).hsync([{ id: "ew_pane15", state: "background", name: "총괄", meta: { pane: "%15", win: "1 총괄", role: "리드", cwd: "~/work", kind: "primary" } }], true, "devHx", OWNER, T);
  await OV.ingest(t2.D1, OWNER, { v: 1, at: Math.floor(T / 1000), panes: { "%15": { area: "primary", kind: "primary", acct: "c", dur: "", stuck: "", branch: "", wait: 0 } }, topics: {}, leads: { primary: "%15", leads: {}, windows: {} }, agents: [], parked: [], archived: [], promises: null, snoozed: [], ch_keys: {}, attn: null, roster: [{ key: "nx_x", name: "지어낸 기능 리드", role: "agent", area: "company", parent: "primary", pane: null, win: "", state: "idle", last: null }] });
  { const MBf = await import("./member-board.ts"); MBf.loadForget(OWNER); MBf.loadForget(MEMBER); }   // 회원 보드 읽기 캐시는 메일 열쇠(400ms) — 앞 준비(t)에서 읽은 값을 비움
  assert.equal(vals(await page2(OWNER)).css, false, "총괄 판이 있으면 회원 틀 CSS 안 넣음");
  assert.equal(vals(await page2(MEMBER)).css, true, "회원은 그대로");
  await ledger.setFlag(t2.D1, "owner_unified", false); await ledger.f7On(t2.D1, "__reset__");   // 꺼진 값을 isolate 캐시에
  t2.db.prepare("UPDATE f7_flag SET on_at = ? WHERE name = 'owner_unified'").run(Date.now());   // 캐시는 두고 D1 만 켬
  MB.loadForget(OWNER);
  const realNow = Date.now; Date.now = () => realNow() + 11_000;   // 캐시를 10초 넘게 낡게
  try { assert.equal(vals(await page2(OWNER)).css, false, "낡은 스위치 캐시에서도 하네스 판을 읽음(회원 틀 CSS 없음)"); } finally { Date.now = realNow; }
});

let harnessCmds: [string, string, any][] = [];
async function harnessOn(t: Awaited<ReturnType<typeof setup>>) {
  const T = Date.now(), sent: [string, string, string, object][] = [];
  t.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devH", OWNER, "owner-host harness", "", "h1", T, T, "harness", T);
  await new (Engine as any)({ setWebSocketAutoResponse() {} }, { DB: t.D1 }).hsync([
    { id: "ew_pane40", state: "busy", name: "지어낸 일", meta: { pane: "%40", win: "5 지어낸 일", role: "리드" } },
    { id: "ew_pane41", state: "parked", name: "주차한 일", meta: { pane: "%41", win: "6 주차한 일", role: "리드" } }], true, "devH", OWNER, T);
  const cmds: [string, string, any][] = [];
  t.env.ENGINE = { idFromName: (s: string) => s, get: (id: string) => ({ revoke: async () => 0, hsend: async (wid: string, text: string, o: object) => { sent.push([id, wid, text, o]);
      if (text === "들어갔을 수도") throw Object.assign(new Error("pane-tell 1: may have been sent — not retrying (unconfirmed)"), { code: 1 });
      if (text === "답 잃음") throw Object.assign(new Error("엔진 답 없음"), { code: 1 });
      if (text === "안 들어감") throw Object.assign(new Error("not sent"), { code: 1 });
      return { sent: true, to: "%" + wid.slice(7) }; },
    cmd: async (verb: string, a: any) => { cmds.push([id, verb, a]); if (verb !== "log") throw Object.assign(new Error("모르는 동사"), { code: 5 }); if (a.id === "ew_pane41") throw Object.assign(new Error("engine harness cannot log"), { code: 5 }); return { messages: [{ ts: "1.000001", who: "owner", text: "기록 글" }], kind: "claude", live: true }; } }) };
  harnessCmds = cmds;
  return sent;
}
test("켬: 하네스 판 세션 글(/api/sess/send %N)은 하네스 기기 엔진 send(줄 세움)로 그 판에 — 주차 판도 · 다리 0 · 회원 · 모르는 판은 404 · 끄면 예전처럼 다리", async () => {
  const t = await setup(), h = await t.human(OWNER), sent = await harnessOn(t);
  t.reset();
  const off = await t.req("POST", "/api/sess/send", { pane: "%40", name: "5 지어낸 일", text: "끈 상태 글" }, h);
  assert.ok(off.status < 500, off.text);
  assert.deepEqual(t.bridge, ["/api/sess/send"], "끔이면 다리(server.py sess_send) 그대로"); assert.deepEqual(sent, []);
  assert.equal((await t.req("POST", "/api/me/harness/send", { pane: "%40", text: "안쪽 길" }, h)).status, 403, "끔이면 안쪽 길도 주인 거절(memberOnly)");
  await t.flag("owner_unified", true); t.reset();
  const r = await t.req("POST", "/api/sess/send", { pane: "%40", name: "5 지어낸 일", text: "판에 바로\n두 줄" }, h);
  assert.equal(r.status, 200, r.text); assert.equal(r.j?.ok, true, r.text);
  assert.deepEqual(sent, [["dev:devH", "ew_pane40", "판에 바로\n두 줄", { queue: true, owner: true }]], "하네스 기기 엔진 send · 줄바꿈 그대로 · owner(어댑터가 장부 줄)");
  const p = await t.req("POST", "/api/sess/send", { pane: "%41", text: "주차 판에" }, h);
  assert.equal(p.status, 200, p.text); assert.equal(sent.at(-1)![1], "ew_pane41", "주차 판은 어댑터가 다시 열며 넣음");
  const note = () => (t.db.prepare("SELECT note FROM engine_window WHERE id = 'ew_pane40'").get() as { note: string | null }).note;
  for (const [text, why] of [["들어갔을 수도", "pane-tell 1: may have been sent"], ["답 잃음", "엔진 답 없음"]]) {
    t.db.prepare("UPDATE engine_window SET note = NULL WHERE id = 'ew_pane40'").run();
    const x = await t.req("POST", "/api/sess/send", { pane: "%40", text }, h); assert.equal(x.status, 200, text + " " + x.text); assert.equal(x.j?.ok, true, text);
    assert.match(String(note()), new RegExp(`^보드 글을 못 넣었을 수 있어요\\(${why}.*\\) — \\d\\d:\\d\\d UTC 에 보낸 글$`), text);
  }
  t.db.prepare("UPDATE engine_window SET note = NULL WHERE id = 'ew_pane40'").run();
  const no = await t.req("POST", "/api/sess/send", { pane: "%40", text: "안 들어감" }, h); assert.equal(no.status, 400, no.text);
  assert.equal(note(), null, "확실히 안 들어간 것은 note 없이 실패(화면이 글을 돌려놓음)");
  sent.splice(2);
  for (const pane of ["%99", "%1x", ""]) assert.equal((await t.req("POST", "/api/sess/send", { pane, text: "x" }, h)).status, 404, pane);
  assert.equal((await t.req("POST", "/api/sess/send", { pane: "%40", text: " " }, h)).status, 400);
  const hm = await t.human(MEMBER);
  assert.equal((await t.req("POST", "/api/sess/send", { pane: "%40", text: "남의 판" }, hm)).status, 404);
  assert.equal((await t.req("POST", "/api/me/harness/send", { pane: "%40", text: "남의 판" }, hm)).status, 404);
  assert.equal(sent.length, 2); assert.deepEqual(t.bridge, [], "켬인데 다리 호출");
  t.db.prepare("UPDATE device SET revoked_at = ? WHERE id = 'devH'").run(Date.now());
  assert.equal((await t.req("POST", "/api/me/harness/send", { pane: "%40", text: "x" }, h)).status, 404, "폐기된 하네스 기기의 판 줄은 내 판이 아님");
});

// 빠짐 4: 회원 「세션」 칸 글(/api/chat/new · send)의 첨부 — 채널 글과 같은 서명 링크 줄(「📎 이름: 링크」)로 창에 넘김. 켠 주인 HB_CAPS.session_files 참
test("켬: 세션 글 첨부(/api/chat/new · /api/chat/send files)는 내 파일 링크 줄을 붙여 창에 — 남의 · 모르는 파일만이면 400 · 창 안 엶", async () => {
  const t = await setup(), h = await t.human(OWNER), T = Date.now();
  t.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devE", OWNER, "engine mac", "", "e".repeat(64), T, T, "full", T);
  const FA = "0123456789abcdef0123456789abcdef", FB = "fedcba9876543210fedcba9876543210";
  t.r2.set("mfiles/" + FA, { customMetadata: { owner: OWNER, name: "사진.png" } });
  t.r2.set("mfiles/" + FB, { customMetadata: { owner: MEMBER, name: "남의.png" } });
  t.env.RESULTS.head = async (k: string) => t.r2.get(k) ?? null;
  let n = 0; const opened: any[] = [], delivered: [string, string][] = [];
  t.env.ENGINE = { idFromName: (s: string) => s, get: (id: string) => ({ revoke: async () => 0, deliver: async (wid: string, text: string) => { delivered.push([wid, text]); return { sent: true }; },
    open: async (w: any) => { opened.push(w); const wid = `ew_own${String(++n).padStart(6, "0")}`; t.db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?)").run(wid, w.owner, id.replace(/^dev:/, ""), w.kind, w.name, "starting", Date.now(), Date.now()); return { id: wid }; } }) };
  await t.flag("owner_unified", true); t.reset();
  const link = new RegExp(`^📎 사진\\.png: https://example\\.test/f/${FA}(?:/[^?\\s]+)?\\?e=\\d+&t=[0-9a-f]{32}$`);   // 링크 끝에 파일 이름이 붙는 꼴(다른 PR)도
  const nw = await t.req("POST", "/api/chat/new", { text: "이 사진 봐 줘", files: [{ id: FA }] }, h);
  assert.equal(nw.status, 200, nw.text);
  const [first, ln] = String(opened[0]?.prompt || "").split("\n");
  assert.equal(first, "이 사진 봐 줘"); assert.match(ln || "", link, "첫 입력에 링크 줄");
  const sd = await t.req("POST", "/api/chat/send", { sid: nw.j.sid, text: "", files: [FA, FB] }, h);
  assert.equal(sd.status, 200, sd.text);
  assert.equal(delivered.length, 1); assert.match(delivered[0][1], link, "글 없이 첨부만 — 내 파일 줄만(남의 파일은 뺌)");
  assert.equal((await t.req("POST", "/api/chat/new", { text: "남의 것", files: [FB] }, h)).status, 400, "내 파일이 하나도 없으면 400");
  assert.equal(opened.length, 1, "창을 더 안 엶");
  assert.deepEqual(t.bridge, []);
});

test("켬: 하네스 판 세션 기록(/api/sesslog %N)은 하네스 기기 엔진 log 동사 — 기록을 sess_log 꼴로 · log 를 모르는 옛 엔진은 404(빈 대화) · 회원 · 끄면 엔진 안 부름", async () => {
  const t = await setup(), h = await t.human(OWNER), sent = await harnessOn(t), cmds = harnessCmds;
  const q = (pane: string, name = "") => `/api/sesslog?pane=${encodeURIComponent(pane)}${name ? "&name=" + encodeURIComponent(name) : ""}`;
  t.reset();
  await t.req("GET", q("%40", "5 지어낸 일"), undefined, h);
  assert.equal(t.bridge.length, 1, "끔이면 다리 그대로"); assert.match(t.bridge[0], /^\/api\/sesslog\?/); assert.deepEqual(cmds, [], "끔이면 엔진 안 부름");
  await t.flag("owner_unified", true); t.reset();
  const r = await t.req("GET", q("%40", "5 지어낸 일"), undefined, h);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.j.channel, r.j.kind, r.j.live, r.j.name, r.j.messages.map((m: any) => m.text)], ["s:%40", "claude", true, "5 지어낸 일", ["기록 글"]]);
  assert.deepEqual(cmds, [["dev:devH", "log", { id: "ew_pane40", name: "5 지어낸 일" }]], "엔진 log 동사 · 판 id · 이름");
  const old = await t.req("GET", q("%41"), undefined, h);
  assert.equal(old.status, 404, "log 를 모르는 엔진(5) = 지금처럼 빈 대화");
  assert.equal((await t.req("GET", q("%40"), undefined, await t.human(MEMBER))).status, 404, "회원은 남의 하네스 판 기록 없음");
  assert.equal(cmds.length, 2, "회원 요청은 엔진을 안 부름"); assert.deepEqual(t.bridge, []);
});

// ── 켠 주인 회원 길의 빠짐 채우기(delete-plan.md 3절 5 · 9 · 12) ──
test("켬: #메인(/api/chat/main)은 끈 주인 길과 같은 답 — 주인 메일 넷의 「켠 시각」(mainmerge_at) 거름, 못 만들면 404 가 아니라 503 다시 읽기(빠짐 5)", async () => {
  const t = await setup(), h = await t.human(OWNER), now = Date.now() / 1000;
  seedTalk(t.db);
  const m = t.db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cli')");
  m.run("1703300000.000400", "company", null, "agent", "회사 리드", "%20", "켠 뒤 에이전트끼리 글", now - 30);
  m.run("1703300000.000500", "company", null, "owner", "Owner", null, "켠 뒤 Owner 글", now - 20);
  m.run("1703300000.000600", "company", null, "agent", "회사 리드", "%20", "켜기 전 에이전트 글", now - 300);
  // 켠 시각은 다른 주인 메일(OWNER2)에 적힘 — 로그인 메일 하나만 넘기면 못 찾음
  t.db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?, 'mainmerge_at', ?, ?)").run(OWNER2, String(Math.round((now - 60) * 1000)), Math.round((now - 60) * 1000));
  await ledger.setFlag(t.D1, "read_chat", true); await ledger.f7On(t.D1, "__reset__");
  const off = await t.req("GET", "/api/chat/main", undefined, h);
  assert.equal(off.status, 200, off.text); assert.deepEqual(t.bridge, []);
  const texts = (j: any) => (j.messages as { text: string }[]).map(x => x.text);
  assert.ok(!texts(off.j).includes("켠 뒤 에이전트끼리 글") && texts(off.j).includes("켠 뒤 Owner 글") && texts(off.j).includes("켜기 전 에이전트 글"), "끈 주인 길 기준 답 — " + off.text.slice(0, 200));
  await ledger.setFlag(t.D1, "read_chat", false);
  await t.flag("owner_unified", true); t.reset();
  const on = await t.req("GET", "/api/chat/main", undefined, h);
  assert.equal(on.status, 200, on.text); assert.equal(on.h.get("x-f7"), "d1");
  assert.deepEqual(on.j, off.j, "켠 주인 #메인이 끈 주인 길과 다름(켠 시각 거름 빠짐)");
  assert.deepEqual(t.bridge, []);
  // cfg 에 기본 다섯 채널이 하나도 없으면 #메인을 못 만듦 — 끈 주인 길은 다리로 넘기고, 켠 주인은 404(「없는 채널」) 대신 503 다시 읽기
  const env0 = t.env.SNAP;
  t.env.SNAP = { ...env0, get: (n: string) => { const o = env0.get(n); return { ...o, get: async (k: string) => k === "cfg" ? { body: '{"channels":{}}', etag: '"e-cfg-empty"', at: Date.now(), checked: Date.now() } : o.get(k) }; } };
  const r = await t.req("GET", "/api/chat/main", undefined, h);
  assert.equal(r.status, 503, r.text); assert.equal(r.h.get("x-retry-safe"), "1");
  assert.equal((await t.req("GET", "/api/chat/nosuch", undefined, h)).status, 404, "등록 안 된 채널은 그대로 404");
  t.env.SNAP = env0;
  assert.deepEqual(t.bridge, []);
});

test("켬: 설정 › 노드 보관함에 하네스 닫힌 창 · 다시 열기는 하네스 기기 엔진 reopen(빠짐 9) — 회원은 그대로 · 다리 0", async () => {
  const t = await setup(), h = await t.human(OWNER), T = Date.now(), s = T / 1000, OV = await import("./owner-vals.ts");
  t.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devH", OWNER, "owner-host harness", "", "h".repeat(64), T, T, "harness", T);
  await new (Engine as any)({ setWebSocketAutoResponse() {} }, { DB: t.D1 }).hsync([{ id: "ew_pane43", state: "busy", name: "열린 창", meta: { pane: "%43", win: "3 열린 창", role: "리드", cwd: "~/src/x" } }], true, "devH", OWNER, T);
  await OV.ingest(t.D1, OWNER, { v: 1, at: Math.floor(s), panes: {}, topics: {}, leads: { primary: null, leads: {}, windows: {} }, agents: [], parked: [], archived: ["보관 노드", "오래된 노드"], promises: null, snoozed: [], ch_keys: {}, attn: null });
  const lg = t.db.prepare("INSERT INTO wl_log(at, pane, win, kind, msg, cwd) VALUES (?,?,?,?,?,?)");
  lg.run(s - 3 * 86400, "%40", "12 보관 노드", "진행", "하는 중", "~/src/x");
  lg.run(s - 2 * 86400, "%40", "12 보관 노드", "끝", "다 끝냄 — 증거 링크", "~/src/x");
  lg.run(s - 8 * 86400, "%41", "9 오래된 노드", "끝", "옛 일", "~/src/x");
  lg.run(s - 3600, "%42", "7 쉬는 창", "끝", "방금 끝", "~/src/x");   // 보관 전(닫힌 창) — 목록엔 없고 다시 열기는 됨(server.py 와 같음)
  lg.run(s - 3600, "%43", "3 열린 창", "끝", "끝났지만 판이 살아 있음", "~/src/x");
  const cmds: unknown[] = [];
  t.env.ENGINE = { idFromName: (n: string) => n, get: (id: string) => ({ revoke: async () => 0, cmd: async (v: string, a: unknown) => { cmds.push([id, v, a]); return {}; } }) };
  await t.flag("owner_unified", true); t.reset();
  const ns = await t.req("GET", "/api/me/nodeset", undefined, h);
  assert.equal(ns.status, 200, ns.text);
  const arch = ns.j.archive as { id?: string; name: string; at: number; msg: string; reopen: boolean }[];
  assert.deepEqual(arch.map(x => [x.name, x.reopen, x.id ?? null]), [["보관 노드", true, null], ["오래된 노드", false, null]], "하네스 보관 창(id 없음 → 화면이 /api/me/nodereopen) — " + ns.text.slice(0, 300));
  assert.equal(arch[0].msg, "다 끝냄 — 증거 링크"); assert.equal(arch[0].at, Math.trunc(s - 2 * 86400), "끝 시각 = 그 창 장부 마지막 줄(초, server.py int 와 같이 버림)");
  const ro = (name: string, path = "/api/me/nodereopen") => t.req("POST", path, { name }, h);
  const ok = await ro("보관 노드");
  assert.equal(ok.status, 200, ok.text); assert.deepEqual(ok.j, { ok: true, name: "보관 노드" });
  assert.deepEqual(cmds, [["dev:devH", "reopen", { id: null, handle: { name: "보관 노드", closed: true } }]], "하네스 기기 엔진 reopen 동사(끈 주인 실행기 nodeReopen 과 같은 손잡이)");
  assert.equal((await ro("오래된 노드")).status, 409, "7일 넘음");
  assert.equal((await ro("쉬는 창")).status, 200, "보관 전 닫힌 창도 열림");
  assert.equal((await ro("열린 창")).status, 404, "살아 있는 판은 다시 열기 아님");
  assert.equal((await ro("없는 노드")).status, 404);
  cmds.length = 0;
  const g = await ro("보관 노드", "/api/nodereopen");
  assert.equal(g.status, 200, g.text); assert.equal(cmds.length, 1);
  const gm = await ro("없는 노드", "/api/nodereopen");
  assert.equal(gm.status, 404, gm.text); assert.equal(gm.j.error, "없는 노드예요", "회원 길(member-board nodereopen) 답 그대로");
  assert.equal((await t.req("POST", "/api/nodereopen", { name: "보관 노드" }, { cookie: (await t.human(OWNER)).cookie, "x-hb": "1", "sec-fetch-site": "cross-site" })).status, 403, "다른 사이트에서는 못 엶");
  assert.equal(cmds.length, 1);
  cmds.length = 0;
  const hm = await t.human(MEMBER), mn = await t.req("GET", "/api/me/nodeset", undefined, hm);
  assert.equal(mn.status, 200, mn.text); assert.deepEqual(mn.j.archive, []);
  assert.equal((await t.req("POST", "/api/me/nodereopen", { name: "보관 노드" }, hm)).status, 404);
  assert.deepEqual(cmds, []); assert.deepEqual(t.bridge, []);
});

test("켬: /ea(퍼스널 비서)는 관리 권한이면 같은 틀에 BX_EA_MODE=personal(끈 주인 길과 같음, 빠짐 12) — 회원은 /es 로 302 그대로", async () => {
  const t = await setup();
  await t.flag("owner_unified", true); t.reset();
  const ea = await t.req("GET", "/ea", undefined, await t.human(OWNER));
  assert.equal(ea.status, 200, ea.text.slice(0, 200));
  assert.equal(ea.h.get("x-boarder-src"), "member", "회원 길(memberPage)");
  assert.match(ea.text, /<script>window\.BX_EA=1;window\.BX_EA_MODE="personal"<\/script>/);
  const es = await t.req("GET", "/es", undefined, await t.human(OWNER));
  assert.ok(es.text.includes("window.BX_EA=1") && !es.text.includes("BX_EA_MODE"), "/es 는 BX_EA_MODE 없음");
  const o2 = await t.req("GET", "/ea", undefined, await t.human(OWNER2));
  assert.equal(o2.status, 200, "다른 주인 메일도(canon 관리 권한)");
  const m = await t.req("GET", "/ea?x=1", undefined, await t.human(MEMBER));
  assert.equal(m.status, 302); assert.equal(m.h.get("location"), "/es?x=1");
  assert.deepEqual(t.bridge, []);
});


const MASK_FILE = "a".repeat(32), MASK_OTHER = "b".repeat(32), MASK_NONE = "c".repeat(32);
const maskedAttachment = (id = MASK_FILE) => `📎 image.png: https://example.test/f/${id}?e=1794000000&«가림»`;
function maskedR2(t: Awaited<ReturnType<typeof setup>>, owner: string) {
  const heads: string[] = [];
  t.env.RESULTS.head = async (key: string) => { heads.push(key); return key === `mfiles/${MASK_FILE}` ? { customMetadata: { owner: encodeURIComponent(owner), owner_encoding: "uri" } } : key === `mfiles/${MASK_OTHER}` ? { customMetadata: { owner: "other@example.test" } } : null; };
  return heads;
}

test("가려진 첨부: 실제 Worker 주인 채널·스레드, 통합 켬/끔 모두 복구·D1 원문 유지·R2 id당 한 번", async () => {
  const F = await import("./member-files.ts");
  for (const unified of [false, true]) {
    const t = await setup(), h = await t.human(OWNER), heads = maskedR2(t, OWNER2), root = "1793950000.000101", at = Date.now() / 1000;
    await t.flag("read_chat", true); if (unified) await t.flag("owner_unified", true);
    t.db.prepare("INSERT INTO wl_talk_chan(id,name,slack_channel) VALUES ('primary','primary','C1')").run();
    const text = [maskedAttachment(), maskedAttachment(MASK_OTHER), maskedAttachment(MASK_NONE)].join("\n");
    t.db.prepare("INSERT INTO wl_talk_msg(id,chan,who,text,at,source) VALUES (?,'primary','owner',?,?,'web')").run(root, text, at);
    for (const path of ["/api/chat/primary", `/api/chat/primary/${root}`]) {
      heads.length = 0;
      const r = await t.req("GET", path, undefined, h); assert.equal(r.status, 200, r.text);
      const m = r.j.messages.find((m: any) => m.ts === root); assert.ok(m, r.text);
      const u = new URL(m.text.split("\n")[0].split(": ")[1]);
      assert.ok(await F.linkOk(SECRET, MASK_FILE, u.searchParams.get("e")!, u.searchParams.get("t")!));
      assert.equal(m.text.split("\n")[1], maskedAttachment(MASK_OTHER)); assert.equal(m.text.split("\n")[2], maskedAttachment(MASK_NONE));
      assert.equal(heads.length, 3); assert.equal(m.src, m.text);
    }
    assert.equal(t.db.prepare("SELECT text FROM wl_talk_msg WHERE id=?").get(root)!.text, text);
  }
});

test("가려진 첨부: agent raw가 Owner 표시를 흉내 내도 저장된 글쓴이가 다르면 재서명 안 함", async () => {
  const t = await setup(), h = await t.human(OWNER), heads = maskedR2(t, OWNER);
  await t.flag("owner_unified", true);
  t.db.prepare("INSERT INTO wl_talk_chan(id,name,slack_channel) VALUES ('primary','primary','C1')").run();
  t.db.prepare("INSERT INTO wl_talk_msg(id,chan,who,text,raw,at,source) VALUES (?,'primary','agent',?,?,?,'cli')")
    .run("1793950000.000102", maskedAttachment(), JSON.stringify({ user: "U0000000000" }), Date.now() / 1000);
  const r = await t.req("GET", "/api/chat/primary", undefined, h);
  assert.equal(r.status, 200, r.text); assert.equal(r.j.messages[0].text, maskedAttachment()); assert.equal(heads.length, 0);
});

test("가려진 첨부: 실제 회원 채널·스레드·피드·저장 글, 내 파일만 복구하고 같은 ETag는 304", async () => {
  const t = await setup(), h = await t.human(MEMBER), heads = maskedR2(t, MEMBER), at = Date.now() - 1000;
  const text = [maskedAttachment(), maskedAttachment(MASK_OTHER)].join("\n");
  const id = Number(t.db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES (?,'나','me',?,'primary',?)").run(MEMBER, text, at).lastInsertRowid), ts = MB.tsOf(at, id);
  t.db.prepare("INSERT INTO member_saved(owner,kind,ref,at) VALUES (?,'log',?,?)").run(MEMBER, String(id), at);
  for (const path of ["/api/chat/primary", `/api/chat/primary/${ts}`, "/api/inbox"]) {
    heads.length = 0; const r = await t.req("GET", path, undefined, h); assert.equal(r.status, 200, r.text);
    const m = path === "/api/inbox" ? r.j.saved[0] : r.j.messages.find((m: any) => m.ts === ts);
    assert.match(m.text, /&t=[0-9a-f]{32}/); assert.ok(m.text.includes(maskedAttachment(MASK_OTHER))); assert.equal(heads.length, 2);
    const same = await t.req("GET", path, undefined, { ...h, "if-none-match": r.h.get("etag")! }); assert.equal(same.status, 304, same.text);
  }
  heads.length = 0;
  const feed = await t.req("POST", "/api/feed/threads", { items: [{ k: "primary", ts }] }, h);
  assert.equal(feed.status, 200, feed.text); assert.match(feed.j.threads[ts].root.text, /&t=[0-9a-f]{32}/); assert.equal(heads.length, 2);
  assert.equal(t.db.prepare("SELECT text FROM board_log WHERE id=?").get(id)!.text, text);
});

test("가려진 첨부: 주인 노드 채팅·전달 상자·저장 글도 복구, 저장된 agent 글의 파일은 복구 안 함", async () => {
  const t = await setup(), h = await t.human(OWNER), heads = maskedR2(t, OWNER2), at = Date.now() / 1000;
  const root = `${Math.floor(at - 20)}.000103`, box = `${Math.floor(at - 10)}.000104`, agent = `${Math.floor(at - 5)}.000105`;
  await t.flag("owner_unified", true);
  // 다른 시험의 노드 색인과 구분되는 cfg tag.
  const cf = JSON.parse(CFG); cf.dm_node_roots = true;
  const snaps = t.env.SNAP;
  t.env.SNAP = { ...snaps, get: (name: string) => {
    const cell = snaps.get(name);
    return { ...cell, get: async (key: string) => key === "cfg" ? { body: JSON.stringify(cf), etag: '"masked-node-cfg"', at: Date.now(), checked: Date.now() } : cell.get(key) };
  } };
  t.db.prepare("INSERT INTO wl_talk_chan(id,name,slack_channel) VALUES ('primary','primary','C1')").run();
  const add = t.db.prepare("INSERT INTO wl_talk_msg(id,chan,who,text,at,source,ref) VALUES (?,'primary',?,?,?, ?,?)");
  add.run(root, "owner", maskedAttachment(), at - 20, "web", null);
  t.db.prepare("UPDATE wl_talk_msg SET slack_ts=? WHERE id=?").run(`${Math.floor(at - 20)}.009999`, root);
  t.db.prepare("INSERT INTO wl_log(at,pane,win,kind,msg,ref) VALUES (?,'owner','첨부 시험','진행','[음성] 먼저 기록된 장부',?)").run(at - 30, root);
  add.run(box, "agent", "옮긴 글", at - 10, "node-move", root);
  add.run(agent, "agent", maskedAttachment(), at - 5, "cli", null);
  t.db.prepare("INSERT INTO wl_card_home(ts,chan,pane,node,at) VALUES (?,'primary','%77','첨부 시험',?)").run(root, at);
  for (const ts of [root, agent]) t.db.prepare("INSERT INTO wl_talk_saved(who,msg,chan,thread,at) VALUES ('owner',?,'primary','',?)").run(ts, at);
  const nc = await t.req("GET", "/api/nodechat?w=" + encodeURIComponent("첨부 시험"), undefined, h);
  assert.equal(nc.status, 200, nc.text); assert.match(nc.j.messages[0].text, /&t=[0-9a-f]{32}/);
  heads.length = 0;
  const ch = await t.req("GET", "/api/chat/primary", undefined, h); assert.equal(ch.status, 200, ch.text);
  assert.match(ch.j.messages.find((m: any) => m.ts === box).fwd.text, /&t=[0-9a-f]{32}/);
  assert.equal(heads.length, 1, "채널 본문과 전달 상자가 같은 R2 결과 공유");
  const ib = await t.req("GET", "/api/inbox", undefined, h); assert.equal(ib.status, 200, ib.text);
  assert.match(ib.j.saved.find((m: any) => m.ts === root).text, /&t=[0-9a-f]{32}/);
  assert.ok(ib.j.saved.find((m: any) => m.ts === agent).text.includes("«가림»"));
});

test("모아 보기 로컬 사본(snap_inbox): 사본 번호가 D1 웹 바뀜 번호 이상이면 스냅숏, 낮음 · 방금 쓴 사람 · 끔 · 낡음이면 D1", async () => {
  const t = await setup(), h = await t.human(OWNER), rl = { authorization: "Bearer relay-made-up" };
  seedTalk(t.db);
  await t.flag("owner_unified", true);
  const web = () => Number(t.db.prepare("INSERT INTO wl_change(tbl, pk, op, at, origin) VALUES ('talk_seen', '[\"x\"]', 'up', ?, 'web')").run(Date.now()).lastInsertRowid);
  const s1 = web();
  const put = async (b: unknown) => { const r = await t.req("PUT", "/api/relay/snap/inbox", b, rl); assert.equal(r.status, 200, r.text); };
  const os = t.db.prepare("INSERT INTO owner_state(k, v, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at");
  os.run("drafts", "{}", 1); os.run("drafts:chan:primary", JSON.stringify({ text: "쓰던 글", at: 5000 }), 1); os.run("drafts:th:9.1", JSON.stringify({ text: "", at: 6000 }), 1);   // 빈 글 = 지움 표(목록에 안 나옴)
  const D = [{ key: "chan:primary", text: "쓰던 글", at: 5, chan: "primary", thread: "", card: "", place: "" }];
  await put({ _seq: s1, unread: [], drafts: D, saved: [], saved_ids: ["from-snap"] });
  const d1 = await t.req("GET", "/api/inbox", undefined, h);
  assert.equal(d1.h.get("x-f7"), "d1", "끔이면 D1");
  await t.flag("read_inbox_snap", true); await ledger.f7On(t.D1, "__reset__");
  const sn = await t.req("GET", "/api/inbox", undefined, h);
  assert.equal(sn.status, 200, sn.text); assert.equal(sn.h.get("x-f7"), "snap"); assert.deepEqual(sn.j.saved_ids, ["from-snap"]);
  assert.equal((await t.req("GET", "/api/inbox", undefined, { ...h, "if-none-match": sn.h.get("etag")! })).status, 304, "같은 ETag 면 304");
  assert.equal((await t.req("GET", "/api/inbox", undefined, { ...h, cookie: h.cookie + "; bx_w=1" })).h.get("x-f7"), "d1", "방금 쓴 사람은 D1");
  os.run("drafts:chan:primary", JSON.stringify({ text: "고친 글", at: 7000 }), 2);
  assert.equal((await t.req("GET", "/api/inbox", undefined, h)).h.get("x-f7"), "d1", "초안 시각이 판과 다르면 D1(owner_state 는 바뀜 번호에 안 걸림)");
  os.run("drafts:chan:primary", JSON.stringify({ text: "쓰던 글", at: 5000 }), 3);
  await put({ _seq: s1, unread: [], drafts: D, saved: [{ text: "📎 a: «가림»" }], saved_ids: ["from-snap"] });
  assert.equal((await t.req("GET", "/api/inbox", undefined, h)).h.get("x-f7"), "d1", "가린 첨부가 든 판은 D1(링크 되살리기)");
  await put({ _seq: s1, unread: [], drafts: D, saved: [], saved_ids: ["from-snap"] });
  const s2 = web();
  const behind = await t.req("GET", "/api/inbox", undefined, h);
  assert.equal(behind.h.get("x-f7"), "d1", "사본이 D1 보다 늦으면 D1"); assert.ok(!(behind.j.saved_ids as string[]).includes("from-snap"));
  await put({ _seq: s2, unread: [], drafts: D, saved: [], saved_ids: ["from-snap-2"] });
  assert.deepEqual((await t.req("GET", "/api/inbox", undefined, h)).j.saved_ids, ["from-snap-2"], "따라잡으면 다시 스냅숏");
  assert.deepEqual(t.bridge, [], "다리 0");
});

test("모아 보기 로컬 사본(snap_inbox): owner_unified 를 끈 주인 길도 같은 판정", async () => {
  const t = await setup(), h = await t.human(OWNER), rl = { authorization: "Bearer relay-made-up" };
  seedTalk(t.db);
  const seq = Number(t.db.prepare("INSERT INTO wl_change(tbl, pk, op, at, origin) VALUES ('talk_seen', '[\"x\"]', 'up', ?, 'web')").run(Date.now()).lastInsertRowid);
  t.db.prepare("INSERT INTO owner_state(k, v, at) VALUES ('drafts', '{}', 1)").run();
  assert.equal((await t.req("PUT", "/api/relay/snap/inbox", { _seq: seq, unread: [], drafts: [], saved: [], saved_ids: ["from-snap"] }, rl)).status, 200);
  await t.flag("read_inbox_snap", true); await ledger.f7On(t.D1, "__reset__");
  const r = await t.req("GET", "/api/inbox", undefined, h);
  assert.equal(r.h.get("x-f7"), "snap", r.text); assert.deepEqual(r.j.saved_ids, ["from-snap"]);
  t.db.prepare("INSERT INTO wl_change(tbl, pk, op, at, origin) VALUES ('talk_seen', '[\"y\"]', 'up', ?, 'web')").run(Date.now());
  assert.notEqual((await t.req("GET", "/api/inbox", undefined, h)).h.get("x-f7"), "snap", "사본이 늦으면 예전 길");
});


test("주인 읽기: cfg·sync 한 RPC와 구형 DO 폴백의 JSON·ETag·나이 머리가 같음", async () => {
  const t = await setup(), h = await t.human(OWNER);
  await t.flag("owner_unified", true);
  const old = await t.req("GET", "/api/chat/main", undefined, h);
  assert.equal(old.status, 200, old.text);
  const ns = t.env.SNAP; let batch = 0;
  const stamp = Date.now();
  t.env.SNAP = { ...ns, get: (...args: unknown[]) => {
    const stub = ns.get(...args);
    return { ...stub, getMany: async (keys: string[]) => {
      batch++; assert.deepEqual(keys, ["cfg", "sync"]);
      return Promise.all(keys.map(async k => {
        const v = await stub.get(k); return v ? { ...v, at: stamp, checked: stamp } : null;
      }));
    } };
  } };
  const fresh = await t.req("GET", "/api/chat/main", undefined, h);
  assert.equal(fresh.status, 200, fresh.text); assert.equal(batch, 1);
  assert.deepEqual({ ...fresh.j, read_at: 0 }, { ...old.j, read_at: 0 });
  assert.equal(fresh.h.get("etag"), old.h.get("etag"));
  for (const k of ["x-cfg-age", "x-sync-age"]) assert.ok(Number(fresh.h.get(k)) >= 0 && Number(fresh.h.get(k)) < 5000);
  assert.match(fresh.h.get("server-timing")!, /dob;dur=\d+;desc=1/);
  const cached = await t.req("GET", "/api/chat/main", undefined, { ...h, "if-none-match": fresh.h.get("etag")! });
  assert.equal(cached.status, 304); assert.equal(cached.text, "");
  // 실제 RPC의 「구형 DO 메서드 없음」은 비동기 거절. setup의 구형 스텁은 동기 부재도 검증함.
  t.env.SNAP = { ...ns, get: (...args: unknown[]) => ({ ...ns.get(...args), getMany: async () => { throw new Error("old DO"); } }) };
  const rejected = await t.req("GET", "/api/chat/main", undefined, h);
  assert.equal(rejected.status, 200, rejected.text);
  assert.deepEqual({ ...rejected.j, read_at: 0 }, { ...old.j, read_at: 0 });
});


test("화면 틀 조건부 읽기: 회원·주인 첫 HTML 동등, 다음 요청 본문 0, 바뀐 틀 즉시 반영", async () => {
  const t = await setup(); await t.flag("read_page", true);
  const ns = t.env.SNAP;
  let value = { body: PAGE, etag: '"conditional-page-1"', at: Date.now(), checked: Date.now() };
  let full = 0, same = 0;
  t.env.SNAP = { ...ns, get: (...args: unknown[]) => {
    const s = ns.get(...args);
    return { ...s, get: async (k: string) => k === "page" ? value : s.get(k), getIf: async (k: string, tag: string) => {
      assert.equal(k, "page");
      if (tag === value.etag) { same++; return { same: true, etag: value.etag, at: value.at, checked: value.checked }; }
      full++; return value;
    } };
  } };
  for (const email of [MEMBER, OWNER]) {
    const h = await t.human(email), before = full;
    const first = await t.req("GET", "/nodes", undefined, h), next = await t.req("GET", "/nodes", undefined, h);
    assert.equal(first.status, 200, first.text); assert.equal(next.status, 200, next.text);
    assert.equal(next.text, first.text);
    assert.ok(full - before <= 1); assert.ok(same > 0);
    assert.ok(!first.text.includes("__BX_DATA__"));
  }
  assert.equal(full, 1, "회원·주인 사이에도 같은 비개인 화면 틀을 재전송하지 않음");
  const v2 = JSON.parse(PAGE); v2.ver = "v2"; v2.html = v2.html.replace("</body>", '<div id="new-template"></div></body>');
  value = { ...value, body: JSON.stringify(v2), etag: '"conditional-page-2"' };
  const changed = await t.req("GET", "/nodes", undefined, await t.human(MEMBER));
  assert.equal(changed.status, 200, changed.text); assert.ok(changed.text.includes('id="new-template"'));
  assert.equal(full, 2);
});

test("화면 틀 조건부 읽기: 구형 DO의 getIf 거절은 기존 get으로 첫 HTML 제공", async () => {
  const t = await setup(), ns = t.env.SNAP, h = await t.human(MEMBER);
  let fallback = 0;
  t.env.SNAP = { ...ns, get: (...args: unknown[]) => {
    const s = ns.get(...args); return { ...s, getIf: async () => { throw new Error("old DO"); }, get: async (k: string) => { if (k === "page") fallback++; return s.get(k); } };
  } };
  const old = await t.req("GET", "/nodes", undefined, h);
  assert.equal(old.status, 200, old.text); assert.ok(fallback >= 1);
});


test("조건부 화면 틀: /bxs 차가운 읽기에서 틀을 받아 덩어리 복구, 다음 첫 HTML은 본문 재전송 없음", async () => {
  const t = await setup(), h = await t.human(MEMBER), ns = t.env.SNAP;
  const { shaOf } = await import("./bxs.ts");
  const js = "/* conditional-page-bxs " + "x".repeat(5000) + " */", sha = await shaOf(js), page = JSON.parse(PAGE);
  page.html = page.html.replace("</body>", `<script>${js}</script></body>`);
  const value = { body: JSON.stringify(page), etag: '"bxs-page-unique"', at: Date.now(), checked: Date.now() };
  let full = 0, same = 0;
  t.env.SNAP = { ...ns, get: (...args: unknown[]) => ({ ...ns.get(...args), getIf: async (k: string, tag: string) => {
    assert.equal(k, "page");
    if (tag === value.etag) { same++; return { same: true, etag: value.etag, at: value.at, checked: value.checked }; }
    full++; return value;
  } }) };
  const block = await t.req("GET", `/bxs/${sha}.js`, undefined, h);
  assert.equal(block.status, 200, block.text); assert.equal(block.text, js);
  const html = await t.req("GET", "/nodes", undefined, h);
  assert.equal(html.status, 200, html.text); assert.ok(html.text.includes(`/bxs/${sha}.js`));
  assert.equal(full, 1); assert.ok(same >= 1);
});
