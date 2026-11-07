import { redact } from "./session/redact";

// 실행기의 비밀 검사 전에 평문이 D1 에 남지 않게, 채팅의 예전 길 판정과 큐 봉함이 같은 규칙을 쓴다.
//   ① 파이썬 가림과 같게: redact.py 는 re.ASCII(유니코드 빈칸은 글자), redact.ts 는 JS \s(NBSP 등도 빈칸) — 유니코드 빈칸을 글자로 바꾼 사본도 가려 봄
//   ② 서버 환경 비밀 값(Worker 는 모름): URL 을 뺀 글에 17자 넘는 글자 · 숫자 덩어리가 있으면(긴 영문 단어도 걸림 — 예전 길로 가도 됨)
const foldWs = (t: string) => t.replace(/[^\x00-\x7f]/gu, ch => /\s/u.test(ch) ? "\u00a4" : ch);
const CHUNK = /[A-Za-z0-9_\-+/=]{17,}/;
export function maybeSecret(text: string, ours: string[] = []) {
  if (redact(text) !== text || redact(foldWs(text)) !== foldWs(text)) return true;
  const rest = text.split("\n").filter(l => !ours.includes(l)).join("\n")   // Worker 가 붙인 「📎 이름: 서명 링크」 줄(파일 이름 · 서명 값)은 우리 것
    .replace(/https?:\/\/\S+/g, " ");
  return CHUNK.test(rest);
}

