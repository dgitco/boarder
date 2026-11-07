// node --test --no-warnings --experimental-transform-types apps/web/worker/member-engine-ui.test.ts (Node 22.18+ · node:sqlite)
// 보더 웹 설정 › 엔진(BYOS): 계정 목록 · 로그인 주소 · 엔진 고르기. 진짜 index.ts(app.fetch) + 메모리 SQLite + 가짜 엔진 DO(devCmd).
// 남의 기기 · 주인 · 로그인 없음 · 다른 사이트 요청은 거절, 로그인 값은 서버로 안 옴(이름 · 여부 · https 주소만). 메일 · 토큰은 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const { default: app } = await import("./index.ts");
const MB = await import("./member-board.ts");
const MC = await import("./member-canvas.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", e); return new Response("{}", { status: 500 }); });

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
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
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
async function setup(o: { fail?: { code: number; msg: string }; url?: string | null; stale?: boolean } = {}) {
  const { db, D1 } = d1(), T = Date.now();
  for (const m of [A, B]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at, engine) VALUES (?,?,?,?,?,?,?,?,?,?)");
  dev.run("devAaaaaaaaa", A, "내 윈도우", "", "a".repeat(64), T, T, "full", o.stale ? T - 600_000 : T, JSON.stringify({ default: "tmux", engines: { tmux: { caps: [] } } }));
  dev.run("devBbbbbbbbb", B, "남의 기기", "", "b".repeat(64), T, T, "full", T, "{}");
  dev.run("devOooooooo1", OWNER, "owner-host", "", "o".repeat(64), T, T, "harness", T, "{}");
  const cmds: { dev: string; verb: string; args: any }[] = [];
  const ENGINE = {
    idFromName: (s: string) => s,
    get: (id: string) => ({
      devCmd: async (verb: string, args: any) => {
        cmds.push({ dev: id.replace(/^dev:/, ""), verb, args });
        if (o.fail) return { ok: false, code: o.fail.code, error: o.fail.msg };
        if (verb === "account_list") return { ok: true, result: { engine: "tmux", engines: ["tmux", "sdk"], accounts: { claude: [{ name: "개인", logged_in: true, token: "SECRET-X" }, { name: "회사", logged_in: false }], codex: [] } } };
        if (verb === "account_login") return { ok: true, result: { url: o.url === undefined ? "https://claude.ai/oauth/authorize?x=1" : o.url, started: true } };
        return { ok: true, result: { default: args.engine } };
      },
    }),
  };
  const env: any = { DB: D1, ENGINE, SNAP: { idFromName: (s: string) => s, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  const human = async (email = A) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  return { db, call, human, cmds };
}
const P = "/api/me/engine/device/devAaaaaaaaa";

test("계정 목록: 내 기기만 · 이름과 로그인 여부만(기기가 값을 붙여도 안 내보냄)", async () => {
  const s = await setup();
  const r = await s.call("GET", P, undefined, await s.human());
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.j.accounts.claude, [{ name: "개인", logged_in: true }, { name: "회사", logged_in: false }]);
  assert.equal(r.j.engine, "tmux"); assert.deepEqual(r.j.engines, ["tmux", "sdk"]);
  assert.ok(!r.text.includes("SECRET-X"));
  assert.deepEqual(s.cmds.map(c => [c.dev, c.verb]), [["devAaaaaaaaa", "account_list"]]);
});

test("권한: 남의 기기 404 · 주인 하네스 기기 404 · 회원 기기를 주인이 부르면 404(주인 · 회원 한 길 — 남의 기기) · 로그인 없음 403 · 꺼진 기기 409 — 기기로 명령이 안 감", async () => {
  const s = await setup();
  assert.equal((await s.call("GET", "/api/me/engine/device/devBbbbbbbbb", undefined, await s.human())).status, 404);
  assert.equal((await s.call("POST", "/api/me/engine/device/devBbbbbbbbb/choose", { engine: "sdk" }, await s.human())).status, 404);
  assert.equal((await s.call("POST", "/api/me/engine/device/devBbbbbbbbb/login", { provider: "claude", name: "x" }, await s.human())).status, 404);
  assert.equal((await s.call("GET", "/api/me/engine/device/devOooooooo1", undefined, await s.human())).status, 404);
  assert.equal((await s.call("GET", P, undefined, await s.human(OWNER))).status, 404, "주인(canon)에게 회원 기기는 남의 기기");
  assert.equal((await s.call("GET", P)).status, 403);
  assert.equal(s.cmds.length, 0);
  const st = await setup({ stale: true });
  assert.equal((await st.call("GET", P, undefined, await st.human())).status, 409);
});

test("쓰기는 같은 사이트만(다른 사이트에서 온 요청 403)", async () => {
  const s = await setup(), h = { ...(await s.human()), "sec-fetch-site": "cross-site" };
  assert.equal((await s.call("POST", P + "/choose", { engine: "sdk" }, h)).status, 403);
  assert.equal((await s.call("POST", P + "/login", { provider: "claude", name: "x" }, h)).status, 403);
  assert.equal(s.cmds.length, 0);
});

test("계정 추가: 기기에 account_login 을 내리고 https 주소만 돌려줌 · 이상한 이름 · 공급자는 400", async () => {
  const s = await setup();
  const r = await s.call("POST", P + "/login", { provider: "claude", name: "회사2" }, await s.human());
  assert.equal(r.status, 400, "한글 이름은 기기 쪽 규칙(영문 · 숫자 · . _ -)과 같게 거절");
  for (const bn of [".", "..", ".x", "-x"]) assert.equal((await s.call("POST", P + "/login", { provider: "claude", name: bn }, await s.human())).status, 400, `이름 ${bn} 거절`);
  const ok = await s.call("POST", P + "/login", { provider: "codex", name: "work-2" }, await s.human());
  assert.deepEqual(ok.j, { ok: true, url: "https://claude.ai/oauth/authorize?x=1", started: true });
  assert.deepEqual(s.cmds.at(-1), { dev: "devAaaaaaaaa", verb: "account_login", args: { provider: "codex", name: "work-2" } });
  assert.equal((await s.call("POST", P + "/login", { provider: "gemini", name: "x" }, await s.human())).status, 400);
  const js = await setup({ url: "javascript:alert(1)" });
  assert.equal((await js.call("POST", P + "/login", { provider: "claude", name: "a" }, await js.human())).j.url, null, "https 가 아니면 주소를 안 줌");
});

test("엔진 고르기: sdk · tmux 만 · 기기에 engine_choose 를 내리고 서버가 아는 기본값도 맞춤 · 이상한 값 400", async () => {
  const s = await setup();
  assert.equal((await s.call("POST", P + "/choose", { engine: "herdr" }, await s.human())).status, 400);
  const r = await s.call("POST", P + "/choose", { engine: "sdk" }, await s.human());
  assert.deepEqual(r.j, { ok: true, engine: "sdk" });
  assert.deepEqual(s.cmds.at(-1), { dev: "devAaaaaaaaa", verb: "engine_choose", args: { engine: "sdk" } });
  assert.equal(JSON.parse((s.db.prepare("SELECT engine FROM device WHERE id = 'devAaaaaaaaa'").get() as any).engine).default, "sdk");
  assert.equal(JSON.parse((s.db.prepare("SELECT engine FROM device WHERE id = 'devBbbbbbbbb'").get() as any).engine).default, undefined, "남의 기기는 그대로");
});

test("기기가 못 한다고 하면 한 줄 오류로 · 기본값은 안 바뀜", async () => {
  const s = await setup({ fail: { code: 1, msg: "내 구독 엔진을 아직 못 깔았어요" } });
  const r = await s.call("POST", P + "/choose", { engine: "sdk" }, await s.human());
  assert.equal(r.status, 502); assert.equal(r.j.error, "내 구독 엔진을 아직 못 깔았어요");
  assert.equal(JSON.parse((s.db.prepare("SELECT engine FROM device WHERE id = 'devAaaaaaaaa'").get() as any).engine).default, "tmux");
  const e = await setup({ fail: { code: 1, msg: "Error: boom" } });
  assert.equal((await e.call("GET", P, undefined, await e.human())).j.error, "기기가 답하지 않아요");
});
