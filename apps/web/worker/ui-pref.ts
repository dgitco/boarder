export function uiPrefStmts(db: D1Database, me: string, kv: [string, string][], now: number) {
  return kv.flatMap(([k, v]) => [
    db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v, at = CASE WHEN user_pref.v = excluded.v THEN user_pref.at ELSE excluded.at END").bind(me, "ui:" + k, v, now),
    ...(k === "mainmerge" && v === "1" ? [db.prepare("INSERT OR IGNORE INTO user_pref(owner, k, v, at) VALUES (?, 'mainmerge_at', ?, ?)").bind(me, String(now), now)] : []),
  ]);
}
