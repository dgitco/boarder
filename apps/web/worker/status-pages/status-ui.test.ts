// node --test --no-warnings --experimental-transform-types apps/web/worker/status-pages/status-ui.test.ts
// 작은 DOM + node:vm 으로 진짜 legacy/status.js 를 돌림 — 찾기 칸 · 말하기 칸이 다시 그리기에 안 갈리는지(자료는 다 지어낸 것).
// 진짜 한글 입력기(조합) 확인은 브라우저 몫이고, 여기서는 그 원인(칸 교체 · 값 쓰기 · 포커스 옮기기)을 막음.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
const SRC = readFileSync(new URL("../legacy/status.js", import.meta.url), "utf8");
const VOID = new Set(["input", "img", "br", "path", "circle", "rect"]);
const unesc = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, x) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[x as "amp"]);
type L = (e: any) => unknown;
class El {
  children: (El | string)[] = []; parent: El | null = null; attrs = new Map<string, string>(); listeners = new Map<string, L[]>();
  hidden = false; disabled = false; style: Record<string, string> = {}; value = ""; selectionStart = 0; selectionEnd = 0;
  focusCalls = 0; selCalls = 0; id = ++El.n; static n = 0; static active: El | null = null;
  constructor(public tag: string) {}
  setAttribute(k: string, v: string) { this.attrs.set(k, v); if (k === "value") this.value = unesc(v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  get className() { return this.getAttribute("class") || ""; } set className(v: string) { this.attrs.set("class", v); }
  get classList() { const cs = () => this.className.split(/\s+/).filter(Boolean); return { contains: (c: string) => cs().includes(c), add: (c: string) => { this.className = [...new Set([...cs(), c])].join(" "); }, remove: (c: string) => { this.className = cs().filter(x => x !== c).join(" "); } }; }
  get dataset() { return Object.fromEntries([...this.attrs].filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5), unesc(v)])); }
  get els() { return this.children.filter((x): x is El => typeof x !== "string"); }
  get lastElementChild() { return this.els.at(-1) ?? null; }
  get textContent(): string { return this.children.map(x => typeof x === "string" ? x : x.textContent).join(""); }
  set innerHTML(s: string) {
    for (const c of this.all()) if (El.active === c) El.active = null;
    this.children = []; const st: El[] = [this];
    for (const m of s.matchAll(/<\/?[\w-]+\b[^>]*>|[^<]+/g)) {
      const t = m[0];
      if (t.startsWith("</")) { if (!VOID.has(t.slice(2, -1))) st.pop(); continue; }
      if (!t.startsWith("<")) { st.at(-1)!.children.push(unesc(t)); continue; }
      const e = new El(t.match(/^<([\w-]+)/)![1]);
      for (const a of t.slice(e.tag.length + 1).matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) e.setAttribute(a[1], a[2] ?? "");
      e.parent = st.at(-1)!; e.parent.children.push(e);
      if (!t.endsWith("/>") && !VOID.has(e.tag)) st.push(e);
    }
  }
  all(): El[] { return this.els.flatMap(e => [e, ...e.all()]); }
  matches(sel: string): boolean {
    const m = sel.match(/^([\w-]*)((?:\.[\w-]+)*)((?:\[[\w-]+\])*)$/); if (!m) throw new Error("모르는 선택자 " + sel);
    return (!m[1] || this.tag === m[1]) && [...m[2].matchAll(/\.([\w-]+)/g)].every(x => this.classList.contains(x[1])) && [...m[3].matchAll(/\[([\w-]+)\]/g)].every(x => this.attrs.has(x[1]));
  }
  querySelector(sel: string) { return this.all().find(e => e.matches(sel)) ?? null; }
  querySelectorAll(sel: string) { return this.all().filter(e => e.matches(sel)); }
  closest(sel: string) { let e: El | null = this; while (e) { if (e.matches(sel)) return e; e = e.parent; } return null; }
  addEventListener(t: string, f: L) { (this.listeners.get(t) || this.listeners.set(t, []).get(t)!).push(f); }
  focus() { this.focusCalls++; El.active = this; }
  setSelectionRange(a: number, b: number) { this.selCalls++; this.selectionStart = a; this.selectionEnd = b; }
  scrollIntoView() {} scrollTo() {}
  after(n: El) { n.parent = this.parent; this.parent!.children.splice(this.parent!.children.indexOf(this) + 1, 0, n); }
  requestSubmit() { this.fire("submit"); }
  fire(type: string, x: object = {}) {
    const e = { type, target: this, preventDefault() {}, ...x }, out: unknown[] = [];
    for (let n: El | null = this; n; n = n.parent) for (const f of n.listeners.get(type) || []) out.push(f(e));
    return Promise.all(out);
  }
}
const flush = () => new Promise(r => setTimeout(r, 5));
const TASK = (id: string, x: object = {}) => ({ id, title: "제목 " + id, quote: "", status: "진행", state: "working", dept: "", assignee: "", area: "", done: "", next: "", q: "", prs: [], tasks: [], logs: [], requested_at: null, updated_at: Date.now(), completed_at: null, ...x });
type Route = (m: string, body: any) => unknown;
async function boot(feat: Record<string, boolean>, routes: Record<string, Route> = {}) {
  const calls: string[] = [], timers: [number, () => void][] = [], R = new El("html"), wrap = new El("div"), header = new El("header");
  wrap.className = "wrap"; R.children.push(wrap); wrap.parent = R; wrap.children.push(header); header.parent = wrap;
  const doc = { documentElement: R, visibilityState: "visible", get activeElement() { return El.active; }, querySelector: (s: string) => s === ".wrap header" ? header : s === ".wrap" ? wrap : null, createElement: (t: string) => new El(t), addEventListener() {} };
  const fetch = async (p: string, o: any = {}) => {
    const path = String(p), method = o.method || "GET"; calls.push(method + " " + path);
    const h = routes[path]; const r = h ? await h(method, o.body ? JSON.parse(o.body) : null) : path === "api/me/features" ? { ok: true, taskboard: false, devboard: false, ...feat } : { __st: 403, ok: false, error: "꺼짐" };
    const st = (r as any)?.__st || 200; return { ok: st < 400, status: st, json: async () => r };
  };
  const ctx: any = {
    HB_LIVE: 1, show() {}, ans: { hidden: true }, document: doc, fetch, console, Date, JSON, Object, Math, String, Map, Set, Number, Array, Error, encodeURIComponent, decodeURIComponent, Promise,
    localStorage: { getItem: () => null, setItem() {} }, history: { pushState() {}, replaceState() {} }, location: { pathname: "/", hash: "" }, alert() {}, scrollTo() {},
    setInterval: (f: () => void, ms: number) => { timers.push([ms, f]); return timers.length; }, clearInterval() {}, setTimeout, MutationObserver: class { observe() {} },
    Event: class { constructor(public type: string) {} }, CustomEvent: class { constructor(public type: string, public o: object) {} }, addEventListener() {}, dispatchEvent() {},
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx); await flush();
  const body = () => header.parent!.els.find(e => e.className.includes("bx-stp")) as El;
  const tick = async (ms: number) => { for (const [m, f] of timers) if (m === ms) f(); await flush(); };
  return { ctx, calls, timers, tick, body, R, list: () => body().querySelectorAll("[data-tk]").map(e => e.dataset.tk) };
}
const tasksOn = (extra: Record<string, Route> = {}) => boot({ taskboard: true }, { "api/me/taskboard": () => ({ ok: true, at: Date.now(), tasks: [TASK("R1", { title: "한글 찾기" }), TASK("R2", { title: "다른 일" })] }), ...extra });
const detail = (st: { convo: any[]; fail?: number }) => (): unknown => st.fail ? { __st: st.fail, ok: false, error: "오류" } : ({ ok: true, task: TASK("R1"), convo: [...st.convo] });
async function openDet(extra: Record<string, Route> = {}, st = { convo: [] as any[] } as { convo: any[]; fail?: number }) {
  const b = await tasksOn({ "api/me/taskboard/R1": detail(st), ...extra }); b.ctx.BXStatus.open("tasks", "R1"); await flush();
  return { ...b, st, ta: () => b.body().querySelector("textarea[data-say]") as El, form: () => b.body().querySelector("form[data-sayf]") as El };
}

test("끈 사람: 페이지 로드에 GET api/me/features 한 번뿐 · 되풀이 없음 · 페이지 없음 · 사이드바 줄 없음", async () => {
  const b = await boot({});
  assert.deepEqual(b.calls, ["GET api/me/features"]); assert.equal(b.timers.length, 0); assert.equal(b.body(), undefined);
  assert.equal(b.ctx.BXStatus.side(() => "X", ""), ""); b.ctx.BXStatus.open("tasks"); b.ctx.BXStatus.open("devices"); await flush();
  assert.equal(b.body(), undefined, "주소로 열려 해도 안 열림"); assert.deepEqual(b.calls, ["GET api/me/features"]); assert.equal(b.R.classList.contains("bx-stpg"), false);
});
test("태스크 찾기 칸: 글자를 넣어도 칸을 안 바꾸고 값 · 포커스 · 커서를 안 건드림(조합 중도), 목록만 걸러짐", async () => {
  const b = await tasksOn(); b.ctx.BXStatus.open("tasks"); await flush();
  const q = b.body().querySelector("[data-q]") as El; q.focus(); assert.deepEqual(b.list(), ["R1", "R2"]);
  for (const [v, isComposing] of [["하", true], ["한", true], ["한ㄱ", true], ["한글", false]] as const) {
    q.value = v; await q.fire("input", { isComposing });
    assert.equal(b.body().querySelector("[data-q]"), q, `「${v}」 뒤에도 같은 칸`); assert.equal(q.value, v); assert.equal(q.selCalls, 0); assert.equal(q.focusCalls, 1);
  }
  assert.deepEqual(b.list(), ["R1"], "목록은 걸러짐");
});
test("태스크 찾기 칸: 30초 새로 읽기 · 상태 칩 · 기간 단추가 칸과 포커스를 안 건드림, 다시 그려도 쓰던 글 그대로", async () => {
  const b = await tasksOn(); b.ctx.BXStatus.open("tasks"); await flush();
  const q = b.body().querySelector("[data-q]") as El; q.focus(); q.value = "한"; await q.fire("input");
  await b.tick(30_000); assert.equal(b.body().querySelector("[data-q]"), q); assert.equal(b.ctx.document.activeElement, q); assert.equal(q.value, "한"); assert.equal(q.focusCalls, 1);
  await (b.body().querySelector("[data-sf]") as El).fire("click"); await (b.body().querySelector("[data-span]") as El).fire("click");
  assert.equal(b.body().querySelector("[data-q]"), q, "칩을 눌러도 같은 칸"); assert.deepEqual(b.list(), ["R1"]);
});
test("기기 찾기 칸: 글자 · 30초 새로 읽기에 칸 · 포커스 그대로", async () => {
  const b = await boot({ devboard: true }, { "api/me/devboard": () => ({ ok: true, at: Date.now(), devices: [{ id: "d1", name: "내 맥", windows: [{ key: "w", title: "한글 창", repo: "", acct: "", state: "working" }, { key: "x", title: "다른 창", repo: "", acct: "", state: "idle" }] }] }) });
  b.ctx.BXStatus.open("devices"); await flush();
  const q = b.body().querySelector("[data-q]") as El; q.focus();
  q.value = "한"; await q.fire("input", { isComposing: true });
  assert.equal(b.body().querySelector("[data-q]"), q); assert.equal(q.selCalls, 0);
  assert.ok(b.body().textContent.includes("한글 창")); assert.ok(!b.body().textContent.includes("다른 창"));
  await b.tick(30_000); assert.equal(b.body().querySelector("[data-q]"), q); assert.equal(b.ctx.document.activeElement, q); assert.equal(q.focusCalls, 1);
});
test("말하기 칸: 15초 새로 읽기가 쓰는 중인 칸을 안 바꿈 — 값 · 커서 · 포커스 그대로, 대화는 새로 그려짐", async () => {
  const b = await openDet(), ta = b.ta(); ta.focus(); ta.value = "앞부분 뒷부분"; ta.setSelectionRange(3, 3); const sel = ta.selCalls;
  b.st.convo.push({ k: "n1", layer: "human", who: "에이전트", mine: 0, at: Date.now(), text: "새 줄", pending: 0 });
  await b.tick(15_000);
  assert.equal(b.ta(), ta); assert.equal(ta.value, "앞부분 뒷부분"); assert.equal(ta.selectionStart, 3); assert.equal(ta.selCalls, sel); assert.equal(ta.focusCalls, 1); assert.equal(b.ctx.document.activeElement, ta);
  assert.ok(b.body().textContent.includes("새 줄"));
});
test("말하기 경합: 보내는 중 새로 읽기가 돌아도 칸이 비워져 다시 눌러도 한 번만 들어감, 말풍선도 한 줄", async () => {
  let release = () => {}; const hold = new Promise<void>(r => { release = r; }), says: string[] = [], line = { k: "s1", layer: "human", who: "나", mine: 1, at: Date.now(), text: "첫 번째 말", pending: 1 };
  const st = { convo: [] as any[] };
  const b = await openDet({ "api/me/taskboard/R1/say": async (_m, body) => { says.push(body.text); await hold; st.convo.push(line); return { ok: true, line }; } }, st);
  b.ta().value = "첫 번째 말"; const sent = b.form().fire("submit"); await flush();
  await b.form().fire("submit"); assert.equal(says.length, 1, "보내는 중에 다시 눌러도 한 번");
  await b.tick(15_000); release(); await sent; await flush();
  assert.equal(b.ta().value, "", "보낸 글이 칸에 안 남음");
  await b.form().fire("submit"); assert.equal(says.length, 1, "빈 칸은 안 보냄");
  await b.tick(15_000); assert.equal(b.body().querySelectorAll(".bx-cvm").length, 1, "말풍선 한 줄");
});
test("말하기: 보내는 사이 응답보다 늦게 온 옛 새로 읽기가 방금 쓴 줄을 지우지 않음", async () => {
  const line = { k: "s1", layer: "human", who: "나", mine: 1, at: Date.now(), text: "새 말", pending: 1 }; let slow = (_: unknown) => {}, first = true;
  const st = { convo: [] as any[] }, b = await openDet({
    "api/me/taskboard/R1": () => first ? ((first = false), ({ ok: true, task: TASK("R1"), convo: [] })) : new Promise(r => { slow = r; }),
    "api/me/taskboard/R1/say": async () => ({ ok: true, line }),
  }, st);
  const poll = b.tick(15_000); await flush();
  b.ta().value = "새 말"; await b.form().fire("submit"); await flush();
  slow({ ok: true, task: TASK("R1"), convo: [] }); await poll; await flush();
  assert.equal(b.body().querySelectorAll(".bx-cvm").length, 1);
});
test("말하기: 새로 읽기가 한 번 실패해도 쓰던 글이 안 사라짐(일시 오류는 화면 그대로 · 없어진 태스크는 안내 뒤 글 보존)", async () => {
  const b = await openDet(), ta = b.ta(); ta.focus(); ta.value = "쓰던 글";
  b.st.fail = 500; await b.tick(15_000); assert.equal(b.ta(), ta); assert.equal(ta.value, "쓰던 글"); assert.notEqual(ta.parent!.style.display, "none"); assert.ok(b.body().querySelector(".bx-td-t"), "일시 오류면 화면 그대로");
  b.st.fail = 404; await b.tick(15_000); assert.ok(b.body().querySelector(".bx-stp-err"));
  b.st.fail = 0; await b.tick(15_000); assert.equal(b.ta().value, "쓰던 글");
});
test("말하기: 다른 태스크로 옮기면 쓰던 글이 따라가지 않음 · 조합 중 Ctrl+Enter 는 안 보냄", async () => {
  const says: string[] = [], b = await openDet({ "api/me/taskboard/R2": () => ({ ok: true, task: TASK("R2"), convo: [] }), "api/me/taskboard/R1/say": async (_m, x) => { says.push(x.text); return { ok: true, line: { k: "a", at: Date.now(), text: x.text, layer: "human" } }; } });
  b.ta().value = "하"; await b.ta().fire("keydown", { key: "Enter", ctrlKey: true, isComposing: true }); await flush(); assert.equal(says.length, 0);
  b.ctx.BXStatus.open("tasks", "R2"); await flush(); assert.equal(b.ta().value, "");
});
test("상태 페이지 코드 · 마이그레이션 · 문서에 사람 호칭이 없음(공개 판 검사는 주석을 못 보니 여기서)", () => {
  const dir = new URL("./", import.meta.url), names = /[가-힣]{2}님/;
  for (const f of readdirSync(dir).filter(f => /\.(ts|mjs)$/.test(f) && !f.endsWith(".test.ts"))) assert.doesNotMatch(readFileSync(new URL(f, dir), "utf8"), names, f);
  assert.doesNotMatch(SRC, names, "status.js"); assert.doesNotMatch(readFileSync(new URL("../legacy/status.css", import.meta.url), "utf8"), names);
  for (const f of readdirSync(new URL("../../migrations/", import.meta.url)).filter(f => /task_board/.test(f))) assert.doesNotMatch(readFileSync(new URL("../../migrations/" + f, import.meta.url), "utf8"), names, f);
  assert.doesNotMatch(readFileSync(new URL("../../../../docs/flows/status-pages.md", import.meta.url), "utf8"), names);
});
test("사이드바 다시 그리기 신호: status.js 가 보내는 이름을 틀(shell.js)이 받음", () => {
  const sent = SRC.match(/new Event\('([\w-]+)'\)/)![1];
  assert.match(readFileSync(new URL("../legacy/shell.js", import.meta.url), "utf8"), new RegExp(`addEventListener\\('${sent}', \\(\\) => sync\\(\\)\\)`));
});
