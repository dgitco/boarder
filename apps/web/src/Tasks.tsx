import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_VIEW, checkView, readView, doneOf, GROUPS, GROUP_KO, SORTS, SORT_KO, STATUSES, STATUS_KO, isMine, kidsOf, nextDraft, roots, sorted, visibleIds, type NavLink, type Status, type TaskRow, type View } from "../worker/tasks/rules";

// 기본 메뉴(모두 같음) — 내 메뉴(view.nav)를 고친 사람만 제 목록, 빈 목록이면 이것
const NAV: NavLink[] = ([["/", "노드"], ["/#arts", "캔버스"], ["/tasks", "업무"], ["/#inbox", "결정 · 할 일"]] as const).map(([href, name]) => ({ href, name }));
const navOf = (v: View) => v.nav.length ? v.nav : NAV;
const navText = (nav: NavLink[]) => nav.map(n => `${n.name} | ${n.href}`).join("\n");

const DOT: Record<Status, string> = { working: "bg-[var(--dgit-green)]", blocked: "bg-[var(--danger)] rotate-45 rounded-[2px]", waiting: "border-2 border-[var(--dgit-amber)] bg-transparent", done: "bg-[var(--muted)]", cancelled: "bg-[var(--line)]" };
const BOX: Record<Status, string> = { working: "bg-[var(--dgit-green-bg)]", blocked: "bg-[var(--dgit-red-bg)]", waiting: "bg-[var(--dgit-amber-bg)]", done: "bg-[var(--hover)]", cancelled: "bg-[var(--hover)]" };
const Dot = ({ s }: { s: Status }) => <span title={STATUS_KO[s]} aria-label={STATUS_KO[s]} className={`inline-block size-[9px] shrink-0 rounded-full ${DOT[s]}`} />;
const when = (ms: number) => { const d = new Date(ms + 9 * 3600e3).toISOString(); return `${+d.slice(5, 7)}/${+d.slice(8, 10)} ${d.slice(11, 16)}`; };
// 업무 설명: 제목 줄과 **굵게** 만 — 글은 React 글자로만 넣음(HTML 로 안 그림)
function Body({ text }: { text: string }) {
  return <div className="min-w-0 [overflow-wrap:anywhere] text-[14px] leading-relaxed">{text.split("\n").map((l, i) => { const h = /^#{1,4}\s+(.*)$/.exec(l); return h ? <h4 key={i} className="mb-1 mt-3 text-[14px] font-semibold">{h[1].replace(/\*\*/g, "")}</h4> : <p key={i} className="m-0 min-h-[0.6em] whitespace-pre-wrap">{l.split(/\*\*/).map((x, j) => j % 2 ? <b key={j} className="font-semibold">{x}</b> : x)}</p>; })}</div>;
}
const Mine = ({ n }: { n?: number }) => <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 text-[11px] font-medium text-[var(--accent)]">확인{n ? ` ${n}` : ""}</span>;

function useWide() {
  const q = "(min-width: 861px)", [w, setW] = useState(() => matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q), f = () => setW(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return w;
}

export function Tasks() {
  const wide = useWide();
  const [tasks, setTasks] = useState<TaskRow[] | null>(null), [view, setView] = useState<View>(DEFAULT_VIEW), [err, setErr] = useState("");
  const [sel, setSel] = useState<string | null>(() => /^#(tk_[\w.-]+)$/.exec(location.hash)?.[1] || null), [q, setQ] = useState(""), [onlyMine, setOnlyMine] = useState(false), [shut, setShut] = useState<Record<string, boolean>>({}), [setting, setSetting] = useState(false), [saveErr, setSaveErr] = useState("");
  // 저장과 읽기가 엇갈리지 않게: 읽기 시작 뒤 저장이 있었거나 저장 중이면 읽어 온 보기는 버림. 다음 저장은 늘 지금 보기(viewRef) 위에
  const viewRef = useRef(view), seq = useRef(0), saving = useRef(0);
  const put = (v: View) => { viewRef.current = v; setView(v); };
  const load = useCallback(async () => {
    const at = seq.current, r = await fetch("/api/me/tasks", { credentials: "include" }).catch(() => null), j = r ? await r.json().catch(() => null) as { ok?: boolean; tasks?: TaskRow[]; view?: View; error?: string } | null : null;
    if (!r?.ok || !j?.tasks) { setErr(j?.error || "불러오지 못했어요"); return; }
    setErr(""); setTasks(j.tasks); if (j.view && at === seq.current && !saving.current) put(readView(j.view));
  }, []);
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60000); return () => clearInterval(t); }, [load]);
  const save = async (change: View | ((v: View) => View)) => {
    const prev = viewRef.current, next = typeof change === "function" ? change(prev) : change;
    seq.current++; saving.current++; put(next); setSaveErr("");
    const r = await fetch("/api/me/tasks/view", { method: "PUT", credentials: "include", headers: { "content-type": "application/json", "x-hb": "1" }, body: JSON.stringify(next) }).catch(() => null);
    saving.current--;
    if (!r?.ok) { if (viewRef.current === next) put(prev); setSaveErr("설정을 저장하지 못했어요"); }
  };
  const fieldNames = useMemo(() => [...new Set([...DEFAULT_VIEW.mainFields, ...DEFAULT_VIEW.sideFields, ...(tasks || []).flatMap(t => Object.keys(t.fields))])], [tasks]);
  const shown = useMemo(() => {
    const w = q.trim().toLowerCase();
    return (tasks || []).filter(t => (onlyMine ? isMine(t, view) : view.states.includes(t.status)) && (!w || `${t.name} ${t.issue} ${t.line} ${Object.values(t.fields).join(" ")}`.toLowerCase().includes(w)));
  }, [tasks, view, q, onlyMine]);
  const pick = (id: string | null) => { setSel(id); try { history.replaceState(null, "", id ? "#" + id : location.pathname); } catch {} };
  const cur = (tasks || []).find(t => t.id === sel) || null;
  // 넓은 화면은 처음에 내 차례 · 막힘 첫 업무를 열어 둠
  useEffect(() => { if (wide && tasks && !sel) { const f = sorted(shown.filter(t => !kidsOfAny(tasks, t)), view.sort).find(t => isMine(t, view)) || sorted(shown, view.sort)[0]; if (f) pick(f.id); } }, [wide, tasks, sel, shown]);   // eslint-disable-line
  if (err && !tasks) return <main className="grid min-h-dvh place-items-center p-4 text-[var(--danger)]">{err}</main>;
  if (!tasks) return <main className="grid min-h-dvh place-items-center"><span className="g g-spin" aria-label="불러오는 중" /></main>;
  if (!tasks.length) return <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-3 px-4 text-[var(--ink)]"><h1 className="text-[22px] font-semibold">아직 업무 노드가 없어요</h1><p className="text-[var(--soft)]">업무가 올라오면 여기에 부서별로 보여요.</p><a className="text-[var(--accent)]" href="/">보드로 돌아가기</a></main>;

  const list = <Side {...{ tasks, shown, view, saveErr, q, setQ, onlyMine, setOnlyMine, shut, setShut, sel, pick, openSetting: () => setSetting(true), save }} />;
  return (
    <div className="h-dvh overflow-hidden bg-[var(--bg)] text-[14px] text-[var(--ink)]">
      {wide ? <div className="grid h-full grid-cols-[372px_minmax(0,1fr)_330px] gap-2.5 p-2.5 pl-0">{list}{cur ? <><Main key={cur.id} t={cur} view={view} all={tasks} pick={pick} /><Right t={cur} view={view} /></> : <div className="col-span-2 grid place-items-center rounded-2xl bg-[var(--surface)] text-[var(--muted)]">왼쪽에서 업무를 골라 주세요</div>}</div>
        : cur ? <div className="h-full overflow-y-auto"><button className="sticky top-0 z-10 flex h-11 w-full items-center gap-1 border-b border-[var(--line)] bg-[var(--surface)] px-3 text-[var(--soft)]" onClick={() => pick(null)}>‹ 업무 목록</button><Main key={cur.id} t={cur} view={view} all={tasks} pick={pick} /><div className="border-t border-[var(--line)]"><Right t={cur} view={view} /></div></div> : list}
      {setting ? <Setting view={view} fields={fieldNames} save={save} close={() => setSetting(false)} err={saveErr} /> : null}
    </div>
  );
}
const kidsOfAny = (all: TaskRow[], t: TaskRow) => all.some(x => x.parent === t.id);

function Side({ tasks, shown, view, saveErr, q, setQ, onlyMine, setOnlyMine, shut, setShut, sel, pick, openSetting, save }: { tasks: TaskRow[]; shown: TaskRow[]; view: View; saveErr: string; q: string; setQ: (s: string) => void; onlyMine: boolean; setOnlyMine: (b: boolean) => void; shut: Record<string, boolean>; setShut: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void; sel: string | null; pick: (id: string) => void; openSetting: () => void; save: (v: View | ((x: View) => View)) => void }) {
  const count = (s: Status) => tasks.filter(t => t.status === s).length, mineN = tasks.filter(t => isMine(t, view)).length;
  const toggle = (s: Status) => { setOnlyMine(false); save(v => ({ ...v, states: v.states.includes(s) ? v.states.filter(x => x !== s) : [...v.states, s] })); };
  const row = (t: TaskRow, lv: number, kids: TaskRow[]) => (
    <div key={t.id}>
      <div role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") pick(t.id); }} onClick={() => pick(t.id)} style={{ paddingLeft: 6 + (view.group === "tree" ? lv + 2 : lv) * 16 }} className={`flex min-h-[30px] cursor-pointer items-center gap-1.5 rounded-lg py-1 pr-1.5 ${t.id === sel ? "bg-[var(--hover)] font-medium" : "hover:bg-[var(--hover)]"}`}>
        {kids.length ? <button aria-label={shut[t.id] ? "펼치기" : "접기"} className="w-4 shrink-0 text-[var(--muted)]" onClick={e => { e.stopPropagation(); setShut(s => ({ ...s, [t.id]: !s[t.id] })); }}>{shut[t.id] ? "▸" : "▾"}</button> : <span className="w-4 shrink-0" />}
        <Dot s={t.status} />
        <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px]">{t.name}</span>{view.showLine && t.line && !kids.length ? <span className="block truncate text-[12px] text-[var(--muted)]">{t.line}</span> : null}{view.rowFields.map(f => t.fields[f] ? <span key={f} className="block truncate text-[12px] text-[var(--muted)]">{f} · {t.fields[f]}</span> : null)}</span>
        {isMine(t, view) ? <Mine /> : null}
      </div>
      {kids.length && !shut[t.id] ? tree(kids, lv + 1) : null}
    </div>
  );
  const visible = useMemo(() => visibleIds(tasks, shown.map(t => t.id)), [tasks, shown]), vis = (t: TaskRow) => visible.has(t.id);   // 밑에 보일 업무가 있으면 상위도 보임
  const rootIds = useMemo(() => new Set(roots(tasks).map(t => t.id)), [tasks]);
  const tree = (ts: TaskRow[], lv: number): React.ReactNode => sorted(ts.filter(vis), view.sort).map(t => row(t, lv, kidsOf(tasks, t.id, rootIds).filter(vis)));
  const body = view.group === "tree" ? tree(roots(tasks), 0)
    : view.group === "status" ? STATUSES.filter(s => shown.some(t => t.status === s)).map(s => <div key={s}><div className="px-1.5 pb-1 pt-3 text-[12px] font-semibold text-[var(--muted)]">{STATUS_KO[s]} {shown.filter(t => t.status === s).length}</div>{sorted(shown.filter(t => t.status === s), view.sort).map(t => row(t, 0, []))}</div>)
    : sorted(shown, view.sort).map(t => row(t, 0, []));
  return (
    <aside className="flex min-h-0 flex-col bg-[var(--bg)] px-3 pt-3 md:rounded-r-2xl md:bg-[var(--hover)]">
      <nav className="mb-2 flex flex-col text-[14px]">{navOf(view).map(({ href, name }, i) => <a key={i} href={href} className={`rounded-lg px-2 py-1.5 ${href === "/tasks" ? "bg-[var(--line)] font-semibold" : "hover:bg-[var(--line)]"}`}>{name}{href === "/tasks" ? <span className="float-right text-[12.5px] font-normal text-[var(--accent)]">{tasks.filter(t => !t.closed).length}</span> : null}</a>)}</nav>
      <div className="flex items-center gap-2 px-1.5 pb-2"><h1 className="m-0 flex-1 text-[13px] font-semibold">업무</h1><button className="text-[12px] text-[var(--muted)] hover:underline" onClick={openSetting}>보기 설정</button></div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="업무 찾기" className="mb-2 h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-[13.5px]" />
      <div className="flex flex-wrap gap-1 pb-2">
        <button aria-pressed={onlyMine} onClick={() => setOnlyMine(!onlyMine)} className={`rounded-full border px-2.5 py-0.5 text-[12px] ${onlyMine ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--soft)]"}`}>내 차례 {mineN}</button>
        {STATUSES.map(s => <button key={s} aria-pressed={!onlyMine && view.states.includes(s)} onClick={() => toggle(s)} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] ${!onlyMine && view.states.includes(s) ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--soft)]"}`}>{STATUS_KO[s]} {count(s)}</button>)}
      </div>
      {saveErr ? <p className="m-0 px-1.5 pb-1 text-[12.5px] text-[var(--danger)]">{saveErr}</p> : null}
      <nav className="min-h-0 flex-1 overflow-y-auto pb-3">{view.group === "tree" ? <><div className="flex h-[30px] items-center gap-2 px-1.5 font-semibold"><span className="grid size-5 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] text-[var(--accent)]">나</span>내 업무<span className="ml-auto text-[12px] font-normal text-[var(--muted)]">{tasks.filter(t => !t.closed).length}</span></div><div className="flex h-[30px] items-center gap-2 pl-5 pr-1.5 font-semibold"><span className="grid size-5 place-items-center rounded-full bg-[var(--hover)] text-[11px]">비</span>비서실장{mineN ? <span className="ml-auto"><Mine n={mineN} /></span> : null}</div></> : null}{body}</nav>
    </aside>
  );
}

function Fields({ names, t }: { names: string[]; t: TaskRow }) {
  const rows = names.filter(n => t.fields[n]);
  return rows.length ? <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">{rows.map(n => [<dt key={n + "k"} className="text-[var(--muted)]">{n}</dt>, <dd key={n} className="m-0 min-w-0 break-words">{t.fields[n]}</dd>])}</dl> : null;
}
type Msg = { ts: string; who: string; name: string; text: string; at: number; root: boolean; past?: boolean; dlv?: { ok?: boolean; waiting?: boolean }; buttons?: boolean };
type Raw = { ts: string; who: string; name: string; text: string; replies?: number; latest?: string; ch?: string; dlv?: Msg["dlv"]; buttons?: unknown[] };
const tsAt = (ts: string) => Number(ts.split(".")[0]) * 1000;
const NOISE = /^\[(?:보드)[^\]]*\]\s*/;
// 업무 노드 대화: 보드와 같은 길(/api/nodechat · /api/chat/<채널>/<스레드>). 세션 답은 대개 그 글 스레드에 있어 같이 읽어 시각 순으로 펼침
function useChat(t: TaskRow) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null), [err, setErr] = useState("");
  const seq = useRef(0), cache = useRef(new Map<string, { k: string; rows: Raw[] }>());   // 스레드 답: 답 수가 바뀐 글만 다시 읽음. 실패하면 있던 답을 그대로 둠
  const load = useCallback(async () => {
    const me = ++seq.current;
    const r = await fetch(`/api/nodechat?w=${encodeURIComponent(t.name)}&id=${encodeURIComponent(t.id)}`, { credentials: "include" }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) as { messages?: Raw[] } | null : null;
    if (me !== seq.current) return;   // 늦게 끝난 옛 응답은 버림
    if (!j?.messages) { setErr("대화를 불러오지 못했어요"); return; }
    const chan = encodeURIComponent("n:" + t.name), tops = j.messages, folded = (m: Raw) => /들여온 것이에요\. 눌러서 펼쳐/.test(m.text);   // 들여온 대화의 접은 글(ch=primary): 글 자체는 빼고 안의 대화를 바로 보여 줌
    for (const m of tops) if (!m.replies) cache.current.delete(m.ts);   // 답이 다 지워졌으면 화면에서도
    const key = (m: Raw) => `${m.replies}:${m.latest || ""}`;   // 답 수가 같아도 마지막 답이 바뀌면 다시 읽음
    for (const m of tops.filter(x => x.replies && cache.current.get(x.ts)?.k !== key(x)).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8)) {   // 최신 글부터 한 번에 8개, 나머지는 다음 바퀴
      const rr = await fetch(`/api/chat/${m.ch === "primary" ? "primary" : chan}/${m.ts}?id=${encodeURIComponent(t.id)}`, { credentials: "include" }).catch(() => null), jj = rr?.ok ? await rr.json().catch(() => null) as { messages?: Raw[] } | null : null;
      if (jj?.messages) cache.current.set(m.ts, { k: key(m), rows: jj.messages });
    }
    if (me !== seq.current) return;
    const out: Msg[] = [];
    for (const m of tops) {
      if (!folded(m)) out.push({ ts: m.ts, who: m.who, name: m.name, text: m.text, at: tsAt(m.ts), root: true, dlv: m.dlv, buttons: !!m.buttons?.length });
      for (const x of cache.current.get(m.ts)?.rows || []) if (x.ts !== m.ts) out.push({ ts: x.ts, who: x.who, name: x.name, text: x.text, at: tsAt(x.ts), root: false, past: folded(m), dlv: x.dlv });
    }
    setErr(""); setMsgs(out.sort((a, b) => a.at - b.at || a.ts.localeCompare(b.ts)));
  }, [t.id, t.name]);
  useEffect(() => { if (t.chat_off) { setMsgs([]); return; } load(); const i = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000); return () => { clearInterval(i); seq.current++; }; }, [load, t.chat_off]);
  return { msgs, err, load };
}
const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 mt-0 flex items-center gap-2 text-[13px] font-semibold text-[var(--muted)]">{children}<span className="h-px flex-1 bg-[var(--line)]" /></h3>;
function Composer({ t, onSent }: { t: TaskRow; onSent: () => void }) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), rid = useRef(""), box = useRef<HTMLTextAreaElement>(null);   // 같은 글 다시 보내기는 같은 rid(서버가 한 번만 넣음)
  const send = async () => {
    const v = text.trim(); if (!v || busy) return;
    setBusy(true); setErr("");
    const r = await fetch("/api/chat", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-hb": "1" }, body: JSON.stringify({ rid: (rid.current ||= `tk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`), channel: "n:" + t.name, pane: t.pane, text: v }) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) as { ok?: boolean; error?: string } | null : null;
    setBusy(false); setTimeout(() => box.current?.focus(), 0);
    if (r && !r.ok && (r.status >= 500 || r.status === 409) && !r.headers.get("x-retry-safe")) {
      const id = rid.current, a = await fetch("/api/answer/" + encodeURIComponent(id), { credentials: "include", headers: { "x-hb": "1" } }).catch(() => null);
      const aj = a ? await a.json().catch(() => null) as { state?: string; posted?: unknown } | null : null;
      if (a?.ok && (aj?.posted || aj?.state === "ok" || aj?.state === "queued")) { rid.current = ""; setText(""); onSent(); return; }
      if (a && (a.status === 404 || aj?.state === "fail")) rid.current = "";
      setErr("보내지 못했어요. 글은 그대로 있어요 — 다시 눌러 주세요"); return;
    }
    if (r && !r.headers.get("x-retry-safe")) rid.current = "";   // 서버가 답한 실패는 같은 rid 면 그 답을 되풀이함(queue idem) — 다시 누르면 새 글로. 안 닿았을 때(네트워크 · x-retry-safe)만 같은 rid
    if (!r?.ok || j?.ok === false) { setErr(j?.error ? `보내지 못했어요 · ${j.error}` : "보내지 못했어요. 글은 그대로 있어요 — 다시 눌러 주세요"); return; }   // 글을 지우지 않음
    setText(""); onSent();
  };
  return (
    <div className="sticky bottom-0 border-t border-[var(--line)] bg-[var(--surface)] px-4 py-3 md:px-10">
      <div className="mx-auto max-w-[960px] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <textarea ref={box} disabled={busy} value={text} onChange={e => { setText(e.target.value); rid.current = ""; }} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && matchMedia("(min-width: 861px)").matches) { e.preventDefault(); send(); } }} rows={2} placeholder="이 업무에 말 남기기 — 세션이 붙어 답해요" className="block w-full resize-none border-0 bg-transparent text-[14px] outline-none" />
        <div className="flex items-center gap-2 pt-1"><span className={`flex-1 text-[12px] ${err ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>{err || "세션이 없으면 빈 기기에 새로 띄워요"}</span><button aria-label="보내기" disabled={busy || !text.trim()} onClick={send} className="grid size-8 place-items-center rounded-full bg-[var(--ink)] text-[var(--bg)] disabled:opacity-40">↑</button></div>
      </div>
    </div>
  );
}
function Main({ t, view, all, pick }: { t: TaskRow; view: View; all: TaskRow[]; pick: (id: string) => void }) {
  const paneOf = t.pane, up = all.find(x => x.id === t.parent), kids = all.filter(x => x.parent === t.id), { msgs, err, load } = useChat(t);
  const url = /^[\w.-]+\/[\w.-]+#\d+$/.test(t.issue) ? `https://github.com/${t.issue.replace("#", "/issues/")}` : null;
  const done = doneOf(t.body), chat = (msgs || []).filter(m => !m.past), past = (msgs || []).filter(m => m.past), mine = chat.filter(m => m.who === "owner").slice().reverse(), log = chat.filter(m => m.who !== "owner").slice().reverse(), rec = (t.fields["작업 내역"] || "").split("\n").filter(Boolean), waitQ = t.confirm ? t.fields["막힌 것"] || t.line : "";
  return (
    <main className="flex min-h-0 flex-col bg-[var(--surface)] md:rounded-2xl">
      <div className="flex min-h-[52px] items-center gap-x-2 border-b border-[var(--line)] px-4 py-2 text-[13px] text-[var(--muted)]">
        {up ? <><button className="max-w-[30%] truncate hover:underline" onClick={() => pick(up.id)}>{up.name}</button><span>›</span></> : null}<b className="min-w-0 flex-1 truncate font-semibold text-[var(--ink)]">{t.name}</b>
        {url ? <a className="shrink-0 rounded-lg border border-[var(--line)] px-2.5 py-1 text-[var(--ink)]" href={url} target="_blank" rel="noopener noreferrer">이슈 {t.issue.split("#")[1]}</a> : null}
        <a className="shrink-0 rounded-lg border border-[var(--line)] px-2.5 py-1 text-[var(--ink)]" href={`/#node/${encodeURIComponent(t.pane)}`}>보드에서 열기</a>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[1060px] px-4 py-5 md:px-10">
        <h2 className="m-0 text-[22px] font-semibold leading-snug">{t.name}</h2>
        <p className="mb-3 mt-1 flex flex-wrap items-center gap-x-3 text-[12.5px] text-[var(--muted)]">{view.mainFields.filter(n => t.fields[n] && n !== "마지막 진전").map(n => <span key={n}>{t.fields[n]}</span>)}<span>마지막 진전 {(/\d{4}-(\d\d)-(\d\d) (\d\d:\d\d)/.exec(t.fields["마지막 진전"] || "") || []).slice(1).join(" ").replace(/^(\d\d) (\d\d) /, "$1/$2 ") || when(t.updated_at)}</span>{t.confirm ? <Mine /> : null}{t.closed ? <span>끝남</span> : null}</p>
        <div className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 ${BOX[t.status]}`}><span className="mt-1.5"><Dot s={t.status} /></span><div><b className="font-semibold">{STATUS_KO[t.status]}</b>{t.line ? <> · {t.line}</> : null}</div></div>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section><H3>업무 설명</H3>{view.showBody && t.body ? <div className="max-h-[260px] overflow-y-auto"><Body text={t.body} /></div> : <p className="m-0 text-[var(--muted)]">적힌 설명이 없어요</p>}
            {kids.length ? <div className="mt-2 text-[13px] text-[var(--muted)]">하위 업무 {kids.length} — {kids.map(k => <button key={k.id} className="mr-2 inline-flex items-center gap-1 text-[var(--accent)] hover:underline" onClick={() => pick(k.id)}><Dot s={k.status} /><span className="max-w-[220px] truncate">{k.name}</span></button>)}</div> : null}</section>
          <section><H3>완료 기준</H3>{done.length ? <ul className="m-0 list-none space-y-1.5 p-0">{done.map((d, i) => <li key={i} className="flex gap-2 text-[13.5px]"><span className="mt-1 size-3.5 shrink-0 rounded border border-[var(--muted)]" /><span className="min-w-0 [overflow-wrap:anywhere]">{d}</span></li>)}</ul> : <p className="m-0 text-[13.5px] text-[var(--muted)]">이슈에 적힌 완료 기준이 없어요</p>}</section>
          <section><H3>나의 지시 {mine.length + (waitQ ? 1 : 0)}</H3>{mine.length || waitQ ? <div className="overflow-hidden rounded-xl border border-[var(--line)]">{waitQ ? <div className="flex gap-3 border-b border-[var(--line)] px-3 py-2 text-[13.5px] last:border-0"><span className="shrink-0 text-[12px] text-[var(--muted)]">대기 중</span><span className="min-w-0 flex-1 break-words">{waitQ}</span><span className="shrink-0 text-[12px] text-[var(--danger)]">답 기다림</span></div> : null}{mine.slice(0, 8).map(m => <div key={m.ts} className="flex gap-3 border-b border-[var(--line)] px-3 py-2 text-[13.5px] last:border-0"><span className="shrink-0 font-mono text-[12px] text-[var(--muted)]">{when(m.at)}</span><span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{m.text.replace(NOISE, "")}</span></div>)}</div> : <p className="m-0 text-[13.5px] text-[var(--muted)]">{t.chat_off ? "끝난 지 하루가 지나 지시 글은 보드의 보관함에서 봐요" : "이 업무에 남긴 지시가 아직 없어요"}</p>}</section>
          <section><H3>세션 업무 내역</H3>{log.length || rec.length ? <ol className="m-0 list-none space-y-2.5 border-l border-[var(--line)] p-0 pl-3">{log.slice(0, 6).map(m => <li key={m.ts} className="text-[13.5px]"><div className="text-[12px] text-[var(--muted)]">{when(m.at)} · {m.name}</div><div className="whitespace-pre-wrap break-words">{m.text.length > 240 ? m.text.slice(0, 240) + " …" : m.text}</div></li>)}{rec.map((x, i) => <li key={i} className="text-[13.5px]"><div className="break-words">{x}</div></li>)}</ol> : <p className="m-0 text-[13.5px] text-[var(--muted)]">{t.fields["마지막 진전"] || (t.chat_off ? "끝난 지 하루가 지나 세션 글은 보드의 보관함에서 봐요" : "기록이 아직 없어요")}</p>}</section>
        </div>
        <section className="mt-7"><H3>대화</H3>{t.chat_off ? <p className="text-[13px] text-[var(--muted)]">끝난 지 하루가 지나 여기서는 대화를 불러오지 않아요</p> : err ? <p className="text-[13px] text-[var(--danger)]">{err}</p> : msgs === null ? <span className="g g-spin" aria-label="불러오는 중" /> : chat.length || past.length ? <div className="space-y-3">{chat.map(m => <div key={m.ts} className={`flex gap-2.5 ${m.root ? "" : "pl-6"}`}><span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg text-[12px] ${m.who === "owner" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--hover)] text-[var(--soft)]"}`}>{(m.name || "?").slice(0, 1)}</span><div className="min-w-0 flex-1"><div className="flex gap-2 text-[12px] text-[var(--muted)]"><b className="font-semibold text-[var(--ink)]">{m.name}</b><span>{when(m.at)}</span></div><div className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[14px]">{m.who === "owner" ? m.text.replace(NOISE, "") : m.text}</div>{m.dlv?.ok === false ? <div className={`text-[12px] ${m.dlv.waiting ? "text-[var(--muted)]" : "text-[var(--danger)]"}`}>{m.dlv.waiting ? "세션이 쉬기를 기다리는 중" : "아직 세션에 닿지 않았어요 — 받을 기기가 꺼져 있을 수 있어요. 비서실장에게 말해 주세요"}</div> : null}{m.buttons ? <a className="text-[12px] text-[var(--accent)]" href={`/#node/${encodeURIComponent(paneOf)}`}>단추는 보드에서 눌러요</a> : null}</div></div>)}{past.length ? <details className="text-[13px] text-[var(--muted)]"><summary className="cursor-pointer">들여온 지난 대화 {past.length}개</summary><ul className="m-0 mt-1 list-none space-y-1 p-0">{past.map(m => <li key={m.ts} className="[overflow-wrap:anywhere]">{m.name} · {m.text}</li>)}</ul></details> : null}</div> : <p className="m-0 text-[13.5px] text-[var(--muted)]">아직 대화가 없어요. 아래에 쓰면 세션이 붙어 답해요.</p>}</section>
      </div></div>
      {t.chat_off ? <div className="border-t border-[var(--line)] px-4 py-3 text-[13px] text-[var(--muted)] md:px-10">끝난 지 하루가 지난 업무라 여기서는 말을 남길 수 없어요. 대화는 보드의 보관함에서 다시 열어 봐요</div> : <Composer t={t} onSent={load} />}
    </main>
  );
}
function Right({ t, view }: { t: TaskRow; view: View }) {
  const w = t.fields["맡은 창"] || "", dev = /\b(mini|mbp\d)\b/.exec(w)?.[1], acct = /계정 ([a-z])\b/.exec(w)?.[1], NAME: Record<string, string> = {}, on = !!(t.main || dev);
  return (
    <aside className="min-h-0 overflow-y-auto bg-[var(--surface)] p-4 md:rounded-2xl">
      <h3 className="mb-2 mt-0 text-[13px] font-semibold text-[var(--muted)]">맡은 세션</h3>
      <div className="mb-5 rounded-xl border border-[var(--line)] p-3 text-[13.5px]">
        <div className="mb-2 flex items-center gap-2"><b className="flex-1 font-semibold">{on ? "업무 세션" : "맡은 세션 없음"}</b><span className={`rounded-full px-2 py-0.5 text-[12px] ${on ? "bg-[var(--dgit-green-bg)] text-[var(--dgit-green)]" : "bg-[var(--hover)] text-[var(--muted)]"}`}>{t.main ? "붙어 있음" : on ? "장부에 적힘" : "없음"}</span></div>
        {on ? <dl className="m-0 grid grid-cols-[52px_1fr] gap-1"><dt className="text-[var(--muted)]">기기</dt><dd className="m-0">{dev ? NAME[dev] || dev : "—"}</dd><dt className="text-[var(--muted)]">계정</dt><dd className="m-0">{acct || "—"}</dd><dt className="text-[var(--muted)]">세션</dt><dd className="m-0 break-all font-mono text-[12px]">{t.main || w.split(" ")[0]}</dd></dl> : <p className="m-0 text-[var(--muted)]">{w || "말을 남기면 세션이 붙어요"}</p>}
      </div>
      <Fields names={view.sideFields.filter(n => n !== "맡은 창")} t={t} />
    </aside>
  );
}

function NavSetting({ view, save }: { view: View; save: (v: View | ((x: View) => View)) => void }) {
  const saved = navText(navOf(view)), last = useRef(saved);
  const [draft, setDraft] = useState(saved), [err, setErr] = useState("");
  useEffect(() => { setDraft(d => nextDraft(d, last.current, saved)); last.current = saved; }, [saved]);
  const apply = () => {
    const nav = draft.split("\n").filter(l => l.trim()).map(l => { const at = l.indexOf("|"); return { name: at < 0 ? "" : l.slice(0, at).trim(), href: at < 0 ? "" : l.slice(at + 1).trim() }; });
    if (!checkView({ ...view, nav })) { setErr("메뉴는 12개까지예요. 이름과 보드 경로(/) 또는 https:// 주소를 확인해 주세요."); return; }
    setErr(""); save(v => ({ ...v, nav: navText(nav) === navText(NAV) ? [] : nav }));   // 기본과 같으면 빈 목록(기본을 따라감)
  };
  return <fieldset className="m-0 border-0 p-0"><legend className="mb-1 text-[13px] font-semibold">사이드바 메뉴</legend>
    <p className="mb-2 mt-0 text-[12px] text-[var(--muted)]">한 줄에 이름 | 주소를 적어요. 줄을 옮기면 순서가 바뀌고, 지우면 메뉴에서 빠져요.</p>
    <textarea aria-label="사이드바 메뉴" rows={7} value={draft} onChange={e => setDraft(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 text-[12px]" />
    {err ? <p className="text-[12px] text-[var(--danger)]">{err}</p> : null}
    <button className="mt-1 rounded-lg border border-[var(--line)] px-3 py-1 text-[13px]" onClick={apply}>메뉴 저장</button>
  </fieldset>;
}

function Setting({ view, fields, save, close, err }: { view: View; fields: string[]; save: (v: View | ((x: View) => View)) => void; close: () => void; err: string }) {
  const Pick = ({ k, title }: { k: "mineFields" | "rowFields" | "mainFields" | "sideFields"; title: string }) => (
    <fieldset className="m-0 border-0 p-0"><legend className="mb-1 p-0 text-[13px] font-semibold">{title}</legend><div className="flex flex-wrap gap-x-3 gap-y-1">{fields.map(f => <label key={f} className="inline-flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={view[k].includes(f)} onChange={e => save({ ...view, [k]: e.target.checked ? [...view[k], f] : view[k].filter(x => x !== f) })} />{f}</label>)}</div></fieldset>
  );
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-[var(--scrim)] p-3" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-label="보기 설정" className="flex max-h-[90dvh] w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-2xl bg-[var(--surface)] p-5">
        <div className="flex items-center"><h2 className="m-0 flex-1 text-[17px] font-semibold">보기 설정</h2><button className="px-2 text-[var(--soft)]" aria-label="닫기" onClick={close}>✕</button></div>
        <p className="m-0 text-[13px] text-[var(--muted)]">내 보기에만 저장돼요. 다른 사람의 화면 · 업무 내용은 바뀌지 않아요.</p>
        <label className="flex items-center gap-2 text-[13.5px]"><span className="w-20 font-semibold">묶는 기준</span><select className="h-9 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2" value={view.group} onChange={e => save({ ...view, group: e.target.value as View["group"] })}>{GROUPS.map(g => <option key={g} value={g}>{GROUP_KO[g]}</option>)}</select></label>
        <label className="flex items-center gap-2 text-[13.5px]"><span className="w-20 font-semibold">순서</span><select className="h-9 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2" value={view.sort} onChange={e => save({ ...view, sort: e.target.value as View["sort"] })}>{SORTS.map(g => <option key={g} value={g}>{SORT_KO[g]}</option>)}</select></label>
        <label className="flex items-center gap-2 text-[13.5px]"><span className="w-20 font-semibold">내 차례 낱말</span><input key={view.mine.join()} className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2" defaultValue={view.mine.join(", ")} onBlur={e => save({ ...view, mine: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} placeholder="쉼표로 나눠요" /></label>
        <NavSetting view={view} save={save} />
        <Pick k="mineFields" title="내 차례를 볼 칸" />
        <Pick k="rowFields" title="목록 줄에 더 보일 칸" />
        <Pick k="mainFields" title="가운데에 보일 칸" />
        <Pick k="sideFields" title="오른쪽에 보일 칸" />
        <label className="inline-flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={view.showBody} onChange={e => save({ ...view, showBody: e.target.checked })} />업무 설명 보이기</label>
        <label className="inline-flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={view.showLine} onChange={e => save({ ...view, showLine: e.target.checked })} />목록에 상태 한 줄 보이기</label>
        {err ? <p className="m-0 text-[13px] text-[var(--danger)]">{err}</p> : null}
        <div className="flex gap-2"><button className="h-10 flex-1 rounded-xl border border-[var(--line)]" onClick={() => save(DEFAULT_VIEW)}>기본값으로</button><button className="h-10 flex-1 rounded-xl bg-[var(--ink)] font-medium text-[var(--bg)]" onClick={close}>닫기</button></div>
      </div>
    </div>
  );
}
