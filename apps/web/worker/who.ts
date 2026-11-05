type E = { ALLOW_EMAILS?: string };
const mails = (env: E) => String(env.ALLOW_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
export const isAdmin = (env: E, email: string) => mails(env).includes(String(email || "").trim().toLowerCase());
export const canon = (env: E) => mails(env)[0] || "";
// 스위치 owner_key_canon(f7_flag): isolate 마다 — index.ts 맨 앞 미들웨어가 요청마다 ledger 캐시(10초)에서 맞춤. DO · 시험은 setCanonOn 으로
let canonOn = false;
export const setCanonOn = (on: boolean) => { canonOn = on; };
export const canonKeyOn = () => canonOn;
export const legacyKey = (env: E, email: string) => isAdmin(env, email) ? "" : String(email).trim().toLowerCase();
export const dataKey = (env: E, email: string) => isAdmin(env, email) ? (canonOn ? canon(env) : "") : String(email).trim().toLowerCase();
export const botKey = (env: E, email: string) => isAdmin(env, email) ? "@owner" : String(email).trim().toLowerCase();
export const canonKey = (env: E, email: string) => isAdmin(env, email) ? canon(env) : String(email).trim().toLowerCase();
/** 주인 데이터를 읽을 때 볼 열쇠 전부(옮기는 동안 옛 '' · '@owner' 도 같이) */
export const ownerKeys = (env: E) => [canon(env), "", "@owner"];
/** 이 열쇠가 주인 데이터 열쇠인가('' = 옛 열쇠, canon = 새 열쇠) */
export const isOwnerKey = (env: E, key: string) => key === "" || (!!canon(env) && key === canon(env));
/** 읽을 열쇠: 주인 열쇠면 [canon, ''], 회원은 [그 열쇠] */
export const readKeys = (env: E, key: string): string[] => isOwnerKey(env, key) && canon(env) ? [canon(env), ""] : [key];
/** SQL 조각: owner 칸 이름(col)으로 「owner IN (?, ?)」 또는 「owner = ?」 + 바인드 값 */
export const ownerIn = (env: E, key: string, col = "owner") => { const ks = readKeys(env, key); return { sql: ks.length > 1 ? `${col} IN (?, ?)` : `${col} = ?`, args: ks }; };
/** 같은 사람 열쇠인가(옮기는 동안 '' 와 canon 은 같은 주인) */
export const sameKey = (env: E, a: string, b: string) => a === b || (isOwnerKey(env, a) && isOwnerKey(env, b));
// 스위치 owner_unified(f7_flag, 주인 · 회원 한 길 ④-가 화면 전환 — design-owner-unify.md PR6): 켜면 그 주인 로그인이 회원 길(D1 보드, 열쇠 canon)로.
//   계정별: 「owner_unified」 = 주인 메일 넷 모두, 「owner_unified:<메일>」 = 그 로그인 메일만(한 메일로 먼저 해 보기). on = 켜진 스위치 이름(ledger.f7All)
export const unifiedIn = (on: Set<string>, env: E, email: string) => isAdmin(env, email) && (on.has("owner_unified") || on.has("owner_unified:" + String(email || "").trim().toLowerCase()));
/** 주인 메일 가운데 하나라도 켜졌나 — 로그인 메일이 없는 길(화면 칸 알림)이 canon 칸에도 알릴지 */
export const unifiedAnyIn = (on: Set<string>, env: E) => on.has("owner_unified") || mails(env).some(m => on.has("owner_unified:" + m));
