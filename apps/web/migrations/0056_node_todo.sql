create table if not exists node_todo (
  id integer primary key autoincrement,
  owner text not null,
  node text not null,
  title text not null,
  prio integer not null default 2,
  sort real not null,
  state text not null default 'todo',
  wait text,
  "by" text,
  evidence text,
  created_at integer,
  updated_at integer,
  done_at integer
);
create index if not exists node_todo_owner_node_state on node_todo (owner, node, state);
