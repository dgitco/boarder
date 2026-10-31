export type Out = { status: number; headers: Record<string, string>; body: Uint8Array; src?: "r2" };
type Art = { kind: "page" | "canvas" | "doc"; title: string; at: string; acct: string; auto: string; main?: string; cv?: string; map?: Record<string, string> };
type Index = { v: number; at: number; arts: Record<string, Art>; blobs: Record<string, string>; shim: string };
type Env = { RESULTS: R2Bucket; DB: D1Database };

const ID = /^[A-Za-z0-9]{16,40}$/, BLOB = /^[0-9a-f]{32}$/;
const SYS = "art/_sys/";
export const SUPPORT_JS = "window.DCLogic = class {};\n";
const IMG: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const te = new TextEncoder(), td = new TextDecoder();

// 다리 대신 R2 로 답할 수 있는 길(GET 만)
export const FILE_PATH = /^\/(?:art\/|_blob\/|uploads\/\d{8}\/[^/]+$|api\/file\/|api\/arts$|api\/artnotes\/)/;
const JSON_PATH = /^\/api\/(?:arts$|artnotes\/)/;
export const isJsonPath = (p: string) => JSON_PATH.test(p);

let idx: { at: number; v: Index | null } | null = null;
export async function index(env: Env): Promise<Index | null> {
  if (idx && Date.now() - idx.at < 15_000) return idx.v;
  const o = await env.RESULTS.get(SYS + "index.json").catch(() => null);
  const v = o ? await o.json<Index>().catch(() => null) : null;
  idx = { at: Date.now(), v };
  return v;
}
export async function isCanvas(env: Env, id: string) { return (await index(env))?.arts[id]?.kind === "canvas"; }

const text = (status: number, s: string, ct = "text/plain"): Out => ({ status, headers: { "content-type": ct, "cache-control": "no-store" }, body: te.encode(s) });
const bytes = async (o: R2ObjectBody) => new Uint8Array(await o.arrayBuffer());
function find(h: Uint8Array, n: Uint8Array) {
  outer: for (let i = 0; i + n.length <= h.length; i++) { for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) continue outer; return i; }
  return -1;
}
// artview._html: </head> 앞(없으면 <body 앞, 둘 다 없으면 맨 앞)에 SHIM
function shim(ix: Index, data: Uint8Array) {
  const s = Uint8Array.from(atob(ix.shim), c => c.charCodeAt(0));
  for (const tag of ["</head>", "<body"]) {
    const i = find(data, te.encode(tag));
    if (i >= 0) { const out = new Uint8Array(data.length + s.length); out.set(data.subarray(0, i)); out.set(s, i); out.set(data.subarray(i), i + s.length); return out; }
  }
  const out = new Uint8Array(data.length + s.length); out.set(s); out.set(data, s.length); return out;
}
const suffix = (name: string) => { const b = name.slice(name.lastIndexOf("/") + 1), i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; };
// Python urllib.parse.quote(name)(safe='/') 와 같은 꼴
const pyQuote = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, "/");
const unq = (s: string) => { try { return decodeURIComponent(s); } catch { return null; } };

async function file(env: Env, ix: Index, key: string, html: boolean): Promise<Out | null> {
  const o = await env.RESULTS.get(key); if (!o) return null;
  const b = await bytes(o);
  return html ? { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, body: shim(ix, b) }
    : { status: 200, headers: { "content-type": o.httpMetadata?.contentType || "application/octet-stream", "cache-control": "no-store" }, body: b };
}

// artview.serve(parts)
async function art(env: Env, ix: Index, parts: string[], anon = false): Promise<Out | null> {
  if (parts.length === 1 && parts[0] === "_kit.js") { const o = await env.RESULTS.get(SYS + "kit.js"); return o ? { status: 200, headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }, body: await bytes(o) } : null; }
  if (!parts.length || !ID.test(parts[0])) return text(404, "not found");
  const aid = parts[0], rest = parts.slice(1).filter(p => !["", ".", ".."].includes(p)), it = ix.arts[aid];
  if (!it) return null;
  if (anon && (it.kind !== "canvas" || rest.length !== 1 || rest[0] !== "support.js")) return text(404, "not found");
  if (it.kind === "doc") {
    if (rest.length) return text(404, "not found");
    const o = await env.RESULTS.get(`${SYS}doc/${aid}.html`);   // 글(.md)은 릴레이가 artview._doc 그대로 그려 올림
    return o ? { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, body: await bytes(o) } : null;
  }
  if (it.kind === "page") {
    const rel = rest.length ? rest.join("/") : it.main || "";
    return rel ? file(env, ix, `art/${aid}/${rel}`, suffix(rel) === ".html") : null;
  }
  if (!rest.length) {
    const o = await env.RESULTS.get(SYS + "artcanvas.html"); if (!o) return null;
    const t = it.title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, body: te.encode(td.decode(await bytes(o)).split("__TITLE__").join(t)) };
  }
  if (rest[rest.length - 1] === "support.js") return { status: 200, headers: { "content-type": "text/javascript", "cache-control": "no-store" }, body: te.encode(SUPPORT_JS) };
  const name = rest.join("/"), html = suffix(name) === ".html";
  if (it.map?.[name]) return file(env, ix, `art/${aid}/${it.map[name]}`, html);
  for (const rel of [...new Set([it.cv ? `${it.cv}/${name}` : name, name, `project/${name}`])]) {
    const o = await file(env, ix, `art/${aid}/${rel}`, html); if (o) return o;
  }
  return null;
}

// Chat.file + server.py /api/file: 그림은 inline, 영상은 Range(206), 그 밖은 내려받기
async function attach(env: Env, id: string, full: boolean, range: string | undefined): Promise<Out | null> {
  let head = await env.RESULTS.head(`files/${id}${full ? ".full" : ""}`), key = `files/${id}${full ? ".full" : ""}`;
  if (!head && full && id.startsWith("f_")) { key = `files/${id}`; head = await env.RESULTS.head(key); }   // 대화 DB 첨부는 미리보기 = 원본
  if (!head) return null;
  const mime = head.httpMetadata?.contentType || "application/octet-stream", name = unq(head.customMetadata?.name || "") || id, n = head.size;
  const img = mime.startsWith("image/") && mime !== "image/svg+xml";
  if (mime.startsWith("video/")) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range || ""), r = m && (m[1] || m[2]) ? m : null;
    let a = 0, z = n - 1;
    if (r) {
      if (r[1]) { a = +r[1]; z = Math.min(r[2] ? +r[2] : n - 1, n - 1); } else { a = Math.max(0, n - +r[2]); z = n - 1; }
      if (a > z || a >= n) return { status: 416, headers: { "content-range": `bytes */${n}` }, body: new Uint8Array(0) };
    }
    const o = await env.RESULTS.get(key, { range: { offset: a, length: z - a + 1 } }); if (!o) return null;
    return { status: r ? 206 : 200, headers: { "content-type": mime, "accept-ranges": "bytes", ...(r ? { "content-range": `bytes ${a}-${z}/${n}` } : {}),
      "content-disposition": `inline; filename*=UTF-8''${pyQuote(name)}`, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" }, body: await bytes(o) };
  }
  const o = await env.RESULTS.get(key); if (!o) return null;
  return { status: 200, headers: { "content-type": img ? mime : "application/octet-stream", "content-disposition": `${img ? "inline" : "attachment"}; filename*=UTF-8''${pyQuote(name)}`,
    "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" }, body: await bytes(o) };
}

async function sha1tag(b: Uint8Array) { const h = new Uint8Array(await crypto.subtle.digest("SHA-1", b as BufferSource)); return '"' + [...h].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 16) + '"'; }
async function json(v: unknown, inm: string | undefined): Promise<Out> {
  const body = te.encode(JSON.stringify(v)), etag = await sha1tag(body);
  if (inm === etag) return { status: 304, headers: { etag, "cache-control": "no-store" }, body: new Uint8Array(0) };
  return { status: 200, headers: { "content-type": "application/json; charset=utf-8", etag, "cache-control": "no-store" }, body };
}

export async function answer(env: Env, path: string, headers: Record<string, string>, anon = false): Promise<Out | null> {
  const q = path.indexOf("?"), p = q < 0 ? path : path.slice(0, q);
  const fm = /^\/api\/file\/(F[A-Z0-9]{6,20}|f_[0-9a-f]{16}_\d{10,20})(\?dl)?$/.exec(path);
  if (fm) return attach(env, fm[1], !!fm[2], headers.range);
  if (p.startsWith("/uploads/")) {
    const m = /^\/uploads\/(\d{8})\/([^/?]+)$/.exec(p); if (!m) return null;
    const name = unq(m[2]); if (name === null) return null;
    const ct = IMG[suffix(name).toLowerCase()];
    if (!ct || name.includes("/") || name.startsWith(".")) return { status: 404, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: te.encode('{"error": "없음"}') };   // 보드 json.dumps 꼴 그대로(바이트 대조)
    const o = await env.RESULTS.get(`up/${m[1]}/${name}`); if (!o) return null;
    return { status: 200, headers: { "content-type": ct, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" }, body: await bytes(o) };
  }
  if (p === "/api/arts") {
    const ix = await index(env); if (!ix) return null;
    const [fd, nc] = await env.DB.batch<{ art: string; folder?: string; n?: number }>([
      env.DB.prepare("SELECT art, folder FROM wl_art_folder"),
      env.DB.prepare("SELECT art, count(*) AS n FROM wl_art_note WHERE deleted_at IS NULL GROUP BY art")]);
    const mv = new Map(fd.results.map(r => [r.art, r.folder!])), cnt = new Map(nc.results.map(r => [r.art, r.n!]));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ix.arts)) out[k] = { kind: v.kind, title: v.title, at: v.at, acct: v.acct, folder: mv.get(k) || v.auto, moved: mv.has(k), notes: cnt.get(k) || 0 };
    return json(out, headers["if-none-match"]);
  }
  const an = /^\/api\/artnotes\/([A-Za-z0-9]{16,40})$/.exec(p);
  if (an) {
    const r = await env.DB.prepare("SELECT id, target, page, who, text, at FROM wl_art_note WHERE art = ? AND deleted_at IS NULL ORDER BY at, id").bind(an[1]).all();
    return json({ notes: r.results }, headers["if-none-match"]);
  }
  if (!p.startsWith("/art/") && !p.startsWith("/_blob/")) return null;
  const raw = unq(p); if (raw === null) return null;
  const parts = raw.split("/").filter(Boolean);
  const ix = await index(env); if (!ix) return null;
  if (parts[0] === "art") return art(env, ix, parts.slice(1), anon);
  const h = parts.length === 2 ? parts[1] : "";   // artview.blob — 다리는 Referer 없이 불렀으니 모든 백업의 _assets 에서 처음 것
  if (!BLOB.test(h)) return text(404, "not found");
  return ix.blobs[h] ? file(env, ix, ix.blobs[h], false) : null;
}

// 그림자 대조(shadow_files): 다리 답 · R2 답의 몸통 해시(JSON 은 키 순서를 맞춘 글) — 다르면 어디서인지 PostHog 에
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, canon((v as Record<string, unknown>)[k])])) : v;
async function plain(o: { headers: Record<string, string>; body: Uint8Array }) {
  if (o.headers["content-encoding"] !== "gzip") return o.body;
  return new Uint8Array(await new Response(new Response(o.body as BodyInit).body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}
async function digest(o: { status: number; headers: Record<string, string>; body: Uint8Array }) {
  let b = await plain(o);
  if ((o.headers["content-type"] || "").startsWith("application/json")) try { b = te.encode(JSON.stringify(canon(JSON.parse(td.decode(b))))); } catch {}
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
  return { len: b.length, sha: [...h.slice(0, 8)].map(x => x.toString(16).padStart(2, "0")).join("") };
}
export async function compare(bridgeOut: { status: number; headers: Record<string, string>; body: Uint8Array }, r2: Out | null) {
  const a = await digest(bridgeOut), b = r2 ? await digest(r2) : null;
  const ctA = (bridgeOut.headers["content-type"] || "").split(";")[0], ctB = r2 ? (r2.headers["content-type"] || "").split(";")[0] : "";
  return { same: !!b && bridgeOut.status === r2!.status && a.sha === b.sha && ctA === ctB, miss: !r2, bridge_status: bridgeOut.status, r2_status: r2?.status ?? null,
    bridge_len: a.len, r2_len: b?.len ?? null, bridge_sha: a.sha, r2_sha: b?.sha ?? null, bridge_ct: ctA, r2_ct: ctB };
}

// 릴레이 올리기 키: 접두사 셋만, 빈 칸 · . · .. 없음
export function okKey(k: string) {
  if (k.length > 600 || !/^(art|up|files)\//.test(k) || /[\0\\]/.test(k)) return false;
  return k.split("/").every(s => s !== "" && s !== "." && s !== "..");
}
