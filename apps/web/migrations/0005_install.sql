create table invite (
  email text primary key,
  by_email text not null,
  at integer not null
);
-- 기기: boarder setup 이 브라우저 승인으로 받은 기기 토큰(값은 두지 않고 sha256 만)
create table device (
  id text primary key,
  owner text not null,
  name text not null default '',
  tools text not null default '',
  token_hash text not null unique,
  created_at integer not null,
  last_at integer,
  revoked_at integer
);
create index device_owner on device(owner, revoked_at);
-- 기기 코드(10분): CLI 는 device_code(해시만 둠)로 폴링, 사람은 user_code 를 브라우저에서 확인 · 허용. 승인 뒤 첫 폴링에 기기 토큰을 한 번만 만들어 줌
create table device_code (
  code_hash text primary key,
  user_code text not null unique,
  name text not null default '',
  tools text not null default '',
  created_at integer not null,
  expires_at integer not null,
  state text not null default 'pending',   -- pending · approved · denied · issued
  owner text,
  device_id text,
  req_ip text not null default '',
  req_country text not null default ''
);
create index device_code_ip on device_code(req_ip, created_at);
alter table agent_token add column owner text not null default '';
alter table agent_token add column device_id text;
-- 주인이 아닌 사람의 보드(D1)
create table board_log (
  id integer primary key autoincrement,
  owner text not null,
  win text not null,
  kind text not null,
  text text not null,
  thread text,
  at integer not null
);
create index board_log_owner on board_log(owner, at);
create table board_card (
  id text primary key,
  owner text not null,
  win text not null,
  question text not null,
  choices text not null,
  recommend text,
  body text,
  state text not null default 'open',      -- open · answered · closed
  answer text,
  answered_at integer,
  done text,
  at integer not null
);
create index board_card_owner on board_card(owner, state, at);
