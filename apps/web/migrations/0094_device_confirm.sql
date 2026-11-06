alter table device_code add column confirm_hash text;
alter table device_code add column confirm_tries integer not null default 0;
