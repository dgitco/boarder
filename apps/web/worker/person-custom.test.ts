// node --test --no-warnings --experimental-transform-types apps/web/worker/person-custom.test.ts (Node 22.18+ · node:sqlite)
// 사람별 덧씌우기 저장 · 값 우선순위(그 사람 값 > 래퍼 값 > 코드 기본값) · 태그 이스케이프 · 프롬프트 칸 · 사이드 래퍼 값. 가짜 D1 = 메모리 SQLite + migrations 전부.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (s === "better-auth" || s === "better-auth/plugins") return { url: "data:text/javascript,export const betterAuth = () => ({}); export const emailOTP = () => ({});", shortCircuit: true };
  if (s === "better-auth/crypto") return { url: "data:text/javascript,export const symmetricEncrypt = async () => ''; export const symmetricDecrypt = async () => '';", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const pc = await import("./person-custom.ts");
const { readSide, readPins, saveSide } = await import("./side-order.ts");
const { promptsOf, MAIN_HELLO, DEFAULT_ROLES } = await import("./engine.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { db, D1: { prepare: (sql: string) => stmt(sql) } as unknown as D1Database };
}
const A = "a@example.com", B = "b@example.com";

test("글 거르기: 문자열만 · 200KB 를 넘으면 null · 빈 글은 비움", () => {
  assert.equal(pc.cleanText(5), null);
  assert.equal(pc.cleanText(""), "");
  assert.equal(pc.cleanText("x".repeat(200_001)), null);
  assert.equal(pc.cleanText("가".repeat(70_000)), null, "바이트로 셈 — 한글은 3바이트");
  assert.equal(pc.cleanText("x".repeat(200_000))?.length, 200_000);
});

test("저장은 보낸 칸만 바꿈 · 사람마다 따로", async () => {
  const { D1 } = d1();
  await pc.savePatch(D1, A, { css: "a{}", js: "1" });
  await pc.savePatch(D1, A, { wcss: "w{}" });
  await pc.savePatch(D1, B, { css: "b{}" });
  const a = (await pc.readOverlay(D1, A))!;
  assert.deepEqual([a.css, a.js, a.wcss], ["a{}", "1", "w{}"]);
  assert.equal((await pc.readOverlay(D1, B))!.js, "");
  await pc.savePatch(D1, A, { css: null });
  assert.equal((await pc.readOverlay(D1, A))!.css, "");
  assert.equal((await pc.readOverlay(D1, "none@example.com")), null);
});

test("우선순위: 칸마다 그 사람 값이 비었을 때만 래퍼 값", async () => {
  const { D1 } = d1();
  await pc.savePatch(D1, A, { wcss: "w{}", wjs: "wj", wjs_sha: "x" });
  assert.deepEqual(pc.effective((await pc.readOverlay(D1, A))!), { css: "w{}", js: "wj" });
  await pc.savePatch(D1, A, { css: "mine{}" });
  assert.deepEqual(pc.effective((await pc.readOverlay(D1, A))!), { css: "mine{}", js: "wj" }, "css 만 그 사람 값, js 는 래퍼 값");
  await pc.savePatch(D1, A, { css: null });
  assert.equal(pc.effective((await pc.readOverlay(D1, A))!).css, "w{}");
});

test("태그: 껍데기를 닫는 글이 들어 있어도 한 칸 안의 글자일 뿐", () => {
  const evil = "</script><script>window.pwned=1</script><!-- </style>  ";
  const o = { css: evil, js: evil, wcss: "", wjs: "", wjsSha: "", wside: null };
  const t = pc.overlayTags(o)!;
  for (const html of [t.head, t.body]) {
    assert.equal(html.split("</script>").length - 1, 1, "닫는 태그는 우리 것 하나뿐");
    assert.ok(!html.includes("<!--") && !html.includes("</style>"), "열거나 닫는 꼴이 글에 그대로 남지 않음");
  }
  // 글을 되살리면 원문 그대로
  const lit = (h: string) => JSON.parse(/textContent=(".*")\;/.exec(h)![1]);
  assert.equal(lit(t.head), evil); assert.equal(lit(t.body), evil);
  assert.equal(pc.overlayTags(null), null);
  assert.equal(pc.overlayTags({ css: "", js: "", wcss: "", wjs: "", wjsSha: "", wside: null }), null);
});

test("래퍼 사이드 값: 그 사람 값이 없으면 래퍼 값, 있으면 그 사람 값", async () => {
  const { D1 } = d1();
  assert.equal(await readSide(D1, A), null);
  await pc.savePatch(D1, A, { wside: JSON.stringify({ side: ["ch", "ib"], pins: [{ id: "abcd1234", title: "판" }] }) });
  assert.deepEqual(await readSide(D1, A), ["ch", "ib"]);
  assert.deepEqual(await readPins(D1, A), [{ id: "abcd1234", title: "판" }]);
  assert.equal(await readSide(D1, B), null, "다른 사람은 영향 없음");
  await saveSide(D1, A, ["rc", "ch"]);
  assert.deepEqual(await readSide(D1, A), ["rc", "ch"], "그 사람이 끌어 놓은 순서가 이김");
  assert.deepEqual(pc.cleanWrapperSide({ side: ["zz"] }), null);
  assert.deepEqual(pc.cleanWrapperSide({ side: ["ib"] }), { side: ["ib"], pins: null });
});

test("역할 거르기: 꼴이 틀리면 통째로 거절 · 경로 글자 id 금지", () => {
  const ok = { id: "plan-1", name: "정리", brief: "한 줄", instructions: "Do the thing." };
  assert.deepEqual(pc.cleanRoles([ok]), [ok]);
  for (const bad of [[{ ...ok, id: "../x" }], [{ ...ok, id: "A" }], [ok, ok], [{ ...ok, name: "" }], [{ ...ok, instructions: "" }], [{ ...ok, name: "x".repeat(41) }], Array(13).fill(0).map((_, i) => ({ ...ok, id: `r${i}` })), "x", [null]]) assert.equal(pc.cleanRoles(bad as never), null);
});

test("엔진 프롬프트: 그 사람 값이 있으면 그것, 없으면 코드 기본값", async () => {
  const { D1 } = d1();
  assert.deepEqual(await promptsOf(D1, A), { mainHello: MAIN_HELLO, roles: DEFAULT_ROLES });
  const roles = [{ id: "mine", name: "내 역할", brief: "b", instructions: "i" }];
  await pc.savePatch(D1, A, { p_main: "첫 글", p_roles: JSON.stringify(roles) });
  assert.deepEqual(await promptsOf(D1, A), { mainHello: "첫 글", roles });
  assert.equal((await promptsOf(D1, B)).mainHello, MAIN_HELLO, "다른 사람은 기본값");
  await pc.savePatch(D1, A, { p_main: null, p_roles: "깨진 값" });
  assert.deepEqual(await promptsOf(D1, A), { mainHello: MAIN_HELLO, roles: DEFAULT_ROLES }, "깨진 값은 기본값으로");
});

test("0059 마이그레이션은 더하기만(기존 표를 건드리지 않음)", () => {
  const sql = readFileSync(new URL("0059_person_custom.sql", MIG), "utf8").split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
  assert.match(sql, /create table if not exists person_custom/i);
  assert.doesNotMatch(sql, /\b(drop|alter|delete|update)\b/i);
});
