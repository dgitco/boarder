import { useEffect, useState, type ReactNode } from "react";
import { CH, AREA_NAME, type Route } from "./lib/route";
import { useTheme, type ThemeChoice } from "./lib/theme";

const svg = (d: string, w = 18) => <svg width={w} height={w} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;
const I = {
  chat: svg('<path d="M4 4.75h12a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1z"/>'),
  node: svg('<rect x="7.5" y="2.75" width="5" height="4" rx="1"/><rect x="2.75" y="13.25" width="5" height="4" rx="1"/><rect x="12.25" y="13.25" width="5" height="4" rx="1"/><path d="M10 6.75v3M5.25 13.25v-3.5h9.5v3.5"/>'),
  canvas: svg('<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="11" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.5"/><rect x="11" y="11" width="6" height="6" rx="1.5"/>'),
  unread: svg('<path d="M4 4.75h8.5M4 4.75a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h1v3l4-3h7a1 1 0 0 0 1-1V9"/><circle cx="15.5" cy="4.5" r="2" fill="currentColor" stroke="none"/>'),
  saved: svg('<path d="M6 3.5h8a1 1 0 0 1 1 1v12l-5-3.2-5 3.2v-12a1 1 0 0 1 1-1z"/>'),
  drafts: svg('<path d="M12.8 4.2l3 3L7.5 15.5 4 16l.5-3.5 8.3-8.3z"/>'),
  menu: svg('<path d="M3.5 7h13M3.5 13h9"/>', 20),
  out: svg('<path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M12 13.5 15.5 10 12 6.5M15.5 10H8"/>'),
};
// 테마 단추 하나(보드와 같은 동작: 라이트 → 다크 → 시스템)
const THEME_ICON: Record<ThemeChoice, ReactNode> = {
  light: svg('<circle cx="10" cy="10" r="3.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/>'),
  dark: svg('<path d="M16.5 12A6.5 6.5 0 0 1 8 3.5a6.5 6.5 0 1 0 8.5 8.5z"/>'),
  system: svg('<rect x="2.5" y="3.5" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 13.5V17"/>'),
};
const THEME_KO: Record<ThemeChoice, string> = { light: "라이트", dark: "다크", system: "시스템 설정" };
const NEXT: Record<ThemeChoice, ThemeChoice> = { light: "dark", dark: "system", system: "light" };
const FLAG = <svg className="flag" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 1.75a.75.75 0 0 1 .75.75v.3c1.9-.9 3.6-.4 5 .1 1.3.5 2.4.9 3.9.2a.6.6 0 0 1 .85.55v6.6a.6.6 0 0 1-.35.55c-2 .9-3.5.4-4.9-.1-1.3-.5-2.6-.9-4.5 0v4.8a.75.75 0 0 1-1.5 0V2.5A.75.75 0 0 1 3 1.75z"/></svg>;
const PHONE = <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M6.6 3.2 4.9 3.5c-.8.2-1.4.9-1.3 1.7.5 5.6 5 10.1 10.6 10.6.8.1 1.5-.5 1.7-1.3l.3-1.7c.1-.6-.2-1.1-.7-1.4l-2-.9c-.5-.2-1.1-.1-1.4.3l-.7.8c-1.7-.8-3.1-2.2-3.9-3.9l.8-.7c.4-.4.5-.9.3-1.4l-.9-2c-.3-.5-.8-.8-1.4-.7z"/></svg>;

function useWide() {
  const q = "(min-width: 861px)";
  const [w, setW] = useState(() => matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q), f = () => setW(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return w;
}

export type Counts = { attn: number; unread: number; saved: number; drafts: number; unreadBy: Record<string, boolean> };

export function Frame({ route, go, counts, onSignOut, children }: { route: Route; go: (r: Route) => void; counts: Counts; onSignOut: () => void; children: ReactNode }) {
  const wide = useWide(), [theme, setTheme] = useTheme(), [dr, setDr] = useState(false);
  const act = ["chat", "unread", "saved", "drafts"].includes(route.view) ? "chat" : route.view === "canvas" ? "canvas" : "node";
  useEffect(() => {
    const R = document.documentElement;
    R.classList.toggle("bx-sideon", act === "chat"); R.classList.toggle("bx-dron", dr && !wide);
  }, [act, dr, wide]);
  useEffect(() => { if (wide) setDr(false); }, [wide]);
  useEffect(() => { if (!dr) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setDr(false); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [dr]);
  const pick = (r: Route) => { setDr(false); go(r); };
  const nodeView = route.view === "timeline" ? "timeline" : "tree";
  const cnt = (v: number, red?: boolean) => v ? <span className={"n" + (red ? " red" : "")}>{v > 99 ? "99+" : v}</span> : null;
  const it = (r: Route, icon: ReactNode, label: string, extra: ReactNode, on: boolean) =>
    <button type="button" className="bx-it" aria-current={on ? "page" : undefined} onClick={() => pick(r)}>{icon}<span>{label}</span>{extra}</button>;
  const inbox = (["unread", "saved", "drafts"] as const).map(k => <span key={k}>{it({ view: k }, I[k], { unread: "읽지 않음", saved: "저장", drafts: "초안" }[k], cnt(counts[k], k === "unread"), route.view === k)}</span>);
  const chans = CH.map(k => <span key={k}>{it({ view: "chat", chan: k }, <span className="bl"><img src="/icons/icon-192.png" alt="" width={20} height={20} /></span>, AREA_NAME[k], counts.unreadBy[k] ? <i className="ud" aria-label="읽지 않음" /> : null, route.view === "chat" && route.chan === k)}</span>);
  const themeBtn = <button type="button" className="themebtn" onClick={() => setTheme(NEXT[theme])} aria-label={`테마: ${THEME_KO[theme]} · 누르면 ${THEME_KO[NEXT[theme]]}`} title={`테마: ${THEME_KO[theme]} · 누르면 ${THEME_KO[NEXT[theme]]}`}>{THEME_ICON[theme]}</button>;
  const outBtn = <button type="button" className="themebtn" onClick={onSignOut} aria-label="나가기" title="나가기">{I.out}</button>;
  const attn = counts.attn ? <span className="hpill acc" id="h-attn" role="status" aria-label={`내 차례 ${counts.attn}`}>{FLAG}내 차례 <b>{counts.attn}</b></span> : null;
  const call = <span className="huddle" id="h-call" aria-disabled="true" title="통화는 뒤 단계에서">{PHONE}<span className="hcl">Primary 와 통화</span></span>;
  const seg = act === "node" ? (
    <div className="bx-seg" role="group" aria-label="노드 보기">
      {(["tree", "timeline"] as const).map(v => <button key={v} type="button" aria-pressed={nodeView === v} onClick={() => go({ view: v })}>{v === "tree" ? "트리" : "타임라인"}</button>)}
    </div>) : null;
  return (
    <>
      {wide && (
        <nav className="bx-rail" aria-label="메뉴">
          <img className="lg" src="/icons/icon-192.png" alt="Boarder" width={32} height={32} />
          {([["chat", "채팅", { view: "chat", chan: route.chan || "primary" }], ["node", "노드", { view: nodeView }], ["canvas", "캔버스", { view: "canvas" }]] as const).map(([k, n, r]) => (
            <button key={k} type="button" className="bx-r" aria-label={n} title={n} aria-current={act === k ? "page" : undefined} onClick={() => go(r as Route)}>{I[k]}{k === "chat" && counts.unread && act !== "chat" ? <i className="dot" aria-hidden="true" /> : null}</button>
          ))}
          <div className="sp" />
          {themeBtn}{outBtn}
        </nav>
      )}
      {wide && act === "chat" && <nav className="bx-side" aria-label="채팅"><h3>채팅</h3>{inbox}<div className="bx-sec">채널</div>{chans}</nav>}
      <div className="wrap">
        <header>
          <div className="hr">
            {!wide && <button type="button" className="bx-menu bx-glass" aria-label="메뉴" onClick={() => setDr(true)}>{I.menu}</button>}
            {seg}
            {wide ? <>{attn}<div className="hrt">{call}</div></> : <div className="bx-cap bx-glass">{attn}{call}</div>}
          </div>
        </header>
        <main className="view">{children}</main>
      </div>
      {!wide && dr && <>
        <div className="bx-scrim" onClick={() => setDr(false)} />
        <nav className="bx-dr" aria-label="메뉴" role="dialog" aria-modal="true">
          <div className="top"><img className="lg" src="/icons/icon-192.png" alt="Boarder" width={32} height={32} /><div className="bx-tools">{themeBtn}{outBtn}</div></div>
          {it({ view: "canvas" }, I.canvas, "캔버스", null, act === "canvas")}
          {it({ view: nodeView }, I.node, "노드", null, act === "node")}
          <div className="bx-sec">채팅</div>{inbox}<div className="bx-sec">채널</div>{chans}
        </nav>
      </>}
    </>
  );
}
