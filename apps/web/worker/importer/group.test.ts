// node --test apps/web/worker/importer/group.test.ts (Node 24 타입 지우기)
import { test } from "node:test";
import assert from "node:assert/strict";
import { group, type Item } from "./group.ts";

const now = 1_793_200_000_000;
const it = (o: Partial<Item> & { key: string; kind: Item["kind"] }): Item => ({ seen_at: now - 60_000, ...o });

test("창 · 세션 · 할 일 · 같은 작업 브랜치 · 같은 이슈 링크가 한 노드로, 남은 것은 따로", async () => {
  const items = [
    it({ key: "window:mini:tmux:3", kind: "window", title: "#3720 24시간 가동", win: "mini:tmux:3", session: "session:claude:aaa", state: "working", engine: "coord" }),
    it({ key: "session:claude:aaa", kind: "session", title: "기기 가동률", repo: "github.com/acme/ledger", branch: "feat/uptime-board", refs: ["gh:acme/ledger#3720"], state_at: now - 30_000 }),
    it({ key: "todo:claude:aaa:1", kind: "todo", title: "STATE.md 한 줄", session: "session:claude:aaa" }),
    it({ key: "session:codex:bbb", kind: "session", title: "PR 리뷰", repo: "github.com/acme/ledger", branch: "feat/uptime-board" }),
    it({ key: "thread:gh:acme/ledger#3720", kind: "thread", title: "기기·토큰 24시간 가동", refs: ["gh:acme/ledger#3720"] }),
    it({ key: "window:mini:tmux:5", kind: "window", title: "CLO 법무", win: "mini:tmux:5", state: "idle", repo: "github.com/acme/ledger", branch: "main" }),
    it({ key: "session:claude:ccc", kind: "session", title: "main 에서 다른 일", repo: "github.com/acme/ledger", branch: "main" }),
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now });
  const nodeOf = (k: string) => r.nodes.find(n => n.items.includes(k))!.id;
  assert.equal(nodeOf("window:mini:tmux:3"), nodeOf("session:claude:aaa"));
  assert.equal(nodeOf("todo:claude:aaa:1"), nodeOf("session:claude:aaa"));
  assert.equal(nodeOf("session:codex:bbb"), nodeOf("session:claude:aaa"), "같은 작업 브랜치");
  assert.equal(nodeOf("thread:gh:acme/ledger#3720"), nodeOf("session:claude:aaa"), "같은 이슈");
  assert.notEqual(nodeOf("window:mini:tmux:5"), nodeOf("session:claude:ccc"), "main 은 묶지 않음");
  assert.equal(r.nodes.length, 3);
  const big = r.nodes.find(n => n.items.includes("window:mini:tmux:3"))!;
  assert.equal(big.name, "#3720 24시간 가동");
  assert.equal(big.state, "working");
  assert.equal(big.area, "ledger");
  assert.equal(r.audit.missing, 0);
});

test("현재 상황: 열린 카드 = 내 차례, 막힘 줄 = 막힘, 묻는 창 = 내 차례", async () => {
  const items = [
    it({ key: "window:a", kind: "window", win: "a", title: "A", state: "idle" }),
    it({ key: "window:b", kind: "window", win: "b", title: "B", state: "idle" }),
    it({ key: "window:c", kind: "window", win: "c", title: "C", state: "question" }),
  ];
  const r = await group({ items, now, prev: [], prevNodes: [],
    logs: [{ win: "b", kind: "blocked", text: "리뷰어 답 기다림", at: now - 1000 }],
    cards: [{ id: "1.1", win: "a", state: "open", question: "어느 쪽?", at: now - 500 }] });
  const st = (w: string) => r.nodes.find(n => n.items.includes(`window:${w}`))!;
  assert.equal(st("a").state, "turn"); assert.equal(st("a").why, "어느 쪽?");
  assert.equal(st("b").state, "blocked");
  assert.equal(st("c").state, "turn");
  assert.deepEqual(r.nodes.slice(0, 2).map(n => n.state), ["turn", "turn"], "내 차례가 맨 위");
});

test("대조: 들여오지 않은 보고 창의 장부 줄 · 카드도 노드에(빠짐 0, 고침으로 셈)", async () => {
  const r = await group({ items: [], now, prev: [], prevNodes: [], winNames: { "mini:codex:77": "codex · ledger" },
    logs: [{ win: "mini:codex:77", kind: "progress", text: "시험 돌림", at: now - 5000 }], cards: [] });
  assert.equal(r.nodes.length, 1); assert.equal(r.nodes[0].name, "codex · ledger");
  assert.equal(r.audit.fixed, 1); assert.equal(r.audit.missing, 0);
});

test("노드 id 는 다시 묶어도 이어지고, 사람이 옮긴 것(pin)은 이음보다 이김", async () => {
  const items = [
    it({ key: "window:a", kind: "window", win: "a", session: "session:claude:s1", title: "A" }),
    it({ key: "session:claude:s1", kind: "session", title: "s1" }),
    it({ key: "window:b", kind: "window", win: "b", title: "B" }),
  ];
  const r1 = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now });
  const idA = r1.nodes.find(n => n.items.includes("window:a"))!.id, idB = r1.nodes.find(n => n.items.includes("window:b"))!.id;
  const prevNodes = r1.nodes.map(n => ({ id: n.id, created_at: n.created_at }));
  const r2 = await group({ items, logs: [], cards: [], prev: r1.map, prevNodes, now: now + 60_000 });
  assert.equal(r2.nodes.find(n => n.items.includes("window:a"))!.id, idA);
  assert.equal(r2.audit.moved, 0);
  const prev = r1.map.map(p => p.item === "window:b" ? { ...p, node: idA, how: "pin" } : p);
  const r3 = await group({ items, logs: [], cards: [], prev, prevNodes, now: now + 120_000 });
  assert.equal(r3.nodes.find(n => n.items.includes("window:b"))!.id, idA);
  assert.ok(!r3.nodes.some(n => n.id === idB));
  assert.equal(r3.audit.empty, 1);
});

test("흔한 링크(여러 곳)는 묶지 않음 · 섞인 리포 노드 셈", async () => {
  const items = Array.from({ length: 8 }, (_, i) => it({ key: `session:claude:${i}`, kind: "session", title: `s${i}`, refs: ["slack:C0/1"] }));
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now });
  assert.equal(r.nodes.length, 8); assert.ok(r.audit.notes[0].includes("묶지 않음"));
  const m = await group({ now, logs: [], cards: [], prev: [], prevNodes: [], items: [
    it({ key: "session:claude:x", kind: "session", repo: "github.com/a/one", refs: ["gh:a/one#1"] }),
    it({ key: "session:claude:y", kind: "session", repo: "github.com/a/two", refs: ["gh:a/one#1"] })] });
  assert.equal(m.audit.mixed, 1);
});

test("할 일의 진행 중만으로는 「도는 중」이 아님", async () => {
  const r = await group({ now, logs: [], cards: [], prev: [], prevNodes: [], items: [
    it({ key: "window:a", kind: "window", win: "a", session: "session:claude:s", state: "idle" }),
    it({ key: "session:claude:s", kind: "session", state: "idle" }),
    it({ key: "todo:claude:s:0", kind: "todo", session: "session:claude:s", state: "working" })] });
  assert.equal(r.nodes[0].state, "idle");
});

test("옮기기 · 합치기: 대상 노드에 원래 있던 것은 그대로 남음(리뷰 1)", async () => {
  const w = (key: string, branch: string) => it({ key, kind: "window", repo: "github.com/o/r", branch, win: key });
  for (const items of [[w("window:x", "feat-x"), w("window:t1", "feat-t"), w("window:t2", "feat-t")], [w("window:x", "feat-x"), w("window:t1", "feat-t")]]) {
    const prev = items.map(i => ({ item: i.key, node: "n_T", how: i.key === "window:x" ? "pin" : "auto" }));
    const r = await group({ items, logs: [], cards: [], prev, prevNodes: [{ id: "n_T", created_at: 1 }], now });
    assert.equal(r.nodes.length, 1); assert.equal(r.nodes[0].id, "n_T"); assert.equal(r.nodes[0].items.length, items.length);
  }
  // 합치기: A(셋) 를 B(하나)에 — B 의 창도 B 에 남음
  const a = ["a1", "a2", "a3"].map(k => w(`window:${k}`, "feat-a")), bb = w("window:b", "feat-b");
  const prev = [...a.map(i => ({ item: i.key, node: "n_B", how: "pin" })), { item: "window:b", node: "n_B", how: "auto" }];
  const r = await group({ items: [...a, bb], logs: [], cards: [], prev, prevNodes: [{ id: "n_A", created_at: 1 }, { id: "n_B", created_at: 1, pinned_name: "B 일" }], now });
  assert.equal(r.nodes.length, 1); assert.equal(r.nodes[0].id, "n_B"); assert.equal(r.nodes[0].name, "B 일");
});
