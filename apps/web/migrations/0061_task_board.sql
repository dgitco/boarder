-- 태스크 현황(설정 › 기능 taskboard): 기기(올리는 쪽 — 에이전트 쪽 도구)가 올린 요청 · 요청 대화. owner = 그 기기 주인 메일, 그 사람만 봄.
-- 새 표 · 색인만 더함(옛 코드는 이 표를 모름 — 같이 살 수 있음). 있던 표는 안 바꿈.
create table if not exists task_board (
  owner text not null,
  id text not null,
  title text not null default '',
  quote text not null default '',           -- 요청 원문
  status text not null default '',          -- 올리는 쪽 상태 글자(진행 · 막힘 · 기다림 · 끝 …)
  state text not null default 'working',    -- 칩 꼴: working · blocked · waiting · done · cancelled
  dept text not null default '',
  assignee text not null default '',        -- 담당
  area text not null default '',            -- 묶음(예: 제품 · 작업 환경)
  done_text text not null default '',       -- 한 일
  next_text text not null default '',       -- 남은 것
  q text not null default '',               -- 물음 번호 등 짧은 표지
  prs text not null default '[]',           -- [{n, state, url?}]
  tasks text not null default '[]',         -- 붙은 태스크 번호 글자
  logs text not null default '[]',          -- 작업 기록 줄(최근 것)
  requested_at integer,
  updated_at integer not null,
  completed_at integer,
  src_ref text,                             -- 원 글 자리(올리는 쪽 것, 화면엔 안 씀)
  device_id text,                           -- 마지막으로 올린 기기 — 「말하기」 줄은 이 기기가 가져감
  at integer not null,                      -- 마지막으로 올린 시각(서버 시각, 보관 기간 기준)
  primary key (owner, id)
);
create index if not exists task_board_upd on task_board(owner, updated_at);
create index if not exists task_board_at on task_board(at);
create table if not exists task_board_convo (
  owner text not null,
  task_id text not null,
  k text not null,                          -- 줄 열쇠(같은 줄을 다시 올려도 한 줄)
  layer text not null default 'human',      -- human = 사람 ↔ 에이전트(기본 펼침) · agent = 에이전트끼리(접힘)
  who text not null default '',
  mine integer not null default 0,          -- 1 = 이 보드 주인이 쓴 줄(오른쪽 말풍선)
  at integer not null,                      -- 줄 시각(올리는 쪽이 준 값)
  source text not null default '',
  text text not null,
  src_ref text,
  pending integer not null default 0,       -- 보더 「말하기」로 쓴 줄: 1 = 올리는 쪽이 아직 ack 안 함
  to_device text,                           -- 「말하기」 줄을 쓸 때 요청을 올린 기기(요청이 지워져도 이 기기로 전함)
  taken_by text,                            -- 가져간 기기(ack 는 이 기기만)
  taken_at integer,                         -- 가져간 시각(잠시 지나도 ack 가 없으면 다시 나감)
  got_at integer not null,                  -- 서버가 받은 시각(보관 기간 기준)
  primary key (owner, task_id, k)
);
create index if not exists task_board_convo_at on task_board_convo(owner, task_id, at);
create index if not exists task_board_convo_pend on task_board_convo(owner, pending) where pending = 1;
create index if not exists task_board_convo_got on task_board_convo(got_at);
-- 사람별 하루 횟수 · 마지막으로 올라온 때(날이 바뀌면 횟수는 0 부터)
create table if not exists task_board_use (
  owner text primary key,
  day integer not null,                     -- UTC 날짜 번호(ms / 86400000)
  pushes integer not null default 0,        -- 오늘 올리기 횟수
  lines integer not null default 0,         -- 오늘 새로 들어온 대화 줄
  says integer not null default 0,          -- 오늘 「말하기」 횟수
  last_at integer                           -- 기기가 마지막으로 올린 시각(「말하기」는 안 바꿈)
);
create index if not exists task_board_use_day on task_board_use(day);
