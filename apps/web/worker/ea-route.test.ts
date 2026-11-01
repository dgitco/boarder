// node --test --no-warnings --experimental-transform-types apps/web/worker/es-route.test.ts (Node 22.18+ · node:sqlite · apps/web 의존성 설치된 채)
// 비서(/es) 길: 진짜 index.ts(app.fetch) 그대로 — 주인 /es 는 / 와 같은 몸통(다리 path 「/」)에 틀 + BX_EA · ea.js/css, /es/ 는 301 /es, 회원은 302 /, / 몸통엔 BX_EA 없음.
// 가짜 D1 = 메모리 SQLite + migrations 전부, 다리 = 부른 path 를 적어 두는 가짜. HTMLRewriter = head · body 앞뒤에 끼우는 것만 흉내. 자료는 다 지어낸 것.
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
const BOARD = '<!doctype html><html><head><meta charset=utf-8><meta name="apple-mobile-web-app-title" content="보드"></head><body><div class=wrap>보드</div></body></html>';
function bridgeNs(paths: string[]) {
  const te = new TextEncoder();
  const call = async (r: { method: string; path: string }) => {
    paths.push(r.path);
    if (r.path === "/") return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: te.encode(BOARD) };
    return { status: 404, headers: { "content-type": "application/json" }, body: te.encode('{"error":"not found"}') };
  };
  return { idFromName: (n: string) => n, get: () => ({ call }) };
}

const OWNER = "owner@example.test", MEMBER = "member@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email: string) {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
function setup() {
  const { D1 } = d1(), paths: string[] = [];
  const ASSETS = { fetch: async (r: Request) => new Response(new URL(r.url).pathname === "/" ? "<!doctype html><html><head></head><body><div id=root>로그인 화면</div></body></html>" : "nf", { headers: { "content-type": "text/html" } }) };
  const env = { DB: D1, ASSETS, BRIDGE: bridgeNs(paths), BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const get = async (path: string, who: string | null = OWNER, method = "GET") => app.fetch(new Request("https://example.test" + path, { method, redirect: "manual", headers: { accept: "text/html", "sec-fetch-dest": "document", ...(who ? { cookie: await cookie(who) } : {}) } }), env, { waitUntil() {}, passThroughOnException() {} });
  return { paths, get };
}

test("주인 /es: / 와 같은 몸통(다리 path 「/」)에 틀 + head 맨 앞 BX_EA · ea.css · ea.js · ea-secret.js(틀 스크립트 뒤)", async () => {
  const { paths, get } = setup();
  const r = await get("/es");
  assert.equal(r.status, 200);
  assert.deepEqual(paths, ["/"], "다리에 /es 가 아니라 / 로 물어야 함");
  const html = await r.text();
  assert.ok(html.includes("보드"), "보드 몸통");
  assert.match(html, /<head[^>]*><script>window\.BX_EA=1<\/script>/, "BX_EA 가 head 맨 앞");
  assert.ok(html.includes("window.HB_HASH0"), "틀 머리 글");
  assert.equal(r.headers.get("content-security-policy"), "frame-ancestors 'self'");
  assert.equal(r.headers.get("clear-site-data"), '"cache"', "/ 와 같은 한 번 캐시 지우기");
  // ea.css · ea.js 덩어리(/bxs 주소)는 틀 것 뒤에 — / 에는 없는 것
  const root = await (await get("/")).text();
  const css = (h: string) => [...h.matchAll(/\/bxs\/([0-9a-f]{32})\.css/g)].map(m => m[1]), js = (h: string) => [...h.matchAll(/\/bxs\/([0-9a-f]{32})\.js/g)].map(m => m[1]);
  assert.deepEqual(css(html).slice(0, css(root).length), css(root)); assert.equal(css(html).length, css(root).length + 1);
  assert.deepEqual(js(html).slice(0, js(root).length), js(root)); assert.equal(js(html).length, js(root).length + 2);
  const eaJs = await (await get(`/bxs/${js(html).at(-2)}.js`)).text();
  assert.ok(eaJs.includes("window.BX_EA") && eaJs.includes("bx-ea-pins"), "끝에서 둘째 스크립트 = ea.js");
  const secJs = await (await get(`/bxs/${js(html).at(-1)}.js`)).text();
  assert.ok(secJs.includes("BX_EA_SECRET") && secJs.includes("/api/secrets/requests/"), "마지막 스크립트 = ea-secret.js");
  const eaCss = await (await get(`/bxs/${css(html).at(-1)}.css`)).text();
  assert.ok(eaCss.includes("html.bx-ea"), "마지막 css = ea.css");
});

test("주인 / 몸통에는 BX_EA · ea 덩어리 없음", async () => {
  const { get } = setup();
  const r = await get("/");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(!html.includes("BX_EA"));
  assert.ok(!html.includes("hbx-ea-css"));
  assert.ok(!html.includes("api/secret") && !html.includes("bx-ea-pins"), "/ 에는 비밀값 · 고정 원 스크립트 없음");
});

test("HEAD /es 도 / 와 같은 길", async () => {
  const { paths, get } = setup();
  const r = await get("/es", OWNER, "HEAD");
  assert.equal(r.status, 200);
  assert.deepEqual(paths, ["/"]);
});

test("/es/ → 301 /es(상대 주소 api/… 가 깨지지 않게) — 쿼리 그대로, 로그인 전에도", async () => {
  const { get } = setup();
  for (const who of [OWNER, MEMBER, null]) {
    const r = await get("/es/?x=1", who);
    assert.equal(r.status, 301, String(who));
    assert.equal(new URL(r.headers.get("location")!, "https://example.test").pathname + new URL(r.headers.get("location")!, "https://example.test").search, "/es?x=1");
  }
});

test("회원 /es → 302 / (주인 보드 · 다리에 안 감)", async () => {
  const { paths, get } = setup();
  const r = await get("/es", MEMBER);
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get("location")!, "https://example.test").pathname, "/");
  assert.deepEqual(paths, []);
});

test("로그인 안 함 /es → 로그인 화면(React, 주소 그대로 — 들어오면 reload 로 /es 다시)", async () => {
  const { paths, get } = setup();
  const r = await get("/es", null);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes("로그인 화면") && !html.includes("BX_EA"));
  assert.deepEqual(paths, []);
});
