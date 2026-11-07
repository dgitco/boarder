import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { writeMetric, uiMetric, metricPath } from './metrics.ts';

const point = (env: any = {}) => { const rows: any[] = []; return { rows, env: { ...env, METRICS: { writeDataPoint: (p: any) => rows.push(p) } } }; };
const req = (body: any, headers: Record<string, string> = {}) => new Request('https://boarder.test/api/clientlog/metrics', { method: 'POST', headers: { 'x-hb': '1', 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const payload = { action: 'channel_open', ms: 123, sample: 10, hb_ver: 'abc123', bx_ver: 'def456' };

test('binding absent or throwing cannot break a request', async () => {
  assert.doesNotThrow(() => writeMetric({}, 'boarder_request', {}));
  assert.doesNotThrow(() => writeMetric({ METRICS: { writeDataPoint() { throw Error('offline'); } } }, 'boarder_request', {}));
  assert.equal((await uiMetric(req(payload), {}, async () => 'member@example.com')).status, 204);
});
test('request schema allows only timing/route template fields, no identity or URL', () => {
  const { env, rows } = point();
  writeMetric(env, 'boarder_request', { metrics_path: '/api/chat/:channel', method: 'GET', total_ms: 34, sample: 10, status: 200, email: 'private@example.com', path: '/api/chat/private', rid: 'private', text: 'secret', current_url: 'https://private' });
  assert.equal(rows[0].blobs[1], '/api/chat/:id'); assert.equal(rows[0].doubles[1], 10);
  assert.doesNotMatch(JSON.stringify(rows), /private|secret|https|email/);
  assert.equal(rows[0].doubles[8], -1, 'absent claim excluded from its quantiles');
});
test('endpoint authenticates, rejects cross-origin, malformed, unknown events and oversized bodies', async () => {
  const { env, rows } = point();
  assert.equal((await uiMetric(req(payload), env, async () => null)).status, 401);
  assert.equal((await uiMetric(req(payload, { origin: 'https://elsewhere.test' }), env, async () => 'a')).status, 403);
  assert.equal((await uiMetric(req(payload, { 'x-hb': '' }), env, async () => 'a')).status, 403);
  assert.equal((await uiMetric(req('bad json'), env, async () => 'a')).status, 400);
  assert.equal((await uiMetric(req({ ...payload, action: 'message_body' }), env, async () => 'a')).status, 400);
  assert.equal((await uiMetric(req('x'.repeat(4097)), env, async () => 'a')).status, 413);
  assert.equal((await uiMetric(req(payload, { 'content-length': '5000' }), env, async () => 'a')).status, 413);
  assert.equal(rows.length, 0);
});
test('UI schema preserves versions and same sample, removes arbitrary data', async () => {
  const { env, rows } = point();
  const response = await uiMetric(req({ ...payload, text: 'secret', path: '/private', user_id: 'private', lf_top: { src: 'private' } }), env, async () => 'member2@example.com');
  assert.equal(response.status, 204); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(rows[0].blobs.slice(5, 7), ['abc123', 'def456']);
  assert.equal(rows[0].doubles[0], 123); assert.equal(rows[0].doubles[1], 10);
  assert.doesNotMatch(JSON.stringify(rows), /member|secret|private/);
});
test('bounded per-member rate prevents a burst from writing unlimited points', async () => {
  const { env, rows } = point(); let last;
  for (let i = 0; i < 121; i++) last = await uiMetric(req(payload), env, async () => 'rate@example.com');
  assert.equal(last!.status, 429); assert.equal(rows.length, 120);
});
test('browser sends same event without waiting for network or PostHog', () => {
  const source = readFileSync(new URL('./legacy/shell.js', import.meta.url), 'utf8');
  const start = source.indexOf('  const metricFetch = '), end = source.indexOf('  window.BX_UI = send;', start);
  const sent: any[] = [], ph: any[] = [];
  const context = { window: { fetch: (...a: any[]) => { sent.push(a); return new Promise(() => {}); }, posthog: { capture: (...a: any[]) => ph.push(a) } }, PCQ: { matches: true }, matchMedia: () => ({ matches: false }), net: () => ({}), VER: { hb_ver: 'abc', bx_ver: 'def' } };
  vm.runInNewContext(source.slice(start, end) + "\nsend('idle_cost', 12, {longtasks: 3, hidden: true, text: 'secret', lf_top: {src: 'private'}});", context);
  assert.equal(sent.length, 1); assert.equal(ph.length, 1);
  assert.equal(sent[0][0], '/api/clientlog/metrics'); assert.equal(JSON.parse(sent[0][1].body).hidden, true);
  assert.doesNotMatch(sent[0][1].body, /secret|private/);
});

test('wildcard board routes remain distinguishable without channel names or IDs', () => {
  for (const p of ['/api/chats', '/api/data', '/api/topics', '/api/inbox']) assert.equal(metricPath('*', p), p);
  assert.equal(metricPath('*', '/api/chat/private-team'), '/api/chat/:id');
  assert.equal(metricPath('*', '/api/chat/private-team/1794000000.000001'), '/api/chat/:id/:id');
  assert.equal(metricPath('*', '/nodes/private-name'), '/nodes/:id');
  assert.equal(metricPath('*', '/arbitrary/private-name'), '/:other');
});
test('same-origin API fetch adds both versions and preserves request options; external fetch is untouched', async () => {
  const source = readFileSync(new URL('./legacy/shell.js', import.meta.url), 'utf8');
  const start = source.indexOf('  { const f0 = window.fetch; window.fetch = function (u, o){'), end = source.indexOf("  wrap('show'", start);
  const sent: any[] = [], win: any = {fetch: (...a: any[]) => {sent.push(a); return Promise.resolve({status: 200});}};
  vm.runInNewContext(source.slice(start, end), {window: win, Headers, URL, location: {origin: 'https://boarder.test', href: 'https://boarder.test/chat/primary'}, VER: {hb_ver: 'abc', bx_ver: 'def'}, performance, send: () => {}});
  await win.fetch('/api/data', {headers: {'x-hb': '1'}, credentials: 'same-origin', signal: new AbortController().signal});
  assert.equal(sent[0][1].headers.get('x-hb-ver'), 'abc'); assert.equal(sent[0][1].headers.get('x-bx-ver'), 'def'); assert.equal(sent[0][1].headers.get('x-hb'), '1');
  assert.equal(sent[0][1].credentials, 'same-origin'); assert.ok(sent[0][1].signal);
  const opts = {headers: {'private-header': 'ok'}}; await win.fetch('https://external.test/api/data', opts); assert.equal(sent[1][1], opts);
});

test('capture mirrors server samples without requiring a PostHog key or waiting for its fetch', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const source = readFileSync(new URL('./posthog.ts', import.meta.url), 'utf8').replace(/^import .*\n/, '').replace(/^export /gm, '');
  const { env, rows } = point(); const waits: Promise<unknown>[] = [];
  const context: any = { writeMetric, crypto: globalThis.crypto, TextEncoder, Uint8Array, AbortSignal, fetch: () => new Promise(() => {}) };
  vm.runInNewContext(stripTypeScriptTypes(source) + '\nthis.capture = capture;', context);
  context.capture(env, undefined, 'boarder_request', 'private@example.com', {total_ms: 3, sample: 5, metrics_path: '/api/data'});
  assert.equal(rows.length, 1); assert.equal(rows[0].doubles[1], 5);
  context.capture({...env, POSTHOG_KEY: 'public-key'}, {waitUntil: (p: Promise<unknown>) => waits.push(p)}, 'boarder_request', 'agent', {total_ms: 2, sample: 10, metrics_path: '/api/topics'});
  assert.equal(rows.length, 2); assert.equal(waits.length, 1);
});

test('telemetry bypasses the actual board retry/error wrapper for success and failures', async () => {
  const board = readFileSync(new URL('../board-template/page.html', import.meta.url), 'utf8');
  const start = board.indexOf('  window.fetch = async (input, init) => {'), end = board.indexOf('\n  };\n})();\n</script>', start);
  assert.ok(start > 0 && end > start);
  let status = 204, networkError = false; const win: any = {};
  const context: any = {window: win, srvFail: 5, coolUntil: 100, f0: async () => { if (networkError) throw Error('offline'); return new Response(null, {status}); }, rid: () => { throw Error('telemetry entered error wrapper'); }};
  vm.runInNewContext(board.slice(start, end) + '\n  };', context);
  for (const code of [204, 401, 429, 503]) { status = code; assert.equal((await win.fetch('/api/clientlog/metrics', {method: 'POST'})).status, code); }
  networkError = true; await assert.rejects(win.fetch('/api/clientlog/metrics', {method: 'POST'}), /offline/);
  assert.equal(context.srvFail, 5); assert.equal(context.coolUntil, 100);
});
