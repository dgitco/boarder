CREATE TABLE IF NOT EXISTS user_email (
  email TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  verified_at INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER
);
CREATE INDEX IF NOT EXISTS user_email_user ON user_email(user_id);
INSERT OR IGNORE INTO user_email(email, user_id, verified_at, is_primary, added_at)
  SELECT lower(email), id, CAST(unixepoch('subsec') * 1000 AS INTEGER), 1, CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM "user";
-- 새 가입도 자기 열쇠 메일 한 줄. 이미 다른 계정에 붙은 메일로 만든 줄(붙은 메일 첫 로그인 — auth.ts 가 세션을 옮긴 뒤 지움)은 건너뜀(OR IGNORE)
CREATE TRIGGER IF NOT EXISTS user_email_new AFTER INSERT ON "user"
BEGIN
  INSERT OR IGNORE INTO user_email(email, user_id, verified_at, is_primary, added_at)
    VALUES (lower(NEW.email), NEW.id, CAST(unixepoch('subsec') * 1000 AS INTEGER), 1, CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
