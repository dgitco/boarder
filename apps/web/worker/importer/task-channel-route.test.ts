import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
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
function app(D1: D1Database, who: { device?: string | null; member?: string | null; same?: boolean } = { device: A }) {
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  mountImport(a, { device: async () => who.device ? { id: "dev1", owner: who.device, name: "laptop" } : null, member: async () => who.member ?? null, sameSite: () => who.same ?? false });
  return (method: string, path: string, body?: unknown) => a.request(path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: D1, PUBLIC_URL: "https://example.test" });
}
const { post, get, data, tsOf } = await import("../member-board.ts");
const { paneOfId, goneForget } = await import("../member-board.ts");
const ENV = { DB: null as unknown as D1Database, PUBLIC_URL: "https://example.test" };
const T = Date.now() - 60_000;
const win = (db: DatabaseSync, who: string, key: string, title: string, session = "", state = "working") =>
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, session, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(who, key, "dev1", "window", "tmux", title, "/x/demo", state, T, key.slice(7), session, Date.now());
const mapOf = (db: DatabaseSync, item: string) => { const r = db.prepare("SELECT node, how FROM mnode_item WHERE owner = ? AND item = ?").get(A, item) as any; return r ? { ...r } : r; };
async function seed() {
  const f = d1(), call = app(f.D1);
  f.db.prepare("INSERT INTO device(id, owner, name, token_hash, created_at) VALUES (?,?,?,?,?)").run("dev1", A, "mbp", "h1", Date.now());
  f.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ task_channels: true }), Date.now());   // 채널 = 태스크를 켠 회원
  await call("POST", "/api/device/tasks", { tasks: [{ key: "sales", name: "Sales", parent: "top" }, { key: "9002", name: "예시 문서 확정", parent: "tk_sales" }] });
  win(f.db, A, "window:mbp:ew_a", "덱 작업 창", "session:claude:s1");
  f.db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, title, state, session, seen_at) VALUES (?,?,?,?,?,?,?,?)").run(A, "session:claude:s1", "dev1", "session", "덱 대화", "open", "session:claude:s1", Date.now());
  win(f.db, B, "window:mbp:ew_b", "남의 창");
  await regroup({ ...ENV, DB: f.D1 } as never, A);
  return { ...f, call };
}
const say = (D1: D1Database, text: string) => post(D1, A, "/api/chat", { pane: paneOfId("tk_9002"), channel: "n:예시 문서 확정", text });

test("업무 채널: 실제 regroup→data→옛/새 대화·카드·스레드·전송, 다시 묶어도 장부 보존", async () => {
  const { db, D1, call } = await seed();
  const oldId = mapOf(db, "window:mbp:ew_a")!.node;
  db.prepare("UPDATE mnode SET name = 'bank-thread (옛 칸)' WHERE owner = ? AND id = ?").run(A, oldId);
  db.prepare("UPDATE imp_item SET title = '#9001 bank-thread · 계정 a', gone_at = ?, state = 'gone' WHERE owner = ? AND key = 'window:mbp:ew_a'").run(Date.now() - 1000, A);
  win(db, A, "window:other-mac:ew_b", "#9001 bank-thread · 계정 b · 16:33", "session:claude:s1");
  win(db, A, "window:worker:ew_c", "작업자 #9001 · PR #77");
  db.prepare("UPDATE imp_item SET repo='github.com/example/demo' WHERE owner=?").run(A);
  const task = { key: "9001", name: "#9001 — 통장 연결 (가짜)", parent: "tk_sales", issue: "example/demo#9001", state: "working", fields: { PR: "https://github.com/example/demo/pull/77" } };
  assert.equal((await call("POST", "/api/device/tasks", { tasks: [task] })).status, 200);
  db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)").run(A, "bank-thread (옛 칸)", "me", "옛 칸에 남긴 사람 글", T);
  const root = db.prepare("SELECT id,at FROM board_log WHERE owner=? AND text='옛 칸에 남긴 사람 글'").get(A) as any;
  const ts = tsOf(root.at, root.id);
  db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES(?,?,?,?,?,?)").run(A, "mbp:ew_a", "chat", "옛 스레드 답", ts, T + 1);
  db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)").run(A, "mbp:ew_a", "progress", "옮기기 전 보고", T + 2);
  db.prepare("INSERT INTO board_card(owner,id,win,question,choices,state,at) VALUES(?,?,?,?,?,?,?)").run(A, "1793770000.000888", "mbp:ew_a", "옛 창 카드", "[]", "open", T + 3);
  await regroup({ ...ENV, DB: D1 } as never, A);
  for (const key of ["window:mbp:ew_a", "window:other-mac:ew_b", "window:worker:ew_c", "session:claude:s1"]) assert.equal(mapOf(db, key)?.node, "tk_9001", key);
  const row = () => db.prepare("SELECT task,counts,state FROM mnode WHERE owner=? AND id='tk_9001'").get(A) as any;
  const original = row();
  assert.equal(original.state, "working"); assert.equal(JSON.parse(original.task).fields.PR, task.fields.PR);
  const counts = JSON.parse(original.counts); assert.equal(counts.main, "window:other-mac:ew_b");
  assert.ok(counts.aliases.some((a: any) => a.id === oldId && a.name === "bank-thread (옛 칸)"));
  const d = await data(D1, A, null) as any;
  assert.equal(d.panes.filter((p: any) => p.win.startsWith("#9001")).length, 1);
  assert.equal(d.node_aliases[paneOfId(oldId)], paneOfId("tk_9001"));
  assert.equal(d.cardlist.find((c: any) => c.body === "옛 창 카드" || c.title === "옛 창 카드")?.channel, "n:" + task.name);
  for (const name of [task.name, "bank-thread (옛 칸)"]) {
    const response = await get(D1, A, null, new URL("/api/nodechat?w=" + encodeURIComponent(name), "https://demo.test"), async () => null);
    assert.equal(response?.status, 200); const j = await response!.json() as any;
    assert.ok(j.messages.some((m: any) => m.text === "옛 칸에 남긴 사람 글"));
    // 옛 창(지금 담당 창이 아님) 보고 = 태스크 대화의 agents 층: 맨 위 접은 글 스레드에서 보임(migrations/0060)
    const fold = j.messages.find((m: any) => m.fold?.agents);
    const folded = await get(D1, A, null, new URL("/api/chat/primary/" + fold.ts, "https://demo.test"), async () => null);
    assert.ok((await folded!.json() as any).messages.some((m: any) => m.text === "옮기기 전 보고"));
    assert.ok(j.messages.some((m: any) => m.text === "옛 창 카드"));
    const th = await get(D1, A, null, new URL("/api/chat/n:" + encodeURIComponent(name) + "/" + ts, "https://demo.test"), async () => null);
    assert.ok((await th!.json() as any).messages.some((m: any) => m.text === "옛 스레드 답"));
  }
  const hop = await post(D1, A, "/api/chat", { pane: paneOfId("tk_9001"), channel: "n:" + task.name, text: "새 요청" }) as any;
  assert.equal(hop.path, "/api/me/nodes/cmd"); assert.equal(hop.body.item, "window:other-mac:ew_b");
  await regroup({ ...ENV, DB: D1 } as never, A);
  assert.deepEqual(row(), original);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM board_log WHERE owner=?").get(A)!.n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM board_card WHERE owner=?").get(A)!.n, 1);
  if (process.env.TASK_CHANNEL_PREVIEW_OUT) writeFileSync(process.env.TASK_CHANNEL_PREVIEW_OUT, JSON.stringify(d));
  assert.equal((await call("POST", "/api/device/tasks", { tasks: [{ key: "9001", state: "done" }] })).status, 200);
  await regroup({ ...ENV, DB: D1 } as never, A);
  for (const key of ["window:other-mac:ew_b", "window:worker:ew_c"]) assert.notEqual(mapOf(db, key)?.node, "tk_9001", "완료 업무는 살아 있는 창을 놓아줌");
});

test("옛 채널에 다른 창이 남으면 이름·판 주소·사람 글·전송을 업무가 가로채지 않음", async () => {
  const { db, D1, call } = await seed();
  const oldId = mapOf(db, "window:mbp:ew_a")!.node;
  const oldName = "살아 있는 담당 채널";
  db.prepare("UPDATE mnode SET name=?,pinned_name=? WHERE owner=? AND id=?").run(oldName, oldName, A, oldId);
  win(db, A, "window:mbp:ew_remain", "다른 담당 창");
  db.prepare("INSERT INTO mnode_item(owner,item,node,how) VALUES(?,?,?,'pin')").run(A, "window:mbp:ew_remain", oldId);
  db.prepare("UPDATE imp_item SET title='#9001 통장 연결',repo='github.com/example/demo' WHERE owner=? AND key='window:mbp:ew_a'").run(A);
  await call("POST", "/api/device/tasks", { tasks: [{ key: "9001", name: "#9001 — 통장 연결 (가짜)", issue: "example/demo#9001" }] });
  const counts = () => JSON.parse((db.prepare("SELECT counts FROM mnode WHERE owner=? AND id='tk_9001'").get(A) as any).counts);
  const check = async () => {
    const d = await data(D1, A, null) as any;
    assert.equal(d.node_aliases?.[paneOfId(oldId)], undefined);   // 별칭이 없으면 칸도 없음
    assert.equal(d.node_aliases?.[oldName], undefined);
    for (const address of [oldName, paneOfId(oldId)]) {
      const hop = await post(D1, A, "/api/chat", { pane: paneOfId(oldId), channel: "n:" + address, text: "담당에게 요청" }) as any;
      assert.equal(hop.body.item, "window:mbp:ew_remain");
      const response = await get(D1, A, null, new URL("/api/nodechat?w=" + encodeURIComponent(address), "https://demo.test"), async () => null);
      const j = await response!.json() as any;
      assert.ok(j.messages.some((m: any) => m.text === "담당 채널 사람 글"));
      assert.ok(!j.messages.some((m: any) => m.text === "업무 채널 사람 글"));
    }
  };
  await regroup({ ...ENV, DB: D1 } as never, A);
  assert.equal(mapOf(db, "window:mbp:ew_a")?.node, "tk_9001");
  assert.equal(mapOf(db, "window:mbp:ew_remain")?.node, oldId);
  assert.ok(!(counts().aliases || []).some((a: any) => a.id === oldId), "살아 있는 옛 노드는 별칭으로 저장하지 않음");
  for (const [win, text] of [[oldName, "담당 채널 사람 글"], ["#9001 — 통장 연결 (가짜)", "업무 채널 사람 글"]])
    db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,'me',?,?)").run(A, win, text, T);
  await check();
  db.prepare("UPDATE mnode SET counts=? WHERE owner=? AND id='tk_9001'").run(JSON.stringify({ ...counts(), aliases: [{ id: oldId, name: oldName }] }), A);
  await check(); // 예전 묶기가 남긴 잘못된 별칭도 읽을 때 무시
  await regroup({ ...ENV, DB: D1 } as never, A);
  assert.ok(!(counts().aliases || []).some((a: any) => a.id === oldId), "낡은 별칭도 다음 묶기에 제거");
  await check();
});

const H = 3600_000;
const nodechat = async (D1: D1Database, q: string) => (await (await get(D1, A, null, new URL("https://demo.test/api/nodechat?" + q), async () => null))!.json()) as any;
test("리뷰 4: 업무에 붙은 창이 닫히고 7시간 뒤에도 그 창 글이 업무 채널에 남음(채널 = 태스크 켠 회원, agent · goal)", async () => {
  for (const unit of ["agent", "goal"]) {
    const f = d1(), call = app(f.D1);
    f.db.prepare("INSERT INTO device(id, owner, name, token_hash, created_at) VALUES (?,?,?,?,?)").run("dev1", A, "mbp", "h1", Date.now());
    f.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ unit, task_channels: true }), Date.now());
    await call("POST", "/api/device/tasks", { tasks: [{ key: "9001", name: "통장 연결", issue: "example/demo#9001", state: "working" }] });
    f.db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, repo, state, state_at, win, session, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(A, "window:m:1", "dev1", "window", "tmux", "#9001 통장 고침", "/x/demo", "github.com/example/demo", "working", Date.now(), "window:m:1", "session:claude:s1", Date.now());
    const at = Date.now() - 10 * H;
    f.db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)").run(A, "window:m:1", "log", "업무 보고 — 이 글이 보여야 함", at);
    await regroup({ ...ENV, DB: f.D1 } as never, A);
    assert.equal(mapOf(f.db, "window:m:1")?.node, "tk_9001", unit);
    f.db.prepare("UPDATE imp_item SET gone_at=?, state='gone', state_at=?, seen_at=? WHERE owner=? AND key='window:m:1'").run(Date.now() - 7 * H, at, at, A);
    goneForget(A);
    await regroup({ ...ENV, DB: f.D1 } as never, A);
    assert.equal(mapOf(f.db, "window:m:1")?.node, "tk_9001", unit + " 닫힌 뒤에도 연결");
    const j = await nodechat(f.D1, "w=" + encodeURIComponent("통장 연결") + "&id=tk_9001");
    assert.equal(j.messages.filter((m: any) => /업무 보고/.test(m.text)).length, 1, unit);
  }
});

test("리뷰 8: 닫은 노드가 같은 이름의 산 노드를 가리지 않음(설정 없는 회원)", async () => {
  const f = d1(), now = Date.now();
  f.db.prepare("INSERT INTO device(id, owner, name, token_hash, created_at) VALUES (?,?,?,?,?)").run("dev1", A, "mbp", "h1", now);
  const ins = (id: string, upd: number) => f.db.prepare("INSERT INTO mnode(owner,id,name,area,state,why,counts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(A, id, "같은이름", "", "idle", "", "{}", now - 24 * H, upd);
  ins("n_closed", now - 1000); ins("n_live", now - 5000);
  for (const [item, node] of [["window:m:live", "n_live"], ["window:m:closed", "n_closed"]]) {
    f.db.prepare("INSERT INTO mnode_item(owner,item,node,how) VALUES (?,?,?,'pin')").run(A, item, node);
    win(f.db, A, item, item === "window:m:live" ? "산 창" : "닫은 창");
  }
  f.db.prepare("INSERT INTO node_setting(owner,data,updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ unit: "goal", closed: ["n_closed"] }), now);
  f.db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)").run(A, "m:live", "log", "산 노드 글", now - 100);
  f.db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)").run(A, "m:closed", "log", "닫은 노드 글", now - 200);
  const texts = (await nodechat(f.D1, "w=" + encodeURIComponent("같은이름"))).messages.map((m: any) => m.text);
  assert.ok(texts.includes("산 노드 글"), JSON.stringify(texts));
  assert.ok(!texts.includes("닫은 노드 글"), JSON.stringify(texts));
});
