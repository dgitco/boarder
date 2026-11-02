// ea-secret.test.ts와 같은 작은 DOM + node:vm으로 실제 ea.js를 실행한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const SRC = readFileSync(new URL("./legacy/ea.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("./legacy/ea.css", import.meta.url), "utf8");
type Listener = (e: any) => void;
let active: El | null;
class El {
  children: (El | string)[] = []; parent: El | null = null;
  attrs = new Map<string, string>(); listeners = new Map<string, Listener[]>(); hidden = false;
  constructor(public tag: string) {}
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "hidden") this.hidden = true; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  replaceChildren(...ns: El[]) { this.children = []; this.append(...ns); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  toggleAttribute(k: string, on: boolean) { if (on) this.setAttribute(k, ""); else this.attrs.delete(k); }
  get className() { return this.getAttribute("class") || ""; }
  set className(v: string) { this.setAttribute("class", v); }
  get classList() {
    return { contains: (c: string) => this.className.split(/\s+/).includes(c), add: (c: string) => this.classList.toggle(c, true),
      toggle: (c: string, on: boolean) => { const s = new Set(this.className.split(/\s+/).filter(Boolean)); on ? s.add(c) : s.delete(c); this.className = [...s].join(" "); } };
  }
  get dataset(): Record<string, string> { return Object.fromEntries([...this.attrs].filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5), v])); }
  append(...ns: El[]) { for (const n of ns) { n.parent = this; this.children.push(n); } }
  set innerHTML(s: string) {
    this.children = [];
    const stack: El[] = [this];
    for (const t of s.matchAll(/<\/?[\w-]+\b[^>]*>|[^<]+/g)) {
      const token = t[0];
      if (token.startsWith("</")) { stack.pop(); continue; }
      if (!token.startsWith("<")) { stack.at(-1)!.children.push(token); continue; }
      const e = new El(token.match(/^<([\w-]+)/)![1]);
      for (const a of token.slice(e.tag.length + 1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) e.setAttribute(a[1], a[2] ?? "");
      stack.at(-1)!.append(e);
      if (!token.endsWith("/>") && !["input", "img"].includes(e.tag)) stack.push(e);
    }
  }
  get textContent(): string { return this.children.map(x => typeof x === "string" ? x : x.textContent).join(""); }
  set textContent(s: string) { this.children = [s]; }
  matches(s: string): boolean {
    if (s.startsWith(".")) return this.classList.contains(s.slice(1));
    if (s.startsWith("[")) { const [, k, v] = s.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/)!; return v === undefined ? this.attrs.has(k) : this.getAttribute(k) === v; }
    return this.tag === s;
  }
  closest(s: string): El | null { return this.matches(s) ? this : this.parent?.closest(s) ?? null; }
  contains(e: El): boolean { return e === this || !!e.parent && this.contains(e.parent); }
  querySelectorAll(s: string): El[] {
    const parts = s.split(" "), last = parts.pop()!;
    const match = (e: El) => {
      if (!e.matches(last)) return false;
      let p = e.parent;
      for (const part of [...parts].reverse()) { while (p && !p.matches(part)) p = p.parent; if (!p) return false; p = p.parent; }
      return true;
    };
    return this.children.flatMap(c => typeof c === "string" ? [] : [...(match(c) ? [c] : []), ...c.querySelectorAll(s)]);
  }
  querySelector(s: string): El { return this.querySelectorAll(s)[0] ?? null!; }
  addEventListener(t: string, f: Listener) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]); }
  dispatch(type: string, extra = {}) {
    const e = { type, target: this, preventDefault() {}, ...extra };
    for (let p: El | null = this; p; p = p.parent) for (const f of p.listeners.get(type) ?? []) f(e);
  }
  click() { this.dispatch("click"); }
  focus() { active = this; }
}
function setup(width = 390, enabled = true) {
  active = null;
  const doc = new El("document"), html = new El("html"), body = new El("body"), ans = new El("div"), input = new El("input");
  doc.append(html); html.append(body); body.append(ans, input);
  const calls: string[] = [], intervals: (() => void)[] = [];
  const panes = ["spin", "wait", "stall", "watch", "idle", "done", "unknown"].map((g, i) => ({ pane: `p${i}`, win: `일 ${i}`, g, last: { short: i === 0 ? "일하는 중" : "마지막 말", ago: 1 } }));
  const ctx: any = {
    BX_EA: enabled, HB_LIVE: true, ans, panes, byPane: Object.fromEntries(panes.map(p => [p.pane, p])), cur: { tab: "chat", chan: "primary" },
    document: Object.assign(doc, { documentElement: html, body, createElement: (t: string) => new El(t), getElementById: (id: string) => { assert.equal(id, "cnew"); return input; } }),
    matchMedia: () => ({ matches: width >= 861, addEventListener() {} }),
    boardFns: { nameOf: (p: any) => p.win, look: (p: any) => ({ g: p.g, s: "대체 말" }), leadPane: () => "lead" },
    openChan: (c: string) => { calls.push(`chan:${c}`); ans.hidden = false; },
    HBV: { start: ({ pane }: any) => calls.push(`call:${pane}`), layout: () => calls.push("layout") },
    ARTS: { canvas: { kind: "canvas", at: "2026-11-01" } }, openArt: (id: string) => calls.push(`art:${id}`),
    setTimeout: (f: () => void) => f(), setInterval: (f: () => void) => intervals.push(f),
    MutationObserver: class { observe() {} }, addEventListener() {},
    KeyboardEvent: class { constructor(public type: string, init: object) { Object.assign(this, init); } },
  };
  Object.defineProperty(doc, "activeElement", { get: () => active });
  Object.assign(doc, { dispatchEvent: (e: any) => doc.dispatch(e.type, e) });
  ctx.window = ctx;
  // 보드의 look/nameOf는 window 속성이 아닌 전역 const다.
  vm.runInNewContext("const {look, nameOf, leadPane} = boardFns;\n" + SRC, ctx);
  return { ctx, body, html, doc, calls, panes, input, tick: () => intervals.forEach(f => f()) };
}

test("목록 = 기능별 비서 넷(Grok Bot 꼴) — 작업 노드 · 고정 원 없음", () => {
  const t = setup();
  assert.deepEqual(t.body.querySelectorAll(".bx-ea-row b").map(e => e.textContent), ["비서", "슬랙 인박스", "할 일 관리", "상담봇"]);
  assert.equal(t.body.querySelectorAll(".bx-ea-pin").length, 0);
  t.panes[0].g = "wait"; t.tick();
  assert.equal(t.body.querySelectorAll(".bx-ea-row").length, 4);
  t.ctx.ans.hidden = true; t.tick(); t.body.querySelectorAll(".bx-ea-row")[0].click(); assert.deepEqual(t.calls, ["chan:primary"]);   // 이미 연 대화면 다시 열지 않음 — 닫은 뒤 누름
});

test("영상 메뉴 → 전화 HBV.start · 미팅 openArt · 통화 중 바로 layout", () => {
  const t = setup(), trigger = t.body.querySelector('[data-ea="menu"]'), menu = t.body.querySelector('[role="menu"]');
  assert.equal(menu.hidden, true); trigger.click();
  assert.equal(trigger.getAttribute("aria-haspopup"), "menu"); assert.equal(trigger.getAttribute("aria-expanded"), "true");
  menu.querySelector('[data-ea="call"]').click();
  assert.deepEqual(t.calls, ["call:lead"]); assert.equal(menu.hidden, true);
  trigger.click(); menu.querySelector('[data-ea="meet"]').click();
  assert.deepEqual(t.calls, ["call:lead", "call:lead", "art:canvas"]); assert.equal(menu.hidden, true);
  t.ctx.HBV.call = {}; trigger.click();
  assert.equal(t.calls.at(-1), "layout"); assert.equal(menu.hidden, true);
});

test("메뉴 바깥 · Esc · 방향키 · Enter · Tab · 대화 닫힘", () => {
  const t = setup(), trigger = t.body.querySelector('[data-ea="menu"]'), menu = t.body.querySelector('[role="menu"]');
  trigger.click(); t.body.click(); assert.equal(menu.hidden, true);
  trigger.focus(); t.doc.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(active?.getAttribute("data-ea"), "call");
  t.doc.dispatch("keydown", { key: "ArrowUp" }); assert.equal(active?.getAttribute("data-ea"), "meet");
  t.doc.dispatch("keydown", { key: "Enter" }); assert.equal(t.calls.at(-1), "art:canvas"); assert.equal(menu.hidden, true);
  trigger.click(); t.doc.dispatch("keydown", { key: "Escape" }); assert.equal(menu.hidden, true); assert.equal(active, trigger);
  trigger.click(); t.doc.dispatch("keydown", { key: "Tab" }); assert.equal(menu.hidden, true);
  trigger.click(); t.ctx.ans.hidden = true; t.tick(); assert.equal(menu.hidden, true);
});

test("위 줄 찾기 · 새 대화 원(Grok Bot 꼴, 폰 · PC 같음) · 새 대화 시트", () => {
  for (const width of [390, 1200]) {
    const t = setup(width), top = t.body.querySelector(".bx-ea-title");
    let found = false;
    t.doc.addEventListener("keydown", (e: any) => { if (e.key === "k") found = true; });
    top.querySelector(".bx-ea-find").click(); assert.equal(found, true);
    const compose = top.querySelector(".bx-ea-compose");
    assert.equal(compose.getAttribute("aria-label"), "새 대화"); compose.click();
    assert.deepEqual(t.calls, []);
    assert.equal(t.body.querySelector(".bx-en-scrim").hidden, false);
    assert.equal(active?.getAttribute("role"), "combobox");
    t.doc.dispatch("keydown", { key: "Escape" });
    assert.equal(t.body.querySelector(".bx-en-scrim").hidden, true);
    t.tick(); assert.equal(t.html.classList.contains("bx-ea-open"), true);
    t.ctx.ans.hidden = true; t.tick(); assert.equal(t.html.classList.contains("bx-ea-open"), false);
  }
  assert.match(CSS, /@media \(max-width:860px\)/);
  assert.match(CSS, /\.bx-ea-open \.bx-ea-list\{visibility:hidden\}/);
  assert.match(CSS, /\.bx-ea-bar,html\.bx-ea \.bx-ea-big,html\.bx-ea \.bx-ea-float,html\.bx-ea \.bx-ea-pins\{display:none!important\}/);
  assert.match(CSS, /\.bx-ea-circ/);
});

test("BX_EA가 없으면 DOM과 호출이 그대로", () => {
  const t = setup(390, false);
  assert.equal(t.body.children.length, 2); assert.deepEqual(t.calls, []);
  assert.equal(t.html.classList.contains("bx-ea"), false);
});
