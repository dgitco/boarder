import { useEffect, useRef, useState } from "react";

export type BoardData = { generated?: string; cardlist?: { ts: string; state: string }[]; attn?: { ts: string }[]; [k: string]: unknown };

export function attnCount(D: BoardData | null) {
  if (!D || !Array.isArray(D.cardlist)) return 0;
  const open = new Set(D.cardlist.filter(c => c.state === "open").map(c => c.ts));
  return Array.isArray(D.attn) ? D.attn.filter(a => open.has(a.ts)).length : open.size;
}

export function useBoard() {
  const [D, setD] = useState<BoardData | null>(null), tag = useRef("");
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch("/api/board/data", { credentials: "include", headers: tag.current ? { "If-None-Match": tag.current } : {} }).catch(() => null);
      if (!r || stop || r.status === 304 || !r.ok) return;
      tag.current = r.headers.get("etag") || ""; setD(await r.json());
    };
    load(); const t = setInterval(load, 20000), v = () => load();
    document.addEventListener("visibilitychange", v);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, []);
  return D;
}
