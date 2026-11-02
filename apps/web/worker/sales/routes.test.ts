// node --test apps/web/worker/sales/routes.test.ts — API 계약 · 팀 경계(D1 대신 node:sqlite 에 같은 마이그레이션)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";

// 확장자 없는 상대 import("./rules") 를 .ts 로(Vite 와 같은 풀이)
registerHooks({ resolve(spec, ctx, next) { try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(spec + ".ts", ctx); throw e; } } });
const { mountSales } = await import("./routes.ts");

// D1 꼴만 흉내: prepare · bind · first · all · run · batch(한 트랜잭션)
function d1(db: DatabaseSync) {
  const exec = (sql: string, args: unknown[]) => {
    const st = db.prepare(sql);
    if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])), meta: { changes: 0 } };
    const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } };
  };
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => (exec(sql, args).results[0] ?? null),
    all: async () => exec(sql, args), run: async () => exec(sql, args),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: { sql: string; args: unknown[] }[]) => { db.exec("BEGIN"); try { const out = ss.map(s => exec(s.sql, s.args)); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } },
  };
}

function setup() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../../migrations/", import.meta.url);   // 번호에 기대지 않음(받는 쪽이 번호를 바꿀 수 있음) — 이름 끝이 _sales…sql 인 것을 번호 순으로
  for (const f of readdirSync(dir).filter(f => /_sales(_[a-z]+)?\.sql$/.test(f)).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  db.exec('create table "user" (email text, name text)');   // better-auth 표에서 쓰는 칸만
  const app = new Hono();
  const invited = new Set(["a@example.com", "b@example.com", "x@example.com"]);
  mountSales(app, async c => c.req.header("x-test-user") || null, async (_c, e) => invited.has(e));
  const env = { DB: d1(db) };
  const call = async (who: string | null, method: string, path: string, body?: unknown, hb = true, extra: Record<string, string> = {}) => {
    const h: Record<string, string> = { "content-type": "application/json", ...extra };
    if (who) h["x-test-user"] = who; if (hb) h["x-hb"] = "1";
    const r = await app.fetch(new Request("https://b.example" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await r.arrayBuffer());   // BOM 도 그대로(CSV)
    return { status: r.status, j: (r.headers.get("content-type") || "").includes("json") ? JSON.parse(text) : null, text, type: r.headers.get("content-type") || "" };
  };
  const join = (team: string, email: string) => db.prepare("INSERT INTO sales_member(team, email, role, added_by, at) VALUES (?,?,?,?,?)").run(team, email, "member", "test", 0);
  const events = (card: string) => (db.prepare("SELECT who, kind FROM sales_event WHERE card = ? ORDER BY id").all(card) as { who: string; kind: string }[]).map(r => ({ ...r }));
  return { call, join, events };
}
const A = "a@example.com", B = "b@example.com", X = "x@example.com";
const card = { firm: "예시 세무회계", next: "첫 통화 잡기", due: "2026-11-02" };

test("로그인 없으면 401, 쓰기에 x-hb 없으면 403", async () => {
  const { call } = setup();
  assert.equal((await call(null, "GET", "/api/sales/teams")).status, 401);
  assert.equal((await call(A, "POST", "/api/sales/teams", { name: "영업" }, false)).status, 403);
});

test("팀을 만들면 만든 사람이 관리자 · 내 팀 목록에만 보임", async () => {
  const { call } = setup();
  const t = await call(A, "POST", "/api/sales/teams", { name: "영업" });
  assert.equal(t.status, 200); assert.equal(t.j.team.role, "admin"); assert.match(t.j.team.id, /^st_[0-9a-z]{20}$/);
  assert.equal((await call(A, "GET", "/api/sales/teams")).j.teams.length, 1);
  assert.equal((await call(X, "GET", "/api/sales/teams")).j.teams.length, 0);
});

test("팀원이 아니면 카드를 못 보고 못 씀(있는 팀인지도 404)", async () => {
  const { call } = setup();
  const tid = (await call(A, "POST", "/api/sales/teams", { name: "영업" })).j.team.id;
  const c = await call(A, "POST", `/api/sales/teams/${tid}/cards`, card);
  assert.equal((await call(X, "GET", `/api/sales/teams/${tid}/cards`)).status, 404);
  assert.equal((await call(X, "POST", `/api/sales/teams/${tid}/cards`, card)).status, 404);
  assert.equal((await call(X, "PATCH", `/api/sales/teams/${tid}/cards/${c.j.card.id}`, { ver: 1, firm: "바꿈" })).status, 404);
  assert.equal((await call(X, "GET", `/api/sales/teams/${tid}/cards/${c.j.card.id}/events`)).status, 404);
});

test("다른 팀 카드는 내 팀 주소로도 못 고침", async () => {
  const { call } = setup();
  const t1 = (await call(A, "POST", "/api/sales/teams", { name: "1" })).j.team.id, t2 = (await call(X, "POST", "/api/sales/teams", { name: "2" })).j.team.id;
  const c2 = (await call(X, "POST", `/api/sales/teams/${t2}/cards`, card)).j.card;
  assert.equal((await call(A, "PATCH", `/api/sales/teams/${t1}/cards/${c2.id}`, { ver: 1, firm: "바꿈" })).status, 404);
});

test("두 사람이 같은 보드: 팀원 B 가 A 의 카드를 옮기면 기록 줄에 누가 · 무엇", async () => {
  const { call, join, events } = setup();
  const tid = (await call(A, "POST", "/api/sales/teams", { name: "영업" })).j.team.id; join(tid, B);
  const c = (await call(A, "POST", `/api/sales/teams/${tid}/cards`, card)).j.card;
  assert.equal(c.assignee, A, "담당 기본 = 만든 사람"); assert.equal(c.ver, 1);
  const list = await call(B, "GET", `/api/sales/teams/${tid}/cards`);
  assert.equal(list.j.cards.length, 1); assert.deepEqual(list.j.members.map((m: { email: string }) => m.email).sort(), [A, B]);
  const m = await call(B, "PATCH", `/api/sales/teams/${tid}/cards/${c.id}`, { ver: 1, stage: "contact", assignee: B });
  assert.equal(m.status, 200); assert.equal(m.j.card.ver, 2); assert.equal(m.j.card.updated_by, B);
  assert.deepEqual(events(c.id), [{ who: A, kind: "create" }, { who: B, kind: "move" }]);
  const ev = await call(A, "GET", `/api/sales/teams/${tid}/cards/${c.id}/events`);
  assert.deepEqual(ev.j.events[0].data.stage, ["inquiry", "contact"]);
});

test("낡은 판(ver)으로 고치면 409 — 먼저 고친 사람을 덮지 않고 기록도 안 늘어남", async () => {
  const { call, join, events } = setup();
  const tid = (await call(A, "POST", "/api/sales/teams", { name: "영업" })).j.team.id; join(tid, B);
  const c = (await call(A, "POST", `/api/sales/teams/${tid}/cards`, card)).j.card;
  assert.equal((await call(A, "PATCH", `/api/sales/teams/${tid}/cards/${c.id}`, { ver: 1, next: "A 가 고침" })).status, 200);
  const late = await call(B, "PATCH", `/api/sales/teams/${tid}/cards/${c.id}`, { ver: 1, next: "B 가 고침" });
  assert.equal(late.status, 409); assert.equal(late.j.card.next, "A 가 고침");
  assert.equal(events(c.id).length, 2);
});

test("단계 규칙은 서버가 검사: 놓침은 이유 없이 400, 팀 밖 담당 400", async () => {
  const { call } = setup();
  const tid = (await call(A, "POST", "/api/sales/teams", { name: "영업" })).j.team.id;
  const c = (await call(A, "POST", `/api/sales/teams/${tid}/cards`, card)).j.card;
  assert.equal((await call(A, "PATCH", `/api/sales/teams/${tid}/cards/${c.id}`, { ver: 1, stage: "lost" })).status, 400);
  assert.equal((await call(A, "PATCH", `/api/sales/teams/${tid}/cards/${c.id}`, { ver: 1, assignee: X })).status, 400);
  assert.equal((await call(A, "POST", `/api/sales/teams/${tid}/cards`, { ...card, assignee: X })).status, 400);
  const ok = await call(A, "PATCH", `/api/sales/teams/${tid}/cards/${c.id}`, { ver: 1, stage: "lost", lost_reason: "가격" });
  assert.equal(ok.status, 200); assert.equal(ok.j.card.stage, "lost");
});

test("팀원 더하기 · 빼기: 관리자만, 초대된 사람만, 마지막 관리자는 못 뺌, 빠지면 바로 못 봄", async () => {
  const { call } = setup();
  const tid = (await call(A, "POST", "/api/sales/teams", { name: "영업" })).j.team.id;
  assert.equal((await call(A, "POST", `/api/sales/teams/${tid}/members`, { email: "nobody@example.com" })).status, 400, "초대 안 된 메일");
  assert.equal((await call(A, "POST", `/api/sales/teams/${tid}/members`, { email: "B@example.com" })).status, 200);
  assert.equal((await call(B, "GET", `/api/sales/teams/${tid}/cards`)).status, 200);
  assert.equal((await call(B, "POST", `/api/sales/teams/${tid}/members`, { email: X })).status, 403, "팀원은 못 더함");
  assert.equal((await call(X, "POST", `/api/sales/teams/${tid}/members`, { email: X })).status, 404, "밖 사람은 팀이 안 보임");
  assert.equal((await call(A, "DELETE", `/api/sales/teams/${tid}/members/${encodeURIComponent(A)}`)).status, 400, "마지막 관리자");
  assert.equal((await call(B, "DELETE", `/api/sales/teams/${tid}/members/${encodeURIComponent(A)}`)).status, 403);
  const bc = (await call(A, "POST", `/api/sales/teams/${tid}/cards`, { ...card, assignee: B })).j.card;
  assert.equal((await call(A, "DELETE", `/api/sales/teams/${tid}/members/${encodeURIComponent(B)}`)).status, 200);
  const after = (await call(A, "GET", `/api/sales/teams/${tid}/cards`)).j.cards.find((c: { id: string }) => c.id === bc.id);
  assert.equal(after.assignee, A, "빠진 사람 카드는 뺀 관리자에게"); assert.equal(after.ver, 2);
  assert.equal((await call(A, "PATCH", `/api/sales/teams/${tid}/cards/${bc.id}`, { ver: 2, stage: "contact", due: "2026-11-03" })).status, 200, "넘겨받은 카드 옮기기");
  assert.equal((await call(B, "GET", `/api/sales/teams/${tid}/cards`)).status, 404);
});

test("CSV: 팀원만, 엑셀용(BOM), 수식으로 시작하는 칸은 막음", async () => {
  const { call } = setup();
  const tid = (await call(A, "POST", "/api/sales/teams", { name: "영업" })).j.team.id;
  await call(A, "POST", `/api/sales/teams/${tid}/cards`, { ...card, firm: "=HYPERLINK(1)" });
  assert.equal((await call(X, "GET", `/api/sales/teams/${tid}/export.csv`)).status, 404);
  const r = await call(A, "GET", `/api/sales/teams/${tid}/export.csv`);
  assert.equal(r.status, 200); assert.match(r.type, /text\/csv/);
  assert.ok(r.text.startsWith("\uFEFF사무소,단계,담당"));
  assert.match(r.text, /\r\n'=HYPERLINK\(1\),문의,/);
});
