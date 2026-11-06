create table if not exists task (
  owner text not null,
  no integer not null,
  title text not null,
  status text not null default '진행',
  state text not null default 'open' check (state in ('open', 'blocked', 'done')),
  unblock text,
  agent text not null default '',
  body text not null default '',
  refs text not null default '[]',
  sessions text not null default '[]',
  created_at integer not null,
  updated_at integer not null,
  done_at integer,
  rev integer not null default 0,
  primary key (owner, no)
);
create index if not exists task_live on task (owner, state, updated_at);
create table if not exists task_seq (owner text primary key, last integer not null);
create table if not exists task_log (
  id integer primary key autoincrement,
  owner text not null,
  no integer not null,
  at integer not null,
  who text not null,
  what text not null
);
create index if not exists task_log_no on task_log (owner, no, at);
