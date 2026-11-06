// 회원 쓰기 칸 파일 · 받아쓰기 — 보드 틀(page)이 부르는 /api/upload · /api/file/:id · /api/voice/stt 를 회원 길로(틀은 그대로).
// 예전 회원 길: 올리기 · 받아쓰기는 JSON 이 아니라 「bad json」(400), 파일 붙은 글은 「아직 안 돼요」, 파일 보기는 403.
// 저장: R2 mfiles/<id>(customMetadata owner = 회원 메일). 보기는 올린 사람만. 창(에이전트)에는 7일 서명 링크 줄(/f/<id>)로 — 로그인 없이 curl 로 받게
import type { Context } from "hono";
import * as direct from "./direct-uploads";

type Env = direct.DirectEnv & { DB: D1Database; RESULTS: R2Bucket; AI: { run(model: string, input: unknown): Promise<unknown> }; BETTER_AUTH_SECRET: string; PUBLIC_URL?: string };
type C = Context<{ Bindings: Env }>;

export const LEGACY_FILE_MAX = 20 * 1024 * 1024;
export const FILE_MAX = direct.MAX_FILE, VOICE_MAX = 3 * 1024 * 1024, LINK_DAYS = 7, FILES_PER_MSG = 10;
const FID = /^[0-9a-f]{32}$/, RISKY = /html|svg|xml|javascript|ecmascript/i;
export const DAY_FILES = 200, DAY_FILE_BYTES = 500 * 1024 * 1024, DAY_STT = 300;
/** 하루 칸(user_pref k = q:<칸>:<날짜>, v = {"n":개수,"b":바이트})에 한 번 더 셈 — 상한을 넘으면 세지 않고 false. 한 문장(UPSERT … WHERE … RETURNING)이라 동시에 와도 넘지 않음 */
export async function quotaTake(db: D1Database, me: string, kind: string, bytes: number, maxN: number, maxB: number, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10), k = `q:${kind}:${day}`;
  if (bytes > maxB || maxN < 1) return false;
  const r = await db.prepare(`INSERT INTO user_pref(owner, k, v, at) VALUES (?, ?, json_object('n', 1, 'b', ?), ?)
    ON CONFLICT(owner, k) DO UPDATE SET v = json_object('n', json_extract(user_pref.v, '$.n') + 1, 'b', json_extract(user_pref.v, '$.b') + json_extract(excluded.v, '$.b')), at = excluded.at
    WHERE json_extract(user_pref.v, '$.n') + 1 <= ? AND json_extract(user_pref.v, '$.b') + json_extract(excluded.v, '$.b') <= ?
    RETURNING v`).bind(me, k, bytes, now, maxN, maxB).first<{ v: string }>();
  if (r && Math.random() < 0.05) await db.prepare("DELETE FROM user_pref WHERE owner = ? AND k LIKE 'q:%' AND at < ?").bind(me, now - 3 * 86_400_000).run().catch(() => {});   // 지난 날 칸 치우기
  return !!r;
}
/** 올리기 한도에서 방금 센 한 번을 돌려줌(R2 에 못 넣었을 때 — 다시 보내면 한도를 한 번 더 세지 않게). 못 돌려줘도 던지지 않음 */
export async function quotaGive(db: D1Database, me: string, kind: string, bytes: number, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  await db.prepare(`UPDATE user_pref SET v = json_object('n', max(0, json_extract(v, '$.n') - 1), 'b', max(0, json_extract(v, '$.b') - ?)) WHERE owner = ? AND k = ?`).bind(bytes, me, `q:${kind}:${day}`).run().catch(() => {});
}
export async function readCapped(req: Request, max: number): Promise<Uint8Array | "big" | null> {
  if (+(req.headers.get("content-length") || 0) > max) return "big";
  if (!req.body) return new Uint8Array(0);
  const rd = req.body.getReader(), parts: Uint8Array[] = []; let n = 0;
  try {
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      n += value.byteLength;
      if (n > max) { await rd.cancel().catch(() => {}); return "big"; }
      parts.push(value);
    }
  } catch { return null; }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}
const tooMany = (c: C, what: string) => c.json({ ok: false, error: `오늘 ${what} 한도를 넘었어요 — 내일 다시 해요` }, 429, { "retry-after": "3600" });
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function sign(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))).slice(0, 32);
}
/** 서명 링크 /f/<id>?e=<만료 초>&t=<서명> — 7일. 서명 글 앞에 「mfile|」(다른 서명과 섞이지 않게) */
export async function fileLink(secret: string, base: string, id: string, now = Date.now()) {
  const e = Math.floor(now / 1000) + LINK_DAYS * 86400;
  return `${base.replace(/\/+$/, "")}/f/${id}?e=${e}&t=${await sign(secret, `mfile|${id}|${e}`)}`;
}
export async function linkOk(secret: string, id: string, e: string, t: string, now = Date.now()) {
  if (!FID.test(id) || !/^\d{9,11}$/.test(e) || Number(e) * 1000 < now || !/^[0-9a-f]{32}$/.test(t)) return false;
  const want = await sign(secret, `mfile|${id}|${e}`); let d = 0; for (let i = 0; i < 32; i++) d |= want.charCodeAt(i) ^ t.charCodeAt(i); return d === 0;
}
// 받을 때 머리: 화면에 띄우면 위험한 꼴(HTML · SVG · XML · 스크립트)은 내려받기로 + sandbox
// PDF 만 예외로 브라우저 내장 보기에 띄움(sandbox 는 크롬 PDF 보기를 막음): 맨 앞이 %PDF- 인 것만, 형식은 application/pdf 로 못박고 nosniff · frame-ancestors 'self'
const rfc5987 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
/** Content-Disposition: ASCII 대체 이름 + filename*=UTF-8''(RFC 5987) — 한글 이름도 그대로 내려받음 */
export function disposition(kind: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%]/g, "_") || "file";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${rfc5987(name)}`;
}
const isPdf = (type: string, name: string, buf: Uint8Array) =>
  buf.length >= 5 && String.fromCharCode(...buf.subarray(0, 5)) === "%PDF-" && (/^application\/pdf\b/i.test(type) || (/octet-stream/i.test(type) && /\.pdf$/i.test(name)));
async function headers(o: R2ObjectBody, dl: boolean, sample?: Uint8Array): Promise<{ h: Headers; body: BodyInit }> {
  const h = new Headers({ "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "sandbox" }); o.writeHttpMetadata(h);
  const name = fileName(o), type = h.get("content-type") || "";
  let body: BodyInit = o.body;
  if (!dl && (/^application\/pdf\b/i.test(type) || (/octet-stream/i.test(type) && /\.pdf$/i.test(name)))) {
    const buf = sample || new Uint8Array();
    if (isPdf(type, name, buf)) {
      h.set("content-type", "application/pdf"); h.set("content-disposition", disposition("inline", name));
      h.set("content-security-policy", "frame-ancestors 'self'"); return { h, body };
    }
  }
  const risky = RISKY.test(type);
  if (risky) h.set("content-type", "application/octet-stream");
  h.set("content-disposition", disposition(dl || risky || /^application\/pdf\b/i.test(type) ? "attachment" : "inline", name));
  return { h, body };
}

/** 올리는 사람 + 첨부 열쇠 → 32자리 16진 파일 id(같은 열쇠 = 같은 id) */
async function keyedId(me: string, key: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mfile|${me}|${key}`)));
  return [...d.slice(0, 16)].map(b => b.toString(16).padStart(2, "0")).join("");
}
/** POST /api/upload[/part|complete|abort] — JSON 제어만. 본문은 서명한 R2 주소로 간다. */
export async function upload(c: C, me: string) {
  if (new URL(c.req.url).pathname === "/api/upload") return legacyUpload(c, me);
  if (!(c.req.header("content-type") || "").includes("application/json")) return c.json({ ok: false, error: "직접 올리기 제어 JSON이 필요해요" }, 415);
  const raw = await readCapped(c.req.raw, 16 * 1024);
  if (raw === "big") return c.json({ ok: false, error: "제어 요청이 너무 커요" }, 413);
  let b: any; try { b = JSON.parse(new TextDecoder().decode(raw || new Uint8Array())); } catch { return c.json({ ok: false, error: "bad json" }, 400); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ ok: false, error: "bad json" }, 400);
  const action = new URL(c.req.url).pathname.split("/")[3] || "init", owner = `file:${me}`;
  const out = (id: string, name: string, size: number, mime: string) => ({ ok: true, id, name, size, mime });
  try {
    if (action === "init") {
      direct.checkSize(b.size); if (!b.size) throw direct.uploadError(400, "파일이 비었어요");
      const key = String(b.key || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
      const id = key ? await keyedId(me, key) : crypto.randomUUID().replace(/-/g, "");
      const old = await c.env.RESULTS.head(`mfiles/${id}`);
      if (old && fileOwner(old) === me) return c.json({ ...out(id, fileName(old), old.size, old.httpMetadata?.contentType || "application/octet-stream"), done: true });
      const name = String(b.name || "file").replace(/[\x00-\x1f\x7f"\\/]/g, "_").trim().slice(0, 120) || "file";
      const mime = String(b.mime || "application/octet-stream").slice(0, 100);
      if (/[\r\n]/.test(mime)) throw direct.uploadError(400, "잘못된 파일 형식");
      const session = await direct.begin(c.env, owner, { target: `mfiles/${id}`, size: b.size, mime, metadata: { owner: encodeURIComponent(me), owner_encoding: "uri", name: encodeURIComponent(name), name_encoding: "uri" } });
      try {
        const state = await quotaUpload(c.env.DB, me, session.id, b.size);
        if (state !== "uploading") {
          const final = state === "done" ? await c.env.RESULTS.head(`mfiles/${id}`) : null;
          if (final && fileOwner(final) === me) return c.json({ ...out(id, fileName(final), final.size, final.httpMetadata?.contentType || mime), done: true });
          throw direct.uploadError(409, "이미 마쳤거나 취소한 올리기예요");
        }
      }
      catch (e) { await direct.abort(c.env, owner, session.id).catch(() => {}); throw e; }
      return c.json({ ok: true, ...session });
    }
    const session = await direct.getSession(c.env, owner, String(b.id || ""));
    if (!/^mfiles\/[0-9a-f]{32}$/.test(session.target)) throw direct.uploadError(404, "없는 올리기");
    if (action === "part") return c.json({ ok: true, ...await direct.part(c.env, owner, b.id, b.number) });
    if (action === "abort") { await direct.abort(c.env, owner, b.id); return c.json({ ok: true }); }
    if (action !== "complete") return c.json({ ok: false, error: "없는 제어" }, 404);
    await direct.complete(c.env, owner, b.id, b.parts, async () => {
      await quotaUpload(c.env.DB, me, b.id, session.size);
    });
    return c.json(out(session.target.slice(7), decodeURIComponent(session.metadata.name), session.size, session.mime));
  } catch (e) { if (action === "init") e = direct.initializationError(e); return c.json({ ok: false, error: (e as Error).message, code: (e as {code?: string}).code }, ((e as { status?: number }).status || 503) as 400); }
}
async function legacyUpload(c: C, me: string) {
  c.header("Deprecation", "true");
  const key = (c.req.header("x-upload-key") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const kid = key ? await keyedId(me, key) : "";
  if (kid) {
    const o = await c.env.RESULTS.head(`mfiles/${kid}`).catch(() => null);
    if (o && fileOwner(o) === me) return c.json({ ok: true, id: kid, name: fileName(o), size: o.size, mime: o.httpMetadata?.contentType || "application/octet-stream" });
  }
  const buf = await readCapped(c.req.raw, LEGACY_FILE_MAX);
  if (buf === "big") return c.json({ ok: false, error: "20MB 까지예요" }, 413);
  if (!buf || !buf.byteLength) return c.json({ ok: false, error: "파일이 비었어요" }, 400);
  const q = await quotaTake(c.env.DB, me, "mfiles", buf.byteLength, DAY_FILES, DAY_FILE_BYTES).catch(() => null);
  if (q !== true) return q === null ? c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503) : tooMany(c, "올리기");   // 셈을 못 하면 받지 않음(기본 거부)
  let name = "file"; try { name = decodeURIComponent(c.req.header("x-file-name") || "file"); } catch {}
  name = name.replace(/[\x00-\x1f\x7f"\\/]/g, "_").trim().slice(0, 120) || "file";
  const type = (c.req.header("content-type") || "application/octet-stream").slice(0, 100), id = kid || crypto.randomUUID().replace(/-/g, "");
  try { await c.env.RESULTS.put(`mfiles/${id}`, buf, { httpMetadata: { contentType: type, contentDisposition: disposition("inline", name) }, customMetadata: { owner: encodeURIComponent(me), owner_encoding: "uri", name: encodeURIComponent(name), name_encoding: "uri" } }); }
  catch (e) { await quotaGive(c.env.DB, me, "mfiles", buf.byteLength); console.error("올리기 R2", e); return c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503, { "x-retry-safe": "1" }); }   // 못 넣었음 — 한도는 돌려주고 다시 보내도 되는 503
  return c.json({ ok: true, id, name, size: buf.byteLength, mime: type });
}

// 배치의 변경 개수와 세션 영수증을 함께 기록한다. 완료 응답을 잃어도 하루 한도는 한 번만 센다.
async function quotaUpload(db: D1Database, me: string, id: string, size: number) {
  const day = new Date().toISOString().slice(0, 10), k = `q:mfiles:${day}`;
  const results = await db.batch([
    db.prepare(`INSERT INTO user_pref(owner,k,v,at)
      SELECT ?,?,json_object('n',1,'b',?),? WHERE EXISTS(SELECT 1 FROM direct_upload WHERE id=? AND charged_day IS NULL AND state='uploading')
      ON CONFLICT(owner,k) DO UPDATE SET v=json_object('n',json_extract(user_pref.v,'$.n')+1,'b',json_extract(user_pref.v,'$.b')+?),at=excluded.at
      WHERE EXISTS(SELECT 1 FROM direct_upload WHERE id=? AND charged_day IS NULL AND state='uploading')
      AND json_extract(user_pref.v,'$.n') < ? AND json_extract(user_pref.v,'$.b')+? <= ?`)
      .bind(me, k, size, Date.now(), id, size, id, DAY_FILES, size, DAY_FILE_BYTES),
    db.prepare("UPDATE direct_upload SET charged_day=? WHERE id=? AND charged_day IS NULL AND state='uploading' AND changes()=1").bind(day, id),
    db.prepare('SELECT charged_day,state FROM direct_upload WHERE id=?').bind(id),
  ]);
  const receipt = results[2].results[0] as { charged_day?: string; state?: string } | undefined;
  if (!receipt || !["uploading", "completing", "done"].includes(receipt.state || "")) throw direct.uploadError(409, "이미 취소한 올리기예요");
  if (!receipt.charged_day) throw direct.uploadError(429, "오늘 올리기 한도를 넘었어요");
  return receipt.state;
}
function fileOwner(o: { customMetadata?: Record<string,string> }) {
  const owner = o.customMetadata?.owner || "";
  if (o.customMetadata?.owner_encoding === "uri") try { return decodeURIComponent(owner); } catch { return ""; }
  return owner;
}
function fileName(o: { customMetadata?: Record<string, string> }) {
  const n = o.customMetadata?.name || "file";
  if (o.customMetadata?.name_encoding === "uri") try { return decodeURIComponent(n); } catch {}
  return n;
}
/** GET /api/file/:id — 올린 사람만(남의 것은 없는 것과 같게 404). ?dl = 내려받기 */
export async function fileGet(c: C, me: string | readonly string[], id: string, dl: boolean) {   // me = 올린 사람 하나, 또는 같은 사람의 메일 여럿(owner_unified 로 회원 길에 든 주인 — 메일 넷)
  if (!FID.test(id)) return c.json({ error: "없는 파일" }, 404);
  return cachedServe(c, id, dl, owner => typeof me === "string" ? owner === me : me.includes(owner), () => c.json({ error: "없는 파일" }, 404));
}
export async function signedGet(c: C, id: string) {
  if (!(await linkOk(c.env.BETTER_AUTH_SECRET, id, c.req.query("e") || "", c.req.query("t") || ""))) return c.text("link expired or invalid\n", 403);
  return cachedServe(c, id, false, () => true, () => c.text("not found\n", 404));
}
async function cachedServe(c: C, id: string, dl: boolean, allow: (owner: string) => boolean, nf: () => Response) {
  const key = new Request(new URL(`/f/${id}${dl ? "?dl" : ""}`, c.req.url).toString()), cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const hit = await cache?.match(key).catch(() => undefined);
  const own = hit?.headers.get("x-bx-owner");
  if (hit && own !== null && own !== undefined) {
    let o0 = ""; try { o0 = decodeURIComponent(own); } catch { return nf(); }
    if (!allow(o0)) return nf();
    const h = new Headers(hit.headers); h.delete("x-bx-owner"); h.set("cache-control", "private, max-age=300"); h.set("x-bx-cache", "hit");
    return new Response(hit.body, { status: hit.status, headers: h });
  }
  const o = await c.env.RESULTS.get(`mfiles/${id}`);
  if (!o) return nf();
  const owner = fileOwner(o);
  if (!allow(owner)) return nf();
  let sample: Uint8Array | undefined;
  if (!dl && (/^application\/pdf\b/i.test(o.httpMetadata?.contentType || "") || /\.pdf$/i.test(fileName(o)))) {
    const first = await c.env.RESULTS.get(`mfiles/${id}`, { range: { offset: 0, length: 5 } });
    if (first) sample = new Uint8Array(await first.arrayBuffer());
  }
  const r = await headers(o, dl, sample), res = new Response(r.body, { headers: r.h });
  let ctx: { waitUntil(p: Promise<unknown>): void } | undefined; try { ctx = (c as unknown as { executionCtx: typeof ctx }).executionCtx; } catch { /* ctx 없는 시험 */ }
  if (cache && ctx && c.req.method === "GET" && o.size <= 8 * 1024 * 1024) {
    const ch = new Headers(r.h); ch.set("cache-control", "public, max-age=3600"); ch.set("x-bx-owner", encodeURIComponent(owner));
    const [x, y] = res.body!.tee();
    ctx.waitUntil(cache.put(key, new Response(y, { headers: ch })).catch(() => {}));
    return new Response(x, { headers: r.h });
  }
  return res;
}
/** 글에 붙은 파일 id → 창이 받아 갈 「📎 이름: 서명 링크」 줄. 내 파일만, 모르는 · 남의 id 는 빼고 셈 */
export async function fileLines(env: Env, me: string, base: string, ids: unknown[]) {
  const lines: string[] = []; let bad = 0;
  for (const x of ids.slice(0, FILES_PER_MSG)) {
    const id = String((x as { id?: unknown })?.id ?? x ?? ""), o = FID.test(id) ? await env.RESULTS.head(`mfiles/${id}`) : null;
    if (!o || fileOwner(o) !== me) { bad++; continue; }
    lines.push(`📎 ${fileName(o)}: ${await fileLink(env.BETTER_AUTH_SECRET, base, id)}`);
  }
  return { lines, bad };
}
/** 녹음 첨부의 받아쓰기. files를 링크로 바꾸기 전에 내 파일·지정한 녹음만 읽는다. */
export async function memoText(env: Env, me: string, b: Record<string, unknown>) {
  if (!b.stt) return "";
  const id = String(b.stt), ids = Array.isArray(b.files) ? b.files.slice(0, FILES_PER_MSG).map(x => String((x as { id?: unknown })?.id ?? x ?? "")) : [];
  if (!FID.test(id) || !ids.includes(id)) throw new Error("받아쓸 녹음이 첨부에 없어요");
  const o = await env.RESULTS.get(`mfiles/${id}`);
  if (!o || fileOwner(o) !== me || !/\.wav$/i.test(fileName(o)) || !o.size || o.size > VOICE_MAX) throw new Error("받아쓸 녹음을 찾지 못했어요");
  if (await quotaTake(env.DB, me, "stt", 0, DAY_STT, Number.MAX_SAFE_INTEGER) !== true) throw new Error("오늘 받아쓰기 한도를 넘었어요");
  const r = await env.AI.run("@cf/openai/whisper", { audio: [...new Uint8Array(await o.arrayBuffer())] }) as { text?: string };
  const text = String(r?.text || "").trim();
  if (!text) throw new Error("받아쓴 글이 없어요");
  return text;
}
export type DraftFile = { id: string; name: string; img: boolean; mime: string; size: number };
const IMG = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;   // 틀(addFiles)이 그림 칩으로 보이는 꼴과 같게
export async function draftFiles(bucket: R2Bucket, me: string, raw: unknown): Promise<DraftFile[] | null | undefined> {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > FILES_PER_MSG) return null;
  const ids = [...new Set(raw.map(x => String((x as { id?: unknown })?.id ?? x ?? "")))];
  if (ids.some(id => !FID.test(id))) return null;
  const hs = await Promise.all(ids.map(id => bucket.head(`mfiles/${id}`)));
  const out: DraftFile[] = [];
  for (const [i, o] of hs.entries()) {
    if (!o || fileOwner(o) !== me) return null;
    const mime = (o.httpMetadata?.contentType || "application/octet-stream").slice(0, 100);
    out.push({ id: ids[i], name: fileName(o), img: IMG.test(mime), mime, size: o.size });
  }
  return out;
}
/** POST /api/voice/stt — 틀은 audio/wav(16kHz) 몸통, 답 { text }. Workers AI Whisper(쓰기 칸에 넣기만 — 보내기는 사람이) */
export async function stt(c: C, me: string) {
  const buf = await readCapped(c.req.raw, VOICE_MAX);
  if (buf === "big") return c.json({ ok: false, error: "너무 길어요 — 1~2분 안으로" }, 413);
  if (!buf || !buf.byteLength) return c.json({ ok: false, error: "녹음이 비었어요" }, 400);
  const q = await quotaTake(c.env.DB, me, "stt", 0, DAY_STT, Number.MAX_SAFE_INTEGER).catch(() => null);
  if (q !== true) return q === null ? c.json({ ok: false, error: "일시적인 오류가 발생했어요" }, 503) : tooMany(c, "받아쓰기");
  try {
    const r = await c.env.AI.run("@cf/openai/whisper", { audio: [...buf] }) as { text?: string };
    return c.json({ ok: true, text: String(r?.text || "").trim() });
  } catch (e) { console.error("받아쓰기", String(e).slice(0, 200)); return c.json({ ok: false, error: "받아쓰기를 못 했어요" }, 502); }
}
