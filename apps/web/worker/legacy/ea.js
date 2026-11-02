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
  const work = () => [];
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
  const PLUS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const meName = () => window.HB_MEMBER?.name || window.BX_ME?.name || 'Owner';
  list.innerHTML = `<div class="bx-ea-bar" aria-hidden="true"><b>비서</b></div><div class="bx-ea-title bx-ea-top"><span class="bx-ea-me" aria-hidden="true"></span><span class="bx-ea-gap"></span><button type="button" class="bx-ea-find bx-ea-circ" aria-label="찾기">${lu('search', 20)}</button><button type="button" class="bx-ea-compose bx-ea-circ" aria-label="새 대화">${PLUS}</button></div>`
    + `<div class="bx-ea-sc"><div class="bx-ea-pins" role="list" aria-label="고정된 대화" hidden></div><div class="bx-ea-rows" role="list"></div></div>`;
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
      out.add('c:primary');   // 목록 = 기능별 비서라 영역 · 일 줄이 없음 — 비서 줄에 자물쇠
      if (k) continue;
    }
    return out;
  }
  const IBC = () => { try { return window.HBInbox?.counts?.() || {}; } catch { return {}; } };
  const ATTN = () => { try { return typeof attnCount === 'function' ? attnCount() || 0 : 0; } catch { return 0; } };
  const hm = d => d.toLocaleTimeString('ko-KR', {hour: 'numeric', minute: '2-digit'});
  const when = ts => { if (!ts || !isFinite(+ts)) return ''; const d = new Date(+ts * 1000), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1);
    return d.toDateString() === n.toDateString() ? hm(d) : d.toDateString() === y.toDateString() ? '어제' : `${d.getMonth() + 1}/${d.getDate()}`; };
  const lastOf = ch => { try { const m = typeof CS !== 'undefined' ? CS.ch?.[ch]?.messages : null; const x = m && m[m.length - 1]; return x ? {ts: x.ts, text: String(x.text || '').replace(/[*_`>~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)} : null; } catch { return null; } };
  const BOTS = [
    {k: 'c:primary', name: () => pinName('primary'), av: () => pinAv('primary'), pre: () => lastOf('primary')?.text || '무엇이든 맡겨 주세요', at: () => lastOf('primary')?.ts, n: () => 0, open: () => fn('openChan') && openChan('primary')},
    {k: 'c:i:unread', name: () => '슬랙 인박스', av: () => 'slack inbox', pre: () => IBC().unread ? `읽지 않은 글 ${IBC().unread}개` : '새 글이 없어요', at: () => { try { return Math.max(0, ...(window.HBInbox?.state?.unread || []).map(x => +x.ts || 0)) || null; } catch { return null; } }, n: () => IBC().unread || 0, open: () => window.HBInbox?.openFeed?.('unread')},
    {k: 'c:i:turn', name: () => '할 일 관리', av: () => 'todo', pre: () => ATTN() ? `내 차례 ${ATTN()}개` : '할 일이 없어요', at: () => { try { return Math.max(0, ...(window.HBInbox?.state?.turn || []).map(x => +x.ts || 0)) || null; } catch { return null; } }, n: () => ATTN(), open: () => window.HBInbox?.openFeed?.('turn')},
    {k: 'c:shop', name: () => '상담봇', av: () => 'counsel bot', pre: () => lastOf('shop')?.text || '채널톡 상담 답 초안을 올려요', at: () => lastOf('shop')?.ts, n: () => 0, open: () => fn('openChan') && openChan('shop')},
  ];
  function data(){
    const ws = work(), lk = locks(ws);
    return {ws, lk, open: openKey(),
      sig: [BOTS.map(b => b.name() + b.pre() + when(b.at?.()) + (unread(b.k.slice(2)) ? '*' : '')).join(','), meName(), PINS.map(k => pinName(k) + (unread(k) ? '*' : '')).join(','), [...lk].sort().join(','), ...ws.map(p => [p.pane, nm(p), status(p), preview(p), ago(p.last?.ago), rows(p.pane)].join('\u0001'))].join('\u0002')};
  }
  let sig = null;
  function draw(force){
    const d = data(), s = d.sig + '#' + d.open + '#' + (PC.matches ? 1 : 0);
    if (!force && s === sig) return;
    sig = s;
    pinsEl.innerHTML = '';
    const me = list.querySelector('.bx-ea-me'); if (me && me.dataset.n !== meName()){ me.dataset.n = meName(); me.innerHTML = av(meName(), 40); }
    rowsEl.innerHTML = BOTS.map(b => row(b.k, b.name(), av(b.av(), 44), when(b.at?.()), b.pre(), b.n() > 0 || unread(b.k.slice(2)), d.open === b.k, d.lk.has(b.k), '')).join('') + d.ws.map(p => row('n:' + p.pane, nm(p), av(nm(p), 44), ago(p.last?.ago), preview(p) === status(p) ? '' : preview(p), rows(p.pane) > 0, d.open === 'n:' + p.pane, d.lk.has('n:' + p.pane), status(p))).join('');
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
    const bot = BOTS.find(b => b.k === k);
    const name = bot ? bot.name() : ck ? pinName(ck) : p ? nm(p) : AN()[c?.chan] || c?.chan || '';
    const avn = bot ? bot.av() : ck ? pinAv(ck) : name;
    const ta = document.getElementById('cnew'); if (ta && name && ta.placeholder !== name + '에게 묻기') ta.placeholder = name + '에게 묻기';   // Grok 「Ask SLMob」 꼴
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
  rowsEl.addEventListener('click', e => { const r = e.target.closest('.bx-ea-row'); if (!r?.dataset.k) return; if (openKey() === r.dataset.k) return; const b = BOTS.find(x => x.k === r.dataset.k); if (b) return b.open(); go(r.dataset.k); });
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
  let compose = null;
  function closeCompose(){
    if (!compose) return;
    const back = compose.back; compose = null; scrim.hidden = true;
    R.classList.toggle('bx-en-open', false); back?.focus?.();
  }
  function openCompose(){
    if (compose) return;
    closeMenu();
    const s = compose = {back: document.activeElement, selected: null, options: [], index: -1, focus: null};
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
    pill.append(text, start); to.append(label, input, chip); body.replaceChildren(to, options, pill);
    function highlight(){
      const els = [...options.querySelectorAll('[role="option"]')];
      els.forEach((el, i) => el.setAttribute('aria-selected', String(i === s.index)));
      if (s.index >= 0){ input.setAttribute('aria-activedescendant', 'bx-en-option-' + s.index); els[s.index]?.scrollIntoView?.({block: 'nearest'}); }
      else input.removeAttribute('aria-activedescendant');
    }
    function render(){
      const q = input.value.toLowerCase();
      s.options = BOTS.map(b => ({title: b.name(), bot: b})).filter(f => !q || f.title.toLowerCase().includes(q));
      s.index = -1; input.setAttribute('aria-expanded', String(!s.selected)); highlight();
      options.replaceChildren(...s.options.map((f, i) => {
        const opt = mk('div', 'bx-en-option'); opt.id = 'bx-en-option-' + i; opt.setAttribute('role', 'option'); opt.setAttribute('aria-selected', 'false');
        opt.append(mk('span', 'bx-en-avatar', av(f.bot.av(), 32)));
        const tx = mk('span', 'bx-es-ct'); tx.append(textEl('b', '', f.title), textEl('span', 'bx-es-sub', f.bot.pre())); opt.append(tx);
        opt.addEventListener('click', () => select(f)); return opt;
      }));
    }
    function select(f){
      s.selected = f; chipName.textContent = f.title;
      chip.hidden = false; input.hidden = true; options.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
      start.disabled = false; text.focus();
    }
    clear.addEventListener('click', () => {
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
    function send(){   // 고른 비서 대화를 열고 첫 말을 그 입력칸에(보내지 않음) — 모아 보기 비서(인박스 · 할 일)는 입력칸이 없어 열기만
      if (!s.selected || compose !== s) return;
      const b = s.selected.bot, value = text.value; closeCompose(); b.open();
      const c = b.k.startsWith('c:i:') ? null : document.getElementById('cnew');
      if (c){ c.value = value; c.dispatchEvent(new Event('input', {bubbles: true})); c.focus(); }
    }
    start.addEventListener('click', send);
    s.focus = () => [closeB, ...(s.selected ? [clear] : [input]), text, start].filter(e => !e.disabled && !e.hidden);
    render(); scrim.hidden = false; R.classList.toggle('bx-en-open', true); input.focus();
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

  let sepBusy = false;
  function seps(){
    const feed = ans.querySelector && ans.querySelector('#cfeed'); if (!feed || sepBusy) return;
    sepBusy = true;
    try {
      const bottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48, top0 = feed.scrollTop, added = [];
      const want = [], ms = [...feed.querySelectorAll('.msg[data-mts]')].filter(m => !m.closest('.cth, .croot, .itm'));
      let prev = 0;
      for (const m of ms){ const t = +m.dataset.mts; if (!isFinite(t)) continue; if (!prev || t - prev > 900) want.push([m, t]); prev = t; }
      const have = new Map([...feed.querySelectorAll('.bx-ea-tsep')].map(e => [e.nextElementSibling, e]));
      for (const e of have.values()) if (!want.some(([m]) => m === e.nextElementSibling)) e.remove();
      for (const [m, t] of want){ const d = new Date(t * 1000), lab = (d.toDateString() === new Date().toDateString() ? '오늘 ' : `${d.getMonth() + 1}월 ${d.getDate()}일 `) + hm(d);
        const e = have.get(m); if (e){ if (e.textContent !== lab) e.textContent = lab; continue; }
        const x = document.createElement('div'); x.className = 'bx-ea-tsep'; x.textContent = lab; m.parentNode.insertBefore(x, m); added.push(x); }
      if (added.length){
        if (bottom) feed.scrollTop = feed.scrollHeight;
        else { let dy = 0; for (const x of added) if (x.offsetTop < top0) dy += x.offsetHeight + 24; if (dy) feed.scrollTop = top0 + dy; }   // 보던 글 그대로(위에 들어간 줄 높이 + 위아래 여백 24)
      }
    } finally { sepBusy = false; }
  }
  new MutationObserver(() => { if (!sepBusy) requestAnimationFrame?.(seps) ?? seps(); }).observe(ans, {childList: true, subtree: true});
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
