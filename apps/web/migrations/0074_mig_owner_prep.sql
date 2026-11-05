-- 주인 · 회원 한 길 ④ 준비(스위치 owner_unified_prep, owner-prep.ts): 주인 기기 범위 · 기기 owner 메일 · 설정 정본을 canon 회원 줄로 옮길 때 옛 값을 남김.
--   kind = device(pk 기기 id, old {scope, owner}) · grant(pk "<옛 owner>|<user_pref k>", old {owner}) · node_setting(pk canon, old {옮기기 전 노드 수치 칸})
--   · face(pk member_bot owner — canon · @me:<canon>, old 그 줄 전부 또는 null = 없던 줄).
-- 되돌리기(POST /api/admin/owner-prep/migrate action back)는 이 표의 옛 값으로 되돌리고 그 줄을 지움. 처음 옮길 때 값만 남김(두 번 돌려도 첫 옛 값).
CREATE TABLE IF NOT EXISTS mig_owner_prep (
  kind TEXT NOT NULL,
  pk TEXT NOT NULL,
  old TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (kind, pk)
);
