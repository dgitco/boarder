type R = Record<string, any>;

export type Diff = {
  at: string[];          // 다른 칸 이름(panes · name · state · kind · group · parked) — 비면 같음
  n_snap: number; n_d1: number;
  only_snap: number; only_d1: number;
  name: number; state: number; kind: number;
  group: number;
  parked_snap: number; parked_d1: number; parked_only_snap: number; parked_only_d1: number;
  d1_other: number;
};

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
  return { at, n_snap: S.size, n_d1: D.size, only_snap, only_d1, name, state, kind, group, parked_snap: ps.size, parked_d1: pd.size, parked_only_snap, parked_only_d1, d1_other };
}

// 대조는 isolate 마다 1분에 한 번 — 주인 화면이 /api/data 를 5–20초마다 부르니 매번 회원 load(D1 13문)를 더 돌리지 않게
const EVERY_MS = 60_000;
let lastAt = 0;
export function due(now = Date.now()) { if (now - lastAt < EVERY_MS) return false; lastAt = now; return true; }
export function _reset() { lastAt = 0; }   // 시험용
