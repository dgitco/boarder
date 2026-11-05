import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
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
  const d1 = { prepare: (sql: string) => stmt(sql), async batch(sts: ReturnType<typeof stmt>[]) { n.round++; return sts.map(x => ({ results: x.rows(), success: true, meta: {} })); } };
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
  assert.match(index, /ownerRead\.respond\([^\n]*ownerMails\(c\.env, s\.user\.email\)\)/, "Worker 는 주인 메일 넷을 넘김");
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
