// node --test --no-warnings --experimental-transform-types apps/web/worker/member-push.test.ts (Node 22.18+ · node:sqlite)
// 회원 웹 푸시 더하기: 할 일은 알림 안 감 · 한 브라우저 구독 주소는 한 회원 것(계정을 바꿔 켜면 옛 회원 칸 구독을 지움). 자료는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";

register("./test-hooks.mjs", import.meta.url);
const { claimEndpoint, releaseEndpoint, pushKind } = await import("./member-push.ts");
const { localTools } = await import("./local.ts");

const MIG = new URL("../migrations/", import.meta.url);
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => (db.prepare(sql).get(...(args as never[])) as unknown) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { db, D1: { prepare: (s: string) => stmt(s), batch: async (ss: any[]) => ss.map(s => ({ results: db.prepare(s.sql).all(...(s.args as never[])) })) } as unknown as D1Database };
}
const A = "a@example.com", B = "b@example.com", EP = "https://push.example/send/abc";

test("구독 주소: 처음 켠 회원 것으로 적음 · 같은 회원이 다시 켜면 아무것도 안 지움 · 다른 회원이 켜면 옛 회원 칸 구독을 지움", async () => {
  const { D1, db } = fakeD1(), gone: string[] = [];
  const unsub = async (o: string) => { gone.push(o); };
  assert.equal(await claimEndpoint(D1, A, EP, unsub), null);
  assert.equal(await claimEndpoint(D1, A, EP, unsub), null);
  assert.deepEqual(gone, []);
  assert.equal(await claimEndpoint(D1, B, EP, unsub), A);
  assert.deepEqual(gone, [A]);
  assert.deepEqual({ ...(db.prepare("SELECT owner FROM member_push_ep WHERE endpoint = ?").get(EP) as object) }, { owner: B });
});

test("구독을 끄면 내 줄만 지움(남의 줄은 그대로)", async () => {
  const { D1, db } = fakeD1();
  await claimEndpoint(D1, B, EP, async () => {});
  await releaseEndpoint(D1, A, EP);
  assert.equal((db.prepare("SELECT count(*) n FROM member_push_ep").get() as { n: number }).n, 1);
  await releaseEndpoint(D1, B, EP);
  assert.equal((db.prepare("SELECT count(*) n FROM member_push_ep").get() as { n: number }).n, 0);
});

test("알림 카드 종류: 할 일만 빼고 보냄(결정 · 승인 · 질문 · 종류 모름 = 보냄), 에이전트 카드의 kind 가 알림 쪽에 넘어감", async () => {
  assert.deepEqual(["decision", "approval", "question", undefined, "todo"].map(pushKind), [true, true, true, true, false]);
  const { D1 } = fakeD1(), got: unknown[] = [];
  const run = localTools(D1, A, "일 창", "https://board.example", "", c => got.push(c.kind));
  await run("inbox_ask", { question: "할 일", choices: ["했어요"], kind: "todo" });
  await run("inbox_ask", { question: "결정", choices: ["A"] });
  assert.deepEqual(got, ["todo", "decision"]);
});
