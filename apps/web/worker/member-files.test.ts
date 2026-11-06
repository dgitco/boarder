// node --test --no-warnings --experimental-transform-types apps/web/worker/member-files.test.ts (Node 22.18+)
// 회원 파일 · 받아쓰기(member-files.ts) 계약 · 경계: 올린 사람만 봄(남은 404) · 서명 링크는 7일 · 틀린 서명 403 · 위험한 꼴은 내려받기 · 글 링크 줄은 내 파일만. 자료는 다 지어낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { register } from "node:module";
import { fileD1, fileR2, directConfig, uploadFile } from "./file-direct-test-helper.ts";
import { readFileSync } from "node:fs";

register("./test-hooks.mjs", import.meta.url);
const F = await import("./member-files.ts"), L = await import("./ledger.ts"), GEN = (await import("./uid.ts")).GEN_FLAG;

const A = "a@example.com", B = "b@example.com", SECRET = "test-secret-not-real";
function setup(gen = true) {   // gen = 새 파일 id UUID v7 스위치(write_uid_links) — 켬이 기본, 꺼짐은 예전 32자
  const { R: R2 } = fileR2(), { DB, sq } = fileD1();
  sq.prepare("INSERT INTO f7_flag(name, on_at, note) VALUES (?, ?, '') ON CONFLICT(name) DO UPDATE SET on_at = excluded.on_at").run(GEN, gen ? Date.now() : null);
  const env = { ...directConfig, DB, RESULTS: R2, AI: { run: async (_m: string, i: { audio: number[] }) => { ai.n++; return { text: ` 들린 글 ${i.audio.length} ` }; } }, BETTER_AUTH_SECRET: SECRET };
  const ai = { n: 0 };
  const app = new Hono();
  app.post("/api/upload/:action?", c => F.upload(c as never, c.req.header("x-test-user")!));
  app.post("/api/voice/stt", c => F.stt(c as never, c.req.header("x-test-user") || A));
  app.get("/api/file/:id", c => F.fileGet(c as never, c.req.header("x-test-user")!, c.req.param("id"), c.req.query("dl") !== undefined));
  app.get("/f/:id", c => F.signedGet(c as never, c.req.param("id")));
  app.get("/f/:id/:name", c => F.signedGet(c as never, c.req.param("id")));   // index.ts 의 이름 꼬리 길과 같게(아래 시험이 index.ts 에 그 길이 있는지 봄)
  const rawCall = (method: string, path: string, h: Record<string, string> = {}, body?: BodyInit) =>
    app.fetch(new Request("https://b.example" + path, { method, headers: h, body, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit), env);
  const call = async (method: string, path: string, h: Record<string, string> = {}, body?: BodyInit) => {
    const r = await rawCall(method, path, h, body); return { status: r.status, h: r.headers, t: await r.text() };
  };
  const control = (who: string, suffix: string, body: any) => rawCall('POST', '/api/upload' + suffix, { 'x-test-user': who, 'content-type': 'application/json' }, JSON.stringify(body));
  const init = (who: string, body: any) => control(who, '/init', body);
  const upload = (who: string, name: string, mime: string, body: string | Uint8Array = "내용", key = '') => uploadFile((suffix, b) => control(who, suffix, b), env as never, body, { name, mime, key });
  return { env, call, sq, ai, init, upload, control, rawCall };
}
const up = async (s: ReturnType<typeof setup>, who: string, name: string, type: string, body = "내용") =>
  await (await s.upload(who, name, type, body)).json() as { ok: boolean; id: string; name: string };

test("음성메모: 지정한 내 WAV만 받아쓰고 빈 성공·남의 파일·지정 안 된 첨부는 거절", async () => {
  const s = setup(), a = await up(s, A, "음성메모.wav", "audio/wav"), other = await up(s, B, "남의.wav", "audio/wav");
  assert.equal(await F.memoText(s.env as never, A, { stt: a.id, files: [a.id] }), "들린 글 6");
  const n = s.ai.n;
  for (const b of [{stt:other.id, files:[other.id]}, {stt:a.id, files:[]}]) await assert.rejects(F.memoText(s.env as never, A, b));
  assert.equal(s.ai.n, n);
  s.env.AI.run = async () => ({text:" "});
  await assert.rejects(F.memoText(s.env as never, A, {stt:a.id, files:[a.id]}), /받아쓴 글/);
});

test("올리기 → 보기: 올린 사람만(남은 404), 빈 몸통 400, 이름의 「/」는 바꿈", async () => {
  const s = setup(), a = await up(s, A, "a/보고서.pdf", "application/pdf");
  assert.ok(a.ok); assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); assert.equal(a.name, "a_보고서.pdf");
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": A })).t, "내용");
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": B })).status, 404);
  assert.equal((await s.init(A, { name: "empty", mime: "text/plain", size: 0 })).status, 400);
});

test("같은 열쇠(X-Upload-Key)로 다시 올려도 파일 하나 · 올리기 한도 한 번만, 열쇠가 다르거나 남이면 따로", async () => {
  const s = setup(), put = async (who: string, key: string) => await (await s.upload(who, "p.png", "image/png", "사진", key)).json() as { ok: boolean; id: string; size: number };
  const a = await put(A, "k-1"), a2 = await put(A, "k-1"), a3 = await put(A, "k-2"), n1 = await put(A, ""), n2 = await put(A, ""), b = await put(B, "k-1");
  assert.ok(a.ok && a2.ok); assert.equal(a2.id, a.id); assert.equal(a2.size, a.size); assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a3.id, a.id); assert.notEqual(n1.id, n2.id); assert.notEqual(b.id, a.id);   // 열쇠 없으면 예전처럼 매번 새 파일, 남의 같은 열쇠는 다른 파일
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": A })).t, "사진");
});

test("위험한 꼴(HTML · SVG)은 화면에 띄우지 않고 내려받기, ?dl 이면 무엇이든 내려받기", async () => {
  const s = setup(), h = await up(s, A, "x.html", "text/html", "<script>1</script>"), p = await up(s, A, "p.png", "image/png");
  const r = await s.call("GET", `/api/file/${h.id}`, { "x-test-user": A });
  assert.equal(r.h.get("content-type"), "application/octet-stream"); assert.match(r.h.get("content-disposition") || "", /^attachment/); assert.equal(r.h.get("content-security-policy"), "sandbox");
  assert.match((await s.call("GET", `/api/file/${p.id}`, { "x-test-user": A })).h.get("content-disposition") || "", /^inline/);
  assert.match((await s.call("GET", `/api/file/${p.id}?dl`, { "x-test-user": A })).h.get("content-disposition") || "", /^attachment/);
});

test("글 링크 줄: 내 파일만 「📎 이름: 서명 링크」, 남의 · 모르는 id 는 빼고 셈 — 링크는 로그인 없이 받힘, 서명이 틀리거나 지나면 403", async () => {
  const s = setup(), a = await up(s, A, "보고서.pdf", "application/pdf"), b = await up(s, B, "남의.pdf", "application/pdf");
  const f = await F.fileLines(s.env as never, A, "https://b.example/", [a.id, b.id, "nope"]);
  assert.equal(f.bad, 2); assert.equal(f.lines.length, 1);
  const m = /^📎 보고서\.pdf: https:\/\/b\.example(\/f\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\?e=(\d+)&t=([0-9a-f]{32}))$/.exec(f.lines[0]); assert.ok(m, f.lines[0] + " — 만드는 링크는 id 만");
  assert.equal((await s.call("GET", m![1])).t, "내용");
  assert.equal((await s.call("GET", m![1].replace("?", "/" + encodeURIComponent("보고서.pdf") + "?"))).t, "내용", "이미 나간 이름 꼬리 링크 /f/<id>/<이름> 도 그대로");
  assert.equal((await s.call("GET", m![1].replace(/t=[0-9a-f]/, "t=" + (m![3][0] === "0" ? "1" : "0")))).status, 403);
  assert.match(readFileSync(new URL("./index.ts", import.meta.url), "utf8"), /app\.get\("\/f\/:id\{[^"]+\}\/:name", c => memberFiles\.signedGet/, "Worker 에 이름 꼬리 길(옛 링크)");
  const old = await F.fileLink(SECRET, "https://b.example", a.id, Date.now() - 8 * 86400_000);
  assert.equal((await s.call("GET", old.replace("https://b.example", ""))).status, 403, "7일 지난 링크");
  assert.equal(await F.linkOk("other-secret", a.id, m![2], m![3]), false, "다른 비밀값으로 만든 서명 아님");
});

test("받아쓰기: 녹음 → 글, 빈 녹음 400, 3MB 넘으면 413", async () => {
  const s = setup();
  assert.deepEqual(JSON.parse((await s.call("POST", "/api/voice/stt", { "content-type": "audio/wav" }, new Uint8Array(4))).t), { ok: true, text: "들린 글 4" });
  assert.equal((await s.call("POST", "/api/voice/stt", { "content-type": "audio/wav" }, new Uint8Array(0))).status, 400);
  assert.equal((await s.call("POST", "/api/voice/stt", { "content-type": "audio/wav" }, new Uint8Array(F.VOICE_MAX + 1))).status, 413);
});

// content-length 없이 조각으로 오는 몸통(스트림) — 상한을 넘으면 그 자리에서 끊는지: 넘은 뒤 조각은 당기지 않음
function chunked(size: number, chunk = 1024 * 1024) {
  const st = { pulled: 0 };
  const body = new ReadableStream<Uint8Array>({ pull(ctl) { if (st.pulled * chunk >= size) return ctl.close(); st.pulled++; ctl.enqueue(new Uint8Array(chunk)); } }, { highWaterMark: 0 });
  return { body, st };
}
test("옛 첨부는20MiB까지만 읽고 거절 · 받아쓰기도 읽으면서 상한413", async () => {
  const s = setup(), up1 = chunked(F.FILE_MAX * 5);
  assert.equal((await s.call("POST", "/api/upload", { "x-test-user": A, "x-file-name": "big.bin" }, up1.body as never)).status, 413);
  assert.ok(up1.st.pulled <= 22, "옛 첨부도 상한 뒤에는 읽지 않음");
  const v = chunked(F.VOICE_MAX * 10, 256 * 1024);
  assert.equal((await s.call("POST", "/api/voice/stt", { "x-test-user": A }, v.body as never)).status, 413);
  assert.ok(v.st.pulled <= F.VOICE_MAX / (256 * 1024) + 2);
  assert.equal(s.ai.n, 0);
  assert.equal((await (await s.upload(A, "s.bin", "application/octet-stream", new Uint8Array(3 * 1024))).json() as any).size, 3 * 1024);
});

test("하루 상한: 올리기는 회원마다 개수 · 총량, 받아쓰기는 회원마다 횟수 — 넘으면 429 이고 받아쓰기(AI)를 부르지 않음, 다른 회원은 따로", async () => {
  const s = setup();
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  const set = (who: string, kind: string, n: number, b: number) => s.sq.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v").run(who, `q:${kind}:${day}`, JSON.stringify({ n, b }), now);
  set(A, "mfiles", F.DAY_FILES - 1, 0);
  assert.ok((await up(s, A, "a.txt", "text/plain")).ok, "상한 바로 아래는 됨");
  assert.equal((await s.init(A, { name: "b.txt", mime: "text/plain", size: 6 })).status, 429, "개수 상한");
  assert.ok((await up(s, B, "b.txt", "text/plain")).ok, "다른 회원은 따로");
  set(B, "mfiles", 0, F.DAY_FILE_BYTES - 3);
  assert.equal((await s.init(B, { name: "c.txt", mime: "text/plain", size: 6 })).status, 429, "총량 상한(「내용」 = 6바이트)");
  set(A, "stt", F.DAY_STT - 1, 0);
  assert.equal((await s.call("POST", "/api/voice/stt", { "x-test-user": A }, new Uint8Array(4))).status, 200);
  const before = s.ai.n;
  assert.equal((await s.call("POST", "/api/voice/stt", { "x-test-user": A }, new Uint8Array(4))).status, 429, "받아쓰기 횟수 상한");
  assert.equal(s.ai.n, before, "넘은 뒤엔 AI 를 부르지 않음");
  assert.equal((await s.call("POST", "/api/voice/stt", { "x-test-user": B }, new Uint8Array(4))).status, 200, "다른 회원은 따로");
});

test("하루 상한 셈: 동시에 와도 상한을 넘지 않음 · 셈을 못 하면(D1 장애) 받지 않음", async () => {
  const s = setup();
  const r = await Promise.all(Array.from({ length: 8 }, () => F.quotaTake(s.env.DB as never, A, "t", 1, 5, 100)));
  assert.equal(r.filter(Boolean).length, 5);
  const broken = { prepare: () => { throw new Error("D1 장애(시험)"); } };
  const s2 = setup(); (s2.env as any).DB = broken;
  assert.equal((await s2.init(A, { name: "x.txt", mime: "text/plain", size: 6 })).status, 503);
});

test("PDF: 맨 앞이 %PDF- 면 화면 안 보기(inline · application/pdf · sandbox 없이 frame-ancestors), 가짜 PDF 는 내려받기 + sandbox, ?dl 은 내려받기 · 한글 이름 RFC5987", async () => {
  const s = setup(), a = await up(s, A, "분기 보고서 (최종).pdf", "application/pdf", "%PDF-1.7\n본문"), f = await up(s, A, "가짜.pdf", "application/pdf", "<script>1</script>");
  const r = await s.call("GET", `/api/file/${a.id}`, { "x-test-user": A }), cd = r.h.get("content-disposition") || "";
  assert.equal(r.status, 200); assert.equal(r.h.get("content-type"), "application/pdf"); assert.match(cd, /^inline; filename="/);
  assert.ok(cd.includes(`filename*=UTF-8''${encodeURIComponent("분기 보고서 ")}%28%EC%B5%9C%EC%A2%85%29.pdf`), cd);
  assert.equal(r.h.get("content-security-policy"), "frame-ancestors 'self'"); assert.equal(r.h.get("x-content-type-options"), "nosniff"); assert.ok(r.t.startsWith("%PDF-"));
  const d = await s.call("GET", `/api/file/${a.id}?dl`, { "x-test-user": A });
  assert.match(d.h.get("content-disposition") || "", /^attachment; filename=/); assert.equal(d.h.get("content-security-policy"), "sandbox");
  const x = await s.call("GET", `/api/file/${f.id}`, { "x-test-user": A });
  assert.match(x.h.get("content-disposition") || "", /^attachment/); assert.equal(x.h.get("content-security-policy"), "sandbox");
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": B })).status, 404);
  assert.equal((await s.call("GET", `/api/file/${a.id}?dl`, { "x-test-user": B })).status, 404);
});

test("첨부 줄 정규식(member-inbox FILE_LINE): 지금 링크(id 만)와 이미 나간 이름 꼬리 링크 둘 다", async () => {
  const src = readFileSync(new URL("./member-inbox.ts", import.meta.url), "utf8"), re = new RegExp(/const FILE_LINE = \/(.+)\/u;/.exec(src)![1], "u");
  const u = await F.fileLink(SECRET, "https://b.example", "0".repeat(32));
  assert.ok(/\/f\/0{32}\?e=/.test(u), u);
  assert.ok(re.test(`📎 a.png: ${u}`)); assert.ok(re.test(`📎 a.png: ${u.replace("?", "/" + encodeURIComponent("가".repeat(20) + ".png") + "?")}`));
});

test("직접 올리기 예약 영수증: init 재시도·완료 재시도는 한 번만 셈, 취소와 만료는 환불", async () => {
  const s = setup(), usage = () => {
    const row = s.sq.prepare("SELECT v FROM user_pref WHERE owner=? AND k LIKE 'q:mfiles:%'").get(A) as any;
    return row ? JSON.parse(row.v) : { n: 0, b: 0 };
  };
  const spec = { name: "예약.txt", mime: "text/plain", size: 6, key: "receipt-key" };
  const a = await (await s.init(A, spec)).json() as any, again = await (await s.init(A, spec)).json() as any;
  assert.equal(a.id, again.id); assert.deepEqual(usage(), { n: 1, b: 6 });
  assert.equal((await s.control(A, "/abort", { id: a.id })).status, 200);
  assert.deepEqual(usage(), { n: 0, b: 0 });
  const pending = await (await s.init(A, spec)).json() as any;
  assert.notEqual(pending.id, a.id);
  const done = await (await s.upload(A, spec.name, spec.mime, "내용", spec.key)).json() as any;
  assert.ok(done.ok); assert.deepEqual(usage(), { n: 1, b: 6 });
  assert.equal((await s.control(A, "/complete", { id: pending.id, parts: [] })).status, 200);
  assert.equal((await s.control(A, "/abort", { id: pending.id })).status, 200);
  assert.deepEqual(usage(), { n: 1, b: 6 });
  const abandoned = await (await s.init(A, { ...spec, key: "abandoned", size: 8 })).json() as any;
  assert.deepEqual(usage(), { n: 2, b: 14 });
  s.sq.prepare("UPDATE direct_upload SET expires=? WHERE id=?").run(Date.now() - 1, abandoned.id);
  const direct = await import("./direct-uploads.ts"); await direct.sweep(s.env as never);
  assert.deepEqual(usage(), { n: 1, b: 6 });
  assert.ok(await F.fileKey(s.env.RESULTS, done.id));
});

test("회원 파일 500MiB 경계는 JSON 선언으로 검증 · 다른 회원의 제어 세션 거절", async () => {
  const s = setup(), exact = await s.init(A, { name: "큰 파일.bin", mime: "application/octet-stream", size: 524288000 });
  assert.equal(exact.status, 200);
  const session = await exact.json() as any;
  assert.equal(session.size, F.FILE_MAX); assert.ok(session.parts > 1);
  assert.equal((await s.init(B, { name: "초과.bin", mime: "application/octet-stream", size: 524288001 })).status, 413);
  for (const action of ["part", "complete", "abort"]) assert.equal((await s.control(B, '/' + action, { id: session.id, number: 1, parts: [] })).status, 404);
  assert.equal((await s.control(A, "/abort", { id: session.id })).status, 200);
});

test("취소 정리가 일시 실패해도 다음 취소가 같은 예약을 한 번만 환불한다", async () => {
  const s = setup(), pending = await (await s.init(A, {name:"취소.bin",mime:"application/octet-stream",size:4})).json() as any;
  const original = s.env.RESULTS.delete; let fails = 1;
  s.env.RESULTS.delete = (async (key: string | string[]) => { if (fails-- > 0) throw Error('R2 transient delete failure'); return original(key as never); }) as never;
  assert.equal((await s.control(A,"/abort",{id:pending.id})).status,503);
  assert.equal((await s.control(A,"/abort",{id:pending.id})).status,200);
  assert.equal((await s.control(A,"/abort",{id:pending.id})).status,200);
  const row = s.sq.prepare("SELECT v FROM user_pref WHERE owner=? AND k LIKE 'q:mfiles:%'").get(A) as any;
  assert.deepEqual(JSON.parse(row.v),{n:0,b:0});
  assert.equal((s.sq.prepare('SELECT charged_day FROM direct_upload WHERE id=?').get(pending.id) as any).charged_day,null);
});

test("같은 열쇠 재초기화 사이 취소되면 aborted 세션을 다시 과금하지 않는다", async () => {
  const s = setup(), spec={name:"경합.bin",mime:"application/octet-stream",size:4,key:"abort-race"};
  const pending=await (await s.init(A,spec)).json() as any, original=s.env.DB.batch.bind(s.env.DB);let race=true;
  s.env.DB.batch=(async (statements:any[])=>{
    if(race){race=false;assert.equal((await s.control(A,"/abort",{id:pending.id})).status,200);}
    return original(statements);
  }) as never;
  assert.equal((await s.init(A,spec)).status,409);
  const usage=s.sq.prepare("SELECT v FROM user_pref WHERE owner=? AND k LIKE 'q:mfiles:%'").get(A) as any;
  assert.deepEqual(JSON.parse(usage.v),{n:0,b:0});
  assert.equal((s.sq.prepare('SELECT charged_day FROM direct_upload WHERE id=?').get(pending.id) as any).charged_day,null);
});

test("취소의 조회 뒤 예약이 들어와도 최신 영수증으로 환불한다",async()=>{
  const s=setup(),pending=await (await s.init(A,{name:"늦은예약.bin",mime:"application/octet-stream",size:4})).json() as any;
  const day=new Date().toISOString().slice(0,10);
  s.sq.prepare('UPDATE direct_upload SET charged_day=NULL WHERE id=?').run(pending.id);
  s.sq.prepare("UPDATE user_pref SET v=json_object('n',0,'b',0) WHERE owner=? AND k=?").run(A,`q:mfiles:${day}`);
  const original=s.env.DB.prepare.bind(s.env.DB);let reserve=true;
  s.env.DB.prepare=((sql:string)=>{
    const st=original(sql);
    if(sql.includes("state = 'aborted'")){
      const bind=st.bind.bind(st);st.bind=((...args:any[])=>{const bound=bind(...args),first=bound.first.bind(bound);bound.first=(async()=>{
        if(reserve){reserve=false;s.sq.prepare('UPDATE direct_upload SET charged_day=? WHERE id=?').run(day,pending.id);s.sq.prepare("UPDATE user_pref SET v=json_object('n',1,'b',4) WHERE owner=? AND k=?").run(A,`q:mfiles:${day}`);}return first();
      }) as never;return bound;}) as never;
    }
    return st;
  }) as never;
  assert.equal((await s.control(A,"/abort",{id:pending.id})).status,200);
  const usage=s.sq.prepare('SELECT v FROM user_pref WHERE owner=? AND k=?').get(A,`q:mfiles:${day}`) as any;
  assert.deepEqual(JSON.parse(usage.v),{n:0,b:0});
});

test('옛 클라이언트 raw JSON도 제어로 오인하지 않고 저장·키 재시도·한도를 유지',async()=>{
 const s=setup(),headers={'x-test-user':A,'x-file-name':'data.json','x-upload-key':'legacy-json','content-type':'application/json'};
 const a=await s.call('POST','/api/upload',headers,'{"hello":"world"}');
 assert.equal(a.status,200);assert.equal(a.h.get('deprecation'),'true');
 const id=JSON.parse(a.t).id;
 assert.equal((await s.call('GET','/api/file/'+id,{'x-test-user':A})).t,'{"hello":"world"}');
 const b=await s.call('POST','/api/upload',headers,'{"hello":"world"}');assert.equal(JSON.parse(b.t).id,id);
 const quota=JSON.parse((s.sq.prepare("SELECT v FROM user_pref WHERE owner=? AND k LIKE 'q:mfiles:%'").get(A) as any).v);assert.equal(quota.n,1);
 const direct=await s.init(A,{name:'new.txt',mime:'text/plain',size:3});assert.equal(direct.status,200);assert.equal(direct.headers.get('deprecation'),null);
});

test('0093 이주 전에도 raw 첨부는 유지, 키가 있는 새 init은 준비안됨503으로 전환 가능',async()=>{
 const s=setup();s.sq.exec('DROP TABLE direct_upload; DROP TABLE canvas_upload');
 const init=await s.init(A,{name:'new.txt',mime:'text/plain',size:3});
 assert.equal(init.status,503);assert.equal((await init.json() as any).code,'direct_upload_unavailable');
 const raw=await s.call('POST','/api/upload',{'x-test-user':A,'x-file-name':'old.json','content-type':'application/json'},'{"legacy":true}');
 assert.equal(raw.status,200);assert.equal(raw.h.get('deprecation'),'true');
 assert.equal((await s.call('GET','/api/file/'+JSON.parse(raw.t).id,{'x-test-user':A})).t,'{"legacy":true}');
});

test("주인 메일은 R2 에 원문으로(점진 배포 중 옛 Worker 가 원문과 견줘 404), 읽기는 원문 · 인코딩 둘 다", async () => {
  const s = setup(), a = await up(s, A, "사진.png", "image/png");
  const k = (await F.fileKey(s.env.RESULTS, a.id))!, o = await (s.env.RESULTS as any).head(k);
  assert.equal(o.customMetadata.owner, A); assert.equal(o.customMetadata.owner_encoding, undefined);
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": A })).t, "내용");
  await (s.env.RESULTS as any).put(k, new TextEncoder().encode("옛 판"), { customMetadata: { owner: encodeURIComponent(A), owner_encoding: "uri" } });   // 앞 판이 남긴 인코딩 꼴도 열림
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": A })).t, "옛 판");
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": B })).status, 404);
});

test("시작 입력 오류 400 엔 code 가 붙음(화면 · CLI 가 옛 길로 물러나지 않게 — 옛 Worker 의 code 없는 400 과 구별)", async () => {
  const s = setup(), r = await s.init(A, { name: "x", mime: "text/plain", size: "3" });
  assert.equal(r.status, 400); assert.equal(((await r.json()) as { code?: string }).code, "direct_upload_rejected");
});

test("시작 요청이 JSON 이 아니거나 객체가 아니어도 400 에 code(옛 길로 물러나 성공 · 한도 차감 막음)", async () => {
  const s = setup();
  for (const body of ["{", "[]", "null"]) {
    const r = await s.rawCall("POST", "/api/upload/init", { "x-test-user": A, "content-type": "application/json" }, body);
    assert.equal(r.status, 400); assert.equal(((await r.json()) as { code?: string }).code, "direct_upload_rejected");
  }
});

test("R2 키 = mfiles/<uuid v7>/<안전한 이름> · 링크는 UUID 만 · 내려받기 이름은 원래 이름 · 대문자 id 도 열림 · 옛 32자 파일은 옮기지 않고 그대로", async () => {
  const s = setup(), a = await up(s, A, "회의 록 (최종)?.pdf", "application/pdf");
  const k = (await F.fileKey(s.env.RESULTS, a.id))!;
  assert.equal(k, `mfiles/${a.id}/회의_록_최종_.pdf`, "키 = UUID/이름(글자 · 숫자 · . _ - 만)");
  const r = await s.call("GET", `/api/file/${a.id}?dl`, { "x-test-user": A });
  assert.equal(r.status, 200); assert.match(r.h.get("content-disposition") || "", new RegExp("filename\\*=UTF-8''" + encodeURIComponent("회의 록 (최종)?.pdf").replace(/[()]/g, x => "%" + x.charCodeAt(0).toString(16).toUpperCase()) + "$"), "원래 이름 그대로");
  assert.equal((await s.call("GET", `/api/file/${a.id.toUpperCase()}`, { "x-test-user": A })).t, "내용", "대문자 id");
  const [line] = (await F.fileLines(s.env as never, A, "https://b.example", [a.id])).lines;
  assert.ok(!line.includes("mfiles") && !line.includes("회의_록"), "링크에 키를 드러내지 않음: " + line);
  assert.equal((await s.call("GET", line.split(": ")[1].replace("https://b.example", "").replace(a.id, a.id.toUpperCase()))).t, "내용", "대문자 서명 링크도");
  // 옛 판이 넣은 파일(mfiles/<32자>, 옮기지 않음)
  const old = "0123456789abcdef0123456789abcdef";
  await (s.env.RESULTS as any).put(`mfiles/${old}`, new TextEncoder().encode("옛 파일"), { httpMetadata: { contentType: "text/plain" }, customMetadata: { owner: A, name: encodeURIComponent("옛.txt"), name_encoding: "uri" } });
  assert.equal((await s.call("GET", `/api/file/${old}`, { "x-test-user": A })).t, "옛 파일");
  const ol = (await F.fileLines(s.env as never, A, "https://b.example", [old])).lines[0];
  assert.match(ol, /\/f\/0123456789abcdef0123456789abcdef\?e=/); assert.equal((await s.call("GET", ol.split(": ")[1].replace("https://b.example", ""))).t, "옛 파일");
  assert.equal(F.keyName("../../etc/passwd"), "etc_passwd"); assert.equal(F.keyName(""), "file"); assert.equal(F.keyName("가".repeat(300)).length, 120);
});

test("스위치 꺼짐: 새 파일은 예전 꼴(32자 id · mfiles/<id>) — 배포 사이 옛 Worker 도 열 수 있게", async () => {
  await L.setFlag((await import("./file-direct-test-helper.ts")).fileD1().DB, "x_reset", false);   // 스위치 캐시 비우기
  const s = setup(false), a = await up(s, A, "옛꼴.txt", "text/plain");
  assert.match(a.id, /^[0-9a-f]{32}$/);
  assert.ok(await (s.env.RESULTS as any).head(`mfiles/${a.id}`));
  assert.equal((await s.call("GET", `/api/file/${a.id}`, { "x-test-user": A })).t, "내용");
  await L.setFlag((await import("./file-direct-test-helper.ts")).fileD1().DB, "x_reset", false);
});
