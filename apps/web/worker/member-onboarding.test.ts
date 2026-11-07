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
const OWNER = "owner@example.test", A = "member@example.test", B = "other@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up";
const DEVA = "bxd_made-up-device-one-0123456789abcdef";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
const DIRS = ["a", "b", "c", "d", "e"].map(x => ({ tool: "claude", where: `~/.claude-accounts/${x}`, state: x === "c" ? "stale" : "on" })).concat([{ tool: "codex", where: "~/.codex", state: "off" }]);

async function setup() {
  const { db, D1 } = d1(), T = Date.now();
  for (const m of [A, B]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, features) VALUES (?,?,?,?,?,?,?,?,?)");
  dev.run("devA", A, "mbp", "", await sha(DEVA), T, T, "full", JSON.stringify({ report: ["claude"], engine: true, reportDirs: DIRS }));
  dev.run("devB", B, "theirs", "", "x".repeat(64), T, T, "full", JSON.stringify({ report: [], engine: false }));
  dev.run("devB2", B, "theirs2", "", "y".repeat(64), T, T, "full", null);
  const item = db.prepare("INSERT INTO imp_item(owner, key, kind, device_id, title, seen_at) VALUES (?,?,?,?,?,?)");
  item.run(A, "window:mbp:ew_lead", "window", "devA", "팀장 창", T); item.run(B, "window:theirs:ew_x", "window", "devB", "남의 창", T);
  db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, auth, created_at, updated_at, read_only) VALUES (?,?,?,?,?,?,?,?,?,?)").run("c_b", B, "slack-b", "", "api", "https://slack.com/api", "v1.x", T, T, 1);
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  const human = async (email = A) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  return { db, call, human };
}
const step = (j: any, k: string) => j.steps.find((x: any) => x.key === k);

test("점검표 계약: 단계 여덟(차례 그대로 — 구독 연결은 기기 다음) · 단계마다 key · title · done · detail", async () => {
  const s = await setup();
  const r = await s.call("GET", "/api/me/onboarding", undefined, await s.human());
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.j.steps.map((x: any) => x.key), ["devices", "subscription", "report", "windows", "connectors", "slack", "primary", "push"]);
  for (const x of r.j.steps) { assert.equal(typeof x.title, "string"); assert.equal(typeof x.done, "boolean"); assert.equal(typeof x.detail, "string"); }
  assert.equal(r.j.total, 8); assert.equal(r.j.done, r.j.steps.filter((x: any) => x.done).length);
  assert.match(step(r.j, "devices").detail, /기기 1대 · 엔진 켜짐 1대/);
  const rep = step(r.j, "report");
  assert.equal(rep.done, false, "옛 경로 폴더가 있으면 끝 아님"); assert.match(rep.detail, /보고 켜짐 4곳 · 옛 경로 1곳 · 꺼짐 1곳/); assert.match(rep.detail, /~\/\.claude-accounts\/c/);
  assert.equal(r.j.steps.some((x: any) => /bxd_|xoxb-|v1\./.test(JSON.stringify(x))), false, "토큰 · 봉한 값 없음");
});

test("권한 경계: 그 회원 것만 셈 · 기본 창 후보도 내 창만 · 로그인 없음은 403 · 주인은 canon 제 점검표(주인 · 회원 한 길)", async () => {
  const s = await setup();
  const a = (await s.call("GET", "/api/me/onboarding", undefined, await s.human())).j;
  assert.equal(step(a, "connectors").done, false, "남의 연결은 안 셈");
  assert.deepEqual(step(a, "primary").pick.map((w: any) => w.target), ["window:mbp:ew_lead"]);
  const b = (await s.call("GET", "/api/me/onboarding", undefined, await s.human(B))).j;
  assert.match(step(b, "devices").detail, /기기 2대 · 엔진 켜짐 0대/); assert.equal(step(b, "connectors").done, true);
  const o = await s.call("GET", "/api/me/onboarding", undefined, await s.human(OWNER));
  assert.equal(o.status, 200, "주인도 회원 길(canon)"); assert.notDeepEqual(o.j, a, "회원 것이 섞이지 않음");
  assert.equal((await s.call("GET", "/api/me/onboarding")).status, 403);
});

test("기본 창: 점검표에서 고른 창(POST /api/me/primary-window)이 「끝」으로 · 남의 창은 404", async () => {
  const s = await setup();
  assert.equal((await s.call("POST", "/api/me/primary-window", { target: "window:theirs:ew_x" }, await s.human())).status, 404);
  assert.equal((await s.call("POST", "/api/me/primary-window", { target: "window:mbp:ew_lead" }, await s.human())).status, 200);
  const p = step((await s.call("GET", "/api/me/onboarding", undefined, await s.human())).j, "primary");
  assert.equal(p.done, true); assert.match(p.detail, /「팀장 창」/); assert.equal(p.pick[0].on, true);
});

test("기기 기능 결과(feature 명령): 폴더 목록이 400자를 넘어도 잘리지 않고 꼴을 본 채 저장 · 이상한 꼴은 안 씀", async () => {
  const s = await setup(), T = Date.now();
  const many = Array.from({ length: 12 }, (_, i) => ({ tool: "claude", where: `~/.claude-accounts/account-number-${i}`, state: "on" }));
  s.db.prepare("INSERT INTO engine_cmd(id, owner, device_id, verb, args, at, state, taken_at) VALUES (?,?,?,?,?,?,?,?)").run("cmd1", A, "devA", "feature", JSON.stringify({ what: "report" }), T, "taken", T);
  const r = await s.call("POST", "/api/device/cmds/cmd1", { ok: true, item: { features: { report: ["claude"], engine: true, view: true, reportDirs: many } } }, { authorization: `Bearer ${DEVA}` });
  assert.equal(r.status, 200, r.text);
  const f = JSON.parse((s.db.prepare("SELECT features FROM device WHERE id = 'devA'").get() as any).features);
  assert.equal(f.reportDirs.length, 12); assert.ok(JSON.stringify(f).length > 400);
  s.db.prepare("INSERT INTO engine_cmd(id, owner, device_id, verb, args, at, state, taken_at) VALUES (?,?,?,?,?,?,?,?)").run("cmd2", A, "devA", "feature", JSON.stringify({ what: "report" }), T, "taken", T);
  await s.call("POST", "/api/device/cmds/cmd2", { ok: true, item: { features: { report: ["nope"], engine: "x" } } }, { authorization: `Bearer ${DEVA}` });
  assert.equal(JSON.parse((s.db.prepare("SELECT features FROM device WHERE id = 'devA'").get() as any).features).reportDirs.length, 12, "이상한 꼴은 덮지 않음");
});
