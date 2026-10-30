create table if not exists imp_item (
  owner text not null,
  key text not null,
  device_id text not null default '',
  kind text not null,                    -- window · session · thread · todo · task
  engine text not null default '',       -- 그 창을 띄운 엔진(tmux · 커스텀 이름 · proc)
  title text not null default '',
  cwd text not null default '',
  repo text not null default '',
  branch text not null default '',
  refs text not null default '[]',       -- JSON: ["gh:owner/repo#12", "slack:C0/1793.1", …]
  state text not null default '',        -- working · idle · question · parked · done · open · gone
  state_at integer,
  win text not null default '',
  session text not null default '',      -- 이 창이 쓰는 세션(session:<도구>:<id>) 또는 할 일의 세션
  handle text,                           -- 다시 열 손잡이(JSON) — 옮기기(A-4) · 다시 열기
  seen_at integer not null,
  gone_at integer,
  primary key (owner, key)
);
create index if not exists imp_item_owner on imp_item(owner, gone_at);
-- 노드(그 사람 보드): 묶기는 서버가 늘 다시 계산(group.ts), 사람이 옮기거나 합친 것은 how='pin' 으로 남아 이김
create table if not exists mnode (
  owner text not null,
  id text not null,
  name text not null default '',
  pinned_name text,                      -- 사람이 지은 이름(있으면 이것)
  area text not null default '',
  state text not null default '',        -- turn(내 차례) · blocked · working · idle · parked · done
  why text not null default '',
  counts text not null default '{}',     -- {window, session, thread, todo, task, log, card}
  created_at integer not null,
  updated_at integer not null,
  archived_at integer,
  primary key (owner, id)
);
create table if not exists mnode_item (
  owner text not null,
  item text not null,
  node text not null,
  how text not null default 'auto',      -- auto · pin
  primary key (owner, item)
);
create index if not exists mnode_item_node on mnode_item(owner, node);
create table if not exists imp_audit (
  owner text not null,
  at integer not null,
  data text not null                     -- {items, nodes, missing, fixed, mixed, moved, empty}
);
create index if not exists imp_audit_owner on imp_audit(owner, at);
-- 쓰던 MCP · 역할 옮기기 카드(A-2): 카드 하나에 목록, 답하면 적용
create table if not exists imp_proposal (
  card_id text primary key,
  owner text not null,
  hash text not null,                    -- 같은 목록이면 카드를 다시 안 만듦
  payload text not null,                 -- {connectors:[…], roles:[…]} — 이름 · 주소만
  state text not null default 'open',    -- open · applied · skipped
  result text,
  at integer not null
);
create index if not exists imp_proposal_owner on imp_proposal(owner, at);
create table if not exists role (
  owner text not null,
  id text not null,
  name text not null,
  look text not null default '',         -- 이름 · 모양(블롭 시드 · 색)
  instructions text not null default '', -- 지시(AGENTS.md 조각)
  intake text not null default '',       -- 맡는 일
  engine text not null default '',       -- 엔진(기기 · 엔진 · 모델 · 언제)
  perms text not null default '',        -- 권한(도구 · 커넥터 · 못 하는 것)
  supervise text not null default '',
  rules text not null default '',
  source text not null default '',       -- import:<어디서> · bot · user
  created_at integer not null,
  updated_at integer not null,
  primary key (owner, id)
);
create table if not exists engine_cmd (
  id text primary key,
  owner text not null,
  device_id text not null,
  verb text not null,                    -- move · park · reopen · send
  args text not null,                    -- JSON
  state text not null default 'queued',  -- queued · taken · done · failed
  result text,
  at integer not null,
  taken_at integer,
  done_at integer
);
create index if not exists engine_cmd_dev on engine_cmd(device_id, state, at);
