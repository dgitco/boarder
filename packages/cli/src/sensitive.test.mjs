// node --test packages/cli/src/sensitive.test.mjs
// 민감 값 거름: 검증을 통과하게 만든 가짜 값은 막고, 검증 실패 꼴 · 날짜 · 전화 · 사업자번호는 안 막음. 출력에 값이 안 나옴.
// 시험 값은 저장소 비밀 검사에 걸리지 않게 조각내 이어 붙여 만듦(소스에 통째로 안 보임).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-sens-'));
process.env.BOARDER_HOME = path.join(tmp, 'home');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const { scanText, scanFiles, validRrn, luhn, hitsText, warnsText } = await import('./sensitive.mjs');
const { canvasPut } = await import('./canvas.mjs');
const { artifactHook } = await import('./artifact.mjs');

// 검증 숫자가 맞는 가짜 주민번호(앞 12자리 + 계산한 마지막 자리) · Luhn 이 맞는 가짜 16자리
const rrn = (front12) => { const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5], s = w.reduce((a, x, i) => a + x * +front12[i], 0); return front12 + String((11 - (s % 11)) % 10); };
const card = (front15) => { for (let k = 0; k < 10; k++) if (luhn(front15 + k)) return front15 + k; };
const R = rrn('900101' + '1234567'.slice(0, 6)), RRN = `${R.slice(0, 6)}-${R.slice(6)}`;   // 900101-1234567 꼴(검증 숫자만 계산)
const C = card('411111111111111'), CARD = `${C.slice(0, 4)}-${C.slice(4, 8)}-${C.slice(8, 12)}-${C.slice(12)}`;
const bad = s => s.slice(0, -1) + String((+s.slice(-1) + 1) % 10);   // 마지막 자리만 틀리게
const KEYS = {
  anthropic: 'sk-' + 'ant-' + 'api03-' + 'A1b2C3d4E5f6G7h8I9j0K1l2',
  openai: 'sk-' + 'proj-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6',
  github: 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8',
  slack: 'xo' + 'xb-' + '1234567890-abcdefghijkl',
};
const n = t => scanText(t);

test('주민번호: 검증 통과 꼴은 막음 · 검증 숫자 틀림 · 없는 날짜 · 앞뒤 숫자 · 뒤 첫 자리 5↑ 는 안 막음', () => {
  assert.ok(validRrn(R.slice(0, 6), R.slice(6)));
  assert.equal(n(`주민번호 ${RRN} 입니다`).rrn, 1);
  assert.equal(n(`${RRN} 그리고 ${RRN}`).rrn, 2);
  assert.equal(n(bad(RRN)).rrn, 0);                                  // 검증 숫자 틀림
  const nodate = rrn('901301' + '123456'); assert.equal(n(`${nodate.slice(0, 6)}-${nodate.slice(6)}`).rrn, 0);   // 13월
  assert.equal(n(`1${RRN}`).rrn, 0); assert.equal(n(`${RRN}9`).rrn, 0); assert.equal(n(`-${RRN}`).rrn, 0);   // 앞뒤에 숫자 · -
  const g5 = rrn('900101' + '523456'); assert.equal(n(`${g5.slice(0, 6)}-${g5.slice(6)}`).rrn, 0);   // 뒤 첫 자리 5
});

test('카드번호: Luhn + 카드 낱말이 있을 때만 · 낱말 없음 · Luhn 틀림 · 붙은 16자리도', () => {
  assert.equal(n(`신용카드 ${CARD}`).card, 1);
  assert.equal(n(`승인번호 ${C}`).card, 1);                          // 붙은 16자리
  assert.equal(n(`번호 ${CARD}`).card, 0);                           // 낱말 없음
  assert.equal(n(`카드 ${bad(CARD)}`).card, 0);                      // Luhn 틀림
  assert.equal(n(`카드 1${C}`).card, 0);                             // 17자리
  assert.equal(n(`카드 ${'가'.repeat(130)} ${CARD}`).card, 0);        // 낱말이 120자 밖
});

test('계좌번호: 은행 · 계좌 낱말이 있을 때만 · 날짜 · 전화 · 사업자번호는 뺌', () => {
  assert.equal(n('국민은행 123-45-678901').acct, 1);
  assert.equal(n('계좌 1002-123-456789').acct, 1);
  assert.equal(n('123-45-678901').acct, 0);                          // 낱말 없음
  assert.equal(n('계좌 2026-11-02').acct, 0);                        // 날짜
  assert.equal(n('계좌 010-1234-5678').acct, 0); assert.equal(n('은행 02-123-4567').acct, 0);   // 전화
  assert.equal(n('계좌 123-45-67890').acct, 0);                      // 사업자번호
  assert.equal(n('계좌 1-2-3').acct, 0);                             // 자리 모자람
});

test('비밀값: API 키 · GitHub · Slack 앞머리와 키 이름=값, 코드 꼴은 안 막음', () => {
  for (const [k, v] of Object.entries(KEYS)) assert.equal(n(`x ${v} y`).secret, 1, k);
  assert.equal(n('password=Hunter2xyz9').secret, 1);
  assert.equal(n('API_KEY="abc12345def"').secret, 1);
  assert.equal(n('비밀번호 = pw12345678').secret, 1);
  assert.equal(n('token = getToken()').secret, 0);                   // 코드
  assert.equal(n('password=abcdefghij').secret, 1);                  // 숫자 없어도 잡음
  assert.equal(n('sk-short').secret, 0);
});

test('급여: 이름 + 금액이 같은 줄이면 경고만(hits 아님)', () => {
  const t = '급여 명세\n김철수 3,200,000\n이영희 2,800,000\n';
  assert.equal(n(t).pay, 2);
  assert.equal(n('김철수 3,200,000').pay, 0);                        // 낱말 없음
  assert.equal(n('급여 안내\n자세한 내용은 문의').pay, 0);
});

test('파일 스캔: data: URI · artifact-type/ · 그림 파일은 건너뜀 · 결과에 값이 없음', () => {
  const files = {
    'a.html': `<p>신용카드 ${CARD}</p><p>${RRN}</p>`, 'b.js': `const k="${KEYS.openai}"`, 'c.html': '<p>급여\n김철수 3,200,000</p>',
    'd.html': `<img src="data:image/png;base64,${RRN.replace('-', '')}${'A'.repeat(50)}==">`,
    'artifact-type/x.js': `"${KEYS.github}"`, 'e.png': '\0' + RRN,
  };
  const g = scanFiles(Object.keys(files).map(p => ({ path: p, abs: p })), { read: f => files[f] });
  assert.deepEqual(g.hits.map(h => [h.kind, h.count, h.files]), [['rrn', 1, ['a.html']], ['card', 1, ['a.html']], ['secret', 1, ['b.js']]]);
  assert.equal(g.warns[0].kind, 'pay');
  const out = hitsText(g) + warnsText(g) + JSON.stringify(g);
  for (const v of [RRN, R, CARD, C, ...Object.values(KEYS)]) assert.ok(!out.includes(v));
  assert.match(hitsText(g), /주민번호 1개 · a\.html/);
});

test('canvas put: 걸리면 올리지 않고(요청 0) 오류 글에 값이 없음 · 급여만이면 경고하고 올림', async () => {
  const d = fs.mkdtempSync(path.join(tmp, 'c-')), put = (files, o) => { const x = fs.mkdtempSync(path.join(tmp, 'f-')); for (const [p, v] of Object.entries(files)) fs.writeFileSync(path.join(x, p), v); return canvasPut(x, {}, o); };
  void d;
  let err; try { await put({ 'index.html': `<p>카드 ${CARD}</p>`, 'k.txt': KEYS.slack }, { log: () => {} }); } catch (e) { err = e; }
  assert.equal(err.code, 'SENSITIVE'); assert.match(err.message, /카드번호 1개 · index\.html/); assert.match(err.message, /비밀값.*1개 · k\.txt/);
  assert.ok(![CARD, C, KEYS.slack].some(v => err.message.includes(v) || JSON.stringify(err.hits).includes(v)));
  // 급여 경고만: 경고는 나가고, 올리기는 서버 호출까지 감(기기 설정 없음 → NO_DEVICE)
  const warns = []; let e2; try { await put({ 'index.html': '<p>급여\n김철수 3,200,000</p>' }, { log: () => {}, warn: m => warns.push(m) }); } catch (e) { e2 = e; }
  assert.equal(e2.code, 'NO_DEVICE'); assert.match(warns[0], /급여 의심 1개/);
});

test('hook artifact: 걸려도 던지지 않고 {error} 로 끝(끝 코드 0 유지) · stderr 글에 값이 없음', async () => {
  const logs = [], input = { tool_name: 'mcp__claude-artifacts__publish_version', cwd: tmp, tool_input: { content: `<p>승인번호 ${CARD}</p>`, title: '가상' }, tool_response: { content: [{ type: 'text', text: JSON.stringify({ url: 'https://claude.ai/artifact/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0' }) }] } };
  const r = await artifactHook(input, { put: (f, fl) => canvasPut(f, fl, { log: () => {}, warn: () => {} }), log: m => logs.push(m), home: tmp, env: {} });
  assert.match(r.error, /카드번호 1개 · index\.html/);
  assert.ok(!logs.join('\n').includes(C) && !logs.join('\n').includes(CARD));
});

test('큰 파일 · 정규식 오류는 통과가 아니라 막힘(검사 못 한 파일) — 9MB 한 줄 값도 던지지 않음', () => {
  const g = scanFiles([{ path: 'a.html', abs: 'a' }, { path: 'b.html', abs: 'b' }], { read: f => { if (f === 'a') throw new RangeError('Maximum call stack size exceeded'); return 'ok'; } });
  assert.deepEqual(g.hits.map(h => [h.kind, h.label, h.files]), [['unscanned', '검사 못 한 파일', ['a.html']]]);
  // 상한 덕에 진짜 긴 줄도 오류 없이 끝남(9MB · 6MB)
  assert.doesNotThrow(() => { scanText('token=' + 'a1'.repeat(4 << 20)); scanText('sk-' + 'a'.repeat(6 << 20)); scanText('1-'.repeat(4 << 20)); });
  assert.equal(scanText('token=' + 'a1'.repeat(4 << 20)).secret, 0);   // 값이 상한을 넘으면 코드 · 데이터 덩어리
});

test('허용 목록 뒤집기: .py · .sh · .ts · 확장자 없음 안 비밀값도 막음 · 그림 · pdf · NUL 든 파일은 건너뜀', () => {
  const body = `API_KEY = "x"\nkey = "${KEYS.github}"\n`;
  const files = { 'run.py': body, 'go.sh': body, 'a.ts': body, 'a.tsx': body, 'app.log': body, 'Makefile': body, 'x.map': body,
    'p.png': '\0PNG' + body, 'd.pdf': '\0' + body, 'bin.dat': '\0\0' + body, 'f.woff2': '\0' + body, 'fake.png': body };
  const g = scanFiles(Object.keys(files).map(p => ({ path: p, abs: p })), { read: f => files[f] });
  assert.deepEqual(g.hits[0].files.sort(), ['Makefile', 'a.ts', 'a.tsx', 'app.log', 'fake.png', 'go.sh', 'run.py', 'x.map']);   // fake.png = 글을 이름만 바꾼 것 → 검사
  // Buffer 로 읽어도 같음
  assert.equal(scanFiles([{ path: 'q.py', abs: 'q' }, { path: 'z.dat', abs: 'z' }], { read: f => Buffer.from(f === 'q' ? body : '\0' + body) }).hits[0].files.join(), 'q.py');
});

test('오탐 줄이기: 슬러그(task-management-…) · 압축 JS 의 .xxxToken=긴 값은 안 막음', () => {
  assert.equal(n('task-management-' + 'a1b2c3'.repeat(8)).secret, 0);
  assert.equal(n('desk-' + 'abcdefgh1234'.repeat(5)).secret, 0);
  assert.equal(n('x.authToken=' + 'a1b2c3d4'.repeat(108)).secret, 0);   // 앞이 . + 865자
  assert.equal(n('var t=o.accessToken=abc12345def').secret, 0);        // 앞이 .
  assert.equal(n('token=' + 'a1b2c3d4'.repeat(70)).secret, 0);         // 512자 넘음
  assert.equal(n('x ' + KEYS.openai).secret, 1);                       // 진짜 꼴은 여전히 잡음
});

test('canvas put: 제목에 민감한 값이면 「제목 숨김」으로 · --todo 글이면 막음', async () => {
  const mk = (title, todo) => { const x = fs.mkdtempSync(path.join(tmp, 't-')); fs.writeFileSync(path.join(x, 'index.html'), '<p>ok</p>'); return canvasPut(x, { title, todo }, { log: () => {}, warn: m => warns.push(m) }); };
  const warns = [];
  let e; try { await mk(`카드 ${CARD}`); } catch (x) { e = x; }
  assert.equal(e.code, 'NO_DEVICE'); assert.match(warns[0], /제목 숨김/); assert.ok(!warns.join().includes(C));   // 막히지 않고 올리기까지 감
  e = null; try { await mk('가상', `확인: ${KEYS.slack}`); } catch (x) { e = x; }
  assert.equal(e.code, 'SENSITIVE'); assert.ok(!e.message.includes(KEYS.slack));
});

test('키=값 넓힌 판: 숫자 없는 비밀번호 · 따옴표 값 · JWT · URL ?token= 은 잡고, 비교 · 함수 호출 · 읽기 · 빈 값 · 템플릿은 안 잡음', () => {
  const jwt = 'ey' + 'J' + 'hbGciOiJIUzI1NiJ9.' + 'a1B2c3D4'.repeat(18) + '.' + 'x9Y8z7W6'.repeat(6);   // 129자↑ 가짜 JWT 꼴
  assert.ok(jwt.length > 129);
  for (const t of ['password=hunter-two-words', 'password=correcthorse', 'config.password="hunter2024"', `token=${jwt}`, `Authorization: x\nid_token = "${jwt}"`, 'https://x.test/cb?to' + 'ken=Ab12Cd34Ef56'])
    assert.equal(n(t).secret, 1, t.slice(0, 40));
  for (const t of ['if (password === "hunter2024")', 'a.password == b.password', 'cancelToken = axios.CancelToken.source()', 'token = getToken()', 'const token = getAccessToken ()',
    'password = process.env.PWD', 'token=undefined', 'secret = null', 'token = a ?? "fallback123"', 'token=${window.TOKEN_VALUE}', 'x.userToken=abcdefghij', 'pwd=this.passwordField', 'password=changeme', 'token = cond ? aaaaaaaa : bbbbbbbb'])
    assert.equal(n(t).secret, 0, t);
});
