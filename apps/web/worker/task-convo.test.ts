// node --test --no-warnings --experimental-transform-types apps/web/worker/task-convo.test.ts — 태스크 대화 표(task-convo.ts · migrations/0060 · member-board syncTaskConvo · nodechat 두 겹). 자료는 다 지어낸 것
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
const { mountImport, regroup } = await import("./importer/routes.ts");
const { mountTaskConvo } = await import("./task-convo.ts");
const { syncTaskConvo, get, post, paneOfId, tsOf } = await import("./member-board.ts");
const { chatPost } = await import("./member-inbox.ts");
const { splitMove } = await import("./member-split.ts");
const { Hono } = await import("hono");

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
  const batch = async (ss: any[]) => {
    db.exec("BEGIN");
    try { const out = []; for (const s of ss) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database };
}

const A = "member@example.com", B = "other@example.com";
const H = 3600_000, NOW = Date.now();
// as = 누구로 부르나: { dev: 주인 메일 } = 그 사람 기기 토큰 · { member: 메일, same: 같은 사이트? } = 로그인 회원
type As = { dev?: string; member?: string; same?: boolean };
function app(D1: D1Database) {
  let cur: As = { dev: A };
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: String(e) }, 500));
  const hooks = { device: async () => cur.dev ? { id: "dev_" + cur.dev, owner: cur.dev, name: "lap1" } : null, member: async () => cur.member || null, sameSite: () => !!cur.same };
  mountImport(a, hooks);
  mountTaskConvo(a, { ...hooks, sync: (db, me, node) => syncTaskConvo(db, me, node) });
  const call = (method: string, path: string, body?: unknown, as: As = { dev: A }) => { cur = as; return a.request(path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: D1, PUBLIC_URL: "https://example.test" }); };
  return call;
}
const win = (db: DatabaseSync, owner: string, w: string, title: string, session = "", at = NOW) =>
  db.prepare("INSERT INTO imp_item(owner, key, device_id, kind, engine, title, cwd, repo, state, state_at, win, session, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(owner, "window:" + w, "dev_" + owner, "window", "herdr-own", title, "/x/app", "example-org/app", "working", at, w, session, at);
const log = (db: DatabaseSync, owner: string, w: string, text: string, at = NOW, kind = "progress") => db.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").run(owner, w, kind, text, at);

async function seed() {
  const f = d1(), call = app(f.D1);
  for (const o of [A, B]) {
    f.db.prepare("INSERT INTO device(id, owner, name, token_hash, created_at) VALUES (?,?,?,?,?)").run("dev_" + o, o, "lap1", "h_" + o, NOW);
    f.db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(o, JSON.stringify({ unit: "agent", task_channels: true, task_repo: "example-org/app" }), NOW);
  }
  assert.equal((await call("POST", "/api/device/tasks", { tasks: [{ key: "6386", name: "#6386 은행 거래 정리", issue: 6386, state: "working" }, { key: "side", name: "번호 없는 일", state: "working" }] })).status, 200);
  assert.equal((await call("POST", "/api/device/tasks", { tasks: [{ key: "7001", name: "남의 일", issue: 7001, state: "working" }] }, { dev: B })).status, 200);
  return { ...f, call };
}
const row = (src_ref: string, at: number, layer = "agents", text = "글 " + src_ref) => ({ layer, who: "작업자", at, source: "herdr-say", text, src_ref });
const body = async (r: Response) => r.json() as Promise<any>;

test("쓰기 · 읽기: at 순(넣은 차례와 상관없이) · 층 거르기 · 쪽 나눔(next) · 층마다 수", async () => {
  const { call } = await seed();
  const w = await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [row("r3", NOW - 1 * H), row("r1", NOW - 3 * H, "human"), row("r2", NOW - 2 * H), row("r4", NOW - 1 * H)] });
  assert.equal(w.status, 200, await w.clone().text());
  assert.deepEqual(await body(w), { ok: true, task: "6386", node: "tk_6386", added: 4, dup: 0 });
  const all = await body(await call("GET", "/api/device/tasks/convo?task=6386&sync=0"));
  assert.deepEqual(all.rows.map((r: any) => r.src_ref), ["r1", "r2", "r3", "r4"], "at 순, 같은 at 은 넣은 순(id)");
  assert.deepEqual(all.counts, { human: 1, agents: 3 });
  const ag = await body(await call("GET", "/api/device/tasks/convo?task=6386&layer=agents&sync=0"));
  assert.deepEqual(ag.rows.map((r: any) => r.src_ref), ["r2", "r3", "r4"]);
  const p1 = await body(await call("GET", "/api/device/tasks/convo?task=6386&limit=2&sync=0"));
  assert.deepEqual(p1.rows.map((r: any) => r.src_ref), ["r1", "r2"]); assert.ok(p1.next);
  const p2 = await body(await call("GET", `/api/device/tasks/convo?task=6386&limit=2&sync=0&after=${p1.next}`));
  assert.deepEqual(p2.rows.map((r: any) => r.src_ref), ["r3", "r4"]); assert.equal(p2.next, null, "같은 at 둘이 쪽 경계에 걸려도 빠지거나 두 번 나오지 않음");
  assert.equal((await call("GET", "/api/device/tasks/convo?task=6386&layer=x")).status, 400);
});

test("중복 키: 같은 src_ref 는 한 줄 — 한 요청 안에서도 · 다시 보내도(dup 으로 셈, 글은 처음 것 그대로)", async () => {
  const { call } = await seed();
  const a = await body(await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [row("same", NOW, "agents", "처음"), row("same", NOW, "agents", "둘째")] }));
  assert.deepEqual([a.added, a.dup], [1, 1]);
  const b = await body(await call("POST", "/api/device/tasks/convo", { task: "#6386", rows: [row("same", NOW + 1, "human", "다시")] }));
  assert.deepEqual([b.added, b.dup], [0, 1]);
  const r = await body(await call("GET", "/api/device/tasks/convo?task=6386&sync=0"));
  assert.deepEqual(r.rows.map((x: any) => [x.src_ref, x.text, x.layer]), [["same", "처음", "agents"]]);
});

test("권한 경계: 남의 보드 태스크는 쓰기 · 읽기 404(있는지도 안 알림) · 같은 키여도 내 표에는 남의 줄 없음 · 회원 쓰기는 같은 사이트만", async () => {
  const { call } = await seed();
  await call("POST", "/api/device/tasks/convo", { task: "7001", rows: [row("b1", NOW)] }, { dev: B });
  // A 의 기기가 B 의 태스크에
  assert.equal((await call("POST", "/api/device/tasks/convo", { task: "7001", rows: [row("x", NOW)] })).status, 404);
  assert.equal((await call("GET", "/api/device/tasks/convo?task=7001")).status, 404);
  assert.equal((await call("GET", "/api/me/tasks/convo?task=tk_7001", undefined, { member: A })).status, 404);
  // B 가 A 의 태스크에
  assert.equal((await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [row("y", NOW)] }, { dev: B })).status, 404);
  assert.equal((await call("GET", "/api/device/tasks/convo?task=6386", undefined, { dev: B })).status, 404);
  // B 의 줄은 그대로 하나(A 가 못 씀)
  const br = await body(await call("GET", "/api/device/tasks/convo?task=7001&sync=0", undefined, { dev: B }));
  assert.deepEqual(br.rows.map((x: any) => x.src_ref), ["b1"]);
  // 로그인 없음 · 기기 없음
  assert.equal((await call("GET", "/api/device/tasks/convo?task=6386", undefined, {})).status, 401);
  // 회원 쓰기: 다른 사이트에서 온 요청(sameSite 아님)은 쿠키를 안 믿음 → 401, 같은 사이트면 됨
  assert.equal((await call("POST", "/api/me/tasks/convo", { task: "6386", rows: [row("m1", NOW, "human")] }, { member: A, same: false })).status, 401);
  assert.equal((await call("POST", "/api/me/tasks/convo", { task: "6386", rows: [row("m1", NOW, "human")] }, { member: A, same: true })).status, 200);
  // 회원 읽기(GET 은 같은 사이트 검사 없음 — 쿠키 회원 그대로)
  assert.equal((await call("GET", "/api/me/tasks/convo?task=6386&sync=0", undefined, { member: A })).status, 200);
});

test("task 이름꼴: 키 · #번호 · tk_키 · 저장소#번호 모두 같은 태스크, 번호 없는 업무는 키로 · 모양 틀림 · 없는 키는 404/400", async () => {
  const { call } = await seed();
  for (const t of ["6386", "#6386", "tk_6386", "example-org/app#6386", 6386]) assert.equal((await call("POST", "/api/device/tasks/convo", { task: t, rows: [row("k" + t, NOW)] })).status, 200, String(t));
  assert.equal((await call("POST", "/api/device/tasks/convo", { task: "side", rows: [row("s", NOW)] })).status, 200);
  assert.equal((await call("POST", "/api/device/tasks/convo", { task: "9999", rows: [row("z", NOW)] })).status, 404);
  assert.equal((await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [{ ...row("bad", NOW), layer: "boss" }] })).status, 400);
  assert.equal((await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [{ ...row("bad", NOW), at: "어제" }] })).status, 400);
  // at: 초 · ISO 도 ms 로
  const SEC = Math.floor((NOW - 2 * H) / 1000), ISO = new Date(NOW - 3 * H).toISOString();
  await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [{ ...row("sec", 0), at: SEC }, { ...row("iso", 0), at: ISO }] });
  const r = await body(await call("GET", "/api/device/tasks/convo?task=6386&sync=0"));
  const at = Object.fromEntries(r.rows.map((x: any) => [x.src_ref, x.at]));
  assert.equal(at.sec, SEC * 1000); assert.equal(at.iso, Date.parse(ISO));
});

test("보드 줄 맞춰 넣기: 사람 글 · 담당 창 = human, 작업자 창 = agents · 다시 맞춰도 한 줄 · 노드 채팅은 에이전트끼리를 접은 글 하나로", async () => {
  const { db, D1, call } = await seed();
  win(db, A, "lap1:ew_desk6386", "#6386 은행 거래 정리 담당", "session:claude:d");
  win(db, A, "lap1:ew_wp6386", "작업자 #6386 규칙", "session:claude:w");
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  assert.equal((await call("POST", "/api/device/tasks/attach", { node: "tk_6386", item: "window:lap1:ew_desk6386" })).status, 200);
  log(db, A, "lap1:ew_desk6386", "담당: 규칙 정리 시작해요", NOW - 50 * 60_000);
  log(db, A, "#6386 은행 거래 정리", "어디까지 됐어요?", NOW - 40 * 60_000, "me");
  log(db, A, "lap1:ew_wp6386", "작업자: 규칙 3개 끝", NOW - 30 * 60_000);
  log(db, A, "lap1:ew_wp6386", "작업자: 리뷰 부탁", NOW - 20 * 60_000);
  await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [row("herdr:1", NOW - 10 * 60_000, "agents", "담당 → 작업자: 규칙 4 도"), row("herdr:2", NOW - 5 * 60_000, "human", "비서실장: 대표님께 전달했어요")] });
  const r = await body(await call("GET", "/api/device/tasks/convo?task=6386"));
  assert.deepEqual(r.rows.map((x: any) => [x.layer, x.text]), [
    ["human", "담당: 규칙 정리 시작해요"], ["human", "어디까지 됐어요?"], ["agents", "작업자: 규칙 3개 끝"], ["agents", "작업자: 리뷰 부탁"], ["agents", "담당 → 작업자: 규칙 4 도"], ["human", "비서실장: 대표님께 전달했어요"]]);
  assert.equal(r.rows[1].who, A); assert.equal(r.rows[2].who, "lap1:ew_wp6386"); assert.equal(r.rows[0].source, "board");
  const again = await body(await call("GET", "/api/device/tasks/convo?task=6386"));
  assert.equal(again.rows.length, 6, "다시 읽어(맞춰 넣기 또) 줄이 늘지 않음");
  // 노드 채팅: 작업자 줄 · 표의 agents 줄은 위 접은 글 하나(수 3), 사람 쪽 글은 그대로 펼침 + 표에만 있는 human 줄도 글로
  const nc = await (await get(D1, A, { name: "비서실장" }, new URL("https://example.test/api/nodechat?w=" + encodeURIComponent("#6386 은행 거래 정리")), async () => null))!.json() as any;
  const texts = nc.messages.map((m: any) => m.text);
  assert.ok(texts[0].startsWith("에이전트끼리 3"), texts[0]);
  assert.equal(nc.messages[0].fold.agents, 3);
  assert.ok(!texts.some((t: string) => t.startsWith("작업자:")), JSON.stringify(texts));
  assert.ok(texts.includes("어디까지 됐어요?") && texts.includes("담당: 규칙 정리 시작해요") && texts.includes("비서실장: 대표님께 전달했어요"), JSON.stringify(texts));
  assert.deepEqual(nc.layers, { human: 3, agents: 3 });
  // 접은 글을 누르면(스레드) 에이전트끼리 줄이 at 순으로
  const th = await (await get(D1, A, { name: "비서실장" }, new URL("https://example.test/api/chat/primary/" + nc.messages[0].ts), async () => null))!.json() as any;
  assert.deepEqual(th.messages.slice(1).map((m: any) => m.text), ["작업자: 규칙 3개 끝", "작업자: 리뷰 부탁", "담당 → 작업자: 규칙 4 도"]);
  // 내 글을 보드에서 지우면 표의 그 줄도
  const mine = nc.messages.find((m: any) => m.text === "어디까지 됐어요?");
  assert.ok("ok" in (await post(D1, A, "/api/chat", { delete: true, ts: mine.ts }) as any));
  const after = await body(await call("GET", "/api/device/tasks/convo?task=6386&sync=0"));
  assert.ok(!after.rows.some((x: any) => x.text === "어디까지 됐어요?"));
});

test("채널 = 태스크를 끈 회원의 노드 채팅은 예전 그대로(접은 글 · layers 없음)", async () => {
  const { db, D1 } = await seed();
  db.prepare("UPDATE node_setting SET data = ? WHERE owner = ?").run(JSON.stringify({ unit: "agent", task_repo: "example-org/app" }), A);
  win(db, A, "lap1:ew_wp6386", "작업자 #6386 규칙", "session:claude:w");
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  log(db, A, "lap1:ew_wp6386", "작업자: 규칙 3개 끝", NOW - 30 * 60_000);
  const L = await (await get(D1, A, null, new URL("https://example.test/api/nodechat?w=" + encodeURIComponent("#6386 은행 거래 정리")), async () => null))!.json() as any;
  assert.equal(L.layers, undefined);
  assert.ok(!L.messages.some((m: any) => /^에이전트끼리/.test(m.text)));
  assert.equal(paneOfId("tk_6386").startsWith("%"), true);
});

const G = (D1: D1Database, q: string, me = A) => get(D1, me, { name: "비서실장" }, new URL("https://example.test" + q), async () => null).then(r => r!.json()) as Promise<any>;
const NC = "/api/nodechat?w=" + encodeURIComponent("#6386 은행 거래 정리");
async function desk() {
  const s = await seed();
  win(s.db, A, "lap1:ew_desk", "#6386 담당", "session:claude:d");
  win(s.db, A, "lap1:ew_wp", "작업자 #6386", "session:claude:w");
  await regroup({ DB: s.D1, PUBLIC_URL: "https://example.test" } as never, A);
  assert.equal((await s.call("POST", "/api/device/tasks/attach", { node: "tk_6386", item: "window:lap1:ew_desk" })).status, 200);
  return s;
}
const rowsOf = async (call: any, task = "6386") => (await body(await call("GET", `/api/device/tasks/convo?task=${task}&limit=200`))).rows as any[];

test("담당 창 이름 ≠ 창 키(CLI 창 — 키 lap1:tmux:12 · 이름 app tmux 12): 담당 답은 human, 작업자 창은 agents", async () => {
  const { db, D1, call } = await seed();
  win(db, A, "lap1:tmux:12", "#6386 은행 거래 정리 담당", "session:claude:d");
  win(db, A, "lap1:tmux:13", "작업자 #6386", "session:claude:w");
  const tok = (h: string, pane: string, name: string) => db.prepare("INSERT INTO agent_token(hash, pane, win, host, created_at, tools, owner, device_id) VALUES (?,?,?,?,?,'*',?,?)").run(h, pane, name, "device:dev_" + A, NOW, A, "dev_" + A);
  tok("h1", "lap1:tmux:12", "app tmux 12"); tok("h2", "lap1:tmux:13", "app tmux 13");
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  assert.equal((await call("POST", "/api/device/tasks/attach", { node: "tk_6386", item: "window:lap1:tmux:12" })).status, 200);
  log(db, A, "app tmux 12", "담당 답: 시작해요", NOW - 50 * 60_000, "chat");
  log(db, A, "app tmux 13", "작업자 보고", NOW - 40 * 60_000, "chat");
  // 같은 이름 창이 새 키를 받아도(Codex 샌드박스) 그 이름 줄은 담당
  tok("h3", "lap1:tmux:99", "app tmux 12");
  log(db, A, "app tmux 12", "담당 답 둘째", NOW - 30 * 60_000, "chat");
  const r = await rowsOf(call);
  assert.deepEqual(r.map(x => [x.layer, x.text]), [["human", "담당 답: 시작해요"], ["agents", "작업자 보고"], ["human", "담당 답 둘째"]]);
  const nc = await G(D1, NC), texts = nc.messages.map((m: any) => m.text);
  assert.ok(texts.includes("담당 답: 시작해요") && texts.includes("담당 답 둘째"), JSON.stringify(texts));
  assert.equal(nc.messages[0].fold.agents, 1);
});

test("agents 줄에 달린 스레드 답: 뿌리는 채널에 답글 수와 남고 그 스레드로 열림 · 표에도 답 줄 · 답 없는 줄만 접음", async () => {
  const { db, D1, call } = await desk();
  const at = NOW - 50 * 60_000, rid = Number(log(db, A, "lap1:ew_wp", "작업자 보고", at).lastInsertRowid), ts = tsOf(at, rid);
  log(db, A, "lap1:ew_wp", "작업자 다른 보고", NOW - 45 * 60_000);
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "#6386 은행 거래 정리", "me", "사람 답: 이건 빼 주세요", ts, NOW - 40 * 60_000);
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "lap1:ew_wp", "chat", "작업자 답: 뺐어요", ts, NOW - 30 * 60_000);
  const nc = await G(D1, NC), rootMsg = nc.messages.find((m: any) => m.text === "작업자 보고");
  assert.ok(rootMsg, JSON.stringify(nc.messages.map((m: any) => m.text)));
  assert.equal(rootMsg.replies, 2); assert.equal(rootMsg.ch, "n:#6386 은행 거래 정리", "채널 길로 열려야 답글 단추 · 답 쓰기가 됨");
  const th = await G(D1, "/api/chat/" + encodeURIComponent(rootMsg.ch) + "/" + ts);
  assert.deepEqual(th.messages.map((m: any) => m.text), ["작업자 보고", "사람 답: 이건 빼 주세요", "작업자 답: 뺐어요"]);
  // 접은 글엔 답 없는 줄만(같은 글이 두 곳에 안 보임)
  assert.equal(nc.messages[0].fold.agents, 1);
  const f = await G(D1, "/api/chat/primary/" + nc.messages[0].ts);
  assert.deepEqual(f.messages.slice(1).map((m: any) => m.text), ["작업자 다른 보고"]);
  // 표 · 읽기 API 에도 답 줄(사람 답 = human, 작업자 답 = agents)
  const r = await rowsOf(call);
  assert.deepEqual(r.map(x => [x.layer, x.text]), [["agents", "작업자 보고"], ["agents", "작업자 다른 보고"], ["human", "사람 답: 이건 빼 주세요"], ["agents", "작업자 답: 뺐어요"]]);
  assert.deepEqual(nc.layers, { human: 1, agents: 3 });
});

test("카드 스레드 줄은 표에 안 넣음(그 카드 글 아래 그대로)", async () => {
  const { db, call } = await desk();
  const id = "1793300000.000042";
  db.prepare("INSERT INTO board_card(id, owner, win, question, choices, body, state, at, wid) VALUES (?,?,?,?,?,?,?,?,?)").run(id, A, "lap1:ew_wp", "어느 쪽?", JSON.stringify(["A"]), "", "open", NOW - 60_000, "");
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "lap1:ew_wp", "chat", "카드 답 줄", id, NOW - 30_000);
  assert.deepEqual((await rowsOf(call)).map(x => x.text), ["어느 쪽?"]);
});

test("태스크를 열기 전 회원 장부가 600줄 넘게 쌓여도 옛 줄이 표에 들어감(읽을 때 그 태스크 범위로 찾음) · 다시 읽을 땐 안 훑음", async () => {
  const { db, D1, call } = await desk();
  win(db, A, "lap1:other", "다른 일", "session:claude:o");
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  await call("POST", "/api/device/tasks/attach", { node: "tk_6386", item: "window:lap1:ew_desk" });
  log(db, A, "lap1:ew_desk", "오래된 담당 글", NOW - 6 * H);
  log(db, A, "lap1:ew_wp", "오래된 작업자 글", NOW - 5 * H);
  for (let i = 0; i < 600; i++) log(db, A, "lap1:other", "다른 일 " + i, NOW - 4 * H + i);
  const prep = (D1 as any).prepare; let scans = 0;
  (D1 as any).prepare = (sql: string) => { if (/FROM board_log WHERE owner = \? .*win IN \(SELECT value FROM json_each/.test(sql)) scans++; return prep(sql); };
  const r = await rowsOf(call);
  assert.deepEqual(r.map(x => [x.layer, x.text]), [["human", "오래된 담당 글"], ["agents", "오래된 작업자 글"]]);
  assert.equal(scans, 1);
  await rowsOf(call);
  assert.equal(scans, 1, "같은 창들 · 새 줄 600 안이면 다시 안 훑음(화면이 몇 초마다 읽음)");
  const nc = await G(D1, NC), f = await G(D1, "/api/chat/primary/" + nc.messages[0].ts);
  assert.deepEqual(f.messages.slice(1).map((m: any) => m.text), ["오래된 작업자 글"]);
});

test("접은 글 스레드에 쓴 답: 판이 있어도 · 없어도 · 다른 노드 판이어도 그 태스크 담당 창으로(메인 봇 · 404 아님)", async () => {
  const { db, D1 } = await desk();
  log(db, A, "lap1:ew_wp", "작업자 보고", NOW - 50 * 60_000);
  log(db, A, "lap1:ew_desk", "담당 줄", NOW - 40 * 60_000);
  const f = (await G(D1, NC)).messages[0];
  assert.equal(f.fold.agents, 1);
  for (const pane of [paneOfId("tk_6386"), undefined, paneOfId("tk_side")]) {
    const h = await post(D1, A, "/api/chat", { channel: f.ch, thread: f.ts, text: "이거 다시 봐요", ...(pane ? { pane } : {}) }) as any;
    assert.equal(h.path, "/api/me/nodes/cmd", JSON.stringify(h));
    assert.equal(h.body.item, "window:lap1:ew_desk");
    assert.match(h.body.text, /이거 다시 봐요/);
    assert.equal(h.log.ch, "#6386 은행 거래 정리"); assert.equal(h.log.thread, undefined, "태스크 채널 글로 남음");
  }
});

test("접은 글 스레드 답: 첫 줄이 바뀌어 낡은 ts 여도 그 태스크로 · 끝이 98xxxx 인 보통 글 스레드는 그 글 스레드 그대로", async () => {
  const { db, D1 } = await desk();
  const at = NOW - 50 * 60_000, id = Number(log(db, A, "lap1:ew_wp", "작업자 첫 줄", at).lastInsertRowid), ts = tsOf(at, id);
  log(db, A, "lap1:ew_wp", "작업자 다음 줄", NOW - 45 * 60_000);
  const old = (await G(D1, NC)).messages[0].ts;
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "lap1:ew_wp", "chat", "첫 줄에 답", ts, NOW - 40 * 60_000);
  assert.notEqual((await G(D1, NC)).messages[0].ts, old, "첫 줄이 채널로 나가 ts 가 바뀜");
  assert.equal((await post(D1, A, "/api/chat", { channel: "primary", thread: old, text: "답" }) as any).path, "/api/me/nodes/cmd");
  const ats = NOW - 30 * 60_000;
  db.prepare("INSERT INTO board_log(id, owner, win, kind, text, at) VALUES (?,?,?,?,?,?)").run(985123, A, "lap1:ew_desk", "chat", "보통 담당 글", ats);
  await G(D1, NC);
  const h = await post(D1, A, "/api/chat", { channel: "n:#6386 은행 거래 정리", thread: tsOf(ats, 985123), text: "답", pane: paneOfId("tk_6386") }) as any;
  assert.equal(h.log.thread, tsOf(ats, 985123), "보통 글 스레드에 남음");
});

test("뿌리가 최근 장부 창 밖으로 밀린 스레드 답: 사람 답은 채널 글로 · 작업자 답은 접은 글로 — 어디서든 보임", async () => {
  const { db, D1, call } = await seed();
  win(db, A, "lap1:ew_side", "번호 없는 일 담당", "session:claude:s");
  win(db, A, "lap1:ew_sidew", "번호 없는 일 작업자", "session:claude:w");
  win(db, A, "lap1:other2", "다른 일", "session:claude:o");
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  await call("POST", "/api/device/tasks/attach", { node: "tk_side", item: "window:lap1:ew_side" });
  const at = NOW - 6 * H, id = Number(log(db, A, "lap1:ew_sidew", "옛 작업자 보고", at).lastInsertRowid), ts = tsOf(at, id);
  for (let i = 0; i < 598; i++) log(db, A, "lap1:other2", "다른 일 " + i, NOW - 5 * H + i);
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "번호 없는 일", "me", "사람 답", ts, NOW - 60_000);
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "lap1:ew_sidew", "chat", "작업자 답", ts, NOW - 30_000);
  db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?, 'window:lap1:ew_sidew', 'tk_side', 'pin') ON CONFLICT(owner, item) DO UPDATE SET node = 'tk_side'").run(A);
  const nc = await G(D1, "/api/nodechat?w=" + encodeURIComponent("번호 없는 일")), texts = nc.messages.map((m: any) => m.text);
  assert.ok(texts.includes("사람 답"), JSON.stringify(texts));
  const f = await G(D1, "/api/chat/primary/" + nc.messages[0].ts);
  assert.deepEqual(f.messages.slice(1).map((m: any) => m.text), ["옛 작업자 보고", "작업자 답"]);
});

test("저장소#번호: 저장소가 다르면 거절(404) — 같은 저장소 · 원문 저장소가 있는 업무만, 저장소를 모르면 거절", async () => {
  const { db, call } = await seed();
  assert.equal((await call("POST", "/api/device/tasks", { tasks: [{ key: "lib77", name: "라이브러리 일", issue: "example-org/lib#77", state: "working" }] })).status, 200);
  const w = (task: unknown, ref: string) => call("POST", "/api/device/tasks/convo", { task, rows: [row(ref, NOW)] });
  assert.equal((await w("other-org/other#6386", "a")).status, 404, "다른 저장소의 같은 번호");
  assert.equal((await w("example-org/lib#6386", "b")).status, 404);
  assert.equal((await w("example-org/app#6386", "c")).status, 200);
  assert.equal((await w("Example-Org/App#6386", "d")).status, 200, "대소문자는 같은 저장소");
  assert.equal((await w("example-org/lib#77", "e")).status, 200, "업무 원문 저장소");
  assert.equal((await w("example-org/app#77", "f")).status, 404, "번호가 같아도 원문 저장소가 다르면");
  assert.equal((await w("77", "g")).status, 200, "번호만이면 예전처럼");
  assert.equal((await call("GET", "/api/device/tasks/convo?task=" + encodeURIComponent("other-org/other#6386"))).status, 404);
  // 리포 설정이 없으면 번호만 있는 업무의 저장소를 모름 — 추정하지 않음
  db.prepare("UPDATE node_setting SET data = ? WHERE owner = ?").run(JSON.stringify({ unit: "agent", task_channels: true }), A);
  assert.equal((await w("example-org/app#6386", "h")).status, 404);
  assert.equal((await w("6386", "i")).status, 200);
});

test("예약 접두(board_log: · card:) src_ref 는 API 에서 거절 — 진짜 보드 줄을 가리지 못함", async () => {
  const { db, D1, call } = await desk();
  const id = Number(log(db, A, "lap1:ew_desk", "진짜 담당 글", NOW - 60_000).lastInsertRowid);
  for (const ref of ["board_log:" + id, "card:1793300000.000001"]) assert.equal((await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [row(ref, NOW - 60_000, "agents", "가짜 글")] })).status, 400, ref);
  const nc = await G(D1, NC);
  assert.ok(nc.messages.some((m: any) => m.text === "진짜 담당 글"));
  assert.deepEqual((await rowsOf(call)).map(x => [x.layer, x.text]), [["human", "진짜 담당 글"]]);
});

test("같은 글이 보드 줄 · 기기 줄로: 화면엔 한 번(같은 층 · 5분 안). 표 · 읽기 API 엔 둘 다, 다른 글 · 먼 시각은 그대로", async () => {
  const { db, D1, call } = await desk();
  log(db, A, "lap1:ew_desk", "같은 글이에요", NOW - 60_000);
  log(db, A, "lap1:ew_wp", "작업자 같은 글", NOW - 60_000);
  await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [row("herdr:1", NOW - 60_000, "human", "같은 글이에요"), row("herdr:2", NOW - 50_000, "agents", "작업자 같은 글"), row("herdr:3", NOW - 2 * H, "human", "같은 글이에요"), row("herdr:4", NOW - 40_000, "human", "다른 글")] });
  const nc = await G(D1, NC), texts = nc.messages.map((m: any) => m.text);
  assert.equal(texts.filter((t: string) => t === "같은 글이에요").length, 2, "5분 안 사본만 빠짐 — 두 시간 전 글은 남음: " + JSON.stringify(texts));
  assert.ok(texts.includes("다른 글"));
  assert.equal(nc.messages[0].fold.agents, 1, "접은 글도 한 번");
  assert.equal((await rowsOf(call)).length, 6);
});

test("at 상한: 지금 + 하루 넘는 값은 거절 — 쪽 나눔 · 접은 글 ts 가 안 깨짐", async () => {
  const { call } = await seed();
  for (const at of [1e20, 9.9e15, NOW + 25 * H, new Date(NOW + 25 * H).toISOString(), String(NOW + 25 * H), Math.floor((NOW + 25 * H) / 1000)]) assert.equal((await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [{ ...row("x", 0), at }] })).status, 400, String(at));
  assert.equal((await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [{ ...row("soon", 0), at: NOW + H }] })).status, 200, "시계가 조금 빠른 기기는 받음");
  assert.equal((await rowsOf(call)).length, 1);
});

test("쓰기 몸통 한도: content-length 없이 2MB 넘어도 413(몸을 실제로 잼) · 아무것도 안 들어감", async () => {
  const { call } = await seed();
  const rows = Array.from({ length: 500 }, (_, i) => row("big" + i, NOW, "agents", "가".repeat(8000)));
  const r = await call("POST", "/api/device/tasks/convo", { task: "6386", rows });
  assert.equal(r.status, 413, await r.clone().text());
  assert.equal((await body(await call("GET", "/api/device/tasks/convo?task=6386&sync=0"))).rows.length, 0);
  const bad = await call("POST", "/api/device/tasks/convo", undefined); assert.equal(bad.status, 400, "빈 몸통은 400");
});

test("사람별 하루 줄 수 한도: 넘으면 429(남은 수) · 겹침은 한도를 안 먹음 · 보드 줄은 안 셈 · 남의 한도와 따로", async () => {
  const { db, call } = await seed();
  const fill = (owner: string, n: number, pre: string) => db.exec(`WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < ${n}) INSERT INTO task_convo(owner, task_id, layer, who, at, source, text, src_ref, created_at) SELECT '${owner}', '6386', 'agents', 'x', ${NOW}, 'herdr', 'x', '${pre}' || i, ${NOW} FROM c`);
  fill(A, 49_999, "old:");
  db.prepare("INSERT INTO task_convo(owner, task_id, layer, who, at, source, text, src_ref, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(A, "6386", "agents", "x", NOW, "board", "x", "board_log:1", NOW);   // 보드 줄은 안 셈
  const a = await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [row("n1", NOW), row("n2", NOW)] });
  assert.equal(a.status, 429); assert.deepEqual(await body(a), { error: "하루 상한", max_per_day: 50_000, left: 1 });
  assert.equal((await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [row("old:1", NOW), row("n1", NOW), row("n1", NOW)] })).status, 200, "겹침 · 한 요청 안 같은 키는 새 줄이 아님");
  assert.equal((await call("POST", "/api/device/tasks/convo", { task: "7001", rows: [row("b1", NOW)] }, { dev: B })).status, 200, "남의 한도와 따로");
});

test("글 고침 · 옮김이 표에 따라옴", async () => {
  const { db, D1, call } = await desk();
  const at = NOW - 30 * 60_000, id = Number(log(db, A, "#6386 은행 거래 정리", "처음 글", at, "me").lastInsertRowid);
  win(db, A, "lap1:ew_side", "번호 없는 일 창", "session:claude:s");
  await call("POST", "/api/device/tasks/attach", { node: "tk_side", item: "window:lap1:ew_side" });
  assert.deepEqual((await rowsOf(call)).map(x => x.text), ["처음 글"]);
  // 고침: 표 글도, 읽기 API 도 새 글
  const ed = await chatPost(D1, A, { edit: "고친 글", ts: tsOf(at, id) });
  assert.equal(ed!.status, 200);
  assert.deepEqual((await rowsOf(call)).map(x => x.text), ["고친 글"]);
  // 옮김: 몫 글을 다른 태스크로 → 옛 태스크 표에서 빠지고 새 태스크에 들어감
  db.prepare("INSERT INTO member_split(owner, root_ts, log_id, post_ts, node_id, at) VALUES (?,?,?,?,?,?)").run(A, "1793300000.000001", id, tsOf(at, id), "tk_6386", at);
  const mv = await splitMove(D1, A, tsOf(at, id), paneOfId("tk_side")) as any;
  assert.ok(mv.ok, JSON.stringify(mv));
  assert.deepEqual((await rowsOf(call)).map(x => x.text), [], "옛 태스크엔 없음");
  assert.deepEqual((await rowsOf(call, "side")).map(x => x.text), ["고친 글"], "새 태스크에");
});

test("채널 = 태스크를 끈 회원: 답 달린 줄 · 98 꼴 스레드 · 쓰기 길 모두 main 과 같음(접은 글 · 표 없음)", async () => {
  const { db, D1, call } = await desk();
  db.prepare("UPDATE node_setting SET data = ? WHERE owner = ?").run(JSON.stringify({ unit: "agent", task_repo: "example-org/app" }), A);
  const at = NOW - 50 * 60_000, id = Number(log(db, A, "lap1:ew_wp", "작업자 보고", at).lastInsertRowid), ts = tsOf(at, id);
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "lap1:ew_wp", "chat", "작업자 답", ts, NOW - 40 * 60_000);
  const nc = await G(D1, NC);
  assert.equal(nc.layers, undefined);
  assert.deepEqual(nc.messages.map((m: any) => [m.text, m.replies, m.fold]), [["작업자 보고", 1, undefined]]);
  assert.equal((db.prepare("SELECT count(*) n FROM task_convo").get() as any).n, 0, "노드 채팅을 열어도 표에 안 넣음");
  assert.deepEqual(await post(D1, A, "/api/chat", { channel: "primary", thread: "1793300000.985123", text: "답", pane: paneOfId("tk_6386") }), { error: "없는 스레드예요", status: 404 });
  assert.equal((await post(D1, A, "/api/chat", { channel: "primary", thread: "1793300000.985123", text: "답" }) as any).path, "/api/me/chat");
  assert.equal((await rowsOf(call)).length, 2, "API 를 부르면 맞춰 넣음(팀 PR 그대로 — API 는 설정과 상관없음)");
});

// 껍데기(shell.js) 접은 글 표시: 서버가 준 표시(fold.agents)로만, 글 목록 DOM 은 안 건드림(patchKids 가 새로고침마다 빼고 다시 붙이지 않게)
const SHELL = readFileSync(new URL("./legacy/shell.js", import.meta.url), "utf8"), PAINT = SHELL.slice(SHELL.indexOf("(() => {\n  let q = 0, on = ''"));
function paintRun(messages: any[], D: any = { task_side: [] }) {
  const feedOps: string[] = [], css: { id?: string; textContent?: string }[] = []; let fire = () => {};
  const fake = (ts: string) => ({ dataset: { mts: ts }, classList: { add: (c: string) => feedOps.push(`class ${ts} ${c}`), contains: () => false }, nextElementSibling: null, after: () => feedOps.push(`after ${ts}`) });
  const document = {
    querySelectorAll: () => messages.map(m => fake(m.ts)), createElement: () => ({}), getElementById: (id: string) => css.find(x => x.id === id) || null,
    head: { append: (e: any) => css.push(e) }, body: {},
  };
  class MO { constructor(f: () => void) { fire = f; } observe() {} }
  new Function("document", "D", "CS", "window", "MutationObserver", "requestAnimationFrame", PAINT)(document, D, { at: "n:일", ch: { "n:일": { messages } } }, { HB_MEMBER: { name: "지어낸 이름" } }, MO, (f: () => void) => { f(); return 1; });
  fire();
  return { feedOps, css, again: fire };
}
test("접은 글 표시: ts 끝이 98xxxx 인 보통 글엔 안 붙음 — 서버 표시(fold.agents)가 있는 글에만", () => {
  const plain = paintRun([{ ts: "1793000000.985123", text: "보통 글" }]);
  assert.deepEqual(plain.feedOps, [], "보통 글에 상자 · 이름표 없음");
  assert.equal(plain.css.length, 0);
  const on = paintRun([{ ts: "1793000000.980001", text: "에이전트끼리 2", fold: { agents: 2 } }, { ts: "1793000000.985123", text: "보통 글" }]);
  assert.equal(on.css.length, 1);
  assert.match(on.css[0].textContent!, /data-mts="1793000000\.980001"/);
  assert.ok(!on.css[0].textContent!.includes("985123"));
  assert.match(on.css[0].textContent!, /지어낸 이름님 ↔ 에이전트/);
  // 들여온 대화 접은 글(fold.sessions)은 아님
  assert.equal(paintRun([{ ts: "1793000000.990001", fold: { sessions: 1, threads: 0 } }]).css.length, 0);
});
test("이름표는 글 목록의 형제가 아님: 글 DOM 을 안 바꾸고 head 의 style 한 줄로 — 새로고침(몇 번을 그려도) 그대로", () => {
  const r = paintRun([{ ts: "1793000000.980001", fold: { agents: 2 } }]);
  assert.deepEqual(r.feedOps, [], "글 목록 안 바꿈 — patchKids 가 볼 것이 없음");
  r.again(); r.again();
  assert.equal(r.css.length, 1, "다시 그려도 style 하나");
});
test("설정 없는 회원 · 주인(D.task_side 없음): 껍데기 아무것도 안 함", () => {
  const r = paintRun([{ ts: "1793000000.980001", fold: { agents: 2 } }], {});
  assert.deepEqual([r.feedOps, r.css], [[], []]);
});

const FAKE = { gh: "gh" + "p_" + "a1B2".repeat(10), sk: "sk" + "-ant-" + "x9Y8".repeat(8), kv: "API_" + "TOKEN=" + "z7".repeat(12) };
const CH = (n = "#6386 은행 거래 정리") => "/api/chat/" + encodeURIComponent("n:" + n) + "/";
const nameSide = "번호 없는 일";

test("담당 창이 없는 태스크(창이 다 닫힘): 그 줄은 human — 접힘 안으로 안 들어가고 채널에 보임", async () => {
  const { db, D1, call } = await desk();
  log(db, A, "lap1:ew_wp", "닫히기 전 작업자 보고", NOW - 30 * 60_000);
  await G(D1, NC);   // 담당 창이 있을 때 넣은 줄은 그때 층 그대로
  db.prepare("DELETE FROM imp_item WHERE owner = ?").run(A);
  db.prepare("DELETE FROM mnode_item WHERE owner = ?").run(A);
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  db.prepare("UPDATE mnode SET counts = '{}' WHERE owner = ? AND id = 'tk_6386'").run(A);
  log(db, A, "#6386 은행 거래 정리", "창 없을 때 사람 글", NOW - 20 * 60_000, "me");
  db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?, 'win:lap1:gone', 'tk_6386', 'pin')").run(A);
  log(db, A, "lap1:gone", "창 없이 온 최종 답", NOW - 10 * 60_000, "reply");
  const r = await rowsOf(call);
  assert.deepEqual(r.filter(x => x.text !== "닫히기 전 작업자 보고").map(x => [x.layer, x.text]), [["human", "창 없을 때 사람 글"], ["human", "창 없이 온 최종 답"]]);
  assert.equal(r.find(x => x.text === "닫히기 전 작업자 보고").layer, "agents");
  assert.ok((await G(D1, NC)).messages.some((m: any) => m.text === "창 없이 온 최종 답"));
});

test("기기 줄 비밀 가림: 표 · 읽기 API · 채널 · 접은 글 어디에도 원문 없음 · 고른 낱말과 키는 그대로", async () => {
  const { db, D1, call } = await desk();
  const w = await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [
    { layer: "human", who: "담당 " + FAKE.sk, at: NOW - 60_000, source: "herdr", text: `토큰은 ${FAKE.gh} 이에요`, src_ref: "herdr:s1" },
    { layer: "agents", who: "작업자", at: NOW - 50_000, source: "herdr", text: `설정 ${FAKE.kv}\n키 ${FAKE.sk}`, src_ref: "herdr:s2" },
  ] });
  assert.equal(w.status, 200, await w.clone().text());
  const stored = db.prepare("SELECT who, text, src_ref FROM task_convo WHERE owner = ? ORDER BY id").all(A) as any[];
  const hay = JSON.stringify(stored);
  for (const v of Object.values(FAKE)) assert.ok(!hay.includes(v), "표에 원문: " + hay);
  assert.equal(stored[0].text, "토큰은 [secret] 이에요");
  assert.deepEqual(stored.map(r => r.src_ref), ["herdr:s1", "herdr:s2"], "키는 안 가림(겹침 막는 표지)");
  const api = JSON.stringify(await rowsOf(call)), nc = await G(D1, NC), f = await G(D1, "/api/chat/primary/" + nc.messages[0].ts);
  for (const out of [api, JSON.stringify(nc), JSON.stringify(f)]) for (const v of Object.values(FAKE)) assert.ok(!out.includes(v), out);
  // 회원 길도 같은 입구
  await call("POST", "/api/me/tasks/convo", { task: "6386", rows: [row("m:s", NOW - 40_000, "human", "값 " + FAKE.gh)] }, { member: A, same: true });
  assert.ok(!JSON.stringify(db.prepare("SELECT text FROM task_convo").all()).includes(FAKE.gh));
});

test("채널에 글로 나온 기기 줄: 스레드가 열리고 답글은 담당 창으로(404 아님) · 끈 회원은 예전 그대로", async () => {
  const { db, D1, call } = await desk();
  await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [row("herdr:h", NOW - 60_000, "human", "기기가 넣은 사람 쪽 글")] });
  const m = (await G(D1, NC)).messages.find((x: any) => x.text === "기기가 넣은 사람 쪽 글");
  assert.match(m.ts, /\.97\d{4}$/);
  const th = await G(D1, CH() + m.ts);
  assert.deepEqual(th.messages.map((x: any) => x.text), ["기기가 넣은 사람 쪽 글"], "빈 스레드가 아님");
  const h = await post(D1, A, "/api/chat", { channel: m.ch, thread: m.ts, text: "이거 봐요", pane: paneOfId("tk_6386") }) as any;
  assert.equal(h.path, "/api/me/nodes/cmd", JSON.stringify(h));
  assert.equal(h.body.item, "window:lap1:ew_desk");
  assert.match(h.body.text, /이거 봐요/);
  assert.equal(h.log.ch, "#6386 은행 거래 정리"); assert.equal(h.log.thread, undefined, "채널 글로 남음 — 사라지지 않음");
  assert.equal((await post(D1, A, "/api/chat", { channel: m.ch, thread: m.ts, text: "둘째" }) as any).path, "/api/me/nodes/cmd");
  // 모르는 ts 는 예전처럼 404(글이 조용히 다른 데로 가지 않음)
  assert.deepEqual(await post(D1, A, "/api/chat", { channel: m.ch, thread: "1793300000.970001", text: "x", pane: paneOfId("tk_6386") }), { error: "없는 스레드예요", status: 404 });
  // 끈 회원: 그 ts 도 main 과 같음
  db.prepare("UPDATE node_setting SET data = ? WHERE owner = ?").run(JSON.stringify({ unit: "agent", task_repo: "example-org/app" }), A);
  assert.deepEqual((await G(D1, CH() + m.ts)).messages, []);
  assert.deepEqual(await post(D1, A, "/api/chat", { channel: m.ch, thread: m.ts, text: "x", pane: paneOfId("tk_6386") }), { error: "없는 스레드예요", status: 404 });
});

async function pushed() {
  const s = await seed();
  win(s.db, A, "lap1:ew_side", "번호 없는 일 담당", "session:claude:s");
  win(s.db, A, "lap1:ew_sidew", "번호 없는 일 작업자", "session:claude:w");
  win(s.db, A, "lap1:other2", "다른 일", "session:claude:o");
  await regroup({ DB: s.D1, PUBLIC_URL: "https://example.test" } as never, A);
  await s.call("POST", "/api/device/tasks/attach", { node: "tk_side", item: "window:lap1:ew_side" });
  s.db.prepare("INSERT INTO mnode_item(owner, item, node, how) VALUES (?, 'window:lap1:ew_sidew', 'tk_side', 'pin') ON CONFLICT(owner, item) DO UPDATE SET node = 'tk_side'").run(A);
  const at = NOW - 6 * H, id = Number(log(s.db, A, "lap1:ew_sidew", "옛 작업자 보고", at).lastInsertRowid), ts = tsOf(at, id);
  for (let i = 0; i < 599; i++) log(s.db, A, "lap1:other2", "다른 일 " + i, NOW - 5 * H + i);
  s.db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, nameSide, "me", "사람 답", ts, NOW - 60_000);
  return { ...s, root: { id, ts } };
}

test("뿌리가 밀린 사람 답에 답글: 그 뿌리 스레드가 열리고 답글은 그 스레드로 · 담당 창으로", async () => {
  const { D1, root } = await pushed();
  const m = (await G(D1, "/api/nodechat?w=" + encodeURIComponent(nameSide))).messages.find((x: any) => x.text === "사람 답");
  assert.ok(m);
  const th = await G(D1, CH(nameSide) + m.ts);
  assert.deepEqual(th.messages.map((x: any) => x.text), ["옛 작업자 보고", "사람 답"], "뿌리 + 답");
  const h = await post(D1, A, "/api/chat", { channel: m.ch, thread: m.ts, text: "다시 답", pane: paneOfId("tk_side") }) as any;
  assert.equal(h.path, "/api/me/nodes/cmd", JSON.stringify(h));
  assert.equal(h.body.item, "window:lap1:ew_side");
  assert.equal(h.log.thread, root.ts, "뿌리 스레드에 남음");
  assert.ok(h.body.text.includes(root.ts), "창이 그 스레드로 답하게 머리에 뿌리");
});

test("뿌리가 지워진 답 줄에 답글: 그 줄 하나로 열리고 답글은 채널 글로", async () => {
  const { db, D1, root } = await pushed();
  db.prepare("DELETE FROM board_log WHERE id = ?").run(root.id);
  const m = (await G(D1, "/api/nodechat?w=" + encodeURIComponent(nameSide))).messages.find((x: any) => x.text === "사람 답");
  assert.deepEqual((await G(D1, CH(nameSide) + m.ts)).messages.map((x: any) => x.text), ["사람 답"]);
  const h = await post(D1, A, "/api/chat", { channel: m.ch, thread: m.ts, text: "다시 답" }) as any;
  assert.equal(h.path, "/api/me/nodes/cmd", JSON.stringify(h));
  assert.equal(h.log.thread, undefined);
});

test("표가 600줄을 넘어도: 수는 실제 줄 수 · 접은 글 ts 는 새 줄에 안 바뀜 · 낡은 ts 도 열림", async () => {
  const { db, D1, call } = await desk();
  db.exec(`WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 651) INSERT INTO task_convo(owner, task_id, layer, who, at, source, text, src_ref, created_at) SELECT '${A}', '6386', 'agents', '작업자', ${NOW - 3 * H} + i * 1000, 'herdr', '줄 ' || i, 'old:' || i, ${NOW} FROM c`);
  const a = await G(D1, NC);
  assert.ok(a.messages[0].text.startsWith("에이전트끼리 651"), a.messages[0].text);
  assert.equal(a.messages[0].replies, 651); assert.equal(a.messages[0].fold.agents, 651);
  assert.deepEqual(a.layers, { human: 0, agents: 651 });
  await call("POST", "/api/device/tasks/convo", { task: "6386", rows: [row("new:1", NOW - 60_000)] });
  const b = await G(D1, NC);
  assert.equal(b.messages[0].ts, a.messages[0].ts, "새 줄이 와도 열어 둔 칸의 ts 그대로");
  assert.ok(b.messages[0].text.startsWith("에이전트끼리 652"));
  assert.ok((await G(D1, "/api/chat/primary/" + a.messages[0].ts)).messages.length > 1);
});

test("낡은 접은 글 ts 읽기: 첫 줄이 채널로 나가 ts 가 바뀌어도 열어 둔 칸이 안 빔 · 뿌리 ts 는 부른 ts", async () => {
  const { db, D1 } = await desk();
  const at = NOW - 50 * 60_000, id = Number(log(db, A, "lap1:ew_wp", "작업자 첫 줄", at).lastInsertRowid);
  log(db, A, "lap1:ew_wp", "작업자 다음 줄", NOW - 45 * 60_000);
  const old = (await G(D1, NC)).messages[0].ts;
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "lap1:ew_wp", "chat", "첫 줄에 답", tsOf(at, id), NOW - 40 * 60_000);
  assert.notEqual((await G(D1, NC)).messages[0].ts, old);
  const th = await G(D1, "/api/chat/primary/" + old);
  assert.equal(th.root, old);
  assert.equal(th.messages[0].ts, old);
  assert.deepEqual(th.messages.slice(1).map((m: any) => m.text), ["작업자 다음 줄"]);
  assert.ok(th.messages.slice(1).every((m: any) => m.thread === old));
  // 태스크에 없던 시각의 98 꼴 ts 는 이 태스크 접은 글이 아님(같은 해시 · 지어낸 ts)
  assert.deepEqual((await G(D1, "/api/chat/primary/1700000000." + old.slice(-6))).messages, []);
});

test("내 Primary 글의 ts 끝이 태스크 해시와 같아도: 답은 Primary 스레드로 · 읽기도 그 글", async () => {
  const { db, D1 } = await desk();
  log(db, A, "lap1:ew_wp", "작업자 보고", NOW - 50 * 60_000);
  const tail = (await G(D1, NC)).messages[0].ts.split(".")[1];
  const at = NOW - 10 * 60_000, ts = tsOf(at, Number(tail));
  db.prepare("INSERT INTO board_log(id, owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?,?)").run(Number(tail), A, "나", "chat", "내 Primary 글", "primary", at);
  const h = await post(D1, A, "/api/chat", { channel: "primary", thread: ts, text: "그 글에 답" }) as any;
  assert.equal(h.path, "/api/me/chat", JSON.stringify(h));
  assert.equal(h.body.thread, ts);
  assert.deepEqual((await G(D1, "/api/chat/primary/" + ts)).messages.map((m: any) => m.text), ["내 Primary 글"]);
});

test("화면이 읽은 뒤 사람이 글을 지우면: 늦게 도는 맞춰 넣기가 지운 글을 표에 되살리지 않음 · 고친 글 · 옮긴 글도", async () => {
  const { db, D1 } = await desk();
  const { load } = await import("./member-board.ts");
  const at = NOW - 30 * 60_000;
  const gone = Number(log(db, A, "#6386 은행 거래 정리", "지울 글 " + FAKE.gh, at, "me").lastInsertRowid);
  const edit = Number(log(db, A, "#6386 은행 거래 정리", "고칠 글", at + 1000, "me").lastInsertRowid);
  log(db, A, "lap1:ew_wp", "그대로인 글", at + 2000);
  const L0 = await load(D1, A);
  assert.ok("ok" in (await post(D1, A, "/api/chat", { delete: true, ts: tsOf(at, gone) }) as any));   // 그 사이 지움(표엔 아직 없음)
  db.prepare("UPDATE board_log SET text = '고친 뒤' WHERE id = ?").run(edit);   // 그 사이 고침
  await syncTaskConvo(D1, A, "tk_6386", L0);   // 늦게 넣기
  const all = db.prepare("SELECT text FROM task_convo WHERE owner = ?").all(A).map((x: any) => x.text);
  assert.deepEqual(all, ["그대로인 글"], "지운 글 · 낡은 글 없음");
  await syncTaskConvo(D1, A, "tk_6386");   // 다음 읽기가 새 글로
  assert.deepEqual(db.prepare("SELECT text FROM task_convo WHERE owner = ? ORDER BY at").all(A).map((x: any) => x.text), ["고친 뒤", "그대로인 글"]);
  let inserts = 0; const spy = { ...D1, batch: async (ss: any[]) => { inserts += ss.filter(x => /INSERT INTO task_convo/.test(x.sql)).length; return (D1 as any).batch(ss); } } as unknown as D1Database;
  const again = await syncTaskConvo(spy, A, "tk_6386");
  assert.equal(inserts, 0); assert.equal(again.added, 0); assert.ok(again.dup >= 2);
  assert.deepEqual(db.prepare("SELECT text FROM task_convo WHERE owner = ? ORDER BY at").all(A).map((x: any) => x.text), ["고친 뒤", "그대로인 글"]);
});

test("접은 글 안 줄의 반응이 스레드에 보임 · 장부 창 밖으로 밀린 보드 줄도 반응을 닮", async () => {
  const { db, D1 } = await desk();
  const at = NOW - 50 * 60_000, id = Number(log(db, A, "lap1:ew_wp", "작업자 보고", at).lastInsertRowid);
  const ed = await chatPost(D1, A, { react: "eyes", ts: tsOf(at, id) });
  assert.equal(ed!.status, 200);
  const th = await G(D1, "/api/chat/primary/" + (await G(D1, NC)).messages[0].ts), line = th.messages.find((m: any) => m.text === "작업자 보고");
  assert.deepEqual(line.reactions, [{ name: "eyes", count: 1, mine: true }]);
  win(db, A, "lap1:other3", "다른 일", "session:claude:o");
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  await G(D1, NC);
  for (let i = 0; i < 600; i++) log(db, A, "lap1:other3", "다른 일 " + i, NOW - 40 * 60_000 + i);
  const th2 = await G(D1, "/api/chat/primary/" + (await G(D1, NC)).messages[0].ts), l2 = th2.messages.find((m: any) => m.text === "작업자 보고");
  assert.equal(l2.ts, tsOf(at, id)); assert.deepEqual(l2.reactions, [{ name: "eyes", count: 1, mine: true }]);
});

test("작업자 글에 옆 태스크 창이 답함: 뿌리가 접히지 않고 답글 수와 채널에 남음 — 답이 어느 화면에도 안 보이던 길", async () => {
  const { db, D1, call } = await desk();
  win(db, A, "lap1:ew_side", "번호 없는 일 담당", "session:claude:s");
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  await call("POST", "/api/device/tasks/attach", { node: "tk_side", item: "window:lap1:ew_side" });
  await call("POST", "/api/device/tasks/attach", { node: "tk_6386", item: "window:lap1:ew_desk" });
  const at = NOW - 2 * H, id = Number(log(db, A, "lap1:ew_wp", "작업자 글", at).lastInsertRowid), ts = tsOf(at, id);
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, "lap1:ew_side", "chat", "옆 태스크가 단 답", ts, NOW - 60_000);
  const root = (await G(D1, NC)).messages.find((m: any) => m.text === "작업자 글");
  assert.ok(root, "뿌리가 채널에 있음");
  assert.equal(root.replies, 1);
});

test("태스크 창이 옆 노드 글 스레드에 쓴 답: 옆 스레드에만(내 채널 · 접은 글에 안 나옴) — 뿌리가 장부 창 안이어도 밖이어도", async () => {
  const { db, D1, call } = await desk();
  win(db, A, "lap1:ew_side", "번호 없는 일 담당", "session:claude:s");
  win(db, A, "lap1:other4", "다른 일", "session:claude:o");
  await regroup({ DB: D1, PUBLIC_URL: "https://example.test" } as never, A);
  await call("POST", "/api/device/tasks/attach", { node: "tk_side", item: "window:lap1:ew_side" });
  await call("POST", "/api/device/tasks/attach", { node: "tk_6386", item: "window:lap1:ew_desk" });
  const at = NOW - 6 * H, id = Number(log(db, A, "lap1:ew_side", "옆 노드 글", at).lastInsertRowid), ts = tsOf(at, id);
  const reply = (w: string, t: string, when: number) => db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(A, w, "chat", t, ts, when);
  reply("lap1:ew_desk", "담당이 옆에 쓴 답", NOW - 60_000);
  reply("lap1:ew_wp", "작업자가 옆에 쓴 답", NOW - 50_000);
  const see = async () => { const nc = await G(D1, NC), t = JSON.stringify(nc.messages.map((m: any) => m.text)); assert.ok(!t.includes("옆에 쓴 답"), t); assert.ok(!(nc.messages[0]?.fold?.agents), "접은 글에도 없음"); };
  await see();
  assert.deepEqual((await G(D1, CH(nameSide) + ts)).messages.map((m: any) => m.text), ["옆 노드 글", "담당이 옆에 쓴 답", "작업자가 옆에 쓴 답"]);
  for (let i = 0; i < 598; i++) log(db, A, "lap1:other4", "다른 일 " + i, NOW - 5 * H + i);
  await see();
});
