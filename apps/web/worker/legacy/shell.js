window.bxPushOff = async () => { if (!window.HB_MEMBER || !('serviceWorker' in navigator)) return;
  try { const reg = await navigator.serviceWorker.getRegistration(), sub = await reg?.pushManager.getSubscription(); if (!sub) return;
    await fetch('api/push/unsubscribe', {method: 'POST', headers: {'content-type': 'application/json', 'x-hb': '1'}, body: JSON.stringify({endpoint: sub.endpoint})}).catch(() => {}); await sub.unsubscribe(); } catch (e) {} };
(() => {
  if (!window.HB_LIVE || !window.show) return;
  const MOBILE_ON = true;
  const R = document.documentElement, PC = matchMedia('(min-width: 861px)');
  const on = () => PC.matches || MOBILE_ON;
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
    canvas: lu('layout-grid'),
    unread: lu('message-square-dot'),
    saved: lu('bookmark'),
    copy: lu('copy'),
    invite: lu('user-plus'),
    feedback: lu('message-square-text'),
    out: lu('log-out'),
    flag: lu('flag'),
    drafts: lu('pencil'),
    menu: lu('menu', 20),
    search: lu('search'),
    panel: lu('panel-left'),
    fold: lu('chevron-down', 13),
  };
  const IBK = ['unread', 'saved', 'drafts'], IBN = {unread: '읽지 않음', saved: '저장', drafts: '초안'};
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
    if (c && c.key === st.key){ c.el.title = c.el.ariaLabel = `${AREA_NAME.primary} 와 대화${st.n ? ` · ${typeof TURN === 'string' ? TURN : '내 차례'} ${st.n}` : ''}${st.m === 'busy' ? ' · 일하는 중' : ''}`; return c.el; }
    const el = mk('button', 'lg lgb mood-' + st.key); el.type = 'button'; el.dataset.go = 'chan:primary';
    const ex = window.HB_EXPR || {};
    el.innerHTML = window.HB_BLOB_ANIM ? window.HB_BLOB_ANIM('primary', {size: 34, background: false, animate: 'always', ...(st.key === 'sad' ? {expression: ex.sad} : st.key === 'think' ? {expression: ex.thinking} : {})})
      : window.HB_BLOB ? window.HB_BLOB('primary', {size: 34, background: false}) : '<img src="icons/icon-192.png" alt="" width="32" height="32">';
    el.title = el.ariaLabel = `${AREA_NAME.primary} 와 대화${st.n ? ` · ${typeof TURN === 'string' ? TURN : '내 차례'} ${st.n}` : ''}${st.m === 'busy' ? ' · 일하는 중' : ''}`;
    LG[which] = {key: st.key, el}; return el;
  }
  const placeLogo = () => { for (const [w, box] of [['sb', sb], ['dr', dr]]){ const slot = box.querySelector('.lgslot'); if (slot) slot.replaceWith(logoEl(w)); } };
  setInterval(() => { if (on()) { const k = logoState().key; if (LG.sb && LG.sb.key !== k) lists(); } }, 8000);
  const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const $id = id => document.getElementById(id);

  const sb = mk('nav', 'bx-sb'); sb.setAttribute('aria-label', '메뉴');
  const scrim = mk('div', 'bx-scrim');
  const dr = mk('nav', 'bx-dr'); dr.setAttribute('aria-label', '메뉴'); dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true');
  const menu = mk('button', 'bx-menu bx-glass', I.menu); menu.type = 'button'; menu.setAttribute('aria-label', '메뉴');
  const cmb = mk('button', 'bx-chatmenu', I.menu); cmb.type = 'button'; cmb.setAttribute('aria-label', '메뉴');
  cmb.addEventListener('click', () => openDr());
  const seg = mk('div', 'bx-seg', '<button type="button" data-bxv="tree">트리</button><button type="button" data-bxv="timeline">타임라인</button>');
  seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', '노드 보기');
  const cap = mk('div', 'bx-cap bx-glass');
  const ibox = mk('section', 'bx-inbox'); ibox.hidden = true;
  const hr = document.querySelector('header .hr'), hrt = hr.querySelector('.hrt');
  hr.prepend(menu, seg);
  document.querySelector('.wrap header').after(ibox);
  document.body.append(sb, scrim, dr, cmb);
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
  const recent = () => Object.entries(ARTS || {}).map(([id, x]) => ({id, ...x})).sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 5);
  const sec = (k, name, body) => `<button type="button" class="bx-sec bx-fh" data-fold="${k}" aria-expanded="${!SB.fold[k]}">${name}${I.fold}</button><div class="bx-sbody" data-sec="${k}"${SB.fold[k] ? ' hidden' : ''}>${body}</div>`;
  function lists(){
    const st = window.HBInbox?.state || {}, c = window.HBInbox?.counts?.() || {};
    const by = k => (st.unread || []).some(x => x.chan === k);
    const act = active(), top = S.ib || ibChat() ? null : act, chan = chatMode() && !cur.page && cur.chan;
    const tn = typeof attnCount === 'function' ? attnCount() : 0;
    const ib = it('turn', I.flag, '결정 · 할 일', cnt(tn, true), ibChat() === 'turn') + IBK.map(k => it(k, I[k], IBN[k], cnt(c[k], k === 'unread'), S.ib === k || ibChat() === k)).join('');
    const ch = CH.map(k => it('chan:' + k, blob(AREA_NAME[k], 20), esc(AREA_NAME[k]), by(k) ? '<i class="ud" aria-label="읽지 않음"></i>' : '', chan === k)).join('');
    const nd = myNodes().map(p => it('node:' + p.pane, I.hash, esc(nameOf(p)), nodeRows(p.pane).length ? '<i class="ud" aria-label="내 차례"></i>' : '', !ans.hidden && !!cur?.page && cur.p === p.pane)).join('');
    const rc = recent().map(r => `<button type="button" class="bx-it" data-art="${esc(r.id)}" title="${esc(r.title || r.id)}"><i class="ki k-${esc(r.kind || 'doc')}"></i><span>${esc(r.title || r.id)}</span></button>`).join('');
    const head = it('node', I.node, '노드', '', top === 'node') + it('canvas', I.canvas, '캔버스', '', top === 'canvas');
    const body = '<div class="bx-sbsc">' + head + sec('ib', '모아 보기', ib) + (nd ? sec('nd', '채널', nd) : '') + sec('ch', '에이전트', ch) + (rc ? sec('rc', '최근 캔버스', rc) : '') + '</div>';
    const foot = `<div class="bx-foot"><button type="button" class="bx-me" data-me aria-haspopup="true" aria-expanded="false">${meAv()}<span>${esc(window.HB_MEMBER?.name || ME()?.name || 'Owner')}</span></button></div>`;
    const fb = `<button type="button" class="bx-colb" data-go="find" aria-label="찾기" title="찾기 ⌘K">${I.search}</button>`;
    const keep = [sb, dr].map(x => x.querySelector('.bx-sbsc')?.scrollTop || 0);
    sb.innerHTML = `<div class="top">${logo}<span class="tr">${fb}<button type="button" class="bx-colb" data-sbcol aria-label="${SB.col ? '사이드바 펴기' : '사이드바 접기'}" title="${SB.col ? '펴기' : '접기'}">${I.panel}</button></span></div>` + body + foot;
    dr.innerHTML = `<div class="top">${logo}<span class="tr">${fb}</span></div>` + body + foot;
    [sb, dr].forEach((x, i) => { const sc = x.querySelector('.bx-sbsc'); if (sc && keep[i]) sc.scrollTop = keep[i]; });
    (PC.matches ? sb : dr).querySelector('.bx-foot').append(tools);
    placeLogo();
    lists.sig = rcSig();
  }
  const ME = () => { const m = window.BX_ME; return m && (m.seed || /^[0-9a-f]{32}$/.test(m.photo || '')) ? m : null; };
  const meAv = () => ME() && window.BXBot?.live ? `<b class="${ME().photo ? 'pic' : 'blob'}">${window.BXBot.live(ME(), 30)}</b>` : '<b>B</b>';
  try { window.BX_ME = JSON.parse(localStorage.getItem('bx-me') || 'null'); } catch {}
  const meRedraw = () => { lists(); try { if (typeof cur !== 'undefined' && cur && !ans.hidden) render(); } catch {} };
  window.addEventListener('bx-me', meRedraw);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if (ME()) meRedraw(); });
  if (window.HB_MEMBER) window.BX_ME = null;
  else fetch('api/me/bot', {credentials: 'include'}).then(r => r.ok ? r.json() : null).then(j => {
    if (!j) return; const b = j.bot, m = b ? {seed: b.seed, hue: b.hue, name: b.name, photo: b.photo, icon: b.icon} : null;
    if (JSON.stringify(m) === JSON.stringify(window.BX_ME)) return;
    window.BX_ME = m; try { m ? localStorage.setItem('bx-me', JSON.stringify(m)) : localStorage.removeItem('bx-me'); } catch {}
    meRedraw();
  }).catch(() => {});
  const rankOf = v => typeof priRank === 'function' ? priRank(v) : 2.5;
  const myNodes = () => (typeof panes !== 'undefined' ? panes : []).filter(p => !['primary', 'arealead', 'helper'].includes(p.kind))
    .map((p, i) => [p, i]).sort((a, b) => rankOf(a[0].pri) - rankOf(b[0].pri) || a[1] - b[1]).map(x => x[0]);
  const rcSig = () => recent().map(r => r.id + (r.title || '')).join('|') + '#' + (typeof attnCount === 'function' ? attnCount() : 0)
    + '#' + myNodes().map(p => p.pane + nameOf(p) + nodeRows(p.pane).length).join('|') + (cur?.page ? '@' + cur.p : '');   // 내 노드 이름 · 점 · 지금 연 노드
  setInterval(() => { if (on() && lists.sig !== rcSig()) lists(); }, 3000);
  function setCol(v){ SB.col = v; saveSB(); R.classList.toggle('bx-col', !!v); lists(); }
  R.classList.toggle('bx-col', !!SB.col);
  const chatMode = () => !!S.chat && !ans.hidden && !!cur && !!cur.chan;
  const FEED = k => (k === 'unread' || k === 'saved' || k === 'drafts' || k === 'turn') && !!window.HBInbox?.openFeed;
  const ibChat = () => chatMode() && /^i:(unread|saved|drafts|turn)$/.test(cur.chan) ? cur.chan.slice(2) : '';
  const active = () => S.ib || chatMode() ? 'chat' : current === 'arts' ? 'canvas' : 'node';
  function sync(){
    if (!on()) return;
    const act = active();
    R.classList.toggle('bx-chat', chatMode());
    if (!PC.matches && chatMode()){ const ah = ans.querySelector(':scope > .ah'), r = ah?.getBoundingClientRect(); if (r && r.height){ R.style.setProperty('--bx-cmt', Math.round(r.top - ans.getBoundingClientRect().top + (r.height - 40) / 2) + 'px'); R.style.setProperty('--bx-cmz', String((parseInt(getComputedStyle(ans).zIndex) || 20) + 1)); } }   // 폰 채팅 머리 왼쪽 메뉴 단추 자리
    R.classList.toggle('bx-ib', !!S.ib);
    seg.hidden = act !== 'node';
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.bxv === current);
    lists(); arts();
  }

  function ibOpen(k, fromPop){
    if (!IBK.includes(k) || !window.HBInbox || !on()) return;
    S.ret = null; if (!ans.hidden) closeAns();
    if (S.ib !== k){ ibM?.destroy(); ibM = window.HBInbox.mount(ibox, k, {}); }
    S.ib = k; ibox.hidden = false; scrollTo(0, 0); document.querySelector('.wrap')?.scrollTo(0, 0);
    if (!fromPop && !EMBED && location.hash.slice(1) !== k) history.pushState(null, '', '#' + k);
    sync();
  }
  function ibClose(){ if (!S.ib) return; ibM?.destroy(); ibM = null; S.ib = null; ibox.hidden = true; }

  const show0 = window.show, chan0 = window.openChan;
  window.show = function(v){ S.ret = null; ibClose(); const r = show0.apply(this, arguments); sync(); return r; };
  window.openChan = function(k){
    const from = S.ib;
    const r = chan0.apply(this, arguments);
    if (!ans.hidden && cur && cur.tab === 'chat'){ ibClose(); S.chat = cur.chan || (CH.includes(k) ? k : 'primary'); S.last = S.chat; S.ret = from; }
    sync(); return r;
  };
  let wasOpen = false;
  new MutationObserver(() => {
    const open = !ans.hidden;
    if (open && !S.chat && cur?.tab === 'chat' && cur.chan){ S.chat = cur.chan; if (!/^i:/.test(cur.chan)) S.last = cur.chan; }
    if (!open && wasOpen && S.chat){ S.chat = null; const back = S.ret; S.ret = null; if (back && !(applying && location.hash.startsWith('#chat/'))) return ibOpen(back, true); }
    if (!open) S.chat = null;
    wasOpen = open; sync();
  }).observe(ans, {attributes: true, attributeFilter: ['hidden', 'class']});
  window.HBInbox?.on(() => on() && lists());

  // ── 누르기
  function go(g){
    closeDr(); S.ret = null;
    if (g === 'find') return findOpen();
    if (g.startsWith('chan:')) return openChan(g.slice(5));
    if (g.startsWith('node:')){ ibClose(); return openAns({p: g.slice(5), page: true}); }   // 내 노드 → 본 칸 노드 화면
    if (FEED(g)){ ibClose(); return window.HBInbox.openFeed(g); }
    if (IBK.includes(g)) return ibOpen(g);
    if (!ans.hidden) closeAns();
    if (g === 'chat') return openChan(S.last);
    if (g === 'canvas') return show('arts');
    if (g === 'node'){ if (!ans.hidden && cur?.chan?.startsWith('n:')) closeAns();   // 노드 채팅에서 「노드」 = 트리로
      if (current === 'arts') return show('tree'); ibClose(); if (!EMBED && location.hash.slice(1) !== current) history.pushState(null, '', '#' + current); return sync(); }
  }
  for (const n of [sb, dr]) n.addEventListener('click', e => {
    const f = e.target.closest('[data-fold]');
    if (f){ const k = f.dataset.fold; SB.fold[k] = !SB.fold[k]; saveSB();
      for (const x of [sb, dr]){ const h = x.querySelector(`[data-fold="${k}"]`), s = x.querySelector(`[data-sec="${k}"]`); h?.setAttribute('aria-expanded', !SB.fold[k]); if (s) s.hidden = !!SB.fold[k]; }
      return; }
    if (e.target.closest('[data-sbcol]')) return setCol(!SB.col);
    const me = e.target.closest('[data-me]'); if (me) return meOpen(me);
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
    db.type = 'button'; db.title = 'Primary 채팅 — 오른쪽 판'; db.setAttribute('aria-label', 'Primary 채팅 판'); db.setAttribute('aria-pressed', 'false');
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
    setInterval(() => { if (still.matches || R.classList.contains('bx-still')) return; fav.href = B; setTimeout(() => { fav.href = A; }, 180); }, 5000);
  }

  const mi = (k, icon, label) => `<button type="button" class="bx-it" data-mi="${k}" role="menuitem">${icon}<span>${label}</span></button>`;
  const mp = mk('div', 'bx-mpop', (window.HB_MEMBER ? '' : mi('invite', I.invite, '초대')) + mi('feedback', I.feedback, '피드백') + mi('out', I.out, '로그아웃'));
  mp.hidden = true; mp.setAttribute('role', 'menu'); document.body.append(mp);
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
    if (k === 'feedback'){ meClose(); closeDr(); window.BXSettings?.enter('feedback'); }
    if (k === 'out'){ await window.bxPushOff(); await mpost('api/auth/sign-out'); location.reload(); }
  });
  document.addEventListener('click', e => { if (!mp.hidden && !e.target.closest('.bx-mpop, [data-me]')) meClose(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !mp.hidden){ e.stopImmediatePropagation(); meClose(); } }, true);

  const fd = mk('div', 'bx-find', `<div class="bx-fbox" role="dialog" aria-modal="true" aria-label="찾기"><div class="bx-fq">${I.search}<input type="search" placeholder="찾기 — 노드 · 결정 · 대화 · 캔버스" aria-label="찾기" autocomplete="off" enterkeyhint="go"></div><div class="bx-fl" role="listbox"></div></div>`);
  fd.hidden = true; document.body.append(fd);
  const fin = fd.querySelector('input'), fl = fd.querySelector('.bx-fl');
  let fsel = 0, fres = [];
  const FS = {r: null, t: 0, n: 0};
  const agoS = at => { const s = Math.max(0, Date.now() / 1000 - (+at || 0)); return !at ? '' : s < 90 ? '방금' : s < 3600 ? Math.round(s / 60) + '분 전' : s < 86400 ? Math.round(s / 3600) + '시간 전' : Math.round(s / 86400) + '일 전'; };
  const winT = x => String(x?.win || '').replace(/^\d+\s*/, '');
  function nodeGo(t){
    const p = Object.values(byPane).find(x => winT(x) === t); if (p) return openAns({p: p.pane, page: true});
    const k = Object.keys(parkBy).find(id => winT(parkBy[id]) === t); if (k) return openAns({p: k, page: true});
    if (typeof openNode === 'function') return openNode(t);
    location.hash = '#settings/nodes';
  }
  function cardGo(c){
    if (typeof window.HBOpenCard === 'function' && /^\d{10}\.\d{6}$|^[qw]:/.test(c.ts || '')) return window.HBOpenCard(c.ts, c.thread ? {c: CH.includes(c.ch) ? c.ch : 'primary', t: c.thread} : null);
    if (c.thread) return openChan(CH.includes(c.ch) ? c.ch : 'primary', c.thread);
    if (c.node) return nodeGo(c.node);
    toast('그 카드는 이미 처리됐어요');
  }
  const KIND = {decision: '결정', todo: '할 일', queue: '질문', choice: '결정'};
  function serverItems(r){
    const out = [];
    for (const n of r.nodes || []) out.push({g: '노드', n: n.title, i: I.hash, tag: n.turn, hot: /^내 차례/.test(n.turn || ''),
      sub: [n.line || (n.hit && n.hit.text), agoS(n.line_at || (n.hit && n.hit.at))].filter(Boolean).join(' · '), go: () => nodeGo(n.title)});
    for (const c of r.cards || []) out.push({g: '결정 · 할 일', n: c.title, i: I.flag, tag: c.state === 'open' ? (KIND[c.ckind] || '열림') : '닫힘', hot: c.state === 'open',
      sub: [c.text, c.node, agoS(c.at)].filter(Boolean).join(' · '), go: () => cardGo(c)});
    for (const m of r.chats || []) out.push({g: '대화', n: m.text, i: m.kind === 'log' ? I.node : blob(m.title === 'Owner' ? 'Owner' : (AREA_NAME[m.ch] || m.ch || ''), 18),
      sub: [m.kind === 'log' ? m.title + ' 장부' : (m.title + ' · ' + (AREA_NAME[m.ch] || m.ch || '')), m.kind !== 'log' && m.node, agoS(m.at)].filter(Boolean).join(' · '),
      go: () => m.kind === 'log' ? nodeGo(m.title) : openChan(CH.includes(m.ch) ? m.ch : 'primary', m.thread)});
    for (const a of r.arts || []) { const id = a.id.slice(2); out.push({g: '캔버스', n: a.title, i: `<i class="ki k-${esc(a.akind || 'doc')}"></i>`, sub: [a.folder, agoS(a.at)].filter(Boolean).join(' · '), go: () => ARTS[id] ? openArt(id) : toast('그 캔버스를 찾지 못했어요')}); }
    return out;
  }
  function findItems(q){
    q = q.trim().toLowerCase();
    const hit = s => !q || String(s || '').toLowerCase().includes(q);
    const out = [];
    for (const k of CH) if (hit(AREA_NAME[k]) || hit(k)) out.push({g: '에이전트', n: AREA_NAME[k], i: blob(AREA_NAME[k], 18), go: () => openChan(k)});
    for (const k of IBK) if (q && hit(IBN[k])) out.push({g: '모아 보기', n: IBN[k], i: I[k], go: () => FEED(k) ? (ibClose(), window.HBInbox.openFeed(k)) : ibOpen(k)});
    const sr = q && FS.r && q.startsWith(FS.r.q.toLowerCase()) ? FS.r : null;   // 서버 답(앞 글자가 같으면 새 답이 올 때까지 그대로 — 깜빡임 없게)
    if (sr && !window.HB_MEMBER) return out.concat(serverItems(sr)).slice(0, 60);
    const live = t => (t.panes || []).find(p => byPane[p]);
    if (q) for (const t of (CS.T.topics || [])) { const p = t.state !== 'done' && live(t); if (p && (hit(t.title) || hit(t.id))) out.push({g: '노드', n: t.title || t.id, i: I.hash, go: () => openAns({p})}); }
    if (q) for (const n of (typeof D !== 'undefined' && D.archived || []).filter(hit).slice(0, 8)) out.push({g: '노드', n: n + ' · 보관', i: I.hash, go: () => nodeGo(n)});
    const arts = Object.entries(ARTS || {}).map(([id, x]) => ({id, ...x})).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    for (const r of (q ? arts.filter(r => hit(r.title) || hit(r.id)) : arts.slice(0, 5))) out.push({g: q ? '캔버스' : '최근 캔버스', n: r.title || r.id, i: `<i class="ki k-${esc(r.kind || 'doc')}"></i>`, go: () => ARTS[r.id] && openArt(r.id)});
    if (sr){
      const sv = serverItems(sr), names = new Set(sv.filter(r => r.g === '노드').map(r => r.n)), G = ['에이전트', '모아 보기', '노드', '결정 · 할 일', '대화', '캔버스', '최근 캔버스'];
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
    fl.innerHTML = fres.length ? fres.map((r, i) => (r.g !== g ? `<div class="bx-fg">${g = r.g}</div>` : '') + (r.sub || r.tag
      ? `<button type="button" class="bx-fr bx-fr2" role="option" data-fi="${i}" aria-selected="${i === fsel}">${r.i}<span class="bx-ft"><b>${hl(r.n, q)}</b>${r.sub ? `<small>${hl(r.sub, q)}</small>` : ''}</span>${r.tag ? `<em class="${r.hot ? 'hot' : ''}">${esc(r.tag)}</em>` : ''}</button>`
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
    if (q){ fsearch(q, false); if (!window.HB_MEMBER) FS.t = setTimeout(() => fsearch(q, true), 300); }   // 회원 찾기(자기 D1)는 뜻 찾기가 없어 한 번만
  }
  function findOpen(){ closeDr(); fin.value = ''; fsel = 0; FS.r = null; fd.hidden = false; findDraw(); fin.focus(); }
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
  seg.addEventListener('click', e => { const b = e.target.closest('[data-bxv]'); if (b && b.dataset.bxv !== current) show(b.dataset.bxv); });
  function openDr(){ R.classList.add('bx-dron'); lists(); dr.querySelector('[aria-current]')?.focus?.({preventScroll: true}); }
  function closeDr(){ R.classList.remove('bx-dron'); }
  menu.addEventListener('click', openDr);
  scrim.addEventListener('click', closeDr);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && R.classList.contains('bx-dron')){ e.stopPropagation(); closeDr(); menu.focus(); } }, true);
  const ROUTE = /^#(chat\/|art\/|node\/|w\/|inbox$)/;
  const MVv = () => MV.el && document.body.contains(MV.el) && MV.el === S.artEl ? S.art : null;
  function want(){
    const a = MVv(); if (a) return '#art/' + a;
    if (!ans.hidden && cur){
      if (cur.tab === 'chat' && cur.chan && cur.chan.startsWith('n:')) return '#node/' + encodeURIComponent(cur.p);
      if (cur.tab === 'chat' && cur.chan === 'i:turn') return '#inbox';
      if (cur.tab === 'chat' && /^i:(unread|saved|drafts)$/.test(cur.chan || '')) return '#' + cur.chan.slice(2);
      if (cur.tab === 'chat' && cur.chan) return '#chat/' + cur.chan + (CS.th?.ts && CS.th.k === cur.chan ? '/' + CS.th.ts : '');
      if (cur.w) return '#w/' + encodeURIComponent(cur.w);
      if (cur.p) return '#node/' + encodeURIComponent(cur.p);
    }
    return '#' + (S.ib || current);
  }
  let applying = 0, recQ = 0, backing = 0, G = 0;
  function record(){
    recQ = 0;
    if (applying || backing || !on() || /^#settings(\/|$|\?)/.test(location.hash)) return;   // 설정 화면(settings.js)이 주소를 맡음
    if (EMBED) return;
    const h = want(); if (h === location.hash) return;
    if (/^#t=/.test(location.hash) || !location.hash) return history.replaceState(history.state, '', h);   // 보드 글 링크(#t=…)로 연 것은 그 자리를 바꿈
    if (history.state?.bx && history.state.from === h){ backing = setTimeout(() => { backing = 0; recLater(); }, 1500); return history.back(); }
    history.pushState({bx: 1, from: location.hash}, '', h);
  }
  const recLater = () => { if (!recQ) recQ = requestAnimationFrame(record); };
  new MutationObserver(recLater).observe(ans, {attributes: true, childList: true, subtree: true});
  new MutationObserver(recLater).observe(document.body, {childList: true});
  const art0 = window.openArt;
  window.openArt = function(id){ const r = art0.apply(this, arguments); S.art = id; S.artEl = MV.el; recLater(); return r; };
  const th0 = window.openThread;
  if (th0) window.openThread = function(){ const r = th0.apply(this, arguments); Promise.resolve(r).finally(recLater); recLater(); return r; };
  const until = (ok, ms = 10000) => new Promise(res => { const t0 = Date.now(), f = () => ok() || Date.now() - t0 > ms ? res(ok()) : setTimeout(f, 150); f(); });
  async function apply(){
    if (!on() || /^#settings(\/|$|\?)/.test(location.hash)) return;
    if (backing){ clearTimeout(backing); backing = 0; }
    if (location.hash === '#chat') history.replaceState(history.state, '', '#chat/primary');
    const h = location.hash, [k, a, b] = h.slice(1).split('/').map(x => decodeURIComponent(x || ''));
    const gen = ++G;
    applying++;
    try {
      if (k !== 'art' && MVv()) mvClose();
      if (k === 'art'){ if (MVv() !== a && await until(() => ARTS[a]) && gen === G && !/^#settings(\/|$|\?)/.test(location.hash)){ if (!ans.hidden) closeAns(); openArt(a); } }
      else if (k === 'chat' && CH.includes(a)){
        if (!(chatMode() && cur.chan === a)){ ibClose(); openChan(a, b || undefined); }
        else if ((CS.th?.ts || '') !== (b || '')){ if (b) await th0(a, b); else { CS.th = null; viewChat(true); } }
      }
      else if (k === 'inbox'){ if (cur?.chan !== 'i:turn'){ ibClose(); window.HBInbox?.openFeed('turn'); } }
      else if (k === 'node'){ if (await until(() => byPane[a], 5000) && gen === G && !/^#settings(\/|$|\?)/.test(location.hash) && !(cur?.page && cur.p === a)){ ibClose(); openAns({p: a, page: true}); } }
      else if (k === 'w'){ if (cur?.w !== a){ ibClose(); openAns({w: a}); } }
      else if (FEED(k)){ S.ret = null; if (ibChat() !== k && await until(() => typeof panes !== 'undefined' && panes.length, 5000) && gen === G && !/^#settings(\/|$|\?)/.test(location.hash)){ ibClose(); window.HBInbox.openFeed(k); } }
      else if (IBK.includes(k)){ S.ret = null; if (!ans.hidden) closeAns(); ibOpen(k, true); }
      else if (views[k]){ S.ret = null; if (!ans.hidden) closeAns(); if (S.ib){ ibClose(); } if (current !== k) show(k); }
      sync();
    } finally {
      applying--;
      if (gen === G && location.hash !== h && !/^#settings(\/|$|\?)/.test(location.hash)) history.replaceState(history.state, '', h);
      recLater();   // 도는 사이 열린 화면은 그다음 주소로
    }
  }
  addEventListener('popstate', apply);

  const KIND_NAME = () => ({'': '전체', ...ART_KIND});
  const saveAQ = () => { try { localStorage.setItem('hb-arts-q', JSON.stringify({kind: AQ.kind, acct: AQ.acct, folder: AQ.folder})); } catch (e) {} };
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
    A = {v, arts, main, aside, top, bar, dd, kind: main.querySelector('[data-aqk="kind"]'), km: top.querySelector('.bx-kmenu'), kd: top.querySelector('.bx-kd')};
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
    new MutationObserver(mark).observe($id('artl'), {childList: true});
    artsLay(); return true;
  }
  function artsLay(){   // 종류 단추: PC 제목 아래 고르개 · 폰 위 알약 줄. 영역 고르개: PC 계정 알약 줄 오른쪽 · 폰 찾기 아래
    if (!A) return;
    (PC.matches ? A.km : A.bar).append(A.kind);
    if (PC.matches) A.bar.append(A.dd); else A.main.querySelector('.artq').after(A.dd);
  }
  function arts(){ if (artsInit()) mark(); }
  function mark(){
    if (!A) return;
    for (const r of A.v.querySelectorAll('.arow')){ const k = r.querySelector('.k')?.textContent.trim(); r.classList.add(k === ART_KIND.canvas ? 'k-canvas' : k === ART_KIND.page ? 'k-page' : 'k-doc'); }
    const fold = AQ.folder || '';
    A.top.querySelector('.bx-kt').textContent = PC.matches ? (KIND_NAME()[AQ.kind] || '전체') : '캔버스';
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
  // 딥링크: Worker 머리 글이 보드보다 먼저 주소를 #tree 로 바꿔 둠(보드가 모르는 주소를 #tree 로 밀어 칸이 둘 생기지 않게) → 원래 주소로 되돌리고 그 화면을 엶
  const h0 = String(window.HB_HASH0 || '');
  if (on() && (ROUTE.test(h0) || IBK.includes(h0.slice(1)))){
    history.replaceState(history.state, '', h0); apply();
    const nav = performance.getEntriesByType?.('navigation')[0]?.type;
    if (!EMBED && nav === 'navigate' && !history.state?.bx){
      const guard = () => { removeEventListener('pointerup', guard, true); removeEventListener('keydown', guard, true);
        if (history.state?.bx || !ROUTE.test(location.hash) && !IBK.includes(location.hash.slice(1))) return;
        const here = location.hash; history.replaceState(null, '', '#tree'); history.pushState({bx: 1, from: '#tree'}, '', here); };
      addEventListener('pointerup', guard, true); addEventListener('keydown', guard, true);
    }
  }
  else recLater();
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
  wrap('chatLoad', 'chat_load', undefined, 10);   // 30초마다 · 바뀜 알림마다 — 10번에 1번
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
    const f = document.querySelector('#mview iframe'); if (!f) return res();
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
  const wsUrl = () => { const u = new URL('api/live', location.href); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; return u.href; };
  class LiveES {
    constructor(url, opt){
      if (!/(^|\/)api\/events$/.test(String(url))) return new Native(url, opt);   // 그 밖(api/push/stream)은 원래 것
      Object.assign(this, {readyState: 0, onmessage: null, onopen: null, onerror: null, srv: {}, ws: null, wsUp: false, closed: false, down: false, back: 500, okAt: now(), t: {}});
      cur = this;
      if (now() - offAt < 300000) { setTimeout(() => this.fatal(), 0); return; }
      this.connect();
      this.t.first = setTimeout(() => { if (!this.wsUp) this.poll(true); }, 3000);
      this.t.check = setInterval(() => { if (this.readyState === 1) this.get().catch(() => {}).finally(() => { if (!this.closed) this.catchUp(); }); }, CHECK);
      // 주인 data 스냅숏이 낡음(서버가 준 나이 + 지난 시간 > 25초 — board-snap 멈춤): 20초마다 data 를 새 값으로 → 보드가 다시 읽고 Worker 는 낡은 스냅숏 대신 다리로
      this.t.stale = setInterval(() => { if (this.snapAt && now() - this.snapAt > STALE) { const v = '~s' + Math.floor(now() / 20000); if (this.srv.data !== v) { note('stale', Math.round((now() - this.snapAt) / 1000)); this.srv.data = v; this.send(true); } } }, 5000);
    }
    connect(){
      if (this.closed || this.ws) return;
      clearTimeout(this.t.re);
      let ws; try { ws = this.ws = new WebSocket(wsUrl()); } catch (e) { this.ws = null; return this.retry(); }
      ws.onopen = () => { if (this.ws !== ws) return; note('open'); if (this.lostAt) { window.BX_UI?.('reconnect', now() - this.lostAt); this.lostAt = 0; } this.wsUp = true; this.openAt = now(); this.okAt = now(); clearTimeout(this.t.poll); this.catchUp(); this.up(); this.ping(); };
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
      const r = await fetch('api/live', {cache: 'no-store', headers: {accept: 'application/json'}, signal: AbortSignal.timeout?.(8000)});
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
  let tick = now(), wakeAt = 0;
  const woke = () => {
    const t = now(), gap = t - tick; tick = t;
    if (gap < 30000 || document.hidden) return;
    wakeAt = t; note('wake', Math.round(gap / 1000));
    try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
    const L = cur; if (L && !L.closed) L.get().catch(() => {});
  };
  setInterval(woke, 5000);
  document.addEventListener('visibilitychange', () => { tick = now(); });
  // 「갱신 멈춤」 기록에 화면 연결 상태를 붙임 — 다시 나면 얼음 · 끊김 · 서버 멈춤을 가를 수 있게
  const he = window.hbErr;
  if (typeof he === 'function') window.hbErr = (w, x) => he(w, x && x.kind === 'stale' && cur ? {...x, err: `${x.err || ''} · ws ${cur.wsUp ? '붙음' : '끊김'} · 서버 나이 ${cur.snapAt ? Math.round((now() - cur.snapAt) / 1000) + '초' : '모름'} · 깸 ${wakeAt ? Math.round((now() - wakeAt) / 1000) + '초 전' : '없음'}`} : x);
  const so = window.stampOnly;
  const stamp = () => { try { window.stampOnly?.(); } catch (e) {} };
  if (typeof so === 'function') window.stampOnly = function (){
    woke();   // 깨어난 뒤 첫 판정이 타이머보다 먼저 와도 얼기 전 시각으로 경보하지 않게
    so.apply(this, arguments);
    const s = document.getElementById('stamp'), L = cur;
    if (s && L && L.down && !L.closed && !document.hidden) { s.textContent = `보더 연결 안 됨 · ${kst(L.okAt).slice(11)} 부터`; s.hidden = false; }
  };
  window.addEventListener('online', () => { const L = cur; if (L && !L.closed && !L.wsUp) { L.back = 500; L.connect(); L.poll(true); } });
  window.EventSource = LiveES;
  window.BX_LIVE = () => cur && {ws: cur.wsUp, ready: cur.readyState, down: cur.down, srv: cur.srv, ev: EV.slice()};   // 시험 · 확인용
  evClose(); evOpen();   // 보드가 이미 연 옛 SSE(503)를 이 길로 바꿔 엶
})();
(() => {
  if (!window.HB_LIVE || !window.BX_Q) return;
  const f1 = window.fetch, Q = /(^|\/)api\/(chat|answer|todo|cardcheck|artnote|artfolder)$/, LS = 'bx-outbox', MAXN = 240, MAXAGE = 6 * 3600e3;
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
