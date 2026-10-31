import { expect, test } from "bun:test";
import { obLive } from "./store";

const env = (v: Record<string, string>) => ({ DB: {} as D1Database, ...v });
const row = (source?: string) => ({ source });

test("OB_LIVE 가 꺼져 있으면 아무 줄도 막지 않음", () => {
  expect(obLive(env({}), row("0b:abc/c1"))).toBe(false);
});
test("보더에서 붙인 줄은 막지 않음", () => {
  expect(obLive(env({ OB_LIVE: "1" }), row(""))).toBe(false);
  expect(obLive(env({ OB_LIVE: "1" }), row(undefined))).toBe(false);
});
test("옮기기 전 0b 사용자 줄은 막음", () => {
  expect(obLive(env({ OB_LIVE: "1" }), row("0b:abc/c1"))).toBe(true);
  expect(obLive(env({ OB_LIVE: "1", OB_MOVED: "zzz" }), row("0b:abc/c1"))).toBe(true);
});
test("OB_MOVED 에 든 사람 줄만 풀림(공백 · 빈칸 무시, 앞부분만 같은 id 는 아님)", () => {
  const e = env({ OB_LIVE: "1", OB_MOVED: " abc , ,def" });
  expect(obLive(e, row("0b:abc/c1"))).toBe(false);
  expect(obLive(e, row("0b:def/github-app"))).toBe(false);
  expect(obLive(e, row("0b:abcd/c1"))).toBe(true);
});
