// node --test packages/cli/src/canvas.test.mjs
// boarder canvas put · list: 폴더 → JSON manifest + R2 직접 PUT · 숨은 파일 · node_modules · 심볼릭 링크는 안 올림 · 상한은 보내기 전에 멈춤 ·
// UUID id 는 「-」 를 떼서 · 기기 토큰을 Bearer 로. 가짜 서버(node:http), 자료는 다 지어낸 것.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-canvas-'));
process.env.BOARDER_HOME = path.join(tmp, 'home');   // 실제 기기 설정은 안 읽음
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const { canvasPut, canvasList, canvasRm, collect, normId, LIMITS } = await import('./canvas.mjs');

function folder(files) {
  const d = fs.mkdtempSync(path.join(tmp, 'c-'));
  for (const [p, v] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true }); fs.writeFileSync(path.join(d, p), v); }
  return d;
}
function canvasResponse(req, res, json) {
  const reply = body => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
  if (req.url === '/api/me/canvas' && req.method === 'POST') return reply({ session: 'signed-test-manifest', uploads: json.manifest.map((f, i) => ({ id: `file${i}`, size: f.size, partSize: f.size, parts: 1 })) });
  if (req.url === '/api/me/canvas/upload/part') return reply({ url: `http://${req.headers.host}/r2/${json.id}`, headers: {} });
  if (req.url.startsWith('/r2/')) { res.setHeader('etag', 'test-etag'); res.end(); return; }
  if (req.url === '/api/me/canvas/upload/complete' || req.url === '/api/me/canvas/abort') return reply({ ok: true });
  if (req.url === '/api/me/canvas/publish') return reply({ ok: true, id: 'AbcdefAbcdef0123456789', title: '가상 검토 페이지', files: 2, replaced: false, url: 'http://x/art/AbcdefAbcdef0123456789/' });
  if (req.url.startsWith('/api/me/canvas')) return reply({ canvases: [{ id: 'AbcdefAbcdef0123456789', title: '가상', acct: '', files: 2 }] });
  return false;
}
async function withServer(fn) {
  const hits = [];
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks), json = req.method === 'POST' ? JSON.parse(body.toString() || '{}') : null;
    hits.push({ method: req.method, url: req.url, auth: req.headers.authorization, json, body });
    canvasResponse(req, res, json);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  fs.mkdirSync(process.env.BOARDER_HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(process.env.BOARDER_HOME, 'device.json'), JSON.stringify({ token: 'bxd_made_up_token_for_test_000000000', device_id: 'd', server: `http://127.0.0.1:${srv.address().port}` }));
  try { await fn(hits); } finally { srv.close(); }
}

test('put: index.html + 딸린 파일만 · 숨은 파일 · node_modules · 링크는 빼고 · id · 제목 · Bearer', async () => {
  const d = folder({ 'index.html': '<title>가상</title>', 'img/a.png': 'png', '.env': 'SECRET=nope', 'node_modules/x.js': 'x' });
  fs.symlinkSync(path.join(tmp), path.join(d, 'outside'));
  await withServer(async hits => {
    await canvasPut(d, { id: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', title: '가상 제목', acct: '계정 2' }, { log: () => {} });
    assert.equal(hits.length, 8);
    const h = hits[0];
    assert.equal(h.url, '/api/me/canvas'); assert.equal(h.auth, 'Bearer bxd_made_up_token_for_test_000000000');
    assert.deepEqual(h.json.manifest.map(x => x.path), ['img/a.png', 'index.html']);
    assert.equal(h.json.id, '0f1e2d3c4b5a69788796a5b4c3d2e1f0');
    assert.equal(h.json.title, '가상 제목'); assert.equal(h.json.acct, '계정 2');
    assert.equal(hits[2].body.toString(), 'png'); assert.equal(hits[5].body.toString(), '<title>가상</title>');
    assert.equal(hits[2].auth, undefined); assert.equal(hits[5].auth, undefined);
    assert.ok(h.body.length < 1024); assert.equal(hits.at(-1).url, '/api/me/canvas/publish');
    const l = []; await canvasList({ log: s => l.push(s) });
    assert.match(l[0], /AbcdefAbcdef0123456789\s+가상/);
  });
});

test('상한 · 꼴은 보내기 전에 멈춤: index.html 없음 · 큰 파일 · 많은 파일 · 나쁜 id', async () => {
  await withServer(async hits => {
    await assert.rejects(canvasPut(folder({ 'page.html': 'x' }), {}, { log: () => {} }), /index\.html/);
    const big = folder({ 'index.html': 'x', 'big.bin': '' }); fs.truncateSync(path.join(big, 'big.bin'), LIMITS.file + 1);
    await assert.rejects(canvasPut(big, {}, { log: () => {} }), /너무 커요/);
    fs.truncateSync(path.join(big, 'big.bin'), LIMITS.file); fs.truncateSync(path.join(big, 'index.html'), 0);
    assert.equal(collect(big).total, 524288000);
    const many = { 'index.html': 'x' }; for (let i = 0; i < LIMITS.files; i++) many[`f${i}.txt`] = 'x';
    await assert.rejects(canvasPut(folder(many), {}, { log: () => {} }), /너무 많아요/);
    await assert.rejects(canvasPut(folder({ 'index.html': 'x' }), { id: 'short' }, { log: () => {} }), /--id/);
    assert.equal(hits.length, 0);
  });
  assert.equal(normId(undefined), undefined);
  assert.equal(collect(folder({ 'index.html': 'x' })).files.length, 1);
});

async function withTodoServer(fn, { askStatus = 200 } = {}) {
  const hits = [];
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const json = req.method === 'POST' ? JSON.parse(body || '{}') : null;
    hits.push({ url: req.url, auth: req.headers.authorization, json });
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/api/me/canvas') || req.url.startsWith('/r2/')) { canvasResponse(req, res, json); return; }
    if (req.url === '/api/device/window') return res.end(JSON.stringify({ token: 'bxa_' + 'w'.repeat(40) }));
    if (req.url === '/api/agent/inbox_ask') { res.statusCode = askStatus; return res.end(JSON.stringify(askStatus === 200 ? { card_id: '1793000000.000777', thread_id: '1793000000.000777' } : { error: '보드가 잠깐 안 돼요' })); }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const home = fs.mkdtempSync(path.join(tmp, 'h-')); process.env.BOARDER_HOME = home; process.env.BOARDER_WINDOW = 'ew_todo01';
  fs.writeFileSync(path.join(home, 'device.json'), JSON.stringify({ token: 'bxd_made_up_token_for_test_000000000', device_id: 'd', server: `http://127.0.0.1:${srv.address().port}` }));
  try { await fn(hits); } finally { srv.close(); delete process.env.BOARDER_WINDOW; }
}

test('put --todo: 올린 뒤 그 캔버스 주소를 단 할 일 카드(kind todo · 「했어요」) 하나 — 창 토큰으로', async () => {
  await withTodoServer(async hits => {
    const l = [];
    const j = await canvasPut(folder({ 'index.html': 'x' }), { todo: 'Q-1 검토 페이지 확인' }, { log: s => l.push(s) });
    assert.deepEqual(hits.map(h => h.url), ['/api/me/canvas', '/api/me/canvas/upload/part', '/r2/file0', '/api/me/canvas/upload/complete', '/api/me/canvas/publish', '/api/device/window', '/api/agent/inbox_ask']);
    const ask = hits.at(-1);
    assert.equal(ask.auth, 'Bearer bxa_' + 'w'.repeat(40));
    assert.deepEqual(ask.json, { question: 'Q-1 검토 페이지 확인', choices: ['했어요'], kind: 'todo', body: '캔버스: 가상 검토 페이지\nhttp://x/art/AbcdefAbcdef0123456789/' });
    assert.equal(j.todo, '1793000000.000777');
    assert.match(l.at(-1), /할 일: Q-1 검토 페이지 확인/);
  });
});

test('put --todo: 나쁜 할 일 글은 올리기 전에 멈춤 · 카드를 못 세우면 「캔버스는 올렸지만」', async () => {
  await withTodoServer(async hits => {
    for (const bad of ['', '둘\n줄', '-옵션', '가'.repeat(201), true]) await assert.rejects(canvasPut(folder({ 'index.html': 'x' }), { todo: bad }, { log: () => {} }), /--todo/);
    assert.equal(hits.length, 0);
  });
  await withTodoServer(async hits => {
    await assert.rejects(canvasPut(folder({ 'index.html': 'x' }), { todo: '확인해 주세요' }, { log: () => {} }), /캔버스는 올렸지만 할 일 카드를 못 세웠어요: 보드가 잠깐 안 돼요/);
    assert.equal(hits[0].url, '/api/me/canvas');
  }, { askStatus: 503 });
});

test('rm: DELETE /api/me/canvas/<id> 에 Bearer · id 꼴이 틀리면 보내기 전에 멈춤', async () => {
  await withServer(async hits => {
    const l = []; await canvasRm('AbcdefAbcdef0123456789', { log: s => l.push(s) });
    assert.equal(hits.length, 1); assert.equal(hits[0].method, 'DELETE'); assert.equal(hits[0].url, '/api/me/canvas/AbcdefAbcdef0123456789');
    assert.equal(hits[0].auth, 'Bearer bxd_made_up_token_for_test_000000000'); assert.match(l[0], /AbcdefAbcdef0123456789/);
    await assert.rejects(canvasRm('../x'), /--id/); await assert.rejects(canvasRm(undefined), /canvas rm/);
    assert.equal(hits.length, 1);
  });
});

async function withCompatibilityServer(fn, options = {}) {
  const hits = [], srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks), multipart = /^multipart\/form-data/.test(req.headers['content-type'] || '');
    const body = multipart ? await new Response(bytes, { headers: { 'content-type': req.headers['content-type'] } }).formData()
      : req.method === 'POST' ? JSON.parse(bytes.toString() || '{}') : null;
    hits.push({ path: req.url, multipart, body });
    const error = (status, message = '이전 서버', code) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: message, code })); };
    if (req.url === '/api/me/canvas' && !multipart) {
      if (options.disconnect) return req.socket.destroy();
      if (options.initStatus !== 200) return error(options.initStatus ?? 415, options.message, options.code);
    }
    if (multipart) {
      res.setHeader('content-type', 'application/json'); res.setHeader('deprecation', 'true');
      res.end(JSON.stringify({ ok: true, id: 'LegacyCanvas00000000001', title: body.get('title') || '구형', files: JSON.parse(body.get('manifest')).length, replaced: false, url: 'http://x/art/LegacyCanvas00000000001/' })); return;
    }
    if (req.url === options.failPath) return error(options.failStatus ?? 415, '세션 진행 뒤 실패');
    canvasResponse(req, res, body);
  });
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const home = fs.mkdtempSync(path.join(tmp, 'compat-')); process.env.BOARDER_HOME = home;
  fs.writeFileSync(path.join(home, 'device.json'), JSON.stringify({ token: 'bxd_fake_compat_token', server: `http://127.0.0.1:${srv.address().port}` }));
  try { await fn(hits); } finally { srv.close(); }
}

test('새 CLI + 구형 Worker: 초기 지원없음·정확한 구형400·서명설정503에서만 multipart 호환', async () => {
  for (const options of [{ initStatus: 404 }, { initStatus: 405 }, { initStatus: 415 }, { initStatus: 501 },
    { initStatus: 400, message: 'multipart 아님' }, { initStatus: 503, code: 'direct_upload_unavailable' }]) {
    await withCompatibilityServer(async hits => {
      const warnings = [], j = await canvasPut(folder({ 'index.html': '<title>호환</title>', 'a.css': 'p{}' }), { id: 'LegacyCanvas00000000001', title: '호환 제목', acct: '이전 계정' }, { log: () => {}, warn: message => warnings.push(message) });
      assert.equal(j.id, 'LegacyCanvas00000000001'); assert.equal(hits.length, 2);
      assert.equal(hits[0].multipart, false); assert.equal(hits[1].multipart, true);
      const fd = hits[1].body;
      assert.equal(fd.get('id'), 'LegacyCanvas00000000001'); assert.equal(fd.get('title'), '호환 제목'); assert.equal(fd.get('acct'), '이전 계정');
      assert.deepEqual(JSON.parse(fd.get('manifest')), [{ path: 'a.css' }, { path: 'index.html' }]);
      assert.equal(await fd.get('f0').text(), 'p{}'); assert.match(warnings[0], /10MiB.*25MiB/);
    }, options);
  }
});

test('권한·크기·일반 오류·네트워크 실패는 multipart로 재전송하지 않음', async () => {
  for (const options of [{ initStatus: 400, message: 'manifest 오류' }, { initStatus: 401 }, { initStatus: 403 }, { initStatus: 413 },
    { initStatus: 500 }, { initStatus: 503 }, { initStatus: 503, message: '직접 올리기 설정이 아직 준비되지 않았어요' }, { disconnect: true }]) {
    await withCompatibilityServer(async hits => {
      await assert.rejects(canvasPut(folder({ 'index.html': 'x' }), {}, { log: () => {}, warn: () => {} }));
      assert.equal(hits.length, 1); assert.equal(hits[0].multipart, false);
    }, options);
  }
});

test('호환 fallback도 구한도만: 파일10MiB·합25MiB 초과는 본문 없이 멈춤', async () => {
  const scan = () => ({ hits: [], warns: [] });
  const single = folder({ 'index.html': '', 'big.bin': '' }); fs.truncateSync(path.join(single, 'big.bin'), 10 * 1024 * 1024 + 1);
  const total = folder({ 'index.html': '', 'a.bin': '', 'b.bin': '', 'c.bin': '' });
  fs.truncateSync(path.join(total, 'a.bin'), 10 * 1024 * 1024); fs.truncateSync(path.join(total, 'b.bin'), 10 * 1024 * 1024); fs.truncateSync(path.join(total, 'c.bin'), 5 * 1024 * 1024 + 1);
  for (const dir of [single, total]) await withCompatibilityServer(async hits => {
    await assert.rejects(canvasPut(dir, {}, { log: () => {}, warn: () => {}, scan }), { code: 'LEGACY_LIMIT' });
    assert.equal(hits.length, 1); assert.equal(hits[0].multipart, false);
  });
});

test('direct 세션을 받은 뒤 part/publish가 지원없음을 돌려도 중복 게시 fallback 금지', async () => {
  for (const failPath of ['/api/me/canvas/upload/part', '/api/me/canvas/publish']) await withCompatibilityServer(async hits => {
    await assert.rejects(canvasPut(folder({ 'index.html': 'x' }), {}, { log: () => {}, warn: () => {} }));
    assert.ok(hits.some(hit => hit.path === '/api/me/canvas/abort'));
    assert.equal(hits.filter(hit => hit.path === '/api/me/canvas').length, 1);
    assert.equal(hits.some(hit => hit.multipart), false);
  }, { initStatus: 200, failPath, failStatus: 415 });
});
