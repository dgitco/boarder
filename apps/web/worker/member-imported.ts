type Item = { key: string; device_id: string; engine: string; handle: string | null; title: string; state: string };
const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) as T : d; } catch { return d; } };
const COLS = "key, device_id, engine, handle, title, state";

export async function importedWindow(db: D1Database, owner: string, card: { wid: string | null; win: string }): Promise<Item | null> {
  const live = `owner = ? AND kind = 'window' AND gone_at IS NULL AND device_id != ''`;
  if (card.wid) {
    if (!/^ew_[a-z0-9]{3,40}$/i.test(card.wid)) return null;
    return db.prepare(`SELECT ${COLS} FROM imp_item WHERE ${live} AND substr(win, -?) = ? ORDER BY seen_at DESC LIMIT 1`).bind(owner, card.wid.length + 1, ":" + card.wid).first<Item>();
  }
  const tok = await db.prepare("SELECT pane FROM agent_token WHERE owner = ? AND win = ? ORDER BY created_at DESC LIMIT 1").bind(owner, card.win).first<{ pane: string }>();
  return db.prepare(`SELECT ${COLS} FROM imp_item WHERE ${live} AND win IN (?, ?) ORDER BY seen_at DESC LIMIT 1`).bind(owner, tok?.pane || card.win, card.win).first<Item>();
}

export async function queueToImported(db: D1Database, owner: string, w: Item, text: string, card?: string) {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const args = { item: w.key, engine: w.engine, handle: json(w.handle, null), title: w.title, text: text.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 2000), ...(card ? { card } : {}) };
  await db.prepare("INSERT INTO engine_cmd(id, owner, device_id, verb, args, at) VALUES (?,?,?,?,?,?)").bind(id, owner, w.device_id, w.state === "parked" ? "reopen" : "send", JSON.stringify(args), Date.now()).run();
  return id;
}
