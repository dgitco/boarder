// Synthetic data only: headless replies survive the actual import → regroup → board read path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

// engine.ts 의 cloudflare:workers 는 Workers 밖에 없음 — 빈 DurableObject 로 갈음(node-close.test.ts 와 같음)
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { mountImport, regroup } = await import("./routes.ts");
const { Hono } = await import("hono");

const MIG = new URL("../../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const batch = async (ss: any[]) => {
    db.exec("BEGIN");
    try { const out = []; for (const s of ss) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database };
}

const A = "member@example.com", B = "other@example.com";
const { localTools } = await import("../local.ts");
const { data, get, paneOfId } = await import("../member-board.ts");
const NOW = Date.now(), SENDER = "#9001 Codex 담당", KEY = "mini:codex:headless";

test("headless log stays once in its task through full snapshots and outside the newest 400; owner isolation", async () => {
  const { db, D1 } = d1(), env = { DB: D1, PUBLIC_URL: "https://example.test" };
  db.prepare("INSERT INTO device(id,owner,name,token_hash,created_at) VALUES(?,?,?,?,?)").run("dev1", A, "mini", "fake-hash", NOW);
  db.prepare("INSERT INTO node_setting(owner,data,updated_at) VALUES(?,?,?)").run(A, '{"unit":"agent","unit_by":"me","task_channels":true}', NOW);   // 채널 = 태스크를 켠 회원
  db.prepare("INSERT INTO agent_token(hash,pane,win,host,created_at,owner,tools,device_id) VALUES(?,?,?,?,?,?,?,?)").run("fake-agent", KEY, SENDER, "mini", NOW, A, "*", "dev1");
  const app = new Hono<any>();
  app.onError((e,c) => c.json({ error: String(e) }, 500));
  mountImport(app, { device: async () => ({ id: "dev1", owner: A, name: "mini" }), member: async () => null, sameSite: () => true });
  const post = async (path: string, body: unknown) => {
    const r = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
    assert.equal(r.status, 200, await r.clone().text()); return r.json();
  };
  await post("/api/device/tasks", { tasks: [{ key: "9001", name: "#9001 — 합성 업무", issue: "#9001", state: "working" }] });
  const snapshot = (items: unknown[] = []) => post("/api/import", { host: "mini", kinds: ["window"], items });
  await snapshot([{ key: "window:mini:lead", kind: "window", engine: "herdr-own", title: "팀장", win: "mini:lead", state: "working" }]);
  await localTools(D1, A, SENDER, env.PUBLIC_URL, KEY)("inbox_log", { kind: "reply", text: "합성 headless 최종 답" });
  // Another owner's identical sender/task names do not supply a destination or leak a message.
  db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)").run(B, SENDER, "reply", "다른 회원의 합성 답", NOW);
  await regroup(env as never, A);
  const mapping = () => db.prepare("SELECT node FROM mnode_item WHERE owner=? AND item=?").get(A, "win:" + KEY)?.node;
  assert.equal(mapping(), "tk_9001");
  const source = db.prepare("SELECT * FROM board_log WHERE owner=? AND win=?").get(A, SENDER);
  await snapshot(); await snapshot();
  assert.equal(mapping(), "tk_9001");
  // Read bound is 600; regroup bound is 400. Keep the reply in the former, outside the latter.
  const add = db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)");
  for (let i=0; i<401; i++) add.run(A, "mini:lead", "progress", "합성 후속 줄 " + i, NOW + 1000 + i);
  await snapshot(); await regroup(env as never, A);
  assert.equal(mapping(), "tk_9001", "a missing window cannot remove a persisted report link");
  assert.deepEqual(db.prepare("SELECT * FROM board_log WHERE owner=? AND win=?").get(A, SENDER), source);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM board_log WHERE owner=? AND win=?").get(A, SENDER)?.n, 1);
  const d = await data(D1, A, null) as any;
  assert.equal(d.panes.filter((p: any) => p.pane === paneOfId("tk_9001")).length, 1);
  const response = await get(D1, A, null, new URL("https://example.test/api/nodechat?w=" + encodeURIComponent("#9001 — 합성 업무")), async () => null);
  assert.equal(response?.status, 200);
  const messages = (await response!.json() as any).messages;
  assert.equal(messages.filter((m: any) => m.text === "합성 headless 최종 답").length, 1);
  assert.ok(!messages.some((m: any) => m.text === "다른 회원의 합성 답"));
  const other = await data(D1, B, null) as any;
  assert.ok(!JSON.stringify(other).includes("합성 headless 최종 답"));
});
