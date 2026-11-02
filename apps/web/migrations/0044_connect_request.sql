create table connect_request (
  id text primary key,                 -- cr_…
  owner text not null,                 -- 회원 메일
  device_id text not null,             -- 요청한 기기(그 기기만 상태를 봄)
  service text not null,
  label text not null default '',
  host text not null default '',       -- 카드에 보일 주소(비밀 아님)
  read_only integer not null default 1,
  payload text,
  card_id text,
  state text not null default 'pending' check (state in ('pending', 'approved', 'denied', 'expired', 'failed')),
  conn_id text,
  error text,
  created_at integer not null,
  decided_at integer
);
create index connect_request_owner on connect_request(owner, state, created_at);
create index connect_request_card on connect_request(card_id);
