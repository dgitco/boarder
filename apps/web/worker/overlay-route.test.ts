// node --test --no-warnings --experimental-transform-types apps/web/worker/overlay-route.test.ts (Node 22.18+ · node:sqlite · apps/web 의존성 설치된 채)
// 덧씌우기 · 프롬프트 길: 진짜 index.ts(app.fetch)로 — 기기 scope 거절, 지워진 기기 · 쫓겨난 회원, 래퍼 js 해시 불일치, 같은 사이트 검사, 알림 줄(회원은 보드 줄, 주인은 다리 flag), 화면에 얹힘 · ?no_overlay=1.
// 가짜 D1 = 메모리 SQLite + migrations 전부. 자료는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
// 틀 얹기(boardShell)가 쓰는 것만: head · body 의 prepend(뒤에 부른 것이 맨 앞) · append
(globalThis as any).HTMLRewriter = class {
  hs: [string, { element?: (e: unknown) => unknown }][] = [];
  on(sel: string, h: { element?: (e: unknown) => unknown }) { this.hs.push([sel, h]); return this; }
  transform(r: Response) {
    const hs = this.hs;
    const run = async () => {
      let html = await r.text();
      for (const [sel, h] of hs) {
        if ((sel !== "head" && sel !== "body") || !h.element) continue;
        const pre: string[] = [], app: string[] = [];
        await h.element({ prepend: (s: string) => { pre.unshift(s); }, append: (s: string) => { app.push(s); }, setAttribute() {} });
        html = html.replace(new RegExp(`<${sel}[^>]*>`), m => m + pre.join("")).replace(`</${sel}>`, () => app.join("") + `</${sel}>`);
      }
      return html;
    };
    return new Response(new ReadableStream({ async start(ctl) { ctl.enqueue(new TextEncoder().encode(await run())); ctl.close(); } }), { status: r.status, headers: r.headers });
  }
};
const { default: app } = await import("./index.ts");
const { hosted } = await import("./hosted.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
  });
  return { D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => s.all())) } as unknown as D1Database };
}
const BOARD = '<!doctype html><html><head><meta charset=utf-8></head><body><div class=wrap>보드</div></body></html>';
let failTool = false;
const flags: { name: string; args: Record<string, unknown>; agent: string }[] = [];
function bridgeNs() {
  const te = new TextEncoder();
  const call = async (r: { method: string; path: string }) => r.path.split("?")[0] === "/"
    ? { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: te.encode(BOARD) }
    : { status: 404, headers: { "content-type": "application/json" }, body: te.encode('{"error":"not found"}') };
  const tool = async (name: string, args: Record<string, unknown>, agent: string) => { if (failTool) throw new Error("릴레이 없음"); flags.push({ name, args, agent }); return { ok: true }; };
  return { idFromName: (n: string) => n, get: () => ({ call, tool }) };
}
const OWNER = "owner@example.test", MEMBER = "member@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email: string) {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
// 첫 화면 틀(page-template.py 꼴) — 주인도 회원 길 첫 화면(memberPage)
const PAGE = JSON.stringify({ ver: "v1", html: '<!doctype html><html><head></head><body><script>window.D = __BX_DATA__; window.T = "__BX_DTAG__"</script></body></html>' });
const sha = async (t: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
const DEV = (n: string) => "bxd_" + n.repeat(40).slice(0, 40);
async function setup(o: { relay?: boolean } = {}) {
  const { D1 } = d1(), pending: Promise<unknown>[] = [];
  (hosted as any).exec = o.relay ? { on: async () => false, call: async () => ({ status: 404, headers: {}, body: new Uint8Array() }), tool: async () => ({}) } : undefined;   // 호스팅 서버만 릴레이가 있음
  const ASSETS = { fetch: async () => new Response("<!doctype html><html><head></head><body></body></html>", { headers: { "content-type": "text/html" } }) };
  const env = { DB: D1, ASSETS, BRIDGE: bridgeNs(), SNAP: { idFromName: (s: string) => s, get: () => ({ bump: async () => 0, get: async (k: string) => k === "page" ? { body: PAGE, etag: '"e-page"', at: Date.now(), checked: Date.now() } : null, tags: async () => ({ t: {}, age: 0, boot: "b" }) }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  flags.length = 0;
  const run = (sql: string, ...a: unknown[]) => (D1 as any).prepare(sql).bind(...a).run();
  await run("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)", MEMBER, OWNER, Date.now());
  const dev = async (id: string, owner: string, scope: string, revoked = false) => run("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, revoked_at) VALUES (?,?,?,?,?,?,?,?,?)", id, owner, "내 노트북", "", await sha(DEV(id)), Date.now(), Date.now(), scope, revoked ? Date.now() : null);
  await dev("a", MEMBER, "full"); await dev("b", MEMBER, "full"); await dev("w", MEMBER, "watch"); await dev("h", MEMBER, "harness"); await dev("r", MEMBER, "full", true); await dev("o", OWNER, "full"); await dev("x", "gone@example.test", "full");
  const q = async (sql: string, ...a: unknown[]) => (await (D1 as any).prepare(sql).bind(...a).first()) as Record<string, unknown> | null;
  const call = (path: string, init: RequestInit & { as?: string; tok?: string; site?: boolean; body?: unknown } = {}) => app.fetch(new Request("https://example.test" + path, {
    method: init.method || "POST", redirect: "manual",
    headers: { "content-type": "application/json", ...(init.tok ? { authorization: `Bearer ${DEV(init.tok)}` } : {}), ...(init.site ? { "x-hb": "1" } : {}), ...(init.as ? { cookie: "" } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  }), env as never, { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() {} } as never).then(async r => { await Promise.all(pending.splice(0)); return r; });
  const web = async (path: string, who: string, o: { method?: string; site?: boolean; body?: unknown } = {}) => app.fetch(new Request("https://example.test" + path, {
    method: o.method || "GET", redirect: "manual",
    headers: { "content-type": "application/json", accept: "application/json", cookie: await cookie(who), ...(o.site ? { "x-hb": "1", "sec-fetch-site": "same-origin" } : {}) },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  }), env as never, { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() {} } as never).then(async r => { await Promise.all(pending.splice(0)); return r; });
  /** 그 기기가 보드 카드에서 「설정 바꾸기」 허락을 받은 채(카드 길 자체는 device-settings.test.ts) */
  const grant = (id: string, owner = MEMBER) => run("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)", owner, `cli_settings:${id}`, "1", Date.now());
  return { q, call, web, run, env, grant };
}
const CSS = { slot: "mine", set: { css: "a{color:red}" } };

test("기기 길 거절: 토큰 없음 · watch/harness scope · 지워진 기기 · 쫓겨난(초대 없는) 회원 → 401, 아무것도 안 저장됨", async () => {
  const s = await setup();
  for (const tok of [undefined, "w", "h", "r", "x"]) {
    for (const path of ["/api/device/overlay", "/api/device/prompts"]) {
      const r = await s.call(path, { tok, body: path.endsWith("prompts") ? { main: "hi" } : CSS }); assert.equal(r.status, 401, `${tok} ${path}`);
    }
  }
  assert.equal((await s.call("/api/device/overlay", { method: "GET", tok: "w" })).status, 401);
  assert.equal(await s.q("SELECT 1 x FROM person_custom"), null, "저장된 것 없음");
  assert.equal(flags.length, 0);
  // 초대가 풀린 회원도 막힘
  await s.run("DELETE FROM invite WHERE email = ?", MEMBER);
  assert.equal((await s.call("/api/device/overlay", { tok: "a", body: CSS })).status, 401, "쫓겨난 회원의 full 기기");
  assert.equal(await s.q("SELECT 1 x FROM person_custom"), null);
});

test("기기 길 저장: 회원 full 기기 → 200, 그 사람 줄에만 저장 · 보드에 알림 줄(기기 이름 · 바뀐 칸)", async () => {
  const s = await setup();
  const r = await s.call("/api/device/overlay", { tok: "a", body: CSS }); assert.equal(r.status, 200);
  assert.equal((await s.q("SELECT css FROM person_custom WHERE owner = ?", MEMBER))?.css, "a{color:red}");
  assert.equal(await s.q("SELECT 1 x FROM person_custom WHERE owner = ?", OWNER), null);
  const line = await s.q("SELECT text FROM board_log WHERE owner = ? AND kind = 'sys'", MEMBER);
  assert.match(String(line?.text), /내 노트북.*화면 덧씌우기.*css/); assert.equal(flags.length, 0, "회원 알림은 다리로 안 감");
  const p = await s.call("/api/device/prompts", { tok: "a", body: { main: "첫 글", roles: [{ id: "plan", name: "정리", brief: "b", instructions: "i" }] } }); assert.equal(p.status, 200);
  assert.equal((await s.q("SELECT p_main FROM person_custom WHERE owner = ?", MEMBER))?.p_main, "첫 글");
  const lines = await (async () => { const out = []; for (const t of ["메인 봇 · 역할 글"]) out.push(await s.q("SELECT text FROM board_log WHERE owner = ? AND text LIKE ?", MEMBER, `%${t}%`)); return out; })();
  assert.ok(lines[0], "프롬프트 저장도 알림 줄");
});

test("호스팅 서버의 주인 기기 저장: 알림은 D1 줄이 아니라 주인 보드 글 도구(notify)로 간다 · 프롬프트도", async () => {
  const s = await setup({ relay: true });
  assert.equal((await s.call("/api/device/overlay", { tok: "o", body: CSS })).status, 200);
  assert.equal(await s.q("SELECT 1 x FROM board_log WHERE owner = ?", OWNER), null, "주인은 D1 보드 줄을 안 읽으므로 거기엔 안 씀");
  assert.equal(flags.length, 1); assert.equal(flags[0].name, "notify", "보드 글 도구"); assert.match(String(flags[0].args.text), /내 노트북.*화면 덧씌우기/);
  assert.equal((await s.call("/api/device/prompts", { tok: "o", body: { main: "주인 첫 글" } })).status, 200);
  assert.equal(flags.length, 2); assert.match(String(flags[1].args.text), /메인 봇 · 역할 글/);
});

test("릴레이가 없는 서버(공개 판)의 주인: 다리를 부르지 않고 그 사람 D1 보드 글로, 저장 응답은 알림을 기다리지 않음", async () => {
  const s = await setup();
  const t0 = Date.now();
  assert.equal((await s.call("/api/device/overlay", { tok: "o", body: CSS })).status, 200);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(flags.length, 0, "다리 도구 안 부름");
  assert.match(String((await s.q("SELECT text FROM board_log WHERE owner = ? AND kind = 'sys'", OWNER))?.text), /내 노트북.*화면 덧씌우기/);
});

test("알림은 응답과 떼어짐: 릴레이가 안 답해도 저장 응답이 먼저 나가고, 알림은 뒤에 마저 감", async () => {
  const s = await setup({ relay: true });
  let release!: () => void, called = false; const gate = new Promise<void>(r => { release = r; });
  (hosted as any).exec.on = async () => true; (hosted as any).exec.tool = async () => { called = true; await gate; return {}; };
  const waits: Promise<unknown>[] = [];
  const r = await app.fetch(new Request("https://example.test/api/device/overlay", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${DEV("o")}` }, body: JSON.stringify(CSS) }),
    s.env as never, { waitUntil: (p: Promise<unknown>) => { waits.push(p); }, passThroughOnException() {} } as never);
  assert.equal(r.status, 200, "릴레이가 안 풀렸는데도 응답이 나옴");
  assert.equal((await s.q("SELECT css FROM person_custom WHERE owner = ?", OWNER))?.css, "a{color:red}", "저장도 끝남");
  release(); await Promise.all(waits); assert.ok(called);
});

test("기기 이름은 평문으로: 링크 · 꾸밈 · 비밀값 꼴이 알림 글에 그대로 들어가지 않음", async () => {
  const s = await setup();
  await s.run("UPDATE device SET name = ? WHERE id = 'a'", "[확인](https://evil.example) xapp-abc *굵게* <b>x</b>");
  assert.equal((await s.call("/api/device/overlay", { tok: "a", body: CSS })).status, 200);
  const text = String((await s.q("SELECT text FROM board_log WHERE owner = ? AND kind = 'sys'", MEMBER))?.text);
  for (const bad of ["[", "](", "://", "xapp-", "*", "<", ">"]) assert.ok(!text.includes(bad), `${bad} 없음: ${text}`);
  assert.match(text, /화면 덧씌우기를 바꿨어요/);
  await s.run("UPDATE device SET name = ? WHERE id = 'a'", "  ");
  await s.call("/api/device/prompts", { tok: "a", body: { main: "x" } });
  assert.match(String((await s.q("SELECT text FROM board_log WHERE owner = ? AND text LIKE '%역할 글%'", MEMBER))?.text), /이름 없음/);
});

test("알림이 실패하면 삼키지 않고 한 줄 남기며 저장은 그대로 성공", async () => {
  const s = await setup({ relay: true }); failTool = true;
  const errs: string[] = [], orig = console.error; console.error = (...a: unknown[]) => { errs.push(a.join(" ")); };
  try {
    assert.equal((await s.call("/api/device/overlay", { tok: "o", body: CSS })).status, 200);
    assert.equal((await s.call("/api/device/prompts", { tok: "o", body: { main: "x" } })).status, 200);
  } finally { console.error = orig; failTool = false; }
  assert.equal(errs.filter(e => /기기 알림 못 올림 relay/.test(e)).length, 2);
  assert.equal((await s.q("SELECT css FROM person_custom WHERE owner = ?", OWNER))?.css, "a{color:red}");
});

test("래퍼 js: 동의 해시가 없거나 다르면 400(저장 안 됨), 맞으면 저장되고 래퍼 칸에만 들어감", async () => {
  const s = await setup(), js = "window.x=1;";
  for (const consent of [undefined, "0".repeat(64), await sha("다른 글")]) {
    const r = await s.call("/api/device/overlay", { tok: "a", body: { slot: "wrapper", set: { js }, ...(consent ? { consent } : {}) } }); assert.equal(r.status, 400);
  }
  assert.equal(await s.q("SELECT 1 x FROM person_custom"), null);
  await s.grant("a");
  assert.equal((await s.call("/api/device/overlay", { tok: "a", body: { slot: "wrapper", set: { js }, consent: await sha(js) } })).status, 200);
  const row = await s.q("SELECT js, wjs, wjs_sha FROM person_custom WHERE owner = ?", MEMBER);
  assert.deepEqual([row?.js, row?.wjs, row?.wjs_sha], [null, js, await sha(js)]);
  // 틀린 꼴
  for (const body of [{ slot: "x", set: { css: "a" } }, { slot: "mine", set: { zz: "a" } }, { slot: "mine", set: { side: {} } }, { slot: "mine", set: {} }, { slot: "mine", set: { css: "x".repeat(200_001) } }, { slot: "wrapper", set: { side: { side: ["zz"] } } }])
    assert.equal((await s.call("/api/device/overlay", { tok: "a", body })).status, 400, JSON.stringify(body).slice(0, 60));
  assert.equal((await s.call("/api/device/prompts", { tok: "a", body: { roles: [{ id: "../x", name: "a", instructions: "i" }] } })).status, 400);
  assert.equal((await s.call("/api/device/prompts", { tok: "a", body: {} })).status, 400);
});

test("웹 길 같은 사이트 검사: x-hb 없으면 쓰기(POST · DELETE) 403, 읽기는 로그인만 · 로그인 없으면 401", async () => {
  const s = await setup();
  assert.equal((await s.web("/api/me/overlay", MEMBER, { method: "POST", body: { css: "a{}" } })).status, 403);
  assert.equal((await s.web("/api/me/overlay", MEMBER, { method: "DELETE" })).status, 403);
  assert.equal(await s.q("SELECT 1 x FROM person_custom"), null);
  assert.equal((await s.web("/api/me/overlay", MEMBER, { method: "POST", site: true, body: { css: "a{}", js: "1" } })).status, 200);
  const g = await (await s.web("/api/me/overlay", MEMBER)).json() as { css: string; js: string }; assert.deepEqual([g.css, g.js], ["a{}", "1"]);
  assert.equal((await s.call("/api/me/overlay", { method: "GET" })).status, 401, "로그인 없이 읽기");
  assert.equal((await s.call("/api/me/overlay", { site: true, body: { css: "a{}" } })).status, 401, "로그인 없이 쓰기");
  assert.equal((await s.web("/api/me/overlay", MEMBER, { method: "POST", site: true, body: { css: 5 } })).status, 400);
});

test("DELETE: 기본은 내 칸만, ?all=1 이면 래퍼 칸(css · js · 사이드)까지", async () => {
  const s = await setup(), js = "1;";
  await s.grant("a");
  await s.call("/api/device/overlay", { tok: "a", body: { slot: "wrapper", set: { css: "w{}", js, side: { side: ["ch"] } }, consent: await sha(js) } });
  await s.call("/api/device/overlay", { tok: "a", body: CSS });
  assert.equal((await s.web("/api/me/overlay", MEMBER, { method: "DELETE", site: true })).status, 200);
  let row = await s.q("SELECT css, wcss, wjs, wjs_sha, wside FROM person_custom WHERE owner = ?", MEMBER);
  assert.equal(row?.css, null); assert.equal(row?.wcss, "w{}"); assert.equal(row?.wjs, js); assert.ok(row?.wside);
  assert.equal((await s.web("/api/me/overlay?all=1", MEMBER, { method: "DELETE", site: true })).status, 200);
  row = await s.q("SELECT css, wcss, wjs, wjs_sha, wside FROM person_custom WHERE owner = ?", MEMBER);
  assert.deepEqual([row?.wcss, row?.wjs, row?.wjs_sha, row?.wside], [null, null, null, null]);
});

test("화면에 얹힘: 로그인한 그 사람 것만, ?no_overlay=1 이면 안 얹음", async () => {
  const s = await setup();
  await s.grant("o", OWNER);   // 주인 기기도 js 는 허락 뒤에만
  await s.q("INSERT INTO member_bot (owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?) RETURNING owner", OWNER, "s1", 10, "Primary", "", "", "", Date.now());   // 주인(canon) 메인 봇 줄 — 없으면 온보딩
  assert.equal((await s.call("/api/device/overlay", { tok: "o", body: { slot: "mine", set: { css: ".x{}", js: "window.__o=1" } } })).status, 200);
  const on = await (await s.web("/", OWNER)).text();
  assert.match(on, /id="hb-overlay-css"/); assert.match(on, /id="hb-overlay-js"/);
  const off = await (await s.web("/?no_overlay=1", OWNER)).text();
  assert.doesNotMatch(off, /hb-overlay/);
});

test("허락 없는 회원 기기: js 쓰기(내 칸 · 래퍼 칸, 동의 해시를 맞춰도) 403 · 값 안 바뀜 / css 와 같이 보내도 아무것도 안 씀", async () => {
  const s = await setup(), js = "fetch('/api/me/cards/1.1/answer',{method:'POST',headers:{'x-hb':'1'},body:JSON.stringify({choice:'허용'})})";
  for (const body of [{ slot: "mine", set: { js } }, { slot: "wrapper", set: { js }, consent: await sha(js) }, { slot: "mine", set: { css: "a{}", js } }]) {
    const r = await s.call("/api/device/overlay", { tok: "a", body }); assert.equal(r.status, 403, JSON.stringify(body).slice(0, 60));
    const j = await r.json() as { ok: boolean; error: string; hint: string };
    assert.equal(j.error, "not_allowed"); assert.match(j.hint, /boarder settings allow/);
  }
  assert.equal(await s.q("SELECT 1 x FROM person_custom"), null, "아무것도 안 저장됨");
  assert.equal(await s.q("SELECT 1 x FROM board_log WHERE owner = ? AND text LIKE '%화면 덧씌우기%'", MEMBER), null, "저장 안 했으면 알림 줄도 없음");
});

test("허락 뒤: 그 기기의 js 쓰기만 200 — 다른 기기로 안 번짐 · 거둔 뒤 다시 403", async () => {
  const s = await setup(), js = "window.__m=1";
  await s.grant("a");
  assert.equal((await s.call("/api/device/overlay", { tok: "b", body: { slot: "mine", set: { js } } })).status, 403, "다른 기기는 따로 허락");
  assert.equal((await s.call("/api/device/overlay", { tok: "a", body: { slot: "mine", set: { js } } })).status, 200);
  assert.equal((await s.q("SELECT js FROM person_custom WHERE owner = ?", MEMBER))?.js, js);
  assert.equal((await s.call("/api/device/overlay", { tok: "a", body: { slot: "wrapper", set: { js }, consent: await sha(js) } })).status, 200);
  await s.run("DELETE FROM user_pref WHERE k = 'cli_settings:a'");
  assert.equal((await s.call("/api/device/overlay", { tok: "a", body: { slot: "mine", set: { js: "window.__m=2" } } })).status, 403, "거둔 뒤");
  assert.equal((await s.q("SELECT js FROM person_custom WHERE owner = ?", MEMBER))?.js, js);
});

test("허락 없어도 되는 것: css · js 비우기(boarder view overlay off · ui off) · 지금과 같은 js 다시 보내기 · 읽기 · 같은 사이트 회원 화면 / 주인 기기는 허락 뒤에만", async () => {
  const s = await setup(), js = "window.__k=1";
  assert.equal((await s.call("/api/device/overlay", { tok: "a", body: { slot: "mine", set: { css: "a{}" } } })).status, 200);
  assert.equal((await s.call("/api/device/overlay", { method: "GET", tok: "a" })).status, 200);
  assert.equal((await s.web("/api/me/overlay", MEMBER, { method: "POST", site: true, body: { js } })).status, 200, "회원 화면 길은 그대로");
  assert.equal((await s.call("/api/device/overlay", { tok: "a", body: { slot: "mine", set: { js } } })).status, 200, "지금 값과 같으면 바뀌는 게 없음");
  assert.equal((await s.call("/api/device/overlay", { tok: "a", body: { slot: "mine", set: { css: null, js: null } } })).status, 200, "끄기는 늘 됨");
  assert.equal((await s.q("SELECT js FROM person_custom WHERE owner = ?", MEMBER))?.js || "", "");
  assert.equal((await s.call("/api/device/overlay", { tok: "a", body: { slot: "wrapper", set: { js: null } } })).status, 200, "래퍼 js 끄기도");
  assert.equal((await s.call("/api/device/overlay", { tok: "o", body: { slot: "mine", set: { js } } })).status, 403, "주인 기기도 허락 없으면 js 못 올림");
  await s.grant("o", OWNER);
  assert.equal((await s.call("/api/device/overlay", { tok: "o", body: { slot: "mine", set: { js } } })).status, 200, "허락 뒤 주인 기기");
  assert.equal((await s.call("/api/device/overlay", { tok: "o", body: { slot: "wrapper", set: { js, side: { pins: [{ id: "abcd1234", title: "x" }] } }, consent: await sha(js) } })).status, 200);
});

test("래퍼 side.pins: 허락 없으면 고정 캔버스 값을 바꾸는 쓰기 403(넣기 · 바꾸기 · 지우기) · 값 안 바뀜 / 순서만 · 같은 값은 200 / 허락 뒤 200", async () => {
  const s = await setup(), pins = [{ id: "abcd1234", title: "캔버스" }], wside = async () => (await s.q("SELECT wside FROM person_custom WHERE owner = ?", MEMBER))?.wside as string | undefined;
  const put = (side: unknown, tok = "a") => s.call("/api/device/overlay", { tok, body: { slot: "wrapper", set: { side } } });
  assert.equal((await put({ pins })).status, 403);
  assert.equal(await wside(), undefined, "안 바뀜");
  assert.equal((await put({ side: ["ch"] })).status, 200, "칸 순서만은 그대로 됨");
  await s.grant("a");
  assert.equal((await put({ side: ["ch"], pins })).status, 200, "허락 뒤");
  const saved = await wside(); assert.match(String(saved), /abcd1234/);
  assert.equal((await put({ side: ["nd"], pins }, "b")).status, 200, "허락 없는 기기도 pins 가 그대로면 됨(래퍼 받기가 같은 값을 다시 올림)");
  const kept = await wside();
  for (const side of [{ pins: [{ id: "zzzz9999", title: "남의 캔버스" }] }, { side: ["ch"] }, null]) {
    assert.equal((await put(side, "b")).status, 403, JSON.stringify(side));
    assert.equal(await wside(), kept, "안 바뀜");
  }
});
