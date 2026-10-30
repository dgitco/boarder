import { open, seal } from "./seal";
import { refresh, TokenError } from "./oauth";
import { hostedApp } from "./presets";
import { AuthError, forget, listTools, rpc, type Remote, type RemoteTool } from "./client";
import { exposedName, SEP } from "./naming";
import { API_PRESETS, GoogleTokenError, googleApp, googleToken, githubApp, githubAppToken, runApi, slackApp, slackToken, toolsFor, type ApiSpec } from "./apis";
import { accountFromText, whoamiFor } from "./identity";

export type Env = { DB: D1Database; CONNECTOR_KEY?: string; [k: string]: unknown };
export type Row = {
  id: string; owner: string; service: string; label: string; kind: "oauth" | "url" | "api"; url: string; auth: string; account: string;
  status: "ok" | "expired" | "error"; error: string | null; tools: string | null; tools_at: number | null; off: string; read_only: number;
  created_at: number; updated_at: number; source?: string;
};
export type Auth = {
  access_token?: string; refresh_token?: string; expires_at?: number;
  client_id?: string; client_secret?: string; hosted?: boolean; token_endpoint?: string; revocation_endpoint?: string; resource?: string;
  headers?: Record<string, string>;
  api?: ApiSpec; key?: string;   // kind 'api' — 구글 로그인 줄은 key = 액세스 토큰 + refresh_token · expires_at
};

export const TOOLS_TTL = 10 * 60_000;
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
export const prefixOf = (r: Pick<Row, "service" | "label">) => r.label ? `${r.service}${SEP}${r.label}` : r.service;

export async function list(env: Env, owner: string): Promise<Row[]> {
  return (await env.DB.prepare("SELECT * FROM connection WHERE owner = ? ORDER BY service, label").bind(owner).all<Row>()).results;
}
export async function get(env: Env, owner: string, id: string): Promise<Row | null> {
  return env.DB.prepare("SELECT * FROM connection WHERE owner = ? AND id = ?").bind(owner, id).first<Row>();
}

/** 새 연결 또는 같은 service · label 을 다시 연결(토큰만 바꿈) */
export async function upsert(env: Env, owner: string, v: { service: string; label: string; kind: Row["kind"]; url: string; auth: Auth; account?: string }): Promise<string> {
  const now = Date.now(), sealed = await seal(env.CONNECTOR_KEY, v.auth);
  const id = "c_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const r = await env.DB.prepare(
    `INSERT INTO connection(id, owner, service, label, kind, url, auth, account, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?, 'ok', ?, ?)
     ON CONFLICT(owner, service, label) DO UPDATE SET kind = excluded.kind, url = excluded.url, auth = excluded.auth, source = '', account = CASE WHEN excluded.account != '' THEN excluded.account ELSE connection.account END,
       status = 'ok', error = NULL, tools = NULL, tools_at = NULL, updated_at = excluded.updated_at
     RETURNING id`,
  ).bind(id, owner, v.service, v.label, v.kind, v.url, sealed, v.account || "", now, now).first<{ id: string }>();
  forget(r!.id);
  return r!.id;
}

async function mark(env: Env, id: string, status: Row["status"], error: string | null) {
  await env.DB.prepare("UPDATE connection SET status = ?, error = ?, updated_at = ? WHERE id = ?").bind(status, error, Date.now(), id).run();
}

const refreshing = new Map<string, Promise<Auth>>();
const clientOf = (env: Env, row: Row, a: Auth) => a.hosted ? (hostedApp(env, row.service) || { client_id: a.client_id! }) : { client_id: a.client_id!, client_secret: a.client_secret };

async function doRefresh(env: Env, row: Row, a: Auth): Promise<Auth> {
  if (env.OB_LIVE === "1" && row.source?.startsWith("0b:")) throw new Error("옮겨 오기 전 서비스가 아직 같은 토큰을 써요 — 옮기기를 마칠 때 새로 받아요");
  const running = refreshing.get(row.id); if (running) return running;
  const p = (async () => {
    try {
      const t = await refresh(a.token_endpoint!, a.refresh_token!, a.resource || row.url, clientOf(env, row, a));
      const next = { ...a, access_token: t.access_token, refresh_token: t.refresh_token || a.refresh_token, expires_at: t.expires_at };
      const sealed = await seal(env.CONNECTOR_KEY, next);
      await env.DB.prepare("UPDATE connection SET auth = ?, status = 'ok', error = NULL, updated_at = ? WHERE id = ?").bind(sealed, Date.now(), row.id).run();
      row.auth = sealed;
      return next;
    } catch (e) {
      // 다른 isolate 가 먼저 갱신했으면 그 토큰을 씀
      const fresh = await env.DB.prepare("SELECT auth FROM connection WHERE id = ?").bind(row.id).first<{ auth: string }>();
      if (fresh && fresh.auth !== row.auth) { row.auth = fresh.auth; return open<Auth>(env.CONNECTOR_KEY, fresh.auth); }
      const dead = e instanceof TokenError && (["invalid_grant", "bad_refresh_token", "invalid_client", "unauthorized_client"].includes(e.code || "") || (e.status >= 400 && e.status < 500 && e.status !== 429));
      await mark(env, row.id, dead ? "expired" : "error", dead ? "다시 연결이 필요해요" : (e instanceof Error ? e.message : String(e)).slice(0, 200));
      throw dead ? new AuthError("refresh") : e;
    } finally { refreshing.delete(row.id); }
  })();
  refreshing.set(row.id, p);
  return p;
}

/** 부를 준비: 토큰을 열고, 1분 안에 끝나면(또는 force) 갱신 */
export async function remote(env: Env, row: Row, force = false, timeoutMs?: number): Promise<Remote> {
  let a = await open<Auth>(env.CONNECTOR_KEY, row.auth);
  const canRefresh = row.kind === "oauth" && !!a.refresh_token && !!a.token_endpoint && !!a.client_id;
  if (canRefresh && (force || (a.expires_at && a.expires_at < Date.now() + 60_000))) a = await doRefresh(env, row, a);
  const headers: Record<string, string> = { ...(a.headers || {}) };
  if (a.access_token) headers.authorization = `Bearer ${a.access_token}`;
  return { id: row.id, url: row.url, headers, timeoutMs };
}

/** 401 이면 한 번 갱신하고 다시. 그래도 401 이면 끊김 */
async function withAuth<T>(env: Env, row: Row, f: (r: Remote) => Promise<T>, timeoutMs?: number): Promise<T> {
  try { return await f(await remote(env, row, false, timeoutMs)); }
  catch (e) {
    if (!(e instanceof AuthError)) throw e;
    const a = await open<Auth>(env.CONNECTOR_KEY, row.auth);
    if (row.kind === "oauth" && a.refresh_token && e.message !== "refresh") {
      try { return await f(await remote(env, row, true, timeoutMs)); } catch (e2) { if (!(e2 instanceof AuthError)) throw e2; }
    }
    await mark(env, row.id, "expired", "다시 연결이 필요해요");
    throw new AuthError(`${prefixOf(row)} 연결이 끊겼어요 — 보더 설정에서 다시 연결`);
  }
}

/** 원격 도구 목록(캐시 10분). fresh 면 새로 */
export async function tools(env: Env, row: Row, fresh = false, timeoutMs?: number): Promise<RemoteTool[]> {
  if (row.kind === "api") return apiTools(env, row);
  if (!fresh && row.tools && row.tools_at && Date.now() - row.tools_at < TOOLS_TTL) return JSON.parse(row.tools);
  try {
    const t = await withAuth(env, row, listTools, timeoutMs);
    const at = Date.now();
    await env.DB.prepare("UPDATE connection SET tools = ?, tools_at = ?, status = 'ok', error = NULL WHERE id = ?").bind(JSON.stringify(t), at, row.id).run();
    row.tools = JSON.stringify(t); row.tools_at = at; row.status = "ok"; row.error = null;
    return t;
  } catch (e) {
    if (!(e instanceof AuthError)) await mark(env, row.id, "error", (e instanceof Error ? e.message : String(e)).slice(0, 200));
    if (row.tools) return JSON.parse(row.tools);   // 옛 목록이라도
    throw e;
  }
}

export async function call(env: Env, row: Row, tool: string, args: Record<string, unknown>): Promise<unknown> {
  if (row.kind === "api") {
    const a = await apiAuth(env, row); if (!a.spec) throw new Error("이 API 는 다시 만들어요");
    const r = await runApi(a.spec, a.spec.auth.type === "oauth" ? await googleKey(env, row) : a.key, tool, args);
    const dead = r.isError && (a.spec.preset === "slack" && /^Slack: (token_expired|invalid_auth|token_revoked|account_inactive)/.test(r.content[0]?.text || "") || a.spec.preset === "github-app" && /^401 /.test(r.content[0]?.text || ""));
    if (dead && !(env.OB_LIVE === "1" && row.source?.startsWith("0b:"))) await mark(env, row.id, "expired", "다시 연결이 필요해요");
    return r;
  }
  return withAuth(env, row, r => rpc(r, "tools/call", { name: tool, arguments: args }));
}

/**
 * 구글 로그인 API 줄의 액세스 토큰: 1분 안에 끝나면 갱신 토큰으로 바꿔 봉해 둠(MCP 의 doRefresh 와 같은 꼴, 연결마다 하나씩).
 * 갱신 토큰을 구글이 거절하면(invalid_grant 등 — Gmail 테스트 앱은 7일마다) 「다시 연결」
 */
async function googleKey(env: Env, row: Row): Promise<string | undefined> {
  const a = await open<Auth>(env.CONNECTOR_KEY, row.auth);
  const provider = a.api?.auth.type === "oauth" ? a.api.auth.provider : null, slack = provider === "slack", github = provider === "github";
  const app = a.api ? (slack ? slackApp(env, a.api.auth) : github ? githubApp(env, a.api.auth) : googleApp(env, a.api.auth)) : null;
  if (!a.refresh_token || !app || !a.expires_at || a.expires_at > Date.now() + 60_000) return a.key;
  if ((slack || github) && env.OB_LIVE === "1" && row.source?.startsWith("0b:")) return a.key;
  const running = refreshing.get(row.id); if (running) return (await running).key;
  const p = (async () => {
    try {
      const t = slack ? await slackToken(app, a.refresh_token!) : github ? await githubAppToken(app, a.refresh_token!) : await googleToken(app, { grant_type: "refresh_token", refresh_token: a.refresh_token! });
      const next: Auth = { ...a, key: t.access_token, refresh_token: t.refresh_token || a.refresh_token, expires_at: t.expires_at };
      const sealed = await seal(env.CONNECTOR_KEY, next);
      await env.DB.prepare("UPDATE connection SET auth = ?, status = 'ok', error = NULL, updated_at = ? WHERE id = ?").bind(sealed, Date.now(), row.id).run();
      row.auth = sealed;
      return next;
    } catch (e) {
      const fresh = await env.DB.prepare("SELECT auth FROM connection WHERE id = ?").bind(row.id).first<{ auth: string }>();
      if (fresh && fresh.auth !== row.auth) { row.auth = fresh.auth; return open<Auth>(env.CONNECTOR_KEY, fresh.auth); }
      const dead = e instanceof GoogleTokenError && (e.code === "invalid_grant" || (e.status >= 400 && e.status < 500 && e.status !== 429));
      await mark(env, row.id, dead ? "expired" : "error", dead ? "다시 연결이 필요해요" : (e instanceof Error ? e.message : String(e)).slice(0, 200));
      throw dead ? new AuthError(`${prefixOf(row)} 연결이 끊겼어요 — 보더 설정에서 다시 연결`) : e;
    } finally { refreshing.delete(row.id); }
  })();
  refreshing.set(row.id, p);
  return (await p).key;
}

export async function apiAuth(env: Env, row: Row): Promise<{ spec?: ApiSpec; key?: string }> {
  const a = row.auth ? await open<Auth>(env.CONNECTOR_KEY, row.auth) : {};
  if (a.api) return { spec: a.api, key: a.key };
  const p = API_PRESETS[row.service]?.spec;
  try { if (p && new URL(row.url).origin === new URL(p.baseUrl).origin) return { spec: p, key: a.key }; } catch {}
  return { key: a.key };
}

/** API 커넥터 도구: 원격을 안 부르고 apis.ts 에서(네트워크 없음). PATCH off 가 이름을 확인하게 tools 칸에도 적어 둠 */
async function apiTools(env: Env, row: Row): Promise<RemoteTool[]> {
  const { spec } = await apiAuth(env, row); if (!spec) throw new Error("이 API 는 다시 만들어요(주소를 몰라요)");
  const t = toolsFor(spec).map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
  const json = JSON.stringify(t);
  if (row.tools !== json) {
    const at = Date.now();
    await env.DB.prepare("UPDATE connection SET tools = ?, tools_at = ? WHERE id = ?").bind(json, at, row.id).run();
    row.tools = json; row.tools_at = at;
  }
  return t;
}

/** 에이전트에게 보이는 커넥터 도구 하나 */
export type CTool = { name: string; conn: Row; remote: RemoteTool; readOnly: boolean };

/** 이 주인의 연결된 도구 전부(이름 = <service>[__<label>]__<tool>). 끊긴 연결은 빠짐. 이름이 겹치면 뒤 것에 hash */
const ERROR_BACKOFF_MS = 5 * 60_000;
export async function catalog(env: Env, owner: string, wait: (p: Promise<unknown>) => void): Promise<Map<string, CTool>> {
  const rows = (await list(env, owner)).sort((a, b) => a.id < b.id ? -1 : 1), out = new Map<string, CTool>();
  const lists = await Promise.all(rows.map(async (row): Promise<RemoteTool[]> => {
    if (row.status === "expired") return [];
    const stale = !row.tools_at || Date.now() - row.tools_at >= TOOLS_TTL;
    if (row.tools) { if (stale) wait(tools(env, row, true).catch(() => {})); return JSON.parse(row.tools); }
    if (row.status === "error" && Date.now() - row.updated_at < ERROR_BACKOFF_MS) return [];
    try { return await tools(env, row, false, 8_000); } catch { return []; }
  }));
  rows.forEach((row, i) => {
    const off = new Set(row.off.split(",").filter(Boolean));
    for (const t of lists[i]) {
      if (off.has(t.name)) continue;
      const readOnly = t.annotations?.readOnlyHint === true;
      if (row.read_only && !readOnly) continue;
      let name = exposedName(prefixOf(row), t.name);
      for (let n = 2; out.has(name); n++) name = exposedName(prefixOf(row), `${t.name}_${n}`);
      out.set(name, { name, conn: row, remote: t, readOnly });
    }
  });
  return out;
}

export async function probeAccount(env: Env, row: Row): Promise<string | null> {
  if (row.account || row.kind !== "oauth" && row.kind !== "url") return null;
  const ts = row.tools ? JSON.parse(row.tools) as RemoteTool[] : await tools(env, row);
  const probe = whoamiFor(row.url, ts), tool = probe && ts.find(t => t.name === probe.tool);
  if (!probe || !tool || tool.annotations?.readOnlyHint !== true || row.off.split(",").includes(tool.name)) return null;
  const r = await Promise.race([call(env, row, probe.tool, probe.args), new Promise<null>(res => setTimeout(() => res(null), 10_000))]).catch(() => null) as { content?: { type: string; text?: string }[]; isError?: boolean } | null;
  if (!r || r.isError) return null;
  const account = accountFromText((r.content || []).map(c => c.type === "text" ? c.text || "" : "").join("\n"));
  if (!account) return null;
  await env.DB.prepare("UPDATE connection SET account = ? WHERE id = ? AND account = ''").bind(account, row.id).run();
  row.account = account;
  return account;
}

/** 끊기: 줄을 지움(원격 폐기는 routes 가 먼저 시도) */
export async function remove(env: Env, owner: string, id: string) {
  const r = await env.DB.prepare("DELETE FROM connection WHERE owner = ? AND id = ?").bind(owner, id).run();
  forget(id);
  return (r.meta.changes || 0) > 0;
}
