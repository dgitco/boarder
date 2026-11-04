import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MB = await import("./member-board.ts");

const A = "a@example.com", WIN = "터미널 · example";
const MIG = new URL("../migrations/", import.meta.url);
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  for (const [id, name] of [["n-lead", "예시 팀장"], ["n-other", "예시 다른 노드"]]) db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(A, id, name, "working", now, now);
  const tok = (pane: string, at: number) => db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, owner) VALUES (?,?,?,?,?,?)").run("h-" + pane, pane, WIN, "device:d1", at, A);
  tok("host:shell:101", now - 60_000);
  db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(A, "win:host:shell:101", "n-lead");
  db.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").run(A, WIN, "progress", "Codex 가 보낸 진행 글", now - 30_000);
  const exec = (sql: string, args: unknown[]) => { const st = db.prepare(sql); if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } }; const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) } as unknown as D1Database;
  return { D1, db, tok, now };
}
const texts = async (D1: D1Database, node: string) => {
  const r = await MB.get(D1, A, { name: "메인 봇" }, new URL("https://x/api/nodechat?w=" + encodeURIComponent(node)), async () => null) as Response;
  return ((await r.json()) as { messages: { text: string }[] }).messages.map(m => m.text);
};

test("같은 이름으로 새 창 키가 막 생겨도(묶기 전) 그 이름의 글이 팀장 채널에서 안 빠짐", async () => {
  const { D1, tok, now } = setup();
  assert.deepEqual(await texts(D1, "예시 팀장"), ["Codex 가 보낸 진행 글"]);
  tok("host:shell:102", now - 1_000);   // 다음 명령이 새 키 · 새 토큰을 받음 — 아직 묶이지 않음
  assert.deepEqual(await texts(D1, "예시 팀장"), ["Codex 가 보낸 진행 글"]);
});

test("새 창 키가 묶이면 그 자리를 따름(이전 키 자리보다 먼저)", async () => {
  const { D1, db, tok, now } = setup();
  tok("host:shell:102", now - 1_000);
  db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(A, "win:host:shell:102", "n-other");
  assert.deepEqual(await texts(D1, "예시 팀장"), []);
  assert.deepEqual(await texts(D1, "예시 다른 노드"), ["Codex 가 보낸 진행 글"]);
});
