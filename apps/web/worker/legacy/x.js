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
    upOne: () => typeof upOne === 'function' ? upOne : undefined, ARTS: () => typeof ARTS !== 'undefined' ? ARTS : undefined, openArt: () => typeof openArt === 'function' ? openArt : undefined, attCards: () => typeof attCards === 'function' ? attCards : undefined, attOut: () => typeof attOut === 'function' ? attOut : undefined, inputBox: () => typeof inputBox === 'function' ? inputBox : undefined, attChips: () => typeof attChips === 'function' ? attChips : undefined,
    addFiles: () => typeof addFiles === 'function' ? addFiles : undefined, filePick: () => typeof filePick !== 'undefined' ? filePick : undefined, enterSends: () => typeof enterSends === 'function' ? enterSends : undefined,
    boardGrow: () => typeof grow === 'function' ? grow : undefined, withLnk: () => typeof withLnk === 'function' ? withLnk : undefined, dropAtt: () => typeof dropAtt === 'function' ? dropAtt : undefined};
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
    home: ['<path d="M3 2h18"/><rect width="18" height="12" x="3" y="6" rx="2"/><path d="M3 22h18"/>', 2],
    dm: ['<path d="M4.3 4.9c-.3-.95.7-1.8 1.6-1.35l14.1 7.2c.95.5.95 1.85 0 2.35L5.9 20.3c-.9.45-1.9-.4-1.6-1.35L6.5 12zM6.5 12h6.2"/>', 1],
    plus: ['<path d="M12 4.8v14.4M4.8 12h14.4"/>', 0],
    nodes: ['<rect x="15.6" y="15.6" width="5.6" height="5.6" rx="1.2"/><rect x="2.8" y="15.6" width="5.6" height="5.6" rx="1.2"/><rect x="9.2" y="2.8" width="5.6" height="5.6" rx="1.2"/><path d="M5.6 15.6v-2.4a1.2 1.2 0 0 1 1.2-1.2h10.4a1.2 1.2 0 0 1 1.2 1.2v2.4M12 12V8.4"/>', 2],   // 보드 사이드바 「노드」와 같은 lucide network
    save: ['<path d="M7 3.6h10a1.6 1.6 0 0 1 1.6 1.6v15.2l-6.6-4.3-6.6 4.3V5.2A1.6 1.6 0 0 1 7 3.6z"/>', 1],
    me: ['<circle cx="12" cy="7.9" r="3.7"/><path d="M4.7 20.6c.8-3.9 3.8-6.1 7.3-6.1s6.5 2.2 7.3 6.1"/>', 1],
  };
  const ji = (n, on, w = 24) => { const [p, can] = J[n]; const fill = !on || !can ? p : can === 2 ? p.replace(/<rect /g, '<rect fill="currentColor" ') : p.replace(/<path /g, '<path fill="currentColor" ').replace(/<circle /g, '<circle fill="currentColor" ').replace('M6.5 12h6.2', '');
    return `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${fill}</svg>`; };
  const CHK = (w = 20, sw = 1.9) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 7"/></svg>`;
  const MSG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.3A8.5 8.5 0 1 1 21 12z"/></svg>';
  const IMG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>';
  const BACK = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';

  // ── 상태
  const DK = 'bx-x-done', ld = () => { try { const o = JSON.parse(localStorage.getItem(DK) || '{}'), cut = Date.now() - 14 * 864e5; return new Map(Object.entries(o).filter(([, t]) => t > cut)); } catch { return new Map(); } };
  const FLK = 'bx-x-fl', flLoad = () => { try { const v = localStorage.getItem(FLK); return v === 'ask' || v === 'info' ? v : 'all'; } catch { return 'all'; } };
  const X = {fl: flLoad(), tab: 'home', th: null, sel: chs()[0] || 'primary', done: ld(), sv: new Map(), undo: null, seenT: new Map(), pend: new Map(), kids: new Map()};   // sv = 방금 누른 저장 표시(서버 목록이 따라올 때까지)
  const keepDone = () => { try { localStorage.setItem(DK, JSON.stringify(Object.fromEntries(X.done))); } catch {} };
  const root = document.createElement('div'); root.id = 'bxx'; document.body.append(root);
  root.innerHTML = `<div class="xv" data-v="home"></div><div class="xv" data-v="thread" hidden></div><div class="xv" data-v="save" hidden></div><div class="xv" data-v="me" hidden></div>
    <nav class="xglass" aria-label="아래 내비">${['home', 'dm', 'nodes', 'save', 'me'].map(k => `<button type="button" class="xt" data-xtab="${k}" aria-label="${{home: '피드', dm: '에이전트 DM', nodes: '노드', save: '저장됨', me: '프로필'}[k]}"></button>`).join('')}</nav>
    <button type="button" class="xfab" data-xtab-fab aria-label="새 글">${ji('plus', false)}</button><div class="xtoast" role="status" hidden></div>`;
  const V = k => root.querySelector(`.xv[data-v="${k}"]`), PC = matchMedia('(min-width: 861px)');

  // ── 데이터: 채널 글(뿌리) · 스레드 · 물음 · 읽지 않음 · 저장
  const roots = () => { const out = []; for (const k of chs()){ const ms = cs().ch?.[k]?.messages || []; for (const m of ms) if (!m.deleted && !(m.thread && m.thread !== m.ts)) out.push({k, m}); for (const q of X.pend.get('new:' + k) || []) if (!ms.some(m => sameQ(m, q))) out.push({k, m: q}); }
    const have = new Set(out.map(x => x.m.ts)); for (const [t, {k}] of wantRoots()){ if (have.has(t)) continue; const m = (cs().thr?.[t]?.messages || []).find(y => y.ts === t); if (m && !m.deleted && !(m.thread && m.thread !== m.ts)){ out.push({k, m}); have.add(t); } }
    return out; };
  const upRoot = t0 => { let t = t0; for (let i = 0; i < 6; i++){ const m = (cs().thr?.[t]?.messages || []).find(y => y.ts === t); if (!m?.thread || m.thread === t) break; t = m.thread; } if (t !== t0){ if (!X.kids.has(t)) X.kids.set(t, new Set()); X.kids.get(t).add(t0); } return t; };   // 답글에 달린 글은 뿌리 스레드 목록에 안 나옴(서버는 thread = 뿌리만 돌려줌) — thr 이 그 조각을 합침
  const wantRoots = () => { const w = new Map(), add = (t, k, at) => { if (!t || /^[ingq]:/.test(k || 'primary')) return; t = upRoot(t); const o = w.get(t); w.set(t, {k: o?.k || k || 'primary', at: Math.max(o?.at || 0, +at || 0)}); };
    for (const c of openCards()) add(c.thread || c.ts, c.channel, c.ts); for (const u of window.HBInbox?.state?.unread || []) add(u.thread || u.ts, u.chan, u.ts); return w; };
  const openCards = () => (G('D')?.cardlist || []).filter(c => c.state === 'open' && c.kind !== 'briefing' && /^\d/.test(c.ts));
  const shut = m => { try { return G('cardShut')(m); } catch { return false; } };
  const isAsk = m => !!m && m.who !== 'owner' && !m.deleted && (m.card ? !shut(m) && m.card.state !== 'answered' : (m.buttons || []).some(b => !b.other) && !m.picked && !G('picked')?.[m.ts]);
  const askRank = () => { const rows = (() => { try { return G('attnRows')() || []; } catch { return []; } })(), r = new Map(); const one = (k, i) => { if (k && !r.has(k)) r.set(k, i); }; rows.forEach((x, i) => { one(x.ts, i); if (x.thread){ one(x.thread, i); one(upRoot(x.thread), i); } }); return r; };
  const unreadSet = () => { const s = new Set(); for (const x of window.HBInbox?.state?.unread || []) s.add(upRoot(x.thread || x.ts)); return s; };
  // 보내는 중인 글(주인 글은 판에 닿을 때까지 202 로 오래 걸림, 보드의 보내는 중 말풍선은 #ans 안에만 있음): 서버 글이 오면 빠짐
  const sameQ = (m, q) => m.who === 'owner' && +m.ts >= q.at - 5 && (q.att || String(m.src ?? m.text ?? '').trim() === q.text);   // 원문은 src(text 는 블록 꼴일 수 있음, 보드와 같은 비교)
  const thr = ts => { let real = cs().thr?.[ts]?.messages || null; const ks = X.kids.get(ts);
    if (ks){ const seen = new Set((real || []).map(m => m.ts)), more = []; for (const k of ks) for (const m of cs().thr?.[k]?.messages || []) if (!seen.has(m.ts)){ seen.add(m.ts); more.push(m); } if (more.length) real = [...(real || []), ...more].sort((a, b) => a.ts === ts ? -1 : b.ts === ts ? 1 : +a.ts - +b.ts); }
    const p = X.pend.get(ts); if (!p?.length) return real; const left = p.filter(q => !(real || []).some(m => sameQ(m, q))); return real || left.length ? [...(real || []), ...left] : null; };
  const rest = (k, m) => (thr(m.ts) || []).filter(x => x.ts !== m.ts && !x.deleted);
  const askIn = (k, m) => { if (isAsk(m)) return m; const r = rest(k, m); for (let i = r.length - 1; i >= 0; i--) if (isAsk(r[i])) return r[i]; return null; };
  const qOf = m => (m.buttons || []).some(b => !b.other);
  const qList = (k, m) => [m, ...rest(k, m)].filter(qOf);
  const cardRoots = () => { const s = new Set(); for (const c of openCards()) s.add(upRoot(c.thread || c.ts)); return s; };
  const deckIds = () => { const A = G('ARTS') || {}, o = new Set(); for (const [id, a] of Object.entries(A)) if (a?.kind === 'canvas' && /싱크 덱/.test(a.title || '')) o.add(id); return o; };
  function items(){
    const rk = askRank(), un = unreadSet(), cr = cardRoots(), it = [], dk = deckIds(), now = Date.now() / 1000; let dx = null;
    for (const {k, m} of roots()){
      const rr = rest(k, m), lastAt = Math.max(+m.ts || 0, +m.latest || 0, rr.length ? +rr[rr.length - 1].ts : 0);
      if (dk.size) for (const y of [m, ...rr]) if (now - +y.ts < 86400 && !X.done.get(y.ts) && (!dx || +y.ts > +dx.dm.ts) && artIds(y).some(id => dk.has(id))) dx = {k, m, dm: y};
      const dAt = X.done.get(m.ts); if (dAt && lastAt * 1000 <= dAt) continue;   // 완료 뒤 새 답이 오면 다시 뜸
      const ask = cr.has(m.ts) || !!askIn(k, m);
      it.push({k, m, ask, un: un.has(m.ts), at: lastAt, rank: rk.has(m.ts) ? rk.get(m.ts) : 1e6});
    }
    if (dx && dx.dm === dx.m){ const o = it.find(y => y.m === dx.m); if (o) Object.assign(o, {ask: true, rank: -1}); }   // 덱 글이 뿌리면 그 칸을 맨 위로(두 번 안 나옴)
    else if (dx) it.push({...dx, deck: true, ask: true, un: false, at: +dx.dm.ts, rank: -1});
    return it.sort((a, b) => (b.ask - a.ask) || (a.ask && b.ask ? a.rank - b.rank : 0) || (b.un - a.un) || (b.at - a.at)).filter((x, i) => i < 80 || x.ask || x.un);   // 내 차례 · 안 읽음은 80칸을 넘어도 안 자름
  }

  const head = (m, k, turn) => `<div class="xh"><b>${E(who(m))}</b>${topic(m, k)}<span class="xtm">${ago(m.ts)}</span>${turn ? '<span class="xturn">· 내 차례</span>' : ''}</div>`;
  const topic = (m, k) => { const t = chs().length > 1 ? (NAMES()[k] || AN()[k] || k) : ''; return t && t !== who(m) ? `<span class="xtp">${E(t)}</span>` : ''; };   // 이름 › 채널 — 채널이 하나면 뺌
  const firstPara = t => { const s = String(t || '').trim(), p = s.split(/\n\s*\n/)[0], one = p.split('\n')[0]; return /^\s*(\*\*|\*)?→/.test(p.split('\n')[1] || '') ? one : p; };
  const body = (m, brief) => { const f = files(m), t = brief ? firstPara(f.text) : f.text; const [h, cards] = t ? (G('attOut') || (x => [x, '']))(mdx(t, m.who !== 'owner')) : ['', ''];
    return `${t ? `<div class="xbd${brief ? ' xbrief' : ''}">${h}</div>` : ''}${cards}${f.html || ''}`; };
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
  const artIds = m => { const o = []; for (const y of String(m.src ?? m.text ?? '').matchAll(/\/(?:canvas|art)\/(hb[1-9A-HJ-NP-Za-km-z]{22})/g)) if (!o.includes(y[1])) o.push(y[1]); return o.slice(0, 4); };
  const embeds = (m, bd) => { const A = G('ARTS'), f = G('attCards'); const ids = artIds(m).filter(id => A?.[id] && !bd.includes(`art/${id}/`)); return ids.length && f ? f(ids) : ''; };
  const openCanvas = id => { const f = G('openArt'); if (f && G('ARTS')?.[id]) return f(id, {fill: true}); location.href = '/canvas/' + id; };
  function post(k, m, o = {}){
    const q = (m.buttons || []).some(b => !b.other);
    const bd = body(m, o.brief), part = q ? (o.part ? nn(o.part) : o.feed ? nn('1/2') : '') : '';
    const goto = q && o.feed ? `<button type="button" class="xgo" data-xopen="${E(m.thread || m.ts)}" data-k="${E(k)}">${MSG}<span>${o.more ? `<b>투표</b>에서 고르기 · ${E(o.more)}` : '<b>2/2 투표</b>에서 고르기 · 눌러서 열기'}</span></button>` : '';
    const sz = o.reply || o.ans ? 28 : 42;
    return `<article class="xp${m.pendingX ? ' xpend' : ''}${o.joined ? ' j' : ''}${o.reply ? ' xr' : ''}${o.more2 ? ' xr2' : ''}${o.main ? ' xm' : ''}${o.ans ? ' xa' : ''}${o.ask ? ' ask' : ''}" data-ts="${E(m.ts)}" data-k="${E(k)}" data-root="${E(o.root || m.ts)}">${o.joined ? '<i class="xl"></i>' : ''}${o.reply ? '<i class="xcv"></i>' : ''}`
      + `<span class="xav">${av(who(m), sz)}</span><div class="xc">${head(m, k, o.turn)}${bd.replace(/<\/p>/, part + '</p>')}${embeds(m, bd)}${goto}${o.pollHere ? '' : ''}${m.pendingX ? '' : acts(k, m, o.n || 0, o.done, o.sts, o.un && !o.joined)}</div></article>`;
  }
  function unit(x){
    if (x.deck) return `<div class="xu ask xdeck" data-root="${E(x.dm.ts)}" data-k="${E(x.k)}">${post(x.k, x.dm, {feed: true, ask: true, turn: true, root: x.m.ts, sts: x.sts})}</div>`;   // ✓ 는 덱 글만 내림(스레드 칸 그대로), 글을 누르면 그 스레드
    const {k, m} = x, r = rest(k, m), ask = askIn(k, m), qs = qList(k, m), bundle = qs.length > 1, open = qs.filter(isAsk), n = m.replies || r.length;
    const bq = bundle ? (open[0] || null) : (ask && ask !== m ? ask : null);   // 고를 물음(뿌리 물음은 뿌리 자체에 있음)
    const bo = bundle ? {part: `${qs.indexOf(bq || qs[qs.length - 1]) + 1}/${qs.length}`, more: open.length ? `${qs.length}개 중 ${open.length}개 남음` : `${qs.length}개 모두 접수됨`} : {};
    const last = r[r.length - 1] || null, tail = last && last !== bq && last !== m && !isAsk(last) ? last : null;   // 아직 고를 물음이 맨 끝이면 물음 하나만(같은 묶음의 물음 둘을 나란히 안 보임)
    const tgt = !x.ask ? null : bundle ? (bq || m) : (ask || m);   // 「내 차례」를 붙일 글 = 실제로 고를 글
    const cm = [bq && bq !== m ? bq : null, tail].filter(Boolean);
    if (!cm.length) return wrap(x, post(k, m, {feed: true, n, ask: x.ask, turn: tgt === m, un: x.un, sts: x.sts, ...(bq === m ? bo : {})}));
    const rows = cm.map((c, i) => post(k, c, {reply: true, feed: true, brief: c === tail && !qOf(c), more2: i < cm.length - 1, root: m.ts, n, ask: x.ask, turn: tgt === c, un: x.un, sts: x.sts, ...(qOf(c) ? bo : {})}));
    return wrap(x, post(k, m, {joined: true, feed: true, ask: x.ask, turn: tgt === m, sts: x.sts, ...(bq === m ? bo : {})}) + rows.join(''));
  }
  const wrap = (x, h) => `<div class="xu${x.ask ? ' ask' : ''}" data-root="${E(x.m.ts)}" data-k="${E(x.k)}">${h}</div>`;

  // ── 홈(X2 · X9): 맨 위 새 글 칸 + 피드
  const NAMES = () => Object.fromEntries(chs().map(k => [k, k === 'primary' ? (AN().primary || 'Primary') : String(AN()[k] || k).replace(/\s*리드\s*$/, '')]));
  const DR2 = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9h16M4 15h16"/></svg>';
  const FND = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
  function priHead(){
    const D0 = G('D'), bf = window.HB_MEMBER && D0 ? (D0.areas || []).find(a => a.key === 'primary')?.avatar : (typeof AGENT_CUSTOM === 'object' && AGENT_CUSTOM?.primary) || null;
    const name = window.HB_MEMBER?.bot || String(AN().primary || 'Primary').replace(/\s*리드\s*$/, ''), S = 34;
    let face = ''; try { face = bf?.photo && window.BXBot?.live ? window.BXBot.live(bf, S) : window.HB_BLOB ? window.HB_BLOB(bf?.seed || 'primary', {size: S, background: false, ...(bf ? {hue: bf.hue} : {})}) : ''; } catch {}
    return {name, face: face || av(name, S)};
  }
  function composer(){
    const ib = G('inputBox');
    return `<div class="xcmp"><span class="xav">${av(ME(), 42)}</span><div class="xc"><div class="xmeh"><b class="xme">${E(ME())}</b><button type="button" class="xsel" data-xsel aria-haspopup="listbox">${E(NAMES()[X.sel] || X.sel)} ▾</button></div>`
      + (ib ? ib('xnew', '무엇을 시킬까요?', {flow: true, label: '새 글', voice: {ch: X.sel}}) : '') + `</div></div>`;
  }
  const keepThumb = el => {
    const old = new Map();
    try { for (const i of el.querySelectorAll('img[data-thumb]')) if (i.complete && i.naturalWidth){ const k = i.getAttribute('src'); (old.get(k) || old.set(k, []).get(k)).push(i); } } catch {}
    return () => { if (!old.size) return; try { for (const n of el.querySelectorAll('img[data-thumb]')){ const o = old.get(n.getAttribute('src'))?.shift(); if (o && o !== n) n.replaceWith(o); } } catch {} };
  };
  let lastSig = '';
  function drawHome(force){
    fetchWanted();
    const v = V('home'), all = items(), it = X.fl === 'ask' ? all.filter(y => y.ask) : X.fl === 'info' ? all.filter(y => !y.ask) : all, sig = JSON.stringify([X.fl, all.filter(y => y.ask).length]) + JSON.stringify([it.map(x => [x.m.ts, x.m.latest, x.m.replies, x.ask, x.un, (thr(x.m.ts) || []).length, x.m.picked]), it.map(x => isSaved(x.m.ts))]);
    if (!force && sig === lastSig && v.firstChild) return; lastSig = sig;
    // 글 칸은 한 번만 만듦(다시 그려도 쓰던 글 · 포커스 · 한글 조합 · 첨부 · 토픽 창이 그대로) — 피드만 바꿈
    if (!v.querySelector('.xcmp')) v.innerHTML = `<header class="xhd"><button type="button" class="xdrb" data-xdr aria-label="메뉴">${DR2}</button><button type="button" class="xpri" data-xpri></button><button type="button" class="xfnd" data-xfind aria-label="찾기">${FND}</button></header>${composer()}<div class="xfl" role="tablist" aria-label="거르개"></div><div class="xfeed"></div>`;
    { const p = v.querySelector('.xpri'), h = priHead(), s = JSON.stringify(h); if (p && p.dataset.s !== s){ p.dataset.s = s; p.innerHTML = `<span class="xpa">${h.face}</span>`; p.setAttribute('aria-label', `${h.name} 와 대화`); } }
    const sl = v.querySelector('.xsel'); if (sl) sl.textContent = `${NAMES()[X.sel] || X.sel} ▾`;
    const st = v.scrollTop;
    const nAsk = all.filter(y => y.ask).length; v.querySelector('.xfl').innerHTML = [['all', '전체'], ['ask', `결정${nAsk ? ` ${nAsk}` : ''}`], ['info', '정보']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${X.fl === k}" data-xfl="${k}">${l}</button>`).join('');
    { const fd = v.querySelector('.xfeed'), back = keepThumb(fd);
      fd.innerHTML = it.map(unit).join('') || `<p class="xempty">${X.fl === 'ask' ? '지금 고를 것이 없어요' : '글이 없어요'}</p>`; back(); }
    v.scrollTop = st; watchSeen();
    for (const x of it.slice(0, 30)){ const t = thr(x.m.ts), l = t && t[t.length - 1]; if (x.m.replies && (!t || (x.m.latest && l && +x.m.latest > +l.ts))) loadThr(x.k, x.m.ts); }   // 한 번 읽은 스레드도 새 답이 왔으면 다시(안 그러면 피드 댓글이 옛 글에 멈춤)
  }
  const xgrow = t => { try { G('boardGrow')(t); } catch {} };   // 보드 grow(칸 높이 · has · ↑) — 이 안에 같은 이름을 두면 L.boardGrow 가 자기 자신을 읽음
  const pending = new Set();
  // 내 차례 · 안 읽음 스레드 받기: 없거나 · 오류였거나 · 그 일의 글이 받아 둔 것보다 새로우면. 한 번에 여섯까지(나머지는 끝나는 대로 다음 그리기에서)
  function fetchWanted(){ const now = Date.now(); X.tried ||= new Map(); for (const [t, {k, at}] of wantRoots()){ if (pending.size >= 6) break; if (pending.has(t)) continue; const T = cs().thr?.[t], ms = thr(t), last = ms?.length ? Math.max(...ms.map(m => +m.ts || 0)) : 0; if (T && !T.err && (!T.messages?.length || at <= last + .001)) continue; if (now - (X.tried.get(t) || 0) < 20000) continue; X.tried.set(t, now); loadThr(k, t); for (const kid of X.kids.get(t) || []) loadThr(k, kid); } }   // 같은 스레드는 20초에 한 번(받기가 끝날 때마다 다시 그리므로 오류면 끝없이 돌 수 있음)
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
      try { if (window.HBV?.memo?.id === 'xth') window.HBV.memoStop?.(false); if (cs().att?.xth?.length) G('dropAtt')?.('xth'); } catch {}   // 쓰던 첨부 · 녹음이 다른 스레드로 따라가지 않게(보드 openThread 와 같음)
      v.innerHTML = `<header class="xhd xbk"><button type="button" class="xback" data-xback aria-label="뒤로">${BACK}</button><b>스레드</b><small>${E(NAMES()[t.k] || '')}</small></header><div class="xfeed"></div>`
        + `<div class="xrep">${G('inputBox')?.('xth', '답글 쓰기', {flow: true, label: '답글', voice: {ch: t.k, th: t.ts}}) || ''}</div>`;
      keepRep(v);
    }
    if (v.dataset.sig === h) return; v.dataset.sig = h;
    const stick = Date.now() < (X.stickTo || 0) || (v.scrollTop > 0 && v.scrollHeight - v.scrollTop - v.clientHeight < 80);   // 맨 아래를 보던 중이면(방금 보낸 답 포함) 새 글이 와도 아래에 붙음
    { const fd = v.querySelector('.xfeed'), back = keepThumb(fd); fd.innerHTML = h; back(); } if (stick) v.scrollTop = v.scrollHeight;
  }
  async function openThread(k, ts){ X.th = {k, ts}; show('thread'); drawThread(); await Promise.all([loadThr(k, ts), ...[...(X.kids.get(ts) || [])].map(kid => loadThr(k, kid))]); drawThread(); }

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
    R.classList.toggle('xnodes', tab === 'nodes'); if (tab === 'nodes') try { window.show?.('tree'); dispatchEvent(new Event('hbside')); if (location.hash === '#tree') history.replaceState(null, '', '/feed'); } catch {}   // 노드 = 뒤에서 돌던 보드 트리를 그대로 드러냄(새로 안 그림), 막대만 위에
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
    const rows = (window.HBInbox?.state?.unread || []).filter(x => upRoot(x.thread || x.ts) === rootTs);
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

  function compose(){ show('home'); const v = V('home'); v.scrollTop = 0; v.querySelector('#xnew')?.focus(); }
  const keepRep = v => { const f = v.querySelector('.xrep'); if (f && window.ResizeObserver){ keepRep.ro?.disconnect(); keepRep.ro = new ResizeObserver(() => { root.style.setProperty('--xrh', f.offsetHeight + 'px'); if (Date.now() < (X.stickTo || 0)) v.scrollTop = v.scrollHeight; }); keepRep.ro.observe(f); } };   // 칸이 커진 만큼 스레드 아래 여백도(마지막 답이 안 가리게)
  // 내리면 막대가 숨고 + 단추만, 올리면 다시. 머리 줄도 내렸을 때만. 옆으로는 아무것도 안 움직임(transform 만)
  const lastY = new WeakMap();
  root.addEventListener('scroll', e => { const v = e.target; if (!v.classList?.contains('xv')) return;
    const y = Math.max(0, v.scrollTop), p = lastY.has(v) ? lastY.get(v) : 0; v.classList.toggle('xs', y > 2);
    if (y < 60){ root.classList.remove('xlow'); lastY.set(v, y); }
    else if (Math.abs(y - p) > 8){ root.classList.toggle('xlow', y > p); lastY.set(v, y); } }, {capture: true, passive: true});
  // 답 칸은 화면 아래 고정 — 키보드가 뜨면 그 위로(보이는 영역 아래 끝 기준)
  { const vv = window.visualViewport; if (vv){ const kb = () => { const h = Math.max(0, innerHeight - vv.height - vv.offsetTop); root.style.setProperty('--xkb', h > 60 ? h + 'px' : '0px'); }; vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb); } }
  // ── 누름
  root.addEventListener('click', e => {
    const t = e.target, q = s => t.closest(s);
    const nav = q('.xt'); if (nav){ const k = nav.dataset.xtab;
      if (k === 'dm') return void (location.href = '/es');
      return show(k); }
    if (q('[data-xtab-fab]')) return compose();
    { const fl = q('[data-xfl]'); if (fl){ X.fl = fl.dataset.xfl; try { localStorage.setItem(FLK, X.fl); } catch {} V('home').scrollTop = 0; return drawHome(true); } }
    { const xa2 = q('[data-xart]'), al = t.closest('a[href]'), am = al && /\/(?:canvas|art)\/(hb[1-9A-HJ-NP-Za-km-z]{22})/.exec(al.getAttribute('href') || ''), id = xa2?.dataset.xart || am?.[1];
      if (id){ e.preventDefault(); e.stopPropagation(); return openCanvas(id); } }
    if (q('[data-xfind]')) return void document.querySelector('.bx-sb [data-go="find"], .bx-dr [data-go="find"]')?.click();
    if (q('[data-xdr]')) return void document.querySelector('.bx-menu')?.click();
    if (q('[data-xpri]')){ if (PC.matches){ feedOff(); return void window.openChan?.('primary'); } return void (location.href = '/es#chat/primary'); }
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
    const send1 = q('[data-csend]'); if (send1){ e.stopPropagation(); if (window.HBV?.memo?.id === send1.dataset.csend) return; return void post1(send1.dataset.csend); }
    const attach = q('[data-attach]'); if (attach){ e.stopPropagation(); const fp = G('filePick'); if (fp){ fp.dataset.to = attach.dataset.attach; fp.click(); } return; }
    const xa = q('[data-xatt]'); if (xa){ e.stopPropagation(); const [id, i] = xa.dataset.xatt.split(':'), l = cs().att?.[id] || [], a = l[+i]; try { a?.xhr?.abort?.(); } catch {} if (a?.url) URL.revokeObjectURL(a.url); l.splice(+i, 1); return chips(id); }
    if (q('[data-xsel]')) return selOpen();
    const pick = q('[data-xpick]'); if (pick){ X.sel = pick.dataset.xpick; selClose(); const vb = V('home').querySelector('.cvoice[data-vhud-ch]'); if (vb) vb.dataset.vhudCh = X.sel; return drawHome(true); }
    if (q('.xselpop') === null && root.querySelector('.xselpop') && !q('[data-xsel]')) selClose();
    const p = q('.xu .xp'); if (p && !q('a, button, .xpoll, img, video, audio')){ if ((X.pend.get('new:' + p.dataset.k) || []).some(y => y.ts === p.dataset.root)) return; return openThread(p.dataset.k, p.dataset.root); }   // 아직 서버에 없는 글은 열 스레드가 없음
  });
  const chips = id => { const b = root.querySelector(`.box[data-mbox="${id}"]`); if (!b) return; try { b.querySelector('.att').innerHTML = G('attChips')(id); } catch {} xgrow(document.getElementById(id)); };
  const X_IDS = new Set(['xnew', 'xth']);
  { const a0 = window.attChanged, s0 = window.chatSend;
    window.attChanged = id => X_IDS.has(id) ? chips(id) : a0?.(id);   // 고른 첨부 · 올림 끝 · 음성 메모가 이 칸에 보이게
    window.chatSend = id => X_IDS.has(id) ? post1(id) : s0?.(id); }   // 녹음 멈춤 뒤 보내기(voice.js)도 이 길로
  document.addEventListener('paste', e => { if (!X_IDS.has(e.target.id)) return; const fs = [...(e.clipboardData?.files || [])]; if (!fs.length) return; e.preventDefault(); G('addFiles')?.(e.target.id, fs); });
  root.addEventListener('keydown', e => { if (!X_IDS.has(e.target.id) || !G('enterSends')?.(e)) return; e.preventDefault(); if (window.HBV?.memo?.id !== e.target.id) post1(e.target.id); });
  async function post1(id){
    const ta = root.querySelector('#' + id), C = cs(); if (!ta) return; const isTh = id === 'xth', th = X.th, ch = X.sel; if (isTh && !th) return;
    let text = ta.value.trim(); const att = C.att?.[id] || []; if (!text && !att.length) return; try { text = G('withLnk')?.(id, text) ?? text; } catch {}
    const kept = ta.value; if (C.att) C.att[id] = []; ta.value = ''; chips(id);
    const putBack = () => { const now = root.querySelector('#' + id), same = !isTh || X.th?.ts === th.ts; if (!(now && same && !now.value)) return false; now.value = kept; if (C.att) C.att[id] = [...att, ...(C.att[id] || [])]; chips(id); return true; };   // 보내는 동안 다른 스레드에 다녀오면 칸이 새로 만들어짐 — 지금 화면의 칸에 되살림
    const body = isTh ? {channel: th.k, thread: th.ts, text} : {channel: ch, text}, pk = isTh ? th.ts : 'new:' + ch;
    // 바로 보이게: 칸을 비우는 순간 글을 화면에(서버 답을 기다리지 않음). 서버 글이 오면 thr · roots 가 뺌
    const q = {ts: (Date.now() / 1000).toFixed(6), at: Date.now() / 1000, who: 'owner', text: text || `첨부 ${att.length}개`, att: !!att.length, buttons: [], reactions: [], files: [], replies: 0, latest: null, ...(isTh ? {thread: th.ts} : {}), pendingX: true};
    const pendOut = () => { const l = (X.pend.get(pk) || []).filter(y => y !== q); if (l.length) X.pend.set(pk, l); else X.pend.delete(pk); };
    X.pend.set(pk, [...(X.pend.get(pk) || []), q]);
    if (isTh){ X.stickTo = Date.now() + 8000; drawThread(); root.querySelector('#xth')?.blur(); const v = V('thread'); requestAnimationFrame(() => { v.scrollTop = v.scrollHeight; }); } else sched();
    const tick = setInterval(() => { if (isTh) loadThr(th.k, th.ts); else try { Promise.resolve(G('loadCh')(ch)).then(sched, () => {}); } catch {} }, 3000);   // 판에 닿는 대로 진짜 글로
    const finish = r => { clearInterval(tick); if (r !== 'ok') pendOut(); else setTimeout(() => { pendOut(); sched(); }, 60000); sched(); };
    if (att.length){ const vm = att.find(a => a.vn)?.vn || null, ids = [];
      try { for (const a of att){ const fid = await G('upOne')(a); ids.push(fid); if (a.stt && a.vn === vm) body.stt = fid; } } catch { finish('fail'); putBack(); return say('일시적인 오류가 발생했어요'); }
      body.files = ids; if (vm) body.vnl = vm; }
    const r = await send(body, isTh ? 't' + th.ts : 'new:' + ch);
    finish(r);
    if (isTh){
      if (r === 'maybe') return say('답글이 올라갔을 수 있어요. 스레드에서 확인해 주세요');
      if (r === 'fail') return say(putBack() ? '답글을 보내지 못했어요. 글은 칸에 다시 넣어 뒀어요' : '답글을 보내지 못했어요. 다시 써 주세요');
      await loadThr(th.k, th.ts); if (X.th?.ts === th.ts) drawThread();
      return; }
    if (r === 'ok'){ say(`# ${NAMES()[ch] || ch}에 올렸어요`); try { await G('loadCh')(ch); } catch {} return sched(); }
    if (r === 'maybe') return say(`# ${NAMES()[ch] || ch}에 올라갔을 수 있어요. 피드에서 확인해 주세요`);
    putBack(); say('올리지 못했어요. 글은 칸에 다시 넣어 뒀어요');
  }
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
  const feedOff = () => { if (!R.classList.contains('bx-x')) return; R.classList.remove('bx-x', 'xnodes'); if (location.pathname === '/feed') history.pushState(null, '', '/' + location.hash); dispatchEvent(new Event('hbside')); };
  try { new MutationObserver(() => { if (typeof ans !== 'undefined' && !ans.hidden && R.classList.contains('bx-x') && !R.classList.contains('xnodes')) feedOff(); }).observe(ans, {attributes: true, attributeFilter: ['hidden']}); } catch {}   // 찾기 · 알림 · 사이드바가 대화를 열면 그 화면을 가리지 않게
  const feedOn = () => { try { if (typeof ans !== 'undefined' && !ans.hidden) window.closeAns?.(); } catch {} R.classList.add('bx-x'); if (location.pathname !== '/feed') history.pushState(null, '', '/feed'); show('home'); dispatchEvent(new Event('hbside')); };
  window.BXFeed = {on: feedOn, off: feedOff};
  document.addEventListener('click', e => { if (!R.classList.contains('bx-x')) return; const n = e.target.closest?.('.bx-sb .bx-sbsc button, .bx-dr .bx-sbsc button, .bx-sb .lgb, .bx-dr .lgb, .bx-sb a, .bx-dr a, .bx-dd button, .bx-dd a, .bx-mpop [data-mi="invite"], .bx-mpop [data-mi="feedback"]'); if (!n || n.closest('[data-fold]') || n.dataset.fold != null || n.dataset.go === 'feed') return; feedOff(); }, true);
  addEventListener('popstate', () => { if (location.pathname === '/feed'){ if (!R.classList.contains('bx-x')) feedOn(); } else feedOff(); });
  const tidy = () => { if (location.pathname === '/feed' && R.classList.contains('bx-x') && /^#(tree|board|timeline|arts|lanes|refs|logic)?$/.test(location.hash)) history.replaceState(history.state, '', '/feed' ); };
  addEventListener('hashchange', tidy); for (const ms of [800, 2000, 4000, 8000]) setTimeout(tidy, ms);
  const T0 = new URLSearchParams(location.search).get('tab');   // /es 막대에서 온 칸(?tab=nodes · save · me)
  show(['nodes', 'save', 'me'].includes(T0) ? T0 : 'home'); if (T0) history.replaceState(null, '', '/feed'); refresh(); setInterval(refresh, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
