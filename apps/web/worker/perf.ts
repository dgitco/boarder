export type Meter = { d1r: number; d1rn: number; d1w: number; d1wn: number; dob: number; dobn: number; r2: number; r2n: number };
export const newMeter = (): Meter => ({ d1r: 0, d1rn: 0, d1w: 0, d1wn: 0, dob: 0, dobn: 0, r2: 0, r2n: 0 });

const isRead = (sql: string) => /^\s*(select|pragma|explain|with)\b/i.test(sql);
const track = <T>(p: Promise<T>, done: () => void) => { p.then(done, done); return p; };

function meterStmt(st: D1PreparedStatement, read: boolean, m: Meter): D1PreparedStatement {
  // 문장 객체 자체에 얹음 — batch 는 진짜 D1PreparedStatement 를 받아야 해서 Proxy 로 감싸지 않음
  (st as any).__bxRead = read;
  for (const k of ["first", "all", "run", "raw"] as const) {
    const f = (st as any)[k].bind(st);
    (st as any)[k] = (...a: unknown[]) => {
      const t = Date.now();
      return track(f(...a) as Promise<unknown>, () => { const ms = Date.now() - t; if (read) { m.d1r += ms; m.d1rn++; } else { m.d1w += ms; m.d1wn++; } });
    };
  }
  const bind = st.bind.bind(st);
  st.bind = (...a: unknown[]) => meterStmt(bind(...a), read, m);
  return st;
}
function meterDB(db: D1Database, m: Meter): D1Database {
  return new Proxy(db, {
    get(t, k) {
      if (k === "prepare") return (sql: string) => meterStmt(t.prepare(sql), isRead(sql), m);
      if (k === "batch") return (sts: D1PreparedStatement[]) => {
        const s0 = Date.now(), read = sts.every(s => (s as any).__bxRead);
        return track(t.batch(sts), () => { const ms = Date.now() - s0; if (read) { m.d1r += ms; m.d1rn++; } else { m.d1w += ms; m.d1wn++; } });
      };
      const v = (t as any)[k]; return typeof v === "function" ? v.bind(t) : v;
    },
  });
}
function meterR2(b: R2Bucket, m: Meter): R2Bucket {
  return new Proxy(b, {
    get(t, k) {
      const v = (t as any)[k]; if (typeof v !== "function") return v;
      return (...a: unknown[]) => { const s0 = Date.now(); return track(v.apply(t, a) as Promise<unknown>, () => { m.r2 += Date.now() - s0; m.r2n++; }); };
    },
  });
}
// DO: 네임스페이스의 get · getByName 이 돌려준 스텁의 호출만 잼(fetch · RPC). 답은 그대로 돌려줌(RpcPromise 도)
function meterStub<T extends object>(s: T, m: Meter): T {
  return new Proxy(s, {
    get(t, k) {
      if (typeof k === "symbol" || k === "then" || k === "id" || k === "name" || k === "dup") return (t as any)[k];
      const v = (t as any)[k]; if (typeof v !== "function") return v;
      return (...a: unknown[]) => {
        const s0 = Date.now(), r = (t as any)[k](...a), done = () => { m.dob += Date.now() - s0; m.dobn++; };
        if (r && typeof r.then === "function") r.then(done, done); else done();
        return r;
      };
    },
  });
}
function meterNS<T extends object>(n: T, m: Meter): T {
  return new Proxy(n, {
    get(t, k) {
      const v = (t as any)[k];
      if (k === "get" || k === "getByName") return (...a: unknown[]) => meterStub(v.apply(t, a), m);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}
const NS = ["SNAP", "BRIDGE", "ENGINE", "SEARCH", "PUSH"];
export function meterEnv<E extends { DB: D1Database; RESULTS?: R2Bucket }>(env: E, m: Meter): E {
  const out: any = { ...env, DB: meterDB(env.DB, m) };
  if (env.RESULTS) out.RESULTS = meterR2(env.RESULTS, m);
  for (const k of NS) if ((env as any)[k]) out[k] = meterNS((env as any)[k], m);
  return out;
}
export const meterProps = (m: Meter) => ({ d1_read_ms: m.d1r, d1_read_n: m.d1rn, d1_write_ms: m.d1w, d1_write_n: m.d1wn, do_ms: m.dob, do_n: m.dobn, r2_ms: m.r2, r2_n: m.r2n });

export function sampleOf(path: string, method: string, status: number) {
  if (status >= 500 || !["GET", "HEAD"].includes(method)) return 1;
  if (/^\/icons\//.test(path)) return 20;
  if (/^\/api\/(topics|inbox|chat\/|data$|live$|drafts$|nodechat|agent\/)/.test(path)) return 5;
  return 2;
}
