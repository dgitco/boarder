import * as files from "./files";
import { ridBatch } from "./queue";

type Env = Parameters<typeof files.index>[0] & { DB: D1Database };
const MAX_TEXT = 4000;
const now = () => Date.now() / 1000;
const change = (db: D1Database, t: string, pk: unknown[], op: "up" | "del") =>
  db.prepare("INSERT INTO wl_change(tbl, pk, op, at, origin) VALUES (?, ?, ?, ?, 'web')").bind(t, JSON.stringify(pk), op, Date.now());

async function notes(db: D1Database, art: string) {   // artnotes.notes 와 같은 꼴
  const r = await db.prepare("SELECT id, target, page, who, text, at FROM wl_art_note WHERE art = ? AND deleted_at IS NULL ORDER BY at, id").bind(art).all();
  return r.results;
}

export async function artnote(env: Env, body: { art?: unknown; del?: unknown; target?: unknown; page?: unknown; text?: unknown }, rid = ""): Promise<[number, object] | null> {
  const art = String(body.art || "");
  const ix = await files.index(env); if (!ix) return null;
  if (!/^[A-Za-z0-9]{16,40}$/.test(art) || !ix.arts[art]) return [404, { ok: false, error: "없는 아티팩트" }];
  if (body.del) {
    const id = Number(body.del); if (!Number.isInteger(id)) return [400, { ok: false, error: "빈 댓글" }];
    await ridBatch(env.DB, rid, [
      env.DB.prepare("UPDATE wl_art_note SET deleted_at = ? WHERE id = ? AND art = ? AND who = 'owner' AND deleted_at IS NULL").bind(now(), id, art),
      env.DB.prepare("INSERT INTO wl_change(tbl, pk, op, at, origin) SELECT 'art_note', json_array(?), 'up', ?, 'web' WHERE changes() > 0").bind(id, Date.now())]);
  } else {
    const text = String(body.text || "").trim().slice(0, MAX_TEXT), target = String(body.target || "").slice(0, 200);
    if (!text || !target) return [400, { ok: false, error: "빈 댓글" }];
    // id 는 D1 이 정함(정본이 하나라 사본과 겹치지 않음) — 한 문장 안에서 max+1, 바뀜 기록은 같은 트랜잭션에서 그 id 로
    await ridBatch(env.DB, rid, [
      env.DB.prepare("INSERT INTO wl_art_note(id, art, target, page, who, text, at) SELECT coalesce(max(id), 0) + 1, ?, ?, ?, 'owner', ?, ? FROM wl_art_note")
        .bind(art, target, String(body.page || "").slice(0, 200), text, now()),
      env.DB.prepare("INSERT INTO wl_change(tbl, pk, op, at, origin) VALUES ('art_note', json_array((SELECT max(id) FROM wl_art_note)), 'up', ?, 'web')").bind(Date.now())]);
  }
  return [200, { ok: true, notes: await notes(env.DB, art) }];
}

export async function artfolder(env: Env, body: { art?: unknown; folder?: unknown }, rid = ""): Promise<[number, object] | null> {
  const art = String(body.art || "");
  const ix = await files.index(env); if (!ix) return null;
  if (!/^[A-Za-z0-9]{16,40}$/.test(art) || !ix.arts[art]) return [404, { ok: false, error: "없는 아티팩트" }];
  // artnotes.set_folder 와 같게: 「영역/종류」 칸마다 공백 줄이고 40자, 전체 120자, '' 면 자동 분류로
  const folder = String(body.folder || "").split("/").map(p => p.replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean).join("/").slice(0, 120);
  if (folder) await ridBatch(env.DB, rid, [   // 쓰기 · 바뀜 기록 한 batch
    env.DB.prepare("INSERT INTO wl_art_folder(art, folder, at) VALUES (?, ?, ?) ON CONFLICT(art) DO UPDATE SET folder = excluded.folder, at = excluded.at").bind(art, folder, now()),
    change(env.DB, "art_folder", [art], "up")]);
  else await ridBatch(env.DB, rid, [env.DB.prepare("DELETE FROM wl_art_folder WHERE art = ?").bind(art), change(env.DB, "art_folder", [art], "del")]);
  return [200, { ok: true, folder: folder || ix.arts[art].auto }];
}

export async function changes(db: D1Database, spec: Record<string, { cols: string[]; pk: string[] }>, after: number, limit: number) {
  const r = await db.prepare("SELECT seq, tbl, pk, op FROM wl_change WHERE origin = 'web' AND seq > ? ORDER BY seq LIMIT ?").bind(after, Math.min(Math.max(limit, 1), 500)).all<{ seq: number; tbl: string; pk: string; op: string }>();
  const cs = r.results.filter(c => spec[c.tbl]), keys = cs.map(c => JSON.parse(c.pk) as unknown[]);
  const got = cs.length ? await db.batch(cs.map((c, i) => { const s = spec[c.tbl];
    return db.prepare(`SELECT ${s.cols.map(x => `"${x}"`).join(",")} FROM wl_${c.tbl} WHERE ${s.pk.map(k => `"${k}" = ?`).join(" AND ")}`).bind(...keys[i]); })) : [];
  return cs.map((c, i) => ({ seq: c.seq, t: c.tbl, pk: Object.fromEntries(spec[c.tbl].pk.map((k, j) => [k, keys[i][j]])), row: got[i].results[0] || null }));
}
