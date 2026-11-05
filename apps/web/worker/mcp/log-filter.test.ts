// node --test --no-warnings --experimental-transform-types apps/web/worker/mcp/log-filter.test.ts
// 작업 기록 · 상태 줄 서버 거르개. 값은 다 지어낸 것 — 키 꼴 글자는 시험 안에서 조립(저장소에 그대로 두지 않음).
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("../test-hooks.mjs", import.meta.url);
const { filterText, filterLogArgs, LogRejected, MARK } = await import("./log-filter.ts");
const { run } = await import("./tools.ts");

const fill = (n: number, c = "Fa9") => c.repeat(Math.ceil(n / c.length)).slice(0, n);
const FAKE = {
  openai: ["sk", "proj", fill(40)].join("-"),
  anthropic: ["sk", "ant", "api03", fill(40)].join("-"),
  github: "gh" + "p_" + fill(36),
  slack: ["xo" + "xb", "1234567890", fill(24)].join("-"),
  aws: "AK" + "IA" + "FAKEFAKEFAKEFAKE",
  bearer: "Bear" + "er " + fill(32),
  url: "postgres://app:" + "Fake" + "Pass99" + "@db.example.com:5432/app",
  kv: "STRIPE_SECRET" + "=" + fill(24),
  jwt: ["ey" + "J" + fill(20), "ey" + "J" + fill(30), fill(30)].join("."),
  pem: ["-----BEGIN " + "PRIVATE KEY-----", fill(64), "-----END " + "PRIVATE KEY-----"].join("\n"),
};
const masked = (t: string) => { const f = filterText(t); assert.ok(!("reject" in f), `거절되면 안 됨: ${t.slice(0, 20)}`); return f as { text: string; redacted: number }; };
const rejected = (t: string) => { const f = filterText(t); assert.ok("reject" in f, "거절돼야 함"); return (f as { reject: string }).reject; };

test("꼴마다 가림 — 알려진 키 머리 · Bearer · 주소 비밀번호 · 이름=값", () => {
  for (const [k, v] of Object.entries(FAKE)) {
    if (k === "jwt" || k === "pem") continue;
    const f = masked(`배포 확인 ${v} 끝`);
    assert.ok(!f.text.includes(v), `${k} 값이 남음`);
    assert.ok(f.text.includes(MARK), `${k} 표지 없음`);
    assert.equal(f.redacted, 1, `${k} 개수`);
    assert.ok(f.text.startsWith("배포 확인 ") && f.text.endsWith(" 끝"), `${k} 앞뒤 글은 그대로`);
  }
  assert.ok(!masked(FAKE.url).text.includes("FakePass99"));
  assert.ok(masked(FAKE.url).text.includes("db.example.com"), "주소의 비밀번호만 가림");
});

test("한국어 낱말 뒤 값 가림 — 「비밀번호: …」 「암호 …」", () => {
  const pw = "Qw" + "er" + "1234!";
  for (const t of [`비밀번호: ${pw}`, `비번=${pw} 로 바꿈`, `암호 ${pw} 입력함`, `패스워드는 ${pw}`, `인증키：${pw}`]) {
    const f = masked(t);
    assert.ok(!f.text.includes(pw), t.slice(0, 6));
    assert.equal(f.redacted, 1);
  }
  assert.equal(masked("비밀번호: 1234").redacted, 1, "구분 기호 뒤 네 자리도");
});

test("주민 · 카드 · 계좌 꼴 가림", () => {
  const rrn = "900101" + "-" + "1234568";   // 날짜 맞는 꼴(검증 숫자는 안 봄 — registry maskText 규칙)
  const card = ["4111", "1111", "1111", "1111"].join("-");   // Luhn 맞는 시험 카드
  const acct = ["110", "123", "456789"].join("-");
  const f1 = masked(`주민 ${rrn} 확인`); assert.ok(!f1.text.includes(rrn)); assert.equal(f1.redacted, 1);
  const f2 = masked(`카드 ${card} 승인`); assert.ok(!f2.text.includes("4111-1111-1111")); assert.equal(f2.redacted, 1);
  const f3 = masked(`신한은행 계좌 ${acct} 로 입금`); assert.ok(!f3.text.includes(acct)); assert.equal(f3.redacted, 1);
});

test("거절 — PEM 블록 · 완전한 JWT · .env 통째", () => {
  assert.equal(rejected(`열쇠 ${FAKE.pem}`), "pem");
  assert.equal(rejected(`토큰 ${FAKE.jwt}`), "jwt");
  const env = ["DB_PASSWORD=" + fill(12), "API_KEY=" + fill(20), "WEBHOOK_SECRET=" + fill(16)].join("\n");
  assert.equal(rejected(env), "env");
  assert.equal(rejected(env.replace(/\n/g, " ")), "env", "한 줄에 이어 붙여도");
});

test("보통 글 · 이름 · 자리표는 그대로", () => {
  const plain = [
    "가나 상사 9월 정산 끝 — 홍길동 팀장님 확인, 김철수 대리님께 전달",
    "#1234 boarder log 길 가림 PR 올림 · 시험 6개 초록",
    "API_KEY=<값> 넣는 법 안내", "TOKEN=${GITHUB_TOKEN} 로 넘김", "SECRET={{secret}} 자리표",
    "비밀번호 재설정 화면 고침", "암호화 방식 AES-GCM 그대로", "토큰 이야기 — 값은 없어요",
    "sk- 로 시작하는 키는 가려요", "2026-11-05 21:30 시작 · 3건 중 2건 처리",
    "사업자번호 123-45-67890 확인",
  ];
  for (const t of plain) { const f = masked(t); assert.equal(f.text, t); assert.equal(f.redacted, 0); }
});

test("가린 뒤 다시 검사 — 값이 여럿이어도 남지 않음", () => {
  const t = `${FAKE.github} ${FAKE.aws} ${FAKE.openai} 셋`;
  const f = masked(t);
  for (const v of [FAKE.github, FAKE.aws, FAKE.openai]) assert.ok(!f.text.includes(v));
  assert.equal(f.redacted, 3);
});

test("evidence 주소의 비밀번호도 가림 · 거절 오류 글에 원문 없음", () => {
  const r = filterLogArgs({ kind: "done", text: "끝", evidence: [FAKE.url.replace("postgres", "https")] });
  assert.ok(!JSON.stringify(r.args).includes("FakePass99")); assert.equal(r.redacted, 1);
  try { filterLogArgs({ kind: "progress", text: `x ${FAKE.jwt}` }); assert.fail("거절돼야 함"); }
  catch (e) { assert.ok(e instanceof LogRejected); assert.ok(!String((e as Error).message).includes(FAKE.jwt.slice(0, 12))); }
});

// 도구 입구(run) 끝까지: 저장되는 글 · 돌려주는 칸 · 기록(console) 어디에도 원문 없음
function ctxWith(saved: Record<string, any>[]) {
  return { view: { why: () => null, mask: () => true, visible: () => true, desc: () => "" }, local: async (_n: string, a: Record<string, any>) => { saved.push(a); return { ok: true, shown: true }; } } as any;
}
async function capture<T>(fn: () => Promise<T>): Promise<{ out: T | Error; logs: string }> {
  const lines: string[] = [], orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...x: unknown[]) => { lines.push(x.map(String).join(" ")); };
  try { return { out: await fn(), logs: lines.join("\n") }; } catch (e) { return { out: e as Error, logs: lines.join("\n") }; }
  finally { Object.assign(console, orig); }
}

test("run: inbox_log · inbox_status 는 가려서 저장 · 개수만 돌려줌 · 기록에 원문 0", async () => {
  const saved: Record<string, any>[] = [];
  const a = await capture(() => run(ctxWith(saved), "inbox_log", { kind: "progress", text: `배포 ${FAKE.github} 끝` }));
  assert.deepEqual(a.out, { ok: true, redacted: 1 });
  assert.equal(saved[0].text, `배포 ${MARK} 끝`);
  assert.ok(!a.logs.includes(FAKE.github) && a.logs.includes("write_redact"));
  const b = await capture(() => run(ctxWith(saved), "inbox_status", { text: `키 ${FAKE.aws}` }));
  assert.deepEqual(b.out, { ok: true, shown: true, redacted: 1 });
  assert.equal(saved[1].text, `키 ${MARK}`);
  const c = await capture(() => run(ctxWith(saved), "inbox_log", { kind: "progress", text: "보통 글 · 가나 상사" }));
  assert.deepEqual(c.out, { ok: true });
  assert.equal(saved[2].text, "보통 글 · 가나 상사");
});

test("run: 거절이면 저장 0 · 오류 글 · 기록에 원문 0", async () => {
  const saved: Record<string, any>[] = [];
  for (const text of [`x ${FAKE.jwt}`, `reply ${FAKE.pem}`]) {
    const kind = text.startsWith("reply") ? "reply" : "progress";
    const r = await capture(() => run(ctxWith(saved), "inbox_log", { kind, text }));
    assert.ok(r.out instanceof Error);
    assert.ok(!String((r.out as Error).message).includes(fill(20)));
    assert.ok(!r.logs.includes(fill(20)) && r.logs.includes("write_reject"));
  }
  assert.equal(saved.length, 0);
});

test("리뷰 P2: 따옴표 안 값 · 소문자 bearer · 은행 이름 곁 계좌", () => {
  const pw = "ab" + "cd" + "1234";
  for (const t of [`비밀번호는 '${pw}'`, `비밀번호: "${pw}"`, `암호 「${pw}」`]) { const f = masked(t); assert.ok(!f.text.includes(pw), t.slice(0, 8)); assert.equal(f.redacted, 1); }
  const tok = fill(30);
  const b = masked(`Authorization: bear` + `er ${tok}`); assert.ok(!b.text.includes(tok)); assert.equal(b.redacted, 1);
  for (const acct of ["110-123" + "-456789", "123456" + "-01-234567", "352-1234" + "-5678-93"]) {
    for (const t of [`계좌번호 ${acct}`, `신한은행 ${acct}`, `국민은행 ${acct} 로`, `입금 ${acct}`]) { const f = masked(t); assert.ok(!f.text.includes(acct), t); assert.ok(f.redacted >= 1); }
  }
  for (const t of ["입금 3건 확인 · 이체 2건", "우리 팀 1차 끝", "하나 남음 — PR 747"]) assert.equal(masked(t).text, t);
});

// ── 빠지는 길 0: MCP(/mcp · 코드 모드) · REST(/api/agent/<도구>) · CLI(REST 를 부름) 모두 tools.ts run 하나 → 쓰기 도구 전부가 거르개를 지남
const { SCHEMAS, WRITE_TOOLS, onlyReads, maskWrites } = await import("./tools.ts");
const { readFileSync } = await import("node:fs");

test("빠지는 길 0 — 읽기가 아닌 코어 도구는 전부 쓰기 거르개 목록에 있음", () => {
  const notRead = Object.keys(SCHEMAS).filter(n => !onlyReads(n));
  assert.deepEqual(notRead.filter(n => !WRITE_TOOLS.has(n)), []);
  assert.equal(notRead.length, 12);
});

test("빠지는 길 0 — MCP · 코드 모드 · REST 입구가 run 을 부름", () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  assert.match(src("./server.ts"), /return run\(ctx, name, a\)/);   // MCP · 코드 모드(one) — 도구 하나든 스크립트든
  assert.match(src("../index.ts"), /app\.post\("\/api\/agent\/:tool"[\s\S]{0,400}runTool\(ctx, name,/);   // REST(CLI boarder log · status · say … 가 부름)
});

test("빠지는 길 0 — 쓰기 도구 12개 run 끝까지: 저장되는 값 · 응답 · 기록에 원문 0", async () => {
  const S = FAKE.aws;   // 짧아서 40자 칸(inbox_status)에도 들어감
  const T = "1793000000.000001";
  const samples: Record<string, Record<string, unknown>> = {
    inbox_ask: { question: `물음 ${S}`, choices: [`가 ${S}`, "나"], body: `설명 ${S}` },
    inbox_log: { kind: "done", text: `끝 ${S}`, evidence: [FAKE.url.replace("postgres", "https")] },
    inbox_close: { card_id: T, done: `처리 ${S}` },
    inbox_say: { thread_id: T, text: `결과 ${S}` },
    inbox_status: { text: `키 ${S}` },
    chat_say: { text: `답 ${S}` },
    chat_split: { thread: T, why: `까닭 ${S}`, parts: [{ node: "노드", text: `몫 ${S}` }] },
    role_draft: { name: "역할", brief: `목표 ${S}`, instructions: `지시 ${S}` },
    role_edit: { role_id: "r1", instructions: `지시 ${S}` },
    promise_add: { who: "가나 상사", what: `할 것 ${S}`, check: "확인", due: "2026-11-06" },
    promise_done: { promise_id: 1, done: `지킴 ${S}` },
    feedback_send: { text: `피드백 ${S}` },
  };
  assert.deepEqual(Object.keys(samples).sort(), [...WRITE_TOOLS].sort(), "쓰기 도구가 늘면 여기 견본도 더함");
  const binds: unknown[] = [];
  const db = { prepare: () => ({ bind: (...x: unknown[]) => { binds.push(...x); return { run: async () => ({ meta: { changes: 1 } }), first: async () => ({ n: 0 }) }; }, first: async () => ({ n: 0 }) }) };
  for (const [name, args] of Object.entries(samples)) {
    const saved: Record<string, any>[] = [];
    const ctx = { ...ctxWith(saved), conn: { env: { DB: db }, owner: "a@example.com", scope: "*" }, agent: "boarder@test", via: "rest", flag: () => {} };
    const r = await capture(() => run(ctx, name, args));
    assert.ok(!(r.out instanceof Error), `${name}: ${(r.out as Error)?.message}`);
    const stored = JSON.stringify(saved) + JSON.stringify(binds);
    assert.ok(stored.includes(MARK), `${name}: 가림 표지 없음`);
    for (const v of [S, "FakePass99"]) assert.ok(!stored.includes(v) && !JSON.stringify(r.out).includes(v) && !r.logs.includes(v), `${name}: 원문이 남음`);
    assert.ok((r.out as { redacted?: number }).redacted! >= 1, `${name}: 개수 칸`);
  }
  assert.equal(maskWrites("chat_split", { thread: T, parts: [{ node: "token:자동로그인담당자창", text: "x" }] }).parts[0].node, "token:자동로그인담당자창", "노드 이름 · id 칸은 그대로");
});

test("정상 글 그대로 — 스레드 ts · ms 숫자 · 사업자번호 · 토큰 개수 · 이름만 적은 값 · 자리표 · 전화", () => {
  const keep = [
    "우리 스레드 1793000000.000001 에 답했어요",
    "하나 남은 작업 1730812345678 ms",
    "기업 고객 사업자번호 1234567890",
    "이체 기록 스레드 1793885109.123456 확인",
    "토큰: 128000 개 · 토큰 한도 80%",
    "SECRET_NAME=OPENAI_API_KEY 로 읽음",
    "GITHUB_TOKEN=${{secrets.X}} 그대로",
    "API_KEY=<your_api_key> 꼴로 적기",
    "전화 010-1234-5678 로 연락",
  ];
  for (const t of keep) { const f = masked(t); assert.equal(f.text, t); assert.equal(f.redacted, 0); }
});

test("기술장 리뷰 P2: 꺾쇠 안 진짜 값은 자리표로 안 봄", () => {
  const v = "Hunter2" + "Pass99";
  const f = masked(`PASSWORD=<${v}>`); assert.ok(!f.text.includes(v)); assert.equal(f.redacted, 1);
});

test("긴 입력 — 공백 · 낱말 되풀이가 글 칸 상한(8000자) 바로 밑에서 꼴마다 0.3초 안 · 수만 자는 바로 거절", () => {
  const N = 7900;
  const cases = [
    "비밀번호" + " ".repeat(N) + "x", "비밀번호:" + " ".repeat(N), "토큰" + " ".repeat(N) + "a1",
    "bearer" + " ".repeat(N), "Bearer" + " ".repeat(N) + fill(20), "://" + "a".repeat(N) + ":", "x://u:" + "p".repeat(N),
    "TOKEN".repeat(N / 5) + "=" + fill(10), "a_".repeat(N / 2) + "SECRET=", "eyJ".repeat(N / 3), ("eyJ" + fill(12) + ".").repeat(N / 16),
    "sk-".repeat(N / 3), "-----BEGIN AAA-----".repeat(N / 19), "계좌".repeat(N / 2), "은행 " + "1-".repeat(N / 2),
    "*".repeat(N), "0-".repeat(N / 2), "1".repeat(N), "비밀번호는 ".repeat(N / 6),
  ];
  for (const t of cases) {
    assert.ok(t.length <= 8000, "상한 밑 꼴만");
    const t0 = performance.now(); const f = filterText(t); const ms = performance.now() - t0;
    assert.ok(!("reject" in f) || f.reject !== "long");
    assert.ok(ms < 300, `${t.slice(0, 12)}… ${Math.round(ms)}ms`);
  }
  const t0 = performance.now(); assert.equal(rejected("비밀번호" + " ".repeat(30000) + "x"), "long"); assert.ok(performance.now() - t0 < 1000);
});

test("긴 글 칸은 거절(고정 문장) — 도구 입력 상한(4000자) 밖의 두 번째 울타리", () => {
  assert.equal(rejected("가".repeat(9000)), "long");
});

test("기술장 표본 — 정상 글은 전부 그대로", () => {
  const keep = [
    "ms 1801151234567 타임스탬프", "ms 1701151234567", "송금 1730812345678 ms", "이체 완료 후 영수증 1793000000",
    "입금 확인 연락처 010-1234-5678", "은행 업무 사업자번호 123-45-67890", "계좌 확인 요청 건 2026-11-05 · 2026-11-05T14:30",
    "계좌번호 110123456789 는 확인 중", "PR 7109 7111 7113 7125", "1,234,500원 입금 예정 · 한도 5,000,000원",
    "token_count=12345678", "TOKEN_TTL=3600000000", "HMAC_VERSION: v2-2026-11", "PASSWORD_MIN_LENGTH=12345678",
    "토큰 gpt-4o-mini-2024-07-18", "14:30 배포 / 15:00 확인", "PR #1234 #1235 · 커밋 abc1234def",
    "비밀번호 변경 안내 · 인증번호 6자리 · 암호화 정책 · secret: 없음", "-----BEGIN CERTIFICATE----- " + "MIIB".repeat(12) + " 공개 인증서 설명",
  ];
  for (const t of keep) { const f = masked(t); assert.equal(f.text, t, t); assert.equal(f.redacted, 0, t); }
});

test("기술장 표본 — 진짜 비밀 · 주민 · 카드 · 계좌는 그대로 가림(회귀 0)", () => {
  const rrn = "900101" + "-" + "1234568", card = ["4111", "1111", "1111", "1111"];
  const cases: [string, string][] = [
    [`키 ${FAKE.openai}`, FAKE.openai], [`키 ${FAKE.github}`, FAKE.github], [`키 ${FAKE.slack}`, FAKE.slack], [`키 ${FAKE.aws}`, FAKE.aws],
    [FAKE.bearer, FAKE.bearer.slice(7)], [FAKE.url, "FakePass99"], ["비밀번호: " + "abcd" + "1234", "abcd1234"], ["암호 " + "qwer" + "1234", "qwer1234"],
    [`주민 ${rrn}`, rrn], [`주민등록번호 ${rrn.replace("-", "")}`, rrn.replace("-", "")], [`카드 ${card.join("-")}`, card.join("-")],
    [`카드 ${card.join(" ")} 결제`, card.join(" ")], [`신한은행 계좌 ${"110-123" + "-456789"}`, "110-123-456789"],
    ["PASSWORD=" + "HUNTER2" + "_PASS99", "HUNTER2_PASS99"], ["API_KEY=" + fill(24), fill(24)],
  ];
  for (const [t, v] of cases) { const f = masked(t); assert.ok(!f.text.includes(v), t.slice(0, 14)); assert.ok(f.redacted >= 1, t.slice(0, 14)); }
  assert.equal(rejected(FAKE.pem), "pem"); assert.equal(rejected(FAKE.jwt), "jwt");
});

test("개수 · 시간 · 판 이름 예외는 낱말 단위로만 — 글자 조각(ADMIN 의 MIN · GENERATED 의 RATE)은 예외 아님", () => {
  for (const [t, v] of [["ADMIN_PASSWORD=correct-horse-battery-staple", "correct-horse-battery-staple"], ["ADMIN_TOKEN=123456789012", "123456789012"],
    ["GENERATED_TOKEN=4821-7730-1192", "4821-7730-1192"], ["adminPassword=12345678901", "12345678901"], ["TERMINAL_SECRET=alpha-beta-gamma", "alpha-beta-gamma"]] as [string, string][]) {
    const f = masked(t); assert.ok(!f.text.includes(v), t); assert.equal(f.redacted, 1, t);
  }
  for (const t of ["token_count=12345678", "TOKEN_TTL=3600000000", "PASSWORD_MIN_LENGTH=12345678", "tokenCount=12345678", "maxTokens=12345678", "SECRET_EXPIRES=1801151234567"]) {
    const f = masked(t); assert.equal(f.text, t, t); assert.equal(f.redacted, 0, t);
  }
});

test("따옴표 안 빈칸 값은 닫는 따옴표까지 통째로 가림", () => {
  const a = "alpha", b = "beta";
  for (const t of [`비밀번호: "${a} ${b}"`, `pw: '${a} ${b}'`, `토큰 "${a} ${b} 123"`, `the password is "${a} ${b}"`, `암호 “${a} ${b}”`, `API_KEY="${a} ${b} gamma"`, `비번은 「${a} ${b}」 입니다`]) {
    const f = masked(t); assert.ok(!f.text.includes(a) && !f.text.includes(b), t); assert.equal(f.redacted, 1, t);
  }
  for (const t of [`비밀번호 '재설정' 버튼`, `토큰 "128000"`, `비밀번호: "<값>"`, `token_count: "12345678"`]) assert.equal(masked(t).text, t, t);
});

test("은행 이름만 붙은 계좌 하이픈 묶음도 가림 · 전화 · 사업자번호 · 날짜는 통과", () => {
  for (const [t, v] of [[`신한 ${"110-123" + "-456789"}`, "110-123-456789"], [`국민 ${"123456" + "-01-234567"} 로`, "123456-01-234567"], [`카카오뱅크 ${"3333-12" + "-3456789"}`, "3333-12-3456789"]]) {
    const f = masked(t); assert.ok(!f.text.includes(v), t); assert.equal(f.redacted, 1, t);
  }
  for (const t of ["신한 연락처 010-1234-5678", "기업 사업자번호 123-45-67890", "하나 남은 일 2026-11-05", "우리 팀 1차 끝"]) assert.equal(masked(t).text, t, t);
});

test("비밀 이름의 숫자 · 하이픈 값은 가림 · 개수 · 시간 이름은 통과", () => {
  for (const [name, v] of [["DB_PASSWORD", "8492" + "0173"], ["DB_PASSWORD", "hunter-" + "2024-pass"], ["SECRET", "1234-5678" + "-9012"], ["TOKEN", "abcd-efgh" + "-ijkl-mnop"], ["db_secret", "abc-def" + "-ghi"], ["credentials", "required" + "-fields"]]) {
    for (const t of [`${name}=${v}`, `${name}: "${v}"`]) { const f = masked(t); assert.ok(!f.text.includes(v), t); assert.ok(f.text.startsWith(name), "이름은 남김"); assert.equal(f.redacted, 1, t); }
  }
  const env = ["DB_PASSWORD=" + "8492" + "0173", "SECRET=" + "1234-5678" + "-9012", "TOKEN=" + "abcd-efgh" + "-ijkl-mnop"].join("\n");
  assert.equal(rejected(env), "env", "숫자 · 하이픈 비밀 값 셋도 .env 통째로 셈");
});

test("JSON · dict 꼴 비밀 값도 가림 · 구분 기호 없는 산문 따옴표는 통과", () => {
  const PW = ["DB", "PASS" + "WORD"].join("_"), num = ["8492", "0173"].join(""), word = ["hunter2", "Pass99x"].join("");
  for (const [t, v] of [[`{"${PW}": "${num}"}`, num], [`{"pass` + `word":"${word}"}`, word], [`{'api_` + `key': '${word}'}`, word], [`"${PW}" = "${word}"`, word], [`{"토큰": "${word}"}`, word]] as [string, string][]) {
    const f = masked(t); assert.ok(!f.text.includes(v), t.slice(0, 14)); assert.ok(f.redacted >= 1, t.slice(0, 14));
  }
  for (const t of [`the secret "rotation-plan" 문서`, `secret "v2-2026-11" 판`, `{"token_count": "12345678"}`]) assert.equal(masked(t).text, t, t);
});

test("붙은 따옴표 값 · 빈칸만 둔 비밀 이름 값 · => · := 도 가림", () => {
  const PW = ["DB", "PASS" + "WORD"].join("_"), num = ["8492", "0173"].join(""), word = ["hunter2", "Pass99x"].join(""), grp = ["1234", "5678", "9012"].join("-");
  for (const [t, v] of [[`pass` + `word"${word}"`, word], [`비밀번호"alpha ${word}"`, word], [`비밀번호「${word}」로 바꿈`, word], [`TOKEN"${word}"`, word],
    [`${PW} "${num}"`, num], [`APP_SEC` + `RET "${grp}"`, grp], [`'pass` + `word' => '${word}'`, word], [`pass` + `word := "${word}"`, word]] as [string, string][]) {
    const f = masked(t); assert.ok(!f.text.includes(v), t.slice(0, 12)); assert.ok(f.redacted >= 1, t.slice(0, 12));
  }
  for (const t of [`비밀번호 '재설정' 버튼`, `{"type": "password"}`, `"max_tokens": "4096"`, `토큰 "128000"`]) assert.equal(masked(t).text, t, t);
});

test("구분 기호 뒤 따옴표 안이 빈칸으로 시작해도 가림 · 이름만 든 배열은 통과", () => {
  const PW = ["DB", "PASS" + "WORD"].join("_"), word = ["hunter2", "Pass99x"].join("");
  for (const [t, v] of [[`pass` + `word = " ${word}"`, word], [`pass` + `word: ' ${word} '`, word], [`비밀번호: " ${word}"`, word], [`토큰: " ${word}"`, word], [`{"${PW}": " ${word}"}`, word]] as [string, string][]) {
    const f = masked(t); assert.ok(!f.text.includes(v), t.slice(0, 12)); assert.ok(f.redacted >= 1, t.slice(0, 12));
  }
  for (const t of [`["pass` + `word", "token"]`, `fields("pass` + `word")`, `{"type": "pass` + `word"}`]) assert.equal(masked(t).text, t, t);
});

test("이름=값 사슬 — 앞 일치가 다음 이름을 삼키지 않고 마지막 값까지 가림", () => {
  const v1 = "Xk9m" + "Q2vL8pZ", v2 = "8492" + "0173aa";
  for (const [t, v] of [[`TOKEN = OLD_TOKEN = ${v1}`, v1], [`DB_PASSWORD = ADMIN_PASSWORD = ${v2}`, v2], [`API_KEY: PROD_API_KEY: ${v1}`, v1], [`SECRET=OLD_SECRET="${v1}"`, v1]] as const) {
    const f = masked(t); assert.ok(!f.text.includes(v), t); assert.ok(f.redacted >= 1, t);
  }
  const f = masked(`API_KEY: ${"Ab" + "cd1234ef"} PROD_API_KEY: ${v1}`); assert.ok(!f.text.includes(v1) && !f.text.includes("Abcd1234ef")); assert.equal(f.redacted, 2);
});

test("예외 이름은 낱말 단위 — 조각(MIN · COUNT · MODE · RATE · TTL)이 든 비밀 이름 값은 가림", () => {
  const num = "8492" + "0173", dash = "abcd-efgh" + "-ijkl-mnop", d3 = "1234-5678" + "-9012";
  const masks = [
    `ADMIN_PASSWORD=${num}`, `adminPassword=${num}`, `ACCOUNT_PASSWORD=${num}`, `SERVICE_ACCOUNT_TOKEN=${dash}`, `MODEL_API_KEY=${d3}`,
    `GENERATED_SECRET=${num}`, `SETTLEMENT_TOKEN=${num}`, `KEY_COUNT_SECRET=${num}`, `TOKEN_TTL_DB_PASSWORD=${num}`, `ADMIN_PASSWORD: "${num}"`, `PASSWORD_HINT=${num}`,
  ];
  for (const t of masks) { const f = masked(t); assert.ok(!f.text.includes(num) && !f.text.includes(dash) && !f.text.includes(d3), t); assert.equal(f.redacted, 1, t); }
  assert.equal(rejected([`ADMIN_PASSWORD=${num}`, `ACCOUNT_SECRET=${num}`, `SERVICE_ACCOUNT_TOKEN=${dash}`].join("\n")), "env");
  const keep = ["PASSWORD_COUNT=12345678", "API_KEY_VERSION=20261105", "SECRET_TTL=36000000", "token_count=12345678", "tokenCount=12345678", "PASSWORD_MIN_LENGTH=12345678", "\"max_tokens\": \"4096\"", "PASSWORD_HINT=1234"];
  for (const t of keep) assert.equal(masked(t).text, t, t);
  assert.equal(masked(["TOKEN_COUNT=12345678", "TOKEN_TTL=36000000", "API_KEY_VERSION=20261105"].join("\n")).redacted, 0, "개수 이름 세 줄은 거절 아님");
});

test("무작위 사슬 — 비밀 이름 뒤 진짜 값(구성상 비밀)은 사슬 · 구분 기호 · 따옴표가 어떻든 남지 않음", () => {
  let seed = 7109; const r = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648, pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const AL = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789", rnd = (n: number) => Array.from({ length: n }, () => AL[Math.floor(r() * AL.length)]).join("");
  const names = ["TOKEN", "OLD_TOKEN", "DB_PASSWORD", "ADMIN_PASSWORD", "adminPassword", "API_KEY", "PROD_API_KEY", "SECRET", "db_secret", "SERVICE_ACCOUNT_TOKEN", "MODEL_API_KEY", "KEY_COUNT_SECRET"];
  const seps = ["=", " = ", ": ", ":=", " => ", "=\"", "='"];
  for (let i = 0; i < 3000; i++) {
    const secrets: string[] = [], parts: string[] = [];
    for (let k = 1 + Math.floor(r() * 4); k > 0; k--) {
      if (r() < 0.4) { parts.push(pick(names) + pick(seps) + pick(names.filter(n => /^[A-Z_]+$/.test(n)))); continue; }   // 사슬 고리(이름만 적은 값)
      const v = rnd(10 + Math.floor(r() * 8)); secrets.push(v);
      const sep = pick(seps), q = sep.endsWith("\"") ? "\"" : sep.endsWith("'") ? "'" : "";
      parts.push(pick(names) + sep + v + q);
    }
    const t = parts.join(pick([" ", "\n", " · "])), f = filterText(t);
    if ("reject" in f) continue;   // .env 통째 거절은 저장 0
    for (const v of secrets) assert.ok(!f.text.includes(v), t);
  }
});

test(":= 꼴 — 개수 이름은 통과 · 비밀 이름 값은 가림", () => {
  assert.equal(masked("HMAC_VERSION:=59605378").text, "HMAC_VERSION:=59605378");
  const v = "8492" + "0173aa"; const f = masked(`ADMIN_PASSWORD:=${v}`); assert.ok(!f.text.includes(v)); assert.equal(f.redacted, 1);
});

const jj = (...p: string[]) => p.join("");
test("TOKEN(S) 하나뿐 예외는 바로 앞 낱말이 토큰 개수 낱말일 때만", () => {
  const num = jj("8492", "0173"), hy = jj("abcd", "-efgh", "-ijkl");
  for (const [t, v] of [[`RATE_LIMIT_BYPASS_TOKEN=${num}`, num], [`LIMIT_OVERRIDE_TOKEN=${hy}`, hy], [`TTL_TOKEN=${num}`, num]] as [string, string][]) {
    const f = masked(t); assert.ok(!f.text.includes(v), t.slice(0, 14)); assert.equal(f.redacted, 1, t.slice(0, 14));
  }
  for (const t of [`max_tokens=${num}`, `NUM_TOKENS=${num}`, `input_tokens: ${num}`, `TOKEN_COUNT=${num}`, `"max_tokens": "4096"`]) assert.equal(masked(t).text, t, t);
});

test("원문 짝 재검사는 그 이름 바로 뒤 한 자리만 — 같은 낱말이 글 다른 곳에 있어도 그대로", () => {
  for (const [t, want] of [[`SECRET: "release" · release 노트 배포`, `SECRET: [가림] · release 노트 배포`], [`pass` + `word = "main" · main 브랜치 머지`, `pass` + `word = [가림] · main 브랜치 머지`]]) {
    const f = masked(t); assert.equal(f.text, want, t); assert.equal(f.redacted, 1, t);
  }
});

test("구분 기호 뒤 = · > 가 더 붙은 값도 가림(값 속 다른 꼴이 먼저 가려져도) · := 개수 이름은 통과", () => {
  const hp = jj("Hunter2", "Pass99"), sk = jj("sk-", "abcdefghijklmnopqrstuv"), PW = jj("DB_", "PASS", "WORD"), rrn = jj("900101", "-1234567");
  for (const t of [`url?pass${"word"}==${hp}&api_key=${sk}`, `${PW}==${hp}/${sk}`, `${PW}==${hp}:${rrn}`, `pass${"word"}=>=${hp}&key=${sk}`, `adminPass${"word"}==${sk}」${hp}`]) {
    const f = masked(t); assert.ok(!f.text.includes(hp) && !f.text.includes(sk), t.slice(0, 16));
  }
  for (const t of ["HMAC_VERSION:=59605378", "TOKEN_COUNT := 12345678", "A:=B"]) assert.equal(masked(t).text, t, t);
});

test("닫는 따옴표가 빠진 값이 다음 이름을 먹지 않음 — 뒤 값도 가림", () => {
  const x = jj("Xk9mQ2", "vL8pZ");
  for (const t of [`TOKEN": "${x} pass${"word"}": "${x}`, `adminPass${"word"}": "${x} adminPass${"word"}": "${x}`, `pass${"word"}": "${x}&DB_PASS${"WORD"}": "${x}`]) {
    const f = filterText(t); assert.ok("reject" in f || !f.text.includes(x), t.slice(0, 16));
  }
});

test("따옴표 값 뒤에 : · = 가 와도 안 끝이 비밀 이름이 아니면 값으로 가림 · 닫는 따옴표 빠진 값은 다음 이름을 안 먹음", () => {
  const ph = jj("open ses", "ame 42"), x = jj("Xk9mQ2", "vL8pZ"), y = jj("q7Rt", "Zx2mWp");
  for (const t of [`비밀번호 "${ph}": 오늘부터`, `pass` + `word "${ph}"=정답`, `{"pass` + `word": "${ph}":1}`]) { const f = filterText(t); assert.ok("reject" in f || (!f.text.includes("sesame") && !f.text.includes(ph)), t.slice(0, 14)); }
  for (const t of [`TOKEN": "${x}&TOKEN": "${y}`, `TOKEN": "${x} pass` + `word": "${y}`]) { const f = filterText(t); assert.ok("reject" in f || (!f.text.includes(x) && !f.text.includes(y)), t.slice(0, 14)); }
});

test("토큰 개수 예외: 새 낱말(INPUT · PROMPT …)은 복수 TOKENS 만, 값은 숫자뿐만", () => {
  const num = jj("8492", "0173"), hy = jj("ABCD-12", "34-EFGH-5678");
  for (const [t, v] of [[`INPUT_TOKEN=${hy}`, hy], [`PROMPT_TOKEN=${num}`, num], [`OUTPUT_TOKEN="${hy}"`, hy], [`TOTAL_TOKEN=${num}`, num], [`max_tokens=${hy}`, hy]] as [string, string][]) {
    const f = masked(t); assert.ok(!f.text.includes(v), t.slice(0, 14));
  }
  for (const t of [`input_tokens=${num}`, `max_tokens=${num}`, `MAX_TOKEN=${num}`, `output_tokens: ${num}`]) assert.equal(masked(t).text, t, t);
});

test("구분 기호 둘레 빈칸 · 줄바꿈 16자 · 이름 앞 80자까지 가림", () => {
  const x = jj("Xk9mQ2", "vL8pZ");
  for (const t of [`api_` + `key=     ${x}`, `pass` + `word:\n    ${x}`, `TOKEN\t\t\t\t\t= ${x}`, jj("CLOUDFLARE_", "X".repeat(45), "_API_TOKEN=", x)]) { const f = masked(t); assert.ok(!f.text.includes(x), t.slice(0, 14)); }
});

test("원문 짝 재검사는 원문의 사이 글자(「 is 」) 그대로 자리를 찾음", () => {
  const v = jj("a b ", "c1x9");
  const f = filterText(`API_TOKEN is "${v}"`); assert.ok("reject" in f || !f.text.includes(v));
});

test("따옴표 값 끝 낱말이 비밀 이름이어도, 뒤에 여는 따옴표가 없으면 값으로 가림", () => {
  for (const [t, v] of [[`비밀번호 "${jj("dragon fly ", "secret")}": 오늘부터`, "dragon"], [`pass` + `word: "${jj("x9Q ", "token")}": 힌트`, "x9Q"]] as [string, string][]) {
    const f = filterText(t); assert.ok("reject" in f || !f.text.includes(v), t.slice(0, 14));
  }
});

test("비교식 · 화살표 함수의 코드 꼴 값은 그대로 · 맨 낱말 값은 가림", () => {
  for (const t of ["if (pass" + "word === undefined) return", ".map(token => token.trim())", "apiKey => apiKey.active", "token == nullOrEmpty"]) assert.equal(masked(t).text, t, t);
  for (const v of [jj("Hunter2", "Pass99"), jj("rzTThf", "yjRvx")]) { const f = masked(`DB_PASS` + `WORD => ${v}`); assert.ok(!f.text.includes(v)); }
});

test("== · => 뒤 점 든 값은 첫 마디가 이름 · process · this · self 일 때만 코드로 봄", () => {
  for (const [t, v] of [[`pass` + `word==${jj("Hunter2", ".Pass99")}`, "Pass99"], [`api_` + `key=>${jj("correct", ".horse.battery")}`, "horse"], [`pass` + `word => ${jj("some", ".value")}`, "value"], [`pass` + `word==${jj("Hunter2", "Pass99")}()`, "Pass99"]] as [string, string][]) {
    const f = filterText(t); assert.ok("reject" in f || !f.text.includes(v), t.slice(0, 16));
  }
  for (const t of ["token => token.id", "token === process.env.TOKEN", "secret === null", ".map(token => token.trim())"]) assert.equal(masked(t).text, t, t);
});

test("따옴표 값 앞 == 도 사이로 받음", () => {
  const f = filterText(`비밀번호==“${jj("open ses", "ame 42")}”`); assert.ok("reject" in f || (!f.text.includes("sesame") && !f.text.includes("open")));
});

test("닫는 따옴표 빠진 값이 다음 이름을 먹어도 뒷조각 · 같은 이름 뒤 값이 남지 않음(가리거나 거절)", () => {
  const ph = jj("open ses", "ame 42"), x = jj("Xk9mQ2", "vL8pZ"), y = jj("q7Rt", "Zx2mWp");
  for (const [t, vs] of [[`INPUT_TOKEN == "${y} 끝&OLD_TOKEN == "${ph}": x`, [y, "sesame 42"]], [`pw == "「${x}」 pw == "${y}" 끝`, [x, y]], [`INPUT_TOKEN: "${y} 끝&OLD_TOKEN: "${ph}": x`, [y, "sesame 42"]]] as [string, string[]][]) {
    const f = filterText(t); assert.ok("reject" in f || vs.every(v => !f.text.includes(v)), t.slice(0, 18));
  }
});
