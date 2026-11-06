export const maskMail = (e: string) => {
  const [u, d] = String(e || "").toLowerCase().split("@");
  return !u || !d ? "다른 계정" : `${u[0]}${"*".repeat(Math.min(Math.max(u.length - 1, 2), 6))}@${d}`;
};

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));

/** 다른 계정으로 로그인된 브라우저: 그 링크 주인 계정(가림) · 지금 계정 · 바꾸기 단추(나가기 → 같은 주소 = 로그인 화면 → 로그인 뒤 이 링크) */
export function wrongAccount(owner: string, me: string, what: string) {
  return `<h2>다른 계정의 ${esc(what)}예요</h2><p>이 링크는 <b>${esc(maskMail(owner))}</b> 계정에서 만들었어요. 지금 이 브라우저는 <b>${esc(me)}</b> 로 들어와 있어요.</p>
<p class=sub>링크를 만든 계정으로 들어가면 이어서 할 수 있어요. 내 링크가 아니면 닫아요.</p><p><button id=sw>다른 계정으로 로그인</button></p>
<script>document.getElementById('sw').onclick=async e=>{e.target.disabled=true;try{await fetch('/api/auth/sign-out',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-hb':'1'},body:'{}'});}catch(_){}location.reload();};</script>`;
}

/** 링크 줄 주인의 메일: 줄 열쇠는 주인이면 "" 라 그 링크를 만든 기기의 owner 메일로 */
export async function linkOwnerMail(db: D1Database, tbl: "connect_link" | "approval_link", hash: string) {
  const r = await db.prepare(`SELECT l.owner AS k, d.owner AS m FROM ${tbl} l LEFT JOIN device d ON d.id = l.device_id WHERE l.hash = ?`).bind(hash).first<{ k: string; m: string | null }>();
  return r ? (r.k || r.m || "") : null;
}
