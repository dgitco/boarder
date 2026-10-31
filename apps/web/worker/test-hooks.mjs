// 시험에서만(node --import ./test-hooks.mjs 가 아니라 register 로 씀): 워커 코드를 Node 에서 불러오게 번들러 · Workers 꼴을 갈음.
//   cloudflare:workers · cloudflare:sockets = 빈 꼴 · ?raw = 파일 글 · ?module = null · 확장자 없는 import = .ts / index.ts · hosted.ts 의 import.meta.glob = 빈 것(공개 판)
import { readFileSync } from "node:fs";
const STUB = {
  "cloudflare:workers": "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } export const env = {};",
  "cloudflare:sockets": "export const connect = () => { throw new Error('시험에 소켓 없음'); };",
};
const js = s => "data:text/javascript," + encodeURIComponent(s);
export async function resolve(s, c, n) {
  if (STUB[s]) return { url: js(STUB[s]), shortCircuit: true };
  if (s.endsWith("?module")) return { url: js("export default null"), shortCircuit: true };
  if (s.endsWith("?raw")) return { url: js("export default " + JSON.stringify(readFileSync(new URL(s.slice(0, -4), c.parentURL), "utf8"))), shortCircuit: true };
  if (/^\.\.?\//.test(s) && !/\.[cm]?[jt]s$/.test(s)) {
    for (const ext of [".ts", "/index.ts"]) try { return await n(s + ext, c); } catch {}
  }
  return n(s, c);
}
export async function load(u, c, n) {
  const r = await n(u, c);
  if (u.endsWith("/worker/hosted.ts")) return { ...r, source: String(r.source).replace(/import\.meta\.glob<[^>]*>\([^)]*\)/, "({})") };
  return r;
}
