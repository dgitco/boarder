-- 사람이 넣은 비밀(카드 번호 · 전화 · 주민번호 …)을 에이전트가 「보지 않고」 브라우저 칸에 넣게 함 — worker/secrets.ts.
-- secret.value 는 늘 봉함(worker/vault sealFieldNow, AAD tbl=secret · pk=id · col=value — 봉투 스위치와 상관없이; KEK 가 없으면 저장 자체를 거절).
-- 지운 비밀은 value = NULL · deleted_at(이름 · 쓰임은 감사용으로 남음). mode once = 한 번 넘기면 지움 · 10분 안 쓰면 지움.
create table if not exists secret (
  id text primary key,
  owner text not null,                    -- 그 사람 메일(소문자)
  name text not null,
  kind text not null,                     -- card · phone · id · password · text · other
  mode text not null default 'saved',     -- once · saved
  policy text not null default 'ask',     -- ask(사람이 카드에서 허용) · auto(바로 허용)
  value text,                             -- v2.<판>.<암호문> — 지우면 NULL
  created_at integer not null,
  used_at integer,
  expires_at integer,
  deleted_at integer
);
create unique index if not exists secret_owner_name on secret(owner, name) where deleted_at is null;

create table if not exists secret_request (
  id text primary key,
  secret_id text not null,
  owner text not null,
  site text not null,                     -- 사람이 허용한 사이트(https://…)
  target text not null,                   -- JSON { selector, tab? }
  state text not null default 'pending',  -- pending · approved · denied · sent · expired
  device_id text not null,
  agent text not null default '',         -- 요청한 창(감사)
  tok text not null default '',
  card_id text,
  created_at integer not null,
  decided_at integer,
  sent_at integer
);
create index if not exists secret_request_owner on secret_request(owner, created_at);
create index if not exists secret_request_card on secret_request(card_id);
