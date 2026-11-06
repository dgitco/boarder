import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import * as U from "./uid.ts";

const board = readFileSync(new URL("../board-template/page.html", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const head = [...board.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(x => x.includes("const seg = "))!;
const APP_PATH = new RegExp(index.match(/export const APP_PATH = \/(.*)\/;\n/)![1]);
type H = { toPath: (h: string) => string | null; toHash: (p: string, s?: string) => string; uKey: (k: string, u: string) => string };
function hbr(win0: Record<string, unknown> = {}) {   // 만들기 스위치 켬(Worker 가 HB_UIDGEN 을 넣은 화면) — 꺼짐은 { HB_UIDGEN: 0 }
  const win: Record<string, unknown> = { localStorage: { getItem: () => null }, location: { hash: "", pathname: "/", search: "", origin: "https://b.x" }, HB_UIDGEN: 1, ...win0 };
  win.window = win; win.URLSearchParams = URLSearchParams;
  vm.runInNewContext(head, win);
  return win.HBR as H;
}
const TS = "1793800000.638028", MS = "1793862790.000100", AID = "hbE69P61Tni5xLgxi4Zi8Cwd";
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("글 UUID: v7 꼴 · 시각 칸 = 그 글 시각(ms) · ts 로 되돌림 · 다른 UUID 는 글이 아님", () => {
  const u = U.msgUid(TS);
  assert.match(u, V7);
  assert.equal(parseInt(u.replace(/-/g, "").slice(0, 12), 16), 1793800000638, "ms 칸");
  assert.equal(U.uidTs(u), TS);
  assert.equal(U.uidTs(u.toUpperCase()), TS, "대문자도");
  assert.equal(U.uidTs(u.replace(/-/g, "")), TS, "하이픈 없이도");
  assert.equal(U.uidTs(U.keyUid("c", "primary")), "", "채널 UUID 는 글이 아님");
  assert.equal(U.uidTs(U.newUid()), "", "무작위 v7 은 글이 아님");
  assert.equal(U.msgUid("100.1"), "", "ts 꼴이 아니면 없음");
  for (const t of ["1700000000.000000", "1799999999.999999", MS]) assert.equal(U.uidTs(U.msgUid(t)), t, t);
  assert.ok(U.msgUid(MS) > U.msgUid(TS), "시간 순으로 커짐");
});

test("채널 · 캔버스 UUID: 키마다 다르고 아는 목록에서 되돌림", () => {
  const c = U.keyUid("c", "primary"), a = U.keyUid("a", AID);
  assert.match(c, V7); assert.match(a, V7); assert.notEqual(c, U.keyUid("c", "company")); assert.notEqual(U.keyUid("c", AID), a, "종류가 다르면 다름");
  assert.equal(U.uidKey("c", c.toUpperCase(), U.DEFAULT_CH), "primary");
  assert.equal(U.uidKey("a", a, ["x", AID]), AID);
  assert.equal(U.uidKey("c", a, U.DEFAULT_CH), "");
  const n = U.newUid(1793890800123); assert.match(n, V7); assert.notEqual(n, U.newUid(1793890800123), "무작위");
  assert.equal(parseInt(n.replace(/-/g, "").slice(0, 12), 16), 1793890800123, "새 파일 id 시각 칸 = 지금");
});


test("화면 주소: 링크 · 주소창은 UUID 만, 받기는 UUID(대소문자 무시) · 옛 꼴 모두", () => {
  const H = hbr(), c = U.keyUid("c", "company"), t = U.msgUid(TS), m = U.msgUid(MS), a = U.keyUid("a", AID);
  assert.equal(H.toPath("#chat/company"), `/chat/${c}`);
  assert.equal(H.toPath(`#chat/company/${TS}`), `/chat/${c}/${t}`);
  assert.equal(H.toPath(`#chat/company/${TS}/${MS}`), `/chat/${c}/${m}?thread=${t}`, "스레드 속 글");
  assert.equal(H.toPath(`#art/${AID}`), `/canvas/${a}`);
  assert.equal(H.toHash(`/chat/${c}`), "#chat/company");
  assert.equal(H.toHash(`/chat/${c}/${t}`), `#chat/company/${TS}`);
  assert.equal(H.toHash(`/chat/${c.toUpperCase()}/${t.toUpperCase()}`), `#chat/company/${TS}`, "대문자 주소");
  assert.equal(H.toHash(`/chat/${c}/${m}`, `?thread=${t}`), `#chat/company/${TS}/${MS}`);
  assert.equal(H.toHash(`/chat/company/${TS}`), `#chat/company/${TS}`, "옛 주소");
  assert.equal(H.toHash(`/chat/company/${MS}`, `?thread=${TS}`), `#chat/company/${TS}/${MS}`, "옛 스레드 주소");
  assert.equal(H.toHash(`/canvas/${AID}`), `#art/${AID}`, "옛 캔버스");
  assert.equal(H.toHash(`/canvas/${AID}-다음-작업`), `#art/${AID}`, "옛 꼬리");
  assert.equal(H.toHash(`/canvas/${a}`), `#art/${a}`, "목록을 모르면 UUID 그대로(화면이 목록을 받은 뒤 찾음)");
  assert.equal(H.toHash(`/chat/${c}/not-a-uid`), "");
  const h2 = U.keyUid("c", "harness");
  assert.equal(hbr({ HB_UIDS: { [h2]: "c:harness", [a]: "a:" + AID } }).toHash(`/chat/${h2}/${t}`), `#chat/harness/${TS}`);
  assert.equal(hbr({ HB_UIDS: { [a]: "a:" + AID } }).toHash(`/canvas/${a.toUpperCase()}`), `#art/${AID}`);
  assert.equal(hbr({ HB_UIDK: (k: string) => k === "c" ? ["harness"] : [AID] }).toHash(`/canvas/${a}`), `#art/${AID}`);
  assert.equal(hbr({ HB_UIDK: (k: string) => k === "c" ? ["harness"] : [] }).toHash(`/chat/${h2}`), "#chat/harness");
  assert.equal(H.toPath("#chat/i:unread"), "/chat/i:unread", "화면 열쇠(n: · i:)는 그대로");
  assert.equal(H.toPath(`#chat/x_abc123/${TS}`), `/chat/x_abc123/${TS}`, "x_ 채널은 되돌릴 목록이 없어 예전 꼴");
  assert.equal(U.newPath(`/chat/x_abc123/${TS}`, ""), null, "옛 x_ 채널 주소도 넘기지 않음");
  const old = "oldAcct0123456789abcdef";
  assert.equal(hbr({ HB_UIDK: (k: string) => k === "a" ? [AID, old] : [] }).toHash(`/canvas/${U.keyUid("a", old)}`), `#art/${old}`);
  assert.equal(H.toPath("#chat/company/100.1"), "/chat/company/100.1", "ts 꼴이 아닌 글은 예전 꼴");
});

test("만들기 스위치 꺼짐(HB_UIDGEN 없음): 만드는 주소는 예전 꼴 그대로 · UUID 주소 받기는 그대로", () => {
  const H = hbr({ HB_UIDGEN: 0 }), c = U.keyUid("c", "company"), t = U.msgUid(TS), a = U.keyUid("a", AID);
  assert.equal(H.toPath(`#chat/company/${TS}`), `/chat/company/${TS}`);
  assert.equal(H.toPath(`#chat/company/${TS}/${MS}`), `/chat/company/${MS}?thread=${TS}`);
  assert.equal(H.toPath(`#art/${AID}`), `/canvas/${AID}`);
  assert.equal(H.toHash(`/chat/${c}/${t}`), `#chat/company/${TS}`);
  assert.equal(hbr({ HB_UIDGEN: 0, HB_UIDS: { [a]: "a:" + AID } }).toHash(`/canvas/${a}`), `#art/${AID}`);
});

test("Worker: 옛 주소 → UUID 주소(301 대상) · 새 주소는 그대로 · APP_PATH 가 받음", () => {
  const c = U.keyUid("c", "primary"), t = U.msgUid(TS), m = U.msgUid(MS), a = U.keyUid("a", AID);
  assert.equal(U.newPath(`/chat/primary/${TS}`, ""), `/chat/${c}/${t}`);
  assert.equal(U.newPath(`/chat/primary/${MS}`, `?thread=${TS}`), `/chat/${c}/${m}?thread=${t}`);
  assert.equal(U.newPath("/chat/primary", ""), `/chat/${c}`);
  assert.equal(U.newPath(`/chat/${c}/${t}`, ""), null, "새 주소는 그대로");
  assert.equal(U.newPath(`/chat/${c}/${m}`, `?thread=${t}`), null);
  assert.equal(U.newPath(`/chat/${c.toUpperCase()}/${t.toUpperCase()}`, ""), `/chat/${c}/${t}`, "대문자 → 소문자");
  assert.equal(U.newPath(`/canvas/${AID}`, ""), `/canvas/${a}`);
  assert.equal(U.newPath(`/canvas/${AID}-%EB%8B%A4%EC%9D%8C`, ""), `/canvas/${a}`, "옛 꼬리");
  assert.equal(U.newPath(`/canvas/${a}`, ""), null);
  assert.equal(U.newPath(`/canvas/${a.toUpperCase()}`, "?x=1"), `/canvas/${a}?x=1`);
  assert.equal(U.newPath("/chat/i:unread", ""), null, "화면 열쇠는 안 건드림");
  assert.equal(U.newPath("/chat/primary/100.1", ""), null);
  const once = U.newPath("/chat/primary", "?a=b%20c&x=1")!; assert.equal(U.newPath(once.split("?")[0], "?" + once.split("?")[1]), null, "두 번 넘기지 않음");
  for (const p of [`/chat/${c}`, `/chat/${c}/${t}`, `/chat/${c.toUpperCase()}/${t.toUpperCase()}`, `/canvas/${a}`, `/canvas/${a.toUpperCase()}`, `/canvas/${AID}`, `/chat/primary/${TS}`]) assert.ok(APP_PATH.test(p), p);
});
