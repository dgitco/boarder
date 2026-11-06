import { filterText as filterMain, type Filtered } from "./log-filter-769";

type Span = [number, number];

// 바닥 ② — 운영판(29df3fe4d^ 의 session/redact.ts SECRET_PATTERNS · redact) 그대로 옮김(지금 session/redact.ts 와 같지만 그 파일이 바뀌어도 바닥은 그대로).
//   시간만 고침: 뒤돌아보기 셋(Bearer · 주소 비밀번호 · 이름=값) 앞에 값 첫 글자들 앞보기를 붙임 — 맞는 자리는 같고(둘 다 폭 없는 검사), 긴 빈칸 · 줄바꿈의
//   자리마다 뒤돌아보기가 빈칸을 다시 훑던 것(빈칸 8,000자 144ms)을 그 자리에서 바로 떨굼. 이름=값 꼴엔 이름 · 사이 갈래만 더함(맞는 자리는 같음)
const NAMES = "(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|KEK|HMAC|CREDENTIAL|SIGNING_?KEY|ENCRYPTION_?KEY)";
const PROD_SHAPES: RegExp[] = [
  /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant|or)?[-_]?[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, /\bxapp-[0-9]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bya29\.[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b0B(?:-[A-Z2-7]{4}){13}\b/g,
  /\b0b_[A-Za-z0-9_-]{20,}/g,
  /\bbx[a-z]_[A-Za-z0-9_-]{20,}/g,
  /(?=[A-Za-z0-9._~+\/=-]{16})(?<=\bBearer\s+)[A-Za-z0-9._~+\/=-]{16,}/g,
  /(?=[^\s/@]{6})(?<=:\/\/[^\s/:@]+:)[^\s/@]{6,}(?=@)/g,
];
const PROD_KEYVAL = new RegExp(`(?=[^\\s"'\`,;]{8})(?<=\\b([A-Za-z0-9_]*${NAMES}[A-Za-z0-9_]*)(["']?\\s*[:=]\\s*["']?))[^\\s"'\`,;]{8,}`, "gi");
const PROD_MARK = "[secret]";

/** 새 판의 값 판정 — (값, 이름, 사이) 가 가릴 값이면 true */
export type Gate = (value: string, name: string, sep: string) => boolean;

const UP = "[A-Z]{1,12}\\d{0,2}", LOW = "[a-z]{1,12}";
const ENV_LIKE = new RegExp(`^${UP}(?:_${UP})*$`);
const LOW_LIKE = new RegExp(`^(?:${LOW}(?:_${LOW}\\d{0,2})*|${LOW}(?:[A-Z][a-z]{1,12})+\\d{0,2})$`);
const word = (t: string) => ENV_LIKE.test(t) || LOW_LIKE.test(t);
const dotted = (t: string) => t.split(".").every(word);
const SECRET_IN = /SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|KEK|HMAC|CREDENTIAL|SIGNING_?KEY|ENCRYPTION_?KEY/;
const ANGLE_WORDS = /^(?:[a-z]{1,12}|[가-힣ㄱ-ㅣ]{1,12}|…)(?:[ _.\-](?:[a-z]{1,12}|[가-힣ㄱ-ㅣ]{1,12}|…))*$/;
const trimTail = (v: string) => v.replace(/[)\];,.]+$/, "");
/** 바닥에서 자리표로 보는 꼴 — ${이름}(기본값 없음) · ${{ 이름 }} · {{ 이름 }} · <이름 · 낱말> · *** · xxxx · [가림], 맨 값은 비밀 낱말 든 대문자 이름(OPENAI_API_KEY) */
export function floorPlaceholder(v: string): boolean {
  const t = trimTail(v);
  if (/^(?:\*+|x{4,}|X{4,}|\[가림\]|\[secret\])$/.test(t)) return true;
  let m = /^\$\{([^{}]{1,60})\}$/.exec(t);
  if (m) { const k = /^([A-Za-z_][\w.]*)(?::?[-=?+](.*))?$/.exec(m[1]); return !!k && dotted(k[1]) && (k[2] === undefined || k[2] === "" || floorPlaceholder(k[2])); }
  m = /^\$?\{\{\s*\.?([^{}]{1,60}?)\s*\}\}$/.exec(t); if (m) return dotted(m[1]);   // helm 「{{ .Values.token }}」 의 앞 점도
  m = /^<([^<>]{1,40})>$/.exec(t); if (m) return ENV_LIKE.test(m[1]) || ANGLE_WORDS.test(m[1]);
  return t.includes("_") && ENV_LIKE.test(t) && SECRET_IN.test(t);
}
/** 바닥에서 코드 꼴로 보는 값(== · => 뒤에만 씀) — 맨 낱말(undefined · null …) · 이름과 같은 낱말 · 머리가 이름 · process · this · self 이고 뒤 마디가 이름 꼴인 점 식별자 */
export function floorCode(v: string, name: string): boolean {
  const t = trimTail(v), n = name.toLowerCase();
  if (/^(?:undefined|null|true|false|nil|none|empty|blank|nullorempty|isempty)$/i.test(t) || t.toLowerCase() === n) return true;
  const m = /^([A-Za-z_$][\w$]*)((?:\.[\w$]+)+)(?:\(\)?)?$/.exec(t);
  return !!m && (m[1].toLowerCase() === n || ["process", "this", "self"].includes(m[1].toLowerCase())) && m[2].slice(1).split(".").every(word);
}

export function prodSpans(raw: string, gate: Gate): Span[] {
  let s = raw, a = Array.from({ length: raw.length }, (_, i) => i), b = a.map(i => i + 1);
  const spans: Span[] = [];
  const pass = (re: RegExp, keep: (m: RegExpMatchArray) => boolean) => {
    let out = "", na: number[] = [], nb: number[] = [], at = 0, any = false;
    for (const m of s.matchAll(re)) {
      const x = m.index!, y = x + m[0].length; if (y === x) continue;
      any = true;
      out += s.slice(at, x); na.push(...a.slice(at, x)); nb.push(...b.slice(at, x));
      const sa = a[x], sb = b[y - 1]; if (keep(m)) spans.push([sa, sb]);
      out += PROD_MARK; for (let k = 0; k < PROD_MARK.length; k++) { na.push(sa); nb.push(sb); }
      at = y;
    }
    if (!any) return;
    s = out + s.slice(at); a = na.concat(a.slice(at)); b = nb.concat(b.slice(at));
  };
  for (const re of PROD_SHAPES) pass(re, () => true);
  pass(PROD_KEYVAL, m => { const lead = /^[=>:]*/.exec(m[0])![0], v = m[0].slice(lead.length); return gate(v, m[1] ?? "", (m[2] ?? "") + lead); });
  return spans;
}
export function redactProd(text: string): string {
  let s = text;
  for (const re of [...PROD_SHAPES, PROD_KEYVAL]) s = s.replace(re, PROD_MARK);
  return s;
}

/**
 * 거른 글(out)이 원문(raw)의 어느 구간을 표지(mark)로 바꿨는지 — 거른 글 = 원문 조각 L0 · 표지 · L1 · 표지 · … · Ln(조각은 원문 순서대로, 표지 하나가 원문 구간 하나).
 * 조각이 원문 여러 곳에 맞을 수 있어(같은 글귀 되풀이) 둘레를 넉넉히: 앞 조각은 가장 이른 자리, 뒤 조각은 가장 늦은 자리로 놓아 그 사이 전부를 가린 구간으로 봄 —
 * 참 구간을 늘 담음(덜 가리는 일 없음). 원문의 자리표 「[가림]」은 그 글자 구간으로 나옴(다시 가려도 같은 글). 맞출 수 없으면 null(그때는 거절).
 */
export function maskedSpans(raw: string, out: string, mark: string): Span[] | null {
  const L = out.split(mark), n = L.length - 1;
  if (n === 0) return out === raw ? [] : null;
  if (!raw.startsWith(L[0]) || !raw.endsWith(L[n])) return null;
  const early: number[] = [L[0].length];   // 조각마다 가장 이른 자리의 끝
  for (let i = 1; i < n; i++) { const at = raw.indexOf(L[i], early[i - 1] + 1); if (at < 0) return null; early.push(at + L[i].length); }
  const late: number[] = new Array(n + 1);   // 조각마다 가장 늦은 자리의 시작
  late[n] = raw.length - L[n].length;
  for (let i = n - 1; i >= 1; i--) { const from = late[i + 1] - 1 - L[i].length; const at = from < 0 ? -1 : raw.lastIndexOf(L[i], from); if (at < 0) return null; late[i] = at; }
  const spans: Span[] = [];
  for (let i = 1; i <= n; i++) { const x = early[i - 1], y = late[i]; if (y <= x) return null; spans.push([x, y]); }
  return spans;
}
const merge = (xs: Span[]): Span[] => {
  const s = [...xs].sort((p, q) => p[0] - q[0] || p[1] - q[1]), out: Span[] = [];
  for (const [x, y] of s) { const t = out.at(-1); if (t && x <= t[1]) t[1] = Math.max(t[1], y); else out.push([x, y]); }
  return out;
};
const covered = (xs: Span[], by: Span[]) => xs.every(([x, y]) => by.some(([c, d]) => c <= x && y <= d));

/**
 * 새 거르개 결과(own)에 바닥 둘을 합침 — own 이 거절이면 그대로, main 판이 거절하면 그 까닭으로 거절, 아니면 세 판의 가린 구간 합집합을 가린 글.
 * 바닥이 더 가린 것이 없으면 own 그대로(글 · 개수 같음).
 */
export function withFloor(raw: string, own: Filtered, mark: string, gate: Gate): Filtered {
  if ("reject" in own) return own;
  const m = filterMain(raw);
  if ("reject" in m) return m;
  const mine = maskedSpans(raw, own.text, mark), main = maskedSpans(raw, m.text, mark);
  if (!mine || !main) return { reject: "residue" };
  const prod = prodSpans(raw, gate), have = merge(mine);
  if (covered(main, have) && covered(prod, have)) return own;
  const all = merge([...mine, ...main, ...prod]);
  let s = "", at = 0;
  for (const [x, y] of all) { s += raw.slice(at, x) + mark; at = y; }
  return { text: s + raw.slice(at), redacted: Math.max(own.redacted, all.length) };
}
