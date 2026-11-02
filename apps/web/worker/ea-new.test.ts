// 작은 DOM + node:vm으로 실제 새 대화 시트를 실행한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const SRC = readFileSync(new URL("./legacy/ea.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("./legacy/ea.css", import.meta.url), "utf8");
type Listener = (e: any) => void;
let active: El | null;
class El {
  value = ""; disabled = false; style: Record<string, string> = {}; scrollHeight = 34;
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
    let stopped = false;
    const e = { type, target: this, preventDefault() {}, stopPropagation() { stopped = true; }, ...extra };
    for (let p: El | null = this; p && !stopped; p = p.parent) for (const f of p.listeners.get(type) ?? []) f(e);
  }
  dispatchEvent(e: any) { this.dispatch(e.type, e); return true; }
  click() { if (!this.disabled) this.dispatch("click"); }
  focus() { active = this; }
}
const J = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status});
function setup(answer = (_url: string, _init: any): Response | Promise<Response> => J({}, 404)) {
  active = null;
  const doc = new El('document'), html = new El('html'), body = new El('body'), ans = new El('div'), cnew = new El('textarea');
  doc.append(html); html.append(body); body.append(ans, cnew);
  let now = 0, next = 0;
  const timers = new Map<number, {f: () => void; at: number}>(), calls: {url: string; init: any}[] = [], opened: string[] = [];
  const panes: any[] = [];
  const ctx: any = {
    BX_EA: true, HB_LIVE: true, panes, byPane: {}, ans, cur: {tab: 'chat', chan: 'primary'},
    document: Object.assign(doc, {documentElement: html, body, createElement: (t: string) => new El(t), getElementById: () => cnew}),
    matchMedia: () => ({matches: false, addEventListener() {}}),
    fetch: async (url: string, init: any) => { calls.push({url, init}); return answer(url, init); },
    openChan: (c: string) => opened.push('chan:' + c), openNode: (p: string) => opened.push('node:' + p),
    setTimeout: (f: () => void, ms: number) => { const id = ++next; timers.set(id, {f, at: now + ms}); return id; },
    setInterval() {}, MutationObserver: class { observe() {} }, addEventListener() {},
    Event: class { constructor(public type: string, init: any) { Object.assign(this, init); } },
    Date: class extends Date { static now() { return now; } },
    boardFns: {blob: () => '<svg aria-label="비서 아바타"></svg>'},
  };
  Object.defineProperty(doc, 'activeElement', {get: () => active}); ctx.window = ctx;
  vm.runInNewContext('const {blob} = boardFns;\n' + SRC, ctx);
  const one = (s: string) => body.querySelector(s), pencil = one('.bx-ea-compose');
  const settle = () => new Promise<void>(r => setImmediate(r));
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const first = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!first) break;
      timers.delete(first[0]); now = first[1].at; first[1].f();
    }
    now = end;
  };
  const open = async () => { pencil.focus(); pencil.click(); await settle(); };
  return {ctx, body, doc, cnew, panes, calls, opened, one, pencil, settle, advance, open};
}

test('연필 → dialog · 기능별 비서 넷(폴더 · 세션 조회 없음) · 거르기 · 키보드 선택 칩과 해제', async () => {
  const t = setup(); await t.open();
  const dialog = t.one('[role="dialog"]'), input = t.one('[role="combobox"]'), opts = t.one('[role="listbox"]');
  assert.equal(dialog.getAttribute('aria-modal'), 'true'); assert.equal(t.one('.bx-es-title').textContent, '새 대화');
  assert.equal(input.getAttribute('aria-autocomplete'), 'list'); assert.equal(active, input);
  assert.equal(t.calls.length, 0);
  assert.deepEqual(opts.querySelectorAll('[role="option"]').map(o => o.querySelector('b').textContent), ['비서', '슬랙 인박스', '할 일 관리', '상담봇']);
  assert.ok(t.one('.bx-en-avatar').querySelector('svg')); assert.equal(opts.querySelectorAll('.bx-ea-status').length, 0);
  input.value = '상담'; input.dispatch('input'); assert.equal(opts.querySelectorAll('[role="option"]').length, 1);
  input.dispatch('keydown', {key: 'ArrowDown'}); assert.equal(input.getAttribute('aria-activedescendant'), 'bx-en-option-0');
  input.dispatch('keydown', {key: 'Enter', isComposing: true}); assert.equal(input.hidden, false);
  input.dispatch('keydown', {key: 'Enter'}); assert.equal(opts.hidden, true); assert.equal(input.hidden, true); assert.match(t.one('.bx-en-chip').textContent, /상담봇/);
  assert.equal(t.one('.bx-en-start').disabled, false);
  t.one('.bx-en-chip').querySelector('.bx-es-ib').click(); assert.equal(opts.hidden, false); assert.equal(input.hidden, false);
  assert.equal(t.one('.bx-en-start').disabled, true);
  input.dispatch('keydown', {key: 'ArrowUp'}); input.dispatch('keydown', {key: 'Enter'}); assert.match(t.one('.bx-en-chip').textContent, /상담봇/);
  assert.equal(t.calls.length, 0);
});

test('비서 시작 = primary + cnew 값과 input만 · 조합 Enter와 Shift+Enter 무시', async () => {
  const t = setup(); await t.open(); const go = t.one('.bx-en-start'); assert.equal(go.disabled, true); go.click(); assert.deepEqual(t.opened, []);
  t.one('[role="option"]').click(); const text = t.one('.bx-en-text'); text.value = '첫 말\n둘째 줄';
  let inputs = 0; t.cnew.addEventListener('input', () => inputs++);
  text.dispatch('keydown', {key: 'Enter', isComposing: true}); text.dispatch('keydown', {key: 'Enter', shiftKey: true}); assert.deepEqual(t.opened, []);
  text.scrollHeight = 500; text.dispatch('input'); assert.equal(text.style.height, '154px');
  text.dispatch('keydown', {key: 'Enter'});
  assert.deepEqual(t.opened, ['chan:primary']); assert.equal(t.cnew.value, text.value); assert.equal(inputs, 1);
  assert.equal(t.calls.length, 0); assert.equal(t.one('.bx-en-scrim').hidden, true); assert.equal(active, t.cnew);
});

test('상담봇 = shop 채널에 첫 말, 슬랙 인박스 = 모아 보기만 열고 입력칸은 그대로 · 세션 POST 없음', async () => {
  const t = setup(); await t.open();
  t.one('[role="listbox"]').querySelectorAll('[role="option"]')[3].click(); t.one('.bx-en-text').value = '오늘 상담 정리'; t.one('.bx-en-start').click();
  assert.deepEqual(t.opened, ['chan:shop']); assert.equal(t.cnew.value, '오늘 상담 정리');
  const u = setup(); u.ctx.HBInbox = {openFeed: (k: string) => u.opened.push('feed:' + k)}; await u.open();
  u.one('[role="listbox"]').querySelectorAll('[role="option"]')[1].click(); u.one('.bx-en-text').value = '남는 말'; u.one('.bx-en-start').click();
  assert.deepEqual(u.opened, ['feed:unread']); assert.equal(u.cnew.value, ''); assert.equal(u.one('.bx-en-scrim').hidden, true);
  assert.equal(t.calls.length + u.calls.length, 0); assert.equal(u.one('.bx-en-pending'), null);
});

test('Esc · 바깥 닫기 · 포커스 가둠과 복귀', async () => {
  const t = setup(); await t.open(); const dialog = t.one('[role="dialog"]');
  for (let i = 0; i < 10; i++) { t.doc.dispatch('keydown', {key: 'Tab', shiftKey: i % 2 === 0}); assert.ok(dialog.contains(active!)); }
  dialog.click(); assert.equal(t.one('.bx-en-scrim').hidden, false);
  t.doc.dispatch('keydown', {key: 'Escape'}); assert.equal(t.one('.bx-en-scrim').hidden, true); assert.equal(active, t.pencil);
  await t.open(); t.one('.bx-en-scrim').click(); assert.equal(t.one('.bx-en-scrim').hidden, true);
});

test('480 PC · 390 넘침 방지 · 토큰만 사용', () => {
  assert.match(CSS, /\.bx-en-sheet\{width:480px\}/);
  const css = CSS.slice(CSS.indexOf('/* 새 대화:'));
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|font-family:/i);
  assert.match(css, /min-width:0/); assert.match(css, /max-height:154px/);
});


test('시트 Esc는 PC 채팅 body 처리보다 먼저 닫힘', async () => {
  const t = setup(); await t.open();
  let reachedBody = false;
  t.body.addEventListener('keydown', () => { reachedBody = true; });
  t.one('.bx-en-text').dispatch('keydown', {key: 'Escape'});
  assert.equal(t.one('.bx-en-scrim').hidden, true); assert.equal(reachedBody, false);
});
