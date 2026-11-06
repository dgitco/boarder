import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);
const { newMeter, meterEnv, meterProps } = await import("./perf.ts");

test("DO 계측은 RPC Promise와 this·응답을 그대로 유지하며 바인딩·메서드별로 셈", async () => {
  const m = newMeter(), reply = { body: "private" }, arg = "private@example.com";
  let resolve!: (x: typeof reply) => void;
  const p = new Promise<typeof reply>(r => { resolve = r; });
  const stub = { id: "private-id", get(k: string) { assert.equal(this, stub); assert.equal(k, arg); return p; } };
  const ns = { get() { assert.equal(this, ns); return stub; }, idFromName(n: string) { return n; } };
  const env = meterEnv({ DB: {} as D1Database, SNAP: ns }, m);
  assert.equal(env.SNAP.get().id, stub.id);
  assert.equal(env.SNAP.get().get(arg), p);
  assert.equal(m.dobn, 0); resolve(reply); assert.equal(await p, reply);
  assert.equal(m.dobn, 1); assert.equal(m.doCalls.snap_get.n, 1);
  const props = meterProps(m);
  assert.equal(props.do_snap_get_n, 1);
  assert.equal(props.do_snap_get_ms, m.dob);
  assert.equal(props.do_snap_get_max_ms, m.dob);
  assert.ok(!JSON.stringify(props).includes("private"));
});

test("병렬 RPC·거절·동기 결과도 바인딩별로 세고 거절은 그대로 전달함", async () => {
  const m = newMeter(), error = new Error("private"), failure = Promise.reject(error);
  const env = meterEnv({ DB: {} as D1Database,
    SNAP: { get: () => ({ getMany: () => Promise.resolve([null, null]) }) },
    BRIDGE: { getByName: () => ({ request: () => failure, count: () => 3 }) } }, m);
  assert.equal(env.BRIDGE.getByName().request(), failure);
  await assert.rejects(failure, e => e === error);
  assert.equal(env.BRIDGE.getByName().count(), 3);
  await Promise.all([env.SNAP.get().getMany(), env.SNAP.get().getMany()]);
  assert.equal(m.dobn, 4);
  assert.equal(m.doCalls.snap_getMany.n, 2);
  assert.equal(m.doCalls.bridge_request.n, 1);
  assert.equal(m.doCalls.bridge_count.n, 1);
});


test("page/data만 따로 재며 본문 길이·same 횟수만 남기고 ETag·내용·다른 열쇠는 남기지 않음", async () => {
  const m = newMeter(), source = "secret-body", tag = "secret-etag";
  const env = meterEnv({ DB: {} as D1Database, SNAP: { get: () => ({
    get: async (_key: string) => ({ body: source, etag: tag }),
    getIf: async (_key: string, _tag: string) => ({ same: true, etag: tag }),
  }) } }, m);
  const stub = env.SNAP.get();
  await stub.get("page"); await stub.get("data"); await stub.get("private@example.com"); await stub.getIf("page", tag);
  const p = meterProps(m);
  assert.equal(p.do_snap_get_n, 3); assert.equal(p.do_snap_get_page_n, 1);
  assert.equal(p.do_snap_get_page_body_chars, source.length);
  assert.equal(p.do_snap_get_data_body_chars, source.length);
  assert.equal(p.do_snap_getIf_page_same_n, 1); assert.equal(p.do_snap_getIf_page_body_chars, 0);
  assert.ok(!JSON.stringify(p).includes("secret")); assert.ok(!JSON.stringify(p).includes("private"));
});
