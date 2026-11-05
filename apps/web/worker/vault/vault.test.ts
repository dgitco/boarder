// node --test --no-warnings --experimental-transform-types apps/web/worker/vault/vault.test.ts (Node 22.18+ · node:sqlite)
// 사람별 봉투 암호화(worker/vault): 가짜 D1 = 메모리 SQLite + migrations 전부(0035 dek 포함). 키 · 글은 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("../test-hooks.mjs", import.meta.url);
const V = await import("./index.ts");
const { seal: legacySeal } = await import("../connectors/seal.ts");

const MIG = new URL("../../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const q = { n: 0 };   // D1 에 간 문장 수 — 붙듦 길 확인
  const run1 = (sql: string, args: unknown[]) => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => { q.n++; return { success: true, results: db.prepare(sql).all(...(args as never[])), meta: {} }; },
    first: async (col?: string) => { q.n++; const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    run: async () => { q.n++; return run1(sql, args); },
  });
  const D1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: any[]) => { q.n++; db.exec("BEGIN"); try { const o = ss.map(s => run1(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { db.exec("ROLLBACK"); throw e; } },
  } as unknown as D1Database;
  return { db, D1, q };
}
const k32 = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const K1 = k32(), K2 = k32(), CK = k32();
function setup(on = true) {
  V._resetVaultCache();
  const t = d1();
  if (on) t.db.prepare("UPDATE f7_flag SET on_at = ? WHERE name = 'envelope'").run(Date.now());
  const env: any = { DB: t.D1, DATA_KEK_CUR: "1", DATA_KEK_1: K1, DATA_KEK_2: K2, CONNECTOR_KEY: CK };
  return { ...t, env };
}
const REF = { tbl: "wl_talk_msg", pk: "m_1", col: "text" };

test("왕복 · 첫 쓰기에 DEK 생김 · 덤프엔 암호문만", async () => {
  const { env, db } = setup();
  const s = await V.sealField(env, "", REF, "비밀 회의록 — 3분기 숫자");
  assert.match(s as string, /^v2\.1\./);
  assert.ok(!(s as string).includes("비밀"));
  assert.equal(await V.openField(env, "", REF, s), "비밀 회의록 — 3분기 숫자");
  const rows = db.prepare("SELECT owner, ver, kek, mode, wrapped FROM dek").all() as any[];
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], wrapped: undefined }, { owner: "", ver: 1, kek: 1, mode: "server", wrapped: undefined });
  assert.match(rows[0].wrapped, /^k1\./);
  // 사람마다 다른 DEK — 남의 키로는 안 열림
  const b = await V.sealField(env, "bob@x.co", REF, "밥 글");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dek").get()!.n, 2);
  await assert.rejects(V.openField(env, "", REF, b), V.VaultError);
  // 빈 글 · null 도
  assert.equal(await V.openField(env, "", REF, await V.sealField(env, "", REF, "")), "");
  assert.equal(await V.sealField(env, "", REF, null), null);
});

test("다른 줄 · 다른 칸 · 다른 표로 옮긴 값은 거절", async () => {
  const { env } = setup();
  const s = await V.sealField(env, "", REF, "옮기면 안 됨");
  await assert.rejects(V.openField(env, "", { ...REF, pk: "m_2" }, s), V.VaultError);
  await assert.rejects(V.openField(env, "", { ...REF, col: "raw" }, s), V.VaultError);
  await assert.rejects(V.openField(env, "", { ...REF, tbl: "nope_tbl" }, s), V.VaultError);
  await assert.rejects(V.openField(env, "", REF, (s as string).replace(/^v2\.1\./, "v2.2.")), V.VaultError);
  // 한 글자 바꿈
  const t = (s as string).slice(0, -2) + ((s as string).at(-2) === "A" ? "B" : "A") + (s as string).at(-1);
  await assert.rejects(V.openField(env, "", REF, t), V.VaultError);
  await assert.rejects(V.openField(env, "", REF, "v2.1." + "A".repeat(41)), V.VaultError);   // base64 길이가 깨진 꼴도 VaultError 로
});

test("평문은 그대로(늦은 옮기기) · 스위치 꺼지면 봉하지 않음 · DB 안 봄", async () => {
  const { env } = setup();
  for (const p of ["그냥 글", "v2.0 나왔어요", "v2.1.short", "v1.abc", "{\"a\":1}"]) assert.equal(await V.openField(env, "", REF, p), p);
  const off = setup(false);
  const before = off.q.n;
  assert.equal(await V.sealField(off.env, "", REF, "평문 그대로"), "평문 그대로");
  assert.equal(await V.sealField(off.env, "", REF, "또"), "또");
  assert.equal(off.q.n - before, 2, "스위치 읽기 두 번(모두 envelope + 그 사람 envelope:owner, 1분 붙듦) 뒤로는 DB 안 감");
  assert.equal(off.db.prepare("SELECT COUNT(*) AS n FROM dek").get()!.n, 0);
  // KEK 비밀이 없으면 스위치가 켜져 있어도 꺼진 것
  // KEK 비밀이 없는데 스위치가 켜져 있으면 닫힌 채 실패(평문으로 조용히 쓰지 않음) · 스위치도 꺼져 있으면 지금처럼 평문
  const nokek = setup();
  delete nokek.env.DATA_KEK_CUR;
  await assert.rejects(V.sealField(nokek.env, "", REF, "x"), (e: any) => e instanceof V.VaultError && e.code === "no_kek");
  const nokekOff = setup(false);
  delete nokekOff.env.DATA_KEK_CUR;
  assert.equal(await V.sealField(nokekOff.env, "", REF, "x"), "x");
  assert.equal(nokekOff.db.prepare("SELECT COUNT(*) AS n FROM dek").get()!.n, 0);
});

test("옛 v1(CONNECTOR_KEY) 값도 엶 — 안의 JSON 글월 그대로", async () => {
  const { env } = setup();
  const old = await legacySeal(CK, { access_token: "tok_abc", refresh_token: "r_1" });
  assert.match(old, /^v1\./);
  const pt = await V.openField(env, "", { tbl: "connection", pk: "c_1", col: "auth" }, old);
  assert.deepEqual(JSON.parse(pt as string), { access_token: "tok_abc", refresh_token: "r_1" });
  // 다시 쓰면 v2 로(사람별 DEK)
  const re = await V.sealField(env, "", { tbl: "connection", pk: "c_1", col: "auth" }, pt);
  assert.match(re as string, /^v2\./);
  await assert.rejects(V.openField({ ...env, CONNECTOR_KEY: k32() }, "", REF, old), V.VaultError);
  V._resetVaultCache();   // 차가운 isolate · CONNECTOR_KEY 없음 → TypeError 가 아니라 VaultError(no_kek)
  await assert.rejects(V.openField({ ...env, CONNECTOR_KEY: undefined }, "", REF, old), (e: any) => e instanceof V.VaultError && e.code === "no_kek");
});

test("KEK 돌려 바꾸기: dek 줄만 다시 감싸고 칸은 그대로 열림", async () => {
  const { env, db } = setup();
  const owners = ["", "a@x.co", "b@x.co"], sealed: string[] = [];
  for (const o of owners) sealed.push((await V.sealField(env, o, REF, `글 ${o}`)) as string);
  const before = db.prepare("SELECT wrapped FROM dek ORDER BY owner").all().map((r: any) => r.wrapped);
  const r = await V.rewrapAll(env, 1, 2, 2);   // 쪽 크기 2 → 쪽 넘김도 확인
  assert.deepEqual(r, { done: 3, failed: [] });
  const after = db.prepare("SELECT wrapped, kek FROM dek ORDER BY owner").all() as any[];
  assert.ok(after.every((x, i) => x.kek === 2 && x.wrapped !== before[i]));
  // 옛 KEK 를 지우고 판을 바꾼 새 isolate 에서
  V._resetVaultCache();
  const env2 = { ...env, DATA_KEK_CUR: "2", DATA_KEK_1: undefined };
  for (let i = 0; i < owners.length; i++) assert.equal(await V.openField(env2, owners[i], REF, sealed[i]), `글 ${owners[i]}`);
  // 두 번 돌려도 아무 일 없음 · 새 사람은 새 KEK 로
  assert.deepEqual(await V.rewrapAll(env2 as any, 1, 2), { done: 0, failed: [] });
  await V.sealField(env2, "c@x.co", REF, "새 사람");
  assert.equal(db.prepare("SELECT kek FROM dek WHERE owner = 'c@x.co'").get()!.kek, 2);
});

test("e2e 모드 줄: 서버 열기 · 봉하기 모두 VaultE2eError, 옛 서버 판은 열림", async () => {
  const { env, db } = setup();
  const old = await V.sealField(env, "e@x.co", REF, "넘기기 전 글");
  const v = await V.adoptE2e(env, "e@x.co", "client-wrapped-blob");
  assert.equal(v, 2);
  assert.equal(db.prepare("SELECT mode FROM dek WHERE owner = 'e@x.co' AND ver = 2").get()!.mode, "e2e");
  await assert.rejects(V.sealField(env, "e@x.co", REF, "새 글"), V.VaultE2eError);
  // 화면이 e2e 판으로 봉한 값(꼴만 흉내) — 서버는 풀려 들지도 않음
  const fake = "v2.2." + "A".repeat(40);
  await assert.rejects(V.openField(env, "e@x.co", REF, fake), (e: any) => e instanceof V.VaultE2eError && e.code === "e2e");
  // 붙든 길에서도 같은 거절
  await assert.rejects(V.openField(env, "e@x.co", REF, fake), V.VaultE2eError);
  assert.equal(await V.openField(env, "e@x.co", REF, old), "넘기기 전 글");
  // e2e 줄은 KEK 돌림에서 건너뜀
  const r = await V.rewrapAll(env, 1, 2);
  assert.equal(r.done, 1);
  assert.equal(db.prepare("SELECT kek FROM dek WHERE owner = 'e@x.co' AND ver = 2").get()!.kek, 0);
});

test("붙듦: 따뜻하면 DB 안 감", async () => {
  const { env, q } = setup();
  await V.sealField(env, "", REF, "데움");
  const n0 = q.n, h0 = V.stats.hit;
  for (let i = 0; i < 50; i++) {
    const r = { ...REF, pk: `m_${i}` };
    assert.equal(await V.openField(env, "", r, await V.sealField(env, "", r, `글 ${i}`)), `글 ${i}`);
  }
  assert.equal(q.n, n0, "따뜻한 길은 D1 0번");
  assert.equal(V.stats.hit - h0, 100);
  // 차가운 isolate 는 한 번 읽고 다시 붙듦
  V._resetVaultCache();
  const s = await V.sealField(env, "", REF, "식음");
  assert.equal(q.n - n0, 2, "스위치 1 + dek 1");
  assert.equal(await V.openField(env, "", REF, s), "식음");
  assert.equal(q.n - n0, 2);
});

test("몸통: 조각 왕복 · 다른 key · 잘라냄 · 조각 바꿔 끼움 거절 · 평문 그대로", async () => {
  const { env } = setup();
  const key = "blobs/own/abc.bin", C = 1024;
  for (const len of [0, 1, C - 1, C, C + 1, 3 * C + 7]) {
    const pt = crypto.getRandomValues(new Uint8Array(len));
    const s = (await V.sealBlob(env, "", key, pt, C)) as Uint8Array;
    assert.equal(s.length, V.sealedSize(len, C));
    assert.deepEqual(await V.openBlob(env, "", key, s), pt);
  }
  const pt = crypto.getRandomValues(new Uint8Array(3 * C));
  const s = (await V.sealBlob(env, "", key, pt, C)) as Uint8Array;
  await assert.rejects(V.openBlob(env, "", "blobs/own/other.bin", s), V.VaultError);
  await assert.rejects(V.openBlob(env, "", key, s.subarray(0, s.length - (C + 28))), V.VaultError);   // 마지막 조각 잘라냄
  const sw = s.slice(); sw.set(s.subarray(16 + (C + 28), 16 + 2 * (C + 28)), 16); sw.set(s.subarray(16, 16 + C + 28), 16 + (C + 28));
  await assert.rejects(V.openBlob(env, "", key, sw), V.VaultError);
  const plain = new TextEncoder().encode("옛 평문 첨부");
  assert.deepEqual(await V.openBlob(env, "", key, plain), plain);
  // 기본 64 KiB · 글월 입력
  const big = "가".repeat(100_000);
  assert.equal(new TextDecoder().decode(await V.openBlob(env, "", key, (await V.sealBlob(env, "", key, big)) as Uint8Array)), big);
  // 스위치 꺼짐 → 그대로
  const off = setup(false);
  assert.equal(await V.sealBlob(off.env, "", key, pt), pt);
});

test("잼: sealField / openField 한 번 걸리는 때(따뜻한 붙듦)", async t => {
  const { env } = setup();
  const msg = "회의 정리: ".padEnd(300, "가나다라 ");
  await V.openField(env, "", REF, await V.sealField(env, "", REF, msg));
  const N = 5000, sealed: string[] = new Array(N);
  let t0 = performance.now();
  for (let i = 0; i < N; i++) sealed[i] = (await V.sealField(env, "", { ...REF, pk: `m_${i}` }, msg)) as string;
  const ts = (performance.now() - t0) / N * 1000;
  t0 = performance.now();
  for (let i = 0; i < N; i++) await V.openField(env, "", { ...REF, pk: `m_${i}` }, sealed[i]);
  const to = (performance.now() - t0) / N * 1000;
  t0 = performance.now();
  for (let i = 0; i < N; i++) await V.openField(env, "", REF, msg);
  const tp = (performance.now() - t0) / N * 1000;
  t.diagnostic(`글 ${new TextEncoder().encode(msg).length}B · N=${N}: sealField ${ts.toFixed(1)}µs · openField ${to.toFixed(1)}µs · 평문 지나감 ${tp.toFixed(2)}µs (한 번)`);
  console.log(`[vault bench] sealField ${ts.toFixed(1)}µs/call · openField ${to.toFixed(1)}µs/call · plaintext passthrough ${tp.toFixed(2)}µs/call`);
  assert.ok(ts < 2000 && to < 2000, "한 번에 2ms 안(아주 느슨 — 숫자는 위 로그)");
});

test("감싸기: 봉한 꼴 평문만 p0. 로 · 읽으면 뗌 · 보통 p0. 글은 안 건드림 · 하나로 정해짐", async () => {
  const { env } = setup(false);
  for (const v of ["v2.1." + "A".repeat(40), "v1." + "B".repeat(40), "p0.v2.1." + "A".repeat(40), "p0.p0.v1." + "C".repeat(40)]) {
    const s = await V.sealField(env, "", REF, v);
    assert.equal(s, "p0." + v);
    assert.ok(!V.isSealed(s)); assert.ok(V.isEscaped(s));
    assert.equal(await V.openField(env, "", REF, s), v);
  }
  for (const v of ["p0.안녕", "p0.", "p0.v2.short", "평문"]) { assert.equal(await V.sealField(env, "", REF, v), v); assert.equal(await V.openField(env, "", REF, v), v); }
});

test("e2e 지킬 것: adoptE2e 가 그 사람 envelope:<owner> 를 같은 batch 에서 켬 — 모두 스위치가 꺼져도 VaultE2eError", async () => {
  const { env, db } = setup(false);
  assert.equal(await V.envelopeOn(env, "e@x.co"), false);
  await V.adoptE2e(env, "e@x.co", "client-wrapped");
  assert.ok(db.prepare("SELECT 1 FROM f7_flag WHERE name = 'envelope:e@x.co' AND on_at IS NOT NULL").get());
  assert.equal(await V.envelopeOn(env, "e@x.co"), true);
  await assert.rejects(V.sealField(env, "e@x.co", REF, "글"), V.VaultE2eError);
  assert.equal(await V.sealField(env, "other@x.co", REF, "글"), "글", "다른 사람은 그대로");
});



test("범위 vault: 허용한 열쇠 · 채널 왕복, 사람 · 다른 열쇠는 평문/null/몸통도 거절", async () => {
  const { env } = setup(), owner = "o:grp_a", owners = [owner, "x:chan"], vault = V.scopedVault(env, owners);
  owners.push("o:Other");
  for (const who of [owner, "x:chan"]) {
    const s = await vault.sealField(who, REF, "범위 글");
    assert.equal(await vault.openField(who, REF, s), "범위 글");
    const b = await vault.sealBlob(who, "f", "범위 파일") as Uint8Array;
    assert.equal(new TextDecoder().decode(await vault.openBlob(who, "f", b)), "범위 파일");
  }
  for (const who of ["", "person@example.com", "o:Other", "x:other"]) {
    const scope = (e: any) => e instanceof V.VaultError && e.code === "scope";
    await assert.rejects(vault.sealField(who, REF, null), scope);
    await assert.rejects(vault.openField(who, REF, "평문"), scope);
    await assert.rejects(vault.sealBlob(who, "f", "파일"), scope);
    await assert.rejects(vault.openBlob(who, "f", new Uint8Array()), scope);
  }
});
