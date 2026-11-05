import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
(globalThis as any).HTMLRewriter ??= class { on() { return this; } transform(r: Response) { return r; } };
const OW = await import("./owner-write.ts");
const FILES = await import("./files.ts");
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
const CV = "Cv0000000000000001xxxx", PG = "Pg0000000000000001xxxx";
const ix = { v: 1, at: 0, blobs: {}, shim: "", arts: {
  [CV]: { kind: "canvas", title: "가상 캔버스", at: "1", acct: "d", auto: "디자인", cv: "project" },
  [PG]: { kind: "page", title: "가상 페이지", at: "2", acct: "d", auto: "기타", main: "index.html" } } };
const R2 = { get: async (k: string) => k === "art/_sys/index.json" ? { json: async () => ix } : k === `art/${CV}/project/canvas.json` ? { text: async () => JSON.stringify({ boards: { "A.dc.html": {}, "B.dc.html": {} } }) } : null, head: async () => null } as unknown as R2Bucket;

test("고정 별 · 썸네일 판: 칸 하나씩 바꾸고 wl_change 에 남고, 없는 판은 400, 목록(/api/arts)에 pin · thumb", async () => {
  const { db, D1 } = d1(), env = { DB: D1, RESULTS: R2 } as never;
  const row = () => db.prepare("SELECT pin, thumb FROM wl_art_pref WHERE art = ?").get(CV) as any;
  assert.deepEqual(await OW.artstar(env, { art: CV, on: true }), [200, { ok: true, pin: true }]);
  assert.deepEqual(await OW.artthumb(env, { art: CV, board: "B.dc.html" }), [200, { ok: true, thumb: "B.dc.html" }]);
  assert.deepEqual({ ...row() }, { pin: 1, thumb: "B.dc.html" });   // 한 칸을 바꿔도 다른 칸 그대로
  assert.equal((await OW.artthumb(env, { art: CV, board: "Z.dc.html" }) as any)[0], 400);
  assert.equal(row().thumb, "B.dc.html");
  assert.equal((await OW.artthumb(env, { art: PG, board: "x.html" }) as any)[0], 404);   // 페이지는 판이 없음
  assert.equal((await OW.artstar(env, { art: "nope" }) as any)[0], 404);
  const ch = db.prepare("SELECT tbl, pk, op, origin FROM wl_change WHERE tbl = 'art_pref'").all() as any[];
  assert.ok(ch.length >= 2 && ch.every(c => c.pk === JSON.stringify([CV]) && c.origin === "web"));
  // 읽기: 주인 /api/arts
  const o = await FILES.answer(env, "/api/arts", {});
  const j = JSON.parse(new TextDecoder().decode(o!.body));
  assert.deepEqual([j[CV].pin, j[CV].thumb, j[PG].pin, j[PG].thumb], [true, "B.dc.html", false, ""]);
  // 되돌림: '' = 첫 판, 별 끄기
  await OW.artthumb(env, { art: CV, board: "" }); await OW.artstar(env, { art: CV, on: false });
  assert.deepEqual({ ...row() }, { pin: 0, thumb: "" });
});

test("같은 rid 로 다시 보낸 별은 한 번만 쓰고, 길 이름 /api/artstar · /api/artthumb 이 앱에서 주인 쓰기로 감", async () => {
  const { db, D1 } = d1(), env = { DB: D1, RESULTS: R2 } as never;
  const rid = "r" + "2".repeat(20);
  const n = () => (db.prepare("SELECT count(*) n FROM wl_change WHERE tbl = 'art_pref'").get() as any).n;
  await OW.artstar(env, { art: CV, on: true }, rid); const first = n();   // 트리거 줄 + 명시 줄(artfolder 와 같은 꼴)
  await OW.artstar(env, { art: CV, on: true }, rid);
  assert.equal(n(), first, "같은 rid 를 다시 보내면 쓰지 않음");
  // 로그인 없으면 401(길이 앱에 물려 있음)
  const r = await app.fetch(new Request("https://example.test/api/artstar", { method: "POST", headers: { "content-type": "application/json", "x-hb": "1" }, body: "{}" }), { DB: D1, RESULTS: R2, BETTER_AUTH_SECRET: "s", ALLOW_EMAILS: "o@example.test" } as never, { waitUntil() {}, passThroughOnException() {} } as never);
  assert.ok([401, 403].includes(r.status), String(r.status));
});
