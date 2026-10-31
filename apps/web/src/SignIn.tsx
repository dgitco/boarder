import { useEffect, useState } from "react";
import { AuthFlow, type AuthErrorCode, type AuthResult, type LookupAnswer, type AuthFailure } from "@/components/auth-flow";

const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "include" });
const fail = (error: AuthErrorCode | string, extra: Partial<AuthFailure> = {}): AuthFailure => ({ ok: false, error, ...extra });

// better-auth email-otp 오류 → 블록 오류
async function otpError(r: Response | null): Promise<AuthFailure> {
  if (!r) return fail("generic");
  if (r.status === 429) return fail("rate_limited", { retryAfterSeconds: Number(r.headers.get("retry-after")) || undefined });
  const j = await r.json().catch(() => ({})) as { code?: string };
  return fail(({ INVALID_OTP: "code_invalid", OTP_EXPIRED: "code_expired", TOO_MANY_ATTEMPTS: "too_many_attempts", INVALID_EMAIL: "email_invalid" } as Record<string, AuthErrorCode>)[j.code || ""] || "generic");
}

export function SignIn({ onDone }: { onDone: () => void }) {
  const [m, setM] = useState<{ code: boolean; google: boolean; home: string } | null>(null), [gErr, setGErr] = useState<AuthErrorCode | undefined>();
  const q = new URLSearchParams(location.search);
  // 구글에서 돌아온 실패: 초대 안 된 메일이면 그 안내, 아니면 구글 실패(better-auth 가 error= 를 붙임)
  const back = q.getAll("error"), backErr: AuthErrorCode | undefined = !back.length ? undefined : back.includes("unable_to_create_user") ? "invite_required" : "google_failed";
  useEffect(() => { fetch("/api/login/methods").then(r => r.json() as Promise<{ code: boolean; google: boolean; home: string }>).then(setM).catch(() => setM({ code: true, google: false, home: location.origin })); }, []);
  async function google(): Promise<AuthResult | void> {
    const home = m?.home || location.origin;
    const here = location.pathname === "/login" ? "/" + location.hash : location.pathname + location.search.replace(/[?&]google=1/, "") + location.hash;   // 돌아올 곳 = 지금 자리(/device 승인 · 딥링크 그대로)
    if (new URL(home).origin !== location.origin) { location.href = home + (location.pathname === "/device" ? location.pathname + location.search + (location.search ? "&" : "?") + "google=1" : "/login?google=1") + location.hash; return; }
    const r = await post("/api/auth/sign-in/social", { provider: "google", callbackURL: home + here, errorCallbackURL: home + "/login" }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) as { url?: string } | null : null;
    if (!j?.url) return fail("google_failed");
    location.href = j.url;
  }
  const [auto, setAuto] = useState(q.get("google") === "1");
  useEffect(() => { if (m?.google && auto) void google().then(r => { if (r && !r.ok){ setGErr("google_failed"); setAuto(false); } }); }, [m]);
  return (
    <AuthFlow
      methods={{ code: true, google: !!m?.google }}
      finishing={!m || (!!m.google && auto)}
      initialError={gErr || backErr}
      brand={<img src="/icons/primary-blob.svg" alt="보더" width={40} height={40} />}
      text={{ emailTitle: "보더에 로그인하기" }}
      lookup={async email => {
        const r = await post("/api/login/lookup", { email }).catch(() => null);
        if (!r) return fail("generic");
        if (r.status === 429) return fail("rate_limited", { retryAfterSeconds: 60 });
        return await r.json().catch(() => fail("generic")) as LookupAnswer | AuthFailure;
      }}
      sendCode={async email => {
        const r = await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" }).catch(() => null);
        return r?.ok ? { ok: true } : otpError(r);
      }}
      verifyCode={async ({ email, code }) => {
        const r = await post("/api/auth/sign-in/email-otp", { email, otp: code }).catch(() => null);
        return r?.ok ? { ok: true } : otpError(r);
      }}
      google={google}
      onDone={onDone}   // 갈 곳은 App 이(/login → / + 딥링크 해시, /device → 그 자리)
    />
  );
}
