import { test } from "node:test";
import assert from "node:assert/strict";
import { PageSnapshot } from "./snap-read.ts";
const full = (v: string, at = 1) => ({ etag: v, body: `body-${v}`, at, checked: at });

test("첫 읽기는 전체, 다음 읽기는 현재 ETag로 확인하며 새 시각·새 본문·없음을 반영", async () => {
  const reader = new PageSnapshot(), calls: string[] = [];
  let current: ReturnType<typeof full> | null = full("v1");
  const stub = { get: async () => current, getIf: async (key: string, tag: string) => {
    assert.equal(key, "page"); calls.push(tag);
    return current?.etag === tag ? { same: true as const, etag: tag, at: current.at, checked: current.checked } : current;
  } };
  assert.deepEqual(await reader.read(stub), full("v1"));
  current = full("v1", 0); assert.deepEqual(await reader.read(stub), current);
  current = full("v2", 7); assert.deepEqual(await reader.read(stub), current);
  current = null; assert.equal(await reader.read(stub), null);
  current = full("v2", 8); assert.deepEqual(await reader.read(stub), current);
  assert.deepEqual(calls, ["", "v1", "v1", "v2", ""]);
});

test("구형 DO의 동기 부재·비동기 거절은 get으로 폴백, 읽기 실패는 낡은 캐시 대신 거절", async () => {
  const reader = new PageSnapshot();
  assert.deepEqual(await reader.read({ get: async () => full("old") } as never), full("old"));
  const error = new Error("missing getIf");
  assert.deepEqual(await reader.read({ getIf: async () => { throw error; }, get: async () => full("new") }), full("new"));
  await assert.rejects(reader.read({ getIf: async () => { throw error; }, get: async () => { throw error; } }), e => e === error);
});

test("같음 응답이 늦어져도 다른 요청의 새 본문과 섞이지 않음", async () => {
  const reader = new PageSnapshot();
  await reader.read({ get: async () => null, getIf: async () => full("v1") });
  let resolve!: (x: { same: true; etag: string; at: number; checked: number }) => void;
  const slow = reader.read({ get: async () => null, getIf: () => new Promise(r => { resolve = r; }) });
  assert.deepEqual(await reader.read({ get: async () => null, getIf: async () => full("v2") }), full("v2"));
  resolve({ same: true, etag: "v1", at: 3, checked: 4 });
  assert.deepEqual(await slow, { ...full("v1"), at: 3, checked: 4 });
  const seen: string[] = [];
  await reader.read({ get: async () => null, getIf: async (_k, tag) => { seen.push(tag); return full("v2"); } });
  assert.deepEqual(seen, ["v2"]);
});

test("본문이 없는데 same이 오면 전체 get으로 복구", async () => {
  const reader = new PageSnapshot(); let got = 0;
  assert.deepEqual(await reader.read({ getIf: async () => ({ same: true, etag: "v1", at: 1, checked: 1 }), get: async () => { got++; return full("v1"); } }), full("v1"));
  assert.equal(got, 1);
});
