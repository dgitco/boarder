import { SEP } from "./naming";
import { call, type CTool } from "./store";
import { maskText } from "../mcp/registry";

export type Conn = { catalog: () => Promise<Map<string, CTool>> };

export const isConnectorTool = (name: string) => name.includes(SEP);

/** 토큰 범위: '*' 이거나 이름 그대로 · 「linear__*」 · 「linear__dgit__*」 */
export function scopeAllows(scope: string, name: string) {
  const s = scope.trim(); if (s === "*") return true;
  const allow = s.split(",").map(x => x.trim()).filter(Boolean);
  return allow.some(a => a === name || (a.endsWith(`${SEP}*`) && name.startsWith(a.slice(0, -1))));
}

export async function searchLines(conn: Conn, scope: string, words: string[], limit: number) {
  const cat = await conn.catalog();
  const score = (t: CTool) => words.reduce((n, w) => n + (t.name.toLowerCase().includes(w) ? 3 : 0) + ((t.remote.title || "").toLowerCase().includes(w) ? 2 : 0) + ((t.remote.description || "").toLowerCase().includes(w) ? 1 : 0), 0);
  return [...cat.values()].filter(t => scopeAllows(scope, t.name)).map(t => ({ t, s: score(t) })).filter(x => x.s > 0 || !words.length)
    .sort((a, b) => b.s - a.s).slice(0, limit)
    .map(({ t, s }) => ({ s, line: `${t.name}: ${(t.remote.title || t.remote.description || "").split("\n")[0].slice(0, 120)} (${t.readOnly ? "boarder_execute" : "boarder_execute_write"})` }));
}

async function find(conn: Conn, scope: string, name: string) {
  const t = (await conn.catalog()).get(name);
  if (!t) throw new Error(`없는 도구: ${name} — 연결이 끊겼거나 꺼졌어요(boarder_search 로 찾아요)`);
  if (!scopeAllows(scope, name)) throw new Error(`이 토큰은 ${name} 을 쓸 수 없음`);
  return t;
}

export async function describeTool(conn: Conn, scope: string, name: string) {
  const t = await find(conn, scope, name);
  return { name, title: t.remote.title, description: t.remote.description || "", inputSchema: t.remote.inputSchema || { type: "object" }, readOnly: t.readOnly, runWith: t.readOnly ? "boarder_execute" : "boarder_execute_write", connection: t.conn.service + (t.conn.label ? ` › ${t.conn.label}` : "") };
}

export async function runTool(env: Parameters<typeof call>[0], conn: Conn, scope: string, name: string, args: Record<string, unknown>, write: boolean) {
  const t = await find(conn, scope, name);
  if (!write && !t.readOnly) throw new Error(`${name} 은 바꾸는 도구 — boarder_execute_write 로`);
  let r: { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };
  try { r = await call(env, t.conn, t.remote.name, args ?? {}) as typeof r; } catch (e) { throw new Error(maskText(e instanceof Error ? e.message : String(e)).slice(0, 2000)); }
  // 글 조각은 이어 붙이고(대개 JSON 글), 구조 값이 있으면 그것을 — 스크립트가 바로 쓰게
  const text = (r?.content || []).filter(x => x.type === "text").map(x => x.text || "").join("\n");
  if (r?.isError) throw new Error(maskText(text).slice(0, 2000) || `${name} 실패`);
  if (r?.structuredContent !== undefined) return r.structuredContent;
  try { return JSON.parse(text); } catch { return text; }
}
