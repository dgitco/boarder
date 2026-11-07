// React 머리의 차례 수: 회원 API 를 읽어 열린 카드와 attn 교집합을 센다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { stripTypeScriptTypes } from "node:module";
const source = readFileSync(new URL("../src/lib/board.ts", import.meta.url), "utf8").replace(/^import .*$/m, "").replace(/export /g, "");

test("React 차례 수는 /api/data 의 열린 카드 · attn 으로, 스냅숏 요청 없음", async () => {
  let effect: (() => void) | undefined, data: any, finish!: () => void;
  const loaded = new Promise<void>(r => { finish = r; }), paths: string[] = [];
  const dataFromMember = { cardlist: [{ ts: "a", state: "open" }, { ts: "b", state: "open" }, { ts: "c", state: "answered" }], attn: [{ ts: "a" }, { ts: "c" }] };
  const { useBoard, attnCount } = runInNewContext(stripTypeScriptTypes(source) + "; ({ useBoard, attnCount })", {
    useEffect: (f: () => void) => { effect = f; }, useState: () => [null, (v: any) => { data = v; finish(); }], useRef: () => ({ current: "" }),
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} }, setInterval: () => 1, clearInterval() {},
    fetch: async (path: string) => { paths.push(path); return { ok: true, status: 200, headers: { get: () => "etag" }, json: async () => dataFromMember }; },
  });
  useBoard(); effect!(); await loaded;
  assert.deepEqual(paths, ["/api/data"]); assert.equal(attnCount(data), 1);
  assert.equal(attnCount({ cardlist: dataFromMember.cardlist, attn: null }), 2);
});
