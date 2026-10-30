alter table wl_change add column origin text not null default 'relay';
create index wl_change_origin on wl_change(origin, seq);
