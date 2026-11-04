import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const { default: app } = await import("./index.ts");
const MB = await import("./member-board.ts");
const MC = await import("./member-canvas.ts");
(app as any).onError((e: unknown) => { console.error("시험 500:", e); return new Response("{}", { status: 500 }); });

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
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
const TOK = { A: "bxd_" + "a".repeat(40), B: "bxd_" + "b".repeat(40), O: "bxd_" + "o".repeat(40) };
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function cookie(email: string) {
  const th = (await sha(SESS)).slice(0, 32), exp = Date.now() + 600_000;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`bx_s|${email}|${exp}|${th}`))).slice(0, 32);
  return `better-auth.session_token=${SESS}; bx_s=${encodeURIComponent(`${email}|${exp}|${sig}`)}`;
}
const ROLE = "ew_arole000001", PANE = MB.paneOfId(ROLE), ART = "AbCdEfGhIjKlMnOp1234", OFFER = "v=0\r\no=offer";

async function setup(o: { voiceA?: unknown; engineA?: boolean; cmdFail?: { code: number; msg: string } } = {}) {
  const { db, D1 } = d1(), T = Date.now();
  for (const m of [A, B]) db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(m, OWNER, T);
  const dev = db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at, engine) VALUES (?,?,?,?,?,?,?,?,?,?)");
  dev.run("devAaaaaaaaa", A, "mbp", "", await sha(TOK.A), T, T, "full", o.engineA === false ? null : T, JSON.stringify({ cli: "0.1.21", ...(o.voiceA === undefined ? { voice: { ok: true, why: "" } } : o.voiceA === null ? {} : { voice: o.voiceA }) }));
  dev.run("devBbbbbbbbb", B, "theirs", "", await sha(TOK.B), T, T, "full", T, JSON.stringify({ voice: { ok: true } }));
  dev.run("devOooooooo1", OWNER, "owner-host", "", await sha(TOK.O), T, T, "harness", T, JSON.stringify({ voice: { ok: true } }));
  const ew = db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?)");
  ew.run(ROLE, A, "devAaaaaaaaa", "role", "예시 정리 창", "idle", T, T);
  ew.run("ew_amain000001", A, "devAaaaaaaaa", "main", "모찌", "idle", T, T);
  ew.run("ew_brole000001", B, "devBbbbbbbbb", "role", "남의 창", "idle", T, T);
  const log = db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)");
  log.run(A, "예시 정리 창", "progress", "정리 창 진행 — 영수증 12장 남음", null, T - 5000, ROLE);
  log.run(B, "남의 창", "progress", "B 의 비밀 일", null, T - 5000, "ew_brole000001");
  // 가짜 엔진 DO(기기마다): cmd 는 부른 기기 · 동사 · 인자를 붙잡고 정해 둔 답
  const cmds: { dev: string; verb: string; args: any }[] = [], delivered: [string, string, string][] = [];
  let devOf = "";
  const fake = async (verb: string, args: any) => {
        cmds.push({ dev: devOf, verb, args });
        if (o.cmdFail) throw Object.assign(new Error(o.cmdFail.msg), { code: o.cmdFail.code });
        if (verb === "rtc_start") return { cid: args.cid, sdp: "v=0\r\no=answer" };
        if (verb === "rtc_poll") return { state: "open", reason: "", turns: 2, screen: [{ action: "open_channel", channel: "primary" }, "junk"], handoffs: [{ id: "abcd-1", name: "Primary", state: "in" }] };
        return { ok: true };
  };
  const ENGINE = {
    idFromName: (s: string) => s,
    get: (id: string) => ({
      // 진짜 Engine.rtc 처럼 오류는 답 꼴로(RPC 너머로 code 가 안 건너감)
      rtc: async (verb: string, args: any) => { devOf = id.replace(/^dev:/, ""); try { return { ok: true, result: await fake(verb, args) }; } catch (e: any) { return { ok: false, code: e.code || 1, error: e.message }; } },
      deliver: async (wid: string, text: string) => { delivered.push([id, wid, text]); return { sent: true }; },
      drainCmds: async () => null,
      ensureMain: async () => "ew_amain000001",
    }),
  };
  const R2 = new Map<string, { body: string; meta?: Record<string, string> }>();
  const RESULTS = {
    head: async (k: string) => R2.has(k) ? { customMetadata: R2.get(k)!.meta } : null,
    get: async (k: string) => R2.has(k) ? { text: async () => R2.get(k)!.body, body: R2.get(k)!.body, httpMetadata: {} } : null,
    list: async () => ({ objects: [], truncated: false }),
  };
  const mk = await MC.keyOf(A);
  R2.set(`mart/${mk}/_c/${ART}`, { body: "{}", meta: { title: "주간 정리", acct: "", at: "1", ver: "v1", n: "2", bytes: "9", kind: "canvas", cv: "project", wid: ROLE } });
  R2.set(`mart/${mk}/${ART}/v1/project/B1.dc.html`, { body: "<html><style>.x{}</style><script>alert(1)</script><h1>막힘 3개</h1><p>계정 재로그인 &amp; 영수증</p></html>" });
  R2.set(`mart/${mk}/${ART}/v1/project/canvas.json`, { body: JSON.stringify({ boards: { "B1.dc.html": { title: "막힘 판" } } }) });
  const env: any = { DB: D1, ENGINE, RESULTS, SNAP: { idFromName: (s: string) => s, get: () => ({ bump: async () => 0 }) }, BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: OWNER, PUBLIC_URL: "https://example.test" };
  const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };
  const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.fetch(new Request("https://example.test" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };
  const human = async (email = A) => ({ cookie: await cookie(email), "x-hb": "1", "sec-fetch-site": "same-origin" });
  const device = (t: string) => ({ authorization: `Bearer ${t}` });
  const lines = (owner = A) => db.prepare("SELECT win, kind, text, thread, wid FROM board_log WHERE owner = ? AND text LIKE '🎧%' ORDER BY id").all(owner).map(r => ({ ...r })) as any[];
  return { db, env, call, human, device, cmds, delivered, lines };
}

test("고르개 /api/voice/modes: 엔진 기기 없음 · 옛 CLI · 기기 codex 로그인 없음(그 이유) · 됨 — 주인 꼴 { agent, gpt:{ok, why} }", async () => {
  const get = async (o: Parameters<typeof setup>[0]) => { const s = await setup(o); return (await s.call("GET", "/api/voice/modes", undefined, await s.human())).j; };
  assert.deepEqual(await get({ engineA: false }), { agent: { ok: true }, gpt: { ok: false, why: "엔진이 켜진 기기가 없어요 — 기기에서 boarder engine setup 을 돌려요" } });
  assert.match((await get({ voiceA: null })).gpt.why, /CLI 가 옛 판/);
  assert.deepEqual((await get({ voiceA: { ok: false, why: "이 기기에 Codex(ChatGPT) 로그인이 없어요 — 기기에서 codex login 을 해요" } })).gpt, { ok: false, why: "이 기기에 Codex(ChatGPT) 로그인이 없어요 — 기기에서 codex login 을 해요" });
  assert.deepEqual(await get({}), { agent: { ok: true }, gpt: { ok: true } });
});

test("걸기: 내 판만 · 엔진이 붙은 내 기기에 rtc_start(그 판 맥락 지시문 · 창 id) → { cid: <기기>.<rid>, sdp } · 「🎧 통화 시작」 줄은 그 창 줄", async () => {
  const s = await setup(), h = await s.human();
  const r = await s.call("POST", "/api/voice/rtc/start", { rid: "rid0123456789", pane: PANE, sdp: OFFER }, h);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.j, { ok: true, cid: "devAaaaaaaaa.rid0123456789", sdp: "v=0\r\no=answer" });
  assert.equal(s.cmds.length, 1);
  const c = s.cmds[0];
  assert.deepEqual({ dev: c.dev, verb: c.verb, cid: c.args.cid, sdp: c.args.sdp, pane: c.args.pane, window: c.args.window, name: c.args.name, meet: c.args.meet }, { dev: "devAaaaaaaaa", verb: "rtc_start", cid: "rid0123456789", sdp: OFFER, pane: PANE, window: ROLE, name: "예시 정리 창", meet: false });
  assert.match(c.args.instructions, /예시 정리 창/); assert.match(c.args.instructions, /영수증 12장 남음/);
  assert.doesNotMatch(c.args.instructions, /Owner|B 의 비밀/);
  assert.deepEqual(s.lines(), [{ win: "예시 정리 창", kind: "sys", text: "🎧 GPT voice 통화 시작", thread: null, wid: ROLE }]);
  // 메인 봇 판(%1)도 됨 — 줄은 「보더」(Primary 채팅엔 안 섞임)
  const m = await s.call("POST", "/api/voice/rtc/start", { rid: "rid0123456780", pane: "%1", sdp: OFFER, meet: true }, h);
  assert.equal(m.status, 200); assert.equal(s.cmds[1].args.meet, true); assert.equal(s.cmds[1].args.window, "ew_amain000001");
  for (const [b, st] of [[{ rid: "rid0123456781", pane: MB.paneOfId("ew_brole000001"), sdp: OFFER }, 400], [{ rid: "rid0123456782", pane: "%9", sdp: OFFER }, 400], [{ rid: "x", pane: PANE, sdp: OFFER }, 400], [{ rid: "rid0123456783", pane: PANE, sdp: "nope" }, 400]] as const) {
    const x = await s.call("POST", "/api/voice/rtc/start", b, h); assert.equal(x.status, st, JSON.stringify(b));
  }
  assert.equal(s.cmds.length, 2);
  // 다른 사이트 폼(sec-fetch-site cross-site)은 막음
  assert.equal((await s.call("POST", "/api/voice/rtc/start", { rid: "rid0123456784", pane: PANE, sdp: OFFER }, { ...h, "sec-fetch-site": "cross-site", "x-hb": "" })).status, 403);
});

test("걸기 실패: 엔진 꺼짐 409 · 옛 CLI(동사 모름) · 바쁨 429 · 기기 실패 502 — 이유 한 줄", async () => {
  let s = await setup({ engineA: false });
  let r = await s.call("POST", "/api/voice/rtc/start", { rid: "rid0123456789", pane: PANE, sdp: OFFER }, await s.human());
  assert.equal(r.status, 409); assert.match(r.j.error, /엔진이 켜진 기기가 없어요/); assert.equal(s.cmds.length, 0);
  s = await setup({ cmdFail: { code: 1, msg: "unknown verb rtc_start" } });
  r = await s.call("POST", "/api/voice/rtc/start", { rid: "rid0123456789", pane: PANE, sdp: OFFER }, await s.human());
  assert.equal(r.status, 502); assert.match(r.j.error, /CLI 가 옛 판/);
  s = await setup({ cmdFail: { code: 2, msg: "이 기기에선 통화를 동시에 3개까지 열어요" } });
  r = await s.call("POST", "/api/voice/rtc/start", { rid: "rid0123456789", pane: PANE, sdp: OFFER }, await s.human());
  assert.equal(r.status, 429); assert.match(r.j.error, /3개까지/);
  s = await setup({ cmdFail: { code: 1, msg: "이 기기에 Codex(ChatGPT) 로그인이 없어요" } });
  r = await s.call("POST", "/api/voice/rtc/start", { rid: "rid0123456789", pane: PANE, sdp: OFFER }, await s.human());
  assert.equal(r.status, 502); assert.equal(r.j.error, "GPT voice 를 못 열었어요: 이 기기에 Codex(ChatGPT) 로그인이 없어요");
  assert.equal(s.lines().length, 0, "못 연 통화는 줄 없음");
});

test("기기 고르기: 통화가 되는(hello voice.ok) 기기만 — codex 없는 기기는 빼고 · 다 안 되면 409 + 이유 · 판 창 기기가 되면 그 기기 먼저", async () => {
  const NOCODEX = { ok: false, why: "이 기기에 codex 가 없어요 — Codex CLI 를 깔고 codex login 을 해요" };
  const addDev = (s: Awaited<ReturnType<typeof setup>>, id: string, voice: unknown, at: number) =>
    s.db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at, engine) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, A, id, "", "h-" + id, at, at, "full", at, JSON.stringify({ cli: "0.1.30", voice }));
  const start = (s: Awaited<ReturnType<typeof setup>>, h: Record<string, string>, rid: string) => s.call("POST", "/api/voice/rtc/start", { rid, pane: PANE, sdp: OFFER }, h);
  let s = await setup({ voiceA: NOCODEX }), h = await s.human();
  addDev(s, "devMinimini1", { ok: true, why: "" }, Date.now() - 30_000);
  assert.deepEqual((await s.call("GET", "/api/voice/modes", undefined, h)).j, { agent: { ok: true }, gpt: { ok: true } });
  assert.deepEqual((await s.call("GET", "/api/voice/modes?pane=" + encodeURIComponent(PANE), undefined, h)).j.gpt, { ok: true });
  let r = await start(s, h, "rid0123456789");
  assert.equal(r.status, 200, r.text); assert.equal(r.j.cid, "devMinimini1.rid0123456789");
  assert.deepEqual(s.cmds.map(c => [c.dev, c.verb]), [["devMinimini1", "rtc_start"]]);
  assert.equal((await s.call("GET", "/api/voice/rtc/poll/" + r.j.cid, undefined, h)).status, 200);
  assert.equal(s.cmds.at(-1)!.dev, "devMinimini1");
  // ② 둘 다 안 됨 → modes why · 걸기 409 같은 이유 · 기기엔 안 감
  s = await setup({ voiceA: NOCODEX }); h = await s.human();
  addDev(s, "devMinimini1", { ok: false, why: "이 기기에 Codex(ChatGPT) 로그인이 없어요 — 기기에서 codex login 을 해요" }, Date.now() - 30_000);
  assert.deepEqual((await s.call("GET", "/api/voice/modes", undefined, h)).j.gpt, { ok: false, why: "통화가 되는 기기가 없어요 — codex 로그인된 기기에서 boarder engine setup 을 돌려요" });
  r = await start(s, h, "rid0123456789");
  assert.equal(r.status, 409); assert.equal(r.j.error, "통화가 되는 기기가 없어요 — codex 로그인된 기기에서 boarder engine setup 을 돌려요");
  assert.equal(s.cmds.length, 0); assert.equal(s.lines().length, 0);
  // 오래 연락 없는(2분+) 기기는 voice.ok 여도 안 고름
  s = await setup({ voiceA: NOCODEX }); h = await s.human();
  addDev(s, "devMinimini1", { ok: true }, Date.now() - 300_000);
  assert.equal((await start(s, h, "rid0123456789")).status, 409); assert.equal(s.cmds.length, 0);
  s = await setup(); h = await s.human();
  addDev(s, "devMinimini1", { ok: true }, Date.now() + 5_000);
  r = await start(s, h, "rid0123456789");
  assert.equal(r.status, 200, r.text); assert.equal(r.j.cid, "devAaaaaaaaa.rid0123456789");
  r = await s.call("POST", "/api/voice/rtc/start", { rid: "rid0123456780", pane: "%1", sdp: OFFER }, h);
  assert.equal(r.j.cid, "devAaaaaaaaa.rid0123456780");
  s.db.prepare("DELETE FROM engine_window WHERE id = ?").run("ew_amain000001");
  r = await s.call("POST", "/api/voice/rtc/start", { rid: "rid0123456781", pane: "%1", sdp: OFFER }, h);
  assert.equal(r.j.cid, "devMinimini1.rid0123456781");
});

test("poll · note · stop: 내 기기 cid 만 — 남의 기기 · 주인 하네스 기기 · 틀린 꼴은 기기에 안 감", async () => {
  const s = await setup(), h = await s.human();
  const p = await s.call("GET", "/api/voice/rtc/poll/devAaaaaaaaa.rid0123456789", undefined, h);
  assert.deepEqual(p.j, { state: "open", reason: "", turns: 2, screen: [{ action: "open_channel", channel: "primary" }], handoffs: [{ id: "abcd-1", name: "Primary", state: "in" }] });
  assert.deepEqual(s.cmds.at(-1), { dev: "devAaaaaaaaa", verb: "rtc_poll", args: { cid: "rid0123456789" } });
  for (const cid of ["devBbbbbbbbb.rid0123456789", "devOooooooo1.rid0123456789", "rid0123456789", "devAaaaaaaaa.x"]) {
    const x = await s.call("GET", "/api/voice/rtc/poll/" + cid, undefined, h);
    assert.equal(x.status, 404, cid); assert.equal(x.j.state, "closed");
    assert.equal((await s.call("POST", "/api/voice/rtc/note", { cid, k: "connected" }, h)).status, 404);
    assert.equal((await s.call("POST", "/api/voice/rtc/stop", { cid }, h)).status, 200);
  }
  assert.equal(s.cmds.length, 1);
  await s.call("POST", "/api/voice/rtc/note", { cid: "devAaaaaaaaa.rid0123456789", k: "connected", x: "" }, h);
  assert.deepEqual(s.cmds.at(-1), { dev: "devAaaaaaaaa", verb: "rtc_note", args: { cid: "rid0123456789", k: "connected" } });
  await s.call("POST", "/api/voice/rtc/stop", { cid: "devAaaaaaaaa.rid0123456789" }, h);
  assert.deepEqual(s.cmds.at(-1), { dev: "devAaaaaaaaa", verb: "rtc_stop", args: { cid: "rid0123456789" } });
  // B 는 A 의 통화를 못 봄
  const pb = await s.call("GET", "/api/voice/rtc/poll/devAaaaaaaaa.rid0123456789", undefined, await s.human(B));
  assert.equal(pb.status, 404);
  // 통화 끝 줄(주인 voice/end 꼴)
  assert.equal((await s.call("POST", "/api/voice/end", { pane: PANE, secs: 75, n: 3 }, h)).status, 200);
  assert.equal(s.lines().at(-1).text, "🎧 음성 통화 끝 · 1:15 · 넣은 말 3");
  assert.equal((await s.call("POST", "/api/voice/end", { pane: MB.paneOfId("ew_brole000001"), secs: 1 }, h)).status, 400);
});

test("캔버스 미팅: /api/artowner → 내 캔버스를 올린 창 판 · 남의 것 · 없는 것은 {} · 지금 판 글을 진행자에게(rtc_say, 태그 · 스크립트 뺌) · 짚은 곳", async () => {
  const s = await setup(), h = await s.human();
  assert.deepEqual((await s.call("GET", `/api/artowner/${ART}`, undefined, h)).j, { pane: PANE, name: "예시 정리 창" });
  assert.deepEqual((await s.call("GET", `/api/artowner/${ART}`, undefined, await s.human(B))).j, {});
  assert.deepEqual((await s.call("GET", "/api/artowner/ZZZZZZZZZZZZZZZZZZZZ", undefined, h)).j, {});
  const cid = "devAaaaaaaaa.rid0123456789";
  const r = await s.call("POST", "/api/voice/rtc/note", { cid, k: "screen", art: ART, board: "B1.dc.html" }, h);
  assert.deepEqual(r.j, { ok: true });
  const say = s.cmds.at(-1)!;
  assert.equal(say.verb, "rtc_say"); assert.equal(say.args.cid, "rid0123456789");
  assert.match(say.args.text, /「막힘 판」/); assert.match(say.args.text, /막힘 3개 계정 재로그인 & 영수증/); assert.doesNotMatch(say.args.text, /alert|\.x\{/);
  assert.equal((await s.call("POST", "/api/voice/rtc/note", { cid, k: "screen", art: ART, board: "B1.dc.html" }, await s.human(B))).status, 404);
  const n0 = s.cmds.length;
  assert.deepEqual((await s.call("POST", "/api/voice/rtc/note", { cid, k: "screen", art: ART, board: "../x.dc.html" }, h)).j, { ok: false });
  assert.equal(s.cmds.length, n0);
  await s.call("POST", "/api/voice/rtc/note", { cid, k: "point", n: 2, text: "영수증 12장" }, h);
  assert.match(s.cmds.at(-1)!.args.text, /핀 2 로 한 곳을 짚었다.*「영수증 12장」/);
});

test("기기 → 서버(/api/device/voice): 받아쓴 말 줄 · 넘기기(메인 봇 · 창 이름 · here) · 사람 말 없으면 거절 · 상태 — 기기 주인 것만, 주인 · 하네스 기기는 401", async () => {
  const s = await setup(), dv = s.device(TOK.A), base = { cid: "rid0123456789", pane: PANE };
  assert.equal((await s.call("POST", "/api/device/voice", { ...base, op: "turn", role: "user", text: "보고서 부탁해" }, dv)).status, 200);
  await s.call("POST", "/api/device/voice", { ...base, op: "turn", role: "assistant", text: "네, 넘길게요" }, dv);
  assert.deepEqual(s.lines().map(l => [l.win, l.text, l.wid]), [["예시 정리 창", "🎧 나: 보고서 부탁해", ROLE], ["예시 정리 창", "🎧 GPT voice: 네, 넘길게요", ROLE]]);
  let r = await s.call("POST", "/api/device/voice", { ...base, op: "handoff", to: "primary", text: "주간 보고서 정리", said: "보고서 부탁해", n: 0 }, dv);
  assert.equal(r.j.ok, true, r.text); assert.equal(r.j.text, "모찌에 넣음 (id rid0-1)");
  assert.deepEqual({ id: r.j.handoff.id, pane: r.j.handoff.pane, state: r.j.handoff.state }, { id: "rid0-1", pane: "%1", state: "in" });
  assert.equal(s.delivered.at(-1)![1], "ew_amain000001");
  assert.match(s.delivered.at(-1)![2], /^\[보드 · Primary\] \[Boarder chat\] \[통화 넘김 · GPT voice 정리\] 주간 보고서 정리 — 원문\(받아쓰기\): 「보고서 부탁해」.*통화 넘김 rid0-1/);
  r = await s.call("POST", "/api/device/voice", { ...base, op: "handoff", to: "예시 정리", text: "영수증 마저", said: "영수증 마저 해", n: 1 }, dv);
  assert.equal(r.j.text, "예시 정리 창에 넣음 (id rid0-2)");
  assert.deepEqual(s.delivered.at(-1)!.slice(0, 2), ["dev:devAaaaaaaaa", ROLE]);
  assert.match(s.delivered.at(-1)![2], /^\[보드 · 예시 정리 창\] \[Boarder chat\] \[통화 넘김/);
  r = await s.call("POST", "/api/device/voice", { ...base, op: "handoff", to: "here", text: "x", said: "y", n: 2 }, dv);
  assert.equal(r.j.handoff.pane, PANE);
  r = await s.call("POST", "/api/device/voice", { ...base, op: "handoff", to: "남의 창", text: "x", said: "y", n: 3 }, dv);
  assert.deepEqual(r.j, { ok: false, text: "「남의 창」 창을 못 찾았어요" });
  r = await s.call("POST", "/api/device/voice", { ...base, op: "handoff", to: "primary", text: "x", said: "", n: 3 }, dv);
  assert.equal(r.status, 400);
  assert.equal(s.delivered.length, 3);
  // 넘김 줄은 받는 창에 「🎧 통화 넘김」(sys) — 상태 판정엔 안 셈
  assert.ok(s.lines().some(l => l.text === "🎧 통화 넘김 rid0-2(GPT voice 정리): 영수증 마저" && l.wid === ROLE));
  const at = Date.now() - 1000;
  r = await s.call("POST", "/api/device/voice", { ...base, op: "status", handoffs: [{ id: "rid0-2", pane: PANE, at, state: "in" }] }, dv);
  assert.deepEqual(r.j.handoffs, [{ id: "rid0-2", state: "in", recent: "" }]);
  s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").run(A, "예시 정리 창", "done", "통화 넘김 rid0-2 영수증 다 넣음", null, Date.now(), ROLE);
  s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").run(A, "예시 정리 창", "progress", "통화 넘김 rid0-20 다른 일", null, Date.now() + 1, ROLE);
  r = await s.call("POST", "/api/device/voice", { ...base, op: "status", handoffs: [{ id: "rid0-2", pane: PANE, at, state: "in" }] }, dv);
  assert.deepEqual(r.j.handoffs, [{ id: "rid0-2", state: "done", kind: "끝", line: "통화 넘김 rid0-2 영수증 다 넣음", recent: "" }]);
  // B 기기는 A 판에 못 씀(A 판은 B 에게 없는 판)
  const n0 = s.lines().length;
  assert.equal((await s.call("POST", "/api/device/voice", { ...base, op: "turn", role: "user", text: "끼어들기" }, s.device(TOK.B))).status, 400);
  r = await s.call("POST", "/api/device/voice", { ...base, op: "handoff", to: "예시 정리 창", text: "x", said: "y" }, s.device(TOK.B));
  assert.equal(r.j.ok, false);
  r = await s.call("POST", "/api/device/voice", { ...base, op: "status", handoffs: [{ id: "rid0-2", pane: PANE, at, state: "in" }] }, s.device(TOK.B));
  assert.deepEqual(r.j.handoffs, [{ id: "rid0-2", state: "in", recent: "" }], "B 는 A 창 줄을 못 읽음");
  assert.equal(s.lines().length, n0); assert.equal(s.delivered.length, 3);
  for (const hd of [s.device(TOK.O), {}, s.device("bxd_" + "z".repeat(40))]) assert.equal((await s.call("POST", "/api/device/voice", { ...base, op: "turn", role: "user", text: "x" }, hd)).status, 401);
});

test("기기 → 서버(/api/device/voice) 몸 크기: content-length 거짓 · 없음(스트림)이어도 32 KB 넘게 안 읽음(413), 깨진 JSON 400", async () => {
  const s = await setup(), base = { cid: "rid0123456789", pane: PANE, op: "turn", role: "user" };
  const raw = async (body: BodyInit, h: Record<string, string> = {}) => await app.fetch(new Request("https://example.test/api/device/voice", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOK.A}`, ...h }, body, duplex: "half" } as RequestInit), s.env, { waitUntil() {}, passThroughOnException() {} } as never);
  // 헤더가 큼 → 읽기 전 413
  assert.equal((await s.call("POST", "/api/device/voice", { ...base, text: "x" }, { ...s.device(TOK.A), "content-length": "40000" })).status, 413);
  // 헤더 없이(chunked 스트림) 큰 몸 → readCapped 가 32 KB 에서 멈춤
  const big = new TextEncoder().encode(JSON.stringify({ ...base, text: "가".repeat(20_000) }));
  const stream = new ReadableStream<Uint8Array>({ start(ctl) { for (let i = 0; i < big.length; i += 4096) ctl.enqueue(big.slice(i, i + 4096)); ctl.close(); } });
  assert.equal((await raw(stream)).status, 413);
  // 헤더가 작다고 거짓말해도 몸이 크면 413
  assert.equal((await raw(big, { "content-length": "10" })).status, 413);
  // 깨진 JSON · 배열 → 400, 줄 없음
  assert.equal((await raw("{nope")).status, 400);
  assert.equal((await raw("[1]")).status, 400);
  assert.equal(s.lines().length, 0);
});

test("기기 → 서버(/api/device/voice) 상한: 기기마다 1분에 받아쓴 말 60 · 넘기기 10 — 넘으면 429(한국어), op 따로 · 기기 따로 · 1분 지나면 다시", async () => {
  const s = await setup(), dv = s.device(TOK.A), base = { cid: "rid0123456789", pane: PANE };
  for (let i = 0; i < 60; i++) assert.equal((await s.call("POST", "/api/device/voice", { ...base, op: "turn", role: "user", text: `말 ${i}` }, dv)).status, 200);
  let r = await s.call("POST", "/api/device/voice", { ...base, op: "turn", role: "user", text: "61번째" }, dv);
  assert.equal(r.status, 429); assert.equal(r.j.ok, false); assert.match(r.j.text, /너무 잦아요/);
  assert.equal(s.lines().filter(l => l.text.includes("61번째")).length, 0);
  // 넘기기는 따로 셈: 10 까지 되고 11번째 429 — 창에 넣지 않음
  for (let i = 0; i < 10; i++) assert.equal((await s.call("POST", "/api/device/voice", { ...base, op: "handoff", to: "primary", text: `일 ${i}`, said: `부탁 ${i}`, n: i }, dv)).status, 200);
  const sent = s.delivered.length;
  r = await s.call("POST", "/api/device/voice", { ...base, op: "handoff", to: "primary", text: "11번째", said: "부탁", n: 10 }, dv);
  assert.equal(r.status, 429); assert.match(r.j.text, /너무 잦아요/); assert.equal(s.delivered.length, sent);
  // 다른 회원 기기는 제 몫(그 기기 판이 없어 400 이지만 429 는 아님)
  assert.equal((await s.call("POST", "/api/device/voice", { ...base, op: "turn", role: "user", text: "x" }, s.device(TOK.B))).status, 400);
  // 1분 지나면 다시 됨(옛 줄은 지워짐)
  s.db.prepare("UPDATE device_voice_hit SET at = at - 61000").run();
  assert.equal((await s.call("POST", "/api/device/voice", { ...base, op: "turn", role: "user", text: "다시" }, dv)).status, 200);
  assert.equal((s.db.prepare("SELECT count(*) n FROM device_voice_hit").get() as any).n, 1);
});

test("주인은 이 길로 안 옴: 주인 세션의 통화 요청은 회원 엔진 기기(cmd)에 하나도 안 감", async () => {
  const s = await setup(), h = await s.human(OWNER);
  await s.call("POST", "/api/voice/rtc/start", { rid: "rid0123456789", pane: "%1", sdp: OFFER }, h).catch(() => null);
  await s.call("GET", "/api/voice/rtc/poll/devAaaaaaaaa.rid0123456789", undefined, h).catch(() => null);
  await s.call("GET", "/api/voice/modes", undefined, h).catch(() => null);
  assert.equal(s.cmds.length, 0);
});

test("진짜 Engine.rtc: rtc_* 만 · 주인 하네스 기기 DO 는 거절 · 기기 답 · 오류는 답 꼴(code 그대로)", async () => {
  const { Engine } = await import("./engine.ts");
  (globalThis as any).WebSocketRequestResponsePair ??= class { constructor(public a: string, public b: string) {} };
  const mk = (who: object) => {
    const sent: any[] = [], store = new Map<string, unknown>([["who", who]]);
    const ws = { readyState: 1, deserializeAttachment: () => ({ at: 1 }), send: (m: string) => sent.push(JSON.parse(m)) };
    const ctx = { setWebSocketAutoResponse() {}, getWebSockets: () => [ws], storage: { get: async (k: string) => store.get(k) } };
    return { e: new (Engine as any)(ctx, { DB: null }), sent };
  };
  const h = mk({ device: "devOooooooo1", owner: OWNER, harness: true });
  assert.deepEqual(await h.e.rtc("rtc_start", { cid: "x" }), { ok: false, code: 1, error: "주인 하네스 기기엔 회원 통화가 없어요" });
  assert.equal(h.sent.length, 0);
  const m = mk({ device: "devAaaaaaaaa", owner: A, harness: false });
  assert.deepEqual(await m.e.rtc("open", {}), { ok: false, code: 5, error: "없는 동사" });
  let p = m.e.rtc("rtc_poll", { cid: "rid0123456789" });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual({ op: m.sent[0].op, verb: m.sent[0].verb, args: m.sent[0].args }, { op: "cmd", verb: "rtc_poll", args: { cid: "rid0123456789" } });
  await m.e.webSocketMessage(null, JSON.stringify({ id: m.sent[0].id, ok: true, result: { state: "open" } }));
  assert.deepEqual(await p, { ok: true, result: { state: "open" } });
  p = m.e.rtc("rtc_start", { cid: "rid0123456789" });
  await new Promise(r => setTimeout(r, 0));
  await m.e.webSocketMessage(null, JSON.stringify({ id: m.sent[1].id, ok: false, code: 2, error: "이 기기에선 통화를 동시에 3개까지 열어요" }));
  assert.deepEqual(await p, { ok: false, code: 2, error: "이 기기에선 통화를 동시에 3개까지 열어요" });
});

test("통화 넘기기: 고른 메인 봇 창에 줄만 선 글은 「보내는 중」 · 전문 그대로 · post", async () => {
  const s = await setup(), dv = s.device(TOK.A), KEY = "window:mbp:tmux-own:p7", T = Date.now();
  s.db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, session, handle, seen_at, gone_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(A, KEY, "devAaaaaaaaa", "window", "tmux-own", "비서실장", "/x", "idle", T, "mbp:p7", "", JSON.stringify({ engine: "tmux-own", pane: "p7" }), T, null);
  s.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ primary_item: KEY }), T);
  const r = await s.call("POST", "/api/device/voice", { cid: "rid0123456789", pane: PANE, op: "handoff", to: "primary", text: "주간 보고서 정리", said: "보고서 부탁해", n: 0 }, dv);
  assert.equal(r.j.handoff.state, "sending", r.text);
  assert.match(r.j.text, /보내는 중/);
  const row = s.db.prepare("SELECT verb, args FROM engine_cmd WHERE owner = ? AND json_extract(args, '$.item') = ?").get(A, KEY) as any, a = JSON.parse(row.args);
  assert.equal(row.verb, "send"); assert.equal(a.post, true);
  assert.match(a.text, /\nThis is|\n\(This is/, "답하는 길 한 줄이 줄바꿈 뒤에");
});
