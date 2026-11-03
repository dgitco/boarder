import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
class FakeWS {
  readyState = 1; closed = false; sent: string[] = []; att: unknown = null;
  send(m: string) { if (this.closed) throw new TypeError("Can't call WebSocket send() after close()."); this.sent.push(m); }
  close() { this.closed = true; }
  serializeAttachment(a: unknown) { this.att = a; }
  deserializeAttachment() { return this.att; }
}
(globalThis as any).WebSocketPair = class { 0 = new FakeWS(); 1 = new FakeWS(); };
const OrigResponse = globalThis.Response;
(globalThis as any).Response = class extends OrigResponse { constructor(b: BodyInit | null, i?: ResponseInit & { webSocket?: unknown }) { super(b, i && i.status === 101 ? { status: 200 } : i); } };
const { Bridge } = await import("./bridge.ts");

function mk() {
  const socks: FakeWS[] = [];
  const ctx = { setWebSocketAutoResponse() {}, getWebSockets: () => socks, acceptWebSocket: (w: FakeWS) => socks.push(w), getWebSocketAutoResponseTimestamp: () => null };
  const b = new Bridge(ctx as never, {});
  const connect = async () => { await b.fetch(new Request("https://x/api/relay/voice/ws?keep=1", { headers: { upgrade: "websocket" } })); return socks.at(-1)!; };
  // 실행기처럼: 받은 요청에 같은 id 로 답
  const answer = (w: FakeWS) => { const m = JSON.parse(w.sent.at(-1)!); return b.webSocketMessage(w as never, JSON.stringify({ id: m.id, status: 200, headers: {}, data: btoa(m.op === "tool" ? '{"ok":true}' : "hi"), last: true })); };
  return { b, connect, answer };
}
const until = async (f: () => boolean) => { for (let i = 0; i < 400 && !f(); i++) await new Promise(ok => setTimeout(ok, 25)); assert.ok(f(), "시간 넘김"); };

test("실행기 연결이 끊긴 직후(다시 붙기 전) 온 읽기는 죽은 연결로 안 가고 다시 붙은 연결로 감", async () => {
  const { b, connect, answer } = mk();
  const w1 = await connect();
  await b.webSocketClose(w1 as never);   // 실행기 다시 켬 — 런타임은 w1 을 목록에 readyState 1 로 남김
  const p = b.call({ method: "GET", path: "/api/data", headers: {} });
  let w2: FakeWS | undefined; setTimeout(async () => { w2 = await connect(); }, 300);   // 0.3초 뒤 다시 붙음
  await until(() => !!w2 && w2.sent.length > 0);
  await answer(w2!);
  const r = await p;
  assert.equal(r.status, 200); assert.equal(new TextDecoder().decode(r.body), "hi");
});

test("에이전트 도구도 같음(끊긴 직후 → 다시 붙은 연결로)", async () => {
  const { b, connect, answer } = mk();
  const w1 = await connect();
  await b.webSocketClose(w1 as never);
  const p = b.tool("inbox", {}, "a1");
  let w2: FakeWS | undefined; setTimeout(async () => { w2 = await connect(); }, 300);
  await until(() => !!w2 && w2.sent.length > 0);
  await answer(w2!);
  assert.deepEqual(await p, { ok: true });
});

test("보내기 예외로 닫은 연결도 다음 요청이 다시 고르지 않음 — 쓰기도 보내지 않은 것이면 다시 붙은 연결로", async () => {
  const { b, connect, answer } = mk();
  const w1 = await connect();
  w1.closed = true;   // 서버 쪽에서 이미 닫힌 연결(readyState 1 로 남음)
  const p = b.call({ method: "POST", path: "/api/msg", headers: {}, body: new TextEncoder().encode("{}") });
  let w2: FakeWS | undefined; setTimeout(async () => { w2 = await connect(); }, 300);
  await until(() => !!w2 && w2.sent.length > 0);
  await answer(w2!);
  assert.equal((await p).status, 200);
  assert.equal(w1.sent.length, 0);
});

test("끊긴 뒤 실행기가 20초 안에 안 붙으면 「릴레이 없음」(보내지 않음 → 화면이 x-retry-safe 로 다시) — 죽은 연결의 send() 예외가 아님", async () => {
  const { b, connect } = mk();
  const w1 = await connect();
  await b.webSocketClose(w1 as never);
  await assert.rejects(b.call({ method: "POST", path: "/api/msg", headers: {}, body: new TextEncoder().encode("{}") }), /릴레이 없음/);
  assert.equal(w1.sent.length, 0);
});

test("실행기가 1001(stopping)으로 닫힐 때 답 없는 쓰기는 기다리지 않고 다시 붙은 연결로 다시 보냄 — 답이 오기 시작한 건 그대로", async () => {
  const { b, connect, answer } = mk();
  const w1 = await connect();
  const p = b.call({ method: "POST", path: "/api/chat", headers: {}, body: new TextEncoder().encode("{}") });
  await until(() => w1.sent.length > 0);
  await b.webSocketClose(w1 as never, 1001, "stopping");   // 실행기 다시 켬(받기 전에 닫힘)
  let w2: FakeWS | undefined; setTimeout(async () => { w2 = await connect(); }, 300);
  await until(() => !!w2 && w2.sent.length > 0);
  await answer(w2!);
  assert.equal((await p).status, 200);
  assert.equal(JSON.parse(w2!.sent[0]).path, "/api/chat");
});

test("1001 이 아닌 끊김(1006)은 예전처럼 다시 붙은 연결의 답을 기다림(keep) — 다시 보내지 않음", async () => {
  const { b, connect } = mk();
  const w1 = await connect();
  const p = b.call({ method: "POST", path: "/api/chat", headers: {}, body: new TextEncoder().encode("{}") });
  await until(() => w1.sent.length > 0);
  await b.webSocketClose(w1 as never, 1006);
  const w2 = await connect(); await new Promise(ok => setTimeout(ok, 300));
  assert.equal(w2.sent.length, 0, "1006 인데 다시 보냄");
  const id = JSON.parse(w1.sent[0]).id; await b.webSocketMessage(w2 as never, JSON.stringify({ id, status: 200, headers: {}, data: btoa("ok"), last: true }));
  assert.equal((await p).status, 200);
});

test("에이전트 도구는 1001 이어도 다시 보내지 않음(실행기가 끄는 중에도 도구를 돌려 두 번 될 수 있음) — 다시 붙은 연결의 답을 기다림", async () => {
  const { b, connect } = mk();
  const w1 = await connect();
  const p = b.tool("primary_say", {text: "x"}, "a1");
  await until(() => w1.sent.length > 0);
  await b.webSocketClose(w1 as never, 1001, "stopping");
  const w2 = await connect(); await new Promise(ok => setTimeout(ok, 300));
  assert.equal(w2.sent.length, 0, "도구를 다시 보냄");
  const id = JSON.parse(w1.sent[0]).id; await b.webSocketMessage(w2 as never, JSON.stringify({ id, status: 200, headers: {}, data: btoa('{"ok":true}'), last: true }));
  assert.deepEqual(await p, { ok: true });
});
