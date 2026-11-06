type DB = D1Database;
export const METRICS_MAX_BYTES = 16_384;
const MIN_GAP_MS = 270_000;
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
      acct: str(x.acct, 30) || undefined, name: str(x.name, 20),   // 계정 글자는 자유 글자(화면이 이스케이프) · 길이만 제한
      rate: num(x.rate, 0, 100), out_at: time(x.out_at),
      credits: (c => Object.keys(c).length ? c : undefined)(drop({ limit: num(obj(x.credits).limit, 0, 1e6), used: num(obj(x.credits).used, 0, 1e6), left: num(obj(x.credits).left, 0, 1e6), expires: time(obj(x.credits).expires) })),
    });
  });
  const cx = obj(b.codex);
  const codex = Object.keys(cx).length ? drop({ plan: str(cx.plan, 20), p5: num(cx.p5, 0, 100), r5: time(cx.r5), p7: num(cx.p7, 0, 100), r7: time(cx.r7), balance: num(cx.balance, 0, 1e9), at: time(cx.at) }) : undefined;
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
    ...(codex && Object.keys(codex).length ? { codex } : {}),
  };
}

export async function putMetrics(db: DB, dev: { id: string; owner: string }, raw: unknown, now = Date.now()) {
  const m = cleanMetrics(raw), data = JSON.stringify(m);
  const last = await db.prepare("SELECT max(at) at FROM device_metric_hist WHERE device_id = ?").bind(dev.id).first<{ at: number | null }>();   // 색인(device_id, at)으로 한 줄
  const hist = !last?.at || now - last.at >= MIN_GAP_MS;
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

export const MACHINE_HEADER = "x-boarder-machine";
export const MACHINE_RE = /^[0-9a-f]{32}$/;
const noMachineCol = (e: unknown) => /no such column: machine/i.test(String((e as Error)?.message || e));
export type DeviceRow = { id: string; owner: string; name: string; tools: string; scope: string; machine?: string | null };
/** 기기 토큰 해시로 산 기기 줄(machine 칸 포함). 0087 가 아직이면 예전 질의 — machine 칸 없음(undefined = 적지 않음) */
export async function deviceByHash(db: DB, hash: string): Promise<DeviceRow | null> {
  try { return await db.prepare("SELECT id, owner, name, tools, scope, machine FROM device WHERE token_hash = ? AND revoked_at IS NULL").bind(hash).first<DeviceRow>(); }
  catch (e) { if (!noMachineCol(e)) throw e; }
  return db.prepare("SELECT id, owner, name, tools, scope FROM device WHERE token_hash = ? AND revoked_at IS NULL").bind(hash).first<DeviceRow>();
}
/** 요청에 실린 열쇠가 그 줄 값과 다를 때만 적음(요청마다 쓰지 않음). 꼴이 틀린 값 · 칸이 없는 D1 은 그냥 지나감. 적었으면 true */
export async function noteMachine(db: DB, d: Pick<DeviceRow, "id" | "machine">, key: string | null | undefined) {
  if (!key || !MACHINE_RE.test(key) || d.machine === undefined || d.machine === key) return false;
  try { await db.prepare("UPDATE device SET machine = ? WHERE id = ? AND machine IS NOT ?").bind(key, d.id, key).run(); d.machine = key; return true; }
  catch (e) { console.error("기기 컴퓨터 열쇠", String(e).slice(0, 200)); return false; }
}

type Dev = { id: string; owner: string; machine: string | null; name: string; tools: string; scope: string; created_at: number; last_at: number; engine_at: number | null; metrics_at: number | null; metrics: unknown; history: unknown[] };
const rolesOf = (d: Dev) => [...(d.scope === "harness" || d.engine_at ? ["engine"] : []), ...(d.scope !== "harness" || d.metrics_at ? ["metrics"] : [])];
const RANK: Record<string, number> = { full: 0, ownercli: 1, watch: 2, harness: 3 };
export function foldMachines(list: Dev[], person: (owner: string) => string = o => o) {
  const out: (Dev | Dev[])[] = [], at = new Map<string, Dev[]>();
  for (const d of list) {
    if (!d.machine) { out.push(d); continue; }
    const k = person(d.owner) + "\n" + d.machine, g = at.get(k);
    if (g) g.push(d); else { const n = [d]; at.set(k, n); out.push(n); }
  }
  const bare = ({ owner: _o, machine: _m, ...d }: Dev) => d;
  return out.map(x => {
    if (!Array.isArray(x) || x.length === 1) { const d = Array.isArray(x) ? x[0] : x; return { ...bare(d), roles: rolesOf(d) }; }
    const ms = [...x].sort((a, b) => (RANK[a.scope] ?? 9) - (RANK[b.scope] ?? 9) || (b.metrics_at || 0) - (a.metrics_at || 0) || b.created_at - a.created_at);
    const main = ms[0], max = (k: "last_at" | "engine_at") => ms.reduce<number | null>((v, d) => d[k] != null && (v == null || d[k]! > v) ? d[k] : v, null);
    const members = ms.map(d => ({ id: d.id, name: d.name, scope: d.scope, roles: rolesOf(d), created_at: d.created_at, last_at: d.last_at, engine_at: d.engine_at, metrics_at: d.metrics_at }));
    return { ...bare(main), last_at: max("last_at") ?? main.last_at, engine_at: max("engine_at"), roles: [...new Set(members.flatMap(m => m.roles))], members };
  });
}

export async function listDevices(db: DB, me: string | string[], now = Date.now(), opt: { fold?: boolean } = {}) {
  const ms = (Array.isArray(me) ? me : [me]).slice(0, 8), q = ms.map(() => "?").join(",");
  const rest = (cols: string) => db.batch([
    db.prepare(`SELECT ${cols} FROM device WHERE owner IN (${q}) AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 50`).bind(...ms),
    db.prepare(`SELECT m.device_id, m.at, m.data FROM device_metric m JOIN device d ON d.id = m.device_id WHERE d.owner IN (${q}) AND d.revoked_at IS NULL`).bind(...ms),
    db.prepare(`SELECT h.device_id, h.at, h.mem_avail_mb, h.cpu_pct, h.disk_pct, h.agents FROM device_metric_hist h JOIN device d ON d.id = h.device_id WHERE d.owner IN (${q}) AND d.revoked_at IS NULL AND h.at > ? ORDER BY h.at`).bind(...ms, now - 24 * 3600_000),
  ]);
  const COLS = "id, owner, name, tools, scope, created_at, last_at, engine_at";
  const [dv, mt, hs] = await rest(COLS + ", machine").catch(e => { if (noMachineCol(e)) return rest(COLS); throw e; });   // 0087 전 D1 은 묶지 않음
  const met = new Map((mt.results as { device_id: string; at: number; data: string }[]).map(r => [r.device_id, r]));
  const hist = new Map<string, unknown[]>();
  for (const r of hs.results as { device_id: string }[]) { const { device_id, ...p } = r; (hist.get(device_id) || hist.set(device_id, []).get(device_id)!).push(p); }
  const all = (dv.results as Omit<Dev, "metrics_at" | "metrics" | "history">[]).map(d => {
    const m = met.get(d.id);
    let metrics = null; try { metrics = m ? JSON.parse(m.data) : null; } catch {}
    return { ...d, machine: d.machine ?? null, metrics_at: m?.at ?? null, metrics, history: hist.get(d.id) || [] };
  });
  const own = new Set(ms.map(x => x.toLowerCase()));   // 부른 쪽 메일들 = 한 사람(주인 넷 · 회원 하나) — 그 밖 owner 는 따로(남의 기기와 안 묶음)
  return opt.fold ? foldMachines(all, o => own.has(o.toLowerCase()) ? "@me" : o) : all.map(({ owner: _o, machine: _m, ...d }) => d);   // CLI 목록은 예전 꼴 그대로
}
