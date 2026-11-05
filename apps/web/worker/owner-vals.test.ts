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
const OV = await import("./owner-vals.ts");
const { localTools } = await import("./local.ts");
const { run } = await import("./mcp/tools.ts");
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
const TOK = { harness: "bxd_" + "h".repeat(32), member: "bxd_" + "m".repeat(32), watch: "bxd_" + "w".repeat(32) };
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
const S0 = Math.floor(Date.now() / 1000);
const TS = (n: number) => `1793000000.${String(n).padStart(6, "0")}`;
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const HSTATE = () => ({
  v: 1, at: S0,
  panes: { "%15": { area: "primary", kind: "primary", acct: "c", dur: "", stuck: "", branch: "", wait: 0 }, "%179": { area: "company", kind: "arealead", acct: "b", dur: "1시간", stuck: "", branch: "", wait: 0 },
    "%40": { area: "dgit", kind: "lead", acct: "c", dur: "12분", stuck: "", branch: "feat-x", wait: 2 }, "%41": { area: "dgit", kind: "helper", acct: "c", dur: "3분", stuck: "멈춤 의심", branch: "feat-x", wait: 0 } },
  topics: { "%40": [{ ch: "dgit", ts: TS(100), last: S0 - 50 }], "%41": [] },
  leads: { primary: "%15", leads: { company: "%179" }, windows: { "지어낸 일": "dgit" } },
  agents: [{ key: "qa", name: "QA 채널", lead: null }],
  parked: [{ id: "c9", name: "주차한 일", area: "dgit", msg: "지어낸 조건", owner: false, at: S0 - 600, stale: null, wait: "", topics: [], pane: null, short: "지어낸 조건", title: "지어낸 조건", watch: "PR 보는 중" }],
  archived: ["끝난 일"],
  promises: [{ n: 3, due: "2099-01-01", to: "동료", what: "지어낸 약속", watch: "감시 장치", pane: "%40" }],
  snoozed: [], ch_keys: { C0PRIMARY: "primary", C0DGIT: "dgit" }, attn: null,
});
const LOG: [number, number, string, string, string, string, string?][] = [
  [1, S0 - 7200, "%40", "5 지어낸 일", "시작", "지어낸 일 시작"],
  [2, S0 - 4000, "%88", "9 닫힌 일", "진행", "창 이름 바꿈 「옛 일」 → 「닫힌 일」"],
  [3, S0 - 3600, "%40", "5 지어낸 일", "진행", "지어낸 진행 — 반쯤"],
  [4, S0 - 3000, "%88", "9 닫힌 일", "끝", "다 했어요", "/home/x/projects/company/y"],
  [5, S0 - 600, "%40", "5 지어낸 일", "막힘", "Owner 답 기다림 — 고를 것"],
  [6, S0 - 300, "%15", "1 총괄", "감시", "감시 줄"],
  [7, S0 - 200, "%41", "5 지어낸 일", "진행", "도우미 진행"],
  [8, S0 - 150, "%15", "1 총괄", "결정", "배포 고르기 — 추천: 지금 / 대안: 내일"],
];
const SNAP = () => {
  const l = (id: number) => { const r = LOG.find(x => x[0] === id)!; return { id, ago: 0, kind: r[4], msg: r[5], handled: false }; };
  const rec = (...ids: number[]) => ids.map(id => { const r = LOG.find(x => x[0] === id)!; return { ago: 0, kind: r[4], msg: r[5] }; });
  const hist = (...ids: number[]) => ids.map(id => ({ m: 0, k: LOG.find(x => x[0] === id)![4] }));
  const H = HSTATE();
  return {
    generated: "2026-11-05 12:00",
    areas: [{ key: "primary", name: "프라이머리", lead: "%15" }, { key: "company", name: "회사", lead: "%179" }, { key: "personal", name: "퍼스널", lead: null }, { key: "dgit", name: "DGit", lead: null }, { key: "shop", name: "가게", lead: null }],
    agents: [{ key: "qa", name: "QA 채널", lead: null }],
    panes: [
      { win: "1 총괄", role: "리드", pane: "%15", state: "뒤 작업 중", kind: "primary", ...H.panes["%15"], last: l(8), blocked: null, recent: rec(8), hist: hist(8), topics: [], pri: "", owner: false, watch: "" },
      { win: "1 총괄", role: "회사 리드", pane: "%179", state: "쉼", kind: "arealead", ...H.panes["%179"], last: null, blocked: null, recent: [], hist: [], topics: [], pri: "", owner: false, watch: "" },
      { win: "5 지어낸 일", role: "리드", pane: "%40", state: "일하는 중", kind: "lead", ...H.panes["%40"], last: l(5), blocked: l(5), recent: rec(1, 3, 5), hist: hist(1, 3, 5), topics: H.topics["%40"], pri: "높음", owner: true, watch: "" },
      { win: "5 지어낸 일", role: "도우미", pane: "%41", state: "Owner 대기", kind: "helper", ...H.panes["%41"], last: l(7), blocked: null, recent: rec(7), hist: hist(7), topics: [], pri: "높음", owner: false, watch: "" },
    ],
    closed: [{ pane: "%88", win: "9 닫힌 일", ago: 50, msg: "다 했어요", area: "company" }],
    parked: [{ id: "c9", name: "주차한 일", area: "dgit", msg: "지어낸 조건", owner: false, ago: 10, stale: null, wait: "", topics: [], pri: "", pane: null, short: "지어낸 조건", title: "지어낸 조건", watch: "PR 보는 중" }],
    archived: ["끝난 일"], renames: { "옛 일": "닫힌 일" },
    decisions: [{ id: "w8", src: "wlog", pane: "%15", area: "primary", kind: "결정" }, { id: "Q-1", src: "queue", area: "dgit", kind: "할 일" }],
    to_check: [{ id: "Q-2", src: "queue", area: "dgit", why: "모름" }],
    promises: [{ n: 3, due: "2099-01-01", to: "동료", what: "지어낸 약속", watch: "감시 장치", pane: "%40", panes: ["%40"] }],
    feed: [8, 7, 5, 4, 3, 2, 1].map(id => ({ id })),
    park_metrics: null,
    cards: [{ ts: TS(200) }, { ts: TS(300) }], cardlist: [{ ts: TS(200) }, { ts: TS(300) }], cardsdone: [{ ts: TS(500) }], attn: null, relinks: {},
    todos: [{ ts: TS(300), id: "Q-1", due: today }], bthreads: [{ ref: "w5", ch: "dgit", ts: TS(400) }],
  };
};

async function setup() {
  const { db, D1 } = d1(), T = Date.now();
  SH._reset();
  await ledger.setFlag(D1, "shadow_unified", false);
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)");
  dev.run("devH", OWNER, "owner-host harness", "", await sha(TOK.harness), T, T, "harness", T);
  dev.run("devM", MEMBER, "회원 노트북", "", await sha(TOK.member), T, T, "full", T);
  dev.run("devW", OWNER, "주인 감시", "", await sha(TOK.watch), T, T, "watch", T);
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(MEMBER, "메인 봇", "chat", "회원 글", "primary", T - 1000);
  const eng = new (Engine as any)({ setWebSocketAutoResponse() {} }, { DB: D1 });
  await eng.hsync(HWINS, true, "devH", OWNER, T);
  for (const [id, at, pane, win, kind, msg, cwd] of LOG) db.prepare("INSERT INTO wl_log(id, at, pane, win, kind, msg, cwd) VALUES (?,?,?,?,?,?,?)").run(id, at, pane, win, kind, msg, cwd ?? null);
  const q = db.prepare("INSERT INTO wl_questions(qid, area, state, body, question, short, kind, card_ts, asked_at, pos) VALUES (?,?,?,?,?,?,?,?,?,?)");
  q.run("Q-1", "dgit", "open", "본문", `지어낸 할 일 기한 ${today.slice(5).replace("-", "/")}`, "지어낸 할 일", "할 일", null, S0 - 900, 1);
  q.run("Q-2", "dgit", "open", "본문", "끝났는지 모르는 일", "모르는 일", "할 일", TS(600), S0 - 800, 2);
  db.prepare("INSERT INTO wl_done_checks(item, verdict, why, at) VALUES (?,?,?,?)").run(TS(600), "모름", "모름", S0);
  const c = db.prepare("INSERT INTO wl_cards(ts, channel, area, kind, ref, title, state, thread, posted_at, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  c.run(TS(200), "C0PRIMARY", "primary", "decision", "w8", "배포 고르기", "open", null, S0 - 140, null);
  c.run(TS(300), "C0DGIT", "dgit", "todo", "dgit:Q-1", "지어낸 할 일", "open", null, S0 - 130, null);
  c.run(TS(400), "C0DGIT", "dgit", "blocker", "w5", "막힘", "open", null, S0 - 120, null);
  c.run(TS(500), "C0DGIT", "dgit", "decision", "w1", "끝난 결정", "done", null, S0 - 5000, S0 - 4000);
  db.prepare("INSERT INTO owner_state(k, v, at) VALUES ('node_pri', ?, ?)").run(JSON.stringify({ "지어낸 일": { pri: "높음", at: S0 } }), T);
  const sent: any[] = [], pending: Promise<unknown>[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: any, o: any) => { if (String(u).startsWith("https://ph.example.test")) { sent.push(JSON.parse(o.body)); return new Response("{}"); } return realFetch(u, o); }) as typeof fetch;
  let snapBody = JSON.stringify(SNAP());
  const env: any = { DB: D1, RESULTS: { get: async () => null, put: async () => {}, head: async () => null, list: async () => ({ objects: [] }) },
    SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0, get: async (k: string) => k === "data" ? { body: snapBody, etag: '"s1"', at: Date.now(), checked: Date.now() } : null }) },
    BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: `${OWNER},${OWNER2}`, PUBLIC_URL: "https://example.test", ADMIN_TOKEN: ADMIN, POSTHOG_KEY: "phc_made_up", POSTHOG_HOST: "https://ph.example.test",
    ENGINE: { idFromName: (n: string) => n, get: () => ({}) } };
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p.catch(() => {})); }, passThroughOnException() {} };
  const drain = async () => { for (let i = 0; i < 20 && pending.length; i++) await Promise.all(pending.splice(0)); };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    await drain();
    return { status: r.status, j, text };
  };
  const flag = async (name: string, on: boolean) => { const r = await call("POST", "/api/admin/f7-flag", { name, on }, { authorization: `Bearer ${ADMIN}` }); assert.equal(r.status, 200, r.text); };
  const up = (body: unknown, tok = TOK.harness) => call("POST", "/api/device/owner-state", body, { authorization: `Bearer ${tok}` });
  const owner = async () => MB.data(D1, OWNER, null, await MB.load(D1, OWNER, true));
  return { db, D1, call, flag, up, owner, sent, setSnap: (o: unknown) => { snapBody = JSON.stringify(o); }, human: async (email: string) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" }), done: () => { globalThis.fetch = realFetch; } };
}

test("(가)+(나): 장부 · 카드 · 질문 사본과 하네스가 올린 값이 회원 길 판에 나오고, 같은 때 스냅숏과 대조하면 차이 0", async () => {
  const s = await setup();
  try {
    await s.flag("shadow_unified", true);
    const r = await s.up(HSTATE());
    assert.equal(r.status, 200, r.text); assert.deepEqual(r.j.promises, { opened: 1, changed: 0, closed: 0, reopened: 0, held: 0 });
    const D: any = await s.owner();
    const p40 = D.panes.find((p: any) => p.pane === "%40");
    assert.equal(p40.area, "dgit"); assert.equal(p40.acct, "c"); assert.equal(p40.dur, "12분"); assert.equal(p40.branch, "feat-x"); assert.equal(p40.wait, 2);
    assert.equal(p40.last.id, 5); assert.equal(p40.blocked.id, 5); assert.equal(p40.owner, true); assert.equal(p40.pri, "높음");
    assert.deepEqual(p40.recent.map((x: any) => x.kind), ["시작", "진행", "막힘"]); assert.deepEqual(p40.topics.map((x: any) => x.ts), [TS(100)]);
    assert.equal(D.panes.find((p: any) => p.pane === "%41").stuck, "멈춤 의심");
    assert.equal(D.panes.find((p: any) => p.pane === "%15").last.id, 8, "감시 줄도 마지막 줄 · 최근 줄에서는 뺌");
    assert.deepEqual(D.panes.find((p: any) => p.pane === "%15").recent.map((x: any) => x.kind), ["결정"]);
    const pk = D.parked.find((x: any) => x.harness && x.name === "주차한 일");
    assert.equal(pk.msg, "지어낸 조건"); assert.equal(pk.watch, "PR 보는 중"); assert.equal(pk.pane, "%77", "주차 판 번호는 하네스 판 그대로");
    assert.deepEqual(D.renames, { "옛 일": "닫힌 일" });
    assert.deepEqual(D.closed.filter((x: any) => x.wl).map((x: any) => [x.pane, x.area]), [["%88", "company"]]);
    assert.deepEqual(D.decisions.map((d: any) => d.id).sort(), ["Q-1", "hw8"], "장부 결정은 hw<장부 id> — 회원 카드 w<rowid> 와 안 겹침");
    assert.deepEqual(D.decisions.find((d: any) => d.id === "hw8").choices, ["지금", "내일"]);
    assert.deepEqual(D.to_check.map((d: any) => d.id), ["Q-2"]);
    assert.deepEqual(D.todos.map((t: any) => [t.ts, t.due]), [[TS(300), today]]);
    assert.deepEqual(D.bthreads, [{ ref: "hw5", ch: "dgit", ts: TS(400) }]);
    assert.equal(D.cardlist.find((c: any) => c.ts === TS(200)).ref, "hw8", "카드 ref 도 장부 결정 id 머리와 같게");
    assert.deepEqual(D.cards.map((c: any) => [c.ts, c.channel]), [[TS(200), "primary"], [TS(300), "dgit"]]);
    assert.deepEqual(D.promises.map((x: any) => [x.n, x.hp, x.what, x.pane]), [[3, true, "지어낸 약속", "%40"]], "약속은 member_promise(hp:3)로 — 번호는 promises.md 번호, 판 번호 그대로");
    assert.deepEqual(D.areas.slice(0, 5).map((a: any) => [a.key, a.lead]), [["primary", "%15"], ["company", "%179"], ["personal", null], ["dgit", null], ["shop", null]]);
    assert.deepEqual(D.agents.map((a: any) => a.key), ["qa"]);
    assert.ok(D.harness_state_at > 0);
    const d = SH.windowsDiff(SNAP(), D);
    assert.deepEqual(d.at, [], JSON.stringify(d));
    assert.ok(d.hs_age >= 0 && d.hs_age < 60);
  } finally { s.done(); }
});

test("대조 항목: 스냅숏과 칸이 다르면 그 칸 이름 · 개수가 잡힘(창 이름 · 글은 안 실음)", async () => {
  const s = await setup();
  try {
    await s.flag("shadow_unified", true);
    assert.equal((await s.up(HSTATE())).status, 200);
    const D: any = await s.owner();
    const cases: [string, (o: any) => void, number][] = [
      ["area", o => { o.panes[2].area = "company"; }, 1], ["acct", o => { o.panes[2].acct = "d"; }, 1], ["dur", o => { o.panes[3].dur = "9분"; }, 0],
 ["stuck", o => { o.panes[3].stuck = ""; }, 1], ["branch", o => { o.panes[2].branch = "main"; }, 1],
      ["last", o => { o.panes[0].last.id = 6; }, 1], ["blocked", o => { o.panes[2].blocked = null; }, 1], ["recent", o => { o.panes[2].recent.pop(); }, 1], ["hist", o => { o.panes[3].hist = []; }, 1],
      ["owner", o => { o.panes[2].owner = false; }, 1], ["wait", o => { o.panes[2].wait = 0; }, 1], ["topics", o => { o.panes[2].topics = []; }, 1], ["pri", o => { o.panes[2].pri = "낮음"; }, 1],
      ["pk_msg", o => { o.parked[0].msg = "다른 조건"; }, 1], ["pk_stale", o => { o.parked[0].stale = "다시 열 장치가 없어 저절로 안 열림"; }, 1], ["pk_wait", o => { o.parked[0].wait = "Owner 답 기다리는 중"; }, 1], ["pk_watch", o => { o.parked[0].watch = ""; }, 1],
      ["feed", o => { o.feed.shift(); }, 1], ["closed", o => { o.closed = []; }, 1], ["archived", o => { o.archived.push("또 끝난 일"); }, 1], ["decisions", o => { o.decisions.pop(); }, 1], ["to_check", o => { o.to_check = []; }, 1],
      ["promises", o => { o.promises[0].due = "2099-02-02"; }, 2], ["areas", o => { o.areas[1].lead = "%180"; }, 2], ["agents", o => { o.agents = []; }, 1], ["cards", o => { o.cards.pop(); }, 1], ["cardlist", o => { o.cardlist = []; }, 2],
      ["cardsdone", o => { o.cardsdone = []; }, 1], ["bthreads", o => { o.bthreads = []; }, 1], ["todos", o => { o.todos = []; }, 1], ["renames", o => { o.renames = {}; }, 1], ["attn", o => { o.attn = { groups: [] }; }, 1],
    ];
    for (const [k, mut, n] of cases) {
      const snap = SNAP(); mut(snap);
      const d: any = SH.windowsDiff(snap, D);
      if (n === 0) { assert.deepEqual(d.at, [], `${k} 는 대조 안 함: ${JSON.stringify(d)}`); continue; }
      assert.deepEqual(d.at, [k], `${k}: ${JSON.stringify(d)}`); assert.equal(d[k], n, k);
      assert.ok(!/지어낸|총괄|닫힌 일|동료/.test(JSON.stringify(d)), "글 · 이름 안 실음");
    }
  } finally { s.done(); }
});

test("하네스가 값을 안 올렸으면 그 값 칸이 차이로 잡히고 hs_age = -1(켜는 순서 확인용)", async () => {
  const s = await setup();
  try {
    const d: any = SH.windowsDiff(SNAP(), await s.owner());
    for (const k of ["area", "acct", "wait", "topics", "pk_msg", "pk_watch", "areas", "agents", "archived", "promises"]) assert.ok(d.at.includes(k), `${k}: ${d.at}`);
    for (const k of ["last", "blocked", "recent", "hist", "owner", "pri", "feed", "closed", "decisions", "cards", "cardlist", "bthreads", "renames"]) assert.ok(!d.at.includes(k), `(가) 사본 칸은 기기 값 없이도 같음: ${k}`);
    assert.equal(d.hs_age, -1);
  } finally { s.done(); }
});

test("기기 길 인증: 하네스 기기만(회원 full · 주인 감시 · 토큰 없음 · 로그인 세션은 401) · 스위치 끔이면 204 로 안 씀 · 꼴이 틀리면 400", async () => {
  const s = await setup();
  try {
    const kept = () => s.db.prepare("SELECT count(*) n FROM user_pref WHERE k = 'harness_state'").get()!.n;
    // 끔: 받기만 하고 안 씀
    const off = await s.up(HSTATE());
    assert.equal(off.status, 204); assert.equal(kept(), 0); assert.equal(s.db.prepare("SELECT count(*) n FROM member_promise").get()!.n, 0);
    await s.flag("shadow_unified", true);
    assert.equal((await s.up(HSTATE(), TOK.member)).status, 401, "회원 full 기기");
    assert.equal((await s.up(HSTATE(), TOK.watch)).status, 401, "주인 감시 기기");
    assert.equal((await s.call("POST", "/api/device/owner-state", HSTATE())).status, 401, "토큰 없음");
    assert.equal((await s.call("POST", "/api/device/owner-state", HSTATE(), await s.human(OWNER))).status, 401, "주인 로그인 세션도 아님");
    assert.equal(kept(), 0);
    assert.equal((await s.up({ v: 2 })).status, 400); assert.equal((await s.up("not json")).status, 400);
    assert.equal((await s.up("x".repeat(600_000))).status, 413);
    assert.equal((await s.up(HSTATE())).status, 200); assert.equal(kept(), 1);
    const row: any = s.db.prepare("SELECT owner, v FROM user_pref WHERE k = 'harness_state'").get();
    assert.equal(row.owner, OWNER, "열쇠 = canon(하네스 기기 주인)");
    assert.ok(!("promises" in JSON.parse(row.v)), "약속은 member_promise 에만");
    await s.flag("shadow_unified", false);
  } finally { s.done(); }
});

test("약속 맞추기: promises.md 열린 약속 → member_promise(hp:<번호>) 넣기 · 고치기 · 닫기, 파일을 못 읽으면(null) 그대로", async () => {
  const s = await setup();
  try {
    await s.flag("shadow_unified", true);
    const rows = () => s.db.prepare("SELECT wid, win, due, state FROM member_promise WHERE owner = ? ORDER BY wid").all(OWNER).map((r: any) => [r.wid, r.win, r.due, r.state]);
    const H = HSTATE();
    H.promises.push({ n: 4, due: "2099-03-03", to: "팀", what: "또 다른 약속", watch: "감시", pane: "" });
    assert.deepEqual((await s.up(H)).j.promises, { opened: 2, changed: 0, closed: 0, reopened: 0, held: 0 });
    assert.deepEqual(rows(), [["hp:3", "%40", "2099-01-01", "open"], ["hp:4", "%15", "2099-03-03", "open"]]);
    assert.deepEqual((await s.up(H)).j.promises, { opened: 0, changed: 0, closed: 0, reopened: 0, held: 0 }, "같으면 안 씀");
    const H2 = HSTATE(); H2.promises = [{ n: 4, due: "2099-04-04", to: "팀", what: "또 다른 약속", watch: "감시", pane: "%41" }];
    assert.deepEqual((await s.up(H2)).j.promises, { opened: 0, changed: 1, closed: 1, reopened: 0, held: 0 });
    assert.deepEqual(rows(), [["hp:3", "%40", "2099-01-01", "kept"], ["hp:4", "%41", "2099-04-04", "open"]]);
    const H3: any = HSTATE(); H3.promises = null;
    assert.equal((await s.up(H3)).j.promises, null);
    assert.deepEqual(rows()[1], ["hp:4", "%41", "2099-04-04", "open"], "파일을 못 읽은 때는 안 닫음");
    // 회원이 적은 약속(hp: 아님)은 안 건드림
    s.db.prepare("INSERT INTO member_promise(owner, win, wid, who, what, check_by, due, at) VALUES (?,?,?,?,?,?,?,?)").run(OWNER, "1 총괄", "ew_x", "누구", "회원 길 약속", "장치", "2099-05-05", Date.now());
    await s.up(HSTATE());
    assert.equal(s.db.prepare("SELECT state FROM member_promise WHERE wid = 'ew_x'").get()!.state, "open");
    await s.flag("shadow_unified", false);
  } finally { s.done(); }
});

test("회원 회귀 없음: 장부 사본 · 하네스 값이 있어도 회원 판은 같고 owner-vals 를 안 탐", async () => {
  const s = await setup();
  try {
    const strip = (o: any) => JSON.stringify({ ...o, generated: "" });
    const before = strip(await MB.data(s.D1, MEMBER, { name: "메인 봇" }));
    await s.flag("shadow_unified", true);
    assert.equal((await s.up(HSTATE())).status, 200);
    const after = strip(await MB.data(s.D1, MEMBER, { name: "메인 봇" }));
    assert.equal(after, before);
    assert.ok(!after.includes("harness_state_at") && !after.includes('"wl":true'));
    const plain: any = await MB.data(s.D1, OWNER, null);
    assert.ok(!("harness_state_at" in plain));
    await s.flag("shadow_unified", false);
  } finally { s.done(); }
});

test("끝에서 끝: 스위치 켬 + 하네스 값 올림 → 주인 /api/data 답은 스냅숏 그대로 · 같은 판이면 차이 이벤트 없음, 다르면 새 칸 이름으로", async () => {
  const s = await setup();
  try {
    const h = await s.human(OWNER);
    const off = await s.call("GET", "/api/data", undefined, h);
    assert.equal(off.text, JSON.stringify(SNAP()));
    await s.flag("shadow_unified", true);
    assert.equal((await s.up(HSTATE())).status, 200);
    SH._reset(); s.sent.splice(0);
    const on = await s.call("GET", "/api/data", undefined, h);
    assert.equal(on.text, off.text, "답은 그대로");
    assert.equal(s.sent.filter(e => e.event === "unify_shadow_diff").length, 0, JSON.stringify(s.sent.filter(e => e.event === "unify_shadow_diff").map(e => e.properties.at)));
    const snap = SNAP(); snap.panes[2].branch = "main"; snap.todos = []; s.setSnap(snap); SH._reset();
    const r = await s.call("GET", "/api/data", undefined, h);
    assert.equal(r.text, JSON.stringify(snap));
    const ev = s.sent.filter(e => e.event === "unify_shadow_diff");
    assert.equal(ev.length, 1); assert.equal(ev[0].properties.at, "branch,todos"); assert.equal(ev[0].properties.branch, 1); assert.ok(ev[0].properties.hs_age >= 0);
    assert.ok(!JSON.stringify(ev[0]).includes("feat-x") && !JSON.stringify(ev[0]).includes(OWNER));
    await s.flag("shadow_unified", false);
  } finally { s.done(); }
});

test("hp: 약속: 창 도구 promise_list 는 hp:<번호> 로 보이고 promise_done 으로 닫으면 하네스가 1분 뒤 다시 안 엶 · 파일에서 빠졌다 다시 나타난 것만 다시 엶 · 목록 50 은 내 약속 먼저", async () => {
  const s = await setup();
  try {
    await s.flag("shadow_unified", true);
    const tools = localTools(s.D1, OWNER, "1 총괄", "https://example.test");
    const ctx = { agent: "t", publicUrl: "https://example.test", view: { visible: () => true, why: () => null, desc: () => "", mask: () => false }, get: async () => ({}), op: async () => ({}), local: tools };
    const H: any = HSTATE(); H.promises = Array.from({ length: 60 }, (_, i) => ({ n: i + 1, due: "2099-01-01", to: "동료", what: `하네스 약속 ${i + 1}`, watch: "감시", pane: "%40" }));
    assert.equal((await s.up(H)).j.promises.opened, 60);
    const mine = await run(ctx as never, "promise_add", { who: "팀", what: "내 약속", check: "결과 글", due: "2099-02-02" }) as any;
    const L = (await run(ctx as never, "promise_list", {}) as any).promises;
    assert.equal(L[0].promise_id, mine.promise_id, "창이 적은 약속이 먼저(하네스 약속에 밀려나지 않음)");
    assert.equal(L.length, 51); assert.ok(L.slice(1).every((p: any) => /^hp:\d+$/.test(p.promise_id)));
    assert.deepEqual(await run(ctx as never, "promise_done", { promise_id: "hp:5", done: "알려 드림" }), { ok: true });
    await assert.rejects(run(ctx as never, "promise_done", { promise_id: "hp:5", done: "또" }), /없는 약속/);
    await assert.rejects(run(ctx as never, "promise_done", { promise_id: "hp:x", done: "꼴 틀림" }), /입력이 맞지 않음/);
    const again = (await s.up(H)).j.promises;
    assert.deepEqual(again, { opened: 0, changed: 0, closed: 0, reopened: 0, held: 1 });
    const st = (wid: string) => s.db.prepare("SELECT state, done FROM member_promise WHERE owner = ? AND wid = ?").all(OWNER, wid).map((r: any) => r.state);
    assert.deepEqual(st("hp:5"), ["kept"]);
    // hp:7 이 파일에서 빠짐 → 닫힘(SYNC_DONE) → 다시 나타나면 같은 줄을 다시 엶(줄이 늘지 않음)
    const H2: any = { ...H, promises: H.promises.filter((p: any) => p.n !== 7) };
    assert.equal((await s.up(H2)).j.promises.closed, 1);
    assert.deepEqual((await s.up(H)).j.promises, { opened: 0, changed: 0, closed: 0, reopened: 1, held: 1 });
    assert.deepEqual(st("hp:7"), ["open"]);
    // 화면 번호 = 파일 번호, 기한 지남 확인 id 도 hp 머리
    const D: any = await s.owner();
    assert.ok(D.promises.some((p: any) => p.n === 7 && p.hp) && D.promises.some((p: any) => p.n === mine.promise_id && !p.hp));
    await s.flag("shadow_unified", false);
  } finally { s.done(); }
});

test("섞을 때 정리: 장부 결정 hw<id> 와 회원 카드 결정 w<rowid> 가 같은 숫자여도 둘 다 · 카드 목록 · 끝난 것은 같은 ts 한 번(장부 줄이 이김) · 피드는 새 것부터", async () => {
  const s = await setup();
  try {
    await s.flag("shadow_unified", true);
    assert.equal((await s.up(HSTATE())).status, 200);
    s.db.prepare("INSERT INTO board_card(rowid, id, owner, win, question, choices, state, at) VALUES (?,?,?,?,?,?,?,?)").run(8, "1793000001.000001", OWNER, "1 총괄", "회원 카드 결정", '["가","나"]', "open", Date.now() - 60_000);
    s.db.prepare("INSERT INTO board_card(id, owner, win, question, choices, state, at, answered_at) VALUES (?,?,?,?,?,?,?,?)").run(TS(500), OWNER, "1 총괄", "겹친 끝난 카드", "[]", "closed", Date.now() - 90_000, Date.now() - 80_000);
    s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(OWNER, "1 총괄", "progress", "회원 길 줄", null, Date.now() - 30_000);
    const D: any = await s.owner();
    const ids = D.decisions.map((d: any) => d.id);
    assert.ok(ids.includes("w8") && ids.includes("hw8"), JSON.stringify(ids));
    assert.equal(new Set(ids).size, ids.length, "결정 id 겹침 없음");
    assert.equal(D.cardsdone.filter((c: any) => c.ts === TS(500)).length, 1); assert.equal(D.cardsdone.find((c: any) => c.ts === TS(500)).wl, true, "같은 ts 는 장부 줄");
    const ts = D.cardlist.map((c: any) => c.ts); assert.equal(new Set(ts).size, ts.length);
    const at = D.cardlist.map((c: any) => Number(c.at)); assert.deepEqual(at, [...at].sort((a, b) => a - b), "카드 목록은 시각 순");
    const ago = D.feed.map((f: any) => f.ago); assert.deepEqual(ago, [...ago].sort((a, b) => a - b), "피드는 새 것부터");
    assert.ok(D.feed.some((f: any) => !f.wl) && D.feed.some((f: any) => f.wl), "회원 길 줄과 장부 줄이 같이");
    const d: any = SH.windowsDiff(SNAP(), D);
    assert.equal(d.decisions, 1, "대조: hw8 은 스냅숏 w8 과 같은 열쇠 — 더한 회원 카드 하나만 차이");
    await s.flag("shadow_unified", false);
  } finally { s.done(); }
});
