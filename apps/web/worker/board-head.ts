export const HEAD_RE = /^\[보드 · ([^\]·]{1,60}?)(?: · (스레드|카드) (\d{10}\.\d{6}))?\] ?/;
const clean = (s: unknown) => String(s ?? "").replace(/[\[\]·\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
/** channel 이 비면 Primary. card 가 있으면 카드, 아니면 thread */
export function boardHead(o: { channel?: string | null; thread?: string | null; card?: string | null }) {
  const ch = clean(o.channel) || "Primary", id = (x: unknown) => /^\d{10}\.\d{6}$/.test(String(x || "")) ? String(x) : "";
  const tail = id(o.card) ? ` · 카드 ${id(o.card)}` : id(o.thread) ? ` · 스레드 ${id(o.thread)}` : "";
  return `[보드 · ${ch}${tail}]`;
}
export const withHead = (head: string, text: string) => `${head} ${text}`;
/** 머리 줄 떼기(화면 · 시스템 줄에 사람 글만 보일 때) */
export const stripHead = (text: string) => String(text).replace(HEAD_RE, "");
