// node --test apps/web/worker/bxs.test.ts (Node 22.18+ 타입 지우기)
// 첫 화면 덩어리 빼기(bxs.ts): 차례 · 바이트가 그대로인지(다시 인라인으로 끼우면 원래 HTML 과 같음) · 남길 것은 남기는지 · 못 읽는 꼴은 null(인라인)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as X from "./bxs.ts";

const big = (tag: string, n = 6000) => `/*${tag}*/` + "x".repeat(n);
const KEEP = ["__BX_DATA__", "__BX_DTAG__"];
async function run(html: string, keep = KEEP) {
  const st = new X.Store();
  const r = await X.extract(html, (s, b) => st.set(s, b), keep);
  return { r, st };
}
// 브라우저가 받는 것 = 태그 자리에 그 주소 몸통 — 다시 끼우면 원래 HTML 이어야 함
const back = (html: string, st: X.Store) => html
  .replace(/<script src="\/bxs\/([0-9a-f]{32})\.js"(?: onerror="[^"]*")?><\/script>/g, (_m, s) => `<script>${st.get(s)!.body}</script>`)
  .replace(/<link rel="stylesheet" href="\/bxs\/([0-9a-f]{32})\.css"(?: id="([^"]*)")?(?: onerror="[^"]*")?>/g, (_m, s, id) => `<style${id ? ` id="${id}"` : ""}>${st.get(s)!.body}</style>`);

test("큰 고전 스크립트 · 스타일만 빼고 차례 그대로, 값 · 작은 것 · 속성 붙은 것은 인라인", async () => {
  const html = `<!doctype html><html><head><meta charset=utf-8><style>${big("css1")}</style><script>let A = 1</script>`
    + `<script>${big("lib")};let B = A + 1</script></head><body><div id=x>a < b</div>`
    + `<script>const D = __BX_DATA__; const T = "__BX_DTAG__";${"y".repeat(9000)}</script>`
    + `<script type="application/json" id=j>${big("json")}</script><script type="module">${big("mod")}</script><script nonce="abc">${big("nonce")}</script>`
    + `<script type="text/javascript">${big("app")};B</script></body></html>`;
  const { r, st } = await run(html);
  assert.ok(r);
  assert.equal(r.out, 3);
  const tags = [...r.html.matchAll(/\/bxs\/([0-9a-f]{32})\.(js|css)/g)];
  assert.deepEqual(tags.map(t => st.get(t[1])!.body.slice(0, 7)), ["/*css1*", "/*lib*/", "/*app*/"]);
  assert.ok(r.html.includes("<script>let A = 1</script>"));
  assert.ok(r.html.includes("const D = __BX_DATA__") && r.html.includes('"__BX_DTAG__"'));
  for (const k of ["json", "mod", "nonce"]) assert.ok(r.html.includes(`/*${k}*/`), k);
  assert.ok(!/defer|async/.test(r.html));
  assert.deepEqual(r.kept.map(k => k.why).sort(), ["attrs", "attrs", "attrs", "per-load", "small"]);
  // type="text/javascript" 는 떨어져도 같은 고전 스크립트 — 그것 말고는 바이트 그대로
  assert.equal(back(r.html, st), html.replace('<script type="text/javascript">', "<script>"));
  const page = r.html.replace("__BX_DATA__", () => '{"a":"<\\/script>"}').replace('"__BX_DTAG__"', () => '"e1"');
  assert.ok(page.includes(`const D = {"a":"<\\/script>"}; const T = "e1";`));
});

test("같은 몸통 = 같은 주소(틀이 그대로면 브라우저 캐시가 맞음)", async () => {
  const html = `<script>${big("a")}</script>`;
  const a = (await run(html)).r!.html, b = (await run(html)).r!.html, c = (await run(`<script>${big("a")} </script>`)).r!.html;
  assert.equal(a, b); assert.notEqual(a, c);
  assert.match(a, /^<script src="\/bxs\/[0-9a-f]{32}\.js"(?: onerror="[^"]*")?><\/script>$/);
});

test("주석 · textarea · 속성 값 · 다른 스크립트 글 안의 <script> 는 태그로 안 읽음", async () => {
  const html = `<!-- <script>${big("c")}</script> --><textarea><script>${big("t")}</script></textarea>`
    + `<div title="<script>${big("attr")}</script>">.</div><script>var s = "<script>" + "<\\/script>";${big("real")}</script>`
    + `<title><style>${big("ti")}</style></title>`;
  const { r, st } = await run(html);
  assert.ok(r);
  assert.equal(r.out, 1);
  const sha = /\/bxs\/([0-9a-f]{32})\.js/.exec(r.html)![1];
  assert.ok(st.get(sha)!.body.startsWith('var s = "<script>"'));
  assert.equal(back(r.html, st), html);
});

test("닫는 태그 막기(<\\/script>) 든 몸통은 바이트 그대로, 닫는 태그 대소문자 · 공백", async () => {
  const body = `document.body.insertAdjacentHTML("beforeend", "<script><\\/script>");${big("e")}`;
  const html = `<SCRIPT>${body}</script ><Style id='s"x'>${big("s")}</STYLE>`;
  const { r, st } = await run(html);
  assert.ok(r); assert.equal(r.out, 2);
  assert.equal(st.get(/\/bxs\/([0-9a-f]{32})\.js/.exec(r.html)![1])!.body, body);
  assert.ok(r.html.includes(' id="s&quot;x"'));
});

test("스타일: id 는 link 로 옮기고, 상대 url · @import · 다른 속성은 인라인", async () => {
  const html = `<style id="hbx-css">${big("ok")} .a{background:url(data:image/png;base64,AA)} .b{background:url("/icons/x.png")} .c{background:url(#g)}</style>`
    + `<style>.r{background:url(img/x.png)}${big("rel")}</style><style>@import "x.css";${big("imp")}</style><style media="print">${big("media")}</style>`;
  const { r } = await run(html);
  assert.ok(r); assert.equal(r.out, 1);
  assert.match(r.html, /^<link rel="stylesheet" href="\/bxs\/[0-9a-f]{32}\.css" id="hbx-css"(?: onerror="[^"]*")?>/);
  assert.deepEqual(r.kept.map(k => k.why), ["relative-url", "relative-url", "attrs"]);
});

test("currentScript 를 쓰는 스크립트는 인라인(제 글을 읽을 수 있음)", async () => {
  const { r } = await run(`<script>document.currentScript.textContent;${big("cs")}</script>`);
  assert.ok(r); assert.equal(r.out, 0); assert.equal(r.kept[0].why, "currentScript");
});

test("못 읽는 꼴 → null(부르는 쪽이 전부 인라인)", async () => {
  for (const bad of [`<script>${big("a")}`, `<!-- ${big("a")}`, `<div a="b>${big("a")}`, `<script>a<!--<script>${big("a")}</script>`]) {
    assert.equal((await run(bad)).r, null, bad.slice(0, 20));
  }
});

test("껍데기 pack: 보낸 몸통(닫는 태그 막은 것) 그대로 · 차례 그대로 · css id", async () => {
  const st = new X.Store(), esc = (s: string) => s.replace(/<\//g, "<\\/");
  const shell = "let x = '</div>'; " + big("shell"), set = big("set");
  const h = await X.pack([{ kind: "js", body: esc(shell) }, { kind: "js", body: set }], (s, b) => st.set(s, b));
  const c = await X.pack([{ kind: "css", body: big("c"), id: "hbx-css" }], (s, b) => st.set(s, b));
  const ids = [...h.matchAll(/\/bxs\/([0-9a-f]{32})\.js/g)].map(m => m[1]);
  assert.deepEqual(ids.map(i => st.get(i)!.body), [esc(shell), set]);
  assert.ok(st.get(ids[0])!.body.includes("'<\\/div>'"));
  assert.match(c, /^<link rel="stylesheet" href="\/bxs\/[0-9a-f]{32}\.css" id="hbx-css"(?: onerror="[^"]*")?>$/);
  assert.match(X.PATH.exec(`/bxs/${ids[0]}.js`)![1], /^[0-9a-f]{32}$/);
  assert.equal(X.PATH.exec(`/bxs/${ids[0]}.js?x`), null);
});

test("Store: 한도를 넘으면 오래 안 쓴 것부터", () => {
  const st = new X.Store(10);
  st.set("a", { kind: "js", body: "1234" }); st.set("b", { kind: "js", body: "1234" });
  st.get("a"); st.set("c", { kind: "js", body: "1234" });
  assert.ok(st.get("a") && st.get("c") && !st.get("b"));
});
