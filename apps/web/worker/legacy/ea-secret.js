(() => {
  if (!window.BX_EA || !document.body || !document.documentElement.classList.contains('bx-ea')) return;   // ea.js 가 켠 배치 위에서만
  const API = {pending: '/api/secret/pending', put: '/api/secret/put', allow: '/api/secret/allow'};
  const OK_MS = 20000, OFF_MS = 300000;
  const ERR = '일시적인 오류가 발생했어요';
  const R = document.documentElement;

  // ── 작은 도구(만들기는 createElement · textContent 만 — 글이 HTML 로 읽히지 않게)
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  const btn = (cls, text) => { const b = mk('button', cls, text); b.type = 'button'; return b; };
  const ICON = {
    lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    right: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  };
  const ic = (n, cls) => { const s = mk('span', 'bx-es-ic' + (cls ? ' ' + cls : '')); s.innerHTML = ICON[n]; return s; };   // 고정 그림만(받은 글 없음)
  const str = v => typeof v === 'string' ? v : v == null ? '' : String(v);
  const post = (u, b) => window.fetch(u, {method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: {'content-type': 'application/json', 'x-hb': '1'}, body: JSON.stringify(b)});
  const rnd = () => 'f' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  // ── 상태
  let on = false, reqs = [], uses = [], tk = null, busy = false, lockSig = '', listSig = '';
  const sigOf = () => JSON.stringify([reqs.map(x => [x.id, x.label, x.agent]), uses.map(x => [x.id, x.label, x.agent, x.site])]);
  // ── 띠(ea 머리 바로 아래)
  const band = btn('bx-es-band'); band.hidden = true; band.setAttribute('aria-haspopup', 'dialog');
  const bandTx = mk('span', 'bx-es-bt');
  band.append(ic('lock'), bandTx, ic('right', 'bx-es-chev'));
  document.body.append(band);

  function setLocks(){
    const a = on ? [...new Set([...reqs, ...uses].map(x => str(x.agent).trim()).filter(Boolean))] : [];
    const s = a.join('\u0001');
    window.BX_EA_LOCK = a;
    if (s !== lockSig){ lockSig = s; try { window.dispatchEvent(new Event('bx-ea-lock')); } catch {} }
  }
  function drawBand(){
    const n = reqs.length, m = uses.length, show = on && (n + m) > 0;
    band.hidden = !show; R.classList.toggle('bx-es-on', show);
    if (!show) return;
    bandTx.textContent = [n ? `넣어 달라는 값 ${n}` : '', m ? `허락 기다림 ${m}` : ''].filter(Boolean).join(' · ');
  }
  const norm = j => {
    const a = Array.isArray(j?.requests) ? j.requests : [], b = Array.isArray(j?.uses) ? j.uses : [];
    return [a.filter(x => x && x.id != null), b.filter(x => x && x.id != null)];
  };
  function off(){ on = false; reqs = []; uses = []; drawBand(); setLocks(); if (S.open) close(); }
  async function load(){
    clearTimeout(tk); tk = null;
    let j = null;
    try {
      const r = await window.fetch(API.pending, {credentials: 'same-origin', cache: 'no-store', headers: {accept: 'application/json'}});
      if (r.ok) j = await r.json();
    } catch {}
    if (!j || typeof j !== 'object'){ off(); tk = setTimeout(load, OFF_MS); return; }   // 404 · 401 · 망 실패 · 이상한 답 = 통째로 숨김, 5분 뒤 다시
    on = true; [reqs, uses] = norm(j);
    drawBand(); setLocks();
    if (S.open && S.view === 'list' && listSig !== sigOf()) list();   // 바뀐 때만(포커스를 뺏지 않게)
    tk = setTimeout(load, OK_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && on) load(); });

  // ── 시트
  const S = {open: false, view: '', back: null};
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
    S.open = false; S.view = ''; scrim.hidden = true; R.classList.remove('bx-es-open');
    body.replaceChildren();
    try { S.back?.focus?.(); } catch {}
  }
  band.addEventListener('click', open);
  backB.addEventListener('click', () => list());
  closeB.addEventListener('click', close);
  scrim.addEventListener('click', e => { if (e.target === scrim) close(); });   // 바깥 누름
  document.addEventListener('keydown', e => {
    if (!S.open) return;
    if (e.key === 'Escape'){ e.preventDefault?.(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables.filter(x => !x.hidden && !x.disabled && x.isConnected !== false);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i === f.length - 1 ? 0 : i + 1);
    e.preventDefault?.(); f[n].focus?.();
  });
  const head = (t, back) => { title.textContent = t; backB.setAttribute('data-off', back ? '0' : '1'); backB.disabled = !back; backB.setAttribute('aria-hidden', String(!back)); };   // 자리는 남김(숨기면 머리 칸이 밀려 제목이 40px 칸에 잘렸음)
  const line = (cls, t) => mk('p', cls, t);

  // 목록: 요청 · 허락 카드
  function list(){
    wipe(); S.view = 'list'; listSig = sigOf(); head('비밀값', false);
    const cards = [];
    for (const r of reqs){
      const c = btn('bx-es-card'); c.append(ic('lock', 'bx-es-ci'));
      const t = mk('span', 'bx-es-ct'); t.append(mk('b', '', str(r.label) || '값'), mk('span', 'bx-es-sub', ['넣어 달라는 값', str(r.agent)].filter(Boolean).join(' · ')));
      c.append(t, ic('right', 'bx-es-chev')); c.addEventListener('click', () => putView(r)); cards.push(c);
    }
    for (const u of uses){
      const c = btn('bx-es-card'); c.append(ic('shield', 'bx-es-ci'));
      const t = mk('span', 'bx-es-ct'); t.append(mk('b', '', str(u.label) || '저장한 값'), mk('span', 'bx-es-sub', ['허락 기다림', str(u.agent), str(u.site)].filter(Boolean).join(' · ')));
      c.append(t, ic('right', 'bx-es-chev')); c.addEventListener('click', () => allowView(u)); cards.push(c);
    }
    body.replaceChildren(...(cards.length ? cards : [line('bx-es-none', '기다리는 것이 없어요')]));
    setFocus(cards);
    (cards[0] || closeB).focus?.();
  }
  // 세그먼트(iOS 꼴 단추 둘)
  function seg(label, opts, val, onPick){
    const g = mk('div', 'bx-es-seg'); g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', label);
    const bs = opts.map(([v, t]) => { const b = btn('bx-es-sg', t); b.setAttribute('role', 'radio'); b.addEventListener('click', () => pick(v)); return [v, b]; });
    const pick = v => { val = v; for (const [k, b] of bs) b.setAttribute('aria-checked', k === v ? 'true' : 'false'); onPick(v); };
    g.append(...bs.map(x => x[1])); pick(val);
    return {el: g, btns: bs.map(x => x[1])};
  }
  const spin = () => mk('span', 'bx-es-spin');
  // 넣기
  function putView(r){
    wipe(); S.view = 'put'; head(str(r.label) || '값', true);
    const why = line('bx-es-why', [str(r.why), str(r.agent)].filter(Boolean).join(' · '));
    const inp = field = document.createElement('input');
    inp.className = 'bx-es-in';
    inp.type = 'password';
    inp.name = rnd();   // 무작위 이름 — 브라우저 · 확장이 이 칸을 기억 · 자동 완성하지 않게
    inp.setAttribute('autocomplete', 'off'); inp.setAttribute('autocorrect', 'off'); inp.setAttribute('autocapitalize', 'off');
    inp.setAttribute('data-lpignore', 'true'); inp.setAttribute('data-1p-ignore', 'true'); inp.setAttribute('data-bwignore', 'true'); inp.setAttribute('data-form-type', 'other');
    inp.spellcheck = false;
    inp.setAttribute('spellcheck', 'false');
    inp.inputMode = ['card', 'phone', 'rrn'].includes(r.kind) ? 'numeric' : 'text';
    inp.setAttribute('inputmode', inp.inputMode);
    inp.setAttribute('aria-label', str(r.label) || '값');
    let keep = 'once', use = 'ask';
    const useSeg = seg('쓸 때', [['ask', '쓸 때마다 허락'], ['auto', '에이전트가 알아서']], 'ask', v => { use = v; });
    const keepSeg = seg('보관', [['once', '한 번만 쓰고 버림'], ['save', '저장']], 'once', v => { keep = v; useSeg.el.hidden = v !== 'save'; });
    const note = line('bx-es-note', '값은 에이전트 · 대화 · 기록 어디에도 보이지 않고, 브라우저 입력칸에만 들어가요');
    const err = line('bx-es-err', ''); err.hidden = true; err.setAttribute('role', 'alert');
    const go = btn('bx-es-go', '넣기'); go.disabled = true; go.setAttribute('aria-label', '넣기');
    inp.addEventListener('input', () => { go.disabled = busy || !inp.value; err.hidden = true; });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing){ e.preventDefault?.(); send(); } });
    async function send(){
      if (busy || !inp.value || field !== inp) return;
      busy = true; go.disabled = true; go.setAttribute('aria-busy', 'true'); go.replaceChildren(spin()); err.hidden = true;
      let ok = false;
      try { const res = await post(API.put, {request: r.id, value: inp.value, keep, use: keep === 'save' ? use : 'ask'}); ok = res.ok && (await res.json().catch(() => null))?.ok === true; } catch {}
      busy = false; go.removeAttribute('aria-busy'); go.replaceChildren(document.createTextNode('넣기'));
      if (field !== inp){ inp.value = ''; return; }   // 그 사이 닫음 · 다른 화면
      if (!ok){ err.textContent = ERR; err.hidden = false; go.disabled = !inp.value; inp.focus?.(); return; }   // 값은 칸에 그대로 — 다시 시도
      wipe();
      reqs = reqs.filter(x => x !== r); drawBand(); setLocks();
      done('넣었어요');
    }
    go.addEventListener('click', send);
    body.replaceChildren(why, inp, keepSeg.el, useSeg.el, note, err, go);
    setFocus([inp, ...keepSeg.btns, ...useSeg.btns, go]);
    inp.focus?.();
  }
  // 허락
  function allowView(u){
    wipe(); S.view = 'allow'; head(str(u.label) || '저장한 값', true);
    const who = line('bx-es-who', `${str(u.site) || '사이트'} 에 넣으려 해요 · ${str(u.agent) || '에이전트'}`);
    const why = line('bx-es-why', str(u.why)); why.hidden = !str(u.why);
    const err = line('bx-es-err', ''); err.hidden = true; err.setAttribute('role', 'alert');
    const row = mk('div', 'bx-es-row'), no = btn('bx-es-ghost', '거절'), yes = btn('bx-es-go', '허락');
    row.append(no, yes);
    async function send(ok_){
      if (busy) return;
      busy = true; no.disabled = yes.disabled = true; const b = ok_ ? yes : no, t = b.textContent;
      b.setAttribute('aria-busy', 'true'); b.setAttribute('aria-label', t); b.replaceChildren(spin()); err.hidden = true;
      let ok = false;
      try { const res = await post(API.allow, {use: u.id, ok: ok_}); ok = res.ok && (await res.json().catch(() => null))?.ok === true; } catch {}
      busy = false; no.disabled = yes.disabled = false; b.removeAttribute('aria-busy'); b.removeAttribute('aria-label'); b.replaceChildren(document.createTextNode(t));
      if (S.view !== 'allow') return;
      if (!ok){ err.textContent = ERR; err.hidden = false; return; }
      uses = uses.filter(x => x !== u); drawBand(); setLocks();
      list();
    }
    no.addEventListener('click', () => send(false)); yes.addEventListener('click', () => send(true));
    body.replaceChildren(who, why, err, row);
    setFocus([no, yes]);
    yes.focus?.();
  }
  // 「넣었어요」 한 줄 뒤 목록
  function done(t){
    S.view = 'done'; head('비밀값', false);
    const p = line('bx-es-done', t); p.setAttribute('role', 'status');
    body.replaceChildren(p); setFocus([]); closeB.focus?.();
    setTimeout(() => { if (S.open && S.view === 'done') list(); }, 1200);
  }

  window.BX_EA_SECRET = {load, state: () => ({on, requests: reqs.length, uses: uses.length, open: S.open, view: S.view})};   // 시험 · 확인용(값 없음)
  load();
})();
