import { engineOf, deliverTo, type EngEnv } from "./engine";
import { target } from "./member-voice";
import { queueToImported } from "./member-imported";
import { boardHead } from "./board-head";

type R = Record<string, any>;
export type SplitState = "in" | "sending" | "fail";
/** local.ts chat_split 이 부름(index.ts 가 env 를 묶어 줌) — 시험은 가짜를 넣음 */
export type SplitSend = (pane: string, text: string) => Promise<{ state: SplitState; why?: string }>;

const one = (s: unknown, n: number) => String(s ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export function splitText(root: string, part: string, why?: string | null) {
  const w = one(why, 160);
  return `${boardHead({ thread: root })} [Boarder chat] (나눔 — 메인 봇이 이 사람의 Primary 글에서 이 창 몫만 넘김${w ? ` · 까닭: ${w}` : ""}) ${one(part, 3000)}`
    + ` (Answer the person under their original message with \`boarder chat --thread ${root} "<text>"\` — it shows in their Primary chat under that message. Short, in their language.)`;
}

export function splitSender(env: EngEnv, me: string): SplitSend {
  return async (pane, text) => {
    try {
      const t = await target(env.DB, me, pane);
      if (!t || t.kind === "main") return { state: "fail", why: "보드에 없는 노드" };
      if (t.kind === "engine") { const r = await deliverTo(env, me, t.wid!, text) as R | null; return { state: r?.queued ? "sending" : "in" }; }
      const w = t.item;
      if (!w?.device_id) return { state: "fail", why: "이 노드엔 글을 넣을 창이 없어요" };
      await queueToImported(env.DB, me, w as never, text, undefined, true);
      try { await (engineOf(env, String(w.device_id)) as unknown as { drainCmds(): Promise<unknown> }).drainCmds(); } catch {}
      return { state: "sending" };   // 그 기기가 가져가 넣음(엔진 소켓이 붙어 있으면 바로)
    } catch (e) { return { state: "fail", why: one((e as Error)?.message, 80) || "창 입력에 넣지 못했어요" }; }
  };
}
