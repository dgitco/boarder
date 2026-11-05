import { isAdmin } from "../who";
export { sealBlob, openBlob, sealedSize, BLOB_CHUNK, blobInfo, openBlobRange, type BlobInfo } from "./blob";

export type VaultEnv = {
  DB: D1Database;
  DATA_KEK_CUR?: string;
  CONNECTOR_KEY?: string;
  [k: `DATA_KEK_${string}`]: string | undefined;
};
export type FieldRef = { tbl: string; pk: string | number; col: string };

export class VaultError extends Error {
  constructor(msg: string, readonly code: "no_kek" | "no_dek" | "bad_cipher" | "e2e" | "bad_ref" = "bad_cipher") { super(msg); this.name = "VaultError"; }
}
/** 이 사람은 종단간 모드 — 서버는 열지도 봉하지도 않음(화면이 계정 키로) */
export class VaultE2eError extends VaultError {
  constructor(readonly owner: string) { super("종단간 모드 — 서버는 이 사람 글을 못 열어요", "e2e"); this.name = "VaultE2eError"; }
}

const enc = new TextEncoder(), dec = new TextDecoder();
// 런타임에 Uint8Array base64 가 있으면 그것(빠름), 없으면 고리 — Uint8Array.from(atob, fn) 은 칸 하나에 50µs 넘게 먹어 안 씀(잼 시험)
type Bytes = Uint8Array<ArrayBuffer>;
const U8 = Uint8Array as unknown as { fromBase64?: (s: string, o: object) => Bytes; prototype: { toBase64?: (o: object) => string } };
export const b64u = U8.prototype.toBase64
  ? (b: Uint8Array) => (b as unknown as { toBase64: (o: object) => string }).toBase64({ alphabet: "base64url", omitPadding: true })
  : (b: Uint8Array) => {
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
export const unb64u = U8.fromBase64
  ? (s: string) => U8.fromBase64!(s, { alphabet: "base64url" })
  : (s: string): Bytes => {
    const a = atob(s.replace(/-/g, "+").replace(/_/g, "/")), b = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) b[i] = a.charCodeAt(i);
    return b;
  };
const raw32 = (s: string | undefined, name: string): Bytes => {
  if (!s) throw new VaultError(`${name} 없음`, "no_kek");
  const b = Uint8Array.from(atob(s), c => c.charCodeAt(0));
  if (b.length !== 32) throw new VaultError(`${name} 는 32바이트(base64)`, "no_kek");
  return b;
};
const aes = (b: Bytes) => crypto.subtle.importKey("raw", b, "AES-GCM", false, ["encrypt", "decrypt"]);
async function gcm(key: CryptoKey, pt: Bytes, aad: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, pt));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
async function ungcm(key: CryptoKey, b: Bytes, aad: string | null): Promise<Bytes> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt(aad === null ? { name: "AES-GCM", iv: b.subarray(0, 12) } : { name: "AES-GCM", iv: b.subarray(0, 12), additionalData: enc.encode(aad) }, key, b.subarray(12)));
  } catch { throw new VaultError("열 수 없음(키 · 자리 안 맞음 또는 바뀐 값)"); }
}
const un64 = (s: string) => { try { return unb64u(s); } catch { throw new VaultError("꼴 깨짐(base64)"); } };
export { gcm as _gcm, ungcm as _ungcm, type Bytes };

// ── 붙듦(isolate 안) ────────────────────────────────────────────────
// 키는 owner|ver 로 — DEK 판은 한 번 생기면 안 바뀌니(KEK 를 바꿔도 DEK 는 같음) TTL 은 「지운 사람 · e2e 로 바꾼 사람」을 몇 분 안에 따라가려고만.
const TTL = 5 * 60_000, FLAG_TTL = 60_000, MAX = 2000;
type Dek = { ver: number; key: CryptoKey | null; mode: string; at: number };
const deks = new Map<string, Dek>();
const cur = new Map<string, { ver: number; at: number }>();   // owner → 새로 봉할 판
const keks = new Map<string, CryptoKey>();                   // "n|raw" → KEK
const flags = new Map<string, { db: D1Database; on: boolean; at: number }>();   // 스위치 이름 → 켜짐(1분 붙듦)
let legacy: { raw: string; key: CryptoKey } | null = null;
export const stats = { hit: 0, miss: 0 };
/** 시험 · 사람 지우기 뒤: 붙든 것 버림 */
export function _resetVaultCache() { deks.clear(); cur.clear(); keks.clear(); flags.clear(); legacy = null; stats.hit = stats.miss = 0; }
const put = <K, V>(m: Map<K, V>, k: K, v: V) => { if (m.size >= MAX) m.delete(m.keys().next().value as K); m.set(k, v); };   // 넣은 차례로 오래된 것부터 버림

export function forgetFlags() { flags.clear(); }
/** 사람별 스위치 이름 — 주인('')은 「owner」, 회원은 소문자 메일 */
export const envelopeFlag = (owner: string) => "envelope:" + (owner.trim().toLowerCase() || "owner");
async function flagOn(env: VaultEnv, name: string) {
  const now = Date.now(), f = flags.get(name);
  if (f && f.db === env.DB && now - f.at < FLAG_TTL) return f.on;
  const on = !!(await env.DB.prepare("SELECT 1 AS on_ FROM f7_flag WHERE name = ? AND on_at IS NOT NULL").bind(name).first());
  put(flags, name, { db: env.DB, on, at: now });
  return on;
}
export async function envelopeOn(env: VaultEnv, owner: string | null): Promise<boolean> {
  // 주인 메일(열쇠 이전 뒤 canon 열쇠 · 엔진 DO 기기 주인)은 스위치 이름이 「envelope:owner」 하나 — engine.ts flagOwner 와 같게
  if (owner && isAdmin(env as { ALLOW_EMAILS?: string }, owner)) owner = "";
  const on = (await flagOn(env, "envelope")) || (owner !== null && !owner.startsWith("x:") && (await flagOn(env, envelopeFlag(owner))));
  // 닫힌 채 실패: 스위치는 켰는데 KEK 비밀이 없으면 평문으로 조용히 쓰지 않고 던짐(쓰기가 크게 실패 — 되돌리기 = 스위치 끔)
  if (on && !env.DATA_KEK_CUR) throw new VaultError("envelope 스위치가 켜졌는데 DATA_KEK_CUR 가 없어요", "no_kek");
  return on;
}

async function kek(env: VaultEnv, n: number) {
  const s = env[`DATA_KEK_${n}`], ck = `${n}|${s}`;
  const hit = keks.get(ck); if (hit) return hit;
  const k = await aes(raw32(s, `DATA_KEK_${n}`));
  put(keks, ck, k);
  return k;
}
const curKek = (env: VaultEnv) => {
  const n = Number(env.DATA_KEK_CUR);
  if (!Number.isInteger(n) || n < 1) throw new VaultError("DATA_KEK_CUR 가 판 번호가 아님", "no_kek");
  return n;
};
const dekAad = (owner: string, ver: number) => `boarder dek v1|${owner}|${ver}`;
const wrap = async (env: VaultEnv, n: number, owner: string, ver: number, dekRaw: Bytes) => "k1." + b64u(await gcm(await kek(env, n), dekRaw, dekAad(owner, ver)));
const unwrap = async (env: VaultEnv, n: number, owner: string, ver: number, wrapped: string) => {
  if (!wrapped.startsWith("k1.")) throw new VaultError("모르는 DEK 감쌈 꼴");
  return ungcm(await kek(env, n), un64(wrapped.slice(3)), dekAad(owner, ver));
};

type Row = { ver: number; wrapped: string; kek: number; mode: string };
async function load(env: VaultEnv, owner: string, row: Row): Promise<Dek> {
  const d: Dek = row.mode === "e2e"
    ? { ver: row.ver, key: null, mode: "e2e", at: Date.now() }       // 못 풂 — 「e2e 다」만 붙듦
    : { ver: row.ver, key: await aes(await unwrap(env, row.kek, owner, row.ver, row.wrapped)), mode: row.mode, at: Date.now() };
  put(deks, `${owner}|${row.ver}`, d);
  return d;
}

/**
 * 그 사람의 DEK. ver 를 주면 그 판(열기), 안 주면 새로 봉할 판(retired 아닌 가장 큰 판).
 * create: 없으면 만듦(첫 쓰기) — 두 isolate 가 같이 만들면 INSERT OR IGNORE 뒤 다시 읽어 이긴 쪽을 씀.
 */
export async function getDek(env: VaultEnv, owner: string, opt: { create?: boolean; ver?: number } = {}): Promise<{ ver: number; key: CryptoKey }> {
  const now = Date.now();
  let ver = opt.ver;
  if (ver === undefined) { const c = cur.get(owner); if (c && now - c.at < TTL) ver = c.ver; }
  if (ver !== undefined) {
    const d = deks.get(`${owner}|${ver}`);
    if (d && now - d.at < TTL) { stats.hit++; if (!d.key) throw new VaultE2eError(owner); return { ver, key: d.key }; }
  }
  stats.miss++;
  let row = ver !== undefined
    ? await env.DB.prepare("SELECT ver, wrapped, kek, mode FROM dek WHERE owner = ? AND ver = ?").bind(owner, ver).first<Row>()
    : await env.DB.prepare("SELECT ver, wrapped, kek, mode FROM dek WHERE owner = ? AND retired_at IS NULL ORDER BY ver DESC LIMIT 1").bind(owner).first<Row>();
  if (!row && ver === undefined && opt.create) {
    const top = await env.DB.prepare("SELECT MAX(ver) AS v FROM dek WHERE owner = ?").bind(owner).first<{ v: number | null }>();
    const v = (top?.v ?? 0) + 1, n = curKek(env), raw = crypto.getRandomValues(new Uint8Array(32));
    await env.DB.prepare("INSERT OR IGNORE INTO dek(owner, ver, wrapped, kek, mode, created_at) VALUES (?, ?, ?, ?, 'server', ?)").bind(owner, v, await wrap(env, n, owner, v, raw), n, now).run();
    raw.fill(0);
    row = await env.DB.prepare("SELECT ver, wrapped, kek, mode FROM dek WHERE owner = ? AND retired_at IS NULL ORDER BY ver DESC LIMIT 1").bind(owner).first<Row>();
  }
  if (!row) throw new VaultError(ver !== undefined ? `DEK ${ver} 판 없음` : "DEK 없음", "no_dek");
  const d = await load(env, owner, row);
  if (opt.ver === undefined) put(cur, owner, { ver: d.ver, at: now });
  if (!d.key) throw new VaultE2eError(owner);
  return { ver: d.ver, key: d.key };
}

// ── 칸 ──────────────────────────────────────────────────────────────
const V2 = /^v2\.(\d{1,9})\.([A-Za-z0-9_-]{38,})$/;   // iv 12 + 꼬리표 16 = 28바이트 → 최소 38글자. 꼴이 엄격해야 「v2.0 나옴」 같은 평문이 안 걸림
const V1 = /^v1\.([A-Za-z0-9_-]{38,})$/;
const aad = (r: FieldRef, ver: number) => {
  if (r.tbl.includes("|") || r.col.includes("|")) throw new VaultError("표 · 칸 이름에 | 안 됨", "bad_ref");   // pk 만 자유 글 → 가름이 하나로 정해짐
  return `${r.tbl}|${r.pk}|${r.col}|${ver}`;
};
export const isSealed = (v: unknown): v is string => typeof v === "string" && (V2.test(v) || V1.test(v));
const needsEscape = (v: string): boolean => V2.test(v) || V1.test(v) || (v.startsWith("p0.") && needsEscape(v.slice(3)));
export const escapeField = (v: string) => needsEscape(v) ? "p0." + v : v;
export const unescapeField = (v: string) => v.startsWith("p0.") && needsEscape(v.slice(3)) ? v.slice(3) : v;
export const isEscaped = (v: unknown): v is string => typeof v === "string" && v !== unescapeField(v);

/** 칸 하나 봉함. 스위치가 꺼져 있으면 값을 그대로(지금과 같음). null · undefined 도 그대로 */
export async function sealField<T extends string | null | undefined>(env: VaultEnv, owner: string, ref: FieldRef, value: T): Promise<T | string> {
  if (value === null || value === undefined) return value;
  if (!(await envelopeOn(env, owner))) return escapeField(value);   // 평문으로 남는 길 — 봉한 꼴이면 감쌈
  return sealFieldNow(env, owner, ref, value);
}
/** 스위치를 안 보고 봉함 — 부른 쪽이 이미 스위치를 본 때만(엔진 DO: DEK 주인 = 기기 주인 메일, 스위치 이름은 주인 = 'owner') */
export async function sealFieldNow(env: VaultEnv, owner: string, ref: FieldRef, value: string): Promise<string> {
  const { ver, key } = await getDek(env, owner, { create: true });
  return `v2.${ver}.` + b64u(await gcm(key, enc.encode(value), aad(ref, ver)));
}

/** 칸 하나 엶. 봉한 꼴이 아니면 그대로(늦은 옮기기). 옛 "v1."(CONNECTOR_KEY) 은 안의 글(JSON 글월)을 그대로 돌려줌 */
export async function openField<T extends string | null | undefined>(env: VaultEnv, owner: string, ref: FieldRef, value: T): Promise<T | string> {
  if (typeof value !== "string") return value;
  let m = V2.exec(value);
  if (m) {
    const ver = Number(m[1]), { key } = await getDek(env, owner, { ver });
    return dec.decode(await ungcm(key, un64(m[2]), aad(ref, ver)));
  }
  if ((m = V1.exec(value))) return dec.decode(await ungcm(await legacyKey(env), un64(m[1]), null));
  return unescapeField(value);   // 평문(감싼 것은 뗌 — 열려 들지 않음)
}
async function legacyKey(env: VaultEnv) {
  const s = env.CONNECTOR_KEY;
  if (legacy && s && legacy.raw === s) return legacy.key;
  const k = await aes(raw32(s, "CONNECTOR_KEY"));
  legacy = { raw: s!, key: k };
  return k;
}

// ── KEK 돌려 바꾸기 · e2e 넘기기 ───────────────────────────────────────
/**
 * fromKek 로 감싼 DEK 줄을 toKek 으로 다시 감쌈 — 칸 · 몸통은 그대로(DEK 가 안 바뀜). 다 끝난 뒤 DATA_KEK_CUR = toKek, 옛 비밀 지움.
 * 줄마다 「kek = fromKek 일 때만」 바꿔(CAS) 두 번 돌려도 · 동시에 돌아도 안전. e2e 줄은 KEK 로 감싼 게 아니라 건너뜀.
 */
export async function rewrapAll(env: VaultEnv, fromKek: number, toKek: number, page = 100): Promise<{ done: number; failed: string[] }> {
  if (fromKek === toKek) return { done: 0, failed: [] };
  await kek(env, toKek);   // 새 비밀이 없으면 한 줄도 안 건드리고 바로 실패
  let done = 0, after = { owner: "", ver: -1 };
  const failed: string[] = [];
  for (;;) {
    const rs = (await env.DB.prepare("SELECT owner, ver, wrapped, kek, mode FROM dek WHERE kek = ? AND mode = 'server' AND (owner > ? OR (owner = ? AND ver > ?)) ORDER BY owner, ver LIMIT ?")
      .bind(fromKek, after.owner, after.owner, after.ver, page).all<Row & { owner: string }>()).results;
    if (!rs.length) break;
    const ups: D1PreparedStatement[] = [];
    for (const r of rs) {
      try {
        const raw = await unwrap(env, fromKek, r.owner, r.ver, r.wrapped);
        ups.push(env.DB.prepare("UPDATE dek SET wrapped = ?, kek = ? WHERE owner = ? AND ver = ? AND kek = ?").bind(await wrap(env, toKek, r.owner, r.ver, raw), toKek, r.owner, r.ver, fromKek));
        raw.fill(0);
      } catch { failed.push(`${r.owner}|${r.ver}`); }   // 한 줄이 망가져도 나머지는 돌림 — 망가진 줄은 사람이 봄
    }
    if (ups.length) for (const x of await env.DB.batch(ups)) done += Number(x.meta?.changes ?? 0);
    after = rs[rs.length - 1];
  }
  return { done, failed };
}

export async function adoptE2e(env: VaultEnv, owner: string, wrapped: string): Promise<number> {
  const now = Date.now();
  const top = await env.DB.prepare("SELECT MAX(ver) AS v FROM dek WHERE owner = ?").bind(owner).first<{ v: number | null }>();
  const v = (top?.v ?? 0) + 1;
  await env.DB.batch([
    env.DB.prepare("UPDATE dek SET retired_at = ? WHERE owner = ? AND retired_at IS NULL").bind(now, owner),
    env.DB.prepare("INSERT INTO dek(owner, ver, wrapped, kek, mode, created_at) VALUES (?, ?, ?, 0, 'e2e', ?)").bind(owner, v, wrapped, now),
    env.DB.prepare("INSERT INTO f7_flag(name, on_at, note) VALUES (?, ?, 'e2e') ON CONFLICT(name) DO UPDATE SET on_at = excluded.on_at").bind(envelopeFlag(owner), now),
  ]);
  cur.delete(owner); flags.delete(envelopeFlag(owner));
  return v;
}
