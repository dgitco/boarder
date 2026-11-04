import type { Context, Hono } from "hono";
import { RULE_KEYS } from "./install";
import { BUNDLE_KEYS } from "./harness-bundles";

type Env = { DB: D1Database; PUBLIC_URL: string };
type C = Context<{ Bindings: Env }>;
export type Dev = { id: string; owner: string; name: string };
export type Hooks = { device: (c: C) => Promise<Dev | null>; human: (c: C) => Promise<string | null>; sameSite: (c: C) => boolean };
export const TTL = 10 * 60_000;
export const MAX_OPEN = 5;
const NOSTORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");
const newToken = () => "ap_" + [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, "0")).join("");
const TOKEN = /^ap_[0-9a-f]{48}$/;
const CID = /^c_[0-9a-f]{20}$/;
const ctl = (s: unknown, n: number) => String(s ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim().slice(0, n);
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
const onoff = (v: unknown) => v === true || v === "on" || v === "true" ? true : v === false || v === "off" || v === "false" ? false : null;

type Act = { summary: string; req: { method: string; url: string; body?: unknown } };
/** 행동 목록: 인자를 검사해 (사람에게 보일 글 · 사람 세션으로 보낼 요청)을 만듦. 틀리면 에러 글 */
export const ACTIONS: Record<string, { help: string; make: (p: Record<string, unknown>, db: D1Database, me: string, dev: Dev) => Promise<Act | string> }> = {
  "connection.disconnect": { help: "id=<연결 id>", make: async (p, db, me) => {
    const id = String(p.id ?? ""); if (!CID.test(id)) return "id: 연결 id(c_…)";
    const r = await db.prepare("SELECT service, label FROM connection WHERE owner = ? AND id = ?").bind(me, id).first<{ service: string; label: string }>(); if (!r) return "내 연결이 아니에요";
    return { summary: `연결 「${r.service}${r.label ? ` (${r.label})` : ""}」 을 끊고 로그인 권한을 돌려줘요`, req: { method: "DELETE", url: `/api/connections/${id}` } };
  } },
  "connection.read-only": { help: "id=<연결 id> on=true|false", make: async (p, db, me) => {
    const id = String(p.id ?? ""), on = onoff(p.on); if (!CID.test(id) || on === null) return "id=<연결 id> on=true|false";
    const r = await db.prepare("SELECT service, label FROM connection WHERE owner = ? AND id = ?").bind(me, id).first<{ service: string; label: string }>(); if (!r) return "내 연결이 아니에요";
    return { summary: `연결 「${r.service}${r.label ? ` (${r.label})` : ""}」 을 ${on ? "읽기 전용으로" : "쓰기도 되게(읽기 전용 해제)"} 바꿔요`, req: { method: "PATCH", url: `/api/connections/${id}`, body: { read_only: on } } };
  } },
  "connection.label": { help: "id=<연결 id> label=<새 이름>", make: async (p, db, me) => {
    const id = String(p.id ?? ""), label = ctl(p.label, 24); if (!CID.test(id)) return "id=<연결 id> label=<새 이름>";
    const r = await db.prepare("SELECT service FROM connection WHERE owner = ? AND id = ?").bind(me, id).first<{ service: string }>(); if (!r) return "내 연결이 아니에요";
    return { summary: `연결 「${r.service}」 의 이름을 「${label || "(없음)"}」 으로 바꿔요`, req: { method: "PATCH", url: `/api/connections/${id}`, body: { label } } };
  } },
  "connection.tools": { help: "id=<연결 id> off=<끌 도구 이름을 쉼표로, 비우면 다 켬>", make: async (p, db, me) => {
    const id = String(p.id ?? ""); if (!CID.test(id)) return "id=<연결 id> off=a,b";
    const off = String(p.off ?? "").split(",").map(x => x.trim()).filter(Boolean);
    if (off.length > 200 || off.some(x => x.length > 120 || /[\x00-\x1f\x7f]/.test(x))) return "off: 도구 이름 쉼표 목록(200개 이하)";
    const r = await db.prepare("SELECT service, label FROM connection WHERE owner = ? AND id = ?").bind(me, id).first<{ service: string; label: string }>(); if (!r) return "내 연결이 아니에요";
    return { summary: off.length ? `연결 「${r.service}${r.label ? ` (${r.label})` : ""}」 에서 도구 ${off.length}개를 꺼요: ${off.slice(0, 5).join(", ")}${off.length > 5 ? " …" : ""}` : `연결 「${r.service}${r.label ? ` (${r.label})` : ""}」 의 꺼 둔 도구를 모두 켜요`, req: { method: "PATCH", url: `/api/connections/${id}`, body: { off } } };
  } },
  "device.revoke": { help: "id=<기기 id>", make: async (p, db, me, dev) => {
    const id = String(p.id ?? ""); if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) return "id: 기기 id";
    if (id === dev.id) return "이 요청을 보낸 기기 자신은 끊을 수 없어요";
    const r = await db.prepare("SELECT name FROM device WHERE id = ? AND owner = ? AND revoked_at IS NULL").bind(id, me).first<{ name: string }>(); if (!r) return "내 기기가 아니에요";
    return { summary: `기기 「${ctl(r.name, 60)}」 을 끊어요(그 기기의 토큰이 바로 죽고 되돌릴 수 없어요)`, req: { method: "POST", url: `/api/me/devices/${id}/revoke` } };
  } },
  "session-sync.on": { help: "(인자 없음)", make: async () => ({ summary: "세션 싱크를 켜요 — 앞으로 이 계정의 AI 대화가 서버에 저장돼요", req: { method: "POST", url: "/api/me/session-sync", body: { on: true } } }) },
  "bundle.set": { help: "name=<묶음> on=true|false", make: async (p) => {
    const name = String(p.name ?? ""), on = onoff(p.on); if (!(BUNDLE_KEYS as readonly string[]).includes(name) || on === null) return `name: ${BUNDLE_KEYS.join(" | ")} · on=true|false`;
    return { summary: `하네스 묶음 「${name}」 을 ${on ? "켜요" : "꺼요"}`, req: { method: "POST", url: "/api/me/nodeset", body: { prefs: { bundles: { [name]: on } } } } };
  } },
  "rule.set": { help: "name=<규칙> on=true|false", make: async (p) => {
    const name = String(p.name ?? ""), on = onoff(p.on); if (!(RULE_KEYS as readonly string[]).includes(name) || on === null) return `name: ${RULE_KEYS.join(" | ")} · on=true|false`;
    return { summary: `하네스 규칙 「${name}」 을 ${on ? "켜요" : "꺼요"}`, req: { method: "POST", url: "/api/me/nodeset", body: { prefs: { rules: { [name]: on } } } } };
  } },
};

const page = (body: string, status = 200) => new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>보더 승인</title><style>body{font:16px system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 16px;color:#111113}button{font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#111113;color:#fff;cursor:pointer}p.sub{color:#6b6b73}@media(prefers-color-scheme:dark){body{background:#111113;color:#eee}button{background:#eee;color:#111113}}</style></head><body>${body}</body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", ...NOSTORE, "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" } });

export function mountApprovalLink(host: Hono<any>, h: Hooks) {
  const app = host as unknown as Hono<{ Bindings: Env }>;

  app.get("/api/device/approval-actions", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401, NOSTORE);
    return c.json({ actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.help])) }, 200, NOSTORE);
  });

  // 내 연결 목록(읽기만, 허락 불필요) — 에이전트가 승인 신청에 쓸 id 를 알도록. 토큰 · 주소 · 계정은 뺌
  app.get("/api/device/connections", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401, NOSTORE);
    const rows = (await c.env.DB.prepare("SELECT id, service, label, kind, status, read_only, off, tools_at FROM connection WHERE owner = ? ORDER BY service, label").bind(d.owner.toLowerCase()).all<{ id: string; service: string; label: string; kind: string; status: string; read_only: number; off: string; tools_at: number | null }>()).results;
    return c.json({ connections: rows.map(r => ({ id: r.id, service: r.service, label: r.label, kind: r.kind, status: r.status, read_only: !!r.read_only, tools_off: r.off.split(",").filter(Boolean).length })) }, 200, NOSTORE);
  });

  app.post("/api/device/approval-link", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401, NOSTORE);
    const b = Object(await c.req.json().catch(() => ({}))) as { action?: unknown; params?: unknown };
    const action = String(b.action ?? "");
    if (!Object.hasOwn(ACTIONS, action)) return c.json({ error: `action: ${Object.keys(ACTIONS).join(" | ")}` }, 400, NOSTORE);
    const params = b.params && typeof b.params === "object" && !Array.isArray(b.params) ? b.params as Record<string, unknown> : {};
    const me = d.owner.toLowerCase(), now = Date.now();
    const made = await ACTIONS[action].make(params, c.env.DB, me, d);
    if (typeof made === "string") return c.json({ error: made }, 400, NOSTORE);
    const token = newToken();
    await c.env.DB.prepare("DELETE FROM approval_link WHERE expires_at < ?").bind(now - 24 * 3600_000).run();
    const ins = await c.env.DB.prepare("INSERT INTO approval_link(hash, owner, device_id, device_name, action, params, created_at, expires_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM approval_link WHERE owner = ? AND used_at IS NULL AND expires_at > ?) < ?")
      .bind(await sha(token), me, d.id, ctl(d.name, 60), action, JSON.stringify(params), now, now + TTL, me, now, MAX_OPEN).run();
    if (!ins.meta.changes) return c.json({ error: "열려 있는 승인 링크가 너무 많아요 — 쓰거나 10분 뒤에 다시 만들어요" }, 429, NOSTORE);
    return c.json({ ok: true, id: (await sha(token)).slice(0, 16), url: `${c.env.PUBLIC_URL.replace(/\/+$/, "")}/a/${token}`, summary: made.summary, expires_in: TTL / 1000 }, 200, NOSTORE);
  });

  // 확인 화면 — 소비하지 않음. 글은 저장된 인자로 다시 만듦(그 사이 연결이 지워졌으면 그대로 안내)
  app.get("/a/:token", async c => {
    const token = c.req.param("token");
    if (!TOKEN.test(token)) return page("<h2>링크가 맞지 않아요</h2><p class=sub>에이전트에게 새 링크를 부탁해요.</p>", 404);
    const me = await h.human(c);
    if (!me) return page(`<h2>먼저 로그인해요</h2><p class=sub>보더에 로그인한 브라우저에서 이 링크를 다시 열어요.</p><p><a href="${esc(c.env.PUBLIC_URL)}">보더 열기</a></p>`, 401);
    const r = await c.env.DB.prepare("SELECT device_id, device_name, action, params, used_at, expires_at FROM approval_link WHERE hash = ? AND owner = ?").bind(await sha(token), me).first<{ device_id: string; device_name: string; action: string; params: string; used_at: number | null; expires_at: number }>();
    if (!r) return page("<h2>링크가 맞지 않아요</h2><p class=sub>이 계정으로 만든 링크가 아니에요.</p>", 404);
    if (r.used_at || r.expires_at < Date.now()) return page("<h2>이미 쓰였거나 만료된 링크예요</h2><p class=sub>에이전트에게 새 링크를 부탁해요.</p>", 410);
    let made: Act | string = "행동을 읽지 못했어요"; try { if (Object.hasOwn(ACTIONS, r.action)) made = await ACTIONS[r.action].make(JSON.parse(r.params), c.env.DB, me, { id: r.device_id, owner: me, name: r.device_name }); } catch {}
    if (typeof made === "string") return page(`<h2>할 수 없는 요청이에요</h2><p class=sub>${esc(made)}</p>`, 409);
    return page(`<h2>승인 요청</h2><p>기기 「${esc(r.device_name)}」 이 요청했어요: <b>${esc(made.summary)}</b></p><p class=sub>내가 시킨 일이 아니면 닫아요.</p><p><button id=go>계속</button></p><p id=msg class=sub></p>
<script>
const msg=document.getElementById('msg'),b=document.getElementById('go'),T=${JSON.stringify(token)},H={'content-type':'application/json','x-hb':'1'};
b.onclick=async()=>{b.disabled=true;msg.textContent='처리하는 중';
 try{const a=await fetch('/api/approval/consume',{method:'POST',headers:H,body:JSON.stringify({token:T})});const j=await a.json();if(!a.ok)throw new Error(j.error||a.status);
  const r=await fetch(j.url,{method:j.method,headers:H,body:j.body===undefined?undefined:JSON.stringify(j.body)});
  if(!r.ok){let e='';try{e=(await r.json()).error||''}catch(_){}throw new Error(e||('처리하지 못했어요 '+r.status));}
  msg.textContent='했어요. 이 창은 닫아도 돼요.';
 }catch(e){msg.textContent=String(e.message||e);try{await fetch('/api/approval/release',{method:'POST',headers:H,body:JSON.stringify({token:T})});}catch(_){}b.disabled=false;}};
</script>`);
  });

  app.post("/api/approval/consume", async c => {
    if (!h.sameSite(c)) return c.json({ error: "no" }, 403, NOSTORE);
    const me = await h.human(c); if (!me) return c.json({ error: "로그인" }, 401, NOSTORE);
    const token = String(Object(await c.req.json().catch(() => ({}))).token ?? ""); if (!TOKEN.test(token)) return c.json({ error: "링크가 맞지 않아요" }, 404, NOSTORE);
    const hash = await sha(token), now = Date.now();
    const u = await c.env.DB.prepare("UPDATE approval_link SET used_at = ? WHERE hash = ? AND owner = ? AND used_at IS NULL AND expires_at > ? AND device_id IN (SELECT id FROM device WHERE revoked_at IS NULL) RETURNING device_id, device_name, action, params").bind(now, hash, me, now).first<{ device_id: string; device_name: string; action: string; params: string }>();
    if (!u) return c.json({ error: "이미 쓰였거나 만료됐거나 이 계정 링크가 아니에요" }, 410, NOSTORE);
    let made: Act | string = "행동을 읽지 못했어요"; try { if (Object.hasOwn(ACTIONS, u.action)) made = await ACTIONS[u.action].make(JSON.parse(u.params), c.env.DB, me, { id: u.device_id, owner: me, name: u.device_name }); } catch {}
    if (typeof made === "string") { await c.env.DB.prepare("UPDATE approval_link SET used_at = NULL WHERE hash = ?").bind(hash).run(); return c.json({ error: made }, 409, NOSTORE); }
    return c.json({ ok: true, ...made.req, summary: made.summary }, 200, NOSTORE);
  });

  app.post("/api/approval/release", async c => {
    if (!h.sameSite(c)) return c.json({ error: "no" }, 403, NOSTORE);
    const me = await h.human(c); if (!me) return c.json({ error: "로그인" }, 401, NOSTORE);
    const token = String(Object(await c.req.json().catch(() => ({}))).token ?? ""); if (!TOKEN.test(token)) return c.json({ error: "링크가 맞지 않아요" }, 404, NOSTORE);
    const now = Date.now();
    const u = await c.env.DB.prepare("UPDATE approval_link SET used_at = NULL WHERE hash = ? AND owner = ? AND used_at IS NOT NULL AND used_at > ? AND expires_at > ?").bind(await sha(token), me, now - 2 * 60_000, now).run();
    return c.json({ ok: !!u.meta.changes }, 200, NOSTORE);
  });
}
