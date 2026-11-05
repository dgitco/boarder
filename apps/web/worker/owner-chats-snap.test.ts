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


const OWNER = "owner@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie(email: string) {
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
function setup(snapAt: number) {
  const { D1 } = d1(), calls: string[] = [];
  const call = async (r: { path: string }) => { calls.push(r.path); return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"chats":[{"sid":"bridge"}]}') }; };
  const body = '{"chats":[{"sid":"snap"}]}';
  const SNAP = { idFromName: (n: string) => n, get: () => ({ get: async (k: string) => k === "chats" ? { body, etag: '"e1"', at: snapAt, checked: snapAt } : null }) };
  const env = { DB: D1, SNAP, ASSETS: { fetch: async () => new Response("nf") }, BRIDGE: { idFromName: (n: string) => n, get: () => ({ call }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const get = async (path: string) => app.fetch(new Request("https://example.test" + path, { headers: { cookie: await cookie(OWNER) } }), env as never, { waitUntil() {}, passThroughOnException() {} } as never);
  return { calls, get };
}
test("주인 세션 목록: 새 스냅숏이면 다리 안 감", async () => {
  const t = setup(Date.now());
  const r = await t.get("/api/chats");
  assert.equal(r.status, 200);
  assert.equal((await r.json() as { chats: { sid: string }[] }).chats[0].sid, "snap");
  assert.equal(t.calls.length, 0);
});
test("주인 세션 목록: 스냅숏이 낡았으면 다리로", async () => {
  const t = setup(Date.now() - 60_000);
  const r = await t.get("/api/chats");
  assert.equal((await r.json() as { chats: { sid: string }[] }).chats[0].sid, "bridge");
  assert.deepEqual(t.calls, ["/api/chats"]);
});
