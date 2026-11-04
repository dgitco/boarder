import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
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
const OWNER = "owner@example.test", MEMBER = "member@example.test", OTHER = "other@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up";
const DEV1 = "bxd_made-up-device-one-0123456789abcdef", DEV2 = "bxd_made-up-device-two-0123456789abcdef", DEVMW = "bxd_made-up-member-watch-0123456789abcd", DEVW = "bxd_made-up-owner-watch-0123456789abcde";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}


async function setup() {
  const { db, D1 } = d1(), T = Date.now();
  for (const m of [MEMBER, OTHER]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)");
  dev.run("dev1", MEMBER, "laptop", "", await sha(DEV1), T, T, "full");
  dev.run("dev2", MEMBER, "desktop", "", await sha(DEV2), T, T, "full");
  dev.run("devMW", MEMBER, "member watch", "", await sha(DEVMW), T, T, "watch");
  dev.run("devW", OWNER, "owner mac", "", await sha(DEVW), T, T, "watch");
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  const human = async (email = MEMBER) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  const dev_ = (t: string) => ({ authorization: `Bearer ${t}` });
  const set = (key: string, value: unknown, t = DEV1) => call("POST", "/api/device/settings", { key, value }, dev_(t));
  const get = (t = DEV1) => call("GET", "/api/device/settings", undefined, dev_(t));
  const node = () => db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(MEMBER) as any;
  /** 보드에서 사람이 허락(카드 「허용」) — 기기 하나 */
  const grant = async (t = DEV1) => { const r = await call("POST", "/api/device/settings/allow", {}, dev_(t)); assert.equal(r.status, 200, r.text); assert.equal((await call("POST", `/api/me/cards/${r.j.card_id}/answer`, { choice: "허용" }, await human())).status, 200); return r.j.card_id; };
  return { db, call, human, dev: dev_, set, get, node, grant, env, ctx };
}

test("허락 없는 기기: 바꾸기는 403 not_allowed · 값은 그대로 · 읽기는 됨(allowed false)", async () => {
  const s = await setup();
  const r = await s.set("task_channels", true);
  assert.equal(r.status, 403, r.text); assert.equal(r.j.error, "not_allowed"); assert.match(r.j.hint, /boarder settings allow/);
  assert.equal(s.node(), undefined, "node_setting 에 아무것도 안 씀");
  const g = await s.get();
  assert.equal(g.status, 200); assert.equal(g.j.allowed, false); assert.equal(g.j.values.task_channels, false);
  for (const k of ["pins", "task_channels", "task_repo", "front_door", "primary_window", "bot_name"]) assert.ok(k in g.j.values, k);
});

test("허락 길: 카드 「허용」 뒤에만 바꿀 수 있음 · 답은 전 값(before) · 보드 기록에 전 값", async () => {
  const s = await setup();
  const a = await s.call("POST", "/api/device/settings/allow", {}, s.dev(DEV1));
  assert.equal(a.status, 200); assert.equal(a.j.pending, true);
  const card = s.db.prepare("SELECT owner, question, choices FROM board_card WHERE id = ?").get(a.j.card_id) as any;
  assert.equal(card.owner, MEMBER); assert.match(card.question, /기기 「laptop」 이 CLI 로 내 보드 설정/); assert.deepEqual(JSON.parse(card.choices), ["허용", "거절"]);
  assert.equal((await s.call("POST", "/api/device/settings/allow", {}, s.dev(DEV1))).j.card_id, a.j.card_id, "같은 기기는 카드 하나");
  assert.equal((await s.set("task_channels", true)).status, 403, "답 전에는 못 씀");
  assert.equal((await s.call("POST", `/api/me/cards/${a.j.card_id}/answer`, { choice: "허용" }, await s.human())).status, 200);
  assert.equal((s.db.prepare("SELECT state FROM board_card WHERE id = ?").get(a.j.card_id) as any).state, "closed");
  assert.equal((await s.call("GET", "/api/device/settings/allow", undefined, s.dev(DEV1))).j.allowed, true);
  const r = await s.set("task_channels", true);
  assert.equal(r.status, 200, r.text); assert.deepEqual([r.j.before, r.j.after], [false, true]);
  const r2 = await s.set("task_channels", false);
  assert.deepEqual([r2.j.before, r2.j.after], [true, false], "되돌리기: 전 값으로 다시");
  const logs = (s.db.prepare("SELECT text FROM board_log WHERE owner = ? AND win = '보더'").all(MEMBER) as any[]).map(x => x.text);
  assert.ok(logs.some(t => /기기 「laptop」 이 CLI 로 채널 = 태스크 을 바꿨어요 — 전: 끔 → 후: 켬/.test(t)), logs.join("\n"));
});

test("카드 답은 사람 세션만: 기기 토큰 머리 · 남의 회원 · 거절 · 10분 지남 · 끊긴 기기는 허락 안 됨", async () => {
  const s = await setup();
  const a = await s.call("POST", "/api/device/settings/allow", {}, s.dev(DEV1));
  for (const h of [s.dev(DEV1), { "x-boarder-device": DEV1 }]) assert.equal((await s.call("POST", `/api/me/cards/${a.j.card_id}/answer`, { choice: "허용" }, { ...(await s.human()), ...h })).status, 401);
  assert.equal((await s.call("POST", `/api/me/cards/${a.j.card_id}/answer`, { choice: "허용" }, await s.human(OTHER))).status, 404);
  assert.equal((await s.call("POST", `/api/me/cards/${a.j.card_id}/answer`, { choice: "거절" }, await s.human())).status, 200);
  assert.equal((await s.set("task_channels", true)).status, 403, "거절 뒤");
  s.db.prepare("UPDATE device_card_event SET at = at - ?").run(24 * 3600_000 + 1000);   // 거절 뒤 잠금이 지난 뒤에 이어 봄
  // 10분 지난 요청
  const b = await s.call("POST", "/api/device/settings/allow", {}, s.dev(DEV1));
  s.db.prepare("UPDATE user_pref SET at = at - 11 * 60000 WHERE k = ?").run("cli_settings_req:" + b.j.card_id);
  await s.call("POST", `/api/me/cards/${b.j.card_id}/answer`, { choice: "허용" }, await s.human());
  assert.equal((await s.set("task_channels", true)).status, 403, "만료 뒤");
  // 답 전에 기기가 끊김
  const c = await s.call("POST", "/api/device/settings/allow", {}, s.dev(DEV2));
  s.db.prepare("UPDATE device SET revoked_at = ? WHERE id = 'dev2'").run(Date.now());
  await s.call("POST", `/api/me/cards/${c.j.card_id}/answer`, { choice: "허용" }, await s.human());
  assert.equal(s.db.prepare("SELECT count(*) n FROM user_pref WHERE k LIKE 'cli_settings:%'").get().n, 0);
});

test("허락은 기기마다: 다른 기기는 403 · 끊으면 401 · 허락 거두기(DELETE) 뒤 403 · 감시 기기 · 주인 기기는 401", async () => {
  const s = await setup();
  await s.grant(DEV1);
  assert.equal((await s.set("task_repo", "example-org/app")).status, 200);
  assert.equal((await s.set("task_repo", "example-org/x", DEV2)).status, 403, "다른 기기는 따로 허락");
  for (const t of [DEVMW, DEVW]) { assert.equal((await s.set("task_repo", "a/b", t)).status, 401); assert.equal((await s.get(t)).status, 401); assert.equal((await s.call("POST", "/api/device/settings/allow", {}, s.dev(t))).status, 401); }
  assert.equal((await s.call("DELETE", "/api/device/settings/allow", undefined, s.dev(DEV1))).j.was, true);
  assert.equal((await s.set("task_repo", "example-org/y")).status, 403, "거둔 뒤");
  await s.grant(DEV1);
  s.db.prepare("UPDATE device SET revoked_at = ? WHERE id = 'dev1'").run(Date.now());
  assert.equal((await s.set("task_repo", "example-org/y")).status, 401, "끊은 기기");
});

test("역할 자리표 쓰기(/api/device/roles) · 옛 고정 캔버스 길(/api/device/pins)도 허락 뒤만 — 읽기는 그대로", async () => {
  const s = await setup();
  const roles = { roles: [{ name: "비서실장", win: "host1:ew_chief1", primary: true }] };
  assert.equal((await s.call("POST", "/api/device/roles", roles, s.dev(DEV1))).status, 403);
  assert.equal((await s.call("GET", "/api/device/roles", undefined, s.dev(DEV1))).status, 200);
  await s.grant(DEV1);
  assert.equal((await s.call("POST", "/api/device/roles", roles, s.dev(DEV1))).status, 200);
  assert.equal((await s.call("POST", "/api/device/pins", { pins: [{ id: "zzzz9999", title: "x" }] }, s.dev(DEV2))).status, 403);
  assert.equal((await s.call("POST", "/api/device/pins", { pins: [{ id: "zzzz9999", title: "x" }] }, s.dev(DEV1))).status, 200);
});

test("칸마다 값 검사 · 전 값: 고정 캔버스(주소 → id) · 업무 저장소 · 기본 창 · 메인 봇 이름 · 앞단 접기 — 틀리면 아무것도 안 바꿈", async () => {
  const s = await setup(), T = Date.now();
  await s.grant(DEV1);
  let r = await s.set("pins", ["https://example.test/art/AbCdEf123456/", "zzzz9999"]);
  assert.equal(r.status, 200, r.text); assert.deepEqual(r.j.before, []); assert.deepEqual(r.j.after.map((p: any) => p.id), ["AbCdEf123456", "zzzz9999"]);
  assert.equal((await s.set("pins", Array.from({ length: 13 }, (_, i) => "pin" + (1000 + i)))).status, 400);
  assert.deepEqual((await s.get()).j.values.pins.map((p: any) => p.id), ["AbCdEf123456", "zzzz9999"], "틀린 값은 안 씀");
  r = await s.set("pins", []); assert.equal(r.j.before.length, 2); assert.deepEqual(r.j.after, []);
  // 업무 저장소: github 주소 정리 · 틀린 꼴 400 · 빈 값 = 지움
  r = await s.set("task_repo", "https://github.com/Example-Org/App.git"); assert.equal(r.j.after, "example-org/app");
  assert.equal((await s.set("task_repo", "not a repo")).status, 400);
  r = await s.set("task_repo", ""); assert.deepEqual([r.j.before, r.j.after], ["example-org/app", ""]);
  // 기본 창: 내 산 창이 아니면 404 · null 은 메인 봇으로
  assert.equal((await s.set("primary_window", "ew_notmine")).status, 404);
  r = await s.set("primary_window", null); assert.deepEqual([r.status, r.j.after], [200, null]);
  // 메인 봇 이름: 봇이 없으면 409 · 이름만 바뀌고 모양 · 그림은 그대로 · 21자 400
  assert.equal((await s.set("bot_name", "비서")).status, 409);
  s.db.prepare("INSERT INTO member_bot(owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(MEMBER, "s1", 120, "보더", "", "a".repeat(32), "b".repeat(32), T);
  r = await s.set("bot_name", "비서실장"); assert.deepEqual([r.j.before, r.j.after], ["보더", "비서실장"]);
  assert.deepEqual({ ...(s.db.prepare("SELECT seed, hue, icon FROM member_bot WHERE owner = ?").get(MEMBER) as any) }, { seed: "s1", hue: 120, icon: "a".repeat(32) });
  assert.equal((await s.set("bot_name", "가".repeat(21))).status, 400);
  for (const [id, nm] of [["n_old1", "옛 팀장"], ["n_old2", "옛 비서"]]) s.db.prepare("INSERT INTO mnode(owner, id, name, pinned_name, area, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(MEMBER, id, nm, nm, "", "idle", "", "{}", T, T);
  r = await s.set("front_door", { name: "비서실장", fold: ["옛 팀장", "없는 칸"] });
  assert.equal(r.status, 404); assert.deepEqual(r.j.missing, ["없는 칸"]); assert.equal((await s.get()).j.values.front_door, null);
  r = await s.set("front_door", { name: "비서실장", fold: ["옛 팀장", "옛 비서"] });
  assert.equal(r.status, 200, r.text); assert.equal(r.j.before, null); assert.equal(r.j.after.name, "비서실장"); assert.deepEqual(r.j.after.pairs.map((p: any) => p.name).sort(), ["옛 비서", "옛 팀장"]);
  assert.ok(r.j.after.pairs.every((p: any) => /^%\d+$/.test(p.pane)));
  r = await s.set("front_door", null); assert.equal(r.j.before.name, "비서실장"); assert.equal(r.j.after, null);
  // 모르는 칸 · value 없음
  assert.equal((await s.set("theme", "dark")).status, 400);
  assert.equal((await s.call("POST", "/api/device/settings", { key: "task_channels" }, s.dev(DEV1))).status, 400);
});

test("새 칸: 노드 수치 · 단위 · prefs · 사이드 숨김 · 모양 · 기능 · 세션 싱크 — 허락 뒤만 · 전 값 · 틀리면 400 · 화면 길과 같은 자리", async () => {
  const s = await setup();
  const g0 = await s.get();
  for (const k of ["node_values", "unit", "prefs", "side_hide", "ui", "features", "session_sync"]) assert.ok(k in g0.j.values, k);
  assert.equal((await s.set("node_values", { move_h: 5 })).status, 403, "허락 없이는 못 바꿈");
  await s.grant();
  // 노드 수치: 보낸 칸만 · 범위로 자름 · 전 값
  const nv = await s.set("node_values", { move_h: 5, archive_h: 9999 });
  assert.equal(nv.status, 200, nv.text); assert.equal(nv.j.before.move_h, 24); assert.equal(nv.j.after.move_h, 5); assert.equal(nv.j.after.archive_h, 168); assert.equal(nv.j.after.check_min, 30, "안 보낸 칸은 그대로");
  assert.equal((await s.set("node_values", { nope: 1 })).status, 400); assert.equal((await s.set("node_values", { move_h: "5" })).status, 400); assert.equal((await s.set("node_values", {})).status, 400);
  // 단위
  assert.equal((await s.set("unit", "agent")).status, 200); assert.equal((await s.get()).j.values.unit, "agent");
  assert.equal((await s.set("unit", "x")).status, 400);
  // prefs: 칸만 · 묶음 중 사람 몸에 닿는 것은 거절
  const pf = await s.set("prefs", { park_on: false, park_h: 12, rules: { report: false }, bundles: { "priority-file": false } });
  assert.equal(pf.status, 200, pf.text); assert.equal(pf.j.after.park_on, false); assert.equal(pf.j.after.park_h, 12); assert.equal(pf.j.after.rules.report, false); assert.equal(pf.j.after.bundles["priority-file"], false);
  assert.equal(pf.j.before.park_on, true);
  const touchy = await s.set("prefs", { bundles: { "phone-alert": true } });
  assert.equal(touchy.status, 403, touchy.text); assert.match(touchy.j.error, /approval_required/);
  assert.equal((await s.get()).j.values.prefs.bundles["phone-alert"], false, "안 바뀜");
  assert.equal((await s.set("prefs", { bundles: { "phone-alert": false } })).status, 200, "값이 그대로면 통과");
  assert.equal((await s.set("prefs", { nope: 1 })).status, 400);
  // 사이드 숨김 · 모양 · 기능 · 세션 싱크
  assert.deepEqual((await s.set("side_hide", ["feed"])).j.after, ["feed"]); assert.equal((await s.set("side_hide", ["x"])).j.after.length, 0, "모르는 열쇠는 버림");
  const ui = await s.set("ui", { theme: "dark", still: "1" }); assert.equal(ui.status, 200, ui.text); assert.equal((await s.get()).j.values.ui.theme, "dark");
  assert.equal((await s.set("ui", { theme: "pink" })).status, 400); assert.equal((await s.set("ui", { toString: "x" })).status, 400);
  const ft = await s.set("features", { taskboard: true }); assert.equal(ft.status, 200, ft.text); assert.equal(ft.j.after.taskboard, true);
  assert.equal((await s.set("features", { nope: true })).status, 400);
  assert.equal((await s.set("session_sync", false)).status, 200); assert.equal((await s.get()).j.values.session_sync, false);
  assert.equal((await s.set("session_sync", "off")).status, 400);
  // 보드 기록에 전 값
  const logs = (s.db.prepare("SELECT text FROM board_log WHERE owner = ? AND win = '보더'").all(MEMBER) as any[]).map(x => x.text);
  assert.ok(logs.some(t => /노드 수치/.test(t) && /전:/.test(t)), logs.join("\n"));
});

test("옛 허락(범위 좁음)은 새 칸을 못 바꾸고 다시 허락받아야 함 · 바깥 발송 · 묻기 규칙 · 세션 싱크 켜기는 기기 허락만으로 못 바꿈", async () => {
  const s = await setup();
  s.db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(MEMBER, "cli_settings:dev1", String(Date.now()), Date.now());   // 옛 허락 값(접두사 없음)
  assert.equal((await s.set("task_channels", true)).status, 200, "옛 칸은 그대로 됨");
  const n = await s.set("node_values", { move_h: 5 });
  assert.equal(n.status, 403, n.text); assert.match(n.j.hint, /다시 받아요/);
  const a = await s.call("POST", "/api/device/settings/allow", {}, s.dev(DEV1));
  assert.equal(a.j.allowed, false, "옛 허락이면 새 카드를 세움"); assert.equal(a.j.pending, true);
  assert.equal((await s.call("POST", `/api/me/cards/${a.j.card_id}/answer`, { choice: "허용" }, await s.human())).status, 200);
  assert.equal((await s.set("node_values", { move_h: 5 })).status, 200, "다시 허락한 뒤");
  for (const rules of [{ outside: false }, { ask: false }]) { const r = await s.set("prefs", { rules }); assert.equal(r.status, 403, r.text); assert.match(r.j.error, /approval_required/); }
  assert.equal((await s.set("prefs", { rules: { report: false } })).status, 200, "다른 규칙은 됨");
  assert.equal((await s.set("session_sync", false)).status, 200, "끄기는 됨");
  const on = await s.set("session_sync", true); assert.equal(on.status, 403, on.text); assert.match(on.j.error, /approval_required/);
});

test("내 기기 목록(GET /api/device/devices): 허락 없이도 읽힘 · 자기 회원 기기만 · 지표 없음 · 감시 · 토큰 없음은 401", async () => {
  const s = await setup();
  const r = await s.call("GET", "/api/device/devices", undefined, s.dev(DEV1));
  assert.equal(r.status, 200, r.text); assert.equal(r.j.this, "dev1");
  assert.deepEqual(r.j.devices.map((d: any) => d.id).sort(), ["dev1", "dev2", "devMW"]);
  assert.ok(!("metrics" in r.j.devices[0]) && !("token_hash" in r.j.devices[0]));
  for (const t of [DEVMW, DEVW]) assert.equal((await s.call("GET", "/api/device/devices", undefined, s.dev(t))).status, 401);
  assert.equal((await s.call("GET", "/api/device/devices")).status, 401);
});

test("다른 회원 기기는 내 값을 못 읽고 못 바꿈(자기 값만)", async () => {
  const s = await setup();
  await s.grant(DEV1);
  await s.set("task_repo", "example-org/app");
  const T = Date.now(), DEVO = "bxd_made-up-other-member-0123456789abcd";
  s.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)").run("devO", OTHER, "other", "", await sha(DEVO), T, T, "full");
  assert.equal((await s.get(DEVO)).j.values.task_repo, "", "남의 값이 안 보임");
  assert.equal((await s.set("task_repo", "x/y", DEVO)).status, 403, "남의 기기 허락 없음");
  assert.equal((await s.get()).j.values.task_repo, "example-org/app");
});

const JS = "fetch('/api/me/cards/1.1/answer',{method:'POST',headers:{'x-hb':'1'},body:'{}'})";
test("화면 덧씌우기 js: 허락 없는 기기 403 · 값 안 바뀜 / 보드 카드 「허용」 뒤 200 — 고정 캔버스 대체 값(wrapper side.pins)도 같음", async () => {
  const s = await setup(), ov = (body: unknown, t = DEV1) => s.call("POST", "/api/device/overlay", body, s.dev(t));
  const row = () => s.db.prepare("SELECT js, wjs, wside FROM person_custom WHERE owner = ?").get(MEMBER) as any;
  const side = { slot: "wrapper", set: { side: { pins: [{ id: "abcd1234", title: "x" }] } } };
  for (const b of [{ slot: "mine", set: { js: JS } }, { slot: "wrapper", set: { js: JS }, consent: await sha(JS) }, side]) {
    const r = await ov(b); assert.equal(r.status, 403, r.text); assert.equal(r.j.error, "not_allowed"); assert.match(r.j.hint, /boarder settings allow/);
  }
  assert.equal(row(), undefined, "값 안 바뀜");
  assert.deepEqual((await s.get()).j.values.pins, [], "고정 캔버스도 그대로");
  await s.grant(DEV1);
  assert.equal((await ov({ slot: "mine", set: { js: JS } })).status, 200);
  assert.equal((await ov(side)).status, 200);
  assert.equal(row().js, JS);
  assert.deepEqual((await s.get()).j.values.pins.map((p: any) => p.id), ["abcd1234"]);
  assert.equal((await ov({ slot: "mine", set: { js: "window.other=1" } }, DEV2)).status, 403, "허락은 기기마다");
  assert.equal(row().js, JS);
});

test("허락 카드 글에 스크립트 권한을 밝힘(사람이 뭘 허용하는지 알게)", async () => {
  const s = await setup();
  const a = await s.call("POST", "/api/device/settings/allow", {}, s.dev(DEV1));
  const body = (s.db.prepare("SELECT body FROM board_card WHERE id = ?").get(a.j.card_id) as any).body;
  assert.match(body, /스크립트/);
});

test("거절 뒤 24시간 · 하루 다섯: 새 카드가 안 섬(429) — 다른 기기는 따로, 잠금이 지나면 다시", async () => {
  const s = await setup(), allow = (t = DEV1) => s.call("POST", "/api/device/settings/allow", {}, s.dev(t));
  const cards = () => (s.db.prepare("SELECT count(*) n FROM board_card WHERE owner = ?").get(MEMBER) as any).n;
  const a = await allow();
  await s.call("POST", `/api/me/cards/${a.j.card_id}/answer`, { choice: "거절" }, await s.human());
  const n = cards();
  const r = await allow(); assert.equal(r.status, 429, r.text); assert.match(r.j.error, /거절/); assert.equal(cards(), n, "새 카드 없음");
  assert.equal((await s.call("GET", "/api/device/settings/allow", undefined, s.dev(DEV1))).j.pending, false);
  assert.equal((await allow(DEV2)).status, 200, "다른 기기는 잠기지 않음");
  s.db.prepare("UPDATE device_card_event SET at = at - ? WHERE kind LIKE '%locked%'").run(24 * 3600_000 + 1000);
  s.db.prepare("UPDATE device_card_event SET at = at - ? WHERE kind LIKE '%asked%'").run(24 * 3600_000 + 1000);
  // 답 없이 10분마다: 하루 다섯까지만
  for (let i = 0; i < 5; i++) {
    const x = await allow(); assert.equal(x.status, 200, `${i}번째 ${x.text}`); assert.ok(x.j.card_id);
    s.db.prepare("UPDATE user_pref SET at = at - ? WHERE k = ?").run(11 * 60_000, "cli_settings_req:" + x.j.card_id);
  }
  const m = cards();
  const y = await allow(); assert.equal(y.status, 429, y.text); assert.match(y.j.error, /하루|오늘/); assert.equal(cards(), m);
  s.db.prepare("UPDATE device_card_event SET at = at - ? WHERE kind LIKE '%asked%'").run(24 * 3600_000 + 1000);
  assert.equal((await allow()).status, 200, "하루 지나면 다시");
});

test("허락받은 기기의 /api/device/roles · pins 도 보드 기록에 전 → 후(front_door 바뀜 포함) · 값이 그대로면 줄 없음 · 화면 길은 안 남김", async () => {
  const s = await setup(), T = Date.now();
  const logs = () => (s.db.prepare("SELECT text FROM board_log WHERE owner = ? AND win = '보더'").all(MEMBER) as any[]).map(x => x.text);
  s.db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(MEMBER, "cli_settings:dev1", "1", T);   // 카드 없이 허락(이 시험은 기록 줄이 노드를 만드는지 봄 — 카드는 따로 묶임)
  for (const [id, nm] of [["n_old1", "옛 팀장"]]) s.db.prepare("INSERT INTO mnode(owner, id, name, pinned_name, area, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(MEMBER, id, nm, nm, "", "idle", "", "{}", T, T);
  const roles = { roles: [{ name: "비서실장", win: "host1:ew_chief1", primary: true, fold: ["옛 팀장"] }] };
  assert.equal((await s.call("POST", "/api/device/roles", roles, s.dev(DEV1))).status, 200);
  let l = logs();
  assert.ok(l.some(t => /기기 「laptop」 이 CLI 로 역할 자리표 을 바꿨어요 — 전: 없음 → 후: 비서실장.*host1:ew_chief1/.test(t)), l.join("\n"));
  assert.ok(l.some(t => /기기 「laptop」 이 CLI 로 앞단 접기 을 바꿨어요 — 전: 없음 → 후: 비서실장\(옛 팀장\)/.test(t)), l.join("\n"));
  const n = logs().length;
  assert.equal((await s.call("POST", "/api/device/roles", roles, s.dev(DEV1))).status, 200);
  assert.equal(logs().length, n, "같은 표를 다시 올리면(창이 안 옮김) 줄 없음");
  assert.equal((s.db.prepare("SELECT count(*) n FROM mnode WHERE owner = ? AND name = '보더'").get(MEMBER) as any).n, 0, "기록 줄이 묶기에서 「보더」 노드 칸을 만들지 않음");
  assert.equal((await s.call("POST", "/api/device/pins", { pins: [{ id: "zzzz9999", title: "x" }] }, s.dev(DEV1))).status, 200);
  l = logs();
  assert.ok(l.some(t => /기기 「laptop」 이 CLI 로 사이드바 고정 캔버스 을 바꿨어요 — 전: 없음 → 후: zzzz9999/.test(t)), l.join("\n"));
  const m = logs().length;
  assert.equal((await s.call("POST", "/api/device/pins", { pins: [{ id: "yyyy8888", title: "y" }] }, await s.human())).status, 200, "같은 사이트 회원 화면");
  assert.equal(logs().length, m, "사람이 화면에서 한 건 기기 기록이 아님");
});

test("기다리는 카드가 만료되면 GET 때도 닫힘(POST allow 를 다시 안 불러도)", async () => {
  const s = await setup();
  for (const path of ["/api/device/settings/allow", "/api/device/settings"]) {
    const a = await s.call("POST", "/api/device/settings/allow", {}, s.dev(DEV1));
    s.db.prepare("UPDATE user_pref SET at = at - ? WHERE k = ?").run(11 * 60_000, "cli_settings_req:" + a.j.card_id);
    assert.equal((await s.call("GET", path, undefined, s.dev(DEV1))).j.pending, false);
    assert.deepEqual({ ...(s.db.prepare("SELECT state, done FROM board_card WHERE id = ?").get(a.j.card_id) as any) }, { state: "closed", done: "만료" }, path);
    assert.equal(s.db.prepare("SELECT 1 x FROM user_pref WHERE k = ?").get("cli_settings_req:" + a.j.card_id), undefined);
  }
});

test("메인 봇 이름은 글자만: 숫자 · 객체 · 목록 · 참거짓 · null 은 400, 긴 이름도 400 · 값 그대로", async () => {
  const s = await setup(), T = Date.now();
  await s.grant(DEV1);
  s.db.prepare("INSERT INTO member_bot(owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(MEMBER, "s1", 120, "보더", "", "a".repeat(32), "b".repeat(32), T);
  for (const v of [123, { a: 1 }, ["비서"], true, null, "가".repeat(21), "  "]) assert.equal((await s.set("bot_name", v)).status, 400, JSON.stringify(v));
  assert.equal((await s.get()).j.values.bot_name, "보더");
});

test("앞단 접기 찾기: 같은 이름 노드가 많아도 다른 이름이 밀려 404 나지 않음(이름마다 찾음)", async () => {
  const s = await setup(), T = Date.now();
  await s.grant(DEV1);
  const add = (id: string, nm: string, at: number) => s.db.prepare("INSERT INTO mnode(owner, id, name, pinned_name, area, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(MEMBER, id, nm, nm, "", "idle", "", "{}", at, at);
  for (let i = 0; i < 9; i++) add(`n_dup${i}`, "많은 이름", T - i);   // 더 최근 것 아홉
  add("n_rare", "드문 이름", T - 1000);
  const r = await s.set("front_door", { name: "앞", fold: ["많은 이름", "드문 이름"] });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.j.after.pairs.some((p: any) => p.name === "드문 이름"), JSON.stringify(r.j.after.pairs));
  assert.ok(r.j.after.pairs.length <= 8);
  const roles = await s.call("POST", "/api/device/roles", { roles: [{ name: "비서실장", win: "host1:ew_chief1", primary: true, fold: ["많은 이름", "드문 이름"] }] }, s.dev(DEV1));
  assert.deepEqual(roles.j.front.missing, [], roles.text);
  assert.ok(roles.j.front.folded.includes("드문 이름"));
});

// 끝에서 끝까지: 진짜 CLI(packages/cli/bin/boarder.mjs)를 이 시험 서버(진짜 index.ts + 메모리 SQLite — 운영 아님)에 붙여 돌림
async function cliOn(s: Awaited<ReturnType<typeof setup>>, fn: (cli: (...a: string[]) => Promise<{ code: number | null; out: string; err: string }>) => Promise<void>, token = DEV1) {
  const srv = http.createServer(async (req, res) => {
    let b = ""; for await (const d of req) b += d;
    const r = await app.fetch(new Request("https://example.test" + req.url, { method: req.method, headers: req.headers as Record<string, string>, body: ["GET", "HEAD"].includes(req.method || "") ? undefined : b }), s.env, s.ctx);
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json" }); res.end(await r.text());
  });
  await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
  const H = mkdtempSync(path.join(tmpdir(), "bx-settings-")), B = path.join(H, "boarder"); mkdirSync(B, { mode: 0o700 });
  writeFileSync(path.join(B, "device.json"), JSON.stringify({ token, device_id: "dev1", server: `http://127.0.0.1:${(srv.address() as any).port}` }));
  const BIN = fileURLToPath(new URL("../../../packages/cli/bin/boarder.mjs", import.meta.url));
  const env = { ...process.env, HOME: H, BOARDER_HOME: B, BOARDER_TOKEN: "", BOARDER_WINDOW: "test-win" };
  const cli = (...a: string[]) => new Promise<{ code: number | null; out: string; err: string }>(res => {
    const c = spawn(process.execPath, [BIN, ...a], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; c.stdout.on("data", d => out += d); c.stderr.on("data", d => err += d);
    c.on("close", code => res({ code, out, err }));
  });
  try { await fn(cli); } finally { srv.close(); rmSync(H, { recursive: true, force: true }); }
}

test("CLI: 허락 없는 기기의 set 은 끝 코드 77 · 서버 403 · 값 그대로 / 허락 뒤 set 은 전 값 · 되돌리는 명령을 찍음 · 토큰은 안 찍음", async () => {
  const s = await setup();
  await cliOn(s, async cli => {
    let r = await cli("task-channels", "set", "on");
    assert.equal(r.code, 77, r.err); assert.match(r.err, /not allowed: .*boarder settings allow/); assert.equal(r.out, "");
    assert.equal(s.node(), undefined);
    r = await cli("settings", "show"); assert.equal(r.code, 0, r.err); assert.equal(JSON.parse(r.out).allowed, false);
    await s.grant(DEV1);
    r = await cli("task-channels", "set", "on");
    assert.equal(r.code, 0, r.err); let j = JSON.parse(r.out);
    assert.deepEqual([j.before, j.after, j.undo], [false, true, "boarder task-channels set off"]);
    r = await cli("task-repo", "set", "https://github.com/Example-Org/App"); j = JSON.parse(r.out);
    assert.deepEqual([j.before, j.after, j.undo], ["", "example-org/app", "boarder task-repo set off"]);
    r = await cli("task-repo", "set", "example-org/other"); assert.equal(JSON.parse(r.out).undo, "boarder task-repo set 'example-org/app'");
    r = await cli("pins", "set", "https://example.test/art/AbCdEf123456/"); j = JSON.parse(r.out);
    assert.deepEqual(j.after.map((p: any) => p.id), ["AbCdEf123456"]); assert.equal(j.undo, "boarder pins set --none");
    r = await cli("pins", "set", "--none"); assert.equal(JSON.parse(r.out).undo, "boarder pins set 'AbCdEf123456'");
    r = await cli("primary-window", "set", "ew_notmine"); assert.equal(r.code, 1); assert.match(r.err, /내 살아 있는 창이 아니에요/);
    r = await cli("bot", "set", "--name", "비서"); assert.equal(r.code, 1); assert.match(r.err, /메인 봇이 아직 없어요/);
    r = await cli("window", "renew"); assert.equal(r.code, 0, r.err); assert.match(JSON.parse(r.out).key, /test-win/);
    const tok = (s.db.prepare("SELECT count(*) n FROM agent_token WHERE device_id = 'dev1'").get() as any).n;
    assert.equal(tok, 1, "창 토큰 하나를 새로 받음");
    r = await cli("window", "show"); assert.equal(JSON.parse(r.out).token_saved, true);
    for (const x of [r.out, r.err]) { assert.ok(!x.includes(DEV1), "기기 토큰 안 찍음"); assert.ok(!/bxa_[A-Za-z0-9_-]{20,}/.test(x), "창 토큰 안 찍음"); }
    // 앞단 접기 · 역할 자리표: 전 값과 되돌리는 명령
    const T = Date.now();
    for (const [id, nm] of [["n_old1", "옛 팀장"], ["n_old2", "옛 비서"]]) s.db.prepare("INSERT INTO mnode(owner, id, name, pinned_name, area, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(MEMBER, id, nm, nm, "", "idle", "", "{}", T, T);
    r = await cli("front-door", "set", "--name", "비서실장", "--fold", "옛 팀장", "--fold", "옛 비서"); assert.equal(r.code, 0, r.err); j = JSON.parse(r.out);
    assert.equal(j.before, null); assert.equal(j.after.name, "비서실장"); assert.equal(j.undo, "boarder front-door set off");
    r = await cli("front-door", "set", "off"); assert.equal(JSON.parse(r.out).undo, "boarder front-door set --name '비서실장' --fold '옛 팀장' --fold '옛 비서'");
    const f = path.join(tmpdir(), `bx-roles-${process.pid}.json`); writeFileSync(f, JSON.stringify([{ name: "비서실장", win: "host1:ew_chief1", primary: true }]));
    try { r = await cli("roles", "set", f); } finally { rmSync(f, { force: true }); }
    assert.equal(r.code, 0, r.err); j = JSON.parse(r.out); assert.deepEqual(j.before, []); assert.equal(j.after[0].name, "비서실장"); assert.match(j.undo, /^boarder roles set - <<'JSON'\n\[\]\nJSON$/);
    // 메인 봇 자리 · fold 를 가진 표를 바꿀 때: GET 에 그 칸이 있고, undo 가 그대로 · 앞단 접기까지 되돌림
    const roleFile = (v: unknown) => { const p = path.join(tmpdir(), `bx-roles-${process.pid}.json`); writeFileSync(p, JSON.stringify(v)); return p; };
    const g0 = await s.call("GET", "/api/device/roles", undefined, s.dev(DEV1));
    assert.equal(g0.j.seats[0].primary, true, "GET 답에 primary");
    await cli("front-door", "set", "off");
    const seats1 = [{ name: "비서실장", win: "host1:ew_chief1", primary: true, fold: ["옛 팀장", "옛 비서"] }, { name: "기술장", win: "host1:ew_tech1", node: "tk_missing" }];
    const f1 = roleFile(seats1);
    try { r = await cli("roles", "set", f1); } finally { rmSync(f1, { force: true }); }
    assert.equal(r.code, 0, r.err); assert.match(JSON.parse(r.out).undo, /\nJSON\nboarder front-door set off$/, "앞단 접기가 켜졌으니 끄기까지");
    const g1 = await s.call("GET", "/api/device/roles", undefined, s.dev(DEV1));
    assert.equal(g1.j.seats[0].primary, true); assert.deepEqual(g1.j.seats[0].fold, seats1[0].fold);
    const f2 = roleFile([{ name: "새 자리", win: "host1:ew_new1" }]);
    try { r = await cli("roles", "set", f2); } finally { rmSync(f2, { force: true }); }
    assert.equal(r.code, 0, r.err); j = JSON.parse(r.out);
    assert.deepEqual(j.before, seats1, "전 값이 칸까지 그대로(primary · fold · 아직 없는 node)");
    const lines = String(j.undo).split("\n");
    assert.equal(lines[0], "boarder roles set - <<'JSON'"); assert.deepEqual(JSON.parse(lines[1]), seats1); assert.equal(lines[2], "JSON");
    assert.match(lines[3], /^boarder front-door set --name '비서실장' /, "앞단 접기 값도 되돌림");
    // 되돌리기를 진짜로: 자리표 · 앞단 접기가 전 값으로
    assert.equal((await s.call("POST", "/api/device/roles", { roles: JSON.parse(lines[1]) }, s.dev(DEV1))).status, 200);
    assert.deepEqual((await s.call("GET", "/api/device/roles", undefined, s.dev(DEV1))).j.roles, seats1);
    assert.equal((await s.get()).j.values.front_door.name, "비서실장");
    // front-door undo: 없는 이름이 aliases 에 있어도 짝(pairs) 이름으로 — 되돌리기가 404 나지 않고 aliases 는 --alias 로 살아남
    const f3 = roleFile([{ name: "비서실장", win: "host1:ew_chief1", primary: true, fold: ["옛 팀장", "지금은 없는 이름"] }]);
    try { r = await cli("roles", "set", f3); } finally { rmSync(f3, { force: true }); }
    assert.equal(r.code, 0, r.err); assert.deepEqual(JSON.parse(r.out).front.missing, ["지금은 없는 이름"]);
    r = await cli("front-door", "set", "off"); j = JSON.parse(r.out);
    assert.equal(j.undo, "boarder front-door set --name '비서실장' --fold '옛 팀장' --alias '옛 팀장' --alias '지금은 없는 이름'");
    r = await cli("front-door", "set", "--name", "비서실장", "--fold", "옛 팀장", "--alias", "옛 팀장", "--alias", "지금은 없는 이름");
    assert.equal(r.code, 0, r.err); assert.deepEqual(JSON.parse(r.out).after.aliases, ["옛 팀장", "지금은 없는 이름"]);
    // pins undo: 제목까지
    await s.call("POST", "/api/device/pins", { pins: [{ id: "AbCdEf123456", title: "내가 지은 제목" }] }, s.dev(DEV1));
    r = await cli("pins", "set", "--none"); j = JSON.parse(r.out);
    assert.equal(j.undo, "boarder pins set 'AbCdEf123456=내가 지은 제목'");
    r = await cli("pins", "set", "AbCdEf123456=내가 지은 제목"); assert.equal(r.code, 0, r.err);
    assert.deepEqual((await s.get()).j.values.pins, [{ id: "AbCdEf123456", title: "내가 지은 제목" }], "제목이 돌아옴");
    r = await cli("settings", "revoke"); assert.equal(JSON.parse(r.out).was, true);
    r = await cli("task-channels", "set", "off"); assert.equal(r.code, 77, "거둔 뒤 다시 막힘");
  });
});

test("CLI: settings allow 는 카드를 세우고 사람의 「허용」을 기다림 — 거절이면 끝 코드 1", async () => {
  const s = await setup();
  await cliOn(s, async cli => {
    const p = cli("settings", "allow", "--wait", "30");
    let card: any; for (let i = 0; i < 50 && !card; i++) { await new Promise(r => setTimeout(r, 100)); card = s.db.prepare("SELECT id FROM board_card WHERE owner = ? AND state = 'open'").get(MEMBER); }
    assert.ok(card, "카드가 섬");
    await s.call("POST", `/api/me/cards/${card.id}/answer`, { choice: "허용" }, await s.human());
    const r = await p; assert.equal(r.code, 0, r.err); assert.equal(JSON.parse(r.out).allowed, true);
  });
  const s2 = await setup();
  await cliOn(s2, async cli => {
    const p = cli("settings", "allow", "--wait", "30");
    let card: any; for (let i = 0; i < 50 && !card; i++) { await new Promise(r => setTimeout(r, 100)); card = s2.db.prepare("SELECT id FROM board_card WHERE owner = ? AND state = 'open'").get(MEMBER); }
    await s2.call("POST", `/api/me/cards/${card.id}/answer`, { choice: "거절" }, await s2.human());
    const r = await p; assert.equal(r.code, 1, r.err); assert.equal(JSON.parse(r.out).allowed, false);
  });
});
