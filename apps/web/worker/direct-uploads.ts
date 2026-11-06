// 파일 본문은 R2 S3로만. 서명은 임시 키에 한정하고, 검증한 파일만 서버 복사로 게시한다.
export const MAX_FILE = 500 * 1024 * 1024;
export const PART_SIZE = 8 * 1024 * 1024;
export type DirectEnv = { DB: D1Database; RESULTS: R2Bucket; R2_ACCOUNT_ID?: string; R2_BOARDER_ACCESS_KEY_ID?: string; R2_BOARDER_SECRET_ACCESS_KEY?: string; R2_BUCKET?: string };
type Spec = { target: string; size: number; mime: string; metadata: Record<string, string> };
type Session = Spec & { id: string; owner: string; source: string; upload_id: string | null; state: string; expires: number; locked_at?: number; charged_day?: string; metadata: Record<string, string> };
const te = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const hash = async (s: string) => hex(await crypto.subtle.digest('SHA-256', te.encode(s)));
const hmac = async (k: string | ArrayBuffer, s: string) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', typeof k === 'string' ? te.encode(k) : k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), te.encode(s));
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, x => '%' + x.charCodeAt(0).toString(16).toUpperCase());
export const uploadError = (status: number, message: string) => Object.assign(new Error(message), { status });
export function checkSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 0) throw uploadError(400, '파일 크기가 올바르지 않아요');
  if (size > MAX_FILE) throw uploadError(413, '500MB 까지 올릴 수 있어요');
}
function config(env: DirectEnv) {
  if (!env.R2_ACCOUNT_ID || !env.R2_BOARDER_ACCESS_KEY_ID || !env.R2_BOARDER_SECRET_ACCESS_KEY) throw Object.assign(uploadError(503, '직접 올리기 설정이 아직 준비되지 않았어요'), {code:'direct_upload_unavailable'});
  return { host: `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, bucket: env.R2_BUCKET || 'boarder', access: env.R2_BOARDER_ACCESS_KEY_ID, secret: env.R2_BOARDER_SECRET_ACCESS_KEY };
}
// 이주가 늦은 init만 옛 길로 물러난다. 다른 DB 장애는 지원 없음으로 숨기지 않는다.
export function initializationError(error: unknown) {
  let cause: unknown = error;
  for (let depth = 0; depth < 4 && cause; depth++) {
    const value = cause as {message?: string; cause?: unknown};
    if (/no such table:\s*(?:main\.)?(?:direct_upload|canvas_upload)\b/i.test(String(value.message || cause))) {
      return Object.assign(uploadError(503, '직접 올리기 설정이 아직 준비되지 않았어요'), {code:'direct_upload_unavailable'});
    }
    cause = value.cause;
  }
  return error;
}
// Content-Length를 서명해 거짓 크기 선언으로 큰 몸통을 저장하지 못하게 한다. 브라우저가 Blob의 길이를 자동으로 붙인다.
export async function presign(env: DirectEnv, method: string, key: string, headers: Record<string, string> = {}, query: Record<string, string> = {}, now = new Date()) {
  headers = Object.fromEntries(Object.entries(headers).map(([k,v]) => [k.toLowerCase(),v]));
  const cfg = config(env), date = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = date.slice(0, 8), scope = `${day}/auto/s3/aws4_request`;
  const hs = { ...headers, host: cfg.host }, names = Object.keys(hs).sort(), signed = names.join(';');
  const q: Record<string, string> = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${cfg.access}/${scope}`, 'X-Amz-Date': date, 'X-Amz-Expires': '900', 'X-Amz-SignedHeaders': signed, 'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD' };
  const path = '/' + [cfg.bucket, ...key.split('/')].map(enc).join('/');
  const qs = Object.entries(q).map(([k, v]) => [enc(k), enc(v)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [method, path, qs, names.map(k => `${k}:${hs[k as keyof typeof hs].trim().replace(/\s+/g, ' ')}\n`).join(''), signed, 'UNSIGNED-PAYLOAD'].join('\n');
  let k = await hmac('AWS4' + cfg.secret, day); k = await hmac(k, 'auto'); k = await hmac(k, 's3'); k = await hmac(k, 'aws4_request');
  const sig = hex(await hmac(k, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${await hash(canonical)}`));
  return { url: `https://${cfg.host}${path}?${qs}&X-Amz-Signature=${sig}`, headers };
}
export async function getSession(env: DirectEnv, owner: string, id: string): Promise<Session> {
  if (!/^[0-9a-f]{32}$/.test(id)) throw uploadError(404, '없는 올리기');
  const r = await env.DB.prepare('SELECT * FROM direct_upload WHERE id = ? AND owner = ?').bind(id, owner).first<any>();
  if (!r) throw uploadError(404, '없는 올리기');
  if (r.expires < Date.now()) throw uploadError(410, '올리기 시간이 지났어요. 다시 골라 주세요');
  return { ...r, metadata: JSON.parse(r.metadata) };
}
const info = (s: Session) => ({ id: s.id, size: s.size, partSize: s.upload_id ? PART_SIZE : s.size, parts: s.upload_id ? Math.ceil(s.size / PART_SIZE) : 1 });
export async function begin(env: DirectEnv, owner: string, spec: Spec) {
  checkSize(spec.size); config(env);
  if (!spec.target || /[\x00-\x1f]/.test(spec.target) || /[\r\n]/.test(spec.mime)) throw uploadError(400, '잘못된 파일 정보');
  const metadata: Record<string,string> = {};
  for (const [k,v] of Object.entries(spec.metadata)) {
    if (!/^[a-z0-9_-]+$/i.test(k) || typeof v !== 'string' || /[^\x20-\x7e]/.test(v)) throw uploadError(400, '파일 메타데이터는 인코딩해 주세요');
    metadata[k.toLowerCase()] = v;
  }
  spec = { ...spec, metadata };
  const existing = async () => {
    if (!owner.startsWith('file:')) return null;
    const row = await env.DB.prepare("SELECT id FROM direct_upload WHERE owner=? AND target=? AND state NOT IN ('aborted','expired')").bind(owner, spec.target).first<{id:string}>();
    if (!row) return null;
    const old = await getSession(env, owner, row.id);
    if (old.size !== spec.size || old.mime !== spec.mime) throw uploadError(409, '같은 올리기 열쇠에 다른 파일이 있어요');
    return info(old);
  };
  const previous = await existing(); if (previous) return previous;
  const id = crypto.randomUUID().replace(/-/g, ''), source = `direct-pending/${(await hash(owner)).slice(0, 32)}/${id}`;
  const multi = spec.size > PART_SIZE ? await env.RESULTS.createMultipartUpload(source, { httpMetadata: { contentType: spec.mime }, customMetadata: spec.metadata }) : null;
  const s: Session = { ...spec, id, owner, source, upload_id: multi?.uploadId || null, state: 'uploading', expires: Date.now() + 24 * 3600_000 };
  try {
    await env.DB.prepare('INSERT INTO direct_upload (id,owner,source,target,size,mime,metadata,upload_id,state,expires) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, owner, source, spec.target, spec.size, spec.mime, JSON.stringify(spec.metadata), s.upload_id, s.state, s.expires).run();
  } catch (e) { if (multi) await multi.abort().catch(() => {}); const old = await existing(); if (old) return old; throw e; }
  return info(s);
}
export async function part(env: DirectEnv, owner: string, id: string, number: number) {
  const s = await getSession(env, owner, id), n = info(s);
  if (s.state !== 'uploading') throw uploadError(409, '이미 마친 올리기');
  if (!Number.isInteger(number) || number < 1 || number > n.parts) throw uploadError(400, '잘못된 조각 번호');
  const size = Math.min(n.partSize, s.size - (number - 1) * n.partSize);
  const headers: Record<string, string> = { 'content-length': String(size) };
  if (!s.upload_id) {
    headers['content-type'] = s.mime;
    for (const [k, v] of Object.entries(s.metadata)) headers[`x-amz-meta-${k}`] = v;
  }
  return presign(env, 'PUT', s.source, headers, s.upload_id ? { partNumber: String(number), uploadId: s.upload_id } : {});
}
export async function complete(env: DirectEnv, owner: string, id: string, parts: R2UploadedPart[] = [], reserve?: () => Promise<(() => Promise<void>) | void>) {
  const s = await getSession(env, owner, id);
  if (s.state === 'done') return { key: s.target, size: s.size };
  if (!Array.isArray(parts)) throw uploadError(400, '조각 목록이 올바르지 않아요');
  const now = Date.now();
  const lock = await env.DB.prepare("UPDATE direct_upload SET state = 'completing', locked_at = ? WHERE id = ? AND owner = ? AND (state = 'uploading' OR (state = 'completing' AND locked_at < ?)) RETURNING id").bind(now, id, owner, now - 300_000).first();
  if (!lock) throw uploadError(409, '올리기 완료 확인 중이에요');
  let refund: (() => Promise<void>) | void = undefined;
  try {
    let o = await env.RESULTS.head(s.source);
    if (!o && s.upload_id) {
      const n = info(s).parts;
      if (parts.length !== n || parts.some((p, i) => !p || p.partNumber !== i + 1 || typeof p.etag !== 'string' || !p.etag || p.etag.length > 200)) throw uploadError(400, '조각이 빠졌어요');
      await env.RESULTS.resumeMultipartUpload(s.source, s.upload_id).complete(parts.map(p => ({ partNumber: p.partNumber, etag: p.etag.replace(/^"|"$/g, '') })));
      o = await env.RESULTS.head(s.source);
    }
    if (!o) throw uploadError(409, '파일이 아직 올라오지 않았어요');
    if (o.size !== s.size || o.size > MAX_FILE) { await env.RESULTS.delete(s.source); throw uploadError(413, '올린 파일 크기가 다릅니다'); }
    if (reserve) refund = await reserve();
    const cfg = config(env), copy = await presign(env, 'PUT', s.target, { 'x-amz-copy-source': '/' + [cfg.bucket, ...s.source.split('/')].map(enc).join('/'), 'x-amz-copy-source-if-match': o.httpEtag || '"' + o.etag + '"' });
    const r = await fetch(copy.url, { method: 'PUT', headers: copy.headers, signal: AbortSignal.timeout(120_000) });
    // S3는 HTTP 200 안에도 CopyObject 오류를 돌려줄 수 있다.
    const result = await r.text();
    if (!r.ok || /<Error>/.test(result) || !/<ETag>/.test(result)) throw uploadError(502, '파일 등록을 다시 시도해 주세요');
    await env.DB.prepare("UPDATE direct_upload SET state = 'done' WHERE id = ? AND owner = ? AND locked_at = ?").bind(id, owner, now).run();
    await env.RESULTS.delete(s.source).catch(() => {});
    console.log('direct_upload_complete', JSON.stringify({ id, size: s.size, parts: info(s).parts, worker_body_bytes: 0 }));
    return { key: s.target, size: s.size };
  } catch (e) {
    if (refund) await refund().catch(() => {});
    await env.DB.prepare("UPDATE direct_upload SET state = 'uploading' WHERE id = ? AND state = 'completing' AND locked_at = ?").bind(id, now).run().catch(() => {});
    throw e;
  }
}
export async function abort(env: DirectEnv, owner: string, id: string) {
  const s = await getSession(env, owner, id);
  const lock = await env.DB.prepare("UPDATE direct_upload SET state = 'aborted' WHERE id = ? AND owner = ? AND state = 'uploading' RETURNING id").bind(id, owner).first();
  const current = lock ? s : await getSession(env, owner, id);
  if (!lock && current.state !== 'aborted') return;
  if (current.upload_id) await env.RESULTS.resumeMultipartUpload(current.source, current.upload_id).abort().catch(() => {});
  await env.RESULTS.delete(current.source);
  await releaseCharge(env, current);
}

async function releaseCharge(env: DirectEnv, s: Session) {
  if (!s.owner.startsWith('file:')) return;
  // 예약과 취소가 경합해도 과거 getSession의 charged_day가 아니라 지금 영수증으로 돌려준다.
  await env.DB.batch([
    env.DB.prepare(`UPDATE user_pref SET v=json_object('n',max(0,json_extract(v,'$.n')-1),'b',max(0,json_extract(v,'$.b')-?))
      WHERE owner=? AND k='q:mfiles:' || (SELECT charged_day FROM direct_upload WHERE id=?)
      AND EXISTS(SELECT 1 FROM direct_upload WHERE id=? AND charged_day IS NOT NULL)`).bind(s.size, s.owner.slice(5), s.id, s.id),
    env.DB.prepare('UPDATE direct_upload SET charged_day=NULL WHERE id=?').bind(s.id),
  ]);
}
export async function sweep(env: DirectEnv) {
  const now = Date.now();
  // 정상 완료와 환불이 끝난 취소는 source를 한 번에 지운 뒤 영수증도 일괄 삭제한다.
  // 캡처한 id만 지워 동시 스윕이 다음 묶음의 source 추적을 잃지 않게 한다.
  const terminal = await env.DB.prepare(`SELECT id,source FROM direct_upload WHERE expires < ?
    AND (state = 'done' OR (state = 'aborted' AND charged_day IS NULL)) ORDER BY expires,id LIMIT 1000`).bind(now).all<{ id: string; source: string }>();
  if (terminal.results.length) {
    await env.RESULTS.delete(terminal.results.map(r => r.source));
    await env.DB.prepare(`DELETE FROM direct_upload WHERE id IN (SELECT value FROM json_each(?)) AND expires < ?
      AND (state = 'done' OR (state = 'aborted' AND charged_day IS NULL))`).bind(JSON.stringify(terminal.results.map(r => r.id)), now).run();
  }
  // 미완료·미환불 세션은 R2/환불 요청 예산 안에서 100개씩 처리한다.
  const rows = await env.DB.prepare(`SELECT * FROM direct_upload WHERE expires < ?
    AND (state NOT IN ('done','aborted') OR (state = 'aborted' AND charged_day IS NOT NULL))
    AND (state <> 'completing' OR locked_at IS NULL OR locked_at < ?) ORDER BY expires,id LIMIT 100`).bind(now, now - 300_000).all<any>();
  for (const r of rows.results) {
    // 목록을 읽은 뒤 완료가 시작됐을 수도 있으므로 파일을 지우기 전에 상태를 확보한다.
    const claimed = await env.DB.prepare(`UPDATE direct_upload SET state = 'expired', locked_at = ? WHERE id = ? AND expires < ?
      AND (state NOT IN ('done','aborted') OR (state = 'aborted' AND charged_day IS NOT NULL))
      AND (state <> 'completing' OR locked_at IS NULL OR locked_at < ?) RETURNING id`).bind(now, r.id, now, now - 300_000).first();
    if (!claimed) continue;
    const s = { ...r, metadata: JSON.parse(r.metadata) } as Session;
    if (s.upload_id) await env.RESULTS.resumeMultipartUpload(s.source, s.upload_id).abort().catch(() => {});
    await env.RESULTS.delete(s.source);
    await releaseCharge(env, s);
    await env.DB.prepare('DELETE FROM direct_upload WHERE id=? AND expires < ?').bind(s.id, now).run();
  }
}
