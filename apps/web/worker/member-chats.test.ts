import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const { default: app } = await import("./index.ts");
const MB = await import("./member-board.ts");
const MV = await import("./member-views.ts");
const { regroup } = await import("./importer/routes.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", e); return new Response("{}", { status: 500 }); });

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => run1(sql, args),
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => { db.exec("BEGIN"); try { const o = ss.map(s => /^\s*select/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; } },
  } as unknown as D1Database;
  return { db, D1 };
}
const OWNER = "owner@example.test", A = "member@example.test", B = "other@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}

async function setup(o: { engineA?: boolean; openFail?: number } = {}) {
  const { db, D1 } = d1(), T = Date.now();
  for (const m of [A, B]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)");
  dev.run("devA", A, "mbp", "", "a".repeat(64), T, T, "full", o.engineA === false ? null : T);
  dev.run("devB", B, "theirs", "", "b".repeat(64), T, T, "full", T);
  const ew = db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?)");
  ew.run("ew_achat000001", A, "devA", "chat", "예전 대화", "idle", T - 9000, T - 9000);
  ew.run("ew_arole000001", A, "devA", "role", "예시 정리 창", "idle", T, T);
  ew.run("ew_bchat000001", B, "devB", "chat", "남의 대화", "idle", T, T);
  ew.run("ew_achat000009", A, "devA", "chat", "닫힌 대화", "closed", T, T);
  const log = db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)");
  log.run(A, "예전 대화", "me", "예전 질문", null, T - 8000, "ew_achat000001");
  log.run(A, "예전 대화", "status", "상태 줄", null, T - 7500, "ew_achat000001");
  log.run(A, "예전 대화", "reply", "예전 답", null, T - 7000, "ew_achat000001");
  log.run(B, "남의 대화", "me", "B 의 비밀 질문", null, T - 6000, "ew_bchat000001");
  log.run(A, "예시 정리 창", "progress", "정리 창 진행", null, T - 5000, "ew_arole000001");
  // 가짜 엔진 DO — 연 창은 진짜처럼 engine_window 줄을 남기고(open 은 그 기기 줄), 넣은 글은 붙잡음
  const opened: any[] = [], delivered: [string, string, string][] = [];
  let n = 0;
  const ENGINE = {
    idFromName: (s: string) => s,
    get: (id: string) => ({
      open: async (w: any) => { if (o.openFail && o.openFail-- > 0) throw new Error("창을 못 열었어요"); const wid = `ew_new${String(++n).padStart(6, "0")}`; opened.push({ ...w, device: id }); db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?)").run(wid, w.owner, id.replace(/^dev:/, ""), w.kind, w.name, "starting", Date.now(), Date.now()); return { id: wid }; },
      deliver: async (wid: string, text: string) => { delivered.push([id, wid, text]); return { sent: true }; },
    }),
  };
  const env: any = { DB: D1, ENGINE, SNAP: { idFromName: (s: string) => s, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  const human = async (email = A) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  return { db, D1, call, human, opened, delivered };
}

test("목록: 내 chat 창만(닫힌 것 · 역할 창 · 남의 것 빼고), 주인 꼴 { sid, title, at }", async () => {
  const s = await setup();
  const r = await s.call("GET", "/api/chats", undefined, await s.human());
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.chats.map((c: any) => [c.sid, c.title]), [["ew_achat000001", "예전 대화"]]);
  assert.equal(typeof r.j.chats[0].at, "number");
  const rb = await s.call("GET", "/api/chats", undefined, await s.human(B));
  assert.deepEqual(rb.j.chats.map((c: any) => c.sid), ["ew_bchat000001"]);
});

test("기록: 내 대화는 내 글(owner) · 답(agent) 차례대로 — 상태 줄 · 남의 대화 · 역할 창 · 닫힌 대화 · 꼴 틀린 id 는 404", async () => {
  const s = await setup(), h = await s.human();
  const r = await s.call("GET", "/api/chatlog?sid=ew_achat000001", undefined, h);
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.messages.map((m: any) => [m.who, m.text]), [["owner", "예전 질문"], ["agent", "예전 답"]]);
  assert.match(r.j.messages[0].ts, /^\d{10}\.\d{6}$/);
  assert.equal(r.j.working, false); assert.equal(r.j.title, "예전 대화");
  for (const sid of ["ew_bchat000001", "ew_arole000001", "ew_achat000009", "../x", ""]) {
    const x = await s.call("GET", "/api/chatlog?sid=" + encodeURIComponent(sid), undefined, h);
    assert.equal(x.status, 404, sid); assert.equal(x.j.messages, undefined);
  }
});

test("새 대화: 틀 POST /api/chat/new → 내 엔진 기기에 chat 창(~/boarder/chat, 첫 글 그대로) · 답 { sid, title } · 목록 맨 앞 · 기록에 내 글 · 답 쓰는 중", async () => {
  const s = await setup(), h = await s.human();
  const long = "이번 주 할 일을 정리해 줘 그리고 내일 회의 준비도 같이 부탁해";
  const r = await s.call("POST", "/api/chat/new", { text: long }, h);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.j.ok, true); assert.match(r.j.sid, /^ew_new/); assert.equal(r.j.title, Array.from(long).slice(0, 28).join("") + "…");
  assert.equal(s.opened.length, 1);
  assert.deepEqual({ owner: s.opened[0].owner, kind: s.opened[0].kind, cwd: s.opened[0].cwd, prompt: s.opened[0].prompt, device: s.opened[0].device }, { owner: A, kind: "chat", cwd: "~/boarder/chat", prompt: long, device: "dev:devA" });
  const list = await s.call("GET", "/api/chats", undefined, h);
  assert.equal(list.j.chats[0].sid, r.j.sid);
  const lg = await s.call("GET", "/api/chatlog?sid=" + r.j.sid, undefined, h);
  assert.deepEqual(lg.j.messages.map((m: any) => [m.who, m.text]), [["owner", long]]);
  assert.equal(lg.j.working, true);
  s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").run(A, r.j.title, "reply", "정리했어요", null, Date.now() + 5, r.j.sid);
  s.db.prepare("UPDATE engine_window SET state = 'idle' WHERE id = ?").run(r.j.sid);
  const lg2 = await s.call("GET", "/api/chatlog?sid=" + r.j.sid, undefined, h);
  assert.deepEqual(lg2.j.messages.map((m: any) => m.who), ["owner", "agent"]); assert.equal(lg2.j.working, false);
});

test("새 대화: 빈 글 400 · 엔진 켜진 기기 없음 409 · 창을 안 엶", async () => {
  const s = await setup({ engineA: false }), h = await s.human();
  assert.equal((await s.call("POST", "/api/chat/new", { text: "  " }, h)).status, 400);
  const r = await s.call("POST", "/api/chat/new", { text: "안녕" }, h);
  assert.equal(r.status, 409); assert.match(r.j.error, /엔진이 켜진 기기가 없어요/);
  assert.equal(s.opened.length, 0);
});

test("대화에 글: 내 대화만 그 창에 그대로(머리 줄 없이) · 내 글 줄 남김 — 남의 대화 · 역할 창 · 닫힌 대화 404, 빈 글 400, 창에 안 감", async () => {
  const s = await setup(), h = await s.human();
  const r = await s.call("POST", "/api/chat/send", { sid: "ew_achat000001", text: "하나 더 물어볼게" }, h);
  assert.equal(r.status, 200, r.text); assert.equal(r.j.ok, true);
  assert.deepEqual(s.delivered, [["dev:devA", "ew_achat000001", "하나 더 물어볼게"]]);
  const lg = await s.call("GET", "/api/chatlog?sid=ew_achat000001", undefined, h);
  assert.deepEqual(lg.j.messages.at(-1), { ...lg.j.messages.at(-1), who: "owner", text: "하나 더 물어볼게" });
  assert.equal(lg.j.working, true);
  for (const sid of ["ew_bchat000001", "ew_arole000001", "ew_achat000009", "x"]) {
    const x = await s.call("POST", "/api/chat/send", { sid, text: "글" }, h);
    assert.equal(x.status, 404, sid);
  }
  assert.equal((await s.call("POST", "/api/chat/send", { sid: "ew_achat000001", text: "" }, h)).status, 400);
  // 안쪽 길을 바로 불러도 남의 대화엔 못 넣음
  assert.equal((await s.call("POST", "/api/me/chats/ew_bchat000001/send", { text: "글" }, h)).status, 404);
  assert.equal(s.delivered.length, 1);
  // B 의 글은 B 대화에만
  const rb = await s.call("POST", "/api/chat/send", { sid: "ew_bchat000001", text: "B 글" }, await s.human(B));
  assert.equal(rb.status, 200); assert.deepEqual(s.delivered.at(-1), ["dev:devB", "ew_bchat000001", "B 글"]);
});

test("대화 줄은 노드 트리 · 소식 · 판 줄 · 타임라인에 안 섞임(역할 창 줄은 그대로)", async () => {
  const s = await setup();
  const L = await MB.load(s.D1, A);
  assert.equal(L.logs.some((r: any) => /예전/.test(r.text)), false);
  assert.equal(L.logs.some((r: any) => r.text === "정리 창 진행"), true);
  assert.equal(L.engineNodes.some((w: any) => w.kind === "chat"), false);
  const d = await MB.data(s.D1, A, { name: "메인 봇" });
  assert.equal(JSON.stringify(d).includes("예전 답"), false);
  assert.equal(JSON.stringify(d).includes("예전 대화"), false);
  const hi = await MV.history(s.D1, A, null);
  assert.equal(JSON.stringify(hi).includes("예전 대화"), false);
});

test("제목: 주인 _chat_title 과 같게(제어 글자 · 빈칸 한 칸, 28자 넘으면 …, 빈 글 = 새 대화)", () => {
  assert.equal(MB.chatTitle("  안녕\n\t하세요  "), "안녕 하세요");
  assert.equal(MB.chatTitle(""), "새 대화");
  assert.equal(MB.chatTitle("가".repeat(29)), "가".repeat(28) + "…");
});

test("묶기(regroup): 대화 창의 답 줄 · 물음 카드는 노드를 만들지 않음(역할 창 줄은 노드)", async () => {
  const s = await setup(), T = Date.now();
  // 턴 훅 답(kind reply · 스레드 없음 · win = 대화 제목) · 대화 창이 부른 inbox_ask 카드
  s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").run(A, "예전 대화", "reply", "또 답", null, T, "ew_achat000001");
  s.db.prepare("INSERT INTO board_card(id, owner, win, question, choices, state, at, wid) VALUES (?,?,?,?,'[]','open',?,?)").run("k_chat", A, "예전 대화", "대화에서 물음?", T, "ew_achat000001");
  const r = await regroup({ DB: s.D1 } as never, A);
  const items = r.nodes.flatMap((n: any) => n.items);
  assert.equal(items.some((k: string) => /예전 대화/.test(k)), false, JSON.stringify(items));
  assert.equal(items.includes("win:예시 정리 창"), true, JSON.stringify(items));
  const rows = s.db.prepare("SELECT name FROM mnode WHERE owner = ?").all(A) as { name: string }[];
  assert.equal(rows.some(x => /예전 대화/.test(x.name)), false);
});

test("/api/me/board: 대화 창 줄은 장부 줄에 안 섞임", async () => {
  const s = await setup();
  const r = await s.call("GET", "/api/me/board", undefined, await s.human());
  assert.equal(r.status, 200, r.text);
  assert.equal(r.text.includes("예전 답"), false); assert.equal(r.text.includes("예전 질문"), false);
  assert.equal(r.text.includes("정리 창 진행"), true);
});

test("새 대화: 같은 rid 로 다시 보내면 창 하나(처음 연 대화로 답) · 다른 rid 는 새 창", async () => {
  const s = await setup(), h = await s.human();
  const r1 = await s.call("POST", "/api/chat/new", { text: "첫 글", rid: "rid-chat-0001" }, h);
  assert.equal(r1.status, 200, r1.text);
  const r2 = await s.call("POST", "/api/chat/new", { text: "첫 글", rid: "rid-chat-0001" }, h);
  assert.equal(r2.status, 200, r2.text); assert.equal(r2.j.sid, r1.j.sid); assert.equal(r2.j.title, "첫 글"); assert.equal(r2.j.already, true);
  assert.equal(s.opened.length, 1);
  const lines = s.db.prepare("SELECT count(*) n FROM board_log WHERE wid = ?").get(r1.j.sid) as { n: number };
  assert.equal(lines.n, 1);
  // 남이 같은 rid 를 보내도 내 대화를 받지 않음
  const rb = await s.call("POST", "/api/chat/new", { text: "첫 글", rid: "rid-chat-0001" }, await s.human(B));
  assert.notEqual(rb.j?.sid, r1.j.sid);
  const r3 = await s.call("POST", "/api/chat/new", { text: "첫 글", rid: "rid-chat-0002" }, h);
  assert.equal(r3.status, 200); assert.notEqual(r3.j.sid, r1.j.sid);
  assert.equal(s.opened.filter(w => w.owner === A).length, 2);
});

test("새 대화: rid 를 잡은 채 다른 요청이 여는 중이면 다시 보내라(503 x-retry-safe) · 2분 넘게 창이 없으면 다시 잡아 엶", async () => {
  const s = await setup(), h = await s.human();
  s.db.prepare("INSERT INTO f7_rid(rid, at) VALUES (?, ?)").run("rid-chat-busy1", Date.now());
  const r = await s.call("POST", "/api/me/chats/new", { text: "글", rid: "rid-chat-busy1" }, h);
  assert.equal(r.status, 503); assert.equal(s.opened.length, 0);
  s.db.prepare("UPDATE f7_rid SET at = ? WHERE rid = ?").run(Date.now() - 3 * 60_000, "rid-chat-busy1");
  const r2 = await s.call("POST", "/api/me/chats/new", { text: "글", rid: "rid-chat-busy1" }, h);
  assert.equal(r2.status, 200, r2.text); assert.equal(s.opened.length, 1);
});

test("새 대화: 창을 못 열면 rid 를 놓아 다시 보내면 엶", async () => {
  const s = await setup({ openFail: 1 }), h = await s.human();
  const r = await s.call("POST", "/api/chat/new", { text: "글", rid: "rid-chat-fail1" }, h);
  assert.equal(r.status, 400); assert.equal(s.opened.length, 0);
  const r2 = await s.call("POST", "/api/chat/new", { text: "글", rid: "rid-chat-fail1" }, h);
  assert.equal(r2.status, 200, r2.text); assert.equal(s.opened.length, 1);
});

test("새 대화: 열린 대화가 상한(20)이면 409 한국어 · 창을 안 엶(닫힌 대화는 안 셈)", async () => {
  const s = await setup(), h = await s.human(), T = Date.now();
  const ew = s.db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?)");
  for (let i = 0; i < MB.CHAT_MAX - 1; i++) ew.run(`ew_amany${String(i).padStart(6, "0")}`, A, "devA", "chat", "대화", "idle", T, T);   // + 예전 대화 하나 = 상한
  const r = await s.call("POST", "/api/chat/new", { text: "하나 더" }, h);
  assert.equal(r.status, 409); assert.match(r.j.error, /열린 대화가 20개예요/);
  assert.equal(s.opened.length, 0);
  s.db.prepare("UPDATE engine_window SET state = 'closed' WHERE id = ?").run("ew_amany000000");
  assert.equal((await s.call("POST", "/api/chat/new", { text: "하나 더" }, h)).status, 200);
});
