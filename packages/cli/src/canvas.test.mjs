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

async function withTodoServer(fn, { askStatus = 200 } = {}) {
  const hits = [];
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    hits.push({ url: req.url, auth: req.headers.authorization, json: req.url === '/api/me/canvas' ? null : JSON.parse(body || '{}') });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/me/canvas') return res.end(JSON.stringify({ ok: true, id: 'AbcdefAbcdef0123456789', title: '가상 검토 페이지', files: 1, replaced: false, url: 'http://x/art/AbcdefAbcdef0123456789/' }));
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
    assert.deepEqual(hits.map(h => h.url), ['/api/me/canvas', '/api/device/window', '/api/agent/inbox_ask']);
    const ask = hits[2];
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
