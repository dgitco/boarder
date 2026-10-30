create table member_bot (
  owner text primary key,
  seed text not null,
  hue integer not null,
  name text not null,
  photo text not null default '',
  icon text not null,
  fav text not null,
  updated_at integer not null
);
