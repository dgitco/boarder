/**
 * 원격 MCP 의 OAuth(MCP 권한 규격): 보호 자원 메타(RFC 9728) → 권한 서버 메타(RFC 8414 · OIDC) → 동적 등록(RFC 7591) → PKCE(S256) 로 보내기 → 콜백에서 코드 바꾸기 → 갱신.
 * 서버가 동적 등록을 안 받으면 미리 만든 클라이언트(presets.ts 의 client_id · Worker 비밀)를 씀.
 */
import { pkceChallenge, randomId } from "./seal";

export type AuthServer = { issuer?: string; authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string; scopes_supported?: string[]; revocation_endpoint?: string };
export type Discovered = { as: AuthServer; resource: string; scopes?: string[] };
export type Tokens = { access_token: string; refresh_token?: string; expires_at?: number; scope?: string; id_token?: string };   // id_token: OpenID 면 그 계정(identity.ts) — 봉해 두지 않음

export function safeUrl(u: string): string {
  let x: URL; try { x = new URL(u); } catch { throw new Error("주소 꼴이 아님"); }
  const h = x.hostname.toLowerCase();
  if (x.protocol !== "https:" || x.username || x.password) throw new Error("https 주소만");
  if (/^\[|^\d+\.\d+\.\d+\.\d+$|^0x|^\d+$/.test(h) || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) throw new Error("공개 이름 주소만(IP · 내부 이름 안 됨)");
  return x.toString();
}
export class TokenError extends Error { constructor(msg: string, public status: number, public code?: string) { super(msg); } }

const TIMEOUT = () => ({ signal: AbortSignal.timeout(15_000), redirect: "manual" as const });
const getJson = async (u: string) => {
  const r = await fetch(safeUrl(u), { headers: { accept: "application/json" }, ...TIMEOUT() });
  if (!r.ok) { await r.body?.cancel(); return null; }
  try { return await r.json() as Record<string, any>; } catch { return null; }
};
// /.well-known/<name> 을 경로 앞에 끼움(RFC 8414 §3), 안 되면 뿌리
const wellKnown = (base: string, name: string) => {
  const u = new URL(base), p = u.pathname.replace(/\/+$/, "");
  return [...(p ? [`${u.origin}/.well-known/${name}${p}`] : []), `${u.origin}/.well-known/${name}`];
};

export async function discover(mcpUrl: string): Promise<Discovered | null> {
  // 1) 토큰 없이 불러 401 머리의 resource_metadata, 없으면 정해진 자리
  let prmUrl: string | undefined;
  try {
    const r = await fetch(safeUrl(mcpUrl), { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "boarder", version: "0.1.0" } } }), ...TIMEOUT() });
    await r.body?.cancel();
    if (r.status !== 401 && r.status !== 403) return null;   // 토큰 없이 됨 — OAuth 아님
    prmUrl = /resource_metadata="([^"]+)"/.exec(r.headers.get("www-authenticate") || "")?.[1];
  } catch { /* 아래 정해진 자리로 */ }
  let prm: Record<string, any> | null = null;
  for (const u of prmUrl ? [prmUrl] : wellKnown(mcpUrl, "oauth-protected-resource")) if ((prm = await getJson(u))) break;
  const asBase: string = prm?.authorization_servers?.[0] || new URL(mcpUrl).origin;
  let as: Record<string, any> | null = null;
  for (const u of [...wellKnown(asBase, "oauth-authorization-server"), ...wellKnown(asBase, "openid-configuration")]) if ((as = await getJson(u))?.authorization_endpoint) break;
  if (!as?.authorization_endpoint || !as.token_endpoint) return null;
  const resource: string = prm?.resource || mcpUrl;
  if (new URL(resource).origin !== new URL(mcpUrl).origin) throw new Error("보호 자원 메타의 주소가 MCP 주소와 다름");
  if (Array.isArray(as.code_challenge_methods_supported) && !as.code_challenge_methods_supported.includes("S256")) throw new Error("이 서비스는 PKCE(S256)를 안 받아요");
  for (const k of ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"]) if (as[k]) safeUrl(as[k]);
  return { as: as as AuthServer, resource, scopes: prm?.scopes_supported || as.scopes_supported };
}

export async function register(as: AuthServer, redirectUri: string): Promise<{ client_id: string; client_secret?: string }> {
  if (!as.registration_endpoint) throw new Error("이 서비스는 동적 등록을 안 받아요 — 미리 만든 클라이언트가 필요");
  const r = await fetch(safeUrl(as.registration_endpoint), {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, ...TIMEOUT(),
    body: JSON.stringify({ client_name: "Boarder", client_uri: "https://boarder.dgit.co", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
  });
  const j = await r.json().catch(() => ({})) as Record<string, any>;
  if (!r.ok || !j.client_id) throw new Error(`동적 등록 실패 ${r.status}${j.error ? ` ${j.error}` : ""}`);
  return { client_id: j.client_id, client_secret: j.client_secret };
}

export async function authorizeUrl(d: Discovered, client_id: string, redirectUri: string, scope?: string) {
  const verifier = randomId(48), state = randomId(24);
  const u = new URL(d.as.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", client_id);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("code_challenge", await pkceChallenge(verifier));
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  u.searchParams.set("resource", d.resource);
  if (scope) u.searchParams.set("scope", scope);
  return { url: u.toString(), verifier, state };
}

async function token(endpoint: string, form: Record<string, string>, client: { client_id: string; client_secret?: string }): Promise<Tokens> {
  const body = new URLSearchParams({ ...form, client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}) });
  const r = await fetch(safeUrl(endpoint), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body, ...TIMEOUT() });
  const text = await r.text();
  let j: Record<string, any> = {};
  try { j = JSON.parse(text); } catch { j = Object.fromEntries(new URLSearchParams(text)); }   // GitHub 은 form 으로 답할 때가 있음
  if (!r.ok || !j.access_token) throw new TokenError(`토큰 받기 실패 ${r.status}${j.error ? ` ${j.error}` : ""}`, r.status, j.error);   // 값은 안 찍음(GitHub 은 200 + error 로 답함)
  return { access_token: j.access_token, refresh_token: j.refresh_token, scope: j.scope, expires_at: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : undefined, id_token: typeof j.id_token === "string" ? j.id_token : undefined };
}

export const exchange = (endpoint: string, code: string, verifier: string, redirectUri: string, resource: string, client: { client_id: string; client_secret?: string }) =>
  token(endpoint, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, resource }, client);

export const refresh = (endpoint: string, refreshToken: string, resource: string, client: { client_id: string; client_secret?: string }) =>
  token(endpoint, { grant_type: "refresh_token", refresh_token: refreshToken, resource }, client);

export async function revoke(endpoint: string | undefined, tok: string, client: { client_id: string; client_secret?: string }) {
  if (!endpoint) return false;
  const body = new URLSearchParams({ token: tok, client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}) });
  const r = await fetch(safeUrl(endpoint), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, ...TIMEOUT() }).catch(() => null);
  await r?.body?.cancel();
  return !!r?.ok;
}
