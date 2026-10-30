type DB = D1Database;
type V = Record<string, any>;
const FILE: Record<string, string> = { drafts: "drafts.json", node_pri: "node-pri.json", node_settings: "node-topic-settings.json" };
export const KEYS = Object.keys(FILE);

const DP = "drafts:";
export async function get(db: DB, k: string) {
  if (k === "drafts") {
    const m = await db.prepare("SELECT at, ver FROM owner_state WHERE k = 'drafts'").first<{ at: number; ver: number }>(); if (!m) return null;
    const rows = (await db.prepare("SELECT k, v, ver FROM owner_state WHERE k > 'drafts:' AND k < 'drafts;' ORDER BY ord, k").all<{ k: string; v: string; ver: number }>()).results;
    return { v: Object.fromEntries(rows.map(r => [r.k.slice(DP.length), JSON.parse(r.v)])) as V, at: m.at, ver: m.ver };
  }
  const r = await db.prepare("SELECT v, at, ver FROM owner_state WHERE k = ?").bind(k).first<{ v: string; at: number; ver: number }>();
  return r ? { v: JSON.parse(r.v) as V, at: r.at, ver: r.ver } : null;
}
const stateFile = (db: DB, k: string) => db.prepare("INSERT INTO f7_after(kind, args, at, mark) VALUES ('state_file', ?, ?, 0)").bind(JSON.stringify({ k, file: FILE[k] }), Date.now());
// 바꾸기: fn(지금 값) → [돌려줄 답, 새 값 | null(안 씀)]. 다른 저장이 사이에 끼면 다시(5번). 없으면(seed 전) null
async function change<T>(db: DB, k: string, fn: (v: V) => [T, V | null]): Promise<T | null> {
  for (let i = 0; i < 20; i++) {
    if (i) await new Promise(r => setTimeout(r, 5 + Math.random() * 40 * i));   // 겹치면 조금 쉬고 다시
    const cur = await get(db, k); if (!cur) return null;
    const [out, next] = fn(cur.v);
    if (!next) return out;
    const r = await db.batch([
      db.prepare("UPDATE owner_state SET v = ?, at = ?, ver = ver + 1 WHERE k = ? AND ver = ?").bind(JSON.stringify(next), Date.now(), k, cur.ver),
      db.prepare("INSERT INTO f7_after(kind, args, at, mark) SELECT 'state_file', ?, ?, 0 WHERE changes() > 0").bind(JSON.stringify({ k, file: FILE[k] }), Date.now())]);
    if (r[0].meta.changes) return out;   // 끼어든 저장이 없었음(바뀐 줄 1) — 그 batch 의 state_file 줄도 같이 들어감
  }
  throw new Error("동시 저장이 계속 겹침");
}

const cut = (s: string, n: number) => { const a = Array.from(s); return a.length > n ? a.slice(0, n).join("") : s; };

export async function draft(db: DB, b: V): Promise<[number, object] | null> {
  const key = String(b.key || ""), text = String(b.text || ""), dev = cut(String(b.dev || ""), 40), sent = b.sent;
  if (!/^(?:chan|th|card):[^\x00-\x1f\x7f]{1,200}$/.test(key) || text.length > 100000) return [400, { ok: false, error: "bad draft" }];   // 노드 채널 키(chan:n:<노드 이름>)는 띄어쓰기(6d4a1f93)
  const at0 = Number(b.at || 0) || 0, k = DP + key;
  for (let i = 0; i < 20; i++) {
    if (i) await new Promise(r => setTimeout(r, 5 + Math.random() * 40 * i));
    const q = await db.prepare("SELECT (SELECT 1 FROM owner_state WHERE k = 'drafts') AS seeded, (SELECT count(*) FROM owner_state WHERE k > 'drafts:' AND k < 'drafts;') AS n, o.v AS v, o.ver AS ver FROM (SELECT 1) AS one LEFT JOIN owner_state AS o ON o.k = ?").bind(k).first<{ seeded: number | null; n: number; v: string | null; ver: number | null }>();
    if (!q?.seeded) return null;   // seed 전
    const row = q.v != null ? { v: q.v, ver: Number(q.ver) } : null;
    const [out, next] = draftStep(row ? JSON.parse(row.v) : {}, text, dev, sent, at0);
    if (!next) return out;
    const now = Date.now(), nv = JSON.stringify(next);
    const r = await db.batch([
      row ? db.prepare("UPDATE owner_state SET v = ?, at = ?, ver = ver + 1 WHERE k = ? AND ver = ?").bind(nv, now, k, row.ver)
        : db.prepare("INSERT INTO owner_state(k, v, at, ver, ord) SELECT ?, ?, ?, 0, coalesce(max(ord), 0) + 1 FROM owner_state WHERE k > 'drafts:' AND k < 'drafts;' ON CONFLICT(k) DO NOTHING").bind(k, nv, now),
      db.prepare("UPDATE owner_state SET at = ?, ver = ver + 1 WHERE k = 'drafts' AND changes() > 0").bind(now),
      db.prepare("INSERT INTO f7_after(kind, args, at, mark) SELECT 'state_file', ?, ?, 0 WHERE changes() > 0").bind(JSON.stringify({ k: "drafts", file: FILE.drafts }), now),   // 위 표시 줄이 바뀌었을 때만(= 이 키 줄을 씀)
      ...pruneOld(db, now)]);   // 지움 표 7일 거름도 같은 batch(server.py 는 저장마다 거름 — 따로 두 왕복이던 것)
    if (r[0].meta.changes) { if (q.n + (row ? 0 : 1) > 300) await pruneDrafts(db).catch(() => null); return out; }   // 끼어든 저장(같은 키)이 없었음. 300칸 넘을 때만 한 번 더(드묾)
  }
  throw new Error("동시 저장이 계속 겹침");
}
// 한 칸 판정(server.py draft_post 의 칸 규칙): [답, 새 칸 | null]
function draftStep(old: V, text: string, dev: string, sent: unknown, at0: number): [[number, object], V | null] {
  const now = Date.now() / 1000, at = at0 || now * 1000;
  if (sent !== undefined && sent !== null) return [[200, { ok: true }], { text: "", at: Math.max(at, old.at || 0), dev, sent: at, sent_text: cut(String(sent), 4000), sent_srv: now }];
  const t = text.trim(), st = String(old.sent_text || "").trim(), same = !!dev && old.dev === dev, fresh = now - Number(old.sent_srv || 0) < 3600;
  if (t && old.sent && ((same && at <= old.sent) || (!same && fresh && st && st.startsWith(t)))) return [[200, { ok: true, stale: true }], null];
  if ((old.at || 0) > at) return [[200, { ok: true, stale: true }], null];
  return [[200, { ok: true }], t ? { text, at, dev } : { text: "", at, dev }];
}
// 지움 표 7일 · 300칸(지움 표부터 · 옛것부터) — server.py 는 저장마다 거름. 줄을 지우는 한 문장씩이라 줄이 커도 안 막힘. 300칸을 넘겨 거르면 남은 줄 순서도 그 정렬로(server.py dict(sorted(…)))
const EMPTY = "trim(coalesce(json_extract(v, '$.text'), ''), ' ' || char(9, 10, 11, 12, 13)) = ''";
// 지움 표 7일(빈 글 · 7일 지남)만 지우고, 지웠으면 표시 줄 · 내려쓰기 — 저장 batch 끝에 붙이는 세 문장
const pruneOld = (db: DB, now: number) => [
  db.prepare(`DELETE FROM owner_state WHERE k > 'drafts:' AND k < 'drafts;' AND ${EMPTY} AND coalesce(json_extract(v, '$.at'), 0) <= ?`).bind(now - 7 * 86400 * 1000),
  db.prepare("UPDATE owner_state SET at = ?, ver = ver + 1 WHERE k = 'drafts' AND changes() > 0").bind(now),
  db.prepare("INSERT INTO f7_after(kind, args, at, mark) SELECT 'state_file', ?, ?, 0 WHERE changes() > 0").bind(JSON.stringify({ k: "drafts", file: FILE.drafts }), now)];
async function pruneDrafts(db: DB) {
  const cutAt = Date.now() - 7 * 86400 * 1000, now = Date.now();
  const st = [db.prepare(`DELETE FROM owner_state WHERE k > 'drafts:' AND k < 'drafts;' AND ${EMPTY} AND coalesce(json_extract(v, '$.at'), 0) <= ?`).bind(cutAt)];
  const n = (await db.prepare("SELECT count(*) AS n FROM owner_state WHERE k > 'drafts:' AND k < 'drafts;'").first<{ n: number }>())?.n || 0;
  if (n > 300) {
    const order = `(CASE WHEN ${EMPTY} THEN 0 ELSE 1 END), coalesce(json_extract(v, '$.at'), 0)`;
    st.push(db.prepare(`DELETE FROM owner_state WHERE k IN (SELECT k FROM owner_state WHERE k > 'drafts:' AND k < 'drafts;' ORDER BY ${order} LIMIT max(0, (SELECT count(*) FROM owner_state WHERE k > 'drafts:' AND k < 'drafts;') - 300))`));
    st.push(db.prepare(`UPDATE owner_state SET ord = (SELECT r FROM (SELECT k AS kk, row_number() OVER (ORDER BY ${order}) AS r FROM owner_state WHERE k > 'drafts:' AND k < 'drafts;') WHERE kk = owner_state.k) WHERE k > 'drafts:' AND k < 'drafts;'`));
  }
  const r = await db.batch(st);
  if (r.some(x => x.meta.changes)) await db.batch([db.prepare("UPDATE owner_state SET at = ?, ver = ver + 1 WHERE k = 'drafts'").bind(now), stateFile(db, "drafts")]);
}

const NODE_PRI = ["급함", "높음", "보통", "낮음"];
export async function nodePri(db: DB, b: V): Promise<[number, object] | null> {
  const title = cut(String(b.title || "").replace(/^\d+\s+/, "").trim(), 80), pri = String(b.pri || "");
  if (!title || (pri && !NODE_PRI.includes(pri))) return [400, { ok: false, error: "노드 이름 · 단계" }];
  if (/["\\]/.test(title)) return change<[number, object]>(db, "node_pri", m0 => {   // json 경로에 못 넣는 이름(" · \\) — 통째로 비교 후 바꾸기
    const m = { ...m0 };
    if (pri) m[title] = { pri, by: "owner", at: Math.floor(Date.now() / 1000) }; else delete m[title];
    return [[200, { ok: true, title, pri }], m];
  });
  const path = `$."${title}"`;   // 그 노드 칸만(한 문장 — 다른 노드 저장과 안 겹침)
  const r = await db.batch([
    pri ? db.prepare("UPDATE owner_state SET v = json_set(v, ?, json(?)), at = ?, ver = ver + 1 WHERE k = 'node_pri'").bind(path, JSON.stringify({ pri, by: "owner", at: Math.floor(Date.now() / 1000) }), Date.now())
      : db.prepare("UPDATE owner_state SET v = json_remove(v, ?), at = ?, ver = ver + 1 WHERE k = 'node_pri'").bind(path, Date.now()),
    db.prepare("INSERT INTO f7_after(kind, args, at, mark) SELECT 'state_file', ?, ?, 0 WHERE changes() > 0").bind(JSON.stringify({ k: "node_pri", file: FILE.node_pri }), Date.now())]);
  return r[0].meta.changes ? [200, { ok: true, title, pri }] : null;   // 줄 없음 = seed 전
}

// node_topic.save_settings · settings: 아는 칸만 · 숫자만(참 · 거짓 빼고) · int() 처럼 0 쪽으로 자르고 · 범위 끝값, 망가진 칸은 기본값
const DEF: Record<string, number> = { check_min: 30, split_at: 3, move_h: 24, rename_h: 6, archive_h: 6 };
const LIM: Record<string, [number, number]> = { check_min: [5, 1440], split_at: [2, 10], move_h: [1, 168], rename_h: [1, 168], archive_h: [1, 168] };
const clamp = (raw: unknown, base: Record<string, number>) => {
  const out = { ...base };
  for (const k of Object.keys(DEF)) { const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as V)[k] : undefined; if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.min(LIM[k][1], Math.max(LIM[k][0], Math.trunc(v))); }
  return out;
};
export async function nodeSettings(db: DB) { const c = await get(db, "node_settings"); return c ? clamp(c.v, DEF) : null; }
export async function nodeSet(db: DB, b: V): Promise<[number, object] | null> {
  if (!b.values || typeof b.values !== "object") return [400, { ok: false, error: "값" }];
  return change<[number, object]>(db, "node_settings", cur => { const out = clamp(b.values, clamp(cur, DEF)); return [[200, { ok: true, values: out }], out]; });
}

// 릴레이(after-hook) 길: 뒷일 줄 당기기 · 시도 · 끝, 상태 칸 읽기 · seed
export async function afterRows(db: DB, after: number) {
  return (await db.prepare("SELECT seq, kind, args, at, mark FROM f7_after WHERE done_at IS NULL AND seq > ? ORDER BY seq LIMIT 100").bind(after).all().catch(() => ({ results: [] }))).results;
}
export async function afterTry(db: DB, seq: number) {
  const r = await db.prepare("UPDATE f7_after SET tries = tries + 1, tried_at = ? WHERE seq = ? AND done_at IS NULL RETURNING tries, kind").bind(Date.now(), seq).first<{ tries: number; kind: string }>();
  if (!r) return { skip: true, done: true };
  if (r.tries <= 5 || r.kind === "state_file") return { skip: false, tries: r.tries };
  await db.prepare("UPDATE f7_after SET done_at = ?, res = 'fail tries' WHERE seq = ? AND done_at IS NULL").bind(Date.now(), seq).run();
  return { skip: true, tries: r.tries };
}
export async function afterDone(db: DB, seq: number[], res: string) {
  const s = seq.filter(n => Number.isInteger(n)).slice(0, 100);
  if (s.length) await db.batch(s.map(n => db.prepare("UPDATE f7_after SET done_at = ?, res = ? WHERE seq = ?").bind(Date.now(), res.slice(0, 300), n)));
  return s.length;
}
export async function seed(db: DB, k: string, v: V, force: boolean) {
  const now = Date.now();
  if (k === "drafts") {   // 키마다 한 줄(파일 순서 = ord)
    if (!force && await db.prepare("SELECT 1 FROM owner_state WHERE k = 'drafts'").first()) return false;
    const st = [db.prepare("DELETE FROM owner_state WHERE k > 'drafts:' AND k < 'drafts;'"),
      db.prepare("INSERT INTO owner_state(k, v, at, ver) VALUES ('drafts', '{}', ?, 0) ON CONFLICT(k) DO UPDATE SET at = excluded.at, ver = owner_state.ver + 1").bind(now),
      ...Object.entries(v).map(([key, e], i) => db.prepare("INSERT INTO owner_state(k, v, at, ver, ord) VALUES (?, ?, ?, 0, ?)").bind(DP + key, JSON.stringify(e), now, i + 1))];
    for (let i = 0; i < st.length; i += 100) await db.batch(st.slice(i, i + 100));   // 처음 batch 에 지우기 · 표시 — 나머지는 이어서(중간에 죽으면 다시 seed --force)
    return true;
  }
  const q = force ? "INSERT INTO owner_state(k, v, at, ver) VALUES (?, ?, ?, 0) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at, ver = owner_state.ver + 1"
    : "INSERT OR IGNORE INTO owner_state(k, v, at, ver) VALUES (?, ?, ?, 0)";
  return (await db.prepare(q).bind(k, JSON.stringify(v), now).run()).meta.changes > 0;
}
