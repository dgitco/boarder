import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const src = readFileSync(new URL("./legacy/shell.js", import.meta.url), "utf8");
const between = (a: string, b: string) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i); assert.ok(j > i, b); return src.slice(i, j); };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));   // vm 안에서 만든 배열 · 객체는 prototype 이 달라 deepEqual 전에 평평하게
const ART_ACCT = { b: "b · 회사", h: "보드" };
const inFolder = (r: { folder?: string }, f: string) => !f || r.folder === f || (r.folder || "").startsWith(f + "/");
// 서울 시각 문자열 → 초. 「N시간 전」 계산은 agoS(초)를 그대로 씀
const mkRows = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${String(i).padStart(3, "0")}`, { kind: "canvas", title: `판 ${i}`, at: `2026-11-05 ${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`, acct: i % 2 ? "b" : "h", folder: i % 3 ? "회사/디자인" : "DGit/기타", pin: i % 7 === 0 }]));
const load = (ARTS: Record<string, any>, AQ: Record<string, any> = {}, extra: Record<string, unknown> = {}) => {
  const ctx: Record<string, any> = { esc, ART_ACCT, inFolder, ARTS, AQ: { q: "", kind: "", acct: "", folder: "", ...AQ }, agoS: (s: number) => s ? `agoS(${s})` : "", I: { canvas: "<svg data-i=\"image\"></svg>" }, PC: { matches: true }, ...extra };
  runInNewContext(`${between("  const STAR =", "  function gridDraw(")}; this.api = {gridRows, gCard, gTab, gTbl, atSec};`, ctx);
  return ctx.api;
};

test("탭: 최근 = 바뀐 때 순 24개, 전체 = 전부, 고정 = pin 만", () => {
  const ARTS = mkRows(60);
  const recent = load(ARTS, { tab: "recent" }).gridRows();
  assert.equal(recent.length, 24);
  assert.ok(recent.every((r: any, i: number) => i === 0 || recent[i - 1].at >= r.at), "최근은 새 것부터");
  assert.equal(load(ARTS, { tab: "all" }).gridRows().length, 60);
  const pin = load(ARTS, { tab: "pin" }).gridRows();
  assert.ok(pin.length > 0 && pin.every((r: any) => r.pin));
  assert.equal(load(ARTS, {}).gTab(), "recent", "저장된 탭이 없으면 최근");
  assert.equal(load(ARTS, { tab: "엉뚱" }).gTab(), "recent");
});

test("계정 · 영역 · 종류 · 찾기 거르기가 탭 앞에 걸림, 내용 찾기 결과 id 도 합침", () => {
  const ARTS = { ...mkRows(10), p1: { kind: "page", title: "그냥 페이지", at: "2026-11-05 01:00", acct: "b", folder: "DGit/기타" } };
  assert.ok(load(ARTS, { tab: "all", acct: "b" }).gridRows().every((r: any) => r.acct === "b"));
  assert.ok(load(ARTS, { tab: "all", folder: "DGit" }).gridRows().every((r: any) => r.folder.startsWith("DGit")));
  assert.deepEqual(plain(load(ARTS, { tab: "all", kind: "page" }).gridRows().map((r: any) => r.id)), ["p1"]);
  assert.deepEqual(plain(load(ARTS, { tab: "all", q: "그냥" }).gridRows().map((r: any) => r.id)), ["p1"]);
  // 서버 색인이 내용으로 찾아 준 것(GQ)은 제목이 안 맞아도 보임 — 같은 낱말일 때만
  const ctx: Record<string, any> = { esc, ART_ACCT, inFolder, ARTS, AQ: { q: "본문낱말", tab: "all" }, agoS: () => "", PC: { matches: true } };
  runInNewContext(`${between("  const STAR =", "  function gridDraw(")}; GQ = {q: '본문낱말', ids: new Set(['c003'])}; this.out = gridRows().map(r => r.id);`, ctx);
  assert.deepEqual(plain(ctx.out), ["c003"]);
});

test("카드: 썸네일 16:10 그림 주소에 ?v=<at>, 별 · 메뉴 접근성 이름, 이스케이프, 캔버스만 그림", () => {
  const g = load({}, {});
  const card = g.gCard({ id: "abc", kind: "canvas", title: '위험 <b>"판"</b>', at: "2026-11-05 08:00", acct: "b", pin: false });
  assert.match(card, /<img src="\/art\/abc\/_thumb\.jpg\?v=2026-11-05%2008%3A00%7C%7C" alt="" loading="lazy"/);
  assert.ok(!card.includes("<b>\"판\"") && card.includes("&lt;b&gt;"), "제목 이스케이프");
  assert.match(card, /data-star aria-pressed="false" aria-label="고정"/);
  assert.match(card, /data-bxmo aria-haspopup="menu" aria-expanded="false" aria-label="메뉴 — /);
  assert.match(card, /<small>b · 회사 · agoS\(\d+\)<\/small>/);
  const withThumb = g.gCard({ id: "abc", kind: "canvas", title: "t", at: "2026-11-05 08:00", acct: "b", thumb: "B.dc.html" });
  assert.match(withThumb, /_thumb\.jpg\?v=2026-11-05%2008%3A00%7CB\.dc\.html%7C"/, "지정 판 이름이 그림 주소에 들어가 지정이 바뀌면 새로 받음");
  const pinned = g.gCard({ id: "abc", kind: "canvas", title: "t", at: "2026-11-05 08:00", acct: "b", pin: true });
  assert.match(pinned, /class="bx-cv-card k-canvas pin"/); assert.match(pinned, /aria-pressed="true" aria-label="고정 풀기"/);
  const page = g.gCard({ id: "p", kind: "page", title: "글", at: "2026-11-05 08:00", acct: "h" });
  assert.ok(!page.includes("<img"), "캔버스가 아니면 그림 요청 없음(404 줄이기)");
  assert.equal((card.match(/data-i="image"/g) || []).length, 2, "캔버스 아이콘은 그림(Image) 하나 — 자리 표시 + 제목 옆");
  assert.ok(!page.includes("data-i=\"image\""));
});

test("pin · thumb 칸이 서버에 아직 없어도 깨지지 않음(고정 0 · 첫 판)", () => {
  const ARTS = { a: { kind: "canvas", title: "옛 응답", at: "2026-11-05 08:00", acct: "b", folder: "DGit/기타" } };
  const g = load(ARTS, { tab: "recent" });
  assert.equal(g.gridRows().length, 1);
  assert.doesNotMatch(g.gCard(g.gridRows()[0]), /\bpin"/);
  assert.equal(load(ARTS, { tab: "pin" }).gridRows().length, 0, "고정 탭은 빈 안내");
});

test("목록 칸 at 은 서울 시각(+09:00)으로 읽음", () => {
  const g = load({}, {});
  assert.equal(g.atSec("2026-11-05 09:00"), Date.parse("2026-11-05T00:00:00Z") / 1000);
  assert.equal(g.atSec(""), 0); assert.equal(g.atSec("엉터리"), 0);
});

// 별 · 썸네일 쓰기: 바로 바꾸고(낙관), 서버가 안 받으면 되돌림
const writes = (send: (path: string, body: any) => Promise<any>, ARTS: Record<string, any>, head: () => string | null = () => "a|b|1") => {
  const log: string[] = [], draws: number[] = [], timers: Array<() => void> = [], GV: Record<string, number> = {};
  const ctx: Record<string, any> = { ARTS, gridDraw: () => draws.push(1), toast: (m: string) => log.push(m), optPost: send,
    optDo: async ({ apply, send: s, undo }: any) => { apply?.(); try { await s(); return true; } catch (e) { undo?.(e); return false; } },
    setTimeout: (f: () => void) => timers.push(f), clearTimeout: () => {}, Date, GV, window: {}, document: { addEventListener: () => {}, hidden: false },
    fetch: async () => { const h = head(); return h === null ? Promise.reject(new Error("net")) : { ok: true, headers: { get: (k: string) => (h.split("|")[["etag", "last-modified"].indexOf(k)] || null) }, blob: async () => ({ size: +h.split("|")[2] }) }; } };
  runInNewContext(`${between("  function gPin(", "  // ⋯ 메뉴")}; this.api = {gPin, gThumb, gThumbWatch};`, ctx);
  return { api: ctx.api, log, draws, timers, GV };
};

test("별: api/artstar {art,on} 로 바로 고정, 답의 pin 을 따름, 실패면 되돌림", async () => {
  const sent: any[] = [], ARTS: Record<string, any> = { a: { kind: "canvas", title: "x", pin: false } };
  const ok = writes(async (p, b) => { sent.push([p, b]); return { ok: true, pin: b.on }; }, ARTS);
  ok.api.gPin("a", true); assert.equal(ARTS.a.pin, true, "누르자마자 바뀜"); await new Promise(r => setImmediate(r));
  assert.deepEqual(plain(sent), [["api/artstar", { art: "a", on: true }]]); assert.equal(ARTS.a.pin, true); assert.ok(ok.log.includes("고정했어요"));
  const bad: Record<string, any> = { a: { kind: "canvas", title: "x", pin: false } };
  const fail = writes(async () => { throw new Error("500"); }, bad);
  fail.api.gPin("a", true); await new Promise(r => setImmediate(r)); assert.equal(bad.a.pin, false, "실패하면 되돌림");
});

test("썸네일: api/artthumb {art,board}, 되돌리기는 board ''", async () => {
  const sent: any[] = [], ARTS: Record<string, any> = { a: { kind: "canvas", title: "x", thumb: "" } };
  const w = writes(async (p, b) => { sent.push([p, b]); return { ok: true, thumb: b.board }; }, ARTS);
  w.api.gThumb("a", "B.dc.html"); await new Promise(r => setImmediate(r));
  assert.equal(ARTS.a.thumb, "B.dc.html"); w.api.gThumb("a", ""); await new Promise(r => setImmediate(r));
  assert.deepEqual(plain(sent), [["api/artthumb", { art: "a", board: "B.dc.html" }], ["api/artthumb", { art: "a", board: "" }]]); assert.equal(ARTS.a.thumb, "");
  assert.ok(w.log.some(m => m.includes("첫 판으로 되돌렸어요")));
});

test("썸네일을 바꾼 뒤 5분 동안 그림이 바뀌었나 보고, 바뀌면 그 카드만 새 주소로 다시 받고 멈춤(캔버스 안에서 지정해도 같은 길)", async () => {
  let sig = "e1|m1|10"; const ARTS: Record<string, any> = { a: { kind: "canvas", title: "x" } };
  const w = writes(async () => ({ ok: true }), ARTS, () => sig);
  await w.api.gThumbWatch("a"); const v0 = w.GV.a; assert.ok(v0 > 0, "시작하자마자 한 번 새 주소");
  assert.equal(w.timers.length, 1); sig = "e1|m1|10"; await w.timers.shift()!(); await new Promise(r => setImmediate(r));
  assert.equal(w.GV.a, v0, "그림이 그대로면 주소를 안 바꿈"); assert.equal(w.timers.length, 1, "30초 뒤 다시 봄");
  sig = "e2|m2|99"; await w.timers.shift()!(); await new Promise(r => setImmediate(r));
  assert.ok(w.GV.a >= v0 && w.GV.a !== undefined); assert.equal(w.timers.length, 0, "바뀐 것을 받으면 멈춤");
});

test("머리말을 못 읽는 응답(HEAD 실패)이면 멈추지 않고 45초마다 그냥 다시 받음", async () => {
  const ARTS: Record<string, any> = { a: { kind: "canvas", title: "x" } };
  const w = writes(async () => ({ ok: true }), ARTS, () => null);
  await w.api.gThumbWatch("a"); await w.timers.shift()!(); await new Promise(r => setImmediate(r));
  assert.equal(w.timers.length, 1, "계속 다시 봄"); assert.ok(w.draws.length >= 2);
});
