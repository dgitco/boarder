CREATE TABLE IF NOT EXISTS member_seen_ver (owner TEXT PRIMARY KEY, v INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS member_seen_ver_ins AFTER INSERT ON member_seen
BEGIN
  INSERT INTO member_seen_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS member_seen_ver_upd AFTER UPDATE ON member_seen WHEN OLD.owner IS NOT NEW.owner OR OLD.pane IS NOT NEW.pane OR OLD.at IS NOT NEW.at
BEGIN
  INSERT INTO member_seen_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO member_seen_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS member_seen_ver_del AFTER DELETE ON member_seen
BEGIN
  INSERT INTO member_seen_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;
