// 회원 쓰기 칸 파일 · 받아쓰기 — 보드 틀(page)이 부르는 /api/upload · /api/file/:id · /api/voice/stt 를 회원 길로(틀은 그대로).
// 예전 회원 길: 올리기 · 받아쓰기는 JSON 이 아니라 「bad json」(400), 파일 붙은 글은 「아직 안 돼요」, 파일 보기는 403.
// 저장: R2 mfiles/<id>(customMetadata owner = 회원 메일). 보기는 올린 사람만. 창(에이전트)에는 7일 서명 링크 줄(/f/<id>)로 — 로그인 없이 curl 로 받게
import type { Context } from "hono";

type Env = { RESULTS: R2Bucket; AI: { run(model: string, input: unknown): Promise<unknown> }; BETTER_AUTH_SECRET: string; PUBLIC_URL?: string };
type C = Context<{ Bindings: Env }>;

export const FILE_MAX = 20 * 1024 * 1024, VOICE_MAX = 3 * 1024 * 1024, LINK_DAYS = 7, FILES_PER_MSG = 10;
const FID = /^[0-9a-f]{32}$/, RISKY = /html|svg|xml|javascript|ecmascript/i;
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
function headers(o: R2ObjectBody, dl: boolean) {
  const h = new Headers({ "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "sandbox" }); o.writeHttpMetadata(h);
  const risky = RISKY.test(h.get("content-type") || "");
  if (risky) h.set("content-type", "application/octet-stream");
  if (dl || risky) h.set("content-disposition", (h.get("content-disposition") || "").replace(/^inline/, "attachment") || "attachment");
  return h;
}

/** POST /api/upload — 틀은 몸통에 파일 그대로 + X-File-Name(URI 인코딩). 답 { ok, id, name, size, mime } */
export async function upload(c: C, me: string) {
  if (+(c.req.header("content-length") || 0) > FILE_MAX) return c.json({ ok: false, error: "20MB 까지예요" }, 413);
  const buf = await c.req.arrayBuffer().catch(() => null);
  if (!buf || !buf.byteLength) return c.json({ ok: false, error: "파일이 비었어요" }, 400);
  if (buf.byteLength > FILE_MAX) return c.json({ ok: false, error: "20MB 까지예요" }, 413);
  let name = "file"; try { name = decodeURIComponent(c.req.header("x-file-name") || "file"); } catch {}
  name = name.replace(/[\x00-\x1f\x7f"\\/]/g, "_").trim().slice(0, 120) || "file";
  const type = (c.req.header("content-type") || "application/octet-stream").slice(0, 100), id = crypto.randomUUID().replace(/-/g, "");
  await c.env.RESULTS.put(`mfiles/${id}`, buf, { httpMetadata: { contentType: type, contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(name)}` }, customMetadata: { owner: me, name } });
  return c.json({ ok: true, id, name, size: buf.byteLength, mime: type });
}
/** GET /api/file/:id — 올린 사람만(남의 것은 없는 것과 같게 404). ?dl = 내려받기 */
export async function fileGet(c: C, me: string, id: string, dl: boolean) {
  if (!FID.test(id)) return c.json({ error: "없는 파일" }, 404);
  const o = await c.env.RESULTS.get(`mfiles/${id}`);
  if (!o || o.customMetadata?.owner !== me) return c.json({ error: "없는 파일" }, 404);
  return new Response(o.body, { headers: headers(o, dl) });
}
export async function signedGet(c: C, id: string) {
  if (!(await linkOk(c.env.BETTER_AUTH_SECRET, id, c.req.query("e") || "", c.req.query("t") || ""))) return c.text("link expired or invalid\n", 403);
  const o = await c.env.RESULTS.get(`mfiles/${id}`); if (!o) return c.text("not found\n", 404);
  return new Response(o.body, { headers: headers(o, false) });
}
/** 글에 붙은 파일 id → 창이 받아 갈 「📎 이름: 서명 링크」 줄. 내 파일만, 모르는 · 남의 id 는 빼고 셈 */
export async function fileLines(env: Env, me: string, base: string, ids: unknown[]) {
  const lines: string[] = []; let bad = 0;
  for (const x of ids.slice(0, FILES_PER_MSG)) {
    const id = String((x as { id?: unknown })?.id ?? x ?? ""), o = FID.test(id) ? await env.RESULTS.head(`mfiles/${id}`) : null;
    if (!o || o.customMetadata?.owner !== me) { bad++; continue; }
    lines.push(`📎 ${o.customMetadata?.name || "file"}: ${await fileLink(env.BETTER_AUTH_SECRET, base, id)}`);
  }
  return { lines, bad };
}
/** POST /api/voice/stt — 틀은 audio/wav(16kHz) 몸통, 답 { text }. Workers AI Whisper(쓰기 칸에 넣기만 — 보내기는 사람이) */
export async function stt(c: C) {
  const buf = await c.req.arrayBuffer().catch(() => null);
  if (!buf || !buf.byteLength) return c.json({ ok: false, error: "녹음이 비었어요" }, 400);
  if (buf.byteLength > VOICE_MAX) return c.json({ ok: false, error: "너무 길어요 — 1~2분 안으로" }, 413);
  try {
    const r = await c.env.AI.run("@cf/openai/whisper", { audio: [...new Uint8Array(buf)] }) as { text?: string };
    return c.json({ ok: true, text: String(r?.text || "").trim() });
  } catch (e) { console.error("받아쓰기", String(e).slice(0, 200)); return c.json({ ok: false, error: "받아쓰기를 못 했어요" }, 502); }
}
