import SPEC from "./ledger-schema";

type Spec = Record<string, { cols: string[]; pk: string[] }>;
const S = SPEC as Spec;
// 사본(worklog.db)의 UNIQUE 칸 — D1 도 0024 부터 같은 UNIQUE
const UNIQ: Record<string, string[]> = { talk_msg: ["slack_ts"], talk_file: ["slack_file"], talk_chan: ["slack_channel"] };
export type Change = { t: string; op: "up" | "del"; row?: Record<string, unknown>; pk?: Record<string, unknown> };
type Val = string | number | null;

const val = (v: unknown): Val => v === null || v === undefined ? null : typeof v === "number" || typeof v === "string" ? v : typeof v === "boolean" ? (v ? 1 : 0) : JSON.stringify(v);

export function statements(db: D1Database, changes: Change[]) {
  const out: D1PreparedStatement[] = [];
  for (const ch of changes) {
    const s = S[ch.t]; if (!s) throw new Error(`모르는 표 ${String(ch.t).slice(0, 40)}`);
    if (ch.op === "del") {
      const pk = ch.pk || {}; if (s.pk.some(k => !(k in pk))) throw new Error(`${ch.t} 지우기 키 없음`);
      out.push(db.prepare(`DELETE FROM wl_${ch.t} WHERE ${s.pk.map(k => `"${k}" = ?`).join(" AND ")}`).bind(...s.pk.map(k => val(pk[k]))));
      out.push(db.prepare("INSERT INTO wl_change(tbl, pk, op, at) VALUES (?, ?, 'del', ?)").bind(ch.t, JSON.stringify(s.pk.map(k => val(pk[k]))), Date.now()));
    } else if (ch.op === "up") {
      const row = ch.row || {}; if (s.pk.some(k => row[k] === undefined || row[k] === null)) throw new Error(`${ch.t} 키 없음`);
      const cols = s.cols.filter(c => c in row), upd = cols.filter(c => !s.pk.includes(c));
      const q = `INSERT INTO wl_${ch.t} (${cols.map(c => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})` +
        (upd.length ? ` ON CONFLICT(${s.pk.map(k => `"${k}"`).join(",")}) DO UPDATE SET ${upd.map(c => `"${c}" = excluded."${c}"`).join(", ")}` : " ON CONFLICT DO NOTHING");
      // UNIQUE 칸(0024)을 이 줄이 가지면 그 값을 쥔 다른 줄을 먼저 지움 — 사본에서 유일하니 그 줄은 낡은 것(제 바뀜이 뒤에 옴). 줄 순서가 바뀌어 와도 batch 가 안 막힘
      for (const u of UNIQ[ch.t] || []) if (row[u] !== undefined && row[u] !== null)
        out.push(db.prepare(`DELETE FROM wl_${ch.t} WHERE "${u}" = ? AND NOT (${s.pk.map(k => `"${k}" = ?`).join(" AND ")})`).bind(val(row[u]), ...s.pk.map(k => val(row[k]))));
      out.push(db.prepare(q).bind(...cols.map(c => val(row[c]))));
      out.push(db.prepare("INSERT INTO wl_change(tbl, pk, op, at) VALUES (?, ?, 'up', ?)").bind(ch.t, JSON.stringify(s.pk.map(k => val(row[k]))), Date.now()));
    } else throw new Error("op 는 up · del");
  }
  return out;
}

// 한 번에 많이 오면(처음 복사) D1 batch 를 100 문장씩 — 한 batch 는 한 트랜잭션이라 중간에 실패하면 그 덩어리는 통째로 안 들어감(릴레이가 다시 보냄)
// 쓰기 전환(0024 · 0025): 릴레이가 올리는 줄은 사본에서 온 것 — wl_mute 를 batch 안에서만 세워 D1 트리거가 origin web 으로 안 적게(되당김 없음).
// wl_mute 가 아직 없으면(0024 전) 예전처럼. 있음은 isolate 마다 60초, 없음은 2초만 캐시(배포 → 마이그레이션 사이 틈을 짧게)
let muteAt = 0, hasMute = false;
async function muteOk(db: D1Database) {
  if (Date.now() - muteAt > (hasMute ? 60_000 : 2_000)) { hasMute = !!(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'wl_mute'").first()); muteAt = Date.now(); }
  return hasMute;
}
export async function apply(db: D1Database, changes: Change[]) {
  const st = statements(db, changes), mute = await muteOk(db);
  for (let i = 0; i < st.length; i += 100) {
    const part = st.slice(i, i + 100);
    await db.batch(mute ? [db.prepare("INSERT INTO wl_mute(on_) VALUES (1)"), ...part, db.prepare("DELETE FROM wl_mute")] : part);
  }
  return changes.length;
}

// 대조 · 당기기: 표 하나를 키 순서로 잘라 읽음(after = 마지막 키 값 배열 JSON)
export async function dump(db: D1Database, t: string, after: Val[] | null, limit: number) {
  const s = S[t]; if (!s) throw new Error("모르는 표");
  const ks = s.pk.map(k => `"${k}"`).join(","), n = Math.min(Math.max(limit | 0, 1), 2000);
  const where = after && after.length === s.pk.length ? `WHERE (${ks}) > (${s.pk.map(() => "?").join(",")})` : "";
  const r = await db.prepare(`SELECT ${s.cols.map(c => `"${c}"`).join(",")} FROM wl_${t} ${where} ORDER BY ${ks} LIMIT ${n}`).bind(...(where ? after! : [])).all();
  return r.results;
}

export async function stat(db: D1Database) {
  const st = Object.keys(S).map(t => db.prepare(`SELECT '${t}' AS t, count(*) AS n FROM wl_${t}`));
  const r = await db.batch<{ t: string; n: number }>(st);
  return Object.fromEntries(r.map(x => [x.results[0].t, x.results[0].n]));
}

export const TABLES = Object.keys(S);

// 전환 스위치(f7_flag): isolate 마다 10초 캐시 — 끈 뒤 길어야 10초 안에 모든 요청이 옛 길로
let flags: { at: number; on: Set<string> } | null = null;
export async function f7On(db: D1Database, name: string) {
  if (!flags || Date.now() - flags.at > 10_000) {
    let r: { name: string }[] | null = null;
    try { r = (await db.prepare("SELECT name FROM f7_flag WHERE on_at IS NOT NULL").all<{ name: string }>()).results; } catch {}
    flags = { at: Date.now(), on: r ? new Set(r.map(x => x.name)) : flags?.on ?? new Set() };
  }
  return flags.on.has(name);
}
let peekAt = 0;
export function f7Peek(db: D1Database, name: string, wait: (p: Promise<unknown>) => void): boolean | Promise<boolean> {
  if (!flags) return f7On(db, name);
  if (Date.now() - flags.at > 10_000 && Date.now() - peekAt > 5_000) { peekAt = Date.now(); wait(f7On(db, name)); }
  return flags.on.has(name);
}
export async function f7AllPeek(db: D1Database, wait: (p: Promise<unknown>) => void) {
  if (!flags) return f7All(db);
  f7Peek(db, "", wait);
  return flags.on;
}
export async function f7All(db: D1Database) {   // 켜진 스위치 이름 전부(같은 10초 캐시)
  await f7On(db, "");
  return flags!.on;
}
export async function setFlag(db: D1Database, name: string, on: boolean, note = "") {
  await db.prepare("INSERT INTO f7_flag(name, on_at, note) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET on_at = excluded.on_at, note = excluded.note").bind(name, on ? Date.now() : null, note).run();
  flags = null;
}
