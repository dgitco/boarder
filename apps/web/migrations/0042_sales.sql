create table if not exists sales_team (
  id text primary key,                   -- st_ + 20
  name text not null,
  created_by text not null,
  created_at integer not null
);
create table if not exists sales_member (
  team text not null,
  email text not null,                   -- 소문자
  role text not null default 'member',   -- admin · member
  added_by text not null,
  at integer not null,
  primary key (team, email)
);
create index if not exists sales_member_email on sales_member(email);
create table if not exists sales_card (
  id text primary key,                   -- sc_ + 20
  team text not null,
  firm text not null,
  stage text not null,                   -- inquiry · contact · call · demo · proposal · contract · handoff · hold · lost
  assignee text not null,                -- 팀원 메일
  source text not null,                  -- inquiry · seminar · referral · branch
  last_at text,                          -- 마지막 연락(YYYY-MM-DD)
  last_note text not null default '',
  next text not null default '',         -- 다음 할 일
  due text,                              -- 기한(YYYY-MM-DD, 한국 날짜)
  links text not null default '[]',      -- 원문 링크 JSON
  hold_until text,                       -- 보류일 때 다시 볼 날짜
  lost_reason text not null default '',  -- 놓침일 때 이유
  ver integer not null default 1,        -- 고칠 때마다 +1(먼저 고친 사람을 덮지 않게)
  created_by text not null,
  created_at integer not null,
  updated_by text not null,
  updated_at integer not null
);
create index if not exists sales_card_team on sales_card(team, stage, due);
-- 기록 줄: 누가 · 언제 · 무엇을(바뀐 칸 [앞, 뒤])
create table if not exists sales_event (
  id integer primary key autoincrement,
  team text not null,
  card text not null,
  who text not null,
  kind text not null,                    -- create · edit · move
  data text not null default '{}',
  at integer not null
);
create index if not exists sales_event_card on sales_event(team, card, at);
