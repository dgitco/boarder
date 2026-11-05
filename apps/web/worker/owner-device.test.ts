// node --test --no-warnings --experimental-transform-types apps/web/worker/owner-device.test.ts
// 주인 서버 기기(scope ownercli, 주인 · 회원 한 길): 진짜 index.ts(app.fetch) + 메모리 SQLite. 메일 · 토큰은 다 지어낸 것.
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
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test", ENGINE: { idFromName: (n: string) => n, get: () => ({ revoke: async () => 0 }) }, CONNECTOR_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64") };
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

const ask = (s: any, action: string, params: unknown = {}, t = DEV1) => s.call("POST", "/api/device/approval-link", { action, params }, s.dev(t));
const tokenOf = (url: string) => url.split(/\/[ac]\//)[1];
const OW_DEV = "bxd_made-up-owner-two-0123456789abcdef0";
const ownerHuman = async (s: any) => ({ cookie: await cookie(OWNER), "x-hb": "1", "sec-fetch-site": "same-origin" });
/** 주인 감시 기기가 ownercli.enable 을 신청 → 주인 본인이 링크에서 계속 → 화면 API */
async function upgrade(s: any, t = DEVW) {
  const a = await ask(s, "ownercli.enable", {}, t); assert.equal(a.status, 200, a.text);
  const c = (await s.call("POST", "/api/approval/consume", { token: tokenOf(a.j.url) }, await ownerHuman(s))).j;
  return s.call(c.method, c.url, c.body, await ownerHuman(s));
}

test("주인 감시 기기: 설정 · 커넥터 길은 401 / 승인 신청은 ownercli.enable 하나만", async () => {
  const s = await setup();
  assert.equal((await s.get(DEVW)).status, 401); assert.equal((await s.call("POST", "/api/device/connect-link", { service: "linear" }, s.dev(DEVW))).status, 401);
  assert.equal((await s.call("GET", "/api/device/approval-actions", undefined, s.dev(DEVW))).j.actions["ownercli.enable"] !== undefined, true);
  assert.deepEqual(Object.keys((await s.call("GET", "/api/device/approval-actions", undefined, s.dev(DEVW))).j.actions), ["ownercli.enable"]);
  assert.equal((await ask(s, "connection.disconnect", { id: "c_" + "a".repeat(20) }, DEVW)).status, 400);
});

test("주인만 올림: 회원 세션 · 기기 토큰 · 다른 기기 · 이미 올린 기기는 거절", async () => {
  const s = await setup();
  const a = await ask(s, "ownercli.enable", {}, DEVW); const tok = tokenOf(a.j.url);
  assert.match(a.j.summary, /owner mac/);
  assert.equal((await s.call("POST", "/api/approval/consume", { token: tok }, await s.human())).status, 410, "회원 세션은 남의 링크");
  assert.equal((await s.call("POST", "/api/me/devices/devW/ownercli", {}, await s.human())).status, 403, "회원은 직접 불러도 주인만");
  assert.equal((await s.call("POST", "/api/me/devices/devW/ownercli", {}, { ...(await ownerHuman(s)), authorization: `Bearer ${DEVW}` })).status, 401, "기기 토큰 머리");
  assert.equal(s.db.prepare("SELECT scope FROM device WHERE id = 'devW'").get().scope, "watch");
  assert.equal((await s.call("POST", "/api/me/devices/dev1/ownercli", {}, await ownerHuman(s))).status, 404, "회원 기기는 올릴 수 없음");
  assert.equal((await upgrade(s)).status, 200);
  assert.equal(s.db.prepare("SELECT scope FROM device WHERE id = 'devW'").get().scope, "ownercli");
  assert.match(s.db.prepare("SELECT v FROM user_pref WHERE k = 'cli_settings:devW'").get().v, /^v2:/);
  assert.equal((await s.call("POST", "/api/me/devices/devW/ownercli", {}, await ownerHuman(s))).status, 404, "두 번 올리지 않음");
});

test("올린 주인 기기: 설정은 주인도 같은 자리에 쓰는 칸만 · 나머지는 409 · 카드 허락 길은 안내", async () => {
  const s = await setup(); await upgrade(s);
  const g = await s.get(DEVW); assert.equal(g.status, 200, g.text); assert.equal(g.j.owner, true); assert.equal(g.j.allowed_wide, true);
  assert.deepEqual(Object.keys(g.j.values).sort(), ["features", "node_values", "pins", "session_sync", "side_hide", "ui"], "아바타는 주인 줄(@owner)이 달라 빠짐");
  const ui = await s.set("ui", { theme: "dark" }, DEVW); assert.equal(ui.status, 200, ui.text);
  assert.equal(s.db.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = 'ui:theme'").get(OWNER).v, "dark", "주인 이메일 자리(화면 길과 같음)");
  assert.equal((await s.set("side_hide", ["feed"], DEVW)).status, 200); assert.equal((await s.set("features", { taskboard: true }, DEVW)).status, 200);
  const sy = await s.set("session_sync", false, DEVW); assert.equal(sy.status, 200, sy.text);
  assert.equal(s.db.prepare("SELECT v FROM user_pref WHERE owner = '' AND k = 'session_sync'").get().v, "off", "세션 싱크는 주인 열쇠 \"\"");
  assert.equal((await s.set("session_sync", true, DEVW)).status, 403, "켜기는 사람 몫");
  for (const k of ["unit", "prefs", "task_channels", "bot_name", "front_door", "avatar"]) assert.equal((await s.set(k, k === "unit" ? "goal" : k === "bot_name" ? "x" : k === "avatar" ? { hue: 10 } : k === "task_channels" ? true : {}, DEVW)).status, 409, k);
  assert.equal((await s.call("POST", "/api/device/settings/allow", {}, s.dev(DEVW))).status, 409);
  const ns = JSON.parse(s.db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(OWNER).data); assert.deepEqual(Object.keys(ns), ["hide"], "노드 설정 그림자 칸(unit · prefs …)을 안 만들고 사이드 숨김만 (화면 길과 같은 자리)");
  assert.equal((await s.call("GET", "/api/device/devices", undefined, s.dev(DEVW))).j.devices.some((d: any) => d.id === "devW"), true);
});

test("올린 주인 기기: 커넥터 링크 · 연결 목록 · 승인 행동이 주인 열쇠(\"\")의 연결에 닿음 / 회원 연결은 안 닿음", async () => {
  const s = await setup(); await upgrade(s);
  const T = Date.now(), add = (owner: string, id: string) => s.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, off, read_only, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, owner, "linear", "ln", "url", "https://x.test", "", "", "ok", "", 1, T, T);
  const OC = "c_" + "e".repeat(20), MC = "c_" + "f".repeat(20); add("", OC); add(MEMBER, MC);
  assert.deepEqual((await s.call("GET", "/api/device/connections", undefined, s.dev(DEVW))).j.connections.map((c: any) => c.id), [OC]);
  const l = await s.call("POST", "/api/device/connect-link", { service: "linear" }, s.dev(DEVW)); assert.equal(l.status, 200, l.text);
  assert.equal(s.db.prepare("SELECT owner FROM connect_link").get().owner, "", "링크도 주인 열쇠");
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token: tokenOf(l.j.url) }, await s.human())).status, 410, "회원 세션은 주인 링크를 못 씀");
  assert.equal((await s.call("POST", "/api/connect-link/consume", { token: tokenOf(l.j.url) }, await ownerHuman(s))).status, 200);
  assert.equal((await ask(s, "connection.disconnect", { id: MC }, DEVW)).status, 400, "회원 연결은 안 닿음");
  const a = await ask(s, "connection.read-only", { id: OC, on: false }, DEVW); assert.equal(a.status, 200, a.text);
  const c = (await s.call("POST", "/api/approval/consume", { token: tokenOf(a.j.url) }, await ownerHuman(s))).j;
  assert.equal((await s.call(c.method, c.url, c.body, await ownerHuman(s))).status, 200); assert.equal(s.db.prepare("SELECT read_only FROM connection WHERE id = ?").get(OC).read_only, 0);
  const rv = await ask(s, "device.revoke", { id: "devMW" }, DEVW); assert.equal(rv.status, 400, "주인 메일 밖(회원) 기기는 못 끊음");
});

test("ownercli 는 다른 기기 길을 못 엶(창 토큰 · 음성 · 하네스 · 화면 스크립트) · 끊으면 끝", async () => {
  const s = await setup(); await upgrade(s);
  for (const [m, p] of [["POST", "/api/device/window"], ["POST", "/api/device/voice"], ["GET", "/api/device/overlay"], ["POST", "/api/device/overlay"], ["GET", "/api/device/roles"], ["POST", "/api/device/connect"]] as const) {
    const r = await s.call(m, p, m === "POST" ? {} : undefined, s.dev(DEVW)); assert.ok([401, 403, 404].includes(r.status), `${m} ${p} → ${r.status}`);
  }
  await s.call("POST", "/api/me/devices/devW/revoke", {}, await ownerHuman(s));
  assert.equal((await s.get(DEVW)).status, 401, "끊긴 기기");
});

test("올린 뒤에도 감시 데몬 길(/api/device/me · metrics)이 그대로 됨", async () => {
  const s = await setup(); await upgrade(s);
  const me = await s.call("GET", "/api/device/me", undefined, s.dev(DEVW)); assert.equal(me.status, 200, me.text);
  const mt = await s.call("POST", "/api/device/metrics", { host: "x" }, s.dev(DEVW)); assert.notEqual(mt.status, 401, mt.text);
});

test("주인 메일이 둘 이상이면 화면 설정 줄(ui · features · side_hide)을 모든 주인 메일에 같이 씀", async () => {
  const s = await setup(); s.env.ALLOW_EMAILS = `${OWNER},owner2@example.test`; await upgrade(s);
  assert.equal((await s.set("ui", { theme: "dark" }, DEVW)).status, 200);
  for (const m of [OWNER, "owner2@example.test"]) assert.equal(s.db.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = 'ui:theme'").get(m).v, "dark", m);
  assert.equal((await s.set("side_hide", ["feed"], DEVW)).status, 200);
  for (const m of [OWNER, "owner2@example.test"]) assert.deepEqual(JSON.parse(s.db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(m).data).hide, ["feed"], m);
  const g = await s.get(DEVW); assert.equal(g.j.values.ui.theme, "dark");
});

test("주인 노드 수치: seed 뒤 owner_state 에 씀(화면 길과 같은 OS.nodeSet), seed 전은 409", async () => {
  const s = await setup(); await upgrade(s);
  const before = await s.set("node_values", { move_h: 5 }, DEVW); assert.equal(before.status, 409, "seed 전"); assert.match(before.j.error, /owner_state/);
  s.db.prepare("INSERT INTO owner_state(k, v, at, ver, ord) VALUES ('node_settings', ?, ?, 0, 0)").run(JSON.stringify({ check_min: 30, split_at: 3, move_h: 24, rename_h: 6, archive_h: 6 }), Date.now());
  const r = await s.set("node_values", { move_h: 5, archive_h: 9999 }, DEVW); assert.equal(r.status, 200, r.text);
  assert.equal(r.j.after.move_h, 5); assert.equal(r.j.after.archive_h, 168, "범위로 자름"); assert.equal(r.j.before.move_h, 24);
  assert.equal(JSON.parse(s.db.prepare("SELECT v FROM owner_state WHERE k = 'node_settings'").get().v).move_h, 5, "정본 owner_state");
  assert.equal(s.db.prepare("SELECT count(*) n FROM f7_after WHERE kind = 'state_file'").get().n >= 1, true, "서버 파일로 내리는 뒷일 줄");
  assert.equal((await s.get(DEVW)).j.values.node_values.move_h, 5);
  assert.equal(s.db.prepare("SELECT count(*) n FROM node_setting WHERE owner = ?").get(OWNER).n === 0 || !JSON.parse(s.db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(OWNER)?.data || "{}").move_h, true, "주인 이메일로 그림자 칸을 안 만듦");
});
