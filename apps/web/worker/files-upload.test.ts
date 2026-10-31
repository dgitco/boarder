import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { default: app } = await import("./index.ts");
const files = await import("./files.ts");
const emoji = await import("./emoji.ts");

// 가짜 R2: put · get · head · delete. beforeDelete = 지우기가 실제로 지우기 직전에 끼어들 일(다른 요청)
function r2() {
  const m = new Map<string, { b: Uint8Array; ct?: string; meta: Record<string, string> }>(), hook: { beforeDelete: null | (() => Promise<unknown>) } = { beforeDelete: null };
  const obj = (k: string, range?: { offset: number; length: number }) => {
    const o = m.get(k); if (!o) return null;
    const b = range ? o.b.slice(range.offset, range.offset + range.length) : o.b;
    return { key: k, size: o.b.length, httpMetadata: { contentType: o.ct }, customMetadata: o.meta, body: new Response(b as BodyInit).body,
      arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length), json: async () => JSON.parse(new TextDecoder().decode(b)) };
  };
  const bucket = {
    put: async (k: string, v: ArrayBuffer | Uint8Array, o?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => { m.set(k, { b: new Uint8Array(v instanceof Uint8Array ? v : new Uint8Array(v)).slice(), ct: o?.httpMetadata?.contentType, meta: o?.customMetadata || {} }); },
    get: async (k: string, o?: { range?: { offset: number; length: number } }) => obj(k, o?.range),
    head: async (k: string) => obj(k),
    delete: async (k: string) => { const h = hook.beforeDelete; hook.beforeDelete = null; if (h) await h(); m.delete(k); },
  } as unknown as R2Bucket;
  return { m, hook, bucket };
}
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0032_emoji.sql", import.meta.url), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }),
    first: async () => (db.prepare(sql).get(...(args as never[])) as object | undefined) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => Promise.all(ss.map(s => s.all())) } as unknown as D1Database;
}

test("릴레이 첨부: 긴 한글 파일 이름(600자 넘게 인코딩)도 내려받기 이름이 id 로 바뀌지 않음", async () => {
  const { bucket } = r2(), env = { RESULTS: bucket, DB: d1(), RELAY_TOKEN: "relay-token-made-up" };
  // 헤더는 ASCII 만 되니 릴레이는 이름을 퍼센트 인코딩해 보냄(files.ts attach 가 unq 로 풂). 한글 70자 = 인코딩 630자
  const name = "회의록".repeat(23) + "끝.pdf", id = "F0TESTLONG01";
  const put = await app.fetch(new Request(`https://example.test/api/relay/file?key=files/${id}`, { method: "PUT",
    headers: { authorization: "Bearer relay-token-made-up", "content-type": "application/pdf", "x-file-name": encodeURIComponent(name) }, body: new TextEncoder().encode("%PDF-made-up") }),
    env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(put.status, 200);
  const o = await files.answer(env as never, `/api/file/${id}`, {});
  assert.equal(o?.status, 200);
  const cd = o!.headers["content-disposition"], got = decodeURIComponent(cd.split("''")[1]);
  assert.notEqual(got, id, "내려받기 이름이 첨부 id 로 바뀜(이름을 잃음)");
  assert.ok(name.startsWith(got) && got.length > 50, `잘려도 앞부분은 그대로여야 함: ${got}`);
});

test("릴레이 첨부: 짧은 이름 · 600자 안 이름은 그대로", async () => {
  const { bucket } = r2(), env = { RESULTS: bucket, DB: d1(), RELAY_TOKEN: "relay-token-made-up" };
  for (const [id, name] of [["F0TESTSHORT1", "보고서 100%.pdf"], ["F0TESTEXACT1", "가".repeat(66) + ".pdf"]]) {
    await app.fetch(new Request(`https://example.test/api/relay/file?key=files/${id}`, { method: "PUT",
      headers: { authorization: "Bearer relay-token-made-up", "content-type": "application/pdf", "x-file-name": encodeURIComponent(name) }, body: new TextEncoder().encode("x") }),
      env, { waitUntil() {}, passThroughOnException() {} });
    const o = await files.answer(env as never, `/api/file/${id}`, {});
    assert.equal(decodeURIComponent(o!.headers["content-disposition"].split("''")[1]), name);
  }
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const STD = new Set(["smile"]);

test("이모지: 지우는 사이 같은 이름 · 같은 그림을 다시 올리면 — 새 줄의 그림이 남아 있어야 함", async () => {
  const { hook, bucket } = r2(), env = { RESULTS: bucket, DB: d1() };
  assert.equal((await emoji.add(env, "a@example.test", "party", "image/png", PNG.slice().buffer, STD))[0], 200);
  // 지우기: 줄 지움 → 「이 키를 쓰는 줄 없음」 확인 → (그 사이 다른 사람이 같은 이름 · 같은 그림으로 다시 올림) → 그림 지움
  let again: [number, object] | null = null;
  hook.beforeDelete = async () => { again = await emoji.add(env, "b@example.test", "party", "image/png", PNG.slice().buffer, STD); };
  assert.equal((await emoji.remove(env, "a@example.test", false, "party"))[0], 200);
  assert.equal(again![0], 200, "다시 올리기는 됨");
  const { org } = await emoji.list(env, null, false);
  assert.equal(org.length, 1);
  const img = await emoji.image(env, org[0].url.slice("emoji/i/".length));
  assert.ok(img, "목록에 있는 이모지의 그림이 R2 에 없음(깨진 그림)");
});

test("이모지: 그냥 지우면 그림도 지워짐 · 같은 이름 동시 둘은 하나만", async () => {
  const { m, bucket } = r2(), env = { RESULTS: bucket, DB: d1() };
  const [a, b] = await Promise.all([emoji.add(env, "a@example.test", "dup", "image/png", PNG.slice().buffer, STD), emoji.add(env, "b@example.test", "dup", "image/png", PNG.slice().buffer, STD)]);
  assert.deepEqual([a[0], b[0]].sort(), [200, 409]);
  const url = (await emoji.list(env, null, false)).org[0].url;
  assert.equal((await emoji.remove(env, "a@example.test", true, "dup"))[0], 200);
  assert.equal((await emoji.list(env, null, false)).org.length, 0);
  assert.equal(m.has("emoji/" + url.slice("emoji/i/".length)), false, "지운 이모지의 그림이 남음");
});
