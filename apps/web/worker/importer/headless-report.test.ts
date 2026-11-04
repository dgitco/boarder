// node --test apps/web/worker/importer/headless-report.test.ts
// Headless sender attribution is independent of the current terminal-window snapshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { group, type Item } from "./group.ts";

const now = 1_793_800_000_000;
const lead: Item = { key: "window:mini:lead", kind: "window", engine: "herdr-own", title: "팀장", win: "mini:lead", state: "working", seen_at: now };
const task = { id: "tk_9001", name: "#9001 — 합성 업무", issue: "example/demo#9001" };
const sender = "mini:codex:headless", senderName = "#9001 Codex 담당";
const logs = [{ win: sender, kind: "reply", text: "합성 최종 답", at: now }];
const base = { items: [lead], logs, cards: [], prev: [], prevNodes: [], winNames: { [sender]: senderName }, now, unit: "agent" as const, tasks: [task], reportRepo: "example/demo", taskChannels: true };

test("windowless Codex reply belongs once to its task, never the largest agent channel", async () => {
  const r = await group(base);
  const report = r.nodes.find(n => n.items.includes("win:" + sender))!;
  assert.equal(report.id, task.id);
  assert.equal(report.counts.log, 1);
  assert.equal(r.map.filter(m => m.item === "win:" + sender).length, 1);
  assert.equal(r.nodes.find(n => n.items.includes(lead.key))?.counts.log, 0);
});

test("without a matching task the sender has its own named node", async () => {
  const r = await group({ ...base, tasks: [], winNames: { [sender]: "Codex 담당" } });
  const report = r.nodes.find(n => n.items.includes("win:" + sender))!;
  assert.equal(report.name, "Codex 담당");
  assert.notEqual(report.id, r.map.find(m => m.item === lead.key)?.node);
});

test("a full window sync and repeated regroup preserve the virtual sender link exactly once", async () => {
  const first = await group(base);
  const prevNodes = first.nodes.map(n => ({ ...n, counts: JSON.stringify(n.counts), archived_at: null }));
  // report rows can fall outside regroup's latest 400 while a window snapshot changes.
  const next = await group({ ...base, items: [], logs: [], prev: first.map, prevNodes, now: now + 60_000 });
  assert.equal(next.map.find(m => m.item === "win:" + sender)?.node, task.id);
  assert.equal(next.map.filter(m => m.item === "win:" + sender).length, 1);
  const again = await group({ ...base, items: [], prev: next.map, prevNodes, now: now + 120_000 });
  assert.equal(again.map.find(m => m.item === "win:" + sender)?.node, task.id);
  assert.equal(again.nodes.find(n => n.id === task.id)?.counts.log, 1);
  assert.deepEqual(logs, [{ win: sender, kind: "reply", text: "합성 최종 답", at: now }], "group never copies or rewrites source messages");
});

test("a numbered sender uses only its known ledger repo; ambiguity stays on the sender node", async () => {
  const other = { ...task, id: "tk_other", issue: "other/demo#9001" };
  const scoped = await group({ ...base, tasks: [task, other] });
  assert.equal(scoped.map.find(m => m.item === "win:" + sender)?.node, task.id);
  const unknown = await group({ ...base, reportRepo: undefined, tasks: [task] });
  assert.notEqual(unknown.map.find(m => m.item === "win:" + sender)?.node, task.id);
  const ambiguous = await group({ ...base, tasks: [task, { ...task, id: "tk_duplicate" }] });
  assert.ok(!ambiguous.map.find(m => m.item === "win:" + sender)?.node.startsWith("tk_"));
  const bare = await group({ ...base, reportRepo: undefined, tasks: [{ ...task, issue: "#9001" }] });
  assert.equal(bare.map.find(m => m.item === "win:" + sender)?.node, task.id);
});

test("a returning real terminal replaces the virtual source instead of duplicating its reply", async () => {
  const first = await group(base);
  const real: Item = { ...lead, key: "window:" + sender, title: senderName, win: sender, repo: "github.com/example/demo" };
  const r = await group({ ...base, items: [lead, real], prev: first.map });
  assert.equal(r.map.filter(m => m.item === "win:" + sender).length, 0);
  assert.equal(r.map.find(m => m.item === real.key)?.node, task.id);
  assert.equal(r.nodes.reduce((n, x) => n + Number(x.counts.log), 0), 1);
});
