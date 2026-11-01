import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", e); return new Response("{}", { status: 500 }); });   // 500 은 까닭을 보이게

const MIG = new URL("../migrations/", import.meta.url);
// 가짜 D1 — batch 는 진짜 트랜잭션. failOnce = 그 글로 시작하는 쓰기 하나를 한 번 실패시킴(D1 일시 오류)
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const st = { failOnce: "" };
  const trip = (sql: string) => { if (st.failOnce && sql.trimStart().startsWith(st.failOnce)) { st.failOnce = ""; throw new Error("D1 일시 오류(시험)"); } };
  const run1 = (sql: string, args: unknown[]) => { trip(sql); const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
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
    batch: async (ss: any[]) => {
      db.exec("BEGIN");
      try {
        const out = ss.map(s => /^\s*select/i.test(s.sql) ? { success: true, results: db.prepare(s.sql).all(...(s.args as never[])), meta: {} } : run1(s.sql, s.args));
        db.exec("COMMIT"); return out;
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },
  } as unknown as D1Database;
  return { db, D1, st };
}

const MEMBER = "member@example.test", SECRET = "test-secret-not-real", TOKEN = "sess-token-made-up";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function cookie() {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴 그대로
  const th = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${MEMBER}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${TOKEN}; bx_s=${encodeURIComponent(`${MEMBER}|${exp}|${sig}`)}`;
}
function setup() {
  const { db, D1, st } = d1();
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, "owner@example.test", Date.now());
  const SNAP = { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) };   // 화면 알리기(live.ts)는 삼킴
  const env = { DB: D1, SNAP, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: "owner@example.test", PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (path: string, body: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }), env, ctx);
    let j: any = {}; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
  const approve = async (user_code: string) => call("/api/device/approve", { user_code, allow: true }, { "x-hb": "1", "sec-fetch-site": "same-origin", cookie: await cookie() });
  // boarder setup 의 코드 입력 길(SSH): 코드 → 사람이 허용
  const approved = async (name = "member laptop") => {
    const c = await call("/api/device/code", { name, tools: ["claude"] });
    assert.equal(c.status, 200, JSON.stringify(c.j));
    assert.equal((await approve(c.j.user_code)).status, 200);
    return c.j.device_code as string;
  };
  return { db, st, call, approved };
}

test("기기 승인: 토큰 받기 쓰기가 반쯤 실패해도 다음 폴링이 토큰을 받음(「used」로 승인을 잃지 않음)", async () => {
  const { db, st, call, approved } = setup();
  const dc = await approved();
  st.failOnce = "INSERT INTO device(";   // 코드 → issued 는 들어가고 기기 줄 넣기만 실패
  const r1 = await call("/api/device/token", { device_code: dc });
  assert.notEqual(r1.j.state, "approved");
  const r2 = await call("/api/device/token", { device_code: dc });   // CLI 는 3초 뒤 다시 폴링
  assert.equal(r2.j.state, "approved", `다시 폴링하면 토큰을 받아야 함 — 받은 답 ${r2.status} ${JSON.stringify(r2.j)}`);
  const row = db.prepare("SELECT d.id FROM device d JOIN device_code c ON c.device_id = d.id WHERE d.owner = ?").get(MEMBER) as { id: string } | undefined;
  assert.equal(row?.id, r2.j.device_id, "코드가 가리키는 기기 줄이 있어야 함");
  // 받은 토큰이 실제로 됨
  assert.equal((await call("/api/device/window", { key: "laptop:1", name: "창 1" }, { authorization: `Bearer ${r2.j.token}` })).status, 200);
});

test("기기 승인: 두 폴링이 겹쳐도 토큰 하나 · 기기 줄 하나", async () => {
  const { db, call, approved } = setup();
  const dc = await approved();
  const rs = await Promise.all([call("/api/device/token", { device_code: dc }), call("/api/device/token", { device_code: dc })]);
  assert.equal(rs.filter(r => r.j.state === "approved").length, 1);
  assert.equal((db.prepare("SELECT count(*) AS n FROM device WHERE owner = ?").get(MEMBER) as { n: number }).n, 1);
});

test("두 기기 같은 창 키: 서로 끊지 않음 · 같은 기기가 다시 받으면 옛 토큰만 죽음", async () => {
  const { call, approved } = setup();
  const tokA = (await call("/api/device/token", { device_code: await approved("A") })).j.token;
  const tokB = (await call("/api/device/token", { device_code: await approved("B") })).j.token;
  const win = (t: string) => call("/api/device/window", { key: "main:0", name: "main" }, { authorization: `Bearer ${t}` });
  const a1 = (await win(tokA)).j.token, b1 = (await win(tokB)).j.token;
  const a2 = (await win(tokA)).j.token;   // A 가 다시 붙음(재연결)
  const alive = async (t: string) => { const s = (await call("/api/agent/__none__", {}, { authorization: `Bearer ${t}` })).status; assert.ok(s === 401 || s === 404, `401(죽음) 아니면 404(없는 도구 — 토큰은 통과) — 받은 ${s}`); return s === 404; };
  assert.equal(await alive(a1), false, "A 의 옛 창 토큰은 죽음");
  assert.equal(await alive(a2), true, "A 의 새 창 토큰은 삶");
  assert.equal(await alive(b1), true, "B 의 같은 키 창 토큰은 그대로");
});

// ── 다리(bridge.ts): 끊긴 뒤 명령 — 진짜 Bridge 클래스, 가짜 ctx · 소켓(fetch 의 101 응답은 Node 에서 못 만들어 소켓을 바로 넣음)
const { Bridge } = await import("./bridge.ts");
function bridgeRig() {
  const socks: any[] = [];
  const ctx = { getWebSockets: () => socks.filter(s => !s.gone), setWebSocketAutoResponse() {}, getWebSocketAutoResponseTimestamp: (w: any) => w.pingAt ? new Date(w.pingAt) : null };
  const br = new (Bridge as any)(ctx, {});
  const connect = (keep: boolean) => {
    const s: any = { readyState: 1, sent: [] as any[], att: { at: Date.now() + socks.length, keep },
      send(m: string) { if (s.readyState !== 1) throw new Error("send() after close()"); s.sent.push(JSON.parse(m)); },
      close() { s.readyState = 3; }, serializeAttachment(a: unknown) { s.att = a; }, deserializeAttachment: () => s.att };
    socks.push(s); return s;
  };
  const lose = async (s: any) => { s.readyState = 3; s.gone = true; await br.webSocketClose(s); };
  return { br, connect, lose };
}
const answer = (id: string) => JSON.stringify({ id, status: 200, headers: {}, data: btoa("ok"), last: true });

test("다리: 그냥 연결이 끊기면 그 연결로 보낸 요청은 바로 실패(25초 기다리지 않음 — 부른 쪽이 다시 보냄)", async () => {
  const { br, connect, lose } = bridgeRig();
  const a = connect(false);
  const p = br.call({ method: "GET", path: "/api/x", headers: {} });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(a.sent.length, 1);
  await lose(a);
  await assert.rejects(p, /끊김/);
  assert.equal(br.wait.size, 0);
});

test("다리: keep 연결은 끊겨도 요청을 들고 있다가 다시 붙은 연결의 같은 id 답으로 끝남", async () => {
  const { br, connect, lose } = bridgeRig();
  const a = connect(true);
  const p = br.call({ method: "POST", path: "/api/y", headers: {} });
  await new Promise(r => setTimeout(r, 0));
  const id = a.sent[0].id;
  await lose(a);
  const b = connect(true);
  assert.equal(br.sock(), b);
  await br.webSocketMessage(b, answer(id));
  const out = await p;
  assert.equal(out.status, 200); assert.equal(new TextDecoder().decode(out.body), "ok");
});

test("다리: 새 연결이 붙은 뒤 옛 연결이 끊겨도 새 연결로 보낸 요청은 살아 있음", async () => {
  const { br, connect, lose } = bridgeRig();
  const a = connect(false), b = connect(false);
  const p = br.call({ method: "GET", path: "/api/z", headers: {} });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(b.sent.length, 1, "가장 최근 연결로 보냄"); assert.equal(a.sent.length, 0);
  await lose(a);
  assert.equal(br.wait.size, 1);
  await br.webSocketMessage(b, answer(b.sent[0].id));
  assert.equal((await p).status, 200);
});
