// node --test --no-warnings --experimental-transform-types apps/web/worker/role-edit.test.ts
// 역할 수정: 메모리 SQLite + 실제 Engine. 외부 서비스나 실제 창에는 연결하지 않음.
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
const { Engine, rolePrompt } = await import("./engine.ts");

const MIG = new URL("../migrations/", import.meta.url);
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
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { const out = []; for (const s of ss) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); return out; } } as unknown as D1Database };
}


const { localTools } = await import("./local.ts");
const A = "member@example.test", B = "other@example.test", DEV = "devMember01", T = Date.now();
function setup() {
  const { db, D1 } = d1(), store = new Map<string, any>(), sent: any[] = [];
  db.prepare("INSERT INTO device(id, owner, name, tools, token_hash, created_at, last_at, scope) VALUES (?,?,?,?,?,?,?,?)").run(DEV, A, "pc", "", "made-up", T, T, "full");
  for (const owner of [A, B]) db.prepare("INSERT INTO role(owner, id, name, instructions, intake, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(owner, "r_shared", owner === A ? "원래 이름" : "남의 이름", "old instructions", "old brief", T, T);
  for (const state of ["idle", "background", "busy", "parked", "closed", "failed"]) db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, handle, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("ew_" + state, A, DEV, "role", "r_shared", "원래 이름", state, JSON.stringify({ session_id: "made-up", name: "원래 이름", cwd: "~/boarder/r_shared" }), T);
  let eng: any;
  const ws = { readyState: 1, deserializeAttachment: () => ({ at: T }), send: (raw: string) => { const m = JSON.parse(raw); sent.push(m); const w = eng.wait.get(m.id); clearTimeout(w.timer); eng.wait.delete(m.id); w.resolve({}); } };
  const ctx = { setWebSocketAutoResponse() {}, getWebSockets: () => [ws], waitUntil() {}, storage: { get: async (k: string) => structuredClone(store.get(k)), put: async (k: string, v: any) => { store.set(k, structuredClone(v)); }, delete: async (k: string) => store.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} } };
  store.set("who", { device: DEV, owner: A });
  const env: any = { DB: D1, PUBLIC_URL: "https://example.test", ENGINE: { idFromName: (n: string) => n, get: () => eng } };
  eng = new (Engine as any)(ctx, env);
  return { db, D1, env, eng, sent, store };
}

const grant = (s: ReturnType<typeof setup>, dev = DEV) => s.db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").run(A, "cli_settings:" + dev, String(T), T);

test("role_edit: 내 역할만 수정하고 살아 있는 창 셋에 새 지시를 한 통씩", async () => {
  const s = setup(); grant(s);
  const local = localTools(s.D1, A, "Primary", "https://example.test", "", undefined, undefined, undefined, s.env, DEV);
  await local("role_edit", { role_id: "r_shared", name: "새 이름", brief: "새 담당", instructions: "new instructions\nreport to lead" });
  const mine: any = s.db.prepare("SELECT * FROM role WHERE owner = ?").get(A);
  assert.equal(mine.name, "새 이름"); assert.equal(mine.intake, "새 담당"); assert.equal(mine.instructions, "new instructions\nreport to lead");
  assert.equal(s.db.prepare("SELECT name FROM role WHERE owner = ?").get(B)!.name, "남의 이름");
  assert.deepEqual(s.sent.map(m => [m.verb, m.args.id]).sort(), [["send", "ew_background"], ["send", "ew_busy"], ["send", "ew_idle"]]);
  for (const m of s.sent) { assert.match(m.args.text, /^\[Boarder\] 이 역할의 지시가 바뀌었어요:/); assert.ok(m.args.text.includes(mine.instructions)); }
});

test("주차 창은 고칠 때 깨우지 않고, 다음 reopen 에 role 표의 최신 지시와 원래 글을 함께 넣음", async () => {
  const s = setup();
  s.db.prepare("UPDATE role SET name = ?, instructions = ?, updated_at = ? WHERE owner = ?").run("새 이름", "latest role instructions", T + 1, A);
  await s.eng.reopen("ew_parked", "사람이 보낸 글");
  assert.equal(s.sent.length, 1); assert.equal(s.sent[0].verb, "reopen");
  assert.ok(s.sent[0].args.text.includes(rolePrompt("새 이름", "latest role instructions")));
  assert.ok(s.sent[0].args.text.endsWith("사람이 보낸 글"));
  assert.equal(s.sent[0].args.handle.name, "새 이름");
});

const { mountRoleEdit, editRole } = await import("./role-edit.ts");
const { Hono } = await import("hono");
function route(s: ReturnType<typeof setup>, member: string | null = A) {
  const app = new Hono<any>();
  // index.ts 의 memberOnly 와 같은 인증 · same-site 결과를 주입. 회원 세션 자체는 기존 시험 담당.
  mountRoleEdit(app, async c => c.req.header("x-hb") === "1" && c.req.header("sec-fetch-site") === "same-origin" ? member : null);
  return async (id: string, body: unknown, headers = { "x-hb": "1", "sec-fetch-site": "same-origin" }) => {
    const r = await app.fetch(new Request("https://example.test/api/me/roles/" + id, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), s.env);
    return { status: r.status, json: await r.json() as any };
  };
}

test("회원 POST: 남의 역할 · 없는 역할 404, 내 것만 수정; 세션 없음 · cross-site 403", async () => {
  const s = setup(), call = route(s);
  s.db.prepare("INSERT INTO role(owner, id, name, instructions, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(B, "r_other", "남의 역할", "keep", T, T);
  const before = s.db.prepare("SELECT * FROM role ORDER BY owner, id").all();
  assert.equal((await call("r_other", { instructions: "hijack" })).status, 404);
  assert.equal((await call("r_missing", { name: "없음" })).status, 404);
  assert.equal((await route(s, null)("r_shared", { name: "금지" })).status, 403);
  assert.equal((await call("r_shared", { name: "금지" }, { "x-hb": "1", "sec-fetch-site": "cross-site" })).status, 403);
  assert.deepEqual(s.db.prepare("SELECT * FROM role ORDER BY owner, id").all(), before); assert.equal(s.sent.length, 0);
  const r = await call("r_shared", { brief: "" });
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  const row = s.db.prepare("SELECT * FROM role WHERE owner = ? AND id = ?").get(A, "r_shared")!;
  assert.equal(row.name, "원래 이름"); assert.equal(row.intake, ""); assert.equal(row.instructions, "old instructions");
});

test("입력 길이 · 제어 문자 · 빈 수정 검사; 저장과 창 메시지의 비밀 꼴은 보드 글과 같이 가림", async () => {
  const s = setup(), call = route(s);
  for (const body of [{}, null, [], { name: "a".repeat(41) }, { brief: "a".repeat(201) }, { instructions: "a".repeat(3001) }, { instructions: "" }, { name: "a\u001b" }, { instructions: "a\tbad" }, { name: "bad\nname" }, { owner: B, name: "금지" }]) {
    assert.equal((await call("r_shared", body)).status, 400, JSON.stringify(body));
  }
  assert.equal(s.sent.length, 0);
  const fake = "sk-proj-" + "a".repeat(30);
  assert.equal((await call("r_shared", { name: "새 이름", brief: fake, instructions: "new\n" + fake })).status, 200);
  const row: any = s.db.prepare("SELECT * FROM role WHERE owner = ?").get(A);
  assert.equal(row.intake, "[secret]"); assert.equal(row.instructions, "new\n[secret]");
  assert.ok(s.sent.every(m => !m.args.text.includes(fake)));
});

test("바쁨 · 오프라인은 기존 전달 줄 한 통; 한 창 오류가 다른 창 전달을 막지 않음", async () => {
  const s = setup(), real = s.eng.cmd.bind(s.eng);
  s.eng.cmd = (verb: string, a: any) => verb === "send" && a.id === "ew_busy" ? Promise.reject(Object.assign(new Error("busy"), { code: 2 })) : real(verb, a);
  const r = await editRole(s.env, A, { role_id: "r_shared", instructions: "queue this" });
  assert.ok("delivery" in r); assert.equal(r.delivery!.find(d => d.window === "ew_busy")!.state, "queued");
  assert.equal(s.store.get("pending").filter((p: any) => p.id === "ew_busy").length, 1);
  s.eng.cmd = (verb: string, a: any) => verb === "send" && a.id === "ew_background" ? Promise.reject(new Error("no answer")) : real(verb, a);
  const r2 = await editRole(s.env, A, { role_id: "r_shared", brief: "still save" });
  assert.equal(r2.delivery!.find(d => d.window === "ew_background")!.state, "failed");
  assert.equal(r2.delivery!.find(d => d.window === "ew_idle")!.state, "sent");
});

test("reopen 은 같은 role id 의 다른 회원 지시를 읽지 않음; one_goal 꺼짐도 유지", async () => {
  const s = setup();
  s.db.prepare("UPDATE role SET instructions = ? WHERE owner = ?").run("foreign private", B);
  s.db.prepare("UPDATE role SET updated_at = ? WHERE owner = ?").run(T + 1, A);   // 지시는 바뀐 역할만 다시 넣음
  s.db.prepare("INSERT INTO engine_owner(owner, rules, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ one_goal: false }), T);
  await s.eng.reopen("ew_parked");
  const text = s.sent[0].args.text;
  assert.ok(text.includes("old instructions")); assert.ok(!text.includes("foreign private")); assert.ok(!text.includes("This window is one goal"));
});

const { SCHEMAS, maskWrites, MEMBER_ONLY, onlyReads, TOOLS, run: runTool } = await import("./mcp/tools.ts");
test("MCP role_edit 은 쓰기 도구로 등록되고 검사 · 가림 뒤 같은 local 길을 실행", async () => {
  const s = setup();
  assert.ok(MEMBER_ONLY.has("role_edit")); assert.equal(onlyReads("role_edit"), false);
  assert.ok(TOOLS.some(t => t.name === "role_edit"));
  assert.equal(SCHEMAS.role_edit.safeParse({ role_id: "r_shared" }).success, false);
  const fake = "sk-proj-" + "b".repeat(30);
  assert.equal(maskWrites("role_edit", { role_id: "r_shared", instructions: fake }).instructions, "[secret]");
  grant(s); const local = localTools(s.D1, A, "Primary", "https://example.test", "", undefined, undefined, undefined, s.env, DEV);
  const r: any = await runTool({ agent: "test", publicUrl: "https://example.test", op: async () => { throw new Error("relay 금지"); }, get: async () => ({}), local,
    view: { why: () => null, visible: () => true, desc: () => "", mask: () => false } as any }, "role_edit", { role_id: "r_shared", instructions: "MCP updated" });
  assert.equal(r.ok, true); assert.equal(r.delivery.length, 3);
  assert.equal(s.db.prepare("SELECT instructions FROM role WHERE owner = ?").get(A)!.instructions, "MCP updated");
});

const prompts = (t: string) => t.split('You are the "').length - 1;
const park = (s: ReturnType<typeof setup>, id: string) => s.db.prepare("UPDATE engine_window SET state = 'parked' WHERE id = ?").run(id);

test("창 · 기기 토큰 role_edit: 보드 허락 없으면 403 not_allowed(저장 · 전달 없음), 허락 뒤 200 + 보드 기록 전 → 후 한 줄(비밀 가림)", async () => {
  const s = setup();
  const win = (dev: string | null) => localTools(s.D1, A, "작업 창", "https://example.test", "device:x:ew_idle", undefined, undefined, undefined, s.env, dev);
  const before = s.db.prepare("SELECT * FROM role ORDER BY owner").all();
  const denied = (e: any) => e.status === 403 && /not_allowed/.test(e.message) && /boarder settings allow/.test(e.message);
  await assert.rejects(win(DEV)("role_edit", { role_id: "r_shared", instructions: "hijack" }), denied);
  await assert.rejects(win(null)("role_edit", { role_id: "r_shared", instructions: "hijack" }), denied);
  grant(s, "devOther01");   // 다른 기기 허락은 안 번짐
  await assert.rejects(win(DEV)("role_edit", { role_id: "r_shared", instructions: "hijack" }), denied);
  assert.deepEqual(s.db.prepare("SELECT * FROM role ORDER BY owner").all(), before); assert.equal(s.sent.length, 0);
  assert.equal(s.db.prepare("SELECT count(*) n FROM board_log").get()!.n, 0);
  grant(s);
  const fake = "sk-proj-" + "c".repeat(30);
  const r: any = await win(DEV)("role_edit", { role_id: "r_shared", name: "새 이름", instructions: "new work " + fake });
  assert.equal(r.ok, true); assert.equal(r.delivery.length, 3);
  const logs: any[] = s.db.prepare("SELECT * FROM board_log WHERE owner = ?").all(A);
  assert.equal(logs.length, 1); assert.equal(logs[0].kind, "sys"); assert.equal(logs[0].thread, "primary");
  assert.match(logs[0].text, /^기기 「pc」 이 CLI 로 역할 「원래 이름」 을 바꿨어요 — 전: .*원래 이름.*old instructions.* → 후: .*새 이름.*new work \[secret\]/);
  assert.ok(!logs[0].text.includes(fake));
  s.db.prepare("UPDATE device SET revoked_at = ? WHERE id = ?").run(T, DEV);   // 끊긴 기기는 허락이 있어도 못 씀
  await assert.rejects(win(DEV)("role_edit", { role_id: "r_shared", name: "또" }), denied);
  const { toolError } = await import("./role-edit.ts");
  const [body, status] = toolError(await win(DEV)("role_edit", { role_id: "r_shared", name: "또" }).catch(e => e));
  assert.equal(status, 403); assert.equal((body as any).error, "not_allowed"); assert.match((body as any).hint, /boarder settings allow/);
  assert.deepEqual(toolError(new Error("없는 역할이에요")), [{ error: "없는 역할이에요" }, 400]);
});

test("창이 기기에서 사라져(4 · 5) 다시 열며 넣어도 · 줄 선 글이 주차 창을 다시 열어도 지시는 한 글에 한 번", async () => {
  for (const code of [4, 5]) {
    const s = setup(), real = s.eng.cmd.bind(s.eng);
    s.eng.cmd = (verb: string, a: any) => verb === "send" && a.id === "ew_idle" ? Promise.reject(Object.assign(new Error("gone"), { code })) : real(verb, a);
    await editRole(s.env, A, { role_id: "r_shared", instructions: "fresh instructions" });
    const re = s.sent.filter(m => m.verb === "reopen" && m.args.id === "ew_idle");
    assert.equal(re.length, 1, `code ${code}`); assert.equal(prompts(re[0].args.text), 1, `code ${code}`);
    assert.match(re[0].args.text, /^\[Boarder\] 이 역할의 지시가 바뀌었어요/);
  }
  const s = setup(), real = s.eng.cmd.bind(s.eng);
  s.eng.cmd = (verb: string, a: any) => verb === "send" && a.id === "ew_busy" ? Promise.reject(Object.assign(new Error("busy"), { code: 2 })) : real(verb, a);
  await editRole(s.env, A, { role_id: "r_shared", instructions: "queued instructions" });
  s.eng.cmd = real; park(s, "ew_busy");
  await s.eng.flush();
  const re = s.sent.filter(m => m.verb === "reopen" && m.args.id === "ew_busy");
  assert.equal(re.length, 1); assert.equal(prompts(re[0].args.text), 1);
});

test("역할이 안 바뀐 주차 창은 다시 열 때 지시를 다시 안 넣음 — 바뀐 뒤 처음 한 번만, 받은 창은 안 넣음", async () => {
  const s = setup();
  await s.eng.reopen("ew_parked", "사람 글 1");
  assert.equal(s.sent.at(-1).args.text, "사람 글 1");
  park(s, "ew_parked"); await s.eng.reopen("ew_parked");
  assert.equal(prompts(s.sent.at(-1).args.text), 0); assert.ok(!s.sent.at(-1).args.text.includes("boarder log start"));
  await editRole(s.env, A, { role_id: "r_shared", instructions: "changed while parked" });
  park(s, "ew_parked"); await s.eng.reopen("ew_parked", "사람 글 2");
  const t = s.sent.at(-1).args.text;
  assert.equal(prompts(t), 1); assert.ok(t.includes("changed while parked")); assert.ok(t.endsWith("사람 글 2"));
  assert.ok(!("role_at" in s.sent.at(-1).args.handle));   // 받은 시각은 서버 몫 — 기기 손잡이로 안 보냄
  park(s, "ew_parked"); await s.eng.reopen("ew_parked", "사람 글 3");
  assert.equal(s.sent.at(-1).args.text, "사람 글 3");
  park(s, "ew_idle"); await s.eng.reopen("ew_idle", "산 창이던 것");   // 고칠 때 이미 받은 창
  assert.equal(s.sent.at(-1).args.text, "산 창이던 것");
  s.eng.cmd = async (verb: string, a: any) => { if (verb === "park") return { handle: { session_id: "made-up-2", role_at: 1 } }; throw new Error(verb + " " + a.id); };
  s.db.prepare("UPDATE engine_window SET state = 'idle' WHERE id = 'ew_idle'").run();
  await s.eng.park("ew_idle");   // 기기 손잡이의 옛 값이 받은 시각을 덮지 않음
  assert.ok(JSON.parse((s.db.prepare("SELECT handle FROM engine_window WHERE id = 'ew_idle'").get() as any).handle).role_at > T);
});

test("대화 대기(waiting) 창도 보내기 대상 — 입력칸에 바로 안 넣고 줄로", async () => {
  const s = setup();
  s.db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, handle, dialog, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("ew_waiting", A, DEV, "role", "r_shared", "원래 이름", "waiting", JSON.stringify({ session_id: "made-up" }), "permission", T);
  const r: any = await editRole(s.env, A, { role_id: "r_shared", instructions: "wait for it" });
  assert.equal(r.delivery.find((d: any) => d.window === "ew_waiting")?.state, "queued");
  assert.ok(!s.sent.some(m => m.args.id === "ew_waiting"));
  assert.equal(s.store.get("pending").filter((p: any) => p.id === "ew_waiting").length, 1);
});

// 설정 › 노드 「역할」 칸이 읽는 목록(GET /api/me/roles)
function list(s: ReturnType<typeof setup>, member: string | null = A) {
  const app = new Hono<any>();
  mountRoleEdit(app, async c => c.req.header("x-hb") === "1" && c.req.header("sec-fetch-site") === "same-origin" ? member : null);
  return async (headers: Record<string, string> = { "x-hb": "1", "sec-fetch-site": "same-origin" }) => {
    const r = await app.fetch(new Request("https://example.test/api/me/roles", { headers }), s.env);
    return { status: r.status, json: await r.json() as any };
  };
}

test("회원 GET 역할 목록: 내 역할만 · 꼴(brief = intake) · 붙은 창은 닫힘 · 사라짐 빼고", async () => {
  const s = setup();
  s.db.prepare("INSERT INTO role(owner, id, name, instructions, intake, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(B, "r_other", "남의 역할", "secret plan", "남의 설명", "bot", T, T + 5);
  s.db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, created_at) VALUES (?,?,?,?,?,?,?,?)").run("ew_b", B, "devB", "role", "r_shared", "남의 창", "idle", T);
  s.db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, role_id, name, state, created_at) VALUES (?,?,?,?,?,?,?,?)").run("ew_gone", A, DEV, "role", "r_shared", "원래 이름", "gone", T);
  const r = await list(s)();
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  assert.equal(r.json.roles.length, 1);
  const [x] = r.json.roles;
  assert.deepEqual(Object.keys(x).sort(), ["brief", "id", "instructions", "name", "source", "updated_at", "windows"]);
  assert.equal(x.id, "r_shared"); assert.equal(x.name, "원래 이름"); assert.equal(x.brief, "old brief"); assert.equal(x.instructions, "old instructions");
  assert.deepEqual(x.windows.map((w: any) => w.state).sort(), ["background", "busy", "failed", "idle", "parked"]);
  assert.deepEqual(Object.keys(x.windows[0]).sort(), ["id", "name", "state"]);
  assert.ok(!JSON.stringify(r.json).includes("남의") && !JSON.stringify(r.json).includes("secret plan"));
});

test("회원 GET: 주인 · 세션 없음 403, cross-site 403; 역할 없으면 빈 목록; 최근 고친 50개", async () => {
  const s = setup();
  assert.equal((await list(s, null)()).status, 403);
  assert.equal((await list(s)({ "x-hb": "1", "sec-fetch-site": "cross-site" })).status, 403);
  assert.deepEqual((await list(s, "nobody@example.test")()).json, { ok: true, roles: [] });
  for (let i = 0; i < 55; i++) s.db.prepare("INSERT INTO role(owner, id, name, created_at, updated_at) VALUES (?,?,?,?,?)").run(A, `r_${String(i).padStart(2, "0")}`, `역할 ${i}`, T, T + 100 + i);
  const r = await list(s)();
  assert.equal(r.json.roles.length, 50);
  assert.equal(r.json.roles[0].id, "r_54"); assert.ok(!r.json.roles.some((x: any) => x.id === "r_shared"));
});
