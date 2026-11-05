import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

// engine.ts 의 cloudflare:workers 는 Workers 밖에 없음 — 빈 DurableObject 로 갈음(node-close.test.ts 와 같음)
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { mountImport, regroup } = await import("./routes.ts");
const { Hono } = await import("hono");

const MIG = new URL("../../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const batch = async (ss: any[]) => {
    db.exec("BEGIN");
    try { const out = []; for (const s of ss) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database };
}

const A = "member@example.com";
function app(D1: D1Database) {
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  mountImport(a, { device: async () => null, member: async () => A, sameSite: () => true });
  return (path: string, body: unknown) => a.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { DB: D1, PUBLIC_URL: "https://example.test" });
}

const D = 86400_000;
const KEYS = ["window:m:1", "session:claude:a", "window:m:2", "session:claude:b"];
function seed(unit: string | null) {
  const f = d1(), t = Date.now();
  const item = (key: string, kind: string, title: string, o: { win?: string; session?: string; state?: string; gone?: number | null } = {}) =>
    f.db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, state, state_at, win, session, seen_at, gone_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(A, key, "dev1", kind, kind === "window" ? "tmux" : "claude", title, "/w/proj", o.state || "idle", null, o.win || "", o.session || "", t - 60_000, o.gone ?? null);
  item("window:m:1", "window", "팀장", { win: "m:1", session: "session:claude:a", state: "gone", gone: t - 3600_000 });
  item("session:claude:a", "session", "팀장 세션입니다");
  item("window:m:2", "window", "비서실장", { win: "m:2", session: "session:claude:b" });
  item("session:claude:b", "session", "비서실장 일 정리");
  const node = f.db.prepare("INSERT INTO mnode(owner, id, name, area, state, why, counts, created_at, updated_at, archived_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  node.run(A, "n_old", "팀장", "proj", "done", "", "{}", t - 9 * D, t - 5 * D, t - 5 * D);
  node.run(A, "n_cur", "팀장", "proj", "idle", "", "{}", t - D, t - 60_000, null);
  for (const k of KEYS) f.db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?, 'auto')").run(A, k, "n_cur");
  if (unit) f.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?, ?, ?)").run(A, JSON.stringify({ unit }), t);
  return f;
}
const row = (db: DatabaseSync, id: string) => db.prepare("SELECT name, pinned_name, archived_at FROM mnode WHERE owner = ? AND id = ?").get(A, id) as { name: string; pinned_name: string | null; archived_at: number | null };
const nodesOf = (db: DatabaseSync) => Object.fromEntries((db.prepare("SELECT item, node FROM mnode_item WHERE owner = ?").all(A) as { item: string; node: string }[]).map(r => [r.item, r.node]));

test("에이전트 채널: 이름 고정한 노드는 다음 묶기에 보관 · 대체되지 않고 같은 창들이 그 노드에 남음 — 같은 이름의 옛 보관 노드가 있어도", async () => {
  const { db, D1 } = seed("agent");
  await regroup({ DB: D1 } as any, A);
  assert.equal(row(db, "n_cur").archived_at, null, "고정 전: 지금 채널 노드 그대로");
  assert.equal(nodesOf(db)["window:m:2"], "n_cur");
  assert.equal((await app(D1)("/api/me/nodes/edit", { op: "rename", node: "n_cur", name: "비서실장 채널" })).status, 200);
  for (let i = 0; i < 3; i++) await regroup({ DB: D1 } as any, A);   // 보드 열 때마다(fresh0) 다시 묶음
  const cur = row(db, "n_cur");
  assert.equal(cur.archived_at, null, "이름 고정한 노드가 보관되지 않음");
  assert.equal(cur.pinned_name, "비서실장 채널"); assert.equal(cur.name, "비서실장 채널");
  const map = nodesOf(db);
  for (const k of ["window:m:2", "session:claude:b"]) assert.equal(map[k], "n_cur", `${k} 는 이름 고정한 노드에 남음`);
  assert.notEqual(row(db, "n_old").archived_at, null, "같은 이름의 옛 보관 노드가 되살아나지 않음");
});

test("에이전트 채널: 이름을 안 바꾸면 예전 그대로(지금 채널 노드 유지 · 옛 노드 보관 그대로)", async () => {
  const { db, D1 } = seed("agent");
  for (let i = 0; i < 3; i++) await regroup({ DB: D1 } as any, A);
  assert.equal(row(db, "n_cur").archived_at, null); assert.equal(row(db, "n_cur").name, "팀장"); assert.equal(row(db, "n_cur").pinned_name, null);
  assert.equal(nodesOf(db)["window:m:2"], "n_cur");
  assert.notEqual(row(db, "n_old").archived_at, null);
});

test("묶는 단위를 고르지 않은 사람(설정 없음): 이름 고정해도 묶기 결과는 고정 안 한 때와 같음 · 그 노드는 보관 안 됨", async () => {
  const run = async (rename: boolean) => {
    const { db, D1 } = seed(null);
    if (rename) assert.equal((await app(D1)("/api/me/nodes/edit", { op: "rename", node: "n_cur", name: "비서실장 채널" })).status, 200);
    for (let i = 0; i < 3; i++) await regroup({ DB: D1 } as any, A);
    return { map: nodesOf(db), cur: row(db, "n_cur"), old: row(db, "n_old") };
  };
  const plain = await run(false), renamed = await run(true);
  assert.deepEqual(renamed.map, plain.map);
  assert.equal(renamed.cur.archived_at, null); assert.equal(renamed.cur.name, "비서실장 채널");
  assert.notEqual(renamed.old.archived_at, null);
});

test("고정 노드에 낱개 하나 옮아 온 역할 채널은 제 노드(주 창 기록)를 두고 남의 고정 노드를 가져가지 않음 — 그 노드 것이 많은 폴더 채널이 이음", async () => {
  const { group } = await import("./group.ts");
  const now = Date.now(), it = (o: any) => ({ seen_at: now - 60_000, ...o });
  const w = (k: string, title: string, cwd: string, o = {}) => it({ key: k, kind: "window", engine: "tmux", title, win: k, cwd, state: "idle", ...o });
  const items = [
    w("window:d", "일 하나", "/w/proj", { session: "session:claude:d" }), it({ key: "session:claude:d", kind: "session", title: "일 하나", cwd: "/w/proj", state: "idle" }),
    w("window:e", "일 둘", "/w/proj", { session: "session:claude:e" }), it({ key: "session:claude:e", kind: "session", title: "일 둘", cwd: "/w/proj", state: "idle" }),
    w("window:b", "팀장", "/w/app", { session: "session:claude:b" }), it({ key: "session:claude:b", kind: "session", title: "팀장 세션입니다", cwd: "/w/app", state: "idle" }),
    // 지난번 n_P 에 있던 세션이 이번엔 팀장 채널로 감(세션 제목이 역할)
    it({ key: "session:claude:x", kind: "session", title: "팀장 세션입니다", cwd: "/w/app", state: "idle" }),
  ];
  const prev = [
    ...["window:d", "session:claude:d", "window:e", "session:claude:e", "session:claude:x"].map(item => ({ item, node: "n_P", how: "auto" })),
    ...["window:b", "session:claude:b"].map(item => ({ item, node: "n_Q", how: "auto" })),
  ];
  const prevNodes = [
    { id: "n_P", name: "내 채널", pinned_name: "내 채널", counts: "{}", created_at: now - D, archived_at: null },
    { id: "n_Q", name: "팀장", pinned_name: null, counts: JSON.stringify({ main: "window:b" }), created_at: now - D, archived_at: null },
  ];
  const r = await group({ items, logs: [], cards: [], prev, prevNodes, now, unit: "agent" });
  const P = r.nodes.find(n => n.id === "n_P"), Q = r.nodes.find(n => n.id === "n_Q");
  assert.ok(P && P.items.includes("window:d") && P.items.includes("window:e"), "고정 노드 n_P 는 proj 창들이 그대로");
  assert.ok(Q && Q.items.includes("window:b") && !Q.archived, "팀장은 제 노드 n_Q 그대로");
});

test("에이전트 채널: 채널 이름 그대로 고정하면(이름 짝이 그 고정 노드 쪽) 그 노드 그대로 · 옛 같은 이름 노드는 보관 그대로", async () => {
  const { db, D1 } = seed("agent");
  await regroup({ DB: D1 } as any, A);
  assert.equal((await app(D1)("/api/me/nodes/edit", { op: "rename", node: "n_cur", name: "팀장" })).status, 200);
  for (let i = 0; i < 3; i++) await regroup({ DB: D1 } as any, A);
  assert.equal(row(db, "n_cur").archived_at, null); assert.equal(row(db, "n_cur").pinned_name, "팀장");
  for (const k of ["window:m:2", "session:claude:b"]) assert.equal(nodesOf(db)[k], "n_cur");
  assert.notEqual(row(db, "n_old").archived_at, null);
});

const S = async () => {
  const { group } = await import("./group.ts");
  const now = Date.now(), it = (o: any) => ({ seen_at: now - 60_000, ...o });
  const w = (k: string, title: string, cwd: string, o = {}) => it({ key: k, kind: "window", engine: "tmux", title, win: k, cwd, state: "idle", ...o });
  return { group, now, it, w };
};
for (const closed of [false, true]) test(`동률 · 주 창 기록 없음: 이름 짝으로 제 노드가 있는 역할 채널은 남의 고정 노드를 안 가져감${closed ? "(역할 창 닫힘)" : ""}`, async () => {
  const { group, now, it, w } = await S();
  const items = [
    w("window:d", "일 하나", "/w/proj"),
    w("window:b", "팀장", "/w/app", { session: "session:claude:b", ...(closed ? { state: "gone", gone_at: now - 3600_000 } : {}) }), it({ key: "session:claude:b", kind: "session", title: "팀장 세션입니다", cwd: "/w/app", state: "idle" }),
    it({ key: "session:claude:x", kind: "session", title: "팀장 세션입니다", cwd: "/w/app", state: "idle" }),
  ];
  const prev = [{ item: "window:d", node: "n_P", how: "auto" }, { item: "session:claude:x", node: "n_P", how: "auto" }, { item: "window:b", node: "n_Q", how: "auto" }, { item: "session:claude:b", node: "n_Q", how: "auto" }];
  const prevNodes = [
    { id: "n_P", name: "내 채널", pinned_name: "내 채널", counts: "{}", created_at: now - D, archived_at: null },
    { id: "n_Q", name: "팀장", pinned_name: null, counts: "{}", created_at: now - D, archived_at: null },
  ];
  const r = await group({ items, logs: [], cards: [], prev, prevNodes, now, unit: "agent" });
  assert.ok(r.nodes.find(n => n.id === "n_Q" && n.items.includes("session:claude:b")), "팀장은 제 노드 n_Q");
  assert.ok(r.nodes.find(n => n.id === "n_P" && n.items.includes("window:d")), "고정 노드 n_P 는 proj");
});
test("한 묶음이 고정 노드 둘에 걸치면 있던 개수가 큰 노드를 이음(id 순 아님)", async () => {
  const { group, now, it, w } = await S();
  const items = [
    w("window:d", "일 하나", "/w/proj", { session: "session:claude:d" }), it({ key: "session:claude:d", kind: "session", title: "일 하나", cwd: "/w/proj", state: "idle" }),
    w("window:e", "일 둘", "/w/proj"),
    it({ key: "session:claude:y", kind: "session", title: "일 셋", cwd: "/w/proj", state: "idle" }),
  ];
  const prev = [...["window:d", "session:claude:d", "window:e"].map(item => ({ item, node: "n_z", how: "auto" })), { item: "session:claude:y", node: "n_a", how: "auto" }];
  const prevNodes = [
    { id: "n_z", name: "진짜 채널", pinned_name: "진짜 채널", counts: "{}", created_at: now - D, archived_at: null },
    { id: "n_a", name: "옛 고정", pinned_name: "옛 고정", counts: "{}", created_at: now - 2 * D, archived_at: null },
  ];
  const r = await group({ items, logs: [], cards: [], prev, prevNodes, now, unit: "agent" });
  assert.ok(r.nodes.find(n => n.id === "n_z" && n.items.includes("window:d")), "있던 것이 많은 n_z 를 이음");
});
test("고정 노드의 주 창 기록이 든 제 채널이 그 노드를 지킴 — 그 노드에 있던 세션 하나가 나간 일 번호 채널이 가져가지 않고 옛 같은 이름 보관 노드도 안 살아남", async () => {
  const { group, now, it, w } = await S();
  const items = [
    w("window:b", "팀장", "/w/app", { session: "session:claude:b" }), it({ key: "session:claude:b", kind: "session", title: "팀장 세션입니다", cwd: "/w/app", state: "idle" }),
    w("window:c", "일 하나", "/w/app"),
    w("window:n", "#1234 예시 일", "/w/app", { session: "session:claude:x" }),
    it({ key: "session:claude:x", kind: "session", title: "[팀장 → 새 담당] #1234", cwd: "/w/app", state: "idle" }),
  ];
  const prev = ["window:b", "session:claude:b", "window:c", "session:claude:x"].map(item => ({ item, node: "n_P", how: "auto" }));
  const prevNodes = [
    { id: "n_P", name: "비서실장 채널", pinned_name: "비서실장 채널", counts: JSON.stringify({ main: "window:b" }), created_at: now - D, archived_at: null },
    { id: "n_old", name: "팀장", pinned_name: null, counts: "{}", created_at: now - 9 * D, archived_at: now - 5 * D },
  ];
  const r = await group({ items, logs: [], cards: [], prev, prevNodes, now, unit: "agent" });
  assert.ok(r.nodes.find(n => n.id === "n_P" && n.items.includes("window:b")), "팀장 창은 고정 노드 n_P 에 남음");
  assert.ok(!r.nodes.find(n => n.id === "n_old" && !n.archived), "옛 보관 노드 n_old 가 되살아나지 않음");
});
