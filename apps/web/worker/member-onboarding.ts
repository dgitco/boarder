type Db = D1Database;
export type Step = { key: string; title: string; done: boolean; detail: string; cmd?: string; to?: string; pick?: { target: string; title: string; on: boolean }[] };
type Dir = { tool: string; where: string; state: string };
const json = <T,>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };
const TOOL = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", gemini: "Gemini CLI" } as Record<string, string>;

export async function onboarding(db: Db, me: string, o: { server: string; push: boolean; ownerSubs?: number }) {
  const [dv, win, ew, conn, sl, pref, push] = await db.batch([
    db.prepare("SELECT id, name, features, last_at FROM device WHERE owner = ? AND revoked_at IS NULL AND scope = 'full' ORDER BY last_at DESC LIMIT 20").bind(me),
    db.prepare("SELECT key, title, device_id FROM imp_item WHERE owner = ? AND kind = 'window' AND gone_at IS NULL AND device_id != '' ORDER BY seen_at DESC LIMIT 40").bind(me),
    db.prepare("SELECT id, name FROM engine_window WHERE owner = ? AND state NOT IN ('closed','failed','gone') ORDER BY created_at DESC LIMIT 20").bind(me),
    db.prepare("SELECT service, label, read_only FROM connection WHERE owner = ? ORDER BY created_at").bind(me),
    db.prepare("SELECT count(*) AS n, coalesce(sum(msgs), 0) AS m FROM slack_chan WHERE owner = ?").bind(me),
    db.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = 'primary_win'").bind(me),
    db.prepare("SELECT count(*) AS n FROM member_push_ep WHERE owner = ? AND endpoint NOT LIKE 'page:%'").bind(me),
  ]);
  const devices = (dv.results as { id: string; name: string; features: string | null }[]).map(d => ({ ...d, f: json<{ report?: string[]; engine?: boolean; reportDirs?: Dir[] }>(d.features, {}) }));
  const engines = devices.filter(d => d.f.engine).length;
  const dirs = devices.flatMap(d => (Array.isArray(d.f.reportDirs) ? d.f.reportDirs : (d.f.report || []).map(t => ({ tool: t, where: "", state: "on" }))).map(x => ({ ...x, device: d.name })));
  const on = dirs.filter(x => x.state === "on"), stale = dirs.filter(x => x.state === "stale"), off = dirs.filter(x => x.state === "off");
  const wins = [...(win.results as { key: string; title: string }[]).map(w => ({ target: w.key, title: w.title || w.key.replace(/^window:/, "") })), ...(ew.results as { id: string; name: string }[]).map(w => ({ target: w.id, title: `${w.name} (보더 엔진)` }))];
  const target = (pref.results[0] as { v: string } | undefined)?.v || null, alive = !!target && wins.some(w => w.target === target);
  const conns = conn.results as { service: string; label: string; read_only: number }[];
  const s = sl.results[0] as { n: number; m: number };
  const pushN = o.ownerSubs ?? Number((push.results[0] as { n: number })?.n || 0);
  const host = o.server.replace(/\/+$/, "");
  const where = (x: Dir & { device: string }) => `${TOOL[x.tool] || x.tool}${x.where ? ` (${x.where})` : ""} — ${x.device}`;
  const steps: Step[] = [
    { key: "devices", title: "기기", done: devices.length > 0,
      detail: devices.length ? `기기 ${devices.length}대 · 엔진 켜짐 ${engines}대` : "아직 기기가 없어요 — 쓰는 컴퓨터에 보더를 깔아요",
      cmd: devices.length && !engines ? "boarder enable engine" : `curl -fsSL ${host}/install.sh | sh && boarder setup --email ${me}` },
    { key: "report", title: "AI 도구", done: on.length > 0 && !stale.length,
      detail: !dirs.length ? "기기가 아직 AI 도구 상태를 올리지 않았어요" : `보고 켜짐 ${on.length}곳${stale.length ? ` · 옛 경로 ${stale.length}곳` : ""}${off.length ? ` · 꺼짐 ${off.length}곳` : ""}${stale.length ? ` — ${stale.slice(0, 3).map(where).join(", ")}` : off.length ? ` — ${off.slice(0, 3).map(where).join(", ")}` : ""}`,
      cmd: "boarder enable report --yes" },
    { key: "windows", title: "창 들여오기", done: wins.length > 0, detail: wins.length ? `창 ${wins.length}개가 보드에 있어요` : "지금 쓰는 AI 창을 보드 노드로 들여와요", cmd: "boarder import --setup" },
    { key: "connectors", title: "커넥터", done: conns.length > 0,
      detail: conns.length ? `연결 ${conns.length}개 · ${conns.slice(0, 4).map(c => (c.label ? `${c.service}-${c.label}` : c.service) + (c.read_only ? "(읽기만)" : "")).join(", ")}` : "Slack · GitHub · 메일을 연결해요 — 열쇠는 기기에서 넣고 보드에서 허용",
      cmd: "boarder connect slack-team --key-file <열쇠 파일> --base-url https://slack.com/api", to: "#settings/connectors" },
    { key: "slack", title: "옛 대화 들여오기(Slack)", done: s.n > 0, detail: s.n ? `채널 ${s.n}개 · 글 ${s.m}개` : "예전 Slack 채널 글을 채널마다 노드로 들여와요", cmd: "boarder import slack <내보낸 폴더>" },
    { key: "primary", title: "기본 창 고르기", done: alive,
      detail: alive ? `일반 채널 글은 「${wins.find(w => w.target === target)!.title}」 창으로 가요` : target ? "고른 창이 닫혔어요 — 다시 골라요" : "일반 채널에 쓴 글을 받을 창(팀장 창)을 골라요 — 안 고르면 메인 봇이 받아요",
      pick: wins.map(w => ({ ...w, on: w.target === target })) },
    { key: "push", title: "알림 켜기", done: pushN > 0,
      detail: !o.push ? "알림은 아직 준비 중이에요" : pushN ? `이 계정 알림을 받는 브라우저 ${pushN}곳` : o.ownerSubs !== undefined ? "폰 · 브라우저로 급한 일 알림을 받아요 — 보드 위 종 단추에서 켜요" : "폰 · 브라우저로 결정 카드 알림을 받아요 — 보드 위 종 단추에서 켜요" },
  ];
  return { steps, done: steps.filter(x => x.done).length, total: steps.length };
}
