
create table engine_owner (
  owner text primary key,
  perm_mode text not null default 'ask',      -- ask · bypass
  perm_at integer,
  rules text,                                  -- JSON { wake_min, park_min, close_min } — 없으면 기본
  updated_at integer not null
);
-- 역할 = 데이터 한 줄(16쪽 ③). 표 꼴은 「Boarder 들여오기」 창(0015_import.sql)과 같게 — 두 길(들여오기 · 메인 봇)이 한 역할 표를 씀. 먼저 들어간 쪽이 만듦
create table if not exists role (
  owner text not null,
  id text not null,
  name text not null,
  look text not null default '',
  instructions text not null default '',
  intake text not null default '',
  engine text not null default '',
  perms text not null default '',
  supervise text not null default '',
  rules text not null default '',
  source text not null default '',
  created_at integer not null,
  updated_at integer not null,
  primary key (owner, id)
);
create table role_draft (
  id text primary key,
  owner text not null,
  name text not null,
  brief text not null default '',
  instructions text not null default '',
  cwd text not null default '',
  state text not null default 'draft',         -- draft · approved · dismissed · revised
  role_id text,
  by_win text,
  created_at integer not null,
  updated_at integer not null
);
create index role_draft_owner on role_draft(owner, created_at);
create table engine_window (
  id text primary key,
  owner text not null,
  device_id text not null,
  kind text not null default 'role',
  role_id text,
  name text not null,
  state text not null default 'opening',       -- opening · starting · busy · idle · waiting · background · parked · closed · gone · failed
  state_at integer,
  dialog text,
  note text,                                   -- 마지막 오류 · 한도 문구
  handle text,
  woke_at integer,
  created_at integer not null,
  closed_at integer
);
create index engine_window_owner on engine_window(owner, state);
create index engine_window_device on engine_window(device_id, state);
-- 기기의 엔진(데몬이 hello 로 올림): { engines: { tmux: { caps } }, default, host, cli } · 마지막 연락
alter table device add column engine text;
alter table device add column engine_at integer;
alter table board_log add column wid text;
alter table board_card add column wid text;
create index board_log_wid on board_log(wid, at);
