export type Kind = "js" | "css";
export type Block = { kind: Kind; body: string };
export const PATH = /^\/bxs\/([0-9a-f]{32})\.(js|css)$/;
export const MIN = 4096;   // 이보다 작은 덩어리는 요청 하나가 더 비쌈
export const CACHE = "private, max-age=31536000, immutable";   // 로그인한 사람에게만 주니 private(브라우저 캐시는 같음)
export const TYPE: Record<Kind, string> = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8" };

export async function shaOf(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d.slice(0, 16)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const RETRY = ` onerror="try{if(!sessionStorage.bxr){sessionStorage.bxr=1;location.reload()}}catch(e){}"`;
const attrQ = (v: string) => v.replace(/"/g, "&quot;");   // 원문 그대로(엔티티는 이미 원문 꼴) — 작은따옴표 값의 「"」만
export const tagOf = (kind: Kind, sha: string, id?: string) =>
  kind === "js" ? `<script src="/bxs/${sha}.js"${RETRY}></script>` : `<link rel="stylesheet" href="/bxs/${sha}.css"${id ? ` id="${id}"` : ""}${RETRY}>`;

// 덩어리 보관(isolate 메모리) — 오래 안 쓴 것부터 버림(R2 · 틀에서 다시 만들 수 있음)
export class Store {
  m = new Map<string, Block>(); n = 0; cap: number;
  constructor(cap = 16 * 1024 * 1024) { this.cap = cap; }
  get(sha: string) { const b = this.m.get(sha); if (b) { this.m.delete(sha); this.m.set(sha, b); } return b; }
  set(sha: string, b: Block) {
    if (this.m.has(sha)) return;
    this.m.set(sha, b); this.n += b.body.length;
    for (const [k, v] of this.m) { if (this.n <= this.cap || this.m.size <= 1) break; this.m.delete(k); this.n -= v.body.length; }
  }
}

// 껍데기(Worker 묶음): 덩어리마다 태그 — 몸통은 지금 인라인으로 보내던 바이트 그대로(닫는 태그 막기 「<\/」 포함)
export async function pack(parts: { kind: Kind; body: string; id?: string }[], put: (sha: string, b: Block) => void) {
  let out = "";
  for (const p of parts) { const sha = await shaOf(p.body); put(sha, { kind: p.kind, body: p.body }); out += tagOf(p.kind, sha, p.id); }
  return out;
}

// HTML 토큰 읽기(가볍게): 주석 · 원문 요소(script · style · textarea …) 안의 「<script>」를 태그로 잘못 읽지 않게, 속성 따옴표 안 「>」도
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]);
const ATTRS = String.raw`(?:[\s/]+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>][^\s>]*))?)*[\s/]*>`;
const START = new RegExp(String.raw`<([a-zA-Z][^\s/>]*)(` + ATTRS + ")", "y");
const END = new RegExp(String.raw`</[a-zA-Z][^\s/>]*` + ATTRS, "y");
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>][^\s>]*)))?/g;
const attrsOf = (s: string) => [...s.replace(/[\s/]*>$/, "").matchAll(ATTR)].map(m => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? ""] as const);
const RELURL = /url\(\s*(?!['"]?\s*(?:[a-z][a-z0-9+.-]*:|\/|#))/i;   // 상대 주소는 /bxs/ 기준으로 바뀌니 인라인 그대로

export type Kept = { kind: Kind; bytes: number; why: string };
export async function extract(html: string, put: (sha: string, b: Block) => void, keep: string[] = [], min = MIN): Promise<{ html: string; out: number; kept: Kept[] } | null> {
  const cut: { a: number; b: number; kind: Kind; body: string; id?: string }[] = [], kept: Kept[] = [];
  let i = 0;
  for (;;) {
    i = html.indexOf("<", i); if (i < 0) break;
    const nx = html[i + 1] || "";
    if (html.startsWith("<!--", i)) {
      if (html.startsWith("<!-->", i)) { i += 5; continue; } if (html.startsWith("<!--->", i)) { i += 6; continue; }
      const e = /--!?>/g; e.lastIndex = i + 4; const m = e.exec(html); if (!m) return null; i = m.index + m[0].length; continue;
    }
    if (nx === "!" || nx === "?" || (nx === "/" && !/[a-zA-Z]/.test(html[i + 2] || ""))) { const e = html.indexOf(">", i + 2); if (e < 0) return null; i = e + 1; continue; }   // 문서형 · 엉터리 주석
    if (nx === "/") { END.lastIndex = i; const m = END.exec(html); if (!m) return null; i = END.lastIndex; continue; }
    if (!/[a-zA-Z]/.test(nx)) { i++; continue; }   // 그냥 글의 「<」
    START.lastIndex = i; const m = START.exec(html); if (!m) return null;
    const name = m[1].toLowerCase(), a = i; i = START.lastIndex;
    if (name === "plaintext") break;
    if (!RAW.has(name)) continue;
    const ce = new RegExp(`</${name}(?=[\\s/>])`, "gi"); ce.lastIndex = i; const c = ce.exec(html); if (!c) return null;
    END.lastIndex = c.index; if (!END.exec(html)) return null;
    const body = html.slice(i, c.index), b = END.lastIndex; i = b;
    if (name !== "script" && name !== "style") continue;
    const kind: Kind = name === "script" ? "js" : "css", at = attrsOf(m[2]);
    // 스크립트 안 「<!--<script」는 브라우저가 닫는 태그를 다르게 읽을 수 있음 — 통째로 인라인
    if (kind === "js" && body.includes("<!--") && /<script/i.test(body)) return null;
    const why = body.length < min ? "small"
      : keep.some(k => body.includes(k)) ? "per-load"
      : kind === "js" ? (at.some(([k, v]) => k !== "type" || !/^(?:text|application)\/javascript$/i.test(v)) ? "attrs" : body.includes("currentScript") ? "currentScript" : "")
      : at.some(([k, v]) => k !== "id" && !(k === "type" && /^text\/css$/i.test(v))) ? "attrs" : /@import/i.test(body) || RELURL.test(body) ? "relative-url" : "";
    if (why) { kept.push({ kind, bytes: body.length, why }); continue; }
    cut.push({ a, b, kind, body, id: kind === "css" ? at.find(([k]) => k === "id")?.[1] : undefined });
  }
  let out = "", p = 0;
  for (const x of cut) { const sha = await shaOf(x.body); put(sha, { kind: x.kind, body: x.body }); out += html.slice(p, x.a) + tagOf(x.kind, sha, x.id === undefined ? undefined : attrQ(x.id)); p = x.b; }
  return { html: out + html.slice(p), out: cut.length, kept };
}
