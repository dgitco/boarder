(() => {
  if (!window.BX_EA || !window.HB_LIVE || typeof ans === 'undefined' || !ans) return;
  const R = document.documentElement, PC = matchMedia('(min-width: 861px)');
  R.classList.add('bx-ea');
  const VID = w => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="13" height="12" rx="3"/><path d="m15.5 10.5 5-3v9l-5-3z"/></svg>`;
  const LEX = {blob: () => typeof blob === 'function' ? blob : null, nameOf: () => typeof nameOf === 'function' ? nameOf : null, nodeRows: () => typeof nodeRows === 'function' ? nodeRows : null,
    leadPane: () => typeof leadPane === 'function' ? leadPane : null, esc: () => typeof esc === 'function' ? esc : null, look: () => typeof look === 'function' ? look : null};
  const fn = n => LEX[n] ? LEX[n]() : typeof window[n] === 'function' ? window[n] : null;
  const E = s => fn('esc') ? esc(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  // 아이콘 = 보드 Lucide(LU) — 그 판에 없는 이름이면 같은 선 그림(Lucide 경로)으로
  const LP = {pencil: '<path d="m16 3 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-5-3L3 16l-1 6z"/>', search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', 'chevron-left': '<path d="m15 18-6-6 6-6"/>', 'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>'};
  const lu = (n, w = 20) => { let s = ''; try { s = window.LU ? window.LU(n, w) || '' : ''; } catch {} return s || `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LP[n] || ''}</svg>`; };
  const av = (name, n) => { try { return fn('blob') ? blob(name, n) : ''; } catch { return ''; } };
  const P = () => typeof panes !== 'undefined' && Array.isArray(panes) ? panes : [];
  const BY = () => typeof byPane !== 'undefined' && byPane ? byPane : {};
  const C = () => typeof cur !== 'undefined' ? cur : null;
  const AN = () => typeof AREA_NAME === 'object' && AREA_NAME ? AREA_NAME : {};
  const PINS = ['primary', 'company', 'shop', 'dgit', 'personal'], PIN0 = {primary: '비서', company: '회사', shop: '가게', dgit: 'DGit', personal: '퍼스널'};
  const pinName = k => k === 'primary' ? '비서' : String(AN()[k] || '').replace(/\s*리드\s*/g, ' ').trim() || PIN0[k];
  const pinAv = k => AN()[k] || PIN0[k];
  // 읽지 않음 = shell.js lists() 의 by(k) 와 같은 판정
  const unread = k => { try { return (window.HBInbox?.state?.unread || []).some(x => x && x.chan === k); } catch { return false; } };
  const nm = p => { try { return fn('nameOf') ? nameOf(p) : (p.win || p.pane); } catch { return p.pane; } };
  const rows = pane => { try { return fn('nodeRows') ? (nodeRows(pane) || []).length : 0; } catch { return 0; } };
  const preview = p => { if (!p) return ''; let s = ''; try { s = p.last?.short && p.last.short_ok !== false ? p.last.short : fn('look') ? look(p)?.s || '' : ''; } catch {} return String(s || ''); };
  const STATUS = {spin: '일하는 중', wait: '막힘', stall: '멈춤', watch: '지켜보는 중', idle: '쉬는 중', done: '끝'};
  const status = p => { try { const g = fn('look') ? look(p)?.g : ''; return Object.hasOwn(STATUS, g) ? STATUS[g] : ''; } catch { return ''; } };
  // 시각 = 「ago」 꼴(p.last.ago 분)
  const ago = m => m == null || !isFinite(+m) ? '' : +m < 1 ? '방금' : +m < 60 ? Math.round(+m) + '분' : +m < 1440 ? Math.round(+m / 60) + '시간' : Math.round(+m / 1440) + '일';
  const lastId = p => +(p?.last?.id || 0) || 0;
  const agoOf = p => p?.last && p.last.ago != null && isFinite(+p.last.ago) ? +p.last.ago : Infinity;
  const work = () => P().filter(p => !['primary', 'arealead', 'helper'].includes(p.kind)).map((p, i) => [p, i]).sort((a, b) => lastId(b[0]) - lastId(a[0]) || agoOf(a[0]) - agoOf(b[0]) || a[1] - b[1]).map(x => x[0]);
  const priPane = () => P().find(p => p.kind === 'primary') || null;
  function openKey(){
    const c = C(); if (ans.hidden || !c) return '';
    if (c.page && c.p) return 'n:' + c.p;
    if (c.tab === 'chat' && c.chan && c.chan.startsWith('n:') && c.p) return 'n:' + c.p;
    if (c.tab === 'chat' && c.chan) return 'c:' + c.chan;
    if (c.p) return 'n:' + c.p;
    return '?';
  }

  // ── 만들기: 목록(머리 · 찾기 · 줄) · 대화 머리 · 빈 오른쪽
  const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const list = mk('nav', 'bx-ea-list'); list.setAttribute('aria-label', '비서 대화');
  list.innerHTML = `<div class="bx-ea-bar" aria-hidden="true"><b>비서</b></div><div class="bx-ea-sc"><div class="bx-ea-title"><h1 class="bx-ea-big">비서</h1><button type="button" class="bx-ea-compose bx-ea-ib" aria-label="새 대화">${lu('pencil', 20)}</button></div>`
    + `<button type="button" class="bx-ea-find" aria-label="찾기">${lu('search', 16)}<span>찾기</span></button><div class="bx-ea-pins" role="list" aria-label="고정된 대화"></div><div class="bx-ea-rows" role="list"></div></div>`
    + `<div class="bx-ea-float"><button type="button" class="bx-ea-find" aria-label="찾기">${lu('search', 20)}<span>찾기</span></button><button type="button" class="bx-ea-compose bx-ea-ib" aria-label="새 대화">${lu('pencil', 22)}</button></div>`;
  const sc = list.querySelector('.bx-ea-sc'), rowsEl = list.querySelector('.bx-ea-rows'), pinsEl = list.querySelector('.bx-ea-pins'), bar = list.querySelector('.bx-ea-bar');
  const head = mk('div', 'bx-ea-h'); head.hidden = true;
  head.innerHTML = `<button type="button" class="bx-ea-back" aria-label="목록으로">${lu('chevron-left', 26)}</button>`
    + `<div class="bx-ea-who"><span class="bx-ea-av"></span><b></b><span class="bx-ea-chev" aria-hidden="true">›</span></div>`
    + `<span class="bx-ea-act"><button type="button" class="bx-ea-ib" data-ea="menu" aria-label="전화 또는 미팅" aria-haspopup="menu" aria-expanded="false" aria-controls="bx-ea-call-menu">${VID(22)}</button><span class="bx-ea-call-menu" id="bx-ea-call-menu" role="menu" aria-label="전화 또는 미팅" hidden><button type="button" role="menuitem" tabindex="-1" data-ea="call">${lu('phone', 18)}전화</button><button type="button" role="menuitem" tabindex="-1" data-ea="meet">${VID(18)}미팅</button></span></span>`;
  const empty = mk('div', 'bx-ea-empty', '<span>대화를 고르세요</span>');
  document.body.append(list, empty, head);

  // 큰 제목: 굴리면 작아져 머리 가운데(iOS)
  sc.addEventListener('scroll', () => bar.classList.toggle('on', sc.scrollTop > 34), {passive: true});

  // ── 줄 그리기 — 서명이 바뀐 때만(shell.js sync 처럼)
  const LOCK = '<svg class="bx-ea-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-label="비밀값 요청" role="img"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  const row = (k, name, av_, when, pre, dot, cur_, lock, chip) => `<button type="button" class="bx-ea-row" role="listitem" data-k="${E(k)}"${cur_ ? ' aria-current="true"' : ''}>`
    + (dot ? '<i class="bx-ea-dot" aria-label="내 차례"></i>' : '')
    + `<span class="bx-ea-ava">${av_}</span><span class="bx-ea-tx"><span class="bx-ea-l1"><b>${E(name)}</b>${chip ? `<span class="bx-ea-status${['막힘', '멈춤'].includes(chip) ? ' bx-ea-warning' : ''}">${E(chip)}</span>` : ''}${lock ? LOCK : ''}<time>${E(when)}</time>${lu('chevron-right', 14)}</span><span class="bx-ea-pv">${E(pre)}</span></span></button>`;
  const pin = (k, ud, cur_, lock) => `<button type="button" class="bx-ea-pin" role="listitem" data-k="${E(k)}"${cur_ ? ' aria-current="true"' : ''} aria-label="${E(pinName(k) + (ud ? ' · 읽지 않음' : '') + (lock ? ' · 비밀값 요청' : ''))}">`
    + `<span class="bx-ea-pa">${av(pinAv(k), 56)}${ud ? '<i class="bx-ea-ud"></i>' : ''}${lock ? `<i class="bx-ea-pl">${LOCK}</i>` : ''}</span><span class="bx-ea-pn">${E(pinName(k))}</span></button>`;
  // 자물쇠: 에이전트 이름 → 'c:<채널>'(고정 원) · 'n:<판>'(일 줄), 못 맞추면 비서 원
  function locks(ws){
    const out = new Set(), a = Array.isArray(window.BX_EA_LOCK) ? window.BX_EA_LOCK : [], low = s => String(s ?? '').trim().toLowerCase();
    for (const x of a){
      const q = low(x); if (!q) continue;
      const k = PINS.find(k => q === k || q === low(AN()[k]) || q === low(pinName(k)));
      if (k){ out.add('c:' + k); continue; }
      const p = ws.find(p => q === low(p.pane) || q === low(nm(p)) || (p.win && q === low(p.win)));
      out.add(p ? 'n:' + p.pane : 'c:primary');
    }
    return out;
  }
  function data(){
    const ws = work(), lk = locks(ws);
    return {ws, lk, open: openKey(),
      sig: [PINS.map(k => pinName(k) + (unread(k) ? '*' : '')).join(','), [...lk].sort().join(','), ...ws.map(p => [p.pane, nm(p), status(p), preview(p), ago(p.last?.ago), rows(p.pane)].join('\u0001'))].join('\u0002')};
  }
  const opening = [];
  let sig = null;
  function draw(force){
    const d = data(), s = d.sig + '#' + d.open + '#' + (PC.matches ? 1 : 0) + '#' + JSON.stringify(opening);
    if (!force && s === sig) return;
    sig = s;
    pinsEl.innerHTML = PINS.map(k => pin(k, unread(k), d.open === 'c:' + k, d.lk.has('c:' + k))).join('');
    rowsEl.innerHTML = opening.map(p => `<div class="bx-ea-row bx-en-pending" role="listitem"><span class="bx-ea-ava">${av(p.name, 44)}</span><span class="bx-ea-tx"><span class="bx-ea-l1"><b>${E(p.name)}</b>${p.error ? '' : '<span class="bx-ea-status">여는 중</span><span class="bx-es-spin" aria-hidden="true"></span>'}</span>${p.error ? '<span class="bx-ea-pv" role="alert">일시적인 오류가 발생했어요</span>' : ''}</span></div>`).join('') + d.ws.map(p => row('n:' + p.pane, nm(p), av(nm(p), 44), ago(p.last?.ago), preview(p) === status(p) ? '' : preview(p), rows(p.pane) > 0, d.open === 'n:' + p.pane, d.lk.has('n:' + p.pane), status(p))).join('');
    lay();
  }
  // 대화 머리 · 열림 표시
  function lay(){
    const k = openKey(), open = !!k;
    R.classList.toggle('bx-ea-open', open);
    head.hidden = !open; empty.hidden = open;
    if (!open || (head.dataset.k && !head.dataset.k.startsWith(k + '|'))) closeMenu();
    if (!open) return;
    const c = C(), p = k.startsWith('n:') ? BY()[k.slice(2)] : null;
    const ck = k.startsWith('c:') && PINS.includes(k.slice(2)) ? k.slice(2) : '';
    const name = ck ? pinName(ck) : p ? nm(p) : AN()[c?.chan] || c?.chan || '';
    const avn = ck ? pinAv(ck) : name;
    if (head.dataset.k !== k + '|' + name){ head.dataset.k = k + '|' + name; head.querySelector('.bx-ea-av').innerHTML = av(avn, 28); head.querySelector('.bx-ea-who b').textContent = name; }
    for (const r of rowsEl.querySelectorAll('.bx-ea-row')) r.toggleAttribute('aria-current', r.dataset.k === k);
    for (const r of pinsEl.querySelectorAll('.bx-ea-pin')) r.toggleAttribute('aria-current', 'c:' + r.dataset.k === k);
  }

  // ── 누르기
  function go(k){
    const pane = k.slice(2);
    if (fn('openNode')) { try { openNode(pane); } catch {} }
    setTimeout(() => { const c = C(); if ((ans.hidden || !c || c.p !== pane) && fn('openAns')) openAns({p: pane, page: true}); }, 0);   // openNode 가 판이 아니라 이름을 받는 판이어도 — 틀(shell.js)과 같은 길로
  }
  rowsEl.addEventListener('click', e => { const r = e.target.closest('.bx-ea-row'); if (!r?.dataset.k) return; if (openKey() === r.dataset.k) return; go(r.dataset.k); });
  pinsEl.addEventListener('click', e => { const r = e.target.closest('.bx-ea-pin'); if (!r || openKey() === 'c:' + r.dataset.k) return; if (fn('openChan')) openChan(r.dataset.k); });
  // 새 대화: 비밀값 시트와 같은 틀, 입력과 받는 곳만 여기서 그림.
  const scrim = mk('div', 'bx-es-scrim bx-en-scrim'); scrim.hidden = true;
  const sheet = mk('div', 'bx-es-sheet bx-en-sheet ph-no-capture');
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'bx-en-title');
  const sh = mk('div', 'bx-es-h'), title = mk('b', 'bx-es-title'), closeB = mk('button', 'bx-es-ib');
  title.id = 'bx-en-title'; title.textContent = '새 대화';
  closeB.type = 'button'; closeB.textContent = '×'; closeB.setAttribute('aria-label', '닫기');
  sh.append(mk('span'), title, closeB);
  const body = mk('div', 'bx-es-b'); sheet.append(mk('i', 'bx-es-grab'), sh, body); scrim.append(sheet); document.body.append(scrim);
  const ERR = '일시적인 오류가 발생했어요';
  let compose = null;
  function closeCompose(){
    if (!compose) return;
    const back = compose.back; compose = null; scrim.hidden = true;
    R.classList.toggle('bx-en-open', false); back?.focus?.();
  }
  function watchPane(pane, name){
    const item = {pane, name, error: false}; opening.unshift(item); draw(true);
    const until = Date.now() + 40000;
    const remove = () => { const i = opening.indexOf(item); if (i >= 0) opening.splice(i, 1); draw(true); };
    function check(){
      if (P().some(p => p.pane === pane)){ remove(); go('n:' + pane); return; }
      if (Date.now() >= until){ item.error = true; draw(true); setTimeout(remove, 2000); return; }
      setTimeout(check, 1000);
    }
    check();
  }
  function openCompose(){
    if (compose) return;
    closeMenu();
    const s = compose = {back: document.activeElement, selected: null, folders: [], options: [], index: -1, busy: false, focus: null};
    const textEl = (tag, cls, text) => { const e = mk(tag, cls); e.textContent = text; return e; };
    const to = mk('div', 'bx-en-to'), label = textEl('label', '', '받는 곳:'); label.setAttribute('for', 'bx-en-to');
    const input = mk('input', 'bx-en-input'); input.id = 'bx-en-to'; input.value = '';
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', 'bx-en-options'); input.setAttribute('autocomplete', 'off');
    const chip = mk('span', 'bx-en-chip'), chipName = mk('span'), clear = textEl('button', 'bx-es-ib', '×');
    clear.type = 'button'; clear.setAttribute('aria-label', '받는 곳 지우기'); chip.append(chipName, clear); chip.hidden = true;
    const options = mk('div', 'bx-en-options'); options.id = 'bx-en-options'; options.setAttribute('role', 'listbox'); options.setAttribute('aria-label', '받는 곳');
    const pill = mk('div', 'bx-en-pill'), text = mk('textarea', 'bx-en-text'); text.value = ''; text.rows = 1;
    text.placeholder = '첫 말(없어도 돼요)'; text.setAttribute('aria-label', '첫 말(없어도 돼요)');
    const start = textEl('button', 'bx-en-start', '↑'); start.type = 'button'; start.disabled = true; start.setAttribute('aria-label', '시작');
    const error = mk('p', 'bx-es-err'); error.hidden = true; error.setAttribute('role', 'alert');
    pill.append(text, start); to.append(label, input, chip); body.replaceChildren(to, options, error, pill);
    function highlight(){
      const els = [...options.querySelectorAll('[role="option"]')];
      els.forEach((el, i) => el.setAttribute('aria-selected', String(i === s.index)));
      if (s.index >= 0){ input.setAttribute('aria-activedescendant', 'bx-en-option-' + s.index); els[s.index]?.scrollIntoView?.({block: 'nearest'}); }
      else input.removeAttribute('aria-activedescendant');
    }
    function render(){
      const q = input.value.toLowerCase();
      s.options = [{title: '비서', primary: true}, ...s.folders].filter(f => !q || [f.title, f.path].some(v => String(v || '').toLowerCase().includes(q)));
      s.index = -1; input.setAttribute('aria-expanded', String(!s.selected)); highlight();
      options.replaceChildren(...s.options.map((f, i) => {
        const opt = mk('div', 'bx-en-option'); opt.id = 'bx-en-option-' + i; opt.setAttribute('role', 'option'); opt.setAttribute('aria-selected', 'false');
        if (f.primary) opt.append(mk('span', 'bx-en-avatar', av(pinAv('primary'), 32)));
        const tx = mk('span', 'bx-es-ct'); tx.append(textEl('b', '', f.title || f.path), textEl('span', 'bx-es-sub', f.primary ? '지금 비서 채널에 이어서' : f.path)); opt.append(tx);
        if (!f.primary && f.area) opt.append(textEl('span', 'bx-ea-status', PIN0[f.area] || f.area));
        opt.addEventListener('click', () => select(f)); return opt;
      }));
    }
    function select(f){
      if (s.busy) return;
      s.selected = f; chipName.textContent = f.title || f.path;
      chip.hidden = false; input.hidden = true; options.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
      start.disabled = false; text.focus();
    }
    clear.addEventListener('click', () => {
      if (s.busy) return;
      s.selected = null; chip.hidden = true; input.hidden = false; options.hidden = false; input.value = ''; start.disabled = true; render(); input.focus();
    });
    input.addEventListener('input', render);
    input.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (['ArrowDown', 'ArrowUp'].includes(e.key) && s.options.length){
        e.preventDefault(); s.index = s.index < 0 ? (e.key === 'ArrowDown' ? 0 : s.options.length - 1) : (s.index + (e.key === 'ArrowDown' ? 1 : s.options.length - 1)) % s.options.length; highlight();
      } else if (e.key === 'Enter'){ e.preventDefault(); if (s.index >= 0) select(s.options[s.index]); }
    });
    text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 154) + 'px'; });
    text.addEventListener('keydown', e => {
      if (e.key === 'Enter'){ e.stopPropagation?.(); if (!e.shiftKey && !e.isComposing){ e.preventDefault(); send(); } }
    });
    async function send(){
      if (s.busy || !s.selected || compose !== s) return;
      if (s.selected.primary){
        const value = text.value; closeCompose();
        if (fn('openChan')) openChan('primary');
        const c = document.getElementById('cnew');
        if (c){ c.value = value; c.dispatchEvent(new Event('input', {bubbles: true})); c.focus(); }
        return;
      }
      s.busy = true; start.disabled = clear.disabled = true; start.setAttribute('aria-busy', 'true'); start.replaceChildren(mk('span', 'bx-es-spin')); error.hidden = true;
      let result;
      try {
        const r = await window.fetch('api/session/new', {method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json', 'x-hb': '1'}, body: JSON.stringify({folder: s.selected.path, text: text.value})});
        if (r.ok) result = await r.json();
      } catch {}
      s.busy = false;
      if (result?.ok && result.pane){
        if (compose === s) closeCompose();
        watchPane(result.pane, result.name || s.selected.title || s.selected.path); return;
      }
      if (compose !== s) return;
      start.disabled = clear.disabled = false; start.removeAttribute('aria-busy'); start.textContent = '↑'; error.textContent = ERR; error.hidden = false;
    }
    start.addEventListener('click', send);
    s.focus = () => [closeB, ...(s.selected ? [clear] : [input]), text, start].filter(e => !e.disabled && !e.hidden);
    render(); scrim.hidden = false; R.classList.toggle('bx-en-open', true); input.focus();
    (async () => {
      try {
        const r = await window.fetch('api/session/folders', {credentials: 'same-origin'});
        if (!r.ok) return;
        const j = await r.json();
        if (compose !== s) return;
        s.folders = Array.isArray(j?.folders) ? j.folders.filter(f => f && typeof f.path === 'string') : []; render();
      } catch {}
    })();
  }
  closeB.addEventListener('click', closeCompose);
  scrim.addEventListener('click', e => { if (e.target === scrim) closeCompose(); });
  function composeKey(e){
    if (!compose) return;
    if (['Escape', 'Tab'].includes(e.key)) e.stopPropagation?.();
    if (e.key === 'Escape'){ e.preventDefault(); closeCompose(); }
    else if (e.key === 'Tab'){
      const f = compose.focus(), i = f.indexOf(document.activeElement);
      e.preventDefault(); f[e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length]?.focus();
    }
  }
  // body가 PC 채팅의 Esc를 막기 전에 시트에서 먼저 처리한다.
  scrim.addEventListener('keydown', composeKey);
  document.addEventListener('keydown', composeKey);
  for (const b of list.querySelectorAll('.bx-ea-compose')) b.addEventListener('click', openCompose);
  // 찾기 = 틀의 찾기(⌘K) 그대로 — 사이드바 찾기 단추를 누름, 없으면 ⌘K
  for (const find of list.querySelectorAll('.bx-ea-find')) find.addEventListener('click', () => {
    const b = document.querySelector('.bx-sb [data-go="find"]');
    if (b) return b.click();
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', metaKey: true, ctrlKey: true, bubbles: true}));
  });
  head.querySelector('.bx-ea-back').addEventListener('click', () => { if (fn('closeAns')) closeAns(); });
  function callPane(){
    const k = openKey();
    if (k.startsWith('n:')) return k.slice(2);
    const ch = k.startsWith('c:') && PINS.includes(k.slice(2)) ? k.slice(2) : 'primary';
    try { return fn('leadPane') ? leadPane(ch) || (ch === 'primary' ? priPane()?.pane : null) : ch === 'primary' ? priPane()?.pane : null; } catch { return ch === 'primary' ? priPane()?.pane : null; }
  }
  function call(){
    const V = window.HBV; if (!V) return note('통화를 열 수 없어요');
    if (V.call) return V.layout?.();
    const pane = callPane(); if (!pane) return note('통화할 판이 없어요');
    V.start?.({pane});
  }
  const tail = f => String(f || '').replace(/\/+$/, '').split('/').pop();
  function meet(){
    const A = typeof ARTS === 'object' && ARTS ? ARTS : {};
    const cs = Object.entries(A).filter(([, x]) => x && x.kind === 'canvas').map(([id, x]) => ({id, ...x})).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    if (!cs.length) return note('미팅할 캔버스가 없어요');
    const k = openKey(), p = k.startsWith('n:') ? BY()[k.slice(2)] : null, f = p?.folder ? tail(p.folder) : '';
    const pick = (f && cs.find(x => tail(x.folder) === f)) || cs[0];
    if (!fn('openArt')) return;
    const V = window.HBV, pane = callPane();
    let started = false;
    if (V && !V.call && pane) { try { V.start?.({pane}); started = !!V.call; } catch {} }
    const own = started;
    Promise.resolve(openArt(pick.id)).then(() => { if (fn('meetOn')) { meetOn(pick.id); try { if (own && typeof MEET === 'object' && MEET) MEET.own = true; } catch {} } }).catch(() => {});
  }
  const note = t => { if (fn('toast')) toast(t); };
  const menuButton = head.querySelector('[data-ea="menu"]'), menu = head.querySelector('.bx-ea-call-menu');
  const menuItems = [...menu.querySelectorAll('[role="menuitem"]')];
  function closeMenu(focus = false){
    menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false');
    if (focus) menuButton.focus();
  }
  function openMenu(last = false){
    if (window.HBV?.call) { closeMenu(); window.HBV.layout?.(); return; }
    menu.hidden = false; menuButton.setAttribute('aria-expanded', 'true');
    menuItems[last ? menuItems.length - 1 : 0].focus();
  }
  head.addEventListener('click', e => {
    const b = e.target.closest('[data-ea]'); if (!b) return;
    if (b === menuButton) { if (menu.hidden || window.HBV?.call) openMenu(); else closeMenu(true); return; }
    closeMenu(true); b.dataset.ea === 'call' ? call() : meet();
  });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && !menuButton.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => {
    if (menu.hidden){
      if (document.activeElement === menuButton && ['ArrowDown', 'ArrowUp'].includes(e.key)){ e.preventDefault(); openMenu(e.key === 'ArrowUp'); }
      return;
    }
    if (e.key === 'Escape'){ e.preventDefault(); closeMenu(true); }
    else if (['ArrowDown', 'ArrowUp'].includes(e.key)){
      e.preventDefault(); const i = menuItems.indexOf(document.activeElement);
      menuItems[(i + (e.key === 'ArrowDown' ? 1 : menuItems.length - 1)) % menuItems.length].focus();
    } else if (e.key === 'Enter' && menuItems.includes(document.activeElement)){ e.preventDefault(); document.activeElement.click(); }
    else if (e.key === 'Tab') closeMenu();
  });

  // ── 맞추기: 보드가 다시 그릴 때(redraw 감쌈) · 대화 칸이 열리고 닫힐 때 · 3초마다(늦게 오는 상태)
  const rd0 = fn('redraw');
  if (rd0) window.redraw = function(){ const r = rd0.apply(this, arguments); try { draw(); } catch {} return r; };
  new MutationObserver(() => { try { draw(); } catch {} }).observe(ans, {attributes: true, attributeFilter: ['hidden', 'class'], childList: true});   // 열린 채로 다른 대화로 바뀜(판을 새로 그림)도
  setInterval(() => { try { draw(); } catch {} }, 3000);
  PC.addEventListener('change', () => draw(true));
  try { window.HBInbox?.on?.(() => { try { draw(); } catch {} }); } catch {}   // 읽지 않음 바뀜(shell.js lists 와 같은 알림)
  addEventListener('bx-ea-lock', () => { try { draw(); } catch {} });
  draw(true);
})();
