// 실행은 EC2에서: node --test --no-warnings --experimental-transform-types apps/web/worker/direct-s3.test.ts
// 운영 signer만 가져오며 검증기에는 Node crypto와 별도 바이트 인코더를 쓴다. 네트워크는 localhost만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, request } from 'node:http';
import { presign, PART_SIZE, type DirectEnv } from './direct-uploads.ts';

const ACCESS = 'local-fixture-access', SECRET = 'local-fixture-secret-not-real';
const NOW = new Date('2026-11-06T07:00:00Z');
const ENV = { R2_ACCOUNT_ID: 'local-fixture', R2_BUCKET: 'boarder-local',
  R2_BOARDER_ACCESS_KEY_ID: ACCESS, R2_BOARDER_SECRET_ACCESS_KEY: SECRET } as unknown as DirectEnv;
type Signed = { url: string; headers: Record<string, string> };
class S3Error extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
const reject = (code: string, status = 403): never => { throw new S3Error(status, code); };
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const md5 = (bytes: Buffer) => createHash('md5').update(bytes).digest();
// encodeURIComponent나 production canonicalization에 의존하지 않는 RFC3986 바이트 인코딩.
function uriBytes(value: string): string {
  let result = '';
  for (const byte of Buffer.from(value)) result += byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122 || byte >= 48 && byte <= 57 || [45, 46, 95, 126].includes(byte)
    ? String.fromCharCode(byte) : '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  return result;
}
function verify(method: string, input: string, requestHeaders: HeadersInit, body = Buffer.alloc(0),
  options: { access?: string; secret?: string; region?: string; now?: Date } = {}) {
  const url = new URL(input), headers = new Headers(requestHeaders), pairs: [string, string][] = [];
  try {
    for (const field of url.search.slice(1).split('&')) {
      const at = field.indexOf('=');
      pairs.push([decodeURIComponent(at < 0 ? field : field.slice(0, at)), decodeURIComponent(at < 0 ? '' : field.slice(at + 1))]);
    }
  } catch { return reject('InvalidQuery'); }
  const one = (key: string) => {
    const found = pairs.filter(([name]) => name === key);
    if (found.length !== 1) return reject('InvalidQuery'); return found[0][1];
  };
  if (one('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256') return reject('InvalidAlgorithm');
  const credential = one('X-Amz-Credential').split('/'), timestamp = one('X-Amz-Date');
  const access = options.access ?? ACCESS, secret = options.secret ?? SECRET, region = options.region ?? 'auto';
  if (credential.length !== 5 || credential[0] !== access || credential[2] !== region || credential[3] !== 's3' || credential[4] !== 'aws4_request') return reject('InvalidCredential');
  const date = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(timestamp);
  if (!date || credential[1] !== timestamp.slice(0, 8)) return reject('InvalidDate');
  const issued = Date.UTC(+date[1], +date[2] - 1, +date[3], +date[4], +date[5], +date[6]);
  const expires = Number(one('X-Amz-Expires')), now = (options.now ?? NOW).getTime();
  if (!Number.isInteger(expires) || expires < 1 || expires > 604800 || now < issued || now > issued + expires * 1000) return reject('ExpiredToken');
  const signedHeaders = one('X-Amz-SignedHeaders'), names = signedHeaders.split(';');
  if (!names.includes('host') || names.some((name, i) => !/^[a-z0-9-]+$/.test(name) || i > 0 && names[i - 1] >= name)) return reject('InvalidSignedHeaders');
  if (headers.get('host') !== url.host) return reject('SignatureDoesNotMatch');
  const canonicalHeaders = names.map(name => {
    const value = headers.get(name); if (value === null) return reject('SignatureDoesNotMatch');
    return name + ':' + value.trim().replace(/[\t\r\n ]+/g, ' ') + '\n';
  }).join('');
  const encodedQuery = pairs.filter(([name]) => name !== 'X-Amz-Signature').map(([name, value]) => [uriBytes(name), uriBytes(value)]);
  encodedQuery.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  let path: string;
  try { path = url.pathname.split('/').map(segment => uriBytes(decodeURIComponent(segment))).join('/'); } catch { return reject('InvalidPath'); }
  const payloadHash = pairs.find(([name]) => name === 'X-Amz-Content-Sha256')?.[1] ?? 'UNSIGNED-PAYLOAD';
  if (payloadHash !== 'UNSIGNED-PAYLOAD') return reject('UnsupportedPayload');
  const canonical = [method, path, encodedQuery.map(([name, value]) => name + '=' + value).join('&'), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = credential.slice(1).join('/'), canonicalHash = sha256(canonical);
  const message = ['AWS4-HMAC-SHA256', timestamp, scope, canonicalHash].join('\n');
  let key = Buffer.from('AWS4' + secret);
  for (const component of credential.slice(1)) key = createHmac('sha256', key).update(component).digest();
  const expected = createHmac('sha256', key).update(message).digest(), actual = one('X-Amz-Signature');
  if (!/^[0-9a-f]{64}$/.test(actual) || !timingSafeEqual(expected, Buffer.from(actual, 'hex'))) return reject('SignatureDoesNotMatch');
  if (headers.has('content-length') && Number(headers.get('content-length')) !== body.length) return reject('IncompleteBody', 400);
  if (headers.has('content-md5') && headers.get('content-md5') !== md5(body).toString('base64')) return reject('BadDigest', 400);
  return { url, canonicalHash };
}
function signedHeaders(signed: Signed): Record<string, string> { return { ...signed.headers, host: new URL(signed.url).host }; }
const sign = (method: string, key: string, headers: Record<string, string> = {}, query: Record<string, string> = {}, now = NOW) => presign(ENV, method, key, headers, query, now);

// AWS가 공개한 고정 예시로 검증기 자체를 먼저 확인한다. 실제 계정 키가 아니다.
// https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html
test('독립 검증기는 AWS 공식 presigned GET golden vector와 canonical hash를 검증', () => {
  const url = 'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404';
  const result = verify('GET', url, { host: 'examplebucket.s3.amazonaws.com' }, Buffer.alloc(0), {
    access: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T01:00:00Z'),
  });
  assert.equal(result.canonicalHash, '3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04');
});

test('production PUT/GET/Copy/multipart 서명은 독립 검증을 통과하고 키·경로·query·header·method 변조 거절', async () => {
  const body = Buffer.from('가상 파일\0본문'), key = "direct-pending/한 글/!()*' +%?#.bin";
  const put = await sign('PUT', key, { 'Content-Length': String(body.length), 'Content-Type': 'application/octet-stream', 'Content-MD5': md5(body).toString('base64'), 'X-Amz-Meta-Note': '  alpha   beta  ' });
  verify('PUT', put.url, signedHeaders(put), body);
  const get = await sign('GET', key); verify('GET', get.url, signedHeaders(get));
  const copy = await sign('PUT', 'published/copy', { 'x-amz-copy-source': '/boarder-local/source', 'x-amz-copy-source-if-match': '"etag-fixed"' });
  verify('PUT', copy.url, signedHeaders(copy));
  const part = await sign('PUT', key, { 'content-length': String(body.length) }, { uploadId: 'multipart /+?=', partNumber: '2' });
  verify('PUT', part.url, signedHeaders(part), body);
  const mutations: [string, () => void][] = [
    ['키', () => { const u = new URL(put.url); u.pathname += '-other'; verify('PUT', String(u), signedHeaders(put), body); }],
    ['버킷 경로', () => { const u = new URL(put.url); u.pathname = u.pathname.replace('/boarder-local/', '/other-bucket/'); verify('PUT', String(u), signedHeaders(put), body); }],
    ['query', () => { const u = new URL(part.url); u.searchParams.set('partNumber', '3'); verify('PUT', String(u), signedHeaders(part), body); }],
    ['query 중복', () => { const u = new URL(part.url); u.searchParams.append('uploadId', 'another'); verify('PUT', String(u), signedHeaders(part), body); }],
    ['header', () => verify('PUT', put.url, { ...signedHeaders(put), 'content-type': 'text/plain' }, body)],
    ['Host', () => verify('PUT', put.url, { ...signedHeaders(put), host: 'other.r2.cloudflarestorage.com' }, body)],
    ['method', () => verify('POST', put.url, signedHeaders(put), body)],
    ['길이', () => verify('PUT', put.url, { ...signedHeaders(put), 'content-length': String(body.length + 1) }, body)],
    ['secret', () => verify('PUT', put.url, signedHeaders(put), body, { secret: 'wrong-fixture-secret' })],
    ['만료', () => verify('PUT', put.url, signedHeaders(put), body, { now: new Date(NOW.getTime() + 901000) })],
    ['복사 조건', () => verify('PUT', copy.url, { ...signedHeaders(copy), 'x-amz-copy-source-if-match': '"other"' })],
  ];
  for (const [label, mutation] of mutations) assert.throws(mutation, S3Error, label);
  const changed = Buffer.from(body); changed[0] ^= 1;
  assert.throws(() => verify('PUT', put.url, signedHeaders(put), changed), { code: 'BadDigest' });
  const badMd5 = await sign('PUT', key, { 'content-length': String(body.length), 'content-md5': Buffer.alloc(16).toString('base64') });
  assert.throws(() => verify('PUT', badMd5.url, signedHeaders(badMd5), body), { code: 'BadDigest' });
});

type Stored = { body: Buffer; etag: string };
async function miniS3() {
  const objects = new Map<string, Stored>(), multiparts = new Map<string, { key: string; parts: Map<number, Stored> }>();
  const attempts = new Map<number, number>(); let next = 0;
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 32 * 1024 * 1024) return reject('EntityTooLarge', 413); chunks.push(chunk); }
      const body = Buffer.concat(chunks), checked = verify(req.method!, `https://${req.headers.host}${req.url}`, req.headers as HeadersInit, body);
      assert.equal(req.headers.authorization, undefined, '제어 API의 인증을 파일 전송으로 넘기지 않음');
      const url = checked.url, key = decodeURIComponent(url.pathname), uploadId = url.searchParams.get('uploadId');
      const save = (bytes: Buffer): Stored => ({ body: Buffer.from(bytes), etag: '"' + md5(bytes).toString('hex') + '"' });
      if (req.method === 'POST' && url.searchParams.has('uploads')) {
        const id = 'mini /+?' + ++next; multiparts.set(id, { key, parts: new Map() });
        res.end(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`); return;
      }
      if (uploadId) {
        const upload = multiparts.get(uploadId); if (!upload || upload.key !== key) return reject('NoSuchUpload', 404);
        if (req.method === 'PUT') {
          const number = Number(url.searchParams.get('partNumber'));
          if (!Number.isInteger(number) || number < 1) return reject('InvalidPart', 400);
          attempts.set(number, (attempts.get(number) ?? 0) + 1);
          if (number === 2 && attempts.get(number) === 1) return reject('InjectedPartFailure', 500);
          const value = save(body); upload.parts.set(number, value); res.setHeader('etag', value.etag); res.end(); return;
        }
        if (req.method !== 'POST') return reject('MethodNotAllowed', 405);
        const listed = [...body.toString().matchAll(/<Part><PartNumber>(\d+)<\/PartNumber><ETag>([^<]+)<\/ETag><\/Part>/g)];
        if (!listed.length || listed.some((part, i) => +part[1] !== i + 1 || upload.parts.get(+part[1])?.etag !== part[2])) return reject('InvalidPart', 400);
        const ordered = listed.map(part => upload.parts.get(+part[1])!);
        if (ordered.slice(0, -1).some(part => part.body.length < 5 * 1024 * 1024)) return reject('EntityTooSmall', 400);
        const value = save(Buffer.concat(ordered.map(part => part.body))); objects.set(key, value); multiparts.delete(uploadId);
        res.end(`<CompleteMultipartUploadResult><ETag>${value.etag}</ETag></CompleteMultipartUploadResult>`); return;
      }
      const source = req.headers['x-amz-copy-source'];
      if (req.method === 'PUT' && typeof source === 'string') {
        const from = objects.get(decodeURIComponent(source)); if (!from) return reject('NoSuchKey', 404);
        if (req.headers['x-amz-copy-source-if-match'] !== from.etag) return reject('PreconditionFailed', 412);
        objects.set(key, save(from.body)); res.end(`<CopyObjectResult><ETag>${from.etag}</ETag></CopyObjectResult>`); return;
      }
      if (req.method === 'PUT') { const value = save(body); objects.set(key, value); res.setHeader('etag', value.etag); res.end(); return; }
      if (req.method === 'GET') {
        const value = objects.get(key); if (!value) return reject('NoSuchKey', 404);
        res.setHeader('etag', value.etag); res.end(value.body); return;
      }
      reject('MethodNotAllowed', 405);
    } catch (e) {
      res.statusCode = e instanceof S3Error ? e.status : 500;
      res.end(`<Error><Code>${e instanceof S3Error ? e.code : 'MiniServerError'}</Code></Error>`);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  // 연결 대상만 localhost로 고정하며 서명에 쓰인 Host/path/query는 바꾸지 않는다.
  const send = (method: string, signed: Signed, body = Buffer.alloc(0)) => new Promise<{ status: number; body: Buffer; etag: string }>((resolve, rejectRequest) => {
    const url = new URL(signed.url), req = request({ hostname: '127.0.0.1', port, method, path: url.pathname + url.search, headers: signedHeaders(signed), agent: false }, res => {
      const parts: Buffer[] = []; res.on('data', chunk => parts.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(parts), etag: String(res.headers.etag ?? '') }));
      res.on('error', rejectRequest);
    });
    req.setTimeout(10000, () => req.destroy(new Error('localhost S3 응답 시간 초과'))); req.on('error', rejectRequest); req.end(body);
  });
  return { objects, attempts, send, close: () => new Promise<void>((resolve, rejectClose) => server.close(e => e ? rejectClose(e) : resolve())) };
}

test('localhost S3 실제 PUT/GET·조건부 CopyObject·잘못된 MD5/secret/만료 거절', async () => {
  const s = await miniS3();
  try {
    const key = 'direct-pending/시험 파일 +%.bin', body = Buffer.from('실제 HTTP 파일 본문\0\u0001\u0002');
    const put = await sign('PUT', key, { 'content-length': String(body.length), 'content-md5': md5(body).toString('base64'), 'content-type': 'application/octet-stream' });
    const uploaded = await s.send('PUT', put, body); assert.equal(uploaded.status, 200);
    const received = await s.send('GET', await sign('GET', key)); assert.equal(received.status, 200); assert.equal(sha256(received.body), sha256(body));
    const from = '/boarder-local/' + key.split('/').map(encodeURIComponent).join('/');
    const copy = await sign('PUT', 'published/copied.bin', { 'x-amz-copy-source': from, 'x-amz-copy-source-if-match': uploaded.etag });
    assert.equal((await s.send('PUT', copy)).status, 200);
    const copied = await s.send('GET', await sign('GET', 'published/copied.bin')); assert.equal(sha256(copied.body), sha256(body));
    const wrongCondition = await sign('PUT', 'published/rejected.bin', { 'x-amz-copy-source': from, 'x-amz-copy-source-if-match': '"wrong"' });
    assert.equal((await s.send('PUT', wrongCondition)).status, 412);
    const wrongBody = Buffer.from(body); wrongBody[0] ^= 1;
    assert.equal((await s.send('PUT', put, wrongBody)).status, 400);
    const wrongSecret = await presign({ ...ENV, R2_BOARDER_SECRET_ACCESS_KEY: 'wrong-fixture-secret' } as DirectEnv, 'GET', key, {}, {}, NOW);
    assert.equal((await s.send('GET', wrongSecret)).status, 403);
    assert.equal((await s.send('GET', await sign('GET', key, {}, {}, new Date(NOW.getTime() - 901000)))).status, 403);
    assert.equal(s.objects.has('/boarder-local/published/rejected.bin'), false);
  } finally { await s.close(); }
});

test('localhost S3 8MiB multipart: 실패한 두 번째 조각만 재전송하고 합친 파일 hash 확인', async () => {
  const s = await miniS3();
  try {
    assert.equal(PART_SIZE, 8 * 1024 * 1024);
    const key = 'direct-pending/multipart.bin', bytes = Buffer.alloc(2 * PART_SIZE + 123);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const start = await s.send('POST', await sign('POST', key, { 'content-length': '0' }, { uploads: '' })); assert.equal(start.status, 200);
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(start.body.toString())![1], parts: { number: number; etag: string }[] = [];
    for (let number = 1; number <= 3; number++) {
      const chunk = bytes.subarray((number - 1) * PART_SIZE, Math.min(number * PART_SIZE, bytes.length));
      const signed = await sign('PUT', key, { 'content-length': String(chunk.length), 'content-md5': md5(chunk).toString('base64') }, { partNumber: String(number), uploadId });
      let response = await s.send('PUT', signed, chunk);
      if (number === 2) { assert.equal(response.status, 500); response = await s.send('PUT', signed, chunk); }
      assert.equal(response.status, 200); parts.push({ number, etag: response.etag });
    }
    const xml = Buffer.from('<CompleteMultipartUpload>' + parts.map(part => `<Part><PartNumber>${part.number}</PartNumber><ETag>${part.etag}</ETag></Part>`).join('') + '</CompleteMultipartUpload>');
    const complete = await s.send('POST', await sign('POST', key, { 'content-length': String(xml.length), 'content-type': 'application/xml', 'content-md5': md5(xml).toString('base64') }, { uploadId }), xml);
    assert.equal(complete.status, 200);
    const result = await s.send('GET', await sign('GET', key)); assert.equal(result.status, 200);
    assert.equal(result.body.length, bytes.length); assert.equal(sha256(result.body), sha256(bytes));
    assert.deepEqual([...s.attempts], [[1, 1], [2, 2], [3, 1]]);
  } finally { await s.close(); }
});

test('실제 shared uploadDirect가 localhost S3의 두 번째 조각500을 재시도해 최종 SHA256 일치', async () => {
  const { uploadDirect } = await import('../../../packages/cli/src/direct-upload.mjs');
  const s = await miniS3(), originalFetch = globalThis.fetch;
  try {
    const key = 'direct-pending/shared-client.bin', bytes = Buffer.alloc(2 * PART_SIZE + 123);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 19) % 251;
    let uploadId = '';
    const actions: string[] = [], progress: number[] = [];
    // 운영 URL의 서명 요소는 보존하고 이 가짜 host의 전송만 localhost로 보낸다.
    globalThis.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname !== 'local-fixture.r2.cloudflarestorage.com') return originalFetch(input, options);
      assert.equal(options?.method, 'PUT'); assert.equal(options?.credentials, 'omit');
      assert.ok(options?.body instanceof Blob);
      const headers = Object.fromEntries(new Headers(options?.headers));
      assert.equal(new Headers(headers).has('authorization'), false);
      const sent = await s.send('PUT', { url: url.href, headers }, Buffer.from(await options.body.arrayBuffer()));
      return new Response(sent.body, { status: sent.status, headers: sent.etag ? { etag: sent.etag } : {} });
    };
    const result = await uploadDirect(new Blob([bytes]), {
      init: { size: bytes.length, mime: 'application/octet-stream' }, progress: (fraction: number) => progress.push(fraction),
      control: async (action: string, body: any) => {
        actions.push(action === 'part' ? `part:${body.number}` : action);
        if (action === 'init') {
          assert.equal(body.size, bytes.length);
          const response = await s.send('POST', await sign('POST', key, { 'content-length': '0' }, { uploads: '' }));
          assert.equal(response.status, 200);
          uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(response.body.toString())![1];
          return { id: uploadId, size: bytes.length, partSize: PART_SIZE, parts: Math.ceil(bytes.length / PART_SIZE) };
        }
        assert.equal(body.id, uploadId);
        if (action === 'part') {
          const chunk = bytes.subarray((body.number - 1) * PART_SIZE, Math.min(body.number * PART_SIZE, bytes.length));
          return sign('PUT', key, { 'content-length': String(chunk.length), 'content-md5': md5(chunk).toString('base64') }, { uploadId, partNumber: String(body.number) });
        }
        assert.equal(action, 'complete');
        assert.deepEqual(body.parts.map((part: any) => part.partNumber), [1, 2, 3]);
        for (const part of body.parts) assert.match(part.etag, /^[0-9a-f]{32}$/);
        const xml = Buffer.from('<CompleteMultipartUpload>' + body.parts.map((part: any) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>"${part.etag}"</ETag></Part>`).join('') + '</CompleteMultipartUpload>');
        const response = await s.send('POST', await sign('POST', key, { 'content-length': String(xml.length), 'content-md5': md5(xml).toString('base64'), 'content-type': 'application/xml' }, { uploadId }), xml);
        assert.equal(response.status, 200);
        return { key, size: bytes.length };
      },
    });
    assert.equal(result.size, 2 * 8 * 1024 * 1024 + 123);
    assert.deepEqual(actions, ['init', 'part:1', 'part:2', 'part:2', 'part:3', 'complete']);
    assert.deepEqual([...s.attempts], [[1, 1], [2, 2], [3, 1]]);
    assert.equal(progress.at(-1), 1);
    const downloaded = await s.send('GET', await sign('GET', key));
    assert.equal(downloaded.status, 200); assert.equal(downloaded.body.length, bytes.length);
    assert.equal(sha256(downloaded.body), sha256(bytes));
  } finally { globalThis.fetch = originalFetch; await s.close(); }
});
