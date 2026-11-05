create table if not exists window_block (
  device_id text not null,
  pane text not null,
  owner text not null,
  at integer not null,
  primary key (device_id, pane)
);
create table if not exists token_audit (
  id integer primary key autoincrement,
  owner text not null,           -- 기기 주인 메일
  at integer not null,
  act text not null,             -- revoke_device · revoke_window · enable_window
  device_id text not null,
  pane text,
  by_email text not null,        -- 누른 사람(로그인 세션)
  n integer not null default 0
);
create index if not exists token_audit_owner on token_audit(owner, at);
