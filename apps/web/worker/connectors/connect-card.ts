/**
 * 연결 없음 · 끊김으로 서비스 도구가 실패하면 그 회원 채팅(보드 카드)에 「연결하기」 카드를 한 번만 올림.
 * 카드는 board_card 한 줄(kind = connect:<service>|<label>|<끊긴 연결 id>) — 단추 하나, 누르면 화면이 동의 모달을 열고 POST /api/connections 의 authUrl 로 감.
 * 같은 서비스의 열린 카드가 10분 안에 있으면 새로 안 올리고(한 문장 INSERT … WHERE NOT EXISTS — 동시 호출도 한 장), 10분 넘은 것은 만료로 닫음.
 * 열쇠(API 키) 꼴 서비스는 카드로 못 함(OAuth 로그인 꼴만) — 설정 안내만. 답에 비밀값 없음.
 */
import { SEP } from "./naming";
import { PRESETS, TITLES } from "./presets";
import { API_PRESETS, apiReady } from "./apis";
import * as store from "./store";

export const CONNECT_TTL = 10 * 60_000;
export const CONNECT_BUTTON = "연결하기";
const KIND = /^connect:([a-z0-9][a-z0-9-]{0,39})\|([a-z0-9_-]{0,24})\|(c_[0-9a-f]{20})?$/;
export const connectKind = (service: string, label: string, rid: string) => `connect:${service}|${label}|${rid}`;
/** 카드 kind → 단추에 붙일 연결 대상(아니면 null) */
export const parseConnectKind = (kind: unknown) => { const m = KIND.exec(String(kind || "")); return m ? { service: m[1], label: m[2], reconnect: m[3] || undefined } : null; };

const GONE = /연결이 끊겼|^없는 도구/;
const cardId = (now: number) => `${Math.floor(now / 1000)}.${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`;
const own = (o: object, k: string) => Object.hasOwn(o, k);   // constructor · toString 같은 이름이 표를 통과하지 않게
export const titleOf = (service: string) => own(TITLES, service) ? TITLES[service] : own(API_PRESETS, service) ? API_PRESETS[service].title : service;
/** 구글 캘린더 · Gmail · GitHub 앱 같은 로그인(OAuth) 꼴 API 서비스 — 연결은 {api:{preset}} 로(설정 화면 data-aoauth 와 같음) */
/** 두 표에 다 있는 서비스(slack 등)는 MCP 길(PRESETS 먼저)로 가므로 제외 — targetOf · cardMsg 가 같은 판정을 씀 */
export const oauthApi = (service: string) => !own(PRESETS, service) && own(API_PRESETS, service) && API_PRESETS[service].spec.auth.type === "oauth";

/** 동의 모달의 「무엇을 읽는지」 한 줄 — 모르는 서비스는 일반 글(권한은 로그인 화면이 따로 보여 줌) */
const READS: Record<string, string> = Object.assign(Object.create(null), { github: "저장소 · 이슈 · 풀 리퀘스트", linear: "이슈 · 프로젝트 · 팀", notion: "연결한 페이지 · 데이터베이스", slack: "내가 볼 수 있는 채널 글", gmail: "받은 편지함의 메일(읽기만)", "google-calendar": "일정", gitlab: "프로젝트 · 이슈", sentry: "프로젝트의 오류", figma: "열람 가능한 파일", posthog: "프로젝트의 분석 값", stripe: "결제 · 고객 정보" });
export const readsOf = (service: string) => `${READS[service] || "연결한 계정의 정보"}을(를) 읽어요. 연결은 설정에서 언제든 끊을 수 있어요.`;

type Target = { service: string; label: string; reconnect: string; title: string };

/** 도구 이름 → 연결할 서비스. 연결이 이미 정상이거나(도구 이름만 틀림) 로그인 꼴이 아니면 null */
export async function targetOf(env: store.Env, owner: string, tool: string): Promise<Target | null> {
  const parts = tool.split(SEP); if (parts.length < 2) return null;
  const service = parts[0], label = parts.length >= 3 ? parts[1] : "";
  const rows = (await store.list(env, owner)).filter(r => r.service === service && (!label || r.label === label));
  if (rows.length) {
    if (rows.some(r => r.status !== "expired")) return null;   // 정상 · 일시 오류 연결은 도구 이름 문제 — 카드 아님
    const r = rows[0];
    if (r.kind === "api" && (await store.apiAuth(env, r)).spec?.auth.type !== "oauth") return null;   // 키 꼴 API 는 키를 다시 넣음(설정)
    return { service, label: r.label, reconnect: r.id, title: titleOf(service) };
  }
  if (own(PRESETS, service) || oauthApi(service) && apiReady(env as unknown as Record<string, never>, service, owner).ready) return { service, label, reconnect: "", title: titleOf(service) };
  return null;
}

/**
 * 실패한 도구 호출 하나 → 카드(없으면 올림) + 에이전트에게 덧붙일 안내. 회원이 아니거나 해당 없으면 null.
 * card = 알림 훅(있으면)
 */
export async function offerConnect(c: { env: store.Env; owner: string; card?: (card: { id: string; question: string }) => void }, tool: string, err: unknown, now = Date.now()): Promise<string | null> {
  const msg = err instanceof Error ? err.message : String(err);
  if (!c.owner || !GONE.test(msg) || !c.card) return null;
  const t = await targetOf(c.env, c.owner, tool); if (!t) return null;
  const q = `「${t.title}」에 연결해 주세요`, id = cardId(now), kind = connectKind(t.service, t.label, t.reconnect);
  const db = c.env.DB;
  const [, ins] = await db.batch([
    db.prepare("UPDATE board_card SET state = 'closed', done = '만료' WHERE owner = ? AND state = 'open' AND kind LIKE 'connect:%' AND at < ?").bind(c.owner, now - CONNECT_TTL),
    db.prepare("INSERT INTO board_card(id, owner, win, kind, question, choices, recommend, body, at) SELECT ?,?,?,?,?,?,NULL,?,? WHERE NOT EXISTS (SELECT 1 FROM board_card WHERE owner = ? AND state = 'open' AND kind LIKE ? ESCAPE '\\' AND at >= ?)")
      .bind(id, c.owner, "보더", kind, q, JSON.stringify([CONNECT_BUTTON]),
        `에이전트가 ${t.title} 도구를 쓰려는데 ${t.reconnect ? "연결이 끊겨" : "아직 연결이 없어"} 멈췄어요. 「${CONNECT_BUTTON}」을 누르면 ${t.title} 로그인 화면으로 가요. 10분 안에 연결하면 에이전트가 이어서 해요.`, now,
        c.owner, `connect:${t.service}|%`, now - CONNECT_TTL),
  ]);
  if (ins.meta.changes) c.card?.({ id, question: q });
  return `${t.title} 연결이 필요해요 — 보더 채팅의 「${CONNECT_BUTTON}」 카드에서 사람이 연결하면 다시 불러요(이 도구를 반복해서 부르지 않기)`;
}
