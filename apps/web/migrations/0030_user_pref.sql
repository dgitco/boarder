create table if not exists user_pref (owner text not null, k text not null, v text not null, at integer not null, primary key (owner, k));
