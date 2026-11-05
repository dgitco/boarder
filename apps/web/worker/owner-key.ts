import { isSealed, openField, sealFieldNow, type VaultEnv } from "./vault/index";
import { canon } from "./who";

type Env = VaultEnv & { ALLOW_EMAILS?: string };
type R = Record<string, unknown>;
export type Spec = { tbl: string; key: string; seal: string[]; uniq?: string[] };
// uniq = 이 표의 (owner, …) 유일 칸 — plan 이 부딪칠 줄을 미리 셈
export const TABLES: Spec[] = [
  { tbl: "connection", key: "id", seal: ["auth"], uniq: ["service", "label"] },
  { tbl: "connection_pending", key: "state", seal: ["auth"] },
  { tbl: "hook", key: "id", seal: ["secret"], uniq: ["name"] },
  { tbl: "hook_event", key: "id", seal: [] },
  { tbl: "feedback", key: "id", seal: [] },
  { tbl: "connect_link", key: "hash", seal: [] },
];
export type Plan = { tbl: string; rows: number; sealed: number; conflicts: number; moved: number };
export type Result = { tbl: string; done: number; skipped: number; conflict: string[]; failed: { key: string; error: string }[]; dryRun?: boolean };
const err = (e: unknown) => String((e as Error)?.message || e).slice(0, 200);
const pick = (only?: string[]) => TABLES.filter(t => !only?.length || only.includes(t.tbl));

/** 표마다: 옮길 '' 줄 · 그중 봉한 칸 수 · canon 쪽에 같은 유일 값이 이미 있어 부딪칠 줄 · 이미 옮긴 줄(mig_owner) */
export async function plan(env: Env, only?: string[]): Promise<Plan[]> {
  const to = canon(env), out: Plan[] = [];
  for (const t of pick(only)) {
    const sealed = t.seal.length ? t.seal.map(c => `(CASE WHEN ${c} LIKE 'v2.%' THEN 1 ELSE 0 END)`).join(" + ") : "0";
    const conf = t.uniq ? `(SELECT count(*) FROM ${t.tbl} a WHERE a.owner = '' AND EXISTS (SELECT 1 FROM ${t.tbl} b WHERE b.owner = ?1 AND ${t.uniq.map(c => `b.${c} = a.${c}`).join(" AND ")}))` : "0";
    const r = await env.DB.prepare(`SELECT count(*) AS rows, coalesce(sum(${sealed}), 0) AS sealed, ${conf} AS conflicts, (SELECT count(*) FROM mig_owner WHERE tbl = ?2) AS moved FROM ${t.tbl} WHERE owner = ''`)
      .bind(to, t.tbl).first<{ rows: number; sealed: number; conflicts: number; moved: number }>();
    out.push({ tbl: t.tbl, rows: Number(r?.rows || 0), sealed: Number(r?.sealed || 0), conflicts: Number(r?.conflicts || 0), moved: Number(r?.moved || 0) });
  }
  return out;
}

// 봉한 칸 하나를 from DEK → to DEK 로(같은 AAD 자리). 봉하지 않은 칸은 그대로. dryRun = 열리는지만(봉하지 않음 — DEK 를 새로 만들지 않게)
async function reseal(env: Env, from: string, to: string, tbl: string, pk: string, col: string, v: unknown, dryRun?: boolean) {
  if (!isSealed(v) || !String(v).startsWith("v2.")) return v;
  const ref = { tbl, pk, col }, pt = (await openField(env, from, ref, v)) as string;
  if (dryRun) return v;
  const neu = await sealFieldNow(env, to, ref, pt);
  if ((await openField(env, to, ref, neu)) !== pt) throw new Error(`${col}: 다시 연 값이 다름`);
  return neu;
}

async function move(env: Env, dir: "run" | "back", o: { only?: string[]; dryRun?: boolean; page?: number }): Promise<Result[]> {
  const to = canon(env); if (!to) throw new Error("ALLOW_EMAILS 없음(canon)");
  const [src, dst] = dir === "run" ? ["", to] : [to, ""], page = Math.min(Math.max(Number(o.page) || 100, 1), 500), out: Result[] = [];
  for (const t of pick(o.only)) {
    const res: Result = { tbl: t.tbl, done: 0, skipped: 0, conflict: [], failed: [], ...(o.dryRun ? { dryRun: true } : {}) };
    const cols = [t.key, ...t.seal, ...(t.uniq || [])].map(c => `"${c}"`).join(", ");
    // run = owner '' 줄 전부, back = mig_owner 에 남긴 줄 중 지금 canon 인 것. 쪽마다 키 순서로(옮긴 줄은 다음 쪽 조건에서 빠지니 after 로 넘김)
    for (let after = ""; ;) {
      const rs = (await (dir === "run"
        ? env.DB.prepare(`SELECT ${cols} FROM ${t.tbl} WHERE owner = '' AND "${t.key}" > ? ORDER BY "${t.key}" LIMIT ?`).bind(after, page)
        : env.DB.prepare(`SELECT ${cols} FROM ${t.tbl} WHERE owner = ? AND "${t.key}" IN (SELECT pk FROM mig_owner WHERE tbl = ?) AND "${t.key}" > ? ORDER BY "${t.key}" LIMIT ?`).bind(to, t.tbl, after, page)).all<R>()).results;
      if (!rs.length) break;
      after = String(rs[rs.length - 1][t.key]);
      for (const r of rs) {
        const pk = String(r[t.key]), key = `${t.tbl}:${pk}`;
        try {
          const neu: unknown[] = [];
          for (const c of t.seal) neu.push(await reseal(env, src, dst, t.tbl, pk, c, r[c], o.dryRun));
          if (o.dryRun) {   // 실행과 같은 수가 나오게: 옮길 자리에 같은 유일 값 줄이 있으면 부딪침
            const hit = t.uniq && await env.DB.prepare(`SELECT 1 FROM ${t.tbl} WHERE owner = ? AND ${t.uniq.map(c => `"${c}" = ?`).join(" AND ")}`).bind(dst, ...t.uniq.map(c => r[c])).first();
            if (hit) res.conflict.push(key); else res.done++;
            continue;
          }
          // CAS: 그 사이 owner · 봉한 칸이 바뀌었으면(토큰 갱신 등) 안 씀 — 다음 run 이 다시 집음
          const sets = ["owner = ?", ...t.seal.map(c => `"${c}" = ?`)].join(", "), same = t.seal.map(c => ` AND "${c}" IS ?`).join("");
          const up = env.DB.prepare(`UPDATE ${t.tbl} SET ${sets} WHERE "${t.key}" = ? AND owner = ?${same}`).bind(dst, ...neu, pk, src, ...t.seal.map(c => r[c]));
          const mark = dir === "run"
            ? env.DB.prepare(`INSERT OR REPLACE INTO mig_owner(tbl, pk, at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM ${t.tbl} WHERE "${t.key}" = ? AND owner = ?)`).bind(t.tbl, pk, Date.now(), pk, dst)
            : env.DB.prepare(`DELETE FROM mig_owner WHERE tbl = ? AND pk = ? AND EXISTS (SELECT 1 FROM ${t.tbl} WHERE "${t.key}" = ? AND owner = ?)`).bind(t.tbl, pk, pk, dst);
          let n = 0;
          try { n = Number((await env.DB.batch([up, mark]))[0].meta?.changes ?? 0); }
          catch (e) { if (/UNIQUE|constraint/i.test(err(e))) { res.conflict.push(key); continue; } throw e; }
          if (n) res.done++; else res.skipped++;
        } catch (e) { res.failed.push({ key, error: err(e) }); }
      }
    }
    out.push(res);
  }
  return out;
}
export const run = (env: Env, o: { only?: string[]; dryRun?: boolean; page?: number } = {}) => move(env, "run", o);
export const back = (env: Env, o: { only?: string[]; dryRun?: boolean; page?: number } = {}) => move(env, "back", o);
