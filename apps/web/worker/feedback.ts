import { z } from "zod";
import { maskText } from "./mcp/registry";

export const FEEDBACK_MAX = 2000;
const HOUR_LIMIT = 30;
const FLAG_GAP_MS = 60_000;
const CTRL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;   // 줄바꿈 · 탭만 됨

export const FeedbackIn = z.object({
  text: z.string().transform(v => v.replace(/\r\n?/g, "\n").trim()).pipe(z.string().min(1).max(FEEDBACK_MAX).refine(v => !CTRL.test(v), "제어 문자는 못 씀")),
  kind: z.enum(["bug", "idea", "other"]).default("other"),
  page: z.unknown().optional().transform(v => typeof v === "string" && v.length <= 200 && /^[\w#/?=&.:%~+!'()*-]*$/.test(v) ? v : undefined),
});
type Who = { owner: string; author: string; via: "web" | "mcp" | "cli"; test?: boolean };   // test: 알림이 시험 릴레이로 감(운영 1분 칸을 쓰지 않음)
const KIND_KO: Record<string, string> = { bug: "버그", idea: "아이디어", other: "기타" };

export async function addFeedback(db: D1Database, who: Who, raw: unknown, flag: (text: string) => void): Promise<{ ok: true; id: string } | { error: string; status: 400 | 429 }> {
  const p = FeedbackIn.safeParse(raw ?? {});
  if (!p.success) return { error: `입력이 맞지 않음: ${p.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join("; ")}`, status: 400 };
  const now = Date.now(), author = who.author.replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 120);
  const id = "fb_" + [...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(16).padStart(2, "0")).join("");
  const text = maskText(p.data.text);
  const bucket = who.owner ? ["owner = ?", who.owner] as const : ["owner = '' AND author = ?", author] as const;
  const ins = await db.prepare(`INSERT INTO feedback(id, owner, author, via, kind, text, page, at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM feedback WHERE ${bucket[0]} AND at > ?) < ?`)
    .bind(id, who.owner, author, who.via, p.data.kind, text, p.data.page || "", now, bucket[1], now - 3600_000, HOUR_LIMIT).run();
  if (!ins.meta.changes) return { error: "피드백은 1시간에 30개까지예요", status: 429 };
  const fl = who.test ? 2 : 1;
  const mark = await db.prepare("UPDATE feedback SET flagged = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM feedback WHERE flagged = ? AND at > ?)").bind(fl, id, fl, now - FLAG_GAP_MS).run();
  if (mark.meta.changes) {
    const n = await db.prepare("SELECT count(*) n FROM feedback WHERE state = 'new'").first<{ n: number }>();
    flag(`Boarder 새 피드백 ${KIND_KO[p.data.kind]} · ${who.owner ? `회원 ${who.owner}` : `주인 쪽 ${author.slice(0, 60)}`} · 확인 안 한 피드백 ${n?.n ?? "?"}개 — 하루 한 번 개선 일감으로(tools/feedback-triage.py) (${id})`);
  }
  return { ok: true, id };
}
