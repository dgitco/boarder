import { SECRET_PATTERNS } from "../session/redact";

export const MARK = "[가림]";
export type Reject = "pem" | "jwt" | "env" | "residue" | "long";
export type Filtered = { text: string; redacted: number } | { reject: Reject };
export const MAX_FIELD = 8000;

const NAMES = "(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|KEK|HMAC|CREDENTIAL|SIGNING_?KEY|ENCRYPTION_?KEY)";
const NAME_AROUND = `[A-Za-z0-9_]{0,80}${NAMES}[A-Za-z0-9_]{0,80}`;

const PEM = /-----BEGIN [A-Z0-9 ]{0,30}PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,200}?(?:-----END [A-Z0-9 ]{0,30}PRIVATE KEY(?: BLOCK)?-----|[A-Za-z0-9+/=]{40})/;
const JWT = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,2048}/;

// 자리표 — 이름만 보이고 값은 없는 꼴은 가리지 않음: API_KEY=<값> · <your_api_key> · ${TOKEN} · ${{ secrets.X }} · {{secret}} · ***
//   · 다른 비밀 이름만 적은 값(SECRET_NAME=OPENAI_API_KEY — 대문자 · 밑줄 이름에 비밀 낱말이 든 것만, HUNTER2_PASS99 는 값으로 봄). 꺾쇠 안은 소문자 · 한글 낱말 꼴만(<Hunter2Pass99> 는 값)
const PLACEHOLDER = /^(?:<[a-z가-힣ㄱ-ㅣ _.\-…]{1,40}>|<[A-Z][A-Z0-9_]{0,40}>|\$\{\{[^{}]{1,60}\}\}|\$\{[^{}]{1,60}\}|\{\{[^{}]{1,60}\}\}|\*+|x{4,}|X{4,}|\[가림\]|\[secret\])$/;
const ENV_NAME = new RegExp(`^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$`), HAS_NAME = new RegExp(NAMES, "i");
const isPlaceholder = (m: string) => PLACEHOLDER.test(m) || (ENV_NAME.test(m) && HAS_NAME.test(m));
const BENIGN = /^(?:\d+|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)$/;
const META = new Set(["COUNT", "TTL", "LIMIT", "MAX", "MIN", "LEN", "LENGTH", "SIZE", "USAGE", "USED", "BUDGET", "NUM", "RATE", "EXPIRY", "EXPIRE", "EXPIRES", "TIMEOUT", "VERSION", "TYPE", "MODE", "FORMAT", "ALG", "ALGO", "FIELD", "FIELDS", "KIND"]);
const SECRET_WORDS = /^(?:PASSWORD|PASSWD|PASS|PWD|PW|SECRET|SECRETS|KEY|KEYS|APIKEY|KEK|HMAC|CREDENTIAL|CREDENTIALS|PRIVATE|SIGNING|ENCRYPTION|TOKEN|TOKENS)$/;
const TOKEN_COUNT_WORDS = new Set(["MAX", "MIN", "NUM", "COUNT"]), TOKENS_COUNT_WORDS = new Set(["MAX", "MIN", "NUM", "COUNT", "TOTAL", "INPUT", "OUTPUT", "PROMPT", "COMPLETION", "CACHED", "REASONING"]);
const metaName = (name: string) => {
  const w = name.split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean).map(x => x.toUpperCase());
  if (META.has(w.at(-1) ?? "")) return true;
  const last = w.at(-1) ?? "";
  const prev = w.at(-2) ?? "", rest = w.slice(0, -1).every(x => !SECRET_WORDS.test(x));
  return rest && ((last === "TOKEN" && TOKEN_COUNT_WORDS.has(prev)) || (last === "TOKENS" && TOKENS_COUNT_WORDS.has(prev))) ? "tokens" : false;
};
const benign = (m: string) => /^\d+$/.test(m) || (BENIGN.test(m) && m.split("-").every(p => /^[A-Za-z]+$/.test(p) || /^\d+$/.test(p) || p.length <= 3));

// 공용 꼴(session/redact.ts) 가운데 뒤돌아보기가 없는 것은 그대로, 뒤돌아보기가 있는 셋(Bearer · 주소 비밀번호 · 이름=값)은 상한 있는 판으로
export const SHARED_KEPT = SECRET_PATTERNS.filter(re => !re.source.includes("(?<="));
const BEARER = /(?<=\bbearer\s{1,8})[A-Za-z0-9._~+\/=-]{16,}/gi;   // 소문자 bearer 도(HTTP 머리 이름은 대소문자 안 가림)
const URL_PW = /(?<=:\/\/[^\s/:@]{1,64}:)[^\s/@]{6,256}(?=@)/g;
const KEYVAL = new RegExp(`(?<=\\b(${NAME_AROUND})["']?\\s{0,16}(?::=|=>|[:=])(?:\\s{0,4}[=>]){0,4}\\s{0,16}["']?)(?![=>])[^\\s"'\`,;]{8,}`, "gi");
const PART = "(?:은|는|이|가|을|를)?";
const KO_PW = `(?:비밀번호|비번|암호|패스워드|패스코드|인증번호|인증키|접속키|비밀키|시크릿|API ?키)${PART}`;
const KO_TOK = `토큰${PART}`;
const KO_VAL = "[^\\s가-힣ㄱ-ㅎㅏ-ㅣ\"'「」『』()\\[\\]<>{}$,;]";
const KO_SEP = new RegExp(`(?<=${KO_PW}\\s{0,8}[:=：]\\s{0,8}["'「]?)${KO_VAL}{4,}`, "g");
const KO_SPACE = new RegExp(`(?<=${KO_PW}\\s{1,8}["'「]?)(?=${KO_VAL}{0,200}\\d)${KO_VAL}{6,}`, "g");
const KO_TOK_ANY = new RegExp(`(?<=${KO_TOK}\\s{0,8}[:=：]?\\s{0,8}["'「]?)(?=${KO_VAL}{0,200}[A-Za-z])(?=${KO_VAL}{0,200}\\d)${KO_VAL}{8,}`, "g");
const QUOTED_ANY = `(?:"[^"\\n]{1,200}"|'[^'\\n]{1,200}'|“[^”\\n]{1,200}”|‘[^’\\n]{1,200}’|「[^」\\n]{1,200}」)`;
const QUOTED = `${QUOTED_ANY}(?!(?<=[^A-Za-z0-9_]${NAME_AROUND}["'”’」])\\s{0,4}[:=：])`;
const NAME_END = new RegExp(`(?:^|[^A-Za-z0-9_])${NAME_AROUND}$`, "i");
const Q_SEP = `["']?\\s{0,16}(?:=>|:=|[:=：])\\s{0,16}`, Q_SP = `\\s{1,16}`;
//   붙은 꼴(password"x" · 비밀번호「x」로)도 받되, 닫는 따옴표 바로 뒤에 구분 기호 · 빈칸이 오는 자리(JSON 「": 」)는 값으로 안 잡음
const Q_NOT_CLOSE = `(?!["'][\\s:=：,\\]})])`;   // 사이가 빈 경우에만 — 배열 「["password", "token"]」 도
const Q_PW_NAME = `(?:${KO_PW}|\\bpw|\\bpasswd|\\bpassword(?:\\s{1,4}is)?)`;
const Q_PW = new RegExp(`(?:(?<=${Q_PW_NAME}(?:${Q_SEP}|${Q_SP}))|(?<=${Q_PW_NAME})${Q_NOT_CLOSE})${QUOTED}`, "gi");
const Q_NAME = new RegExp(`(?:(?<=(${KO_TOK}|\\b${NAME_AROUND})${Q_SEP})|(?<=(${KO_TOK}|\\b${NAME_AROUND}))${Q_NOT_CLOSE})${QUOTED}`, "gi");
const Q_NAME_SP = new RegExp(`(?<=(${KO_TOK}|\\b${NAME_AROUND})${Q_SP})${QUOTED}`, "gi");
const inner = (m: string) => m.slice(1, -1).trim();
const quotedValue = (m: string) => /[^\s가-힣ㄱ-ㅣ]/.test(inner(m)) && !isPlaceholder(inner(m));

const DOB = "\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])";
const RRN = new RegExp(`(?<![\\d-])${DOB}\\s?[-–—]\\s?[1-8]\\d{6}(?![\\d-])`, "g");
const RRN_NEAR = new RegExp(`(?<=(?:주민|생년월일|등록번호)[^\\d\\n]{0,12})(?<!\\d)${DOB}[1-8]\\d{6}(?!\\d)`, "g");
//   카드: 4-4-4-4(하이픈) + Luhn, 공백 · 맨 16자리는 「카드 · 신용 · 체크」 낱말 곁만 — 「PR 7109 7111 7113 7125」 통과
const CARD = /(?<![\d-])\d{4}-\d{4}-\d{4}-\d{4}(?![\d-])/g;
const CARD_NEAR = /(?<=(?:카드|신용|체크)[^\d\n]{0,12})(?<![\d-])\d{4} ?\d{4} ?\d{4} ?\d{4}(?![\d-])/g;
const luhn = (m: string) => { const d = m.replace(/\D/g, ""); let s = 0; for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } s += n; } return s % 10 === 0; };
//   계좌: 「은행 · 계좌 · 입금 · 송금 · 이체」 낱말이나 은행 이름(신한 · 국민 · 우리 · 하나 · 농협 · 기업 · 카카오뱅크 …) 곁의 하이픈 묶음(세 · 네 덩어리, 숫자 10~16자리)만 — 맨 숫자 · 전화(0…-…-…) · 사업자번호(3-2-5) · 날짜는 뺌
const ACCT = /(?<=(?:은행|계좌|입금|송금|이체|신한|국민|우리|하나|농협|기업|카카오뱅크|케이뱅크|토스뱅크|새마을|우체국|수협|신협|SC제일|씨티|부산|대구|경남|광주|전북|제주)[^\d\n]{0,20})(?<![\d-])\d{2,6}(?:-\d{2,8}){2,3}(?![\d-])/g;
const acct = (m: string) => { const n = m.replace(/\D/g, "").length, g = m.split("-");
  return n >= 10 && n <= 16 && !/^0\d{1,2}-\d{3,4}-\d{4}$/.test(m) && !/^\d{3}-\d{2}-\d{5}$/.test(m) && !(g[0].length === 4 && +g[1] >= 1 && +g[1] <= 12 && g[2]?.length === 2); };

const metaOk = (v: string, name: string) => { const k = metaName(name); return k === true ? benign(v) : k === "tokens" ? /^\d+$/.test(v) : false; };
const okQuoted = (m: string, name: string) => quotedValue(m) && !((name.startsWith("토큰") && benign(inner(m))) || metaOk(inner(m), name));
const okQuotedSp = (m: string, name: string) => okQuoted(m, name) && !(benign(inner(m)) && /^[a-z]+$/.test(name) && /[A-Za-z]/.test(inner(m)));
const okKeyval = (m: string, name: string) => !metaOk(m, name);
const RULES: [RegExp, ((m: string, name: string) => boolean)?, boolean?][] = [
  ...SHARED_KEPT.map(re => [re] as [RegExp]), [BEARER], [URL_PW],
  [Q_PW, quotedValue], [Q_NAME, okQuoted, true], [Q_NAME_SP, okQuotedSp, true],   // 따옴표 통째 — 낱말 하나만 보는 꼴보다 먼저
  [KEYVAL, okKeyval, true],
  [KO_SEP], [KO_SPACE], [KO_TOK_ANY, m => !benign(m)],
  [RRN], [RRN_NEAR], [CARD, luhn], [CARD_NEAR, luhn], [ACCT, acct],
];
const hit = (m: string, ok?: (m: string, name: string) => boolean, name = "") => !isPlaceholder(m) && (!ok || ok(m, name));
// 갈래 이름: 뒤돌아보기 안 갈래 가운데 잡힌 것(Q_NAME 은 갈래가 둘)
const groupName = (g: unknown[]) => (g.find(x => typeof x === "string") as string | undefined) ?? "";

const PW_NAME = `(?:${KO_PW}|\\bpw|\\bpasswd)`;   // 따옴표 값이면 늘 가리는 이름(Q_PW 와 같음 — password 는 NAME_AROUND 로도 걸림)
const NAME_SEP = new RegExp(`(?:(${PW_NAME}|${KO_TOK})|\\b(${NAME_AROUND}))(?:\\s{1,4}is)?(?:["']?\\s{0,16}(?:=>|:=|[:=：])(?:\\s{0,4}[=>]){0,4}\\s{0,16}|\\s{1,16}(?=["'“‘「]))`, "gi");
const CLOSE: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’", "「": "」" };
type Named = { name: string; sep: string; value: string; quoted: boolean; spaceOnly: boolean; pw: boolean; en: boolean };
function namedValues(raw: string): Named[] {
  const out: Named[] = [];
  for (const m of raw.matchAll(NAME_SEP)) {
    const name = m[1] ?? m[2], en = m[2] !== undefined, pw = !en && !name.startsWith("토큰") || /^password$/i.test(name);
    const sep = m[0].slice(name.length), at = m.index! + m[0].length, spaceOnly = !/[:=：]/.test(m[0].slice(name.length)), head = raw.slice(at, at + 4096);
    const q = CLOSE[head[0]], end = q ? head.indexOf(q, 1) : -1;
    if (q && end > 1 && end <= 201 && !head.slice(1, end).includes("\n") && !(/^\s{0,4}[:=：]/.test(head.slice(end + 1)) && NAME_END.test(head.slice(0, end)))) { out.push({ name, sep, value: head.slice(0, end + 1), quoted: true, spaceOnly, pw, en }); continue; }
    if (spaceOnly || !en) continue;   // 따옴표 없는 값은 영문 이름 = 값만(한국어 낱말 뒤 맨 값은 KO_SEP · KO_SPACE 몫) · 닫히지 않은 따옴표는 따옴표 없는 값으로 읽음
    const v = /^["']?([^\s"'`,;]{8,})/.exec(head); if (v) out.push({ name, sep, value: v[1], quoted: false, spaceOnly, pw, en });
  }
  return out;
}
const shouldMask = (x: Named) => x.quoted ? (x.pw ? hit(x.value, quotedValue) : hit(x.value, x.spaceOnly ? okQuotedSp : okQuoted, x.name)) : hit(x.value, okKeyval, x.name);
const assigns = (s: string) => namedValues(s).filter(x => x.en && !x.spaceOnly && shouldMask(x)).length;

function maskSecrets(s: string): { s: string; n: number } {
  let n = 0;
  for (const [re, ok, grp] of RULES) s = s.replace(re, (m: string, ...g: unknown[]) => (hit(m, ok, grp ? groupName(g) : "") ? (n++, MARK) : m));
  return { s, n };
}
const leftover = (s: string) => RULES.some(([re, ok, grp]) => [...s.matchAll(re)].some(m => hit(m[0], ok, grp ? groupName(m.slice(1)) : "")));
// 원문 기준으로 가릴 값 가운데 거른 글에 그대로 남은 것(값 글자 그대로)
//   따옴표 값은 안쪽 글자로 봄 — 앞 따옴표 값이 다음 값의 여는 따옴표까지 먹은 꼴(「비밀번호": "x" 비밀번호 "y z"」)에서 안쪽만 남는 일
const bare = (x: Named) => (x.quoted ? x.value.slice(1, -1) : x.value);
const residueAt = (raw: string, out: string) => namedValues(raw).filter(x => shouldMask(x) && bare(x).trim().length >= 4 && out.includes(bare(x)) && (maskAt(out, x) !== null || !markedAt(out, x)));
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const maskAt = (s: string, x: Named): string | null => {
  const re = new RegExp(`(${esc(x.name)}${esc(x.sep)}["'“‘「]?)${esc(bare(x))}`, "i"), m = re.exec(s);
  return m ? s.slice(0, m.index) + m[1] + MARK + s.slice(m.index + m[0].length) : null;
};
const markedAt = (s: string, x: Named) => new RegExp(`${esc(x.name)}${esc(x.sep)}["'“‘「]?${esc(MARK)}`, "i").test(s);
const rejectOf = (s: string): Reject | null => PEM.test(s) ? "pem" : JWT.test(s) ? "jwt" : assigns(s) >= 3 ? "env" : null;

/** 글 하나 거르기 — 거절 까닭 또는 거른 글 · 가린 개수. 전화는 저장 때 안 가림(읽을 때 registry view.mask 가 가림) */
export function filterText(raw: string): Filtered {
  if (raw.length > MAX_FIELD) return { reject: "long" };
  const why = rejectOf(raw); if (why) return { reject: why };
  let { s, n } = maskSecrets(raw);
  if (leftover(s)) { const again = maskSecrets(s); s = again.s; n += again.n; }   // 가린 뒤 다시 검사(같은 꼴)
  for (const x of residueAt(raw, s)) { const t = maskAt(s, x); if (t !== null) { s = t; n++; } }   // 다른 길: 원문의 「비밀 이름 → 값」 짝으로 다시 — 그 이름 바로 뒤 한 자리만
  if (leftover(s) || residueAt(raw, s).length || rejectOf(s)) return { reject: "residue" };
  return { text: s, redacted: n };
}

const MSG: Record<Reject, string> = {
  pem: "비밀 열쇠(PEM 블록) 꼴이 들어 있어 저장하지 않았어요 — 값을 빼고 다시 보내 주세요",
  jwt: "토큰(JWT) 꼴이 들어 있어 저장하지 않았어요 — 값을 빼고 다시 보내 주세요",
  env: "비밀 설정 값(이름=값)이 여럿 들어 있어 저장하지 않았어요 — 값을 빼고 다시 보내 주세요",
  residue: "비밀값 꼴을 다 가리지 못해 저장하지 않았어요 — 값을 빼고 다시 보내 주세요",
  long: "글이 너무 길어 저장하지 않았어요 — 나눠서 보내 주세요",
};
export class LogRejected extends Error { constructor(readonly why: Reject) { super(MSG[why]); } }

/** 쓰기 도구 입력의 글 칸을 깊게 거름(noMask 이름의 칸 — 경로 · id · 노드 이름 — 은 그대로) — 거절이면 LogRejected(원문 없는 고정 문장) */
export function filterArgs<T>(a: T, noMask: ReadonlySet<string> = new Set()): { args: T; redacted: number } {
  let redacted = 0;
  const one = (v: string) => { const f = filterText(v); if ("reject" in f) throw new LogRejected(f.reject); redacted += f.redacted; return f.text; };
  const walk = (v: unknown): unknown => typeof v === "string" ? one(v) : Array.isArray(v) ? v.map(walk)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noMask.has(k) ? x : walk(x)])) : v;
  return { args: walk(a) as T, redacted };
}
/** 옛 이름(inbox_log · inbox_status 글 칸) — filterArgs 와 같음 */
export const filterLogArgs = <T extends Record<string, any>>(a: T) => filterArgs(a);
