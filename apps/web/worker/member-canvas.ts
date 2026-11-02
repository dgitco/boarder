import type { Context, Hono } from "hono";
import * as files from "./files";
import { ridBatch } from "./queue";

type Env = { RESULTS: R2Bucket; DB: D1Database; BETTER_AUTH_SECRET: string; PUBLIC_URL?: string; [k: string]: unknown };
type C = Context<{ Bindings: Env }>;
export type CanvasHooks = { device: (c: C) => Promise<{ id: string; owner: string } | null> };

export const LIMITS = { files: 200, file: 10 << 20, total: 25 << 20, canvases: 500, path: 200, depth: 8, title: 200, acct: 80 };
export const ID = /^[A-Za-z0-9]{16,40}$/;
const CTRL = /[\x00-\x1f\x7f]/g;
const te = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", te.encode(s)));
export const keyOf = async (email: string) => (await sha("mart|" + email.toLowerCase())).slice(0, 32);
const AL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const newId = () => [...crypto.getRandomValues(new Uint8Array(24))].map(x => AL[x % AL.length]).join("");
const newVer = () => Date.now().toString(36) + [...crypto.getRandomValues(new Uint8Array(3))].map(x => x.toString(16).padStart(2, "0")).join("");
const clean = (v: unknown, n: number) => (typeof v === "string" ? v : "").replace(CTRL, "").trim().slice(0, n);   // 폼 칸이 파일로 와도 「[object File]」 이 제목이 되지 않게

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".pdf": "application/pdf",
};
const ext = (p: string) => { const b = p.slice(p.lastIndexOf("/") + 1), i = b.lastIndexOf("."); return i > 0 ? b.slice(i).toLowerCase() : ""; };
export const typeOf = (p: string) => TYPES[ext(p)] || "application/octet-stream";
export const isHtml = (p: string) => ext(p) === ".html" || ext(p) === ".htm";

/** 올릴 경로: 「/」 로 나눈 칸마다 비지 않고 . · .. 아님, 제어 문자 · 「\」 · 「?」 · 「#」 · 「%」 없음, 깊이 ≤8 · 길이 ≤200 */
export function okPath(p: unknown): p is string {
  if (typeof p !== "string" || !p || p.length > LIMITS.path || /[\x00-\x1f\x7f\\?#%]/.test(p) || p.startsWith("/")) return false;
  const s = p.split("/");
  return s.length <= LIMITS.depth && s.every(x => x !== "" && x !== "." && x !== ".." && x.trim() === x);
}
const marker = (mk: string, id: string) => `mart/${mk}/_c/${id}`;
const fileKey = (mk: string, id: string, ver: string, p: string) => `mart/${mk}/${id}/${ver}/${p}`;
const titleOf = (html: string) => { const m = /<title[^>]*>([^<]{1,400})<\/title>/i.exec(html); return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : ""; };

type Meta = { title: string; acct: string; at: string; ver: string; n: string; bytes: string; kind?: string; cv?: string; win?: string; wid?: string };
export function kindOf(paths: string[]): { kind: "canvas" | "page"; cv: string } {
  if (paths.includes("project/canvas.json")) return { kind: "canvas", cv: "project" };
  if (paths.includes("canvas.json")) return { kind: "canvas", cv: "" };
  return { kind: "page", cv: "" };
}
async function metaOf(env: Env, mk: string, id: string): Promise<Meta | null> {
  const h = await env.RESULTS.head(marker(mk, id));
  return h?.customMetadata?.ver ? h.customMetadata as unknown as Meta : null;
}
async function all(env: Env, mk: string) {
  const out: { id: string; m: Meta }[] = [];
  let cursor: string | undefined;
  do {
    const r = await env.RESULTS.list({ prefix: `mart/${mk}/_c/`, limit: 1000, cursor, include: ["customMetadata"] } as R2ListOptions);
    for (const o of r.objects) { const m = o.customMetadata as unknown as Meta | undefined; if (m?.ver) out.push({ id: o.key.slice(o.key.lastIndexOf("/") + 1), m }); }
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out;
}
async function dropVer(env: Env, mk: string, id: string, ver: string) {
  let cursor: string | undefined;
  do {
    const r = await env.RESULTS.list({ prefix: `mart/${mk}/${id}/${ver}/`, limit: 1000, cursor });
    if (r.objects.length) await env.RESULTS.delete(r.objects.map(o => o.key));
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
}

const autoFolder = (m: Meta) => m.acct || "캔버스";
export async function list(env: Env, email: string) {
  const me = email.toLowerCase();
  const [rows, fr, nr] = await Promise.all([all(env, await keyOf(email)),
    env.DB.prepare("SELECT art, folder FROM member_artfolder WHERE owner = ?").bind(me).all<{ art: string; folder: string }>(),
    env.DB.prepare("SELECT art, count(*) AS n FROM member_artnote WHERE owner = ? AND deleted_at IS NULL GROUP BY art").bind(me).all<{ art: string; n: number }>()]);
  const mv = new Map(fr.results.map(r => [r.art, r.folder])), cnt = new Map(nr.results.map(r => [r.art, Number(r.n)]));
  const out: Record<string, { kind: "page" | "canvas"; title: string; at: string; acct: string; folder: string; moved: boolean; notes: number }> = {};
  for (const { id, m } of rows.sort((a, b) => Number(b.m.at) - Number(a.m.at)))
    out[id] = { kind: m.kind === "canvas" ? "canvas" : "page", title: m.title || id, at: m.at, acct: m.acct || "", folder: mv.get(id) || autoFolder(m), moved: mv.has(id), notes: cnt.get(id) || 0 };
  return out;
}

export type Got = { body: ReadableStream | Uint8Array; ct: string; html: boolean; shell?: boolean };
const te2 = new TextEncoder(), td = new TextDecoder();
export async function file(env: Env, mk: string, id: string, rel: string): Promise<Got | null> {
  if (!ID.test(id)) return null;
  const m = await metaOf(env, mk, id); if (!m) return null;
  if (m.kind === "canvas") {
    if (!rel) {
      const o = await env.RESULTS.get("art/_sys/artcanvas.html"); if (!o) return null;
      const t = (m.title || id).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return { body: te2.encode(td.decode(await o.arrayBuffer()).split("__TITLE__").join(t)), ct: "text/html; charset=utf-8", html: true, shell: true };
    }
    if (rel.endsWith("/") || !okPath(rel)) return null;
    if (rel === "support.js" || rel.endsWith("/support.js")) return { body: te2.encode(files.SUPPORT_JS), ct: "text/javascript; charset=utf-8", html: false };
    for (const p of [...new Set([m.cv ? `${m.cv}/${rel}` : rel, rel, `project/${rel}`])]) {
      if (!okPath(p)) continue;
      const o = await env.RESULTS.get(fileKey(mk, id, m.ver, p)); if (!o) continue;
      const ct = o.httpMetadata?.contentType || typeOf(p);
      if (!isHtml(p)) return { body: o.body, ct, html: false };
      const ix = await files.index(env).catch(() => null), b = new Uint8Array(await o.arrayBuffer());
      return { body: ix?.shim ? files.shim(ix, b) : b, ct, html: true };
    }
    return null;
  }
  const p = !rel || rel.endsWith("/") ? rel + "index.html" : rel;
  if (!okPath(p)) return null;
  const o = await env.RESULTS.get(fileKey(mk, id, m.ver, p)); if (!o) return null;
  return { body: o.body, ct: o.httpMetadata?.contentType || typeOf(p), html: isHtml(p) };
}

export async function ownerWin(env: Env, email: string, art: string) {
  const m = await mine(env, email.toLowerCase(), art);
  return m ? { win: m.win || "", wid: m.wid || "" } : null;
}
const BOARD = /^[\w .()·-]{1,120}\.dc\.html$/;
export async function boardText(env: Env, email: string, art: string, board: string): Promise<[string, string] | null> {
  const mk = await keyOf(email.toLowerCase());
  if (!ID.test(art) || !BOARD.test(board)) return null;
  const m = await metaOf(env, mk, art); if (!m || m.kind !== "canvas") return null;
  let o: R2ObjectBody | null = null;
  for (const p of [...new Set([m.cv ? `${m.cv}/${board}` : board, board, `project/${board}`])]) { if (okPath(p) && (o = await env.RESULTS.get(fileKey(mk, art, m.ver, p)))) break; }
  if (!o) return null;
  let title = board;
  try { const cj = await env.RESULTS.get(fileKey(mk, art, m.ver, m.cv ? `${m.cv}/canvas.json` : "canvas.json")); const t = cj ? (JSON.parse(await cj.text()) as { boards?: Record<string, { title?: string }> })?.boards?.[board]?.title : ""; if (t) title = String(t); } catch {}
  const h = (await o.text()).slice(0, 400_000).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const one = (t: string, n: number) => t.replace(CTRL, " ").split(/\s+/).filter(Boolean).join(" ").slice(0, n);
  return [one(title, 120), one(h, 1800)];
}

const ARTNOTE_MAX = 4000;
const nowS = () => Date.now() / 1000;
const NOART: [number, object] = [404, { ok: false, error: "없는 아티팩트" }];
const mine = async (env: Env, me: string, art: string) => ID.test(art) ? metaOf(env, await keyOf(me), art) : null;
async function noteRows(db: D1Database, me: string, art: string) {
  const r = await db.prepare("SELECT id, target, page, who, text, at FROM member_artnote WHERE owner = ? AND art = ? AND deleted_at IS NULL ORDER BY at, id").bind(me, art).all();
  return r.results;
}
/** GET /api/artnotes/<id> → [상태, {notes}] */
export async function artnotes(env: Env, email: string, art: string): Promise<[number, object]> {
  const me = email.toLowerCase();
  if (!(await mine(env, me, art))) return NOART;
  return [200, { notes: await noteRows(env.DB, me, art) }];
}
/** POST /api/artnote {art, target, page, text} · {art, del} → [상태, {ok, notes}] */
export async function artnote(env: Env, email: string, body: { art?: unknown; del?: unknown; target?: unknown; page?: unknown; text?: unknown }, rid = ""): Promise<[number, object]> {
  const me = email.toLowerCase(), art = String(body.art || "");
  if (!(await mine(env, me, art))) return NOART;
  if (body.del) {
    const id = Number(body.del); if (!Number.isInteger(id)) return [400, { ok: false, error: "빈 댓글" }];
    await ridBatch(env.DB, rid, [env.DB.prepare("UPDATE member_artnote SET deleted_at = ? WHERE id = ? AND owner = ? AND art = ? AND who = 'owner' AND deleted_at IS NULL").bind(nowS(), id, me, art)]);
  } else {
    const text = String(body.text || "").trim().slice(0, ARTNOTE_MAX), target = String(body.target || "").slice(0, 200);
    if (!text || !target) return [400, { ok: false, error: "빈 댓글" }];
    const n = (await env.DB.prepare("SELECT count(*) n FROM member_artnote WHERE owner = ? AND art = ? AND deleted_at IS NULL").bind(me, art).first<{ n: number }>())?.n || 0;
    if (n >= 500) return [400, { ok: false, error: "댓글이 너무 많아요 — 지난 댓글을 지우고 다시 써 주세요" }];
    await ridBatch(env.DB, rid, [env.DB.prepare("INSERT INTO member_artnote(owner, art, target, page, who, text, at) VALUES (?, ?, ?, ?, 'owner', ?, ?)")
      .bind(me, art, target, String(body.page || "").slice(0, 200), text, nowS())]);
  }
  return [200, { ok: true, notes: await noteRows(env.DB, me, art) }];
}
/** POST /api/artfolder {art, folder} → [상태, {ok, folder}] — 「영역/종류」 칸마다 공백 줄이고 40자 · 전체 120자, '' 면 자동 분류로(주인과 같음) */
export async function artfolder(env: Env, email: string, body: { art?: unknown; folder?: unknown }, rid = ""): Promise<[number, object]> {
  const me = email.toLowerCase(), art = String(body.art || "");
  const m = await mine(env, me, art); if (!m) return NOART;
  const folder = String(body.folder || "").split("/").map(p => p.replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean).join("/").slice(0, 120);
  if (folder) await ridBatch(env.DB, rid, [env.DB.prepare("INSERT INTO member_artfolder(owner, art, folder, at) VALUES (?, ?, ?, ?) ON CONFLICT(owner, art) DO UPDATE SET folder = excluded.folder, at = excluded.at").bind(me, art, folder, nowS())]);
  else await ridBatch(env.DB, rid, [env.DB.prepare("DELETE FROM member_artfolder WHERE owner = ? AND art = ?").bind(me, art)]);
  return [200, { ok: true, folder: folder || autoFolder(m) }];
}

/** /art/<id>/<나머지> 를 칸으로: 인코딩된 「/」 「\」 · . · .. 는 거절(null). 끝 「/」 는 남김(index.html) */
export function parseArt(pathname: string): { id: string; rel: string; bare: boolean } | null {
  const m = /^\/art\/([A-Za-z0-9]{16,40})(\/.*)?$/.exec(pathname); if (!m) return null;
  if (!m[2]) return { id: m[1], rel: "", bare: true };
  if (/%2f|%5c/i.test(m[2])) return null;
  let rel: string; try { rel = decodeURIComponent(m[2].slice(1)); } catch { return null; }
  if (rel && !okPath(rel.endsWith("/") ? rel.slice(0, -1) : rel)) return null;
  return { id: m[1], rel, bare: false };
}

async function sign(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", k, te.encode(msg))).slice(0, 16));
}
export async function token(secret: string, mk: string, id: string, exp = Date.now() + 2 * 3600_000) {
  return `m.${mk}.${exp}.${await sign(secret, `boarder-mart:${mk}:${id}:${exp}`)}`;
}
/** 표가 맞으면 그 회원 키, 아니면 null */
export async function tokenOk(secret: string, id: string, t: string | null) {
  const m = /^m\.([0-9a-f]{32})\.(\d{13})\.([0-9a-f]{32})$/.exec(t || ""); if (!m || +m[2] < Date.now()) return null;
  const want = await sign(secret, `boarder-mart:${m[1]}:${id}:${m[2]}`);
  let d = 0; for (let i = 0; i < 32; i++) d |= want.charCodeAt(i) ^ m[3].charCodeAt(i);
  return d === 0 ? m[1] : null;
}

export function mountMemberCanvas(app: Hono<{ Bindings: Env }>, h: CanvasHooks) {
  app.post("/api/me/canvas", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    if (+(c.req.header("content-length") || 0) > LIMITS.total + (1 << 20)) return c.json({ error: "너무 큼", max_bytes: LIMITS.total }, 413);
    let fd: FormData; try { fd = await c.req.formData(); } catch { return c.json({ error: "multipart 아님" }, 400); }
    let man: unknown; try { man = JSON.parse(String(fd.get("manifest") ?? "")); } catch { return c.json({ error: "manifest JSON 아님" }, 400); }
    if (!Array.isArray(man) || !man.length) return c.json({ error: "manifest = [{path}]" }, 400);
    if (man.length > LIMITS.files) return c.json({ error: "파일 수 상한", max_files: LIMITS.files }, 413);
    const paths = man.map(x => (x as { path?: unknown })?.path);
    const bad = paths.find(p => !okPath(p)); if (bad !== undefined) return c.json({ error: `경로: ${String(bad).slice(0, 80)}` }, 400);
    if (new Set(paths).size !== paths.length) return c.json({ error: "같은 경로가 둘" }, 400);
    const kd = kindOf(paths as string[]);
    if (kd.kind === "page" && !paths.includes("index.html")) return c.json({ error: "index.html 이 없어요" }, 400);
    const blobs: Blob[] = []; let total = 0;
    for (let i = 0; i < paths.length; i++) {
      const f = fd.get(`f${i}`);
      if (!f || typeof f === "string") return c.json({ error: `f${i} 파일이 없어요` }, 400);
      if (f.size > LIMITS.file) return c.json({ error: "파일 크기 상한", path: paths[i], max_file_bytes: LIMITS.file }, 413);
      total += f.size; if (total > LIMITS.total) return c.json({ error: "너무 큼", max_bytes: LIMITS.total }, 413);
      blobs.push(f);
    }
    const given = fd.get("id");
    if (given !== null && (typeof given !== "string" || !ID.test(given))) return c.json({ error: "id 는 영문 · 숫자 16–40자" }, 400);
    const mk = await keyOf(d.owner), id = (given as string | null) || newId();
    const old = await metaOf(c.env, mk, id);
    if (!old && (await all(c.env, mk)).length >= LIMITS.canvases) return c.json({ error: "캔버스 수 상한", max_canvases: LIMITS.canvases }, 429);
    const ver = newVer();
    // 파일은 Blob 그대로 R2 에(몸통을 한 번 더 복사하지 않음 — 25MB 묶음이 isolate 메모리를 두 배로 먹지 않게)
    for (let i = 0; i < paths.length; i += 20)
      await Promise.all(paths.slice(i, i + 20).map((p, j) => c.env.RESULTS.put(fileKey(mk, id, ver, p as string), blobs[i + j], { httpMetadata: { contentType: typeOf(p as string) } })));
    const idx = paths.indexOf("index.html"), cj = paths.indexOf(kd.cv ? `${kd.cv}/canvas.json` : "canvas.json");
    const cvTitle = async () => { try { return String(JSON.parse(await blobs[cj].slice(0, 2 << 20).text())?.title || "").slice(0, 80); } catch { return ""; } };   // 주인 _canvas_title 과 같음
    const title = clean(fd.get("title"), LIMITS.title) || clean(kd.kind === "canvas" ? await cvTitle() : "", LIMITS.title)
      || (idx >= 0 ? clean(titleOf(await blobs[idx].slice(0, 65536).text()), LIMITS.title) : "") || id;
    const acct = clean(fd.get("acct"), LIMITS.acct);
    const win = clean(fd.get("win"), 120), wid = clean(fd.get("wid"), 44);
    const meta: Meta = { title, acct, at: String(Math.floor(Date.now() / 1000)), ver, n: String(paths.length), bytes: String(total), kind: kd.kind, cv: kd.cv,
      ...(/^[\w@.:/+-]{2,120}$/.test(win) ? { win } : {}), ...(/^ew_[a-z0-9]{3,40}$/i.test(wid) ? { wid } : {}) };
    try { await c.env.RESULTS.put(marker(mk, id), JSON.stringify({ ...meta, files: paths }), { httpMetadata: { contentType: "application/json" }, customMetadata: meta }); }
    catch (e) { c.executionCtx.waitUntil(dropVer(c.env, mk, id, ver).catch(() => {})); throw e; }
    if (old && old.ver !== ver) c.executionCtx.waitUntil(dropVer(c.env, mk, id, old.ver).catch(() => {}));
    return c.json({ ok: true, id, ver, title, kind: kd.kind, files: paths.length, bytes: total, replaced: !!old, url: `${c.env.PUBLIC_URL || new URL(c.req.url).origin}/art/${id}/` });
  });
  app.get("/api/me/canvas", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const rows = (await all(c.env, await keyOf(d.owner))).sort((a, b) => Number(b.m.at) - Number(a.m.at));
    return c.json({ canvases: rows.map(({ id, m }) => ({ id, title: m.title, acct: m.acct || "", at: Number(m.at), files: Number(m.n), bytes: Number(m.bytes) })), max: LIMITS.canvases }, 200, { "cache-control": "no-store" });
  });
}
