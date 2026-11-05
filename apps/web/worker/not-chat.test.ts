import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { notChat } = await import("./importer/group.ts");
const { NOT_CHAT } = await import("./member-board.ts");

const OLD = (t: string) => `AND (${t}.wid IS NULL OR ${t}.wid NOT IN (SELECT id FROM engine_window WHERE owner = ${t}.owner AND kind = 'chat'))`;
const MIG = new URL("../migrations/", import.meta.url);

test("notChat: 새 꼴이 옛 꼴과 같은 판 기록 · 카드 줄 — 채팅 창 줄만 빠지고, 남의 채팅 창 id 를 단 줄은 남음 · 줄마다 창 목록을 다시 훑지 않음", () => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const A = "nc@example.com", B = "other@example.com";
  const win = (id: string, owner: string, kind: string) => db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, created_at) VALUES (?,?,?,?,?,?)").run(id, owner, "d1", kind, id, 1);
  win("ew_chat", A, "chat"); win("ew_role", A, "role"); win("ew_chat2", A, "chat"); win("ew_bchat", B, "chat");
  let at = 1;
  for (const wid of ["ew_chat", "ew_role", null, "ew_chat2", "ew_bchat", "ew_missing", "ew_role", null])
    for (const owner of [A, B]) {
      db.prepare("INSERT INTO board_log(owner, win, kind, text, at, wid) VALUES (?,?,?,?,?,?)").run(owner, "w", "progress", String(wid), at++, wid);
      db.prepare("INSERT INTO board_card(id, owner, win, state, question, choices, at, wid) VALUES (?,?,?,?,?,?,?,?)").run("c" + at, owner, "w", "open", String(wid), "[]", at++, wid);
    }
  assert.equal(NOT_CHAT, notChat("board_log"), "판 읽기가 같은 조각을 씀");
  for (const t of ["board_log", "board_card"] as const) for (const who of [A, B]) {
    const q = (frag: string) => (db.prepare(`SELECT id FROM ${t} WHERE owner = ? ${frag} ORDER BY at DESC LIMIT 600`).all(who) as { id: number }[]).map(r => r.id);
    const was = q(OLD(t)), now = q(notChat(t));
    assert.deepEqual(now, was, `${t} · ${who}`);
    assert.equal(was.length, who === A ? 6 : 7, "A 는 제 채팅 창 둘 · B 는 제 채팅 창 하나만 빠짐(남의 채팅 창 id · 없는 창 id 는 남음)");
    const plan = (db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM ${t} WHERE owner = ? ${notChat(t)} ORDER BY at DESC LIMIT 600`).all(who) as { detail: string }[]).map(r => r.detail).join(" | ");
    assert.match(plan, /SEARCH ew USING INDEX sqlite_autoindex_engine_window_1 \(id=\?\)/, "창은 id 로 한 줄: " + plan);
    assert.doesNotMatch(plan, /CORRELATED LIST SUBQUERY/, plan);
  }
});
