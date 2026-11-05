import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { load, loadRead, loadForget, get, readOpts } = await import("./member-board.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:"); let batches = 0;
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { db, count: () => batches, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { batches++; const out = []; for (const s of ss) out.push(await s.all()); return out; } } as unknown as D1Database };
}
const ME = "share@example.com", CTX = { waitUntil: (_p: Promise<unknown>) => {} };

test("loadRead: 같은 사람의 읽기가 0.4초 안에 몰리면 load 한 번, 쓰기(loadForget) 뒤에는 새로 읽음, 다른 사람은 따로", async () => {
  const { D1, count } = d1();
  const [a, b] = await Promise.all([loadRead(D1, ME, CTX), loadRead(D1, ME, CTX)]);
  assert.equal(count(), 1); assert.equal(a, b);
  await loadRead(D1, ME, CTX); assert.equal(count(), 1);
  loadForget("Share@Example.com"); await loadRead(D1, ME, CTX); assert.equal(count(), 2);   // 버림은 대소문자 상관없이
  await loadRead(D1, "other@example.com", CTX); assert.equal(count(), 3);
  await load(D1, ME); assert.equal(count(), 4);   // load 는 늘 새로(쓰기 길)
  await loadRead(D1, ME); assert.equal(count(), 5);   // ctx 없으면 나눠 쓰지 않음(남의 요청 읽기를 붙잡을 수 없음)   // load 는 늘 새로(쓰기 길)
  loadForget(ME); loadForget("other@example.com");
});

test("loadRead: 0.4초가 지나면 새로 읽음 · 실패한 읽기는 나눠 주지 않음", async () => {
  const { D1, count } = d1(), real = Date.now;
  try {
    let t = real(); Date.now = () => t;
    const kept: Promise<unknown>[] = [], C2 = { waitUntil: (p: Promise<unknown>) => { kept.push(p); } };
    await loadRead(D1, ME, C2); assert.equal(kept.length, 1);   // 먼저 읽은 요청이 waitUntil 로 붙잡음
    t += 401; await loadRead(D1, ME, C2); assert.equal(count(), 2);
    const bad = { ...D1, batch: async () => { throw new Error("D1_ERROR: overloaded"); } } as unknown as D1Database;
    t += 401; await assert.rejects(loadRead(bad, ME, C2)); await Promise.all(kept);
    await loadRead(D1, ME, C2); assert.equal(count(), 3);   // 실패 뒤 바로 다음 요청은 새로 읽음
  } finally { Date.now = real; loadForget(ME); }
});

test("지난 항목: 코드가 보내는 질의 둘(아직 있음 + 2분 안 · 하루 안 맡김)을 합치면 예전 OR 꼴과 같은 줄, 하루 넘게 사라진 것 · 남의 것은 안 섞임", async () => {
  const { db, D1 } = d1(), now = Date.now(), P = "past@example.com";   // 앞 시험이 ME 의 하루 치를 맡겨 두었을 수 있어 새 사람
  const add = (owner: string, key: string, gone: number | null) => db.prepare("INSERT INTO imp_item(owner, key, kind, title, seen_at, gone_at) VALUES (?,?,?,?,?,?)").run(owner, key, "window", key, now, gone);
  add(P, "live", null); add(P, "recent", now - 3600_000); add(P, "old", now - 3 * 86_400_000); add("other@example.com", "theirs", null); add("other@example.com", "theirs2", now - 60_000);
  const seen: { sql: string; args: unknown[] }[] = [];
  const spy = { ...D1, prepare: (sql: string) => { const st = (D1 as any).prepare(sql); if (/handle END handle FROM imp_item/.test(sql)) return { ...st, bind: (...a: unknown[]) => { seen.push({ sql, args: a }); return st.bind(...a); } }; return st; } } as unknown as D1Database;
  await load(spy, P);
  assert.equal(seen.length, 2, "load 가 지난 항목 질의 둘을 보냄");
  const got = [...new Set(seen.flatMap(q => (db.prepare(q.sql).all(...(q.args as never[])) as { key: string }[]).map(r => r.key)))].sort();
  const was = (db.prepare("SELECT key FROM imp_item WHERE owner = ? AND (gone_at IS NULL OR gone_at > ?)").all(P, now - 86_400_000) as { key: string }[]).map(r => r.key).sort();
  assert.deepEqual(got, ["live", "recent"]); assert.deepEqual(got, was);
  for (const q of seen) {
    const plan = (db.prepare("EXPLAIN QUERY PLAN " + q.sql).all(...(q.args as never[])) as { detail: string }[]).map(r => r.detail).join(" | ");
    assert.match(plan, /imp_item_owner/); assert.doesNotMatch(plan, /SCAN imp_item(?! USING)/);   // 색인 범위로만(표 통째 훑기 없음)
  }
});

test("지난 항목 맡김: 60초 안 다음 load 는 하루 치를 다시 안 읽음 · 막 닫힌 것(2분 안)은 늘 보임 · 다시 살아난 것은 새 줄이 이김", async () => {
  const { db, D1 } = d1(), real = Date.now, who = "gonememo@example.com";
  try {
    let t = real(); Date.now = () => t;
    const add = (key: string, gone: number | null) => { db.prepare("INSERT INTO imp_item(owner, key, kind, title, seen_at, gone_at) VALUES (?,?,?,?,?,?)").run(who, key, "window", key, t, gone); db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?,?,?,?)").run(who, key, "n1", "auto"); };
    db.prepare("INSERT INTO mnode(owner, id, name, state, why, counts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(who, "n1", "노드", "working", "", "{}", t, t);
    const view = (L: any) => { const n = L.byId.get("n1"); return { live: n.windows.map((w: any) => w.key).sort(), gone: n.goneWins || 0 }; };
    let dayReads = 0;
    const spy = { ...D1, prepare: (sql: string) => { if (/handle END handle FROM imp_item WHERE owner = \? AND gone_at > \?$/.test(sql) && !/UNION/.test(sql)) dayReads++; return (D1 as any).prepare(sql); } } as unknown as D1Database;
    const keys = async () => { const L = await load(spy, who) as any; return L; };
    add("a", null); add("b", t - 3600_000);
    assert.deepEqual(view(await keys()), { live: ["a"], gone: 1 }); assert.equal(dayReads, 1);
    t += 10_000; add("c", t - 1000);   // 맡긴 뒤 막 닫힘 — 2분 안이라 새 질의가 잡음
    db.prepare("UPDATE imp_item SET gone_at = NULL WHERE owner = ? AND key = 'b'").run(who);   // 다시 살아남
    const seenRows: Record<string, any>[] = [];
    const spy2 = { ...spy, prepare: (sql: string) => { const st = (spy as any).prepare(sql); if (/UNION ALL/.test(sql) && /FROM imp_item/.test(sql)) return { ...st, bind: (...a: unknown[]) => { const b = st.bind(...a); return { ...b, all: async () => { const r = await b.all(); seenRows.push(...r.results); return r; } }; } }; return st; } } as unknown as D1Database;
    const L2 = await load(spy2, who); assert.equal(dayReads, 1, "60초 안이면 하루 치는 맡긴 것");
    assert.deepEqual(view(L2), { live: ["a", "b"], gone: 1 }, "살아난 b 는 창 목록에(맡긴 닫힌 b 를 새 줄이 이김) · 막 닫힌 c 는 닫힌 창 수에");
    assert.deepEqual(seenRows.map(r => r.key).sort(), ["a", "b", "c"], "새 질의가 아직 있음(a · 살아난 b) + 2분 안(c)");
    t += 120_000; const L3 = await load(spy, who) as any; assert.equal(dayReads, 1, "2분(예전 60초 맡김은 지남)이어도 5분 안이면 맡긴 것");
    assert.deepEqual(view(L3), { live: ["a", "b"], gone: 1 }, "맡긴 뒤 2분 넘게 전에 닫힌 c 도 닫힌 창 수에 — 새로 읽는 폭(6분)이 맡김(5분)보다 길어 빈틈 없음");
    t += 181_000; await load(spy, who); assert.equal(dayReads, 2, "5분 지나면 다시 읽음");
  } finally { Date.now = real; }
});

test("/api/topics: Cache API가 없으면 0.4초 안 같은 요청은 load 를 나눠 씀(loadRead)", async () => {
  const { D1, count } = d1(), url = new URL("https://x.test/api/topics"), none = async () => null;
  const call = () => get(D1, ME, { name: "봇" }, url, none, undefined, null, CTX, async () => "~1");
  assert.equal((await call())?.status, 200); const n = count();
  assert.equal((await call())?.status, 200); assert.equal(count(), n);
  loadForget(ME);
});

test("/api/inbox(GET): ctx 가 있으면 같은 순간의 /api/data · topics 판 읽기를 나눠 씀 — ctx 없으면(쓰기 길) 새로 읽음", async () => {
  const { inbox } = await import("./member-inbox.ts");
  const { D1, count } = d1();
  await loadRead(D1, ME, CTX); let n = count();
  await inbox(D1, ME, CTX); const withCtx = count() - n;   // 판은 앞 읽기를 나눠 씀 — 모아 보기 자기 batch 만
  loadForget(ME); await loadRead(D1, ME, CTX); n = count();
  await inbox(D1, ME); const noCtx = count() - n;
  assert.equal(noCtx - withCtx, 1, "ctx 없으면 판(load batch)을 한 번 더 읽음");
  loadForget(ME);
});

test("노드 글 하나(GET /api/chat/n:<노드>/<ts>, 「읽지 않음」이 글마다 부름): ctx 가 있으면 앞 판 읽기를 나눠 씀", async () => {
  const { D1, count } = d1(), none = async () => null, url = new URL("https://x.test/api/chat/n:영업 창/1793681208.264390");
  const call = (ctx: typeof CTX | null) => get(D1, ME, { name: "봇" }, url, none, undefined, null, ctx, async () => "~1");
  await loadRead(D1, ME, CTX); let n = count();
  assert.equal((await call(CTX))?.status, 200); const withCtx = count() - n;
  loadForget(ME); await loadRead(D1, ME, CTX); n = count();
  assert.equal((await call(null))?.status, 200); const noCtx = count() - n;
  assert.equal(noCtx - withCtx, 1, "ctx 없으면 판을 한 번 더 읽음");
  loadForget(ME);
});

test("loadRead: 나눠 받은 판이 상한(readOpts.wait) 안에 안 오면 이 요청에서 새로 읽음 — 만든 요청이 끊겨도 안 매달림", async () => {
  const { D1, count } = d1(), keep = readOpts.wait, who = "hang@example.com";
  try {
    readOpts.wait = 30;
    let release: (() => void) | null = null;
    const stuck = { ...D1, batch: (ss: any[]) => new Promise<any>(res => { release = () => res((D1 as any).batch(ss)); }) } as unknown as D1Database;
    const first = loadRead(stuck, who, CTX);   // 이 판은 안 끝남(끊긴 요청 흉내)
    const second = await loadRead(D1, who, CTX);   // 같은 사람 0.4초 안 — 나눠 받되 상한 뒤 새로 읽음
    assert.ok(second && (second as any).byId, "상한 뒤 제 요청에서 읽은 판");
    assert.equal(count(), 1, "새로 읽은 것은 한 번");
    release!(); await first;
  } finally { readOpts.wait = keep; loadForget(who); }
});

test("노드 목록: 질의 둘(아직 있음 · 2분 안 보관 · 앞단 이름 / 하루 안 보관 맡김)을 합치면 예전 OR 꼴과 같은 노드 · 60초 안 다음 load 는 하루 치 다시 안 읽음 · 살아난 노드는 새 줄이 이김", async () => {
  const { db, D1 } = d1(), real = Date.now, who = "arch@example.com";
  try {
    let t = real(); Date.now = () => t;
    const node = (id: string, name: string, arch: number | null, pinned = "", up = t) => db.prepare("INSERT INTO mnode(owner, id, name, pinned_name, state, why, counts, created_at, updated_at, archived_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(who, id, name, pinned, "working", "", "{}", t, up, arch);
    node("live", "살아 있음", null, "", t - 10); node("arch1h", "한 시간 전 보관", t - 3600_000, "", t - 20); node("old", "사흘 전 보관", t - 3 * 86_400_000, "", t - 30);
    node("front", "앞단 옛 노드", t - 5 * 86_400_000, "", t - 40); node("frontp", "다른 이름", t - 6 * 86_400_000, "앞단 고정", t - 50);
    db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(who, JSON.stringify({ front_door: { pairs: [{ name: "앞단 옛 노드" }, { name: "앞단 고정" }] } }), t);
    const was = (db.prepare(`SELECT id FROM mnode WHERE owner = ? AND (archived_at IS NULL OR archived_at > ? OR COALESCE(NULLIF(pinned_name, ''), name) IN (SELECT json_extract(p.value, '$.name') FROM node_setting s, json_each(json_extract(s.data, '$.front_door.pairs')) p WHERE s.owner = ?)) ORDER BY updated_at DESC`).all(who, t - 86_400_000, who) as { id: string }[]).map(r => r.id);
    let dayReads = 0; const sent: { sql: string; args: unknown[] }[] = [];   // 코드가 보낸 노드 질의(SQL · 값)를 그대로 붙잡아 돌려 봄
    const spy = { ...D1, prepare: (sql: string) => {
      if (/FROM mnode WHERE owner = \? AND archived_at > \?$/.test(sql)) dayReads++;
      const st = (D1 as any).prepare(sql);
      if (/^SELECT id, name, pinned_name, area, state, why, counts, updated_at, archived_at FROM mnode WHERE owner = \?/.test(sql)) return { ...st, bind: (...a: unknown[]) => { sent.push({ sql, args: a }); return st.bind(...a); } };
      return st; } } as unknown as D1Database;
    const merged = (L: any) => [...L.byId.keys()];
    const L1 = await load(spy, who);
    assert.equal(sent.length, 2, "노드 질의 둘(batch 안 · 하루 치 맡김)");
    const got = [...new Set(sent.flatMap(q => (db.prepare(q.sql).all(...(q.args as never[])) as { id: string }[]).map(r => r.id)))].sort();
    assert.deepEqual(got, [...was].sort(), "코드가 보낸 질의 둘의 합 = 예전 OR 꼴(앞단 이름 · 고정 이름 포함)");
    for (const q of sent) { const plan = (db.prepare("EXPLAIN QUERY PLAN " + q.sql).all(...(q.args as never[])) as { detail: string }[]).map(r => r.detail).join(" | "); assert.doesNotMatch(plan, /SCAN mnode(?! USING)/, "표 통째 훑기 없음: " + plan); }
    assert.ok(merged(L1).includes("live") && merged(L1).includes("arch1h") && !merged(L1).includes("old"));
    assert.equal(dayReads, 1);
    t += 10_000;
    db.prepare("UPDATE mnode SET archived_at = NULL, updated_at = ? WHERE owner = ? AND id = 'arch1h'").run(t, who);   // 다시 살아남
    node("back", "막 보관", t - 1000, "", t - 5);   // 맡긴 뒤 막 보관 — 2분 안이라 새 질의가 잡음
    const L2 = await load(spy, who) as any;
    assert.equal(dayReads, 1, "60초 안이면 하루 치는 맡긴 것");
    assert.equal(L2.byId.get("arch1h").archived_at, null, "살아난 노드는 새 줄(맡긴 보관 줄이 덮지 않음)");
    assert.ok(L2.byId.has("back"), "막 보관한 노드도 보임");
    t += 61_000; await load(spy, who); assert.equal(dayReads, 2, "60초 지나면 다시 읽음");
  } finally { Date.now = real; }
});

test("loadRead: 상한 뒤 같이 기다리던 요청들은 먼저 깨어난 요청의 새 판 하나를 같이 씀 — D1 느릴 때 1+N 읽기 막기(A27)", async () => {
  const { D1, count } = d1(), keep = readOpts.wait, who = "slow@example.com";
  try {
    readOpts.wait = 30;
    let release: (() => void) | null = null;
    const stuck = { ...D1, batch: (ss: any[]) => new Promise<any>(res => { release = () => res((D1 as any).batch(ss)); }) } as unknown as D1Database;
    const first = loadRead(stuck, who, CTX);   // 이 판은 안 끝남(D1 이 느림)
    const [b, c, d] = await Promise.all([loadRead(D1, who, CTX), loadRead(D1, who, CTX), loadRead(D1, who, CTX)]);
    assert.ok((b as any).byId && b === c && c === d, "셋이 같은 새 판");
    assert.equal(count(), 1, "상한 뒤 새로 읽은 것은 한 번(고치기 전엔 기다린 수만큼)");
    release!(); await first;
  } finally { readOpts.wait = keep; loadForget(who); }
});

test("loadRead: 상한 뒤 이어 받은 새 판도 안 오면 제 요청에서 읽음 — 매달리지 않음(A27)", async () => {
  const { D1, count } = d1(), keep = readOpts.wait, who = "slow2@example.com";
  try {
    readOpts.wait = 30;
    const rel: (() => void)[] = [];
    const stuck = { ...D1, batch: (ss: any[]) => new Promise<any>(res => { rel.push(() => res((D1 as any).batch(ss))); }) } as unknown as D1Database;
    const first = loadRead(stuck, who, CTX);
    const b = loadRead(stuck, who, CTX);   // 상한 뒤 새 판을 걸지만 그 판도 안 끝남
    const c = await loadRead(D1, who, CTX);   // 같이 기다리다 b 의 새 판을 이어 받고, 그것도 상한 뒤 제 요청에서
    assert.ok((c as any).byId, "끝내 제 판을 받음");
    assert.equal(count(), 1);
    for (const r of rel) r(); await Promise.all([first, b]);
  } finally { readOpts.wait = keep; loadForget(who); }
});
