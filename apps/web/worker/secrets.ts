import type { Context, Hono } from "hono";
import { openField, sealFieldNow, VaultError, type VaultEnv } from "./vault/index";

export type SEnv = VaultEnv & { DB: D1Database };
type C = Context<{ Bindings: SEnv }>;
export type Human = { email: string; owner: boolean };
export type Dev = { id: string; key: string; scope: string };   // key = 비밀 줄 owner('' = 주인, 아니면 회원 메일)
export type AgentWho = { owner: string; device_id: string | null; win: string; tok: string };
export type Hooks = {
  human: (c: C) => Promise<Human | null>;            // 로그인 세션(Authorization · x-boarder-device 머리가 있으면 null — 토큰은 사람이 아님)
  sameSite: (c: C) => boolean;                       // 쓰기: 다른 사이트 폼 · 링크 막기(x-hb)
  agent: (c: C) => Promise<AgentWho | null>;
  device: (env: SEnv, tok: string) => Promise<Dev | null>;   // 기기 토큰(bxd_) — 산 기기 · 회원이나 주인만, scope 는 그대로 넘김
  admin: (c: C) => boolean;                          // ADMIN_TOKEN(/api/admin/vault 와 같은 문)
  card?: (env: SEnv, owner: string, card: { id: string; question: string }) => void;   // 회원 웹 푸시
};

export const TTL = 10 * 60_000;
export const ALLOW = "허용", DENY = "거절";
const KINDS = ["card", "phone", "id", "password", "text", "other"];
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const RESERVED = new Set(["requests"]);
const MAX_VALUE = 4096, MAX_PENDING = 5;
const ref = (id: string) => ({ tbl: "secret", pk: id, col: "value" });
const rid = (p: string) => p + [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, "0")).join("");
const NOSTORE = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const ctl = (s: unknown, n: number) => String(s ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim().slice(0, n);

export async function sweep(db: D1Database, now = Date.now()) {
  await db.batch([
    db.prepare("UPDATE board_card SET state = 'closed', done = '만료' WHERE state = 'open' AND id IN (SELECT card_id FROM secret_request WHERE state = 'pending' AND created_at < ? AND card_id IS NOT NULL)").bind(now - TTL),
    db.prepare("UPDATE secret_request SET state = 'expired', decided_at = coalesce(decided_at, ?) WHERE state IN ('pending', 'approved') AND created_at < ?").bind(now, now - TTL),
    db.prepare("UPDATE secret SET value = NULL, deleted_at = ? WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?").bind(now, now),
  ]);
}

export async function decide(db: D1Database, owner: string, id: string, allow: boolean, now = Date.now()) {
  const r = await db.prepare("UPDATE secret_request SET state = ?, decided_at = ? WHERE id = ? AND owner = ? AND state = 'pending' AND created_at >= ?")
    .bind(allow ? "approved" : "denied", now, id, owner, now - TTL).run();
  return !!r.meta.changes;
}

export async function onCardAnswered(env: SEnv, owner: string, cardId: string) {
  const r = await env.DB.prepare("SELECT q.id, c.answer FROM secret_request q JOIN board_card c ON c.id = q.card_id AND c.owner = q.owner WHERE q.card_id = ? AND q.owner = ?").bind(cardId, owner).first<{ id: string; answer: string | null }>();
  if (!r) return false;
  const ok = await decide(env.DB, owner, r.id, r.answer === ALLOW);   // 10분 넘은 답은 반영 안 함 — 카드는 「만료」로 닫음
  await env.DB.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE id = ? AND owner = ? AND state = 'answered'").bind(!ok ? "만료" : r.answer === ALLOW ? "허용함" : "거절함", cardId, owner).run();
  return true;
}

const siteOf = (s: unknown) => {
  try { const u = new URL(String(s)); return u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) ? u.origin : null; } catch { return null; }
};

const bearer = (c: C) => (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "").trim();
const OWNER_REQ = "SELECT q.id, s.name, s.kind, q.site, q.agent, q.state, q.created_at, q.decided_at, q.decided_by, q.sent_at FROM secret_request q JOIN secret s ON s.id = q.secret_id";

export function mountSecrets(app: Hono<{ Bindings: SEnv }>, h: Hooks) {
  // 사람만(회원). 주인은 아직(파일 머리 · 문서)
  const human = async (c: C, write: boolean) => {
    if (c.req.header("authorization") !== undefined || c.req.header("x-boarder-device") !== undefined) return { err: c.json({ error: "로그인" }, 401) };
    if (write && !h.sameSite(c)) return { err: c.json({ error: "no" }, 403) };
    const s = await h.human(c);
    if (!s) return { err: c.json({ error: "로그인" }, 401) };
    return { me: s.owner ? "" : s.email.toLowerCase() };   // 주인 = '' (vault DEK 주인 · agent_token.owner 와 같은 약속)
  };

  app.get("/api/secrets", async c => {
    const a = await human(c, false); if (a.err) return a.err;
    await sweep(c.env.DB);
    const [s, q] = await c.env.DB.batch([
      c.env.DB.prepare("SELECT name, kind, mode, policy, created_at, used_at, expires_at FROM secret WHERE owner = ? AND deleted_at IS NULL ORDER BY name").bind(a.me),
      c.env.DB.prepare("SELECT q.id, s.name, q.site, q.state, q.agent, q.created_at, q.decided_at, q.sent_at FROM secret_request q JOIN secret s ON s.id = q.secret_id WHERE q.owner = ? ORDER BY q.created_at DESC LIMIT 50").bind(a.me),
    ]);
    return c.json({ secrets: s.results, requests: q.results }, 200, NOSTORE);
  });

  app.post("/api/secrets", async c => {
    const a = await human(c, true); if (a.err) return a.err;
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const name = String(b.name || ""), kind = String(b.kind || "other"), mode = String(b.mode || "saved"), policy = String(b.policy || "ask"), value = typeof b.value === "string" ? b.value : "";
    if (!NAME.test(name) || RESERVED.has(name)) return c.json({ error: "이름은 영문 소문자 · 숫자 · _ · - 40자까지" }, 400);
    if (!KINDS.includes(kind) || !["once", "saved"].includes(mode) || !["ask", "auto"].includes(policy)) return c.json({ error: "kind · mode · policy" }, 400);
    if (!value || value.length > MAX_VALUE) return c.json({ error: "값" }, 400);
    await sweep(c.env.DB);
    if (await c.env.DB.prepare("SELECT 1 FROM secret WHERE owner = ? AND name = ? AND deleted_at IS NULL").bind(a.me, name).first()) return c.json({ error: "같은 이름이 있어요" }, 409);
    const id = rid("s_"), now = Date.now();
    let sealed: string;
    try { sealed = await sealFieldNow(c.env, a.me, ref(id), value); }
    catch (e) { return c.json({ error: e instanceof VaultError ? "봉할 키가 없어 저장하지 않았어요" : "저장 못 함" }, 503); }   // 평문으로는 절대 안 둠
    await c.env.DB.prepare("INSERT INTO secret(id, owner, name, kind, mode, policy, value, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, a.me, name, kind, mode, policy, sealed, now, mode === "once" ? now + TTL : null).run();
    return c.json({ ok: true, name }, 200, NOSTORE);
  });

  app.patch("/api/secrets/:name", async c => {
    const a = await human(c, true); if (a.err) return a.err;
    await sweep(c.env.DB);
    const s = await c.env.DB.prepare("SELECT id, mode, created_at FROM secret WHERE owner = ? AND name = ? AND deleted_at IS NULL").bind(a.me, c.req.param("name")).first<{ id: string; mode: string; created_at: number }>();
    if (!s) return c.json({ error: "없음" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const sets: string[] = [], args: unknown[] = [];
    if (b.kind !== undefined) { if (!KINDS.includes(String(b.kind))) return c.json({ error: "kind" }, 400); sets.push("kind = ?"); args.push(String(b.kind)); }
    if (b.policy !== undefined) { if (!["ask", "auto"].includes(String(b.policy))) return c.json({ error: "policy" }, 400); sets.push("policy = ?"); args.push(String(b.policy)); }
    if (b.mode !== undefined) {
      if (!["once", "saved"].includes(String(b.mode))) return c.json({ error: "mode" }, 400);
      sets.push("mode = ?", "expires_at = ?"); args.push(String(b.mode), b.mode === "once" ? Date.now() + TTL : null);
    }
    if (b.value !== undefined) {
      if (typeof b.value !== "string" || !b.value || b.value.length > MAX_VALUE) return c.json({ error: "값" }, 400);
      try { sets.push("value = ?"); args.push(await sealFieldNow(c.env, a.me, ref(s.id), b.value)); }
      catch (e) { return c.json({ error: e instanceof VaultError ? "봉할 키가 없어 저장하지 않았어요" : "저장 못 함" }, 503); }
    }
    if (!sets.length) return c.json({ error: "바꿀 것" }, 400);
    await c.env.DB.prepare(`UPDATE secret SET ${sets.join(", ")} WHERE id = ? AND owner = ? AND deleted_at IS NULL`).bind(...args, s.id, a.me).run();
    return c.json({ ok: true }, 200, NOSTORE);
  });

  app.delete("/api/secrets/:name", async c => {
    const a = await human(c, true); if (a.err) return a.err;
    const s = await c.env.DB.prepare("SELECT id FROM secret WHERE owner = ? AND name = ? AND deleted_at IS NULL").bind(a.me, c.req.param("name")).first<{ id: string }>();
    if (!s) return c.json({ error: "없음" }, 404);
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE secret SET value = NULL, deleted_at = ? WHERE id = ?").bind(now, s.id),
      c.env.DB.prepare("UPDATE secret_request SET state = 'expired', decided_at = coalesce(decided_at, ?) WHERE secret_id = ? AND state IN ('pending', 'approved')").bind(now, s.id),
    ]);
    return c.json({ ok: true }, 200, NOSTORE);
  });

  // ── 요청(이 셋은 :name/fill 보다 먼저 — "requests" 는 비밀 이름으로 못 씀) ──
  app.get("/api/secrets/requests/:id/value", async c => {
    const d = await h.device(c.env, bearer(c));
    // 회원 기기는 scope full 만, 주인 기기는 scope 와 상관없이(주인 요청은 만들 때 그 기기 토큰으로 묶음 — fill 참고)
    if (!d || (d.scope !== "full" && d.key !== "")) return c.json({ error: "기기 토큰" }, 401);
    const now = Date.now(), id = c.req.param("id"), owner = d.key;
    await sweep(c.env.DB, now);
    // 한 번만: approved → sent 를 먼저 쓰고(이긴 쪽만) 값을 읽음 — 열다 실패하면 값은 안 나감(다시 요청)
    const won = await c.env.DB.prepare("UPDATE secret_request SET state = 'sent', sent_at = ? WHERE id = ? AND owner = ? AND device_id = ? AND state = 'approved' AND created_at >= ?").bind(now, id, owner, d.id, now - TTL).run();
    if (!won.meta.changes) return c.json({ error: "넘길 요청이 없어요(허용 전 · 거절 · 만료 · 이미 넘김 · 다른 기기)" }, 404);
    const q = await c.env.DB.prepare("SELECT q.secret_id, q.site, q.target, s.mode FROM secret_request q JOIN secret s ON s.id = q.secret_id WHERE q.id = ?").bind(id).first<{ secret_id: string; site: string; target: string; mode: string }>();
    if (!q) return c.json({ error: "없음" }, 404);
    const row = await c.env.DB.prepare("SELECT value FROM secret WHERE id = ? AND owner = ? AND deleted_at IS NULL").bind(q.secret_id, owner).first<{ value: string | null }>();
    if (!row?.value || !row.value.startsWith("v2.")) return c.json({ error: "비밀이 지워졌어요" }, 410);
    // once = 읽은 그 값일 때만 지움(CAS — 그새 바뀌었으면 안 넘김), saved = 쓴 때만 남김
    const used = await c.env.DB.prepare(q.mode === "once"
      ? "UPDATE secret SET value = NULL, used_at = ?, deleted_at = ? WHERE id = ? AND owner = ? AND deleted_at IS NULL AND value = ?"
      : "UPDATE secret SET used_at = ? WHERE id = ? AND owner = ? AND deleted_at IS NULL AND value = ?")
      .bind(...(q.mode === "once" ? [now, now] : [now]), q.secret_id, owner, row.value).run();
    if (!used.meta.changes) return c.json({ error: "비밀이 그새 바뀌었어요 — 다시 요청해요" }, 409);
    let value: string;
    try { value = await openField(c.env, owner, ref(q.secret_id), row.value) as string; }
    catch { return c.json({ error: "열 수 없음" }, 500); }
    const t = JSON.parse(q.target) as { selector: string; tab?: string };
    return c.json({ value, site: q.site, selector: t.selector, tab: t.tab ?? null }, 200, NOSTORE);
  });

  app.get("/api/secrets/requests/:id", async c => {
    const id = c.req.param("id"), ag = c.req.header("authorization") ? await h.agent(c) : null;
    await sweep(c.env.DB);
    if (ag) {   // 그 창이 만든 요청만, 상태만
      const r = await c.env.DB.prepare("SELECT id, state, site, created_at, decided_at, sent_at FROM secret_request WHERE id = ? AND tok = ?").bind(id, ag.tok).first();
      return r ? c.json(r, 200, NOSTORE) : c.json({ error: "없음" }, 404);
    }
    if (c.req.header("authorization")) return c.json({ error: "토큰" }, 401);
    const a = await human(c, false); if (a.err) return a.err;
    const r = await c.env.DB.prepare("SELECT q.id, s.name, q.site, q.state, q.agent, q.created_at, q.decided_at, q.sent_at FROM secret_request q JOIN secret s ON s.id = q.secret_id WHERE q.id = ? AND q.owner = ?").bind(id, a.me).first();
    return r ? c.json(r, 200, NOSTORE) : c.json({ error: "없음" }, 404);
  });

  app.post("/api/secrets/requests/:id", async c => {
    const a = await human(c, true); if (a.err) return a.err;
    const b = await c.req.json<{ action?: string }>().catch(() => ({} as { action?: string }));
    if (b.action !== "allow" && b.action !== "deny") return c.json({ error: "action = allow · deny" }, 400);
    await sweep(c.env.DB);
    const id = c.req.param("id");
    if (!(await decide(c.env.DB, a.me, id, b.action === "allow"))) return c.json({ error: "결정할 요청이 없어요(이미 결정 · 만료)" }, 409);
    await c.env.DB.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE id = (SELECT card_id FROM secret_request WHERE id = ?) AND owner = ? AND state = 'open'").bind(b.action === "allow" ? "허용함" : "거절함", id, a.me).run();
    return c.json({ ok: true, state: b.action === "allow" ? "approved" : "denied" }, 200, NOSTORE);
  });

  app.post("/api/secrets/:name/fill", async c => {
    const ag = await h.agent(c); if (!ag) return c.json({ error: "창 토큰" }, 401);
    let device = ag.device_id;
    if (!ag.owner) {
      const d = await h.device(c.env, (c.req.header("x-boarder-device") || "").trim());
      if (!d || d.key !== "") return c.json({ error: "주인 판은 이 기기의 기기 토큰(x-boarder-device)을 같이 보내요 — boarder secret fill 이 넣어 줌" }, 403);
      device = d.id;
    }
    if (!device) return c.json({ error: "기기 창 토큰만(boarder setup 한 기기)" }, 403);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const site = siteOf(b.site), selector = ctl(b.selector, 300), tab = b.tab === undefined || b.tab === null ? undefined : ctl(b.tab, 100);
    if (!site) return c.json({ error: "site = https:// 주소" }, 400);
    if (!selector) return c.json({ error: "selector" }, 400);
    const now = Date.now(), owner = ag.owner.toLowerCase(), isOwner = owner === "";
    await sweep(c.env.DB, now);
    const s = await c.env.DB.prepare("SELECT id, name, policy FROM secret WHERE owner = ? AND name = ? AND deleted_at IS NULL AND value IS NOT NULL").bind(owner, c.req.param("name")).first<{ id: string; name: string; policy: string }>();
    if (!s) return c.json({ error: "없는 비밀" }, 404);
    const n = await c.env.DB.prepare("SELECT count(*) AS n FROM secret_request WHERE secret_id = ? AND state IN ('pending', 'approved')").bind(s.id).first<{ n: number }>();
    if ((n?.n ?? 0) >= MAX_PENDING) return c.json({ error: "기다리는 요청이 너무 많아요" }, 429);
    const id = rid("sr_"), auto = s.policy === "auto";
    let card: string | null = null;
    const stmts = [];
    if (!auto && !isOwner) {
      card = `${Math.floor(now / 1000)}.${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`;
      const q = `「${s.name}」 비밀을 ${site} 에 넣을까요? — ${ag.win}`;
      stmts.push(c.env.DB.prepare("INSERT INTO board_card(id, owner, win, question, choices, recommend, body, at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(card, owner, ag.win, q, JSON.stringify([ALLOW, DENY]), null, `값은 에이전트에게 안 보이고 이 기기의 브라우저 칸(${selector})에만 들어가요. 10분 안에 답하지 않으면 만료돼요. (요청 ${id})`, now));
    }
    stmts.push(c.env.DB.prepare("INSERT INTO secret_request(id, secret_id, owner, site, target, state, device_id, agent, tok, card_id, created_at, decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, s.id, owner, site, JSON.stringify(tab === undefined ? { selector } : { selector, tab }), auto ? "approved" : "pending", device, ag.win, ag.tok, card, now, auto ? now : null));
    await c.env.DB.batch(stmts);
    if (card) h.card?.(c.env, owner, { id: card, question: `「${s.name}」 비밀 넣기 허용?` });
    return c.json({ id, state: auto ? "approved" : "pending", ...(card ? { card_id: card } : {}) }, 200, NOSTORE);
  });

  app.get("/api/admin/secrets/requests", async c => {
    if (!h.admin(c)) return c.json({ error: "no" }, 403);
    await sweep(c.env.DB);
    const st = c.req.query("state") || "pending", who = c.req.query("owner");
    if (!["pending", "approved", "denied", "sent", "expired"].includes(st)) return c.json({ error: "state" }, 400);
    const rs = (await c.env.DB.prepare(`${OWNER_REQ} WHERE q.state = ?${who === undefined ? "" : " AND q.owner = ?"} ORDER BY q.created_at LIMIT 100`).bind(...(who === undefined ? [st] : [st, who.trim().toLowerCase()])).all()).results;
    return c.json({ requests: rs }, 200, NOSTORE);
  });
  app.post("/api/admin/secrets/requests/:id", async c => {
    if (!h.admin(c)) return c.json({ error: "no" }, 403);
    const b = await c.req.json<{ action?: string; by?: string }>().catch(() => ({} as { action?: string; by?: string }));
    if (b.action !== "allow" && b.action !== "deny") return c.json({ error: "action = allow · deny" }, 400);
    const by = ctl(b.by, 80); if (!by) return c.json({ error: "by" }, 400);
    await sweep(c.env.DB);
    const now = Date.now(), id = c.req.param("id");
    const r = await c.env.DB.prepare("UPDATE secret_request SET state = ?, decided_at = ?, decided_by = ? WHERE id = ? AND owner = '' AND state = 'pending' AND created_at >= ?")
      .bind(b.action === "allow" ? "approved" : "denied", now, by, id, now - TTL).run();
    if (!r.meta.changes) return c.json({ error: "결정할 주인 요청이 없어요(회원 요청 · 이미 결정 · 만료)" }, 409);
    return c.json({ ok: true, state: b.action === "allow" ? "approved" : "denied" }, 200, NOSTORE);
  });
}
