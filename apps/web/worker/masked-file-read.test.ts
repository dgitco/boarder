import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);
const { maskedFileReader, readMemberFiles, linkOk } = await import("./member-files.ts");
const A = "a@example.test", B = "b@example.test", SECRET = "made-up-test-secret";
const ID = "a".repeat(32), OTHER = "b".repeat(32), MISSING = "c".repeat(32);
const line = (id = ID, name = "", tail = "«가림»") => `📎 사진.png: https://old.example/f/${id}${name}?e=1794000000&${tail}`;
function setup() {
  const heads: string[] = [], objects = new Map<string, Record<string, string>>([[ID, { owner: A }], [OTHER, { owner: B }]]);
  const env = { BETTER_AUTH_SECRET: SECRET, ALLOW_EMAILS: `${A},owner-alt@example.test`, RESULTS: { head: async (key: string) => {
    heads.push(key); const customMetadata = objects.get(key.slice(7)); return customMetadata ? { customMetadata } : null;
  } } };
  return { heads, objects, env, read: maskedFileReader(env as never, "https://new.example/") };
}
async function valid(text: string) {
  const u = new URL(text.split(": ")[1]);
  assert.equal(u.origin, "https://new.example"); assert.equal(u.pathname, `/f/${ID}`);
  assert.ok(await linkOk(SECRET, ID, u.searchParams.get("e")!, u.searchParams.get("t")!));
}
test("가려진 첨부는 글쓴이 파일만 재서명, 옛 이름 꼬리·CRLF도 지원", async () => {
  const s = setup();
  await valid(await s.read(line(), A));
  await valid(await s.read(line(ID, "/photo.png"), A));
  const crlf = await s.read(`본문\r\n${line()}\r\n다음`, A);
  assert.match(crlf, /본문\r\n📎 사진.png: https:\/\/new.example\/f\//); assert.ok(crlf.endsWith("\r\n다음"));
  assert.equal(s.heads.length, 1);
});
test("남의 파일·없는 파일·불명 글쓴이·정상 링크·본문 속 링크는 그대로", async () => {
  const s = setup();
  for (const [text, author] of [[line(OTHER), A], [line(MISSING), A], [line(), ""], [line(ID, "", "t=" + "d".repeat(32)), A], ["인용 " + line(), A], [line().replace("📎 사진.png: ", ""), A]]) {
    assert.equal(await s.read(text, author), text);
  }
  assert.equal(s.heads.length, 2, "정상 링크와 첨부 아닌 글은 R2 조회 0");
});
test("주인 글도 설정된 메일의 파일만, URI 메타데이터를 해석하고 잘못된 인코딩은 거절", async () => {
  const s = setup();
  s.objects.set(ID, { owner: encodeURIComponent("owner-alt@example.test"), owner_encoding: "uri" });
  await valid(await s.read(line(), "owner"));
  assert.equal(await s.read(line(OTHER), "owner"), line(OTHER));
  const t = setup(); t.objects.set(ID, { owner: "%broken", owner_encoding: "uri" });
  assert.equal(await t.read(line(), "owner"), line());
});
test("한 화면 100글·같은 첨부 10번·text/src·동시 요청도 고유 id당 R2 head 한 번", async () => {
  const s = setup(), body = { messages: Array.from({ length: 100 }, () => ({ who: "owner", text: Array(10).fill(line()).join("\n"), src: line() })) };
  await readMemberFiles(body, s.read, A);
  assert.equal(s.heads.length, 1); await valid(body.messages[0].src);
  const again = maskedFileReader(s.env as never, "https://new.example"); await again(line(), A);
  assert.equal(s.heads.length, 2, "다음 응답은 소유권을 다시 확인");
});
test("소유권 결과는 글쓴이마다 확인, 같은 id를 먼저 읽은 남에게 서명 안 샘", async () => {
  const s = setup(), out = await Promise.all([s.read(line(), B), s.read(line(), A)]);
  assert.equal(out[0], line()); await valid(out[1]); assert.equal(s.heads.length, 1);
});
test("R2 head 장애는 원문 유지, 같은 응답에서 실패도 반복 조회 안 함", async () => {
  let n = 0; const read = maskedFileReader({ RESULTS: { head: async () => { n++; throw new Error("R2 unavailable"); } }, BETTER_AUTH_SECRET: SECRET } as never, "https://new.example");
  assert.deepEqual(await Promise.all([read(line(), A), read(line(), A)]), [line(), line()]); assert.equal(n, 1);
});
