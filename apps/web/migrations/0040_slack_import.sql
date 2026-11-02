create table if not exists slack_chan (
  owner text not null,
  chan text not null,                    -- Slack 채널 id(C… · G… · D…)
  node text not null,                    -- mnode.id(sl_ + 12자)
  name text not null,                    -- 채널 이름(# 없이)
  workspace text not null default '',
  is_private integer not null default 0,
  topic text not null default '',
  msgs integer not null default 0,
  first_at integer,
  last_at integer,
  created_at integer not null,
  updated_at integer not null,
  primary key (owner, chan)
);
create unique index if not exists slack_chan_node on slack_chan(owner, node);
create table if not exists slack_msg (
  id integer primary key autoincrement,
  owner text not null,
  chan text not null,
  ts text not null,                      -- Slack ts(초.마이크로초)
  thread_ts text,                        -- 답글이면 뿌리 ts, 뿌리 · 보통 글은 NULL
  at integer not null,                   -- ts 를 ms 로(정렬 · 하루 상한)
  user_id text not null default '',
  user_name text not null default '',
  text text not null default '',         -- 봉투 암호화(vault, AAD pk = chan/ts) — 스위치가 꺼져 있으면 평문
  files text not null default '[]',      -- [{name, permalink}] JSON — text 와 같이 봉함
  reactions text not null default '[]',  -- [{name, count}]
  subtype text not null default '',
  imported_at integer not null
);
-- 같은 (사람, 채널, ts) 는 한 줄만 — 다시 돌려도 겹치지 않음
create unique index if not exists slack_msg_key on slack_msg(owner, chan, ts);
create index if not exists slack_msg_thread on slack_msg(owner, chan, thread_ts, ts);
create index if not exists slack_msg_day on slack_msg(owner, imported_at);
