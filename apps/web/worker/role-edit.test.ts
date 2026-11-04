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
  assert.deepEqual(Object.keys(x).sort(), ["brief", "id", "instructions", "name", "pending", "perms", "source", "supervise", "updated_at", "windows"]);
  assert.equal(x.perms, ""); assert.equal(x.supervise, ""); assert.equal(x.pending, false);
  assert.equal(x.id, "r_shared"); assert.equal(x.name, "원래 이름"); assert.equal(x.brief, "old brief"); assert.equal(x.instructions, "old instructions");
  assert.deepEqual(x.windows.map((w: any) => w.state).sort(), ["background", "busy", "failed", "idle", "parked"]);
  assert.deepEqual(Object.keys(x.windows[0]).sort(), ["id", "last", "name", "state", "watch"]);
  assert.equal(x.windows[0].last, null); assert.equal(x.windows[0].watch, "");
  assert.ok(!JSON.stringify(r.json).includes("남의") && !JSON.stringify(r.json).includes("secret plan"));
});

test("회원 GET: 주인 · 세션 없음 403, cross-site 403; 역할 없으면 빈 목록; 최근 고친 50개", async () => {
  const s = setup();
  assert.equal((await list(s, null)()).status, 403);
  assert.equal((await list(s)({ "x-hb": "1", "sec-fetch-site": "cross-site" })).status, 403);
  assert.deepEqual((await list(s, "nobody@example.test")()).json, { ok: true, roles: [], engine: false });
  for (let i = 0; i < 55; i++) s.db.prepare("INSERT INTO role(owner, id, name, created_at, updated_at) VALUES (?,?,?,?,?)").run(A, `r_${String(i).padStart(2, "0")}`, `역할 ${i}`, T, T + 100 + i);
  const r = await list(s)();
  assert.equal(r.json.roles.length, 50);
  assert.equal(r.json.roles[0].id, "r_54"); assert.ok(!r.json.roles.some((x: any) => x.id === "r_shared"));
});

// ── 역할 칸 넓히기(회원 요청: 목표 · 권한 · 보고 라인 · 지금 하는 일 · 화면에서 새 역할)
const { approveDraft, permsText, OPEN_PER_HOUR } = await import("./engine.ts");
const { createRole, listRoles, usesEngine, roleEditSchema, roleCreateSchema } = await import("./role-edit.ts");
const OLD_PROMPT = "[Boarder] You are the \"기술장\" agent. Your job: PR 은 리뷰 뒤 머지\n둘째 줄\nThis window is one goal. Take related and follow-up requests for that goal here — do not ask for a new window for them. Work through them one at a time; when there is enough to split, split inside this window (subagents, or helper panes for separate front-end and back-end work that does not touch the same files). Ask for a new role only when the work is a different goal.\nReport on the person's Boarder board as you work: run `boarder log start \"<one line>\"` now, `boarder log progress \"<where things stand>\"` at each big step, `boarder ask \"<question>\" --choice \"<A>\" --choice \"<B>\"` only for decisions they must make, `boarder log blocked \"<why, who can unblock>\"` when stuck, and `boarder log done \"<result>\"` when finished. Write board lines in the person's language. Start now.";
const OLD_PROMPT_NO_GOAL = "[Boarder] You are the \"기술장\" agent. Your job: PR 은 리뷰 뒤 머지\n둘째 줄\nReport on the person's Boarder board as you work: run `boarder log start \"<one line>\"` now, `boarder log progress \"<where things stand>\"` at each big step, `boarder ask \"<question>\" --choice \"<A>\" --choice \"<B>\"` only for decisions they must make, `boarder log blocked \"<why, who can unblock>\"` when stuck, and `boarder log done \"<result>\"` when finished. Write board lines in the person's language. Start now.";

test("rolePrompt: 권한 · 보고 라인이 비면 예전 글과 글자 하나까지 같음, 있으면 Report 앞에 한 줄씩", () => {
  const I = "PR 은 리뷰 뒤 머지\n둘째 줄";
  for (const more of [undefined, {}, { perms: "", supervise: "" }, { perms: "  ", supervise: "\n" }, { perms: null, supervise: null }, { perms: "[]" }]) {
    assert.equal(rolePrompt("기술장", I, true, more as any), OLD_PROMPT, JSON.stringify(more));
    assert.equal(rolePrompt("기술장", I, false, more as any), OLD_PROMPT_NO_GOAL, JSON.stringify(more));
  }
  const t = rolePrompt("기술장", I, true, { perms: "Read, Grep\n배포 금지", supervise: "기술 리드에게 보고" });
  assert.ok(t.startsWith(OLD_PROMPT.split("\nReport on")[0] + "\nPermissions (tools, connectors, what you must not do): Read, Grep\n배포 금지\nReporting line"));
  assert.ok(t.endsWith("\nReport on" + OLD_PROMPT.split("\nReport on")[1]));
  assert.ok(rolePrompt("a", "b", true, { supervise: "x" }).includes("Reporting line (who you report to, who reviews your work, when to bring things to the person): x\nReport on"));
  assert.ok(!rolePrompt("a", "b", true, { supervise: "x" }).includes("Permissions"));
});

test("permsText: 들여오기 도구 목록 꼴(JSON 배열 · 객체 · YAML 흐름 · 도구 이름 쉼표)은 사람이 읽을 글로, 그 밖은 그대로", () => {
  assert.equal(permsText('["Read","Grep","Bash(git:*)"]'), "쓸 수 있는 도구: Read, Grep, Bash(git:*)");
  assert.equal(permsText("[Read, Grep, 'Glob']"), "쓸 수 있는 도구: Read, Grep, Glob");
  assert.equal(permsText("Read, Grep, Glob, mcp__github__*"), "쓸 수 있는 도구: Read, Grep, Glob, mcp__github__*");
  assert.equal(permsText('{"allow":["Read","Edit"],"deny":"배포"}'), "allow: Read, Edit\ndeny: 배포");
  assert.equal(permsText("Read"), "Read");   // 한 낱말은 사람이 쓴 글일 수 있어 그대로
  assert.equal(permsText("읽기만, 배포 금지"), "읽기만, 배포 금지");
  assert.equal(permsText("[깨진 json"), "[깨진 json");
  assert.equal(permsText(""), ""); assert.equal(permsText(null), ""); assert.equal(permsText("[]"), "");
  for (const raw of ['["Read","Grep"]', "Read, Grep", '{"allow":["Read"]}']) assert.ok(roleEditSchema.safeParse({ role_id: "r", perms: permsText(raw) }).success, raw);   // 화면이 보여 준 글 그대로 저장해도 통과
});

test("권한 · 보고 라인 고치기: 1000자 · 제어 문자 · 비밀 가림은 지시와 같게, 비우기 됨, 안 고친 칸은 저장 값 그대로, 창 메시지에 들어감", async () => {
  const s = setup(), call = route(s);
  for (const body of [{ perms: "a".repeat(1001) }, { supervise: "a".repeat(1001) }, { perms: "a\tb" }, { supervise: "a\u001bb" }, { perms: 3 }, { name: "-x" }, { brief: "-x" }, { instructions: "-x" }]) assert.equal((await call("r_shared", body)).status, 400, JSON.stringify(body));
  assert.equal(s.sent.length, 0);
  // 권한 · 보고 라인은 목록 꼴(「- 」 시작)을 받음 — 이름 · 목표 · 지시는 예전처럼 거절(위)
  assert.equal((await call("r_shared", { perms: "- 읽기만\n- 배포 금지", supervise: "- 기술 리드에게 보고" })).status, 200);
  assert.deepEqual({ ...s.db.prepare("SELECT perms, supervise FROM role WHERE owner = ? AND id = ?").get(A, "r_shared") as any }, { perms: "- 읽기만\n- 배포 금지", supervise: "- 기술 리드에게 보고" });
  assert.ok(s.sent.every(m => m.args.text.includes("Permissions (tools, connectors, what you must not do): - 읽기만\n- 배포 금지")));
  assert.equal((await make(s)({ ...NEW, name: "목록 꼴", perms: "- 읽기만", supervise: "- 리드" })).status, 200);
  s.sent.length = 0;
  s.db.prepare("UPDATE role SET perms = ? WHERE owner = ? AND id = ?").run('["Read","Grep"]', A, "r_shared");   // 들여온 꼴
  const fake = "sk-proj-" + "d".repeat(30);
  assert.equal((await call("r_shared", { supervise: "기술 리드에게 보고\n머지 전 리뷰 " + fake })).status, 200);
  let row: any = s.db.prepare("SELECT perms, supervise FROM role WHERE owner = ? AND id = ?").get(A, "r_shared");
  assert.equal(row.perms, '["Read","Grep"]'); assert.equal(row.supervise, "기술 리드에게 보고\n머지 전 리뷰 [secret]");
  for (const m of s.sent) { assert.ok(m.args.text.includes("Permissions (tools, connectors, what you must not do): 쓸 수 있는 도구: Read, Grep")); assert.ok(m.args.text.includes("Reporting line") && !m.args.text.includes(fake)); }
  assert.equal((await call("r_shared", { perms: "a".repeat(1000), supervise: "" })).status, 200);
  row = s.db.prepare("SELECT perms, supervise FROM role WHERE owner = ? AND id = ?").get(A, "r_shared");
  assert.equal(row.perms, "a".repeat(1000)); assert.equal(row.supervise, "");
  const r = await list(s)(); assert.equal(r.json.roles[0].perms, "a".repeat(1000)); assert.equal(r.json.roles[0].supervise, "");
});

test("들여오기가 같은 역할을 다시 써도 깨지지 않음: 글로 고친 권한 → 다시 들여오면 도구 목록 꼴 → 목록 · 프롬프트는 읽을 글", async () => {
  const s = setup();
  const { applyProposal, imported } = await import("./importer/proposal.ts");
  const role = { name: "reviewer", from: "Claude Code 서브에이전트", description: "Review PRs", tools: "Read, Grep, Glob" };
  await applyProposal(s.env, A, "c1", { connectors: [], roles: [role] }, "역할만");
  assert.equal((await listRoles(s.D1, A)).find(r => r.id === "reviewer")!.perms, "쓸 수 있는 도구: Read, Grep, Glob");
  assert.equal((await editRole(s.env, A, { role_id: "reviewer", perms: "읽기만 · 머지 금지" }) as any).ok, true);
  assert.equal((s.db.prepare("SELECT perms FROM role WHERE owner = ? AND id = 'reviewer'").get(A) as any).perms, "읽기만 · 머지 금지");
  await applyProposal(s.env, A, "c2", { connectors: [], roles: [{ ...role, tools: '["Read","Edit"]' }] }, "역할만");
  assert.equal((await listRoles(s.D1, A)).find(r => r.id === "reviewer")!.perms, "쓸 수 있는 도구: Read, Edit");
  const im: any = await imported(s.env, A); assert.ok(im.roles.some((r: any) => r.id === "reviewer" && r.perms === '["Read","Edit"]'));
});

// 지금 하는 일: 보드 판(member-board data)의 last · watch 와 같은 줄
const { data, paneNow } = await import("./member-board.ts");
const logLine = (s: ReturnType<typeof setup>, o: { win?: string; kind: string; text: string; at: number; thread?: string | null; owner?: string; wid?: string | null }) =>
  s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at, wid) VALUES (?,?,?,?,?,?,?)").run(o.owner ?? A, o.win ?? "원래 이름", o.kind, o.text, o.thread ?? null, o.at, o.wid ?? null);

test("지금 하는 일: 창마다 마지막 줄 · 상태 한 줄 — 보드 판 last · watch 와 같은 줄(막힘 먼저 · Primary · 내 글 · 남의 줄 뺌), 한 줄 120자", async () => {
  const s = setup(), now = Date.now();
  logLine(s, { kind: "progress", text: "옛 진행", at: now - 9000 });
  logLine(s, { kind: "blocked", text: "리뷰어 답 기다림\n둘째 줄", at: now - 8000 });
  logLine(s, { kind: "status", text: "쉼 · 깨움 21:30", at: now - 7000 });
  logLine(s, { kind: "say", text: "Primary 답", at: now - 10, thread: "primary" });
  logLine(s, { kind: "say", text: "스레드 답", at: now - 10, thread: "p:1793000000.000001" });
  logLine(s, { kind: "me", text: "사람 글", at: now - 5 });
  logLine(s, { kind: "progress", text: "남의 줄", at: now, owner: B });
  let x = (await listRoles(s.D1, A))[0];
  for (const w of x.windows) { assert.deepEqual(w.last && { kind: w.last.kind, text: w.last.text }, { kind: "막힘", text: "리뷰어 답 기다림 둘째 줄" }); assert.equal(w.watch, ""); }
  const pane = (await data(s.D1, A, null)).panes.find((p: any) => p.win === "원래 이름");
  assert.ok(pane); assert.equal(pane.last.kind, "막힘"); assert.equal(pane.last.msg, "리뷰어 답 기다림\n둘째 줄"); assert.equal(pane.watch, "");
  logLine(s, { kind: "done", text: "끝냄", at: now - 6000 });
  logLine(s, { kind: "status", text: "다음 일 기다림 " + "가".repeat(200), at: now - 5000 });
  x = (await listRoles(s.D1, A))[0];
  const w = x.windows[0];
  assert.equal(w.watch, "다음 일 기다림 " + "가".repeat(120 - 10) + "…"); assert.equal(Array.from(w.watch).length, 120);
  assert.equal(w.last!.kind, "status"); assert.equal(w.last!.text, w.watch);
  const pane2 = (await data(s.D1, A, null)).panes.find((p: any) => p.win === "원래 이름");
  assert.ok(w.watch.startsWith(pane2.watch.slice(0, -1)));   // 판은 60자, 역할 칸은 120자 — 같은 줄
  assert.deepEqual(paneNow([], 0), { last: null, blocked: null, watch: null });
  const bare = (await listRoles(s.D1, B))[0];
  assert.deepEqual(bare.windows, []);
});

// 새 역할(POST /api/me/roles)
function make(s: ReturnType<typeof setup>, member: string | null = A) {
  const app = new Hono<any>();
  mountRoleEdit(app, async c => c.req.header("x-hb") === "1" && c.req.header("sec-fetch-site") === "same-origin" ? member : null);
  return async (body: unknown, headers = { "x-hb": "1", "sec-fetch-site": "same-origin" }) => {
    const r = await app.fetch(new Request("https://example.test/api/me/roles", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), s.env);
    return { status: r.status, json: await r.json() as any };
  };
}
const live = (s: ReturnType<typeof setup>) => s.db.prepare("UPDATE device SET engine_at = ? WHERE id = ?").run(Date.now(), DEV);
const NEW = { name: "문서 정리", brief: "회의록을 정리해요", instructions: "Summarise meeting notes into the docs folder.", perms: "Read, Edit\n메일 보내기 금지", supervise: "기술 리드에게 보고" };

test("새 역할: 회원 · 같은 사이트만(주인 · 세션 없음 · cross-site 403), 입력 검사 400, 아무것도 안 만듦", async () => {
  const s = setup(); live(s);
  const before = () => [s.db.prepare("SELECT count(*) n FROM role").get()!.n, s.db.prepare("SELECT count(*) n FROM engine_window").get()!.n, s.sent.length];
  const b0 = before();
  assert.equal((await make(s, null)(NEW)).status, 403);
  assert.equal((await make(s)(NEW, { "x-hb": "1", "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await make(s)(NEW, { "x-hb": "0", "sec-fetch-site": "same-origin" } as any)).status, 403);
  for (const body of [null, [], {}, { name: "이름만" }, { instructions: "지시만" }, { ...NEW, name: "" }, { ...NEW, name: "a".repeat(41) }, { ...NEW, brief: "a".repeat(201) }, { ...NEW, instructions: "a".repeat(3001) },
    { ...NEW, perms: "a".repeat(1001) }, { ...NEW, supervise: "x\ty" }, { ...NEW, name: "a\nb" }, { ...NEW, owner: B }, { ...NEW, role_id: "r_x" }, { ...NEW, cwd: "/etc" }]) {
    assert.equal((await make(s)(body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(before(), b0);
  assert.equal(roleCreateSchema.safeParse({ name: "a", instructions: "b" }).success, true);
});

test("새 역할 = 초안 「이대로」와 같은 결과: 역할 줄 · 창 줄 · 기기에 넣는 창 지시 · 「창을 열었어요」 줄이 같음(권한 · 보고 라인만 더)", async () => {
  // 화면에서 만들기
  const s1 = setup(); live(s1);
  const r = await make(s1)(NEW);
  assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.pending, false); assert.match(r.json.role_id, /^r_[a-z0-9]{12}$/); assert.match(r.json.window, /^ew_/);
  // 메인 봇 초안 → 「이대로」
  const s2 = setup(); live(s2);
  s2.db.prepare("INSERT INTO role_draft(id, owner, name, brief, instructions, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run("rd_1", A, NEW.name, NEW.brief, NEW.instructions, T, T);
  const d = await approveDraft(s2.env, A, "rd_1");
  const norm = (s: ReturnType<typeof setup>, roleId: string, win: string) => {
    const role: any = s.db.prepare("SELECT * FROM role WHERE owner = ? AND id = ?").get(A, roleId);
    const w: any = s.db.prepare("SELECT * FROM engine_window WHERE id = ?").get(win);
    const open = s.sent.filter(m => m.verb === "open");
    const sys: any[] = s.db.prepare("SELECT text, wid FROM board_log WHERE owner = ? AND kind = 'sys'").all(A);
    const eng = JSON.parse(role.engine);
    return { role: { name: role.name, intake: role.intake, instructions: role.instructions, engine: { ...eng, cwd: eng.cwd.replace(roleId, "<id>") } },
      win: { kind: w.kind, role_id: w.role_id === roleId, name: w.name, state: w.state, device_id: w.device_id },
      open: open.map(m => ({ ...m.args.spec, id: m.args.spec.id === win, session_id: typeof m.args.spec.session_id, cwd: m.args.spec.cwd.replace(roleId, "<id>") })),
      sys: sys.map(x => ({ text: x.text, wid: x.wid === win })) };
  };
  const a = norm(s1, r.json.role_id, r.json.window), b = norm(s2, d.role_id, d.window);
  const withMore = rolePrompt(NEW.name, NEW.instructions, true, NEW);
  assert.equal(a.open.length, 1); assert.equal(a.open[0].prompt, withMore);
  assert.equal(b.open[0].prompt, rolePrompt(NEW.name, NEW.instructions));
  assert.deepEqual({ ...a, open: a.open.map(o => ({ ...o, prompt: null })) }, { ...b, open: b.open.map(o => ({ ...o, prompt: null })) });
  assert.deepEqual(a.sys, [{ text: `「${NEW.name}」 창을 열었어요`, wid: true }]);
  const row: any = s1.db.prepare("SELECT source, perms, supervise FROM role WHERE owner = ? AND id = ?").get(A, r.json.role_id);
  assert.deepEqual({ ...row }, { source: "user", perms: NEW.perms, supervise: NEW.supervise });
  const x = (await listRoles(s1.D1, A)).find(y => y.id === r.json.role_id)!;
  assert.equal(x.brief, NEW.brief); assert.equal(x.perms, NEW.perms); assert.equal(x.supervise, NEW.supervise); assert.deepEqual(x.windows.map(w => w.id), [r.json.window]);
});

test("새 역할 한도는 초안 쪽과 같음: 같은 목표(같은 이름) 창이 살아 있으면 409 — 초안 role_draft 도 같은 판정; one_goal 끄면 둘 다 됨; 한 시간 창 수", async () => {
  const s = setup(); live(s);
  const local = localTools(s.D1, A, "Primary", "https://example.test", "", undefined, undefined, undefined, s.env, DEV);
  const r = await make(s)({ ...NEW, name: " 원래  이름 " });
  assert.equal(r.status, 409); assert.match(r.json.error, /한 역할은 한 목표/);
  const dr: any = await local("role_draft", { name: "원래 이름", instructions: "x" }); assert.equal(dr.refused, true);
  assert.equal(s.db.prepare("SELECT count(*) n FROM role WHERE owner = ?").get(A)!.n, 1);
  s.db.prepare("INSERT INTO engine_owner(owner, rules, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ one_goal: false }), T);
  assert.equal((await make(s)({ ...NEW, name: "원래 이름" })).status, 200);
  assert.ok((await local("role_draft", { name: "원래 이름", instructions: "x" }) as any).draft_id);
  assert.equal(OPEN_PER_HOUR, 30);
  const n = s.db.prepare("SELECT count(*) n FROM engine_window WHERE owner = ? AND created_at > ?").get(A, Date.now() - 3600_000)!.n as number;
  for (let i = n; i < OPEN_PER_HOUR; i++) s.db.prepare("INSERT INTO engine_window(id, owner, device_id, kind, name, state, created_at) VALUES (?,?,?,?,?,?,?)").run("ew_fill" + i, A, DEV, "role", "채움", "closed", Date.now());
  const roles = s.db.prepare("SELECT count(*) n FROM role").get()!.n;
  const lim = await make(s)({ ...NEW, name: "한도 넘음" });
  assert.equal(lim.status, 429); assert.equal(lim.json.error, "한 시간에 30창까지예요");
  assert.equal(s.db.prepare("SELECT count(*) n FROM role").get()!.n, roles);
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /openedLastHour\(db, d\.owner\) >= OPEN_PER_HOUR/);
});

test("엔진이 켜진 기기가 없으면 역할만 만들고 미룸 → 엔진이 붙으면(openPending) 그 기기에 한 번만 창, 못 열면 다시 미룸", async () => {
  const s = setup();   // engine_at 없음 = 산 엔진 없음
  const r = await make(s)(NEW);
  assert.equal(r.status, 200); assert.deepEqual({ ...r.json, role_id: null }, { ok: true, role_id: null, window: null, pending: true });
  assert.equal(s.sent.length, 0);
  assert.equal(s.db.prepare("SELECT count(*) n FROM engine_window WHERE role_id = ?").get(r.json.role_id)!.n, 0);
  assert.match((s.db.prepare("SELECT text FROM board_log WHERE owner = ? AND kind = 'sys'").get(A) as any).text, /기기에서 엔진을 켜면 창이 열려요$/);
  assert.equal((await listRoles(s.D1, A)).find(x => x.id === r.json.role_id)!.pending, true);
  // 못 열면 다시 미룸
  const real = s.eng.cmd.bind(s.eng);
  s.eng.cmd = (verb: string, a: any) => verb === "open" ? Promise.reject(new Error("기기 꺼짐")) : real(verb, a);
  assert.deepEqual(await s.eng.openPending(A), { opened: 0 });
  const back = (await listRoles(s.D1, A)).find(x => x.id === r.json.role_id)!;
  assert.equal(back.pending, true); assert.deepEqual(back.windows, []);
  s.eng.cmd = real;
  assert.deepEqual(await s.eng.openPending(A), { opened: 1 });
  assert.deepEqual(await s.eng.openPending(A), { opened: 0 });
  const open = s.sent.filter(m => m.verb === "open");
  assert.equal(open.length, 1); assert.equal(open[0].args.spec.prompt, rolePrompt(NEW.name, NEW.instructions, true, NEW));
  const x = (await listRoles(s.D1, A)).find(y => y.id === r.json.role_id)!;
  assert.equal(x.pending, false); assert.equal(x.windows.length, 1);
  assert.equal(JSON.parse((s.db.prepare("SELECT engine FROM role WHERE id = ?").get(r.json.role_id) as any).engine).device, DEV);
});

test("산 엔진에서 창을 못 열면 역할 줄을 되돌리고 한 줄 오류(초안 길과 같이)", async () => {
  const s = setup(); live(s);
  s.eng.cmd = () => Promise.reject(new Error("엔진 답 없음"));
  const r = await make(s)(NEW);
  assert.equal(r.status, 400); assert.equal(r.json.error, "엔진 답 없음");
  assert.equal(s.db.prepare("SELECT count(*) n FROM role WHERE owner = ? AND source = 'user'").get(A)!.n, 0);
});

test("GET engine: 엔진을 쓰는 회원(엔진 기기 하나라도 — 설정 엔진 칸과 같은 판정)만 true", async () => {
  const s = setup();
  assert.equal(await usesEngine(s.D1, A), false);
  s.db.prepare("UPDATE device SET features = ? WHERE id = ?").run(JSON.stringify({ engine: true }), DEV);
  assert.equal(await usesEngine(s.D1, A), true); assert.equal((await list(s)()).json.engine, true);
  assert.equal(await usesEngine(s.D1, B), false);
  s.db.prepare("UPDATE device SET revoked_at = ? WHERE id = ?").run(T, DEV);
  assert.equal(await usesEngine(s.D1, A), false);
  s.db.prepare("UPDATE device SET revoked_at = NULL, features = NULL, engine = ?, engine_at = ? WHERE id = ?").run(JSON.stringify({ cli: "0.1" }), Date.now(), DEV);   // SDK 엔진(features 없이 엔진 데몬만)
  assert.equal(await usesEngine(s.D1, A), true);
  s.db.prepare("UPDATE device SET engine_at = ? WHERE id = ?").run(Date.now() - 30 * 86_400_000, DEV);   // 그 엔진을 끈 지 오래 — 단추는 남음(만든 역할은 미뤄 둠)
  assert.equal(await usesEngine(s.D1, A), true); assert.equal((await list(s)()).json.engine, true);
  s.db.prepare("UPDATE device SET engine = ? WHERE id = ?").run(JSON.stringify({ harness: true }), DEV);
  assert.equal(await usesEngine(s.D1, A), false);
  s.db.prepare("UPDATE device SET engine = NULL, engine_at = NULL WHERE id = ?").run(DEV);   // 엔진이 붙은 적 없는 기기
  assert.equal(await usesEngine(s.D1, A), false); assert.equal((await list(s)()).json.engine, false);
  s.db.prepare("UPDATE device SET engine = 'not json', engine_at = ? WHERE id = ?").run(Date.now(), DEV);
  assert.equal(await usesEngine(s.D1, A), false);
});

const winCount = (s: ReturnType<typeof setup>) => s.db.prepare("SELECT count(*) n FROM engine_window WHERE owner = ? AND created_at > ?").get(A, Date.now() - 3600_000)!.n as number;
const pendCount = (s: ReturnType<typeof setup>) => s.db.prepare("SELECT count(*) n FROM role WHERE owner = ? AND (CASE WHEN json_valid(engine) THEN json_extract(engine, '$.pending') END) = 1").get(A)!.n as number;

test("미룬 역할도 같은 목표: 엔진이 꺼진 동안 같은 이름 두 번째는 409, 초안 role_draft · 산 엔진 새 역할도 409; one_goal 끄면 됨", async () => {
  const s = setup();
  assert.equal((await make(s)(NEW)).status, 200);
  const again = await make(s)({ ...NEW, name: "  문서  정리 " });
  assert.equal(again.status, 409); assert.match(again.json.error, /엔진을 기다리고 있어요/);
  const local = localTools(s.D1, A, "Primary", "https://example.test", "", undefined, undefined, undefined, s.env, DEV);
  const dr: any = await local("role_draft", { name: "문서 정리", instructions: "x" });
  assert.equal(dr.refused, true); assert.equal(dr.window, null); assert.match(dr.why, /opens its window when the engine starts/);
  live(s);
  assert.equal((await make(s)(NEW)).status, 409);
  assert.equal(pendCount(s), 1); assert.equal(s.sent.length, 0);
  s.db.prepare("INSERT INTO engine_owner(owner, rules, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ one_goal: false }), T);
  assert.equal((await make(s)(NEW)).status, 200);
});

test("미룬 역할 + 지난 한 시간 창이 30 이면 429: 엔진이 꺼진 동안 40번 만들어도 30 까지만", async () => {
  const s = setup(), before = winCount(s);
  const st: number[] = [];
  for (let i = 0; i < 40; i++) st.push((await make(s)({ ...NEW, name: `미룬 역할 ${i}` })).status);
  assert.equal(st.filter(x => x === 200).length, OPEN_PER_HOUR - before);
  assert.ok(st.slice(OPEN_PER_HOUR - before).every(x => x === 429), JSON.stringify(st));
  assert.equal(pendCount(s), OPEN_PER_HOUR - before);
  live(s); assert.equal((await make(s)({ ...NEW, name: "산 엔진도" })).status, 429);   // 산 엔진 길도 같은 셈
});

test("openPending 은 열기 전에 다시 봄: 여러 번 붙어도 한 시간 30창을 안 넘고, 같은 이름 미룬 역할 둘은 하나만 열림 — 남은 것은 미룬 채", async () => {
  const s = setup(), before = winCount(s), n = OPEN_PER_HOUR - before;
  for (let i = 0; i < n; i++) assert.equal((await make(s)({ ...NEW, name: `미룬 역할 ${i}` })).status, 200);
  const add = (id: string, name: string) => s.db.prepare("INSERT INTO role(owner, id, name, instructions, engine, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(A, id, name, "x", JSON.stringify({ engine: "tmux", cwd: "~/boarder/" + id, pending: 1 }), "user", Date.now() + 1, Date.now() + 1);
  add("r_old1", "옛 미룸 1"); add("r_old2", "옛 미룸 2"); add("r_old3", "옛 미룸 3");
  const opened: number[] = [];
  for (let i = 0; i < 6; i++) opened.push((await s.eng.openPending(A)).opened);
  assert.equal(opened.reduce((a, b) => a + b, 0), n, JSON.stringify(opened));
  assert.ok(opened.every(x => x <= 10));
  assert.equal(winCount(s), OPEN_PER_HOUR);
  assert.equal(pendCount(s), 3);
  s.db.prepare("UPDATE engine_window SET created_at = ? WHERE owner = ?").run(Date.now() - 2 * 3600_000, A);
  s.db.prepare("UPDATE role SET name = '같은 이름' WHERE id IN ('r_old1','r_old2')").run();
  for (let i = 0; i < 3; i++) await s.eng.openPending(A);
  const same: any[] = s.db.prepare("SELECT r.id, json_extract(r.engine, '$.pending') p, (SELECT count(*) FROM engine_window w WHERE w.role_id = r.id) w FROM role r WHERE r.id IN ('r_old1','r_old2','r_old3') ORDER BY r.id").all();
  assert.deepEqual(same.map(x => [x.p, x.w]), [[0, 1], [1, 0], [0, 1]]);
});
