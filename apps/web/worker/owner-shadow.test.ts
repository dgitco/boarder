import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
const ledger = await import("./ledger.ts");
const { Engine } = await import("./engine.ts");
const MB = await import("./member-board.ts");
const SH = await import("./owner-shadow.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", e); return new Response("{}", { status: 500 }); });

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => run1(sql, args),
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = ss.map(s => /^\s*select/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; } },
  } as unknown as D1Database;
  return { db, D1 };
}
const OWNER = "owner@example.test", OWNER2 = "owner-alt@example.test", MEMBER = "member@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up", ADMIN = "admin-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}

const HWINS = [
  { id: "ew_pane15", state: "background", name: "총괄", meta: { pane: "%15", win: "1 총괄", role: "리드", cwd: "~/work", kind: "primary" } },
  { id: "ew_pane179", state: "idle", name: "총괄", meta: { pane: "%179", win: "1 총괄", role: "회사 리드", cwd: "~/work/area", kind: "arealead", area: "company" } },
  { id: "ew_pane40", state: "busy", name: "지어낸 일", meta: { pane: "%40", win: "5 지어낸 일", role: "리드", cwd: "~/src/x" } },
  { id: "ew_pane41", state: "waiting", name: "지어낸 일", meta: { pane: "%41", win: "5 지어낸 일", role: "도우미", cwd: "~/src/x" } },
  { id: "ew_pane77", state: "parked", name: "주차한 일", meta: { pane: "%77", win: "주차한 일", role: "리드", parked: true } },
];
const SNAP = {
  generated: "2026-11-05 12:00",
  panes: [
    { win: "1 총괄", role: "리드", pane: "%15", state: "뒤 작업 중", kind: "primary", area: "primary" },
    { win: "1 총괄", role: "회사 리드", pane: "%179", state: "쉼", kind: "arealead", area: "company" },
    { win: "5 지어낸 일", role: "리드", pane: "%40", state: "일하는 중", kind: "lead", area: "dgit" },
    { win: "5 지어낸 일", role: "도우미", pane: "%41", state: "Owner 대기", kind: "helper", area: "dgit" },
  ],
  parked: [{ id: "c9", name: "주차한 일", msg: "지어낸 조건" }],
  promises: [], decisions: [],
};

async function setup() {
  const { db, D1 } = d1(), T = Date.now();
  SH._reset();
  await ledger.setFlag(D1, "shadow_unified", false);   // 스위치 캐시(isolate 10초)를 이 DB 로 비움
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, T);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devH", OWNER, "owner-host harness", "", "h1", T, T, "harness", T);
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(MEMBER, "메인 봇", "chat", "회원 글", "primary", T - 1000);
  const eng = new (Engine as any)({ setWebSocketAutoResponse() {} }, { DB: D1 });
  await eng.hsync(HWINS, true, "devH", OWNER, T);   // hello 와 같은 길
  let snapBody = JSON.stringify(SNAP);
  const sent: any[] = [], pending: Promise<unknown>[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: any, o: any) => { if (String(u).startsWith("https://ph.example.test")) { sent.push(JSON.parse(o.body)); return new Response("{}"); } return realFetch(u, o); }) as typeof fetch;
  const env: any = { DB: D1, RESULTS: { get: async () => null, put: async () => {}, head: async () => null, list: async () => ({ objects: [] }) },
    SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0, get: async (k: string) => k === "data" ? { body: snapBody, etag: '"s1"', at: Date.now(), checked: Date.now() } : null }) },
    BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: `${OWNER},${OWNER2}`, PUBLIC_URL: "https://example.test", ADMIN_TOKEN: ADMIN, POSTHOG_KEY: "phc_made_up", POSTHOG_HOST: "https://ph.example.test",
    ENGINE: { idFromName: (n: string) => n, get: () => ({}) } };
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p.catch(() => {})); }, passThroughOnException() {} };
  const drain = async () => { for (let i = 0; i < 20 && pending.length; i++) await Promise.all(pending.splice(0)); };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    await drain();
    return { status: r.status, j, text, etag: r.headers.get("etag") };
  };
  const flag = async (name: string, on: boolean) => { const r = await call("POST", "/api/admin/f7-flag", { name, on }, { authorization: `Bearer ${ADMIN}` }); assert.equal(r.status, 200, r.text); };
  const human = async (email: string) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  const done = () => { globalThis.fetch = realFetch; };
  return { db, D1, env, call, flag, human, sent, done, setSnap: (o: unknown) => { snapBody = JSON.stringify(o); } };
}
const events = (sent: any[], name: string) => sent.filter(e => e.event === name);
const WIN = new Set(["panes", "name", "state", "kind", "group", "parked"]);
const winAt = (at: string[] | string) => (Array.isArray(at) ? at : String(at).split(",")).filter(k => WIN.has(k));

test("회원 길이 canon 의 하네스 판을 판 · 주차로 읽음: 판 번호 = 진짜 %N, 창 이름 · 상태 · 종류는 스냅숏 꼴", async () => {
  const s = await setup();
  try {
    const D = await MB.data(s.D1, OWNER, null, await MB.load(s.D1, OWNER, true));
    const hp = (D.panes as any[]).filter(p => p.harness);
    assert.deepEqual(hp.map(p => [p.pane, p.win, p.state, p.kind]).sort(), [
      ["%15", "1 총괄", "뒤 작업 중", "primary"], ["%179", "1 총괄", "쉼", "arealead"], ["%40", "5 지어낸 일", "일하는 중", "lead"], ["%41", "5 지어낸 일", "Owner 대기", "helper"],
    ]);
    assert.deepEqual((D.parked as any[]).filter(x => x.harness).map(x => [x.pane, x.name]), [["%77", "주차한 일"]]);
    assert.equal((D.panes as any[])[0].pane, "%1", "메인 봇 판은 그대로 맨 앞");
    const d = SH.windowsDiff(SNAP, D);
    assert.deepEqual(winAt(d.at), [], JSON.stringify(d));
    assert.equal(d.n_snap, 4); assert.equal(d.n_d1, 4); assert.equal(d.parked_snap, 1); assert.equal(d.parked_d1, 1);
    const t = await (await import("./member-views.ts")).topics(s.D1, OWNER, null, await MB.load(s.D1, OWNER, true));
    assert.deepEqual((t as any).topics.filter((x: any) => x.panes.some((p: string) => /^%\d{1,3}$/.test(p))).map((x: any) => x.panes), [["%40"], ["%77"]], "리드 판 · 주차 창은 노드(topics)로 · 도우미 · 총괄 판은 아님");
  } finally { s.done(); }
});

test("회원 동작 그대로: canon 의 하네스 줄이 있어도 회원 판에는 안 섞임 · 줄을 지워도 회원 판 같음", async () => {
  const s = await setup();
  try {
    const strip = (o: any) => JSON.stringify({ ...o, generated: "" });
    const withH = strip(await MB.data(s.D1, MEMBER, { name: "메인 봇" }));
    s.db.prepare("DELETE FROM engine_window WHERE kind = 'harness'").run();
    assert.equal(strip(await MB.data(s.D1, MEMBER, { name: "메인 봇" })), withH, "회원 판이 하네스 줄과 무관");
    assert.ok(!withH.includes('"harness":true'), "회원 판에 하네스 판 없음");
  } finally { s.done(); }
});

test("windowsDiff: 한쪽에만 있는 판 · 이름 · 상태 · 종류 · 묶음 · 주차를 개수로만", () => {
  const d1 = { panes: [{ pane: "%1", win: "메인", kind: "primary" }, { pane: "%40", win: "5 다른 이름", state: "쉼", kind: "helper", harness: true }, { pane: "%99", win: "9 새 창", state: "쉼", kind: "lead", harness: true }, { pane: "%1234567", win: "들여온 노드", kind: "lead" }], parked: [] };
  const d = SH.windowsDiff(SNAP, d1);
  assert.deepEqual(winAt(d.at), ["panes", "name", "state", "kind", "group", "parked"]);
  assert.deepEqual([d.only_snap, d.only_d1, d.name, d.state, d.kind, d.parked_only_snap, d.parked_only_d1, d.d1_other], [3, 1, 1, 1, 1, 1, 0, 1]);
  assert.ok(!JSON.stringify(d).includes("총괄") && !JSON.stringify(d).includes("지어낸"), "창 이름 · 글은 안 실음");
});

test("스위치 shadow_unified 끔 = 예전 그대로(스냅숏 답 · 대조 없음) / 켬 = 같은 답 + 뒤에서 대조, 차이는 unify_shadow_diff(이름 없이)", async () => {
  const s = await setup();
  try {
    const h = await s.human(OWNER);
    const off = await s.call("GET", "/api/data", undefined, h);
    assert.equal(off.status, 200, off.text);
    assert.equal(off.text, JSON.stringify(SNAP), "끔: 스냅숏 그대로");
    assert.equal(s.sent.filter(e => /^unify_/.test(e.event)).length, 0, "끔: 대조 없음");

    await s.flag("shadow_unified", true);
    // 차이 없음 → diff 이벤트 없음, 답은 같음
    SH._reset();
    const same = await s.call("GET", "/api/data", undefined, h);
    assert.equal(same.text, off.text, "켬: 답은 그대로 스냅숏"); assert.equal(same.etag, off.etag);
    assert.ok(events(s.sent, "unify_shadow_diff").every(e => !winAt(e.properties.at).length), "창 목록이 같으면 창 칸 차이 없음");
    // 304 도 그대로
    SH._reset();
    const nm = await s.call("GET", "/api/data", undefined, { ...h, "if-none-match": String(off.etag) });
    assert.equal(nm.status, 304);
    const changed = { ...SNAP, panes: [...SNAP.panes.map(p => p.pane === "%40" ? { ...p, state: "쉼" } : p), { win: "7 스냅숏만", role: "리드", pane: "%55", state: "쉼", kind: "lead", area: "dgit" }] };
    s.setSnap(changed); SH._reset();
    s.sent.splice(0);
    const r = await s.call("GET", "/api/data", undefined, h);
    assert.equal(r.text, JSON.stringify(changed), "켬: 답은 스냅숏 그대로");
    const ev = events(s.sent, "unify_shadow_diff");
    assert.equal(ev.length, 1, JSON.stringify(s.sent.map(e => e.event)));
    const p = ev[0].properties;
    assert.deepEqual(winAt(p.at), ["panes", "state"]); assert.equal(p.only_snap, 1); assert.equal(p.state, 1); assert.equal(p.n_snap, 5); assert.equal(p.n_d1, 4);
    assert.ok(!JSON.stringify(ev[0]).includes("스냅숏만") && !JSON.stringify(ev[0]).includes("총괄") && !JSON.stringify(ev[0]).includes(OWNER), "창 이름 · 메일 안 실음");
    // 1분에 한 번: 바로 다시 불러도 대조 안 함
    await s.call("GET", "/api/data", undefined, h);
    assert.equal(events(s.sent, "unify_shadow_diff").length, 1, "isolate 마다 1분에 한 번");
    // 대조는 주인 줄을 안 씀(읽기 전용 load)
    assert.equal(s.db.prepare("SELECT count(*) n FROM engine_window WHERE kind = 'harness'").get()!.n, 5);
    // 회원 /api/data 는 회원 길 그대로(스냅숏 아님 · 대조 없음)
    SH._reset();
    const m = await s.call("GET", "/api/data", undefined, await s.human(MEMBER));
    assert.equal(m.status, 200, m.text);
    assert.notEqual(m.text, JSON.stringify(changed)); assert.ok(!m.text.includes('"harness":true'));
    assert.equal(events(s.sent, "unify_shadow_diff").length, 1, "회원 요청엔 대조 없음");
    await s.flag("shadow_unified", false);
  } finally { s.done(); }
});
