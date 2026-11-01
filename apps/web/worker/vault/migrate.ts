import { seal as v1seal } from "../connectors/seal";
import { engineOf, flagOwner } from "../engine";
import { dekOwner, RB, ridCell } from "../queue";
import { hosted } from "../hosted";
import { escapeField, openBlob, openField, sealBlob, sealField, unescapeField, type VaultEnv } from "./index";

export type MEnv = VaultEnv & { RESULTS: R2Bucket; ENGINE?: unknown; SNAP?: unknown; ALLOW_EMAILS?: string };
export type Scope = string;   // scopes() 에 든 이름
export type Counts = { plain: number; v1: number; v2: number; empty: number };
export type Result = { scope: Scope; done: number; skipped: number; changed: number; failed: { key: string; error: string }[]; dryRun?: boolean };
type R = Record<string, any>;

const form = (v: unknown): keyof Counts => {
  if (v === null || v === undefined || v === "") return "empty";
  const s = String(v);
  if (/^v2\.\d{1,9}\.[A-Za-z0-9_-]{38,}$/.test(s)) return "v2";
  if (/^v1\.[A-Za-z0-9_-]{38,}$/.test(s)) return "v1";
  return "plain";
};
const err = (e: unknown) => String((e as Error)?.message || e).slice(0, 200);
const res = (scope: Scope, dryRun?: boolean): Result => ({ scope, done: 0, skipped: 0, changed: 0, failed: [], ...(dryRun ? { dryRun: true } : {}) });

// ── D1 칸(등록표) ───────────────────────────────────────────────────
// secret = JSON 을 담은 커넥터 비밀(옛 꼴 v1), text = 평문 글(옛 꼴 평문). 줄 키(AAD pk)는 쓰는 길과 같게.
// genPk = AAD pk 칸이 비어 있을 수 있는 표(AUTOINCREMENT id 대신 쓰는 칸): 봉할 때 make() 로 채워 같은 CAS UPDATE 에서 씀.
// whoSql = 사람별 옮기기(owner)의 WHERE 조각(값 하나 바인드) — 기본 "owner = ?"
export type D1ScopeSpec = { key: string; cols: string[]; kind: "secret" | "text"; owner: (r: R) => string; pk: (r: R) => string | null; whoSql?: string; genPk?: { col: string; make: () => string } };
const T: Record<string, D1ScopeSpec> = {
  connection: { key: "id", cols: ["auth"], kind: "secret", owner: r => r.owner, pk: r => r.id },
  connection_pending: { key: "state", cols: ["auth"], kind: "secret", owner: r => r.owner, pk: r => r.state },
  hook: { key: "id", cols: ["secret"], kind: "secret", owner: r => r.owner, pk: r => r.id },
};
const OTHER = ["sessions", "mcp-results", "engine", "rids"];
const IDENT = /^[a-z][a-z0-9_]{0,40}$/;
/** D1 scope 더하기(이름 = 표 이름). 같은 이름을 두 번 넣으면 던짐 */
export function registerScope(name: string, spec: D1ScopeSpec) {
  if (!IDENT.test(name) || [spec.key, ...spec.cols, ...(spec.genPk ? [spec.genPk.col] : [])].some(c => !IDENT.test(c))) throw new Error(`vault scope 이름 꼴: ${name}`);
  if (name in T || OTHER.includes(name)) throw new Error(`vault scope 이미 있음: ${name}`);
  T[name] = spec;
}
/** 지금 있는 scope — 코어 D1 셋 · 등록한 D1 표 · R2 둘 · DO 둘 */
export const scopes = (): string[] => [...Object.keys(T), ...OTHER];
// 호스팅 판: ee 가 ../hosted.ts 의 vaultScopes 칸으로 넣은 표(공개 판에선 hosted 가 빈 확장이라 없음)
for (const [n, sp] of Object.entries(hosted.vaultScopes ?? {})) registerScope(n, sp);

// who = DEK 주인 하나만(사람별 옮기기)
async function* rows(env: MEnv, tbl: string, page: number, who?: string) {
  const whoSql = T[tbl]?.whoSql ?? "owner = ?";
  for (let after = 0; ;) {
    const rs = (await env.DB.prepare(`SELECT rowid AS _r, * FROM ${tbl} WHERE rowid > ?${who === undefined ? "" : ` AND ${whoSql}`} ORDER BY rowid LIMIT ?`).bind(...(who === undefined ? [after, page] : [after, who, page])).all<R>()).results;
    if (!rs.length) return;
    yield rs;
    after = rs[rs.length - 1]._r;
  }
}

async function d1Plan(env: MEnv, scope: string, page: number, who?: string) {
  const out: Record<string, Counts> = {};
  for (const c of T[scope].cols) out[c] = { plain: 0, v1: 0, v2: 0, empty: 0 };
  for await (const rs of rows(env, scope, page, who)) for (const r of rs) for (const c of T[scope].cols) out[c][form(r[c])]++;
  return out;
}

async function d1Move(env: MEnv, scope: string, to: "v2" | "old", page: number, dryRun: boolean, who?: string): Promise<Result> {
  const S = T[scope], out = res(scope, dryRun);
  for await (const rs of rows(env, scope, page, who)) for (const r of rs) {
    const key = `${scope}:${r[S.key]}`;
    try {
      const owner = S.owner(r), sets: [string, string, string][] = [];   // [칸, 옛 값, 새 값]
      const G = S.genPk;   // 비어 있으면 채울 pk 칸(있는 표만)
      let gen = G ? r[G.col] as string | null : null;
      const want: Record<string, string> = {};   // 칸마다 연 값(다시 읽어 비교)
      for (const c of S.cols) {
        const f = form(r[c]);
        if (to === "v2" ? f === "v2" || f === "empty" : f !== "v2") continue;
        if (to === "v2" && S.kind === "secret" && f === "plain") throw new Error(`${c}: 평문 비밀 — 꼴을 몰라 안 건드림`);
        if (to === "v2" && G && !gen) gen = G.make();
        const pk = G ? gen : S.pk(r);
        if (!pk) throw new Error("줄 키 없음");
        const ref = { tbl: scope, pk, col: c };
        if (to === "v2") {
          const pt = f === "v1" ? (await openField(env, owner, ref, r[c])) as string : unescapeField(String(r[c]));   // v1 은 안의 JSON 글월 그대로, 감싼 평문은 뗀 값
          const sealed = (await sealField(env, owner, ref, pt)) as string;
          // 봉하지 않은 값(그사이 스위치가 꺼짐 등)은 쓰지 않음 — v1 비밀 자리에 평문 JSON 이 들어가면 다시 읽기 비교도 통과해 버림
          if (!sealed.startsWith("v2.")) throw new Error(`${c}: 봉하지 않은 값(스위치 꺼짐?) — 안 씀`);
          sets.push([c, r[c], sealed]); want[c] = pt;
        } else {
          const pt = (await openField(env, owner, ref, r[c])) as string;
          sets.push([c, r[c], S.kind === "secret" ? await v1seal(env.CONNECTOR_KEY, JSON.parse(pt)) : escapeField(pt)]); want[c] = pt;   // 평문이 봉한 꼴이면 감싸 둠
        }
      }
      if (!sets.length) { out.skipped++; continue; }
      if (dryRun) { out.done++; continue; }
      const genSet = !!G && gen !== r[G.col];
      const u = await env.DB.prepare(`UPDATE ${scope} SET ${sets.map(s => `${s[0]} = ?`).join(", ")}${genSet ? `, ${G!.col} = ?` : ""} WHERE ${S.key} = ? AND ${sets.map(s => `${s[0]} IS ?`).join(" AND ")}${genSet ? ` AND ${G!.col} IS ?` : ""}`)
        .bind(...sets.map(s => s[2]), ...(genSet ? [gen] : []), r[S.key], ...sets.map(s => s[1]), ...(genSet ? [r[G!.col]] : [])).run();
      if (!u.meta.changes) { out.changed++; continue; }   // 그사이 바뀜 — 다음에 다시
      // 다시 읽어 열고 처음 값과 같은지 — 다르면 옛 값으로 되돌리고(새 값일 때만) failed
      const chk = await env.DB.prepare(`SELECT ${S.cols.join(", ")}, ${G ? G.col : S.key + " AS _k"} FROM ${scope} WHERE ${S.key} = ?`).bind(r[S.key]).first<R>();
      const pk = G ? chk?.[G.col] : S.pk(r);
      let ok = !!chk;
      for (const [c] of sets) if (ok) ok = (to === "v2" ? String(chk![c]).startsWith("v2.") : !String(chk![c]).startsWith("v2."))   // 쓴 꼴도 확인
        && (await openField(env, owner, { tbl: scope, pk, col: c }, chk![c]).catch(() => null)) === want[c];
      if (!ok) {
        await env.DB.prepare(`UPDATE ${scope} SET ${sets.map(s => `${s[0]} = ?`).join(", ")} WHERE ${S.key} = ? AND ${sets.map(s => `${s[0]} IS ?`).join(" AND ")}`).bind(...sets.map(s => s[1]), r[S.key], ...sets.map(s => s[2])).run();
        throw new Error("다시 연 값이 처음과 다름 — 되돌림");
      }
      out.done++;
    } catch (e) { out.failed.push({ key, error: err(e) }); }
  }
  return out;
}

// ── R2 몸통 ─────────────────────────────────────────────────────────
// 봉한 몸통 = 메타 vault=1(쓰는 길과 같은 표). 주인: sessions/<메일 | _>/…, mcp-results/<토큰 해시 32>/… → 그 토큰의 owner(없으면 못 앎 — 건너뜀)
const R2S = {
  sessions: { prefix: "sessions/", owner: async (_e: MEnv, k: string) => { const s = k.split("/")[1]; return s === "_" ? "" : s; } },
  "mcp-results": { prefix: "mcp-results/", owner: async (e: MEnv, k: string) => {
    const t = await e.DB.prepare("SELECT owner FROM agent_token WHERE substr(hash, 1, 32) = ? LIMIT 1").bind(k.split("/")[1]).first<{ owner: string | null }>();
    return t ? t.owner || "" : null;
  } },
} as const;
async function* objects(env: MEnv, prefix: string, page: number) {
  for (let cursor: string | undefined; ;) {
    const l = await env.RESULTS.list({ prefix, cursor, limit: page, include: ["customMetadata", "httpMetadata"] } as R2ListOptions);
    yield l.objects;
    if (!l.truncated) return;
    cursor = (l as { cursor?: string }).cursor;
  }
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

async function r2Plan(env: MEnv, scope: keyof typeof R2S, page: number, who?: string) {
  const out: Counts = { plain: 0, v1: 0, v2: 0, empty: 0 };
  for await (const os of objects(env, R2S[scope].prefix, page)) for (const o of os) {
    if (who !== undefined && (await R2S[scope].owner(env, o.key)) !== who) continue;
    out[o.customMetadata?.vault === "1" ? "v2" : "plain"]++;
  }
  return out;
}
async function r2Move(env: MEnv, scope: keyof typeof R2S, to: "v2" | "old", page: number, dryRun: boolean, who?: string): Promise<Result> {
  const out = res(scope, dryRun);
  for await (const os of objects(env, R2S[scope].prefix, page)) for (const lo of os) {
    const k = lo.key;
    try {
      const owner = await R2S[scope].owner(env, k);
      if (who !== undefined && owner !== who) continue;   // 다른 사람 것 — 세지도 않음
      if ((lo.customMetadata?.vault === "1") === (to === "v2")) { out.skipped++; continue; }
      if (owner === null) { out.skipped++; out.failed.push({ key: k, error: "주인 모름(토큰 없음) — 안 건드림" }); continue; }
      const o = await env.RESULTS.get(k); if (!o) { out.changed++; continue; }
      const raw = new Uint8Array(await o.arrayBuffer()), meta = { ...(o.customMetadata || {}) };
      let body: Uint8Array, plain: Uint8Array;
      if (to === "v2") {
        if (meta.vault === "1") { out.changed++; continue; }
        plain = raw; body = (await sealBlob(env, owner, k, raw)) as Uint8Array;
        if (body === raw) throw new Error("스위치 꺼짐 — 봉하지 않음");
        meta.vault = "1";
      } else {
        if (meta.vault !== "1") { out.changed++; continue; }
        plain = await openBlob(env, owner, k, raw); body = plain;
        delete meta.vault;
      }
      if (dryRun) { out.done++; continue; }
      const put = await env.RESULTS.put(k, body, { httpMetadata: o.httpMetadata, customMetadata: meta, onlyIf: { etagMatches: o.etag } });
      if (!put) { out.changed++; continue; }   // 그사이 바뀜(etag)
      const chk = await env.RESULTS.get(k);
      const got = chk ? new Uint8Array(await chk.arrayBuffer()) : null;
      const opened = got && (to === "v2" ? await openBlob(env, owner, k, got).catch(() => null) : got);
      if (!opened || !same(opened, plain)) {
        if (chk) await env.RESULTS.put(k, raw, { httpMetadata: o.httpMetadata, customMetadata: o.customMetadata, onlyIf: { etagMatches: chk.etag } });
        throw new Error("다시 연 몸통이 처음과 다름 — 되돌림");
      }
      out.done++;
    } catch (e) { out.failed.push({ key: k, error: err(e) }); }
  }
  return out;
}

// ── DO: 엔진 밀린 글(기기마다) · rid 답(사람마다) ──────────────────────
type EngineStub = { vaultPlan(): Promise<{ plain: number; v2: number; empty: number }>; vaultMove(to: "v2" | "plain", dryRun?: boolean): Promise<Omit<Result, "scope">> };
// 기기 주인(주인 메일들 = '')이 who 인 기기만
const devices = async (env: MEnv, who?: string) => (await env.DB.prepare("SELECT id, owner FROM device ORDER BY id").all<{ id: string; owner: string }>()).results
  .filter(r => who === undefined || flagOwner(env, r.owner || "") === who).map(r => r.id);
const engine = (env: MEnv, id: string) => engineOf(env as never, id) as unknown as EngineStub;
type SnapStub = { ridBodies(after: string, n: number): Promise<{ rid: string; body: string }[]>; ridBody(rid: string): Promise<string | null>; ridSwap(rid: string, old: string, neu: string): Promise<number> };
// rid 칸은 사람마다 하나(주인 메일들은 한 칸) — 주인 첫 메일 + 초대한 사람
async function people(env: MEnv, who?: string) {
  const owner = String(env.ALLOW_EMAILS || "").split(",")[0].trim().toLowerCase();
  const inv = (await env.DB.prepare("SELECT DISTINCT lower(email) AS e FROM invite").all<{ e: string }>()).results.map(r => r.e);
  return [...new Set([owner, ...inv].filter(Boolean))].filter(e => who === undefined || dekOwner(env as never, e) === who);
}

async function engineMove(env: MEnv, to: "v2" | "old", dryRun: boolean, who?: string): Promise<Result> {
  const out = res("engine", dryRun);
  for (const id of await devices(env, who)) {
    try {
      const r = await engine(env, id).vaultMove(to === "v2" ? "v2" : "plain", dryRun);
      out.done += r.done; out.skipped += r.skipped; out.changed += r.changed;
      out.failed.push(...r.failed.map(f => ({ key: `dev:${id}/${f.key}`, error: f.error })));
    } catch (e) { out.failed.push({ key: `dev:${id}`, error: err(e) }); }
  }
  return out;
}
async function ridsMove(env: MEnv, to: "v2" | "old", page: number, dryRun: boolean, who?: string): Promise<Result> {
  const out = res("rids", dryRun);
  for (const email of await people(env, who)) {
    const cell = ridCell(env as never, email) as unknown as SnapStub, owner = dekOwner(env as never, email);
    try {
      for (let after = ""; ;) {
        const rs = await cell.ridBodies(after, page); if (!rs.length) break;
        for (const r of rs) {
          try {
            const sealed = form(r.body) === "v2";
            if (sealed === (to === "v2")) { out.skipped++; continue; }
            const pt = to === "v2" ? r.body : (await openField(env, owner, RB(r.rid), r.body)) as string;
            const neu = to === "v2" ? (await sealField(env, owner, RB(r.rid), pt)) as string : pt;
            if (dryRun) { out.done++; continue; }
            if (!(await cell.ridSwap(r.rid, r.body, neu))) { out.changed++; continue; }
            const got = await cell.ridBody(r.rid);
            const opened = got === null ? null : to === "v2" ? await openField(env, owner, RB(r.rid), got).catch(() => null) : got;
            if (opened !== pt) { if (got !== null) await cell.ridSwap(r.rid, got, r.body); throw new Error("다시 연 값이 처음과 다름 — 되돌림"); }
            out.done++;
          } catch (e) { out.failed.push({ key: `${email}/${r.rid}`, error: err(e) }); }
        }
        after = rs[rs.length - 1].rid;
      }
    } catch (e) { out.failed.push({ key: email, error: err(e) }); }
  }
  return out;
}

// ── 바깥 ──────────────────────────────────────────────────────────
const isD1 = (s: Scope) => Object.prototype.hasOwnProperty.call(T, s);
const isR2 = (s: Scope): s is keyof typeof R2S => Object.prototype.hasOwnProperty.call(R2S, s);
const known = (s: Scope) => { if (!scopes().includes(s)) throw new Error(`없는 scope: ${s}`); };

export type Opts = { page?: number; dryRun?: boolean; owner?: string };   // owner = 그 DEK 주인만('' = 주인, 메일, x:<이름>) — 없으면 모두

export async function plan(env: MEnv, scope: Scope, o: Opts = {}): Promise<Record<string, unknown>> {
  const page = Math.max(1, Math.min(o.page ?? 200, 500)), who = o.owner;
  known(scope);
  if (isD1(scope)) return d1Plan(env, scope, page, who);
  if (isR2(scope)) return r2Plan(env, scope, page, who);
  if (scope === "engine") {
    const out = { plain: 0, v2: 0, empty: 0, failed: [] as { key: string; error: string }[] };
    for (const id of await devices(env, who)) try { const p = await engine(env, id).vaultPlan(); out.plain += p.plain; out.v2 += p.v2; out.empty += p.empty; } catch (e) { out.failed.push({ key: `dev:${id}`, error: err(e) }); }
    return out;
  }
  const out: Counts = { plain: 0, v1: 0, v2: 0, empty: 0 };
  for (const email of await people(env, who)) {
    const cell = ridCell(env as never, email) as unknown as SnapStub;
    for (let after = ""; ;) { const rs = await cell.ridBodies(after, page); if (!rs.length) break; for (const r of rs) out[form(r.body)]++; after = rs[rs.length - 1].rid; }
  }
  return out;
}

export async function run(env: MEnv, scope: Scope, o: Opts = {}): Promise<Result> {
  const page = Math.max(1, Math.min(o.page ?? 100, 500)), dry = !!o.dryRun, who = o.owner;
  known(scope);
  if (isD1(scope)) return d1Move(env, scope, "v2", page, dry, who);
  if (isR2(scope)) return r2Move(env, scope, "v2", page, dry, who);
  return scope === "engine" ? engineMove(env, "v2", dry, who) : ridsMove(env, "v2", page, dry, who);
}

export async function back(env: MEnv, scope: Scope, o: Opts = {}): Promise<Result> {
  const page = Math.max(1, Math.min(o.page ?? 100, 500)), dry = !!o.dryRun, who = o.owner;
  known(scope);
  if (isD1(scope)) return d1Move(env, scope, "old", page, dry, who);
  if (isR2(scope)) return r2Move(env, scope, "old", page, dry, who);
  return scope === "engine" ? engineMove(env, "old", dry, who) : ridsMove(env, "old", page, dry, who);
}
