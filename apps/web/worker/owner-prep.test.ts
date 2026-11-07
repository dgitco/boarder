// node --test --no-warnings --experimental-transform-types apps/web/worker/owner-prep.test.ts
// 주인 · 회원 한 길 ④ 준비(스위치 owner_unified_prep): 진짜 index.ts(app.fetch) + 메모리 SQLite. 메일 · 토큰은 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

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

const OWNER2 = "owner2@example.test", CANON = OWNER, ADMIN = "admin-token-made-up";
const NV = { check_min: 30, split_at: 3, move_h: 24, rename_h: 6, archive_h: 6 };
const dc = (n: string) => `made-up-device-code-${n}-0123456789abcdef`;
async function setup() {
  const { db, D1 } = d1(), T = Date.now();
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)");
  dev.run("dev1", MEMBER, "laptop", "", await sha(DEV1), T, T, "full");
  dev.run("devW", OWNER2, "owner mac", "", await sha(DEVW), T, T, "watch");        // 둘째 주인 메일로 승인한 감시 기기
  dev.run("devC", OWNER, "owner server", "", await sha(DEV2), T + 1, T, "ownercli");  // 링크로 올린 주인 기기
  db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(OWNER2, "cli_settings:devW", "v2:1", T);   // 옮기기 시험용: 둘째 메일 줄의 허락
  db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(OWNER, "cli_settings:devC", "v2:2", T);
  db.prepare("INSERT INTO owner_state(k, v, at, ver, ord) VALUES ('node_settings', ?, ?, 0, 0)").run(JSON.stringify({ ...NV, move_h: 12 }), T);
  db.prepare("INSERT INTO member_bot(owner, seed, hue, name, photo, icon, fav, updated_at) VALUES ('@owner', 'owl', 200, '메인 봇', '', 'i', 'f', ?)").run(T);
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: `${OWNER},${OWNER2}`, PUBLIC_URL: "https://example.test", ADMIN_TOKEN: ADMIN,
    ENGINE: { idFromName: (n: string) => n, get: () => ({ revoke: async () => 0 }) }, CONNECTOR_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64") };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  const human = async (email = MEMBER) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  const dev_ = (t: string) => ({ authorization: `Bearer ${t}` });
  const adm = { authorization: `Bearer ${ADMIN}` };
  const flag = async (on: boolean) => { const r = await call("POST", "/api/admin/f7-flag", { name: "owner_unified_prep", on }, adm); assert.equal(r.status, 200, r.text); };
  await flag(false);   // 스위치 캐시(ledger, 시험 사이 공유)를 이 DB 로 맞춤
  const set = (key: string, value: unknown, t = DEVW) => call("POST", "/api/device/settings", { key, value }, dev_(t));
  const get = (t = DEVW) => call("GET", "/api/device/settings", undefined, dev_(t));
  const row = (sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...(a as never[])) as any; return r ? { ...r } : undefined; };
  /** 주인이 브라우저에서 새 기기를 허용(코드 입력 길) → 기기가 토큰을 받음 */
  const newDevice = async (by: string, n: string) => {
    db.prepare("INSERT INTO device_code(code_hash, user_code, name, tools, created_at, expires_at, state, owner) VALUES (?,?,?,?,?,?,?,?)").run(await sha(dc(n)), `AAAA-${n.padStart(4, "B").slice(0, 4)}`, "new mac", "", Date.now(), Date.now() + 600_000, "approved", by);
    return call("POST", "/api/device/token", { device_code: dc(n) });
  };
  return { db, call, human, dev: dev_, adm, flag, set, get, row, newDevice, env };
}
const ownerHuman = async (email = OWNER) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
const tokenOf = (url: string) => url.split(/\/[ac]\//)[1];
/** 주인 기기가 ownercli.enable 을 신청 → 주인 본인이 링크에서 계속 */
async function grant(s: any, t: string) {
  const a = await s.call("POST", "/api/device/approval-link", { action: "ownercli.enable", params: {} }, s.dev(t)); assert.equal(a.status, 200, a.text);
  const c = (await s.call("POST", "/api/approval/consume", { token: tokenOf(a.j.url) }, await ownerHuman())).j;
  return s.call(c.method, c.url, c.body, await ownerHuman());
}
const snap = (s: any) => JSON.stringify({
  device: s.db.prepare("SELECT id, owner, scope FROM device ORDER BY id").all(),
  pref: s.db.prepare("SELECT owner, k, v FROM user_pref WHERE k LIKE 'cli_settings:%' ORDER BY owner, k").all(),
  node: s.db.prepare("SELECT owner, data FROM node_setting ORDER BY owner").all(),
  bot: s.db.prepare("SELECT owner, seed, hue, name, photo, icon, fav FROM member_bot ORDER BY owner").all(),
});

test("스위치 끔 = 예전: 주인이 허용한 새 기기는 watch(허용한 메일 그대로) · 올린 기기는 OWNER_KEYS 만 · 화면 기본 창 403 · 노드 수치는 owner_state", async () => {
  const s = await setup();
  const t = await s.newDevice(OWNER2, "1"); assert.equal(t.status, 200, t.text); assert.equal(t.j.scope, "watch"); assert.equal(t.j.email, OWNER2);
  assert.equal(s.row("SELECT scope, owner FROM device WHERE id = ?", t.j.device_id).owner, OWNER2);
  const g = await s.get(DEV2); assert.equal(g.status, 200, g.text); assert.equal(g.j.unified, undefined);
  assert.deepEqual(Object.keys(g.j.values).sort(), ["features", "node_values", "pins", "session_sync", "side_hide", "ui"]);
  assert.equal((await s.set("prefs", { park_h: 3 }, DEV2)).status, 409);
  assert.equal((await s.call("POST", "/api/device/avatar-image", {}, s.dev(DEV2))).status, 409);
  assert.equal((await s.call("GET", "/api/me/primary-window", undefined, await ownerHuman())).status, 403);
  assert.equal((await s.call("POST", "/api/me/avatar", { seed: "x", hue: 1 }, await ownerHuman())).status, 403);
  const nv = await s.call("POST", "/api/me/nodeset", { values: { move_h: 7 } }, await ownerHuman()); assert.equal(nv.status, 200, nv.text);
  assert.equal(JSON.parse(s.row("SELECT v FROM owner_state WHERE k = 'node_settings'").v).move_h, 7);
  assert.equal(s.row("SELECT data FROM node_setting WHERE owner = ?", CANON), undefined, "canon 줄 안 만듦");
  assert.equal((await s.call("GET", "/api/device/settings", undefined, s.dev(DEVW))).status, 401, "감시 기기는 그대로 설정 길 밖");
  assert.equal((await s.call("GET", "/api/admin/owner-prep/migrate", undefined, s.adm)).j.owner_unified_prep, false);
  assert.equal((await s.call("POST", "/api/admin/owner-prep/migrate", { action: "run", dryRun: false }, s.adm)).status, 409, "꺼진 채 run 은 거절");
});

test("스위치 켬: 새 주인 기기는 full · owner canon — 창 토큰 · 음성도 열림(주인 · 회원 한 길), 허락은 승인 링크로 · 허락 전 화면 스크립트 403", async () => {
  const s = await setup(); await s.flag(true);
  const t = await s.newDevice(OWNER2, "2"); assert.equal(t.status, 200, t.text); assert.equal(t.j.scope, "full"); assert.equal(t.j.email, CANON);
  const tok = t.j.token, id = t.j.device_id;
  assert.deepEqual(s.row("SELECT owner, scope FROM device WHERE id = ?", id), { owner: CANON, scope: "full" });
  assert.equal((await s.call("POST", "/api/device/window", { key: "w:1" }, s.dev(tok))).status, 200, "창 토큰 열림(canon 보드 — owner_unified 늘 켬)");
  assert.notEqual((await s.call("POST", "/api/device/voice", {}, s.dev(tok))).status, 401);
  const g = await s.get(tok); assert.equal(g.status, 200, g.text); assert.equal(g.j.unified, true); assert.equal(g.j.allowed, false);
  assert.ok(["prefs", "primary_window", "avatar", "bot_name", "unit"].every(k => k in g.j.values), "회원 칸 전부");
  assert.equal((await s.set("prefs", { park_h: 3 }, tok)).status, 403, "허락 전");
  assert.equal((await s.call("POST", "/api/device/overlay", { slot: "mine", set: { js: "window.x=1" } }, s.dev(tok))).status, 403, "허락 전 화면 스크립트");
  assert.ok("ownercli.enable" in (await s.call("GET", "/api/device/approval-actions", undefined, s.dev(tok))).j.actions);
  assert.equal((await grant(s, tok)).status, 200);
  assert.equal(s.row("SELECT scope FROM device WHERE id = ?", id).scope, "full", "범위는 full 그대로");
  assert.match(s.row("SELECT v FROM user_pref WHERE owner = ? AND k = ?", CANON, `cli_settings:${id}`).v, /^v2:/);
  assert.equal((await s.call("POST", "/api/device/overlay", { slot: "mine", set: { js: "window.x=1" } }, s.dev(tok))).status, 200, "허락 뒤");
  s.db.prepare("INSERT INTO device_code(code_hash, user_code, name, tools, created_at, expires_at, state) VALUES (?,?,?,?,?,?,'pending')").run(await sha(dc("p")), "PEND-CODE", "x", "", Date.now(), Date.now() + 600_000);
  const lk = await s.call("GET", "/api/device/lookup?code=PEND-CODE", undefined, await ownerHuman()); assert.equal(lk.status, 200, lk.text);
  assert.equal(lk.j.scope, "full", "승인 화면도 full 로 보임");
  await s.flag(false); assert.equal((await s.call("GET", "/api/device/lookup?code=PEND-CODE", undefined, await ownerHuman())).j.scope, "watch", "끄면 예전");
});

test("스위치 켬: 주인 설정 읽기 · 쓰기가 canon 회원 줄 — 노드 수치(owner_state 거울) · prefs · 기본 창 · 얼굴(@owner 거울) · 메일 칸은 넷 모두", async () => {
  const s = await setup(); await s.flag(true);
  const g0 = await s.get(DEV2); assert.equal(g0.status, 200, g0.text); assert.equal(g0.j.values.node_values.move_h, 12, "옮기기 전엔 옛 정본(owner_state)");
  assert.equal(g0.j.values.avatar.seed, "owl", "옮기기 전엔 @owner 얼굴");
  const nv = await s.set("node_values", { check_min: 45 }, DEV2); assert.equal(nv.status, 200, nv.text);
  assert.deepEqual(JSON.parse(s.row("SELECT data FROM node_setting WHERE owner = ?", CANON).data), { ...NV, move_h: 12, check_min: 45 }, "첫 쓰기는 옛 값 위에");
  assert.equal(JSON.parse(s.row("SELECT v FROM owner_state WHERE k = 'node_settings'").v).check_min, 45, "owner_state 거울");
  const pr = await s.set("prefs", { park_h: 3 }, DEV2); assert.equal(pr.status, 200, pr.text);
  assert.equal(JSON.parse(s.row("SELECT data FROM node_setting WHERE owner = ?", CANON).data).park_h, 3);
  assert.equal(s.row("SELECT data FROM node_setting WHERE owner = ?", OWNER2), undefined, "둘째 메일 줄은 안 만듦");
  assert.equal((await s.set("primary_window", null, DEV2)).status, 200);
  const av = await s.set("avatar", { seed: "cat", hue: 33 }, DEV2); assert.equal(av.status, 200, av.text);
  assert.equal(s.row("SELECT seed FROM member_bot WHERE owner = ?", "@me:" + CANON).seed, "cat");
  assert.deepEqual([s.row("SELECT seed, hue FROM member_bot WHERE owner = '@owner'").seed, s.row("SELECT hue FROM member_bot WHERE owner = '@owner'").hue], ["cat", 33], "화면이 읽는 @owner 도 같게");
  assert.equal((await s.set("ui", { theme: "dark" }, DEV2)).status, 200);
  for (const m of [OWNER, OWNER2]) assert.equal(s.row("SELECT v FROM user_pref WHERE owner = ? AND k = 'ui:theme'", m).v, "dark", m);
  // 화면 길(주인 로그인)
  const sp = await s.call("POST", "/api/me/nodeset", { prefs: { park_on: false } }, await ownerHuman(OWNER2)); assert.equal(sp.status, 200, sp.text); assert.equal(sp.j.prefs.park_on, false);
  assert.equal(JSON.parse(s.row("SELECT data FROM node_setting WHERE owner = ?", CANON).data).park_on, false);
  const sv = await s.call("POST", "/api/me/nodeset", { values: { split_at: 5 } }, await ownerHuman()); assert.equal(sv.status, 200, sv.text); assert.equal(sv.j.values.split_at, 5);
  assert.equal(JSON.parse(s.row("SELECT v FROM owner_state WHERE k = 'node_settings'").v).split_at, 5, "화면 쓰기도 거울");
  assert.equal((await s.get(DEV2)).j.values.node_values.split_at, 5, "CLI · 화면 같은 정본");
  const pw = await s.call("GET", "/api/me/primary-window", undefined, await ownerHuman()); assert.equal(pw.status, 200, pw.text); assert.equal(pw.j.target, null);
  const ma = await s.call("POST", "/api/me/avatar", { seed: "dog", hue: 5 }, await ownerHuman()); assert.equal(ma.status, 200, ma.text);
  assert.equal((await s.call("GET", "/api/me/avatar", undefined, await ownerHuman())).j.avatar.seed, "dog");
  assert.equal(s.row("SELECT seed FROM member_bot WHERE owner = '@owner'").seed, "dog");
  // 화면 아바타 고르기(/api/me/bot, 「@owner」 줄) → 정본(canon 줄)도 같게
  s.env.RESULTS = { head: async () => ({ httpMetadata: { contentType: "image/png" } }) };
  const B = "a".repeat(32), mb = await s.call("POST", "/api/me/bot", { seed: "fox", hue: 9, name: "새이름", icon: B, fav: B }, await ownerHuman()); assert.equal(mb.status, 200, mb.text);
  assert.equal((await s.call("GET", "/api/me/avatar", undefined, await ownerHuman())).j.avatar.seed, "dog", "주인 /api/me/bot 은 메인 봇 줄(canon, 회원 길) — 내 얼굴은 그대로");
  assert.equal(s.row("SELECT seed FROM member_bot WHERE owner = ?", CANON).seed, "fox");
  assert.equal(s.row("SELECT name FROM member_bot WHERE owner = ?", CANON).name, "새이름", "이름 줄도");
  const bn = await s.set("bot_name", "CLI이름", DEV2); assert.equal(bn.status, 200, bn.text);
  assert.equal(s.row("SELECT name FROM member_bot WHERE owner = '@owner'").name, "CLI이름", "CLI 이름도 화면 줄에 거울");
});

test("회원 회귀 없음: 스위치를 켜도 회원 기기 · 설정 · 화면 길은 그 메일 줄", async () => {
  const s = await setup(); await s.flag(true);
  const t = await s.newDevice(MEMBER, "3"); assert.equal(t.j.scope, "full"); assert.equal(t.j.email, MEMBER);
  const g = await s.get(DEV1); assert.equal(g.status, 200, g.text); assert.equal(g.j.owner, undefined); assert.equal(g.j.unified, undefined);
  const nv = await s.call("POST", "/api/me/nodeset", { values: { move_h: 9 } }, await s.human()); assert.equal(nv.status, 200, nv.text);
  assert.equal(JSON.parse(s.row("SELECT data FROM node_setting WHERE owner = ?", MEMBER).data).move_h, 9);
  assert.equal(JSON.parse(s.row("SELECT v FROM owner_state WHERE k = 'node_settings'").v).move_h, 12, "주인 정본 안 건드림");
  const pp = await s.call("POST", "/api/me/nodeset", { prefs: { park_h: 2 } }, await s.human()); assert.equal(pp.status, 200, pp.text);
  assert.equal(JSON.parse(s.row("SELECT data FROM node_setting WHERE owner = ?", MEMBER).data).park_h, 2);
  assert.equal((await s.call("GET", "/api/me/primary-window", undefined, await s.human())).status, 200);
  assert.equal((await s.call("POST", "/api/me/avatar", { seed: "m", hue: 2 }, await s.human())).status, 200);
  assert.equal(s.row("SELECT seed FROM member_bot WHERE owner = ?", "@me:" + MEMBER).seed, "m");
  assert.equal(s.row("SELECT seed FROM member_bot WHERE owner = '@owner'").seed, "owl", "주인 줄 안 건드림");
});

test("옮기기: dryRun(기본) · 실행 · 되돌리기 — 계획과 실행의 줄이 같고, 되돌리면 처음과 같음, 두 번 돌려도 같음", async () => {
  const s = await setup(); await s.flag(true);
  const before = snap(s);
  const plan = await s.call("GET", "/api/admin/owner-prep/migrate", undefined, s.adm); assert.equal(plan.status, 200, plan.text);
  const live = plan.j.steps.filter((x: any) => !x.skip);
  assert.deepEqual(live.map((x: any) => `${x.kind}:${x.pk}`).sort(), ["device:devC", "device:devW", "face:" + CANON, "face:@me:" + CANON, `grant:${OWNER2}|cli_settings:devW`, "node_setting:" + CANON].sort());
  const dry = await s.call("POST", "/api/admin/owner-prep/migrate", { action: "run" }, s.adm); assert.equal(dry.status, 200, dry.text);
  assert.equal(dry.j.dryRun, true); assert.equal(dry.j.done, 0); assert.deepEqual(dry.j.steps, plan.j.steps, "dryRun = 계획 그대로");
  assert.equal(snap(s), before, "dryRun 은 안 씀");
  const run = await s.call("POST", "/api/admin/owner-prep/migrate", { action: "run", dryRun: false }, s.adm); assert.equal(run.status, 200, run.text);
  assert.equal(run.j.done, live.length); assert.deepEqual(run.j.failed, []);
  assert.deepEqual(s.row("SELECT owner, scope FROM device WHERE id = 'devW'"), { owner: CANON, scope: "full" });
  assert.deepEqual(s.row("SELECT owner, scope FROM device WHERE id = 'devC'"), { owner: CANON, scope: "full" });
  assert.equal(s.row("SELECT scope FROM device WHERE id = 'dev1'").scope, "full", "회원 기기 안 건드림");
  assert.equal(s.row("SELECT owner FROM user_pref WHERE k = 'cli_settings:devW'").owner, CANON);
  assert.deepEqual(JSON.parse(s.row("SELECT data FROM node_setting WHERE owner = ?", CANON).data), { ...NV, move_h: 12 });
  assert.equal(s.row("SELECT name FROM member_bot WHERE owner = ?", CANON).name, "메인 봇"); assert.equal(s.row("SELECT seed FROM member_bot WHERE owner = ?", "@me:" + CANON).seed, "owl");
  assert.equal(s.row("SELECT count(*) n FROM mig_owner_prep").n, live.length, "옛 값 줄");
  // 옮긴 기기가 바로 회원 길로 설정을 씀(허락 줄도 canon 으로 옮겨짐)
  const w = await s.set("prefs", { park_h: 4 }, DEVW); assert.equal(w.status, 200, w.text);
  assert.equal((await s.call("POST", "/api/device/window", { key: "w:1" }, s.dev(DEVW))).status, 200, "옮긴 기기도 창 토큰 열림(canon 보드)");
  const again = await s.call("POST", "/api/admin/owner-prep/migrate", { action: "run", dryRun: false }, s.adm);
  assert.equal(again.j.done, 0, "두 번째는 할 일 없음"); assert.equal(s.row("SELECT count(*) n FROM mig_owner_prep").n, live.length);
  const bdry = await s.call("POST", "/api/admin/owner-prep/migrate", { action: "back" }, s.adm); assert.equal(bdry.j.dryRun, true); assert.equal(bdry.j.steps.length, live.length);
  await s.flag(false);
  const back = await s.call("POST", "/api/admin/owner-prep/migrate", { action: "back", dryRun: false }, s.adm); assert.equal(back.status, 200, back.text); assert.equal(back.j.done, live.length);
  const after = JSON.parse(snap(s)), first = JSON.parse(before);
  assert.deepEqual(after.device, first.device); assert.deepEqual(after.pref, first.pref); assert.deepEqual(after.bot, first.bot);
  assert.deepEqual(after.node, [{ owner: CANON, data: JSON.stringify({ park_h: 4 }) }], "노드 수치 칸만 되돌리고 옮긴 뒤 쓴 prefs 는 남김");
  assert.equal(s.row("SELECT count(*) n FROM mig_owner_prep").n, 0);
  assert.equal((await s.get(DEV2)).status, 200, "되돌린 ownercli 기기는 스위치 끔에서도 그대로");
});
test("켰다 끈 뒤 남은 주인 full 기기도 허락 없이 화면 스크립트를 못 올림", async () => {
  const s = await setup(); await s.flag(true);
  const t = await s.newDevice(OWNER2, "9"); assert.equal(t.status, 200, t.text); assert.equal(t.j.scope, "full");
  await s.flag(false);
  assert.equal((await s.call("POST", "/api/device/overlay", { slot: "mine", set: { js: "window.x=1" } }, s.dev(t.j.token))).status, 403, "끈 뒤에도 허락 전 화면 스크립트 403");
});
