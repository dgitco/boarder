import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
const ledger = await import("./ledger.ts");
const W = await import("./who.ts");
const { liveDevice, deviceOk } = await import("./engine.ts");
const store = await import("./connectors/store.ts");
const { openSecret } = await import("./vault/secret.ts");
const { getDek, _resetVaultCache } = await import("./vault/index.ts");
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
const HARN = "bxd_made-up-harness-device-0123456789abcd", MDEV = "bxd_made-up-member-device-0123456789abcde", OFULL = "bxd_made-up-owner-full-0123456789abcdef0", OWATCH = "bxd_made-up-owner-watch-0123456789abcde0";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const b64 = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("base64");
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}

async function setup() {
  const { db, D1 } = d1(), T = Date.now();
  _resetVaultCache(); W.setCanonOn(false);
  await ledger.setFlag(D1, "owner_device", false);   // 스위치 캐시(isolate 10초)를 이 DB 로 비움
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)");
  dev.run("devH", OWNER, "owner-host harness", "", await sha(HARN), T, T, "harness", T);
  dev.run("devM", MEMBER, "laptop", "", await sha(MDEV), T, T, "full", null);
  dev.run("devOF", OWNER, "owner laptop", "", await sha(OFULL), T, T, "full", null);
  dev.run("devOW", OWNER, "owner mac", "", await sha(OWATCH), T, T, "watch", null);
  const r2 = new Map<string, unknown>();
  const RESULTS = { list: async () => ({ objects: [], truncated: false }), get: async (k: string) => r2.get(k) ?? null, put: async (k: string, v: unknown) => { r2.set(k, v); }, delete: async (k: string) => { r2.delete(k); } };
  const env: any = { DB: D1, RESULTS, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: `${OWNER},${OWNER2}`, PUBLIC_URL: "https://example.test",
    ENGINE: { idFromName: (n: string) => n, get: () => ({ revoke: async () => 0 }) }, CONNECTOR_KEY: b64(32), DATA_KEK_CUR: "1", DATA_KEK_1: b64(32), ADMIN_TOKEN: ADMIN };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  const adm = { authorization: `Bearer ${ADMIN}` };
  const flag = async (name: string, on: boolean) => { const r = await call("POST", "/api/admin/f7-flag", { name, on }, adm); assert.equal(r.status, 200, r.text); };
  const human = async (email: string) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  return { db, D1, env, ctx, call, adm, flag, human, dev: (t: string) => ({ authorization: `Bearer ${t}` }) };
}

const MOUNTS: [string, string, unknown?][] = [
  ["GET", "/api/device/roles"],                       // 들여오기(importer)
  ["GET", "/api/device/tasks/convo"],                 // 태스크 대화
  ["POST", "/api/me/import/slack", {}],               // Slack 들여오기
  ["GET", "/api/me/canvas"],
  ["POST", "/api/me/import/slack/connector", {}],     // Slack 커넥터
  ["GET", "/api/device/connect/cr_none"],             // 기기 커넥터 넣기
];
const statuses = async (s: any, tok: string) => Promise.all(MOUNTS.map(async ([m, p, b]) => (await s.call(m, p, b, s.dev(tok))).status));

test("owner_device 끔 = 예전 그대로: 주인 기기(하네스 · full · watch)는 여섯 mount 훅 401, 회원 기기는 통과 · liveDevice 는 회원 full 만", async () => {
  const s = await setup();
  assert.deepEqual(await statuses(s, HARN), [401, 401, 401, 401, 401, 401]);
  assert.deepEqual(await statuses(s, OFULL), [401, 401, 401, 401, 401, 401]);
  for (const st of await statuses(s, MDEV)) assert.notEqual(st, 401);
  assert.equal(await liveDevice(s.D1, OWNER), null, "주인 하네스는 엔진 기기 아님");
  s.db.prepare("UPDATE device SET engine_at = ? WHERE id = 'devM'").run(Date.now());
  assert.equal(await liveDevice(s.D1, MEMBER), "devM");
});

test("owner_device 켬: 주인 하네스 기기가 여섯 mount 훅 · liveDevice 통과 · 폐기 안 됨 / 주인 full · watch 기기는 여전히 401 / 끄면 바로 예전", async () => {
  const s = await setup();
  await s.flag("owner_device", true);
  for (const [i, st] of (await statuses(s, HARN)).entries()) assert.notEqual(st, 401, `${MOUNTS[i][1]} 가 하네스 기기를 받아야 함`);
  assert.deepEqual(await statuses(s, OFULL), [401, 401, 401, 401, 401, 401], "주인 엔진 기기는 하네스 한 대만");
  assert.deepEqual(await statuses(s, OWATCH), [401, 401, 401, 401, 401, 401]);
  for (const st of await statuses(s, MDEV)) assert.notEqual(st, 401, "회원 기기는 그대로");
  assert.equal(await liveDevice(s.D1, OWNER), "devH");
  assert.equal(await liveDevice(s.D1, OWNER, true), "devH");
  assert.equal(await deviceOk(s.D1, "devH", OWNER), true, "초대 표에 없어도 하네스는 살아 있음");
  assert.equal(s.db.prepare("SELECT revoked_at FROM device WHERE id = 'devH'").get().revoked_at, null);
  await s.flag("owner_device", false);
  assert.deepEqual(await statuses(s, HARN), [401, 401, 401, 401, 401, 401], "끄면 예전");
  assert.equal(await liveDevice(s.D1, OWNER), null);
});

test("열쇠 스위치: 끔 = dataKey '' · 켬 = canon, 세션 · rid 열쇠는 늘 '' / 읽기는 두 열쇠 다(연결 목록)", async () => {
  const s = await setup();
  assert.equal(W.dataKey(s.env, OWNER2), "");
  W.setCanonOn(true);
  assert.equal(W.dataKey(s.env, OWNER2), OWNER); assert.equal(W.legacyKey(s.env, OWNER2), ""); assert.equal(W.dataKey(s.env, MEMBER), MEMBER);
  assert.deepEqual(W.readKeys(s.env, ""), [OWNER, ""]); assert.deepEqual(W.readKeys(s.env, OWNER), [OWNER, ""]); assert.deepEqual(W.readKeys(s.env, MEMBER), [MEMBER]);
  W.setCanonOn(false);
  const ins = s.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
  ins.run("c_old", "", "linear", "", "url", "https://mcp.example.test/a", "", 1, 1);
  ins.run("c_new", OWNER, "notion", "", "url", "https://mcp.example.test/b", "", 1, 1);
  ins.run("c_mem", MEMBER, "notion", "", "url", "https://mcp.example.test/c", "", 1, 1);
  const ids = async () => { const r = await s.call("GET", "/api/connections", undefined, await s.human(OWNER)); assert.equal(r.status, 200, r.text); return (r.j?.connections || []).map((x: any) => x.id).sort(); };
  assert.deepEqual(await ids(), ["c_new", "c_old"], "스위치 끔: 두 열쇠 다");
  await s.flag("owner_key_canon", true);
  assert.deepEqual(await ids(), ["c_new", "c_old"], "스위치 켬: 두 열쇠 다");
  assert.equal(W.canonKeyOn(), true, "미들웨어가 스위치를 따라감");
  assert.deepEqual(((await s.call("GET", "/api/connections", undefined, await s.human(MEMBER))).j?.connections || []).map((x: any) => x.id), ["c_mem"], "회원은 제 것만");
  W.setCanonOn(false);
});

async function seed(s: any) {
  await s.flag("envelope", true);
  await getDek(s.env, OWNER, { create: true });   // canon DEK 먼저(엔진 DO 꼴)
  const tok = (n: number) => ({ access_token: `made-up-token-${n}`, refresh_token: `made-up-refresh-${n}` });
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push(await store.upsert(s.env, "", { service: `svc${i}`, label: "", kind: "url", url: `https://mcp.example.test/${i}`, auth: tok(i) }));
  // 부딪침: canon 쪽에 같은 service · label 줄이 이미 있음
  await store.upsert(s.env, OWNER, { service: "dup", label: "", kind: "url", url: "https://mcp.example.test/dup-canon", auth: tok(90) });
  s.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, created_at, updated_at) VALUES ('c_dup_old', '', 'dup', '', 'url', 'https://mcp.example.test/dup', '', 1, 1)").run();
  s.db.prepare("INSERT INTO hook(id, owner, name, preset, verify, secret, created_at) VALUES ('wh_1', '', 'gh', 'github', '{}', '', 1)").run();
  for (let i = 0; i < 3; i++) s.db.prepare("INSERT INTO hook_event(id, hook_id, owner, dedupe, at) VALUES (?, 'wh_1', '', ?, ?)").run(`he${i}`, `d${i}`, i);
  s.db.prepare("INSERT INTO feedback(id, owner, author, via, kind, text, at) VALUES ('fb1', '', ?, 'web', 'bug', 'made up', 1)").run(OWNER);
  s.db.prepare("INSERT INTO connect_link(hash, owner, device_id, device_name, service, created_at, expires_at) VALUES ('h1', '', 'devOF', 'x', 'linear', 1, 2)").run();
  s.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, created_at, updated_at) VALUES ('c_mem', ?, 'svc0', '', 'url', 'https://mcp.example.test/m', '', 1, 1)").run(MEMBER);
  return { ids, tok };
}
const count = (s: any, tbl: string, owner: string) => Number(s.db.prepare(`SELECT count(*) n FROM ${tbl} WHERE owner = ?`).get(owner).n);
const done = (r: any) => Object.fromEntries(r.j.results.map((x: any) => [x.tbl, x.done]));

test("열쇠 옮기기: dryRun(기본) · 실행 · 되돌리기 행 수가 같고, 옮긴 뒤 봉한 커넥터 토큰이 canon 으로 열림 · 되돌린 뒤 '' 로 열림", async () => {
  const s = await setup();
  const { ids, tok } = await seed(s);
  assert.equal(s.db.prepare("SELECT count(*) n FROM dek WHERE owner IN ('', ?)").get(OWNER).n, 2, "'' · canon DEK 둘(다른 열쇠)");
  const before = s.db.prepare("SELECT id, auth FROM connection WHERE owner = '' ORDER BY id").all();
  assert.ok(before.filter((r: any) => String(r.auth).startsWith("v2.")).length === 4, "'' DEK 로 봉한 줄 넷");

  const plan = (await s.call("GET", "/api/admin/owner-key/migrate", undefined, s.adm)).j.plan;
  const P = Object.fromEntries(plan.map((x: any) => [x.tbl, x]));
  assert.deepEqual([P.connection.rows, P.connection.sealed, P.connection.conflicts], [5, 4, 1]);
  assert.deepEqual([P.hook.rows, P.hook_event.rows, P.feedback.rows, P.connect_link.rows, P.connection_pending.rows], [1, 3, 1, 1, 0]);

  const dry = await s.call("POST", "/api/admin/owner-key/migrate", { action: "run" }, s.adm);
  assert.equal(dry.status, 200, dry.text); assert.equal(dry.j.dryRun, true, "기본은 dryRun");
  assert.deepEqual(done(dry), { connection: 4, connection_pending: 0, hook: 1, hook_event: 3, feedback: 1, connect_link: 1 });
  assert.deepEqual(dry.j.results.find((x: any) => x.tbl === "connection").conflict, ["connection:c_dup_old"]);
  assert.deepEqual(s.db.prepare("SELECT id, auth FROM connection WHERE owner = '' ORDER BY id").all(), before, "dryRun 은 안 씀");
  assert.equal(s.db.prepare("SELECT count(*) n FROM dek").get().n, 2, "dryRun 은 DEK 도 안 만듦");

  assert.equal((await s.call("POST", "/api/admin/owner-key/migrate", { action: "run", dryRun: false }, s.adm)).status, 409, "스위치 끈 채 실행 거절");
  await s.flag("owner_key_canon", true);
  const run = await s.call("POST", "/api/admin/owner-key/migrate", { action: "run", dryRun: false }, s.adm);
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(done(run), done(dry), "dryRun 과 실행 행 수 같음");
  for (const x of run.j.results) assert.deepEqual(x.failed, [], x.tbl);
  assert.equal(s.db.prepare("SELECT count(*) n FROM mig_owner").get().n, 10, "옮긴 줄 키 10");
  assert.equal(count(s, "connection", ""), 1, "부딪친 줄만 '' 로 남음"); assert.equal(count(s, "hook_event", ""), 0); assert.equal(count(s, "connection", MEMBER), 1, "회원 줄은 그대로");
  for (const [i, id] of ids.entries()) {   // 봉한 칸: 다시 봉해졌고(암호문이 다름) canon DEK 로 열림
    const row = s.db.prepare("SELECT owner, auth FROM connection WHERE id = ?").get(id);
    assert.equal(row.owner, OWNER); assert.notEqual(row.auth, before.find((b: any) => b.id === id).auth);
    assert.deepEqual(await openSecret(s.env, row.owner, { tbl: "connection", pk: id, col: "auth" }, row.auth), tok(i));
    await assert.rejects(openSecret(s.env, "", { tbl: "connection", pk: id, col: "auth" }, row.auth), "'' DEK 로는 안 열림(정말 다시 봉함)");
  }
  const g = await store.get(s.env, "", ids[0]); assert.equal(g?.owner, OWNER, "옛 열쇠로 불러도 보임(읽기 호환)");
  assert.deepEqual(done(await s.call("POST", "/api/admin/owner-key/migrate", { action: "run", dryRun: false }, s.adm)), { connection: 0, connection_pending: 0, hook: 0, hook_event: 0, feedback: 0, connect_link: 0 }, "두 번 돌려도 같음");

  assert.equal((await s.call("POST", "/api/admin/owner-key/migrate", { action: "back", dryRun: false }, s.adm)).status, 409, "스위치 켠 채 되돌리기 거절");
  await s.flag("owner_key_canon", false);
  const bdry = await s.call("POST", "/api/admin/owner-key/migrate", { action: "back" }, s.adm);
  assert.deepEqual(done(bdry), done(run), "되돌리기 dryRun 행 수 같음");
  const back = await s.call("POST", "/api/admin/owner-key/migrate", { action: "back", dryRun: false }, s.adm);
  assert.deepEqual(done(back), done(run), "되돌리기 행 수 같음");
  assert.equal(s.db.prepare("SELECT count(*) n FROM mig_owner").get().n, 0);
  assert.equal(count(s, "connection", OWNER), 1, "canon 에서 처음 생긴 줄은 그대로(옮긴 줄이 아님)");
  assert.equal(count(s, "connection", ""), 5); assert.equal(count(s, "hook_event", ""), 3); assert.equal(count(s, "feedback", ""), 1);
  for (const [i, id] of ids.entries()) {
    const row = s.db.prepare("SELECT owner, auth FROM connection WHERE id = ?").get(id);
    assert.deepEqual(await openSecret(s.env, row.owner, { tbl: "connection", pk: id, col: "auth" }, row.auth), tok(i), "되돌린 뒤 '' DEK 로 열림");
  }
});

test("옮기는 동안 쓰기: 같은 service · label 을 canon 열쇠로 다시 연결해도 두 줄로 안 갈라지고 그 줄 열쇠 · DEK 그대로", async () => {
  const s = await setup();
  await s.flag("envelope", true);
  await getDek(s.env, OWNER, { create: true });
  const id = await store.upsert(s.env, "", { service: "linear", label: "", kind: "url", url: "https://mcp.example.test/l", auth: { access_token: "made-up-a" } });
  const id2 = await store.upsert(s.env, OWNER, { service: "linear", label: "", kind: "url", url: "https://mcp.example.test/l", auth: { access_token: "made-up-b" } });
  assert.equal(id2, id); assert.equal(count(s, "connection", ""), 1); assert.equal(count(s, "connection", OWNER), 0);
  const row = s.db.prepare("SELECT owner, auth FROM connection WHERE id = ?").get(id);
  assert.deepEqual(await openSecret(s.env, row.owner, { tbl: "connection", pk: id, col: "auth" }, row.auth), { access_token: "made-up-b" });
  assert.equal(await store.remove(s.env, OWNER, id), true, "canon 열쇠로 '' 줄 끊기");
});
