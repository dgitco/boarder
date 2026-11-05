(() => {
  const R = document.documentElement, PC = matchMedia('(min-width: 861px)');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const OFF = new Set(window.BX_FLAGS_OFF || []);
  const MENU0 = [['계정', [['start', '시작하기'], ['profile', '프로필'], ['look', '모양'], ['devices', '기기'], ['features', '기능']]], ['연결', [['connectors', '커넥터'], ['sessions', '세션'], ['profiles', 'CLI 프로필']]], ['에이전트', [['nodes', '노드']]], ['관리', [['emoji', '이모지'], ['invite', '사람 초대']]]];
  let OWNER = true;   // 관리 묶음은 관리자(주인)만 — api/me 의 owner 로 확인, 아니면 숨김
  const isMem = () => (window.HB_CAPS?.start_tab ?? false) || !OWNER;   // 「시작하기」 = 서버 능력값 start_tab(회원 참 · 켠 주인 거짓, 없으면 거짓 = 지금 주인) 또는 관리 권한 없음
  let MENU = [];
  const buildMenu = () => { MENU = MENU0.map(([g, xs]) => [g, xs.filter(([k]) => !(k === 'start' && !isMem()) && !(k === 'profiles' && OFF.has('cli_profiles')) && !(k === 'invite' && !OWNER))]).filter(([, xs]) => xs.length); };
  buildMenu();
  fetch('api/me', {credentials: 'include'}).then(r => r.json()).then(j => { OWNER = !!j?.user?.owner; buildMenu(); if (on()) render(); }).catch(() => {});
  const NAME = Object.fromEntries(MENU0.flatMap(([, xs]) => xs));
  const ACC = () => { let v = null; try { v = localStorage.getItem('hb-accent'); } catch {} return v === 'orange' || /^#[0-9a-f]{6}$/.test(v || '') ? v : 'bot'; };
  const MEMBER = 'BX_BOT' in window;   // 회원 화면만 BX_BOT 을 받음(이 글보다 먼저) — 주인 보드는 없음
  const botHex = () => {
    const b = MEMBER ? window.BX_BOT : null;
    const svg = window.HB_BLOB ? (b ? window.HB_BLOB(b.seed, {hue: b.hue}) : window.HB_BLOB('primary')) : '';
    return (/<g fill="(#[0-9a-f]{6})"/i.exec(svg) || [])[1] || null;
  };
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const hexOf = c => '#' + c.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
  const mixC = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const lum = c => { const [r, g, b] = c.map(x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const reach = (c, bg, to, need) => { for (let i = 0; i <= 25; i++){ const h = hexOf(mixC(c, to, i / 25)); if (ratio(rgb(h), bg) >= need) return h; } return hexOf(to); };
  function accentVars(hex){
    const c = rgb(hex), out = {};
    for (const [k, surf, to] of [['l', [255, 255, 255], [0, 0, 0]], ['d', [20, 20, 22], [255, 255, 255]]]){
      out['--bx-accent-ink-' + k] = reach(c, mixC(surf, c, 0.14).map(Math.round), to, 4.6);   // 칩 바탕도 브라우저처럼 반올림, 섞기 반올림 차이만큼 조금 넉넉히
      out['--bx-accent-mark-' + k] = reach(c, surf, to, 3.05);
    }
    return out;
  }
  function applyAccent(){
    const v = ACC(), hex = v === 'bot' ? botHex() : v === 'orange' ? null : v;
    const vars = hex ? {'--bx-accent': hex, ...accentVars(hex)} : {'--bx-accent': null, '--bx-accent-ink-l': null, '--bx-accent-ink-d': null, '--bx-accent-mark-l': null, '--bx-accent-mark-d': null};
    for (const [k, x] of Object.entries(vars)) if (x) R.style.setProperty(k, x); else R.style.removeProperty(k);
    R.classList.toggle('bx-acc', !!hex);
  }
  applyAccent();
  if (!window.HB_BLOB) document.addEventListener('DOMContentLoaded', applyAccent);
  const UIK = [['theme', 'hb-theme', 'system'], ['accent', 'hb-accent', 'bot'], ['still', 'hb-still', '0'], ['favblink', 'hb-favblink', '1'], ['tapthread', 'hb-tapthread', '1'], ['unreadkeep', 'hb-unreadkeep', '0'], ['canvasback', 'hb-canvasback', '0'], ['sbw', 'hb-sbw', '0'], ['ibboth', 'hb-ib-both', '0'], ['mainmerge', 'hb-mainmerge', '0']];
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const uiSave = (k, v) => fetch('api/me/ui', {method: 'POST', credentials: 'include', headers: {'content-type': 'application/json', 'x-hb': '1'}, body: JSON.stringify({k, v})}).catch(() => {});
  window.bxUiSave = uiSave;   // 보드 위 테마 단추(board.html)도 같은 길
  const uiApply = () => {
    const t = lsGet('hb-theme') || 'system';
    if (typeof theme !== 'undefined' && typeof applyTheme === 'function'){ theme = t; applyTheme(); } else if (t === 'system') R.removeAttribute('data-theme'); else R.setAttribute('data-theme', t);
    R.classList.toggle('bx-still', lsGet('hb-still') === '1');
    R.classList.toggle('hb-tapth', lsGet('hb-tapthread') !== '0');   // 보드 글 줄을 누를 수 있는 것으로(board.html CSS)
    window.HBInbox?.keepApply?.();   // 읽지 않음 켬 · 끔을 받은 목록 · 수에 바로(inbox.js)
    applyAccent();
    window.BXSideW?.(+(lsGet('hb-sbw') || 0));   // 사이드바 폭(계정 값을 받아 바뀌었을 때)
  };
  fetch('api/me/ui', {credentials: 'include'}).then(r => r.ok ? r.json() : null).then(j => {
    if (!j || typeof j !== 'object') return;
    let changed = false;
    for (const [k, ls, dflt] of UIK) {
      const sv = typeof j[k] === 'string' ? j[k] : null, lv = lsGet(ls);
      if (sv == null){ if (lv != null) uiSave(k, lv); continue; }   // 계정에 없음 — 이 브라우저에서 고른 값이 있으면 올림
      if (sv === (lv ?? dflt)) continue;
      try { if (k === 'accent' && sv === 'bot') localStorage.removeItem(ls); else localStorage.setItem(ls, sv); } catch {}
      changed = true;
    }
    if (changed) uiApply();
  }).catch(() => {});   // 블롭 부품이 이 글 뒤에 오는 화면이면 그때
  const svg = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const lu = (n, w = 18) => window.LU ? window.LU(n, w) : '';
  const IC = {
    back: lu('arrow-left'), more: svg('<circle cx="5" cy="10" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="15" cy="10" r="1.2"/>'), x: lu('x'),
    profile: lu('user'), invite: lu('user-plus'),
    connectors: lu('code'), hooks: lu('zap'), profiles: lu('terminal'),
    devices: lu('monitor'),
    features: lu('layout-grid'),   // 기능(상태 페이지 켜기/끄기)
    look: svg('<circle cx="10" cy="10" r="6.25"/><path d="M10 3.75v12.5"/><path d="M10 3.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" stroke="none"/>'),   // 모양(테마)
    nodes: lu('network'),
    start: lu('list-checks'),   // 시작하기(회원 온보딩 점검표)
    install: lu('download'), sessions: lu('history'), emoji: lu('smile'),
  };
  const api = async (method, p, body) => {
    const r = await fetch(p, {method, credentials: 'include', headers: {'content-type': 'application/json', 'x-hb': '1'}, body: body === undefined ? undefined : JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    const said = String(j.error || ''), msg = r.status >= 500 || !/[가-힣]/.test(said) || said.length > 60 ? '일시적인 오류가 발생했어요' : said.replace(/[「」]/g, '');
    if (!r.ok) throw Object.assign(new Error(msg), {status: r.status, data: j});
    return j;
  };
  const toast = t => { let el = document.getElementById('bx-toast'); if (!el){ el = mk('div', 'bx-toast'); el.id = 'bx-toast'; el.setAttribute('role', 'status'); document.body.append(el); } el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); };
  const copy = async (t, what) => { try { await navigator.clipboard.writeText(t); toast(`${what} 복사했어요`); } catch { toast('일시적인 오류가 발생했어요'); } };
  const spin = '<span class="bxs-spin" aria-label="불러오는 중"></span>';

  const parse = () => { const h = HBR.hash().split('?')[0]; const m = /^#settings(?:\/([a-z]*))?(?:\/(.+))?$/.exec(h); if (!m) return null; let id = ''; try { id = m[2] ? decodeURIComponent(m[2]) : ''; } catch {} return {tab: m[1] || '', id}; };
  const query = () => new URLSearchParams(HBR.hash().split('?')[1] || '');
  const on = () => !!parse();
  let backTo = (() => { try { return sessionStorage.getItem('bx-set-back') || '#tree'; } catch { return '#tree'; } })();
  const steps = () => Number.isInteger(history.state?.bxs) ? history.state.bxs : 0;
  const go = (h, replace) => { if (replace) history.replaceState({bxs: steps()}, '', h); else history.pushState({bxs: steps() + 1}, '', h); render(); };
  const DEF = () => isMem() ? 'start' : 'connectors';   // 회원은 시작하기부터(온보딩 4층)
  function enter(tab = DEF()){
    if (tab === 'feedback') return feedbackBox();   // 피드백은 설정 칸이 아니라 보내기 창
    if (tab === 'invite-box') return inviteBox();   // 아바타 메뉴 「초대」 = 그 자리 창(설정 › 관리 › 사람 초대 칸은 그대로)
    if (tab === 'emoji-add') return emojiBox();
    if (!on()){ backTo = /^#settings/.test(HBR.hash()) ? '#tree' : (HBR.hash() || '#tree'); try { sessionStorage.setItem('bx-set-back', backTo); } catch {} }
    go('#settings' + (PC.matches || tab ? '/' + (tab || DEF()) : ''));
  }
  function leave(){
    closePops(); R.classList.remove('bx-set');
    const n = steps(); if (n > 0){ leaving = true; history.go(-n); return; }   // 들어오기 전 칸으로 — shell.js 가 popstate 로 그 화면을 되살림
    history.replaceState(null, '', backTo); dispatchEvent(new PopStateEvent('popstate'));   // 딥링크로 바로 들어온 때
  }
  let leaving = false;
  const closePops = () => { document.querySelectorAll('.bxs-pop, .bxs-dlg').forEach(x => x.remove()); };   // shell.js 가 그 화면을 되살림
  window.BXSettings = {enter, on};

  // ── 틀: PC 사이드바(설정 모드) · 본 판
  const side = mk('nav', 'bxs-sb'); side.setAttribute('aria-label', '설정 메뉴');
  const main = mk('section', 'bxs-main'); main.setAttribute('aria-label', '설정');
  main.tabIndex = -1;
  document.body.append(side, main);
  const menuHtml = (active, phone) => `<div class="bxs-top"><button type="button" class="bxs-back" data-leave>${IC.back}<span>돌아가기</span></button></div>`
    + MENU.map(([g, xs]) => `<div class="bxs-g">${g}</div>` + xs.map(([k, n]) => `<button type="button" class="bxs-it" data-tab="${k}"${k === active && !phone ? ' aria-current="page"' : ''}>${IC[k]}<span>${n}</span>${phone ? '<i class="bxs-chev">' + lu('chevron-right', 16) + '</i>' : ''}</button>`).join('')).join('');
  side.addEventListener('click', e => { if (e.target.closest('[data-leave]')) return leave(); const t = e.target.closest('[data-tab]'); if (t) go('#settings/' + t.dataset.tab); });

  let gen = 0;
  async function render(){
    const r = parse();
    closePops();
    R.classList.toggle('bx-set', !!r); if (r) R.classList.remove('bx-route');   // 설정 주소로 들어온 첫 화면: 머리 글 · 틀이 걸어 둔 가림막을 설정 화면이 덮은 뒤 걷음
    if (!r){ side.innerHTML = ''; main.innerHTML = ''; return; }
    if (PC.matches && !r.tab) return go('#settings/' + DEF(), true);
    side.innerHTML = PC.matches ? menuHtml(r.tab) : '';
    const my = ++gen;
    if (!r.tab){ main.innerHTML = `<div class="bxs-phone-menu">${menuHtml('', true)}</div>`; return; }
    const head = PC.matches ? '' : `<div class="bxs-ptop"><button type="button" class="bxs-back" data-to="#settings">${IC.back}<span>설정</span></button></div>`;
    main.innerHTML = head + `<div class="bxs-page">${spin}</div>`;
    main.scrollTop = 0;
    if (!main.contains(document.activeElement)) main.focus({preventScroll: true});
    const page = main.querySelector('.bxs-page');
    try { await (Object.hasOwn(PAGES, r.tab) ? PAGES[r.tab] : PAGES.connectors)(page, r.id, () => my === gen); }
    catch (e) { if (my === gen) page.innerHTML = `<p class="bxs-err">${esc(e.message)}</p>`; }
    const q = query();
    if (q.get('connected')){ toast('연결했어요'); history.replaceState(history.state, '', HBR.hash().split('?')[0]); }
    if (q.get('error')){ toast('연결하지 못했어요: ' + q.get('error').slice(0, 120)); history.replaceState(history.state, '', HBR.hash().split('?')[0]); }
  }
  main.addEventListener('click', e => {
    if (e.target.closest('[data-leave]')) return leave();
    const to = e.target.closest('[data-to]'); if (to){ e.preventDefault(); go(to.dataset.to, to.dataset.to === '#settings'); }   // 폰 「‹ 설정」은 지금 칸을 메뉴로 바꿈(뒤로 한 칸이 메뉴라는 보장이 없음 — 세션 · 서비스 하나를 거친 때)
    const t = e.target.closest('[data-tab]'); if (t) go('#settings/' + t.dataset.tab);
  });

  const header = (title, desc, action = '') => `<div class="bxs-h"><div><h1>${esc(title)}</h1>${desc ? `<p>${desc}</p>` : ''}</div>${action}</div>`;
  const btn = (label, attrs = '', kind = '') => `<button type="button" class="bxs-btn ${kind}" ${attrs}>${label}</button>`;
  const empty = (o, old) => window.HBEmpty ? window.HBEmpty(o) : old;
  const sw = (on, attrs = '', label = '') => `<button type="button" role="switch" aria-checked="${on}" class="bxs-sw" ${attrs} aria-label="${esc(label)}"><i></i></button>`;
  /** 정상으로 보이나 도구가 하나도 안 읽힘 = 토큰이 죽었거나 권한이 빠진 연결 의심 */
  const suspect = c => c.status === 'ok' && c.tools === 0;
  const canRecon = c => c.kind !== 'api' || c.api_oauth && apiReady(c);
  const badge = c => suspect(c) ? '<span class="bxs-badge warn">도구 없음 · 끊김 의심</span>' : c.status === 'ok' ? `<span class="bxs-badge"><i class="ok"></i>${c.tools == null ? '연결됨' : `도구 ${c.tools - c.off}`}</span>`
    : c.status === 'expired' ? '<span class="bxs-badge warn">다시 연결</span>' : '<span class="bxs-badge bad">오류</span>';
  const confirmBox = (msg, yes) => new Promise(res => {
    const d = mk('div', 'bxs-dlg', `<div class="bxs-dlgc" role="alertdialog" aria-modal="true"><p>${msg}</p><div class="bxs-row end">${btn('취소', 'data-no', 'ghost')}${btn(esc(yes), 'data-yes', 'danger')}</div></div>`);
    d.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape'){ d.remove(); res(false); } });
    document.body.append(d); d.querySelector('[data-no]').focus();
    d.addEventListener('click', e => { if (e.target.closest('[data-yes]')){ d.remove(); res(true); } else if (e.target.closest('[data-no]') || e.target === d){ d.remove(); res(false); } });
  });

  let catalog = null;
  async function connect(body, b){
    if (b){ b.disabled = true; b.dataset.l = b.innerHTML; b.innerHTML = spin; }
    try {
      const r = await api('POST', 'api/connections', {...body, back: '#settings/connectors'});
      if (r.authUrl){ location.href = r.authUrl; return; }   // 로그인 뒤 /#settings/connectors?connected=… 로 돌아옴
      toast('연결했어요'); render();
    } catch (e) {
      toast(e.data?.suggestion ? `${e.message} — 예: ${e.data.suggestion}` : e.message);
      if (b){ b.disabled = false; b.innerHTML = b.dataset.l; }
    }
  }
  const PAGES = {};
  PAGES.connectors = async (el, id, live) => {
    if (id === 'hooks') return unboundHooks(el, live);
    if (id && id.startsWith('svc~')) return svcPage(el, id.slice(4), live);
    if (id) return detail(el, id, live);
    const [{connections}, cat, {hooks}] = await Promise.all([api('GET', 'api/connections'), catalog ? Promise.resolve(catalog) : api('GET', 'api/connectors').then(x => (catalog = x)), api('GET', 'api/hooks')]);
    if (!live()) return;
    const groups = new Map();
    for (const c of [...connections].sort((a, b) => a.label.localeCompare(b.label))) groups.set(c.service, [...(groups.get(c.service) || []), c]);
    const hooksOf = svc => hooks.filter(h => (h.service || '') === svc);
    const hookLine = h => { const home = h.service && groups.get(h.service)?.[0]; const to = home ? '#settings/connectors/' + encodeURIComponent(home.id) : '#settings/connectors/hooks';
      return `<li class="bxs-conn"><span class="tick" aria-hidden="true"></span><div class="bxs-cm"><div class="l1"><a href="${to}" data-to="${to}">${IC.hooks} ${esc(h.name)}</a><span class="bxs-badge">${h.enabled ? `<i class="ok"></i>웹훅 · 받음 ${h.count}` : '웹훅 · 꺼짐'}</span>${h.target ? `<span class="acct">→ ${esc(h.target)}</span>` : ''}</div><div class="l2">${esc(HKIND[h.preset] || h.preset)} · <code>${esc(new URL(h.url).pathname)}</code></div></div></li>`; };
    const unbound = hooksOf('');
    const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
    const gic = (svc, title) => `<span class="gk-ic" style="background:hsl(${hue(svc)} 45% 42%)" aria-hidden="true">${esc(String(title || svc).trim().slice(0, 1).toUpperCase())}</span>`;
    const bad = c => suspect(c) || c.status !== 'ok';
    const tile = ([svc, xs]) => {
      const nb = xs.filter(bad), tools = xs.reduce((n, c) => n + (c.tools == null ? 0 : c.tools - c.off), 0), first = xs[0];
      const st = nb.length ? (nb.length === 1 && canRecon(nb[0]) ? btn('다시 연결', `data-recon="${esc(nb[0].id)}"`, 'sm gk-warn') : btn('다시 연결', `data-svc="${esc(svc)}"`, 'sm gk-warn')) : '<span class="gk-ok">연결됨</span>';
      return `<div class="gk-it" data-svc="${esc(svc)}" tabindex="0" role="button">${gic(svc, first.title)}<div class="gk-m"><b>${esc(first.title)}</b><span>계정 ${xs.length}개${tools ? ` · 도구 ${tools}개` : ''}</span></div>${st}</div>`;
    };
    const have = new Set(groups.keys());
    const more = [...(cat.services || []).filter(s => !have.has(s.service) && !s.needs_app).map(s => ({svc: s.service, title: s.title, attr: `data-cs="${esc(s.service)}"`})),
      ...(cat.apis || []).filter(s => !have.has(s.service) && s.ready).map(s => ({svc: s.service, title: s.title, attr: s.oauth ? `data-aoauth="${esc(s.service)}"` : `data-ap="${esc(s.service)}"`}))];
    const moreTile = m => `<div class="gk-it" data-ask="${esc(m.svc)}">${gic(m.svc, m.title)}<div class="gk-m"><b>${esc(m.title)}</b><span>연결 안 됨</span></div>${btn('연결하기', m.attr, 'sm')}</div>`;
    const rows = `<div class="gk-grid">${[...groups].sort(([a], [b]) => a.localeCompare(b)).sort(([, a], [, b]) => b.some(bad) - a.some(bad)).map(tile).join('')}`
      + (unbound.length ? `<div class="gk-it" data-to="#settings/connectors/hooks" tabindex="0" role="button"><span class="gk-ic" style="background:hsl(210 20% 40%)">${IC.hooks}</span><div class="gk-m"><b>웹훅</b><span>받는 주소 ${unbound.length}개</span></div></div>` : '') + '</div>'
      + (more.length ? `<div class="gk-h2">연결할 수 있는 서비스</div><div class="gk-grid">${more.slice(0, 24).map(moreTile).join('')}</div>` : '');
    el.innerHTML = header('커넥터', 'AI 도구들이 보더를 거쳐 쓰는 서비스예요. 연결한 서비스는 모든 창에서 <code>서비스__도구</code> 로 불려요.', btn('+ 연결', 'data-add', 'pri'))
      + '<div class="bxs-add" hidden></div>'
      + (connections.length || hooks.length ? `<div class="bxs-sech">${connections.length}개 연결됨${hooks.length ? ` · 웹훅 ${hooks.length}` : ''}</div><div class="bxs-list">${rows}</div>`
        : empty({ic: 'connectors', sk: 'ci', t: '연결한 서비스가 없어요', p: 'Linear · Slack · Notion 이나 아무 MCP 서버를 한 번 연결하면 모든 AI 창이 그 도구를 써요.', act: btn('+ 연결', 'data-add', 'pri sm')},
          `<div class="bxs-empty"><b>연결한 서비스가 없어요</b><p>Linear · Slack · Notion 이나 아무 MCP 서버를 한 번 연결하면 모든 AI 창이 그 도구를 써요.</p>${btn('+ 연결', 'data-add', 'pri sm')}</div>`));
    const add = el.querySelector('.bxs-add');
    const find = () => {
      add.innerHTML = `<div class="bxs-card"><div class="bxs-row between"><h2>서비스 연결</h2><button type="button" class="bxs-icon" data-close aria-label="닫기">${IC.x}</button></div>`
        + `<input class="bxs-in" type="search" placeholder="서비스 찾기 — linear, notion, sentry … 또는 MCP 주소" aria-label="서비스 찾기" data-q><div class="bxs-res" data-res></div>`
        + `<div class="bxs-row"><input class="bxs-in sm" placeholder="라벨(둘째 계정일 때)" aria-label="라벨" data-label><button type="button" class="bxs-link" data-manual>직접 입력</button><button type="button" class="bxs-link" data-amanual>HTTP API 직접</button></div></div>`;
      const q = add.querySelector('[data-q]'), res = add.querySelector('[data-res]');
      const show = () => {
        const v = q.value.trim().toLowerCase();
        if (/^https:\/\//.test(v)) { res.innerHTML = `<div class="bxs-ri"><div><b>이 주소로 연결</b><span>${esc(v)}</span></div>${btn('연결', `data-cu="${esc(v)}"`, 'sm pri')}</div>`; return; }
        const hit = cat.services.filter(s => !v || s.service.includes(v) || s.title.toLowerCase().includes(v)).slice(0, v ? 8 : 6);
        res.innerHTML = (v && !'웹훅 webhook hook'.includes(v) ? '' : `<div class="bxs-ri"><div><b>${IC.hooks} 웹훅</b><span>밖의 일(GitHub · 채널톡 · 아무 서비스)이 창을 깨우는 받는 주소</span></div>${btn('만들기', 'data-hk', 'sm')}</div>`) + hit.map(s => `<div class="bxs-ri"><div><b>${esc(s.title)}</b><span>${esc(new URL(s.url).host)}${s.needs_app ? ' · 미리 만든 앱이 필요해요(직접 입력)' : ''}</span></div>${btn('연결', `data-cs="${esc(s.service)}"${s.needs_app ? ' disabled' : ''}`, 'sm')}</div>`).join('')
          + (cat.apis || []).filter(s => !v || s.service.includes(v) || s.title.toLowerCase().includes(v) || s.service === 'imap' && 'gmail email 이메일 메일'.includes(v)).map(s => `<div class="bxs-ri"><div><b>${esc(s.title)} <span class="bxs-badge">API</span></b><span>${esc(apiHost(s.url))}${s.note ? ' · ' + esc(s.note) : ''}</span></div>${s.ready ? (s.oauth ? btn('연결', `data-aoauth="${esc(s.service)}"`, 'sm') : btn('키 넣기', `data-ap="${esc(s.service)}"`, 'sm')) : s.via === 'imap' ? btn('IMAP 으로 연결', `data-ap="imap" data-apre="imap.gmail.com"`, 'sm') : btn(s.soon ? '곧' : '준비 중', 'disabled', 'sm')}</div>`).join('')
          || empty({ic: 'search', sk: '', sm: true, t: '찾는 서비스가 없어요', p: 'MCP 주소를 넣거나 「직접 입력」을 눌러요.'}, '<p class="bxs-mut">없어요 — MCP 주소를 넣거나 「직접 입력」</p>');
      };
      q.addEventListener('input', show); show(); q.focus();
    };
    const manual = () => {
      add.innerHTML = `<div class="bxs-card"><div class="bxs-row between"><h2>직접 연결</h2><button type="button" class="bxs-icon" data-close aria-label="닫기">${IC.x}</button></div>`
        + `<label class="bxs-f"><span>서비스 이름</span><input class="bxs-in" data-ms placeholder="예: linear" aria-label="서비스 이름"></label>`
        + `<label class="bxs-f"><span>MCP 주소</span><input class="bxs-in" data-mu placeholder="https://…" aria-label="MCP 주소"></label>`
        + `<label class="bxs-f"><span>머리(선택, 줄마다 이름: 값)</span><textarea class="bxs-in" rows="2" data-mh placeholder="Authorization: Bearer …" aria-label="머리"></textarea></label>`
        + `<label class="bxs-f"><span>라벨(선택)</span><input class="bxs-in" data-ml placeholder="둘째 계정이면 이름" aria-label="라벨"></label>`
        + `<label class="bxs-f"><span>OAuth 앱 client_id(선택 — GitHub 처럼 미리 만든 앱만 받는 곳)</span><input class="bxs-in" data-mc aria-label="client_id"></label>`
        + `<div class="bxs-row end">${btn('취소', 'data-close', 'ghost')}${btn('연결', 'data-mgo', 'pri')}</div><p class="bxs-mut">키 · 토큰은 봉해 두고 다시 보여 주지 않아요.</p></div>`;
    };
    const apiKeys = (svc, pre) => {
      const s = cat.apis.find(x => x.service === svc), label = add.querySelector('[data-label]')?.value.trim() || '';
      add.innerHTML = `<div class="bxs-card"><div class="bxs-row between"><h2>${esc(s.title)} 연결</h2><button type="button" class="bxs-icon" data-close aria-label="닫기">${IC.x}</button></div>`
        + (s.note ? `<p class="bxs-mut">${esc(s.note)}</p>` : '')
        + (s.app ? `<p class="bxs-mut">Slack 앱에 설정된 권한(사용자): ${esc(s.app.userScopes.join(' · '))}</p>` : '')
        + keyFields(s, 'ak', i => i === 0 && pre ? pre : '')
        + `<label class="bxs-f"><span>라벨(선택)</span><input class="bxs-in" data-al value="${esc(label)}" placeholder="둘째 계정이면 이름" aria-label="라벨"></label>`
        + `<div class="bxs-row end">${btn('취소', 'data-close', 'ghost')}${btn('연결', `data-ago="${esc(svc)}"`, 'pri')}</div><p class="bxs-mut">키는 봉해 두고 다시 보여 주지 않아요. 맞는지는 처음 부를 때 ${esc(s.title)} 이 답해요.</p></div>`;
      [...add.querySelectorAll('[data-ak]')].find(i => !i.value)?.focus();
    };
    const apiManual = () => {
      add.innerHTML = `<div class="bxs-card"><div class="bxs-row between"><h2>HTTP API 직접 연결</h2><button type="button" class="bxs-icon" data-close aria-label="닫기">${IC.x}</button></div>`
        + `<label class="bxs-f"><span>서비스 이름</span><input class="bxs-in" data-xs placeholder="예: myapi" aria-label="서비스 이름"></label>`
        + `<label class="bxs-f"><span>기본 주소</span><input class="bxs-in" data-xu placeholder="https://api.example.com/v1" aria-label="기본 주소"></label>`
        + `<label class="bxs-f"><span>키를 넣는 곳</span><select class="bxs-in" data-xa aria-label="키를 넣는 곳"><option value="bearer">Authorization: Bearer 키</option><option value="header">머리 하나(이름 아래)</option><option value="query">주소 뒤 ?이름=키</option><option value="basic">Basic(user:password)</option></select></label>`
        + `<label class="bxs-f" data-xnf hidden><span>머리 · 파라미터 이름</span><input class="bxs-in" data-xn placeholder="예: x-api-key" aria-label="머리 이름"></label>`
        + `<label class="bxs-f"><span>키</span><input class="bxs-in" type="password" autocomplete="off" data-xk aria-label="키"></label>`
        + `<label class="bxs-f"><span>라벨(선택)</span><input class="bxs-in" data-xl placeholder="둘째 계정이면 이름" aria-label="라벨"></label>`
        + `<div class="bxs-row end">${btn('취소', 'data-close', 'ghost')}${btn('연결', 'data-xgo', 'pri')}</div><p class="bxs-mut">에이전트에게는 <code>이름__get</code>(읽기) · <code>이름__request</code>(바꿈) 두 도구로 보여요. 기본 주소 밖으로는 못 나가요.</p></div>`;
      const a = add.querySelector('[data-xa]'); a.onchange = () => { add.querySelector('[data-xnf]').hidden = !['header', 'query'].includes(a.value); };
    };
    // boarder connect <서비스> 가 연 주소(?connect=…&label=…): 연결 판을 그 서비스로 채워 엶 — 「연결」은 사람이 누름
    const want = query().get('connect');
    if (want){
      add.hidden = false; find();
      add.querySelector('[data-q]').value = want; add.querySelector('[data-label]').value = query().get('label') || '';
      add.querySelector('[data-q]').dispatchEvent(new Event('input'));
      history.replaceState(history.state, '', HBR.hash().split('?')[0]);
    }
    el.onclick = async e => {
      const t = e.target;
      const goSvc = svc => go('#settings/connectors/svc~' + encodeURIComponent(svc));
      if (!t.closest('button, a, [data-more]')){ const sv = t.closest('.gk-it[data-svc]'); if (sv) return goSvc(sv.dataset.svc); }
      const bs = t.closest('button[data-svc]'); if (bs) return goSvc(bs.dataset.svc);
      if (t.closest('[data-add]')){ add.hidden = false; find(); return; }
      if (t.closest('[data-close]')){ add.hidden = true; add.innerHTML = ''; return; }
      if (t.closest('[data-manual]')){ manual(); return; }
      if (t.closest('[data-amanual]')){ apiManual(); return; }
      const ap = t.closest('[data-ap]'); if (ap){ add.hidden = false; add.scrollIntoView?.({block: 'nearest'}); apiKeys(ap.dataset.ap, ap.dataset.apre); return; }
      // 구글 로그인 API(캘린더 · Gmail): 키 칸 없이 구글 동의 화면으로 — 돌아오면 「연결했어요」
      const ao = t.closest('[data-aoauth]'); if (ao) return connect({service: ao.dataset.aoauth, label: add.querySelector('[data-label]')?.value.trim() || undefined, api: {preset: ao.dataset.aoauth}}, ao);
      const ag = t.closest('[data-ago]'); if (ag){
        const key = [...add.querySelectorAll('[data-ak]')].map(i => i.value.trim()).join('\n');
        if (!key.split('\n').every(Boolean)) return toast('키 칸을 다 채워요');
        return connect({service: ag.dataset.ago, label: add.querySelector('[data-al]').value.trim() || undefined, api: {preset: ag.dataset.ago}, key}, ag);
      }
      if (t.closest('[data-xgo]')){
        const v = k => add.querySelector(k).value.trim(), type = v('[data-xa]');
        if (!v('[data-xs]') || !v('[data-xu]') || !v('[data-xk]')) return toast('서비스 이름 · 기본 주소 · 키를 넣어요');
        return connect({service: v('[data-xs]'), label: v('[data-xl]') || undefined, api: {base_url: v('[data-xu]'), auth: {type, name: v('[data-xn]') || undefined}}, key: v('[data-xk]')}, t.closest('[data-xgo]'));
      }
      const label = add.querySelector('[data-label]')?.value.trim() || undefined;
      if (t.closest('[data-hk]')) return go('#settings/connectors/hooks?new=1');
      const cs = t.closest('[data-cs]'); if (cs) return connect({service: cs.dataset.cs, label}, cs);
      const cu = t.closest('[data-cu]'); if (cu) return connect({service: new URL(cu.dataset.cu).hostname.split('.').filter(x => !['mcp', 'api', 'www'].includes(x))[0] || 'mcp', url: cu.dataset.cu, label}, cu);
      if (t.closest('[data-mgo]')){
        const v = k => add.querySelector(k).value.trim(), headers = {};
        for (const line of v('[data-mh]').split('\n')){ const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
        if (!v('[data-ms]') || !v('[data-mu]')) return toast('서비스 이름과 MCP 주소를 넣어요');
        return connect({service: v('[data-ms]'), url: v('[data-mu]'), label: v('[data-ml]') || undefined, headers: Object.keys(headers).length ? headers : undefined, client_id: v('[data-mc]') || undefined}, t.closest('[data-mgo]'));
      }
      const ak = t.closest('[data-apikey]'); if (ak) return go('#settings/connectors/' + encodeURIComponent(ak.dataset.apikey) + '?rekey=1');
      const rc = t.closest('[data-recon]'); if (rc){ const c = connections.find(x => x.id === rc.dataset.recon); return connect({service: c.service, reconnect: c.id}, rc); }
      const m = t.closest('[data-more]'); if (m) return moreMenu(m, connections.find(x => x.id === m.dataset.more));
    };
  };

  async function svcPage(el, svc, live){
    const [{connections}, cat, {hooks}] = await Promise.all([api('GET', 'api/connections'), catalog ? Promise.resolve(catalog) : api('GET', 'api/connectors').then(x => (catalog = x)), api('GET', 'api/hooks')]);
    if (!live()) return;
    const xs = connections.filter(c => c.service === svc).sort((a, b) => a.label.localeCompare(b.label));
    if (!xs.length) return go('#settings/connectors', true);
    const f = xs[0], bad = c => suspect(c) || c.status !== 'ok', hs = hooks.filter(h => h.service === svc);
    const on = xs.reduce((n, c) => n + (c.tools == null ? 0 : c.tools - c.off), 0), all = xs.reduce((n, c) => n + (c.tools == null ? 0 : c.tools), 0);
    const hue = [...svc].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0);
    el.innerHTML = `<a href="#settings/connectors" class="bxs-crumb" data-to="#settings/connectors">‹ 커넥터</a>`
      + `<div class="gk-hd"><span class="gk-ic" style="background:hsl(${hue} 45% 42%)" aria-hidden="true">${esc(f.title.slice(0, 1).toUpperCase())}</span><b>${esc(f.title)}</b><span class="bxs-row">${btn('제거', 'data-gkrm', 'sm')}</span></div>`
      + `<p class="gk-desc">${esc(f.host)} · 연결한 계정마다 도구가 <code>${esc(f.prefix.split('__')[0])}__…</code> 로 에이전트에게 보여요.</p>`
      + `<div class="gk-sec">계정</div><div class="gk-box">${xs.map(c => `<div class="gk-rw" data-id="${esc(c.id)}"><span class="gk-n"><a href="#settings/connectors/${encodeURIComponent(c.id)}" data-to="#settings/connectors/${encodeURIComponent(c.id)}">${esc(c.label || c.account || '기본')}</a>${c.account && c.label ? `<small> ${esc(c.account)}</small>` : ''}</span>${bad(c) ? (canRecon(c) ? btn('다시 연결', `data-recon="${esc(c.id)}"`, 'sm gk-warn') : apiReady(c) ? btn('키 넣기', `data-apikey="${esc(c.id)}"`, 'sm gk-warn') : '<span class="gk-bad">끊김</span>') : '<span class="gk-ok">연결됨</span>'}<button type="button" class="bxs-more" data-more="${esc(c.id)}" aria-label="${esc(c.prefix)} 메뉴" aria-haspopup="menu">${IC.more}</button></div>`).join('')}<div class="gk-rw gk-add" data-gkplus tabindex="0" role="button">+ 계정 더하기</div></div>`
      + `<div class="gk-sec">도구</div><div class="gk-box"><div class="gk-rw"><span class="gk-n">${all}개 중 ${on}개 켬</span><span class="bxs-mut">계정을 눌러 도구를 켜고 꺼요</span></div></div>`
      + (hs.length ? `<div class="gk-sec">웹훅</div><div class="gk-box">${hs.map(h => `<div class="gk-rw"><a class="gk-n" href="#settings/connectors/hooks" data-to="#settings/connectors/hooks">${esc(h.name)}</a><span class="bxs-mut">${h.enabled ? `받음 ${h.count}` : '꺼짐'}</span></div>`).join('')}</div>` : '')
      + `<div class="gk-sec">정보</div><dl class="gk-kv"><dt>서비스</dt><dd>${esc(f.title)}</dd><dt>주소</dt><dd>${esc(f.host)}</dd><dt>종류</dt><dd>${f.kind === 'api' ? 'API' : 'MCP'}</dd><dt>계정</dt><dd>${xs.length}개</dd></dl>`;
    el.onclick = async e => {
      const t = e.target;
      if (t.closest('[data-gkplus]')){
        if (f.kind === 'api'){ const ps = (cat.apis || []).find(p => p.service === svc); if (ps?.oauth) return connect({service: svc, api: {preset: svc}}, t.closest('[data-gkplus]')); return go('#settings/connectors?connect=' + encodeURIComponent(svc)); }
        return connect({service: svc}, t.closest('[data-gkplus]'));
      }
      if (t.closest('[data-gkrm]') && await confirmBox(`<b>${esc(f.title)}</b> 연결 ${xs.length}개를 모두 끊을까요? 에이전트가 이 도구를 더 못 써요.`, '모두 끊기')){ try { for (const c of xs) await api('DELETE', 'api/connections/' + encodeURIComponent(c.id)); toast('끊었어요'); go('#settings/connectors', true); } catch (err) { toast(err.message); render(); } return; }
      const ak = t.closest('[data-apikey]'); if (ak) return go('#settings/connectors/' + encodeURIComponent(ak.dataset.apikey) + '?rekey=1');
      const rc = t.closest('[data-recon]'); if (rc){ const c = xs.find(x => x.id === rc.dataset.recon); return connect({service: c.service, reconnect: c.id}, rc); }
      const m = t.closest('[data-more]'); if (m) return moreMenu(m, xs.find(x => x.id === m.dataset.more));
    };
  }
  function moreMenu(anchor, c){
    document.querySelector('.bxs-pop')?.remove();
    const p = mk('div', 'bxs-pop', `<button type="button" data-a="tools">도구와 자세히</button>${canRecon(c) ? '<button type="button" data-a="recon">다시 연결</button>' : ''}<button type="button" data-a="rename">이름 바꾸기</button><hr><button type="button" data-a="rm" class="danger">끊기</button>`);
    p.setAttribute('role', 'menu'); p.addEventListener('keydown', e => e.stopPropagation()); document.body.append(p);
    const r = anchor.getBoundingClientRect(); p.style.top = (r.bottom + 4) + 'px'; p.style.left = Math.max(8, Math.min(innerWidth - 200, r.right - 190)) + 'px';
    const close = () => { p.remove(); removeEventListener('click', out, true); };
    const out = e => { if (!p.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
    setTimeout(() => addEventListener('click', out, true));
    p.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return; close();
      if (a === 'tools') return go('#settings/connectors/' + encodeURIComponent(c.id));
      if (a === 'rename') return rename(c);
      if (a === 'recon') return connect({service: c.service, reconnect: c.id});
      if (a === 'rm' && await confirmBox(`<b>${esc(c.prefix)}</b> 연결을 끊을까요? 에이전트가 이 도구를 더 못 써요.`, '끊기')){ try { await api('DELETE', 'api/connections/' + encodeURIComponent(c.id)); toast('끊었어요'); render(); } catch (err) { toast(err.message); } }
    });
  }
  function rename(c){
    const li = main.querySelector(`.bxs-conn[data-id="${CSS.escape(c.id)}"] .bxs-cm`) || main.querySelector(`.gk-rw[data-id="${CSS.escape(c.id)}"] .gk-n`) || main.querySelector('[data-rename-at]');
    if (!li) return;
    li.innerHTML = `<div class="bxs-row"><input class="bxs-in sm" value="${esc(c.label)}" placeholder="라벨 없음 · 영문·숫자·-" aria-label="${esc(c.prefix)} 라벨" data-rl>${btn('저장', 'data-rs', 'sm pri')}${btn('취소', 'data-rc', 'sm ghost')}</div><p class="bxs-mut">로그인은 그대로예요. 도구 이름이 새 라벨로 바뀌어요.</p>`;
    const i = li.querySelector('[data-rl]'); i.focus(); i.select();
    li.onclick = async e => {
      if (e.target.closest('[data-rc]')) return render();
      if (e.target.closest('[data-rs]')){ const v = i.value.trim(), sl = v.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24); if (v && !sl) return toast('영문·숫자·-만 쓸 수 있어요'); try { await api('PATCH', 'api/connections/' + encodeURIComponent(c.id), {label: v}); toast(v && sl !== v ? `이름을 「${sl}」 로 바꿨어요(영문·숫자·-만)` : '이름을 바꿨어요'); render(); } catch (err) { toast(err.message); } }
    };
    i.onkeydown = e => { if (e.key === 'Escape') render(); if (e.key === 'Enter') li.querySelector('[data-rs]').click(); };
  }
  /** 키를 넣을 수 있는 API 줄인가(준비 중인 구글 · Slack 은 아님). 목록을 아직 안 읽었으면 넣을 수 있다고 봄 — 서버가 다시 막음 */
  const apiReady = c => !catalog || (catalog.apis || []).find(x => x.service === c.service)?.ready !== false;
  /** 키 칸: 앞 plain 개(메일(IMAP)의 서버 · 주소)는 보이는 칸, 나머지는 비밀 칸. hints = 칸 안 예시, val(i) = 채워 둘 값 */
  const keyFields = (s, at, val = () => '') => (s.keys || ['키']).map((k, i) => `<label class="bxs-f"><span>${esc(k)}</span><input class="bxs-in" type="${i < (s.plain || 0) ? 'text' : 'password'}" autocomplete="off"${s.hints?.[i] ? ` placeholder="${esc(s.hints[i])}"` : ''}${val(i) ? ` value="${esc(val(i))}"` : ''} data-${at}="${i}" aria-label="${esc(k)}"></label>`).join('');
  const apiHost = u => /^imaps:/.test(u) ? 'IMAP' : new URL(u).host;
  const ctReady = (cat0, c) => { const a = (cat0.apis || []).find(x => x.service === c.service); return a ? a.ready : !/^(0b 에서 옮김|옮겨 온 연결)/.test(c.error || ''); };
  /** API 줄의 키 바꾸기 판: 아는 API 는 키 이름마다 칸, 직접 넣은 API 는 칸 하나 */
  async function rekey(el, c){
    const cat0 = catalog || (catalog = await api('GET', 'api/connectors'));
    if (!ctReady(cat0, c)) return toast(c.error || '이 API 는 아직 키로 못 열어요');
    const s0 = (cat0.apis || []).find(x => x.service === c.service) || {keys: ['키']};
    let f = el.querySelector('[data-rkf]');
    if (!f){ f = mk('div', 'bxs-card'); f.dataset.rkf = ''; el.querySelector('.bxs-h').after(f); }
    f.hidden = false;
    f.innerHTML = `<h2>키 바꾸기</h2>` + keyFields(s0, 'rk')
      + `<div class="bxs-row end">${btn('취소', 'data-rkx', 'ghost')}${btn('저장', 'data-rkgo', 'pri')}</div><p class="bxs-mut">주소 · 도구는 그대로, 키만 바뀌어요.</p>`;
    f.querySelector('[data-rk]').focus();
  }
  async function detail(el, id, live){
    let j; try { j = await api('GET', 'api/connections/' + encodeURIComponent(id) + '/tools'); } catch (e) { if (e.status === 502 && e.data?.connection) j = {connection: e.data.connection, tools: null, err: e.message}; else throw e; }
    if (!live()) return;
    const c = j.connection, tools = j.tools || [], onN = tools.filter(t => t.on).length;
    el.innerHTML = `<a href="#settings/connectors" class="bxs-crumb" data-to="#settings/connectors">‹ 커넥터</a>`
      + `<div class="bxs-h"><div data-rename-at><h1>${esc(c.title)}${c.label ? ` <span class="mut">› ${esc(c.label)}</span>` : ''} ${badge(c)}</h1><p>${c.account ? esc(c.account) + ' · ' : ''}${esc(c.host)} · <code>${esc(c.prefix)}__…</code></p></div></div>`
      + (suspect(c) && !j.err && canRecon(c) ? `<div class="bxs-note warn">도구가 하나도 안 읽혀요 — 로그인이 풀렸을 수 있어요. ${btn('다시 연결', 'data-recon', 'sm pri')}</div>` : '')
      + (j.err || (c.status !== 'ok' && c.error) ? `<div class="bxs-note warn">${esc(j.err || c.error)}${c.status === 'expired' ? (c.kind !== 'api' || c.api_oauth && apiReady(c) ? ' ' + btn('다시 연결', 'data-recon', 'sm pri') : apiReady(c) ? ' ' + btn('키 넣기', 'data-rekey', 'sm pri') : '') : ''}</div>` : '')
      + `<div class="bxs-sech">접근</div><div class="bxs-list"><div class="bxs-li"><div><b>읽기만</b><span>에이전트에게 읽는 도구만 보여요</span></div>${sw(c.read_only, 'data-ro', '읽기만')}</div></div>`
      + `<div class="bxs-sech bxs-row between"><span>도구 · ${tools.length}개 중 ${onN}개 켬</span><span class="bxs-row">${c.kind === 'api' ? (!apiReady(c) ? '' : c.api_oauth ? btn('다시 연결', 'data-recon', 'sm ghost') : btn('키 바꾸기', 'data-rekey', 'sm ghost')) : btn('도구 다시 읽기', 'data-refresh', 'sm ghost') + (canRecon(c) ? btn('다시 연결', 'data-recon', 'sm ghost') : '')}${btn('이름 바꾸기', 'data-ren', 'sm ghost')}${btn('끊기', 'data-rm', 'sm ghost danger')}</span></div>`
      + (tools.length ? `<input class="bxs-in" type="search" placeholder="도구 거르기" aria-label="도구 거르기" data-tf><div class="bxs-list" data-tl>${tools.map(t => `<div class="bxs-li" data-tn="${esc(t.name)}"><div><b><code>${esc(t.exposed)}</code></b><span>${t.read_only ? '읽기' : '바꿈'}${t.description ? ' · ' + esc(t.description.split('\n')[0].slice(0, 140)) : ''}</span></div>${sw(t.on, `data-tog="${esc(t.name)}"`, t.name)}</div>`).join('')}</div>` : '<p class="bxs-mut">도구 목록이 없어요 — 「도구 다시 읽기」</p>') + '<div data-hb></div>';
    const off = new Set(tools.filter(t => !t.on).map(t => t.name));
    api('GET', 'api/hooks').then(({hooks}) => { const hb = el.querySelector('[data-hb]'); if (live() && hb) hookBlock(hb, hooks.filter(h => h.service === c.service), c.service); }).catch(() => {});
    let saving = false, dirty = false;
    let roBusy = false, roSaved = !!c.read_only;   // 「읽기만」 저장도 같은 규칙
    const flush = async () => { if (saving){ dirty = true; return; } saving = true; try { do { dirty = false; await api('PATCH', 'api/connections/' + encodeURIComponent(id), {off: [...off]}); } while (dirty); } catch (err) { toast(err.message); saving = false; return render(); } saving = false; };
    el.onclick = async e => {
      const t = e.target;
      try {
        const rs = t.closest('[data-ro]'); if (rs){
          c.read_only = !c.read_only; rs.setAttribute('aria-checked', String(c.read_only));
          if (roBusy) return; roBusy = true;
          let sent = roSaved;
          try {
            for (let i = 0; saving && i < 100; i++) await new Promise(r => setTimeout(r, 100));
            while (sent !== c.read_only){ const v = c.read_only; await api('PATCH', 'api/connections/' + encodeURIComponent(id), {read_only: v}); sent = roSaved = v; }
            toast(sent ? '읽기만 켰어요' : '읽기만 껐어요');
          } catch (err) { c.read_only = roSaved; rs.setAttribute('aria-checked', String(roSaved)); toast('일시적인 오류가 발생했어요'); }
          roBusy = false; return;
        }
        const tg = t.closest('[data-tog]'); if (tg){   // 바로 바꾸고(누른 느낌) 저장 실패면 되돌림 — 저장은 차례대로
          const n = tg.dataset.tog; off.has(n) ? off.delete(n) : off.add(n); tg.setAttribute('aria-checked', String(!off.has(n)));
          el.querySelector('.bxs-sech span').textContent = `도구 · ${tools.length}개 중 ${tools.length - off.size}개 켬`;
          flush(); return;
        }
        if (t.closest('[data-refresh]')){ const b = t.closest('[data-refresh]'); if (b.disabled) return; b.disabled = true; b.innerHTML = spin; const r = await api('POST', `api/connections/${encodeURIComponent(id)}/refresh`); toast(`도구 ${r.tools}개를 다시 읽었어요`); return render(); }
        if (t.closest('[data-ren]')) return rename(c);
        if (t.closest('[data-rekey]')) return rekey(el, c);
        if (t.closest('[data-rkgo]')){
          const key = [...el.querySelectorAll('[data-rk]')].map(i => i.value.trim()).join('\n');
          if (!key.split('\n').every(Boolean)) return toast('키 칸을 다 채워요');
          await connect({service: c.service, reconnect: id, key}, t.closest('[data-rkgo]')); return;
        }
        if (t.closest('[data-rkx]')){ el.querySelector('[data-rkf]').hidden = true; return; }
        if (t.closest('[data-recon]')) return connect({service: c.service, reconnect: id}, t.closest('[data-recon]'));
        if (t.closest('[data-rm]') && await confirmBox(`<b>${esc(c.prefix)}</b> 연결을 끊을까요?`, '끊기')){ await api('DELETE', 'api/connections/' + encodeURIComponent(id)); toast('끊었어요'); return go('#settings/connectors', true); }
      } catch (err) { toast(err.message); }
    };
    if (query().get('rekey') === '1'){ history.replaceState(history.state, '', HBR.hash().split('?')[0]); if (c.kind === 'api' && apiReady(c)) rekey(el, c); }
    el.querySelector('[data-tf]')?.addEventListener('input', e => { const v = e.target.value.toLowerCase(); for (const r of el.querySelectorAll('[data-tn]')) r.hidden = !!v && !r.dataset.tn.toLowerCase().includes(v); });
  }

  const HKIND = {github: 'GitHub', channeltalk: '채널톡', generic: '아무 서비스(Standard Webhooks)'};
  const presetOf = svc => svc === 'github' ? 'github' : svc === 'channeltalk' ? 'channeltalk' : 'generic';
  const hookRow = h => `<div class="bxs-li col" data-h="${esc(h.id)}"><div class="bxs-row between"><div><b>${esc(h.name)}</b> <span class="bxs-badge">${esc(HKIND[h.preset] || h.preset)}</span>${h.target ? ` <span class="bxs-badge">→ ${esc(h.target)}</span>` : ''}</div>${sw(h.enabled, `data-hon="${esc(h.id)}"`, h.name + ' 켜기')}</div>`
    + `<div class="bxs-row"><code class="bxs-url">${esc(h.url)}</code>${btn('주소 복사', `data-hcp="${esc(h.url)}"`, 'sm ghost')}</div><span class="bxs-mut">받음 ${h.count}건${h.last_at ? ' · 마지막 ' + new Date(h.last_at).toLocaleString('ko-KR') : ''}</span>`
    + `<div class="bxs-row">${btn('받은 것', `data-hev="${esc(h.id)}"`, 'sm ghost')}${btn('비밀 다시 만들기', `data-hrot="${esc(h.id)}"`, 'sm ghost')}${btn('지우기', `data-hrm="${esc(h.id)}"`, 'sm ghost danger')}</div><div data-hout="${esc(h.id)}"></div></div>`;
  /** 웹훅 칸 하나: 머리 「웹훅 받기」 + 「+ 웹훅 받기」 + 목록. service 가 있으면 그 서비스에 묶음(보내는 곳은 서비스로 정해짐) */
  function hookBlock(box, hooks, service, open){
    const fixed = service ? presetOf(service) : '';
    box.innerHTML = `<div class="bxs-sech bxs-row between"><span>웹훅 받기 <span class="bxs-mut">— 밖의 일이 창을 깨워요(창에는 정해진 꼴 한 줄만)</span></span>${btn('+ 웹훅 받기', 'data-hnew', 'sm')}</div><div data-hform hidden></div>`
      + (hooks.length ? `<div class="bxs-list">${hooks.map(hookRow).join('')}</div>` : empty({ic: 'hooks', sm: true, t: '받는 주소가 없어요', p: '「+ 웹훅 받기」로 만들면 밖의 일이 창을 깨워요.'}, '<p class="bxs-mut">받는 주소가 없어요</p>'));
    const form = box.querySelector('[data-hform]');
    const openForm = () => { form.hidden = false; form.innerHTML = `<div class="bxs-card"><div class="bxs-row between"><h2>웹훅 받기</h2><button type="button" class="bxs-icon" data-hclose aria-label="닫기">${IC.x}</button></div>`
      + `<label class="bxs-f"><span>이름(영문 소문자 · 숫자 · -)</span><input class="bxs-in" data-hn placeholder="${esc((service || 'hook') + '-events')}" aria-label="이름"></label>`
      + (fixed ? `<input type="hidden" data-hp value="${fixed}">` : `<label class="bxs-f"><span>보내는 곳</span><select class="bxs-in" data-hp aria-label="보내는 곳">${Object.entries(HKIND).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>`)
      + `<label class="bxs-f"><span>깨울 창(선택 — work 창 이름)</span><input class="bxs-in" data-ht placeholder="비우면 쌓아만 둬요" aria-label="깨울 창"></label><div class="bxs-row end">${btn('취소', 'data-hclose', 'ghost')}${btn('만들기', 'data-hgo', 'pri')}</div></div>`; form.querySelector('[data-hn]').focus(); };
    if (open) openForm();
    box.onclick = async e => {
      const t = e.target;
      try {
        if (t.closest('[data-hnew]')) return openForm();
        if (t.closest('[data-hclose]')){ form.hidden = true; return; }
        if (t.closest('[data-hgo]')){ const hb = t.closest('[data-hgo]'); if (hb.disabled) return; hb.disabled = true; setTimeout(() => { hb.disabled = false; }, 3000);
          const r = await api('POST', 'api/hooks', {name: form.querySelector('[data-hn]').value.trim(), preset: form.querySelector('[data-hp]').value, service: service || undefined, target: form.querySelector('[data-ht]').value.trim()});
          form.innerHTML = `<div class="bxs-card"><h2>만들었어요 — 비밀은 지금 한 번만 보여요</h2><div class="bxs-row"><code class="bxs-url">${esc(r.url)}</code>${btn('주소 복사', `data-hcp="${esc(r.url)}"`, 'sm')}</div><div class="bxs-row"><code class="bxs-url">${esc(r.secret)}</code>${btn('비밀 복사', `data-hcs="${esc(r.secret)}"`, 'sm')}</div><div class="bxs-row end">${btn('닫기', 'data-hdone', 'pri')}</div></div>`; return;
        }
        if (t.closest('[data-hdone]')) return render();
        const cp = t.closest('[data-hcp]'); if (cp) return copy(cp.dataset.hcp, '주소를');
        const cs = t.closest('[data-hcs]'); if (cs) return copy(cs.dataset.hcs, '비밀을');
        const onb = t.closest('[data-hon]'); if (onb){ if (onb.disabled) return; onb.disabled = true; setTimeout(() => { onb.disabled = false; }, 1500); const v = onb.getAttribute('aria-checked') !== 'true'; onb.setAttribute('aria-checked', String(v)); try { await api('PATCH', 'api/hooks/' + onb.dataset.hon, {enabled: v}); toast(v ? '켰어요' : '껐어요'); } catch (err) { onb.setAttribute('aria-checked', String(!v)); throw err; } return; }
        const ev = t.closest('[data-hev]'); if (ev){ const out = box.querySelector(`[data-hout="${CSS.escape(ev.dataset.hev)}"]`); out.innerHTML = spin; const {events} = await api('GET', `api/hooks/${ev.dataset.hev}/events`); out.innerHTML = events.length ? `<ul class="bxs-ev">${events.map(x => `<li><span>${new Date(x.at).toLocaleString('ko-KR')}</span> ${esc(x.summary)} <i>${esc(x.delivered || '쌓음')}</i></li>`).join('')}</ul>` : '<p class="bxs-mut">아직 받은 것이 없어요</p>'; return; }
        const rot = t.closest('[data-hrot]'); if (rot && await confirmBox('비밀을 다시 만들까요? 보내는 곳에 새 비밀을 넣기 전까지 받기가 실패해요.', '다시 만들기')){ const r = await api('POST', `api/hooks/${rot.dataset.hrot}/rotate`); box.querySelector(`[data-hout="${CSS.escape(rot.dataset.hrot)}"]`).innerHTML = `<div class="bxs-row"><code class="bxs-url">${esc(r.secret)}</code>${btn('비밀 복사', `data-hcs="${esc(r.secret)}"`, 'sm')}</div><span class="bxs-mut">지금 한 번만 보여요</span>`; return; }
        const rm = t.closest('[data-hrm]'); if (rm && await confirmBox('이 웹훅과 받은 기록을 지울까요?', '지우기')){ await api('DELETE', 'api/hooks/' + rm.dataset.hrm); toast('지웠어요'); return render(); }
      } catch (err) { toast(err.message); }
    };
  }
  // 옛 주소 #settings/hooks → 커넥터 › 웹훅
  PAGES.hooks = async () => go('#settings/connectors/hooks', true);
  async function unboundHooks(el, live){
    const {hooks} = await api('GET', 'api/hooks'); if (!live()) return;
    el.innerHTML = `<a href="#settings/connectors" class="bxs-crumb" data-to="#settings/connectors">‹ 커넥터</a>` + header('웹훅', '어느 서비스에도 안 묶인 받는 주소(아무 서비스 · Standard Webhooks). 서비스에 묶인 웹훅은 그 서비스 화면에 있어요.') + '<div data-hb></div>';
    hookBlock(el.querySelector('[data-hb]'), hooks.filter(h => !h.service), '', query().get('new') === '1');
    if (query().has('new')) history.replaceState(history.state, '', HBR.hash().split('?')[0]);   // 판을 연 뒤 주소에서 뗌
  }

  // ── CLI 프로필(boarder profile 이 올린 표)
  PAGES.profiles = async (el, id, live) => {
    if (OFF.has('cli_profiles')) return go('#settings/connectors', true);
    const {hosts} = await api('GET', 'api/profiles'); if (!live()) return;
    el.innerHTML = header('CLI 프로필', '리포마다 어느 계정의 wrangler · gh 로 돌릴지. 기기에서 <code>boarder profile</code> 로 정하면 여기 보여요(로그인 · 토큰은 안 올라와요).')
      + (hosts.length ? hosts.map(h => `<div class="bxs-sech">${esc(h.host)} <span class="bxs-mut">· ${new Date(h.updated_at).toLocaleString('ko-KR')}</span></div><div class="bxs-list">`
        + h.profiles.map(p => `<div class="bxs-li col"><b>${esc(p.name)}</b>${p.clis.map(c => `<span class="bxs-mut">${esc(c.cli)} — ${esc(c.account)}</span>`).join('')}<span class="bxs-mut">${h.repos.filter(r => r.profile === p.name).map(r => '↳ ' + esc(r.repo)).join('<br>') || '쓰는 리포 없음'}</span></div>`).join('') + '</div>').join('')
        : empty({ic: 'terminal', t: 'CLI 프로필이 아직 없어요', p: '기기에서 프로필을 만들고 리포에 붙여요.', act: `<div class="bxs-row"><code class="bxs-url">boarder profile add work wrangler</code>${btn('복사', 'data-pc="boarder profile add work wrangler"', 'sm ghost')}</div><div class="bxs-row"><code class="bxs-url">boarder profile use work</code>${btn('복사', 'data-pc="boarder profile use work"', 'sm ghost')}</div>`}, `<div class="bxs-empty"><b>아직 없어요</b><p>기기에서 프로필을 만들고 리포에 붙여요.</p><div class="bxs-row"><code class="bxs-url">boarder profile add work wrangler</code>${btn('복사', 'data-pc="boarder profile add work wrangler"', 'sm ghost')}</div><div class="bxs-row"><code class="bxs-url">boarder profile use work</code>${btn('복사', 'data-pc="boarder profile use work"', 'sm ghost')}</div></div>`));
    el.onclick = e => { const c = e.target.closest('[data-pc]'); if (c) copy(c.dataset.pc, '명령을'); };
  };

  // ── 세션(저장한 대화 · 이어 하기)
  PAGES.sessions = async (el, id, live) => {
    if (id){
      const h = await api('GET', `api/sessions/${encodeURIComponent(id)}/handoff`); if (!live()) return;
      el.innerHTML = `<a href="#settings/sessions" class="bxs-crumb" data-to="#settings/sessions">‹ 세션</a><div class="bxs-h"><div><h1>${esc(h.title || h.id)}</h1></div>${h.resume ? btn('다시 여는 명령 복사', `data-rc="${esc(h.resume)}"`, 'sm') : ''}</div>`
        + `<pre class="bxs-pre">${esc(h.header)}</pre><div class="bxs-list">${h.messages.map(m => `<div class="bxs-li col"><span class="bxs-mut">${esc(m.who)} · ${esc(m.at_kst)}</span><div class="bxs-msg">${esc(m.text)}</div></div>`).join('')}</div>`;
      el.onclick = e => { const c = e.target.closest('[data-rc]'); if (c) copy(c.dataset.rc, '명령을'); };
      return;
    }
    let seq = 0;
    const draw = async q => {
      const me = ++seq;
      let sessions; try { ({sessions} = await api('GET', 'api/sessions' + (q ? '?q=' + encodeURIComponent(q) : ''))); } catch (err) { if (me === seq) toast(err.message); return; }
      if (!live() || me !== seq) return;
      el.querySelector('[data-sl]').innerHTML = sessions.length ? sessions.map(s => `<a class="bxs-li" href="#settings/sessions/${encodeURIComponent(s.id)}" data-to="#settings/sessions/${encodeURIComponent(s.id)}"><div><b>${esc(s.title || s.id)}</b><span>${esc(s.tool)} · ${esc(s.win || s.cwd || '')} · 대화 ${s.messages} · ${new Date(s.updated_at).toLocaleString('ko-KR')}</span></div><i class="bxs-chev">${lu('chevron-right', 16)}</i></a>`).join('') : empty({ic: 'sessions', t: q ? '맞는 세션이 없어요' : '저장한 세션이 없어요', p: q ? '제목 · 폴더 · 창 이름을 바꿔 찾아 보세요.' : 'AI 창에서 boarder session save 로 저장하면 여기 모여요.'}, '<p class="bxs-mut">저장한 세션이 없어요 — 창에서 <code>boarder session save</code></p>');
    };
    let sync = true; try { ({on: sync} = await api('GET', 'api/me/session-sync')); } catch {} if (!live()) return;
    const syncCard = () => `<div class="bxs-card"><div class="bxs-row between"><div><b>세션 싱크</b><p class="bxs-mut">${sync ? '기기 · AI 창의 대화를 여기로 올려요' : '꺼 두면 새 대화를 올리지 않아요 — 저장한 세션은 그대로'}</p></div>${sw(sync, 'data-ssync', '세션 싱크')}</div></div>`;
    el.innerHTML = header('세션', 'AI 창의 대화를 저장해 두고 다른 창 · 기기에서 이어 가요(사람 · 에이전트 글만, 비밀 가림).') + `<div data-sc>${syncCard()}</div><input class="bxs-in" type="search" placeholder="제목 · 폴더 · 창 이름" aria-label="세션 찾기" data-sq><div class="bxs-list" data-sl>${spin}</div>`;
    let t; el.querySelector('[data-sq]').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => draw(e.target.value.trim()), 250); });
    // 세션 싱크 켬 · 끔: 서버(user_pref)에 저장 — 끄면 그 계정의 올리기가 다 멈춤. 누르는 순간 바꾸고, 실패면 되돌림
    el.onclick = async e => {
      const b = e.target.closest('[data-ssync]'); if (!b || b.disabled) return;
      const v = !sync; b.disabled = true; b.setAttribute('aria-checked', String(v));
      try { ({on: sync} = await api('POST', 'api/me/session-sync', {on: v})); toast(sync ? '세션 싱크를 켰어요' : '세션 싱크를 껐어요'); } catch (err) { toast(err.message); }
      if (live()) el.querySelector('[data-sc]').innerHTML = syncCard();
    };
    await draw('');
  };

  // ── 설치 프롬프트 · 프로필 · 초대
  PAGES.install = async (el, id, live) => {
    return go('#settings/connectors', true);
    const r = await fetch('api/install/prompt', {credentials: 'include'}); const text = r.ok ? await r.text() : ''; if (!live()) return;
    el.innerHTML = header('설치 프롬프트', '이 글을 AI 도구(Claude Code · Codex · Cursor · Gemini CLI)에 붙여넣으면 보더를 깔고 이 계정에 연결해요.', btn('복사', 'data-ip', 'pri')) + `<pre class="bxs-pre">${esc(text || '불러오지 못했어요')}</pre>`;
    el.onclick = e => { if (e.target.closest('[data-ip]')) copy(text, '설치 프롬프트를'); };
  };
  PAGES.profile = async (el, id, live) => {
    const me = await api('GET', 'api/me'); if (!live()) return;
    const owner = !!me.user?.owner;
    const [bot, mine] = !window.BXBot ? [null, null] : owner
      ? [(await api('GET', 'api/me/bot').catch(() => ({}))).bot || {seed: 'Owner', hue: 140, name: 'Owner'}, null]
      : await Promise.all([api('GET', 'api/me/bot').then(j => j.bot).catch(() => window.BX_BOT || null), api('GET', 'api/me/avatar').then(j => j.avatar).catch(() => null)]);
    if (!live()) return;
    const myName = window.HB_MEMBER?.name || me.user?.name || String(me.user?.email || '').split('@')[0];
    const card = k => `<div class="bxs-card"><div data-bp="${k}"></div></div>`;
    el.innerHTML = header('프로필')
      + (!owner && window.BXBot ? `<div class="bxs-sech">내 아바타</div>${card('me')}` : '')
      + (bot ? `<div class="bxs-sech">${owner ? '내 아바타' : '메인 봇'}</div>${card('bot')}` : '')
      + (bot || (!owner && window.BXBot) ? '<div class="bxs-sech">계정</div>' : '') + `<div class="bxs-list"><div class="bxs-li"><div><b>메일</b><span>${esc(me.user?.email || '')}</span></div></div><div class="bxs-li"><div><b>로그아웃</b><span>이 브라우저에서 나가요</span></div>${btn('로그아웃', 'data-out', 'sm ghost danger')}</div></div>`;
    const wire = (bpEl, P, store, done, fields) => {
      let saved = P.get(), busy = false, want = null;
      const commit = async k => {
        if (k === 'name' && !P.valid()){ toast('이름을 적어요'); return P.set({name: saved.name}); }
        want = k; if (busy) return; busy = true;
        while (want){
          const w = want; want = null; const v = P.get();
          if (fields.every(f => v[f] === saved[f])) continue;
          try {
            const b = await store(v);
            saved = {...v, photo: b.photo ? `/_blob/${b.photo}.png` : '', photoId: b.photo || ''};
            if (b.photo && P.get().photo === v.photo) P.set({photo: saved.photo, photoId: b.photo});   // 같은 사진을 다시 올리지 않게
            done(b); P.ok(w);
          } catch { want = null; P.set(saved); toast('일시적인 오류가 발생했어요'); }
        }
        busy = false;
      };
      bpEl.addEventListener('bxb-pick', e => commit(e.detail));
    };
    const meEl = el.querySelector('[data-bp="me"]');
    if (meEl){   // 회원 내 아바타: 이름은 계정 이름 그대로(칸 없음), 처음엔 이름에서 정한 얼굴
      const init = mine || {seed: 'bean', hue: 140};
      const P = BXBot.mount(meEl, {...init, name: myName, photoId: init.photo}, {caption: '사이드바 아래 · 내 글 줄 아바타가 이 그림이 돼요', noName: true});
      wire(meEl, P, v => BXBot.saveFace(v, '/api/me/avatar').then(j => j.avatar), a => {
        window.BX_ME = {seed: a.seed, hue: a.hue, name: myName, photo: a.photo || ''}; window.dispatchEvent(new CustomEvent('bx-me'));   // 사이드바 아래 · 글 줄 바로
      }, ['seed', 'hue', 'photo']);
    }
    const bpEl = el.querySelector('[data-bp="bot"]');
    if (bpEl){
      const P = BXBot.mount(bpEl, {...bot, photoId: bot.photo}, owner ? {caption: '사이드바 아래 · 글 줄 아바타가 이 그림이 돼요', hint: '사이드바 아래 · 글 줄에 보이는 이름'} : {});
      wire(bpEl, P, v => BXBot.save(v), b => {
        window.BX_BOT = b;
        if (owner){ window.BX_ME = {seed: b.seed, hue: b.hue, name: b.name, photo: b.photo, icon: b.icon}; try { localStorage.setItem('bx-me', JSON.stringify(window.BX_ME)); } catch {} window.dispatchEvent(new CustomEvent('bx-me')); }   // 사이드바 아래 · 글 줄 바로
        else { applyAccent(); document.querySelectorAll('link[rel="icon"]').forEach(l => { l.href = `/_blob/${b.fav}.png`; }); const hi = document.querySelector('#hello img'); if (hi) hi.src = `/_blob/${b.fav}.png`; }   // 회원: 파비콘 · 인사 그림(왼쪽 위 로고 · 홈 화면 아이콘은 다음에 열 때)
      }, ['seed', 'hue', 'name', 'photo']);
    }
    el.onclick = async e => {
      if (e.target.closest('[data-out]') && await confirmBox('로그아웃할까요?', '로그아웃')){ await window.bxPushOff?.(); await fetch('api/auth/sign-out', {method: 'POST', credentials: 'include', headers: {'content-type': 'application/json', 'x-hb': '1'}, body: '{}'}); location.href = '/'; } };
  };
  const ago = t => { if (!t) return '보낸 적 없음'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
  const kst = s => { if (!s) return '—'; const d = new Date(s), t = d.toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit', hour12: false}); return new Date().toDateString() === d.toDateString() ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`; };
  const gb = mb => mb == null ? '?' : (mb / 1024).toFixed(1) + ' GB';
  const bar = (pct, cls = '', mark) => `<div class="bxs-bar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i>${mark != null ? `<b style="left:${mark}%"></b>` : ''}</div>`;
  const tile = (label, big, small, b = '') => `<div class="bxs-tile"><span>${label}</span><b>${big}</b>${b}<span>${small}</span></div>`;
  const spark = (pts, min) => {
    const v = pts.map(p => p.mem_avail_mb).filter(x => x != null); if (v.length < 2) return '';
    const hi = Math.max(...v, min) * 1.1, w = 640, h = 28, y = x => (h - x / hi * h).toFixed(1);
    const d = pts.filter(p => p.mem_avail_mb != null).map((p, i, a) => `${(i / (a.length - 1) * w).toFixed(1)},${y(p.mem_avail_mb)}`).join(' L');
    return `<div class="bxs-trend"><div class="bxs-row between"><span>가용 메모리 24시간</span><span>점선 = ${gb(min)}(새 창 안 엶)</span></div><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${w}" y1="${y(min)}" y2="${y(min)}" class="ref"/><path d="M${d}"/></svg></div>`;
  };
  const acct = a => {
    const cell = (name, p, r) => { if (p == null) return `<div class="bxs-q"><div class="bxs-row between"><span>${name}</span><span>?</span></div></div>`; const left = Math.round(100 - p), c = left <= 10 ? 'bad' : left <= 25 ? 'warn' : 'ok';
      return `<div class="bxs-q"><div class="bxs-row between"><span>${name}</span><b class="${c}">${left}% 남음</b></div>${bar(left, c)}<span>리셋 ${esc(kst(r))}</span></div>`; };
    const st = {ok: '', token_stale: '<span class="bxs-badge warn">토큰 지남 · 마지막 값</span>', logged_out: '<span class="bxs-badge bad">로그아웃</span>', error: '<span class="bxs-badge warn">못 읽음</span>', unknown: '<span class="bxs-badge">모름</span>'}[a.status] || '';
    const out = a.out_at && (!a.r7 || Date.parse(a.out_at) < Date.parse(a.r7)) && Date.parse(a.out_at) > Date.now() ? `바닥 예상 ${kst(a.out_at)}` : '';
    const cr = a.credits && a.credits.limit != null ? `클라우드 크레딧 $${Math.round(a.credits.left ?? 0)} / $${Math.round(a.credits.limit)}${a.credits.expires ? ` · ${kst(a.credits.expires)} 만료` : ''}` : '';
    const sub = [a.rate != null && Math.round(a.rate * 24) > 0 ? `주간 하루 +${Math.round(a.rate * 24)}%` : '', out, cr, a.acct ? a.email || '' : ''].filter(Boolean).map(esc).join(' · ');
    const name = a.acct ? `${a.acct} · ${a.name || ''}` : (a.email || '메일 모름');
    return `<div class="bxs-acct"><div class="bxs-q"><div class="em"><b>${esc(name)}</b>${st}</div>${sub ? `<span>${sub}</span>` : ''}</div>${cell('5시간', a.p5, a.r5)}${cell('주간', a.p7, a.r7)}</div>`;
  };
  const qcell = (name, p, r) => { if (p == null) return '<div class="bxs-q"></div>'; const left = Math.round(100 - p), c = left <= 10 ? 'bad' : left <= 25 ? 'warn' : 'ok';
    return `<div class="bxs-q"><div class="bxs-row between"><span>${name}</span><b class="${c}">${left}% 남음</b></div>${bar(left, c)}<span>리셋 ${esc(kst(r))}</span></div>`; };
  const codexRow = x => { const sub = [x.balance != null ? `크레딧 잔액 ${Math.round(x.balance).toLocaleString('ko-KR')}` : '', x.at ? `기록 ${kst(x.at)}` : ''].filter(Boolean).map(esc).join(' · ');
    return `<div class="bxs-acct"><div class="bxs-q"><div class="em"><b>Codex${x.plan ? ' · ' + esc(x.plan) : ''}</b></div>${sub ? `<span>${sub}</span>` : ''}</div>${qcell('5시간', x.p5, x.r5)}${qcell('주간', x.p7, x.r7)}</div>`; };
  const deviceCard = d => {
    const m = d.metrics || {}, mem = m.mem || {}, cpu = m.cpu || {}, disk = m.disk || {}, ag = m.agents || {}, host = m.host || {};
    const quiet = !d.metrics_at || Date.now() - d.metrics_at > 15 * 60000;
    if (d.scope === 'harness'){ const on = d.engine_at && Date.now() - d.engine_at < 5 * 60000;
      return `<div class="bxs-dev"><div class="bxs-dh"><div class="ic">${IC.devices}</div><div class="t"><div class="bxs-row"><b>${esc(d.name || '하네스')}</b><span class="bxs-badge">엔진</span></div><span>${esc(d.engine_at ? '엔진 ' + ago(d.engine_at) : '엔진이 붙은 적 없음')}</span></div>`
        + `<span class="bxs-badge"><i class="${on ? 'ok' : ''}"></i>${on ? '연결됨' : '끊김'}</span><button type="button" class="bxs-more" data-dm="${esc(d.id)}" aria-label="${esc(d.name || '기기')} 메뉴" aria-haspopup="menu">${IC.more}</button></div>`
        + `<p class="bxs-mut pad">보더가 이 서버의 창을 열고 넣는 길이에요. 메모리 · CPU · 계정 한도는 같은 서버의 감시 기기가 보내요.</p></div>`; }
    const n = Object.values(ag).reduce((a, b) => a + b, 0), agTxt = Object.entries(ag).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음';
    const memPct = mem.total_mb ? mem.avail_mb / mem.total_mb * 100 : 0, low = mem.avail_mb != null && mem.min_mb != null && mem.avail_mb < mem.min_mb;
    const os = {linux: 'Linux', darwin: 'macOS', win32: 'Windows'}[host.os] || host.os || '';
    const head = `<div class="bxs-dh"><div class="ic">${IC.devices}</div><div class="t"><div class="bxs-row"><b>${esc(d.name || host.name || '기기')}</b>${d.scope === 'watch' ? '<span class="bxs-badge">감시만</span>' : ''}</div>`
      + `<span>${[os, cpu.cores ? cpu.cores + '코어' : '', ago(d.metrics_at)].filter(Boolean).map(esc).join(' · ')}</span></div>`
      + `<span class="bxs-badge"><i class="${quiet ? '' : 'ok'}"></i>${quiet ? (d.metrics_at ? '조용' : '아직 안 보냄') : '보내는 중'}</span><button type="button" class="bxs-more" data-dm="${esc(d.id)}" aria-label="${esc(d.name || '기기')} 메뉴" aria-haspopup="menu">${IC.more}</button></div>`;
    if (!d.metrics) return `<div class="bxs-dev">${head}<p class="bxs-mut pad">그 기기에서 <code>boarder watch --once</code> 를 돌리면 값이 떠요.</p></div>`;
    const tiles = tile('가용 메모리', gb(mem.avail_mb), `${gb(mem.total_mb)} 중 · 기준 ${gb(mem.min_mb)}`, bar(memPct, low ? 'bad' : 'blue', mem.total_mb && mem.min_mb ? mem.min_mb / mem.total_mb * 100 : null))
      + tile('CPU', cpu.pct != null ? Math.round(cpu.pct) + '%' : '?', `load ${cpu.load1 ?? '?'}${cpu.cores ? ' · ' + cpu.cores + '코어' : ''}`, bar(cpu.pct))
      + tile('디스크 /', disk.pct != null ? disk.pct + '%' : '?', `${disk.free_gb ?? '?'} GB 남음${m.tmp?.pct != null ? ' · /tmp ' + m.tmp.pct + '%' : ''}`, bar(disk.pct, disk.pct >= 90 ? 'bad' : '', 90))
      + tile('도는 에이전트', String(n), esc(agTxt));
    const accts = (m.accounts || []).slice().sort((x, y) => String(x.acct || '~').localeCompare(String(y.acct || '~')));
    return `<div class="bxs-dev">${head}<div class="bxs-tiles">${tiles}</div>${spark(d.history || [], mem.min_mb || 6144)}`
      + (accts.length ? `<div class="bxs-acs"><div class="h">Claude 계정 ${accts.length}</div>${accts.map(acct).join('')}</div>` : '')
      + (m.codex ? `<div class="bxs-acs"><div class="h">Codex</div>${codexRow(m.codex)}</div>` : '') + '</div>';
  };
  const NRULES = [['check_min', '점검 주기', '이 간격마다 노드 대화 · 일감을 다시 봐요', '분'], ['split_at', '나누기 기준', '열린 일감이 이만큼이면 나누기 · 보내기 · 합치기', '개 이상'],
    ['move_h', '옮기기 간격', '한 노드에서 나누기 · 합치기는 이 간격에 한 번', '시간'], ['rename_h', '이름 바꾸기 간격', '한 노드 이름은 이 간격에 한 번', '시간']];
  const ARCH_H = [1, 3, 6, 12, 24, 48, 72, 168];
  const hrs = h => h % 24 ? `${h}시간` : `${h / 24}일`;
  const ROLE_F = [['name', '이름', 40, '이름은'], ['brief', '목표', 200, '목표는'], ['instructions', '지시', 3000, '지시는'], ['perms', '권한', 1000, '권한은'], ['supervise', '보고 라인', 1000, '보고 라인은']];
  const ROLE_AREA = {instructions: 8, perms: 3, supervise: 3}, ROLE_HINT = {perms: '쓸 수 있는 도구 · 커넥터, 하면 안 되는 것', supervise: '누구에게 보고하는지 · 누가 리뷰하는지 · 언제 사람에게 올리는지'};
  const ROLE_WST = {busy: '일함', background: '뒤에서 일함', idle: '쉼', waiting: '기다림', parked: '주차', opening: '여는 참', starting: '여는 참', failed: '멈춤'};
  const roleWins = (ws, pending) => { if (!ws?.length) return pending ? '기기에서 엔진을 켜면 창이 열려요' : '붙은 창 없음'; const n = {}; for (const w of ws){ const k = ROLE_WST[w.state] || '그 밖'; n[k] = (n[k] || 0) + 1; } return `창 ${ws.length}곳 · ` + Object.entries(n).map(([k, c]) => `${k} ${c}`).join(' · '); };
  const roleNow = ws => { let best = null;
    for (const w of ws || []){ const t = w.watch || (w.last ? `${w.last.kind} · ${w.last.text}` : ''), at = Number(w.last?.at) || 0; if (t && (!best || at > best.at)) best = {at, t, st: ROLE_WST[w.state] || ''}; }
    return best ? `지금 · ${best.st ? best.st + ' — ' : ''}${best.t}` : ''; };
  // 바뀐 칸만(서버와 같이 앞뒤 공백을 떼고 견줌)
  const roleDiff = (r, v) => { const d = {}; for (const [k] of ROLE_F){ const t = String(v[k] ?? r[k] ?? '').trim(); if (t !== String(r[k] ?? '').trim()) d[k] = t; } return d; };
  // 「-」 시작: 이름 · 목표 · 지시는 서버가 거절(CLI 인자로 넘어감), 권한 · 보고 라인은 목록 꼴(- 읽기만)이라 받음
  const ROLE_NODASH = ['name', 'brief', 'instructions'];
  const roleBad = d => { if ('name' in d && !d.name) return '이름을 넣어 주세요'; if ('instructions' in d && !d.instructions) return '지시를 넣어 주세요';
    for (const [k, , max, lbl] of ROLE_F) if (k in d && d[k].length > max) return `${lbl} ${max}자까지예요(지금 ${d[k].length}자)`;
    for (const [k, , , lbl] of ROLE_F) if (ROLE_NODASH.includes(k) && k in d && d[k].startsWith('-')) return `${lbl} -로 시작할 수 없어요`; return ''; };
  const roleDone = dl => { const n = s => dl.filter(d => d.state === s).length, a = n('sent'), q = n('queued'), f = n('failed');
    if (!dl.length) return '저장했어요 · 열린 창이 없어 다음에 창을 열 때 새 지시로 시작해요';
    return [a && `${a}곳에 바로 넣었어요`, q && `${q}곳은 줄 서 있어요`, f && `${f}곳은 못 넣었어요(다음에 다시 열 때 새 지시로)`].filter(Boolean).map((t, i) => i ? t : '열린 창 ' + t).join(' · '); };
  // 저장 한 번: 고칠 칸이 없거나 넘치면 보내지 않음. 서버 4xx 글은 api() 가 한 줄로 바꾼 그대로
  async function roleSave(call, r, v){
    const d = roleDiff(r, v); if (!Object.keys(d).length) return {ok: null, line: '바뀐 칸이 없어요'};
    const bad = roleBad(d); if (bad) return {ok: false, line: bad};
    try { const j = await call('POST', 'api/me/roles/' + encodeURIComponent(r.id), d); return {ok: true, sent: d, line: roleDone(j.delivery || [])}; }
    catch (e) { return {ok: false, line: e.message || '일시적인 오류가 발생했어요'}; }
  }
  // 새 역할 한 번: 이름 · 지시는 꼭, 나머지는 쓴 칸만. 서버가 창을 열었는지(엔진이 꺼져 있으면 pending) 한 줄
  async function roleCreate(call, v){
    const d = {}; for (const [k] of ROLE_F){ const t = String(v[k] ?? '').trim(); if (t || k === 'name' || k === 'instructions') d[k] = t; }
    const bad = roleBad(d); if (bad) return {ok: false, line: bad};
    try { const j = await call('POST', 'api/me/roles', d); return {ok: true, id: j.role_id, line: j.pending ? `${d.name} 역할을 만들었어요 · 기기에서 엔진을 켜면 창이 열려요` : `${d.name} 역할을 만들고 창을 열었어요`}; }
    catch (e) { return {ok: false, line: e.message || '일시적인 오류가 발생했어요'}; }
  }
  const roleField = (k, lbl, max, v, area) => { const val = String(v ?? ''), n = val.trim().length;
    return `<label style="display:flex;flex-direction:column;gap:6px"><span class="bxs-row between"><span class="bxs-mut">${lbl}</span><span class="bxs-mut${n > max ? ' bad' : ''}" data-rlc="${k}">${n}/${max}</span></span>`
      + (area ? `<textarea class="bxs-in" rows="${area}" data-rlf="${k}" aria-label="${esc(lbl)}"${ROLE_HINT[k] ? ` placeholder="${esc(ROLE_HINT[k])}"` : ''}>${esc(val)}</textarea>` : `<input class="bxs-in" data-rlf="${k}" value="${esc(val)}" aria-label="${esc(lbl)}">`) + '</label>'; };
  const roleForm = (v, m, busy, attr, label) => '<div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">'
    + ROLE_F.map(([k, lbl, max]) => roleField(k, lbl, max, v[k], ROLE_AREA[k])).join('')
    + `<div class="bxs-row between" style="flex-wrap:nowrap"><p class="bxs-mut${m?.bad ? ' bad' : ''}" data-rlm role="status" style="min-width:0;overflow-wrap:anywhere">${m ? esc(m.t) : ''}</p>`
    + btn(busy ? '<i class="g g-spin" aria-hidden="true"></i>' : label, `${attr}${busy ? ` disabled aria-busy="true" aria-label="${label}"` : ''}`, 'pri') + '</div></div>';
  // st = {open: 펼친 역할 id, busy: 저장 중인 역할 id, msg: {id: {t, bad}}, vals: {id: {칸: 고친 값}}, add: {open, busy, vals, msg}}, engine = 엔진을 쓰는 회원
  const roleHtml = (roles, st, engine) => { const rs = roles || [], ad = st.add || {}; if (!rs.length && !engine) return '';
    const head = !engine ? '<div class="bxs-sech">역할</div>'
      : `<div class="bxs-sech bxs-row between"><span>역할</span>${btn(ad.open ? '닫기' : '새 역할', `data-rla aria-expanded="${!!ad.open}"`, 'sm')}</div>`;
    const add = !engine ? '' : ad.open ? `<div data-rlnew${rs.length ? ' style="border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:12px"' : ''}><b>새 역할</b>${roleForm(ad.vals || {}, ad.msg, ad.busy, 'data-rlk', '만들기')}</div>`
      : ad.msg ? `<p class="bxs-mut${ad.msg.bad ? ' bad' : ''}" data-rlam role="status" style="margin:0 0 12px">${esc(ad.msg.t)}</p>` : '';
    const empty = engine && !rs.length && !ad.open ? '<p class="bxs-mut" style="margin:0">역할이 아직 없어요. 새 역할을 만들면 그 일을 맡을 창이 열려요.</p>' : '';
    return head + '<div class="bxs-card" data-rl>' + add + empty + rs.map((r, i) => {
    const open = st.open === r.id, busy = st.busy === r.id, v = {...r, ...(st.vals[r.id] || {})}, m = st.msg[r.id], now = roleNow(r.windows);
    return `<div data-rli="${esc(r.id)}"${i ? ' style="border-top:1px solid var(--line);padding-top:12px"' : ''}>`
      + `<div class="bxs-row between" style="flex-wrap:nowrap;cursor:pointer" data-rlo="${esc(r.id)}"><div style="min-width:0;overflow-wrap:anywhere"><b>${esc(r.name)}</b>`
      + `<p class="bxs-mut" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.brief || '설명 없음')}</p><p class="bxs-mut">${esc(roleWins(r.windows, r.pending))}</p>`
      + (now ? `<p class="bxs-mut" data-rlnow style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(now)}</p>` : '') + '</div>'
      + btn(open ? '닫기' : '고치기', `aria-expanded="${open}" aria-label="${esc(r.name)} ${open ? '닫기' : '고치기'}"`, 'sm ghost') + '</div>'
      + (!open ? '' : roleForm(v, m, busy, `data-rls="${esc(r.id)}"`, '저장'))
      + '</div>';
  }).join('') + '</div>'; };
  function roleMount(box, roles, engine){
    const st = {open: null, busy: null, msg: {}, vals: {}, add: {open: false, busy: false, vals: {}, msg: null}}, draw = () => { box.innerHTML = roleHtml(roles, st, engine); };
    const reload = async () => { try { const j = await api('GET', 'api/me/roles'); if (Array.isArray(j.roles)) roles.splice(0, roles.length, ...j.roles); return true; } catch { return false; } };   // 서버가 비밀 꼴을 가린 값 그대로
    box.oninput = e => {   // 고친 값은 상태에(페이지가 다시 그려도 남게), 글자 수는 그 자리에서
      const f = e.target.closest('[data-rlf]'), nw = f?.closest('[data-rlnew]'), id = nw ? null : f?.closest('[data-rli]')?.dataset.rli; if (!f || (!nw && !id)) return;
      const k = f.dataset.rlf, max = ROLE_F.find(x => x[0] === k)[2], n = f.value.trim().length; (nw ? st.add.vals : (st.vals[id] ||= {}))[k] = f.value;
      const c = f.closest('label')?.querySelector('[data-rlc]'); if (c){ c.textContent = `${n}/${max}`; c.classList.toggle('bad', n > max); }
    };
    box.onclick = async e => {
      if (e.target.closest('[data-rla]')){ st.add.open = !st.add.open; st.add.msg = null; return draw(); }
      if (e.target.closest('[data-rlk]')){
        if (st.add.busy) return; st.add.busy = true; st.add.msg = null; draw();
        const res = await roleCreate(api, st.add.vals);
        if (res.ok){ await reload(); st.add = {open: false, busy: false, vals: {}, msg: {t: res.line, bad: false}}; }
        else { st.add.busy = false; st.add.msg = {t: res.line, bad: true}; }
        return draw();
      }
      const o = e.target.closest('[data-rlo]'); if (o){ st.open = st.open === o.dataset.rlo ? null : o.dataset.rlo; return draw(); }
      const sv = e.target.closest('[data-rls]'), r = sv && !st.busy && roles.find(x => x.id === sv.dataset.rls); if (!r) return;
      st.busy = r.id; delete st.msg[r.id]; draw();
      const res = await roleSave(api, r, st.vals[r.id] || {});
      if (res.ok){ delete st.vals[r.id]; if (!(await reload())) Object.assign(r, res.sent); }
      st.busy = null; st.msg[r.id] = {t: res.line, bad: res.ok === false}; draw();
    };
    draw();
  }
  PAGES.nodes = async (el, id, live) => {
    // 역할 목록은 회원만(주인은 서버가 403) — 노드 설정 · 얼굴과 같이 받아 첫 그림에 넣음, 못 받으면 카드 없음
    const rolesP = OWNER ? Promise.resolve(null) : api('GET', 'api/me/roles').catch(() => null);   // { roles, engine } — engine = 엔진을 쓰는 회원(「새 역할」)
    let j = await api('GET', 'api/me/nodeset'), more = false; if (!live()) return;
    const AF = () => window.HBAgentFaces || window.parent?.HBAgentFaces, AFS = (k, f) => (window.HBAgentFaceSet || window.parent?.HBAgentFaceSet)?.(k, f);
    let faces = !window.BXBot ? null : OWNER ? (AF()?.() || null) : await api('GET', 'api/me/nodes/avatar').then(r => r.nodes).catch(() => null), openFace = null, openName = null; if (!live()) return;
    const rj = await rolesP, roles = Array.isArray(rj?.roles) ? rj.roles : [], roleOn = roles.length > 0 || rj?.engine === true, roleBox = mk('div'); if (!live()) return;
    if (roleOn) roleMount(roleBox, roles, rj?.engine === true);   // 역할 칸은 따로 그림 — 스위치를 눌러 페이지를 다시 그려도 쓰던 글이 남게 같은 상자를 다시 끼움
    const faceSm = f => !f ? '' : f.photo ? `<img src="/_blob/${esc(f.photo)}.png" alt="">` : BXBot.svg(f.seed, f.hue, 32, true);
    const faceRow = x => `<div class="bxs-li"><div class="bxs-row" style="flex-wrap:nowrap;gap:12px"><i class="bxs-face" aria-hidden="true">${faceSm(x.avatar)}</i><div><b>${esc(x.name)}</b><span>${x.head ? `${esc(x.column)} 열 머리` : OWNER ? '에이전트' : '노드'} · ${x.custom ? '고른 얼굴' : '기본 얼굴'}</span></div></div>`
      + `<div class="bxs-row" style="flex-wrap:nowrap">${x.node && !String(x.node).startsWith('ew_') ? btn(openName === x.pane ? '취소' : '이름', `data-nno="${esc(x.pane)}" aria-expanded="${openName === x.pane}"`, 'sm ghost') : ''}${x.custom ? btn('기본으로', `data-nfr="${esc(x.pane)}"`, 'sm ghost') : ''}${btn(openFace === x.pane ? '닫기' : '바꾸기', `data-nfo="${esc(x.pane)}" aria-expanded="${openFace === x.pane}"`, 'sm ghost')}</div></div>`
      + (openName === x.pane ? `<div class="bxs-li"><div class="bxs-row" style="flex-wrap:nowrap;gap:8px;width:100%"><input class="bxs-in" data-nnm="${esc(x.pane)}" maxlength="60" value="${esc(x.name)}" aria-label="채널 이름" style="flex:1;min-width:0">${btn('저장', `data-nns="${esc(x.pane)}"`, 'sm')}</div></div>` : '')
      + (openFace === x.pane ? `<div class="bxs-li col"><div data-nfp="${esc(x.pane)}"></div></div>` : '');
    const faceSec = () => !faces ? '' : `<div class="bxs-sech">얼굴</div>` + (faces.length ? `<div class="bxs-list">${faces.map(faceRow).join('')}</div>`
      : empty({ic: 'node', sm: true, t: '얼굴을 고를 노드가 없어요', p: '노드가 생기면 트리 열 머리 · 노드마다 얼굴을 고를 수 있어요.'}, '<p class="bxs-mut">얼굴을 고를 노드가 없어요</p>'));
    const facePick = () => {   // 연 노드의 고르기 판: 고르는 순간 저장(프로필과 같은 규칙), 실패면 되돌리고 한 줄 오류
      const box = openFace && el.querySelector(`[data-nfp="${CSS.escape(openFace)}"]`), x = box && faces.find(f => f.pane === openFace); if (!x) return;
      const P = BXBot.mount(box, {...x.avatar, name: x.name, photoId: x.avatar.photo}, {caption: x.head ? '트리 열 머리 얼굴이 이 그림이 돼요' : OWNER ? '이 에이전트 얼굴이 사이드바 · 글 옆 · 트리에서 이 그림이 돼요' : '이 노드 얼굴이 이 그림이 돼요', noName: true});
      let busy = false, again = false;
      box.addEventListener('bxb-pick', async e => {
        if (busy){ again = true; return; } busy = true;
        do { again = false; const v = P.get();
          try { const r = OWNER ? await BXBot.saveFace(v, '/api/me/agent-faces', {key: x.pane}) : await BXBot.saveFace(v, '/api/me/nodes/avatar', {node: x.pane}); x.avatar = r.avatar; x.custom = true; if (OWNER) AFS(x.pane, r.avatar);
            if (r.avatar.photo && P.get().photo === v.photo) P.set({photo: `/_blob/${r.avatar.photo}.png`, photoId: r.avatar.photo}); P.ok(e.detail);
            const row = box.closest('.bxs-li')?.previousElementSibling; if (row) row.outerHTML = faceRow(x).split('<div class="bxs-li col">')[0];
          } catch { P.set({...x.avatar, photo: x.avatar.photo ? `/_blob/${x.avatar.photo}.png` : '', photoId: x.avatar.photo || ''}); toast('일시적인 오류가 발생했어요'); again = false; }
        } while (again);
        busy = false;
      });
    };
    const num = ([k, n, d, u]) => `<div class="bxs-li"><div><b>${n}</b><span>${d}</span></div><label class="bxs-num"><input class="bxs-in sm" type="number" inputmode="numeric" min="${j.limits[k][0]}" max="${j.limits[k][1]}" value="${j.values[k]}" data-nk="${k}" aria-label="${esc(n)}"><span>${u}</span></label></div>`;
    const BUN_KO = {board: ['판', '채널 · 스레드 · 노드 · 캔버스'], 'work-tools': ['창 관리 명령', 'work · wlog · waitfor · pane · park'], guards: ['안전 훅', '묻기 · 언어 · Chrome 지킴이'], skills: ['스킬', '쓰던 스킬 묶음'], rules: ['규칙 템플릿', '호칭 · 영역 · 한도는 내 값으로'], timers: ['감시 타이머', '핵심만'], 'phone-alert': ['폰 알림', '급한 것만 폰으로 — 사람 몸에 닿아 꺼진 채 시작'], 'external-send': ['바깥 발송', '메일 · 메시지 — 초안 승인 뒤에만, 꺼진 채 시작'], 'account-autoswitch': ['계정 자동 넘김', '한도 차면 다른 계정으로 — 꺼진 채 시작'], 'priority-file': ['우선순위 한 파일', '급한 일 · 목표일 · 완료 조건'], 'switch-confirm': ['계정 넘김 뒤 확인창 통과', ''], 'input-log': ['입력 · 정정 기록', ''], 'one-memory': ['기억 하나로', '대화 전부 보더에'], 'signals-first': ['신호 먼저', '메일 · 사용 패턴 · DB 부하'], 'qa-evidence': ['QA 캔버스 증거', '전 · 후 캡처 · 영상'], 'kickoff': ['큰 일 킥오프', '멘탈 모델 · 완료 조건 먼저'], 'company-assistant': ['/es 회사 비서', ''], 'session-panel': ['세션 칸', ''], 'personal-assistant': ['/ea 퍼스널 비서', ''], experimental: ['실험 묶음', '아직 진행 중인 줄들']};
    const RULE_KO = {one_goal: ['창 하나 = 목표 하나', '같은 목표의 다른 요청은 새 창이 아니라 그 창 안에서'], report: ['보드에 보고', '시작 · 일하는 동안(30분에 한 번 이상) · 막힘 · 끝'],
      park: ['끝나면 저장하고 주차', '끝났거나 남의 답만 기다리면 대화를 저장하고 창을 닫아요 — 조건이 차면 다시 열어요'], ask: ['묻는 글 꼴', '첫 줄에 정할 것, 그다음 고를 것(추천 먼저), 쉬운 말로'], outside: ['바깥에 보내기 전 허락', '메일 · 메시지처럼 바깥에 가는 글은 초안을 보이고 허락 뒤에만']};
    const PARK_HS = [1, 2, 3, 6, 12, 24, 48, 72, 168];
    const primLabel = k => k === 'auto' ? '자동 — 이름이 primary · main · 메인인 창(보더 메인 봇이 떠 있으면 그것)' : k === 'none' ? '보더 메인 봇' : (() => { const w = (j.windows || []).find(x => x.key === k); return w ? `${w.title} · ${w.device || '기기'} · ${w.engine === 'herdr-own' ? 'Herdr' : 'tmux'}` : '고른 창(이 목록 밖 — 살아 있으면 그 창이 받고, 닫혔으면 보더 메인 봇이 받아요)'; })();
    const prefSec = () => { if (OWNER || !j.prefs) return ''; const P = j.prefs, wins = j.windows || [], now = j.primary_now ? (wins.find(w => w.key === j.primary_now)?.title || '들여온 창') : '보더 메인 봇';
      const opts = ['auto', 'none', ...wins.map(w => w.key)]; if (!opts.includes(P.primary_item)) opts.push(P.primary_item);
      return `<div class="bxs-sech">메인 봇</div><div class="bxs-list"><div class="bxs-li"><div><b>메인 봇 창</b><span>메인 봇 채팅 · 보더 알림이 가는 창이에요. 내 tmux · Herdr 창 중에서 고르거나 보더 메인 봇을 써요 · 지금: ${esc(now)}</span></div>`
        + `<select class="bxs-in sm bxs-sel" data-npr aria-label="메인 봇 창">${opts.map(k => `<option value="${esc(k)}"${k === P.primary_item ? ' selected' : ''}>${esc(primLabel(k))}</option>`).join('')}</select></div></div>`
        + `<div class="bxs-sech">업무 노드</div><div class="bxs-list"><div class="bxs-li"><div><b>업무 상태 다섯 꼴</b><span>업무 노드 점을 진행 · 막힘 · 기다림 · 완료 · 취소 다섯 꼴로 그려요. 끄면 지금 점 그대로예요. 주차 · 담당 없음 · 확인 대기 표지는 늘 붙어요</span></div>${sw(!!P.task_dots, 'data-ntd', '업무 상태 다섯 꼴')}</div>`
        + `<div class="bxs-li"><div><b>채널 = 태스크</b><span>장부의 업무(#번호)를 채널로 써요 — 그 업무의 창 · 세션 · 보고가 업무 채널에 모이고, 열린 업무가 왼쪽 채널에 떠요. 끄면 예전 묶기 그대로예요${P.task_repo ? ' · 번호만 있는 업무의 리포: ' + esc(P.task_repo) : ''}</span></div>${sw(!!P.task_channels, 'data-ntc', '채널 = 태스크')}</div>`
        + `<div class="bxs-li"><div><b>에이전트끼리 접기</b><span>메인 봇 · 부서장 에이전트 칸에서 그 창이 다른 에이전트(부서장 · 작업자)와 주고받은 글을 맨 위 접힌 칸 「에이전트끼리 n」에 모아요. 나와 나눈 대화 · 결정 · 할 일 카드와 섞이지 않고, 접힌 칸 글은 읽지 않음 · 알림에 안 세요. 끄면 예전 그대로예요</span></div>${sw(!!P.agents_fold, 'data-naf', '에이전트끼리 접기')}</div>`
        + (j.role_seats ? `<div class="bxs-li"><div><b>트리 정리</b><span>노드 트리에서 메인 봇 아래에는 역할 자리표의 부서만 보여요. 부서에 안 붙은 작업자 · 옛 창 · 주차한 노드는 접힌 「그 밖의 창」 안에 모이고(지우지 않아요), 창이 다 닫힌 노드는 바로 빠져요</span></div>${sw(P.tree_tidy !== false, 'data-ntt', '트리 정리')}</div>` : '')
        + (P.front_door ? `<div class="bxs-li"><div><b>앞단 하나</b><span>${esc(P.front_door.name)} — 고른 노드 ${(P.front_door.pairs || []).length}개를 메인 봇 채팅 한 칸으로 읽어요(설정 API 로 바꿔요)</span></div><span class="bxs-mut">켬</span></div>` : '') + `</div>`
        + `<div class="bxs-sech">주차</div><div class="bxs-list"><div class="bxs-li"><div><b>조용한 노드 주차</b><span>창 · 세션 · 보고 줄이 이만큼 조용하면 노드를 주차로 보여요(창은 안 닫음 — 다시 일하면 바로 살아나요)</span></div>`
        + `<div class="bxs-row" style="flex-wrap:nowrap">${P.park_on ? `<select class="bxs-in sm bxs-sel" data-nph aria-label="주차까지 조용한 시간">${[...new Set([...PARK_HS, P.park_h])].sort((x, y) => x - y).map(h => `<option value="${h}"${h === P.park_h ? ' selected' : ''}>${hrs(h)} 조용하면</option>`).join('')}</select>` : '<span class="bxs-mut">끔</span>'}${sw(P.park_on, 'data-npo', '조용한 노드 주차')}</div></div></div>`
        + `<div class="bxs-sech">하네스 묶음 <span class="bxs-mut">처음엔 Owner 방식 그대로 — 끄고 고쳐 써요</span></div><div class="bxs-list">${(j.bundle_keys || []).map(k => `<div class="bxs-li"><div><b>${esc(BUN_KO[k]?.[0] || k)}</b><span>${esc(BUN_KO[k]?.[1] || '')}</span></div>${sw(!!(P.bundles || {})[k], `data-nbn="${esc(k)}"`, BUN_KO[k]?.[0] || k)}</div>`).join('')}</div>`
        + `<div class="bxs-sech">하네스 규칙</div><div class="bxs-list">${(j.rule_keys || Object.keys(RULE_KO)).map(k => `<div class="bxs-li"><div><b>${esc(RULE_KO[k]?.[0] || k)}</b><span>${esc(RULE_KO[k]?.[1] || '')}</span></div>${sw(P.rules[k] !== false, `data-nrl="${esc(k)}"`, RULE_KO[k]?.[0] || k)}</div>`).join('')}`
        + `<div class="bxs-li"><div><b>비밀 찍지 않기</b><span>비밀번호 · 토큰은 출력 · 기록 · 게시하지 않아요 — 끌 수 없어요</span></div><span class="bxs-mut">늘 켬</span></div>`
        + `<div class="bxs-li"><div><b>기기에 반영</b><span>설치 프롬프트 · 새 창은 바로 따라요. 이미 설치한 AI 도구의 규칙(스킬)은 기기에서 다시 넣어요</span></div><div class="bxs-row"><code class="bxs-url">boarder enable report</code>${btn('복사', 'data-cp="boarder enable report"', 'sm ghost')}</div></div></div>`
        + engSec(); };
    const engSec = () => { const ds = j.engines || [];
      const row = d => `<div class="bxs-li"><div><b>${esc(d.name || '이름 없는 기기')}</b><span>${d.known ? `새 창 기본: ${esc(d.default || 'tmux')}${d.engines.length ? ' · 이 기기 엔진: ' + esc(d.engines.join(' · ')) : ''}` : '엔진을 아직 안 켰어요'}${d.online ? '' : ' · 꺼져 있음(마지막으로 알려 준 값)'}</span></div></div>`;
      return `<div class="bxs-sech">엔진</div><div class="bxs-list">${ds.map(row).join('') || '<div class="bxs-li"><div><b>기기가 없어요</b><span>설치 프롬프트로 기기를 붙이면 여기 보여요</span></div></div>'}`
        + `<div class="bxs-li"><div><b>새 창 엔진 바꾸기</b><span>기본은 tmux 예요. 기기마다 그 기기에서 바꿔요(보더가 기기 설정을 바꾸지 않아요) — Herdr 는 고를 때만 써요</span></div><div class="bxs-row" style="flex-direction:column;align-items:flex-end">${['tmux', 'herdr'].map(e => `<div class="bxs-row"><code class="bxs-url">boarder engine default ${e}</code>${btn('복사', `data-cp="boarder engine default ${e}"`, 'sm ghost')}</div>`).join('')}</div></div></div>`; };
    const savePref = async (patch, undo) => {   // 바로 반영, 못 바꾸면 되돌리고 한 줄 오류
      try { const r = await api('POST', 'api/me/nodeset', {prefs: patch}); j.prefs = r.prefs; if ('primary_item' in patch) { try { j = await api('GET', 'api/me/nodeset'); } catch {} } toast('저장했어요'); }
      catch { undo(); toast('일시적인 오류가 발생했어요'); }
      if (live()) draw();
    };
    const archRow = x => `<div class="bxs-li"><div><b>${esc(x.name)}</b><span>끝 ${esc(kst(x.at * 1000))} · 닫힌 지 ${esc(ago(x.at * 1000).replace(' 전', ''))}${x.msg ? ' · ' + esc(x.msg) : ''}</span></div>${x.reopen ? btn('다시 열기', `data-nro="${esc(x.id || x.name)}"`, 'sm ghost') : '<span class="bxs-mut" title="닫힌 창 목록(7일)에서 빠져 다시 열 수 없어요">다시 열 수 없음</span>'}</div>`;
    const draw = () => {
      const a = j.archive || [], shown = more ? a : a.slice(0, 30);
      el.innerHTML = header('노드', '창(노드)을 언제 나누고 · 합치고 · 이름 바꾸고 · 보관할지. 바꾸면 다음 점검부터' + (OWNER ? ' — 처음 값은 기본값이에요.' : '.'))
        + (OWNER ? '' : `<div class="bxs-sech">채널 묶기</div><div class="bxs-list"><div class="bxs-li"><div><b>무엇을 채널로 볼까요</b><span>화면은 같고 묶는 단위만 달라요. 들여올 때 쓰던 방식을 보고 골라 뒀어요</span></div>`
          + `<select class="bxs-in sm bxs-sel" data-nu aria-label="채널 묶기">${j.unit ? '' : '<option value="" selected>고르지 않음</option>'}<option value="agent"${j.unit === 'agent' ? ' selected' : ''}>에이전트마다 채널 · 일은 스레드</option><option value="goal"${j.unit === 'goal' ? ' selected' : ''}>일마다 채널</option></select></div></div>`)
        + `<div class="bxs-sech bxs-row between"><span>정리 기준</span><span class="bxs-row"><a class="bxs-btn sm ghost" style="text-decoration:none" href="/node-rules.md" download="node-rules.md" title="쓰던 하네스의 총괄에 붙여 넣는 노드 = 목표 규칙">노드 규칙 묶음 내려받기</a>${btn('기본값으로', 'data-ndef', 'sm ghost')}</span></div><div class="bxs-list">${NRULES.map(num).join('')}</div>`
        + prefSec()
        + (roleOn ? '<div data-rlslot></div>' : '')   // 역할이 있거나 엔진을 쓰는 회원만(주인 · 엔진 없는 회원은 자리도 없음)
        + faceSec()
        + `<div class="bxs-sech">보관</div><div class="bxs-list"><div class="bxs-li"><div><b>끝난 노드 보관</b><span>끝나고 닫힌 노드를 트리 · 타임라인에서 보관함으로 옮겨요(대화 · 장부 · 결과는 그대로)</span></div>`
        + `<select class="bxs-in sm bxs-sel" data-nk="archive_h" aria-label="끝난 노드 보관">${[...new Set([...ARCH_H, j.values.archive_h])].sort((x, y) => x - y).map(h => `<option value="${h}"${h === j.values.archive_h ? ' selected' : ''}>닫히고 ${hrs(h)} 뒤</option>`).join('')}</select></div>`
        + `<div class="bxs-li"><div><b>주차 · 리드 노드</b><span>남의 답을 기다리는 노드 · 총괄 · 영역 리드 · 열린 약속이 있는 노드는 늘 빼요</span></div><span class="bxs-mut">보관 안 함</span></div></div>`
        + `<div class="bxs-sech">보관함 ${a.length}</div>`
        + (a.length ? `<div class="bxs-list">${shown.map(archRow).join('')}</div>` + (a.length > shown.length ? `<div class="bxs-row">${btn(`${a.length - shown.length}개 더 보기`, 'data-nmore', 'sm ghost')}</div>` : '')
          : empty({ic: 'archive', sm: true, t: '보관한 노드가 없어요', p: '끝난 노드가 닫히고 정한 시간이 지나면 여기로 와요.'}, '<p class="bxs-mut">보관한 노드가 없어요</p>'));
      el.querySelector('[data-rlslot]')?.replaceWith(roleBox);
      facePick();
    };
    draw();
    const save = async vals => {
      try { const r = await api('POST', 'api/me/nodeset', {values: vals}); j.values = r.values; toast('저장했어요'); }
      catch (err) { toast(err.message); }
      if (live()) { if ('archive_h' in vals) { try { j = await api('GET', 'api/me/nodeset'); } catch {} } if (live()) draw(); }
    };
    el.onchange = async e => {
      const u = e.target.closest('[data-nu]');
      if (u) {   // 바로 반영, 못 바꾸면 그 값으로 되돌리고 한 줄 오류
        const was = j.unit, v = u.value; if (!v) return; j.unit = v;
        try { await api('POST', 'api/me/nodeset', {unit: v}); toast('다시 묶었어요'); j = await api('GET', 'api/me/nodeset'); }
        catch { j.unit = was; toast('일시적인 오류가 발생했어요'); }
        if (live()) draw(); return;
      }
      const pr = e.target.closest('[data-npr]');
      if (pr) { const was = j.prefs.primary_item; j.prefs.primary_item = pr.value; return savePref({primary_item: pr.value}, () => { j.prefs.primary_item = was; }); }
      const ph = e.target.closest('[data-nph]');
      if (ph) { const was = j.prefs.park_h, v = Number(ph.value); j.prefs.park_h = v; return savePref({park_h: v}, () => { j.prefs.park_h = was; }); }
      const i = e.target.closest('[data-nk]'); if (!i) return;
      const v = Number(i.value); if (!i.value || !Number.isFinite(v)) { i.value = j.values[i.dataset.nk]; return; }
      if (v !== j.values[i.dataset.nk]) save({[i.dataset.nk]: v});
    };
    el.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('input[data-nk]')) e.target.blur(); if (e.key === 'Enter' && !e.isComposing && e.target.matches('input[data-nnm]')) { e.preventDefault(); el.querySelector(`[data-nns="${CSS.escape(e.target.dataset.nnm)}"]`)?.click(); } };
    el.onclick = async e => {
      if (e.target.closest('[data-nmore]')) { more = true; return draw(); }
      const cp = e.target.closest('[data-cp]'); if (cp) return copy(cp.dataset.cp, '명령을');
      if (e.target.closest('[data-ntd]')) { const was = !!j.prefs.task_dots; j.prefs.task_dots = !was; draw(); return savePref({task_dots: !was}, () => { j.prefs.task_dots = was; }); }
      if (e.target.closest('[data-ntt]')) { const was = j.prefs.tree_tidy; j.prefs.tree_tidy = was === false; draw(); return savePref({tree_tidy: was === false}, () => { j.prefs.tree_tidy = was; }); }   // 값 없음(null) = 켬 — 누르면 끔
      if (e.target.closest('[data-naf]')) { const was = !!j.prefs.agents_fold; j.prefs.agents_fold = !was; draw(); return savePref({agents_fold: !was}, () => { j.prefs.agents_fold = was; }); }
      if (e.target.closest('[data-ntc]')) { const was = !!j.prefs.task_channels; j.prefs.task_channels = !was; draw(); return savePref({task_channels: !was}, () => { j.prefs.task_channels = was; }); }
      if (e.target.closest('[data-npo]')) { const was = j.prefs.park_on; j.prefs.park_on = !was; draw(); return savePref({park_on: !was}, () => { j.prefs.park_on = was; }); }
      const bn = e.target.closest('[data-nbn]');
      if (bn) { const k = bn.dataset.nbn; if (!j.prefs.bundles) j.prefs.bundles = {}; const was = !!j.prefs.bundles[k]; j.prefs.bundles[k] = !was; draw(); return savePref({bundles: {[k]: !was}}, () => { j.prefs.bundles[k] = was; }); }
      const rl = e.target.closest('[data-nrl]');
      if (rl) { const k = rl.dataset.nrl, was = j.prefs.rules[k] !== false; j.prefs.rules[k] = !was; draw(); return savePref({rules: {[k]: !was}}, () => { j.prefs.rules[k] = was; }); }
      const fo = e.target.closest('[data-nfo]'); if (fo) { openFace = openFace === fo.dataset.nfo ? null : fo.dataset.nfo; return draw(); }
      const no = e.target.closest('[data-nno]'); if (no) { openName = openName === no.dataset.nno ? null : no.dataset.nno; draw(); el.querySelector(`[data-nnm="${CSS.escape(no.dataset.nno)}"]`)?.focus(); return; }
      const ns = e.target.closest('[data-nns]'), nx = ns && faces?.find(f => f.pane === ns.dataset.nns);
      if (nx) {
        const v = String(el.querySelector(`[data-nnm="${CSS.escape(nx.pane)}"]`)?.value || '').trim().slice(0, 60);
        if (v === nx.name) { openName = null; return draw(); }
        ns.disabled = true;
        try { await api('POST', 'api/me/nodes/edit', {op: 'rename', node: nx.node, name: v}); faces = (await api('GET', 'api/me/nodes/avatar')).nodes; openName = null; toast(v ? '이름을 바꿨어요' : '자동 이름으로 되돌렸어요'); }
        catch (err) { ns.disabled = false; toast(err.status === 404 ? '이 채널은 이름을 바꿀 수 없어요' : '일시적인 오류가 발생했어요'); return; }
        if (live()) draw(); return;
      }
      const fr = e.target.closest('[data-nfr]'), fx = fr && faces?.find(f => f.pane === fr.dataset.nfr);
      if (fx) {   // 기본 얼굴로: 서버가 지우고, 목록을 다시 받아 기본 얼굴(열 이름 얼굴)을 그림
        try { if (OWNER){ await api('POST', 'api/me/agent-faces', {key: fx.pane}); AFS(fx.pane, null); faces = AF()?.() || faces; } else { await api('POST', 'api/me/nodes/avatar', {node: fx.pane}); faces = (await api('GET', 'api/me/nodes/avatar')).nodes; } toast('기본 얼굴로 되돌렸어요'); } catch { toast('일시적인 오류가 발생했어요'); }
        if (live()) draw(); return;
      }
      if (e.target.closest('[data-ndef]') && await confirmBox(OWNER ? '정리 기준 · 보관 시간을 기본값으로 되돌릴까요?' : '정리 기준 · 보관 시간을 처음 값으로 되돌릴까요?', '되돌리기')) return save({...j.defaults});
      const ro = e.target.closest('[data-nro]');
      const key = x => x.id || x.name, roRow = ro && j.archive.find(x => key(x) === ro.dataset.nro);
      if (ro && await confirmBox(`<b>${esc(roRow?.name || ro.dataset.nro)}</b> 노드를 다시 열까요? ${roRow?.id ? '트리에 돌아와요.' : '같은 대화로 창이 열리고 트리에 돌아와요.'}`, '다시 열기')) {
        // 누르는 즉시 보관함에서 빼고(보더 즉시 반응), 못 열면 그 자리로 되돌리고 한 줄 오류
        const name = ro.dataset.nro, at = j.archive.findIndex(x => key(x) === name), row = j.archive[at]; j.archive = j.archive.filter(x => key(x) !== name); if (live()) draw();
        try { await (row?.id ? api('POST', 'api/me/nodes/edit', {op: 'reopen', node: row.id}) : api('POST', 'api/me/nodereopen', {name})); toast('다시 열었어요'); }
        catch (err) { if (row && !j.archive.some(x => key(x) === name)) j.archive.splice(Math.min(at, j.archive.length), 0, row); if (live()) draw(); toast('일시적인 오류가 발생했어요'); }
      }
    };
  };
  const hsv2hex = (h, s, v) => { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return hexOf([f(5), f(3), f(1)].map(x => x * 255)); };
  const hex2hsv = hex => { const [r, g, b] = rgb(hex).map(x => x / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
    const h = !d ? 0 : mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return [(h + 360) % 360, mx ? d / mx : 0, mx]; };
  const accHex = () => { const v = ACC(); return v === 'bot' ? botHex() || '#f0541e' : v === 'orange' ? '#f0541e' : v; };
  function accCard(){
    const v = ACC(), cus = v !== 'bot', hex = accHex();
    return `<div class="bxs-card"><div class="bxs-row between"><div><b>강조 색</b><p class="bxs-mut">결정 깃발 · 알림 점 · 고른 칸 같은 강조에 써요. 「내 봇」은 메인 봇 색이라 봇을 바꾸면 따라가요</p></div>`
      + `<div class="bxs-seg" role="radiogroup" aria-label="강조 색"><button type="button" role="radio" aria-checked="${!cus}" data-accm="bot"><i class="bxs-accdot" style="background:${botHex() || 'var(--muted)'}"></i>내 봇</button><button type="button" role="radio" aria-checked="${cus}" data-accm="cus">사용자 지정</button></div></div>`
      + (cus ? `<div class="bxs-accpick" style="--pv:${hex}">`
        + `<div class="bxs-accl"><div class="bxs-wheel" data-wheel><i class="v"></i><button type="button" class="pt" role="slider" aria-label="색상 · 채도" aria-valuetext="${hex}" data-wpt></button></div>`
        + `<div class="bxs-bri" data-bri role="slider" aria-label="밝기" aria-valuemin="0" aria-valuemax="100" tabindex="0"><i class="pt"></i></div>`
        + `<label class="bxs-hex"><span>#</span><input class="bxs-in sm" maxlength="7" spellcheck="false" autocomplete="off" aria-label="헥스 색" value="${hex.slice(1)}" data-hex></label></div>`
        + `<div class="bxs-accpv" aria-hidden="true"><div class="sb"><i class="lg"></i><i class="ln on"></i><i class="ln"></i><i class="ln"></i><i class="ln"></i></div>`
        + `<div class="mn"><i class="tt"></i><span class="chip">결정</span><i class="tx"></i><i class="tx s"></i><span class="btn">답하기</span></div></div></div>` : '')
      + `</div>`;
  }
  // 바퀴 · 막대를 끌 때: 화면을 다시 그리지 않고 점 · 미리보기 · 헥스 칸만 옮김(끌기가 끊기지 않게), 색은 바로 칠하고 저장
  function accWire(el, store){
    const box = el.querySelector('.bxs-accpick'); if (!box) return;
    let [h, s, v] = hex2hsv(accHex());
    const wheel = box.querySelector('[data-wheel]'), wpt = box.querySelector('[data-wpt]'), bri = box.querySelector('[data-bri]'), hexIn = box.querySelector('[data-hex]');
    const paint = (save = true, fromHex = false) => {
      const hex = hsv2hex(h, s, v), a = h * Math.PI / 180;
      wpt.style.left = `${50 + 50 * s * Math.cos(a)}%`; wpt.style.top = `${50 + 50 * s * Math.sin(a)}%`; wpt.setAttribute('aria-valuetext', hex);
      wheel.querySelector('.v').style.opacity = String(1 - v);
      bri.style.setProperty('--full', hsv2hex(h, s, 1)); bri.querySelector('.pt').style.left = `${v * 100}%`; bri.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      box.style.setProperty('--pv', hex); box.style.setProperty('--pv-on', ratio(rgb(hex), [255, 255, 255]) >= 3 ? '#fff' : '#111113'); if (!fromHex) hexIn.value = hex.slice(1);
      if (save) store(hex);
    };
    const drag = (node, at) => node.addEventListener('pointerdown', e => {
      e.preventDefault(); node.setPointerCapture?.(e.pointerId); at(e);
      const mv = ev => at(ev), up = () => { node.removeEventListener('pointermove', mv); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up); };
      node.addEventListener('pointermove', mv); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
    });
    drag(wheel, e => { const r = wheel.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
      h = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; s = Math.min(1, Math.hypot(x, y) / (r.width / 2)); paint(); });
    drag(bri, e => { const r = bri.getBoundingClientRect(); v = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); paint(); });
    wpt.addEventListener('keydown', e => { const k = {ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, .05], ArrowDown: [0, -.05]}[e.key]; if (!k) return; e.preventDefault(); h = (h + k[0] + 360) % 360; s = Math.min(1, Math.max(0, s + k[1])); paint(); });
    bri.addEventListener('keydown', e => { const k = {ArrowLeft: -.05, ArrowDown: -.05, ArrowRight: .05, ArrowUp: .05}[e.key]; if (k == null) return; e.preventDefault(); v = Math.min(1, Math.max(0, v + k)); paint(); });
    hexIn.addEventListener('input', () => { const t = hexIn.value.trim().replace(/^#/, '').toLowerCase(); if (!/^[0-9a-f]{6}$/.test(t)) return; [h, s, v] = hex2hsv('#' + t); paint(true, true); });
    hexIn.addEventListener('blur', () => { hexIn.value = hsv2hex(h, s, v).slice(1); });
    paint(false);
  }
  let PINS = null;
  const pinsDraw = async el => {
    const box0 = el.querySelector('[data-pins]');
    if (!PINS) try { PINS = (await api('GET', 'api/me/side')).pins || []; } catch (e) { if (box0) box0.innerHTML = `<b>사이드 고정 캔버스</b><p class="bxs-err">${esc(e.message)}</p>`; return; }   // 못 읽었는데 빈 목록으로 저장하면 있던 것이 지워짐
    const box = el.querySelector('[data-pins]'); if (!box) return;
    box.innerHTML = `<b>사이드 고정 캔버스</b><p class="bxs-mut">왼쪽 칸 「캔버스」 바로 밑에 보여요. 캔버스 주소와 이름을 넣으면 더해요.</p>`
      + PINS.map(p => `<div class="bxs-row between"><span>${esc(p.title)}</span><button type="button" class="bxs-link" data-pinrm="${esc(p.id)}">빼기</button></div>`).join('')
      + `<div class="bxs-row"><input class="bxs-in sm" data-pinu placeholder="캔버스 주소" aria-label="캔버스 주소"><input class="bxs-in sm" data-pint placeholder="이름" aria-label="이름">${btn('더하기', 'data-pinadd')}</div>`;
    const save = async next => { try { PINS = (await api('POST', 'api/me/side', {pins: next})).pins; window.dispatchEvent(new CustomEvent('hbpins', {detail: PINS})); pinsDraw(el); } catch (e) { toast(e.message); } };
    box.onclick = e => {
      const rm = e.target.closest('[data-pinrm]'); if (rm) return save(PINS.filter(p => p.id !== rm.dataset.pinrm));
      if (!e.target.closest('[data-pinadd]')) return;
      const u = box.querySelector('[data-pinu]').value.trim(), id = (/\/(?:art|canvas)\/([A-Za-z0-9_-]{4,64})/.exec(u) || [])[1] || u, title = box.querySelector('[data-pint]').value.trim();
      if (id) save([...PINS, {id, title}]);
    };
  };
  let HIDE = null;
  const TOPS = [['node', '노드'], ['canvas', '캔버스'], ['feed', '피드']];
  const hideDraw = async el => {
    const box0 = el.querySelector('[data-tops]');
    if (!HIDE) try { HIDE = (await api('GET', 'api/me/side')).hide || []; } catch (e) { if (box0) box0.innerHTML = `<b>사이드바 맨 위 줄</b><p class="bxs-err">${esc(e.message)}</p>`; return; }
    const box = el.querySelector('[data-tops]'); if (!box) return;
    box.innerHTML = `<b>사이드바 맨 위 줄</b><p class="bxs-mut">끈 줄은 왼쪽 칸 · 휴대폰 서랍에서 빠져요. 그 화면은 주소로 그대로 열려요</p>`
      + TOPS.map(([k, v]) => `<div class="bxs-row between"><span>${v}</span>${sw(!HIDE.includes(k), `data-top="${k}"`, v + ' 보이기')}</div>`).join('');
    box.onclick = async e => {
      const b = e.target.closest('[data-top]'); if (!b) return;
      const k = b.dataset.top, next = HIDE.includes(k) ? HIDE.filter(x => x !== k) : [...HIDE, k];
      try { HIDE = (await api('POST', 'api/me/side', {hide: next})).hide; window.dispatchEvent(new CustomEvent('hbhide', {detail: HIDE})); hideDraw(el); } catch (er) { toast(er.message); }
    };
  };
  PAGES.look = async el => {
    const TH = [['system', '시스템'], ['light', '라이트'], ['dark', '다크']];
    const cur = () => { try { return localStorage.getItem('hb-theme') || 'system'; } catch { return 'system'; } };
    const still = () => { try { return localStorage.getItem('hb-still') === '1'; } catch { return false; } };
    const favb = () => { try { return localStorage.getItem('hb-favblink') !== '0'; } catch { return true; } };   // 파비콘 눈 깜빡(기본 켜짐)
    const tapt = () => { try { return localStorage.getItem('hb-tapthread') !== '0'; } catch { return true; } };
    const unk = () => { try { return localStorage.getItem('hb-unreadkeep') === '1'; } catch { return false; } };   // 읽지 않음 뒤로 가기 되살림 · 「읽지 않음으로」(기본 꺼짐)
    const canvasBack = () => { try { return localStorage.getItem('hb-canvasback') === '1'; } catch { return false; } };
    const mainM = () => { try { return localStorage.getItem('hb-mainmerge') === '1'; } catch { return false; } };
    let draw = () => {
      el.innerHTML = header('모양', '내 계정에 저장돼 다른 기기에서도 같아요.')
        + `<div class="bxs-card"><div class="bxs-row between"><div><b>테마</b><p class="bxs-mut">시스템은 기기 설정(라이트 · 다크)을 따라요</p></div><div class="bxs-seg" role="radiogroup" aria-label="테마">${TH.map(([k, v]) => `<button type="button" role="radio" aria-checked="${cur() === k}" data-th="${k}">${v}</button>`).join('')}</div></div></div>`
        + accCard()
        + '<div class="bxs-card" data-tops></div>'
        + '<div class="bxs-card" data-pins></div>'
        + `<div class="bxs-card"><div class="bxs-row between"><div><b>움직임 줄이기</b><p class="bxs-mut">블롭 · 파비콘 깜빡임 · 화면 전환 움직임을 멈춰요(기기의 움직임 줄이기도 따라요)</p></div>${sw(still(), `data-st="${still() ? 0 : 1}"`, '움직임 줄이기')}</div></div>`
        + `<div class="bxs-card"><div class="bxs-row between"><div><b>파비콘 눈 깜빡</b><p class="bxs-mut">브라우저 탭 아이콘이 5초마다 눈을 깜빡여요. 끄면 탭 아이콘만 멈추고 다른 움직임은 그대로예요</p></div>${sw(favb(), `data-fb="${favb() ? 0 : 1}"`, '파비콘 눈 깜빡')}</div></div>`
        + `<div class="bxs-card"><div class="bxs-row between"><div><b>폰에서 글을 누르면 스레드 열기</b><p class="bxs-mut">휴대폰에서 채널 글을 짧게 누르면 그 글 스레드가 열려요. 끄면 길게 눌러 메뉴에서 회신해요. 컴퓨터(마우스)는 그대로예요</p></div>${sw(tapt(), `data-tt="${tapt() ? 0 : 1}"`, '폰에서 글을 누르면 스레드 열기')}</div></div>`
        + `<div class="bxs-card"><div class="bxs-row between"><div><b>읽지 않음에서 읽은 글 남기기</b><p class="bxs-mut">뒤로 가기로 돌아오면 아까 목록과 보던 자리가 그대로이고, 읽은 글은 「읽음」으로 남아 「읽지 않음으로」 되돌릴 수 있어요. 되돌린 글은 이 기기에만 남아요</p></div>${sw(unk(), `data-uk="${unk() ? 0 : 1}"`, '읽지 않음에서 읽은 글 남기기')}</div></div>`
        + `<div class="bxs-card"><div class="bxs-row between"><div><b>캔버스를 닫으면 앞 화면으로</b><p class="bxs-mut">캔버스를 열기 직전 화면으로 돌아가요. 주소로 바로 연 캔버스는 홈으로 가요</p></div>${sw(canvasBack(), `data-cb="${canvasBack() ? 0 : 1}"`, '캔버스를 닫으면 앞 화면으로')}</div></div>`
        + (isMem() || !(window.HB_CAPS?.mainline ?? true) ? '' : `<div class="bxs-card"><div class="bxs-row between"><div><b>#메인 한 줄기</b><p class="bxs-mut">Primary 채널을 열면 다섯 채널(Primary · 회사 · 퍼스널 · DGit · 가게) 글이 시간순 한 줄로 보여요. 답은 원래 채널 스레드로, 새 글은 Primary 로 가요. 글 주소도 /m/… 꼴로 읽혀요</p></div>${sw(mainM(), `data-mm="${mainM() ? 0 : 1}"`, '#메인 한 줄기')}</div></div>`);
      hideDraw(el); pinsDraw(el);
    };
    const setAcc = (v, redraw = true) => {
      const old = ACC(); if (v === old) return;
      try { if (v === 'bot') localStorage.removeItem('hb-accent'); else localStorage.setItem('hb-accent', v); if (ACC() !== v) throw 0; uiSave('accent', v); }
      catch { try { if (old === 'bot') localStorage.removeItem('hb-accent'); else localStorage.setItem('hb-accent', old); } catch {} toast('일시적인 오류가 발생했어요'); }
      applyAccent(); if (redraw) draw();
    };
    const draw0 = draw; draw = () => { draw0(); accWire(el, hex => setAcc(hex, false)); };
    draw();
    el.onclick = async e => {
      const am = e.target.closest('[data-accm]');
      if (am) return setAcc(am.dataset.accm === 'bot' ? 'bot' : ACC() === 'bot' ? accHex() : ACC());   // 사용자 지정으로 바꾸면 지금 색(봇 색)에서 시작 — 바꾸는 순간 색이 튀지 않게
      const t = e.target.closest('[data-th]');
      if (t){ try { localStorage.setItem('hb-theme', t.dataset.th); } catch {} uiSave('theme', t.dataset.th); if (typeof theme !== 'undefined'){ theme = t.dataset.th; applyTheme(); } else if (t.dataset.th === 'system') R.removeAttribute('data-theme'); else R.setAttribute('data-theme', t.dataset.th); return draw(); }
      const fb = e.target.closest('[data-fb]');
      if (fb){ try { localStorage.setItem('hb-favblink', fb.dataset.fb); } catch {} uiSave('favblink', fb.dataset.fb); return draw(); }
      const tt = e.target.closest('[data-tt]');
      if (tt){ try { localStorage.setItem('hb-tapthread', tt.dataset.tt); } catch {} uiSave('tapthread', tt.dataset.tt); R.classList.toggle('hb-tapth', tt.dataset.tt === '1'); return draw(); }
      const uk = e.target.closest('[data-uk]');
      if (uk){ try { localStorage.setItem('hb-unreadkeep', uk.dataset.uk); } catch {} uiSave('unreadkeep', uk.dataset.uk); window.HBInbox?.keepApply?.(); return draw(); }
      const mm = e.target.closest('[data-mm]');
      if (mm){ try { localStorage.setItem('hb-mainmerge', mm.dataset.mm); } catch {} uiSave('mainmerge', mm.dataset.mm); return draw(); }   // 다음 채널 읽기(20초 · 열 때)부터 — 보드 loadCh 가 바뀐 줄기를 알아채고 옛 쪽을 버림
      const cb = e.target.closest('[data-cb]');
      if (cb){ try { localStorage.setItem('hb-canvasback', cb.dataset.cb); } catch {} uiSave('canvasback', cb.dataset.cb); return draw(); }
      const m = e.target.closest('[data-st]');
      if (m){ try { localStorage.setItem('hb-still', m.dataset.st); } catch {} uiSave('still', m.dataset.st); R.classList.toggle('bx-still', m.dataset.st === '1'); return draw(); }
    };
  };
  const FT = {report: ['에이전트가 직접 보고', 'AI 도구에 보더 MCP · 시작 훅 · 스킬을 넣어요(먼저 백업, 끄면 그 칸만 빠짐)'], engine: ['보더 엔진', '보더가 이 기기에서 창을 열고 · 깨우고 · 주차하고 · 닫아요(쓰던 도구면 tmux, 처음이면 내 구독 SDK)']};
  const featCards = (N, perm) => {
    const ds = (N.devices || []).filter(d => d.features), pend = (N.cmds || []).filter(x => x.verb === 'feature' && (x.state === 'queued' || x.state === 'taken'));
    const row = (t, d, right) => `<div class="bxs-row between"><div><b>${t}</b><p class="bxs-mut" style="margin:2px 0 0">${d}</p></div>${right}</div>`;
    return (ds.length ? `<div class="bxs-sech">기기에서 보더가 하는 일</div>` + ds.map(d => { const f = d.features, on = {report: (f.report || []).length > 0, engine: !!f.engine};
      return `<div class="bxs-card"><div class="bxs-row"><b>${esc(d.name || '기기')}</b></div>` + row('읽기 · 누르기', '창 · 세션 · 할 일을 읽어 노드로 보이고, 누른 것은 그 하네스의 원래 동사로 넣어요. 그 사람 설정은 안 바꿔요.', sw(true, 'disabled aria-disabled="true" title="늘 켜져 있어요"', '읽기 · 누르기'))
        + ['report', 'engine'].map(k => row(FT[k][0], FT[k][1], pend.some(x => x.device_id === d.id && x.args?.what === k) ? '<span class="bxs-mut">바꾸는 중</span>' : sw(on[k], `data-feat="${k}" data-dev="${esc(d.id)}" data-on="${on[k] ? 0 : 1}"`, FT[k][0]))).join('') + '</div>'; }).join('') : '')
      + (perm == null ? '' : `<div class="bxs-sech">엔진 창</div><div class="bxs-card"><div class="bxs-row between"><div><b>권한</b><p class="bxs-mut">보더가 여는 창이 파일 고치기 · 명령 실행을 어떻게 할지 골라요. 다음에 여는 창부터.</p></div><div class="bxs-seg" role="radiogroup" aria-label="권한">${[['ask', '하나하나 묻기'], ['auto', '자동 허용'], ['bypass', '모두 허용']].map(([k, v]) => `<button type="button" role="radio" aria-checked="${perm === k}" data-perm="${k}">${v}</button>`).join('')}</div></div></div>`);   // 상태를 못 읽으면 칸을 숨김(허용된 것을 「꺼짐」으로 보이지 않게)
  };
  const ENGP = [['claude', 'Claude'], ['codex', 'ChatGPT (Codex)']];
  const engSecs = N => {
    const ds = (N?.devices || []).filter(d => d.features?.engine);
    return ds.length ? `<div class="bxs-sech">엔진</div>` + ds.map(d => `<div class="bxs-card" data-eng="${esc(d.id)}"><div class="bxs-row"><b>${esc(d.name || '기기')}</b></div><p class="bxs-mut" style="margin:0">읽어 오는 곳이에요</p></div>`).join('') : '';
  };
  const engDraw = (box, st) => {
    const id = box.dataset.eng, name = box.querySelector('b')?.textContent || '기기';
    if (st.err) { box.innerHTML = `<div class="bxs-row"><b>${esc(name)}</b></div><p class="bxs-mut" style="margin:0">${esc(st.err)}</p>`; return; }
    const cur = st.engine === 'sdk' ? 'sdk' : 'tmux', opt = (v, t) => `<button type="button" role="radio" aria-checked="${cur === v}" data-eng-pick="${v}" ${st.busy ? 'disabled' : ''}>${t}</button>`;
    const prov = ENGP.map(([k, label]) => {
      const rows = (st.accounts?.[k] || []).map(a => `<div class="bxs-li"><div><b>${esc(a.name)}</b><span>${a.logged_in ? '로그인됨' : '로그인이 필요해요'}</span></div>`
        + (a.logged_in ? '<span class="bxs-badge"><i class="ok"></i>로그인됨</span>' : btn('로그인', `data-eng-login="${k}" data-name="${esc(a.name)}" ${st.busy ? 'disabled' : ''}`, 'sm')) + '</div>').join('');
      return `<div class="bxs-sech" style="margin:6px 0 0">${label} 계정</div><div class="bxs-list">${rows || '<div class="bxs-li"><div><b>아직 없어요</b><span>아래에서 이름을 적고 계정을 추가해요</span></div></div>'}`
        + `<div class="bxs-li"><div class="bxs-row" style="width:100%"><input class="bxs-in sm" data-eng-name="${k}" maxlength="40" placeholder="계정 이름 (영문 · 숫자)" aria-label="${label} 계정 이름">${btn('계정 추가', `data-eng-login="${k}" data-new="1" ${st.busy ? 'disabled' : ''}`, 'sm')}</div></div></div>`;
    }).join('');
    const link = st.url ? `<p style="margin:0"><a href="${esc(st.url)}" target="_blank" rel="noopener noreferrer">그 기기의 브라우저에서 이 주소를 열어 로그인</a> <span class="bxs-mut">— 끝나면 아래 목록이 바뀌어요</span></p><p class="bxs-mut" style="margin:0">다른 기기의 브라우저에서 열면 로그인이 끝나지 않아요(로그인이 끝나면 그 기기 localhost 로 돌아오기 때문이에요)</p>` : st.wait ? '<p class="bxs-mut" style="margin:0">그 기기에서 브라우저가 열렸어요. 로그인을 마치면 아래 목록이 바뀌어요</p>' : '';
    box.innerHTML = `<div class="bxs-row between"><b>${esc(name)}</b><span class="bxs-badge">${cur === 'sdk' ? '내 구독' : '쓰던 Codex · Claude Code'}</span></div>`
      + `<p class="bxs-mut" style="margin:0">창을 여는 방법을 골라요. 둘 다 같은 보더 화면이고, 다음에 여는 창부터 바뀌어요.</p>`
      + `<div class="bxs-seg" role="radiogroup" aria-label="엔진">${opt('sdk', '내 구독으로')}${opt('tmux', '쓰던 Codex · Claude Code 로')}</div>`
      + (st.msg ? `<p class="bxs-mut" style="margin:0">${esc(st.msg)}</p>` : '') + link + prov;
  };
  const engLoad = async (box, st = {}) => {
    const id = box.dataset.eng; box._st = st;
    try { const r = await api('GET', 'api/me/engine/device/' + encodeURIComponent(id)); Object.assign(st, r, {err: ''}); }
    catch (e) { st.err = e.message || '일시적인 오류가 발생했어요'; }
    if (box.isConnected) engDraw(box, st);
    return st;
  };
  const engWatch = (box, prov, name) => {   // 로그인이 끝날 때까지 4초마다 목록을 다시 읽음(최대 3분)
    const st = box._st; let n = 0; clearInterval(st.t);
    st.t = setInterval(async () => {
      if (!box.isConnected || ++n > 45) return clearInterval(st.t);
      try { const r = await api('GET', 'api/me/engine/device/' + encodeURIComponent(box.dataset.eng)); st.accounts = r.accounts;
        if ((r.accounts?.[prov] || []).some(a => a.name === name && a.logged_in)) { clearInterval(st.t); st.url = ''; st.wait = false; st.msg = `${name} 계정이 로그인됐어요`; } box.isConnected && engDraw(box, st); } catch {}
    }, 4000);
  };
  const engClick = async e => {
    const box = e.target.closest('[data-eng]'); if (!box || !box._st) return false;
    const st = box._st, id = box.dataset.eng, pick = e.target.closest('[data-eng-pick]'), lg = e.target.closest('[data-eng-login]');
    if (pick && pick.dataset.engPick !== (st.engine === 'sdk' ? 'sdk' : 'tmux')) {
      st.busy = true; st.msg = '기기에 보냈어요 — 처음 켜는 길이면 몇 분 걸릴 수 있어요'; engDraw(box, st);
      try { await api('POST', 'api/me/engine/device/' + encodeURIComponent(id) + '/choose', {engine: pick.dataset.engPick}); st.engine = pick.dataset.engPick; st.msg = '바꿨어요 — 다음에 여는 창부터'; }
      catch (err) { st.msg = err.message || '일시적인 오류가 발생했어요'; }
      st.busy = false; engDraw(box, st); return true;
    }
    if (lg) {
      const prov = lg.dataset.engLogin, name = lg.dataset.new ? (box.querySelector(`[data-eng-name="${prov}"]`)?.value || '').trim() : lg.dataset.name;
      if (!/^\w[\w.-]{0,39}$/.test(name)) { st.msg = '계정 이름은 영문 · 숫자 · . _ - 만 쓸 수 있어요'; engDraw(box, st); return true; }
      st.busy = true; st.msg = ''; st.url = ''; engDraw(box, st);
      try { const r = await api('POST', 'api/me/engine/device/' + encodeURIComponent(id) + '/login', {provider: prov, name}); st.url = r.url || ''; st.wait = !r.url; st.accounts ||= {}; if (!(st.accounts[prov] || []).some(a => a.name === name)) (st.accounts[prov] ||= []).push({name, logged_in: false}); engWatch(box, prov, name); }
      catch (err) { st.msg = err.message || '일시적인 오류가 발생했어요'; }
      st.busy = false; engDraw(box, st); return true;
    }
    return false;
  };
  // 기능: 사이드바 「피드」 밑 상태 페이지 둘(원하는 사람만 켬). 계정 값(api/me/features), 기본 꺼짐.
  //   끄면 메뉴 줄이 사라지고 그 페이지 API 도 막혀요(서버 403). 서버에서 통째로 끈 기능(FLAGS_OFF)은 스위치가 잠김
  PAGES.features = async el => {
    const FT2 = [['taskboard', '태스크 현황', '요청마다 상태 · 담당 · PR · 대화를 한 페이지에서 봐요. 에이전트 쪽 도구가 올린 요청만 보여요'],
      ['devboard', '기기 세션 현황', '내 기기마다 열린 창 · 상태 · 계정 · 부하를 한 페이지에서 봐요. 기기마다 보이기/숨기기를 고를 수 있어요']];
    let F = null, busy = '';
    const draw = () => {
      el.innerHTML = header('기능', '켠 기능만 사이드바 「피드」 밑에 생겨요. 내 계정에 저장돼 다른 기기에서도 같아요.')
        + (F ? FT2.map(([k, n, d]) => { const lock = (F.off || []).includes(k), on = !!F[k];
          return `<div class="bxs-card"><div class="bxs-row between"><div><b>${esc(n)}</b><p class="bxs-mut">${esc(d)}${lock ? ' · 이 서버에서 꺼 둔 기능이에요' : ''}</p></div>${lock ? '' : sw(on, `data-ft2="${k}" data-on="${on ? 0 : 1}"${busy === k ? ' disabled' : ''}`, n)}</div></div>`; }).join('') : spin);
    };
    draw();
    try { F = await api('GET', 'api/me/features'); } catch (e) { el.innerHTML = header('기능') + `<p class="bxs-mut">${esc(e.message)}</p>`; return; }
    draw();
    el.onclick = async e => {
      const b = e.target.closest('[data-ft2]'); if (!b || busy) return;
      busy = b.dataset.ft2; draw();
      try { const j = await api('POST', 'api/me/features', {k: busy, on: b.dataset.on === '1'}); F = {...F, ...j}; dispatchEvent(new CustomEvent('bx-feat', {detail: F})); }
      catch (er) { toast(er.message); }
      busy = ''; draw();
    };
  };
  PAGES.devices = async (el, id, live) => {
    const [{devices}, prompt, N, B] = await Promise.all([api('GET', 'api/me/devices'), fetch('api/install/prompt', {credentials: 'include'}).then(r => r.ok ? r.text() : '').catch(() => ''),
      OWNER ? null : api('GET', 'api/me/nodes').catch(() => null), OWNER ? null : api('GET', 'api/me/board').catch(() => null)]); if (!live()) return;
    const perm = B?.engine ? (B.engine.perm || 'ask') : null;
    const copyBtn = btn('프롬프트 복사', 'data-ip', 'pri sm');
    el.innerHTML = header('기기', 'boarder setup 한 기기가 5분마다 메모리 · CPU · 디스크 · 도는 에이전트 · Claude 한도를 보내요. 토큰 · 키는 안 와요.')
      + (devices.length ? `<div class="bxs-sech bxs-row between"><span>기기 ${devices.length}대</span>${copyBtn}</div>${devices.map(deviceCard).join('')}` : empty({ic: 'devices', t: '기기가 아직 없어요', p: '설치 프롬프트를 그 컴퓨터의 AI 도구에 붙여 넣으면 여기 떠요.', act: copyBtn}, `<div class="bxs-empty"><b>아직 없어요</b><p>설치 프롬프트를 그 컴퓨터의 AI 도구에 붙여 넣으면 여기 떠요.</p>${copyBtn}</div>`))
      + (OWNER || !N ? '' : featCards(N, perm) + engSecs(N));
    const prevClick = async e => {
      const ft = e.target.closest('[data-feat]');
      if (ft){ ft.disabled = true; try { await api('POST', 'api/me/devices/' + encodeURIComponent(ft.dataset.dev) + '/feature', {what: ft.dataset.feat, on: ft.dataset.on === '1'}); toast('기기에 보냈어요 — 곧 바뀌어요'); } catch (err) { toast(err.message); } return render(); }
      const pm = e.target.closest('[data-perm]');
      if (pm){
        const to = pm.dataset.perm;
        if (to === perm) return;
        if (to === 'bypass' && !await confirmBox('<b>모두 허용할까요?</b><br>보더가 여는 창의 Claude Code 가 파일 고치기 · 명령 실행을 하나하나 묻지 않고 해요. 그 기기의 파일을 바꾸거나 지울 수 있으니, 중요한 자료가 있는 기기라면 허용하지 마세요. 다음에 여는 창부터 적용되고, 언제든 여기서 바꿀 수 있어요. (안전한 일만 알아서 하게 하려면 「자동 허용」을 고르세요.)', '허용')) return;
        try { await api('POST', 'api/me/engine/perm', {mode: to}); } catch (err) { toast(err.message); } return render();
      }
      const ip = e.target.closest('[data-ip]');
      if (ip){ if (!prompt) return toast('일시적인 오류가 발생했어요'); try { await navigator.clipboard.writeText(prompt); } catch { return toast('일시적인 오류가 발생했어요'); }
        const t = ip.querySelector('span') || ip; const was = ip._was ||= t.textContent; t.textContent = '복사했어요'; clearTimeout(ip._t); ip._t = setTimeout(() => { t.textContent = was; }, 2000); return; }
      const b = e.target.closest('[data-dm]'); if (!b) return;
      const d = devices.find(x => x.id === b.dataset.dm); if (!d) return;
      document.querySelector('.bxs-pop')?.remove();
      const pop = mk('div', 'bxs-pop', `<button type="button" class="danger" data-rv>기기 폐기</button>`), r = b.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, r.right - 190) + 'px'; document.body.append(pop);
      const close = ev => { if (!pop.contains(ev.target)) { pop.remove(); removeEventListener('pointerdown', close, true); } }; setTimeout(() => addEventListener('pointerdown', close, true));
      pop.querySelector('[data-rv]').onclick = async () => {
        pop.remove();
        if (!await confirmBox(`<b>${esc(d.name || '이 기기')}</b> 를 폐기할까요? 그 기기는 더 값을 못 보내요${d.scope === 'watch' ? '' : ' · AI 도구는 다시 설치해야 해요'}.`, '폐기')) return;
        try { await api('POST', 'api/me/devices/' + encodeURIComponent(d.id) + '/revoke'); toast('폐기했어요'); render(); } catch (err) { toast(err.message); }
      };
    };
    el.onclick = async e => { if (await engClick(e)) return; return prevClick(e); };
    el.querySelectorAll('[data-eng]').forEach(b => engLoad(b));
  };
  PAGES.start = async (el, id, live) => {
    const o = await api('GET', 'api/me/onboarding'); if (!live()) return;
    const row = (x, i) => {
      const act = x.pick ? (x.pick.length ? `<div class="bxs-row bxs-ob-pick"><select class="bxs-in" data-pw aria-label="기본 창">${['<option value="">메인 봇(고르지 않음)</option>', ...x.pick.map(w => `<option value="${esc(w.target)}"${w.on ? ' selected' : ''}>${esc(w.title)}</option>`)].join('')}</select>${btn('저장', 'data-pws', 'pri sm')}</div>` : '<p class="bxs-mut">들여온 창이 생기면 여기서 골라요</p>')
        : `${x.cmd ? `<div class="bxs-ob-cmd"><code>${esc(x.cmd)}</code>${btn('복사', `data-cp="${esc(x.cmd)}"`, 'sm')}</div>` : ''}${x.to ? `<a class="bxs-btn ghost sm" href="${esc(x.to)}" data-to="${esc(x.to)}">설정 열기</a>` : ''}`;
      return `<li class="bxs-ob${x.done ? ' done' : ''}"><span class="bxs-ob-n" aria-hidden="true">${x.done ? lu('check', 14) : i + 1}</span><div class="bxs-ob-b"><div class="bxs-ob-t"><b>${esc(x.title)}</b><span class="bxs-badge">${x.done ? '끝' : '할 일'}</span></div><p>${esc(x.detail)}</p>${x.done && !x.pick ? '' : act}</div></li>`;
    };
    el.innerHTML = header('시작하기', `보더를 내 기기 · AI 도구 · 대화에 잇는 차례예요. ${o.done}/${o.total} 끝.`) + `<ol class="bxs-obl">${o.steps.map(row).join('')}</ol>`;
    el.onclick = async e => {
      const cp = e.target.closest('[data-cp]'); if (cp) return copy(cp.dataset.cp, '명령');
      const sv = e.target.closest('[data-pws]'); if (!sv) return;
      sv.disabled = true;
      try { const v = el.querySelector('[data-pw]').value; await api('POST', 'api/me/primary-window', {target: v || null}); toast(v ? '기본 창을 정했어요' : '메인 봇으로 되돌렸어요'); render(); }
      catch (err) { toast(err.message); sv.disabled = false; }
    };
  };
  PAGES.invite = async el => {
    if (!OWNER) return go('#settings/connectors', true);
    el.innerHTML = header('사람 초대', '보더는 초대한 사람만 가입해요. 메일을 넣으면 그 사람이 그 메일로 코드를 받아 들어와요.') + `<div class="bxs-card"><div class="bxs-row"><input class="bxs-in" type="email" placeholder="초대할 메일" aria-label="초대할 메일" data-ie>${btn('보내기', 'data-ig', 'pri')}</div></div>`;
    el.onclick = async e => {
      if (!e.target.closest('[data-ig]')) return;
      const i = el.querySelector('[data-ie]'), v = i.value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast('메일 주소를 넣어요');
      try { await api('POST', 'api/me/invites', {email: v}); toast(v + ' 을 초대했어요'); i.value = ''; } catch (err) { toast(err.message); }
    };
  };

  const HE = () => window.HB_EMOJI;
  const cimg = (u, n, s) => `<img class="cem" src="${esc(u)}" alt=":${esc(n)}:" width="${s}" height="${s}" draggable="false">`;
  const EMO_RE = /^[a-z0-9가-힣_-]{2,40}$/;
  const emoName = f => String(f || '').normalize('NFC').replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[\s.]+/g, '-').replace(/[^a-z0-9가-힣_-]/g, '').slice(0, 40);
  const emoDay = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
  // 128×128 로 맞춤(가운데 맞춰 담기, 투명 바탕) — GIF 는 움직임 그대로 원본
  async function emoFit(f){
    if (f.type === 'image/gif') return {blob: f, type: 'image/gif'};
    const u = URL.createObjectURL(f);
    try {
      const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; });
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const k = Math.min(128 / im.naturalWidth, 128 / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
      c.getContext('2d').drawImage(im, (128 - w) / 2, (128 - h) / 2, w, h);
      const blob = await new Promise(ok => c.toBlob(ok, 'image/png'));
      return blob ? {blob, type: 'image/png'} : null;
    } catch { return null; } finally { URL.revokeObjectURL(u); }
  }
  function emojiForm(host, {phone, done, cancel}){
    let pic = null, url = '';
    host.innerHTML = `<div class="bxs-emf">${phone ? '' : `<div class="bxs-row between"><b style="font-size:17px">이모지 추가</b><button type="button" class="bxs-icon" data-no aria-label="닫기">${IC.x}</button></div>`}
      <div data-empv></div>${phone ? `<div class="bxs-row">${btn(lu('images', 16) + '사진 보관함', 'data-empick', 'sm')}${btn(lu('camera', 16) + '찍기', 'data-emshoot', 'sm')}</div>` : ''}
      <label class="bxs-f"><span>이름</span><div class="bxs-nm"><span>:</span><input data-emname autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="40" aria-label="이모지 이름"><span>:</span></div><span class="bxs-mut" data-emhint>한글 · 영문 소문자 · 숫자 · - _ (같은 이름이 있으면 알려 줘요)</span></label>
      <div class="bxs-row end">${phone ? '' : btn('취소', 'data-no', 'ghost')}${btn('저장', 'data-emsave', 'pri')}</div>
      <input type="file" accept="image/png,image/gif,image/jpeg,image/webp" hidden data-emfile><input type="file" accept="image/*" capture="environment" hidden data-emcam></div>`;
    const $ = q => host.querySelector(q), name = $('[data-emname]'), hint = $('[data-emhint]'), HINT = hint.textContent;
    const pv = () => { $('[data-empv]').innerHTML = pic
      ? `<div class="bxs-pvw">${cimg(url, name.value, 56)}<div class="bxs-pvr"><span>반응 <span class="bxs-rc">${cimg(url, name.value, 16)}<b>1</b></span></span>${phone ? '<span class="bxs-mut">128×128 로 맞췄어요</span>' : `<span>글 안 &nbsp;배포 끝 ${cimg(url, name.value, 20)}</span>`}</div></div>${phone ? '' : `<div class="bxs-row between"><span class="bxs-mut">${esc(pic.name)} · 128×128 로 맞췄어요</span><button type="button" class="bxs-link" data-empick>다른 그림</button></div>`}`
      : (phone ? '' : `<button type="button" class="bxs-drop" data-empick>${lu('image-plus', 24)}<b>그림 고르기</b><span>PNG · GIF · JPG · 끌어 놓거나 붙여 넣어도 돼요</span></button>`); };
    const take = async f => {
      if (!f || !/^image\//.test(f.type)) return;
      const r = await emoFit(f); if (!r) return toast('일시적인 오류가 발생했어요');
      if (url) URL.revokeObjectURL(url);
      pic = {name: f.name, ...r}; url = URL.createObjectURL(r.blob);
      if (!name.value) name.value = emoName(f.name);
      pv(); name.focus();
    };
    pv();
    host.addEventListener('click', e => {
      if (e.target.closest('[data-no]')) return cancel?.();
      if (e.target.closest('[data-empick]')) return $('[data-emfile]').click();
      if (e.target.closest('[data-emshoot]')) return $('[data-emcam]').click();
    });
    $('[data-emfile]').onchange = e => take(e.target.files[0]); $('[data-emcam]').onchange = e => take(e.target.files[0]);
    host.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
    host.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); take(e.dataTransfer?.files?.[0]); });
    host.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])][0]; if (f){ e.preventDefault(); take(f); } });
    name.addEventListener('input', () => { hint.textContent = HINT; hint.classList.remove('bad'); if (pic) pv(); });
    $('[data-emsave]').onclick = async () => {
      const v = name.value.trim().toLowerCase().replace(/^:|:$/g, ''), bad = t => { hint.textContent = t; hint.classList.add('bad'); name.focus(); };
      if (!pic) return toast('그림을 골라요');
      if (!EMO_RE.test(v)) return bad('한글 · 영문 소문자 · 숫자 · - _ 로 2–40자예요');
      if (HE()?.get().by[v]) return bad('같은 이름이 있어요 — 바꿔 주세요');
      const b = $('[data-emsave]'); b.disabled = true; const was = b.innerHTML; b.innerHTML = spin;
      try {
        const r = await fetch('api/emoji/custom', {method: 'POST', credentials: 'include', headers: {'x-hb': '1', 'content-type': pic.type, 'x-emoji-name': encodeURIComponent(v)}, body: pic.blob});
        const j = await r.json().catch(() => ({}));
        if (r.status >= 400 && r.status < 500 && j.error){ b.disabled = false; b.innerHTML = was; return bad(j.error); }   // 이름 · 그림 문제는 그 칸 아래
        if (!r.ok || !j.ok) throw new Error();
        await HE()?.load(true); toast(`:${v}: 을 추가했어요`); done?.(v);
      } catch { b.disabled = false; b.innerHTML = was; toast('일시적인 오류가 발생했어요'); }
    };
    return () => { if (url) URL.revokeObjectURL(url); };
  }
  function emojiBox(after){
    closePops();
    const d = mk('div', 'bxs-dlg', '<div class="bxs-dlgc bxs-emd" role="dialog" aria-modal="true" aria-label="이모지 추가"></div>'), box = d.firstChild;
    document.body.append(d);
    let free = () => {};
    const close = () => { free(); d.remove(); };
    free = emojiForm(box, {done: v => { close(); after?.(v); }, cancel: close});
    d.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    d.addEventListener('click', e => { if (e.target === d) close(); });
    box.querySelector('[data-empick]')?.focus();
  }
  PAGES.emoji = async (el, id, live) => {
    if (id === 'add' && !PC.matches){   // 폰: 「추가」는 따로 쪽(‹ 이모지)
      const bk = main.querySelector('.bxs-ptop [data-to]'); if (bk){ bk.dataset.to = '#settings/emoji'; bk.querySelector('span').textContent = '이모지'; }
      el.innerHTML = header('이모지 추가') + '<div data-emform></div>';
      emojiForm(el.querySelector('[data-emform]'), {phone: true, done: () => go('#settings/emoji', true)});
      return;
    }
    const he = HE(); if (!he){ el.innerHTML = '<p class="bxs-err">일시적인 오류가 발생했어요</p>'; return; }
    await he.load(true); if (!live()) return;
    if (he.get().err){ el.innerHTML = header('이모지') + '<p class="bxs-err">일시적인 오류가 발생했어요</p>'; return; }
    let q = '';
    const draw = () => {
      const C = he.get(), hit = n => !q || n.includes(q), org = C.org.filter(x => hit(x.name)), blobs = he.blobs();
      const row = x => `<div class="bxs-li"><div class="bxs-erow">${cimg(x.url, x.name, 28)}<div><b><code>:${esc(x.name)}:</code></b><span>${esc(x.by)} · ${emoDay(x.at)}</span></div></div>${x.mine ? `<button type="button" class="bxs-more" data-emmore="${esc(x.name)}" aria-label="더 보기">${IC.more}</button>` : ''}</div>`;
      const grp = ([k, bn]) => { const xs = blobs.filter(b => b.g === k && (hit(b.n) || b.l.includes(q))); if (q && !xs.length) return ''; const off = C.off.includes(k);
        return `<div class="bxs-grp"><div class="bxs-gh"><b>${esc(bn)}</b>${sw(!off, `data-embot="${k}"${C.admin ? '' : ' disabled title="관리자만 바꿀 수 있어요"'}`, bn + ' 블롭')}</div><div class="bxs-faces${off ? ' off' : ''}">${xs.map(b => `<span title=":${esc(b.n)}: · ${esc(b.l)}">${cimg(b.u, b.n, 30)}</span>`).join('')}</div></div>`; };
      el.querySelector('[data-embody]').innerHTML = `<div class="bxs-sech">우리 조직 · ${org.length}</div>`
        + (org.length ? `<div class="bxs-list">${org.map(row).join('')}</div>` : empty({ic: 'smile', t: q ? '찾는 이모지가 없어요' : '아직 올린 이모지가 없어요', p: q ? '다른 이름으로 찾아 보세요.' : '그림 하나와 이름이면 반응 · 글에 바로 써요.', act: q ? '' : btn('이모지 추가', 'data-emadd', 'pri sm'), sm: true}, '<div class="bxs-empty"><b>아직 없어요</b></div>'))
        + `<div class="bxs-sech">기본 세트 · 블롭 얼굴 <span class="bxs-mut" style="display:inline">— 봇마다 끌 수 있어요</span></div><div class="bxs-list">${he.BOTS.map(grp).join('')}</div>`;
    };
    el.innerHTML = header('이모지', '조직 사람 모두가 반응 · 글에 쓰는 이모지예요. 글에 <code>:이름:</code> 으로 불러요.', btn(PC.matches ? '이모지 추가' : '추가', 'data-emadd', 'pri' + (PC.matches ? '' : ' sm')))
      + '<input class="bxs-in sm" type="search" placeholder="찾기 — 이름" aria-label="이모지 찾기" data-emq><div data-embody></div>';
    draw();
    el.querySelector('[data-emq]').addEventListener('input', e => { q = e.target.value.trim().toLowerCase().replace(/^:|:$/g, ''); draw(); });
    el.onclick = async e => {
      if (e.target.closest('[data-emadd]')) return PC.matches ? emojiBox(() => live() && draw()) : go('#settings/emoji/add');
      const bs = e.target.closest('[data-embot]');
      if (bs && !bs.disabled){   // 누르면 바로(공용 낙관 길) — 못 바꾸면 되돌리고 한 줄
        const k = bs.dataset.embot, C = he.get(), on = C.off.includes(k);
        const set = v => { C.off = v ? C.off.filter(x => x !== k) : [...C.off, k]; he.reindex(); draw(); };
        return window.optDo({key: 'ebot:' + k, apply: () => set(on), send: () => api('POST', 'api/emoji/bot', {bot: k, on}), undo: () => set(!on)});
      }
      const m = e.target.closest('[data-emmore]'); if (!m) return;
      document.querySelector('.bxs-pop')?.remove();
      const n = m.dataset.emmore, pop = mk('div', 'bxs-pop', '<button type="button" class="danger" data-emdel>지우기</button>'), r = m.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, r.right - 190) + 'px'; document.body.append(pop);
      const close = ev => { if (!pop.contains(ev.target)){ pop.remove(); removeEventListener('pointerdown', close, true); } }; setTimeout(() => addEventListener('pointerdown', close, true));
      pop.querySelector('[data-emdel]').onclick = async () => {
        pop.remove();
        if (!await confirmBox(`<b>:${esc(n)}:</b> 을 지울까요? 이미 단 반응 · 글에는 <code>:${esc(n)}:</code> 글자로 남아요.`, '지우기')) return;
        const C = he.get(), keep = C.org;
        window.optDo({key: 'edel:' + n, apply: () => { C.org = keep.filter(x => x.name !== n); he.reindex(); draw(); },
          send: () => api('POST', 'api/emoji/custom/delete', {name: n}), undo: () => { C.org = keep; he.reindex(); draw(); }});
      };
    };
  };

  function feedbackBox(){
    closePops(); let kind = 'bug';
    const FK = {bug: '버그', idea: '아이디어', other: '기타'};
    const d = mk('div', 'bxs-dlg', `<div class="bxs-dlgc bxs-fbd" role="dialog" aria-modal="true" aria-label="피드백 보내기"><h2>피드백 보내기</h2>`
      + `<div class="bxs-seg" role="radiogroup" aria-label="종류">${Object.entries(FK).map(([k, v]) => `<button type="button" role="radio" aria-checked="${k === kind}" data-fk="${k}">${v}</button>`).join('')}</div>`
      + `<textarea class="bxs-in" rows="5" maxlength="2000" placeholder="무엇이 불편했나요 · 무엇이 있으면 좋을까요" aria-label="피드백" data-ft></textarea>`
      + `<div class="bxs-row between"><span class="bxs-mut" data-fc>0 / 2000</span><div class="bxs-row">${btn('취소', 'data-no', 'ghost')}${btn('보내기', 'data-fsend', 'pri')}</div></div></div>`);
    document.body.append(d);
    const ta = d.querySelector('[data-ft]'), close = () => d.remove();
    ta.focus();
    ta.addEventListener('input', () => { d.querySelector('[data-fc]').textContent = `${ta.value.length} / 2000`; });
    d.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    d.addEventListener('click', async e => {
      if (e.target === d || e.target.closest('[data-no]')) return close();
      const k = e.target.closest('[data-fk]'); if (k){ kind = k.dataset.fk; d.querySelectorAll('[data-fk]').forEach(b => b.setAttribute('aria-checked', b === k)); return; }
      const sd = e.target.closest('[data-fsend]'); if (!sd) return;
      const text = ta.value.trim(); if (!text) return toast('내용을 적어요');
      sd.disabled = true;
      try { await api('POST', 'api/me/feedback', {text, kind, page: (HBR.hash().split('?')[0] || '').slice(0, 200)}); close(); toast('보냈어요'); }
      catch (err) { sd.disabled = false; toast(err.message); }
    });
  }

  function inviteBox(){
    closePops();
    const d = mk('div', 'bxs-dlg', `<form class="bxs-dlgc bxs-fbd" role="dialog" aria-modal="true" aria-label="사람 초대" novalidate><h2>사람 초대</h2>`
      + `<div class="bxs-mut">메일을 넣으면 그 사람이 그 메일로 코드를 받아 들어와요.</div>`
      + `<input class="bxs-in" type="email" autocomplete="off" placeholder="초대할 메일" aria-label="초대할 메일" data-ie>`
      + `<div class="bxs-row end">${btn('취소', 'data-no', 'ghost')}<button type="submit" class="bxs-btn pri" data-isend>초대 보내기</button></div></form>`);
    document.body.append(d);
    const i = d.querySelector('[data-ie]'), close = () => d.remove();
    i.focus();
    d.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-no]')) close(); });
    d.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const v = i.value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast('메일 주소를 넣어요');
      const sd = d.querySelector('[data-isend]'); sd.disabled = true;
      try { await api('POST', 'api/me/invites', {email: v}); close(); toast('보냈어요'); }
      catch (err) { sd.disabled = false; toast(err.status === 403 ? '초대는 관리자만 할 수 있어요' : '일시적인 오류가 발생했어요'); }   // 서버 글(「no」 등)은 안 보임
    });
  }

  const mp = document.querySelector('.bx-mpop');
  if (mp && !mp.querySelector('[data-mi="settings"]')){
    const b = mk('button', 'bx-it', '' + lu('settings') + '<span>설정</span>'); b.type = 'button'; b.dataset.mi = 'settings'; b.setAttribute('role', 'menuitem'); mp.prepend(b);   // 사이드바 항목과 같은 부품(.bx-it)
    b.addEventListener('click', () => { mp.hidden = true; document.querySelectorAll('[data-me]').forEach(x => x.setAttribute('aria-expanded', 'false')); if (R.classList.contains('bx-dron')) document.querySelector('.bx-scrim')?.click(); enter(PC.matches ? 'connectors' : ''); });
  }
  addEventListener('popstate', () => {
    // 뒤로 간 곳도 설정이면(딥링크로 들어와 그 칸부터 센 때) 저장해 둔 화면으로 마저 감
    if (leaving){ leaving = false; if (on()){ history.replaceState(null, '', backTo); R.classList.remove('bx-set'); dispatchEvent(new PopStateEvent('popstate')); return; } }
    render();
  });
  addEventListener('keydown', e => {
    if (!R.classList.contains('bx-set') || e.metaKey || e.ctrlKey) return;
    if (e.target.closest?.('.bxs-main, .bxs-sb, .bxs-dlg, .bxs-pop')) return;   // 우리 칸 안은 아래에서 막음
    e.stopPropagation();
  }, true);
  for (const el of [main, side]) el.addEventListener('keydown', e => { if (!e.metaKey && !e.ctrlKey) e.stopPropagation(); });
  PC.addEventListener('change', render);
  const h0 = String(window.HB_HASH0 || '');
  if (/^#settings(\/|$|\?)/.test(h0)){ history.replaceState(null, '', h0); }
  render();
})();
