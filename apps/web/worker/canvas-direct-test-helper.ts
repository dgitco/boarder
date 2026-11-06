// 시험의 R2 S3 서버 복사만 흉내 낸다. 파일 본문은 Worker 요청에 넣지 않는다.
export function copyFetch(m: Map<string, any>, failCopies = 0) {
  const fallback = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== 'canvas-test.r2.cloudflarestorage.com') return fallback(input, init);
    if (failCopies-- > 0) return new Response('<Error>R2 일시 오류</Error>', { status: 503 });
    const source = new Headers(init?.headers).get('x-amz-copy-source');
    if (!source) throw new Error('시험에서는 S3 서버 복사만 허용');
    const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    const from = decodeURIComponent(source.split('/').slice(2).join('/'));
    const value = m.get(from); if (!value) return new Response('<Error>없는 파일</Error>', { status: 404 });
    m.set(key, { ...value, b: value.b.slice() });
    return new Response('<CopyObjectResult><ETag>test-etag</ETag></CopyObjectResult>');
  };
}
export const directConfig = { R2_ACCOUNT_ID: 'canvas-test', R2_BOARDER_ACCESS_KEY_ID: 'test-access-not-real', R2_BOARDER_SECRET_ACCESS_KEY: 'test-secret-not-real', R2_BUCKET: 'test-bucket' };
export function directHelpers(go: (p: string, init?: RequestInit) => Promise<Response> | Response, db: any, R: R2Bucket) {
  const post = (tok: string, suffix: string, body: unknown) => go('/api/me/canvas' + suffix, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const init = (tok: string, manifest: unknown, options: object = {}) => post(tok, '', { ...options, manifest });
  const put = async (tok: string, files: Record<string, string | Uint8Array>, options: any = {}) => {
    const paths = Object.keys(files), manifest = options.manifest ?? paths.map(path => ({ path, size: typeof files[path] === 'string' ? new TextEncoder().encode(files[path]).length : files[path].length }));
    const cv = files['project/canvas.json'] || files['canvas.json'];
    let title = /<title[^>]*>([^<]+)<\/title>/i.exec(String(files['index.html'] || ''))?.[1];
    if (cv) { try { title = JSON.parse(String(cv)).title || title; } catch {} }
    const r = await init(tok, manifest, { ...options, title: options.title || title }); if (!r.ok) return r;
    const batch = await r.json() as any;
    for (let index = 0; index < batch.uploads.length; index++) {
      const id = batch.uploads[index].id, ctl = { session: batch.session, index, id };
      const part = await post(tok, '/upload/part', { ...ctl, number: 1 }); if (!part.ok) return part;
      const session = db.prepare('SELECT * FROM direct_upload WHERE id = ?').get(id);
      await R.put(session.source, files[paths[index]], { httpMetadata: { contentType: session.mime }, customMetadata: JSON.parse(session.metadata) });
      const done = await post(tok, '/upload/complete', { ...ctl, parts: [{ partNumber: 1, etag: 'test-etag' }] }); if (!done.ok) return done;
    }
    return post(tok, '/publish', { session: batch.session });
  };
  return { put, init, control: post };
}
