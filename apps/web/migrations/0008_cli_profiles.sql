create table cli_profile (
  owner text not null,
  host text not null,
  data text not null,                    -- JSON { profiles: [{ name, clis: [{ cli, account }] }], repos: [{ repo, profile }] }
  updated_at integer not null,
  primary key (owner, host)
);
