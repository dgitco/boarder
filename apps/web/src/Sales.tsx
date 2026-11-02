import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { STAGES, STAGE_KO, SOURCES, SOURCE_KO, suggestDue, addBusinessDays, todayKst, type Stage, type Source } from "../worker/sales/rules";

type Card = { id: string; firm: string; stage: Stage; assignee: string; source: Source; last_at: string | null; last_note: string; next: string; due: string | null; links: string[]; hold_until: string | null; lost_reason: string; ver: number; updated_by: string; updated_at: number };
type Member = { email: string; role: string; name: string };
type Team = { id: string; name: string; role: string };
type Res<T> = ({ ok: true } & T) | { ok: false; error: string; status: number; card?: Card };
const ERR = "일시적인 오류가 발생했어요";
async function api<T>(method: string, path: string, body?: unknown): Promise<Res<T>> {
  const r = await fetch(path, { method, credentials: "include", headers: { "content-type": "application/json", "x-hb": "1" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) as Record<string, unknown> : {};
  return r?.ok && j.ok !== false ? { ok: true, ...j } as Res<T> : { ok: false, error: typeof j.error === "string" ? j.error : ERR, status: r?.status || 0, card: j.card as Card | undefined };
}

const COLS: { key: string; title: string; stages: Stage[] }[] = [
  ...STAGES.filter(s => s !== "hold" && s !== "lost").map((s, i) => ({ key: s, title: `${i + 1} ${STAGE_KO[s]}`, stages: [s] })),
  { key: "rest", title: "보류 · 놓침", stages: ["hold", "lost"] },
];
const ACTIVE = (c: Card) => c.stage !== "hold" && c.stage !== "lost";
type Tone = "late" | "soon" | "ok";
const toneOf = (due: string | null, today: string): Tone | null => !due ? null : due < today ? "late" : due <= addBusinessDays(today, 2) ? "soon" : "ok";
const TONE: Record<Tone, { cls: string; ko: string }> = {
  late: { cls: "bg-[var(--dgit-red-bg)] text-[var(--dgit-red)]", ko: "지남" },
  soon: { cls: "bg-[var(--dgit-amber-bg)] text-[var(--dgit-amber)]", ko: "2영업일 안" },
  ok: { cls: "bg-[var(--dgit-green-bg)] text-[var(--dgit-green)]", ko: "여유" },
};
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const short = (m: Member[], email: string) => { const x = m.find(y => y.email === email); return x?.name || email.split("@")[0]; };

function useWide() {
  const q = "(min-width: 861px)", [w, setW] = useState(() => matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q), f = () => setW(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return w;
}

export function Sales({ email }: { email: string }) {
  const me = email.toLowerCase();
  const [teams, setTeams] = useState<Team[] | null>(null), [err, setErr] = useState(""), [pick, setPick] = useState("");
  useEffect(() => { api<{ teams: Team[] }>("GET", "/api/sales/teams").then(r => r.ok ? setTeams(r.teams) : setErr(r.error)); }, []);
  if (err) return <Shell><p className="text-[var(--danger)]">{err}</p></Shell>;
  if (!teams) return <Shell><span className="g g-spin" aria-label="불러오는 중" /></Shell>;
  if (!teams.length) return <Shell><NewTeam onDone={t => setTeams([t])} /></Shell>;
  const team = teams.find(t => t.id === pick) || teams.find(t => t.role === "admin") || teams[0];
  return <Board key={team.id} team={team} teams={teams} onPick={setPick} me={me} />;
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-4 px-4 text-[var(--ink)]">{children}</main>;
}

function NewTeam({ onDone }: { onDone: (t: Team) => void }) {
  const [name, setName] = useState("영업"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const go = async () => { setBusy(true); const r = await api<{ team: Team }>("POST", "/api/sales/teams", { name }); setBusy(false); r.ok ? onDone(r.team) : setErr(r.error); };
  return (
    <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); go(); }}>
      <h1 className="text-[22px] font-semibold">영업 보드 만들기</h1>
      <p className="text-[var(--soft)]">팀 하나가 보드 하나예요. 만든 사람이 관리자이고, 팀원은 같은 보드를 보고 고쳐요.</p>
      <label className="flex flex-col gap-1 text-[14px]">팀 이름<input className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3" value={name} maxLength={40} onChange={e => setName(e.target.value)} /></label>
      <button className="h-11 rounded-xl bg-[var(--ink)] font-medium text-[var(--bg)] disabled:opacity-50" disabled={busy || !name.trim()}>만들기</button>
      {err ? <p className="text-[var(--danger)]">{err}</p> : null}
    </form>
  );
}

type Filter = "all" | "mine" | "late" | "week" | "stage";
function Board({ team, teams, onPick, me }: { team: Team; teams: Team[]; onPick: (id: string) => void; me: string }) {
  const wide = useWide(), today = todayKst();
  const [cards, setCards] = useState<Card[]>([]), [members, setMembers] = useState<Member[]>([]), [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all"), [open, setOpen] = useState<Card | "new" | null>(null), [preset, setPreset] = useState<Partial<Draft>>({}), [note, setNote] = useState(""), [people, setPeople] = useState(false);
  const load = useCallback(async () => {
    const r = await api<{ cards: Card[]; members: Member[] }>("GET", `/api/sales/teams/${team.id}/cards`);
    if (r.ok) { setCards(r.cards); setMembers(r.members); setLoaded(true); } else setNote(r.error);
  }, [team.id]);
  useEffect(() => {
    load(); const t = setInterval(() => document.visibilityState === "visible" && load(), 30_000), v = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", v); return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [load]);
  const put = (c: Card) => setCards(cs => cs.some(x => x.id === c.id) ? cs.map(x => x.id === c.id ? c : x) : [c, ...cs]);
  const move = async (c: Card, stage: Stage) => {
    if (c.stage === stage) return;
    if (stage === "hold" || stage === "lost" || !c.next) { setPreset({ stage, due: suggestDue(stage, today) || "" }); return setOpen(c); }
    const r = await api<{ card: Card }>("PATCH", `/api/sales/teams/${team.id}/cards/${c.id}`, { ver: c.ver, stage, due: suggestDue(stage, today) });
    if (r.ok) { put(r.card); setNote(""); } else { setNote(r.error); if (r.status === 409) load(); }
  };
  const late = cards.filter(c => ACTIVE(c) && c.due && c.due < today), mine = cards.filter(c => c.assignee === me);
  const shown = filter === "mine" ? mine : filter === "late" ? late : filter === "week" ? cards.filter(c => ACTIVE(c) && c.due && c.due <= addBusinessDays(today, 5)) : cards;
  const chip = (f: Filter, label: string, n?: number) => (
    <button type="button" aria-pressed={filter === f} onClick={() => setFilter(filter === f && f !== "all" ? "all" : f)}
      className={`h-9 rounded-full border px-3 text-[13px] ${filter === f ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]" : "border-[var(--line)] bg-[var(--surface)]"}`}>{label}{n === undefined ? "" : ` ${n}`}</button>
  );
  return (
    <main className="flex min-h-dvh flex-col bg-[var(--bg)] text-[var(--ink)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3">   {/* <header> 는 틀 CSS 가 h1 을 숨김(frame.css) */}
        <a href="/" className="mr-1 text-[13px] text-[var(--muted)] underline-offset-2 hover:underline">보드로</a>
        <h1 className="mr-2 text-[18px] font-semibold">{team.name}</h1>
        {teams.length > 1 ? <select aria-label="팀 고르기" value={team.id} onChange={e => onPick(e.target.value)} className="h-9 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2 text-[13px]">{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select> : null}
        {chip("all", wide ? "전체" : "기한 순", cards.length)}{chip("mine", "내 담당", mine.length)}{chip("late", "기한 지남", late.length)}
        {wide ? null : <>{chip("week", "이번 주")}{chip("stage", "단계별")}</>}
        {wide ? <a href={`/api/sales/teams/${team.id}/export.csv`} download className="ml-auto grid h-9 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-[13px]">CSV 내보내기</a> : null}
        <button type="button" onClick={() => setPeople(true)} className={`${wide ? "" : "ml-auto "}h-9 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-[13px]`}>팀원 {members.length}</button>
        <button type="button" onClick={() => { setPreset({}); setOpen("new"); }} className="h-9 rounded-full bg-[var(--ink)] px-4 text-[13px] font-medium text-[var(--bg)]">+ 새 잠재 고객</button>
      </div>
      {note ? <p role="status" className="px-4 pt-2 text-[13px] text-[var(--danger)]">{note}</p> : null}
      {!loaded ? <div className="grid flex-1 place-items-center"><span className="g g-spin" aria-label="불러오는 중" /></div>
        : wide ? <Columns cards={shown} members={members} today={today} onOpen={c => { setPreset({}); setOpen(c); }} onMove={move} />
        : <List cards={shown} members={members} today={today} byStage={filter === "stage"} onOpen={c => { setPreset({}); setOpen(c); }} />}
      {people ? <People team={team} me={me} members={members} onClose={() => setPeople(false)} onChanged={load} /> : null}
      {open ? <CardSheet team={team.id} me={me} card={open === "new" ? null : open} preset={preset} members={members} today={today} onClose={() => setOpen(null)} onSaved={c => { put(c); setOpen(null); }} onStale={load} /> : null}
    </main>
  );
}

function Face({ c, members, today }: { c: Card; members: Member[]; today: string }) {
  const t = ACTIVE(c) ? toneOf(c.due, today) : null;
  return (
    <>
      <div className="flex items-start gap-2"><b className="font-medium leading-snug">{c.firm}</b>
        {t ? <span className={`ml-auto shrink-0 rounded-md px-1.5 text-[12px] font-medium ${TONE[t].cls}`} title={TONE[t].ko}>{t === "late" ? "지남 " : ""}{md(c.due!)}</span> : null}</div>
      <div className="text-[12px] text-[var(--muted)]">{short(members, c.assignee)} · {SOURCE_KO[c.source]}{ACTIVE(c) ? "" : ` · ${STAGE_KO[c.stage]}`}</div>
      <div className="text-[13px] text-[var(--soft)]">{c.stage === "hold" ? `다시 볼 날 ${c.hold_until ? md(c.hold_until) : ""}` : c.stage === "lost" ? c.lost_reason : c.next}</div>
    </>
  );
}

function Columns({ cards, members, today, onOpen, onMove }: { cards: Card[]; members: Member[]; today: string; onOpen: (c: Card) => void; onMove: (c: Card, s: Stage) => void }) {
  const [over, setOver] = useState("");
  const byId = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);
  return (
    <div className="flex flex-1 gap-3 overflow-x-auto p-4">
      {COLS.map(col => {
        const cs = cards.filter(c => col.stages.includes(c.stage));
        return (
          <section key={col.key} aria-label={col.title} onDragOver={e => { e.preventDefault(); setOver(col.key); }} onDragLeave={() => setOver("")}
            onDrop={e => { e.preventDefault(); setOver(""); const c = byId.get(e.dataTransfer.getData("text/plain")); if (c) onMove(c, col.stages[0]); }}
            className={`flex min-w-[160px] flex-1 basis-0 flex-col gap-2 rounded-2xl p-2 ${over === col.key ? "bg-[var(--hover)]" : "bg-[var(--sunk)]"}`}>
            <h2 className="flex items-center px-1 text-[13px] font-medium text-[var(--soft)]">{col.title}<span className="ml-auto text-[var(--muted)]">{cs.length}</span></h2>
            {cs.map(c => (
              <button key={c.id} type="button" draggable onDragStart={e => e.dataTransfer.setData("text/plain", c.id)} onClick={() => onOpen(c)}
                className="flex flex-col gap-1 rounded-xl bg-[var(--surface)] p-3 text-left shadow-[var(--dgit-shadow-card)]"><Face c={c} members={members} today={today} /></button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function List({ cards, members, today, byStage, onOpen }: { cards: Card[]; members: Member[]; today: string; byStage: boolean; onOpen: (c: Card) => void }) {
  const key = (c: Card) => ACTIVE(c) && c.due ? c.due : "9999";
  const sorted = [...cards].sort((a, b) => key(a).localeCompare(key(b)));
  const groups = byStage ? COLS.map(col => ({ title: col.title, cs: sorted.filter(c => col.stages.includes(c.stage)) })).filter(g => g.cs.length) : [{ title: "", cs: sorted }];
  return (
    <div className="flex flex-col gap-4 p-4">
      {groups.map(g => (
        <section key={g.title || "all"} aria-label={g.title || "기한 순"} className="flex flex-col gap-2">
          {g.title ? <h2 className="text-[13px] font-medium text-[var(--soft)]">{g.title} {g.cs.length}</h2> : null}
          {g.cs.map(c => (
            <button key={c.id} type="button" onClick={() => onOpen(c)} className="flex flex-col gap-1 rounded-xl bg-[var(--surface)] p-3 text-left shadow-[var(--dgit-shadow-card)]">
              <Face c={c} members={members} today={today} />{byStage || !ACTIVE(c) ? null : <div className="text-[12px] text-[var(--muted)]">{STAGE_KO[c.stage]}</div>}
            </button>
          ))}
        </section>
      ))}
      {cards.length ? null : <p className="text-center text-[var(--muted)]">카드가 없어요</p>}
    </div>
  );
}

type Ev = { who: string; kind: string; data: Record<string, [unknown, unknown]>; at: number };
const FIELD_KO: Record<string, string> = { firm: "사무소", stage: "단계", assignee: "담당", source: "들어온 길", last_at: "마지막 연락", last_note: "연락 한 줄", next: "다음 할 일", due: "기한", links: "원문 링크", hold_until: "다시 볼 날짜", lost_reason: "놓친 이유" };
const when = (ms: number) => new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const val = (k: string, v: unknown) => v === null || v === "" ? "없음" : k === "stage" ? STAGE_KO[v as Stage] : k === "source" ? SOURCE_KO[v as Source] : Array.isArray(v) ? `${v.length}개` : String(v).slice(0, 40);
const evText = (e: Ev) => e.kind === "create" ? "만듦" : Object.entries(e.data).map(([k, [a, b]]) => k === "assignee" || k === "next" || k === "last_note" ? `${FIELD_KO[k]} 고침` : `${FIELD_KO[k] || k} ${val(k, a)} → ${val(k, b)}`).join(", ");

function People({ team, me, members, onClose, onChanged }: { team: Team; me: string; members: Member[]; onClose: () => void; onChanged: () => void }) {
  const [email, setEmail] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), admin = team.role === "admin";
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  const run = async (p: Promise<Res<object>>) => { setBusy(true); setErr(""); const r = await p; setBusy(false); if (!r.ok) return setErr(r.error); setEmail(""); onChanged(); };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--scrim)] md:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="팀원" onClick={e => e.stopPropagation()} className="flex w-full max-w-[440px] flex-col gap-3 rounded-t-2xl bg-[var(--bg)] p-5 md:rounded-2xl">
        <h2 className="text-[18px] font-semibold">팀원</h2>
        <p className="text-[13px] text-[var(--soft)]">팀원은 이 보드를 같이 보고 고쳐요. {admin ? "보드에 초대된 사람만 더할 수 있어요." : "팀원을 더하고 빼는 것은 관리자가 해요."}</p>
        <ul className="flex flex-col gap-1">{members.map(m => (
          <li key={m.email} className="flex min-h-11 items-center gap-2 border-b border-[var(--line)] text-[14px]">
            <span>{m.name || m.email.split("@")[0]}</span><span className="text-[12px] text-[var(--muted)]">{m.email}{m.role === "admin" ? " · 관리자" : ""}</span>
            {(admin && m.email !== me) || (!admin && m.email === me) ? <button type="button" disabled={busy} className="ml-auto text-[13px] text-[var(--danger)]" onClick={() => run(api("DELETE", `/api/sales/teams/${team.id}/members/${encodeURIComponent(m.email)}`))}>{m.email === me ? "나가기" : "빼기"}</button> : null}
          </li>))}
        </ul>
        {admin ? <form className="flex gap-2" onSubmit={e => { e.preventDefault(); run(api("POST", `/api/sales/teams/${team.id}/members`, { email })); }}>
          <label className="sr-only" htmlFor="sales-add">더할 사람 메일</label>
          <input id="sales-add" type="email" required placeholder="메일 주소" className="h-11 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3" value={email} onChange={e => setEmail(e.target.value)} />
          <button disabled={busy} className="h-11 rounded-xl bg-[var(--ink)] px-4 font-medium text-[var(--bg)] disabled:opacity-50">더하기</button>
        </form> : null}
        {err ? <p role="alert" className="text-[13px] text-[var(--danger)]">{err}</p> : null}
        <button type="button" onClick={onClose} className="h-11 rounded-xl border border-[var(--line)]">닫기</button>
      </div>
    </div>
  );
}


const L = ({ t, children }: { t: string; children: ReactNode }) => <label className="flex flex-col gap-1 text-[13px] text-[var(--soft)]">{t}{children}</label>;
type Draft = { firm: string; stage: Stage; assignee: string; source: Source; last_at: string; last_note: string; next: string; due: string; links: string; hold_until: string; lost_reason: string };
const draftOf = (c: Card | null, me: string, today: string): Draft => c
  ? { firm: c.firm, stage: c.stage, assignee: c.assignee, source: c.source, last_at: c.last_at || "", last_note: c.last_note, next: c.next, due: c.due || "", links: c.links.join("\n"), hold_until: c.hold_until || "", lost_reason: c.lost_reason }
  : { firm: "", stage: "inquiry", assignee: me, source: "inquiry", last_at: "", last_note: "", next: "", due: suggestDue("inquiry", today) || "", links: "", hold_until: "", lost_reason: "" };

function CardSheet({ team, me, card, preset, members, today, onClose, onSaved, onStale }: { team: string; me: string; card: Card | null; preset: Partial<Draft>; members: Member[]; today: string; onClose: () => void; onSaved: (c: Card) => void; onStale: () => void }) {
  const [d0] = useState<Draft>(() => draftOf(card, me, today)), [ver, setVer] = useState(card?.ver || 0), [d, setD] = useState<Draft>(() => ({ ...d0, ...preset })), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [log, setLog] = useState<Ev[] | null>(null);
  useEffect(() => { if (card) api<{ events: Ev[] }>("GET", `/api/sales/teams/${team}/cards/${card.id}/events`).then(r => r.ok && setLog(r.events)); }, [team, card?.id]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(x => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setErr("");
    const all = { ...d, links: d.links.split(/\s+/).filter(Boolean), last_at: d.last_at || null, due: d.due || null, hold_until: d.hold_until || null };
    // 고치기는 내가 바꾼 칸만 보냄(그 사이 다른 사람이 고친 칸을 덮지 않게)
    const body = card ? Object.fromEntries(Object.entries(all).filter(([k]) => d[k as keyof Draft] !== d0[k as keyof Draft])) : all;
    const r = card ? await api<{ card: Card }>("PATCH", `/api/sales/teams/${team}/cards/${card.id}`, { ...body, ver }) : await api<{ card: Card }>("POST", `/api/sales/teams/${team}/cards`, body);
    setBusy(false);
    if (r.ok) return onSaved(r.card);
    if (r.status === 409 && r.card) { setVer(r.card.ver); setErr("다른 사람이 먼저 고쳤어요 — 내 입력은 그대로 두었어요. 다시 저장하면 내가 바꾼 칸만 바뀌어요"); onStale(); return; }
    setErr(r.error);
  };
  const field = "h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-[15px]";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--scrim)] md:items-center" onClick={onClose}>
      <form role="dialog" aria-modal="true" aria-label={card ? card.firm : "새 잠재 고객"} onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); save(); }}
        className="flex max-h-[92dvh] w-full max-w-[520px] flex-col gap-3 overflow-y-auto rounded-t-2xl bg-[var(--bg)] p-5 md:rounded-2xl">
        <h2 className="text-[18px] font-semibold">{card ? card.firm : "새 잠재 고객"}</h2>
        <L t="사무소"><input className={field} value={d.firm} maxLength={80} required autoFocus={!card} onChange={e => set("firm", e.target.value)} /></L>
        <div className="grid grid-cols-2 gap-3">
          <L t="단계"><select className={field} value={d.stage} onChange={e => { const s = e.target.value as Stage; setD(x => ({ ...x, stage: s, due: s === x.stage ? x.due : suggestDue(s, today) || x.due })); }}>
            {STAGES.map((s, i) => <option key={s} value={s}>{i < 7 ? `${i + 1} ` : ""}{STAGE_KO[s]}</option>)}</select></L>
          <L t="담당"><select className={field} value={d.assignee} onChange={e => set("assignee", e.target.value)}>{members.some(m => m.email === d.assignee) ? null : <option value={d.assignee}>{d.assignee} (팀에 없음)</option>}{members.map(m => <option key={m.email} value={m.email}>{m.name || m.email}</option>)}</select></L>
          <L t="들어온 길"><select className={field} value={d.source} onChange={e => set("source", e.target.value as Source)}>{SOURCES.map(s => <option key={s} value={s}>{SOURCE_KO[s]}</option>)}</select></L>
          <L t="마지막 연락"><input type="date" className={field} value={d.last_at} onChange={e => set("last_at", e.target.value)} /></L>
        </div>
        <L t="마지막 연락 한 줄"><input className={field} value={d.last_note} maxLength={200} onChange={e => set("last_note", e.target.value)} /></L>
        {d.stage === "hold" ? <L t="다시 볼 날짜"><input type="date" className={field} value={d.hold_until} required onChange={e => set("hold_until", e.target.value)} /></L>
          : d.stage === "lost" ? <L t="놓친 이유"><input className={field} value={d.lost_reason} maxLength={200} required onChange={e => set("lost_reason", e.target.value)} /></L>
          : <div className="grid grid-cols-[1fr_auto] gap-3">
              <L t="다음 할 일"><input className={field} value={d.next} maxLength={200} required onChange={e => set("next", e.target.value)} /></L>
              <L t="기한"><input type="date" className={field} value={d.due} required onChange={e => set("due", e.target.value)} /></L>
            </div>}
        <L t="원문 링크(줄마다 하나 · 연락처는 넣지 않아요)"><textarea className="min-h-[72px] rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[14px]" value={d.links} onChange={e => set("links", e.target.value)} /></L>
        {log?.length ? <section aria-label="기록" className="flex flex-col gap-1 border-t border-[var(--line)] pt-3 text-[12px] text-[var(--muted)]">
          <h3 className="text-[13px] font-medium text-[var(--soft)]">기록</h3>
          {log.slice(0, 20).map((e, i) => <p key={i}>{when(e.at)} {short(members, e.who)} — {evText(e)}</p>)}
        </section> : null}
        {err ? <p role="alert" className="text-[13px] text-[var(--danger)]">{err}</p> : null}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-[var(--line)]">닫기</button>
          <button disabled={busy} className="h-11 flex-1 rounded-xl bg-[var(--ink)] font-medium text-[var(--bg)] disabled:opacity-50">{busy ? <span className="g g-spin" aria-label="저장 중" /> : "저장"}</button>
        </div>
      </form>
    </div>
  );
}
