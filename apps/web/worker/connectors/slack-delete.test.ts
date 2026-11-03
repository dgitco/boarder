// node --test --no-warnings --experimental-transform-types apps/web/worker/connectors/slack-delete.test.ts
// Slack 「글 지우기」(delete_message): chat.delete 를 채널·ts 로 부르고, Slack 오류는 글로 돌려준다. 바깥 호출 없음(call 은 가짜), 값은 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../test-hooks.mjs", import.meta.url);
const { API_PRESETS } = await import("./apis.ts");
const tool = API_PRESETS.slack.tools.find((t: any) => t.name === "delete_message")!;
const fakeCall = (reply: unknown, seen: any[]) => async (path: string, init: any) => { seen.push({ path, init }); return new Response(JSON.stringify(reply), { status: 200 }); };

test("delete_message: chat.delete 에 channel · ts 를 POST 로 보내고 지운 줄을 돌려줌", async () => {
  const seen: any[] = [];
  const r: any = await tool.run(fakeCall({ ok: true, channel: "C1", ts: "1.2" }, seen) as any, { channel: "C1", ts: "1.2" });
  assert.equal(seen[0].path, "chat.delete");
  assert.equal(seen[0].init.method, "POST");
  assert.deepEqual(seen[0].init.body, { channel: "C1", ts: "1.2" });
  assert.ok(!r.isError);
  assert.deepEqual(JSON.parse(r.content[0].text), { ok: true, channel: "C1", ts: "1.2" });
});

test("delete_message: 남의 글이면 Slack 오류를 글로 돌려주고 오류 표시", async () => {
  const r: any = await tool.run(fakeCall({ ok: false, error: "cant_delete_message" }, []) as any, { channel: "C1", ts: "1.2" });
  assert.equal(r.isError, true);
  assert.match(JSON.stringify(r), /cant_delete_message/);
});

test("delete_message: 바꾸는 도구이고 지우면 못 되살림 표시(destructive)", () => {
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.destructiveHint, true);
});
