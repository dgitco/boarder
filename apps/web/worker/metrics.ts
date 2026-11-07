// Positional schema: blob and double order must stay stable. No identity, URL, or user content.
export type MetricsEnv = { METRICS?: { writeDataPoint(p: { indexes: string[]; blobs: string[]; doubles: number[] }): void } };
const number = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const tag = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,64}$/.test(v) ? v : '';
const flag = (v: unknown) => typeof v === 'boolean' ? String(v) : '';
const UI_NUMBERS = ['ms', 'sample', 'rtt', 'n', 'max', 'block', 'idle_s', 'longtasks', 'visible_ms', 'observed_ms', 'lf_supported', 'lf_complete', 'lf_channel', 'lf_thread', 'lf_cards', 'lf_scroll', 'lf_other'] as const;
const REQUEST_NUMBERS = ['total_ms', 'sample', 'd1_read_ms', 'd1_read_n', 'd1_write_ms', 'd1_write_n', 'do_ms', 'do_n', 'claim_ms', 'auth_ms', 'r2_ms', 'r2_n'] as const;
const ACTION = /^(first_screen|ttfb|first_paint|interactive|page_load|channel_open|thread_open|send_roundtrip|send_settled|send_visible|reaction|reconnect|long_frame|idle_cost|type_lag|tree_draw|chat_load|card_open|canvas_open|search|live_[a-z_]{1,20}|view_[a-z]{1,12})$/;

// Only route templates enter AE. A bridge wildcard cannot safely identify a route.
const FIXED_PATHS = new Set(['/', '/mcp', '/api/data', '/api/topics', '/api/inbox', '/api/chats', '/api/chat', '/api/chatlog', '/api/sesslog', '/api/nodechat', '/api/history', '/api/arts', '/api/drafts', '/api/draft', '/api/search', '/api/live', '/api/events', '/api/answer', '/api/todo', '/api/cardcheck', '/api/artnote', '/api/artfolder', '/api/artstar', '/api/artthumb']);
export function metricPath(v: unknown, actual?: unknown) {
  if (typeof v === 'string' && v.startsWith('/') && !v.includes('*') && !/[?@#]/.test(v)) return v.replace(/:[A-Za-z0-9_]+/g, ':id').slice(0, 100);
  if (typeof actual !== 'string') return '/:other';
  if (FIXED_PATHS.has(actual)) return actual;
  if (/^\/api\/chat\/[^/]+(?:\/[^/]+)?$/.test(actual)) return actual.split('/').length > 4 ? '/api/chat/:id/:id' : '/api/chat/:id';
  if (/^\/(chat|canvas|nodes|m|w)\//.test(actual)) return '/' + actual.split('/')[1] + '/:id';
  return '/:other';
}
export function writeMetric(env: MetricsEnv, event: string, p: Record<string, unknown>) {
  if (!env.METRICS || !['boarder_request', 'boarder_ui'].includes(event)) return;
  const ui = event === 'boarder_ui';
  const doubles = (ui ? UI_NUMBERS : REQUEST_NUMBERS).map(k => typeof p[k] === 'boolean' ? +p[k] : number(p[k], k === 'sample' ? 1 : -1));
  try {
    env.METRICS.writeDataPoint({ indexes: [event], blobs: [event, ui ? '' : metricPath(p.metrics_path), tag(p.method), tag(p.via), String(number(p.status)), tag(p.hb_ver), tag(p.bx_ver), tag(p.colo), ui && typeof p.action === 'string' && ACTION.test(p.action) ? p.action : '', tag(p.net), flag(p.mobile), flag(p.pwa), flag(p.hidden), flag(p.focus)], doubles });
  } catch { /* Metrics must never fail a request. The binding queues without I/O. */ }
}
const MAX_BODY = 4096;
const rates = new Map<string, { at: number; n: number }>();
export async function uiMetric(req: Request, env: MetricsEnv, authenticate: () => Promise<string | null>): Promise<Response> {
  const reply = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
  const origin = req.headers.get('origin'), site = req.headers.get('sec-fetch-site');
  if (req.headers.get('x-hb') !== '1' || (origin && origin !== new URL(req.url).origin) || (site && site !== 'same-origin' && site !== 'none')) return reply(403);
  if (!req.headers.get('content-type')?.startsWith('application/json')) return reply(415);
  if (Number(req.headers.get('content-length')) > MAX_BODY) return reply(413);
  const me = await authenticate(); if (!me) return reply(401);
  const now = Date.now(), rate = rates.get(me);
  if (rate && now - rate.at < 60_000) { if (++rate.n > 120) return reply(429); }
  else { if (rates.size > 5000) rates.clear(); rates.set(me, { at: now, n: 1 }); }
  let raw = '';
  const reader = req.body?.getReader(); if (!reader) return reply(400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > MAX_BODY) { void reader.cancel().catch(() => {}); return reply(413); } chunks.push(value); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    raw = new TextDecoder().decode(bytes);
  } catch { return reply(400); }
  let p: Record<string, unknown>;
  try { p = JSON.parse(raw); } catch { return reply(400); }
  if (!p || Array.isArray(p) || typeof p.action !== 'string' || !ACTION.test(p.action) || typeof p.ms !== 'number' || !Number.isFinite(p.ms) || p.ms < -1 || p.ms > 86_400_000) return reply(400);
  // Sampling is already applied by shell.js. Never accept a client-selected event/identity/path.
  writeMetric(env, 'boarder_ui', { ...p, sample: Math.max(1, Math.min(1000, number(p.sample, 1))) });
  return reply(204);
}
