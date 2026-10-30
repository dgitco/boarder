import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";

export type Env = { DB: D1Database; EMAIL: SendEmail; ASSETS: Fetcher; BETTER_AUTH_SECRET: string; PUBLIC_URL: string; ALT_URLS?: string; ALLOW_EMAILS: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };

export const allowed = (env: Env, email: string) => env.ALLOW_EMAILS.split(",").map(s => s.trim().toLowerCase()).includes(email.trim().toLowerCase());
export const isOwner = allowed;
export async function member(env: Env, email: string): Promise<boolean> {
  if (allowed(env, email)) return true;
  return !!(await env.DB.prepare("SELECT 1 FROM invite WHERE email = ?").bind(email.trim().toLowerCase()).first());
}

const codeMail = (code: string) => ({
  subject: `보더 로그인 코드 ${code}`,
  text: `보더 로그인 코드: ${code}\n\n5분 안에 입력하세요. 요청하지 않았다면 이 메일은 무시해도 돼요.`,
  html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111113"><p>보더 로그인 코드</p><p style="font-size:28px;font-weight:600;letter-spacing:4px;font-family:ui-monospace,monospace">${code}</p><p style="color:#8b8b93">5분 안에 입력하세요. 요청하지 않았다면 이 메일은 무시해도 돼요.</p></div>`,
});

export function createAuth(env: Env) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.PUBLIC_URL,
    basePath: "/api/auth",
    trustedOrigins: [env.PUBLIC_URL, ...(env.ALT_URLS || "").split(",").filter(Boolean)],
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { socialProviders: { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: "select_account" as const } } } : {}),
    account: { accountLinking: { enabled: true } },
    session: { expiresIn: 60 * 60 * 24 * 30, cookieCache: { enabled: true, maxAge: 5 * 60 } },   // 요청마다 D1 을 안 감(5분 서명 쿠키) — 나가기는 바로, 다른 기기 끊기는 최대 5분 늦음
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 5 * 60,
        allowedAttempts: 5,
        disableSignUp: false,
        async sendVerificationOTP({ email, otp }) {
          if (!(await member(env, email))) return;   // 밖 주소: 조용히 아무것도 안 보냄(있는 주소인지 알려 주지 않음)
          await env.EMAIL.send({ to: email, from: { email: "login@0bridge.dev", name: "Boarder" }, ...codeMail(otp) } as any);
        },
      }),
    ],
    databaseHooks: { user: { create: { before: async (u) => (u.emailVerified && (await member(env, u.email)) ? { data: u } : false) } } },   // 확인된 메일 + 초대(코드 길은 늘 확인됨, 구글은 email_verified)
  });
}
