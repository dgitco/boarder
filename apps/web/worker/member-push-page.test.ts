// node --test --no-warnings --experimental-transform-types apps/web/worker/member-push-page.test.ts (Node 22.18+ · node:sqlite · apps/web 의존성 설치된 채)
// 「보드가 열려 있을 때 알림」(웹 푸시 서비스가 없는 브라우저): board.html 의 진짜 코드를 잘라 가짜 브라우저로 돌림 + 회원 넓힘 서버 길(진짜 index.ts · Pusher, 가짜 저장소).
// 끄기 → 다시 켜기 · 탭 여럿 · 안내 글 · 영업 보드 주소 · 페이지 모드 회원 넓힘 · 알림을 못 띄우는 브라우저 · 한 번에 여러 개. 실제 알림은 안 나감. 자료는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
(globalThis as any).HTMLRewriter ??= class { on() { return this; } transform(r: Response) { return r; } };
const { default: app } = await import("./index.ts");
const { routeCard, routeLine, setWideRow, linePushOpen, claimEndpoint } = await import("./member-push.ts") as any;
const { onboarding } = await import("./member-onboarding.ts") as any;
const { Pusher } = await import("./push-do.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", (e as Error).stack); return new Response("{}", { status: 500 }); });

const SRC = ["../../../harness/engine/board/board.html", "../board-template/page.html"].map(f => new URL(f, import.meta.url)).find(u => existsSync(u))!;
const html = readFileSync(SRC, "utf8");
const cut = (a: string, b: string | RegExp) => { const i = html.indexOf(a), j = typeof b === "string" ? html.indexOf(b, i) : i + html.slice(i).search(b); assert.ok(i >= 0 && j > i, "보드 코드에서 못 찾음: " + a); return html.slice(i, j); };
const CODE = cut("const pushNoSvc =", "const spin =") + cut("let pushPrefs =", "function pushOpen(") + cut("function pushOpen(", /\$\(['"]#h-push['"]\)\.addEventListener\(['"]click['"], \(\) => pushSub/);
const NAMES = ["window", "document", "location", "localStorage", "fetch", "setInterval", "clearInterval", "Notification", "$", "lsGet", "lsSet", "pushPost", "pushReport", "pushEnable", "esc", "ERR", "PUSH_OK", "PUSH_FAIL", "IOS", "STANDALONE", "spin", "openChan", "openCard", "SUB0"];
const BOARD = new Function(...NAMES, `let pushSub = SUB0;\n${CODE}\nreturn {pageOn, pageOff, pageStream, pageMode, pushPanel, pushOpen};`);

const memLS = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), m }; };
const blockedLS = () => { const no = () => { throw new Error("막힘"); }; return { getItem: no, setItem: no, removeItem: no }; };
function pageServer() {
  const q = { seq: 0, items: [] as { seq: number; msg: any }[] };
  return { q, add(msg: any) { q.seq++; q.items.push({ seq: q.seq, msg }); },
    read: (after: number | null) => ({ seq: q.seq, items: after == null ? [] : q.items.filter(x => x.seq > after).map(x => x.msg) }) };
}
const msg = (n: number) => ({ title: "내 차례", body: "카드 " + n, url: `./?open=card:${n}`, tag: `card:${n}` });
function tab(o: { server?: ReturnType<typeof pageServer>; ls?: any; member?: any; caps?: any; href?: string; baseURI?: string; throws?: () => boolean; sub?: any; enable?: () => Promise<any>; prefs?: any } = {}) {
  const ls = o.ls ?? memLS(), server = o.server ?? pageServer(), shown: any[] = [], reports: string[] = [], assigns: string[] = [], timers: (() => void)[] = [], fetched: string[] = [], els: any[] = [], posts: any[] = [];
  let hold: Promise<void> | null = null;
  class N { static permission = "granted"; onclick: any; title: string; constructor(t: string, op: any) { if (o.throws?.()) throw new TypeError("Illegal constructor"); this.title = t; Object.assign(this, op); shown.push(this); } close() {} }
  const href = o.href ?? "https://board.example/", loc = { href, origin: new URL(href).origin, pathname: new URL(href).pathname, search: new URL(href).search, assign: (u: string) => assigns.push(u) };
  const doc = { baseURI: o.baseURI ?? href, body: { append() {} }, createElement: () => { const el: any = { innerHTML: "", on: {} as any, isConnected: true, remove() { el.isConnected = false; }, addEventListener(t: string, f: any) { el.on[t] = f; } }; els.push(el); return el; } };
  const win = { HB_MEMBER: o.member, HB_CAPS: o.caps, Notification: N, focus() {}, HBInbox: { openFeed() {} } };
  const el0 = { classList: { add() {}, toggle() {} } };
  const fakeFetch = async (u: string) => {
    fetched.push(u);
    if (hold) await hold;
    if (String(u).startsWith("api/push/prefs")) return { ok: true, json: async () => ({ ok: true, ...(o.prefs ?? { wide: false, progress: "digest" }) }) };
    const m = /after=(\d+)/.exec(u);
    return { ok: true, json: async () => server.read(m ? +m[1] : null) };
  };
  const lsGet = (k: string) => { try { return ls.getItem(k); } catch { return null; } }, lsSet = (k: string, v: string) => { try { ls.setItem(k, v); } catch {} };
  const api = BOARD(win, doc, loc, ls, fakeFetch, (f: () => void) => { timers.push(f); return timers.length; }, () => {}, N, (s: string) => (s === "#pushp" ? null : el0), lsGet, lsSet,
    async (p: string, b: any) => { posts.push([p, b]); return { ok: true }; }, (s: string) => reports.push(s), o.enable ?? (async () => ({ ok: true })), (s: string) => s, "오류", true, "오류", false, false, "<s>", () => {}, async () => true, o.sub ?? null);
  const flush = () => new Promise(r => setImmediate(r));
  return { ...api, ls, server, shown, reports, assigns, fetched, posts, els, flush,
    poll: async () => { timers.at(-1)!(); await flush(); await flush(); },
    holdFetch: () => { let open!: () => void; hold = new Promise(r => { open = () => { hold = null; r(); }; }); return open; },
    panel: () => els.at(-1), click: async (sel: string, dataset: any) => { const b = { dataset, disabled: false, innerHTML: "" }; await els.at(-1).on.click({ stopPropagation() {}, target: { closest: (s: string) => (s === sel ? b : null) } }); await flush(); } };
}
const startPage = async (t: ReturnType<typeof tab>) => { t.pageOn(); await t.flush(); await t.flush(); };

// ---------- 1. 끄기 뒤 다시 켜기 ----------
test("1. 페이지 모드에서 끄기 → 알림 켜기: 끔 표시가 지워져 폴링이 다시 돌고 패널도 「켜짐」", async () => {
  const noSvc = async () => { throw Object.assign(new Error("Registration failed - push service error"), { step: "subscribe" }); };
  const t = tab({ enable: noSvc });
  await startPage(t);
  t.pushPanel();
  await t.click("[data-pa]", { pa: "off" });
  assert.equal(t.pageMode(), false, "끔");
  assert.equal(t.ls.getItem("hb-push-off"), "1");
  await t.click("[data-pa]", { pa: "on" });
  assert.equal(t.ls.getItem("hb-push-off"), null, "다시 켜면 끔 표시가 지워짐");
  assert.equal(t.pageMode(), true);
  assert.match(t.panel().innerHTML, /켜짐 — 보드가 열려 있을 때/);
  const before = t.fetched.length;
  t.server.add(msg(1));
  await t.poll();
  assert.ok(t.fetched.length > before, "폴링이 살아 있음");
  assert.deepEqual(t.shown.map(n => n.body), ["카드 1"]);
});

// ---------- 2. 탭 여럿 ----------
test("2. 탭 둘: 한 탭이 띄운 알림은 다른 탭이 다시 안 띄움(닫은 알림이 되살아나지 않음)", async () => {
  const server = pageServer(), ls = memLS(), a = tab({ server, ls }), b = tab({ server, ls });
  await startPage(a); await startPage(b);
  server.add(msg(1));
  await a.poll(); await b.poll();
  assert.deepEqual(a.shown.map(n => n.tag), ["card:1"]);
  assert.deepEqual(b.shown.map(n => n.tag), [], "다른 탭은 안 띄움");
  server.add(msg(2));
  await b.poll(); await a.poll();
  assert.deepEqual(b.shown.map(n => n.tag), ["card:2"]);
  assert.deepEqual(a.shown.map(n => n.tag), ["card:1"]);
});

test("2. 탭 둘: 응답을 기다리는 사이 다른 탭이 먼저 띄웠으면 안 띄움", async () => {
  const server = pageServer(), ls = memLS(), a = tab({ server, ls }), b = tab({ server, ls });
  await startPage(a); await startPage(b);
  server.add(msg(1));
  const open = a.holdFetch();
  await a.poll();
  await b.poll();
  open(); await a.flush(); await a.flush();
  assert.equal(a.shown.length + b.shown.length, 1);
});

test("2. 새로 연 탭: 지난 알림을 안 띄우고, 이미 열린 탭 몫을 빼앗지 않음", async () => {
  const server = pageServer(), ls = memLS(), a = tab({ server, ls });
  await startPage(a);
  server.add(msg(1)); server.add(msg(2));
  const fresh = tab({ server, ls });
  await startPage(fresh);
  await fresh.poll();
  assert.deepEqual(fresh.shown, [], "연 뒤 새로 온 게 없으면 0");
  await a.poll();
  assert.equal(a.shown.length, 1, "열려 있던 탭은 그대로 받음");
  server.add(msg(3));
  await fresh.poll(); await a.poll();
  assert.deepEqual(fresh.shown.map(n => n.tag), ["card:3"]);
  assert.equal(a.shown.length, 1);
});

test("2. 오래 닫았다 다시 연 탭: 저장된 번호가 옛것이어도 밀린 알림을 안 쏟음", async () => {
  const server = pageServer(), ls = memLS(), a = tab({ server, ls });
  await startPage(a);
  server.add(msg(1)); await a.poll();
  for (let i = 2; i < 9; i++) server.add(msg(i));
  const back = tab({ server, ls });
  await startPage(back); await back.poll();
  assert.deepEqual(back.shown, []);
});

test("2. localStorage 가 막힌 브라우저: 탭마다 따로(지금과 같음) · 오류 없음", async () => {
  const server = pageServer(), a = tab({ server, ls: blockedLS() });
  await startPage(a);   // 다 막힌 브라우저: 페이지 모드가 안 켜지고(지금과 같음) 던지지도 않음
  assert.equal(a.pageMode(), false);
  // 번호 칸만 막힌 경우로 폴링을 시험
  const onlyAfter = () => { const m = memLS(); return { ...m, getItem: (k: string) => { if (k.startsWith("hb-push-after")) throw new Error("막힘"); return m.getItem(k); }, setItem: (k: string, v: string) => { if (k.startsWith("hb-push-after")) throw new Error("막힘"); m.setItem(k, v); } }; };
  const c = tab({ server, ls: onlyAfter() }), d = tab({ server, ls: onlyAfter() });
  await startPage(c); await startPage(d);
  server.add(msg(1));
  await c.poll(); await d.poll();
  assert.deepEqual([c.shown.length, d.shown.length], [1, 1]);
  await c.poll(); await d.poll();
  assert.deepEqual([c.shown.length, d.shown.length], [1, 1], "같은 탭에서 되풀이 없음");
});

test("2. 계정이 다르면 번호도 따로 · 서버 모음이 새로 시작하면 번호를 다시 맞춤", async () => {
  const ls = memLS(), s1 = pageServer(), s2 = pageServer();
  const a = tab({ server: s1, ls, member: { email: "a@example.com" } });
  await startPage(a);
  for (let i = 1; i < 6; i++) s1.add(msg(i));
  await a.poll();
  const b = tab({ server: s2, ls, member: { email: "b@example.com" } });
  await startPage(b);
  s2.add(msg(9)); await b.poll();
  assert.deepEqual(b.shown.map(n => n.tag), ["card:9"], "다른 계정의 큰 번호에 안 막힘");
  s1.q.seq = 0; s1.q.items = [];   // 칸 다시 만듦
  await a.poll();
  s1.add(msg(7)); await a.poll();
  assert.deepEqual(a.shown.at(-1).tag, "card:7");
});

// ---------- 3. 안내 글 ----------
const clickTest = async (t: ReturnType<typeof tab>) => { await t.click("[data-pa]", { pa: "test" }); return t.shown.at(-1).body as string; };
test("3. 주인: 패널 · 시험 알림 모두 「급한 일만」, 새 카드 약속 없음", async () => {
  const t = tab();
  await startPage(t); t.pushPanel();
  const h = t.panel().innerHTML;
  assert.match(h, /급한 일만 와요/);
  assert.doesNotMatch(h, /내 차례|새 카드/);
  const body = await clickTest(t);
  assert.match(body, /급한 일이/);
  assert.doesNotMatch(body, /Owner|카드|결정/);
});
test("3. 회원: 기본은 급한 일, 넓힘을 켠 사람은 결정 · 할 일 · 답까지 · Owner 낱말 없음", async () => {
  const off = tab({ member: { email: "a@example.com" } });
  await startPage(off); off.pushPanel();
  assert.match(off.panel().innerHTML, /급한 일만 와요/);
  assert.doesNotMatch(off.panel().innerHTML, /Owner|내 차례 새 카드만/);
  const b0 = await clickTest(off);
  assert.match(b0, /급한 일이/); assert.doesNotMatch(b0, /Owner|결정/);
  const on = tab({ member: { email: "a@example.com" }, prefs: { wide: true, progress: "digest" } });
  await startPage(on); on.pushPanel(); await on.flush(); await on.flush();
  assert.match(on.panel().innerHTML, /결정·할 일 새 카드/);
  const b1 = await clickTest(on);
  assert.match(b1, /급한 일과 결정·할 일·답이/); assert.doesNotMatch(b1, /Owner/);
});

test("3. 켠 주인(HB_MEMBER 있음 · HB_CAPS.push_wide 거짓): 패널 · 시험 알림 「급한 일만」 · 넓힘 칸 없음 · prefs 안 읽음 — 서버 값 전(push_wide 없음)은 회원 꼴 그대로", async () => {
  const sub = { endpoint: "https://push.example/send/on" };
  const on = tab({ member: { email: "owner@example.com" }, caps: { push: true, push_wide: false }, prefs: { wide: true, progress: "digest" }, sub });
  await startPage(on); on.pushPanel(); await on.flush(); await on.flush();
  const h = on.panel().innerHTML;
  assert.match(h, /급한 일만 와요\. 누르면 그 글이 열려요/);
  assert.doesNotMatch(h, /결정·할 일·답도 받기|결정·할 일 새 카드/);
  assert.equal(on.fetched.some(u => u.startsWith("api/push/prefs")), false, "주인 구독 칸엔 범위 칸 없음 — prefs 안 읽음");
  const old = tab({ member: { email: "owner@example.com" }, caps: { push: true }, prefs: { wide: true, progress: "digest" }, sub });
  await startPage(old); old.pushPanel(); await old.flush(); await old.flush();
  assert.match(old.panel().innerHTML, /결정·할 일·답도 받기/, "값이 없으면 지금 판정(회원 꼴)");
});

// ---------- 4. 영업 보드 주소 ----------
test("4. pushOpen: ?open= 이 아닌 같은 사이트 경로는 그 주소로 · 보드 첫 화면은 그대로 · 다른 사이트 · javascript: 는 안 감", async () => {
  const t = tab({ href: "https://board.example/chat/primary/1", baseURI: "https://board.example/" });
  t.pushOpen("https://board.example/sales", "card:sales:1");
  assert.deepEqual(t.assigns, ["https://board.example/sales"]);
  t.assigns.length = 0;
  t.pushOpen("https://board.example/", "digest");
  t.pushOpen("https://evil.example/sales", "x");
  t.pushOpen("//evil.example/sales", "x");
  t.pushOpen("/\\evil.example/sales", "x");
  t.pushOpen("javascript:alert(1)", "x");
  t.pushOpen("https://board.example/sales?open=nope", "x");
  assert.deepEqual(t.assigns, []);
});
test("4. 페이지 알림을 누르면: 경로 모드 깊은 주소에서도 ./sales 는 /sales 로(지금 경로 뒤에 안 붙음)", async () => {
  const server = pageServer(), t = tab({ server, href: "https://board.example/chat/primary/1", baseURI: "https://board.example/" });
  await startPage(t);
  server.add({ title: "영업 보드", body: "오늘 기한 2", url: "./sales", tag: "card:sales:1" });
  await t.poll();
  t.shown[0].onclick();
  assert.deepEqual(t.assigns, ["https://board.example/sales"]);
});
test("4. ./?open=card: 알림은 이동하지 않고 그 자리에서 엶(그대로)", async () => {
  const t = tab({ href: "https://board.example/chat/primary/1", baseURI: "https://board.example/" });
  t.pushOpen("https://board.example/?open=card:1793170372.000001", "card:1");
  await t.flush();
  assert.deepEqual(t.assigns, []);
});

// ---------- 5. 페이지 모드 회원 넓힘(화면) ----------
test("5. 구독 없는 기기만 쓰는 회원도 패널에 스위치가 보임 · 켜면 prefs 로 저장 · 진행 글 칸(푸시 묶음)은 안 보임", async () => {
  const t = tab({ member: { email: "a@example.com" }, prefs: { wide: false, progress: "digest" } });
  await startPage(t); t.pushPanel(); await t.flush();
  assert.ok(t.fetched.includes("api/push/prefs"), "지금 설정을 읽음");
  assert.match(t.panel().innerHTML, /결정·할 일·답도 받기/);
  assert.match(t.panel().innerHTML, /data-pw="1"/);
  await t.els.at(-1).on.click({ stopPropagation() {}, target: { closest: (s: string) => (s === "[data-pw]" ? { dataset: { pw: "1" } } : null) } }); await t.flush();
  assert.deepEqual(t.posts.at(-1), ["api/push/prefs", { wide: true }]);
  assert.match(t.panel().innerHTML, /aria-pressed="true">받기/);
  assert.doesNotMatch(t.panel().innerHTML, /그 밖의 진행 글/, "진행 글 묶음은 푸시 길이라 구독이 없으면 안 옴");
});
test("5. 구독 있는 회원은 그대로(진행 글 칸 포함) · 주인 · 안 켠 기기는 스위치 없음", async () => {
  const m = tab({ member: { email: "a@example.com" }, sub: { endpoint: "https://push.example/x" }, prefs: { wide: true, progress: "digest" } });
  m.pushPanel(); await m.flush(); await m.flush();
  assert.match(m.panel().innerHTML, /그 밖의 진행 글/);
  const owner = tab();
  await startPage(owner); owner.pushPanel(); await owner.flush();
  assert.doesNotMatch(owner.panel().innerHTML, /data-pw/);
  assert.ok(!owner.fetched.includes("api/push/prefs"), "주인은 설정을 안 읽음");
  const idle = tab({ member: { email: "a@example.com" } });
  idle.pushPanel(); await idle.flush();
  assert.doesNotMatch(idle.panel().innerHTML, /data-pw/);
  assert.ok(!idle.fetched.includes("api/push/prefs"));
});

// ---------- 5. 서버 ----------
const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const sqls: string[] = [];
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
  });
  return { db, sqls, D1: { prepare: (s: string) => { sqls.push(s); return stmt(s); }, batch: async (ss: any[]) => Promise.all(ss.map(s => s.all())) } as unknown as D1Database };
}
function fakeDO(D1: D1Database) {
  const s = new DatabaseSync(":memory:");
  const sql = { exec: (q: string, ...b: unknown[]) => { const st = s.prepare(q);
    if (/^\s*select/i.test(q)) { const rows = st.all(...(b as never[])); return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }; }
    const r = st.run(...(b as never[])); return { toArray: () => [], one: () => undefined, rowsWritten: Number(r.changes) }; } };
  return new (Pusher as any)({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} } }, { DB: D1 });
}
const A = "member@example.test", OWNER = "owner@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up";
const REPLY = { id: 7, tool: "inbox_log", kind: "reply", text: "고쳤어요", thread: null, win: "일 창" }, CALL = { id: 8, tool: "inbox_log", kind: "blocked", unblocks: "me", text: "로그인 필요", thread: null, win: "일 창" }, PROG = { id: 9, tool: "inbox_log", kind: "progress", text: "진행", thread: null, win: "일 창" };
const GATE_SQL = "SELECT 1 x FROM member_push_ep WHERE owner = ? LIMIT 1";

test("5. 스위치를 안 켠 구독 없는 회원: 글 한 줄 = 그 쿼리 한 번으로 끝(회원 칸 안 부름 · 기기 조회 없음) · 줄이 안 생김", async () => {
  const { D1, db, sqls } = d1();
  assert.equal(await linePushOpen(D1, A), false);
  assert.deepEqual(sqls, [GATE_SQL]);
  assert.equal((db.prepare("SELECT count(*) n FROM member_push_ep").get() as { n: number }).n, 0);
  await setWideRow(D1, A, false);
  assert.equal(await linePushOpen(D1, A), false, "끈 채 저장해도 그대로");
});

test("5. 스위치를 켠 페이지 모드 회원: 답 · 부름이 페이지 모음에 쌓임(구독 없어도) · 진행 글은 안 쌓임 · 끄면 문이 닫힘", async () => {
  const { D1 } = d1(), pu = fakeDO(D1);
  await pu.mSetPrefs(A, { wide: true }); await setWideRow(D1, A, true);
  assert.equal(await linePushOpen(D1, A), true);
  await routeLine(D1, A, REPLY, pu); await routeLine(D1, A, CALL, pu); await routeLine(D1, A, PROG, pu);
  assert.deepEqual((await pu.mPage(A, 0))[1].items.map((m: any) => m.title), ["답이 왔어요", "나를 불러요"]);
  await pu.mSetPrefs(A, { wide: false }); await setWideRow(D1, A, false);
  assert.equal(await linePushOpen(D1, A), false);
});

test("5. 스위치를 안 켠 회원의 칸: 급한 카드만 모음에 · 답 · 진행 글은 칸까지 와도 0", async () => {
  const { D1 } = d1(), pu = fakeDO(D1);
  await routeLine(D1, A, REPLY, pu); await routeLine(D1, A, PROG, pu);
  await routeCard(D1, A, { id: "1793170372.000001", question: "보통 결정", at: Date.now() }, pu);
  await routeCard(D1, A, { id: "1793170372.000002", question: "결제 장애", urgent: true, at: Date.now() }, pu);
  assert.deepEqual((await pu.mPage(A, 0))[1].items.map((m: any) => m.body), ["결제 장애"]);
});

test("5. 넓힘 표시 줄은 구독 줄을 건드리지 않고, 온보딩 「브라우저 N곳」에 안 셈", async () => {
  const { D1, db } = d1();
  await claimEndpoint(D1, A, "https://push.example/send/abc", async () => {});
  await setWideRow(D1, A, true);
  await setWideRow(D1, A, true);
  assert.equal((db.prepare("SELECT count(*) n FROM member_push_ep WHERE owner = ?").get(A) as { n: number }).n, 2);
  const push = () => onboarding(D1, A, { server: "https://board.example", push: true }).then((o: any) => o.steps.find((s: any) => s.key === "push"));
  assert.match((await push()).detail, /브라우저 1곳/);
  await setWideRow(D1, A, false);
  assert.equal(await linePushOpen(D1, A), true, "구독 줄이 있으면 문은 그대로 열림");
  db.prepare("DELETE FROM member_push_ep").run();
  await setWideRow(D1, A, true);
  assert.equal((await push()).done, false, "표시 줄만 있으면 온보딩은 안 켠 것");
});

// 진짜 index.ts 길: 세션 쿠키로 POST · GET /api/push/prefs
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email: string) {
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SESS))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
test("5. 라우트: POST prefs 가 넓힘 표시를 켜고 끔 · 켠 뒤 지워졌으면 GET prefs 가 되살림 · 잘못된 값은 안 건드림", async () => {
  const { D1, db } = d1(), T = Date.now();
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(A, OWNER, T);
  db.prepare("INSERT OR REPLACE INTO f7_flag(name, on_at) VALUES ('member_push', ?)").run(T);
  const pu = fakeDO(D1);
  const env: any = { DB: D1, PUSH: { idFromName: (n: string) => n, get: () => pu }, SNAP: { idFromName: (s: string) => s, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const call = async (method: string, body?: unknown) => app.fetch(new Request("https://example.test/api/push/prefs", { method, headers: { cookie: await cookie(A), "x-hb": "1", origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {}, passThroughOnException() {} } as any);
  const rows = () => db.prepare("SELECT owner FROM member_push_ep").all().map((r: any) => r.owner);
  assert.equal((await call("GET")).status, 200);
  assert.deepEqual(rows(), [], "안 켠 회원은 읽어도 줄 없음");
  assert.equal((await call("POST", { wide: true })).status, 200);
  assert.deepEqual(rows(), [A]);
  db.prepare("DELETE FROM member_push_ep").run();   // 이 고침 전에 켠 회원 · 구독을 끈 뒤의 칸
  assert.equal((await call("GET")).status, 200);
  assert.deepEqual(rows(), [A], "설정 읽기가 되살림");
  assert.equal((await call("POST", { progress: "off" })).status, 200);
  assert.deepEqual(rows(), [A], "진행 칸만 바꿔도 그대로");
  assert.equal((await call("POST", { wide: false })).status, 200);
  assert.deepEqual(rows(), []);
  assert.equal((await call("POST", { wide: "yes" })).status, 400);
  assert.deepEqual(rows(), [], "잘못된 값은 안 건드림");
});

// ---------- 낮음: 못 띄우는 브라우저 · 한 번에 여러 개 ----------
test("낮음. new Notification 이 던지는 브라우저: 번호는 올라가 되풀이 안 함 · 기록 한 번 · 패널에 못 띄움 알림 · 되면 알림 지움", async () => {
  const server = pageServer(); let bad = true, tries = 0;
  const t = tab({ server, throws: () => { tries++; return bad; } });
  await startPage(t);
  server.add(msg(1));
  await t.poll();
  assert.equal(tries, 1);
  const u = t.fetched.length;
  await t.poll(); await t.poll();
  assert.equal(tries, 1, "같은 알림을 다시 띄우지 않음");
  assert.ok(t.fetched.length > u && /after=1/.test(t.fetched.at(-1)!), "번호가 올라감");
  assert.deepEqual(t.reports, ["page-show"]);
  t.pushPanel();
  assert.match(t.panel().innerHTML, /알림을 띄우지 못했어요/);
  server.add(msg(2)); await t.poll();
  assert.deepEqual(t.reports, ["page-show"], "실패 기록은 한 번");
  bad = false;
  server.add(msg(3)); await t.poll();
  assert.deepEqual(t.shown.map(n => n.tag), ["card:3"]);
  t.panel().remove();
  t.pushPanel();
  assert.doesNotMatch(t.panel().innerHTML, /못했어요/);
});

test("낮음. 한 번에 여럿이면 「새 n개」 한 통(12장 → 1통) · 하나면 그대로 · 제목이 섞이면 보드", async () => {
  const server = pageServer(), t = tab({ server });
  await startPage(t);
  for (let i = 1; i <= 12; i++) server.add(msg(i));
  await t.poll();
  assert.equal(t.shown.length, 1);
  assert.deepEqual([t.shown[0].title, t.shown[0].body, t.shown[0].tag], ["내 차례", "새 12개 — 카드 12", `cards:${msg(12).tag}`]);
  server.add(msg(13)); await t.poll();
  assert.deepEqual([t.shown[1].title, t.shown[1].body, t.shown[1].tag], ["내 차례", "카드 13", "card:13"]);
  server.add({ title: "답이 왔어요", body: "고쳤어요", url: "./", tag: "log:1" }); server.add(msg(14)); await t.poll();
  assert.deepEqual([t.shown[2].title, t.shown[2].body], ["보드", "새 2개 — 카드 14"]);
  server.add(msg(15)); server.add(msg(16)); await t.poll();
  assert.notEqual(t.shown[3].tag, t.shown[0].tag, "다음 묶음이 같은 tag 면 앞 알림을 소리 없이 바꿔 끼움");
  assert.notEqual(t.shown[3].tag, t.shown[2].tag);
});
