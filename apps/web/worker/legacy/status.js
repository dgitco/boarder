// 상태 페이지(태스크 현황 · 기기 세션 현황):
//   설정 › 기능에서 켠 사람만 사이드바 「피드」 바로 밑에 「태스크 현황」 · 「기기 세션 현황」 줄이 생기고, 누르면 본 칸(흰 판)에 그 페이지.
//   켜기/끄기 = 계정 값(api/me/features, 기본 꺼짐) — 이 브라우저에는 마지막 값만(첫 그리기용). 끈 사람은 줄도 페이지도 없고 서버 API 도 403.
//   주소: /task-status(· /task-status/<요청 id>) · /device-sessions — 새로 고침 · 링크로 바로 열림. 다른 곳(채팅 · 노드 · 피드 …)으로 가면 닫힘.
//   보드 전역(show · ans · HBEmpty)과 틀(shell.js go · lists)을 씀 — 틀이 없으면(옛 보드) 아무것도 안 함. 글은 늘 이스케이프해서 그림(HTML 로 안 넣음)
(() => {
  if (!window.HB_LIVE || !window.show) return;
  const R = document.documentElement;
  const K = {tasks: {feat: 'taskboard', path: '/task-status', name: '태스크 현황', sub: '요청마다 상태 · 담당 · PR · 대화를 한 곳에서 봐요'},
    devices: {feat: 'devboard', path: '/device-sessions', name: '기기 세션 현황', sub: '내 기기마다 창 · 상태 · 계정 · 부하를 봐요'}};
  const svg = (d, w = 18) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {tasks: svg('<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>'),   // lucide list-checks
    devices: svg('<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/>')};   // lucide monitor-smartphone
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  // 글: 이스케이프 → https 주소만 링크 → 줄바꿈
  const TX = s => E(s).replace(/https:\/\/[^\s<>"']+[^\s<>"'.,)\]」』]/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`).replace(/\n/g, '<br>');
  const api = (p, o = {}) => fetch(p, {credentials: 'include', cache: 'no-store', ...o, headers: {'content-type': 'application/json', 'x-hb': '1', ...(o.headers || {})}})
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw Object.assign(new Error(r.status >= 500 || !j.error ? '일시적인 오류가 발생했어요' : j.error), {status: r.status}); return j; });
  const ago = ms => { if (!ms) return ''; const s = (Date.now() - ms) / 1000; return s < 60 ? '방금' : s < 3600 ? Math.floor(s / 60) + '분 전' : s < 86400 ? Math.floor(s / 3600) + '시간 전' : Math.floor(s / 86400) + '일 전'; };
  const hm = ms => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const empty = (t, p, ic) => window.HBEmpty ? window.HBEmpty({ic: ic || ICON.tasks, t, p}) : `<p class="bx-stp-mut">${E(t)} — ${E(p)}</p>`;   // 보드 빈 화면 부품(아이콘 · 제목 · 한 줄)
  let F = (() => { try { return JSON.parse(localStorage.getItem('bx-feat') || '{}') || {}; } catch { return {}; } })();
  const onK = k => !!F[K[k].feat];
  const split = p => { p = String(p || '').replace(/\/$/, ''); for (const k of Object.keys(K)) { if (p === K[k].path) return {k, sub: ''}; if (p.startsWith(K[k].path + '/')) return {k, sub: decodeURIComponent(p.slice(K[k].path.length + 1))}; } return null; };
  const PAGES = {};   // k → {mount(el, ctx) → {unmount(), route(sub)}}
  let cur = null, box = null, inst = null;
  const hb = () => dispatchEvent(new Event('bx-stp'));   // 틀이 사이드바를 다시 그림(고른 줄 · 줄 생김/없어짐)
  function ensure(){
    if (box) return box;
    const h = document.querySelector('.wrap header'); if (!h) return null;
    box = document.createElement('section'); box.className = 'bx-stp'; box.hidden = true; h.after(box); return box;
  }
  // 페이지 안 이동(목록 ↔ 세부): 주소에 남김 — 뒤로 가기 · 새로 고침 · 공유
  const go = (k, sub, replace) => { const p = K[k].path + (sub ? '/' + encodeURIComponent(sub) : ''); if (location.pathname !== p) history[replace ? 'replaceState' : 'pushState'](null, '', p); };
  function open(k, fromPop, sub = ''){
    if (!K[k] || !onK(k) || !ensure()) return;
    if (cur === k && !box.hidden){ inst?.route?.(sub); if (!fromPop) go(k, sub); return; }
    if (cur) unmount();
    cur = k; R.classList.add('bx-stpg'); box.hidden = false; box.dataset.pg = k;
    box.innerHTML = `<div class="bx-stp-b"></div>`;
    const body = box.querySelector('.bx-stp-b'), head = `<div class="bx-stp-h"><h1>${E(K[k].name)}</h1><p>${E(K[k].sub)}</p></div>`;
    try { inst = PAGES[k] ? PAGES[k].mount(body, {api, E, TX, ago, hm, empty, head, sub, go: (s, rep) => go(k, s, rep)}) : null; } catch (e) { body.innerHTML = head + `<p class="bx-stp-err">${E(e.message)}</p>`; }
    if (!PAGES[k]) body.innerHTML = head + `<p class="bx-stp-mut">준비 중이에요</p>`;
    document.querySelector('.wrap')?.scrollTo(0, 0); scrollTo(0, 0);
    if (!fromPop) go(k, sub);
    hb();
  }
  function unmount(){ try { inst?.unmount?.(); } catch {} inst = null; }
  function close(fromPop){
    if (!cur) return;
    unmount(); cur = null; R.classList.remove('bx-stpg'); if (box){ box.hidden = true; box.innerHTML = ''; }
    if (!fromPop && split(location.pathname)) history.pushState(null, '', '/' + location.hash);
    hb();
  }
  // 계정 값 받기 — 꺼진 기능의 페이지가 열려 있으면 닫음
  function setF(n){
    const was = JSON.stringify(F); F = {taskboard: !!n.taskboard, devboard: !!n.devboard};
    try { localStorage.setItem('bx-feat', JSON.stringify(F)); } catch {}
    if (cur && !onK(cur)) close();
    if (was !== JSON.stringify(F)) hb();
    boot();
  }
  const load = () => api('api/me/features').then(setF).catch(() => {});
  addEventListener('bx-feat', e => setF(e.detail || {}));   // 설정 › 기능에서 바꿈
  // 처음 연 주소가 상태 페이지면(새로 고침 · 링크): 보드 첫 그리기가 주소를 /nodes 로 바꾸므로 서버가 머리에 남긴 BX_PG0_PATH 로 앎.
  //   기능이 켜져 있으면 그 페이지를 열고 주소를 되돌림, 꺼져 있으면 보드 첫 화면 그대로(계정 값을 받은 뒤 판정)
  let pg0 = split(window.BX_PG0_PATH || location.pathname);
  function boot(){
    if (!pg0 || !onK(pg0.k)) return; const {k, sub} = pg0; pg0 = null;
    setTimeout(() => { open(k, true, sub); if (cur === k) go(k, sub, true); }, 0);
  }
  load().then(() => { pg0 = null; });
  boot();
  addEventListener('popstate', () => { const s = split(location.pathname); if (s && onK(s.k)) open(s.k, true, s.sub); else if (cur) close(true); });
  // 채팅 · 노드 판이 열리면(찾기 · 알림 · 글 링크) 이 페이지는 닫음 — 주소는 그쪽이 씀
  const watchAns = () => { try { new MutationObserver(() => { if (cur && typeof ans !== 'undefined' && !ans.hidden) close(true); }).observe(ans, {attributes: true, attributeFilter: ['hidden']}); } catch {} };
  if (typeof ans !== 'undefined') watchAns(); else document.addEventListener('DOMContentLoaded', watchAns);
  const show0 = window.show; window.show = function(){ if (cur) close(); return show0.apply(this, arguments); };
  // 보이는 동안만 도는 되풀이(탭이 숨으면 쉼)
  const every = (ms, f) => { const t = setInterval(() => { if (document.visibilityState === 'visible') f(); }, ms); return () => clearInterval(t); };
  // 찾기 칸이 있는 목록 화면: 칸은 처음 한 번만 만들고 둘레(머리 · 단추 · 목록)만 다시 그림 — 칸을 교체하거나 값 · 포커스를 건드리면 한글 조합이 깨지고 커서가 튐
  const SEARCH_ICON = svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', 16);
  function paintList(el, {q, ph, label}, top, side, rest){
    if (!el.querySelector('[data-q]')) el.innerHTML = `<div class="bx-stp-slot" data-top></div><div class="bx-stp-bar"><label class="bx-stp-q">${SEARCH_ICON}<input type="search" placeholder="${E(ph)}" value="${E(q)}" data-q aria-label="${E(label)}"></label><div class="bx-stp-slot" data-side></div></div><div class="bx-stp-slot" data-rest></div>`;
    el.querySelector('[data-top]').innerHTML = top; el.querySelector('[data-side]').innerHTML = side; el.querySelector('[data-rest]').innerHTML = rest;
  }
  const onSearch = (el, set) => { const f = e => { if (e.target.matches('[data-q]')) set(e.target.value); }; el.addEventListener('input', f); el.addEventListener('compositionend', f); };

  const ST = {working: '진행', blocked: '막힘', waiting: '기다림', done: '끝', cancelled: '안 함'};
  const STC = s => ({끝: 'ok', 완료: 'ok', 막힘: 'bad', 기다림: 'warn', '안 함': 'mut', 안함: 'mut', 멈춤: 'mut'})[String(s).replace(/\s/g, '') === '안함' ? '안 함' : s] || '';
  const pill = (txt, c) => `<span class="bx-tb-st" data-c="${E(c ?? STC(txt))}">${E(txt)}</span>`;
  const areaLab = a => { const s = String(a).replace(/\s*[(（][^)）]*[)）]\s*/g, ' ').trim(), p = s.split(/\s*·\s*/); return (p[p.length - 1] || s).replace(/^우리\s+/, '') || a; };
  const DORD = ['비서실장', '운영', '제품', '기술', '고객성공', '영업', '재무', '법무'];
  const SECS = [['req', '요청별'], ['dept', '부서 · 태스크별'], ['ask', '확인 · 막힘'], ['ops', '운영 이정표'], ['merged', '머지 PR'], ['open', '열린 PR'], ['win', '지금 도는 일']];
  PAGES.tasks = {mount(el, x){
    const V = (() => { const d = {q: '', rf: '', ra: '', days: 1, sec: 'req', tday: null}; try { const v = {...d, ...JSON.parse(localStorage.getItem('bx-stp-tv2') || '{}'), q: '', tday: null}; if (v.rf === '오늘 완료') v.rf = '끝'; return v; } catch { return d; } })();
    const save = () => { try { localStorage.setItem('bx-stp-tv2', JSON.stringify({rf: V.rf, ra: V.ra, days: V.days, sec: V.sec})); } catch {} };
    let data = null, err = '', sub = x.sub, det = null, detRepo = null, detErr = '', sending = false, aOpen = {}, wf = '';
    let detSeq = 0;   // 세부 읽기 번호 — 말하기가 끝나면 그 전에 나간 새로 읽기 응답(방금 쓴 줄이 없는 옛 값)은 버림
    const B = () => data?.board || {};
    const loadList = () => x.api('api/me/taskboard').then(j => { data = j; err = ''; if (!sub) draw(); }).catch(e => { err = e.message; if (!sub) draw(); });
    const loadDet = id => { const n = ++detSeq; return x.api('api/me/taskboard/' + encodeURIComponent(id)).then(j => { if (sub !== id || n !== detSeq) return; const was = det && det.task.id === id ? det.convo.length : -1; det = j; detRepo = j.repo || null; detErr = ''; drawDet(was); })
      .catch(e => { if (sub !== id || n !== detSeq) return; if (det && e.status !== 403 && e.status !== 404) return; detErr = e.message; det = null; drawDet(-1); }); };   // 잠깐의 오류는 보던 화면 그대로(다음 회차에 다시)
    const prU = (n, repo) => /^[\w.-]+\/[\w.-]+$/.test(repo || '') ? `https://github.com/${repo}/pull/${n}` : '';
    const isU = (n, repo) => /^[\w.-]+\/[\w.-]+$/.test(repo || '') ? `https://github.com/${repo}/issues/${n}` : '';
    const aN = (n, u, lab) => u ? `<a href="${E(u)}" target="_blank" rel="noopener noreferrer">${E(lab || '#' + n)}</a>` : `<span class="bx-tb-n">${E(lab || '#' + n)}</span>`;
    // 근거 상태: 올리는 쪽이 준 ev(끝 = 머지 + 운영 배포 + 확인 줄 등)가 먼저, 없으면 상태 글자
    const EV = t => t.x?.ev?.k ? t.x.ev : {k: t.status || ST[t.state], c: t.status || ST[t.state], cnt: t.state === 'done' ? '끝' : t.state === 'cancelled' ? '안 함' : t.state === 'blocked' ? '막힘' : '진행'};
    const isDone = t => EV(t).k === '끝' || ['끝', '안 함'].includes(EV(t).cnt);   // 근거 상태(ev)가 있으면 그것만 — 없으면 EV 가 state 로 셈(목록 숨김 · 오래됨에 같은 기준)
    const SL = k => k === '끝' ? '완료' : k;
    const mvOf = t => Math.max(t.x?.moved_at || 0, t.updated_at || 0, t.requested_at || 0);
    const decOf = t => t.x?.dec || [];
    const STALE = 3 * 3600e3;
    const owners = o => { const L = String(o || '').split(/\s*·\s*/).filter(v => v && v !== '미확인'); return L.length ? L.slice(0, 2).join(' · ') + (L.length > 2 ? ' 외 ' + (L.length - 2) : '') : '담당 미정'; };
    const day0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const KD = ['일', '월', '화', '수', '목', '금', '토'];
    const md = ms => { const d = new Date(ms); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}(${KD[d.getDay()]})`; };
    const hhmm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const cardHref = id => '/#card-' + encodeURIComponent(id);
    function rcard(t){
      const st = t.status || ST[t.state], ev = EV(t), mv = mvOf(t), stale = !isDone(t) && Date.now() - mv > STALE, d = decOf(t), nx1 = t.x?.next1 || t.next;
      const fin = ev.k === '끝' || ev.cnt === '안 함';
      const now = fin && t.done ? `<p><b>한 일</b>${E(t.done)}</p>` : t.x?.now && ev.cnt !== '끝' ? `<p><b>지금</b>${E(t.x.now)}</p>` : t.x?.last?.text ? `<p><b>지금</b><span class="bx-tb-who">${E(t.x.last.who || '')}</span> · ${E(t.x.last.text)}</p>` : t.done ? `<p><b>한 일</b>${E(t.done)}</p>` : '<p><b>지금</b>아직 우리 쪽 답이 없어요</p>';
      const nx = t.state === 'blocked' || st === '막힘' ? `<p class="bx-tb-why"><b>막힌 까닭</b>${E(nx1 || '까닭을 아직 못 적었어요')}</p>` : !fin && nx1 ? `<p><b>다음</b>${E(nx1)}</p>` : '';
      return `<article class="bx-tb-c${ev.cnt === '막힘' ? ' blk' : ''}${stale ? ' stale' : ''}${d.length ? ' dec' : ''}" data-tk="${E(t.id)}" tabindex="0" role="button">`
        + (d.length ? `<div class="bx-tb-decb">정하실 것 ${d.length} · ${E(d[0].t)}</div>` : '')
        + `<h4>${pill(SL(ev.k), STC(ev.c || ev.k))}<span class="t">${E(t.title || t.quote || t.id)}${t.x?.split_of ? `<span class="bx-tb-sp">${E(t.x.split_of)}에서 따로</span>` : ''}</span></h4>`
        + (st === '막힘' ? nx + now : now + nx)
        + (ev.why ? `<p class="bx-tb-evl"><b>근거</b>${E(ev.why)}${ev.who ? ' · 기다림: ' + E(ev.who) : ''}</p>` : ev.who ? `<p class="bx-tb-evl"><b>기다림</b>${E(ev.who)}</p>` : '')
        + `<div class="bx-tb-ft"><span class="ow">${E(owners(t.assignee))}</span><span class="ago${stale ? ' old' : ''}">${E(stale ? ago(mv).replace(' 전', '') + '째 조용' : ago(mv))}</span><span class="go">›</span></div></article>`;
    }
    const dxcard = c => `<article class="bx-tb-c dxc"><div class="bx-tb-decb">정하실 것 · ${E(c.k || '')}</div><h4><span class="t">${E(c.t)}</span></h4><div class="bx-tb-ft"><span class="ow">아직 요청에 안 붙은 카드</span>${c.id ? `<a href="${E(cardHref(c.id))}">카드 열기 ›</a>` : ''}</div></article>`;
    function groups(L){
      const by = new Map(), ak = a => String(a || '').startsWith('회사') ? 0 : 1, dk = d => { const i = DORD.indexOf(d); return i < 0 ? 99 : i; };
      for (const t of L){ const k = (t.area || '') + ' › ' + (t.dept || '부서 미지정'); if (!by.has(k)) by.set(k, []); by.get(k).push(t); }
      let h = '', lastA = null;
      for (const k of [...by.keys()].sort((a, b) => { const [a1, a2] = a.split(' › '), [b1, b2] = b.split(' › '); return ak(a1) - ak(b1) || dk(a2) - dk(b2); })){
        const [A, d] = k.split(' › '), G = by.get(k);
        if (A !== lastA){ h += `<h2 class="bx-tb-ar">${E(A || '묶음 미지정')} <span>요청 ${L.filter(t => (t.area || '') === A).length}</span></h2>`; lastA = A; }
        h += `<div class="bx-tb-dh"><h3>${E(d)}</h3><span>요청 ${G.length} · 끝 ${G.filter(t => EV(t).k === '끝').length} · 진행 ${G.filter(t => EV(t).cnt === '진행').length} · 막힘 ${G.filter(t => EV(t).cnt === '막힘').length}${G.some(t => decOf(t).length) ? ` · <b class="bx-tb-dg">정하실 것 ${G.filter(t => decOf(t).length).length}</b>` : ''}</span></div><div class="bx-tb-cards">${G.map(rcard).join('')}</div>`;
      }
      return h;
    }
    function todayHTML(all){
      if (V.tday == null) V.tday = new Date().getHours() < 6 ? 1 : 0;
      const t0 = day0() - V.tday * 86400e3, t1 = t0 + 86400e3, L = all.filter(t => !t.x?.split_of && (t.requested_at || 0) >= t0 && (t.requested_at || 0) < t1);
      const fin = L.filter(t => EV(t).k === '끝'), np = fin.filter(t => EV(t).nopr).length, run = L.filter(t => EV(t).cnt === '진행'), blk = L.filter(t => EV(t).cnt === '막힘'), no = L.filter(t => EV(t).cnt === '안 함').length;
      const half = run.filter(t => ['머지 · 운영 확인 전', '운영 나감 · 확인 전'].includes(EV(t).k)).length, opn = run.filter(t => EV(t).k === 'PR 열림').length;
      const who = {}; blk.forEach(t => { const w = EV(t).who || '우리 쪽'; who[w] = (who[w] || 0) + 1; });
      const decs = []; all.forEach(t => decOf(t).forEach(c => decs.push({...c, r: t}))); (B().decisions || []).forEach(c => decs.push({...c, r: null}));
      const btn = (c, n, l, s, f) => `<button type="button" class="${c}" data-tf="${E(f)}"><b>${n}</b><small>${E(l)}${s ? ' · ' + E(s) : ''}</small></button>`;
      return `<div class="bx-tb-today"><div class="hd"><h2>${V.tday ? '어제' : '오늘'} ${E(md(t0 + 3600e3))} 요청</h2><button type="button" class="bx-tb-chip${V.tday ? '' : ' on'}" data-day="0">오늘</button><button type="button" class="bx-tb-chip${V.tday ? ' on' : ''}" data-day="1">어제</button></div>`
        + `<div class="nums">${btn('', L.length, '요청 · 끝 포함', no ? '안 함 · 멈춤 ' + no : '', '모두')}${btn('ok', fin.length, '끝', np ? 'PR 없는 일 ' + np : '', '끝')}${btn('', run.length, '진행', [opn ? 'PR 열림 ' + opn : '', half ? '운영 확인 전 ' + half : ''].filter(Boolean).join(' · '), '진행')}`
        + `${btn('bad', blk.length, '막힘', Object.entries(who).sort((a, b) => b[1] - a[1]).map(([w, n]) => w + ' ' + n).join(' · '), '막힘')}${btn('dec', decs.length, '결정', '', '정하실 것')}</div>`
        + `<p class="note">끝 = 붙은 PR 이 모두 머지 + 운영 배포 + 운영 확인 줄이 있을 때만. 머지만 됐으면 「머지 · 운영 확인 전」, 배포까지면 「운영 나감 · 확인 전」. PR 없는 일(답 · 결정 · 손일)은 대화 · 작업 기록으로 끝을 셈. 막힘 = 막힘 + 다른 쪽을 기다리는 요청.</p>`
        + `<div class="decs"><h3>정하실 것 ${decs.length}</h3>${decs.length ? decs.map(c => { const q = (String(c.t).match(/Q-\d+/) || [''])[0]; return `<div class="d">${pill(c.k || '결정', 'warn')}${q && !String(c.t).trim().startsWith(q) ? `<b>${E(q)}</b>` : ''}<span class="t">${E(c.t)}</span>${c.r ? `<a href="#" data-tk="${E(c.r.id)}">${E(c.r.id)} ›</a>` : ''}${c.id ? `<a href="${E(cardHref(c.id))}">카드 열기 ›</a>` : ''}</div>`; }).join('') : `<p class="none">지금 답을 기다리는 결정 · 할 일 카드가 없어요${B().cards_n ? ' — 보드 최근 카드 ' + E(B().cards_n) + '장 모두 답함 · 닫음' : ''}${B().cards_at ? ' · ' + E(hhmm(B().cards_at)) + ' 읽음' : ''}.</p>`}</div></div>`;
    }
    // 처리 느림? — 기기별 바쁨(부하 ÷ 코어 %) · 메모리 압박 · 검사 대기 · 일감 대기. 누르면 기기 세션 현황 페이지
    function slowHTML(){
      const v = B().devices, go = onK('devices') ? '<a href="/device-sessions" data-dev>기기 세션 현황 열기 ›</a>' : '';
      if (!v || !(v.list || []).length) return `<div class="bx-tb-slow"><b>처리 느림?</b><span class="tm">기기 현황을 아직 못 받았어요</span>${go}</div>`;
      const hot = d => d.e || d.l >= 85 || d.m >= 70, H = v.list.filter(hot);
      return `<div class="bx-tb-slow"><b>처리 느림?</b><span>${H.length ? '바쁜 기기 ' + H.length + '대' : '기기는 여유 있어요'}</span>${v.list.map(d => `<span class="dv${hot(d) ? ' hot' : ' cool'}">${E(d.n)} ${d.e ? '못 읽음' : E(d.l ?? '?') + '%'}</span>`).join('')}<span class="dv${v.gate > 0 ? ' hot' : ''}">검사 대기 ${E(v.gate ?? '?')}</span><span class="dv">일감 대기 ${E(v.queue ?? '?')}</span>${v.at ? `<span class="tm">${E(ago(v.at))} 기준</span>` : ''}${go}</div>`;
    }
    function reqView(all){
      const now = Date.now(), t0 = day0(), q = V.q.toLowerCase();
      const inWin = t => !V.days || mvOf(t) > now - V.days * 86400e3;
      const hit = t => (!V.ra || t.area === V.ra) && (!q || JSON.stringify(t).toLowerCase().includes(q));
      const base = all.filter(hit), DX = q || V.ra ? [] : (B().decisions || []);
      // 끝 · 안 함은 기본 보기에서 숨김(지우지 않음) — 「끝 n」 칩을 눌렀을 때만 보임. 「모두」도 끝난 것은 뺌
      const F = {'': t => !isDone(t) && (decOf(t).length || EV(t).cnt === '막힘' || (EV(t).cnt === '진행' && inWin(t))), '정하실 것': t => decOf(t).length > 0, '막힘': t => EV(t).cnt === '막힘', '진행': t => EV(t).cnt === '진행' && inWin(t), '끝': t => isDone(t) && inWin(t), '모두': t => !isDone(t) && inWin(t)};
      const n = k => base.filter(F[k]).length + (k === '정하실 것' ? DX.length : 0);
      const rank = t => decOf(t).length ? 0 : EV(t).cnt === '막힘' ? 1 : 2;
      const L = base.filter(F[V.rf] || F['']).sort((a, b) => rank(a) - rank(b) || mvOf(b) - mvOf(a));
      const areas = [...new Set(all.map(t => t.area).filter(Boolean))].sort((a, b) => (String(a).startsWith('회사') ? 0 : 1) - (String(b).startsWith('회사') ? 0 : 1));
      const top = todayHTML(all) + slowHTML()
        + `<div class="bx-tb-sum" role="group" aria-label="요약">${[['', '진행 중', ''], ['진행', '진행', ''], ['막힘', '막힘', 'b'], ['정하실 것', '정하실 것', 'd'], ['끝', '끝', ''], ['모두', '모두', '']].map(([k, l, c]) => `<button type="button" data-sf="${E(k)}" class="${c}${V.rf === k ? ' on' : ''}" aria-pressed="${V.rf === k}">${l}${k && k !== '모두' ? ` <b>${n(k)}</b>` : ''}</button>`).join('')}</div>`;
      const side = [[1, '24시간'], [7, '7일'], [0, '전체']].map(([d, l]) => `<button type="button" class="bx-tb-chip${V.days === d ? ' on' : ''}" data-span="${d}" aria-pressed="${V.days === d}">${l}</button>`).join('')
        + (areas.length > 1 ? ['', ...areas].map(a => `<button type="button" class="bx-tb-chip${V.ra === a ? ' on' : ''}" data-area="${E(a)}" aria-pressed="${V.ra === a}">${E(a ? areaLab(a) : '둘 다')}</button>`).join('') : '');
      const dx = (V.rf === '' || V.rf === '정하실 것') && DX.length ? `<div class="bx-tb-cards" style="margin-bottom:12px">${DX.map(dxcard).join('')}</div>` : '';
      const rest = (err ? `<p class="bx-stp-err">${E(err)}</p>` : !data ? '<p class="bx-stp-mut"><i class="g g-spin"></i></p>'
        : !all.length ? x.empty('아직 올라온 태스크가 없어요', '에이전트 쪽 도구가 boarder 기기 토큰으로 /api/device/taskboard 에 요청을 올리면 여기 떠요.')
        : (dx + groups(L)) || `<p class="bx-stp-mut">${V.rf === '정하실 것' ? '지금 정하실 것이 없어요.' : '이 조건에 맞는 요청이 없어요.'}</p>`);
      return {top, side, rest};
    }
    function deptView(){
      const q = V.q.toLowerCase(), T = B().depts || [], repo = B().repo;
      const hit = t => !q || [t.n, t.t, t.lm, ...(t.m || []).flat(), ...(t.o || []).flat()].join(' ').toLowerCase().includes(q);
      const prs = (L, lab) => L?.length ? `<div class="lbl">${lab} ${L.length}</div><ul>${L.map(a => `<li>${aN(a[0], prU(a[0], repo))} ${a[2] ? '(초안) ' : ''}${E(a[1] || '')}</li>`).join('')}</ul>` : '';
      const card = t => `<div class="bx-tb-tk"><h4>${aN(String(t.n).replace(/^#/, ''), /^\d+$/.test(t.n) ? isU(t.n, repo) : '', /^\d+$/.test(t.n) ? '#' + t.n : t.n)} ${E(t.t || '')}</h4>${pill(t.s || '진행')}${t.big ? pill('요청', '') : ''}${t.w ? `<span class="ow">${E(t.w)}</span>` : ''}${t.lm ? `<div class="lg"><span class="tm">${t.la ? E(md(t.la).slice(0, 5) + ' ' + hhmm(t.la)) : ''}${t.lk ? ' · ' + E(t.lk) : ''}</span>${E(t.lm)}</div>` : ''}${prs(t.m, '머지')}${prs(t.o, '열린 PR')}</div>`;
      let h = '';
      for (const d of [...DORD, '부서 미지정']){
        const all = T.filter(t => (t.d || '부서 미지정') === d && hit(t)); if (!all.length) continue;
        const act = all.filter(t => t.act).sort((a, b) => (b.la || 0) - (a.la || 0)), idle = all.filter(t => !t.act);
        h += `<div class="bx-tb-dh"><h3>${E(d)}</h3><span>움직인 태스크 ${act.length} · 끝 ${act.filter(t => t.s === '끝').length} · 머지 PR ${act.reduce((s, t) => s + (t.m || []).length, 0)} · 열린 PR ${act.reduce((s, t) => s + (t.o || []).length, 0)} · 쉼 ${idle.length}</span></div><div class="bx-tb-cards">${act.map(card).join('')}</div>`;
        if (idle.length) h += `<details class="bx-tb-idle"><summary>24시간 움직임 없음 ${idle.length}개</summary>${idle.map(t => `<div class="r">${E(/^\d+$/.test(t.n) ? '#' + t.n : t.n)} ${E(t.t || '')} ${pill(t.s || '진행')}</div>`).join('')}</details>`;
      }
      return {top: '<h2 class="bx-tb-h2">부서 · 요청별 진행</h2><p class="bx-tb-lead">요청을 부서별로 모았습니다. 상태 · 담당 · 한 일 · 붙은 PR을 확인합니다.</p>', side: '', rest: h || '<p class="bx-stp-mut">없음</p>'};
    }
    function grp(list, open){
      const q = V.q.toLowerCase(), repo = B().repo, f = list.filter(t => (!wf || t.w === wf) && (!q || [t.t, t.n, t.g].join(' ').toLowerCase().includes(q))), g = {};
      f.forEach(t => (g[t.g || '묶음 없음'] = g[t.g || '묶음 없음'] || []).push(t));
      return Object.entries(g).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `<details class="bx-tb-grp"${open || q ? ' open' : ''}><summary>${E(k)}<span class="n">${v.length}개</span></summary>${v.map(t => `<div class="row">${aN(t.n, prU(t.n, repo))}<span>${E(t.t || '')}</span>${t.w ? `<span class="tag${/그쪽|상대/.test(t.w) ? ' dg' : ' us'}">${E(t.w)}</span>` : '<span></span>'}<span class="tm">${t.draft ? '<span class="tag dr">초안</span> ' : ''}${t.stack ? '<span class="tag dr">스택 층</span> ' : ''}${t.at ? E(md(t.at).slice(0, 5) + ' ' + hhmm(t.at)) : ''}</span></div>`).join('')}</details>`).join('') || '<p class="bx-stp-mut">없음</p>';
    }
    function view(){
      const all = data?.tasks || [], b = B();
      if (V.sec === 'dept') return deptView();
      if (V.sec === 'ask') return {top: '<h2 class="bx-tb-h2">확인할 것 — 막힘 · 기다림</h2>', side: '', rest: `<div class="bx-tb-cards">${(b.asks || []).map(a => `<div class="bx-tb-tk ask"><h4>${E(a.t)}</h4><p>${E(a.x || '')}</p></div>`).join('') || '<p class="bx-stp-mut">없음</p>'}</div>`};
      if (V.sec === 'ops') return {top: '<h2 class="bx-tb-h2">확인된 운영 배포</h2>', side: '', rest: `<div class="bx-tb-grp ms-l">${(b.ops || []).map(o => `<div class="ms"><span class="tm">${o.at ? E(md(o.at).slice(0, 5) + ' ' + hhmm(o.at)) : ''}</span><span>${E(o.x)}</span></div>`).join('') || '<div class="ms">없음</div>'}</div>`};
      if (V.sec === 'merged'){ const ws = [...new Set((b.merged || []).map(t => t.w).filter(Boolean))]; return {top: '<h2 class="bx-tb-h2">머지 — 묶음별</h2>', side: ws.length > 1 ? ['', ...ws].map(w => `<button type="button" class="bx-tb-chip${wf === w ? ' on' : ''}" data-wf="${E(w)}">${E(w || '전체')}</button>`).join('') : '', rest: grp(b.merged || [], false)}; }
      if (V.sec === 'open') return {top: '<h2 class="bx-tb-h2">진행 중 — 열린 PR 묶음별</h2>', side: '', rest: grp(b.open || [], false)};
      if (V.sec === 'win') return {top: '<h2 class="bx-tb-h2">지금 도는 일 — 창별 마지막 진행</h2>', side: '', rest: `<div class="bx-tb-grp ms-l">${(b.windows || []).map(w => `<div class="ms"><span class="tm">${w.at ? E(hhmm(w.at)) : ''}</span><span><b>${E(w.win || '')}</b><br>${w.k ? pill(w.k) : ''}${E(w.msg || '')}</span></div>`).join('') || '<div class="ms">없음</div>'}</div>`};
      return reqView(all);
    }
    const cnt = k => { const b = B(), all = data?.tasks || []; return {req: all.length, dept: (b.depts || []).filter(t => t.act).length, ask: (b.asks || []).length, ops: (b.ops || []).length, merged: (b.merged || []).length, open: (b.open || []).length, win: (b.windows || []).length}[k]; };
    const PH = {req: '요청 · 담당 · 번호 찾기', dept: '태스크 · 번호 · PR 검색', merged: '제목 · 번호 · 묶음 검색', open: '제목 · 번호 · 묶음 검색'};
    function draw(){
      if (sub) return;
      if (!el.querySelector('[data-q]')) el.innerHTML = `<div class="bx-tb"><nav class="bx-tb-nav" aria-label="태스크 보기"><h1>${E(K.tasks.name)}</h1><div class="sub" data-gen></div><div data-nav></div></nav><div class="bx-tb-main"><div class="bx-tb-live" data-live></div><div class="bx-stp-slot" data-top></div>`
        + `<div class="bx-tb-flt"><input type="search" placeholder="" value="" data-q aria-label="태스크 찾기"><div class="bx-stp-slot" data-side></div></div><div class="bx-stp-slot" data-rest></div></div></div>`;
      const b = B(), at = data?.at, gen = b.gen_at || at, stale = at && Date.now() - at > 20 * 60_000;
      el.querySelector('[data-gen]').textContent = gen ? '만든 시각 ' + md(gen).slice(0, 5) + ' ' + hhmm(gen) : '';
      el.querySelector('[data-nav]').innerHTML = SECS.map(([k, l]) => `<button type="button" data-sec="${k}" class="${V.sec === k ? 'on' : ''}" aria-pressed="${V.sec === k}">${E(l)} <span>${data ? E(cnt(k) ?? '') : ''}</span></button>`).join('');
      el.querySelector('[data-live]').innerHTML = (at ? `<b>마지막 갱신 ${E(hhmm(at))}</b><span>올라오면 바로 표시 · 30초마다 다시 읽음</span>` : '')
        + (stale ? `<p class="bx-stp-warn" role="status">올리는 쪽(에이전트 도구)이 ${E(ago(at))}부터 새로 올리지 않았어요 — 상태가 늦을 수 있어요</p>` : '');
      const v = view(), qEl = el.querySelector('[data-q]'), ph = PH[V.sec] || '';
      qEl.placeholder = ph; qEl.closest('.bx-tb-flt').hidden = !ph;
      el.querySelector('[data-top]').innerHTML = v.top; el.querySelector('[data-side]').innerHTML = v.side; el.querySelector('[data-rest]').innerHTML = v.rest;
    }
    // 대화: 사람 겹(기본 펼침, 말풍선) · 에이전트 겹(이어진 줄을 한 묶음으로 접음)
    function convoHTML(lines){
      let h = '', run = [], day = '';
      const flush = () => { if (!run.length) return; const key = run[0].k; h += `<details class="bx-cva" data-ak="${E(key)}"${aOpen[key] ? ' open' : ''}><summary>에이전트끼리 ${run.length}개 · ${E(hm(run[0].at))}${run.length > 1 ? '–' + E(hm(run[run.length - 1].at).slice(-5)) : ''}</summary>${run.map(l => `<div class="bx-cvl"><b>${E(l.who || '에이전트')}</b><time>${E(hm(l.at))}</time><div>${TX(l.text)}</div></div>`).join('')}</details>`; run = []; };
      for (const l of lines){
        const d = md(l.at); if (d !== day){ flush(); day = d; h += `<div class="bx-cvd"><span>${E(d)}</span></div>`; }
        if (l.layer === 'agent'){ run.push(l); continue; }
        flush();
        h += `<div class="bx-cvm${l.mine ? ' me' : ''}"><div class="bx-cvh"><b>${E(l.who || (l.mine ? '나' : '에이전트'))}</b><time>${E(hm(l.at).slice(-5))}</time>${l.pending ? '<em class="bx-cvp">전달 대기</em>' : ''}</div><div class="bx-cvb">${TX(l.text)}</div></div>`;
      }
      flush();
      return h || '<p class="bx-stp-mut">이 요청에 닿은 대화를 아직 찾지 못했어요.</p>';
    }
    function drawDet(was){
      if (!sub) return;
      // 말하기 칸은 처음 한 번만 만들고 위쪽만 다시 그림 — 새로 읽기가 쓰는 중인 칸(값 · 커서 · 조합)을 안 건드리고, 보낸 뒤 비우는 칸도 늘 그 칸
      if (!el.querySelector('form[data-sayf]')) el.innerHTML = `<div class="bx-tb-dt"><button type="button" class="bx-tb-back" data-back>← 목록</button><div class="bx-stp-slot" data-det></div>`
        + `<form class="bx-say" data-sayf><textarea data-say rows="2" maxlength="8000" placeholder="이 요청에 말하기 — 에이전트 쪽으로 전해져요" aria-label="이 요청에 말하기"></textarea><button type="submit" class="bx-say-go" aria-label="보내기">${svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', 18)}</button></form></div>`;
      const box = el.querySelector('[data-det]'), form = el.querySelector('form[data-sayf]'), t = det?.task;
      form.querySelector('.bx-say-go').disabled = sending; form.style.display = t ? '' : 'none';
      if (!t){ box.innerHTML = detErr ? `<p class="bx-stp-err">${E(detErr)}</p>` : '<p class="bx-stp-mut"><i class="g g-spin"></i></p>'; return; }
      const ev = EV(t), st = t.status || ST[t.state], fin = ev.k === '끝', repo = detRepo, d = decOf(t), nx1 = t.x?.next1 || t.next;
      const prLi = p => `<li>${aN(p.n, p.url || prU(p.n, repo))} ${E(p.title || '')} · ${E({open: '열림', merged: '머지 · 운영 배포 미확인', closed: '닫힘', deployed: '운영에 나감'}[p.state] || p.state)}</li>`;
      const tasks = (t.tasks || []).map(n => { const m = String(n).match(/^#?(\d+)$/); return `<li>${m ? aN(m[1], isU(m[1], repo)) : E(n)}</li>`; }).join('');
      const human = (det.convo || []).filter(l => l.layer !== 'agent').length;
      box.innerHTML = `<h2 class="bx-td-t">${E(t.title || t.id)}</h2>${pill(SL(ev.k), STC(ev.c || ev.k))}${t.x?.split_of ? `<span class="bx-tb-sp">${E(t.x.split_of)} 에서 따로 묶음</span>` : ''}${t.x?.confidence === '낮음' ? ' <span class="bx-tb-cf">짝 확신 낮음</span>' : ''}`
        + `<div class="bx-tb-meta">${E(t.id)}${t.requested_at ? ' · ' + E(md(t.requested_at).slice(0, 5) + ' ' + hhmm(t.requested_at)) + ' 요청' : ''}${t.q ? ' · ' + E(t.q) : ''}${t.assignee ? ' · 담당 ' + E(t.assignee) : ''} · 마지막 움직임 ${E(ago(mvOf(t)))}</div>`
        + `<div class="bx-tb-glance">${d.map(c => `<div class="bx-tb-decb">정하실 것 · ${E(c.k || '')} · ${E(c.t)} ${c.id ? `<a href="${E(cardHref(c.id))}">카드 열기 ›</a>` : ''}</div>`).join('')}`
        + (st === '막힘' || t.state === 'blocked' ? `<p class="bx-tb-why"><b>막힌 까닭</b>${E(nx1 || '')}</p>` : '')
        + (t.x?.now && !fin && st !== '안 함' ? `<p><b>지금</b>${E(t.x.now)}</p>` : '')
        + (st !== '막힘' && t.state !== 'blocked' && !fin && st !== '안 함' && nx1 ? `<p><b>다음</b>${E(nx1)}</p>` : '')
        + (t.x?.last?.text ? `<p class="ow"><b>마지막 말</b>${E(t.x.last.who || '')} · ${E(t.x.last.text)}${t.x.last.at ? ' · ' + E(ago(t.x.last.at)) : ''}</p>` : '') + '</div>'
        + (t.quote ? `<blockquote class="bx-tb-q">${TX(t.quote)}</blockquote>` : '')
        + (ev.why || ev.who ? `<p class="ow bx-tb-evw"><b>근거</b> ${E(ev.why || '')}${ev.who ? ' · 기다림: ' + E(ev.who) : ''}</p>` : '')
        + `<div class="bx-tb-facts">${t.done ? `<div><b>한 일</b>${TX(t.done)}</div>` : ''}${t.next && (fin || t.x?.next1) ? `<div><b>남은 것</b>${TX(t.next)}</div>` : ''}<div><b>붙은 태스크 · PR</b>${tasks || (t.prs || []).length ? `<ul>${tasks}${(t.prs || []).map(prLi).join('')}</ul>` : '없음'}</div></div>`
        + (t.logs?.length ? `<details class="bx-td-log"><summary>작업 기록 ${t.logs.length}줄</summary><ul>${t.logs.map(l => `<li>${TX(l)}</li>`).join('')}</ul></details>` : '')
        + `<h3 class="bx-tb-layer">사람 ↔ 에이전트 <small>대화 ${human}개 · 에이전트끼리 줄은 접혀 있어요</small></h3><div class="bx-cv">${convoHTML(det.convo || [])}</div>`;
      if (was >= 0 && det.convo.length > was) el.querySelector('.bx-cv')?.lastElementChild?.scrollIntoView({block: 'nearest'});
    }
    function route(s){
      sub = s || ''; det = null; detErr = ''; detSeq++; el.innerHTML = '';   // 칸은 화면(태스크)마다 새로 — 쓰던 글이 다른 태스크로 따라가지 않음
      if (sub){ drawDet(-1); loadDet(sub); } else { draw(); loadList(); }
      document.querySelector('.wrap')?.scrollTo(0, 0);
    }
    onSearch(el, v => { V.q = v; draw(); });
    el.addEventListener('keydown', e => {
      if (e.target.matches('textarea[data-say]') && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing){ e.preventDefault(); el.querySelector('form[data-sayf]')?.requestSubmit(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('article[data-tk]')){ e.preventDefault(); x.go(e.target.dataset.tk); route(e.target.dataset.tk); }
    });
    el.addEventListener('toggle', e => { const d = e.target.closest?.('details[data-ak]'); if (d) aOpen[d.dataset.ak] = d.open; }, true);
    el.addEventListener('submit', async e => {
      if (!e.target.matches('form[data-sayf]')) return; e.preventDefault();
      const ta = el.querySelector('textarea[data-say]'), sent = ta.value, text = sent.trim(); if (!text || sending || !sub) return;
      const btn = el.querySelector('.bx-say-go'); sending = true; btn.disabled = true; const id = sub;
      try {
        const j = await x.api(`api/me/taskboard/${encodeURIComponent(id)}/say`, {method: 'POST', body: JSON.stringify({text})});
        if (ta.value === sent) ta.value = '';   // 보내는 사이 더 쓴 글은 둠
        if (sub === id){ detSeq++; if (det && !det.convo.some(l => l.k === j.line.k)) det.convo.push(j.line); }
      } catch (er) { (typeof toast === 'function' ? toast : alert)(er.message); }
      sending = false; btn.disabled = false; if (sub === id && det){ drawDet(det.convo.length - 1); }
    });
    el.addEventListener('click', e => {
      if (e.target.closest('[data-dev]')){ e.preventDefault(); return window.BXStatus?.open('devices'); }
      const tk = e.target.closest('[data-tk]'); if (tk && !(e.target.closest('a[href]') && !e.target.closest('a[data-tk]'))){ e.preventDefault(); x.go(tk.dataset.tk); return route(tk.dataset.tk); }
      if (e.target.closest('[data-back]')){ x.go(''); return route(''); }
      const sc = e.target.closest('[data-sec]'); if (sc){ V.sec = sc.dataset.sec; wf = ''; save(); draw(); return document.querySelector('.wrap')?.scrollTo(0, 0); }
      const dy = e.target.closest('[data-day]'); if (dy){ V.tday = +dy.dataset.day; return draw(); }
      const tf = e.target.closest('[data-tf]'); if (tf){ V.rf = tf.dataset.tf; if (V.rf !== '정하실 것') V.days = V.tday ? 2 : 1; save(); return draw(); }
      const sp = e.target.closest('[data-span]'); if (sp){ V.days = +sp.dataset.span; save(); return draw(); }
      const sf = e.target.closest('[data-sf]'); if (sf){ V.rf = sf.dataset.sf; save(); return draw(); }
      const ar = e.target.closest('[data-area]'); if (ar){ V.ra = ar.dataset.area; save(); return draw(); }
      const w = e.target.closest('[data-wf]'); if (w){ wf = w.dataset.wf; return draw(); }
    });
    const stop = [every(30_000, () => { if (!sub) loadList(); }), every(15_000, () => { if (sub) loadDet(sub); })];
    route(sub);
    return {route, unmount(){ stop.forEach(f => f()); }};
  }};

  const WS = {working: '일하는 중', question: '기다림', idle: '쉼', parked: '주차', done: '끝', open: '열림'};
  const WORDER = {question: 0, working: 1, idle: 2, open: 3, parked: 4, done: 5};
  const gb = mb => mb == null ? '?' : String(Math.round(mb / 1024));
  const BAR = (v, warn = 80, bad = 92) => v == null ? '<span class="bx-fb-m">—</span>'
    : `<span class="bx-fb-bar"><i style="width:${Math.max(0, Math.min(100, +v))}%"${+v >= bad ? ' data-x="bad"' : +v >= warn ? ' data-x="warn"' : ''}></i></span><b>${Math.round(+v)}%</b>`;
  // 초기화 시각(ms · 초 숫자나 ISO 글) → 「주간 초기화까지 n시간」
  const untilH = r => { if (r == null || r === '') return null; let t = typeof r === 'number' || /^\d+(\.\d+)?$/.test(String(r)) ? +r : Date.parse(String(r)); if (!t) return null; if (t < 1e12) t *= 1000; const h = (t - Date.now()) / 3600e3; return h < 0 ? null : h; };
  const hms = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  const issuesOf = s => [...new Set((String(s || '').match(/#\d{1,6}\b/g) || []))].slice(0, 6);
  const issueLink = (n, repo) => /^[\w.-]+\/[\w.-]+$/.test(repo || '') ? `<a href="https://github.com/${E(repo)}/issues/${E(n.slice(1))}" target="_blank" rel="noopener noreferrer">${E(n)}</a>` : `<span>${E(n)}</span>`;
  PAGES.devices = {mount(el, x){
    let data = null, err = '', hidOpen = false, busy = '';
    const load = () => x.api('api/me/devboard').then(j => { data = j; err = ''; draw(); }).catch(e => { err = e.message; draw(); });
    const acctLi = a => {
      const lab = a.acct || a.name || (a.email || '').split('@')[0] || '계정';
      if (a.status === 'logged_out') return `<li><code>${E(lab)}</code> <span class="bx-fb-x">로그아웃</span></li>`;
      const h = untilH(a.r7), left = a.p7 == null ? '?' : Math.max(0, 100 - Math.round(+a.p7));
      return `<li><code>${E(lab)}</code> ${a.p5 == null ? '' : `5시간 ${BAR(a.p5, 80, 92)} · `}주간 ${BAR(a.p7, 80, 95)} <span class="bx-fb-m">남은 ${left}%${h == null ? '' : ` · 주간 초기화까지 ${h >= 1 ? Math.round(h) + '시간' : '1시간 안'}`}</span></li>`;
    };
    const winTr = w => {
      const is = issuesOf(w.title);
      return `<tr><td>${E(w.title || w.key)}</td><td>${is.length ? is.map(n => issueLink(n, w.repo)).join(' ') : '<span class="bx-fb-m">업무 번호 없음</span>'}</td><td>${E(WS[w.state] || w.state || '?')}</td><td><code>${E(w.acct || '?')}</code></td><td class="bx-fb-m">${E([w.engine, w.tool].filter(Boolean).join(' ') || '—')}</td></tr>`;
    };
    function sec(d){
      const L = d.load, seen = d.seen_at, stale = !!seen && Date.now() - seen > 25 * 60_000;
      if (!L && !(d.windows || []).length) return `<section class="bx-fb off"><h2><span>${E(d.name)} <small>보고 없음 — 이 기기에서 boarder watch · engine 이 아직 안 보냄</small></span>${hideBtn(d)}</h2></section>`;
      const ws = [...(d.windows || [])].sort((a, b) => (WORDER[a.state] ?? 9) - (WORDER[b.state] ?? 9) || (b.state_at || 0) - (a.state_at || 0));
      const mem = L && L.mem_total_mb ? Math.round(100 - (L.mem_avail_mb ?? 0) / L.mem_total_mb * 100) : null;
      const acc = [...(d.accounts || []), ...(d.codex ? [{acct: 'codex', p5: d.codex.p5, p7: d.codex.p7}] : [])];
      return `<section class="bx-fb${stale ? ' stale' : ''}"><h2><span>${E(d.name)} <small>${[d.os, seen ? x.ago(seen) : '아직 안 보냄', d.metrics_at ? '부하 받은 때 ' + hms(d.metrics_at) : ''].filter(Boolean).map(E).join(' · ')}${stale ? ' · 오래됨' : ''}</small></span>${hideBtn(d)}</h2>`
        + `<div class="bx-fb-k"><div><span>세션</span><b>${ws.length}</b></div><div><span>부하(5분)</span><b>${E(L?.load5 ?? L?.load1 ?? '?')}</b><em>/ 코어 ${E(L?.cores ?? '?')}</em></div><div><span>메모리</span>${BAR(mem, 80, 90)}<em>${E(gb(L?.mem_total_mb))}GB</em></div></div>`
        + `<ul class="bx-fb-a">${acc.map(acctLi).join('') || '<li class="bx-fb-m">계정 사용량 없음</li>'}</ul>`
        + (ws.length ? `<table class="bx-fb-t"><thead><tr><th>창</th><th>맡은 업무</th><th>상태</th><th>계정</th><th>자리</th></tr></thead><tbody>${ws.map(winTr).join('')}</tbody></table>` : '<p class="bx-fb-m">도는 세션 없음</p>')
        + `</section>`;
    }
    const hideBtn = d => `<button type="button" class="bx-fb-hide" data-hide="${E(d.id)}" aria-label="${E(d.name)} 숨기기"${busy === d.id ? ' disabled' : ''}>숨기기</button>`;
    function draw(){
      const all = data?.devices || [], vis = all.filter(d => !d.hidden), hid = all.filter(d => d.hidden);
      el.innerHTML = `<div class="bx-stp-h"><h1>${E(K.devices.name)}</h1><p>기기마다 지금 도는 세션 · 맡은 업무 · 부하 · 계정 한도. 창은 1분 · 부하는 1~5분마다 기기가 올리고, 이 판은 15초마다 다시 읽어요.</p></div>`
        + `<div class="bx-fb-live"><b>마지막 갱신 ${data?.at ? E(hms(data.at)) : '—'}</b></div>`
        + (err ? `<p class="bx-stp-err">${E(err)}</p>` : !data ? '<p class="bx-stp-mut"><i class="g g-spin"></i></p>'
          : !all.length ? x.empty('아직 붙은 기기가 없어요', '기기에서 boarder setup 으로 이 계정에 붙이면 그 기기의 창 · 부하가 여기 떠요.', ICON.devices)
          : (vis.map(sec).join('') || '<p class="bx-stp-mut">보이는 기기가 없어요 — 아래 「숨긴 기기」에서 켜요</p>')
            + (hid.length ? `<button type="button" class="bx-sec bx-fh bx-stp-old" data-hidl aria-expanded="${hidOpen}">숨긴 기기 ${hid.length}</button>${hidOpen ? `<div class="bx-dvh">${hid.map(d => `<div class="bx-dvh-r"><b>${E(d.name)}</b><small>창 ${(d.windows || []).length}</small><button type="button" class="bx-fb-hide" data-show="${E(d.id)}" aria-label="${E(d.name)} 보이기"${busy === d.id ? ' disabled' : ''}>보이기</button></div>`).join('')}</div>` : ''}` : ''));
    }
    const setHide = async (id, hide) => {
      if (busy) return; busy = id; draw();
      try { await x.api('api/me/devboard/hide', {method: 'POST', body: JSON.stringify({device: id, hide})}); const d = data?.devices?.find(z => z.id === id); if (d) d.hidden = hide; }
      catch (e) { (typeof toast === 'function' ? toast : alert)(e.message); }
      busy = ''; draw();
    };
    el.addEventListener('click', e => {
      const h = e.target.closest('[data-hide]'); if (h) return setHide(h.dataset.hide, true);
      const s = e.target.closest('[data-show]'); if (s) return setHide(s.dataset.show, false);
      if (e.target.closest('[data-hidl]')){ hidOpen = !hidOpen; return draw(); }
    });
    // 15초마다(탭이 보일 때) + 탭이 다시 보이면 바로 — 기기가 올린 값이 1분 안에 보이게
    const stop = every(15_000, load), vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    draw(); load();
    return {route(){}, unmount(){ stop(); document.removeEventListener?.('visibilitychange', vis); }};
  }};

  window.BXStatus = {
    open: (k, sub) => open(k, false, sub), close: () => close(), cur: () => cur, page: (k, p) => { PAGES[k] = p; if (cur === k){ const c = cur; cur = null; open(c, true); } },
    side: (it, top) => Object.keys(K).filter(onK).map(k => it('pg:' + k, ICON[k], K[k].name, '', top === 'pg:' + k)).join(''),
    sig: () => (onK('tasks') ? 't' : '') + (onK('devices') ? 'd' : '') + (cur || ''),
    feats: () => ({...F}), api, E,
  };
})();
