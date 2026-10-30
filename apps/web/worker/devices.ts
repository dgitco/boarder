type DB = D1Database;
export const METRICS_MAX_BYTES = 16_384;
const MIN_GAP_MS = 20_000;          // 기기 하나가 너무 자주 올리면 이력은 안 쌓음(최신 값만 바꿈)
const HIST_MS = 48 * 3600_000;
const AGENTS = ["claude", "codex", "cursor", "gemini"] as const;

const CTRL = /[\x00-\x1f\x7f-\x9f]/g;
const str = (v: unknown, n: number) => typeof v === "string" ? v.replace(CTRL, "").trim().slice(0, n) : undefined;
const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10) / 10 : undefined;
const int = (v: unknown, lo: number, hi: number) => { const n = num(v, lo, hi); return n === undefined ? undefined : Math.round(n); };
const time = (v: unknown) => { const s = str(v, 40); return s && /^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:?\d\d)?$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined; };
const email = (v: unknown) => { const s = str(v, 200); return s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s.toLowerCase() : undefined; };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const drop = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

// 몸을 n 바이트까지만 읽음 — 넘으면 null(읽기를 멈추고 버림)
export async function readCapped(body: ReadableStream<Uint8Array> | null, n: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const rd = body.getReader(), parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    size += value.byteLength; if (size > n) { await rd.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(size); let o = 0; for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}
export const MIN_WRITE_MS = 10_000;
export async function tooSoon(db: DB, id: string, now = Date.now()) {
  const r = await db.prepare("SELECT at FROM device_metric WHERE device_id = ?").bind(id).first<{ at: number }>();
  return !!r && now - r.at < MIN_WRITE_MS;
}

export type Metrics = ReturnType<typeof cleanMetrics>;
export function cleanMetrics(raw: unknown) {
  const b = obj(raw), host = obj(b.host), mem = obj(b.mem), cpu = obj(b.cpu), disk = obj(b.disk), tmp = obj(b.tmp), ag = obj(b.agents);
  const accounts = (Array.isArray(b.accounts) ? b.accounts : []).slice(0, 8).map(a => {
    const x = obj(a);
    return drop({
      email: email(x.email),
      status: (["ok", "logged_out", "token_stale", "error", "unknown"] as const).find(s => s === x.status) || "unknown",
      plan: str(x.plan, 40),
      p5: num(x.p5, 0, 100), r5: time(x.r5),
      p7: num(x.p7, 0, 100), r7: time(x.r7),       // 주간
      src: (["api", "cache"] as const).find(s => s === x.src),
    });
  });
  return {
    v: 1,
    host: drop({ name: str(host.name, 80), os: str(host.os, 20), arch: str(host.arch, 20), uptime_s: int(host.uptime_s, 0, 1e9), cli: str(host.cli, 20) }),
    // 가용 메모리 = /proc/meminfo MemAvailable(work · pane 의 6GB 검사와 같은 값). min_mb = 그 기준
    mem: drop({ total_mb: int(mem.total_mb, 0, 1e8), avail_mb: int(mem.avail_mb, 0, 1e8), min_mb: int(mem.min_mb, 0, 1e8) }),
    cpu: drop({ pct: num(cpu.pct, 0, 100), load1: num(cpu.load1, 0, 1e4), load5: num(cpu.load5, 0, 1e4), cores: int(cpu.cores, 0, 4096) }),
    // 디스크 = df -P / 의 Use%(server-watchdog 과 같은 값, 90% 경고). tmp = df -P /tmp(65% 경고)
    disk: drop({ pct: int(disk.pct, 0, 100), free_gb: num(disk.free_gb, 0, 1e7), total_gb: num(disk.total_gb, 0, 1e7) }),
    tmp: drop({ pct: int(tmp.pct, 0, 100) }),
    agents: Object.fromEntries(AGENTS.map(k => [k, int(ag[k], 0, 10_000) ?? 0])) as Record<typeof AGENTS[number], number>,
    accounts,
  };
}

export async function putMetrics(db: DB, dev: { id: string; owner: string }, raw: unknown, now = Date.now()) {
  const m = cleanMetrics(raw), data = JSON.stringify(m);
  const last = await db.prepare("SELECT at FROM device_metric WHERE device_id = ?").bind(dev.id).first<{ at: number }>();
  const hist = !last || now - last.at >= MIN_GAP_MS;
  const agents = Object.values(m.agents).reduce((a, b) => a + b, 0);
  await db.batch([
    db.prepare("INSERT INTO device_metric(device_id, owner, at, data) VALUES (?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET owner = excluded.owner, at = excluded.at, data = excluded.data").bind(dev.id, dev.owner, now, data),
    db.prepare("UPDATE device SET last_at = ? WHERE id = ?").bind(now, dev.id),
    ...(hist ? [
      db.prepare("INSERT INTO device_metric_hist(device_id, at, mem_avail_mb, cpu_pct, disk_pct, agents) VALUES (?,?,?,?,?,?)").bind(dev.id, now, m.mem.avail_mb ?? null, m.cpu.pct ?? null, m.disk.pct ?? null, agents),
      db.prepare("DELETE FROM device_metric_hist WHERE device_id = ? AND at < ?").bind(dev.id, now - HIST_MS),
    ] : []),
  ]);
  return { ok: true, at: now, kept: hist };
}

export async function listDevices(db: DB, me: string, now = Date.now()) {
  const [dv, mt, hs] = await db.batch([
    db.prepare("SELECT id, name, tools, scope, created_at, last_at FROM device WHERE owner = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 50").bind(me),
    db.prepare("SELECT m.device_id, m.at, m.data FROM device_metric m JOIN device d ON d.id = m.device_id WHERE d.owner = ? AND d.revoked_at IS NULL").bind(me),
    db.prepare("SELECT h.device_id, h.at, h.mem_avail_mb, h.cpu_pct, h.disk_pct, h.agents FROM device_metric_hist h JOIN device d ON d.id = h.device_id WHERE d.owner = ? AND d.revoked_at IS NULL AND h.at > ? ORDER BY h.at").bind(me, now - 24 * 3600_000),
  ]);
  const met = new Map((mt.results as { device_id: string; at: number; data: string }[]).map(r => [r.device_id, r]));
  const hist = new Map<string, unknown[]>();
  for (const r of hs.results as { device_id: string }[]) { const { device_id, ...p } = r; (hist.get(device_id) || hist.set(device_id, []).get(device_id)!).push(p); }
  return (dv.results as { id: string; name: string; tools: string; scope: string; created_at: number; last_at: number }[]).map(d => {
    const m = met.get(d.id);
    let metrics = null; try { metrics = m ? JSON.parse(m.data) : null; } catch {}
    return { ...d, metrics_at: m?.at ?? null, metrics, history: hist.get(d.id) || [] };
  });
}
