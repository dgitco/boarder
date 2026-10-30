import { DurableObject } from "cloudflare:workers";

type Out = { status: number; headers: Record<string, string>; body: Uint8Array };
type Wait = { resolve: (o: Out) => void; reject: (e: Error) => void; parts: string[]; status: number; headers: Record<string, string>; timer: ReturnType<typeof setTimeout>; ws?: WebSocket; t0?: number };

const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const enc64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const PART = 512 * 1024;   // WebSocket 글 하나 1MiB 아래로(base64 조각)

export class Bridge extends DurableObject<object> {
  wait = new Map<string, Wait>();
  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }
  async fetch(req: Request) {   // 릴레이의 WebSocket(토큰은 Worker 가 이미 봄)
    if (req.headers.get("upgrade") !== "websocket") return new Response("no", { status: 426 });
    for (const old of this.ctx.getWebSockets()) try { old.close(1012, "새 릴레이"); } catch {}
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ at: Date.now(), keep: new URL(req.url).searchParams.get("keep") === "1" });   // 언제 붙었나 — 보낼 곳은 가장 최근에 살아 있던 연결(아래 sock)
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  seen(w: WebSocket) {
    let at = 0; try { at = (w.deserializeAttachment() as { at?: number } | null)?.at || 0; } catch {}
    return Math.max(at, this.ctx.getWebSocketAutoResponseTimestamp(w)?.getTime() || 0);
  }
  sock() { return this.ctx.getWebSockets().filter(w => !(w.readyState >= 2)).sort((a, b) => this.seen(b) - this.seen(a))[0]; }
  misses = new WeakMap<WebSocket, number>();
  drop(ws: WebSocket, why: string, now = false) {
    if (this.sock() !== ws) return;
    const n = (this.misses.get(ws) || 0) + 1; this.misses.set(ws, n);
    if (now || n >= 2) try { ws.close(1012, why.slice(0, 60)); } catch {}
  }
  online() { return !!this.sock(); }
  health() { const n = this.ctx.getWebSockets().length, s = this.sock(); return { sockets: n, fresh_s: s ? Math.round((Date.now() - this.seen(s)) / 1000) : null }; }
  async ready(): Promise<WebSocket | undefined> { let ws = this.sock(); for (let t = 0; !ws && t < 32; t++) { await new Promise(ok => setTimeout(ok, 250)); ws = this.sock(); } return ws; }
  async call(r: { method: string; path: string; headers: Record<string, string>; body?: Uint8Array }): Promise<Out> {
    const ws = await this.ready();
    if (!ws) throw new Error("릴레이 없음");
    const id = crypto.randomUUID();
    return new Promise<Out>((resolve, reject) => {
      const timer = setTimeout(() => { this.wait.delete(id); this.drop(ws, "답 없음"); reject(new Error("릴레이 답 없음")); }, 25000);
      this.wait.set(id, { resolve, reject, parts: [], status: 0, headers: {}, timer, ws, t0: Date.now() });
      const body = r.body && r.body.length ? enc64(r.body) : "", n = Math.ceil(body.length / PART);
      try {
        ws.send(JSON.stringify({ id, method: r.method, path: r.path, headers: r.headers, parts: n }));
        for (let i = 0; i < n; i++) ws.send(JSON.stringify({ id, part: i, data: body.slice(i * PART, (i + 1) * PART) }));
      } catch (e) { clearTimeout(timer); this.wait.delete(id); this.drop(ws, "보내기 실패", true); reject(e); }
    });
  }
  async tool(name: string, args: Record<string, unknown>, agent: string): Promise<unknown> {
    const ws = await this.ready();
    if (!ws) throw new Error("릴레이 없음");
    const id = crypto.randomUUID();
    const out = await new Promise<Out>((resolve, reject) => {
      const timer = setTimeout(() => { this.wait.delete(id); reject(new Error("릴레이 답 없음")); }, 110000);
      this.wait.set(id, { resolve, reject, parts: [], status: 0, headers: {}, timer, ws });
      try { ws.send(JSON.stringify({ id, op: "tool", name, args, agent })); }
      catch (e) { clearTimeout(timer); this.wait.delete(id); this.drop(ws, "보내기 실패", true); reject(e); }
    });
    const j = JSON.parse(new TextDecoder().decode(out.body) || "{}");
    if (out.status >= 400) throw new Error(j.error || `릴레이 ${out.status}`);
    return j;
  }
  async webSocketMessage(_ws: WebSocket, msg: string | ArrayBuffer) {
    if (typeof msg !== "string") return;
    const m = JSON.parse(msg) as { id?: string; status?: number; headers?: Record<string, string>; data?: string; last?: boolean };
    const w = m.id && this.wait.get(m.id); if (!w) return;
    if (w.ws) this.misses.delete(w.ws);   // 답이 오면 그 연결은 산 것
    if (m.status) { w.status = m.status; w.headers = m.headers || {}; w.parts = []; }   // 첫 조각(머리) = 처음부터 — 끊긴 뒤 다시 보낸 답이 반쯤 온 옛 조각에 섞이지 않게
    if (m.data) w.parts.push(m.data);
    if (m.last) {
      clearTimeout(w.timer); this.wait.delete(m.id!);
      const chunks = w.parts.map(b64), n = chunks.reduce((a, c) => a + c.length, 0), body = new Uint8Array(n);
      let o = 0; for (const c of chunks) { body.set(c, o); o += c.length; }
      w.resolve({ status: w.status || 502, headers: w.t0 ? { ...w.headers, "x-do-ms": String(Date.now() - w.t0) } : w.headers, body });
    }
  }
  async webSocketError(ws: WebSocket) { await this.webSocketClose(ws); }
  async webSocketClose(ws: WebSocket) {
    let keep = false; try { keep = !!(ws.deserializeAttachment() as { keep?: boolean } | null)?.keep; } catch {}
    try { ws.close(1011, "닫힘"); } catch {}
    for (const [id, w] of this.wait) {
      if (w.ws && w.ws !== ws) continue;
      if (keep) { w.ws = undefined; continue; }   // 실행기: 그 요청의 답은 다시 붙은 연결로 옴(실행기가 다시 보냄) — 안 오면 원래 시간 넘김(25초)
      clearTimeout(w.timer); w.reject(new Error("릴레이 끊김")); this.wait.delete(id);
    }
  }
}
