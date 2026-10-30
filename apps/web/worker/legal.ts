import { Hono } from "hono";
import privacyKo from "./legal/privacy-ko.md?raw";
import privacy from "./legal/privacy.md?raw";
import terms from "./legal/terms.md?raw";
import dpa from "./legal/dpa.md?raw";
import subprocessors from "./legal/subprocessors.md?raw";

const COMPANY: Record<string, string> = { OPERATOR: "", COMPANY_NAME_EN: "", COMPANY_NAME_KO: "", COMPANY_ADDRESS: "", BUSINESS_NO: "", REPRESENTATIVE: "", PHONE: "", MAIL_ORDER_NO: "" };
const fill = (md: string, ko: boolean) => md.split("\n")
  .map(l => l.replace(/\{\{OPERATOR\}\}/g, ko ? "보더" : "Boarder"))
  .filter(l => [...l.matchAll(/\{\{([A-Z_]+)\}\}/g)].every(m => COMPANY[m[1]]))
  .map(l => l.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => COMPANY[k]))
  .join("\n");

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const inline = (s: string) => esc(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/(^|[\s(])_([^_]+)_(?=[\s).,:;]|$)/g, "$1<em>$2</em>")
  .replace(/\[([^\]]+)\]\(((?:https?:|mailto:|\/|#)[^)\s]*)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

function render(md: string): { title: string; html: string } {
  const out: string[] = [], lines = md.split("\n");
  let title = "", i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { const n = h[1].length; if (n === 1 && !title) title = h[2]; out.push(`<h${n} id="${slug(h[2])}">${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) { if (!/^\|[\s:|-]+\|$/.test(lines[i])) rows.push(lines[i].replace(/^\||\|$/g, "").split("|").map(c => c.trim())); i++; }
      const [head, ...body] = rows;
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l), items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "")); i++; }
      out.push(`<${ordered ? "ol" : "ul"}>${items.map(t => `<li>${inline(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return { title, html: out.join("\n") };
}

const DOCS: Record<string, { md: string; lang: string }> = {
  "privacy-ko": { md: privacyKo, lang: "ko" }, privacy: { md: privacy, lang: "en" }, terms: { md: terms, lang: "en" }, dpa: { md: dpa, lang: "en" }, subprocessors: { md: subprocessors, lang: "en" },
};
const page = (lang: string, title: string, body: string) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Boarder</title>
<style>:root{color-scheme:light dark;--fg:#111113;--muted:#6b6b73;--line:#e6e6ea;--bg:#fff}@media (prefers-color-scheme:dark){:root{--fg:#ececef;--muted:#9a9aa3;--line:#2a2a30;--bg:#111113}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif}main{max-width:760px;margin:0 auto;padding:40px 16px 80px}
nav{display:flex;gap:16px;font-size:13px;margin-bottom:28px}nav a{color:var(--muted);text-decoration:none}nav a:first-child{color:var(--fg);font-weight:600;margin-right:auto}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 8px}h3{font-size:16px;margin:24px 0 6px}a{color:inherit}code{font:13px ui-monospace,monospace;background:var(--line);padding:1px 4px;border-radius:4px}
table{border-collapse:collapse;width:100%;font-size:13px;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}em{color:var(--muted)}</style></head>
<body><main><nav><a href="/">${lang === "ko" ? "보더" : "Boarder"}</a><a href="/policy/privacy-ko">개인정보 처리방침</a><a href="/policy/privacy">Privacy</a><a href="/policy/terms">Terms</a></nav>${body}</main></body></html>`;

export const legal = new Hono();
for (const [key, d] of Object.entries(DOCS)) {
  const r = render(fill(d.md, d.lang === "ko"));
  const html = page(d.lang, r.title, r.html);
  legal.get(`/policy/${key}`, c => c.html(html, 200, { "cache-control": "public, max-age=3600" }));
}
// 짧은 주소(구글 동의 화면 · 메일 바닥글): 개인정보는 한국어가 기본
legal.get("/privacy", c => c.redirect("/policy/privacy-ko", 302));
legal.get("/terms", c => c.redirect("/policy/terms", 302));
