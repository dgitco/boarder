create table if not exists task_convo (
  id integer primary key autoincrement,
  owner text not null,
  task_id text not null,
  layer text not null check (layer in ('human', 'agents')),
  who text not null,
  at integer not null,
  source text not null,
  text text not null,
  src_ref text not null,
  created_at integer not null
);
create unique index if not exists task_convo_ref on task_convo(owner, task_id, src_ref);
create index if not exists task_convo_read on task_convo(owner, task_id, at, id);
