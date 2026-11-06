import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`./legacy/${f}`, import.meta.url), "utf8");
const shell = read("shell.js"), ea = read("ea.js"), settings = read("settings.js"), x = read("x.js");
const line = (src: string, re: RegExp) => { const m = src.match(re); assert.ok(m, `줄 찾음: ${re}`); return m![0]; };

const FIVE = ["primary", "company", "personal", "dgit", "shop"];
const OWNER_AREAS = [{ key: "primary", name: "프라이머리", lead: "%1" }, { key: "company", name: "회사", lead: "%10" }, { key: "personal", name: "퍼스널", lead: "%11" }, { key: "dgit", name: "DGit", lead: "%12" }, { key: "shop", name: "가게", lead: "%13" }];
const FACE_PICK = { seed: "picked", hue: 40 }, BOT_FACE = { seed: "bot", hue: 200 };
type Case = { window: any; D: any; CH?: string[]; TURN?: string; AGENT_CUSTOM?: any };
const CASES: Record<"old" | "member" | "on", Case> = {
  old: { window: {}, D: { areas: OWNER_AREAS }, CH: FIVE, TURN: "내 차례", AGENT_CUSTOM: { primary: FACE_PICK } },
  member: { window: { HB_CH: ["primary"], HB_MEMBER: { email: "m@x", name: "모찌", turn: "내 차례", bot: "봇" }, HB_CAPS: { invite: false, org_links: false, mainline: false, session_files: false, start_tab: true, push: false } },
    D: { areas: [{ key: "primary", name: "Primary", lead: "%1", avatar: BOT_FACE }, { key: "m0", name: "기술", lead: "%2" }, { key: "m1", name: "영업", lead: "%3" }] }, CH: ["primary"], TURN: "내 차례", AGENT_CUSTOM: {} },
  on: { window: { HB_CH: FIVE, HB_MEMBER: { email: "o@x", name: "Owner", turn: "내 차례", bot: "Primary" }, HB_CAPS: { invite: true, org_links: true, mainline: true, session_files: true, start_tab: false, push: true } },
    D: { areas: OWNER_AREAS.map(a => a.key === "primary" ? { ...a, avatar: FACE_PICK } : { ...a, lead_name: a.name + " 리드" }) }, CH: FIVE, TURN: "내 차례", AGENT_CUSTOM: { primary: FACE_PICK } },
};
const ARGS = ["window", "D", "CH", "TURN", "AGENT_CUSTOM"] as const;
const run = (src: string, c: Case, ret: string, extra: Record<string, unknown> = {}) =>
  new Function(...ARGS, ...Object.keys(extra), src + `\n; return ${ret};`)(c.window, c.D, c.CH, c.TURN, c.AGENT_CUSTOM, ...Object.values(extra));

// ── shell.js 도우미 값 ──
const HELPERS = ["turnT", "capOn", "mainOnly", "xHeads", "priFace"].map(n => line(shell, new RegExp(`^  const ${n} = .*$`, "m"))).join("\n");
const helpers = (c: Case) => run(HELPERS, c, "{turnT, capOn, xHeads, priFace}");

test("S3 · S7 · O7 차례 글: 보드 TURN 먼저, 없으면 서버 HB_MEMBER.turn, 그것도 없으면 '내 차례'(지금 주인)", () => {
  assert.equal(helpers(CASES.old).turnT(), "내 차례");
  assert.equal(helpers({ ...CASES.old, TURN: undefined }).turnT(), "내 차례", "옛 주인 · 보드 TURN 없음");
  assert.equal(helpers(CASES.member).turnT(), "내 차례");
  assert.equal(helpers({ ...CASES.member, TURN: undefined }).turnT(), "내 차례", "회원 · 서버 값만");
  assert.equal(helpers({ ...CASES.on, TURN: undefined }).turnT(), "내 차례", "켠 주인 · 서버 값");
});

test("S16 기능 문: HB_CAPS 값, 없으면 참(지금 주인) — 초대는 옛 주인 · 켠 주인 보임, 회원 숨김", () => {
  assert.equal(helpers(CASES.old).capOn("invite"), true);
  assert.equal(helpers(CASES.member).capOn("invite"), false);
  assert.equal(helpers(CASES.on).capOn("invite"), true);
  assert.match(shell, /\(capOn\('invite'\) \? mi\('invite', I\.invite, '초대'\) : ''\)/);
  assert.doesNotMatch(shell, /window\.HB_MEMBER \? '' : mi\('invite'/);
});

test("S5 · S12 열 머리: 채널 표(CH)에 없는 영역 키만(회원 m0 · m1) — 옛 주인 · 켠 주인 영역 채널은 CH 줄 한 번만", () => {
  const keys = (c: Case) => helpers(c).xHeads().map((a: any) => a.key);
  assert.deepEqual(keys(CASES.old), []);
  assert.deepEqual(keys(CASES.member), ["m0", "m1"]);
  assert.deepEqual(keys(CASES.on), []);
  const on2 = { ...CASES.on, D: { areas: [...CASES.on.D.areas, { key: "t0", name: "태스크 열", lead: "%40" }] } };
  assert.deepEqual(keys(on2), ["t0"], "켠 주인에게 CH 밖 열(canon t0)이 실려 오면 그것만 열 머리");
});

test("S5 에이전트 칸 MA: 옛 주인 · 켠 주인 빈 목록(영역 두 번 안 나옴), 회원은 열 머리 그대로", () => {
  const MA = line(shell, /^    const MA = .*$/m);
  const byPane = { "%1": { kind: "primary" }, "%2": { kind: "lead" }, "%3": { kind: "lead", tk: true }, "%10": { kind: "arealead" }, "%11": { kind: "arealead" }, "%12": { kind: "arealead" }, "%13": { kind: "arealead" } };
  const ma = (c: Case) => run(HELPERS + "\n" + MA, c, "MA.map(a => a.key)", { byPane });
  assert.deepEqual(ma(CASES.old), []);
  assert.deepEqual(ma(CASES.member), ["m0"], "업무 판(tk, 부서 아님) 머리는 지금처럼 뺌");
  assert.deepEqual(ma(CASES.on), []);
  assert.doesNotMatch(MA, /HB_CH/);
});

test("S12 「채널」 칸 myNodes: 열 머리 판은 CH 밖 열일 때만 뺌 — 옛 주인 · 켠 주인 노드는 다 남음", () => {
  const src = line(shell, /^  const myNodes = .*\n.*map\(x => x\[0\]\);$/m);
  const panes = [{ pane: "%1", kind: "primary" }, { pane: "%10", kind: "arealead" }, { pane: "%2", kind: "lead" }, { pane: "%3", kind: "lead" }, { pane: "%4", kind: "lead" }];
  const nodes = (c: Case) => run(HELPERS + "\n" + src, c, "myNodes().map(p => p.pane)", { panes, rankOf: () => 0 });
  assert.deepEqual(nodes(CASES.old), ["%2", "%3", "%4"]);
  assert.deepEqual(nodes(CASES.member), ["%4"], "회원 열 머리 %2 · %3 은 에이전트 칸에");
  assert.deepEqual(nodes(CASES.on), ["%2", "%3", "%4"]);
  assert.doesNotMatch(src, /HB_CH/);
});

test("S2 · X1 Primary 얼굴: 서버 areas primary.avatar 칸이 있으면 그것(비어도), 없으면 고른 얼굴(agent-faces)", () => {
  const xbf = line(x, /^    const D0 = G\('D'\), pa = .*$/m);
  for (const [k, want] of [["old", FACE_PICK], ["member", BOT_FACE], ["on", FACE_PICK]] as const) {
    assert.deepEqual(helpers(CASES[k]).priFace(), want, `shell ${k}`);
    assert.deepEqual(run(xbf, CASES[k], "bf", { G: (n: string) => n === "D" ? CASES[k].D : undefined }), want, `x ${k}`);
  }
  const noBot = { ...CASES.member, D: { areas: [{ key: "primary", lead: "%1", avatar: null }] }, AGENT_CUSTOM: { primary: FACE_PICK } };
  assert.equal(helpers(noBot).priFace(), null, "회원 메인 봇 얼굴이 비면 지금처럼 기본 얼굴(고른 에이전트 얼굴이 섞이지 않음)");
  assert.match(shell, /const bf = priFace\(\), fk =/);
});

test("S6 · S8 · S13 · S14: 사람 종류 대신 데이터(rolewin · role_seats · task_side · areas · BOTN)", () => {
  assert.match(shell, /^    const RW = !mainOnly\(\) && !RS \? /m);
  assert.match(shell, /^    const DG = !mainOnly\(\) && RS && TS \? /m);
  assert.match(shell, /^    \+ '#' \+ \(\(typeof D === 'object' && D\?\.areas\) \|\| \[\]\)\.map\(/m);
  assert.match(shell, /const botn = typeof BOTN === 'string' && BOTN \? BOTN : 'Primary';/);
  assert.doesNotMatch(shell, /window\.HB_MEMBER \? '내 차례' : '내 차례'/);
});

test("E1 · E3 · O6 ea.js: 고정 원은 보드 CH, 차례 글은 TURN → 서버 값 → '내 차례'", () => {
  const pins = line(ea, /^  const PINS = .*$/m), turn = line(ea, /^  const turnT = .*$/m);
  assert.deepEqual(run(pins, CASES.old, "PINS"), ["primary", "company", "shop", "dgit", "personal"]);
  assert.deepEqual(run(pins, { ...CASES.old, CH: undefined }, "PINS"), ["primary", "company", "shop", "dgit", "personal"], "보드 CH 없음 = 다섯");
  assert.deepEqual(run(pins, CASES.member, "PINS"), ["primary"]);
  assert.deepEqual(run(pins, CASES.on, "PINS"), ["primary", "company", "shop", "dgit", "personal"]);
  assert.equal(run(turn, { ...CASES.old, TURN: undefined }, "turnT()"), "내 차례");
  assert.equal(run(turn, { ...CASES.member, TURN: undefined }, "turnT()"), "내 차례");
  assert.equal(run(turn, { ...CASES.on, TURN: undefined }, "turnT()"), "내 차례");
  assert.doesNotMatch(ea, /window\.HB_MEMBER \? '내 차례'|`내 차례 \$\{/);
  assert.doesNotMatch(pins.split("//")[0], /window\.HB_CH/);
});

test("X2 · O7 x.js: 피드 머리 이름 = AREA_NAME.primary(= BOTN), 투표 끝 글 = TURN → 서버 값 → '내 차례'", () => {
  assert.match(x, /const name = String\(AN\(\)\.primary \|\| 'Primary'\)\.replace/);
  assert.match(x, /\$\{G\('TURN'\) \|\| window\.HB_MEMBER\?\.turn \|\| '내 차례'\}/);
});

test("T1 · T3 settings.js: 「시작하기」 = start_tab(없으면 거짓) 또는 관리 권한 없음, #메인 스위치 = mainline(없으면 참)", () => {
  const isMem = line(settings, /^  const isMem = .*$/m);
  const cond = line(settings, /isMem\(\) \|\| !\(window\.HB_CAPS\?\.mainline \?\? true\)/);
  const t = (c: Case, OWNER: boolean) => run(isMem, c, `[isMem(), ${cond}]`, { OWNER });
  assert.deepEqual(t(CASES.old, true), [false, false], "옛 주인: 시작하기 없음 · #메인 스위치 보임");
  assert.deepEqual(t(CASES.old, false), [true, true], "옛 주인 페이지의 관리 권한 없는 사람: 지금처럼 시작하기");
  assert.deepEqual(t(CASES.member, false), [true, true], "회원: 시작하기 · 스위치 숨김");
  assert.deepEqual(t(CASES.member, true), [true, true], "api/me 오기 전(OWNER 처음 값 참)에도 회원은 시작하기");
  assert.deepEqual(t(CASES.on, true), [false, false], "켠 주인: 지금 주인 화면");
  assert.doesNotMatch(settings, /!!window\.HB_MEMBER \|\| !OWNER|isMem\(\) \|\| window\.HB_CH/);
});
