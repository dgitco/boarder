import type { Context, Hono } from "hono";
import * as store from "./connectors/store";
import { importBatch } from "./slack-import";

type Env = store.Env & { [k: string]: unknown };
type C = Context<{ Bindings: Env }>;
type R = Record<string, any>;
export type Hooks = { device: (c: C) => Promise<{ id: string; owner: string } | null> };

const SLACK = "https://slack.com/api";
const PAGE = 100, MAX_THREADS = 30, MAX_USERS = 30;
const CHAN = /^[CG][A-Z0-9]{5,20}$/, TS = /^\d{10}\.\d{6}$/;

// ── 가리기(내보낼 때 손으로 하던 것) ──
const SECRET = /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|xox[abeprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|bx[adsw]_[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g;
const RRN = /(?<!\d)\d{6}\s?-\s?[1-8]\d{6}(?!\d)/g;
const CARD = /(?<!\d)(?:\d{4}[- ]){3}\d{4}(?!\d)|(?<!\d)\d{16}(?!\d)/g;
const ACCT = /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,4})?(?![\d-])/g;
const PAYWORD = /급여|월급|연봉|상여|성과급|임금|보수|인건비|퇴직금/;
const MONEY = /(?:₩\s?)?\d[\d,]*(?:\.\d+)?\s*(?:만\s*|천\s*|억\s*)?원|(?<![\d.])\d{1,3}(?:,\d{3})+(?![\d,])/g;
export function mask(text: string, o: { ids?: boolean; pay?: boolean; payThread?: boolean } = {}) {
  let t = text.replace(SECRET, "[가림]");
  if (o.ids !== false) {
    t = t.replace(RRN, "[주민번호]").replace(CARD, "[카드]");
    t = t.replace(ACCT, m => /^01[016789]-\d{3,4}-\d{4}$/.test(m) || m.replace(/\D/g, "").length < 10 ? m : "[계좌]");   // 전화 · 날짜는 그대로
  }
  if (o.pay !== false && (o.payThread || PAYWORD.test(t))) t = t.replace(MONEY, "[금액]");
  return t;
}

async function slack(key: string, method: string, q: Record<string, string>) {
  const r = await fetch(`${SLACK}/${method}?${new URLSearchParams(q)}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({})) as R;
  if (!j.ok) throw Object.assign(new Error(`Slack ${method}: ${String(j.error || r.status).slice(0, 60)}`), { slack: String(j.error || "") });
  return j;
}

/** 그 회원의 Slack 봇 열쇠 연결 — 이름(prefix)으로, slack.com · bearer 만 */
async function botKey(env: Env, owner: string, name: string) {
  const row = (await store.list(env, owner)).find(r => store.prefixOf(r) === name);
  if (!row) return { error: "없는 연결이에요 — boarder connect 로 먼저 넣어요" };
  let origin = ""; try { origin = new URL(row.url).origin; } catch {}
  if (row.kind !== "api" || origin !== "https://slack.com") return { error: "Slack 주소(https://slack.com/api)로 넣은 연결만 돼요" };
  const { spec, key } = await store.apiAuth(env, row);
  if (!key || spec?.auth.type !== "bearer") return { error: "봇 열쇠(bearer)로 넣은 Slack 연결만 돼요" };
  return { key };
}

export function mountSlackConnector(host: Hono<any>, h: Hooks) {
  const app = host as unknown as Hono<{ Bindings: Env }>;
  app.post("/api/me/import/slack/connector", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const b = await c.req.json<R>().catch(() => ({} as R));
    const owner = d.owner.toLowerCase(), name = store.slug(String(b.connector || "")).slice(0, 49);
    if (!name) return c.json({ error: "connector(연결 이름)" }, 400);
    const k = await botKey(c.env, owner, name); if ("error" in k) return c.json({ error: k.error }, 400);
    const m = { ids: b.mask?.ids !== false, pay: b.mask?.pay !== false };
    try {
      if (!b.channel) {
        const out: R[] = []; let cursor = "";
        for (let i = 0; i < 5; i++) {
          const j = await slack(k.key, "users.conversations", { types: "public_channel,private_channel", exclude_archived: "true", limit: "200", ...(cursor ? { cursor } : {}) });
          for (const x of j.channels || []) if (CHAN.test(String(x.id))) out.push({ id: x.id, name: String(x.name || x.id), is_private: !!x.is_private, topic: String(x.topic?.value || "").slice(0, 200) });
          cursor = j.response_metadata?.next_cursor || ""; if (!cursor) break;
        }
        return c.json({ channels: out });
      }
      const chan = String(b.channel);
      if (!CHAN.test(chan)) return c.json({ error: "channel" }, 400);
      const info = (await slack(k.key, "conversations.info", { channel: chan })).channel || {};
      if (!info.is_member) return c.json({ error: "봇이 든 채널만 들여와요 — 그 채널에 봇을 초대해요" }, 403);
      let ws = ""; try { ws = String((await slack(k.key, "auth.test", {})).team || ""); } catch {}
      const hist = await slack(k.key, "conversations.history", { channel: chan, limit: String(PAGE), ...(typeof b.cursor === "string" && b.cursor ? { cursor: b.cursor.slice(0, 200) } : {}) });
      const roots: R[] = (hist.messages || []).filter((x: R) => TS.test(String(x.ts)));
      const all: R[] = [...roots];
      let skippedThreads = 0;
      for (const [i, r] of roots.filter(x => Number(x.reply_count) > 0).entries()) {
        if (i >= MAX_THREADS) { skippedThreads++; continue; }   // 한 쪽에 스레드 30개까지(요청 수 한도) — 넘친 스레드는 답글 없이 뿌리만
        try { const rep = await slack(k.key, "conversations.replies", { channel: chan, ts: r.ts, limit: "200" }); for (const x of rep.messages || []) if (x.ts !== r.ts && TS.test(String(x.ts))) all.push({ ...x, thread_ts: r.ts }); } catch {}
      }
      // 보낸 사람 이름(users.info, 한 번에 30명까지 — 모르면 id)
      const names = new Map<string, string>();
      for (const u of [...new Set(all.map(x => String(x.user || "")).filter(Boolean))].slice(0, MAX_USERS)) {
        try { const j = await slack(k.key, "users.info", { user: u }); names.set(u, String(j.user?.profile?.display_name || j.user?.real_name || j.user?.name || u)); } catch {}
      }
      const payRoot = new Set(roots.filter(r => PAYWORD.test(String(r.text || ""))).map(r => String(r.ts)));
      const msgs = all.map(x => ({
        ts: String(x.ts), thread_ts: x.thread_ts && x.thread_ts !== x.ts ? String(x.thread_ts) : null,
        user: String(x.user || x.bot_id || "").slice(0, 40), user_name: (names.get(String(x.user)) || x.username || x.user || "").toString().slice(0, 200),
        text: mask(String(x.text || "").replace(/<@([A-Z0-9]{6,20})(?:\|[^>]*)?>/g, (_, id) => "@" + (names.get(id) || id)), { ...m, payThread: payRoot.has(String(x.thread_ts || "")) }),
        files: Array.isArray(x.files) ? x.files.slice(0, 20).map((f: R) => ({ name: mask(String(f.name || "파일"), m), permalink: typeof f.permalink === "string" ? f.permalink : null })) : null,
        reactions: Array.isArray(x.reactions) ? x.reactions.slice(0, 50).map((r: R) => ({ name: String(r.name).slice(0, 100), count: Number(r.count) || 0 })) : null,
        subtype: x.subtype ? String(x.subtype).slice(0, 60) : null,
      })).filter(x => !["channel_join", "channel_leave", "group_join", "group_leave"].includes(x.subtype || ""));
      const r = await importBatch(c.env as never, owner, { id: chan, name: String(info.name || chan).slice(0, 200), workspace: ws.slice(0, 200), is_private: !!info.is_private, topic: String(info.topic?.value || "").slice(0, 2000) }, msgs);
      if ("error" in r) return c.json(r.error, r.status);
      return c.json({ ...r, read: msgs.length, next_cursor: hist.response_metadata?.next_cursor || null, threads_skipped: skippedThreads });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg.replace(SECRET, "[가림]").slice(0, 200) }, (e as R)?.slack === "not_in_channel" ? 403 : 502);
    }
  });
}
