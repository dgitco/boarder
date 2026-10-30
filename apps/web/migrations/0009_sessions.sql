create table ai_session (
  id text not null,                      -- <도구>:<그 도구의 세션 id>
  owner text not null,
  tool text not null,
  native text not null,
  title text not null default '',
  cwd text not null default '',
  repo text not null default '',
  branch text not null default '',
  model text not null default '',
  host text not null default '',
  win text not null default '',
  lines integer not null default 0,      -- 받은 원본 줄 수(다음 조각 시작)
  messages integer not null default 0,
  parts integer not null default 0,      -- R2 조각 수
  state text not null default '',        -- 변환기 ParseState(JSON) — 다음 조각을 이어서 바꿈
  created_at integer not null,
  updated_at integer not null,
  primary key (owner, id)
);
create index ai_session_owner on ai_session(owner, updated_at);
