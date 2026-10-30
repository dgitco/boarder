create table if not exists owner_state (k text primary key, v text not null, at integer not null, ver integer not null default 0, ord integer not null default 0);
create table if not exists f7_after (seq integer primary key autoincrement, kind text not null, args text not null, at integer not null, mark integer not null default 0, done_at integer, res text,
  tries integer not null default 0, tried_at integer);
create index if not exists f7_after_open on f7_after(seq) where done_at is null;
