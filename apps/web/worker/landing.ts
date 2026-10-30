
const HEAD = "가장 이상적인 에이전트 업무환경";
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export type LandingLook = { look: "soft" | "pixel" | "line"; dark?: boolean };
export const LANDING_LOOK: LandingLook = { look: "soft" };

const SECS = [
  { n: "01", lab: "노드", art: "nodes", t1: "창마다 어디까지 왔는지,", t2: "트리 하나로 봐요.", d: "일하는 창은 돌고, 물을 게 생기면 깃발이 서요. 끝난 창은 주차로 내려가고, 답이 오면 다시 올라와요." },
  { n: "02", lab: "타임라인", art: "timeline", t1: "언제 무엇을 했는지,", t2: "줄 하나로 흘러요.", d: "창마다 한 줄. 진행은 점으로 쌓이고, 물음은 색으로 남았다가 답하면 회색이 돼요." },
  { n: "03", lab: "채팅", art: "chat", t1: "정할 것만 위로 와요,", t2: "단추 하나로 답해요.", d: "에이전트가 올린 질문이 카드로 와요. 고르면 그 창이 이어서 일해요." },
  { n: "04", lab: "캔버스", art: "canvas", t1: "에이전트가 만든 화면을,", t2: "한 판에 펼쳐 봐요.", d: "설계 · 결과 판이 캔버스에 모여요. 끌고 확대하며 보고, 그 자리에서 답해요." },
];
const STEPS = [
  ["가입하고 설치 프롬프트를 복사해요", "가입하면 첫 화면에 단추 하나 — 영어 지시문이 복사돼요."],
  ["쓰는 AI 도구에 붙여넣어요", "설치 · 로그인 · 연결은 AI 도구가 해요."],
  ["브라우저에서 허용해요", "열린 브라우저에서 「허용」을 한 번 누르면 끝이에요."],
];

/** GitHub 마크(Octicons mark-github 16) — 소스 단추 */
const GH_MARK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';

export function landingPage(server: string, ph: string, L: LandingLook = LANDING_LOOK, asset = "/landing/", source = ""): string {
  const sec = SECS.map(s => `
<section class="sec" aria-labelledby="s${s.n}">
  <div class="head"><div class="lab">${s.n}&nbsp;&nbsp;${s.lab}</div>
    <div class="txt"><h2 id="s${s.n}">${s.t1}<br><span class="g">${s.t2}</span></h2><p>${s.d}</p></div></div>
  <div class="scene" data-art="${s.art}" role="img" aria-label="${esc(`${s.lab} 그림 — ${s.d}`)}"></div>
</section>`).join("");
  return `<!doctype html><html lang="ko"${L.dark ? ' data-theme="dark"' : ""}><head><meta charset="utf-8"><script>if(location.hash)location.replace("/login"+location.hash)</script><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>보더 — 가장 이상적인 에이전트 업무환경</title>
<meta name="description" content="${HEAD}">
<meta property="og:title" content="Boarder"><meta property="og:description" content="${HEAD}"><meta property="og:image" content="${esc(server.replace(/\/+$/, ""))}/landing/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="color-scheme" content="${L.dark ? "dark" : "light dark"}">
<link rel="icon" href="/icons/primary-blob.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Noto+Sans+KR:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="${asset}art.css">
<style>
:root{--bg:#fff;--ink:#111113;--muted:#3F3F46;--soft:#71717A;--gray2:#8A8A8F;--line:#E4E4E7;--sunk:#FAFAFA;--on-ink:#fff}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#0B0B0D;--ink:#F4F4F5;--muted:#C9C9D1;--soft:#9A9AA3;--gray2:#76767E;--line:#26262B;--sunk:#141418;--on-ink:#0B0B0D}}
:root[data-theme="dark"]{--bg:#0B0B0D;--ink:#F4F4F5;--muted:#C9C9D1;--soft:#9A9AA3;--gray2:#76767E;--line:#26262B;--sunk:#141418;--on-ink:#0B0B0D}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'Noto Sans KR',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;word-break:keep-all;overflow-wrap:break-word;-webkit-font-smoothing:antialiased}
.w{max-width:1168px;margin:0 auto;padding:0 24px}
.hero{position:relative;height:min(860px,max(640px,100svh));color:#fff;overflow:hidden}
.hero canvas{position:absolute;inset:0;width:100%;height:100%;display:block;image-rendering:pixelated;image-rendering:crisp-edges}
.hero .w{position:relative}
nav{height:64px;display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:600;letter-spacing:-.01em;color:inherit;text-decoration:none}
.logo img{width:24px;height:24px;display:block}
.pill{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 20px;border-radius:22px;font:inherit;font-size:15px;font-weight:600;white-space:nowrap;cursor:pointer;text-decoration:none;border:1px solid transparent;transition:opacity .15s,background .15s}
.pill.dark{background:var(--ink);color:var(--on-ink)}
.pill.dark:hover{opacity:.86}
.pill.white{background:#fff;color:#111113}
.pill.white:hover{opacity:.9}
.pill.glass{background:rgba(10,14,50,.45);color:#fff;border-color:rgba(255,255,255,.5);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.pill.glass:hover{background:rgba(10,14,50,.56)}
.pill.sm{height:36px;padding:0 16px;font-size:14px;border-radius:18px}
.nav-r{display:flex;align-items:center;gap:8px}
.gh svg{display:block;flex:none}
.pill:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.top{padding-top:76px}
h1{margin:0;font-size:68px;line-height:1.08;font-weight:600;letter-spacing:-.04em;text-shadow:0 1px 24px rgba(10,12,40,.18)}
h1 .g{color:rgba(255,255,255,.66)}
.lead{margin:26px 0 0;max-width:540px;font-size:19px;line-height:1.6;color:rgba(255,255,255,.88)}
.cta{margin-top:32px;display:flex;gap:10px;flex-wrap:wrap}
.g{color:var(--gray2)}
.sec{padding-top:152px;display:flex;flex-direction:column;gap:40px}
.sec:first-of-type{padding-top:96px}
.head{display:flex}
.lab{width:340px;flex:none;padding-top:10px;font-size:14px;color:var(--soft);font-family:'JetBrains Mono',ui-monospace,monospace}
.txt{display:flex;flex-direction:column;gap:18px}
h2{margin:0;font-size:40px;line-height:1.15;font-weight:500;letter-spacing:-.03em}
.txt p{margin:0;max-width:560px;font-size:17px;line-height:1.65;color:var(--muted)}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.steps li{border-radius:14px;box-shadow:0 0 0 1px var(--line);padding:20px;display:flex;gap:14px;align-items:flex-start}
.steps b{width:26px;height:26px;border-radius:13px;background:var(--ink);color:var(--on-ink);font-size:13px;display:grid;place-items:center;flex:none}
.steps strong{display:block;font-size:16px;font-weight:600;margin:2px 0 6px}
.steps span{display:block;font-size:14px;line-height:1.6;color:var(--soft)}
.end{padding:168px 0 120px;display:flex;align-items:center;justify-content:space-between;gap:24px}
footer{border-top:1px solid var(--line)}
footer .w{padding-top:28px;padding-bottom:40px;font-size:13px;color:var(--soft)}
footer .g{margin:0 0 10px;max-width:640px;line-height:1.6}footer .lg{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:10px}footer .lg a{color:inherit}
@media (max-width: 1100px){.lab{width:200px}}
@media (max-width: 860px){
  .head{flex-direction:column;gap:14px}.lab{width:auto;padding-top:0;font-size:13px}
  .steps{grid-template-columns:1fr}
}
@media (max-width: 640px){
  .w{padding:0 16px}
  .hero{height:max(680px,min(100svh,820px))}
  nav{height:56px}.logo{font-size:16px}.logo img{width:22px;height:22px}
  .pill.sm{height:34px;font-size:13px;padding:0 14px}
  .top{padding-top:40px}
  h1{font-size:40px;line-height:1.12}
  h1 .br{display:block}h1 br.pc{display:none}
  .lead{margin-top:18px;font-size:16px}
  .cta{margin-top:24px;gap:8px}.cta .pill{height:42px;font-size:14px;padding:0 18px}
  .sec{padding-top:80px;gap:16px}.sec:first-of-type{padding-top:48px}
  .txt{gap:14px}h2{font-size:26px;line-height:1.2}.txt p{font-size:15px;line-height:1.6}
  .end{padding:80px 0 56px;flex-direction:column;align-items:flex-start;gap:20px}
  footer .w{padding-top:20px;padding-bottom:28px;font-size:12px}
}
@media (prefers-reduced-motion: reduce){.pill{transition:none}}
</style>${ph}</head>
<body class="art-${L.look}">
<header class="hero">
  <canvas data-art="hero" aria-hidden="true"></canvas>
  <div class="w"><nav aria-label="보더">
    <a class="logo" href="/" aria-label="보더 첫 화면"><img src="/icons/primary-blob.svg" alt="" width="24" height="24"><span>보더</span></a>
    <div class="nav-r">${source ? `<a class="pill glass sm gh" href="${esc(source)}" target="_blank" rel="noopener" aria-label="GitHub 에서 소스 보기">${GH_MARK}<span>GitHub</span></a>` : ""}<a class="pill white sm" href="/login">로그인</a></div>
  </nav>
  <section class="top" data-art-safe>
    <h1>가장 이상적인<br>에이전트 업무환경</h1>
    <div class="cta"><a class="pill white" href="/login">시작하기</a><a class="pill glass" href="/login">로그인</a></div>
  </section></div>
</header>
<main>
<div class="w">
  ${sec}
  <section class="sec" aria-labelledby="s05">
    <div class="head"><div class="lab">05&nbsp;&nbsp;설치</div>
      <div class="txt"><h2 id="s05">프롬프트 하나 붙여넣으면,<br><span class="g">설치는 에이전트가 해요.</span></h2><p>CLI 설치 · 로그인 · 연결까지. 브라우저에서 「허용」을 한 번 누르면 보드에 첫 줄이 떠요.</p></div></div>
    <ol class="steps">${STEPS.map(([a, b], i) => `<li><b>${i + 1}</b><div><strong>${a}</strong><span>${esc(b)}</span></div></li>`).join("")}</ol>
  </section>
  <section class="end"><h2>지금 내 AI 도구에<br><span class="g">보더를 붙여 볼까요?</span></h2><a class="pill dark" href="/login">시작하기</a></section>
</div>
</main>
<footer><div class="w"><p class="g">보더는 AI 에이전트가 하는 일을 한 보드에서 보고 답하는 업무 도구예요. 구글 로그인은 계정 확인에만 쓰고, 구글 캘린더 · Gmail 커넥터는 사용자가 연결했을 때 그 사람의 에이전트가 읽을 때만 써요.</p><nav class="lg"><a href="/policy/privacy-ko">개인정보 처리방침</a><a href="/policy/privacy">Privacy Policy</a><a href="/policy/terms">이용약관</a></nav>© DGit</div></footer>
<script src="${asset}blobatar.js" defer></script><script src="${asset}art.js" defer></script>
</body></html>`;
}
