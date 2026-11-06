import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
register('./test-hooks.mjs', import.meta.url);
const media = await import('./direct-media.ts');
const uploads = await import('./direct-uploads.ts');
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0093_direct_upload.sql', import.meta.url), 'utf8'));
  db.exec('CREATE TABLE emoji(name TEXT PRIMARY KEY,key TEXT,mime TEXT,by_email TEXT,at INTEGER)');
  const stmt = (sql: string, args: any[] = []): any => ({ bind: (...a: any[]) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } }) });
  const objects = new Map<string, { body: Uint8Array; customMetadata: Record<string, string> }>();
  const env = { DB: { prepare: (s: string) => stmt(s) }, R2_ACCOUNT_ID: 'account', R2_BOARDER_ACCESS_KEY_ID: 'fake', R2_BOARDER_SECRET_ACCESS_KEY: 'fake', RESULTS: {
    head: async (key: string) => { const o = objects.get(key); return o ? { ...o, size: o.body.length, etag: 'etag' } : null; },
    get: async (key: string, opts?: any) => { const o = objects.get(key); return o ? { arrayBuffer: async () => o.body.slice(0, opts?.range?.length ?? o.body.length).buffer } : null; },
    delete: async (key: string) => { objects.delete(key); },
  } } as any;
  function stage(id: string, body = PNG) {
    const row = db.prepare('SELECT source,metadata FROM direct_upload WHERE id=?').get(id) as any;
    objects.set(row.source, { body, customMetadata: JSON.parse(row.metadata) });
  }
  const copy = async (url: any, opts: any) => {
    const key = new URL(url).pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    const source = opts.headers['x-amz-copy-source'].split('/').slice(2).map(decodeURIComponent).join('/');
    objects.set(key, objects.get(source)!);
    return new Response('<CopyObjectResult><ETag>etag</ETag></CopyObjectResult>');
  };
  return { db, env, objects, stage, copy };
}

test('사진 제한과 MIME를 지키며 남의 업로드 세션은 조회할 수 없다', async () => {
  const { env } = setup();
  await assert.rejects(media.init(env, 'a@example.com', 'photo', { size: 1500001, mime: 'image/png' }), /너무/);
  await assert.rejects(media.init(env, 'a@example.com', 'photo', { size: 12, mime: 'text/html' }), /사진만/);
  const session = await media.init(env, 'a@example.com', 'photo', { size: 12, mime: 'image/png' });
  await assert.rejects(media.act(env, 'b@example.com', 'photo', 'part', { id: session.id, number: 1 }), /없는/);
});

test('사진을 R2 머리 16바이트로 검사하고 서버가 새 blob ID로 게시한다', async () => {
  const { env, stage, copy, objects } = setup(), old = globalThis.fetch;
  globalThis.fetch = copy as any;
  try {
    const session = await media.init(env, 'a@example.com', 'photo', { size: 12, mime: 'image/png', blob: '0'.repeat(32) });
    stage(session.id);
    const done = await media.act(env, 'a@example.com', 'photo', 'complete', { id: session.id, parts: [] }) as any;
    assert.match(done.id, /^[0-9a-f]{32}$/); assert.notEqual(done.id, '0'.repeat(32));
    assert.ok(objects.has('blobs/' + done.id));
  } finally { globalThis.fetch = old; }
});

test('PNG로 선언한 HTML은 게시하지 않는다', async () => {
  const { env, stage, objects } = setup();
  const session = await media.init(env, 'a@example.com', 'photo', { size: 12, mime: 'image/png' });
  stage(session.id, new TextEncoder().encode('<script>1234'));
  await assert.rejects(media.act(env, 'a@example.com', 'photo', 'complete', { id: session.id, parts: [] }), /이미지/);
  assert.equal([...objects.keys()].filter(k => k.startsWith('blobs/')).length, 0);
});

test('한글 이모지 이름을 서명 헤더에 안전하게 담고 완료 등록은 재시도해도 하나다', async () => {
  const { env, stage, copy, db } = setup(), old = globalThis.fetch, std = new Set(['smile']);
  globalThis.fetch = copy as any;
  try {
    const session = await media.init(env, 'a@example.com', 'emoji', { size: 12, mime: 'image/png', name: '한글' }, std);
    const signed = await media.act(env, 'a@example.com', 'emoji', 'part', { id: session.id, number: 1 }, std) as any;
    assert.equal(signed.headers['x-amz-meta-name'], encodeURIComponent('한글'));
    stage(session.id);
    const done = await media.act(env, 'a@example.com', 'emoji', 'complete', { id: session.id, parts: [] }, std) as any;
    assert.equal(done.name, '한글'); assert.match(done.url, /^emoji\/i\/[0-9a-f]{64}-[0-9a-f]{16}\.png$/);
    await media.act(env, 'a@example.com', 'emoji', 'complete', { id: session.id, parts: [] }, std);
    assert.equal((db.prepare('SELECT count(*) n FROM emoji').get() as any).n, 1);
  } finally { globalThis.fetch = old; }
});

test('동시에 등록된 같은 이모지 이름은 복사 전에 거절한다', async () => {
  const { env, stage, db } = setup(), std = new Set(['smile']);
  const session = await media.init(env, 'a@example.com', 'emoji', { size: 12, mime: 'image/png', name: 'test-name' }, std);
  db.prepare('INSERT INTO emoji(name,key) VALUES (?,?)').run('test-name', 'emoji/other'); stage(session.id);
  await assert.rejects(media.act(env, 'a@example.com', 'emoji', 'complete', { id: session.id, parts: [] }, std), /같은 이름/);
});

test('기존 바이너리 요청은 본문을 읽지 않고 415로 거절한다', async () => {
  const c = { req: { header: () => 'image/png', raw: { get body() { throw Error('본문을 읽으면 안 됨'); } } }, json: (body: any, status: number) => ({ body, status }) };
  assert.equal((await media.handle(c as any, 'a@example.com', 'photo', 'init') as any).status, 415);
  assert.equal(media.imageType(PNG), 'image/png');
});

test('직접 업로드 설정 503만 호환 전환용 코드를 전달한다', async () => {
  const { env } = setup(); delete env.R2_BOARDER_ACCESS_KEY_ID;
  const request = new Request('https://example.test/api/me/bot/image/init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ size: 12, mime: 'image/png' }) });
  const c = { env, req: { header: (name: string) => request.headers.get(name), raw: request }, json: (body: any, status = 200) => ({ body, status }) };
  const result = await media.handle(c as any, 'a@example.com', 'photo', 'init') as any;
  assert.equal(result.status, 503); assert.equal(result.body.code, 'direct_upload_unavailable');
  const dbFailure = setup(); dbFailure.env.DB.prepare = () => { throw new Error('DB error'); };
  const failingRequest = new Request('https://example.test/api/me/bot/image/init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ size: 12, mime: 'image/png' }) });
  const failure = await media.handle({ ...c, env: dbFailure.env, req: { header: (name: string) => failingRequest.headers.get(name), raw: failingRequest } } as any, 'a@example.com', 'photo', 'init') as any;
  assert.equal(failure.status, 503); assert.equal(failure.body.code, undefined, '일반 DB 장애는 구형 업로드로 전환하지 않음');
});

for (const script of ['botpick.js', 'settings.js']) test(`${script}: 모듈 import 실패 뒤 GET으로 미지원이 확인될 때만 구형 콜백 사용`, async () => {
  const source = readFileSync(new URL('./legacy/' + script, import.meta.url), 'utf8');
  const fn = source.match(/  async function uploadModule\(\)\{[\s\S]+?\n  \}/)![0].replace("import('/direct-upload.js')", 'loadModule()');
  const original = new Error('original import failure');
  const build = (loadModule: any, fetch: any) => runInNewContext('(' + fn + ')', { loadModule, fetch });
  for (const status of [404, 405, 410, 501]) {
    let legacy = 0, requests = 0;
    const loader = build(async () => { throw original; }, async (url: string, options: any) => {
      requests++; assert.equal(url, '/direct-upload.js'); assert.equal(options.method, 'GET'); return { status };
    });
    const module = await loader();
    assert.equal(await module.uploadDirect(null, { legacy: () => ++legacy }), 1);
    assert.equal(legacy, 1); assert.equal(requests, 1);
  }
  for (const status of [200, 401, 403, 503]) {
    await assert.rejects(build(async () => { throw original; }, async () => ({ status }))(), error => error === original);
  }
  await assert.rejects(build(async () => { throw original; }, async () => { throw new Error('network failure'); })(), error => error === original);
  const module = { uploadDirect: () => 'direct' };
  assert.equal(await build(async () => module, async () => { throw new Error('추가 요청 금지'); })(), module);
});
