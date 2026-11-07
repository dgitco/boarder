export const LOGIN_RX = /계정이 아직 로그인되지 않았어요/;
// 메인 스레드에서 숨길 옛 「보더」 오류 줄(구독 미연결로 생긴 것만 — 지우지 않고 보이지만 않게)
export const loginSysLine = (r: { win?: unknown; kind?: unknown; text?: unknown }) => r.win === "보더" && r.kind === "sys" && (LOGIN_RX.test(String(r.text || "")) || /^아직 구독 계정이 연동되지 않았어요/.test(String(r.text || "")));
export const LOGIN_SYS_SQL = " AND NOT (win = '보더' AND kind = 'sys' AND (text LIKE '%계정이 아직 로그인되지 않았어요%' OR text LIKE '아직 구독 계정이 연동되지 않았어요%'))";
export async function subMissing(db: D1Database, me: string, now = Date.now()) {
  const r = await db.prepare(`SELECT
      (SELECT count(*) FROM device WHERE owner = ?1 AND revoked_at IS NULL AND scope = 'full' AND engine_at > ?2) AS live,
      (SELECT count(*) FROM engine_window w JOIN device d ON d.id = w.device_id WHERE w.owner = ?1 AND w.kind = 'main' AND w.state NOT IN ('closed','failed') AND d.revoked_at IS NULL) AS alive,
      (SELECT note FROM engine_window WHERE owner = ?1 AND kind = 'main' ORDER BY created_at DESC LIMIT 1) AS note,
      (SELECT json_extract(rules, '$.provider') FROM engine_owner WHERE owner = ?1 AND json_valid(rules)) AS prov,
      (SELECT v FROM user_pref WHERE owner = ?1 AND k = 'primary_win') AS pwin,
      (SELECT CASE WHEN json_valid(data) THEN json_extract(data, '$.primary_item') END FROM node_setting WHERE owner = ?1) AS pick,
      (SELECT count(*) FROM imp_item i JOIN device d ON d.id = i.device_id WHERE i.owner = ?1 AND i.kind = 'window' AND i.gone_at IS NULL AND d.revoked_at IS NULL) AS imp`).bind(me, now - 120_000)
    .first<{ live: number; alive: number; note: string | null; prov: string | null; pwin: string | null; pick: string | null; imp: number }>().catch(() => null);
  const pick = r?.pick || "auto", other = !!r && (!!r.pwin || /^window:/.test(pick) || (pick !== "none" && r.imp > 0));
  const missing = !!r && !other && r.live > 0 && !r.alive && LOGIN_RX.test(String(r.note || ""));
  return { missing, provider: missing && (r!.prov === "codex" || r!.prov === "claude") ? r!.prov : null };
}
