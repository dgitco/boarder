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
    cur = k; R.classList.add('bx-stpg'); box.hidden = false;
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

  // ── 태스크 현황: 목록(검색 · 상태 칩 · 기간 · 묶음) → 세부(원문 · 상태 · 담당 · PR · 대화 두 겹 · 말하기)
  const ST = {working: '진행', blocked: '막힘', waiting: '기다림', done: '끝', cancelled: '안 함'};
  const PRS = {open: '열림', merged: '머지', closed: '닫힘', deployed: '운영에 나감'};
  const chip = s => `<em class="bx-stc" data-st="${E(s)}">${E(ST[s] || s)}</em>`;
  PAGES.tasks = {mount(el, x){
    const V = (() => { try { return {q: '', st: '', span: '7', area: '', ...JSON.parse(localStorage.getItem('bx-stp-tv') || '{}'), q: ''}; } catch { return {q: '', st: '', span: '7', area: ''}; } })();
    const save = () => { try { localStorage.setItem('bx-stp-tv', JSON.stringify({st: V.st, span: V.span, area: V.area})); } catch {} };
    let data = null, err = '', sub = x.sub, det = null, detErr = '', oldOpen = false, sending = false, aOpen = {};
    let detSeq = 0;   // 세부 읽기 번호 — 말하기가 끝나면 그 전에 나간 새로 읽기 응답(방금 쓴 줄이 없는 옛 값)은 버림
    const loadList = () => x.api('api/me/taskboard').then(j => { data = j; err = ''; if (!sub) draw(); }).catch(e => { err = e.message; if (!sub) draw(); });
    const loadDet = id => { const n = ++detSeq; return x.api('api/me/taskboard/' + encodeURIComponent(id)).then(j => { if (sub !== id || n !== detSeq) return; const was = det && det.task.id === id ? det.convo.length : -1; det = j; detErr = ''; drawDet(was); })
      .catch(e => { if (sub !== id || n !== detSeq) return; if (det && e.status !== 403 && e.status !== 404) return; detErr = e.message; det = null; drawDet(-1); }); };   // 잠깐의 오류는 보던 화면 그대로(다음 회차에 다시)
    const inSpan = t => V.span === 'all' || !['done', 'cancelled'].includes(t.state) || Date.now() - (t.updated_at || 0) < +V.span * 86400_000;
    const old = t => ['done', 'cancelled'].includes(t.state) && Date.now() - (t.completed_at || t.updated_at || 0) > 7 * 86400_000;
    const hit = t => !V.q || [t.id, t.title, t.quote, t.dept, t.assignee, t.q, ...(t.tasks || []), ...(t.prs || []).map(p => '#' + p.n)].join(' ').toLowerCase().includes(V.q.toLowerCase());
    function row(t){
      const meta = [t.assignee || t.dept, t.q, t.prs?.length ? `PR ${t.prs.length}` : '', t.lines ? `대화 ${t.lines}` : '', ago(t.updated_at)].filter(Boolean);
      return `<button type="button" class="bx-tr" data-tk="${E(t.id)}"><span class="bx-tid">${E(t.id)}</span><span class="bx-tm"><b>${E(t.title || t.quote || t.id)}</b><small>${meta.map(E).join(' · ')}</small></span>${chip(t.state)}</button>`;
    }
    function draw(){
      if (sub) return;
      const all = data?.tasks || [], areas = [...new Set(all.map(t => t.area).filter(Boolean))];
      if (V.area && !areas.includes(V.area)) V.area = '';
      const base = all.filter(t => (!V.area || t.area === V.area) && inSpan(t) && hit(t)), cnt = s => base.filter(t => !s || t.state === s).length;
      const list = base.filter(t => !V.st || t.state === V.st), now = list.filter(t => !old(t)), past = list.filter(old);
      const stale = data?.at && Date.now() - data.at > 20 * 60_000;
      paintList(el, {q: V.q, ph: '찾기 — 제목 · 원문 · 담당 · #번호', label: '태스크 찾기'},
        x.head.replace('</p></div>', `${data?.at ? ` · 마지막으로 올라온 때 ${E(hm(data.at))}` : ''}</p></div>`)
        + (stale ? `<p class="bx-stp-warn" role="status">올리는 쪽(에이전트 도구)이 ${E(ago(data.at))}부터 새로 올리지 않았어요 — 상태가 늦을 수 있어요</p>` : ''),
        `<div class="bx-seg" role="group" aria-label="기간">${[['1', '24시간'], ['7', '7일'], ['all', '전체']].map(([k, n]) => `<button type="button" data-span="${k}" aria-pressed="${V.span === k}">${n}</button>`).join('')}</div>`,
        (areas.length > 1 ? `<div class="bx-stp-chips" role="group" aria-label="묶음">${['', ...areas].map(a => `<button type="button" class="bx-ch" data-area="${E(a)}" aria-pressed="${V.area === a}">${E(a || '모든 묶음')}</button>`).join('')}</div>` : '')
        + `<div class="bx-stp-chips" role="group" aria-label="상태">${['', ...Object.keys(ST)].map(s => `<button type="button" class="bx-ch" data-sf="${s}" aria-pressed="${V.st === s}">${s ? `<i class="bx-dot" data-st="${s}"></i>` : ''}${s ? ST[s] : '전체'} <span>${cnt(s)}</span></button>`).join('')}</div>`
        + (err ? `<p class="bx-stp-err">${E(err)}</p>` : !data ? '<p class="bx-stp-mut"><i class="g g-spin"></i></p>'
          : !all.length ? x.empty('아직 올라온 태스크가 없어요', '에이전트 쪽 도구가 boarder 기기 토큰으로 /api/device/taskboard 에 요청을 올리면 여기 떠요.')
          : `<div class="bx-tl">${now.map(row).join('') || '<p class="bx-stp-mut">조건에 맞는 태스크가 없어요</p>'}</div>`
            + (past.length ? `<button type="button" class="bx-sec bx-fh bx-stp-old" data-old aria-expanded="${oldOpen}">지난 끝 ${past.length}</button>${oldOpen ? `<div class="bx-tl">${past.map(row).join('')}</div>` : ''}` : '')));
    }
    // 대화: 사람 겹(기본 펼침, 말풍선) · 에이전트 겹(이어진 줄을 한 묶음으로 접음)
    function convoHTML(lines){
      let h = '', run = [], day = '';
      const flush = () => { if (!run.length) return; const key = run[0].k; h += `<details class="bx-cva" data-ak="${E(key)}"${aOpen[key] ? ' open' : ''}><summary>에이전트끼리 ${run.length}개 · ${E(hm(run[0].at))}${run.length > 1 ? '–' + E(hm(run[run.length - 1].at).slice(-5)) : ''}</summary>${run.map(l => `<div class="bx-cvl"><b>${E(l.who || '에이전트')}</b><time>${E(hm(l.at))}</time><div>${TX(l.text)}</div></div>`).join('')}</details>`; run = []; };
      for (const l of lines){
        const d = hm(l.at).split(' ')[0]; if (d !== day){ flush(); day = d; h += `<div class="bx-cvd"><span>${E(d)}</span></div>`; }
        if (l.layer === 'agent'){ run.push(l); continue; }
        flush();
        h += `<div class="bx-cvm${l.mine ? ' me' : ''}"><div class="bx-cvh"><b>${E(l.who || (l.mine ? '나' : '에이전트'))}</b><time>${E(hm(l.at).slice(-5))}</time>${l.pending ? '<em class="bx-cvp">전달 대기</em>' : ''}</div><div class="bx-cvb">${TX(l.text)}</div></div>`;
      }
      flush();
      return h || '<p class="bx-stp-mut">아직 대화가 없어요</p>';
    }
    function drawDet(was){
      if (!sub) return;
      // 말하기 칸은 처음 한 번만 만들고 위쪽만 다시 그림 — 새로 읽기가 쓰는 중인 칸(값 · 커서 · 조합)을 안 건드리고, 보낸 뒤 비우는 칸도 늘 그 칸
      if (!el.querySelector('form[data-sayf]')) el.innerHTML = `<button type="button" class="bx-stp-back" data-back>${svg('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>', 16)}<span>태스크 목록</span></button><div class="bx-stp-slot" data-det></div>`
        + `<form class="bx-say" data-sayf><textarea data-say rows="2" maxlength="8000" placeholder="이 태스크에 말하기 — 에이전트 쪽으로 전해져요" aria-label="이 태스크에 말하기"></textarea><button type="submit" class="bx-say-go" aria-label="보내기">${svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', 18)}</button></form>`;
      const box = el.querySelector('[data-det]'), form = el.querySelector('form[data-sayf]'), t = det?.task;
      form.querySelector('.bx-say-go').disabled = sending; form.style.display = t ? '' : 'none';
      if (!t){ box.innerHTML = detErr ? `<p class="bx-stp-err">${E(detErr)}</p>` : '<p class="bx-stp-mut"><i class="g g-spin"></i></p>'; return; }
      const prs = (t.prs || []).map(p => { const lab = `#${p.n} ${PRS[p.state] || p.state}`; return p.url ? `<a class="bx-pr" data-ps="${E(p.state)}" href="${E(p.url)}" target="_blank" rel="noopener noreferrer">${E(lab)}</a>` : `<span class="bx-pr" data-ps="${E(p.state)}">${E(lab)}</span>`; }).join('');
      const kv = [['담당', t.assignee], ['부서', t.dept], ['묶음', t.area], ['상태 글', t.status !== ST[t.state] ? t.status : ''], ['표지', t.q], ['요청', t.requested_at ? hm(t.requested_at) : ''], ['갱신', t.updated_at ? hm(t.updated_at) : '']].filter(([, v]) => v);
      box.innerHTML = `<div class="bx-td-h"><span class="bx-tid">${E(t.id)}</span>${chip(t.state)}</div><h2 class="bx-td-t">${E(t.title || t.id)}</h2>`
        + `<dl class="bx-td-kv">${kv.map(([k, v]) => `<div><dt>${E(k)}</dt><dd>${E(v)}</dd></div>`).join('')}</dl>`
        + (t.quote ? `<blockquote class="bx-td-q">${TX(t.quote)}</blockquote>` : '')
        + ((t.done || t.next) ? `<div class="bx-td-2">${t.done ? `<section><h3>한 일</h3><p>${TX(t.done)}</p></section>` : ''}${t.next ? `<section><h3>남은 것</h3><p>${TX(t.next)}</p></section>` : ''}</div>` : '')
        + (prs || t.tasks?.length ? `<div class="bx-td-l">${prs ? `<div><h3>PR</h3><div class="bx-prs">${prs}</div></div>` : ''}${t.tasks?.length ? `<div><h3>붙은 태스크</h3><div class="bx-prs">${t.tasks.map(n => `<span class="bx-pr">${E(n)}</span>`).join('')}</div></div>` : ''}</div>` : '')
        + (t.logs?.length ? `<details class="bx-td-log"><summary>작업 기록 ${t.logs.length}줄</summary><ul>${t.logs.map(l => `<li>${TX(l)}</li>`).join('')}</ul></details>` : '')
        + `<h3 class="bx-cv-h">대화</h3><div class="bx-cv">${convoHTML(det.convo || [])}</div>`;
      if (was >= 0 && det.convo.length > was) el.querySelector('.bx-cv')?.lastElementChild?.scrollIntoView({block: 'nearest'});
    }
    function route(s){
      sub = s || ''; det = null; detErr = ''; detSeq++; el.innerHTML = '';   // 칸은 화면(태스크)마다 새로 — 쓰던 글이 다른 태스크로 따라가지 않음
      if (sub){ drawDet(-1); loadDet(sub); } else { draw(); loadList(); }
      document.querySelector('.wrap')?.scrollTo(0, 0);
    }
    onSearch(el, v => { V.q = v; draw(); });
    el.addEventListener('keydown', e => { if (e.target.matches('textarea[data-say]') && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing){ e.preventDefault(); el.querySelector('form[data-sayf]')?.requestSubmit(); } });
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
      const tk = e.target.closest('[data-tk]'); if (tk){ x.go(tk.dataset.tk); return route(tk.dataset.tk); }
      if (e.target.closest('[data-back]')){ x.go(''); return route(''); }
      const sp = e.target.closest('[data-span]'); if (sp){ V.span = sp.dataset.span; save(); return draw(); }
      const sf = e.target.closest('[data-sf]'); if (sf){ V.st = sf.dataset.sf; save(); return draw(); }
      const ar = e.target.closest('[data-area]'); if (ar){ V.area = ar.dataset.area; save(); return draw(); }
      if (e.target.closest('[data-old]')){ oldOpen = !oldOpen; return draw(); }
    });
    const stop = [every(30_000, () => { if (!sub) loadList(); }), every(15_000, () => { if (sub) loadDet(sub); })];
    route(sub);
    return {route, unmount(){ stop.forEach(f => f()); }};
  }};

  const WS = {working: '일하는 중', question: '물음', idle: '쉼', parked: '주차', done: '끝', open: '열림'};
  const WDOT = {working: 'working', question: 'waiting', idle: 'done', parked: 'cancelled', done: 'done', open: 'done'};
  const WORDER = {question: 0, working: 1, idle: 2, open: 3, parked: 4, done: 5};
  const gb = mb => mb == null ? '' : (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + 'GB';
  const pct = v => v == null ? '' : Math.round(v) + '%';
  PAGES.devices = {mount(el, x){
    const V = (() => { try { return {ws: '', q: '', ...JSON.parse(localStorage.getItem('bx-stp-dv') || '{}'), q: ''}; } catch { return {ws: '', q: ''}; } })();
    let data = null, err = '', hidOpen = false, busy = '';
    const load = () => x.api('api/me/devboard').then(j => { data = j; err = ''; draw(); }).catch(e => { err = e.message; draw(); });
    const acctRow = a => {
      const lab = a.acct ? a.acct + (a.name ? ' · ' + a.name : '') : a.name || (a.email || '').split('@')[0] || '계정';
      if (a.status === 'logged_out') return `<div class="bx-ac"><b>${E(lab)}</b><span class="bx-ac-x">로그아웃</span></div>`;
      const bar = (v, n) => v == null ? '' : `<span class="bx-ac-b" title="${n} ${pct(v)} 씀"><i style="width:${Math.max(0, Math.min(100, v))}%"${v >= 85 ? ' data-hot' : ''}></i></span><small>${n} ${pct(v)}</small>`;
      return `<div class="bx-ac"><b>${E(lab)}</b>${bar(a.p7, '주간')}${bar(a.p5, '5시간')}${a.rate ? `<small class="bx-ac-r">하루 +${E(Math.round(a.rate * 24))}%</small>` : ''}</div>`;
    };
    const win = w => `<div class="bx-dw"><i class="bx-dot" data-st="${WDOT[w.state] || 'done'}" title="${E(WS[w.state] || w.state)}"></i><span class="bx-dw-t"><b>${E(w.title || w.key)}</b><small>${[WS[w.state] || w.state, w.tool, w.acct ? '계정 ' + w.acct : '', w.repo ? w.repo + (w.branch ? ' · ' + w.branch : '') : '', w.note].filter(Boolean).map(E).join(' · ')}</small></span><time>${E(ago(w.state_at))}</time></div>`;
    function card(d){
      const ws = (d.windows || []).filter(w => (!V.ws || w.state === V.ws) && (!V.q || (w.title + ' ' + w.repo + ' ' + w.acct + ' ' + d.name).toLowerCase().includes(V.q.toLowerCase())))
        .sort((a, b) => (WORDER[a.state] ?? 9) - (WORDER[b.state] ?? 9) || (b.state_at || 0) - (a.state_at || 0));
      const L = d.load, ag = L ? Object.values(L.agents || {}).reduce((a, b) => a + (+b || 0), 0) : 0;
      const loads = L ? [L.cpu != null ? ['CPU', pct(L.cpu)] : null, L.load1 != null && L.cores ? ['부하', `${L.load1}/${L.cores}`] : null, L.mem_avail_mb != null ? ['메모리 남음', gb(L.mem_avail_mb) + (L.mem_total_mb ? ' / ' + gb(L.mem_total_mb) : '')] : null, L.disk_pct != null ? ['디스크', pct(L.disk_pct)] : null, ag ? ['AI 창', String(ag)] : null].filter(Boolean) : [];
      const cnt = s => (d.windows || []).filter(w => w.state === s).length;
      return `<article class="bx-dv"><div class="bx-dv-hd"><i class="bx-on" data-on="${d.online ? 1 : 0}" title="${d.online ? '켜짐' : '꺼짐'}"></i><div class="bx-dv-n"><b>${E(d.name)}</b><small>${[d.os, d.cli ? 'boarder ' + d.cli : '', d.seen_at ? (d.online ? '켜짐 · ' : '마지막 ') + ago(d.seen_at) : '아직 안 보냄'].filter(Boolean).map(E).join(' · ')}</small></div>`
        + `<button type="button" role="switch" class="bxs-sw bx-dv-sw" aria-checked="true" data-hide="${E(d.id)}" aria-label="${E(d.name)} 보이기"${busy === d.id ? ' disabled' : ''}><i></i></button></div>`
        + (loads.length ? `<div class="bx-dv-ld">${loads.map(([k, v]) => `<span><small>${E(k)}</small><b>${E(v)}</b></span>`).join('')}</div>` : `<p class="bx-stp-mut bx-dv-nm">부하 값이 아직 없어요 — 이 기기에서 boarder watch 가 돌면 떠요</p>`)
        + (d.accounts?.length || d.codex ? `<div class="bx-dv-ac">${(d.accounts || []).map(acctRow).join('')}${d.codex ? acctRow({acct: 'codex', name: d.codex.plan, p5: d.codex.p5, p7: d.codex.p7}) : ''}</div>` : '')
        + `<div class="bx-dv-wh"><span>창 ${(d.windows || []).length}</span>${['working', 'question', 'idle'].map(s => cnt(s) ? `<span><i class="bx-dot" data-st="${WDOT[s]}"></i>${WS[s]} ${cnt(s)}</span>` : '').join('')}</div>`
        + `<div class="bx-dv-wl">${ws.map(win).join('') || `<p class="bx-stp-mut">${(d.windows || []).length ? '조건에 맞는 창이 없어요' : '열린 창이 없어요'}</p>`}</div></article>`;
    }
    function draw(){
      const all = data?.devices || [], vis = all.filter(d => !d.hidden), hid = all.filter(d => d.hidden), W = vis.flatMap(d => d.windows || []);
      const cnt = s => W.filter(w => !s || w.state === s).length;
      paintList(el, {q: V.q, ph: '찾기 — 창 이름 · 리포 · 계정 · 기기', label: '창 찾기'},
        x.head.replace('</p></div>', `${data?.at ? ` · 받은 때 ${E(hm(data.at))}` : ''}</p></div>`), '',
        `<div class="bx-stp-chips" role="group" aria-label="창 상태">${['', 'working', 'question', 'idle', 'parked'].map(s => `<button type="button" class="bx-ch" data-ws="${s}" aria-pressed="${V.ws === s}">${s ? `<i class="bx-dot" data-st="${WDOT[s]}"></i>${WS[s]}` : '모든 창'} <span>${cnt(s)}</span></button>`).join('')}<span class="bx-dv-sum">기기 ${vis.length}${all.some(d => d.online) ? ` · 켜짐 ${vis.filter(d => d.online).length}` : ''}</span></div>`
        + (err ? `<p class="bx-stp-err">${E(err)}</p>` : !data ? '<p class="bx-stp-mut"><i class="g g-spin"></i></p>'
          : !all.length ? x.empty('아직 붙은 기기가 없어요', '기기에서 boarder setup 으로 이 계정에 붙이면 그 기기의 창 · 부하가 여기 떠요.', ICON.devices)
          : `<div class="bx-dvs">${vis.map(card).join('') || '<p class="bx-stp-mut">보이는 기기가 없어요 — 아래 「숨긴 기기」에서 켜요</p>'}</div>`
            + (hid.length ? `<button type="button" class="bx-sec bx-fh bx-stp-old" data-hidl aria-expanded="${hidOpen}">숨긴 기기 ${hid.length}</button>${hidOpen ? `<div class="bx-dvh">${hid.map(d => `<div class="bx-dvh-r"><i class="bx-on" data-on="${d.online ? 1 : 0}"></i><b>${E(d.name)}</b><small>창 ${(d.windows || []).length}</small><button type="button" role="switch" class="bxs-sw bx-dv-sw" aria-checked="false" data-show="${E(d.id)}" aria-label="${E(d.name)} 보이기"${busy === d.id ? ' disabled' : ''}><i></i></button></div>`).join('')}</div>` : ''}` : '')));
    }
    const setHide = async (id, hide) => {
      if (busy) return; busy = id; draw();
      try { await x.api('api/me/devboard/hide', {method: 'POST', body: JSON.stringify({device: id, hide})}); const d = data?.devices?.find(z => z.id === id); if (d) d.hidden = hide; }
      catch (e) { (typeof toast === 'function' ? toast : alert)(e.message); }
      busy = ''; draw();
    };
    onSearch(el, v => { V.q = v; draw(); });
    el.addEventListener('click', e => {
      const ws = e.target.closest('[data-ws]'); if (ws){ V.ws = ws.dataset.ws; try { localStorage.setItem('bx-stp-dv', JSON.stringify({ws: V.ws})); } catch {} return draw(); }
      const h = e.target.closest('[data-hide]'); if (h) return setHide(h.dataset.hide, true);
      const s = e.target.closest('[data-show]'); if (s) return setHide(s.dataset.show, false);
      if (e.target.closest('[data-hidl]')){ hidOpen = !hidOpen; return draw(); }
    });
    const stop = every(30_000, load);
    draw(); load();
    return {route(){}, unmount: stop};
  }};

  window.BXStatus = {
    open: (k, sub) => open(k, false, sub), close: () => close(), cur: () => cur, page: (k, p) => { PAGES[k] = p; if (cur === k){ const c = cur; cur = null; open(c, true); } },
    side: (it, top) => Object.keys(K).filter(onK).map(k => it('pg:' + k, ICON[k], K[k].name, '', top === 'pg:' + k)).join(''),
    sig: () => (onK('tasks') ? 't' : '') + (onK('devices') ? 'd' : '') + (cur || ''),
    feats: () => ({...F}), api, E,
  };
})();
