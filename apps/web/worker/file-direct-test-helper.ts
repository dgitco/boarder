import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { copyFetch, directConfig } from './canvas-direct-test-helper.ts';
export { directConfig };

export function fileD1() {
  const sq = new DatabaseSync(':memory:'), migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sq.exec(readFileSync(new URL(name, migrations), 'utf8'));
  const exec = (sql: string, args: any[]) => {
    const statement = sq.prepare(sql);
    const read = /^\s*(select|with|pragma)\b/i.test(sql);
    if (read || /\bRETURNING\b/i.test(sql)) {
      const results = statement.all(...args);
      return { success: true, results, meta: { changes: read ? 0 : Number((sq.prepare('SELECT changes() n').get() as any).n) } };
    }
    const r = statement.run(...args); return { success: true, results: [], meta: { changes: Number(r.changes) } };
  };
  const stmt = (sql: string, args: any[] = []): any => ({ sql, args, bind: (...a: any[]) => stmt(sql, a),
    first: async (col?: string) => { const r = exec(sql, args).results[0] as any; return r ? (col ? r[col] : r) : null; },
    all: async () => exec(sql, args), run: async () => exec(sql, args), raw: async () => exec(sql, args).results.map(Object.values),
  });
  const DB = { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => {
    sq.exec('BEGIN'); try { const rows = ss.map(s => exec(s.sql, s.args)); sq.exec('COMMIT'); return rows; } catch (e) { sq.exec('ROLLBACK'); throw e; }
  } } as unknown as D1Database;
  return { DB, sq };
}
export function fileR2(failCopies = 0) {
  const m = new Map<string, { b: Uint8Array; customMetadata?: Record<string, string>; httpMetadata?: R2HTTPMetadata }>();
  const obj = (key: string, range?: { offset: number; length: number }) => {
    const o = m.get(key); if (!o) return null;
    const b = range ? o.b.slice(range.offset, range.offset + range.length) : o.b;
    return { key, size: o.b.length, etag: 'test-etag', customMetadata: o.customMetadata, httpMetadata: o.httpMetadata,
      body: new Response(b as BodyInit).body, arrayBuffer: async () => b.slice().buffer, text: async () => new TextDecoder().decode(b),
      writeHttpMetadata(h: Headers) { if (o.httpMetadata?.contentType) h.set('content-type', o.httpMetadata.contentType); },
    };
  };
  const R = {
    put: async (key: string, value: string | ArrayBuffer | Uint8Array, options: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string>; onlyIf?: {etagDoesNotMatch?: string} } = {}) => {
      if (options.onlyIf?.etagDoesNotMatch === "*" && m.has(key)) return null;
      const b = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBuffer); m.set(key, { b, ...options }); return obj(key);
    },
    list: async (o: { prefix?: string; limit?: number } = {}) => { const ks = [...m.keys()].filter(k => k.startsWith(o.prefix || '')).sort().slice(0, o.limit || 1000); return { objects: ks.map(k => obj(k)), truncated: false, delimitedPrefixes: [] }; },
    head: async (key: string) => obj(key), get: async (key: string, options?: { range?: { offset: number; length: number } }) => obj(key, options?.range),
    delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) m.delete(key); },
    createMultipartUpload: async () => ({ uploadId: crypto.randomUUID(), abort: async () => {} }),
    resumeMultipartUpload: () => ({ abort: async () => {} }),
  } as unknown as R2Bucket;
  copyFetch(m, failCopies);
  return { m, R };
}
// 정상 파일 본문은 R2에 직접 넣고 Worker에는 작은 JSON 제어만 보낸다.
export async function uploadFile(post: (suffix: string, body: any) => Promise<Response>, env: { DB: D1Database; RESULTS: R2Bucket }, body: string | Uint8Array, metadata: { name: string; mime: string; key?: string }) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const r = await post('/init', { ...metadata, size: bytes.length }); if (!r.ok) return r;
  const session = await r.json() as any;
  if (session.done) return new Response(JSON.stringify(session), { status: r.status, headers: r.headers });
  const part = await post('/part', { id: session.id, number: 1 }); if (!part.ok) return part;
  const row = await env.DB.prepare('SELECT * FROM direct_upload WHERE id=?').bind(session.id).first<any>();
  await env.RESULTS.put(row.source, bytes, { httpMetadata: { contentType: row.mime }, customMetadata: JSON.parse(row.metadata) });
  return post('/complete', { id: session.id, parts: [{ partNumber: 1, etag: 'test-etag' }] });
}
