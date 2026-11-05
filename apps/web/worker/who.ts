type E = { ALLOW_EMAILS?: string };
const mails = (env: E) => String(env.ALLOW_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
export const isAdmin = (env: E, email: string) => mails(env).includes(String(email || "").trim().toLowerCase());
export const canon = (env: E) => mails(env)[0] || "";
export const dataKey = (env: E, email: string) => isAdmin(env, email) ? "" : String(email).trim().toLowerCase();
export const botKey = (env: E, email: string) => isAdmin(env, email) ? "@owner" : String(email).trim().toLowerCase();
export const canonKey = (env: E, email: string) => isAdmin(env, email) ? canon(env) : String(email).trim().toLowerCase();
/** 주인 데이터를 읽을 때 볼 열쇠 전부(옮기는 동안 옛 '' · '@owner' 도 같이) */
export const ownerKeys = (env: E) => [canon(env), "", "@owner"];
