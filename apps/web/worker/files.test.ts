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
  return { get: async (k: string) => one(k), head: async (k: string) => one(k) } as unknown as R2Bucket;
}
const ix = { v: 1, at: 0, blobs: {}, shim: "", arts: {
  [PAGE]: { kind: "page", title: "주인 페이지", at: "", acct: "", auto: "", main: "index.html" },
  [CANVAS]: { kind: "canvas", title: "주인 캔버스", at: "", acct: "", auto: "" } } };
const env = { DB: {} as D1Database, RESULTS: bucket({ "art/_sys/index.json": { body: JSON.stringify(ix) }, [`art/${PAGE}/support.js`]: { body: SECRET, ct: "text/javascript" } }) };
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
