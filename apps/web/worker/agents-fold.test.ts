import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);
const { data, get, load, paneOfId, tsOf, foldScreen } = await import("./member-board.ts");
const { inbox } = await import("./member-inbox.ts");
const { peerIds, PEER_TS } = await import("./agents-fold.ts");
const { prefsPatch, savePrefs, readPrefs } = await import("./node-prefs.ts");
const { peerReply } = await import("./member-push.ts");
const OWNER = "fold@example.test", BOT = { name: "합성 비서 봇" }, T = Date.now() - 60_000;
const BOSS = "n_fold_boss", LEAD = "n_fold_lead";

function mkDb() {
  const db = new DatabaseSync(":memory:"), mig = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(mig).filter(x => x.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, mig), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => s.all())) } as unknown as D1Database;
  return { db, D1 };
}
async function setup(fold: boolean) {
  const { db, D1 } = mkDb();
  for (const [id, name, win] of [[BOSS, "팀장", "boss:1"], [LEAD, "기술장", "lead:1"]]) {
    db.prepare("INSERT INTO mnode(owner,id,name,area,state,why,counts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(OWNER, id, name, "", "working", "", JSON.stringify({ main: "window:" + win }), T, T);
    db.prepare("INSERT INTO imp_item(owner,key,device_id,kind,engine,title,state,win,session,seen_at,handle) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(OWNER, "window:" + win, "demo", "window", "herdr-own", name, "working", win, "sess-" + id, T, JSON.stringify({ engine: "herdr-own", pane: win }));
    db.prepare("INSERT INTO mnode_item(owner,item,node,how) VALUES(?,?,?,'pin')").run(OWNER, "window:" + win, id);
  }
  db.prepare("INSERT INTO node_setting(owner,data,updated_at) VALUES(?,?,?)").run(OWNER, JSON.stringify({ parent: { [LEAD]: "top" } }), T);
  const log = (win: string, kind: string, text: string, dt: number, thread: string | null = null) => db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES(?,?,?,?,?,?)").run(OWNER, win, kind, text, thread, T + dt);
  // 비서실장 창: 다른 창이 넣은 글의 답(내 글 없음) · 진행 줄 = 에이전트끼리 / 내 글 · 그 답 · 막힘 · 카드 = 사람 몫
  log("boss:1", "reply", "합성 부서장 보고 받음 — 기술장에게 넘김", 1);
  log("boss:1", "progress", "합성 진행 줄", 2);
  log("팀장", "me", "합성 대표 질문", 3);
  log("boss:1", "reply", "합성 대표님께 드린 답", 4);
  log("boss:1", "blocked", "합성 막힘 — 대표님 결정 필요", 5);
  log("나", "chat", "합성 Primary 글", 6, "primary");
  db.prepare("INSERT INTO board_card(owner,id,win,kind,question,choices,state,at) VALUES(?,?,?,?,?,'[]',?,?)").run(OWNER, "1793770000.000888", "boss:1", "decision", "합성 결정 카드", "open", T + 7);
  // 부서장 창: 작업자 답(내 글 없음) = 에이전트끼리, 내 글 뒤 첫 답 = 사람 몫
  log("lead:1", "reply", "합성 작업자 결과 받음", 8);
  log("lead:1", "status", "합성 상태 줄", 9);
  log("기술장", "me", "합성 기술장에게 물음", 10);
  log("lead:1", "reply", "합성 기술장 답", 11);
  await savePrefs(D1, OWNER, prefsPatch({ front_door: { name: "비서실장", panes: [paneOfId(BOSS)], names: ["팀장"] }, ...(fold ? { agents_fold: true } : {}) })!);
  return { db, D1 };
}
async function read(D1: D1Database, path: string) {
  const r = await get(D1, OWNER, BOT, new URL(path, "https://demo.test"), async () => null);
  assert.ok(r); assert.equal(r.status, 200); return await r.json() as any;
}
const PEER_BOSS = ["합성 부서장 보고 받음 — 기술장에게 넘김", "합성 진행 줄"], HUMAN_BOSS = ["합성 대표 질문", "합성 대표님께 드린 답", "합성 막힘 — 대표님 결정 필요", "합성 Primary 글", "합성 결정 카드"];

test("판정: 내 글 뒤 첫 답 · 막힘은 사람 몫, 내 글 없이 온 답 · 진행 · 상태는 에이전트끼리, 스레드 답은 안 셈", () => {
  const rows = [
    { id: 1, win: "w", kind: "reply", at: 1 }, { id: 2, win: "w", kind: "progress", at: 2 }, { id: 3, win: "나", kind: "chat", at: 3 },
    { id: 4, win: "w", kind: "reply", at: 4 }, { id: 5, win: "w", kind: "reply", at: 5 }, { id: 6, win: "w", kind: "blocked", at: 6 },
    { id: 7, win: "w", kind: "status", at: 7, thread: "1793770000.000001" }, { id: 8, win: "노드", kind: "me", at: 8 }, { id: 9, win: "w", kind: "decision", at: 9 }, { id: 10, win: "w", kind: "reply", at: 10 },
  ];
  assert.deepEqual([...peerIds(rows)].sort(), ["1", "2", "5"]);
  assert.deepEqual([...peerIds([...rows].reverse())].sort(), ["1", "2", "5"], "줄 순서 상관없음");
});

test("켬: 메인 봇 채팅에 에이전트끼리 줄은 섞이지 않고 맨 위 접힌 글 하나 · 펼치면 시각 순 · 카드 · 내 글 · 답 · 막힘은 그대로", async () => {
  const { D1 } = await setup(true), j = await read(D1, "/api/chat/primary"), texts = j.messages.map((m: any) => m.text);
  const top = j.messages[0];
  assert.ok(top.fold?.agents === 2 && PEER_TS.test(top.ts) && top.ch === "primary", JSON.stringify(top));
  assert.ok(top.text.startsWith("에이전트끼리 2"));
  for (const t of PEER_BOSS) assert.ok(!texts.includes(t), "섞이지 않음: " + t);
  for (const t of HUMAN_BOSS) assert.ok(texts.includes(t), "그대로: " + t);
  const th = await read(D1, "/api/chat/primary/" + top.ts);
  assert.deepEqual(th.messages.slice(1).map((m: any) => m.text), PEER_BOSS, "펼치면 시각 순");
  assert.ok(th.messages.slice(1).every((m: any) => m.thread === top.ts && m.quiet));
  const d = await data(D1, OWNER, BOT) as any;
  assert.equal(d.agents_fold, true);
  assert.equal(d.decisions.find((x: any) => x.title === "합성 결정 카드")?.pane, "%1");
  assert.equal(j.messages.find((m: any) => m.text === "합성 결정 카드")?.name, "비서실장", "카드 글쓴이 = 메인 봇 이름(창 id 아님)");
  const card = await read(D1, "/api/chat/primary/1793770000.000888");
  assert.equal(card.messages[0].name, "비서실장");
});

test("꺼짐(기본): 예전 그대로 — 앞단 글이 메인 봇에 시각 순으로 섞이고 접힌 글 없음 · 판에 새 칸 없음", async () => {
  const { D1 } = await setup(false), j = await read(D1, "/api/chat/primary"), texts = j.messages.map((m: any) => m.text);
  for (const t of [...PEER_BOSS, ...HUMAN_BOSS]) assert.ok(texts.includes(t), t);
  assert.ok(!j.messages.some((m: any) => m.fold?.agents));
  const n = await read(D1, "/api/nodechat?w=" + encodeURIComponent("기술장"));
  assert.ok(n.messages.some((m: any) => m.text === "합성 작업자 결과 받음") && !n.messages.some((m: any) => m.fold?.agents));
  assert.equal(((await data(D1, OWNER, BOT)) as any).agents_fold, undefined);
  assert.equal((await readPrefs(D1, OWNER)).agents_fold, false);
});

test("켬: 부서장 에이전트 칸도 같은 틀 — 접힌 글 · 펼치기 · 읽지 않음에 안 셈", async () => {
  const { D1 } = await setup(true), n = await read(D1, "/api/nodechat?w=" + encodeURIComponent("기술장")), texts = n.messages.map((m: any) => m.text);
  assert.ok(n.messages[0].fold?.agents === 2 && n.messages[0].ch === "n:기술장");
  assert.ok(!texts.includes("합성 작업자 결과 받음") && !texts.includes("합성 상태 줄"));
  assert.ok(texts.includes("합성 기술장에게 물음") && texts.includes("합성 기술장 답"));
  const th = await read(D1, "/api/chat/n:" + encodeURIComponent("기술장") + "/" + n.messages[0].ts);
  assert.deepEqual(th.messages.slice(1).map((m: any) => m.text), ["합성 작업자 결과 받음", "합성 상태 줄"]);
  const u = (await inbox(D1, OWNER)).unread.map((x: any) => x.text);
  assert.ok(!u.includes("합성 작업자 결과 받음"), "접힌 칸 줄은 읽지 않음에 안 셈");
  assert.ok(u.includes("합성 기술장 답"), "대표님 대화 답은 그대로 셈");
});

test("꺼짐이면 부서장 칸 읽지 않음도 예전 그대로", async () => {
  const { D1 } = await setup(false), u = (await inbox(D1, OWNER)).unread.map((x: any) => x.text);
  assert.ok(u.includes("합성 작업자 결과 받음"));
});

test("창이 옮겨 창 키 · 이름이 바뀌어도 같은 대화(session)면 그 노드 — 글 · 카드가 같은 칸으로", async () => {
  const { db, D1 } = await setup(true);
  db.prepare("INSERT INTO imp_item(owner,key,device_id,kind,engine,title,state,win,session,seen_at,handle) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(OWNER, "window:pc4:new", "pc4", "window", "herdr-own", "기술장", "working", "pc4:ew_new", "sess-" + LEAD, T, "{}");
  db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)").run(OWNER, "pc4:ew_new", "blocked", "합성 옮긴 창의 막힘", T + 12);
  const L = await load(D1, OWNER);
  assert.equal(L.nodeOfWin("pc4:ew_new")?.id, LEAD);
  const n = await read(D1, "/api/nodechat?w=" + encodeURIComponent("기술장"));
  assert.ok(n.messages.some((m: any) => m.text === "합성 옮긴 창의 막힘"));
  // 대화 id 가 다른 새 창은 예전처럼 어느 노드도 아님
  db.prepare("INSERT INTO imp_item(owner,key,device_id,kind,engine,title,state,win,session,seen_at,handle) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(OWNER, "window:pc4:other", "pc4", "window", "herdr-own", "남", "working", "pc4:ew_other", "sess-other", T, "{}");
  assert.equal((await load(D1, OWNER)).nodeOfWin("pc4:ew_other"), null);
  // 끈 사람은 예전 그대로(대화 id 로 따라가지 않음)
  const off = await setup(false);
  off.db.prepare("INSERT INTO imp_item(owner,key,device_id,kind,engine,title,state,win,session,seen_at,handle) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(OWNER, "window:pc4:new", "pc4", "window", "herdr-own", "기술장", "working", "pc4:ew_new", "sess-" + LEAD, T, "{}");
  assert.equal((await load(off.D1, OWNER)).nodeOfWin("pc4:ew_new"), null);
});

test("알림: 켠 사람의 내 글 없이 온 턴 답은 「답이 왔어요」가 아님 · 내 글 뒤 답 · 끈 사람은 예전 그대로", async () => {
  const on = await setup(true), off = await setup(false);
  for (const { db, D1 } of [on, off]) {
    // 기술장 답 뒤로 내 글 없이 온 답(작업자 글의 답) — 내 글이 어느 채널이든 그 사이에 있으면 사람 답으로 셈(알림이 남는 쪽)
    db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)").run(OWNER, "lead:1", "reply", "합성 작업자 둘째 결과", T + 20);
    const id = (t: string) => Number(db.prepare("SELECT id FROM board_log WHERE text = ?").get(t)!.id);
    const line = (t: string, win: string) => ({ id: id(t), tool: "inbox_log" as const, kind: "reply", text: t, thread: null, win });
    const peer = await peerReply(D1, OWNER, line("합성 작업자 둘째 결과", "lead:1")), human = await peerReply(D1, OWNER, line("합성 기술장 답", "lead:1"));
    if (db === on.db) { assert.equal(peer, true); assert.equal(human, false); } else { assert.equal(peer, false); assert.equal(human, false); }
  }
});

test("설정: agents_fold 는 참 · 거짓만 저장", async () => {
  assert.deepEqual(prefsPatch({ agents_fold: true }), { agents_fold: true });
  assert.equal(prefsPatch({ agents_fold: "yes" }), null);
  const { D1 } = await setup(true);
  await savePrefs(D1, OWNER, prefsPatch({ agents_fold: false })!);
  assert.equal((await readPrefs(D1, OWNER)).agents_fold, false);
  assert.equal((await readPrefs(D1, OWNER)).front_door?.name, "비서실장", "다른 칸은 그대로");
  assert.ok(tsOf(1, 1));
});

function counted(D1: D1Database) {
  let batches = 0; const sqls: string[] = [];
  const C = { prepare: (s: string) => { sqls.push(s); return D1.prepare(s); }, batch: (ss: any[]) => { batches++; return D1.batch(ss); } } as unknown as D1Database;
  return { C, batches: () => batches, sqls, reset: () => { batches = 0; sqls.length = 0; } };
}
test("끈 사람은 load 가 늘지 않음: 카드 스레드 0 · 접은 글 꼴 ts 도 main 과 같은 횟수 · 알림 판정은 설정을 한 번만 읽음", async () => {
  const { MP } = { MP: await import("./member-push.ts") };
  for (const fold of [false, true]) {
    const { db, D1 } = await setup(fold), c = counted(D1);
    const at = (p: string) => get(c.C, OWNER, BOT, new URL(p, "https://demo.test"), async () => null);
    c.reset(); assert.equal((await at("/api/chat/primary/1793770000.000888"))!.status, 200);
    assert.equal(c.batches(), fold ? 1 : 0, `카드 스레드 load 횟수(fold=${fold})`);
    // 접은 글 꼴(.96xxxx)이지만 접은 글이 아닌 노드 글 ts: 끈 사람은 nodeThread 의 load 한 번(main 과 같음), 켠 사람도 같은 판을 나눠 써 한 번
    c.reset(); await at("/api/chat/n:" + encodeURIComponent("기술장") + "/1793770000.961234");
    assert.equal(c.batches(), 1, `노드 접은 글 꼴 ts load 횟수(fold=${fold})`);
    // 알림: 설정(node_setting) 읽기는 lineWhy 한 번 — peerReply 가 다시 안 읽음
    db.prepare("INSERT INTO board_log(owner,win,kind,text,at) VALUES(?,?,?,?,?)").run(OWNER, "lead:1", "reply", "합성 작업자 셋째 결과", T + 30);
    const id = Number(db.prepare("SELECT id FROM board_log WHERE text = ?").get("합성 작업자 셋째 결과")!.id);
    const sent: string[] = [], pu = { mPrefs: async () => [200, { wide: true }] as const, mDigest: async () => { sent.push("digest"); return null; }, mNotify: async () => { sent.push("notify"); return null; } } as any;
    c.reset(); await MP.routeLine(c.C, OWNER, { id, tool: "inbox_log", kind: "reply", text: "합성 작업자 셋째 결과", thread: null, win: "lead:1" } as any, pu);
    assert.equal(c.sqls.filter(s => /node_setting/.test(s)).length, 1, "설정 읽기 한 번");
    assert.deepEqual(sent, [fold ? "digest" : "notify"], "켠 사람만 진행 묶음, 끈 사람은 예전 그대로 「답이 왔어요」");
  }
  // 앞단 · 설정이 아예 없는 사람(주인 꼴): 접은 글 꼴 Primary ts 도 load 없음(main 과 같음)
  const { db, D1 } = mkDb(), c = counted(D1);
  db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES(?,?,?,?,?,?)").run(OWNER, "나", "chat", "합성 글", "primary", T);
  c.reset(); assert.equal((await get(c.C, OWNER, BOT, new URL("/api/chat/primary/1793770000.961234", "https://demo.test"), async () => null))!.status, 200);
  assert.equal(c.batches(), 0, "설정 없는 사람 Primary 접은 글 꼴 ts load 없음");
});

test("접기 대상: task_channels 켠 사람의 부서장 자리 노드(tk_<부서>)는 접고, 업무 노드(tk_<번호>)는 안 접음", () => {
  const node = (id: string) => ({ id } as never);
  const L = { agentsFold: true, taskChannels: true, seatIds: new Set(["tk_tech"]), agentScreen: () => true };
  assert.equal(foldScreen(L as never, node("tk_tech")), true);
  assert.equal(foldScreen(L as never, node("tk_1976")), false);
  assert.equal(foldScreen({ ...L, taskChannels: false } as never, node("tk_1976")), true);
  assert.equal(foldScreen({ ...L, agentsFold: false } as never, node("tk_tech")), false);
  assert.equal(foldScreen({ ...L, agentScreen: () => false } as never, node("tk_tech")), false);
});

test("채널 = 태스크를 켠 사람의 부서장 자리 노드(tk_<부서>)도 접힌 글 하나 — 태스크 두 겹으로 안 잡힘", async () => {
  const { db, D1 } = mkDb(), TK = "tk_tech";
  db.prepare("INSERT INTO mnode(owner,id,name,area,state,why,counts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(OWNER, TK, "기술 부서장", "", "working", "", JSON.stringify({ main: "window:lead:1" }), T, T);
  db.prepare("INSERT INTO imp_item(owner,key,device_id,kind,engine,title,state,win,session,seen_at,handle) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(OWNER, "window:lead:1", "demo", "window", "herdr-own", "기술장", "working", "lead:1", "sess-tk", T, JSON.stringify({ engine: "herdr-own", pane: "lead:1" }));
  db.prepare("INSERT INTO mnode_item(owner,item,node,how) VALUES(?,?,?,'pin')").run(OWNER, "window:lead:1", TK);
  db.prepare("INSERT INTO node_setting(owner,data,updated_at) VALUES(?,?,?)").run(OWNER, JSON.stringify({ roles: [{ name: "기술 부서장", win: "demo:lead:1", node: TK }] }), T);
  const log = (win: string, kind: string, text: string, dt: number) => db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES(?,?,?,?,?,?)").run(OWNER, win, kind, text, null, T + dt);
  log("lead:1", "reply", "합성 작업자 결과 받음", 1);
  log("lead:1", "status", "합성 상태 줄", 2);
  log("기술 부서장", "me", "합성 기술장에게 물음", 3);
  log("lead:1", "reply", "합성 기술장 답", 4);
  await savePrefs(D1, OWNER, prefsPatch({ task_channels: true, agents_fold: true })!);
  const n = await read(D1, "/api/nodechat?w=" + encodeURIComponent("기술 부서장")), texts = n.messages.map((m: any) => m.text);
  assert.ok(n.messages.some((m: any) => m.fold?.agents === 2), "맨 위 접힌 글 「에이전트끼리 2」");
  assert.ok(!texts.includes("합성 작업자 결과 받음") && !texts.includes("합성 상태 줄"));
  assert.ok(texts.includes("합성 기술장에게 물음") && texts.includes("합성 기술장 답"));
});
