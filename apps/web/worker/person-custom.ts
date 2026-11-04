import { cleanPins, cleanSide, type Pin } from "./side-order";

export const MAX_TEXT = 200_000;
export const MAX_MAIN = 6_000;
const ROLE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type Overlay = { css: string; js: string; wcss: string; wjs: string; wjsSha: string; wside: { side: string[] | null; pins: Pin[] | null } | null };
export type Role = { id: string; name: string; brief: string; instructions: string };

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
export const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** 받은 글 → 저장할 글(문자열이 아니거나 상한을 넘으면 null, 빈 글은 "" = 비움) */
export function cleanText(v: unknown, max = MAX_TEXT): string | null {
  if (typeof v !== "string") return null;
  return new TextEncoder().encode(v).length > max ? null : v;
}

export function cleanWrapperSide(v: unknown): { side: string[] | null; pins: Pin[] | null } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as { side?: unknown; pins?: unknown };
  const side = o.side === undefined ? null : cleanSide(o.side), pins = o.pins === undefined ? null : cleanPins(o.pins);
  if (o.side !== undefined && !side) return null;
  if (o.pins !== undefined && !pins) return null;
  return side || pins ? { side, pins } : null;
}

export function cleanRoles(v: unknown): Role[] | null {
  if (!Array.isArray(v) || v.length > 12) return null;
  const out: Role[] = [], seen = new Set<string>();
  for (const x of v) {
    const r = x as Role;
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !ROLE_ID.test(r.id) || seen.has(r.id)) return null;
    const name = typeof r.name === "string" ? r.name.trim() : "", brief = typeof r.brief === "string" ? r.brief.trim() : "", instructions = typeof r.instructions === "string" ? r.instructions.trim() : "";
    if (!name || name.length > 40 || brief.length > 200 || !instructions || instructions.length > 4000) return null;
    seen.add(r.id); out.push({ id: r.id, name, brief, instructions });
  }
  return out;
}

type Row = { css: string | null; js: string | null; wcss: string | null; wjs: string | null; wjs_sha: string | null; wside: string | null };
export async function readOverlay(db: D1Database, owner: string): Promise<Overlay | null> {
  const r = await db.prepare("SELECT css, js, wcss, wjs, wjs_sha, wside FROM person_custom WHERE owner = ?").bind(owner).first<Row>().catch(() => null);
  if (!r) return null;
  let wside: Overlay["wside"] = null;
  try { wside = r.wside ? cleanWrapperSide(JSON.parse(r.wside)) : null; } catch { /* 깨진 값은 없는 것으로 */ }
  return { css: r.css || "", js: r.js || "", wcss: r.wcss || "", wjs: r.wjs || "", wjsSha: r.wjs_sha || "", wside };
}

/** 칸마다 그 사람 값이 비었을 때만 래퍼 값 */
export const effective = (o: Overlay) => ({ css: o.css || o.wcss, js: o.js || o.wjs });

type Patch = { css?: string | null; js?: string | null; wcss?: string | null; wjs?: string | null; wjs_sha?: string | null; wside?: string | null; p_main?: string | null; p_roles?: string | null };
/** 보낸 칸만 바꿈(null = 비움) — 다른 칸은 그대로 */
export async function savePatch(db: D1Database, owner: string, p: Patch) {
  const keys = Object.keys(p) as (keyof Patch)[];
  if (!keys.length) return;
  const now = Date.now();
  await db.prepare(`INSERT INTO person_custom (owner, ${keys.join(", ")}, at) VALUES (?, ${keys.map(() => "?").join(", ")}, ?) ON CONFLICT(owner) DO UPDATE SET ${keys.map(k => `${k} = excluded.${k}`).join(", ")}, at = excluded.at`)
    .bind(owner, ...keys.map(k => p[k] ?? null), now).run();
}

/** 덧씌우기를 화면에 얹는 태그. 글은 JSON 문자열로 넣어 </script · <!-- 같은 꼴이 껍데기를 닫거나 열지 못하게 한다 */
const lit = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c").split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029");
export function overlayTags(o: Overlay | null): { head: string; body: string } | null {
  if (!o) return null;
  const { css, js } = effective(o);
  if (!css && !js) return null;
  return {
    head: css ? `<script>(function(){var s=document.createElement("style");s.id="hb-overlay-css";s.textContent=${lit(css)};document.head.appendChild(s)})()</script>` : "",
    body: js ? `<script>(function(){var s=document.createElement("script");s.id="hb-overlay-js";s.textContent=${lit(js)};document.body.appendChild(s)})()</script>` : "",
  };
}

/** 엔진 프롬프트: 그 사람 값이 있으면 그것, 없으면 null(호출한 쪽이 코드 기본값을 씀) */
export async function readPrompts(db: D1Database, owner: string): Promise<{ main: string | null; roles: Role[] | null }> {
  const r = await db.prepare("SELECT p_main, p_roles FROM person_custom WHERE owner = ?").bind(owner).first<{ p_main: string | null; p_roles: string | null }>().catch(() => null);
  let roles: Role[] | null = null;
  try { roles = r?.p_roles ? cleanRoles(JSON.parse(r.p_roles)) : null; } catch { /* 깨진 값은 기본값 */ }
  return { main: r?.p_main?.trim() || null, roles: roles?.length ? roles : null };
}
