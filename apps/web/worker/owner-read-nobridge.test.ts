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
const db = new DatabaseSync(":memory:");
for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
const NOW = Date.now() / 1000, ROOT = "1703300000.000100";
db.prepare("INSERT INTO wl_talk_chan(id, name, slack_channel) VALUES ('primary', 'primary', 'C2')").run();
const m = db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, 'primary', ?, ?, ?, ?, ?, ?, 'cli')");
m.run(ROOT, null, "agent", "도우미", "p1", "뿌리 글", NOW - 100);
m.run("1703300000.000200", ROOT, "agent", "도우미", "p1", "답 글", NOW - 90);
for (const f of ["read_chat", "read_cards", "read_live", "read_page", "read_log", "read_misc"]) db.prepare("INSERT INTO f7_flag(name, on_at) VALUES (?, ?)").run(f, Date.now());
const stmt = (sql: string, args: unknown[] = []): any => ({
  sql, args, bind: (...a: unknown[]) => stmt(sql, a.map(x => typeof x === "boolean" ? Number(x) : x)),
  all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
  first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
  raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
  run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
});
const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => s.all())), withSession: () => D1 } as unknown as D1Database;

const OWNER = "owner@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email: string) {
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
const CFG = JSON.stringify({ channels: { primary: "C2" }, drafts: {}, push_key: "made-up-key" });
const PAGE = JSON.stringify({ ver: "v1", html: '<!doctype html><html><head></head><body><script>window.D = __BX_DATA__; window.T = "__BX_DTAG__"</script></body></html>' });
// age = 모든 스냅숏의 나이(ms). 기본 10분 — 예전 기준(스냅숏 15초 · cfg 2분 · 사본 30초)을 다 넘김
function setup(o: { age?: number; noCfg?: boolean; syncAge?: number } = {}) {
  const calls: string[] = [], at = Date.now() - (o.age ?? 600_000), syncAt = Date.now() - (o.syncAge ?? 5_000);
  const call = async (r: { path: string }) => { calls.push(r.path); return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"from":"bridge"}') }; };
  const snaps: Record<string, string> = { data: '{"from":"snap-data"}', topics: '{"from":"snap-topics"}', chats: '{"chats":[{"sid":"snap"}]}', page: PAGE, sync: "{}", history: '{"oldest":0,"rows":[]}', ...(o.noCfg ? {} : { cfg: CFG }) };
  const SNAP = { idFromName: (n: string) => n, get: () => ({
    get: async (k: string) => k in snaps ? { body: snaps[k], etag: `"e-${k}"`, at: k === "sync" ? syncAt : at, checked: k === "sync" ? syncAt : at } : null,
    tags: async () => ({ t: { data: "d1" }, age: 0, boot: "b" }), bump: async () => 0,
  }) };
  const env = { DB: D1, SNAP, RESULTS: { head: async () => null, put: async () => null, get: async () => null }, ASSETS: { fetch: async () => new Response("nf") },
    BRIDGE: { idFromName: (n: string) => n, get: () => ({ call }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const get = async (path: string, extra = "") => app.fetch(new Request("https://example.test" + path, { headers: { cookie: (await cookie(OWNER)) + extra } }), env as never, { waitUntil() {}, passThroughOnException() {} } as never);
  return { calls, get };
}

for (const p of ["/api/chat/primary", `/api/chat/primary/${ROOT}`, `/api/chat/primary?before=${ROOT}`, "/api/inbox", "/api/nodechat?w=" + encodeURIComponent("보더 일")]) {
  test(`주인 ${p}: cfg 가 10분 낡고 방금 썼어도(bx_w) 다리 0 · D1 답 · 나이 머리`, async () => {
    const t = setup();
    const r = await t.get(p, "; bx_w=1");
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(r.headers.get("x-f7"), "d1");
    assert.ok(Number(r.headers.get("x-cfg-age")) >= 600_000, "cfg 나이 머리");
    assert.ok(r.headers.get("x-sync-age") !== null, "사본 나이 머리");
    assert.deepEqual(t.calls, []);
  });
}
test("주인 스레드: D1 답에 뿌리 · 답 글이 다 있음", async () => {
  const t = setup();
  const j = await (await t.get(`/api/chat/primary/${ROOT}`)).json() as { messages: { text: string }[] };
  assert.deepEqual(j.messages.map(x => x.text), ["뿌리 글", "답 글"]);
  assert.deepEqual(t.calls, []);
});
for (const [p, from] of [["/api/data", "snap-data"], ["/api/topics", "snap-topics"]]) {
  test(`주인 ${p}: 스냅숏이 10분 낡고 방금 썼어도(bx_w) 다리 0 · x-snap-age`, async () => {
    const t = setup();
    const r = await t.get(p, "; bx_w=1");
    assert.equal(r.status, 200);
    assert.equal((await r.json() as { from: string }).from, from);
    assert.ok(Number(r.headers.get("x-snap-age")) >= 600_000);
    assert.deepEqual(t.calls, []);
  });
}
test("주인 첫 화면(/): 틀 · data 가 10분 낡아도 다리 0 · x-snap-age", async () => {
  const t = setup();
  const r = await t.get("/");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /snap-data/);
  assert.ok(Number(r.headers.get("x-snap-age")) >= 600_000);
  assert.deepEqual(t.calls, []);
});
for (const p of ["/chat/api/live", "/canvas/api/live", "/chat/primary/api/live", "/nodes/api/live"]) {
  test(`옛 탭의 상대 라이브 주소 ${p}: /api/live 와 같은 답 · 다리 0`, async () => {
    const t = setup();
    const r = await t.get(p);
    assert.equal(r.status, 200);
    assert.equal((await r.json() as { t: { data: string } }).t.data, "d1");
    assert.deepEqual(t.calls, []);
  });
}
// 남은 다리 길(까닭이 있는 것)
test("남김: cfg 스냅숏이 아예 없으면 채널은 다리로(채널 표를 모름)", async () => {
  const t = setup({ noCfg: true });
  await t.get("/api/chat/primary");
  assert.deepEqual(t.calls, ["/api/chat/primary"]);
});
test("남김: 세션 목록은 방금 쓴 사람(bx_w)만 다리로 — 낡은 스냅숏은 다리 0", async () => {
  const t = setup();
  const r = await t.get("/api/chats");
  assert.equal((await r.json() as { chats: { sid: string }[] }).chats[0].sid, "snap");
  assert.deepEqual(t.calls, []);
  await t.get("/api/chats", "; bx_w=1");
  assert.deepEqual(t.calls, ["/api/chats"]);
});

test("남김: 장부 사본 올리기가 1분 넘게 멈추면 채널은 다리로(사본에만 든 새 글이 D1 에 안 보이니 — 고장 때만)", async () => {
  const t = setup({ syncAge: 120_000 });
  await t.get("/api/chat/primary");
  assert.deepEqual(t.calls, ["/api/chat/primary"]);
});
for (const p of ["/api/history", "/api/push/key", "/api/drafts"]) {
  test(`주인 ${p}: 스냅숏이 10분 낡아도 다리 0`, async () => {
    const t = setup();
    const r = await t.get(p, "; bx_w=1");
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(t.calls, []);
  });
}
