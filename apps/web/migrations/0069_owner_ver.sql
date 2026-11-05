CREATE TABLE owner_ver (owner TEXT PRIMARY KEY, v INTEGER NOT NULL);

CREATE TRIGGER owner_ver_board_log_insert AFTER INSERT ON board_log
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_board_log_update AFTER UPDATE ON board_log WHEN OLD.id IS NOT NEW.id OR OLD.owner IS NOT NEW.owner OR OLD.win IS NOT NEW.win OR OLD.kind IS NOT NEW.kind OR OLD.text IS NOT NEW.text OR OLD.thread IS NOT NEW.thread OR OLD.at IS NOT NEW.at OR OLD.wid IS NOT NEW.wid
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_board_log_delete AFTER DELETE ON board_log
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_imp_item_insert AFTER INSERT ON imp_item
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_imp_item_update AFTER UPDATE ON imp_item WHEN OLD.owner IS NOT NEW.owner OR OLD.key IS NOT NEW.key OR OLD.device_id IS NOT NEW.device_id OR OLD.kind IS NOT NEW.kind OR OLD.engine IS NOT NEW.engine OR OLD.title IS NOT NEW.title OR OLD.cwd IS NOT NEW.cwd OR OLD.repo IS NOT NEW.repo OR OLD.branch IS NOT NEW.branch OR OLD.refs IS NOT NEW.refs OR OLD.state IS NOT NEW.state OR OLD.state_at IS NOT NEW.state_at OR OLD.win IS NOT NEW.win OR OLD.session IS NOT NEW.session OR OLD.handle IS NOT NEW.handle OR OLD.seen_at IS NOT NEW.seen_at OR OLD.gone_at IS NOT NEW.gone_at
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_imp_item_delete AFTER DELETE ON imp_item
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_mnode_insert AFTER INSERT ON mnode
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_mnode_update AFTER UPDATE ON mnode WHEN OLD.owner IS NOT NEW.owner OR OLD.id IS NOT NEW.id OR OLD.name IS NOT NEW.name OR OLD.pinned_name IS NOT NEW.pinned_name OR OLD.area IS NOT NEW.area OR OLD.state IS NOT NEW.state OR OLD.why IS NOT NEW.why OR OLD.counts IS NOT NEW.counts OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at OR OLD.archived_at IS NOT NEW.archived_at OR OLD.task IS NOT NEW.task
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_mnode_delete AFTER DELETE ON mnode
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_mnode_item_insert AFTER INSERT ON mnode_item
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_mnode_item_update AFTER UPDATE ON mnode_item WHEN OLD.owner IS NOT NEW.owner OR OLD.item IS NOT NEW.item OR OLD.node IS NOT NEW.node OR OLD.how IS NOT NEW.how
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_mnode_item_delete AFTER DELETE ON mnode_item
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_board_card_insert AFTER INSERT ON board_card
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_board_card_update AFTER UPDATE ON board_card WHEN OLD.id IS NOT NEW.id OR OLD.owner IS NOT NEW.owner OR OLD.win IS NOT NEW.win OR OLD.question IS NOT NEW.question OR OLD.choices IS NOT NEW.choices OR OLD.recommend IS NOT NEW.recommend OR OLD.body IS NOT NEW.body OR OLD.state IS NOT NEW.state OR OLD.answer IS NOT NEW.answer OR OLD.answered_at IS NOT NEW.answered_at OR OLD.at IS NOT NEW.at OR OLD.kind IS NOT NEW.kind OR OLD.snooze_until IS NOT NEW.snooze_until
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_board_card_delete AFTER DELETE ON board_card
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_role_draft_insert AFTER INSERT ON role_draft
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_role_draft_update AFTER UPDATE ON role_draft WHEN OLD.id IS NOT NEW.id OR OLD.owner IS NOT NEW.owner OR OLD.name IS NOT NEW.name OR OLD.brief IS NOT NEW.brief OR OLD.instructions IS NOT NEW.instructions OR OLD.cwd IS NOT NEW.cwd OR OLD.state IS NOT NEW.state OR OLD.role_id IS NOT NEW.role_id OR OLD.by_win IS NOT NEW.by_win OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_role_draft_delete AFTER DELETE ON role_draft
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_engine_window_insert AFTER INSERT ON engine_window
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_engine_window_update AFTER UPDATE ON engine_window WHEN OLD.id IS NOT NEW.id OR OLD.owner IS NOT NEW.owner OR OLD.kind IS NOT NEW.kind OR OLD.name IS NOT NEW.name OR OLD.state IS NOT NEW.state OR OLD.state_at IS NOT NEW.state_at OR OLD.note IS NOT NEW.note OR OLD.created_at IS NOT NEW.created_at OR OLD.closed_at IS NOT NEW.closed_at
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_engine_window_delete AFTER DELETE ON engine_window
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_node_setting_insert AFTER INSERT ON node_setting
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_node_setting_update AFTER UPDATE ON node_setting WHEN OLD.owner IS NOT NEW.owner OR OLD.data IS NOT NEW.data OR OLD.updated_at IS NOT NEW.updated_at
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_node_setting_delete AFTER DELETE ON node_setting
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_user_pref_insert AFTER INSERT ON user_pref WHEN NEW.k = 'primary_win'
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_user_pref_update AFTER UPDATE ON user_pref WHEN (OLD.k = 'primary_win' OR NEW.k = 'primary_win') AND (OLD.owner IS NOT NEW.owner OR OLD.k IS NOT NEW.k OR OLD.v IS NOT NEW.v)
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_user_pref_delete AFTER DELETE ON user_pref WHEN OLD.k = 'primary_win'
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_member_bot_insert AFTER INSERT ON member_bot
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (CASE WHEN NEW.owner LIKE '@me:%' THEN substr(NEW.owner, 5) ELSE NEW.owner END, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_member_bot_update AFTER UPDATE ON member_bot WHEN OLD.owner IS NOT NEW.owner OR OLD.seed IS NOT NEW.seed OR OLD.hue IS NOT NEW.hue OR OLD.name IS NOT NEW.name OR OLD.photo IS NOT NEW.photo OR OLD.icon IS NOT NEW.icon OR OLD.fav IS NOT NEW.fav OR OLD.updated_at IS NOT NEW.updated_at
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (CASE WHEN NEW.owner LIKE '@me:%' THEN substr(NEW.owner, 5) ELSE NEW.owner END, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT CASE WHEN OLD.owner LIKE '@me:%' THEN substr(OLD.owner, 5) ELSE OLD.owner END, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_member_bot_delete AFTER DELETE ON member_bot
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (CASE WHEN OLD.owner LIKE '@me:%' THEN substr(OLD.owner, 5) ELSE OLD.owner END, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_agent_token_insert AFTER INSERT ON agent_token
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_agent_token_update AFTER UPDATE ON agent_token WHEN OLD.owner IS NOT NEW.owner OR OLD.pane IS NOT NEW.pane OR OLD.win IS NOT NEW.win OR OLD.created_at IS NOT NEW.created_at
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_agent_token_delete AFTER DELETE ON agent_token
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_device_insert AFTER INSERT ON device
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_device_update AFTER UPDATE ON device WHEN OLD.id IS NOT NEW.id OR OLD.owner IS NOT NEW.owner OR OLD.revoked_at IS NOT NEW.revoked_at
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_device_delete AFTER DELETE ON device
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_member_promise_insert AFTER INSERT ON member_promise
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_member_promise_update AFTER UPDATE ON member_promise WHEN OLD.id IS NOT NEW.id OR OLD.owner IS NOT NEW.owner OR OLD.win IS NOT NEW.win OR OLD.wid IS NOT NEW.wid OR OLD.who IS NOT NEW.who OR OLD.what IS NOT NEW.what OR OLD.check_by IS NOT NEW.check_by OR OLD.due IS NOT NEW.due OR OLD.state IS NOT NEW.state OR OLD.done IS NOT NEW.done OR OLD.at IS NOT NEW.at OR OLD.done_at IS NOT NEW.done_at
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (NEW.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
  INSERT INTO owner_ver(owner, v) SELECT OLD.owner, 1 WHERE OLD.owner IS NOT NEW.owner
  ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

CREATE TRIGGER owner_ver_member_promise_delete AFTER DELETE ON member_promise
BEGIN
  INSERT INTO owner_ver(owner, v) VALUES (OLD.owner, 1) ON CONFLICT(owner) DO UPDATE SET v = v + 1;
END;

