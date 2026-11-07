import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  if (s === "better-auth" || s === "better-auth/plugins") return { url: "data:text/javascript,export const betterAuth = () => ({}); export const emailOTP = () => ({});", shortCircuit: true };
  if (s === "better-auth/crypto") return { url: "data:text/javascript,export const symmetricEncrypt = async () => ''; export const symmetricDecrypt = async () => '';", shortCircuit: true };
  if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]s$/.test(s)) return n(s + ".ts", c);
  return n(s, c);
}`));
(globalThis as any).WebSocketRequestResponsePair ??= class { constructor(..._a: unknown[]) {} };
const { Engine, chatToMain, importedPrimary, ownerCfg } = await import("./engine.ts");

const MIG = new URL("../migrations/", import.meta.url);
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { const out = []; for (const s of ss) out.push(await s.run()); return out; } } as unknown as D1Database };
}

const { DEFAULT_ROLES } = await import("./engine.ts");
const MEMBER = "member@example.test", OWNER = "owner@example.test", DEV = "devMember01", T = Date.now();
function setup(o: { on?: boolean; who?: string; harness?: boolean; online?: boolean; bot?: boolean; failOpen?: boolean; failMsg?: string } = {}) {
  const { db, D1 } = d1(), who = o.who || MEMBER;
  db.prepare("INSERT INTO invite(email, by_email, at) VALUES (?,?,?)").run(MEMBER, OWNER, T);
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope, engine_at) VALUES (?,?,?,?,?,?,?,?,?)").run(DEV, who, "pc", "", "h1", T, T, o.harness ? "harness" : "full", T);
  if (o.bot !== false) db.prepare("INSERT INTO member_bot(owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(who, "s", 10, "봇", "", "i", "f", T);
  if (o.on !== false) db.prepare("INSERT INTO engine_owner(owner, rules, updated_at) VALUES (?,?,?)").run(who, JSON.stringify({ default_roles: true }), T);   // 묶음 플래그: 켠 회원만
  const store = new Map<string, unknown>(); const sent: any[] = [];
  let eng: any;
  const ws = { readyState: 1, deserializeAttachment: () => ({ at: T }), send: (t: string) => { const m = JSON.parse(t); sent.push(m); const w = eng.wait.get(m.id); clearTimeout(w.timer); eng.wait.delete(m.id); o.failOpen ? w.reject(new Error(o.failMsg || "Authorization: Bearer sk-test-1234 로그인 필요")) : w.resolve({}); } };
  const ctx = { setWebSocketAutoResponse() {}, getWebSockets: () => (o.online === false ? [] : [ws]), waitUntil() {}, storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v); }, delete: async (k: string) => store.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} } };
  store.set("who", { device: DEV, owner: who, harness: !!o.harness });
  const env = { DB: D1, PUBLIC_URL: "https://example.test", ALLOW_EMAILS: OWNER, ENGINE: { idFromName: (n: string) => n, get: () => ({}) } };
  eng = new (Engine as any)(ctx, env);
  const roles = (who_ = who) => db.prepare("SELECT id, name, source FROM role WHERE owner = ? ORDER BY id").all(who_) as { id: string; name: string; source: string }[];
  const wins = (who_ = who) => db.prepare("SELECT kind, role_id, state FROM engine_window WHERE owner = ? AND kind = 'role'").all(who_) as { kind: string; role_id: string; state: string }[];
  const sys = (who_ = who) => (db.prepare("SELECT text FROM board_log WHERE owner = ? AND kind = 'sys' ORDER BY at, rowid").all(who_) as { text: string }[]).map(r => r.text);
  return { db, eng, roles, wins, sys, sent };
}

test("온보딩을 마친 새 회원: 기본 역할 셋(쉬운 한국어 이름)이 role 줄 + 창으로 생김", async () => {
  const s = setup();
  const r = await s.eng.seedRoles(MEMBER);
  assert.equal(r.seeded, 3);
  assert.deepEqual(s.roles().map(x => x.name).sort(), ["글쓰기", "일 정리", "조사"].sort());
  assert.ok(s.roles().every(x => x.source === "default"));
  assert.equal(s.wins().length, 3); assert.equal(s.sent.filter(m => m.verb === "open").length, 3);
  assert.ok(!DEFAULT_ROLES.some(x => /퍼스널|가게|싱크|캔버스/.test(x.name + x.brief + x.instructions)), "주인 전용 역할 없음");
  assert.match(s.sys().join("\n"), /기본 역할 3개/);
});

test("멱등: 두 번째 hello 에는 안 심음 · 사람이 지운 뒤에도 다시 안 심음", async () => {
  const s = setup();
  await s.eng.seedRoles(MEMBER); const r2 = await s.eng.seedRoles(MEMBER);
  assert.equal(r2.seeded, 0); assert.equal(s.roles().length, 3); assert.equal(s.wins().length, 3);
  s.db.prepare("DELETE FROM role WHERE owner = ?").run(MEMBER); s.db.prepare("DELETE FROM engine_window WHERE owner = ?").run(MEMBER);
  assert.equal((await s.eng.seedRoles(MEMBER)).seeded, 0); assert.equal(s.roles().length, 0);
});

test("이미 역할이 있는 회원은 그대로(불변) — 표시만 남겨 나중에도 안 심음", async () => {
  const s = setup();
  s.db.prepare("INSERT INTO role(owner, id, name, source, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(MEMBER, "mine", "내 역할", "bot", T, T);
  assert.equal((await s.eng.seedRoles(MEMBER)).seeded, 0);
  assert.deepEqual(s.roles().map(x => x.id), ["mine"]); assert.equal(s.wins().length, 0);
  s.db.prepare("DELETE FROM role WHERE owner = ?").run(MEMBER);
  assert.equal((await s.eng.seedRoles(MEMBER)).seeded, 0);
});

test("주인(Owner) 기기 · 하네스 기기 · 온보딩 전 · 기기 소켓 없음 · 스위치 끔: 아무것도 안 만들고 표시도 안 남김(소켓 없음 · 온보딩 전은 다음에 다시)", async () => {
  const o = setup({ who: OWNER }); assert.equal((await o.eng.seedRoles(OWNER)).seeded, 0); assert.equal(o.roles(OWNER).length, 0);
  const h = setup({ harness: true }); assert.equal((await h.eng.seedRoles(MEMBER)).seeded, 0); assert.equal(h.roles().length, 0);
  const nb = setup({ bot: false }); assert.equal((await nb.eng.seedRoles(MEMBER)).seeded, 0);
  const off = setup({ online: false }); assert.equal((await off.eng.seedRoles(MEMBER)).seeded, 0);
  assert.equal(off.db.prepare("SELECT count(*) n FROM user_pref WHERE k = 'default_roles_seeded'").get()!.n, 0, "소켓 없을 땐 표시 안 함 → 붙으면 심음");
  const sw = setup({ on: false });
  assert.equal((await sw.eng.seedRoles(MEMBER)).seeded, 0); assert.equal(sw.roles().length, 0);
  nb.db.prepare("INSERT INTO member_bot(owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(MEMBER, "s", 1, "봇", "", "i", "f", T);
  assert.equal((await nb.eng.seedRoles(MEMBER)).seeded, 3, "온보딩을 마치면 심김");
});

test("창을 못 열어도 역할 줄은 남고, 이유(비밀값 없이 짧게)가 시스템 줄에 남음", async () => {
  const s = setup({ failOpen: true });
  assert.equal((await s.eng.seedRoles(MEMBER)).seeded, 3);
  assert.equal(s.roles().length, 3);
  const line = s.sys().find(t => /못 열었어요/.test(t))!; assert.ok(line);
});

test("쓸 구독이 codex 인 회원: 창 열기 명령에 provider codex · Claude 모델 이름 없음 / 기본 회원은 그대로 Claude 모델(ChatGPT 구독만 있는 회원)", async () => {
  const s = setup();
  s.db.prepare("UPDATE engine_owner SET rules = ? WHERE owner = ?").run(JSON.stringify({ default_roles: true, provider: "codex" }), MEMBER);
  assert.ok(await s.eng.ensureMain(MEMBER, DEV));
  const spec = s.sent.find(m => m.verb === "open" || m.args?.spec)?.args?.spec ?? s.sent[0]?.spec ?? s.sent[0]?.args?.spec;
  assert.equal(spec.provider, "codex"); assert.equal(spec.model, undefined); assert.equal(spec.session_id, undefined, "Codex 에 가짜 대화 id 를 안 보냄 — 첫 턴이 새 대화를 엶");
  const t = setup();
  assert.ok(await t.eng.ensureMain(MEMBER, DEV));
  const spec2 = t.sent.find(m => m.verb === "open" || m.args?.spec)?.args?.spec ?? t.sent[0]?.spec ?? t.sent[0]?.args?.spec;
  assert.equal(spec2.provider, undefined); assert.match(spec2.model, /^claude-/);
});

test("로그인 전 첫 hello 에 못 연 역할은 「엔진이 쓸 수 있게 되면 열기」로 미뤄지고, 실패 창은 닫힘", async () => {
  const s = setup({ failOpen: true });
  await s.eng.seedRoles(MEMBER);
  const p = s.db.prepare("SELECT json_extract(engine, '$.pending') p FROM role WHERE owner = ?").all(MEMBER) as { p: number }[];
  assert.deepEqual(p.map(x => x.p), [1, 1, 1], "셋 다 미룸");
  assert.ok(s.wins().every(w => w.state === "closed"), "실패 창은 닫힘 — 역할 칸에 「멈춤」으로 안 남음");
});

test("새 메인 창이 열리면(로그인 뒤 첫 글) 미룬 역할 창도 hello 를 안 기다리고 엶", async () => {
  const s = setup();
  let jobs: Promise<unknown>[] = []; s.eng.ctx.waitUntil = (p: Promise<unknown>) => { jobs.push(p); };
  for (const r of DEFAULT_ROLES) s.db.prepare("INSERT INTO role(owner, id, name, instructions, intake, engine, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(MEMBER, r.id, r.name, r.instructions, r.brief, JSON.stringify({ device: DEV, engine: "tmux", cwd: `~/boarder/${r.id}`, pending: 1 }), "default", T, T);
  const id = await s.eng.ensureMain(MEMBER, DEV);
  assert.ok(id, "메인 창 열림");
  await Promise.all(jobs);
  const open = s.db.prepare("SELECT role_id FROM engine_window WHERE owner = ? AND kind = 'role' AND state NOT IN ('closed','failed')").all(MEMBER) as { role_id: string }[];
  assert.equal(open.length, DEFAULT_ROLES.length, "미룬 역할 창이 다 열림");
});

test("구독 로그인 없음: 메인 스레드에 줄 없음 · 그동안 온 글은 맡아 뒀다 로그인 뒤 열린 메인 봇에게 넣음", async () => {
  const o = { failOpen: true, failMsg: "이 기기의 Claude 계정이 아직 로그인되지 않았어요 — 설정 › 기기 › 엔진에서 「로그인」을 눌러 주세요" };
  const s = setup(o);
  s.eng.ctx.waitUntil = () => {};
  assert.equal(await s.eng.ensureMain(MEMBER, DEV), null);
  await s.eng.seedRoles(MEMBER);
  assert.equal(await s.eng.ensureMain(MEMBER, DEV), null, "두 번째도 실패");
  assert.ok(await s.eng.holdForMain("[보드 · Primary] [Boarder chat] 안녕"), "글을 맡아 둠");
  const lines = s.sys();
  assert.equal(lines.filter(t => /아직 구독 계정이 연동되지 않았어요/.test(t)).length, 0, "「보더」 안내 줄도 안 씀 — 화면이 채팅 칸에 안내(sub-state.ts)");
  assert.ok(!lines.some(t => /메인 봇을 못 열었어요|창은 못 열었어요/.test(t)), "오류 줄은 안 쌓임");
  o.failOpen = false; s.sent.length = 0;
  const id = await s.eng.ensureMain(MEMBER, DEV);
  assert.ok(id, "로그인 뒤 메인 봇 열림");
  const pend = await s.eng.q("pending") as { id: string; text: string }[];   // 새 창은 「시작 중」이라 첫 인사 턴 뒤에 넣게 줄 섬(deliver 가 쉬면 넣음)
  assert.ok(s.sent.some(m => JSON.stringify(m).includes("[Boarder chat] 안녕") && m.verb !== "open") || pend.some(p => p.id === id && p.text.includes("[Boarder chat] 안녕")), "맡아 둔 글이 새 메인 봇에게 감(바로 또는 그 창 줄)");
  assert.equal(await s.eng.holdForMain("x"), false, "로그인된 뒤엔 맡지 않음(예전 길)");
  await s.eng.ctx.storage.put("main_login_missing", Date.now() - 5 * 60_000);
  assert.equal(await s.eng.holdForMain("y"), false, "오래된 표시(1분 넘음)로는 맡지 않음 — 다른 실패의 글을 묻지 않게");
});

test("메인 봇 열기 실패는 삼키지 않고 그 회원 시스템 줄에 이유를 남김", async () => {
  const s = setup({ failOpen: true });
  const id = await s.eng.ensureMain(MEMBER, DEV);
  assert.equal(id, null);
  const line = s.sys().find(t => /메인 봇을 못 열었어요/.test(t));
  assert.ok(line, "시스템 줄이 있음"); assert.ok(!/sk-test/.test(line!), "토큰 꼴은 가림"); assert.ok(line!.length < 120);
});

test("스위치 안 켠 회원(기본)은 hello 가 돌아도 불변 · 명시 false 도 불변 · 켠 회원만 심김", async () => {
  const s = setup({ on: false });
  assert.equal((await s.eng.seedRoles(MEMBER)).seeded, 0); assert.equal(s.roles().length, 0); assert.equal(s.wins().length, 0);
  s.db.prepare("INSERT INTO engine_owner(owner, rules, updated_at) VALUES (?,?,?)").run(MEMBER, JSON.stringify({ default_roles: false }), T);
  assert.equal((await s.eng.seedRoles(MEMBER)).seeded, 0);
  s.db.prepare("UPDATE engine_owner SET rules = ? WHERE owner = ?").run(JSON.stringify({ default_roles: true }), MEMBER);
  assert.equal((await s.eng.seedRoles(MEMBER)).seeded, 3);
});
