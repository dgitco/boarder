create table feedback (
  id text primary key,
  owner text not null,
  author text not null,                  -- 사람 메일 또는 에이전트 창(boarder@host:창)
  via text not null,                     -- web · mcp · cli(REST)
  kind text not null,                    -- bug · idea · other
  text text not null,
  page text not null default '',         -- 남긴 화면(주소 꼴만)
  state text not null default 'new',     -- new · seen(주인이 확인함)
  flagged integer not null default 0,
  at integer not null
);
create index feedback_owner on feedback(owner, at);
create index feedback_author on feedback(author, at);
create index feedback_flagged on feedback(flagged, at);
create index feedback_at on feedback(at);
