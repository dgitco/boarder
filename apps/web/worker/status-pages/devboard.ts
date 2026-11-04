import type { Hono } from "hono";
import { featOn } from "./feature";
import { jsonCapped, sameSite, SMALL_BODY, type SC, type Who } from "./routes";

const J = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) as T : d; } catch { return d; } };
export function acctOf(h: { config_dir?: unknown; tool?: unknown } | null): string {
  const d = typeof h?.config_dir === "string" ? h.config_dir.replace(/\/+$/, "") : "";
  if (!d) return "";
  const m = /\/\.claude-accounts\/([\w.-]{1,30})$/.exec(d) || /\/\.claude-([\w.-]{1,30})$/.exec(d) || /\/([\w.-]{1,30})$/.exec(d);
  return m ? m[1] : "";
}
const W_STATES = ["working", "question", "idle", "parked", "done", "open"];
const H_STATE: Record<string, string> = { busy: "working", background: "working", starting: "working", waiting: "question", idle: "idle", parked: "parked" };
type Dv = { id: string; name: string; scope: string; created_at: number; last_at: number | null; engine_at: number | null; engine: string | null };

export async function devBoard(db: D1Database, mails: string[], hidden: string[], now = Date.now()) {
  const ms = mails.slice(0, 8), q = ms.map(() => "?").join(",");
  const [dv, mt, iw, hw] = await db.batch([
    db.prepare(`SELECT id, name, scope, created_at, last_at, engine_at, engine FROM device WHERE owner IN (${q}) AND revoked_at IS NULL ORDER BY created_at LIMIT 50`).bind(...ms),
    db.prepare(`SELECT m.device_id, m.at, m.data FROM device_metric m JOIN device d ON d.id = m.device_id WHERE d.owner IN (${q}) AND d.revoked_at IS NULL`).bind(...ms),
    db.prepare(`SELECT key, device_id, engine, title, repo, branch, state, state_at, handle, seen_at FROM imp_item WHERE owner IN (${q}) AND kind = 'window' AND gone_at IS NULL AND state != 'gone' ORDER BY state_at DESC LIMIT 400`).bind(...ms),
    db.prepare(`SELECT w.id, w.device_id, w.name, w.state, w.state_at, w.handle, w.note FROM engine_window w JOIN device d ON d.id = w.device_id WHERE d.owner IN (${q}) AND d.revoked_at IS NULL AND d.scope = 'harness' AND w.kind = 'harness' AND w.state NOT IN ('closed','gone','failed') ORDER BY w.state_at DESC LIMIT 400`).bind(...ms),
  ]);
  const met = new Map((mt.results as { device_id: string; at: number; data: string }[]).map(r => [r.device_id, r]));
  const wins = new Map<string, unknown[]>();
  const add = (dev: string, w: unknown) => (wins.get(dev) || wins.set(dev, []).get(dev)!).push(w);
  for (const r of iw.results as { key: string; device_id: string; engine: string; title: string; repo: string; branch: string; state: string; state_at: number | null; handle: string | null; seen_at: number }[]) {
    const h = J<{ tool?: string; config_dir?: string } | null>(r.handle, null);
    add(r.device_id, { key: r.key.slice(0, 160), title: r.title, tool: typeof h?.tool === "string" ? h.tool.slice(0, 20) : "", acct: acctOf(h), state: W_STATES.includes(r.state) ? r.state : "idle", state_at: r.state_at || r.seen_at, engine: r.engine.slice(0, 20), repo: r.repo.slice(0, 80), branch: r.branch.slice(0, 80) });
  }
  for (const r of hw.results as { id: string; device_id: string; name: string; state: string; state_at: number | null; handle: string | null; note: string | null }[]) {
    const h = J<{ role?: string; config_dir?: string; tool?: string; acct?: string } | null>(r.handle, null);
    add(r.device_id, { key: r.id, title: r.name, tool: typeof h?.tool === "string" ? h.tool.slice(0, 20) : "", acct: typeof h?.acct === "string" && /^[\w.-]{1,30}$/.test(h.acct) ? h.acct : acctOf(h), state: H_STATE[r.state] || "idle", state_at: r.state_at, engine: "harness", repo: "", branch: "", note: (r.note || "").slice(0, 120) });
  }
  const hid = new Set(hidden);
  return (dv.results as Dv[]).map(d => {
    const m = met.get(d.id), x = J<Record<string, any> | null>(m?.data, null), eng = J<{ cli?: string; os?: string; host?: string } | null>(d.engine, null);
    const seen = Math.max(d.last_at || 0, d.engine_at || 0, m?.at || 0);
    return {
      id: d.id, name: d.name || eng?.host || "이름 없는 기기", scope: d.scope, hidden: hid.has(d.id), seen_at: seen || null, online: !!seen && now - seen < 10 * 60_000,
      os: x?.host?.os || eng?.os || "", cli: x?.host?.cli || eng?.cli || "", metrics_at: m?.at ?? null,
      load: x ? { cpu: x.cpu?.pct ?? null, load1: x.cpu?.load1 ?? null, cores: x.cpu?.cores ?? null, mem_total_mb: x.mem?.total_mb ?? null, mem_avail_mb: x.mem?.avail_mb ?? null, disk_pct: x.disk?.pct ?? null, agents: x.agents || {} } : null,
      accounts: Array.isArray(x?.accounts) ? x!.accounts.slice(0, 8) : [], codex: x?.codex || null,
      windows: (wins.get(d.id) || []).slice(0, 120),
    };
  });
}

export function mountDevBoard(host: Hono<any>, o: { who: Who; mails: (c: SC, email: string) => string[] }) {
  const app = host as unknown as Hono<{ Bindings: { DB: D1Database; FLAGS_OFF?: string } }>;
  const gate = async (c: SC) => {
    const me = await o.who(c); if (!me) return { err: c.json({ ok: false, error: "로그인" }, 401) };
    if (!(await featOn(c.env.DB, me, "devboard", c.env.FLAGS_OFF))) return { err: c.json({ ok: false, error: "설정 › 기능에서 켜야 해요" }, 403) };
    return { me };
  };
  const hiddenOf = async (db: D1Database, me: string) => J<string[]>((await db.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = 'devboard:hide'").bind(me).first<{ v: string }>())?.v, []).filter(x => typeof x === "string");
  app.get("/api/me/devboard", async c => {
    const g = await gate(c); if ("err" in g) return g.err;
    const devices = await devBoard(c.env.DB, o.mails(c, g.me), await hiddenOf(c.env.DB, g.me));
    return c.json({ ok: true, at: Date.now(), devices }, 200, { "cache-control": "no-store" });
  });
  // 「이 기기 보이기」: { device, hide } — 내 기기만(남의 id 는 404)
  app.post("/api/me/devboard/hide", async c => {
    if (!sameSite(c)) return c.json({ ok: false, error: "forbidden" }, 403);
    const g = await gate(c); if ("err" in g) return g.err;
    const raw = await jsonCapped(c, SMALL_BODY); if (raw === undefined) return c.json({ ok: false, error: "너무 커요" }, 413);
    const b = raw as { device?: unknown; hide?: unknown } | null;
    if (!b || typeof b.device !== "string" || typeof b.hide !== "boolean") return c.json({ ok: false, error: "모르는 값" }, 400);
    const ms = o.mails(c, g.me).slice(0, 8);
    const mine = await c.env.DB.prepare(`SELECT 1 FROM device WHERE id = ? AND owner IN (${ms.map(() => "?").join(",")}) AND revoked_at IS NULL`).bind(b.device, ...ms).first();
    if (!mine) return c.json({ ok: false, error: "내 기기가 아니에요" }, 404);
    const cur = await hiddenOf(c.env.DB, g.me), next = b.hide ? [...new Set([...cur, b.device])].slice(-50) : cur.filter(x => x !== b.device);
    await c.env.DB.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(g.me, "devboard:hide", JSON.stringify(next), Date.now()).run();
    return c.json({ ok: true, hidden: next });
  });
}
