create index if not exists mnode_owner_archived on mnode(owner, archived_at);
create index if not exists mnode_owner_name on mnode(owner, name);
create index if not exists mnode_owner_pinned on mnode(owner, pinned_name);
