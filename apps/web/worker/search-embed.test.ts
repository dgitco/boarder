import { test, mock, afterEach } from "node:test";
afterEach(() => mock.restoreAll());
import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./test-hooks.mjs", import.meta.url);
const { Search } = await import("./search.ts");

function mk(ai: { down: boolean; calls: number }, options: { db?: DatabaseSync; key?: string } = {}) {
  const db = options.db || new DatabaseSync(":memory:");
  const cur = (rows: unknown[], w = 0) => ({ toArray: () => rows, one: () => rows[0], rowsWritten: w, [Symbol.iterator]: () => rows[Symbol.iterator]() });
  const sql = {
    exec: (q: string, ...a0: unknown[]) => {
      const st = db.prepare(q), a = a0.map(x => x instanceof ArrayBuffer ? new Uint8Array(x) : x);   // DO SQL 은 ArrayBuffer 를 BLOB 으로 받음 — node:sqlite 는 Uint8Array 만
      if (/^\s*(select|pragma)/i.test(q) || /returning/i.test(q)) return cur(st.all(...(a as never[])));
      const r = st.run(...(a as never[])); return cur([], Number(r.changes));
    },
  };
  let alarmAt: number | null = null;
  const storage = { sql, getAlarm: async () => alarmAt, setAlarm: async (t: number) => { alarmAt = t; }, deleteAlarm: async () => { alarmAt = null; } };
  const AI = {
    run: async (_m: string, x: { text: string[] }) => {
      ai.calls++;
      if (ai.down) throw new Error("3040: Capacity temporarily exceeded, please try again.");
      // 글마다 다른 단위 벡터(첫 글자 코드로 칸을 고름)
      return { data: x.text.map(t => Array.from({ length: 1024 }, (_, i) => (i === t.charCodeAt(0) % 1024 ? 1 : 0.01))) };
    },
  };
  const s = new (Search as any)({ storage }, { AI, VOYAGE_API_KEY: options.key });
  // 가짜 시계: alarm() 을 부르면 예약 시각까지 시계가 흐른 것으로(줄마다 next_at 이 있어, 시계가 안 가면 다시 시도할 때가 안 됨)
  const realNow = Date.now.bind(Date); let off = 0; mock.method(Date, "now", () => realNow() + off);
  return { s, db, alarm: async () => { const at = alarmAt; if (at && at > Date.now()) off += at - Date.now(); alarmAt = null; await s.alarm(); return at; }, next: () => alarmAt };
}
const doc = (id: string, body: string) => ({ id, kind: "chat" as const, title: "", body, ch: "dgit", at: 1_793_300_000, emb: true });

test("AI 가 몇 분 막혀도(한도 · 일시 오류) 다시 열리면 기다리던 글이 뜻 색인에 들어감", async () => {
  const ai = { down: true, calls: 0 };
  const { s, alarm } = mk(ai);
  await s.upsert([doc("m:1", "회의록 서류철 다시 받기"), doc("m:2", "CMS 자동이체 신청")]);
  for (let i = 0; i < 8; i++) await alarm();   // 30초 × 8 ≈ 4분 막힘(예전엔 다섯 번째에 줄을 버림)
  assert.equal(s.state().vecs, 0);
  ai.down = false;
  for (let i = 0; i < 3; i++) await alarm();
  assert.deepEqual({ vecs: s.state().vecs, pending: s.state().pending }, { vecs: 2, pending: 0 }, "막힘이 풀린 뒤 두 글 모두 벡터가 있어야 함");
});

test("버려진 뒤에는 같은 글로 다시 올려도 되살아나지 않음 — 그래서 일시 막힘에 버리면 안 됨(위 시험의 까닭)", async () => {
  const ai = { down: true, calls: 0 };
  const { s, alarm } = mk(ai);
  await s.upsert([doc("m:1", "회의록 서류철 다시 받기")]);
  for (let i = 0; i < 8; i++) await alarm();
  ai.down = false;
  const r = await s.upsert([doc("m:1", "회의록 서류철 다시 받기")]);
  assert.equal(r.changed, 0, "sig 가 같아 건너뜀(정상)");
  await alarm();
  assert.equal(s.state().vecs, 1, "줄이 남아 있으면 막힘이 풀린 뒤 벡터가 생김");
});

test("계속 실패하는 글은 늘어나는 간격으로 다시 해보다(최대 1시간) 하루쯤 뒤 버림 — 무한히 30초마다 한도를 쓰지 않음", async () => {
  const ai = { down: true, calls: 0 };
  const { s, alarm, next } = mk(ai);
  await s.upsert([doc("m:1", "늘 실패하는 글")]);
  let total = 0, last = 0;
  for (let i = 0; i < 60 && s.state().pending; i++) {
    await alarm(); const t0 = Date.now();   // 시계는 alarm() 안에서 예약 시각으로 감 — 그 뒤에서 잼
    const at = next(); if (at === null) break;
    const gap = at - t0; assert.ok(gap >= last - 50 && gap <= 3_600_000 + 50, `간격은 줄지 않고 1시간을 넘지 않음 (${gap})`); last = gap; total += gap;
  }
  await alarm();
  assert.equal(s.state().pending, 0, "결국 버림");
  assert.ok(total >= 20 * 3600_000, `버리기 전 하루 가까이는 버팀 (${Math.round(total / 3600_000)}시간)`);
  assert.ok(ai.calls <= 40, `부른 횟수가 많지 않음 (${ai.calls})`);
});

test("(본 경로 확인) 지운 글 · 다시 맞추기(all)에서 빠진 글 · 벡터를 만드는 사이 지운 글은 낱말 · 뜻 찾기에 안 걸림", async () => {
  const ai = { down: false, calls: 0 };
  const { s, alarm } = mk(ai);
  await s.upsert([doc("m:1", "회의록 서류철 하나"), doc("m:2", "회의록 서류철 둘"), doc("m:3", "회의록 서류철 셋")]);
  await alarm();
  assert.equal(s.state().vecs, 3);
  await s.upsert([], ["m:1"]);                        // 지움
  await s.upsert([], [], ["m:3"]);                    // 다시 맞추기: m:3 만 남음(보낸 기록을 잃은 릴레이)
  const ids = (r: any) => r.chats.map((x: { id: string }) => x.id).sort();
  assert.deepEqual(ids(await s.query("회의록 서류철", false)), ["m:3"]);
  assert.equal(s.state().vecs, 1);
  // 모델을 기다리는 사이 지움 → 벡터를 쓰지 않음
  await s.upsert([doc("m:4", "회의록 새 글")]);
  const run = ai as any, orig = s.env.AI.run;
  s.env.AI.run = async (m: string, x: { text: string[] }) => { await s.upsert([], ["m:4"]); return orig(m, x); };
  await alarm(); s.env.AI.run = orig; void run;
  assert.deepEqual({ docs: s.state().docs, vecs: s.state().vecs, pending: s.state().pending }, { docs: 1, vecs: 1, pending: 0 });
  assert.deepEqual(ids(await s.query("회의록", true)), ["m:3"]);
});


const unit = (cos = 1) => Array.from({ length: 1024 }, (_, i) => i === 0 ? cos : i === 1 ? Math.sqrt(1 - cos * cos) : 0);
function voyageMock(vector: (text: string, type: string) => number[] = () => unit()) {
  const calls: { input: string[]; model: string; input_type: string }[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.voyageai.com/v1/embeddings");
    assert.equal(init.method, "POST");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer fake-test-key");
    const body = JSON.parse(init.body as string); calls.push(body);
    assert.equal(body.model, "voyage-3.5");
    assert.ok(body.input.length <= 128);
    assert.ok(body.input.every((s: string) => s.length <= 1200));
    return Response.json({ data: body.input.map((text: string, index: number) => ({ index, embedding: vector(text, body.input_type) })).reverse() });
  });
  return calls;
}
const aiOk = () => ({ down: false, calls: 0 });

test("기존 DO 표를 보존하고 재시작해도 tags/ext 마이그레이션이 안전함", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE doc(rid INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    node TEXT, ch TEXT, at REAL NOT NULL, meta TEXT, sig TEXT NOT NULL, emb INTEGER NOT NULL DEFAULT 0);
    INSERT INTO doc(id,kind,title,body,at,sig) VALUES('a:old','art','옛 제목','본문',1,'old');`);
  const { s } = mk(aiOk(), { db });
  assert.equal(s.state().docs, 1);
  mk(aiOk(), { db });
  await s.upsert([{ id: "a:old", kind: "art", title: "옛 제목", body: "본문", at: 1, tags: ["급여", "정산자료"],
    meta: { area: "dgit", node: "검색", people: ["가상인물"], company: ["가상회사"], deck: "업무" } }], [], ["a:old"]);
  for (const q of ["급여", "정산자료", "정산"]) {
    const r = await s.query(q, false);
    assert.equal(r.arts[0].id, "a:old");
    assert.deepEqual(r.arts[0].tags, ["급여", "정산자료"]);
    assert.deepEqual(r.arts[0].people, ["가상인물"]);
    assert.deepEqual(r.arts[0].company, ["가상회사"]);
    assert.equal(r.arts[0].area, "dgit"); assert.equal(r.arts[0].node, "검색"); assert.equal(r.arts[0].deck, "업무");
  }
});

test("태그 정확 일치만 ×1.5, 제목 ×1.6과 중첩하지 않음", async () => {
  const { s } = mk(aiOk());
  let d = { id: "n:찾기", kind: "node", title: "찾기", body: "회의록 자료", at: 1_793_300_000, tags: [] as string[] };
  const score = async (q = "회의록") => (await s.query(q, false, true)).dbg[0][1] as number;
  await s.upsert([d]); const base = await score();
  d.tags = ["회의록"]; await s.upsert([d]);
  assert.ok(Math.abs((await score()) / base - 1.5) < 0.002);
  d.tags = ["회의록율"]; await s.upsert([d]); assert.equal(await score(), base);
  d.title = "회의록"; await s.upsert([d]); const title = await score();
  d.tags = ["회의록"]; await s.upsert([d]); assert.equal(await score(), title);
});

test("캔버스만 제목 꼬리·공백·대소문자로 묶고 최신 판과 전체 versions 반환", async () => {
  const { s } = mk(aiOk());
  await s.upsert([
    { id: "a:old", kind: "art", title: "  PLAN   One (replaced by new)", body: "유일한검색어", at: 1 },
    { id: "a:new", kind: "art", title: "plan one", body: "새 본문", at: 3, tags: ["최신"] },
    { id: "a:mid", kind: "art", title: "Plan One", body: "중간", at: 2 },
    ...["card", "chat", "node"].map(kind => ({ id: kind === "node" ? "n:Plan One" : kind + ":one", kind, title: "Plan One", body: "유일한검색어", at: 1 })),
  ]);
  const r = await s.query("유일한검색어", false);
  assert.equal(r.arts.length, 1); assert.equal(r.arts[0].id, "a:new"); assert.equal(r.arts[0].versions, 3);
  assert.equal(r.arts[0].thumb, "/art/new/?thumb"); assert.deepEqual(r.arts[0].tags, ["최신"]);
  assert.equal(r.cards.length, 1); assert.equal(r.chats.length, 1); assert.equal(r.nodes.length, 1);
});

test("Voyage는 ext만 128개씩·1200자, 태그를 포함하고 bge도 보존", async () => {
  const calls = voyageMock();
  const { s, alarm, db } = mk(aiOk(), { key: "fake-test-key" });
  const docs = Array.from({ length: 130 }, (_, i) => ({ ...doc("m:" + i, "가".repeat(2000)), ext: true, tags: ["임베딩태그"] }));
  await s.upsert([...docs, doc("m:private", "개인글 절대 전송 금지")]);
  await alarm(); await alarm();
  assert.deepEqual(calls.map(c => c.input.length), [128, 2]);
  assert.ok(calls.every(c => c.input_type === "document" && c.input.every(t => t.startsWith("\n임베딩태그\n"))));
  assert.equal(s.state().voyageVecs, 130); assert.equal(s.state().vecs, 131);
  assert.ok(db.prepare("SELECT v FROM vec2 LIMIT 1").get()!.v instanceof Uint8Array);
  const count = calls.length; await s.upsert(docs); await alarm(); assert.equal(calls.length, count);
  docs[0].tags = ["태그변경"]; await s.upsert([docs[0]]); await alarm();
  assert.ok(calls.at(-1)!.input[0].includes("태그변경"));
  await s.upsert([{ ...docs[0], ext: false }]); assert.equal(s.state().voyageVecs, 129);
  await s.upsert([], [], ["m:private"]); assert.equal(s.state().voyageVecs, 0);
});

test("키 누락·HTTP 장애·잘못된 벡터는 bge 결과로 복귀, bge 모드는 Voyage 무시", async () => {
  const calls = voyageMock(); const ai = aiOk();
  const { s, alarm } = mk(ai);
  await s.upsert([{ ...doc("m:one", "자료"), ext: true }]); await alarm();
  const baseline = await s.query("자료", true, false, "bge");
  assert.deepEqual((await s.query("자료", true)).chats, baseline.chats); assert.equal(calls.length, 0);
  s.env.VOYAGE_API_KEY = "fake-test-key"; await s.upsert([]); await alarm();
  assert.equal(s.state().voyageVecs, 1);
  const count = calls.length; await s.query("다른질의", true, false, "bge"); assert.equal(calls.length, count);
  for (const response of [new Response("down", { status: 503 }), Response.json({ data: [{ index: 0, embedding: [1] }] })]) {
    mock.method(globalThis, "fetch", async () => response);
    const r = await s.query("자료", true, true, "voyage");
    assert.deepEqual(r.chats, baseline.chats); assert.equal(r.ms.voyage_err, 1);
  }
});

test("Voyage 질의 1.5초 제한과 병렬 bge, 실패 시 bge만 반환", async () => {
  voyageMock(); const ai = aiOk(); const { s, alarm } = mk(ai, { key: "fake-test-key" });
  await s.upsert([{ ...doc("m:one", "자료"), ext: true }]); await alarm();
  const before = ai.calls;
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.ok(ai.calls > before, "bge 질의는 Voyage 완료를 기다리지 않음");
    assert.ok(init.signal); return new Promise(() => {});
  });
  const start = Date.now(), r = await s.query("자료", true, true);
  assert.ok(Date.now() - start >= 1450 && Date.now() - start < 3000);
  assert.equal(r.ms.voyage_err, 1); assert.equal(r.chats[0].id, "m:one");
});

test("Voyage 종류별 문턱과 엔진별 RRF, dbg는 탈락 점수도 제공", async () => {
  voyageMock((text, type) => type === "query" ? unit() : unit(text.startsWith("아래") ? 0.34 : 0.45));
  const { s, alarm } = mk(aiOk(), { key: "fake-test-key" });
  s.env.AI.run = async () => ({ data: [unit()] });
  await s.upsert([
    { id: "n:아래", kind: "node", title: "아래", body: "본문", at: 1, ext: true },
    { id: "a:above", kind: "art", title: "위", body: "본문", at: 1, ext: true },
  ]);
  // bge 모의는 문서 개수만큼 돌려줌
  s.env.AI.run = async (_m: string, x: { text: string[] }) => ({ data: x.text.map(() => unit()) });
  await alarm();
  const v = await s.query("다른뜻", true, true, "voyage"), b = await s.query("다른뜻", true, true, "bge"), mix = await s.query("다른뜻", true, true, "mix");
  assert.equal(v.nodes.length, 0); assert.equal(v.arts.length, 1);
  assert.equal(b.nodes.length, 1); assert.equal(mix.nodes.length, 1); assert.equal(mix.arts.length, 1);
  assert.equal(v.semantic.voyage.length, 2);
  assert.equal(v.semantic.voyage.find((x: any) => x.kind === "node").min, 0.35);
  assert.ok(v.semantic.voyage.find((x: any) => x.kind === "node").score < 0.35);
  assert.ok(mix.semantic.bge && mix.semantic.voyage);
});

test("외부 호출 도중 ext 철회·태그 수정·삭제된 문서의 오래된 Voyage 벡터를 쓰지 않음", async () => {
  const { s, alarm } = mk(aiOk(), { key: "fake-test-key" });
  const d = { ...doc("m:one", "자료"), ext: true, tags: ["처음"] };
  for (const change of [() => s.upsert([{ ...d, ext: false }]), () => s.upsert([{ ...d, tags: ["바뀜"] }]), () => s.upsert([], [d.id])]) {
    await s.upsert([d]);
    mock.method(globalThis, "fetch", async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string); await change();
      return Response.json({ data: b.input.map((_: string, index: number) => ({ index, embedding: unit() })) });
    });
    await alarm(); assert.equal(s.state().voyageVecs, 0);
  }
});

test("Voyage 문서 호출 장애도 재시도하고, 뜻 벡터는 낱말 검색을 막지 않음", async () => {
  const { s, alarm, next } = mk(aiOk(), { key: "fake-test-key" });
  mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 429 }));
  await s.upsert([{ ...doc("m:one", "회의록 자료"), ext: true }]);
  await alarm(); await alarm();
  assert.equal(s.state().vecs, 1); assert.equal(s.state().voyageVecs, 0); assert.equal(s.state().voyagePending, 1);
  assert.ok(next()! - Date.now() >= 59_900);
  assert.equal((await s.query("회의록", false)).chats[0].id, "m:one");
  voyageMock(); await alarm();
  assert.equal(s.state().voyageVecs, 1); assert.equal(s.state().voyagePending, 0);
});

test("태그 없는 bge 문서는 기존 embText와 벡터 서명을 유지", async () => {
  const { s, alarm, db } = mk(aiOk());
  const text: string[] = [];
  s.env.AI.run = async (_m: string, x: { text: string[] }) => { text.push(...x.text); return { data: x.text.map(() => unit()) }; };
  const d = { ...doc("m:old", "기존 본문"), title: "기존 제목" };
  await s.upsert([d]); await alarm();
  assert.deepEqual(text, ["기존 제목\n기존 본문"]);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([d.title, d.body]))));
  assert.equal(db.prepare("SELECT sig FROM vec").get()!.sig, [...hash.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join(""));
  await s.upsert([{ ...d, at: d.at + 1 }]); await alarm(); assert.equal(text.length, 1);
});

test("bge 는 잘 되고 Voyage 가 429 여도 Voyage 줄은 자기 간격(30초부터 두 배)으로만 다시 시도함", async () => {
  const ai = aiOk(); const { s, alarm } = mk(ai, { key: "fake-test-key" });
  const times: number[] = [];
  mock.method(globalThis, "fetch", async () => { times.push(Date.now()); return new Response("rate", { status: 429 }); });
  await s.upsert(Array.from({ length: 300 }, (_, i) => ({ ...doc(`m:${i}`, `글 ${i} 가나다`), ext: true })));
  for (let i = 0; i < 60; i++) { if (!(await alarm())) break; }   // 가짜 시계가 예약 시각으로 흐름
  assert.ok(s.state().voyageVecs === 0, "아직 Voyage 벡터 없음");
  assert.ok(times.length >= 5, "여러 번 다시 시도함");
  assert.ok(times[3] - times[2] >= 29_000, `첫 세 묶음(300줄 ÷ 128) 뒤 같은 줄 재시도는 30초 이상 간격 (${times[3] - times[2]}ms)`);
  assert.ok(s.state().voyagePending > 0, "429 로 버려지지 않고 줄에 남음");
});

test("밖(Voyage)으로 나가는 글만 식별 번호를 가리고, 저장 본문은 원문 그대로", async () => {
  const sent: string[] = [];
  mock.method(globalThis, "fetch", async (_u: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string); sent.push(...b.input);
    return Response.json({ data: b.input.map((_: string, index: number) => ({ index, embedding: unit() })) });
  });
  const { s, alarm } = mk(aiOk(), { key: "fake-test-key" });
  await s.upsert([{ ...doc("m:one", "사업자 123-45-67890 연락 010-1234-5678 확인"), ext: true }]); await alarm();
  assert.ok(sent.length && sent.every(t => !t.includes("123-45-67890") && !t.includes("010-1234-5678")), "밖으로 나간 글에 번호가 없음");
  const r = await s.query("123-45-67890", false);
  assert.equal(r.chats[0]?.id, "m:one", "원문 번호로 낱말 찾기가 됨");
});
