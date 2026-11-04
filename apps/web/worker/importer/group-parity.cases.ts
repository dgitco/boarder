// 「채널 = 태스크」 설정이 꺼진 회원은 main 과 같은 묶기 결과여야 함(task-channel-off.test.ts).
// 사례는 합성 자료만. 기대값(group-parity.fixture.json)은 이 스택 전 main 의 group.ts 로 뽑은 것 — 설정 없이 돌린 결과가 한 글자도 같아야 함.
import type { Item } from "./group.ts";

export const NOW = 1_793_200_000_000;
const H = 3600_000, D = 24 * H;
const pn = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, pinned_name: null, area: "", state: "idle", why: "", counts: "{}", created_at: NOW - 90 * D, updated_at: NOW - 30 * D, archived_at: null, ...extra });
const tk = [{ id: "tk_12", name: "업무12", issue: "o/r#12" }];
const w12: Item = { key: "window:m:1", kind: "window", engine: "tmux-own", title: "#12 고침", repo: "o/r", win: "m:1", seen_at: NOW - 8 * H, gone_at: NOW - 7 * H };
const open12: Item = { ...w12, gone_at: null, seen_at: NOW, state: "idle", session: "session:claude:s12" };
const Wn: Item = { key: "window:m:2", kind: "window", engine: "tmux-own", title: "기능 A 만들기", repo: "o/r", branch: "feat/a", win: "m:2", seen_at: NOW, state: "idle", session: "session:claude:a" };
const Sn: Item = { key: "session:claude:a", kind: "session", title: "기능 A", seen_at: NOW };
const Tn: Item = { key: "thread:slack:1", kind: "thread", title: "관련 스레드", repo: "o/r", branch: "feat/a", seen_at: NOW };
const a1: Item = { key: "window:m:3", kind: "window", engine: "tmux-own", title: "일 하나", win: "m:3", seen_at: NOW, state: "idle", session: "session:claude:dup" };
const a2: Item = { key: "window:m:4", kind: "window", engine: "tmux-own", title: "일 둘", win: "m:4", seen_at: NOW, state: "idle", session: "session:claude:dup" };
const role: Item = { key: "window:m:6", kind: "window", engine: "tmux-own", title: "팀장", win: "m:6", cwd: "/w/x", seen_at: NOW, state: "idle", session: "session:claude:r" };
const cl1: Item = { key: "window:m:7", kind: "window", engine: "tmux-own", title: "다른 기기에서 이어 연 창", win: "m:7", seen_at: NOW, state: "working", handle: JSON.stringify({ tool: "claude", session_id: "same" }) };
const cl2: Item = { key: "window:m:8", kind: "window", engine: "tmux-own", title: "이어 연 창 둘", win: "m:8", seen_at: NOW, state: "working", handle: JSON.stringify({ tool: "claude", session_id: "same" }) };

type Case = { name: string; input: Record<string, unknown> };
const UNITS = [undefined, "goal", "agent"] as const;
export function cases(): Case[] {
  const out: Case[] = [];
  const all = (name: string, f: (unit: typeof UNITS[number]) => Record<string, unknown>) => { for (const unit of UNITS) out.push({ name: `${name} · ${unit || "단위 없음"}`, input: { now: NOW, agents: [], items: [], logs: [], cards: [], prev: [], prevNodes: [], ...f(unit), unit } }); };
  all("보관된 옛 보고자", () => ({ prev: [{ item: "win:mac:old-sender", node: "n_old", how: "auto" }], prevNodes: [pn("n_old", "old-sender", { archived_at: NOW - 7 * D, state: "done" })] }));
  all("400줄 밖 보고자(보관 안 된 노드)", () => ({ prev: [{ item: "win:mac:quiet", node: "n_q", how: "auto" }], prevNodes: [pn("n_q", "quiet", { updated_at: NOW - H })] }));
  all("옛 보고자 서른(줄은 90일 전)", () => ({ logs: Array.from({ length: 30 }, (_, i) => ({ win: "mac:old" + i, kind: "log", text: "x", at: NOW - 90 * D + i })) }));
  all("업무 창 닫힘 7시간", () => ({ items: [w12], logs: [{ win: "m:1", kind: "log", text: "옛 보고", at: NOW - 8 * H }], prev: [{ item: "window:m:1", node: "tk_12", how: "auto" }], tasks: tk }));
  all("떼기 뒤 다시 묶기", () => ({ items: [open12], tasks: tk }));
  all("스레드 하나만 사람이 옮김", () => ({ items: [Wn, Sn, Tn], prev: [{ item: "window:m:2", node: "n_a", how: "auto" }, { item: "session:claude:a", node: "n_a", how: "auto" }, { item: "thread:slack:1", node: "n_x", how: "pin" }], prevNodes: [pn("n_a", "기능 A"), pn("n_x", "딴 노드")] }));
  all("창 하나를 사람이 옮김", () => ({ items: [Wn, Sn, Tn], prev: [{ item: "window:m:2", node: "n_x", how: "pin" }, { item: "session:claude:a", node: "n_a", how: "auto" }, { item: "thread:slack:1", node: "n_a", how: "auto" }], prevNodes: [pn("n_a", "기능 A"), pn("n_x", "딴 노드")] }));
  all("같은 session 두 창", () => ({ items: [a1, a2] }));
  all("같은 session 두 창 각자 옮김", () => ({ items: [a1, a2], prev: [{ item: "window:m:3", node: "n_p", how: "pin" }, { item: "window:m:4", node: "n_q", how: "pin" }], prevNodes: [pn("n_p", "P"), pn("n_q", "Q")] }));
  all("손잡이 session id 만 같은 두 창", () => ({ items: [cl1, cl2] }));
  all("옮긴 창 제목에 업무 번호", () => ({ items: [{ ...open12, key: "window:m:5", win: "m:5", session: "" }], prev: [{ item: "window:m:5", node: "n_p", how: "pin" }], prevNodes: [pn("n_p", "P")], tasks: tk }));
  all("보통 회원 보고자 둘과 역할 창", () => ({ items: [role], logs: [{ win: "m:rep1", kind: "log", text: "a", at: NOW }, { win: "m:rep2", kind: "log", text: "b", at: NOW }, { win: "n:rep1", kind: "log", text: "c", at: NOW }], prev: [{ item: "window:m:6", node: "n_r", how: "auto" }, { item: "win:m:rep1", node: "n_r", how: "auto" }, { item: "win:m:rep2", node: "n_r", how: "auto" }], prevNodes: [pn("n_r", "팀장")], agents: ["팀장"] }));
  all("업무 노드로 옮긴 항목(옛 길)", () => ({ items: [open12], prev: [{ item: "window:m:1", node: "tk_12", how: "pin" }], tasks: tk, reportRepo: "o/r" }));
  return out;
}
