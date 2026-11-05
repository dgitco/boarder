CREATE TABLE IF NOT EXISTS talk_ver (k INTEGER PRIMARY KEY, v INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS talk_ver_talk_msg_i AFTER INSERT ON wl_talk_msg
BEGIN
  INSERT INTO talk_ver(k, v) VALUES (1, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS talk_ver_talk_msg_u AFTER UPDATE ON wl_talk_msg WHEN OLD.id IS NOT NEW.id OR OLD.chan IS NOT NEW.chan OR OLD.thread IS NOT NEW.thread OR OLD.who IS NOT NEW.who OR OLD.author IS NOT NEW.author OR OLD.pane IS NOT NEW.pane OR OLD.text IS NOT NEW.text OR OLD.at IS NOT NEW.at OR OLD.deleted_at IS NOT NEW.deleted_at
BEGIN
  INSERT INTO talk_ver(k, v) VALUES (1, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS talk_ver_talk_msg_d AFTER DELETE ON wl_talk_msg
BEGIN
  INSERT INTO talk_ver(k, v) VALUES (1, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS talk_ver_talk_seen_i AFTER INSERT ON wl_talk_seen
BEGIN
  INSERT INTO talk_ver(k, v) VALUES (1, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS talk_ver_talk_seen_u AFTER UPDATE ON wl_talk_seen WHEN OLD.who IS NOT NEW.who OR OLD.chan IS NOT NEW.chan OR OLD.thread IS NOT NEW.thread OR OLD.at IS NOT NEW.at
BEGIN
  INSERT INTO talk_ver(k, v) VALUES (1, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS talk_ver_talk_seen_d AFTER DELETE ON wl_talk_seen
BEGIN
  INSERT INTO talk_ver(k, v) VALUES (1, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS talk_ver_talk_reaction_i AFTER INSERT ON wl_talk_reaction
BEGIN
  INSERT INTO talk_ver(k, v) VALUES (1, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS talk_ver_talk_reaction_u AFTER UPDATE ON wl_talk_reaction WHEN OLD.msg IS NOT NEW.msg OR OLD.who IS NOT NEW.who OR OLD.at IS NOT NEW.at OR OLD.removed_at IS NOT NEW.removed_at
BEGIN
  INSERT INTO talk_ver(k, v) VALUES (1, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS talk_ver_talk_reaction_d AFTER DELETE ON wl_talk_reaction
BEGIN
  INSERT INTO talk_ver(k, v) VALUES (1, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1;
END;
