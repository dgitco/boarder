import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
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
const OWNER = "owner@example.test", MEMBER = "member@example.test", OTHER = "other@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up";
const DEV1 = "bxd_made-up-device-one-0123456789abcdef", DEVO = "bxd_made-up-other-member-0123456789abcd", DEVMW = "bxd_made-up-member-watch-0123456789abcd", DEVW = "bxd_made-up-owner-watch-0123456789abcde";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}

async function setup() {
  const { db, D1 } = d1(), T = Date.now();
  for (const m of [MEMBER, OTHER]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)");
  dev.run("dev1", MEMBER, "laptop", "", await sha(DEV1), T, T, "full");
  dev.run("devO", OTHER, "other laptop", "", await sha(DEVO), T, T, "full");
  dev.run("devMW", MEMBER, "member watch", "", await sha(DEVMW), T, T, "watch");
  dev.run("devW", OWNER, "owner mac", "", await sha(DEVW), T, T, "watch");
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const pend: Promise<unknown>[] = [];   // 카드 세우기는 답 뒤(waitUntil) — 시험은 다음 걸음 전에 기다림
  const ctx = { waitUntil: (p: Promise<unknown>) => { pend.push(p.catch(() => {})); }, passThroughOnException() {} };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    while (pend.length) await Promise.all(pend.splice(0));
    return { status: r.status, j, text };
  };
  const human = async (email = MEMBER) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  const code = (b: Record<string, unknown>) => call("POST", "/api/device/code", { name: "new-mac (darwin)", tools: ["claude"], ...b });
  const token = (dc: string) => call("POST", "/api/device/token", { device_code: dc });
  const cardOf = (uc: string) => db.prepare("SELECT c.id, c.owner, c.question, c.choices, c.state, c.done FROM board_card c JOIN device_code d ON d.card_id = c.id WHERE d.user_code = ?").get(uc) as any;
  const cards = () => (db.prepare("SELECT count(*) AS n FROM board_card").get() as any).n as number;
  return { db, call, human, code, token, cardOf, cards };
}
const dev = (t: string) => ({ authorization: `Bearer ${t}` });

test("카드: 회원 메일이면 그 회원 보드에 허용 카드(코드는 안 보임 · 거절만) — 새 기기 화면의 코드를 쳐 넣으면 그 회원 기기로 토큰", async () => {
  const s = await setup();
  const c = await s.code({ email: "Member@Example.test" });
  assert.equal(c.status, 200); assert.equal(c.j.mode, "code"); assert.equal(c.j.board, "asked");
  const k = s.cardOf(c.j.user_code);
  assert.equal(k.owner, MEMBER); assert.match(k.question, /새 기기 「new-mac \(darwin\)」/);
  assert.deepEqual(JSON.parse(k.choices), ["거절"], "코드를 고르는 선택지가 없음");
  const all = JSON.stringify(s.db.prepare("SELECT question, choices, body FROM board_card WHERE id = ?").get(k.id));
  assert.ok(!all.includes(c.j.user_code) && !all.includes(c.j.user_code.replace("-", "")), "카드 어디에도 진짜 코드가 없음");
  assert.equal((await s.token(c.j.device_code)).j.state, "pending");
  const a = await s.call("POST", `/api/me/cards/${k.id}/answer`, { choice: ` ${c.j.user_code.toLowerCase().replace("-", "")} `, free: true }, await s.human());
  assert.equal(a.status, 200, a.text);
  const t = await s.token(c.j.device_code);
  assert.equal(t.j.state, "approved"); assert.equal(t.j.email, MEMBER); assert.equal(t.j.scope, "full"); assert.match(t.j.token, /^bxd_/);
  assert.equal(s.cardOf(c.j.user_code).done, "허용함");
  assert.equal((s.db.prepare("SELECT approved_by FROM device_code WHERE user_code = ?").get(c.j.user_code) as any).approved_by, "card");
});

test("카드: 틀린 코드 · 거절이면 거절(토큰 없음) + 그 메일의 카드 길 24시간 꺼짐 · 열려 있던 다른 허용 요청도 거절", async () => {
  for (const wrong of [true, false]) {
    const s = await setup();
    const c = await s.code({ email: MEMBER }), c2 = await s.code({ email: MEMBER }), k = s.cardOf(c.j.user_code);
    const body = wrong ? { choice: "ZZZZ-ZZZZ", free: true } : { choice: "거절" };
    assert.equal((await s.call("POST", `/api/me/cards/${k.id}/answer`, body, await s.human())).status, 200);
    assert.equal((await s.token(c.j.device_code)).status, 403);
    assert.equal(s.cardOf(c.j.user_code).done, wrong ? "코드가 달라 거절함" : "거절함");
    assert.equal(s.cardOf(c2.j.user_code).state, "closed", "다른 열린 카드도 닫힘");
    assert.equal((await s.token(c2.j.device_code)).status, 403, "다른 기다리는 요청도 거절");
    const n = s.cards(), c3 = await s.code({ email: MEMBER });
    assert.equal(c3.j.board, "asked", "답 꼴은 같음"); assert.equal(s.cards(), n, "잠긴 동안 카드 없음");
    s.db.prepare("UPDATE device_card_event SET at = at - ? WHERE kind = 'locked'").run(24 * 3600_000 + 1000);
    s.db.prepare("UPDATE device_code SET created_at = created_at - ?").run(11 * 60_000);
    await s.code({ email: MEMBER });
    assert.equal(s.cards(), n + 1, "24시간 뒤 다시 카드");
  }
});

test("카드 경계: 다른 회원은 못 답함 · 토큰 머리가 붙은 요청은 사람 아님 · 만료 뒤 답은 허용 안 됨", async () => {
  const s = await setup();
  const c = await s.code({ email: MEMBER }), k = s.cardOf(c.j.user_code);
  assert.equal((await s.call("POST", `/api/me/cards/${k.id}/answer`, { choice: c.j.user_code, free: true }, await s.human(OTHER))).status, 404, "남의 카드");
  for (const h of [dev(DEV1), { "x-boarder-device": DEV1 }]) assert.equal((await s.call("POST", `/api/me/cards/${k.id}/answer`, { choice: c.j.user_code, free: true }, { ...(await s.human()), ...h })).status, 401);
  assert.equal((await s.token(c.j.device_code)).j.state, "pending");
  s.db.prepare("UPDATE device_code SET expires_at = ? WHERE user_code = ?").run(Date.now() - 1, c.j.user_code);
  assert.equal((await s.call("POST", `/api/me/cards/${k.id}/answer`, { choice: c.j.user_code, free: true }, await s.human())).status, 200);
  assert.equal(s.cardOf(c.j.user_code).done, "만료");
  assert.notEqual((await s.token(c.j.device_code)).j.state, "approved");
});

test("카드 없음: 회원이 아닌 메일 · 주인 메일 · 브라우저 콜백 길 — 답 꼴은 회원과 같음(누가 회원인지 안 샘)", async () => {
  const s = await setup();
  const n = await s.code({ email: "stranger@example.test" });
  assert.equal(n.status, 200); assert.equal(n.j.board, "asked"); assert.equal(s.cards(), 0);
  const o = await s.code({ email: OWNER });
  assert.equal(o.j.board, "asked"); assert.equal(s.cards(), 0, "주인 기기는 감시 전용 — 이 길 아님");
  const l = await s.code({ email: MEMBER, callback: "http://127.0.0.1:5555/callback", state: "s".repeat(24), code_challenge: "c".repeat(43) });
  assert.equal(l.j.mode, "local"); assert.equal(l.j.board, undefined); assert.equal(s.cards(), 0);
});

test("메일 하나에 10분 안 카드 셋까지 — 넷째부터는 카드 없이 코드만", async () => {
  const s = await setup();
  for (let i = 0; i < 4; i++) await s.code({ email: MEMBER });
  assert.equal(s.cards(), 3);
});

test("메일 하나에 하루 카드 다섯까지 — 10분이 지나도 여섯째부터는 카드 없음", async () => {
  const s = await setup();
  for (let i = 0; i < 6; i++) { await s.code({ email: MEMBER }); s.db.prepare("UPDATE device_code SET created_at = created_at - ?").run(11 * 60_000); }
  assert.equal(s.cards(), 5);
  s.db.prepare("UPDATE device_card_event SET at = at - ?").run(24 * 3600_000 + 1000);
  await s.code({ email: MEMBER });
  assert.equal(s.cards(), 6, "하루 뒤 다시");
});

test("승인된 기기(기기 토큰)는 허용 못 함 — 403 + 사람 길(브라우저 허용 화면) 주소, 요청은 그대로 기다림 · 거절은 됨", async () => {
  const s = await setup();
  const c = await s.code({ email: MEMBER });
  const look = await s.call("GET", `/api/device/lookup-by-device?code=${c.j.user_code}`, undefined, dev(DEV1));
  assert.equal(look.status, 200); assert.equal(look.j.name, "new-mac (darwin)"); assert.equal(look.j.mode, "code");
  for (const body of [{ user_code: c.j.user_code.toLowerCase() }, { user_code: c.j.user_code, allow: true }]) {
    const a = await s.call("POST", "/api/device/approve-by-device", body, dev(DEV1));
    assert.equal(a.status, 403, a.text); assert.equal(a.j.error, "person"); assert.equal(a.j.verify_url, `https://example.test/device?code=${c.j.user_code}`);
  }
  assert.equal((await s.token(c.j.device_code)).j.state, "pending", "기기 토큰만으로는 새 기기 토큰이 안 나옴");
  assert.equal(s.cardOf(c.j.user_code).state, "open");
  const d = await s.call("POST", "/api/device/approve-by-device", { user_code: c.j.user_code, allow: false }, dev(DEV1));
  assert.equal(d.status, 200, d.text);
  assert.equal((await s.token(c.j.device_code)).status, 403);
  assert.equal(s.cardOf(c.j.user_code).state, "closed", "열린 카드는 닫힘");
  assert.match((s.db.prepare("SELECT text FROM board_log WHERE owner = ?").get(MEMBER) as any).text, /laptop.*new-mac.*거절/);
  assert.equal((await s.call("POST", "/api/device/approve-by-device", { user_code: c.j.user_code, allow: false }, dev(DEV1))).status, 409, "두 번은 안 됨");
});

test("승인된 기기 경계: 감시 기기 · 주인 기기 · 토큰 없음은 401, 다른 회원 메일로 낸 요청 · 브라우저 콜백 길 코드는 못 건드림", async () => {
  const s = await setup();
  const c = await s.code({ email: MEMBER });
  for (const h of [dev(DEVMW), dev(DEVW), {}]) {
    assert.equal((await s.call("POST", "/api/device/approve-by-device", { user_code: c.j.user_code }, h)).status, 401);
    assert.equal((await s.call("GET", `/api/device/lookup-by-device?code=${c.j.user_code}`, undefined, h)).status, 401);
  }
  assert.equal((await s.call("POST", "/api/device/approve-by-device", { user_code: c.j.user_code, allow: false }, dev(DEVO))).status, 404, "다른 회원 메일로 낸 요청");
  const l = await s.code({ callback: "http://127.0.0.1:5555/callback", state: "s".repeat(24), code_challenge: "c".repeat(43) });
  assert.equal((await s.call("POST", "/api/device/approve-by-device", { user_code: l.j.user_code, allow: false }, dev(DEV1))).status, 409);
  assert.equal((s.db.prepare("SELECT state FROM device_code WHERE user_code = ?").get(l.j.user_code) as any).state, "pending");
  assert.equal((await s.token(c.j.device_code)).j.state, "pending");
});

test("만료 한 시간 뒤 코드 줄을 지울 때 그 요청의 열린 카드도 닫음", async () => {
  const s = await setup();
  const c = await s.code({ email: MEMBER }), id = s.cardOf(c.j.user_code).id;
  s.db.prepare("UPDATE device_code SET expires_at = ? WHERE user_code = ?").run(Date.now() - 2 * 3600_000, c.j.user_code);
  await s.code({});   // 다음 코드 요청이 낡은 줄을 치움
  assert.equal((s.db.prepare("SELECT state, done FROM board_card WHERE id = ?").get(id) as any).done, "만료");
});

test("기기 이름에 그 메일의 기다리는 요청 코드(반쪽 · 띄어 쓴 것 · 소문자도)를 적으면 카드 없음 — 숨긴 코드를 다른 카드 이름으로 다시 보이지 못하게", async () => {
  const s = await setup();
  const a = await s.code({ email: MEMBER }), uc = a.j.user_code as string;
  assert.equal(s.cards(), 1);
  for (const name of [`확인코드 ${uc} 를 새 기기 카드에`, uc.toLowerCase().split("").join(" "), `my ${uc.slice(5)} mac`]) {
    const b = await s.code({ email: MEMBER, name });
    assert.equal(b.j.board, "asked", "답 꼴은 같음");
    s.db.prepare("UPDATE device_code SET created_at = created_at - ? WHERE user_code = ?").run(11 * 60_000, b.j.user_code);   // 10분 셋 상한과 섞이지 않게
  }
  assert.equal(s.cards(), 1, "코드가 든 이름의 카드는 안 섬");
  const ok = await s.code({ email: MEMBER, name: "<b>work</b> mac" });
  assert.equal(s.cardOf(ok.j.user_code).question, "새 기기 「bworkb mac」 을 허용할까요?", "이름은 영숫자 · 공백 · ._()- 만");
  const { cardName } = await import("./device-card.ts");
  assert.equal(cardName("", ["ABCD-EFGH"]), "이름 없는 기기");
  assert.equal(cardName("new-mac (darwin)", ["ABCD-EFGH"]), "new-mac (darwin)");
});
