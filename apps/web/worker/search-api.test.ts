// 전체 Worker 의존성 없이 실제 /api/search 핸들러와 회원 경계를 실행한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register, stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
register("./test-hooks.mjs", import.meta.url);
const memberSearch = await import("./member-search.ts");
const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const start = src.indexOf('app.get("/api/search",');
const code = stripTypeScriptTypes(src.slice(start, src.indexOf('\n});', start) + 4));
async function request(params: Record<string, string>, owner = true, signed = true) {
  let handler: any; const calls: unknown[][] = [];
  const stmt = { bind: () => stmt, all: async () => ({ results: [] }) };
  const c = {
    env: { DB: { prepare: () => stmt, batch: async (ss: unknown[]) => ss.map(() => ({ results: [] })) } },
    req: { query: (k: string) => params[k], raw: new Request("https://example.test/api/search") },
    json: (body: any, status: number) => ({ body, status }),
  };
  runInNewContext(code, {
    app: { get: (_path: string, fn: any) => { handler = fn; } },
    signedIn: async () => signed ? { user: { email: "member@example.test" } } : null,
    isOwner: () => owner, memberSearch, seg: () => {},
    search: () => ({ query: async (...args: unknown[]) => { calls.push(args); return { nodes: [], cards: [], chats: [], arts: [], ms: {} }; } }),
  });
  return { response: await handler(c), calls };
}

test("주인 API의 engine=bge/voyage/mix와 기본 mix가 DO까지 전달", async () => {
  for (const engine of ["bge", "voyage", "mix", "", "unknown"]) {
    const { response, calls } = await request({ q: "자료", sem: "1", dbg: "1", engine });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [["자료", true, true, engine === "bge" || engine === "voyage" ? engine : "mix"]]);
  }
});

test("회원은 engine과 dbg를 요청해도 주인 DO를 못 부르고, 미로그인은 401", async () => {
  for (const engine of ["bge", "voyage", "mix"]) {
    const { response, calls } = await request({ q: "자료", dbg: "1", engine }, false);
    assert.equal(response.status, 200); assert.equal(calls.length, 0);
    assert.equal(response.body.member, 1); assert.equal(response.body.dbg, undefined);
  }
  const { response, calls } = await request({ q: "자료", engine: "voyage" }, true, false);
  assert.equal(response.status, 401); assert.equal(calls.length, 0);
});
