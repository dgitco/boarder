create index if not exists wl_talk_seen_who_thread on wl_talk_seen(who, thread, at);
create index if not exists agent_token_owner on agent_token(owner, created_at);
