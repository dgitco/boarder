import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { register } from "node:module";

register("./test-hooks.mjs", import.meta.url);
const { Pusher } = await import("./push-do.ts");
const { uaKind, maskErr } = await import("./push.ts");

function fakeDO() {
  const s = new DatabaseSync(":memory:");
  const sql = { exec: (q: string, ...b: unknown[]) => { const st = s.prepare(q);
    if (/^\s*select/i.test(q)) { const rows = st.all(...(b as never[])); return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }; }
    const r = st.run(...(b as never[])); return { toArray: () => [], one: () => undefined, rowsWritten: Number(r.changes) }; } };
  const pu = new (Pusher as any)({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {} } }, { DB: {} });
  return { pu, kv: () => s.prepare("SELECT k FROM kv").all().map((r: any) => r.k) };
}
const A = "a@example.com";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

test("실패 기록: 단계 · 가린 오류 · 권한 · 기기 · 브라우저만, 최근 것부터 · 성공 사건(열기 등)은 안 나옴", async () => {
  const { pu } = fakeDO();
  await pu.mAck(A, { tag: "fail", step: "subscribe", err: "AbortError: Registration failed - push service error", perm: "granted", sa: false, ua: MAC_CHROME });
  await pu.mAck(A, { tag: "card:1", url: "./?open=card:1", found: true });
  await pu.mAck(A, { tag: "fail", step: "server", err: "Error: server 403 at https://fcm.googleapis.com/fcm/send/abcDEF0123456789abcDEF0123456789", perm: "granted", sa: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1" });
  const f = await pu.mFails(A);
  assert.equal(f.length, 2);
  assert.deepEqual(Object.keys(f[0]).sort(), ["at", "browser", "device", "err", "perm", "standalone", "step"]);
  assert.deepEqual([f[0].step, f[0].device, f[0].browser, f[0].standalone], ["server", "iPhone", "Safari", true]);
  assert.equal(f[0].err, "Error: server 403 at <주소>");
  assert.deepEqual([f[1].step, f[1].device, f[1].browser, f[1].err], ["subscribe", "Mac", "Chrome 계열", "AbortError: Registration failed - push service error"]);
  assert.ok(!JSON.stringify(f).includes("Mozilla"), "UA 원문 안 나감");
});

test("남의 메일 · 아직 안 켠 칸: 빈 답이고 칸을 묶지 않음", async () => {
  const d = fakeDO();
  assert.deepEqual(await d.pu.mFails(A), []);
  assert.deepEqual(d.kv(), [], "읽기만으로 member 를 적지 않음");
  await d.pu.mAck(A, { tag: "fail", step: "prep", err: "x", ua: MAC_CHROME });
  assert.deepEqual(await d.pu.mFails("b@example.com"), []);
});

test("가림 · 종류", () => {
  assert.equal(maskErr("key BPx9aZ_0123456789abcdefABCDEF= bad"), "key <…> bad");
  assert.deepEqual(uaKind("Mozilla/5.0 (Windows NT 10.0) Chrome/141 Safari/537.36 Edg/141"), { device: "Windows", browser: "Edge" });
});

test("페이지 알림: 구독 없이도 모음 · 처음(after 없음)은 번호만 · after 뒤 것만 · 같은 사건 한 번 · 남의 칸 403", async () => {
  const { pu } = fakeDO();
  const first = await pu.mPage(A, null);
  assert.deepEqual(first[1], { seq: 0, items: [] });
  await pu.mNotify(A, { id: "1793170372.000001", question: "결제 장애" }, "card:1793170372.000001");
  await pu.mNotify(A, { id: "1793170372.000001", question: "결제 장애" }, "card:1793170372.000001");
  await pu.mNotify(A, { id: "1793170372.000002", question: "보안 사고" }, "card:1793170372.000002");
  assert.deepEqual((await pu.mPage(A, null))[1], { seq: 2, items: [] }, "처음 부름은 지난 것을 안 띄움");
  const r = (await pu.mPage(A, 0))[1];
  assert.deepEqual(r.items.map((m: any) => [m.title, m.body, m.tag]), [["내 차례", "결제 장애", "card:1793170372.000001"], ["내 차례", "보안 사고", "card:1793170372.000002"]]);
  assert.deepEqual((await pu.mPage(A, 2))[1].items, []);
  assert.equal((await pu.mPage("b@example.com", 0))[0], 403);
});

test("주인 페이지 알림: 켜진 틱이 고른 급함 글이 모이고 after 뒤 것만 · 꺼진 틱(본 것만)은 안 모임", async () => {
  const { DatabaseSync: DB } = await import("node:sqlite");
  const d1 = new DB(":memory:");
  d1.exec("CREATE TABLE wl_cards(ts TEXT, area TEXT, kind TEXT, title TEXT, label TEXT, shape TEXT, state TEXT, replaced_by TEXT, dup_of TEXT, ref TEXT, posted_at REAL); CREATE TABLE wl_talk_msg(id TEXT, chan TEXT, thread TEXT, text TEXT, at REAL, who TEXT, deleted_at REAL); CREATE TABLE wl_change(seq INTEGER); CREATE TABLE f7_flag(name TEXT, on_at INTEGER)");
  const st = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => st(sql, a), first: async () => d1.prepare(sql).get(...(args as never[])) ?? null, all: async () => ({ results: d1.prepare(sql).all(...(args as never[])) }) });
  const D1 = { prepare: (q: string) => st(q), batch: async (ss: any[]) => ss.map(x => ({ results: d1.prepare(x.sql).all(...(x.args as never[])) })) };
  const s = new DatabaseSync(":memory:");
  const sql = { exec: (q: string, ...b: unknown[]) => { const p = s.prepare(q); if (/^\s*select/i.test(q)) { const rows = p.all(...(b as never[])); return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }; } const r = p.run(...(b as never[])); return { toArray: () => [], one: () => undefined, rowsWritten: Number(r.changes) }; } };
  const pu = new (Pusher as any)({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {} } }, { DB: D1 });
  const now = Date.now() / 1000, urg = (id: string, text: string, at: number) => d1.prepare("INSERT INTO wl_talk_msg VALUES (?,?,?,?,?,?,NULL)").run(id, "dgit", null, ":rotating_light: *급함* " + text, at, "agent");   // 급함 열쇠 = 채널:시각 — 글마다 다른 시각
  await pu.tickNow();   // 첫 틱 = 있는 것을 본 것으로
  urg("1793170372.000001", "꺼진 때 글", now - 5); d1.prepare("INSERT INTO wl_change VALUES (1)").run();
  await (pu as any).tick(now + 1); await (pu as any).tick(now + 30);
  assert.deepEqual((await pu.page(0))[1].items, [], "write_push 꺼짐(본 것만) — 모으지 않음");
  d1.prepare("INSERT INTO f7_flag VALUES ('write_push', 1)").run();
  urg("1793170372.000002", "서버 응답 없음", now - 3); d1.prepare("INSERT INTO wl_change VALUES (2)").run();
  await (pu as any).tick(now + 1); await (pu as any).tick(now + 30);
  const r = (await pu.page(0))[1];
  assert.deepEqual(r.items.map((m: any) => [m.title, m.body]), [["급함 · DGit", "서버 응답 없음"]]);
  assert.deepEqual((await pu.page(r.seq))[1].items, []);
  assert.deepEqual((await pu.page(null))[1].items, [], "처음 부름은 번호만");
});
