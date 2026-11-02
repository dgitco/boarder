import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-canvas-'));
process.env.BOARDER_HOME = path.join(tmp, 'home');   // 실제 기기 설정은 안 읽음
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const { canvasPut, canvasList, collect, normId, LIMITS } = await import('./canvas.mjs');

function folder(files) {
  const d = fs.mkdtempSync(path.join(tmp, 'c-'));
  for (const [p, v] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true }); fs.writeFileSync(path.join(d, p), v); }
  return d;
}
async function withServer(fn) {
  const hits = [];
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    hits.push({ method: req.method, url: req.url, auth: req.headers.authorization, form: req.method === 'POST' ? await new Response(body, { headers: { 'content-type': req.headers['content-type'] } }).formData() : null });
    res.setHeader('content-type', 'application/json');
    res.end(req.method === 'POST' ? JSON.stringify({ ok: true, id: 'AbcdefAbcdef0123456789', title: '가상', files: 2, replaced: false, url: 'http://x/art/AbcdefAbcdef0123456789/' }) : JSON.stringify({ canvases: [{ id: 'AbcdefAbcdef0123456789', title: '가상', acct: '', files: 2 }] }));
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
    assert.equal(hits.length, 1);
    const h = hits[0];
    assert.equal(h.url, '/api/me/canvas'); assert.equal(h.auth, 'Bearer bxd_made_up_token_for_test_000000000');
    assert.deepEqual(JSON.parse(h.form.get('manifest')).map(x => x.path), ['img/a.png', 'index.html']);
    assert.equal(h.form.get('id'), '0f1e2d3c4b5a69788796a5b4c3d2e1f0');
    assert.equal(h.form.get('title'), '가상 제목'); assert.equal(h.form.get('acct'), '계정 2');
    assert.equal(await h.form.get('f0').text(), 'png'); assert.equal(await h.form.get('f1').text(), '<title>가상</title>');
    const l = []; await canvasList({ log: s => l.push(s) });
    assert.match(l[0], /AbcdefAbcdef0123456789\s+가상/);
  });
});

test('상한 · 꼴은 보내기 전에 멈춤: index.html 없음 · 큰 파일 · 많은 파일 · 나쁜 id', async () => {
  await withServer(async hits => {
    await assert.rejects(canvasPut(folder({ 'page.html': 'x' }), {}, { log: () => {} }), /index\.html/);
    await assert.rejects(canvasPut(folder({ 'index.html': 'x', 'big.bin': Buffer.alloc(LIMITS.file + 1) }), {}, { log: () => {} }), /너무 커요/);
    const many = { 'index.html': 'x' }; for (let i = 0; i < LIMITS.files; i++) many[`f${i}.txt`] = 'x';
    await assert.rejects(canvasPut(folder(many), {}, { log: () => {} }), /너무 많아요/);
    await assert.rejects(canvasPut(folder({ 'index.html': 'x' }), { id: 'short' }, { log: () => {} }), /--id/);
    assert.equal(hits.length, 0);
  });
  assert.equal(normId(undefined), undefined);
  assert.equal(collect(folder({ 'index.html': 'x' })).files.length, 1);
});
