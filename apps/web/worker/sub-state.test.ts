import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { subMissing, loginSysLine, LOGIN_SYS_SQL } from "./sub-state.ts";

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, bind: (...a: unknown[]) => stmt(sql, a), first: async () => db.prepare(sql).get(...(args as never[])) ?? null });
  return { db, D1: { prepare: (sql: string) => stmt(sql) } as unknown as D1Database };
}
const ME = "member@example.test", T = Date.now(), NOTE = "이 기기의 Claude 계정이 아직 로그인되지 않았어요 — 설정 › 기기 › 엔진에서 「로그인」을 눌러 주세요";
const win = (db: DatabaseSync, id: string, state: string, at: number, note: string | null = null) => db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, ME, "dev1", "main", "사무장", state, at, note, at);

test("엔진 기기 붙음 + 마지막 메인 봇이 로그인 안 됨 실패 → 미연결 · 쓸 구독 표시", async () => {
  const { db, D1 } = d1();
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("dev1", ME, "pc", "", "h", T, T, "full", T);
  assert.deepEqual(await subMissing(D1, ME), { missing: false, provider: null }, "메인 봇 시도 전엔 아님");
  win(db, "ew_a", "failed", T - 5000, NOTE);
  assert.deepEqual(await subMissing(D1, ME), { missing: true, provider: null });
  db.prepare("INSERT INTO engine_owner(owner, rules, updated_at) VALUES (?,?,?)").run(ME, JSON.stringify({ provider: "codex" }), T);
  assert.equal((await subMissing(D1, ME)).provider, "codex");
  win(db, "ew_b", "failed", T - 1000, "다른 오류");
  assert.equal((await subMissing(D1, ME)).missing, false, "마지막 실패가 다른 이유면 아님");
  win(db, "ew_c", "failed", T, NOTE);
  assert.equal((await subMissing(D1, ME)).missing, true);
  win(db, "ew_d", "idle", T + 1, null);
  assert.equal((await subMissing(D1, ME)).missing, false, "산 메인 봇이 있으면 아님");
});

test("엔진 기기가 2분 넘게 안 붙었으면 미연결로 안 봄(꺼진 기기는 다른 안내)", async () => {
  const { db, D1 } = d1();
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run("dev1", ME, "pc", "", "h", T, T, "full", T - 10 * 60_000);
  win(db, "ew_a", "failed", T, NOTE);
  assert.equal((await subMissing(D1, ME)).missing, false);
});

test("메인 스레드에서 숨길 줄: 구독 미연결로 생긴 「보더」 오류 줄만", () => {
  assert.ok(loginSysLine({ win: "보더", kind: "sys", text: "메인 봇을 못 열었어요 — " + NOTE }));
  assert.ok(loginSysLine({ win: "보더", kind: "sys", text: "아직 구독 계정이 연동되지 않았어요 — 설정 …" }));
  assert.ok(!loginSysLine({ win: "보더", kind: "sys", text: "메인 봇이 이 기기에서 시작했어요" }));
  assert.ok(!loginSysLine({ win: "나", kind: "chat", text: NOTE }), "사람 글은 안 숨김");
});

const dev = (db: DatabaseSync, id = "dev1", revoked: number | null = null) => db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at, revoked_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, ME, "pc", "", "h-" + id, T, T, "full", T, revoked);

test("글이 메인 봇 말고 다른 창으로 가는 회원은 막지 않음: 기본 창 · 고른 들여온 창 · 자동인데 들여온 창 있음", async () => {
  const a = d1(); dev(a.db); win(a.db, "ew_a", "failed", T, NOTE);
  assert.equal((await subMissing(a.D1, ME)).missing, true, "그대로면 미연결");
  a.db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(ME, "primary_win", "window:x", T);
  assert.equal((await subMissing(a.D1, ME)).missing, false, "기본 창(팀장 창)을 정함");
  const b = d1(); dev(b.db); win(b.db, "ew_a", "failed", T, NOTE);
  b.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(ME, JSON.stringify({ primary_item: "window:abc" }), T);
  assert.equal((await subMissing(b.D1, ME)).missing, false, "메인 봇으로 들여온 창을 고름");
  const c = d1(); dev(c.db); win(c.db, "ew_a", "failed", T, NOTE);
  c.db.prepare("INSERT INTO imp_item(owner, key, kind, title, device_id, seen_at) VALUES (?,?,?,?,?,?)").run(ME, "window:w1", "window", "w1", "dev1", T);
  assert.equal((await subMissing(c.D1, ME)).missing, false, "자동 + 들여온 창(그 창이 메인 봇이 될 수 있음)");
  c.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(ME, JSON.stringify({ primary_item: "none" }), T);
  assert.equal((await subMissing(c.D1, ME)).missing, true, "「보더 메인 봇」을 고르면 들여온 창이 있어도 미연결");
});

test("폐기한 기기의 안 닫힌 메인 봇 창은 산 창으로 안 셈", async () => {
  const { db, D1 } = d1(); dev(db); dev(db, "old1", T - 1000);
  db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, state_at, created_at) VALUES (?,?,?,?,?,?,?,?)").run("ew_old", ME, "old1", "main", "사무장", "idle", T - 9000, T - 9000);
  win(db, "ew_a", "failed", T, NOTE);
  assert.equal((await subMissing(D1, ME)).missing, true);
});

test("옛 「보더」 로그인 줄 거르기는 SQL 안에서(LIMIT 앞) — 쪽 나누기 「더 있음」이 안 깨짐", () => {
  const { db } = d1();
  const ins = db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)");
  for (let i = 0; i < 5; i++) ins.run(ME, "보더", "sys", "메인 봇을 못 열었어요 — " + NOTE, "primary", T + i);
  ins.run(ME, "보더", "sys", "메인 봇이 이 기기에서 시작했어요", "primary", T + 10);
  for (let i = 0; i < 101; i++) ins.run(ME, "나", "chat", "글 " + i, "primary", T - 1000 - i);
  const rs = db.prepare(`SELECT id, win, kind, text FROM board_log WHERE owner = ? AND (thread = 'primary')${LOGIN_SYS_SQL} ORDER BY at DESC, id DESC LIMIT 101`).all(ME) as { text: string }[];
  assert.equal(rs.length, 101, "거른 뒤에도 한 쪽을 꽉 채움 → 「더 있음」");
  assert.ok(!rs.some(r => /로그인되지 않았어요/.test(r.text)), "로그인 오류 줄은 빠짐");
  assert.ok(rs.some(r => r.text === "메인 봇이 이 기기에서 시작했어요"), "다른 「보더」 줄은 그대로");
});

test("채널 응답에 sub 가 와도 입력칸을 두는 부분 갱신으로 빠지지 않음(첫 진입에 안내가 안 뜨던 것)", () => {
  const html = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
  assert.match(html, /\(el\.dataset\.sig === sig \|\| thSwap\) && !subOff\(CS\.at\) && \(el\.querySelector\("#cnew"\)/);
});
