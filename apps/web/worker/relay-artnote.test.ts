import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
(globalThis as any).HTMLRewriter ??= class { on() { return this; } transform(r: Response) { return r; } };
const OW = await import("./owner-write.ts");
const { default: app } = await import("./index.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])).map(r => ({ ...r })), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
  });
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = []; for (const s of ss) o.push(await s.all()); db.exec("COMMIT"); return o; } catch (e) { db.exec("ROLLBACK"); throw e; } } } as unknown as D1Database };
}
const CV = "Cv0000000000000613xxxx";
const ix = { v: 1, at: 0, blobs: {}, shim: "", arts: { [CV]: { kind: "canvas", title: "가상 캔버스", at: "1", acct: "d", auto: "디자인", cv: "project" } } };
const R2 = { get: async (k: string) => k === "art/_sys/index.json" ? { json: async () => ix } : null, head: async () => null } as unknown as R2Bucket;
const ctx = { waitUntil(p: Promise<unknown>) { p?.catch?.(() => {}); }, passThroughOnException() {} } as never;   // 뒤처리(화면 바뀜 알림)는 가짜 env 에 없는 묶음을 읽음 — 시험 밖

test("owner-write artnote: who 를 받으면 그 이름으로 쓰고 지우기도 그 이름만, 기본은 owner · id 는 D1 max+1", async () => {
  const { db, D1 } = d1(), env = { DB: D1, RESULTS: R2 } as never;
  db.prepare("INSERT INTO wl_art_note(id, art, target, page, who, text, at) VALUES (6, ?, 'A.dc.html', '', 'owner', '웹 댓글', 1)").run(CV);
  const [st, body] = await OW.artnote(env, { art: CV, target: "A.dc.html", text: "↳6 답" }, "", "보더 화면") as [number, any];
  assert.equal(st, 200);
  assert.deepEqual(body.notes.map((n: any) => [n.id, n.who, n.text]), [[6, "owner", "웹 댓글"], [7, "보더 화면", "↳6 답"]]);
  await OW.artnote(env, { art: CV, del: 7 }, "");
  assert.equal((db.prepare("SELECT deleted_at FROM wl_art_note WHERE id = 7").get() as any).deleted_at, null);
  await OW.artnote(env, { art: CV, del: 7 }, "", "보더 화면");
  assert.notEqual((db.prepare("SELECT deleted_at FROM wl_art_note WHERE id = 7").get() as any).deleted_at, null);
  const ch = db.prepare("SELECT pk, origin FROM wl_change WHERE tbl = 'art_note'").all() as any[];
  assert.ok(ch.some(c => c.pk === "[7]" && c.origin === "web"), "릴레이가 사본으로 당기게 바뀜 기록");
});

test("POST /api/relay/artnote: 토큰 없으면 403, 이름 없으면 400, 쓰면 D1 이 id 를 정하고 같은 rid 는 한 번", async () => {
  const { db, D1 } = d1();
  const env = { DB: D1, RESULTS: R2, RELAY_TOKEN: "relay-t", LEDGER_TOKEN: "ledger-t" } as never;
  const call = (b: object, tok = "ledger-t") => app.fetch(new Request("https://example.test/api/relay/artnote", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(b) }), env, ctx);
  const mark = (r: Response) => r.headers.get("x-artnote-route");   // 이 길 표시 — 없으면 Python 이 옛 Worker 로 보고 예전 길로 감(안전이 이 머리에 걸림)
  for (const [b, tok, st] of [[{ art: CV, target: "A.dc.html", text: "x", who: "a" }, "wrong", 403], [{ art: CV, target: "A.dc.html", text: "x" }, "ledger-t", 400], [{ art: "nope", target: "A.dc.html", text: "x", who: "a" }, "ledger-t", 404]] as const) {
    const r = await call(b, tok);
    assert.equal(r.status, st); assert.equal(mark(r), "1", `${st} 에도 표시`);
  }
  const bad = { DB: { prepare: () => { throw new Error("d1 down"); }, batch: async () => { throw new Error("d1 down"); } }, RESULTS: R2, LEDGER_TOKEN: "ledger-t" } as never;
  const r503 = await app.fetch(new Request("https://example.test/api/relay/artnote", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer ledger-t" }, body: JSON.stringify({ art: CV, target: "A.dc.html", text: "x", who: "a", rid: "an-" + "9".repeat(20) }) }), bad, ctx);
  assert.equal(r503.status, 503); assert.equal(r503.headers.get("x-retry-safe"), "1"); assert.equal(mark(r503), "1", "다시 보내도 됨(503)에도 표시");
  const rid = "an-" + "1".repeat(20);
  const r1 = await call({ art: CV, target: "A.dc.html", text: "에이전트 답", who: "  보더   화면 ", rid });
  assert.equal(r1.status, 200); assert.equal(mark(r1), "1");
  const j = await r1.json() as any;
  assert.deepEqual(j.notes.map((n: any) => [n.id, n.who]), [[1, "보더 화면"]]);
  assert.equal((await call({ art: CV, target: "A.dc.html", text: "에이전트 답", who: "보더 화면", rid }, "relay-t")).status, 200);   // 릴레이 토큰도 · 다시 보낸 것
  assert.equal((db.prepare("SELECT count(*) n FROM wl_art_note").get() as any).n, 1, "같은 rid 는 한 번만");
});
