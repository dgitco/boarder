import { CODE_TOOLS, SEARCH, DESCRIBE, EXECUTE, EXECUTE_WRITE, INSTRUCTIONS, MAX_CALLS, MAX_CODE, MAX_OUTPUT, formatScript, type ToolApi } from "./codemode";
import { quickjsSandbox } from "./quickjs";
import { run, search, describe, onlyReads, type Ctx } from "./tools";
import { shape } from "./registry";
import { isConnectorTool, searchLines, describeTool, runTool } from "../connectors/mcp";

const sandbox = quickjsSandbox();
const PROTOCOL = "2025-06-18";
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], isError });

async function big(ctx: Ctx, t: string, isError = false) {
  if (t.length <= MAX_OUTPUT) return text(t, isError);
  if (!ctx.store) return text(`${t.slice(0, MAX_OUTPUT)}\n… ${MAX_OUTPUT} 자에서 자름: 필요한 칸만 돌려줘요.`, isError);
  const url = await ctx.store(t);
  return text(`결과가 ${t.length.toLocaleString("en")} 자라 파일로 둠 — GET ${url} (같은 토큰 · 7일). 다음엔 필요한 칸만 돌려줘요.`, isError);
}

async function searchAll(ctx: Ctx, query: string, limit: number) {
  const inbox = search(ctx.view, query, limit);
  if (!ctx.conn) return inbox;
  const more = await searchLines(ctx.conn, ctx.conn.scope, query.toLowerCase().split(/\s+/).filter(Boolean), Math.min(25, limit)).catch(() => []);
  return more.length ? `${inbox}\n${more.map(x => x.line).join("\n")}` : inbox;
}
const describeAny = (ctx: Ctx, name: string) => isConnectorTool(name)
  ? (ctx.conn ? describeTool(ctx.conn, ctx.conn.scope, name) : Promise.reject(new Error(`없는 도구: ${name}`)))
  : Promise.resolve(describe(ctx.view, name));

async function execute(ctx: Ctx, args: any, write: boolean) {
  let calls = 0;
  const one = async (name: string, a: Record<string, unknown>) => {
    if (++calls > MAX_CALLS) throw new Error(`도구 부르기는 ${MAX_CALLS} 번까지`);
    if (isConnectorTool(name)) {
      if (!ctx.conn) throw new Error(`없는 도구: ${name}`);
      return shape(name, await runTool(ctx.conn.env, ctx.conn, ctx.conn.scope, name, a, write), true);   // 가림 · 긴 글 자르기는 inbox 도구와 같게
    }
    if (!write && !onlyReads(name)) throw new Error(`${name} 은 바꾸는 도구 — ${EXECUTE_WRITE} 로`);
    return run(ctx, name, a);
  };
  if (args?.tool) return big(ctx, JSON.stringify(await one(String(args.tool), args.arguments || {}), null, 2));
  if (Array.isArray(args?.calls)) {
    const out: Record<string, unknown> = {};
    for (const [i, c] of args.calls.entries()) { try { out[c.key ?? i] = await one(String(c.tool), c.arguments || {}); } catch (e) { out[c.key ?? i] = `ERROR ${e instanceof Error ? e.message : e}`; } }
    return big(ctx, JSON.stringify(out, null, 2));
  }
  if (typeof args?.code === "string") {
    if (args.code.length > MAX_CODE) return text(`스크립트는 ${MAX_CODE} 자까지`, true);
    const api: ToolApi = { call: one, search: async (q, l) => searchAll(ctx, q, l || 10), describe: n => describeAny(ctx, n) };
    const r = await sandbox(args.code, api, args.input, ctx.agent);
    const f = formatScript(r, calls); return big(ctx, f.text, f.isError);
  }
  return text("tool · calls · code 중 하나가 필요해요", true);
}

async function call(ctx: Ctx, name: string, args: any) {
  try {
    if (name === SEARCH) return text(await searchAll(ctx, String(args?.query || ""), Number(args?.limit) || 10));
    if (name === DESCRIBE) return text(JSON.stringify(await describeAny(ctx, String(args?.name || "")), null, 2));
    if (name === EXECUTE) return await execute(ctx, args, false);
    if (name === EXECUTE_WRITE) return await execute(ctx, args, true);
    return text(`없는 도구: ${name} — ${SEARCH} 로 찾아요`, true);
  } catch (e) { return text(e instanceof Error ? e.message : String(e), true); }
}

async function handle(ctx: Ctx, m: Rpc) {
  switch (m.method) {
    case "initialize": return ok(m.id, { protocolVersion: m.params?.protocolVersion || PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "boarder", version: "0.1.0" }, instructions: INSTRUCTIONS });
    case "ping": return ok(m.id, {});
    case "tools/list": return ok(m.id, { tools: CODE_TOOLS });
    case "tools/call": return ok(m.id, await call(ctx, String(m.params?.name || ""), m.params?.arguments || {}));
    default: return m.id === undefined ? null : fail(m.id, -32601, `모르는 방법: ${m.method}`);
  }
}

export async function mcp(req: Request, ctx: Ctx): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  let body: Rpc | Rpc[];
  try { body = await req.json(); } catch { return Response.json(fail(null, -32700, "JSON 아님"), { status: 400 }); }
  const many = Array.isArray(body), list = (many ? body : [body]) as Rpc[];
  if (list.length > 10) return Response.json(fail(null, -32600, "한 번에 10개까지"), { status: 400 });
  const out = (await Promise.all(list.map(m => handle(ctx, m)))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202 });   // 알림만(initialized 등)
  return Response.json(many ? out : out[0]);
}
