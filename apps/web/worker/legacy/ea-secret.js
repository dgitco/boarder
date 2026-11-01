(() => {
  if (!window.BX_EA || !document.body || !document.documentElement.classList.contains('bx-ea')) return;   // ea.js 가 켠 배치 위에서만
  const API = {list: '/api/secrets', one: n => '/api/secrets/' + encodeURIComponent(n), req: id => '/api/secrets/requests/' + encodeURIComponent(id)};
  const OK_MS = 20000, OFF_MS = 300000;
  const ERR = '일시적인 오류가 발생했어요';
  const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;   // secrets.ts 와 같은 꼴
  const KINDS = [['card', '카드'], ['phone', '전화'], ['id', '주민번호'], ['password', '비밀번호'], ['text', '글'], ['other', '기타']];
  const kindTx = k => (KINDS.find(x => x[0] === k) || [0, '기타'])[1];
  const R = document.documentElement;

  // ── 작은 도구(만들기는 createElement · textContent 만 — 글이 HTML 로 읽히지 않게)
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  const btn = (cls, text) => { const b = mk('button', cls, text); b.type = 'button'; return b; };
  const ICON = {
    lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    key: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    right: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  };
  const ic = (n, cls) => { const s = mk('span', 'bx-es-ic' + (cls ? ' ' + cls : '')); s.innerHTML = ICON[n]; return s; };   // 고정 그림만(받은 글 없음)
  const str = v => typeof v === 'string' ? v : v == null ? '' : String(v);
  // 쓰기: 답 {status, j} — 값이 든 몸통은 이 함수 안에서만 글이 됨(어디에도 안 남김)
  const send = async (method, u, b) => {
    try {
      const r = await window.fetch(u, {method, credentials: 'same-origin', cache: 'no-store', headers: {'content-type': 'application/json', 'x-hb': '1'}, ...(b === undefined ? {} : {body: JSON.stringify(b)})});
      return {status: r.status, j: await r.json().catch(() => null)};
    } catch { return {status: 0, j: null}; }
  };
  const rnd = () => 'f' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  // 넣을 곳: 브라우저 = https 주소, 터미널 = 'terminal:<판>'(boarder secret type --tmux)
  const TERM = 'terminal:';
  const isTerm = q => str(q.site).startsWith(TERM);
  const where = q => isTerm(q) ? `터미널 판 ${str(q.site).slice(TERM.length)}` : str(q.site);
  const ago = t => { const s = Math.max(0, (Date.now() - Number(t || 0)) / 1000); return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`; };

  // ── 상태
  let on = false, secs = [], pend = [], tk = null, busy = false, lockSig = '', listSig = '', gen = 0;
  const sigOf = () => JSON.stringify([pend.map(x => [x.id, x.name, x.agent, x.site]), secs.map(x => [x.name, x.kind, x.mode, x.policy])]);
  // ── 띠(허락 기다릴 때만, ea 머리 바로 아래) · 목록 머리 자물쇠 단추(뒤쪽이 있으면 늘)
  const band = btn('bx-es-band'); band.hidden = true; band.setAttribute('aria-haspopup', 'dialog');
  const bandTx = mk('span', 'bx-es-bt');
  band.append(ic('lock'), bandTx, ic('right', 'bx-es-chev'));
  document.body.append(band);
  const keys = btn('bx-ea-ib bx-ea-keys'); keys.hidden = true; keys.setAttribute('aria-label', '비밀값'); keys.setAttribute('aria-haspopup', 'dialog');
  keys.append(ic('key'));
  const dot = mk('i', 'bx-ea-keys-n'); dot.hidden = true; keys.append(dot);
  { const t = document.querySelector('.bx-ea-title'); if (t) t.insertBefore(keys, t.querySelector('.bx-ea-compose')); }

  function setLocks(){
    const a = on ? [...new Set(pend.map(x => str(x.agent).trim()).filter(Boolean))] : [];
    const s = a.join('\u0001');
    window.BX_EA_LOCK = a;
    if (s !== lockSig){ lockSig = s; try { window.dispatchEvent(new Event('bx-ea-lock')); } catch {} }
  }
  function drawBand(){
    const n = pend.length, show = on && n > 0;
    band.hidden = !show; R.classList.toggle('bx-es-on', show);
    keys.hidden = !on; dot.hidden = !show; dot.textContent = show ? String(n) : '';
    keys.setAttribute('aria-label', show ? `비밀값 · 허락 기다림 ${n}` : '비밀값');
    if (show) bandTx.textContent = `비밀값 허락 기다림 ${n}`;
  }
  const norm = j => [
    (Array.isArray(j?.secrets) ? j.secrets : []).filter(x => x && typeof x.name === 'string'),
    (Array.isArray(j?.requests) ? j.requests : []).filter(x => x && x.id != null && x.state === 'pending'),
  ];
  function off(){ on = false; secs = []; pend = []; drawBand(); setLocks(); if (S.open) close(); }
  async function load(){
    clearTimeout(tk); tk = null;
    const g = ++gen;
    let j = null;
    try {
      const r = await window.fetch(API.list, {credentials: 'same-origin', cache: 'no-store', headers: {accept: 'application/json'}});
      if (r.ok) j = await r.json();
    } catch {}
    if (g !== gen) return;
    if (!j || typeof j !== 'object' || !Array.isArray(j.secrets)){ off(); tk = setTimeout(load, OFF_MS); return; }   // 401 · 404 · 망 실패 · 이상한 답 = 통째로 숨김, 5분 뒤 다시
    on = true; [secs, pend] = norm(j);
    drawBand(); setLocks();
    if (S.open && S.view === 'list' && listSig !== sigOf()) list();   // 바뀐 때만(포커스를 뺏지 않게)
    tk = setTimeout(load, OK_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && on) load(); });

  // ── 시트
  const S = {open: false, view: '', back: null, tok: null};   // tok = 지금 화면 표지(그린 때마다 새로)
  const scrim = mk('div', 'bx-es-scrim'); scrim.hidden = true;
  const sheet = mk('div', 'bx-es-sheet ph-no-capture'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'bx-es-title');
  const sh = mk('div', 'bx-es-h'), backB = btn('bx-es-ib'), title = mk('b', 'bx-es-title'), closeB = btn('bx-es-ib');
  title.id = 'bx-es-title';
  backB.setAttribute('aria-label', '목록으로'); backB.append(ic('back')); closeB.setAttribute('aria-label', '닫기'); closeB.append(ic('x'));
  sh.append(backB, title, closeB);
  const body = mk('div', 'bx-es-b');
  sheet.append(mk('i', 'bx-es-grab'), sh, body);
  scrim.append(sheet);
  document.body.append(scrim);
  let focusables = [];   // 포커스 가둠: 지금 화면에서 누를 수 있는 것(그린 순서)
  const setFocus = a => { focusables = [backB, closeB, ...a].filter(Boolean); };

  // 입력칸 지우기: 값 비우고 요소째 뗌(닫기 · 목록으로 · 다 보냄)
  let field = null;
  const wipe = () => { if (field){ field.value = ''; field.remove(); field = null; } };

  function open(){
    if (!on) return;
    S.back = document.activeElement; S.open = true;
    scrim.hidden = false; R.classList.add('bx-es-open');
    list();
  }
  function close(){
    wipe();
    S.open = false; S.view = ''; S.tok = {}; scrim.hidden = true; R.classList.remove('bx-es-open');   // tok 새로 = 보낸 직후 닫아도 숨은 시트에 결과를 안 그림
    body.replaceChildren();
    try { S.back?.focus?.(); } catch {}
  }
  band.addEventListener('click', open);
  keys.addEventListener('click', open);
  backB.addEventListener('click', () => list());
  closeB.addEventListener('click', close);
  scrim.addEventListener('click', e => { if (e.target === scrim) close(); });   // 바깥 누름
  document.addEventListener('keydown', e => {
    if (!S.open) return;
    if (e.key === 'Escape'){ e.preventDefault?.(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables.filter(x => !x.disabled && x.isConnected !== false && !x.closest?.('[hidden]'));
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i === f.length - 1 ? 0 : i + 1);
    e.preventDefault?.(); f[n].focus?.();
  });
  const head = (t, back) => { S.tok = {}; title.textContent = t; backB.setAttribute('data-off', back ? '0' : '1'); backB.disabled = !back; backB.setAttribute('aria-hidden', String(!back)); };   // 자리는 남김(숨기면 머리 칸이 밀려 제목이 40px 칸에 잘렸음)
  const line = (cls, t) => mk('p', cls, t);
  const errLine = () => { const e = line('bx-es-err', ''); e.hidden = true; e.setAttribute('role', 'alert'); return e; };
  const spin = () => mk('span', 'bx-es-spin');
  // 단추 하나 바쁨 표시(글 자리에 스피너) — 끝나면 글 되돌림
  const busyOn = b => { const t = b.textContent; b.setAttribute('aria-busy', 'true'); b.setAttribute('aria-label', t); b.replaceChildren(spin()); return () => { b.removeAttribute('aria-busy'); b.removeAttribute('aria-label'); b.replaceChildren(document.createTextNode(t)); }; };
  const policyTx = s => s.mode === 'once' ? '한 번만 · 10분 안' : s.policy === 'auto' ? '저장 · 에이전트가 알아서' : '저장 · 쓸 때마다 허락';

  // 목록: 허락 기다림 → 저장한 값 → 값 넣기
  function list(){
    wipe(); S.view = 'list'; listSig = sigOf(); head('비밀값', false);
    const out = [], cards = [];
    if (pend.length){
      out.push(mk('h3', 'bx-es-sec', '허락 기다림'));
      for (const q of pend){
        const c = btn('bx-es-card'); c.append(ic('shield', 'bx-es-ci'));
        const t = mk('span', 'bx-es-ct'); t.append(mk('b', '', str(q.name) || '비밀값'), mk('span', 'bx-es-sub', [str(q.agent), where(q), ago(q.created_at)].filter(Boolean).join(' · ')));
        c.append(t, ic('right', 'bx-es-chev')); c.addEventListener('click', () => allowView(q)); out.push(c); cards.push(c);
      }
    }
    if (secs.length){
      out.push(mk('h3', 'bx-es-sec', '넣어 둔 값'));
      for (const s of secs){
        const c = btn('bx-es-card'); c.append(ic('lock', 'bx-es-ci'));
        const t = mk('span', 'bx-es-ct'); t.append(mk('b', '', s.name), mk('span', 'bx-es-sub', `${kindTx(s.kind)} · ${policyTx(s)}`));
        c.append(t, ic('right', 'bx-es-chev')); c.addEventListener('click', () => savedView(s)); out.push(c); cards.push(c);
      }
    }
    if (!pend.length && !secs.length) out.push(line('bx-es-none', '넣어 둔 값이 없어요'));
    const add = btn('bx-es-ghost bx-es-add'); add.append(ic('plus'), mk('span', '', '값 넣기')); add.addEventListener('click', () => addView());
    out.push(add); cards.push(add);
    body.replaceChildren(...out);
    setFocus(cards);
    cards[0].focus?.();
  }
  // 세그먼트(iOS 꼴 단추 여럿)
  function seg(label, opts, val, onPick, cls){
    const g = mk('div', 'bx-es-seg' + (cls ? ' ' + cls : '')); g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', label);
    const bs = opts.map(([v, t]) => { const b = btn('bx-es-sg', t); b.setAttribute('role', 'radio'); b.addEventListener('click', () => pick(v)); return [v, b]; });
    const pick = v => { val = v; for (const [k, b] of bs) b.setAttribute('aria-checked', k === v ? 'true' : 'false'); onPick(v); };
    g.append(...bs.map(x => x[1])); pick(val);
    return {el: g, btns: bs.map(x => x[1])};
  }
  const lab = (t, el) => { const l = mk('label', 'bx-es-lab'); l.append(mk('span', '', t), el); return l; };
  // 값 넣기: 이름 · 종류 · 가린 값 · 한 번만/저장 · 허락/알아서
  function addView(){
    wipe(); S.view = 'add'; head('값 넣기', true);
    const nm = mk('input', 'bx-es-in bx-es-name');
    nm.type = 'text'; nm.name = rnd(); nm.setAttribute('autocomplete', 'off'); nm.setAttribute('autocapitalize', 'off'); nm.setAttribute('autocorrect', 'off'); nm.spellcheck = false; nm.setAttribute('spellcheck', 'false');
    nm.setAttribute('placeholder', 'card-main'); nm.setAttribute('maxlength', '40'); nm.setAttribute('aria-describedby', 'bx-es-nmh');
    const nmh = line('bx-es-note', '에이전트가 이 이름으로 불러요 · 영문 소문자 · 숫자 · - _'); nmh.id = 'bx-es-nmh';
    let kind = 'card', mode = 'once', policy = 'ask';
    const inp = field = document.createElement('input');
    inp.className = 'bx-es-in bx-es-mask';
    inp.type = window.CSS?.supports?.('-webkit-text-security', 'disc') ? 'text' : 'password';
    inp.name = rnd();   // 무작위 이름 — 브라우저 · 확장이 이 칸을 기억 · 자동 완성하지 않게
    inp.setAttribute('autocomplete', 'off'); inp.setAttribute('autocorrect', 'off'); inp.setAttribute('autocapitalize', 'off');
    inp.setAttribute('data-lpignore', 'true'); inp.setAttribute('data-1p-ignore', 'true'); inp.setAttribute('data-bwignore', 'true'); inp.setAttribute('data-form-type', 'other');
    inp.spellcheck = false; inp.setAttribute('spellcheck', 'false');
    inp.setAttribute('aria-label', '값'); inp.setAttribute('maxlength', '4096');
    for (const ev of ['copy', 'cut']) inp.addEventListener(ev, e => e.preventDefault?.());   // text 칸이라 password 처럼 복사 · 잘라내기를 막음(붙여넣기는 됨)
    const setMode = () => { inp.inputMode = ['card', 'phone', 'id'].includes(kind) ? 'numeric' : 'text'; inp.setAttribute('inputmode', inp.inputMode); };
    const kindSeg = seg('종류', KINDS, kind, v => { kind = v; setMode(); }, 'bx-es-kinds');
    const useSeg = seg('쓸 때', [['ask', '쓸 때마다 허락'], ['auto', '에이전트가 알아서']], 'ask', v => { policy = v; });
    const keepSeg = seg('보관', [['once', '한 번만 쓰고 버림'], ['saved', '저장']], 'once', v => { mode = v; useSeg.el.hidden = v !== 'saved'; });
    const note = line('bx-es-note', '값은 보드 대화 · 장부 · 이 화면에 남지 않고, 쓸 때마다 그 기기의 브라우저 칸이나 터미널에 한 번 들어가요. 들어간 뒤엔 그 기기의 에이전트가 읽을 수 있어요. 한 번만은 10분 안에 안 쓰면 지워져요');
    const err = errLine();
    const go = btn('bx-es-go', '넣기'); go.disabled = true;
    const ready = () => NAME.test(nm.value) && nm.value !== 'requests' && !!inp.value;   // requests = 뒤쪽 예약어
    const upd = () => { go.disabled = busy || !ready(); err.hidden = true; };
    nm.addEventListener('input', () => { const v = nm.value.toLowerCase(); if (v !== nm.value) nm.value = v; upd(); });
    inp.addEventListener('input', upd);
    const enter = e => { if (e.key === 'Enter' && !e.isComposing){ e.preventDefault?.(); go.disabled || submit(); } };
    nm.addEventListener('keydown', enter); inp.addEventListener('keydown', enter);
    async function submit(){
      if (busy || !ready() || field !== inp) return;
      busy = true; go.disabled = true; const undo = busyOn(go); err.hidden = true;
      const name = nm.value;
      const r = await send('POST', API.list, {name, kind, mode, policy: mode === 'saved' ? policy : 'ask', value: inp.value});
      busy = false; undo();
      if (field !== inp){ inp.value = ''; return; }   // 그 사이 닫음 · 다른 화면
      if (r.status !== 200 || r.j?.ok !== true){   // 값은 칸에 그대로 — 고쳐서 다시
        err.textContent = r.status === 409 ? '같은 이름이 있어요' : r.status === 400 && !NAME.test(name) ? '이름은 영문 소문자 · 숫자 · - _ 로' : ERR;
        err.hidden = false; go.disabled = !ready(); (r.status === 409 ? nm : inp).focus?.(); return;
      }
      wipe();
      secs = [...secs.filter(x => x.name !== name), {name, kind, mode, policy: mode === 'saved' ? policy : 'ask'}];
      done(`넣었어요 · 에이전트는 「${name}」 으로 불러요`);
      load();
    }
    go.addEventListener('click', submit);
    body.replaceChildren(lab('이름', nm), nmh, lab('종류', kindSeg.el), inp, keepSeg.el, useSeg.el, note, err, go);
    setFocus([nm, ...kindSeg.btns, inp, ...keepSeg.btns, ...useSeg.btns, go]);
    nm.focus?.();
  }
  // 넣어 둔 값: 쓸 때 바꾸기(저장만) · 지우기(두 번 눌러)
  function savedView(s){
    wipe(); S.view = 'saved'; head(s.name, true); const tok = S.tok;
    const sub = line('bx-es-why', `${kindTx(s.kind)} · ${policyTx(s)}`);
    const err = errLine();
    const parts = [sub], foc = [];
    if (s.mode === 'saved'){
      const useSeg = seg('쓸 때', [['ask', '쓸 때마다 허락'], ['auto', '에이전트가 알아서']], s.policy === 'auto' ? 'auto' : 'ask', async v => {
        if (busy || v === s.policy) return;
        busy = true; for (const b of useSeg.btns) b.disabled = true; err.hidden = true;
        const r = await send('PATCH', API.one(s.name), {policy: v});
        busy = false; for (const b of useSeg.btns) b.disabled = false;
        if (S.tok !== tok) return;
        if (r.status === 200 && r.j?.ok === true){ s.policy = v; sub.textContent = `${kindTx(s.kind)} · ${policyTx(s)}`; load(); return; }
        err.textContent = ERR; err.hidden = false;
        for (const b of useSeg.btns) b.setAttribute('aria-checked', b.textContent === (s.policy === 'auto' ? '에이전트가 알아서' : '쓸 때마다 허락') ? 'true' : 'false');
      });
      parts.push(useSeg.el); foc.push(...useSeg.btns);
    }
    const del = btn('bx-es-ghost', '지우기');
    let armed = false;
    del.addEventListener('click', async () => {
      if (busy) return;
      if (!armed){ armed = true; del.textContent = '한 번 더 누르면 지워요'; return; }
      busy = true; del.disabled = true; const undo = busyOn(del); err.hidden = true;
      const r = await send('DELETE', API.one(s.name));
      busy = false; del.disabled = false; undo();
      if (S.tok !== tok) return;
      if (r.status === 200 && r.j?.ok === true || r.status === 404){ secs = secs.filter(x => x.name !== s.name); done('지웠어요'); load(); return; }
      err.textContent = ERR; err.hidden = false;
    });
    parts.push(line('bx-es-note', '값은 다시 볼 수 없어요. 바꾸려면 지우고 다시 넣어요'), err, del); foc.push(del);
    body.replaceChildren(...parts);
    setFocus(foc);
    (foc[0] || closeB).focus?.();
  }
  // 허락
  function allowView(q){
    wipe(); S.view = 'allow'; head(str(q.name) || '비밀값', true); const tok = S.tok;
    const who = line('bx-es-who', `${where(q) || '사이트'} 에 넣으려 해요 · ${str(q.agent) || '에이전트'}`);
    const warn = line('bx-es-warn', '입력이 화면에 안 보이는 비밀번호 칸일 때만 허락하세요. 일반 셸이면 화면 · 기록에 값이 남아요'); warn.hidden = !isTerm(q);
    const why = line('bx-es-why', `${ago(q.created_at)} 요청 · 10분 안에 정하지 않으면 지나가요`);
    const err = errLine();
    const row = mk('div', 'bx-es-row'), no = btn('bx-es-ghost', '거절'), yes = btn('bx-es-go', '허락');
    row.append(no, yes);
    async function decide(allow){
      if (busy) return;
      busy = true; no.disabled = yes.disabled = true; const undo = busyOn(allow ? yes : no); err.hidden = true;
      const r = await send('POST', API.req(q.id), {action: allow ? 'allow' : 'deny'});
      busy = false; no.disabled = yes.disabled = false; undo();
      if (S.tok !== tok) return;
      if (r.status === 409){ pend = pend.filter(x => x.id !== q.id); drawBand(); setLocks(); done('이미 정했거나 시간이 지났어요'); load(); return; }
      if (r.status !== 200 || r.j?.ok !== true){ err.textContent = ERR; err.hidden = false; return; }
      pend = pend.filter(x => x.id !== q.id); drawBand(); setLocks();
      done(allow ? '허락했어요' : '거절했어요'); load();
    }
    no.addEventListener('click', () => decide(false)); yes.addEventListener('click', () => decide(true));
    body.replaceChildren(who, warn, why, err, row);
    setFocus([no, yes]);
    yes.focus?.();
  }
  // 한 줄 뒤 목록
  function done(t){
    S.view = 'done'; head('비밀값', false);
    const p = line('bx-es-done', t); p.setAttribute('role', 'status');
    body.replaceChildren(p); setFocus([]); closeB.focus?.();
    setTimeout(() => { if (S.open && S.view === 'done') list(); }, 1400);
  }

  window.BX_EA_SECRET = {load, open, state: () => ({on, secrets: secs.length, pending: pend.length, open: S.open, view: S.view})};   // 시험 · 확인용(값 없음)
  load();
})();
