-- 본문이 없는 직접 업로드 제어 상태. 회원별 세션 조회와 만료 정리에만 사용한다.
CREATE TABLE IF NOT EXISTS direct_upload (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 524288000),
  mime TEXT NOT NULL,
  metadata TEXT NOT NULL,
  upload_id TEXT,
  state TEXT NOT NULL,
  expires INTEGER NOT NULL,
  charged_day TEXT,
  locked_at INTEGER
);
CREATE INDEX IF NOT EXISTS direct_upload_expiry ON direct_upload(expires);

CREATE TABLE IF NOT EXISTS canvas_upload (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  expires INTEGER NOT NULL,
  locked_at INTEGER
);
CREATE INDEX IF NOT EXISTS canvas_upload_expiry ON canvas_upload(expires);

CREATE UNIQUE INDEX IF NOT EXISTS direct_file_target ON direct_upload(owner,target)
WHERE substr(owner,1,5)='file:' AND state NOT IN ('aborted','expired');
