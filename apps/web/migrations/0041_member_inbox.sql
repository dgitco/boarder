-- 회원 보드 모아 보기 · 반응(더하기만): 저장 · 초안 · 읽음 · 글 반응 — 모두 owner = 회원 메일, 그 사람 것만
create table member_saved (
  owner text not null,
  kind text not null check (kind in ('log', 'card')),   -- log = board_log.id, card = board_card.id
  ref text not null,
  at integer not null,
  primary key (owner, kind, ref)
);
create index member_saved_at on member_saved(owner, at);
create table member_draft (
  owner text not null,
  pane text not null,   -- 틀 초안 열쇠(chan:<채널> · th:<스레드 ts> · card:<카드>)
  text text not null,
  at integer not null,
  primary key (owner, pane)
);
create table member_seen (
  owner text not null,
  pane text not null,   -- 채널 pane(「%숫자」)
  at integer not null,  -- 이 시각(ms)까지 봄
  primary key (owner, pane)
);
create table member_react (
  owner text not null,
  log_id integer not null,   -- board_log.id
  emoji text not null,       -- Slack 이름(+1 · eyes …) — 틀 반응 꼴
  at integer not null,
  primary key (owner, log_id, emoji)
);
