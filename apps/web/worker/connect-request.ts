import type { Context, Hono } from "hono";
import { API_PRESETS, apiReady, checkKey, parseAuth, type ApiSpec } from "./connectors/apis";
import { PRESETS } from "./connectors/presets";
import { safeUrl } from "./connectors/oauth";
import * as store from "./connectors/store";
import { openSecret, sealSecret } from "./vault/secret";

type Env = store.Env & { PUBLIC_URL: string };
type C = Context<{ Bindings: Env }>;
export type Dev = { id: string; owner: string; name: string };
export type Hooks = { device: (c: C) => Promise<Dev | null>; card?: (env: Env, owner: string, card: { id: string; question: string }) => void };

export const TTL = 10 * 60_000;
export const ALLOW = "허용", DENY = "거절";
const MAX_PENDING = 5;
const ref = (id: string) => ({ tbl: "connect_request" as const, pk: id, col: "payload" as const });
const rid = (p: string) => p + [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, "0")).join("");
const cardId = (now: number) => `${Math.floor(now / 1000)}.${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`;
const NOSTORE = { "cache-control": "no-store" };
const ctl = (s: unknown, n: number) => String(s ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim().slice(0, n);

/** 만료: 10분 넘은 pending → expired · payload 지움 · 카드 닫음 */
export async function sweep(db: D1Database, now = Date.now()) {
  await db.batch([
    db.prepare("UPDATE board_card SET state = 'closed', done = '만료' WHERE state = 'open' AND id IN (SELECT card_id FROM connect_request WHERE state = 'pending' AND created_at < ? AND card_id IS NOT NULL)").bind(now - TTL),
    db.prepare("UPDATE connect_request SET state = 'expired', payload = NULL, decided_at = ? WHERE state = 'pending' AND created_at < ?").bind(now, now - TTL),
  ]);
}

/** 요청 몸 → 넣을 spec · key(화면 길 POST /api/connections 의 API 커넥터 검사와 같은 뜻). 오류는 키를 담지 않음 */
function specOf(env: Env, owner: string, b: Record<string, any>): { service: string; label: string; spec: ApiSpec; key: string } | { error: string } {
  const service = store.slug(String(b.service || "")), label = b.label ? store.slug(String(b.label)) : "";
  if (!service || service === "boarder" || service === "bridge") return { error: "서비스 이름" };
  const api = b.api && typeof b.api === "object" ? b.api : {};
  let spec: ApiSpec;
  if (api.preset) {
    const p = API_PRESETS[String(api.preset)]; if (!p) return { error: "모르는 API" };
    if (p.spec.auth.type === "oauth") return { error: `${p.title} 은 로그인(브라우저) 꼴이에요 — boarder connect ${api.preset} --open` };
    if (!apiReady(env as unknown as Record<string, unknown>, String(api.preset), owner).ready) return { error: `${p.title} 은 아직 준비 중이에요` };
    if (service !== api.preset) return { error: "service 는 그 API 이름" };
    spec = p.spec;
  } else {
    const auth = parseAuth(api.auth);
    const base = String(api.base_url || "").trim().replace(/\/+$/, ""); try { safeUrl(base); } catch { return { error: "base_url 은 https 공개 주소" }; }
    if (!auth) return { error: "auth(bearer · header · query · basic)" };
    if (PRESETS[service] || API_PRESETS[service]) return { error: "그 이름은 보더가 아는 서비스예요 — 다른 이름" };
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(api.headers && typeof api.headers === "object" ? api.headers : {})) { if (!/^[A-Za-z0-9-]{1,60}$/.test(k) || typeof v !== "string" || v.length > 1000) return { error: "headers" }; headers[k] = v; }
    spec = { baseUrl: base, auth, ...(Object.keys(headers).length ? { headers } : {}) };
  }
  const k = checkKey(spec.auth, b.key); if ("error" in k) return { error: k.error };
  return { service, label, spec, key: k.key };
}

/** 카드 답 고리(/api/me/cards/:id/answer 뒤) — 허용이면 connection 으로 넣고 읽기 전용을 걸고, 거절이면 버림. payload 는 어느 쪽이든 지움 */
export async function onConnectCardAnswered(env: Env, me: string, cardId: string, now = Date.now()) {
  const r = await env.DB.prepare("SELECT q.id, q.service, q.label, q.read_only, q.payload, q.created_at, c.answer FROM connect_request q JOIN board_card c ON c.id = q.card_id AND c.owner = q.owner WHERE q.card_id = ? AND q.owner = ? AND q.state = 'pending'").bind(cardId, me).first<{ id: string; service: string; label: string; read_only: number; payload: string | null; created_at: number; answer: string | null }>();
  if (!r) return false;
  const close = (done: string) => env.DB.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE id = ? AND owner = ? AND state = 'answered'").bind(done, cardId, me).run();
  // 먼저 이 요청을 잡음(두 답이 겹쳐도 한 번만 넣게)
  const allow = r.answer === ALLOW && now - r.created_at <= TTL && !!r.payload;
  const won = await env.DB.prepare("UPDATE connect_request SET state = ?, payload = NULL, decided_at = ? WHERE id = ? AND state = 'pending'").bind(allow ? "approved" : r.answer === ALLOW ? "expired" : "denied", now, r.id).run();
  if (!won.meta.changes) return true;
  if (!allow) { await close(r.answer === ALLOW ? "만료" : "거절함"); return true; }
  try {
    const p = await openSecret<{ spec: ApiSpec; key: string }>(env, me, ref(r.id), r.payload!);
    const hit = (await store.list(env, me)).find(x => x.service === r.service && x.label === r.label);
    if (hit && (hit.kind !== "api" || hit.url !== p.spec.baseUrl)) throw new Error(`${store.prefixOf(hit)} 은 이미 다른 주소로 연결돼 있어요 — 라벨을 붙여요`);
    const id = await store.upsert(env, me, { service: r.service, label: r.label, kind: "api", url: p.spec.baseUrl, auth: { api: p.spec, key: p.key }, account: p.spec.auth.type === "imap" ? (p.key.split("\n")[1] || "").slice(0, 120) : undefined, read_only: !!r.read_only });
    await env.DB.prepare("UPDATE connect_request SET conn_id = ? WHERE id = ?").bind(id, r.id).run();
    await close("허용함 — 연결했어요");
  } catch (e) {
    const msg = ctl(e instanceof Error ? e.message : e, 200);
    await env.DB.prepare("UPDATE connect_request SET state = 'failed', error = ? WHERE id = ?").bind(msg, r.id).run();
    await close(`허용했지만 넣지 못했어요 — ${msg}`);
  }
  return true;
}
export const isConnectCard = async (env: { DB: D1Database }, me: string, id: string) => !!(await env.DB.prepare("SELECT 1 FROM connect_request WHERE card_id = ? AND owner = ?").bind(id, me).first());

export function mountConnectRequests(host: Hono<any>, h: Hooks) {
  const app = host as unknown as Hono<{ Bindings: Env }>;
  app.post("/api/device/connect", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    if (!c.env.CONNECTOR_KEY) return c.json({ error: "커넥터 준비 안 됨" }, 503);
    const me = d.owner.toLowerCase(), now = Date.now();
    const b = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const s = specOf(c.env, me, b); if ("error" in s) return c.json({ error: s.error }, 400, NOSTORE);
    await sweep(c.env.DB, now);
    const n = await c.env.DB.prepare("SELECT count(*) AS n FROM connect_request WHERE owner = ? AND state = 'pending'").bind(me).first<{ n: number }>();
    if ((n?.n ?? 0) >= MAX_PENDING) return c.json({ error: "기다리는 요청이 너무 많아요" }, 429);
    const id = rid("cr_"), card = cardId(now), readOnly = b.read_only !== false, host = (() => { try { return s.spec.baseUrl.startsWith("imaps:") ? "IMAP" : new URL(s.spec.baseUrl).host; } catch { return ""; } })();
    const name = s.label ? `${s.service}-${s.label}` : s.service;
    let sealed: string;
    try { sealed = await sealSecret(c.env, me, ref(id), { spec: s.spec, key: s.key }); } catch { return c.json({ error: "봉할 키가 없어 받지 않았어요" }, 503); }
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO board_card(id, owner, win, question, choices, recommend, body, at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(card, me, "보더", `기기 「${ctl(d.name, 60)}」 이 「${name}」 연결을 넣으려 해요 — 허용할까요?`, JSON.stringify([ALLOW, DENY]), null,
          `주소: ${host || "-"} · ${readOnly ? "읽기 전용(쓰기 도구는 꺼진 채)" : "읽기 · 쓰기 모두"}. 열쇠는 이 화면 · 대화 · 로그에 보이지 않고 봉한 채 넣어요. 내가 시킨 일이 아니면 「${DENY}」. 10분 안에 답하지 않으면 만료돼요. (요청 ${id})`, now),
      c.env.DB.prepare("INSERT INTO connect_request(id, owner, device_id, service, label, host, read_only, payload, card_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(id, me, d.id, s.service, s.label, host, readOnly ? 1 : 0, sealed, card, now),
    ]);
    h.card?.(c.env, me, { id: card, question: `「${name}」 연결 허용?` });
    return c.json({ id, state: "pending", card_id: card, name }, 200, NOSTORE);
  });
  app.get("/api/device/connect/:id", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    await sweep(c.env.DB);
    const r = await c.env.DB.prepare("SELECT id, service, label, state, conn_id, error, read_only FROM connect_request WHERE id = ? AND owner = ? AND device_id = ?").bind(c.req.param("id"), d.owner.toLowerCase(), d.id).first();
    return r ? c.json(r, 200, NOSTORE) : c.json({ error: "없음" }, 404);
  });
}
