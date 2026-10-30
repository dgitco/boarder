import { TOOLS, type ToolName } from "./tools";

export type View = {
  visible: (name: string) => boolean;            // 켜짐 + 이 토큰에 허락
  why: (name: string) => string | null;          // 못 쓰면 까닭
  desc: (name: string) => string;                // 지금 보이는 설명 판
  mask: (name: string) => boolean;
};
type Row = { name: string; enabled: number; mask: number; code_hash: string; active_hash: string; code_at: string };
type Reg = { rows: Map<string, Row>; desc: Map<string, string>; at: number };

const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
let cache: Reg | null = null;

/** 코드의 도구 목록을 D1 과 맞추고(새 도구 · 바뀐 설명) 지금 상태를 돌려줌. 30초 캐시, 평소엔 읽기 한 번(묶음) */
async function load(db: D1Database): Promise<Reg> {
  const [s, d] = await db.batch([
    db.prepare("SELECT name, enabled, mask, code_hash, active_hash, code_at FROM tool_state"),
    db.prepare("SELECT s.name, d.description FROM tool_state s JOIN tool_desc d ON d.name = s.name AND d.hash = s.active_hash"),
  ]);
  return { rows: new Map((s.results as Row[]).map(r => [r.name, r])), desc: new Map((d.results as { name: string; description: string }[]).map(x => [x.name, x.description])), at: Date.now() };
}
export async function registry(db: D1Database, flag: (text: string) => void, ver?: WorkerVersionMetadata, fresh = false): Promise<Reg> {
  if (!fresh && cache && Date.now() - cache.at < 10_000) return cache;
  let reg = await load(db), changed = false;
  const now = Date.now(), at = ver?.timestamp || "";
  for (const t of TOOLS) {
    const h = await sha(t.description), r = reg.rows.get(t.name);
    if (r && r.code_hash === h) continue;
    if (r && r.code_at && at && at <= r.code_at) continue;
    changed = true;
    await db.prepare("INSERT INTO tool_desc(hash, name, description, at) VALUES (?,?,?,?) ON CONFLICT(name, hash) DO UPDATE SET at = excluded.at").bind(h, t.name, t.description, now).run();
    if (!r) {
      const added = await db.prepare("INSERT OR IGNORE INTO tool_state(name, enabled, code_hash, active_hash, code_at, updated_at) VALUES (?,0,?,?,?,?)").bind(t.name, h, h, at, now).run();
      if (added.meta.changes) flag(`Boarder 새 도구 ${t.name} 꺼진 채 등록 — 켜기: boarder-token.py tools on ${t.name}`);
      continue;
    }
    // 여러 isolate 가 같이 와도 한 번만(WHERE code_hash = 옛 값). 처음(빈 code_hash, 이주로 넣은 여섯)은 조용히
    const ch = await db.prepare("UPDATE tool_state SET code_hash = ?, active_hash = ?, code_at = ?, updated_at = ? WHERE name = ? AND code_hash = ?").bind(h, h, at, now, t.name, r.code_hash).run();
    if (ch.meta.changes && r.code_hash) flag(`Boarder 도구 설명 바뀜 ${t.name} ${r.code_hash}→${h} — diff · 되돌리기: boarder-token.py tools history ${t.name}`);
  }
  if (changed) reg = await load(db);
  return (cache = reg);
}
export const dropCache = () => { cache = null; };

export function view(reg: Reg, scope: string): View {
  const allow = scope.trim() === "*" ? null : new Set(scope.split(",").map(s => s.trim()).filter(Boolean));
  const why = (name: string) => {
    const r = reg.rows.get(name);
    if (!r) return `없는 도구: ${name}`;
    if (!r.enabled) return `${name} 은 꺼져 있음(새 도구는 꺼진 채 등록 — 관리자가 켬)`;
    if (allow && !allow.has(name)) return `이 토큰은 ${name} 을 쓸 수 없음`;
    return null;
  };
  return {
    visible: n => why(n) === null, why,
    desc: n => reg.desc.get(n) ?? TOOLS.find(t => t.name === n)?.description ?? "",
    mask: n => reg.rows.get(n)?.mask !== 0,
  };
}

const OUT: Record<ToolName, string[]> = {
  inbox_ask: ["card_id", "thread_id", "url", "state", "answer"],
  inbox_wait: ["state", "answer"],
  inbox_log: ["ok"],
  inbox_close: ["ok"],
  inbox_say: ["msg_id"],
  inbox_status: ["ok", "shown"],
  inbox_cards: ["total", "cards"],
  hook_events: ["events"],
  hook_event: ["id", "hook", "kind", "summary", "body", "at", "note"],
  session_search: ["sessions"],
  session_handoff: ["id", "title", "resume", "header", "messages"],
  feedback_send: ["ok", "id"],
  chat_say: ["ok"],
  role_draft: ["draft_id", "shown", "refused", "same_role", "window", "why"],
  role_list: ["roles", "windows", "drafts"],
};
const MAX_STR = 4000;

const SEP = "[-\u2013\u2014. ]?";
const luhn = (d: string) => { let sum = 0; for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; } return sum % 10 === 0; };
const PII: [RegExp, (m: string) => string][] = [
  [new RegExp(`(?<!\\d)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\s?[-\u2013\u2014]?\\s?[1-8]\\d{6}(?!\\d)`, "g"), () => "******-*******"],
  [/(?<!\d)(?:\d[- ]?){14,15}\d(?!\d)/g, m => { const d = m.replace(/\D/g, ""); return luhn(d) ? `****-****-****-${d.slice(-4)}` : m; }],
  [new RegExp(`(?<!\\d)(?:\\+?82${SEP}|0)1[016789]${SEP}\\d{3,4}${SEP}\\d{4}(?!\\d)`, "g"), m => `010-****-${m.replace(/\D/g, "").slice(-4)}`],
  [/(?<!\d)0(?:2|[3-6][1-5])[-\u2013\u2014. ]\d{3,4}[-\u2013\u2014. ]\d{4}(?!\d)/g, m => `${m.split(/[-\u2013\u2014. ]/)[0]}-****-${m.slice(-4)}`],
];
export const maskText = (s: string) => PII.reduce((v, [re, f]) => v.replace(re, f), s.replace(/[\uFF10-\uFF19]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)));   // 전각 숫자만(NFKC 는 ①②③ 까지 바꿈)

function deep(v: unknown, mask: boolean): unknown {
  if (typeof v === "string") { const m = mask ? maskText(v) : v; return m.length > MAX_STR ? `${m.slice(0, MAX_STR)}…(${m.length - MAX_STR}자 줄임)` : m; }
  if (Array.isArray(v)) return v.map(x => deep(x, mask));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, deep(x, mask)]));
  return v;
}
export function shape(name: string, out: unknown, mask: boolean): unknown {
  const keys = OUT[name as ToolName];
  const picked = keys && out && typeof out === "object" && !Array.isArray(out)
    ? Object.fromEntries(keys.filter(k => k in (out as object)).map(k => [k, (out as Record<string, unknown>)[k]]))
    : out;
  return deep(picked, mask);
}

export function diff(a: string, b: string): string {
  const A = a.split(/(?<=[.!?])\s+/), B = b.split(/(?<=[.!?])\s+/);
  const L = A.map(() => new Array(B.length + 1).fill(0));
  L.push(new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: string[] = []; let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { out.push(`  ${A[i]}`); i++; j++; }
    else if (i < A.length && (j >= B.length || L[i + 1][j] >= L[i][j + 1])) out.push(`- ${A[i++]}`);
    else out.push(`+ ${B[j++]}`);
  }
  return out.join("\n");
}
