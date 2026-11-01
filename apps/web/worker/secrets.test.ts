import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
const V = await import("./vault/index.ts");
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

const OWNER = "owner@example.test", MEMBER = "member@example.test", SECRET = "test-secret-not-real", SESS = "sess-token-made-up";
const VALUE = "4111-1111-1111-1111", FORMS = [VALUE, VALUE.replace(/\D/g, ""), "4111 1111 1111 1111", "41111111"];
const WIN = "bxa_made-up-window-token-0123456789abcdef", WIN_NODEV = "bxa_made-up-window-nodevice-0123456789ab", WIN_OWNER = "bxa_made-up-owner-pane-token-0123456789a";
const DEV1 = "bxd_made-up-device-one-0123456789abcdef", DEV2 = "bxd_made-up-device-two-0123456789abcdef";
const DEVH = "bxd_made-up-owner-harness-0123456789abc", DEVW = "bxd_made-up-owner-watch-0123456789abcde", DEVMW = "bxd_made-up-member-watch-0123456789abcd", ADMIN = "admin-token-made-up-0123456789";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {   // index.ts signedIn 의 서명 쿠키(bx_s) 꼴
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
const KEK = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

async function setup(o: { kek?: boolean } = {}) {
  V._resetVaultCache();
  const { db, D1 } = d1(), T = Date.now();
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)");
  dev.run("dev1", MEMBER, "laptop", "", await sha(DEV1), T, T, "full", T);
  dev.run("dev2", MEMBER, "desktop", "", await sha(DEV2), T, T, "full", T);
  dev.run("devH", OWNER, "owner-host harness", "", await sha(DEVH), T, T, "harness", T);
  dev.run("devW", OWNER, "owner mac", "", await sha(DEVW), T, T, "watch", T);
  dev.run("devMW", MEMBER, "member watch", "", await sha(DEVMW), T, T, "watch", T);
  const tok = db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, owner, tools, device_id) VALUES (?,?,?,?,?,?, '*', ?)");
  tok.run(await sha(WIN), "laptop:claude:1", "claude · shop", "device:dev1", T, MEMBER, "dev1");
  tok.run(await sha(WIN_NODEV), "laptop:claude:2", "no device", "h", T, MEMBER, null);
  tok.run(await sha(WIN_OWNER), "%12", "owner pane", "owner-host", T, "", null);
  // 봉투 스위치(envelope)는 꺼진 채 — 비밀은 그래도 봉해야 함
  const env: any = { DB: D1, SNAP: { idFromName: (n: string) => n, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test", ADMIN_TOKEN: ADMIN,
    ...(o.kek === false ? {} : { DATA_KEK_CUR: "1", DATA_KEK_1: KEK }) };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const seen: string[] = [];
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    if (/^Bearer bxa_/.test(h.authorization || "")) seen.push(`${method} ${path} ${r.status} ${text}`);
    return { status: r.status, j, text };
  };
  const human = async (email = MEMBER) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  const agent = (t = WIN) => ({ authorization: `Bearer ${t}` });
  const device = (t = DEV1) => ({ authorization: `Bearer ${t}` });
  const add = async (b: Record<string, unknown>, who = MEMBER) => call("POST", "/api/secrets", { name: "card", kind: "card", value: VALUE, ...b }, await human(who));
  return { db, env, call, human, agent, device, add, seen };
}
const noValue = (s: string, where: string) => { for (const f of FORMS) assert.ok(!s.includes(f), `${where} 에 값(${f})`); };
const dump = (db: DatabaseSync) => JSON.stringify(["secret", "secret_request", "board_card", "board_log"].map(t => db.prepare(`SELECT * FROM ${t}`).all()));

test("사람 길: 넣기 · 목록 · 바꾸기 · 지우기 — D1 에 평문 없음(봉투 스위치 꺼짐에도) · 목록에 값 없음 · 토큰 거절 · 주인 칸은 따로", async () => {
  const s = await setup();
  assert.equal((await s.add({})).status, 200);
  const row = s.db.prepare("SELECT value FROM secret WHERE name = 'card'").get() as any;
  assert.match(row.value, /^v2\.\d+\./, "봉함"); noValue(dump(s.db), "D1");
  assert.equal(await V.envelopeOn(s.env, MEMBER), false, "스위치는 꺼진 채");
  const l = await s.call("GET", "/api/secrets", undefined, await s.human());
  assert.equal(l.status, 200); noValue(l.text, "목록");
  assert.deepEqual(l.j.secrets.map((x: any) => [x.name, x.kind, x.mode, x.policy]), [["card", "card", "saved", "ask"]]);
  assert.equal((await s.add({})).status, 409, "같은 이름");
  assert.equal((await s.add({ name: "requests" })).status, 400, "예약 이름");
  const humanHeaders = await s.human();
  for (const h of [s.agent(), s.device(), { ...humanHeaders, ...s.agent() }, ...[DEV1, "invalid", ""].map(t => ({ ...humanHeaders, "x-boarder-device": t }))]) {
    assert.equal((await s.call("GET", "/api/secrets", undefined, h)).status, 401);
    assert.equal((await s.call("POST", "/api/secrets", { name: "x2", value: "1" }, { ...h, "x-hb": "1" })).status, 401);
    assert.equal((await s.call("PATCH", "/api/secrets/card", { policy: "auto" }, { ...h, "x-hb": "1" })).status, 401);
    assert.equal((await s.call("DELETE", "/api/secrets/card", undefined, { ...h, "x-hb": "1" })).status, 401);
  }
  assert.equal((await s.call("POST", "/api/secrets", { name: "x3", value: "1" }, { cookie: await cookie(MEMBER) })).status, 403, "x-hb 없는 쓰기(다른 사이트 폼)");
  assert.deepEqual((await s.call("GET", "/api/secrets", undefined, await s.human(OWNER))).j.secrets, [], "주인은 주인 칸(owner '')만 — 회원 비밀은 안 보임");
  // 바꾸기: 값 다시 봉함 · 정책
  assert.equal((await s.call("PATCH", "/api/secrets/card", { value: "5500 0000 0000 0004", policy: "auto" }, await s.human())).status, 200);
  const r2 = s.db.prepare("SELECT value, policy FROM secret WHERE name = 'card'").get() as any;
  assert.match(r2.value, /^v2\./); assert.notEqual(r2.value, row.value); assert.equal(r2.policy, "auto");
  assert.ok(!dump(s.db).includes("5500 0000 0000 0004"));
  // 지우기: 값 칸 비움
  assert.equal((await s.call("DELETE", "/api/secrets/card", undefined, await s.human())).status, 200);
  assert.deepEqual({ ...(s.db.prepare("SELECT value, deleted_at IS NOT NULL AS d FROM secret WHERE name = 'card'").get() as any) }, { value: null, d: 1 });
  assert.deepEqual((await s.call("GET", "/api/secrets", undefined, await s.human())).j.secrets, []);
  assert.equal((await s.add({})).status, 200, "지운 이름은 다시 씀");
});

test("KEK 가 없으면 저장 거절(평문으로 두지 않음)", async () => {
  const s = await setup({ kek: false });
  const r = await s.add({});
  assert.equal(r.status, 503); assert.match(r.j.error, /봉할 키/);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM secret").get()!.n, 0);
});

test("ask: 카드로 묻고 · 허용 전엔 안 넘김 · 허용 뒤 묶인 기기 토큰으로 한 번 — 창 토큰 답엔 값이 없음", async () => {
  const s = await setup();
  await s.add({});
  assert.equal((await s.call("POST", "/api/secrets/card/fill", { site: "ftp://x", selector: "#cc" }, s.agent())).status, 400);
  const f = await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example/checkout?a=1", selector: "#cc", tab: "T1" }, s.agent());
  assert.equal(f.status, 200); assert.equal(f.j.state, "pending"); assert.ok(f.j.card_id);
  const id = f.j.id;
  const card = s.db.prepare("SELECT question, choices, state FROM board_card WHERE id = ?").get(f.j.card_id) as any;
  assert.deepEqual(JSON.parse(card.choices), ["허용", "거절"]); assert.match(card.question, /card.*https:\/\/shop\.example/);
  assert.equal((s.db.prepare("SELECT site FROM secret_request WHERE id = ?").get(id) as any).site, "https://shop.example", "사이트는 origin 으로");
  // 허용 전: 기기도 못 받음
  assert.equal((await s.call("GET", `/api/secrets/requests/${id}/value`, undefined, s.device())).status, 404);
  assert.equal((await s.call("GET", `/api/secrets/requests/${id}`, undefined, s.agent())).j.state, "pending");
  assert.equal((await s.call("POST", `/api/secrets/requests/${id}`, { action: "allow" }, { ...s.agent(), "x-hb": "1" })).status, 401);
  assert.equal((await s.call("GET", `/api/secrets/requests/${id}/value`, undefined, s.agent())).status, 401);
  // 사람이 폰 카드에서 「허용」(기존 카드 답 길)
  const a = await s.call("POST", `/api/me/cards/${f.j.card_id}/answer`, { choice: "허용" }, await s.human());
  assert.equal(a.status, 200, a.text);
  assert.equal((await s.call("GET", `/api/secrets/requests/${id}`, undefined, s.agent())).j.state, "approved");
  assert.equal((s.db.prepare("SELECT state FROM board_card WHERE id = ?").get(f.j.card_id) as any).state, "closed");
  assert.equal((await s.call("GET", `/api/secrets/requests/${id}/value`, undefined, s.device(DEV2))).status, 404, "다른 기기");
  const v = await s.call("GET", `/api/secrets/requests/${id}/value`, undefined, s.device());
  assert.equal(v.status, 200); assert.deepEqual(v.j, { value: VALUE, kind: "browser", site: "https://shop.example", selector: "#cc", tab: "T1" });
  assert.equal((await s.call("GET", `/api/secrets/requests/${id}/value`, undefined, s.device())).status, 404, "두 번째는 없음");
  assert.equal((await s.call("GET", `/api/secrets/requests/${id}`, undefined, s.agent())).j.state, "sent");
  assert.equal((await s.call("GET", `/api/secrets/requests/${id}`, undefined, s.agent(WIN_NODEV))).status, 404);
  // 감사: 사람 목록에 누가 · 사이트 · 상태(값 없음)
  const l = await s.call("GET", "/api/secrets", undefined, await s.human());
  assert.deepEqual(l.j.requests.map((r: any) => [r.name, r.site, r.state, r.agent]), [["card", "https://shop.example", "sent", "claude · shop"]]);
  noValue(l.text, "감사 목록"); noValue(dump(s.db), "D1");
  for (const x of s.seen) noValue(x, "창 토큰 답");
});

test("거절(카드 · 직접 길) 뒤엔 안 넘김 · 결정은 한 번", async () => {
  const s = await setup();
  await s.add({});
  const f1 = await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent());
  assert.equal((await s.call("POST", `/api/me/cards/${f1.j.card_id}/answer`, { choice: "거절" }, await s.human())).status, 200);
  assert.equal((await s.call("GET", `/api/secrets/requests/${f1.j.id}`, undefined, s.agent())).j.state, "denied");
  assert.equal((await s.call("GET", `/api/secrets/requests/${f1.j.id}/value`, undefined, s.device())).status, 404);
  const f2 = await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent());
  assert.equal((await s.call("POST", `/api/secrets/requests/${f2.j.id}`, { action: "deny" }, await s.human())).status, 200);
  assert.equal((await s.call("POST", `/api/secrets/requests/${f2.j.id}`, { action: "allow" }, await s.human())).status, 409, "이미 결정");
  assert.equal((await s.call("GET", `/api/secrets/requests/${f2.j.id}/value`, undefined, s.device())).status, 404);
  assert.equal((s.db.prepare("SELECT state FROM board_card WHERE id = ?").get(f2.j.card_id) as any).state, "closed", "카드도 닫힘");
  for (const x of s.seen) noValue(x, "창 토큰 답");
});

test("once · auto: 바로 허용 → 한 번 넘기면 비밀을 지움 · 다시 요청은 없는 비밀", async () => {
  const s = await setup();
  await s.add({ mode: "once", policy: "auto" });
  const f = await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent());
  assert.deepEqual([f.j.state, f.j.card_id], ["approved", undefined], "카드 없음");
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device())).j.value, VALUE);
  assert.deepEqual({ ...(s.db.prepare("SELECT value, deleted_at IS NOT NULL AS d, used_at IS NOT NULL AS u FROM secret").get() as any) }, { value: null, d: 1, u: 1 });
  assert.equal((await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent())).status, 404);
  for (const x of s.seen) noValue(x, "창 토큰 답");
});

test("만료: 10분 넘은 요청은 안 넘김(카드도 닫힘) · 10분 안 쓴 once 비밀은 지움", async () => {
  const s = await setup();
  await s.add({});
  const f = await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent());
  s.db.prepare("UPDATE secret_request SET created_at = created_at - 11 * 60000").run();
  await s.call("POST", `/api/me/cards/${f.j.card_id}/answer`, { choice: "허용" }, await s.human());   // 그새 비밀 길을 아무도 안 불러 카드가 열려 있었음 — 답해도 반영 안 됨
  assert.deepEqual({ ...(s.db.prepare("SELECT state, done FROM board_card WHERE id = ?").get(f.j.card_id) as any) }, { state: "closed", done: "만료" });
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}`, undefined, s.agent())).j.state, "expired");
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device())).status, 404);
  // auto 로 허용된 뒤 10분 안 가져감 → 만료
  await s.call("PATCH", "/api/secrets/card", { policy: "auto" }, await s.human());
  const g = await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent());
  s.db.prepare("UPDATE secret_request SET created_at = created_at - 11 * 60000 WHERE id = ?").run(g.j.id);
  assert.equal((await s.call("GET", `/api/secrets/requests/${g.j.id}/value`, undefined, s.device())).status, 404);
  // once 를 10분 안 씀
  await s.add({ name: "otp", mode: "once" });
  s.db.prepare("UPDATE secret SET expires_at = ? WHERE name = 'otp'").run(Date.now() - 1);
  assert.deepEqual((await s.call("GET", "/api/secrets", undefined, await s.human())).j.secrets.map((x: any) => x.name), ["card"]);
  assert.equal((s.db.prepare("SELECT value FROM secret WHERE name = 'otp'").get() as any).value, null);
});

test("기기 없는 창 토큰 · 기기 증거 없는 주인 판 토큰은 요청 못 함 · 없는 비밀 404 · 기다리는 요청 상한", async () => {
  const s = await setup();
  await s.add({});
  assert.equal((await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent(WIN_NODEV))).status, 403);
  assert.equal((await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent(WIN_OWNER))).status, 403);
  assert.equal((await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, { authorization: "Bearer nope" })).status, 401);
  assert.equal((await s.call("POST", "/api/secrets/nope/fill", { site: "https://shop.example", selector: "#cc" }, s.agent())).status, 404);
  for (let i = 0; i < 5; i++) assert.equal((await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent())).status, 200);
  assert.equal((await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent())).status, 429);
  for (const x of s.seen) noValue(x, "창 토큰 답");
});

// ── 주인(owner '') ─────────────────────────────────────────────
const adm = { authorization: `Bearer ${ADMIN}` };
test("주인: 사람 길 · 판 토큰 + 같은 기기 토큰으로 요청 · 관리 길로 결정 · 묶인 하네스 기기만 값 한 번", async () => {
  const s = await setup();
  assert.equal((await s.add({ kind: "id" }, OWNER)).status, 200);
  const row = s.db.prepare("SELECT owner, value FROM secret").get() as any;
  assert.equal(row.owner, ""); assert.match(row.value, /^v2\./); noValue(dump(s.db), "D1");
  assert.deepEqual((await s.call("GET", "/api/secrets", undefined, await s.human(OWNER))).j.secrets.map((x: any) => x.name), ["card"]);
  assert.equal((await s.call("PATCH", "/api/secrets/card", { kind: "card" }, await s.human(OWNER))).status, 200);
  assert.deepEqual((await s.call("GET", "/api/secrets", undefined, await s.human())).j.secrets, [], "회원은 주인 비밀을 못 봄");
  const fill = (h: Record<string, string>) => s.call("POST", "/api/secrets/card/fill", { site: "https://gov.example/form", selector: "#rrn" }, { ...s.agent(WIN_OWNER), ...h });
  // 기기 증거 없음 · 회원 기기 · 모르는 토큰 → 403
  assert.equal((await fill({})).status, 403);
  assert.equal((await fill({ "x-boarder-device": DEV1 })).status, 403);
  assert.equal((await fill({ "x-boarder-device": "bxd_nope-nope-nope-nope-nope-nope-nope" })).status, 403);
  assert.equal((await s.call("POST", "/api/secrets/card/fill", { site: "https://gov.example", selector: "#rrn" }, { ...s.agent(), "x-boarder-device": DEVH })).status, 404, "회원 창은 주인 비밀을 못 찾음");
  const f = await fill({ "x-boarder-device": DEVH });
  assert.equal(f.status, 200, f.text); assert.equal(f.j.state, "pending"); assert.equal(f.j.card_id, undefined, "주인은 board_card 없음");
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM board_card").get()!.n, 0);
  assert.equal((s.db.prepare("SELECT device_id FROM secret_request WHERE id = ?").get(f.j.id) as any).device_id, "devH");
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device(DEVH))).status, 404, "결정 전");
  assert.equal((await s.call("GET", "/api/admin/secrets/requests?state=pending&owner=", undefined, s.agent(WIN_OWNER))).status, 403, "창 토큰은 관리 길 못 씀");
  const l = await s.call("GET", "/api/admin/secrets/requests?state=pending&owner=", undefined, adm);
  assert.equal(l.status, 200); noValue(l.text, "관리 목록");
  assert.deepEqual(l.j.requests.map((r: any) => [r.id, r.name, r.kind, r.site, r.agent]), [[f.j.id, "card", "card", "https://gov.example", "owner pane"]]);
  assert.equal((await s.call("POST", `/api/admin/secrets/requests/${f.j.id}`, { action: "allow" }, adm)).status, 400, "by 없음");
  const a = await s.call("POST", `/api/admin/secrets/requests/${f.j.id}`, { action: "allow", by: "owner@board" }, adm);
  assert.deepEqual([a.status, a.j.state], [200, "approved"]);
  assert.equal((s.db.prepare("SELECT decided_by FROM secret_request WHERE id = ?").get(f.j.id) as any).decided_by, "owner@board");
  assert.equal((await s.call("POST", `/api/admin/secrets/requests/${f.j.id}`, { action: "deny", by: "x" }, adm)).status, 409, "한 번만");
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device(DEVW))).status, 404);
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device(DEV1))).status, 404);
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.agent(WIN_OWNER))).status, 401);
  const v = await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device(DEVH));
  assert.equal(v.status, 200); assert.equal(v.j.value, VALUE);
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device(DEVH))).status, 404, "두 번째는 없음");
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}`, undefined, s.agent(WIN_OWNER))).j.state, "sent");
  for (const x of s.seen) noValue(x, "창 토큰 답");
});

test("주인: 거절 · 만료 · once · 회원 요청은 관리 길로 못 정함 · 회원 watch 기기는 값 길 거절", async () => {
  const s = await setup();
  await s.add({}, OWNER);
  const fill = () => s.call("POST", "/api/secrets/card/fill", { site: "https://gov.example", selector: "#rrn" }, { ...s.agent(WIN_OWNER), "x-boarder-device": DEVW });
  const f1 = await fill();
  assert.equal((await s.call("POST", `/api/admin/secrets/requests/${f1.j.id}`, { action: "deny", by: "owner" }, adm)).j.state, "denied");
  assert.equal((await s.call("GET", `/api/secrets/requests/${f1.j.id}/value`, undefined, s.device(DEVW))).status, 404);
  const f2 = await fill();
  s.db.prepare("UPDATE secret_request SET created_at = created_at - 11 * 60000 WHERE id = ?").run(f2.j.id);
  assert.equal((await s.call("POST", `/api/admin/secrets/requests/${f2.j.id}`, { action: "allow", by: "owner" }, adm)).status, 409, "만료");
  // once + auto: 바로 허용 → watch 기기(묶인 것)로 한 번 → 지움
  await s.call("PATCH", "/api/secrets/card", { mode: "once", policy: "auto" }, await s.human(OWNER));
  const f3 = await fill();
  assert.equal(f3.j.state, "approved");
  assert.equal((await s.call("GET", `/api/secrets/requests/${f3.j.id}/value`, undefined, s.device(DEVW))).j.value, VALUE);
  assert.equal((s.db.prepare("SELECT value FROM secret WHERE owner = ''").get() as any).value, null);
  // 회원 요청은 관리 길로 못 정함 · 회원 watch 기기는 값 길 거절
  await s.add({});
  const m = await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent());
  assert.equal((await s.call("POST", `/api/admin/secrets/requests/${m.j.id}`, { action: "allow", by: "x" }, adm)).status, 409);
  assert.equal((await s.call("POST", `/api/secrets/requests/${m.j.id}`, { action: "allow" }, await s.human())).status, 200);
  assert.equal((await s.call("GET", `/api/secrets/requests/${m.j.id}/value`, undefined, s.device(DEVMW))).status, 401, "회원 watch 기기");
  assert.equal((await s.call("GET", `/api/secrets/requests/${m.j.id}/value`, undefined, s.device())).j.value, VALUE);
});


test("사람 요청 조회 · 결정: 기기 머리 있으면 401, 주인 세션의 직접 결정은 허용", async () => {
  const s = await setup();
  await s.add({}, OWNER);
  const f = await s.call("POST", "/api/secrets/card/fill", { site: "https://gov.example", selector: "#rrn" }, { ...s.agent(WIN_OWNER), "x-boarder-device": DEVH });
  assert.equal(f.status, 200);
  for (const t of [DEVH, "invalid", ""]) {
    const h = { ...(await s.human(OWNER)), "x-boarder-device": t };
    assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}`, undefined, h)).status, 401);
    assert.equal((await s.call("POST", `/api/secrets/requests/${f.j.id}`, { action: "allow" }, h)).status, 401);
  }
  assert.equal((await s.call("POST", `/api/secrets/requests/${f.j.id}`, { action: "allow" }, await s.human(OWNER))).status, 200);
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device(DEVH))).j.value, VALUE);
});

test("비밀 승인 카드: 사람 쿠키와 함께 온 토큰 머리도 거절하고 요청 · 카드를 그대로 둠", async () => {
  const s = await setup();
  await s.add({});
  const f = await s.call("POST", "/api/secrets/card/fill", { site: "https://shop.example", selector: "#cc" }, s.agent());
  const human = await s.human();
  for (const h of [{ authorization: `Bearer ${WIN}` }, { authorization: "" }, ...[DEV1, "invalid", ""].map(t => ({ "x-boarder-device": t }))]) {
    const a = await s.call("POST", `/api/me/cards/${f.j.card_id}/answer`, { choice: "허용" }, { ...human, ...h });
    assert.equal(a.status, 401, a.text);
    assert.equal((s.db.prepare("SELECT state FROM secret_request WHERE id = ?").get(f.j.id) as any).state, "pending");
    assert.deepEqual({ ...(s.db.prepare("SELECT state, answer FROM board_card WHERE id = ?").get(f.j.card_id) as any) }, { state: "open", answer: null });
  }
  assert.equal((await s.call("POST", `/api/me/cards/${f.j.card_id}/answer`, { choice: "허용" }, human)).status, 200);
  assert.equal((s.db.prepare("SELECT state FROM secret_request WHERE id = ?").get(f.j.id) as any).state, "approved");
  s.db.prepare("INSERT INTO board_card(id, owner, win, question, choices, at) VALUES (?,?,?,?,?,?)").run("ordinary", MEMBER, "test", "Continue?", JSON.stringify(["yes"]), Date.now());
  assert.equal((await s.call("POST", "/api/me/cards/ordinary/answer", { choice: "yes" }, { ...human, "x-boarder-device": DEV1 })).status, 200, "일반 카드는 기존 동작 유지");
});

test("tmux: strict target validation, terminal approval card, device binding and one delivery", async () => {
  const s = await setup(); await s.add({});
  for (const tmux of [null, 1, "", "demo", "demo:1;echo", "demo:1\n", "demo:10000", "demo:1.1000", "demo:1.2.3", "x".repeat(41) + ":1"]) {
    assert.equal((await s.call("POST", "/api/secrets/card/fill", { tmux }, s.agent())).status, 400, String(tmux));
  }
  for (const extra of [{ site: "https://shop.example" }, { selector: "#cc" }, { tab: "T1" }]) {
    assert.equal((await s.call("POST", "/api/secrets/card/fill", { tmux: "demo:1.2", ...extra }, s.agent())).status, 400);
  }
  const f = await s.call("POST", "/api/secrets/card/fill", { tmux: "demo:1.2" }, { ...s.agent(), "x-boarder-device": DEVH });
  assert.equal(f.status, 200); assert.equal(f.j.state, "pending");
  const row = s.db.prepare("SELECT site, target, device_id FROM secret_request WHERE id = ?").get(f.j.id) as any;
  assert.equal(row.site, "terminal:demo:1.2"); assert.deepEqual(JSON.parse(row.target), { tmux: "demo:1.2" });
  assert.equal(row.device_id, "dev1", "member ignores device header");
  const card = s.db.prepare("SELECT question, body FROM board_card WHERE id = ?").get(f.j.card_id) as any;
  for (const text of [card.question, card.body]) { assert.match(text, /이 기기의 터미널\(demo:1.2\)/); assert.ok(!text.includes("브라우저")); }
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device())).status, 404);
  await s.call("POST", `/api/me/cards/${f.j.card_id}/answer`, { choice: "허용" }, await s.human());
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device(DEV2))).status, 404);
  const v = await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device());
  assert.deepEqual(v.j, { value: VALUE, kind: "tmux", site: "terminal:demo:1.2", tmux: "demo:1.2" });
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device())).status, 404);
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}`, undefined, s.agent())).j.state, "sent");
  for (const x of s.seen) noValue(x, "agent response");
  noValue(dump(s.db), "D1");
});

test("tmux: owner device proof, auto, once deletion, deny and ten-minute expiry", async () => {
  const s = await setup(); await s.add({}, OWNER);
  const fill = (headers = {}) => s.call("POST", "/api/secrets/card/fill", { tmux: "demo:1" }, { ...s.agent(WIN_OWNER), ...headers });
  assert.equal((await fill()).status, 403);
  assert.equal((await fill({ "x-boarder-device": DEV1 })).status, 403);
  const f = await fill({ "x-boarder-device": DEVH });
  assert.equal(f.j.state, "pending");
  await s.call("POST", `/api/admin/secrets/requests/${f.j.id}`, { action: "deny", by: "test" }, adm);
  assert.equal((await s.call("GET", `/api/secrets/requests/${f.j.id}/value`, undefined, s.device(DEVH))).status, 404);
  const exp = await fill({ "x-boarder-device": DEVH });
  s.db.prepare("UPDATE secret_request SET created_at = created_at - 11 * 60000 WHERE id = ?").run(exp.j.id);
  assert.equal((await s.call("GET", `/api/secrets/requests/${exp.j.id}`, undefined, s.agent(WIN_OWNER))).j.state, "expired");
  await s.call("PATCH", "/api/secrets/card", { mode: "once", policy: "auto" }, await s.human(OWNER));
  const auto = await fill({ "x-boarder-device": DEVH });
  assert.equal(auto.j.state, "approved"); assert.equal(auto.j.card_id, undefined);
  assert.equal((await s.call("GET", `/api/secrets/requests/${auto.j.id}/value`, undefined, s.device(DEVW))).status, 404);
  assert.equal((await s.call("GET", `/api/secrets/requests/${auto.j.id}/value`, undefined, s.device(DEVH))).j.kind, "tmux");
  assert.equal((s.db.prepare("SELECT value FROM secret WHERE owner = ''").get() as any).value, null);
  for (const x of s.seen) noValue(x, "agent response");
});
