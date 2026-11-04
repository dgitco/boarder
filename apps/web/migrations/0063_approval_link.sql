-- 건건 승인 링크: 사람 몸에 닿는 설정 · 되돌릴 수 없는 일을 에이전트가 신청하면 일회용 링크로 사람이 「계속」을 눌러 하게 함.
-- 토큰은 해시만. 10분 · 한 번(used_at). 행동은 서버가 정한 목록(action)과 검사된 인자(params JSON)만.
CREATE TABLE IF NOT EXISTS approval_link (
  hash TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  action TEXT NOT NULL,
  params TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS approval_link_owner ON approval_link(owner, used_at, expires_at);
