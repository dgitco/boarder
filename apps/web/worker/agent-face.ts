export type Face = { seed: string; hue: number; photo?: string };
export const KEY = /^[a-z][a-z0-9_]{1,30}$/;

export async function all(db: D1Database, owner: string): Promise<Record<string, Face>> {
  const r = await db.prepare("SELECT key, seed, hue, photo FROM agent_face WHERE owner = ?").bind(owner).all<{ key: string; seed: string; hue: number; photo: string }>();
  return Object.fromEntries((r.results || []).map(x => [x.key, { seed: x.seed, hue: x.hue, ...(x.photo ? { photo: x.photo } : {}) }]));
}

// face 가 null 이면 기본 얼굴로 되돌림(줄 지움)
export async function set(db: D1Database, owner: string, key: string, face: Face | null, now = Date.now()) {
  if (!face) { await db.prepare("DELETE FROM agent_face WHERE owner = ? AND key = ?").bind(owner, key).run(); return; }
  await db.prepare("INSERT INTO agent_face(owner, key, seed, hue, photo, at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner, key) DO UPDATE SET seed = excluded.seed, hue = excluded.hue, photo = excluded.photo, at = excluded.at")
    .bind(owner, key, face.seed, face.hue, face.photo || "", now).run();
}
