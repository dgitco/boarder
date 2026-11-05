window.bxPushOff = async () => { if (!window.HB_MEMBER || !('serviceWorker' in navigator)) return;
  try { const reg = await navigator.serviceWorker.getRegistration(), sub = await reg?.pushManager.getSubscription(); if (!sub) return;
    await fetch('api/push/unsubscribe', {method: 'POST', headers: {'content-type': 'application/json', 'x-hb': '1'}, body: JSON.stringify({endpoint: sub.endpoint})}).catch(() => {}); await sub.unsubscribe(); } catch (e) {} };
(() => {
  if (!window.HB_LIVE || !window.show){ if (window.HB_ART0 && !window.HB_ART0.dataset.loaded) { window.HB_ART0.remove(); window.HB_ART0 = null; } return document.documentElement.classList.remove('bx-route'); }
  const MOBILE_ON = true;
  const R = document.documentElement, PC = matchMedia('(min-width: 861px)');
  const on = () => PC.matches || MOBILE_ON;
  const turnT = () => typeof TURN === 'string' ? TURN : (window.HB_MEMBER?.turn ?? '내 차례');   // 차례 글: 보드 TURN, 없으면 서버 HB_MEMBER.turn
  const capOn = k => window.HB_CAPS?.[k] ?? true;   // 기능 문(초대 · #메인 · 세션 첨부 …): 서버 능력값, 없으면 참(지금 주인)
  const xHeads = () => ((typeof D === 'object' && D?.areas) || []).filter(a => a && a.key !== 'primary' && a.lead && !(typeof CH !== 'undefined' && CH.includes(a.key)));
  const priFace = () => { const pa = ((typeof D === 'object' && D?.areas) || []).find(a => a && a.key === 'primary'); return pa && 'avatar' in pa ? pa.avatar : (typeof AGENT_CUSTOM === 'object' && AGENT_CUSTOM?.primary) || null; };
  const EMB = new URLSearchParams(location.search).get('embed') || '';
  const EMBED = /^(primary|company|personal|dgit|shop)$/.test(EMB) && window.parent !== window;
  if (EMBED) R.classList.add('bx-embed');
  try { if (localStorage.getItem('hb-still') === '1') R.classList.add('bx-still'); } catch {}   // 설정 › 모양 「움직임 줄이기」
  const svg = (d, w = 18) => `<svg width="${w}" height="${w}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const lu = (n, w = 18) => window.LU ? window.LU(n, w) : '';
  const I = {
    chat: lu('message-square'),
    node: lu('network'),
    hash: lu('hash'),
    feed: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2h18"/><rect width="18" height="12" x="3" y="6" rx="2"/><path d="M3 22h18"/></svg>`,
    canvas: lu('image'),
    unread: lu('message-square-dot'),
    saved: lu('bookmark'),
    copy: lu('copy'),
    invite: lu('user-plus'),
    sales: lu('layout-dashboard'),
    feedback: lu('message-square-text'),
    out: lu('log-out'),
    flag: lu('flag'),
    drafts: lu('pencil'),
    menu: lu('menu', 20),
    search: lu('search'),
    panel: lu('panel-left'),
    fold: lu('chevron-down', 13),
    gridv: lu('layout-grid', 16),
    listv: '<svg class="lu" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  };
  // PC 사이드바 안 A · B 아이콘(시안 hbFFjcBL1iHHtFRprbZczQ1q Icons 판): 피드 = 원래 홈(lucide house, 고르면 채움), 노드 = 보드 둥글이 선 그림(고르면 채움 · 눈 비움), 새 글 = lucide square-pen, 에이전트 = lucide bot
  const sv24 = (d, w = 20) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const HOUSE = (on) => sv24(`<path${on ? ' fill="currentColor"' : ''} d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path${on ? ' stroke="var(--surface)"' : ''} d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>`);
  const BLOB_D = 'M80.44 48.88C80.16 56.94 78.39 67.04 73.42 72.2C68.46 77.36 58.73 79.31 50.64 79.82C42.55 80.33 30.61 80.39 24.89 75.24C19.17 70.08 16.4 57.74 16.33 48.88C16.26 40.02 18.75 27.78 24.47 22.09C30.19 16.41 42.2 14.49 50.64 14.77C59.08 15.06 70.16 18.13 75.12 23.82C80.09 29.5 80.72 40.82 80.44 48.88Z';
  const NODEI = (on, w = 20) => `<svg width="${w}" height="${w}" viewBox="10 8 78 78" fill="none" aria-hidden="true"><path d="${BLOB_D}" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/><g stroke="${on ? 'var(--surface)' : 'currentColor'}" stroke-width="6.5" stroke-linecap="round"><line x1="40.5" y1="38" x2="40.5" y2="49"/><line x1="58" y1="38" x2="58" y2="48.5"/></g></svg>`;
  const IA = {house: HOUSE(false), houseOn: HOUSE(true), node: NODEI(false), nodeOn: NODEI(true),
    pen: sv24('<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>'),
    search: sv24('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
    bot: sv24('<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>'),
    hash: sv24('<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>', 17),
    a2a: sv24('<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>', 17)};
  const IBK = ['unread', 'saved', 'drafts'], IBN = {unread: '읽지 않음', saved: '저장', drafts: '초안'};
  const ibKey = h => String(h || '').slice(1).replace(/^unread\?msg=\d{10}\.\d{6}$/, 'unread');   // #unread?msg=<글>(읽지 않음의 그 글 주소)도 모아 보기 열쇠로
  const S = {ib: null, chat: null, last: 'primary', ret: null};
  let ibM = null;
  const logo = '<span class="lgslot"></span>';
  const LG = {};
  function logoState(){
    const pp = typeof panes !== 'undefined' ? panes.find(x => x.kind === 'primary') : null;
    const m = pp && typeof moodOf === 'function' ? moodOf(pp) : 'idle';
    const n = typeof attnRows === 'function' ? (attnRows() || []).length : 0;
    return {m, n, key: `${m === 'blocked' ? 'sad' : n ? 'think' : 'rest'}`};
  }
  function logoEl(which){
    const st = logoState(), c = LG[which];
    const bf = priFace(), fk = bf ? `${bf.seed}|${bf.hue}|${bf.photo || ''}` : '';
    if (c && c.key === st.key && c.fk === fk){ c.el.title = c.el.ariaLabel = `${AREA_NAME.primary} 와 대화${st.n ? ` · ${turnT()} ${st.n}` : ''}${st.m === 'busy' ? ' · 일하는 중' : ''}`; return c.el; }
    const el = mk('button', 'lg lgb mood-' + st.key); el.type = 'button'; el.dataset.go = 'chan:primary';
    const ex = window.HB_EXPR || {};
    el.innerHTML = bf?.photo && window.BXBot?.live ? window.BXBot.live(bf, 34)
      : window.HB_BLOB_ANIM ? window.HB_BLOB_ANIM(bf?.seed || 'primary', {size: 34, background: false, animate: 'always', ...(bf ? {hue: bf.hue} : {}), ...(st.key === 'sad' ? {expression: ex.sad} : st.key === 'think' ? {expression: ex.thinking} : {})})
      : window.HB_BLOB ? window.HB_BLOB(bf?.seed || 'primary', {size: 34, background: false, ...(bf ? {hue: bf.hue} : {})}) : '<img src="icons/icon-192.png" alt="" width="32" height="32">';
    el.title = el.ariaLabel = `${AREA_NAME.primary} 와 대화${st.n ? ` · ${turnT()} ${st.n}` : ''}${st.m === 'busy' ? ' · 일하는 중' : ''}`;
    LG[which] = {key: st.key, fk, el}; return el;
  }
  const placeLogo = () => { for (const [w, box] of [['sb', sb], ['dr', dr]]){ const slot = box.querySelector('.lgslot') || box.querySelector('.top > .lgb'), el = slot && logoEl(w); if (el && el !== slot) slot.replaceWith(el); } };
  setInterval(() => { if (on()) { const k = logoState().key; if (LG.sb && LG.sb.key !== k) lists(); } }, 8000);
  const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const $id = id => document.getElementById(id);

  const sb = mk('nav', 'bx-sb'); sb.setAttribute('aria-label', '메뉴');
  const scrim = mk('div', 'bx-scrim');
  const SBW = [200, 480], RAIL = 72, TO_A = 160, TO_HIDE = 40, isW = w => w === RAIL || (w >= SBW[0] && w <= SBW[1]);
  const sbwSet = w => { R.classList.toggle('bx-rail', w === RAIL); if (w) R.style.setProperty('--bx-sbw', w + 'px'); else R.style.removeProperty('--bx-sbw'); };
  const sbwKeep = w => { try { if (w) localStorage.setItem('hb-sbw', String(w)); else localStorage.removeItem('hb-sbw'); } catch {} window.bxUiSave?.('sbw', String(w || 0)); };
  sbwSet((() => { try { const w = +localStorage.getItem('hb-sbw'); return isW(w) ? w : 0; } catch { return 0; } })());
  const rz = mk('div', 'bx-sbrz'); rz.setAttribute('role', 'separator'); rz.setAttribute('aria-orientation', 'vertical'); rz.setAttribute('aria-label', '사이드바 폭 — 끌어서 목록 · 아이콘 막대 · 숨김, 두 번 누르면 기본'); rz.title = '끌어서 사이드바 폭 바꾸기(좁히면 아이콘 막대 · 더 좁히면 숨김) · 두 번 누르면 기본'; rz.tabIndex = 0;
  const sbwNow = () => parseInt(getComputedStyle(R).getPropertyValue('--bx-sbw')) || 264, clampW = w => Math.round(Math.min(SBW[1], Math.max(SBW[0], w)));
  const feedOn = () => R.classList.contains('bx-x') && !R.classList.contains('xnodes');
  const stepOf = x => !feedOn() ? clampW(x) : x < TO_HIDE ? 0 : x < TO_A ? RAIL : clampW(x);   // 0 = 숨김
  const keepW = w => sbwKeep(w === 264 ? 0 : w);
  rz.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.preventDefault(); rz.setPointerCapture(e.pointerId); R.classList.add('bx-sbdrag');
    const w0 = sbwNow(), fd = feedOn();
    if (!fd && w0 === RAIL){ sbwSet(0); }   // 피드 밖은 막대가 없음 — 보이는 폭(기본)에서 끌기 시작
    // 숨김은 끄는 동안 미리 보기만(bx-colpv — 손잡이는 남아 계속 끌 수 있음), 놓을 때 접음
    const mv = ev => { const s = stepOf(ev.clientX); R.classList.toggle('bx-colpv', !s); if (s) sbwSet(s); tipOff(); };
    const up = () => { rz.removeEventListener('pointermove', mv); R.classList.remove('bx-sbdrag');
      if (R.classList.contains('bx-colpv')){ R.classList.remove('bx-colpv'); sbwSet(w0 === 264 ? 0 : w0); return setCol(true); }
      keepW(sbwNow()); };
    rz.addEventListener('pointermove', mv); rz.addEventListener('pointerup', up, {once: true}); rz.addEventListener('pointercancel', up, {once: true});
  });
  rz.addEventListener('dblclick', () => { sbwSet(0); sbwKeep(0); });
  rz.addEventListener('keydown', e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault();
    const w = sbwNow(), n = !feedOn() ? clampW(w + (e.key === 'ArrowRight' ? 16 : -16)) : e.key === 'ArrowRight' ? (w === RAIL ? SBW[0] : clampW(w + 16)) : (w === RAIL ? 0 : w <= SBW[0] ? RAIL : clampW(w - 16));
    if (!n) return setCol(true); sbwSet(n); keepW(n); });
  window.BXSideW = w => sbwSet(isW(w) ? w : 0);   // settings.js 가 계정 값을 받으면 부름
  // 막대(안 B)에서 마우스를 올리면 이름(시안 「마우스 올리면 이름」) — 사이드바는 굴림 칸이라 밖(body)에 하나 띄움
  const tip = mk('div', 'bx-tip'); tip.hidden = true; tip.setAttribute('aria-hidden', 'true');
  const tipOff = () => { tip.hidden = true; };
  const dr = mk('nav', 'bx-dr'); dr.setAttribute('aria-label', '메뉴'); dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true');
  const menu = mk('button', 'bx-menu bx-glass', I.menu); menu.type = 'button'; menu.setAttribute('aria-label', '메뉴');
  const cmb = mk('button', 'bx-chatmenu', lu('chevron-left', 22)); cmb.type = 'button'; cmb.setAttribute('aria-label', '목록');
  cmb.addEventListener('click', () => openDr());
  const seg = mk('div', 'bx-seg', '');
  seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', '트리 보기');
  const cap = mk('div', 'bx-cap bx-glass');
  const ibox = mk('section', 'bx-inbox'); ibox.hidden = true;
  const hr = document.querySelector('header .hr'), hrt = hr.querySelector('.hrt');
  hr.prepend(menu, seg);
  document.querySelector('.wrap header').after(ibox);
  // 「에이전트」 화면(안 A · B 공통, 시안 Agents 판): 위 탭 에이전트 · 채널 · A2A 로 옛 사이드바 칸(에이전트 · 채널/태스크 + 세션 · 에이전트 채널)을 본 칸에. 주소 #agents[/channels|/a2a]
  const agBox = mk('section', 'bx-agp'); agBox.hidden = true; agBox.setAttribute('aria-label', '에이전트');
  ibox.after(agBox);
  document.body.append(sb, rz, scrim, dr, cmb, tip);
  sb.addEventListener('pointerover', e => {
    if (!R.classList.contains('bx-rail') || !feedOn() || R.classList.contains('bx-sbdrag')) return tipOff();
    const b = e.target.closest?.('.bx-it, .lgb, .bx-me, .bx-tools button'); if (!b || !sb.contains(b)) return tipOff();
    const t = (b.querySelector(':scope > span')?.textContent || b.getAttribute('aria-label') || b.title || '').trim(), n = b.querySelector(':scope > .n')?.textContent || '';
    if (!t) return tipOff();
    const r = b.getBoundingClientRect(); tip.textContent = n ? `${t} ${n}` : t; tip.style.left = Math.round(r.right + 10) + 'px'; tip.style.top = Math.round(r.top + r.height / 2) + 'px'; tip.hidden = false;
  });
  sb.addEventListener('pointerleave', tipOff); sb.addEventListener('pointerdown', tipOff); sb.addEventListener('scroll', tipOff, true);
  const exp = mk('button', 'bx-colb bx-exp'); exp.type = 'button'; exp.setAttribute('aria-label', '사이드바 펴기'); exp.title = '펴기'; exp.innerHTML = I.panel; exp.addEventListener('click', () => setCol(false)); document.body.append(exp);
  const tools = mk('div', 'bx-tools');
  function place(){
    const t = [$id('h-push')].filter(Boolean), at = $id('h-attn'), call = $id('h-call');
    R.classList.toggle('bx', on());
    if (on()) tools.append(...t); else hrt.append(...t);
    if (PC.matches && on()){ const dk = hrt.querySelector('.bx-dockb'); if (call && call.parentElement !== hrt) dk ? dk.after(call) : hrt.prepend(call); if (at && call) call.before(at); cap.remove(); closeDr(); }
    else if (!on()){ if (at && at.parentElement !== hr) $id('h-stall').before(at); if (call && call.parentElement !== hrt) hrt.prepend(call); cap.remove(); closeDr(); }
    else { cap.append(...[at, call].filter(Boolean)); hr.append(cap); }
    if (!on()){ ibClose(); R.classList.remove('bx-chat', 'bx-ib'); }
    artsLay();
  }
  new MutationObserver(() => $id('h-call')?.classList.toggle('bx-live', !!window.HBV?.call)).observe(document.body, {childList: true});

  const cnt = (v, red) => v ? `<span class="n${red ? ' red' : ''}">${v > 99 ? '99+' : v}</span>` : '';
  const it = (go, icon, label, extra, cur) => `<button type="button" class="bx-it" data-go="${go}"${cur ? ' aria-current="page"' : ''}>${icon}<span>${label}</span>${extra || ''}</button>`;
  // 접기 상태(섹션 셋 · PC 사이드바 « ») — 이 브라우저에만
  const SB = (() => { try { return JSON.parse(localStorage.getItem('bx-sb')) || {}; } catch { return {}; } })();
  SB.fold = SB.fold || {};
  const saveSB = () => { try { localStorage.setItem('bx-sb', JSON.stringify(SB)); } catch {} };
  const chats = () => Array.isArray(window.HB_CHATS) ? window.HB_CHATS : [];
  const recent = () => Object.entries(ARTS || {}).map(([id, x]) => ({id, ...x})).sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 5);
  const sec = (k, name, body) => `<button type="button" class="bx-sec bx-fh" data-fold="${k}" aria-expanded="${!SB.fold[k]}">${name}${I.fold}</button><div class="bx-sbody" data-sec="${k}"${SB.fold[k] ? ' hidden' : ''}>${body}</div>`;
  const SIDE_DEF = af => ['ib', ...(af ? ['ch', 'nd'] : ['nd', 'ch']), 'rc', 'ss', 'xc'];
  const sideOrder = af => { const d = SIDE_DEF(af), o = (SB.order || []).filter(k => d.includes(k)); for (const k of d) if (!o.includes(k)) o.splice(Math.min(d.indexOf(k), o.length), 0, k); return o; };
  window.addEventListener('hbpins', e => { SB.pins = e.detail; saveSB(); lists(); });   // 설정 › 모양에서 고침
  window.addEventListener('hbhide', e => { SB.hide = e.detail; saveSB(); lists(); });
  const sideSave = o => { SB.order = o; saveSB(); fetch('api/me/side', {method: 'POST', headers: {'content-type': 'application/json', 'x-hb': '1'}, body: JSON.stringify({side: o})}).catch(() => {}); };
  fetch('api/me/side', {cache: 'no-store'}).then(r => r.ok ? r.json() : null).then(j => { if (j && Array.isArray(j.side) && JSON.stringify(j.side) !== JSON.stringify(SB.order || null)){ SB.order = j.side; saveSB(); if (on()) lists(); } if (j && Array.isArray(j.pins) && JSON.stringify(j.pins) !== JSON.stringify(SB.pins || [])){ SB.pins = j.pins; saveSB(); if (on()) lists(); } if (j && Array.isArray(j.hide) && JSON.stringify(j.hide) !== JSON.stringify(SB.hide || [])){ SB.hide = j.hide; saveSB(); if (on()) lists(); } }).catch(() => {});   // 다른 기기에서 바꾼 순서
  // 끌기: 칸 머리(접기 단추)를 누른 채 6px 넘게 움직이면 끌기 — 놓은 자리 위아래로 칸을 옮김. 덜 움직이면 그대로 접기
  document.addEventListener('pointerdown', e => {
    const h = e.button === 0 && e.target.closest?.('.bx-sbsc .bx-sec[data-fold]:not(.bx-sub)'); if (!h) return;
    const box = h.closest('.bx-sbsc'), k0 = h.dataset.fold, y0 = e.clientY, x0 = e.clientX; let on = false, mark = null, to = null;
    const heads = () => [...box.querySelectorAll('.bx-sec[data-fold]')].filter(x => ['ib', 'nd', 'ch', 'rc', 'ss', 'xc'].includes(x.dataset.fold));
    const move = ev => {
      if (!on){ if (Math.abs(ev.clientY - y0) + Math.abs(ev.clientX - x0) < 6) return; on = true; h.classList.add('bx-drag'); R.classList.add('bx-sbdrag'); try { h.setPointerCapture(e.pointerId); } catch {} }
      ev.preventDefault();
      const hs = heads(); to = hs.length; for (let i = 0; i < hs.length; i++){ const b = hs[i].getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2){ to = i; break; } }
      mark?.remove(); mark = document.createElement('i'); mark.className = 'bx-dropln';
      const at = hs[to], sb2 = at ? (at.closest('.bx-sech') || at) : null; if (sb2) sb2.before(mark); else box.append(mark);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      mark?.remove(); h.classList.remove('bx-drag'); R.classList.remove('bx-sbdrag'); if (!on || to == null) return;
      const ks = heads().map(x => x.dataset.fold), from = ks.indexOf(k0); if (from < 0) return;
      const nk = ks.slice(); nk.splice(from, 1); nk.splice(to > from ? to - 1 : to, 0, k0);
      const af = window.HB_MEMBER?.unit === 'agent', full = sideOrder(af), rest = full.filter(k => !nk.includes(k));   // 비어서 안 보이는 칸은 원래 이웃 뒤에 그대로
      const out = nk.slice(); for (const k of rest){ const i = full.indexOf(k), prev = full.slice(0, i).reverse().find(x => out.includes(x)); out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, k); }
      sideSave(out); swallow = true; setTimeout(() => { swallow = false; }, 0); lists();
    };
    addEventListener('pointermove', move, {passive: false}); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }, true);
  let swallow = false; document.addEventListener('click', e => { if (swallow && e.target.closest?.('.bx-sec[data-fold]')){ e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);   // 끌고 놓은 누름은 접기가 아님
  function lists(){
    const st = window.HBInbox?.state || {}, c = window.HBInbox?.counts?.() || {};
    const by = k => (st.unread || []).some(x => x.chan === k);
    const act = active(), top = S.ib || ibChat() ? null : act, chan = chatMode() && !cur.page && cur.chan;
    const tn = typeof attnCount === 'function' ? attnCount() : 0;
    const ib = it('turn', I.flag, '결정 · 할 일', cnt(tn, true), ibChat() === 'turn') + IBK.map(k => it(k, I[k], IBN[k], cnt(c[k], k === 'unread'), S.ib === k || ibChat() === k)).join('');
    const MA = xHeads().filter(a => typeof byPane !== 'undefined' && byPane[a.lead] && (!byPane[a.lead].tk || byPane[a.lead].tkdept))
    const RS = (typeof D === 'object' && Array.isArray(D?.role_seats)) ? D.role_seats : null;
    const MA2 = RS ? MA.filter(a => byPane[a.lead]?.tkdept && RS.includes(a.seat_name || AREA_NAME[a.key] || a.lead_name || a.name)) : MA;
    const pg = !ans.hidden && !!cur?.page && cur.p;
    const chP = CH.map(k => it('chan:' + k, blob(AREA_NAME[k], 20), esc(AREA_NAME[k]), by(k) ? '<i class="ud" aria-label="읽지 않음"></i>' : '', chan === k)).join('');
    const RW = !RS ? (typeof panes !== 'undefined' ? panes : []).filter(p => p && p.rolewin && p.kind === 'lead' && !p.tk && !MA2.some(a => a.lead === p.pane)) : [], RWP = new Set(RW.map(p => p.pane));
    const ch = chP + MA2.map(a => it('chan:' + a.key, blob(AREA_NAME[a.key] || a.lead_name || a.name, 20), esc(AREA_NAME[a.key] || a.lead_name || a.name), rowPanes().has(a.lead) ? '<i class="ud" aria-label="내 차례"></i>' : '', pg === a.lead)).join('')
      + RW.map(p => it('node:' + p.pane, blob(nameOf(p), 20), esc(nameOf(p)), rowPanes().has(p.pane) ? '<i class="ud" aria-label="내 차례"></i>' : '', pg === p.pane)).join('');
    const rp = rowPanes();
    const nd = myNodes().filter(p => !RWP.has(p.pane)).map(p => it('node:' + p.pane, I.hash, esc(nameOf(p)), rp.has(p.pane) ? `<i class="ud" aria-label="${turnT()}"></i>` : '', !ans.hidden && !!cur?.page && cur.p === p.pane)).join('');
    // 사이드 「태스크」(채널 = 태스크를 켠 회원, 서버 member-board taskSide): 채널 대신 #번호 · 제목 · 상태. 진행 중 · 최근 글 순, 끝난 것은 접힌 「끝난 태스크」 안. 누르면 그 태스크 대화(노드 화면)
    const TS = (typeof D === 'object' && Array.isArray(D?.task_side)) ? D.task_side : null;
    const tkIt = t => `<button type="button" class="bx-it bx-task" data-go="node:${esc(t.pane)}" title="${esc(t.issue + ' ' + t.name)}"${!ans.hidden && !!cur?.page && cur.p === t.pane ? ' aria-current="page"' : ''}><b class="bx-tkno">${esc(t.issue.replace(/^.*#/, '#'))}</b><span>${esc(t.name)}</span>${rp.has(t.pane) ? `<i class="ud" aria-label="내 차례"></i>` : ''}<em class="bx-tkst" data-st="${esc(t.state)}">${esc(t.state_ko || '')}</em></button>`;
    const tkOpen = TS ? TS.filter(t => !t.done) : [], tkDone = TS ? TS.filter(t => t.done) : [];
    if (TS && SB.fold.tkd === undefined) SB.fold.tkd = true;   // 끝난 태스크는 처음엔 접힘(태스크 칸이 있는 사람만 — 없는 사람의 저장값은 main 그대로)
    const tks = TS ? tkOpen.map(tkIt).join('') + (tkDone.length ? `<button type="button" class="bx-sec bx-fh bx-sub" data-fold="tkd" aria-expanded="${!SB.fold.tkd}">끝난 태스크 ${tkDone.length}${I.fold}</button><div class="bx-sbody" data-sec="tkd"${SB.fold.tkd ? ' hidden' : ''}>${tkDone.map(tkIt).join('')}</div>` : '') : '';
    const unreadOf = (keys, pane) => (st.unread || []).filter(x => keys.includes(x.chan) || (pane && x.pane === pane)).length;
    const dgKey = n => 'dg:' + String(n).replace(/["\\\]\[]/g, '');
    const dgroup = (n, head, list) => { const k = dgKey(n); if (SB.fold[k] === undefined) SB.fold[k] = true;
      const badge = list.reduce((a, t) => a + (rp.has(t.pane) ? 1 : 0) + unreadOf([t.chan || 'n:' + t.name, 'node:' + t.pane], t.pane), 0) + (head ? (rowPanes().has(head.lead) ? 1 : 0) + unreadOf([head.key, 'n:' + n], head.lead) : 0);
      const hb = head ? it('chan:' + head.key, blob(n, 20), esc(n), '', pg === head.lead) : `<span class="bx-it bx-dgn0"><span>${esc(n)}</span></span>`;
      return `<div class="bx-dg">${hb}${badge ? `<span class="bx-dgc" aria-label="새 글 · 내 차례 ${badge}">${badge > 99 ? '99+' : badge}</span>` : ''}<button type="button" class="bx-dgf" data-fold="${esc(k)}" aria-expanded="${!SB.fold[k]}" aria-label="${esc(n)} 태스크 ${SB.fold[k] ? '펴기' : '접기'}">${I.fold}</button></div>`
        + `<div class="bx-sbody bx-dgb" data-sec="${esc(k)}"${SB.fold[k] ? ' hidden' : ''}>${list.map(tkIt).join('') || '<div class="bx-dge">태스크 없음</div>'}</div>`; };
    const DG = RS && TS ? (() => {   // 태스크 묶음이라 채널 = 태스크를 켠 사람만(TS) — 꺼진 회원은 main 과 같은 「채널」 칸 · 에이전트 칸
      const by2 = new Map(RS.map(n => [n, []])), none = [];
      for (const t of tkOpen) (by2.get(t.dept || '') || none).push(t);
      const headOf = n => MA.find(a => byPane[a.lead]?.tkdept && (a.seat_name || AREA_NAME[a.key] || a.lead_name || a.name) === n);
      return chP + RS.map(n => dgroup(n, headOf(n), by2.get(n))).join('') + (none.length ? dgroup('부서 없음', null, none) : '')
        + (tkDone.length ? `<button type="button" class="bx-sec bx-fh bx-sub" data-fold="tkd" aria-expanded="${!SB.fold.tkd}">끝난 태스크 ${tkDone.length}${I.fold}</button><div class="bx-sbody" data-sec="tkd"${SB.fold.tkd ? ' hidden' : ''}>${tkDone.map(tkIt).join('')}</div>` : '');
    })() : null;
    const qa = !ans.hidden && cur?.chan, ss = typeof openGpt !== 'function' ? '' : `<div class="bx-sech"><button type="button" class="bx-sec bx-fh" data-fold="ss" aria-expanded="${!SB.fold.ss}">세션${I.fold}</button><button type="button" class="bx-secadd" data-chatnew aria-label="새 세션" title="새 세션"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>`
      + `<div class="bx-sbody" data-sec="ss"${SB.fold.ss ? ' hidden' : ''}>${chats().map(c => `<button type="button" class="bx-it bx-chat" data-chat="${esc(c.sid)}" title="${esc(c.title)}"${qa === 'q:' + c.sid ? ' aria-current="page"' : ''}><span>${esc(c.title)}</span></button>`).join('')}</div>`;
    const rc = recent().map(r => `<button type="button" class="bx-it" data-art="${esc(r.id)}" title="${esc(r.title || r.id)}"><i class="ki k-${esc(r.kind || 'doc')}"></i><span>${esc(r.title || r.id)}</span></button>`).join('');
    const pins = (SB.pins || []).map(p => `<button type="button" class="bx-it" data-sidepin="${esc(p.id)}" title="${esc(p.title || p.id)}">${I.canvas}<span>${esc(p.title || p.id)}</span></button>`).join('');
    const hid = new Set(Array.isArray(SB.hide) ? SB.hide : []), top1 = (k, icon, label) => hid.has(k) ? '' : it(k, icon, label, '', top === k);
    const head = top1('node', I.node, '노드') + top1('canvas', I.canvas, '캔버스') + top1('feed', I.feed, '피드') + (window.BXStatus?.side?.(it, top) || '') + pins;
    const agentsFirst = window.HB_MEMBER?.unit === 'agent', chs = TS ? (tks ? sec('nd', '태스크', tks) : '') : nd ? sec('nd', '채널', nd) : '', ags = sec('ch', '에이전트', ch);
    const part = {ib: sec('ib', '모아 보기', ib), nd: DG !== null ? '' : chs, ch: DG !== null ? `<div class="bx-dgs">${DG}</div>` : ags, rc: rc ? sec('rc', '최근 캔버스', rc) : '', ss};
    const body = '<div class="bx-sbsc">' + head + sideOrder(agentsFirst).map(k => part[k] || '').join('') + '</div>';
    const foot = `<div class="bx-foot"><button type="button" class="bx-me" data-me aria-haspopup="true" aria-expanded="false">${meAv()}<span>${esc(window.HB_MEMBER?.name || ME()?.name || 'Owner')}</span></button></div>`;
    const fb = `<button type="button" class="bx-colb" data-go="find" aria-label="찾기" title="찾기 ⌘K">${I.search}</button>`;
    const keep = [sb, dr].map(x => x.querySelector('.bx-sbsc')?.scrollTop || 0);
    const agOn = !!S.ag || (chatMode() && !ibChat()), aTop = agOn ? null : top;
    const fl = (k, icon, label, extra) => hid.has(k) ? '' : it(k, icon, label, extra || '', aTop === k);
    const sbA = '<div class="bx-sbsc bx-sba">' + fl('feed', aTop === 'feed' ? IA.houseOn : IA.house, '피드')
      + (hid.has('feed') ? '' : `<button type="button" class="bx-it" data-go="feed" data-xnew>${IA.pen}<span>새 글</span></button>`) + it('find', IA.search, '찾기')
      + '<i class="bx-gap" aria-hidden="true"></i>' + ib + '<i class="bx-gap" aria-hidden="true"></i>'
      + it('agents', IA.bot, '에이전트', '', agOn) + fl('node', aTop === 'node' ? IA.nodeOn : IA.node, '노드') + fl('canvas', I.canvas, '캔버스')
      + (window.BXStatus?.side?.(it, aTop) || '') + pins + '</div>';
    const org = (() => {
      if (DG !== null || typeof windowsOf !== 'function' || typeof subsOf !== 'function' || !(typeof D === 'object' && Array.isArray(D?.roster))) return null;
      const seen = new Set();
      const rowOf = p => { const n = nameOf(p), ak = p.agent && CH.includes(p.agent) ? p.agent : '';   // 등록한 에이전트는 그 채널, 워커는 그 노드 화면
        return it(ak ? 'chan:' + ak : 'node:' + p.pane, p.agent ? blob(n, 20) : I.hash, esc(n), rp.has(p.pane) ? '<i class="ud" aria-label="내 차례"></i>' : '', ak ? chan === ak : pg === p.pane); };
      const grp = (row, kids, k) => kids ? `<div class="bx-dg">${row}<button type="button" class="bx-dgf" data-fold="${esc(k)}" aria-expanded="${!SB.fold[k]}" aria-label="밑 에이전트 ${SB.fold[k] ? '펴기' : '접기'}">${I.fold}</button></div><div class="bx-sbody bx-dgb" data-sec="${esc(k)}"${SB.fold[k] ? ' hidden' : ''}>${kids}</div>` : row;
      const sortA = ws => ws.map(w => w.lead).sort((a, b) => !!b.agent - !!a.agent);
      const walk = (p, d) => { if (seen.has(p.pane) || d > 12) return ''; seen.add(p.pane); return grp(rowOf(p), sortA(subsOf(p.pane)).map(x => walk(x, d + 1)).join(''), 'og:' + p.pane); };
      const head = (k, kids) => grp(it('chan:' + k, blob(AREA_NAME[k], 20), esc(AREA_NAME[k]), by(k) ? '<i class="ud" aria-label="읽지 않음"></i>' : '', chan === k), kids, 'og:' + k);
      const col = k => sortA(windowsOf(k)).map(p => walk(p, 1)).join('');
      return head('primary', (D.areas || []).map(a => a.key).filter(k => k !== 'primary' && AREA_NAME[k]).map(k => head(k, col(k))).join('') + col('primary'));
    })();
    if (S.ag) agDraw({a: DG !== null ? `<div class="bx-dgs">${DG}</div>` : org ? `<div class="bx-dgs bx-org">${org}</div>` : ch, c: (DG !== null ? '' : TS ? tks : nd) + ss, x: xc});
    const sbH = !feedOn() ? `<div class="top">${logo}<span class="tr">${fb}<button type="button" class="bx-colb" data-sbcol aria-label="${SB.col ? '사이드바 펴기' : '사이드바 접기'}" title="${SB.col ? '펴기' : '접기'}">${I.panel}</button></span></div>` + body + foot
      : `<div class="top">${logo}<span class="tr"><button type="button" class="bx-colb" data-sbcol aria-label="${SB.col ? '사이드바 펴기' : '사이드바 접기'}" title="${SB.col ? '펴기' : '접기'}">${I.panel}</button></span></div>` + sbA + foot;
    const drH = `<div class="top">${logo}<span class="tr">${fb}</span></div>` + body + foot;
    if (lists.html !== sbH + drH){ lists.html = sbH + drH; const k1 = window.HBKeepAv?.(sb), k2 = window.HBKeepAv?.(dr); sb.innerHTML = sbH; dr.innerHTML = drH; k1?.(); k2?.(); }   // 같은 아바타는 애니메이션을 이어서(다시 안 틂, 보드 HBKeepAv)
    [sb, dr].forEach((x, i) => { const sc = x.querySelector('.bx-sbsc'); if (sc && keep[i]) sc.scrollTop = keep[i]; });
    (PC.matches ? sb : dr).querySelector('.bx-foot').append(tools);
    placeLogo();
    lists.sig = rcSig();
  }
  const ME = () => { const m = window.BX_ME; return m && (m.seed || /^[0-9a-f]{32}$/.test(m.photo || '')) ? m : null; };
  const meAv = () => ME() && window.BXBot?.live ? `<b class="${ME().photo ? 'pic' : 'blob'}">${window.BXBot.live(ME(), 30)}</b>` : `<b>${esc(Array.from(String(window.HB_MEMBER?.name || 'B'))[0] || 'B')}</b>`;
  try { window.BX_ME = JSON.parse(localStorage.getItem('bx-me') || 'null'); } catch {}
  const meRedraw = () => { lists(); try { if (typeof cur !== 'undefined' && cur && !ans.hidden) render(); } catch {} };
  window.addEventListener('bx-me', meRedraw);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if (ME()) meRedraw(); });
  if (window.HB_MEMBER){ const a = window.HB_MEMBER.avatar || (typeof D !== 'undefined' ? D?.me_avatar : null); window.BX_ME = a ? {...a, name: window.HB_MEMBER.name} : null; }   // 첫 그리기부터 내 얼굴(페이지에 실려 옴 — 고른 것 없으면 기본 얼굴)
  fetch(window.HB_MEMBER ? 'api/me/avatar' : 'api/me/bot', {credentials: 'include'}).then(r => r.ok ? r.json() : null).then(j => {
    if (!j) return; const b = window.HB_MEMBER ? j.avatar && {...j.avatar, name: window.HB_MEMBER.name} : j.bot, m = b ? {seed: b.seed, hue: b.hue, name: b.name, photo: b.photo || '', icon: b.icon} : null;
    if (JSON.stringify(m) === JSON.stringify(window.BX_ME)) return;
    window.BX_ME = m; if (!window.HB_MEMBER) try { m ? localStorage.setItem('bx-me', JSON.stringify(m)) : localStorage.removeItem('bx-me'); } catch {}   // 회원은 보드 데이터 me_avatar 가 첫 값 — 주인 브라우저 값과 안 섞이게 저장 안 함
    meRedraw();
  }).catch(() => {});
  const rankOf = v => typeof priRank === 'function' ? priRank(v) : 2.5;
  // 업무 노드를 왼쪽 채널에 올리는 것은 설정 › 노드 「채널 = 태스크」를 켠 사람만(D.task_channels) — 끈 사람은 예전처럼 업무는 트리 · /tasks 에서
  const myNodes = () => (typeof panes !== 'undefined' ? panes : []).filter(p => !p.standing && ((typeof D !== 'undefined' && D?.task_channels) ? !p.tkdept : !p.tk) && !['primary', 'arealead', 'helper'].includes(p.kind) && (((typeof D !== 'undefined' && D?.task_channels) && p.tk) || !xHeads().some(a => a.lead === p.pane)))   // 회원 열 머리는 「에이전트」 칸에(두 번 안 나오게)
    .map((p, i) => [p, i]).sort((a, b) => rankOf(a[0].pri) - rankOf(b[0].pri) || a[1] - b[1]).map(x => x[0]);
  function rowPanes(){ try { return new Set((attnRows() || []).map(rowPane)); } catch { return new Set(myNodes().filter(p => nodeRows(p.pane).length).map(p => p.pane)); } }   // 함수 선언 — 위의 lists() 가 먼저 불려도 됨
  const rcSig = () => recent().map(r => r.id + (r.title || '')).join('|') + '#' + (typeof attnCount === 'function' ? attnCount() : 0)
    + '#' + (rp => myNodes().map(p => p.pane + nameOf(p) + (rp.has(p.pane) ? '*' : '')).join('|'))(rowPanes()) + (cur?.page ? '@' + cur.p : '') + '#' + chats().map(c => c.sid + c.title).join('|') + (!ans.hidden && cur?.chan?.startsWith('q:') ? '@' + cur.chan : '')
    + '#' + (window.BXStatus?.sig?.() || '') + ((typeof D === 'object' && Array.isArray(D?.task_side)) ? '#' + D.task_side.map(t => t.pane + t.issue + t.name + t.state + (t.done ? 'd' : '') + (t.dept || '')).join('|') : '') + ((typeof D === 'object' && Array.isArray(D?.role_seats)) ? '#' + D.role_seats.join('|') : '')
    + '#' + ((typeof D === 'object' && D?.areas) || []).map(a => a.key + ':' + a.lead + ':' + (AREA_NAME[a.key] || a.lead_name || '')).join('|');
  const loadChats = () => { fetch('api/chats', {credentials: 'include'}).then(r => r.ok ? r.json() : null).then(j => { if (j && Array.isArray(j.chats)){ window.HB_CHATS = j.chats; if (on()) lists(); } }).catch(() => {}); };
  loadChats(); setInterval(loadChats, 20000); window.addEventListener('hb-chats', () => { if (on()) lists(); setTimeout(loadChats, 1500); });
  setInterval(() => { if (on() && lists.sig !== rcSig()) lists(); }, 3000);
  function setCol(v){ SB.col = v; saveSB(); R.classList.toggle('bx-col', !!v); lists(); }
  R.classList.toggle('bx-col', !!SB.col);
  const chatMode = () => !!S.chat && !ans.hidden && !!cur && !!cur.chan;
  const FEED = k => (k === 'unread' || k === 'saved' || k === 'drafts' || k === 'turn') && !!window.HBInbox?.openFeed;
  const ibChat = () => chatMode() && /^i:(unread|saved|drafts|turn)$/.test(cur.chan) ? cur.chan.slice(2) : '';
  document.addEventListener('click', e => {
    if (ibChat() !== 'unread' || window.HBInbox?.opensUnread) return;
    const it = e.target.closest?.('.ibi[data-ibch][data-ibth]'), m = e.target.closest?.('.msg');
    if (!it || !m || m.parentElement !== it) return;
    if (e.target.closest('a, button, input, textarea, select, label, img, video, audio, [contenteditable], [data-copen], [role="button"]') || String(window.getSelection?.() || '').trim()) return;
    const ch = it.dataset.ibch || '', th = it.dataset.ibth || '';
    if (!/^\d{10}\.\d{6}$/.test(th)) return;
    e.preventDefault(); e.stopPropagation();
    if (ch.startsWith('n:') && typeof openNode === 'function'){
      const r = openNode(ch.slice(2), th);
      if (it.querySelector('.ibth .msg') && typeof openThread === 'function') Promise.resolve(r).then(() => openThread(ch, th));
      return;
    }
    if (typeof window.HBOpenCard === 'function') window.HBOpenCard(th, {c: CH.includes(ch) ? ch : 'primary', t: th});
  }, true);
  const active = () => window.BXStatus?.cur?.() ? 'pg:' + window.BXStatus.cur() : S.ag ? 'agents' : R.classList.contains('bx-x') && !R.classList.contains('xnodes') ? 'feed' : S.ib || chatMode() ? 'chat' : current === 'arts' ? 'canvas' : 'node';
  window.addEventListener('hbside', () => sync());
  window.addEventListener('bx-stp', () => sync());   // 상태 페이지가 열리고 닫힘 · 켠 기능이 바뀜(status.js)
  function sync(){
    if (!on()) return;
    const act = active();
    R.classList.toggle('bx-chat', chatMode());
    if (!PC.matches && chatMode()){ const ah = ans.querySelector(':scope > .ah'), r = ah?.getBoundingClientRect(); if (r && r.height){ R.style.setProperty('--bx-cmt', Math.round(r.top - ans.getBoundingClientRect().top + (r.height - 40) / 2) + 'px'); R.style.setProperty('--bx-cmz', String((parseInt(getComputedStyle(ans).zIndex) || 20) + 1)); } }   // 폰 채팅 머리 왼쪽 메뉴 단추 자리
    R.classList.toggle('bx-ib', !!S.ib);
    if (current === 'timeline' && typeof show === 'function') show('tree');   // 타임라인 보기는 없앰 — 예전에 보던 사람도 트리로
    const tb = [];
    seg.hidden = act !== 'node' || !tb.length;
    seg.innerHTML = '';
    lists(); arts();
    window.HBViewWake?.();   // 채팅 · 모아 보기를 닫아 보기가 드러나면 미뤄 둔 그리기를 바로(board.html viewDraw)
  }

  function ibOpen(k, fromPop){
    if (!IBK.includes(k) || !window.HBInbox || !on()) return;
    S.ret = null; agClose(); if (!ans.hidden) closeAns();
    if (S.ib !== k){ ibM?.destroy(); ibM = window.HBInbox.mount(ibox, k, {}); }
    S.ib = k; ibox.hidden = false; scrollTo(0, 0); document.querySelector('.wrap')?.scrollTo(0, 0);
    if (!fromPop && !EMBED && !HBR.same(HBR.hash(), '#' + k)) history.pushState(null, '', '#' + k);
    sync();
  }
  function ibClose(){ if (!S.ib) return; ibM?.destroy(); ibM = null; S.ib = null; ibox.hidden = true; }
  const AGT = {a: ['에이전트', IA.bot, '에이전트가 없어요'], c: ['채널', IA.hash, '열린 채널이 없어요'], x: ['A2A', IA.a2a, '다른 보더와 잇는 대화가 아직 없어요']}, AGH = {a: '', c: 'channels', x: 'a2a'};
  const agHash = t => '#agents' + (AGH[t] ? '/' + AGH[t] : '');
  function agDraw(part){
    const t = S.ag, body = part[t] || '';
    const h = `<div class="bx-agp-h"><h1>에이전트</h1></div><div class="bx-agseg" role="tablist" aria-label="에이전트 보기">${Object.entries(AGT).map(([k, [l, ic]]) => `<button type="button" role="tab" data-agtab="${k}" aria-selected="${k === t}">${ic}<span>${l}</span></button>`).join('')}</div>`
      + `<div class="bx-agl" role="tabpanel">${body || (window.HBEmpty ? window.HBEmpty({ic: AGT[t][1], t: AGT[t][2], p: ''}) : `<p class="bx-agp-e">${AGT[t][2]}</p>`)}</div>`;
    if (agDraw.html === h && agBox.firstChild) return; agDraw.html = h;
    const k = window.HBKeepAv?.(agBox); agBox.innerHTML = h; k?.();
  }
  function agOpen(t, fromPop){
    if (!on() || EMBED) return; if (!AGT[t]) t = 'a';
    S.ret = null; ibClose(); if (!ans.hidden) closeAns(); window.BXStatus?.close?.(); window.BXFeed?.off?.();
    const was = S.ag; S.ag = t; agBox.hidden = false; R.classList.add('bx-agpg');
    if (was !== t){ agDraw.html = ''; document.querySelector('.wrap')?.scrollTo(0, 0); scrollTo(0, 0); }
    sync(); if (!fromPop) recLater();
  }
  function agClose(){ if (!S.ag) return; S.ag = null; agBox.hidden = true; agBox.innerHTML = ''; agDraw.html = ''; R.classList.remove('bx-agpg'); }
  window.HB_VIEW_OFF = () => on() && (R.classList.contains('bx-chat') || R.classList.contains('bx-route') || R.classList.contains('bx-set') || R.classList.contains('bx-stpg') || !!S.ib || !!S.ag || !!document.querySelector('#mview.full'));
  let wakeQ = 0; const wakeLater = () => { if (!wakeQ) wakeQ = requestAnimationFrame(() => { wakeQ = 0; window.HBViewWake?.(); }); };
  new MutationObserver(wakeLater).observe(R, {attributes: true, attributeFilter: ['class']});
  let wasFeed = feedOn(); new MutationObserver(() => { const f = feedOn(); if (f !== wasFeed){ wasFeed = f; if (on()) lists(); } }).observe(R, {attributes: true, attributeFilter: ['class']});   // 피드 ↔ 다른 화면: 사이드바 목록이 바뀜(한 줄 목록은 피드에서만)
  new MutationObserver(wakeLater).observe(document.body, {childList: true});

  const show0 = window.show, chan0 = window.openChan;
  window.show = function(v){ S.ret = null; ibClose(); agClose(); const r = show0.apply(this, arguments); sync(); return r; };
  window.openChan = function(k){
    const from = S.ib; agClose();
    const r = chan0.apply(this, arguments);
    if (!ans.hidden && cur && cur.tab === 'chat'){ ibClose(); S.chat = cur.chan || (CH.includes(k) ? k : 'primary'); S.last = S.chat; S.ret = from; }
    sync(); return r;
  };
  let wasOpen = false;
  new MutationObserver(() => {
    const open = !ans.hidden;
    if (open && S.ag) agClose();   // 찾기 · 알림 · 글 링크가 대화를 열면 에이전트 화면은 닫힘(뒤로 가면 주소 #agents 로 다시 열림)
    if (open && !S.chat && cur?.tab === 'chat' && cur.chan){ S.chat = cur.chan; if (!/^i:/.test(cur.chan)) S.last = cur.chan; }
    if (!open && wasOpen && S.chat){ S.chat = null; const back = S.ret; S.ret = null; if (back && !(applying && HBR.hash().startsWith('#chat/'))) return ibOpen(back, true); }
    if (!open) S.chat = null;
    wasOpen = open; sync();
  }).observe(ans, {attributes: true, attributeFilter: ['hidden', 'class']});
  window.HBInbox?.on(() => on() && lists());

  // ── 누르기
  function go(g){
    closeDr(); S.ret = null;
    if (g === 'agents') return agOpen(S.ag || 'a');
    if (g === 'find') return findOpen();   // 찾기는 덮개 — 에이전트 화면은 그대로
    agClose();
    if (g.startsWith('pg:')){ ibClose(); if (!ans.hidden) closeAns(); window.BXFeed?.off?.(); return window.BXStatus?.open?.(g.slice(3)); }   // 상태 페이지(status.js) — 본 칸에 그 페이지
    window.BXStatus?.close?.();   // 다른 곳으로 가면 상태 페이지는 닫음
    if (g === 'feed') return window.BXFeed ? window.BXFeed.on() : void (location.href = '/feed');   // 피드 = /feed(폰 · PC 같은 화면)
    if (g === 'find') return findOpen();
    if (g.startsWith('chan:')) return openChan(g.slice(5));
    if (g.startsWith('node:')){ ibClose(); if (typeof byPane !== 'undefined' && byPane[g.slice(5)]?.standing && typeof openNode === 'function') return openNode(g.slice(5)); return openAns({p: g.slice(5), page: true}); }
    if (FEED(g)){ ibClose(); return window.HBInbox.openFeed(g); }
    if (IBK.includes(g)) return ibOpen(g);
    if (!ans.hidden) closeAns();
    if (g === 'chat') return openChan(S.last);
    if (g === 'canvas') return show('arts');
    if (g === 'node'){ if (!ans.hidden && cur?.chan?.startsWith('n:')) closeAns();   // 노드 채팅에서 「노드」 = 트리로
      if (current === 'arts') return show('tree'); ibClose(); if (!EMBED && !HBR.same(HBR.hash(), '#' + current)) history.pushState(null, '', '#' + current); return sync(); }
  }
  for (const n of [sb, dr, agBox]) n.addEventListener('click', e => {
    const at = e.target.closest('[data-agtab]'); if (at) return agOpen(at.dataset.agtab);
    const nw = e.target.closest('[data-xnew]');   // 새 글 = 피드 글 칸(#xnew)에 바로 쓰기
    if (nw){ closeDr(); agClose(); window.BXStatus?.close?.(); ibClose(); if (!window.BXFeed) return void (location.href = '/feed'); window.BXFeed.on(); const t0 = Date.now(), f = () => { const ta = document.getElementById('xnew'); if (ta && ta.offsetParent) ta.focus(); else if (Date.now() - t0 < 5000) setTimeout(f, 120); }; return f(); }
    const f = e.target.closest('[data-fold]');
    if (f){ const k = f.dataset.fold; SB.fold[k] = !SB.fold[k]; saveSB();
      for (const x of [sb, dr, agBox]){ const h = x.querySelector(`[data-fold="${k}"]`), s = x.querySelector(`[data-sec="${k}"]`); h?.setAttribute('aria-expanded', !SB.fold[k]); if (s) s.hidden = !!SB.fold[k]; }
      return; }
    if (e.target.closest('[data-sbcol]')) return setCol(!SB.col);
    const me = e.target.closest('[data-me]'); if (me) return meOpen(me);
    if (e.target.closest('[data-chatnew]')){ closeDr(); ibClose(); return openGpt('q:new'); }
    const q = e.target.closest('[data-chat]'); if (q){ closeDr(); ibClose(); return openGpt('q:' + q.dataset.chat); }
    const pin = e.target.closest('[data-sidepin]'); if (pin){ closeDr(); const id = pin.dataset.sidepin; if (ARTS[id]){ if (!ans.hidden) closeAns(); return openArt(id); } return void window.open('/art/' + encodeURIComponent(id) + '/', '_blank', 'noopener'); }
    const a = e.target.closest('[data-art]'); if (a){ closeDr(); if (!ARTS[a.dataset.art]) return lists(); if (!ans.hidden) closeAns(); return openArt(a.dataset.art); }
    const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go);
  });

  document.body.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !PC.matches || !R.classList.contains('bx-chat') || ans.hidden || !chatMode()) return;
    if (CS.th || CS.pop || CS.edit || CS.sheet) return;
    e.stopPropagation();
  });

  if (EMBED){
    const off = () => ans.hidden || cur?.tab !== 'chat' || cur?.chan !== EMB;
    new MutationObserver(() => { if (off()) setTimeout(() => { if (off()) openChan(EMB); }, 300); }).observe(ans, {attributes: true, attributeFilter: ['hidden', 'class'], childList: true});   // 닫히거나 다른 화면으로 바뀌어도 늘 Primary
    window.pushOpen = (...a) => parent.pushOpen?.(...a);
  } else {
    const DK = 'bx-dock';
    let dock = null, dockK = '';
    const db = mk('button', 'bx-dockb', I.chat);
    db.type = 'button'; const botn = typeof BOTN === 'string' && BOTN ? BOTN : 'Primary'; db.title = `${botn} 채팅 — 오른쪽 판`; db.setAttribute('aria-label', `${botn} 채팅 판`); db.setAttribute('aria-pressed', 'false');
    const dockOn = () => { try { return localStorage.getItem(DK) === '1'; } catch { return false; } };
    function dockSet(v, k = 'primary'){
      if (k === 'primary') try { localStorage.setItem(DK, v ? '1' : ''); } catch {}
      const show = v && PC.matches;
      if (show && dock && dockK !== k){ dock.remove(); dock = null; }
      if (show && !dock){
        const nm = (typeof AREA_NAME === 'object' && AREA_NAME[k]) || k;
        dock = mk('aside', 'bx-dock', `<div class="bx-dock-h"><b>${esc(nm)}</b><span class="s">${k === 'primary' ? '쓰면 맞는 노드로 가요' : '쓰던 글이 칸에 그대로 있어요'}</span><button type="button" class="bx-ib1" data-dockx aria-label="${esc(nm)} 판 닫기">${lu('x', 16)}</button></div><iframe title="${esc(nm)} 채팅" src="/?embed=${encodeURIComponent(k)}#chat/${encodeURIComponent(k)}"></iframe>`);
        dock.setAttribute('aria-label', nm + ' 채팅'); dockK = k;
        dock.addEventListener('click', e => { if (!e.target.closest('[data-dockx]')) return; const was = dockK; dockSet(false, was); if (was !== 'primary' && dockOn()) dockSet(true, 'primary'); });
        document.body.append(dock);
      }
      if (dock) dock.hidden = !show;
      R.classList.toggle('bx-docked', show);
      db.setAttribute('aria-pressed', String(show && dockK === 'primary'));
    }
    window.BX_SIDE = k => { if (!PC.matches || !CH.includes(k)) return false; dockSet(true, k); return true; };   // 모아 보기 초안(inbox.js) — 폰은 false(그 채널로 감)
    db.addEventListener('click', () => { if (!PC.matches){ closeDr(); return openChan('primary'); } dockSet(!R.classList.contains('bx-docked')); });
    PC.addEventListener('change', () => dockSet(dockOn()));
    if (dockOn()) dockSet(true);
  }

  if (!EMBED && window.HB_BLOB){
    const open = window.HB_BLOB('primary', {size: 64, background: false});
    const tmp = mk('div', '', open); tmp.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden'; document.body.append(tmp);
    let cy = 50; try { const bb = tmp.querySelector('svg > g:last-of-type').getBBox(); cy = bb.y + bb.height / 2; } catch {}
    tmp.remove();
    const shut = open.replace(/<g([^>]*)>(?![\s\S]*<g)/, `<g$1 transform="translate(0 ${cy}) scale(1 .12) translate(0 ${-cy})">`);   // 마지막 g = 눈
    const A = 'data:image/svg+xml,' + encodeURIComponent(open), B = 'data:image/svg+xml,' + encodeURIComponent(shut);
    const fav = document.head.appendChild(Object.assign(document.createElement('link'), {rel: 'icon', type: 'image/svg+xml', href: A}));
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    const favOff = () => { try { return localStorage.getItem('hb-favblink') === '0'; } catch { return false; } };   // 설정 › 모양 「파비콘 눈 깜빡」(계정 값 ui:favblink — 설정 화면이 열 때 이 브라우저에 맞춤)
    setInterval(() => { if (still.matches || R.classList.contains('bx-still') || favOff()) return; fav.href = B; setTimeout(() => { fav.href = A; }, 180); }, 5000);
  }

  const mi = (k, icon, label) => `<button type="button" class="bx-it" data-mi="${k}" role="menuitem">${icon}<span>${label}</span></button>`;
  const mp = mk('div', 'bx-mpop', (capOn('invite') ? mi('invite', I.invite, '초대') : '') + mi('feedback', I.feedback, '피드백') + mi('out', I.out, '로그아웃'));
  mp.hidden = true; mp.setAttribute('role', 'menu'); document.body.append(mp);
  if (!EMBED) fetch('/api/sales/teams', {credentials: 'include'}).then(r => r.ok ? r.json() : null).then(j => { if (j?.teams?.length) mp.insertAdjacentHTML('afterbegin', mi('sales', I.sales, '영업 보드')); }).catch(() => {});
  if (!EMBED) fetch('/api/me/tasks/has', {credentials: 'include'}).then(r => r.ok ? r.json() : null).then(j => { if (j?.has) mp.insertAdjacentHTML('afterbegin', mi('tasks', I.sales, '업무 판')); }).catch(() => {});
  const mtoast = t => { let el = $id('bx-toast'); if (!el){ el = mk('div', 'bx-toast'); el.id = 'bx-toast'; el.setAttribute('role', 'status'); document.body.append(el); } el.textContent = t; el.classList.add('on'); clearTimeout(mtoast.t); mtoast.t = setTimeout(() => el.classList.remove('on'), 1800); };
  const mpost = (u, b) => fetch(u, {method: 'POST', credentials: 'include', headers: {'content-type': 'application/json', 'x-hb': '1'}, body: JSON.stringify(b || {})});
  function meOpen(btn){
    if (!mp.hidden){ mp.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    const r = btn.getBoundingClientRect(); mp.style.left = Math.max(8, r.left) + 'px'; mp.style.bottom = (innerHeight - r.top + 6) + 'px';
    mp.hidden = false; btn.setAttribute('aria-expanded', 'true');
  }
  const meClose = () => { mp.hidden = true; document.querySelectorAll('[data-me]').forEach(b => b.setAttribute('aria-expanded', 'false')); };
  mp.addEventListener('click', async e => {
    const k = e.target.closest('[data-mi]')?.dataset.mi; if (!k) return;
    if (k === 'copy'){ meClose(); closeDr(); try { const r = await fetch('api/install/prompt', {credentials: 'include'}); if (!r.ok) throw 0; await navigator.clipboard.writeText(await r.text()); mtoast('복사했어요 — AI 도구에 붙여넣어요'); } catch { mtoast('일시적인 오류가 발생했어요'); } }
    if (k === 'invite'){ meClose(); closeDr(); window.BXSettings?.enter('invite-box'); }
    if (k === 'sales'){ meClose(); location.href = '/sales'; }
    if (k === 'tasks'){ meClose(); location.href = '/tasks'; }
    if (k === 'feedback'){ meClose(); closeDr(); window.BXSettings?.enter('feedback'); }
    if (k === 'out'){ await window.bxPushOff(); await mpost('api/auth/sign-out'); location.reload(); }
  });
  document.addEventListener('click', e => { if (!mp.hidden && !e.target.closest('.bx-mpop, [data-me]')) meClose(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !mp.hidden){ e.stopImmediatePropagation(); meClose(); } }, true);

  function artThumb(id){
    return `<span class="bx-art-thumb" aria-hidden="true"><iframe src="/art/${encodeURIComponent(id)}/?thumb" loading="lazy" tabindex="-1" sandbox="allow-scripts" title="캔버스 미리보기"></iframe></span>`;
  }
  function artChips(tags){
    // 영역: · 노드: 같은 머리말은 칩에서 뺌(색인용), 날짜 · 종류 칩은 뒤로
    return (tags || []).filter(t => !/^(영역|노드|date|종류):/.test(t)).slice(0, 3).map(t => `<span class="bx-fchip">${esc(t.replace(/^[^:]+:/, ''))}</span>`).join('');
  }
  const fd = mk('div', 'bx-find', `<div class="bx-fbox" role="dialog" aria-modal="true" aria-label="찾기"><div class="bx-fq">${I.search}<input type="search" placeholder="찾기 — 노드 · 결정 · 대화 · 캔버스" aria-label="찾기" autocomplete="off" enterkeyhint="go"></div><div class="bx-fl" role="listbox"></div></div>`);
  fd.hidden = true; document.body.append(fd);
  const fin = fd.querySelector('input'), fl = fd.querySelector('.bx-fl');
  let fsel = 0, fres = [];
  const FS = {r: null, t: 0, n: 0};
  const agoS = at => { const s = Math.max(0, Date.now() / 1000 - (+at || 0)); return !at ? '' : s < 90 ? '방금' : s < 3600 ? Math.round(s / 60) + '분 전' : s < 86400 ? Math.round(s / 3600) + '시간 전' : Math.round(s / 86400) + '일 전'; };
  const winT = x => String(x?.win || '').replace(/^\d+\s*/, '');
  const frontAlias = t => typeof D !== 'undefined' && D?.front_door?.aliases?.includes(t);
  function nodeGo(t, ts, th){
    if (frontAlias(t)){ openChan('primary', th); if (ts && typeof nodeFlash === 'function') nodeFlash(th || ts); return; }
    const aliasPane = typeof D !== 'undefined' && D?.node_aliases?.[t]; if (aliasPane && byPane[aliasPane]) t = winT(byPane[aliasPane]);
    const p = Object.values(byPane).find(x => !x.standing && winT(x) === t), k = p ? '' : Object.keys(parkBy).find(id => winT(parkBy[id]) === t);
    if (ts && typeof openNode === 'function'){   // 스레드 답은 뿌리 글로 굴리고 스레드를 엶(읽지 않음 글 누르기와 같은 길)
      const r = openNode(p ? p.pane : k || t, th || ts);
      if (th && typeof openThread === 'function') Promise.resolve(r).then(() => openThread('n:' + t, th));
      return;
    }
    if (p) return openAns({p: p.pane, page: true});
    if (k) return openAns({p: k, page: true});
    if (typeof openNode === 'function') return openNode(t);
    HBR.go('#settings/nodes');
  }
  function cardGo(c){
    if (typeof window.HBOpenCard === 'function' && /^\d{10}\.\d{6}$|^[qw]:/.test(c.ts || '')) return window.HBOpenCard(c.ts, c.thread ? {c: CH.includes(c.ch) ? c.ch : 'primary', t: c.thread} : null);
    if (c.thread) return openChan(CH.includes(c.ch) ? c.ch : 'primary', c.thread);
    if (c.node) return nodeGo(c.node);
    toast('그 카드는 이미 처리됐어요');
  }
  const KIND = {decision: '결정', todo: '할 일', queue: '질문', choice: '결정'};
  const SC = () => window.BX_FIND_SCOPE || null;
  function serverItems(r){
    const out = [], sc = SC();
    if (sc) r = {...r, nodes: (r.nodes || []).filter(n => sc.area(n.area)), cards: [], chats: [], arts: (r.arts || []).filter(a => sc.folder(a.folder))};
    for (const n of r.nodes || []) out.push({id: n.id, g: '노드', n: n.title, i: I.hash, tag: n.turn, hot: /^내 차례/.test(n.turn || ''),
      sub: [n.line || (n.hit && n.hit.text), agoS(n.line_at || (n.hit && n.hit.at))].filter(Boolean).join(' · '), go: () => nodeGo(n.title, n.hit?.ts, n.hit?.thread)});
    for (const c of r.cards || []) out.push({id: c.id, g: '결정 · 할 일', n: c.title, i: I.flag, tag: c.state === 'open' ? (KIND[c.ckind] || '열림') : '닫힘', hot: c.state === 'open',
      sub: [c.text, c.node, agoS(c.at)].filter(Boolean).join(' · '), go: () => cardGo(c)});
    for (const m of r.chats || []) out.push({id: m.id, g: '대화', n: m.text, i: m.kind === 'log' ? I.node : blob(m.title === 'Owner' ? 'Owner' : (AREA_NAME[m.ch] || m.ch || ''), 18),
      sub: [m.kind === 'log' ? m.title + ' 장부' : (m.title + ' · ' + (AREA_NAME[m.ch] || m.ch || '')), m.kind !== 'log' && m.node, agoS(m.at)].filter(Boolean).join(' · '),
      go: () => { if (m.kind === 'log') return nodeGo(m.title, m.ts, m.thread); openChan(CH.includes(m.ch) ? m.ch : 'primary', m.thread); if (!m.thread && m.ts && typeof nodeFlash === 'function') nodeFlash(m.ts); }});
    for (const a of r.arts || []) { const id = a.id.slice(2); out.push({id: a.id, g: '캔버스', n: a.title, i: artThumb(id), art: true, tags: a.tags, sub: [a.folder, a.versions > 1 ? a.versions + '개 판' : '', agoS(a.at)].filter(Boolean).join(' · '), go: () => ARTS[id] ? openArt(id) : toast('그 캔버스를 찾지 못했어요')}); }
    if (Array.isArray(r.best)) { const top = []; for (const b of r.best) { const k = out.findIndex(x => x.id === b.id); if (k >= 0) top.push({...out.splice(k, 1)[0], g: '가장 가까운 것'}); } out.unshift(...top); }
    return out;
  }
  function findItems(q){
    q = q.trim().toLowerCase();
    const hit = s => !q || String(s || '').toLowerCase().includes(q);
    const out = [], sc = SC();
    const kind = !!q && '태스크'.startsWith(q), tq = t => kind || t.keys.some(hit), ST = {working: '진행', blocked: '막힘', waiting: '기다림', done: '완료', cancelled: '취소'};
    const no = x => String(x || '').replace(/^.*#/, '#'), tasks = new Map();
    if (!sc && Array.isArray(FS.tb)) for (const t of FS.tb) if (t?.pane) tasks.set(t.pane, {n: [no(t.issue), t.name].filter(Boolean).join(' '), tag: ST[t.status] || '', hot: t.status === 'blocked', done: !!t.closed || t.status === 'done' || t.status === 'cancelled', sub: [...new Set([t.dept, t.owner, t.line].filter(Boolean))].join(' · '), keys: [t.issue, no(t.issue).slice(1), t.name, ST[t.status], t.dept, t.owner, t.line], pane: t.pane});
    if (!sc && typeof D === 'object' && Array.isArray(D?.task_side)) for (const t of D.task_side) if (t?.pane && !tasks.has(t.pane)) tasks.set(t.pane, {n: [no(t.issue), t.name].filter(Boolean).join(' '), tag: t.state_ko || '', hot: t.state === 'blocked', done: !!t.done, sub: t.done ? '끝난 태스크' : '', keys: [t.issue, no(t.issue).slice(1), t.name, t.state_ko], pane: t.pane});
    const tall = [...tasks.values()].sort((a, b) => Number(a.done) - Number(b.done));
    for (const t of (q ? tall.filter(tq) : tall.filter(t => !t.done).slice(0, 5)).slice(0, kind ? 40 : 12)) out.push({g: '태스크', n: t.n, i: I.hash, tag: t.tag, hot: t.hot, sub: t.sub, go: () => go('node:' + t.pane)});
    for (const k of CH) if ((!sc || sc.ch(k)) && (hit(AREA_NAME[k]) || hit(k))) out.push({g: '에이전트', n: AREA_NAME[k], i: blob(AREA_NAME[k], 18), go: () => openChan(k)});
    for (const k of IBK) if ((!sc || k === 'unread' || k === 'turn') && q && hit(IBN[k])) out.push({g: '모아 보기', n: IBN[k], i: I[k], go: () => FEED(k) ? (ibClose(), window.HBInbox.openFeed(k)) : ibOpen(k)});   // 범위가 있으면 거르개가 걸린 둘만(초안 · 저장은 영역을 안 거름)
    const sr = q && FS.r && q.startsWith(FS.r.q.toLowerCase()) ? FS.r : null;   // 서버 답(앞 글자가 같으면 새 답이 올 때까지 그대로 — 깜빡임 없게)
    if (sr && !window.HB_MEMBER) return out.concat(serverItems(sr)).slice(0, 60);
    const live = t => (t.panes || []).find(p => byPane[p]);
    if (q) for (const t of (CS.T.topics || [])) { const p = t.state !== 'done' && live(t); if (p && (!sc || sc.area(byPane[p]?.area)) && (hit(t.title) || hit(t.id))) out.push({g: '노드', n: t.title || t.id, i: I.hash, go: () => openAns({p})}); }
    if (q && !sc) for (const n of (typeof D !== 'undefined' && D.archived || []).filter(hit).slice(0, 8)) out.push({g: '노드', n: n + ' · 보관', i: I.hash, go: () => nodeGo(n)});
    const arts = Object.entries(ARTS || {}).map(([id, x]) => ({id, ...x})).filter(r => !sc || sc.folder(r.folder)).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    for (const r of (q ? arts.filter(r => hit(r.title) || hit(r.id)) : arts.slice(0, 5))) out.push({g: q ? '캔버스' : '최근 캔버스', n: r.title || r.id, i: artThumb(r.id), art: true, tags: r.tags, go: () => ARTS[r.id] && openArt(r.id)});
    if (sr){
      const sv = serverItems(sr), names = new Set(sv.filter(r => r.g === '노드').map(r => r.n)), G = ['태스크', '에이전트', '모아 보기', '노드', '결정 · 할 일', '대화', '캔버스', '최근 캔버스'];
      return out.filter(r => r.g !== '노드' || !names.has(r.n)).concat(sv).map((r, i) => [r, i]).sort((a, b) => G.indexOf(a[0].g) - G.indexOf(b[0].g) || a[1] - b[1]).map(x => x[0]).slice(0, 60);
    }
    return out.slice(0, 40);
  }
  function hl(t, q){   // 찾은 낱말 굵게(글은 먼저 esc)
    let h = esc(t || ''); const ws = q.trim().split(/\s+/).filter(w => w.length > 0).map(w => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return ws.length ? h.replace(new RegExp('(' + ws.join('|') + ')', 'gi'), '<mark>$1</mark>') : h;
  }
  function findDraw(){
    const q = fin.value;
    fres = findItems(q); fsel = Math.min(fsel, Math.max(0, fres.length - 1));
    let g = '';
    fl.innerHTML = fres.length ? fres.map((r, i) => (r.g !== g ? `<div class="bx-fg">${g = r.g}</div>` : '') + (r.sub || r.tag || r.art
      ? `<button type="button" class="bx-fr bx-fr2${r.art ? ' bx-fr-art' : ''}" role="option"${r.art ? ` aria-label="${esc(r.n)}"` : ''} data-fi="${i}" aria-selected="${i === fsel}">${r.i}<span class="bx-ft"><b>${hl(r.n, q)}</b>${r.art && r.tags?.length ? `<span class="bx-fchips">${artChips(r.tags)}</span>` : ''}${r.sub ? `<small>${hl(r.sub, q)}</small>` : ''}</span>${r.tag ? `<em class="${r.hot ? 'hot' : ''}">${esc(r.tag)}</em>` : ''}</button>`
      : `<button type="button" class="bx-fr" role="option" data-fi="${i}" aria-selected="${i === fsel}">${r.i}<span>${esc(r.n)}</span></button>`)).join('')
      : (q.trim() && !FS.r && FS.fail !== q.trim() ? '<div class="bx-fe"><i class="g g-spin"></i></div>' : window.HBEmpty ? window.HBEmpty({ic: 'search', sm: true, t: '찾은 것이 없어요', p: '다른 낱말로 찾아 보세요.'}) : '<div class="bx-fe">찾은 것이 없어요</div>');
    if (FS.r) { fl.dataset.ms = JSON.stringify(FS.r.ms || {}); fl.dataset.rtt = FS.r.rtt; fl.dataset.sem = FS.r.sem ? 1 : 0; fl.dataset.q = FS.r.q; }
    fl.querySelector('[aria-selected="true"]')?.scrollIntoView({block: 'nearest'});
  }
  async function fsearch(q, sem){
    const n = ++FS.n, t0 = performance.now();
    try {
      const r = await fetch('api/search?q=' + encodeURIComponent(q) + (sem ? '&sem=1' : ''), {cache: 'no-store', credentials: 'same-origin'});
      if (!r.ok) return fsFail(q, sem);
      const j = await r.json();
      if (fin.value.trim() !== q || (FS.r && FS.r.q === q && FS.r.sem && !sem)) return;   // 그 사이 글이 바뀜 · 뜻 답이 먼저 옴
      if (!sem && n < FS.n && FS.r && FS.r.q === q) return;
      FS.r = {...j, q, sem, rtt: Math.round(performance.now() - t0)};
      findDraw();
    } catch { fsFail(q, sem); }
  }
  function fsFail(q, sem){
    if (sem || fin.value.trim() !== q) return;
    FS.fail = q; findDraw();
  }
  function findInput(){
    fsel = 0; const q = fin.value.trim();
    if (!q) FS.r = null;
    findDraw(); clearTimeout(FS.t);
    if (q){ fsearch(q, false); FS.t = setTimeout(() => fsearch(q, true), 300); }   // 낱말 먼저, 300ms 뒤 뜻(회원도 — 자기 D1 최근 글을 Workers AI 로, member-search.ts)
  }
  // 태스크 현황 요청(찾기 「태스크」 묶음): 기능을 켠 회원만, 찾기를 열 때 한 번(1분 안이면 그대로) — 못 받으면 사이드 태스크만
  function tbLoad(){
    if (!window.HB_MEMBER || !window.BXStatus?.feats?.()?.taskboard || Date.now() - (FS.tbAt || 0) < 60000) return;
    FS.tbAt = Date.now();
    fetch('api/me/taskboard', {cache: 'no-store', credentials: 'same-origin'}).then(r => r.ok ? r.json() : null).then(j => { if (Array.isArray(j?.tasks)){ FS.tb = j.tasks; if (!fd.hidden) findDraw(); } }).catch(() => {});
  }
  function findOpen(){ closeDr(); fin.value = ''; fsel = 0; FS.r = null; fd.hidden = false; tbLoad(); findDraw(); fin.focus(); }
  function findClose(){ fd.hidden = true; }
  function findGo(i){ const r = fres[i]; if (!r) return; findClose(); S.ret = null; if (!ans.hidden) closeAns(); r.go(); }
  fin.addEventListener('input', findInput);
  fd.addEventListener('keydown', e => {
    e.stopPropagation();   // 보드 단축키(↑↓ 질문 넘기기 등)가 찾기 칸 글쇠를 먹지 않게
    if (e.key === 'Escape'){ e.preventDefault(); return findClose(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); fsel = (fsel + (e.key === 'ArrowDown' ? 1 : -1) + fres.length) % Math.max(1, fres.length); return findDraw(); }
    if (e.key === 'Enter' && !e.isComposing){ e.preventDefault(); findGo(fsel); }
  });
  fd.addEventListener('click', e => { const r = e.target.closest('[data-fi]'); if (r) return findGo(+r.dataset.fi); if (!e.target.closest('.bx-fbox')) findClose(); });
  document.addEventListener('keydown', e => {
    if (!fd.hidden && e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); return findClose(); }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k' && on() && !EMBED && !document.querySelector('#mview')){ e.preventDefault(); fd.hidden ? findOpen() : findClose(); }
  }, true);
  function openDr(){ R.classList.add('bx-dron'); lists(); dr.querySelector('[aria-current]')?.focus?.({preventScroll: true}); }
  function closeDr(){ R.classList.remove('bx-dron'); }
  menu.addEventListener('click', openDr);
  scrim.addEventListener('click', closeDr);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && R.classList.contains('bx-dron')){ e.stopPropagation(); closeDr(); menu.focus(); } }, true);
  const ROUTE = /^#(chat\/|art\/|node\/|w\/|inbox$|agents(\/|$))/;
  const MVv = () => MV.el && document.body.contains(MV.el) && MV.el === S.artEl ? S.art : null;
  const nodeKey = p => { if (/^g:/.test(p || '')) return p.slice(2); const x = (typeof byPane !== 'undefined' && byPane[p]) || (typeof parkBy !== 'undefined' && parkBy[p]); const n = x && typeof nodeTitle === 'function' ? nodeTitle(x) : ''; return n || p; };   // 닫힌 노드(g:<이름>)는 이름만
  const nodePane = a => { const alias = typeof D !== 'undefined' && D?.node_aliases?.[a]; if (alias && typeof byPane !== 'undefined' && byPane[alias]) return alias; return (typeof byPane !== 'undefined' && byPane[a]) ? a : (typeof liveNode === 'function' && liveNode(a)?.pane) || ''; };
  function want(){
    const a = MVv(); if (a) return '#art/' + a;
    if (!ans.hidden && cur){
      if (cur.tab === 'chat' && cur.chan && cur.chan.startsWith('n:')) return '#node/' + encodeURIComponent(nodeKey(cur.p)) + (CS.th?.ts && CS.th.k === cur.chan ? '/' + CS.th.ts : '');
      if (cur.tab === 'chat' && cur.chan === 'i:turn') return '#inbox';
      if (cur.tab === 'chat' && /^i:(unread|saved|drafts)$/.test(cur.chan || '')){ const m = cur.chan === 'i:unread' && window.HBInbox?.focusOf?.(); return '#' + cur.chan.slice(2) + (m ? '?msg=' + m : ''); }
      if (cur.tab === 'chat' && cur.chan === 'primary' && CS.th?.ts && CS.th.k !== 'primary' && typeof inMain === 'function' && inMain(CS.th.k)) return '#chat/' + CS.th.k + '/' + CS.th.ts;   // 합친 #메인 안에서 연 다른 채널 스레드(board.html mainOn) — 주소는 그 글 자리(/m/… · 열면 다시 #메인 + 그 스레드)
      if (cur.tab === 'chat' && cur.chan) return '#chat/' + cur.chan + (CS.th?.ts && CS.th.k === cur.chan ? '/' + CS.th.ts : '');
      if (cur.w) return '#w/' + encodeURIComponent(cur.w);
      if (cur.p) return '#node/' + encodeURIComponent(nodeKey(cur.p));
    }
    if (S.ag) return agHash(S.ag);
    return '#' + (S.ib || current);
  }
  let applying = 0, recQ = 0, backing = 0, G = 0;
  const canvasBackOn = () => { try { return localStorage.getItem('hb-canvasback') === '1'; } catch { return false; } };
  function record(){
    recQ = 0;
    if (applying || backing || !on() || /^#settings(\/|$|\?)/.test(HBR.hash())) return;   // 설정 화면(settings.js)이 주소를 맡음
    if (EMBED || window.BXStatus?.cur?.()) return;   // 상태 페이지(status.js)가 열려 있으면 주소는 그 페이지가 맡음
    if (S.artBack && !MVv()){ const b = S.artBack; S.artBack = null;
      // 닫으며 다른 화면을 연 경우에는 그 화면을 유지한다. 설정을 끄면 예전 닫기 동작을 쓴다.
      if (canvasBackOn() && /^#art\//.test(HBR.hash()) && history.state?.bx && HBR.same(history.state.from, b) && ans.hidden && !S.ib && current === S.artView){ backing = setTimeout(() => { backing = 0; recLater(); }, 1500); return history.back(); } }
    const h = want(); if (HBR.same(h, HBR.hash())) return;
    if (/^#unread(\?|$)/.test(h) && /^#unread(\?|$)/.test(HBR.hash())) return history.replaceState(history.state, '', h);   // 읽지 않음 안에서 글만 바꿈 = 그 자리를 고침(글마다 뒤로 가기 칸이 쌓이지 않게)
    if (/^#t=/.test(HBR.hash()) || !HBR.hash()) return history.replaceState(history.state, '', h);   // 보드 글 링크(#t=…)로 연 것은 그 자리를 바꿈
    if (history.state?.bx && history.state.from === h){ backing = setTimeout(() => { backing = 0; recLater(); }, 1500); return history.back(); }
    history.pushState({bx: 1, from: HBR.hash()}, '', h);
  }
  const recLater = () => { if (!recQ) recQ = requestAnimationFrame(record); };
  window.BXRecord = recLater;   // 읽지 않음에서 글을 고르면(inbox.js setFocus) 주소를 다시 — 화면이 안 바뀌는 누름이라 감시(MutationObserver)가 못 봄
  new MutationObserver(recLater).observe(ans, {attributes: true, childList: true, subtree: true});
  new MutationObserver(recLater).observe(document.body, {childList: true});
  const art0 = window.openArt;
  window.openArt = function(id){
    const h = HBR.hash();
    if (!MVv()){ S.artBack = canvasBackOn() && !/^#art\//.test(h) && !/^#settings(\/|$|\?)/.test(h) ? h : null; S.artView = current; }
    const r = art0.apply(this, arguments); S.art = id; S.artEl = MV.el; recLater(); return r;
  };
  const th0 = window.openThread;
  if (th0) window.openThread = function(){ const r = th0.apply(this, arguments); Promise.resolve(r).finally(recLater); recLater(); return r; };
  const until = (ok, ms = 10000) => new Promise(res => { const t0 = Date.now(), f = () => ok() || Date.now() - t0 > ms ? res(ok()) : setTimeout(f, 150); f(); });
  const linkSpin = on => { let el = document.getElementById('bx-lw'); if (!on){ el?.remove(); return; } if (el) return;
    el = document.createElement('div'); el.id = 'bx-lw'; el.setAttribute('role', 'status'); el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:60;pointer-events:none';
    el.innerHTML = '<i class="g g-spin"></i>'; document.body.appendChild(el); };
  const linkUntil = async (ok, ms = 30000) => { const t = setTimeout(() => linkSpin(true), 300); try { return await until(ok, ms); } finally { clearTimeout(t); linkSpin(false); } };
  const linkFail = () => toast('링크를 열지 못했어요');
  // 주소의 스레드에 맞춤: ts 가 있으면 그 스레드를 열고, 없으면 그 채널에 열린 스레드를 닫음(뒤로 가기). 틀 안 함수 그대로(th0 = 주소 기록 안 함)
  async function nodeTh(ts, gen){
    const k = cur?.chan; if (!k || !k.startsWith('n:') || gen !== G) return;
    if (ts && /^\d{10}\.\d{6}$/.test(ts)){ if (CS.th?.ts !== ts || CS.th.k !== k) await th0(k, ts); }
    else if (CS.th?.k === k && !CS.th.side){ CS.th = null; viewChat(true); }
  }
  async function apply(){
    if (!on() || /^#settings(\/|$|\?)/.test(HBR.hash())) return;
    if (backing){ clearTimeout(backing); backing = 0; }
    if (history.state?.bxRoot) history.replaceState(null, '', '#tree');   // 뒤로 가서 딥링크 밑 첫 화면 칸에 닿음 = 트리(사용자가 간 곳)
    if (HBR.hash() === '#chat') history.replaceState(history.state, '', '#chat/primary');
    const h = HBR.hash(), qi = h.indexOf('?'), hq = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : ''), [k, a, b] = (qi >= 0 ? h.slice(0, qi) : h).slice(1).split('/').map(x => decodeURIComponent(x || ''));   // #unread?msg=<글> — 물음표 뒤는 열쇠가 아님(설정 주소는 위에서 돌아감)
    const gen = ++G;
    let moved = false;   // 글 링크를 서버가 알려 준 자리로 옮겼으면 끝에서 주소를 링크로 되돌리지 않음
    applying++;
    try {
      const pre0 = () => { window.HB_ART0?.remove(); window.HB_ART0 = null; };
      if (k !== 'art'){ S.artBack = null; if (MVv()) mvClose(); pre0(); }
      if (k !== 'agents') agClose();
      if (k === 'art'){ const aid = () => ARTS[a] ? a : window.artId?.('#art/' + a);
        if (MVv() !== a){ if (await linkUntil(aid)){ if (gen === G && !/^#settings(\/|$|\?)/.test(HBR.hash())){ if (!ans.hidden) closeAns(); const id = aid(); openArt(id); if (id !== a){ history.replaceState(history.state, '', '#art/' + id); moved = true; } } } else if (gen === G){ pre0(); linkFail(); } } }
      else if (k === 'chat' && CH.includes(a)){
        if (b && typeof window.HBOpenCard === 'function' && !(chatMode() && (cur.chan === a || (cur.chan === 'primary' && CS.th?.k === a)) && CS.th?.ts === b)){   // 합친 #메인 안에 이미 연 그 스레드면 그대로
          const ready = await linkUntil(() => typeof panes !== 'undefined' && panes.length); if (!ready && gen === G) linkFail();
          if (ready && gen === G && !/^#settings(\/|$|\?)/.test(HBR.hash())){ ibClose(); S.ret = null;
            await window.HBOpenCard(b, {c: a, t: b});
            if (gen === G){ const w = want(); if (w && !HBR.same(w, HBR.hash())) history.replaceState(history.state, '', w); moved = true; } }
        }
        else if (!(chatMode() && cur.chan === a)){ ibClose(); openChan(a, b || undefined); }
        else if ((CS.th?.ts || '') !== (b || '')){ if (b) await th0(a, b); else { CS.th = null; viewChat(true); } }
      }
      else if (k === 'chat' && a){ moved = true; history.replaceState(history.state, '', '#' + (S.ib || current)); }   // 없는 채널 = 열 화면이 없음 → 지금 보기 주소로 바꿈(쌓지 않음 — 뒤로 가기가 이 주소로 돌아와 갇히지 않게)
      else if (k === 'inbox'){ if (cur?.chan !== 'i:turn'){ ibClose(); window.HBInbox?.openFeed('turn'); } }
      else if (k === 'node' && frontAlias(a)){ ibClose(); openChan('primary', b); }
      else if (k === 'node'){ const got = !!nodePane(a) || await linkUntil(() => nodePane(a) || (typeof panes !== 'undefined' && panes.length ? '-' : '')) && !!nodePane(a), pa = nodePane(a);
        if (!got && gen === G){ if (typeof openNode === 'function' && typeof nodeName === 'function' && nodeName(a)){ await openNode(a); await nodeTh(b, gen); } else linkFail(); }   // 닫힌 노드는 이름으로(보드 openNode)
        else if (got && gen === G && !/^#settings(\/|$|\?)/.test(HBR.hash()) && !(cur?.page && cur.p === pa)){ ibClose(); openAns({p: pa, page: true}); }
        if (got && gen === G && !/^#settings(\/|$|\?)/.test(HBR.hash())) await nodeTh(b, gen); }
      else if (k === 'agents'){ if (!ans.hidden) closeAns(); agOpen(a === 'channels' ? 'c' : a === 'a2a' ? 'x' : 'a', true); }
      else if (k === 'w'){ if (cur?.w !== a){ ibClose(); openAns({w: a}); } }
      else if (FEED(k)){ S.ret = null; if (ibChat() !== k){ const ready = await linkUntil(() => typeof panes !== 'undefined' && panes.length); if (!ready && gen === G) linkFail(); else if (ready && gen === G && !/^#settings(\/|$|\?)/.test(HBR.hash())){ ibClose(); window.HBInbox.openFeed(k); } }
        if (k === 'unread' && gen === G && hq.get('msg')) window.HBInbox?.focusTo?.(hq.get('msg')); }   // 그 글로(뒤로 · 앞으로 · 새로 고침 · 복사한 주소)
      else if (IBK.includes(k)){ S.ret = null; if (!ans.hidden) closeAns(); ibOpen(k, true); }
      else if (views[k]){ S.ret = null; if (!ans.hidden) closeAns(); if (S.ib){ ibClose(); } if (current !== k) show(k); }
      sync();
    } finally {
      applying--;
      if (gen === G){ R.classList.remove('bx-route'); window.HBViewWake?.(); }
      if (gen === G && !moved && !HBR.same(HBR.hash(), h) && !/^#settings(\/|$|\?)/.test(HBR.hash())) history.replaceState(history.state, '', h);
      recLater();   // 도는 사이 열린 화면은 그다음 주소로
    }
  }
  addEventListener('popstate', apply);

  const KIND_NAME = () => ({'': '전체', ...ART_KIND});
  const saveAQ = () => { try { localStorage.setItem('hb-arts-q', JSON.stringify({kind: AQ.kind, acct: AQ.acct, folder: AQ.folder, tab: AQ.tab, view: AQ.view})); } catch (e) {} };
  let A = null;
  function artsInit(){
    const v = $id('v-arts'), arts = v?.querySelector('.arts'), main = arts?.querySelector('.amain');
    if (!main || A) return !!A;
    const aside = mk('aside', 'bx-aside');
    aside.innerHTML = `<div class="bx-sh"><span>캔버스</span><button type="button" class="bx-ib1" data-bxq aria-label="찾기">${I.search}</button></div><div class="bx-k"></div><div class="bx-sec">영역</div><div class="bx-f"></div><div class="bx-sec">최근</div><div class="bx-rec"></div>`;
    arts.prepend(aside); aside.querySelector('.bx-f').append(arts.querySelector('.afold'));
    const top = mk('div', 'bx-top', `<h2><button type="button" class="bx-kd" aria-haspopup="true" aria-expanded="false"><span class="bx-kt"></span>${I.fold}</button></h2><div class="bx-kmenu" hidden></div><button type="button" class="bx-mq" data-bxq aria-label="찾기">${I.search}</button>`);
    const bar = mk('div', 'bx-bar'), dd = mk('div', 'bx-dd', '<label><select data-bxsel="folder" aria-label="영역"></select></label><label><select data-bxsel="acct" aria-label="계정"></select></label>');
    const th = mk('div', 'bx-th', '<span>이름</span><span>계정</span><span>바뀐 때</span>');
    main.prepend(top, bar); main.querySelector('.artq').after(dd); $id('artl').before(th);
    bar.append(main.querySelector('[data-aqk="acct"]'));
    // 안 A 격자: 탭(최근 · 고정 · 전체) · 격자 ↔ 표 단추 · 카드 판. 표는 보드 원본(#artl) 그대로 두고 격자일 때만 감춤
    const tabs = mk('div', 'bx-cv-tabs', GTAB.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}">${n}</button>`).join('')); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '캔버스 보기');
    const vt = mk('div', 'bx-cv-vt', `<button type="button" data-vw="grid" aria-label="격자로 보기" title="격자">${I.gridv}</button><button type="button" data-vw="table" aria-label="표로 보기" title="표">${I.listv}</button>`); vt.setAttribute('role', 'group'); vt.setAttribute('aria-label', '보기 방식');
    const grid = mk('div', 'bx-cv-grid'); grid.setAttribute('aria-live', 'polite'); bar.prepend(tabs); $id('artl').after(grid);
    $id('artq').placeholder = '찾기 — 제목 · 내용';
    A = {tabs, vt, grid, v, arts, main, aside, top, bar, dd, kind: main.querySelector('[data-aqk="kind"]'), km: top.querySelector('.bx-kmenu'), kd: top.querySelector('.bx-kd')};
    const kmSet = o => { A.km.hidden = !o; A.kd.setAttribute('aria-expanded', !!o); };
    A.kd.addEventListener('click', () => { if (PC.matches) kmSet(A.km.hidden); });
    A.km.addEventListener('click', e => { if (e.target.closest('[data-aqv]')) setTimeout(() => kmSet(false), 0); });
    document.addEventListener('click', e => { if (!A.km.hidden && !e.target.closest('.bx-kmenu, .bx-kd')) kmSet(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !A.km.hidden){ e.stopPropagation(); kmSet(false); A.kd.focus(); } }, true);
    // 찾기 단추: PC 는 찾기 칸으로, 폰은 찾기 칸을 펼침
    v.addEventListener('click', e => { if (e.target.closest('[data-bxq]')){ v.classList.add('bx-q'); $id('artq').focus(); } });
    v.addEventListener('click', e => {
      const f = e.target.closest('.afold [data-af]'), k = e.target.closest('[data-aqk="kind"] [data-aqv=""]');
      if (f && f.dataset.af && f.getAttribute('aria-pressed') === 'true'){ e.stopPropagation(); AQ.folder = ''; saveAQ(); artsDraw(); }
      else if (k) AQ.folder = '';
    }, true);
    dd.addEventListener('change', e => { const s = e.target.closest('[data-bxsel]'); if (!s) return; AQ[s.dataset.bxsel] = s.value; saveAQ(); artsDraw(); });
    const setTab = t => { AQ.tab = t; saveAQ(); gridDraw(true); }, setView = w => { AQ.view = w; saveAQ(); gridDraw(true); mark(); };
    v.addEventListener('click', e => {
      const tb = e.target.closest('[data-tab]'), vw = e.target.closest('[data-vw]'), st = e.target.closest('[data-star]'), mo = e.target.closest('[data-bxmo]'), ln = e.target.closest('.bx-cv-th, .bx-cv-tx');
      if (tb) return setTab(tb.dataset.tab);
      if (vw) return setView(vw.dataset.vw);
      if (st){ e.stopPropagation(); const id = st.closest('.bx-cv-card').dataset.id; return gPin(id, !ARTS[id]?.pin); }
      if (mo){ e.stopPropagation(); return gMenu(mo); }
      if (ln && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button)){ e.preventDefault(); e.stopPropagation(); const id = ln.dataset.art; if (ARTS[id]){ if (!ans.hidden) closeAns(); openArt(id); } }
    });
    tabs.addEventListener('keydown', e => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; const i = GTAB.findIndex(x => x[0] === gTab()); setTab(GTAB[(i + (e.key === 'ArrowRight' ? 1 : GTAB.length - 1)) % GTAB.length][0]); tabs.querySelector('[aria-selected="true"]')?.focus(); });
    grid.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);   // 그림이 아직 없으면(404) 아이콘 자리가 그대로 남음
    $id('artq').addEventListener('input', gridFind);
    new MutationObserver(mark).observe($id('artl'), {childList: true});
    artsLay(); return true;
  }
  function artsLay(){   // 종류 단추: PC 제목 아래 고르개 · 폰 위 알약 줄. 영역 고르개: PC 계정 알약 줄 오른쪽 · 폰 찾기 아래
    if (!A) return;
    (PC.matches ? A.km : A.bar).append(A.kind);
    if (PC.matches){ A.bar.append(A.dd, A.vt); } else A.main.querySelector('.artq').after(A.dd);
    gridDraw(true);
  }
  const STAR = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/></svg>';
  const GTAB = [['recent', '최근'], ['pin', '고정'], ['all', '전체']], GRECENT = 24;
  const gTab = () => AQ.tab === 'pin' || AQ.tab === 'all' ? AQ.tab : 'recent';
  const gTbl = () => AQ.view === 'table' && PC.matches;   // 폰은 표가 없음(단추도 없음)
  const atSec = at => { const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/.exec(at || ''); return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`) / 1000 : 0; };   // 목록 칸 at = 서울 시각 「YYYY-MM-DD HH:MM」
  const GV = {};   // 썸네일을 바꾼 뒤 다시 받게 하는 표지(?v=)
  let GQ = {q: '', ids: new Set()}, gSig = '', gQt = 0;
  function gridRows(){
    const q = (AQ.q || '').trim().toLowerCase(), f = AQ.folder || '', tab = gTab();
    let rows = Object.entries(ARTS).map(([id, x]) => ({id, ...x})).filter(r => (!AQ.kind || r.kind === AQ.kind) && (!AQ.acct || r.acct === AQ.acct) && inFolder(r, f)
      && (!q || (r.title || '').toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || GQ.q === q && GQ.ids.has(r.id)));
    rows.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    if (tab === 'pin') rows = rows.filter(r => r.pin); else if (tab === 'recent') rows = rows.slice(0, GRECENT);
    return rows;
  }
  function gCard(r){
    const k = r.kind === 'canvas' ? 'canvas' : r.kind === 'page' ? 'page' : 'doc', id = esc(r.id), pin = !!r.pin, v = encodeURIComponent([r.at || '', k === 'canvas' ? r.thumb || '' : '', GV[r.id] || ''].join('|'));
    const t = esc(r.title || r.id), sub = esc([ART_ACCT[r.acct] || '', agoS(atSec(r.at))].filter(Boolean).join(' · '));
    return `<div class="bx-cv-card k-${k}${pin ? ' pin' : ''}" data-id="${id}"><a class="bx-cv-th" href="art/${id}/" data-art="${id}" tabindex="-1" aria-hidden="true">${k === 'canvas' ? `<span class="bx-cv-ph">${I.canvas}</span>` : ''}${k !== 'doc' ? `<img src="/art/${id}/_thumb.jpg?v=${v}" alt="" loading="lazy" decoding="async" draggable="false">` : ''}</a>`
      + `<button type="button" class="bx-cv-star" data-star aria-pressed="${pin}" aria-label="${pin ? '고정 풀기' : '고정'}" title="${pin ? '고정 풀기' : '고정'}">${STAR}</button>`
      + `<div class="bx-cv-meta"><i class="bx-cv-ic" aria-hidden="true">${k === 'canvas' ? I.canvas : ''}</i><a class="bx-cv-tx" href="art/${id}/" data-art="${id}"><b>${t}</b><small>${sub}</small></a><button type="button" class="bx-cv-mo amv" data-bxmo aria-haspopup="menu" aria-expanded="false" aria-label="메뉴 — ${t}" title="메뉴">⋯</button></div></div>`;
  }
  function gridDraw(force){
    if (!A?.grid) return;
    const tbl = gTbl(), tab = gTab();
    A.v.classList.toggle('bx-cv-on', !tbl);
    A.tabs.querySelectorAll('[data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    A.vt.querySelectorAll('[data-vw]').forEach(b => b.setAttribute('aria-pressed', (b.dataset.vw === 'table') === tbl));
    if (tbl) return;
    const rows = gridRows(), sig = tab + '|' + rows.map(r => [r.id, r.title, r.at, r.pin ? 1 : 0, r.thumb || '', r.acct, GV[r.id] || ''].join('~')).join('|') + (ARTS_OK ? '' : '?');
    if (!force && sig === gSig) return; gSig = sig;
    A.grid.innerHTML = rows.length ? rows.map(gCard).join('')
      : !Object.keys(ARTS).length && !ARTS_OK ? `<div class="bx-cv-none">${LOADING}</div>`
      : `<div class="bx-cv-none"><b>${tab === 'pin' && !AQ.q && !AQ.acct && !AQ.kind && !AQ.folder ? '고정한 캔버스가 없어요' : '맞는 캔버스가 없어요'}</b><span>${tab === 'pin' ? '카드에 마우스를 올리고 별을 누르면 여기 모여요.' : '찾는 말이나 영역 · 계정 거르기를 바꿔 보세요.'}</span></div>`;
  }
  function gridFind(){
    clearTimeout(gQt); const q = (AQ.q || '').trim().toLowerCase();
    if (q.length < 2){ if (GQ.q){ GQ = {q: '', ids: new Set()}; gridDraw(); } return; }
    gQt = setTimeout(async () => {
      try { const j = await (await fetch('api/search?q=' + encodeURIComponent(q), {cache: 'no-store', credentials: 'same-origin'})).json();
        if ((AQ.q || '').trim().toLowerCase() !== q) return;
        GQ = {q, ids: new Set((j.arts || []).map(a => String(a.id || '').replace(/^[a-z]:/, '')))}; gridDraw(); } catch (e) {}
    }, 300);
  }
  function gPin(id, on){
    const was = ARTS[id]; if (!was) return; let got = on;
    optDo({key: 'artstar:' + id, apply: () => { ARTS[id] = {...was, pin: on}; gridDraw(); },
      send: () => optPost('api/artstar', {art: id, on}).then(j => { if (typeof j?.pin === 'boolean') got = j.pin; }),
      undo: () => { ARTS[id] = was; gridDraw(); }})
      .then(ok => { if (!ok) return; ARTS[id] = {...ARTS[id], pin: got}; gridDraw(); toast(got ? '고정했어요' : '고정을 풀었어요'); });
  }
  const gw = {};
  const gHead = async id => { try { const r = await fetch('/art/' + encodeURIComponent(id) + '/_thumb.jpg?w=' + Date.now(), {cache: 'no-store', credentials: 'same-origin'}); return r.ok ? [r.headers.get('etag'), r.headers.get('last-modified'), (await r.blob()).size].join('|') : '404'; } catch (e) { return null; } };   // 머리말에 ETag 가 없는 길도 있어 받은 크기를 같이 봄
  async function gThumbWatch(id){
    clearTimeout(gw[id]); const t0 = Date.now(), base = await gHead(id); GV[id] = t0; gridDraw();
    const tick = async () => {
      if (Date.now() - t0 > 420000 || !ARTS[id]) return delete gw[id];
      const now = await gHead(id), blind = !base || base === '||' || now === null;
      if (now !== base || blind){ GV[id] = Date.now(); gridDraw(); if (!blind) return delete gw[id]; }
      gw[id] = setTimeout(tick, blind ? 45000 : 30000);
    };
    gw[id] = setTimeout(tick, 15000);
  }
  window.BXThumbWatch = gThumbWatch;
  document.addEventListener('visibilitychange', () => { if (!document.hidden && typeof current !== 'undefined' && current === 'arts' && typeof loadArts === 'function') loadArts(); });
  function gThumb(id, board){
    const was = ARTS[id]; if (!was) return; let got = board;
    optDo({key: 'artthumb:' + id, apply: () => { ARTS[id] = {...was, thumb: board}; gridDraw(); },
      send: () => optPost('api/artthumb', {art: id, board}).then(j => { if (typeof j?.thumb === 'string') got = j.thumb; }),
      undo: () => { ARTS[id] = was; gridDraw(); }})
      .then(ok => { if (!ok) return; ARTS[id] = {...ARTS[id], thumb: got}; GV[id] = Date.now(); gridDraw();
        toast(got ? '썸네일로 지정했어요 — 새 그림은 잠시 뒤 보여요' : '첫 판으로 되돌렸어요 — 새 그림은 잠시 뒤 보여요'); gThumbWatch(id); });
  }
  // ⋯ 메뉴: 보드의 폴더 옮기기 팝업과 같은 자리 · 같은 모양(#amvp — 바깥을 누르면 · Esc 로 보드가 닫아 줌)
  function gMenu(btn){
    const was = btn.getAttribute('aria-expanded') === 'true'; amvClose(); if (was) return;
    const card = btn.closest('.bx-cv-card'), id = card.dataset.id, it = ARTS[id]; if (!it) return;
    const items = [['open', '열기'], ['tab', '새 탭에서 열기'], ['copy', '링크 복사'], null, ['pin', it.pin ? '고정 풀기' : '고정'],
      ...(it.kind === 'canvas' ? [['thumb', '썸네일 바꾸기…'], ...(it.thumb ? [['first', '첫 판으로 되돌리기']] : [])] : []), ['move', '폴더 옮기기…']];
    const p = mk('div'); p.id = 'amvp'; p.className = 'bx-cv-menu'; p.setAttribute('role', 'menu');
    p.innerHTML = items.map(x => x ? `<button type="button" role="menuitem" data-gm="${x[0]}">${x[1]}</button>` : '<hr>').join('');
    document.body.append(p); btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect(), h = p.offsetHeight;
    p.style.left = Math.max(12, Math.min(innerWidth - p.offsetWidth - 12, r.right - p.offsetWidth)) + 'px';
    p.style.top = (r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
    p.querySelector('button').focus();
    p.addEventListener('keydown', e => { const bs = [...p.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus(); } });
    p.addEventListener('click', e => {
      const b = e.target.closest('[data-gm]'); if (!b) return; const m = b.dataset.gm; amvClose(); btn.focus();
      if (m === 'open'){ if (!ans.hidden) closeAns(); openArt(id); }
      else if (m === 'tab') window.open('/art/' + encodeURIComponent(id) + '/', '_blank', 'noopener');
      else if (m === 'copy') copyLink(id);
      else if (m === 'pin') gPin(id, !it.pin);
      else if (m === 'thumb') gPick(id);
      else if (m === 'first') gThumb(id, '');
      else if (m === 'move'){ btn.dataset.amv = id; amvOpen(btn); delete btn.dataset.amv; }
    });
  }
  async function copyLink(id){
    const u = location.origin + '/canvas/' + encodeURIComponent(id);
    try { await navigator.clipboard.writeText(u); toast('링크를 복사했어요'); }
    catch (e) { const t = mk('textarea'); t.value = u; t.style.cssText = 'position:fixed;opacity:0'; document.body.append(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {} t.remove(); toast(ok ? '링크를 복사했어요' : '복사하지 못했어요 — ' + u, 5000, !ok); }
  }
  let gp = null;
  function gPickClose(){ if (!gp) return; const o = gp.opener; gp.el.remove(); gp = null; o?.focus?.(); }
  async function gPick(id){
    gPickClose(); const it = ARTS[id]; if (!it) return;
    const el = mk('div', 'bx-cv-tp', `<div class="bx-cv-tpb" role="dialog" aria-modal="true" aria-label="썸네일 바꾸기"><div class="bx-cv-tph"><b>썸네일 바꾸기</b><span>${esc(it.title || id)}</span><button type="button" data-x aria-label="닫기">×</button></div><div class="bx-cv-tpl"><p class="bx-cv-tpm">판 목록을 불러오는 중이에요</p></div></div>`);
    document.body.append(el); gp = {el, id, opener: document.activeElement};
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-x]')) return gPickClose();
      const b = e.target.closest('[data-board]'); if (b){ const bd = b.dataset.board; gPickClose(); gThumb(id, bd === it.first ? '' : bd); } });
    el.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.stopPropagation(); gPickClose(); } }, true);
    el.querySelector('[data-x]').focus();
    const box = el.querySelector('.bx-cv-tpl');
    try {
      const r = await fetch('/art/' + encodeURIComponent(id) + '/canvas.json', {cache: 'no-store', credentials: 'same-origin'}); if (!r.ok) throw 0;
      const cj = await r.json(), bs = cj.boards && typeof cj.boards === 'object' ? cj.boards : {};
      const names = [...new Set([...(cj.order || []), ...Object.keys(bs)])].filter(n => bs[n] && typeof n === 'string' && !n.includes('/') && n.endsWith('.html'));
      if (!gp || gp.el !== el) return;
      if (!names.length) throw 0;
      it.first = names[0]; const cur = it.thumb && names.includes(it.thumb) ? it.thumb : names[0], W = 232, H = 145;
      box.innerHTML = names.map(n => { const b = bs[n], w = +b.w || 1520, s = W / w;
        return `<button type="button" class="bx-cv-tpi" data-board="${esc(n)}" aria-pressed="${n === cur}"><span class="bx-cv-tpv"><iframe src="/art/${encodeURIComponent(id)}/${encodeURIComponent(n)}" loading="lazy" tabindex="-1" sandbox="allow-scripts" title="판 미리보기" style="width:${w}px;height:${Math.ceil(H / s)}px;transform:scale(${s})"></iframe></span><span class="bx-cv-tpt">${esc(b.title || n.replace(/\.dc\.html$|\.html$/, ''))}${n === cur ? '<em>현재</em>' : ''}</span></button>`; }).join('');
      box.querySelector('[aria-pressed="true"]')?.focus();
    } catch (e) { if (gp?.el === el) box.innerHTML = '<p class="bx-cv-tpm">판 목록을 불러오지 못했어요. 잠시 뒤 다시 해 보세요.</p>'; }
  }
  function arts(){ if (artsInit()) mark(); }
  function mark(){
    if (!A) return;
    for (const r of A.v.querySelectorAll('.arow')){ const k = r.querySelector('.k')?.textContent.trim(); r.classList.add(k === ART_KIND.canvas ? 'k-canvas' : k === ART_KIND.page ? 'k-page' : 'k-doc');
      const a = r.querySelector('a[data-art]');
      if (a && (typeof gTbl !== 'function' || gTbl()) && !a.querySelector('.bx-art-thumb')) a.insertAdjacentHTML('afterbegin', artThumb(a.dataset.art));   // 격자일 때는 숨은 표에 미리보기 틀을 411개 달지 않음(표로 바꿀 때 mark 가 다시 돎)
    }
    if (typeof gridDraw === 'function') gridDraw();
    const fold = AQ.folder || '';
    A.top.querySelector('.bx-kt').textContent = PC.matches && (AQ.kind || typeof gTbl === 'function' && gTbl()) ? (KIND_NAME()[AQ.kind] || '전체') : '캔버스';
    const rec = Object.entries(ARTS).map(([id, x]) => ({id, ...x})).sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 5);
    A.aside.querySelector('.bx-rec').innerHTML = rec.map(r => `<a href="art/${r.id}/" class="k-${r.kind || 'doc'}"><i></i><span>${esc(r.title || r.id)}</span></a>`).join('');
    const areas = [...A.v.querySelectorAll('.afold [data-af]')].map(b => b.dataset.af).filter(a => a && !a.includes('/'));
    const fs = A.dd.querySelector('[data-bxsel="folder"]'), as = A.dd.querySelector('[data-bxsel="acct"]');
    const fo = [['', '모든 영역'], ...areas.map(a => [a, a]), ...(fold && !areas.includes(fold) ? [[fold, fold]] : [])], ao = [['', '모든 계정'], ...Object.entries(ART_ACCT)];
    const opt = (sel, os, val) => { const sig = os.map(o => o[0]).join('|'); if (sel.dataset.sig !== sig){ sel.dataset.sig = sig; sel.innerHTML = os.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join(''); } sel.value = val; };
    opt(fs, fo, fold); opt(as, ao, AQ.acct || '');
  }

  PC.addEventListener('change', () => { place(); sync(); });
  if (!ans.hidden && cur && cur.tab === 'chat' && cur.chan){ S.chat = S.last = cur.chan; wasOpen = true; }
  place(); sync();
  const h0 = String(window.HB_HASH0 || '');
  if (on() && (ROUTE.test(h0) || IBK.includes(ibKey(h0)))){
    history.replaceState(history.state, '', h0); apply();
    const nav = performance.getEntriesByType?.('navigation')[0]?.type;
    if (!EMBED && nav === 'navigate' && !history.state?.bx){
      const guard = () => { removeEventListener('pointerup', guard, true); removeEventListener('keydown', guard, true);
        if (history.state?.bx || !ROUTE.test(HBR.hash()) && !IBK.includes(ibKey(HBR.hash()))) return;
        const here = HBR.hash(); history.replaceState({bxRoot: 1}, '', here); history.pushState({bx: 1, from: '#tree'}, '', here); };
      addEventListener('pointerup', guard, true); addEventListener('keydown', guard, true);
    }
  }
  else { if (!/^#settings(\/|$|\?)/.test(h0) || !on()) R.classList.remove('bx-route'); recLater(); }   // 설정 주소는 설정 화면(settings.js)이 그린 뒤 걷음 — 그 사이 트리가 비치지 않게
})();
(() => {
  if (!window.HB_LIVE) return;
  const PCQ = matchMedia('(min-width: 861px)');
  const net = () => { const n = navigator.connection; return n ? {net: n.effectiveType, net_type: n.type, rtt: n.rtt} : {}; };
  const send = (action, ms, x) => { try { window.posthog?.capture('boarder_ui', {action, ms: Math.round(ms), mobile: !PCQ.matches, pwa: matchMedia('(display-mode: standalone)').matches, ...net(), ...x}); } catch {} };
  window.BX_UI = send;   // 다시 연결(LiveES) 도 같은 꼴로
  const paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));   // 그린 다음 프레임까지
  const wrap = (name, action, until, every = 1) => {
    const f = window[name]; if (typeof f !== 'function') return;
    window[name] = function (...a){
      if (every > 1 && Math.random() >= 1 / every) return f.apply(this, a);   // 자주 도는 것은 고르게 덜어 냄 — 무료 한도
      const t = performance.now(), hid = document.hidden, out = f.apply(this, a);
      Promise.resolve(out).then(() => until ? until(a) : paint()).then(() => { if (!hid && !document.hidden) send(typeof action === 'function' ? action(a) : action, performance.now() - t, every > 1 ? {sample: every} : undefined); }, () => {});
      return out;
    };
  };
  // 첫 화면: 보드 데이터는 페이지에 실려 와 이 스크립트 전에 그려짐 — 이 다음 그림 때(탐색 시작부터). 서버 첫 바이트(ttfb)도 따로
  const hid0 = document.hidden;
  paint().then(() => {
    if (hid0 || document.hidden) return;
    send('first_screen', performance.now());
    const n = performance.getEntriesByType('navigation')[0]; if (n) send('ttfb', n.responseStart - n.startTime);
  });
  // 첫 그림 · 상호작용 가능 · 다 읽힘: 이 스크립트는 문서 끝을 읽는 중에 돌아 아직 값이 없음 — load 뒤에(큰 첫 HTML 이라 그 차가 곧 내려받기 시간)
  const late = () => paint().then(() => {
    if (hid0 || document.hidden) return;
    const n = performance.getEntriesByType('navigation')[0], fp = performance.getEntriesByName('first-contentful-paint')[0];
    if (fp) send('first_paint', fp.startTime);
    if (n?.domInteractive) send('interactive', n.domInteractive - n.startTime);
    if (n?.loadEventStart) send('page_load', n.loadEventStart - n.startTime);
  });
  if (document.readyState === 'complete') late(); else addEventListener('load', late, {once: true});
  wrap('openAns', 'card_open');
  wrap('openChan', 'channel_open');
  wrap('openThread', 'thread_open');
  wrap('chatSend', 'send_settled');   // 올리기 · 전달 확인까지 끝난 때(재시도 · 답 확인 포함) — 말풍선은 바로 뜸, 서버 왕복은 send_roundtrip
  wrap('chatReact', 'reaction');
  wrap('chatLoad', 'chat_load', undefined, 10);
  (() => {
    let lag = [];
    document.addEventListener('input', e => { if (!e.target.matches?.('textarea') || document.hidden) return; const s0 = performance.now();
      paint().then(() => { if (document.hidden) return; lag.push(performance.now() - s0); if (lag.length < 20) return; const v = lag.sort((a, b) => a - b); lag = [];
        send('type_lag', v[v.length >> 1], {max: Math.round(v[v.length - 1]), n: v.length}); }); }, true);
    if (!window.PerformanceObserver?.supportedEntryTypes?.includes('long-animation-frame')) return;
    let worst = null, cnt = 0;
    try { new PerformanceObserver(l => { for (const f of l.getEntries()) { if (f.duration < 150) continue; cnt++; if (!worst || f.duration > worst.duration) worst = f; } }).observe({type: 'long-animation-frame'}); } catch { return; }
    setInterval(() => { const w = worst, n = cnt; worst = null; cnt = 0; if (!w || document.hidden) return;
      const sc = [...(w.scripts || [])].sort((a, b) => b.duration - a.duration)[0];
      send('long_frame', w.duration, {n, block: Math.round(w.blockingDuration || 0), fn: String(sc?.sourceFunctionName || sc?.invoker || '').slice(0, 60), src: String(sc?.sourceURL || '').split('/').pop().split('?')[0].slice(0, 40)}); }, 60000);
  })();
  (() => { let lt = 0; try { new PerformanceObserver(l => { lt += l.getEntries().length; }).observe({type: 'longtask', buffered: false}); } catch (e) {}
    setInterval(() => { const m = performance.memory; const n = lt; lt = 0;
      try { window.posthog?.capture('boarder_ui', {action: 'idle_cost', ms: m ? Math.round(m.usedJSHeapSize / 1048576) : -1, longtasks: n, hidden: document.hidden, focus: document.hasFocus(), mobile: !PCQ.matches}); } catch (e) {} }, 300000); })();
  // 노드 트리 그리기: 바뀔 때마다 도니 10번에 1번만(고르게)
  { const f = window.redraw; if (typeof f === 'function') window.redraw = function (...a){ if (Math.random() >= 0.1) return f.apply(this, a); const t = performance.now(), out = f.apply(this, a); send('tree_draw', performance.now() - t, {sample: 10}); return out; }; }
  // 찾기 · 글 보내기 왕복: 서버 답까지(화면에 보인 때는 send_visible)
  { const f0 = window.fetch; window.fetch = function (u, o){
      const s = typeof u === 'string' ? u : u?.url || '', m = (o?.method || 'GET').toUpperCase(), body = typeof o?.body === 'string' ? o.body : '';
      // POST api/chat 는 읽음 · 반응 · 고치기 · 지우기도 탐 — 글 보내기(text 가 있고 나머지 표 없음)만
      let sendMsg = false; if (m === 'POST' && /(^|\/)api\/chat$/.test(s)) { try { const b = JSON.parse(body); sendMsg = !!b.text && !b.seen && !b.edit && !b.delete; } catch {} }
      const name = /(^|\/)api\/search\?/.test(s) ? 'search' : sendMsg ? 'send_roundtrip' : '';
      if (!name) return f0.apply(this, arguments);
      const t = performance.now(), p = f0.apply(this, arguments);
      p.then(r => send(name, performance.now() - t, {status: r.status}), () => {});
      return p;
    }; }
  wrap('show', a => 'view_' + String(a[0] || '').replace(/[^a-z]/g, '').slice(0, 12));
  wrap('openArt', 'canvas_open', () => new Promise(res => {
    const f = document.querySelector('#mview iframe'); if (!f || f.closest('#mview').dataset.loaded) return res();
    let d = false; const done = () => { if (!d){ d = true; res(); } };
    f.addEventListener('load', done, {once: true}); setTimeout(done, 20000);
  }));
})();
(() => {
  if (!window.HB_LIVE || typeof evOpen !== 'function' || typeof evClose !== 'function' || !window.WebSocket) return;
  const Native = window.EventSource, POLL = 5000, CHECK = 30000, PING = 10000, PONG = 5000, DOWN = 30000, STALE = 25000;
  let seq = 0, offAt = 0, cur = null;
  const EV = [], note = (k, v = '') => { EV.push([now(), k, v]); if (EV.length > 60) EV.shift(); };   // 최근 60개(시험 · 「갱신 안 됨」 볼 때 BX_LIVE().ev)
  const now = () => Date.now(), kst = t => typeof kstMin === 'function' ? kstMin(t) : '';
  const wsUrl = () => { const u = new URL('/api/live', location.href); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; return u.href; };
  class LiveES {
    constructor(url, opt){
      if (!/(^|\/)api\/events$/.test(String(url))) return new Native(url, opt);   // 그 밖(api/push/stream)은 원래 것
      Object.assign(this, {readyState: 0, onmessage: null, onopen: null, onerror: null, srv: {}, ws: null, wsUp: false, closed: false, down: false, back: 500, okAt: now(), t: {}});
      cur = this;
      if (now() - offAt < 300000) { setTimeout(() => this.fatal(), 0); return; }
      this.connect();
      this.t.first = setTimeout(() => { if (!this.wsUp) this.poll(true); }, 3000);
      this.nCheck = 0;
      this.t.check = setInterval(() => { if (this.readyState !== 1) return; const full = ++this.nCheck % 4 === 0;
        this.get().catch(() => {}).finally(() => { if (this.closed) return; if (full) return this.catchUp();
          const sv = String(this.srv.data || ''); if (sv && !sv.startsWith('~') && typeof dataTag === 'string' && dataTag && tagOf(sv) !== tagOf(dataTag)) this.send(true); }); }, CHECK);
      // 주인 data 스냅숏이 낡음(서버가 준 나이 + 지난 시간 > 25초 — board-snap 멈춤): 20초마다 data 를 새 값으로 → 보드가 다시 읽고 Worker 는 낡은 스냅숏 대신 다리로
      this.t.stale = setInterval(() => { if (this.snapAt && now() - this.snapAt > STALE) { const v = '~s' + Math.floor(now() / 20000); if (this.srv.data !== v) { note('stale', Math.round((now() - this.snapAt) / 1000)); this.srv.data = v; this.send(true); } } }, 5000);
    }
    connect(){
      if (this.closed || this.ws) return;
      clearTimeout(this.t.re);
      let ws; try { ws = this.ws = new WebSocket(wsUrl()); } catch (e) { this.ws = null; return this.retry(); }
      ws.onopen = () => { if (this.ws !== ws) return; note('open'); if (this.lostAt) { window.BX_UI?.('reconnect', now() - this.lostAt); this.lostAt = 0; } this.wsUp = true; this.openAt = now(); this.okAt = now(); clearTimeout(this.t.poll);
        clearTimeout(this.t.cu); const late = this.opened ? Math.random() * 8000 : 0; this.opened = true;
        if (late) this.t.cu = setTimeout(() => { if (!this.closed) this.get().catch(() => {}); }, late); else this.catchUp();
        this.up(); this.ping(); };
      ws.onmessage = e => { if (this.ws !== ws) return;
        if (e.data === 'pong'){ this.pongAt = now(); this.okAt = now(); return; }
        let j; try { j = JSON.parse(e.data); } catch (x) { return; }
        if (j && Array.isArray(j.dd)) push(j.dd, j.age);   // 바뀐 칸을 가진 판에 끼움 — 보드가 다시 읽을 때 왕복 없이 이 판(아래 fetch)
        if (j && j.t) { note('ws', Object.keys(j.t).join(',')); this.apply(j.t, false, j.age); } };
      ws.onclose = e => this.gone(ws, e.code);
    }
    gone(ws, code){   // 끊김(닫힘 · 답 없음): 곧바로 폴링 + 다시 붙기
      if (this.ws !== ws) return; note('close', code); this.ws = null; const was = this.wsUp; if (was && !document.hidden) this.lostAt = now(); this.wsUp = false; clearInterval(this.t.ping); clearTimeout(this.t.pong);
      if (this.closed) return;
      if (was && now() - this.openAt > 10000) this.back = 500;   // 오래 붙어 있던 연결이 끊김(배포 · DO 나감) — 바로 다시
      this.poll(true); this.retry();
    }
    retry(){ if (this.closed) return; clearTimeout(this.t.re); this.t.re = setTimeout(() => this.connect(), this.back * (0.8 + Math.random() * 0.4)); this.back = Math.min(this.back * 2, 30000); }
    ping(){ clearInterval(this.t.ping); this.t.ping = setInterval(() => { const ws = this.ws; if (!ws || ws.readyState !== 1) return;
      const at = now(); try { ws.send('ping'); } catch (e) {}
      clearTimeout(this.t.pong); this.t.pong = setTimeout(() => { if (this.ws === ws && !(this.pongAt >= at)) { this.gone(ws, 'pong'); try { ws.close(); } catch (e) {} } }, PONG); }, PING); }   // 답 없으면 반쯤 끊긴 연결(폰 잠금 · 망 바뀜 · 서버 쪽만 닫힘) — 닫기 끝을 안 기다리고 바로 폴링 · 다시 붙기
    async get(){
      const r = await fetch('/api/live', {cache: 'no-store', headers: {accept: 'application/json'}, signal: AbortSignal.timeout?.(8000)});
      if ([401, 403, 404].includes(r.status)) { offAt = now(); this.fatal(); throw new Error('off'); }
      if (!r.ok) throw new Error(r.status);
      const j = await r.json(); this.okAt = now(); note('get'); this.apply(j.t || {}, true, j.age);
    }
    poll(first){
      if (this.closed || this.wsUp) return;
      clearTimeout(this.t.poll);
      this.t.poll = setTimeout(async () => {
        if (this.closed || this.wsUp) return;
        try { await this.get(); this.up(); }
        catch (e) { if (this.closed) return; note('fail', String(e?.message || e).slice(0, 40)); if (now() - this.okAt > DOWN) this.lost(); }
        this.poll();
      }, first ? 0 : POLL);
    }
    // 바뀐 칸만 보드에 — 값이 그대로면 보드도 안 다시 읽음. data 는 보드가 가진 ETag(dataTag)와 맞대므로 바뀐 때만 서버 값, 그 밖엔 보드 값
    apply(t, beat, age){
      if (typeof age === 'number' && age >= 0) { const at = now() - age; beat = beat || !(this.snapAt >= at - 1000); this.snapAt = Math.max(this.snapAt || 0, at); }   // 주인: 서버 시계 기준 data 나이
      let dataNew = false, any = false;
      for (const k of Object.keys(t)) if (this.srv[k] !== t[k]) { any = true; if (k === 'data') dataNew = true; this.srv[k] = t[k]; }
      if (any || beat) this.send(dataNew);
    }
    catchUp(){ const v = '~' + (++seq); for (const k of ['data', 'topics', 'chat', 'drafts']) this.srv[k] = v; this.send(true); }   // 붙음 = 한 번 전체(보드가 ETag 로 다시 읽음 — 그 사이 놓친 것 0)
    send(dataNew){
      const j = {...this.srv, ...(this.snapAt ? {gen: kst(this.snapAt)} : {})};   // gen = 스냅숏이 마지막으로 맞았던 때(주인). 회원은 없음 — 보드가 다시 읽은 답으로 앎
      if (!dataNew && typeof dataTag === 'string' && dataTag) j.data = dataTag;
      if (!j.data) delete j.data;
      try { this.onmessage?.({data: JSON.stringify(j)}); } catch (e) { console.error(e); }
    }
    up(){ const was = this.down; this.down = false; if (this.readyState !== 1) { this.readyState = 1; try { this.onopen?.(); } catch (e) {} } if (was) stamp(); }
    lost(){ if (this.down) return; this.down = true; if (this.readyState === 1) { this.readyState = 0; try { this.onerror?.(); } catch (e) {} } stamp(); }
    fatal(){ this.close(); try { this.onerror?.(); } catch (e) {} }
    close(){ this.closed = true; this.readyState = 2; for (const k in this.t) { clearTimeout(this.t[k]); clearInterval(this.t[k]); } const ws = this.ws; this.ws = null; this.wsUp = false; if (ws) try { ws.close(1000); } catch (e) {} if (this.down) { this.down = false; stamp(); } }
  }
  LiveES.CONNECTING = 0; LiveES.OPEN = 1; LiveES.CLOSED = 2;
  let DC = null;
  const tagOf = e => String(e || '').replace(/^W\//, '');   // Cloudflare 가 눌러 보낸 답의 ETag 는 약한 꼴(W/"…") — 프레임(DO)의 센 꼴과 같은 판으로 봄
  //   dd 가 고침 줄(ops — board-snap 이 바뀐 자리만 올린 판, Worker board.ts applyOps 와 같은 규칙)이면 그 판에 차례로 끼움. 못 끼우면 버리고 다시 읽음
  const BADK = new Set(['__proto__', 'constructor', 'prototype']);
  const applyOps = (o, ops) => {
    for (const op of ops) {
      const p = op && op[0];
      if (!Array.isArray(p) || op.length < 1 || op.length > 2) throw 0;
      if (!p.length) { if (op.length !== 2) throw 0; o = op[1]; continue; }
      let cur = o;
      for (const k of p) if ((typeof k !== 'string' && typeof k !== 'number') || BADK.has(String(k))) throw 0;
      for (const k of p.slice(0, -1)) { if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) throw 0; cur = cur[k]; }
      if (cur === null || typeof cur !== 'object') throw 0;
      const k = p[p.length - 1];
      if (Array.isArray(cur)) { if (op.length !== 2 || !Number.isInteger(k) || k < 0 || k >= cur.length) throw 0; cur[k] = op[1]; }
      else if (typeof k !== 'string') throw 0;
      else if (op.length === 1) delete cur[k];
      else cur[k] = op[1];
    }
    return o;
  };
  const push = (dd, age) => {
    for (const d of dd) {
      if (!DC || !d || tagOf(d.base) !== DC.etag || !(Array.isArray(d.keys) || Array.isArray(d.ops))) { DC = null; note('dd', 'miss'); return; }
      if (Array.isArray(d.ops)) {
        let o; try { o = applyOps(DC.obj, d.ops); } catch (e) { DC = null; note('dd', 'miss'); return; }   // DC.obj 를 고쳐 씀(반쯤 고친 판은 버림)
        if (!o || typeof o !== 'object' || Array.isArray(o)) { DC = null; note('dd', 'miss'); return; }
        DC = {etag: tagOf(d.etag), obj: o};
        continue;
      }
      const o = {}; for (const k of d.keys) o[k] = Object.prototype.hasOwnProperty.call(d.set || {}, k) ? d.set[k] : DC.obj[k];
      DC = {etag: tagOf(d.etag), obj: o};
    }
    note('dd', 'ok');
  };
  window.BX_DC = () => DC && {etag: DC.etag, json: JSON.stringify(DC.obj)};   // 시험 · 확인용(끼워 만든 판)
  const isData = u => { try { const x = new URL(typeof u === 'string' ? u : u?.url || '', location.href); return x.origin === location.origin && /\/api\/data$/.test(x.pathname) && !x.search; } catch (e) { return false; } };
  const f0 = window.fetch;
  window.fetch = function (u, o) {
    if (isData(u) && (!o || !o.method || o.method === 'GET')) {
      const L = cur;
      if (DC && L && L.wsUp && tagOf(L.srv.data) === DC.etag) {   // 밀어 준 판이 서버가 지금 알린 판
        const h0 = o?.headers || {}, inm = typeof h0.get === 'function' ? h0.get('If-None-Match') : h0['If-None-Match'] || h0['if-none-match'];
        const h = {etag: DC.etag, 'content-type': 'application/json; charset=utf-8', 'x-bx-push': '1', ...(L.snapAt ? {'x-snap-age': String(Math.max(0, now() - L.snapAt))} : {})};
        note('data', 'push');
        return Promise.resolve(tagOf(inm) === DC.etag ? new Response(null, {status: 304, headers: h}) : new Response(JSON.stringify(DC.obj), {status: 200, headers: h}));
      }
      const p = f0.apply(this, arguments);
      p.then(r => { if (r.status === 200 && r.headers.get('etag')) { const et = tagOf(r.headers.get('etag')); r.clone().json().then(j => { if (j && typeof j === 'object') DC = {etag: et, obj: j}; }).catch(() => {}); } }).catch(() => {});
      return p;
    }
    return f0.apply(this, arguments);
  };
  let tick = now(), wakeAt = 0, wakeWhy = '', hidAt = document.hidden ? now() : 0;
  // 깨면 「30초 넘게 못 받음」(보더 연결 안 됨)도 깬 때부터 셈 — 잠들기 전 마지막 확인으로 바로 띄우지 않게, 다시 이어 본 뒤에도 안 되면 그때
  const wake = why => { wakeAt = now(); wakeWhy = why; note('wake', why); const L = cur; if (L && !L.closed) { L.okAt = Math.max(L.okAt, now()); if (L.down) { L.down = false; stamp(); } if (!L.wsUp) { L.back = 500; L.connect(); } L.get().catch(() => {}); } };
  const woke = () => {
    const t = now(), gap = t - tick; tick = t;
    if (gap < 15000 || document.hidden) return;
    wake('clock ' + Math.round(gap / 1000));
    try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
  };
  setInterval(woke, 5000);
  document.addEventListener('visibilitychange', () => { tick = now(); if (document.hidden) hidAt = hidAt || now(); else if (hidAt) { hidAt = 0; wake('vis'); } });
  addEventListener('pageshow', e => { if (e.persisted) wake('pageshow'); });
  document.addEventListener('resume', () => wake('resume'));
  addEventListener('hb-wake', e => { tick = now(); if (now() - wakeAt > 1000) wake(String(e.detail || 'board')); });   // 보드가 먼저 알아본 깸(시계 · online 등) — 같은 깸을 두 번 안 셈
  // 실시간 데이터가 필요 없는 화면(설정 · 없는 주소)은 「보더 연결 안 됨」도 안 띄움(기록 · 다시 잇기는 뒤에서 그대로) — 보드 quietView 와 같은 규칙(옛 보드여도)
  const quiet = () => typeof quietView === 'function' ? quietView() : /^#(settings|nf)(\/|$|\?)/.test(window.HBR?.hash?.() ?? location.hash);
  // 「갱신 멈춤」 기록에 화면 연결 상태를 붙임 — 다시 나면 얼음 · 끊김 · 서버 멈춤 · 오프라인을 가를 수 있게
  const he = window.hbErr;
  const wk = () => { const b = typeof HB_WAKE === 'number' && HB_WAKE > wakeAt ? [HB_WAKE, HB_WHY] : [wakeAt, wakeWhy]; return b[0] ? `${Math.round((now() - b[0]) / 1000)}초 전(${b[1]})` : '없음'; };
  if (typeof he === 'function') window.hbErr = (w, x) => he(w, x && x.kind === 'stale' && cur ? {...x, err: `${x.err || ''} · ws ${cur.wsUp ? '붙음' : '끊김'} · 서버 나이 ${cur.snapAt ? Math.round((now() - cur.snapAt) / 1000) + '초' : '모름'} · 깸 ${wk()} · 온라인 ${navigator.onLine === false ? '아니오' : '예'}`} : x);
  const so = window.stampOnly;
  const stamp = () => { try { window.stampOnly?.(); } catch (e) {} };
  if (typeof so === 'function') window.stampOnly = function (){
    woke();   // 깨어난 뒤 첫 판정이 타이머보다 먼저 와도 얼기 전 시각으로 경보하지 않게
    so.apply(this, arguments);
    const s = document.getElementById('stamp'), L = cur;
    if (s && L && L.down && !L.closed && !document.hidden && !quiet()) {
      const off = navigator.onLine === false;   // 오프라인 = 이 기기가 쉬는 중 — 오류가 아니라 「다시 잇는 중」
      s.textContent = off ? '다시 잇는 중' : `보더 연결 안 됨 · ${kst(L.okAt).slice(11)} 부터`; s.classList.toggle('stale', !off); s.hidden = false;
    }
  };
  window.addEventListener('online', () => { wake('online'); const L = cur; if (L && !L.closed && !L.wsUp) { L.back = 500; L.connect(); L.poll(true); } });
  window.addEventListener('offline', stamp);
  window.EventSource = LiveES;
  window.BX_LIVE = () => cur && {ws: cur.wsUp, ready: cur.readyState, down: cur.down, srv: cur.srv, ev: EV.slice()};   // 시험 · 확인용
  evClose(); evOpen();   // 보드가 이미 연 옛 SSE(503)를 이 길로 바꿔 엶
})();
(() => {
  if (!window.HB_LIVE || !window.BX_Q) return;
  const f1 = window.fetch, Q = /(^|\/)api\/(chat|answer|todo|cardcheck|artnote|artfolder|artstar|artthumb)$/, LS = 'bx-outbox', MAXN = 240, MAXAGE = 6 * 3600e3;
  let items = [], wait = 2000, tk = null, flushing = false, idbBad = !window.indexedDB;
  const held = new Map();
  // ── 저장(IndexedDB, 안 되면 localStorage 통째로) — 다 try/catch: 저장이 안 돼도 보내기는 그대로
  let dbp = null;
  const db = () => dbp ||= new Promise((ok, no) => { const r = indexedDB.open('bx-outbox', 1); r.onupgradeneeded = () => r.result.createObjectStore('q', {keyPath: 'rid'}); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const tx = (mode, f) => db().then(d => new Promise((ok, no) => { const t = d.transaction('q', mode), q = f(t.objectStore('q')); t.oncomplete = () => ok(q?.result); t.onerror = t.onabort = () => no(t.error); }));
  const lsAll = () => { try { localStorage.setItem(LS, JSON.stringify(items)); } catch (e) {} };
  const save = it => { if (idbBad) return lsAll(); tx('readwrite', s => s.put({...it})).catch(() => { idbBad = true; lsAll(); }); };
  const drop = it => { items = items.filter(x => x !== it); if (idbBad) return lsAll(); tx('readwrite', s => s.delete(it.rid)).catch(() => { idbBad = true; lsAll(); }); };
  const loadAll = async () => { try { if (!idbBad) return (await tx('readonly', s => s.getAll())) || []; } catch (e) { idbBad = true; } try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } };
  // ── 머리 알약
  const pill = document.createElement('div'); pill.className = 'bx-outbox'; pill.hidden = true; pill.setAttribute('role', 'status');
  const st = document.createElement('style'); st.textContent = '.bx-outbox{position:fixed;top:calc(env(safe-area-inset-top,0px) + 30px);left:50%;transform:translateX(-50%);z-index:60;font:600 12px/1 system-ui,sans-serif;padding:7px 12px;border-radius:999px;background:var(--panel,#fff);color:var(--ink,#111113);border:1px solid var(--line,rgba(0,0,0,.12));box-shadow:0 2px 10px rgba(0,0,0,.08);pointer-events:none}.bx-outbox[hidden]{display:none}@media (max-width:860px){.bx-outbox{top:calc(env(safe-area-inset-top,0px) + 68px)}}';
  document.head.appendChild(st); document.body.appendChild(pill);
  // wait = 같은 대상 앞 글이 보내는 중이라 줄만 섬(못 간 것 아님) — 앞 글이 못 갔을 때만 「보낼 글」로 셈
  const draw = () => { const n = items.filter(x => x.st === 'queued' || x.st === 'check' || (x.st === 'wait' && before(x).some(y => y.st === 'queued' || y.st === 'check'))).length, m = items.filter(x => x.st === 'check').length;
    pill.textContent = `보낼 글 ${n}` + (m ? ` · 확인 필요 ${m}` : ''); pill.hidden = !n; };
  const keyOf = (u, b) => { const p = String(u).split('?')[0].replace(/^.*api\//, '');
    return p + '|' + (p === 'chat' ? `${b.channel || ''}:${b.thread || b.ts || ''}` : p === 'answer' ? String(b.item || b.ts || b.pane || '') : p === 'todo' ? `${b.area || ''}:${b.id || ''}` : p === 'cardcheck' ? String(b.ts || '') : String(b.art || '')); };
  const before = it => items.slice(0, items.indexOf(it)).filter(x => x.key === it.key);
  const blocked = it => before(it).length > 0;
  const kick = now => { clearTimeout(tk); tk = setTimeout(flush, now ? 0 : wait); };
  const hdrs = h => { const o = {}; try { new Headers(h || {}).forEach((v, k) => { o[k] = v; }); } catch (e) {} return o; };
  const finish = (it, r) => { drop(it); const h = held.get(it.rid); held.delete(it.rid); h?.ok(r); draw(); if (items.some(x => x.st !== 'send')) kick(true); return true; };   // 뒤에 줄 선 글을 바로
  const giveUp = it => finish(it, new Response(JSON.stringify({ok: false, error: '일시적인 오류가 발생했어요'}), {status: 503, headers: {'content-type': 'application/json'}}));   // 너무 오래 · 너무 많이 · 서버가 모름 — 오류로 끝(보드의 「다시 보내기」)
  const tooOld = it => (it.n || 0) >= MAXN || Date.now() - it.at > MAXAGE;
  async function send(it){
    it.st = 'send'; it.n = (it.n || 0) + 1;
    let r = null;
    try { r = await f1(it.url, {method: 'POST', headers: it.headers, body: it.body}); } catch (e) {}
    const xr = r?.headers.get('x-rid'), safe = r?.status === 503 && r.headers.get('x-retry-safe') === '1';
    // 쌓아 둠: 쓰기 전 503(x-retry-safe) =「보낼 글」 · 망 오류 · 하는 중(x-rid busy) · 표 없는 5xx(Worker 밖 입구 장애) =「확인 필요」
    const st = safe ? 'queued' : !r || xr === 'busy' || (r.status >= 500 && !xr) ? 'check' : '';
    if (!st) return finish(it, r);
    if (tooOld(it)) { giveUp(it); return true; }
    it.st = st; save(it); draw(); return false;
  }
  async function flush(){
    if (flushing) return; flushing = true;
    let fail = false; const stop = new Set();
    try {
      for (const it of items.slice()) {
        if (!items.includes(it)) continue;
        if (it.st === 'send') { stop.add(it.key); continue; }
        if (Date.now() - it.at > MAXAGE) { giveUp(it); continue; }
        if (stop.has(it.key)) continue;   // 같은 대상 앞 글이 못 감 — 그 뒤만 기다림(다른 대상은 계속)
        if (it.st === 'check') {   // 닿았는지 모름 — 먼저 서버에 물음(그 사이 다른 기기 · 탭이 보냈을 수도)
          let s;
          try { const r = await f1('api/rid/' + encodeURIComponent(it.rid), {cache: 'no-store'}); s = r.ok ? (await r.json()).state : r.status === 404 ? 'unknown' : null; } catch (e) { s = null; }
          if (s === 'unknown') { giveUp(it); continue; }   // 서버가 rid 를 안 봄(스위치 끈 직후 열린 탭) — 다시 보내면 두 번일 수 있어 오류로 끝
          if (s === null) { if (tooOld(it)) { giveUp(it); continue; } fail = true; break; }   // 확인조차 못 함 = 서버에 못 닿음 — 이번 판은 멈춤
          if (s === 'busy') { stop.add(it.key); fail = true; continue; }
          if (s === 'done' && !held.has(it.rid)) { drop(it); draw(); continue; }   // 이미 들어감 — 기다리는 쪽이 없으면 지우기만(있으면 아래 다시 보내기가 남긴 답을 돌려받음)
        }
        if (!(await send(it))) { stop.add(it.key); fail = true; }
      }
    } finally { flushing = false; }
    if (fail) { wait = Math.min(wait * 2, 15000); kick(); }
    else { wait = 2000; if (items.some(x => x.st !== 'send')) kick(); }
  }
  window.fetch = function (input, init){
    const u = typeof input === 'string' ? input : '';
    if (!u || String(init?.method || '').toUpperCase() !== 'POST' || !Q.test(u.split('?')[0]) || typeof init?.body !== 'string') return f1.apply(this, arguments);
    let b; try { b = JSON.parse(init.body); } catch (e) { return f1.apply(this, arguments); }
    if (!b || typeof b !== 'object' || Array.isArray(b) || b.seen) return f1.apply(this, arguments);   // 읽음 표시는 안 쌓음
    if (!b.rid) b.rid = 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    const it = {rid: String(b.rid), url: u, body: JSON.stringify(b), headers: hdrs(init.headers), at: Date.now(), st: 'send', n: 0, key: keyOf(u, b)};
    return new Promise((ok, no) => {
      held.set(it.rid, {ok, no});
      init.signal?.addEventListener('abort', () => { if (held.delete(it.rid)) no(new DOMException('aborted', 'AbortError')); });   // 부른 쪽이 그만 기다려도 글은 남아 보냄
      items.push(it); save(it);
      if (blocked(it)) { it.st = before(it).some(x => x.st === 'queued' || x.st === 'check') ? 'queued' : 'wait'; save(it); draw(); kick(true); }   // 같은 대상 앞 글 뒤에(다른 대상은 바로)
      else send(it).then(ok_ => { if (!ok_) kick(); });
    });
  };
  window.addEventListener('online', () => { if (items.length) { wait = 2000; kick(true); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && items.length) kick(true); });
  window.BX_OUTBOX = () => items.map(x => ({rid: x.rid, url: x.url, st: x.st, n: x.n}));
  loadAll().then(xs => { for (const x of xs || []) { if (!x || !x.rid || items.some(y => y.rid === x.rid)) continue;
      if (!(Date.now() - x.at <= MAXAGE)) { drop(x); continue; }
      let key = x.key; if (!key) try { key = keyOf(x.url, JSON.parse(x.body)); } catch (e) { key = x.url; }
      items.push({...x, key, st: x.st === 'queued' || x.st === 'wait' ? 'queued' : 'check'}); }   // wait 은 보낸 적 없음
    items.sort((a, b) => a.at - b.at); draw(); if (items.length) kick(true); });
})();
(() => {
  let q = 0, on = '';
  const paint = () => {
    q = 0;
    if (!(typeof D === 'object' && (Array.isArray(D?.task_side) || D?.agents_fold)) || typeof CS !== 'object') return;
    const ts = (CS.ch?.[CS.at]?.messages || []).find(m => m.fold?.agents)?.ts || '';
    if (ts === on) return;
    on = ts;
    let st = document.getElementById('bx-agf-css');
    if (!ts) { if (st) st.textContent = ''; return; }
    if (!st) { st = document.createElement('style'); st.id = 'bx-agf-css'; document.head.append(st); }
    const m = `html.bx .msg[data-mts=${JSON.stringify(String(ts))}]:not([data-min="1"])`, lab = String(window.HB_MEMBER?.name || '나').slice(0, 40) + '님 ↔ 에이전트';
    st.textContent = `${m}{background:var(--sunk);border-radius:12px;margin:2px 8px 42px;box-sizing:border-box;max-width:calc(100% - 16px)}`
      + `${m}::after{content:${JSON.stringify(lab)};position:absolute;left:8px;right:8px;top:calc(100% + 12px);padding-top:10px;border-top:1px solid var(--line);font-size:12px;font-weight:600;color:var(--muted);letter-spacing:.01em}`;
  };
  new MutationObserver(() => { if (!q) q = requestAnimationFrame(paint); }).observe(document.body, {childList: true, subtree: true});
})();
