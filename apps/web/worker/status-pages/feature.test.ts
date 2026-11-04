// node --test --no-warnings --experimental-transform-types apps/web/worker/status-pages/feature.test.ts — 설정 › 기능 API 계약(기본 꺼짐 · 자기 값만 · 배포 끄기)
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { Hono } from "hono";
registerHooks({ resolve(spec, ctx, next) { try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(spec + ".ts", ctx); throw e; } } });
const { mountFeatures } = await import("./routes.ts");
const { featOn } = await import("./feature.ts");
const { d1 } = await import("./test-db.mjs");
const A = "minji@example.com", B = "junho@example.com";
function setup(FLAGS_OFF = "") {
  const f = d1(), app = new Hono();
  mountFeatures(app as never, async c => c.req.header("x-test-user") || null);
  const call = (who: string | null, method: string, path: string, body?: unknown, hb = true) => app.request(path, { method, headers: { ...(who ? { "x-test-user": who } : {}), ...(hb ? { "x-hb": "1" } : {}), "content-type": "application/json" }, ...(body === undefined ? {} : body instanceof ReadableStream ? { body, duplex: "half" } : { body: JSON.stringify(body) }) } as RequestInit, { DB: f.D1, FLAGS_OFF } as never);
  return { ...f, call };
}
test("로그인 없이는 읽기 · 쓰기 401", async () => {
  const { call } = setup();
  assert.equal((await call(null, "GET", "/api/me/features")).status, 401);
  assert.equal((await call(null, "POST", "/api/me/features", { k: "taskboard", on: true })).status, 401);
});
test("기본은 둘 다 꺼짐", async () => {
  const { call } = setup();
  const j = await (await call(A, "GET", "/api/me/features")).json();
  assert.deepEqual([j.taskboard, j.devboard], [false, false]);
});
test("켜기는 같은 사이트 머리(x-hb)가 있어야 — 없으면 403, 값은 그대로", async () => {
  const { call, D1 } = setup();
  assert.equal((await call(A, "POST", "/api/me/features", { k: "taskboard", on: true }, false)).status, 403);
  assert.equal(await featOn(D1, A, "taskboard"), false);
});
test("모르는 이름 · 참거짓 아닌 값 · 객체 원형 이름은 400", async () => {
  const { call } = setup();
  for (const b of [{ k: "toString", on: true }, { k: "taskboard", on: "1" }, { k: "x", on: true }, null]) assert.equal((await call(A, "POST", "/api/me/features", b)).status, 400, JSON.stringify(b));
});
test("켠 사람 것만 켜짐 — 다른 사람 값은 그대로", async () => {
  const { call, D1 } = setup();
  const j = await (await call(A, "POST", "/api/me/features", { k: "taskboard", on: true })).json();
  assert.equal(j.taskboard, true); assert.equal(j.devboard, false);
  assert.equal(await featOn(D1, A, "taskboard"), true);
  assert.equal(await featOn(D1, B, "taskboard"), false);
  assert.equal((await (await call(B, "GET", "/api/me/features")).json()).taskboard, false);
  await call(A, "POST", "/api/me/features", { k: "taskboard", on: false });
  assert.equal(await featOn(D1, A, "taskboard"), false);
});
test("배포에서 끈 기능(FLAGS_OFF)은 켤 수 없고(409) 켜 둔 사람도 꺼진 것으로", async () => {
  const on = setup(); await on.call(A, "POST", "/api/me/features", { k: "devboard", on: true });
  assert.equal(await featOn(on.D1, A, "devboard", "devboard"), false);
  const { call } = setup("cli_profiles,devboard");
  assert.equal((await call(A, "POST", "/api/me/features", { k: "devboard", on: true })).status, 409);
  const j = await (await call(A, "GET", "/api/me/features")).json();
  assert.deepEqual(j.off, ["devboard"]);
});
test("켜기/끄기 몸 크기 상한: content-length 없는 큰 몸은 413, 값은 그대로", async () => {
  const { call, D1 } = setup(); let n = 0;
  const r = await call(A, "POST", "/api/me/features", new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode("x".repeat(65536))); if (++n > 4) c.close(); } }));
  assert.equal(r.status, 413); assert.equal(await featOn(D1, A, "taskboard"), false);
});
