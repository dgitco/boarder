create table if not exists f7_rid (rid text primary key, at integer not null);
create index if not exists f7_rid_at on f7_rid(at);
