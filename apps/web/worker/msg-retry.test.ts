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
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    raw: async () => db.prepare(sql).all(...(args as never[])).map(r => Object.values(r as object)),
    run: async () => /\breturning\b/i.test(sql) ? { success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} } : run1(sql, args),
  });
  const st = { loseNext: false };
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
  return { idFromName: (n: string) => n, get: () => ({ deliver: async (id: string, text: string) => { sent.push({ id, text }); return { sent: true }; } }) };
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
  return { db, st, sent, post };
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
