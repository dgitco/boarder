import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const shell = readFileSync(new URL("../legacy/shell.js", import.meta.url), "utf8");

test("옛 칸 이름·판 주소는 실제 새 업무 pane을 반환, 직접 pane·일반 이름·모르는 주소는 기존 길", () => {
  const source = shell.match(/^  const nodePane = .*$/m)![0];
  const resolve = new Function("D", "byPane", "liveNode", source + "; return nodePane;")(
    { node_aliases: { "옛 bank-thread": "%9001", "%1234": "%9001" } },
    { "%9001": { pane: "%9001" } }, (name: string) => name === "새 업무" ? { pane: "%9001" } : null);
  for (const key of ["옛 bank-thread", "%1234", "%9001", "새 업무"]) assert.equal(resolve(key), "%9001", key);
  assert.equal(resolve("모르는 주소"), "");
});

const sideList = (D: unknown) => {
  const source = shell.match(/^  const myNodes = .*\n.*map\(x => x\[0\]\);$/m)![0];
  const panes = [{ pane: "%1", kind: "primary" }, { pane: "%2", kind: "lead", tk: true, tkdept: true }, { pane: "%3", kind: "lead", tk: true }, { pane: "%4", kind: "lead" }, { pane: "%5", kind: "lead", tk: true, pri: "high" }];
  const xHeads = () => [{ key: "m0", lead: "%2" }, { key: "m1", lead: "%3" }];
  return new Function("panes", "xHeads", "rankOf", "D", "mainOnly", source + "; return myNodes;")(panes, xHeads, () => 0, D, () => false)().map((p: any) => p.pane);
};
test("채널 = 태스크를 켠 사람: 왼쪽 목록은 업무 채널을 보이고 부서는 에이전트에만, 머리 업무도 채널에서 빠지지 않음", () => {
  assert.deepEqual(sideList({ task_channels: true }), ["%3", "%4", "%5"]);
});
test("설정 없는 사람(기본): 왼쪽 목록은 예전처럼 업무 노드를 빼고 열 머리도 뺌", () => {
  assert.deepEqual(sideList({}), ["%4"]);
  assert.deepEqual(sideList(undefined), ["%4"]);
});
