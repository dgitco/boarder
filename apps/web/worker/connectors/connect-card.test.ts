// node --test --no-warnings --experimental-transform-types apps/web/worker/connectors/connect-card.test.ts (Node 22.18+ · node:sqlite)
// 「연결하기」 카드: 연결 없음 · 끊김으로 서비스 도구가 실패하면 회원 채팅에 카드 한 번만 + 에이전트 오류에 안내. 바깥 호출 없음(원격은 가짜), 자료는 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";

register("../test-hooks.mjs", import.meta.url);
const { offerConnect, parseConnectKind, CONNECT_TTL } = await import("./connect-card.ts");
const { mcp } = await import("../mcp/server.ts");
const { data, cardMsg } = await import("../member-board.ts");
const { EXECUTE } = await import("../mcp/codemode.ts");

const MIG = new URL("../../migrations/", import.meta.url);
function fakeEnv() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => (db.prepare(sql).get(...(args as never[])) as unknown) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
  });
  const DB = { prepare: (s: string) => stmt(s), batch: async (ss: any[]) => ss.map(s => /^\s*SELECT/i.test(s.sql) ? { results: db.prepare(s.sql).all(...s.args) } : { meta: { changes: Number(db.prepare(s.sql).run(...s.args).changes) } }) } as unknown as D1Database;
  return { db, env: { DB } as any };
}
const A = "a@example.com";
const conn = (f: ReturnType<typeof fakeEnv>, owner = A, pushed: unknown[] = []) => ({ env: f.env, owner, card: (c: unknown) => { pushed.push(c); } });
const cards = (f: ReturnType<typeof fakeEnv>) => f.db.prepare("SELECT id, owner, win, kind, question, choices, body, state, done FROM board_card ORDER BY id").all() as any[];
const GONE = new Error("없는 도구: linear__create_issue — 연결이 끊겼거나 꺼졌어요(boarder_search 로 찾아요)");

test("연결이 아예 없으면 카드 한 장 · 알림 한 번 · 같은 서비스 다시 실패해도 새 카드 없음(안내는 계속)", async () => {
  const f = fakeEnv(), pushed: unknown[] = [];
  const h1 = await offerConnect(conn(f, A, pushed), "linear__create_issue", GONE);
  assert.match(h1!, /Linear 연결이 필요해요 — 보더 채팅의 「연결하기」 카드/);
  const c = cards(f); assert.equal(c.length, 1);
  assert.deepEqual([c[0].owner, c[0].win, c[0].question, c[0].choices, c[0].state, c[0].kind], [A, "보더", "「Linear」에 연결해 주세요", '["연결하기"]', "open", "connect:linear||"]);
  assert.deepEqual(parseConnectKind(c[0].kind), { service: "linear", label: "", reconnect: undefined });
  const h2 = await offerConnect(conn(f, A, pushed), "linear__list_issues", GONE);
  assert.match(h2!, /Linear/); assert.equal(cards(f).length, 1); assert.equal(pushed.length, 1);
});

test("끊김(expired) 연결: 그 연결 id 를 단 카드, 다른 서비스 카드는 따로", async () => {
  const f = fakeEnv();
  f.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("c_0123456789abcdef0123", A, "notion", "", "oauth", "https://mcp.notion.com/mcp", "expired", 1, 1);
  const e = new Error("notion 연결이 끊겼어요 — 보더 설정에서 다시 연결");
  assert.ok(await offerConnect(conn(f), "notion__search", e));
  assert.ok(await offerConnect(conn(f), "linear__create_issue", GONE));
  const c = cards(f); assert.equal(c.length, 2);
  assert.deepEqual(parseConnectKind(c[0].kind), { service: "notion", label: "", reconnect: "c_0123456789abcdef0123" });
  assert.match(c[0].body, /연결이 끊겨/);
});

test("해당 없음: 정상 연결의 도구 이름 오류 · 다른 오류 · 주인(회원 아님) · 모르는 서비스 · 키 꼴 서비스 → 카드 없음", async () => {
  const f = fakeEnv();
  f.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("c_0123456789abcdef0123", A, "linear", "", "oauth", "https://mcp.linear.app/mcp", "ok", 1, 1);
  assert.equal(await offerConnect(conn(f), "linear__nope", GONE), null);
  assert.equal(await offerConnect(conn(f), "notion__x", new Error("이 토큰은 notion__x 을 쓸 수 없음")), null);
  assert.equal(await offerConnect(conn(f, ""), "notion__x", GONE), null);
  assert.equal(await offerConnect(conn(f), "zzznotaservice__x", GONE), null);
  assert.equal(await offerConnect(conn(f), "channeltalk__x", GONE), null);   // API 키 꼴 — 설정에서 키를 넣음
  assert.equal(cards(f).length, 0);
});

test("10분 지난 열린 카드는 만료로 닫고 새로 올림 · 동시에 두 번 불러도 한 장", async () => {
  const f = fakeEnv(), t = Date.now();
  await offerConnect(conn(f), "linear__a", GONE, t - CONNECT_TTL - 1000);
  await offerConnect(conn(f), "linear__a", GONE, t);
  const c = cards(f); assert.deepEqual(c.map(x => [x.state, x.done]), [["closed", "만료"], ["open", null]]);
  const g = fakeEnv();
  await Promise.all([offerConnect(conn(g), "notion__a", GONE, t), offerConnect(conn(g), "notion__b", GONE, t)]);
  assert.equal(cards(g).filter(x => x.state === "open").length, 1);
});

test("MCP execute: 연결 없는 서비스 도구 오류에 「채팅 카드에서 연결」 안내가 붙고 카드가 올라감", async () => {
  const f = fakeEnv(), pushed: unknown[] = [];
  const ctx = { agent: "t", publicUrl: "https://x", view: {} as any, op: async () => null, get: async () => null, conn: { ...conn(f, A, pushed), scope: "*", catalog: async () => new Map() } } as any;
  const r = await (await mcp(new Request("https://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: EXECUTE, arguments: { tool: "linear__create_issue", arguments: {} } } }) }), ctx)).json() as any;
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /없는 도구: linear__create_issue .*Linear 연결이 필요해요 — 보더 채팅의 「연결하기」 카드/);
  assert.equal(cards(f).length, 1); assert.equal(pushed.length, 1);
});

test("로그인(OAuth) 꼴 API 서비스(gmail 등): 연결 없음이면 카드 단추에 apiPreset — 모달이 {service, api:{preset}} 을 보냄. 끊긴 연결은 reconnect 만", async () => {
  const f = fakeEnv();
  f.env.GOOGLE_CLIENT_ID = "x"; f.env.GOOGLE_CLIENT_SECRET = "y";
  const { API_PRESETS } = await import("./apis.ts");
  const oauth = Object.keys(API_PRESETS).filter(k => API_PRESETS[k].spec.auth.type === "oauth");
  assert.ok(oauth.length);
  // 준비 여부는 환경 열쇠에 달림 — 시험에서는 준비된 서비스를 하나 찾아 씀
  const { apiReady } = await import("./apis.ts");
  const svc = oauth.find(k => apiReady(f.env, k, A).ready);
  assert.ok(svc, "준비된 로그인 꼴 서비스가 시험 환경에 있어야 함 — " + oauth.join());
  assert.ok(await offerConnect(conn(f), `${svc}__x`, GONE));
  const m = cardMsg({ ...cards(f)[0], n: 1 } as any) as any;
  assert.deepEqual(m.buttons.map((b: any) => [b.label, b.connect.service, b.connect.apiPreset, b.other]), [["연결하기", svc, svc, undefined]]);
  const g = fakeEnv(); g.db.prepare("INSERT INTO connection(id, owner, service, label, kind, url, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("c_0123456789abcdef0123", A, "notion", "", "oauth", "https://mcp.notion.com/mcp", "expired", 1, 1);
  await offerConnect(conn(g), "notion__x", GONE);
  const n = cardMsg({ ...cards(g)[0], n: 1 } as any) as any;
  assert.equal(n.buttons[0].connect.apiPreset, undefined); assert.equal(n.buttons[0].connect.reconnect, "c_0123456789abcdef0123");
});

test("만료: 10분 지난 열린 connect 카드는 보드를 읽을 때 닫힘", async () => {
  const f = fakeEnv(), t = Date.now();
  await offerConnect(conn(f), "linear__a", GONE, t - CONNECT_TTL - 5000);
  assert.equal(cards(f)[0].state, "open");
  const d = await data(f.env.DB, A, { name: "메인 봇" });
  assert.equal(cards(f)[0].state, "closed"); assert.equal(cards(f)[0].done, "만료");
  assert.equal((d.cardlist as any[]).filter(c => c.state === "open").length, 0);
});

test("프로토타입 이름(constructor · toString)은 서비스가 아님 — 카드 없음", async () => {
  const f = fakeEnv();
  for (const n of ["constructor", "toString", "__proto__x", "hasOwnProperty"]) assert.equal(await offerConnect(conn(f), `${n}__t`, GONE), null);
  assert.equal(cards(f).length, 0);
});

test("slack 처럼 MCP 표 · API 표에 다 있는 서비스는 MCP 길 — 카드 단추에 apiPreset 없음(모달이 {service} 만 보냄)", async () => {
  const f = fakeEnv();
  const { PRESETS } = await import("./presets.ts"), { API_PRESETS } = await import("./apis.ts");
  const both = Object.keys(API_PRESETS).filter(k => Object.hasOwn(PRESETS, k) && API_PRESETS[k].spec.auth.type === "oauth");
  assert.ok(both.length, "두 표에 다 있는 로그인 꼴 서비스(slack)");
  assert.ok(await offerConnect(conn(f), `${both[0]}__x`, GONE));
  const m = cardMsg({ ...cards(f)[0], n: 1 } as any) as any;
  assert.equal(m.buttons[0].connect.service, both[0]); assert.equal(m.buttons[0].connect.apiPreset, undefined);
});
