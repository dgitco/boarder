// node --test apps/web/worker/importer/group.test.ts (Node 24 타입 지우기)
import { test } from "node:test";
import assert from "node:assert/strict";
import { group, pickUnit, roleOf, primaryOf, primaryScore, primaryPick, canBePrimary, parkMsOf, stateOf, PARK_QUIET_MS, type Item } from "./group.ts";

const now = 1_793_200_000_000;
const it = (o: Partial<Item> & { key: string; kind: Item["kind"] }): Item => ({ seen_at: now - 60_000, ...o });

test("창 · 세션 · 할 일 · 같은 작업 브랜치 · 같은 이슈 링크가 한 노드로, 남은 것은 따로", async () => {
  const items = [
    it({ key: "window:mini:tmux:3", kind: "window", title: "#3720 예시 일 둘", win: "mini:tmux:3", session: "session:claude:aaa", state: "working", engine: "coord" }),
    it({ key: "session:claude:aaa", kind: "session", title: "기기 가동률", repo: "github.com/acme/ledger", branch: "feat/uptime-board", refs: ["gh:acme/ledger#3720"], state_at: now - 30_000 }),
    it({ key: "todo:claude:aaa:1", kind: "todo", title: "STATE.md 한 줄", session: "session:claude:aaa" }),
    it({ key: "session:codex:bbb", kind: "session", title: "PR 리뷰", repo: "github.com/acme/ledger", branch: "feat/uptime-board" }),
    it({ key: "thread:gh:acme/ledger#3720", kind: "thread", title: "예시 일 둘", refs: ["gh:acme/ledger#3720"] }),
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
  assert.equal(big.name, "#3720 예시 일 둘");
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

test("노드 = 목표: 열린 창 없는 지난 세션 · 스레드는 노드가 안 되고 기록으로", async () => {
  const items = [
    it({ key: "session:claude:old1", kind: "session", title: "ledger", cwd: "/w/ledger", repo: "github.com/o/ledger", branch: "main", state: "idle", state_at: now - 3 * 86400_000 }),
    it({ key: "session:claude:old2", kind: "session", title: "메일 분류기", cwd: "/w/mail", state: "idle", state_at: now - 3600_000 }),
    it({ key: "thread:slack:C1/1.1", kind: "thread", title: "Slack 스레드", refs: ["slack:C1/1.1"], state: "open" }),
    it({ key: "window:m:tmux:1", kind: "window", engine: "tmux", title: "결제 고치기", win: "m:1", session: "session:claude:live", state: "idle" }),
    it({ key: "session:claude:live", kind: "session", title: "결제", state: "idle", state_at: now - 3600_000 }),
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, unit: "goal" });
  assert.deepEqual(r.nodes.map(n => n.name), ["결제 고치기"]);
  assert.equal(r.audit.history, 3);
  assert.equal(r.audit.missing, 0);
});

test("노드 = 목표: 이미 있던 노드는 지우지 않고 보관, 창이 다시 열리면 돌아옴", async () => {
  const s = it({ key: "session:claude:old", kind: "session", title: "옛 일", state: "idle", state_at: now - 3600_000 });
  const prev = [{ item: s.key, node: "n_a", how: "auto" }], prevNodes = [{ id: "n_a", created_at: now - 1000 }];
  const a = await group({ items: [s], logs: [], cards: [], prev, prevNodes, now, unit: "goal" });
  assert.equal(a.nodes[0].id, "n_a"); assert.equal(a.nodes[0].archived, true); assert.equal(a.nodes[0].state, "done");
  assert.deepEqual(a.map, prev);
  const w = it({ key: "window:m:1", kind: "window", engine: "tmux", title: "옛 일 이어서", win: "m:1", session: s.key, state: "working" });
  const b = await group({ items: [s, w], logs: [], cards: [], prev, prevNodes, now, unit: "goal" });
  assert.equal(b.nodes[0].id, "n_a"); assert.equal(b.nodes[0].archived, false);
});

test("노드 = 목표: 계정 이름 판은 노드가 아니고, 세션이 있으면 세션 제목으로", async () => {
  const items = [
    it({ key: "window:m:herdr:1", kind: "window", engine: "herdr-own", title: "C alex@example", win: "m:h1", state: "idle" }),
    it({ key: "window:m:herdr:2", kind: "window", engine: "herdr-own", title: "D sam@example", win: "m:h2", state: "idle" }),
    it({ key: "window:m:herdr:3", kind: "window", engine: "herdr-own", title: "B alexdev", win: "m:h3", session: "session:claude:x", state: "working" }),
    it({ key: "session:claude:x", kind: "session", title: "요금제 정리", state: "working", state_at: now }),
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, unit: "goal" });
  assert.deepEqual(r.nodes.map(n => n.name), ["요금제 정리"]);
  assert.equal(r.audit.history, 2);
});

test("창 하나 = 노드 하나: 같은 이슈 링크 · 같은 브랜치 · 같은 세션을 가진 두 창도 따로, 세션 · 할 일은 한 창에 붙음", async () => {
  const items = [
    it({ key: "window:mini:ew_lead", kind: "window", title: "팀장", win: "mini:ew_lead", session: "session:claude:s1", refs: ["slack:C0/1793.1"], repo: "github.com/acme/ledger", branch: "feat/x" }),
    it({ key: "window:mini:ew_merge", kind: "window", title: "머지 담당", win: "mini:ew_merge", session: "session:claude:s1", refs: ["slack:C0/1793.1"], repo: "github.com/acme/ledger", branch: "feat/x" }),
    it({ key: "window:mini:ew_ops", kind: "window", title: "운영 담당", win: "mini:ew_ops", refs: ["slack:C0/1793.1"] }),
    it({ key: "session:claude:s1", kind: "session", title: "팀장 세션", repo: "github.com/acme/ledger", branch: "feat/x" }),
    it({ key: "todo:claude:s1:1", kind: "todo", title: "할 일", session: "session:claude:s1" }),
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now });
  assert.ok(r.nodes.every(n => n.items.filter(k => k.startsWith("window:")).length <= 1), JSON.stringify(r.nodes.map(n => n.items)));
  const nodeOf = (k: string) => r.nodes.find(n => n.items.includes(k))!.id;
  assert.equal(nodeOf("todo:claude:s1:1"), nodeOf("session:claude:s1"));
  assert.equal(new Set(["window:mini:ew_lead", "window:mini:ew_merge", "window:mini:ew_ops"].map(nodeOf)).size, 3);
});

test("채널 = 태스크를 켠 사람만: 정확한 같은 세션은 한 칸, 이슈 링크 · 브랜치만 같은 다른 대화는 별도", async () => {
  const items = [
    it({ key: "window:mini:ew_lead", kind: "window", title: "팀장", win: "mini:ew_lead", session: "session:claude:s1", refs: ["slack:C0/1793.1"], repo: "github.com/acme/ledger", branch: "feat/x" }),
    it({ key: "window:mini:ew_merge", kind: "window", title: "머지 담당", win: "mini:ew_merge", session: "session:claude:s1", refs: ["slack:C0/1793.1"], repo: "github.com/acme/ledger", branch: "feat/x" }),
    it({ key: "window:mini:ew_ops", kind: "window", title: "운영 담당", win: "mini:ew_ops", refs: ["slack:C0/1793.1"] }),
    it({ key: "session:claude:s1", kind: "session", title: "팀장 세션", repo: "github.com/acme/ledger", branch: "feat/x" }),
    it({ key: "todo:claude:s1:1", kind: "todo", title: "할 일", session: "session:claude:s1" }),
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, taskChannels: true });
  const nodeOf = (k: string) => r.nodes.find(n => n.items.includes(k))!.id;
  assert.equal(nodeOf("todo:claude:s1:1"), nodeOf("session:claude:s1"));
  assert.equal(nodeOf("window:mini:ew_lead"), nodeOf("window:mini:ew_merge"));
  assert.equal(new Set(["window:mini:ew_lead", "window:mini:ew_merge", "window:mini:ew_ops"].map(nodeOf)).size, 2);
});

test("노드 = 목표: 같은 일 번호라도 창 하나 = 노드 하나, 글에 언급된 링크로 다른 이름 창끼리 붙지 않음", async () => {
  const ref = "gh:o/ledger#2586", repo = "github.com/o/ledger";
  const items = [
    it({ key: "window:m:1", kind: "window", engine: "tmux", title: "#7000 영업 총괄", win: "m:1", repo, refs: [ref], state: "idle", session: "session:claude:a" }),
    it({ key: "window:m:2", kind: "window", engine: "tmux", title: "작업자 #7000 개발", win: "m:2", repo, state: "idle", session: "session:claude:b" }),
    it({ key: "window:m:3", kind: "window", engine: "tmux", title: "#2661 예시 평가", win: "m:3", repo, refs: [ref], state: "idle", session: "session:claude:c" }),
    it({ key: "session:claude:a", kind: "session", title: "영업", repo, state: "idle", state_at: now - 60_000 }),
    it({ key: "session:claude:b", kind: "session", title: "개발", repo, state: "idle", state_at: now - 60_000 }),
    it({ key: "session:claude:c", kind: "session", title: "평가", repo, state: "idle", state_at: now - 60_000 }),
    it({ key: "session:claude:d", kind: "session", title: "#2661 지난 세션", repo, state: "idle", state_at: now - 86400_000 }),
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, unit: "goal" });
  const nodeOf = (k: string) => r.nodes.find(n => n.items.includes(k))!.id;
  assert.notEqual(nodeOf("window:m:1"), nodeOf("window:m:2"));
  assert.notEqual(nodeOf("window:m:1"), nodeOf("window:m:3"));
  assert.equal(nodeOf("session:claude:d"), nodeOf("window:m:3"));
  assert.equal(r.nodes.length, 3);
});

test("노드 = 목표: 시험 창은 줄이 있어도 노드가 아니고, 열린 카드가 있으면 남음", async () => {
  const logs = [{ win: "m:qbus", kind: "blocked", text: "시험 줄 — 무시", at: now - 1000 }];
  const a = await group({ items: [], logs, cards: [], prev: [], prevNodes: [], winNames: { "m:qbus": "qbus 시험" }, now, unit: "goal" });
  assert.equal(a.nodes.length, 0);
  const b = await group({ items: [], logs, cards: [{ id: "1", win: "m:qbus", state: "open", question: "어느 쪽?", at: now }], prev: [], prevNodes: [], winNames: { "m:qbus": "qbus 시험" }, now, unit: "goal" });
  assert.equal(b.nodes.length, 1);
});

test("에이전트마다 채널: 역할이 채널, 일 창 · 세션은 그 안으로, 시험 · 계정 판은 빠짐", async () => {
  const repo = "github.com/o/ledger";
  const items = [
    it({ key: "window:m:1", kind: "window", engine: "tmux", title: "팀장", win: "m:1", repo, session: "session:claude:a", state: "working" }),
    it({ key: "session:claude:a", kind: "session", title: "팀장 세션", repo, state: "working", state_at: now }),
    it({ key: "window:m:2", kind: "window", engine: "tmux", title: "#2736 예시 일 하나", win: "m:2", repo, session: "session:claude:b", state: "idle" }),
    it({ key: "session:claude:b", kind: "session", title: "[팀장 → 새 담당] 대표 태스크 #2736", repo, state: "idle", state_at: now - 3600_000 }),
    it({ key: "session:claude:c", kind: "session", title: "[팀장 → 회의 녹음 담당] 회의 정리", cwd: "/Users/k/minutes", state: "idle", state_at: now - 86400_000 }),
    it({ key: "session:claude:d", kind: "session", title: "minutes", cwd: "/Users/k/minutes", state: "idle", state_at: now - 86400_000 }),
    it({ key: "session:claude:e", kind: "session", title: "reply ok", cwd: "/private/tmp", state: "idle" }),
    it({ key: "window:m:h", kind: "window", engine: "herdr-own", title: "C alex@example", win: "m:h", repo, state: "idle" }),
    it({ key: "thread:gh:o/ledger#2736", kind: "thread", title: "온보딩", refs: ["gh:o/ledger#2736"] }),
    it({ key: "window:m:3", kind: "window", engine: "tmux", title: "개인 비서", win: "m:3", cwd: "/Users/k/.hq", session: "", state: "idle" }),
    { ...it({ key: "session:claude:f", kind: "session", title: "ledger", repo, state: "idle" }), refs: ["gh:o/ledger#2736"] },
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, unit: "agent" });
  assert.deepEqual(r.nodes.map(n => n.name).sort(), ["#2736 예시 일 하나", "개인 비서", "팀장", "회의 녹음 담당"].sort());
  const lead = r.nodes.find(n => n.name === "팀장")!;
  assert.equal(r.nodes.find(n => n.name === "#2736 예시 일 하나")!.items.includes("session:claude:b"), true, "팀장이 맡긴 담당 창(일 번호)은 제 채널, 그 세션도 같이(예전엔 팀장 채널)");
  assert.equal(lead.items.includes("thread:gh:o/ledger#2736"), true);
  assert.equal(r.nodes.find(n => n.name === "회의 녹음 담당")!.items.includes("session:claude:d"), true);
  assert.equal(r.audit.history, 2);
  assert.equal(r.audit.missing, 0);
});

test("고르기 전(unit 없음)은 예전 그대로: 지난 세션도 노드, 이음 그대로", async () => {
  const items = [it({ key: "session:claude:old", kind: "session", title: "ledger", cwd: "/w/ledger", state: "idle", state_at: now - 86400_000 }), it({ key: "window:m:h", kind: "window", engine: "herdr-own", title: "C alex@example", win: "m:h", state: "idle" })];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now });
  assert.equal(r.nodes.filter(n => !n.archived).length, 2);
});

test("들여오기 때 고르기: 역할 이름 셋 이상이면 에이전트마다", () => {
  const w = (title: string) => ({ title, kind: "window" as const });
  assert.equal(pickUnit([w("팀장"), w("개인 비서"), w("머지 담당"), w("#12 고치기")]), "agent");
  assert.equal(pickUnit([w("결제 고치기"), w("로그인")]), "goal");
  assert.equal(pickUnit([w("x")], ["a", "b", "c"]), "agent");
  assert.equal(pickUnit(["리드 정리해줘", "CS 담당 찾아줘", "package manager 바꿔줘"].map(title => ({ title, kind: "session" as const }))), "goal", "세션 제목은 근거가 아님");
});

test("역할 이름 읽기", () => {
  for (const [t, r] of [["팀장", "팀장"], ["팀장 질문 · 보고 (qbus)", "팀장"], ["아크미 팀장 세션입니다. 브리프", "아크미 팀장"], ["개인 비서 브리프", "개인 비서"], ["c 게시 담당 (c-publisher)", "게시 담당"], ["# 머지 담당(merge supervisor) — 승인", "머지 담당"],
    ["[팀장 → 회의 녹음 담당] 대표님", "회의 녹음 담당"], ["[팀장 → 새 담당] 대표 태스크", "팀장"], ["[팀장 17:44] 새 태스크", "팀장"], ["#7000 영업·마케팅 총괄", "영업·마케팅 총괄"], ["작업자 · 7003", ""], ["이 세션은 어떻게 옮겨졌나요? 팀장 세션이", ""], ["고객봇 전 기능·문의 응대 (#7002)", ""]] as const)
    assert.equal(roleOf(t), r, t);
});

test("에이전트마다 채널: 같은 일 번호 · 브랜치를 맡은 두 역할은 채널이 따로", async () => {
  const repo = "github.com/o/ledger";
  const items = [
    it({ key: "window:1", kind: "window", engine: "tmux", title: "팀장 #7000", win: "1", repo, branch: "feat/x", state: "idle", session: "session:claude:a" }),
    it({ key: "window:2", kind: "window", engine: "tmux", title: "머지 담당 #7000", win: "2", repo, branch: "feat/x", state: "idle", session: "session:claude:b" }),
    it({ key: "session:claude:a", kind: "session", title: "일", repo, state: "idle" }),
    it({ key: "session:claude:b", kind: "session", title: "일", repo, state: "idle" }),
    it({ key: "session:claude:c", kind: "session", title: "#7000 지난 일", repo, state: "idle" }),
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, unit: "agent" });
  assert.deepEqual(r.nodes.map(n => n.name).sort(), ["머지 담당", "팀장"].sort());
  assert.equal(r.nodes.find(n => n.name === "팀장")!.counts.main, "window:1");
  assert.equal(r.nodes.flatMap(n => n.items).includes("session:claude:c"), true);
});

test("에이전트마다 채널: 사람이 옮겨 넣은 노드 하나를 두 채널이 나눠 갖지 않음", async () => {
  const items = ["팀장", "머지 담당", "개인 비서"].map((t, i) => it({ key: `window:${i}`, kind: "window", engine: "tmux", title: t, win: String(i), state: "idle", session: `session:claude:${i}` }));
  const prev = items.map(i => ({ item: i.key, node: "n_a", how: i.key === "window:0" ? "pin" : "auto" }));
  const r = await group({ items, logs: [], cards: [], prev, prevNodes: [{ id: "n_a", created_at: now }], now, unit: "agent" });
  assert.deepEqual(r.nodes.map(n => n.name).sort(), ["개인 비서", "머지 담당"].sort(), "옮겨 둔 창은 그 노드에 남고, 나머지 역할은 채널이 따로");
  assert.equal(new Set(r.nodes.map(n => n.id)).size, 2);
});

test("에이전트마다 채널: 역할 없는 폴더는 되풀이해 쓴 곳만, 한 번 들른 폴더는 기록", async () => {
  const s = (k: string, cwd: string) => it({ key: `session:claude:${k}`, kind: "session", title: "일 하나", cwd, state: "idle", state_at: now - 5 * 86400_000 });
  const r = await group({ items: [s("a", "/w/mail"), s("b", "/w/mail"), s("c", "/w/mail"), s("d", "/w/x"), s("e", "/w/y")], logs: [], cards: [], prev: [], prevNodes: [], now, unit: "agent" });
  assert.deepEqual(r.nodes.map(n => n.name), ["mail"]);
  assert.equal(r.audit.history, 2);
});

test("역할 읽기(세션 제목): 첫 질문은 역할이 아님", () => {
  for (const t of ["CS 담당 찾아줘", "리드 정리해줘", "package manager 바꿔줘"]) assert.equal(roleOf(t, [], true), "", t);
  assert.equal(roleOf("개인 비서 세션입니다. 브리프", [], true), "개인 비서");
  assert.equal(roleOf("[팀장 → 회의 녹음 담당] 정리", [], true), "회의 녹음 담당");
});

test("에이전트마다 채널: 주 창 — 역할 창 · 역할 세션의 창, 닫히면 없음, 폴더 채널은 열린 창, 옮겨도 그대로", async () => {
  const w = (k: string, title: string, o = {}) => it({ key: k, kind: "window", engine: "tmux", title, win: k, state: "idle", ...o });
  const run = (items: Item[], prev = [] as { item: string; node: string; how: string }[], prevNodes = [] as { id: string; created_at: number }[]) => group({ items, logs: [], cards: [], prev, prevNodes, now, unit: "agent" });
  const lead = await run([w("window:a", "#1 일", { cwd: "/w/app" }), w("window:b", "팀장", { cwd: "/w/app" })]);
  assert.equal(lead.nodes[0].counts.main, "window:b");
  const shut = await run([w("window:a", "#1 일", { cwd: "/w/app" }), w("window:b", "팀장", { cwd: "/w/app", gone_at: now - 1000, state: "gone" })]);
  assert.equal(shut.nodes[0].counts.main, undefined, "일 창에 넣지 않음");
  const viaSession = await run([w("window:c", "A me@x", { session: "session:claude:s" }), it({ key: "session:claude:s", kind: "session", title: "개인 비서 세션입니다", state: "idle" })]);
  assert.equal(viaSession.nodes[0].name, "개인 비서"); assert.equal(viaSession.nodes[0].counts.main, "window:c");
  const folder = await run([w("window:d", "일 하나", { cwd: "/w/ledger" }), w("window:e", "일 둘", { cwd: "/w/ledger" })]);
  assert.equal(folder.nodes[0].name, "ledger"); assert.equal(folder.nodes[0].counts.main, "window:d");
  const pin = await run([w("window:a", "#1 일", { cwd: "/w/app" }), w("window:b", "팀장", { cwd: "/w/app" })], [{ item: "window:b", node: lead.nodes[0].id, how: "pin" }], [{ id: lead.nodes[0].id, created_at: now }]);
  assert.equal(pin.nodes.find(n => n.id === lead.nodes[0].id)!.counts.main, "window:b", "옮긴 주 창");
});

test("에이전트마다 채널: 같은 일 번호의 역할 없는 것은 어디 있든 그 역할로", async () => {
  const s = (k: string, cwd: string) => it({ key: `session:claude:${k}`, kind: "session", title: "#7000 일", cwd, state: "idle" });
  const r = await group({ items: [s("a", "/w/x"), s("b", "/w/y"), it({ key: "window:z", kind: "window", engine: "tmux", title: "머지 담당 #7000", win: "z", state: "idle" })], logs: [], cards: [], prev: [], prevNodes: [], now, unit: "agent" });
  assert.equal(r.nodes.length, 1); assert.equal(r.audit.history, 0);
});

test("다시 연 노드는 마지막 줄이 끝이어도 트리에", async () => {
  const items = [it({ key: "session:claude:a", kind: "session", title: "옛 일", win: "w", state: "idle", state_at: now - 3600_000 }), it({ key: "window:w", kind: "window", engine: "tmux", title: "옛 일 창", win: "w", state: "idle", session: "session:claude:a" })];
  const r = await group({ items, logs: [{ win: "w", kind: "done", text: "끝", at: now - 1000 }], cards: [], prev: items.map(i => ({ item: i.key, node: "n_a", how: "auto" })), prevNodes: [{ id: "n_a", pinned_name: "옛 일", created_at: now }], now, unit: "goal" });
  assert.equal(r.nodes[0].state, "idle"); assert.equal(r.nodes[0].archived, false);
});

test("역할 읽기: 아는 역할 이름도 세션 제목에선 첫 질문이면 아님", () => {
  assert.equal(roleOf("팀장한테 보낼 메일 써줘", ["팀장"], true), "");
  assert.equal(roleOf("팀장 세션입니다", ["팀장"], true), "팀장");
});

test("역할이 시킨 일 창이 세션 제목에 역할을 달고 있어도 주 창은 그 역할 이름의 창", async () => {
  const items = [
    it({ key: "window:a", kind: "window", title: "#2736 예시 일 하나", win: "a", session: "session:claude:s1", state: "working" }),
    it({ key: "session:claude:s1", kind: "session", title: "[팀장 → 새 작업] 온보딩" }),
    it({ key: "window:b", kind: "window", title: "팀장", win: "b", state: "working" }),
    it({ key: "window:c", kind: "window", title: "CLO", win: "c", state: "idle" }),
    it({ key: "window:d", kind: "window", title: "CTO", win: "d", state: "idle" }),
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, unit: "agent", agents: ["팀장", "CLO", "CTO"] });
  assert.equal(r.nodes.find(n => n.name === "팀장")!.counts.main, "window:b");
});

test("창 하나 = 노드 하나: 닫힌 창은 창으로 세지 않음 — 이어 연 창과 옛 창(같은 세션)이 한 노드, 세션 · 할 일은 산 창 쪽", async () => {
  const items = [
    it({ key: "window:m:old", kind: "window", engine: "tmux", title: "#7010 정산", win: "m:old", session: "session:claude:s9", state: "gone", gone_at: now - 600_000 }),
    it({ key: "window:m:new", kind: "window", engine: "tmux", title: "#7010 정산", win: "m:new", session: "session:claude:s9", state: "idle" }),
    it({ key: "session:claude:s9", kind: "session", title: "정산", state: "idle", state_at: now - 60_000 }),
    it({ key: "todo:claude:s9:1", kind: "todo", title: "표 맞추기", session: "session:claude:s9" }),
  ];
  for (const unit of [undefined, "goal", "agent"] as const) {
    const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, ...(unit ? { unit } : {}) });
    const nodeOf = (k: string) => r.nodes.find(n => n.items.includes(k))?.id;
    assert.ok(nodeOf("window:m:new"), `${unit}: 산 창은 노드`);
    assert.equal(nodeOf("window:m:old"), nodeOf("window:m:new"), `${unit}: 옛 창과 이어 연 창은 한 노드`);
    assert.equal(nodeOf("session:claude:s9"), nodeOf("window:m:new"), `${unit}: 세션은 산 창 쪽`);
    assert.equal(nodeOf("todo:claude:s9:1"), nodeOf("window:m:new"), `${unit}: 할 일은 산 창 쪽`);
  }
});

test("계정을 옮겨 이어 연 창: 세션 행이 없어도 닫힌 옛 창과 산 새 창(같은 세션)은 한 노드 — 옛 창 기록이 칸에서 안 끊김", async () => {
  const items = [
    it({ key: "window:lap3:ew_old", kind: "window", engine: "tmux", title: "정산 마무리", win: "lap3:ew_old", session: "session:claude:s9", state: "gone", gone_at: now - 600_000 }),
    it({ key: "window:mini:ew_new", kind: "window", engine: "tmux", title: "정산 마무리", win: "mini:ew_new", session: "session:claude:s9", state: "idle" }),
  ];
  for (const unit of [undefined, "goal", "agent"] as const) {
    const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, ...(unit ? { unit } : {}) });
    const nodeOf = (k: string) => r.nodes.find(n => n.items.includes(k))?.id;
    assert.ok(nodeOf("window:mini:ew_new"), `${unit}: 산 창은 노드`);
    assert.equal(nodeOf("window:lap3:ew_old"), nodeOf("window:mini:ew_new"), `${unit}: 옛 창과 이어 연 창은 한 노드`);
  }
});

test("primary 창 알아보기: 들여오기 표시 > 창 이름 > 폴더, 우리 엔진 · 보고 창 · 닫힌 창 · tmux 세션 이름은 아님", () => {
  const w = (o: Partial<Item> & { key: string }) => it({ kind: "window", engine: "herdr-own", ...o });
  assert.equal(primaryScore(w({ key: "a", title: "아무거나", handle: JSON.stringify({ primary: true }) })), 3);
  for (const t of ["primary", "Primary", "main", "메인", "메인 봇", "1 primary"]) assert.equal(primaryScore(w({ key: "b", title: t })), 2, t);
  assert.equal(primaryScore(w({ key: "c", title: "x", handle: { name: "primary" } })), 2, "손잡이 이름");
  assert.equal(primaryScore(w({ key: "d", title: "claude · primary", cwd: "/home/m/boarder/primary" })), 1, "폴더");
  assert.equal(primaryScore(w({ key: "e", title: "primary", engine: "tmux" })), 0, "보더 엔진 창(메인 봇은 engine_window 가 셈)");
  assert.equal(primaryScore(w({ key: "f", title: "primary", engine: "report" })), 0);
  assert.equal(primaryScore(w({ key: "f2", title: "primary", engine: "terminal" })), 0, "일반 터미널(글을 못 넣음)");
  assert.equal(primaryScore(w({ key: "f3", title: "Primary", engine: "herdr", cwd: "/home/m/boarder/primary" })), 0, "보더 엔진 Herdr 창");
  assert.equal(primaryScore(w({ key: "g", title: "primary", gone_at: now - 1000 })), 0, "닫힌 창");
  assert.equal(primaryScore(w({ key: "h", title: "#3720 uptime", handle: { tsession: "main", workspace: "main" } })), 0, "tmux 세션 · 작업 공간 이름은 안 봄");
  assert.equal(primaryScore(it({ key: "session:claude:x", kind: "session", title: "primary" })), 0, "창만");
  assert.equal(primaryScore(w({ key: "i", title: "primary 정리 일" })), 0, "이름 전체만");
  const pick = primaryOf([w({ key: "w1", title: "main", state: "idle" }), w({ key: "w2", title: "x", handle: { primary: true } }), w({ key: "w3", title: "메인", state: "working" })]);
  assert.equal(pick?.key, "w2", "표시가 이김");
  assert.equal(primaryOf([w({ key: "w1", title: "main", state: "idle" }), w({ key: "w3", title: "메인", state: "working" })])?.key, "w3", "같은 셈이면 일하는 창");
  assert.equal(primaryOf([w({ key: "w1", title: "#1 일" })]), null);
});

test("있던 primary 창 · 그 세션 · 그 창의 보고 줄은 노드가 아님(메인 봇 자리) — 남은 일은 그대로 노드", async () => {
  const items = [
    it({ key: "window:lap:herdr:p1", kind: "window", engine: "herdr-own", title: "primary", win: "lap:herdr:p1", session: "session:claude:m1", state: "working", repo: "github.com/acme/app", branch: "feat/x" }),
    it({ key: "session:claude:m1", kind: "session", title: "오늘 할 일", state_at: now - 30_000 }),
    it({ key: "todo:claude:m1:1", kind: "todo", title: "정리", session: "session:claude:m1" }),
    it({ key: "window:lap:herdr:p2", kind: "window", engine: "herdr-own", title: "#3720 uptime", win: "lap:herdr:p2", state: "working", repo: "github.com/acme/app", branch: "feat/x" }),
  ];
  for (const unit of [undefined, "goal", "agent"] as const) {
    const r = await group({ items, now, prev: [], prevNodes: [], unit,
      logs: [{ win: "lap:herdr:p1", kind: "progress", text: "봇이 정리 중", at: now - 1000 }], cards: [] });
    assert.equal(r.primary, "window:lap:herdr:p1", String(unit));
    const all = r.nodes.flatMap(n => n.items);
    for (const k of ["window:lap:herdr:p1", "session:claude:m1", "todo:claude:m1:1", "win:lap:herdr:p1"]) assert.ok(!all.includes(k), `${unit}: ${k} 는 노드에 없음`);
    assert.ok(all.includes("window:lap:herdr:p2"), `${unit}: 같은 브랜치여도 일 창은 따로 노드`);
    assert.equal(r.audit.missing, 0);
  }
  const none = await group({ items: items.slice(1), now, prev: [], prevNodes: [], logs: [], cards: [] });
  assert.equal(none.primary, null);
  const eng = await group({ items, now, prev: [], prevNodes: [], logs: [], cards: [], engineMain: true });
  assert.equal(eng.primary, null);
  assert.ok(eng.nodes.flatMap(n => n.items).includes("window:lap:herdr:p1"));
});

test("primary 창이 지난번 노드였으면 다시 묶을 때 그 노드에서 빠짐(사람이 옮긴 pin 도)", async () => {
  const items = [it({ key: "window:p1", kind: "window", engine: "tmux-own", title: "main", win: "p1", state: "idle" }), it({ key: "window:p2", kind: "window", engine: "tmux-own", title: "#12 버그", win: "p2", state: "working" })];
  const r = await group({ items, now, logs: [], cards: [], prev: [{ item: "window:p1", node: "n_old", how: "pin" }, { item: "window:p2", node: "n_old", how: "auto" }], prevNodes: [{ id: "n_old", created_at: now - 9e6 }] });
  assert.ok(!r.map.some(m => m.item === "window:p1"));
  assert.deepEqual(r.nodes.map(n => n.items), [["window:p2"]]);
});

test("창이 PARK_QUIET_MS(6시간) 넘게 조용하면 주차 — 지우지 않고, 다시 일하면 바로 살아남(Herdr 창도 같음)", async () => {
  assert.equal(PARK_QUIET_MS, 6 * 3600_000);
  const old = now - PARK_QUIET_MS - 60_000;
  for (const engine of ["tmux-own", "herdr-own", "terminal"]) {
    const w = it({ key: "window:a", kind: "window", engine, title: "#7 일", win: "a", state: "idle", state_at: old, seen_at: old });
    assert.equal(stateOf([w], [], [], now).state, "parked", engine);
    assert.equal(stateOf([{ ...w, state_at: now - 60_000 }], [], [], now).state, "idle", `${engine}: 방금 움직임`);
    assert.equal(stateOf([w], [{ win: "a", kind: "progress", text: "다시 함", at: now - 1000 }], [], now).state, "idle", `${engine}: 새 보고 줄`);
    assert.equal(stateOf([{ ...w, state: "working" }], [], [], now).state, "working", `${engine}: 일하는 중이면 조용해도 일함`);
    assert.equal(stateOf([{ ...w, state: "question" }], [], [], now).state, "turn");
  }
  const r = await group({ items: [it({ key: "window:a", kind: "window", engine: "herdr-own", title: "#7 일", win: "a", session: "session:claude:s", state: "idle", state_at: old, seen_at: old }), it({ key: "session:claude:s", kind: "session", title: "#7 일", state_at: old, seen_at: old })],
    now, prev: [], prevNodes: [], logs: [], cards: [], unit: "goal" });
  assert.equal(r.nodes.length, 1); assert.equal(r.nodes[0].state, "parked"); assert.equal(r.nodes[0].archived, false, "지우지 않음 · 보관도 아님");
});

test("창 · 세션이 끝나면 주차(끝 줄이 있으면 끝)", () => {
  const s = it({ key: "session:claude:s", kind: "session", title: "일", state: "done", state_at: now - 60_000 });
  assert.equal(stateOf([s], [], [], now).state, "parked", "세션이 끝남");
  assert.equal(stateOf([], [{ win: "a", kind: "progress", text: "하던 것", at: now - 60_000 }], [], now).state, "parked", "창이 닫힘");
  assert.equal(stateOf([], [{ win: "a", kind: "done", text: "끝냄", at: now - 60_000 }], [], now).state, "done", "끝 줄은 끝");
  assert.equal(stateOf([{ ...s, state: "", state_at: now - 3600_000 }], [], [], now).state, "idle", "안 끝난 세션은 6시간 전엔 쉼");
});

test("메인 봇 창 고르기(primaryPick): auto = 예전 그대로 · none = 보더 메인 봇 · 고른 창은 보더 메인 봇이 떠 있어도 이김 · 닫힌 창은 몰래 바꾸지 않음", () => {
  const w = (o: Partial<Item> & { key: string }) => it({ kind: "window", engine: "herdr-own", ...o });
  const items = [w({ key: "p", title: "primary", state: "idle" }), w({ key: "x", title: "#9 일", state: "working" }), w({ key: "t", title: "보더 창", engine: "tmux" }), w({ key: "g", title: "닫힌 창", gone_at: now - 1000 })];
  for (const auto of [undefined, null, "", "auto", 42 as unknown as string]) {
    assert.equal(primaryPick(items, auto, false).primary?.key, "p", `${auto}: 이름으로`);
    assert.equal(primaryPick(items, auto, true).primary, null, `${auto}: 보더 메인 봇이 떠 있으면 그것`);
  }
  assert.equal(primaryPick(items, "none", false).primary, null, "none: primary 이름 창도 메인 봇 아님");
  assert.deepEqual(primaryPick(items, "x", false), { primary: items[1], explicit: true });
  assert.equal(primaryPick(items, "x", true).primary?.key, "x", "고른 창은 보더 메인 봇보다 이김");
  assert.deepEqual(primaryPick(items, "g", false), { primary: null, explicit: false }, "닫힌 창을 골랐으면 보더 메인 봇(이름 창으로 몰래 안 바꿈)");
  assert.equal(primaryPick(items, "t", false).primary, null, "보더 엔진 창은 못 고름");
  assert.equal(primaryPick(items, "없는 키", false).primary, null);
  assert.equal(canBePrimary(w({ key: "r", engine: "report" })), false);
  assert.equal(canBePrimary(w({ key: "o", engine: "tmux-own" })), true);
});

test("묶기가 고른 메인 봇 창을 따름: 고른 창 · 그 세션은 노드가 아니고 이름 primary 창은 노드, none 이면 다 노드", async () => {
  const items = [
    it({ key: "window:p1", kind: "window", engine: "herdr-own", title: "primary", win: "p1", state: "working" }),
    it({ key: "window:p2", kind: "window", engine: "herdr-own", title: "#12 버그", win: "p2", session: "session:claude:s2", state: "working" }),
    it({ key: "session:claude:s2", kind: "session", title: "버그", state_at: now - 30_000 }),
  ];
  const base = { items, now, prev: [], prevNodes: [], logs: [], cards: [] };
  const pick = await group({ ...base, primaryItem: "window:p2", engineMain: true });
  assert.equal(pick.primary, "window:p2");
  const all = pick.nodes.flatMap(n => n.items);
  assert.ok(!all.includes("window:p2") && !all.includes("session:claude:s2"), "고른 창 · 세션은 메인 봇 자리");
  assert.ok(all.includes("window:p1"), "이름이 primary 여도 고르지 않았으면 노드");
  const none = await group({ ...base, primaryItem: "none" });
  assert.equal(none.primary, null);
  assert.ok(none.nodes.flatMap(n => n.items).includes("window:p1"));
  assert.equal((await group(base)).primary, "window:p1", "값 없음 = 예전 그대로");
});

test("주차 시간은 사람마다(parkH) — 기본 6시간, 0 이면 조용해도 주차 안 함", async () => {
  assert.equal(parkMsOf(undefined), PARK_QUIET_MS); assert.equal(parkMsOf(null), PARK_QUIET_MS);
  assert.equal(parkMsOf(0), 0); assert.equal(parkMsOf(-3), 0);
  assert.equal(parkMsOf(2), 2 * 3600_000); assert.equal(parkMsOf(999), 168 * 3600_000); assert.equal(parkMsOf(0.5), 3600_000, "1시간 밑은 1시간");
  const t3 = now - 3 * 3600_000;
  const w = it({ key: "window:a", kind: "window", engine: "tmux-own", title: "#7 일", win: "a", state: "idle", state_at: t3, seen_at: t3 });
  assert.equal(stateOf([w], [], [], now).state, "idle", "기본 6시간 — 3시간 조용은 쉼");
  const two = stateOf([w], [], [], now, parkMsOf(2));
  assert.equal(two.state, "parked"); assert.match(two.why, /^2시간 넘게 조용해 주차/);
  const old = it({ ...w, state_at: now - 100 * 3600_000, seen_at: now - 100 * 3600_000 });
  assert.equal(stateOf([old], [], [], now, parkMsOf(0)).state, "idle", "끄면 오래 조용해도 쉼");
  assert.equal(stateOf([{ ...old, state: "parked" }], [], [], now, 0).state, "parked", "창이 스스로 주차한 것은 그대로 주차");
  const r = await group({ items: [w], now, prev: [], prevNodes: [], logs: [], cards: [], unit: "goal", parkH: 2 });
  assert.equal(r.nodes[0].state, "parked");
  const off = await group({ items: [old], now, prev: [], prevNodes: [], logs: [], cards: [], parkH: 0 });
  assert.equal(off.nodes[0].state, "idle");
});

test("에이전트 채널은 지난번 이름이 같은 노드 id 를 이어받음 — 같은 폴더의 더 큰 다른 역할 묶음이 팀장 id 를 표로 못 가져감", async () => {
  const w = (k: string, title: string, sess = "") => it({ key: `window:m:${k}`, kind: "window", engine: "tmux", title, win: `m:${k}`, cwd: "/w/ledger", session: sess, state: "idle" });
  const ss = (k: string, title: string) => it({ key: `session:claude:${k}`, kind: "session", title, cwd: "/w/ledger", state: "idle" });
  const items = [w("1", "팀장", "session:claude:a"), ss("a", "팀장"), w("2", "머지 담당", "session:claude:b"), ss("b", "머지 담당"), ss("c", "머지 담당 정리"), ss("d", "머지 담당 끝")];
  const prev = items.map(i => ({ item: i.key, node: "n_lead", how: "auto" }));   // 예전엔 다 「팀장」 노드 하나에
  const r = await group({ items, logs: [], cards: [], prev, prevNodes: [{ id: "n_lead", name: "팀장", created_at: now - 86400_000 }], now, unit: "agent" });
  const lead = r.nodes.find(n => n.name === "팀장")!, merge = r.nodes.find(n => n.name === "머지 담당")!;
  assert.ok(lead && merge, JSON.stringify(r.nodes.map(n => [n.id, n.name, n.items.length])));
  assert.equal(lead.id, "n_lead", "팀장은 제 id 를 지킴(상위 · 닫힘 · 얼굴 · 우선순위 · 읽음이 안 끊김)");
  assert.notEqual(merge.id, "n_lead");
  // 이름이 같은 지난 노드가 없으면 예전처럼 표로
  const r2 = await group({ items, logs: [], cards: [], prev, prevNodes: [{ id: "n_lead", name: "옛 이름", created_at: now - 86400_000 }], now, unit: "agent" });
  assert.ok(r2.nodes.some(n => n.id === "n_lead"), "표로 누군가는 이어받음");
  const r3 = await group({ items, logs: [], cards: [], prev, prevNodes: [{ id: "n_lead", name: "회사", pinned_name: "회사", counts: JSON.stringify({ main: "window:m:1" }), created_at: now - 86400_000 }], now, unit: "agent" });   // 실제 저장 꼴: 묶기가 그 채널 주 창을 counts.main 에 남김
  assert.equal(r3.nodes.find(n => n.items.includes("window:m:1"))!.id, "n_lead");
});

test("팀장 노드로 사람이 옮겨 넣은(pin) 묶음이 팀장 묶음보다 커도 팀장은 제 id 를 지키고 둘이 같은 노드", async () => {
  const w = (k: string, title: string, sess = "") => it({ key: `window:m:${k}`, kind: "window", engine: "tmux", title, win: `m:${k}`, cwd: "/w/ledger", session: sess, state: "idle" });
  const ss = (k: string, title: string) => it({ key: `session:claude:${k}`, kind: "session", title, cwd: "/w/other", state: "idle" });
  const items = [w("1", "팀장", "session:claude:a"), it({ key: "session:claude:a", kind: "session", title: "팀장", cwd: "/w/ledger", state: "idle" }), ss("p1", "옮긴 일 1"), ss("p2", "옮긴 일 2"), ss("p3", "옮긴 일 3"), ss("p4", "옮긴 일 4")];
  const prev = [...items.slice(0, 2).map(i => ({ item: i.key, node: "n_lead", how: "auto" })), ...items.slice(2).map(i => ({ item: i.key, node: "n_lead", how: "pin" }))];
  const r = await group({ items, logs: [], cards: [], prev, prevNodes: [{ id: "n_lead", name: "팀장", created_at: now - 86400_000 }], now, unit: "agent" });
  const lead = r.nodes.find(n => n.items.includes("window:m:1"))!;
  assert.equal(lead.id, "n_lead"); assert.ok(lead.items.includes("session:claude:p1"), "옮겨 넣은 것도 같은 노드");
});

test("이어받기는 항목 순서와 상관없음 — 정순 · 역순 · 뒤섞음 모두 팀장이 제 id, 역할 창이 닫히고 이름까지 바뀌어도 지난 노드의 주 창(counts.main)으로 지킴", async () => {
  const w = (k: string, title: string, sess = "", gone?: number) => it({ key: `window:m:${k}`, kind: "window", engine: "tmux", title, win: `m:${k}`, cwd: "/w/ledger", session: sess, state: gone ? "gone" : "idle", ...(gone ? { gone_at: gone } : {}) });
  const ss = (k: string, title: string) => it({ key: `session:claude:${k}`, kind: "session", title, cwd: "/w/ledger", state: "idle" });
  const base = [w("1", "팀장", "session:claude:a"), ss("a", "팀장"), w("2", "머지 담당", "session:claude:b"), ss("b", "머지 담당"), ss("c", "머지 담당 정리"), ss("d", "머지 담당 끝")];
  const prev = base.map(i => ({ item: i.key, node: "n_lead", how: "auto" }));
  const pn = [{ id: "n_lead", name: "회사", pinned_name: "회사", counts: JSON.stringify({ main: "window:m:1" }), created_at: now - 86400_000 }];
  const orders = [base, [...base].reverse(), [base[3], base[0], base[5], base[2], base[4], base[1]]];
  for (const items of orders) {
    const r = await group({ items, logs: [], cards: [], prev, prevNodes: pn, now, unit: "agent" });
    assert.equal(r.nodes.find(n => n.items.includes("window:m:1"))!.id, "n_lead", items.map(i => i.key).join(","));
  }
  const closed = [w("1", "팀장", "session:claude:a", now - 3600_000), ...base.slice(1)];
  for (const items of [closed, [...closed].reverse()]) {
    const r = await group({ items, logs: [], cards: [], prev, prevNodes: pn, now, unit: "agent" });
    const lead = r.nodes.find(n => n.items.includes("session:claude:a"));
    if (lead) assert.notEqual(r.nodes.find(n => n.items.includes("window:m:2"))!.id, "n_lead", "머지 담당이 팀장 id 를 안 가져감");
  }
});

test("같은 주 창 기록을 가진 보관된 옛 노드가 있어도 보관 안 된 팀장 노드가 이어받음 — 지난 노드 목록 순서와 상관없음", async () => {
  const w = (k: string, title: string, sess = "") => it({ key: `window:m:${k}`, kind: "window", engine: "tmux", title, win: `m:${k}`, cwd: "/w/ledger", session: sess, state: "idle" });
  const ss = (k: string, title: string) => it({ key: `session:claude:${k}`, kind: "session", title, cwd: "/w/ledger", state: "idle" });
  const items = [w("1", "팀장", "session:claude:a"), ss("a", "팀장"), w("2", "머지 담당", "session:claude:b"), ss("b", "머지 담당"), ss("c", "머지 담당 정리")];
  const prev = items.map(i => ({ item: i.key, node: "n_lead", how: "auto" }));
  const main = JSON.stringify({ main: "window:m:1" });
  const pn = [{ id: "n_old", name: "팀장(옛)", counts: main, created_at: now - 9 * 86400_000, archived_at: now - 2 * 86400_000 }, { id: "n_lead", name: "회사", pinned_name: "회사", counts: main, created_at: now - 86400_000 }];
  for (const p of [pn, [...pn].reverse()]) for (const its of [items, [...items].reverse()]) {
    const r = await group({ items: its, logs: [], cards: [], prev, prevNodes: p, now, unit: "agent" });
    assert.equal(r.nodes.find(n => n.items.includes("window:m:1"))!.id, "n_lead");
  }
});

test("에이전트 묶기: 일 번호 창(#1234 …, 열린 창)은 역할이 없어도 제 채널 — 팀장 폴더 채널에 안 섞임, 창이 닫히면 보관", async () => {
  const repo = "github.com/o/ledger";
  const items = [
    it({ key: "window:m:1", kind: "window", engine: "tmux", title: "팀장", win: "m:1", repo, session: "session:claude:t", state: "idle" }),
    it({ key: "session:claude:t", kind: "session", title: "팀장 세션", repo, state: "idle" }),
    it({ key: "window:m:2", kind: "window", engine: "tmux", title: "#3720 예시 일 둘", win: "m:2", repo, session: "session:claude:a", state: "working" }),
    it({ key: "session:claude:a", kind: "session", title: "가동률", repo, state: "working", state_at: now - 30_000 }),
    it({ key: "window:m:3", kind: "window", engine: "tmux", title: "#1961(·#1966) 태스크 지시서", win: "m:3", repo, session: "session:claude:b", state: "idle" }),
    it({ key: "session:claude:b", kind: "session", title: "지시서", repo, state: "idle" }),
    it({ key: "window:m:4", kind: "window", engine: "tmux", title: "CS 담당", win: "m:4", repo, state: "idle" }),
    it({ key: "window:m:5", kind: "window", engine: "tmux", title: "번호 없는 창", win: "m:5", repo, session: "session:claude:c", state: "working" }),
    it({ key: "session:claude:c", kind: "session", title: "다른 일", repo, state: "working", state_at: now - 30_000 }),
    it({ key: "window:m:6", kind: "window", engine: "tmux", title: "[시험] #9999 연결", win: "m:6", repo, state: "working" }),
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, unit: "agent" });
  const live = r.nodes.filter(n => !n.archived).map(n => n.name).sort();
  assert.deepEqual(live, ["#1961(·#1966) 태스크 지시서", "#3720 예시 일 둘", "CS 담당", "팀장"].sort());
  const lead = r.nodes.find(n => n.name === "팀장")!;
  const work = r.nodes.filter(n => n.name.startsWith("#"));
  assert.ok(!lead.items.includes("window:m:2") && !work.some(n => n.items.includes("window:m:5")), "번호 창은 폴더 채널에서 빠지고, 번호 없는 창은 예전처럼 폴더 채널");
  assert.ok(r.nodes.find(n => n.name.startsWith("#3720"))!.items.includes("session:claude:a"), "그 창의 세션도 같이");
  const closed1h = items.map(i => i.key === "window:m:3" ? { ...i, gone_at: now - 3600_000, state: "gone" } : i);
  const r1 = await group({ items: closed1h, logs: [], cards: [], prev: r.map, prevNodes: r.nodes.map(n => ({ id: n.id, created_at: now })), now, unit: "agent" });
  const n1 = r1.nodes.find(n => n.name.startsWith("#1961"))!;
  assert.ok(n1 && !n1.archived && n1.items.includes("session:claude:b"), "닫힌 지 1시간 — 아직 제 채널 · 세션도 그대로(팀장 채널로 안 되돌아감)");
  const gone = items.map(i => i.key === "window:m:3" ? { ...i, gone_at: now - 8 * 3600_000, state: "gone" } : i.key === "session:claude:b" ? { ...i, state_at: now - 8 * 3600_000 } : i);
  const r2 = await group({ items: gone, logs: [], cards: [], prev: r.map, prevNodes: r.nodes.map(n => ({ id: n.id, created_at: now })), now, unit: "agent" });
  assert.ok(!r2.nodes.some(n => !n.archived && n.name.startsWith("#1961")), "닫힌 지 6시간 넘은 번호 창 채널은 남기지 않음");
});

test("C 레벨 약칭도 역할: CISO · CFO · CLO · 세일즈(#9002) 창은 제 채널, 소문자 · 비슷한 낱말 · CEO 는 아님", () => {
  assert.equal(roleOf("CISO"), "CISO");
  assert.equal(roleOf("CFO"), "CFO");
  assert.equal(roleOf("CLO · 세일즈 (#9002)"), "CLO");
  assert.equal(roleOf("CTO 리뷰"), "CTO");
  for (const t of ["cto 리뷰", "Coo", "Cleo", "Coco 앱", "Ciao", "Chao 리뷰", "Echo bot", "cargo 빌드", "Cisco", "CEO 미팅 준비", "ICO"]) assert.equal(roleOf(t), "", t);
  assert.equal(roleOf("CS 담당"), "CS 담당", "예전 역할은 그대로");
});

test("팀장이 맡긴 담당 창(세션 첫 글 「[팀장 → 새 담당 · #2736 …]」 · 「[팀장 17:44] …」)도 일 번호 창이면 제 채널 — 시킨 사람 표지가 역할로 잡혀 팀장 채널로 되돌아가던 것", async () => {
  const repo = "github.com/o/ledger";
  const win = (k: string, title: string, session = "") => it({ key: `window:m:${k}`, kind: "window", engine: "tmux", title, win: `m:${k}`, repo, session, state: "working" });
  const ses = (k: string, title: string) => it({ key: `session:claude:${k}`, kind: "session", title, repo, state: "idle" });
  const items = [
    win("1", "팀장", "session:claude:t"), ses("t", "너는 팀장 세션이다"),
    win("2", "#2736 예시 일 하나", "session:claude:a"), ses("a", "[팀장 → 새 담당 · #2736 예시 일 하나] 당신은 대표 태스크 #2736"),
    win("3", "#3720 예시 일 둘", "session:claude:b"), ses("b", "[팀장 17:44] 새 대표 태스크를 맡깁니다. 지시서 전문"),
    win("4", "#2586 예시 일 셋"), ses("c", "[팀장 → 새 #2586 담당 (w17:p1V, 계정 a)] 당신은 #2586"),   // 창과 세션이 같은 일 번호로만 이어짐
    ses("d", "[팀장 → 새 담당] 대표 태스크 #2661 「예시 평가」 담당을 맡아"),
    win("5", "회의록 창", "session:claude:e"), ses("e", "[팀장 → 회의 녹음 담당] 녹음 정리"),            // 받는 쪽이 역할이면 그 역할(그대로)
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, unit: "agent" });
  const at = (k: string) => r.nodes.find(n => n.items.includes(k))?.name;
  assert.equal(at("window:m:2"), "#2736 예시 일 하나");
  assert.equal(at("session:claude:a"), "#2736 예시 일 하나", "그 창의 세션도 같이");
  assert.equal(at("window:m:3"), "#3720 예시 일 둘");
  assert.equal(at("window:m:4"), "#2586 예시 일 셋", "시킨 사람 표지 역할은 일 번호 이음으로 번호 창에 안 넘어감");
  assert.equal(at("session:claude:d"), "팀장", "창 없는 지시 세션은 팀장 채널(예전 그대로)");
  assert.equal(at("window:m:5"), "회의 녹음 담당");
  assert.ok(!r.nodes.find(n => n.name === "팀장")!.items.some(k => /^window:m:[234]$/.test(k)));
});
