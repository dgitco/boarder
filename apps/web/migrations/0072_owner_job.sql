create table if not exists owner_job (
  seq integer primary key autoincrement,
  rid text not null unique,
  kind text not null,
  okey text not null,
  body text not null default '',
  at integer not null,
  taken_at integer,
  tries integer not null default 0,
  done_at integer,
  upd_at integer,
  status integer,
  result text
);
create index if not exists owner_job_open on owner_job(okey, seq) where done_at is null;
create index if not exists owner_job_done on owner_job(done_at) where done_at is not null;
create table if not exists owner_job_beat (id integer primary key check (id = 1), at integer not null);
insert or ignore into f7_flag(name, on_at, note) values ('write_owner_jobs', null, '주인 쓰기 POST 를 D1 할 일 줄(owner_job)로 — 실행기가 당겨 처리. 끄면 예전 다리 길');
