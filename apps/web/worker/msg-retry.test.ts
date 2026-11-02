import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app, BoardSnap } = await import("./index.ts");

const MIG = new URL("../migrations/", import.meta.url);
// 가짜 D1 — batch 는 진짜 트랜잭션(하나라도 실패하면 전부 되돌림, rid UNIQUE 가 그 위에 섬). loseNext = 다음 batch 는 들어가고 답만 잃음(queue.ts lostDB 와 같은 장애)
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  // gate = 이 글을 담은 읽기는 waitFor 개가 모일 때까지 기다렸다 같이 풀림(동시 요청이 같은 「열린 카드」를 읽은 뒤 쓰는 경합)
  const st = { loseNext: false, gate: "", waitFor: 0, parked: [] as (() => void)[] };
  const hold = (sql: string) => !st.gate || !sql.includes(st.gate) ? null : new Promise<void>(res => {
    st.parked.push(res); if (st.parked.length >= st.waitFor) { st.gate = ""; st.parked.splice(0).forEach(f => f()); }
  });
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { await hold(sql); const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => /\breturning\b/i.test(sql) ? { success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} } : run1(sql, args),
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => {
      db.exec("BEGIN");
      try {
        const out = ss.map(s => /^\s*select/i.test(s.sql) || /\breturning\b/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args));
        db.exec("COMMIT");
        if (st.loseNext) { st.loseNext = false; throw new Error("D1 응답 잃음(시험)"); }
        return out;
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },
    exec: async (sql: string) => { db.exec(sql); return { count: 1 }; },
  } as unknown as D1Database;
  return { db, D1, st };
}
// DO 이름표 — 같은 이름은 같은 칸(진짜 BoardSnap: rid 표 claim · done · release)
function snapNs() {
  const cells = new Map<string, any>();
  const ctx = () => { const s = new DatabaseSync(":memory:"); return {
    storage: { sql: { exec: (q: string, ...a: unknown[]) => { const p = s.prepare(q); if (/^\s*(select|with)/i.test(q)) { const rows = p.all(...(a as never[])); return { toArray: () => rows, rowsWritten: 0 }; } const r = p.run(...(a as never[])); return { toArray: () => [], rowsWritten: Number(r.changes) }; } } },
    getWebSockets: () => [], setWebSocketAutoResponse() {}, waitUntil() {}, blockConcurrencyWhile: (f: () => unknown) => f(),
  }; };
  // DO 부르기(RPC)는 늘 promise — 동기 메서드도
  const rpc = (o: any) => new Proxy(o, { get: (t, k) => typeof t[k] === "function" ? async (...a: unknown[]) => t[k](...a) : t[k] });
  return { idFromName: (n: string) => n, get: (n: string) => { if (!cells.has(n)) cells.set(n, rpc(new (BoardSnap as any)(ctx(), {}))); return cells.get(n); } };
}
// 엔진 DO(기기마다): 넣은 글만 적음
function engineNs(sent: { id: string; text: string }[]) {
  return { idFromName: (n: string) => n, get: () => ({ deliver: async (id: string, text: string) => { sent.push({ id, text }); return { sent: true }; }, drainCmds: async () => null }) };
}

const MEMBER = "member@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie() {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로 — D1 세션 확인 없이 들어감
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${MEMBER}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${MEMBER}|${exp}|${sig}`)}`;
}
function setup() {
  const { db, D1, st } = d1(), sent: { id: string; text: string }[] = [], T = Date.now();
  db.prepare("INSERT INTO f7_flag(name, on_at) VALUES ('write_queue', ?)").run(T);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("devMember01", MEMBER, "member laptop", "", "h1", T, T, "full", T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, created_at) VALUES (?,?,?,?,?,?,?)").run("ew_main1", MEMBER, "devMember01", "main", "메인 봇", "idle", T);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, created_at) VALUES (?,?,?,?,?,?,?)").run("ew_role1", MEMBER, "devMember01", "role", "일 창", "idle", T);
  db.prepare("INSERT INTO board_card(id, owner, win, question, choices, body, state, at, wid) VALUES (?,?,?,?,?,?,?,?,?)").run("1793300000.000001", MEMBER, "일 창", "어느 쪽?", JSON.stringify(["A", "B"]), "", "open", T, "ew_role1");
  const env = { DB: D1, SNAP: snapNs(), ENGINE: engineNs(sent), BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: "owner@example.test", PUBLIC_URL: "https://example.test" };
  const waits: Promise<unknown>[] = [];
  const post = async (path: string, body: unknown) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method: "POST", headers: { "content-type": "application/json", "x-hb": "1", "sec-fetch-site": "same-origin", cookie: await cookie() }, body: JSON.stringify(body) }), env, { waitUntil: (p: Promise<unknown>) => { waits.push(p.catch(() => {})); }, passThroughOnException() {} });
    await Promise.all(waits.splice(0));   // 뒷일(rid 칸 done · release · 엔진 넣기)까지 끝난 뒤
    return r;
  };
  return { db, st, sent, post, env };
}

test("회원 채팅: D1 에 들어갔는데 답을 잃고 같은 rid 로 다시 보내면 — 글 한 줄 · 메인 봇에 한 번", async () => {
  const { db, st, sent, post } = setup();
  st.loseNext = true;   // 글 줄 + rid batch 는 들어가고 답만 잃음
  const r1 = await post("/api/chat", { text: "안녕 봇", channel: "primary", rid: "rtest-chat-0001" });
  assert.equal(r1.status, 503); assert.equal(r1.headers.get("x-retry-safe"), "1");   // 화면은 「보낼 글」로 쌓았다 같은 rid 로 다시
  const r2 = await post("/api/chat", { text: "안녕 봇", channel: "primary", rid: "rtest-chat-0001" });
  assert.equal(r2.status, 200);
  assert.equal((db.prepare("SELECT count(*) AS n FROM board_log WHERE owner = ? AND text = ?").get(MEMBER, "안녕 봇") as { n: number }).n, 1);
  assert.deepEqual(sent.map(s => s.id), ["ew_main1"], "메인 봇에 한 번 닿아야 함");
});

test("회원 채팅: 다 끝난 쓰기를 같은 rid 로 또 보내도(rid 칸이 답을 잊음) 메인 봇에 두 번 안 감", async () => {
  const { sent, post } = setup();
  assert.equal((await post("/api/chat", { text: "한 번만", channel: "primary", rid: "rtest-chat-0002" })).status, 200);
  // rid 칸(DO)이 「하는 중」을 남긴 채 죽어 2분 뒤 다시 잡힌 것과 같음: 안쪽 길로 바로
  const again = await post("/api/me/chat", { text: "한 번만", rid: "rtest-chat-0002" });
  assert.equal(again.status, 200); assert.equal((await again.json() as { already?: boolean }).already, true);
  assert.equal(sent.length, 1);
});

test("회원 카드 답: D1 에 들어갔는데 답을 잃고 같은 rid 로 다시 보내면 — 그 창에 답이 닿음", async () => {
  const { db, st, sent, post } = setup();
  const n = (db.prepare("SELECT rowid AS n FROM board_card WHERE id = '1793300000.000001'").get() as { n: number }).n;
  st.loseNext = true;
  const r1 = await post("/api/answer", { item: "w" + n, text: "A", rid: "rtest-card-0001" });
  assert.equal(r1.status, 503); assert.equal(r1.headers.get("x-retry-safe"), "1");
  const r2 = await post("/api/answer", { item: "w" + n, text: "A", rid: "rtest-card-0001" });
  assert.equal(r2.status, 200);
  assert.equal((db.prepare("SELECT state FROM board_card WHERE id = '1793300000.000001'").get() as { state: string }).state, "answered");
  assert.deepEqual(sent.map(s => s.id), ["ew_role1"], "카드를 낸 창에 답이 한 번 닿아야 함");
});

test("회원 카드 답: 다 끝난 답을 같은 rid 로 또 보내도 그 창에 두 번 안 감", async () => {
  const { db, sent, post } = setup();
  const n = (db.prepare("SELECT rowid AS n FROM board_card WHERE id = '1793300000.000001'").get() as { n: number }).n;
  assert.equal((await post("/api/answer", { item: "w" + n, text: "B", rid: "rtest-card-0002" })).status, 200);
  const again = await post("/api/me/cards/1793300000.000001/answer", { choice: "B", free: true, rid: "rtest-card-0002" });
  assert.equal(again.status, 200); assert.equal((await again.json() as { already?: boolean }).already, true);
  assert.equal(sent.length, 1); assert.match(sent[0].text, /: B\. Continue/);
});

test("회원 카드 스레드: 답한 뒤 다른 글은 스레드 답(창에 「replied in the thread」 한 줄 · 스레드에 남음), 같은 답을 다시 보내면 됨(200) · 창에 두 번 안 감", async () => {
  const { db, sent, post } = setup();
  const th = { channel: "primary", thread: "1793300000.000001" };
  assert.equal((await post("/api/chat", { ...th, text: "첫 답", rid: "rtest-card-0101" })).status, 200);
  assert.equal(sent.length, 1);
  assert.equal((await post("/api/chat", { ...th, text: "뒤따른 글", rid: "rtest-card-0102" })).status, 200);
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /replied in the thread of your card 1793300000\.000001 .*: 뒤따른 글$/);
  assert.deepEqual(db.prepare("SELECT kind, text FROM board_log WHERE thread = '1793300000.000001'").all().map(r => ({ ...r })), [{ kind: "me", text: "뒤따른 글" }]);
  assert.equal((await post("/api/chat", { ...th, text: "첫 답", rid: "rtest-card-0103" })).status, 200);
  assert.equal(sent.length, 2, "같은 답은 창에 두 번 안 감");
  assert.equal((await post("/api/chat", { ...th, label: "B", rid: "rtest-card-0104" })).status, 400, "다른 단추는 확정 실패");
});

test("회원 카드 답: 두 기기가 같은 열린 카드에 동시에 다른 답 — 하나만 됨, 다른 쪽은 확정 실패, 창에는 한 번", async () => {
  const { db, st, sent, post } = setup();
  const n = (db.prepare("SELECT rowid AS n FROM board_card WHERE id = '1793300000.000001'").get() as { n: number }).n;
  Object.assign(st, { gate: "SELECT choices FROM board_card", waitFor: 2 });   // 둘 다 「열림」을 읽은 뒤에 씀
  const [ra, rb] = await Promise.all([
    post("/api/answer", { item: "w" + n, text: "A", rid: "rtest-race-000a" }),
    post("/api/answer", { item: "w" + n, text: "B", rid: "rtest-race-000b" }),
  ]);
  const won = (db.prepare("SELECT answer FROM board_card WHERE id = '1793300000.000001'").get() as { answer: string }).answer;
  const [win, lose] = won === "A" ? [ra, rb] : [rb, ra];
  assert.equal(win.status, 200);
  assert.ok(lose.status >= 400 && lose.status < 500, `진 답은 확정 실패여야 함(받음 ${lose.status}) — 200 이면 화면은 그 답이 들어간 줄 앎`);
  assert.equal(sent.length, 1, "창에는 이긴 답 한 번만");
  assert.match(sent[0].text, new RegExp(`: ${won}\\. Continue`));
});

test("회원 노드 채팅: 다 끝난 글을 같은 rid 로 또 보내도(rid 칸이 답을 잊음) 그 창에 두 번 안 들어가고 내 글도 한 줄", async () => {
  const { db, post, env } = setup(), T = Date.now();
  db.prepare("INSERT INTO mnode(owner, id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(MEMBER, "n_test01", "일 노드", "working", T, T);
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, state, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run(MEMBER, "window:w1", "devMember01", "window", "tmux", "일 창", "idle", "w1", T);
  db.prepare("INSERT INTO mnode_item(owner, item, node) VALUES (?,?,?)").run(MEMBER, "window:w1", "n_test01");
  const { paneOfId } = await import("./member-board.ts");
  const body = { channel: "primary", pane: paneOfId("n_test01"), text: "노드에 한 번만", rid: "rtest-node-0001" };
  assert.equal((await post("/api/chat", body)).status, 200);
  // rid 칸(DO)이 「하는 중」을 남긴 채 죽어 2분 뒤 다시 잡힌 것과 같음(답을 잃은 화면이 같은 rid 로 다시 보냄)
  (env as { SNAP: unknown }).SNAP = snapNs();
  const again = await post("/api/chat", body);
  assert.equal(again.status, 200);
  const sends = (db.prepare("SELECT count(*) AS n FROM engine_cmd WHERE owner = ? AND verb = 'send'").get(MEMBER) as { n: number }).n;
  const mine = (db.prepare("SELECT count(*) AS n FROM board_log WHERE owner = ? AND kind = 'me' AND text = ?").get(MEMBER, "노드에 한 번만") as { n: number }).n;
  assert.equal(sends, 1, "창에 넣는 줄은 한 번");
  assert.equal(mine, 1, "노드 채팅 내 글은 한 줄");
});

test("회원 엔진 창 채팅: 다 끝난 글을 같은 rid 로 또 보내도 그 창에 두 번 안 감", async () => {
  const { db, sent, post, env } = setup();
  const { paneOfId } = await import("./member-board.ts");
  const body = { channel: "primary", pane: paneOfId("ew_role1"), text: "역할 창에 한 번만", rid: "rtest-node-0002" };
  assert.equal((await post("/api/chat", body)).status, 200);
  (env as { SNAP: unknown }).SNAP = snapNs();
  assert.equal((await post("/api/chat", body)).status, 200);
  assert.deepEqual(sent.map(s => s.id), ["ew_role1"], "역할 창에 한 번");
  assert.equal((db.prepare("SELECT count(*) AS n FROM board_log WHERE owner = ? AND kind = 'me'").get(MEMBER) as { n: number }).n, 1);
});

function importedCard(engine: string) {
  const s = setup(), T = Date.now();
  s.db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, state, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run(MEMBER, "window:imp1", "devMember01", "window", engine, "들여온 창", "idle", "host:ew_imp001", T);
  s.db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, state, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run("other@example.test", "window:imp1", "devOther01", "window", engine, "남의 창", "idle", "host:ew_imp001", T);
  s.db.prepare("INSERT INTO board_card(id, owner, win, question, choices, body, state, at, wid) VALUES (?,?,?,?,?,?,?,?,?)").run("1793300000.000009", MEMBER, "host:ew_imp001", "들여온 창 질문?", JSON.stringify(["받음", "보류"]), "", "open", T, "ew_imp001");
  const cmds = () => s.db.prepare("SELECT owner, device_id, verb, args FROM engine_cmd ORDER BY at").all().map(r => ({ ...(r as Record<string, unknown>), args: JSON.parse(String((r as { args: string }).args)) }));
  return { ...s, cmds };
}

test("들여온 tmux 창의 카드: 선택 답 · 스레드 답이 내 기기 명령 줄(send)로 — 남의 기기엔 안 감", async () => {
  const { post, cmds, sent } = importedCard("tmux");
  const th = { channel: "primary", thread: "1793300000.000009" };
  assert.equal((await post("/api/chat", { ...th, label: "받음", rid: "rtest-imp-0001" })).status, 200);
  assert.equal((await post("/api/chat", { ...th, text: "하나 더 볼게요", rid: "rtest-imp-0002" })).status, 200);
  const c = cmds();
  assert.equal(c.length, 2);
  assert.ok(c.every(x => x.owner === MEMBER && x.device_id === "devMember01" && x.verb === "send" && x.args.item === "window:imp1"));
  assert.match(c[0].args.text, /answered your card 1793300000\.000009 .*: 받음\. Continue/);
  assert.match(c[1].args.text, /replied in the thread of your card 1793300000\.000009 .*: 하나 더 볼게요$/);
  assert.equal(sent.length, 0, "엔진 창으로는 안 감");
});

test("들여온 tmux 아닌 창의 카드 선택 답: onCardAnswered 가 넣은 한 번뿐(두 번 안 넣음)", async () => {
  const { post, cmds } = importedCard("herdr");
  assert.equal((await post("/api/chat", { channel: "primary", thread: "1793300000.000009", label: "받음", rid: "rtest-imp-0003" })).status, 200);
  assert.equal(cmds().length, 1);
});

// 기본 창(/api/me/primary-window): 일반 채널(Primary) 글을 메인 봇 대신 정한 창으로. 내 살아 있는 창만 정할 수 있음
const getJ = async (env: unknown, path: string) => (await app.fetch(new Request("https://example.test" + path, { headers: { cookie: await cookie() } }), env as never, { waitUntil() {}, passThroughOnException() {} } as never)).json() as Promise<any>;
test("기본 창: 정하면 일반 채널 글이 그 창으로(들여온 창 = 기기 명령 줄, 엔진 창 = 엔진), 비우면 메인 봇, 남의 · 없는 창은 404", async () => {
  const { db, post, sent, env } = setup(), T = Date.now();
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, state, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run(MEMBER, "window:lead", "devMember01", "window", "tmux", "팀장", "idle", "host:lead", T);
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, state, win, seen_at) VALUES (?,?,?,?,?,?,?,?,?)").run("other@example.test", "window:theirs", "devOther01", "window", "tmux", "남의 창", "idle", "host:x", T);
  assert.equal((await post("/api/me/primary-window", { target: "window:theirs" })).status, 404);
  assert.equal((await post("/api/me/primary-window", { target: "window:nope" })).status, 404);
  assert.equal((await post("/api/me/primary-window", { target: "window:lead" })).status, 200);
  assert.deepEqual(await getJ(env, "/api/me/primary-window"), { target: "window:lead" });
  assert.equal((await post("/api/chat", { channel: "primary", text: "오늘 할 일 정리해 줘", rid: "rtest-pw-0001" })).status, 200);
  const cmd = db.prepare("SELECT device_id, verb, args FROM engine_cmd").all() as { device_id: string; verb: string; args: string }[];
  assert.equal(cmd.length, 1);
  assert.equal(JSON.parse(cmd[0].args).item, "window:lead");
  assert.match(JSON.parse(cmd[0].args).text, /오늘 할 일 정리해 줘/);
  assert.equal(sent.length, 0, "메인 봇엔 안 감");
  assert.equal((await post("/api/me/primary-window", { target: "ew_role1" })).status, 200);   // 엔진 창도 됨
  assert.equal((await post("/api/chat", { channel: "primary", text: "둘째 글", rid: "rtest-pw-0002" })).status, 200);
  assert.deepEqual(sent.map(x => x.id), ["ew_role1"]);
  assert.equal((await post("/api/me/primary-window", { target: null })).status, 200);
  assert.equal((await post("/api/chat", { channel: "primary", text: "셋째 글", rid: "rtest-pw-0003" })).status, 200);
  assert.deepEqual(sent.map(x => x.id), ["ew_role1", "ew_main1"], "비우면 메인 봇");
});
