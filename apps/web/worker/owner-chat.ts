import { redact } from "./session/redact";
import { ridDup, ridRow } from "./queue";
import { BEAT_MAX, okeyOf } from "./owner-jobs";

export const FLAG = "write_chat_d1";
const RID = /^[\w-]{6,64}$/;   // queue.ts RID 와 같음
export const AUTHOR = "Owner (보드)";   // chat.py BOARD_NAME — owner-read 가 이 이름으로 「보드 글」을 가름
const MAX = 4000;

// server.py CTRL_KEEP_NL — 줄바꿈만 남기고 제어문자는 빈칸
const CTRL_KEEP_NL = /[\x00-\x09\x0b-\x1f\x7f]/g;
const TS = /^\d{10}\.\d{6}$/;
// 파이썬 str.strip() 이 지우는 빈칸(JS trim 과 다름: \x85 는 지우고 BOM 은 안 지움) — 실행기가 같은 글로 대조함(server.py pre_wait)
const PY_WS = "[\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const PY_STRIP = new RegExp(`^${PY_WS}+|${PY_WS}+$`, "g");
// slack_assistant.secret_check 의 꼴 부분 — 이런 글은 예전 길이 거절(실패)하니 같은 결과가 나게 예전 길로
const SECRET_REJECT = /xox[baprs]-[\w-]+|xapp-[\w-]+|-----BEGIN .*PRIVATE KEY/;
const SYNC = [
  /^\s*(?:간단히\s*)?(?:싱크|브리핑)(?:\s*해)?(?:\s*(?:줘|줘요|주세요|해줘|해 줘))?\s*[.!~?]*\s*$/,
  /^\s*출근\s*브리핑(?:\s*해)?(?:\s*(?:줘|줘요|주세요|해줘|해 줘))?\s*[.!~?]*\s*$/,
  /^\s*(?:[1-9]\s*(?:[AaBb]|했음)(?:\s*[,/ ]\s*|\s*))+[.!~]*\s*$/,
  /^\s*(?:더|더\s*줘|더\s*보여\s*줘|다음)\s*[.!~?]*\s*$/,
];
const OTHER_KEYS = ["label", "react", "unreact", "edit", "delete", "seen", "topic", "blocker", "stt", "card", "files", "vmark"];

/** primary_relay.mrkdwn 과 같은 변환(Claude 마크다운 → Slack mrkdwn) */
export function mrkdwn(md: string) {
  const out: string[] = []; let fence = false;
  for (let line of md.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/)) {   // 파이썬 splitlines 와 같은 줄 끝
    if (line.trim().startsWith("```")) { fence = !fence; out.push("```"); continue; }
    if (fence) { out.push(line); continue; }
    line = line.replace(/^\s{0,3}#{1,6}\s+(.*)$/, "*$1*")
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>")
      .replace(/^(\s*)[-*]\s+/, "$1• ");
    out.push(line);
  }
  return out.join("\n");
}
/** slack_assistant.text_blocks — 2900자(코드 포인트)씩 section, 45개까지 */
export function textBlocks(text: string) {
  const cp = Array.from(text), out: object[] = [];
  for (let i = 0; i < cp.length && out.length < 45; i += 2900) out.push({ type: "section", text: { type: "mrkdwn", text: cp.slice(i, i + 2900).join("") } });
  return out;
}

const foldWs = (t: string) => t.replace(/[^\x00-\x7f]/gu, ch => /\s/u.test(ch) ? "\u00a4" : ch);
const CHUNK = /[A-Za-z0-9_\-+/=]{17,}/;
export function maybeSecret(text: string, ours: string[] = []) {
  if (redact(text) !== text || redact(foldWs(text)) !== foldWs(text)) return true;
  const rest = text.split("\n").filter(l => !ours.includes(l)).join("\n")   // Worker 가 붙인 「📎 이름: 서명 링크」 줄(파일 이름 · 서명 값)은 우리 것
    .replace(/https?:\/\/\S+/g, " ");
  return CHUNK.test(rest);
}

export type Plain = { rid: string; chan: string; thread: string; text: string; pane: string; body: Record<string, unknown> };
/** 이 몸통이 D1 먼저로 쓸 「보통 글」인가 — 아니면 null(예전 길). channels = cfg 스냅숏의 채널 키 */
export function plain(b: Record<string, unknown>, channels: string[], ours: string[] = []): Plain | null {
  for (const k of OTHER_KEYS) if (b[k] !== undefined && b[k] !== null && b[k] !== "" && b[k] !== false && !(Array.isArray(b[k]) && !(b[k] as unknown[]).length)) return null;
  const rid = String(b.rid ?? ""), chan = String(b.channel ?? ""), thread = String(b.thread ?? ""), ts = String(b.ts ?? "");
  if (!RID.test(rid) || !/^[\w-]{1,64}$/.test(rid) || !channels.includes(chan) || (thread && !TS.test(thread)) || (ts && ts !== thread)) return null;
  const text = Array.from(String(b.text ?? "").replace(CTRL_KEEP_NL, " ").replace(PY_STRIP, "")).slice(0, MAX).join("");   // server.py 와 같은 자르기(코드 포인트)
  if (!text || SECRET_REJECT.test(text) || maybeSecret(text, ours) || SYNC.some(r => r.test(text))) return null;   // 비밀일 수 있음 — 예전 길(위)
  if (/^[\[{]/.test(text)) return null;   // JSON 꼴 글: 파이썬 redact 는 비밀 이름 키 값을 통째로 가림(JS 정규식은 못 잡음) — 예전 길   // 비밀 꼴: 판에는 원문이 가야 해 할 일 줄에 원문이 남음 — 예전 길(owner-jobs.accept 와 같음)
  if (b.edit !== undefined || b._pre !== undefined) return null;   // 빈 고치기(edit: "")도 예전 길 · _pre 는 Worker 만 붙임
  const pane = String(b.pane ?? "");
  if (pane && !/^%\d+$/.test(pane)) return null;   // 쉬는 노드 자리 판(g:) 은 다시 열기가 끼어 예전 길
  return { rid, chan, thread, text, pane, body: b };
}

const newId = (now: number) => { const us = now * 1000 + Math.floor(Math.random() * 1000); return `${Math.floor(us / 1e6)}.${String(us % 1e6).padStart(6, "0")}`; };

export type Wrote = { mid: string; root: string; again: boolean };
// 같은 rid 다시 보냄: 그때 정한 글 id 를 f7_rid 「<rid>.p.<mid>.<root>」 줄로 찾음(member-board chatRidKey 와 같은 꼴 — 점은 rid 꼴에 없음, 같은 이틀 지우기)
const preKey = (rid: string, mid: string, root: string) => `${rid}.p.${mid}.${root}`;
export async function write(db: D1Database, p: Plain, now = Date.now()): Promise<Wrote | null> {
  const prev = async () => {
    const r = await db.prepare("SELECT rid FROM f7_rid WHERE rid > ? AND rid < ? LIMIT 1").bind(p.rid + ".p.", p.rid + ".p/").first<{ rid: string }>();
    const m = r ? /\.p\.(\d{10}\.\d{6})\.(\d{10}\.\d{6})$/.exec(r.rid) : null;
    return m ? { mid: m[1], root: m[2], again: true } : null;
  };
  if (!(await db.prepare("SELECT 1 FROM owner_job_beat WHERE id = 1 AND at > ?").bind(now - BEAT_MAX).first())) return null;   // 판에 넣을 쪽이 없음 — 예전 길
  // 스레드 값이 Slack ts 로 왔어도 우리 id 로(talk.resolve) · 전달 상자 글(source node-move)이면 원글로 바뀌어야 함 → 예전 길
  let thread: string | null = null;
  if (p.thread) {
    const t = await db.prepare("SELECT id, source FROM wl_talk_msg WHERE id = ?1 OR slack_ts = ?1 LIMIT 1").bind(p.thread).first<{ id: string; source: string }>();
    if (t?.source === "node-move") throw new Fallback("전달 상자 스레드");
    thread = t?.id || p.thread;
  }
  const blocks = JSON.stringify(textBlocks(mrkdwn(p.text)));
  for (let n = 0; n < 4; n++) {
    const mid = newId(now + n), root = thread || mid, at = (now + n) / 1000;
    const job = JSON.stringify({ ...p.body, text: p.text, thread: thread || "", _pre: { mid, root } });
    try {
      await db.batch([
        ridRow(db, p.rid),
        db.prepare("INSERT INTO f7_rid(rid, at) VALUES (?, ?)").bind(preKey(p.rid, mid, root), now),
        db.prepare("INSERT INTO wl_talk_msg(id, chan, thread, who, author, user, pane, text, blocks, at, source, ref) VALUES (?, ?, ?, 'owner', ?, NULL, NULL, ?, ?, ?, 'boarder', NULL)")
          .bind(mid, p.chan, thread, AUTHOR, p.text, blocks, at),
        db.prepare("INSERT INTO wl_talk_mirror(msg, op, payload, state, at) VALUES (?, 'post', ?, 'off', ?)")
          .bind(mid, JSON.stringify({ channel: p.chan, text: p.text, blocks: JSON.parse(blocks), username: AUTHOR, unfurl_links: false, unfurl_media: false, ...(thread ? { thread_ts: thread } : {}) }), at),
        db.prepare("INSERT INTO owner_job(rid, kind, okey, body, at) VALUES (?, '/api/chat', ?, ?, ?)").bind(p.rid, okeyOf("/api/chat", p.body, p.rid), job, now),
      ]);
      return { mid, root, again: false };
    } catch (e) {
      if (ridDup(e) || /UNIQUE constraint failed: owner_job/i.test(String((e as Error)?.message || e))) { const a = await prev(); if (a) return a; throw new Fallback("같은 rid 가 예전 길로 감"); }
      if (/UNIQUE constraint failed: wl_talk_msg/i.test(String((e as Error)?.message || e))) continue;   // id 겹침 — 다음 마이크로초로
      throw e;
    }
  }
  throw new Error("글 id 를 못 정함");
}
export class Fallback extends Error {}
