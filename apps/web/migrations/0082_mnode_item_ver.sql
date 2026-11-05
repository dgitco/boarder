CREATE TABLE IF NOT EXISTS mnode_item_ver (owner TEXT PRIMARY KEY, v INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS mnode_item_ver_ins AFTER INSERT ON mnode_item
BEGIN
  INSERT INTO mnode_item_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS mnode_item_ver_upd AFTER UPDATE ON mnode_item WHEN OLD.owner IS NOT NEW.owner OR OLD.item IS NOT NEW.item OR OLD.node IS NOT NEW.node OR OLD.how IS NOT NEW.how
BEGIN
  INSERT INTO mnode_item_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO mnode_item_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;
CREATE TRIGGER IF NOT EXISTS mnode_item_ver_del AFTER DELETE ON mnode_item
BEGIN
  INSERT INTO mnode_item_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;
