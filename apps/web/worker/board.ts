import { DurableObject } from "cloudflare:workers";

// 스냅숏 칸 → 화면 바뀜 표 칸(옛 server.py /api/events 와 같은 이름 — board.html 이 받던 꼴). cfg 안에 초안이 있어 drafts
const LIVE_KEY: Record<string, string> = { data: "data", topics: "topics", cfg: "drafts", history: "history" };

const tagOf = async (body: string) => {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  return '"' + [...h.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("") + '"';
};
// 고침 줄 끼우기(board-snap snappatch.py · 화면 shell.js 와 같은 규칙): [길, 값] 넣기 · 바꾸기, [길] 빼기(dict 칸만), 빈 길 = 통째. 목록은 있는 자리만 바꿈
const BADKEY = new Set(["__proto__", "constructor", "prototype"]);
export function applyOps(o: unknown, ops: unknown) {
  if (!Array.isArray(ops)) throw new Error("목록 아님");
  for (const op of ops) {
    if (!Array.isArray(op) || op.length < 1 || op.length > 2 || !Array.isArray(op[0])) throw new Error("꼴");
    const p = op[0] as unknown[];
    if (!p.length) { if (op.length !== 2) throw new Error("통째 빼기"); o = op[1]; continue; }
    for (const k of p) if ((typeof k !== "string" && typeof k !== "number") || BADKEY.has(String(k))) throw new Error("열쇠");
    let cur = o as Record<string | number, unknown>;
    for (const k of p.slice(0, -1)) {
      if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, k as string)) throw new Error("길");
      cur = cur[k as string] as Record<string | number, unknown>;
    }
    if (cur === null || typeof cur !== "object") throw new Error("길");
    const k = p[p.length - 1];
    if (Array.isArray(cur)) {
      if (op.length !== 2 || typeof k !== "number" || !Number.isInteger(k) || k < 0 || k >= cur.length) throw new Error("자리");
      cur[k] = op[1];
    } else if (typeof k !== "string") throw new Error("열쇠");
    else if (op.length === 1) delete cur[k];
    else cur[k] = op[1];
  }
  return o;
}

export class BoardSnap extends DurableObject<object> {
  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS snap(key TEXT PRIMARY KEY, body TEXT NOT NULL, etag TEXT NOT NULL, at INTEGER NOT NULL, checked INTEGER NOT NULL DEFAULT 0)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS rids(rid TEXT PRIMARY KEY, path TEXT NOT NULL, state TEXT NOT NULL, status INTEGER, body TEXT, ct TEXT, ce TEXT, at INTEGER NOT NULL)");   // body = 답 바이트 base64(눌린 답도 그대로)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // 늦은 저장 표(__lazy 행): 있으면 디스크 판이 몇 초 낡았을 수 있음 — 이 DO 가 뜬 뒤 받지 않은 칸은 「낡음」으로 내주고 touch 는 「없음」(올리는 쪽이 통째로 다시)
    this.diskMaybeStale = this.lazyMarked = !!ctx.storage.sql.exec("SELECT 1 FROM snap WHERE key='__lazy'").toArray().length;   // 화면이 10초마다 — DO 를 깨우지 않고 답(반쯤 끊긴 연결은 화면이 15초 안에 알아채고 폴링 · 다시 붙기)
  }
  async touch(key: string, lazy = false) {
    const r = this.row(key);
    // 늦은 저장(lazy): 「맞음」 시각은 메모리만(SQLite 쓰기 = 출력 게이트 — 그동안 이 DO 의 모든 답 · 화면 글이 묶임).
    //   이 DO 가 다시 뜬 뒤(메모리에 없던 칸)는 디스크 판이 몇 초 낡았을 수 있어 「없음」 → 릴레이가 통째로 다시 올림
    if (!r || (!r.fresh && (lazy || this.diskMaybeStale))) return false;
    let ok = true;
    if (r) r.checked = Date.now();
    if (!lazy) ok = this.ctx.storage.sql.exec("UPDATE snap SET checked=? WHERE key=?", Date.now(), key).rowsWritten > 0;
    if (ok && key === "data" && Date.now() - this.beatAt >= 10_000) this.bump({});   // 「주인 data 지금도 맞음」을 10초마다 화면에(나이만) — board-snap 이 멈추면 이게 끊겨 화면이 알아챔
    return ok;
  }
  beatAt = 0;
  // 주인 data 스냅숏 나이(서버 시계, ms) — 마지막으로 올리거나 「맞음」을 받은 뒤. 회원 칸 · 아직 없음은 null
  dataAge() { const r = this.view("data"); return r ? Date.now() - Math.max(r.at, r.checked) : null; }
  mem = new Map<string, { body: string; etag: string; at: number; checked: number; fresh: boolean }>();   // fresh = 이 DO 가 뜬 뒤 받은 판
  dirty = new Set<string>(); persistT: ReturnType<typeof setTimeout> | null = null; dirtySince = 0;
  diskMaybeStale = false; lazyMarked = false;
  view(key: string) { const r = this.row(key); return r && !r.fresh && this.diskMaybeStale ? { ...r, at: 0, checked: 0 } : r; }
  row(key: string) {
    let r = this.mem.get(key);
    if (!r) {
      const d = this.ctx.storage.sql.exec<{ body: string; etag: string; at: number; checked: number }>("SELECT body, etag, at, checked FROM snap WHERE key=?", key).toArray()[0];
      if (!d) return null;
      r = { ...d, fresh: false }; this.mem.set(key, r);
    }
    return r;
  }
  store(key: string, body: string, etag: string, lazy: boolean) {
    const now = Date.now(); this.mem.set(key, { body, etag, at: now, checked: now, fresh: true });
    if (lazy && body.length > 600_000 && new TextEncoder().encode(body).length > 1_900_000) lazy = false;
    if (!lazy) {
      this.dirty.delete(key);
      this.ctx.storage.sql.exec("INSERT INTO snap(key,body,etag,at,checked) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, etag=excluded.etag, at=excluded.at, checked=excluded.checked", key, body, etag, now, now);
      if (this.lazyMarked && !this.dirty.size && !this.persistT) { this.ctx.storage.sql.exec("DELETE FROM snap WHERE key='__lazy'"); this.lazyMarked = false; }   // 늦은 칸이 다 디스크에 — 표 지움(그 뒤에 쓰므로 표가 지워졌으면 앞 쓰기도 확정)
      return;
    }
    if (!this.lazyMarked) { this.ctx.storage.sql.exec("INSERT INTO snap(key,body,etag,at,checked) VALUES('__lazy','1','',?,?) ON CONFLICT(key) DO NOTHING", now, now); this.lazyMarked = true; }   // 이 DO 에서 처음 한 번만(쓰기 확정 한 번)
    this.dirty.add(key);
    if (!this.dirtySince) this.dirtySince = now;
    if (this.persistT) clearTimeout(this.persistT);
    this.persistT = setTimeout(() => this.persist(), Math.max(0, Math.min(1500, this.dirtySince + 10_000 - now)));
  }
  persist() {
    this.persistT = null; this.dirtySince = 0;
    for (const k of this.dirty) {
      const r = this.mem.get(k);
      try { if (r) this.ctx.storage.sql.exec("INSERT INTO snap(key,body,etag,at,checked) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, etag=excluded.etag, at=excluded.at, checked=excluded.checked", k, r.body, r.etag, r.at, r.checked); }
      catch (e) { console.log("snap persist 실패", k, String((e as Error)?.message || e).slice(0, 120)); }   // 그 칸만 — 뒤 칸은 그대로 씀(메모리 판은 남음, 다시 뜨면 「낡음」 → 다시 올림)
    }
    this.dirty.clear();
  }
  // 재기(x-snap-timing): 쓰기 없는 왕복 · 이 DO 의 colo(처음 한 번 cdn-cgi/trace)
  colo = ""; coloP: Promise<void> | null = null;
  where() { if (!this.coloP) this.coloP = fetch("https://www.cloudflare.com/cdn-cgi/trace").then(r => r.text()).then(t => { this.colo = /colo=(\w+)/.exec(t)?.[1] || "?"; }).catch(() => { this.coloP = null; }); return this.colo; }
  async ping() { return this.where(); }
  async put(key: string, body: string, push = false, lazy = false) { return (await this.putT(key, body, push, lazy)).etag; }
  // 올리기 + DO 안 시간(ms — SHA · SQLite · 바뀐 칸 · 화면 알림, x-snap-timing doin)
  async putT(key: string, body: string, push = false, lazy = false) {
    const t0 = Date.now(), etag = await tagOf(body);
    const old = this.row(key)?.etag;
    this.store(key, body, etag, lazy);
    let dd: unknown = undefined;
    if (key === "data") {
      let o: unknown = null; try { o = JSON.parse(body); } catch {}
      if (old !== etag) dd = this.diff(etag, o, push);
      this.obj = o && typeof o === "object" && !Array.isArray(o) ? { etag, o } : null;
    }
    if (LIVE_KEY[key] && old !== etag) this.bump({ [LIVE_KEY[key]]: etag }, dd);   // 값 = 그 스냅숏 ETag — 화면이 가진 ETag 와 같으면 안 다시 읽음
    return { etag, ms: Date.now() - t0, colo: this.where() };
  }
  obj: { etag: string; o: unknown } | null = null;
  async patch(key: string, base: string, opsText: string, push = false, lazy = false) {
    const t0 = Date.now();
    if (key !== "data") return { conflict: "data 만" };
    const row = this.row(key);
    if (!row || row.etag !== base) { this.obj = null; return { conflict: row ? "앞 판 다름" : "없음" }; }
    let ops: unknown;
    try { ops = JSON.parse(opsText); } catch { return { conflict: "고침 줄 JSON 아님" }; }
    let o: unknown = this.obj?.etag === base ? this.obj.o : undefined;
    this.obj = null;   // 끼우다 틀리면 반쯤 고친 판이 남지 않게 — 끝나면 다시 둠
    try { if (o === undefined) o = JSON.parse(row.body); o = applyOps(o, ops); }
    catch (e) { return { conflict: "못 끼움 " + String((e as Error)?.message || e).slice(0, 60) }; }
    if (!o || typeof o !== "object" || Array.isArray(o)) return { conflict: "판 꼴" };
    const body = JSON.stringify(o); if (body.length > 4_000_000) return { conflict: "너무 큼" };
    const etag = await tagOf(body);
    if (this.mem.get(key)?.etag !== base) return { conflict: "앞 판 다름" };
    this.store(key, body, etag, lazy);
    this.obj = { etag, o };
    if (etag !== base) {
      const dd = push && opsText.length <= 200_000 ? { base, etag, ops } : null;   // 화면은 base 판을 가졌으면 끼움, 아니면 다시 읽음
      this.lastFrom(base, etag, o as Record<string, unknown>, ops as unknown[][]);
      this.bump({ [LIVE_KEY[key]]: etag }, dd);
    }
    return { etag, ms: Date.now() - t0, colo: this.where() };
  }
  last: { etag: string; vals: Map<string, string> } | null = null;
  diff(etag: string, o: unknown, push: boolean) {
    if (!o || typeof o !== "object" || Array.isArray(o)) { this.last = null; return null; }
    const rec = o as Record<string, unknown>;
    const vals = new Map(Object.entries(rec).map(([k, v]) => [k, JSON.stringify(v)] as [string, string]));
    const prev = this.last; this.last = { etag, vals };
    if (!push || !prev) return null;
    const set: Record<string, unknown> = {}; let size = 0;
    for (const [k, v] of vals) if (prev.vals.get(k) !== v) { set[k] = rec[k]; size += v.length; }
    if (size > 200_000) return null;
    return { base: prev.etag, etag, set, keys: [...vals.keys()] };   // keys = 칸 순서(받은 data 와 같은 꼴로 되만들게) — 빠진 칸은 keys 에 없음
  }
  // 고침 줄로 바뀐 판의 맨 위 칸 글(다음에 통째로 받을 때 바뀐 칸을 가르는 바탕) — 고침 줄이 건드린 맨 위 칸만 다시 글로
  lastFrom(base: string, etag: string, rec: Record<string, unknown>, ops: unknown[][]) {
    const prev = this.last, touched = new Set<string>();
    let all = !prev || prev.etag !== base;
    for (const op of ops) { const p = op[0] as unknown[]; if (!p.length) all = true; else touched.add(String(p[0])); }
    const vals = new Map<string, string>();
    for (const [k, v] of Object.entries(rec)) vals.set(k, !all && !touched.has(k) && prev!.vals.has(k) ? prev!.vals.get(k)! : JSON.stringify(v));
    this.last = { etag, vals };
  }
  async get(key: string) {
    const r = this.view(key); return r ? { body: r.body, etag: r.etag, at: r.at, checked: r.checked } : null;
  }
  // 폴링 대비(GET /api/live): 화면 바뀜 표에 쓰는 스냅숏 ETag 들
  async tags() {
    const t: Record<string, string> = {};
    for (const k of Object.keys(LIVE_KEY)) { const r = this.row(k); if (r) t[LIVE_KEY[k]] = r.etag; }
    return { t, age: this.dataAge() };
  }

  async fetch(req: Request) {
    if (req.headers.get("upgrade") !== "websocket") return new Response("no", { status: 426 });
    if (this.ctx.getWebSockets().length >= 200) return new Response("busy", { status: 503 });   // 한 사용자 화면 수 상한(탭 · 기기 · 오른쪽 판)
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ["live"]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  pend: Record<string, string> | null = null;
  pendDd: string[] | null = null;   // 이 글에 실을 data 바뀐 칸들(차례대로, 그때 글로 — 뒤 고침 줄이 같은 판을 고쳐도 섞이지 않게). 하나라도 못 만들면(null) 안 실음 — 화면이 다시 읽음
  bump(t: Record<string, string>, dd?: unknown) {
    if (!this.ctx.getWebSockets("live").length) return 0;
    const first = !this.pend; this.pend = { ...(this.pend || {}), ...t };
    if (first) this.pendDd = [];
    if (dd === null) this.pendDd = null; else if (dd && this.pendDd) this.pendDd.push(JSON.stringify(dd));
    if (first) setTimeout(() => this.flush(), 25);
    return 1;
  }
  flush() {
    const t = this.pend, dd = this.pendDd; this.pend = null; this.pendDd = null; if (!t) return;
    const age = this.dataAge(); this.beatAt = Date.now();
    const head = JSON.stringify({ t, ...(age === null ? {} : { age }) });   // age: 화면이 「갱신 멈춤」 · 낡으면 다시 읽기를 서버 시계로 가름
    let msg = dd && dd.length ? head.slice(0, -1) + ',"dd":[' + dd.join(",") + "]}" : head;
    if (msg !== head && new TextEncoder().encode(msg).length > 800_000) msg = head;   // WebSocket 한 글 상한(1MiB) 아래로 — 넘으면 바뀐 칸은 빼고(화면이 다시 읽음)
    for (const ws of this.ctx.getWebSockets("live")) try { ws.send(msg); } catch {}
  }
  // 시험 · 되돌리기: 붙은 화면을 다 끊음(abort = DO 를 내림 — 저장된 스냅숏은 그대로, 화면은 폴링 → 다시 붙음)
  async drop(abort = false) {
    const n = this.ctx.getWebSockets("live").length;
    for (const ws of this.ctx.getWebSockets("live")) try { ws.close(1012, "다시 붙어요"); } catch {}
    if (abort) {
      if (this.persistT) clearTimeout(this.persistT);
      this.persist(); await this.ctx.storage.sync();
      setTimeout(() => this.ctx.abort("live drop"), 20);
    }
    return n;
  }
  async claim(rid: string, path: string) {
    const now = Date.now(), sql = this.ctx.storage.sql;
    if (Math.random() < 0.02) sql.exec("DELETE FROM rids WHERE at < ?", now - 86_400_000);
    const r = sql.exec<{ path: string; state: string; status: number; body: string; ct: string; ce: string; at: number }>("SELECT path, state, status, body, ct, ce, at FROM rids WHERE rid=?", rid).toArray()[0];
    if (r?.state === "done") return { state: "done" as const, status: r.status, body: r.body, ct: r.ct, ce: r.ce };
    if (r && now - r.at < 120_000) return { state: "busy" as const };
    sql.exec("INSERT INTO rids(rid, path, state, at) VALUES(?,?, 'busy', ?) ON CONFLICT(rid) DO UPDATE SET state='busy', at=excluded.at", rid, path, now);
    return { state: "new" as const };
  }
  async done(rid: string, status: number, body: string, ct: string, ce: string) { this.ctx.storage.sql.exec("UPDATE rids SET state='done', status=?, body=?, ct=?, ce=?, at=? WHERE rid=?", status, body, ct, ce, Date.now(), rid); }
  async release(rid: string) { this.ctx.storage.sql.exec("DELETE FROM rids WHERE rid=? AND state='busy'", rid); }
  async look(rid: string, full = false) {   // full = 남긴 답의 상태 번호도(회원 「보냈나」 — 옛 코드 DO 는 이 값을 몰라 글자만 줌)
    const r = this.ctx.storage.sql.exec<{ state: string; status: number; at: number }>("SELECT state, status, at FROM rids WHERE rid=?", rid).toArray()[0];
    const st = !r ? "none" : r.state === "done" ? "done" : Date.now() - r.at < 120_000 ? "busy" : "none";
    return full ? { state: st, status: r?.status ?? 0 } : st;
  }
  async webSocketMessage() {}   // 화면은 ping 만(자동 답) — 그 밖은 버림
  async webSocketClose(ws: WebSocket, code: number) { try { ws.close([1005, 1006, 1015].includes(code) ? 1000 : code, "닫힘"); } catch {} }
  async webSocketError(ws: WebSocket) { try { ws.close(1011, "오류"); } catch {} }
}
