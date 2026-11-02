create table member_artnote (
  id integer primary key autoincrement,
  owner text not null,
  art text not null,
  target text not null,
  page text not null default '',
  who text not null,
  text text not null,
  at real not null,
  deleted_at real
);
create index member_artnote_art on member_artnote(owner, art, deleted_at);
create table member_artfolder (
  owner text not null,
  art text not null,
  folder text not null,
  at real not null,
  primary key (owner, art)
);
