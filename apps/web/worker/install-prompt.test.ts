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
