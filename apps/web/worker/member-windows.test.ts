import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
const { WINDOWS_SQL, WINDOWS_SQL_OPEN, sinceOf, taskOf } = await import("./member-windows.ts");
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
const OWNER = "owner@example.test", A = "member-a@example.test", B = "member-b@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up";
const DEVA = "bxd_made-up-device-aaa-0123456789abcdef", DEVA2 = "bxd_made-up-device-aa2-0123456789abcdef", DEVB = "bxd_made-up-device-bbb-0123456789abcdef", DEVAW = "bxd_made-up-device-aw0-0123456789abcdef";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
const H = 3_600_000, KEYS = ["device", "device_id", "window", "name", "task", "state", "activity", "at", "last", "blocked", "status", "wait"].sort();

async function setup() {
  const { db, D1 } = d1(), T = Date.now();
  for (const m of [A, B]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)");
  dev.run("devA", A, "pc2", "", await sha(DEVA), T, T, "full");
  dev.run("devA2", A, "mini", "", await sha(DEVA2), T, T, "full");
  dev.run("devAW", A, "watch only", "", await sha(DEVAW), T, T, "watch");
  dev.run("devB", B, "b-laptop", "", await sha(DEVB), T, T, "full");
  const tok = db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, revoked_at, tools, owner, device_id) VALUES (?,?,?,?,?,?,'*',?,?)");
  let n = 0;
  const win = (owner: string, devId: string, pane: string, name: string, created: number, revoked: number | null = null) => tok.run(`h${n++}`, pane, name, `device:${devId}`, created, revoked, owner, devId);
  const logIns = db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)"), pend: unknown[][] = [];
  const log = { run: (...a: unknown[]) => { pend.push(a); } };
  const imp = db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, title, state, state_at, win, seen_at, gone_at) VALUES (?,?,?,'window',?,?,?,?,?,?)");
  win(A, "devA", "pc2:ew_aaa111", "#4321 · 보더 읽기 API", T - 5 * H);
  log.run(A, "#4321 · 보더 읽기 API", "progress", "색인 둘 더함", null, T - 3 * H);
  log.run(A, "#4321 · 보더 읽기 API", "blocked", "리뷰 기다림 — 기술장\n둘째 줄은 안 나감", null, T - 2 * H);
  log.run(A, "#4321 · 보더 읽기 API", "status", "쉼 · 깨움 23:30", null, T - H);
  log.run(A, "#4321 · 보더 읽기 API", "say", "Primary 답", "primary", T - 60_000);
  imp.run(A, "window:pc2:ew_aaa111", "devA", "#4321", "idle", T - H, "pc2:ew_aaa111", T - 30_000, null);
  win(A, "devA2", "mini:ew_bbb222", "운영 감시", T - 10 * H);
  log.run(A, "운영 감시", "progress", "#3720 열쇠 sk-ant-made-up-0123456789abcdefghij 로 시험", null, T - 4 * H);
  imp.run(A, "window:mini:ew_bbb222", "devA2", "운영 감시", "parked", T - 4 * H, "mini:ew_bbb222", T - 60_000, null);
  win(A, "devA", "pc2:ew_ccc333", "끝난 일 #6900", T - 20 * H, T - 6 * H);
  win(A, "devA", "pc2:ew_ccc333", "끝난 일 #6900", T - 30 * H, T - 20 * H);
  log.run(A, "끝난 일 #6900", "done", "머지됨", null, T - 7 * H);
  // A: 사흘 전에 조용해진 창(기본 하루 밖)
  win(A, "devA", "pc2:ew_ddd444", "옛 창", T - 80 * H);
  log.run(A, "옛 창", "progress", "옛 일", null, T - 72 * H);
  win(B, "devB", "b:ew_eee555", "#4321 B 의 창", T - H);
  log.run(B, "#4321 B 의 창", "blocked", "B 의 비밀 일", null, T - 30 * 60_000);
  for (const a of pend.sort((x, y) => Number(x[5]) - Number(y[5]))) logIns.run(...(a as never[]));
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (path: string, h: Record<string, string> = {}, method = "GET", body?: unknown) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  const human = async (email = A) => ({ cookie: await cookie(email) });
  const dev_ = (t: string) => ({ authorization: `Bearer ${t}` });
  return { db, call, human, dev: dev_, T };
}

test("회원 세션: 내 창만 · 정해진 칸만 · 막힘 · 상태 · 기다림 · 태스크 · 열림/쉼/닫힘", async () => {
  const s = await setup();
  const r = await s.call("/api/me/windows", await s.human());
  assert.equal(r.status, 200, r.text);
  const ws = r.j.windows as any[];
  assert.deepEqual(ws.map(w => w.window), ["pc2:ew_aaa111", "mini:ew_bbb222", "pc2:ew_ccc333"], "마지막 줄이 새 것 먼저 · 하루 안 줄이 없는 창 없음 · 같은 이름은 한 줄(가장 새 열쇠)");
  for (const w of ws) assert.deepEqual(Object.keys(w).sort(), KEYS, "정해진 칸만(폴더 · 손잡이 · 열쇠 없음)");
  assert.ok(!r.text.includes("B 의"), "남의 창 0");
  const [a, b, c] = ws;
  assert.equal(a.device, "pc2"); assert.equal(a.name, "#4321 · 보더 읽기 API"); assert.equal(a.task, "#4321"); assert.equal(a.state, "open"); assert.equal(a.activity, "idle");
  assert.deepEqual([a.last.kind, a.last.text], ["blocked", "리뷰 기다림 — 기술장"], "막힘이 last · 첫 줄만 · Primary 채팅 줄은 안 셈");
  assert.equal(a.blocked.text, "리뷰 기다림 — 기술장"); assert.equal(a.status, null, "막힘 동안 상태 줄은 비움"); assert.equal(a.wait, "리뷰 기다림 — 기술장");
  assert.equal(b.device, "mini"); assert.equal(b.state, "parked"); assert.equal(b.task, "#3720", "이름에 없으면 마지막 줄 글에서");
  assert.ok(!b.last.text.includes("sk-ant-made-up"), b.last.text); assert.match(b.last.text, /#3720 열쇠 .+ 로 시험/);
  assert.equal(c.state, "closed"); assert.equal(c.activity, null); assert.equal(c.task, "#6900"); assert.equal(c.last.kind, "done");
});

test("상태 줄이 가장 새 줄이면 status · 「깨움」이면 wait", async () => {
  const s = await setup();
  s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "#4321 · 보더 읽기 API", "progress", "리뷰 받음 · 고침", null, s.T - 50 * 60_000);
  s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "#4321 · 보더 읽기 API", "status", "쉼 · 깨움 23:30", null, s.T - 40 * 60_000);
  const a = (await s.call("/api/me/windows", await s.human())).j.windows[0];
  assert.equal(a.blocked, null); assert.deepEqual([a.last.kind, a.status.text, a.wait], ["status", "쉼 · 깨움 23:30", "쉼 · 깨움 23:30"]);
});

test("기기 열쇠(scope full)로도 같은 답 · 다른 회원 기기는 자기 창만", async () => {
  const s = await setup();
  const h = await s.call("/api/me/windows", await s.human()), d = await s.call("/api/device/windows", s.dev(DEVA2));
  assert.equal(d.status, 200, d.text); assert.deepEqual(d.j.windows, h.j.windows, "기기마다가 아니라 그 회원 보드 전체");
  const b = await s.call("/api/device/windows", s.dev(DEVB));
  assert.deepEqual(b.j.windows.map((w: any) => w.window), ["b:ew_eee555"]);
  const bh = await s.call("/api/me/windows?owner=" + encodeURIComponent(A), await s.human(B));
  assert.deepEqual(bh.j.windows.map((w: any) => w.window), ["b:ew_eee555"], "질의 값으로 남의 보드를 못 고름");
});

test("막는 길: 창 열쇠(쓰기) 403 · 주인은 canon 제 창만 · 로그인 없음 · 감시 기기 · 끊은 기기 · 모르는 열쇠 401", async () => {
  const s = await setup();
  const w = await s.call("/api/device/window", s.dev(DEVA), "POST", { key: "pc2:ew_fff666", name: "새 창" });
  assert.equal(w.status, 200, w.text); const bxa = w.j.token as string; assert.match(bxa, /^bxa_/);
  for (const p of ["/api/me/windows", "/api/device/windows"]) {
    assert.equal((await s.call(p, s.dev(bxa))).status, 403, `${p} 창 열쇠`);
    assert.equal((await s.call(p, { ...(await s.human()), ...s.dev(bxa) })).status, 403, `${p} 세션 + 창 열쇠`);
    assert.equal((await s.call(p)).status, 401, `${p} 아무것도 없음`);
    assert.equal((await s.call(p, s.dev("bxd_made-up-unknown-device-0123456789ab"))).status, 401, `${p} 모르는 기기 열쇠`);
  }
  assert.equal((await s.call("/api/me/windows", s.dev(DEVA))).status, 401, "사람 길에 기기 열쇠 머리 — 세션만");
  const ow = await s.call("/api/me/windows", await s.human(OWNER));
  assert.equal(ow.status, 200, "주인도 회원 길(canon, owner_unified 늘 켬)"); assert.ok(!(ow.j.windows as any[]).some(x => x.device === "pc2"), "회원 창은 안 보임");
  assert.equal((await s.call("/api/device/windows", s.dev(DEVAW))).status, 401, "감시 기기");
  s.db.prepare("UPDATE device SET revoked_at = ? WHERE id = 'devA'").run(Date.now());
  assert.equal((await s.call("/api/device/windows", s.dev(DEVA))).status, 401, "끊은 기기");
  const after = (await s.call("/api/me/windows", await s.human())).j.windows as any[];
  assert.ok(after.filter(x => x.device === "pc2").every(x => x.state === "closed"), "끊은 기기의 창은 닫힘");
});

test("거르기: since · task · 빈 결과 · 틀린 값 400", async () => {
  const s = await setup(), hh = await s.human();
  const q = async (qs: string) => s.call("/api/me/windows?" + qs, hh);
  assert.deepEqual((await q("since=" + (s.T - 4 * 24 * H))).j.windows.map((w: any) => w.window).slice(-1), ["pc2:ew_ddd444"], "since 를 넓히면 옛 창도");
  assert.deepEqual((await q("since=" + new Date(s.T - 90 * 60_000).toISOString())).j.windows.map((w: any) => w.window), ["pc2:ew_aaa111"], "ISO · 90분 안 장부 줄이 있는 창만");
  assert.deepEqual((await q("task=%234321")).j.windows.map((w: any) => w.window), ["pc2:ew_aaa111"]);
  assert.deepEqual((await q("task=4321")).j.windows.map((w: any) => w.window), ["pc2:ew_aaa111"], "# 없이도");
  assert.deepEqual((await q("task=%2304321")).j.windows.map((w: any) => w.window), ["pc2:ew_aaa111"], "앞 0 은 같은 번호");
  const none = await q("task=1"); assert.equal(none.status, 200); assert.deepEqual([none.j.windows, none.j.next], [[], null], "빈 결과");
  for (const bad of ["task=abc", "task=%23", "since=어제", "since=12", "limit=0", "limit=501", "limit=x", "cursor=!!", "cursor=abc", "closed=아마", "closed=2"]) assert.equal((await q(bad)).status, 400, bad);
  const empty = await s.call("/api/me/windows", await s.human(B));
  s.db.prepare("DELETE FROM agent_token WHERE owner = ?").run(B);
  assert.deepEqual((await s.call("/api/me/windows", await s.human(B))).j.windows, [], "창이 하나도 없는 회원");
  assert.equal(empty.status, 200);
});

test("페이지: limit · next 를 따라가면 빠짐 · 겹침 없이 끝까지", async () => {
  const s = await setup(), hh = await s.human();
  const ins = s.db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, tools, owner, device_id) VALUES (?,?,?,'device:devA',?,'*',?,'devA')");
  const ln = s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,'progress','일',NULL,?)");
  for (let i = 0; i < 7; i++) { ins.run(`p${i}`, `pc2:ew_page${i}`, `창 ${i}`, s.T - 9000, A); ln.run(A, `창 ${i}`, s.T - 1000 * (i % 3)); }   // 같은 시각 줄끼리도 차례가 정해짐(줄 id 순)
  const all = (await s.call("/api/me/windows?limit=500", hh)).j.windows.map((w: any) => w.window);
  const got: string[] = []; let next: string | null = "", pages = 0;
  while (next !== null) { const r = await s.call(`/api/me/windows?limit=3${next ? "&cursor=" + next : ""}`, hh); assert.equal(r.status, 200, r.text); got.push(...r.j.windows.map((w: any) => w.window)); next = r.j.next; pages++; }
  assert.deepEqual(got, all); assert.equal(all.length, 10); assert.equal(pages, 4);
});

test("끊긴 열쇠 · 닫힌 지 오래된 창은 SQL 에서 먼저 뺌 · 30일 조회는 닫힌 창 기본 제외(closed=1 로 포함)", async () => {
  const s = await setup(), hh = await s.human();
  s.db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, revoked_at, tools, owner, device_id) VALUES (?,?,?,'device:devA',?,?,'*',?,'devA')")
    .run("old999", "pc2:ew_old999", "옛 닫힌 창", s.T - 10 * 24 * H, s.T - 3 * 24 * H, A);
  s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,'progress','남은 줄',NULL,?)").run(A, "옛 닫힌 창", s.T - 2 * H);
  const day = (await s.call("/api/me/windows", hh)).j;
  assert.ok(!day.windows.some((w: any) => w.name === "옛 닫힌 창"), "닫힌 지 since 보다 오래된 창은 장부 줄이 있어도 안 읽음");
  assert.ok(day.windows.some((w: any) => w.window === "pc2:ew_ccc333"), "since 안에 끊긴 창은 그대로(결과 그대로)");
  assert.equal(day.closed, true, "짧은 창은 닫힌 창을 보여 줌");
  const w30 = await s.call("/api/me/windows?since=" + (s.T - 40 * 24 * H), hh);
  assert.equal(w30.status, 200, w30.text);
  assert.deepEqual(w30.j.windows.map((w: any) => w.window), ["pc2:ew_aaa111", "mini:ew_bbb222", "pc2:ew_ddd444"], "30일 기본: 끊긴 열쇠(닫힌 창) 뺌 · 산 창만");
  assert.equal(w30.j.closed, false);
  const c30 = await s.call("/api/me/windows?since=" + (s.T - 40 * 24 * H) + "&closed=1", hh);
  assert.deepEqual(c30.j.windows.map((w: any) => w.window), ["pc2:ew_old999", "pc2:ew_aaa111", "mini:ew_bbb222", "pc2:ew_ccc333", "pc2:ew_ddd444"], "closed=1 이면 30일 안에 끊긴 창도(사흘 전 끊긴 창 포함)");
  assert.equal(c30.j.closed, true);
});

test("오래전 끊긴 열쇠가 많아도 since 뒤 끊긴 열쇠 하나면 닫힘으로 보임 · 30일 기본은 뺌 · 산 열쇠가 있으면 열림", async () => {
  const s = await setup(), hh = await s.human();
  const tk = s.db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, revoked_at, tools, owner, device_id) VALUES (?,?,?,'device:devA',?,?,'*',?,'devA')");
  const ln = s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,'progress','일',NULL,?)");
  for (let i = 0; i < 40; i++) tk.run(`dead${i}`, `pc2:shell:${50000 + i}`, "많이 끊긴 창", s.T - 9 * 24 * H, s.T - 8 * 24 * H + i, A);
  tk.run("late1", "pc2:shell:59999", "많이 끊긴 창", s.T - 5 * H, s.T - 2 * H, A);   // since(하루) 뒤에 끊김
  ln.run(A, "많이 끊긴 창", s.T - 3 * H);
  for (let i = 0; i < 40; i++) tk.run(`gone${i}`, `pc2:shell:${60000 + i}`, "산 열쇠 하나", s.T - 9 * 24 * H, s.T - 8 * 24 * H + i, A);
  tk.run("live1", "pc2:shell:69999", "산 열쇠 하나", s.T - 9 * 24 * H, null, A);
  ln.run(A, "산 열쇠 하나", s.T - 4 * H);
  const day = (await s.call("/api/me/windows", hh)).j.windows as any[];
  assert.equal(day.find(w => w.name === "많이 끊긴 창")?.state, "closed", "since 뒤 끊긴 열쇠 → 닫힘으로 보임");
  assert.equal(day.find(w => w.name === "산 열쇠 하나")?.state, "open", "산 열쇠가 있으면 열림");
  const w30 = (await s.call("/api/me/windows?since=" + (s.T - 40 * 24 * H), hh)).j.windows as any[];
  assert.ok(!w30.some(w => w.name === "많이 끊긴 창"), "30일 기본은 끊긴 창을 뺌");
  assert.equal(w30.find(w => w.name === "산 열쇠 하나")?.state, "open");
});

test("같은 이름 창도 엔진 창 id(board_log.wid)로 갈라 마지막 줄이 안 섞임 · id 없는 셸 창은 이름 하나(남는 한계)", async () => {
  const s = await setup(), hh = await s.human();
  const tk = s.db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, revoked_at, tools, owner, device_id) VALUES (?,?,?,'device:x',?,NULL,'*',?,?)");
  const lg = s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,'progress',?,NULL,?,?)");
  tk.run("z1", "pc2:ew_zzz111", "기술장", s.T - 3 * H, A, "devA");
  tk.run("z2", "mini:ew_zzz222", "기술장", s.T - 3 * H, A, "devA2");
  lg.run(A, "기술장", "첫째 창 일", s.T - 2 * H, "ew_zzz111");
  lg.run(A, "기술장", "둘째 창 일", s.T - H, "ew_zzz222");
  tk.run("s1", "pc2:shell:7001", "터미널 · 공용", s.T - 2 * H, A, "devA");
  tk.run("s2", "pc2:shell:7002", "터미널 · 공용", s.T - H, A, "devA2");
  const lg0 = s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,'progress',?,NULL,?)");
  lg0.run(A, "터미널 · 공용", "첫째 셸 일", s.T - 30 * 60_000);
  lg0.run(A, "터미널 · 공용", "둘째 셸 일", s.T - 20 * 60_000);
  const ws = (await s.call("/api/me/windows?limit=500", hh)).j.windows as any[];
  const role = ws.filter(w => w.name === "기술장");
  assert.deepEqual(role.map(w => w.window), ["mini:ew_zzz222", "pc2:ew_zzz111"], "같은 이름이지만 창 id 로 갈라 둘");
  assert.deepEqual(role.map(w => w.last.text), ["둘째 창 일", "첫째 창 일"], "마지막 줄이 서로 안 섞임");
  assert.deepEqual(role.map(w => w.device), ["mini", "pc2"]);
  const shell = ws.filter(w => w.name === "터미널 · 공용");
  assert.equal(shell.length, 1, "id 없는 셸 창은 이름 하나로 묶임(남는 한계 — 결과 파일 「위험」)");
  assert.equal(shell[0].last.text, "둘째 셸 일", "가장 새 줄");
});

test("셸 → 엔진 옮긴 창은 한 줄 · wid 없는 막힘 줄은 그 이름의 가장 최근 wid 창에 붙음", async () => {
  const s = await setup(), hh = await s.human();
  const tk = s.db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, revoked_at, tools, owner, device_id) VALUES (?,?,?,'device:x',?,NULL,'*',?,?)");
  const lg = s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,NULL,?,?)");
  tk.run("m0", "pc2:shell:8001", "옮긴 창", s.T - 4 * H, A, "devA");
  tk.run("m1", "pc2:ew_mmm111", "옮긴 창", s.T - 30 * 60_000, A, "devA");   // 가장 새 열쇠 = 엔진
  lg.run(A, "옮긴 창", "progress", "셸에서 하던 일", s.T - 3 * H, null);
  lg.run(A, "옮긴 창", "progress", "엔진에서 이어서", s.T - 2 * H, "ew_mmm111");
  lg.run(A, "옮긴 창", "blocked", "물어볼 것 기다림", s.T - H, null);
  tk.run("p1", "pc2:ew_p111", "배포 창", s.T - 5 * H, A, "devA");
  tk.run("p2", "mini:ew_p222", "배포 창", s.T - 5 * H, A, "devA2");
  lg.run(A, "배포 창", "progress", "첫째 일", s.T - 3 * H, "ew_p111");
  lg.run(A, "배포 창", "progress", "둘째 일", s.T - 2 * H, "ew_p222");
  lg.run(A, "배포 창", "blocked", "둘째가 막힘", s.T - 20 * 60_000, null);
  const ws = (await s.call("/api/me/windows?limit=500", hh)).j.windows as any[];

  const moved = ws.filter(w => w.name === "옮긴 창");
  assert.equal(moved.length, 1, "창 id 가 하나뿐(셸 줄 + 엔진 줄)이면 한 줄 — 두 줄로 갈라지지 않음");
  assert.equal(moved[0].window, "pc2:ew_mmm111", "열쇠는 가장 새 것(엔진 창)");
  assert.equal(moved[0].last.kind, "blocked", "wid 없는 막힘 줄이 그 창의 마지막 줄");
  assert.equal(moved[0].wait, "물어볼 것 기다림", "막힘 상태도 그 창에 붙음");

  const dep = ws.filter(w => w.name === "배포 창");
  assert.deepEqual(dep.map(w => w.window), ["mini:ew_p222", "pc2:ew_p111"], "창 id 가 둘 이상일 때만 가름");
  assert.deepEqual(dep.map(w => w.last.kind), ["blocked", "progress"], "wid 없는 막힘 줄은 가장 최근 wid 창(둘째)에 붙음");
  assert.equal(dep[0].wait, "둘째가 막힘");
  assert.equal(dep[1].last.text, "첫째 일", "첫째 창 마지막 줄은 그대로");
});

test("since 풀기 · 태스크 뽑기", () => {
  const now = Date.UTC(2026, 10, 5, 13);
  assert.equal(sinceOf(undefined, now), now - 86_400_000);
  assert.equal(sinceOf(String(Math.floor((now - 1000) / 1000)), now), now - 1000, "초");
  assert.equal(sinceOf(String(now - 5), now), now - 5, "밀리초");
  assert.equal(sinceOf(String(now - 90 * 86_400_000), now), now - 30 * 86_400_000, "30일 앞은 30일로");
  assert.equal(sinceOf(String(now + 9e6), now), now, "미래는 지금");
  assert.equal(sinceOf("abc", now), null);
  assert.equal(taskOf("작업자 · #4321 · 읽기"), "#4321"); assert.equal(taskOf("운영 감시", "#3720 뭔가"), "#3720"); assert.equal(taskOf("x", "#12345678"), null); assert.equal(taskOf("x"), null);
});

test("열쇠만 있고 줄 없는 창은 안 읽음 · 같은 이름 열쇠 51개는 한 줄(가장 새 열쇠) · 열흘 전 열쇠는 새 줄로 되살아나지 않음", async () => {
  const s = await setup(), hh = await s.human();
  const ins = s.db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, tools, owner, device_id) VALUES (?,?,?,'device:devA',?,'*',?,'devA')");
  for (let i = 0; i < 3000; i++) ins.run(`sh${i}`, `pc2:shell:${10000 + i}`, `셸 ${i}`, s.T - (i % 600) * 60_000, A);   // 한 번짜리 셸 열쇠(줄 없음) — 운영 하루 3천여 개 꼴
  for (let i = 0; i < 50; i++) ins.run(`old${i}`, `pc2:claude:${20000 + i}`, "터미널 · proj", s.T - 10 * 24 * H + i, A);   // 열흘 전 같은 이름 열쇠 50
  ins.run("new1", "pc2:claude:29999", "터미널 · proj", s.T - 5 * 60_000, A);
  s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,'progress','지금 일',NULL,?)").run(A, "터미널 · proj", s.T - 60_000);
  const ws = (await s.call("/api/me/windows?limit=500", hh)).j.windows as any[];
  assert.deepEqual(ws.map(w => w.window), ["pc2:claude:29999", "pc2:ew_aaa111", "mini:ew_bbb222", "pc2:ew_ccc333"], "셸 열쇠 3천 · 옛 같은 이름 50 은 안 나옴");
  assert.equal(ws[0].state, "open");
});

test("운영 규모(열쇠 1.5만 · 장부 2.5만, ANALYZE 뒤)에서도 색인만: 출발점은 since 뒤 줄 범위 · 열쇠 표 · 장부 통째 훑기 없음", async () => {
  const s = await setup();
  const tk = s.db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, tools, owner, device_id) VALUES (?,?,?,'device:devA',?,'*',?,'devA')");
  const lg = s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,NULL,?)");
  s.db.exec("BEGIN");
  for (let i = 0; i < 15000; i++) tk.run(`big${i}`, `pc2:shell:${40000 + i}`, `창 ${i % 900}`, s.T - 20 * 24 * H + i * 60_000, A);
  for (let i = 0; i < 25000; i++) lg.run(A, `창 ${i % 900}`, i % 7 ? "progress" : "status", "옛 일", s.T - 8 * 24 * H + i * 25_000);   // 8일 치 · 마지막 하루 안에 약 3천 줄
  s.db.exec("COMMIT"); s.db.exec("ANALYZE");
  const plan = (s.db.prepare("EXPLAIN QUERY PLAN " + WINDOWS_SQL).all(A, s.T - 86_400_000, Number.MAX_SAFE_INTEGER, 101, s.T - 86_400_000) as { detail: string }[]).map(p => p.detail);
  assert.ok(plan.some(p => /SEARCH b USING (COVERING )?INDEX board_log_owner \(owner=\? AND at>\?\)/.test(p)), "출발점 = since 뒤 줄 범위\n" + plan.join("\n"));
  assert.ok(plan.some(p => /agent_token_owner_win/.test(p)), plan.join("\n"));
  assert.ok(plan.some(p => /agent_token_owner_win_rev/.test(p)), "끊긴 열쇠 거르기는 색인 안에서(표 안 봄)\n" + plan.join("\n"));
  assert.ok(plan.some(p => /board_log_owner_win/.test(p)), plan.join("\n"));
  for (const p of plan) assert.ok(!/^SCAN (agent_token|board_log|b|t|imp_item|i|device|d|l|r)\b/.test(p), `통째 훑기: ${p}\n${plan.join("\n")}`);
  // 30일 기본(산 열쇠만)은 OR 없이 revoked_at IS NULL 하나라 색인에서 그 창의 산 열쇠를 바로 찾음(seek) — 창마다 열쇠 16개를 훑지 않음
  const open = (s.db.prepare("EXPLAIN QUERY PLAN " + WINDOWS_SQL_OPEN).all(A, s.T - 30 * 24 * H, Number.MAX_SAFE_INTEGER, 101) as { detail: string }[]).map(p => p.detail);
  assert.ok(open.some(p => /agent_token_owner_win_rev \(owner=\? AND win=\? AND revoked_at=\?\)/.test(p)), "산 열쇠만 거를 때는 revoked_at=? seek\n" + open.join("\n"));
  assert.ok(plan.some(p => /agent_token_owner_win_rev \(owner=\? AND win=\? AND revoked_at=\?\)/.test(p)), "산 열쇠 seek\n" + plan.join("\n"));
  assert.ok(plan.some(p => /agent_token_owner_win_rev \(owner=\? AND win=\? AND revoked_at>\?\)/.test(p)), "since 뒤 끊긴 열쇠 seek\n" + plan.join("\n"));
  assert.ok(!plan.some(p => /SEARCH t EXISTS USING .*agent_token_owner_win_rev \(owner=\? AND win=\?\)$/.test(p)), "OR 로 그 이름 열쇠 전부 훑기\n" + plan.join("\n"));
  const r = await s.call("/api/me/windows", await s.human());
  assert.equal(r.status, 200); assert.equal(r.j.windows.length, 100); assert.ok(r.j.next, "쪽이 더 있음");
  assert.ok(r.j.windows.every((w: any) => w.at >= s.T - 86_400_000), "하루 안 움직인 창만");
});

test("D1 질의는 색인만: 열쇠 표 · 장부를 통째로 훑지 않음(EXPLAIN QUERY PLAN)", async () => {
  const s = await setup();
  const plan = (s.db.prepare("EXPLAIN QUERY PLAN " + WINDOWS_SQL).all(A, Date.now() - 86_400_000, Number.MAX_SAFE_INTEGER, 101, Date.now() - 86_400_000) as { detail: string }[]).map(p => p.detail);
  assert.ok(plan.some(p => /agent_token_owner_win/.test(p)), plan.join("\n"));
  assert.ok(plan.some(p => /b USING (COVERING )?INDEX board_log_owner_win/.test(p)), plan.join("\n"));
  for (const p of plan) assert.ok(!/^SCAN (agent_token|board_log|b|t|imp_item|i|device|d|l|r)\b/.test(p), `통째 훑기: ${p}\n${plan.join("\n")}`);
});
