create table member_split (
  id integer primary key autoincrement,
  owner text not null,
  root_ts text not null,
  log_id integer not null,
  post_ts text not null,
  node_id text not null,
  at integer not null
);
create index member_split_root on member_split(owner, root_ts);
create unique index member_split_post on member_split(owner, post_ts);
