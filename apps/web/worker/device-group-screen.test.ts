// node --test --no-warnings --experimental-transform-types apps/web/worker/device-group-screen.test.ts
// 설정 › 기기 카드(legacy/settings.js 의 const ago ~ const NRULES 앞): 같은 컴퓨터 줄을 묶은 서버 답(members · roles) → 카드 한 장 · 둘 다 보임 · 폐기 메뉴와 확인 글,
//   옛 서버 답(members 없음)은 예전 카드 그대로. 새 의존성 없이 node:vm 으로 그 덩어리만 돌림
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("./legacy/settings.js", import.meta.url), "utf8");
const line = (re: RegExp) => { const m = SRC.match(re); assert.ok(m, String(re)); return m![0]; };
const at = SRC.indexOf("  const ago = t => "), end = SRC.indexOf("  const NRULES = ");   // 코드로 찾음(공개 판은 주석을 뺌)
assert.ok(at > 0 && end > at);
const ctx: any = {};
vm.runInNewContext(line(/^  const esc = .*$/m) + "\nconst IC = {devices: '<i-dev>', more: '<i-more>'};\n" + SRC.slice(at, end)
  + "\nthis.S = {deviceCard, devGroup, revokePlan, revokeMenu};", ctx);
const { deviceCard, revokePlan, revokeMenu } = ctx.S;

const now = Date.now();
const metrics = { host: { os: "linux" }, mem: { total_mb: 64000, avail_mb: 20000, min_mb: 6144 }, cpu: { pct: 10, cores: 16 }, disk: { pct: 40 }, agents: { claude: 3 } };
const grouped = (o: Record<string, unknown> = {}) => ({
  id: "sNd", name: "owner-host (linux)", tools: "[]", scope: "full", created_at: 1, last_at: now, engine_at: now - 5_000, metrics_at: now - 60_000, metrics, history: [],
  roles: ["metrics", "engine"],
  members: [
    { id: "sNd", name: "owner-host (linux)", scope: "full", roles: ["metrics"], created_at: 1, last_at: now, engine_at: null, metrics_at: now - 60_000 },
    { id: "hrn", name: "owner-host harness", scope: "harness", roles: ["engine"], created_at: 2, last_at: now, engine_at: now - 5_000, metrics_at: null },
  ], ...o,
});
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("묶인 카드: 이름은 상태 보내는 기기 · 머리에 「엔진 연결됨」 「상태 보내는 중」 둘 다 · 연결 두 줄이 이름 · 하는 일로", () => {
  const h = deviceCard(grouped());
  assert.equal((h.match(/class="bxs-dev"/g) || []).length, 1, "카드 한 장");
  assert.ok(h.includes("<b>owner-host (linux)</b>"));
  const t = text(h);
  assert.ok(t.includes("엔진 연결됨") && t.includes("상태 보내는 중"), t);
  assert.ok(t.includes("이 컴퓨터의 연결 2"));
  assert.ok(t.includes("owner-host (linux) 상태 보내기 · 상태 1분 전") && t.includes("owner-host harness 엔진 연결 · 엔진 방금"), t);
  assert.ok(t.includes("가용 메모리"), "지표는 상태 보내는 줄 것");
  assert.ok(!t.includes("같은 서버의 감시 기기가 보내요"), "하네스 따로 카드 안내는 안 나옴");
  assert.equal((h.match(/data-dm="sNd"/g) || []).length, 1, "메뉴 단추 하나");
});

test("묶인 카드: 엔진이 5분 넘게 조용하면 「엔진 끊김」, 상태가 15분 넘으면 「상태 조용」 · 지표가 없어도 연결 줄은 보임", () => {
  const t = text(deviceCard(grouped({ engine_at: now - 10 * 60000, metrics_at: now - 20 * 60000 })));
  assert.ok(t.includes("엔진 끊김") && t.includes("상태 조용"), t);
  const t2 = text(deviceCard(grouped({ metrics: null, metrics_at: null })));
  assert.ok(t2.includes("상태 아직 안 보냄") && t2.includes("이 컴퓨터의 연결 2") && t2.includes("boarder watch --once"), t2);
});

test("옛 서버 답(members 없음) · 혼자인 줄: 예전 카드 그대로 — 하네스는 따로 「엔진」 카드, 감시는 「보내는 중」", () => {
  const harness = deviceCard({ id: "hrn", name: "owner-host harness", scope: "harness", engine_at: now, metrics: null, metrics_at: null, history: [] });
  assert.ok(text(harness).includes("같은 서버의 감시 기기가 보내요") && text(harness).includes("연결됨"));
  assert.ok(!text(harness).includes("이 컴퓨터의 연결"));
  const full = text(deviceCard({ id: "sNd", name: "owner-host (linux)", scope: "full", metrics, metrics_at: now, history: [] }));
  assert.ok(full.includes("보내는 중") && !full.includes("상태 보내는 중") && !full.includes("엔진 연결됨") && !full.includes("이 컴퓨터의 연결"), full);
  const hh = grouped({ id: "h1", name: "엔진 1", scope: "harness", metrics: null, metrics_at: null, roles: ["engine"], members: [{ ...grouped().members[1], id: "h1", name: "엔진 1" }, { ...grouped().members[1], id: "h2", name: "엔진 2" }] });
  const th = text(deviceCard(hh));
  assert.ok(th.includes("이 컴퓨터의 연결 2") && th.includes("엔진 연결됨") && !th.includes("같은 서버의 감시 기기가 보내요"), th);
  const one = text(deviceCard({ ...grouped(), members: [grouped().members[0]] }));   // members 하나면 묶음 아님
  assert.ok(!one.includes("이 컴퓨터의 연결"));
});

test("폐기: 묶인 카드 메뉴는 「이 컴퓨터 모두 폐기」 + 줄마다 하는 일 · 이름 단추, 확인 글이 끊길 줄 · 남는 줄을 이름으로", () => {
  const d = grouped(), menu = revokeMenu(d);
  assert.deepEqual([...menu.matchAll(/data-rv="([^"]+)">([^<]+)</g)].map(m => [m[1], m[2]]), [["*", "이 컴퓨터 모두 폐기"], ["sNd", "상태 보내기만 끊기 — owner-host (linux)"], ["hrn", "엔진 연결만 끊기 — owner-host harness"]]);
  const all = revokePlan(d, "*");
  assert.deepEqual([...all.ids], ["sNd", "hrn"]);
  assert.ok(text(all.msg).includes("연결 2개를 모두 폐기") && all.msg.includes("owner-host harness — 엔진 연결") && all.msg.includes("owner-host (linux) — 상태 보내기"));
  const eng = revokePlan(d, "hrn");
  assert.deepEqual([...eng.ids], ["hrn"], "엔진 줄만 고르면 그 줄만 — 상태 보내는 줄(CLI 권한)은 안 끊김");
  assert.ok(text(eng.msg).includes("owner-host harness (엔진 연결)만 끊을까요") && text(eng.msg).includes("owner-host (linux)(상태 보내기) 는 그대로"), eng.msg);
  assert.deepEqual([...revokePlan(d, "남의-id").ids], [], "묶음 밖 id 는 아무것도 안 끊음");
  const old = { id: "x", name: "맥", scope: "full" };
  assert.deepEqual([...revokePlan(old, "*").ids], ["x"]); assert.ok(revokeMenu(old).includes(">기기 폐기<"), "옛 카드는 예전 단추 하나");
});

test("이름 · id 는 모두 이스케이프", () => {
  const x = '<img src=x onerror="alert(1)">';
  const d = grouped({ name: x, members: [{ ...grouped().members[0], id: 'a"><b>', name: x }, { ...grouped().members[1], name: x }] });
  for (const h of [deviceCard(d), revokeMenu(d), revokePlan(d, "*").msg, revokePlan(d, 'a"><b>').msg]) assert.ok(!h.includes("<img") && !h.includes('a"><b>'), h);
});

test("줄 하나인 맥 · 윈도우 기기(엔진 · 감시 한 토큰): 엔진 시각이 있으면 「엔진 연결됨」 「상태 보내는 중」 둘 다 — 새 서버(roles) · 옛 서버(칸만) 같음", () => {
  const mac = { id: "m1", name: "MacBook (macOS)", scope: "full", engine_at: now - 5000, metrics_at: now - 60000, metrics: { host: { os: "darwin" }, mem: { total_mb: 16000, avail_mb: 4000 } }, history: [] };
  for (const d of [mac, { ...mac, roles: ["engine", "metrics"] }]) {
    const t = text(deviceCard(d));
    assert.ok(t.includes("엔진 연결됨") && t.includes("상태 보내는 중"), t);
    assert.ok(!t.includes("이 컴퓨터의 연결"), "줄 하나는 연결 목록 없음");
  }
  assert.ok(text(deviceCard({ ...mac, engine_at: now - 10 * 60000 })).includes("엔진 끊김"));
  const plain = text(deviceCard({ ...mac, engine_at: null, roles: ["metrics"] }));   // 엔진 안 켠 기기는 예전 배지 하나
  assert.ok(plain.includes("보내는 중") && !plain.includes("엔진") && !plain.includes("상태 보내는 중"), plain);
  assert.deepEqual([...revokePlan(mac, "*").ids], ["m1"]); assert.ok(revokeMenu(mac).includes(">기기 폐기<"));
});
