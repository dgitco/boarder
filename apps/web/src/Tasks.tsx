import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_VIEW, GROUPS, GROUP_KO, SORTS, SORT_KO, STATUSES, STATUS_KO, isMine, kidsOf, roots, sorted, visibleIds, type Status, type TaskRow, type View } from "../worker/tasks/rules";

const DOT: Record<Status, string> = { working: "bg-[var(--dgit-green)]", blocked: "bg-[var(--danger)] rotate-45 rounded-[2px]", waiting: "border-2 border-[var(--dgit-amber)] bg-transparent", done: "bg-[var(--muted)]", cancelled: "bg-[var(--line)]" };
const BOX: Record<Status, string> = { working: "bg-[var(--dgit-green-bg)]", blocked: "bg-[var(--dgit-red-bg)]", waiting: "bg-[var(--dgit-amber-bg)]", done: "bg-[var(--hover)]", cancelled: "bg-[var(--hover)]" };
const Dot = ({ s }: { s: Status }) => <span title={STATUS_KO[s]} aria-label={STATUS_KO[s]} className={`inline-block size-[9px] shrink-0 rounded-full ${DOT[s]}`} />;
const when = (ms: number) => { const d = new Date(ms + 9 * 3600e3).toISOString(); return `${+d.slice(5, 7)}/${+d.slice(8, 10)} ${d.slice(11, 16)}`; };
// 업무 설명: 제목 줄과 **굵게** 만 — 글은 React 글자로만 넣음(HTML 로 안 그림)
function Body({ text }: { text: string }) {
  return <div className="break-words text-[14px] leading-relaxed">{text.split("\n").map((l, i) => { const h = /^#{1,4}\s+(.*)$/.exec(l); return h ? <h4 key={i} className="mb-1 mt-3 text-[14px] font-semibold">{h[1].replace(/\*\*/g, "")}</h4> : <p key={i} className="m-0 min-h-[0.6em] whitespace-pre-wrap">{l.split(/\*\*/).map((x, j) => j % 2 ? <b key={j} className="font-semibold">{x}</b> : x)}</p>; })}</div>;
}
const Mine = () => <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 text-[11px] font-medium text-[var(--accent)]">내 차례</span>;

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
    setErr(""); setTasks(j.tasks); if (j.view && at === seq.current && !saving.current) put(j.view);
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
      {wide ? <div className="grid h-full grid-cols-[372px_minmax(0,1fr)_340px] gap-2.5 p-2.5 pl-0">{list}{cur ? <><Main t={cur} view={view} all={tasks} pick={pick} /><Right t={cur} view={view} /></> : <div className="col-span-2 grid place-items-center rounded-2xl bg-[var(--surface)] text-[var(--muted)]">왼쪽에서 업무를 골라 주세요</div>}</div>
        : cur ? <div className="h-full overflow-y-auto"><button className="sticky top-0 z-10 flex h-11 w-full items-center gap-1 border-b border-[var(--line)] bg-[var(--surface)] px-3 text-[var(--soft)]" onClick={() => pick(null)}>‹ 업무 목록</button><Main t={cur} view={view} all={tasks} pick={pick} /><div className="border-t border-[var(--line)]"><Right t={cur} view={view} /></div></div> : list}
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
      <div role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") pick(t.id); }} onClick={() => pick(t.id)} style={{ paddingLeft: 6 + lv * 16 }} className={`flex min-h-[30px] cursor-pointer items-center gap-1.5 rounded-lg py-1 pr-1.5 ${t.id === sel ? "bg-[var(--hover)] font-medium" : "hover:bg-[var(--hover)]"}`}>
        {kids.length ? <button aria-label={shut[t.id] ? "펼치기" : "접기"} className="w-4 shrink-0 text-[var(--muted)]" onClick={e => { e.stopPropagation(); setShut(s => ({ ...s, [t.id]: !s[t.id] })); }}>{shut[t.id] ? "▸" : "▾"}</button> : <span className="w-4 shrink-0" />}
        <Dot s={t.status} />
        <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px]">{t.name}</span>{view.rowFields.map(f => t.fields[f] ? <span key={f} className="block truncate text-[12px] text-[var(--muted)]">{f} · {t.fields[f]}</span> : null)}</span>
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
      <div className="flex items-center gap-2 px-1.5 pb-2"><a href="/" className="text-[var(--soft)]" aria-label="보드로">‹</a><h1 className="flex-1 text-[15px] font-semibold">업무 <span className="font-normal text-[var(--muted)]">{tasks.length}</span></h1><button className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[12.5px]" onClick={openSetting}>보기 설정</button></div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="업무 찾기" className="mb-2 h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-[13.5px]" />
      <div className="flex flex-wrap gap-1 pb-2">
        <button aria-pressed={onlyMine} onClick={() => setOnlyMine(!onlyMine)} className={`rounded-full border px-2.5 py-0.5 text-[12px] ${onlyMine ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--soft)]"}`}>내 차례 {mineN}</button>
        {STATUSES.map(s => <button key={s} aria-pressed={!onlyMine && view.states.includes(s)} onClick={() => toggle(s)} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] ${!onlyMine && view.states.includes(s) ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--soft)]"}`}>{STATUS_KO[s]} {count(s)}</button>)}
      </div>
      {saveErr ? <p className="m-0 px-1.5 pb-1 text-[12.5px] text-[var(--danger)]">{saveErr}</p> : null}
      <nav className="min-h-0 flex-1 overflow-y-auto pb-3">{body}</nav>
    </aside>
  );
}

function Fields({ names, t }: { names: string[]; t: TaskRow }) {
  const rows = names.filter(n => t.fields[n]);
  return rows.length ? <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">{rows.map(n => [<dt key={n + "k"} className="text-[var(--muted)]">{n}</dt>, <dd key={n} className="m-0 min-w-0 break-words">{t.fields[n]}</dd>])}</dl> : null;
}
function Main({ t, view, all, pick }: { t: TaskRow; view: View; all: TaskRow[]; pick: (id: string) => void }) {
  const up = all.find(x => x.id === t.parent), kids = all.filter(x => x.parent === t.id);
  const url = /^(?:[\w.-]+\/[\w.-]+)?#\d+$/.test(t.issue) && t.issue.includes("/") ? `https://github.com/${t.issue.replace("#", "/issues/")}` : null;
  return (
    <main className="flex min-h-0 flex-col overflow-y-auto bg-[var(--surface)] md:rounded-2xl">
      <div className="flex min-h-[52px] flex-wrap items-center gap-x-2 border-b border-[var(--line)] px-4 py-2 text-[13px] text-[var(--muted)]">
        {up ? <><button className="hover:underline" onClick={() => pick(up.id)}>{up.name}</button><span>›</span></> : null}<b className="min-w-0 flex-1 truncate font-semibold text-[var(--ink)]">{t.name}</b>
        {url ? <a className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-[var(--ink)]" href={url} target="_blank" rel="noopener noreferrer">이슈 {t.issue.split("#")[1]}</a> : t.issue ? <span>{t.issue}</span> : null}
        <a className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-[var(--ink)]" href={`/#node/${encodeURIComponent(t.pane)}`}>보드에서 열기</a>
      </div>
      <div className="mx-auto w-full max-w-[960px] px-4 py-5 md:px-10">
        <h2 className="m-0 text-[22px] font-semibold leading-snug">{t.name}</h2>
        <p className="mb-3 mt-1 text-[12.5px] text-[var(--muted)]">마지막 바뀜 {when(t.updated_at)}{t.closed ? " · 끝남" : ""}</p>
        <div className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 ${BOX[t.status]}`}><span className="mt-1.5"><Dot s={t.status} /></span><div><b className="font-semibold">{STATUS_KO[t.status]}</b>{t.line ? <> · {t.line}</> : null}</div></div>
        {view.mainFields.some(n => t.fields[n]) ? <section className="mt-5"><Fields names={view.mainFields} t={t} /></section> : null}
        {view.showBody && t.body ? <section className="mt-5"><h3 className="mb-1.5 text-[13px] font-semibold text-[var(--muted)]">업무 설명</h3><Body text={t.body} /></section> : null}
        {kids.length ? <section className="mt-5"><h3 className="mb-1.5 text-[13px] font-semibold text-[var(--muted)]">하위 업무 {kids.length}</h3><ul className="m-0 list-none p-0">{kids.map(k => <li key={k.id}><button className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-[var(--hover)]" onClick={() => pick(k.id)}><Dot s={k.status} /><span className="truncate">{k.name}</span></button></li>)}</ul></section> : null}
      </div>
    </main>
  );
}
function Right({ t, view }: { t: TaskRow; view: View }) {
  return (
    <aside className="min-h-0 overflow-y-auto bg-[var(--surface)] p-4 md:rounded-2xl">
      <h3 className="mb-2 mt-0 text-[13px] font-semibold text-[var(--muted)]">세션</h3>
      <p className="mb-4 mt-0 text-[13.5px]">{t.main ? <>붙은 창 <code className="text-[12px]">{t.main}</code></> : <span className="text-[var(--muted)]">보드에서 붙은 창이 없어요</span>}</p>
      <Fields names={view.sideFields} t={t} />
    </aside>
  );
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
        <Pick k="mineFields" title="내 차례를 볼 칸" />
        <Pick k="rowFields" title="목록 줄에 더 보일 칸" />
        <Pick k="mainFields" title="가운데에 보일 칸" />
        <Pick k="sideFields" title="오른쪽에 보일 칸" />
        <label className="inline-flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={view.showBody} onChange={e => save({ ...view, showBody: e.target.checked })} />업무 설명 보이기</label>
        {err ? <p className="m-0 text-[13px] text-[var(--danger)]">{err}</p> : null}
        <div className="flex gap-2"><button className="h-10 flex-1 rounded-xl border border-[var(--line)]" onClick={() => save(DEFAULT_VIEW)}>기본값으로</button><button className="h-10 flex-1 rounded-xl bg-[var(--ink)] font-medium text-[var(--bg)]" onClick={close}>닫기</button></div>
      </div>
    </div>
  );
}
