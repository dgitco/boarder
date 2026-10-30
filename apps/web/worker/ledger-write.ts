import SPEC from "./ledger-schema";
import { f7All, f7AllPeek } from "./ledger";

const DIRECT: Record<string, string[]> = { write_art: ["art_note", "art_folder"] };
async function direct(db: D1Database, wait?: (p: Promise<unknown>) => void) {
  const out = new Set<string>();
  for (const f of await (wait ? f7AllPeek(db, wait) : f7All(db))) {
    if (!f.startsWith("write_") || f === "write_ledger") continue;
    for (const t of DIRECT[f] || ["*"]) out.add(t);
  }
  return [...out];
}

type Spec = Record<string, { cols: string[]; pk: string[] }>;
const S = SPEC as Spec;
type Val = string | number | null;
type Tok = { k: "w" | "q" | "s" | "n" | "p" | "sp"; v: string };

const BAD = new Set(["attach", "detach", "pragma", "vacuum", "create", "drop", "alter", "begin", "commit", "rollback", "savepoint", "release", "reindex", "analyze", "window"]);
const ENDS = new Set(["where", "group", "order", "limit", "having", "window", "union", "except", "intersect", "returning", "set", "values", "select", "default"]);
export const DENY_BASE = ["_cf_metadata", "account", "agent_token", "ai_session", "board_card", "board_log", "cli_profile", "connection", "connection_pending", "d1_migrations", "device", "device_code", "device_metric", "device_metric_hist", "engine_cmd", "engine_owner", "engine_window", "f7_flag", "feedback", "hook", "hook_event", "imp_audit", "imp_item", "imp_proposal", "invite", "member_bot", "mnode", "mnode_item", "node_setting", "role", "role_draft", "session", "sqlite_sequence", "tool_desc", "tool_state", "user", "user_pref", "verification"];
const COLS = new Set(Object.values(S).flatMap(s => s.cols.map(c => c.toLowerCase())));
const TABLEISH = new Set(["from", "join", "into", "update", "in", "table", "on"]);
const TVF = new Set(["json_each", "json_tree"]);

export function lex(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = sql.length;
  const quoted = (q: string, k: Tok["k"]) => {   // '..' · ".." · `..` — 같은 따옴표 두 번은 글자 하나
    let j = i + 1;
    for (;;) {
      if (j >= n) throw new Error("따옴표 안 닫힘");
      if (sql[j] === q) { if (sql[j + 1] === q) { j += 2; continue; } break; }
      j++;
    }
    out.push({ k, v: sql.slice(i, j + 1) }); i = j + 1;
  };
  while (i < n) {
    const c = sql[i], d = sql[i + 1];
    let m: RegExpMatchArray | null;
    if (/\s/.test(c)) { m = sql.slice(i).match(/^\s+/)!; out.push({ k: "sp", v: m[0] }); i += m[0].length; }
    else if (c === "-" && d === "-") { let j = sql.indexOf("\n", i); if (j < 0) j = n; out.push({ k: "sp", v: sql.slice(i, j) }); i = j; }
    else if (c === "/" && d === "*") { const j = sql.indexOf("*/", i + 2); if (j < 0) throw new Error("주석 안 닫힘"); out.push({ k: "sp", v: sql.slice(i, j + 2) }); i = j + 2; }
    else if (c === "'") quoted("'", "s");
    else if (c === '"' || c === "`") quoted(c, "q");
    else if (c === "[") { const j = sql.indexOf("]", i); if (j < 0) throw new Error("[ 안 닫힘"); out.push({ k: "q", v: sql.slice(i, j + 1) }); i = j + 1; }
    else if ((m = sql.slice(i).match(/^(?:0x[0-9a-f]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)/i))) { out.push({ k: "n", v: m[0] }); i += m[0].length; }
    else if ((m = sql.slice(i).match(/^(?:\?\d*|[:@$][A-Za-z0-9_]+)/))) { out.push({ k: "n", v: m[0] }); i += m[0].length; }
    else if ((m = sql.slice(i).match(/^[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*/))) { out.push({ k: "w", v: m[0] }); i += m[0].length; }
    else if ((m = sql.slice(i).match(/^(?:\|\||<=|>=|<>|!=|==|<<|>>|->>|->)/))) { out.push({ k: "p", v: m[0] }); i += m[0].length; }
    else { out.push({ k: "p", v: c }); i++; }
  }
  return out;
}

const bare = (t: Tok) => t.k === "w" ? t.v.toLowerCase() : t.k === "q" ? t.v.slice(1, -1).replace(/""|``/g, m => m[0]).toLowerCase() : "";
const ident = (t?: Tok) => !!t && (t.k === "w" || t.k === "q");

// 문장 하나 → wl_ 로 바꾼 문장 + 쓰는 표(트리거 확인 · 바뀐 줄 읽기). 못 믿을 꼴이면 예외(부른 쪽은 예전 길로)
export function rewrite(sql: string, tables: Set<string> = new Set(Object.keys(S)), deny: Set<string> = new Set(DENY_BASE)): { sql: string; targets: string[] } {
  const toks = lex(sql);
  const sig = toks.map((t, i) => [t, i] as const).filter(([t]) => t.k !== "sp");
  if (!sig.length) throw new Error("빈 문장");
  const first = bare(sig[0][0]);
  if (!["insert", "update", "delete", "replace", "with"].includes(first)) throw new Error("쓰기 문장만(INSERT · UPDATE · DELETE · REPLACE)");
  const rep = new Map<number, string>();     // 토큰 자리 → 새 글
  const targets = new Set<string>();
  const ctes = new Set<string>();
  const from: boolean[] = [];                // 괄호 깊이마다 FROM 목록 안인지(쉼표 = 표 하나 더)
  let depth = 0, main = first !== "with", dml = first !== "with";
  const table = (k: number, target: boolean) => {   // sig[k] 가 표 자리
    const t = sig[k]?.[0];
    if (!t) throw new Error("표 자리 비었음");
    if (t.k === "p" && t.v === "(") return;   // 하위 질의
    if (!ident(t)) throw new Error(`표 자리 꼴: ${t.v.slice(0, 20)}`);
    const name = bare(t), next = sig[k + 1]?.[0];
    if (next && next.k === "p" && next.v === ".") throw new Error("스키마 붙은 표");
    if (TVF.has(name) && next?.v === "(" && !target) return;
    if (ctes.has(name) && !target) return;
    if (!tables.has(name)) throw new Error(`모르는 표 ${name.slice(0, 40)}`);
    rep.set(sig[k][1], t.k === "w" ? `wl_${t.v}` : `${t.v[0]}wl_${t.v.slice(1)}`);
    if (target) targets.add(name);
  };
  for (let k = 0; k < sig.length; k++) {
    const [t] = sig[k], w = bare(t), prev = bare(sig[k - 1]?.[0] ?? { k: "sp", v: "" });
    if (t.k === "p" && t.v === ";") { if (k !== sig.length - 1) throw new Error("문장 여럿"); continue; }
    if (t.k === "p" && t.v === "(") { depth++; from[depth] = false; continue; }
    if (t.k === "p" && t.v === ")") { from[depth] = false; depth--; if (depth < 0) throw new Error("괄호"); continue; }
    if (ident(t) && /^(wl_|sqlite_|_cf_|d1_|pragma_)/.test(w)) throw new Error(`쓸 수 없는 이름 ${w.slice(0, 40)}`);
    if (ident(t) && deny.has(w) && !(COLS.has(w) && !TABLEISH.has(prev) && sig[k + 1]?.[0].v !== "." && sig[k - 1]?.[0].v !== "." && !(sig[k - 1]?.[0].v === "," && from[depth])))
      throw new Error(`장부 밖 표 이름 ${w.slice(0, 40)}`);
    if (t.k === "w" && BAD.has(w)) throw new Error(`안 되는 낱말 ${w}`);
    if (first === "with" && depth === 0 && !dml) {
      if (t.k === "w" && ["insert", "update", "delete", "replace"].includes(w)) { dml = true; main = true; }
      else if (ident(t) && k > 0 && ["with", "recursive", ","].includes(prev || sig[k - 1][0].v) && ["as", "("].includes(bare(sig[k + 1]?.[0] ?? { k: "sp", v: "" }) || sig[k + 1]?.[0].v || "")) { ctes.add(w); continue; }   // WITH 이름 [(칸…)] AS
    }
    if (t.k === "p" && t.v === "," && from[depth]) { table(k + 1, false); continue; }
    if (t.k !== "w") {
      if (ident(t) && tables.has(w) && sig[k + 1]?.[0].v === "." && sig[k - 1]?.[0].v !== ".") rep.set(sig[k][1], `${t.v[0]}wl_${t.v.slice(1)}`);
      continue;
    }
    if (ENDS.has(w)) from[depth] = false;
    if (w === "into") { table(k + 1, depth === 0 && main && ["insert", "replace", "ignore", "abort", "fail", "rollback"].includes(prev)); continue; }
    if (w === "update") {
      const nx = bare(sig[k + 1]?.[0] ?? { k: "sp", v: "" });
      if (nx === "set") continue;   // ON CONFLICT … DO UPDATE SET
      const at = nx === "or" ? k + 3 : k + 1;
      table(at, depth === 0 && main); continue;
    }
    if (w === "in") {   // `x IN 표이름` 도 표 자리(괄호 · 값 목록은 아님)
      if (sig[k + 1]?.[0].v !== "(") table(k + 1, false);
      continue;
    }
    if (w === "from" || w === "join") {
      if (prev === "distinct") continue;   // IS [NOT] DISTINCT FROM 값
      table(k + 1, w === "from" && prev === "delete" && depth === 0 && main);
      from[depth] = true; continue;
    }
    if (tables.has(w) && sig[k + 1]?.[0].v === "." && sig[k - 1]?.[0].v !== ".") rep.set(sig[k][1], `wl_${t.v}`);   // 표.칸
  }
  if (depth !== 0) throw new Error("괄호");
  if (!dml || !targets.size) throw new Error("쓰는 표 없음");
  const out = toks.map((t, i) => rep.get(i) ?? t.v).join("");
  const o = lex(out).filter(t => t.k !== "sp");
  o.forEach((t, k) => {
    const w = bare(t);
    if (ident(t) && (deny.has(w) || /^(sqlite_|pragma_)/.test(w)) && !(COLS.has(w) && !TABLEISH.has(bare(o[k - 1] ?? { k: "sp", v: "" })) && o[k + 1]?.v !== "." && o[k - 1]?.v !== "."))
      throw new Error(`장부 밖 표 이름 ${w.slice(0, 40)}`);
  });
  return { sql: out, targets: [...targets] };
}

const val = (v: unknown): Val => {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  throw new Error("값은 글 · 수 · null 만");
};

let meta: { at: number; on: Set<string>; deny: Set<string> } | null = null;
// 뜨거운 길(write): 표 · 트리거 목록이 있으면 낡았어도 그것으로, 다시 읽기는 뒤에서(새 표 · 트리거는 마이그레이션 때뿐 — 길어야 한 번 더 「트리거 없는 표」 400 → 부른 쪽이 예전 길)
let metaAt = 0;
async function schemaPeek(db: D1Database, wait: (p: Promise<unknown>) => void) {
  if (meta && Date.now() - meta.at > 60_000 && Date.now() - metaAt > 5_000) { metaAt = Date.now(); wait(schema(db, true).catch(() => {})); }
  return meta || schema(db);
}
async function schema(db: D1Database, force = false) {
  if (force || !meta || Date.now() - meta.at > 60_000) {
    const r = await db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'table', 'view')").all<{ type: string; name: string }>();
    const have = new Set(r.results.filter(x => x.type === "trigger").map(x => x.name));
    const deny = new Set([...DENY_BASE, ...r.results.filter(x => x.type !== "trigger" && !/^wl_/i.test(x.name)).map(x => x.name.toLowerCase())]);
    meta = { at: Date.now(), on: new Set(Object.keys(S).filter(t => ["i", "u", "d"].every(k => have.has(`wl_web_${t}_${k}`)))), deny };
  }
  return meta;
}

export type Stmt = { sql?: unknown; args?: unknown };
type Res = { id: number | null; n: number; cols?: string[]; rows?: Val[][] };
type Changed = { t: string; pk: Record<string, Val>; row: Record<string, Val> | null };

function rowsOf(r: D1Result<Record<string, Val>>): { cols: string[]; rows: Val[][] } | undefined {
  if (!r.results?.length) return undefined;
  const cols = Object.keys(r.results[0]);
  return { cols, rows: r.results.map(x => cols.map(c => x[c])) };
}

// 꼬리표의 바뀐 줄(키 순서 = seq) + 그 줄의 지금 모습. 표마다 select 하나(batch 안이면 같은 트랜잭션)
function changedStmts(db: D1Database, tag: string, targets: string[]) {
  return [db.prepare("SELECT seq, tbl, pk FROM wl_change WHERE tx = ? ORDER BY seq").bind(tag),
    ...targets.map(t => {
      const s = S[t], ks = s.pk.map(k => `"${k}"`).join(",");
      const ex = s.pk.map((_, i) => `json_extract(pk, '$[${i}]')`).join(", ");
      return db.prepare(`SELECT ${s.cols.map(c => `"${c}"`).join(",")} FROM wl_${t} WHERE (${ks}) IN (SELECT ${ex} FROM wl_change WHERE tx = ? AND tbl = ?)`).bind(tag, t);
    })];
}
function changedOf(chg: D1Result<{ seq: number; tbl: string; pk: string }>, rowRes: D1Result<Record<string, Val>>[], targets: string[]): Changed[] {
  const rows = new Map<string, Record<string, Val>>();
  targets.forEach((t, i) => { for (const r of rowRes[i].results) rows.set(t + "|" + JSON.stringify(S[t].pk.map(k => r[k])), r); });
  const seen = new Map<string, Changed>();
  for (const c of chg.results) {
    const s = S[c.tbl]; if (!s) continue;
    const pk = JSON.parse(c.pk) as Val[], key = c.tbl + "|" + JSON.stringify(pk);
    seen.delete(key);   // 같은 키는 마지막 자리로(사본에 바뀐 순서대로)
    seen.set(key, { t: c.tbl, pk: Object.fromEntries(s.pk.map((k, i) => [k, pk[i]])), row: rows.get(key) ?? null });
  }
  return [...seen.values()];
}

const MAX_STMTS = 300;   // batch 에는 문장마다 결과 줄 하나 더 + 앞뒤 · 바뀐 줄 읽기. 넘으면 부른 쪽이 나누지 않고 예전 길(원자성)
// D1 오류 가르기: 같은 키 등 → constraint(부른 쪽 IntegrityError), 문장 자체가 틀림 → sql(예전 길), 그 밖(망 · 시간 초과 · 내부) → 들어갔는지 모름 → 503(같은 꼬리표로 다시)
const kindOf = (m: string) => /constraint/i.test(m) ? "constraint" : /no such|syntax error|ambiguous|misuse|has no column|mismatch|too many|wrong number|not authorized|parse/i.test(m) ? "sql" : "transient";

function resultsOf(r: D1Result<{ i: number; n: number; id: number | null }>, n: number) {
  const out: (Res | null)[] = Array(n).fill(null);
  for (const x of r.results) out[x.i] = { id: x.id, n: x.n };
  return out;
}

/** 그 꼬리표로 들어간 묶음의 결과 · 바뀐 줄(지금 모습) — 다시 보낸 묶음 · 매듭(claim)에서 이미 커밋된 때 */
export async function replayOf(db: D1Database, tag: string, n: number) {
  const tb = (await db.prepare("SELECT DISTINCT tbl FROM wl_change WHERE tx = ?").bind(tag).all<{ tbl: string }>()).results.map(x => x.tbl).filter(t => S[t]);
  const r = await db.batch([db.prepare("SELECT i, n, id FROM wl_tx_res WHERE tag = ? ORDER BY i").bind(tag), ...changedStmts(db, tag, tb)]);
  return { results: resultsOf(r[0] as D1Result<{ i: number; n: number; id: number | null }>, n),
    changed: changedOf(r[1] as D1Result<{ seq: number; tbl: string; pk: string }>, r.slice(2) as D1Result<Record<string, Val>>[], tb) };
}

export async function claim(db: D1Database, body: { tag?: unknown; n?: unknown }): Promise<[number, object]> {
  const tag = String(body.tag || ""), n = Math.min(Math.max(Number(body.n) | 0, 0), MAX_STMTS);
  if (!/^[A-Za-z0-9_.:-]{8,80}$/.test(tag)) return [400, { ok: false, code: "bad", error: "tag" }];
  try { await db.prepare("INSERT INTO wl_tx_done(tag, at) VALUES (?, ?)").bind(tag, Date.now()).run(); return [200, { ok: true, claimed: true }]; }
  catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (/UNIQUE constraint failed: wl_tx_done\.tag/.test(msg)) return [200, { ok: true, claimed: false, replay: true, direct: await direct(db), ...(await replayOf(db, tag, n)) }];
    return [503, { ok: false, code: kindOf(msg), error: msg.slice(0, 300) }];
  }
}

export async function write(db: D1Database, wait: (p: Promise<unknown>) => void, body: { tag?: unknown; stmts?: unknown }): Promise<[number, object]> {
  const tag = String(body.tag || "");
  if (!/^[A-Za-z0-9_.:-]{8,80}$/.test(tag)) return [400, { ok: false, code: "bad", error: "tag" }];
  if (!Array.isArray(body.stmts) || !body.stmts.length || body.stmts.length > MAX_STMTS) return [400, { ok: false, code: "bad", error: `stmts 1–${MAX_STMTS}` }];
  const { on, deny } = await schemaPeek(db, wait);
  const prepared: D1PreparedStatement[] = [], targets = new Set<string>();
  try {
    for (const st of body.stmts as Stmt[]) {
      if (typeof st?.sql !== "string" || st.sql.length > 200_000) throw new Error("sql");
      const args = Array.isArray(st.args) ? st.args.map(val) : [];
      const r = rewrite(st.sql, new Set(Object.keys(S)), deny);
      for (const t of r.targets) { if (!on.has(t)) throw new Error(`트리거 없는 표 ${t}`); targets.add(t); }
      prepared.push(db.prepare(r.sql).bind(...args));
    }
  } catch (e) { return [400, { ok: false, code: "shape", error: String(e instanceof Error ? e.message : e).slice(0, 300) }]; }
  const tl = [...targets], now = Date.now(), n = prepared.length;
  let out: D1Result[];
  try {
    out = await db.batch([
      db.prepare("INSERT INTO wl_tx_done(tag, at) VALUES (?, ?)").bind(tag, now),
      db.prepare("INSERT INTO wl_tx(tx) VALUES (?)").bind(tag),
      // 문장마다 바로 뒤에 그 문장의 changes() · last_insert_rowid() 를 묶음 안에서 남김 — D1 meta.changes 는 트리거가 쓴 wl_change 줄까지 셈(한 줄 UPDATE = 2),
      // 다시 보낸 묶음도 같은 결과를 돌려줌(talk 거울의 「rowcount == 1 이면 내가 잡음」). wl_tx_res 는 WITHOUT ROWID 라 last_insert_rowid 를 안 건드림
      ...prepared.flatMap((p, i) => [p, db.prepare("INSERT INTO wl_tx_res(tag, i, n, id) SELECT ?, ?, changes(), last_insert_rowid()").bind(tag, i)]),
      db.prepare("DELETE FROM wl_tx"),
      db.prepare("SELECT i, n, id FROM wl_tx_res WHERE tag = ? ORDER BY i").bind(tag),
      ...changedStmts(db, tag, tl)]);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (/UNIQUE constraint failed: wl_tx_done\.tag/.test(msg)) return [200, { ok: true, replay: true, claim: true, direct: await direct(db), ...(await replayOf(db, tag, n)) }];   // 이미 들어간 묶음(응답을 잃고 다시 보냄) — 두 번 안 씀, 그때 결과 그대로
    const code = kindOf(msg);
    return [code === "transient" ? 503 : 400, { ok: false, code, error: msg.slice(0, 300) }];
  }
  const ids = resultsOf(out[3 + 2 * n] as D1Result<{ i: number; n: number; id: number | null }>, n);
  const res = prepared.map((_, i) => ({ ...(ids[i] || { id: null, n: 0 }), ...rowsOf(out[2 + 2 * i] as D1Result<Record<string, Val>>) }));
  const tail = out.slice(4 + 2 * n);
  const changed = changedOf(tail[0] as D1Result<{ seq: number; tbl: string; pk: string }>, tail.slice(1) as D1Result<Record<string, Val>>[], tl);
  if (Math.random() < 0.01) wait(db.batch([   // 사흘 지난 꼬리표 · 결과
    db.prepare("DELETE FROM wl_tx_res WHERE tag IN (SELECT tag FROM wl_tx_done WHERE at < ?)").bind(now - 3 * 86400_000),
    db.prepare("DELETE FROM wl_tx_done WHERE at < ?").bind(now - 3 * 86400_000)]).catch(() => {}));
  return [200, { ok: true, results: res, changed, direct: await direct(db, wait), claim: true }];
}
