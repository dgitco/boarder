
export function installPrompt(server: string): string {
  const host = server.replace(/\/+$/, ""), flag = host === "https://boarder.dgit.co" ? "" : ` --server ${host}`;
  return `Set up Boarder on this machine for me. Boarder (${host}) is where my AI agents report progress and ask me questions.

1. Install the CLI: \`curl -fsSL ${host}/install.sh | sh\` (Windows PowerShell: \`irm ${host}/install.ps1 | iex\`). If \`boarder\` isn't found afterwards, use \`~/.local/bin/boarder\` (Windows: \`%USERPROFILE%\\.local\\bin\\boarder.cmd\`).
2. Run \`boarder setup --yes${flag}\` with a long timeout (up to 10 minutes). It signs me in and only reads: it does not change my AI tools (CLAUDE.md, AGENTS.md, hooks, settings, MCP, skills), my harness (Herdr, tmux) or my shell files. It opens my browser for one 「허용」; without a browser (SSH) it prints a code and a link — show me both right away.
3. Run \`boarder import --setup\` and tell me the summary line it prints — my open windows, sessions and to-dos show up as nodes on my board.
4. Ask me once whether I also want either of these (both are off, and each can be turned off again): my agents reporting to Boarder themselves (\`boarder enable report\` — adds Boarder to my AI tools, backed up first), or Boarder opening and managing AI windows here (\`boarder enable engine\`). Run only what I say yes to. \`boarder uninstall\` removes everything.

Only use the boarder CLI for this; don't edit tool config files by hand.`;
}

export const HOW_IT_WORKS = [
  { title: "설치 프롬프트를 복사해요", text: "아래 단추 하나 — 영어 지시문이 복사돼요." },
  { title: "AI 도구에 붙여넣어요", text: "Claude Code · Codex · Cursor · Gemini CLI. 설치와 설정은 AI 도구가 해요." },
  { title: "브라우저에서 허용해요", text: "열린 브라우저에서 「허용」 한 번이면 끝(코드 대조 없음)." },
];

export const BOARDER_SKILL = `---
name: boarder
description: Use whenever you start, make progress on, get blocked on or finish a task, need the human to decide something, or want to tell them something they should see — Boarder is where the human follows every AI window. Also when the user asks about Boarder, its setup, or "what's on my board".
---

# Boarder

The human follows your work on their Boarder board instead of reading every terminal. Report there through the \`boarder\` CLI (or the \`boarder\` MCP tools, which are the same).

## Report progress

- Start of a task: \`boarder log start "<what you're doing, one line>"\`
- Every big step, and at least every 30 minutes: \`boarder log progress "<where things stand>"\`
- Blocked: \`boarder log blocked "<what blocks you and who can unblock it>"\`
- Finished: \`boarder log done "<the result, with a link to the evidence>"\`
- Keep lines short and plain. No secrets, tokens or file contents.

## Ask the human

- A decision only they can make: \`boarder ask "<question>" --choice "<A (recommended)>" --choice "<B>"\`. It prints a card id.
- Wait for the answer with \`boarder wait <card id>\`, or keep working on something else and check later.
- Don't ask what you can decide yourself; recommend first.

## Bring existing work in

- If the human already runs their own harness or several AI windows, \`boarder import\` reads the open windows, recent sessions, linked issues/threads and to-dos and groups them into nodes on the board (their harness keeps running as it is). \`--setup\` also lists their MCP servers and roles for a card on the board.
- If their harness keeps its own task list, it can expose it to Boarder: a custom engine script (\`~/.config/boarder/engine.json\` → \`custom\`) that answers \`<script> items\` with JSON \`[{"id","title","state","window","branch","refs"}]\`.

## Look around

- \`boarder cards\` lists open cards. \`boarder status\` shows sign-in, this window and which AI tools have Boarder.
- Something about Boarder itself is broken or missing: \`boarder feedback "<what happened or what would help>" --kind bug|idea|other\` (goes to the people who make Boarder).
- If a command says this window has no token or the device is revoked, run \`boarder setup --yes\` again (safe to re-run) and tell the user if it needs them to approve in the browser.

Only use the boarder CLI or MCP for this; don't edit tool config files by hand.
`;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);

const DARK = "--ink:#f4f4f5;--soft:#d4d4d8;--muted:#a1a1aa;--line:#2e2e33;--sunk:#1c1c1f;--surface:#141416;--frame:#0b0b0c;--hover:#232327";
const BASE_CSS = `
:root{--ink:#111113;--soft:#3f3f46;--muted:#71717a;--line:#e4e4e7;--sunk:#f4f4f5;--surface:#fff;--frame:#ebebef;--accent:#f0541e;--ok:#047857;--hover:#f4f4f5}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--frame);color:var(--ink);font:15px/1.55 'Pretendard','Noto Sans KR',-apple-system,system-ui,sans-serif;word-break:keep-all}
button{font:inherit;cursor:pointer}
.panel{margin:14px;min-height:calc(100dvh - 28px);background:var(--surface);border-radius:14px;box-shadow:0 0 0 1px var(--line);padding:24px clamp(16px,4vw,48px) 48px}
.top{display:flex;align-items:center;gap:10px;margin-bottom:28px}
.top img{width:32px;height:32px;border-radius:9px}
.top b{font-size:17px}
.top .sp{flex:1}
.who{font-size:14px;color:var(--muted)}
.btn{height:44px;padding:0 20px;border:0;border-radius:22px;background:var(--ink);color:var(--surface);font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.btn.line{background:none;color:var(--ink);box-shadow:0 0 0 1px var(--line)}
.btn.sm{height:34px;padding:0 14px;font-size:14px}
.btn:disabled{opacity:.5;cursor:default}
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--ink);color:var(--surface);padding:10px 18px;border-radius:20px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.on{opacity:1}
@media (max-width:640px){.panel{margin:0;border-radius:0;min-height:100dvh;box-shadow:none}}
`;

const TOP = (email: string, extra = "", logo = "/icons/primary-blob.svg") => `<div class="top"><img src="${esc(logo)}" alt=""><b>보더</b><span class="sp"></span>${extra}<span class="who">${esc(email)}</span></div>`;

export type Bot = { seed: string; hue: number; name: string; photo: string; icon: string; fav: string };
/** 머리 아이콘: 봇이 있으면 그 봇(파비콘 · 홈 화면 · manifest), 없으면 보더 기본 */
const ICONS = (bot?: Bot | null) => bot
  ? `<link rel="icon" type="image/png" href="/_blob/${esc(bot.fav)}.png"><link rel="manifest" href="/manifest.webmanifest?i=${esc(bot.icon)}"><link rel="apple-touch-icon" href="/_blob/${esc(bot.icon)}.png">`
  : `<link rel="icon" type="image/svg+xml" href="/icons/primary-blob.svg"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/icon-180.png">`;
const THEME = `<script>try{const t=localStorage.getItem('hb-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>`;

export function memberOnboard(email: string, js: { blob: string; pick: string }): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>메인 봇 만들기 · 보더</title>
${ICONS()}<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="보더">${THEME}<style>${BASE_CSS}
body{min-height:100dvh}
@media (min-width:641px){:root:not([data-theme="dark"]) body{background:#F4F4F6}}
@media (min-width:641px) and (prefers-color-scheme:dark){:root:not([data-theme="light"]) body{background:var(--frame)}}
.ob-top{position:absolute;left:28px;top:22px;display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700}
.ob-top img{width:26px;height:26px}
.ob{min-height:100dvh;display:grid;place-items:center;padding:72px 16px 40px}
.ob .card{width:560px;max-width:100%;padding:36px;border-radius:24px;background:var(--surface);box-shadow:0 0 0 1px var(--line),0 20px 50px rgba(0,0,0,.08);display:flex;flex-direction:column;gap:22px}
.ob h1{font-size:26px;margin:0 0 6px;letter-spacing:-.01em}
.ob .sub{font-size:15px;color:var(--soft);margin:0;line-height:1.5}
.ob .btn{height:48px;width:100%;border-radius:24px;font-size:15px}
.ob .foot{display:contents}
.spin{display:inline-block;width:18px;height:18px;border-radius:50%;border:2px solid color-mix(in srgb,var(--surface) 40%,transparent);border-top-color:var(--surface);animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.bx-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:95;background:var(--ink);color:var(--surface);padding:10px 18px;border-radius:20px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;max-width:calc(100vw - 32px)}
.bx-toast.on{opacity:1}
@media (max-width:640px){
  html,body{background:var(--surface)}
  .ob-top{display:none}
  .ob{display:block;padding:calc(10px + env(safe-area-inset-top)) 22px calc(110px + env(safe-area-inset-bottom))}
  .ob .card{width:auto;padding:0;border-radius:0;box-shadow:none;gap:18px;background:none}
  .ob h1{font-size:24px;margin:0}
  .ob .sub{display:none}
  .ob .foot{display:block;position:fixed;left:0;right:0;bottom:0;padding:14px 22px calc(30px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--surface) 30%)}
}
</style></head><body><div class="ob-top"><img src="/icons/primary-blob.svg" alt="">Boarder</div>
<main class="ob"><div class="card"><div><h1>메인 봇 만들기</h1><p class="sub">창들을 대신 지휘하고 당신과 이야기할 봇이에요. 나중에 바꿀 수 있어요.</p></div>
<div id="pick"></div><div class="foot"><button class="btn" id="go">시작하기</button></div></div></main>
<script>${js.blob.replace(/<\//g, "<\\/")}</script><script>${js.pick.replace(/<\//g, "<\\/")}</script>
<script>
const go=document.getElementById('go'),P=BXBot.mount(document.getElementById('pick'));
document.getElementById('pick').addEventListener('bxb-change',()=>{go.disabled=!P.valid()});
go.onclick=async()=>{if(!P.valid())return;go.disabled=true;go.innerHTML='<span class="spin" aria-label="저장하는 중"></span>';
  try{await BXBot.save(P.get());location.replace('/')}catch(e){BXBot.toast(e.message||'일시적인 오류가 발생했어요');go.disabled=false;go.textContent='시작하기'}};
</script></body></html>`;
}

// 「저는 모찌예요 · 루미예요 · 봄이에요」: 끝 글자 받침이 있으면 「이에요」
const josa = (n: string) => { const c = n.charCodeAt(n.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 ? "이에요" : "예요"; };

/** 브라우저 승인(/device): 터미널 코드와 같은지 보고 허용 · 거절 */
export function devicePage(email: string, code: string, owner = false): string {
  if (owner) return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>기기 허용 · 보더</title><style>${BASE_CSS}.box{max-width:440px;margin:6vh auto 0}</style></head><body><div class="panel">${TOP(email)}<div class="box"><h1 style="font-size:24px">이 계정은 기기 승인을 쓰지 않아요</h1><p style="color:var(--soft)">주인 계정의 창 토큰은 주인 서버가 판마다 따로 줘요. 누가 이 주소를 보내 「허용」을 부탁했다면 누르지 마세요.</p><a class="btn line" href="/">보더로</a></div></div></body></html>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>기기 허용 · 보더</title>
<link rel="icon" type="image/svg+xml" href="/icons/primary-blob.svg"><style>${BASE_CSS}
.box{max-width:440px;margin:6vh auto 0;display:flex;flex-direction:column;gap:16px}
h1{font-size:26px;margin:0}
.code{font-family:ui-monospace,'JetBrains Mono',monospace;font-size:34px;font-weight:600;letter-spacing:.08em;text-align:center;padding:18px 0;border-radius:12px;background:var(--sunk)}
input.code{width:100%;border:0;color:var(--ink);text-transform:uppercase}
.meta{font-size:14px;color:var(--soft)}
.note{font-size:13px;color:var(--muted)}
.err{color:#b91c1c;font-size:14px}
.ok{color:var(--ok);font-size:16px;font-weight:600}
.btn{width:100%}
</style></head><body><div class="panel">${TOP(email)}
<div class="box" id="box"><h1>이 기기를 허용할까요?</h1><div class="meta">터미널에 나온 코드와 같은지 보세요.</div>
<input class="code" id="code" value="${esc(code)}" maxlength="9" autocomplete="off" spellcheck="false" aria-label="코드" placeholder="XXXX-XXXX">
<div class="meta" id="meta">로그인: <b>${esc(email)}</b></div>
<button class="btn" id="yes">이 기기 허용</button><button class="btn line" id="no">거절</button>
<div class="err" id="err" role="alert"></div><div class="note">코드는 10분 동안만 써요 · 허용한 기기는 보더 첫 화면 「기기 · 창」에서 언제든 폐기해요</div></div>
</div><script>
const $=s=>document.querySelector(s), E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const MSG={owner:'이 계정은 기기 승인을 쓰지 않아요',expired:'만료된 코드예요 — 터미널에서 boarder setup 을 다시 돌려요',unknown:'없는 코드예요 — 터미널 코드를 그대로 넣어요',done:'이미 처리한 코드예요'};
async function look(){const c=$('#code').value.trim().toUpperCase();if(c.length<9)return;const r=await fetch('/api/device/lookup?code='+encodeURIComponent(c),{credentials:'include'});const j=await r.json().catch(()=>({}));
  if(!r.ok){$('#err').textContent=MSG[j.error]||'일시적인 오류가 발생했어요';return}
  $('#err').textContent='';$('#meta').innerHTML='로그인: <b>${esc(email)}</b><br>기기: '+E(j.name||'이름 없음')+(j.tools?' · '+E(j.tools):'')+'<br>요청한 곳: '+E(j.country||'?')+' · '+E(j.ip||'?')+' · '+E(new Date(j.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}))+(j.same?' <span style="color:var(--ok)">(지금 이 브라우저와 같은 곳)</span>':' <b style="color:#b91c1c">(이 브라우저와 다른 곳 — 내가 돌린 게 아니면 거절)</b>')}
$('#code').addEventListener('input',e=>{let v=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);if(v.length>4)v=v.slice(0,4)+'-'+v.slice(4);e.target.value=v;look()});
async function act(allow){$('#yes').disabled=$('#no').disabled=true;const r=await fetch('/api/device/approve',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-hb':'1'},body:JSON.stringify({user_code:$('#code').value.trim().toUpperCase(),allow})});const j=await r.json().catch(()=>({}));
  if(!r.ok){$('#yes').disabled=$('#no').disabled=false;$('#err').textContent=MSG[j.error]||'일시적인 오류가 발생했어요';return}
  $('#box').innerHTML=allow?'<h1>허용했어요</h1><div class="ok">터미널로 돌아가요 — boarder setup 이 이어서 해요.</div><a class="btn line" href="/">보더 첫 화면으로</a>':'<h1>거절했어요</h1><div class="meta">터미널의 boarder setup 은 멈춰요.</div>'}
$('#yes').onclick=()=>act(true);$('#no').onclick=()=>act(false);look();
</script></body></html>`;
}
