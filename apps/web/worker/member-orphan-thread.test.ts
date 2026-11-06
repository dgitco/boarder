import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);
const { get, post, tsOf, threadRootOk } = await import("./member-board.ts");
const A = "orphan@example.test", OTHER = "other@example.test", BOT = { name: "합성 비서 봇" }, T = Date.now() - 60_000;
const NODES = [["n_orphan_lead", "팀장", "demo:0"], ["n_orphan_tech", "기술장", "demo:1"]];
function setup() {
  const db = new DatabaseSync(":memory:"), mig = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(mig).filter(x => x.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, mig), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => s.all())) } as unknown as D1Database;
  for (const [i, [id, name, win]] of NODES.entries()) {
    db.prepare("INSERT INTO mnode(owner,id,name,area,state,why,counts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(A, id, name, "demo", "working", "", "{}", T, T);
    db.prepare("INSERT INTO imp_item(owner,key,device_id,kind,engine,title,state,win,seen_at,handle) VALUES(?,?,?,?,?,?,?,?,?,?)").run(A, "window:" + win, "demo", "window", "herdr-own", name, "working", win, T, JSON.stringify({ engine: "herdr-own", pane: "p" + i }));
    db.prepare("INSERT INTO mnode_item(owner,item,node,how) VALUES(?,?,?,'pin')").run(A, "window:" + win, id);
  }
  const id = Number(db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?) RETURNING id").get(A, "demo:0", "chat", "합성 뿌리 글", T)!.id);
  const ts = tsOf(T, id);
  db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES(?,?,?,?,?,?)").run(A, "demo:1", "chat", "합성 스레드 답", ts, T + 1000);
  db.prepare("INSERT INTO board_card(owner,id,win,kind,question,choices,state,at) VALUES(?,?,?,?,?,'[]',?,?)").run(OTHER, "1793770000.000777", "x:0", "todo", "남의 카드", "open", T);
  return { db, D1, ts };
}
async function read(D1: D1Database, chan: string, ts: string, owner = A) {
  const r = await get(D1, owner, BOT, new URL("/api/chat/n:" + encodeURIComponent(chan) + "/" + ts, "https://demo.test"), async () => null);
  assert.ok(r); assert.equal(r.status, 200); return await r.json() as any;
}
const texts = (j: any) => j.messages.map((m: any) => m.text);

test("이름이 바뀐 노드의 스레드(옛 이름 채널): 열리고, 답장은 그 스레드를 쓴 기술장 창으로", async () => {
  const { db, D1, ts } = setup();
  db.prepare("UPDATE mnode SET pinned_name = '비서실장 채널' WHERE id = 'n_orphan_lead'").run();
  const j = await read(D1, "팀장", ts);
  assert.deepEqual(texts(j), ["합성 뿌리 글", "합성 스레드 답"]); assert.equal(j.channel, "n:팀장");
  const h = await post(D1, A, "/api/chat", { channel: "n:팀장", thread: ts, text: "합성 답장" }) as any;
  assert.equal(h.path, "/api/me/nodes/cmd", JSON.stringify(h)); assert.equal(h.body.item, "window:demo:1");
  assert.match(h.body.text, new RegExp(`^\\[보드 · 팀장 · 스레드 ${ts.replace(".", "\\.")}\\] 합성 답장$`)); assert.equal(h.log.thread, ts);
});

test("채널이 없어진 스레드(노드 · 창이 다 사라짐): 열리고, 답장은 메인 봇으로(그 스레드 머리 줄)", async () => {
  const { db, D1, ts } = setup();
  db.exec(`DELETE FROM mnode WHERE owner = '${A}'; DELETE FROM mnode_item WHERE owner = '${A}'; DELETE FROM imp_item WHERE owner = '${A}'`);
  const j = await read(D1, "팀장", ts);
  assert.deepEqual(texts(j), ["합성 뿌리 글", "합성 스레드 답"]);
  const h = await post(D1, A, "/api/chat", { channel: "n:팀장", thread: ts, text: "합성 답장" }) as any;
  assert.deepEqual(h, { path: "/api/me/chat", body: { text: "합성 답장", nthread: ts, ch: "팀장" }, log: { win: "팀장", text: "합성 답장", ch: "팀장", thread: ts } });
  assert.equal(await threadRootOk(D1, A, ts), true);
});

test("닫힌 창의 스레드(그 노드 창이 다 닫힘): 답장은 그 스레드를 쓴 다른 산 창(기술장)으로", async () => {
  const { db, D1, ts } = setup();
  db.prepare("UPDATE imp_item SET gone_at = ? WHERE owner = ? AND key = 'window:demo:0'").run(Date.now() - 1000, A);
  const j = await read(D1, "팀장", ts);
  assert.ok(texts(j).includes("합성 스레드 답"));
  const h = await post(D1, A, "/api/chat", { channel: "n:팀장", thread: ts, text: "합성 답장" }) as any;
  assert.equal(h.path, "/api/me/nodes/cmd", JSON.stringify(h)); assert.equal(h.body.item, "window:demo:1");
  // 답한 창도 닫혔으면 메인 봇
  db.prepare("UPDATE imp_item SET gone_at = ? WHERE owner = ? AND key = 'window:demo:1'").run(Date.now() - 1000, A);
  const h2 = await post(D1, A, "/api/chat", { channel: "n:팀장", thread: ts, text: "합성 답장" }) as any;
  assert.equal(h2.path, "/api/me/chat", JSON.stringify(h2)); assert.equal(h2.body.nthread, ts);
});

test("산 노드 · 그 노드 스레드는 예전 그대로(그 노드 창으로)", async () => {
  const { D1, ts } = setup();
  const h = await post(D1, A, "/api/chat", { channel: "n:팀장", thread: ts, text: "합성 답장" }) as any;
  assert.equal(h.path, "/api/me/nodes/cmd"); assert.equal(h.body.item, "window:demo:0");
});

test("뿌리가 장부에 없는 스레드(옛 가져오기 꼴: 어느 채널로 물어도 글 0): 답들로 열리고, 답장은 그 답을 쓴 창으로", async () => {
  const { db, D1 } = setup(), ts = "1700000000.000004";
  db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES(?,?,?,?,?,?)").run(A, "demo:1", "chat", "합성 옛 스레드 답", ts, T + 2000);
  db.prepare("INSERT INTO mnode(owner,id,name,area,state,why,counts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(A, "n_orphan_cos", "비서실장 채널", "demo", "working", "", "{}", T, T);
  const j = await read(D1, "비서실장 채널", ts);
  assert.deepEqual(texts(j), ["합성 옛 스레드 답"]);
  const h = await post(D1, A, "/api/chat", { channel: "n:비서실장 채널", thread: ts, text: "합성 답장" }) as any;
  assert.equal(h.path, "/api/me/nodes/cmd", JSON.stringify(h)); assert.equal(h.body.item, "window:demo:1"); assert.equal(h.log.thread, ts);
  assert.equal(await threadRootOk(D1, A, ts), true);
});

test("남의 · 모르는 스레드는 열리지 않고 답장도 404", async () => {
  const { D1 } = setup();
  for (const ts of ["1793770000.000777", "1793770001.000001"]) {
    const j = await read(D1, "팀장", ts); assert.deepEqual(j.messages, []);
    const h = await post(D1, A, "/api/chat", { channel: "n:팀장", thread: ts, text: "합성 답장" }) as any;
    assert.ok("error" in h && h.status >= 400, JSON.stringify(h));
    assert.equal(await threadRootOk(D1, A, ts), false);
  }
});

test("그 스레드를 쓴 엔진 역할 창: 살아 있으면 그 창으로, 닫힌 · 실패 · 손잡이 없이 사라진 창(12시간 안이라 판에 남음)이면 메인 봇으로", async () => {
  const { db, D1 } = setup(), ts = "1700000000.000004";
  db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES(?,?,?,?,?,?)").run(A, "합성 역할 창", "chat", "합성 역할 창 답", ts, T + 2000);
  db.prepare("INSERT INTO engine_window(id,owner,device_id,kind,name,state,state_at,created_at) VALUES(?,?,?,?,?,?,?,?)").run("ew_orphan_role", A, "demo", "role", "합성 역할 창", "idle", Date.now() - 1000, T);
  const h = await post(D1, A, "/api/chat", { channel: "n:사라진 채널", thread: ts, text: "합성 답장" }) as any;
  assert.equal(h.path, "/api/me/windows/ew_orphan_role/say", JSON.stringify(h));
  for (const st of ["closed", "failed", "gone"]) {
    db.prepare("UPDATE engine_window SET state = ?, state_at = ? WHERE id = 'ew_orphan_role'").run(st, Date.now() - 1000);
    const h2 = await post(D1, A, "/api/chat", { channel: "n:사라진 채널", thread: ts, text: "합성 답장" }) as any;
    assert.equal(h2.path, "/api/me/chat", st + " " + JSON.stringify(h2)); assert.equal(h2.body.nthread, ts);
  }
  db.prepare("UPDATE engine_window SET handle = ? WHERE id = 'ew_orphan_role'").run(JSON.stringify({ session_id: "s-orphan" }));
  const h3 = await post(D1, A, "/api/chat", { channel: "n:사라진 채널", thread: ts, text: "합성 답장" }) as any;
  assert.equal(h3.path, "/api/me/windows/ew_orphan_role/say", JSON.stringify(h3));
  db.prepare("INSERT INTO engine_window(id,owner,device_id,kind,name,state,state_at,created_at) VALUES(?,?,?,?,?,?,?,?)").run("ew_orphan_role2", A, "demo", "role", "합성 역할 창", "idle", Date.now() - 500, T + 1);
  const h4 = await post(D1, A, "/api/chat", { channel: "n:사라진 채널", thread: ts, text: "합성 답장" }) as any;
  assert.equal(h4.path, "/api/me/windows/ew_orphan_role2/say", JSON.stringify(h4));
  // 닫힌 창은 손잡이가 있어도 안 감
  db.prepare("UPDATE engine_window SET state = 'closed' WHERE id = 'ew_orphan_role2'").run();
  db.prepare("UPDATE engine_window SET state = 'closed' WHERE id = 'ew_orphan_role'").run();
  assert.equal((await post(D1, A, "/api/chat", { channel: "n:사라진 채널", thread: ts, text: "합성 답장" }) as any).path, "/api/me/chat");
});
