export type Face = { seed: string; hue: number; photo?: string };
export type Row = Partial<Face> & { name?: string };   // name = 화면에 보일 이름(빈 글이면 기본), 얼굴 없이 이름만 든 줄은 seed 없음
export const KEY = /^[a-z][a-z0-9_]{1,30}$/;

export async function all(db: D1Database, owner: string): Promise<Record<string, Row>> {
  const r = await db.prepare("SELECT key, seed, hue, photo, name FROM agent_face WHERE owner = ?").bind(owner).all<{ key: string; seed: string; hue: number; photo: string; name: string }>();
  return Object.fromEntries((r.results || []).map(x => [x.key, { ...(x.seed ? { seed: x.seed, hue: x.hue, ...(x.photo ? { photo: x.photo } : {}) } : {}), ...(x.name ? { name: x.name } : {}) }]));
}

// face 가 null 이면 기본 얼굴로 되돌림(줄 지움)
export async function set(db: D1Database, owner: string, key: string, face: Face | null, now = Date.now()) {
  if (!face) {   // 이름이 남아 있으면 얼굴만 비움(줄은 이름용으로 남김)
    await db.prepare("UPDATE agent_face SET seed = '', hue = 0, photo = '', at = ? WHERE owner = ? AND key = ? AND name != ''").bind(now, owner, key).run();
    await db.prepare("DELETE FROM agent_face WHERE owner = ? AND key = ? AND name = ''").bind(owner, key).run(); return; }
  await db.prepare("INSERT INTO agent_face(owner, key, seed, hue, photo, at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner, key) DO UPDATE SET seed = excluded.seed, hue = excluded.hue, photo = excluded.photo, at = excluded.at")
    .bind(owner, key, face.seed, face.hue, face.photo || "", now).run();
}

// 보이는 이름(40자까지, 제어 글자 뺌). 빈 글 = 기본 이름으로 — 얼굴이 없는 줄이면 줄을 지움. 얼굴은 건드리지 않음
export const NAME_MAX = 40;
export const cleanName = (v: unknown) => [...String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim()].slice(0, NAME_MAX).join("");
export async function setName(db: D1Database, owner: string, key: string, name: string, now = Date.now()) {
  if (!name) {
    await db.prepare("UPDATE agent_face SET name = '', at = ? WHERE owner = ? AND key = ? AND seed != ''").bind(now, owner, key).run();
    await db.prepare("DELETE FROM agent_face WHERE owner = ? AND key = ? AND seed = ''").bind(owner, key).run(); return; }
  await db.prepare("INSERT INTO agent_face(owner, key, seed, hue, photo, name, at) VALUES (?,?,'',0,'',?,?) ON CONFLICT(owner, key) DO UPDATE SET name = excluded.name, at = excluded.at")
    .bind(owner, key, name, now).run();
}
