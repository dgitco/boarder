import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
(globalThis as any).HTMLRewriter ??= class {
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
const { _resetVaultCache } = await import("./vault/index.ts");
const { routeOwnerCard } = await import("./member-push.ts") as any;
const { Pusher } = await import("./push-do.ts");
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
    batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = ss.map(s => /^\s*(select|with)/i.test(s.sql) || /\breturning\b/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { db.exec("ROLLBACK"); throw e; } },
  };
  D1.withSession = () => D1;
  return { db, D1: D1 as D1Database };
}
const OWNER = "owner@example.test", OWNER2 = "owner-alt@example.test", MEMBER = "member@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up", ADMIN = "admin-token-made-up";
const OFULL = "bxd_made-up-owner-full-0123456789abcdef0", MDEV = "bxd_made-up-member-device-0123456789abcde";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
const CFG = JSON.stringify({ channels: { primary: "C1", company: "C2", personal: "C3", dgit: "C4", shop: "C5" }, drafts: {}, push_key: "made-up-key" });
const PAGE = JSON.stringify({ ver: "v1", html: '<!doctype html><html><head></head><body><script>window.D = __BX_DATA__; window.T = "__BX_DTAG__"</script></body></html>' });

async function setup() {
  const { db, D1 } = d1(), T = Date.now(), OLD = T - 3600_000;   // 기기는 한 시간 전 — 온보딩 30분 조용히 밖
  _resetVaultCache(); W.setCanonOn(false);
  await ledger.setFlag(D1, "owner_unified", false);
  await ledger.setFlag(D1, "owner_unified_prep", true);
  await ledger.f7On(D1, "__reset__");
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)");
  dev.run("devOF", OWNER, "owner laptop", "", await sha(OFULL), OLD, T, "full");
  dev.run("devM", MEMBER, "laptop", "", await sha(MDEV), OLD, T, "full");
  const bot = db.prepare("INSERT INTO member_bot (owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?)");
  bot.run("@owner", "s1", 10, "총괄", "", "", "", T); bot.run(OWNER, "s1", 10, "총괄", "", "", "", T); bot.run(MEMBER, "s2", 20, "모찌", "", "", "", T);
  const bridge: string[] = [];
  const call = async (r: { path: string }) => { bridge.push(r.path); return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"ok":true,"from":"bridge"}') }; };
  const tool = async (name: string) => { bridge.push("tool:" + name); return { ok: true, from: "bridge" }; };
  const snaps: Record<string, string> = { data: '{"from":"snap-data"}', topics: "{}", page: PAGE, sync: "{}", cfg: CFG, history: "{}" };
  const rids = new Map<string, Map<string, { status: number } | null>>();
  const ridCell = (n: string) => { let m = rids.get(n); if (!m) rids.set(n, m = new Map()); return m; };
  const SNAP = { idFromName: (n: string) => n, get: (n: string) => ({
    get: async (k: string) => k in snaps ? { body: snaps[k], etag: `"e-${k}"`, at: Date.now(), checked: Date.now() } : null,
    tags: async () => ({ t: { data: "d-" + n, todo: "t-" + n }, age: 0, boot: "b" }), bump: async () => 0,
    putT: async (k: string, b: string) => { snaps[k] = b; return { etag: `"e-${k}"`, ms: 0, colo: "x", changed: true }; },
    claim: async (rid: string) => { const m = ridCell(n), v = m.get(rid); if (v) return { state: "done", status: v.status, body: "", ct: "application/json" }; if (m.has(rid)) return { state: "busy" }; m.set(rid, null); return { state: "new" }; },
    done: async (rid: string, status: number) => { ridCell(n).set(rid, { status }); return 0; }, release: async (rid: string) => { ridCell(n).delete(rid); return 0; },
    look: async (rid: string) => ridCell(n).get(rid) ? "done" : "none",
  }) };
  // Pusher 칸 가짜: 부른 칸 이름 · 함수 · 인자만 적음(웹 푸시 안 보냄). nSubs = 칸마다 정한 구독 수
  const pushCalls: { cell: string; fn: string; args: unknown[] }[] = [], subsOf: Record<string, number> = {};
  const PUSH = { idFromName: (n: string) => n, get: (n: string) => new Proxy({}, { get: (_o, k) => k === "then" ? undefined : async (...args: unknown[]) => {
    pushCalls.push({ cell: n, fn: String(k), args });
    if (k === "key") return "k-" + n;
    if (k === "nSubs") return subsOf[n] ?? 0;
    if (k === "ensure") return true;
    if (k === "mPrefs") return [200, { ok: true, wide: false, progress: "digest" }];
    return [200, { ok: true, from: n }];
  } }) };
  const r2 = new Map<string, unknown>();
  const RESULTS = { list: async () => ({ objects: [], truncated: false }), head: async () => null, get: async (k: string) => r2.get(k) ?? null, put: async (k: string, v: unknown) => { r2.set(k, v); }, delete: async (k: string) => { r2.delete(k); } };
  const env: any = { DB: D1, RESULTS, SNAP, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: `${OWNER},${OWNER2}`, PUBLIC_URL: "https://example.test", ADMIN_TOKEN: ADMIN, RELAY_TOKEN: "relay-made-up",
    ASSETS: { fetch: async () => new Response("nf") }, BRIDGE: { idFromName: (n: string) => n, get: () => ({ call, tool }) },
    ENGINE: { idFromName: (n: string) => n, get: () => ({ revoke: async () => 0 }) }, PUSH };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p.catch(() => {})); }, passThroughOnException() {} };
  const req = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    for (let i = 0; i < 20 && pending.length; i++) await Promise.all(pending.splice(0));
    return { status: r.status, j, text };
  };
  const adm = { authorization: `Bearer ${ADMIN}` };
  const flag = async (name: string, on: boolean) => { const r = await req("POST", "/api/admin/f7-flag", { name, on }, adm); assert.equal(r.status, 200, r.text); };
  const human = async (email: string) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  const ask = async (devTok: string, key: string, a: Record<string, unknown>) => {
    const w = await req("POST", "/api/device/window", { key, name: "창" }, { authorization: `Bearer ${devTok}` });
    assert.equal(w.status, 200, w.text);
    const r = await req("POST", "/api/agent/inbox_ask", { choices: ["A", "B"], ...a }, { authorization: `Bearer ${w.j.token}` });
    assert.equal(r.status, 200, r.text);
    return r.j.card_id as string;
  };
  const notes = () => pushCalls.filter(x => x.fn === "oNotify" || x.fn === "mNotify").map(x => ({ cell: x.cell, fn: x.fn, id: (x.args[x.fn === "oNotify" ? 0 : 1] as { id: string }).id, key: x.args[x.fn === "oNotify" ? 1 : 2] }));
  return { db, D1, env, req, flag, human, ask, pushCalls, subsOf, notes, bridge };
}

test("빠짐 2 · 켬: canon 보드 급한 카드는 주인 구독 칸(owner)으로 한 번 — 회원 canon 칸은 안 부름 · 보통 카드는 안 감(급한 일만)", async () => {
  const t = await setup();
  for (const f of ["member_push", "write_push"]) await ledger.setFlag(t.D1, f, true);
  await t.flag("owner_unified", true);
  const urgent = await t.ask(OFULL, "tmux:work:1", { question: "결제 장애 — 어떻게 할까요", urgent: true });
  await t.ask(OFULL, "tmux:work:2", { question: "보통 결정" });
  assert.equal((t.db.prepare("SELECT count(*) n FROM board_card WHERE owner = ?").get(OWNER) as { n: number }).n, 2, "카드는 canon 회원 보드에");
  assert.deepEqual(t.notes(), [{ cell: "owner", fn: "oNotify", id: urgent, key: `card:${urgent}` }], "주인 칸에 급한 카드 한 장만");
  assert.equal(t.pushCalls.some(x => x.cell === OWNER), false, "회원 canon 칸(구독 없음)은 안 부름");
});

test("빠짐 2 · 켬이어도 write_push 꺼짐(주인 구독이 다리 쪽)이면 주인 칸 · 회원 칸 둘 다 안 보냄", async () => {
  const t = await setup();
  await ledger.setFlag(t.D1, "member_push", true);
  await t.flag("owner_unified", true);
  await t.ask(OFULL, "tmux:work:1", { question: "결제 장애", urgent: true });
  assert.deepEqual(t.notes(), []);
});

test("빠짐 2 · 회원 그대로: 회원 카드는 회원 칸(mNotify) — 주인 칸 안 부름", async () => {
  const t = await setup();
  for (const f of ["member_push", "write_push"]) await ledger.setFlag(t.D1, f, true);
  await t.flag("owner_unified", true);
  const id = await t.ask(MDEV, "tmux:m:1", { question: "결제 장애", urgent: true });
  assert.deepEqual(t.notes(), [{ cell: MEMBER, fn: "mNotify", id, key: `card:${id}` }]);
});

test("빠짐 2 · 누름(push/resolve): 켠 주인은 회원 카드(board_card)도 찾음 · 주인 장부 카드는 그대로 · 끈 주인은 예전 그대로(회원 카드 자리 없음)", async () => {
  const t = await setup(), T = Date.now() / 1000;
  await ledger.setFlag(t.D1, "write_push", true);
  t.db.prepare("INSERT INTO board_card(id, owner, win, question, choices, at) VALUES (?,?,?,?,?,?)").run("1793000000.000101", OWNER, "창", "canon 카드", "[]", Date.now());
  t.db.prepare("INSERT INTO board_card(id, owner, win, question, choices, at) VALUES (?,?,?,?,?,?)").run("1793000000.000102", MEMBER, "창", "남의 카드", "[]", Date.now());
  t.db.prepare("INSERT INTO wl_cards(ts, area, kind, state, posted_at) VALUES (?,?,?,?,?)").run("1793000000.000201", "primary", "choice", "open", T);
  t.db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, text, at, source) VALUES (?,?,?,?,?,?,?)").run("1793000000.000201", "company", "1793000000.000200", "agent", "주인 카드", T, "cli");
  const h = await t.human(OWNER), rs = async (id: string) => (await t.req("GET", "/api/push/resolve/" + id, undefined, h)).j;
  const off = await rs("1793000000.000101");
  assert.deepEqual(off, { ts: "1793000000.000101", loc: null }, "끈 주인: 회원 카드는 예전처럼 자리 없음");
  assert.deepEqual((await rs("1793000000.000201")).loc, { c: "company", t: "1793000000.000200", m: "1793000000.000201", state: "open" });
  await t.flag("owner_unified:" + OWNER, true);
  assert.deepEqual(await rs("1793000000.000101"), { ts: "1793000000.000101", loc: { c: "primary", t: "1793000000.000101", m: "1793000000.000101", state: "open" } }, "켠 주인: canon 회원 카드 자리");
  assert.deepEqual((await rs("1793000000.000201")).loc, { c: "company", t: "1793000000.000200", m: "1793000000.000201", state: "open" }, "주인 장부 카드가 먼저(그대로)");
  assert.equal((await rs("1793000000.000102")).loc, null, "남의 회원 카드는 자리 없음");
  assert.equal(t.pushCalls.some(x => x.fn === "mPage" || x.cell === OWNER), false, "회원 canon 푸시 칸은 안 부름(주인 칸 길)");
  assert.deepEqual(t.bridge, [], "다리 0");
});

test("빠짐 3 · 온보딩 「알림 켜기」: 켠 주인 = 주인 구독 칸 구독 수 · write_push 꺼지면 예전 셈 · 회원은 member_push_ep 그대로", async () => {
  const t = await setup();
  for (const f of ["member_push", "write_push"]) await ledger.setFlag(t.D1, f, true);
  await t.flag("owner_unified", true);
  const step = async (who: string) => { const r = await t.req("GET", "/api/me/onboarding", undefined, await t.human(who)); assert.equal(r.status, 200, r.text); return r.j.steps.find((x: any) => x.key === "push"); };
  let s = await step(OWNER);
  assert.equal(s.done, false); assert.match(s.detail, /급한 일 알림/);
  t.subsOf.owner = 2;
  s = await step(OWNER); assert.equal(s.done, true, "주인 칸 구독 2곳이면 채워짐"); assert.match(s.detail, /브라우저 2곳/);
  s = await step(OWNER2); assert.equal(s.done, true, "다른 주인 메일로 들어와도 같은 주인 칸");
  const m0 = await step(MEMBER); assert.equal(m0.done, false, "회원은 주인 칸 구독과 상관없음"); assert.match(m0.detail, /결정 카드 알림/);
  t.db.prepare("INSERT INTO member_push_ep(endpoint, owner, at) VALUES (?,?,?)").run("https://push.example.test/m1", MEMBER, Date.now());
  assert.equal((await step(MEMBER)).done, true);
  await ledger.setFlag(t.D1, "write_push", false); await ledger.f7On(t.D1, "__reset__");
  s = await step(OWNER); assert.equal(s.done, false, "write_push 꺼짐: 예전 셈(canon member_push_ep)"); assert.match(s.detail, /결정 카드 알림/);
  assert.equal(t.pushCalls.filter(x => x.fn === "nSubs").every(x => x.cell === "owner"), true);
});

test("빠짐 3 · 알림 글 꼴 서버 값: HB_CAPS.push_wide — 켠 주인 거짓(급한 일만) · 회원 참", async () => {
  const t = await setup();
  await t.flag("owner_unified", true);
  const caps = async (who: string) => JSON.parse((/window\.HB_CAPS = (\{[^\n]*?\});/.exec((await t.req("GET", "/", undefined, await t.human(who))).text) || [])[1] || "null");
  assert.equal((await caps(OWNER)).push_wide, false);
  assert.equal((await caps(MEMBER)).push_wide, true);
});

// ---------- 칸 · 길 함수 ----------
function fakeDO(D1: D1Database) {
  const s = new DatabaseSync(":memory:");
  const sql = { exec: (q: string, ...b: unknown[]) => { const st = s.prepare(q);
    if (/^\s*select/i.test(q)) { const rows = st.all(...(b as never[])); return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }; }
    const r = st.run(...(b as never[])); return { toArray: () => [], one: () => undefined, rowsWritten: Number(r.changes) }; } };
  return new (Pusher as any)({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} } }, { DB: D1 });
}

test("주인 칸 oNotify: 같은 key 는 한 번 · 글 꼴은 주인 틱 카드 알림(P.cardMsg)과 같음(누르면 ./?open=card:<id>) · 회원 칸에서는 거절 · nSubs", async () => {
  const { D1 } = d1(), pu = fakeDO(D1), P = await import("./push.ts");
  assert.equal((await pu.oNotify({ id: "1793000000.000301", question: "결제 장애", kind: "decision" }, "card:1793000000.000301"))[0], 200);
  assert.equal((await pu.oNotify({ id: "1793000000.000301", question: "결제 장애", kind: "decision" }, "card:1793000000.000301"))[1].dup, true, "두 번째는 안 보냄");
  await pu.oNotify({ id: "1793000000.000302", question: "새 기기 허용?" }, "card:1793000000.000302");
  await pu.oNotify({ id: "1793000000.000303", question: "어느 쪽?", kind: "question" }, "card:1793000000.000303");
  const items = (await pu.page(0))[1].items;
  const tick = P.cardMsg({ ts: "1793000000.000301", area: "primary", kind: "decision", title: "결제 장애", label: null, shape: null });
  assert.deepEqual(items[0], tick, "제목 · 몸 · 주소 · tag 가 주인 틱 꼴");
  assert.deepEqual(items.map((m: any) => [m.title, m.body, m.url, m.tag]), [
    ["Primary · 창 결정", "결제 장애", "./?open=card:1793000000.000301", "card:1793000000.000301"],
    ["Primary · 결정", "새 기기 허용?", "./?open=card:1793000000.000302", "card:1793000000.000302"],
    ["Primary · 질문", "어느 쪽?", "./?open=card:1793000000.000303", "card:1793000000.000303"]]);
  assert.equal(items.some((m: any) => m.title === P.M_TITLE), false, "회원 꼴(「내 차례」) 아님");
  const mp = fakeDO(D1); await mp.mNotify(MEMBER, { id: "1793000000.000304", question: "회원 카드" }, "card:1793000000.000304");
  assert.equal((await mp.mPage(MEMBER, 0))[1].items[0].title, P.M_TITLE, "회원 알림 꼴은 그대로");
  assert.equal(await pu.nSubs(), 0);
  const mem = fakeDO(D1); await mem.mPrefs(MEMBER);
  assert.equal((await mem.oNotify({ id: "x", question: "q" }, "card:x"))[0], 403, "회원 칸은 주인 길 거절");
});

test("routeOwnerCard: 급한 카드 · 비밀 넣기 허용만 — 보통 · 할 일 · 옛 글 · 온보딩 30분 안은 안 감", async () => {
  const { D1, db } = d1(), got: string[] = [], pu = { oNotify: async (c: { id: string; kind?: string }, k: string) => { got.push(c.id + "|" + k + "|" + (c.kind ?? "")); return [200, {}]; } };
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)").run("d", OWNER, "x", "", "h".repeat(64), Date.now() - 3600_000, Date.now(), "full");
  const now = Date.now();
  await routeOwnerCard(D1, OWNER, { id: "a", question: "보통", at: now }, pu);
  await routeOwnerCard(D1, OWNER, { id: "b", question: "급함", kind: "question", urgent: true, at: now }, pu);
  await routeOwnerCard(D1, OWNER, { id: "c", question: "할 일", kind: "todo", urgent: true, at: now }, pu);
  await routeOwnerCard(D1, OWNER, { id: "d", question: "옛 급함", urgent: true, at: now, orig_at: now - 3600_000 }, pu);
  await routeOwnerCard(D1, OWNER, { id: "e", question: "새 기기 허용?", secret: true, at: now }, pu);
  await routeOwnerCard(D1, OWNER, { id: "f", question: "첫 물결 급함", urgent: true, at: now - 3600_000 + 60_000 }, pu);
  assert.deepEqual(got, ["b|card:b|question", "e|card:e|"], "카드 종류도 넘김(주인 틱 제목 「Primary · 질문」)");
});
