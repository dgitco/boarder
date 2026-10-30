/**
 * 원격 MCP 서버 부르기(streamable HTTP): initialize → notifications/initialized → tools/list · tools/call.
 * 답은 JSON 이거나 SSE(text/event-stream) — SSE 면 data: 줄에서 같은 id 의 답을 찾음.
 * 세션 id(Mcp-Session-Id)는 isolate 안에서 연결마다 기억하고, 서버가 세션을 모른다고 하면(404 · 400) 한 번 다시 엶.
 */
const PROTOCOL = "2025-06-18";
const TIMEOUT_MS = 30_000;

export class AuthError extends Error {}

export type Remote = { id: string; url: string; headers: Record<string, string>; timeoutMs?: number };
type Rpc = { jsonrpc: "2.0"; id?: number; result?: any; error?: { code: number; message: string } };

const sessions = new Map<string, string>();
let seq = 0;

async function post(r: Remote, body: unknown, session?: string): Promise<{ res: Response; msg?: Rpc }> {
  const h: Record<string, string> = { ...r.headers, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTOCOL };
  if (session) h["mcp-session-id"] = session;
  const res = await fetch(r.url, { method: "POST", headers: h, body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(r.timeoutMs || TIMEOUT_MS) });
  if (res.status === 401) { await res.body?.cancel(); throw new AuthError("401"); }
  if (res.status >= 300 && res.status < 400) { await res.body?.cancel(); throw new Error(`원격 MCP 가 다른 주소로 넘김(${res.status}) — 주소를 확인해요`); }
  const id = (body as { id?: number }).id;
  if (id === undefined || res.status === 202 || res.status === 204) { await res.body?.cancel(); return { res }; }
  if (!res.ok) return { res };
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/event-stream")) {
    // 같은 id 의 답이 오면 바로 끊음(서버가 흐름을 열어 둘 수 있음)
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "", data: string[] = [];
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
          if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
          else if (line === "" && data.length) {
            let m: Rpc | null = null; try { m = JSON.parse(data.join("\n")); } catch {}
            data = [];
            if (m && m.id === id && ("result" in m || "error" in m)) { reader.cancel().catch(() => {}); return { res, msg: m }; }
          }
        }
      }
    } finally { reader.releaseLock?.(); }
    if (data.length) { try { const m = JSON.parse(data.join("\n")) as Rpc; if (m.id === id) return { res, msg: m }; } catch {} }
    throw new Error("원격 MCP 가 답 없이 흐름을 닫음");
  }
  const msg = await res.json().catch(() => undefined) as Rpc | undefined;
  if (!msg || msg.jsonrpc !== "2.0") throw new Error("이 주소는 MCP 로 답하지 않아요(JSON-RPC 아님)");
  return { res, msg };
}

async function open(r: Remote): Promise<string | undefined> {
  const { res, msg } = await post(r, { jsonrpc: "2.0", id: ++seq, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "boarder", version: "0.1.0" } } });
  if (!res.ok) throw new Error(`원격 MCP initialize ${res.status}`);
  if (msg?.error) throw new Error(`원격 MCP initialize: ${msg.error.message}`);
  const s = res.headers.get("mcp-session-id") || undefined;
  await post(r, { jsonrpc: "2.0", method: "notifications/initialized" }, s).catch(() => {});
  if (s) sessions.set(r.id, s); else sessions.delete(r.id);
  return s;
}

export async function rpc(r: Remote, method: string, params: unknown): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = sessions.has(r.id) && attempt === 0 ? sessions.get(r.id) : await open(r);
    const { res, msg } = await post(r, { jsonrpc: "2.0", id: ++seq, method, params }, s);
    if (res.status === 404 && s && attempt === 0 && !msg) { sessions.delete(r.id); continue; }
    if (!res.ok && !msg) throw new Error(`원격 MCP ${method} ${res.status}`);
    if (msg?.error) throw new Error(msg.error.message || `원격 MCP 오류 ${msg.error.code}`);
    return msg?.result;
  }
  throw new Error(`원격 MCP ${method} 실패`);
}

export type RemoteTool = { name: string; title?: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: Record<string, unknown> };

export async function listTools(r: Remote): Promise<RemoteTool[]> {
  const out: RemoteTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await rpc(r, "tools/list", cursor ? { cursor } : {});
    for (const t of res?.tools || []) out.push({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations });
    cursor = res?.nextCursor; if (!cursor) break;
  }
  return out;
}

export function forget(id: string) { sessions.delete(id); }
