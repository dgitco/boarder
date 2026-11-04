// node --test --no-warnings --experimental-transform-types apps/web/worker/front-door.test.ts
// 합성 자료만. 앞단은 사람마다 설정(node_setting.data.front_door) — 설정한 회원만 묶이고, 설정 없는 회원은 아무 일도 없음.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);
const { data, get, post, load, paneOfId, tsOf, channelOf } = await import("./member-board.ts");
const { query } = await import("./member-search.ts");
const { frontDoorNode, frontDoorOf } = await import("./front-door.ts");
const { prefsPatch, savePrefs, readPrefs } = await import("./node-prefs.ts");
const OWNER = "front@example.test", BOT = { name: "합성 비서 봇" }, T = Date.now() - 10_000;
const IDS = ["n_front_demo_a", "n_front_demo_b"];
const NAMES = ["회사", "팀장"];
const FRONT = { name: "비서실장", panes: IDS.map(paneOfId), names: NAMES, aliases: ["합성 비서 봇"] };
const FD = frontDoorOf(FRONT)!;
async function setup(owner = OWNER, front: unknown = FRONT) {
  const db = new DatabaseSync(":memory:"), mig = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(mig).filter(x => x.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, mig), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => s.all())) } as unknown as D1Database;
  for (const [i, id] of IDS.entries()) {
    db.prepare("INSERT INTO mnode(owner,id,name,area,state,why,counts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(owner, id, NAMES[i], "demo", "working", "", JSON.stringify({ main: "window:demo:" + i }), T, T);
    db.prepare("INSERT INTO imp_item(owner,key,device_id,kind,engine,title,state,win,seen_at,handle) VALUES(?,?,?,?,?,?,?,?,?,?)").run(owner, "window:demo:" + i, "demo", "window", "herdr-own", NAMES[i], "working", "demo:" + i, T, JSON.stringify({ engine: "herdr-own", pane: "demo" + i }));
    db.prepare("INSERT INTO mnode_item(owner,item,node,how) VALUES(?,?,?,'pin')").run(owner, "window:demo:" + i, id);
    db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)").run(owner, "demo:" + i, "chat", "합성 기록 " + NAMES[i], T + i);
  }
  db.prepare("INSERT INTO imp_item(owner,key,device_id,kind,engine,title,state,seen_at) VALUES(?,?,?,?,?,?,?,?)").run(owner, "session:demo:old", "demo", "session", "claude", "합성 지난 대화", "idle", T);
  db.prepare("INSERT INTO mnode_item(owner,item,node,how) VALUES(?,?,?,'pin')").run(owner, "session:demo:old", IDS[1]);
  db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES(?,?,?,?,?,?)").run(owner, "나", "chat", "합성 Primary 글", "primary", T + 2);
  db.prepare("INSERT INTO board_card(owner,id,win,kind,question,choices,state,at) VALUES(?,?,?,?,?,'[]',?,?)").run(owner, "1793770000.000777", "demo:1", "todo", "합성 카드", "closed", T + 3);
  if (front) await savePrefs(D1, owner, prefsPatch({ front_door: front })!);   // 설정 › 노드 API 와 같은 길로 저장
  return { db, D1 };
}
async function read(D1: D1Database, path: string, owner = OWNER) {
  const r = await get(D1, owner, BOT, new URL(path, "https://demo.test"), async () => null);
  assert.ok(r); assert.equal(r.status, 200); return await r.json() as any;
}

test("앞단 셋은 비서실장 한 칸, 원본 노드 · 창 · 줄 · 카드는 보존", async () => {
  const { db, D1 } = await setup(), d = await data(D1, OWNER, BOT) as any;
  assert.deepEqual(d.panes.map((p: any) => p.win), ["비서실장"]);
  assert.ok(d.front_door.aliases.includes("팀장")); assert.ok(d.front_door.aliases.includes(paneOfId(IDS[0])));
  assert.equal(d.cardsdone[0].channel, "primary");
  assert.equal(db.prepare("SELECT count(*) n FROM mnode").get()!.n, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM imp_item").get()!.n, 3);
  assert.equal(db.prepare("SELECT count(*) n FROM board_log").get()!.n, 3);
  assert.equal(db.prepare("SELECT count(*) n FROM board_card").get()!.n, 1);
  if (process.env.FRONT_DOOR_PREVIEW_OUT) writeFileSync(process.env.FRONT_DOOR_PREVIEW_OUT, JSON.stringify(d));
});

test("비서실장 내역과 옛 노드 주소에서 세 앞단 글 · 닫힌 카드 · 지난 대화를 읽음", async () => {
  const { D1 } = await setup();
  for (const path of ["/api/chat/primary", "/api/nodechat?w=" + encodeURIComponent("팀장")]) {
    const j = await read(D1, path), texts = j.messages.map((m: any) => m.text).join("\n");
    assert.match(texts, /합성 기록 회사/); assert.match(texts, /합성 기록 팀장/); assert.match(texts, /합성 Primary 글/); assert.match(texts, /합성 카드/); assert.match(texts, /지난 대화 1/);
    const fold = j.messages.find((m: any) => m.fold);
    const old = await read(D1, "/api/chat/primary/" + fold.ts);
    assert.ok(old.messages.some((m: any) => m.text === "합성 지난 대화"));
  }
  assert.equal(await channelOf(D1, OWNER, "demo:1"), "비서실장");
});

test("옛 스레드 주소와 답은 살아 있고, 새 글은 Primary 전송 경로 하나", async () => {
  const { db, D1 } = await setup(), root = db.prepare("SELECT id,at FROM board_log WHERE win='demo:1'").get()!, ts = tsOf(Number(root.at), Number(root.id));
  db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES(?,?,?,?,?,?)").run(OWNER, "demo:1", "chat", "합성 옛 스레드 답", ts, T + 4);
  for (const path of ["/api/chat/primary/" + ts, "/api/chat/n:" + encodeURIComponent("팀장") + "/" + ts]) {
    const j = await read(D1, path); assert.equal(j.channel, "primary");
    assert.ok(j.messages.some((m: any) => m.text === "합성 옛 스레드 답"));
  }
  for (const pane of IDS.map(paneOfId)) assert.deepEqual(await post(D1, OWNER, "/api/chat", { pane, text: "합성 새 요청" }), { path: "/api/me/chat", body: { text: "합성 새 요청" } });
  const reply = await post(D1, OWNER, "/api/chat", { pane: "%1", channel: "primary", thread: ts, text: "합성 스레드 요청" }) as any;
  assert.equal(reply.path, "/api/me/nodes/cmd"); assert.equal(reply.body.item, "window:demo:1"); assert.equal(reply.log.thread, ts);
});

test("검색의 옛 앞단 글은 비서실장 Primary 위치로", async () => {
  const { D1 } = await setup(), s = await query(D1, OWNER, "합성 기록");
  assert.equal(s.chats.length, 2); assert.ok(s.chats.every((c: any) => c.kind === "chat" && c.title === "비서실장" && c.node === null && c.ch === "primary"));
});

test("다른 회원 · 같은 이름의 다른 노드 · hash만 같은 노드는 합치지 않음", async () => {
  const { D1 } = await setup("other@example.test", null), d = await data(D1, "other@example.test", BOT) as any;
  assert.equal(d.front_door, undefined); assert.ok(d.panes.some((p: any) => p.win === "팀장"));
  assert.equal(frontDoorNode(FD, { pane: "%9999999", name: "팀장" }), false);
  assert.equal(frontDoorNode(FD, { pane: paneOfId(IDS[1]), name: "다른 일" }), false);
  assert.equal(frontDoorNode(null, { pane: paneOfId(IDS[1]), name: "팀장" }), false);
  const L = await load(D1, "other@example.test"); assert.equal(L.front, null);
});

test("명시한 비대상 pane/id가 앞단과 동명이어도 그 노드에서 읽고 그 창으로 보냄", async () => {
  const { db, D1 } = await setup(), id = "n_different_team", key = "window:demo:other";
  db.prepare("INSERT INTO mnode(owner,id,name,area,state,counts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(OWNER, id, "팀장", "other", "working", JSON.stringify({ main: key }), T, T);
  db.prepare("INSERT INTO imp_item(owner,key,device_id,kind,engine,title,state,win,seen_at) VALUES(?,?,?,?,?,?,?,?,?)").run(OWNER, key, "demo", "window", "herdr-own", "팀장", "working", "demo:other", T);
  db.prepare("INSERT INTO mnode_item(owner,item,node,how) VALUES(?,?,?,'pin')").run(OWNER, key, id);
  db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)").run(OWNER, "demo:other", "chat", "다른 팀장의 글", T + 4);
  const j = await read(D1, "/api/nodechat?w=" + encodeURIComponent("팀장") + "&id=" + id);
  assert.ok(j.messages.some((m: any) => m.text === "다른 팀장의 글"));
  assert.ok(!j.messages.some((m: any) => /합성 Primary|합성 기록/.test(m.text)));
  const hop = await post(D1, OWNER, "/api/chat", { pane: paneOfId(id), channel: "n:팀장", text: "다른 팀장 요청" }) as any;
  assert.equal(hop.path, "/api/me/nodes/cmd"); assert.equal(hop.body.item, key);
});

test("같은 노드 · 이름이어도 앞단 설정이 없는 회원(기본값)은 예전 그대로 — 노드 칸 · 메인 봇 이름 · 찾기", async () => {
  const { D1 } = await setup(OWNER, null), d = await data(D1, OWNER, BOT) as any;
  assert.equal(d.front_door, undefined);
  assert.ok(!("node_aliases" in d) && !("task_channels" in d), "꺼진 회원의 판에는 새 칸이 없음");
  assert.equal(d.cardsdone[0].channel, "n:팀장", "카드는 예전처럼 그 노드 채널");
  assert.deepEqual(d.panes.map((p: any) => p.win).sort(), [BOT.name, ...NAMES].sort());
  assert.equal((await load(D1, OWNER)).front, null);
  const s = await query(D1, OWNER, "합성 기록");
  assert.ok(s.chats.every((c: any) => c.title !== "비서실장"));
  assert.equal(await channelOf(D1, OWNER, "demo:1"), "팀장");
});

test("앞단 설정: 틀린 값은 저장 안 함 · null 은 끔 · 판과 이름이 짝으로 맞아야 함", async () => {
  assert.equal(prefsPatch({ front_door: { name: "x", panes: ["%1"], names: [] } }), null);
  assert.equal(prefsPatch({ front_door: { name: "", panes: ["%1"], names: ["a"] } }), null);
  assert.equal(prefsPatch({ front_door: { name: "x", panes: ["1"], names: ["a"] } }), null);
  assert.deepEqual(prefsPatch({ front_door: null }), { front_door: null });
  const { D1 } = await setup();
  assert.equal((await readPrefs(D1, OWNER)).front_door?.name, "비서실장");
  await savePrefs(D1, OWNER, prefsPatch({ front_door: null })!);
  assert.equal((await readPrefs(D1, OWNER)).front_door, null);
  assert.equal((await load(D1, OWNER)).front, null);
  assert.equal(frontDoorNode(frontDoorOf({ name: "x", panes: ["%1", "%2"], names: ["a", "b"] }), { pane: "%1", name: "b" }), false);
});
