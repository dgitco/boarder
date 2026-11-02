create table if not exists device_voice_hit (device_id text not null, op text not null, at integer not null);
create index if not exists device_voice_hit_dev on device_voice_hit(device_id, op, at);
create index if not exists device_voice_hit_at on device_voice_hit(at);
