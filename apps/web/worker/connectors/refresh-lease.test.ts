/**
 * isolate 사이 토큰 갱신 경합과 끊김 표시. refresh-race.test.ts 는 요청 앞뒤(옛 줄)를, 여기는 진짜 동시(서로 다른 isolate)를 본다.
 * isolate 둘은 store 모듈을 두 번 불러 흉내낸다(모듈 안 Map 이 따로). bun:sqlite 로 D1 흉내, fetch 는 가짜(네트워크 없음).
 *   cd apps/web && bun test worker/connectors/refresh-lease.test.ts
 */
import { Database } from "bun:sqlite";
import { afterEach, expect, mock, test } from "bun:test";
import { seal } from "./seal";
import type { Env } from "./store";

mock.module("postal-mime", () => ({ default: class {} }));
const A = await import("./store");
const B = await import("./store.ts?isolate=b");

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const TOKEN = "https://auth.example.com/token", MCP = "https://mcp.example.com/mcp";
const AUTH = { access_token: "a0", refresh_token: "r0", expires_at: Date.now() - 1000, token_endpoint: TOKEN, client_id: "cid" };

function d1(db: Database) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => db.query(sql).get(...(args as any[])) ?? null,
    all: async () => ({ results: db.query(sql).all(...(args as any[])) }),
    run: async () => ({ meta: { changes: db.query(sql).run(...(args as any[])).changes } }),
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

async function setup(lease = true, tools: string | null = null) {
  const db = new Database(":memory:");
  db.run("CREATE TABLE f7_flag (name TEXT PRIMARY KEY, on_at INTEGER, note TEXT)");
  db.run(`CREATE TABLE connection(id TEXT PRIMARY KEY, owner TEXT, service TEXT, label TEXT, kind TEXT, url TEXT, auth TEXT, account TEXT DEFAULT '',
    status TEXT, error TEXT, tools TEXT, tools_at INTEGER, off TEXT DEFAULT '', read_only INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER, source TEXT DEFAULT '')`);
  if (lease) db.run("CREATE TABLE connection_refresh_lease (id TEXT PRIMARY KEY, until INTEGER NOT NULL)");
  db.query("INSERT INTO connection(id, owner, service, label, kind, url, auth, status, tools, tools_at, created_at, updated_at) VALUES ('c1', 'o', 'cloudflare', '', 'oauth', ?, ?, 'ok', ?, 1, 0, 0)").run(MCP, await seal(KEY, AUTH), tools);
  return { db, env: { DB: d1(db), CONNECTOR_KEY: KEY } as Env };
}

/** 돌려 쓰는 토큰 서버(느림): 이미 쓴 갱신 토큰이 오면 줄 전체 폐기 — 뒤로는 아무 토큰도 안 받음 */
function rotating(delay = 80) {
  const s = { current: "r0" as string | null, n: 0, refreshes: 0, revoked: false };
  globalThis.fetch = (async (u: string, init: RequestInit) => {
    if (String(u) !== TOKEN) throw new Error(`예상 밖 주소 ${u}`);
    const rt = new URLSearchParams(String(init.body)).get("refresh_token")!;
    s.refreshes++;
    const ok = rt === s.current;
    if (ok) { s.n++; s.current = `r${s.n}`; } else { s.current = null; s.revoked = true; }
    const n = s.n, cur = s.current;
    await new Promise(r => setTimeout(r, delay));
    return ok ? Response.json({ access_token: `a${n}`, refresh_token: cur, expires_in: 3600 }) : Response.json({ error: "invalid_grant" }, { status: 400 });
  }) as typeof fetch;
  return s;
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("임차가 없으면(옛 동작) 동시 갱신이 서버에서 줄을 폐기하는데 그 자리에선 멀쩡해 보이고, 다음 갱신 때 끊김 — 운영 증상", async () => {
  expect(A.remote).not.toBe(B.remote);   // 모듈이 정말 둘(Map 이 따로)
  const srv = rotating();
  const { env } = await setup(false);
  await Promise.allSettled([A.remote(env, (await A.get(env, "o", "c1"))!), B.remote(env, (await B.get(env, "o", "c1"))!)]);
  expect(srv.refreshes).toBe(2);
  expect(srv.revoked).toBe(true);                      // 서버는 이미 폐기
  expect((await A.get(env, "o", "c1"))!.status).toBe("ok");   // 보더는 모름 — 먼저 끝난 쪽이 쓴 토큰으로 「연결됨」
  await expect(A.remote(env, (await A.get(env, "o", "c1"))!, true)).rejects.toThrow();   // 액세스 토큰이 끝나 다음 갱신 → 거절
  const row = (await A.get(env, "o", "c1"))!;
  expect(row.status).toBe("expired");
  expect(row.error).toContain("invalid_grant");
});

test("임차가 있으면 동시 갱신해도 한 곳만 보내고, 다른 곳은 그 새 토큰을 받음", async () => {
  const srv = rotating();
  const { env, db } = await setup(true);
  const [ra, rb] = await Promise.all([A.remote(env, (await A.get(env, "o", "c1"))!), B.remote(env, (await B.get(env, "o", "c1"))!)]);
  expect(srv.refreshes).toBe(1);
  expect(srv.revoked).toBe(false);
  expect(ra.headers.authorization).toBe("Bearer a1");
  expect(rb.headers.authorization).toBe("Bearer a1");
  expect((await A.get(env, "o", "c1"))!.status).toBe("ok");
  expect(db.query("SELECT COUNT(*) AS n FROM connection_refresh_lease").get()).toEqual({ n: 0 });   // 끝나면 임차를 놓음
});

test("다른 곳이 임차를 쥔 채 끝나지 않으면 받은 제한 시간 안에 RefreshBusy, 갱신 없음, 끊김으로 표시하지 않음", async () => {
  const srv = rotating();
  const { env, db } = await setup(true);
  db.query("INSERT INTO connection_refresh_lease(id, until) VALUES ('c1', ?)").run(Date.now() + 60_000);
  const t0 = Date.now();
  await expect(A.tools(env, (await A.get(env, "o", "c1"))!, false, 1_000)).rejects.toBeInstanceOf(A.RefreshBusy);
  expect(Date.now() - t0).toBeLessThan(6_000);          // 받은 1초를 따름 — 옛 고정 10초 대기면 넘김(서버 부하 여유를 둔 값)
  expect(srv.refreshes).toBe(0);
  expect((await A.get(env, "o", "c1"))!.status).toBe("ok");
});

test("임자가 끝내고 놓으면 기다리던 쪽은 갱신 없이 그 토큰을 집음", async () => {
  const srv = rotating(0);
  const { env, db } = await setup(true);
  db.query("INSERT INTO connection_refresh_lease(id, until) VALUES ('c1', ?)").run(Date.now() + 60_000);
  const row = (await A.get(env, "o", "c1"))!;
  const waiting = A.remote(env, row, false, 5_000);
  await new Promise(r => setTimeout(r, 200));
  const sealed = await seal(KEY, { ...AUTH, access_token: "a9", refresh_token: "r9", expires_at: Date.now() + 3_600_000 });
  db.query("UPDATE connection SET auth = ? WHERE id = 'c1'").run(sealed);
  db.query("DELETE FROM connection_refresh_lease").run();
  expect((await waiting).headers.authorization).toBe("Bearer a9");
  expect(srv.refreshes).toBe(0);
});

test("D1 일시 장애(표는 있음)면 잠금 없이 갱신하지 않음 — 그게 곧 경합", async () => {
  const srv = rotating();
  const { env } = await setup(true);
  const real = env.DB, flaky = { prepare: (q: string) => { if (q.includes("INSERT INTO connection_refresh_lease")) throw new Error("D1_ERROR: database is locked"); return real.prepare(q); } } as unknown as D1Database;
  const row = (await A.get(env, "o", "c1"))!;
  await expect(A.remote({ ...env, DB: flaky }, row, false, 1_000)).rejects.toBeInstanceOf(A.RefreshBusy);
  expect(srv.refreshes).toBe(0);
});

test("옛 줄을 쥔 요청: 그사이 쓰인 토큰도 401 이면 갱신 한 번 없이 끊김으로 적지 않고 진짜 갱신함", async () => {
  const seen: string[] = [];
  let refreshes = 0;
  globalThis.fetch = (async (u: string, init: RequestInit) => {
    if (String(u) === TOKEN) { refreshes++; return Response.json({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }); }
    const tok = String(new Headers(init.headers).get("authorization")); seen.push(tok);
    if (tok !== "Bearer a2") return new Response("", { status: 401 });
    const b = JSON.parse(String(init.body));
    return Response.json({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "fresh_tool", inputSchema: {} }], protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "x", version: "1" } } });
  }) as typeof fetch;
  const { env, db } = await setup(true);
  db.query("UPDATE connection SET auth = ? WHERE id = 'c1'").run(await seal(KEY, { ...AUTH, expires_at: Date.now() + 3_600_000 }));
  const row = (await A.get(env, "o", "c1"))!;   // 이 요청은 a0 을 쥠
  db.query("UPDATE connection SET auth = ? WHERE id = 'c1'").run(await seal(KEY, { ...AUTH, access_token: "a1", refresh_token: "r1", expires_at: Date.now() + 3_600_000 }));   // 그사이 다른 곳이 a1 을 씀(서비스는 거절)
  const ts = await A.tools(env, row, true, undefined, true);
  expect(ts.map(t => t.name)).toEqual(["fresh_tool"]);
  expect(refreshes).toBe(1);
  expect((await A.get(env, "o", "c1"))!.status).toBe("ok");
});

test("임자가 죽어 임차가 지났으면 다른 곳이 가져가 갱신함", async () => {
  const srv = rotating(0);
  const { env, db } = await setup(true);
  db.query("INSERT INTO connection_refresh_lease(id, until) VALUES ('c1', ?)").run(Date.now() - 1);
  expect((await A.remote(env, (await A.get(env, "o", "c1"))!)).headers.authorization).toBe("Bearer a1");
  expect(srv.refreshes).toBe(1);
});

const OLD = JSON.stringify([{ name: "old_tool", inputSchema: {} }]);

test("「다시 읽기」(strict): 갱신이 거절되면 옛 목록 대신 오류, 끊긴 까닭(invalid_grant)이 남음", async () => {
  globalThis.fetch = (async (u: string) => String(u) === TOKEN ? Response.json({ error: "invalid_grant" }, { status: 400 }) : new Response("", { status: 401 })) as typeof fetch;
  const { env } = await setup(true, OLD);
  await expect(A.tools(env, (await A.get(env, "o", "c1"))!, true, undefined, true)).rejects.toThrow();
  const row = (await A.get(env, "o", "c1"))!;
  expect(row.status).toBe("expired");
  expect(row.error).toContain("invalid_grant");
});

test("에이전트 길(strict 아님)은 그대로 옛 목록을 돌려줌", async () => {
  globalThis.fetch = (async (u: string) => String(u) === TOKEN ? Response.json({ error: "invalid_grant" }, { status: 400 }) : new Response("", { status: 401 })) as typeof fetch;
  const { env } = await setup(true, OLD);
  const ts = await A.tools(env, (await A.get(env, "o", "c1"))!, true);
  expect(ts.map(t => t.name)).toEqual(["old_tool"]);
});

test("갱신은 됐는데 서비스가 새 토큰도 401 이면 그 까닭이 남음", async () => {
  globalThis.fetch = (async (u: string) => String(u) === TOKEN ? Response.json({ access_token: "a1", refresh_token: "r1", expires_in: 3600 }) : new Response("", { status: 401 })) as typeof fetch;
  const { env } = await setup(true, OLD);
  await expect(A.tools(env, (await A.get(env, "o", "c1"))!, true, undefined, true)).rejects.toThrow();
  const row = (await A.get(env, "o", "c1"))!;
  expect(row.status).toBe("expired");
  expect(row.error).toContain("401");
});

test("API 길(돌려 쓰는 앱 토큰): 임차가 풀린 뒤 줄에 있는 토큰이 이미 만료면 그대로 쓰지 않고 갱신함 — 끝난 토큰으로 불러 끊김으로 적히지 않게", async () => {
  const { API_PRESETS, toolsFor } = await import("./apis");
  const spec = API_PRESETS["github-app"].spec;
  const tool = toolsFor(spec)[0].name;
  let refreshes = 0, used = "";
  globalThis.fetch = (async (u: string, init: RequestInit) => {
    if (String(u) === "https://github.com/login/oauth/access_token") { refreshes++; expect(JSON.parse(String(init.body)).refresh_token).toBe("r1"); return Response.json({ access_token: "a2", refresh_token: "r2", expires_in: 28800 }); }
    used = String(new Headers(init.headers).get("authorization"));
    return used.includes("a2") ? Response.json([]) : new Response("", { status: 401 });
  }) as typeof fetch;
  const { env, db } = await setup(true);
  const e2 = { ...env, GITHUB_APP_CLIENT_ID: "gid", GITHUB_APP_CLIENT_SECRET: "gsecret" } as Env;
  const auth = (key: string, refresh_token: string) => seal(KEY, { api: spec, key, refresh_token, expires_at: Date.now() - 1000 });
  db.query("UPDATE connection SET kind = 'api', service = 'github-app', url = ?, auth = ? WHERE id = 'c1'").run(spec.baseUrl, await auth("a0", "r0"));
  db.query("INSERT INTO connection_refresh_lease(id, until) VALUES ('c1', ?)").run(Date.now() + 60_000);
  const row = (await A.get(e2, "o", "c1"))!;
  const calling = A.call(e2, row, tool, {});
  await new Promise(r => setTimeout(r, 200));
  db.query("UPDATE connection SET auth = ? WHERE id = 'c1'").run(await auth("a1", "r1"));   // 임자가 쓴 토큰인데 이미 만료
  db.query("DELETE FROM connection_refresh_lease").run();
  await calling;
  expect(refreshes).toBe(1);
  expect(used).toContain("a2");
  expect((await A.get(e2, "o", "c1"))!.status).toBe("ok");
});

test("검색(catalog): 8초가 전체 한도 — 갱신이 늦어도 제때 답하고, 하던 갱신은 뒤에서 끝나 새 토큰을 저장 · 임차를 놓음", async () => {
  globalThis.fetch = (async (u: string, init: RequestInit) => {
    if (String(u) === TOKEN) { await new Promise(r => setTimeout(r, 9_000)); return Response.json({ access_token: "a1", refresh_token: "r1", expires_in: 3600 }); }
    const b = JSON.parse(String(init.body));
    return Response.json({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "t", inputSchema: {} }], protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "x", version: "1" } } });
  }) as typeof fetch;
  const { env, db } = await setup(true, null);
  const later: Promise<unknown>[] = [];
  const t0 = Date.now();
  const out = await A.catalog(env, "o", p => { later.push(p); });
  const took = Date.now() - t0;
  expect(took).toBeLessThan(8_900);          // 토큰 서버(9초)를 기다리지 않음
  expect(out.size).toBe(0);
  await Promise.all(later);                  // Worker 의 waitUntil 자리
  const row = (await A.get(env, "o", "c1"))!;
  expect(row.status).toBe("ok");
  expect(JSON.parse(row.tools!).map((t: { name: string }) => t.name)).toEqual(["t"]);
  expect(db.query("SELECT COUNT(*) AS n FROM connection_refresh_lease").get()).toEqual({ n: 0 });
}, 25_000);
