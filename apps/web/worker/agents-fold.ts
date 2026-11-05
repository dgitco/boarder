export type FoldRow = { id: number | string; win: string; kind: string; thread?: string | null; at: number };
export const HUMAN_KINDS = new Set(["blocked", "decision", "incident", "deadline"]);
const mineRow = (r: FoldRow, me: string) => r.kind === "me" || r.win === me;

/** 한 채널의 줄들 → 에이전트끼리 줄 id 들(줄 순서 상관없음 — 시각 · id 순으로 봄). me = 내 글 줄의 win(「나」) */
export function peerIds(rows: FoldRow[], me = "나"): Set<string> {
  const out = new Set<string>();
  let owed = false;   // 내 글이 왔고 아직 그 답이 안 옴
  for (const r of [...rows].sort((a, b) => a.at - b.at || Number(a.id) - Number(b.id))) {
    if (r.thread) continue;
    if (mineRow(r, me)) { owed = true; continue; }
    if (HUMAN_KINDS.has(r.kind)) continue;
    if (r.kind === "reply" && owed) { owed = false; continue; }
    out.add(String(r.id));
  }
  return out;
}

export const PEER_TS = /^\d{10}\.96\d{4}$/;
export function peerKey(s: string) { let h = 0; for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return h % 10000; }
export const peerTs = (at: number, key: string) => `${String(Math.floor(at / 1000)).padStart(10, "0")}.${960000 + peerKey(key)}`;
export const peerTail = (ts: string) => Number(ts.slice(-4));
