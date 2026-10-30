(() => {
  const SEEDS = ['mochi', 'pebble', 'nova', 'tofu', 'echo', 'kiwi', 'company lead', 'DGit lead', 'personal lead', 'shop lead', 'luma', 'bean'];
  const HUES = [[18, '주황'], [45, '노랑'], [140, '초록'], [180, '청록'], [215, '파랑'], [265, '보라'], [320, '분홍'], [0, '빨강']];
  const DEF = {seed: 'mochi', hue: 180, name: '모찌'};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  const svg = (seed, hue, size, square) => window.HB_BLOB ? window.HB_BLOB(seed, {size, hue, ...(square ? {background: 'square'} : {})}) : '';
  const live = (v, size) => {
    const pid = /^[0-9a-f]{32}$/.test(v?.photo || '') ? `/_blob/${v.photo}.png` : v?.photo;
    if (pid) return `<img src="${esc(pid)}" alt="">`;
    const o = {size, hue: v?.hue, background: false};
    return window.HB_BLOB_ANIM ? window.HB_BLOB_ANIM(v?.seed || DEF.seed, {...o, animate: 'always'}) : window.HB_BLOB ? window.HB_BLOB(v?.seed || DEF.seed, o) : '';
  };
  const CSS = `
.bp{display:flex;flex-direction:column;gap:22px}
.bp-pv{display:flex;align-items:center;gap:18px;padding:16px;border-radius:18px;background:var(--bp-pv,#F8F8FA)}
.bp-pv .g{width:84px;height:84px;flex:none;display:grid;place-items:center}
.bp-pv .g svg,.bp-pv .g img{display:block;width:84px;height:84px}
.bp-pv .g img{border-radius:50%;object-fit:cover}
.bp-pv .n{font-size:22px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
.bp-pv .c{font-size:13px;color:var(--muted)}
.bp-sec{display:flex;flex-direction:column;gap:10px}
.bp-lab{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600;color:var(--muted)}
.bp-lab span{display:flex;gap:4px}
.bp-lab button{border:0;background:none;padding:2px 4px;font-size:13px;font-weight:400;color:var(--soft);border-radius:6px}
.bp-lab button:hover{background:var(--hover)}
.bp-sh{display:grid;grid-template-columns:repeat(6,72px);gap:8px}
.bp-sh button{width:72px;height:72px;padding:0;border:0;background:none;border-radius:19px;display:grid;place-items:center}
.bp-sh button svg{display:block;width:66px;height:66px;border-radius:16px}
.bp-sh button[aria-checked="true"]{box-shadow:inset 0 0 0 2px var(--ink)}
.bp-co{display:flex;gap:14px;flex-wrap:wrap}
.bp-co button{width:34px;height:34px;padding:0;border:0;border-radius:50%}
.bp-co button[aria-checked="true"]{box-shadow:0 0 0 2.5px var(--surface),0 0 0 4.5px var(--ink)}
.bp-co[aria-disabled="true"]{opacity:.35;pointer-events:none}
.bp-in{height:46px;width:100%;border:0;border-radius:12px;padding:0 14px;font:inherit;font-size:16px;color:var(--ink);background:var(--surface);box-shadow:inset 0 0 0 1.5px var(--line)}
.bp-in:focus{outline:none;box-shadow:inset 0 0 0 1.5px var(--ink)}
.bp-hint{font-size:12px;color:var(--muted)}
.bp-ok{font-size:12px;font-weight:400;color:var(--muted);opacity:0;transition:opacity .2s;margin-right:auto;margin-left:8px}
.bp-ok.on{opacity:1}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .bp{--bp-pv:#1c1c1f}}
:root[data-theme="dark"] .bp{--bp-pv:#1c1c1f}
@media (max-width:640px){
  .bp{gap:18px}
  .bp-pv{flex-direction:column;gap:8px;padding:18px;border-radius:20px}
  .bp-pv .g,.bp-pv .g svg,.bp-pv .g img{width:96px;height:96px}
  .bp-pv .n{font-size:20px;text-align:center}
  .bp-pv .c{display:none}
  .bp-sh{grid-template-columns:repeat(6,1fr);gap:6px}
  .bp-sh button{width:auto;height:auto;aspect-ratio:1;border-radius:16px}
  .bp-sh button svg{width:84%;height:84%;border-radius:12px}
  .bp-co{gap:6px;flex-wrap:nowrap;justify-content:space-between}
  .bp-co button{width:30px;height:30px}
  .bp-hint{display:none}
}`;
  const style = () => { if (document.getElementById('bp-css')) return; const s = document.createElement('style'); s.id = 'bp-css'; s.textContent = CSS; document.head.append(s); };

  // 사진(B-7): 가운데를 네모로 잘라 512 로 — 미리보기 · 아이콘 모두 이 하나에서
  const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  async function cropPhoto(file){
    const url = URL.createObjectURL(file);
    try { const i = await loadImg(url); return draw(i, 512, false).then(b => URL.createObjectURL(b)); } finally { URL.revokeObjectURL(url); }
  }
  function draw(img, n, circle){
    const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
    if (circle){ g.beginPath(); g.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2); g.clip(); }
    const w = img.naturalWidth || n, h = img.naturalHeight || n, s = Math.min(w, h);
    g.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, n, n);
    return new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('png')), 'image/png'));
  }
  const svgImg = s => loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s));

  function mount(el, init, opts){
    init = init || {}; opts = opts || {}; style();
    const pid = /^[0-9a-f]{32}$/.test(init.photoId || init.photo || '') ? (init.photoId || init.photo) : '';
    const st = {seed: init.seed || DEF.seed, hue: Number.isInteger(init.hue) ? init.hue : DEF.hue, name: init.name ?? DEF.name, photo: pid ? `/_blob/${pid}.png` : (init.photo || ''), photoId: pid};
    let seeds = SEEDS.includes(st.seed) || !init.seed ? SEEDS.slice() : [st.seed, ...SEEDS.slice(0, 11)];
    el.innerHTML = `<div class="bp">
  <div class="bp-pv"><div class="g" data-pv></div><div><div class="n" data-pn></div><div class="c">${esc(opts.caption || '좌측 상단 · 홈 화면 아이콘이 이 봇이 돼요')}</div></div></div>
  <div class="bp-sec"><div class="bp-lab">모양<i class="bp-ok" data-ok="shape" aria-live="polite">저장했어요</i><span><button type="button" data-up>사진 올리기</button><button type="button" data-mix>섞기</button></span></div><div class="bp-sh" role="radiogroup" aria-label="모양" data-sh></div></div>
  <div class="bp-sec"><div class="bp-lab">색<i class="bp-ok" data-ok="hue" aria-live="polite">저장했어요</i></div><div class="bp-co" role="radiogroup" aria-label="색" data-co>${HUES.map(([h, n]) => `<button type="button" role="radio" aria-label="${n}" title="${n}" data-hue="${h}" style="background:hsl(${h} 70% 72%)"></button>`).join('')}</div></div>
  <div class="bp-sec"><div class="bp-lab"><label for="bp-name">이름</label><i class="bp-ok" data-ok="name" aria-live="polite">저장했어요</i></div><input class="bp-in" id="bp-name" maxlength="20" autocomplete="off" spellcheck="false" enterkeyhint="done" value="${esc(st.name)}" data-nm><div class="bp-hint">${esc(opts.hint || '창들이 이 이름으로 불러요 · 한두 단어')}</div></div>
  <input type="file" accept="image/*" hidden data-file>
</div>`;
    const $ = s => el.querySelector(s);
    const paint = () => {
      $('[data-pv]').innerHTML = live(st, 84);
      $('[data-pn]').textContent = st.name.trim() || ' ';
      $('[data-sh]').innerHTML = seeds.map((s, i) => `<button type="button" role="radio" aria-label="모양 ${i + 1}" aria-checked="${!st.photo && s === st.seed}" data-seed="${esc(s)}">${svg(s, st.hue, 66, true)}</button>`).join('');
      el.querySelectorAll('[data-hue]').forEach(b => b.setAttribute('aria-checked', !st.photo && +b.dataset.hue === st.hue));
      $('[data-co]').setAttribute('aria-disabled', !!st.photo);
      el.dispatchEvent(new CustomEvent('bxb-change'));
    };
    const pick = k => { paint(); el.dispatchEvent(new CustomEvent('bxb-pick', {detail: k})); };
    el.addEventListener('click', e => {
      const s = e.target.closest('[data-seed]'); if (s){ if (s.dataset.seed === st.seed && !st.photo) return; st.seed = s.dataset.seed; st.photo = st.photoId = ''; return pick('shape'); }
      const h = e.target.closest('[data-hue]'); if (h){ if (+h.dataset.hue === st.hue) return; st.hue = +h.dataset.hue; return pick('hue'); }
      if (e.target.closest('[data-mix]')){ seeds = Array.from({length: 12}, () => Math.random().toString(36).slice(2, 9)); st.seed = seeds[0]; st.photo = st.photoId = ''; return pick('shape'); }
      if (e.target.closest('[data-up]')) $('[data-file]').click();
    });
    $('[data-file]').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { st.photo = await cropPhoto(f); st.photoId = ''; pick('shape'); } catch { toast('이 사진은 열 수 없어요'); }
    });
    $('[data-nm]').addEventListener('input', e => { st.name = e.target.value; $('[data-pn]').textContent = st.name.trim() || ' '; el.dispatchEvent(new CustomEvent('bxb-change')); });
    $('[data-nm]').addEventListener('change', () => el.dispatchEvent(new CustomEvent('bxb-pick', {detail: 'name'})));
    $('[data-nm]').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing){ e.preventDefault(); e.target.blur(); } });
    paint();
    let okT = {};
    return {
      get: () => ({...st, name: st.name.trim()}), valid: () => !!st.name.trim(),
      // 되돌리기(저장 실패) · 저장된 사진 id 반영 — 이름 칸에 쓰는 중이면 칸 글은 그대로
      set: v => { Object.assign(st, v); const n = $('[data-nm]'); if (document.activeElement === n) st.name = n.value; else n.value = st.name; paint(); },
      ok: k => { const e = el.querySelector(`[data-ok="${k}"]`); if (!e) return; e.classList.add('on'); clearTimeout(okT[k]); okT[k] = setTimeout(() => e.classList.remove('on'), 1600); },
    };
  }

  // 저장: 그림을 먼저 올리고(내용 해시 id) 그 id 로 봇을 씀 — 서버가 머리 바이트로 꼴을 다시 확인함
  const up = async b => {
    const r = await fetch('/api/me/bot/image', {method: 'POST', credentials: 'include', headers: {'content-type': b.type || 'image/png', 'x-hb': '1'}, body: b});
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || '일시적인 오류가 발생했어요'); return j.id;
  };
  async function save(v){
    const sq = v.photo ? await loadImg(v.photo) : null;   // 사진: 홈 화면은 네모 그대로 · 로고는 동그랗게
    const [icon, fav, photo] = await Promise.all([
      draw(sq || await svgImg(svg(v.seed, v.hue, 512, true)), 512, false).then(up),
      draw(sq || await svgImg(svg(v.seed, v.hue, 128, false)), 128, !!sq).then(up),
      v.photoId ? v.photoId : sq ? draw(sq, 512, false).then(up) : '',
    ]);
    const r = await fetch('/api/me/bot', {method: 'POST', credentials: 'include', headers: {'content-type': 'application/json', 'x-hb': '1'}, body: JSON.stringify({seed: v.seed, hue: v.hue, name: v.name, photo, icon, fav})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '일시적인 오류가 발생했어요');
    return j.bot;
  }
  function toast(t){
    let e = document.getElementById('bx-toast'); if (!e){ e = document.createElement('div'); e.id = 'bx-toast'; e.className = 'bx-toast'; e.setAttribute('role', 'status'); document.body.append(e); }
    e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2200);
  }

  window.BXBot = {mount, save, svg, live, toast};
})();
