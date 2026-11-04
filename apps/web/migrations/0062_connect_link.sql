-- 커넥터 연결 링크: 에이전트가 기기 토큰으로 만든 일회용 링크 — 사람이 열어 승인하면 OAuth 로 감.
-- 토큰은 해시만 저장(링크 자체가 비밀이라 DB 가 새도 못 씀). 10분 · 한 번만(used_at).
CREATE TABLE IF NOT EXISTS connect_link (
  hash TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  service TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  reconnect TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS connect_link_owner ON connect_link(owner, used_at, expires_at);
