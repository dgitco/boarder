import type { Context, Hono } from "hono";
import * as files from "./files";
import { ridBatch } from "./queue";
import * as uploads from "./direct-uploads";

type Env = uploads.DirectEnv & { RESULTS: R2Bucket; DB: D1Database; BETTER_AUTH_SECRET: string; PUBLIC_URL?: string; [k: string]: unknown };
type C = Context<{ Bindings: Env }>;
export type CanvasHooks = { device: (c: C) => Promise<{ id: string; owner: string } | null> };

export const LIMITS = { files: 200, file: 500 * 1024 * 1024, total: 500 * 1024 * 1024, canvases: 2000, path: 200, depth: 8, title: 200, acct: 80 };
export const LEGACY_LIMITS = { file: 10 << 20, total: 25 << 20 };
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
export function seoulAt(v: unknown): string {
  const s = String(v ?? ""); if (!/^\d{9,13}$/.test(s)) return s;
  const ms = s.length > 11 ? Number(s) : Number(s) * 1000, d = new Date(ms + 9 * 3600_000);
  return d.toISOString().slice(0, 16).replace("T", " ");
}
export async function list(env: Env, email: string) {
  const me = email.toLowerCase();
  const [rows, fr, nr, pr] = await Promise.all([all(env, await keyOf(email)),
    env.DB.prepare("SELECT art, folder FROM member_artfolder WHERE owner = ?").bind(me).all<{ art: string; folder: string }>(),
    env.DB.prepare("SELECT art, count(*) AS n FROM member_artnote WHERE owner = ? AND deleted_at IS NULL GROUP BY art").bind(me).all<{ art: string; n: number }>(),
    env.DB.prepare("SELECT art, pin, thumb FROM member_artpref WHERE owner = ?").bind(me).all<{ art: string; pin: number; thumb: string }>()]);
  const mv = new Map(fr.results.map(r => [r.art, r.folder])), cnt = new Map(nr.results.map(r => [r.art, Number(r.n)])), pref = new Map(pr.results.map(r => [r.art, r]));
  const out: Record<string, { kind: "page" | "canvas"; title: string; at: string; acct: string; folder: string; moved: boolean; notes: number; pin: boolean; thumb: string }> = {};
  for (const { id, m } of rows.sort((a, b) => Number(b.m.at) - Number(a.m.at)))
    out[id] = { kind: m.kind === "canvas" ? "canvas" : "page", title: m.title || id, at: seoulAt(m.at), acct: m.acct || "", folder: mv.get(id) || autoFolder(m), moved: mv.has(id), notes: cnt.get(id) || 0, pin: !!pref.get(id)?.pin, thumb: pref.get(id)?.thumb || "" };
  return out;
}

export type Got = { body: ReadableStream | Uint8Array; ct: string; html: boolean; shell?: boolean; status?: number; extra?: Record<string, string> };
async function blob(env: Env, key: string, guess: string, range?: string): Promise<Got | null> {
  if (!range) { const o = await env.RESULTS.get(key); return o ? { body: o.body, ct: o.httpMetadata?.contentType || guess, html: false } : null; }
  const hd = await env.RESULTS.head(key); if (!hd) return null;
  const r = files.byteRange(range, hd.size), ct = hd.httpMetadata?.contentType || guess;
  if (r === "bad") return { body: new Uint8Array(0), ct, html: false, status: 416, extra: { "content-range": `bytes */${hd.size}` } };
  const o = await env.RESULTS.get(key, r ? { range: { offset: r.a, length: r.z - r.a + 1 } } : undefined); if (!o) return null;
  return { body: o.body, ct, html: false, status: r ? 206 : 200, extra: { "accept-ranges": "bytes", ...(r ? { "content-range": `bytes ${r.a}-${r.z}/${hd.size}` } : {}) } };
}
const te2 = new TextEncoder(), td = new TextDecoder();
const JSON_LIMIT = 2 * 1024 * 1024;
async function canvasJson(env: Env, key: string): Promise<any> {
  const o = await env.RESULTS.get(key, { range: { offset: 0, length: JSON_LIMIT + 1 } });
  if (!o) return null;
  if (o.size > JSON_LIMIT) { await o.body?.cancel(); return null; }
  try { return JSON.parse(await o.text()); } catch { return null; }
}
// SHIM은 앞 64KiB에만 끼우고 나머지는 그대로 흘려 보낸다.
function shimStream(body: ReadableStream<Uint8Array>, shim: string): ReadableStream<Uint8Array> {
  const head = new Uint8Array(65536); let length = 0, injected = false;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (injected) { controller.enqueue(chunk); return; }
      const take = Math.min(head.length - length, chunk.length); head.set(chunk.subarray(0, take), length); length += take;
      if (length === head.length) {
        controller.enqueue(files.shim({ shim }, head)); injected = true;
        if (take < chunk.length) controller.enqueue(chunk.subarray(take));
      }
    },
    flush(controller) { if (!injected) controller.enqueue(files.shim({ shim }, head.subarray(0, length))); },
  }));
}
export async function file(env: Env, mk: string, id: string, rel: string, range?: string): Promise<Got | null> {
  if (!ID.test(id)) return null;
  const m = await metaOf(env, mk, id); if (!m) return null;
  if (rel === THUMB) {   // 목록 · 글 속 미리보기 그림(서버가 찍어 둠). 없으면 아래로 — 올린 파일 이름이 같으면 그것
    const o = await env.RESULTS.get(thumbKey(mk, id));
    if (o) return { body: o.body, ct: "image/jpeg", html: false, extra: { "cache-control": "private, max-age=300" } };
  }
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
      if (!isHtml(p)) { const g = await blob(env, fileKey(mk, id, m.ver, p), typeOf(p), range); if (g) return g; continue; }
      const o = await env.RESULTS.get(fileKey(mk, id, m.ver, p)); if (!o) continue;
      const ct = o.httpMetadata?.contentType || typeOf(p);
      const ix = await files.index(env).catch(() => null);
      return { body: ix?.shim ? shimStream(o.body, ix.shim) : o.body, ct, html: true };
    }
    return null;
  }
  const p = !rel || rel.endsWith("/") ? rel + "index.html" : rel;
  if (!okPath(p)) return null;
  if (!isHtml(p)) return blob(env, fileKey(mk, id, m.ver, p), typeOf(p), range);
  const o = await env.RESULTS.get(fileKey(mk, id, m.ver, p)); if (!o) return null;
  return { body: o.body, ct: o.httpMetadata?.contentType || typeOf(p), html: true };
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
  for (const p of [...new Set([m.cv ? `${m.cv}/${board}` : board, board, `project/${board}`])]) { if (okPath(p) && (o = await env.RESULTS.get(fileKey(mk, art, m.ver, p), { range: { offset: 0, length: 400_000 } }))) break; }
  if (!o) return null;
  let title = board;
  try { const cj = await canvasJson(env, fileKey(mk, art, m.ver, m.cv ? `${m.cv}/canvas.json` : "canvas.json")); const t = cj?.boards?.[board]?.title || ""; if (t) title = String(t); } catch {}
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

const prefSet = (db: D1Database, me: string, art: string, col: "pin" | "thumb", v: number | string) =>
  db.prepare(`INSERT INTO member_artpref(owner, art, ${col}, at) VALUES (?, ?, ?, ?) ON CONFLICT(owner, art) DO UPDATE SET ${col} = excluded.${col}, at = excluded.at`).bind(me, art, v, nowS());
/** POST /api/artstar {art, on} → [상태, {ok, pin}] — 목록 고정 별(주인 owner-write.ts artstar 와 같은 답) */
export async function artstar(env: Env, email: string, body: { art?: unknown; on?: unknown }, rid = ""): Promise<[number, object]> {
  const me = email.toLowerCase(), art = String(body.art || "");
  if (!(await mine(env, me, art))) return NOART;
  const on = body.on === true || body.on === 1 || body.on === "1" || body.on === "true";
  await ridBatch(env.DB, rid, [prefSet(env.DB, me, art, "pin", on ? 1 : 0)]);
  return [200, { ok: true, pin: on }];
}
export async function artthumb(env: Env, email: string, body: { art?: unknown; board?: unknown }, rid = ""): Promise<[number, object]> {
  const me = email.toLowerCase(), art = String(body.art || "");
  const m = await mine(env, me, art); if (!m || m.kind !== "canvas") return [404, { ok: false, error: "없는 캔버스" }];
  const board = String(body.board || "").slice(0, 200);
  if (board) {
    let boards: string[] = [];
    try { const b = (await canvasJson(env, fileKey(await keyOf(me), art, m.ver, m.cv ? `${m.cv}/canvas.json` : "canvas.json")))?.boards; if (b && typeof b === "object") boards = Object.keys(b); } catch {}
    if (!boards.includes(board)) return [400, { ok: false, error: "그 캔버스에 없는 판이에요" }];
  }
  await ridBatch(env.DB, rid, [prefSet(env.DB, me, art, "thumb", board)]);
  return [200, { ok: true, thumb: board }];
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

export const THUMB = "_thumb.jpg";
const thumbKey = (mk: string, id: string) => `mart/${mk}/${id}/${THUMB}`;
const THUMB_MAX = 400_000;
export const PAGE_BOARD = { board: "index.html", w: 1280, h: 800 };
export type ThumbJob = { art: string; mk: string; board: string; w: number; h: number; ver: string; pref: string; bxt: string };
export function thumbStale(have: { ver?: string; pref?: string; prefencoded?: string } | null, m: { ver: string }, pref: string) {
  let saved = have?.pref ?? "";
  if (have?.prefencoded === "1") { try { saved = decodeURIComponent(saved); } catch { return true; } }
  return !have || have.ver !== m.ver || saved !== pref;
}
/** 찍을 판: 지정(pref)이 canvas.json boards 에 있으면 그것, 아니면 order 맨 앞 → boards 맨 앞(canvas_thumb.pick 과 같은 차례) */
export function pickBoard(cj: { boards?: Record<string, { w?: number; h?: number }>; order?: unknown[]; thumb?: unknown }, pref: string) {
  const boards = cj.boards && typeof cj.boards === "object" ? cj.boards : {};
  for (const n of [pref, cj.thumb, ...(Array.isArray(cj.order) ? cj.order : []), ...Object.keys(boards)]) {
    if (typeof n === "string" && n in boards && !n.includes("/") && n.endsWith(".html")) return { board: n, w: Number(boards[n]?.w) || 1520, h: Number(boards[n]?.h) || 950 };
  }
  return null;
}
export const THUMB_SCAN = 200, THUMB_PAR = 25;
export async function thumbJobs(env: Env & { BETTER_AUTH_SECRET: string }, limit = 8, skip: Set<string> = new Set(), now = Date.now()): Promise<ThumbJob[]> {
  const out: ThumbJob[] = [];
  const mem = await env.DB.prepare("SELECT email FROM invite ORDER BY email").all<{ email: string }>();
  for (const { email } of mem.results) {
    if (out.length >= limit) break;
    const me = email.toLowerCase(), mk = await keyOf(me);
    const pr = await env.DB.prepare("SELECT art, thumb FROM member_artpref WHERE owner = ?").bind(me).all<{ art: string; thumb: string }>();
    const pref = new Map(pr.results.map(r => [r.art, r.thumb]));
    const sorted = (await all(env, mk)).sort((a, b) => Number(b.m.at) - Number(a.m.at)), N = sorted.length;
    const off = N > THUMB_SCAN ? (Math.floor(now / 120_000) * THUMB_SCAN) % N : 0;
    const inTurn = (i: number) => N > THUMB_SCAN && (i - off + N) % N < THUMB_SCAN;
    const rows = sorted.filter((r, i) => (i < THUMB_SCAN || inTurn(i) || pref.has(r.id)) && !skip.has(r.id));
    for (let i = 0; i < rows.length && out.length < limit; i += THUMB_PAR) {
      const part = rows.slice(i, i + THUMB_PAR), hs = await Promise.all(part.map(r => env.RESULTS.head(thumbKey(mk, r.id))));
      for (let k = 0; k < part.length; k++) {
        const { id, m } = part[k], h = hs[k];
        if (out.length >= limit) break;
        const isCv = m.kind === "canvas", want = isCv ? pref.get(id) || "" : "";
        if (!thumbStale(h?.customMetadata as { ver?: string; pref?: string; prefencoded?: string } | null ?? null, m, want)) continue;
        let cj: Parameters<typeof pickBoard>[0] = {};
        if (!isCv) { out.push({ art: id, mk, ...PAGE_BOARD, ver: m.ver, pref: "", bxt: await token(env.BETTER_AUTH_SECRET, mk, id, Date.now() + 15 * 60_000) }); continue; }
        try { cj = await canvasJson(env, fileKey(mk, id, m.ver, m.cv ? `${m.cv}/canvas.json` : "canvas.json")) || {}; } catch {}
        const pk = pickBoard(cj, want); if (!pk) continue;
        out.push({ art: id, mk, ...pk, ver: m.ver, pref: want, bxt: await token(env.BETTER_AUTH_SECRET, mk, id, Date.now() + 15 * 60_000) });
      }
    }
  }
  return out;
}
/** PUT /api/admin/mthumb/<mk>/<id>?ver=&pref= — 찍은 JPEG 저장. 표지가 없으면 404, 그 사이 새 판을 올렸으면(ver 다름) 409(버림 — 다음 일감에서 다시) */
export async function putThumb(env: Env, mk: string, id: string, body: ArrayBuffer, ver: string, pref: string): Promise<[number, object]> {
  if (!/^[0-9a-f]{32}$/.test(mk) || !ID.test(id)) return [404, { error: "없는 캔버스" }];
  const m = await metaOf(env, mk, id); if (!m) return [404, { error: "없는 캔버스" }];
  if (m.ver !== ver) return [409, { error: "그 사이 새 판을 올렸어요" }];
  const b = new Uint8Array(body);
  if (b.length < 2000 || b.length > THUMB_MAX || b[0] !== 0xff || b[1] !== 0xd8) return [400, { error: "JPEG 가 아니에요" }];
  await env.RESULTS.put(thumbKey(mk, id), b, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { ver, pref: pref.slice(0, 200) } });
  return [200, { ok: true }];
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

export async function remove(env: Env, email: string, id: string): Promise<[number, object]> {
  const me = email.toLowerCase();
  if (!ID.test(id)) return [404, { error: "없는 캔버스" }];
  const mk = await keyOf(email);
  if (!(await metaOf(env, mk, id))) return [404, { error: "없는 캔버스" }];
  let cursor: string | undefined, n = 0;
  do {
    const r = await env.RESULTS.list({ prefix: `mart/${mk}/${id}/`, limit: 1000, cursor });
    if (r.objects.length) { await env.RESULTS.delete(r.objects.map(o => o.key)); n += r.objects.length; }
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  await env.RESULTS.delete(marker(mk, id));   // 표지는 마지막 — 파일을 지우다 중간에 실패해도 표지가 남아 다시 rm 이 끝까지 지움(404 로 막히지 않게)
  await env.DB.batch([
    env.DB.prepare("UPDATE member_artnote SET deleted_at = ? WHERE owner = ? AND art = ? AND deleted_at IS NULL").bind(nowS(), me, id),
    env.DB.prepare("DELETE FROM member_artfolder WHERE owner = ? AND art = ?").bind(me, id),
    env.DB.prepare("DELETE FROM member_artpref WHERE owner = ? AND art = ?").bind(me, id),
  ]);
  return [200, { ok: true, id, files: n }];
}

const CONTROL_MAX = 256 * 1024;
const failUpload = (status: number, message: string) => Object.assign(new Error(message), { status });
type UploadPart = { id: string; size: number; partSize: number; parts: number };
type CanvasUpload = { mk: string; id: string; ver: string; previous: string; exp: number; meta: Meta; files: { path: string; size: number; upload: UploadPart }[] };

// 제어 요청은 JSON만 받으며 실제 파일 본문은 이 Worker에 들어오지 않음.
async function controlJson(c: C): Promise<Record<string, any>> {
  if (!/^application\/json(?:;|$)/i.test(c.req.header("content-type") || "")) throw failUpload(415, "JSON manifest로 직접 올려 주세요. boarder CLI를 갱신해 주세요");
  if (Number(c.req.header("content-length") || 0) > CONTROL_MAX) throw failUpload(413, "제어 요청이 너무 커요");
  const reader = c.req.raw.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
  if (!reader) throw failUpload(400, "JSON이 없어요");
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > CONTROL_MAX) { await reader.cancel(); throw failUpload(413, "제어 요청이 너무 커요"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body; try { body = JSON.parse(td.decode(bytes)); } catch { throw failUpload(400, "JSON 아님"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw failUpload(400, "JSON 객체가 필요해요");
  return body;
}
async function uploadToken(env: Env, batch: CanvasUpload): Promise<string> {
  const body = btoa(Array.from(te.encode(JSON.stringify(batch)), b => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${body}.${await sign(env.BETTER_AUTH_SECRET, `canvas-upload:${body}`)}`;
}
const batchKey = (batch: CanvasUpload) => `${batch.mk}/${batch.id}/${batch.ver}`;
async function batchState(env: Env, owner: string, batch: CanvasUpload) {
  const row = await env.DB.prepare("SELECT state FROM canvas_upload WHERE id = ? AND owner = ?").bind(batchKey(batch), owner).first<{ state: string }>();
  if (!row) throw failUpload(404, "없는 올리기 세션");
  return row.state;
}
async function uploadBatch(env: Env, owner: string, value: unknown): Promise<CanvasUpload> {
  if (typeof value !== "string" || value.length > CONTROL_MAX) throw failUpload(404, "없는 올리기 세션");
  const [body, sig, extra] = value.split(".");
  const wanted = await sign(env.BETTER_AUTH_SECRET, `canvas-upload:${body}`);
  let mismatch = sig?.length === wanted.length ? 0 : 1;
  for (let i = 0; i < wanted.length; i++) mismatch |= wanted.charCodeAt(i) ^ (sig?.charCodeAt(i) || 0);
  if (!body || !sig || extra || mismatch) throw failUpload(404, "없는 올리기 세션");
  let batch: CanvasUpload;
  try { batch = JSON.parse(td.decode(Uint8Array.from(atob(body.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)))); }
  catch { throw failUpload(404, "없는 올리기 세션"); }
  if (batch.mk !== await keyOf(owner) || batch.exp < Date.now()) throw failUpload(404, "없거나 만료된 올리기 세션");
  return batch;
}

/** 클라이언트가 종료돼 취소를 못 보내도 만료된 미게시 판을 정리한다. 진행 중인 요청은 15분 여유를 둔다. */
export async function sweepUploads(env: Env) {
  const expired = Date.now() - 15 * 60_000;
  // 게시·취소까지 끝난 묶음은 R2 정리가 필요 없으므로 한 번에 지운다.
  await env.DB.prepare("DELETE FROM canvas_upload WHERE expires < ? AND state IN ('done','aborted')").bind(expired).run();
  const rows = await env.DB.prepare("SELECT id, state FROM canvas_upload WHERE expires < ? AND state NOT IN ('done','aborted') ORDER BY expires, id LIMIT 20").bind(expired).all<{ id: string; state: string }>();
  for (const row of rows.results) {
    const key = /^([0-9a-f]{32})\/([A-Za-z0-9]{16,40})\/([a-z0-9]+)$/.exec(row.id);
    if (!key) continue;
    const [, mk, id, ver] = key;
    if (row.state !== "done" && (await metaOf(env, mk, id))?.ver !== ver) await dropVer(env, mk, id, ver);
    await env.DB.prepare("DELETE FROM canvas_upload WHERE id = ? AND expires < ?").bind(row.id, expired).run();
  }
}

// 이전 CLI의 multipart 계약만 구한도로 받는다. JSON 직접 전송의 한도를 넓히는 우회로 쓰지 않는다.
async function legacyForm(c: C) {
  let size = 0;
  if (!c.req.raw.body) throw failUpload(400, "multipart 아님");
  const capped = c.req.raw.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    size += chunk.length; if (size > LEGACY_LIMITS.total + (1 << 20)) throw failUpload(413, "이전 올리기 방식은 합 25MiB까지예요");
    controller.enqueue(chunk);
  } }));
  return new Response(capped, { headers: { "content-type": c.req.header("content-type") || "" } }).formData();
}
const legacyTitleOf = (html: string) => { const m = /<title[^>]*>([^<]{1,400})<\/title>/i.exec(html); return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : ""; };
async function legacyCanvas(c: C, owner: string) {
  if (+(c.req.header("content-length") || 0) > LEGACY_LIMITS.total + (1 << 20)) return c.json({ error: "너무 큼", max_bytes: LEGACY_LIMITS.total }, 413);
  let fd: FormData; try { fd = await legacyForm(c); } catch (e) { if ((e as { status?: number }).status === 413) throw e; return c.json({ error: "multipart 아님" }, 400); }
  let man: unknown; try { man = JSON.parse(String(fd.get("manifest") ?? "")); } catch { return c.json({ error: "manifest JSON 아님" }, 400); }
  if (!Array.isArray(man) || !man.length) return c.json({ error: "manifest = [{path}]" }, 400);
  if (man.length > LIMITS.files) return c.json({ error: "파일 수 상한", max_files: LIMITS.files }, 413);
  const paths = man.map(x => (x as { path?: unknown })?.path);
  if (paths.some(p => !okPath(p))) return c.json({ error: "올릴 수 없는 경로" }, 400);
  if (new Set(paths).size !== paths.length) return c.json({ error: "같은 경로가 둘" }, 400);
  const kd = kindOf(paths as string[]);
  if (kd.kind === "page" && !paths.includes("index.html")) return c.json({ error: "index.html 이 없어요" }, 400);
  const blobs: Blob[] = []; let total = 0;
  for (let i = 0; i < paths.length; i++) {
    const f = fd.get(`f${i}`);
    if (!f || typeof f === "string") return c.json({ error: `f${i} 파일이 없어요` }, 400);
    if (f.size > LEGACY_LIMITS.file) return c.json({ error: "파일 크기 상한", path: paths[i], max_file_bytes: LEGACY_LIMITS.file }, 413);
    total += f.size; if (total > LEGACY_LIMITS.total) return c.json({ error: "너무 큼", max_bytes: LEGACY_LIMITS.total }, 413);
    blobs.push(f);
  }
  const given = fd.get("id");
  if (given !== null && (typeof given !== "string" || !ID.test(given))) return c.json({ error: "id 는 영문 · 숫자 16–40자" }, 400);
  const mk = await keyOf(owner), id = (given as string | null) || newId();
  const oldHead = await c.env.RESULTS.head(marker(mk, id)), old = oldHead?.customMetadata?.ver ? oldHead.customMetadata as unknown as Meta : null;
  if (!old && (await all(c.env, mk)).length >= LIMITS.canvases) return c.json({ error: "캔버스 수 상한", max_canvases: LIMITS.canvases }, 429);
  const ver = newVer();
  try {
    // 구형 CLI만 10MiB/파일·25MiB/묶음 안에서 Worker로 받는다.
    for (let i = 0; i < paths.length; i += 20) {
      const written = await Promise.allSettled(paths.slice(i, i + 20).map((p, j) => c.env.RESULTS.put(fileKey(mk, id, ver, p as string), blobs[i + j], { httpMetadata: { contentType: typeOf(p as string) } })));
      const failed = written.find(result => result.status === "rejected"); if (failed?.status === "rejected") throw failed.reason;
    }
    const idx = paths.indexOf("index.html"), cj = paths.indexOf(kd.cv ? `${kd.cv}/canvas.json` : "canvas.json");
    const cvTitle = async () => { try { return String(JSON.parse(await blobs[cj].slice(0, 2 << 20).text())?.title || "").slice(0, 80); } catch { return ""; } };   // 주인 _canvas_title 과 같음
    const title = clean(fd.get("title"), LIMITS.title) || clean(kd.kind === "canvas" ? await cvTitle() : "", LIMITS.title)
      || (idx >= 0 ? clean(legacyTitleOf(await blobs[idx].slice(0, 65536).text()), LIMITS.title) : "") || id;
    const acct = clean(fd.get("acct"), LIMITS.acct);
    const win = clean(fd.get("win"), 120), wid = clean(fd.get("wid"), 44);
    const meta: Meta = { title, acct, at: String(Math.floor(Date.now() / 1000)), ver, n: String(paths.length), bytes: String(total), kind: kd.kind, cv: kd.cv,
      ...(/^[\w@.:/+-]{2,120}$/.test(win) ? { win } : {}), ...(/^ew_[a-z0-9]{3,40}$/i.test(wid) ? { wid } : {}) };
    const written = await c.env.RESULTS.put(marker(mk, id), JSON.stringify({ ...meta, files: paths }), { httpMetadata: { contentType: "application/json" }, customMetadata: meta,
      onlyIf: oldHead ? { etagMatches: oldHead.etag } : { etagDoesNotMatch: "*" } });
    if (!written) throw failUpload(409, "그 사이 다른 판을 올렸어요. 다시 올려 주세요");
    if (old && old.ver !== ver) c.executionCtx.waitUntil(dropVer(c.env, mk, id, old.ver).catch(() => {}));
    return c.json({ ok: true, id, ver, title, kind: kd.kind, files: paths.length, bytes: total, replaced: !!old, url: `${c.env.PUBLIC_URL || new URL(c.req.url).origin}/art/${id}/` });
  } catch (e) { c.executionCtx.waitUntil(dropVer(c.env, mk, id, ver).catch(() => {})); throw e; }
}

export function mountMemberCanvas(app: Hono<{ Bindings: Env }>, h: CanvasHooks) {
  const control = (route: string, handle: (c: C, owner: string, body: Record<string, any>) => Promise<object>) => {
    app.post(route, async c => {
      const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
      try {
        if (route === "/api/me/canvas" && /^multipart\/form-data(?:;|$)/i.test(c.req.header("content-type") || "")) {
          c.header("Deprecation", "true"); return await legacyCanvas(c, d.owner);
        }
        return c.json(await handle(c, d.owner, await controlJson(c)));
      }
      catch (e) {
        const err = (route === "/api/me/canvas" ? uploads.initializationError(e) : e) as Error & { status?: number; code?: string };
        if (err.status === 503 && err.code === "direct_upload_unavailable") return c.json({ error: err.message, code: err.code }, 503);
        if (err.status && err.status >= 400 && err.status < 500) return c.json({ error: err.message }, err.status as 400);
        throw e;
      }
    });
  };
  control("/api/me/canvas", async (c, owner, body) => {
    const man = body.manifest;
    if (!Array.isArray(man) || !man.length) throw failUpload(400, "manifest = [{path,size}]");
    if (man.length > LIMITS.files) throw failUpload(413, "파일 수 상한");
    const paths = man.map(x => x?.path);
    if (paths.some(p => !okPath(p))) throw failUpload(400, "올릴 수 없는 경로");
    if (new Set(paths).size !== paths.length) throw failUpload(400, "같은 경로가 둘");
    const kd = kindOf(paths);
    if (kd.kind === "page" && !paths.includes("index.html")) throw failUpload(400, "index.html 이 없어요");
    let total = 0;
    for (const f of man) {
      if (!Number.isSafeInteger(f.size) || f.size < 0) throw failUpload(400, "파일 크기가 올바르지 않아요");
      if (f.size > LIMITS.file || (total += f.size) > LIMITS.total) throw failUpload(413, "500MiB 크기 상한(524288000바이트)");
    }
    if (body.id !== undefined && (typeof body.id !== "string" || !ID.test(body.id))) throw failUpload(400, "id 는 영문 · 숫자 16–40자");
    const mk = await keyOf(owner), id = body.id || newId(), old = await metaOf(c.env, mk, id);
    if (!old && (await all(c.env, mk)).length >= LIMITS.canvases) throw failUpload(429, "캔버스 수 상한");
    const ver = newVer(), win = clean(body.win, 120), wid = clean(body.wid, 44);
    const meta: Meta = { title: clean(body.title, LIMITS.title) || id, acct: clean(body.acct, LIMITS.acct), at: String(Math.floor(Date.now() / 1000)), ver,
      n: String(paths.length), bytes: String(total), kind: kd.kind, cv: kd.cv,
      ...(/^[\w@.:/+-]{2,120}$/.test(win) ? { win } : {}), ...(/^ew_[a-z0-9]{3,40}$/i.test(wid) ? { wid } : {}) };
    const started: { path: string; size: number; upload: UploadPart }[] = [];
    try {
      // 실패 시 이미 시작한 multipart들도 정리한 뒤 오류를 돌려줌.
      for (let i = 0; i < man.length; i += 10) {
        const group = await Promise.allSettled(man.slice(i, i + 10).map(async f => ({ path: f.path, size: f.size, upload: await uploads.begin(c.env, owner, {
          target: fileKey(mk, id, ver, f.path), size: f.size, mime: typeOf(f.path), metadata: { canvas: id, version: ver },
        }) })));
        for (const r of group) if (r.status === "fulfilled") started.push(r.value);
        const failed = group.find(r => r.status === "rejected"); if (failed?.status === "rejected") throw failed.reason;
      }
      const batch: CanvasUpload = { mk, id, ver, previous: old?.ver || "", exp: Date.now() + 60 * 60_000, meta, files: started };
      const session = await uploadToken(c.env, batch);
      await c.env.DB.prepare("INSERT INTO canvas_upload(id,owner,state,expires) VALUES (?,?,'open',?)").bind(batchKey(batch), owner, batch.exp).run();
      return { ok: true, id, ver, session, uploads: started.map(f => f.upload) };
    } catch (e) { await Promise.allSettled(started.map(f => uploads.abort(c.env, owner, f.upload.id))); throw e; }
  });
  for (const action of ["part", "complete", "abort"] as const) control(`/api/me/canvas/upload/${action}`, async (c, owner, body) => {
    const batch = await uploadBatch(c.env, owner, body.session), f = batch.files[body.index];
    if (await batchState(c.env, owner, batch) !== "open") throw failUpload(409, "이미 마쳤거나 취소한 올리기");
    if (!Number.isInteger(body.index) || !f || f.upload.id !== body.id) throw failUpload(404, "없는 올리기 파일");
    if (action === "part") return uploads.part(c.env, owner, body.id, body.number);
    if (action === "complete") return uploads.complete(c.env, owner, body.id, body.parts);
    await uploads.abort(c.env, owner, body.id); return { ok: true };
  });
  const published = (c: C, batch: CanvasUpload, replaced: boolean) => ({ ok: true, id: batch.id, ver: batch.ver, title: batch.meta.title, kind: batch.meta.kind,
    files: batch.files.length, bytes: Number(batch.meta.bytes), replaced, url: `${c.env.PUBLIC_URL || new URL(c.req.url).origin}/art/${batch.id}/` });
  control("/api/me/canvas/publish", async (c, owner, body) => {
    const batch = await uploadBatch(c.env, owner, body.session), { mk, id, ver, meta } = batch;
    // 표지는 썼지만 완료 영수증 전에 요청이 종료된 경우 응답만 복구한다.
    if ((await metaOf(c.env, mk, id))?.ver === ver) {
      await c.env.DB.prepare("UPDATE canvas_upload SET state = 'done', locked_at = NULL WHERE id = ? AND owner = ?").bind(batchKey(batch), owner).run();
      return published(c, batch, !!batch.previous);
    }
    if (await batchState(c.env, owner, batch) === "done") throw failUpload(409, "그 사이 다른 판을 올렸어요");
    const lease = Date.now();
    const lock = await c.env.DB.prepare("UPDATE canvas_upload SET state = 'publishing', locked_at = ? WHERE id = ? AND owner = ? AND (state = 'open' OR (state = 'publishing' AND locked_at < ?)) RETURNING id").bind(lease, batchKey(batch), owner, lease - 5 * 60_000).first();
    if (!lock) throw failUpload(409, "이미 마쳤거나 취소 중인 올리기");
    try {
      const oldHead = await c.env.RESULTS.head(marker(mk, id)), old = oldHead?.customMetadata?.ver ? oldHead.customMetadata as unknown as Meta : null;
      if ((old?.ver || "") !== batch.previous && old?.ver !== ver) throw failUpload(409, "그 사이 다른 판을 올렸어요. 다시 올려 주세요");
      // 전송이 끝난 파일의 크기를 HEAD로 확인한 뒤 표지를 한 번만 바꿈. 본문을 읽지 않음.
      for (let i = 0; i < batch.files.length; i += 20) await Promise.all(batch.files.slice(i, i + 20).map(async f => {
        const o = await c.env.RESULTS.head(fileKey(mk, id, ver, f.path));
        if (!o || o.size !== f.size || o.customMetadata?.canvas !== id || o.customMetadata?.version !== ver) throw failUpload(409, "아직 올리지 못한 파일이 있어요");
      }));
      if (!old && (await all(c.env, mk)).length >= LIMITS.canvases) throw failUpload(429, "캔버스 수 상한");
      const written = await c.env.RESULTS.put(marker(mk, id), JSON.stringify({ ...meta, files: batch.files.map(f => f.path) }), { httpMetadata: { contentType: "application/json" }, customMetadata: meta,
        onlyIf: oldHead ? { etagMatches: oldHead.etag } : { etagDoesNotMatch: "*" } });
      if (!written) throw failUpload(409, "그 사이 다른 판을 올렸어요. 다시 올려 주세요");
      await c.env.DB.prepare("UPDATE canvas_upload SET state = 'done', locked_at = NULL WHERE id = ? AND owner = ? AND locked_at = ?").bind(batchKey(batch), owner, lease).run();
      if (old && old.ver !== ver) c.executionCtx.waitUntil(dropVer(c.env, mk, id, old.ver).catch(() => {}));
      return published(c, batch, !!batch.previous);
    } catch (e) {
      await c.env.DB.prepare("UPDATE canvas_upload SET state = 'open', locked_at = NULL WHERE id = ? AND owner = ? AND state = 'publishing' AND locked_at = ?").bind(batchKey(batch), owner, lease).run();
      throw e;
    }
  });
  control("/api/me/canvas/abort", async (c, owner, body) => {
    const batch = await uploadBatch(c.env, owner, body.session), state = await batchState(c.env, owner, batch);
    if (state === "done" || state === "aborted") return { ok: true };
    const lease = Date.now();
    const lock = await c.env.DB.prepare("UPDATE canvas_upload SET state = 'aborting', locked_at = ? WHERE id = ? AND owner = ? AND (state = 'open' OR (state = 'aborting' AND locked_at < ?)) RETURNING id").bind(lease, batchKey(batch), owner, lease - 5 * 60_000).first();
    if (!lock) throw failUpload(409, "게시 또는 취소를 확인 중이에요");
    try {
      const results = await Promise.allSettled(batch.files.map(f => uploads.abort(c.env, owner, f.upload.id)));
      const failed = results.find(r => r.status === "rejected"); if (failed?.status === "rejected") throw failed.reason;
      const sessions = await Promise.all(batch.files.map(f => uploads.getSession(c.env, owner, f.upload.id)));
      if (sessions.some(s => s.state === "completing")) throw failUpload(409, "파일 등록이 끝나면 정리를 다시 시도해 주세요");
      const old = await metaOf(c.env, batch.mk, batch.id);
      if (old?.ver !== batch.ver) await dropVer(c.env, batch.mk, batch.id, batch.ver);
      await c.env.DB.prepare("UPDATE canvas_upload SET state = 'aborted', locked_at = NULL WHERE id = ? AND owner = ? AND locked_at = ?").bind(batchKey(batch), owner, lease).run();
      return { ok: true };
    } catch (e) {
      await c.env.DB.prepare("UPDATE canvas_upload SET state = 'open', locked_at = NULL WHERE id = ? AND owner = ? AND state = 'aborting' AND locked_at = ?").bind(batchKey(batch), owner, lease).run();
      throw e;
    }
  });
  app.get("/api/me/canvas", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const rows = (await all(c.env, await keyOf(d.owner))).sort((a, b) => Number(b.m.at) - Number(a.m.at));
    return c.json({ canvases: rows.map(({ id, m }) => ({ id, title: m.title, acct: m.acct || "", at: Number(m.at), files: Number(m.n), bytes: Number(m.bytes) })), max: LIMITS.canvases }, 200, { "cache-control": "no-store" });
  });
  app.delete("/api/me/canvas/:id", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const [st, body] = await remove(c.env, d.owner, c.req.param("id"));
    return c.json(body, st as 200 | 404);
  });
}
