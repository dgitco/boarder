create table if not exists art_view (
  owner text not null,
  art text not null,
  first_at integer not null,
  last_at integer not null,
  n integer not null default 1,
  primary key (owner, art)
);
create index if not exists art_view_last on art_view (owner, last_at);
