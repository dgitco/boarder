import { DurableObject } from "cloudflare:workers";

export type Doc = {
  id: string;
  kind: "node" | "card" | "chat" | "log" | "art";
  title: string; body: string;
  node?: string;
  ch?: string;
  at: number;                  // 초
  meta?: Record<string, unknown>;
  emb?: boolean;               // 뜻 검색에 넣을지(개인 채널 글은 안 넣음)
};
type Row = { rid: number; id: string; kind: Doc["kind"]; title: string; body: string; node: string | null; ch: string | null; at: number; meta: string | null };
type Env = { AI: Ai };

const MODEL = "@cf/baai/bge-m3", DIM = 1024;
const SEM_MIN: Record<string, number> = { node: 0.42, card: 0.55, art: 0.5, log: 0.58, chat: 0.62 };
const EMB_BATCH = 64, EMB_PAR = 3;   // 알람 한 번에 64 × 3(처음 채울 때 ~9천 개, 이후는 바뀐 것만)

export class Search extends DurableObject<Env> {
  private mat: Int8Array | null = null;     // 뜻 벡터(문서마다 DIM 칸) — 처음 찾을 때 한 번 올리고 바뀌면 버림
  private rids: number[] = [];
  private mins = new Float32Array(0);
  private qcache = new Map<string, Float32Array>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const s = ctx.storage.sql;
    s.exec(`CREATE TABLE IF NOT EXISTS doc(rid INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      node TEXT, ch TEXT, at REAL NOT NULL, meta TEXT, sig TEXT NOT NULL, emb INTEGER NOT NULL DEFAULT 0)`);
    s.exec("CREATE INDEX IF NOT EXISTS doc_node ON doc(node)");
    s.exec("CREATE INDEX IF NOT EXISTS doc_at ON doc(at)");
    s.exec("CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(title, body, tokenize='trigram')");   // rowid = doc.rid
    // 2글자 낱말(「가산」 → 가산세 · 「위하」)은 trigram 이 못 받음 — 낱말 앞부분 색인(unicode61, 앞 1 · 2글자)으로. 줄 끝 LIKE 훑기는 80ms+ 였음
    s.exec("CREATE VIRTUAL TABLE IF NOT EXISTS fts2 USING fts5(title, body, tokenize='unicode61 remove_diacritics 0', prefix='1 2')");
    if (!s.exec("SELECT rowid FROM fts2 LIMIT 1").toArray().length) s.exec("INSERT INTO fts2(rowid, title, body) SELECT rid, title, body FROM doc");   // 처음 한 번 채움
    s.exec("CREATE TABLE IF NOT EXISTS vec(rid INTEGER PRIMARY KEY, v BLOB NOT NULL, sig TEXT)");     // sig = 그 벡터를 만든 글의 해시
    s.exec("CREATE TABLE IF NOT EXISTS embq(rid INTEGER PRIMARY KEY, tries INTEGER NOT NULL DEFAULT 0)");
  }

  private drop(rid: number) {
    const s = this.ctx.storage.sql;
    s.exec("DELETE FROM fts WHERE rowid=?", rid); s.exec("DELETE FROM fts2 WHERE rowid=?", rid); s.exec("DELETE FROM embq WHERE rid=?", rid); s.exec("DELETE FROM doc WHERE rid=?", rid);
    if (s.exec("DELETE FROM vec WHERE rid=?", rid).rowsWritten) this.mat = null;
  }

  async upsert(docs: Doc[], del: string[] = [], all?: string[]) {
    const s = this.ctx.storage.sql; let n = 0, q = 0, gone = 0;
    for (const id of del) { const r = s.exec<{ rid: number }>("SELECT rid FROM doc WHERE id=?", id).toArray()[0]; if (r) { this.drop(r.rid); gone++; } }
    if (all) {
      const keep = new Set(all);
      for (const r of s.exec<{ rid: number; id: string }>("SELECT rid, id FROM doc").toArray()) if (!keep.has(r.id)) { this.drop(r.rid); gone++; }
    }
    for (const d of docs) {
      const title = String(d.title || "").slice(0, 300), body = String(d.body || "").slice(0, 4000), emb = d.emb ? 1 : 0;
      const tsig = await sig8(JSON.stringify([title, body]));
      const sig = await sig8(JSON.stringify([d.kind, tsig, d.node || "", d.ch || "", d.at, d.meta || null, emb]));
      const old = s.exec<{ rid: number; sig: string; title: string; body: string }>("SELECT rid, sig, title, body FROM doc WHERE id=?", d.id).toArray()[0];
      if (old?.sig === sig) continue;
      n++;
      const meta = d.meta ? JSON.stringify(d.meta) : null;
      let rid: number;
      if (old) {
        rid = old.rid;
        s.exec("UPDATE doc SET kind=?, title=?, body=?, node=?, ch=?, at=?, meta=?, sig=?, emb=? WHERE rid=?", d.kind, title, body, d.node || null, d.ch || null, d.at, meta, sig, emb, rid);
        if (old.title !== title || old.body !== body) for (const t of ["fts", "fts2"]) { s.exec(`DELETE FROM ${t} WHERE rowid=?`, rid); s.exec(`INSERT INTO ${t}(rowid, title, body) VALUES(?,?,?)`, rid, title, body); }
      } else {
        rid = s.exec<{ rid: number }>("INSERT INTO doc(id, kind, title, body, node, ch, at, meta, sig, emb) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING rid", d.id, d.kind, title, body, d.node || null, d.ch || null, d.at, meta, sig, emb).one().rid;
        s.exec("INSERT INTO fts(rowid, title, body) VALUES(?,?,?)", rid, title, body); s.exec("INSERT INTO fts2(rowid, title, body) VALUES(?,?,?)", rid, title, body);
      }
      if (!emb) { s.exec("DELETE FROM embq WHERE rid=?", rid); if (s.exec("DELETE FROM vec WHERE rid=?", rid).rowsWritten) this.mat = null; continue; }   // 뜻 검색에 안 넣는 글(개인 등)은 벡터 · 줄 모두 뺌
      const v = s.exec<{ sig: string | null }>("SELECT sig FROM vec WHERE rid=?", rid).toArray()[0];
      if (v?.sig !== tsig) { s.exec("INSERT INTO embq(rid, tries) VALUES(?, 0) ON CONFLICT(rid) DO UPDATE SET tries=0", rid); q++; }   // 글이 같으면(상태 · 시각만 바뀜) 벡터 그대로
    }
    if (q && !(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 500);
    return { changed: n, queued: q, gone, ...this.state() };
  }

  state() {
    const s = this.ctx.storage.sql;
    return { docs: s.exec<{ n: number }>("SELECT count(*) n FROM doc").one().n, vecs: s.exec<{ n: number }>("SELECT count(*) n FROM vec").one().n, pending: s.exec<{ n: number }>("SELECT count(*) n FROM embq").one().n };
  }
  ids() { return this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM doc").toArray().map(r => r.id); }

  async alarm() {
    const s = this.ctx.storage.sql;
    s.exec("DELETE FROM embq WHERE rid NOT IN (SELECT rid FROM doc WHERE emb=1) OR tries >= 5");   // 지운 글 · 뜻 검색 뺀 글 · 다섯 번 실패한 글은 버림(무한 재시도로 한도를 쓰지 않게)
    const rows = s.exec<{ rid: number; title: string; body: string }>("SELECT d.rid, d.title, d.body FROM embq q JOIN doc d ON d.rid=q.rid WHERE d.emb=1 LIMIT ?", EMB_BATCH * EMB_PAR).toArray();
    if (!rows.length) return;
    const tsigs = await Promise.all(rows.map(x => sig8(JSON.stringify([x.title, x.body]))));
    const parts = Array.from({ length: Math.ceil(rows.length / EMB_BATCH) }, (_, i) => rows.slice(i * EMB_BATCH, (i + 1) * EMB_BATCH).map((x, j) => ({ ...x, tsig: tsigs[i * EMB_BATCH + j] })));
    const res = await Promise.allSettled(parts.map(p => this.env.AI.run(MODEL, { text: p.map(x => embText(x.title, x.body)) }) as Promise<{ data: number[][] }>));
    let bad = 0, wrote = 0;
    res.forEach((r, k) => {
      if (r.status !== "fulfilled") { bad++; console.log("search embed", String(r.reason).slice(0, 200)); for (const x of parts[k]) s.exec("UPDATE embq SET tries=tries+1 WHERE rid=?", x.rid); return; }
      parts[k].forEach((x, i) => {
        const now = s.exec<{ title: string; body: string; emb: number }>("SELECT title, body, emb FROM doc WHERE rid=?", x.rid).toArray()[0];
        if (!now || !now.emb || now.title !== x.title || now.body !== x.body) return;
        s.exec("INSERT OR REPLACE INTO vec(rid, v, sig) VALUES(?,?,?)", x.rid, quant(r.value.data[i]).buffer, x.tsig); s.exec("DELETE FROM embq WHERE rid=?", x.rid); wrote++;
      });
    });
    if (wrote) this.mat = null;
    await this.ctx.storage.setAlarm(Date.now() + (bad ? 30_000 : 100));   // 한도 · 일시 오류면 30초 뒤
  }

  private load() {
    if (this.mat) return;
    const rows = this.ctx.storage.sql.exec<{ rid: number; v: ArrayBuffer; kind: string }>("SELECT v.rid, v.v, d.kind FROM vec v JOIN doc d ON d.rid=v.rid WHERE d.emb=1").toArray();
    const m = new Int8Array(rows.length * DIM); this.rids = new Array(rows.length); this.mins = new Float32Array(rows.length);
    rows.forEach((r, i) => { m.set(new Int8Array(r.v), i * DIM); this.rids[i] = r.rid; this.mins[i] = SEM_MIN[r.kind] ?? 0.55; });
    this.mat = m;
  }

  private async qvec(q: string) {
    const hit = this.qcache.get(q); if (hit) return hit;
    const r = await this.env.AI.run(MODEL, { text: [q] }) as { data: number[][] };
    const v = norm(r.data[0]);
    this.qcache.set(q, v); if (this.qcache.size > 300) this.qcache.delete(this.qcache.keys().next().value!);
    return v;
  }

  async query(q0: string, sem: boolean, dbg = false) {
    const t0 = Date.now(), ms: Record<string, number> = {};   // DO 안 시계는 I/O 때만 움직여 lex 는 0 으로 보일 수 있음 — 전체는 Worker 가 잼(ms.worker)
    const q = q0.normalize("NFC").trim().slice(0, 100);
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    if (!terms.length) return { q, ms, nodes: [], cards: [], chats: [], arts: [] };
    const s = this.ctx.storage.sql;
    // ① 낱말
    const long = terms.filter(t => [...t].length >= 3);
    const multiQ = terms.length > 1;
    const short = terms.filter(t => [...t].length < 3).filter(t => !multiQ || !FILLER.has(t));
    if (!long.length && !short.length) short.push(...terms.filter(t => [...t].length < 3));   // 군말만 쳤으면 그대로
    const like = (t: string) => "%" + t.replace(/[\\%_]/g, m => "\\" + m) + "%";
    const q1 = (t: string) => '"' + t.replace(/"/g, '""') + '"*';
    const pre = short.map(t => multiQ && [...t].length === 2 && ENDING.has([...t][1]) ? `(${q1(t)} OR ${q1([...t][0])})` : q1(t)).join(" AND ");   // 2글자 = 낱말 앞부분
    const cols = "d.rid, d.id, d.kind, d.title, d.body, d.node, d.ch, d.at, d.meta";
    let lex: Row[];
    if (long.length) {
      const match = long.map(t => '"' + t.replace(/"/g, '""') + '"').join(" AND ");
      lex = s.exec<Row>(`SELECT ${cols} FROM fts JOIN doc d ON d.rid=fts.rowid
        WHERE fts MATCH ?${short.length ? " AND d.rid IN (SELECT rowid FROM fts2 WHERE fts2 MATCH ?)" : ""} ORDER BY bm25(fts, 4.0, 1.0) LIMIT 300`, match, ...(short.length ? [pre] : [])).toArray();
    } else {
      lex = s.exec<Row>(`SELECT ${cols} FROM fts2 JOIN doc d ON d.rid=fts2.rowid WHERE fts2 MATCH ? ORDER BY bm25(fts2, 4.0, 1.0) LIMIT 300`, pre).toArray();
      // 낱말 가운데 2글자(「하고」 → 위하고)는 제목만 LIKE 로(제목은 짧아 빠름)
      const seen = new Set(lex.map(r => r.rid));
      for (const r of s.exec<Row>(`SELECT ${cols} FROM doc d WHERE ${short.map(() => "d.title LIKE ? ESCAPE '\\'").join(" AND ")} ORDER BY d.at DESC LIMIT 100`, ...short.map(like)))
        if (!seen.has(r.rid)) lex.push(r);
    }
    {
      const seen = new Set(lex.map(r => r.rid));
      const nodeLex = long.length
        ? s.exec<Row>(`SELECT ${cols} FROM fts JOIN doc d ON d.rid=fts.rowid WHERE fts MATCH ? AND d.kind='node'${short.length ? " AND d.rid IN (SELECT rowid FROM fts2 WHERE fts2 MATCH ?)" : ""} ORDER BY bm25(fts, 4.0, 1.0) LIMIT 40`,
            long.map(t => '"' + t.replace(/"/g, '""') + '"').join(" AND "), ...(short.length ? [pre] : [])).toArray()
        : s.exec<Row>(`SELECT ${cols} FROM fts2 JOIN doc d ON d.rid=fts2.rowid WHERE fts2 MATCH ? AND d.kind='node' ORDER BY bm25(fts2, 4.0, 1.0) LIMIT 40`, pre).toArray();
      for (const r of nodeLex) if (!seen.has(r.rid)) lex.push(r);
    }
    ms.lex = Date.now() - t0;
    // ② 뜻
    const semRank: { rid: number; s: number }[] = [];
    if (sem && [...q].length >= 2) {
      const t1 = Date.now();
      try {
        const qv = await this.qvec(q); ms.emb = Date.now() - t1;
        const t2 = Date.now(); this.load();
        const m = this.mat!, n = this.rids.length, top: { rid: number; s: number }[] = [];
        for (let i = 0; i < n; i++) {
          let d = 0; const o = i * DIM;
          for (let j = 0; j < DIM; j++) d += qv[j] * m[o + j];
          d /= 127;
          if (d >= this.mins[i]) top.push({ rid: this.rids[i], s: d });
        }
        top.sort((a, b) => b.s - a.s); semRank.push(...top.slice(0, 400));
        ms.scan = Date.now() - t2;
      } catch (e) { ms.emb_err = 1; console.log("search qvec", String(e).slice(0, 200)); }
    }
    // ③ 합치기(RRF k=60) + 가산
    const now = Date.now() / 1000, score = new Map<number, number>(), semOf = new Map<number, number>(), rows = new Map<number, Row>();
    const norm2 = (t: string) => terms.length > 1 && [...t].length === 2 && ENDING.has([...t][1]) ? [...t][0] : t;
    const kept = terms.filter(t => [...t].length >= 3 || !FILLER.has(t)).map(norm2);   // 붙어 맞음도 다듬은 말로(「돈 받는 거」 → 「돈 받」 ⊂ 「돈 받기」)
    const phrase = (kept.length ? kept : terms).join(" "), multi = (kept.length ? kept : terms).length > 1;
    const flat = (t: string) => t.toLowerCase().replace(/\s+/g, " ");
    const lexRank = new Map<string, number>();   // 낱말 순위도 종류마다 따로(뜻과 같음)
    lex.forEach(r => { rows.set(r.rid, r); const k = lexRank.get(r.kind) || 0; lexRank.set(r.kind, k + 1);
      const whole = !multi || flat(r.title).includes(phrase) || flat(r.body).includes(phrase); score.set(r.rid, (whole ? 1 : 0.35) / (60 + k)); });
    const need = semRank.map(x => x.rid).filter(r => !rows.has(r));
    for (let i = 0; i < need.length; i += 90) {
      const part = need.slice(i, i + 90);
      for (const r of s.exec<Row>(`SELECT rid, id, kind, title, body, node, ch, at, meta FROM doc WHERE rid IN (${part.map(() => "?").join(",")})`, ...part)) rows.set(r.rid, r);
    }
    const kindRank = new Map<string, number>(), kindTop = new Map<string, number>(), lexSet = new Set(lex.map(r => r.rid));
    for (const x of semRank) {
      const r = rows.get(x.rid); if (!r) continue;
      const k = kindRank.get(r.kind) || 0; if (k >= 40) continue; kindRank.set(r.kind, k + 1);
      if (!kindTop.has(r.kind)) kindTop.set(r.kind, x.s);
      const gap = Math.exp((x.s - kindTop.get(r.kind)!) / 0.015);
      semOf.set(x.rid, x.s); score.set(x.rid, (score.get(x.rid) || 0) + (multi && r.kind === "node" ? 1.5 : 1) * gap / (60 + k));
    }
    const tl = (r: Row) => terms.every(t => r.title.toLowerCase().includes(t));
    const boost = (r: Row, m: Record<string, unknown>) => {
      const age = Math.max(0, now - r.at) / 86400;
      let b = 1 + 0.4 * Math.exp(-age / 5);                                    // 최근
      if (tl(r)) b *= 1.6;                                                      // 제목에 다 들어 있음
      if (r.kind === "node" && (m.state === "live" || m.state === "parked")) b *= 1.25;
      if (r.kind === "card" && m.state === "open") b *= 1.4;
      return b;
    };
    type Hit = { r: Row; m: Record<string, unknown>; s: number };
    const hits: Hit[] = [];
    for (const [rid, sc] of score) { const r = rows.get(rid); if (!r) continue; const m = r.meta ? JSON.parse(r.meta) : {}; hits.push({ r, m, s: sc * boost(r, m) }); }
    hits.sort((a, b) => b.s - a.s);
    const nodeScore = new Map<string, { s: number; via?: Hit }>();
    for (const h of hits) {
      const name = h.r.kind === "node" ? h.r.title : h.r.node; if (!name) continue;
      const x = nodeScore.get(name) || { s: 0 };
      const w = lexSet.has(h.r.rid) ? 0.5 : 0.15;   // 낱말 없이 뜻으로만 걸린 글은 노드를 조금만 올림(엉뚱한 짧은 글 막기)
      if (h.r.kind === "node") x.s += h.s; else { x.s += h.s * (x.via ? w / 5 : w); if (!x.via || (lexSet.has(h.r.rid) && !lexSet.has(x.via.r.rid))) x.via = h; }   // 걸린 글은 첫 것만 크게(긴 노드가 아무 낱말에나 뜨지 않게)
      nodeScore.set(name, x);
    }
    const names = [...nodeScore.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, 12).map(x => x[0]);
    const nodeDocs = names.length ? s.exec<Row>(`SELECT rid, id, kind, title, body, node, ch, at, meta FROM doc WHERE id IN (${names.map(() => "?").join(",")})`, ...names.map(n => "n:" + n)).toArray() : [];
    const byName = new Map(nodeDocs.map(r => [r.title, r]));
    const top0 = names.find(n => byName.has(n)), topS = top0 ? nodeScore.get(top0)!.s : 0;
    const nodes = names.filter(n => byName.has(n) && nodeScore.get(n)!.s >= topS * 0.25).slice(0, 6).map(n => {
      const r = byName.get(n)!, m = r.meta ? JSON.parse(r.meta) : {}, via = nodeScore.get(n)!.via;
      return { id: r.id, title: r.title, area: r.ch, ...m, hit: via ? { kind: via.r.kind, text: snip(via.r.body || via.r.title, terms), at: via.r.at } : null };
    });
    const pick = (k: Doc["kind"][], n: number) => hits.filter(h => k.includes(h.r.kind)).slice(0, n).map(h => ({
      id: h.r.id, kind: h.r.kind, title: h.r.title, text: snip(h.r.body, terms), ch: h.r.ch, node: h.r.node, at: h.r.at, ...h.m,
      sem: semOf.has(h.r.rid) && !lexSet.has(h.r.rid) ? 1 : 0,   // 낱말 없이 뜻으로만 걸린 것(화면에 표시)
    }));
    const out = { q, nodes, cards: pick(["card"], 6), chats: pick(["chat", "log"], 8), arts: pick(["art"], 6),
      ...(dbg ? { dbg: [...nodeScore.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, 8).map(([n, x]) => [n, +x.s.toFixed(5), x.via ? [x.via.r.kind, lexSet.has(x.via.r.rid) ? "lex" : "sem", +x.via.s.toFixed(5), x.via.r.body.slice(0, 60)] : null,
        hits.find(h => h.r.kind === "node" && h.r.title === n)?.s.toFixed(5) ?? null, semOf.get(hits.find(h => h.r.kind === "node" && h.r.title === n)?.r.rid ?? -1)?.toFixed(3) ?? null]) } : {}) };
    ms.total = Date.now() - t0;
    return { ...out, ms, vecs: this.rids.length || undefined };
  }
}

const FILLER = new Set(["거", "것", "좀", "걍", "그", "저", "뭐", "더", "등", "건", "게"]);
const ENDING = new Set([..."는은을를이가의기고서면한던다요지"]);
const embText = (t: string, b: string) => (t + "\n" + b).slice(0, 1200);
function quant(v: number[]) { const n = norm(v), o = new Int8Array(DIM); for (let i = 0; i < DIM; i++) o[i] = Math.max(-127, Math.min(127, Math.round(n[i] * 127))); return o; }
function norm(v: number[]) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); }
async function sig8(s: string) { const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); return [...h.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join(""); }
// 찾은 낱말 둘레 ±45자(없으면 앞부분)
function snip(text: string, terms: string[]) {
  const t = String(text || "").replace(/\s+/g, " ").trim(), lo = t.toLowerCase();
  let at = -1; for (const w of terms) { const i = lo.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return t.slice(0, 110);
  const a = Math.max(0, at - 45), b = Math.min(t.length, at + 65);
  return (a > 0 ? "…" : "") + t.slice(a, b) + (b < t.length ? "…" : "");
}
