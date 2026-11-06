import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { linkedUser, sessionTarget, type AuthState } from "./user-email";

export type Env = { DB: D1Database; EMAIL: SendEmail; ASSETS: Fetcher; BETTER_AUTH_SECRET: string; PUBLIC_URL: string; ALT_URLS?: string; ALLOW_EMAILS: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };

export const allowed = (env: Env, email: string) => env.ALLOW_EMAILS.split(",").map(s => s.trim().toLowerCase()).includes(email.trim().toLowerCase());
export const isOwner = allowed;
export async function member(env: Env, email: string): Promise<boolean> {
  if (allowed(env, email)) return true;
  if (await env.DB.prepare("SELECT 1 FROM invite WHERE email = ?").bind(email.trim().toLowerCase()).first()) return true;
  const k = await linkedUser(env.DB, email);
  return !!k && (allowed(env, k.email) || !!(await env.DB.prepare("SELECT 1 FROM invite WHERE email = ?").bind(k.email).first()));
}

const codeMail = (code: string) => ({
  subject: `보더 로그인 코드 ${code}`,
  text: `보더 로그인 코드: ${code}\n\n5분 안에 입력하세요. 요청하지 않았다면 이 메일은 무시해도 돼요.`,
  html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111113"><p>보더 로그인 코드</p><p style="font-size:28px;font-weight:600;letter-spacing:4px;font-family:ui-monospace,monospace">${code}</p><p style="color:#8b8b93">5분 안에 입력하세요. 요청하지 않았다면 이 메일은 무시해도 돼요.</p></div>`,
});

export const OTP_SEND_LIMITS = [[10 * 60_000, 5], [24 * 3600_000, 20]] as const;
export async function otpSendOk(db: D1Database, email: string, now = Date.now()): Promise<boolean> {
  const [[w1, n1], [w2, n2]] = OTP_SEND_LIMITS;
  const [ins] = await db.batch([
    db.prepare("INSERT INTO otp_send(email, at) SELECT ?, ? WHERE (SELECT count(*) FROM otp_send WHERE email = ? AND at > ?) < ? AND (SELECT count(*) FROM otp_send WHERE email = ? AND at > ?) < ?")
      .bind(email, now, email, now - w1, n1, email, now - w2, n2),
    db.prepare("DELETE FROM otp_send WHERE at < ?").bind(now - w2),
  ]);
  return !!ins.meta.changes;
}

// 로그인 코드 보관(verification.value, 봉투 암호화 §13): better-auth 의 "hashed" · "encrypted" 는 배포 때 이미 보낸 평문 코드("123456")를
// 못 읽어 그 5분 안 로그인이 깨짐("hashed" 는 다시 보내기 때 같은 코드 다시 쓰기도 멈춤) → 같은 비밀값으로 봉하되 접두사 없는 옛 값은 그대로 읽음.
// 접두사 e1. = BETTER_AUTH_SECRET 로 봉한 better-auth 암호(xchacha20poly1305, hex). 옛 평문 줄은 5분 뒤 저절로 사라져 옮기기가 필요 없음
export const OTP_SEALED = "e1.";
export const otpStore = (secret: string) => ({
  encrypt: async (otp: string) => OTP_SEALED + (await symmetricEncrypt({ key: secret, data: otp })),
  decrypt: async (v: string) => (v.startsWith(OTP_SEALED) ? symmetricDecrypt({ key: secret, data: v.slice(OTP_SEALED.length) }) : v),
});

// st(요청마다 새것, user-email.ts authState): 붙은 메일 로그인으로 세션을 옮겼는지 · 이 요청에서 막 만든 user — 부른 쪽이 응답 뒤 빈 user 를 지우고 캐시 쿠키를 비움(dropFresh · dropCacheCookie)
export function createAuth(env: Env, st?: AuthState) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.PUBLIC_URL,
    basePath: "/api/auth",
    trustedOrigins: [env.PUBLIC_URL, ...(env.ALT_URLS || "").split(",").filter(Boolean)],
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { socialProviders: { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: "select_account" as const } } } : {}),
    rateLimit: { enabled: true },
    disabledPaths: ["/email-otp/request-password-reset", "/forget-password/email-otp", "/email-otp/reset-password", "/change-email", "/email-otp/request-email-change", "/email-otp/change-email"],
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    account: { accountLinking: { enabled: true }, encryptOAuthTokens: true },
    session: { expiresIn: 60 * 60 * 24 * 30, cookieCache: { enabled: true, maxAge: 5 * 60 } },   // 요청마다 D1 을 안 감(5분 서명 쿠키) — 나가기는 바로, 다른 기기 끊기는 최대 5분 늦음
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 5 * 60,
        allowedAttempts: 5,
        disableSignUp: false,
        storeOTP: otpStore(env.BETTER_AUTH_SECRET),
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in") return;   // 로그인 코드만(다른 종류는 주소 상한 밖 길일 수 있음)
          if (!(await member(env, email))) return;
          const mail = codeMail(otp);
          try { await env.EMAIL.send({ to: email, from: { email: "login@dgit.co", name: "Boarder" }, ...mail } as any); }
          catch (e) { console.error("login mail dgit.co failed, fallback 0bridge.dev", String(e).slice(0, 200)); await env.EMAIL.send({ to: email, from: { email: "login@0bridge.dev", name: "Boarder" }, ...mail } as any); }
        },
      }),
    ],
    databaseHooks: {
      user: { create: {
        before: async (u) => (u.emailVerified && (await member(env, u.email)) ? { data: u } : false),   // 확인된 메일 + 초대(코드 길은 늘 확인됨, 구글은 email_verified)
        after: async (u) => { st?.fresh.add(u.id); },
      } },
      // 붙은 메일로 로그인(코드 · 구글 모두): better-auth 는 그 메일 user 를 찾거나 새로 만들어 세션을 엶 → 세션 주인을 열쇠 user 로 바꿈.
      // 그래서 getSession 은 늘 열쇠 user(열쇠 메일)를 돌려줌 — s.user.email 을 데이터 열쇠로 쓰는 곳은 그대로
      session: { create: { before: async (s) => {
        const to = await sessionTarget(env.DB, s.userId); if (!to) return { data: s };
        st?.moved.push({ from: s.userId, to });
        return { data: { ...s, userId: to } };
      } } },
    },
  });
}
