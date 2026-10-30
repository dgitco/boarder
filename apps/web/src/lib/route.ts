// 주소 = 화면(뒤로 가기 · 링크 공유): /tree · /timeline · /canvas · /chat/<채널> · /unread · /saved · /drafts
import { useEffect, useState } from "react";

export type Route = { view: "tree" | "timeline" | "canvas" | "chat" | "unread" | "saved" | "drafts"; chan?: string };
export const CH = ["primary", "company", "personal", "dgit", "shop"] as const;
export const AREA_NAME: Record<string, string> = { primary: "Primary", company: "회사 리드", personal: "퍼스널 리드", dgit: "DGit 리드", shop: "가게 리드" };

export function parse(path: string): Route {
  const [, a, b] = path.split("/");
  if (a === "chat") return { view: "chat", chan: (CH as readonly string[]).includes(b) ? b : "primary" };
  if (["timeline", "canvas", "unread", "saved", "drafts"].includes(a)) return { view: a as Route["view"] };
  return { view: "tree" };
}
export const href = (r: Route) => r.view === "chat" ? `/chat/${r.chan || "primary"}` : `/${r.view}`;

export function useRoute(): [Route, (r: Route) => void] {
  const [r, setR] = useState(() => parse(location.pathname));
  useEffect(() => { const f = () => setR(parse(location.pathname)); addEventListener("popstate", f); return () => removeEventListener("popstate", f); }, []);
  return [r, (n: Route) => { if (href(n) !== location.pathname) history.pushState(null, "", href(n)); setR(n); }];
}
