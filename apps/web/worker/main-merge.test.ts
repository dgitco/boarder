import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);
const OC = await import("./owner-chat.ts");
const OW = await import("./owner-write.ts");
const SCHEMA = (await import("./ledger-schema.ts")).default;
import { DatabaseSync } from "node:sqlite";
import * as OR from "./owner-read.ts";
import { uiPrefStmts } from "./ui-pref.ts";

const board = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const head = board.split("<script>").map(x => x.split("</script>")[0]).find(x => x.includes("function toPath"))!;

function hbr(opts: { on?: boolean; member?: boolean; title?: string } = {}) {
  const ls = new Map<string, string>(opts.on ? [["hb-mainmerge", "1"]] : []);
  const win: Record<string, unknown> = { localStorage: { getItem: (k: string) => ls.get(k) ?? null }, location: { hash: "", pathname: "/", search: "", origin: "https://b.x" } };
  if (opts.member) win.HB_CH = ["primary"];
  if (opts.title !== undefined) win.HB_MTITLE = () => opts.title;
  win.window = win; win.URLSearchParams = URLSearchParams;
  vm.runInNewContext(head, win);
  return win.HBR as { toPath: (h: string) => string | null; toHash: (p: string, s?: string) => string; isApp: (p: string) => boolean };
}
const TS = "1793862785.638028", MS = "1793862790.000100", ID = (1793862785638028).toString(36), MID = (1793862790000100).toString(36);

test("스위치 꺼짐 · 회원: 글 주소는 예전 /chat/<채널>/<ts> 그대로", () => {
  assert.equal(hbr().toPath(`#chat/company/${TS}`), `/chat/company/${TS}`);
  assert.equal(hbr({ on: true, member: true, title: "x" }).toPath(`#chat/primary/${TS}`), `/chat/primary/${TS}`, "회원 화면은 그대로");
});

test("스위치 켬: 글 주소 = /m/<채널 글자><ts 36진>-<첫 줄>, 되읽으면 같은 글", () => {
  const H = hbr({ on: true, title: "오늘 *회의* 정리: <https://a.b|링크> :eyes:\n둘째 줄" });
  const p = H.toPath(`#chat/company/${TS}`)!;
  assert.equal(p, `/m/n${ID}-${encodeURIComponent("오늘-회의-정리-링크")}`);
  assert.equal(H.toHash(p), `#chat/company/${TS}`);
  assert.equal(H.toHash(`/m/n${ID}-아무-제목`), `#chat/company/${TS}`, "제목이 달라도 id 로");
  assert.equal(H.toHash(`/m/n${ID}`), `#chat/company/${TS}`, "제목 없어도");
  const r = H.toPath(`#chat/dgit/${TS}/${MS}`)!;   // 스레드 속 글
  assert.ok(r.startsWith(`/m/d${ID}_${MID}-`), r);
  assert.equal(H.toHash(r), `#chat/dgit/${TS}/${MS}`);
  assert.equal(H.toPath("#chat/company"), "/chat/company", "채널 주소는 그대로");
  assert.equal(H.toPath(`#chat/harness/${TS}`), `/chat/harness/${TS}`, "기본 다섯 밖 채널은 예전 꼴");
  assert.ok(H.isApp(p));
});

test("긴 한글 제목도 주소가 Worker 경로 한도 안(인코딩 180자 이하) — 새로 고침 · 새 탭에서도 열림(리뷰)", () => {
  const H = hbr({ on: true, title: "공백없는아주긴한글제목이에요서른자를훌쩍넘어가는요청한줄입니다정말로길어요" });
  const p = H.toPath(`#chat/company/${TS}`)!;
  assert.ok(p.split("-").slice(1).join("-").length <= 180, p);
  assert.equal(H.toHash(p), `#chat/company/${TS}`);
  const re = new Function(`return ${index.match(/export const APP_PATH = (\/.*\/);/)![1]}`)() as RegExp;
  assert.ok(re.test(p), p);
});

test("주소로 받은 제목은 글을 아직 못 받았어도 주소창에 남음 · 다섯 채널 글자가 서로 다름", () => {
  const H = hbr({ on: true, title: "" });
  assert.equal(H.toHash(`/m/o${ID}-%EC%A0%9C%EB%AA%A9`), `#chat/shop/${TS}`);
  assert.equal(H.toPath(`#chat/shop/${TS}`), `/m/o${ID}-%EC%A0%9C%EB%AA%A9`);
  const ks = ["primary", "company", "personal", "dgit", "shop"].map(k => H.toPath(`#chat/${k}/${MS}`)!.slice(3, 4));
  assert.equal(new Set(ks).size, 5);
  for (const bad of ["/m/zabcdefg", "/m/n12", "/m/n" + ID + "_zz"]) assert.equal(H.toHash(bad), "", bad);
});

test("Worker: /m/… 는 보드 화면 경로 · 스위치 ui:mainmerge 는 0/1 만", () => {
  const re = new Function(`return ${index.match(/export const APP_PATH = (\/.*\/);/)![1]}`)() as RegExp;
  for (const p of [`/m/n${ID}`, `/m/n${ID}-${encodeURIComponent("오늘-회의")}`, `/m/d${ID}_${MID}-x`, `/chat/company/${TS}`]) assert.ok(re.test(p), p);
  for (const p of ["/m/", "/m/n1", `/m/n${ID}/x`]) assert.ok(!re.test(p), p);
  assert.match(index, /mainmerge: v => v === "0" \|\| v === "1"/);
});

function d1Of() {
  const db = new DatabaseSync(":memory:", { limits: { compoundSelect: 5 } });
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const n = { round: 0, sql: [] as string[], args: [] as unknown[][] };
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    rows: () => db.prepare(sql).all(...(args as never[])).map(o => ({ ...o })),
    async all() { n.round++; n.sql.push(sql); n.args.push(args); return { results: this.rows(), success: true, meta: {} }; },
    async first() { n.round++; return this.rows()[0] ?? null; },
    async run() { n.round++; db.prepare(sql).run(...(args as never[])); return { success: true, meta: {} }; },
  });
  const d1 = { prepare: (sql: string) => stmt(sql), async batch(sts: ReturnType<typeof stmt>[]) { n.round++; db.exec("BEGIN"); try { const rs = sts.map(x => ({ results: x.rows(), success: true, meta: {} })); db.exec("COMMIT"); return rs; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
  return { db, d1: d1 as unknown as D1Database, n };
}
const OWNER = "owner@x.co", ON = 1703390100, NOW = 1703400000;
const CFG: OR.Cfg = { channels: { primary: "C2", company: "C3", dgit: "C1", personal: "C4", shop: "C5" } };
function seed(db: DatabaseSync) {
  for (const [k, sc] of Object.entries(CFG.channels)) db.prepare("INSERT INTO wl_talk_chan(id, name, slack_channel) VALUES (?, ?, ?)").run(k, k, sc);
  const m = db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cli')");
  m.run("1703390001.000100", "company", null, "agent", "a", null, "켜기 전 에이전트 글", 1703390001.0001);
  m.run("1703390002.000100", "dgit", null, "owner", null, null, "켜기 전 Owner 글", 1703390002.0001);
  m.run("1703390201.000100", "company", null, "agent", "a", null, "켠 뒤 에이전트 글", 1703390201.0001);
  m.run("1703390202.000100", "personal", null, "agent", "a", null, "켠 뒤 에이전트 글", 1703390202.0001);
  m.run("1703390203.000100", "dgit", null, "owner", null, null, "켠 뒤 Owner 가 연 스레드", 1703390203.0001);
  m.run("1703390204.000100", "dgit", "1703390201.000100", "owner", null, null, "에이전트 글에 Owner 답(뿌리가 아님)", 1703390204.0001);
  m.run("1703390205.000100", "primary", null, "agent", "chief", null, "켠 뒤 primary 치프 글", 1703390205.0001);
  m.run("1703390206.000100", "shop", null, "agent", "a", null, "켠 뒤 에이전트 글", 1703390206.0001);
}
type O = { body: { messages: { ts: string; ch?: string }[] } };
const tsOf = (o: O | null) => o!.body.messages.map(x => x.ts);

test("#메인 줄기: 켠 뒤 에이전트가 연 영역 채널 글은 안 보임 · Owner 가 연 건 보임 · 켜기 전 글은 다 보임 · primary 는 전부", async () => {
  const { db, d1, n } = d1Of(); seed(db);
  db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?, 'mainmerge_at', ?, ?)").run(OWNER, String(ON * 1000), ON * 1000);
  const o = await OR.build(d1, CFG, OR.route("/api/chat/main")!, NOW, true, false, ["Owner@X.co"]) as O;
  assert.deepEqual(tsOf(o), ["1703390001.000100", "1703390002.000100", "1703390203.000100", "1703390205.000100"]);
  const r = n.round; n.round = 0;
  await OR.build(d1, CFG, OR.route("/api/chat/primary")!, NOW, true, false, [OWNER]);
  assert.equal(r, n.round, "왕복 수 = 채널 하나 읽기와 같음(켠 시각은 같은 문장 안에서)");
  const old = await OR.build(d1, CFG, OR.route("/api/chat/main?before=1703390203.000100")!, NOW, true, false, [OWNER]) as O;
  assert.deepEqual(tsOf(old), ["1703390001.000100", "1703390002.000100"], "옛 글 쪽(커서)도 같은 거름");
  const ch = await OR.build(d1, CFG, OR.route("/api/chat/company")!, NOW, true, false, [OWNER]) as O;
  assert.deepEqual(tsOf(ch), ["1703390001.000100", "1703390201.000100"], "채널 하나 보기는 거름 없음");
});

test("#메인 줄기: 켠 시각 없음 · 남의 계정 값이면 거름 없이 전부", async () => {
  const { db, d1 } = d1Of(); seed(db);
  const all = ["1703390001.000100", "1703390002.000100", "1703390201.000100", "1703390202.000100", "1703390203.000100", "1703390205.000100", "1703390206.000100"];
  assert.deepEqual(tsOf(await OR.build(d1, CFG, OR.route("/api/chat/main")!, NOW, true, false, [OWNER]) as O), all, "켠 시각 없음");
  db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES ('member@x.co', 'mainmerge_at', '1', ?)").run(ON * 1000);
  assert.deepEqual(tsOf(await OR.build(d1, CFG, OR.route("/api/chat/main")!, NOW, true, false, [OWNER]) as O), all, "다른 계정 값은 안 씀");
});

test("#메인 줄기: 주인 메일 넷 중 가장 이른 켠 시각 — 어느 메일로 열어도 같은 줄기", async () => {
  const { db, d1 } = d1Of(); seed(db);
  const p = db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?, 'mainmerge_at', ?, ?)");
  p.run("b2@x.co", String((ON + 150) * 1000), (ON + 150) * 1000); p.run(OWNER, String(ON * 1000), ON * 1000);
  const want = ["1703390001.000100", "1703390002.000100", "1703390203.000100", "1703390205.000100"];
  for (const ms of [[OWNER, "b2@x.co"], ["b2@x.co", OWNER, "b3@x.co"]]) assert.deepEqual(tsOf(await OR.build(d1, CFG, OR.route("/api/chat/main")!, NOW, true, false, ms) as O), want, ms.join());
  assert.match(index, /ownerRead\.respond\([^\n]*ownerMails\(c\.env, s\.user\.email\)[,)]/, "Worker 는 주인 메일 넷을 넘김");
});

test("설정 쓰기(화면 · 기기 CLI 같은 길 uiPrefStmts): 같은 값이면 at 그대로 · 껐다 켜도 #메인 처음 켠 시각 그대로", async () => {
  const { db, d1 } = d1Of(); seed(db);
  const put = (k: string, v: string, at: number) => d1.batch(uiPrefStmts(d1, OWNER, [[k, v]], at) as never);
  const at = (k: string) => (db.prepare("SELECT at FROM user_pref WHERE owner = ? AND k = ?").get(OWNER, k) as { at: number } | undefined)?.at;
  await put("theme", "dark", 1000); await put("theme", "dark", 2000); assert.equal(at("ui:theme"), 1000);
  await put("theme", "light", 3000); assert.equal(at("ui:theme"), 3000);
  await put("mainmerge", "0", 500); assert.equal(at("mainmerge_at"), undefined, "끈 채로는 안 적힘");
  await put("mainmerge", "1", ON * 1000); await put("mainmerge", "0", ON * 1000 + 50_000); await put("mainmerge", "1", ON * 1000 + 99_000);
  assert.equal(at("mainmerge_at"), ON * 1000, "처음 켠 시각");
  assert.deepEqual(tsOf(await OR.build(d1, CFG, OR.route("/api/chat/main")!, NOW, true, false, [OWNER]) as O), ["1703390001.000100", "1703390002.000100", "1703390203.000100", "1703390205.000100"]);
  assert.match(index, /uiPrefStmts\(c\.env\.DB, s\.user\.email\.toLowerCase\(\), \[\[key, val\]\]/, "화면 길(POST /api/me/ui)도 같은 함수");
});

test("#메인 줄기 실행 계획: 영역 채널 두 조각이 색인을 씀(켠 뒤 Owner 글 = wl_talk_msg_who, 켜기 전 = wl_talk_msg_chan) · 통째로 훑지 않음", async () => {
  const { db, d1, n } = d1Of(); seed(db);
  db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?, 'mainmerge_at', ?, ?)").run(OWNER, String(ON * 1000), ON * 1000);
  const m = db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, ?, NULL, 'agent', 'a', NULL, 'x', ?, 'cli')");
  for (let i = 0; i < 300; i++) m.run(`1703391${String(i).padStart(3, "0")}.000100`, "company", 1703391000 + i);   // 켠 뒤 에이전트 글 300개
  db.exec("ANALYZE");
  const o = await OR.build(d1, CFG, OR.route("/api/chat/main")!, NOW, true, false, [OWNER]) as O;
  assert.ok(!tsOf(o).some(t => t.startsWith("1703391")), "켠 뒤 에이전트 글은 안 옴");
  const plan = db.prepare("EXPLAIN QUERY PLAN " + n.sql[0]).all(...(n.args[0] as never[])).map(r => String((r as { detail: string }).detail));
  const ms = plan.filter(d => / m /.test(d + " ") || /^(SCAN|SEARCH) m\b/.test(d));
  assert.ok(ms.length >= 9, plan.join("\n"));   // primary 하나 + 영역 넷 × 두 조각
  for (const d of ms) assert.match(d, /^SEARCH m USING (COVERING )?INDEX wl_talk_msg_(chan|who) /, d);
  assert.equal(ms.filter(d => /wl_talk_msg_who \(chan=\? AND thread=\? AND who=\? AND at>\?\)/.test(d)).length, 4, plan.join("\n"));
});

const AG: OR.Cfg = { channels: { ...CFG.channels, harness: "C9", ops_bot: "C10" } };
function seedAgents(db: DatabaseSync) {
  seed(db);
  for (const [k, sc] of [["harness", "C9"], ["ops_bot", "C10"]]) db.prepare("INSERT INTO wl_talk_chan(id, name, slack_channel) VALUES (?, ?, ?)").run(k, k, sc);
  const m = db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cli')");
  m.run("1703390003.000100", "harness", null, "agent", "lead", null, "켜기 전 에이전트 채널 에이전트 글", 1703390003.0001);
  m.run("1703390004.000100", "harness", null, "owner", null, null, "켜기 전 에이전트 채널 Owner 글", 1703390004.0001);
  m.run("1703390207.000100", "harness", null, "agent", "lead", null, "켠 뒤 에이전트 채널 에이전트 글", 1703390207.0001);
  m.run("1703390208.000100", "harness", null, "owner", null, null, "켠 뒤 에이전트 채널 Owner 글", 1703390208.0001);
  m.run("1703390209.000100", "harness", "1703390207.000100", "owner", null, null, "에이전트 뿌리에 Owner 답(뿌리가 아님)", 1703390209.0001);
  m.run("1703390210.000100", "ops_bot", null, "agent", "bot", null, "다른 에이전트 채널 에이전트 글", 1703390210.0001);
  m.run("1703390211.000100", "ops_bot", null, "owner", null, null, "다른 에이전트 채널 Owner 글", 1703390211.0001);
}

test("#메인 줄기 · 에이전트 채널: Owner 뿌리는 보임(켜기 전 · 뒤 모두) · 에이전트 뿌리 · 답글은 안 보임 · ch = 그 채널", async () => {
  for (const on of [true, false]) {
    const { db, d1, n } = d1Of(); seedAgents(db);
    if (on) db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?, 'mainmerge_at', ?, ?)").run(OWNER, String(ON * 1000), ON * 1000);
    const o = await OR.build(d1, AG, OR.route("/api/chat/main")!, NOW, true, false, [OWNER]) as O;
    const ag = o.body.messages.filter(x => x.ch === "harness" || x.ch === "ops_bot").map(x => [x.ts, x.ch]);
    assert.deepEqual(ag, [["1703390004.000100", "harness"], ["1703390208.000100", "harness"], ["1703390211.000100", "ops_bot"]], on ? "켬" : "켠 시각 없음");
    const r = n.round; n.round = 0;
    await OR.build(d1, AG, OR.route("/api/chat/primary")!, NOW, true, false, [OWNER]);
    assert.equal(r, n.round, "왕복 수 = 채널 하나 읽기와 같음");
    const h = await OR.build(d1, AG, OR.route("/api/chat/harness")!, NOW, true, false, [OWNER]) as O;
    assert.deepEqual(tsOf(h), ["1703390003.000100", "1703390004.000100", "1703390207.000100", "1703390208.000100"], "에이전트 채널 하나 보기는 거름 없음 · ch 없음");
    assert.ok(h.body.messages.every(x => x.ch === undefined));
  }
  const { db, d1 } = d1Of(); seedAgents(db);
  const old = await OR.build(d1, AG, OR.route("/api/chat/main?before=1703390208.000100")!, NOW, true, false, [OWNER]) as O;
  assert.ok(tsOf(old).includes("1703390004.000100") && !tsOf(old).includes("1703390208.000100") && !tsOf(old).includes("1703390003.000100"), "옛 글 쪽(커서)도 같은 거름");
});

test("#메인 줄기 · 에이전트 채널 실행 계획: Owner 뿌리 조각이 wl_talk_msg_who 를 탐 · 채널마다 101줄까지 · 묶는 값은 조각마다 하나", async () => {
  const { db, d1, n } = d1Of(); seedAgents(db);
  db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?, 'mainmerge_at', ?, ?)").run(OWNER, String(ON * 1000), ON * 1000);
  const m = db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, ?, NULL, ?, NULL, NULL, 'x', ?, 'cli')");
  for (let i = 0; i < 300; i++) m.run(`1703392${String(i).padStart(3, "0")}.000100`, "harness", "agent", 1703392000 + i);   // 에이전트 글 300개
  for (let i = 0; i < 150; i++) m.run(`1703393${String(i).padStart(3, "0")}.000100`, "ops_bot", "owner", 1703393000 + i);
  db.exec("ANALYZE");
  const o = await OR.build(d1, AG, OR.route("/api/chat/main?before=1703399999.000100")!, NOW, true, false, [OWNER]) as O;
  assert.ok(!tsOf(o).some(t => t.startsWith("1703392")), "에이전트 뿌리는 안 옴");
  assert.equal(o.body.messages.filter(x => x.ch === "ops_bot").length, 100, "한 쪽 100 · 채널 조각 101줄 상한");
  const plan = db.prepare("EXPLAIN QUERY PLAN " + n.sql[0]).all(...(n.args[0] as never[])).map(r => String((r as { detail: string }).detail));
  const ms = plan.filter(d => /^(SCAN|SEARCH) m\b/.test(d));
  assert.equal(ms.length, 11, plan.join("\n"));   // primary 하나 + 영역 넷 × 두 조각 + 에이전트 채널 둘
  for (const d of ms) assert.match(d, /^SEARCH m USING (COVERING )?INDEX wl_talk_msg_(chan|who) /, d);
  assert.equal(ms.filter(d => /wl_talk_msg_who \(chan=\? AND thread=\? AND who=\?/.test(d)).length, 6, plan.join("\n"));   // 영역 넷 켠 뒤 + 에이전트 둘
  assert.equal(n.args[0].length, 1 + 3 + 11, "묶는 값: 주인 메일 · 커서 셋 · 조각마다 채널 하나(D1 100개 상한)");
  assert.equal((n.sql[0].match(/LIMIT 101/g) || []).length, 12, "조각마다 101 + 바깥 101");
});

test("화면: 에이전트 채널 글의 영역 글자 = 그 채널 이름 첫 글자(기본 다섯 글자는 그대로)", () => {
  assert.match(board, /for \(const a of AGENT_CH\) MAIN_ONE\[a\.key\] \?\?= \[\.\.\.String\(a\.name\)\.trim\(\)\]\[0\]/);
  assert.ok(board.indexOf("const AGENT_CH =") < board.indexOf("MAIN_ONE[a.key]"), "AGENT_CH 가 먼저 정해짐");
});

test("노드 창에 넘긴 Owner 뿌리 글(카드 집 = 노드)은 그 채널 · #메인에 그대로, 넘긴 에이전트 카드 · 노드 채널에서 쓴 글은 예전처럼 뺌", async () => {
  const { db, d1 } = d1Of(); seed(db);
  const m = db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cli')");
  m.run("1703390301.000100", "primary", null, "owner", null, null, "Owner 가 쓰고 총괄이 노드에 넘긴 글", 1703390301.0001);
  db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source, ref) VALUES (?, 'primary', ?, 'agent', 'chief', NULL, '→ #보더 최적화로 옮김', ?, 'node-move', ?)").run("1703390301.500100", "1703390301.000100", 1703390301.5, "1703390301.000100");   // move_root 전달 상자(원글 스레드 안)
  m.run("1703390302.000100", "primary", null, "agent", "chief", null, "노드 일 카드(에이전트)", 1703390302.0001);
  m.run("1703390303.000100", "primary", null, "owner", null, null, "노드 채널에서 Owner 가 쓴 글", 1703390303.0001);
  const h = db.prepare("INSERT INTO wl_card_home(ts, chan, node, at) VALUES (?, 'primary', ?, ?)");
  h.run("1703390301.000100", "보더 최적화", 1703390301000); h.run("1703390302.000100", "보더 최적화", 1703390302000); h.run("1703390303.000100", "보더 최적화", 1703390303000);
  const cfg: OR.Cfg = { ...CFG, node_topics: { "보더 최적화": [{ ts: "1703390303.000100" }] } } as OR.Cfg;
  for (const path of ["/api/chat/primary", "/api/chat/main"]) {
    const ts = tsOf(await OR.build(d1, cfg, OR.route(path)!, NOW, false, false, [OWNER]) as O);
    assert.ok(ts.includes("1703390301.000100"), path + " Owner 가 쓴 넘긴 글 보임");
    assert.ok(!ts.includes("1703390302.000100"), path + " 에이전트 노드 카드는 안 보임");
    assert.ok(!ts.includes("1703390303.000100"), path + " 노드 채널에서 쓴 글은 안 보임");
  }
});

test("노드 채널에서 쓴 Owner 뿌리(받은 판 pane 있음)는 node_topics 최근 20개에서 밀려나고 카드 집이 있어도 안 보임", async () => {
  const { db, d1 } = d1Of(); seed(db);
  db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, 'primary', NULL, 'owner', NULL, '%777', '노드 채널에서 쓴 옛 글', ?, 'boarder')").run("1703390401.000100", 1703390401.0001);
  db.prepare("INSERT INTO wl_card_home(ts, chan, node, at) VALUES (?, 'primary', '보더 최적화', ?)").run("1703390401.000100", 1703390402);
  const cfg: OR.Cfg = { ...CFG, node_topics: { "보더 최적화": Array.from({ length: 20 }, (_, i) => ({ ts: `1703390${500 + i}.000100` })) } } as OR.Cfg;
  for (const path of ["/api/chat/primary", "/api/chat/main"]) assert.ok(!tsOf(await OR.build(d1, cfg, OR.route(path)!, NOW, false, false, [OWNER]) as O).includes("1703390401.000100"), path);
});

test("받은 판이 빈 노드 글(넣기 전 · 실패 · @멘션 · 갈래)도 전달 상자가 없으면 안 보임 — 넘김 판정은 상자로만", async () => {
  const { db, d1 } = d1Of(); seed(db);
  db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, pane, text, at, source) VALUES (?, 'primary', NULL, 'owner', NULL, NULL, '노드에서 @멘션으로 연 글', ?, 'boarder')").run("1703390601.000100", 1703390601.0001);
  db.prepare("INSERT INTO wl_card_home(ts, chan, node, at) VALUES (?, 'primary', '보더 최적화', ?)").run("1703390601.000100", 1703390602);
  for (const path of ["/api/chat/primary", "/api/chat/main"]) assert.ok(!tsOf(await OR.build(d1, CFG, OR.route(path)!, NOW, false, false, [OWNER]) as O).includes("1703390601.000100"), path);
});

type OriginFixture = { messages: Record<string, any>[]; homes: Record<string, any>[]; posted: string[]; boxes: string[]; node_topics: OR.Cfg["node_topics"] };
function pythonOrigin(modes: object[], rows?: object): OriginFixture {
  const r = spawnSync("python3", [new URL("../../../harness/engine/board/node_origin_fixture.py", import.meta.url).pathname], {
    input: JSON.stringify(modes), encoding: "utf8", env: { ...process.env, TMUX_PANE: "", ...(rows ? { NODE_ORIGIN_ROWS: JSON.stringify(rows) } : {}) },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}
function loadOrigin(db: DatabaseSync, f: OriginFixture) {
  for (const m of f.messages) db.prepare(`INSERT INTO wl_talk_msg(${Object.keys(m).join(",")}) VALUES (${Object.keys(m).map(() => "?").join(",")})`).run(...(Object.values(m) as never[]));
  for (const h of f.homes) db.prepare("INSERT INTO wl_card_home(ts,chan,pane,node,at) VALUES (:ts,:chan,:pane,:node,:at)").run(h);
}
test("Worker: 노드 집 쓰기 실패는 원글·rid·할 일도 함께 되돌림", async () => {
  const { db, d1 } = d1Of(); seed(db);
  db.prepare("INSERT INTO owner_job_beat(id,at) VALUES (1,?)").run(NOW * 1000);
  db.exec("CREATE TRIGGER origin_fail BEFORE INSERT ON wl_card_home BEGIN SELECT RAISE(ABORT,'origin test'); END");
  const p = OC.plain({ rid: "origin-fail-001", channel: "primary", text: "글", pane: "%777" }, ["primary"], [], { "%777": "원래 노드" })!;
  await assert.rejects(OC.write(d1, p, NOW * 1000), /origin test/);
  assert.equal(db.prepare("SELECT count(*) n FROM wl_talk_msg WHERE text='글'").get()!.n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM owner_job").get()!.n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM f7_rid").get()!.n, 0);
});
test("전달 상자 일반 삭제 뒤에도 DM 원글 보임 · 뿌리 상자는 전달 카드로 남음(리뷰 3차 대조군)", async () => {
  for (const rootBox of [false, true]) {
    const { db, d1 } = d1Of(); seed(db);
    const ts = "1703390801.000100", box = "1703390802.000100";
    db.prepare("INSERT INTO wl_talk_msg(id,chan,who,text,at,source) VALUES (?,'primary','owner','DM 글',?,'boarder')").run(ts, 1703390801);
    db.prepare("INSERT INTO wl_card_home(ts,chan,node,at) VALUES (?,'primary','원래 노드',?)").run(ts, 1703390801);
    db.prepare("INSERT INTO wl_talk_msg(id,chan,thread,who,text,at,source,ref,deleted_at) VALUES (?,'primary',?,'agent','전달',?,'node-move',?,?)").run(box, rootBox ? null : ts, 1703390802, ts, rootBox ? null : 1703390803);
    for (const path of ["/api/chat/primary", "/api/chat/main"]) {
      const out = await OR.build(d1, CFG, OR.route(path)!, NOW, false, false, [OWNER]) as O;
      assert.ok(tsOf(out).includes(rootBox ? box : ts), path);
    }
  }
});


