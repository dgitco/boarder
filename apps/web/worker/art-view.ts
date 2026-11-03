export const ART_ID = /^[A-Za-z0-9]{16,40}$/;

/** 사람이 연 것으로 셀 요청인가: GET 문서 · 틀(iframe), 미리보기(?raw · ?embed · ?thumb)는 뺌 */
export function viewable(method: string, dest: string | undefined, search: string) {
  return method === "GET" && (dest === "document" || dest === "iframe") && !/[?&](raw|embed|thumb|shot)(=|&|$)/.test(search);
}

export async function record(db: D1Database, owner: string, art: string, now = Date.now()) {
  if (!owner || !ART_ID.test(art)) return;
  await db.prepare("INSERT INTO art_view (owner, art, first_at, last_at, n) VALUES (?1, ?2, ?3, ?3, 1) ON CONFLICT(owner, art) DO UPDATE SET last_at = ?3, n = n + 1")
    .bind(owner, art, now).run();
}

export type ArtView = { art: string; first_at: number; last_at: number; n: number };
/** since(ms) 뒤에 연 것 — 없으면 전부(최근 순, 최대 2000) */
export async function list(db: D1Database, owner: string, since = 0): Promise<ArtView[]> {
  const s = Number.isFinite(+since) && +since > 0 ? Math.trunc(+since) : 0;
  const r = await db.prepare("SELECT art, first_at, last_at, n FROM art_view WHERE owner = ? AND last_at >= ? ORDER BY last_at DESC LIMIT 2000").bind(owner, s).all<ArtView>();
  return r.results || [];
}
