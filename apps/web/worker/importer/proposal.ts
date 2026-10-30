import { PRESETS, TITLES } from "../connectors/presets";

type Env = { DB: D1Database; [k: string]: unknown };
export type ConnIn = { name: string; from: string; transport: "http" | "sse" | "stdio"; url?: string; command?: string; secrets?: boolean };
export type RoleIn = { name: string; from: string; description?: string; model?: string; tools?: string; path?: string };
export type Payload = { connectors: (ConnIn & { service: string; title: string })[]; roles: RoleIn[] };
export const PROPOSAL_CHOICES = ["이대로 옮기기", "역할만", "안 옮기기"];
export const IMPORT_WIN = "보더 들여오기";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
const host = (u: string) => { try { return new URL(u).host; } catch { return ""; } };
const tokenish = (g: string) => /sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-/.test(g) || (/^[A-Za-z0-9_-]{20,}$/.test(g) && /\d/.test(g) && /[A-Za-z]/.test(g));
export const cleanUrl = (u?: string) => { if (!u) return ""; try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return ""; x.username = ""; x.password = ""; x.search = ""; x.hash = ""; x.pathname = x.pathname.split("/").map(g => tokenish(g) ? "_" : g).join("/"); return x.toString(); } catch { return ""; } };
/** 알려진 서비스면 그 이름(github · linear …) — 주소 host 가 같거나 이름이 같을 때 */
export function serviceOf(c: { name: string; url?: string }): string {
  const h = host(c.url || "");
  for (const [k, v] of Object.entries(PRESETS)) if (h && host(v) === h) return k;
  const n = slug(c.name);
  return PRESETS[n] ? n : n || "mcp";
}

async function hash(s: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join(""); }
const cardId = () => `${Math.floor(Date.now() / 1000)}.${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`;

/** 목록이 지난 카드와 같으면 다시 묻지 않음. 새 목록이면 열린 옛 카드는 닫고 새로 */
export async function proposalFrom(env: Env, owner: string, device: string, conns: ConnIn[], roles: RoleIn[]): Promise<string | null> {
  const seen = new Set<string>();
  const cs = conns.filter(c => c.name && !/^(boarder|bridge|0bridge)$/i.test(c.name)).map(c => ({ ...c, url: cleanUrl(c.url), service: serviceOf(c), title: "" }))
    .filter(c => { const k = `${c.service}|${c.url || c.command}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(c => ({ ...c, title: TITLES[c.service] || c.name }));
  const rs = roles.filter(r => r.name).filter((r, i, a) => a.findIndex(x => x.name.toLowerCase() === r.name.toLowerCase()) === i);
  if (!cs.length && !rs.length) return null;
  const payload: Payload = { connectors: cs, roles: rs };
  const h = await hash(JSON.stringify([cs.map(c => [c.service, c.url, c.transport]).sort(), rs.map(r => [r.name, r.description || ""]).sort()]));
  const last = await env.DB.prepare("SELECT card_id, hash, state FROM imp_proposal WHERE owner = ? ORDER BY at DESC LIMIT 1").bind(owner).first<{ card_id: string; hash: string; state: string }>();
  if (last && last.hash === h) return last.state === "open" ? last.card_id : null;
  if (last?.state === "open") await env.DB.batch([
    env.DB.prepare("UPDATE board_card SET state = 'closed', done = '새 목록으로 바뀜' WHERE id = ? AND owner = ? AND state = 'open'").bind(last.card_id, owner),
    env.DB.prepare("UPDATE imp_proposal SET state = 'skipped', result = '새 목록' WHERE card_id = ?").bind(last.card_id),
  ]);
  const remote = cs.filter(c => c.transport !== "stdio"), local = cs.filter(c => c.transport === "stdio");
  const q = `쓰던 ${[cs.length ? `커넥터 ${cs.length}개` : "", rs.length ? `역할 ${rs.length}개` : ""].filter(Boolean).join(" · ")}를 보더로 옮길까요?`;
  const body = [
    remote.length ? `커넥터 — 연결하기로 옮겨요: ${remote.map(c => c.title).join(" · ")}` : "",
    local.length ? `이 기기에서만 도는 것(그대로 둠): ${local.map(c => c.name).join(" · ")}` : "",
    rs.length ? `역할 — 역할 표로: ${rs.map(r => r.name).join(" · ")}` : "",
    `읽은 곳: ${device}`,
  ].filter(Boolean).join("\n");
  const id = cardId(), now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO board_card(id, owner, win, question, choices, recommend, body, at) VALUES (?,?,?,?,?,?,?,?)").bind(id, owner, IMPORT_WIN, q, JSON.stringify(PROPOSAL_CHOICES), "A", body, now),
    env.DB.prepare("INSERT INTO imp_proposal(card_id, owner, hash, payload, at) VALUES (?,?,?,?,?)").bind(id, owner, h, JSON.stringify(payload), now),
  ]);
  return id;
}

/** 답하면 적용: 역할 → 역할 표, 커넥터 → 「연결하기」 블록(연결은 사람이 그 카드에서 — OAuth 는 사람 손) */
export async function applyProposal(env: Env, owner: string, cardId: string, p: Payload, answer: string) {
  const now = Date.now();
  if (answer === PROPOSAL_CHOICES[2]) {
    await env.DB.batch([
      env.DB.prepare("UPDATE imp_proposal SET state = 'skipped', result = ? WHERE card_id = ?").bind("안 옮김", cardId),
      env.DB.prepare("UPDATE board_card SET state = 'closed', done = '안 옮김' WHERE id = ? AND owner = ?").bind(cardId, owner),
    ]);
    return;
  }
  const roles = p.roles || [], conns = answer === PROPOSAL_CHOICES[0] ? (p.connectors || []) : [];
  // id: 영문이면 그 이름, 한글 등은 이름 해시(같은 이름은 같은 줄 — 다시 옮겨도 겹치지 않음)
  const ids = await Promise.all(roles.map(async r => slug(r.name) || `r-${(await hash(r.name)).slice(0, 10)}`));
  const st: D1PreparedStatement[] = roles.map((r, i) => env.DB.prepare(
    "INSERT INTO role(owner, id, name, instructions, engine, perms, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(owner, id) DO UPDATE SET instructions = excluded.instructions, engine = excluded.engine, perms = excluded.perms, updated_at = excluded.updated_at")
    .bind(owner, ids[i], r.name.slice(0, 60), (r.description || "").slice(0, 2000), JSON.stringify({ model: r.model || "", from: r.from }), (r.tools || "").slice(0, 400), `import:${r.from}${r.path ? `:${r.path}` : ""}`.slice(0, 300), now, now));
  const done = `역할 ${roles.length}개를 역할 표로${conns.filter(c => c.transport !== "stdio").length ? ` · 커넥터 ${conns.filter(c => c.transport !== "stdio").length}개는 연결하기 카드로` : ""}`;
  st.push(env.DB.prepare("UPDATE imp_proposal SET state = 'applied', result = ?, payload = ? WHERE card_id = ?").bind(done, JSON.stringify({ ...p, connectors: conns }), cardId));
  st.push(env.DB.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE id = ? AND owner = ?").bind(done, cardId, owner));
  st.push(env.DB.prepare("INSERT INTO board_log(owner, win, kind, text, at) VALUES (?,?,?,?,?)").bind(owner, IMPORT_WIN, "done", `들여오기: ${done}`, now));
  await env.DB.batch(st);
}

/** 화면에 보일 들여온 커넥터 · 역할(마지막으로 옮긴 것) + 지금 연결됐는지 */
export async function imported(env: Env, owner: string) {
  const p = await env.DB.prepare("SELECT payload, state, card_id FROM imp_proposal WHERE owner = ? AND state IN ('applied', 'open') ORDER BY at DESC LIMIT 1").bind(owner).first<{ payload: string; state: string; card_id: string }>();
  const roles = (await env.DB.prepare("SELECT id, name, instructions, engine, perms, source FROM role WHERE owner = ? ORDER BY created_at").bind(owner).all()).results;
  if (!p || p.state !== "applied") return { connectors: [], roles, pending: p?.card_id || null };
  let pl: Payload; try { pl = JSON.parse(p.payload); } catch { pl = { connectors: [], roles: [] }; }
  const have = (await env.DB.prepare("SELECT service, url, status FROM connection WHERE owner = ?").bind(owner).all<{ service: string; url: string; status: string }>()).results;
  return {
    pending: null, roles,
    connectors: pl.connectors.map(c => {
      const h = have.find(x => x.service === c.service || (c.url && x.url === c.url));
      return { name: c.name, title: c.title, service: c.service, url: c.url || PRESETS[c.service] || "", transport: c.transport, from: c.from, state: c.transport === "stdio" ? "device" : h ? (h.status === "ok" ? "connected" : "error") : "todo" };
    }),
  };
}
