// node --test --no-warnings --experimental-transform-types apps/web/worker/ea-secret.test.ts
// 비서(/ea) 비밀값 넣기 · 허락(legacy/ea-secret.js): 새 의존성 없이 — 스크립트가 쓰는 만큼만 흉내 낸 작은 DOM 위에서 node:vm 으로 돌림.
//   뒤쪽 = secrets.ts. 404 · 401 = 숨김 · 허락 기다림 수 = 띠 · 머리 자물쇠 단추 · POST /api/secrets 몸통 꼴 · 보낸 뒤 입력칸 비고 DOM 어디에도 값 글자 없음
//   · 허락/거절 몸통 · 쓸 때 바꾸기 · 지우기 · 보드 fetch 감싸기(shell.js)가 api/secrets 몸통을 안 봄
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
  insertBefore(n: Node0, ref: Node0 | null) { n.remove(); n.parent = this; const i = ref ? this.children.indexOf(ref) : -1; i < 0 ? this.children.push(n) : this.children.splice(i, 0, n); }
  querySelector(sel: string): El | null { const c = sel.replace(/^\./, ""); for (const n of walk(this)) if (n !== this && n instanceof El && n.classList.contains(c)) return n; return null; }
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
  focus() { if (shown(this)) ACTIVE = this; }   // 브라우저처럼: 숨은(부모 포함) 요소는 포커스 안 받음
  closest(sel: string): El | null { const a = sel.match(/^\[([a-z-]+)\]$/); for (let n: El | null = this; n; n = n.parent) if (a ? (a[1] === "hidden" ? n.hidden : n.attrs.has(a[1])) : n.classList.contains(sel.replace(/^\./, ""))) return n; return null; }
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
function setup(answer: (url: string, init: any) => Response | Promise<Response>, extra: Record<string, unknown> = {}) {
  const html = new El("html"), body = new El("body"); html.append(body); html.classList.add("bx-ea");
  const ttl = new El("div"); ttl.className = "bx-ea-title"; const h1 = new El("h1"); const cmp = new El("button"); cmp.className = "bx-ea-compose"; ttl.append(h1, cmp); body.append(ttl);   // ea.js 목록 머리
  const docLs = new Map<string, L[]>(), winLs = new Map<string, L[]>();
  const timers: { f: () => void; at: number }[] = [];
  const calls: Call[] = [], logs: unknown[] = [];
  const store = new Map<string, string>();
  DOC = { documentElement: html, body, hidden: false, get activeElement() { return ACTIVE; },
    createElement: (t: string) => new El(t), createTextNode: (s: string) => new Text(s), querySelector: (q: string) => html.querySelector(q),
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
  Object.assign(win, extra);
  win.window = win;
  vm.runInNewContext(SRC, win);
  const flush = () => new Promise(r => setImmediate(r));
  const settle = async () => { for (let i = 0; i < 8; i++) await flush(); };
  return { win, html, body, calls, logs, store, timers, settle, key: (key: string, extra = {}) => fire(docLs, { type: "keydown", key, preventDefault() {}, ...extra }) };
}
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const NOW = Date.now();
const LIST = {
  secrets: [{ name: "corp-card", kind: "card", mode: "saved", policy: "ask", created_at: NOW }, { name: "otp-phone", kind: "phone", mode: "once", policy: "ask", created_at: NOW }],
  requests: [{ id: "sr_1", name: "corp-card", site: "https://example.test", state: "pending", agent: "company", created_at: NOW - 120000 },
    { id: "sr_2", name: "corp-card", site: "https://pay.test", state: "pending", agent: "dgit", created_at: NOW },
    { id: "sr_0", name: "corp-card", site: "https://old.test", state: "sent", agent: "옛 창", created_at: NOW - 900000 }],
};
const keysOf = (t: ReturnType<typeof setup>) => one(t.body, "bx-ea-keys");
const openSheet = async (t: ReturnType<typeof setup>) => { keysOf(t).click(); await t.settle(); };

test("GET /api/secrets 404 · 401 · 망 실패 · 꼴 다름 = 띠 · 머리 단추 없음, 5분 뒤 다시", async () => {
  for (const ans of [() => J({ error: "nf" }, 404), () => J({ error: "로그인" }, 401), () => { throw new TypeError("network"); }, () => J({ requests: [] })]) {
    const t = setup(ans as any); await t.settle();
    assert.equal(shown(one(t.body, "bx-es-band")), false, "띠 숨김");
    assert.equal(keysOf(t).hidden, true, "머리 단추 숨김");
    assert.equal(t.html.classList.contains("bx-es-on"), false);
    assert.deepEqual([...t.win.BX_EA_LOCK], []);
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].url, "/api/secrets");
    assert.equal(t.calls[0].init.credentials, "same-origin");
    assert.deepEqual(t.timers.map(x => x.at), [300000], "5분 뒤 한 번 다시");
    keysOf(t).click(); await t.settle();
    assert.equal(t.win.BX_EA_SECRET.state().open, false, "꺼진 채로는 시트도 안 뜸");
  }
});

test("머리 단추는 목록 머리(새 대화 단추 앞)에 · 허락 기다림(pending 만) 수 = 띠 · 자물쇠 에이전트 · 20초 다시", async () => {
  const t = setup(() => J(LIST)); await t.settle();
  const k = keysOf(t), ttl = one(t.body, "bx-ea-title");
  assert.equal(k.parent, ttl); assert.ok(ttl.children.indexOf(k) < ttl.children.indexOf(one(t.body, "bx-ea-compose")), "새 대화 단추 앞");
  assert.equal(k.hidden, false); assert.equal(k.getAttribute("aria-label"), "비밀값 · 허락 기다림 2");
  assert.equal(one(t.body, "bx-ea-keys-n").textContent, "2");
  const band = one(t.body, "bx-es-band");
  assert.equal(shown(band), true); assert.equal(band.textContent, "비밀값 허락 기다림 2");
  assert.deepEqual([...t.win.BX_EA_LOCK].sort(), ["company", "dgit"], "sent 요청 에이전트는 빼기");
  assert.deepEqual(t.timers.map(x => x.at), [20000]);
  const t2 = setup(() => J({ secrets: LIST.secrets, requests: [] })); await t2.settle();
  assert.equal(shown(one(t2.body, "bx-es-band")), false, "기다림 0 = 띠 없음");
  assert.equal(keysOf(t2).hidden, false, "머리 단추는 그대로");
  assert.equal(one(t2.body, "bx-ea-keys-n").hidden, true);
});

test("목록: 허락 기다림 → 넣어 둔 값 → 값 넣기, 줄 글", async () => {
  const t = setup(() => J(LIST)); await t.settle(); await openSheet(t);
  assert.deepEqual(byClass(t.body, "bx-es-sec").map(e => e.textContent), ["허락 기다림", "넣어 둔 값"]);
  const cards = byClass(t.body, "bx-es-card");
  assert.equal(cards.length, 4, "기다림 2 · 넣어 둔 값 2");
  assert.match(cards[0].textContent, /^corp-cardcompany · https:\/\/example\.test · 2분 전/);
  assert.equal(cards[2].textContent, "corp-card카드 · 저장 · 쓸 때마다 허락");
  assert.equal(cards[3].textContent, "otp-phone전화 · 한 번만 · 10분 안");
  assert.equal(one(t.body, "bx-es-add").textContent, "값 넣기");
  const t2 = setup(() => J({ secrets: [], requests: [] })); await t2.settle(); await openSheet(t2);
  assert.equal(one(t2.body, "bx-es-none").textContent, "넣어 둔 값이 없어요");
});

test("값 넣기: 칸 꼴 · POST /api/secrets 몸통(name · kind · mode · policy · value) · 보낸 뒤 칸 비고 DOM · 기록 어디에도 값 없음", async () => {
  let postBody: any = null, postInit: any = null;
  const t = setup((url, init) => {
    if (url === "/api/secrets" && init?.method === "POST") { postInit = init; postBody = JSON.parse(init.body); return J({ ok: true, name: postBody.name }); }
    return J(LIST);
  });
  await t.settle(); await openSheet(t);
  one(t.body, "bx-es-add").click();
  const [nm, inp] = byClass(t.body, "bx-es-in");
  assert.ok(nm.classList.contains("bx-es-name"));
  assert.equal(inp.type, "password");
  for (const e of [nm, inp]) { assert.equal(e.getAttribute("autocomplete"), "off"); assert.equal(e.spellcheck, false); assert.match(e.name, /^f[a-z0-9]{8,}/, "무작위 name"); }
  assert.equal(inp.getAttribute("data-1p-ignore"), "true");
  assert.equal(inp.inputMode, "numeric", "기본 카드 = numeric");
  const go = one(t.body, "bx-es-go");
  assert.equal(go.disabled, true, "비면 꺼짐");
  const segs = byClass(t.body, "bx-es-sg");
  assert.deepEqual(segs.map(s => s.textContent), ["카드", "전화", "주민번호", "비밀번호", "글", "기타", "한 번만 쓰고 버림", "저장", "쓸 때마다 허락", "에이전트가 알아서"]);
  segs[3].click(); assert.equal(inp.inputMode, "text", "비밀번호 = text");
  segs[0].click();
  assert.equal(segs[6].getAttribute("aria-checked"), "true", "기본 한 번만");
  assert.equal(shown(segs[8]), false, "한 번만이면 쓸 때 고르기 숨김");
  segs[7].click(); assert.equal(shown(segs[8]), true); assert.equal(segs[8].getAttribute("aria-checked"), "true", "기본 쓸 때마다 허락");
  segs[9].click();
  nm.value = "Corp-Card2"; nm.dispatch("input");
  assert.equal(nm.value, "corp-card2", "소문자로");
  assert.equal(go.disabled, true, "값 비면 꺼짐");
  nm.value = "bad name"; nm.dispatch("input"); inp.value = SECRET; inp.dispatch("input");
  assert.equal(go.disabled, true, "이름 꼴 틀리면 꺼짐");
  nm.value = "corp-card2"; nm.dispatch("input");
  assert.equal(go.disabled, false);
  go.click();
  assert.ok(byClass(go, "bx-es-spin").length === 1 && !go.textContent.includes("중"), "보내는 동안 스피너");
  await t.settle();
  assert.deepEqual(postBody, { name: "corp-card2", kind: "card", mode: "saved", policy: "auto", value: SECRET });
  assert.equal(postInit.method, "POST"); assert.equal(postInit.credentials, "same-origin");
  assert.equal(postInit.headers["content-type"], "application/json"); assert.equal(postInit.headers["x-hb"], "1");
  assert.equal(inp.value, "", "입력칸 비움"); assert.equal(inp.isConnected, false, "입력칸 요소를 뗌");
  assert.ok(!dump(t.html).includes(SECRET), "DOM 어디에도 값 글자 없음");
  assert.ok(!JSON.stringify(t.logs).includes(SECRET) && t.logs.length === 0, "console · posthog 없음");
  assert.equal(t.store.size, 0, "localStorage · sessionStorage 안 씀");
  assert.equal(one(t.body, "bx-es-done").textContent, "넣었어요 · 에이전트는 「corp-card2」 으로 불러요");
  t.timers.filter(x => x.at === 1400).forEach(x => x.f());
  assert.equal(t.win.BX_EA_SECRET.state().view, "list");
  // 한 번만이면 policy = ask 로 감
  const t2 = setup((url, init) => { if (init?.method === "POST") { postBody = JSON.parse(init.body); return J({ ok: true }); } return J(LIST); });
  await t2.settle(); await openSheet(t2); one(t2.body, "bx-es-add").click();
  const [n2, i2] = byClass(t2.body, "bx-es-in"); const s2 = byClass(t2.body, "bx-es-sg");
  s2[7].click(); s2[9].click(); s2[6].click();   // 저장 → 알아서 → 다시 한 번만
  n2.value = "x1"; n2.dispatch("input"); i2.value = SECRET; i2.dispatch("input");
  one(t2.body, "bx-es-go").click(); await t2.settle();
  assert.deepEqual(postBody, { name: "x1", kind: "card", mode: "once", policy: "ask", value: SECRET });
});

test("값 넣기: Tab 이 숨은 「쓸 때」 단추에서 멈추지 않고 「넣기」까지 · 가림 CSS 되면 칸은 text(비밀번호 저장 제안 없게)", async () => {
  const t = setup(() => J(LIST), { CSS: { supports: (p: string, v: string) => p === "-webkit-text-security" && v === "disc" } });
  await t.settle(); await openSheet(t); one(t.body, "bx-es-add").click();
  const [nm, inp] = byClass(t.body, "bx-es-in");
  assert.equal(inp.type, "text"); assert.ok(inp.classList.contains("bx-es-mask")); assert.equal(inp.getAttribute("maxlength"), "4096");
  nm.value = "requests"; nm.dispatch("input"); inp.value = SECRET; inp.dispatch("input");
  assert.equal(one(t.body, "bx-es-go").disabled, true, "뒤쪽 예약어 이름은 꺼짐");
  nm.value = "ok-name"; nm.dispatch("input");
  const go = one(t.body, "bx-es-go"), visited: unknown[] = [];
  for (let i = 0; i < 14; i++) { t.key("Tab"); visited.push(ACTIVE); }
  assert.ok(visited.includes(go), "Tab 으로 넣기에 닿음");
  for (const e of visited) assert.ok(shown(e as El), "숨은 단추엔 안 감");
  t.key("Escape"); assert.equal(inp.value, "");
});

test("값 넣기 실패: 409 = 「같은 이름이 있어요」 · 500 = 한 줄 오류 · 값은 칸에 그대로 · 닫으면 칸 비움", async () => {
  for (const [st, msg] of [[409, "같은 이름이 있어요"], [500, "일시적인 오류가 발생했어요"], [503, "일시적인 오류가 발생했어요"]] as const) {
    const t = setup((url, init) => init?.method === "POST" ? J({ error: "x" }, st) : J(LIST));
    await t.settle(); await openSheet(t); one(t.body, "bx-es-add").click();
    const [nm, inp] = byClass(t.body, "bx-es-in");
    nm.value = "corp-card"; nm.dispatch("input"); inp.value = SECRET; inp.dispatch("input");
    one(t.body, "bx-es-go").click(); await t.settle();
    const err = one(t.body, "bx-es-err");
    assert.equal(shown(err), true); assert.equal(err.textContent, msg);
    assert.equal(inp.value, SECRET, "다시 시도할 수 있게 그대로");
    assert.equal(one(t.body, "bx-es-go").disabled, false);
    assert.ok(!dump(t.html).replace(`value=${SECRET}`, "").includes(SECRET), "입력칸 value 말고는 값 글자 없음");
    t.key("Escape");
    assert.equal(t.win.BX_EA_SECRET.state().open, false, "Esc 로 닫음");
    assert.equal(inp.value, ""); assert.ok(!dump(t.html).includes(SECRET));
  }
});

test("허락 · 거절: POST /api/secrets/requests/:id {action} · 409 = 지나감 · 바깥 누르면 닫힘 · 포커스 가둠", async () => {
  const seen: any[] = [];
  const mkT = (st = 200) => { const gone = new Set<string>(); return setup((url, init) => {
    if (url.startsWith("/api/secrets/requests/")) { seen.push({ url, b: JSON.parse(init.body), h: init.headers, c: init.credentials, m: init.method }); gone.add(url.split("/").pop()!); return st === 200 ? J({ ok: true, state: "approved" }) : J({ error: "x" }, st); }
    return J({ ...LIST, requests: LIST.requests.filter(q => st === 500 || !gone.has(q.id)) });   // 뒤쪽처럼: 정한 · 지난 요청은 기다림에서 빠짐
  }); };
  const t = mkT(); await t.settle(); await openSheet(t);
  byClass(t.body, "bx-es-card")[0].click();
  assert.equal(one(t.body, "bx-es-who").textContent, "https://example.test 에 넣으려 해요 · company");
  assert.equal(one(t.body, "bx-es-title").textContent, "corp-card");
  const tabs = new Set<unknown>();
  for (let i = 0; i < 8; i++) { t.key("Tab"); tabs.add(ACTIVE); }
  for (const e of tabs) { let n: any = e, inside = false; while (n) { if (n.classList?.contains("bx-es-sheet")) inside = true; n = n.parent; } assert.ok(inside, "Tab 은 시트 안에서만"); }
  one(t.body, "bx-es-go").click(); await t.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(seen[0])), { url: "/api/secrets/requests/sr_1", b: { action: "allow" }, h: { "content-type": "application/json", "x-hb": "1" }, c: "same-origin", m: "POST" });
  assert.equal(one(t.body, "bx-es-done").textContent, "허락했어요");
  assert.equal(one(t.body, "bx-es-band").textContent, "비밀값 허락 기다림 1");
  // 거절
  const t2 = mkT(); await t2.settle(); await openSheet(t2);
  byClass(t2.body, "bx-es-card")[1].click();
  byClass(t2.body, "bx-es-ghost")[0].click(); await t2.settle();
  assert.deepEqual([seen[1].url, seen[1].b], ["/api/secrets/requests/sr_2", { action: "deny" }]);
  assert.equal(one(t2.body, "bx-es-done").textContent, "거절했어요");
  // 409 = 이미 정함 · 만료
  const t3 = mkT(409); await t3.settle(); await openSheet(t3);
  byClass(t3.body, "bx-es-card")[0].click(); one(t3.body, "bx-es-go").click(); await t3.settle();
  assert.equal(one(t3.body, "bx-es-done").textContent, "이미 정했거나 시간이 지났어요");
  // 500 = 한 줄 오류, 화면 그대로
  const t4 = mkT(500); await t4.settle(); await openSheet(t4);
  byClass(t4.body, "bx-es-card")[0].click(); one(t4.body, "bx-es-go").click(); await t4.settle();
  assert.equal(one(t4.body, "bx-es-err").textContent, "일시적인 오류가 발생했어요"); assert.equal(t4.win.BX_EA_SECRET.state().view, "allow");
  // 바깥(scrim) 누름 = 닫힘, 시트 안 누름은 그대로
  one(t4.body, "bx-es-sheet").dispatch("click"); assert.equal(t4.win.BX_EA_SECRET.state().open, true);
  one(t4.body, "bx-es-scrim").dispatch("click"); assert.equal(t4.win.BX_EA_SECRET.state().open, false);
});

test("넣어 둔 값: 쓸 때 바꾸기 PATCH {policy} · 지우기 두 번 눌러 DELETE · 한 번만 값은 쓸 때 고르기 없음", async () => {
  const seen: any[] = [];
  const t = setup((url, init) => { if (init?.method === "PATCH" || init?.method === "DELETE") { seen.push({ url, m: init.method, b: init.body && JSON.parse(init.body), h: init.headers }); return J({ ok: true }); } return J(LIST); });
  await t.settle(); await openSheet(t);
  byClass(t.body, "bx-es-card")[2].click();
  assert.equal(one(t.body, "bx-es-title").textContent, "corp-card");
  const segs = byClass(t.body, "bx-es-sg");
  assert.deepEqual(segs.map(s => [s.textContent, s.getAttribute("aria-checked")]), [["쓸 때마다 허락", "true"], ["에이전트가 알아서", "false"]]);
  assert.equal(seen.length, 0, "처음 그릴 때는 안 부름");
  segs[1].click(); await t.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(seen[0])), { url: "/api/secrets/corp-card", m: "PATCH", b: { policy: "auto" }, h: { "content-type": "application/json", "x-hb": "1" } });
  assert.equal(one(t.body, "bx-es-why").textContent, "카드 · 저장 · 에이전트가 알아서");
  const del = byClass(t.body, "bx-es-ghost").at(-1)!;
  del.click(); await t.settle();
  assert.equal(seen.length, 1, "한 번 누름 = 안 지움"); assert.equal(del.textContent, "한 번 더 누르면 지워요");
  del.click(); await t.settle();
  assert.deepEqual([seen[1].url, seen[1].m, seen[1].b], ["/api/secrets/corp-card", "DELETE", undefined]);
  assert.equal(one(t.body, "bx-es-done").textContent, "지웠어요");
  t.timers.filter(x => x.at === 1400).forEach(x => x.f());
  const t2 = setup(() => J(LIST)); await t2.settle(); await openSheet(t2);
  byClass(t2.body, "bx-es-card")[3].click();
  assert.equal(byClass(t2.body, "bx-es-sg").length, 0, "한 번만 = 쓸 때 고르기 없음");
});

test("BX_EA 아님 = 아무것도 안 만듦 · 안 부름", async () => {
  const html = new El("html"), body = new El("body"); html.append(body);
  const calls: string[] = [];
  DOC = { documentElement: html, body, createElement: (x: string) => new El(x), addEventListener() {} };
  vm.runInNewContext(SRC, { window: { fetch: (u: string) => { calls.push(u); } }, document: DOC });
  assert.equal(body.children.length, 0); assert.deepEqual(calls, []);
});

test("보드 fetch 감싸기(shell.js)는 api/secrets 몸통을 안 봄 — 재기 래퍼 · 보낼 글 쌓기 길에 안 걸림", () => {
  const perf = SHELL.match(/if \(m === 'POST' && (\/.*?\/)\.test\(s\)\)/);
  assert.ok(perf, "shell.js 재기 래퍼 꼴이 바뀜 — 이 시험을 같이 고칠 것");
  const q = SHELL.match(/Q = (\/\(\^\|\\\/\)api\\\/\(chat\|[^/]*\)\$\/)/);
  assert.ok(q, "shell.js 보낼 글 쌓기 Q 꼴이 바뀜 — 이 시험을 같이 고칠 것");
  const re = (s: string) => { const m = s.match(/^\/(.*)\/([a-z]*)$/)!; return new RegExp(m[1], m[2]); };
  assert.ok(SRC.includes("list: '/api/secrets'") && SRC.includes("'/api/secrets/requests/'"), "주소 표 꼴이 바뀜 — 이 시험을 같이 고칠 것");
  for (const u of ["/api/secrets", "/api/secrets/corp-card", "/api/secrets/requests/sr_1"]) {
    assert.equal(re(perf![1]).test(u), false, u + " 재기 래퍼");
    assert.equal(re(q![1]).test(u), false, u + " 보낼 글 쌓기");
    assert.equal(/\/api\/data$/.test(u), false, u + " data 래퍼");
  }
  for (const bad of ["console.", "localStorage", "sessionStorage", "posthog", "hbErr", "dataset", "BX_UI"]) assert.ok(!SRC.includes(bad), bad);
});
