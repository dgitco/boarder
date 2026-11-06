import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

type DB = D1Database;
export type MailEnv = { DB: DB; EMAIL: SendEmail; BETTER_AUTH_SECRET: string; ALLOW_EMAILS: string };

export const MAX_EMAILS = 10;
export const TEST_ADD = /^[a-z0-9][a-z0-9._+-]{0,60}@example\.com$/;   // 끝에서 끝 시험 주소(index.ts TEST_EMAIL 과 같은 꼴)
export const CODE_MS = 10 * 60_000, CODE_TRIES = 5;
export const TAKEN = "이미 다른 계정이 쓰는 메일이에요";
export const lc = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
export const validMail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const owners = (env: { ALLOW_EMAILS: string }) => String(env.ALLOW_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const ident = (uid: string, email: string) => `add-email:${uid}:${email}`;
// 그 계정의 확인 대기 줄(앞부분이 같은 것 — LIKE 는 _ · % 가 아무 글자로 맞아서 안 씀)
const mine = (uid: string) => ({ sql: "substr(identifier, 1, ?) = ?", args: [`add-email:${uid}:`.length, `add-email:${uid}:`] });
const missing = (e: unknown) => /no such table/i.test(String(e));   // 이주 앞 판(시험 · 되돌린 판): 붙은 메일 없음으로

/** 확인되어 붙은 메일 → 그 열쇠 user(자기 열쇠 메일 줄이면 null — 이미 자기 자신) */
export async function linkedUser(db: DB, email: string): Promise<{ id: string; email: string } | null> {
  const e = lc(email); if (!e) return null;
  try {
    const r = await db.prepare('SELECT u.id, u.email FROM user_email m JOIN "user" u ON u.id = m.user_id WHERE m.email = ? AND m.verified_at IS NOT NULL AND lower(u.email) != ?').bind(e, e).first<{ id: string; email: string }>();
    return r ? { id: r.id, email: lc(r.email) } : null;
  } catch (err) { if (missing(err)) return null; throw err; }
}
/** 메일 → 열쇠 메일(붙은 메일이면 그 계정 열쇠, 아니면 그대로 소문자) */
export const keyEmail = async (db: DB, email: string) => (await linkedUser(db, email))?.email ?? lc(email);

/** 열쇠 메일들 → 대표 메일(대표 줄이 없으면 열쇠 그대로) */
export async function primaryOf(db: DB, keys: string[]): Promise<Map<string, string>> {
  const u = [...new Set(keys.map(lc).filter(Boolean))], out = new Map(u.map(k => [k, k]));
  if (!u.length) return out;
  try {
    const rows = (await db.prepare(`SELECT lower(u.email) k, m.email p FROM "user" u JOIN user_email m ON m.user_id = u.id AND m.is_primary = 1 WHERE lower(u.email) IN (${u.map(() => "?").join(",")})`).bind(...u).all<{ k: string; p: string }>()).results;
    for (const r of rows) out.set(r.k, r.p);
  } catch (err) { if (!missing(err)) throw err; }
  return out;
}
export const primaryEmail = async (db: DB, key: string) => (await primaryOf(db, [key])).get(lc(key)) || lc(key);

// ── 계정 고르기: 회원은 자기 user, 주인은 주인 user 넷 모두(새로 붙이는 메일은 첫 주인 user 에)
type Acct = { home: string; ids: string[]; owner: boolean; key: string };
async function acct(env: MailEnv, me: string): Promise<Acct | null> {
  const key = lc(me), own = owners(env);
  if (own.includes(key)) {
    const rows = (await env.DB.prepare(`SELECT id, lower(email) e FROM "user" WHERE lower(email) IN (${own.map(() => "?").join(",")})`).bind(...own).all<{ id: string; e: string }>()).results;
    if (!rows.length) return null;
    const home = (rows.find(r => r.e === own[0]) || rows.find(r => r.e === key) || rows[0]).id;
    return { home, ids: rows.map(r => r.id), owner: true, key: own[0] };
  }
  const u = await env.DB.prepare('SELECT id FROM "user" WHERE lower(email) = ?').bind(key).first<{ id: string }>();
  return u ? { home: u.id, ids: [u.id], owner: false, key } : null;
}
const inIds = (ids: string[]) => ids.map(() => "?").join(",");

/** 설정 › 프로필 「계정」 목록: 붙은 메일(대표 · 열쇠 · 잠김) + 확인 대기 */
export async function listEmails(env: MailEnv, me: string, now = Date.now()) {
  const a = await acct(env, me); if (!a) return null;
  const own = owners(env);
  const rows = (await env.DB.prepare(`SELECT email, user_id, is_primary, added_at FROM user_email WHERE user_id IN (${inIds(a.ids)}) AND verified_at IS NOT NULL ORDER BY added_at, email`).bind(...a.ids).all<{ email: string; user_id: string; is_primary: number; added_at: number }>()).results;
  const pm = mine(a.home);
  const pend = (await env.DB.prepare(`SELECT identifier FROM verification WHERE ${pm.sql} AND "expiresAt" > ?`).bind(...pm.args, new Date(now).toISOString()).all<{ identifier: string }>()).results
    .map(r => r.identifier.slice(`add-email:${a.home}:`.length));
  const seen = new Set<string>(), emails: { email: string; primary: boolean; key: boolean; locked: boolean }[] = [];
  if (a.owner) for (const e of own) { seen.add(e); emails.push({ email: e, primary: e === own[0], key: true, locked: true }); }   // 주인 넷: 떼기 · 대표 바꾸기 없음
  const keyOf = new Map<string, string>();
  for (const id of a.ids) { const u = await env.DB.prepare('SELECT lower(email) e FROM "user" WHERE id = ?').bind(id).first<{ e: string }>(); if (u) keyOf.set(id, u.e); }
  for (const r of rows) if (!seen.has(r.email)) { seen.add(r.email); emails.push({ email: r.email, primary: !a.owner && !!r.is_primary, key: keyOf.get(r.user_id) === r.email, locked: false }); }
  if (!a.owner && !emails.some(e => e.key)) emails.unshift({ email: a.key, primary: !emails.some(e => e.primary), key: true, locked: false });   // 이주 앞에 없던 줄도 보이게
  if (!a.owner && !emails.some(e => e.primary)) emails.find(e => e.key)!.primary = true;
  return { owner: a.owner, emails, pending: pend.filter(e => !seen.has(e)), max: MAX_EMAILS };
}

// ── 메일 더하기: 6자리 코드(10분 · 5번 · 한 번만), 코드는 BETTER_AUTH_SECRET 로 봉해 verification 표에(로그인 코드와 같은 봉함 — auth.ts otpStore)
const SEAL = "e1.";
const seal = async (secret: string, v: string) => SEAL + (await symmetricEncrypt({ key: secret, data: v }));
const unseal = async (secret: string, v: string) => (v.startsWith(SEAL) ? symmetricDecrypt({ key: secret, data: v.slice(SEAL.length) }) : v);
const code6 = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
const sameCode = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
export const addMail = (code: string) => ({
  subject: `보더 메일 확인 코드 ${code}`,
  text: `보더 계정에 이 메일을 붙이는 코드: ${code}\n\n10분 안에 설정 화면에 넣어 주세요. 요청하지 않았다면 이 메일은 무시해도 돼요.`,
  html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111113"><p>보더 계정에 이 메일을 붙이는 코드</p><p style="font-size:28px;font-weight:600;letter-spacing:4px;font-family:ui-monospace,monospace">${code}</p><p style="color:#8b8b93">10분 안에 설정 화면에 넣어 주세요. 요청하지 않았다면 이 메일은 무시해도 돼요.</p></div>`,
});

type Err = { error: string; status: 400 | 403 | 404 | 409 | 429 };
const bad = (error: string, status: Err["status"] = 400): Err => ({ error, status });

/** 붙일 수 있나(남의 계정 · 주인 메일 · 회원 메일 · 개수). 이미 다른 user 줄이 있는 메일은 합치지 않음 */
async function blocked(env: MailEnv, a: Acct, e: string, pendingToo: boolean): Promise<Err | null> {
  const own = owners(env);
  if (a.owner ? own.includes(e) : e === a.key) return bad("이미 붙은 메일이에요");
  if (!a.owner && own.includes(e)) return bad(TAKEN, 409);   // 회원이 주인 메일
  const m = await env.DB.prepare("SELECT user_id FROM user_email WHERE email = ?").bind(e).first<{ user_id: string }>();
  if (m) return a.ids.includes(m.user_id) ? bad("이미 붙은 메일이에요") : bad(TAKEN, 409);
  if (await env.DB.prepare('SELECT 1 FROM "user" WHERE lower(email) = ?').bind(e).first()) return bad(TAKEN, 409);   // 그 메일로 가입한 계정이 있음(합치기 안 함)
  if (a.owner && await env.DB.prepare("SELECT 1 FROM invite WHERE email = ?").bind(e).first()) return bad("회원이 쓰는 메일이라 붙일 수 없어요", 409);   // 주인이 회원 메일(첫 판은 막음)
  const rows = (await env.DB.prepare(`SELECT email FROM user_email WHERE user_id IN (${inIds(a.ids)}) AND verified_at IS NOT NULL`).bind(...a.ids).all<{ email: string }>()).results;
  const have = new Set([...(a.owner ? own : [a.key]), ...rows.map(r => r.email)]).size;
  const pm = mine(a.home);
  const p = pendingToo ? await env.DB.prepare(`SELECT count(*) n FROM verification WHERE ${pm.sql} AND identifier != ?`).bind(...pm.args, ident(a.home, e)).first<{ n: number }>() : { n: 0 };
  if (have + Number(p?.n || 0) >= MAX_EMAILS) return bad(`메일은 ${MAX_EMAILS}개까지 붙여요`);
  return null;
}

export async function startAdd(env: MailEnv, me: string, input: unknown, sendOk: (db: DB, e: string) => Promise<boolean>, now = Date.now()): Promise<Err | { ok: true; email: string; code: string }> {
  const e = lc(input); if (!validMail(e)) return bad("메일 주소를 확인해 주세요");
  const a = await acct(env, me); if (!a) return bad("로그인", 403);
  const no = await blocked(env, a, e, true); if (no) return no;
  // 로그인 코드와 같은 상한(otp_send, 10분 5번 · 하루 20번): 받는 주소마다 + 보내는 계정마다(더하기 · 취소를 되풀이해 여러 주소로 코드 메일을 뿌리지 못하게)
  if (!(await sendOk(env.DB, `add-email:${a.home}`)) || !(await sendOk(env.DB, e))) return bad("잠시 뒤 다시 해 주세요", 429);
  const code = code6(), id = ident(a.home, e), at = new Date(now).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM verification WHERE identifier = ? OR (substr(identifier, 1, 10) = 'add-email:' AND \"expiresAt\" <= ?)").bind(id, at),
    env.DB.prepare('INSERT INTO verification(id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), id, await seal(env.BETTER_AUTH_SECRET, `${code}:0`), new Date(now + CODE_MS).toISOString(), at, at),
  ]);
  if (TEST_ADD.test(e)) return { ok: true, email: e, code };   // 시험 주소(@example.com — 없는 메일함): 안 보냄, 코드는 관리 토큰 길로만
  const mail = addMail(code);
  try { await env.EMAIL.send({ to: e, from: { email: "login@dgit.co", name: "Boarder" }, ...mail } as never); }
  catch (err) { console.error("add-email mail dgit.co failed, fallback 0bridge.dev", String(err).slice(0, 200)); await env.EMAIL.send({ to: e, from: { email: "login@0bridge.dev", name: "Boarder" }, ...mail } as never); }
  return { ok: true, email: e, code };
}

export async function verifyAdd(env: MailEnv, me: string, input: unknown, codeIn: unknown, now = Date.now()): Promise<Err | { ok: true; email: string }> {
  const e = lc(input), code = String(codeIn ?? "").trim();
  const a = await acct(env, me); if (!a) return bad("로그인", 403);
  const id = ident(a.home, e);
  const row = await env.DB.prepare('SELECT id, value, "expiresAt" x FROM verification WHERE identifier = ?').bind(id).first<{ id: string; value: string; x: string }>();
  if (!row || Date.parse(row.x) <= now) { if (row) await env.DB.prepare("DELETE FROM verification WHERE id = ?").bind(row.id).run(); return bad("코드가 지났어요. 다시 받아 주세요"); }
  const [want, triesS] = (await unseal(env.BETTER_AUTH_SECRET, row.value)).split(":"), tries = Number(triesS) || 0;
  if (tries >= CODE_TRIES) { await env.DB.prepare("DELETE FROM verification WHERE id = ?").bind(row.id).run(); return bad("코드를 너무 많이 틀렸어요. 다시 받아 주세요"); }
  if (!/^\d{6}$/.test(code) || !sameCode(code, want)) {
    if (tries + 1 >= CODE_TRIES) await env.DB.prepare("DELETE FROM verification WHERE id = ?").bind(row.id).run();
    else await env.DB.prepare('UPDATE verification SET value = ?, "updatedAt" = ? WHERE id = ? AND value = ?').bind(await seal(env.BETTER_AUTH_SECRET, `${want}:${tries + 1}`), new Date(now).toISOString(), row.id, row.value).run();
    return bad(tries + 1 >= CODE_TRIES ? "코드를 너무 많이 틀렸어요. 다시 받아 주세요" : "코드가 맞지 않아요");
  }
  // 한 번만: 지운 쪽만 이어감(같은 코드로 두 번 동시에 와도 하나만)
  const del = await env.DB.prepare("DELETE FROM verification WHERE id = ? AND value = ?").bind(row.id, row.value).run();
  if (!del.meta.changes) return bad("코드가 지났어요. 다시 받아 주세요");
  const no = await blocked(env, a, e, false); if (no) return no;   // 코드를 받는 사이 남이 그 메일로 가입했을 수 있음
  try { await env.DB.prepare("INSERT INTO user_email(email, user_id, verified_at, is_primary, added_at) VALUES (?,?,?,0,?)").bind(e, a.home, now, now).run(); }
  catch { return bad(TAKEN, 409); }   // 같은 때 남이 가입(가입 트리거가 먼저 줄을 넣음)
  return { ok: true, email: e };
}


export async function removeEmail(env: MailEnv, me: string, input: unknown): Promise<Err | { ok: true }> {
  const e = lc(input), a = await acct(env, me); if (!a) return bad("로그인", 403);
  if (owners(env).includes(e)) return bad("주인 메일은 뗄 수 없어요", 403);
  const r = await env.DB.prepare(`SELECT m.user_id, m.is_primary, lower(u.email) k FROM user_email m JOIN "user" u ON u.id = m.user_id WHERE m.email = ? AND m.user_id IN (${inIds(a.ids)})`).bind(e, ...a.ids).first<{ user_id: string; is_primary: number; k: string }>();
  if (!r) { await env.DB.prepare("DELETE FROM verification WHERE identifier = ?").bind(ident(a.home, e)).run(); return { ok: true }; }   // 확인 대기 취소도 같은 단추
  if (r.k === e) return bad("처음 가입한 메일은 뗄 수 없어요", 403);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_email WHERE email = ? AND user_id = ?").bind(e, r.user_id),
    // 대표였으면 열쇠 메일로 돌아감
    env.DB.prepare('UPDATE user_email SET is_primary = 1 WHERE user_id = ? AND email = ? AND NOT EXISTS (SELECT 1 FROM user_email WHERE user_id = ? AND is_primary = 1)').bind(r.user_id, r.k, r.user_id),
    // 그 메일로 연 세션은 열쇠 user 줄이라 남음 — 떼면 그 메일 로그인만 막히고 지금 기기는 그대로(나가기는 기기 화면에서)
  ]);
  return { ok: true };
}

export async function setPrimary(env: MailEnv, me: string, input: unknown): Promise<Err | { ok: true }> {
  const e = lc(input), a = await acct(env, me); if (!a) return bad("로그인", 403);
  if (a.owner) return bad("주인 계정은 대표 메일을 바꾸지 않아요", 403);
  const r = await env.DB.prepare("SELECT 1 FROM user_email WHERE email = ? AND user_id = ? AND verified_at IS NOT NULL").bind(e, a.home).first();
  if (!r) return bad("붙은 메일만 대표로 해요", 404);
  await env.DB.prepare("UPDATE user_email SET is_primary = CASE WHEN email = ? THEN 1 ELSE 0 END WHERE user_id = ?").bind(e, a.home).run();
  return { ok: true };
}

// ── 로그인: 붙은 메일로 들어온 세션을 열쇠 user 로(auth.ts session.create.before). 그때 better-auth 가 만든 빈 user 줄은 지움
export type AuthState = { fresh: Set<string>; moved: { from: string; to: string }[] };
export const authState = (): AuthState => ({ fresh: new Set(), moved: [] });
export async function sessionTarget(db: DB, userId: string): Promise<string | null> {
  try {
    const r = await db.prepare('SELECT m.user_id FROM "user" u JOIN user_email m ON m.email = lower(u.email) AND m.verified_at IS NOT NULL WHERE u.id = ? AND m.user_id != u.id').bind(userId).first<{ user_id: string }>();
    return r?.user_id ?? null;
  } catch (err) { if (missing(err)) return null; throw err; }
}
/** 세션을 옮긴 뒤: 이 요청에서 막 생긴 빈 user(붙은 메일 첫 로그인)만 지움 — 원래 있던 줄은 손대지 않음 */
export async function dropFresh(db: DB, st: AuthState) {
  for (const m of st.moved) if (st.fresh.has(m.from)) await db.batch([
    db.prepare('DELETE FROM session WHERE "userId" = ?').bind(m.from),
    db.prepare('DELETE FROM account WHERE "userId" = ?').bind(m.from),
    db.prepare('DELETE FROM "user" WHERE id = ?').bind(m.from),
  ]);
}
/** 세션을 옮긴 응답: 캐시 쿠키(session_data — 빈 user 를 담음)를 비움 → 다음 getSession 이 D1 에서 열쇠 user 를 읽음 */
export function dropCacheCookie(res: Response, name: string): Response {
  const h = new Headers(res.headers), keep = h.getSetCookie().filter(c => !c.startsWith(name + "="));
  h.delete("set-cookie");
  for (const c of keep) h.append("set-cookie", c);
  h.append("set-cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// ── 시험 길(/api/admin/test-email-code, 관리 토큰): 확인 대기 중인 시험 주소의 코드 — 다른 주소는 없음과 같게(404)
export async function testCode(env: MailEnv, input: unknown): Promise<string | null> {
  const e = lc(input); if (!TEST_ADD.test(e)) return null;
  const rows = (await env.DB.prepare(`SELECT identifier, value FROM verification WHERE substr(identifier, 1, 10) = 'add-email:' AND substr(identifier, -?) = ? AND "expiresAt" > ? ORDER BY "createdAt" DESC`).bind(e.length + 1, ":" + e, new Date().toISOString()).all<{ identifier: string; value: string }>()).results;
  const r = rows.find(x => x.identifier.endsWith(":" + e));
  return r ? (await unseal(env.BETTER_AUTH_SECRET, r.value)).split(":")[0] : null;
}
