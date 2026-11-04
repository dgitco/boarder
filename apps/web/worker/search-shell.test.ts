// 검색 화면의 실제 렌더 함수를 작은 DOM 대역으로 실행한다. 네트워크·브라우저 캡처는 쓰지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const src = readFileSync(new URL("./legacy/shell.js", import.meta.url), "utf8");
const between = (a: string, b: string) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const render = (response: unknown) => {
  const fl = { innerHTML: "", dataset: {}, querySelector: () => ({ scrollIntoView: () => {} }) };
  const context = { esc, response, fl, fin: { value: "검색" }, window: {}, FS: { r: { q: "검색", ms: {} } }, SC: () => null, I: {}, blob: () => "", agoS: () => "방금", ARTS: {}, AREA_NAME: {}, KIND: {}, nodeGo: () => {} };
  runInNewContext(`let fres = [], fsel = 0;
    ${between("  function artThumb(", "  const fd =")}
    ${between("  function serverItems(", "  function findItems(")}
    const findItems = () => serverItems(response);
    ${between("  function hl(", "  async function fsearch(")}
    findDraw();`, context);
  return fl.innerHTML;
};

test("검색 캔버스는 공통 ?thumb·제목·태그 최대 3개, 접근성 이름과 이스케이프 유지", () => {
  const title = '검색 <설계> "판"';
  const html = render({ arts: [{ id: "a:canvas123", title, at: 1, versions: 2, folder: "dgit", tags: ["급여", "회사", '<img src=x onerror="bad">', "넷째"] }] });
  assert.match(html, /class="bx-fr bx-fr2 bx-fr-art"/);
  assert.ok(html.includes(`aria-label="${esc(title)}"`));
  assert.match(html, /role="option"/); assert.match(html, /aria-selected="true"/);
  assert.match(html, /src="\/art\/canvas123\/\?thumb"/);
  assert.match(html, /class="bx-art-thumb" aria-hidden="true"/);
  assert.match(html, /loading="lazy" tabindex="-1" sandbox="allow-scripts"/);
  assert.equal((html.match(/class="bx-fchip"/g) || []).length, 3);
  assert.ok(!html.includes("넷째")); assert.ok(!html.includes("<img"));
  assert.match(html, /2개 판/);
});

test("태그 없는 판도 미리보기, 대화·카드 줄은 기존 렌더링", () => {
  const html = render({ arts: [{ id: "a:bare", title: "검색 판" }], cards: [{ title: "검색 결정", state: "open" }], chats: [{ title: "가상인물", text: "검색 대화", kind: "chat" }] });
  assert.match(html, /\/art\/bare\/\?thumb/); assert.ok(!html.includes('class="bx-fchip"'));
  const text = html.replace(/<[^>]+>/g, "");
  assert.match(text, /검색 결정/); assert.match(text, /검색 대화/);
  assert.equal((html.match(/bx-fr-art/g) || []).length, 1);
});

test("목록과 검색이 같은 미리보기를 만들고 목록 재렌더에 중복되지 않음", () => {
  const inserted: string[] = [];
  const anchor = { dataset: { art: "shared" }, querySelector: () => inserted.length ? {} : null, insertAdjacentHTML: (_where: string, html: string) => inserted.push(html) };
  const row = { querySelector: (sel: string) => sel === ".k" ? { textContent: "캔버스" } : anchor, classList: { add: () => {} } };
  const slot = { textContent: "", innerHTML: "" }, select = () => ({ dataset: {}, value: "", innerHTML: "" });
  const folder = select(), acct = select();
  runInNewContext(`${between("  function artThumb(", "  const fd =")}
    ${between("  function mark(){", "  PC.addEventListener('change'")}
    mark(); mark();`, {
    esc, A: { v: { querySelectorAll: (sel: string) => sel === ".arow" ? [row] : [] }, top: { querySelector: () => slot }, aside: { querySelector: () => slot }, dd: { querySelector: (sel: string) => sel.includes("folder") ? folder : acct } },
    PC: { matches: true }, AQ: {}, KIND_NAME: () => ({}), ART_KIND: { canvas: "캔버스" }, ART_ACCT: {}, ARTS: {},
  });
  assert.equal(inserted.length, 1);
  const search = render({ arts: [{ id: "a:shared", title: "같은 판" }] });
  assert.ok(search.includes(inserted[0]), "목록과 찾기의 미리보기 마크업이 같아야 함");
});
