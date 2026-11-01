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
const FOLDERS = {folders: [{path: '/projects/acme', title: '세금 업무', area: 'company'}, {path: '/projects/DGit/boarder', title: '보더', area: 'dgit'}]};
const J = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status});
function setup(answer = (url: string, _init: any): Response | Promise<Response> => url.endsWith('folders') ? J(FOLDERS) : J({ok: true, pane: 'new-pane', name: '새 작업'})) {
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
  const chooseFolder = () => one('[role="listbox"]').querySelectorAll('[role="option"]')[1].click();
  return {ctx, body, doc, cnew, panes, calls, opened, one, pencil, settle, advance, open, chooseFolder};
}

test('연필 → dialog · folders 한 번 · 비서 blob과 폴더 · 거르기 · 키보드 선택 칩과 해제', async () => {
  const t = setup(); assert.equal(t.calls.length, 0); await t.open();
  const dialog = t.one('[role="dialog"]'), input = t.one('[role="combobox"]'), opts = t.one('[role="listbox"]');
  assert.equal(dialog.getAttribute('aria-modal'), 'true'); assert.equal(t.one('.bx-es-title').textContent, '새 대화');
  assert.equal(input.getAttribute('aria-autocomplete'), 'list'); assert.equal(active, input);
  assert.equal(t.calls.length, 1); assert.equal(t.calls[0].url, 'api/session/folders');
  assert.equal(opts.querySelectorAll('[role="option"]').length, 3); assert.match(opts.textContent, /비서지금 비서 채널에 이어서/);
  assert.ok(t.one('.bx-en-avatar').querySelector('svg'));
  assert.deepEqual(opts.querySelectorAll('.bx-ea-status').map(e => e.textContent), ['회사', 'DGit']);
  input.value = 'dGiT'; input.dispatch('input'); assert.equal(opts.querySelectorAll('[role="option"]').length, 1); assert.match(opts.textContent, /보더/);
  input.value = '세금'; input.dispatch('input'); assert.equal(opts.querySelectorAll('[role="option"]').length, 1);
  input.dispatch('keydown', {key: 'ArrowDown'}); assert.equal(input.getAttribute('aria-activedescendant'), 'bx-en-option-0');
  input.dispatch('keydown', {key: 'Enter', isComposing: true}); assert.equal(input.hidden, false);
  input.dispatch('keydown', {key: 'Enter'}); assert.equal(opts.hidden, true); assert.equal(input.hidden, true); assert.match(t.one('.bx-en-chip').textContent, /세금 업무/);
  assert.equal(t.one('.bx-en-start').disabled, false);
  t.one('.bx-en-chip').querySelector('.bx-es-ib').click(); assert.equal(opts.hidden, false); assert.equal(input.hidden, false);
  assert.equal(t.one('.bx-en-start').disabled, true); assert.equal(t.calls.length, 1);
  input.dispatch('keydown', {key: 'ArrowUp'}); input.dispatch('keydown', {key: 'Enter'}); assert.match(t.one('.bx-en-chip').textContent, /보더/);
});

test('비서 시작 = primary + cnew 값과 input만 · 조합 Enter와 Shift+Enter 무시', async () => {
  const t = setup(); await t.open(); const go = t.one('.bx-en-start'); assert.equal(go.disabled, true); go.click(); assert.deepEqual(t.opened, []);
  t.one('[role="option"]').click(); const text = t.one('.bx-en-text'); text.value = '첫 말\n둘째 줄';
  let inputs = 0; t.cnew.addEventListener('input', () => inputs++);
  text.dispatch('keydown', {key: 'Enter', isComposing: true}); text.dispatch('keydown', {key: 'Enter', shiftKey: true}); assert.deepEqual(t.opened, []);
  text.scrollHeight = 500; text.dispatch('input'); assert.equal(text.style.height, '154px');
  text.dispatch('keydown', {key: 'Enter'});
  assert.deepEqual(t.opened, ['chan:primary']); assert.equal(t.cnew.value, text.value); assert.equal(inputs, 1);
  assert.equal(t.calls.length, 1); assert.equal(t.one('.bx-en-scrim').hidden, true); assert.equal(active, t.cnew);
});

test('폴더 POST 몸통 · 스피너 · 중복 방지 · 임시 줄 → panes 도착 후 openNode', async () => {
  let resolve!: (r: Response) => void;
  const t = setup(url => url.endsWith('folders') ? J(FOLDERS) : new Promise(r => { resolve = r; }));
  await t.open(); t.chooseFolder(); const text = t.one('.bx-en-text'); text.value = '작업 시작';
  const start = t.one('.bx-en-start'); start.click(); start.click(); text.dispatch('keydown', {key: 'Enter'});
  assert.equal(start.disabled, true); assert.ok(start.querySelector('.bx-es-spin')); assert.equal(start.textContent.includes('중'), false); assert.equal(t.calls.length, 2);
  const req = t.calls[1]; assert.equal(req.url, 'api/session/new'); assert.equal(req.init.method, 'POST');
  assert.deepEqual(JSON.parse(req.init.body), {folder: '/projects/acme', text: '작업 시작'});
  assert.equal(req.init.headers['content-type'], 'application/json'); assert.equal(req.init.headers['x-hb'], '1'); assert.equal(req.init.credentials, 'same-origin');
  resolve(J({ok: true, pane: 'new-pane', name: '새 작업'})); await t.settle();
  assert.equal(t.one('.bx-en-scrim').hidden, true); assert.match(t.one('.bx-en-pending').textContent, /새 작업여는 중/);
  assert.equal(t.one('.bx-ea-rows').children[0], t.one('.bx-en-pending'));
  t.one('.bx-en-pending').click(); assert.deepEqual(t.opened, []);
  t.advance(1000); assert.deepEqual(t.opened, []); t.panes.push({pane: 'new-pane', win: '새 작업'}); t.advance(1000);
  assert.equal(t.one('.bx-en-pending'), null); assert.deepEqual(t.opened, ['node:new-pane']); assert.match(t.one('.bx-ea-rows').textContent, /새 작업/);
});

test('실패 답 · 네트워크 실패는 한 줄 오류와 입력 유지', async () => {
  for (const fail of [() => J({ok: false}), () => J({}, 500), () => { throw Error('network'); }]) {
    const t = setup(url => url.endsWith('folders') ? J(FOLDERS) : fail()); await t.open(); t.chooseFolder();
    t.one('.bx-en-text').value = '보존할 말'; t.one('.bx-en-start').click(); await t.settle();
    assert.equal(t.one('.bx-es-err').hidden, false); assert.equal(t.one('.bx-es-err').textContent, '일시적인 오류가 발생했어요');
    assert.equal(t.one('.bx-en-text').value, '보존할 말'); assert.equal(t.one('.bx-en-chip').hidden, false);
    assert.equal(t.one('.bx-en-start').disabled, false); assert.equal(t.one('.bx-en-scrim').hidden, false);
  }
});

test('folders 404 · 실패면 비서 하나 · 다시 열면 다시 조회', async () => {
  for (const answer of [() => J({}, 404), () => { throw Error('network'); }]) {
    const t = setup(answer); await t.open(); assert.equal(t.one('[role="listbox"]').querySelectorAll('[role="option"]').length, 1);
    t.doc.dispatch('keydown', {key: 'Escape'}); await t.open(); assert.equal(t.calls.length, 2);
  }
});

test('Esc · 바깥 닫기 · 포커스 가둠과 복귀 · 오래된 folders 답 무시', async () => {
  let resolve!: (r: Response) => void;
  const t = setup(() => new Promise(r => { resolve = r; })); await t.open(); const dialog = t.one('[role="dialog"]');
  for (let i = 0; i < 10; i++) { t.doc.dispatch('keydown', {key: 'Tab', shiftKey: i % 2 === 0}); assert.ok(dialog.contains(active!)); }
  dialog.click(); assert.equal(t.one('.bx-en-scrim').hidden, false);
  t.doc.dispatch('keydown', {key: 'Escape'}); assert.equal(t.one('.bx-en-scrim').hidden, true); assert.equal(active, t.pencil);
  const old = resolve; await t.open(); old(J(FOLDERS)); await t.settle();
  assert.equal(t.one('[role="listbox"]').querySelectorAll('[role="option"]').length, 1);
  t.one('.bx-en-scrim').click(); assert.equal(t.one('.bx-en-scrim').hidden, true);
});

test('3분 넘으면 임시 줄 오류 후 제거, 판을 열지 않음', async () => {
  const t = setup(); await t.open(); t.chooseFolder(); t.one('.bx-en-start').click(); await t.settle();
  t.advance(179000); assert.match(t.one('.bx-en-pending').textContent, /여는 중/);
  t.advance(1000); assert.match(t.one('.bx-en-pending').textContent, /일시적인 오류가 발생했어요/);
  assert.equal(t.one('.bx-en-pending').querySelector('.bx-es-spin'), null);
  t.advance(2000); assert.equal(t.one('.bx-en-pending'), null); assert.deepEqual(t.opened, []);
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
