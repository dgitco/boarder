/**
 * 커넥터 비밀 봉하기: AES-GCM(256), 키는 Worker 비밀 CONNECTOR_KEY(base64 32바이트). 꼴 = "v1." + base64url(iv 12 + 암호문).
 * 키가 없으면 연결을 거절(평문 저장 안 함).
 */
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/[+/=]/g, m => ({ "+": "-", "/": "_", "=": "" } as Record<string, string>)[m]);
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

let keyCache: { raw: string; key: CryptoKey } | null = null;
async function key(raw: string | undefined) {
  if (!raw) throw new Error("CONNECTOR_KEY 없음 — 커넥터를 쓸 수 없어요");
  if (keyCache?.raw === raw) return keyCache.key;
  const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("CONNECTOR_KEY 는 32바이트(base64)");
  const k = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  keyCache = { raw, key: k };
  return k;
}

export async function seal(raw: string | undefined, v: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(raw), new TextEncoder().encode(JSON.stringify(v))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return "v1." + b64u(out);
}

export async function open<T = Record<string, unknown>>(raw: string | undefined, s: string): Promise<T> {
  if (!s) return {} as T;
  if (!s.startsWith("v1.")) throw new Error("모르는 봉함 꼴");
  const b = unb64u(s.slice(3));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, await key(raw), b.slice(12));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export const randomId = (n = 24) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export const pkceChallenge = async (verifier: string) => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
