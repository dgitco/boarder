import type { Context, Hono } from "hono";
import { z } from "zod";
import { PRESETS, PREREGISTERED, SCOPES, TITLES, hostedApp } from "./presets";
import { authorizeUrl, discover, exchange, register, revoke, safeUrl } from "./oauth";
import { forget, listTools } from "./client";
import { open, randomId, seal } from "./seal";
import { accountOfIdToken } from "./identity";
import { exposedName } from "./naming";
import * as store from "./store";
import { API_PRESETS, apiReady, checkKey, googleAccountOf, googleApp, googleAuthUrl, googleToken, keyNames, parseAuth, type ApiSpec } from "./apis";

type Env = store.Env & { PUBLIC_URL: string; ALT_URLS?: string };
type C = Context<{ Bindings: Env }>;
export type Who = (c: C) => Promise<{ owner: string; email: string } | null>;

const PENDING_MS = 10 * 60_000;
const hostOk = (env: Env, origin: string) => [env.PUBLIC_URL, ...(env.ALT_URLS || "").split(",")].map(s => s.trim().replace(/\/+$/, "")).includes(origin);
const sameSite = (c: C) => c.req.header("x-hb") === "1" && ["same-origin", "none", undefined].includes(c.req.header("sec-fetch-site"));
const httpsUrl = z.string().max(500).refine(u => { try { safeUrl(u); return true; } catch { return false; } }, "https 공개 이름 주소만");
const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");
const cookieOf = (c: C, n: string) => new RegExp(`(?:^|;\\s*)${n}=([^;]+)`).exec(c.req.header("cookie") || "")?.[1];
async function probe(url: string, headers: Record<string, string>) {
  const id = "probe_" + crypto.randomUUID();
  try { return await listTools({ id, url, headers, timeoutMs: 15_000 }); } finally { forget(id); }
}
const header = z.string().regex(/^[A-Za-z0-9-]{1,60}$/);

const ConnectBody = z.object({
  service: z.string().min(1).max(40),
  label: z.string().max(24).optional(),
  url: httpsUrl.optional(),
  headers: z.record(header, z.string().max(4000)).optional(),
  client_id: z.string().max(200).optional(),
  client_secret: z.string().max(400).optional(),
  back: z.string().regex(/^#[\w/.-]{0,80}$/).optional(),
  reconnect: z.string().regex(/^c_[0-9a-f]{20}$/).optional(),
  api: z.object({ preset: z.string().max(40).optional(), base_url: httpsUrl.optional(), auth: z.unknown().optional(), headers: z.record(header, z.string().max(1000)).optional() }).optional(),
  key: z.string().max(8192).optional(),
});

type Ready = (service: string) => ReturnType<typeof apiReady>;
const migrated = (r: store.Row, rd: Ready) => {
  if (!(r.kind === "api" && !r.auth && r.error?.startsWith("0b 에서 옮김"))) return r.error?.replace(/^0b 에서 옮김/, "옮겨 온 연결") ?? r.error;
  if (!API_PRESETS[r.service]) return "옮겨 온 연결 — 끊고 다시 만들어요";
  const x = rd(r.service);
  return x.ready ? (x.oauth ? "옮겨 온 연결 — 다시 연결해요" : "옮겨 온 연결 — 키를 넣어요") : x.soon ? "옮겨 온 연결 — 곧(구글 검토 뒤)" : `옮겨 온 연결 — ${x.note || "준비 중"}`;
};
const imapAccount = (spec: ApiSpec, key: string) => spec.auth.type === "imap" ? (key.split("\n")[1] || "").slice(0, 120) : undefined;
const view = (r: store.Row, rd: Ready) => {
  const tools = r.tools ? (JSON.parse(r.tools) as unknown[]).length : null;
  const x = r.kind === "api" ? rd(r.service) : null;
  return {
    id: r.id, service: r.service, label: r.label, prefix: store.prefixOf(r), title: TITLES[r.service] || API_PRESETS[r.service]?.title || r.service,
    kind: r.kind, host: r.url.startsWith("imaps:") ? "IMAP" : new URL(r.url).host, account: r.account, status: r.status, error: migrated(r, rd),
    tools, off: r.off.split(",").filter(Boolean).length, read_only: !!r.read_only, tools_at: r.tools_at, updated_at: r.updated_at,
    ...(x?.oauth ? { api_oauth: true } : {}),   // 구글 로그인 API — 화면은 「키 넣기」 대신 「다시 연결」
  };
};

export function mountConnectors(host: Hono<any>, who: Who) {
  const app = host as unknown as Hono<{ Bindings: Env }>;
  const me = async (c: C, write = false) => {
    if (write && !sameSite(c)) return { err: c.json({ error: "no" }, 403) };
    const w = await who(c); if (!w) return { err: c.json({ error: "로그인" }, 401) };
    if (!c.env.CONNECTOR_KEY) return { err: c.json({ error: "커넥터 준비 안 됨(CONNECTOR_KEY)" }, 503) };
    const rd: Ready = service => apiReady(c.env as unknown as Record<string, unknown>, service, w.email);
    return { w, rd };
  };

  const startGoogle = async (c: C, owner: string, service: string, label: string, spec: ApiSpec, back?: string) => {
    if (spec.auth.type !== "oauth") return c.json({ error: "구글 로그인 API 가 아니에요" }, 400);
    const app = googleApp(c.env as unknown as Record<string, unknown>, spec.auth); if (!app) return c.json({ error: "구글 로그인 앱이 없어요" }, 422);
    if (new URL(c.req.url).origin !== c.env.PUBLIC_URL.replace(/\/+$/, "")) return c.json({ error: `${service} 은 ${c.env.PUBLIC_URL} 에서 연결해요`, open: `${c.env.PUBLIC_URL}/#settings/connectors` }, 409);
    const redirect = `${c.env.PUBLIC_URL.replace(/\/+$/, "")}/api/connectors/callback`, state = randomId(24), bind = randomId(24);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM connection_pending WHERE expires_at < ?").bind(Date.now()),
      c.env.DB.prepare("INSERT INTO connection_pending(state, owner, service, label, url, auth, back, bind, expires_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(state, owner, service, label, spec.baseUrl, await seal(c.env.CONNECTOR_KEY, { google: true, spec, redirect_uri: redirect }), back || "#settings/connectors", await sha(bind), Date.now() + PENDING_MS),
    ]);
    return c.json({ state: "authenticating", authUrl: googleAuthUrl(app, redirect, state, spec.auth.scope) }, 200, { "set-cookie": `bx_oc_${state.slice(0, 12).replace(/[^A-Za-z0-9]/g, "x")}=${bind}; Path=/api/connectors/callback; Secure; HttpOnly; SameSite=Lax; Max-Age=600` });
  };

  app.get("/api/connectors", async c => {
    const m = await me(c); if (m.err) return m.err;
    return c.json({
      services: Object.entries(PRESETS).map(([service, url]) => ({ service, title: TITLES[service] || service, url, needs_app: PREREGISTERED.has(service) && !hostedApp(c.env as unknown as Record<string, unknown>, service) })),
      apis: Object.entries(API_PRESETS).map(([service, p]) => { const x = m.rd(service); return { service, title: p.title, url: p.spec.baseUrl, keys: keyNames(p.spec.auth), ready: x.ready, soon: !!x.soon, oauth: !!x.oauth, note: x.note || "", ...(p.plain ? { plain: p.plain } : {}), ...(p.hints ? { hints: p.hints } : {}), ...(x.via ? { via: x.via } : {}) }; }),
    });
  });

  app.get("/api/connections", async c => {
    const m = await me(c); if (m.err) return m.err;
    return c.json({ connections: (await store.list(c.env, m.w.owner)).map(r => view(r, m.rd)) });
  });

  app.post("/api/connections", async c => {
    const m = await me(c, true); if (m.err) return m.err;
    const p = ConnectBody.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: p.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join("; ") }, 400);
    const b = p.data;
    if (b.reconnect){
      const row = await store.get(c.env, m.w.owner, b.reconnect); if (!row) return c.json({ error: "없는 연결" }, 404);
      if (row.kind === "api") {   // 키만 바꿈 — 주소 · 인증 꼴은 그 줄 그대로(구글 로그인 API 는 구글에 다시 로그인)
        const { spec } = await store.apiAuth(c.env, row), p = API_PRESETS[row.service];
        if (!spec) return c.json({ error: "이 API 는 끊고 다시 만들어요" }, 422);
        if (spec.preset && p && !m.rd(row.service).ready) return c.json({ error: `${p.title} 은 아직 준비 중이에요${p.note ? ` — ${p.note}` : ""}` }, 422);
        if (spec.auth.type === "oauth") return startGoogle(c, m.w.owner, row.service, row.label, spec.preset && p ? p.spec : spec, b.back);
        const k = checkKey(spec.auth, b.key); if ("error" in k) return c.json({ error: k.error }, 400);
        const id = await store.upsert(c.env, m.w.owner, { service: row.service, label: row.label, kind: "api", url: spec.baseUrl, auth: { api: spec, key: k.key }, account: imapAccount(spec, k.key) });
        return c.json({ state: "connected", id });
      }
      b.service = row.service; b.label = row.label || undefined; b.url = row.url;
    }
    const service = store.slug(b.service), label = b.label ? store.slug(b.label) : "";
    if (!service || service === "boarder" || service === "bridge") return c.json({ error: "서비스 이름" }, 400);
    if (b.api) {   // API 커넥터: 키를 봉해 두고 도구는 보더 안에서(apis.ts). 키가 맞는지는 처음 부를 때 공급자가 답함
      let spec: ApiSpec;
      if (b.api.preset) {
        const p = API_PRESETS[b.api.preset]; if (!p) return c.json({ error: "모르는 API" }, 400);
        if (!m.rd(b.api.preset).ready) return c.json({ error: `${p.title} 은 아직 준비 중이에요${p.note ? ` — ${p.note}` : ""}` }, 422);
        if (service !== b.api.preset) return c.json({ error: "service 는 그 API 이름" }, 400);
        spec = p.spec;
        if (spec.auth.type === "oauth") {   // 구글 로그인 — 키 없음. 같은 이름이 키 API 로 있으면 겹침
          const hit = (await store.list(c.env, m.w.owner)).find(r => r.service === service && r.label === label);
          if (hit && hit.kind !== "api") return c.json({ error: `${store.prefixOf(hit)} 은 이미 다른 꼴로 연결돼 있어요 — 라벨을 붙여요` }, 409);
          return startGoogle(c, m.w.owner, service, label, spec, b.back);
        }
      } else {
        const auth = parseAuth(b.api.auth);
        if (!b.api.base_url || !auth) return c.json({ error: "base_url(https) 과 auth(bearer · header · query · basic)" }, 400);
        if (PRESETS[service] || API_PRESETS[service]) return c.json({ error: "그 이름은 보더가 아는 서비스예요 — 다른 이름" }, 400);
        spec = { baseUrl: b.api.base_url.replace(/\/+$/, ""), auth, headers: b.api.headers };
      }
      const k = checkKey(spec.auth, b.key); if ("error" in k) return c.json({ error: k.error }, 400);
      const hit = (await store.list(c.env, m.w.owner)).find(r => r.service === service && r.label === label);
      if (hit && (hit.kind !== "api" || hit.url !== spec.baseUrl)) return c.json({ error: `${store.prefixOf(hit)} 은 이미 다른 주소로 연결돼 있어요 — 라벨을 붙여요` }, 409);
      const id = await store.upsert(c.env, m.w.owner, { service, label, kind: "api", url: spec.baseUrl, auth: { api: spec, key: k.key }, account: imapAccount(spec, k.key) });
      return c.json({ state: "connected", id });
    }
    const url = b.url || PRESETS[service]; if (!url) return c.json({ error: "모르는 서비스 — MCP 주소(url)를 넣어요" }, 400);
    const same = (await store.list(c.env, m.w.owner)).filter(r => r.service === service);
    const hit = same.find(r => r.label === label);
    if (hit && hit.url !== url) {
      const used = new Set(same.map(r => r.label)); let n = 2; while (used.has(String(n))) n++;
      return c.json({ error: `${store.prefixOf(hit)} 은 이미 다른 주소로 연결돼 있어요 — 라벨을 붙여요`, suggestion: String(n) }, 409);
    }
    // 머리(API 키 등)를 주면 OAuth 없이: 도구 목록이 읽히면 연결
    if (b.headers && Object.keys(b.headers).length) {
      try { await probe(url, b.headers); }
      catch (e) { return c.json({ error: `연결 확인 실패: ${e instanceof Error ? e.message : e}` }, 422); }
      const id = await store.upsert(c.env, m.w.owner, { service, label, kind: "url", url, auth: { headers: b.headers } });
      return c.json({ state: "connected", id });
    }
    let d; try { d = await discover(url); } catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 422); }
    if (!d) {   // 로그인 없이 되는 서버(deepwiki 등)
      try { await probe(url, {}); }
      catch (e) { return c.json({ error: `이 주소는 MCP 로 답하지 않아요: ${e instanceof Error ? e.message : e}` }, 422); }
      const id = await store.upsert(c.env, m.w.owner, { service, label, kind: "url", url, auth: {} });
      return c.json({ state: "connected", id });
    }
    const hosted = url === PRESETS[service] ? hostedApp(c.env as unknown as Record<string, unknown>, service) : null;
    const origin = new URL(c.req.url).origin, base = !hosted && hostOk(c.env, origin) ? origin : c.env.PUBLIC_URL;
    if (hosted && !b.client_id && origin !== c.env.PUBLIC_URL.replace(/\/+$/, "")) return c.json({ error: `${service} 은 ${c.env.PUBLIC_URL} 에서 연결해요`, open: `${c.env.PUBLIC_URL}/#settings/connectors` }, 409);
    const redirect = `${base}/api/connectors/callback`;
    let client: { client_id: string; client_secret?: string };
    if (b.client_id) client = { client_id: b.client_id, client_secret: b.client_secret };
    else if (hosted) client = hosted;
    else if (d.as.registration_endpoint) {
      try { client = await register(d.as, redirect); } catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 422); }
    } else return c.json({ error: "이 서비스는 미리 만든 OAuth 앱(client_id)이 있어야 해요", needs_app: true }, 422);
    const scope = SCOPES[service] || (d.scopes?.length ? d.scopes.join(" ") : undefined);
    const a = await authorizeUrl(d, client.client_id, redirect, scope);
    const bind = randomId(24);
    const saved = hosted && !b.client_id ? { client_id: client.client_id, hosted: true } : client;
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM connection_pending WHERE expires_at < ?").bind(Date.now()),
      c.env.DB.prepare("INSERT INTO connection_pending(state, owner, service, label, url, auth, back, bind, expires_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(a.state, m.w.owner, service, label, url, await seal(c.env.CONNECTOR_KEY, { verifier: a.verifier, ...saved, token_endpoint: d.as.token_endpoint, revocation_endpoint: d.as.revocation_endpoint, redirect_uri: redirect, resource: d.resource }), b.back || "#settings/connectors", await sha(bind), Date.now() + PENDING_MS),
    ]);
    return c.json({ state: "authenticating", authUrl: a.url }, 200, { "set-cookie": `bx_oc_${a.state.slice(0, 12).replace(/[^A-Za-z0-9]/g, "x")}=${bind}; Path=/api/connectors/callback; Secure; HttpOnly; SameSite=Lax; Max-Age=600` });
  });

  app.get("/api/connectors/callback", async c => {
    const q = new URL(c.req.url).searchParams, state = q.get("state") || "";
    const back = (to: string, k: string, v: string) => c.redirect(`/${to}${to.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`, 302);
    const w = await who(c); if (!w) return c.redirect("/", 302);
    const p = await c.env.DB.prepare("DELETE FROM connection_pending WHERE state = ? RETURNING *").bind(state).first<{ owner: string; service: string; label: string; url: string; auth: string; back: string; bind: string; expires_at: number }>();
    if (!p || p.expires_at < Date.now()) return back("#settings/connectors", "error", "연결 시간이 지났어요 — 다시 눌러요");
    const oc = cookieOf(c, `bx_oc_${state.slice(0, 12).replace(/[^A-Za-z0-9]/g, "x")}`);
    if (p.owner !== w.owner || !oc || (await sha(oc)) !== p.bind) return back(p.back, "error", "이 브라우저에서 시작한 연결이 아니에요");
    if (q.get("error")) return back(p.back, "error", `${p.service}: ${q.get("error_description") || q.get("error")}`.slice(0, 200));
    const g = await open<{ google?: boolean; spec?: ApiSpec; redirect_uri?: string }>(c.env.CONNECTOR_KEY, p.auth);
    if (g.google && g.spec) {   // 구글 로그인 API: 코드 → 토큰(그 API 의 구글 앱), 계정은 그 API 에 물음
      const app = googleApp(c.env as unknown as Record<string, unknown>, g.spec.auth); if (!app) return back(p.back, "error", "구글 로그인 앱이 없어요");
      try {
        const t = await googleToken(app, { grant_type: "authorization_code", code: q.get("code") || "", redirect_uri: g.redirect_uri! });
        const id = await store.upsert(c.env, w.owner, { service: p.service, label: p.label, kind: "api", url: g.spec.baseUrl,
          auth: { api: g.spec, key: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at }, account: await googleAccountOf(g.spec, t.access_token) });
        return back(p.back, "connected", id);
      } catch (e) { return back(p.back, "error", (e instanceof Error ? e.message : String(e)).slice(0, 200)); }
    }
    const a = g as unknown as { verifier: string; client_id: string; client_secret?: string; hosted?: boolean; token_endpoint: string; revocation_endpoint?: string; redirect_uri: string; resource: string };
    const client = a.hosted ? (hostedApp(c.env as unknown as Record<string, unknown>, p.service) || { client_id: a.client_id }) : a;
    try {
      const t = await exchange(a.token_endpoint, q.get("code") || "", a.verifier, a.redirect_uri, a.resource, client);
      const id = await store.upsert(c.env, w.owner, {
        service: p.service, label: p.label, kind: "oauth", url: p.url,
        auth: { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, client_id: a.client_id, client_secret: a.hosted ? undefined : a.client_secret, hosted: a.hosted, token_endpoint: a.token_endpoint, revocation_endpoint: a.revocation_endpoint, resource: a.resource },
        account: t.id_token ? accountOfIdToken(t.id_token) || "" : "",   // 어느 계정으로 들어왔는지(OpenID 면 여기서, 아니면 아래 「나는 누구」 도구)
      });
      const row = await store.get(c.env, w.owner, id);
      if (row) c.executionCtx.waitUntil(store.tools(c.env, row, true).then(() => store.probeAccount(c.env, row)).catch(() => {}));   // 도구 목록 미리 · 계정 칸
      return back(p.back, "connected", id);
    } catch (e) { return back(p.back, "error", (e instanceof Error ? e.message : String(e)).slice(0, 200)); }
  });

  app.get("/api/connections/:id/tools", async c => {
    const m = await me(c); if (m.err) return m.err;
    const row = await store.get(c.env, m.w.owner, c.req.param("id")); if (!row) return c.json({ error: "없음" }, 404);
    let ts; try { ts = await store.tools(c.env, row, c.req.query("fresh") === "1"); } catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e), connection: view(row, m.rd) }, 502); }
    const off = new Set(row.off.split(",").filter(Boolean));
    return c.json({ connection: view(row, m.rd), tools: ts.map(t => ({ name: t.name, exposed: exposedName(store.prefixOf(row), t.name), title: t.title, description: (t.description || "").slice(0, 300), read_only: t.annotations?.readOnlyHint === true, on: !off.has(t.name) })) });
  });

  app.patch("/api/connections/:id", async c => {
    const m = await me(c, true); if (m.err) return m.err;
    const b = await c.req.json<{ label?: string; off?: string[]; read_only?: boolean }>().catch(() => ({} as Record<string, never>));
    const row = await store.get(c.env, m.w.owner, c.req.param("id")); if (!row) return c.json({ error: "없음" }, 404);
    const sets: string[] = [], vals: unknown[] = [];
    if (typeof b.label === "string") { sets.push("label = ?"); vals.push(b.label ? store.slug(b.label) : ""); }
    if (Array.isArray(b.off)) {
      let names: Set<string>; try { names = new Set((row.tools ? JSON.parse(row.tools) as { name: string }[] : await store.tools(c.env, row)).map(t => t.name)); } catch { return c.json({ error: "도구 목록을 못 읽어 끌 수 없어요" }, 502); }
      const bad = b.off.filter(x => typeof x !== "string" || !names.has(x) || x.includes(","));
      if (bad.length) return c.json({ error: `없는 도구: ${bad.slice(0, 5).join(", ")}` }, 400);
      sets.push("off = ?"); vals.push(b.off.join(","));
    }
    if (typeof b.read_only === "boolean") { sets.push("read_only = ?"); vals.push(b.read_only ? 1 : 0); }
    if (!sets.length) return c.json({ error: "label · off · read_only" }, 400);
    try { await c.env.DB.prepare(`UPDATE connection SET ${sets.join(", ")}, updated_at = ? WHERE owner = ? AND id = ?`).bind(...vals, Date.now(), m.w.owner, row.id).run(); }
    catch { return c.json({ error: "그 라벨은 이미 있어요" }, 409); }
    return c.json({ connection: view((await store.get(c.env, m.w.owner, row.id))!, m.rd) });
  });

  app.post("/api/connections/:id/refresh", async c => {
    const m = await me(c, true); if (m.err) return m.err;
    const row = await store.get(c.env, m.w.owner, c.req.param("id")); if (!row) return c.json({ error: "없음" }, 404);
    try { const ts = await store.tools(c.env, row, true); await store.probeAccount(c.env, row).catch(() => null); return c.json({ ok: true, tools: ts.length }); }   // 계정 칸이 비었으면 이때 채움(전에 연결한 줄)
    catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 502); }
  });

  app.delete("/api/connections/:id", async c => {
    const m = await me(c, true); if (m.err) return m.err;
    const row = await store.get(c.env, m.w.owner, c.req.param("id")); if (!row) return c.json({ error: "없음" }, 404);
    let revoked = false;
    try {
      const a = await open<store.Auth>(c.env.CONNECTOR_KEY, row.auth);
      const cl = a.hosted ? hostedApp(c.env as unknown as Record<string, unknown>, row.service) : (a.client_id ? { client_id: a.client_id, client_secret: a.client_secret } : null);
      if (cl && (a.refresh_token || a.access_token)) revoked = await revoke(a.revocation_endpoint, (a.refresh_token || a.access_token)!, cl);
      if (a.api?.auth.type === "oauth" && a.api.auth.app === "gmail" && (a.refresh_token || a.key))
        revoked = !!(await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: (a.refresh_token || a.key)! }), signal: AbortSignal.timeout(10_000) }).then(r => r.ok).catch(() => false));
    } catch { /* 폐기 못 해도 지움 */ }
    await store.remove(c.env, m.w.owner, row.id);
    return c.json({ ok: true, revoked });
  });
}
