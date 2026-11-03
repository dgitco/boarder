import { test } from "node:test";
import assert from "node:assert/strict";
import * as files from "./files.ts";

const PAGE = "PageArtifact0000000000001", CANVAS = "CanvasArtifact00000000001", SECRET = "const ownerSecret = 'page art support.js 본문';\n";
function bucket(objs: Record<string, { body: string; ct?: string }>) {
  const one = (k: string) => {
    const o = objs[k]; if (!o) return null;
    const b = new TextEncoder().encode(o.body);
    return { key: k, size: b.length, httpMetadata: { contentType: o.ct }, customMetadata: {}, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length), json: async () => JSON.parse(o.body) };
  };
  const part = (k: string, r?: { offset: number; length: number }) => {   // R2 range 받기: 조각 몸통, size 는 전체
    const x = one(k); if (!x || !r) return x;
    const b = new TextEncoder().encode(objs[k].body).slice(r.offset, r.offset + r.length);
    return { ...x, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
  };
  return { get: async (k: string, o?: { range?: { offset: number; length: number } }) => part(k, o?.range), head: async (k: string) => one(k) } as unknown as R2Bucket;
}
const ix = { v: 1, at: 0, blobs: {}, shim: "", arts: {
  [PAGE]: { kind: "page", title: "주인 페이지", at: "", acct: "", auto: "", main: "index.html" },
  [CANVAS]: { kind: "canvas", title: "주인 캔버스", at: "", acct: "", auto: "" } } };
const env = { DB: {} as D1Database, RESULTS: bucket({ "art/_sys/index.json": { body: JSON.stringify(ix) }, [`art/${PAGE}/support.js`]: { body: SECRET, ct: "text/javascript" },
  [`art/${CANVAS}/project/clip.mp4`]: { body: "0123456789".repeat(50), ct: "video/mp4" } }) };
const text = (o: files.Out | null) => o ? new TextDecoder().decode(o.body) : null;

test("로그인 없는 support.js: 캔버스는 빈 support.js", async () => {
  const o = await files.answer(env, `/art/${CANVAS}/support.js`, {}, true);
  assert.equal(o?.status, 200);
  assert.equal(text(o), "window.DCLogic = class {};\n");
});

test("로그인 없는 support.js: page 아티팩트의 실제 파일(주인 것)은 안 나감", async () => {
  const o = await files.answer(env, `/art/${PAGE}/support.js`, {}, true);
  assert.notEqual(text(o), SECRET, "로그인 없이 주인 page 아티팩트 파일 본문이 나감");
  assert.equal(o?.status, 404);
});

test("로그인한 주인은 page 아티팩트의 support.js 를 그대로 받음(바뀌지 않음)", async () => {
  const o = await files.answer(env, `/art/${PAGE}/support.js`, {});
  assert.equal(text(o), SECRET);
});

test("Range: 주인 캔버스 파일은 206 조각 · 끝 n 바이트 · 파일 밖 416 · 없으면 통째 200(아이폰 사파리)", async () => {
  const o1 = await files.answer(env, `/art/${CANVAS}/clip.mp4`, { range: "bytes=0-9" });
  assert.equal(o1?.status, 206); assert.equal(o1?.headers["content-range"], "bytes 0-9/500"); assert.equal(o1?.headers["accept-ranges"], "bytes");
  assert.equal(o1?.headers["content-type"], "video/mp4"); assert.equal(text(o1), "0123456789");
  const o2 = await files.answer(env, `/art/${CANVAS}/clip.mp4`, { range: "bytes=-3" });
  assert.equal(o2?.headers["content-range"], "bytes 497-499/500"); assert.equal(text(o2), "789");
  const o3 = await files.answer(env, `/art/${CANVAS}/clip.mp4`, { range: "bytes=600-" });
  assert.equal(o3?.status, 416); assert.equal(o3?.headers["content-range"], "bytes */500");
  const o4 = await files.answer(env, `/art/${CANVAS}/clip.mp4`, {});
  assert.equal(o4?.status, 200); assert.equal(o4?.body.length, 500);
  assert.equal((await files.answer(env, `/art/${CANVAS}/nope.mp4`, { range: "bytes=0-9" })), null);   // 없는 파일은 예전처럼 null(다리로)
});

test("byteRange: 꼴이 다르면 통째(null), 여러 칸 · 빈 칸도 통째", () => {
  assert.equal(files.byteRange("bytes=0-1,5-6", 10), null); assert.equal(files.byteRange("bytes=-", 10), null); assert.equal(files.byteRange("items=0-1", 10), null);
  assert.deepEqual(files.byteRange("bytes=2-100", 10), { a: 2, z: 9 }); assert.deepEqual(files.byteRange("bytes=-20", 10), { a: 0, z: 9 });
  assert.equal(files.byteRange("bytes=0-0", 0), "bad");
});
