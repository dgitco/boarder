create table tool_state (
  name text primary key,
  enabled integer not null default 0,
  mask integer not null default 1,      -- 응답 속 개인정보(주민번호 · 카드 · 전화) 가림
  code_hash text not null default '',
  active_hash text not null default '',
  updated_at integer not null
);
create table tool_desc (
  hash text not null,
  name text not null,
  description text not null,
  at integer not null,
  primary key (name, hash)
);
alter table agent_token add column tools text not null default '*';
-- 이미 쓰는 여섯은 켠 채로(첫 동기화 때 설명 판만 조용히 적음)
insert into tool_state(name, enabled, updated_at) values
  ('inbox_ask', 1, 0), ('inbox_wait', 1, 0), ('inbox_log', 1, 0), ('inbox_close', 1, 0), ('inbox_say', 1, 0), ('inbox_status', 1, 0);
