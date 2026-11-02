import { test } from "node:test";
import assert from "node:assert/strict";
import { installPrompt, BOARDER_SKILL } from "./install.ts";

test("설치 글: 보고 · 엔진(tmux)을 기본으로 켜고 끄는 법은 한 줄 — 「읽기만 · 안 바꿈」 · 「묻기」는 없음", () => {
  const p = installPrompt("https://boarder.dgit.co");
  assert.match(p, /`boarder enable report`/);
  assert.match(p, /`boarder enable engine`[^\n]*tmux/);
  assert.match(p, /Don't ask me first/);
  assert.match(p, /`boarder disable report`[^\n]*`boarder disable engine`[^\n]*`boarder uninstall`/);
  assert.doesNotMatch(p, /only reads|does not change my AI tools|Ask me once|Run only what I say yes to/);
  assert.ok(p.indexOf("boarder setup") < p.indexOf("boarder enable report") && p.indexOf("boarder enable engine") < p.indexOf("boarder import --setup"), "로그인 → 보고 → 엔진 → 들여오기 순");
  assert.match(installPrompt("https://staging.example.test/"), /boarder setup --yes --server https:\/\/staging\.example\.test`/);
});

test("스킬 · 설치 글에 하네스 규칙 여섯(창 하나 = 목표 하나 · 보고 · 저장 뒤 주차 · 비밀 · 묻는 글 · 바깥 글 허락)", () => {
  for (const [name, t] of [["skill", BOARDER_SKILL], ["prompt", installPrompt("https://boarder.dgit.co")]] as const) {
    assert.match(t, /One window = one goal/, name);
    assert.match(t, /at least (once )?every 30 minutes/, name);
    assert.match(t, /`boarder session save`[^\n]*park/, name);
    assert.match(t, /watcher outside the window[^\n]*reopen/, name);
    assert.match(t, /Never print, log or post passwords/, name);
    assert.match(t, /first line[^\n]*decide[^\n]*options[^\n]*plain words without internal/, name);
    assert.match(t, /outside[^\n]*draft[^\n]*only after/, name);
    // 개인 방식 · 특정인 개인 에이전트는 안 넣음
    assert.doesNotMatch(t, /퍼스널|가게|personal agent|canvas/i, name);
  }
});

test("하네스 규칙 켜고 끄기(설정 › 노드): 끈 묶음은 설치 글 · 스킬에서 빠지고, 비밀 규칙은 늘 남음 · 번호는 다시 매김 · 기본은 그대로", async () => {
  const { boarderSkill, RULE_KEYS } = await import("./install.ts");
  assert.equal(boarderSkill(), BOARDER_SKILL); assert.equal(boarderSkill({}), BOARDER_SKILL);
  assert.equal(installPrompt("https://boarder.dgit.co", Object.fromEntries(RULE_KEYS.map(k => [k, true]))), installPrompt("https://boarder.dgit.co"));
  assert.match(BOARDER_SKILL, /save and park the window \(rule 3\)/);
  const off = { one_goal: false, outside: false };
  const p = installPrompt("https://boarder.dgit.co", off), sk = boarderSkill(off);
  for (const t of [p, sk]) {
    assert.doesNotMatch(t, /One window = one goal/); assert.doesNotMatch(t, /draft[^\n]*only after/);
    assert.match(t, /Never print, log or post passwords/); assert.match(t, /every 30 minutes/);
  }
  assert.match(sk, /^1\. Report to Boarder/m); assert.match(sk, /^4\. A question to the human/m); assert.doesNotMatch(sk, /^5\. /m);
  assert.match(sk, /park the window \(rule 2\)/, "주차 규칙 번호를 따라감");
  const noPark = boarderSkill({ park: false });
  assert.doesNotMatch(noPark, /boarder session save|park the window/);
  const all = boarderSkill(Object.fromEntries(RULE_KEYS.map(k => [k, false])));
  assert.match(all, /## Working rules\n\n1\. Never print, log or post passwords/, "다 꺼도 비밀 규칙 하나는 남음");
  assert.match(installPrompt("https://boarder.dgit.co", { report: false }), /`boarder enable report`/, "보고 연결 단계는 그대로(규칙 줄만 빠짐)");
});
