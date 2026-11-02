import { readFileSync } from 'node:fs';
import path from 'node:path';

// 허용 목록이 아니라 뒤집어서: 첫 8KB 에 NUL 이 든 파일(그림 · 글꼴 · 영상 · 소리 · pdf …)만 건너뛰고, 나머지(.py .sh .ts .log 확장자 없음 …)는 전부 검사
const hasNul = head => typeof head === 'string' ? head.slice(0, 8192).includes('\0') : head.subarray(0, 8192).includes(0);
// 확장자는 안 봄 — 글을 x.png 로 이름만 바꿔 검사를 피하지 못하게
const isBinary = (_name, head) => hasNul(head);
const DATA_URI = /data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g;   // base64 그림 · 글꼴은 건너뜀(안에 숫자 열이 우연히 있음)
const ctx = (s, i, re) => re.test(s.slice(Math.max(0, i - 120), i));   // 앞 120자 안 낱말

// ── 주민번호: 6-7자리, 뒤 첫 자리 1~4, 날짜 맞음, 검증 숫자
function daysIn(y, m) { return m === 2 ? (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31; }
export function validRrn(a, b) {
  const g = +b[0], yy = +a.slice(0, 2), mm = +a.slice(2, 4), dd = +a.slice(4, 6);
  if (g < 1 || g > 4 || mm < 1 || mm > 12) return false;
  const y = (g <= 2 ? 1900 : 2000) + yy;
  if (dd < 1 || dd > daysIn(y, mm)) return false;
  const d = (a + b).split('').map(Number), w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  const sum = w.reduce((s, x, i) => s + x * d[i], 0);
  return (11 - (sum % 11)) % 10 === d[12];
}
// ── 카드번호: Luhn
export function luhn(digits) {
  let s = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let n = +digits[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; }
  return s % 10 === 0;
}
const isDate = (a, b, c) => a.length === 4 && b.length === 2 && c.length === 2 && +b >= 1 && +b <= 12 && +c >= 1 && +c <= daysIn(+a, +b);

const RE_RRN = /(?<![\d-])(\d{6})-(\d{7})(?![\d-])/g;
const RE_CARD = /(?<![\d-])(\d{4}-\d{4}-\d{4}-\d{4}|\d{16})(?![\d-])/g;
const RE_ACCT = /(?<![\d-])(\d{2,6})-(\d{2,6})-(\d{2,8})(?![\d-])/g;
const CARD_WORD = /카드|신용|체크|승인번호/, BANK_WORD = /은행|계좌/;
const SECRET_PREFIX = [
  /(?<![A-Za-z0-9_])sk-ant-[A-Za-z0-9_-]{20,512}/g,                                   // Anthropic
  /(?<![A-Za-z0-9_])sk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,512}/g,                    // OpenAI
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36,255}/g, /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,255}/g,  // GitHub 개인 · 기타 토큰
  /(?<![A-Za-z0-9_])xox[bparso]-[A-Za-z0-9-]{10,255}/g, /(?<![A-Za-z0-9_])xapp-\d-[A-Za-z0-9-]{10,255}/g,  // Slack 봇 · 사용자 · 앱 토큰
];
// 키 이름 뒤 = 에 값이 붙은 꼴. 코드(token = getToken())를 거르려고 값은 8자↑ · 숫자 하나 이상 · 괄호 · 따옴표 · 공백 없음
// 키 이름 뒤 = 에 값이 붙은 꼴. 값은 8–512자, 숫자 조건 없음(숫자 없는 비밀번호 · JWT 도 잡음).
// 빼는 것: == · === · && · || · ?? · ?: · 템플릿 식(값 글자에서 제외), 값 뒤 ( 면 함수 호출, undefined · null · true · false · password · changeme, 따옴표 없는 process.env. 같은 읽기
const RE_KEYVAL = /(?:password|passwd|pwd|secret|token|api[_-]?key|비밀번호|패스워드|토큰)["']?\s*=(?!=)\s*(["']?)([^\s"'<>(){},;=&|?:`]{8,512})(?![^\s"'<>(){},;=&|?:`]|\s*\()/gi;
const NOT_SECRET = /^(undefined|null|true|false|password|changeme)$/i, READ = /^(process\.env|import\.meta|window|this|self|globalThis)\./;
const PAY_WORD = /급여|실지급|지급액|기본급/;
const SUR = '김이박최정강조윤장임한오서신권황안송류유홍전고문양손배백허남심노하곽성차주우구민나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부';
const RE_NAME = new RegExp(`(?<![가-힣])[${SUR}][가-힣]{1,2}(?![가-힣])`), RE_MONEY = /(?<![\d,])(?:\d{1,3}(?:,\d{3})+|\d{6,9})(?![\d,])/;

// 키 이름이 a.b.xxxToken 처럼 점 뒤 식별자의 끝인지(압축 JS 의 속성 대입) — 뒤로 식별자 글자를 걷다가 「.」 를 만나면 true. 변수 길이 lookbehind 는 긴 글에서 느려서 코드로
function afterDot(s, i) { let k = i, steps = 0; while (k > 0 && steps++ < 80 && /[\w$]/.test(s[k - 1])) k--; return s[k - 1] === '.'; }

/** 글 하나 → {rrn, card, acct, secret, pay} 개수 */
export function scanText(text) {
  const s = text.replace(DATA_URI, ' '), n = { rrn: 0, card: 0, acct: 0, secret: 0, pay: 0 };
  for (const m of s.matchAll(RE_RRN)) if (validRrn(m[1], m[2])) n.rrn++;
  for (const m of s.matchAll(RE_CARD)) { const d = m[1].replace(/-/g, ''); if (luhn(d) && ctx(s, m.index, CARD_WORD)) n.card++; }
  for (const m of s.matchAll(RE_ACCT)) {
    const [, a, b, c] = m;
    if (isDate(a, b, c)) continue;                                  // 날짜
    if (a[0] === '0' && c.length === 4) continue;                   // 전화(0 으로 시작 · 끝 4자리)
    if (a.length === 3 && b.length === 2 && c.length === 5) continue; // 사업자번호
    if (ctx(s, m.index, BANK_WORD)) n.acct++;
  }
  for (const re of SECRET_PREFIX) n.secret += [...s.matchAll(re)].length;
  for (const m of s.matchAll(RE_KEYVAL)) if ((m[1] || !afterDot(s, m.index)) && !NOT_SECRET.test(m[2]) && !(!m[1] && READ.test(m[2]))) n.secret++;
  // 급여: 낱말 줄(같은 줄 포함)부터 아래 40줄 안에 이름 + 금액이 같은 줄에 있으면 — 막지 않고 경고만
  let armed = 0;
  for (const line of s.split('\n')) {
    if (PAY_WORD.test(line)) armed = 41;
    if (armed > 0) { armed--; if (RE_NAME.test(line) && RE_MONEY.test(line)) n.pay++; }
  }
  return n;
}

export const LABEL = { rrn: '주민번호', card: '카드번호', acct: '계좌번호', secret: '비밀값(키 · 토큰 · 비밀번호)', pay: '급여 의심', unscanned: '검사 못 한 파일' };

/** 올릴 파일들 [{path, abs}] → {hits: [{kind, label, count, files}], warns: […]} — 막을 것(hits)과 경고만(warns). 값은 담지 않음 */
export function scanFiles(files, { read = f => readFileSync(f) } = {}) {
  const tot = {}, where = {};
  for (const f of files) {
    if (f.path.startsWith('artifact-type/')) continue;   // 앱 실행 파일 건너뜀
    let n;
    try { const raw = read(f.abs); if (isBinary(f.path, raw)) continue; n = scanText(typeof raw === 'string' ? raw : raw.toString('utf8')); }
    catch { n = { unscanned: 1 }; }   // 검사 못 한 파일은 통과시키지 않음(읽기 · 정규식 오류) — 막음
    for (const [k, v] of Object.entries(n)) if (v) { tot[k] = (tot[k] || 0) + v; (where[k] ||= []).push(f.path); }
  }
  const mk = k => ({ kind: k, label: LABEL[k], count: tot[k], files: where[k] });
  return { hits: ['rrn', 'card', 'acct', 'secret', 'unscanned'].filter(k => tot[k]).map(mk), warns: tot.pay ? [mk('pay')] : [] };
}
const fmt = r => `${r.label} ${r.count}개 · ${r.files.slice(0, 5).join(', ')}${r.files.length > 5 ? ` 외 ${r.files.length - 5}개 파일` : ''}`;
export const hitsText = g => g.hits.map(fmt).join('\n');
export const warnsText = g => g.warns.map(r => `${fmt(r)} (막지 않음 — 올리는 글인지 확인)`).join('\n');
