
export const SUB = "mailto:owner@example.com";
export const URGENT = ":rotating_light: *급함*";
const KIND_KO: Record<string, string> = { choice: "결정", question: "질문", decision: "창 결정", draft: "채널톡 초안", todo: "할 일" };
const AREA_KO: Record<string, string> = { primary: "Primary", company: "회사", dgit: "DGit", shop: "가게", shopco: "가게", personal: "퍼스널" };
export const SETTLE = 8, MAX_AGE = 86400, BURST = 3, TRIES = 5;
export const KINDS = ["choice", "question", "decision", "draft", "todo"];

export type Msg = { title: string; body?: string; url?: string; tag?: string };
export type Card = { ts: string; area: string; kind: string; title: string | null; label: string | null; shape: string | null; state: string; replaced_by: string | null; dup_of: string | null; ref: string | null; posted_at: number | null };
export type Urg = { id: string; chan: string; thread: string | null; text: string; at: number };
// push-state.json 꼴 그대로(옮기기 스크립트가 그대로 올림). seq = 마지막으로 다 읽은 wl_change(Worker 만 씀 — 바뀐 게 없으면 표를 안 읽음)
export type State = { known?: Record<string, number | "done">; notified: string[]; fps: string[]; tries: Record<string, number>; seq?: number };
export type Todo = [key: string, msg: Msg, also: string[], fp: string | null];

// ---------- 글자 ----------
type B = Uint8Array<ArrayBuffer>;
export const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");   // Python s[:n](코드 포인트) — 이모지가 반으로 안 잘리게
const py = (v: unknown) => v === null || v === undefined ? "None" : String(v);   // f-string 의 None
// Python json.dumps(ensure_ascii=False) 와 같은 바이트(구분자 ", " · ": ") — 같은 salt · 키면 암호문까지 같게
export function pyJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(pyJson).join(", ") + "]";
  if (typeof v === "object") return "{" + Object.entries(v as object).map(([k, x]) => JSON.stringify(k) + ": " + pyJson(x)).join(", ") + "}";
  if (typeof v === "boolean") return v ? "true" : "false";
  return JSON.stringify(v);
}
// Python f'{x:.6f}'(정확한 2진 값에서 반올림, 딱 반이면 짝수로) — 급함 키(chan:at)가 push-state.json 의 키와 같게
export function fmt6(x: number) {
  const neg = x < 0, [i, f = ""] = Math.abs(x).toFixed(40).split(".");
  let n = BigInt(i + f.slice(0, 6));
  const rest = f.slice(6).replace(/0+$/, "");
  if (rest > "5" || (rest === "5" && n % 2n === 1n)) n += 1n;
  const s = n.toString().padStart(7, "0");
  return (neg && n ? "-" : "") + s.slice(0, -6) + "." + s.slice(-6);
}

// ---------- 보낼 글 ----------
export function cardMsg(r: Pick<Card, "ts" | "area" | "kind" | "title" | "label" | "shape">): Msg {
  let q: unknown = "";
  if (r.shape) { try { const o = JSON.parse(r.shape); q = o && typeof o === "object" ? (o as { q?: unknown }).q : undefined; } catch { q = ""; } }
  const line = String(r.label || q || r.title || "").trim().replace(/^Owner 할 일:\s*/, "");
  return { title: `${AREA_KO[r.area] ?? py(r.area)} · ${KIND_KO[r.kind] ?? py(r.kind)}`, body: cut(line, 180) || "새 카드", url: `./?open=card:${r.ts}`, tag: `card:${r.ts}` };
}
export function urgentMsg(r: Pick<Urg, "id" | "chan" | "thread" | "text">): Msg {
  let t = r.text.startsWith(URGENT) ? r.text.slice(URGENT.length).trim() : r.text;
  t = t.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2").replace(/[*`_~]/g, "");
  return { title: `급함 · ${AREA_KO[r.chan] ?? py(r.chan)}`, body: cut(t, 180), url: `./?open=thread:${r.chan}:${r.thread || r.id}`, tag: `urgent:${r.id}` };
}
export const urgKey = (u: Urg) => `${u.chan}:${fmt6(u.at)}`;

// ---------- 고르기(push.py Push.pending 그대로) ----------
// 새 줄은 처음 본 뒤 SETTLE 초 기다렸다 판정 — 그 사이 큐 질문 가상 카드(q:)는 Slack 카드로 바뀌고(replaced_by), 대화 DB 글 · 카드는 우리 id 에서 Slack ts 로 바뀜.
// 보낸 줄의 뒤 판(replaced_by 사슬) · 같은 일(dup_of) · 같은 내용(ref · 제목)은 다시 안 보냄. 첫 실행은 있는 것을 모두 본 것으로.
export function pending(st: State, now: number, cards: Map<string, Card>, urg: Map<string, Urg>): Todo[] {
  const keys = [...[...cards.keys()].map(k => "card:" + k), ...[...urg.keys()].map(k => "urgent:" + k)];
  if (!st.known) {
    st.known = Object.fromEntries(keys.map(k => [k, "done" as const])); st.notified = []; st.fps = []; st.tries = {};
    return [];
  }
  const known = st.known, notified = new Set(st.notified), fps = new Set(st.fps), have = new Set(keys);
  for (const k of keys) if (!(k in known)) known[k] = now;
  for (const k of Object.keys(known)) if (!have.has(k)) delete known[k];   // 사라진 줄(바뀐 id · 지운 줄)
  const prev = new Map<string, string[]>();
  for (const r of cards.values()) if (r.replaced_by) { const a = prev.get(r.replaced_by) || []; a.push(r.ts); prev.set(r.replaced_by, a); }
  const chainSent = (ts: string, seen: string[] = []): boolean => {
    if (notified.has("card:" + ts)) return true;
    const r = cards.get(ts);
    return [...(prev.get(ts) || []), ...(r && r.dup_of ? [r.dup_of] : [])].some(p => !seen.includes(p) && chainSent(p, [...seen, ts]));
  };
  let out: Todo[] = [];
  for (const [k, t0] of Object.entries(known)) {
    if (t0 === "done" || now - t0 < SETTLE) continue;
    known[k] = "done";
    if (k.startsWith("card:")) {
      const r = cards.get(k.slice(5))!;
      const fp = `${py(r.kind)}|${py(r.ref)}|${py(r.label || r.title)}`;
      if (!KINDS.includes(r.kind) || r.state !== "open" || (r.posted_at || 0) < now - MAX_AGE) continue;
      if (chainSent(r.ts) || fps.has(fp)) { notified.add(k); continue; }
      out.push([k, cardMsg(r), [k], fp]);
    } else {
      const r = urg.get(k.slice(7))!;
      if (r.at < now - MAX_AGE) continue;
      out.push([k, urgentMsg(r), [k], null]);
    }
  }
  const cs = out.filter(o => o[0].startsWith("card:"));
  if (cs.length > BURST) {   // 한꺼번에 많이 생기면 카드는 한 통으로
    out = [...out.filter(o => !o[0].startsWith("card:")), [cs[0][0], { title: "내 차례", body: `새 카드 ${cs.length}개 — ` + cut(cs[0][1].body || "", 120), url: "./?open=list", tag: "cards:" + cs[0][0] }, cs.map(c => c[0]), null]];
    for (const c of cs) if (c[3]) fps.add(c[3]);
  }
  st.notified = [...notified].slice(-1000); st.fps = [...fps].slice(-1000);
  return out;
}

// 보낸 뒤(push.py tick 의 뒷부분): 네트워크 · 429 · 5xx 는 다음 차례에 다시(TRIES 번까지), 아니면 「보냄」
export type Code = number | string;
export function settle(st: State, [key, , also, fp]: Todo, res: [string, Code][]) {
  const ok = res.some(([, c]) => c === 200 || c === 201 || c === 202);
  const transient = !ok && res.some(([, c]) => typeof c === "string" || c === 429 || c >= 500);
  if (transient && (st.tries[key] || 0) + 1 < TRIES) {
    st.tries[key] = (st.tries[key] || 0) + 1;
    for (const k of also) st.known![k] = 0;
    return false;
  }
  delete st.tries[key];
  st.notified = [...st.notified, ...also].slice(-1000);
  if (fp) st.fps = [...st.fps, fp].slice(-1000);
  return true;
}

// ---------- 암호 ----------
const te = new TextEncoder();
const cat = (...a: Uint8Array[]): B => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hmac(key: B, msg: B) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, msg));
}
const P8 = Uint8Array.from([0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20]);
export async function scalarKey(d: B, alg: "ECDSA" | "ECDH") {
  if (d.length !== 32) throw new Error("키 길이");
  const key = await crypto.subtle.importKey("pkcs8", cat(P8, d), { name: alg, namedCurve: "P-256" }, true, alg === "ECDSA" ? ["sign"] : ["deriveBits"]);
  const j = await crypto.subtle.exportKey("jwk", key) as JsonWebKey;
  return { key, pub: cat(Uint8Array.of(4), unb64u(j.x!), unb64u(j.y!)) };
}
export type Vapid = { key: CryptoKey; pub: string };
// 키가 틀려도 보드(Worker)는 떠야 함 — 푸시만 꺼짐(null)
export async function vapidKey(raw: string | undefined): Promise<Vapid | null> {
  const s = (raw || "").trim(); if (!s) return null;
  try { const k = await scalarKey(unb64u(s), "ECDSA"); return { key: k.key, pub: b64u(k.pub) }; } catch { return null; }
}

// RFC 8291 aes128gcm — 레코드 하나(4096 안). salt · eph 는 시험에서만(Python encrypt 와 바이트 대조)
export async function encrypt(payload: B, p256dh: string, auth: string, salt?: B, eph?: { key: CryptoKey; pub: B }) {
  const uaPub = unb64u(p256dh);
  const ua = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  if (!eph) {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    eph = { key: kp.privateKey, pub: new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey) as ArrayBuffer) };
  }
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ua }, eph.key, 256));
  const prkKey = await hmac(unb64u(auth), secret);
  const ikm = await hmac(prkKey, cat(te.encode("WebPush: info\0"), uaPub, eph.pub, Uint8Array.of(1)));
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, te.encode("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16);
  const nonce = (await hmac(prk, te.encode("Content-Encoding: nonce\0\x01"))).slice(0, 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, cat(payload, Uint8Array.of(2))));
  const head = new Uint8Array(21); new DataView(head.buffer).setUint32(16, 4096); head[20] = eph.pub.length; head.set(salt);
  return cat(head, eph.pub, ct);
}

// 주소의 scheme://netloc(Python urlsplit 그대로 — 포트를 지우지 않음) · hostname
const split = (ep: string) => /^([A-Za-z][\w+.-]*):\/\/([^/?#]*)/.exec(ep);
export const hostOf = (ep: string) => { const m = split(ep); return m ? m[2].replace(/^.*@/, "").replace(/:\d*$/, "").toLowerCase() || null : null; };
export async function vapidHeader(v: Vapid, endpoint: string, nowSec = Math.floor(Date.now() / 1000)) {
  const m = split(endpoint)!;
  const head = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(te.encode(JSON.stringify({ aud: `${m[1]}://${m[2]}`, exp: nowSec + 12 * 3600, sub: SUB })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v.key, te.encode(`${head}.${claims}`)));   // Web Crypto 는 r‖s 64바이트 그대로
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${v.pub}`;
}

export type Sub = { endpoint: string; p256dh: string; auth: string };
// 구독 하나에 보냄 → 상태 코드(숫자) 또는 실패 이름(글). 키 꼴이 틀린 구독은 「ValueError」(push.py 처럼 지움), 네트워크는 글(다음 차례에 다시)
export async function sendOne(v: Vapid, s: Sub, data: B, fetcher: typeof fetch = fetch): Promise<Code> {
  let body: B, auth: string;
  try { body = await encrypt(data, s.p256dh, s.auth); auth = await vapidHeader(v, s.endpoint); if (!split(s.endpoint)) throw new Error("주소"); }
  catch { return "ValueError"; }
  try {
    const r = await fetcher(s.endpoint, { method: "POST", body, signal: AbortSignal.timeout(15_000), redirect: "manual",
      headers: { Authorization: auth, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" } });
    await r.body?.cancel().catch(() => {});
    return r.status;
  } catch (e) { return (e as Error)?.name === "TimeoutError" ? "TimeoutError" : "URLError"; }
}
export const dead = (c: Code) => c === 404 || c === 410 || c === "ValueError";   // 끊겼거나 꼴이 틀린 구독

// 구독 꼴(push.py subscribe 의 검사 그대로): https 주소 · 1000자 안 · 키 둘
export function subOf(body: { sub?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; ua?: unknown }) {
  const sub = body.sub || {}, ep = String(sub.endpoint ?? ""), keys = sub.keys || {};
  if (!/^https:\/\/[\p{L}\p{N}_.-]+(:\d+)?\//u.test(ep) || Array.from(ep).length > 1000 || !keys.p256dh || !keys.auth) return null;
  return { endpoint: ep, p256dh: String(keys.p256dh), auth: String(keys.auth), ua: cut(String(body.ua ?? ""), 200) };
}

// 보드 웹 푸시 서비스 워커 — push.py SW 그대로(write_push 일 때 Worker 가 /sw.js 로 내줌)
export const SW = `// 보드 웹 푸시 서비스 워커(2026-10-26, push.py) — 알림 보이기 + 누르면 그 카드·스레드로
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (x) { m = {title: '보드', body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(m.title || '보드', {body: m.body || '', tag: m.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: {url: m.url || './', tag: m.tag}}));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {}, url = new URL(d.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const c = cs.find(x => x.url.startsWith(self.registration.scope));
    if (c){ await c.focus(); c.postMessage({hbOpen: url, tag: d.tag}); return; }
    await self.clients.openWindow(url);
  })());
});
`;

// ---------- 회원(초대 계정) 웹 푸시 ----------
// 주인 규칙(위)은 그대로 두고 회원 것만 따로: 카드가 생길 때 그 자리에서 보냄(틱 · 알람 없음 — 회원 칸은 알람을 안 걸어 비용이 없고, 되돌려도 옛 주인 틱이 회원 칸에서 돌 일이 없음).
// 제목은 늘 M_TITLE. 주소는 주인과 같은 ./?open=card:<id> — 열린 창이면 pushOpen, 없으면 첫 화면이 resolve 로 그 글을 엶
export const M_TITLE = "내 차례", M_BURST = 3, M_WINDOW = 60_000, M_SUBS = 10;
export function memberMsg(r: { id: string; question: string }): Msg {
  return { title: M_TITLE, body: cut(String(r.question || "").trim(), 180) || "새 카드", url: `./?open=card:${r.id}`, tag: `card:${r.id}` };
}
// 한 시간대에 카드가 많이 생기면 같은 tag 로 바꿔 끼워 알림 한 통으로(1분에 M_BURST 넘으면)
export function memberBurst(prev: { t: number; n: number } | null, now: number, m: Msg): { state: { t: number; n: number }; msg: Msg } {
  const n = prev && now - prev.t < M_WINDOW ? prev.n + 1 : 1, state = { t: n === 1 ? now : prev!.t, n };
  return { state, msg: n > M_BURST ? { ...m, body: `새 카드 ${n}개 — ` + (m.body || ""), tag: "cards" } : m };
}
export function memberName(email: unknown): string | null {
  const e = String(email ?? "").trim().toLowerCase();
  return e.length <= 254 && /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(e) ? e : null;
}
