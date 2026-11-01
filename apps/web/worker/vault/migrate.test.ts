// node --test --no-warnings --experimental-transform-types apps/web/worker/vault/migrate.test.ts (Node 22.18+ · node:sqlite · apps/web 의존성 설치된 채)
// 있는 줄 옮기기(worker/vault/migrate.ts): 평문 · v1 · v2 가 섞인 D1 · R2 · DO 에서 plan → run → back 왕복, 읽는 길의 답은 옮기기 앞 · 뒤 · 되돌린 뒤 모두 같음.
// 그사이 바뀐 줄은 안 씀(CAS), 깨진 줄은 그 줄만 failed. 관리 길 /api/admin/vault 는 스위치에 따라 run · back 을 거절. 자료 · 키는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("../test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const V = await import("./index.ts");
const M = await import("./migrate.ts");
const { sealSecret, openSecret } = await import("./secret.ts");
const { seal: legacySeal } = await import("../connectors/seal.ts");
const store = await import("../connectors/store.ts");
const sessions = await import("../connectors/sessions.ts");
const { ridCell } = await import("../queue.ts");
const { Engine } = await import("../engine.ts");
const { default: app, BoardSnap } = await import("../index.ts");

const MIG = new URL("../../migrations/", import.meta.url);
const enc = new TextEncoder(), dec = new TextDecoder();
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const hooks = { beforeRun: null as null | ((sql: string) => void) };
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => { hooks.beforeRun?.(sql); return /\breturning\b/i.test(sql) ? { success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} } : run1(sql, args); },
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = ss.map(s => /^\s*select/i.test(s.sql) || /\breturning\b/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; } },
    exec: async (sql: string) => { db.exec(sql); return { count: 1 }; },
  } as unknown as D1Database;
  return { db, D1, hooks };
}
// 가짜 R2: etag(쓸 때마다 새로) · onlyIf.etagMatches(안 맞으면 null) · list(prefix · cursor · limit)
function r2() {
  const m = new Map<string, { b: Uint8Array; http?: R2HTTPMetadata; custom?: Record<string, string>; etag: string }>();
  const hooks = { beforePut: null as null | ((k: string) => void) };
  let n = 0;
  const bytes = (x: unknown) => typeof x === "string" ? enc.encode(x) : x instanceof ArrayBuffer ? new Uint8Array(x) : new Uint8Array((x as Uint8Array).buffer, (x as Uint8Array).byteOffset, (x as Uint8Array).byteLength).slice();
  const meta = (k: string, v: { b: Uint8Array; http?: R2HTTPMetadata; custom?: Record<string, string>; etag: string }) => ({ key: k, size: v.b.length, etag: v.etag, httpMetadata: v.http || {}, customMetadata: v.custom || {} });
  const bucket = {
    put: async (k: string, body: unknown, o: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string>; onlyIf?: { etagMatches?: string } } = {}) => {
      hooks.beforePut?.(k);
      if (o.onlyIf?.etagMatches && m.get(k)?.etag !== o.onlyIf.etagMatches) return null;
      const v = { b: bytes(body), http: o.httpMetadata, custom: o.customMetadata, etag: "e" + ++n }; m.set(k, v); return meta(k, v);
    },
    head: async (k: string) => { const v = m.get(k); return v ? meta(k, v) : null; },
    get: async (k: string, o?: { range?: { offset: number; length: number } }) => {
      const v = m.get(k); if (!v) return null;
      const b = o?.range ? v.b.slice(o.range.offset, o.range.offset + o.range.length) : v.b;
      return { ...meta(k, v), body: new Response(b.slice()).body, arrayBuffer: async () => b.slice().buffer, text: async () => dec.decode(b), json: async () => JSON.parse(dec.decode(b)) };
    },
    list: async (o: { prefix?: string; cursor?: string; limit?: number }) => {
      const keys = [...m.keys()].filter(k => k.startsWith(o.prefix || "")).sort(), from = o.cursor ? Number(o.cursor) : 0, lim = o.limit || 1000;
      const page = keys.slice(from, from + lim);
      return { objects: page.map(k => meta(k, m.get(k)!)), delimitedPrefixes: [], truncated: from + lim < keys.length, cursor: String(from + lim) };
    },
    delete: async (k: string) => { m.delete(k); },
  };
  return { m, hooks, bucket: bucket as unknown as R2Bucket };
}
const k32 = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const KEK = k32(), CK = k32(), ADMIN = "admin-token-made-up-0123456789", OWNER = "owner@example.test", MEMBER = "a@example.test";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const TOK = "bxa_" + "m".repeat(40);

function snapNs() {
  const cells = new Map<string, any>();
  const ctx = () => { const s = new DatabaseSync(":memory:"); return {
    storage: { sql: { exec: (q: string, ...a: unknown[]) => { const p = s.prepare(q); if (/^\s*(select|with)/i.test(q)) { const rows = p.all(...(a as never[])); return { toArray: () => rows, rowsWritten: 0 }; } const r = p.run(...(a as never[])); return { toArray: () => [], rowsWritten: Number(r.changes) }; } } },
    getWebSockets: () => [], setWebSocketAutoResponse() {}, waitUntil() {}, blockConcurrencyWhile: (f: () => unknown) => f(),
  }; };
  const rpc = (o: any) => new Proxy(o, { get: (t, k) => typeof t[k] === "function" ? async (...a: unknown[]) => t[k](...a) : t[k] });
  return { idFromName: (n: string) => n, get: (n: string) => { if (!cells.has(n)) cells.set(n, rpc(new (BoardSnap as any)(ctx(), {}))); return cells.get(n); } };
}
// 엔진 DO 이름표: dev:<기기> 마다 진짜 Engine(가짜 저장 · 소켓 없음)
function engineNs(env: () => any) {
  const cells = new Map<string, { eng: any; kv: Map<string, unknown> }>();
  const make = (name: string) => {
    const kv = new Map<string, unknown>();
    const ctx = { setWebSocketAutoResponse() {}, getWebSockets: () => [], waitUntil() {},
      storage: { get: async (k: string) => structuredClone(kv.get(k)), put: async (k: string, v: unknown) => { kv.set(k, structuredClone(v)); }, delete: async (k: string) => kv.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {}, getAlarm: async () => null } };
    kv.set("who", { device: name.slice(4), owner: MEMBER, harness: false });
    return { eng: new (Engine as any)(ctx, env()), kv };
  };
  return { cells, idFromName: (n: string) => n, get: (n: string) => { if (!cells.has(n)) cells.set(n, make(n)); return cells.get(n)!.eng; } };
}

const flagOn = (db: DatabaseSync, on: boolean) => { db.prepare("UPDATE f7_flag SET on_at = ? WHERE name = 'envelope'").run(on ? Date.now() : null); V._resetVaultCache(); };
async function setup() {
  V._resetVaultCache();
  const t = d1(), R = r2(), T = Date.now();
  let env: any;
  const ENGINE = engineNs(() => env);
  env = { DB: t.D1, RESULTS: R.bucket, CONNECTOR_KEY: CK, DATA_KEK_CUR: "1", DATA_KEK_1: KEK, ADMIN_TOKEN: ADMIN, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test", BETTER_AUTH_SECRET: "x", SNAP: snapNs(), ENGINE };
  flagOn(t.db, true);
  const db = t.db;
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, T);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devA0000001", MEMBER, "laptop", "", "h1", T, T, "full", T);
  db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, owner, tools) VALUES (?,?,?,?,?,?, '*')").run(await sha(TOK), "ew_x", "창", "laptop", T, MEMBER);
  const conn = db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, created_at, updated_at) VALUES (?,?,?,?, 'api', 'u', ?, '', 'ok', 0, 0)");
  conn.run("c_v1", MEMBER, "acme", "a", await legacySeal(CK, { key: "key-v1-plain" }));
  conn.run("c_v2", MEMBER, "acme", "b", await sealSecret(env, MEMBER, { tbl: "connection", pk: "c_v2", col: "auth" }, { key: "key-v2" }));
  conn.run("c_empty", MEMBER, "acme", "c", "");
  db.prepare("INSERT INTO connection_pending(state, owner, service, label, url, auth, back, bind, expires_at) VALUES (?,?,?,?,?,?,?,?,?)").run("st_1", MEMBER, "acme", "", "u", await legacySeal(CK, { verifier: "pkce-verifier-1" }), "#", "b", T + 600_000);
  const hook = db.prepare("INSERT INTO hook(id, owner, name, preset, service, verify, secret, secret_hash, target, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  hook.run("wh_1", MEMBER, "h1", "generic", "", "{}", await legacySeal(CK, { s: "whsec_hook_one" }), "", "t", T);
  hook.run("wh_2", MEMBER, "h2", "generic", "", "{}", "", "hash", "t", T);
  // R2: 세션 조각(평문 · 봉함) · 도구 결과(주인 있는 평문 · 토큰이 지워진 평문)
  await R.bucket.put(`sessions/${MEMBER}/claude-code%3Aabc/00000.json`, JSON.stringify([{ role: "user", at: 1, text: "평문 세션 질문" }]), { httpMetadata: { contentType: "application/json" } });
  await sessions.putPart(env, MEMBER, `sessions/${MEMBER}/claude-code%3Aabc/00001.json`, JSON.stringify([{ role: "assistant", at: 2, text: "봉한 세션 답" }]));
  const tk = (await sha(TOK)).slice(0, 32);
  await R.bucket.put(`mcp-results/${tk}/0123456789abcdef0123456789abcdef.txt`, "평문 도구 결과", { httpMetadata: { contentType: "text/plain; charset=utf-8" }, customMetadata: { agent: "a" } });
  await R.bucket.put(`mcp-results/${"f".repeat(32)}/fedcba9876543210fedcba9876543210.txt`, "주인 없는 결과", { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  // DO: 엔진 밀린 글(평문 배열) · rid 답(평문 base64)
  ENGINE.get("dev:devA0000001");
  ENGINE.cells.get("dev:devA0000001")!.kv.set("pending", [{ id: "ew_1", text: "[Boarder chat] 평문 밀린 글", at: T, k: "k1" }]);
  const cell = ridCell(env, MEMBER) as any;
  await cell.claim("rmig-0001", "/api/chat"); await cell.done("rmig-0001", 200, btoa('{"ok":true,"ts":"1.2"}'), "application/json", "");
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} } as any);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  const adm = { authorization: "Bearer " + ADMIN };
  return { ...t, R, env, ENGINE, cell, call, adm };
}

// 읽는 길이 돌려주는 것(쓰는 길과 같은 함수) — 옮기기 앞 · 뒤 · 되돌린 뒤에 같아야 함
async function observe(s: Awaited<ReturnType<typeof setup>>) {
  const { env, db, call, ENGINE, cell } = s;
  const conns = [];
  for (const id of ["c_v1", "c_v2", "c_empty"]) conns.push(await store.apiAuth(env, (await store.get(env, MEMBER, id))!));
  const pend = await openSecret(env, MEMBER, { tbl: "connection_pending", pk: "st_1", col: "auth" }, (db.prepare("SELECT auth FROM connection_pending").get() as any).auth);
  const hooks = [];
  for (const r of db.prepare("SELECT id, secret FROM hook ORDER BY id").all() as any[]) hooks.push(await openSecret(env, MEMBER, { tbl: "hook", pk: r.id, col: "secret" }, r.secret));
  const sess = await sessions.handoff(env, MEMBER, "claude-code:abc").catch(() => null);
  const parts = [await sessions.getPart(env, MEMBER, `sessions/${MEMBER}/claude-code%3Aabc/00000.json`), await sessions.getPart(env, MEMBER, `sessions/${MEMBER}/claude-code%3Aabc/00001.json`)];
  const mcp = await call("GET", "/api/agent/result/0123456789abcdef0123456789abcdef", undefined, { authorization: "Bearer " + TOK });
  const eng = await ENGINE.get("dev:devA0000001").q("pending");
  const v = await cell.ridBody("rmig-0001"), rid = V.isSealed(v) ? await V.openField(env, MEMBER, { tbl: "rids", pk: "rmig-0001", col: "body" }, v) : v;
  return { conns, pend, hooks, sess, parts, mcp: [mcp.status, mcp.text], eng, rid };
}
const plainDump = (s: Awaited<ReturnType<typeof setup>>) => [
  ...[...s.R.m.entries()].map(([k, v]) => k + dec.decode(v.b)),
  JSON.stringify(s.ENGINE.cells.get("dev:devA0000001")!.kv.get("pending")),
].join("\n");

test("plan · run · back 왕복: 섞인 평문 · v1 · v2 → 모두 v2 → 옛 꼴, 읽는 답은 셋 다 같음 · 두 번 돌려도 같음", async () => {
  const s = await setup(), { call, adm, db } = s;
  const before = await observe(s);
  assert.equal(before.mcp[0], 200);
  // plan(쓰지 않음)
  const p0 = Object.fromEntries(await Promise.all(M.scopes().map(async sc => [sc, (await call("GET", `/api/admin/vault?scope=${sc}`, undefined, adm)).j.plan])));
  assert.deepEqual(p0.connection, { auth: { plain: 0, v1: 1, v2: 1, empty: 1 } });
  assert.deepEqual(p0.hook, { secret: { plain: 0, v1: 1, v2: 0, empty: 1 } });
  assert.deepEqual(p0.sessions, { plain: 1, v1: 0, v2: 1, empty: 0 });
  assert.deepEqual(p0["mcp-results"], { plain: 2, v1: 0, v2: 0, empty: 0 });
  assert.equal(p0.engine.plain, 1); assert.deepEqual(p0.rids, { plain: 1, v1: 0, v2: 0, empty: 0 });
  assert.equal((await call("GET", "/api/admin/vault?scope=connection")).status, 403, "관리 토큰 없으면 403");
  assert.equal((await call("GET", "/api/admin/vault?scope=nope", undefined, adm)).status, 400);
  // dryRun 은 아무것도 안 씀
  const dry = (await call("POST", "/api/admin/vault", { action: "run", scope: "connection", dryRun: true }, adm)).j;
  assert.equal(dry.done, 1); assert.equal(dry.dryRun, true);
  assert.match((db.prepare("SELECT auth FROM connection WHERE id = 'c_v1'").get() as any).auth, /^v1\./);
  // 켜진 채 back 은 거절
  assert.equal((await call("POST", "/api/admin/vault", { action: "back", scope: "connection" }, adm)).status, 409);
  // run
  const ran: Record<string, any> = {};
  for (const sc of M.scopes()) ran[sc] = (await call("POST", "/api/admin/vault", { action: "run", scope: sc, page: 2 }, adm)).j;   // 쪽 크기 2 → 쪽 넘김도
  assert.deepEqual([ran.connection.done, ran.connection.skipped, ran.connection.failed], [1, 2, []]);
  assert.deepEqual([ran.connection_pending.done, ran.hook.done, ran.hook.skipped], [1, 1, 1]);
  assert.deepEqual([ran.sessions.done, ran.sessions.skipped], [1, 1]);
  assert.equal(ran["mcp-results"].done, 1); assert.equal(ran["mcp-results"].failed.length, 1, "토큰 없는 결과는 그 하나만 failed");
  assert.match(ran["mcp-results"].failed[0].error, /주인 모름/);
  assert.deepEqual([ran.engine.done, ran.rids.done], [1, 1]);
  for (const sc of M.scopes()) if (sc !== "mcp-results") assert.deepEqual(ran[sc].failed, [], sc);
  const after = await observe(s);
  assert.deepEqual(after, before, "옮긴 뒤 읽는 답이 같아야 함");
  const dump = plainDump(s);
  for (const p of ["평문 세션 질문", "평문 도구 결과", "평문 밀린 글"]) assert.ok(!dump.includes(p), `덤프에 「${p}」`);
  assert.ok(dump.includes("주인 없는 결과"), "주인 모르는 몸통은 그대로");
  assert.match(String(await s.cell.ridBody("rmig-0001")), /^v2\./);
  assert.ok(!(db.prepare("SELECT 1 FROM connection WHERE auth LIKE 'v1.%' UNION ALL SELECT 1 FROM hook WHERE secret LIKE 'v1.%' UNION ALL SELECT 1 FROM connection_pending WHERE auth LIKE 'v1.%'").get()), "v1 남음");
  // 두 번 돌려도 같음
  for (const sc of M.scopes()) assert.equal((await call("POST", "/api/admin/vault", { action: "run", scope: sc }, adm)).j.done, 0, sc);
  // 끄고 되돌리기
  flagOn(db, false);
  assert.equal((await call("POST", "/api/admin/vault", { action: "run", scope: "connection" }, adm)).status, 409, "꺼진 채 run 은 거절");
  for (const sc of M.scopes()) { const b = (await call("POST", "/api/admin/vault", { action: "back", scope: sc }, adm)).j; if (sc !== "mcp-results") assert.deepEqual(b.failed, [], sc); }
  assert.deepEqual(await observe(s), before, "되돌린 뒤 읽는 답이 같아야 함");
  const p2 = (await call("GET", "/api/admin/vault?scope=connection", undefined, adm)).j.plan;
  assert.deepEqual(p2, { auth: { plain: 0, v1: 2, v2: 0, empty: 1 } }, "커넥터 비밀은 v1 으로");
  assert.equal(dec.decode(s.R.m.get(`sessions/${MEMBER}/claude-code%3Aabc/00001.json`)!.b), JSON.stringify([{ role: "assistant", at: 2, text: "봉한 세션 답" }]));
  assert.equal(s.R.m.get(`sessions/${MEMBER}/claude-code%3Aabc/00001.json`)!.custom?.vault, undefined);
  assert.ok(Array.isArray(s.ENGINE.cells.get("dev:devA0000001")!.kv.get("pending")));
  assert.equal(await s.cell.ridBody("rmig-0001"), btoa('{"ok":true,"ts":"1.2"}'));
});

test("CAS: 옮기는 사이 줄 · 몸통 · 밀린 글이 바뀌면 안 쓰고 changed — 바뀐 값은 그대로", async () => {
  const s = await setup();
  const newer = await legacySeal(CK, { key: "rotated-while-migrating" });
  s.hooks.beforeRun = sql => { if (/^UPDATE connection SET auth/.test(sql)) { s.hooks.beforeRun = null; s.db.prepare("UPDATE connection SET auth = ? WHERE id = 'c_v1'").run(newer); } };
  const r = await M.run(s.env, "connection");
  assert.deepEqual([r.done, r.changed, r.failed], [0, 1, []]);
  assert.equal((s.db.prepare("SELECT auth FROM connection WHERE id = 'c_v1'").get() as any).auth, newer);
  assert.equal((await M.run(s.env, "connection")).done, 1, "다음 번엔 새 값을 옮김");
  const k = `sessions/${MEMBER}/claude-code%3Aabc/00000.json`;
  s.R.hooks.beforePut = key => { if (key === k) { s.R.hooks.beforePut = null; s.R.m.set(k, { ...s.R.m.get(k)!, b: enc.encode('[{"role":"user","at":1,"text":"그새 바뀐 조각"}]'), etag: "changed" }); } };
  const r2 = await M.run(s.env, "sessions");
  assert.deepEqual([r2.done, r2.changed], [0, 1]);
  assert.equal(dec.decode(s.R.m.get(k)!.b), '[{"role":"user","at":1,"text":"그새 바뀐 조각"}]');
  // 엔진: 줄을 읽은 뒤 쓰기 전에 새 글이 줄 섬 → 안 씀(새 글이 사라지지 않음)
  const eng = s.ENGINE.get("dev:devA0000001"), kv = s.ENGINE.cells.get("dev:devA0000001")!.kv, get = eng.ctx.storage.get;
  let n = 0;
  eng.ctx.storage.get = async (k: string) => { const v = await get(k); if (k === "pending" && ++n === 1) kv.set("pending", [...(v as unknown[]), { id: "ew_2", text: "그새 선 글", at: 1, k: "k2" }]); return v; };
  const r3 = await M.run(s.env, "engine");
  eng.ctx.storage.get = get;
  assert.deepEqual([r3.done, r3.changed], [0, 1]);
  assert.equal((kv.get("pending") as unknown[]).length, 2);
  // rid: 바꾸는 순간 다른 값이면 안 씀
  const cell = s.cell, ctx = cell.ctx, changed = btoa('{"ok":true,"ts":"9.9"}');   // 바꾸기 바로 앞에 다른 요청이 같은 rid 답을 새로 남김
  cell.ridSwap = async (rid: string, old: string, neu: string) => { delete cell.ridSwap; ctx.storage.sql.exec("UPDATE rids SET body=? WHERE rid=?", changed, rid); return (BoardSnap as any).prototype.ridSwap.call({ ctx }, rid, old, neu); };
  assert.deepEqual([(await M.run(s.env, "rids")).changed], [1]);
  assert.equal(await cell.ridBody("rmig-0001"), changed);
});

test("깨진 줄은 그 줄만 failed — 나머지는 옮겨지고 깨진 값은 그대로", async () => {
  const s = await setup();
  const bad = "v1." + "A".repeat(48);   // 꼴은 v1 인데 CONNECTOR_KEY 로 안 열림
  s.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, created_at, updated_at) VALUES ('c_bad', ?, 'acme', 'z', 'api', 'u', ?, '', 'ok', 0, 0)").run(MEMBER, bad);
  s.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, created_at, updated_at) VALUES ('c_plain', ?, 'acme', 'y', 'api', 'u', '{\"key\":\"x\"}', '', 'ok', 0, 0)").run(MEMBER);
  const r = await M.run(s.env, "connection");
  assert.equal(r.done, 1, "c_v1 은 옮겨짐");
  assert.deepEqual(r.failed.map(f => f.key).sort(), ["connection:c_bad", "connection:c_plain"]);
  assert.match(r.failed.find(f => f.key === "connection:c_plain")!.error, /평문 비밀/);
  assert.equal((s.db.prepare("SELECT auth FROM connection WHERE id = 'c_bad'").get() as any).auth, bad);
  assert.match((s.db.prepare("SELECT auth FROM connection WHERE id = 'c_v1'").get() as any).auth, /^v2\./);
  // R2: 봉한 표인데 깨진 몸통 → back 에서 그 하나만 failed
  await M.run(s.env, "sessions");
  const k = `sessions/${MEMBER}/claude-code%3Aabc/00001.json`, o = s.R.m.get(k)!;
  o.b = o.b.slice(0, o.b.length - 5);
  flagOn(s.db, false);
  const b = await M.back(s.env, "sessions");
  assert.deepEqual([b.done, b.failed.map(f => f.key)], [1, [k]]);
});

// ── 사람별 스위치(envelope:<owner || owner>) ─────────────────────────
const B = "b@example.test";
async function perPerson() {
  const s = await setup();
  flagOn(s.db, false);   // 모두 스위치 끔 — 아래에서 사람별로만
  const T = Date.now();
  s.db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(B, OWNER, T);
  s.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devOwner001", OWNER, "owner mac", "", "h2", T, T, "full", T);
  s.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, created_at, updated_at) VALUES ('c_b1', ?, 'acme', 'a', 'api', 'u', ?, '', 'ok', 0, 0)").run(B, await legacySeal(CK, { key: "key-b" }));
  await s.R.bucket.put(`sessions/${B}/claude-code%3Abbb/00000.json`, JSON.stringify([{ role: "user", at: 1, text: "B 의 평문 세션" }]));
  const flag = async (name: string, on: boolean) => (await s.call("POST", "/api/admin/f7-flag", { name, on }, s.adm));
  return { ...s, flag };
}

test("사람별 스위치: A 만 켜면 A 의 새 값만 봉하고 B · x: 주인은 평문/v1 — 둘 다 읽힘, 주인은 envelope:owner", async () => {
  const s = await perPerson(), { env, flag, ENGINE } = s;
  assert.equal((await flag("envelope:" + MEMBER.toUpperCase(), true)).status, 200, "메일은 소문자로 맞춤");
  assert.ok(s.db.prepare("SELECT 1 FROM f7_flag WHERE name = ? AND on_at IS NOT NULL").get("envelope:" + MEMBER));
  assert.equal(await V.envelopeOn(env, MEMBER), true);
  assert.equal(await V.envelopeOn(env, B), false);
  assert.equal(await V.envelopeOn(env, "x:x_chan01"), false, "x: 주인은 모두 스위치만");
  assert.equal(await V.envelopeOn(env, null), false);
  const a = await sealSecret(env, MEMBER, { tbl: "connection", pk: "c_a9", col: "auth" }, { key: "ka" });
  const b = await sealSecret(env, B, { tbl: "connection", pk: "c_b9", col: "auth" }, { key: "kb" });
  assert.match(a, /^v2\./); assert.match(b, /^v1\./);
  assert.deepEqual(await openSecret(env, MEMBER, { tbl: "connection", pk: "c_a9", col: "auth" }, a), { key: "ka" });
  assert.deepEqual(await openSecret(env, B, { tbl: "connection", pk: "c_b9", col: "auth" }, b), { key: "kb" });
  assert.equal(await V.sealField(env, B, { tbl: "t", pk: "1", col: "c" }, "B 글"), "B 글");
  assert.equal(await V.sealField(env, "x:x_chan01", { tbl: "t", pk: "r", col: "text" }, "채널 글"), "채널 글");
  // 주인(''): envelope:owner — 주인 기기의 엔진 DO(기기 주인 = 주인 메일)도 같은 스위치를 봄
  assert.equal(await V.envelopeOn(env, ""), false);
  await flag("envelope:owner", true);
  assert.equal(await V.envelopeOn(env, ""), true);
  const own = ENGINE.get("dev:devOwner001"), okv = ENGINE.cells.get("dev:devOwner001")!.kv;
  okv.set("who", { device: "devOwner001", owner: OWNER, harness: true });
  await own.qput("hpending", [{ id: "ew_p", text: "주인 창 글", at: 1, k: "k" }]);
  assert.ok(!Array.isArray(okv.get("hpending")) && !JSON.stringify(okv.get("hpending")).includes("주인 창 글"), "주인 기기 줄은 봉함");
  assert.deepEqual((await own.q("hpending")).map((x: any) => x.text), ["주인 창 글"]);
  const mem = ENGINE.get("dev:devA0000001");   // 회원 A(켜짐)
  await mem.qput("pending", [{ id: "ew_1", text: "A 창 글", at: 1, k: "k" }]);
  assert.ok(!Array.isArray(ENGINE.cells.get("dev:devA0000001")!.kv.get("pending")));
  // 이름 꼴
  assert.equal((await flag("envelope", false)).status, 200);
  assert.equal((await flag("envelope:not-an-email", true)).status, 400);
  assert.equal((await flag("envelopes", true)).status, 400);
});

test("사람별 옮기기: owner 를 주면 그 사람 것만 · 꺼진 사람 run 409 · 켜진 사람 back 409 · plan 도 그 사람만", async () => {
  const s = await perPerson(), { call, adm, flag, db } = s;
  await flag("envelope:" + MEMBER, true);
  const pa = (await call("GET", `/api/admin/vault?scope=connection&owner=${encodeURIComponent(MEMBER)}`, undefined, adm)).j;
  assert.equal(pa.envelope, true); assert.deepEqual(pa.plan, { auth: { plain: 0, v1: 1, v2: 1, empty: 1 } });
  assert.deepEqual((await call("GET", `/api/admin/vault?scope=connection&owner=${B}`, undefined, adm)).j.plan, { auth: { plain: 0, v1: 1, v2: 0, empty: 0 } });
  assert.equal((await call("POST", "/api/admin/vault", { action: "run", scope: "connection", owner: B }, adm)).status, 409, "B 는 꺼짐");
  assert.equal((await call("POST", "/api/admin/vault", { action: "run", scope: "connection" }, adm)).status, 409, "owner 없으면 모두 스위치");
  const ra = (await call("POST", "/api/admin/vault", { action: "run", scope: "connection", owner: MEMBER }, adm)).j;
  assert.deepEqual([ra.done, ra.failed], [1, []]);
  assert.match((db.prepare("SELECT auth FROM connection WHERE id = 'c_v1'").get() as any).auth, /^v2\./);
  assert.match((db.prepare("SELECT auth FROM connection WHERE id = 'c_b1'").get() as any).auth, /^v1\./, "B 는 그대로");
  const rs = (await call("POST", "/api/admin/vault", { action: "run", scope: "sessions", owner: MEMBER }, adm)).j;
  assert.equal(rs.done, 1);
  assert.equal(s.R.m.get(`sessions/${B}/claude-code%3Abbb/00000.json`)!.custom?.vault, undefined, "B 세션은 그대로");
  assert.deepEqual(await store.apiAuth(s.env, (await store.get(s.env, B, "c_b1"))!), { key: "key-b" });
  assert.deepEqual(await store.apiAuth(s.env, (await store.get(s.env, MEMBER, "c_v1"))!), { key: "key-v1-plain" });
  // 엔진 · rid 도 그 사람 것만
  assert.equal((await call("POST", "/api/admin/vault", { action: "run", scope: "engine", owner: MEMBER }, adm)).j.done, 1);
  assert.equal((await call("POST", "/api/admin/vault", { action: "run", scope: "rids", owner: MEMBER }, adm)).j.done, 1);
  // back: 켜진 채 409 → 끄고 그 사람만
  assert.equal((await call("POST", "/api/admin/vault", { action: "back", scope: "connection", owner: MEMBER }, adm)).status, 409);
  await flag("envelope:" + MEMBER, false);
  const ba = (await call("POST", "/api/admin/vault", { action: "back", scope: "connection", owner: MEMBER }, adm)).j;
  assert.deepEqual([ba.done, ba.failed], [2, []], "옮긴 것 + 처음부터 v2 였던 것");
  assert.deepEqual((await call("GET", `/api/admin/vault?scope=connection&owner=${MEMBER}`, undefined, adm)).j.plan, { auth: { plain: 0, v1: 2, v2: 0, empty: 1 } });
});

test("옮기는 중 스위치가 꺼지면: 봉하지 않은 값은 쓰지 않고 failed — v1 비밀 자리에 평문 JSON 이 안 들어감", async () => {
  const s = await setup();
  const before = (s.db.prepare("SELECT auth FROM connection WHERE id = 'c_v1'").get() as any).auth;
  flagOn(s.db, false);   // 관리 길(409)을 지나 run 이 돈 뒤 꺼진 것과 같음
  const r = await M.run(s.env, "connection");
  assert.equal(r.done, 0);
  assert.deepEqual(r.failed.map(f => f.key), ["connection:c_v1"]);
  assert.match(r.failed[0].error, /봉하지 않은 값/);
  assert.equal((s.db.prepare("SELECT auth FROM connection WHERE id = 'c_v1'").get() as any).auth, before);
  assert.deepEqual(await store.apiAuth(s.env, (await store.get(s.env, MEMBER, "c_v1"))!), { key: "key-v1-plain" });
});

test("e2e 사람의 envelope:<owner> 는 관리 길로 못 끔(409)", async () => {
  const s = await perPerson();
  await V.adoptE2e(s.env, B, "client-wrapped");
  assert.equal((await s.flag("envelope:" + B, false)).status, 409);
  assert.equal(await V.envelopeOn(s.env, B), true);
  assert.equal((await s.flag("envelope:" + MEMBER, false)).status, 200, "다른 사람은 끌 수 있음");
});

// ── 등록표(registerScope): 공개 판엔 코어 scope 만 · 호스팅 전용 표는 ee 가 hosted.vaultScopes 로 넣을 때만 있음
test("공개 판 scope: 코어 D1 넷(커넥터 셋 · better-auth account) + R2 둘 + DO 둘만 — 관리 길도 등록한 것만 받음", async () => {
  assert.deepEqual(M.scopes(), ["connection", "connection_pending", "hook", "account", "sessions", "mcp-results", "engine", "rids"]);
  const s = await setup();
  const r = await s.call("GET", "/api/admin/vault?scope=nope_tbl", undefined, s.adm);
  assert.equal(r.status, 400); assert.ok(!r.text.includes("nope_tbl"), r.text);
  await assert.rejects(M.run(s.env, "nope"), /없는 scope/);
  assert.throws(() => M.registerScope("connection", { key: "id", cols: ["auth"], kind: "secret", owner: () => "", pk: () => "" }), /이미 있음/);
  assert.throws(() => M.registerScope("bad name", { key: "id", cols: ["x"], kind: "text", owner: () => "", pk: () => "" }), /꼴/);
});

test("등록한 D1 표(genPk · whoSql): 빈 pk 칸은 봉할 때 채움 · 사람별 · 되돌리기 · 관리 길에 나타남", async () => {
  const s = await setup();
  s.db.exec("CREATE TABLE mig_note (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, body TEXT NOT NULL, nk TEXT UNIQUE)");
  if (!M.scopes().includes("mig_note")) M.registerScope("mig_note", { key: "id", cols: ["body"], kind: "text", owner: r => "x:" + r.room, pk: r => r.nk, whoSql: "'x:' || room = ?", genPk: { col: "nk", make: () => "n_" + crypto.randomUUID().slice(0, 8) } });
  s.db.prepare("INSERT INTO mig_note(room, body, nk) VALUES ('r1', '방 글 하나', NULL), ('r1', 'v2.1.' || ?, NULL), ('r2', '다른 방 글', NULL)").run("A".repeat(40));
  assert.ok(M.scopes().includes("mig_note"));
  assert.deepEqual((await s.call("GET", "/api/admin/vault?scope=mig_note&owner=x:r1", undefined, s.adm)).j.plan, { body: { plain: 1, v1: 0, v2: 1, empty: 0 } }, "봉한 꼴 평문은 꼴만 보면 v2 로 셈");
  s.db.prepare("UPDATE mig_note SET body = ? WHERE id = 2").run(V.escapeField("v2.1." + "A".repeat(40)));   // 쓰는 길은 이렇게 감싸 둠
  const r = await M.run(s.env, "mig_note", { owner: "x:r1" });
  assert.deepEqual([r.done, r.failed], [2, []]);
  const rows = s.db.prepare("SELECT id, room, body, nk FROM mig_note ORDER BY id").all() as any[];
  for (const x of rows.slice(0, 2)) { assert.match(x.body, /^v2\./); assert.match(x.nk, /^n_/); }
  assert.equal(rows[2].body, "다른 방 글"); assert.equal(rows[2].nk, null, "다른 방은 안 건드림");
  assert.equal(await V.openField(s.env, "x:r1", { tbl: "mig_note", pk: rows[1].nk, col: "body" }, rows[1].body), "v2.1." + "A".repeat(40));
  flagOn(s.db, false);
  assert.deepEqual((await M.back(s.env, "mig_note")).failed, []);
  assert.deepEqual((s.db.prepare("SELECT body FROM mig_note ORDER BY id").all() as any[]).map(x => x.body), ["방 글 하나", V.escapeField("v2.1." + "A".repeat(40)), "다른 방 글"]);
});
