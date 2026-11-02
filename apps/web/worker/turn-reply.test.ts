import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const { run } = await import("./mcp/tools.ts");
const { localTools } = await import("./local.ts");
const MB = await import("./member-board.ts");

const A = "a@example.com";
const MIG = new URL("../migrations/", import.meta.url);
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(A, "n-a", "예시 팀장 노드", "working", now, now);
  db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(A, "win:팀장 창", "n-a");
  const exec = (sql: string, args: unknown[]) => { const st = db.prepare(sql); if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } }; const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) } as unknown as D1Database;
  return { db, D1 };
}
const view = { visible: () => true, why: () => null, desc: () => "", mask: () => false };
const ctxOf = (D1: D1Database | null, ops: unknown[] = []) => ({ agent: "t", publicUrl: "https://example.invalid", view, get: async () => ({}), op: async (n: string, a: unknown) => { ops.push([n, a]); return { ok: true }; }, ...(D1 ? { local: localTools(D1, A, "팀장 창", "https://example.invalid") } : {}) });

test("reply: 여러 줄 · 「-」로 시작해도 그 창 줄(kind reply)로 남고 노드 채팅에 보임", async () => {
  const { db, D1 } = setup();
  const text = "- 이슈를 만들었어요\n- 다른 창에 넘겼어요";
  assert.deepEqual(await run(ctxOf(D1) as never, "inbox_log", { kind: "reply", text }), { ok: true });
  assert.deepEqual(db.prepare("SELECT win, kind, text FROM board_log WHERE owner = ?").all(A).map(r => ({ ...r })), [{ win: "팀장 창", kind: "reply", text }]);
  const res = await MB.get(D1, A, { name: "메인 봇" }, new URL("https://x/api/nodechat?w=" + encodeURIComponent("예시 팀장 노드")), async () => null) as Response;
  const nc = await res.json() as { messages: { text: string; who: string }[] };
  assert.deepEqual(nc.messages.map(m => [m.who, m.text]), [["agent", text]]);
});

test("다른 kind 는 예전 그대로 한 줄 400자 · reply 도 3000자 넘으면 거절", async () => {
  const { D1 } = setup();
  await assert.rejects(run(ctxOf(D1) as never, "inbox_log", { kind: "progress", text: "둘\n줄" }), /입력이 맞지 않음/);
  await assert.rejects(run(ctxOf(D1) as never, "inbox_log", { kind: "progress", text: "-옵션" }), /입력이 맞지 않음/);
  await assert.rejects(run(ctxOf(D1) as never, "inbox_log", { kind: "progress", text: "가".repeat(401) }), /입력이 맞지 않음/);
  await assert.rejects(run(ctxOf(D1) as never, "inbox_log", { kind: "reply", text: "가".repeat(3001) }), /입력이 맞지 않음/);
  await assert.rejects(run(ctxOf(D1) as never, "inbox_log", { kind: "reply", text: "esc\x1b[2J" }), /입력이 맞지 않음/);
  assert.deepEqual(await run(ctxOf(D1) as never, "inbox_log", { kind: "progress", text: "한 줄 진행" }), { ok: true });
});

test("주인 보드(다리)엔 reply 를 안 보냄 — 장부 명령 줄로 가지 않게", async () => {
  const ops: unknown[] = [];
  await assert.rejects(run(ctxOf(null, ops) as never, "inbox_log", { kind: "reply", text: "답" }), /회원 보드 전용/);
  assert.equal(ops.length, 0);
});
