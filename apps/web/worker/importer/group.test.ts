// node --test apps/web/worker/importer/group.test.ts (Node 24 타입 지우기)
import { test } from "node:test";
import assert from "node:assert/strict";
import { group, pickUnit, roleOf, type Item } from "./group.ts";

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

test("노드 = 목표: 같은 일 번호는 한 노드, 글에 언급된 링크로 다른 이름 창끼리 붙지 않음", async () => {
  const ref = "gh:o/ledger#2586", repo = "github.com/o/ledger";
  const items = [
    it({ key: "window:m:1", kind: "window", engine: "tmux", title: "#7000 영업 총괄", win: "m:1", repo, refs: [ref], state: "idle", session: "session:claude:a" }),
    it({ key: "window:m:2", kind: "window", engine: "tmux", title: "작업자 #7000 개발", win: "m:2", repo, state: "idle", session: "session:claude:b" }),
    it({ key: "window:m:3", kind: "window", engine: "tmux", title: "#2661 평가서", win: "m:3", repo, refs: [ref], state: "idle", session: "session:claude:c" }),
    it({ key: "session:claude:a", kind: "session", title: "영업", repo, state: "idle", state_at: now - 60_000 }),
    it({ key: "session:claude:b", kind: "session", title: "개발", repo, state: "idle", state_at: now - 60_000 }),
    it({ key: "session:claude:c", kind: "session", title: "평가", repo, state: "idle", state_at: now - 60_000 }),
    it({ key: "session:claude:d", kind: "session", title: "#2661 지난 세션", repo, state: "idle", state_at: now - 86400_000 }),
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, unit: "goal" });
  const nodeOf = (k: string) => r.nodes.find(n => n.items.includes(k))!.id;
  assert.equal(nodeOf("window:m:1"), nodeOf("window:m:2"));
  assert.notEqual(nodeOf("window:m:1"), nodeOf("window:m:3"));
  assert.equal(nodeOf("session:claude:d"), nodeOf("window:m:3"));
  assert.equal(r.nodes.length, 2);
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
    it({ key: "window:m:2", kind: "window", engine: "tmux", title: "#2736 온보딩 끝까지", win: "m:2", repo, session: "session:claude:b", state: "idle" }),
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
  assert.deepEqual(r.nodes.map(n => n.name).sort(), ["개인 비서", "팀장", "회의 녹음 담당"].sort());
  const lead = r.nodes.find(n => n.name === "팀장")!;
  assert.equal(lead.items.includes("session:claude:b"), true);
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
    ["[팀장 → 회의 녹음 담당] 대표님", "회의 녹음 담당"], ["[팀장 → 새 담당] 대표 태스크", "팀장"], ["[팀장 17:44] 새 태스크", "팀장"], ["#7000 영업·마케팅 총괄", "영업·마케팅 총괄"], ["작업자 · 7003", ""], ["아니 boarder로 어떻게 옮겨진거야? 팀장 세션이", ""], ["고객봇 전 기능·문의 응대 (#7002)", ""]] as const)
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
    it({ key: "window:a", kind: "window", title: "#2736 온보딩 끝까지", win: "a", session: "session:claude:s1", state: "working" }),
    it({ key: "session:claude:s1", kind: "session", title: "[팀장 → 새 작업] 온보딩" }),
    it({ key: "window:b", kind: "window", title: "팀장", win: "b", state: "working" }),
    it({ key: "window:c", kind: "window", title: "CLO", win: "c", state: "idle" }),
    it({ key: "window:d", kind: "window", title: "CTO", win: "d", state: "idle" }),
  ];
  const r = await group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, unit: "agent", agents: ["팀장", "CLO", "CTO"] });
  assert.equal(r.nodes.find(n => n.name === "팀장")!.counts.main, "window:b");
});

