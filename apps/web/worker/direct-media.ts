// 작은 이미지도 R2 직행. Worker는 제어 JSON과 이미지 머리 16바이트만 읽는다.
import type { Context } from 'hono';
import * as uploads from './direct-uploads';
import * as emoji from './emoji';

type C = Context<{ Bindings: uploads.DirectEnv }>;
export type Kind = 'photo' | 'emoji' | 'blob' | 'thumb';
export const PHOTO_MAX = 1_500_000;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const random = () => crypto.randomUUID().replace(/-/g, '');
const error = uploads.uploadError;
const own = (me: string, kind: Kind) => `media:${kind}:${me}`;

export function imageType(b: Uint8Array) {
  const hex = [...b.slice(0, 12)].map(v => v.toString(16).padStart(2, '0')).join('');
  return hex.startsWith('89504e470d0a1a0a') ? 'image/png' : hex.startsWith('ffd8ff') ? 'image/jpeg' :
    hex.startsWith('52494646') && hex.slice(16, 24) === '57454250' ? 'image/webp' :
    hex.startsWith('474946383761') || hex.startsWith('474946383961') ? 'image/gif' : '';
}
async function emojiName(env: uploads.DirectEnv, name: string, std: Set<string>, key = '') {
  if (!emoji.NAME.test(name)) throw error(400, '이름은 한글 · 영문 소문자 · 숫자 · - _ 로 2–40자예요');
  if (!std.size) throw error(503, '일시적인 오류가 발생했어요');
  if (std.has(name) || emoji.BOTS.some(bot => emoji.EXPR.some(expr => name === `${bot}-${expr}`))) throw error(409, '같은 이름이 있어요');
  const old = await env.DB.prepare('SELECT key FROM emoji WHERE name = ?').bind(name).first<{ key: string }>();
  if (old && old.key !== key) throw error(409, '같은 이름이 있어요');
}
async function checkThumb(env: uploads.DirectEnv, b: Record<string, any>) {
  if (!/^[0-9a-f]{32}$/.test(b.mk) || !/^[A-Za-z0-9]{16,40}$/.test(b.art)) throw error(404, '없는 캔버스');
  const marker = await env.RESULTS.head(`mart/${b.mk}/_c/${b.art}`);
  if (!marker) throw error(404, '없는 캔버스');
  if (marker.customMetadata?.ver !== b.ver) throw error(409, '그 사이 새 판을 올렸어요');
}

export async function init(env: uploads.DirectEnv, me: string, kind: Kind, b: Record<string, any>, std = new Set<string>()) {
  uploads.checkSize(b.size);
  const mime = typeof b.mime === 'string' ? b.mime : '';
  let target = '', metadata: Record<string, string> = {};
  if (kind === 'photo') {
    if (b.size > PHOTO_MAX) throw error(413, '사진이 너무 커요');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw error(400, 'PNG · JPEG · WebP 사진만 돼요');
    // 클라이언트가 지정한 내용 해시를 신뢰하면 남의 기존 blob을 덮을 수 있다. 서버가 새 불변 ID를 고른다.
    target = `blobs/${random()}`;
  } else if (kind === 'emoji') {
    if (b.size > emoji.MAX) throw error(413, '그림이 너무 커요');
    if (!EXT[mime]) throw error(400, 'PNG · GIF · JPG · WEBP 그림만 돼요');
    const name = typeof b.name === 'string' ? b.name.trim().toLowerCase().replace(/^:|:$/g, '') : '';
    await emojiName(env, name, std);
    target = `emoji/${random()}${random()}-${random().slice(0, 16)}.${EXT[mime]}`;
    metadata = { name: encodeURIComponent(name) };
  } else if (kind === 'blob') {
    if (b.size > 15 * 1024 * 1024) throw error(413, '그림·글꼴은 15MB까지예요');
    if (!/^[0-9a-f]{32}$/.test(b.blob) || !/^(image\/(png|jpeg|webp|gif|avif)|font\/(woff2?|ttf|otf))$/.test(mime)) throw error(400, 'id · 이미지 · 글꼴 꼴');
    target = `blobs/${b.blob}`;
  } else {
    if (b.size < 2000 || b.size > 400_000 || mime !== 'image/jpeg') throw error(400, 'JPEG 가 아니에요');
    if (typeof b.ver !== 'string' || typeof b.pref !== 'string' || b.ver.length > 200 || b.pref.length > 200) throw error(400, '판 버전이 올바르지 않아요');
    await checkThumb(env, b);
    target = `mart/${b.mk}/${b.art}/_thumb.jpg`;
    metadata = { ver: b.ver, pref: encodeURIComponent(b.pref), prefencoded: '1', mk: b.mk, art: b.art };
  }
  return uploads.begin(env, own(me, kind), { target, size: b.size, mime, metadata });
}

export async function act(env: uploads.DirectEnv, me: string, kind: Kind, action: string, b: Record<string, any>, std = new Set<string>()) {
  if (action === 'init') return init(env, me, kind, b, std);
  const owner = own(me, kind), s = await uploads.getSession(env, owner, b.id);
  if (action === 'part') return uploads.part(env, owner, s.id, b.number);
  if (action === 'abort') { await uploads.abort(env, owner, s.id); return { ok: true }; }
  if (action !== 'complete') throw error(404, '없는 올리기 동작');
  const name = kind === 'emoji' ? decodeURIComponent(s.metadata.name) : '';
  const done = await uploads.complete(env, owner, s.id, b.parts, async () => {
    if (kind === 'photo' || kind === 'emoji' || kind === 'thumb') {
      const head = await env.RESULTS.get(s.source, { range: { offset: 0, length: 16 } });
      if (!head || imageType(new Uint8Array(await head.arrayBuffer())) !== s.mime) throw error(400, '이미지 꼴이 올바르지 않아요');
    }
    if (kind === 'emoji') await emojiName(env, name, std, s.target);
    if (kind === 'thumb') await checkThumb(env, { ...s.metadata, pref: decodeURIComponent(s.metadata.pref) });
  });
  if (kind === 'emoji') {
    await env.DB.prepare('INSERT INTO emoji(name,key,mime,by_email,at) VALUES (?,?,?,?,?) ON CONFLICT(name) DO NOTHING')
      .bind(name, done.key, s.mime, me, Date.now()).run();
    const row = await env.DB.prepare('SELECT key FROM emoji WHERE name = ?').bind(name).first<{ key: string }>();
    if (row?.key !== done.key) { await env.RESULTS.delete(done.key); throw error(409, '같은 이름이 있어요'); }
    return { ok: true, name, url: 'emoji/i/' + done.key.slice('emoji/'.length) };
  }
  return { ok: true, ...done, ...(kind === 'photo' || kind === 'blob' ? { id: done.key.slice('blobs/'.length) } : {}) };
}

export async function handle(c: C, me: string, kind: Kind, action: string, std = new Set<string>()) {
  if (!/^application\/json\b/i.test(c.req.header('content-type') || '')) return c.json({ ok: false, error: '파일 본문은 R2로 직접 올려 주세요' }, 415);
  let n = 0, raw = ''; const decoder = new TextDecoder(), reader = c.req.raw.body?.getReader();
  if (reader) for (;;) {
    const r = await reader.read(); if (r.done) break;
    n += r.value.byteLength;
    if (n > 16384) { await reader.cancel(); return c.json({ ok: false, error: '제어 요청이 너무 커요' }, 413); }
    raw += decoder.decode(r.value, { stream: true });
  }
  let body: Record<string, any>;
  try { body = JSON.parse(raw + decoder.decode()); if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error(); }
  catch { return c.json({ ok: false, error: 'JSON 아님' }, 400); }
  try { return c.json(await act(c.env, me, kind, action, body, std)); }
  catch (e) { const err = (action === "init" ? uploads.initializationError(e) : e) as Error & { status?: number; code?: string }; if (!err.status) console.error('이미지 직접 올리기', err); return c.json({ ok: false, error: err.status ? err.message : '일시적인 오류가 발생했어요', ...(err.code ? { code: err.code } : {}) }, (err.status || 503) as 400); }
}
