import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// 워커 코드는 확장자 없는 import · wasm(?module)을 씀 — 시험에서만 .ts 를 붙이고 wasm 은 빈 모듈로
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(s, c, next) {
  if (s.endsWith("?module")) return { url: "data:text/javascript,export default null", shortCircuit: true };
  if ((s.startsWith("./") || s.startsWith("../")) && !/\\.[a-z]+$/.test(s)) { try { return await next(s + ".ts", c); } catch {} }
  return next(s, c);
}`));

const { mcp } = await import("./server.ts");
const { seal } = await import("../connectors/seal.ts");

const KEY = Buffer.alloc(32, 7).toString("base64");   // 시험용 봉함 키(지어낸 값)
// 지어낸 개인정보: 주민번호 꼴 900101-1234567, Luhn 맞는 시험 카드 4111111111111111, 휴대전화 010-1234-5678
const REMOTE = { rrn: 9001011234567, card: 4111111111111111, contacts: { "010-1234-5678": "김가짜", "9001011234567": "주민번호 키" }, note: "전화 010-1234-5678" };

async function ctxWith(result: unknown) {
  const row = { id: "c_00000000000000000000", owner: "", service: "crm", label: "", kind: "url", url: "https://crm.example.com/mcp", auth: await seal(KEY, { headers: { "x-api-key": "fake" } }),
    account: "", status: "ok", error: null, tools: null, tools_at: null, off: "", read_only: 0, created_at: 0, updated_at: 0 };
  const tool = { name: "crm__find_contact", conn: row, remote: { name: "find_contact", annotations: { readOnlyHint: true } }, readOnly: true };
  // 원격 MCP(지어낸 것): initialize · tools/call 에 JSON 으로 답함
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    const m = JSON.parse(init.body);
    if (m.id === undefined) return new Response(null, { status: 202 });
    const res = m.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {} } : { content: [{ type: "text", text: JSON.stringify(result) }] };
    return Response.json({ jsonrpc: "2.0", id: m.id, result: res });
  }) as typeof fetch;
  return {
    agent: "boarder@test:%1", publicUrl: "https://boarder.example", op: async () => ({}), get: async () => ({}),
    view: { visible: () => true, why: () => null, desc: () => "", mask: () => true },
    conn: { env: { DB: {} as D1Database, CONNECTOR_KEY: KEY }, owner: "", scope: "*", catalog: async () => new Map([[tool.name, tool]]) },
  } as any;
}

async function callMcp(result: unknown) {
  const req = new Request("https://boarder.example/mcp", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "boarder_execute", arguments: { tool: "crm__find_contact", arguments: { q: "김" } } } }) });
  const r = await (await mcp(req, await ctxWith(result))).json() as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(r.result.isError, false, r.result.content[0].text);
  return r.result.content[0].text;
}

test("글 속 번호는 지금도 가려짐(기준)", async () => {
  const out = await callMcp({ note: REMOTE.note });
  assert.ok(!out.includes("010-1234-5678"), out);
});

test("숫자 값으로 온 주민번호 · 카드도 가림", async () => {
  const out = await callMcp({ rrn: REMOTE.rrn, card: REMOTE.card });
  assert.ok(!out.includes("9001011234567"), `주민번호가 그대로 나감:\n${out}`);
  assert.ok(!out.includes("4111111111111111"), `카드 번호가 그대로 나감:\n${out}`);
});

test("객체 키로 온 전화 · 주민번호도 가림", async () => {
  const out = await callMcp({ contacts: REMOTE.contacts });
  assert.ok(!out.includes("010-1234-5678"), `전화번호 키가 그대로 나감:\n${out}`);
  assert.ok(!out.includes("9001011234567"), `주민번호 키가 그대로 나감:\n${out}`);
});

test("가림을 끈 도구(mask 0)의 숫자는 그대로", async () => {
  const { shape } = await import("./registry.ts");
  assert.deepEqual(shape("crm__x", { n: 9001011234567, t: 1793170372568 }, false), { n: 9001011234567, t: 1793170372568 });
  assert.deepEqual(shape("crm__x", { t: 1793170372568, ok: true, n: 3 }, true), { t: 1793170372568, ok: true, n: 3 });   // 가릴 것 없는 숫자는 숫자 그대로
});

test("계좌: 은행 · 계좌 낱말 뒤 번호는 끝 4자리만 남김", async () => {
  const { maskText } = await import("./registry.ts");
  assert.equal(maskText("신한은행 계좌 110-123-456789 로"), "신한은행 계좌 ***-***-**6789 로");
  assert.equal(maskText("국민은행 123-45-6789012"), "국민은행 ***-**-***9012");
  assert.equal(maskText("계좌: 1002-345-678901"), "계좌: ****-***-**8901");
  assert.equal(maskText("주문번호 110-123-456789"), "주문번호 110-123-456789");   // 낱말 없음 — 그대로
});

test("계좌: 날짜 · 전화 · 사업자번호는 계좌로 안 가림", async () => {
  const { maskText } = await import("./registry.ts");
  assert.equal(maskText("계좌 정리일 2026-11-04"), "계좌 정리일 2026-11-04");
  assert.equal(maskText("은행 담당 010-1234-5678"), "은행 담당 010-****-5678");   // 휴대전화 규칙으로만
  assert.equal(maskText("은행 사업자 123-45-67890"), "은행 사업자 123-45-67890");
});

test("계좌: 키 이름이 계좌 낱말이면 값만으로 가림, mask=false 면 그대로", async () => {
  const { shape } = await import("./registry.ts");
  assert.deepEqual(shape("crm__x", { 계좌: "110-123-456789" }, true), { 계좌: "***-***-**6789" });
  assert.deepEqual(shape("crm__x", { bank_account: "110-123-456789", acct: ["1002-345-678901"], memo: "110-123-456789" }, true),
    { bank_account: "***-***-**6789", acct: ["****-***-**8901"], memo: "110-123-456789" });
  assert.deepEqual(shape("crm__x", { 계좌: "110-123-456789" }, false), { 계좌: "110-123-456789" });
});

test("계좌: 이전 규칙(주민 · 카드 · 전화)과 같은 글에서 서로 안 망가뜨림", async () => {
  const { maskText } = await import("./registry.ts");
  const out = maskText("계좌 110-123-456789, 주민 900101-1234567, 카드 4111-1111-1111-1111, 전화 02-123-4567");
  assert.equal(out, "계좌 ***-***-**6789, 주민 ******-*******, 카드 ****-****-****-1111, 전화 02-****-4567");
});

test("계좌: 계좌 꼴 뒤에 붙은 주민번호도 끝까지 가림(리뷰 P1)", async () => {
  const { maskText } = await import("./registry.ts");
  assert.equal(maskText("계좌 12-34-900101 1234567"), "계좌 **-**-****** *******");   // 겹친 구간은 숫자 전부 *
});

test("계좌: 계좌 안에 주민 · 전화 · 카드 꼴이 겹쳐도 계좌 앞자리가 안 샘(리뷰 P1 두 번째)", async () => {
  const { maskText } = await import("./registry.ts");
  assert.equal(maskText("계좌 123456-010-12345678"), "계좌 ******-***-********");
  assert.equal(maskText("계좌 123456-900101-1234567"), "계좌 ******-******-*******");
  assert.equal(maskText("계좌 4111 1111 1111-1111-12345678"), "계좌 **** **** ****-****-********");
  assert.equal(maskText("계좌 12-34-010 1234 8210 123 4567"), "계좌 **-**-*** **** **** *** ****");
  assert.equal(maskText("주민 900101-1234567, 계좌 110-123-456789"), "주민 ******-*******, 계좌 ***-***-**6789");   // 겹침 없으면 각자 규칙
});

test("계좌: 계좌 키 아래 한 단계 더 들어간 키 · 값도 가림", async () => {
  const { shape } = await import("./registry.ts");
  assert.deepEqual(shape("crm__x", { 계좌: { "110-123-456789": "예금" } }, true), { 계좌: { "***-***-**6789": "예금" } });
  assert.deepEqual(shape("crm__x", { 계좌: { 번호: "110-123-456789" } }, true), { 계좌: { 번호: "***-***-**6789" } });
});

test("계좌: 긴 글도 한 번 훑기(덩어리마다 한 번)", async () => {
  const { maskText } = await import("./registry.ts");
  const big = "계좌 110-123-456789 전화 010-1234-5678 ".repeat(30000);
  const t0 = Date.now(); const out = maskText(big);
  assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0}ms`);
  assert.ok(!out.includes("110-123-456789") && !out.includes("1234-5678"));
});
