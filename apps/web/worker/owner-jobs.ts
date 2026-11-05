import { ridOfBody } from "./queue";
import { redact } from "./session/redact";

type DB = D1Database;
export const PATHS = new Set(["/api/chat", "/api/inbox", "/api/clientlog", "/api/answer", "/api/todo", "/api/cardcheck", "/api/split/move"]);
export const STUCK = 30_000;
export const LEASE = 120_000, BEAT_MAX = 10 * 60_000, MAX_AGE = 6 * 3600_000, MAX_TRIES = 5, KEEP = 2 * 86_400_000, BODY_MAX = 20_000, RESULT_MAX = 64 * 1024;
const ERR = "일시적인 오류가 발생했어요";

/** 순서 열쇠 — 같은 열쇠는 받은 순서대로 하나씩. 채팅은 채널마다(같은 채널의 새 글 · 스레드 답 · 반응 · 읽음이 받은 순서), 나머지는 길마다 */
export function okeyOf(path: string, b: Record<string, unknown>, rid: string) {
  const s = (v: unknown) => String(v ?? "").slice(0, 120);
  if (path === "/api/chat") return (b.seen ? "seen:" : "chat:") + s(b.channel);
  if (path === "/api/sess/send") return "sess:" + s(b.pane || b.name);
  if (path === "/api/chat/send") return "cs:" + s(b.sid);
  if (path === "/api/clientlog") return "log:" + rid;   // 순서 없음
  if (path === "/api/answer" || path === "/api/todo" || path === "/api/cardcheck") return "card";
  if (path === "/api/artpin") return "art:" + s(b.art);
  return path;
}

/** 줄 하나 넣기 — new(새로) · dup(같은 rid 가 이미 있음) · null(실행기가 안 당김 → 다리 길). D1 오류는 던짐 */
export async function enqueue(db: DB, j: { rid: string; kind: string; okey: string; body: string }, now = Date.now()): Promise<"new" | "dup" | null> {
  const r = await db.prepare("INSERT INTO owner_job(rid, kind, okey, body, at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM owner_job_beat WHERE id = 1 AND at > ?) ON CONFLICT(rid) DO NOTHING")
    .bind(j.rid, j.kind, j.okey, j.body, now, now - BEAT_MAX).run();
  if (r.meta.changes) return "new";
  return (await db.prepare("SELECT 1 FROM owner_job WHERE rid = ?").bind(j.rid).first()) ? "dup" : null;
}

/** 주인 POST 하나를 줄로 — null 이면 줄을 안 만듦(다리 길로). status 400 은 몸통 모양이 틀림(server.py 와 같은 답) */
export async function accept(db: DB, path: string, raw: Uint8Array, mkRid: () => string = () => crypto.randomUUID()): Promise<{ status: number; body: Record<string, unknown>; state?: "new" | "dup" } | null> {
  if (raw.length > BODY_MAX) return { status: 400, body: { ok: false, error: "bad json" } };   // server.py 는 20000 까지만 읽음 — 잘린 JSON 은 bad json
  let b: unknown; try { b = JSON.parse(new TextDecoder().decode(raw) || "{}"); } catch { return { status: 400, body: { ok: false, error: "bad json" } }; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return { status: 400, body: { ok: false, error: "bad json" } };
  const o = b as Record<string, unknown>;
  if (path === "/api/chat" && (o.delete || o.edit !== undefined)) return null;   // 고치기 · 지우기 — 화면이 바로 받은 답으로 성공 · 실패를 가름(다리 길)
  const text = new TextDecoder().decode(raw);
  if (redact(text) !== text) return null;
  const rid = ridOfBody(b) || mkRid();
  const st = await enqueue(db, { rid, kind: path, okey: okeyOf(path, o, rid), body: text });
  return st ? { status: 202, body: { ok: true, rid, state: "queued" }, state: st } : null;
}

/** GET /api/answer/:rid — 그 줄의 지금 상태(server.py _jobs 답 꼴). 줄이 없으면 null(다른 길이 앎) */
const QUEUED = new Set(["queued", "posting", "sending"]);
export async function answer(db: DB, rid: string, now = Date.now()): Promise<Record<string, unknown> | null> {
  const r = await db.prepare("SELECT done_at, upd_at, status, result FROM owner_job WHERE rid = ?").bind(rid).first<{ done_at: number | null; upd_at: number | null; status: number | null; result: string | null }>();
  if (!r) return null;
  if (r.done_at == null) return { rid, state: "queued" };
  let o: Record<string, unknown> = {}; try { const p = JSON.parse(r.result || "{}"); if (p && typeof p === "object" && !Array.isArray(p)) o = p; } catch {}
  delete o.text;   // server.py 답도 text 는 뺌
  if ((r.status ?? 500) >= 400) return { ...o, rid, state: "fail", error: typeof o.error === "string" && o.error ? o.error : ERR };
  const state = typeof o.state === "string" && o.state ? o.state : "ok";
  if (QUEUED.has(state) && !o.posted && now - (r.upd_at ?? r.done_at) > STUCK) return null;
  return { ...o, rid, state };
}

/** 실행기 당김: 오래된 줄 · 너무 많이 맡긴 줄은 실패로 끝내고, 열쇠마다 맨 앞 줄(맡김이 풀린 것)만 LEASE 동안 맡김. 당긴 때(beat)도 남김 */
export async function take(db: DB, limit: number, now = Date.now()) {
  const n = Math.max(1, Math.min(20, Math.floor(limit) || 1));
  await db.batch([
    db.prepare("INSERT INTO owner_job_beat(id, at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at WHERE owner_job_beat.at < ?").bind(now, now - 5_000),
    db.prepare("UPDATE owner_job SET done_at = ?, status = 500, result = ?, body = '' WHERE done_at IS NULL AND (at < ? OR (tries >= ? AND taken_at < ?))")
      .bind(now, JSON.stringify({ ok: false, error: ERR, why: "기기가 처리하지 못함" }), now - MAX_AGE, MAX_TRIES, now - LEASE),
  ]);
  const r = await db.prepare(`UPDATE owner_job SET taken_at = ?, tries = tries + 1 WHERE seq IN (
      SELECT seq FROM owner_job j WHERE done_at IS NULL AND (taken_at IS NULL OR taken_at < ?)
        AND seq = (SELECT MIN(seq) FROM owner_job k WHERE k.okey = j.okey AND k.done_at IS NULL)
      ORDER BY seq LIMIT ?) RETURNING seq, rid, kind, okey, body, at, tries`).bind(now, now - LEASE, n).all<{ seq: number; rid: string; kind: string; okey: string; body: string; at: number; tries: number }>();
  if (Math.random() < 0.01) await db.prepare("DELETE FROM owner_job WHERE done_at IS NOT NULL AND done_at < ?").bind(now - KEEP).run().catch(() => {});
  return (r.results || []).sort((a, b) => a.seq - b.seq);
}

export async function finish(db: DB, rid: string, status: number, result: unknown, now = Date.now()) {
  const o = result && typeof result === "object" && !Array.isArray(result) ? { ...result as Record<string, unknown> } : {};
  delete o.text;   // 글 원문은 결과에 안 남김(server.py 답도 text 를 뺌)
  let s = ""; try { s = JSON.stringify(o); } catch { s = "{}"; }
  if (s.length > RESULT_MAX) s = JSON.stringify({ ok: status < 400, ...(status >= 400 ? { error: ERR } : {}) });
  const st = Number.isInteger(status) && status >= 100 && status < 600 ? status : 500;
  const r = await db.prepare("UPDATE owner_job SET done_at = COALESCE(done_at, ?), upd_at = ?, status = ?, result = ?, body = '' WHERE rid = ?").bind(now, now, st, s, rid).run();
  return r.meta.changes || 0;
}

/** 상태(/api/relay/jobs/stat): 쌓인 수 · 가장 오래된 줄 나이 · 마지막 당김 */
export async function stat(db: DB, now = Date.now()) {
  const [o, b] = await db.batch<{ n?: number; old?: number | null; at?: number }>([
    db.prepare("SELECT count(*) AS n, min(at) AS old FROM owner_job WHERE done_at IS NULL"),
    db.prepare("SELECT at FROM owner_job_beat WHERE id = 1"),
  ]);
  const x = o.results[0] || {}, beat = b.results[0]?.at ?? null;
  return { open: x.n || 0, oldest_s: x.old ? Math.round((now - x.old) / 1000) : null, beat_s: beat ? Math.round((now - beat) / 1000) : null, beat_ok: !!beat && now - beat < BEAT_MAX };
}
