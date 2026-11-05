import type { Context, Hono } from "hono";
import { API_PRESETS } from "./apis";
import { PRESETS } from "./presets";
import { oauthApi, titleOf } from "./connect-card";
import { readKeys } from "../who";
// 주인 열쇠 옮기는 동안(who.ts readKeys) '' · canon 둘 다 — 늘 「owner IN (?, ?)」 에 둘(회원은 같은 메일 두 번)
const kp = (env: unknown, k: string) => { const r = readKeys(env as { ALLOW_EMAILS?: string }, k); return [r[0], r[r.length - 1]]; };

type Env = { DB: D1Database; PUBLIC_URL: string };
type C = Context<{ Bindings: Env }>;
export type Dev = { id: string; owner: string; name: string };
export type Hooks = {
  device: (c: C) => Promise<Dev | null>;
  human: (c: C) => Promise<string | null>;   // 로그인한 사람의 메일(소문자). 토큰 머리가 붙은 요청은 null
  sameSite: (c: C) => boolean;
  key: (env: Env, email: string) => string;   // 줄 열쇠: 주인 "" · 회원 메일(커넥터 who() 와 같음) — 링크 · 연결 줄 모두 이 열쇠로 이음
};
export const TTL = 10 * 60_000;
export const MAX_OPEN = 5;
const NOSTORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
const own = (o: object, k: string) => Object.hasOwn(o, k);
const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");
const newToken = () => "cl_" + [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, "0")).join("");
const TOKEN = /^cl_[0-9a-f]{48}$/;
const ctl = (s: unknown, n: number) => String(s ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim().slice(0, n);
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));

/** 링크로 연결할 수 있는 서비스인지: 로그인(OAuth) 꼴만 */
export const linkable = (service: string) => own(PRESETS, service) || oauthApi(service);

const page = (body: string, status = 200) => new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>보더 연결</title><style>body{font:16px system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 16px;color:#111113}button{font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#111113;color:#fff;cursor:pointer}p.sub{color:#6b6b73}@media(prefers-color-scheme:dark){body{background:#111113;color:#eee}button{background:#eee;color:#111113}}</style></head><body>${body}</body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", ...NOSTORE, "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" } });   // 다른 사이트 틀 안에서 「계속」을 누르게 못 함

export function mountConnectLink(host: Hono<any>, h: Hooks) {
  const app = host as unknown as Hono<{ Bindings: Env }>;

  app.post("/api/device/connect-link", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401, NOSTORE);
    const b = Object(await c.req.json().catch(() => ({}))) as { service?: unknown; label?: unknown; reconnect?: unknown };
    const service = ctl(b.service, 40), label = ctl(b.label, 24), reconnect = typeof b.reconnect === "string" && /^c_[0-9a-f]{20}$/.test(b.reconnect) ? b.reconnect : null;
    if (!service) return c.json({ error: "service: 연결할 서비스 이름(예: linear · notion · github · google-calendar)" }, 400, NOSTORE);
    if (!linkable(service)) {
      const known = own(API_PRESETS, service) || own(PRESETS, service);
      return c.json({ error: known ? `${titleOf(service)} 은 키로 넣는 서비스예요 — boarder connect ${service} --key-file <파일> 로 보내고 사람은 보드 카드에서 「허용」만 눌러요` : "모르는 서비스예요" }, known ? 422 : 400, NOSTORE);
    }
    const me = h.key(c.env, d.owner), now = Date.now();
    if (reconnect) {
      const row = await c.env.DB.prepare("SELECT service FROM connection WHERE owner IN (?, ?) AND id = ?").bind(...kp(c.env, me), reconnect).first<{ service: string }>();
      if (!row || row.service !== service) return c.json({ error: "reconnect: 내 연결이 아니거나 서비스가 달라요" }, 400, NOSTORE);
    }
    const token = newToken();
    await c.env.DB.prepare("DELETE FROM connect_link WHERE expires_at < ?").bind(now - 24 * 3600_000).run();
    const ins = await c.env.DB.prepare("INSERT INTO connect_link(hash, owner, device_id, device_name, service, label, reconnect, created_at, expires_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM connect_link WHERE owner = ? AND used_at IS NULL AND expires_at > ?) < ?")
      .bind(await sha(token), me, d.id, ctl(d.name, 60), service, label, reconnect, now, now + TTL, me, now, MAX_OPEN).run();   // 세기와 넣기를 한 문장으로(동시에 와도 넘지 않게)
    if (!ins.meta.changes) return c.json({ error: "열려 있는 연결 링크가 너무 많아요 — 쓰거나 10분 뒤에 다시 만들어요" }, 429, NOSTORE);
    return c.json({ ok: true, id: (await sha(token)).slice(0, 16), url: `${c.env.PUBLIC_URL.replace(/\/+$/, "")}/c/${token}`, service, expires_in: TTL / 1000 }, 200, NOSTORE);
  });

  // 기다리는 쪽(CLI --wait): waiting(아직 안 엶) · opened(사람이 「계속」 누름) · connected(연결 줄이 생김) · expired. 그 기기가 만든 링크만
  app.get("/api/device/connect-link/:id", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401, NOSTORE);
    const id = c.req.param("id");
    if (!/^[0-9a-f]{16}$/.test(id)) return c.json({ error: "id" }, 400, NOSTORE);
    const me = h.key(c.env, d.owner);
    const r = await c.env.DB.prepare("SELECT service, label, created_at, expires_at, used_at FROM connect_link WHERE substr(hash, 1, 16) = ? AND owner IN (?, ?) AND device_id = ?").bind(id, ...kp(c.env, me), d.id).first<{ service: string; label: string; created_at: number; expires_at: number; used_at: number | null }>();
    if (!r) return c.json({ error: "없는 링크" }, 404, NOSTORE);
    const conn = r.used_at ? await c.env.DB.prepare("SELECT 1 FROM connection WHERE owner IN (?, ?) AND service = ? AND label = ? AND updated_at >= ? AND status = 'ok'").bind(...kp(c.env, me), r.service, r.label, r.used_at).first() : null;   // 「계속」 누른 뒤에 갱신된 연결만(옛 연결의 토큰 갱신을 완료로 오판하지 않음)
    return c.json({ state: conn ? "connected" : r.used_at ? "opened" : r.expires_at < Date.now() ? "expired" : "waiting", service: r.service }, 200, NOSTORE);
  });

  // 확인 화면 — 아무것도 소비하지 않음(미리보기가 열어도 안전). 로그인 안 했으면 로그인 안내
  app.get("/c/:token", async c => {
    const token = c.req.param("token");
    if (!TOKEN.test(token)) return page("<h2>링크가 맞지 않아요</h2><p class=sub>에이전트에게 새 링크를 부탁해요.</p>", 404);
    const me = await h.human(c);
    if (!me) return page(`<h2>먼저 로그인해요</h2><p class=sub>보더에 로그인한 브라우저에서 이 링크를 다시 열어요.</p><p><a href="${esc(c.env.PUBLIC_URL)}">보더 열기</a></p>`, 401);
    const r = await c.env.DB.prepare("SELECT device_name, service, label, used_at, expires_at FROM connect_link WHERE hash = ? AND owner IN (?, ?)").bind(await sha(token), ...kp(c.env, h.key(c.env, me))).first<{ device_name: string; service: string; label: string; used_at: number | null; expires_at: number }>();
    if (!r) return page("<h2>링크가 맞지 않아요</h2><p class=sub>이 계정으로 만든 링크가 아니에요. 링크를 만든 계정으로 로그인했는지 봐요.</p>", 404);
    if (r.used_at || r.expires_at < Date.now()) return page("<h2>이미 쓰였거나 만료된 링크예요</h2><p class=sub>에이전트에게 새 링크를 부탁해요.</p>", 410);
    return page(`<h2>${esc(titleOf(r.service))} 연결</h2><p>기기 「${esc(r.device_name)}」 이 ${esc(titleOf(r.service))}${r.label ? ` (${esc(r.label)})` : ""} 연결을 요청했어요. 내가 시킨 일이 아니면 닫아요.</p><p><button id=go>계속</button></p><p id=msg class=sub></p>
<script>
const msg=document.getElementById('msg'),b=document.getElementById('go');
b.onclick=async()=>{b.disabled=true;msg.textContent='연결 화면으로 가는 중';
 try{const H={'content-type':'application/json','x-hb':'1'};
  const a=await fetch('/api/connect-link/consume',{method:'POST',headers:H,body:JSON.stringify({token:${JSON.stringify(token)}})});const j=await a.json();
  if(!a.ok)throw new Error(j.error||a.status);
  const r=await fetch('/api/connections',{method:'POST',headers:H,body:JSON.stringify({service:j.service,label:j.label||undefined,reconnect:j.reconnect||undefined,back:'#settings/connectors'})});const k=await r.json();
  if(!r.ok||!k.authUrl)throw new Error(k.error||('연결을 시작하지 못했어요 '+r.status));
  location.href=k.authUrl;
 }catch(e){msg.textContent=String(e.message||e);try{await fetch('/api/connect-link/release',{method:'POST',headers:{'content-type':'application/json','x-hb':'1'},body:JSON.stringify({token:${JSON.stringify(token)}})});}catch(_){}b.disabled=false;}};
</script>`);
  });

  // 풀기 — 소비한 뒤 OAuth 시작이 실패했을 때(준비 안 된 서비스 · 네트워크) 그 링크를 되살림. 소비한 지 2분 안 · 같은 계정만
  app.post("/api/connect-link/release", async c => {
    if (!h.sameSite(c)) return c.json({ error: "no" }, 403, NOSTORE);
    const me = await h.human(c); if (!me) return c.json({ error: "로그인" }, 401, NOSTORE);
    const b = Object(await c.req.json().catch(() => ({}))) as { token?: unknown };
    const token = String(b.token ?? ""); if (!TOKEN.test(token)) return c.json({ error: "링크가 맞지 않아요" }, 404, NOSTORE);
    const now = Date.now();
    const u = await c.env.DB.prepare("UPDATE connect_link SET used_at = NULL WHERE hash = ? AND owner IN (?, ?) AND used_at IS NOT NULL AND used_at > ? AND expires_at > ?").bind(await sha(token), ...kp(c.env, h.key(c.env, me)), now - 2 * 60_000, now).run();
    return c.json({ ok: !!u.meta.changes }, 200, NOSTORE);
  });

  // 소비 — 사람 로그인 세션 + x-hb 만, 만든 회원 본인만, 한 번만(UPDATE … WHERE used_at IS NULL)
  app.post("/api/connect-link/consume", async c => {
    if (!h.sameSite(c)) return c.json({ error: "no" }, 403, NOSTORE);
    const me = await h.human(c); if (!me) return c.json({ error: "로그인" }, 401, NOSTORE);
    const b = Object(await c.req.json().catch(() => ({}))) as { token?: unknown };
    const token = String(b.token ?? ""); if (!TOKEN.test(token)) return c.json({ error: "링크가 맞지 않아요" }, 404, NOSTORE);
    const hash = await sha(token), now = Date.now();
    const u = await c.env.DB.prepare("UPDATE connect_link SET used_at = ? WHERE hash = ? AND owner IN (?, ?) AND used_at IS NULL AND expires_at > ? RETURNING service, label, reconnect").bind(now, hash, ...kp(c.env, h.key(c.env, me)), now).first<{ service: string; label: string; reconnect: string | null }>();
    if (!u) return c.json({ error: "이미 쓰였거나 만료됐거나 이 계정 링크가 아니에요" }, 410, NOSTORE);
    return c.json({ ok: true, service: u.service, label: u.label, reconnect: u.reconnect }, 200, NOSTORE);
  });
}
