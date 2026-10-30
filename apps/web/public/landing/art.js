(() => {
  'use strict';
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rng = seed => { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
  const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

  // 보이는 동안만 도는 고리(초당 fps 번). step(dt 초, 지난 시간 초) — 화면 밖 · 숨긴 탭이면 쉼.
  function run(el, fps, step) {
    let vis = false, raf = 0, last = 0, acc = 0, t = 0;
    const tick = now => {
      raf = 0;
      if (!vis || document.hidden) { last = 0; return; }
      const dt = last ? Math.min(.25, (now - last) / 1000) : 0; last = now; acc += dt;
      if (acc >= 1 / fps || !t) { t += acc; step(acc, t); acc = 0; }
      raf = requestAnimationFrame(tick);
    };
    const go = () => { if (!raf && vis && !document.hidden) raf = requestAnimationFrame(tick); };
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { vis = es[es.length - 1].isIntersecting; go(); }, { rootMargin: '120px' }).observe(el);
    else vis = true;
    document.addEventListener('visibilitychange', go);
    go();
  }

  const C = {
    sky: ['#2c7ade', '#3584e3', '#418fe8', '#519bed', '#66a9f1', '#80b8f4', '#9fcaf7', '#c4defa', '#e4f0fd'],
    sun: '#fff7d6', sun2: '#ffe9a3', cloud: '#ffffff', cloud2: '#e6f1fd',
    far: '#c9dcf3', farCap: '#ffffff', farShade: '#aac4e6', mid: '#b4cde9', midShade: '#9fbbe0',
    snow: '#fbfdff', shade: '#e3ecf7', shade2: '#cbdaee', piste: '#ffffff', groom: '#e6eef9', edge: '#d3dfef', pole: '#ff6a2b',
    tree: '#1d5a43', tree2: '#277052', treeSnow: '#e8f1f6',
    lift: '#59627a', cable: '#7d869c', roof: '#d8473a', wall: '#8b5b3d', win: '#ffd36b',
    body: '#1b1e2b', jackets: ['#f0541e', '#ffc21a', '#e8467c', '#18b06a', '#7a5cff', '#00a0d8', '#ff8a00', '#2d6cdf'], trail: '#d6e3f3', spray: '#ffffff',
  };
  function hero(cv) {
    const ctx = cv.getContext('2d');
    let P, W, H, bg, fg, clouds, riders, trail, chairs, lift, path, R, port;
    const build = () => {
      const r = cv.getBoundingClientRect(), fadeC = getComputedStyle(document.body).backgroundColor || '#fff';   // 아래 흐림 = 페이지 바탕
      P = r.width < 640 ? 3 : 4;                         // 한 칸 = CSS 3–4px
      W = Math.max(60, Math.ceil(r.width / P)); H = Math.max(60, Math.ceil(r.height / P));
      cv.width = W; cv.height = H; R = rng(7);
      // 글 상자(data-art-safe 의 자식, 글자 · 단추 실제 폭) — 땅 · 산맥은 그 아래 · 오른쪽에만
      const sb0 = [...(cv.parentElement ? cv.parentElement.querySelectorAll('[data-art-safe] > *') : [])].reduce((a, e) => { const g = document.createRange(); g.selectNodeContents(e); const q = g.getBoundingClientRect(); return { r: Math.max(a.r, q.right), b: Math.max(a.b, q.bottom) }; }, { r: 0, b: 0 });
      const sr = Math.max(0, (sb0.r - r.left) / P), sb = Math.max(0, (sb0.b - r.top) / P);
      port = r.width <= 640 || sr > W * .7;              // 폰 · 글이 폭을 거의 채우면 땅을 글 아래로
      const put = (c2, c, x, y) => { c2.fillStyle = c; c2.fillRect(x, y, 1, 1); };
      // 땅 윗줄(능선): 왼쪽은 글 아래 낮게, 글 오른쪽에서 슬로프 꼭대기(오른쪽 위)로 올라감
      const yl = Math.round(Math.min(H * .86, Math.max(H * (port ? .58 : .62), sb + (port ? 12 : 10))));
      const xt = Math.round(W * (port ? .80 : .80)), yt = Math.round(port ? Math.max(sb + 5, yl - H * .07) : Math.min(H * .30, yl - 10));
      const x0 = port ? 0 : Math.min(xt - 12, Math.max(sr + 6, W * .42));
      const ease = t => t * t * (3 - 2 * t), wave = (x, s, a) => a * (Math.sin(x * .11 + s) * .6 + Math.sin(x * .27 + s * 2) * .4);
      const ridge = x => (x <= x0 ? yl : x <= xt ? lerp(yl, yt, ease((x - x0) / (xt - x0))) : lerp(yt, yt + H * .07, (x - xt) / Math.max(1, W - xt))) + wave(x, 2, 1.2);
      // 하늘 · 해 · 먼 산맥 — 고정
      bg = document.createElement('canvas'); bg.width = W; bg.height = H;
      const b = bg.getContext('2d'), n = C.sky.length - 1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = Math.pow(clamp(y / yl, 0, 1), 1.5) * n, i = Math.floor(v); put(b, C.sky[Math.min(n, (v - i) > bayer(x, y) ? i + 1 : i)], x, y); }
      const sx = Math.round(W * (port ? .84 : .92)), sy = Math.round(port ? (sb + yl) / 2 - 1 : Math.max(72 / P + 6, H * .13)), sr0 = port ? 4 : 6;   // 폰은 글이 폭을 채워 해를 단추 아래 띠로
      for (let y = -sr0 * 2; y <= sr0 * 2; y++) for (let x = -sr0 * 2; x <= sr0 * 2; x++) { const d = Math.hypot(x, y) / sr0; if (d <= 1) put(b, d > .75 ? C.sun2 : C.sun, sx + x, sy + y); else if (d < 1.9 && bayer(sx + x, sy + y) > .55 + (d - 1) * .5) put(b, C.sky[Math.max(0, Math.round(n * .55))], sx + x, sy + y); }
      const jag = (x, s) => Math.abs(Math.sin(x * .05 + s)) * .6 + Math.abs(Math.sin(x * .13 + s * 1.7)) * .3 + Math.abs(Math.sin(x * .33 + s * 2.3)) * .1;
      for (let x = 0; x < W; x++) {
        const amp = x > sr + 10 ? (port ? 12 : 26) : Math.max(0, Math.min(port ? 12 : 26, yl - 2 - sb - 4));
        const fy = Math.round(yl - 2 - jag(x, 3) * amp), right = jag(x + 1, 3) < jag(x, 3), my = Math.round(yl + 1 - jag(x, 9) * amp * .4);
        for (let y = Math.max(0, fy); y < H; y++) put(b, y - fy < 2 + wave(x, 5, 1) && bayer(x, y) > .2 ? C.farCap : right && bayer(x, y) > .4 ? C.farShade : C.far, x, y);
        for (let y = Math.max(0, my); y < H; y++) put(b, bayer(x, y) > .7 ? C.midShade : C.mid, x, y);
      }
      // 슬로프: 꼭대기(멀리)에서 아래 가운데(가까이)로 넓어지는 띠
      const P0 = [xt - 3, Math.round(ridge(xt - 3)) + 1], P2 = [W * (port ? .44 : .38), H * 1.1], P1 = [P0[0] - (P0[0] - P2[0]) * .12, P0[1] + (P2[1] - P0[1]) * .55];
      const bez = s => [(1 - s) * (1 - s) * P0[0] + 2 * (1 - s) * s * P1[0] + s * s * P2[0], (1 - s) * (1 - s) * P0[1] + 2 * (1 - s) * s * P1[1] + s * s * P2[1]];
      const wide = s => lerp(3, W * (port ? 1.0 : .56), Math.pow(s, 1.5));
      const rows = []; for (let k = 0; k <= 600; k++) { const s = k / 600, [x, y] = bez(s); rows.push([y, x, s]); }
      const atY = y => { let i = rows.findIndex(q => q[0] >= y); if (i < 0) i = rows.length - 1; return rows[Math.max(0, i)]; };
      path = s => { const [x, y] = bez(s); return [x, y, wide(s)]; };
      // 리프트: 슬로프 오른쪽, 아래 역(가까이) → 위 역(꼭대기 옆)
      const B = [Math.min(W - 8, P2[0] + wide(.9) * .5 + W * (port ? .03 : .1)), H * .9], T = [P0[0] + (port ? 9 : 14), Math.round(ridge(P0[0] + (port ? 9 : 14))) + 1];   // 슬로프에서 떨어진 오른쪽
      lift = { B, T, at: u => [lerp(B[0], T[0], u), lerp(B[1], T[1], u)], sc: u => lerp(1, .16, Math.pow(u, .7)) };
      lift.top = u => { const [x, y] = lift.at(u); return [x, y - Math.round(3 + 13 * lift.sc(u))]; };
      fg = document.createElement('canvas'); fg.width = W; fg.height = H;
      const f = fg.getContext('2d'), dot = (c, x, y) => put(f, c, Math.round(x), Math.round(y));
      const onLift = (x, y) => { const u = clamp((y - B[1]) / (T[1] - B[1]), 0, 1), [lx] = lift.at(u); return Math.abs(x - lx) < 2 + 5 * lift.sc(u); };
      for (let x = 0; x < W; x++) {
        const ry = Math.round(ridge(x));
        for (let y = Math.max(0, ry); y < H; y++) {
          const [, cx, s] = atY(y), w = wide(s), u = (x - cx) / w;
          let c = bayer(x, y) > .45 ? C.shade : C.snow;                                              // 다지지 않은 눈은 살짝 푸름 — 슬로프가 도드라지게
          if (x > xt && (x - xt) * .6 > (y - yt) * .3 && bayer(x, y) > .25) c = C.shade2;           // 꼭대기 오른쪽 비탈은 그늘
          if ((Math.sin(x * .09 + y * .21) + Math.sin(x * .05 - y * .13)) > 1.3 && bayer(x, y) > .5) c = C.shade;   // 눈 언덕 결
          if (y >= P0[1] && Math.abs(u) <= .5) {                                                     // 다져 놓은 슬로프 — 결 줄
            c = C.piste; const g = (u + .5) * 14; if (Math.abs(g - Math.round(g)) < .09 && s > .15) c = C.groom;
            if (Math.abs(u) > .46) c = C.edge;
          }
          if (y - ry < 1) c = '#ffffff';
          dot(c, x, y);
        }
      }
      // 슬로프 가장자리 주황 깃대
      for (let s = .08; s < 1; s += .07) { const [x, y, w] = path(s), h = Math.round(1 + 4 * s); for (const side of [-1, 1]) for (let k = 0; k < h; k++) dot(C.pole, x + side * w * .52, y - k); }
      // 숲: 슬로프 · 리프트 길을 비우고, 아래로 갈수록 빽빽하고 큼
      const pine = (x, y, h) => { const c = R() < .55 ? C.tree : C.tree2; for (let i = 0; i < h; i++) { const w = Math.floor((i + 1) * .42); for (let k = -w; k <= w; k++) dot(i === 0 || (i === 1 && h > 4 && k === 0) ? C.treeSnow : c, x + k, y - h + i); } if (h > 3) dot(c, x, y + 1); };
      const top = Math.round(Math.min(...Array.from({ length: W }, (_, x) => ridge(x))));
      for (let y = top + 2; y < H; y++) {
        const k = clamp((y - top) / (H - top), 0, 1), cnt = Math.round(W * (.01 + k * k * .03));
        for (let i = 0; i < cnt; i++) {
          const x = Math.floor(R() * W); if (y < ridge(x) + 3) continue;
          const [, cx, s] = atY(y), w = wide(s);
          if (Math.abs(x - cx) < w * .62 + 2 || onLift(x, y)) continue;
          if (!port && x < W * .2 && y > H * .7 && y < H * .9) continue;                             // 산장 자리
          pine(x, y, Math.max(2, Math.round(2 + k * (port ? 7 : 9) * (.6 + R() * .5))));
        }
      }
      // 산장(왼쪽 아래, 창에 불)
      if (!port) { const hx = Math.round(W * .1), hy = Math.round(H * .84), hw = 16, hh = 7;
        for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) dot((y === 2 || y === 4) && x % 4 === 2 ? C.win : C.wall, hx + x, hy - y);
        for (let y = 0; y < 6; y++) for (let x = -y - 1; x < hw + y + 1; x++) dot(y === 0 ? '#ffffff' : C.roof, hx + x, hy - hh - 5 + y); }
      // 리프트 기둥 · 줄 · 역
      const tw = 5;
      for (let k = 0; k <= tw; k++) { const u = k / tw, [x, y] = lift.at(u), [, ty] = lift.top(u), arm = Math.round(1 + 2 * lift.sc(u)); for (let yy = Math.round(ty); yy <= y; yy++) dot(C.lift, x, yy); for (let a = -arm; a <= arm; a++) dot(C.lift, x + a, ty); }
      for (let i = 0; i <= 300; i++) { const u = i / 300, [x, y] = lift.top(u), o = Math.round(1 + 2 * lift.sc(u)); dot(C.cable, x - o, y); dot(C.cable, x + o, y); }
      const hut = (x, y, s) => { const w = Math.round(4 + 8 * s), h = Math.round(3 + 4 * s); for (let yy = 0; yy < h; yy++) for (let xx = -w / 2; xx < w / 2; xx++) dot(yy >= h - 2 ? C.roof : C.wall, x + xx, y - yy); };
      hut(B[0], B[1], lift.sc(0)); hut(T[0], T[1], lift.sc(1));
      // 아래 흐림 — 페이지 바탕으로
      const fadeH = Math.round(H * .1);
      for (let y = H - fadeH; y < H; y++) for (let x = 0; x < W; x++) if ((y - (H - fadeH)) / fadeH > bayer(x, y) * .9 + .05) dot(fadeC, x, y);
      // 움직이는 것: 구름(글 오른쪽 · 머리 줄 아래), 슬로프 위 사람 여럿, 리프트 의자
      clouds = []; for (let i = 0; i < (port ? 3 : 9); i++) clouds.push({ x: R() * W, y: Math.round(port ? lerp(sb + 3, yl - 3, R()) : lerp(Math.max(H * .05, 72 / P), yl - 26, R())), l: Math.round(lerp(8, port ? 22 : 40, R())), v: lerp(.6, 1.6, R()), c: R() < .4 ? C.cloud2 : C.cloud, x0: port ? 0 : Math.max(W * .55, sr + 6) });
      const N = port ? 8 : 14, mk = s => ({ s, dur: lerp(9, 15, R()), lane: lerp(-.32, .32, R()), amp: lerp(.06, .16, R()), ph: R() * 6, turns: lerp(3, 6, R()), col: C.jackets[Math.floor(R() * C.jackets.length)] });
      riders = Array.from({ length: N }, (_, i) => mk(i / N)); riders.mk = mk;
      chairs = Array.from({ length: port ? 6 : 9 }, (_, i) => ({ u: i / (port ? 6 : 9), who: R() < .7 ? C.jackets[Math.floor(R() * C.jackets.length)] : null }));
      trail = [];
    };
    const rider = (x, y, sz, dir, col) => {   // 멀리 있을수록 작게: 1 · 2 · 3칸
      const d = (c, ox, oy) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x + ox * dir), Math.round(y + oy), 1, 1); };
      if (sz === 1) { d(col, 0, -1); d(C.body, 0, 0); return; }
      if (sz === 2) { d(C.body, 0, -3); d(col, 0, -2); d(col, -1, -2); d(C.body, 0, -1); for (let k = -1; k <= 1; k++) d(C.body, k, 0); return; }
      d(C.body, 0, -5); d(col, 0, -4); d(col, 1, -4); d(col, -1, -3); d(col, 0, -3); d(col, 1, -3); d(col, 2, -3); d(C.body, 0, -2); d(C.body, 1, -1); d(C.body, -1, -1); for (let k = -2; k <= 2; k++) d(C.body, k, 0);
    };
    let last = 0;
    const frame = (time, still) => {
      const dt = still ? 0 : Math.min(.2, time - last); last = time;
      ctx.drawImage(bg, 0, 0);
      for (const c of clouds) { const span = W - c.x0 + c.l * 2, x = Math.round(c.x0 + ((c.x + time * c.v) % span) - c.l); if (x < c.x0 - 2) continue; ctx.fillStyle = c.c; ctx.fillRect(x, c.y, c.l, 1); ctx.fillRect(x + 3, c.y - 1, Math.round(c.l * .55), 1); ctx.fillRect(x - 3, c.y + 1, Math.round(c.l * .4), 1); }
      ctx.drawImage(fg, 0, 0);
      // 리프트 의자: 오른쪽 줄은 올라가고(사람 탐), 왼쪽 줄은 빈 의자가 내려옴
      for (const ch of chairs) {
        if (!still) ch.u = (ch.u + dt / 40) % 1;
        for (const [u, side, who] of [[ch.u, 1, ch.who], [1 - ch.u, -1, null]]) {
          const [x, y] = lift.top(u), sc = lift.sc(u), o = Math.round(1 + 2 * sc) * side, hang = Math.round(1 + 3 * sc), seat = Math.max(1, Math.round(1 + 2 * sc));
          ctx.fillStyle = C.lift; ctx.fillRect(Math.round(x + o), Math.round(y), 1, hang); ctx.fillRect(Math.round(x + o - seat / 2), Math.round(y + hang), seat, 1);
          if (who) { ctx.fillStyle = who; ctx.fillRect(Math.round(x + o), Math.round(y + hang - 1 - (sc > .5 ? 1 : 0)), 1, sc > .5 ? 2 : 1); }
        }
      }
      // 사람 여럿: 꼭대기에서 나와 갈지자로 내려옴 — 가까워질수록 빨라지고 커짐, 지나간 자국은 몇 초 뒤 사라짐
      for (const q of riders) {
        if (!still) q.s += dt / q.dur * (.55 + q.s * .9);
        if (q.s > 1.02) { Object.assign(q, riders.mk(0)); continue; }
        const s = clamp(q.s, 0, 1), [cx, cy, w] = path(s), a = q.ph + s * q.turns * Math.PI * 2, x = cx + w * (q.lane + q.amp * Math.sin(a)), y = cy;
        q.x = x; q.y = y; q.dir = Math.cos(a) > 0 ? 1 : -1; q.sz = s < .22 ? 1 : s < .5 ? 2 : 3;
        if (!still) trail.push([Math.round(x), Math.round(y), time, q.sz]);
      }
      if (still) for (const q of riders) for (let k = 1; k < 30; k++) { const s = q.s - k * .006; if (s < 0) break; const [cx, cy, w] = path(s), a = q.ph + s * q.turns * Math.PI * 2; trail.push([Math.round(cx + w * (q.lane + q.amp * Math.sin(a))), Math.round(cy), -k * .1, s < .66 ? 1 : 2]); }
      trail = trail.filter(p => time - p[2] < 3.5);
      ctx.fillStyle = C.trail;
      for (const [tx, ty, t0, sz] of trail) if ((time - t0) / 3.5 < bayer(tx, ty)) { ctx.fillRect(tx, ty, 1, 1); if (sz > 2) ctx.fillRect(tx + 1, ty, 1, 1); }
      for (const q of riders.slice().sort((a, b) => a.y - b.y)) if (q.x != null) rider(q.x, q.y, q.sz, q.dir, q.col);
    };
    build();
    const r0 = cv.getBoundingClientRect();
    let rz = 0, sz = Math.round(r0.width) + 'x' + Math.round(r0.height);
    addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const q = cv.getBoundingClientRect(), k = Math.round(q.width) + 'x' + Math.round(q.height); if (k === sz) return; sz = k; build(); frame(last, RM); }, 150); });   // 폰 주소창이 들고 나도 크기가 같으면 다시 그리지 않음
    const again = () => { build(); frame(last, RM); };
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', again);
    document.fonts?.ready.then(again);                    // 글꼴이 늦게 오면 글 상자가 바뀜 — 다시 잼
    if (RM) return frame(0, true);
    run(cv, 24, (dt, time) => frame(time, false));
  }

  /* ───────── ② 장면 공통: 블롭 ───────── */
  const looks = el => (el.closest('.art-pixel') && 'pixel') || (el.closest('.art-line') && 'line') || 'soft';
  const imgCache = new Map();
  function blob(seed, size, look, mood) {
    if (!window.HB_BLOB) return `<span class="ab-dot" style="width:${size}px;height:${size}px"></span>`;
    if (look === 'pixel') {   // 블롭을 14칸으로 그려 키움 — 히어로와 같은 픽셀 결
      const k = seed + mood;
      if (!imgCache.has(k)) imgCache.set(k, 'data:image/svg+xml,' + encodeURIComponent(HB_BLOB(seed, { size: 14, ...(mood === 'need' ? { expression: HB_EXPR.thinking } : mood === 'park' ? { expression: HB_EXPR.sleepy } : {}) })));
      return `<img class="ab-px" src="${imgCache.get(k)}" width="${size}" height="${size}" alt="">`;
    }
    const o = { size, ...(mood === 'need' ? { expression: HB_EXPR.thinking } : mood === 'park' ? { expression: HB_EXPR.sleepy } : mood === 'done' ? { expression: HB_EXPR.happy } : {}) };
    return mood === 'park' || RM ? HB_BLOB(seed, o) : HB_BLOB_ANIM(seed, { ...o, animate: 'always' });
  }
  const SEEDS = ['Primary', 'kite', 'moss', 'ember', 'tide', 'plum', 'reed', 'sol', 'fern', 'opal', 'dune', 'lark'];

  function nodes(el) {
    const look = looks(el), R = rng(11);
    el.innerHTML = '<svg class="an-lines" aria-hidden="true"></svg><div class="an-park"><span>주차</span></div>';
    const svg = el.firstChild, park = el.children[1];
    const N = {};
    const add = (id, seed, kind, parent, state) => {
      const d = document.createElement('div'); d.className = 'an-n an-' + kind; d.innerHTML = `<i class="an-ring"></i><b class="an-b"></b><i class="an-bar"></i><i class="an-flag"></i><i class="an-ok"></i>`;
      el.appendChild(d); N[id] = { id, seed, kind, parent, state, el: d, mood: '' }; return N[id];
    };
    add('P', 'Primary', 'root', null, 'work');
    ['L1', 'L2', 'L3'].forEach((id, i) => add(id, SEEDS[i + 1], 'lead', 'P', 'work'));
    add('H1', SEEDS[4], 'help', 'L1', 'work'); add('H2', SEEDS[5], 'help', 'L1', 'work'); add('H3', SEEDS[6], 'help', 'L2', 'work');
    add('K1', SEEDS[7], 'help', null, 'park'); add('K2', SEEDS[8], 'help', null, 'park'); add('K3', SEEDS[9], 'help', 'L3', 'work');
    const paint = n => {
      const mood = n.state === 'need' ? 'need' : n.state === 'park' ? 'park' : n.state === 'done' ? 'done' : 'work';
      if (n.mood !== mood) { n.el.querySelector('.an-b').innerHTML = blob(n.seed, n.kind === 'root' ? 40 : 30, look, mood); n.mood = mood; }
      n.el.dataset.s = n.state;
    };
    const layout = () => {
      const W = el.clientWidth, H = el.clientHeight, narrow = W < 560, ph = narrow ? 66 : 74;
      park.style.height = ph + 'px';
      const top = narrow ? 16 : 22, rowH = (H - ph - top - 24) / 3, leads = ['L1', 'L2', 'L3'];
      const pos = {}; pos.P = [W / 2, top + 20];
      leads.forEach((id, i) => {
        const cx = W / 2 + (i - 1) * Math.min(W / 3, 330); pos[id] = [cx, top + rowH + 16];
        const kids = Object.values(N).filter(n => n.parent === id && n.state !== 'park');
        kids.forEach((k, j) => { pos[k.id] = [cx + (j - (kids.length - 1) / 2) * (narrow ? 50 : Math.min(120, W / 9)), top + rowH * 2 + 20]; });
      });
      const parked = Object.values(N).filter(n => n.state === 'park').sort((a, b) => a.pk - b.pk);
      parked.forEach((n, i) => { pos[n.id] = [(narrow ? 78 : 112) + i * (narrow ? 48 : 70), H - ph / 2]; });
      for (const n of Object.values(N)) { const [x, y] = pos[n.id] || [W / 2, H]; n.el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`; paint(n); }
    };
    let pk = 0; for (const n of Object.values(N)) if (n.state === 'park') n.pk = pk++;
    const lines = () => {
      const o = el.getBoundingClientRect(); let d = '';
      const c = n => { const r = n.el.querySelector('.an-b').getBoundingClientRect(); return [r.left - o.left + r.width / 2, r.top - o.top + r.height / 2, r.height / 2]; };
      for (const n of Object.values(N)) {
        if (!n.parent || n.state === 'park') continue;
        const [x1, y1] = c(N[n.parent]), [x2, y2, r2] = c(n), a = y1 + (N[n.parent].kind === 'root' ? 40 : 32), b = y2 - r2 - 6, m = (a + b) / 2;   // 이름 막대 아래에서 나감
        d += look === 'pixel' ? `M${x1|0} ${a|0}V${m|0}H${x2|0}V${b|0}` : `M${x1} ${a}C${x1} ${m} ${x2} ${m} ${x2} ${b}`;
      }
      svg.innerHTML = `<path d="${d}"/>`;
    };
    const step = () => {
      const all = Object.values(N), helps = all.filter(n => n.kind === 'help');
      const working = helps.filter(n => n.state === 'work'), need = all.filter(n => n.state === 'need'), done = all.filter(n => n.state === 'done'), parked = helps.filter(n => n.state === 'park');
      if (done.length) { const n = done[0]; n.state = 'park'; n.parent = null; n.pk = pk++; return; }
      const opts = [];
      if (need.length) opts.push(['answer', 3]);
      if (working.length > 2) opts.push(['finish', 2]);
      if (parked.length && helps.filter(n => n.state !== 'park').length < 6) opts.push(['rise', parked.length > 2 ? 4 : 2]);
      if (!need.length) opts.push(['ask', 2]);
      let r = R() * opts.reduce((s, o) => s + o[1], 0), act = opts[0][0];
      for (const [a, w] of opts) { if ((r -= w) <= 0) { act = a; break; } }
      if (act === 'answer') need[0].state = 'work';
      if (act === 'finish') working[Math.floor(R() * working.length)].state = 'done';
      if (act === 'ask') { const c = all.filter(n => n.state === 'work' && n.kind !== 'root'); c[Math.floor(R() * c.length)].state = 'need'; }
      if (act === 'rise') {
        const n = parked.sort((a, b) => a.pk - b.pk)[0], leads = ['L1', 'L2', 'L3'].filter(l => all.filter(k => k.parent === l).length < 2);
        n.parent = leads[Math.floor(R() * leads.length)] || 'L2'; n.state = 'work';
      }
    };
    layout(); requestAnimationFrame(lines);
    addEventListener('resize', () => { layout(); lines(); });
    if (RM) { N.L3.state = 'need'; N.H3.state = 'done'; layout(); setTimeout(lines, 50); return; }
    let next = 1.2;
    run(el, 30, (dt, t) => { if (t > next) { step(); layout(); next = t + 1.5; } lines(); });
  }

  /* ── 타임라인: 창마다 한 줄, 진행 점이 흘러가고 물음은 색, 답하면 회색 ── */
  function timeline(el) {
    const look = looks(el), R = rng(5), lanes = 5;
    el.innerHTML = `<div class="at-now"><i></i></div>` + Array.from({ length: lanes }, (_, i) => `<div class="at-l"><b class="at-who">${blob(i ? SEEDS[i] : 'Primary', 26, look, 'work')}</b><div class="at-track"></div></div>`).join('');
    const tracks = [...el.querySelectorAll('.at-track')], laneEls = [...el.querySelectorAll('.at-l')];
    let items = [], parkedLane = -1, parkUntil = 0;
    const spawn = (i, x) => {
      const r = R(), kind = r < .16 ? 'ask' : r < .26 ? 'ok' : 'log';
      const d = document.createElement('i'); d.className = 'at-e at-' + kind; d.style.width = (kind === 'log' ? Math.round(lerp(18, 64, R())) : kind === 'ask' ? 44 : 14) + 'px';
      d.style.transform = `translateX(${Math.round(x)}px)`;   // 처음 움직이기 전(화면 밖)에도 제자리에
      tracks[i].appendChild(d); items.push({ d, i, x, kind });
    };
    const W0 = () => tracks[0].clientWidth;
    for (let i = 0; i < lanes; i++) for (let x = 0; x < W0(); x += lerp(60, 150, R())) spawn(i, x);
    const draw = (dt, t) => {
      const W = W0(), v = W < 400 ? 22 : 34;
      if (t > parkUntil) { if (parkedLane >= 0) laneEls[parkedLane].classList.remove('at-parked'); parkedLane = parkedLane >= 0 ? -1 : 1 + Math.floor(R() * (lanes - 1)); if (parkedLane >= 0) laneEls[parkedLane].classList.add('at-parked'); parkUntil = t + (parkedLane >= 0 ? 4 : 5); }
      for (const it of items) {
        it.x -= v * dt;
        if (it.kind === 'ask' && it.x < W * .55 && !it.done) { it.done = 1; it.d.classList.add('at-answered'); }
        it.d.style.transform = `translateX(${Math.round(it.x)}px)`;
      }
      items = items.filter(it => it.x > -80 || (it.d.remove(), false));
      for (let i = 0; i < lanes; i++) {
        if (i === parkedLane) continue;
        const last = Math.max(-1e9, ...items.filter(it => it.i === i).map(it => it.x + it.d.offsetWidth));
        if (last < W - lerp(30, 110, R())) spawn(i, W + 4);
      }
    };
    if (RM) return draw(0, 0);
    run(el, 30, draw);
  }

  /* ── 채팅: 에이전트 진행 · 물음 카드 · 단추 하나로 답 · 이어서 일함 ── */
  function chat(el) {
    const look = looks(el);
    el.innerHTML = '<div class="ac-col"></div>';
    const col = el.firstChild;
    const bars = (...w) => w.map(x => `<i style="width:${x}%"></i>`).join('');
    const msgs = [
      () => `<div class="ac-m">${blob('kite', 28, look, 'work')}<div class="ac-t">${bars(46, 82, 64)}</div></div>`,
      () => `<div class="ac-m">${blob('moss', 28, look, 'work')}<div class="ac-t ac-list">${bars(70, 58, 76)}</div></div>`,
      () => `<div class="ac-m ac-card">${blob('ember', 28, look, 'need')}<div class="ac-t"><div class="ac-q">${bars(60, 40)}</div><div class="ac-ch"><u class="ac-a">${bars(70)}</u><u>${bars(60)}</u><u>${bars(50)}</u></div></div></div>`,
      () => `<div class="ac-m ac-me"><div class="ac-t">${bars(100)}</div></div>`,
      () => `<div class="ac-m">${blob('ember', 28, look, 'done')}<div class="ac-t">${bars(38, 70)}</div><i class="ac-ok"></i></div>`,
    ];
    let k = 0, t0 = 0;
    const push = html => {
      const w = document.createElement('div'); w.className = 'ac-w'; w.innerHTML = html; col.appendChild(w);
      requestAnimationFrame(() => w.classList.add('ac-in'));
      while (col.children.length > 7) col.firstChild.remove();
    };
    const typing = () => { const w = document.createElement('div'); w.className = 'ac-w ac-in ac-typing'; w.innerHTML = '<div class="ac-m"><i class="ac-dots"><b></b><b></b><b></b></i></div>'; col.appendChild(w); return w; };
    if (RM) { msgs.forEach(f => push(f())); col.querySelector('.ac-a')?.classList.add('ac-pick'); return; }
    msgs.forEach(f => push(f()));                         // 처음부터 한 판이 차 있게
    col.querySelector('.ac-a').classList.add('ac-pick'); col.querySelector('.ac-card').classList.add('ac-done');
    k = msgs.length - 1;
    let ty = null;
    run(el, 20, (dt, t) => {
      if (t - t0 < (k === 2 ? 2.4 : 1.4)) return;
      t0 = t;
      if (ty) { ty.remove(); ty = null; }
      k = (k + 1) % msgs.length;
      if (k === 3) { const a = col.querySelector('.ac-card:not(.ac-done) .ac-a'); if (a) { a.classList.add('ac-pick'); a.closest('.ac-card').classList.add('ac-done'); } }
      push(msgs[k]());
      if (k === 0 || k === 1 || k === 4) ty = k === 4 ? null : typing();
    });
  }

  function canvas(el) {
    const look = looks(el), R = rng(3);
    const card = (cls, x, y, w, h, inner) => `<div class="av-b ${cls}" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%">${inner}</div>`;
    const bars = n => Array.from({ length: n }, () => `<i style="width:${Math.round(lerp(40, 92, R()))}%"></i>`).join('');
    el.innerHTML = `<div class="av-world">${card('', 6, 10, 28, 36, `<s></s>${bars(4)}`)}${card('av-chart', 38, 6, 24, 30, '<em></em><em></em><em></em><em></em><em></em>')}${card('av-phone', 66, 8, 12, 50, `<s></s>${bars(5)}`)}${card('', 10, 54, 22, 34, `${bars(5)}`)}${card('av-tree', 36, 44, 26, 40, '<em></em><em></em><em></em><em></em>')}<div class="av-b av-new" style="left:66%;top:64%;width:22%;height:28%"><s></s>${bars(3)}</div><div class="av-cur">${blob('Primary', 26, look, 'work')}</div></div>`;
    if (RM) { el.querySelector('.av-new').classList.add('av-on'); return; }
    const nb = el.querySelector('.av-new'), cur = el.querySelector('.av-cur');
    let ph = -1;
    run(el, 10, (dt, t) => {
      const p = Math.floor(t / 2.2) % 4;
      if (p === ph) return; ph = p;
      if (p === 0) { nb.classList.remove('av-on'); cur.style.left = '92%'; cur.style.top = '96%'; }
      if (p === 1) { cur.style.left = '77%'; cur.style.top = '78%'; }
      if (p === 2) { nb.classList.add('av-on'); }
      if (p === 3) { cur.style.left = '50%'; cur.style.top = '30%'; }
    });
  }

  const KIND = { hero, nodes, timeline, chat, canvas };
  const init = () => document.querySelectorAll('[data-art]').forEach(el => { if (!el.dataset.artOn && KIND[el.dataset.art]) { el.dataset.artOn = 1; KIND[el.dataset.art](el); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
