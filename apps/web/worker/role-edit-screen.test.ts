// node --test --no-warnings --experimental-transform-types apps/web/worker/role-edit-screen.test.ts
// 설정 › 노드 「역할」 카드(legacy/settings.js 의 역할 고치기 덩어리 ROLE_F ~ roleMount): 새 의존성 없이 그 덩어리만 node:vm 으로 돌려 그리기 · 바뀐 칸 · 막기 · 결과 줄을 봄.
// 실제 브라우저 그림(PC 1440 · 폰 390)과 누르기 흐름은 PR 의 화면 전후 칸.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("./legacy/settings.js", import.meta.url), "utf8");
const line = (re: RegExp) => { const m = SRC.match(re); assert.ok(m, String(re)); return m![0]; };
// 덩어리 찾기는 코드로(공개 판은 주석을 뺌): const ROLE_F ~ function roleMount 앞
const at = SRC.indexOf("  const ROLE_F = "), end = SRC.indexOf("  function roleMount(");
assert.ok(at > 0 && end > at);
const BLOCK = SRC.slice(at, end);
const ctx: any = {};
vm.runInNewContext(line(/^  const esc = .*$/m) + "\n" + line(/^  const btn = .*$/m) + "\n" + BLOCK
  + "\nthis.R = {roleWins, roleDiff, roleBad, roleDone, roleSave, roleHtml, roleNow, roleCreate};", ctx);
const { roleWins, roleDiff, roleBad, roleDone, roleSave, roleHtml, roleNow, roleCreate } = ctx.R;
const st = (o = {}) => ({ open: null, busy: null, msg: {}, vals: {}, ...o });
const role = (o = {}) => ({ id: "r1", name: "기술장", brief: "리포 · PR 담당", instructions: "PR 은 리뷰 뒤 머지", source: "bot", updated_at: 1, windows: [{ id: "ew_a", name: "기술장", state: "idle" }, { id: "ew_b", name: "기술장", state: "busy" }, { id: "ew_c", name: "기술장", state: "parked" }], ...o });

test("역할이 없으면 카드를 그리지 않음(빈 글) — 주인 · 역할 없는 회원 화면 그대로", () => {
  assert.equal(roleHtml([], st()), ""); assert.equal(roleHtml(null, st()), ""); assert.equal(roleHtml(undefined, st()), "");
});

test("역할마다 한 줄: 이름 · 설명 한 줄 · 붙은 창 수와 상태; 기존 카드 꼴; 접힌 채 고치기 칸 없음", () => {
  const h = roleHtml([role(), role({ id: "r2", name: "비서실장", brief: "", windows: [] })], st());
  assert.match(h, /^<div class="bxs-sech">역할<\/div><div class="bxs-card" data-rl>/);
  assert.ok(h.includes("<b>기술장</b>") && h.includes("리포 · PR 담당") && h.includes("창 3곳 · 쉼 1 · 일함 1 · 주차 1"));
  assert.ok(h.includes("<b>비서실장</b>") && h.includes("설명 없음") && h.includes("붙은 창 없음"));
  assert.ok(!h.includes("data-rlf") && !h.includes("data-rls"));
  assert.equal((h.match(/data-rlo="/g) || []).length, 2);
  assert.ok(!/…중|중<|[<]{2}|「|」/.test(h.replace(/<[^>]+>/g, "")));
});

test("모든 값 이스케이프(이름 · 설명 · 지시 · id · 창 상태)", () => {
  const x = '<img src=x onerror="alert(1)">&\'';
  const h = roleHtml([role({ id: 'r"><b>', name: x, brief: x, instructions: x, windows: [{ id: "w", name: x, state: x }] })], st({ open: 'r"><b>', msg: { 'r"><b>': { t: x, bad: true } } }));
  assert.ok(!h.includes("<img") && !h.includes('r"><b>') && h.includes('data-rli="r&quot;&gt;&lt;b&gt;"'));
  assert.ok(h.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;"));
});

test("펼치면 이름(40) · 목표(200) · 지시(3000, textarea) · 권한 · 보고 라인(1000, textarea) · 저장 한 단추; 고친 값 · 글자 수 · 넘침 표시", () => {
  const h = roleHtml([role()], st({ open: "r1", vals: { r1: { name: "a".repeat(41) } } }));
  assert.match(h, /<input class="bxs-in" data-rlf="name" value="a{41}"/);
  assert.match(h, /<input class="bxs-in" data-rlf="brief" value="리포 · PR 담당"/);
  assert.match(h, /<textarea class="bxs-in" rows="8" data-rlf="instructions"[^>]*>PR 은 리뷰 뒤 머지<\/textarea>/);
  assert.ok(h.includes('class="bxs-mut bad" data-rlc="name">41/40') && h.includes('data-rlc="brief">10/200') && h.includes('data-rlc="instructions">12/3000'));
  assert.equal((h.match(/data-rls="/g) || []).length, 1);
  assert.ok(h.includes('aria-expanded="true"'));
  assert.ok(h.includes('<span class="bxs-mut">목표</span>') && !h.includes('<span class="bxs-mut">설명</span>'));
  assert.match(h, /<textarea class="bxs-in" rows="3" data-rlf="perms" aria-label="권한" placeholder="쓸 수 있는 도구 · 커넥터, 하면 안 되는 것"><\/textarea>/);
  assert.match(h, /<textarea class="bxs-in" rows="3" data-rlf="supervise" aria-label="보고 라인" placeholder="[^"]+"><\/textarea>/);
  assert.ok(h.includes('data-rlc="perms">0/1000') && h.includes('data-rlc="supervise">0/1000'));
  const f = roleHtml([role({ perms: "쓸 수 있는 도구: Read", supervise: "리드에게 보고" })], st({ open: "r1", vals: { r1: { supervise: "a".repeat(1001) } } }));
  assert.ok(f.includes('data-rlf="perms" aria-label="권한" placeholder="쓸 수 있는 도구 · 커넥터, 하면 안 되는 것">쓸 수 있는 도구: Read</textarea>'));
  assert.ok(f.includes('class="bxs-mut bad" data-rlc="supervise">1001/1000'));
});

test("저장 중은 스피너(g-spin) · 단추 잠금, 글자 「…중」 없음; 실패는 붉은 한 줄, 결과는 보통 줄", () => {
  const busy = roleHtml([role()], st({ open: "r1", busy: "r1" }));
  assert.match(busy, /<button type="button" class="bxs-btn pri" data-rls="r1" disabled aria-busy="true" aria-label="저장"><i class="g g-spin" aria-hidden="true"><\/i><\/button>/);
  assert.ok(!/중</.test(busy));
  assert.ok(roleHtml([role()], st({ open: "r1", msg: { r1: { t: "없는 역할이에요", bad: true } } })).includes('<p class="bxs-mut bad" data-rlm role="status"'));
  assert.ok(roleHtml([role()], st({ open: "r1", msg: { r1: { t: "열린 창 1곳에 바로 넣었어요", bad: false } } })).includes('<p class="bxs-mut" data-rlm role="status" style="min-width:0;overflow-wrap:anywhere">열린 창 1곳에 바로 넣었어요</p>'));
});

test("바뀐 칸만 · 앞뒤 공백은 서버처럼 떼고 견줌", () => {
  const r = role();
  assert.deepEqual({ ...roleDiff(r, {}) }, {});
  assert.deepEqual({ ...roleDiff(r, { name: " 기술장 ", brief: "리포 · PR 담당" }) }, {});
  assert.deepEqual({ ...roleDiff(r, { name: "기술장", instructions: " 새 지시\n둘째 줄 " }) }, { instructions: "새 지시\n둘째 줄" });
  assert.deepEqual({ ...roleDiff(r, { brief: "" }) }, { brief: "" });
});

test("저장 전 막기: 빈 이름 · 빈 지시 · 글자 수 넘침(설명 비우기는 됨)", () => {
  assert.equal(roleBad({ name: "" }), "이름을 넣어 주세요");
  assert.equal(roleBad({ instructions: "" }), "지시를 넣어 주세요");
  assert.equal(roleBad({ name: "a".repeat(41) }), "이름은 40자까지예요(지금 41자)");
  assert.equal(roleBad({ brief: "a".repeat(201) }), "목표는 200자까지예요(지금 201자)");
  assert.equal(roleBad({ perms: "a".repeat(1001) }), "권한은 1000자까지예요(지금 1001자)");
  assert.equal(roleBad({ supervise: "a".repeat(1001) }), "보고 라인은 1000자까지예요(지금 1001자)");
  assert.equal(roleBad({ perms: "", supervise: "" }), "");   // 비우기는 됨
  // 「-」 시작: 이름 · 목표 · 지시는 막고(서버와 같음), 권한 · 보고 라인은 목록 꼴이라 받음
  assert.equal(roleBad({ name: "-a" }), "이름은 -로 시작할 수 없어요");
  assert.equal(roleBad({ brief: "- 목표" }), "목표는 -로 시작할 수 없어요");
  assert.equal(roleBad({ instructions: "-x" }), "지시는 -로 시작할 수 없어요");
  assert.equal(roleBad({ name: "a", instructions: "b", perms: "- 읽기만\n- 배포 금지", supervise: "- 리드" }), "");
  assert.equal(roleBad({ instructions: "a".repeat(3001) }), "지시는 3000자까지예요(지금 3001자)");
  assert.equal(roleBad({ name: "a".repeat(40), brief: "", instructions: "a".repeat(3000) }), "");
});

test("결과 한 줄: 바로 넣음 · 줄 섬 · 못 넣음, 창 없음", () => {
  const D = (...s: string[]) => s.map((state, i) => ({ window: "w" + i, state }));
  assert.equal(roleDone(D("sent", "sent", "queued", "failed")), "열린 창 2곳에 바로 넣었어요 · 1곳은 줄 서 있어요 · 1곳은 못 넣었어요(다음에 다시 열 때 새 지시로)");
  assert.equal(roleDone(D("sent")), "열린 창 1곳에 바로 넣었어요");
  assert.equal(roleDone(D("queued", "failed")), "열린 창 1곳은 줄 서 있어요 · 1곳은 못 넣었어요(다음에 다시 열 때 새 지시로)");
  assert.equal(roleDone([]), "저장했어요 · 열린 창이 없어 다음에 창을 열 때 새 지시로 시작해요");
});

test("저장: 바뀐 칸만 보냄 · 막힌 입력은 안 보냄 · 서버 400 글은 그대로 한 줄", async () => {
  const calls: any[] = [];
  const ok = async (m: string, p: string, b: unknown) => { calls.push([m, p, b]); return { ok: true, role_id: "r/1", delivery: [{ window: "w", state: "sent" }, { window: "x", state: "queued" }] }; };
  const r = role({ id: "r/1" });
  const a = await roleSave(ok, r, { name: "기술장", instructions: "새 지시" });
  assert.equal(a.ok, true); assert.equal(a.line, "열린 창 1곳에 바로 넣었어요 · 1곳은 줄 서 있어요");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["POST", "api/me/roles/r%2F1", { instructions: "새 지시" }]]);
  calls.length = 0;
  assert.deepEqual({ ...(await roleSave(ok, r, { name: "  " })) }, { ok: false, line: "이름을 넣어 주세요" });
  assert.deepEqual({ ...(await roleSave(ok, r, { brief: "a".repeat(201) })) }, { ok: false, line: "목표는 200자까지예요(지금 201자)" });
  assert.deepEqual({ ...(await roleSave(ok, r, { name: "기술장" })) }, { ok: null, line: "바뀐 칸이 없어요" });
  assert.equal(calls.length, 0);
  const bad = async () => { throw Object.assign(new Error("역할 입력이 맞지 않아요(이름 40자 · 설명 200자 · 지시 3000자)"), { status: 400 }); };
  assert.deepEqual({ ...(await roleSave(bad, r, { instructions: "새 지시" })) }, { ok: false, line: "역할 입력이 맞지 않아요(이름 40자 · 설명 200자 · 지시 3000자)" });
  assert.deepEqual({ ...(await roleSave(bad, r, { instructions: "-x" })) }, { ok: false, line: "지시는 -로 시작할 수 없어요" });   // 서버가 거절할 꼴은 보내기 전에
});

const OLD_HTML = "<div class=\"bxs-sech\">역할</div><div class=\"bxs-card\" data-rl><div data-rli=\"r1\"><div class=\"bxs-row between\" style=\"flex-wrap:nowrap;cursor:pointer\" data-rlo=\"r1\"><div style=\"min-width:0;overflow-wrap:anywhere\"><b>기술장</b><p class=\"bxs-mut\" style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">리포 · PR 담당</p><p class=\"bxs-mut\">창 2곳 · 쉼 1 · 주차 1</p></div><button type=\"button\" class=\"bxs-btn sm ghost\" aria-expanded=\"false\" aria-label=\"기술장 고치기\">고치기</button></div></div><div data-rli=\"r2\" style=\"border-top:1px solid var(--line);padding-top:12px\"><div class=\"bxs-row between\" style=\"flex-wrap:nowrap;cursor:pointer\" data-rlo=\"r2\"><div style=\"min-width:0;overflow-wrap:anywhere\"><b>비서실장</b><p class=\"bxs-mut\" style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">설명 없음</p><p class=\"bxs-mut\">붙은 창 없음</p></div><button type=\"button\" class=\"bxs-btn sm ghost\" aria-expanded=\"false\" aria-label=\"비서실장 고치기\">고치기</button></div></div></div>";
const OLD_ROLES = () => [role({ windows: [{ id: "ew_a", name: "기술장", state: "idle" }, { id: "ew_b", name: "기술장", state: "parked" }] }), role({ id: "r2", name: "비서실장", brief: "", instructions: "x", source: "import:a", windows: [] })];

test("주인 · 엔진 없는 회원: 화면이 이 판 전과 글자 하나까지 같음(새 역할 단추 없음 · 지금 줄 없음)", () => {
  assert.equal(roleHtml(OLD_ROLES(), st()), OLD_HTML);
  assert.equal(roleHtml(OLD_ROLES(), st(), false), OLD_HTML);
  // 새 서버 칸(권한 · 보고 라인 · pending false · 줄 없는 창)이 실려도 접힌 화면은 같음
  const more = OLD_ROLES().map((r: any) => ({ ...r, perms: "쓸 수 있는 도구: Read", supervise: "리드", pending: false, windows: r.windows.map((w: any) => ({ ...w, last: null, watch: "" })) }));
  assert.equal(roleHtml(more, st(), false), OLD_HTML);
  for (const e of [false, undefined, null]) { assert.equal(roleHtml([], st(), e), ""); assert.equal(roleHtml(null, st(), e), ""); }
  // 주인 보드: 역할 목록을 부르지 않고(rolesP = null) 칸을 끼우지 않음 — 엔진을 쓰는 회원 · 역할 있는 회원만 끼움
  assert.match(SRC, /const rolesP = OWNER \? Promise\.resolve\(null\) : api\('GET', 'api\/me\/roles'\)/);
  assert.match(SRC, /roleOn = roles\.length > 0 \|\| rj\?\.engine === true,/);
  assert.match(SRC, /if \(roleOn\) roleMount\(roleBox, roles, rj\?\.engine === true\);/);
  assert.match(SRC, /\+ \(roleOn \? '<div data-rlslot><\/div>' : ''\)/);   // 칸을 끼울 자리도 같은 조건(역할 없는 엔진 회원도 칸이 보이게)
});

test("엔진 쓰는 회원: 머리에 새 역할 단추(역할이 없어도), 빈 칸 안내; 누르면 같은 입력 폼 + 만들기", () => {
  const e = roleHtml([], st(), true);
  assert.equal(e, '<div class="bxs-sech bxs-row between"><span>역할</span><button type="button" class="bxs-btn sm" data-rla aria-expanded="false">새 역할</button></div><div class="bxs-card" data-rl><p class="bxs-mut" style="margin:0">역할이 아직 없어요. 새 역할을 만들면 그 일을 맡을 창이 열려요.</p></div>');
  const f = roleHtml([], st({ add: { open: true, busy: false, vals: { name: "문서 정리" }, msg: null } }), true);
  assert.ok(f.includes('data-rla aria-expanded="true">닫기</button>') && f.includes("<div data-rlnew><b>새 역할</b>") && !f.includes("역할이 아직 없어요"));
  for (const k of ["name", "brief", "instructions", "perms", "supervise"]) assert.ok(f.includes(`data-rlf="${k}"`), k);
  assert.ok(f.includes('data-rlf="name" value="문서 정리"') && f.includes('data-rlc="name">5/40'));
  assert.match(f, /<button type="button" class="bxs-btn pri" data-rlk>만들기<\/button>/);
  const busy = roleHtml([role()], st({ add: { open: true, busy: true, vals: {}, msg: null } }), true);
  assert.match(busy, /<button type="button" class="bxs-btn pri" data-rlk disabled aria-busy="true" aria-label="만들기"><i class="g g-spin" aria-hidden="true"><\/i><\/button>/);
  assert.ok(busy.includes('<div data-rlnew style="border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:12px">') && busy.includes('data-rli="r1"'));
  const bad = roleHtml([], st({ add: { open: true, busy: false, vals: {}, msg: { t: "이름을 넣어 주세요", bad: true } } }), true);
  assert.ok(bad.includes('<p class="bxs-mut bad" data-rlm role="status"'));
  const done = roleHtml([role()], st({ add: { open: false, busy: false, vals: {}, msg: { t: "<x> 역할을 만들고 창을 열었어요", bad: false } } }), true);
  assert.ok(done.includes('<p class="bxs-mut" data-rlam role="status" style="margin:0 0 12px">&lt;x&gt; 역할을 만들고 창을 열었어요</p>'));
  assert.ok(!/…중|중<|「|」/.test((e + f + busy + done).replace(/<[^>]+>/g, "")));
});

test("지금 하는 일: 붙은 창 중 가장 새 줄 — 상태 한 줄이 있으면 그것, 없으면 종류 · 글; 창 상태 앞에; 이스케이프; 미룬 역할 안내", () => {
  const w = (o: any) => ({ id: "w", name: "기술장", state: "idle", last: null, watch: "", ...o });
  assert.equal(roleNow([]), ""); assert.equal(roleNow(undefined), ""); assert.equal(roleNow([w({})]), "");
  assert.equal(roleNow([w({ state: "busy", last: { kind: "진행", text: "시험 고치는 중", at: 5 } })]), "지금 · 일함 — 진행 · 시험 고치는 중");
  assert.equal(roleNow([w({ last: { kind: "status", text: "쉼 · 깨움 21:30", at: 9 }, watch: "쉼 · 깨움 21:30" }), w({ state: "busy", last: { kind: "진행", text: "옛 줄", at: 3 } })]), "지금 · 쉼 — 쉼 · 깨움 21:30");
  assert.equal(roleNow([w({ state: "odd", last: { kind: "막힘", text: "리뷰 기다림", at: 1 } })]), "지금 · 막힘 · 리뷰 기다림");
  const x = '<img src=x onerror="alert(1)">';
  const h = roleHtml([role({ windows: [w({ state: "busy", last: { kind: "진행", text: x, at: 1 } })] })], st());
  assert.ok(h.includes('<p class="bxs-mut" data-rlnow style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">지금 · 일함 — 진행 · &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>') && !h.includes("<img"));
  assert.equal(roleWins([], true), "기기에서 엔진을 켜면 창이 열려요"); assert.equal(roleWins([], false), "붙은 창 없음");
  assert.ok(roleHtml([role({ windows: [], pending: true })], st(), true).includes("기기에서 엔진을 켜면 창이 열려요"));
});

test("새 역할 보내기: 이름 · 지시는 꼭, 나머지는 쓴 칸만(앞뒤 공백 뗌) · 넘침은 안 보냄 · 미룸 · 서버 오류 한 줄", async () => {
  const calls: any[] = [];
  const ok = (pending: boolean) => async (m: string, p: string, b: unknown) => { calls.push([m, p, b]); return { ok: true, role_id: "r_x", window: pending ? null : "ew_x", pending }; };
  const a = await roleCreate(ok(false), { name: " 문서 정리 ", instructions: "회의록 정리", brief: " ", perms: " Read ", supervise: "" });
  assert.deepEqual({ ...a }, { ok: true, id: "r_x", line: "문서 정리 역할을 만들고 창을 열었어요" });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["POST", "api/me/roles", { name: "문서 정리", instructions: "회의록 정리", perms: "Read" }]]);
  assert.equal((await roleCreate(ok(true), { name: "a", instructions: "b" })).line, "a 역할을 만들었어요 · 기기에서 엔진을 켜면 창이 열려요");
  calls.length = 0;
  assert.deepEqual({ ...(await roleCreate(ok(false), { instructions: "b" })) }, { ok: false, line: "이름을 넣어 주세요" });
  assert.deepEqual({ ...(await roleCreate(ok(false), { name: "a" })) }, { ok: false, line: "지시를 넣어 주세요" });
  assert.deepEqual({ ...(await roleCreate(ok(false), { name: "a", instructions: "b", supervise: "x".repeat(1001) })) }, { ok: false, line: "보고 라인은 1000자까지예요(지금 1001자)" });
  assert.equal(calls.length, 0);
  const bad = async () => { throw Object.assign(new Error("한 시간에 30창까지예요"), { status: 429 }); };
  assert.deepEqual({ ...(await roleCreate(bad, { name: "a", instructions: "b" })) }, { ok: false, line: "한 시간에 30창까지예요" });
});
