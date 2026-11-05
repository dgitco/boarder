type R = Record<string, unknown>;
export type Env = { DB: D1Database; ALLOW_EMAILS: string };
export type Hooks = { ownerValues: (env: Env) => Promise<Record<string, number> | null>; nodeKeys: readonly string[] };
export type Step = { kind: "device" | "grant" | "node_setting" | "face"; pk: string; from: unknown; to: unknown; skip?: string };
export type Out = { action: "plan" | "run" | "back"; dryRun: boolean; steps: Step[]; done: number; failed: { pk: string; error: string }[] };

const mails = (env: Env) => String(env.ALLOW_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const err = (e: unknown) => String((e as Error)?.message || e).slice(0, 200);
const j = (s: string | null | undefined) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };
const FACE = ["seed", "hue", "name", "photo", "icon", "fav"] as const;
const SAVE = "INSERT INTO mig_owner_prep(kind, pk, old, at) VALUES (?,?,?,?) ON CONFLICT(kind, pk) DO NOTHING";   // 처음 옛 값만

async function recs(db: D1Database, kind?: string) {
  return (await db.prepare(`SELECT kind, pk, old FROM mig_owner_prep${kind ? " WHERE kind = ?" : ""} ORDER BY kind, pk`).bind(...(kind ? [kind] : [])).all<{ kind: string; pk: string; old: string | null }>()).results || [];
}

/** run 이 할 일(쓰지 않음) — plan 과 run 이 같이 씀 */
async function todo(env: Env, h: Hooks): Promise<Step[]> {
  const db = env.DB, ms = mails(env), canon = ms[0]; if (!canon) throw new Error("ALLOW_EMAILS 없음(canon)");
  const done = new Set((await recs(db)).map(r => `${r.kind}|${r.pk}`)), out: Step[] = [], q = ms.map(() => "?").join(",");
  const devs = (await db.prepare(`SELECT id, owner, scope, revoked_at FROM device WHERE lower(owner) IN (${q}) AND scope != 'harness' ORDER BY created_at`).bind(...ms).all<{ id: string; owner: string; scope: string; revoked_at: number | null }>()).results || [];
  for (const d of devs) {
    const scope = !d.revoked_at && (d.scope === "watch" || d.scope === "ownercli") ? "full" : d.scope;
    if (scope !== d.scope || d.owner !== canon) out.push({ kind: "device", pk: d.id, from: { scope: d.scope, owner: d.owner }, to: { scope, owner: canon } });
  }
  const others = ms.slice(1);
  if (others.length) {
    const gs = (await db.prepare(`SELECT owner, k, (SELECT 1 FROM user_pref c WHERE c.owner = ? AND c.k = u.k) clash FROM user_pref u WHERE owner IN (${others.map(() => "?").join(",")}) AND k LIKE 'cli\\_settings:%' ESCAPE '\\'`).bind(canon, ...others).all<{ owner: string; k: string; clash: number | null }>()).results || [];
    for (const g of gs) out.push({ kind: "grant", pk: `${g.owner}|${g.k}`, from: { owner: g.owner }, to: { owner: canon }, ...(g.clash ? { skip: "canon 줄에 같은 허락이 이미 있음" } : {}) });
  }
  const ov = await h.ownerValues(env);
  if (done.has(`node_setting|${canon}`)) out.push({ kind: "node_setting", pk: canon, from: null, to: null, skip: "이미 옮김" });
  else if (ov) {
    const cur = j((await db.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(canon).first<{ data: string }>())?.data) as R | null;
    out.push({ kind: "node_setting", pk: canon, from: Object.fromEntries(h.nodeKeys.filter(k => cur && Object.hasOwn(cur, k)).map(k => [k, cur![k]])), to: Object.fromEntries(h.nodeKeys.filter(k => Object.hasOwn(ov, k)).map(k => [k, ov[k]])) });
  } else out.push({ kind: "node_setting", pk: canon, from: null, to: null, skip: "주인 노드 수치(owner_state)가 없음" });
  const bot = await db.prepare("SELECT seed, hue, name, photo, icon, fav FROM member_bot WHERE owner = '@owner'").first<R>();
  for (const pk of ["@me:" + canon, canon]) {
    if (done.has(`face|${pk}`)) { out.push({ kind: "face", pk, from: null, to: null, skip: "이미 옮김" }); continue; }
    if (!bot) { out.push({ kind: "face", pk, from: null, to: null, skip: "'@owner' 줄이 없음" }); continue; }
    const cur = await db.prepare("SELECT seed, hue, name, photo, icon, fav FROM member_bot WHERE owner = ?").bind(pk).first<R>();
    const to = pk === canon ? { ...bot } : { seed: bot.seed, hue: bot.hue, name: "", photo: bot.photo, icon: "", fav: "" };   // 내 얼굴 줄은 모양 · 색 · 사진만(setMyAvatar 와 같은 꼴)
    out.push({ kind: "face", pk, from: cur ?? null, to });
  }
  return out;
}

export async function plan(env: Env, h: Hooks): Promise<Out> { return { action: "plan", dryRun: true, steps: await todo(env, h), done: 0, failed: [] }; }

export async function run(env: Env, h: Hooks, dryRun: boolean): Promise<Out> {
  const db = env.DB, now = Date.now(), steps = await todo(env, h), out: Out = { action: "run", dryRun, steps, done: 0, failed: [] };
  if (dryRun) return out;
  for (const s of steps) {
    if (s.skip) continue;
    try {
      const f = s.from as R | null, t = s.to as R;
      let st: D1PreparedStatement[];
      if (s.kind === "device") st = [   // 읽은 값 그대로일 때만(CAS) — 그 사이 바뀌었으면 0줄 · 옛 값 줄도 안 씀
        db.prepare("UPDATE device SET scope = ?, owner = ? WHERE id = ? AND scope = ? AND owner = ?").bind(t.scope, t.owner, s.pk, f!.scope, f!.owner),
        db.prepare("INSERT INTO mig_owner_prep(kind, pk, old, at) SELECT ?,?,?,? WHERE changes() > 0 ON CONFLICT(kind, pk) DO NOTHING").bind("device", s.pk, JSON.stringify(f), now)];
      else if (s.kind === "grant") { const [o, k] = [String(f!.owner), s.pk.slice(String(f!.owner).length + 1)]; st = [
        db.prepare("UPDATE user_pref SET owner = ? WHERE owner = ? AND k = ? AND NOT EXISTS (SELECT 1 FROM user_pref c WHERE c.owner = ? AND c.k = ?)").bind(t.owner, o, k, t.owner, k),
        db.prepare("INSERT INTO mig_owner_prep(kind, pk, old, at) SELECT ?,?,?,? WHERE changes() > 0 ON CONFLICT(kind, pk) DO NOTHING").bind("grant", s.pk, JSON.stringify(f), now)]; }
      else if (s.kind === "node_setting") st = [
        db.prepare(SAVE).bind("node_setting", s.pk, JSON.stringify(f), now),
        db.prepare("INSERT INTO node_setting (owner, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET data = json_patch(CASE WHEN json_valid(data) AND json_type(data) = 'object' THEN data ELSE '{}' END, excluded.data), updated_at = excluded.updated_at").bind(s.pk, JSON.stringify(t), now)];
      else st = [
        db.prepare(SAVE).bind("face", s.pk, f ? JSON.stringify(f) : null, now),
        db.prepare(`INSERT INTO member_bot (owner, ${FACE.join(", ")}, updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET ${FACE.map(k => `${k} = excluded.${k}`).join(", ")}, updated_at = excluded.updated_at`).bind(s.pk, ...FACE.map(k => t[k] ?? ""), now)];
      await db.batch(st); out.done++;
    } catch (e) { out.failed.push({ pk: `${s.kind}:${s.pk}`, error: err(e) }); }
  }
  return out;
}

export async function back(env: Env, h: Hooks, dryRun: boolean): Promise<Out> {
  const db = env.DB, canon = mails(env)[0], now = Date.now(), rows = await recs(db), out: Out = { action: "back", dryRun, steps: [], done: 0, failed: [] };
  if (!canon) throw new Error("ALLOW_EMAILS 없음(canon)");
  for (const r of rows) {
    const old = j(r.old) as R | null, del = db.prepare("DELETE FROM mig_owner_prep WHERE kind = ? AND pk = ?").bind(r.kind, r.pk);
    out.steps.push({ kind: r.kind as Step["kind"], pk: r.pk, from: null, to: old });
    if (dryRun) continue;
    try {
      let st: D1PreparedStatement[];
      if (r.kind === "device") st = [db.prepare("UPDATE device SET scope = ?, owner = ? WHERE id = ?").bind(old!.scope, old!.owner, r.pk), del];
      else if (r.kind === "grant") { const o = String(old!.owner), k = r.pk.slice(o.length + 1); st = [db.prepare("UPDATE user_pref SET owner = ? WHERE owner = ? AND k = ?").bind(o, canon, k), del]; }
      else if (r.kind === "node_setting") {   // 노드 수치 칸만 옛 값으로(그 뒤 canon 줄에 쓴 prefs 같은 다른 칸은 그대로) — 없던 칸은 뺌
        const cur = (j((await db.prepare("SELECT data FROM node_setting WHERE owner = ?").bind(r.pk).first<{ data: string }>())?.data) || {}) as R;
        for (const k of h.nodeKeys) { if (old && Object.hasOwn(old, k)) cur[k] = old[k]; else delete cur[k]; }
        st = [db.prepare("UPDATE node_setting SET data = ?, updated_at = ? WHERE owner = ?").bind(JSON.stringify(cur), now, r.pk), del];
      } else st = [old ? db.prepare(`UPDATE member_bot SET ${FACE.map(k => `${k} = ?`).join(", ")}, updated_at = ? WHERE owner = ?`).bind(...FACE.map(k => old[k] ?? ""), now, r.pk)
        : db.prepare("DELETE FROM member_bot WHERE owner = ?").bind(r.pk), del];
      await db.batch(st); out.done++;
    } catch (e) { out.failed.push({ pk: `${r.kind}:${r.pk}`, error: err(e) }); }
  }
  return out;
}
