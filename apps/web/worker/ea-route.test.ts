// node --test --no-warnings --experimental-transform-types apps/web/worker/es-route.test.ts (Node 22.18+ · node:sqlite · apps/web 의존성 설치된 채)
// 비서(/es) 길: 진짜 index.ts(app.fetch) 그대로 — 주인 /es 는 / 와 같은 회원 길 몸통(memberPage — 틀 스냅숏 + canon 판, 다리 안 감)에 틀 + BX_EA · ea.js/css, /es/ 는 301 /es, 회원 /es 는 자기 보드 몸통 + 비서 배치, / 몸통엔 BX_EA 없음.
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
  const D1: any = { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => s.all())) };
  D1.withSession = () => D1;
  return { db, D1: D1 as D1Database };
}
const BOARD = '<!doctype html><html><head><meta charset=utf-8><meta name="apple-mobile-web-app-title" content="보드"></head><body><div class=wrap>보드</div></body></html>';
function bridgeNs(paths: string[]) {
  const te = new TextEncoder();
  const call = async (r: { method: string; path: string }) => {
    paths.push(r.path);
    if (r.path.split("?")[0] === "/") return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: te.encode(BOARD) };
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
// 첫 화면 틀(page-template.py 꼴) — 주인 · 회원 같은 틀(memberPage)
const PAGE = JSON.stringify({ ver: "v1", html: '<!doctype html><html><head><meta charset=utf-8><meta name="apple-mobile-web-app-title" content="보드"></head><body><div class=wrap>보드</div><script>window.D = __BX_DATA__; window.T = "__BX_DTAG__"</script></body></html>' });
function setup() {
  const { db, D1 } = d1(), paths: string[] = [];
  db.prepare("INSERT INTO member_bot (owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(OWNER, "s1", 10, "Primary", "", "", "", Date.now());   // 주인(canon) 메인 봇 줄 — 없으면 온보딩
  const snaps: Record<string, string> = { page: PAGE, cfg: JSON.stringify({ channels: { primary: "C1" }, drafts: {} }) };
  const SNAP = { idFromName: (n: string) => n, get: () => ({ get: async (k: string) => k in snaps ? { body: snaps[k], etag: `"e-${k}"`, at: Date.now(), checked: Date.now() } : null, tags: async () => ({ t: {}, age: 0, boot: "b" }), bump: async () => 0 }) };
  const r2 = new Map<string, unknown>();
  const RESULTS = { list: async () => ({ objects: [], truncated: false }), head: async () => null, get: async (k: string) => r2.get(k) ?? null, put: async (k: string, v: unknown) => { r2.set(k, v); }, delete: async (k: string) => { r2.delete(k); } };
  const ASSETS = { fetch: async (r: Request) => new Response(new URL(r.url).pathname === "/" ? "<!doctype html><html><head></head><body><div id=root>로그인 화면</div></body></html>" : "nf", { headers: { "content-type": "text/html" } }) };
  const env = { DB: D1, ASSETS, SNAP, RESULTS, ENGINE: { idFromName: (n: string) => n, get: () => ({}) }, BRIDGE: bridgeNs(paths), BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const get = async (path: string, who: string | null = OWNER, method = "GET") => app.fetch(new Request("https://example.test" + path, { method, redirect: "manual", headers: { accept: "text/html", "sec-fetch-dest": "document", ...(who ? { cookie: await cookie(who) } : {}) } }), env, { waitUntil() {}, passThroughOnException() {} });
  return { paths, get, env };
}

test("주인 /es: / 와 같은 몸통(회원 길 · 다리 0)에 틀 + head 맨 앞 BX_EA · ea.css · ea.js · ea-secret.js(틀 스크립트 뒤)", async () => {
  const { paths, get } = setup();
  const r = await get("/es");
  assert.equal(r.status, 200);
  assert.deepEqual(paths, [], "다리에 안 감");
  assert.equal(r.headers.get("x-boarder-src"), "member");
  const html = await r.text();
  assert.ok(html.includes("보드"), "보드 몸통");
  assert.match(html, /<head[^>]*><script>window\.BX_EA=1<\/script>/, "BX_EA 가 head 맨 앞");
  assert.ok(html.includes("window.HB_HASH0"), "틀 머리 글");
  assert.equal(r.headers.get("content-security-policy"), "frame-ancestors 'self'");
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

test("머리 글 주소 대기: 채팅 · 스레드 · 캔버스 · 노드 · 모아 보기 주소만 bx-route(트리 대신 스피너), 주소는 그대로(#tree 로 안 바꿈) · HB_HASH0 은 원래 주소", async () => {
  const { get } = setup();
  const html = await (await get("/")).text();
  const head = /<script>(window\.HB_HASH0 = [^<]*)<\/script>/.exec(html)?.[1];
  assert.ok(head, "틀 머리 글");
  const run = (hash: string) => {
    const cls = new Set<string>(), w: Record<string, unknown> = {}, loc = { hash };
    const doc = { documentElement: { classList: { add: (c: string) => cls.add(c), remove: (c: string) => cls.delete(c) } } };
    const hist = { state: null, replaceState: (_s: unknown, _t: string, h: string) => { loc.hash = h; } };
    new Function("window", "location", "document", "history", "setTimeout", head!)(w, loc, doc, hist, () => 0);
    return { route: cls.has("bx-route"), boot: cls.has("bx-boot"), hash: loc.hash, h0: w.HB_HASH0 };
  };
  for (const h of ["#chat/primary/1793611111.200000", "#chat/primary", "#art/abcdefghijklmnop", "#node/%2512", "#w/Q-1", "#inbox", "#unread", "#saved", "#drafts", "#settings", "#settings/nodes"]) {
    const r = run(h); assert.ok(r.route && r.boot, h + " → bx-route"); assert.equal(r.h0, h);
  }
  const atPath = (pathname: string, search: string) => { const w: Record<string, unknown> = {}, doc = { documentElement: { classList: { add() {}, remove() {} } } }; new Function("window", "location", "document", "history", "setTimeout", head!)(w, { hash: "", pathname, search }, doc, { state: null, replaceState() {} }, () => 0); const g = globalThis as any, h = g.HB_HASH0; delete g.HB_HASH0; return h; };   // 경로 갈래는 맨 이름 HB_HASH0 에 씀(브라우저에선 window 와 같음)
  assert.equal(atPath("/nodes/abc", "?thread=1793611111.200000"), "#node/abc/1793611111.200000", "새로 고침 · 공유한 노드 스레드 주소");
  assert.equal(atPath("/nodes/abc", "?thread=../x"), "#node/abc", "틀린 스레드 값은 버림");
  assert.equal(atPath("/nodes/abc", ""), "#node/abc");
  for (const h of ["", "#tree", "#timeline", "#arts", "#t=1793611111.200000&c=primary", "#nf"]) assert.equal(run(h).route, false, (h || "빈 주소") + " → 가림막 없음");
  for (const h of ["#chat/primary", "#chat/primary/1793611111.200000", "#art/abcdefghijklmnop", "#node/%2512", "#inbox", "#settings/connectors", "#t=1793611111.200000&c=primary"]) assert.equal(run(h).hash, h, h + " → 주소 그대로(#tree 를 거치지 않게)");
  const css = (await Promise.all([...html.matchAll(/\/bxs\/([0-9a-f]{32})\.css/g)].map(async m => (await get(`/bxs/${m[1]}.css`)).text()))).join("\n");
  assert.ok(css.includes("html.bx-route .wrap{visibility:hidden}") && css.includes("html.bx-route body::after"), "틀 css: 가림막 · 스피너");
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

test("/es/ → 301 /es(상대 주소 api/… 가 깨지지 않게) — 쿼리 그대로, 로그인 전에도", async () => {
  const { get } = setup();
  for (const who of [OWNER, MEMBER, null]) {
    const r = await get("/es/?x=1", who);
    assert.equal(r.status, 301, String(who));
    assert.equal(new URL(r.headers.get("location")!, "https://example.test").pathname + new URL(r.headers.get("location")!, "https://example.test").search, "/es?x=1");
  }
});

test("회원 /es → 자기 화면(주인 보드 · 다리에 안 감) — 메인 봇을 아직 안 골랐으면 온보딩부터", async () => {
  const { paths, get } = setup();
  const r = await get("/es", MEMBER);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes("메인 봇 만들기") && !html.includes("BX_EA"), "첫 회원은 온보딩 한 화면");
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

test("주인 /ea(퍼스널 비서): /es 와 같은 길 · 같은 틀에 BX_EA_MODE=personal, /es 에는 없음", async () => {
  const { paths, get } = setup();
  const r = await get("/ea");
  assert.equal(r.status, 200);
  assert.deepEqual(paths, []);
  const html = await r.text();
  assert.match(html, /<head[^>]*><script>window\.BX_EA=1;window\.BX_EA_MODE="personal"<\/script>/);
  assert.ok(!(await (await get("/es")).text()).includes("BX_EA_MODE"));
});

test("/ea/ → 301 /ea, 회원 /ea → /es(퍼스널 리드가 없음)", async () => {
  const { paths, get } = setup();
  const r = await get("/ea/?x=1");
  assert.equal(r.status, 301);
  assert.equal(new URL(r.headers.get("location")!, "https://example.test").pathname, "/ea");
  const m = await get("/ea", MEMBER);
  assert.equal(m.status, 302);
  assert.equal(new URL(m.headers.get("location")!, "https://example.test").pathname, "/es");
  assert.deepEqual(paths, []);
});

test("보더 화면 경로: /nodes · /chat/<채널>/<스레드> · /canvas/<id> · /inbox · /settings/… = / 와 같은 보드 + 경로 모드 머리(base · HB_PATHS), 비슷한 다른 주소는 아님", async () => {
  for (const p of ["/nodes", "/nodes/%2512", "/chat/primary", "/chat/primary/1793611111.200000", "/chat/team/1793611111.200000?thread=1793600000.100000", "/canvas", "/canvas/abcdefghijklmnop", "/inbox", "/unread", "/timeline", "/settings/nodes", "/w/Q-1", "/nf"]) {
    const { paths, get } = setup();
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.deepEqual(paths, [], p + " → 다리에 안 감");
    assert.equal(r.headers.get("x-boarder-src"), "member", p + " → / 와 같은 회원 길 첫 화면");
    const html = await r.text();
    assert.ok(html.includes('<base href="/">') && html.includes("window.HB_PATHS=1"), p + " → 경로 모드 머리");
  }
  for (const p of ["/canvas/short", "/chatx", "/nodes/a/b/c"]) {
    const { get } = setup();
    const r = await get(p);
    assert.notEqual(r.headers.get("x-boarder-src"), "member", p + " → 보드 아님");
  }
  for (const p of ["/es", "/ea", "/?embed=primary"]) {
    const html = await (await setup().get(p)).text();
    assert.ok(!html.includes("HB_PATHS=1") && !html.includes('<base href="/">'), p + " → 경로 모드 아님");
    assert.ok(html.includes("window.HBR=window.HBR||"), p + " → 기본 HBR 은 있음(틀이 부름)");
  }
});

test("주인 /x(피드 화면): / 와 같은 몸통(회원 길 · 다리 0)에 BX_X · x.css · x.js(틀 뒤), BX_EA · ea 덩어리 · 경로 모드 없음, / 에는 BX_X 없음", async () => {
  const { paths, get } = setup();
  const r = await get("/feed");
  assert.equal(r.status, 200);
  assert.deepEqual(paths, [], "다리에 안 감");
  const html = await r.text();
  assert.match(html, /<head[^>]*><script>window\.BX_X=1<\/script>/, "BX_X 가 head 맨 앞");
  assert.ok(!html.includes("BX_EA") && !html.includes("hbx-ea-css"), "비서 배치 아님");
  assert.ok(!html.includes("HB_PATHS=1"), "경로 모드 아님(주소 /x 를 지킴)");
  const root = await (await get("/")).text();
  assert.ok(!root.includes("BX_X") && !root.includes("hbx-x-css"));
  const css = (h: string) => [...h.matchAll(/\/bxs\/([0-9a-f]{32})\.css/g)].map(m => m[1]), js = (h: string) => [...h.matchAll(/\/bxs\/([0-9a-f]{32})\.js/g)].map(m => m[1]);
  assert.deepEqual(css(html).slice(0, css(root).length), css(root)); assert.equal(css(html).length, css(root).length + 1);
  assert.deepEqual(js(html).slice(0, js(root).length), js(root)); assert.equal(js(html).length, js(root).length + 1);
  assert.ok((await (await get(`/bxs/${js(html).at(-1)}.js`)).text()).includes("window.BX_X"), "마지막 스크립트 = x.js");
  assert.ok((await (await get(`/bxs/${css(html).at(-1)}.css`)).text()).includes("html.bx-x"), "마지막 css = x.css");
});

test("/feed/ → 301 /feed, 옛 /x → 301 /feed, 회원 /feed → 자기 화면(다리에 안 감), 로그인 안 함 → 로그인 화면", async () => {
  const { paths, get } = setup();
  const r = await get("/feed/?a=1", null);
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "/feed?a=1");
  for (const old of ["/x?a=1", "/x/?a=1"]) { const o = await get(old, null); assert.equal(o.status, 301); assert.equal(o.headers.get("location"), "/feed?a=1"); }
  const m = await get("/feed", MEMBER);
  assert.equal(m.status, 200);
  assert.ok((await m.text()).includes("메인 봇 만들기"), "첫 회원은 온보딩");
  const n = await get("/feed", null);
  assert.ok((await n.text()).includes("로그인 화면"));
  assert.deepEqual(paths, []);
});

test("UUID 주소: 받기는 늘 · 스위치 write_uid_links 켜면 옛 꼴 · 대문자 → 301 새 주소 + 화면에 HB_UIDGEN, 끄면 옛 꼴 그대로 200", async () => {
  const U = await import("./uid.ts"), L = await import("./ledger.ts");
  const cp = U.keyUid("c", "primary"), cd = U.keyUid("c", "team"), t1 = U.msgUid("1793611111.200000"), t0 = U.msgUid("1793600000.100000"), ca = U.keyUid("a", "abcdefghijklmnop");
  const fresh = ["/chat/" + cp, `/chat/${cp}/${t1}`, `/chat/${cd}/${t1}?thread=${t0}`, `/canvas/${ca}`];
  { const s = setup(); await L.setFlag(s.env.DB as never, U.GEN_FLAG, false);
    for (const p of [...fresh, "/chat/primary/1793611111.200000", "/canvas/abcdefghijklmnop"]) { const r = await s.get(p); assert.equal(r.status, 200, "꺼짐 " + p); assert.ok(!(await r.text()).includes("HB_UIDGEN"), "꺼짐 = 만들기 안 함 " + p); } }
  const s = setup(); await L.setFlag(s.env.DB as never, U.GEN_FLAG, true);
  for (const [p, to] of [["/chat/primary", `/chat/${cp}`], ["/chat/primary/1793611111.200000", `/chat/${cp}/${t1}`], ["/chat/team/1793611111.200000?thread=1793600000.100000", `/chat/${cd}/${t1}?thread=${t0}`],
    ["/canvas/abcdefghijklmnop", `/canvas/${ca}`], [`/chat/${cp.toUpperCase()}/${t1.toUpperCase()}`, `/chat/${cp}/${t1}`], [`/canvas/${ca.toUpperCase()}`, `/canvas/${ca}`]]) {
    const r = await s.get(p), l = new URL(r.headers.get("location") || "/", "https://x");
    assert.equal(r.status, 301, p); assert.equal(l.pathname + l.search, to, p);
  }
  for (const p of fresh) { const r = await s.get(p); assert.equal(r.status, 200, p); const h = await r.text(); assert.ok(h.includes("window.HB_UIDGEN=1") && h.includes("window.HB_PATHS=1"), p); }
  await L.setFlag(s.env.DB as never, U.GEN_FLAG, false);
});

test("옛 /m/ 글 주소(스위치 켬): 36진 꼴은 계산으로 · 읽히는 번호 꼴은 주인 로그인만 D1 대응표로 301 새 UUID 주소, 회원 · 로그인 없음은 번호를 안 풂", async () => {
  const U = await import("./uid.ts"), L = await import("./ledger.ts");
  const s = setup(); await L.setFlag(s.env.DB as never, U.GEN_FLAG, true);
  const R = "1793850000.638028", M = "1793862790.000100", cp = U.keyUid("c", "primary"), cn = U.keyUid("c", "company");
  for (const [id, at, th] of [[R, 1793850000.638028, null], [M, 1793862790.0001, R]] as const) await s.env.DB.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, text, at, source) VALUES (?, 'primary', ?, 'owner', 'x', ?, 'board')").bind(id, th, at).run();
  await s.env.DB.prepare("INSERT INTO wl_talk_alias(id, alias, at) VALUES (?, '2026-1105-38', ?)").bind(R, 1793850000).run();
  const loc = (r: Response) => { const l = new URL(r.headers.get("location") || "/", "https://x"); return l.pathname + l.search; };
  let r = await s.get("/m/2026-1105-38-" + encodeURIComponent("제목"));
  assert.equal(r.status, 301); assert.equal(loc(r), `/chat/${cp}/${U.msgUid(R)}`, "번호 꼴(주인)");
  r = await s.get("/m/2026-1105-38.1"); assert.equal(r.status, 301); assert.equal(loc(r), `/chat/${cp}/${U.msgUid(M)}?thread=${U.msgUid(R)}`, "답 번호");
  r = await s.get(`/m/n${(1793850000638028).toString(36)}-x`, null); assert.equal(r.status, 301); assert.equal(loc(r), `/chat/${cn}/${U.msgUid(R)}`, "36진 꼴은 로그인 없이도(계산만)");
  r = await s.get("/m/2026-1105-38", null); assert.notEqual(r.status, 301, "로그인 없음은 번호를 안 풂");
  r = await s.get("/m/2026-1105-38", MEMBER); assert.notEqual(r.status, 301, "회원은 주인 번호를 안 풂");
  r = await s.get("/m/2026-1105-99"); assert.notEqual(r.status, 301, "없는 번호는 화면 길 그대로");
  await L.setFlag(s.env.DB as never, U.GEN_FLAG, false);
  r = await s.get("/m/2026-1105-38"); assert.notEqual(r.status, 301, "스위치 꺼짐 = 예전 그대로");
});
