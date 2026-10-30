import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as P from "./push.ts";

const te = new TextEncoder(), td = new TextDecoder();
type B = Uint8Array<ArrayBuffer>;
async function hm(k: B, m: B) { return new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), m)); }
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
// 받는 쪽(브라우저) 풀기 — test_push.py decrypt 와 같은 길
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, auth: B) {
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset).getUint32(16), idlen = body[20];
  const asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey) as ArrayBuffer);
  const as = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: as }, ua.privateKey, 256));
  const ikm = await hm(await hm(auth, secret), cat(te.encode("WebPush: info\0"), uaPub, asPub, Uint8Array.of(1)));
  const prk = await hm(salt, ikm);
  const cek = (await hm(prk, te.encode("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16), nonce = (await hm(prk, te.encode("Content-Encoding: nonce\0\x01"))).slice(0, 12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), ct));
  assert.equal(rs, 4096); assert.equal(pt[pt.length - 1], 2);
  return pt.slice(0, -1);
}

class Sim {
  cards = new Map<string, P.Card>(); urg = new Map<string, P.Urg>(); st: P.State = { notified: [], fps: [], tries: {} }; code: P.Code = 201; got: P.Msg[] = []; t = 1793241000;
  card(ts: string, o: Partial<P.Card> = {}) { const label = o.label ?? ""; this.cards.set(ts, { ts, area: "dgit", kind: "choice", title: label, label, shape: null, state: "open", replaced_by: null, dup_of: null, ref: "", posted_at: this.t, ...o }); }
  msg(u: P.Urg) { this.urg.set(P.urgKey(u), u); }
  tick(now: number) {
    const sent: [string, P.Msg][] = [];
    for (const t of P.pending(this.st, now, this.cards, this.urg)) { this.got.push(t[1]); if (P.settle(this.st, t, [["127.0.0.1", this.code]])) sent.push([t[0], t[1]]); }
    return sent;
  }
  later(dt = 20) { this.t += dt; const a = this.tick(this.t).map(x => x[0]); this.t += dt; return [...a, ...this.tick(this.t).map(x => x[0])]; }
}

test("RFC 8291 5절 예시 그대로", async () => {
  const eph = await P.scalarKey(P.unb64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "ECDH");
  const b = await P.encrypt(te.encode("When I grow up, I want to be a watermelon"), "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", "BTBZMqHH6r4Tts7J_aSIgg", P.unb64u("DGv6ra1nlYgDCS1FRnbzlw"), eph);
  assert.equal(P.b64u(b), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("암호화 · VAPID: 받는 쪽이 풀고 서명이 맞음", async () => {
  const v = (await P.vapidKey(P.b64u(crypto.getRandomValues(new Uint8Array(32)))))!;
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const auth = te.encode("0123456789abcdef"), got: { url: string; init: RequestInit }[] = [];
  const sub = { endpoint: "http://127.0.0.1:9/push/abc", p256dh: P.b64u(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey) as ArrayBuffer)), auth: P.b64u(auth) };
  const code = await P.sendOne(v, sub, te.encode(P.pyJson({ title: "회사 · 결정", body: "한글 글", url: "./?open=card:1.2", tag: "card:1.2" })),
    (async (url: string, init: RequestInit) => { got.push({ url, init }); return new Response(null, { status: 201 }); }) as unknown as typeof fetch);
  assert.equal(code, 201);
  const h = got[0].init.headers as Record<string, string>;
  assert.equal(h["Content-Encoding"], "aes128gcm");
  assert.equal(JSON.parse(td.decode(await decrypt(got[0].init.body as Uint8Array, ua, auth))).body, "한글 글");
  const [t, k] = h.Authorization.slice("vapid t=".length).split(", k=");
  const [head, claims, sig] = t.split(".");
  assert.equal(JSON.parse(td.decode(P.unb64u(claims))).aud, "http://127.0.0.1:9");
  const pub = await crypto.subtle.importKey("raw", P.unb64u(k), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, P.unb64u(sig), te.encode(`${head}.${claims}`)));
});

test("새 카드 · 급함은 한 번만, 첫 실행은 밀린 것 안 보냄", () => {
  const s = new Sim();
  s.card("0.9", { label: "옛 카드" });
  assert.deepEqual(s.tick(s.t), []);
  s.card("1.1", { area: "company", label: "맥 실측 방 정하기" });
  s.card("1.2", { kind: "question", state: "done", label: "처리된 것" });
  s.card("1.5", { area: "personal", kind: "todo", label: "Owner 할 일: 서류 내기" });
  s.card("1.6", { kind: "blocker", label: "블로커" });
  s.msg({ id: "9.1", chan: "dgit", thread: null, text: ":rotating_light: *급함* 서버 감시 • `x.service` 실패", at: s.t });
  assert.deepEqual(s.tick(s.t + 1), []);   // 처음 본 직후는 기다림
  const sent = Object.fromEntries(s.tick(s.t + 20));
  assert.deepEqual(Object.keys(sent).sort(), ["card:1.1", "card:1.5", "urgent:dgit:" + P.fmt6(s.t)]);
  assert.equal(sent["card:1.1"].title, "회사 · 결정");
  assert.equal(sent["card:1.5"].body, "서류 내기");
  assert.deepEqual(sent["urgent:dgit:" + P.fmt6(s.t)], { title: "급함 · DGit", body: "서버 감시 • x.service 실패", url: "./?open=thread:dgit:9.1", tag: "urgent:9.1" });
  assert.equal(s.got.length, 3);
  assert.deepEqual(s.tick(s.t + 40), []);
});

test("q: 가상 카드가 1초 안에 Slack 카드로 바뀌면 새 카드로 한 번", () => {
  const s = new Sim(); s.tick(s.t);
  s.card("q:company:Q-1", { area: "company", kind: "question", label: "질문", ref: "company:Q-1", posted_at: s.t - 40000 });
  s.tick(s.t + 0.5);
  Object.assign(s.cards.get("q:company:Q-1")!, { state: "replaced", replaced_by: "1792.000001" });
  s.card("1792.000001", { area: "company", kind: "question", label: "질문", ref: "company:Q-1" });
  assert.deepEqual(s.later(), ["card:1792.000001"]);
  assert.deepEqual(s.later(), []);
});

test("창 결정 알림 뒤 choice 카드로 바뀌어도 두 번 안 감", () => {
  const s = new Sim(); s.tick(s.t);
  s.card("w:9350", { kind: "decision", label: "창 결정", ref: "w:9350" });
  assert.deepEqual(s.later(), ["card:w:9350"]);
  Object.assign(s.cards.get("w:9350")!, { state: "replaced", replaced_by: "1793.000001" });
  s.card("1793.000001", { kind: "choice", label: "창 결정을 버튼으로", ref: "" });
  assert.deepEqual(s.later(), []);
});

test("rekey · dup_of 은 두 번 안 감", () => {
  const s = new Sim(); s.tick(s.t);
  s.card("1794.000001", { label: "카드", ref: "r1" });
  s.tick(s.t + 1);
  const r = s.cards.get("1794.000001")!; s.cards.delete(r.ts); r.ts = "1794.999999"; s.cards.set(r.ts, r);
  assert.deepEqual(s.later(), ["card:1794.999999"]);
  s.card("1795.000001", { kind: "decision", label: "같은 일 다른 말", ref: "w:1", dup_of: "1794.999999" });
  assert.deepEqual(s.later(), []);
});

test("같은 창의 두 번째 결정은 감", () => {
  const s = new Sim(); s.tick(s.t);
  s.card("w:1", { kind: "decision", label: "PR #1 판정", ref: "review-watch" });
  assert.deepEqual(s.later(), ["card:w:1"]);
  s.card("w:2", { kind: "decision", label: "PR #2 판정", ref: "review-watch" });
  assert.deepEqual(s.later(), ["card:w:2"]);
});

test("한꺼번에 많으면 한 통", () => {
  const s = new Sim(); s.tick(s.t);
  for (let n = 0; n < 6; n++) s.card(`18${n}.000001`, { label: `카드 ${n}`, ref: `r${n}` });
  assert.equal(s.later().length, 1);
  assert.equal(s.got.length, 1);
  assert.equal(s.got[0].title, "내 차례");
  assert.deepEqual(s.later(), []);
});

test("일시 실패(503)는 다시", () => {
  const s = new Sim(); s.tick(s.t);
  s.code = 503;
  s.card("1796.000001", { label: "카드", ref: "r" });
  assert.deepEqual(s.later(), []);
  s.code = 201;
  assert.deepEqual(s.later(), ["card:1796.000001"]);
  assert.deepEqual(s.later(), []);
});

test("꼴이 틀린 구독 · 410 은 지울 것, 다른 기기는 그대로", async () => {
  const v = (await P.vapidKey(P.b64u(crypto.getRandomValues(new Uint8Array(32)))))!;
  const ok = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch, gone = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
  const bad = await P.sendOne(v, { endpoint: "https://bad.example/x", p256dh: "AAAA", auth: "AAAA" }, te.encode("{}"), ok);
  assert.equal(bad, "ValueError"); assert.ok(P.dead(bad));
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const sub = { endpoint: "https://x.example/1", p256dh: P.b64u(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey) as ArrayBuffer)), auth: "MDEyMzQ1Njc4OWFiY2RlZg" };
  assert.equal(await P.sendOne(v, sub, te.encode("{}"), ok), 201);
  assert.ok(P.dead(await P.sendOne(v, sub, te.encode("{}"), gone)));
  const net = await P.sendOne(v, sub, te.encode("{}"), (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
  assert.equal(typeof net, "string"); assert.ok(!P.dead(net));   // 네트워크는 지우지 않고 다음 차례에 다시
});

test("키가 틀리거나 없으면 꺼짐(죽지 않음)", async () => {
  assert.equal(await P.vapidKey("!!not-b64"), null);
  assert.equal(await P.vapidKey(""), null);
  assert.notEqual(await P.vapidKey(" " + P.b64u(new Uint8Array(32).fill(1)) + "\n"), null);
});

test("구독 꼴 검사", () => {
  assert.equal(P.subOf({ sub: { endpoint: "http://evil/", keys: { p256dh: "a", auth: "b" } } }), null);
  assert.deepEqual(P.subOf({ sub: { endpoint: "https://web.push.apple.com/QX", keys: { p256dh: "a", auth: "b" } }, ua: "iPhone" }), { endpoint: "https://web.push.apple.com/QX", p256dh: "a", auth: "b", ua: "iPhone" });
  assert.equal(P.subOf({ sub: { endpoint: "https://a.b/" + "x".repeat(1000), keys: { p256dh: "a", auth: "b" } } }), null);
  assert.equal(P.subOf({ sub: { endpoint: "https://a.b/x", keys: { p256dh: "", auth: "b" } } }), null);
});

// ---------- push.py 와 대조(PUSH_FIXTURE) ----------
const FX = process.env.PUSH_FIXTURE ? JSON.parse(readFileSync(process.env.PUSH_FIXTURE, "utf8")) : null;
type Tick = { cards: P.Card[]; urg: P.Urg[]; now: number; before: P.State; picked: P.Todo[]; res: [string, P.Code][][]; after: P.State };
const norm = (s: P.State) => ({ known: Object.entries(s.known || {}), notified: [...new Set(s.notified)].sort(), fps: [...new Set(s.fps)].sort(), tries: s.tries });

test("push.py 대조: 틱마다 고른 것 · 상태", { skip: !FX }, () => {
  let ticks = 0, picked = 0, burst = 0, retry = 0, first = 0;
  for (const sc of FX.scenarios as Tick[][]) for (const t of sc) {
    const st = structuredClone(t.before) as P.State;
    if (!st.known) first++;
    const todo = P.pending(st, t.now, new Map(t.cards.map(r => [r.ts, r])), new Map(t.urg.map(r => [P.urgKey(r), r])));
    assert.deepEqual(todo, t.picked, `틱 ${ticks} 고른 것`);
    todo.forEach((x, i) => { if (!P.settle(st, x, t.res[i])) retry++; if (x[1].title === "내 차례") burst++; });
    assert.deepEqual(norm(st), norm(t.after), `틱 ${ticks} 상태`);
    ticks++; picked += todo.length;
  }
  console.log(`대조 틱 ${ticks}(첫 실행 ${first}) · 고른 것 ${picked}(한 통 ${burst} · 다시 ${retry}) — push.py 와 같음`);
});

test("push.py 대조: card_msg · urgent_msg · json.dumps 바이트 · 상수 · 서비스 워커", { skip: !FX }, () => {
  let n = 0;
  for (const m of FX.msgs) {
    if (!m.card_msg.error) { assert.deepEqual(P.cardMsg(m.card), m.card_msg); n++; }
    assert.deepEqual(P.urgentMsg(m.urg), m.urgent_msg); n++;
  }
  for (const j of FX.json) { assert.equal(P.b64u(te.encode(P.pyJson(j.msg))), j.bytes); n++; }
  assert.deepEqual(FX.consts, { SETTLE: P.SETTLE, MAX_AGE: P.MAX_AGE, BURST: P.BURST, TRIES: P.TRIES, KINDS: P.KINDS, SW: P.SW });
  console.log(`대조 글 ${n} — push.py 와 같음`);
});

test("push.py 대조: 같은 salt · eph 면 암호문 바이트가 같음", { skip: !FX }, async () => {
  for (const c of FX.crypt) {
    const payload = c.msg ? te.encode(P.pyJson(c.msg)) : P.unb64u(c.payload);
    assert.equal(P.b64u(payload), c.payload);
    const b = await P.encrypt(payload, c.p256dh, c.auth, P.unb64u(c.salt), await P.scalarKey(P.unb64u(c.eph), "ECDH"));
    assert.equal(P.b64u(b), c.ct);
  }
  console.log(`대조 암호문 ${FX.crypt.length}(RFC 8291 예시 + 무작위 ${FX.crypt.length - 1}) — 바이트 같음`);
});
