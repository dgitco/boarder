create table agent_token (
  hash text primary key,
  pane text not null,          -- tmux 판(%1150) — 다른 기기 · 클라우드 에이전트는 그쪽 이름
  win text not null default '',
  host text not null default 'owner-host',
  created_at integer not null,
  revoked_at integer
);
create index agent_token_pane on agent_token(pane, revoked_at);
