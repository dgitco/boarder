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
  const bridge: string[] = [], cells: string[] = [], bumps: string[] = [];
  const call = async (r: { path: string }) => { bridge.push(r.path); return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"ok":true,"from":"bridge"}') }; };
  const agents: string[] = [];
  const tool = async (name: string, _a?: unknown, agent?: string) => { bridge.push("tool:" + name); agents.push(String(agent)); return { ok: true, from: "bridge" }; };
  const snaps: Record<string, string> = { data: '{"from":"snap-data"}', topics: '{"from":"snap-topics"}', page: PAGE, sync: "{}", cfg: CFG };
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
  // 주인 쓰기 길(운영과 같게): 글 D1 먼저(write_chat_d1) · 할 일 줄(write_owner_jobs), 실행기가 방금 당김(beat)
  const ownerWrites = async () => {
    for (const f of ["write_chat_d1", "write_owner_jobs"]) await ledger.setFlag(D1, f, true);
    db.prepare("INSERT INTO owner_job_beat(id, at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at").run(Date.now());
    await ledger.f7On(D1, "__reset__");
  };
  return { db, D1, env, ctx, r2, req, adm, flag, human, bridge, agents, cells, bumps, reset, ownerWrites };
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
    assert.deepEqual(r.j, JSON.parse(want[p]), `${p}: 주인 길 답과 몸통이 다름`);
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
  // board.html: HB_CH 여도 HB_AGENTS 가 있으면 그 표로 AGENT_CH(사이드바 「에이전트」 칸 · 채널 이름), 없으면 예전(회원 빈 표 · 주인 D.agents)
  const html = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
  const line = html.split("\n").find(l => l.startsWith("const AGENT_CH = "))!; assert.ok(line);
  const run = (window: unknown, D: unknown) => new Function("window", "D", "AREA_NAME", line.replace(/^const /, "") + "; return AGENT_CH;")(window, D, { primary: "Primary", company: "회사 리드" });
  const ag = [{ key: "harness_lead", name: "하네스 리드", lead: "%12" }];
  assert.deepEqual(run({ HB_CH: ["primary", "harness_lead"], HB_AGENTS: ag }, {}), ag, "켠 주인");
  assert.deepEqual(run({ HB_CH: ["primary"] }, { agents: ag }), [], "회원은 그대로 빈 표");
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
