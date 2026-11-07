// 실제 보드 apiChat: 수정 · 삭제의 낙관 갱신은 실행기 결과가 성공해야 확정된다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
const code = html.slice(html.indexOf("async function apiChat(body)"), html.indexOf("function flipReact"));
function setup(answers: { status: number; body: object }[]) {
  const calls: { path: string; body?: any }[] = [];
  const api = runInNewContext(code + "; apiChat", {
    fetch: async (path: string, init?: { body: string }) => {
      calls.push({ path, ...(init ? { body: JSON.parse(init.body) } : {}) });
      const a = answers.shift(); assert.ok(a, "예정 밖 요청");
      return { ok: a.status < 400, status: a.status, json: async () => a.body };
    }, newRid: () => "edit-rid-test", setTimeout: (f: () => void) => f(),
  });
  return { api, calls };
}

test("수정: queued 동안 기다리고 실행기의 edited 결과로 성공", async () => {
  const s = setup([{ status: 202, body: { ok: true, rid: "edit-rid-test", state: "queued" } }, { status: 200, body: { state: "queued" } }, { status: 200, body: { state: "ok", edited: "1.2" } }]);
  assert.equal((await s.api({ edit: "고침", ts: "1.2" })).edited, "1.2");
  assert.deepEqual(s.calls.map(c => c.path), ["api/chat", "api/answer/edit-rid-test", "api/answer/edit-rid-test"]);
  assert.equal(s.calls[0].body.rid, "edit-rid-test");
});

test("삭제: 처리기 실패 · unknown 은 거절되어 화면이 낙관 갱신을 되돌림", async () => {
  for (const a of [{ status: 200, body: { state: "fail", error: "내 글이 아님" } }, { status: 404, body: { state: "unknown" } }]) {
    const s = setup([{ status: 202, body: { rid: "edit-rid-test", state: "queued" } }, a]);
    await assert.rejects(s.api({ delete: true, ts: "1.2" }));
  }
});

test("옛 즉시 수정 답 · 반응은 추가 요청 없이 그대로 성공", async () => {
  for (const [body, result] of [[{ edit: "고침" }, { state: "ok", edited: "1.2" }], [{ react: "eyes" }, { state: "queued", rid: "react-test" }]]) {
    const s = setup([{ status: 200, body: result }]);
    assert.equal((await s.api(body)).state, result.state);
    assert.equal(s.calls.length, 1);
  }
});
