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
  const st = { failOnce: "" };
  const trip = (sql: string) => { if (st.failOnce && sql.trimStart().startsWith(st.failOnce)) { st.failOnce = ""; throw new Error("D1 일시 오류(시험)"); } };
  const run1 = (sql: string, args: unknown[]) => { trip(sql); const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
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
    batch: async (ss: any[]) => {
      db.exec("BEGIN");
      try {
        const out = ss.map(s => /^\s*select/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args));
        db.exec("COMMIT"); return out;
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },
  } as unknown as D1Database;
  return { db, D1, st };
}

const A = "member@example.test", B = "other@example.test", SECRET = "test-secret-not-real";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email: string) {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로 — 세션 토큰은 사람마다 지어낸 값
  const tok = "sess-made-up-" + email, th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tok))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${tok}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
function setup() {
  const { db, D1 } = d1();
  for (const e of [A, B]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(e, "owner@example.test", Date.now());
  const SNAP = { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) };
  const ENGINE = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response("{}"), revoke: async () => null }) };
  const env = { DB: D1, SNAP, ENGINE, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: "owner@example.test", PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (method: string, path: string, body: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: method === "GET" ? undefined : JSON.stringify(body) }), env, ctx);
    let j: any = {}; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
  const as = async (email: string) => ({ "x-hb": "1", "sec-fetch-site": "same-origin", cookie: await cookie(email) });
  // boarder setup 의 코드 입력 길: 코드 → 그 사람이 허용 → 기기 열쇠
  const device = async (email: string, name: string) => {
    const c = await call("POST", "/api/device/code", { name, tools: ["claude"] });
    assert.equal(c.status, 200, JSON.stringify(c.j));
    assert.equal((await call("POST", "/api/device/approve", { user_code: c.j.user_code, allow: true }, await as(email))).status, 200);
    const t = await call("POST", "/api/device/token", { device_code: c.j.device_code });
    assert.equal(t.j.state, "approved", JSON.stringify(t.j));
    return { id: t.j.device_id as string, tok: t.j.token as string };
  };
  const win = (dev: { tok: string }, key: string) => call("POST", "/api/device/window", { key, name: key }, { authorization: `Bearer ${dev.tok}` });
  const alive = async (t: string) => { const s = (await call("POST", "/api/agent/__none__", {}, { authorization: `Bearer ${t}` })).status; assert.ok(s === 401 || s === 404, `401(죽음) 아니면 404(없는 도구 — 열쇠는 통과) — 받은 ${s}`); return s === 404; };
  const audit = () => db.prepare("SELECT owner, act, device_id, pane, by_email, n FROM token_audit ORDER BY id").all() as { owner: string; act: string; device_id: string; pane: string | null; by_email: string; n: number }[];
  return { db, call, as, device, win, alive, audit };
}

test("창 하나 끊기: 그 창 401 · 다른 창 삶 · 같은 키 다시 받기 403 · 다시 켜면 새 열쇠(옛 열쇠는 죽은 채) · 감사 두 줄", async () => {
  const { call, as, device, win, alive, audit } = setup();
  const d = await device(A, "laptop");
  const w1 = (await win(d, "laptop:1")).j.token, w2 = (await win(d, "laptop:2")).j.token;
  assert.equal(await alive(w1), true); assert.equal(await alive(w2), true);
  const r = await call("POST", `/api/me/devices/${d.id}/windows/revoke`, { key: "laptop:1" }, await as(A));
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.revoked, 1);
  assert.equal(await alive(w1), false, "끊은 창 열쇠는 바로 401");
  assert.equal(await alive(w2), true, "같은 기기 다른 창은 그대로");
  const again = await win(d, "laptop:1");
  assert.equal(again.status, 403, "끊은 창은 기기가 같은 키로 새 열쇠를 다시 받지 못함"); assert.equal(again.j.token, undefined);
  const list = await call("GET", `/api/me/devices/${d.id}/windows`, null, await as(A));
  const row = list.j.windows.find((w: any) => w.key === "laptop:1");
  assert.equal(row.live, false); assert.ok(row.blocked_at, "목록에 끊긴 창 표시");
  assert.equal(list.j.windows.find((w: any) => w.key === "laptop:2").live, true);
  const en = await call("POST", `/api/me/devices/${d.id}/windows/enable`, { key: "laptop:1" }, await as(A));
  assert.equal(en.status, 200, JSON.stringify(en.j));
  assert.equal(await alive(w1), false, "다시 켜도 옛 열쇠는 죽은 채");
  const w1b = (await win(d, "laptop:1")).j.token;
  assert.ok(w1b && w1b !== w1); assert.equal(await alive(w1b), true, "다시 켠 뒤 새 열쇠는 삶");
  assert.deepEqual(audit().map(a => [a.act, a.device_id, a.pane, a.by_email, a.n, a.owner]), [
    ["revoke_window", d.id, "laptop:1", A, 1, A],
    ["enable_window", d.id, "laptop:1", A, 0, A],
  ]);
  assert.equal((await call("POST", `/api/me/devices/${d.id}/windows/enable`, { key: "laptop:1" }, await as(A))).status, 404, "끊기지 않은 창은 다시 켜기 없음");
  assert.equal((await call("POST", `/api/me/devices/${d.id}/windows/revoke`, { key: "nope:9" }, await as(A))).status, 404, "이 기기에 없는 창");
});

test("기기 끊기: 그 기기 창 전부 401 · 기기 열쇠 401 · 다른 기기 영향 0 · 감사 한 줄", async () => {
  const { call, as, device, win, alive, audit } = setup();
  const d1 = await device(A, "laptop"), d2 = await device(A, "desk");
  const a = [(await win(d1, "x:1")).j.token, (await win(d1, "x:2")).j.token, (await win(d1, "x:3")).j.token];
  const b = (await win(d2, "x:1")).j.token;
  const r = await call("POST", `/api/me/devices/${d1.id}/revoke`, {}, await as(A));
  assert.equal(r.status, 200, JSON.stringify(r.j));
  for (const t of a) assert.equal(await alive(t), false, "끊은 기기의 창 열쇠는 전부 401");
  assert.equal((await call("GET", "/api/device/me", null, { authorization: `Bearer ${d1.tok}` })).status, 401, "기기 열쇠도 401");
  assert.equal((await win(d1, "x:4")).status, 401, "끊은 기기는 새 창 열쇠도 못 받음");
  assert.equal(await alive(b), true, "다른 기기 창은 그대로");
  assert.equal((await call("GET", "/api/device/me", null, { authorization: `Bearer ${d2.tok}` })).status, 200, "다른 기기 열쇠는 그대로");
  assert.deepEqual(audit().map(x => [x.act, x.device_id, x.pane, x.by_email, x.n]), [["revoke_device", d1.id, null, A, 4]]);
  assert.equal((await call("POST", `/api/me/devices/${d1.id}/revoke`, {}, await as(A))).status, 404, "이미 끊긴 기기");
  assert.equal((await call("POST", `/api/me/devices/${d1.id}/windows/enable`, { key: "x:1" }, await as(A))).status, 409, "끊긴 기기의 창은 다시 켜지 않음");
});

test("주인 아닌 사람 거절(없는 기기와 같은 404) · 열쇠 머리 401 · 다른 사이트 403 — 열쇠는 그대로", async () => {
  const { call, as, device, win, alive, audit } = setup();
  const d = await device(A, "laptop");
  const w = (await win(d, "k:1")).j.token;
  const other = await as(B);
  assert.equal((await call("POST", `/api/me/devices/${d.id}/revoke`, {}, other)).status, 404);
  assert.equal((await call("POST", `/api/me/devices/${d.id}/windows/revoke`, { key: "k:1" }, other)).status, 404);
  assert.equal((await call("POST", `/api/me/devices/${d.id}/windows/enable`, { key: "k:1" }, other)).status, 404);
  assert.equal((await call("GET", `/api/me/devices/${d.id}/windows`, null, other)).status, 404);
  assert.equal((await call("POST", "/api/me/devices/no-such-device/revoke", {}, other)).status, 404);
  assert.equal((await call("POST", `/api/me/devices/${d.id}/windows/revoke`, { key: "k:1" }, { ...(await as(A)), authorization: `Bearer ${d.tok}` })).status, 401, "기기 열쇠를 붙이면 사람 아님");
  assert.equal((await call("POST", `/api/me/devices/${d.id}/revoke`, {}, { "x-hb": "1", "sec-fetch-site": "same-origin" })).status, 401, "로그인 없음");
  assert.equal((await call("POST", `/api/me/devices/${d.id}/revoke`, {}, { cookie: await cookie(A) })).status, 403, "다른 사이트에서 누름(x-hb 없음)");
  assert.equal(await alive(w), true, "남이 시도해도 열쇠는 그대로");
  assert.equal((await call("GET", "/api/device/me", null, { authorization: `Bearer ${d.tok}` })).status, 200);
  assert.equal(audit().length, 0, "거절은 감사 줄 없음(끊긴 것이 없음)");
});

test("마이그레이션 0077 전(window_block 표 없음)에 코드가 먼저 나가도 창 열쇠 받기는 예전처럼 됨", async () => {
  const { db, device, win, alive } = setup();
  const d = await device(A, "laptop");
  db.exec("DROP TABLE window_block");
  const r = await win(d, "pre:1");
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(await alive(r.j.token), true);
});

test("마이그레이션 0077 전(token_audit · window_block 표 없음)에도 기기 끊기는 됨 — 기기 · 창 열쇠 401(감사 줄만 없음)", async () => {
  const { db, call, as, device, win, alive } = setup();
  const d = await device(A, "laptop");
  const w = (await win(d, "pre:1")).j.token;
  db.exec("DROP TABLE token_audit"); db.exec("DROP TABLE window_block");
  const r = await call("POST", `/api/me/devices/${d.id}/revoke`, {}, await as(A));
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(await alive(w), false, "그 기기 창 열쇠 401");
  assert.equal((await call("GET", "/api/device/me", null, { authorization: `Bearer ${d.tok}` })).status, 401, "기기 열쇠 401");
});

async function rpc(call: any, tok: string, name: string, args: unknown) {
  const r = await call("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { authorization: `Bearer ${tok}` });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const t = String(r.j.result.content[0].text);
  try { return JSON.parse(t); } catch { return t; }   // 코드 실행 결과는 글(값 + console 줄)
}
const logs = (db: any, kind = "progress") => (db.prepare("SELECT text FROM board_log WHERE kind = ? ORDER BY id").all(kind) as { text: string }[]).map(r => r.text);
const cutTrigger = (db: any) => db.exec("CREATE TRIGGER cut_mid AFTER INSERT ON board_log WHEN NEW.text = 'cut' BEGIN UPDATE agent_token SET revoked_at = 1 WHERE revoked_at IS NULL; END");

test("묶음(calls) 안: 끊긴 뒤 다음 쓰기 부르기는 401 꼴로 실패 · 읽기 부르기는 됨", async () => {
  const { db, call, device, win } = setup();
  const d = await device(A, "laptop"), t = (await win(d, "m:1")).j.token;
  cutTrigger(db);
  const out = await rpc(call, t, "boarder_execute_write", { calls: [
    { key: "a", tool: "inbox_log", arguments: { kind: "progress", text: "cut" } },
    { key: "b", tool: "inbox_wait", arguments: { card_id: "w:1", timeout_s: 0 } },   // 읽기 도구(없는 카드 → 바로 closed)
    { key: "c", tool: "inbox_log", arguments: { kind: "progress", text: "after" } },
  ] });
  assert.ok(!String(out.a).startsWith("ERROR"), JSON.stringify(out.a));
  assert.ok(!String(out.b).startsWith("ERROR"), "읽기는 그대로: " + JSON.stringify(out.b));
  assert.match(String(out.c), /^ERROR 401 열쇠가 끊겼어요/);
  assert.deepEqual(logs(db), ["cut"], "끊긴 뒤 쓰기는 장부에 안 들어감");
});

test("코드 실행 안: 끊긴 뒤 tools.call 쓰기는 던짐 · 끊지 않으면 그대로 다 됨", async () => {
  const { db, call, device, win } = setup();
  const d = await device(A, "laptop"), t = (await win(d, "m:2")).j.token;
  const code = `async () => { await tools.call("inbox_log", { kind: "progress", text: input.first }); let e = null; try { await tools.call("inbox_log", { kind: "progress", text: "second" }); } catch (x) { e = String(x.message || x); } return { e }; }`;
  const ok = await rpc(call, t, "boarder_execute_write", { code, input: { first: "one" } });
  assert.equal(JSON.stringify(ok).includes("401"), false, "끊지 않으면 그대로: " + JSON.stringify(ok));
  assert.deepEqual(logs(db), ["one", "second"]);
  cutTrigger(db);
  const r = await rpc(call, t, "boarder_execute_write", { code, input: { first: "cut" } });
  assert.ok(JSON.stringify(r).includes("401 열쇠가 끊겼어요"), "스크립트가 받은 오류: " + JSON.stringify(r));
  assert.deepEqual(logs(db), ["one", "second", "cut"], "끊긴 뒤 「second」는 안 들어감");
});
