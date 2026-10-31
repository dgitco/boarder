create table if not exists emoji (name text primary key, key text not null, mime text not null, by_email text not null, at integer not null);
create table if not exists emoji_bot (bot text primary key, by_email text not null, at integer not null);
