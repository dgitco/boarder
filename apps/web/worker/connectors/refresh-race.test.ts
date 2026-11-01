/**
 * 토큰 갱신 경합: 요청마다 연결 줄을 따로 읽어 쥐고 있어(index.ts catalog), 앞 요청이 갱신을 끝낸 뒤 옛 줄을 쥔 요청이 오면
 * 이미 쓴(돌려 쓰는 서버에선 폐기된) 갱신 토큰으로 다시 갱신하면 안 됨 — 돌려 쓰는 서버는 재사용을 잡아 토큰 줄 전체를 폐기함.
 * bun:sqlite 로 D1 흉내, fetch 는 갱신 토큰을 돌려 쓰는 토큰 서버 흉내(네트워크 없음).
 *   cd apps/web && bun test worker/connectors/refresh-race.test.ts
 */
import { Database } from "bun:sqlite";
import { afterEach, expect, mock, test } from "bun:test";
import { seal } from "./seal";
import type { Env } from "./store";

mock.module("postal-mime", () => ({ default: class {} }));   // 메일 풀기(imap.ts)는 여기서 안 씀 — 패키지 없이도 돌게
const { call, get, remote } = await import("./store");
const { API_PRESETS, toolsFor } = await import("./apis");

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

function d1(db: Database) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => db.query(sql).get(...(args as any[])) ?? null,
    all: async () => ({ results: db.query(sql).all(...(args as any[])) }),
    run: async () => ({ meta: { changes: db.query(sql).run(...(args as any[])).changes } }),
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

async function setup(row: { kind: string; service: string; url: string; auth: Record<string, unknown> }) {
  const db = new Database(":memory:");
  db.run("CREATE TABLE f7_flag (name TEXT PRIMARY KEY, on_at INTEGER, note TEXT)");   // 봉투 스위치(vault envelopeOn)가 읽음 — 0021 마이그레이션이 만듦
  db.run(`CREATE TABLE connection(id TEXT PRIMARY KEY, owner TEXT, service TEXT, label TEXT, kind TEXT, url TEXT, auth TEXT, account TEXT DEFAULT '',
    status TEXT, error TEXT, tools TEXT, tools_at INTEGER, off TEXT DEFAULT '', read_only INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER, source TEXT DEFAULT '')`);
  const env: Env = { DB: d1(db), CONNECTOR_KEY: KEY, GITHUB_APP_CLIENT_ID: "gid", GITHUB_APP_CLIENT_SECRET: "gsecret" };
  db.query("INSERT INTO connection(id, owner, service, label, kind, url, auth, status, created_at, updated_at) VALUES ('c1', 'o', ?, '', ?, ?, ?, 'ok', 0, 0)")
    .run(row.service, row.kind, row.url, await seal(KEY, row.auth));
  return env;
}

/** 갱신 토큰을 돌려 쓰는 토큰 서버: 지금 것만 받고, 이미 쓴 것이 오면 줄 전체 폐기(OAuth 2.1 재사용 감지) */
function rotatingServer() {
  const s = { current: "r0" as string | null, n: 0, refreshes: 0, revoked: false };
  return {
    s,
    grant(rt: string): { ok: true; access: string; refresh: string } | { ok: false } {
      s.refreshes++;
      if (rt !== s.current) { s.current = null; s.revoked = true; return { ok: false }; }
      s.n++; s.current = `r${s.n}`;
      return { ok: true, access: `a${s.n}`, refresh: s.current };
    },
  };
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("MCP OAuth: 앞 요청이 갱신한 뒤 옛 줄을 쥔 요청은 이미 쓴 갱신 토큰을 다시 보내지 않음", async () => {
  const srv = rotatingServer();
  globalThis.fetch = (async (u: string, init: RequestInit) => {
    if (String(u).startsWith("https://auth.example.com/token")) {
      const rt = new URLSearchParams(String(init.body)).get("refresh_token")!;
      const g = srv.grant(rt);
      return g.ok ? Response.json({ access_token: g.access, refresh_token: g.refresh, expires_in: 3600 }) : Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    throw new Error(`예상 밖 주소 ${u}`);
  }) as typeof fetch;
  const env = await setup({ kind: "oauth", service: "linear", url: "https://mcp.example.com/mcp",
    auth: { access_token: "a0", refresh_token: "r0", expires_at: Date.now() - 1000, token_endpoint: "https://auth.example.com/token", client_id: "cid" } });

  // 요청 둘이 각자 줄을 읽음(같은 때) — 하나가 먼저 갱신을 끝냄
  const rowA = (await get(env, "o", "c1"))!, rowB = (await get(env, "o", "c1"))!;
  const ra = await remote(env, rowA);
  expect(ra.headers.authorization).toBe("Bearer a1");

  const rb = await remote(env, rowB);
  expect(srv.s.refreshes).toBe(1);           // 옛 r0 를 다시 보내지 않음
  expect(srv.s.revoked).toBe(false);         // 토큰 줄이 살아 있음
  expect(rb.headers.authorization).toBe("Bearer a1");
  expect((await get(env, "o", "c1"))!.status).toBe("ok");
});

test("API 커넥터(GitHub 앱 · 돌려 쓰는 갱신 토큰): 옛 줄을 쥔 요청도 갱신을 두 번 하지 않음", async () => {
  const srv = rotatingServer();
  globalThis.fetch = (async (u: string, init: RequestInit) => {
    if (String(u) === "https://github.com/login/oauth/access_token") {
      const g = srv.grant(JSON.parse(String(init.body)).refresh_token);
      return Response.json(g.ok ? { access_token: g.access, refresh_token: g.refresh, expires_in: 28800 } : { error: "bad_refresh_token" });
    }
    return Response.json([]);   // GitHub API 그 자체 — 여기서는 키만 봄
  }) as typeof fetch;
  const spec = API_PRESETS["github-app"].spec;
  const env = await setup({ kind: "api", service: "github-app", url: spec.baseUrl,
    auth: { api: spec, key: "a0", refresh_token: "r0", expires_at: Date.now() - 1000 } });
  const tool = toolsFor(spec)[0].name;

  const rowA = (await get(env, "o", "c1"))!, rowB = (await get(env, "o", "c1"))!;
  await call(env, rowA, tool, {});
  expect(srv.s.refreshes).toBe(1);
  await call(env, rowB, tool, {});
  expect(srv.s.refreshes).toBe(1);
  expect(srv.s.revoked).toBe(false);
  expect((await get(env, "o", "c1"))!.status).toBe("ok");
});
