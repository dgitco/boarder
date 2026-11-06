const M64 = (1n << 64n) - 1n, M62 = (1n << 62n) - 1n, te = new TextEncoder();
export const EPOCH = 1793890800000;
export const TS = /^\d{10}\.\d{6}$/;
const UID = /^([0-9a-f]{8})-?([0-9a-f]{4})-?(7[0-9a-f]{3})-?([89ab][0-9a-f]{3})-?([0-9a-f]{12})$/;

export function fnv(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (const b of te.encode(s)) { h ^= BigInt(b); h = (h * 0x100000001b3n) & M64; }
  return h;
}
const hx = (n: bigint, w: number) => n.toString(16).padStart(w, "0");
function make(ms: bigint, a: bigint, b: bigint) {
  const t = hx(ms, 12), v = hx(0x7000n | (a & 0xfffn), 4), r = hx(0x8000n | ((b >> 48n) & 0x3fffn), 4);
  return `${t.slice(0, 8)}-${t.slice(8)}-${v}-${r}-${hx(b & 0xffffffffffffn, 12)}`;
}
/** 주소 조각 → 소문자 · 하이픈 꼴 UUID v7 | ""(대소문자 · 하이픈 없는 32자도 받음) */
export function norm(s: string): string {
  const m = UID.exec(String(s || "").toLowerCase());
  return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}` : "";
}
function parts(u: string) { const h = u.replace(/-/g, ""); return { ms: BigInt("0x" + h.slice(0, 12)), a: BigInt("0x" + h.slice(13, 16)), b: BigInt("0x" + h.slice(16)) & M62 }; }

/** 글 ts → UUID(ts 꼴이 아니면 "") */
export function msgUid(ts: string): string {
  if (!TS.test(ts || "")) return "";
  const s = BigInt(ts.slice(0, 10)), us = BigInt(ts.slice(11));
  return make(s * 1000n + us / 1000n, us % 1000n, fnv("m|" + ts) & M62);
}
export function uidTs(u: string): string {
  const n = norm(u); if (!n) return "";
  const { ms, a, b } = parts(n); if (a >= 1000n) return "";
  const s = ms / 1000n, us = (ms % 1000n) * 1000n + a, ts = `${s}`.padStart(10, "0") + "." + `${us}`.padStart(6, "0");
  return TS.test(ts) && (fnv("m|" + ts) & M62) === b ? ts : "";
}
export function keyUid(kind: "c" | "a", key: string): string {
  return make(BigInt(EPOCH), fnv("2|" + kind + "|" + key), fnv(kind + "|" + key) & M62);
}
/** UUID → 아는 키 가운데 같은 것 | "" */
export function uidKey(kind: "c" | "a", u: string, keys: Iterable<string>): string {
  const n = norm(u); if (!n) return "";
  for (const k of keys) if (keyUid(kind, k) === n) return k;
  return "";
}
/** 새 파일 id: 지금 시각 + 무작위(진짜 UUID v7) */
export function newUid(now = Date.now()): string {
  const r = crypto.getRandomValues(new Uint8Array(10)); let a = 0n, b = 0n;
  for (let i = 0; i < 2; i++) a = (a << 8n) | BigInt(r[i]);
  for (let i = 2; i < 10; i++) b = (b << 8n) | BigInt(r[i]);
  return make(BigInt(now), a, b & M62);
}
// 채널 키로 쓰는 이름(기본 다섯 · 등록한 에이전트 채널) — n: · i: 같은 화면 열쇠는 UUID 로 안 바꿈
export const CHAN_KEY = /^(?!x_)[a-z][a-z0-9_]{1,40}$/;
export const DEFAULT_CH = ["primary", "company", "personal", "dgit", "shop"];
export const GEN_FLAG = "write_uid_links";

/** 옛 화면 주소 → 새 UUID 주소 | null(바꿀 것 없음). 디비 없이 되는 것만: /chat/<이름>[/<ts>][?thread=<ts>] · /canvas/<옛 id>[-꼬리] · 대문자 UUID */
/** 채널 키 · 뿌리 ts · (스레드 속) 글 ts → 새 UUID 글 주소 | null(UUID 로 못 바꿈) */
export function chatPath(chan: string, root: string, msg?: string | null): string | null {
  const cu = CHAN_KEY.test(chan) ? keyUid("c", chan) : "", tu = msgUid(root), mu = msg && msg !== root ? msgUid(msg) : "";
  if (!cu || !tu || (msg && msg !== root && !mu)) return null;
  return mu ? `/chat/${cu}/${mu}?thread=${tu}` : `/chat/${cu}/${tu}`;
}
// 옛 36진 글 주소 /m/<채널 글자><뿌리 ts 36진>[_<글 ts 36진>][-<제목>] — 디비 없이 되돌림(board.html mHash 와 같은 셈)
const M36 = /^\/m\/([a-z])([0-9a-z]{6,12})(?:_([0-9a-z]{6,12}))?(?:-[^/]*)?\/?$/i, MK: Record<string, string> = { p: "primary", n: "company", e: "personal", d: "dgit", o: "shop" };
const unb36 = (x: string) => { const n = parseInt(x.toLowerCase(), 36); const d = Number.isSafeInteger(n) ? String(n).padStart(16, "0") : ""; return d.length === 16 ? d.slice(0, 10) + "." + d.slice(10) : ""; };
/** /m/<36진 id> → 새 UUID 주소 | null. 읽히는 번호 꼴(/m/1105-38)은 디비가 있어야 해서 여기선 null(index.ts 가 로그인한 주인만 찾음) */
export function m36Path(path: string): string | null {
  const m = M36.exec(path); if (!m) return null;
  const c = MK[m[1].toLowerCase()], t = c ? unb36(m[2]) : "", g = m[3] ? unb36(m[3]) : "";
  return c && t && (!m[3] || g) ? chatPath(c, t, g || null) : null;
}
export function newPath(path: string, search: string): string | null {
  const sp = new URLSearchParams(search), th = sp.get("thread") || "";
  let m = /^\/chat\/([^/]+)(?:\/([^/]+))?\/?$/.exec(path);
  if (m) {
    let c = m[1], t = m[2] || "";
    try { c = decodeURIComponent(c); } catch { return null; }
    const cu = norm(c) || (CHAN_KEY.test(c) ? keyUid("c", c) : ""); if (!cu) return null;
    const tu = t ? (norm(t) || msgUid(t)) : ""; if (t && !tu) return null;
    if (th) { const ru = norm(th) || msgUid(th); if (!ru) return null; sp.set("thread", ru); }
    const to = "/chat/" + cu + (tu ? "/" + tu : ""), q = sp.toString(), out = to + (q ? "?" + q : "");
    return out !== path + (search && search !== "?" ? (search[0] === "?" ? search : "?" + search) : "") ? out : null;
  }
  m = /^\/canvas\/([A-Za-z0-9-]{16,40})(?:-[^/]*)?\/?$/.exec(path);
  if (m) {
    const raw = /^\/canvas\/([^/]+)/.exec(path)![1];
    const u = norm(raw.slice(0, 36)) || norm(raw.slice(0, 32));
    if (u) { const to = "/canvas/" + u; return to !== path ? to + (search || "") : null; }
    const id = raw.replace(/-.*$/, "");
    return /^[A-Za-z0-9]{16,40}$/.test(id) ? "/canvas/" + keyUid("a", id) + (search || "") : null;
  }
  return null;
}
