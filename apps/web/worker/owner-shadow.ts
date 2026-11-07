type R = Record<string, any>;

export type Diff = {
  at: string[];          // 다른 칸 이름(panes · name · state · kind · group · parked) — 비면 같음
  n_snap: number; n_d1: number;
  only_snap: number; only_d1: number;
  name: number; state: number; kind: number;
  group: number;
  parked_snap: number; parked_d1: number; parked_only_snap: number; parked_only_d1: number;
  d1_other: number;
} & Vals;
export const PANE_VALS = ["area", "acct", "stuck", "branch", "last", "blocked", "recent", "hist", "owner", "wait", "topics", "pri"] as const;
export const PARK_VALS = ["pk_msg", "pk_stale", "pk_wait", "pk_watch", "pk_topics"] as const;
export const LIST_VALS = ["feed", "closed", "archived", "decisions", "to_check", "promises", "areas", "agents", "cards", "cardlist", "cardsdone", "bthreads", "todos", "renames", "attn"] as const;
type Vals = Record<(typeof PANE_VALS)[number] | (typeof PARK_VALS)[number] | (typeof LIST_VALS)[number], number> & { hs_age: number };

const PANE = /^%\d{1,7}$/;
const st = (s: unknown) => String(s ?? "").trim();
const kindOf = (p: R) => ["primary", "arealead", "lead", "helper"].includes(st(p.kind)) ? st(p.kind) : "lead";
const parkName = (x: R) => st(x.name).replace(/^\d+\s+/, "");

function panesOf(list: unknown, only: (p: R) => boolean) {
  const out = new Map<string, R>();
  for (const p of Array.isArray(list) ? list as R[] : []) if (p && PANE.test(st(p.pane)) && only(p)) out.set(st(p.pane), p);
  return out;
}
function groups(m: Map<string, R>) {
  const g = new Map<string, string[]>();
  for (const [pane, p] of m) (g.get(st(p.win)) || g.set(st(p.win), []).get(st(p.win))!).push(pane);
  return new Map([...g].map(([k, v]) => [k, v.sort().join(",")]));
}

export function windowsDiff(snap: R, d1: R): Diff {
  const S = panesOf(snap?.panes, () => true), D = panesOf(d1?.panes, p => !!p.harness);
  const d1_other = (Array.isArray(d1?.panes) ? d1.panes as R[] : []).filter(p => p && !p.harness && p.pane !== "%1").length;
  let only_snap = 0, only_d1 = 0, name = 0, state = 0, kind = 0;
  for (const [k, s] of S) {
    const d = D.get(k); if (!d) { only_snap++; continue; }
    if (st(s.win) !== st(d.win)) name++;
    if (st(s.state) !== st(d.state)) state++;
    if (kindOf(s) !== kindOf(d)) kind++;
  }
  for (const k of D.keys()) if (!S.has(k)) only_d1++;
  // 묶음은 둘 다 있는 판끼리만(한쪽에만 있는 판은 panes 로 이미 셈) — 같은 판들이 같은 창으로 묶였는가
  const both = (m: Map<string, R>, o: Map<string, R>) => new Map([...m].filter(([k]) => o.has(k)));
  const gs = groups(both(S, D)), gd = groups(both(D, S));
  let group = 0; for (const w of new Set([...gs.keys(), ...gd.keys()])) if (gs.get(w) !== gd.get(w)) group++;
  const ps = new Set((Array.isArray(snap?.parked) ? snap.parked as R[] : []).map(parkName).filter(Boolean));
  const pd = new Set((Array.isArray(d1?.parked) ? d1.parked as R[] : []).filter(x => x?.harness).map(parkName).filter(Boolean));
  const parked_only_snap = [...ps].filter(x => !pd.has(x)).length, parked_only_d1 = [...pd].filter(x => !ps.has(x)).length;
  const at = [only_snap || only_d1 ? "panes" : "", name ? "name" : "", state ? "state" : "", kind ? "kind" : "", group ? "group" : "", parked_only_snap || parked_only_d1 ? "parked" : ""].filter(Boolean);
  const v = valuesDiff(snap, d1, S, D);
  for (const k of [...PANE_VALS, ...PARK_VALS, ...LIST_VALS]) if (v[k]) at.push(k);
  return { at, n_snap: S.size, n_d1: D.size, only_snap, only_d1, name, state, kind, group, parked_snap: ps.size, parked_d1: pd.size, parked_only_snap, parked_only_d1, d1_other, ...v };
}

// 빈 값(없음 · null · "" · [] · false · 0)은 같게 — 스냅숏은 칸이 늘 있고 회원 길은 빈 값으로 둘 수 있음
const nv = (x: unknown): string => x === undefined || x === null || x === "" || x === false || x === 0 || (Array.isArray(x) && !x.length) ? "" : typeof x === "string" ? x : JSON.stringify(x);
const tsList = (xs: unknown) => (Array.isArray(xs) ? xs as R[] : []).map(t => st(t?.ts)).filter(Boolean).sort().join(",");
const PV: Record<(typeof PANE_VALS)[number], (p: R) => string> = {
  area: p => st(p.area), acct: p => st(p.acct), stuck: p => st(p.stuck), branch: p => st(p.branch),
  last: p => nv(p.last?.id), blocked: p => nv(p.blocked?.id),
  recent: p => nv((Array.isArray(p.recent) ? p.recent as R[] : []).map(x => [st(x.kind), st(x.msg)])),
  hist: p => nv((Array.isArray(p.hist) ? p.hist as R[] : []).map(x => st(x.k))),
  owner: p => nv(!!p.owner), wait: p => nv(Number(p.wait || 0)), topics: p => tsList(p.topics), pri: p => st(p.pri),
};
const KV: Record<(typeof PARK_VALS)[number], (x: R) => string> = { pk_msg: x => st(x.msg), pk_stale: x => nv(x.stale), pk_wait: x => st(x.wait), pk_watch: x => st(x.watch), pk_topics: x => tsList(x.topics) };
// 전역 목록 → 열쇠들(두 쪽 차집합 크기의 합을 셈)
const arr = (x: unknown) => Array.isArray(x) ? x as R[] : [];
const LK: Record<Exclude<(typeof LIST_VALS)[number], "attn">, (o: R, d1?: boolean) => string[]> = {
  feed: o => arr(o.feed).map(x => st(x.id)), closed: o => arr(o.closed).map(x => st(x.pane)), archived: o => arr(o.archived).map(x => st(x)),
  decisions: (o, d1) => arr(o.decisions).map(x => d1 && !x.wl && st(x.src) === "wlog" ? `card|${st(x.id)}` : `${st(x.src)}|${st(x.id).replace(/^hw(?=\d)/, "w")}`),
  to_check: o => arr(o.to_check).filter(x => st(x.src) !== "promise").map(x => `${st(x.src)}|${st(x.id)}`),   // 기한 지난 약속 확인(회원 길에만 있는 기능)은 뺌
  promises: o => arr(o.promises).map(x => `${st(x.what)}|${st(x.due)}`),
  areas: o => arr(o.areas).filter(x => ["primary", "company", "personal", "dgit", "shop"].includes(st(x.key))).map(x => `${st(x.key)}:${st(x.lead)}`),
  agents: o => arr(o.agents).map(x => st(x.key)), cards: o => arr(o.cards).map(x => st(x.ts)), cardlist: o => arr(o.cardlist).map(x => st(x.ts)), cardsdone: o => arr(o.cardsdone).map(x => st(x.ts)),
  bthreads: o => arr(o.bthreads).map(x => st(x.ts)), todos: o => arr(o.todos).map(x => st(x.ts)),
  renames: o => Object.entries(o.renames && typeof o.renames === "object" ? o.renames as R : {}).map(([a, b]) => `${a}>${st(b)}`),
};
function symDiff(a: string[], b: string[]) { const A = new Set(a), B = new Set(b); let n = 0; for (const x of A) if (!B.has(x)) n++; for (const x of B) if (!A.has(x)) n++; return n; }

function valuesDiff(snap: R, d1: R, S: Map<string, R>, D: Map<string, R>): Vals {
  const v = Object.fromEntries([...PANE_VALS, ...PARK_VALS, ...LIST_VALS].map(k => [k, 0])) as Vals;
  for (const [k, s] of S) { const d = D.get(k); if (!d) continue; for (const f of PANE_VALS) if (PV[f](s) !== PV[f](d)) v[f]++; }
  const pk = (o: R, only: (x: R) => boolean) => new Map((Array.isArray(o?.parked) ? o.parked as R[] : []).filter(only).map(x => [parkName(x), x]));
  const KS = pk(snap, () => true), KD = pk(d1, x => !!x?.harness);
  for (const [n, s] of KS) { const d = KD.get(n); if (!d) continue; for (const f of PARK_VALS) if (KV[f](s) !== KV[f](d)) v[f]++; }
  for (const f of Object.keys(LK) as (keyof typeof LK)[]) v[f] = symDiff(LK[f](snap || {}, false), LK[f](d1 || {}, true));
  v.attn = nv(snap?.attn) === nv(d1?.attn) ? 0 : 1;
  const at = Number(d1?.harness_state_at || 0);
  v.hs_age = at ? Math.max(0, Math.round(Date.now() / 1000 - at)) : -1;
  return v;
}
