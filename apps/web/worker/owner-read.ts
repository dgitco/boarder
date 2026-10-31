
export type Cfg = { dm_node_roots?: boolean; channels: Record<string, string>; rep?: string; owners?: Record<string, string>; board_files?: string[]; drafts?: Record<string, { text?: string; at?: number }>; node_topics?: Record<string, { ts?: string; ch?: string }[]> };
export type Route = { group: "chat" | "cards" | "art"; kind: "channel" | "thread" | "nodechat" | "frequent" | "inbox" | "artnotes"; a?: string; b?: string };
type R = Record<string, any>;
type Out = { status: number; body: unknown };

const REP = "U0000000000";
const BOARD_NAME = "Owner (보드)";
const CHANNELS = ["primary", "company", "personal", "dgit", "shop"];   // chat.CHANNELS
const FREQ_DEFAULT = ["white_check_mark", "eyes", "+1", "raised_hands", "pray", "heart", "tada", "fire", "joy", "thinking_face", "100", "bulb"];
const PAGE = 100;
const HUMAN_SUBTYPES = new Set([null, "bot_message", "file_share", "thread_broadcast", "tombstone"]);
const IN = "(SELECT value FROM json_each(?))";   // D1 은 묶는 값 100개 상한 — id 목록은 JSON 하나로

// ── Python 꼴 그대로 쓰는 작은 것들 ──
const WS = "[\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";   // Python str 공백(\s · strip · split)
const strip = (s: string) => s.replace(new RegExp(`^${WS}+|${WS}+$`, "g"), "");
const cp = (s: string) => Array.from(s);   // 글자 수는 코드 포인트(Python len · 자르기)
const cut = (s: string, n: number) => { const a = cp(s); return a.length <= n ? s : a.slice(0, n).join(""); };
const T = (v: unknown) => !(v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) ? !v.length : typeof v === "object" && !Object.keys(v as object).length));   // Python 참
const or = (...xs: unknown[]) => { for (const x of xs) if (T(x)) return x; return xs[xs.length - 1]; };
const pystr = (v: unknown) => v === true ? "True" : v === false ? "False" : v === null || v === undefined ? "None" : String(v);
const has = (o: R | undefined, k: string) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const loads = (v: unknown) => { try { return JSON.parse(String(v)); } catch { return null; } };
// f'{x:.6f}': toFixed 은 딱 반(…5)에서 큰 쪽, Python 은 짝수 쪽 — 이 크기(17억 초)에서 딱 반은 x·128 이 홀수 정수일 때뿐
function f6(x: number) {
  const s = x.toFixed(6), y = x * 128;
  return Number.isInteger(y) && Math.abs(y % 2) === 1 && /[13579]$/.test(s) ? s.slice(0, -1) + String(Number(s.slice(-1)) - 1) : s;
}
const SECRET = /(xox[abp]-[\p{L}\p{N}_-]+|gh[pousr]_[\p{L}\p{N}_]{20,}|sk-[\p{L}\p{N}_-]{20,}|AKIA[0-9A-Z]{16})/gu;
export function clean(s: unknown, n?: number) {   // snapshot.clean
  const t = String(s || "").replace(SECRET, "[가림]");
  if (n === undefined) return t;
  const a = cp(t); return a.length <= n ? t : a.slice(0, n - 1).join("") + "…";
}
const MRK: [RegExp, string][] = [[/<([^|>]+)\|([^>]+)>/g, "$2"], [/<(https?:\/\/[^>]+)>/g, "$1"], [/[*`]+/g, ""], [new RegExp(`${WS}+`, "g"), " "]];
export function plain(t: unknown, n = 180) {   // inbox.plain
  let s = String(t || "").replace(NODE_HEAD, ""); for (const [rx, rep] of MRK) s = s.replace(rx, rep);
  s = strip(s); const a = cp(s); return a.length <= n ? s : a.slice(0, n - 1).join("") + "…";
}
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif", svg: "image/svg+xml", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", ico: "image/vnd.microsoft.icon", avif: "image/avif", pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json", html: "text/html", htm: "text/html", xml: "application/xml", js: "text/javascript", css: "text/css", zip: "application/zip", tar: "application/x-tar", "7z": "application/x-7z-compressed", wav: "audio/x-wav", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", webm: "video/webm", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo", mkv: "video/matroska", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", hwp: "application/x-hwp", rtf: "application/rtf", yaml: "application/yaml", yml: "application/yaml", py: "text/x-python", sh: "application/x-sh", sql: "application/sql", eml: "message/rfc822" };
const guess = (n: unknown) => { const m = /\.([^./]+)$/.exec(String(n || "")); return m ? MIME[m[1]] || MIME[m[1].toLowerCase()] || "" : ""; };

// ── 길(server.py do_GET 과 같은 정규식) ──
export function route(path: string): Route | null {
  const p = path.split("?")[0];
  let m = /^\/api\/chat\/(\w+)(?:\/(\d{10}\.\d{6}))?(?:\?before=(\d{10}\.\d{6}))?$/.exec(path);
  if (m && CHANNELS.includes(m[1])) return m[2] ? { group: "chat", kind: "thread", a: m[1], b: m[2] } : { group: "chat", kind: "channel", a: m[1], b: m[3] };
  if ((m = /^\/api\/nodechat\?w=([^&]{1,400})$/.exec(path))) return { group: "chat", kind: "nodechat", a: m[1] };
  if (p === "/api/emoji/frequent") return { group: "chat", kind: "frequent" };
  if (p === "/api/inbox") return { group: "cards", kind: "inbox" };
  if ((m = /^\/api\/artnotes\/([A-Za-z0-9]{16,40})$/.exec(p))) return { group: "art", kind: "artnotes", a: m[1] };
  return null;
}

// ── talk_db.as_slack · chat.norm ──
const COLS = "m.id, m.thread, m.who, m.author, m.user, m.text, m.blocks, m.slack_ts, m.raw, m.edited_at, m.deleted_at, m.pane, m.ack";
const LIVE_ROOT = "(m.deleted_at IS NULL OR EXISTS (SELECT 1 FROM wl_talk_msg r WHERE r.thread=m.id AND r.deleted_at IS NULL))";
type Ex = { files: Map<string, R[]>; cnt: Map<string, { n: number; latest: number }>; names: Map<string, string[]>; rx: Map<string, [string, string][]> };

// 글 id 들의 첨부 · 답 수 · 답한 사람 · 반응을 한 batch 문장 넷으로(글마다 묻던 것 — 같은 줄 순서: 반응 at 같으면 이모지 · 사람 순, 이름은 같은 시각이면 이름 순)
function exStmts(db: D1Database, ids: string[]) {
  const j = JSON.stringify(ids);
  return [
    db.prepare(`SELECT msg, id, name, mime, size FROM wl_talk_file WHERE msg IN ${IN} AND path IS NOT NULL ORDER BY msg, rowid`).bind(j),
    db.prepare(`SELECT thread, count(*) AS n, max(at) AS latest FROM wl_talk_msg WHERE thread IN ${IN} AND deleted_at IS NULL GROUP BY thread`).bind(j),
    db.prepare(`SELECT thread, CASE WHEN who='owner' THEN 'Owner' ELSE coalesce(nullif(author, ''), '비서') END AS nm, max(at) AS mx FROM wl_talk_msg
      WHERE thread IN ${IN} AND deleted_at IS NULL AND who != 'system' GROUP BY thread, nm ORDER BY thread, mx DESC, nm`).bind(j),
    db.prepare(`SELECT msg, emoji, who FROM wl_talk_reaction WHERE msg IN ${IN} AND removed_at IS NULL ORDER BY msg, at, emoji, who`).bind(j),
  ];
}
function exOf(rs: D1Result<R>[]): Ex {
  const ex: Ex = { files: new Map(), cnt: new Map(), names: new Map(), rx: new Map() };
  for (const f of rs[0].results) { const a = ex.files.get(f.msg) || []; a.push(f); ex.files.set(f.msg, a); }
  for (const c of rs[1].results) ex.cnt.set(c.thread, { n: c.n, latest: c.latest });
  for (const c of rs[2].results) { const a = ex.names.get(c.thread) || []; if (a.length < 3) a.push(c.nm); ex.names.set(c.thread, a); }
  for (const x of rs[3].results) { const a = ex.rx.get(x.msg) || []; a.push([x.emoji, x.who]); ex.rx.set(x.msg, a); }
  return ex;
}

function asSlack(row: R, ex: Ex): R {
  const mid = row.id, who = row.who;
  let m = row.raw ? loads(row.raw) : null;
  if (!m || typeof m !== "object" || Array.isArray(m)) m = { user: who === "owner" ? REP : row.user, ...(who === "agent" ? { bot_id: or(row.user, "talk"), username: row.author } : {}) };
  m.ts = or(row.slack_ts, mid); m.text = row.text;
  if (T(row.edited_at)) m.edited = { ...((T(m.edited) ? m.edited : {}) as R), ts: f6(row.edited_at) };
  let blocks = row.blocks;
  if (T(row.deleted_at)) { Object.assign(m, { subtype: "tombstone", text: "이 글은 삭제됐어요", deleted: true }); delete m.blocks; delete m.files; blocks = null; }
  const bl = T(blocks) ? loads(blocks) : null;
  if (Array.isArray(bl)) m.blocks = bl; else delete m.blocks;
  if (T(row.thread)) m.thread_ts = row.thread;
  if (who === "owner" && T(row.ack)) m.ack = row.ack;
  if (who === "owner" && T(row.pane)) m.dlv_pane = row.pane;
  if (!T(m.files)) {
    const fs = ex.files.get(mid);
    if (fs && fs.length) m.files = fs.map(f => ({ id: f.id, name: f.name, title: f.name, mimetype: or(f.mime, guess(f.name), ""), size: or(f.size, 0) }));
  }
  const c = ex.cnt.get(mid);
  if (c && c.n) { Object.assign(m, { thread_ts: m.ts, reply_count: c.n, latest_reply: f6(c.latest) }); m.reply_names = ex.names.get(mid) || []; }
  else for (const k of ["reply_count", "latest_reply", "reply_users", "reply_users_count", "reply_names"]) delete m[k];
  const rs = new Map<string, string[]>();
  for (const [e, w] of ex.rx.get(mid) || []) { const a = rs.get(e) || []; a.push(w === "owner" ? REP : w); rs.set(e, a); }
  if (rs.size) m.reactions = [...rs].map(([e, us]) => ({ name: e, users: us, count: us.length })); else delete m.reactions;
  return m;
}

function buttonsOf(blocks: unknown) {
  const out: R[] = [];
  for (const b of (Array.isArray(blocks) ? blocks : []) as R[]) {
    if (b?.type !== "actions") continue;
    for (const e of (b.elements || []) as R[]) {
      if (e?.type !== "button") continue;
      let v = loads(or(e.value, "{}")); if (!v || typeof v !== "object" || Array.isArray(v)) v = {};
      if (v.k === "otherc" || v.k === "other") out.push({ label: "기타", other: true });
      else if (v.k === "later") continue;
      else out.push({ label: cut(pystr(or(v.l, (has(e, "text") ? e.text : {})?.text ?? "")), 500) });
    }
  }
  return out;
}
function textOf(m: R) {
  const parts: string[] = [];
  for (const b of (Array.isArray(m.blocks) ? m.blocks : []) as R[]) {
    let t = b?.type === "section" ? (T(b.text) ? b.text : {}).text : null;
    if (b?.type === "context") t = ((b.elements || []) as R[]).filter(e => e && typeof e === "object" && !Array.isArray(e)).map(e => has(e, "text") ? e.text : "").join(" ");
    if (T(t)) parts.push(t);
  }
  return clean(parts.length ? parts.join("\n\n") : (has(m, "text") ? m.text : ""));
}
const seenByPeople = (m: R) => HUMAN_SUBTYPES.has(has(m, "subtype") ? m.subtype : null) && !!(strip(String(or(m.text, ""))) || T(m.files) || T(m.blocks));

const NODE_HEAD = /^\*\[(?:보던 )?노드 [^\]\n]{1,80}\]\*\s*/;
function norm(m: R, rep: string, bf: Set<string>) {
  const fs = ((has(m, "files") ? m.files : []) || []).filter((f: R) => T(f?.id));
  const board = m.username === BOARD_NAME || (fs.length > 0 && fs.every((f: R) => bf.has(f.id)));
  const who = (m.user === rep && !T(m.bot_id)) || board ? "owner" : "agent";
  const name = who === "owner" ? "Owner" : or(m.username, (T(m.bot_profile) ? m.bot_profile : {}).name, "비서");
  const files = fs.map((f: R) => ({ id: f.id, name: or(f.title, f.name, "파일"), mime: or(f.mimetype, ""), size: or(f.size, 0), img: String(or(f.mimetype, "")).startsWith("image/") && f.mimetype !== "image/svg+xml" }));
  const gone = m.subtype === "tombstone";
  return {
    ts: m.ts, thread: m.thread_ts ?? null, who, name, board, text: gone ? "이 글은 삭제됐어요" : who === "owner" ? textOf(m).replace(NODE_HEAD, "") : textOf(m), buttons: gone ? [] : buttonsOf(m.blocks), files: gone ? [] : files.slice(0, 10),
    replies: has(m, "reply_count") ? m.reply_count : 0, latest: m.latest_reply ?? null, rnames: ((T(m.reply_names) ? m.reply_names : []) as string[]).slice(0, 3),
    ...(gone ? { deleted: true } : {}), ...(T((T(m.edited) ? m.edited : {}).ts) && !gone ? { edited: true } : {}),
    ...(who === "owner" && !gone ? { src: String(or(m.text, "")).replace(NODE_HEAD, "") } : {}),
    ...(who === "owner" && !gone && T(m.dlv_pane) ? { dlv: { pane: m.dlv_pane } } : {}),
    ...(who === "owner" && !gone && T(m.ack) ? { ack: m.ack } : {}),
    reactions: ((has(m, "reactions") ? m.reactions : []) as R[]).map(r => ({ name: r.name, count: has(r, "count") ? r.count : 0, mine: ((has(r, "users") ? r.users : []) as string[]).includes(rep) })),
  } as R;
}

// ── 고른 단추(chat.mark_picks · db_picks · db_marks) ──
const PICK = new RegExp(`^${WS}*고름:${WS}*\\*?([\\s\\S]+?)\\*?${WS}*$`);
function markPicks(msgs: R[], picked: Map<string, string[]>) {
  msgs.forEach((m, i) => {
    const labels = new Set(((m.buttons || []) as R[]).filter(b => !T(b.other)).map(b => b.label));
    if (!labels.size || T(m.deleted)) return;
    const got = (picked.get(m.ts) || []).filter(lb => labels.has(lb));
    for (const x of msgs.slice(i + 1)) {
      const g = x.who === "owner" && !T(x.ledger) ? PICK.exec(String(or(x.text, ""))) : null;
      if (g && labels.has(strip(g[1]))) got.push(strip(g[1]));
    }
    if (got.length) m.picked = got[got.length - 1];
  });
}
const pyCmp = (a: [number, string], b: [number, string]) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

function marksStmts(db: D1Database, roots: R[]) {   // db_marks 묻기 셋(답 있는 뿌리 · 단추 카드)
  const ids = roots.filter(m => T(m.replies) && !T(m.ledger)).map(m => m.ts), cards = roots.filter(m => T(m.buttons) && !T(m.deleted)).map(m => m.ts);
  return [
    db.prepare(`SELECT r.thread AS th, r.who AS who,
      EXISTS (SELECT 1 FROM wl_talk_reaction x WHERE x.msg = r.id AND x.who = 'owner' AND x.removed_at IS NULL) AS rx,
      EXISTS (SELECT 1 FROM wl_talk_seen s WHERE s.who = 'owner' AND s.thread = r.thread AND s.at >= r.at) AS seen
      FROM wl_talk_msg r WHERE r.thread IN ${IN} AND r.deleted_at IS NULL AND r.who != 'system'
      AND r.at = (SELECT max(y.at) FROM wl_talk_msg y WHERE y.thread = r.thread AND y.deleted_at IS NULL AND y.who != 'system') ORDER BY r.thread, r.at, r.rowid`).bind(JSON.stringify(ids)),
    db.prepare(`SELECT msg, at, label FROM wl_talk_pick WHERE who = 'owner' AND msg IN ${IN}`).bind(JSON.stringify(cards)),
    db.prepare(`SELECT thread, at, text FROM wl_talk_msg WHERE thread IN ${IN} AND who = 'owner' AND deleted_at IS NULL AND text LIKE '고름:%'`).bind(JSON.stringify(cards)),
  ];
}
function marksApply(roots: R[], rs: D1Result<R>[]) {
  const last = new Map<string, [string, boolean]>();
  for (const r of rs[0].results) last.set(r.th, [r.who, !!r.rx || !!r.seen]);
  for (const m of roots) { const w = last.get(m.ts); if (w && w[0] !== "owner" && !w[1]) m.unread = true; }
  if (!roots.some(m => T(m.buttons) && !T(m.deleted))) return;
  const got = new Map<string, [number, string][]>();
  for (const p of rs[1].results) { const a = got.get(p.msg) || []; a.push([p.at, p.label]); got.set(p.msg, a); }
  for (const t of rs[2].results) { const g = PICK.exec(t.text); if (g) { const a = got.get(t.thread) || []; a.push([t.at, strip(g[1])]); got.set(t.thread, a); } }
  for (const m of roots) {
    const labels = new Set(((m.buttons || []) as R[]).filter(b => !T(b.other)).map(b => b.label));
    const hit = [...(got.get(m.ts) || [])].sort(pyCmp).map(x => x[1]).filter(lb => labels.has(lb));
    if (hit.length) m.picked = hit[hit.length - 1];
  }
}

const CARD_SHOWN: Record<string, string> = { answered: "답 받음 — 처리 중", done: "닫힘", closed: "닫힘", failed: "못 함" };
const cardsStmt = (db: D1Database, ids: string[]) => db.prepare(`SELECT ts, kind, state, note FROM wl_cards WHERE ts IN ${IN} AND kind != 'blocker'`).bind(JSON.stringify(ids));
function cleanNote(t: unknown) {   // chat.clean_note
  let s = String(t ?? "").split(/\s+/).filter(Boolean).join(" ");
  s = s.replace(/^(?:Owner 처리함|처리함)\s*[:—-]?\s*/, "");
  return [...s].length <= 140 ? s : [...s].slice(0, 139).join("").trimEnd() + "…";
}
function cardMarks(msgs: R[], rows: R[]) {
  const got = new Map(rows.map(r => [r.ts, r]));
  for (const m of msgs) {
    const c = T(m.ledger) ? null : got.get(m.ts);
    if (c && c.state !== "replaced") m.card = { kind: c.kind, state: c.state, ...(c.state !== "open" ? { shown: CARD_SHOWN[c.state] ?? c.state, how: cleanNote(c.note) } : {}) };
  }
}

// ── 채널 · 스레드(chat.Chat.channel · thread, 대화 DB 원천) ──
async function channel(db: D1Database, cfg: Cfg, key: string, before: string | undefined, now: number): Promise<Out> {
  const rep = cfg.rep || REP, bf = new Set(cfg.board_files || []), own = cfg.owners || {};
  const q = `SELECT ${COLS} FROM wl_talk_msg m WHERE chan=(SELECT id FROM wl_talk_chan WHERE slack_channel = ?) AND thread IS NULL AND ${LIVE_ROOT}` +
    (before ? " AND m.at < (SELECT at FROM wl_talk_msg WHERE id = ? OR slack_ts = ? LIMIT 1)" : "") + " ORDER BY at DESC LIMIT ?";
  const rows = (await db.prepare(q).bind(cfg.channels[key], ...(before ? [before, before] : []), PAGE + 1).all<R>()).results;
  const page = rows.slice(0, PAGE), more = rows.length > PAGE;
  const ids = page.map(r => r.id);
  // 두 번째 왕복: 꾸밈 넷 + 표시(db_marks) 셋 — 표시는 뿌리 꼴(답 수 · 단추)이 있어야 해서 꾸밈 결과로 먼저 꼴을 만든 뒤 묻지 않고, 뿌리 전부로 물어 둠
  const pre = page.map(r => ({ ts: r.slack_ts || r.id, replies: 1, buttons: r.deleted_at ? [] : buttonsOf(T(r.blocks) ? loads(r.blocks) : null), deleted: !!r.deleted_at }));
  const rs = await db.batch<R>([...exStmts(db, ids), ...marksStmts(db, pre), cardsStmt(db, pre.map(m => m.ts)),
    db.prepare(`SELECT ts, node FROM wl_card_home WHERE node IS NOT NULL AND node != '' AND ts IN ${IN}`).bind(JSON.stringify(pre.map(m => m.ts)))]);   // 노드 일 카드 뿌리(server.node_card_roots)
  const ex = exOf(rs.slice(0, 4));
  const msgs = page.map(r => asSlack(r, ex));
  const out: R[] = [...msgs].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts)).filter(seenByPeople)
    .map(m => ({ ...norm(m, rep, bf), owner: has(own, m.ts) ? own[m.ts] : null }));
  // db_marks: 읽지 않음은 답 있는 뿌리만(물은 것은 모든 뿌리라 여기서 거름), 단추 카드는 꼴이 같으니 그대로
  const withReplies = new Set(out.filter(m => T(m.replies) && !T(m.ledger)).map(m => m.ts));
  const rs0 = { ...rs[4], results: rs[4].results.filter(r => withReplies.has(r.th)) } as D1Result<R>;
  marksApply(out, [rs0, rs[5], rs[6]]);
  cardMarks(out, rs[7].results);
  const nodeTs = new Set(Object.values(cfg.node_topics || {}).flatMap(xs => Array.isArray(xs) ? xs.map(x => x?.ts) : []).filter(Boolean));
  for (const r of rs[8].results) if (!isChannelWindow(String(r.node))) nodeTs.add(r.ts);
  const shown = cfg.dm_node_roots ? out : out.filter(m => !nodeTs.has(m.ts));
  await Promise.all([dlvNames(db, shown), fwdMarks(db, cfg, shown), splitMarks(db, shown)]);   // 서로 다른 칸만 채움 — 차례로 기다리면 태평양 왕복만 늚
  return { status: 200, body: { channel: key, messages: shown, more, cursor: msgs.length ? msgs[msgs.length - 1].ts : null, read_at: Math.floor(now), stale_min: 0 } };
}

async function dlvNames(db: D1Database, out: R[]) {
  const ps = [...new Set(out.map(m => m.dlv?.pane).filter(T))] as string[];
  if (!ps.length) return;
  const rows = (await db.prepare(`SELECT pane, win, max(at) AS at FROM wl_log WHERE pane IN ${IN} AND win NOT LIKE '#%' AND win != '' GROUP BY pane, win`).bind(JSON.stringify(ps)).all<R>()).results;
  const nm = new Map<string, [string, number]>();
  for (const r of rows) { const t = titleOf(r.win); if (t && (!nm.has(r.pane) || r.at > nm.get(r.pane)![1])) nm.set(r.pane, [t, r.at]); }
  for (const m of out) { const t = m.dlv?.pane && nm.get(m.dlv.pane); if (t) m.dlv = { ...m.dlv, to: t[0] }; }
}

function ledgerMsg(at: number, msg: string) {   // chat.ledger_msg
  const tag = msg.startsWith("버튼:") ? "버튼" : "음성 받아쓰기", text = tag === "버튼" ? strip(msg.slice(3)) : msg;
  return { ts: f6(Number(at)), thread: null, who: "owner", name: "Owner", board: false, tag, text: clean(text, 3000), buttons: [], files: [], replies: 0, latest: null, reactions: [], ledger: true } as R;
}
const repliesStmt = (db: D1Database, ts: string) => db.prepare(`SELECT ${COLS} FROM wl_talk_msg m WHERE ((m.id=? AND ${LIVE_ROOT}) OR (m.thread=? AND m.deleted_at IS NULL)) ORDER BY (m.thread IS NOT NULL), m.at`).bind(ts, ts);
const ownerStmt = (db: D1Database, ts: string) => db.prepare("SELECT at, msg FROM wl_log WHERE pane = 'owner' AND ref = ? ORDER BY id").bind(ts);

async function threads(db: D1Database, cfg: Cfg, list: { key: string; ts: string }[]) {
  const rep = cfg.rep || REP, bf = new Set(cfg.board_files || []), own = cfg.owners || {};
  if (!list.length) return [];
  const r1 = await db.batch<R>(list.flatMap(x => [repliesStmt(db, x.ts), ownerStmt(db, x.ts)]));
  const rowsOf = list.map((_, i) => r1[2 * i].results), ledOf = list.map((_, i) => r1[2 * i + 1].results);
  const all = rowsOf.flat(), ids = [...new Set(all.map(r => r.id))];
  const btn = all.filter(r => !r.deleted_at && buttonsOf(T(r.blocks) ? loads(r.blocks) : null).length).map(r => r.slack_ts || r.id);
  const r2 = await db.batch<R>([...exStmts(db, ids), db.prepare(`SELECT msg, label FROM wl_talk_pick WHERE who='owner' AND msg IN ${IN} ORDER BY at`).bind(JSON.stringify(btn)),
    cardsStmt(db, [...new Set(all.map(r => r.slack_ts || r.id))])]);
  const ex = exOf(r2.slice(0, 4));
  const res = list.map((x, i) => {
    const msgs = rowsOf[i].map(r => asSlack(r, ex));
    const out = msgs.map(m => norm(m, rep, bf));
    const said = out.map(m => m.text).join(" ").replace(/\*/g, "");
    for (const { at, msg } of ledOf[i] as { at: number; msg: string }[]) {
      const lb = strip(msg.slice(3));
      if ((msg.includes("[음성]") || msg.startsWith("버튼:")) && !(msg.startsWith("버튼:") && (said.includes(`선택: ${lb}`) || said.includes(`고름: ${lb}`)))) out.push(ledgerMsg(at, msg));
    }
    out.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
    const want = new Set(out.filter(m => T(m.buttons)).map(m => m.ts)), picked = new Map<string, string[]>();
    for (const p of r2[4].results) if (want.has(p.msg)) { const a = picked.get(p.msg) || []; a.push(p.label); picked.set(p.msg, a); }
    markPicks(out, picked);
    cardMarks(out, r2[5].results);
    return { channel: x.key, root: x.ts, owner: has(own, x.ts) ? own[x.ts] : null, messages: out, raw: msgs };
  });
  await dlvNames(db, res.flatMap(t => t.messages));
  return res;
}

async function nodeHome(db: D1Database, cfg: Cfg, ts: string): Promise<string> {
  if (cfg.dm_node_roots) return "";
  const r = await db.prepare("SELECT node FROM wl_card_home WHERE ts = ? AND node IS NOT NULL AND node != '' LIMIT 1").bind(ts).first<R>();
  if (r && !isChannelWindow(String(r.node))) return titleOf(r.node);
  const pane = Object.entries(cfg.node_topics || {}).find(([, xs]) => Array.isArray(xs) && xs.some(x => x?.ts === ts))?.[0];
  if (!pane) return "";
  const w = await db.prepare("SELECT win FROM wl_log WHERE pane = ? AND win NOT LIKE '#%' AND win != '' ORDER BY id DESC LIMIT 1").bind(pane).first<R>();
  const t = w ? titleOf(w.win) : "";
  return t && !isChannelWindow(t) ? t : "";
}

const TITLE_NUM = new RegExp(`^\\p{Nd}+${WS}+`, "u");
const titleOf = (w: unknown) => strip(String(or(w, "")).replace(TITLE_NUM, ""));
const LEAD = /(^|\s)(총괄|primary|리드)$|^총괄|^Primary/i;
const isChannelWindow = (t: string) => !t || t.startsWith("#") || LEAD.test(t) || /^[a-z0-9-]+$/.test(t);
const TSX = /^\d{10}\.\d{6}$/;
type Idx = { by_node: Map<string, { ts: string; ch: string | null; last: number }[]> };
let nidx: { at: number; tag: string; v: Idx } | null = null;
let cfgTag = "";

async function nodeIndex(db: D1Database, cfg: Cfg, now: number, cache: boolean): Promise<Idx> {
  const tag = cfgTag;
  if (cache && nidx && nidx.tag === tag && Date.now() / 1000 - nidx.at < 60) return nidx.v;
  const since = now - 21 * 86400;
  const rs = await db.batch<R>([
    db.prepare("SELECT pane, win, max(at) AS at FROM wl_log WHERE pane LIKE '%%' AND win NOT LIKE '#%' AND win != '' GROUP BY pane, win ORDER BY pane, win"),
    db.prepare("SELECT win, ref, at FROM wl_log WHERE ref IS NOT NULL AND ref != '' AND pane LIKE '%%' AND at > ? ORDER BY id").bind(since),
    db.prepare("SELECT thread, pane, max(at) AS at FROM wl_talk_msg WHERE thread IS NOT NULL AND thread != '' AND pane LIKE '%%' AND at > ? GROUP BY thread, pane ORDER BY thread, pane").bind(since),
    db.prepare("SELECT c.ts AS ts, c.thread AS thread, c.channel AS channel, (SELECT l.win FROM wl_log l WHERE l.id = substr(c.ref, 3)) AS win, EXISTS (SELECT 1 FROM wl_log l WHERE l.id = substr(c.ref, 3)) AS hit FROM wl_cards c WHERE c.ref LIKE 'w:%' ORDER BY c.rowid"),
    db.prepare("SELECT ts, chan, node FROM wl_card_home WHERE at > ? ORDER BY rowid").bind(since),
  ]);
  const paneWin = new Map<string, [string, number]>();
  for (const r of rs[0].results) { const t = titleOf(r.win); if (t && (!paneWin.has(r.pane) || r.at > paneWin.get(r.pane)![1])) paneWin.set(r.pane, [t, r.at]); }
  const idx = new Map<string, { ch: string | null; nodes: Map<string, Set<string>>; at: number }>();
  const add = (ts: unknown, title: string, how: string, ch: string | null = null, at: number | null = null) => {
    if (!TSX.test(String(ts ?? "")) || !title || isChannelWindow(title)) return;   // TS.fullmatch(str(ts or '')) — 숫자 꼴만
    const k = String(ts); let x = idx.get(k);
    if (!x) idx.set(k, x = { ch: ch || null, nodes: new Map(), at: parseFloat(k) });   // ch 가 없으면 아래에서 chan_of → 'primary'
    if (!x.nodes.has(title)) x.nodes.set(title, new Set()); x.nodes.get(title)!.add(how);
    if (T(at)) x.at = Math.max(x.at, at!);
  };
  for (const r of rs[1].results) {
    const m = /^(?:(primary|company|personal|dgit|shop|shopco):)?(\d{10}\.\d{6})$/.exec(strip(String(r.ref)));
    if (m) add(m[2], titleOf(r.win), "ref", m[1] === "shopco" ? "shop" : m[1] || null, r.at);
  }
  for (const r of rs[2].results) { const t = paneWin.get(r.pane); if (t) add(r.thread, t[0], "reply", null, r.at); }
  for (const [ts, pane] of Object.entries(cfg.owners || {})) { const t = paneWin.get(pane); if (t) add(ts, t[0], "route"); }
  for (const [pane, xs] of Object.entries(cfg.node_topics || {})) { const t = paneWin.get(pane); for (const x of t ? xs : []) add(x?.ts, t![0], "node", x?.ch || null); }
  for (const r of rs[3].results) if (r.hit) add(TSX.test(String(r.thread ?? "")) ? r.thread : r.ts, titleOf(r.win), "card", CHANNELS.includes(r.channel) ? r.channel : null);
  for (const r of rs[4].results) {
    const ch = CHANNELS.includes(r.chan) ? r.chan : null;
    add(r.ts, String(r.node || ""), "card", ch);
    const x = idx.get(String(r.ts)); if (x && ch) x.ch = ch;
  }
  const byNode = new Map<string, { ts: string; ch: string | null; last: number }[]>();
  for (const [ts, x] of idx) for (const title of x.nodes.keys()) { const a = byNode.get(title) || []; a.push({ ts, ch: x.ch, last: Math.trunc(x.at) }); byNode.set(title, a); }
  const v = { by_node: byNode };
  if (cache) nidx = { at: Date.now() / 1000, tag, v };
  return v;
}

function pyUnquote(s: string) {   // urllib.parse.unquote(UTF-8, 깨진 것은 U+FFFD) — '+' 는 그대로
  const bytes: number[] = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === "%" && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 3; }
    else { const c = s.codePointAt(i)!; for (const b of new TextEncoder().encode(String.fromCodePoint(c))) bytes.push(b); i += c > 0xffff ? 2 : 1; }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}

const STATES: Record<string, string> = { "시작": "진행 중", "진행": "진행 중", "막힘": "막힘", "결정": "내 차례", "끝": "끝" };
async function fwdMarks(db: D1Database, cfg: Cfg, out: R[]) {
  const ts = out.map(m => m.ts).filter(T);
  if (!ts.length) return;
  const boxes = (await db.prepare(`SELECT id, slack_ts, ref, at FROM wl_talk_msg WHERE source = 'node-move' AND ref IS NOT NULL AND (id IN ${IN} OR slack_ts IN ${IN})`)
    .bind(JSON.stringify(ts), JSON.stringify(ts)).all<R>()).results;
  if (!boxes.length) return;
  const refs = [...new Set(boxes.map(b => String(b.ref)))];
  const [orig, home] = await db.batch<R>([
    db.prepare(`SELECT ${COLS}, m.chan, m.at FROM wl_talk_msg m WHERE m.id IN ${IN}`).bind(JSON.stringify(refs)),
    db.prepare(`SELECT ts, node, pane FROM wl_card_home WHERE ts IN ${IN}`).bind(JSON.stringify(refs))]);
  const ex = exOf(await db.batch<R>(exStmts(db, refs)));
  const og = new Map(orig.results.map(r => [String(r.id), r])), hm = new Map(home.results.map(r => [String(r.ts), r]));
  const nodes = [...new Set(boxes.map(b => hm.get(String(b.ref))?.node).filter(T).map(String))];
  const st = await nodeStates(db, nodes);
  for (const m of out) {
    const b = boxes.find(x => x.id === m.ts || x.slack_ts === m.ts), o = b && og.get(String(b.ref)), h = b && hm.get(String(b.ref));
    if (!b || !o || !h || !T(h.node)) continue;   // 되돌렸거나(unmove) 원글이 없음 — 상자는 그냥 글로
    const n = norm(asSlack(o, ex), cfg.rep || REP, new Set(cfg.board_files || []));
    const node = String(h.node);
    m.fwd = { node, pane: String(h.pane || ""), chan: String(o.chan), ts: String(o.id), reply: T(o.thread) && o.thread !== o.id, who: n.who, name: n.name,
      text: String(o.text || "").replace(NODE_HEAD, ""), at: Number(o.at), moved: Number(b.at), state: st.get(node) || "", files: n.files || [] };
  }
}
async function nodeStates(db: D1Database, nodes: string[]) {
  if (!nodes.length) return new Map<string, string>();
  const rs = await db.batch<R>(nodes.map(n => db.prepare(`SELECT kind, win FROM wl_log WHERE win = ? OR win LIKE ? ORDER BY id DESC LIMIT 50`).bind(n, "% " + n)));
  return new Map(nodes.map((n, i) => {
    const nre = new RegExp("^(?:\\d+ )?" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), k = rs[i].results.find(r => nre.test(String(r.win || "")));
    return [n, k ? STATES[String(k.kind)] || "" : ""] as const;
  }));
}
async function splitMarks(db: D1Database, msgs: R[]) {
  const ts = msgs.map(m => m.ts).filter(T);
  if (!ts.length) return;
  const rows = (await db.prepare(`SELECT s.id, s.ref, s.at, h.node, h.pane FROM wl_talk_msg s LEFT JOIN wl_card_home h ON h.ts = s.id
    WHERE s.source = 'node-split' AND s.deleted_at IS NULL AND (s.ref IN ${IN} OR s.id IN ${IN})`).bind(JSON.stringify(ts), JSON.stringify(ts)).all<R>()).results;
  if (!rows.length) return;
  const byRef = new Map<string, R[]>(), byPost = new Map<string, string>(), st = await nodeStates(db, [...new Set(rows.map(r => String(r.node || "")).filter(Boolean))]);
  for (const r of rows) {
    const node = String(r.node || "");
    const a = byRef.get(String(r.ref)) || []; a.push({ node, pane: String(r.pane || ""), post: String(r.id), at: Number(r.at), state: st.get(node) || "" }); byRef.set(String(r.ref), a);
    byPost.set(String(r.id), String(r.ref));
  }
  const refs = [...new Set(byPost.values())];
  const og = new Map((await db.prepare(`SELECT id, chan, who, author FROM wl_talk_msg WHERE id IN ${IN}`).bind(JSON.stringify(refs)).all<R>()).results.map(o => [String(o.id), o]));
  for (const m of msgs) {
    const sp = byRef.get(m.ts); if (sp) m.splits = [...sp].sort((a, b) => a.at - b.at);
    const ref = byPost.get(m.ts), o = ref && og.get(ref);
    if (ref && o) m.split_from = { chan: String(o.chan), ts: ref, at: (byRef.get(ref) || []).find(x => x.post === m.ts)?.at ?? 0, who: o.who, name: String(o.author || (o.who === "owner" ? "Owner" : "")) };
  }
}
async function movedMarks(db: D1Database, msgs: R[]) {
  const ts = msgs.map(m => m.ts).filter(T);
  if (!ts.length) return;
  const got = new Map((await db.prepare(`SELECT ref, chan, at FROM wl_talk_msg WHERE source = 'node-move' AND deleted_at IS NULL AND ref IN ${IN}`).bind(JSON.stringify(ts)).all<R>()).results
    .map(r => [String(r.ref), r]));
  for (const m of msgs) { const g = got.get(m.ts); if (g) m.moved = { chan: String(g.chan), at: Number(g.at) }; }
}

async function nodechat(db: D1Database, cfg: Cfg, raw: string, now: number, cache: boolean): Promise<Out> {
  const w = pyUnquote(raw).replace(/[\x00-\x1f\x7f]/g, " ");
  const t = titleOf(cut(strip(w).split(new RegExp(`${WS}+`)).filter(Boolean).join(" "), 80));
  if (!t) return { status: 400, body: { error: "노드 이름" } };
  const v = await nodeIndex(db, cfg, now, cache), lim = now - 14 * 86400;
  let xs = (v.by_node.get(t) || []).filter(x => x.last > lim);
  if (xs.length) {
    const sp = new Set((await db.prepare(`SELECT DISTINCT ref FROM wl_talk_msg WHERE source = 'node-split' AND deleted_at IS NULL AND ref IN ${IN}`).bind(JSON.stringify(xs.map(x => x.ts))).all<R>()).results.map(r => String(r.ref)));
    if (sp.size) xs = xs.filter(x => !sp.has(x.ts));
  }
  xs = [...xs].sort((a, b) => b.last - a.last).slice(0, 20).sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
  // 아직 채널을 못 정한 스레드: chan_of(slack_ts → chan, 뿌리 줄만) → 없으면 primary
  const need = xs.filter(x => !x.ch).map(x => x.ts);
  const co = new Map<string, string>();
  if (need.length) for (const r of (await db.prepare(`SELECT slack_ts, chan FROM wl_talk_msg WHERE slack_ts IN ${IN} AND (thread IS NULL OR thread = '' OR thread = slack_ts)`).bind(JSON.stringify(need)).all<R>()).results) co.set(r.slack_ts, r.chan);
  const list = xs.map(x => ({ key: x.ch || co.get(x.ts) || "primary", ts: x.ts })).filter(x => has(cfg.channels, x.key));   // 모르는 채널 = be.channel KeyError → 건너뜀
  const ths = await threads(db, cfg, list);
  const msgs: R[] = [];
  for (const [i, x] of list.entries()) {
    const ms = ths[i].messages as R[];
    let root: R | null | undefined = ms.find(m => m.ts === x.ts);
    if (!root) {   // chat.root: 같은 replies 의 첫 글
      const raw = ths[i].raw as R[];
      root = raw.length ? { ...norm(raw[0], cfg.rep || REP, new Set(cfg.board_files || [])), owner: has(cfg.owners, x.ts) ? cfg.owners![x.ts] : null, replies: raw.length - 1, latest: raw[raw.length - 1].ts } : null;
    }
    if (root) {
      const reps = ms.filter(m => m.ts !== x.ts);
      msgs.push({ ...root, ch: x.key, thread: null, replies: reps.length, latest: reps.length ? reps[reps.length - 1].ts : null, rnames: [...new Set(reps.filter(r => T(r.name)).map(r => r.name))].slice(-3) });
    }
  }
  msgs.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
  if (msgs.length) marksApply(msgs, await db.batch<R>(marksStmts(db, msgs)));
  await movedMarks(db, msgs);
  await splitMarks(db, msgs);
  return { status: 200, body: { channel: "n:" + t, messages: msgs.slice(-300), stale_min: 0, more: false } };
}

const DKEYS = "dk(key) AS (SELECT value FROM json_each(?1) UNION SELECT substr(k, 8) FROM owner_state WHERE ?2 AND k > 'drafts:' AND k < 'drafts;')";
// cardThread 가 갈 수 있는 곳: 씨앗(키 끝 「|」 뒤) · w 숫자면 w: 일지 · ref 로 하나만 맞는 카드 · replaced_by / dup_of 를 8단까지. 일지 글의 「스레드 」 뒤 ts 후보 전부
const CARD_SQL = `WITH RECURSIVE ${DKEYS},
  item(item) AS (SELECT replace(r, rtrim(r, replace(r, '|', '')), '') FROM (SELECT substr(key, 6) r FROM dk WHERE substr(key, 1, 5) = 'card:' AND substr(key, -1) != '|')),
  hit(item, ts) AS (SELECT i.item, max(c.ts) FROM item i JOIN wl_cards c ON c.ref LIKE '%:' || i.item WHERE i.item != '' GROUP BY i.item HAVING count(*) = 1),
  node(ts, d) AS (SELECT item, 0 FROM item UNION SELECT 'w:' || substr(item, 2), 0 FROM item WHERE substr(item, 1, 1) = 'w' UNION SELECT ts, 0 FROM hit
    UNION SELECT c.replaced_by, n.d + 1 FROM node n JOIN wl_cards c ON c.ts = n.ts WHERE n.d < 8 AND c.replaced_by != ''
    UNION SELECT c.dup_of, n.d + 1 FROM node n JOIN wl_cards c ON c.ts = n.ts WHERE n.d < 8 AND c.dup_of != ''),
  nts(ts) AS (SELECT DISTINCT ts FROM node WHERE ts != ''),
  card AS (SELECT c.ts, c.thread, c.replaced_by, c.dup_of FROM nts JOIN wl_cards c ON c.ts = nts.ts),
  lg(ts, msg) AS (SELECT nts.ts, l.msg FROM nts JOIN wl_log l ON l.id = substr(nts.ts, 3) WHERE substr(nts.ts, 1, 2) = 'w:'),
  occ(rest) AS (SELECT msg FROM lg UNION ALL SELECT substr(rest, instr(rest, '스레드 ') + 4) FROM occ WHERE instr(rest, '스레드 ') > 0),
  m1(id) AS (SELECT ts FROM nts UNION SELECT thread FROM card UNION SELECT substr(rest, 1, instr(rest, '.') + 6) FROM occ UNION SELECT substr(key, 4) FROM dk WHERE substr(key, 1, 3) = 'th:'),
  mid(id) AS (SELECT id FROM m1 UNION SELECT t.thread FROM m1 JOIN wl_talk_msg t ON t.id = m1.id)
  SELECT 'c' AS k, ts AS a, thread AS b, replaced_by AS c, dup_of AS d FROM card
  UNION ALL SELECT 'h', item, ts, NULL, NULL FROM hit
  UNION ALL SELECT 'l', ts, msg, NULL, NULL FROM lg
  UNION ALL SELECT 'm', t.id, t.chan, t.thread, t.text FROM mid JOIN wl_talk_msg t ON t.id = mid.id`;
type Pre = { msg: Map<string, R>; card: Map<string, R>; hit: Map<string, string>; log: Map<string, string> };
function preOf(rows: R[]): Pre {
  const p: Pre = { msg: new Map(), card: new Map(), hit: new Map(), log: new Map() };
  for (const r of rows) {
    if (r.k === "c") p.card.set(r.a, { thread: r.b, replaced_by: r.c, dup_of: r.d });
    else if (r.k === "h") p.hit.set(r.a, r.b);
    else if (r.k === "l") p.log.set(r.a, r.b);
    else p.msg.set(r.a, { chan: r.b, thread: r.c, text: r.d });
  }
  return p;
}
function cardThread(p: Pre, item: string): R | null {
  const at = (ts: string) => { const r = p.msg.get(ts); return r && T(r.chan) ? { chan: r.chan, thread: or(r.thread, ts) } : null; };
  const todo: string[] = [...(/^w\p{Nd}+$/u.test(item) ? ["w:" + item.slice(1)] : []), item], seen = new Set<string>();
  while (todo.length && seen.size < 8) {
    const ts = todo.shift()!;
    if (!ts || seen.has(ts)) continue;
    seen.add(ts);
    let m: R | null;
    if (/^\p{Nd}{10}\.\p{Nd}{6}\n?$/u.test(ts) && (m = at(ts))) return m;
    const r = p.card.get(ts);
    if (!r) {
      if (ts === item && p.hit.has(item)) todo.push(p.hit.get(item)!);   // ref 로 맞는 카드가 하나뿐일 때만
      continue;
    }
    if (T(r.thread) && (m = at(r.thread))) return m;
    todo.push(...[r.replaced_by, r.dup_of].filter(T));
    if (ts.startsWith("w:") && p.log.has(ts)) {
      const th = /스레드 (\p{Nd}+\.\p{Nd}{6})/u.exec(String(or(p.log.get(ts), "")));
      if (th && (m = at(th[1]))) return m;
    }
  }
  return null;
}

// state = 초안 정본이 D1 owner_state(스위치 write_state) — 「올렸음」 줄이 없거나 못 풀면 cfg 초안(server.py 파일)
async function inbox(db: D1Database, cfg: Cfg, now: number, state = false): Promise<Out> {
  const lim = 200, ulim = 1000, cutAt = now - 3 * 86400;   // 읽지 않음 상한 = inbox.UNREAD_LIMIT(목록 = 뱃지 = 사이드바 수)
  const rs = await db.batch<R>([
    db.prepare(`SELECT r.chan AS chan, r.thread AS th, r.id AS mid, r.who AS who, r.author AS author, r.pane AS pane, r.text AS text, r.at AS at,
      (SELECT t.text FROM wl_talk_msg t WHERE t.id = r.thread) AS root,
      (SELECT count(*) FROM wl_talk_msg y WHERE y.thread = r.thread AND y.deleted_at IS NULL AND y.who = 'agent' AND y.at > max(
          coalesce((SELECT max(b.at) FROM wl_talk_msg b WHERE b.thread = r.thread AND b.who = 'owner' AND b.deleted_at IS NULL), 0),
          coalesce((SELECT max(s.at) FROM wl_talk_seen s WHERE s.who = 'owner' AND s.thread = r.thread), 0),
          coalesce((SELECT max(x.at) FROM wl_talk_reaction x JOIN wl_talk_msg z ON z.id = x.msg WHERE (z.thread = r.thread OR z.id = r.thread) AND x.who = 'owner' AND x.removed_at IS NULL), 0))) AS n,
      EXISTS (SELECT 1 FROM wl_talk_msg b WHERE (b.thread = r.thread OR b.id = r.thread) AND b.who = 'owner' AND b.deleted_at IS NULL) AS mine
      FROM wl_talk_msg r WHERE r.thread IS NOT NULL AND r.deleted_at IS NULL AND r.who NOT IN ('system', 'owner')
      AND r.at = (SELECT max(y.at) FROM wl_talk_msg y WHERE y.thread = r.thread AND y.deleted_at IS NULL AND y.who != 'system')
      AND NOT EXISTS (SELECT 1 FROM wl_talk_reaction x WHERE x.msg = r.id AND x.who = 'owner' AND x.removed_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM wl_talk_seen s WHERE s.who = 'owner' AND s.thread = r.thread AND s.at >= r.at)
      ORDER BY r.at DESC LIMIT ?`).bind(ulim),
    db.prepare(`SELECT m.chan AS chan, m.id AS mid, m.who AS who, m.author AS author, m.pane AS pane, m.text AS text, m.at AS at FROM wl_talk_msg m
      WHERE m.thread IS NULL AND m.deleted_at IS NULL AND m.who NOT IN ('system', 'owner') AND m.at > ?
      AND NOT EXISTS (SELECT 1 FROM wl_talk_msg r WHERE r.thread = m.id AND r.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM wl_talk_reaction x WHERE x.msg = m.id AND x.who = 'owner' AND x.removed_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM wl_talk_seen s WHERE s.who = 'owner' AND s.chan = m.chan AND s.thread IN ('', m.id) AND s.at >= m.at)
      ORDER BY m.at DESC LIMIT ?`).bind(cutAt, ulim),
    db.prepare(`SELECT s.msg AS msg, s.chan AS chan, s.thread AS th, s.at AS sat, m.who AS who, m.author AS author, m.pane AS pane, m.text AS text, m.at AS at,
      m.deleted_at AS gone, (SELECT t.text FROM wl_talk_msg t WHERE t.id = s.thread) AS root
      FROM wl_talk_saved s LEFT JOIN wl_talk_msg m ON m.id = s.msg WHERE s.who = 'owner' ORDER BY s.at DESC LIMIT ?`).bind(lim),
    db.prepare("SELECT DISTINCT msg FROM wl_talk_saved WHERE who = 'owner'"),
    db.prepare(CARD_SQL).bind(JSON.stringify(Object.keys(cfg.drafts || {})), state ? 1 : 0),
    ...(state ? [db.prepare("SELECT at, ver FROM owner_state WHERE k = 'drafts'"), db.prepare("SELECT k, v FROM owner_state WHERE k > 'drafts:' AND k < 'drafts;' ORDER BY ord, k")] : []),
  ]);
  const unread: R[] = [], ths = new Set<string>();
  for (const r of rs[0].results) {
    if (ths.has(r.th)) continue;
    ths.add(r.th);
    unread.push({ kind: "thread", mine: !!r.mine, chan: r.chan, thread: r.th, ts: r.mid, who: r.who, author: or(r.author, ""), pane: or(r.pane, ""), text: plain(r.text), root: plain(r.root, 80), at: r.at, n: Math.max(1, or(r.n, 0) as number) });
  }
  for (const r of rs[1].results) unread.push({ kind: "post", mine: false, chan: r.chan, thread: "", ts: r.mid, who: r.who, author: or(r.author, ""), pane: or(r.pane, ""), text: plain(r.text), root: "", at: r.at, n: 1 });
  unread.sort((a, b) => b.at - a.at);
  const saved = rs[2].results.map(r => ({ chan: r.chan, thread: or(r.th, ""), ts: r.msg, who: or(r.who, ""), author: or(r.author, ""), pane: or(r.pane, ""),
    text: T(r.gone) || r.who === null ? "지운 글" : plain(r.text), root: T(r.th) ? plain(r.root, 80) : "", at: or(r.at, r.sat), saved_at: r.sat }));
  const savedIds = rs[3].results.map(r => r.msg as string);
  const pre = preOf(rs[4].results);
  let d = cfg.drafts || {};
  if (state && rs[5].results.length) { try { d = Object.fromEntries(rs[6].results.map(r => [String(r.k).slice(7), JSON.parse(r.v)])); } catch { /* 못 풀면 cfg 초안(OS.get 실패와 같음) */ } }
  const drafts: R[] = [];
  for (const [key, v] of Object.entries(d)) {
    const text = String(or((T(v) ? v : {}).text, ""));
    if (!strip(text)) continue;
    const i = key.indexOf(":"), kind = i < 0 ? key : key.slice(0, i), rest = i < 0 ? "" : key.slice(i + 1);
    const it: R = { key, text: plain(text, 240), at: Number(or(v.at, 0)) / 1000, chan: "", thread: "", card: "", place: "" };
    if (kind === "chan") Object.assign(it, { chan: rest, place: "" });
    else if (kind === "th") { const r = pre.msg.get(rest); Object.assign(it, { thread: rest, chan: r ? r.chan : "", place: r ? plain(r.text, 80) : "" }); }
    else if (kind === "card") {
      if (rest.endsWith("|")) continue;
      Object.assign(it, { card: rest, place: "" });
      const g = cardThread(pre, rest.split("|").pop()!);
      if (g) {
        it.goto = g;
        if (!it.place) { const r = pre.msg.get(g.thread); it.place = r ? plain(r.text, 80) : ""; }
      }
    } else continue;
    drafts.push(it);
  }
  drafts.sort((a, b) => b.at - a.at);
  return { status: 200, body: { unread: unread.slice(0, ulim), drafts, saved, saved_ids: savedIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) } };
}

// ── 나머지 작은 길 ──
async function frequent(db: D1Database): Promise<Out> {   // chat.frequent
  const got = (await db.prepare("SELECT emoji, count(*) c FROM wl_talk_reaction WHERE who = 'owner' GROUP BY emoji ORDER BY c DESC, max(at) DESC LIMIT ?").bind(18).all<R>()).results.map(r => r.emoji as string);
  return { status: 200, body: { names: [...got, ...FREQ_DEFAULT.filter(e => !got.includes(e))].slice(0, 18) } };
}
async function artnotes(db: D1Database, art: string): Promise<Out> {   // artnotes.notes
  const r = await db.prepare("SELECT id, target, page, who, text, at FROM wl_art_note WHERE art = ? AND deleted_at IS NULL ORDER BY at, id").bind(art).all<R>();
  return { status: 200, body: { notes: r.results.map(x => ({ id: x.id, target: x.target, page: x.page, who: x.who, text: x.text, at: x.at })) } };
}

// 답 하나 만들기. cfg 가 필요한 길(채팅 · 노드 · 모아 보기)인데 없으면 null(→ 다리로)
export async function build(db: D1Database, cfg: Cfg | null, rt: Route, now = Date.now() / 1000, cache = true, state = false): Promise<Out | null> {
  if (rt.kind === "frequent") return frequent(db);
  if (rt.kind === "artnotes") return artnotes(db, rt.a!);
  if (!cfg || !cfg.channels) return null;
  if (rt.kind === "inbox") return inbox(db, cfg, now, state);
  if (!has(cfg.channels, rt.a || "") && rt.kind !== "nodechat") return null;
  if (rt.kind === "channel") return channel(db, cfg, rt.a!, rt.b, now);
  if (rt.kind === "thread") { const [t] = await threads(db, cfg, [{ key: rt.a!, ts: rt.b! }]); const { raw: _r, ...body } = t; void _r;
    const home = await nodeHome(db, cfg, rt.b!);   // 집이 노드 채널인 글(J1) — 화면이 가운데를 그 노드로(server.node_home)
    return { status: 200, body: home ? { ...body, home } : body }; }
  return nodechat(db, cfg, rt.a!, now, cache);
}

// cfg 스냅숏(릴레이 칸 cfg): 바뀐 때(etag)만 다시 풂
let cfgMemo: { etag: string; v: Cfg } | null = null;
export async function cfgOf(get: () => Promise<{ body: string; etag: string } | null>) {
  const s = await get(); if (!s) return null;
  cfgTag = s.etag.split(":")[0];
  if (cfgMemo?.etag !== s.etag) { try { cfgMemo = { etag: s.etag, v: JSON.parse(s.body) }; } catch { return null; } }
  return cfgMemo.v;
}

async function etagOf(b: string) { return '"' + [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(b)))].slice(0, 8).map(x => x.toString(16).padStart(2, "0")).join("") + '"'; }

// 화면에 보낼 답(보드 _send 와 같은 머리: ETag · 같으면 빈 304 · no-store). 못 만들면 null(→ 다리로)
// state = 모아 보기 초안을 D1 owner_state 에서(write_state) — 같은 batch 에서 읽음
export async function respond(db: D1Database, get: () => Promise<{ body: string; etag: string } | null>, rt: Route, inm?: string, state = false) {
  let o: Out | null;
  try { o = await build(db, await cfgOf(get), rt, undefined, true, state); } catch { return null; }
  if (!o) return null;
  const b = JSON.stringify(o.body), h: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-f7": "d1" };
  if (o.status === 200) { h.etag = await etagOf(b); if (inm && inm === h.etag) return new Response(null, { status: 304, headers: { etag: h.etag, "cache-control": "no-store", "x-f7": "d1" } }); }
  return new Response(b, { status: o.status, headers: h });
}

// ── 그림자 대조: 다리 답(정본)과 D1 답이 같은지 — 다르면 첫 다른 키 경로 · 길이만(글 내용은 안 실음) ──
const VOLATILE: Record<string, string[]> = { channel: ["read_at"] };   // 부를 때마다 바뀌는 칸
export function firstDiff(a: unknown, b: unknown, path = ""): string | null {
  if (a === b) return null;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9 ? null : path || "$";
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = firstDiff(a[i], b[i], `${path}.${i}`); if (d) return d; }
    return a.length === b.length ? null : `${path}.length`;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ks = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of ks) { const d = firstDiff((a as R)[k], (b as R)[k], `${path}.${k}`); if (d) return d; }
    return null;
  }
  return path || "$";
}
export async function shadow(db: D1Database, get: () => Promise<{ body: string; etag: string } | null>, rt: Route, bridged: { status: number; headers: Record<string, string>; body: Uint8Array }) {
  if (bridged.status !== 200) return null;
  let raw = bridged.body;
  if (bridged.headers["content-encoding"] === "gzip") raw = new Uint8Array(await new Response(new Response(raw as unknown as BodyInit).body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const py = JSON.parse(new TextDecoder().decode(raw));
  const t0 = Date.now(), o = await build(db, await cfgOf(get), rt), ms = Date.now() - t0;   // ms = D1 답 만드는 시간(cfg DO + D1 왕복) — 다리(0.3–0.5초)와 견줌
  if (!o) return { diff: "cfg 없음", n_bridge: raw.length, n_d1: 0, ms };
  for (const k of VOLATILE[rt.kind] || []) { delete py?.[k]; delete (o.body as R)?.[k]; }
  const d = o.status !== 200 ? "status" : firstDiff(py, o.body);
  return d ? { diff: d, n_bridge: raw.length, n_d1: JSON.stringify(o.body).length, ms } : { diff: null, n_bridge: raw.length, n_d1: 0, ms };
}
