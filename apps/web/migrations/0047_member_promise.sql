create table member_promise (
  id integer primary key autoincrement,
  owner text not null,
  win text not null,
  wid text,
  who text not null,
  what text not null,
  check_by text not null,
  due text not null,
  state text not null default 'open',
  done text,
  at integer not null,
  done_at integer
);
create index member_promise_owner on member_promise(owner, state, at);
