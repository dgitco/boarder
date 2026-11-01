// node --test --no-warnings --experimental-transform-types apps/web/worker/ea-secret.test.ts
// 비서(/ea) 비밀값 넣기 · 허락(legacy/ea-secret.js): 새 의존성 없이 — 스크립트가 쓰는 만큼만 흉내 낸 작은 DOM 위에서 node:vm 으로 돌림.
//   404 = 띠 없음 · pending 수 = 띠 글 · put 몸통 꼴 · 보낸 뒤 입력칸 비고 DOM 어디에도 값 글자 없음 · allow 몸통 · 보드 fetch 감싸기(shell.js)가 api/secret 몸통을 안 봄
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("./legacy/ea-secret.js", import.meta.url), "utf8");
const SHELL = readFileSync(new URL("./legacy/shell.js", import.meta.url), "utf8");
const SECRET = "4111-SECRET-9876";   // 지어낸 값 — DOM 에 남는지 찾는 표지

// ── 작은 DOM: createElement · append · remove · textContent · innerHTML(글 그대로) · 속성 · classList · 사건(거품)
type L = (e: any) => void;
class Node0 {
  parent: El | null = null;
  get isConnected(): boolean { let n: Node0 | null = this; while (n) { if (n === DOC.body || n === DOC.documentElement) return true; n = n.parent; } return false; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }
}
class Text extends Node0 { constructor(public data: string) { super(); } }
class Raw extends Node0 { constructor(public html: string) { super(); } }
let DOC: any, ACTIVE: any = null;
class El extends Node0 {
  children: Node0[] = []; attrs = new Map<string, string>(); ls = new Map<string, L[]>(); props: Record<string, unknown> = {};
  hidden = false; disabled = false; type = ""; name = ""; id = ""; value = ""; inputMode = ""; spellcheck = true;
  constructor(public tag: string) { super(); }
  get className() { return this.attrs.get("class") || ""; }
  set className(v: string) { this.attrs.set("class", v); }
  get classList() {
    const get = () => new Set(this.className.split(/\s+/).filter(Boolean)), set = (s: Set<string>) => { this.className = [...s].join(" "); };
    return { add: (...c: string[]) => { const s = get(); c.forEach(x => s.add(x)); set(s); }, remove: (...c: string[]) => { const s = get(); c.forEach(x => s.delete(x)); set(s); },
      contains: (c: string) => get().has(c), toggle: (c: string, f?: boolean) => { const s = get(), on = f ?? !s.has(c); on ? s.add(c) : s.delete(c); set(s); return on; } };
  }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  append(...ns: (Node0 | string)[]) { for (let n of ns) { if (typeof n === "string") n = new Text(n); n.remove(); n.parent = this; this.children.push(n); } }
  replaceChildren(...ns: Node0[]) { for (const c of this.children) c.parent = null; this.children = []; this.append(...ns); }
  set textContent(v: string) { this.replaceChildren(new Text(String(v))); }
  get textContent(): string { return this.children.map(c => c instanceof Text ? c.data : c instanceof El ? c.textContent : "").join(""); }
  set innerHTML(v: string) { this.replaceChildren(new Raw(String(v))); }
  addEventListener(t: string, f: L) { (this.ls.get(t) || this.ls.set(t, []).get(t)!).push(f); }
  dispatch(type: string, extra: Record<string, unknown> = {}) {
    const e = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (let n: El | null = this; n; n = n.parent) for (const f of n.ls.get(type) || []) f(e);
    return e;
  }
  click() { if (!this.disabled) this.dispatch("click"); }
  focus() { ACTIVE = this; }
  get dataset() { return {}; }
}
const walk = function* (n: Node0): Generator<Node0> { yield n; if (n instanceof El) for (const c of n.children) yield* walk(c); };
const els = (root: El) => [...walk(root)].filter((n): n is El => n instanceof El);
const byClass = (root: El, c: string) => els(root).filter(e => e.classList.contains(c));
const one = (root: El, c: string) => { const a = byClass(root, c); assert.equal(a.length, 1, `.${c} 하나`); return a[0]; };
const shown = (e: El) => { for (let n: El | null = e; n; n = n.parent) if (n.hidden) return false; return e.isConnected; };
// 문서 전체를 글로(속성 · 글 · 입력 값 · 그 밖 속성 값까지) — 값 글자가 남았는지 찾음
const dump = (root: El) => [...walk(root)].map(n => n instanceof Text ? n.data : n instanceof Raw ? n.html : n instanceof El ? `<${n.tag} ${[...n.attrs].map(([k, v]) => `${k}=${v}`).join(" ")} value=${n.value} name=${n.name} ${JSON.stringify(n.props)}>` : "").join("\n");

type Call = { url: string; init: any };
function setup(answer: (url: string, init: any) => Response | Promise<Response>) {
  const html = new El("html"), body = new El("body"); html.append(body); html.classList.add("bx-ea");
  const docLs = new Map<string, L[]>(), winLs = new Map<string, L[]>();
  const timers: { f: () => void; at: number }[] = [];
  const calls: Call[] = [], logs: unknown[] = [];
  const store = new Map<string, string>();
  DOC = { documentElement: html, body, hidden: false, get activeElement() { return ACTIVE; },
    createElement: (t: string) => new El(t), createTextNode: (s: string) => new Text(s),
    addEventListener: (t: string, f: L) => { (docLs.get(t) || docLs.set(t, []).get(t)!).push(f); } };
  ACTIVE = null;
  const fire = (m: Map<string, L[]>, e: any) => { for (const f of m.get(e.type) || []) f(e); };
  const win: any = {
    BX_EA: 1, document: DOC, Event: class { constructor(public type: string) {} },
    fetch: async (url: string, init: any) => { calls.push({ url, init }); return answer(url, init); },
    setTimeout: (f: () => void, ms: number) => { timers.push({ f, at: ms }); return timers.length; }, clearTimeout: () => {},
    addEventListener: (t: string, f: L) => { (winLs.get(t) || winLs.set(t, []).get(t)!).push(f); },
    dispatchEvent: (e: any) => fire(winLs, e),
    console: { log: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a), error: (...a: unknown[]) => logs.push(a), info: (...a: unknown[]) => logs.push(a), debug: (...a: unknown[]) => logs.push(a) },
    localStorage: { setItem: (k: string, v: string) => store.set("l:" + k, v), getItem: () => null }, sessionStorage: { setItem: (k: string, v: string) => store.set("s:" + k, v), getItem: () => null },
    posthog: { capture: (...a: unknown[]) => logs.push(["ph", a]) },
    JSON, Math, Date, Promise, Array, Set, Object, String, Response,
  };
  win.window = win;
  vm.runInNewContext(SRC, win);
  const flush = () => new Promise(r => setImmediate(r));
  const settle = async () => { for (let i = 0; i < 8; i++) await flush(); };
  return { win, html, body, calls, logs, store, timers, settle, key: (key: string, extra = {}) => fire(docLs, { type: "keydown", key, preventDefault() {}, ...extra }) };
}
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const PENDING = {
  requests: [{ id: "r1", label: "법인 카드 번호", kind: "card", why: "도메인 갱신 결제", agent: "company", at: "2026-11-01T00:00:00Z" },
    { id: "r2", label: "대표 휴대폰", kind: "phone", why: "본인 확인", agent: "알 수 없는 봇", at: "2026-11-01T00:00:00Z" }],
  uses: [{ id: "u1", secret: "s1", label: "법인 카드 번호", agent: "dgit", site: "example.test", why: "서버 요금", at: "2026-11-01T00:00:00Z" }],
};

test("pending 404 · 401 · 망 실패 = 띠 없음 · 자물쇠 없음, 5분 뒤 다시", async () => {
  for (const ans of [() => J({ error: "nf" }, 404), () => J({ error: "로그인" }, 401), () => { throw new TypeError("network"); }]) {
    const t = setup(ans as any); await t.settle();
    const band = one(t.body, "bx-es-band");
    assert.equal(shown(band), false, "띠 숨김");
    assert.equal(t.html.classList.contains("bx-es-on"), false);
    assert.deepEqual([...t.win.BX_EA_LOCK], []);
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].url, "/api/secret/pending");
    assert.equal(t.calls[0].init.credentials, "same-origin");
    assert.deepEqual(t.timers.map(x => x.at), [300000], "5분 뒤 한 번 다시");
    band.click(); await t.settle();
    assert.equal(t.win.BX_EA_SECRET.state().open, false, "꺼진 채로는 시트도 안 뜸");
  }
});

test("pending 있으면 띠 수 · 자물쇠 에이전트 · 20초 다시 · 0 이면 그 조각 없음", async () => {
  const t = setup(() => J(PENDING)); await t.settle();
  const band = one(t.body, "bx-es-band");
  assert.equal(shown(band), true);
  assert.equal(band.textContent, "넣어 달라는 값 2 · 허락 기다림 1");
  assert.deepEqual([...t.win.BX_EA_LOCK].sort(), ["dgit", "company", "알 수 없는 봇"].sort());
  assert.deepEqual(t.timers.map(x => x.at), [20000]);
  const t2 = setup(() => J({ requests: [], uses: PENDING.uses })); await t2.settle();
  assert.equal(one(t2.body, "bx-es-band").textContent, "허락 기다림 1");
  const t3 = setup(() => J({ requests: [], uses: [] })); await t3.settle();
  assert.equal(shown(one(t3.body, "bx-es-band")), false, "둘 다 0 = 띠 없음");
});

test("넣기: 입력칸 꼴 · put 몸통(request · value · keep · use) · 보낸 뒤 칸 비고 DOM · 기록 어디에도 값 없음", async () => {
  let putBody: any = null, putInit: any = null;
  const t = setup((url, init) => {
    if (url === "/api/secret/put") { putInit = init; putBody = JSON.parse(init.body); return J({ ok: true }); }
    return J(PENDING);
  });
  await t.settle();
  one(t.body, "bx-es-band").click();
  const cards = byClass(t.body, "bx-es-card");
  assert.equal(cards.length, 3, "요청 2 · 허락 1 카드");
  cards[0].click();
  const inp = one(t.body, "bx-es-in");
  assert.equal(inp.type, "password");
  assert.equal(inp.getAttribute("autocomplete"), "off");
  assert.equal(inp.getAttribute("autocorrect"), "off");
  assert.equal(inp.spellcheck, false);
  assert.equal(inp.inputMode, "numeric", "card = numeric");
  assert.match(inp.name, /^f[a-z0-9]{8,}/, "무작위 name");
  const go = one(t.body, "bx-es-go");
  assert.equal(go.disabled, true, "값이 비면 꺼짐");
  // 「저장」 → 「에이전트가 알아서」
  const segs = byClass(t.body, "bx-es-sg");
  assert.deepEqual(segs.map(s => s.textContent), ["한 번만 쓰고 버림", "저장", "쓸 때마다 허락", "에이전트가 알아서"]);
  assert.equal(segs[0].getAttribute("aria-checked"), "true", "기본 한 번만");
  assert.equal(shown(segs[2]), false, "한 번만이면 쓸 때 고르기 숨김");
  segs[1].click(); assert.equal(shown(segs[2]), true); assert.equal(segs[2].getAttribute("aria-checked"), "true", "기본 쓸 때마다 허락");
  segs[3].click();
  inp.value = SECRET; inp.dispatch("input");
  assert.equal(go.disabled, false);
  go.click();
  assert.ok(byClass(go, "bx-es-spin").length === 1 && !go.textContent.includes("중"), "보내는 동안 스피너(「…중」 글 없음)");
  await t.settle();
  assert.deepEqual(putBody, { request: "r1", value: SECRET, keep: "save", use: "auto" });
  assert.equal(putInit.method, "POST");
  assert.equal(putInit.credentials, "same-origin");
  assert.equal(putInit.headers["content-type"], "application/json");
  assert.equal(putInit.headers["x-hb"], "1");
  assert.equal(inp.value, "", "입력칸 비움");
  assert.equal(inp.isConnected, false, "입력칸 요소를 뗌");
  assert.ok(!dump(t.html).includes(SECRET), "DOM 어디에도 값 글자 없음");
  assert.ok(!JSON.stringify(t.logs).includes(SECRET) && t.logs.length === 0, "console · posthog 없음");
  assert.equal(t.store.size, 0, "localStorage · sessionStorage 안 씀");
  assert.equal(one(t.body, "bx-es-done").textContent, "넣었어요");
  assert.equal(one(t.body, "bx-es-band").textContent, "넣어 달라는 값 1 · 허락 기다림 1");
  // 「넣었어요」 뒤 목록
  t.timers.filter(x => x.at === 1200).forEach(x => x.f());
  assert.equal(t.win.BX_EA_SECRET.state().view, "list");
});

test("넣기 실패: 「일시적인 오류가 발생했어요」 한 줄 · 값은 칸에 그대로 · 오류 글에 몸통 없음 · 닫으면 칸 비움", async () => {
  const t = setup((url) => url === "/api/secret/put" ? J({ error: "x" }, 500) : J(PENDING));
  await t.settle();
  one(t.body, "bx-es-band").click();
  byClass(t.body, "bx-es-card")[1].click();
  const inp = one(t.body, "bx-es-in");
  assert.equal(inp.inputMode, "numeric", "phone = numeric");
  inp.value = SECRET; inp.dispatch("input");
  one(t.body, "bx-es-go").click(); await t.settle();
  const err = one(t.body, "bx-es-err");
  assert.equal(shown(err), true);
  assert.equal(err.textContent, "일시적인 오류가 발생했어요");
  assert.equal(inp.value, SECRET, "다시 시도할 수 있게 그대로");
  assert.equal(one(t.body, "bx-es-go").disabled, false);
  const d = dump(t.html).replace(`value=${SECRET}`, "");
  assert.ok(!d.includes(SECRET), "입력칸 value 말고는 값 글자 없음");
  t.key("Escape");
  assert.equal(t.win.BX_EA_SECRET.state().open, false, "Esc 로 닫음");
  assert.equal(inp.value, "");
  assert.ok(!dump(t.html).includes(SECRET));
});

test("허락 · 거절: allow 몸통 · 끝나면 목록 · 바깥 누르면 닫힘 · 포커스 가둠", async () => {
  const bodies: any[] = [];
  const t = setup((url, init) => { if (url === "/api/secret/allow") { bodies.push({ b: JSON.parse(init.body), h: init.headers, c: init.credentials }); return J({ ok: true }); } return J(PENDING); });
  await t.settle();
  one(t.body, "bx-es-band").click();
  byClass(t.body, "bx-es-card")[2].click();
  assert.equal(one(t.body, "bx-es-who").textContent, "example.test 에 넣으려 해요 · dgit");
  assert.equal(one(t.body, "bx-es-title").textContent, "법인 카드 번호");
  // 포커스 가둠: Tab 이 시트 밖으로 안 나감
  const seen = new Set<unknown>();
  for (let i = 0; i < 8; i++) { t.key("Tab"); seen.add(ACTIVE); }
  for (const e of seen) { let n: any = e, inside = false; while (n) { if (n.classList?.contains("bx-es-sheet")) inside = true; n = n.parent; } assert.ok(inside, "Tab 은 시트 안에서만"); }
  one(t.body, "bx-es-go").click(); await t.settle();
  assert.deepEqual(bodies[0].b, { use: "u1", ok: true });
  assert.equal(bodies[0].h["x-hb"], "1"); assert.equal(bodies[0].h["content-type"], "application/json"); assert.equal(bodies[0].c, "same-origin");
  assert.equal(t.win.BX_EA_SECRET.state().view, "list");
  assert.equal(one(t.body, "bx-es-band").textContent, "넣어 달라는 값 2");
  // 거절
  const t2 = setup((url, init) => { if (url === "/api/secret/allow") { bodies.push({ b: JSON.parse(init.body) }); return J({ ok: true }); } return J(PENDING); });
  await t2.settle();
  one(t2.body, "bx-es-band").click();
  byClass(t2.body, "bx-es-card")[2].click();
  one(t2.body, "bx-es-ghost").click(); await t2.settle();
  assert.deepEqual(bodies[1].b, { use: "u1", ok: false });
  // 바깥(scrim) 누름 = 닫힘, 시트 안 누름은 그대로
  one(t2.body, "bx-es-sheet").dispatch("click");
  assert.equal(t2.win.BX_EA_SECRET.state().open, true);
  one(t2.body, "bx-es-scrim").dispatch("click");
  assert.equal(t2.win.BX_EA_SECRET.state().open, false);
});

test("BX_EA 아님 = 아무것도 안 만듦 · 안 부름", async () => {
  const t = setup(() => J(PENDING));
  const html = new El("html"), body = new El("body"); html.append(body);
  const calls: string[] = [];
  DOC = { documentElement: html, body, createElement: (x: string) => new El(x), addEventListener() {} };
  vm.runInNewContext(SRC, { window: { fetch: (u: string) => { calls.push(u); } }, document: DOC });
  assert.equal(body.children.length, 0); assert.deepEqual(calls, []);
  void t;
});

test("보드 fetch 감싸기(shell.js)는 api/secret 몸통을 안 봄 — 재기 래퍼 · 보낼 글 쌓기 길에 안 걸림", () => {
  // 재기 래퍼: POST 몸통을 JSON 으로 읽는 건 api/chat 만
  const perf = SHELL.match(/if \(m === 'POST' && (\/.*?\/)\.test\(s\)\)/);
  assert.ok(perf, "shell.js 재기 래퍼 꼴이 바뀜 — 이 시험을 같이 고칠 것");
  const q = SHELL.match(/Q = (\/\(\^\|\\\/\)api\\\/\(chat\|[^/]*\)\$\/)/);
  assert.ok(q, "shell.js 보낼 글 쌓기 Q 꼴이 바뀜 — 이 시험을 같이 고칠 것");
  const re = (s: string) => { const m = s.match(/^\/(.*)\/([a-z]*)$/)!; return new RegExp(m[1], m[2]); };
  const SRCURLS = [...SRC.matchAll(/'(\/api\/secret\/[a-z]+)'/g)].map(m => m[1]);
  assert.deepEqual(SRCURLS.sort(), ["/api/secret/allow", "/api/secret/pending", "/api/secret/put"]);
  for (const u of SRCURLS) {
    assert.equal(re(perf![1]).test(u), false, u + " 재기 래퍼");
    assert.equal(re(q![1]).test(u.split("?")[0]), false, u + " 보낼 글 쌓기");
    assert.equal(/\/api\/data$/.test(u), false, u + " data 래퍼");
  }
  // ea-secret.js 는 값을 기록하는 길을 부르지 않음
  for (const bad of ["console.", "localStorage", "sessionStorage", "posthog", "hbErr", "dataset", "BX_UI"]) assert.ok(!SRC.includes(bad), bad);
});
