import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const MB = await import("./member-board.ts");
const A = "a@example.com", B = "b@example.com";
const MIG = new URL("../migrations/", import.meta.url);
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const now = Date.now();
  const node = (o: string, id: string, name: string, area: string) => db.prepare("INSERT INTO mnode(owner, id, name, area, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(o, id, name, area, "working", now, now);
  node(A, "n_a1", "기획 팀장", "기획"); node(A, "n_a2", "분기 보고", "기획"); node(A, "n_a3", "개발 리드", "개발"); node(A, "n_a4", "화면 고치기", "개발");
  node(B, "n_b1", "남의 노드", "기획");
  const exec = (sql: string, args: unknown[]) => { const st = db.prepare(sql); if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } }; const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } }; };
  const stmt = (sql: string, args: unknown[] = []): any => ({ sql, args, bind: (...a: unknown[]) => stmt(sql, a), first: async () => (exec(sql, args).results[0] ?? null), all: async () => exec(sql, args), run: async () => exec(sql, args) });
  const D1 = { prepare: (sql: string) => stmt(sql), batch: async (ss: { sql: string; args: unknown[] }[]) => ss.map(s => exec(s.sql, s.args)) } as unknown as D1Database;
  return { db, D1 };
}
const col = (d: any, name: string) => d.areas.find((a: any) => a.name === name);

test("열 머리 기본 얼굴: 열 이름에서 정함 — 같은 이름은 같은 얼굴(회원이 달라도), 머리 판에도 같은 값", async () => {
  const { D1 } = setup();
  const d1 = await MB.data(D1, A, { name: "모찌" }), d2 = await MB.data(D1, A, { name: "모찌" });
  const tax = col(d1, "기획"), dev = col(d1, "개발");
  assert.ok(tax && dev, "열 둘");
  assert.deepEqual(tax.avatar, MB.faceOf("기획"));
  assert.deepEqual(col(d2, "기획").avatar, tax.avatar);   // 다시 읽어도 같음
  assert.deepEqual(MB.faceOf("기획"), MB.faceOf(" 기획 "));
  assert.match(tax.avatar.seed, /^[A-Za-z0-9 _-]{1,40}$/); assert.ok(Number.isInteger(tax.avatar.hue));
  assert.equal(tax.avatar.photo, undefined);
  assert.deepEqual(d1.panes.find((p: any) => p.pane === tax.lead).avatar, tax.avatar);
  // 이름이 다르면 대개 다른 얼굴(여럿 중 하나라도 다름)
  assert.ok(["기획", "개발", "영업", "회계", "디자인"].map(n => JSON.stringify(MB.faceOf(n))).some(x => x !== JSON.stringify(tax.avatar)));
});

test("노드 얼굴 고르기: 저장 → 열 머리 · 판에 고른 얼굴, 다른 설정 칸 그대로, 판 번호로도, 되돌리면 기본", async () => {
  const { db, D1 } = setup();
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ unit: "goal", pri: { "분기 보고": { pri: "급함" } } }), 1);
  const face = { seed: "nova", hue: 215, photo: "0123456789abcdef0123456789abcdef" };
  const r = await MB.setNodeFace(D1, A, "n_a1", face);
  assert.ok("ok" in r && r.node === "n_a1");
  let d = await MB.data(D1, A, null);
  assert.deepEqual(col(d, "기획").avatar, face);
  assert.deepEqual(d.panes.find((p: any) => p.win === "기획 팀장").avatar, face);
  const set = JSON.parse((db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(A) as any).data);
  assert.equal(set.unit, "goal"); assert.equal(set.pri["분기 보고"].pri, "급함");   // 다른 칸 그대로
  assert.equal(d.panes.find((p: any) => p.win === "분기 보고").pri, "급함");
  const pane = MB.paneOfId("n_a4");
  await MB.setNodeFace(D1, A, pane, { seed: "kiwi", hue: 0 });
  d = await MB.data(D1, A, null);
  assert.deepEqual(d.panes.find((p: any) => p.win === "화면 고치기").avatar, { seed: "kiwi", hue: 0 });
  assert.deepEqual(col(d, "개발").avatar, MB.faceOf("개발"));   // 다른 열 머리는 기본 그대로
  const list = await MB.nodeFaceList(D1, A, null);
  assert.deepEqual(list.filter(x => x.head).map(x => x.name).sort(), ["개발 리드", "기획 팀장"]);
  assert.equal(list.find(x => x.name === "기획 팀장")!.custom, true); assert.equal(list.find(x => x.name === "개발 리드")!.custom, false);
  // 되돌리기
  await MB.setNodeFace(D1, A, "n_a1", null);
  d = await MB.data(D1, A, null);
  assert.deepEqual(col(d, "기획").avatar, MB.faceOf("기획"));
  // 설정 줄이 없던 회원도 새로 만듦(얼굴 칸만)
  const { db: db2, D1: D2 } = setup();
  await MB.setNodeFace(D2, B, "n_b1", { seed: "luma", hue: 45 });
  assert.deepEqual(JSON.parse((db2.prepare("SELECT data FROM node_setting WHERE owner = ?").get(B) as any).data).faces.n_b1, { seed: "luma", hue: 45 });
});

test("남의 노드 · 없는 노드엔 얼굴을 못 정함, 틀린 값은 버림", async () => {
  const { db, D1 } = setup();
  assert.deepEqual(await MB.setNodeFace(D1, A, "n_b1", { seed: "nova", hue: 18 }), { error: "없는 노드예요", status: 404 });
  assert.deepEqual(await MB.setNodeFace(D1, A, MB.paneOfId("n_b1"), { seed: "nova", hue: 18 }), { error: "없는 노드예요", status: 404 });
  assert.deepEqual(await MB.setNodeFace(D1, A, "n_zz", { seed: "nova", hue: 18 }), { error: "없는 노드예요", status: 404 });
  assert.equal(db.prepare("SELECT data FROM node_setting WHERE owner = ?").get(A), undefined);
  const before = col(await MB.data(D1, B, null), "기획");   // B 는 열이 하나라 열 머리 없음 — 판에 고른 얼굴 없음
  assert.equal(before, undefined);
  assert.equal((await MB.data(D1, B, null)).panes.some((p: any) => p.kind === "lead" && p.avatar), false);
  assert.equal(MB.cleanFace({ seed: "<script>", hue: 10 }), null);
  assert.equal(MB.cleanFace({ seed: "nova", hue: 400 }), null);
  assert.equal(MB.cleanFace({ seed: "nova", hue: 10, photo: "../x" }), null);
  // 저장된 틀린 값은 그리지 않고 기본 얼굴
  db.prepare("INSERT INTO node_setting(owner, data, updated_at) VALUES (?,?,?)").run(A, JSON.stringify({ faces: { n_a1: { seed: "<b>", hue: 1 } } }), 1);
  assert.deepEqual(col(await MB.data(D1, A, null), "기획").avatar, MB.faceOf("기획"));
});

test("메인 봇 = Primary 얼굴: member_bot 의 고른 얼굴, 없으면 봇 이름 얼굴", async () => {
  const { db, D1 } = setup();
  let d = await MB.data(D1, A, { name: "모찌" });
  assert.deepEqual(d.areas[0].avatar, MB.faceOf("모찌"));
  assert.deepEqual(d.panes[0].avatar, MB.faceOf("모찌"));
  db.prepare("INSERT INTO member_bot(owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(A, "tofu", 265, "모찌", "", "a".repeat(32), "b".repeat(32), 1);
  d = await MB.data(D1, A, { name: "모찌" });
  assert.deepEqual(d.areas[0].avatar, { seed: "tofu", hue: 265 });
  assert.deepEqual(d.panes.find((p: any) => p.kind === "primary").avatar, { seed: "tofu", hue: 265 });
  // index.ts 는 고른 봇 줄(Bot)을 그대로 넘김 — 그 값이 먼저
  d = await MB.data(D1, A, { name: "모찌", seed: "echo", hue: 18, photo: "c".repeat(32) } as never);
  assert.deepEqual(d.areas[0].avatar, { seed: "echo", hue: 18, photo: "c".repeat(32) });
});

test("내 아바타는 메인 봇과 따로: 다른 줄(@me:<메일>), 보드 데이터 me_avatar, 남과 안 섞임", async () => {
  const { db, D1 } = setup();
  db.prepare("INSERT INTO member_bot(owner, seed, hue, name, photo, icon, fav, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(A, "tofu", 265, "모찌", "", "a".repeat(32), "b".repeat(32), 1);
  assert.equal(await MB.myAvatar(D1, A), null);
  assert.equal((await MB.data(D1, A, { name: "모찌" })).me_avatar, null);
  await MB.setMyAvatar(D1, A, { seed: "bean", hue: 140 });
  assert.deepEqual(await MB.myAvatar(D1, A), { seed: "bean", hue: 140 });
  const d = await MB.data(D1, A, { name: "모찌" });
  assert.deepEqual(d.me_avatar, { seed: "bean", hue: 140 });
  assert.deepEqual(d.areas[0].avatar, { seed: "tofu", hue: 265 });   // 메인 봇은 그대로
  const bot = db.prepare("SELECT seed, hue, name, icon FROM member_bot WHERE owner = ?").get(A) as any;
  assert.deepEqual({ ...bot }, { seed: "tofu", hue: 265, name: "모찌", icon: "a".repeat(32) });
  // 바꾸기 = 같은 줄 덮기, 사진
  await MB.setMyAvatar(D1, A, { seed: "bean", hue: 140, photo: "d".repeat(32) });
  assert.deepEqual(await MB.myAvatar(D1, A), { seed: "bean", hue: 140, photo: "d".repeat(32) });
  assert.equal((db.prepare("SELECT count(*) n FROM member_bot WHERE owner = ?").get(MB.meKey(A)) as any).n, 1);
  assert.equal(await MB.myAvatar(D1, B), null);
  assert.equal((await MB.data(D1, B, null)).me_avatar, null);
});
