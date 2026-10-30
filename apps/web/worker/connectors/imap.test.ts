import { expect, test } from "bun:test";
import { API_PRESETS, apiReady, checkKey, keyNames, keyParts, runApi, toolsFor, type ApiFetch } from "./apis";
import { decodeMailbox, encodeMailbox, Imap, imapLogin, parseResponse, type Duplex, type ImapLogin } from "./imap";
import { htmlText } from "./mailtext";
import { exposedName } from "./naming";

const imap = API_PRESETS.imap!;
const tool = (name: string) => toolsFor(imap.spec).find((t) => t.name === name)!;
const noFetch: ApiFetch = async () => {
  throw new Error("IMAP tools don't call HTTP");
};
const LOGIN: ImapLogin = { host: "imap.example.com", port: 993, user: "me@example.com", password: "abcd efgh ijkl mnop" };

const enc = new TextEncoder();
const bytes = (...parts: (string | number[])[]) => {
  const all = parts.map((p) => (typeof p === "string" ? enc.encode(p) : new Uint8Array(p)));
  const out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of all) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};

// 101: plain text in EUC-KR (한글 본문), subject as an encoded word, unread.
const HEAD_101 = "From: =?UTF-8?B?6rmA7LKg7IiY?= <kim@example.com>\r\nTo: me@example.com\r\nSubject: =?UTF-8?B?7IS46riIIOyLoOqzoCDrp4jqsJA=?=\r\nDate: Fri, 16 Oct 2026 09:00:00 +0900\r\nContent-Type: text/plain; charset=euc-kr\r\nContent-Transfer-Encoding: 8bit\r\n\r\n";
const TEXT_101 = bytes([0xc7, 0xd1, 0xb1, 0xdb, 0x20, 0xba, 0xbb, 0xb9, 0xae], "\r\n");
// 102: HTML only, with an attachment, already read; forwarded from bob@example.com.
const HEAD_102 = 'From: Billing <billing@vendor.test>\r\nTo: bob@example.com\r\nSubject: Invoice\r\nDate: Thu, 15 Oct 2026 18:00:00 +0900\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n';
const TEXT_102 =
  '--b1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><style>p{}</style><p>Your invoice &amp; receipt</p><p>Due 10/20</p></html>\r\n--b1\r\nContent-Type: application/pdf; name="=?UTF-8?B?6rKs7KCB7IScLnBkZg==?="\r\nContent-Disposition: attachment; filename="=?UTF-8?B?6rKs7KCB7IScLnBkZg==?="\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n--b1--\r\n';
const MSG = {
  101: { seq: 1, flags: "", head: bytes(HEAD_101), text: TEXT_101 },
  102: { seq: 2, flags: "\\Seen", head: bytes(HEAD_102), text: bytes(TEXT_102) },
} as const;

/**
 * A fake IMAP server: answers the commands imap.ts sends, asks for literals with "+", and
 * records every command line (literals inlined) so tests can check what was sent.
 */
function fakeServer(opts: { password?: string; hugeSearch?: boolean } = {}) {
  const commands: string[] = [];
  let push!: (b: Uint8Array) => void;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      push = (b) => c.enqueue(b);
      c.enqueue(enc.encode("* OK fake IMAP ready\r\n"));
    },
  });
  let pending = new Uint8Array(0);
  let line = "";
  let need = 0;
  const say = (...parts: (string | Uint8Array)[]) => push(bytes(...parts.map((p) => (typeof p === "string" ? p : [...p]))));
  const fetchOf = (uid: 101 | 102, items: string) => {
    const m = MSG[uid];
    const parts: (string | Uint8Array)[] = [`* ${m.seq} FETCH (UID ${uid} FLAGS (${m.flags}) INTERNALDATE "16-Oct-2026 09:00:00 +0900" RFC822.SIZE ${m.head.length + m.text.length}`];
    if (items.includes("HEADER.FIELDS")) parts.push(` BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING MIME-VERSION)] {${m.head.length}}\r\n`, m.head, ` BODY[TEXT]<0> {${m.text.length}}\r\n`, m.text);
    else {
      const raw = bytes([...m.head], [...m.text]);
      parts.push(` BODY[]<0> {${raw.length}}\r\n`, raw);
    }
    parts.push(")\r\n");
    return parts;
  };
  const answer = (cmd: string) => {
    commands.push(cmd);
    const [tag, ...rest] = cmd.split(" ");
    const verb = rest.join(" ");
    const ok = (t = "done") => say(`${tag} OK ${t}\r\n`);
    if (/^LOGIN /.test(verb)) return verb === `LOGIN "${LOGIN.user}" "${opts.password ?? LOGIN.password}"` ? ok() : say(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`);
    if (/^EXAMINE /.test(verb)) return say("* 2 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 7] ok\r\n", `${tag} OK [READ-ONLY] examined\r\n`);
    if (/^FETCH 1:2 \(UID\)$/.test(verb)) return say("* 1 FETCH (UID 101)\r\n* 2 FETCH (UID 102)\r\n", `${tag} OK fetched\r\n`);
    if (/^UID SEARCH /.test(verb)) {
      const hits = [/FROM "kim"|UNSEEN|SUBJECT 세금/.test(verb) ? 101 : 0, /TO "bob@example.com"/.test(verb) ? 102 : 0].filter(Boolean);
      if (opts.hugeSearch) return say(`* SEARCH${" 1234567".repeat(400_000)}\r\n`, `${tag} OK searched\r\n`);   // 3.2MB, 40만 개
      return say(`* SEARCH${hits.map((h) => ` ${h}`).join("")}\r\n`, `${tag} OK searched\r\n`);
    }
    const f = /^UID FETCH ([\d,]+) (.*)$/.exec(verb);
    if (f) {
      for (const uid of f[1]!.split(",").map(Number)) if (uid === 101 || uid === 102) say(...fetchOf(uid, f[2]!));
      return ok("fetched");
    }
    if (verb === 'LIST "" "*"') return say('* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\All \\HasNoChildren) "/" "[Gmail]/&ZeVnLIqe-"\r\n* LIST (\\Noselect \\HasChildren) "/" "[Gmail]"\r\n', `${tag} OK listed\r\n`);
    if (verb === "LOGOUT") return say("* BYE bye\r\n", `${tag} OK logged out\r\n`);
    say(`${tag} BAD unknown command\r\n`);
  };
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      pending = bytes([...pending], [...chunk]);
      for (;;) {
        if (need) {
          if (pending.length < need) return;
          line += new TextDecoder().decode(pending.subarray(0, need));
          pending = pending.subarray(need);
          need = 0;
          continue;
        }
        const i = pending.indexOf(10);
        if (i < 0) return;
        line += new TextDecoder().decode(pending.subarray(0, i - 1));
        pending = pending.subarray(i + 1);
        const lit = /\{(\d+)\}$/.exec(line);
        if (lit) {
          need = Number(lit[1]);
          line = line.slice(0, -lit[0].length);
          say("+ go ahead\r\n");
          continue;
        }
        answer(line);
        line = "";
      }
    },
  });
  const socket: Duplex = { readable, writable, close: () => {} };
  return { socket, commands, open: () => Imap.open(socket, LOGIN) };
}

const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text);

/** Nothing sent may change the mailbox: no STORE, COPY, MOVE, EXPUNGE, APPEND, SELECT, DELETE; bodies only with PEEK. */
function readOnlyCommands(commands: string[]) {
  for (const c of commands) {
    expect(c).not.toMatch(/^\S+ (UID )?(STORE|COPY|MOVE|EXPUNGE|APPEND|SELECT|DELETE|RENAME|CREATE|SUBSCRIBE)\b/i);
    if (/FETCH/i.test(c)) expect(c).not.toMatch(/BODY\[|RFC822(\.TEXT|\.HEADER)?\b(?!\.SIZE)/i);
  }
}

test("the key is three lines; only the password is hidden in results", () => {
  expect(keyNames(imap.spec.auth)).toEqual(["IMAP 서버(예: imap.gmail.com)", "메일 주소", "앱 비밀번호"]);
  expect(checkKey(imap.spec.auth, "imap.gmail.com\nme@gmail.com\nabcd efgh ijkl mnop")).toEqual({ key: "imap.gmail.com\nme@gmail.com\nabcd efgh ijkl mnop" });
  expect(checkKey(imap.spec.auth, " imaps://IMAP.Zoho.com:993/ \n me@zoho.com \n pw123456 ")).toEqual({ key: "imap.zoho.com\nme@zoho.com\npw123456" });
  expect(checkKey(imap.spec.auth, "imap.gmail.com\nme@gmail.com")).toHaveProperty("error");
  expect(checkKey(imap.spec.auth, "10.0.0.1\nme@x.com\npw")).toHaveProperty("error");
  expect(checkKey(imap.spec.auth, "localhost\nme@x.com\npw")).toHaveProperty("error");
  expect(checkKey(imap.spec.auth, "smtp.x.com:25\nme@x.com\npw")).toHaveProperty("error");
  // The error never quotes the password.
  expect(JSON.stringify(checkKey(imap.spec.auth, "bad host!\nme@x.com\nsecret-pass"))).not.toContain("secret-pass");
  // 줄을 바꿔 넣어도(비밀번호가 첫 줄) 오류 글에 안 실림
  expect(JSON.stringify(checkKey(imap.spec.auth, "secret pass word\nme@x.com\nimap.x.com"))).not.toContain("secret pass word");
  expect(imapLogin("mail.example.org:1993\nu@example.org\np")).toEqual({ host: "mail.example.org", port: 1993, user: "u@example.org", password: "p" });
  // The address is in every message's To: hiding it would garble results, so only the password is a secret.
  // 보더는 서버가 되돌려 줄 수 있는 꼴(주소 인코딩 · JSON 이스케이프 · 붙인 꼴)도 가림
  const parts = keyParts(imap.spec.auth, "imap.gmail.com\nme@gmail.com\nabcd efgh ijkl mnop");
  expect(parts).toContain("abcd efgh ijkl mnop");
  expect(parts).toContain("abcdefghijklmnop");
  expect(parts.some((x) => x.includes("me@gmail.com") || x.includes("imap.gmail.com"))).toBe(false);
});

test("every tool is read only", () => {
  expect(toolsFor(imap.spec).map((t) => t.name)).toEqual(["list_messages", "search_messages", "read_message", "list_mailboxes"]);
  // 코드 모드 이름: imap__<도구>, 라벨이 있으면 imap__<라벨>__<도구>
  expect(exposedName("imap", "list_mailboxes")).toBe("imap__list_mailboxes");
  expect(exposedName("imap__work", "search_messages")).toBe("imap__work__search_messages");
  for (const t of toolsFor(imap.spec)) expect(t.annotations?.readOnlyHint).toBe(true);
});

test("list_messages: newest first, decoded, with a one-line snippet, without marking anything read", async () => {
  const s = fakeServer();
  const r = json(await tool("list_messages").run(noFetch, { limit: 5 }, { imap: s.open }));
  expect(r.mailbox).toBe("INBOX");
  expect(r.total).toBe(2);
  expect(r.messages).toEqual([
    { uid: 102, date: "2026-10-15T09:00:00.000Z", from: "Billing <billing@vendor.test>", to: "bob@example.com", subject: "Invoice", snippet: "Your invoice & receipt Due 10/20", unread: false, attachments: true },
    { uid: 101, date: "2026-10-16T00:00:00.000Z", from: "김철수 <kim@example.com>", to: "me@example.com", subject: "세금 신고 마감", snippet: "한글 본문", unread: true },
  ]);
  expect(s.commands[0]).toMatch(/^z1 LOGIN /);
  expect(s.commands).toContain('z2 EXAMINE "INBOX"');
  expect(s.commands.at(-1)).toMatch(/LOGOUT$/);
  readOnlyCommands(s.commands);
});

test("search_messages: filters become SEARCH keys; Korean terms go as UTF-8 literals", async () => {
  const s = fakeServer();
  const r = json(await tool("search_messages").run(noFetch, { to: "bob@example.com", since: "2026-10-01", before: "2026-10-17T00:00:00+09:00" }, { imap: s.open }));
  expect(r.messages.map((m: { uid: number }) => m.uid)).toEqual([102]);
  expect(s.commands).toContain('z3 UID SEARCH TO "bob@example.com" SINCE 1-Oct-2026 BEFORE 17-Oct-2026');

  const k = fakeServer();
  const kr = json(await tool("search_messages").run(noFetch, { subject: "세금", unread: true }, { imap: k.open }));
  expect(kr.messages.map((m: { uid: number }) => m.uid)).toEqual([101]);
  expect(k.commands).toContain("z3 UID SEARCH CHARSET UTF-8 SUBJECT 세금 UNSEEN");
  readOnlyCommands([...s.commands, ...k.commands]);

  // No filter, or a bad date: an error, before anything is searched.
  expect((await tool("search_messages").run(noFetch, {}, { imap: fakeServer().open })).isError).toBe(true);
  expect((await tool("search_messages").run(noFetch, { since: "last week" }, { imap: fakeServer().open })).isError).toBe(true);
});

test("read_message: the body as text and the attachments by name only", async () => {
  const s = fakeServer();
  const r = json(await tool("read_message").run(noFetch, { uid: 102 }, { imap: s.open }));
  expect(r).toMatchObject({ uid: 102, from: "Billing <billing@vendor.test>", subject: "Invoice", unread: false, text: "Your invoice & receipt\nDue 10/20" });
  expect(r.attachments).toEqual([{ name: "견적서.pdf", type: "application/pdf", size: 9 }]);
  expect(JSON.stringify(r)).not.toContain("JVBERi0x");
  expect(s.commands.find((c) => c.includes("UID FETCH"))).toBe(`z3 UID FETCH 102 (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[]<0.${4 * 1024 * 1024}>)`);
  readOnlyCommands(s.commands);
  expect((await tool("read_message").run(noFetch, { uid: 999 }, { imap: fakeServer().open })).isError).toBe(true);
});

test("list_mailboxes decodes modified UTF-7 and names special use", async () => {
  const r = json(await tool("list_mailboxes").run(noFetch, {}, { imap: fakeServer().open }));
  expect(r.mailboxes).toEqual([{ name: "INBOX" }, { name: "[Gmail]/日本語", use: "\\All" }, { name: "[Gmail]", selectable: false }]);
  for (const name of ["[Gmail]/전체보관함", "Tom & Jerry", "~peter/mail/台北/日本語", "INBOX"]) expect(decodeMailbox(encodeMailbox(name))).toBe(name);
  expect(encodeMailbox("~peter/mail/台北/日本語")).toBe("~peter/mail/&U,BTFw-/&ZeVnLIqe-");
});

test("a refused sign-in says how to get an app password; the password isn't in the error", async () => {
  const r = await tool("list_messages").run(noFetch, {}, { imap: fakeServer({ password: "other" }).open });
  expect(r.isError).toBe(true);
  expect(r.content[0]!.text).toContain("App passwords");
  expect(r.content[0]!.text).not.toContain(LOGIN.password);
});

test("responses with literals and bracketed items parse into tokens", () => {
  const t = parseResponse(['* 3 FETCH (UID 9 FLAGS (\\Seen) BODY[HEADER.FIELDS (FROM TO)] {5}', enc.encode("ab\r\nc"), ' X NIL "q\\"s")']);
  expect(t.slice(0, 3)).toEqual(["*", "3", "FETCH"]);
  const items = t[3] as unknown[];
  expect(items.slice(0, 5)).toEqual(["UID", "9", "FLAGS", ["\\Seen"], "BODY[HEADER.FIELDS (FROM TO)]"]);
  expect(new TextDecoder().decode(items[5] as Uint8Array)).toBe("ab\r\nc");
  expect(items.slice(6)).toEqual(["X", null, 'q"s']);
  // Free text with a ")" that closes nothing still ends.
  expect(parseResponse(["* OK quota at 90% :)"])).toEqual(["*", "OK", "quota", "at", "90%", ":"]);
});

test("HTML with an out-of-range entity still reads", () => {
  expect(htmlText("<p>a&#99999999;b &#54620;</p>")).toBe("a\ufffdb 한");
});

test("runApi: no IMAP sign-in without a key, and the password never comes back", async () => {
  // 키 없는 줄
  expect((await runApi(imap.spec, undefined, "list_mailboxes", {})).isError).toBe(true);
  // 서버 이름이 틀린 키: 소켓을 열기 전에 막히고 비밀번호는 안 나옴
  const r = await runApi(imap.spec, "not a host\nme@x.com\nsecret-pass-123", "list_mailboxes", {});
  expect(r.isError).toBe(true);
  expect(r.content[0]!.text).not.toContain("secret-pass-123");
  expect((await runApi(imap.spec, "imap.x.com\nme@x.com\npw", "no_such_tool", {})).isError).toBe(true);
});

test("Gmail outside the test users points at IMAP instead of 「곧」", () => {
  const r = apiReady({ GMAIL_CLIENT_ID: "id", GMAIL_CLIENT_SECRET: "s", GMAIL_TEST_USERS: "a@gmail.com" }, "gmail", "b@gmail.com");
  expect(r).toMatchObject({ ready: false, via: "imap" });
  expect(r.soon).toBeUndefined();
  expect(r.note).toContain("imap.gmail.com");
  expect(apiReady({}, "imap", "b@gmail.com").ready).toBe(true);
});

test("a search with too many matches is refused before it is parsed (memory, review)", async () => {
  const r = await tool("search_messages").run(noFetch, { since: "2010-01-01" }, { imap: fakeServer({ hugeSearch: true }).open });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toMatch(/too many messages match/);
});
