// 상태 페이지 두 개(태스크 현황 · 기기 세션 현황)의 켜기/끄기 — 사람마다(user_pref 'feat:<이름>'), 기본 꺼짐.
//   배포 전체 끄기 = wrangler vars FLAGS_OFF 에 이름(taskboard · devboard)을 넣음 — 그러면 켠 사람도 꺼진 것과 같음(메뉴 없음 · API 403).
//   설정이 꺼진 사람에게는 메뉴 줄이 안 보이고, 그 페이지의 읽기 · 쓰기 API 와 기기 올리기 API 도 403(데이터를 받지도 주지도 않음).
type DB = D1Database;
export const FEATS = ["taskboard", "devboard"] as const;
export type Feat = typeof FEATS[number];
export const isFeat = (k: unknown): k is Feat => typeof k === "string" && (FEATS as readonly string[]).includes(k);
const offList = (flagsOff: string | undefined) => String(flagsOff || "").split(",").map(x => x.trim()).filter(Boolean);

/** 이 사람이 켠 기능(배포에서 끈 것은 늘 꺼짐) */
export async function featsOf(db: DB, email: string, flagsOff?: string): Promise<Record<Feat, boolean>> {
  const off = new Set(offList(flagsOff)), me = email.toLowerCase();
  const rows = (await db.prepare("SELECT k, v FROM user_pref WHERE owner = ? AND k LIKE 'feat:%'").bind(me).all<{ k: string; v: string }>()).results || [];
  const on = new Set(rows.filter(r => r.v === "1").map(r => r.k.slice(5)));
  return Object.fromEntries(FEATS.map(f => [f, !off.has(f) && on.has(f)])) as Record<Feat, boolean>;
}
export async function featOn(db: DB, email: string, feat: Feat, flagsOff?: string) {
  if (offList(flagsOff).includes(feat)) return false;
  const r = await db.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = ?").bind(email.toLowerCase(), "feat:" + feat).first<{ v: string }>();
  return r?.v === "1";
}
export async function setFeat(db: DB, email: string, feat: Feat, on: boolean, now = Date.now()) {
  await db.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(email.toLowerCase(), "feat:" + feat, on ? "1" : "0", now).run();
}
