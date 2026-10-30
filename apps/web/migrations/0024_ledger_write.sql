create table if not exists wl_mute (on_ integer);
-- wl_tx: 쓰기 묶음(batch) 하나 동안만 한 줄(꼬리표) — 트리거가 wl_change.tx 에 적어 그 묶음이 바꾼 줄을 같은 batch 끝에서 읽음
create table if not exists wl_tx (tx text primary key) without rowid;   -- without rowid: last_insert_rowid() 를 안 건드림
alter table wl_change add column tx text;
create index wl_change_tx on wl_change(tx) where tx is not null;
-- 들어간 묶음 꼬리표(응답을 잃고 다시 보내도 두 번 안 씀) · 문장마다 결과(changes · last_insert_rowid — 같은 batch 안에서 적음). 사흘 지나면 지움
create table if not exists wl_tx_done (tag text primary key, at integer not null) without rowid;
create table if not exists wl_tx_res (tag text not null, i integer not null, n integer not null, id integer, primary key (tag, i)) without rowid;
create index wl_tx_done_at on wl_tx_done(at);
-- D1 이 정본이 되면 UNIQUE 도 D1 이 지켜야 함(talk_db 의 INSERT OR IGNORE 가 slack_ts 겹침으로 거름) — 사본(worklog.db)과 같은 셋.
-- 릴레이 올리기는 ledger.apply 가 같은 값을 가진 다른 줄을 먼저 지워 줄 순서가 바뀌어 와도 안 막힘
create unique index wl_talk_msg_slack_ts_u on wl_talk_msg(slack_ts);
create unique index wl_talk_file_slack_file_u on wl_talk_file(slack_file);
create unique index wl_talk_chan_slack_channel_u on wl_talk_chan(slack_channel);
