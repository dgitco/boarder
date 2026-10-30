alter table device add column scope text not null default 'full';
-- 최신 값(기기마다 한 줄, JSON 그대로 — 토큰 · 키 값은 CLI 가 안 보내고 서버도 정해진 칸만 남김)
create table device_metric (
  device_id text primary key,
  owner text not null,
  at integer not null,
  data text not null
);
create index device_metric_owner on device_metric(owner);
create table device_metric_hist (
  id integer primary key autoincrement,
  device_id text not null,
  at integer not null,
  mem_avail_mb integer,
  cpu_pct real,
  disk_pct integer,
  agents integer
);
create index device_metric_hist_dev on device_metric_hist(device_id, at);
