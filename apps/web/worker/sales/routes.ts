import type { Context, Hono } from "hono";
import { check, diff, csv, todayKst, FIELDS, STAGES, type Card, type Stage, type Source } from "./rules";

type Env = { DB: D1Database };
type C = Context<{ Bindings: Env }>;
type Who = (c: C) => Promise<string | null>;   // 로그인한 사람 메일(소문자) — 회원 · 주인 둘 다
type Known = (c: C, email: string) => Promise<boolean>;   // 보더에 들어올 수 있는 메일(초대 · 주인) — 팀원은 그 안에서만
type Row = { id: string; team: string; firm: string; stage: string; assignee: string; source: string; last_at: string | null; last_note: string; next: string; due: string | null; links: string; hold_until: string | null; lost_reason: string; ver: number; created_by: string; created_at: number; updated_by: string; updated_at: number };

const TEAMS_MAX = 5, CARDS_MAX = 2000, MEMBERS_MAX = 20;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}$/;
const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) as T : d; } catch { return d; } };
const cardOf = (r: Row): Card => ({ firm: r.firm, stage: r.stage as Stage, assignee: r.assignee, source: r.source as Source, last_at: r.last_at, last_note: r.last_note, next: r.next, due: r.due, links: json<string[]>(r.links, []), hold_until: r.hold_until, lost_reason: r.lost_reason });
const view = (r: Row) => ({ id: r.id, ...cardOf(r), ver: r.ver, created_by: r.created_by, created_at: r.created_at, updated_by: r.updated_by, updated_at: r.updated_at });
const newId = (p: string) => p + [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
const sameSite = (c: C) => c.req.header("x-hb") === "1" && ["same-origin", "none", undefined].includes(c.req.header("sec-fetch-site"));
const body = (c: C) => c.req.json<Record<string, unknown>>().then(b => b && typeof b === "object" && !Array.isArray(b) ? b : null, () => null);

export function mountSales(host: Hono<any>, who: Who, known: Known) {
  const app = host as unknown as Hono<{ Bindings: Env }>;
  const me = async (c: C, write = false) => {
    if (write && !sameSite(c)) return { err: c.json({ ok: false, error: "forbidden" }, 403) };
    const e = await who(c); if (!e) return { err: c.json({ ok: false, error: "로그인" }, 401) };
    return { e };
  };
  // 팀원만 — 팀원이 아니면 있는 팀인지도 알려 주지 않음(404)
  const team = async (c: C, write = false) => {
    const m = await me(c, write); if (m.err) return m;
    const id = c.req.param("team") || "";
    const rs = await c.env.DB.prepare("SELECT t.id, t.name, m.role FROM sales_team t JOIN sales_member m ON m.team = t.id WHERE t.id = ? AND m.email = ?").bind(id, m.e).first<{ id: string; name: string; role: string }>();
    if (!rs) return { err: c.json({ ok: false, error: "없는 팀이에요" }, 404) };
    const ms = await c.env.DB.prepare("SELECT m.email, m.role, COALESCE(u.name, '') name FROM sales_member m LEFT JOIN \"user\" u ON lower(u.email) = m.email WHERE m.team = ? ORDER BY m.at").bind(id).all<{ email: string; role: string; name: string }>();   // 이름 = 보더 계정 이름(화면에 담당으로)
    return { e: m.e, t: rs, members: ms.results };
  };

  app.get("/api/sales/teams", async c => {
    const m = await me(c); if (m.err) return m.err;
    const r = await c.env.DB.prepare("SELECT t.id, t.name, m.role FROM sales_team t JOIN sales_member m ON m.team = t.id WHERE m.email = ? ORDER BY t.created_at").bind(m.e).all();
    return c.json({ ok: true, teams: r.results });
  });
  // 팀 만들기 — 만든 사람이 관리자(팀원 더하기는 관리자만, 다음 층)
  app.post("/api/sales/teams", async c => {
    const m = await me(c, true); if (m.err) return m.err;
    const b = await body(c); if (!b) return c.json({ ok: false, error: "bad json" }, 400);
    const name = String(b.name ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim().slice(0, 40);
    if (!name) return c.json({ ok: false, error: "팀 이름을 넣어 주세요" }, 400);
    const n = await c.env.DB.prepare("SELECT COUNT(*) n FROM sales_member WHERE email = ? AND role = 'admin'").bind(m.e).first<{ n: number }>();
    if ((n?.n || 0) >= TEAMS_MAX) return c.json({ ok: false, error: `팀은 ${TEAMS_MAX}개까지 만들 수 있어요` }, 400);
    const id = newId("st_"), now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO sales_team(id, name, created_by, created_at) VALUES (?,?,?,?)").bind(id, name, m.e, now),
      c.env.DB.prepare("INSERT INTO sales_member(team, email, role, added_by, at) VALUES (?,?,?,?,?)").bind(id, m.e, "admin", m.e, now),
    ]);
    return c.json({ ok: true, team: { id, name, role: "admin" } });
  });

  app.get("/api/sales/teams/:team/cards", async c => {
    const t = await team(c); if (t.err) return t.err;
    const r = await c.env.DB.prepare("SELECT * FROM sales_card WHERE team = ? ORDER BY due IS NULL, due, updated_at DESC LIMIT ?").bind(t.t.id, CARDS_MAX).all<Row>();
    return c.json({ ok: true, team: t.t, members: t.members, cards: r.results.map(view) });
  });
  app.post("/api/sales/teams/:team/cards", async c => {
    const t = await team(c, true); if (t.err) return t.err;
    const b = await body(c); if (!b) return c.json({ ok: false, error: "bad json" }, 400);
    const n = await c.env.DB.prepare("SELECT COUNT(*) n FROM sales_card WHERE team = ?").bind(t.t.id).first<{ n: number }>();
    if ((n?.n || 0) >= CARDS_MAX) return c.json({ ok: false, error: `카드는 팀마다 ${CARDS_MAX}장까지예요` }, 400);
    const k = check(null, { assignee: t.e, ...b }, t.members.map(x => x.email)); if (!k.ok) return c.json({ ok: false, error: k.error }, 400);
    const id = newId("sc_"), now = Date.now(), x = k.card;
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO sales_card(id, team, firm, stage, assignee, source, last_at, last_note, next, due, links, hold_until, lost_reason, ver, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)")
        .bind(id, t.t.id, x.firm, x.stage, x.assignee, x.source, x.last_at, x.last_note, x.next, x.due, JSON.stringify(x.links), x.hold_until, x.lost_reason, t.e, now, t.e, now),
      c.env.DB.prepare("INSERT INTO sales_event(team, card, who, kind, data, at) VALUES (?,?,?,?,?,?)").bind(t.t.id, id, t.e, "create", JSON.stringify(diff(null, x)), now),
    ]);
    return c.json({ ok: true, card: view({ id, team: t.t.id, ...x, links: JSON.stringify(x.links), ver: 1, created_by: t.e, created_at: now, updated_by: t.e, updated_at: now }) });
  });
  // 고치기 · 옮기기 — ver = 화면이 본 판. 그 사이 다른 사람이 고쳤으면 409(덮어쓰지 않음)
  app.patch("/api/sales/teams/:team/cards/:id", async c => {
    const t = await team(c, true); if (t.err) return t.err;
    const b = await body(c); if (!b) return c.json({ ok: false, error: "bad json" }, 400);
    const ver = Number(b.ver); if (!Number.isInteger(ver) || ver < 1) return c.json({ ok: false, error: "판(ver)이 필요해요" }, 400);
    const row = await c.env.DB.prepare("SELECT * FROM sales_card WHERE id = ? AND team = ?").bind(c.req.param("id"), t.t.id).first<Row>();
    if (!row) return c.json({ ok: false, error: "없는 카드예요" }, 404);
    if (row.ver !== ver) return c.json({ ok: false, error: "다른 사람이 먼저 고쳤어요 — 새로 불러온 뒤 다시 해 주세요", card: view(row) }, 409);
    const input = Object.fromEntries(FIELDS.filter(f => Object.prototype.hasOwnProperty.call(b, f)).map(f => [f, b[f]]));
    const prev = cardOf(row), k = check(prev, input, t.members.map(x => x.email)); if (!k.ok) return c.json({ ok: false, error: k.error }, 400);
    const d = diff(prev, k.card); if (!Object.keys(d).length) return c.json({ ok: true, card: view(row) });
    const now = Date.now(), x = k.card;
    const [u] = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE sales_card SET firm = ?, stage = ?, assignee = ?, source = ?, last_at = ?, last_note = ?, next = ?, due = ?, links = ?, hold_until = ?, lost_reason = ?, ver = ver + 1, updated_by = ?, updated_at = ? WHERE id = ? AND team = ? AND ver = ?")
        .bind(x.firm, x.stage, x.assignee, x.source, x.last_at, x.last_note, x.next, x.due, JSON.stringify(x.links), x.hold_until, x.lost_reason, t.e, now, row.id, t.t.id, ver),
      // 기록은 위 UPDATE 가 실제로 바꿨을 때만(같은 판으로 둘이 동시에 보내면 하나만 남음)
      c.env.DB.prepare("INSERT INTO sales_event(team, card, who, kind, data, at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0").bind(t.t.id, row.id, t.e, d.stage ? "move" : "edit", JSON.stringify(d), now),
    ]);
    if (!u.meta.changes) return c.json({ ok: false, error: "다른 사람이 먼저 고쳤어요 — 새로 불러온 뒤 다시 해 주세요" }, 409);
    return c.json({ ok: true, card: view({ ...row, ...x, links: JSON.stringify(x.links), ver: ver + 1, updated_by: t.e, updated_at: now }) });
  });
  // 팀원 더하기 · 빼기 — 관리자만. 더할 사람은 이미 보더 회원(초대된 메일)이어야 함(초대는 보더 초대 길 그대로)
  app.post("/api/sales/teams/:team/members", async c => {
    const t = await team(c, true); if (t.err) return t.err;
    if (t.t.role !== "admin") return c.json({ ok: false, error: "관리자만 팀원을 더할 수 있어요" }, 403);
    const b = await body(c); if (!b) return c.json({ ok: false, error: "bad json" }, 400);
    const email = String(b.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email)) return c.json({ ok: false, error: "메일 주소가 올바르지 않아요" }, 400);
    if (t.members.some(m => m.email === email)) return c.json({ ok: true, already: true });
    if (t.members.length >= MEMBERS_MAX) return c.json({ ok: false, error: `팀원은 ${MEMBERS_MAX}명까지예요` }, 400);
    if (!(await known(c, email))) return c.json({ ok: false, error: "보더에 초대된 사람만 더할 수 있어요" }, 400);
    await c.env.DB.prepare("INSERT OR IGNORE INTO sales_member(team, email, role, added_by, at) VALUES (?,?,?,?,?)").bind(t.t.id, email, "member", t.e, Date.now()).run();
    return c.json({ ok: true });
  });
  app.delete("/api/sales/teams/:team/members/:email", async c => {
    const t = await team(c, true); if (t.err) return t.err;
    const email = (c.req.param("email") || "").toLowerCase();   // Hono 가 이미 풀어 줌
    if (t.t.role !== "admin" && email !== t.e) return c.json({ ok: false, error: "관리자만 팀원을 뺄 수 있어요" }, 403);   // 나가기는 누구나
    const m = t.members.find(x => x.email === email); if (!m) return c.json({ ok: false, error: "팀원이 아니에요" }, 404);
    if (m.role === "admin" && t.members.filter(x => x.role === "admin").length <= 1) return c.json({ ok: false, error: "마지막 관리자는 뺄 수 없어요" }, 400);
    // 그 사람이 담당인 카드는 뺀 관리자에게(스스로 나가면 첫 관리자에게) 넘기고 기록 줄도 남김 — 담당 없는 카드가 생기지 않게
    const to = m.email === t.e ? t.members.find(x => x.role === "admin" && x.email !== email)?.email || t.e : t.e, now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO sales_event(team, card, who, kind, data, at) SELECT team, id, ?, 'edit', json_object('assignee', json_array(assignee, ?)), ? FROM sales_card WHERE team = ? AND assignee = ?").bind(t.e, to, now, t.t.id, email),
      c.env.DB.prepare("UPDATE sales_card SET assignee = ?, ver = ver + 1, updated_by = ?, updated_at = ? WHERE team = ? AND assignee = ?").bind(to, t.e, now, t.t.id, email),
      c.env.DB.prepare("DELETE FROM sales_member WHERE team = ? AND email = ?").bind(t.t.id, email),
    ]);
    return c.json({ ok: true });
  });
  // CSV 내보내기 — 팀원 누구나(보드 전체 한 파일)
  app.get("/api/sales/teams/:team/export.csv", async c => {
    const t = await team(c); if (t.err) return t.err;
    const r = await c.env.DB.prepare("SELECT * FROM sales_card WHERE team = ? LIMIT ?").bind(t.t.id, CARDS_MAX).all<Row>();
    const name = (e: string) => t.members.find(m => m.email === e)?.name || e;
    const rows = r.results.map(cardOf).sort((x, y) => STAGES.indexOf(x.stage) - STAGES.indexOf(y.stage) || (x.due || "9").localeCompare(y.due || "9"));
    return new Response(csv(rows, name), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="sales-${todayKst()}.csv"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  });
  app.get("/api/sales/teams/:team/cards/:id/events", async c => {
    const t = await team(c); if (t.err) return t.err;
    const r = await c.env.DB.prepare("SELECT who, kind, data, at FROM sales_event WHERE team = ? AND card = ? ORDER BY at DESC, id DESC LIMIT 200").bind(t.t.id, c.req.param("id")).all<{ who: string; kind: string; data: string; at: number }>();
    return c.json({ ok: true, events: r.results.map(e => ({ ...e, data: json(e.data, {}) })) });
  });
}
