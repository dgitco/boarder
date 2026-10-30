import { DurableObject } from "cloudflare:workers";
import * as P from "./push";
import { f7On } from "./ledger";

type Env = { DB: D1Database; VAPID_PRIVATE?: string };
const EVERY = 10_000, LOG_MAX = 3000;
const te = new TextEncoder();
type Res = [number, Record<string, unknown>];
// Worker 가 부르는 길(RPC 꼴 추론이 unknown 값을 never 로 만들어서 손으로 적음)
export type PushApi = {
  key(): Promise<string>; subscribe(b: unknown): Promise<Res>; unsubscribe(b: unknown): Promise<Res>; trial(b: unknown, welcome?: boolean): Promise<Res>; ack(b: unknown): Promise<Res>;
  tickNow(): Promise<[string, P.Msg][]>; ensure(): Promise<boolean>; importData(b: unknown): Promise<{ ok: boolean; error?: string }>; stat(): Promise<unknown>;
};

async function rows(db: D1Database) {
  const [c, u] = await db.batch([
    db.prepare("SELECT ts, area, kind, title, label, shape, state, replaced_by, dup_of, ref, posted_at FROM wl_cards"),
    db.prepare("SELECT id, chan, thread, text, at FROM wl_talk_msg WHERE who = 'agent' AND deleted_at IS NULL AND text LIKE ?").bind(P.URGENT + "%"),
  ]);
  return [new Map((c.results as P.Card[]).map(r => [r.ts, r])), new Map((u.results as P.Urg[]).map(r => [P.urgKey(r), r]))] as const;
}

export async function resolve(db: D1Database, ts: string) {
  for (let i = 0; i < 8; i++) {
    const r = await db.prepare("SELECT replaced_by FROM wl_cards WHERE ts = ?").bind(ts).first<{ replaced_by: string | null }>();
    if (!r || !r.replaced_by) break;
    ts = r.replaced_by;
  }
  return ts;
}

const CHANS = new Set(["primary", "company", "shop", "personal", "dgit"]);
export async function cardLoc(db: D1Database, ts: string) {
  if (!/^\d{10}\.\d{6}$/.test(ts)) return null;
  const [m, c] = await db.batch<{ chan?: string; thread?: string | null; state?: string }>([
    db.prepare("SELECT chan, thread FROM wl_talk_msg WHERE id = ? OR slack_ts = ? LIMIT 1").bind(ts, ts),
    db.prepare("SELECT state FROM wl_cards WHERE ts = ?").bind(ts),
  ]);
  const r = m.results[0];
  return r && r.chan && CHANS.has(r.chan) ? { c: r.chan, t: r.thread || ts, m: ts, state: c.results[0]?.state || "open" } : null;
}

export class Pusher extends DurableObject<Env> {
  private q: Promise<unknown> = Promise.resolve();
  private v?: Promise<P.Vapid | null>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const s = ctx.storage.sql;
    s.exec("CREATE TABLE IF NOT EXISTS sub(endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT NOT NULL DEFAULT '', at REAL NOT NULL)");
    s.exec("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    s.exec("CREATE TABLE IF NOT EXISTS log(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, ev TEXT NOT NULL)");
  }
  private lock<T>(f: () => Promise<T>): Promise<T> { const r = this.q.then(f, f); this.q = r.catch(() => {}); return r; }
  private vapid() { return this.v ??= P.vapidKey(this.env.VAPID_PRIVATE); }   // 키가 틀리면 null — 푸시만 꺼짐
  log(ev: Record<string, unknown>) {
    const s = this.ctx.storage.sql;
    s.exec("INSERT INTO log(at, ev) VALUES (?, ?)", new Date().toISOString().slice(0, 19).replace("T", " "), JSON.stringify(ev));
    s.exec("DELETE FROM log WHERE id <= (SELECT max(id) FROM log) - ?", LOG_MAX);
  }
  private st(): P.State { const r = this.ctx.storage.sql.exec<{ v: string }>("SELECT v FROM kv WHERE k = 'state'").toArray()[0]; return r ? JSON.parse(r.v) : { notified: [], fps: [], tries: {} }; }
  private save(st: P.State) { this.ctx.storage.sql.exec("INSERT INTO kv(k, v) VALUES ('state', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(st)); }
  private subs() { return this.ctx.storage.sql.exec<P.Sub & { ua: string; at: number }>("SELECT endpoint, p256dh, auth, ua, at FROM sub ORDER BY rowid").toArray(); }
  private has(ep: string) { return this.ctx.storage.sql.exec("SELECT 1 FROM sub WHERE endpoint = ?", ep).toArray().length > 0; }

  async key() { return (await this.vapid())?.pub || ""; }

  // ---------- 화면 길(server.py push_subscribe · unsubscribe · push_test · push_ack 그대로) ----------
  subscribe(body: Parameters<typeof P.subOf>[0]): Promise<Res> {
    return this.lock(async () => {
      const s = P.subOf(body || {}); if (!s) return [400, { ok: false, error: "구독 꼴이 아님" }] as Res;
      const isNew = !this.has(s.endpoint), sql = this.ctx.storage.sql;
      sql.exec("INSERT INTO sub(endpoint, p256dh, auth, ua, at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, at = excluded.at",
        s.endpoint, s.p256dh, s.auth, s.ua, Date.now() / 1000);
      this.log({ ev: "subscribe", host: P.hostOf(s.endpoint), ua: s.ua.slice(0, 80), new: isNew });
      return [200, { ok: true, n: sql.exec<{ n: number }>("SELECT count(*) n FROM sub").one().n, new: isNew }] as Res;
    });
  }
  unsubscribe(body: { endpoint?: unknown }): Promise<Res> {
    return this.lock(async () => {
      const r = this.ctx.storage.sql.exec("DELETE FROM sub WHERE endpoint = ?", String(body?.endpoint ?? ""));
      this.log({ ev: "unsubscribe", found: r.rowsWritten > 0 });
      return [200, { ok: true }] as Res;
    });
  }
  trial(body: { endpoint?: unknown }, welcome = false): Promise<Res> {   // 이름이 test 면 DO RPC 가 못 부름(workerd)
    return this.lock(async () => {
      if (!(await this.vapid())) return [503, { ok: false, error: "푸시 키 없음" }] as Res;
      const ep = String(body?.endpoint ?? "");
      if (!this.has(ep)) return [404, { ok: false, error: "이 기기 구독이 없어요 · 알림 켜기부터" }] as Res;
      const r = await this.env.DB.prepare("SELECT ts, area, kind, title, label, shape FROM wl_cards WHERE state = 'open' AND kind IN ('choice','question','decision','todo') ORDER BY posted_at DESC LIMIT 1").first<P.Card>();
      if (!r) return [404, { ok: false, error: "열린 카드가 없어요" }] as Res;
      const m = P.cardMsg(r);
      Object.assign(m, { title: welcome ? "[시험] 알림이 켜졌어요" : "[시험] " + m.title, body: welcome ? m.title + " — " + m.body : m.body, tag: "test:" + r.ts });
      const res = await this.send(m, ep);
      return [200, { ok: res.length > 0 && res.every(([, c]) => c === 200 || c === 201), res, card: r.ts }] as Res;
    });
  }
  async ack(body: Record<string, unknown>): Promise<Res> {
    const s = (k: string, n: number) => String(body?.[k] ?? "").slice(0, n);
    if (body?.tag === "fail") this.log({ ev: "client-fail", step: s("step", 40), err: s("err", 300), perm: s("perm", 20), standalone: !!body.sa, ua: s("ua", 160) });   // 화면에서 켜기 실패 원문
    else this.log({ ev: "open", tag: s("tag", 80), url: s("url", 200), found: !!body?.found });
    return [200, { ok: true }];
  }

  // ---------- 보내기 ----------
  private async send(msg: P.Msg, only?: string) {
    const v = await this.vapid(); if (!v) return [];
    const data = te.encode(P.pyJson(msg)), out: [string, P.Code][] = [], gone: string[] = [];
    for (const s of this.subs()) {
      if (only && s.endpoint !== only) continue;
      const code = await P.sendOne(v, s, data);   // 구독 하나가 잘못돼도 다른 기기 · 다음 알림은 그대로
      out.push([P.hostOf(s.endpoint) ?? "", code]);
      if (P.dead(code)) gone.push(s.endpoint);
    }
    for (const ep of gone) this.ctx.storage.sql.exec("DELETE FROM sub WHERE endpoint = ?", ep);
    this.log({ ev: "send", tag: msg.tag, title: msg.title, res: out, dropped: gone.length });
    return out;
  }

  // push.py tick: 고르고 → 보낼 때마다 저장(중간에 끊겨도 같은 알림을 되풀이하지 않게). live = write_push 켜짐(꺼지면 본 것으로만)
  private async tick(now = Date.now() / 1000) {
    const db = this.env.DB, live = !!(await db.prepare("SELECT 1 AS on_ FROM f7_flag WHERE name = 'write_push' AND on_at IS NOT NULL").first()), st = this.st();
    const seq = (await db.prepare("SELECT max(seq) n FROM wl_change").first<{ n: number | null }>())?.n ?? 0;
    if (st.known && st.seq === seq && Object.values(st.known).every(t => t === "done")) return [];
    const [cards, urg] = await rows(db);
    const todo = P.pending(st, now, cards, urg);
    st.seq = seq; this.save(st);
    const sent: [string, P.Msg][] = [];
    for (const t of todo) {
      if (!live) { P.settle(st, t, []); this.log({ ev: "observe", tag: t[1].tag }); }
      else if (P.settle(st, t, await this.send(t[1]))) sent.push([t[0], t[1]]);
      this.save(st);
    }
    return sent;
  }
  tickNow() { return this.lock(() => this.tick()); }

  // 알람: 10초마다 늘(꺼져 있어도 본 것을 따라감). 처음 거는 것은 ensure(릴레이 sync · 화면 길이 부름)
  async ensure() { if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + 1000); return true; }
  async alarm() {
    try { await this.tickNow(); }
    catch (e) { this.log({ ev: "error", err: `${(e as Error)?.name}: ${(e as Error)?.message}`.slice(0, 200) }); }
    await this.ctx.storage.setAlarm(Date.now() + EVERY);
  }

  // ---------- 옮기기 · 보기(릴레이 토큰 길) ----------
  // push-subs.json · push-state.json 을 그대로 받아 통째로 갈아 끼움. 받은 상태는 seq 없이(다음 틱이 표를 다 읽음). reset = 상태를 지워 첫 실행부터(시험)
  importData(b: { subs?: Record<string, { keys?: { p256dh?: unknown; auth?: unknown }; ua?: unknown; at?: unknown }>; state?: P.State; reset?: boolean }) {
    return this.lock(async () => {
      const subs = Object.entries(b.subs || {}).filter(([ep, s]) => /^https?:\/\/[^/?#\s]+\//.test(ep) && ep.length <= 1000 && s?.keys?.p256dh && s?.keys?.auth);
      const st = b.state;
      if (st && (typeof st.known !== "object" || !Array.isArray(st.notified) || !Array.isArray(st.fps) || typeof st.tries !== "object")) return { ok: false, error: "상태 꼴이 아님" };
      const sql = this.ctx.storage.sql;
      if (b.subs) {
        sql.exec("DELETE FROM sub");
        for (const [ep, s] of subs) sql.exec("INSERT INTO sub(endpoint, p256dh, auth, ua, at) VALUES (?,?,?,?,?)", ep, String(s.keys!.p256dh), String(s.keys!.auth), String(s.ua ?? "").slice(0, 200), Number(s.at) || 0);
      }
      if (st) { delete st.seq; this.save(st); }
      else if (b.reset) sql.exec("DELETE FROM kv WHERE k = 'state'");
      this.log({ ev: "import", subs: b.subs ? subs.length : null, state: !!st, reset: !st && !!b.reset });
      return { ok: true, subs: subs.length, skipped: Object.keys(b.subs || {}).length - subs.length, state: !!st };
    });
  }
  async stat() {
    const st = this.st(), sql = this.ctx.storage.sql;
    return {
      on: await f7On(this.env.DB, "write_push"), key: !!(await this.vapid()), alarm: await this.ctx.storage.getAlarm(),
      subs: this.subs().map(s => P.hostOf(s.endpoint)), known: Object.keys(st.known || {}).length, waiting: Object.values(st.known || {}).filter(t => t !== "done").length,
      notified: st.notified.length, fps: st.fps.length, tries: st.tries, seq: st.seq ?? null,
      log: sql.exec<{ at: string; ev: string }>("SELECT at, ev FROM log ORDER BY id DESC LIMIT 20").toArray().map(r => ({ at: r.at, ...JSON.parse(r.ev) })),
    };
  }
}
