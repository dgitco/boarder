(() => {
  if (!window.BX_X || !window.HB_LIVE) return;
  const R = document.documentElement; R.classList.add('bx-x');
  // 보드 맨 위 const · 함수는 window 에 안 붙음 — 이름을 바로 읽음(eval 없이, 없으면 undefined)
  const L = {CH: () => typeof CH !== 'undefined' ? CH : undefined, AREA_NAME: () => typeof AREA_NAME !== 'undefined' ? AREA_NAME : undefined, ME_NAME: () => typeof ME_NAME !== 'undefined' ? ME_NAME : undefined,
    TURN: () => typeof TURN !== 'undefined' ? TURN : undefined, blob: () => typeof blob === 'function' ? blob : undefined, md: () => typeof md === 'function' ? md : undefined,
    splitImgs: () => typeof splitImgs === 'function' ? splitImgs : undefined, vtext: () => typeof vtext === 'function' ? vtext : undefined, filesHTML: () => typeof filesHTML === 'function' ? filesHTML : undefined,
    toast: () => typeof toast === 'function' ? toast : undefined, CS: () => typeof CS !== 'undefined' ? CS : undefined, D: () => typeof D !== 'undefined' ? D : undefined,
    cardShut: () => typeof cardShut === 'function' ? cardShut : undefined, picked: () => typeof picked !== 'undefined' ? picked : undefined, attnRows: () => typeof attnRows === 'function' ? attnRows : undefined,
    loadTh: () => typeof loadTh === 'function' ? loadTh : undefined, loadCh: () => typeof loadCh === 'function' ? loadCh : undefined, chatPost: () => typeof chatPost === 'function' ? chatPost : undefined,
    upOne: () => typeof upOne === 'function' ? upOne : undefined};
  const G = n => { try { return L[n]?.(); } catch { return undefined; } };
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  const chs = () => (G('CH') || ['primary']).filter(k => !/^[ingq]:/.test(k));
  const AN = () => G('AREA_NAME') || {};
  const ME = () => G('ME_NAME') || 'Owner';
  const av = (name, n) => { try { return G('blob')(name, n) || ''; } catch { return ''; } };
  const mdx = (t, tight) => { try { return G('md')(t, tight); } catch { return `<p>${E(t)}</p>`; } };
  const files = m => { try { const sp = G('splitImgs')(G('vtext')(m)); return {text: sp.text, html: G('filesHTML')(m.files, sp.imgs)}; } catch { return {text: m.text || '', html: ''}; } };
  const say = m => { try { G('toast')(m); } catch {} };
  const cs = () => G('CS') || {ch: {}, thr: {}};
  const ago = ts => { const s = Date.now() / 1000 - +ts; if (!isFinite(s)) return ''; return s < 60 ? '방금' : s < 3600 ? Math.floor(s / 60) + '분' : s < 86400 ? Math.floor(s / 3600) + '시간' : Math.floor(s / 86400) + '일'; };
  const who = m => m.who === 'owner' ? ME() : (m.name || AN()[m.ch] || '비서');
  const J = {
    home: ['<path d="M12 3.8c.55 0 1.05.2 1.45.55l6.1 5.1c.6.5.95 1.25.95 2.05v7.4a2.6 2.6 0 0 1-2.6 2.6H6.1a2.6 2.6 0 0 1-2.6-2.6v-7.4c0-.8.35-1.55.95-2.05l6.1-5.1c.4-.35.9-.55 1.45-.55z"/>', 1],
    dm: ['<path d="M4.3 4.9c-.3-.95.7-1.8 1.6-1.35l14.1 7.2c.95.5.95 1.85 0 2.35L5.9 20.3c-.9.45-1.9-.4-1.6-1.35L6.5 12zM6.5 12h6.2"/>', 1],
    plus: ['<path d="M12 4.8v14.4M4.8 12h14.4"/>', 0],
    save: ['<path d="M7 3.6h10a1.6 1.6 0 0 1 1.6 1.6v15.2l-6.6-4.3-6.6 4.3V5.2A1.6 1.6 0 0 1 7 3.6z"/>', 1],
    me: ['<circle cx="12" cy="7.9" r="3.7"/><path d="M4.7 20.6c.8-3.9 3.8-6.1 7.3-6.1s6.5 2.2 7.3 6.1"/>', 1],
  };
  const ji = (n, on, w = 24) => { const [p, can] = J[n]; const fill = on && can ? p.replace(/<path /g, '<path fill="currentColor" ').replace(/<circle /g, '<circle fill="currentColor" ').replace('M6.5 12h6.2', '') : p;
    return `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${fill}</svg>`; };
  const CHK = (w = 20, sw = 1.9) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 7"/></svg>`;
  const MSG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.3A8.5 8.5 0 1 1 21 12z"/></svg>';
  const IMG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>';
  const BACK = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';

  // ── 상태
  const DK = 'bx-x-done', ld = () => { try { const o = JSON.parse(localStorage.getItem(DK) || '{}'), cut = Date.now() - 14 * 864e5; return new Map(Object.entries(o).filter(([, t]) => t > cut)); } catch { return new Map(); } };
  const X = {tab: 'home', th: null, sel: chs()[0] || 'primary', done: ld(), sv: new Map(), undo: null, seenT: new Map()};   // sv = 방금 누른 저장 표시(서버 목록이 따라올 때까지)
  const keepDone = () => { try { localStorage.setItem(DK, JSON.stringify(Object.fromEntries(X.done))); } catch {} };
  const root = document.createElement('div'); root.id = 'bxx'; document.body.append(root);
  root.innerHTML = `<div class="xv" data-v="home"></div><div class="xv" data-v="thread" hidden></div><div class="xv" data-v="save" hidden></div><div class="xv" data-v="me" hidden></div>
    <nav class="xglass" aria-label="아래 내비">${['home', 'dm', 'plus', 'save', 'me'].map(k => `<button type="button" class="xt" data-xtab="${k}" aria-label="${{home: '홈', dm: '에이전트 DM', plus: '새 글', save: '저장됨', me: '프로필'}[k]}"></button>`).join('')}</nav>
    <button type="button" class="xfab" data-xtab-fab aria-label="새 글">${ji('plus', false)}</button><div class="xtoast" role="status" hidden></div>`;
  const V = k => root.querySelector(`.xv[data-v="${k}"]`);

  // ── 데이터: 채널 글(뿌리) · 스레드 · 물음 · 읽지 않음 · 저장
  const roots = () => { const out = []; for (const k of chs()) for (const m of cs().ch?.[k]?.messages || []) if (!m.deleted && !(m.thread && m.thread !== m.ts)) out.push({k, m}); return out; };
  const openCards = () => (G('D')?.cardlist || []).filter(c => c.state === 'open' && c.kind !== 'briefing' && /^\d/.test(c.ts));
  const shut = m => { try { return G('cardShut')(m); } catch { return false; } };
  const isAsk = m => !!m && m.who !== 'owner' && !m.deleted && (m.card ? !shut(m) && m.card.state !== 'answered' : (m.buttons || []).some(b => !b.other) && !m.picked && !G('picked')?.[m.ts]);
  const askRank = () => { const rows = (() => { try { return G('attnRows')() || []; } catch { return []; } })(), r = new Map(); rows.forEach((x, i) => { r.set(x.ts, i); if (x.thread) r.set(x.thread, i); }); return r; };
  const unreadSet = () => { const s = new Set(); for (const x of window.HBInbox?.state?.unread || []) s.add(x.thread || x.ts); return s; };
  const thr = ts => cs().thr?.[ts]?.messages || null;
  const rest = (k, m) => (thr(m.ts) || []).filter(x => x.ts !== m.ts && !x.deleted);
  const askIn = (k, m) => { if (isAsk(m)) return m; const r = rest(k, m); for (let i = r.length - 1; i >= 0; i--) if (isAsk(r[i])) return r[i]; return null; };
  const qOf = m => (m.buttons || []).some(b => !b.other);
  const qList = (k, m) => [m, ...rest(k, m)].filter(qOf);
  const cardRoots = () => { const s = new Set(); for (const c of openCards()) s.add(c.thread || c.ts); return s; };
  function items(){
    const rk = askRank(), un = unreadSet(), cr = cardRoots(), it = [];
    for (const {k, m} of roots()){
      const dAt = X.done.get(m.ts); if ((dAt && Math.max(+m.ts || 0, +m.latest || 0) * 1000 <= dAt)) continue;   // 완료 뒤 새 답이 오면 다시 뜸
      const ask = cr.has(m.ts) || !!askIn(k, m);
      it.push({k, m, ask, un: un.has(m.ts), at: Math.max(+m.ts || 0, +m.latest || 0), rank: rk.has(m.ts) ? rk.get(m.ts) : 1e6});
    }
    return it.sort((a, b) => (b.ask - a.ask) || (a.ask && b.ask ? a.rank - b.rank : 0) || (b.un - a.un) || (b.at - a.at)).slice(0, 80);
  }

  const head = (m, k, turn) => `<div class="xh"><b>${E(who(m))}</b>${topic(m, k)}<span class="xtm">${ago(m.ts)}</span>${turn ? '<span class="xturn">· 내 차례</span>' : ''}</div>`;
  const topic = (m, k) => { const t = chs().length > 1 ? NAMES()[k] : ''; return t && t !== who(m) ? `<span class="xtp">${E(t)}</span>` : ''; };   // 이름 › 채널 — 채널이 하나면 뺌
  const body = m => { const f = files(m); return `${f.text ? `<div class="xbd">${mdx(f.text, m.who !== 'owner')}</div>` : ''}${f.html || ''}`; };
  const acts = (k, m, n, done, sts, un) => `<div class="xact"><button type="button" class="xck${done ? ' on' : ''}" data-xdone="${E(m.ts)}" data-k="${E(k)}" aria-label="완료 · 읽음">${CHK()}</button>`
    + `<button type="button" class="xrp" data-xopen="${E(m.thread || m.ts)}" data-k="${E(k)}" aria-label="${un ? '답글 · 읽지 않음' : '답글'}">${MSG}${n ? `<span>${n}</span>` : ''}${un ? '<i class="xnew"></i>' : ''}</button>`
    + (() => { const rt = sts || m.thread || m.ts, on = isSaved(rt);   // sts = 저장됨 탭에서 그 줄이 저장한 글(답 글 하나만 저장했을 수 있음)
      return `<button type="button" class="xsv${on ? ' on' : ''}" data-xsave="${E(rt)}" data-k="${E(k)}" aria-pressed="${on}" aria-label="${on ? '저장 풀기' : '저장'}">${ji('save', on, 20)}</button>`; })() + '</div>';
  const isSaved = ts => X.sv.has(ts) ? X.sv.get(ts) : !!window.HBInbox?.isSaved?.(ts);   // 보드 저장 표(saved_ids — 200개 넘어도 전부)
  function pollState(k, rootM, m){
    const pk = m.picked || G('picked')?.[m.ts]?.label;
    if (pk) return {st: 'voted', pick: pk};
    if (m.card && (shut(m) || m.card.state === 'answered')) { const r = rest(k, rootM); return {st: r.some(x => x.who === 'owner' && +x.ts > +m.ts) ? 'reply' : 'else', pick: null}; }
    const r = rest(k, rootM); if (r.some(x => x.who === 'owner' && +x.ts > +m.ts)) return {st: 'reply', pick: null};
    return {st: 'open', pick: null};
  }
  function poll(k, rootM, m){
    const opts = (m.buttons || []).filter(b => !b.other), {st, pick} = pollState(k, rootM, m), root = rootM.ts;
    const rows = opts.map(b => { const t = String(b.label).replace(/\s*\(추천\)\s*$/, ''), rec = /추천/.test(b.label);
      if (st === 'open') return `<button type="button" class="xop" data-xvote="${E(b.label)}" data-ts="${E(m.ts)}" data-root="${E(root)}" data-k="${E(k)}"><span>${E(t)}</span>${rec ? '<i>추천</i>' : ''}</button>`;
      const me = pick === b.label; return `<div class="xop res${me ? ' me' : ''}"><span class="xf" style="width:${me ? 100 : 0}%"></span><span>${E(t)}</span>${me ? `<b>${CHK(16, 2.6)}</b>` : ''}</div>`; }).join('');
    const ft = {open: `${G('TURN') || '내 차례'} · 하나 누르면 바로 접수`, voted: '<b>접수됨</b> · 투표 끝남', reply: '<b>답글로 답해서 접수됨</b> · 투표 끝남', else: '<b>다른 데서 답해서 접수됨</b> · 투표 끝남'}[st];
    return `<div class="xpoll">${rows}<div class="xft">${ft}</div></div>`;
  }
  const nn = s => `<span class="xnn">${s}</span>`;
  function post(k, m, o = {}){
    const q = (m.buttons || []).some(b => !b.other);
    const bd = body(m), part = q ? (o.part ? nn(o.part) : o.feed ? nn('1/2') : '') : '';
    const goto = q && o.feed ? `<button type="button" class="xgo" data-xopen="${E(m.thread || m.ts)}" data-k="${E(k)}">${MSG}<span>${o.more ? `<b>투표</b>에서 고르기 · ${E(o.more)}` : '<b>2/2 투표</b>에서 고르기 · 눌러서 열기'}</span></button>` : '';
    const sz = o.reply || o.ans ? 28 : 42;
    return `<article class="xp${o.joined ? ' j' : ''}${o.reply ? ' xr' : ''}${o.main ? ' xm' : ''}${o.ans ? ' xa' : ''}${o.ask ? ' ask' : ''}" data-ts="${E(m.ts)}" data-k="${E(k)}" data-root="${E(o.root || m.ts)}">${o.joined ? '<i class="xl"></i>' : ''}${o.reply ? '<i class="xcv"></i>' : ''}`
      + `<span class="xav">${av(who(m), sz)}</span><div class="xc">${head(m, k, o.turn)}${bd.replace(/<\/p>/, part + '</p>')}${goto}${o.pollHere ? '' : ''}${acts(k, m, o.n || 0, o.done, o.sts, o.un && !o.joined)}</div></article>`;
  }
  // 피드 한 묶음: 뿌리 글 + 볼 답 하나(물음이 있으면 그 글, 없으면 마지막 답) — 곧은 이음선
  function unit(x){
    const {k, m} = x, r = rest(k, m), ask = askIn(k, m), pv = ask && ask !== m ? ask : (r.length ? r[r.length - 1] : null);
    // 묶음이면 첫 열린 물음을 보이고 「n/N」 + 이어짐 · 남은 수
    const qs = qList(k, m), bundle = qs.length > 1, open = qs.filter(isAsk), bq = bundle ? (open[0] || qs[qs.length - 1]) : null;
    const bo = bundle ? {part: `${qs.indexOf(bq) + 1}/${qs.length}`, more: open.length ? `${qs.length}개 중 ${open.length}개 남음` : `${qs.length}개 모두 접수됨`} : {};
    const show = bundle ? bq : pv;
    const tgt = !x.ask ? null : bundle ? bq : (ask || m);   // 「내 차례」를 붙일 글 = 실제로 고를 글(뿌리 물음 · 열린 카드 뿌리면 뿌리, 묶음이면 열린 물음)
    if (!show) return wrap(x, post(k, m, {feed: true, n: m.replies || 0, ask: x.ask, turn: tgt === m, un: x.un, sts: x.sts}));
    if (show === m) return wrap(x, post(k, m, {feed: true, n: m.replies || r.length, ask: x.ask, turn: tgt === m, un: x.un, sts: x.sts, ...bo}));
    return wrap(x, post(k, m, {joined: true, feed: true, ask: x.ask, turn: tgt === m, sts: x.sts}) + post(k, show, {reply: true, feed: true, root: m.ts, n: m.replies || r.length, ask: x.ask, turn: tgt === show, un: x.un, sts: x.sts, ...bo}));
  }
  const wrap = (x, h) => `<div class="xu${x.ask ? ' ask' : ''}" data-root="${E(x.m.ts)}" data-k="${E(x.k)}">${h}</div>`;

  // ── 홈(X2 · X9): 맨 위 새 글 칸 + 피드
  const NAMES = () => Object.fromEntries(chs().map(k => [k, k === 'primary' ? (AN().primary || 'Primary') : String(AN()[k] || k).replace(/\s*리드\s*$/, '')]));
  function composer(){
    return `<form class="xcmp" autocomplete="off"><span class="xav">${av(ME(), 42)}</span><div class="xc"><div class="xmeh"><b class="xme">${E(ME())}</b>`
      + `<button type="button" class="xsel" data-xsel aria-haspopup="listbox">${E(NAMES()[X.sel] || X.sel)} ▾</button></div>`
      + `<textarea id="xnew" rows="1" placeholder="무엇을 시킬까요?" aria-label="새 글"></textarea>`
      + `<div class="xcb"><label class="xib" aria-label="사진 · 첨부">${IMG}<input type="file" id="xfile" multiple hidden></label><span class="xatt"></span><button type="submit" class="xsend" aria-label="올리기">올리기</button></div></div></form>`;
  }
  let lastSig = '';
  function drawHome(force){
    const v = V('home'), it = items(), sig = JSON.stringify([it.map(x => [x.m.ts, x.m.latest, x.m.replies, x.ask, x.un, (thr(x.m.ts) || []).length, x.m.picked]), it.map(x => isSaved(x.m.ts))]);
    if (!force && sig === lastSig && v.firstChild) return; lastSig = sig;
    // 글 칸은 한 번만 만듦(다시 그려도 쓰던 글 · 포커스 · 한글 조합 · 첨부 · 토픽 창이 그대로) — 피드만 바꿈
    if (!v.querySelector('.xcmp')) v.innerHTML = `<header class="xhd"><b>boarder</b></header>${composer()}<div class="xfeed"></div>`;
    const sl = v.querySelector('.xsel'); if (sl) sl.textContent = `${NAMES()[X.sel] || X.sel} ▾`;
    const st = v.scrollTop;
    v.querySelector('.xfeed').innerHTML = it.map(unit).join('') || '<p class="xempty">글이 없어요</p>';
    v.scrollTop = st; watchSeen();
    for (const x of it.slice(0, 30)) if (x.m.replies && !thr(x.m.ts)) loadThr(x.k, x.m.ts);
  }
  const grow = t => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; if (t.form?.classList.contains('xrep') && t.isConnected){ t.form.classList.toggle('has', !!t.value.trim()); root.style.setProperty('--xrh', t.form.offsetHeight + 'px'); } };   // 답 칸 올리기 단추는 글이 있을 때만, 칸이 커진 만큼 스레드 아래 여백도(마지막 답이 안 가리게)
  const pending = new Set();
  async function loadThr(k, ts){ if (pending.has(ts)) return; pending.add(ts); try { await G('loadTh')(k, ts); } catch {} pending.delete(ts); sched(); }

  function drawThread(){
    const v = V('thread'), t = X.th; if (!t) return;
    const all = thr(t.ts) || [(cs().ch?.[t.k]?.messages || []).find(m => m.ts === t.ts)].filter(Boolean);
    // 뿌리를 맨 앞에: 옮겨 온 카드는 뿌리보다 ts 가 이를 수 있음(답 · 투표 판정이 뿌리 기준이라)
    const ms = [...all.filter(m => m.ts === t.ts), ...all.filter(m => m.ts !== t.ts)], rootM = ms[0]?.ts === t.ts ? ms[0] : {ts: t.ts};
    let h = '';
    const qs = ms.filter(qOf), N = qs.length;
    const nRep = ms.length - 1;
    ms.forEach((m, i) => { const q = qOf(m), rt = i === 0 && m.ts === t.ts, form = rt ? {main: true} : {ans: true};
      h += q ? post(t.k, m, {...form, root: t.ts}).replace(/(<\/p>)/, nn(N > 1 ? `${qs.indexOf(m) + 1}/${N}` : '1/2') + '$1') : post(t.k, m, {...form, root: t.ts});
      if (q) h += `<article class="xp xa" data-ts="${E(m.ts)}" data-k="${E(t.k)}" data-root="${E(t.ts)}"><span class="xav">${av(who(m), 28)}</span><div class="xc">${head(m, t.k)}<div class="xbd"><p>골라 주세요.${N > 1 ? '' : nn('2/2')}</p></div>${poll(t.k, rootM, m)}${acts(t.k, m, 0, pollState(t.k, rootM, m).st !== 'open')}</div></article>`;
      if (rt && nRep) h += `<div class="xsec">답글 ${nRep}</div>`;   // 뿌리(투표까지) 뒤
    });
    if (v.dataset.th !== t.ts){   // 다른 스레드로 왔을 때만 틀 · 답 칸을 새로(쓰던 답은 그 스레드 것이라 비움)
      v.dataset.th = t.ts; v.dataset.sig = ''; v.scrollTop = 0; root.style.removeProperty('--xrh');
      v.innerHTML = `<header class="xhd xbk"><button type="button" class="xback" data-xback aria-label="뒤로">${BACK}</button><b>스레드</b><small>${E(NAMES()[t.k] || '')}</small></header><div class="xfeed"></div>`
        + `<form class="xrep"><span class="xav">${av(ME(), 26)}</span><textarea id="xth" rows="1" placeholder="답글 쓰기" aria-label="답글"></textarea><button type="submit" class="xsend">올리기</button></form>`;
    }
    if (v.dataset.sig === h) return; v.dataset.sig = h;
    v.querySelector('.xfeed').innerHTML = h;
  }
  async function openThread(k, ts){ X.th = {k, ts}; show('thread'); drawThread(); await loadThr(k, ts); drawThread(); }

  // ── 저장됨(X11) · 프로필(X12)
  function drawSave(){
    const v = V('save'), s = window.HBInbox?.state?.saved || [], by = new Map(roots().map(x => [x.m.ts, x]));
    const rows = s.map(x => { const r = by.get(x.thread || x.ts) || by.get(x.ts); return r ? unit({...r, ask: false, un: false, sts: x.ts}) : `<div class="xrow" data-xopen="${E(x.thread || x.ts)}" data-k="${E(x.chan)}"><b>${E(x.author || '')}</b><span>${E(String(x.text || '').slice(0, 120))}</span></div>`; }).join('');
    v.innerHTML = `<header class="xhd xbig"><b>저장됨</b></header><div class="xfeed">${rows || '<p class="xempty">저장한 글이 없어요. 글 아래 책갈피를 누르면 여기 모여요.</p>'}</div>`;
  }
  function drawMe(){
    const v = V('me'), mine = roots().filter(x => x.m.who === 'owner').sort((a, b) => b.m.ts - a.m.ts).slice(0, 20);
    v.innerHTML = `<header class="xhd xbig"><b>${E(ME())}</b></header><div class="xpf"><span class="xav xbig">${av(ME(), 72)}</span><div class="xpb"><a class="xpbtn" href="/#settings">설정</a><a class="xpbtn" href="/#settings/connect">연결</a><a class="xpbtn" href="/">보더</a></div></div>`
      + `<div class="xtabs"><b>내 요청</b></div><div class="xfeed">${mine.map(x => unit({...x, ask: false, un: false})).join('') || '<p class="xempty">아직 쓴 글이 없어요</p>'}</div>`;
  }

  // ── 화면 바꾸기 · 그리기 일정
  function show(tab){
    X.tab = tab; for (const v of root.querySelectorAll('.xv')) v.hidden = v.dataset.v !== tab;
    root.classList.toggle('xnonav', tab === 'thread'); root.classList.remove('xlow');
    for (const b of root.querySelectorAll('.xt')){ const k = b.dataset.xtab, on = k === tab || (tab === 'thread' && k === 'home'); b.classList.toggle('on', on); b.innerHTML = ji(k, on) + badge(k); }
    if (tab === 'home') drawHome(true); else if (tab === 'save') drawSave(); else if (tab === 'me') drawMe();
  }
  const badge = k => { const c = window.HBInbox?.counts?.() || {}; const n = k === 'save' ? (c.saved || 0) : k === 'dm' ? (c.unread || 0) : 0; return n ? `<span class="xbdg">${n > 99 ? '99+' : n}</span>` : ''; };
  let tm = null; const sched = () => { clearTimeout(tm); tm = setTimeout(() => { if (X.tab === 'home') drawHome(); else if (X.tab === 'thread') drawThread(); }, 120); };

  // ── 읽음 B(X7): 결과 · 보고 글은 반 넘게 1초 보이면 읽음 — 물음 · 할 일은 보기만으론 안 내려감
  let io = null;
  function watchSeen(){
    io?.disconnect(); for (const t of X.seenT.values()) clearTimeout(t); X.seenT.clear(); if (!window.IntersectionObserver) return;
    // 반 넘게 보임 — 화면보다 긴 글은 화면 반을 채우면(그 글의 반은 끝내 못 넘으니)
    const enough = e => e.isIntersecting && (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= (e.rootBounds?.height || innerHeight) * 0.5);
    io = new IntersectionObserver(es => { for (const e of es){ const u = e.target, r = u.dataset.root;
      if (enough(e)){ if (!X.seenT.has(r)) X.seenT.set(r, setTimeout(() => { if (u.isConnected && !u.classList.contains('ask')) readOne(u.dataset.k, r, true); else X.seenT.delete(r); }, 1000)); }
      else { clearTimeout(X.seenT.get(r)); X.seenT.delete(r); } } }, {threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5]});
    for (const u of V('home').querySelectorAll('.xu:not(.ask)')) if (unreadSet().has(u.dataset.root)) io.observe(u);
  }
  function readOne(k, rootTs, quiet){
    X.seenT.delete(rootTs);
    const rows = (window.HBInbox?.state?.unread || []).filter(x => (x.thread || x.ts) === rootTs);
    if (rows.length) try { window.HBInbox.read(rows); } catch {}
    if (!quiet) sched();
  }

  // ── 완료(✓, 되돌리기) · 저장(책갈피 단추, 다시 누르면 풀기)
  function done(k, rootTs){
    const was = X.done.get(rootTs); X.done.set(rootTs, Date.now()); keepDone(); readOne(k, rootTs, true); drawHome(true);
    note('완료로 내렸어요', () => { X.done.delete(rootTs); if (was) X.done.set(rootTs, was); keepDone(); drawHome(true); });
  }
  const redraw = () => { if (X.tab === 'home') drawHome(true); else if (X.tab === 'thread') drawThread(); else if (X.tab === 'save') drawSave(); else if (X.tab === 'me') drawMe(); };
  function save(k, rootTs){
    const on = !isSaved(rootTs); X.sv.set(rootTs, on); redraw();
    let p; try { p = window.HBInbox?.save?.(rootTs, on); } catch (e) { p = Promise.reject(e); }
    const back = () => { X.sv.delete(rootTs); redraw(); say(on ? '저장하지 못했어요' : '저장을 풀지 못했어요'); };
    return Promise.resolve(p).then(ok => { if (ok === false) back(); else { X.sv.delete(rootTs); redraw(); } }, back);
  }
  function note(m, undo){
    const t = root.querySelector('.xtoast'); X.undo = undo; t.innerHTML = `<span>${E(m)}</span>${undo ? '<button type="button" data-xundo>되돌리기</button>' : ''}`; t.hidden = false;
    clearTimeout(note.t); note.t = setTimeout(() => { t.hidden = true; X.undo = null; }, 5000);
  }

  function compose(){ show('home'); const v = V('home'); v.scrollTop = 0; const ta = v.querySelector('#xnew'); ta?.closest('.xcmp')?.classList.add('open'); ta?.focus(); }
  // 내리면 막대가 숨고 + 단추만, 올리면 다시. 머리 줄도 내렸을 때만. 옆으로는 아무것도 안 움직임(transform 만)
  const lastY = new WeakMap();
  root.addEventListener('scroll', e => { const v = e.target; if (!v.classList?.contains('xv')) return;
    const y = Math.max(0, v.scrollTop), p = lastY.has(v) ? lastY.get(v) : 0; v.classList.toggle('xs', y > 2);
    if (y < 60){ root.classList.remove('xlow'); lastY.set(v, y); }
    else if (Math.abs(y - p) > 8){ root.classList.toggle('xlow', y > p); lastY.set(v, y); } }, {capture: true, passive: true});
  // 답 칸은 화면 아래 고정 — 키보드가 뜨면 그 위로(보이는 영역 아래 끝 기준)
  { const vv = window.visualViewport; if (vv){ const kb = () => { const h = Math.max(0, innerHeight - vv.height - vv.offsetTop); root.style.setProperty('--xkb', h > 60 ? h + 'px' : '0px'); }; vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb); } }
  // ── 누름
  root.addEventListener('focusin', e => { if (e.target.id === 'xnew') e.target.closest('.xcmp')?.classList.add('open'); });
  root.addEventListener('click', e => {
    const t = e.target, q = s => t.closest(s);
    const nav = q('.xt'); if (nav){ const k = nav.dataset.xtab;
      if (k === 'dm') return void (location.href = '/es');
      if (k === 'plus') return compose();
      return show(k); }
    if (q('[data-xtab-fab]')) return compose();
    { const c = root.querySelector('.xcmp.open'); if (c && !q('.xcmp') && !c.querySelector('#xnew')?.value.trim() && !X.att?.length) c.classList.remove('open'); }   // 빈 글 칸 밖을 누르면 다시 한 줄
    if (q('[data-xback]')){ X.th = null; return show('home'); }
    if (q('[data-xundo]')){ const u = X.undo; X.undo = null; root.querySelector('.xtoast').hidden = true; return u?.(); }
    const v = q('[data-xvote]'); if (v){ const ts = v.dataset.ts, rt = v.dataset.root, k = v.dataset.k;
      try { G('picked')[ts] = {label: v.dataset.xvote}; } catch {}
      drawThread();
      return void send({channel: k, thread: rt, ts, label: v.dataset.xvote}, 't' + rt).then(r => {
        if (r === 'ok' && !G('picked')?.[ts]){ if (X.tab === 'thread') drawThread(); return say('고른 것이 닿았을 수 있어요. 스레드에서 확인해 주세요'); }   // 보드 maybe() 는 CS.fail 없이 고른 표시만 지움
        if (r !== 'ok'){ try { delete G('picked')[ts]; } catch {} if (X.tab === 'thread') drawThread(); say('고른 것을 보내지 못했어요. 다시 눌러 주세요'); } }); }
    const dn = q('[data-xdone]'); if (dn){ const u = dn.closest('.xu'); const k = dn.dataset.k, rt = u?.dataset.root || dn.closest('.xp')?.dataset.root || dn.dataset.xdone;
      if (X.tab === 'thread'){ readOne(k, rt); return say('완료로 내렸어요'); }
      return done(k, rt); }
    const sb = q('[data-xsave]'); if (sb) return void save(sb.dataset.k, sb.dataset.xsave);
    const o = q('[data-xopen]'); if (o) return openThread(o.dataset.k, o.dataset.xopen);
    if (q('[data-xsel]')) return selOpen();
    const pick = q('[data-xpick]'); if (pick){ X.sel = pick.dataset.xpick; selClose(); return drawHome(true); }
    if (q('.xselpop') === null && root.querySelector('.xselpop') && !q('[data-xsel]')) selClose();
    const p = q('.xu .xp'); if (p && !q('a, button, .xpoll, img, video, audio')) return openThread(p.dataset.k, p.dataset.root);
  });
  root.addEventListener('input', e => { if (e.target.matches('#xnew, #xth')) grow(e.target); });
  // 새 글(X9): 고른 토픽(채널)에 — 첨부는 보드 올리기(upOne)로 먼저, 글은 chatPost
  root.addEventListener('change', e => { if (e.target.id !== 'xfile') return; X.att = [...(X.att || []), ...e.target.files]; const a = root.querySelector('.xatt'); if (a) a.textContent = X.att.length ? `첨부 ${X.att.length}개` : ''; });
  root.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, ta = f.querySelector('textarea'), text = ta.value.trim();
    if (f.classList.contains('xrep')){ if (!text || !X.th) return; const th = X.th; ta.value = ''; grow(ta);
      const r = await send({channel: th.k, thread: th.ts, text}, 't' + th.ts);
      if (r === 'maybe') say('답글이 올라갔을 수 있어요. 스레드에서 확인해 주세요');
      else if (r === 'fail'){ const now = root.querySelector('#xth');   // 보내는 동안 다른 스레드에 다녀오면 칸이 새로 만들어짐 — 지금 화면의 칸에 되살림
        const back = X.th?.ts === th.ts && now && !now.value; if (back){ now.value = text; grow(now); }
        say(back ? '답글을 보내지 못했어요. 글은 칸에 다시 넣어 뒀어요' : '답글을 보내지 못했어요. 다시 써 주세요'); }
      return; }
    const att = X.att || []; if (!text && !att.length) return;
    const ids = [];
    try { for (const file of att) ids.push(await G('upOne')({f: file})); } catch { return say('일시적인 오류가 발생했어요'); }
    const ch = X.sel, kept = att; ta.value = ''; grow(ta); X.att = []; const a = root.querySelector('.xatt'); if (a) a.textContent = '';
    const r = await send({channel: ch, text, ...(ids.length ? {files: ids} : {})}, 'new:' + ch);
    if (r === 'ok') return say(`# ${NAMES()[ch] || ch}에 올렸어요`);
    if (r === 'maybe') return say(`# ${NAMES()[ch] || ch}에 올라갔을 수 있어요. 피드에서 확인해 주세요`);
    if (!ta.value){ ta.value = text; grow(ta); X.att = kept; if (a) a.textContent = kept.length ? `첨부 ${kept.length}개` : ''; f.classList.add('open'); }   // 보내는 동안 접혔어도 단추 줄을 다시
    say('올리지 못했어요. 글은 칸에 다시 넣어 뒀어요');
  });
  root.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.matches('#xnew, #xth')){ e.preventDefault(); e.target.form.requestSubmit(); } });
  // 보내기: chatPost 는 실패해도 던지지 않고 CS.fail 에 남김 — 그 표시가 놓이는 보드 채팅은 /x 에서 가려져 있어 여기서 알려 줌
  async function send(body, base){
    const failed = () => Object.keys(cs().fail || {}).filter(x => x.startsWith(base + ':'));
    const before = new Set(failed());
    try { await G('chatPost')(body, base); } catch { return 'fail'; }
    const nw = failed().filter(x => !before.has(x));
    // maybe = 서버가 받았는지 모름(보드가 다시 보내기를 막는 경우) — 글을 되살리면 두 번 올라감
    return !nw.length ? 'ok' : nw.some(x => cs().fail[x]?.maybe) ? 'maybe' : 'fail';
  }
  // 셀렉터(X9): 토픽 = 채널(비서가 알맞은 창에 넘김) · 에이전트에게 바로(Primary)
  function selOpen(){ selClose(); const n = NAMES();
    const p = document.createElement('div'); p.className = 'xselpop'; p.setAttribute('role', 'listbox');
    const tp = chs().filter(k => k !== 'primary');   // 토픽 채널이 없는 사람(새 회원)은 머리도 안 띄움
    p.innerHTML = `${tp.length ? '<h5>토픽 — 비서가 알맞은 창에 넘겨요</h5>' : ''}${tp.map(k => `<button type="button" data-xpick="${E(k)}"${k === X.sel ? ' aria-selected="true"' : ''}><b>#</b>${E(n[k])}</button>`).join('')}`
      + `<h5>에이전트에게 바로</h5><button type="button" data-xpick="primary"${X.sel === 'primary' ? ' aria-selected="true"' : ''}><span class="xav">${av(n.primary, 22)}</span>${E(n.primary)}</button>`;
    root.querySelector('.xcmp')?.append(p); }
  function selClose(){ root.querySelector('.xselpop')?.remove(); }

  // ── 시작: 채널 · 모아 보기 불러오기, 20초마다 다시
  async function refresh(){
    await Promise.all(chs().map(k => G('loadCh')(k).catch?.(() => {}))).catch(() => {});
    try { await window.HBInbox?.load?.(); } catch {}
    if (X.tab === 'home') drawHome(); else if (X.tab === 'thread') drawThread(); else if (X.tab === 'save') drawSave();
    for (const b of root.querySelectorAll('.xt')) b.innerHTML = ji(b.dataset.xtab, b.classList.contains('on')) + badge(b.dataset.xtab);
  }
  try { window.HBInbox?.on?.(() => sched()); } catch {}
  show('home'); refresh(); setInterval(refresh, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
