import { useEffect, useState } from "react";
import { AuthLayout, AuthTitle, AuthButton, AuthNote, AuthCodeField } from "@/components/auth-page";

type Info = { name: string; tools: string; at: number; ip: string; country: string; same: boolean; mode: "local" | "code"; scope?: "full" | "watch" };
const MSG: Record<string, string> = {
  expired: "만료된 코드예요 — 터미널에서 boarder setup 을 다시 돌려요",
  unknown: "없는 코드예요 — 터미널에 나온 코드를 그대로 넣어요",
  done: "이미 처리한 요청이에요",
};
const ERR = "일시적인 오류가 발생했어요";
const phone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const KEPT = (c: string) => `bx-device-confirm:${c}`;
const kept = (c: string) => { try { return sessionStorage.getItem(KEPT(c)) || ""; } catch { return ""; } };
const fix = (v: string) => { let s = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); if (s.length > 4) s = `${s.slice(0, 4)}-${s.slice(4)}`; return s; };

export function Device({ email }: { email: string }) {
  const [code, setCode] = useState(() => fix(new URLSearchParams(location.search).get("code") || ""));
  const [typed, setTyped] = useState(false);
  const [info, setInfo] = useState<Info | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState<"" | "allow" | "deny">("");
  const [confirm, setConfirm] = useState(() => kept(code));   // 허용한 뒤 터미널에 넣을 확인 코드(로컬 길 · 다른 기기)
  useEffect(() => {
    setInfo(null); setErr("");
    if (code.length < 9 || confirm) return;
    fetch(`/api/device/lookup?code=${encodeURIComponent(code)}`, { credentials: "include" })
      .then(async r => { const j = await r.json().catch(() => ({})) as Info & { error?: string };
        if (!r.ok) return setErr(MSG[j.error || ""] || ERR);
        if (j.mode === "code" && !typed) { setCode(""); return; }   // 주소로 온 코드 길 요청: 비우고 직접 넣게
        setInfo(j); })
      .catch(() => setErr(ERR));
  }, [code]);
  async function act(allow: boolean) {
    setBusy(true); setErr("");
    const r = await fetch("/api/device/approve", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-hb": "1" }, body: JSON.stringify({ user_code: code, allow }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) as { redirect?: string; error?: string; confirm?: string } : {};
    setBusy(false);
    if (!r?.ok) return setErr(MSG[j.error || ""] || ERR);
    if (j.confirm) {
      setConfirm(j.confirm);   // 넘기기 전에 코드 화면으로 — 못 넘어가 「뒤로」 오면 브라우저가 되살린 화면(bfcache)도 코드, 새로 읽으면 sessionStorage
      try { sessionStorage.setItem(KEPT(code), j.confirm); } catch {}
      if (phone()) return;   // 휴대폰엔 터미널이 없음 — 넘기지 않음
    }
    if (j.redirect) { location.href = j.redirect; return; }   // 그 기기의 터미널(127.0.0.1)이 받고 「터미널로 돌아가요」를 보여 줌
    setDone(allow ? "allow" : "deny");
  }
  const brand = <img src="/icons/primary-blob.svg" alt="Boarder" width={40} height={40} />;
  if (confirm) return (
    <AuthLayout brand={brand}>
      <AuthTitle sub={phone() ? "휴대폰에선 터미널로 바로 못 넘어가요 — 터미널의 boarder setup 에 이 코드를 넣어요" : "터미널로 넘어가지 않았다면 터미널의 boarder setup 에 이 코드를 넣어요"}>허용했어요</AuthTitle>
      <div className="rounded-2xl bg-muted/60 px-4 py-4 text-center font-mono text-[28px] font-semibold tracking-[0.2em]" aria-label="확인 코드">{confirm}</div>
      <AuthNote>터미널에 「Approving on another device?」 줄이 보이면 그 자리에 넣어요. 10분 안에, 이 화면은 남에게 보여 주지 마요.</AuthNote>
      <AuthButton onClick={() => { location.href = "/"; }}>보더로</AuthButton>
    </AuthLayout>
  );
  if (done) return (
    <AuthLayout brand={brand}>
      <AuthTitle sub={done === "allow" ? "터미널로 돌아가요 — boarder setup 이 이어서 해요" : "터미널의 boarder setup 은 멈춰요"}>{done === "allow" ? "허용했어요" : "거절했어요"}</AuthTitle>
      <AuthButton onClick={() => { location.href = "/"; }}>보더로</AuthButton>
    </AuthLayout>
  );
  const when = info ? new Date(info.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <AuthLayout brand={brand}>
      <AuthTitle sub={!info ? "터미널에 나온 코드를 넣어요" : info.mode === "code" ? "넣은 코드의 기기가 맞는지 보세요" : `${email} 로 이 기기를 연결해요`}>
        {!info ? "기기 코드" : info.scope === "watch" ? "이 기기를 감시만 허용할까요?" : info.mode === "code" ? "이 기기가 맞나요?" : "이 기기에서 보더를 쓸까요?"}
      </AuthTitle>
      {(!info || info.mode === "code") && (
        <AuthCodeField value={code} maxLength={9} onChange={e => { setTyped(true); setCode(fix(e.target.value)); }} aria-label="코드" placeholder="XXXX-XXXX" className="tracking-[0.2em]" />
      )}
      {info?.scope === "watch" && (
        <div className="rounded-2xl border px-4 py-3 text-[14px] leading-relaxed" aria-label="감시만">
          <b className="font-medium">감시만</b> — 이 기기는 메모리 · CPU · 디스크 · 에이전트 수 · Claude 한도만 설정 › 기기에 올려요. 보드 · 창 · 도구는 못 써요. 직접 돌린 게 아니면 거절해요.
        </div>
      )}
      {info && (
        <div className="flex flex-col gap-1.5 rounded-2xl bg-muted/60 px-4 py-3 text-[14px] leading-relaxed" aria-label="요청한 기기">
          <div><span className="text-muted-foreground">기기</span> <b className="font-medium">{info.name || "이름 없음"}</b>{info.tools ? <span className="text-muted-foreground"> · {info.tools}</span> : null}</div>
          <div><span className="text-muted-foreground">요청한 곳</span> {info.country || "?"} · {when}</div>
          {info.same
            ? <div className="text-emerald-700 dark:text-emerald-400">지금 이 브라우저와 같은 곳에서 온 요청이에요</div>
            : <div className="font-medium text-destructive">이 브라우저와 다른 곳에서 온 요청이에요 — 직접 돌린 게 아니면 거절해요</div>}
        </div>
      )}
      <AuthButton primary disabled={busy || !info} onClick={() => act(true)}>{busy ? <span className="g g-spin" aria-label="처리 중" /> : "허용"}</AuthButton>
      <AuthButton disabled={busy || !info} onClick={() => act(false)}>거절</AuthButton>
      <AuthButton disabled={busy} onClick={async () => { await fetch("/api/auth/sign-out", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-hb": "1" }, body: "{}" }).catch(() => null); location.reload(); }}>{email} 말고 다른 계정으로</AuthButton>
      {err ? <AuthNote className="text-destructive">{err}</AuthNote> : null}   {}
    </AuthLayout>
  );
}
