// node --test --no-warnings --experimental-transform-types apps/web/worker/vault/wired.test.ts (Node 22.18+ · node:sqlite · apps/web 의존성 설치된 채)
// 봉투 암호화를 붙인 길: 커넥터 비밀 · 세션 조각(R2) · 도구 결과(R2) · 첨부 Range(R2) · rid 답(BoardSnap) · 엔진 밀린 글(Engine DO).
// 길마다: 스위치를 켜면 D1 · R2 · DO 덤프에 평문이 없고, 답(HTTP · 함수 결과)은 스위치를 끈 때와 같음. 옛 줄(평문 · v1)도 그대로 읽힘.
// 진짜 index.ts(app.fetch) · engine.ts · files.ts · store.ts 그대로, 가짜 D1 = 메모리 SQLite + migrations 전부, 가짜 R2 = 메모리 Map. 자료 · 키는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("../test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const V = await import("./index.ts");
const { sealSecret, openSecret } = await import("./secret.ts");
const { seal: legacySeal } = await import("../connectors/seal.ts");
const store = await import("../connectors/store.ts");
const sessions = await import("../connectors/sessions.ts");
const files = await import("../files.ts");
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
    first: async (col?: string) => { hooks.beforeRun?.(sql); const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => { hooks.beforeRun?.(sql); return /\breturning\b/i.test(sql) ? { success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} } : run1(sql, args); },
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => {
      db.exec("BEGIN");
      try { const out = ss.map(s => /^\s*select/i.test(s.sql) || /\breturning\b/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return out; }
      catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },
    exec: async (sql: string) => { db.exec(sql); return { count: 1 }; },
  } as unknown as D1Database;
  return { db, D1, hooks };
}
const dumpDb = (db: DatabaseSync) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
  .map(t => JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all())).join("\n");
// 가짜 R2: put 몸통 · 메타, get(range) 는 읽은 바이트 수를 셈(Range 가 필요한 조각만 받는지)
function r2() {
  const m = new Map<string, { b: Uint8Array; http?: R2HTTPMetadata; custom?: Record<string, string> }>(), reads = { bytes: 0, calls: 0 };
  const bytes = (x: unknown) => typeof x === "string" ? enc.encode(x) : x instanceof ArrayBuffer ? new Uint8Array(x) : new Uint8Array((x as Uint8Array).buffer, (x as Uint8Array).byteOffset, (x as Uint8Array).byteLength).slice();
  const obj = (v: { http?: R2HTTPMetadata; custom?: Record<string, string> }, b: Uint8Array, size: number) => ({ size, httpMetadata: v.http || {}, customMetadata: v.custom || {},
    body: new Response(b.slice()).body, arrayBuffer: async () => b.slice().buffer, text: async () => dec.decode(b), json: async () => JSON.parse(dec.decode(b)) });
  const bucket = {
    put: async (k: string, body: unknown, o: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> } = {}) => { m.set(k, { b: bytes(body), http: o.httpMetadata, custom: o.customMetadata }); return {}; },
    head: async (k: string) => { const v = m.get(k); return v ? { size: v.b.length, httpMetadata: v.http || {}, customMetadata: v.custom || {} } : null; },
    get: async (k: string, o?: { range?: { offset: number; length: number } }) => {
      const v = m.get(k); if (!v) return null;
      const b = o?.range ? v.b.slice(o.range.offset, o.range.offset + o.range.length) : v.b;
      reads.bytes += b.length; reads.calls++;
      return obj(v, b, v.b.length);
    },
    delete: async (k: string) => { m.delete(k); },
  };
  return { m, reads, bucket: bucket as unknown as R2Bucket };
}
const k32 = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const KEK = k32(), CK = k32();
function base(on: boolean) {
  V._resetVaultCache();
  const t = d1(), R = r2();
  if (on) t.db.prepare("UPDATE f7_flag SET on_at = ? WHERE name = 'envelope'").run(Date.now());
  const env: any = { DB: t.D1, RESULTS: R.bucket, CONNECTOR_KEY: CK, DATA_KEK_CUR: "1", DATA_KEK_1: KEK };
  return { ...t, R, env };
}
const noPlain = (hay: string, ...needles: string[]) => { for (const n of needles) assert.ok(!hay.includes(n), `덤프에 평문 「${n}」`); };

// ── 1. 커넥터 비밀(connection · connection_pending · hook)
test("커넥터 토큰: 켜면 v2(사람별 DEK) · 덤프에 토큰 없음 · 읽는 값은 끈 때와 같음", async () => {
  const out: unknown[] = [];
  for (const on of [false, true]) {
    const { db, env } = base(on);
    const id = await store.upsert(env, "a@example.com", { service: "acme", label: "", kind: "api", url: "https://api.acme.test", auth: { key: "acme-secret-key-123", refresh_token: "acme-refresh-456" } });
    const row = (await store.get(env, "a@example.com", id))!;
    assert.match(row.auth, on ? /^v2\.1\./ : /^v1\./);
    if (on) noPlain(dumpDb(db), "acme-secret-key-123", "acme-refresh-456");
    out.push(await store.apiAuth(env, row));
    // 같은 service · label 을 다시 연결: id 는 그대로, 새 토큰이 열림
    const id2 = await store.upsert(env, "a@example.com", { service: "acme", label: "", kind: "api", url: "https://api.acme.test", auth: { key: "acme-secret-key-789" } });
    assert.equal(id2, id);
    assert.deepEqual(await store.apiAuth(env, (await store.get(env, "a@example.com", id))!), { key: "acme-secret-key-789" });
  }
  assert.deepEqual(out[1], out[0]);
});

test("커넥터 토큰: 읽고 넣는 사이 다른 요청이 같은 줄을 만들면 남은 id 로 다시 봉해 열림", async () => {
  const { db, env, hooks } = base(true);
  hooks.beforeRun = sql => {
    if (!/^\s*INSERT INTO connection\(/.test(sql)) return;
    hooks.beforeRun = null;   // 한 번만: 경쟁 요청이 먼저 같은 (owner, service, label) 줄을 넣음
    db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, created_at, updated_at) VALUES ('c_other0000000000000000', 'a@example.com', 'acme', '', 'api', 'u', 'v1.x', '', 'ok', 0, 0)").run();
  };
  const id = await store.upsert(env, "a@example.com", { service: "acme", label: "", kind: "api", url: "u", auth: { key: "raced-key-1" } });
  assert.equal(id, "c_other0000000000000000");
  assert.deepEqual(await store.apiAuth(env, (await store.get(env, "a@example.com", id))!), { key: "raced-key-1" });
});

test("커넥터 · 대기 · 훅 비밀: 옛 v1 · 빈 값은 켜도 그대로 읽힘, 다른 줄로 옮긴 v2 는 거절", async () => {
  const { db, env } = base(true);
  const old = await legacySeal(CK, { access_token: "old-v1-token" });
  db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, created_at, updated_at) VALUES ('c_legacy000000000000000', 'a@example.com', 'acme', 'x', 'api', 'u', ?, '', 'ok', 0, 0)").run(old);
  const row = (await store.get(env, "a@example.com", "c_legacy000000000000000"))!;
  assert.deepEqual(await store.apiAuth(env, row), { key: undefined });
  assert.deepEqual(await openSecret(env, "a@example.com", { tbl: "connection", pk: row.id, col: "auth" }, old), { access_token: "old-v1-token" });
  assert.deepEqual(await openSecret(env, "a@example.com", { tbl: "connection", pk: row.id, col: "auth" }, ""), {});
  for (const ref of [{ tbl: "connection_pending", pk: "state-abc", col: "auth" }, { tbl: "hook", pk: "wh_x1", col: "secret" }] as const) {
    const s = await sealSecret(env, "a@example.com", ref, { s: "whsec_made_up" });
    assert.match(s, /^v2\./);
    assert.deepEqual(await openSecret(env, "a@example.com", ref, s), { s: "whsec_made_up" });
    await assert.rejects(openSecret(env, "a@example.com", { ...ref, pk: "other" }, s), V.VaultError);
  }
});

// ── 4. R2 세션 조각
test("세션 조각: 켜면 R2 몸통에 대화 없음(vault=1) · handoff 글은 끈 때와 같음 · 옛 평문 조각도 읽힘", async () => {
  const outs: unknown[] = [];
  for (const on of [false, true]) {
    const { db, R, env } = base(on);
    db.prepare("INSERT INTO ai_session(id, owner, tool, native, title, cwd, repo, branch, model, host, win, lines, messages, parts, state, created_at, updated_at) VALUES ('claude-code:abcdef1', 'a@example.com', 'claude-code', 'abcdef1', '제목', '/w', '', '', '', 'h', 'w', 2, 3, 2, '', 0, 0)").run();
    // 조각 0 = 옛 평문(봉함 전 저장), 조각 1 = 이번 길
    await R.bucket.put("sessions/a@example.com/claude-code%3Aabcdef1/00000.json", JSON.stringify([{ role: "user", at: 1, text: "옛 평문 질문" }]));
    await sessions.putPart(env, "a@example.com", "sessions/a@example.com/claude-code%3Aabcdef1/00001.json", JSON.stringify([{ role: "user", at: 2, text: "비밀 설계 질문" }, { role: "assistant", at: 3, text: "비밀 설계 답" }]));
    const o = R.m.get("sessions/a@example.com/claude-code%3Aabcdef1/00001.json")!;
    if (on) { assert.equal(o.custom?.vault, "1"); noPlain(dec.decode(o.b), "비밀 설계"); } else assert.equal(o.custom, undefined);
    outs.push(await sessions.handoff(env, "a@example.com", "claude-code:abcdef1"));
  }
  assert.deepEqual(outs[1], outs[0]);
  assert.match(JSON.stringify(outs[1]), /옛 평문 질문[\s\S]*비밀 설계 답/);
});

// ── 4. R2 첨부(files/) — Range 는 필요한 조각만 받아 풂
test("첨부 Range: 봉한 동영상(vault=1)의 범위 답이 평문 동영상과 바이트 · 머리까지 같고, 필요한 조각만 읽음", async () => {
  const { R, env } = base(true);
  const plain = new Uint8Array(3 * 65536 + 1234), mime = { contentType: "video/mp4" };
  for (let i = 0; i < plain.length; i += 65536) crypto.getRandomValues(plain.subarray(i, i + 65536));   // getRandomValues 는 한 번에 64KiB 까지
  const P = r2(); await P.bucket.put("files/F0PLAIN01", plain, { httpMetadata: mime, customMetadata: { name: "clip.mp4" } });
  const sealed = (await V.sealBlob(env, "", "files/F0PLAIN01", plain)) as Uint8Array;
  assert.notEqual(sealed, plain);
  await R.bucket.put("files/F0PLAIN01", sealed, { httpMetadata: mime, customMetadata: { name: "clip.mp4", vault: "1" } });
  const penv = { ...env, RESULTS: P.bucket };
  for (const range of [undefined, "bytes=0-99", "bytes=65530-65545", "bytes=70000-140000", "bytes=-100", "bytes=196000-", `bytes=${plain.length - 1}-${plain.length - 1}`, `bytes=${plain.length}-`]) {
    const a = await files.answer(penv, "/api/file/F0PLAIN01", range ? { range } : {}), b = await files.answer(env, "/api/file/F0PLAIN01", range ? { range } : {});
    assert.ok(a && b);
    assert.equal(b.status, a.status, String(range)); assert.deepEqual(b.headers, a.headers, String(range)); assert.deepEqual(b.body, a.body, String(range));
  }
  R.reads.bytes = 0;
  await files.answer(env, "/api/file/F0PLAIN01", { range: "bytes=70000-70100" });
  assert.ok(R.reads.bytes < 65536 + 28 + 16 + 100, `조각 하나 + 머리만 읽어야 함(읽음 ${R.reads.bytes})`);
  // 내려받기(동영상 아님)도 같음 · 표 없는 옛 첨부는 지금 그대로
  await R.bucket.put("files/F0DOC0001", (await V.sealBlob(env, "", "files/F0DOC0001", enc.encode("비밀 문서 본문"))) as Uint8Array, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { name: "a.pdf", vault: "1" } });
  await P.bucket.put("files/F0DOC0001", enc.encode("비밀 문서 본문"), { httpMetadata: { contentType: "application/pdf" }, customMetadata: { name: "a.pdf" } });
  const d1o = await files.answer(penv, "/api/file/F0DOC0001", {}), d2o = await files.answer(env, "/api/file/F0DOC0001", {});
  assert.deepEqual(d2o, d1o);
  noPlain(dec.decode(R.m.get("files/F0DOC0001")!.b), "비밀 문서");
});

// ── 4. R2 도구 결과(mcp-results/) · 5. rid 답(BoardSnap rids) — 진짜 app.fetch
const SECRET = "test-secret-not-real", MEMBER = "member@example.test";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function cookie(email: string) {
  const tok = "sess-" + email, th = (await sha(tok)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, enc.encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${tok}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
function snapNs() {
  const cells = new Map<string, any>(), dbs: DatabaseSync[] = [];
  const ctx = () => { const s = new DatabaseSync(":memory:"); dbs.push(s); return {
    storage: { sql: { exec: (q: string, ...a: unknown[]) => { const p = s.prepare(q); if (/^\s*(select|with)/i.test(q)) { const rows = p.all(...(a as never[])); return { toArray: () => rows, rowsWritten: 0 }; } const r = p.run(...(a as never[])); return { toArray: () => [], rowsWritten: Number(r.changes) }; } } },
    getWebSockets: () => [], setWebSocketAutoResponse() {}, waitUntil() {}, blockConcurrencyWhile: (f: () => unknown) => f(),
  }; };
  const rpc = (o: any) => new Proxy(o, { get: (t, k) => typeof t[k] === "function" ? async (...a: unknown[]) => t[k](...a) : t[k] });
  return { dbs, idFromName: (n: string) => n, get: (n: string) => { if (!cells.has(n)) cells.set(n, rpc(new (BoardSnap as any)(ctx(), {}))); return cells.get(n); } };
}
async function appEnv(on: boolean) {
  const b = base(on), T = Date.now(), sent: { id: string; text: string }[] = [], SNAP = snapNs();
  b.db.prepare("INSERT INTO f7_flag(name, on_at) VALUES ('write_queue', ?)").run(T);
  b.db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, "owner@example.test", T);
  b.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devMember01", MEMBER, "laptop", "", "h1", T, T, "full", T);
  b.db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, created_at) VALUES (?,?,?,?,?,?,?)").run("ew_main1", MEMBER, "devMember01", "main", "메인 봇", "idle", T);
  b.db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, owner, tools) VALUES (?,?,?,?,?,?, '*')").run(await sha("bxa_" + "m".repeat(40)), "ew_main1", "메인 봇", "laptop", T, MEMBER);
  const env = { ...b.env, SNAP, ENGINE: { idFromName: (n: string) => n, get: () => ({ deliver: async (id: string, text: string) => { sent.push({ id, text }); return { sent: true }; }, drainCmds: async () => null }) },
    BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: "owner@example.test", PUBLIC_URL: "https://example.test" };
  const waits: Promise<unknown>[] = [];
  const call = async (method: string, path: string, h: Record<string, string>, body?: unknown) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", "x-hb": "1", "sec-fetch-site": "same-origin", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }),
      env, { waitUntil: (p: Promise<unknown>) => { waits.push(p.catch(() => {})); }, passThroughOnException() {} } as any);
    await Promise.all(waits.splice(0));
    return { status: r.status, headers: Object.fromEntries([...r.headers].filter(([k]) => !["date", "server-timing", "x-rid"].includes(k))), rid: r.headers.get("x-rid"), body: new Uint8Array(await r.arrayBuffer()) };
  };
  return { ...b, env, SNAP, sent, call };
}

test("도구 결과(mcp-results): 켜면 R2 몸통 봉함(vault=1) · GET 답은 끈 때와 같음 · 옛 평문도 그대로", async () => {
  const outs: unknown[] = [];
  for (const on of [false, true]) {
    const { R, env, call } = await appEnv(on);
    const owner = (await sha("bxa_" + "m".repeat(40))).slice(0, 32), id = "0123456789abcdef0123456789abcdef", oldId = "fedcba9876543210fedcba9876543210";
    // 쓰는 길(index.ts store)과 같은 꼴로: 봉함 켜짐이면 sealBlob + vault=1
    const k = `mcp-results/${owner}/${id}.txt`, text = "도구 결과 비밀 줄 ".repeat(5000);
    const body = await V.sealBlob(env, MEMBER, k, text);
    await R.bucket.put(k, body, { httpMetadata: { contentType: "text/plain; charset=utf-8" }, customMetadata: body === text ? { agent: "a" } : { agent: "a", vault: "1" } });
    await R.bucket.put(`mcp-results/${owner}/${oldId}.txt`, "옛 평문 결과", { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
    if (on) noPlain(dec.decode(R.m.get(k)!.b), "도구 결과 비밀");
    const h = { authorization: "Bearer bxa_" + "m".repeat(40) };
    const a = await call("GET", `/api/agent/result/${id}`, h), b = await call("GET", `/api/agent/result/${oldId}`, h);
    assert.equal(dec.decode(a.body), text); assert.equal(dec.decode(b.body), "옛 평문 결과");
    outs.push([a, b]);
  }
  assert.deepEqual(outs[1], outs[0]);
});

test("rid 답(BoardSnap rids.body): 켜면 남긴 답이 v2 · 다시 보낸 쪽 답(replay)은 첫 답 · 끈 때와 같음", async () => {
  const outs: unknown[] = [];
  for (const on of [false, true]) {
    const { SNAP, call } = await appEnv(on);
    const h = { cookie: await cookie(MEMBER) };
    const r1 = await call("POST", "/api/chat", h, { text: "비밀 채팅 한 줄", channel: "primary", rid: "rvault-chat-0001" });
    const r2 = await call("POST", "/api/chat", h, { text: "비밀 채팅 한 줄", channel: "primary", rid: "rvault-chat-0001" });
    assert.equal(r1.rid, "new"); assert.equal(r2.rid, "replay");
    assert.equal(r2.status, r1.status); assert.deepEqual(r2.body, r1.body);
    const rows = SNAP.dbs.flatMap(s => { try { return s.prepare("SELECT body FROM rids").all() as { body: string }[]; } catch { return []; } }).filter(r => r.body);
    assert.ok(rows.length >= 1);
    for (const r of rows) assert.match(r.body, on ? /^v2\./ : /^[A-Za-z0-9+/=]+$/);
    outs.push({ status: r1.status, headers: r1.headers, body: dec.decode(r1.body).replace(/\d{10,}(\.\d+)?/g, "N") });
  }
  assert.deepEqual(outs[1], outs[0]);
});

// ── 5. 엔진 DO 밀린 글(pending · hpending)
function engine(on: boolean, harness = false) {
  const b = base(on), T = Date.now(), DEV = "devMember01";
  b.db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, "owner@example.test", T);
  b.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run(DEV, MEMBER, "laptop", "", "h1", T, T, "full", T);
  b.db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run("ew_role0000001", MEMBER, DEV, "role", "r_1", "일 창", "starting", T, T);
  const got: { id?: string; text?: string }[] = [], kv = new Map<string, unknown>();
  let eng: any, online = true;
  const ws = { get readyState() { return online ? 1 : 3; }, deserializeAttachment: () => ({ device: DEV, owner: MEMBER, at: T }), close() {},
    send(raw: string) { const m = JSON.parse(raw); if (m.verb === "send") got.push({ id: m.args?.id, text: m.args?.text }); queueMicrotask(() => eng.webSocketMessage(ws, JSON.stringify({ id: m.id, ok: true, result: { ok: true } }))); } };
  const ctx = { setWebSocketAutoResponse() {}, getWebSockets: () => [ws], waitUntil() {},
    storage: { get: async (k: string) => structuredClone(kv.get(k)), put: async (k: string, v: unknown) => { kv.set(k, structuredClone(v)); }, delete: async (k: string) => kv.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {}, getAlarm: async () => null } };
  kv.set("who", { device: DEV, owner: MEMBER, harness });
  eng = new (Engine as any)(ctx, { ...b.env, PUBLIC_URL: "https://example.test", ALLOW_EMAILS: "owner@example.test", SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) } });
  return { ...b, eng, kv, got, setOnline: (v: boolean) => { online = v; } };
}

test("엔진 pending: 켜면 DO 저장에 글 없음({o,d,s}) · 창이 쉬면 같은 글이 들어감(끈 때와 같음) · 옛 배열도 읽힘", async () => {
  const outs: unknown[] = [];
  for (const on of [false, true]) {
    const { db, eng, kv, got } = engine(on);
    assert.deepEqual(await eng.deliver("ew_role0000001", "[Boarder chat] 비밀 일 지시"), { queued: true });
    const st = kv.get("pending");
    if (on) { assert.ok(!Array.isArray(st)); noPlain(JSON.stringify(st), "비밀 일 지시"); } else assert.ok(Array.isArray(st));
    db.prepare("UPDATE engine_window SET state = 'idle' WHERE id = 'ew_role0000001'").run();
    await eng.flush();
    outs.push(got.map(g => g.text));
    assert.equal((await eng.q("pending")).length, 0);
  }
  assert.deepEqual(outs[1], outs[0]);
  assert.deepEqual(outs[1], ["[Boarder chat] 비밀 일 지시"]);
  const { kv, eng, db, got } = engine(true);   // 켜기 전에 쌓인 옛 배열
  kv.set("pending", [{ id: "ew_role0000001", text: "[Boarder chat] 옛 배열 글", at: Date.now(), k: "k1" }]);
  db.prepare("UPDATE engine_window SET state = 'idle' WHERE id = 'ew_role0000001'").run();
  await eng.flush();
  assert.deepEqual(got.map(g => g.text), ["[Boarder chat] 옛 배열 글"]);
});

test("엔진 hpending(주인 하네스): 켜면 저장 봉함 · 다시 붙으면 같은 글이 들어감", async () => {
  const outs: unknown[] = [];
  for (const on of [false, true]) {
    const { eng, kv, got, setOnline } = engine(on, true);
    setOnline(false);
    assert.equal((await eng.hsend("ew_pane12", "주인 창 비밀 글", { queue: true })).queued, true);
    if (on) noPlain(JSON.stringify(kv.get("hpending")), "주인 창 비밀 글");
    assert.equal((await eng.hstatus()).pending, 1);
    setOnline(true);
    await eng.hflush();
    outs.push(got.map(g => g.text));
    assert.equal((await eng.hstatus()).pending, 0);
  }
  assert.deepEqual(outs[1], outs[0]);
  assert.deepEqual(outs[1], ["주인 창 비밀 글"]);
});

test("엔진 hflush: 10분 넘게 못 넣은 글은 창 줄 note 에 원문 없이 「언제 보낸 글」만", async () => {
  const { db, eng, kv } = engine(true, true);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, created_at) VALUES ('ew_pane12', ?, 'devMember01', 'harness', '리드창', 'idle', ?)").run(MEMBER, Date.now());
  const at = Date.UTC(2026, 10, 1, 3, 4);
  await eng.qput("hpending", [{ id: "ew_pane12", text: "주인 창 비밀 지시 원문", at, k: "k1" }]);
  assert.ok(!JSON.stringify(kv.get("hpending")).includes("비밀 지시"));
  await eng.hflush();
  const note = (db.prepare("SELECT note FROM engine_window WHERE id = 'ew_pane12'").get() as any).note as string;
  assert.equal(note, "보드 글을 10분 동안 못 넣었어요 — 03:04 UTC 에 보낸 글");
});

test("rid 답: 봉하기가 실패해도 끝남은 남김(몸통 없이) — 같은 rid 로 다시 와도 쓰기를 다시 안 함", async () => {
  const { _q } = await import("../queue.ts");
  const { db, SNAP, call } = await appEnv(true);
  const h = { cookie: await cookie(MEMBER) };
  _q.sealBody = async () => { throw new Error("D1 오류(시험)"); };
  try {
    const r1 = await call("POST", "/api/chat", h, { text: "한 번만 써야 할 글", channel: "primary", rid: "rvault-fail-0001" });
    assert.equal(r1.status, 200); assert.equal(r1.rid, "new");
    const r2 = await call("POST", "/api/chat", h, { text: "한 번만 써야 할 글", channel: "primary", rid: "rvault-fail-0001" });
    assert.equal(r2.rid, "replay", "하는 중(busy)으로 남거나 다시 처리하면 안 됨");
    assert.equal(r2.status, r1.status);
    assert.equal(r2.body.length, 0, "몸통은 없음(상태만)");
  } finally { _q.sealBody = null; }
  assert.equal((db.prepare("SELECT count(*) AS n FROM board_log WHERE owner = ? AND text = ?").get(MEMBER, "한 번만 써야 할 글") as any).n, 1);
  const rows = SNAP.dbs.flatMap(s => { try { return s.prepare("SELECT state, body FROM rids WHERE rid = 'rvault-fail-0001'").all() as any[]; } catch { return []; } });
  assert.deepEqual(rows.map(r => ({ ...r })), [{ state: "done", body: "" }]);
});
