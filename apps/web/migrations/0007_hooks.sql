create table hook (
  id text primary key,                   -- wh_ + 20
  owner text not null,
  name text not null,
  preset text not null,                  -- github · channeltalk · generic
  verify text not null,                  -- JSON: { mode: github | standard | header(header) | query(param) }
  secret text not null default '',       -- 봉함(github · standard — 서명 계산에 원문이 필요)
  secret_hash text not null default '',  -- sha256(header · query — 비교만)
  target text not null default '',
  enabled integer not null default 1,
  count integer not null default 0,
  last_at integer,
  created_at integer not null,
  unique (owner, name)
);
create table hook_event (
  id text primary key,
  hook_id text not null,
  owner text not null,
  dedupe text not null,                  -- x-github-delivery · webhook-id · 본문 sha256
  kind text not null default '',         -- 사건 이름(예 pull_request.opened)
  summary text not null default '',      -- 정해진 꼴 한 줄(가림 뒤)
  body text not null default '',         -- 원문(256KB 까지) — 에이전트에겐 믿지 않는 자료로만
  delivered text not null default '',    -- '' · woke · reopened · failed:<까닭>
  at integer not null,
  unique (hook_id, dedupe)
);
create index hook_event_owner on hook_event(owner, at);
