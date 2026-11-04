create table if not exists agent_face (
  owner text not null,
  key text not null,
  seed text not null default '',
  hue integer not null default 0,
  photo text not null default '',
  at integer not null,
  primary key (owner, key)
);
