import { DurableObject } from "cloudflare:workers";

export type Doc = {
  id: string;
  kind: "node" | "card" | "chat" | "log" | "art";
  title: string; body: string;
  node?: string;
  ch?: string;
  at: number;                  // 초
  meta?: Record<string, unknown>;
  ext?: boolean;               // 릴레이가 외부 임베딩 전송을 허용한 글만
  tags?: string[];
  emb?: boolean;               // 뜻 검색에 넣을지(개인 채널 글은 안 넣음)
};
type Row = { rid: number; id: string; kind: Doc["kind"]; title: string; body: string; node: string | null; ch: string | null; at: number; meta: string | null; tags: string | null };
type Env = { AI: Ai; VOYAGE_API_KEY?: string };
export type Engine = "bge" | "voyage" | "mix";

const MODEL = "@cf/baai/bge-m3", DIM = 1024;
const SEM_MIN: Record<string, number> = { node: 0.42, card: 0.55, art: 0.5, log: 0.58, chat: 0.62 };
const VOYAGE_MODEL = "voyage-3.5";
const VOYAGE_MIN: Record<string, number> = { node: 0.35, card: 0.4, art: 0.4, log: 0.42, chat: 0.42 };
const EMB_BATCH = 64, EMB_PAR = 3;
const EMB_TRIES = 30, EMB_RETRY_MS = 30_000, EMB_RETRY_MAX_MS = 3_600_000;

export class Search extends DurableObject<Env> {
  private mat: Int8Array | null = null;     // 뜻 벡터(문서마다 DIM 칸) — 처음 찾을 때 한 번 올리고 바뀌면 버림
  private rids: number[] = [];
  private mins = new Float32Array(0);
  private qcache = new Map<string, Float32Array>();

  private voyageCache = new Map<string, Float32Array>();
  private voyageMat: { mat: Int8Array; rids: number[]; mins: Float32Array } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const s = ctx.storage.sql;
    s.exec(`CREATE TABLE IF NOT EXISTS doc(rid INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      node TEXT, ch TEXT, at REAL NOT NULL, meta TEXT, sig TEXT NOT NULL, emb INTEGER NOT NULL DEFAULT 0)`);
    const columns = new Set(s.exec<{ name: string }>("PRAGMA table_info(doc)").toArray().map(r => r.name));
    if (!columns.has("tags")) s.exec("ALTER TABLE doc ADD COLUMN tags TEXT");
    if (!columns.has("ext")) s.exec("ALTER TABLE doc ADD COLUMN ext INTEGER NOT NULL DEFAULT 0");
    s.exec("CREATE INDEX IF NOT EXISTS doc_node ON doc(node)");
    s.exec("CREATE INDEX IF NOT EXISTS doc_at ON doc(at)");
    s.exec("CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(title, body, tokenize='trigram')");   // rowid = doc.rid
    // 2글자 낱말(「회의」 → 회의록 · 「보더」)은 trigram 이 못 받음 — 낱말 앞부분 색인(unicode61, 앞 1 · 2글자)으로. 줄 끝 LIKE 훑기는 80ms+ 였음
    s.exec("CREATE VIRTUAL TABLE IF NOT EXISTS fts2 USING fts5(title, body, tokenize='unicode61 remove_diacritics 0', prefix='1 2')");
    if (!s.exec("SELECT rowid FROM fts2 LIMIT 1").toArray().length) s.exec("INSERT INTO fts2(rowid, title, body) SELECT rid, title, COALESCE(tags, '') || char(10) || body FROM doc");   // 처음 한 번 채움
    s.exec("CREATE TABLE IF NOT EXISTS vec(rid INTEGER PRIMARY KEY, v BLOB NOT NULL, sig TEXT)");     // sig = 그 벡터를 만든 글의 해시
    s.exec("CREATE TABLE IF NOT EXISTS embq(rid INTEGER PRIMARY KEY, tries INTEGER NOT NULL DEFAULT 0)");
    s.exec("CREATE TABLE IF NOT EXISTS vec2(rid INTEGER PRIMARY KEY, v BLOB NOT NULL, sig TEXT)");
    s.exec("CREATE TABLE IF NOT EXISTS embq2(rid INTEGER PRIMARY KEY, tries INTEGER NOT NULL DEFAULT 0)");
    for (const t of ["embq", "embq2"]) if (!s.exec<{ name: string }>(`PRAGMA table_info(${t})`).toArray().some(r => r.name === "next_at")) s.exec(`ALTER TABLE ${t} ADD COLUMN next_at INTEGER NOT NULL DEFAULT 0`);
  }

  private drop(rid: number) {
    const s = this.ctx.storage.sql;
    s.exec("DELETE FROM fts WHERE rowid=?", rid); s.exec("DELETE FROM fts2 WHERE rowid=?", rid); s.exec("DELETE FROM embq WHERE rid=?", rid); s.exec("DELETE FROM doc WHERE rid=?", rid);
    if (s.exec("DELETE FROM vec WHERE rid=?", rid).rowsWritten) this.mat = null;
    s.exec("DELETE FROM embq2 WHERE rid=?", rid);
    if (s.exec("DELETE FROM vec2 WHERE rid=?", rid).rowsWritten) this.voyageMat = null;
  }

  async upsert(docs: Doc[], del: string[] = [], all?: string[]) {
    const s = this.ctx.storage.sql; let n = 0, q = 0, gone = 0;
    for (const id of del) { const r = s.exec<{ rid: number }>("SELECT rid FROM doc WHERE id=?", id).toArray()[0]; if (r) { this.drop(r.rid); gone++; } }
    if (all) {
      const keep = new Set(all);
      for (const r of s.exec<{ rid: number; id: string }>("SELECT rid, id FROM doc").toArray()) if (!keep.has(r.id)) { this.drop(r.rid); gone++; }
    }
    for (const d of docs) {
      const title = String(d.title || "").slice(0, 300), body = String(d.body || "").slice(0, 4000), emb = d.emb || d.ext ? 1 : 0, ext = d.ext ? 1 : 0;
      const tags = JSON.stringify((d.tags || []).slice(0, 30).map(t => String(t).slice(0, 60)));
      const indexedBody = tagBody(body, tags);
      const tsig = await sig8(textSig(title, body, tags));
      const sig = await sig8(JSON.stringify([d.kind, tsig, d.node || "", d.ch || "", d.at, d.meta || null, emb, ext]));
      const old = s.exec<{ rid: number; sig: string; title: string; body: string; tags: string | null; kind: string; emb: number; ext: number }>("SELECT rid, sig, title, body, tags, kind, emb, ext FROM doc WHERE id=?", d.id).toArray()[0];
      if (old?.sig === sig) continue;
      n++;
      const meta = d.meta ? JSON.stringify(d.meta) : null;
      let rid: number;
      if (old) {
        rid = old.rid;
        s.exec("UPDATE doc SET kind=?, title=?, body=?, node=?, ch=?, at=?, meta=?, sig=?, emb=?, tags=?, ext=? WHERE rid=?", d.kind, title, body, d.node || null, d.ch || null, d.at, meta, sig, emb, tags, ext, rid);
        if (old.title !== title || old.body !== body || old.tags !== tags) for (const t of ["fts", "fts2"]) { s.exec(`DELETE FROM ${t} WHERE rowid=?`, rid); s.exec(`INSERT INTO ${t}(rowid, title, body) VALUES(?,?,?)`, rid, title, indexedBody); }
      } else {
        rid = s.exec<{ rid: number }>("INSERT INTO doc(id, kind, title, body, node, ch, at, meta, sig, emb, tags, ext) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING rid", d.id, d.kind, title, body, d.node || null, d.ch || null, d.at, meta, sig, emb, tags, ext).one().rid;
        s.exec("INSERT INTO fts(rowid, title, body) VALUES(?,?,?)", rid, title, indexedBody); s.exec("INSERT INTO fts2(rowid, title, body) VALUES(?,?,?)", rid, title, indexedBody);
      }
      if (!old || old.kind !== d.kind || old.emb !== emb || old.ext !== ext) { this.mat = null; this.voyageMat = null; }   // 종류(문턱) · 허용이 바뀔 때만 행렬을 다시 읽음 — 노드 상태만 바뀌는 45초 올리기마다 비우면 첫 질의가 느림
      if (!ext) { s.exec("DELETE FROM embq2 WHERE rid=?", rid); s.exec("DELETE FROM vec2 WHERE rid=?", rid); }
      else {
        const v2 = s.exec<{ sig: string | null }>("SELECT sig FROM vec2 WHERE rid=?", rid).toArray()[0];
        if (v2?.sig !== tsig) { s.exec("INSERT INTO embq2(rid, tries, next_at) VALUES(?, 0, 0) ON CONFLICT(rid) DO UPDATE SET tries=0, next_at=0", rid); q++; }
      }
      if (!emb) { s.exec("DELETE FROM embq WHERE rid=?", rid); if (s.exec("DELETE FROM vec WHERE rid=?", rid).rowsWritten) this.mat = null; continue; }   // 뜻 검색에 안 넣는 글(개인 등)은 벡터 · 줄 모두 뺌
      const v = s.exec<{ sig: string | null }>("SELECT sig FROM vec WHERE rid=?", rid).toArray()[0];
      if (v?.sig !== tsig) { s.exec("INSERT INTO embq(rid, tries, next_at) VALUES(?, 0, 0) ON CONFLICT(rid) DO UPDATE SET tries=0, next_at=0", rid); q++; }   // 글이 같으면(상태 · 시각만 바뀜) 벡터 그대로
    }
    if ((q || (this.env.VOYAGE_API_KEY && s.exec<{ n: number }>("SELECT count(*) n FROM embq2").one().n)) && true) { const cur = await this.ctx.storage.getAlarm(), at = Date.now() + 500; if (!cur || cur > at) await this.ctx.storage.setAlarm(at); }   // 새 줄은 먼저 오는 알람으로(Voyage 가 오래 실패해 알람이 멀리 걸려 있어도 새 글의 bge 가 안 밀림)
    return { changed: n, queued: q, gone, ...this.state() };
  }

  state() {
    const s = this.ctx.storage.sql;
    return { docs: s.exec<{ n: number }>("SELECT count(*) n FROM doc").one().n, vecs: s.exec<{ n: number }>("SELECT count(*) n FROM vec").one().n, pending: s.exec<{ n: number }>("SELECT count(*) n FROM embq").one().n, voyageVecs: s.exec<{ n: number }>("SELECT count(*) n FROM vec2").one().n, voyagePending: s.exec<{ n: number }>("SELECT count(*) n FROM embq2").one().n };
  }
  ids() { return this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM doc").toArray().map(r => r.id); }

  async alarm() {
    const s = this.ctx.storage.sql;
    s.exec("DELETE FROM embq WHERE rid NOT IN (SELECT rid FROM doc WHERE emb=1) OR tries >= ?", EMB_TRIES);   // 지운 글 · 뜻 검색 뺀 글 · 하루쯤 실패한 글은 버림(무한 재시도로 한도를 쓰지 않게)
    const rows = s.exec<{ rid: number; title: string; body: string; tags: string | null }>("SELECT d.rid, d.title, d.body, d.tags FROM embq q JOIN doc d ON d.rid=q.rid WHERE d.emb=1 AND q.next_at <= ? LIMIT ?", Date.now(), EMB_BATCH * EMB_PAR).toArray();
    if (!rows.length) { await this.alarmVoyage(); await this.rearm(); return; }
    const tsigs = await Promise.all(rows.map(x => sig8(textSig(x.title, x.body, x.tags))));
    const parts = Array.from({ length: Math.ceil(rows.length / EMB_BATCH) }, (_, i) => rows.slice(i * EMB_BATCH, (i + 1) * EMB_BATCH).map((x, j) => ({ ...x, tsig: tsigs[i * EMB_BATCH + j] })));
    const res = await Promise.allSettled(parts.map(p => this.env.AI.run(MODEL, { text: p.map(x => embText(x.title, x.body, x.tags)) }) as Promise<{ data: number[][] }>));
    let bad = 0, wrote = 0; const failAt = Date.now();   // 같은 묶음은 같은 다음 시각(1ms 씩 어긋나 다음에 쪼개지지 않게)
    res.forEach((r, k) => {
      if (r.status !== "fulfilled") { bad++; console.log("search embed failed"); for (const x of parts[k]) s.exec("UPDATE embq SET tries=tries+1, next_at=? + min(?, ? * (1 << tries)) WHERE rid=?", failAt, EMB_RETRY_MAX_MS, EMB_RETRY_MS, x.rid); return; }
      parts[k].forEach((x, i) => {
        const now = s.exec<{ title: string; body: string; emb: number; tags: string | null }>("SELECT title, body, emb, tags FROM doc WHERE rid=?", x.rid).toArray()[0];
        if (!now || !now.emb || now.title !== x.title || now.body !== x.body || now.tags !== x.tags) return;
        s.exec("INSERT OR REPLACE INTO vec(rid, v, sig) VALUES(?,?,?)", x.rid, quant(r.value.data[i]).buffer, x.tsig); s.exec("DELETE FROM embq WHERE rid=?", x.rid); wrote++;
      });
    });
    if (wrote) this.mat = null;
    await this.alarmVoyage();
    await this.rearm();
  }

  private async rearm() {
    const s = this.ctx.storage.sql;
    const a = s.exec<{ n: number | null }>("SELECT min(q.next_at) n FROM embq q JOIN doc d ON d.rid=q.rid WHERE d.emb=1").one().n;
    const b = this.env.VOYAGE_API_KEY ? s.exec<{ n: number | null }>("SELECT min(q.next_at) n FROM embq2 q JOIN doc d ON d.rid=q.rid WHERE d.ext=1").one().n : null;
    const m = [a, b].filter((x): x is number => x !== null);
    if (m.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, Math.min(...m)));
  }

  private async voyage(input: string[], input_type: "document" | "query") {
    if (!this.env.VOYAGE_API_KEY) throw new Error("Voyage unavailable");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        (async () => {
          const r = await fetch("https://api.voyageai.com/v1/embeddings", {
            method: "POST", headers: { "Authorization": `Bearer ${this.env.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ input: input.map(t => t.slice(0, 1200)), model: VOYAGE_MODEL, input_type }), signal: controller.signal,
          });
          if (!r.ok) throw new Error("Voyage response failed");
          const body = await r.json() as { data: { index: number; embedding: number[] }[] };
          const data = body.data.slice().sort((a, b) => a.index - b.index);
          if (data.length !== input.length || data.some((x, i) => x.index !== i || x.embedding?.length !== DIM || !x.embedding.every(Number.isFinite) || !x.embedding.some(v => v !== 0))) throw new Error("Voyage vector invalid");
          return data.map(x => x.embedding);
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Voyage timeout")); }, input_type === "query" ? 1500 : 30_000); }),
      ]);
    } finally { clearTimeout(timer!); }
  }

  private async alarmVoyage() {
    const s = this.ctx.storage.sql;
    s.exec("DELETE FROM embq2 WHERE rid NOT IN (SELECT rid FROM doc WHERE ext=1) OR tries >= ?", EMB_TRIES);
    if (!this.env.VOYAGE_API_KEY) return; // 키 없이 bge만 쓰는 동안 외부 줄은 보존
    const rows = s.exec<{ rid: number; title: string; body: string; tags: string | null }>("SELECT d.rid, d.title, d.body, d.tags FROM embq2 q JOIN doc d ON d.rid=q.rid WHERE d.ext=1 AND q.next_at <= ? LIMIT 128", Date.now()).toArray();
    if (!rows.length) return;
    const failAt = Date.now();
    try {
      const data = await this.voyage(rows.map(x => maskExt(embText(x.title, x.body, x.tags))), "document");   // 밖으로 나가는 글만 식별 번호 가림(저장 본문은 원문 그대로)
      for (const [i, x] of rows.entries()) {
        const sig = await sig8(textSig(x.title, x.body, x.tags));
        const now = s.exec<{ title: string; body: string; tags: string | null; ext: number }>("SELECT title, body, tags, ext FROM doc WHERE rid=?", x.rid).toArray()[0];
        if (!now?.ext || now.title !== x.title || now.body !== x.body || now.tags !== x.tags) continue;
        s.exec("INSERT OR REPLACE INTO vec2(rid, v, sig) VALUES(?,?,?)", x.rid, quant(data[i]).buffer, sig);
        s.exec("DELETE FROM embq2 WHERE rid=?", x.rid);
      }
      this.voyageMat = null;
    } catch { for (const x of rows) s.exec("UPDATE embq2 SET tries=tries+1, next_at=? + min(?, ? * (1 << tries)) WHERE rid=?", failAt, EMB_RETRY_MAX_MS, EMB_RETRY_MS, x.rid); }
  }

  private loadVoyage() {
    if (this.voyageMat) return this.voyageMat;
    const rows = this.ctx.storage.sql.exec<{ rid: number; v: ArrayBuffer; kind: string }>("SELECT v.rid, v.v, d.kind FROM vec2 v JOIN doc d ON d.rid=v.rid WHERE d.ext=1").toArray();
    const mat = new Int8Array(rows.length * DIM), mins = new Float32Array(rows.length);
    rows.forEach((r, i) => { mat.set(new Int8Array(r.v), i * DIM); mins[i] = VOYAGE_MIN[r.kind] ?? 0.8; });
    return this.voyageMat = { mat, mins, rids: rows.map(r => r.rid) };
  }

  private async voyageQvec(q: string) {
    const cached = this.voyageCache.get(q); if (cached) return cached;
    const v = norm((await this.voyage([maskExt(q)], "query"))[0]);
    this.voyageCache.set(q, v);
    if (this.voyageCache.size > 300) this.voyageCache.delete(this.voyageCache.keys().next().value!);
    return v;
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

  async query(q0: string, sem: boolean, dbg = false, engine: Engine = "mix") {
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
    const cols = "d.rid, d.id, d.kind, d.title, d.body, d.node, d.ch, d.at, d.meta, d.tags";
    let lex: Row[];
    if (long.length) {
      const match = long.map(t => '"' + t.replace(/"/g, '""') + '"').join(" AND ");
      lex = s.exec<Row>(`SELECT ${cols} FROM fts JOIN doc d ON d.rid=fts.rowid
        WHERE fts MATCH ?${short.length ? " AND d.rid IN (SELECT rowid FROM fts2 WHERE fts2 MATCH ?)" : ""} ORDER BY bm25(fts, 4.0, 1.0) LIMIT 300`, match, ...(short.length ? [pre] : [])).toArray();
    } else {
      lex = s.exec<Row>(`SELECT ${cols} FROM fts2 JOIN doc d ON d.rid=fts2.rowid WHERE fts2 MATCH ? ORDER BY bm25(fts2, 4.0, 1.0) LIMIT 300`, pre).toArray();
      // 낱말 가운데 2글자(「의록」 → 회의록)는 제목만 LIKE 로(제목은 짧아 빠름)
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
    type Rank = { rid: number; s: number };
    const semRank: Rank[] = [], voyageRank: Rank[] = [];
    const distributions: Record<string, { rid: number; kind?: string; score: number; min: number }[]> = {};
    const debugKinds = dbg ? new Map(s.exec<{ rid: number; kind: string }>("SELECT rid, kind FROM doc").toArray().map(r => [r.rid, r.kind])) : null;
    if (sem && [...q].length >= 2) {
      const t1 = Date.now();
      const useVoyage = engine !== "bge" && !!this.env.VOYAGE_API_KEY && s.exec("SELECT 1 FROM vec2 LIMIT 1").toArray().length > 0;   // 벡터가 아직 없으면 밖에 부르지 않음
      const [bge, voyage] = await Promise.allSettled([this.qvec(q), useVoyage ? this.voyageQvec(q) : Promise.resolve(null)]);
      ms.emb = Date.now() - t1;
      const scan = (qv: Float32Array, m: Int8Array, rids: number[], mins: Float32Array, name: string) => {
        const top: Rank[] = [], dist = [];
        for (let i = 0; i < rids.length; i++) {
          let d = 0; const o = i * DIM;
          for (let j = 0; j < DIM; j++) d += qv[j] * m[o + j];
          d /= 127;
          if (dbg) dist.push({ rid: rids[i], kind: debugKinds?.get(rids[i]), score: +d.toFixed(4), min: +mins[i].toFixed(3) });
          if (d >= mins[i]) top.push({ rid: rids[i], s: d });
        }
        if (dbg) distributions[name] = dist.sort((a, b) => b.score - a.score).slice(0, 400);
        return top.sort((a, b) => b.s - a.s).slice(0, 400);
      };
      const t2 = Date.now();
      if (voyage.status === "fulfilled" && voyage.value) {
        const v = this.loadVoyage(); voyageRank.push(...scan(voyage.value, v.mat, v.rids, v.mins, "voyage"));
      } else if (useVoyage) ms.voyage_err = 1;
      if (bge.status === "fulfilled" && (engine !== "voyage" || !useVoyage || voyage.status === "rejected")) {
        this.load(); semRank.push(...scan(bge.value, this.mat!, this.rids, this.mins, "bge"));
      } else if (bge.status === "rejected") ms.emb_err = 1;
      ms.scan = Date.now() - t2;
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
    const need = [...semRank, ...voyageRank].map(x => x.rid).filter(r => !rows.has(r));
    for (let i = 0; i < need.length; i += 90) {
      const part = need.slice(i, i + 90);
      for (const r of s.exec<Row>(`SELECT rid, id, kind, title, body, node, ch, at, meta, tags FROM doc WHERE rid IN (${part.map(() => "?").join(",")})`, ...part)) rows.set(r.rid, r);
    }
    const lexSet = new Set(lex.map(r => r.rid)), margin = new Map<number, number>();   // margin = 뜻 점수가 그 종류 문턱을 얼마나 넘었나(엔진마다 따로 — bge · Voyage 점수 칸이 달라서)
    for (const rank of [semRank, voyageRank]) {
      const kindRank = new Map<string, number>(), kindTop = new Map<string, number>();
      for (const x of rank) {
        const r = rows.get(x.rid); if (!r) continue;
        const k = kindRank.get(r.kind) || 0; if (k >= 40) continue; kindRank.set(r.kind, k + 1);
        if (!kindTop.has(r.kind)) kindTop.set(r.kind, x.s);
        const gap = Math.exp((x.s - kindTop.get(r.kind)!) / 0.015);
        semOf.set(x.rid, x.s); margin.set(x.rid, Math.max(margin.get(x.rid) ?? -1, x.s - ((rank === voyageRank ? VOYAGE_MIN : SEM_MIN)[r.kind] ?? 0.55))); score.set(x.rid, (score.get(x.rid) || 0) + (multi && r.kind === "node" ? 1.5 : 1) * gap / (60 + k));
      }
    }
    const tl = (r: Row) => terms.every(t => r.title.toLowerCase().includes(t));
    const boost = (r: Row, m: Record<string, unknown>) => {
      const age = Math.max(0, now - r.at) / 86400;
      let b = 1 + 0.4 * Math.exp(-age / 5);                                    // 최근
      if (tl(r)) b *= 1.6; // 제목과 태그 가산은 중첩하지 않음
      else if (terms.some(t => readTags(r.tags).some(tag => { const g = tag.normalize("NFC").toLowerCase(); return g === t || g.slice(g.indexOf(":") + 1) === t; }))) b *= 1.5;
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
    const nodeDocs = names.length ? s.exec<Row>(`SELECT rid, id, kind, title, body, node, ch, at, meta, tags FROM doc WHERE id IN (${names.map(() => "?").join(",")})`, ...names.map(n => "n:" + n)).toArray() : [];
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
    // 순위에 잡힌 옛 판도 같은 제목의 최신 판으로 대표한다(최신 판에 질의 낱말이 없어도).
    const groups = new Map<string, Row[]>(), artHits = hits.filter(h => h.r.kind === "art");
    if (artHits.length) for (const r of s.exec<Row>("SELECT rid, id, kind, title, body, node, ch, at, meta, tags FROM doc WHERE kind='art' ORDER BY at DESC, id DESC")) {
      const key = artTitle(r.title), g = groups.get(key) || []; g.push(r); groups.set(key, g);
    }
    const seenArts = new Set<string>(), arts = [], cand: { id: string; v: number }[] = [];
    const closeness = (r: Row) => (tl(r) ? 0.7 : 0) + Math.max(0, margin.get(r.rid) ?? 0) + (lexSet.has(r.rid) ? 0.05 : 0);
    for (const h of artHits) {
      const key = artTitle(h.r.title); if (seenArts.has(key)) continue; seenArts.add(key);
      const group = groups.get(key)!, r = group[0], m = r.meta ? JSON.parse(r.meta) : {};
      arts.push({ ...m, id: r.id, kind: r.kind, title: r.title, text: snip(r.body, terms), ch: r.ch, node: m.node ?? r.node, at: r.at,
        tags: readTags(r.tags), thumb: `/art/${encodeURIComponent(r.id.slice(2))}/?thumb`, versions: group.length,
        sem: semOf.has(h.r.rid) && !lexSet.has(h.r.rid) ? 1 : 0 });
      cand.push({ id: r.id, v: closeness(h.r) });
      if (arts.length >= 6) break;
    }
    for (const n of nodes) { const h = hits.find(x => x.r.id === n.id); if (h) cand.push({ id: n.id, v: closeness(h.r) }); }
    for (const h of hits.filter(x => x.r.kind === "card").slice(0, 6)) cand.push({ id: h.r.id, v: closeness(h.r) });
    for (const h of hits.filter(x => x.r.kind === "chat" || x.r.kind === "log").slice(0, 8)) cand.push({ id: h.r.id, v: closeness(h.r) });
    const best = cand.filter(x => x.v >= 0.12).sort((a, b) => b.v - a.v).slice(0, 3).map(x => ({ id: x.id, kind: x.id.startsWith("a:") ? "art" : x.id.startsWith("n:") ? "node" : x.id.startsWith("c:") ? "card" : "chat" }));
    const out = { q, nodes, cards: pick(["card"], 6), chats: pick(["chat", "log"], 8), arts, best,
      ...(dbg ? { engine, semantic: distributions, thresholds: { bge: SEM_MIN, voyage: VOYAGE_MIN } } : {}),
      ...(dbg ? { dbg: [...nodeScore.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, 8).map(([n, x]) => [n, +x.s.toFixed(5), x.via ? [x.via.r.kind, lexSet.has(x.via.r.rid) ? "lex" : "sem", +x.via.s.toFixed(5), x.via.r.body.slice(0, 60)] : null,
        hits.find(h => h.r.kind === "node" && h.r.title === n)?.s.toFixed(5) ?? null, semOf.get(hits.find(h => h.r.kind === "node" && h.r.title === n)?.r.rid ?? -1)?.toFixed(3) ?? null]) } : {}) };
    ms.total = Date.now() - t0;
    return { ...out, ms, vecs: this.rids.length || undefined };
  }
}

const FILLER = new Set(["거", "것", "좀", "걍", "그", "저", "뭐", "더", "등", "건", "게"]);
const ENDING = new Set([..."는은을를이가의기고서면한던다요지"]);
// 밖(Voyage)으로 나가는 글만: 주민번호 · 사업자번호 · 카드 · 계좌 · 전화 · 메일 · 긴 숫자 · 키 꼴을 가림(search-sync 의 search_tags.mask 와 같은 규칙)
const MASKS: [RegExp, string][] = [
  [/\b\d{6}-?[1-8]\d{6}\b/g, "[주민번호]"], [/\b\d{3}-\d{2}-\d{5}\b/g, "[사업자번호]"], [/\b(?:\d{4}[- ]){3}\d{4}\b/g, "[카드번호]"],
  [/\b\d{2,6}-\d{2,6}-\d{3,8}(?:-\d{1,4})?\b/g, "[계좌]"], [/\b01\d[- ]?\d{3,4}[- ]?\d{4}\b/g, "[전화]"], [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[메일]"],
  [/\b\d{9,}\b/g, "[번호]"], [/\b(?:sk|pk|ghp|gho|xox[a-z]|AKIA)[-_A-Za-z0-9]{12,}\b/g, "[비밀]"], [/\b[A-Za-z0-9_-]{32,}\b/g, "[비밀]"],
];
export const maskExt = (t: string) => MASKS.reduce((x, [rx, r]) => x.replace(rx, r), t);
const readTags = (tags: string | null) => tags ? JSON.parse(tags) as string[] : [];
const tagBody = (body: string, tags: string | null) => { const ts = readTags(tags); return ts.length ? ts.join(" ") + "\n" + body : body; };
const textSig = (title: string, body: string, tags: string | null) => JSON.stringify(readTags(tags).length ? [title, body, readTags(tags)] : [title, body]);
const embText = (t: string, b: string, tags: string | null) => (t + "\n" + tagBody(b, tags)).slice(0, 1200);
const artTitle = (title: string) => title.normalize("NFC").replace(/\s*\(replaced\s+by\s+[^)]*\)\s*$/i, "").trim().replace(/\s+/g, " ").toLowerCase();
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
