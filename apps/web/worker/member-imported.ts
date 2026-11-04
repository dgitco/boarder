type Item = { key: string; device_id: string; engine: string; handle: string | null; title: string; state: string };
const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) as T : d; } catch { return d; } };
const COLS = "key, device_id, engine, handle, title, state";

export async function importedWindow(db: D1Database, owner: string, card: { wid: string | null; win: string }): Promise<Item | null> {
  const live = `owner = ? AND kind = 'window' AND gone_at IS NULL AND device_id != ''`;
  let by: { sql: string; args: unknown[] };
  if (card.wid) {
    if (!/^ew_[a-z0-9]{3,40}$/i.test(card.wid)) return null;
    by = { sql: "substr(win, -?) = ?", args: [card.wid.length + 1, ":" + card.wid] };
  } else {
    const tok = await db.prepare("SELECT pane FROM agent_token WHERE owner = ? AND win = ? ORDER BY created_at DESC LIMIT 1").bind(owner, card.win).first<{ pane: string }>();
    by = { sql: "win IN (?, ?)", args: [tok?.pane || card.win, card.win] };
  }
  const now = await db.prepare(`SELECT ${COLS} FROM imp_item WHERE ${live} AND ${by.sql} ORDER BY seen_at DESC LIMIT 1`).bind(owner, ...by.args).first<Item>();
  if (now) return now;
  // 닫힌 그 창(가장 최근 줄) — 내 것 · 기기 붙은 것만
  const old = await db.prepare(`SELECT ${COLS}, session FROM imp_item WHERE owner = ? AND kind = 'window' AND device_id != '' AND ${by.sql} ORDER BY seen_at DESC LIMIT 1`).bind(owner, ...by.args).first<Item & { session: string | null }>();
  if (!old) return null;
  if (old.session) {
    const same = await db.prepare(`SELECT ${COLS} FROM imp_item WHERE ${live} AND session = ? ORDER BY seen_at DESC LIMIT 1`).bind(owner, old.session).first<Item>();
    if (same) return same;
  }
  const { session: _s, ...w } = old;
  if (!w.handle) return null;   // 손잡이가 있어야 다시 열 수 있음(없으면 예전처럼 못 넣음)
  return w.state === "gone" || w.state === "parked" ? { ...w, state: "parked" } : w;
}

export async function queueToImported(db: D1Database, owner: string, w: Item, text: string, card?: string, post = false, whole = false) {
  const line = whole ? text : text.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 2000);
  if (w.state === "parked") {
    const q = await db.prepare("SELECT id, args FROM engine_cmd WHERE owner = ? AND device_id = ? AND verb = 'reopen' AND state = 'queued' AND json_extract(args, '$.item') = ? ORDER BY at DESC LIMIT 1").bind(owner, w.device_id, w.key).first<{ id: string; args: string }>();
    if (q) {
      const a = json<Record<string, unknown>>(q.args, {});
      a.text = whole ? `${String(a.text || "")}\n\n${line}` : `${String(a.text || "")} / ${line}`.slice(0, 4000);
      const u = await db.prepare("UPDATE engine_cmd SET args = ? WHERE id = ? AND state = 'queued'").bind(JSON.stringify(a), q.id).run();
      if (Number(u.meta?.changes ?? 1) > 0) return q.id;
    }
    const busy = await db.prepare("SELECT id FROM engine_cmd WHERE owner = ? AND device_id = ? AND verb = 'reopen' AND state IN ('taken', 'waiting') AND taken_at > ? AND json_extract(args, '$.item') = ? LIMIT 1").bind(owner, w.device_id, Date.now() - 180_000, w.key).first<{ id: string }>();
    if (busy) {
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
      await db.prepare("INSERT INTO engine_cmd(id, owner, device_id, verb, args, at) VALUES (?,?,?,?,?,?)").bind(id, owner, w.device_id, "send", JSON.stringify({ item: w.key, engine: w.engine, handle: null, fresh: true, title: w.title, text: line, ...(post ? { post: true } : {}), ...(card ? { card } : {}) }), Date.now()).run();
      return id;
    }
  }
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const args = { item: w.key, engine: w.engine, handle: json(w.handle, null), title: w.title, text: line, ...(post ? { post: true } : {}), ...(card ? { card } : {}) };
  await db.prepare("INSERT INTO engine_cmd(id, owner, device_id, verb, args, at) VALUES (?,?,?,?,?,?)").bind(id, owner, w.device_id, w.state === "parked" ? "reopen" : "send", JSON.stringify(args), Date.now()).run();
  return id;
}
