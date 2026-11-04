// node --test --no-warnings --experimental-transform-types apps/web/worker/status-pages/devboard.test.ts — 기기 세션 현황 API 계약 · 사람 경계(자료는 다 지어낸 것)
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { Hono } from "hono";
registerHooks({ resolve(spec, ctx, next) { try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(spec + ".ts", ctx); throw e; } } });
const { mountDevBoard, acctOf } = await import("./devboard.ts");
const { setFeat } = await import("./feature.ts");
const { d1 } = await import("./test-db.mjs");
const A = "minji@example.com", B = "junho@example.com", NOW = Date.now();
async function setup(on: string[] = [A, B]) {
  const f = d1(), app = new Hono();
  mountDevBoard(app as never, { who: async c => c.req.header("x-test-user") || null, mails: (_c, e) => [e] });
  for (const e of on) await setFeat(f.D1, e, "devboard", true);
  const dev = (id: string, owner: string, name: string, scope = "full") => f.db.prepare("INSERT INTO device(id, owner, name, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?)").run(id, owner, name, "h" + id, NOW, NOW, scope);
  const win = (owner: string, dv: string, n: number, title: string, state: string, handle: object = {}) => f.db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, handle, seen_at) VALUES (?,?,?,'window','herdr-own',?,?,?,?,?,?,?)").run(owner, `window:${dv}:herdr:${n}`, dv, title, "/Users/someone/secret-folder", state, NOW, `${dv}:herdr:${n}`, JSON.stringify(handle), NOW);
  dev("d_a1", A, "작업 맥"); dev("d_a2", A, "집 노트북"); dev("d_b1", B, "남의 맥");
  win(A, "d_a1", 1, "비서실장", "working", { tool: "claude", config_dir: "/Users/x/.claude-accounts/a" });
  win(A, "d_a1", 2, "끝난 창", "gone"); win(B, "d_b1", 1, "남의 창", "working");
  win(B, "d_a1", 9, "남의 줄이 내 기기 id 를 가리킴", "working");   // 주인 칸(owner)이 다르면 기기 id 가 같아도 안 보여야 함
  f.db.prepare("INSERT INTO device_metric(device_id, owner, at, data) VALUES (?,?,?,?)").run("d_a1", A, NOW, JSON.stringify({ cpu: { pct: 40, load1: 3, cores: 8 }, mem: { total_mb: 16384, avail_mb: 4096 }, disk: { pct: 70 }, agents: { claude: 2 }, accounts: [{ status: "ok", acct: "a", p7: 50 }] }));
  const me = (who: string | null, method: string, path: string, body?: unknown, hb = true) => app.request(path, { method, headers: { ...(who ? { "x-test-user": who } : {}), ...(hb ? { "x-hb": "1" } : {}), "content-type": "application/json" }, ...(body === undefined ? {} : body instanceof ReadableStream ? { body, duplex: "half" } : { body: JSON.stringify(body) }) } as RequestInit, { DB: f.D1, FLAGS_OFF: "" } as never);
  return { ...f, me };
}
test("로그인 없으면 401 · 기능 끈 사람은 읽기 · 숨기기 403", async () => {
  const { me } = await setup([]);
  assert.equal((await me(null, "GET", "/api/me/devboard")).status, 401);
  assert.equal((await me(A, "GET", "/api/me/devboard")).status, 403);
  assert.equal((await me(A, "POST", "/api/me/devboard/hide", { device: "d_a1", hide: true })).status, 403);
});
test("내 기기 · 내 창만 — 남의 기기와 창은 안 보이고, 닫힌 창 · 폴더 경로는 안 나감", async () => {
  const { me } = await setup();
  const j = await (await me(A, "GET", "/api/me/devboard")).json();
  assert.deepEqual(j.devices.map((d: { id: string }) => d.id).sort(), ["d_a1", "d_a2"]);
  const d = j.devices.find((x: { id: string }) => x.id === "d_a1");
  assert.deepEqual(d.windows.map((w: { title: string; acct: string; tool: string }) => [w.title, w.acct, w.tool]), [["비서실장", "a", "claude"]]);
  assert.equal(d.load.cpu, 40); assert.equal(d.accounts[0].p7, 50);
  assert.ok(!JSON.stringify(j).includes("secret-folder"), "cwd 가 응답에 없음");
  const b = await (await me(B, "GET", "/api/me/devboard")).json();
  assert.deepEqual(b.devices.map((x: { id: string }) => x.id), ["d_b1"]);
});
test("이 기기 보이기: 내 기기만 숨김 · 되돌림, 남의 기기 id 는 404 · 같은 사이트 머리 없으면 403 · 모르는 값 400", async () => {
  const { me } = await setup();
  assert.equal((await me(A, "POST", "/api/me/devboard/hide", { device: "d_a2", hide: true }, false)).status, 403);
  assert.equal((await me(A, "POST", "/api/me/devboard/hide", { device: "d_b1", hide: true })).status, 404);
  assert.equal((await me(A, "POST", "/api/me/devboard/hide", { device: "d_a2", hide: "yes" })).status, 400);
  assert.deepEqual((await (await me(A, "POST", "/api/me/devboard/hide", { device: "d_a2", hide: true })).json()).hidden, ["d_a2"]);
  let j = await (await me(A, "GET", "/api/me/devboard")).json();
  assert.equal(j.devices.find((x: { id: string }) => x.id === "d_a2").hidden, true);
  assert.equal((await (await me(B, "GET", "/api/me/devboard")).json()).devices[0].hidden, false, "남의 숨김 값과 안 섞임");
  await me(A, "POST", "/api/me/devboard/hide", { device: "d_a2", hide: false });
  j = await (await me(A, "GET", "/api/me/devboard")).json();
  assert.equal(j.devices.find((x: { id: string }) => x.id === "d_a2").hidden, false);
});
test("계정 글자: 설정 폴더 이름에서 — 이름을 코드에 박지 않음", () => {
  assert.equal(acctOf({ config_dir: "/Users/x/.claude-accounts/b/" }), "b");
  assert.equal(acctOf({ config_dir: "/home/y/.claude-work" }), "work");
  assert.equal(acctOf({ config_dir: "/opt/agents/team-2" }), "team-2");
  assert.equal(acctOf({ tool: "claude" }), "");
  assert.equal(acctOf(null), "");
});
test("숨기기 몸 크기 상한: content-length 없는 큰 몸은 413", async () => {
  const { me } = await setup(); let n = 0;
  const r = await me(A, "POST", "/api/me/devboard/hide", new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode("x".repeat(65536))); if (++n > 4) c.close(); } }));
  assert.equal(r.status, 413);
});
