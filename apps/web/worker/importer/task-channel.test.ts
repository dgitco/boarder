import { taskIssueFor } from "./task-repo.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { group, type Item } from "./group.ts";
const now = 1_793_800_000_000;
const w = (key: string, title: string, extra: Partial<Item> = {}): Item => ({ key, kind: "window", engine: "herdr-own", title, repo: "github.com/example/demo", win: key.slice(7), seen_at: now, state: "working", ...extra });
const task = { id: "tk_9001", name: "#9001 — 통장 연결 (가짜)", issue: "example/demo#9001" };
const run = (items: Item[], extra: object = {}) => group({ items, logs: [], cards: [], prev: [], prevNodes: [], now, unit: "agent", tasks: [task], taskChannels: true, ...extra } as Parameters<typeof group>[0]);

test("16:33 bank-thread 이동: 계정·기기·제목이 달라도 같은 태스크 한 칸, 옛 창 줄·카드·세션 보존", async () => {
  const old = w("window:mini:bank-thread-a", "#9001 bank-thread · 계정 a", { session: "session:claude:bank", gone_at: now - 8 * 3600_000, state: "gone" });
  const next = w("window:mbp:bank-thread-b", "#9001 bank-thread · 계정 b · 16:33", { session: "session:claude:bank" });
  const worker = w("window:mbp:worker", "작업자 #9001 · PR 준비");
  const r = await run([old, next, worker], { logs: [{ win: old.win!, kind: "progress", text: "옛 글", at: now - 8 * 3600_000 }], cards: [{ id: "c", win: old.win!, state: "open", question: "옛 카드", at: now }] });
  assert.equal(r.nodes.length, 1);
  assert.equal(r.nodes[0].id, task.id); assert.equal(r.nodes[0].name, task.name);
  assert.deepEqual(new Set(r.nodes[0].items), new Set([old.key, next.key, worker.key]));
  assert.equal(r.nodes[0].counts.log, 1); assert.equal(r.nodes[0].counts.card, 1);
  assert.equal(r.audit.missing, 0);
});

test("같은 Claude session id는 세션 행 없이 열린 두 창도 한 칸, 제목 바뀐 뒤에도 노드 id 유지", async () => {
  const a = w("window:mini:a", "bank-thread", { session: "session:claude:bank" });
  const b = w("window:mbp:b", "옮겨 연 대화", { session: "session:claude:bank" });
  const r = await run([a, b], { tasks: [], prev: [{ item: a.key, node: "n_old", how: "auto" }], prevNodes: [{ id: "n_old", name: "bank-thread", created_at: now - 1000 }] });
  assert.equal(r.nodes.length, 1); assert.equal(r.nodes[0].id, "n_old"); assert.equal(r.nodes[0].items.length, 2);
});

test("태스크는 리포 전체 경로로 구별, 겹친 번호·끝난 태스크·시험 창은 자동 연결 안 함", async () => {
  const a = w("window:a", "#9001 일");
  const b = w("window:b", "#9001 다른 조직", { repo: "github.com/other/demo" });
  const c = w("window:c", "[시험] #9001 연결");
  const r = await run([a, b, c]);
  assert.ok(r.map.some(m => m.item === a.key && m.node === task.id));
  for (const k of [b.key, c.key]) assert.ok(!r.map.some(m => m.item === k && m.node === task.id));
  const done = await run([a], { tasks: [{ ...task, archived_at: now }] });
  assert.ok(!done.map.some(m => m.node === task.id));
  const finished = await run([a], { tasks: [{ ...task, archived_at: now }], prev: [{ item: a.key, node: task.id, how: "auto" }] });
  assert.ok(!finished.map.some(m => m.node === task.id), "완료 업무의 옛 auto 배정표로 돌아가지 않음");
  const ambiguous = await run([a], { tasks: [{ ...task, issue: "#9001" }, { ...task, id: "tk_other", issue: "#9001" }] });
  assert.ok(!ambiguous.map.some(m => m.node.startsWith("tk_")));
});

test("사람이 옮긴 pin은 자동 태스크보다 우선, 같은 세션으로 이동하면 그 pin을 이어받음", async () => {
  const a = w("window:mini:a", "#9001 일", { session: "session:claude:bank", gone_at: now - 1000 });
  const b = w("window:mbp:b", "#9001 이어 열기", { session: "session:claude:bank" });
  const r = await run([a, b], { prev: [{ item: a.key, node: "tk_manual", how: "pin" }] });
  assert.equal(r.map.find(m => m.item === a.key)?.node, "tk_manual");
  assert.equal(r.map.find(m => m.item === b.key)?.node, "tk_manual");
});

test("태스크 없는 기존 agent 채널·서로 다른 Claude 대화는 유지", async () => {
  const r = await run([w("window:a", "팀장"), w("window:b", "#9999 다른 일", { session: "session:claude:other" })]);
  assert.equal(r.nodes.length, 2); assert.ok(!r.nodes.some(n => n.id.startsWith("tk_")));
});


test("번호만 있는 업무는 리포 설정(task_repo)이 없으면 리포를 추정하지 않고, 설정한 리포도 다른 리포와 안 섞임", async () => {
  const raw = { ...task, issue: "#9001" };
  const other = w("window:other", "#9001 다른 리포", { repo: "github.com/other/demo" });
  assert.ok(!(await run([other], { tasks: [raw] })).map.some(m => m.node === raw.id));
  assert.equal(taskIssueFor("", raw.issue), "#9001");
  const known = { ...raw, issue: taskIssueFor("ledger-org/ledger", raw.issue) };
  const own = w("window:own", "#9001 장부 일", { repo: "github.com/ledger-org/ledger" });
  const r = await run([own, other], { tasks: [known] });
  assert.equal(r.map.find(m => m.item === own.key)?.node, raw.id);
  assert.notEqual(r.map.find(m => m.item === other.key)?.node, raw.id);
  assert.equal(taskIssueFor("ledger-org/ledger", "example/demo#9001"), "example/demo#9001");
});

const H = 3600_000, D = 24 * H;
const pn = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, pinned_name: null, counts: "{}", created_at: now - 90 * D, updated_at: now - 30 * D, archived_at: null, ...extra });
const on = (input: Record<string, unknown>) => group({ items: [], logs: [], cards: [], prev: [], prevNodes: [], now, agents: [], taskChannels: true, ...input } as Parameters<typeof group>[0]);
const alive = (r: Awaited<ReturnType<typeof group>>, item: string) => r.nodes.filter(n => !n.archived && n.items.includes(item));

test("리뷰 3: 보관된 보고자 노드는 되살아나지 않음(세 단위)", async () => {
  for (const unit of [undefined, "goal", "agent"]) {
    const r = await on({ unit, prev: [{ item: "win:mac:old-sender", node: "n_old", how: "auto" }], prevNodes: [pn("n_old", "old-sender", { archived_at: now - 7 * D })] });
    assert.deepEqual(alive(r, "win:mac:old-sender"), [], String(unit));
  }
});

test("리뷰 3: 줄이 90일 전인 옛 보고자 서른은 노드로 남지 않고, 400줄 밖이어도 최근에 움직인 보고자는 남음", async () => {
  for (const unit of ["goal", "agent"]) {
    const old = await on({ unit, logs: Array.from({ length: 30 }, (_, i) => ({ win: "mac:old" + i, kind: "log", text: "x", at: now - 90 * D + i })) });
    assert.equal(old.nodes.filter(n => !n.archived).length, 0, unit);
    const quiet = await on({ unit, prev: [{ item: "win:mac:quiet", node: "n_q", how: "auto" }], prevNodes: [pn("n_q", "quiet", { updated_at: now - 30 * D })] });
    assert.deepEqual(alive(quiet, "win:mac:quiet"), [], unit + " 보관 시간 넘게 조용함");
    const recent = await on({ unit, prev: [{ item: "win:mac:recent", node: "n_r", how: "auto" }], prevNodes: [pn("n_r", "recent", { updated_at: now - H })] });
    assert.equal(alive(recent, "win:mac:recent").length, 1, unit + " 한 시간 전에 움직임");
  }
});

test("리뷰 4: 업무에 붙은 창이 닫히고 7시간 지나도 그 창은 업무에 남음(agent · goal)", async () => {
  const closed = w("window:m:1", "#9001 고침", { gone_at: now - 7 * H, seen_at: now - 8 * H, state: "gone" });
  for (const unit of ["agent", "goal"]) {
    const r = await on({ unit, items: [closed], logs: [{ win: closed.win!, kind: "log", text: "옛 보고", at: now - 8 * H }], prev: [{ item: closed.key, node: task.id, how: "auto" }], tasks: [task] });
    assert.equal(r.map.find(m => m.item === closed.key)?.node, task.id, unit);
    assert.equal(r.nodes.find(n => n.id === task.id)?.counts.log, 1, unit);
  }
});

test("리뷰 5: 스레드 하나만 사람이 옮기면 창 · 세션은 제자리, 옮긴 창의 세션만 따라가고 저장은 auto", async () => {
  const W = w("window:m:2", "기능 A 만들기", { branch: "feat/a", session: "session:claude:a", state: "idle" });
  const S: Item = { key: "session:claude:a", kind: "session", title: "기능 A", seen_at: now };
  const T: Item = { key: "thread:slack:1", kind: "thread", title: "관련 스레드", repo: W.repo, branch: "feat/a", seen_at: now };
  const prevNodes = [pn("n_a", "기능 A"), pn("n_x", "딴 노드")];
  const r1 = await on({ unit: "goal", items: [W, S, T], prevNodes, prev: [{ item: W.key, node: "n_a", how: "auto" }, { item: S.key, node: "n_a", how: "auto" }, { item: T.key, node: "n_x", how: "pin" }] });
  const at1 = (k: string) => r1.map.find(m => m.item === k);
  assert.deepEqual([at1(W.key), at1(S.key), at1(T.key)], [{ item: W.key, node: "n_a", how: "auto" }, { item: S.key, node: "n_a", how: "auto" }, { item: T.key, node: "n_x", how: "pin" }]);
  const r2 = await on({ unit: "goal", items: [W, S, T], prevNodes, prev: [{ item: W.key, node: "n_x", how: "pin" }, { item: S.key, node: "n_a", how: "auto" }, { item: T.key, node: "n_a", how: "auto" }] });
  const at2 = (k: string) => r2.map.find(m => m.item === k);
  assert.deepEqual([at2(W.key)?.node, at2(W.key)?.how, at2(S.key)?.node, at2(S.key)?.how], ["n_x", "pin", "n_x", "auto"]);
  assert.notEqual(at2(T.key)?.node, "n_x");
});

test("채널 = 태스크 켠 사람: 업무에 붙은 창이 닫힌 지 오래 · 그 창 줄이 최신 400줄 밖이어도 업무 이음은 남음", async () => {
  const NOW = 1_793_200_000_000, H = 3600_000;
  const w12 = { key: "window:m:1", kind: "window", engine: "tmux-own", title: "#12 고침", repo: "o/r", win: "m:1", seen_at: NOW - 8 * H, gone_at: NOW - 7 * H };
  const tasks = [{ id: "tk_12", name: "업무12", issue: "o/r#12" }];
  for (const unit of ["goal", "agent"] as const) {
    const r = await group({ items: [w12] as never, logs: [], cards: [], prev: [{ item: "window:m:1", node: "tk_12", how: "auto" }], prevNodes: [], now: NOW, unit, taskChannels: true, tasks } as never);
    assert.ok(r.map.some(m => m.item === "window:m:1" && m.node === "tk_12"), unit);
    const off = await group({ items: [w12] as never, logs: [], cards: [], prev: [{ item: "window:m:1", node: "tk_12", how: "auto" }], prevNodes: [], now: NOW, unit, tasks } as never);
    assert.ok(!off.map.some(m => m.item === "window:m:1"), `${unit} 끈 사람은 예전 그대로(보관 시간 지난 창은 묶지 않음)`);
  }
});
