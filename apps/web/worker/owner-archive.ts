import { engineOf, harnessDevice, type EngEnv } from "./engine";
import { clean } from "./owner-read";
import { HS_KEY } from "./owner-vals";

type R = Record<string, unknown>;
export type ArchRow = { name: string; at: number; msg: string; reopen: boolean; harness: true };
const KEEP_S = 7 * 86400;
const KINDS = ["시작", "진행", "막힘", "끝", "결정", "장애", "마감"];
const stripNo = (s: string) => s.replace(/^\d+\s+/, "").trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function archivedNames(db: D1Database, me: string) {
  const r = await db.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = ?").bind(me, HS_KEY).first<{ v: string }>();
  let a: unknown = null; try { a = r?.v ? (JSON.parse(r.v) as { archived?: unknown }).archived : null; } catch { a = null; }
  return [...new Set((Array.isArray(a) ? a : []).map(x => stripNo(String(x ?? ""))).filter(Boolean))].slice(0, 300);
}
async function lastLines(db: D1Database, names: string[]) {
  const out = new Map<string, R>(); if (!names.length) return out;
  const rows = (await db.prepare(`SELECT l.win, l.at, l.kind, l.msg FROM wl_log l WHERE l.id IN (SELECT max(id) FROM wl_log WHERE ltrim(win, '0123456789 ') IN (SELECT ltrim(value, '0123456789 ') FROM json_each(?)) AND pane LIKE '!%%' ESCAPE '!' AND kind IN (SELECT value FROM json_each(?)) GROUP BY win)`)
    .bind(JSON.stringify(names), JSON.stringify(KINDS)).all<R>()).results;
  for (const n of names) {
    const re = new RegExp("^(?:\\d+ )?" + esc(n) + "$");
    for (const r of rows) if (re.test(String(r.win || "")) && Number(r.at) > Number(out.get(n)?.at ?? -1)) out.set(n, r);
  }
  return out;
}
const rowOf = (n: string, r: R | undefined, now: number): ArchRow => {
  const at = r ? Math.trunc(Number(r.at) || 0) : 0;
  return { name: n, at, msg: r ? clean(r.msg, 140) : "", reopen: !!r && now / 1000 - at < KEEP_S, harness: true };
};

export async function list(db: D1Database, me: string, now = Date.now()): Promise<ArchRow[]> {
  const names = await archivedNames(db, me), last = await lastLines(db, names);
  return names.map(n => rowOf(n, last.get(n), now)).sort((a, b) => b.at - a.at);
}

export async function find(db: D1Database, me: string, name: string, now = Date.now()): Promise<ArchRow | null> {
  const n = stripNo(name); if (!n) return null;
  const [names, last] = await Promise.all([archivedNames(db, me), lastLines(db, [n])]), r = last.get(n);
  if (names.includes(n)) return rowOf(n, r, now);
  if (!r || r.kind !== "끝" || now / 1000 - Number(r.at) >= KEEP_S) return null;
  const live = (await db.prepare("SELECT name FROM engine_window WHERE owner = ? AND kind = 'harness' AND state NOT IN ('closed','gone')").bind(me).all<R>()).results;
  return live.some(w => stripNo(String(w.name || "")) === n) ? null : rowOf(n, r, now);
}

export async function harnessReopen(env: EngEnv & { F7_TEST_PANE?: string }, ch: string, name: string): Promise<[number, { ok: boolean; name?: string; error?: string }]> {
  const d = await harnessDevice(env.DB); if (!d) return [503, { ok: false, error: "일시적인 오류가 발생했어요" }];
  try { await (engineOf(env, d.id) as unknown as { cmd(v: string, a: object, t: number): Promise<unknown> }).cmd("reopen", { id: null, handle: { name, closed: true, ...(ch === "test" || env.F7_TEST_PANE ? { test: true } : {}) } }, 90_000); }
  catch (e) { return [/session|꺼져/.test(String((e as Error).message)) ? 503 : 500, { ok: false, error: "일시적인 오류가 발생했어요" }]; }   // work 세션 없음 · 엔진 꺼짐 = 503(server.py 와 같음)
  return [200, { ok: true, name }];
}
