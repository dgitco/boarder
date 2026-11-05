create table wl_art_pref (art TEXT PRIMARY KEY, pin INTEGER NOT NULL DEFAULT 0, thumb TEXT NOT NULL DEFAULT '', at REAL NOT NULL);
create table member_artpref (
  owner text not null,
  art text not null,
  pin integer not null default 0,
  thumb text not null default '',
  at real not null,
  primary key (owner, art)
);
CREATE TRIGGER wl_web_art_pref_i AFTER INSERT ON wl_art_pref WHEN NOT EXISTS (SELECT 1 FROM wl_mute) BEGIN INSERT INTO wl_change(tbl, pk, op, at, origin, tx) VALUES ('art_pref', json_array(NEW."art"), 'up', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), 'web', (SELECT tx FROM wl_tx LIMIT 1)); END;
CREATE TRIGGER wl_web_art_pref_u AFTER UPDATE ON wl_art_pref WHEN NOT EXISTS (SELECT 1 FROM wl_mute) BEGIN INSERT INTO wl_change(tbl, pk, op, at, origin, tx) VALUES ('art_pref', json_array(OLD."art"), 'up', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), 'web', (SELECT tx FROM wl_tx LIMIT 1)); INSERT INTO wl_change(tbl, pk, op, at, origin, tx) SELECT 'art_pref', json_array(NEW."art"), 'up', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), 'web', (SELECT tx FROM wl_tx LIMIT 1) WHERE json_array(NEW."art") IS NOT json_array(OLD."art"); END;
CREATE TRIGGER wl_web_art_pref_d AFTER DELETE ON wl_art_pref WHEN NOT EXISTS (SELECT 1 FROM wl_mute) BEGIN INSERT INTO wl_change(tbl, pk, op, at, origin, tx) VALUES ('art_pref', json_array(OLD."art"), 'del', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), 'web', (SELECT tx FROM wl_tx LIMIT 1)); END;
