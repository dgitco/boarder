create table connection (
  id text primary key,
  owner text not null,
  service text not null,                 -- 도구 이름 앞(<service>__<tool>): 소문자 · 숫자 · -, 24자까지(예 linear, github)
  label text not null default '',
  kind text not null,                    -- oauth · url
  url text not null,                     -- 원격 MCP 주소
  auth text not null default '',         -- 봉한 JSON: { access_token, refresh_token, expires_at, client_id, client_secret, token_endpoint, headers }
  account text not null default '',      -- 화면에 보일 계정 이름(아는 때만)
  status text not null default 'ok',     -- ok · expired · error
  error text,
  tools text,                            -- 원격 tools/list 캐시(JSON)
  tools_at integer,
  off text not null default '',
  read_only integer not null default 0,  -- 1 이면 읽기 도구만 보임
  created_at integer not null,
  updated_at integer not null,
  unique (owner, service, label)
);
create index connection_owner on connection(owner);
-- OAuth 연결 중(10분): state → 누구 · 어디로 · PKCE 검증값(봉함)
create table connection_pending (
  state text primary key,
  owner text not null,
  service text not null,
  label text not null default '',
  url text not null,
  auth text not null,                    -- 봉한 JSON: { verifier, client_id, client_secret, token_endpoint, redirect_uri, resource }
  back text not null default '',         -- 끝나면 돌아갈 화면(#settings/connectors 등)
  bind text not null default '',         -- 시작한 브라우저의 쿠키(bx_oc) sha256 — 콜백은 같은 브라우저만(로그인 CSRF 막기)
  expires_at integer not null
);
